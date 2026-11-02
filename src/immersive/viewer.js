/**
 * The 3D viewer behind the tour.
 *
 *   wall      the memory wall: every project as an instant print on twine
 *   place     one project's place, rendered as realistically as a browser
 *             allows (physically based materials, sky light, soft shadows,
 *             occlusion, bloom, sun rays, a filmic curve — see post.js), with
 *             the current photo floating in the middle as a print in the wind
 *
 * Moving between them:
 *   enter(i)       fly into print i on the wall; its photo fills the screen,
 *                  then "develops" into the 3D place as the view glides in
 *   photo(i)       the wind takes the print away, the next drifts in, and the
 *                  view moves to a new spot in the place
 *   backToWall()   the place dissolves back into the photo, and the photo
 *                  back onto its print on the wall
 *
 * Every move is a time-based tween, so it can be interrupted.
 */
import * as THREE from 'three'
import { loadScene } from './scenes/index.js'
import { createPost, NO_INK_LAYER } from './post.js'
import { skyFromProject } from './palette.js'
import { buildWall } from './wall.js'
import { buildPrint, disposePrint, loadImage } from './prints.js'
import { easeInOutCubic, easeInOutSine, easeOutCubic, easeInCubic, clamp01, smooth } from './utils.js'

/** A value that eases toward targets over time, interruptible. */
function tween(initial) {
  let from = initial
  let to = initial
  let start = 0
  let dur = 0
  let ease = easeInOutCubic
  let value = initial
  let done = null
  return {
    get value() {
      return value
    },
    set(v) {
      from = to = value = v
      dur = 0
      done?.()
      done = null
    },
    to(v, seconds, easing = easeInOutCubic, now = performance.now() / 1000) {
      done?.()
      from = value
      to = v
      start = now
      dur = Math.max(0.001, seconds)
      ease = easing
      return new Promise((r) => (done = r))
    },
    update(now) {
      if (dur <= 0) return value
      const k = clamp01((now - start) / dur)
      value = from + (to - from) * ease(k)
      if (k >= 1) {
        dur = 0
        const d = done
        done = null
        d?.()
      }
      return value
    },
  }
}

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000))
const NIGHT_OR_INDOOR = new Set(['waterfront-night', 'party-boat', 'studio', 'interior'])
const fract = (v) => v - Math.floor(v)
const ARRIVE_FROM = 0.72 // how far along its arrival path a place starts

export async function createViewer({ canvas, quality = 'high', onError, onPhase, onPrintRect }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5))
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace // post.js does the display conversion
  renderer.toneMapping = THREE.NoToneMapping // and the film curve
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setClearColor(0x0b0b0c, 1)

  let lost = false
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    lost = true
    onError?.(new Error('WebGL context lost'))
  })

  const post = createPost(THREE, renderer, { quality })
  const ctx = { quality }
  const pmrem = new THREE.PMREMGenerator(renderer)

  const size = new THREE.Vector2() // drawing buffer, px
  const css = new THREE.Vector2(1, 1) // canvas, CSS px
  const wide = () => css.x / css.y >= 1

  /* --- places --------------------------------------------------------- */

  /** Light the place with its own sky: reflections and soft ambient light. */
  function environment(place) {
    const sky = place.world?.sky
    if (!sky) return
    const envScene = new THREE.Scene()
    envScene.add(new THREE.Mesh(sky.geometry, sky.material))
    const rt = pmrem.fromScene(envScene, 0.02, 0.1, 20000)
    place.scene.environment = rt.texture
    place.envTarget = rt
    // the sky now lights everything, so the flat ambient fill steps back
    if (place.world.hemi) place.world.hemi.intensity *= 0.35
    // the sky dome itself has no surface to shade or occlude
    sky.layers.set(NO_INK_LAYER)
  }

  const cache = new Map()
  const pending = new Map()
  const keepMax = quality === 'low' ? 2 : 3
  const order = []
  const keyOf = (p) => `${p.scene}|${p.hero || ''}`

  function free(place) {
    const seen = new Set()
    place.scene.traverse((n) => {
      if (n.geometry && !seen.has(n.geometry)) {
        seen.add(n.geometry)
        n.geometry.dispose()
      }
      const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : []
      for (const m of mats) {
        if (seen.has(m)) continue
        seen.add(m)
        for (const v of Object.values(m)) if (v && v.isTexture) v.dispose()
        m.dispose()
      }
    })
    place.world?.dispose?.()
    place.envTarget?.dispose()
  }

  function fovFor(place) {
    return (place?.path?.fov || 48) * (wide() ? 1 : 1.35)
  }
  function fit(place) {
    place.camera.aspect = css.x / css.y
    place.camera.fov = fovFor(place)
    place.camera.updateProjectionMatrix()
  }

  function ensure(p) {
    const key = keyOf(p)
    if (cache.has(key)) return Promise.resolve(cache.get(key))
    if (pending.has(key)) return pending.get(key)
    const job = (async () => {
      await wait(0.016)
      ctx.sky = NIGHT_OR_INDOOR.has(p.scene) ? null : await skyFromProject(p)
      const place = await loadScene(p.scene, THREE, ctx)
      ctx.sky = null
      environment(place)
      place.scene.traverse((o) => {
        const m = o.material
        if (o.isSprite || (m && !Array.isArray(m) && m.transparent)) o.layers.set(NO_INK_LAYER)
      })
      place.posCurve = new THREE.CatmullRomCurve3(place.path.positions, false, 'centripetal')
      place.lookCurve = new THREE.CatmullRomCurve3(place.path.targets, false, 'centripetal')
      place.camera = new THREE.PerspectiveCamera(place.path.fov || 48, 1, place.path.near ?? 0.3, 20000)
      place.camera.layers.enable(NO_INK_LAYER)
      fit(place)
      renderer.compile(place.scene, place.camera)
      cache.set(key, place)
      pending.delete(key)
      order.push(key)
      while (order.length > keepMax) {
        const old = order.shift()
        if (cache.has(old) && cache.get(old) !== current) {
          free(cache.get(old))
          cache.delete(old)
        }
      }
      return place
    })()
    pending.set(key, job)
    job.catch((err) => {
      pending.delete(key)
      onError?.(err)
    })
    return job
  }

  /* --- state ------------------------------------------------------------- */

  let mode = 'none' // 'wall' | 'place'
  let wall = null
  let current = null
  let currentIndex = -1
  const u = tween(1) // along the place's arrival path
  const yaw = tween(0) // turn of the view, per photo
  const orbit = tween(0) // swing round the subject, per photo
  const spotMix = tween(1) // between listed viewpoints
  const cloud = tween(0)
  const fade = tween(1)
  const photoMix = tween(0) // 1: the photo fills the screen
  const zoom = tween(0) // wall: 0 at rest, 1 filling the screen with a print
  const pointer = new THREE.Vector2()
  const pointerNow = new THREE.Vector2()

  const pos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const tmp2 = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)

  // scenes may list their own viewpoints (path.spots: [{ pos, look }]);
  // the view glides from wherever it is to the next one
  const viewNow = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
  let viewFrom = null
  let viewTo = null
  let viewLift = 0

  /** The view of a place, at its current spot. */
  function placeCamera(place) {
    const c = place.camera
    if (place.path.spots && viewTo) {
      const k = clamp01(spotMix.value)
      pos.lerpVectors(viewFrom.pos, viewTo.pos, k)
      look.lerpVectors(viewFrom.look, viewTo.look, k)
      pos.y += Math.sin(Math.PI * k) * viewLift // a crane's arc, not a slide
      // arriving: come down the path and settle onto the first spot
      const f = clamp01(u.value)
      if (f < 1) {
        place.posCurve.getPointAt(f, tmp)
        place.lookCurve.getPointAt(f, tmp2)
        const w = smooth(clamp01((f - ARRIVE_FROM) / (1 - ARRIVE_FROM)))
        pos.lerpVectors(tmp, pos, w)
        look.lerpVectors(tmp2, look, w)
      }
    } else {
      const f = clamp01(u.value)
      place.posCurve.getPointAt(f, pos)
      place.lookCurve.getPointAt(f, look)
      if (Math.abs(orbit.value) > 1e-4) {
        tmp.subVectors(pos, look).applyAxisAngle(yAxis, orbit.value)
        pos.copy(look).add(tmp)
      }
    }
    viewNow.pos.copy(pos)
    viewNow.look.copy(look)
    if (place.anchor) {
      pos.add(place.anchor.position)
      look.add(place.anchor.position)
    }
    if (place.groundAt) {
      const floor = place.groundAt(pos.x, pos.z) + (place.clearance ?? 1.2)
      if (pos.y < floor) pos.y = floor
    }
    c.position.copy(pos)
    c.lookAt(look)
    c.rotateOnWorldAxis(yAxis, yaw.value - pointerNow.x * 0.02)
    c.rotateX(pointerNow.y * 0.012)
    // on wide screens the print floats right of centre, so frame the place's
    // subject to its left rather than behind it
    if (wide()) c.setViewOffset(css.x, css.y, css.x * 0.2 * (1 - photoMix.value), 0, css.x, css.y)
    else c.clearViewOffset()
  }

  /** For scenes without listed spots: along the arrival path, turned, swung. */
  function derivedSpot(i) {
    if (i === 0) return { u: 1, yaw: 0, orbit: 0 }
    return {
      u: 1 - 0.1 - 0.32 * fract(i * 0.618),
      yaw: (i % 2 ? 1 : -1) * (0.16 + 0.2 * fract(i * 0.37)),
      orbit: ((i % 3) - 1) * 0.07,
    }
  }

  function goToSpot(i, seconds) {
    if (!current) return Promise.resolve()
    const spots = current.path.spots
    if (spots) {
      const next = spots[i % spots.length]
      viewFrom = { pos: viewNow.pos.clone(), look: viewNow.look.clone() }
      viewTo = next
      viewLift = Math.min(5, viewFrom.pos.distanceTo(next.pos) * 0.1)
      spotMix.set(0)
      yaw.to(0, seconds)
      return spotMix.to(1, seconds, easeInOutCubic)
    }
    const s = derivedSpot(i)
    yaw.to(s.yaw, seconds, easeInOutCubic)
    orbit.to(s.orbit, seconds, easeInOutCubic)
    return u.to(s.u, seconds, easeInOutCubic)
  }

  /* --- the sun on screen, for its rays ---------------------------------- */

  const sunPoint = new THREE.Vector3()
  const forward = new THREE.Vector3()
  const sunInfo = { uv: new THREE.Vector2(), strength: 0, color: new THREE.Color() }
  function sunOnScreen(place) {
    const w = place.world
    if (!w?.sunDir) {
      sunInfo.strength = 0
      return sunInfo
    }
    const c = place.camera
    c.getWorldDirection(forward)
    const facing = forward.dot(w.sunDir)
    sunPoint.copy(w.sunDir).multiplyScalar(5000).add(c.position).project(c)
    sunInfo.uv.set(sunPoint.x * 0.5 + 0.5, sunPoint.y * 0.5 + 0.5)
    const off = Math.max(Math.abs(sunPoint.x), Math.abs(sunPoint.y))
    const k = clamp01((facing - 0.05) / 0.45) * clamp01((2.2 - off) / 1.2) * (w.sunDir.y > 0 ? 1 : 0)
    sunInfo.strength = k * (w.light?.night ? 0.12 : 1) * (1 - cloud.value) * (1 - photoMix.value)
    sunInfo.color.setHex(w.light?.sunColor ?? 0xffffff)
    return sunInfo
  }

  /* --- the floating print (place mode) ------------------------------------ */

  const printScene = new THREE.Scene()
  const printCam = new THREE.PerspectiveCamera(40, 1, 0.05, 50)
  printCam.layers.enable(NO_INK_LAYER)
  const overlay = { scene: printScene, camera: printCam }
  const printCache = new Map() // src → Promise<mesh>
  const printOrder = []
  let slots = [] // { mesh, enter, exit, dir, phase }
  let printTitle = ''

  function getPrint(src) {
    const key = `${src}|${printTitle}`
    if (!printCache.has(key)) {
      printCache.set(key, buildPrint(THREE, renderer, src, { title: printTitle, width: 1, maxPx: quality === 'low' ? 900 : 1500 }))
      printOrder.push(key)
      while (printOrder.length > 8) {
        const old = printOrder.shift()
        const job = printCache.get(old)
        printCache.delete(old)
        job
          .then((m) => {
            if (!slots.some((s) => s.mesh === m)) disposePrint(m)
          })
          .catch(() => {})
      }
    }
    return printCache.get(key)
  }

  /** Size and place of the print on screen, in px. */
  function printLayout(mesh) {
    const { w, h } = mesh.userData
    const W = css.x
    const H = css.y
    const maxH = wide() ? 0.64 * H : 0.5 * H
    const maxW = wide() ? 0.48 * W : 0.82 * W
    const scale = Math.min(maxH / h, maxW / w) // px per print unit
    return { cx: W * (wide() ? 0.62 : 0.5), cy: H * (wide() ? 0.47 : 0.42), scale }
  }

  const corner = new THREE.Vector3()
  const rect = { x: 0, y: 0, w: 0, h: 0, visible: false }
  function placePrints(time) {
    const tanY = Math.tan(THREE.MathUtils.degToRad(printCam.fov / 2))
    const d = 3
    const upp = (2 * d * tanY) / css.y // world units per px at distance d
    let settled = null
    for (const s of slots) {
      const L = printLayout(s.mesh)
      const ke = s.enter == null ? 1 : easeOutCubic(clamp01((time - s.enter) / 1.5))
      const kx = s.exit == null ? 0 : easeInCubic(clamp01((time - s.exit) / 1.2))
      const dir = s.dir
      // in from one side on the wind, out and away on the other
      const ox = dir * (1 - ke) * css.x * 0.8 - dir * kx * css.x * 0.95
      const oy = -(1 - ke) * css.y * 0.08 - kx * css.y * 0.22
      const sway = Math.sin(time * 0.8 + s.phase)
      const m = s.mesh
      const cx = L.cx + ox + Math.sin(time * 0.45 + s.phase) * css.x * 0.004
      const cy = L.cy + oy + Math.sin(time * 0.7 + s.phase) * css.y * 0.006
      const world = L.scale * upp
      m.scale.setScalar(world)
      m.rotation.set(
        0.04 * sway - pointerNow.y * 0.05 + kx * 0.4,
        dir * (1 - ke) * 0.9 - dir * kx * 0.8 + pointerNow.x * 0.07 + 0.05 * Math.sin(time * 0.5 + s.phase),
        dir * (1 - ke) * 0.35 - dir * kx * 0.6 + 0.025 * sway
      )
      // the print hangs from its top edge; centre it on (cx, cy)
      const x = ((cx / css.x) * 2 - 1) * d * tanY * printCam.aspect
      const y = -((cy / css.y) * 2 - 1) * d * tanY
      corner.set(0, (m.userData.h * world) / 2, 0).applyEuler(m.rotation)
      m.position.set(x, y, -d).add(corner)
      const uni = m.material.uniforms
      uni.uTime.value = time
      uni.uWind.value = 1 + (1 - ke) * 1.6 + kx * 2.4
      uni.uOpacity.value = (1 - kx * kx) * (1 - photoMix.value)
      if (s.exit == null && ke > 0.9) settled = { m, L }
    }
    slots = slots.filter((s) => {
      const gone = s.exit != null && time - s.exit > 1.25
      if (gone) printScene.remove(s.mesh)
      return !gone
    })
    if (onPrintRect) {
      if (settled && photoMix.value < 0.05) {
        const { m, L } = settled
        rect.w = m.userData.w * L.scale
        rect.h = m.userData.h * L.scale
        rect.x = L.cx - rect.w / 2
        rect.y = L.cy - rect.h / 2
        rect.visible = true
      } else rect.visible = false
      onPrintRect(rect)
    }
  }

  async function showPrint(src, dir = 1) {
    const mesh = await getPrint(src)
    const time = performance.now() / 1000
    const same = slots.find((s) => s.mesh === mesh)
    for (const s of slots) if (s !== same && s.exit == null) s.exit = time
    if (same) {
      same.exit = null
      same.enter = time
      return
    }
    printScene.add(mesh)
    slots.push({ mesh, enter: time + 0.35, exit: null, dir, phase: Math.random() * 6 })
  }

  function clearPrints() {
    for (const s of slots) printScene.remove(s.mesh)
    slots = []
  }

  /* --- the photo, full screen (between the wall and the place) ----------- */

  const photoTextures = new Map()
  function photoTexture(src) {
    if (!photoTextures.has(src)) {
      photoTextures.set(
        src,
        loadImage(src).then((img) => {
          const t = new THREE.Texture(img)
          t.colorSpace = THREE.SRGBColorSpace
          t.needsUpdate = true
          return t
        })
      )
    }
    return photoTextures.get(src)
  }
  async function setPhoto(src) {
    const t = await photoTexture(src)
    post.setPhoto(t, t.image.naturalWidth / t.image.naturalHeight)
  }

  /* --- render loop ------------------------------------------------------- */

  function resize() {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    css.set(w, h)
    renderer.setSize(w, h, false)
    renderer.getDrawingBufferSize(size)
    post.setSize(size.x, size.y)
    for (const p of cache.values()) fit(p)
    printCam.aspect = w / h
    printCam.fov = wide() ? 40 : 52
    printCam.updateProjectionMatrix()
    wall?.layout(w / h)
  }
  resize()

  const restA = { pos: new THREE.Vector3(), look: new THREE.Vector3(), panRange: 0 }
  const restB = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
  let zoomIndex = 0

  let raf = 0
  let running = false
  function frame() {
    raf = requestAnimationFrame(frame)
    if (lost) return
    const time = performance.now() / 1000
    for (const t of [u, yaw, orbit, spotMix, cloud, fade, photoMix, zoom]) t.update(time)
    pointerNow.lerp(pointer, 0.06)
    post.uniforms.uCloud.value = cloud.value
    post.uniforms.uFade.value = fade.value
    post.uniforms.uPhoto.value = photoMix.value

    if (mode === 'wall' && wall) {
      wall.update(time, pointerNow)
      wall.restPose(restA)
      const k = easeInOutCubic(clamp01(zoom.value))
      const cam = wall.camera
      if (k > 0) {
        wall.printPose(zoomIndex, restB)
        cam.position.lerpVectors(restA.pos, restB.pos, k)
        look.lerpVectors(restA.look, restB.look, k)
      } else {
        cam.position.copy(restA.pos)
        look.copy(restA.look)
      }
      cam.position.x += pointerNow.x * 0.35 * (1 - k)
      cam.position.y += pointerNow.y * 0.2 * (1 - k)
      cam.lookAt(look)
      post.render(wall.scene, cam, { time, flat: true })
      if (onPrintRect && rect.visible) {
        rect.visible = false
        onPrintRect(rect)
      }
    } else if (mode === 'place' && current) {
      current.update?.(time)
      current.world?.tick?.(time)
      placeCamera(current)
      placePrints(time)
      post.render(current.scene, current.camera, {
        time,
        exposure: current.world?.exposure ?? 1,
        overlay: slots.length ? overlay : null,
        sun: sunOnScreen(current),
      })
    } else {
      post.renderClouds(time)
    }
  }

  let journey = 0

  return {
    /** Build the wall for these projects (once) and show it. */
    async showWall(items) {
      const id = ++journey
      if (!wall) {
        wall = await buildWall(THREE, renderer, items, { quality })
        wall.layout(css.x / css.y)
      }
      if (id !== journey) return
      mode = 'wall'
      cloud.set(0)
      zoom.set(0)
      photoMix.set(0)
      await fade.to(0, 1.4, easeInOutSine)
      onPhase?.('wall')
    },
    /** Get the wall ready without showing it. */
    prepareWall(items) {
      if (!wall) {
        return buildWall(THREE, renderer, items, { quality }).then((w) => {
          if (!wall) {
            wall = w
            wall.layout(css.x / css.y)
          } else w.dispose()
        })
      }
      return Promise.resolve()
    },

    /** The print under the pointer on the wall (or -1); it lifts toward you. */
    wallHover(ndcX, ndcY) {
      if (mode !== 'wall' || !wall || zoom.value > 0.01) return -1
      const i = wall.pick(new THREE.Vector2(ndcX, ndcY))
      wall.hover(i)
      return i
    },
    /** Drag the wall (when it's taller than the screen). */
    wallPan(dx, dy) {
      if (mode !== 'wall' || !wall) return
      wall.restPose(restA)
      wall.panBy(-dx * 0.01, dy * 0.012, restA.panRange)
    },

    /**
     * Into project i: fly into its print on the wall (if it's showing), the
     * photo fills the screen, then develops into the place as the view glides in.
     */
    async enter(i, item, { title = '' } = {}) {
      const id = ++journey
      currentIndex = i
      printTitle = title
      onPhase?.('entering')
      const loading = ensure(item)
      const photoReady = setPhoto(item.hero)
      getPrint(item.hero).catch(() => {})
      if (mode === 'wall' && wall) {
        zoomIndex = i
        wall.hover(-1)
        await zoom.to(1, 1.6, easeInOutCubic)
        if (id !== journey) return false
        await photoReady
        await photoMix.to(1, 0.9, easeInOutSine)
      } else {
        await photoReady
        photoMix.set(1)
        await fade.to(0, 0.8, easeInOutSine)
      }
      if (id !== journey) return false
      onPhase?.('loading')
      const place = await loading
      if (id !== journey) return false
      current = place
      mode = 'place'
      clearPrints()
      if (place.path.spots) {
        viewTo = place.path.spots[0]
        viewFrom = viewTo
        spotMix.set(1)
      } else {
        viewTo = viewFrom = null
      }
      yaw.set(0)
      orbit.set(0)
      u.set(ARRIVE_FROM)
      zoom.set(0)
      onPhase?.('arriving')
      // the photo develops into the place while the view settles where it was taken
      u.to(1, 4.6, easeOutCubic)
      await wait(0.5)
      await photoMix.to(0, 2.8, easeInOutSine)
      if (id !== journey) return false
      showPrint(item.hero, 1)
      onPhase?.('arrived')
      return true
    },

    /** Photo i: the next print on the wind, and a new view of the place. */
    photo(i, src, dir = 1) {
      if (mode !== 'place') return
      showPrint(src, dir)
      goToSpot(i, 3.8)
    },
    preloadPrint(src) {
      getPrint(src).catch(() => {})
    },

    /** Back to the wall: the place dissolves into the photo, the photo onto its print. */
    async backToWall(src) {
      const id = ++journey
      onPhase?.('leaving')
      if (mode === 'place') {
        if (src) await setPhoto(src)
        const time = performance.now() / 1000
        for (const s of slots) if (s.exit == null) s.exit = time
        await photoMix.to(1, 1.3, easeInOutSine)
        if (id !== journey) return
      }
      clearPrints()
      if (!wall) return
      mode = 'wall'
      zoomIndex = Math.max(0, currentIndex)
      zoom.set(1)
      await photoMix.to(0, 0.9, easeInOutSine)
      await zoom.to(0, 1.8, easeInOutCubic)
      if (id !== journey) return
      onPhase?.('wall')
    },

    setPointer(x, y) {
      pointer.set(x, y)
    },
    preload(p) {
      return ensure(p).catch(() => {})
    },
    resize,
    start() {
      if (running) return
      running = true
      raf = requestAnimationFrame(frame)
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
    },
    dispose() {
      running = false
      journey++
      cancelAnimationFrame(raf)
      for (const p of cache.values()) free(p)
      cache.clear()
      wall?.dispose()
      for (const job of printCache.values()) job.then(disposePrint).catch(() => {})
      for (const job of photoTextures.values()) job.then((t) => t.dispose()).catch(() => {})
      pmrem.dispose()
      post.dispose()
      renderer.dispose()
    },
  }
}
