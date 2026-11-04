/**
 * Photo-based 3D: the photograph itself becomes the place.
 *
 * Each photo is laid on a finely divided sheet that is pushed back by its
 * depth map, so as the camera drifts the near things move against the far
 * ones — the same view the photo was taken from, in depth. The photo keeps
 * its own colours (no tone mapping, no filters) and its full resolution.
 *
 * Depth maps: /photos/depth/<name>.png (white = near), made automatically
 * for every photo by a GitHub Action (.github/workflows/depth-maps.yml).
 * Where a map doesn't exist yet, a simple one is worked out in the browser
 * from the photo (sky far, ground near, soft detail), so every photo works
 * at once.
 *
 * Portrait photos on a wide screen: the whole photo stays in view (never
 * cropped) and a soft, dark, wide copy of it fills the sides, in depth too.
 */
import * as THREE from 'three'

const GRID = 220 // vertices across the long side

const VERT = /* glsl */ `
  uniform sampler2D tDepth;
  uniform float uDepth;      // how far "far" is pushed back
  uniform float uReveal;     // 0 → 1 as the photo arrives
  uniform float uOut;        // 0 → 1 as the photo leaves
  uniform float uDir;
  varying vec2 vUv;
  varying float vD;
  void main() {
    vUv = uv;
    float d = texture2D(tDepth, uv).r;   // 1 near, 0 far
    vD = d;
    vec3 p = position;
    p.z -= (1.0 - d) * uDepth;
    // leaving: the near things lift and drift first, like a gust through the scene
    p.x -= uDir * uOut * (0.25 + d * 0.9);
    p.y += uOut * d * 0.18;
    p.z += uOut * d * 0.6;
    // arriving: the scene settles from a little depth
    p.z -= (1.0 - uReveal) * (0.4 + (1.0 - d) * 0.4);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`
const FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform float uReveal;
  uniform float uOut;
  uniform float uBlur;      // >0 for the soft surround
  uniform float uDim;
  uniform float uFeather;   // soft edges, so the photo melts into its surround
  varying vec2 vUv;
  varying float vD;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  // smooth value noise: soft, organic patches (never blocks)
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec4 c = uBlur > 0.0 ? texture2D(tColor, vUv, uBlur) : texture2D(tColor, vUv);
    c.rgb *= uDim;
    // arrive far-to-near, leave near-to-far, through soft drifting patches
    float n = (vnoise(vUv * 6.0) * 0.65 + vnoise(vUv * 14.0) * 0.35) * 0.35;
    float inA = smoothstep(0.0, 0.45, uReveal * 1.6 - (vD * 0.5 + n));
    float outA = 1.0 - smoothstep(0.0, 0.45, uOut * 1.6 - ((1.0 - vD) * 0.5 + n));
    float edge = 1.0;
    if (uFeather > 0.0) {
      vec2 e = min(vUv, 1.0 - vUv);
      edge = smoothstep(0.0, uFeather, e.x) * smoothstep(0.0, uFeather, e.y);
    }
    gl_FragColor = vec4(c.rgb, c.a * inA * outA * edge);
  }
`

/** A simple depth guess from the photo itself: sky far, ground near, edges kept. */
function guessDepth(img) {
  const W = 192
  const H = Math.max(2, Math.round((W * img.naturalHeight) / img.naturalWidth))
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0, W, H)
  const px = g.getImageData(0, 0, W, H).data
  const d = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const fy = y / (H - 1)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const r = px[i] / 255
      const gg = px[i + 1] / 255
      const b = px[i + 2] / 255
      const l = 0.3 * r + 0.59 * gg + 0.11 * b
      const sat = Math.max(r, gg, b) - Math.min(r, gg, b)
      // sky: bright, low-saturation or blue, in the upper part
      const sky = Math.min(1, Math.max(0, (l - 0.55) * 3) * (b >= r - 0.02 ? 1 : 0.4) * (sat < 0.35 ? 1 : 0.3)) * Math.max(0, 1 - fy * 1.6)
      // the ground comes toward the camera at the bottom
      let v = 0.18 + 0.72 * Math.pow(fy, 1.25)
      // the middle band (where people usually are) a little nearer
      v += 0.12 * Math.exp(-Math.pow((x / W - 0.5) * 2.2, 2)) * Math.exp(-Math.pow((fy - 0.6) * 2.4, 2))
      d[y * W + x] = Math.min(1, Math.max(0, v * (1 - sky * 0.95)))
    }
  }
  // soften: a few box-blur passes, edge-aware by luminance
  const tmp = new Float32Array(W * H)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0
        let n = 0
        for (let k = -2; k <= 2; k++) {
          const xx = Math.min(W - 1, Math.max(0, x + k))
          s += d[y * W + xx]
          n++
        }
        tmp[y * W + x] = s / n
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0
        let n = 0
        for (let k = -2; k <= 2; k++) {
          const yy = Math.min(H - 1, Math.max(0, y + k))
          s += tmp[yy * W + x]
          n++
        }
        d[y * W + x] = s / n
      }
  }
  // data textures start at the bottom row
  const data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = Math.round(d[y * W + x] * 255)
      const o = ((H - 1 - y) * W + x) * 4
      data[o] = data[o + 1] = data[o + 2] = v
      data[o + 3] = 255
    }
  const t = new THREE.DataTexture(data, W, H)
  t.magFilter = t.minFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

function depthUrl(src) {
  const name = src.split('/').pop().replace(/\.[a-z]+$/i, '')
  return src.replace(/[^/]+$/, `depth/${name}.png`)
}

/**
 * surround: true — the photo is the whole scene (a soft wide copy fills any
 *   space around it); false — a transparent canvas, the photo floats in the
 *   place behind it (hybrid).
 * box(aspect) — optional: where the photo sits on screen (CSS px), else as
 *   large as fits.
 */
export function createPhoto3D({ canvas, quality = 'high', surround = true, box = null }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1.5 : 2))
  renderer.setClearColor(0x0a0a0b, surround ? 1 : 0)
  const maxAniso = renderer.capabilities.getMaxAnisotropy()

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50)
  const DIST = 4 // camera to the photo's plane
  camera.position.set(0, 0, DIST)

  const loader = new THREE.TextureLoader()
  const cache = new Map() // src → Promise<{ color, depth, aspect }>
  function load(src) {
    if (cache.has(src)) return cache.get(src)
    const job = new Promise((resolve, reject) => {
      loader.load(
        src,
        (color) => {
          color.colorSpace = THREE.SRGBColorSpace
          color.anisotropy = maxAniso
          color.generateMipmaps = true
          color.minFilter = THREE.LinearMipmapLinearFilter
          const img = color.image
          const aspect = img.naturalWidth / img.naturalHeight
          loader.load(
            depthUrl(src),
            (depth) => {
              depth.colorSpace = THREE.NoColorSpace
              resolve({ color, depth, aspect, real: true })
            },
            undefined,
            () => resolve({ color, depth: guessDepth(img), aspect, real: false })
          )
        },
        undefined,
        reject
      )
    })
    cache.set(src, job)
    return job
  }

  function sheet(tex, w, h, { blur = 0, dim = 1, depth = 0.9, feather = 0 } = {}) {
    const segX = w >= h ? GRID : Math.round((GRID * w) / h)
    const segY = w >= h ? Math.round((GRID * h) / w) : GRID
    const geo = new THREE.PlaneGeometry(w, h, Math.max(2, segX), Math.max(2, segY))
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: tex.color },
        tDepth: { value: tex.depth },
        uDepth: { value: depth },
        uReveal: { value: 0 },
        uOut: { value: 0 },
        uDir: { value: 1 },
        uBlur: { value: blur },
        uDim: { value: dim },
        uFeather: { value: feather },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    })
    return new THREE.Mesh(geo, mat)
  }

  // the size of the visible plane at the photo's distance
  const view = () => {
    const h = 2 * DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    return { w: h * camera.aspect, h }
  }

  let current = null // { group, parts, t0 }
  const leaving = []
  let token = 0

  function build(tex) {
    const v = view()
    const group = new THREE.Group()
    const parts = []
    // the photo, whole, as large as fits (a breath of margin for the drift) —
    // or in the box it's given
    let pw
    let ph
    let oy = 0
    if (box) {
      const W = canvas.clientWidth || window.innerWidth
      const H = canvas.clientHeight || window.innerHeight
      const b = box(tex.aspect)
      pw = (b.width / W) * v.w
      ph = (b.height / H) * v.h
      oy = (0.5 - (b.top + b.height / 2) / H) * v.h
    } else {
      const k = Math.min((v.w * 0.98) / tex.aspect, v.h * 0.98)
      pw = k * tex.aspect
      ph = k
    }
    group.position.y = oy
    const fillsScreen = pw >= v.w * 0.9 && ph >= v.h * 0.9
    // around a photo that doesn't fill the screen: a soft, dark, wide copy of it
    if (surround && !fillsScreen) {
      const s = Math.max(v.w / pw, v.h / ph) * 1.45
      const bg = sheet(tex, pw * s, ph * s, { blur: 6, dim: 0.4, depth: 0.25 })
      bg.position.z = -0.8
      bg.renderOrder = 0
      group.add(bg)
      parts.push(bg)
    } else if (surround) {
      // a full-screen photo gets a little extra so the drift never shows an edge
      group.scale.setScalar(1.06)
    }
    const fg = sheet(tex, pw, ph, { depth: box ? 0.5 : 0.9, feather: surround && !fillsScreen ? 0.06 : 0 })
    fg.renderOrder = 1
    group.add(fg)
    parts.push(fg)
    return { group, parts }
  }

  /** Show a photo: dir +1 forward, -1 back. Resolves once it has arrived. */
  async function show(src, dir = 1) {
    const id = ++token
    const tex = await load(src)
    if (id !== token) return
    if (current) {
      const old = current
      old.out = { t0: performance.now(), dir }
      leaving.push(old)
      current = null
    }
    const next = build(tex)
    next.t0 = performance.now()
    next.dir = dir
    next.parts.forEach((m) => (m.material.uniforms.uDir.value = dir))
    scene.add(next.group)
    current = next
  }

  function preload(src) {
    load(src).catch(() => {})
  }

  const pointer = new THREE.Vector2()
  const pointerNow = new THREE.Vector2()
  function setPointer(x, y) {
    pointer.set(x, y)
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()

  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)
  let raf = 0
  let running = false
  function frame() {
    if (running) raf = requestAnimationFrame(frame)
    const now = performance.now()
    pointerNow.lerp(pointer, 0.05)
    // the camera drifts slowly into the photo and sways a little — you're there
    if (current) {
      const t = (now - current.t0) / 1000
      const r = ease(t / 1.6)
      current.parts.forEach((m) => (m.material.uniforms.uReveal.value = r))
      const drift = Math.min(1, t / 14)
      camera.position.set(
        Math.sin(t * 0.21) * 0.07 + pointerNow.x * 0.12,
        Math.sin(t * 0.17 + 1) * 0.045 + pointerNow.y * 0.07,
        DIST - 0.32 * drift
      )
      camera.lookAt(pointerNow.x * 0.05, pointerNow.y * 0.03, 0)
    }
    for (let i = leaving.length - 1; i >= 0; i--) {
      const o = leaving[i]
      const k = Math.min(1, (now - o.out.t0) / 1000 / 0.9)
      o.parts.forEach((m) => (m.material.uniforms.uOut.value = k))
      if (k >= 1) {
        scene.remove(o.group)
        o.parts.forEach((m) => {
          m.geometry.dispose()
          m.material.dispose()
        })
        leaving.splice(i, 1)
      }
    }
    renderer.render(scene, camera)
  }

  return {
    show,
    preload,
    setPointer,
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
    clear() {
      token++
      if (current) {
        current.out = { t0: performance.now(), dir: 1 }
        leaving.push(current)
        current = null
      }
    },
    dispose() {
      running = false
      cancelAnimationFrame(raf)
      for (const p of cache.values()) p.then((t) => (t.color.dispose(), t.depth.dispose())).catch(() => {})
      renderer.dispose()
    },
  }
}
