/**
 * The 3D viewer behind the journey.
 *
 * One place at a time, rendered as an illustration (style.js + post.js), with
 * Wilson's camera floating in front of it. The view of the place never wanders:
 * it settles on the spot where the moment was shot and stays there while the
 * visitor flicks through the photos on the camera's screen. It only moves to
 * travel to another place, through the clouds.
 *
 *   open(place)          travel there (or fade up, the first time)
 *   pose('intro'|'review')  the camera floating out in the place, lens toward
 *                        you — or turned round and brought close, its screen
 *                        showing the photos
 *   setMode('inside')    the camera drops away; drag to look around the place
 *
 * The photo itself is not drawn here: every frame, onScreen() reports where the
 * camera's screen is on the page (four corners) and how squarely it faces the
 * visitor, and the journey lays a crisp, accessible <img> over exactly that.
 */
import * as THREE from 'three'
import { loadScene } from './scenes/index.js'
import { stylize } from './style.js'
import { createPost, NO_INK_LAYER } from './post.js'
import { skyFromProject } from './palette.js'
import { buildCameraModel } from './camera-model.js'
import { easeInOutCubic, easeInOutSine, easeInCubic, clamp01, lerp } from './utils.js'

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

export async function createViewer({ canvas, quality = 'high', onError, onPhase, onScreen }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5))
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace // post.js does the display conversion
  renderer.toneMapping = THREE.NoToneMapping // and the tone curve
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

  /* --- the floating camera ------------------------------------------------ */

  // It has its own little scene, drawn over the place with its own depth, so
  // it can sit close to the view without ever cutting into the scenery.
  const rigScene = new THREE.Scene()
  const rigCam = new THREE.PerspectiveCamera(46, 1, 0.05, 60)
  rigCam.layers.enable(NO_INK_LAYER)
  const rig = buildCameraModel(THREE)
  stylize(THREE, rig.group)
  rigScene.add(rig.group)
  const rigHemi = new THREE.HemisphereLight(0xeef1f5, 0x5a5550, 1.1)
  const rigKey = new THREE.DirectionalLight(0xffffff, 1.6) // from over the visitor's shoulder
  rigKey.position.set(-1.2, 1.6, 2.2)
  const rigRim = new THREE.DirectionalLight(0xffffff, 1.4) // the place's sun, from behind
  rigRim.position.set(1.4, 1.1, -2)
  rigScene.add(rigHemi, rigKey, rigRim)
  const overlay = { scene: rigScene, camera: rigCam }

  function lightRig(place) {
    const L = place?.world?.light
    if (!L) return
    rigHemi.color.setHex(L.hemi[0])
    rigHemi.groundColor.setHex(L.hemi[1])
    rigHemi.intensity = 0.6 + L.hemi[2] * 0.5
    rigKey.color.setHex(L.sky.horizon).lerp(new THREE.Color(0xffffff), 0.5)
    rigKey.intensity = L.night ? 0.7 : 1.5
    rigRim.color.setHex(L.sunColor)
    rigRim.intensity = L.night ? 0.8 : 1.3 + L.sunIntensity * 0.25
  }

  /* --- places --------------------------------------------------------- */

  const cache = new Map()
  const pending = new Map()
  const keepMax = quality === 'low' ? 2 : 4
  const order = [] // most recently used last

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
  }

  const size = new THREE.Vector2() // drawing buffer, px
  const css = new THREE.Vector2(1, 1) // canvas, CSS px

  function fovFor(place) {
    const a = css.x / css.y
    return (place?.path?.fov || 48) * (a < 0.8 ? 1.35 : 1)
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
      await wait(0.016) // let the page paint before a heavy build
      // night and indoor places keep their own sky; the rest follow the photos
      ctx.sky = NIGHT_OR_INDOOR.has(p.scene) ? null : await skyFromProject(p)
      const place = await loadScene(p.scene, THREE, ctx)
      ctx.sky = null
      stylize(THREE, place.scene)
      // sprites and anything transparent never get ink lines
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
      // keep memory in check: drop the least recently used
      order.push(key)
      while (order.length > keepMax) {
        const old = order.shift()
        if (old !== keyOf(target || {}) && cache.has(old) && cache.get(old) !== current) {
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

  let current = null // the place on screen
  let target = null // the place being travelled to
  const u = tween(1) // position along the current place's arrival path
  const rise = tween(0) // lift into the sky when leaving
  const cloud = tween(0)
  const fade = tween(1)
  const pose = tween(0) // 0: floating out in the place, lens to you; 1: close, screen to you
  const away = tween(0) // 1: dropped out of view (stepped inside)
  let mode = 'pick'
  const lookTarget = new THREE.Vector2()
  const lookNow = new THREE.Vector2()
  const pointer = new THREE.Vector2()
  const pointerNow = new THREE.Vector2()
  let travelling = false

  const pos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)

  /** The view of the place: still, once arrived. */
  function placeCamera(place) {
    const c = place.camera
    const f = clamp01(u.value)
    place.posCurve.getPointAt(f, pos)
    place.lookCurve.getPointAt(f, look)
    if (place.anchor) {
      pos.add(place.anchor.position)
      look.add(place.anchor.position)
    }
    // leaving: lift up and tilt toward the sky
    if (rise.value > 0) {
      pos.y += rise.value * 60
      look.y += rise.value * 140
    }
    if (place.groundAt) {
      const floor = place.groundAt(pos.x, pos.z) + (place.clearance ?? 1.2)
      if (pos.y < floor) pos.y = floor
    }
    c.position.copy(pos)
    c.lookAt(look)
    // look around — only ever by the visitor's own drag, when inside
    c.rotateOnWorldAxis(yAxis, -lookNow.x)
    c.rotateX(lookNow.y)
    // frame the place's subject beside the floating camera, not behind it:
    // to the left on wide screens, above it on phones (none when inside)
    const k = 1 - away.value
    const wide = css.x / css.y >= 1
    c.setViewOffset(css.x, css.y, wide ? css.x * 0.17 * k : 0, wide ? 0 : css.y * 0.26 * k, css.x, css.y)
  }

  /* --- where the floating camera sits on the page ------------------------ */

  // The camera model's screen, in its own space (see camera-model.js)
  const S = rig.screen
  const hump = 0.7 // from the screen's centre up to the top of the viewfinder
  const below = 0.31 // from the screen's centre down to the base

  /** Screen centre (px), size (px per model unit), distance and angles for a pose. */
  function layout(which) {
    const W = css.x
    const H = css.y
    const wide = W / H >= 1
    if (which === 'review') {
      if (wide) {
        const lcdH = Math.min(0.4 * H, (0.46 * W) / 1.5)
        const ppu = lcdH / (S.halfH * 2)
        const cy = Math.min(Math.max(0.5 * H, 0.09 * H + hump * ppu), H - below * ppu - 0.04 * H)
        return { cx: W * (W > 1100 ? 0.56 : 0.5), cy, ppu, d: 2.2, yaw: Math.PI, pitch: 0 }
      }
      const lcdW = Math.min(0.84 * W, 0.3 * H * 1.5)
      const ppu = lcdW / (S.halfW * 2)
      return { cx: W / 2, cy: Math.min(0.6 * H, H - 0.27 * H - below * ppu), ppu, d: 2.2, yaw: Math.PI, pitch: 0 }
    }
    // intro: further out in the place, three-quarters on, lens toward you
    const ref = layout('review')
    return wide
      ? { cx: W * 0.64, cy: H * 0.44, ppu: ref.ppu * 0.5, d: 5, yaw: 0.6, pitch: 0.16 }
      : { cx: W * 0.5, cy: H * 0.52, ppu: ref.ppu * 0.6, d: 5, yaw: 0.6, pitch: 0.16 }
  }

  const rot = new THREE.Euler(0, 0, 0, 'YXZ')
  const q = new THREE.Quaternion()
  const anchor = new THREE.Vector3()
  const spot = new THREE.Vector3()
  const corner = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const toEye = new THREE.Vector3()
  const quad = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ]
  // the screen's corners as the visitor sees them (from behind the camera,
  // so the model's +X is on the left): TL, TR, BR, BL
  const corners = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ]

  function placeRig(time) {
    const A = layout('intro')
    const B = layout('review')
    const k = easeInOutCubic(clamp01(pose.value))
    const d = lerp(A.d, B.d, k)
    let cx = lerp(A.cx, B.cx, k)
    let cy = lerp(A.cy, B.cy, k)
    const ppu = lerp(A.ppu, B.ppu, k)
    // floating: a slow drift, and a lean toward the pointer
    cy += Math.sin(time * 0.9) * css.y * 0.004 + away.value * css.y * 1.05
    cx += Math.sin(time * 0.37) * css.x * 0.002
    const yaw = lerp(A.yaw, B.yaw, k) + Math.sin(time * 0.45) * 0.02 + pointerNow.x * 0.06
    const pitch = lerp(A.pitch, B.pitch, k) + Math.sin(time * 0.6) * 0.012 - pointerNow.y * 0.045 - away.value * 0.3
    const roll = Math.sin(time * 0.31) * 0.008

    const tanY = Math.tan(THREE.MathUtils.degToRad(rigCam.fov / 2))
    const hh = d * tanY
    const hw = hh * rigCam.aspect
    const s = (ppu * 2 * hh) / css.y // model units → world units at distance d

    rot.set(pitch, yaw, roll)
    q.setFromEuler(rot)
    rig.group.quaternion.copy(q)
    rig.group.scale.setScalar(s)
    // put the screen's centre exactly at (cx, cy), at distance d
    anchor.set((cx / css.x) * 2 - 1, -((cy / css.y) * 2 - 1), 0)
    spot.set(anchor.x * hw, anchor.y * hh, -d)
    corner.copy(S.center).multiplyScalar(s).applyQuaternion(q)
    rig.group.position.copy(spot).sub(corner)

    if (!onScreen) return
    rig.group.updateMatrixWorld()
    for (let i = 0; i < 4; i++) {
      corner.set(S.center.x + corners[i][0] * S.halfW, S.center.y + corners[i][1] * S.halfH, S.center.z)
      rig.group.localToWorld(corner)
      corner.project(rigCam)
      quad[i][0] = (corner.x * 0.5 + 0.5) * css.x
      quad[i][1] = (-corner.y * 0.5 + 0.5) * css.y
    }
    normal.set(0, 0, -1).applyQuaternion(q)
    toEye.copy(spot).negate().normalize()
    const facing = normal.dot(toEye)
    onScreen({ quad, facing, cloud: Math.max(cloud.value, fade.value), away: away.value })
  }

  /* --- sizing ------------------------------------------------------------ */

  function resize() {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    css.set(w, h)
    renderer.setSize(w, h, false)
    renderer.getDrawingBufferSize(size)
    post.setSize(size.x, size.y)
    for (const p of cache.values()) fit(p)
    rigCam.aspect = w / h
    rigCam.fov = fovFor(current)
    rigCam.updateProjectionMatrix()
  }
  resize()

  /* --- render loop ------------------------------------------------------- */

  let raf = 0
  let running = false
  function frame() {
    raf = requestAnimationFrame(frame)
    if (lost) return
    const time = performance.now() / 1000
    u.update(time)
    rise.update(time)
    cloud.update(time)
    fade.update(time)
    pose.update(time)
    away.update(time)
    lookNow.lerp(lookTarget, 0.08)
    pointerNow.lerp(pointer, 0.05)
    post.uniforms.uCloud.value = cloud.value
    post.uniforms.uFade.value = fade.value

    placeRig(time)
    if (current) {
      current.update?.(time)
      current.world?.tick?.(time)
      placeCamera(current)
      post.render(current.scene, current.camera, {
        time,
        exposure: current.world?.exposure ?? 1,
        overlay: away.value < 0.999 ? overlay : null,
      })
    } else {
      post.renderClouds(time)
    }
  }

  /* --- the journey -------------------------------------------------------- */

  function setCloudColours(place) {
    const s = place?.world?.light?.sky
    if (!s) return
    post.uniforms.uCloudLit.value.setHex(s.cloudLit)
    post.uniforms.uCloudShade.value.setHex(s.cloudShade)
  }

  let journey = 0 // cancels an older open() if a newer one starts

  /**
   * Travel to a place: up into the clouds, across, and down to the spot the
   * moment was shot from. Slow on purpose, so each place arrives like a new
   * chapter. Resolves when the view has settled.
   */
  async function open(p) {
    const id = ++journey
    target = p
    travelling = true
    const first = !current
    const loading = ensure(p)
    if (first) {
      onPhase?.('loading')
      cloud.set(1)
      fade.set(0)
    } else {
      onPhase?.('leaving')
      setCloudColours(current)
      lookTarget.set(0, 0)
      await Promise.all([rise.to(1, 1.8, easeInCubic), cloud.to(1, 1.6, easeInOutSine)])
      if (id !== journey) return false
      onPhase?.('loading')
    }
    const place = await loading
    if (id !== journey) return false
    current = place
    rigCam.fov = fovFor(place)
    rigCam.updateProjectionMatrix()
    lightRig(place)
    setCloudColours(place)
    rise.set(0)
    u.set(0)
    onPhase?.('arriving')
    cloud.to(0, 2.2, easeInOutSine)
    await u.to(1, 5.2, easeInOutCubic)
    if (id !== journey) return false
    travelling = false
    onPhase?.('arrived')
    return true
  }

  return {
    open,
    /** Float the camera out in the place ('intro') or bring it close, screen first ('review'). */
    pose(which, seconds = 2.6) {
      const v = which === 'review' ? 1 : 0
      if (seconds <= 0) {
        pose.set(v)
        return Promise.resolve()
      }
      return pose.to(v, seconds, easeInOutSine)
    },
    /** 'pick' — browsing on the camera; 'inside' — the camera drops away, look around. */
    async setMode(next) {
      mode = next
      lookTarget.set(0, 0)
      if (next === 'inside') await away.to(1, 1.4, easeInCubic)
      else await away.to(0, 1.6, easeInOutCubic)
    },
    /** Turn back to the moment and raise the camera again. */
    async returnToMoment() {
      lookTarget.set(0, 0)
      await wait(0.9)
      await away.to(0, 1.4, easeInOutCubic)
    },
    /** Drag to look around (inside), in pixels moved. */
    drag(dx, dy) {
      if (mode !== 'inside') return
      lookTarget.x = Math.max(-0.9, Math.min(0.9, lookTarget.x + dx * 0.004))
      lookTarget.y = Math.max(-0.35, Math.min(0.35, lookTarget.y - dy * 0.003))
    },
    setPointer(x, y) {
      pointer.set(x, y)
    },
    preload(p) {
      return ensure(p).catch(() => {})
    },
    get travelling() {
      return travelling
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
      free({ scene: rigScene })
      post.dispose()
      renderer.dispose()
    },
  }
}
