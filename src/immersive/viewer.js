/**
 * The 3D viewer behind the journey.
 *
 * It shows one place at a time, rendered as an illustration (style.js +
 * post.js), and moves the camera through it at a slow, cinematic pace —
 * nothing is tied to the page's scroll:
 *
 *   open(place)        travel there: rise into the clouds, cross over, and
 *                      come down into the new place (or fade up, the first time)
 *   viewpoint(i, n)    within a place, glide to the spot for photo i of n —
 *                      browsing a project's photos keeps you in its world
 *   setMode('inside')  step inside: pull back to reveal the place, and let
 *                      the visitor drag to look around
 *
 * Every move is a time-based tween that starts from wherever the camera is,
 * so it can be interrupted and redirected at any moment.
 */
import * as THREE from 'three'
import { loadScene } from './scenes/index.js'
import { stylize } from './style.js'
import { createPost, NO_INK_LAYER } from './post.js'
import { skyFromProject } from './palette.js'
import { easeInOutCubic, easeInOutSine, easeInCubic, clamp01 } from './utils.js'

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
const NIGHT_OR_INDOOR = new Set(['sea', 'waterfront-night', 'party-boat', 'studio', 'interior'])

export async function createViewer({ canvas, quality = 'high', onError, onPhase }) {
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

  function fit(place) {
    const a = size.y ? size.x / size.y : window.innerWidth / window.innerHeight
    place.camera.aspect = a
    place.camera.fov = (place.path.fov || 48) * (a < 0.8 ? 1.35 : 1)
    place.camera.updateProjectionMatrix()
  }

  function ensure(p) {
    const key = keyOf(p)
    if (cache.has(key)) return Promise.resolve(cache.get(key))
    if (pending.has(key)) return pending.get(key)
    const job = (async () => {
      await wait(0.016) // let the page paint before a heavy build
      // night and studio places keep their own sky; the rest follow the photos
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
        if (old !== keyOf(target || {}) && cache.has(old)) {
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

  /* --- camera state ------------------------------------------------------ */

  let current = null // the place on screen
  let target = null // the place being travelled to
  const u = tween(1) // position along the current place's path
  const orbit = tween(0) // sideways swing around the subject, per photo
  const rise = tween(0) // lift into the sky when leaving
  const cloud = tween(0)
  const fade = tween(1)
  let mode = 'pick'
  const lookTarget = new THREE.Vector2()
  const lookNow = new THREE.Vector2()
  const pointer = new THREE.Vector2()
  const pointerNow = new THREE.Vector2()
  let travelling = false

  const pos = new THREE.Vector3()
  const look = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)

  function placeCamera(place, time) {
    const c = place.camera
    const f = clamp01(u.value)
    place.posCurve.getPointAt(f, pos)
    place.lookCurve.getPointAt(f, look)
    // swing around the subject for this photo's viewpoint
    if (Math.abs(orbit.value) > 1e-4) {
      tmp.subVectors(pos, look).applyAxisAngle(yAxis, orbit.value)
      pos.copy(look).add(tmp)
    }
    if (place.anchor) {
      pos.add(place.anchor.position)
      look.add(place.anchor.position)
    }
    // leaving: lift up and tilt toward the sky
    if (rise.value > 0) {
      pos.y += rise.value * 60
      look.y += rise.value * 140
    }
    // a breath of handheld movement
    pos.x += Math.sin(time * 0.37) * 0.04
    pos.y += Math.sin(time * 0.53) * 0.03
    if (place.groundAt) {
      const floor = place.groundAt(pos.x, pos.z) + (place.clearance ?? 1.2)
      if (pos.y < floor) pos.y = floor
    }
    c.position.copy(pos)
    c.lookAt(look)
    // look around: drag when inside, a little pointer parallax otherwise
    const yaw = lookNow.x + pointerNow.x * 0.05
    const pitch = lookNow.y + pointerNow.y * 0.03
    c.rotateOnWorldAxis(yAxis, -yaw)
    c.rotateX(pitch)
  }

  /* --- sizing ------------------------------------------------------------ */

  const size = new THREE.Vector2()
  function resize() {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    renderer.getDrawingBufferSize(size)
    post.setSize(size.x, size.y)
    for (const p of cache.values()) fit(p)
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
    orbit.update(time)
    rise.update(time)
    cloud.update(time)
    fade.update(time)
    lookNow.lerp(lookTarget, 0.08)
    pointerNow.lerp(pointer, 0.05)
    post.uniforms.uCloud.value = cloud.value
    post.uniforms.uFade.value = fade.value

    if (current) {
      current.update?.(time)
      current.world?.tick?.(time)
      placeCamera(current, time)
      post.render(current.scene, current.camera, { time, exposure: current.world?.exposure ?? 1 })
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

  /** Where photo i of n is seen from, along the path and around the subject. */
  function spot(i, n) {
    if (n <= 1) return { u: 1, a: 0 }
    const k = i / (n - 1)
    return { u: 1 - 0.34 * k, a: (i % 2 ? 1 : -1) * Math.min(0.22, 0.05 + 0.17 * k) * (i > 0 ? 1 : 0) }
  }

  let journey = 0 // cancels an older open() if a newer one starts

  /**
   * Travel to a place. Slow on purpose: about six seconds, so each place
   * arrives like a new chapter. Resolves when the camera has settled.
   */
  async function open(p, { photo = 0, photos = 1 } = {}) {
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
    setCloudColours(place)
    rise.set(0)
    orbit.set(0)
    u.set(0)
    onPhase?.('arriving')
    const s = spot(photo, photos)
    cloud.to(0, 2.2, easeInOutSine)
    orbit.to(s.a, 5.2, easeInOutCubic)
    await u.to(s.u, 5.2, easeInOutCubic)
    if (id !== journey) return false
    travelling = false
    onPhase?.('arrived')
    return true
  }

  /** Glide to photo i's viewpoint within the current place. */
  function viewpoint(i, n) {
    if (!current || travelling) return Promise.resolve()
    const s = spot(i, n)
    orbit.to(s.a, 2.2, easeInOutCubic)
    return u.to(s.u, 2.2, easeInOutCubic)
  }

  /** 'pick' — browsing photos; 'inside' — stepped into the place. */
  async function setMode(next, { photo = 0, photos = 1 } = {}) {
    mode = next
    lookTarget.set(0, 0)
    if (!current) return
    if (next === 'inside') {
      // pull back from the photo's exact spot to reveal where it was taken
      const s = spot(photo, photos)
      await u.to(Math.max(0.42, s.u - 0.4), 6.5, easeInOutSine)
    } else {
      const s = spot(photo, photos)
      orbit.to(s.a, 2.6, easeInOutCubic)
      await u.to(s.u, 2.6, easeInOutCubic)
    }
  }

  return {
    open,
    viewpoint,
    setMode,
    /** Fly back to the exact spot the photo was taken from. */
    async returnToMoment(photo, photos) {
      lookTarget.set(0, 0)
      const s = spot(photo, photos)
      orbit.to(s.a, 3.2, easeInOutCubic)
      await u.to(s.u, 3.2, easeInOutCubic)
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
      post.dispose()
      renderer.dispose()
    },
  }
}

