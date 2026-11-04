/**
 * TU/e campus, Eindhoven — graduation day (Momentum), under a clear blue sky.
 *
 * Rebuilt from the four galleries shot here and from what the campus really
 * looks like:
 *
 *  - Atlas, the main building: a 150 m glass slab (staggered white mullion
 *    caps, dark floor bands that step where the red stair climbs through it)
 *    on board-marked concrete pillars. Its east end is an open colonnade with
 *    a glass stair tower; the rest of the ground floor is the great hall —
 *    travertine floor, mezzanines with glass balustrades, a folded concrete
 *    ceiling with triangular clerestories, and the red zigzag stair with its
 *    dark-wood treads rising through a void in the floors above. The TU/e
 *    letters on the mezzanine, the steel plaques, the Momentum backdrop, red
 *    round benches round the pillars, booth chairs and the bar.
 *  - The red-floored glass air bridge from Atlas's mezzanine to MetaForum.
 *  - MetaForum: an old engineering hall with a fritted glass box floating
 *    above; inside, a tall atrium ringed by galleries of lit offices, a red
 *    drum with a balcony ("Speakers' Corner") and steel stairs.
 *  - The Auditorium: brutalist concrete lecture halls over a glazed foyer
 *    (yellow fascia, red TU/e banners, "Entrance A") under a concrete
 *    canopy; inside, a lecture hall stage with green boards and lecterns.
 *  - The south lawn with the red TU/e letters on a steel beam, picnic
 *    tables, hedges and bikes; the reflecting pond with flags and the
 *    sculpture; the concrete pavilion; the poster lightboxes; the 70 m brick
 *    chimney by Ceres; Gemini, Flux, Vertigo and Neuron round about.
 *
 * Metres. Atlas runs east–west; its south face is z = −19; north is −Z.
 * No people anywhere.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createWorld, waterMaterial } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { beamBatch, seeded, range, pick } from '../utils.js'

/* --- kit: tileable noise and painted PBR texture sets ---------------------- */

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function vnoise(x, y, p, s) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const x0 = ((xi % p) + p) % p
  const y0 = ((yi % p) + p) % p
  const x1 = (x0 + 1) % p
  const y1 = (y0 + 1) % p
  const a = hash(x0, y0, s)
  const b = hash(x1, y0, s)
  const c = hash(x0, y1, s)
  const d = hash(x1, y1, s)
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
/** Fractal noise over the unit square that tiles (u, v in [0, 1)). */
function fbm(u, v, cells, oct = 3, s = 0) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let p = cells
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * p, v * p, p, s + o * 7)
    norm += amp
    amp *= 0.5
    p *= 2
  }
  return sum / norm
}
const c255 = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255))
const sstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function dataTex(THREE, data, W, H, srgb) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/**
 * Paint a PBR set pixel by pixel: paint(u, v, out) sets out.r/g/b (sRGB 0..1),
 * out.h (height 0..1), out.ro (roughness), out.me (metalness) and optionally
 * out.er/eg/eb (emission, sRGB 0..1). v runs up the face (row 0 is the bottom).
 */
function pbr(THREE, W, H, paint, { normal = 2 } = {}) {
  const n = W * H
  const col = new Uint8Array(n * 4)
  const rm = new Uint8Array(n * 4)
  const em = new Uint8Array(n * 4)
  let anyE = false
  const hgt = new Float32Array(n)
  const o = { r: 0, g: 0, b: 0, h: 0, ro: 0, me: 0, er: 0, eg: 0, eb: 0 }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      o.r = o.g = o.b = 0.5
      o.h = 0.5
      o.ro = 0.85
      o.me = 0
      o.er = o.eg = o.eb = 0
      paint((x + 0.5) / W, (y + 0.5) / H, o)
      const i = y * W + x
      const j = i * 4
      col[j] = c255(o.r)
      col[j + 1] = c255(o.g)
      col[j + 2] = c255(o.b)
      col[j + 3] = 255
      rm[j] = 255
      rm[j + 1] = c255(o.ro)
      rm[j + 2] = c255(o.me)
      rm[j + 3] = 255
      if (o.er || o.eg || o.eb) anyE = true
      em[j] = c255(o.er)
      em[j + 1] = c255(o.eg)
      em[j + 2] = c255(o.eb)
      em[j + 3] = 255
      hgt[i] = o.h
    }
  }
  const nm = new Uint8Array(n * 4)
  const k = (normal * W) / 256
  for (let y = 0; y < H; y++) {
    const yu = ((y + 1) % H) * W
    const yd = ((y - 1 + H) % H) * W
    for (let x = 0; x < W; x++) {
      const dx = (hgt[y * W + ((x + 1) % W)] - hgt[y * W + ((x - 1 + W) % W)]) * k
      const dy = (hgt[yu + x] - hgt[yd + x]) * k
      const l = Math.hypot(dx, dy, 1)
      const j = (y * W + x) * 4
      nm[j] = c255((-dx / l) * 0.5 + 0.5)
      nm[j + 1] = c255((-dy / l) * 0.5 + 0.5)
      nm[j + 2] = c255((1 / l) * 0.5 + 0.5)
      nm[j + 3] = 255
    }
  }
  return {
    map: dataTex(THREE, col, W, H, true),
    normalMap: dataTex(THREE, nm, W, H, false),
    rm: dataTex(THREE, rm, W, H, false),
    emissiveMap: anyE ? dataTex(THREE, em, W, H, true) : null,
  }
}
function pbrMat(THREE, set, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.rm,
    metalnessMap: set.rm,
    roughness: 1,
    metalness: 1,
    ...extra,
  })
  if (set.emissiveMap) {
    mat.emissiveMap = set.emissiveMap
    mat.emissive = new THREE.Color(0xffffff)
    mat.emissiveIntensity = extra.emissiveIntensity ?? 1
  }
  return mat
}

/**
 * A facade, one tile = cols × rows cells of tile[0] × tile[1] metres.
 * win: window rect inside each cell [x0, x1, y0, y1] (fractions). Glass is
 * smooth and metallic so it mirrors the sky. lit: share of windows lit warm
 * from inside (emissive).
 */
function facadeTex(THREE, S, o) {
  const {
    tile = [6, 6],
    cols = 2,
    rows = 2,
    wall = [0.6, 0.57, 0.52],
    wallRough = 0.88,
    joints = false,
    win = [0.2, 0.8, 0.25, 0.85],
    frame = [0.2, 0.2, 0.21],
    fw = 0.06,
    mull = 1,
    transom = 0,
    glass = [0.3, 0.36, 0.4],
    blinds = 0.2,
    blindColor = [0.8, 0.78, 0.72],
    lit = 0,
    litColor = [1, 0.8, 0.55],
    seed = 1,
    normal = 2,
  } = o
  const cw = tile[0] / cols
  const ch = tile[1] / rows
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      const cx = u * cols
      const cy = v * rows
      const ix = Math.floor(cx)
      const iy = Math.floor(cy)
      const xm = (cx - ix) * cw
      const ym = (cy - iy) * ch
      const x0 = win[0] * cw
      const x1 = win[1] * cw
      const y0 = win[2] * ch
      const y1 = win[3] * ch
      if (xm <= x0 || xm >= x1 || ym <= y0 || ym >= y1) {
        const n = fbm(u, v, 5, 3, seed)
        const grit = hash(Math.floor(u * 997), Math.floor(v * 991), seed)
        const k = 0.86 + n * 0.26 + (grit - 0.5) * 0.07
        p.r = wall[0] * k
        p.g = wall[1] * k
        p.b = wall[2] * k
        p.h = 0.62 + n * 0.08 + (grit - 0.5) * 0.05
        p.ro = wallRough
        if (joints && (xm < 0.012 || ym < 0.012)) {
          p.r *= 0.6
          p.g *= 0.6
          p.b *= 0.6
          p.h = 0.5
        }
        if (xm > x0 && xm < x1 && y0 > 0 && ym < y0 && ym > y0 - 1.2) {
          const s = sstep(y0 - 1.2, y0, ym) * 0.08 * hash(ix, iy, seed + 3)
          p.r -= s
          p.g -= s
          p.b -= s
        }
        return
      }
      const lx = xm - x0
      const ly = ym - y0
      const ww = x1 - x0
      const wh = y1 - y0
      const paneW = ww / mull
      const pane = Math.min(mull - 1, Math.floor(lx / paneW))
      const px = lx - pane * paneW
      let isFrame = lx < fw || lx > ww - fw || ly < fw || ly > wh - fw || px < fw * 0.5 || px > paneW - fw * 0.5
      if (transom && Math.abs(ly - transom * wh) < fw * 0.5) isFrame = true
      if (isFrame) {
        p.r = frame[0]
        p.g = frame[1]
        p.b = frame[2]
        p.h = 0.5
        p.ro = 0.42
        p.me = 0.55
        return
      }
      const id = ix * 7 + iy * 131 + pane * 17
      const t = 0.9 + hash(id, 3, seed) * 0.2
      if (lit && hash(id, 13, seed) < lit) {
        // a lit office: warm ceiling glow and a desk lamp or two deep inside
        const g = 0.75 + 0.25 * (ly / wh) + 0.1 * hash(id, 15, seed)
        p.r = litColor[0] * 0.85 * g
        p.g = litColor[1] * 0.85 * g
        p.b = litColor[2] * 0.85 * g
        p.er = litColor[0] * g * 0.9
        p.eg = litColor[1] * g * 0.9
        p.eb = litColor[2] * g * 0.9
        p.ro = 0.1
        p.me = 0
        p.h = 0.3
        return
      }
      p.r = glass[0] * t
      p.g = glass[1] * t
      p.b = glass[2] * t
      p.h = 0.3
      p.ro = 0.04 + hash(id, 5, seed) * 0.1
      p.me = 1
      if (ly > wh - fw - 0.18) {
        p.r *= 0.72
        p.g *= 0.72
        p.b *= 0.72
      }
      if (hash(id, 9, seed) < blinds) {
        const level = 1 - hash(id, 11, seed) * 0.75
        if (ly / wh > level) {
          const slat = 0.85 + 0.15 * Math.sin(ly * 90)
          p.r = blindColor[0] * slat
          p.g = blindColor[1] * slat
          p.b = blindColor[2] * slat
          p.ro = 0.7
          p.me = 0
          p.h = 0.33
        }
      }
    },
    { normal }
  )
}

/** A box with UVs in metres / tile, sitting on y = 0. */
function boxGeo(THREE, w, h, d, tile = [2, 2]) {
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
  return geo
}

/**
 * A flat quad a→b→c→d (counter-clockwise seen from its front), non-indexed,
 * UVs in metres / tile measured from a along a→b.
 */
function quadGeo(THREE, a, b, c, d, tile = [2, 2]) {
  // the cross of the diagonals is safe for triangles given as quads (a repeated corner)
  const n = c.clone().sub(a).cross(d.clone().sub(b))
  const eu = b.clone().sub(a)
  if (eu.lengthSq() < 1e-10) eu.copy(c.clone().sub(a))
  eu.normalize()
  n.normalize()
  const ev = n.clone().cross(eu)
  const pos = []
  const uv = []
  for (const p of [a, b, c, a, c, d]) {
    pos.push(p.x, p.y, p.z)
    const r = p.clone().sub(a)
    uv.push(r.dot(eu) / tile[0], r.dot(ev) / tile[1])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.computeVertexNormals()
  return g
}

/** Collect static geometry by material, then merge: one draw call per material. */
function makeBatch(THREE) {
  const groups = new Map()
  return {
    add(mat, geo, x = 0, y = 0, z = 0, ry = 0) {
      if (ry) geo.rotateY(ry)
      geo.translate(x, y, z)
      if (!groups.has(mat)) groups.set(mat, [])
      groups.get(mat).push(geo)
    },
    box(mat, w, h, d, x, y, z, tile = [2, 2], ry = 0) {
      this.add(mat, boxGeo(THREE, w, h, d, tile), x, y, z, ry)
    },
    /** An axis-aligned box from corner ranges. */
    span(mat, x0, x1, y0, y1, z0, z1, tile = [2, 2]) {
      this.add(mat, boxGeo(THREE, x1 - x0, y1 - y0, z1 - z0, tile), (x0 + x1) / 2, y0, (z0 + z1) / 2)
    },
    quad(mat, a, b, c, d, tile, both = false) {
      this.add(mat, quadGeo(THREE, a, b, c, d, tile))
      if (both) this.add(mat, quadGeo(THREE, b, a, d, c, tile))
    },
    build(scene, { cast = true, receive = true } = {}) {
      for (const [mat, list] of groups) {
        const mixed = list.some((g) => !g.index) && list.some((g) => g.index)
        const mesh = new THREE.Mesh(mergeGeometries(mixed ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list, false), mat)
        mesh.castShadow = cast
        mesh.receiveShadow = receive
        scene.add(mesh)
      }
      groups.clear()
    },
  }
}

/** A flat plane on y = 0 with metre UVs. */
function flat(THREE, w, d, mat, tile, x, y, z) {
  const m = M.ground(THREE, w, d, mat, tile)
  m.position.set(x, y, z)
  return m
}

/* --- signs: one painted atlas for every printed thing on campus ------------ */

const AT = 1024
const R = {
  backdrop: [0, 0, 512, 256],
  banner: [512, 0, 128, 256],
  entrance: [640, 0, 256, 64],
  speakers: [640, 64, 256, 64],
  press: [640, 128, 256, 128],
  poster: [0, 256, 256, 192],
  slide: [256, 256, 256, 160],
  chalk: [512, 256, 256, 128],
  lectern: [768, 256, 128, 160],
  doodle: [896, 256, 128, 384],
  feather: [768, 416, 128, 224],
  plaque: [0, 448, 256, 256],
  photos: [256, 448, 256, 256],
  logo: [512, 384, 128, 128],
  graffiti: [512, 512, 256, 128],
}

function signAtlas(THREE) {
  const c = document.createElement('canvas')
  c.width = c.height = AT
  const g = c.getContext('2d')
  const rand = seeded(77)
  const F = (w, px) => `${w} ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`
  const box = (r, color) => {
    g.fillStyle = color
    g.fillRect(r[0], r[1], r[2], r[3])
  }
  const text = (s, x, y, font, color, align = 'left') => {
    g.font = font
    g.fillStyle = color
    g.textAlign = align
    g.textBaseline = 'alphabetic'
    g.fillText(s, x, y)
  }
  const tueSquare = (x, y, s) => {
    g.fillStyle = '#e8412c'
    g.fillRect(x, y, s, s)
    text('TU/e', x + s * 0.09, y + s * 0.46, F(800, Math.round(s * 0.36)), '#ffffff')
    const t = Math.max(6, Math.round(s * 0.085))
    text('EINDHOVEN', x + s * 0.09, y + s * 0.64, F(700, t), '#ffffff')
    text('UNIVERSITY OF', x + s * 0.09, y + s * 0.75, F(700, t), '#ffffff')
    text('TECHNOLOGY', x + s * 0.09, y + s * 0.86, F(700, t), '#ffffff')
  }
  // the Momentum photo wall: TU/e squares and "momentum" marks, staggered
  {
    const r = R.backdrop
    box(r, '#f3f6f8')
    const cell = 85
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        const x = r[0] + col * cell + 6
        const y = r[1] + row * cell + 6
        if ((row + col) % 2 === 0) tueSquare(x + 4, y + 4, 66)
        else {
          const blue = '#7fc7df'
          text('mo', x + 2, y + 24, F(500, 22), blue)
          text('men', x + 2, y + 46, F(500, 22), blue)
          text('tum', x + 2, y + 68, F(500, 22), blue)
          g.fillStyle = blue
          g.fillRect(x + 44, y + 8, 1.5, 62)
          for (const [k, s] of ['The Academic', 'Celebration', 'of the Year', 'Eindhoven'].entries()) text(s, x + 48, y + 20 + k * 14, F(400, 8), blue)
        }
      }
    }
    g.fillStyle = 'rgba(160,180,190,0.25)'
    g.fillRect(r[0] + 255, r[1], 3, r[3])
  }
  // red TU/e banner
  {
    const r = R.banner
    box(r, '#d6202d')
    text('TU/e', r[0] + 12, r[1] + 88, F(800, 44), '#ffffff')
    for (const [k, s] of ['EINDHOVEN', 'UNIVERSITY OF', 'TECHNOLOGY'].entries()) text(s, r[0] + 12, r[1] + 112 + k * 15, F(700, 12), '#ffffff')
    g.fillStyle = 'rgba(255,255,255,0.9)'
    g.fillRect(r[0] + 12, r[1] + 200, 104, 2)
  }
  // Entrance A
  {
    const r = R.entrance
    box(r, '#23303f')
    text('Entrance A', r[0] + 12, r[1] + 42, F(600, 30), '#ffffff')
    g.fillStyle = '#e8412c'
    g.fillRect(r[0] + 196, r[1] + 10, 46, 44)
    text('TU/e', r[0] + 199, r[1] + 39, F(800, 15), '#ffffff')
  }
  // Speakers' Corner (lit)
  {
    const r = R.speakers
    box(r, '#2a1230')
    text("Speakers' Corner", r[0] + 128, r[1] + 42, F(600, 29), '#f2eaff', 'center')
  }
  // World Press Photo on the glass (transparent background)
  {
    const r = R.press
    g.clearRect(r[0], r[1], r[2], r[3])
    g.fillStyle = '#c8102e'
    g.fillRect(r[0] + 70, r[1] + 4, 186, 28)
    text('WORLD PRESS PHOTO', r[0] + 78, r[1] + 25, F(800, 17), '#ffffff')
    text('EXHIBITION', r[0] + 80, r[1] + 64, F(400, 26), '#f0f0f0')
    text('2023', r[0] + 80, r[1] + 94, F(400, 26), '#f0f0f0')
    text('5 – 26 September · Atlas, ground floor', r[0] + 80, r[1] + 114, F(400, 9), '#e0e0e0')
  }
  // poster lightbox: Audience Award
  {
    const r = R.poster
    box(r, '#f7f7f5')
    text('TU/e', r[0] + 110, r[1] + 26, F(800, 16), '#222')
    g.fillStyle = '#6a3fa0'
    g.fillRect(r[0] + 70, r[1] + 34, 116, 40)
    text('AUDIENCE', r[0] + 128, r[1] + 52, F(800, 16), '#ffffff', 'center')
    text('AWARD', r[0] + 128, r[1] + 70, F(800, 16), '#ffffff', 'center')
    g.fillStyle = '#4caf50'
    g.fillRect(r[0] + 8, r[1] + 84, 52, 70)
    g.fillStyle = '#2b9bd6'
    g.fillRect(r[0] + 196, r[1] + 84, 52, 70)
    g.fillStyle = '#9aa1a8'
    for (let k = 0; k < 6; k++) g.fillRect(r[0] + 70, r[1] + 88 + k * 10, 116 - (k % 3) * 18, 4)
    g.fillStyle = '#3a3a3c'
    g.fillRect(r[0] + 60, r[1] + 160, 136, 26)
    text('VOTE NOW!', r[0] + 128, r[1] + 179, F(800, 16), '#ffffff', 'center')
  }
  // slide on the lecture hall screen
  {
    const r = R.slide
    box(r, '#eaf4fa')
    for (let k = 0; k < 7; k++) {
      g.fillStyle = k % 2 ? '#bfe0f2' : '#d6ecf8'
      g.fillRect(r[0] + 10, r[1] + 10 + k * 17, 236, 16)
      g.fillStyle = '#5b7f99'
      g.fillRect(r[0] + 16, r[1] + 16 + k * 17, 30, 4)
      g.fillRect(r[0] + 60, r[1] + 16 + k * 17, 110 - (k % 3) * 20, 4)
    }
    g.strokeStyle = '#3fae49'
    g.lineWidth = 5
    g.beginPath()
    for (let x = 0; x <= 236; x += 12) g.lineTo(r[0] + 10 + x, r[1] + 138 + ((x / 12) % 2 ? -6 : 6))
    g.stroke()
  }
  // chalkboard
  {
    const r = R.chalk
    box(r, '#2c4a3a')
    for (let k = 0; k < 140; k++) {
      g.fillStyle = `rgba(230,240,230,${(0.02 + rand() * 0.05).toFixed(3)})`
      g.fillRect(r[0] + rand() * 240, r[1] + rand() * 120, 6 + rand() * 50, 2 + rand() * 10)
    }
    g.fillStyle = '#9a9d9c'
    g.fillRect(r[0], r[1] + 120, 256, 8)
  }
  // lectern front
  {
    const r = R.lectern
    box(r, '#3a3c40')
    text('TU/e', r[0] + 14, r[1] + 120, F(800, 40), '#6b6e74')
    g.fillStyle = '#2e3033'
    g.fillRect(r[0], r[1], r[2], 10)
  }
  // a hand-drawn hanging banner, all colours
  {
    const r = R.doodle
    box(r, '#f4f1ea')
    const cols = ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#e9c46a', '#8338ec', '#3a86ff', '#ff006e', '#06d6a0']
    for (let k = 0; k < 120; k++) {
      g.fillStyle = cols[k % cols.length]
      g.globalAlpha = 0.85
      const x = r[0] + 6 + rand() * 112
      const y = r[1] + 6 + rand() * 372
      const s = 3 + rand() * 12
      if (k % 3 === 0) g.fillRect(x, y, s, s * 0.6)
      else {
        g.beginPath()
        g.arc(x, y, s * 0.5, 0, Math.PI * 2)
        g.fill()
      }
    }
    g.globalAlpha = 1
  }
  // feather flag: momentum blue with green zigzags
  {
    const r = R.feather
    box(r, '#bfe6f3')
    g.strokeStyle = '#3cae4a'
    g.lineWidth = 9
    for (let row = 0; row < 3; row++) {
      g.beginPath()
      for (let x = 0; x <= 128; x += 16) g.lineTo(r[0] + x, r[1] + 120 + row * 34 + ((x / 16) % 2 ? -10 : 10))
      g.stroke()
    }
    text('20', r[0] + 18, r[1] + 60, F(300, 40), '#ffffff')
    text('23', r[0] + 18, r[1] + 100, F(300, 40), '#ffffff')
  }
  // brushed steel plaque, engraved
  {
    const r = R.plaque
    const grd = g.createLinearGradient(r[0], r[1], r[0] + r[2], r[1] + r[3])
    grd.addColorStop(0, '#a9a49c')
    grd.addColorStop(0.5, '#d7d3cc')
    grd.addColorStop(1, '#8f8a82')
    g.fillStyle = grd
    g.fillRect(r[0], r[1], r[2], r[3])
    for (let k = 0; k < 256; k += 2) {
      g.fillStyle = `rgba(255,255,255,${(rand() * 0.08).toFixed(3)})`
      g.fillRect(r[0], r[1] + k, 256, 1)
    }
    text('TU/e', r[0] + 128, r[1] + 160, F(500, 92), '#1b1b1c', 'center')
    g.save()
    g.translate(r[0] + 236, r[1] + 18)
    g.rotate(Math.PI / 2)
    text('2019', 0, 0, F(700, 14), '#1b1b1c')
    g.restore()
  }
  // photo banners: a crowd of colour blocks, read as big printed photographs
  {
    const r = R.photos
    const grd = g.createLinearGradient(r[0], r[1], r[0], r[1] + r[3])
    grd.addColorStop(0, '#8fb8d8')
    grd.addColorStop(1, '#3b5f7a')
    g.fillStyle = grd
    g.fillRect(r[0], r[1], r[2], r[3])
    for (let k = 0; k < 40; k++) {
      g.fillStyle = pick(rand, ['#d8b49a', '#2a2a2e', '#e9e1d4', '#6d4c3d', '#c0392b', '#f0c27b', '#34495e'])
      const x = r[0] + rand() * 240
      const y = r[1] + 60 + rand() * 180
      g.beginPath()
      g.ellipse(x, y, 6 + rand() * 12, 14 + rand() * 24, 0, 0, Math.PI * 2)
      g.fill()
    }
  }
  // a TU/e logo square
  tueSquare(R.logo[0], R.logo[1], 128)
  // tags on the concrete pavilion (transparent)
  {
    const r = R.graffiti
    g.clearRect(r[0], r[1], r[2], r[3])
    g.strokeStyle = '#b4232a'
    g.lineWidth = 4
    g.lineCap = 'round'
    g.beginPath()
    let x = r[0] + 20
    g.moveTo(x, r[1] + 70)
    for (let k = 0; k < 18; k++) {
      x += 11
      g.lineTo(x, r[1] + 40 + rand() * 60)
    }
    g.stroke()
    g.beginPath()
    g.arc(r[0] + 128, r[1] + 34, 18, Math.PI, 0)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** A plane showing one region of the sign atlas (faces +Z, centred). */
function signGeo(THREE, r, w, h) {
  const geo = new THREE.PlaneGeometry(w, h)
  const uv = geo.attributes.uv
  const u0 = r[0] / AT
  const u1 = (r[0] + r[2]) / AT
  const v1 = 1 - r[1] / AT
  const v0 = 1 - (r[1] + r[3]) / AT
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0))
  return geo
}

/* --- textures specific to the TU/e campus ------------------------------------------ */

/**
 * Atlas's curtain wall: 1.35 m mullion bays, 3.75 m storeys, a dark floor band
 * with an aluminium cover, pale blue glass, and short white mullion caps
 * staggered from storey to storey. Tile = 4 bays × 2 storeys.
 */
function atlasTex(THREE, S, seed = 41) {
  const bw = 1.35
  const sh = 3.75
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      const xm = u * bw * 4
      const ym = v * sh * 2
      const bay = Math.floor(xm / bw)
      const fx = xm - bay * bw
      const st = Math.floor(ym / sh)
      const fy = ym - st * sh
      const n = fbm(u, v, 6, 2, seed)
      const onMullion = fx < 0.05 || fx > bw - 0.05
      if (onMullion) {
        const capHigh = (bay + st) % 2 === 0
        const cap = capHigh ? fy > 2.05 && fy < 3.6 : fy > 0.95 && fy < 2.3
        if (cap) {
          p.r = p.g = p.b = 0.9
          p.h = 0.85
          p.ro = 0.35
          p.me = 0.2
          return
        }
        p.r = 0.3
        p.g = 0.32
        p.b = 0.34
        p.h = 0.6
        p.ro = 0.4
        p.me = 0.6
        return
      }
      if (fy < 0.8) {
        if (fy > 0.7) {
          p.r = 0.62
          p.g = 0.64
          p.b = 0.66
          p.h = 0.65
          p.ro = 0.3
          p.me = 0.8
          return
        }
        const k = 0.9 + n * 0.2
        p.r = 0.17 * k
        p.g = 0.19 * k
        p.b = 0.22 * k
        p.h = 0.5
        p.ro = 0.22
        p.me = 0.5
        return
      }
      const id = bay * 13 + st * 7
      const t = 0.94 + hash(id, 1, seed) * 0.12
      p.r = 0.42 * t
      p.g = 0.6 * t
      p.b = 0.74 * t
      p.h = 0.45
      p.ro = 0.03 + hash(id, 2, seed) * 0.05
      p.me = 1
      if (fy > 3.4) {
        p.r *= 0.82
        p.g *= 0.82
        p.b *= 0.82
      }
    },
    { normal: 2 }
  )
}

/** Fritted glass: fine white horizontal lines over blue-green glass (MetaForum's box). */
function fritTex(THREE, S, seed = 43) {
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      const xm = u * 6
      const ym = v * 6
      const fx = xm % 1.5
      const fy = ym % 3
      if (fx < 0.05 || fy < 0.06) {
        p.r = p.g = p.b = 0.32
        p.h = 0.6
        p.ro = 0.4
        p.me = 0.6
        return
      }
      const line = (ym * 12) % 1 < 0.4
      const id = Math.floor(xm / 1.5) * 7 + Math.floor(ym / 3) * 3
      const t = 0.92 + hash(id, 4, seed) * 0.16
      if (line) {
        p.r = 0.8 * t
        p.g = 0.82 * t
        p.b = 0.8 * t
        p.h = 0.47
        p.ro = 0.3
        p.me = 0.15
      } else {
        p.r = 0.36 * t
        p.g = 0.5 * t
        p.b = 0.56 * t
        p.h = 0.45
        p.ro = 0.05
        p.me = 1
      }
    },
    { normal: 1 }
  )
}

/** The air bridge's red studded rubber floor (tile 0.5 m), glossy. */
function rubberTex(THREE, S) {
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      const n = fbm(u, v, 4, 2, 61)
      const k = 0.92 + n * 0.14
      p.r = 0.66 * k
      p.g = 0.07 * k
      p.b = 0.05 * k
      p.ro = 0.32
      p.h = 0.4
      const gx = (u * 20) % 1
      const gy = (v * 20) % 1
      const d = Math.hypot(gx - 0.5, gy - 0.5)
      if (d < 0.22) {
        p.h = 0.4 + (0.22 - d) * 2.5
        p.r *= 1.08
        p.ro = 0.26
      }
    },
    { normal: 3 }
  )
}

/** Bronze ceiling slats with dark gaps (tile 1 m). */
function slatTex(THREE, S) {
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      const f = (u * 10) % 1
      if (f < 0.12) {
        p.r = 0.12
        p.g = 0.08
        p.b = 0.07
        p.h = 0.2
        p.ro = 0.8
        return
      }
      const n = fbm(u, v, 3, 2, 62)
      p.r = 0.6 + n * 0.06
      p.g = 0.33 + n * 0.04
      p.b = 0.26 + n * 0.04
      p.h = 0.6
      p.ro = 0.45
      p.me = 0.2
    },
    { normal: 2 }
  )
}

/** The red drum: steel panels with ledges and small square windows (tile 12.57 × 9.4 m). */
function drumTex(THREE, S) {
  const W = 12.566
  const H = 9.4
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      const x = u * W
      const y = v * H
      const n = fbm(u, v, 6, 2, 63)
      p.r = 0.74 * (0.93 + n * 0.12)
      p.g = 0.11 * (0.93 + n * 0.12)
      p.b = 0.08 * (0.93 + n * 0.12)
      p.ro = 0.45
      p.me = 0.15
      p.h = 0.55
      const px = x % 3.1416
      if (px < 0.03) {
        p.r *= 0.6
        p.g *= 0.6
        p.b *= 0.6
        p.h = 0.45
      }
      for (const [a, b] of [
        [1.15, 1.6],
        [5.2, 5.5],
      ]) {
        if (y > a && y < b) {
          p.r = 0.78
          p.g = 0.78
          p.b = 0.76
          p.ro = 0.4
          p.me = 0.3
          p.h = 0.75
        }
      }
      // two openings per panel, framed, dark inside
      for (const [wy0, wy1] of [
        [2.6, 4.0],
        [6.6, 7.6],
      ]) {
        if (y > wy0 && y < wy1 && px > 1.0 && px < 2.2) {
          const edge = y < wy0 + 0.06 || y > wy1 - 0.06 || px < 1.06 || px > 2.14
          if (edge) {
            p.r = p.g = p.b = 0.75
            p.h = 0.7
          } else {
            p.r = 0.12
            p.g = 0.11
            p.b = 0.12
            p.ro = 0.15
            p.me = 0.4
            p.h = 0.3
          }
        }
      }
    },
    { normal: 2 }
  )
}

/** Perforated acoustic panels (tile 1 m). */
function perfTex(THREE, S) {
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      p.r = p.g = 0.84
      p.b = 0.82
      p.ro = 0.6
      p.h = 0.6
      const fx = (u * 24) % 1
      const fy = (v * 24) % 1
      if (Math.hypot(fx - 0.5, fy - 0.5) < 0.2) {
        p.r = p.g = p.b = 0.22
        p.h = 0.2
      }
      if (u * 2 % 1 < 0.01 || v * 2 % 1 < 0.01) {
        p.r = p.g = p.b = 0.6
        p.h = 0.45
      }
    },
    { normal: 2 }
  )
}

/* --- the red TU/e letters ------------------------------------------------------------- */

/** "TU/e" as extruded shapes, 2 m tall, standing on y = 0, reading along +X, facing +Z. */
function tueLetters(THREE) {
  const shapes = []
  const T = new THREE.Shape()
  T.moveTo(0, 1.6)
  T.lineTo(0, 2)
  T.lineTo(1.6, 2)
  T.lineTo(1.6, 1.6)
  T.lineTo(1.02, 1.6)
  T.lineTo(1.02, 0)
  T.lineTo(0.58, 0)
  T.lineTo(0.58, 1.6)
  T.closePath()
  shapes.push([T, 0])
  const U = new THREE.Shape()
  U.moveTo(0, 2)
  U.lineTo(0, 0.72)
  U.absarc(0.72, 0.72, 0.72, Math.PI, Math.PI * 2, false)
  U.lineTo(1.44, 2)
  U.lineTo(1.0, 2)
  U.lineTo(1.0, 0.72)
  U.absarc(0.72, 0.72, 0.28, 0, -Math.PI, true)
  U.lineTo(0.44, 2)
  U.closePath()
  shapes.push([U, 1.72])
  const slash = new THREE.Shape()
  slash.moveTo(0, -0.05)
  slash.lineTo(0.42, -0.05)
  slash.lineTo(1.25, 2.25)
  slash.lineTo(0.83, 2.25)
  slash.closePath()
  shapes.push([slash, 3.15])
  const e = new THREE.Shape()
  const Ro = 0.76
  const r = 0.36
  const gap = 0.7
  e.moveTo(Ro, 0)
  e.absarc(0, 0, Ro, 0, Math.PI * 2 - gap, false)
  e.lineTo(r * Math.cos(-gap), r * Math.sin(-gap))
  e.absarc(0, 0, r, -gap, -Math.PI, true)
  e.lineTo(r, 0)
  e.closePath()
  const eye = new THREE.Path()
  const a0 = Math.asin(0.15 / r)
  eye.moveTo(r * Math.cos(a0), 0.15)
  eye.absarc(0, 0, r, a0, Math.PI - a0, false)
  eye.closePath()
  e.holes.push(eye)
  shapes.push([e, 4.55])
  const geos = shapes.map(([s, x]) => {
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.018, bevelSegments: 2, curveSegments: 16 })
    if (s === e) g.translate(0.76, 0.76, 0)
    g.translate(x, 0, -0.17)
    return g
  })
  const g = mergeGeometries(geos, false)
  g.translate(-3.04, 0, 0)
  return g
}

/**
 * The lawn's TU/e sign as it really is (kenneth-07, amara-05): flat red plates
 * about 6 cm thick, bolted to the front of a galvanised I-beam people sit on.
 * Measured off the photo, in cap heights: T 0.83 wide (bar 0.18, stem 0.25),
 * U 0.88 wide (strokes 0.2), the slash rising a little above the caps and
 * dropping 0.17 below them, a round lowercase e 0.75 across.
 * Cap height H metres; baseline at y = 0; centred on x; faces +Z, back at z = 0.
 */
function tueSign(THREE, H = 1.3) {
  const sh = []
  const T = new THREE.Shape()
  T.moveTo(0, 0.82)
  T.lineTo(0, 1)
  T.lineTo(0.83, 1)
  T.lineTo(0.83, 0.82)
  T.lineTo(0.54, 0.82)
  T.lineTo(0.54, 0)
  T.lineTo(0.29, 0)
  T.lineTo(0.29, 0.82)
  T.closePath()
  sh.push(T)
  // U: two stems and a deep round bowl, its bottom a touch below the line
  const u0 = 0.93
  const R = 0.44
  const w = 0.2
  const cy = R - 0.03
  const U = new THREE.Shape()
  U.moveTo(u0, 1)
  U.lineTo(u0, cy)
  U.absarc(u0 + R, cy, R, Math.PI, Math.PI * 2, false)
  U.lineTo(u0 + 2 * R, 1)
  U.lineTo(u0 + 2 * R - w, 1)
  U.lineTo(u0 + 2 * R - w, cy)
  U.absarc(u0 + R, cy, R - w, 0, -Math.PI, true)
  U.lineTo(u0 + w, 1)
  U.closePath()
  sh.push(U)
  const sl = new THREE.Shape()
  sl.moveTo(1.79, -0.17)
  sl.lineTo(1.98, -0.17)
  sl.lineTo(2.45, 1.07)
  sl.lineTo(2.26, 1.07)
  sl.closePath()
  sh.push(sl)
  // e: a ring open at the lower right, a bar across its middle
  const ex = 2.72
  const ey = 0.33
  const ro = 0.375
  const ri = ro - 0.165
  const yb = -0.045 // bar's underside, from the centre
  const yt = 0.065 // bar's top
  const aGap = Math.asin(yb / ro) // where the bar meets the outer ring on the right
  const aTerm = -0.52 // the terminal, about 4 o'clock
  const e = new THREE.Shape()
  e.moveTo(ex + ro * Math.cos(aGap), ey + ro * Math.sin(aGap))
  e.absarc(ex, ey, ro, aGap, Math.PI * 2 + aTerm, false)
  e.lineTo(ex + ri * Math.cos(aTerm), ey + ri * Math.sin(aTerm))
  e.absarc(ex, ey, ri, Math.PI * 2 + aTerm, Math.PI - Math.asin(yb / ri), true)
  e.lineTo(ex + ro * Math.cos(aGap), ey + yb)
  e.closePath()
  const eye = new THREE.Path()
  const a0 = Math.asin(yt / ri)
  eye.moveTo(ex + ri * Math.cos(a0), ey + yt)
  eye.absarc(ex, ey, ri, a0, Math.PI - a0, false)
  eye.closePath()
  e.holes.push(eye)
  sh.push(e)
  const D = 0.06 / H
  const geos = sh.map((x) => new THREE.ExtrudeGeometry(x, { depth: D, bevelEnabled: true, bevelThickness: 0.004 / H, bevelSize: 0.004 / H, bevelSegments: 1, curveSegments: 20 }))
  const g = mergeGeometries(geos, false)
  g.translate(-(ex + ro) / 2, 0, 0)
  g.scale(H, H, H)
  return g
}

/** A flag on its pole, waving: { mesh, tick(t) }. */
function flag(THREE, paint, { x, z, h = 10, rot = 0, seed = 1 }) {
  const c = document.createElement('canvas')
  c.width = 192
  c.height = 128
  paint(c.getContext('2d'), 192, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const geo = new THREE.PlaneGeometry(2.4, 1.6, 10, 2)
  geo.translate(1.2, 0, 0)
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }))
  mesh.position.set(x, h - 0.9, z)
  mesh.rotation.y = rot
  mesh.castShadow = true
  const pos = geo.attributes.position
  const base = Float32Array.from(pos.array)
  return {
    mesh,
    tick(t) {
      for (let i = 0; i < pos.count; i++) {
        const px = base[i * 3]
        const k = px / 2.4
        pos.setZ(i, Math.sin(px * 2.2 - t * 3.1 + seed) * 0.16 * k + Math.sin(px * 4.1 - t * 4.7) * 0.05 * k)
      }
      pos.needsUpdate = true
    },
  }
}

/* --- props ------------------------------------------------------------------ */

/** A Dutch city bike, along +X, wheels on the ground. */
function bikeGeometry(THREE) {
  const parts = []
  const up = new THREE.Vector3(0, 1, 0)
  for (const x of [-0.53, 0.53]) {
    const t = new THREE.TorusGeometry(0.33, 0.022, 4, 18)
    t.translate(x, 0.35, 0)
    parts.push(t)
    const hub = new THREE.CylinderGeometry(0.035, 0.035, 0.1, 6)
    hub.rotateX(Math.PI / 2)
    hub.translate(x, 0.35, 0)
    parts.push(hub)
  }
  const tube = (a, b, r = 0.018) => {
    const A = new THREE.Vector3(...a)
    const B = new THREE.Vector3(...b)
    const len = A.distanceTo(B)
    const g = new THREE.CylinderGeometry(r, r, len, 5, 1, true)
    g.translate(0, len / 2, 0)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, B.clone().sub(A).normalize()))
    g.translate(A.x, A.y, A.z)
    parts.push(g)
  }
  tube([-0.53, 0.35, 0], [-0.05, 0.3, 0])
  tube([-0.53, 0.35, 0], [-0.21, 0.86, 0])
  tube([-0.05, 0.3, 0], [-0.21, 0.9, 0], 0.021)
  tube([-0.05, 0.3, 0], [0.4, 0.76, 0], 0.023)
  tube([-0.08, 0.42, 0], [0.38, 0.84, 0], 0.02)
  tube([0.38, 0.7, 0], [0.43, 1.02, 0], 0.026)
  tube([0.4, 0.72, 0], [0.53, 0.35, 0], 0.017)
  tube([0.43, 1.02, 0], [0.3, 1.06, 0.27], 0.014)
  tube([0.43, 1.02, 0], [0.3, 1.06, -0.27], 0.014)
  const saddle = new THREE.BoxGeometry(0.26, 0.06, 0.15)
  saddle.translate(-0.23, 0.94, 0)
  parts.push(saddle)
  const carrier = new THREE.BoxGeometry(0.46, 0.025, 0.15)
  carrier.translate(-0.45, 0.8, 0)
  parts.push(carrier)
  const guard = new THREE.BoxGeometry(0.52, 0.1, 0.03)
  guard.translate(-0.3, 0.36, 0.07)
  parts.push(guard)
  const lamp = new THREE.BoxGeometry(0.08, 0.08, 0.08)
  lamp.translate(0.5, 0.82, 0)
  parts.push(lamp)
  return mergeGeometries(
    parts.map((g) => (g.index ? g.toNonIndexed() : g)),
    false
  )
}

/** Rows of bikes in steel hoop racks: [{ x, z, len, dir, fill }]. */
function addBikes(THREE, scene, rows, rand) {
  const list = []
  const hoops = beamBatch(THREE)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  for (const r of rows) {
    const ax = Math.cos(r.dir)
    const az = -Math.sin(r.dir)
    const count = Math.floor(r.len / 0.72)
    for (let i = 0; i < count; i++) {
      const t = -r.len / 2 + (i + 0.5) * (r.len / count)
      const x = r.x + ax * t
      const z = r.z + az * t
      if (i % 2 === 0) {
        const px = -az
        const pz = ax
        const a = V(x + px * 0.35 + ax * 0.2, 0, z + pz * 0.35 + az * 0.2)
        const b = V(x - px * 0.35 + ax * 0.2, 0, z - pz * 0.35 + az * 0.2)
        hoops.add(a, a.clone().setY(0.75), 0.05)
        hoops.add(b, b.clone().setY(0.75), 0.05)
        hoops.add(a.clone().setY(0.75), b.clone().setY(0.75), 0.05)
      }
      if (rand() < (r.fill ?? 0.8)) list.push({ x, z, yaw: r.dir + Math.PI / 2 + range(rand, -0.12, 0.12) + (rand() < 0.5 ? Math.PI : 0) })
    }
  }
  scene.add(hoops.build(new THREE.MeshStandardMaterial({ color: 0x8c8f93, metalness: 0.8, roughness: 0.35 })))
  if (!list.length) return
  const bikes = new THREE.InstancedMesh(bikeGeometry(THREE), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.4 }), list.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3(1, 1, 1)
  const col = new THREE.Color()
  const palette = [0x161616, 0x1b1c1e, 0x111214, 0x22262c, 0x2d3d52, 0x7a1f1f, 0x6b6e70, 0xc9c1ad, 0x23402e, 0x1d4f7a]
  const yAxis = new THREE.Vector3(0, 1, 0)
  list.forEach((b, i) => {
    q.setFromAxisAngle(yAxis, b.yaw)
    m.compose(new THREE.Vector3(b.x, 0, b.z), q, s)
    bikes.setMatrixAt(i, m)
    bikes.setColorAt(i, col.setHex(pick(rand, palette)))
  })
  bikes.castShadow = true
  bikes.instanceMatrix.needsUpdate = true
  if (bikes.instanceColor) bikes.instanceColor.needsUpdate = true
  scene.add(bikes)
}

/** Slim campus lamp posts with a flat LED head. */
function addLampPosts(THREE, scene, spots, { height = 6 } = {}) {
  if (!spots.length) return
  const metal = new THREE.MeshStandardMaterial({ color: 0x3b3e42, metalness: 0.7, roughness: 0.4 })
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.085, height, 8).translate(0, height / 2, 0), metal, spots.length)
  const headGeo = new THREE.BoxGeometry(0.75, 0.09, 0.22).translate(0.3, height, 0)
  const head = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0x2f3236, metalness: 0.6, roughness: 0.4, emissive: 0xfff1d8, emissiveIntensity: 0.05 }), spots.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  const yAxis = new THREE.Vector3(0, 1, 0)
  spots.forEach((s, i) => {
    q.setFromAxisAngle(yAxis, s.r || 0)
    m.compose(new THREE.Vector3(s.x, s.y || 0, s.z), q, one)
    pole.setMatrixAt(i, m)
    head.setMatrixAt(i, m)
  })
  pole.castShadow = head.castShadow = true
  scene.add(pole, head)
}

/** Instanced boxes from a list of { x, y, z, w, h, d, r } (unit box scaled), optional per-instance colour. */
function instBoxes(THREE, scene, list, mat, { cast = true, geo = null } = {}) {
  if (!list.length) return null
  const mesh = new THREE.InstancedMesh(geo || new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, list.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const col = new THREE.Color()
  list.forEach((b, i) => {
    q.setFromAxisAngle(yAxis, b.r || 0)
    m.compose(new THREE.Vector3(b.x, b.y || 0, b.z), q, new THREE.Vector3(b.w, b.h, b.d))
    mesh.setMatrixAt(i, m)
    if (b.c !== undefined) mesh.setColorAt(i, col.setHex(b.c))
  })
  mesh.castShadow = cast
  mesh.receiveShadow = true
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  scene.add(mesh)
  return mesh
}

/* --- the place --------------------------------------------------------------------------- */

export function buildCampus(THREE, ctx, { light = 'overcast' } = {}) {
  void light // the photos are overcast; the photographer wants the campus under a blue sky
  ctx.sky = null
  const world = createWorld(THREE, ctx, 'day', {
    sun: { elevation: 41, azimuth: 335 },
    sky: { zenith: 0x3f7fd0, horizon: 0xbcd6ee, clouds: 0.26 },
    fog: { color: 0xc6dbee, density: 0.00055 },
  })
  const { scene } = world
  const low = ctx.quality === 'low'
  const q = ctx.quality
  const S = low ? 256 : 512
  const s2 = low ? 128 : 256
  const rand = seeded(1956)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const batch = makeBatch(THREE) // opaque, casts shadows
  const glassBatch = makeBatch(THREE) // glass, light fittings: no shadows
  const steel = beamBatch(THREE) // grey steel: stair stringers, railings, frames
  const stainless = beamBatch(THREE)
  const wood = beamBatch(THREE) // handrails and caps
  const dark = beamBatch(THREE) // mullions
  const lights = beamBatch(THREE) // linear light tubes (glowing)
  const roofBeams = beamBatch(THREE) // the atrium's matte black roof grid

  /* materials -------------------------------------------------------------------------- */
  const tiles = M.paving(THREE, { kind: 'flags', color: '#b8b5ad', joint: '#7a7872', unit: 0.6, tile: 4, quality: 'low', seed: 6 })
  const setts = M.paving(THREE, { kind: 'setts', color: '#8a6450', joint: '#4a3b33', unit: 0.22, tile: 3, wet: 0.35, quality: 'low', seed: 7 })
  const lawn = M.lawn(THREE, { color: '#5f8a3a', worn: 0.1, tile: 3, quality: q, seed: 10 })
  const hedge = M.lawn(THREE, { color: '#3d6128', worn: 0, tile: 1.5, quality: 'low', seed: 11 })
  const asphalt = M.asphalt(THREE, { color: '#4a4b4e', tile: 6, quality: 'low' })
  const concrete = M.concrete(THREE, { color: '#b8ae9e', tile: 4, ties: true, quality: q, seed: 3 })
  const smooth = M.concrete(THREE, { color: '#c9c4ba', tile: 3, ties: false, quality: 'low', seed: 9 })
  const brick = M.brick(THREE, { color: '#8a4430', tile: 2, quality: 'low', seed: 4 })
  const benchWood = M.planks(THREE, { color: '#7a6048', width: 0.09, tile: 2, quality: 'low', seed: 5 })
  const darkWood = M.planks(THREE, { color: '#4a3527', width: 0.3, tile: 2, varnish: 0.25, quality: 'low', seed: 15 })
  const stageWood = M.planks(THREE, { color: '#55575a', width: 0.14, tile: 2, varnish: 0.3, quality: 'low', seed: 16 })
  const stairWood = M.planks(THREE, { color: '#5b3b27', width: 0.2, tile: 2, quality: 'low', seed: 14 })
  const parquet = M.planks(THREE, { color: '#c9a477', width: 0.1, tile: 2, varnish: 0.6, quality: 'low', seed: 17 })
  const travertine = M.floor(THREE, { kind: 'tile', color: '#d8b98c', tileSize: 0.8, polish: 0.3, tile: 4, quality: 'low', seed: 18 })
  const greyFloor = M.floor(THREE, { kind: 'concrete', color: '#b4b1aa', polish: 0.18, tile: 4, quality: 'low', seed: 19 })
  const stoneFloor = M.floor(THREE, { kind: 'tile', color: '#85878a', tileSize: 1.0, polish: 0.5, tile: 4, quality: 'low', seed: 20 })
  const granite = M.floor(THREE, { kind: 'terrazzo', color: '#8e8e8c', polish: 0.25, tile: 2, quality: 'low', seed: 21 })
  const plaster = M.plaster(THREE, { color: '#eceae5', dirt: 0.04, tile: 3, quality: 'low', seed: 22 })
  const beige = M.plaster(THREE, { color: '#d4bf9b', dirt: 0.08, tile: 3, quality: 'low', seed: 23 })
  // indoors the sky would mirror in polished floors: keep their reflections low, warm them a touch
  for (const m of [travertine, greyFloor, stoneFloor, parquet, stageWood, darkWood, stairWood, plaster, beige]) {
    m.envMapIntensity = 0.45
    m.emissive = new THREE.Color(0x1a140c)
  }
  const atlasGlass = pbrMat(THREE, atlasTex(THREE, S), { envMapIntensity: 1.35 })
  const frit = pbrMat(THREE, fritTex(THREE, s2), { envMapIntensity: 1.2 })
  const darkGlass = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [7.5, 6.2], cols: 5, rows: 1, wall: [0.18, 0.19, 0.2], win: [0, 1, 0, 1], frame: [0.16, 0.17, 0.18], fw: 0.06, transom: 0.62, glass: [0.22, 0.27, 0.3], blinds: 0, seed: 51 }),
    { envMapIntensity: 1.1 }
  )
  const foyer = pbrMat(
    THREE,
    facadeTex(THREE, 128, { tile: [7.5, 8], cols: 5, rows: 2, wall: [0.2, 0.21, 0.22], win: [0, 1, 0, 1], frame: [0.2, 0.21, 0.22], fw: 0.05, glass: [0.3, 0.36, 0.4], blinds: 0, lit: 0.45, litColor: [1, 0.88, 0.7], seed: 57 }),
    { envMapIntensity: 1.1, emissiveIntensity: 0.6 }
  )
  const gemini = pbrMat(THREE, facadeTex(THREE, 128, { tile: [7.2, 7.2], cols: 4, rows: 2, wall: [0.7, 0.7, 0.68], win: [0, 1, 0.42, 0.92], frame: [0.32, 0.32, 0.33], fw: 0.06, glass: [0.32, 0.42, 0.5], blinds: 0.3, seed: 53 }), { envMapIntensity: 1.1 })
  const vertigo = pbrMat(THREE, facadeTex(THREE, 128, { tile: [7.2, 7.2], cols: 4, rows: 2, wall: [0.72, 0.7, 0.66], win: [0.12, 0.88, 0.3, 0.86], frame: [0.25, 0.25, 0.26], fw: 0.06, glass: [0.3, 0.4, 0.48], blinds: 0.3, joints: true, seed: 54 }), { envMapIntensity: 1.1 })
  const flux = pbrMat(THREE, facadeTex(THREE, 128, { tile: [7.2, 8], cols: 4, rows: 2, wall: [0.9, 0.9, 0.88], wallRough: 0.45, win: [0.08, 0.92, 0.28, 0.95], frame: [0.84, 0.85, 0.86], fw: 0.05, mull: 2, glass: [0.32, 0.46, 0.5], blinds: 0.3, seed: 52 }), { envMapIntensity: 1.1 })
  const hallFacade = pbrMat(THREE, facadeTex(THREE, 128, { tile: [6, 6], cols: 2, rows: 1, wall: [0.5, 0.27, 0.19], win: [0.05, 0.95, 0.3, 0.88], frame: [0.18, 0.18, 0.19], fw: 0.06, mull: 3, glass: [0.28, 0.36, 0.42], blinds: 0.1, seed: 55 }), { envMapIntensity: 1 })
  const cityMat = pbrMat(THREE, facadeTex(THREE, 128, { tile: [12, 12], cols: 4, rows: 4, wall: [0.7, 0.64, 0.56], win: [0.1, 0.9, 0.25, 0.85], frame: [0.3, 0.3, 0.3], fw: 0.06, mull: 2, glass: [0.3, 0.38, 0.45], blinds: 0.2, seed: 56 }), { envMapIntensity: 0.9 })
  const office = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [7.2, 4.5], cols: 3, rows: 1, wall: [0.8, 0.8, 0.79], wallRough: 0.6, win: [0.06, 0.94, 0.22, 0.86], frame: [0.14, 0.14, 0.15], fw: 0.05, mull: 2, glass: [0.3, 0.32, 0.34], blinds: 0.1, lit: 0.85, litColor: [1, 0.86, 0.6], seed: 58 }),
    { envMapIntensity: 0.8, emissiveIntensity: 1.1 }
  )
  const rubber = pbrMat(THREE, rubberTex(THREE, s2), { envMapIntensity: 0.5 })
  const slats = pbrMat(THREE, slatTex(THREE, 128))
  const drum = pbrMat(THREE, drumTex(THREE, s2))
  const perf = pbrMat(THREE, perfTex(THREE, 128))
  const redGloss = new THREE.MeshPhysicalMaterial({ color: 0xd3202a, roughness: 0.42, metalness: 0.02, clearcoat: 0.5, clearcoatRoughness: 0.3 })
  const redMatte = new THREE.MeshStandardMaterial({ color: 0xd8301f, roughness: 0.78 })
  const redSteel = new THREE.MeshStandardMaterial({ color: 0xd4291c, roughness: 0.32, metalness: 0.25 })
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2c2e31, metalness: 0.7, roughness: 0.38 })
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x8d9094, metalness: 0.75, roughness: 0.35 })
  const stainlessMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.2 })
  const galv = new THREE.MeshStandardMaterial({ color: 0x9fa3a6, metalness: 0.85, roughness: 0.45 })
  const whiteAlu = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, metalness: 0.3, roughness: 0.35 })
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.7 })
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, metalness: 0.2 })
  const blueSeat = new THREE.MeshStandardMaterial({ color: 0x23488c, roughness: 0.8 })
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.55 })
  const grolsch = new THREE.MeshStandardMaterial({ color: 0x1f5a35, roughness: 0.5 })
  const glass = new THREE.MeshStandardMaterial({ color: 0xa9c3cf, metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 })
  const balGlass = new THREE.MeshStandardMaterial({ color: 0xb8d6cf, metalness: 0.5, roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide })
  const warmGlass = new THREE.MeshStandardMaterial({ color: 0x8a7a62, emissive: 0xffd9a0, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.12 })
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.35, 2.2) })
  const glowWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.0, 1.5) })
  const atlasTexSigns = signAtlas(THREE)
  const signs = new THREE.MeshStandardMaterial({ map: atlasTexSigns, emissiveMap: atlasTexSigns, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.6, alphaTest: 0.5 })
  const signsLit = new THREE.MeshStandardMaterial({ map: atlasTexSigns, emissiveMap: atlasTexSigns, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.5 })
  const signsMetal = new THREE.MeshStandardMaterial({ map: atlasTexSigns, roughness: 0.32, metalness: 0.85 })
  const sign = (mat, r, w, h, x, y, z, ry = 0) => batch.add(mat, signGeo(THREE, r, w, h), x, y, z, ry)

  /* the ground ------------------------------------------------------------------------- */
  scene.add(flat(THREE, 3000, 3000, lawn, 3, 0, 0, 0))
  // plaza round Atlas, the east square by the pond, the north side, the MetaForum square
  scene.add(flat(THREE, 220, 17.5, tiles, 4, 30, 0.03, -10.75))
  scene.add(flat(THREE, 74, 14, tiles, 4, 103, 0.03, 5))
  scene.add(flat(THREE, 110, 24.5, tiles, 4, 85, 0.03, -31.75))
  scene.add(flat(THREE, 260, 36, tiles, 4, 40, 0.03, -62))
  scene.add(flat(THREE, 120, 60, setts, 3, -20, 0.03, -155))
  // the cycle path in front of Atlas, the ring road, the west road
  scene.add(flat(THREE, 160, 4.6, asphalt, 6, -20, 0.04, 2.0))
  scene.add(flat(THREE, 900, 12, asphalt, 6, 0, 0.04, 78))
  scene.add(flat(THREE, 12, 600, asphalt, 6, -112, 0.04, -60))
  // paths over the south lawn
  for (const [x0, z0, x1, z1] of [
    [-12, 4, 40, 60],
    [30, 4, 30, 72],
    [-60, 4, -20, 72],
    [48, -2, 78, 40],
  ]) {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const g = new THREE.PlaneGeometry(3, len)
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 3) / 4, (uv.getY(i) * len) / 4)
    g.rotateX(-Math.PI / 2)
    g.rotateY(Math.atan2(x1 - x0, z1 - z0))
    batch.add(tiles, g, (x0 + x1) / 2, 0.035, (z0 + z1) / 2)
  }
  // hedges between the plaza and the cycle path (gaps for the paths)
  for (const [x0, x1] of [
    [-75, -14],
    [-4, 26],
  ]) batch.span(hedge, x0, x1, 0, 0.95, -2.2, -0.6, [1.5, 1.5])

  /* =====================================================================================
   * ATLAS
   * ===================================================================================== */
  const FL = 0.68 // the hall floor (four steps up)
  const MZ = FL + 4.5 // the mezzanine floor
  const B0 = 8.4 // top of the pillars / clerestory sill
  const B1 = 11.4 // underside of the glass slab
  const TOP = B1 + 3.75 * 10
  const AX0 = -75
  const AX1 = 75
  const ZN = -44
  const ZS = -19
  const HX0 = -67.5
  const HX1 = 30
  const GN = -41.5
  const GS = -21.5
  const VN = -36
  const VS = -27
  const ZC = -31.5
  const CZN = -40.2
  const CZS = -22.8
  const OX0 = -26.25
  const OX1 = -11.25
  /** The folded concrete ceiling of the hall: valleys at the pillars along the facades. */
  const ceilH = (x, z) => {
    const m = (((x + 71.25) % 7.5) + 7.5) % 7.5
    const s = Math.abs(m - 3.75) / 3.75
    const c = Math.min(1, Math.abs(z - ZC) / 10)
    return 8.4 * s * c + 11.4 * (1 - s) * c + 11.4 * s * (1 - c) + 9.9 * (1 - s) * (1 - c)
  }

  {
    // the glass slab, its roof band, the plant on the roof
    const L = AX1 - AX0
    const D = ZS - ZN
    const slab = boxGeo(THREE, L, TOP - B1, D, [5.4, 7.5])
    const idx = Array.from(slab.index.array)
    idx.splice(18, 6) // the −Y face
    slab.setIndex(idx)
    slab.clearGroups()
    const box = new THREE.Mesh(slab, atlasGlass)
    box.position.set(0, B1, (ZN + ZS) / 2)
    box.castShadow = box.receiveShadow = true
    scene.add(box)
    batch.span(darkMetal, AX0 - 0.15, AX1 + 0.15, TOP, TOP + 1.3, ZN - 0.15, ZS + 0.15)
    batch.span(smooth, -42, -10, TOP + 1.3, TOP + 5.5, -37, -26, [3, 3])
    batch.span(darkMetal, -36, -18, TOP + 5.5, TOP + 6.2, -35, -28)
    batch.span(smooth, 30, 46, TOP + 1.3, TOP + 4.2, -36, -27, [3, 3])
    // the floor bands step up and down where the stair climbs through (photo amara-05)
    const steps = []
    for (const zf of [ZS + 0.04, ZN - 0.04]) {
      for (let st = 0; st < 9; st++) {
        let x = AX0 + 4 + rand() * 20
        while (x < AX1 - 10) {
          const run = 1.35 * Math.floor(range(rand, 5, 16))
          if (rand() < 0.45) steps.push({ x: x + run / 2, y: B1 + 3.75 * (st + 0.5) + 0.3, z: zf, w: run, h: 0.26, d: 0.06 })
          x += run + 1.35 * Math.floor(range(rand, 6, 20))
        }
      }
    }
    instBoxes(THREE, scene, steps, new THREE.MeshStandardMaterial({ color: 0x23272d, metalness: 0.5, roughness: 0.25 }), { cast: false })
    // the west core, closed to the ground
    batch.add(darkGlass, boxGeo(THREE, HX0 - AX0, B1, D, [7.5, 6.2]), (AX0 + HX0) / 2, 0, (ZN + ZS) / 2)
    // the colonnade's beam at the east end
    batch.span(concrete, HX1, AX1, B0, B1, ZN, ZS, [4, 4])
    // soffits of the slab's overhang over the hall
    batch.span(smooth, HX0, HX1, B1 - 0.3, B1, ZN, GN, [3, 3])
    batch.span(smooth, HX0, HX1, B1 - 0.3, B1, GS, ZS, [3, 3])
  }

  /* pillars: board-marked, flaring under the slab -------------------------------------- */
  {
    const colGeo = boxGeo(THREE, 1.1, B1, 1.1, [4, 4])
    const brk = new THREE.CylinderGeometry(1.9, 0.78, 1.5, 4, 1)
    brk.rotateY(Math.PI / 4)
    brk.scale(1, 1, 0.8)
    brk.translate(0, B0 - 0.75, 0)
    const pil = []
    for (let k = 1; k < 20; k++) for (const z of [CZN, CZS]) pil.push([-71.25 + 7.5 * k, z])
    const cols = new THREE.InstancedMesh(colGeo, concrete, pil.length)
    const brks = new THREE.InstancedMesh(brk, concrete, pil.length)
    const m4 = new THREE.Matrix4()
    pil.forEach(([x, z], i) => {
      m4.makeTranslation(x, 0, z)
      cols.setMatrixAt(i, m4)
      brks.setMatrixAt(i, m4)
    })
    for (const mesh of [cols, brks]) {
      mesh.castShadow = mesh.receiveShadow = true
      scene.add(mesh)
    }
  }

  /* the hall: floor, terrace and steps, mezzanines ----------------------------------------- */
  {
    batch.span(granite, HX0, HX1, 0, FL - 0.05, GN - 0.6, GS, [2, 2])
    batch.span(granite, HX0, HX1, 0, FL, GS, -17.5, [2, 2])
    for (let k = 1; k <= 3; k++) batch.span(granite, HX0 + 2, HX1 - 2, 0, FL - k * 0.17, -17.5, -17.5 + k * 0.35, [2, 2])
    batch.add(travertine, flatGeo(HX1 - HX0, GS - GN, 4), (HX0 + HX1) / 2, FL, (GN + GS) / 2)
    // mezzanine slabs: white soffit, light grey floor
    for (const [z0, z1] of [
      [GN, VN],
      [VS, GS],
    ]) {
      batch.span(plaster, HX0, HX1, MZ - 0.45, MZ - 0.04, z0, z1, [3, 3])
      batch.add(greyFloor, flatGeo(HX1 - HX0, z1 - z0, 4), (HX0 + HX1) / 2, MZ, (z0 + z1) / 2)
    }
    // downlights under the mezzanines
    const dl = []
    for (let x = HX0 + 2; x < HX1; x += 2.5) for (const z of [GN + 1.6, VN - 1.6, VS + 1.6, GS - 1.6]) dl.push({ x, y: MZ - 0.47, z, w: 0.22, h: 0.02, d: 0.22 })
    instBoxes(THREE, scene, dl, glow, { cast: false })

    // the folded ceiling, open over the stair's upper flight
    const xs = []
    for (let x = HX0; x <= HX1 + 0.01; x += 3.75) xs.push(x)
    const zs = [GN, VN, ZC, VS, GS]
    const pos = []
    const uv = []
    const pt = (x, z) => {
      pos.push(x, ceilH(x, z), z)
      uv.push(x / 4, z / 4)
    }
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < zs.length - 1; j++) {
        const xa = xs[i]
        const xb = xs[i + 1]
        const za = zs[j]
        const zb = zs[j + 1]
        if ((xa + xb) / 2 > OX0 && (xa + xb) / 2 < OX1 && (za + zb) / 2 > VN && (za + zb) / 2 < VS) continue
        pt(xa, za)
        pt(xb, za)
        pt(xa, zb)
        pt(xb, za)
        pt(xb, zb)
        pt(xa, zb)
      }
    }
    const cg = new THREE.BufferGeometry()
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    cg.computeVertexNormals()
    batch.add(concrete, cg)
    // light tracks along the folds
    for (const z of [VN + 0.3, VS - 0.3]) {
      for (let i = 0; i < xs.length - 1; i++) {
        const xa = xs[i]
        const xb = xs[i + 1]
        if ((xa + xb) / 2 > OX0 && (xa + xb) / 2 < OX1) continue
        lights.add(V(xa, ceilH(xa, z) - 0.06, z), V(xb, ceilH(xb, z) - 0.06, z), 0.05, 0.08)
      }
    }

    // the light well over the upper flight: walls up through the slab's floors
    const wellTop = B1 + 8.2
    const wallUnder = (pts) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [xa, za] = pts[i]
        const [xb, zb] = pts[i + 1]
        const a = V(xa, ceilH(xa, za), za)
        const b = V(xb, ceilH(xb, zb), zb)
        const c = V(xb, wellTop, zb)
        const d = V(xa, wellTop, za)
        batch.quad(plaster, a, b, c, d, [3, 3], true)
      }
    }
    const along = (z) => [OX0, OX0 + 3.75, OX0 + 7.5, OX0 + 11.25, OX1].map((x) => [x, z])
    wallUnder(along(VN))
    wallUnder(along(VS))
    wallUnder([
      [OX0, VN],
      [OX0, ZC],
      [OX0, VS],
    ])
    wallUnder([
      [OX1, VN],
      [OX1, ZC],
      [OX1, VS],
    ])
    batch.span(plaster, OX0, OX1, wellTop, wellTop + 0.3, VN, VS, [3, 3])
    for (const y of [B1 + 3.75, B1 + 7.5]) {
      for (const [x0, x1, z0, z1] of [
        [OX0, OX1, VN, VN + 0.5],
        [OX0, OX1, VS - 0.5, VS],
      ]) batch.span(smooth, x0, x1, y - 0.35, y, z0, z1, [3, 3])
    }
    for (let k = 0; k < 4; k++) glassBatch.span(glow, OX0 + 2 + k * 3.4, OX0 + 3.8 + k * 3.4, wellTop - 0.06, wellTop, ZC - 0.6, ZC + 0.6)
    // the floor the upper flight lands on
    batch.span(darkWood, OX0, -21.33, B1 - 0.3, B1, VN, VS, [2, 2])

    // glazing: ground floor and mezzanine walls, both long sides, mullions every 1.875 m
    for (const zg of [GN, GS]) {
      glassBatch.add(glass, new THREE.PlaneGeometry(HX1 - HX0, MZ - 0.45 - FL), (HX0 + HX1) / 2, (FL + MZ - 0.45) / 2, zg)
      glassBatch.add(glass, new THREE.PlaneGeometry(HX1 - HX0, B0 - MZ), (HX0 + HX1) / 2, (MZ + B0) / 2, zg)
      for (let x = HX0; x <= HX1 + 0.01; x += 1.875) {
        dark.add(V(x, FL, zg), V(x, MZ - 0.45, zg), 0.07, 0.14)
        dark.add(V(x, MZ, zg), V(x, B0, zg), 0.07, 0.14)
      }
      dark.add(V(HX0, FL + 3.0, zg), V(HX1, FL + 3.0, zg), 0.06, 0.12)
      dark.add(V(HX0, B0, zg), V(HX1, B0, zg), 0.08, 0.14)
      // the white fascia at the mezzanine floor (the band over the ground floor seen outside)
      const fz = zg === GS ? zg + 0.15 : zg - 0.15
      batch.span(whiteAlu, HX0, HX1, MZ - 0.62, MZ + 0.12, fz - 0.12, fz + 0.12)
      // the clerestories: a glass triangle under each rising fold, concrete over it
      for (let i = 0; i < 26; i++) {
        const xa = HX0 + 3.75 * i
        const xb = xa + 3.75
        const ha = ceilH(xa, zg)
        const hb = ceilH(xb, zg)
        glassBatch.quad(glass, V(xa, B0, zg), V(xb, B0, zg), V(xb, hb, zg), V(xa, ha, zg), [2, 2])
        batch.quad(concrete, V(xa, ha, zg), V(xb, hb, zg), V(xb, B1, zg), V(xa, B1, zg), [4, 4], true)
        dark.add(V(xa, ha, zg), V(xb, hb, zg), 0.08, 0.12)
        if (ha > hb) dark.add(V(xa, B0, zg), V(xa, ha, zg), 0.07, 0.12)
      }
    }
    // the main entrance doors (south) and the World Press Photo lettering on the glass
    for (const x of [-15, -12, -9]) dark.add(V(x, FL, GS + 0.02), V(x, FL + 2.6, GS + 0.02), 0.1, 0.1)
    dark.add(V(-15, FL + 2.6, GS + 0.02), V(-9, FL + 2.6, GS + 0.02), 0.1, 0.1)
    sign(signs, R.press, 2.8, 1.4, -6.6, FL + 2.0, GS + 0.05)
    // the east end wall: glass onto the colonnade, concrete over it up to the folds
    glassBatch.add(glass, new THREE.PlaneGeometry(GS - GN, B0 - FL).rotateY(Math.PI / 2), HX1, (FL + B0) / 2, (GN + GS) / 2)
    for (let z = GN; z <= GS + 0.01; z += 1.875) dark.add(V(HX1, FL, z), V(HX1, B0, z), 0.12, 0.07)
    dark.add(V(HX1, MZ, GN), V(HX1, MZ, GS), 0.1, 0.1)
    for (let j = 0; j < 4; j++) {
      const za = [GN, VN, ZC, VS, GS][j]
      const zb = [GN, VN, ZC, VS, GS][j + 1]
      batch.quad(concrete, V(HX1, B0, za), V(HX1, B0, zb), V(HX1, ceilH(HX1, zb), zb), V(HX1, ceilH(HX1, za), za), [4, 4], true)
    }
  }

  /* the red stair ------------------------------------------------------------------------- */
  const W = 2.4
  {
    const flight = (xb, yb, n, rise, going, foot) => {
      const L = n * going
      const H = n * rise
      for (let i = 0; i < n; i++) {
        batch.box(darkWood, going + 0.02, 0.05, W - 0.04, xb - (i + 0.5) * going, yb + (i + 1) * rise - 0.05, ZC, [2, 2])
        batch.box(black, 0.03, rise, W - 0.04, xb - i * going, yb + i * rise, ZC, [2, 2])
      }
      // the dark soffit underneath
      const len = Math.hypot(L, H)
      const sg = boxGeo(THREE, len, 0.06, W + 0.1, [2, 2])
      sg.translate(0, -0.03, 0)
      sg.rotateZ(Math.PI - Math.atan2(H, L))
      batch.add(darkWood, sg, xb - L / 2, yb + H / 2 - 0.42, ZC)
      // the red side plates, lined with wood inside, wood cap on top
      const shape = (t) => {
        const s = new THREE.Shape()
        s.moveTo(0, foot)
        s.lineTo(L, H - 0.5)
        s.lineTo(L, H + 1.05 - t)
        s.lineTo(0, 1.05 - t)
        s.closePath()
        return s
      }
      const T = 0.24
      for (const side of [-1, 1]) {
        const g = new THREE.ExtrudeGeometry(shape(0), { depth: T, bevelEnabled: false })
        g.rotateY(Math.PI)
        batch.add(redSteel, g, xb, yb, ZC + side * (W / 2) + (side > 0 ? T : 0))
        const gl = new THREE.ExtrudeGeometry(shape(0.03), { depth: 0.02, bevelEnabled: false })
        gl.rotateY(Math.PI)
        batch.add(stairWood, gl, xb, yb, ZC + side * (W / 2 - 0.02) + (side > 0 ? 0.02 : 0))
      }
    }
    flight(0, FL, 26, 4.5 / 26, 0.3, 0)
    flight(OX1, MZ, 36, (B1 - MZ) / 36, 0.28, -0.5)
    // the landing: a red bridge across the void at mezzanine level
    batch.span(redSteel, OX1, -7.8, MZ - 0.45, MZ - 0.05, VN, VS)
    batch.add(darkWood, flatGeo(-7.8 - OX1, VS - VN, 2), (OX1 - 7.8) / 2, MZ, ZC)
    for (const x of [-7.8, OX1]) {
      for (const [z0, z1] of [
        [VN, ZC - W / 2],
        [ZC + W / 2, VS],
      ]) {
        batch.span(redSteel, x - 0.12, x + 0.12, MZ - 0.45, MZ + 1.05, z0, z1)
      }
    }
  }

  /* mezzanine balustrades: glass, stainless rail ------------------------------------------- */
  {
    for (const z of [VN, VS]) {
      for (const [x0, x1] of [
        [HX0, OX1],
        [-7.8, HX1],
      ]) {
        glassBatch.add(balGlass, new THREE.PlaneGeometry(x1 - x0, 1.0), (x0 + x1) / 2, MZ + 0.55, z)
        stainless.add(V(x0, MZ + 1.08, z), V(x1, MZ + 1.08, z), 0.05, 0.05)
        for (let x = x0; x <= x1 + 0.01; x += 1.5) stainless.add(V(x, MZ, z), V(x, MZ + 1.08, z), 0.04, 0.04)
      }
    }
    // the slab edges facing the void
    for (const z of [VN, VS]) batch.span(whiteAlu, HX0, HX1, MZ - 0.5, MZ + 0.04, z - 0.03, z + 0.03)
  }

  /* the hall's furniture --------------------------------------------------------------- */
  {
    // the red TU/e letters on the north mezzanine (photo adriel-01)
    const lg = tueLetters(THREE)
    lg.scale(0.8, 0.8, 0.8)
    const lt = new THREE.Mesh(lg, redMatte)
    lt.rotation.y = Math.PI
    lt.position.set(0.5, MZ, VN - 1.0)
    lt.castShadow = lt.receiveShadow = true
    scene.add(lt)
    // the white core on the south mezzanine with the steel TU/e plaques (adriel-03)
    batch.span(plaster, 8, 18, MZ, B0, -23.6, GS, [3, 3])
    for (const x of [11.2, 13, 14.8]) sign(signsMetal, R.plaque, 1.45, 1.45, x, MZ + 1.95, -23.63, Math.PI)
    // the Momentum photo wall (amara-01)
    batch.span(white, 21.4, 27.6, FL, FL + 3.3, -23.9, -23.7)
    sign(signs, R.backdrop, 6, 3, 24.5, FL + 1.65, -23.95, Math.PI)
    // red round benches round the pillars (amara-06)
    for (const [x, z] of [
      [3.75, CZS],
      [-18.75, CZN],
      [18.75, CZN],
      [-33.75, CZS],
    ]) {
      const g = new THREE.CylinderGeometry(1.25, 1.25, 0.44, 32)
      g.translate(0, 0.22, 0)
      batch.add(redMatte, g, x - 0.35, FL, z + (z > -30 ? -0.45 : 0.45))
    }
    // an A-board
    for (const s of [-1, 1]) {
      const g = boxGeo(THREE, 0.6, 1.1, 0.03, [1, 1])
      g.rotateX(s * 0.22)
      batch.add(black, g, 1.7, FL, -25.6 + s * 0.12)
    }
    // booth chairs: white shells, red insides (amara-02)
    const shells = []
    const cushions = []
    for (let i = 0; i < 8; i++) {
      const x = 4 + i * 1.9
      const z = i % 2 ? -38.2 : -36.9
      const r = i % 2 ? 0 : Math.PI
      shells.push({ x, y: FL, z, w: 1.1, h: 1.3, d: 0.95, r })
      cushions.push({ x, y: FL + 0.42, z: z + (r ? -0.06 : 0.06), w: 0.9, h: 0.75, d: 0.82, r })
    }
    instBoxes(THREE, scene, shells, white)
    instBoxes(THREE, scene, cushions, redMatte)
    // the Grolsch bar under the north mezzanine
    batch.span(grolsch, 19.7, 25.4, FL, FL + 1.05, -39.4, -38.5)
    batch.span(white, 19.6, 25.5, FL + 1.05, FL + 1.1, -39.5, -38.3)
    // the merchandise rail with red and grey hoodies (adriel-06)
    const RX = -37.4
    stainless.add(V(RX, FL + 1.75, -33), V(RX + 3.4, FL + 1.75, -33), 0.04, 0.04)
    for (const x of [RX, RX + 3.4]) stainless.add(V(x, FL, -33), V(x, FL + 1.75, -33), 0.04, 0.04)
    const hood = []
    for (let i = 0; i < 14; i++) hood.push({ x: RX + 0.2 + i * 0.22, y: FL + 0.85, z: -33, w: 0.08, h: 0.85, d: 0.5, c: i < 8 ? 0xc81f2a : 0x9a9b9d })
    instBoxes(THREE, scene, hood, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }))
    // the counter and high tables in white stretch covers
    batch.span(white, -31.5, -27, FL, FL + 1.05, -31.2, -30.4)
    for (const [x, z] of [
      [8, -31],
      [12, -29],
      [-41, -30],
      [-36, -29.5],
      [-44, -32],
    ]) {
      const g = new THREE.CylinderGeometry(0.33, 0.24, 1.1, 16)
      g.translate(0, 0.55, 0)
      batch.add(white, g, x, FL, z)
    }
    // TU/e banners hanging from the south balustrade into the void
    for (const x of [-52, -44, 6, 14]) sign(signs, R.banner, 1.4, 2.8, x, MZ - 1.0, VS - 0.06, Math.PI)
    // the lowered corridor ceiling on the north mezzanine's east end (amara-04)
    batch.span(plaster, 16, HX1, MZ + 3.0, MZ + 3.1, GN, VN + 0.2, [3, 3])
    const cdl = []
    for (let x = 17; x < HX1; x += 2.4) cdl.push({ x, y: MZ + 2.98, z: -38.8, w: 0.2, h: 0.02, d: 0.2 })
    instBoxes(THREE, scene, cdl, glow, { cast: false })
  }

  /* the east colonnade, the glass stair tower ---------------------------------------- */
  {
    glassBatch.span(glass, AX1 + 0.3, AX1 + 4.3, 0, B1, -27, -23)
    for (const [x, z] of [
      [AX1 + 0.3, -27],
      [AX1 + 4.3, -27],
      [AX1 + 0.3, -23],
      [AX1 + 4.3, -23],
    ]) dark.add(V(x, 0, z), V(x, B1, z), 0.14, 0.14)
    for (let y = 0; y <= B1; y += 3.8) {
      dark.add(V(AX1 + 0.3, y, -27), V(AX1 + 4.3, y, -27), 0.1, 0.1)
      dark.add(V(AX1 + 0.3, y, -23), V(AX1 + 4.3, y, -23), 0.1, 0.1)
      dark.add(V(AX1 + 4.3, y, -27), V(AX1 + 4.3, y, -23), 0.1, 0.1)
    }
    for (let k = 0; k < 6; k++) {
      const y = k * 1.9
      const dir = k % 2 ? 1 : -1
      steel.add(V(AX1 + 2.3 - dir * 1.6, y, k % 2 ? -26 : -24), V(AX1 + 2.3 + dir * 1.6, y + 1.9, k % 2 ? -26 : -24), 0.9, 0.1)
    }
    // poster lightboxes on posts (kenneth-02)
    for (const [x, z, r] of [
      [46.5, -5.5, 0.55],
      [48.5, -10, 0.55],
      [50.5, -14.5, 0.55],
    ]) {
      batch.box(darkMetal, 0.3, 4.6, 0.3, x, 0, z, [2, 2], r)
      batch.box(smooth, 2.4, 0.25, 1.4, x, 0, z, [3, 3], r)
      batch.box(whiteAlu, 3.3, 2.3, 0.3, x, 2.4, z, [2, 2], r)
      sign(signs, R.poster, 3.1, 2.1, x + Math.sin(r) * 0.16, 3.55, z + Math.cos(r) * 0.16, r)
      sign(signs, R.poster, 3.1, 2.1, x - Math.sin(r) * 0.16, 3.55, z - Math.cos(r) * 0.16, r + Math.PI)
    }
  }

  /* =====================================================================================
   * the air bridge to MetaForum (adriel-07)
   * ===================================================================================== */
  const BX = -40
  {
    const z0 = GN
    const z1 = -80
    const L = z0 - z1
    const zc = (z0 + z1) / 2
    batch.span(concrete, BX - 2.1, BX + 2.1, MZ - 0.75, MZ - 0.05, z1, ZN, [4, 4])
    batch.add(rubber, flatGeo(3.4, L, 0.5), BX, MZ, zc)
    // ceiling of bronze slats, the roof over it
    const cg = flatGeo(3.4, L, 1)
    cg.rotateX(Math.PI)
    batch.add(slats, cg, BX, MZ + 3.0, zc)
    batch.span(darkMetal, BX - 2.1, BX + 2.1, MZ + 3.0, MZ + 3.45, z1, ZN)
    for (const x of [BX - 1.7, BX + 1.7]) {
      glassBatch.add(glass, new THREE.PlaneGeometry(L, 3.0).rotateY(Math.PI / 2), x, MZ + 1.5, zc)
      for (let z = z1; z <= z0 + 0.01; z += 1.25) dark.add(V(x, MZ, z), V(x, MZ + 3.0, z), 0.08, 0.14)
      dark.add(V(x, MZ + 0.05, z1), V(x, MZ + 0.05, z0), 0.1, 0.12)
    }
    for (let z = z0 - 2; z > z1 + 1; z -= 3.2) {
      glassBatch.span(glow, BX - 0.75, BX - 0.6, MZ + 2.9, MZ + 2.97, z - 1.2, z)
      glassBatch.span(glow, BX + 0.6, BX + 0.75, MZ + 2.9, MZ + 2.97, z - 1.2, z)
    }
    sign(black, [0, 0, 1, 1], 3.0, 3.0, BX, MZ + 1.5, z1 + 0.08)
    for (const z of [-56, -68]) batch.box(concrete, 0.9, MZ - 0.75, 0.9, BX, 0, z, [4, 4])
  }

  /* =====================================================================================
   * MetaForum: the old hall, the fritted box above, the atrium inside (alyssa-nadia)
   * ===================================================================================== */
  const MF = { x0: -55, x1: 15, z0: -125, z1: -80 }
  {
    batch.span(hallFacade, MF.x0, MF.x1, 0, 12, MF.z0, MF.z1, [6, 6])
    const top = new THREE.Mesh(boxGeo(THREE, MF.x1 - MF.x0 + 6, 14, MF.z1 - MF.z0 + 6, [6, 6]), frit)
    top.position.set((MF.x0 + MF.x1) / 2, 12, (MF.z0 + MF.z1) / 2)
    top.castShadow = top.receiveShadow = true
    scene.add(top)
    batch.span(darkMetal, MF.x0 - 3.3, MF.x1 + 3.3, 26, 26.7, MF.z0 - 3.3, MF.z1 + 3.3)
    // the glazed north entrance onto the square
    batch.span(darkGlass, -35, -5, 0, 6.2, MF.z0 - 0.4, MF.z0)
    batch.span(darkMetal, -36, -4, 6.2, 7.0, MF.z0 - 3, MF.z0)
  }
  // the atrium
  const AR = { x0: -50, x1: 10, z0: -120, z1: -85, h: 24 }
  const LV = [MZ, MZ + 4.5, MZ + 9]
  const DRUM = { x: -30, z: -100.5, r: 8 }
  {
    batch.add(stoneFloor, flatGeo(42, AR.z1 - AR.z0, 4), -29, 0.07, (AR.z0 + AR.z1) / 2)
    batch.add(parquet, flatGeo(18, AR.z1 - AR.z0, 2), 1, 0.07, (AR.z0 + AR.z1) / 2)
    // walls: west plaster, south beige with windows, roof
    batch.span(plaster, AR.x0 - 0.3, AR.x0, 0, AR.h, AR.z0, AR.z1, [3, 3])
    batch.span(beige, AR.x0, AR.x1, 0, AR.h, AR.z1, AR.z1 + 0.3, [3, 3])
    batch.span(black, AR.x0, AR.x1, AR.h, AR.h + 0.4, AR.z0, AR.z1)
    black.envMapIntensity = 0.35
    for (const [x0, x1, y0, y1] of [
      [-43, -36.5, 1.0, 4.2],
      [-49, -30, 8.2, 9.8],
      [-26, -8, 8.2, 9.8],
    ]) {
      batch.span(darkGlass, x0, x1, y0, y1, AR.z1 - 0.06, AR.z1 + 0.05, [7.5, 6.2])
      for (const [a, b] of [
        [V(x0, y0, AR.z1 - 0.08), V(x1, y0, AR.z1 - 0.08)],
        [V(x0, y1, AR.z1 - 0.08), V(x1, y1, AR.z1 - 0.08)],
        [V(x0, y0, AR.z1 - 0.08), V(x0, y1, AR.z1 - 0.08)],
        [V(x1, y0, AR.z1 - 0.08), V(x1, y1, AR.z1 - 0.08)],
      ])
        dark.add(a, b, 0.12, 0.12)
    }
    // office blocks round two sides, windows lit
    batch.span(office, AR.x0, 2, 0, 18.7, AR.z0 - 5, -112.5, [7.2, 4.5])
    batch.span(office, 2, AR.x1 + 5, 0, 18.7, -112.5, AR.z1, [7.2, 4.5])
    batch.span(plaster, AR.x0, AR.x1, 18.7, AR.h, AR.z0 - 1, -112.5, [3, 3])
    batch.span(plaster, 2, AR.x1, 18.7, AR.h, -112.5, AR.z1, [3, 3])
    // galleries with steel railings and timber handrails
    for (const y of LV) {
      batch.span(plaster, AR.x0, 2, y - 0.4, y - 0.04, -112.5, -110.3, [3, 3])
      batch.span(plaster, -0.2, 2, y - 0.4, y - 0.04, -110.3, AR.z1, [3, 3])
      batch.add(greyFloor, flatGeo(52, 2.2, 4), -24, y, -111.4)
      batch.add(greyFloor, flatGeo(2.2, 25.3, 4), 0.9, y, -97.65)
      const rails = [
        [V(AR.x0, y, -110.3), V(-0.2, y, -110.3)],
        [V(-0.2, y, -110.3), V(-0.2, y, AR.z1)],
      ]
      for (const [a, b] of rails) {
        const len = a.distanceTo(b)
        const n = Math.ceil(len / 1.3)
        for (let k = 0; k <= n; k++) {
          const p = a.clone().lerp(b, k / n)
          steel.add(p, p.clone().setY(y + 1.05), 0.05, 0.05)
        }
        for (const h of [0.35, 0.7]) steel.add(a.clone().setY(y + h), b.clone().setY(y + h), 0.03, 0.03)
        wood.add(a.clone().setY(y + 1.08), b.clone().setY(y + 1.08), 0.09, 0.05)
      }
    }
    // the roof grid and its downlights
    for (let x = AR.x0; x <= AR.x1; x += 3) roofBeams.add(V(x, AR.h - 0.5, AR.z0), V(x, AR.h - 0.5, AR.z1), 0.18, 0.6)
    for (let z = AR.z0; z <= AR.z1; z += 3) roofBeams.add(V(AR.x0, AR.h - 0.4, z), V(AR.x1, AR.h - 0.4, z), 0.12, 0.4)
    const spots = []
    for (let x = AR.x0 + 3; x < AR.x1; x += 6) for (let z = AR.z0 + 3; z < AR.z1; z += 6) spots.push({ x, y: AR.h - 0.95, z, w: 0.5, h: 0.12, d: 0.5 })
    instBoxes(THREE, scene, spots, glowWarm, { cast: false })

    // the red drum: glazed ground floor, red steel above, a balcony at gallery level
    const lowerG = new THREE.CylinderGeometry(DRUM.r - 0.2, DRUM.r - 0.2, 3.6, 40, 1, true)
    lowerG.translate(0, 1.8, 0)
    batch.add(warmGlass, lowerG, DRUM.x, 0, DRUM.z)
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2
      dark.add(V(DRUM.x + Math.cos(a) * (DRUM.r - 0.15), 0, DRUM.z + Math.sin(a) * (DRUM.r - 0.15)), V(DRUM.x + Math.cos(a) * (DRUM.r - 0.15), 3.6, DRUM.z + Math.sin(a) * (DRUM.r - 0.15)), 0.1, 0.1)
    }
    const upper = new THREE.CylinderGeometry(DRUM.r, DRUM.r, 9.4, 48, 1, true)
    const uvu = upper.attributes.uv
    for (let i = 0; i < uvu.count; i++) uvu.setX(i, uvu.getX(i) * 4)
    upper.translate(0, 3.6 + 4.7, 0)
    batch.add(drum, upper, DRUM.x, 0, DRUM.z)
    const capG = new THREE.CylinderGeometry(DRUM.r + 0.25, DRUM.r + 0.25, 0.5, 48)
    capG.translate(0, 13.25, 0)
    batch.add(darkMetal, capG, DRUM.x, 0, DRUM.z)
    const ring = new THREE.CylinderGeometry(DRUM.r + 1.6, DRUM.r + 1.6, 0.35, 48)
    ring.translate(0, MZ - 0.175, 0)
    batch.add(plaster, ring, DRUM.x, 0, DRUM.z)
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2
      const b = ((k + 1) / 40) * Math.PI * 2
      const p = V(DRUM.x + Math.cos(a) * (DRUM.r + 1.5), MZ, DRUM.z + Math.sin(a) * (DRUM.r + 1.5))
      const p2 = V(DRUM.x + Math.cos(b) * (DRUM.r + 1.5), MZ, DRUM.z + Math.sin(b) * (DRUM.r + 1.5))
      steel.add(p, p.clone().setY(MZ + 1.05), 0.05, 0.05)
      steel.add(p.clone().setY(MZ + 1.05), p2.clone().setY(MZ + 1.05), 0.05, 0.05)
      steel.add(p.clone().setY(MZ + 0.5), p2.clone().setY(MZ + 0.5), 0.03, 0.03)
    }
    sign(signsLit, R.speakers, 6.0, 1.15, DRUM.x + DRUM.r + 0.12, 4.15, DRUM.z, Math.PI / 2)
    // the colourful banner hanging in front of it, the party balloons
    sign(signs, R.doodle, 2.8, 8.4, -19.5, 8.6, -95, Math.PI / 2 - 0.3)
    const balloons = []
    for (const [x, y, z, r, c] of [
      [-15.5, 10.2, -98.5, 1.15, 0xf6f6f4],
      [-14.2, 9.0, -97.2, 0.75, 0xef4f8a],
      [-14.8, 8.1, -99.6, 0.6, 0xf3a6c4],
      [-16.4, 8.6, -97.4, 0.62, 0xf08cb5],
      [-15.0, 7.4, -98.4, 0.52, 0xf3a6c4],
    ]) balloons.push({ x, y, z, w: r, h: r, d: r, c })
    instBoxes(THREE, scene, balloons, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }), { geo: new THREE.SphereGeometry(1, 20, 14) })
    // cocktail tables round the drum
    for (const [x, z] of [
      [-18.5, -103],
      [-17, -106.5],
      [-12.5, -104],
      [-20.5, -110],
      [-11, -108.5],
      [-24, -91],
    ]) {
      const g = new THREE.CylinderGeometry(0.34, 0.24, 1.1, 16)
      g.translate(0, 0.55, 0)
      batch.add(white, g, x, 0, z)
    }
    // perforated panel wall by the second stair (alyssa-04)
    batch.span(perf, -18.3, -18, 0, 9.5, -112.5, -107.5, [1, 1])

    /** A steel stair: open treads on two stringers, steel balusters, timber handrails. */
    const steelStair = (x0, z0, ux, uz, n, rise, going, width) => {
      const px = -uz
      const pz = ux
      const ry = Math.atan2(-uz, ux)
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * going
        batch.box(steelMat, going + 0.02, 0.05, width, x0 + ux * t, (i + 1) * rise - 0.05, z0 + uz * t, [2, 2], ry)
      }
      const L = n * going
      const H = n * rise
      for (const s of [-1, 1]) {
        const ox = px * s * (width / 2 + 0.04)
        const oz = pz * s * (width / 2 + 0.04)
        steel.add(V(x0 + ox, -0.15, z0 + oz), V(x0 + ox + ux * L, H - 0.15, z0 + oz + uz * L), 0.06, 0.3)
        const k = Math.ceil(n / 3)
        for (let j = 0; j <= k; j++) {
          const f = j / k
          const bx = x0 + ox + ux * L * f
          const bz = z0 + oz + uz * L * f
          steel.add(V(bx, H * f, bz), V(bx, H * f + 1.0, bz), 0.05, 0.05)
        }
        steel.add(V(x0 + ox, 0.45, z0 + oz), V(x0 + ox + ux * L, H + 0.45, z0 + oz + uz * L), 0.03, 0.03)
        wood.add(V(x0 + ox, 1.02, z0 + oz), V(x0 + ox + ux * L, H + 1.02, z0 + oz + uz * L), 0.09, 0.06)
      }
    }
    steelStair(-12, -91, 1, 0, 30, MZ / 30, 0.3, 2.0) // S1, up to the east gallery
    batch.span(steelMat, -3, -0.2, MZ - 0.25, MZ, -92.1, -89.9)
    steelStair(-15, -100, 0, -1, 30, MZ / 30, 0.3, 2.0) // S2, up to the north gallery
    batch.span(steelMat, -16.1, -13.9, MZ - 0.25, MZ, -110.3, -109)
    steelStair(-34, -86.3, -1, 0, 30, MZ / 30, 0.3, 1.8) // S3, along the beige wall
    batch.span(steelMat, -46.5, -43, MZ - 0.25, MZ, -87.4, -85)
  }

  /* =====================================================================================
   * the Auditorium: glazed foyer, concrete lecture halls, a canopy; inside the hall (kenneth-01)
   * ===================================================================================== */
  const AU = { x0: 105, x1: 165, z0: -120, z1: -70 }
  {
    batch.span(foyer, AU.x0, AU.x1, 0, 8.4, AU.z0, AU.z1, [7.5, 8])
    batch.span(yellow, AU.x0 - 0.2, AU.x1 + 0.2, 7.5, 8.4, AU.z1 - 0.2, AU.z1 + 0.25)
    batch.span(concrete, AU.x0 + 2, AU.x1 - 2, 8.4, 17, AU.z0 + 2, AU.z1 - 2, [4, 4])
    batch.span(concrete, 112, 140, 17, 21.5, -112, -78, [4, 4])
    batch.span(concrete, 145, 160, 17, 20, -115, -88, [4, 4])
    // the concrete canopy over the entrance on two pillars
    batch.span(concrete, 110, 150, 8.4, 9.3, AU.z1, AU.z1 + 9, [4, 4])
    for (const x of [113, 147]) batch.box(concrete, 0.9, 8.4, 0.9, x, 0, AU.z1 + 8, [4, 4])
    for (const x of [118, 124, 136, 142]) sign(signs, R.banner, 2.6, 5.2, x, 4.6, AU.z1 + 0.3)
    sign(signs, R.entrance, 2.6, 0.65, 130, 3.4, AU.z1 + 0.3)
    for (const x of [108, 157]) sign(signs, R.photos, 5, 5.5, x, 3.6, AU.z1 + 0.3)
    batch.span(redGloss, 150.5, 163, 0, 3.4, AU.z1 + 2, AU.z1 + 2.15)
  }
  {
    // the lecture hall: stage, green boards, the screen, lecterns; blue seats rising behind
    const LH = { x0: 112, x1: 140, z0: -112, z1: -78, h: 12 }
    batch.span(plaster, LH.x0, LH.x1, 0, LH.h, LH.z0 - 0.3, LH.z0, [3, 3])
    batch.span(darkMetal, LH.x0 - 0.3, LH.x0, 0, LH.h, LH.z0, LH.z1)
    batch.span(darkMetal, LH.x1, LH.x1 + 0.3, 0, LH.h, LH.z0, LH.z1)
    batch.span(darkMetal, LH.x0, LH.x1, 0, LH.h, LH.z1, LH.z1 + 0.3)
    batch.span(black, LH.x0, LH.x1, LH.h, LH.h + 0.3, LH.z0, LH.z1)
    batch.span(black, LH.x0, LH.x1, 0, 0.08, LH.z0, LH.z1)
    batch.span(stageWood, LH.x0, LH.x1, 0, 0.75, LH.z0, -103, [2, 2])
    batch.span(black, LH.x0, LH.x1, 0.75, 5.2, LH.z0, LH.z0 + 0.1)
    for (const [x, y] of [
      [127.4, 2.25],
      [131.9, 2.25],
      [136.4, 2.25],
      [129.6, 3.95],
      [134.1, 3.95],
    ]) sign(signs, R.chalk, 4.4, 1.6, x, y, LH.z0 + 0.13)
    batch.span(stageWood, 125, LH.x1, 1.35, 1.42, LH.z0 + 0.1, LH.z0 + 0.25, [2, 2])
    batch.span(white, 114.5, 124, 5.2, 10.6, LH.z0 + 0.1, LH.z0 + 0.14)
    sign(signsLit, R.slide, 9, 5.1, 119.25, 7.9, LH.z0 + 0.17)
    for (const x of [114.2, 124.3]) batch.span(black, x - 0.3, x + 0.3, 0.75, LH.h, LH.z0 + 0.1, LH.z0 + 0.6)
    // white side door panel on the left wall
    batch.span(white, LH.x0, LH.x0 + 0.06, 0.75, 4.2, -108.5, -105.5)
    for (const [x, z, r] of [
      [117.2, -108.2, 0.35],
      [134.6, -104.6, -0.25],
    ]) {
      batch.box(darkMetal, 0.95, 1.15, 0.6, x, 0.75, z, [2, 2], r)
      sign(signs, R.lectern, 0.9, 1.1, x + Math.sin(r) * 0.31, 1.32, z + Math.cos(r) * 0.31, r)
    }
    batch.box(steelMat, 0.05, 4.2, 0.05, 113.7, 0.75, -108.8, [1, 1])
    sign(signs, R.feather, 1.1, 3.4, 114.3, 3.1, -108.8, 0.4)
    // seats rising to the back
    const seats = []
    for (let k = 0; k < 16; k++) {
      const z = -101.5 + k * 1.3
      const y = 0.35 * k
      batch.span(black, LH.x0, LH.x1, 0, y + 0.1, z - 0.65, z + 0.65)
      if (low && k % 2) continue
      for (let x = LH.x0 + 1.5; x < LH.x1 - 1; x += 0.58) seats.push({ x, y: y + 0.1, z, w: 0.52, h: 0.85, d: 0.55 })
    }
    instBoxes(THREE, scene, seats, blueSeat)
    for (let x = LH.x0 + 3; x < LH.x1; x += 4) glassBatch.span(glow, x - 1.2, x + 1.2, LH.h - 0.06, LH.h, -110, -109.6)
    for (let z = -100; z < LH.z1; z += 5) for (let x = LH.x0 + 3; x < LH.x1; x += 6) glassBatch.span(glow, x - 0.3, x + 0.3, LH.h - 0.06, LH.h, z - 0.3, z + 0.3)
    const key = new THREE.PointLight(0xfff2e0, 160, 30, 2)
    key.position.set(124, 9.5, -100)
    scene.add(key)
  }

  /* =====================================================================================
   * the south lawn: the red TU/e letters on their beam, tables, the concrete pavilion
   * ===================================================================================== */
  const LET = V(-8, 0, 12)
  {
    // the galvanised I-beam, seat height, on low feet; the letters bolted to its face
    const bz = LET.z + 0.42
    const B0 = 0.12 // underside
    const B1 = 0.55 // top: where people sit
    batch.span(galv, LET.x - 3.6, LET.x + 3.6, B0, B0 + 0.03, bz - 0.09, bz + 0.09)
    batch.span(galv, LET.x - 3.6, LET.x + 3.6, B0 + 0.03, B1 - 0.03, bz - 0.012, bz + 0.012)
    batch.span(galv, LET.x - 3.6, LET.x + 3.6, B1 - 0.03, B1, bz - 0.09, bz + 0.09)
    for (const dx of [-2.9, 2.9]) {
      batch.span(galv, LET.x + dx - 0.05, LET.x + dx + 0.05, 0.0, B0, bz - 0.05, bz + 0.05)
      batch.span(smooth, LET.x + dx - 0.2, LET.x + dx + 0.2, -0.02, 0.03, bz - 0.2, bz + 0.2)
    }
    const g = tueSign(THREE, 1.3)
    const letters = new THREE.Mesh(g, redGloss)
    letters.position.set(LET.x, 0.4, bz + 0.095)
    letters.castShadow = letters.receiveShadow = true
    scene.add(letters)
  }
  // white picnic tables (kenneth-07, amara-05)
  {
    const pic = []
    for (const [x, z] of [
      [-14.5, 9.2],
      [-30, 16],
      [8, 17],
    ]) {
      pic.push({ x, y: 0.72, z, w: 1.9, h: 0.06, d: 0.8 }, { x, y: 0.42, z: z - 0.65, w: 1.9, h: 0.05, d: 0.3 }, { x, y: 0.42, z: z + 0.65, w: 1.9, h: 0.05, d: 0.3 })
      for (const dx of [-0.75, 0.75]) pic.push({ x: x + dx, y: 0, z, w: 0.08, h: 0.72, d: 1.5 })
    }
    instBoxes(THREE, scene, pic, white)
  }
  // the concrete pavilion on the green (kenneth-06)
  const PAV = { x: 43.2, z: 46.2, ry: -0.7 }
  {
    const c = Math.cos(PAV.ry)
    const s = Math.sin(PAV.ry)
    const put = (mat, w, h, d, lx, y, lz) => batch.box(mat, w, h, d, PAV.x + lx * c + lz * s, y, PAV.z - lx * s + lz * c, [4, 4], PAV.ry)
    put(smooth, 7.8, 0.2, 4.0, 0, 0, 0)
    for (const lx of [-3.55, 3.55]) {
      put(concrete, 0.7, 3.3, 0.45, lx, 0, 1.75)
      put(concrete, 0.7, 3.3, 0.45, lx, 0, -1.75)
    }
    put(concrete, 7.8, 0.55, 0.5, 0, 3.3, 1.75)
    put(concrete, 7.8, 0.55, 0.5, 0, 3.3, -1.75)
    put(concrete, 0.5, 0.55, 3.0, -3.55, 3.3, 0)
    put(concrete, 0.5, 0.55, 3.0, 3.55, 3.3, 0)
    put(concrete, 1.7, 3.3, 0.55, -0.4, 0, -1.2)
    put(concrete, 0.55, 3.3, 0.55, 1.8, 0, -1.55)
    put(concrete, 2.4, 0.3, 1.0, -2.2, 0.48, 0.3)
    put(concrete, 2.2, 0.3, 1.0, 2.3, 0.5, 0.4)
    for (const lx of [-3.0, -1.4, 1.5, 3.1]) put(concrete, 0.3, 0.48, 0.8, lx, 0, lx < 0 ? 0.3 : 0.4)
    const gx = PAV.x + -0.4 * c + -0.92 * s
    const gz = PAV.z - -0.4 * s + -0.92 * c
    batch.add(signs, signGeo(THREE, R.graffiti, 1.5, 0.75), gx, 2.2, gz, PAV.ry)
  }

  /* the pond, its flags and the sculpture (kenneth-03) ------------------------------------- */
  const pool = waterMaterial(THREE, { palette: { ...world.light, water: { deep: 0x32546a, shallow: 0x5f8299, stroke: 0xf2f1ee } }, scale: 0.22, strokes: 0.3 })
  const POND = { x0: 80, x1: 108, z0: -6, z1: 6 }
  {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(POND.x1 - POND.x0, POND.z1 - POND.z0), pool)
    w.rotation.x = -Math.PI / 2
    w.position.set((POND.x0 + POND.x1) / 2, 0.3, (POND.z0 + POND.z1) / 2)
    scene.add(w)
    batch.span(granite, POND.x0 - 0.5, POND.x1 + 0.5, 0, 0.45, POND.z0 - 0.5, POND.z0, [2, 2])
    batch.span(granite, POND.x0 - 0.5, POND.x1 + 0.5, 0, 0.45, POND.z1, POND.z1 + 0.5, [2, 2])
    batch.span(granite, POND.x0 - 0.5, POND.x0, 0, 0.45, POND.z0, POND.z1, [2, 2])
    batch.span(granite, POND.x1, POND.x1 + 0.5, 0, 0.45, POND.z0, POND.z1, [2, 2])
    batch.span(black, POND.x0, POND.x1, 0, 0.05, POND.z0, POND.z1)
    // "Wording" (1968): a weathered bronze form unfolding upward out of the water
    const bronze = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.55, metalness: 0.6 })
    for (const [rt, rb, h, x, y, z, rx, rz] of [
      [0.55, 0.75, 1.6, 100, 0.2, -3.5, 0.05, 0.1],
      [0.7, 0.5, 1.3, 100.15, 1.7, -3.45, -0.25, 0.15],
      [0.35, 0.65, 1.1, 100.35, 2.85, -3.4, 0.35, -0.3],
      [0.15, 0.4, 0.9, 100.6, 3.8, -3.3, -0.2, 0.45],
    ]) {
      const g = new THREE.CylinderGeometry(rt, rb, h, 7, 1)
      g.translate(0, h / 2, 0)
      g.rotateX(rx)
      g.rotateZ(rz)
      batch.add(bronze, g, x, y, z)
    }
  }
  const flags = []
  {
    const paints = [
      (g, w, h) => {
        g.fillStyle = '#1f3e93'
        g.fillRect(0, 0, w, h)
        g.fillStyle = '#ffd200'
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2
          g.beginPath()
          g.arc(w / 2 + Math.cos(a) * 34, h / 2 + Math.sin(a) * 34, 4.5, 0, Math.PI * 2)
          g.fill()
        }
      },
      (g, w, h) => {
        g.fillStyle = '#1d5bbf'
        g.fillRect(0, 0, w, h / 2)
        g.fillStyle = '#ffd500'
        g.fillRect(0, h / 2, w, h / 2)
      },
      (g, w, h) => {
        g.fillStyle = '#d6202d'
        g.fillRect(0, 0, w, h)
        g.fillStyle = '#ffffff'
        g.font = '800 50px "Helvetica Neue", Arial, sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText('TU/e', w / 2, h / 2)
      },
    ]
    const poles = []
    paints.forEach((p, i) => {
      const x = 68
      const z = 13 + i * 4.2
      poles.push({ x, z, w: 0.13, h: 10.4, d: 0.13 })
      const f = flag(THREE, p, { x, z, h: 10.2, rot: Math.PI / 2 - 0.3, seed: i * 1.7 })
      scene.add(f.mesh)
      flags.push(f)
    })
    instBoxes(THREE, scene, poles, new THREE.MeshStandardMaterial({ color: 0xe2e2df, metalness: 0.8, roughness: 0.3 }))
  }

  /* =====================================================================================
   * the rest of the campus
   * ===================================================================================== */
  {
    // Gemini (grey, long windows) and the air bridge from it to Flux
    batch.span(gemini, 175, 215, 0, 25.2, -62, -18, [7.2, 7.2])
    batch.span(darkMetal, 174.8, 215.2, 25.2, 26.2, -62.2, -17.8)
    glassBatch.span(glass, 171, 175, 0, 25, -40, -36)
    for (const [x, z] of [
      [171, -40],
      [171, -36],
    ]) dark.add(V(x, 0, z), V(x, 25, z), 0.14, 0.14)
    batch.span(concrete, 192.5, 197.5, 5.2, 5.9, -100, -62, [4, 4])
    batch.span(darkGlass, 193, 197, 5.9, 9.0, -100, -62, [7.5, 6.2])
    batch.span(darkMetal, 192.6, 197.4, 9.0, 9.4, -100, -62)
    for (const z of [-75, -88]) batch.box(concrete, 0.9, 5.2, 0.9, 195, 0, z, [4, 4])
    // Flux (white), Neuron (glass), Vertigo (tall concrete grid), more faculty blocks
    batch.span(flux, 180, 230, 0, 24, -140, -100, [7.2, 8])
    batch.span(darkGlass, 100, 140, 0, 21, -180, -145, [7.5, 6.2])
    batch.span(vertigo, -60, -12, 0, 50.4, -208, -186, [7.2, 7.2])
    batch.span(darkMetal, -60.2, -11.8, 50.4, 51.6, -208.2, -185.8)
    batch.span(vertigo, 5, 35, 0, 28.8, -200, -180, [7.2, 7.2])
    batch.span(gemini, 30, 80, 0, 21.6, -165, -138, [7.2, 7.2])
    batch.span(flux, -140, -100, 0, 16, -60, -10, [7.2, 8])
    batch.span(gemini, -150, -110, 0, 21.6, 5, 30, [7.2, 7.2])
    // the brick boiler house (Ceres) and its 70 m chimney
    batch.span(brick, 236, 266, 0, 13, -165, -132, [2, 2])
    batch.span(darkMetal, 235.6, 266.4, 13, 13.6, -165.4, -131.6)
    const ch = new THREE.CylinderGeometry(1.9, 3.2, 70, 28, 1, true)
    ch.translate(0, 35, 0)
    const uv = ch.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * 35)
    batch.add(brick, ch, 229, 0, -146)
    const lip = new THREE.CylinderGeometry(2.2, 2.0, 1.4, 28)
    lip.translate(0, 70, 0)
    batch.add(darkMetal, lip, 229, 0, -146)
    // the city all round, far off
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    const uvs = unit.attributes.uv.array
    for (let i = 0; i < uvs.length; i++) uvs[i] *= 3
    const blocks = []
    for (let i = 0; i < (low ? 110 : 240); i++) {
      const x = range(rand, -900, 900)
      const z = range(rand, -900, 900)
      if (x > -260 && x < 320 && z > -260 && z < 140) continue
      blocks.push({ x, z, w: range(rand, 20, 50), h: range(rand, 10, 36), d: range(rand, 14, 24), r: Math.floor(rand() * 2) * (Math.PI / 2) })
    }
    instBoxes(THREE, scene, blocks, cityMat, { cast: false, geo: unit })
  }
  // the Dommel, along the campus's west edge
  {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(16, 900), pool)
    w.rotation.x = -Math.PI / 2
    w.position.set(-190, 0.05, -60)
    scene.add(w)
  }

  /* trees -------------------------------------------------------------------------------------- */
  {
    const big = []
    for (const [x, z] of [
      [-22, -3.8],
      [3, -3.6],
      [-27, 9],
      [-42, 12],
      [-48, 30],
      [-24, 46],
      [10, 38],
      [24, 22],
      [61, 13],
      [63, 18],
      [55, 26],
      [86, 22],
      [118, 18],
      [128, -26],
      [100, -52],
      [150, -45],
      [-62, -56],
      [-26, -60],
      [-54, -70],
      [-12, -58],
      [12, -66],
      [34, -58],
      [56, -66],
      [78, -58],
      [-66, 20],
      [36, 60],
      [-6, 62],
      [72, 48],
    ]) big.push({ x: x + range(rand, -0.8, 0.8), z: z + range(rand, -0.8, 0.8), h: range(rand, 12, 17) })
    addForest(THREE, scene, low ? big.filter((_, i) => i % 3 !== 2) : big, { species: 'plane', season: 'summer', seed: 13, quality: q })
    const lime = []
    for (let x = -100; x <= 180; x += 16) lime.push({ x, z: 70 + range(rand, -1, 1), h: range(rand, 11, 14) })
    for (const [x, z] of [
      [-70, -140],
      [30, -150],
      [-80, -112],
      [40, -118],
      [-5, -135],
    ]) lime.push({ x, z, h: range(rand, 9, 12) })
    addForest(THREE, scene, low ? lime.filter((_, i) => i % 2 === 0) : lime, { species: 'lime', season: 'summer', seed: 17, quality: q })
    const oak = []
    for (const [x, z] of [
      [-60, 6],
      [-36, -4],
      [16, 8],
      [44, 14],
    ]) oak.push({ x, z, h: range(rand, 9, 12) })
    addForest(THREE, scene, oak, { species: 'oak', season: 'summer', seed: 21, quality: q })
  }

  /* bikes, lamps, benches, bins ------------------------------------------------------------------ */
  addBikes(
    THREE,
    scene,
    [
      { x: -36, z: -7, len: 22, dir: 0 },
      { x: -36, z: -9.6, len: 22, dir: 0, fill: 0.65 },
      { x: -58, z: -6, len: 12, dir: 0 },
      { x: 10, z: -48, len: 30, dir: 0 },
      { x: 52, z: -50, len: 20, dir: 0, fill: 0.7 },
      { x: 20, z: -8, len: 10, dir: 0, fill: 0.7 },
      { x: -10, z: -132, len: 24, dir: 0 },
    ].slice(0, low ? 4 : 7),
    rand
  )
  {
    const lamps = []
    for (let x = -70; x <= 30; x += 16) lamps.push({ x, z: 4.8, r: Math.PI / 2 })
    for (let z = 12; z <= 48; z += 18) lamps.push({ x: 50, z, r: Math.PI })
    for (let x = -60; x <= 160; x += 24) lamps.push({ x, z: -78, r: Math.PI / 2 })
    addLampPosts(THREE, scene, lamps, { height: 5.5 })
    // tall square lights (alyssa-05)
    const tall = []
    for (const [x, z] of [
      [-44, -150],
      [-2, -150],
      [-44, -172],
      [-2, -172],
      [20, -165],
    ]) tall.push({ x, z, r: Math.PI / 2 })
    addLampPosts(THREE, scene, tall, { height: 8.5 })
    const legs = []
    const tops = []
    for (const [x, z, r] of [
      [-40, 3.6, 0],
      [-24, 3.6, 0],
      [16, 3.6, 0],
      [74, 8, Math.PI / 2],
      [92, 8, 0],
      [-30, -150, 0],
      [-12, -150, 0],
    ]) {
      const c = Math.cos(r)
      const s = Math.sin(r)
      legs.push({ x: x - c * 0.8, z: z + s * 0.8, w: 0.42, h: 0.42, d: 0.55, r }, { x: x + c * 0.8, z: z - s * 0.8, w: 0.42, h: 0.42, d: 0.55, r })
      tops.push({ x, y: 0.42, z, w: 2.2, h: 0.09, d: 0.55, r })
    }
    instBoxes(THREE, scene, legs, smooth)
    instBoxes(THREE, scene, tops, benchWood)
    const bins = []
    for (const [x, z] of [
      [-18, 3.4],
      [20, 3.4],
      [48, -4],
      [-6, -150],
    ]) bins.push({ x, z, w: 0.5, h: 1.0, d: 0.5 })
    instBoxes(THREE, scene, bins, darkMetal)
  }

  /* build the batches --------------------------------------------------------------------------- */
  batch.build(scene)
  glassBatch.build(scene, { cast: false, receive: false })
  scene.add(steel.build(steelMat))
  scene.add(stainless.build(stainlessMat, { castShadow: false }))
  scene.add(wood.build(darkWood))
  scene.add(dark.build(darkMetal))
  scene.add(lights.build(glow, { castShadow: false }))
  scene.add(roofBeams.build(new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.85, metalness: 0.1, envMapIntensity: 0.3 }), { castShadow: false }))
  // the atrium's warm light (it is lit like an evening reception)
  {
    const a = new THREE.PointLight(0xffe2bc, 260, 40, 2)
    a.position.set(-18, 15, -101)
    scene.add(a)
  }

  /** A flat floor plane (y = 0, faces up) with metre UVs. */
  function flatGeo(w, d, tile) {
    const g = new THREE.PlaneGeometry(w, d)
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile)
    g.rotateX(-Math.PI / 2)
    return g
  }

  /* light, the flight in, the viewpoints ----------------------------------------------------- */
  world.focusShadows(V(30, 0, -48), 125)

  const at = (x, y, z, lx, ly, lz) => ({ pos: V(x, y, z), look: V(lx, ly, lz) })
  const spots = [
    // 0 · amara-05: the TU/e letters on the lawn, all of Atlas behind (arrival)
    at(-7.6, 1.3, 31, -8, 14.5, -19),
    // 1 · kenneth-01: on the lecture hall stage, the green boards and the screen
    at(114.6, 2.45, -100.2, 127.5, 3.4, -111.8),
    // 2 · kenneth-02: south of the colonnade, looking through it past the posters
    at(50.5, 1.7, -1.5, 66, 5.2, -28),
    // 3 · kenneth-03: east of the pond, the flags beyond it, Atlas's end on the right
    at(112, 1.6, 4.5, 82, 3.6, 6.5),
    // 4 · kenneth-04: under Atlas's glass, looking up over the pillars
    at(57, 1.3, -3.5, 56, 9.5, -19.5),
    // 5 · kenneth-05: low on the granite steps of Atlas's entrance
    at(-9.4, 0.8, -12.3, -11.8, 2.4, -21.5),
    // 6 · kenneth-06: the concrete pavilion; Atlas's end, the chimney, Gemini beyond
    at(40, 1.4, 50.5, 59.3, 4.2, 27.5),
    // 7 · kenneth-07: the letters close, Atlas's glazed hall behind
    at(-8.2, 1.2, 16.9, -8, 2.0, 0),
    // 8 · kenneth-08: the letters again, a step to the right
    at(-6.8, 1.2, 17.4, -9.2, 2.2, 0),
    // 9 · adriel-01: the red letters on the mezzanine, the folded ceiling above
    at(-1.6, MZ + 1.2, -40.7, 4.5, MZ + 1.4, -27),
    // 10 · adriel-02: by the pond: Atlas's east end, the Auditorium, the chimney
    at(58, 1.6, 8.5, 77.3, 4.6, -14.5),
    // 11 · adriel-03: the steel plaques on the white wall
    at(13, MZ + 1.6, -26.6, 13, MZ + 1.75, -23.6),
    // 12 · adriel-04: on the landing, up the red stair into the light well
    at(-8.7, MZ + 1.55, ZC, -22, B1 - 0.6, ZC),
    // 13 · adriel-05: the hall from the floor, along the void to the stair
    at(17, FL + 1.65, -31.2, -30, FL + 5.5, -31.6),
    // 14 · adriel-06: from the south mezzanine down onto the floor, the merchandise rail
    at(-34.6, MZ + 1.65, -27.5, -35.2, FL, -33.4),
    // 15 · adriel-07: in the red-floored air bridge
    at(BX, MZ + 1.5, -45.6, BX, MZ + 1.45, -76),
    // 16 · amara-01: the Momentum photo wall
    at(24.5, FL + 1.6, -28.1, 24.5, FL + 1.62, -23.9),
    // 17 · amara-02: from the landing, down the lower flight to the bar and chairs
    at(-8.6, MZ + 1.75, -32.25, 8, FL + 0.4, -38.5),
    // 18 · amara-03: low on the landing, the upper flight rising
    at(-8.3, MZ + 0.95, ZC + 0.3, -20, B1 - 1.6, ZC),
    // 19 · amara-04: the mezzanine corridor with its glass balustrade
    at(28.6, MZ + 1.55, -37.0, 12, MZ + 1.3, -38.9),
    // 20 · amara-06: looking down on the red bench round a pillar
    at(2.9, FL + 2.4, -26.0, 3.4, FL, -23.3),
    // 21 · alyssa-nadia-01: from the top of the steel stair into the atrium, the drum ahead
    at(-5.0, 5.1, -91.0, -24, 1.4, -100.5),
    // 22 · alyssa-nadia-02: the drum on the left, galleries on the right, the roof grid
    at(-6.6, 4.4, -91.6, -21, 8.5, -111),
    // 23 · alyssa-nadia-03: at the foot of the stair along the beige wall
    at(-32.4, 0.9, -87.9, -42, 5.6, -86.2),
    // 24 · alyssa-nadia-04: at the foot of the second stair, the lit galleries above
    at(-15, 0.95, -97.6, -15, 10, -112),
    // 25 · alyssa-nadia-05: on the brick square north of MetaForum, Vertigo ahead
    at(-22, 1.6, -142, -34, 14, -192),
  ]
  const end = spots[0]
  const path = {
    positions: [V(120, 170, 280), V(60, 80, 160), V(10, 30, 80), V(-6, 6, 40), end.pos.clone()],
    targets: [V(0, 20, -30), V(-4, 22, -28), V(-8, 18, -22), V(-8, 15, -20), end.look.clone()],
    fov: 50,
    near: 0.2,
    spots,
  }

  return {
    scene,
    world,
    path,
    update(t) {
      pool.userData.tick(t)
      for (const f of flags) f.tick(t)
    },
  }
}
