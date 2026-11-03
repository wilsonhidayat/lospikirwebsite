/**
 * The 3D viewer behind the tour: one project's place at a time, rendered as
 * realistically as a browser allows — physically based materials lit by the
 * sun, soft shadows and the place's own sky (an environment map), finished in
 * post.js with occlusion, bloom, sun rays, a filmic curve and a colour grade
 * matched to the project's photos.
 *
 * The photos are not drawn here: they float over the canvas as real <img>s,
 * at full quality. This only moves the view:
 *
 *   enter(item)   develop the place out of the dark while the view glides in
 *   photo(i)      move to the next viewpoint (a properly different one)
 *   leave()       let the place sink back into the dark
 *
 * Every move is a time-based tween, so it can be interrupted.
 */
import * as THREE from 'three'
import { loadScene } from './scenes/index.js'
import { createPost, NO_INK_LAYER } from './post.js'
import { skyFromProject, gradeFromProject } from './palette.js'
import { easeInOutCubic, easeInOutSine, easeOutCubic, clamp01, smooth } from './utils.js'

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
const NIGHT_OR_INDOOR = new Set(['waterfront-night', 'party-boat', 'studio', 'interior', 'hall'])
const fract = (v) => v - Math.floor(v)
const ARRIVE_FROM = 0.72 // how far along its arrival path a place starts

export async function createViewer({ canvas, quality = 'high', onError, onPhase }) {
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

  const size = new THREE.Vector2()
  const css = new THREE.Vector2(1, 1)
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
    if (place.world.hemi) place.world.hemi.intensity *= 0.35
    sky.layers.set(NO_INK_LAYER)
  }

  const cache = new Map()
  const pending = new Map()
  const keepMax = quality === 'low' ? 1 : 2
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
    return (place?.path?.fov || 48) * (wide() ? 1 : 1.3)
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
      const [sky, grade] = await Promise.all([NIGHT_OR_INDOOR.has(p.scene) ? null : skyFromProject(p), gradeFromProject(p)])
      ctx.sky = sky
      const place = await loadScene(p.scene, THREE, ctx)
      ctx.sky = null
      place.grade = grade
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

  /* --- the view ------------------------------------------------------------ */

  let current = null
  const u = tween(1)
  const yaw = tween(0)
  const orbit = tween(0)
  const spotMix = tween(1)
  const reveal = tween(0)
  const pointer = new THREE.Vector2()
  const pointerNow = new THREE.Vector2()

  const pos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const tmp2 = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const viewNow = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
  let viewFrom = null
  let viewTo = null
  let viewLift = 0

  function placeCamera(place) {
    const c = place.camera
    if (place.path.spots && viewTo) {
      const k = clamp01(spotMix.value)
      pos.lerpVectors(viewFrom.pos, viewTo.pos, k)
      look.lerpVectors(viewFrom.look, viewTo.look, k)
      pos.y += Math.sin(Math.PI * k) * viewLift
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
    // a breath of parallax with the pointer
    c.rotateOnWorldAxis(yAxis, yaw.value - pointerNow.x * 0.025)
    c.rotateX(pointerNow.y * 0.015)
  }

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
    sunInfo.strength = k * (w.light?.night ? 0.12 : 1) * reveal.value
    sunInfo.color.setHex(w.light?.sunColor ?? 0xffffff)
    return sunInfo
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
  }
  resize()

  let raf = 0
  let running = false
  function frame(once) {
    if (once !== true) raf = requestAnimationFrame(frame)
    if (lost) return
    const time = performance.now() / 1000
    for (const t of [u, yaw, orbit, spotMix, reveal]) t.update(time)
    pointerNow.lerp(pointer, 0.05)
    post.uniforms.uReveal.value = reveal.value
    if (current && reveal.value > 0.001) {
      current.update?.(time)
      current.world?.tick?.(time)
      placeCamera(current)
      post.render(current.scene, current.camera, {
        time,
        exposure: current.world?.exposure ?? 1,
        sun: sunOnScreen(current),
      })
    } else {
      renderer.setRenderTarget(null)
      renderer.clear()
    }
  }

  function applyGrade(place) {
    const g = place.grade || { tint: [1, 1, 1], saturation: 1 }
    post.uniforms.uTint.value.set(g.tint[0], g.tint[1], g.tint[2])
    post.uniforms.uSaturation.value = g.saturation
  }

  let journey = 0

  return {
    /** Develop the place out of the dark while the view glides to the first spot. */
    async enter(item) {
      const id = ++journey
      onPhase?.('loading')
      if (reveal.value > 0) await reveal.to(0, 0.5, easeInOutSine)
      const place = await ensure(item)
      if (id !== journey) return false
      current = place
      applyGrade(place)
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
      onPhase?.('arriving')
      u.to(1, 4.8, easeOutCubic)
      await reveal.to(1, 2.6, easeInOutSine)
      if (id !== journey) return false
      onPhase?.('arrived')
      return true
    },
    /** Photo i: a new viewpoint in the place. */
    photo(i) {
      return goToSpot(i, 3.8)
    },
    /** The place sinks back into the dark. */
    async leave() {
      const id = ++journey
      onPhase?.('leaving')
      await reveal.to(0, 1.1, easeInOutSine)
      if (id !== journey) return
      onPhase?.('left')
    },
    setPointer(x, y) {
      pointer.set(x, y)
    },
    preload(p) {
      return ensure(p).catch(() => {})
    },
    resize,
    /** Draw one frame now (tests, thumbnails). */
    renderOnce() {
      frame(true)
    },
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
      pmrem.dispose()
      post.dispose()
      renderer.dispose()
    },
  }
}
