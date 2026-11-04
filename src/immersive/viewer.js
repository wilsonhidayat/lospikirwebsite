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
import { weatherScene } from './weather.js'
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
const NIGHT_OR_INDOOR = new Set(['waterfront-night', 'party-boat', 'studio', 'interior', 'hall', 'blob', 'stadsloket', 'restaurant', 'leidseplein-hotel', 'memories'])
const INDOOR = new Set(['studio', 'interior', 'hall', 'cityhall', 'blob', 'stadsloket', 'restaurant', 'leidseplein-hotel'])
const fract = (v) => v - Math.floor(v)
const ARRIVE_FROM = 0.72 // how far along its arrival path a place starts

export async function createViewer({ canvas, quality = 'high', onError, onPhase }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false })
  // the place sits behind the photo: it never needs the full retina resolution
  const basePR = Math.min(window.devicePixelRatio || 1, quality === 'low' ? 0.85 : 1.25)
  renderer.setPixelRatio(basePR)
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

  const motes = createMotes(THREE, quality)
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
      const neutral = p.scene === 'memories'
      const [sky, grade] = await Promise.all([
        NIGHT_OR_INDOOR.has(p.scene) ? null : skyFromProject(p),
        neutral ? { tint: [1, 1, 1], saturation: 1 } : gradeFromProject(p),
      ])
      ctx.sky = sky
      ctx.memories = p.memories || null
      const place = await loadScene(p.scene, THREE, ctx)
      ctx.sky = null
      ctx.memories = null
      place.grade = grade
      // lived in, not freshly rendered (the memories desk stays clean)
      if (!neutral && quality !== 'low') weatherScene(place.scene, { amount: INDOOR.has(p.scene) ? 0.6 : 1 })
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
  let focusDist = 12
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
    // held by hand: the slightest, slow breathing of the camera
    const ht = performance.now() / 1000
    pos.x += Math.sin(ht * 0.53) * 0.018 + Math.sin(ht * 1.31) * 0.006
    pos.y += Math.sin(ht * 0.71 + 1.3) * 0.014
    c.position.copy(pos)
    c.lookAt(look)
    focusDist = c.position.distanceTo(look)
    // a breath of parallax with the pointer
    c.rotateOnWorldAxis(yAxis, yaw.value - pointerNow.x * 0.025 + Math.sin(ht * 0.37) * 0.0022)
    c.rotateX(pointerNow.y * 0.015 + Math.sin(ht * 0.29 + 2.1) * 0.0016)
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

  /* --- keeping it smooth ------------------------------------------------- *
   * Watch the real frame times. When frames run long, step down — a lower
   * render resolution first, then fewer effects — and step back up when
   * there's room. Smooth beats sharp: the photo on top is what's looked at. */
  const LEVELS = [
    { scale: 1, samples: 4 },
    { scale: 0.85, samples: 2 },
    { scale: 0.72, samples: 0, ao: false },
    { scale: 0.62, samples: 0, ao: false, flat: true },
    { scale: 0.5, samples: 0, ao: false, flat: true, fps: 30 },
  ]
  const full = { ao: post.uniforms.uAO.value, dof: post.uniforms.uDof.value, ca: post.uniforms.uCA.value, soft: post.uniforms.uSoftCorners.value }
  let level = quality === 'low' ? 2 : 1
  let lastT = 0
  let acc = 0
  let count = 0
  let changedAt = 0
  let goodRuns = 0
  function applyLevel() {
    const L = LEVELS[level]
    renderer.setPixelRatio(basePR * L.scale)
    post.setSamples(L.samples)
    post.uniforms.uAO.value = L.ao === false ? 0 : full.ao
    post.uniforms.uDof.value = L.flat ? 0 : full.dof
    post.uniforms.uCA.value = L.flat ? 0 : full.ca
    post.uniforms.uSoftCorners.value = L.flat ? 0 : full.soft
    resize()
  }
  function watch(now) {
    const dt = now - lastT
    lastT = now
    // ignore the moments after a change, a hidden tab, and one-off hitches
    // (a place being built) — but not a machine that's slow all the time
    if (document.hidden || dt > 1.5 || now - changedAt < 1.2) {
      acc = 0
      count = 0
      return
    }
    acc += Math.min(dt, 0.5)
    count++
    if (acc < 1.2 || count < 8) return
    const avg = (acc / count) / (LEVELS[level].fps === 30 ? 2 : 1)
    acc = 0
    count = 0
    if (avg > 1 / 48 && level < LEVELS.length - 1) {
      level++
      goodRuns = 0
      changedAt = now
      applyLevel()
    } else if (avg < 1 / 58 && level > 0) {
      // only climb back after a long smooth stretch
      if (++goodRuns >= 6) {
        level--
        goodRuns = 0
        changedAt = now
        applyLevel()
      }
    } else goodRuns = 0
  }

  applyLevel()

  let raf = 0
  let running = false
  let skip = false
  function frame(once) {
    if (once !== true) raf = requestAnimationFrame(frame)
    if (lost) return
    const time = performance.now() / 1000
    if (once !== true) {
      // at the lowest level, every other frame is enough behind a photo
      if (LEVELS[level].fps === 30 && (skip = !skip)) return
      watch(time)
    }
    for (const t of [u, yaw, orbit, spotMix, reveal]) t.update(time)
    pointerNow.lerp(pointer, 0.05)
    post.uniforms.uReveal.value = reveal.value
    if (current && reveal.value > 0.001) {
      current.update?.(time)
      current.world?.tick?.(time)
      placeCamera(current)
      motes.follow(current, time)
      post.uniforms.uFocus.value = Math.max(4, Math.min(400, focusDist))
      post.render(current.scene, current.camera, {
        time,
        flat: !!LEVELS[level].flat,
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
    async enter(item, spot = 0) {
      const id = ++journey
      onPhase?.('loading')
      if (reveal.value > 0) await reveal.to(0, 0.5, easeInOutSine)
      const place = await ensure(item)
      if (id !== journey) return false
      current = place
      applyGrade(place)
      if (place.path.spots) {
        viewTo = place.path.spots[(spot || 0) % place.path.spots.length]
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
    /** Whether a place is built already (entering it is then instant). */
    has(p) {
      return cache.has(keyOf(p))
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

/**
 * Dust in the air: a few hundred soft motes drifting around the camera,
 * catching the light — the air between you and the place.
 */
function createMotes(THREE, quality) {
  const N = quality === 'low' ? 160 : 380
  const BOX = 9
  const pos = new Float32Array(N * 3)
  const seed = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * BOX
    pos[i * 3 + 1] = (Math.random() - 0.5) * BOX * 0.6
    pos[i * 3 + 2] = (Math.random() - 0.5) * BOX
    seed[i] = Math.random()
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(1, 0.94, 0.84) }, uAmount: { value: 0.5 } },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime; uniform vec3 uCam;
      varying float vA;
      void main() {
        vec3 p = position;
        p += vec3(sin(uTime * 0.13 + seed * 40.0), sin(uTime * 0.09 + seed * 17.0) * 0.6 - uTime * 0.02, cos(uTime * 0.11 + seed * 23.0)) * 0.6;
        // wrap the box around the camera so the dust is always there
        p = uCam + mod(p - uCam + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = clamp(16.0 / d, 1.0, 4.0) * (0.6 + seed);
        vA = smoothstep(0.4, 1.5, d) * (1.0 - smoothstep(3.0, 4.5, d)) * (0.35 + 0.65 * fract(seed * 7.3 + uTime * 0.05));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAmount;
      varying float vA;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(q));
        gl_FragColor = vec4(uColor * a * vA * uAmount, 1.0);
      }`,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = 10
  points.layers.set(2)
  let owner = null
  return {
    follow(place, time) {
      if (owner !== place) {
        points.removeFromParent()
        place.scene.add(points)
        owner = place
        const night = !!place.world?.light?.night
        mat.uniforms.uAmount.value = night ? 0.18 : 0.22
        mat.uniforms.uColor.value.set(night ? 0xffd9a8 : 0xfff2dd)
      }
      mat.uniforms.uTime.value = time
      mat.uniforms.uCam.value.copy(place.camera.position)
    },
  }
}
