/**
 * The renderer behind the immersive experience.
 *
 * Two worlds share one canvas:
 *  - the studio: the camera body floating in the dark, lit like a product shot
 *  - the place: the location of the current project
 *
 * The trick that joins them is the lens. Its front element is drawn with a
 * "portal" material that shows the place, rendered from the place's own
 * camera, in screen space. As you move into the lens the glass grows until it
 * fills the screen; at that moment the engine stops drawing the studio and
 * draws the place directly. Same camera, same pixels — there's no seam.
 *
 * Driven entirely by setProgress(p) from the page's scroll; the timeline in
 * timeline.js turns that into what to show.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { buildCameraModel } from './camera-model.js'
import { loadScene } from './scenes/index.js'
import { timeline, BEAT } from './timeline.js'
import { easeInOutCubic, easeInCubic, easeInOutSine, lerp, span, paintTexture } from './utils.js'

const MODEL_Y = 1.1

function portalMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uLens: { value: 0 }, // 0 = seen from afar, 1 = filling the screen
      // The render target holds the place un-tone-mapped; the studio is drawn
      // at exposure 1, so scale by the place's own exposure here to match the
      // direct render exactly at the hand-over.
      uExposure: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene;
      uniform vec2 uRes;
      uniform float uLens;
      uniform float uExposure;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        // from afar the image sits deep in the glass: darker, a little
        // vignetted toward the rim like looking into a real lens
        float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
        float rim = pow(1.0 - facing, 1.6);
        float depth = mix(0.42, 1.0, uLens);
        vec3 c = texture2D(tScene, uv).rgb * depth * uExposure;
        c *= mix(1.0 - rim * 0.9, 1.0, uLens);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

function studioFloor() {
  const tex = paintTexture(
    THREE,
    512,
    512,
    (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
      grd.addColorStop(0, '#2a2a2d')
      grd.addColorStop(0.55, '#121214')
      grd.addColorStop(1, '#060607')
      g.fillStyle = grd
      g.fillRect(0, 0, w, h)
    },
    { kind: 'color', repeat: [1, 1] }
  )
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.0 })
  )
  m.rotation.x = -Math.PI / 2
  m.receiveShadow = true
  return m
}

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {{ scene: string }[]} o.chapters
 * @param {'high'|'low'} o.quality
 * @param {AbortSignal} [o.signal] abort while loading → resolves to null
 * @param {(fraction: number) => void} [o.onLoad] loading progress 0..1
 * @param {(state: object) => void} [o.onFrame] called every rendered frame
 * @param {(err: Error) => void} [o.onError]
 */
export async function createEngine({ canvas, chapters, quality = 'high', signal, onLoad, onFrame, onError }) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality !== 'low',
    powerPreference: 'high-performance',
    alpha: false,
  })
  const dprCap = quality === 'low' ? 1.25 : 1.75
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setClearColor(0x050506, 1)

  // declared up front: disposeAll() can run before the render loop exists
  let raf = 0
  let running = false
  let last = null
  let lost = false
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    lost = true
    onError?.(new Error('WebGL context lost'))
  })

  const pmrem = new THREE.PMREMGenerator(renderer)
  const ctx = { pmrem, quality }

  /* --- the studio ----------------------------------------------------- */

  const studio = new THREE.Scene()
  studio.background = new THREE.Color(0x050506)
  const room = new RoomEnvironment()
  const roomEnv = pmrem.fromScene(room, 0.04)
  room.dispose()
  studio.environment = roomEnv.texture
  studio.environmentIntensity = 0.55

  const key = new THREE.DirectionalLight(0xfff3e6, 2.4)
  key.position.set(-3.5, 5, 4.5)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.camera.left = key.shadow.camera.bottom = -3
  key.shadow.camera.right = key.shadow.camera.top = 3
  key.shadow.bias = -0.0005
  key.shadow.normalBias = 0.02
  studio.add(key)
  // two rim lights from behind, warm and cool, to draw the silhouette
  const rimWarm = new THREE.SpotLight(0xffb27a, 40, 20, 0.6, 0.9)
  rimWarm.position.set(4, 3.5, -3.5)
  rimWarm.target.position.set(0, MODEL_Y, 0)
  const rimCool = new THREE.SpotLight(0x9fc2ff, 30, 20, 0.6, 0.9)
  rimCool.position.set(-4.5, 2.5, -3)
  rimCool.target.position.set(0, MODEL_Y, 0)
  studio.add(rimWarm, rimWarm.target, rimCool, rimCool.target)
  studio.add(studioFloor())

  const cam = buildCameraModel(THREE)
  cam.group.position.y = MODEL_Y
  studio.add(cam.group)

  const studioCamera = new THREE.PerspectiveCamera(30, 1, 0.01, 60)

  /* --- the portal ------------------------------------------------------ */

  const rt = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    samples: quality === 'low' ? 0 : 4,
  })
  const portal = portalMaterial(rt.texture)
  cam.glass.material = portal
  const lensWorld = new THREE.Vector3()
  const size = new THREE.Vector2() // drawing-buffer size
  let rtScale = 0 // the render target runs at half size until the lens is close

  function sizeRT(scale) {
    if (scale === rtScale) return
    rtScale = scale
    rt.setSize(Math.max(2, Math.round(size.x * scale)), Math.max(2, Math.round(size.y * scale)))
  }

  /* --- the places --------------------------------------------------------
     Built on demand. Phones keep only the current chapter and its
     neighbours in memory; everything else is disposed and rebuilt if the
     visitor scrolls back. */

  const keys = chapters.map((c) => c.scene)
  const cache = new Map() // scene key → place
  const pending = new Map() // scene key → Promise
  const keepAll = quality !== 'low'

  function freeObject(o, seen = new Set()) {
    o.traverse((n) => {
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
  }

  function aspect() {
    return size.y ? size.x / size.y : window.innerWidth / window.innerHeight
  }

  function fitPlaceCamera(p) {
    const a = aspect()
    p.camera.aspect = a
    // keep the photograph's framing on portrait screens with a wider lens
    p.camera.fov = (p.path.fov || 48) * (a < 0.8 ? 1.35 : 1)
    p.camera.updateProjectionMatrix()
  }

  function ensure(key) {
    if (cache.has(key)) return Promise.resolve(cache.get(key))
    if (pending.has(key)) return pending.get(key)
    const job = (async () => {
      // yield to the browser before a heavy build so the page stays responsive
      await new Promise((r) => setTimeout(r, 16))
      const place = await loadScene(key, THREE, ctx)
      place.posCurve = new THREE.CatmullRomCurve3(place.path.positions, false, 'centripetal')
      place.lookCurve = new THREE.CatmullRomCurve3(place.path.targets, false, 'centripetal')
      place.camera = new THREE.PerspectiveCamera(place.path.fov || 48, 1, place.path.near ?? 0.3, 20000)
      fitPlaceCamera(place)
      // compile both variants now — direct to screen (tone-mapped) and into
      // the portal's render target (linear) — instead of stuttering later
      renderer.compile(place.scene, place.camera)
      renderer.setRenderTarget(rt)
      renderer.compile(place.scene, place.camera)
      renderer.setRenderTarget(null)
      cache.set(key, place)
      pending.delete(key)
      return place
    })()
    pending.set(key, job)
    job.catch((err) => {
      pending.delete(key)
      onError?.(err)
    })
    return job
  }

  function release(key) {
    const place = cache.get(key)
    if (!place) return
    cache.delete(key)
    freeObject(place.scene)
    place.world?.dispose?.()
  }

  /** Keep what the visitor is about to see loaded; let go of the rest on phones. */
  let windowFor = -1
  function manage(chapter) {
    if (chapter === windowFor) return
    windowFor = chapter
    const want = new Set([keys[chapter], keys[chapter + 1], keys[chapter - 1]].filter(Boolean))
    // load the current one first, then neighbours
    ensure(keys[chapter])
      .then(() => [...want].forEach((k) => ensure(k).catch(() => {})))
      .catch(() => {})
    if (!keepAll) for (const k of [...cache.keys()]) if (!want.has(k)) release(k)
  }

  /* --- first load: the first chapter, then the studio ---------------------- */

  function resize() {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    renderer.getDrawingBufferSize(size)
    const s = rtScale || 0.5
    rtScale = 0
    sizeRT(s)
    portal.uniforms.uRes.value.copy(size)
    studioCamera.aspect = w / h
    studioCamera.updateProjectionMatrix()
    // narrow screens: pull the studio camera back so the body still fits
    studioCamera.userData.fit = w / h < 0.8 ? 1.55 : w / h < 1.2 ? 1.2 : 1
    for (const p of cache.values()) fitPlaceCamera(p)
  }
  resize()

  onLoad?.(0.15)
  try {
    await ensure(keys[0])
  } catch (err) {
    renderer.dispose()
    throw err
  }
  if (signal?.aborted || lost) {
    disposeAll()
    return null
  }
  onLoad?.(0.85)
  renderer.compile(studio, studioCamera)
  onLoad?.(1)
  // the rest load in the background while the visitor watches the intro
  if (keepAll) keys.reduce((chain, k) => chain.then(() => ensure(k)), Promise.resolve()).catch(() => {})
  else manage(0)

  /* --- per-frame -------------------------------------------------------- */

  let progress = 0
  const pointer = new THREE.Vector2()
  const pointerSmooth = new THREE.Vector2()
  const look = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const far = new THREE.Vector3()
  const near = new THREE.Vector3()

  function placeCamera(place, f, time) {
    const c = place.camera
    place.posCurve.getPointAt(f, c.position)
    place.lookCurve.getPointAt(f, look)
    // a breath of handheld movement and a touch of pointer parallax
    c.position.x += Math.sin(time * 0.37) * 0.04
    c.position.y += Math.sin(time * 0.53) * 0.03
    // never dip into the terrain between path points
    if (place.groundAt) {
      const floor = place.groundAt(c.position.x, c.position.z) + (place.clearance ?? 1.2)
      if (c.position.y < floor) c.position.y = floor
    }
    // offset scaled by distance so it's the same small angle near or far
    const d = c.position.distanceTo(look)
    tmp.set(pointerSmooth.x * d * 0.025, pointerSmooth.y * d * 0.015, 0)
    look.add(tmp)
    c.lookAt(look)
  }

  /** Pose the camera body and the studio camera; returns the body's turn (radians). */
  function studioShot(s, time) {
    const fit = studioCamera.userData.fit || 1
    // the camera body turns to face you during the intro and the body beat,
    // from alternating sides each chapter
    let rotY
    if (s.phase === 'intro') {
      rotY = lerp(-2.2, -0.55, easeInOutCubic(s.intro))
    } else {
      const from = s.chapter % 2 === 0 ? -0.55 : 0.55
      rotY = lerp(from, 0, easeInOutCubic(span(s.t, 0, BEAT.bodyEnd)))
    }
    cam.group.rotation.y = rotY + pointerSmooth.x * 0.18 * (1 - s.lens)
    cam.group.rotation.x = -pointerSmooth.y * 0.08 * (1 - s.lens) + Math.sin(time * 0.6) * 0.01 * (1 - s.lens)
    cam.group.position.y = MODEL_Y + Math.sin(time * 0.8) * 0.012 * (1 - s.lens)
    cam.group.updateMatrixWorld()

    // the lens centre in world space
    lensWorld.copy(cam.lensCenter)
    cam.group.localToWorld(lensWorld)

    const dist = s.phase === 'intro' ? lerp(7.5, 4.8, easeInOutCubic(s.intro)) : 4.8
    far.set(0, MODEL_Y + 0.35, dist * fit)
    near.set(lensWorld.x, lensWorld.y, lensWorld.z + 0.075)
    const k = easeInCubic(s.lens)
    studioCamera.position.lerpVectors(far, near, k)
    look.set(lerp(0, lensWorld.x, k), lerp(MODEL_Y, lensWorld.y, k), lerp(0, lensWorld.z - 1, k))
    studioCamera.lookAt(look)
    studioCamera.fov = lerp(30, 26, k)
    studioCamera.updateProjectionMatrix()

    // fully 'inside' (no darkening, no rim) just before the hand-over at 0.98
    portal.uniforms.uLens.value = span(s.lens, 0.5, 0.97)
    cam.coat.material.opacity = 1 - span(s.lens, 0.5, 0.95)
    return rotY
  }

  function frame() {
    raf = requestAnimationFrame(frame)
    if (lost) return
    // wall-clock seconds: keeps water and grass moving continuously, even across pauses
    const time = performance.now() / 1000
    pointerSmooth.lerp(pointer, 0.06)
    const s = timeline(progress, keys.length)
    if (!keepAll) manage(s.chapter)
    const place = cache.get(keys[s.chapter]) || null
    if (!place) ensure(keys[s.chapter]).catch(() => {})

    if (place) place.update?.(time)

    if (s.mode === 'studio') {
      const rotY = studioShot(s, time)
      // the place, seen through the glass — skipped while the lens faces away
      if (rotY > -1.6) {
        sizeRT(s.lens > 0.6 ? 1 : 0.5)
        renderer.setRenderTarget(rt)
        if (place) {
          placeCamera(place, 0, time)
          renderer.render(place.scene, place.camera)
        } else {
          renderer.clear()
        }
        renderer.setRenderTarget(null)
      }
      // the studio is drawn at exposure 1; the portal carries the place's own
      portal.uniforms.uExposure.value = place?.world?.exposure ?? 0.6
      renderer.toneMappingExposure = 1
      renderer.render(studio, studioCamera)
    } else if (place) {
      renderer.toneMappingExposure = place.world?.exposure ?? 0.6
      const f = easeInOutSine(s.flight)
      placeCamera(place, f, time)
      // after landing, a very slow push in — the moment before the shutter
      if (s.flight >= 1) {
        const push = span(s.t, BEAT.flightEnd, 1) * 0.6
        place.camera.getWorldDirection(tmp)
        place.camera.position.addScaledVector(tmp, push)
      }
      renderer.render(place.scene, place.camera)
    } else {
      // still loading this place: hold on black rather than show the wrong one
      renderer.setRenderTarget(null)
      renderer.clear()
    }

    if (onFrame && (!last || last.chapter !== s.chapter || last.phase !== s.phase || Math.abs(last.t - s.t) > 0.0005)) {
      onFrame(s)
      last = s
    }
  }

  function disposeAll() {
    running = false
    cancelAnimationFrame(raf)
    const seen = new Set()
    freeObject(studio, seen)
    for (const k of [...cache.keys()]) release(k)
    roomEnv.dispose()
    rt.dispose()
    pmrem.dispose()
    renderer.dispose()
  }

  return {
    setProgress(p) {
      progress = p
    },
    setPointer(x, y) {
      pointer.set(x, y)
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
    dispose: disposeAll,
  }
}
