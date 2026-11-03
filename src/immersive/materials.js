/**
 * Realistic procedural materials — the shared texture library for every place.
 *
 * Nothing is downloaded: each material is painted on canvases at load time as
 * a full PBR set — colour (albedo), a normal map made from a height field,
 * and roughness (plus metalness for glass, emissive for lit windows) — so
 * brick has relief and mortar lines catch the light, windows reflect the sky
 * (through the place's environment map), wet stone shines, and so on.
 *
 * Everything tiles seamlessly and is sized in real metres: build boxes with
 * `box()` (UVs scaled to the material's tile size) and one material serves
 * every building that looks alike — cheap to draw, quick to load.
 *
 *   const brick = M.brick(THREE, { color: '#7a3a28' })          // 2 m tile
 *   const facade = M.facade(THREE, { wall: 'brick', ... })      // one bay × one storey
 *   scene.add(M.box(THREE, 12, 18, 10, facade.material, facade.tile))
 *
 * Every generator takes a `seed`, so scenes look the same on every visit.
 * Textures are 512 px by default (256 on phones via `quality: 'low'`).
 */
import { seeded, range } from './utils.js'

/* --- canvas plumbing ------------------------------------------------------ */

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** A painter: albedo (colour), height (grey) and roughness (grey) layers. */
function layers(size) {
  const mk = () => {
    const c = makeCanvas(size, size)
    return { c, g: c.getContext('2d', { willReadFrequently: true }) }
  }
  return { size, albedo: mk(), height: mk(), rough: mk() }
}

/** Tileable value noise (wraps every `period` cells). */
function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function pnoise(x, y, p, s = 0) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const w = (v) => ((v % p) + p) % p
  const a = hash(w(xi), w(yi), s)
  const b = hash(w(xi + 1), w(yi), s)
  const c = hash(w(xi), w(yi + 1), s)
  const d = hash(w(xi + 1), w(yi + 1), s)
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
/** Tileable fractal noise over a size×size canvas: base period `cells`. */
function fbmField(size, cells, octaves, seed) {
  const f = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0
      let a = 0.5
      let p = cells
      for (let o = 0; o < octaves; o++) {
        s += a * pnoise((x / size) * p, (y / size) * p, p, seed + o * 17)
        a *= 0.5
        p *= 2
      }
      f[y * size + x] = s
    }
  }
  return f
}

/** Add a noise field to a canvas layer: colour variation, grit, wear. */
function speckle(layer, field, amount, { tint = [1, 1, 1], offset = 0.5 } = {}) {
  const { c, g } = layer
  const img = g.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const n = (field[j] - offset) * amount
    d[i] = Math.max(0, Math.min(255, d[i] + n * tint[0]))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * tint[1]))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * tint[2]))
  }
  g.putImageData(img, 0, 0)
}

/** Turn a height canvas into a tangent-space normal map (Sobel). */
function normalFromHeight(THREE, heightCanvas, strength = 2) {
  const w = heightCanvas.width
  const h = heightCanvas.height
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data
  const H = (x, y) => src[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * strength
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * strength
      const nx = -dx
      const ny = dy // canvas y runs down; texture v runs up
      const nz = 1
      const l = Math.hypot(nx, ny, nz)
      const i = (y * w + x) * 4
      out[i] = ((nx / l) * 0.5 + 0.5) * 255
      out[i + 1] = ((ny / l) * 0.5 + 0.5) * 255
      out[i + 2] = ((nz / l) * 0.5 + 0.5) * 255
      out[i + 3] = 255
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

function toTexture(THREE, canvas, srgb, anisotropy = 8) {
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = anisotropy
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/**
 * Wrap painted layers up as a MeshStandardMaterial.
 * extra: { metal: canvas (grey = metalness), emissive: canvas, emissiveIntensity, ...material params }
 */
function finish(THREE, L, { normal = 2, metal = null, emissive = null, emissiveIntensity = 1, envMapIntensity = 1, ...params } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: toTexture(THREE, L.albedo.c, true),
    normalMap: normalFromHeight(THREE, L.height.c, normal),
    roughnessMap: toTexture(THREE, L.rough.c, false),
    roughness: 1,
    metalness: metal ? 1 : 0,
    metalnessMap: metal ? toTexture(THREE, metal, false) : null,
    envMapIntensity,
    ...params,
  })
  if (emissive) {
    mat.emissiveMap = toTexture(THREE, emissive, true)
    mat.emissive = new THREE.Color(0xffffff)
    mat.emissiveIntensity = emissiveIntensity
  }
  return mat
}

const fill = (layer, color) => {
  layer.g.fillStyle = color
  layer.g.fillRect(0, 0, layer.c.width, layer.c.height)
}
const grey = (v) => `rgb(${v},${v},${v})`
const sizeFor = (quality) => (quality === 'low' ? 256 : 512)

/* --- surfaces ------------------------------------------------------------- */

/**
 * Brick in running bond: every brick its own shade, recessed mortar, soot and
 * weathering. tile = metres the texture covers (square).
 */
export function brick(THREE, { color = '#7a3a28', mortar = '#a89a88', variation = 0.22, dirt = 0.18, tile = 2, quality, seed = 1 } = {}) {
  const S = sizeFor(quality)
  const L = layers(S)
  const rand = seeded(seed)
  const rows = Math.round(tile / 0.075) // a course every 7.5 cm
  const cols = Math.round(tile / 0.22) // bricks 21 cm + joint
  const bh = S / rows
  const bw = S / cols
  fill(L.albedo, mortar)
  fill(L.height, grey(70))
  fill(L.rough, grey(235))
  const base = hexRgb(color)
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0
    for (let c = -1; c <= cols; c++) {
      const x = c * bw + off
      const y = r * bh
      const k = 1 + range(rand, -variation, variation)
      const burnt = rand() < 0.08 ? 0.72 : 1
      const col = base.map((v, i) => Math.round(Math.min(255, v * k * burnt * (i === 2 ? range(rand, 0.94, 1.04) : 1))))
      L.albedo.g.fillStyle = `rgb(${col.join(',')})`
      L.albedo.g.fillRect(x + 1.2, y + 1.2, bw - 2.4, bh - 2.4)
      L.height.g.fillStyle = grey(Math.round(range(rand, 170, 215)))
      L.height.g.fillRect(x + 1.2, y + 1.2, bw - 2.4, bh - 2.4)
      L.rough.g.fillStyle = grey(Math.round(range(rand, 190, 225)))
      L.rough.g.fillRect(x + 1.2, y + 1.2, bw - 2.4, bh - 2.4)
    }
  }
  const grit = fbmField(S, 32, 3, seed)
  speckle(L.albedo, grit, 34)
  speckle(L.height, grit, 60)
  const stains = fbmField(S, 4, 4, seed + 9)
  speckle(L.albedo, stains, -dirt * 160, { offset: 0.35 })
  return finish(THREE, L, { normal: 3 })
}

/** Smooth render / painted plaster with faint trowel marks and grime. */
export function plaster(THREE, { color = '#e3ddd1', dirt = 0.12, tile = 3, quality, seed = 2 } = {}) {
  const S = sizeFor(quality)
  const L = layers(S)
  fill(L.albedo, color)
  fill(L.height, grey(128))
  fill(L.rough, grey(220))
  const f = fbmField(S, 6, 5, seed)
  speckle(L.albedo, f, 26)
  speckle(L.height, f, 70)
  const g = fbmField(S, 3, 4, seed + 3)
  speckle(L.albedo, g, -dirt * 180, { offset: 0.4 })
  speckle(L.rough, f, 30)
  return finish(THREE, L, { normal: 1.2 })
}

/** Poured concrete: pores, form-tie holes on a grid, water streaks. */
export function concrete(THREE, { color = '#a9a49b', tile = 4, ties = true, quality, seed = 3 } = {}) {
  const S = sizeFor(quality)
  const L = layers(S)
  fill(L.albedo, color)
  fill(L.height, grey(140))
  fill(L.rough, grey(225))
  const f = fbmField(S, 8, 5, seed)
  speckle(L.albedo, f, 30)
  speckle(L.height, f, 50)
  const pores = fbmField(S, 96, 1, seed + 5)
  speckle(L.height, pores, 40, { offset: 0.6 })
  // vertical rain streaks
  const rand = seeded(seed)
  for (let i = 0; i < 40; i++) {
    const x = rand() * S
    const grd = L.albedo.g.createLinearGradient(0, 0, 0, S)
    grd.addColorStop(0, 'rgba(40,36,30,0.10)')
    grd.addColorStop(1, 'rgba(40,36,30,0)')
    L.albedo.g.fillStyle = grd
    L.albedo.g.fillRect(x, 0, range(rand, 2, 8), S * range(rand, 0.3, 1))
  }
  if (ties) {
    const n = Math.max(2, Math.round(tile / 1.2))
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const cx = ((x + 0.5) / n) * S
        const cy = ((y + 0.5) / n) * S
        L.albedo.g.fillStyle = 'rgba(60,58,54,0.5)'
        L.albedo.g.beginPath()
        L.albedo.g.arc(cx, cy, S * 0.006, 0, Math.PI * 2)
        L.albedo.g.fill()
        L.height.g.fillStyle = grey(60)
        L.height.g.beginPath()
        L.height.g.arc(cx, cy, S * 0.006, 0, Math.PI * 2)
        L.height.g.fill()
      }
    }
  }
  return finish(THREE, L, { normal: 1.5 })
}

/**
 * Stone paving: rectangular flags or small square setts (cobbles), with
 * gaps, wear and a little sheen on the worn tops.
 * kind: 'flags' | 'setts' | 'herringbone' (brick pavers)
 */
export function paving(THREE, { kind = 'flags', color = '#9b958b', joint = '#4d4a45', unit = 0.6, variation = 0.12, tile = 4, wet = 0, quality, seed = 4 } = {}) {
  const S = sizeFor(quality)
  const L = layers(S)
  const rand = seeded(seed)
  fill(L.albedo, joint)
  fill(L.height, grey(40))
  fill(L.rough, grey(240))
  const base = hexRgb(color)
  const stone = (x, y, w, h, round = 0) => {
    const k = 1 + range(rand, -variation, variation)
    const col = base.map((v) => Math.round(Math.min(255, v * k)))
    for (const [layer, style] of [
      [L.albedo, `rgb(${col.join(',')})`],
      [L.height, grey(Math.round(range(rand, 170, 220)))],
      [L.rough, grey(Math.round(range(rand, 150, 210) - wet * 120))],
    ]) {
      layer.g.fillStyle = style
      layer.g.beginPath()
      if (round && layer.g.roundRect) layer.g.roundRect(x, y, w, h, round)
      else layer.g.rect(x, y, w, h)
      layer.g.fill()
    }
  }
  const px = S / tile // px per metre
  const gap = Math.max(1.5, px * 0.008)
  if (kind === 'setts') {
    const u = unit * px
    const n = Math.round(S / u)
    const us = S / n
    for (let r = 0; r < n; r++) {
      const off = r % 2 ? us / 2 : 0
      for (let c = -1; c <= n; c++) stone(c * us + off + gap, r * us + gap, us - gap * 2, us - gap * 2, us * 0.18)
    }
  } else if (kind === 'herringbone') {
    const w = 0.2 * px
    const h = 0.1 * px
    const n = Math.ceil(S / h) + 2
    for (let i = -n; i < n; i++) {
      for (let j = -n; j < n; j++) {
        const x = i * w + j * h
        const y = j * h - i * h
        if (x < -w * 2 || x > S + w || y < -w * 2 || y > S + w) continue
        stone(x + gap, y + gap, w - gap * 2, h - gap * 2)
        stone(x + w - h + gap, y + h + gap, h - gap * 2, w - gap * 2)
      }
    }
  } else {
    // flags: rows of slabs of varying length
    const rowH = unit * px
    const rows = Math.round(S / rowH)
    const rh = S / rows
    for (let r = 0; r < rows; r++) {
      let x = -range(rand, 0, rh)
      while (x < S) {
        const w = rh * range(rand, 1.0, 1.8)
        stone(x + gap, r * rh + gap, w - gap * 2, rh - gap * 2)
        x += w
      }
    }
  }
  const f = fbmField(S, 16, 4, seed)
  speckle(L.albedo, f, 30)
  speckle(L.height, f, 40)
  const stains = fbmField(S, 3, 3, seed + 7)
  speckle(L.albedo, stains, -40, { offset: 0.45 })
  speckle(L.rough, stains, 60 - wet * 60)
  return finish(THREE, L, { normal: 2.5 })
}

/** Asphalt: aggregate, tar patches and a few cracks. */
export function asphalt(THREE, { color = '#3d3e40', tile = 6, quality, seed = 5 } = {}) {
  const S = sizeFor(quality)
  const L = layers(S)
  fill(L.albedo, color)
  fill(L.height, grey(128))
  fill(L.rough, grey(225))
  const agg = fbmField(S, 160, 1, seed)
  speckle(L.albedo, agg, 50)
  speckle(L.height, agg, 90)
  const patch = fbmField(S, 4, 4, seed + 1)
  speckle(L.albedo, patch, -30, { offset: 0.45 })
  speckle(L.rough, patch, -40)
  const rand = seeded(seed)
  L.albedo.g.strokeStyle = 'rgba(15,15,16,0.55)'
  L.height.g.strokeStyle = grey(50)
  for (let i = 0; i < 5; i++) {
    let x = rand() * S
    let y = rand() * S
    for (const layer of [L.albedo, L.height]) {
      layer.g.lineWidth = 1.4
      layer.g.beginPath()
      layer.g.moveTo(x, y)
    }
    for (let k = 0; k < 12; k++) {
      x += range(rand, -18, 18)
      y += range(rand, -18, 18)
      L.albedo.g.lineTo(x, y)
      L.height.g.lineTo(x, y)
    }
    L.albedo.g.stroke()
    L.height.g.stroke()
  }
  return finish(THREE, L, { normal: 2 })
}

/** Beach / dune sand: ripples from the wind, damp darker toward the sea if `wet`. */
export function sand(THREE, { color = '#d2b98f', ripples = true, wet = 0, tile = 4, quality, seed = 6 } = {}) {
  const S = sizeFor(quality)
  const L = layers(S)
  fill(L.albedo, color)
  fill(L.height, grey(128))
  fill(L.rough, grey(Math.round(240 - wet * 120)))
  const grit = fbmField(S, 128, 2, seed)
  speckle(L.albedo, grit, 26)
  speckle(L.height, grit, 30)
  if (ripples) {
    const img = L.height.g.getImageData(0, 0, S, S)
    const warp = fbmField(S, 4, 3, seed + 2)
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4
        const v = Math.sin(((y / S) * 18 + warp[y * S + x] * 3) * Math.PI * 2)
        const add = v * 34
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, img.data[i] + add))
      }
    }
    L.height.g.putImageData(img, 0, 0)
  }
  const tone = fbmField(S, 3, 4, seed + 4)
  speckle(L.albedo, tone, 30)
  if (wet) speckle(L.albedo, tone, -wet * 70, { offset: 0 })
  return finish(THREE, L, { normal: 1.6 })
}

/** Wooden boards (decking, floors, cladding): grain, knots, gaps. */
export function planks(THREE, { color = '#8a6a4a', width = 0.14, gap = 0.004, varnish = 0, tile = 2, quality, seed = 7 } = {}) {
  const S = sizeFor(quality)
  const L = layers(S)
  const rand = seeded(seed)
  const px = S / tile
  const n = Math.max(2, Math.round(tile / width))
  const bw = S / n
  const base = hexRgb(color)
  fill(L.albedo, '#2a2018')
  fill(L.height, grey(40))
  fill(L.rough, grey(Math.round(varnish ? 120 : 210)))
  for (let i = 0; i < n; i++) {
    let y = -range(rand, 0, S)
    while (y < S) {
      const len = range(rand, 0.8, 2.4) * px
      const k = 1 + range(rand, -0.14, 0.14)
      const col = base.map((v) => Math.round(Math.min(255, v * k)))
      const x = i * bw + gap * px
      const w = bw - gap * px * 2
      L.albedo.g.fillStyle = `rgb(${col.join(',')})`
      L.albedo.g.fillRect(x, y + gap * px, w, len - gap * px * 2)
      L.height.g.fillStyle = grey(Math.round(range(rand, 185, 215)))
      L.height.g.fillRect(x, y + gap * px, w, len - gap * px * 2)
      // grain lines along the board
      for (let g = 0; g < 7; g++) {
        const gx = x + rand() * w
        L.albedo.g.strokeStyle = `rgba(40,25,12,${range(rand, 0.06, 0.18)})`
        L.albedo.g.lineWidth = range(rand, 0.6, 1.8)
        L.albedo.g.beginPath()
        L.albedo.g.moveTo(gx, y)
        L.albedo.g.bezierCurveTo(gx + range(rand, -4, 4), y + len * 0.3, gx + range(rand, -4, 4), y + len * 0.6, gx + range(rand, -3, 3), y + len)
        L.albedo.g.stroke()
      }
      if (rand() < 0.25) {
        const kx = x + rand() * w
        const ky = y + rand() * len
        L.albedo.g.fillStyle = 'rgba(50,30,15,0.45)'
        L.albedo.g.beginPath()
        L.albedo.g.ellipse(kx, ky, w * 0.08, w * 0.14, 0, 0, Math.PI * 2)
        L.albedo.g.fill()
      }
      y += len
    }
  }
  const f = fbmField(S, 24, 3, seed)
  speckle(L.albedo, f, 16)
  return finish(THREE, L, { normal: 1.8 })
}

/** Roof tiles (red pantiles) or slate. kind: 'tiles' | 'slate' | 'zinc' */
export function roof(THREE, { kind = 'slate', color, tile = 2, quality, seed = 8 } = {}) {
  const S = sizeFor(quality)
  const L = layers(S)
  const rand = seeded(seed)
  const c = color || (kind === 'tiles' ? '#8e4a33' : kind === 'zinc' ? '#7c8287' : '#3f4247')
  fill(L.albedo, c)
  fill(L.height, grey(128))
  fill(L.rough, grey(kind === 'zinc' ? 120 : 200))
  const base = hexRgb(c)
  if (kind === 'zinc') {
    const n = Math.round(tile / 0.45)
    for (let i = 0; i < n; i++) {
      const x = (i / n) * S
      L.height.g.fillStyle = grey(230)
      L.height.g.fillRect(x, 0, S * 0.012, S)
      L.albedo.g.fillStyle = 'rgba(255,255,255,0.08)'
      L.albedo.g.fillRect(x, 0, S * 0.012, S)
    }
  } else {
    const rows = Math.round(tile / (kind === 'tiles' ? 0.3 : 0.22))
    const cols = Math.round(tile / (kind === 'tiles' ? 0.22 : 0.3))
    const rh = S / rows
    const cw = S / cols
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? cw / 2 : 0
      for (let i = -1; i <= cols; i++) {
        const k = 1 + range(rand, -0.15, 0.15)
        L.albedo.g.fillStyle = `rgb(${base.map((v) => Math.round(Math.min(255, v * k))).join(',')})`
        L.albedo.g.fillRect(i * cw + off + 1, r * rh, cw - 2, rh - 1)
        // each course overlaps the one below: bright at the bottom edge, shadow above
        const grd = L.height.g.createLinearGradient(0, r * rh, 0, r * rh + rh)
        grd.addColorStop(0, grey(80))
        grd.addColorStop(1, grey(220))
        L.height.g.fillStyle = grd
        L.height.g.fillRect(i * cw + off + 1, r * rh, cw - 2, rh - 1)
        if (kind === 'tiles') {
          const g2 = L.height.g.createLinearGradient(i * cw + off, 0, i * cw + off + cw, 0)
          g2.addColorStop(0, 'rgba(0,0,0,0.25)')
          g2.addColorStop(0.5, 'rgba(255,255,255,0.15)')
          g2.addColorStop(1, 'rgba(0,0,0,0.25)')
          L.height.g.fillStyle = g2
          L.height.g.fillRect(i * cw + off + 1, r * rh, cw - 2, rh - 1)
        }
      }
    }
  }
  const moss = fbmField(S, 4, 4, seed + 3)
  speckle(L.albedo, moss, -40, { offset: 0.5, tint: [1, 0.8, 1] })
  return finish(THREE, L, { normal: 2.5, metal: kind === 'zinc' ? solidCanvas(S, 140) : null })
}

/** Polished floors: concrete, terrazzo or stone tile; reflective. */
export function floor(THREE, { kind = 'concrete', color = '#bdb6aa', tileSize = 0.6, polish = 0.85, tile = 4, quality, seed = 9 } = {}) {
  const S = sizeFor(quality)
  const L = layers(S)
  fill(L.albedo, color)
  fill(L.height, grey(128))
  fill(L.rough, grey(Math.round(255 * (1 - polish) * 0.9 + 12)))
  const f = fbmField(S, 5, 5, seed)
  speckle(L.albedo, f, kind === 'terrazzo' ? 18 : 28)
  speckle(L.rough, f, 40)
  if (kind === 'terrazzo') {
    const rand = seeded(seed)
    for (let i = 0; i < 2600; i++) {
      L.albedo.g.fillStyle = rand() < 0.5 ? 'rgba(60,55,50,0.6)' : 'rgba(250,248,240,0.6)'
      L.albedo.g.fillRect(rand() * S, rand() * S, range(rand, 1, 3.5), range(rand, 1, 3.5))
    }
  }
  if (kind === 'tile') {
    const n = Math.round(tile / tileSize)
    const u = S / n
    L.albedo.g.strokeStyle = 'rgba(0,0,0,0.25)'
    L.height.g.strokeStyle = grey(40)
    for (let i = 0; i <= n; i++) {
      for (const layer of [L.albedo, L.height]) {
        layer.g.lineWidth = 2
        layer.g.beginPath()
        layer.g.moveTo(i * u, 0)
        layer.g.lineTo(i * u, S)
        layer.g.moveTo(0, i * u)
        layer.g.lineTo(S, i * u)
        layer.g.stroke()
      }
    }
  }
  return finish(THREE, L, { normal: 0.8 })
}

/** Grass seen from human height: blades, clover, worn earth patches. */
export function lawn(THREE, { color = '#5a7436', worn = 0.2, stripes = false, tile = 3, quality, seed = 10 } = {}) {
  const S = sizeFor(quality)
  const L = layers(S)
  const rand = seeded(seed)
  fill(L.albedo, color)
  fill(L.height, grey(110))
  fill(L.rough, grey(235))
  const tone = fbmField(S, 4, 4, seed)
  speckle(L.albedo, tone, 40, { tint: [0.8, 1, 0.5] })
  if (stripes) {
    for (let x = 0; x < S; x += S / 4) {
      L.albedo.g.fillStyle = (x / (S / 4)) % 2 ? 'rgba(255,255,220,0.05)' : 'rgba(0,20,0,0.05)'
      L.albedo.g.fillRect(x, 0, S / 4, S)
    }
  }
  const earth = fbmField(S, 6, 4, seed + 1)
  speckle(L.albedo, earth, -worn * 200, { offset: 0.62, tint: [0.6, 0.85, 1.2] })
  for (let i = 0; i < S * S * 0.06; i++) {
    const x = rand() * S
    const y = rand() * S
    const l = range(rand, 2, 6) * (S / 512)
    const light = rand() < 0.5
    L.albedo.g.strokeStyle = light ? 'rgba(180,200,100,0.35)' : 'rgba(20,45,10,0.35)'
    L.height.g.strokeStyle = light ? grey(220) : grey(60)
    for (const layer of [L.albedo, L.height]) {
      layer.g.lineWidth = 1
      layer.g.beginPath()
      layer.g.moveTo(x, y)
      layer.g.lineTo(x + range(rand, -1.5, 1.5), y - l)
      layer.g.stroke()
    }
  }
  return finish(THREE, L, { normal: 1.6 })
}

/* --- facades ------------------------------------------------------------ */

/**
 * One bay × one storey of a facade, tiled across a building with `box()`.
 *
 *  wall:   'brick' | 'plaster' | 'concrete' | 'stone' | 'curtain' (all glass)
 *  window: proportions { w, h } of the bay (0..1), 'sash' bars, a sill
 *  night:  lit-window ratio (0 = day); lit windows glow warm or cool
 *
 * Glass is dark, smooth and metallic in the maps, so it mirrors the sky —
 * windows look like real windows instead of painted rectangles.
 *
 * Returns { material, tile: [bayWidth, storeyHeight] } — pass `tile` to box().
 */
export function facade(
  THREE,
  {
    wall = 'brick',
    color = '#7a3a28',
    mortar = '#a89a88',
    frame = '#efe9dd',
    glass = '#1d242b',
    bay = 3.2,
    storey = 3.2,
    window: win = { w: 0.5, h: 0.62, bars: 'sash', sill: true, lintel: true },
    curtains = 0.25,
    night = 0,
    quality,
    seed = 11,
  } = {}
) {
  const S = sizeFor(quality)
  const rand = seeded(seed)
  // the texture holds 2 × 2 bays so lit windows and curtains don't repeat at once
  const L = layers(S)
  const metal = makeCanvas(S, S)
  const mg = metal.getContext('2d')
  mg.fillStyle = grey(0)
  mg.fillRect(0, 0, S, S)
  const emit = night ? makeCanvas(S, S) : null
  const eg = emit?.getContext('2d')
  if (eg) {
    eg.fillStyle = '#000'
    eg.fillRect(0, 0, S, S)
  }

  // the wall itself
  const wallMat = wallLayers(S, wall, color, mortar, bay * 2, storey * 2, seed)
  for (const k of ['albedo', 'height', 'rough']) L[k].g.drawImage(wallMat[k], 0, 0)

  const cw = S / 2
  const ch = S / 2
  for (let by = 0; by < 2; by++) {
    for (let bx = 0; bx < 2; bx++) {
      const ox = bx * cw
      const oy = by * ch
      if (wall === 'curtain') {
        // full-height glazing with mullions and a spandrel band
        const m = cw * 0.025
        paintRect(L, ox, oy, cw, ch, frame, 200, 120)
        paintGlass(L, mg, ox + m, oy + m, cw - 2 * m, ch * 0.78 - m, glass, rand, curtains)
        paintRect(L, ox + m, oy + ch * 0.78, cw - 2 * m, ch * 0.22 - m, shade(glass, 1.6), 150, 90)
        if (eg && rand() < night) litWindow(eg, ox + m, oy + m, cw - 2 * m, ch * 0.78 - m, rand)
        continue
      }
      const ww = cw * win.w
      const wh = ch * win.h
      const wx = ox + (cw - ww) / 2
      const wy = oy + ch * 0.16
      // recess (shadowed reveal), frame, glass, bars
      paintRect(L, wx - cw * 0.02, wy - cw * 0.02, ww + cw * 0.04, wh + cw * 0.04, shade(color, 0.55), 30, 230)
      paintRect(L, wx, wy, ww, wh, frame, 150, 140)
      const fw = Math.max(2, cw * 0.022)
      paintGlass(L, mg, wx + fw, wy + fw, ww - 2 * fw, wh - 2 * fw, glass, rand, curtains)
      if (win.bars === 'sash') {
        paintRect(L, wx, wy + wh * 0.5 - fw / 2, ww, fw, frame, 160, 140)
        paintRect(L, wx + ww / 2 - fw / 3, wy, (fw * 2) / 3, wh, frame, 160, 140)
        clearMetal(mg, wx, wy + wh * 0.5 - fw / 2, ww, fw)
        clearMetal(mg, wx + ww / 2 - fw / 3, wy, (fw * 2) / 3, wh)
      } else if (win.bars === 'grid') {
        for (let i = 1; i < 3; i++) {
          paintRect(L, wx + (ww * i) / 3 - fw / 4, wy, fw / 2, wh, frame, 160, 140)
          clearMetal(mg, wx + (ww * i) / 3 - fw / 4, wy, fw / 2, wh)
        }
        paintRect(L, wx, wy + wh / 2 - fw / 4, ww, fw / 2, frame, 160, 140)
        clearMetal(mg, wx, wy + wh / 2 - fw / 4, ww, fw / 2)
      }
      if (win.sill) paintRect(L, wx - cw * 0.03, wy + wh, ww + cw * 0.06, ch * 0.03, '#d8d2c6', 230, 200)
      if (win.lintel && wall === 'brick') paintRect(L, wx - cw * 0.03, wy - ch * 0.05, ww + cw * 0.06, ch * 0.04, shade(color, 0.85), 210, 220)
      if (eg && rand() < night) litWindow(eg, wx + fw, wy + fw, ww - 2 * fw, wh - 2 * fw, rand)
    }
  }
  const material = finish(THREE, L, {
    normal: 2.5,
    metal,
    emissive: emit,
    emissiveIntensity: night ? 2.4 : 1,
    envMapIntensity: 1.15,
  })
  return { material, tile: [bay, storey] }
}

/** A shopfront / ground storey: big glazing, a door, a fascia sign band, optional awning colour. */
export function shopfront(THREE, { color = '#2a2420', frame = '#1c1c1c', fascia = '#202020', awning = null, bay = 3.2, storey = 4, warm = 0.6, night = 0, quality, seed = 12 } = {}) {
  const S = sizeFor(quality)
  const rand = seeded(seed)
  const L = layers(S)
  const metal = makeCanvas(S, S)
  const mg = metal.getContext('2d')
  mg.fillStyle = '#000'
  mg.fillRect(0, 0, S, S)
  const emit = makeCanvas(S, S)
  const eg = emit.getContext('2d')
  eg.fillStyle = '#000'
  eg.fillRect(0, 0, S, S)
  fill(L.albedo, color)
  fill(L.height, grey(150))
  fill(L.rough, grey(150))
  const cw = S / 2
  for (let b = 0; b < 2; b++) {
    const ox = b * cw
    paintRect(L, ox, 0, cw, S * 0.18, fascia, 170, 120)
    if (awning) {
      paintRect(L, ox, S * 0.18, cw, S * 0.08, awning, 230, 230)
      for (let x = ox; x < ox + cw; x += cw / 8) paintRect(L, x, S * 0.18, cw / 16, S * 0.08, 'rgba(255,255,255,0.18)', 230, 230)
    }
    const gx = ox + cw * 0.06
    const gy = S * 0.3
    const gw = cw * 0.88
    const gh = S * 0.66
    paintRect(L, gx - 3, gy - 3, gw + 6, gh + 6, frame, 160, 100)
    paintGlass(L, mg, gx, gy, gw, gh, '#272320', rand, 0)
    // a warm, lit interior seen through the glass
    const lit = night ? 1 : warm
    eg.fillStyle = `rgba(255,${180 + Math.round(rand() * 40)},120,${0.35 + lit * 0.45})`
    eg.fillRect(gx, gy + gh * 0.15, gw, gh * 0.85)
    if (b === 0) {
      paintRect(L, gx + gw * 0.62, gy, gw * 0.3, gh, shade(frame, 1.3), 120, 120)
      clearMetal(mg, gx + gw * 0.62, gy, gw * 0.3, gh)
    }
  }
  const material = finish(THREE, L, { normal: 2, metal, emissive: emit, emissiveIntensity: night ? 2.2 : 0.8, envMapIntensity: 1.1 })
  return { material, tile: [bay, storey] }
}

/* --- building blocks -------------------------------------------------- */

/**
 * A box with UVs scaled so a tiling material keeps its real size.
 * tile: [u metres, v metres] (from facade()/shopfront(), or [t, t] for surfaces).
 * The box sits on y = 0.
 */
export function box(THREE, w, h, d, material, tile = [2, 2]) {
  const geo = new THREE.BoxGeometry(w, h, d)
  geo.translate(0, h / 2, 0)
  const uv = geo.attributes.uv
  const faces = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ]
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k
      uv.setXY(i, (uv.getX(i) * faces[f][0]) / tile[0], (uv.getY(i) * faces[f][1]) / tile[1])
    }
  }
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = mesh.receiveShadow = true
  return mesh
}

/** A plane lying flat (y = 0) with UVs in metres / tile. */
export function ground(THREE, w, d, material, tile = 4) {
  const geo = new THREE.PlaneGeometry(w, d)
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile)
  geo.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(geo, material)
  mesh.receiveShadow = true
  return mesh
}

/**
 * A town building: a shopfront ground storey, facade storeys above, a cornice,
 * and a roof (flat, pitched, or a Dutch gable). Faces +Z.
 * opts: { w, d, storeys, facade, shop (or null), roof: 'flat'|'pitched'|'gable'|'step', roofMat, trim }
 */
export function townhouse(THREE, { w, d, storeys = 4, facade: fac, shop = null, roof: roofKind = 'flat', roofMat, trim }) {
  const g = new THREE.Group()
  const groundH = shop ? shop.tile[1] : fac.tile[1]
  const g0 = box(THREE, w, groundH, d, shop ? [fac.material, fac.material, fac.material, fac.material, shop.material, fac.material] : fac.material, shop ? shop.tile : fac.tile)
  if (shop) {
    // the sides keep the facade's scale, the front the shop's
    fixSideUVs(g0, w, groundH, d, fac.tile, shop.tile)
  }
  g.add(g0)
  const upperH = (storeys - 1) * fac.tile[1]
  if (storeys > 1) {
    const up = box(THREE, w, upperH, d, fac.material, fac.tile)
    up.position.y = groundH
    g.add(up)
  }
  const top = groundH + upperH
  if (trim) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.35, d + 0.3), trim)
    c.position.y = top + 0.17
    c.castShadow = true
    g.add(c)
  }
  if (roofKind === 'pitched' && roofMat) {
    const r = new THREE.Mesh(prism(THREE, w + 0.4, d * 0.42, d + 0.4), roofMat)
    r.position.y = top
    r.castShadow = true
    g.add(r)
  } else if ((roofKind === 'gable' || roofKind === 'step') && roofMat) {
    // Amsterdam: the ridge runs back from the street, the front ends in a gable
    const r = new THREE.Mesh(prism(THREE, d, w * 0.55, w + 0.2), roofMat)
    r.rotation.y = Math.PI / 2
    r.position.y = top
    r.castShadow = true
    g.add(r)
    g.add(gableFront(THREE, w, w * 0.55, roofKind, fac.material, fac.tile, d / 2, top))
  }
  return { group: g, height: top }
}

/* --- helpers ------------------------------------------------------------ */

function hexRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
function shade(hex, k) {
  if (!hex.startsWith('#')) return hex
  return `rgb(${hexRgb(hex)
    .map((v) => Math.max(0, Math.min(255, Math.round(v * k))))
    .join(',')})`
}
function solidCanvas(S, v) {
  const c = makeCanvas(S, S)
  const g = c.getContext('2d')
  g.fillStyle = grey(v)
  g.fillRect(0, 0, S, S)
  return c
}
function paintRect(L, x, y, w, h, color, height, rough) {
  L.albedo.g.fillStyle = color
  L.albedo.g.fillRect(x, y, w, h)
  L.height.g.fillStyle = grey(height)
  L.height.g.fillRect(x, y, w, h)
  L.rough.g.fillStyle = grey(rough)
  L.rough.g.fillRect(x, y, w, h)
}
function paintGlass(L, mg, x, y, w, h, color, rand, curtains) {
  // dark, smooth, metallic: it reflects the place's sky
  const grd = L.albedo.g.createLinearGradient(0, y, 0, y + h)
  grd.addColorStop(0, shade(color, 1.25))
  grd.addColorStop(1, shade(color, 0.8))
  L.albedo.g.fillStyle = grd
  L.albedo.g.fillRect(x, y, w, h)
  L.height.g.fillStyle = grey(90)
  L.height.g.fillRect(x, y, w, h)
  L.rough.g.fillStyle = grey(14)
  L.rough.g.fillRect(x, y, w, h)
  mg.fillStyle = grey(200)
  mg.fillRect(x, y, w, h)
  // a curtain or blind behind some panes: less mirror, more room
  if (rand() < curtains) {
    const side = rand() < 0.5
    const cw = w * range(rand, 0.25, 0.45)
    const cx = side ? x : x + w - cw
    L.albedo.g.fillStyle = `rgba(${Math.round(range(rand, 180, 235))},${Math.round(range(rand, 170, 225))},${Math.round(range(rand, 150, 210))},0.75)`
    L.albedo.g.fillRect(cx, y, cw, h)
    mg.fillStyle = grey(90)
    mg.fillRect(cx, y, cw, h)
  }
}
function clearMetal(mg, x, y, w, h) {
  mg.fillStyle = grey(0)
  mg.fillRect(x, y, w, h)
}
function litWindow(eg, x, y, w, h, rand) {
  const warm = rand() < 0.75
  const grd = eg.createLinearGradient(0, y, 0, y + h)
  grd.addColorStop(0, warm ? 'rgba(255,190,120,0.95)' : 'rgba(200,220,255,0.9)')
  grd.addColorStop(1, warm ? 'rgba(200,120,60,0.8)' : 'rgba(140,170,220,0.8)')
  eg.fillStyle = grd
  eg.fillRect(x, y, w, h)
}

/** The wall field behind the windows of a facade, as canvases. */
function wallLayers(S, kind, color, mortar, metresW, metresH, seed) {
  const L = layers(S)
  const rand = seeded(seed + 101)
  const base = hexRgb(color)
  if (kind === 'brick') {
    const rows = Math.round(metresH / 0.075)
    const cols = Math.round(metresW / 0.22)
    const bh = S / rows
    const bw = S / cols
    fill(L.albedo, mortar)
    fill(L.height, grey(70))
    fill(L.rough, grey(235))
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw / 2 : 0
      for (let c = -1; c <= cols; c++) {
        const k = 1 + range(rand, -0.2, 0.2)
        L.albedo.g.fillStyle = `rgb(${base.map((v) => Math.round(Math.min(255, v * k))).join(',')})`
        L.albedo.g.fillRect(c * bw + off + 0.8, r * bh + 0.8, bw - 1.6, bh - 1.6)
        L.height.g.fillStyle = grey(Math.round(range(rand, 170, 215)))
        L.height.g.fillRect(c * bw + off + 0.8, r * bh + 0.8, bw - 1.6, bh - 1.6)
        L.rough.g.fillStyle = grey(Math.round(range(rand, 195, 228)))
        L.rough.g.fillRect(c * bw + off + 0.8, r * bh + 0.8, bw - 1.6, bh - 1.6)
      }
    }
  } else if (kind === 'stone') {
    const rows = Math.round(metresH / 0.4)
    const bh = S / rows
    fill(L.albedo, color)
    fill(L.height, grey(170))
    fill(L.rough, grey(215))
    for (let r = 0; r < rows; r++) {
      L.albedo.g.fillStyle = 'rgba(0,0,0,0.12)'
      L.albedo.g.fillRect(0, r * bh, S, 1.5)
      L.height.g.fillStyle = grey(90)
      L.height.g.fillRect(0, r * bh, S, 1.5)
      let x = -rand() * S * 0.2
      while (x < S) {
        L.albedo.g.fillRect(x, r * bh, 1.5, bh)
        L.height.g.fillRect(x, r * bh, 1.5, bh)
        x += S * range(rand, 0.12, 0.22)
      }
    }
  } else {
    // plaster, concrete, curtain (spandrel colour)
    fill(L.albedo, color)
    fill(L.height, grey(140))
    fill(L.rough, grey(kind === 'concrete' ? 225 : 215))
  }
  const f = fbmField(S, 16, 4, seed)
  speckle(L.albedo, f, kind === 'brick' ? 26 : 20)
  speckle(L.height, f, 40)
  const stains = fbmField(S, 3, 3, seed + 5)
  speckle(L.albedo, stains, -26, { offset: 0.4 })
  return { albedo: L.albedo.c, height: L.height.c, rough: L.rough.c }
}

/** A triangular prism roof: width w (gable to gable along x), height h, depth d. */
function prism(THREE, w, h, d) {
  const shape = new THREE.Shape()
  shape.moveTo(-d / 2, 0)
  shape.lineTo(0, h)
  shape.lineTo(d / 2, 0)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false })
  geo.translate(0, 0, -w / 2)
  geo.rotateY(Math.PI / 2)
  // planar UVs in metres for the roof surface (2 m tiles)
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 2, (pos.getY(i) + Math.abs(pos.getZ(i))) / 2)
  return geo
}

/** The stepped or pointed gable on a canal house's front, in its own facade. */
function gableFront(THREE, w, h, kind, material, tile, z, y) {
  const s = new THREE.Shape()
  const hw = w / 2
  if (kind === 'step') {
    const n = 3
    s.moveTo(-hw, 0)
    for (let i = 0; i < n; i++) {
      const x0 = -hw + (hw * i) / n
      s.lineTo(x0, (h * (i + 1)) / (n + 1))
      s.lineTo(-hw + (hw * (i + 1)) / n, (h * (i + 1)) / (n + 1))
    }
    s.lineTo(-hw * 0.18, h)
    s.lineTo(hw * 0.18, h)
    for (let i = n - 1; i >= 0; i--) {
      s.lineTo(hw - (hw * (i + 1)) / n, (h * (i + 1)) / (n + 1))
      s.lineTo(hw - (hw * i) / n, (h * (i + 1)) / (n + 1))
    }
    s.lineTo(hw, 0)
  } else {
    s.moveTo(-hw, 0)
    s.lineTo(-hw * 0.12, h * 0.92)
    s.quadraticCurveTo(0, h * 1.08, hw * 0.12, h * 0.92)
    s.lineTo(hw, 0)
  }
  s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false })
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + hw) / tile[0], pos.getY(i) / tile[1] + 0.12)
  const m = new THREE.Mesh(geo, material)
  m.position.set(0, y, z - 0.3)
  m.castShadow = true
  return m
}

/** Keep a shopfront box's side faces at the facade scale. */
function fixSideUVs(mesh, w, h, d, sideTile, frontTile) {
  const uv = mesh.geometry.attributes.uv
  // faces 0,1 (±x) and 5 (−z) were scaled by frontTile; rescale to sideTile
  for (const f of [0, 1, 5]) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k
      uv.setXY(i, (uv.getX(i) * frontTile[0]) / sideTile[0], (uv.getY(i) * frontTile[1]) / sideTile[1])
    }
  }
  uv.needsUpdate = true
}
