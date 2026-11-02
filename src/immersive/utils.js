/**
 * Small, dependency-free helpers shared by the 3D scenes: seeded randomness,
 * smooth noise, easing, and canvas-painted textures. Everything is procedural
 * so the site ships no texture files and every scene stays editable in code.
 */

/* --- randomness ------------------------------------------------------- */

/** Deterministic random (mulberry32) — the same scene every visit. */
export function seeded(seed = 1) {
  let a = seed >>> 0
  return function rand() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const range = (rand, a, b) => a + (b - a) * rand()
export const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length]

/* --- noise ------------------------------------------------------------ */

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const fade = (t) => t * t * (3 - 2 * t)

/** Smooth value noise in [0, 1]. */
export function noise2(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  const u = fade(xf)
  const v = fade(yf)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Fractal noise in roughly [0, 1]. */
export function fbm(x, y, octaves = 5) {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq)
    norm += amp
    amp *= 0.5
    freq *= 2.03
  }
  return sum / norm
}

/** Ridged noise — sharp crests, soft troughs. Good for dunes and swell. */
export function ridged(x, y, octaves = 4) {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * freq, y * freq) * 2 - 1)
    sum += amp * n * n
    norm += amp
    amp *= 0.5
    freq *= 2.1
  }
  return sum / norm
}

/* --- easing ----------------------------------------------------------- */

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a, b, t) => a + (b - a) * t
/** Remap v from [a, b] to [0, 1], clamped. */
export const span = (v, a, b) => clamp01((v - a) / (b - a))
export const smooth = (t) => t * t * (3 - 2 * t)
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeInCubic = (t) => t * t * t
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2

/* --- canvas textures -------------------------------------------------- */

function makeCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/**
 * Paint a texture with a 2D canvas.
 * kind: 'color' (sRGB) or 'data' (linear — roughness, bump, normal).
 */
export function paintTexture(THREE, w, h, draw, { kind = 'color', repeat = [1, 1], anisotropy = 8 } = {}) {
  const canvas = makeCanvas(w, h)
  const g = canvas.getContext('2d')
  draw(g, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat[0], repeat[1])
  tex.anisotropy = anisotropy
  if (kind === 'color') tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Sprinkle fine grain over a canvas so flat colour reads as a material. */
export function grain(g, w, h, amount = 18, seed = 7, alpha = 1) {
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  const rand = seeded(seed)
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount * alpha
    d[i] = Math.max(0, Math.min(255, d[i] + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
  }
  g.putImageData(img, 0, 0)
}

/** Large, soft blotches — weathering, damp patches, uneven render. */
export function blotches(g, w, h, { color = 'rgba(0,0,0,0.06)', count = 40, seed = 3, size = 0.25 } = {}) {
  const rand = seeded(seed)
  for (let i = 0; i < count; i++) {
    const x = rand() * w
    const y = rand() * h
    const r = (0.2 + rand()) * size * Math.max(w, h)
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, color)
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
  }
}

/** Value noise whose lattice wraps every `period` cells — tiles seamlessly. */
function periodicNoise(x, y, px, py) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const w = (v, p) => ((v % p) + p) % p
  const a = hash2(w(xi, px), w(yi, py))
  const b = hash2(w(xi + 1, px), w(yi, py))
  const c = hash2(w(xi, px), w(yi + 1, py))
  const d = hash2(w(xi + 1, px), w(yi + 1, py))
  const u = fade(xf)
  const v = fade(yf)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/**
 * A tileable normal map from fractal noise — ripples on water, grain on
 * stone, texture on rubber grips. `cells` sets the feature size; `stretch`
 * elongates it (e.g. [1, 4] for wind-streaked water).
 */
export function noiseNormalMap(THREE, size = 256, { cells = 8, strength = 2.5, octaves = 4, stretch = [1, 1] } = {}) {
  const heights = new Float32Array(size * size)
  const cx = Math.max(1, Math.round(cells * stretch[0]))
  const cy = Math.max(1, Math.round(cells * stretch[1]))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0
      let amp = 0.5
      let norm = 0
      for (let o = 0; o < octaves; o++) {
        const f = 1 << o
        sum += amp * periodicNoise((x / size) * cx * f, (y / size) * cy * f, cx * f, cy * f)
        norm += amp
        amp *= 0.5
      }
      heights[y * size + x] = sum / norm
    }
  }
  return paintTexture(
    THREE,
    size,
    size,
    (g) => {
      const img = g.createImageData(size, size)
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const l = heights[y * size + ((x - 1 + size) % size)]
          const r = heights[y * size + ((x + 1) % size)]
          const t = heights[((y - 1 + size) % size) * size + x]
          const b = heights[((y + 1) % size) * size + x]
          const nx = (l - r) * strength * size * 0.02
          const ny = (t - b) * strength * size * 0.02
          const len = Math.hypot(nx, ny, 1)
          const i = (y * size + x) * 4
          img.data[i] = ((nx / len) * 0.5 + 0.5) * 255
          img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255
          img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255
          img.data[i + 3] = 255
        }
      }
      g.putImageData(img, 0, 0)
    },
    { kind: 'data' }
  )
}

/* --- geometry helpers ------------------------------------------------- */

/**
 * Collects thin beams (a → b) into one InstancedMesh: lattices, railings,
 * window mullions, bridge cables. One draw call however many beams.
 */
export function beamBatch(THREE) {
  const beams = []
  return {
    add(a, b, thickness = 0.1, depth = thickness) {
      beams.push([a.clone(), b.clone(), thickness, depth])
    },
    build(material, { castShadow = true } = {}) {
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, beams.length))
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      const mid = new THREE.Vector3()
      const dir = new THREE.Vector3()
      const zAxis = new THREE.Vector3(0, 0, 1)
      beams.forEach(([a, b, t, d], i) => {
        dir.subVectors(b, a)
        const len = dir.length() || 0.001
        q.setFromUnitVectors(zAxis, dir.normalize())
        mid.addVectors(a, b).multiplyScalar(0.5)
        s.set(t, d, len)
        m.compose(mid, q, s)
        mesh.setMatrixAt(i, m)
      })
      mesh.count = beams.length
      mesh.castShadow = castShadow
      mesh.receiveShadow = false
      mesh.instanceMatrix.needsUpdate = true
      return mesh
    },
    get size() {
      return beams.length
    },
  }
}

/** Scale a box's UVs so a tiling texture keeps its real-world size. */
export function scaleBoxUVs(geometry, w, h, d, unitW, unitH) {
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z — 4 vertices each
  const uv = geometry.attributes.uv
  const faces = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ]
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = faces[f]
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k
      uv.setXY(i, (uv.getX(i) * fu) / unitW, (uv.getY(i) * fv) / unitH)
    }
  }
  uv.needsUpdate = true
  return geometry
}

/** A soft round sprite texture — lamp glows, bokeh, sun flares. */
export function glowTexture(THREE, inner = 'rgba(255,240,215,1)', size = 128) {
  return paintTexture(
    THREE,
    size,
    size,
    (g, w) => {
      const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
      grd.addColorStop(0, inner)
      grd.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)'))
      grd.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grd
      g.fillRect(0, 0, w, w)
    },
    { kind: 'color' }
  )
}
