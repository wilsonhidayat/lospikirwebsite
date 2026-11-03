/**
 * Leidseplein, Amsterdam — a bright winter afternoon.
 *
 * Built from Amara's photos: the round granite fountain with its stepped
 * basins, bronze figures and arcing jets, ringed by pollarded plane trees,
 * bare for winter and wound with warm fairy lights; the tall tan-brick hotel
 * across the Singelgracht behind it; tram tracks set in the street under
 * their wires, a GVB tram at the stop. Round the square: the
 * Stadsschouwburg in red brick and light stone with its arched loggia and
 * terrace, the American Hotel with its corner tower, a domed stone corner
 * block where Leidsestraat leaves the square, café houses with lit
 * shopfronts and awnings, and the Leidsebrug over the canal.
 *
 * Every surface is a painted PBR material (materials.js) with real-world
 * tiling; all the static architecture is merged per material so the whole
 * place draws in a few dozen calls.
 *
 * Metres. The fountain is at the origin; the canal and the hotel are toward −Z,
 * the theatre toward −X, Leidsestraat runs off toward +X.
 */
import { createWorld, waterMaterial } from '../world.js'
import * as M from '../materials.js'
import { beamBatch, seeded, range, pick, noiseNormalMap, paintTexture, glowTexture } from '../utils.js'
import { NO_INK_LAYER } from '../post.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

// the Singelgracht runs along the south side, past the tram stop
const CANAL_N = -60
const CANAL_S = -78
const WATER_Y = -1.3
const SHOP_H = 4.2

/* --- geometry plumbing ------------------------------------------------------------ */

/**
 * Collects static geometry per material and merges it: one draw call per
 * material for the whole place, however many buildings share it.
 */
function makeBatch(THREE, { cast = true, receive = true } = {}) {
  const lists = new Map()
  return {
    add(mat, geo, matrix) {
      if (!mat || !geo) return
      const g = geo.index ? geo.toNonIndexed() : geo.clone()
      if (matrix) g.applyMatrix4(matrix)
      for (const k of Object.keys(g.attributes)) {
        if (k === 'position' || k === 'normal' || k === 'uv') continue
        if (k === 'color' && mat.vertexColors) continue
        g.deleteAttribute(k)
      }
      if (!g.attributes.normal) g.computeVertexNormals()
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
      g.morphAttributes = {}
      g.clearGroups()
      if (!lists.has(mat)) lists.set(mat, [])
      lists.get(mat).push(g)
    },
    build(scene) {
      for (const [mat, list] of lists) {
        const merged = list.length === 1 ? list[0] : mergeGeometries(list, false)
        const parts = merged ? [merged] : list
        for (const geo of parts) {
          geo.computeBoundingSphere()
          const mesh = new THREE.Mesh(geo, mat)
          mesh.castShadow = cast
          mesh.receiveShadow = receive
          scene.add(mesh)
        }
      }
      lists.clear()
    },
  }
}

/** Scale a geometry's UVs. */
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  return geo
}

/* --- winter plane trees ----------------------------------------------------------- */

/** Append a tapered tube along `pts` (radii per point) to an accumulator; returns its frames. */
function tubeInto(THREE, acc, pts, radii, radial) {
  const n = pts.length
  const T = new THREE.Vector3()
  const N = new THREE.Vector3()
  const Bv = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const frames = []
  const base = acc.pos.length / 3
  let along = 0
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    if (i === 0) T.subVectors(pts[1], pts[0])
    else if (i === n - 1) T.subVectors(pts[n - 1], pts[n - 2])
    else T.subVectors(pts[i + 1], pts[i - 1])
    T.normalize()
    if (i === 0) {
      tmp.set(0, 1, 0)
      if (Math.abs(T.y) > 0.9) tmp.set(1, 0, 0)
      N.crossVectors(T, tmp).normalize()
    } else {
      N.addScaledVector(T, -N.dot(T)).normalize()
    }
    Bv.crossVectors(T, N).normalize()
    if (i > 0) along += p.distanceTo(pts[i - 1])
    const r = radii[i]
    frames.push({ p: p.clone(), n: N.clone(), b: Bv.clone(), r })
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const dx = N.x * ca + Bv.x * sa
      const dy = N.y * ca + Bv.y * sa
      const dz = N.z * ca + Bv.z * sa
      acc.pos.push(p.x + dx * r, p.y + dy * r, p.z + dz * r)
      acc.nor.push(dx, dy, dz)
      acc.uv.push(j / radial, along / 1.6)
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j
      const b = a + radial + 1
      acc.idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  return frames
}

/** A knobbly pollard knuckle. */
function knuckleInto(THREE, acc, c, r, ico) {
  const p = ico.attributes.position
  const base = acc.pos.length / 3
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    acc.pos.push(c.x + x * r, c.y + y * r * 0.85, c.z + z * r)
    const l = Math.hypot(x, y, z) || 1
    acc.nor.push(x / l, y / l, z / l)
    acc.uv.push(0.5 + x * 0.5, 0.5 + y * 0.5)
    acc.idx.push(base + i)
  }
}

/**
 * Grow one pollarded plane, unit-free (≈ 12 m): a stout trunk, a vase of
 * limbs ending in knuckles, second-tier limbs, and fans of thin whips.
 * Returns the wood geometry and where the fairy lights go.
 */
function growPlane(THREE, seed, low) {
  const rand = seeded(seed)
  const acc = { pos: [], nor: [], uv: [], idx: [] }
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const up = V(0, 1, 0)
  const ico = new THREE.IcosahedronGeometry(1, 0)
  const wraps = []
  // trunk
  const trunkH = range(rand, 4.0, 4.8)
  const lx = range(rand, -0.18, 0.18)
  const lz = range(rand, -0.18, 0.18)
  const tp = []
  const tr = []
  for (let i = 0; i <= 5; i++) {
    const t = i / 5
    tp.push(V(lx * t * t + range(rand, -0.03, 0.03), trunkH * t, lz * t * t + range(rand, -0.03, 0.03)))
    tr.push(0.36 - 0.11 * t + (i === 0 ? 0.09 : 0))
  }
  wraps.push({ frames: tubeInto(THREE, acc, tp, tr, 9), from: 0.42, turns: 7, spacing: 0.13 })
  const top = tp[5]
  const nL = 4 + Math.floor(rand() * 2)
  for (let l = 0; l < nL; l++) {
    const a = (l / nL) * Math.PI * 2 + range(rand, -0.35, 0.35)
    const s = range(rand, 0.45, 0.9)
    const dir = V(Math.cos(a) * s, 1, Math.sin(a) * s).normalize()
    const out = V(Math.cos(a), 0, Math.sin(a))
    const len = range(rand, 3.0, 4.3)
    const start = top.clone().add(V(Math.cos(a) * 0.12, -range(rand, 0, 0.5), Math.sin(a) * 0.12))
    const pts = []
    const rr = []
    for (let i = 0; i <= 4; i++) {
      const t = i / 4
      pts.push(start.clone().addScaledVector(dir, len * t).addScaledVector(out, 0.4 * Math.sin(Math.PI * t)))
      rr.push(0.21 - 0.08 * t)
    }
    wraps.push({ frames: tubeInto(THREE, acc, pts, rr, 7), from: 0, turns: 3.5, spacing: 0.15 })
    const end = pts[4]
    knuckleInto(THREE, acc, end, 0.24, ico)
    // a few whips straight off the first knuckle
    for (let w = 0; w < 3; w++) {
      const aw = a + range(rand, -1.2, 1.2)
      const dw = V(Math.cos(aw) * range(rand, 0.2, 0.6), 1, Math.sin(aw) * range(rand, 0.2, 0.6)).normalize()
      const lw = range(rand, 0.9, 1.8)
      tubeInto(THREE, acc, [end, end.clone().addScaledVector(dw, lw * 0.5), end.clone().addScaledVector(dw, lw)], [0.035, 0.02, 0.006], 3)
    }
    const nS = 2 + Math.floor(rand() * 2)
    for (let k = 0; k < nS; k++) {
      const a2 = a + range(rand, -1.1, 1.1)
      const s2 = range(rand, 0.15, 0.5)
      const dir2 = V(Math.cos(a2) * s2, 1, Math.sin(a2) * s2).normalize()
      const len2 = range(rand, 1.8, 3.0)
      const pts2 = []
      const r2 = []
      for (let i = 0; i <= 3; i++) {
        const t = i / 3
        pts2.push(end.clone().addScaledVector(dir2, len2 * t).addScaledVector(up, -0.15 * Math.sin(Math.PI * t)))
        r2.push(0.12 - 0.045 * t)
      }
      wraps.push({ frames: tubeInto(THREE, acc, pts2, r2, 5), from: 0, turns: 2, spacing: 0.18 })
      const end2 = pts2[3]
      knuckleInto(THREE, acc, end2, 0.15, ico)
      const nW = (low ? 4 : 6) + Math.floor(rand() * 3)
      for (let w = 0; w < nW; w++) {
        const aw = rand() * Math.PI * 2
        const sw = range(rand, 0.08, 0.55)
        const dw = V(Math.cos(aw) * sw, 1, Math.sin(aw) * sw).normalize()
        const lw = range(rand, 1.1, 2.5)
        const mid = end2.clone().addScaledVector(dw, lw * 0.5).add(V(range(rand, -0.08, 0.08), 0, range(rand, -0.08, 0.08)))
        tubeInto(THREE, acc, [end2, mid, end2.clone().addScaledVector(dw, lw)], [0.035, 0.02, 0.006], 3)
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2))
  geo.setIndex(acc.idx)
  geo.computeBoundingSphere()

  // fairy lights: a string spiralled up the trunk and out along the limbs
  const bulbs = []
  const P = new THREE.Vector3()
  const Nn = new THREE.Vector3()
  const Bb = new THREE.Vector3()
  for (const w of wraps) {
    const f = w.frames
    let len = 0
    for (let i = 1; i < f.length; i++) len += f[i].p.distanceTo(f[i - 1].p)
    const span = 1 - w.from
    const avgR = (f[0].r + f[f.length - 1].r) / 2
    const count = Math.max(4, Math.round((len * span + w.turns * Math.PI * 2 * avgR) / w.spacing))
    for (let b = 0; b < count; b++) {
      const s = w.from + (span * b) / (count - 1)
      const fi = s * (f.length - 1)
      const i0 = Math.min(f.length - 2, Math.floor(fi))
      const k = fi - i0
      P.lerpVectors(f[i0].p, f[i0 + 1].p, k)
      Nn.lerpVectors(f[i0].n, f[i0 + 1].n, k).normalize()
      Bb.lerpVectors(f[i0].b, f[i0 + 1].b, k).normalize()
      const r = f[i0].r + (f[i0 + 1].r - f[i0].r) * k + 0.03
      const ang = (w.turns * Math.PI * 2 * (s - w.from)) / span
      bulbs.push(P.clone().addScaledVector(Nn, Math.cos(ang) * r).addScaledVector(Bb, Math.sin(ang) * r))
    }
  }
  return { geo, bulbs }
}

/** Plane-tree bark: camouflage patches of cream, olive and grey. */
function barkMap(THREE, seed) {
  return paintTexture(
    THREE,
    256,
    512,
    (g, w, h) => {
      const rand = seeded(seed)
      g.fillStyle = '#8f8878'
      g.fillRect(0, 0, w, h)
      const cols = ['#c9c0a6', '#b3ab92', '#7d7a62', '#6b6455', '#a49b84', '#d8d0b8']
      for (let i = 0; i < 220; i++) {
        g.fillStyle = pick(rand, cols)
        g.globalAlpha = range(rand, 0.5, 0.95)
        g.beginPath()
        const x = rand() * w
        const y = rand() * h
        g.ellipse(x, y, range(rand, 8, 34), range(rand, 10, 46), rand() * 3, 0, Math.PI * 2)
        g.fill()
        // wrap across the seam so it tiles
        if (x < 40) {
          g.beginPath()
          g.ellipse(x + w, y, 20, 26, 0, 0, Math.PI * 2)
          g.fill()
        }
      }
      g.globalAlpha = 1
      for (let i = 0; i < 1500; i++) {
        g.fillStyle = `rgba(0,0,0,${range(rand, 0.03, 0.1)})`
        g.fillRect(rand() * w, rand() * h, 1.5, range(rand, 2, 6))
      }
    },
    { kind: 'color' }
  )
}

/* --- the place ------------------------------------------------------------------- */

export function buildLeidseplein(THREE, ctx, { light = 'day' } = {}) {
  const world = createWorld(THREE, ctx, light, {
    // a low winter sun from the south-west, behind the hotel as you face it
    sun: { elevation: 14, azimuth: 214 },
    fog: { density: 0.0017 },
    sunColor: 0xfff0dc,
    sunIntensity: 2.1,
  })
  const { scene } = world
  const rand = seeded(1883)
  const low = ctx.quality === 'low'
  const quality = ctx.quality
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const mtx = (x, y, z, ry = 0) => new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z)
  const mul = (a, b) => a.clone().multiply(b)

  /* --- materials ----------------------------------------------------------- */

  const F = (opts) => {
    const f = M.facade(THREE, { quality, ...opts })
    // a facade texture holds 2 × 2 bays/storeys, so it repeats every 2 bays, 2 storeys
    return { mat: f.material, tile: [opts.bay * 2, opts.storey * 2], bay: opts.bay, storey: opts.storey }
  }
  const tint = (fac, hex) => {
    const m = fac.mat.clone()
    m.color.set(hex)
    return { ...fac, mat: m }
  }
  const facRed = F({ wall: 'brick', color: '#8a3f2c', mortar: '#c2ae98', frame: '#f0ebe1', glass: '#1f272e', bay: 2.6, storey: 3.3, window: { w: 0.52, h: 0.66, bars: 'sash', sill: true, lintel: true }, curtains: 0.3, seed: 101 })
  const facDark = tint(facRed, 0xa48a80)
  const facWarm = tint(facRed, 0xf1d6c6)
  const facTan = F({ wall: 'brick', color: '#bb987b', mortar: '#d6c8b6', frame: '#d8d2c8', glass: '#27313a', bay: 2.4, storey: 3.0, window: { w: 0.62, h: 0.6, bars: null, sill: true, lintel: false }, curtains: 0.45, seed: 102 })
  const facStone = F({ wall: 'stone', color: '#d9cfbb', frame: '#efe9de', glass: '#222a31', bay: 2.8, storey: 3.6, window: { w: 0.5, h: 0.68, bars: 'grid', sill: true, lintel: true }, curtains: 0.25, seed: 103 })
  const facWhite = tint(facStone, 0xf6f4f0)
  const shopTex = M.shopfront(THREE, { color: '#2b2622', frame: '#1d1d1d', fascia: '#262626', bay: 2.6, storey: SHOP_H, warm: 0.75, quality, seed: 104 })
  const shop = { mat: shopTex.material, tile: [5.2, SHOP_H] }
  const setts = M.paving(THREE, { kind: 'setts', color: '#77736d', joint: '#3f3c38', unit: 0.11, tile: 2, quality, seed: 105 })
  const flags = M.paving(THREE, { kind: 'flags', color: '#a39e96', joint: '#5b5853', unit: 0.3, tile: 3, quality, seed: 106 })
  const asphalt = M.asphalt(THREE, { color: '#505053', tile: 6, quality, seed: 107 })
  const bikeLane = asphalt.clone()
  bikeLane.color.setRGB(2.6, 0.95, 0.75)
  const granite = M.concrete(THREE, { color: '#9e978e', tile: 2, ties: false, quality, seed: 108 })
  const polished = granite.clone()
  polished.roughness = 0.42
  const stone = M.plaster(THREE, { color: '#ddd3bf', tile: 2, dirt: 0.14, quality, seed: 109 })
  const slate = M.roof(THREE, { kind: 'slate', tile: 2, quality, seed: 110 })
  const brick = M.brick(THREE, { color: '#6c3426', tile: 2, quality, seed: 111 })
  const roofFlat = new THREE.MeshStandardMaterial({ color: 0x3b3b3d, roughness: 0.92 })
  const copper = new THREE.MeshStandardMaterial({
    color: 0x6f9a88,
    roughness: 0.5,
    metalness: 0.35,
    normalMap: noiseNormalMap(THREE, 128, { cells: 10, strength: 1.5, octaves: 3 }),
  })
  const iron = new THREE.MeshStandardMaterial({ color: 0x24282b, roughness: 0.45, metalness: 0.7 })
  const fabric = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })
  // varnished timber (benches, boat decks): small enough not to need a painted set
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e5038, roughness: 0.55, normalMap: noiseNormalMap(THREE, 128, { cells: 4, strength: 2, octaves: 3, stretch: [1, 10] }) })

  const B = makeBatch(THREE) // buildings and props: cast and receive shadows
  const G = makeBatch(THREE, { cast: false }) // ground surfaces

  /* --- building kit ------------------------------------------------------------- */

  const quad = (w, h, tile, u0 = 0, v0 = 0) => {
    const g = new THREE.PlaneGeometry(w, h)
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (u0 + uv.getX(i) * w) / tile[0], (v0 + uv.getY(i) * h) / tile[1])
    return g
  }
  /** A box sitting on y = 0 with UVs in metres / tile. */
  const boxGeo = (w, h, d, tile = [2, 2]) => {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(0, h / 2, 0)
    const uv = g.attributes.uv
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
    return g
  }
  /** The faces of a w × h × d block in `frame` (footprint centred), from y0 up. */
  function faces(frame, { w, d, y0 = 0, h, front, back, left, right, top, tf, tb, ts, tt = [2, 2] }) {
    const put = (mat, geo, x, z, ry) => mat && B.add(mat, geo, mul(frame, mtx(x, y0 + h / 2, z, ry)))
    put(front, front && quad(w, h, tf), 0, d / 2, 0)
    put(back, back && quad(w, h, tb || tf), 0, -d / 2, Math.PI)
    put(right, right && quad(d, h, ts || tf), w / 2, 0, Math.PI / 2)
    put(left, left && quad(d, h, ts || tf), -w / 2, 0, -Math.PI / 2)
    if (top) {
      const g = quad(w, d, tt)
      g.rotateX(-Math.PI / 2)
      g.translate(0, h / 2, 0)
      put(top, g, 0, 0, 0)
    }
  }
  /** A roof shape (in the building's depth × height plane) run along its width. */
  function roofAlong(frame, pts, w, y, mat, tile = 2) {
    const s = new THREE.Shape()
    s.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1])
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false })
    const p = g.attributes.position
    const uv = g.attributes.uv
    // slates run along the eaves
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) / tile, (p.getY(i) + Math.abs(p.getX(i))) / tile)
    g.translate(0, 0, -w / 2)
    g.rotateY(Math.PI / 2)
    B.add(mat, g, mul(frame, mtx(0, y, 0)))
  }
  /** A Dutch gable on the street front: a flat cut-out shape carrying the facade. */
  function gableFront(frame, fac, w, d, y, kind) {
    const s = new THREE.Shape()
    const hw = w / 2
    const h = Math.min(7, w * 0.75)
    if (kind === 'step') {
      s.moveTo(-hw, 0)
      const n = 3
      for (let i = 0; i < n; i++) {
        s.lineTo(-hw + (hw * 0.8 * i) / n, (h * (i + 1)) / (n + 1))
        s.lineTo(-hw + (hw * 0.8 * (i + 1)) / n, (h * (i + 1)) / (n + 1))
      }
      s.lineTo(-hw * 0.2, h)
      s.lineTo(hw * 0.2, h)
      for (let i = n - 1; i >= 0; i--) {
        s.lineTo(hw - (hw * 0.8 * (i + 1)) / n, (h * (i + 1)) / (n + 1))
        s.lineTo(hw - (hw * 0.8 * i) / n, (h * (i + 1)) / (n + 1))
      }
      s.lineTo(hw, 0)
    } else {
      // a neck gable with curved shoulders
      s.moveTo(-hw, 0)
      s.quadraticCurveTo(-hw * 0.45, h * 0.1, -hw * 0.42, h * 0.55)
      s.lineTo(-hw * 0.3, h * 0.92)
      s.quadraticCurveTo(0, h * 1.08, hw * 0.3, h * 0.92)
      s.lineTo(hw * 0.42, h * 0.55)
      s.quadraticCurveTo(hw * 0.45, h * 0.1, hw, 0)
    }
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false })
    const p = g.attributes.position
    const uv = g.attributes.uv
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + hw) / fac.tile[0], (p.getY(i) + y) / fac.tile[1])
    B.add(fac.mat, g, mul(frame, mtx(0, y, d / 2 - 0.35)))
    // the roof behind it, ridge running back from the street
    const r = new THREE.Shape()
    r.moveTo(-hw, 0)
    r.lineTo(0, h * 0.92)
    r.lineTo(hw, 0)
    r.closePath()
    const rg = new THREE.ExtrudeGeometry(r, { depth: d - 0.4, bevelEnabled: false })
    const rp = rg.attributes.position
    const ruv = rg.attributes.uv
    for (let i = 0; i < rp.count; i++) ruv.setXY(i, rp.getZ(i) / 2, (rp.getY(i) + Math.abs(rp.getX(i))) / 2)
    B.add(slate, rg, mul(frame, mtx(0, y, -d / 2)))
    // a stone coping along the top edges of the gable
    B.add(stone, boxGeo(w * 0.42, 0.25, 0.5), mul(frame, mtx(0, y + h * 0.92 + (kind === 'step' ? 0.08 : 0.1), d / 2 - 0.2)))
  }

  /**
   * A town building, front facing local +Z (turned by ry), footprint centred on (x, z).
   * opts: w, d, storeys, fac, shop?, side (party-wall material or null = facade),
   *       roof: 'flat' | 'mansard' | 'gable' | 'step' | 'pitched', bands, cornice, awning colour
   */
  function building({ x, z, ry = 0, w, d, storeys, fac, withShop = false, side = null, roof = 'flat', bands = false, cornice = true, awning = null, back = true }) {
    const frame = mtx(x, 0, z, ry)
    const st = fac.storey
    const gH = withShop ? SHOP_H : st
    const top = gH + (storeys - 1) * st
    const sMat = side || fac.mat
    const sTile = side ? [2, 2] : fac.tile
    faces(frame, { w, d, y0: 0, h: gH, front: withShop ? shop.mat : fac.mat, back: back ? fac.mat : null, left: sMat, right: sMat, tf: withShop ? shop.tile : fac.tile, tb: fac.tile, ts: sTile })
    if (storeys > 1) {
      faces(frame, { w, d, y0: gH, h: top - gH, front: fac.mat, back: back ? fac.mat : null, left: sMat, right: sMat, top: roof === 'flat' || roof === 'mansard' ? roofFlat : null, tf: fac.tile, ts: sTile })
    }
    if (withShop) {
      // the stone band over the shops, and the awning
      B.add(stone, boxGeo(w, 0.32, 0.22), mul(frame, mtx(0, gH - 0.1, d / 2 + 0.1)))
      if (awning != null) awningAt(frame, w, d, awning)
    }
    if (bands) {
      for (let y = gH + st; y < top - 0.5; y += st) B.add(stone, boxGeo(w + 0.12, 0.22, 0.14), mul(frame, mtx(0, y - 0.24, d / 2 + 0.05)))
    }
    if (cornice) {
      B.add(stone, boxGeo(w + 0.36, 0.28, 0.55), mul(frame, mtx(0, top - 0.3, d / 2 + 0.05)))
      B.add(stone, boxGeo(w + 0.5, 0.2, 0.75), mul(frame, mtx(0, top - 0.02, d / 2 + 0.1)))
    }
    if (roof === 'mansard') {
      const hd = d / 2
      roofAlong(frame, [[-hd, 0], [hd, 0], [hd - 1.3, 3.3], [-hd + 1.3, 3.3]], w + 0.1, top, slate)
      // dormers, every other bay
      const n = Math.floor(w / (fac.bay * 2))
      for (let i = 0; i < n; i++) {
        const dx = -w / 2 + fac.bay * (2 * i + 1)
        const f = mul(frame, mtx(dx, top + 0.3, hd - 0.9))
        B.add(fac.mat, quad(fac.bay * 0.7, st * 0.8, fac.tile, fac.bay * 0.15, 0), mul(f, mtx(0, st * 0.4, 0.55)))
        B.add(slate, boxGeo(fac.bay * 0.8, 0.2, 1.4), mul(f, mtx(0, st * 0.8, 0)))
        for (const sx of [-1, 1]) B.add(slate, boxGeo(0.1, st * 0.8, 1.1), mul(f, mtx((sx * fac.bay * 0.7) / 2, 0, 0)))
      }
    } else if (roof === 'pitched') {
      const hd = d / 2 + 0.2
      roofAlong(frame, [[-hd, 0], [hd, 0], [0, Math.min(6, d * 0.42)]], w + 0.3, top, slate)
    } else if (roof === 'gable' || roof === 'step') {
      gableFront(frame, fac, w, d, top, roof === 'step' ? 'step' : 'neck')
    }
    return top
  }

  /** A striped canvas awning sloping out over the shopfront. */
  function awningAt(frame, w, d, hex) {
    const c = new THREE.Color(hex)
    const ww = w - 0.5
    const colour = (g) => {
      const n = g.attributes.position.count
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      return g
    }
    const slope = new THREE.BoxGeometry(ww, 0.05, 1.8)
    slope.rotateX(0.42)
    B.add(fabric, colour(slope), mul(frame, mtx(0, 3.05, d / 2 + 0.85)))
    B.add(fabric, colour(new THREE.BoxGeometry(ww, 0.32, 0.03)), mul(frame, mtx(0, 2.55, d / 2 + 1.68)))
  }

  /** A row of houses along (dx, dz) from (x0, z0) on the front line; fronts turned by ry. */
  function row(x0, z0, dx, dz, length, ry, { cafe = true, fronts = [facRed, facDark, facStone, facWarm, facWhite], hMin = 4, hMax = 6, d = 15, roofs = ['flat', 'mansard', 'gable', 'step', 'pitched', 'flat'], awnings = [0x6b1f22, 0x1f3348, 0x2c4a3a, 0x7a5a1e, 0x3a2a40, 0x1d1d1d] } = {}) {
    let t = 0
    const nx = Math.sin(ry)
    const nz = Math.cos(ry)
    while (t < length - 4) {
      const fac = pick(rand, fronts)
      const bays = 2 + Math.floor(rand() * 3)
      const w = Math.min(length - t, bays * fac.bay)
      const storeys = hMin + Math.floor(rand() * (hMax - hMin + 1))
      const roof = w < 9 ? pick(rand, roofs) : pick(rand, ['flat', 'mansard', 'pitched'])
      const cx = x0 + dx * (t + w / 2) - nx * (d / 2)
      const cz = z0 + dz * (t + w / 2) - nz * (d / 2)
      building({ x: cx, z: cz, ry, w, d, storeys, fac, withShop: cafe, side: brick, roof, bands: rand() < 0.4, awning: cafe && rand() < 0.75 ? pick(rand, awnings) : null })
      t += w
    }
  }

  /* --- ground --------------------------------------------------------------------- */

  /** A flat rectangle of ground at height y. */
  const groundRect = (mat, x0, x1, z0, z1, y = 0, tile = 2) => {
    const w = x1 - x0
    const d = z1 - z0
    const g = quad(w, d, [tile, tile])
    g.rotateX(-Math.PI / 2)
    G.add(mat, g, mtx((x0 + x1) / 2, y, (z0 + z1) / 2))
  }
  /** A raised pavement: flagstone top, granite kerbs round the edge. */
  const pavement = (x0, x1, z0, z1, h = 0.12) => {
    groundRect(flags, x0, x1, z0, z1, h, 3)
    const w = x1 - x0
    const d = z1 - z0
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    for (const [geo, x, z, ry] of [
      [quad(w, h, [2, 2]), cx, z1, 0],
      [quad(w, h, [2, 2]), cx, z0, Math.PI],
      [quad(d, h, [2, 2]), x1, cz, Math.PI / 2],
      [quad(d, h, [2, 2]), x0, cz, -Math.PI / 2],
    ])
      G.add(granite, geo, mtx(x, h / 2, z, ry))
  }

  // setts everywhere north of the canal and south of it; asphalt and red bike lanes on the canal street
  groundRect(setts, -700, 700, -36, 700, 0, 2)
  groundRect(asphalt, -700, 700, -56, -42, 0, 6)
  groundRect(bikeLane, -700, 700, -42, -40, 0, 6)
  groundRect(bikeLane, -700, 700, -57.5, -56, 0, 6)
  groundRect(setts, -700, 700, -40, -36, 0, 2)
  pavement(-700, 700, -40, -36)
  // the quays (cut for the bridge), the bridge deck, and the south bank
  pavement(-700, -22, CANAL_N, -57.5)
  pavement(-6, 700, CANAL_N, -57.5)
  groundRect(asphalt, -22, -6, CANAL_S - 2.5, -57.5, 0.02, 6)
  pavement(-22, -19.5, CANAL_S - 2.5, -57.5, 0.16)
  pavement(-8.5, -6, CANAL_S - 2.5, -57.5, 0.16)
  pavement(-700, -22, CANAL_S - 2.5, CANAL_S)
  pavement(-6, 700, CANAL_S - 2.5, CANAL_S)
  groundRect(asphalt, -700, 700, -92, CANAL_S - 2.5, 0, 6)
  pavement(-700, 700, -95.5, -92)
  groundRect(setts, -700, 700, -700, -95.5, 0, 2)
  // pavements in front of the buildings round the square and along Leidsestraat
  pavement(-44, -40, -36, 55)
  pavement(42, 46, -36, 14)
  pavement(42, 46, 28, 55)
  pavement(-40, 42, 51, 55)
  pavement(46, 264, 14, 15.8)
  pavement(60, 264, 26.2, 28)
  // the fountain's paved round, raised a step
  {
    const disc = new THREE.CircleGeometry(17, 72)
    const uv = disc.attributes.uv
    const p = disc.attributes.position
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 3, p.getY(i) / 3)
    disc.rotateX(-Math.PI / 2)
    G.add(flags, disc, mtx(0, 0.1, 0))
    const ring = new THREE.CylinderGeometry(17, 17, 0.1, 72, 1, true)
    scaleUV(ring, (2 * Math.PI * 17) / 2, 0.05)
    G.add(granite, ring, mtx(0, 0.05, 0))
  }

  /* --- the canal, quay walls and the Leidsebrug ----------------------------------- */

  const canal = waterMaterial(THREE, { palette: { ...world.light, water: { deep: 0x2d3936, shallow: 0x55625d, stroke: 0xffd7a6 } }, scale: 0.4, strokes: 0.6 })
  const canalWater = new THREE.Mesh(new THREE.PlaneGeometry(1400, CANAL_N - CANAL_S), canal)
  canalWater.rotation.x = -Math.PI / 2
  canalWater.position.set(0, WATER_Y, (CANAL_N + CANAL_S) / 2)
  scene.add(canalWater)
  for (const [z, ry] of [
    [CANAL_N, Math.PI],
    [CANAL_S, 0],
  ]) {
    const wall = quad(1400, 3, [2, 2])
    G.add(brick, wall, mtx(0, -1.5, z, ry))
    // granite coping along the edge
    B.add(granite, boxGeo(1400, 0.22, 0.45), mtx(0, -0.1, z + (ry === 0 ? 0.2 : -0.2)))
  }
  {
    // the bridge: a brick vault with a granite face, iron railings
    const s = new THREE.Shape()
    const z0 = CANAL_S - 1.5
    const z1 = CANAL_N + 1.5
    s.moveTo(z0, -3.3)
    s.lineTo(z1, -3.3)
    s.lineTo(z1, -0.03)
    s.lineTo(z0, -0.03)
    s.closePath()
    const hole = new THREE.Path()
    const zc = (CANAL_N + CANAL_S) / 2
    const half = 6
    hole.moveTo(zc - half, -2.9)
    hole.lineTo(zc - half, -2.2)
    hole.absarc(zc, -2.2 - 0.0, half, Math.PI, 0, true)
    hole.lineTo(zc + half, -2.9)
    hole.closePath()
    s.holes.push(hole)
    const g = new THREE.ExtrudeGeometry(s, { depth: 16, bevelEnabled: false, curveSegments: 24 })
    scaleUV(g, 0.5, 0.5)
    // shape x → world z, extrusion → world −x
    B.add(brick, g, new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(-6, 0, 0))
    const rails = beamBatch(THREE)
    for (const x of [-21.8, -6.2]) {
      for (let z = CANAL_S - 2; z <= CANAL_N + 2; z += 1.2) rails.add(V(x, 0.16, z), V(x, 1.15, z), 0.05)
      rails.add(V(x, 1.15, CANAL_S - 2.2), V(x, 1.15, CANAL_N + 2.2), 0.09, 0.07)
      rails.add(V(x, 0.45, CANAL_S - 2.2), V(x, 0.45, CANAL_N + 2.2), 0.05)
    }
    scene.add(rails.build(iron))
  }
  // a few boats moored along the quays
  {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x24392f, roughness: 0.5 })
    const hull = (len, wid) => {
      const g = new THREE.BoxGeometry(len, 0.9, wid, 8, 1, 1)
      const p = g.attributes.position
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) / (len / 2)
        const taper = x > 0.5 ? 1 - (x - 0.5) * 1.4 : 1
        p.setZ(i, p.getZ(i) * taper * (p.getY(i) < 0 ? 0.8 : 1))
      }
      g.computeVertexNormals()
      return g
    }
    for (const [x, z, len, ry] of [
      [36, CANAL_N - 1.6, 7.5, 0],
      [52, CANAL_N - 1.6, 6.5, Math.PI],
      [-60, CANAL_S + 1.7, 8, 0],
      [-110, CANAL_N - 1.6, 7, Math.PI],
    ]) {
      B.add(hullMat, hull(len, 2.1), mtx(x, WATER_Y + 0.3, z, ry))
      B.add(wood, boxGeo(len * 0.7, 0.05, 1.7, [2, 2]), mtx(x, WATER_Y + 0.75, z, ry))
    }
    // a glass-roofed canal cruiser at the south quay
    const cruiser = mtx(30, WATER_Y, CANAL_S + 2.3, 0)
    B.add(new THREE.MeshStandardMaterial({ color: 0x1f2a3a, roughness: 0.45 }), boxGeo(22, 1.2, 4.2), cruiser)
    B.add(new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.4 }), boxGeo(21, 0.25, 4.0), mul(cruiser, mtx(0, 1.2, 0)))
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x1b2229, roughness: 0.05, metalness: 0.3, clearcoat: 1, envMapIntensity: 1.3 })
    B.add(glass, new RoundedBoxGeometry(19, 1.3, 3.8, 3, 0.45), mul(cruiser, mtx(-0.5, 2.1, 0)))
  }

  /* --- the fountain ------------------------------------------------------------------ */

  const rim = new THREE.LatheGeometry(
    [new THREE.Vector2(8.8, 0.1), new THREE.Vector2(8.8, 0.6), new THREE.Vector2(8.76, 0.66), new THREE.Vector2(8.24, 0.66), new THREE.Vector2(8.2, 0.6), new THREE.Vector2(8.2, 0.3)],
    96
  )
  scaleUV(rim, (2 * Math.PI * 8.5) / 2, 0.6)
  B.add(polished, rim, null)
  const poolMat = waterMaterial(THREE, { palette: { ...world.light, water: { deep: 0x48585e, shallow: 0x8fa3a8, stroke: 0xffffff } }, scale: 0.1, strokes: 0 })
  const pool = new THREE.Mesh(new THREE.CircleGeometry(8.22, 72), poolMat)
  pool.rotation.x = -Math.PI / 2
  pool.position.y = 0.46
  scene.add(pool)
  // stepped round platforms in the water, off-centre like the real one
  const tiers = [
    { x: 5.0, z: -2.6, steps: [[2.7, 0.78], [1.85, 1.3], [0.85, 1.75]] },
    { x: -3.6, z: 3.1, steps: [[1.75, 0.66], [1.05, 1.1], [0.5, 1.45]] },
  ]
  const filmMat = new THREE.MeshStandardMaterial({ color: 0xdfe9ee, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false })
  for (const t of tiers) {
    for (const [r, h] of t.steps) {
      const c = new THREE.CylinderGeometry(r, r * 1.02, h, 48)
      scaleUV(c, (2 * Math.PI * r) / 2, h / 2)
      B.add(polished, c, mtx(t.x, h / 2, t.z))
      // a thin sheet of water sliding down each step
      const film = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.025, r * 1.02 + 0.03, h - 0.42, 48, 1, true), filmMat)
      film.position.set(t.x, 0.46 + (h - 0.42) / 2, t.z)
      scene.add(film)
    }
  }
  // bronze figures: a bird with raised wings on a plinth, and two lizards basking on the rim
  {
    const bronze = new THREE.MeshStandardMaterial({ color: 0x4d3d2c, roughness: 0.4, metalness: 0.75 })
    const blob = (sx, sy, sz) => new THREE.SphereGeometry(1, 18, 12).scale(sx, sy, sz)
    const bx = 6.6
    const bz = 4.2
    B.add(polished, new THREE.CylinderGeometry(0.42, 0.5, 1.05, 24).translate(0, 0.52, 0), mtx(bx, 0, bz))
    const bird = mtx(bx, 1.05, bz, -0.7)
    B.add(bronze, blob(0.28, 0.42, 0.24), mul(bird, mtx(0, 0.4, 0)))
    B.add(bronze, blob(0.13, 0.14, 0.12), mul(bird, mtx(0.08, 0.86, 0)))
    B.add(bronze, new THREE.ConeGeometry(0.05, 0.16, 8).rotateZ(-Math.PI / 2), mul(bird, mtx(0.25, 0.84, 0)))
    for (const s of [-1, 1]) {
      const wing = blob(0.16, 0.62, 0.05)
      wing.rotateX(s * 0.75)
      B.add(bronze, wing, mul(bird, mtx(-0.05, 0.75, s * 0.36)))
    }
    for (const a of [2.5, 3.9]) {
      const f = mtx(Math.cos(a) * 8.5, 0.66, Math.sin(a) * 8.5, -a + Math.PI / 2)
      B.add(bronze, blob(0.95, 0.24, 0.32), mul(f, mtx(0, 0.18, 0)))
      B.add(bronze, blob(0.24, 0.17, 0.2), mul(f, mtx(1.05, 0.24, 0)))
      B.add(bronze, new THREE.ConeGeometry(0.16, 1.1, 10).rotateZ(Math.PI / 2), mul(f, mtx(-1.4, 0.14, 0)))
      for (const [lx, lz] of [
        [0.5, 0.33],
        [0.5, -0.33],
        [-0.5, 0.33],
        [-0.5, -0.33],
      ])
        B.add(bronze, blob(0.16, 0.06, 0.08), mul(f, mtx(lx, 0.05, lz)))
    }
  }
  // the jets: thousands of droplets flying on real parabolas, drawn on the GPU
  const jetsU = { uTime: { value: 0 } }
  {
    const starts = []
    const vels = []
    const lives = []
    const phases = []
    const cores = []
    const g = 9.8
    const jet = (S, Vv, count, spread) => {
      // time of flight back down to the water
      const dy = S.y - 0.46
      const T = (Vv.y + Math.sqrt(Vv.y * Vv.y + 2 * g * Math.max(0, dy))) / g
      for (let i = 0; i < count; i++) {
        starts.push(S.x, S.y, S.z)
        vels.push(Vv.x * range(rand, 0.95, 1.05) + range(rand, -spread, spread), Vv.y * range(rand, 0.94, 1.03), Vv.z * range(rand, 0.95, 1.05) + range(rand, -spread, spread))
        lives.push(T)
        phases.push(rand())
      }
      const pts = []
      for (let i = 0; i <= 16; i++) {
        const t = (T * i) / 16
        pts.push(V(S.x + Vv.x * t, S.y + Vv.y * t - 0.5 * g * t * t, S.z + Vv.z * t))
      }
      cores.push(pts)
    }
    const per = low ? 50 : 110
    // arcs from the rim toward the middle
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.2
      const S = V(Math.cos(a) * 8.15, 0.62, Math.sin(a) * 8.15)
      const vy = Math.sqrt(2 * g * 2.3)
      jet(S, V(-Math.cos(a) * 2.8, vy, -Math.sin(a) * 2.8), per, 0.12)
    }
    // a ring of low upright jets
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      jet(V(Math.cos(a) * 6.3, 0.46, Math.sin(a) * 6.3), V(0, Math.sqrt(2 * g * range(rand, 0.8, 1.3)), 0), Math.round(per * 0.5), 0.18)
    }
    // spouts on top of the stepped platforms
    for (const t of tiers) {
      const topY = t.steps[t.steps.length - 1][1]
      jet(V(t.x, topY, t.z), V(0, Math.sqrt(2 * g * 1.6), 0), per, 0.3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(starts, 3))
    geo.setAttribute('aVel', new THREE.Float32BufferAttribute(vels, 3))
    geo.setAttribute('aLife', new THREE.Float32BufferAttribute(lives, 1))
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1))
    geo.boundingSphere = new THREE.Sphere(V(0, 2, 0), 12)
    const dropMat = new THREE.ShaderMaterial({
      uniforms: { uTime: jetsU.uTime, uColor: { value: new THREE.Color(0xeef4f8).multiplyScalar(1.15) } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aVel; attribute float aLife; attribute float aPhase;
        uniform float uTime; varying float vA;
        void main() {
          float t = mod(uTime + aPhase * aLife, aLife);
          vec3 p = position + aVel * t + vec3(0.0, -4.9 * t * t, 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(0.055 * 700.0 / -mv.z, 1.0, 9.0);
          vA = 0.55 * smoothstep(0.0, 0.08, t / aLife) * (1.0 - smoothstep(0.85, 1.0, t / aLife));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.15, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    })
    const drops = new THREE.Points(geo, dropMat)
    drops.frustumCulled = false
    drops.layers.set(NO_INK_LAYER)
    scene.add(drops)
    // the glassy core of each stream
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xf2f6f8, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false })
    const tubes = cores.map((pts) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.03, 5, false))
    const coreMesh = new THREE.Mesh(mergeGeometries(tubes, false), coreMat)
    coreMesh.layers.set(NO_INK_LAYER)
    scene.add(coreMesh)
  }

  /* --- the plane trees and their fairy lights ------------------------------------- */

  const lit = []
  const unlit = []
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.25
    lit.push({ x: Math.cos(a) * 13.6, z: Math.sin(a) * 13.6 })
  }
  for (let x = -40; x <= 40; x += 13) lit.push({ x: x + range(rand, -1, 1), z: 47 })
  const quayStep = low ? 19 : 9.5
  for (let x = -200; x <= 200; x += quayStep) {
    if (Math.abs(x + 14) < 10) continue
    ;(Math.abs(x) < 75 ? lit : unlit).push({ x: x + range(rand, -0.8, 0.8), z: CANAL_N + 1.25 })
    unlit.push({ x: x + range(rand, -0.8, 0.8) + 4, z: CANAL_S - 1.25 })
  }
  {
    const barkMat = new THREE.MeshStandardMaterial({
      map: barkMap(THREE, 7),
      // the camouflage reads in sunlight; keep it from glowing chalk-white
      color: 0xa69d8c,
      normalMap: noiseNormalMap(THREE, 128, { cells: 8, strength: 2.2, octaves: 3, stretch: [1, 2] }),
      roughness: 0.9,
      side: THREE.DoubleSide,
    })
    const variants = [growPlane(THREE, 31, low), growPlane(THREE, 57, low), growPlane(THREE, 83, low)]
    const all = [...lit.map((s) => ({ ...s, lit: true })), ...unlit]
    const groups = variants.map(() => [])
    all.forEach((s, i) => groups[i % variants.length].push(s))
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const bulbPos = []
    const tmp = new THREE.Vector3()
    groups.forEach((list, vi) => {
      if (!list.length) return
      const mesh = new THREE.InstancedMesh(variants[vi].geo, barkMat, list.length)
      list.forEach((s, j) => {
        const k = range(rand, 0.9, 1.12)
        q.setFromAxisAngle(V(0, 1, 0), rand() * Math.PI * 2)
        m4.compose(V(s.x, 0, s.z), q, V(k, k * range(rand, 0.95, 1.08), k))
        mesh.setMatrixAt(j, m4)
        if (s.lit) {
          for (const b of variants[vi].bulbs) {
            tmp.copy(b).applyMatrix4(m4)
            bulbPos.push(tmp.x, tmp.y, tmp.z)
          }
        }
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.castShadow = mesh.receiveShadow = true
      scene.add(mesh)
    })
    if (bulbPos.length) {
      const bg = new THREE.BufferGeometry()
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bulbPos, 3))
      bg.computeBoundingSphere()
      const glow = glowTexture(THREE, 'rgba(255,214,150,1)', 64)
      const core = new THREE.Points(
        bg,
        new THREE.PointsMaterial({ color: new THREE.Color(1, 0.68, 0.32).multiplyScalar(5), size: 0.07, map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
      )
      const halo = new THREE.Points(
        bg,
        new THREE.PointsMaterial({ color: new THREE.Color(1, 0.62, 0.28).multiplyScalar(0.55), size: 0.34, map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
      )
      for (const p of [core, halo]) {
        p.layers.set(NO_INK_LAYER)
        scene.add(p)
      }
    }
  }

  /* --- tram tracks, wires and the stop --------------------------------------------------- */

  const railMat = new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 0.28, metalness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 })
  const grooveMat = new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 })
  const track = (cx, cz, len, ry) => {
    for (const s of [-0.7175, 0.7175]) {
      for (const off of [0, 0.045]) {
        const g = quad(len, off ? 0.035 : 0.07, [2, 2])
        g.rotateX(-Math.PI / 2)
        const sideOff = s + (off ? Math.sign(s) * -0.055 : 0)
        G.add(off ? grooveMat : railMat, g, mul(mtx(cx, 0.006, cz, ry), mtx(0, 0, sideOff)))
      }
    }
  }
  track(0, -46.6, 1400, 0)
  track(0, -51.4, 1400, 0)
  track(160, 21, 220, 0)
  {
    const wires = beamBatch(THREE)
    // the canal street: poles both sides, span wires, a contact wire over each track
    for (let x = -300; x <= 300; x += 32) {
      if (Math.abs(x + 14) < 10) continue
      wires.add(V(x, 0.12, -39.5), V(x, 7.6, -39.5), 0.2)
      wires.add(V(x, 0.12, -58.2), V(x, 7.6, -58.2), 0.2)
      wires.add(V(x, 7.0, -39.5), V(x, 7.0, -58.2), 0.025)
    }
    for (const z of [-46.6, -51.4]) {
      for (let x = -300; x < 300; x += 32) {
        wires.add(V(x, 6.0, z + 0.2), V(x + 16, 6.0, z - 0.2), 0.022)
        wires.add(V(x + 16, 6.0, z - 0.2), V(x + 32, 6.0, z + 0.2), 0.022)
        wires.add(V(x, 7.0, z), V(x, 6.0, z), 0.015)
      }
    }
    // Leidsestraat: wires hung from the facades
    for (let x = 64; x <= 260; x += 24) {
      wires.add(V(x, 7.4, 14), V(x, 7.4, 28), 0.022)
      wires.add(V(x, 7.4, 21), V(x, 6.0, 21), 0.015)
    }
    wires.add(V(52, 6.0, 21), V(262, 6.0, 21), 0.022)
    scene.add(wires.build(new THREE.MeshStandardMaterial({ color: 0x33373a, roughness: 0.5, metalness: 0.6 })))
  }
  // the stop: a raised island with a glass shelter
  pavement(-64, -26, -45.2, -43.4, 0.25)
  {
    const sh = mtx(-42, 0.25, -44.3)
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.4, metalness: 0.7 })
    const fr = beamBatch(THREE)
    for (const x of [-3, 0, 3]) fr.add(V(x, 0, 0.6), V(x, 2.5, 0.6), 0.07)
    for (const x of [-3, 3]) fr.add(V(x, 0, -0.6), V(x, 2.5, -0.6), 0.07)
    const frm = fr.build(frameMat)
    frm.applyMatrix4(sh)
    scene.add(frm)
    const glassP = new THREE.MeshPhysicalMaterial({ color: 0xc9d6dc, roughness: 0.04, metalness: 0, transmission: 0, transparent: true, opacity: 0.25, envMapIntensity: 1.4 })
    const back = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 0.02), glassP)
    back.applyMatrix4(mul(sh, mtx(0, 1.25, 0.6)))
    scene.add(back)
    B.add(frameMat, boxGeo(6.6, 0.12, 1.6), mul(sh, mtx(0, 2.5, 0)))
    // the stop sign: a pole with the blue-and-white GVB box
    const signTex = paintTexture(
      THREE,
      128,
      128,
      (g, w, h) => {
        g.fillStyle = '#ffffff'
        g.fillRect(0, 0, w, h)
        g.fillStyle = '#1d4f9c'
        g.fillRect(0, 0, w, h * 0.42)
        g.fillStyle = '#ffffff'
        g.font = 'bold 40px sans-serif'
        g.textAlign = 'center'
        g.fillText('2  12', w / 2, h * 0.32)
        g.fillStyle = '#1d4f9c'
        g.font = 'bold 22px sans-serif'
        g.fillText('Leidseplein', w / 2, h * 0.75)
      },
      { kind: 'color' }
    )
    B.add(iron, new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8).translate(0, 1.6, 0), mtx(-35.5, 0.25, -44.1))
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.12), [frameMat, frameMat, frameMat, frameMat, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5 }), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5 })])
    sign.position.set(-35.5, 3.25, -44.1)
    sign.castShadow = true
    scene.add(sign)
  }

  /* --- a GVB tram waiting at the stop ------------------------------------------------ */

  {
    const white = new THREE.MeshPhysicalMaterial({ color: 0xeeeeea, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 })
    const blue = new THREE.MeshPhysicalMaterial({ color: 0x1f56b0, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 })
    const tGlass = new THREE.MeshPhysicalMaterial({ color: 0x141b22, roughness: 0.04, metalness: 0.45, clearcoat: 1, envMapIntensity: 1.3 })
    const black = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.6 })
    const amber = new THREE.MeshStandardMaterial({ color: 0x110800, emissive: 0xffa640, emissiveIntensity: 1.6 })
    const tram = mtx(-44, 0, -46.6, 0)
    const cars = 3
    const L = 9.6
    for (let i = 0; i < cars; i++) {
      const cx = (i - (cars - 1) / 2) * (L + 0.7)
      const f = mul(tram, mtx(cx, 0, 0))
      B.add(white, new RoundedBoxGeometry(L, 2.95, 2.4, 3, 0.22), mul(f, mtx(0, 0.38 + 1.475, 0)))
      B.add(tGlass, boxGeo(L - 0.9, 1.22, 2.43), mul(f, mtx(0, 1.55, 0)))
      B.add(blue, boxGeo(L - 0.25, 0.5, 2.44), mul(f, mtx(0, 0.42, 0)))
      B.add(blue, boxGeo(L - 0.5, 0.12, 2.42), mul(f, mtx(0, 2.95, 0)))
      // doors, both sides
      for (const dx of [-L * 0.25, L * 0.25]) {
        for (const s of [-1, 1]) B.add(tGlass, boxGeo(1.3, 2.3, 0.05), mul(f, mtx(dx, 0.45, s * 1.215)))
      }
      // roof gear and the running gear under the floor
      B.add(black, boxGeo(L * 0.4, 0.35, 1.5), mul(f, mtx(0, 3.33, 0)))
      B.add(black, boxGeo(2.2, 0.42, 2.0), mul(f, mtx(-L * 0.28, 0, 0)))
      B.add(black, boxGeo(2.2, 0.42, 2.0), mul(f, mtx(L * 0.28, 0, 0)))
      if (i < cars - 1) B.add(black, boxGeo(0.75, 2.6, 2.2), mul(f, mtx(L / 2 + 0.35, 0.45, 0)))
    }
    // cab ends: a raked black windscreen and the destination display
    const ends = (cars * (L + 0.7) - 0.7) / 2
    for (const s of [-1, 1]) {
      const scr = boxGeo(0.06, 1.5, 2.1)
      scr.rotateZ(s * -0.18)
      B.add(tGlass, scr, mul(tram, mtx(s * (ends + 0.02), 1.45, 0)))
      B.add(amber, boxGeo(0.04, 0.22, 1.3), mul(tram, mtx(s * (ends + 0.05), 3.0, 0)))
    }
    // pantograph
    const pg = beamBatch(THREE)
    const pz = 0
    pg.add(V(-0.6, 3.5, pz - 0.5), V(0.4, 4.6, pz), 0.05)
    pg.add(V(-0.6, 3.5, pz + 0.5), V(0.4, 4.6, pz), 0.05)
    pg.add(V(0.4, 4.6, pz), V(-0.2, 5.92, pz), 0.04)
    pg.add(V(-0.2, 5.92, pz - 0.75), V(-0.2, 5.92, pz + 0.75), 0.06)
    const pm = pg.build(black)
    pm.applyMatrix4(tram)
    scene.add(pm)
  }

  /* --- the landmarks round the square ---------------------------------------------------- */

  // The Stadsschouwburg: red brick and light stone, an arched loggia carrying a
  // balustraded terrace, tall windows above, a pediment, corner pavilions and
  // the fly tower behind. Front faces +X at x = −44.
  {
    const w = 50
    const d = 32
    const frame = mtx(-60, 0, 13, Math.PI / 2)
    const bay = w / 14
    const fT = [bay * 2, 14] // ground: 7 m storeys
    const uT = [bay * 2, 12] // upper: 6 m storeys
    faces(frame, { w, d, y0: 0, h: 7, front: facRed.mat, back: brick, left: facRed.mat, right: facRed.mat, tf: fT, tb: [2, 2], ts: fT })
    faces(frame, { w, d, y0: 7, h: 12, front: facRed.mat, back: brick, left: facRed.mat, right: facRed.mat, top: roofFlat, tf: uT, tb: [2, 2], ts: uT })
    // stone pilasters between the bays, bands, a heavy cornice and balustrade
    for (let i = 0; i <= 14; i++) B.add(stone, boxGeo(0.62, 12, 0.3), mul(frame, mtx(-w / 2 + i * bay, 7, d / 2 + 0.12)))
    for (const y of [6.8, 12.8]) B.add(stone, boxGeo(w + 0.4, 0.42, 0.4), mul(frame, mtx(0, y, d / 2 + 0.1)))
    B.add(stone, boxGeo(w + 1.2, 0.9, 1.1), mul(frame, mtx(0, 19, d / 2 + 0.25)))
    for (const sx of [-1, 1]) for (let y = 0.2; y < 18.5; y += 1.1) B.add(stone, boxGeo(0.9, 0.5, 0.9), mul(frame, mtx(sx * (w / 2 - 0.3), y, d / 2 - 0.3)))
    const bal = beamBatch(THREE)
    // the parapet balustrade on the cornice and on the loggia terrace
    const lw = 26
    for (let x = -w / 2 + 0.2; x <= w / 2 - 0.2; x += 0.34) bal.add(V(x, 19.9, d / 2 + 0.25), V(x, 20.7, d / 2 + 0.25), 0.13)
    for (let x = -lw / 2; x <= lw / 2; x += 0.34) bal.add(V(x, 7.4, d / 2 + 4.3), V(x, 8.15, d / 2 + 4.3), 0.13)
    const balMesh = bal.build(stone)
    balMesh.applyMatrix4(frame)
    scene.add(balMesh)
    B.add(stone, boxGeo(w, 0.25, 0.5), mul(frame, mtx(0, 20.7, d / 2 + 0.25)))
    // the loggia: seven round arches in a stone screen, a terrace slab on top
    {
      const s = new THREE.Shape()
      s.moveTo(-lw / 2, -0.3)
      s.lineTo(lw / 2, -0.3)
      s.lineTo(lw / 2, 7.1)
      s.lineTo(-lw / 2, 7.1)
      s.closePath()
      const n = 7
      const pitch = lw / n
      for (let i = 0; i < n; i++) {
        const cx = -lw / 2 + pitch * (i + 0.5)
        const r = pitch * 0.34
        const hole = new THREE.Path()
        hole.moveTo(cx - r, 0)
        hole.lineTo(cx + r, 0)
        hole.lineTo(cx + r, 4.1)
        hole.absarc(cx, 4.1, r, 0, Math.PI, false)
        hole.lineTo(cx - r, 0)
        s.holes.push(hole)
      }
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.9, bevelEnabled: false, curveSegments: 14 })
      scaleUV(g, 0.5, 0.5)
      B.add(stone, g, mul(frame, mtx(0, 0, d / 2 + 3.6)))
      B.add(stone, boxGeo(lw + 0.6, 0.4, 4.9), mul(frame, mtx(0, 7.0, d / 2 + 2.25)))
      B.add(stone, boxGeo(lw + 0.2, 0.25, 0.25), mul(frame, mtx(0, 8.15, d / 2 + 4.3)))
      // floor of the loggia, and warm lanterns hanging in the arches
      B.add(flags, boxGeo(lw, 0.25, 4.5, [3, 3]), mul(frame, mtx(0, 0, d / 2 + 2.25)))
      const lantern = new THREE.MeshStandardMaterial({ color: 0x221a10, emissive: 0xffc77a, emissiveIntensity: 2.2 })
      for (let i = 0; i < n; i++) B.add(lantern, boxGeo(0.3, 0.45, 0.3), mul(frame, mtx(-lw / 2 + pitch * (i + 0.5), 5.4, d / 2 + 2.2)))
    }
    // the pediment over the middle five bays
    {
      const pw = bay * 5
      const s = new THREE.Shape()
      s.moveTo(-pw / 2, 0)
      s.lineTo(0, 4.6)
      s.lineTo(pw / 2, 0)
      s.closePath()
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.8, bevelEnabled: false })
      const p = g.attributes.position
      const uv = g.attributes.uv
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + pw / 2) / uT[0], p.getY(i) / uT[1])
      B.add(facRed.mat, g, mul(frame, mtx(0, 20.7, d / 2 - 0.6)))
      for (const sx of [-1, 1]) {
        const edge = boxGeo(Math.hypot(pw / 2, 4.6) + 0.6, 0.45, 1.0)
        edge.translate(0, -0.22, 0)
        edge.rotateZ(sx * -Math.atan2(4.6, pw / 2))
        B.add(stone, edge, mul(frame, mtx((sx * pw) / 4, 20.7 + 2.3, d / 2 - 0.2)))
      }
    }
    // corner pavilions with pyramid roofs
    for (const sx of [-1, 1]) {
      const f = mul(frame, mtx(sx * (w / 2 - 3.2), 0, d / 2 - 3.6))
      faces(f, { w: 6.6, d: 7.6, y0: 19, h: 4.2, front: facRed.mat, left: facRed.mat, right: facRed.mat, back: brick, tf: uT, ts: uT, tb: [2, 2] })
      B.add(stone, boxGeo(7.2, 0.5, 8.2), mul(f, mtx(0, 23.2, 0)))
      const pyr = new THREE.ConeGeometry(5.2, 4.4, 4, 1)
      pyr.rotateY(Math.PI / 4)
      pyr.translate(0, 2.2, 0)
      scaleUV(pyr, 6, 2)
      B.add(slate, pyr, mul(f, mtx(0, 23.7, 0)))
      B.add(iron, new THREE.ConeGeometry(0.12, 2.2, 6).translate(0, 1.1, 0), mul(f, mtx(0, 28.1, 0)))
    }
    // the fly tower and the hall roof behind
    faces(mtx(-68, 0, 13, Math.PI / 2), { w: 26, d: 16, y0: 19, h: 12, front: brick, back: brick, left: brick, right: brick, top: roofFlat, tf: [2, 2] })
    roofAlong(mtx(-60, 0, 13, 0), [[-25.2, 0], [25.2, 0], [0, 6]], 30, 19, slate)
  }

  // The American Hotel: Art Nouveau brick with stone bands, the café on the
  // ground floor, a mansard, and its corner tower over the canal street.
  {
    const fac = facWarm
    building({ x: -62, z: -25, ry: Math.PI, w: 36.4, d: 22, storeys: 5, fac, withShop: true, side: null, roof: 'mansard', bands: true, awning: 0x2a2a2a })
    // its east face onto the square gets shopfronts too
    faces(mtx(-43.79, 0, -25, Math.PI / 2), { w: 22, d: 0.01, y0: 0, h: SHOP_H, front: shop.mat, tf: shop.tile })
    // the corner tower
    const tw = mtx(-45.5, 0, -34.5, Math.PI)
    const th = 24
    faces(tw, { w: 6.8, d: 6.8, y0: 0, h: th, front: fac.mat, back: fac.mat, left: fac.mat, right: fac.mat, tf: fac.tile })
    for (let y = SHOP_H; y < th; y += fac.storey) B.add(stone, boxGeo(7.0, 0.24, 7.0), mul(tw, mtx(0, y - 0.24, 0)))
    B.add(stone, boxGeo(7.6, 0.6, 7.6), mul(tw, mtx(0, th, 0)))
    const spire = new THREE.ConeGeometry(5.0, 7.5, 4, 1)
    spire.rotateY(Math.PI / 4)
    spire.translate(0, 3.75, 0)
    scaleUV(spire, 6, 3)
    B.add(slate, spire, mul(tw, mtx(0, th + 0.6, 0)))
    B.add(copper, new THREE.ConeGeometry(0.35, 3.4, 8).translate(0, 1.7, 0), mul(tw, mtx(0, th + 7.9, 0)))
    // clock faces on the two street sides
    const clockTex = paintTexture(
      THREE,
      128,
      128,
      (g, w) => {
        g.fillStyle = '#f2eee4'
        g.beginPath()
        g.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = '#1b1b1b'
        g.lineWidth = 5
        g.stroke()
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2
          g.fillStyle = '#1b1b1b'
          g.fillRect(w / 2 + Math.cos(a) * 50 - 3, w / 2 + Math.sin(a) * 50 - 3, 6, 6)
        }
        g.lineWidth = 6
        g.beginPath()
        g.moveTo(w / 2, w / 2)
        g.lineTo(w / 2 + 28, w / 2 + 14)
        g.moveTo(w / 2, w / 2)
        g.lineTo(w / 2 - 6, w / 2 - 42)
        g.stroke()
      },
      { kind: 'color' }
    )
    const clockMat = new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.4, transparent: false })
    for (const ry of [0, -Math.PI / 2]) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), clockMat)
      c.applyMatrix4(mul(tw, mul(mtx(0, th - 2.4, 0, ry), mtx(0, 0, 3.42))))
      scene.add(c)
    }
  }

  // The domed stone corner block where Leidsestraat leaves the square
  {
    const fac = facStone
    building({ x: 63, z: -11, ry: -Math.PI / 2, w: 50, d: 34, storeys: 5, fac, withShop: true, side: null, roof: 'mansard', bands: true, awning: 0x1f3348 })
    // the round corner tower and its dome
    const cx = 48.6
    const cz = 11.2
    const r = 4.6
    const top = SHOP_H + 4 * fac.storey
    const cyl = new THREE.CylinderGeometry(r, r, top, 40, 1, true)
    cyl.translate(0, top / 2, 0)
    scaleUV(cyl, (2 * Math.PI * r) / fac.tile[0], top / fac.tile[1])
    B.add(fac.mat, cyl, mtx(cx, 0, cz))
    for (let y = SHOP_H; y < top; y += fac.storey) B.add(stone, new THREE.CylinderGeometry(r + 0.12, r + 0.12, 0.24, 40).translate(0, y - 0.12, 0), mtx(cx, 0, cz))
    B.add(stone, new THREE.CylinderGeometry(r + 0.45, r + 0.3, 0.7, 40).translate(0, top + 0.35, 0), mtx(cx, 0, cz))
    const drum = new THREE.CylinderGeometry(r - 0.4, r - 0.4, 2.8, 40, 1, false)
    drum.translate(0, top + 0.7 + 1.4, 0)
    scaleUV(drum, (2 * Math.PI * r) / 2, 1.4)
    B.add(stone, drum, mtx(cx, 0, cz))
    const dome = new THREE.SphereGeometry(r - 0.2, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2)
    dome.scale(1, 1.3, 1)
    scaleUV(dome, 12, 4)
    B.add(copper, dome, mtx(cx, top + 3.5, cz))
    const lanternY = top + 3.5 + (r - 0.2) * 1.3
    B.add(stone, new THREE.CylinderGeometry(0.75, 0.85, 1.8, 16).translate(0, 0.9, 0), mtx(cx, lanternY - 0.2, cz))
    B.add(copper, new THREE.SphereGeometry(0.85, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mtx(cx, lanternY + 1.6, cz))
    B.add(copper, new THREE.ConeGeometry(0.1, 1.6, 6).translate(0, 0.8, 0), mtx(cx, lanternY + 2.4, cz))
  }

  // Across the canal: the tall hotel block, tan brick, rows of identical windows
  {
    const fac = facTan
    const w = 91.2
    const d = 22
    const frame = mtx(15, 0, -95.5 - d / 2, 0)
    const storeys = 11
    const top = building({ x: 15, z: -95.5 - d / 2, ry: 0, w, d, storeys, fac, withShop: true, side: null, roof: 'flat', cornice: false, awning: null })
    // vertical brick piers in a lighter tone, and a crisp coping
    for (let i = 0; i <= w / (fac.bay * 4); i++) B.add(stone, boxGeo(0.5, top - SHOP_H, 0.25), mul(frame, mtx(-w / 2 + i * fac.bay * 4, SHOP_H, d / 2 + 0.1)))
    B.add(stone, boxGeo(w + 0.4, 0.5, 0.5), mul(frame, mtx(0, top, d / 2)))
    // a set-back top floor and plant rooms
    faces(mul(frame, mtx(0, 0, -2)), { w: w - 8, d: d - 6, y0: top, h: 3.0, front: fac.mat, left: fac.mat, right: fac.mat, back: fac.mat, top: roofFlat, tf: fac.tile })
    B.add(roofFlat, boxGeo(10, 2.4, 6), mul(frame, mtx(-20, top + 3, -3)))
    B.add(roofFlat, boxGeo(7, 3.2, 5), mul(frame, mtx(24, top + 3, -4)))
  }

  /* --- the rows of houses ------------------------------------------------------------- */

  // across the canal, either side of the hotel
  row(-220, -95.5, 1, 0, 189, 0, { cafe: true, hMin: 5, hMax: 6 })
  row(61, -95.5, 1, 0, 200, 0, { cafe: true, hMin: 5, hMax: 6 })
  // the canal street west of the American Hotel
  row(-80, -36, -1, 0, 140, Math.PI, { cafe: true })
  // behind the theatre, on Marnixstraat
  row(-44, 41, 0, 1, 110, Math.PI / 2, { cafe: true })
  // the north side of the square: cafés with awnings
  row(46, 55, -1, 0, 90, Math.PI, { cafe: true, hMin: 4, hMax: 5 })
  // the café row north of Leidsestraat, facing the square
  row(46, 28, 0, 1, 27, -Math.PI / 2, { cafe: true, hMin: 4, hMax: 5 })
  // the canal street east of the corner block
  row(80.2, -36, 1, 0, 160, Math.PI, { cafe: true })
  // Leidsestraat: narrow, shops all along, brick with stone trim
  row(80, 14, 1, 0, 182, 0, { cafe: true, hMin: 4, hMax: 5, d: 14, fronts: [facRed, facDark, facWarm, facStone, facRed] })
  row(61, 28, 1, 0, 201, Math.PI, { cafe: true, hMin: 4, hMax: 5, d: 14, fronts: [facRed, facDark, facWarm, facWhite, facRed] })
  // closing the far end of Leidsestraat
  building({ x: 270, z: 21, ry: -Math.PI / 2, w: 26, d: 14, storeys: 5, fac: facStone, withShop: true, side: null, roof: 'mansard', bands: true, awning: 0x6b1f22 })

  /* --- street furniture ------------------------------------------------------------- */

  {
    // Amsterdammertjes: the red-brown cast-iron bollards
    const pts = []
    for (let x = -300; x <= 300; x += 1.7) {
      if (Math.abs(x + 14) < 9 || (x > -66 && x < -24)) continue
      pts.push([x, -40.25])
    }
    for (let x = 48; x <= 260; x += 1.6) {
      pts.push([x, 15.6])
      if (x > 62) pts.push([x, 26.4])
    }
    for (let z = -32; z <= 50; z += 1.7) {
      if (z > -3 && z < 29) continue
      pts.push([-39.8, z])
    }
    const bollardGeo = mergeGeometries(
      [
        new THREE.CylinderGeometry(0.075, 0.09, 0.82, 7, 1, true).translate(0, 0.41, 0),
        new THREE.SphereGeometry(0.085, 7, 4).translate(0, 0.84, 0),
        new THREE.CylinderGeometry(0.1, 0.1, 0.06, 7, 1, true).translate(0, 0.66, 0),
      ].map((g) => g.toNonIndexed()),
      false
    )
    const bollards = new THREE.InstancedMesh(bollardGeo, new THREE.MeshStandardMaterial({ color: 0x4a1a12, roughness: 0.45, metalness: 0.4 }), pts.length)
    const m4 = new THREE.Matrix4()
    pts.forEach(([x, z], i) => bollards.setMatrixAt(i, m4.makeTranslation(x, 0.12, z)))
    bollards.instanceMatrix.needsUpdate = true
    bollards.castShadow = true
    scene.add(bollards)
  }
  {
    // street lamps: slender dark poles with a lantern
    const spots = []
    for (let x = -150; x <= 150; x += 19) {
      if (Math.abs(x + 14) < 9) continue
      spots.push([x + 4.75, CANAL_N + 1.2])
      spots.push([x + 4.75, CANAL_S - 1.2])
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.6
      spots.push([Math.cos(a) * 16.2, Math.sin(a) * 16.2])
    }
    const poleGeo = mergeGeometries(
      [
        new THREE.CylinderGeometry(0.16, 0.2, 0.7, 10).translate(0, 0.35, 0),
        new THREE.CylinderGeometry(0.06, 0.085, 4.4, 8).translate(0, 2.6, 0),
        new THREE.ConeGeometry(0.3, 0.32, 4).rotateY(Math.PI / 4).translate(0, 5.55, 0),
      ].map((g) => g.toNonIndexed()),
      false
    )
    const poles = new THREE.InstancedMesh(poleGeo, iron, spots.length)
    const lanterns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.6, 0.34), new THREE.MeshStandardMaterial({ color: 0x3a3426, emissive: 0xffd9a0, emissiveIntensity: 0.35, roughness: 0.2 }), spots.length)
    const m4 = new THREE.Matrix4()
    spots.forEach(([x, z], i) => {
      poles.setMatrixAt(i, m4.makeTranslation(x, 0.1, z))
      lanterns.setMatrixAt(i, m4.makeTranslation(x, 5.2, z))
    })
    poles.castShadow = lanterns.castShadow = true
    scene.add(poles, lanterns)
  }
  {
    // Dutch bikes, parked in clusters against the quay and the square's edge
    const parts = []
    const tubeG = (a, b, r = 0.018) => {
      const len = a.distanceTo(b)
      const g = new THREE.CylinderGeometry(r, r, len, 5, 1, true)
      g.translate(0, len / 2, 0)
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()))
      g.translate(a.x, a.y, a.z)
      return g
    }
    for (const x of [-0.56, 0.56]) parts.push(new THREE.TorusGeometry(0.33, 0.022, 5, 18).translate(x, 0.34, 0))
    const rear = V(-0.56, 0.34, 0)
    const front = V(0.56, 0.34, 0)
    const crank = V(-0.05, 0.3, 0)
    const seatTop = V(-0.22, 0.9, 0)
    const head = V(0.42, 0.95, 0)
    parts.push(tubeG(crank, seatTop, 0.02), tubeG(crank, head, 0.022), tubeG(V(-0.18, 0.75, 0), V(0.4, 0.78, 0), 0.02))
    parts.push(tubeG(rear, crank), tubeG(rear, V(-0.2, 0.78, 0)), tubeG(front, head, 0.02), tubeG(head, V(0.32, 1.1, 0), 0.018))
    parts.push(tubeG(V(0.2, 1.1, -0.28), V(0.34, 1.12, 0.28), 0.014))
    parts.push(new THREE.BoxGeometry(0.26, 0.06, 0.13).translate(-0.24, 0.94, 0))
    parts.push(new THREE.BoxGeometry(0.45, 0.025, 0.2).translate(-0.52, 0.78, 0))
    const bikeGeo = mergeGeometries(
      parts.map((g) => {
        const n = g.index ? g.toNonIndexed() : g
        for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k)
        return n
      }),
      false
    )
    const spots = []
    const cluster = (x, z, n, along, ry) => {
      for (let i = 0; i < n; i++) spots.push([x + along[0] * i * 0.62, z + along[1] * i * 0.62, ry + range(rand, -0.12, 0.12)])
    }
    cluster(-3, CANAL_N + 0.9, low ? 5 : 9, [1, 0], Math.PI / 2)
    cluster(24, CANAL_N + 0.9, low ? 4 : 8, [1, 0], Math.PI / 2)
    cluster(-36, -37.2, low ? 4 : 7, [1, 0], -Math.PI / 2)
    cluster(18, -37.2, low ? 5 : 10, [1, 0], -Math.PI / 2)
    cluster(43.8, 30, low ? 4 : 8, [0, 1], 0)
    cluster(-14, 17.5, low ? 3 : 6, [0.9, 0.4], 0.4)
    cluster(100, 15.2, low ? 4 : 9, [1, 0], -Math.PI / 2)
    const bikes = new THREE.InstancedMesh(bikeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.35 }), spots.length)
    const cols = [0x111214, 0x1a1c22, 0x23324a, 0x4a1e1a, 0x5a5d60, 0x13161a, 0x2f3a2c]
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const c = new THREE.Color()
    spots.forEach(([x, z, ry], i) => {
      q.setFromEuler(new THREE.Euler(0, ry, range(rand, -0.04, 0.04)))
      m4.compose(V(x, x > 40 || Math.abs(z) > 30 ? 0.12 : 0.1, z), q, V(1, 1, 1))
      bikes.setMatrixAt(i, m4)
      bikes.setColorAt(i, c.setHex(pick(rand, cols)))
    })
    bikes.instanceMatrix.needsUpdate = true
    if (bikes.instanceColor) bikes.instanceColor.needsUpdate = true
    bikes.castShadow = true
    scene.add(bikes)
  }
  {
    // benches round the fountain, grey bins, a green advertising column
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.95
      const f = mtx(Math.cos(a) * 11.2, 0.1, Math.sin(a) * 11.2, -a + Math.PI / 2)
      B.add(wood, boxGeo(1.9, 0.07, 0.48, [1, 1]), mul(f, mtx(0, 0.45, 0)))
      B.add(wood, boxGeo(1.9, 0.38, 0.06, [1, 1]), mul(f, mtx(0, 0.55, -0.24)))
      for (const sx of [-0.8, 0.8]) B.add(iron, boxGeo(0.07, 0.45, 0.45), mul(f, mtx(sx, 0, 0)))
    }
    const binMat = new THREE.MeshStandardMaterial({ color: 0x5c6064, roughness: 0.45, metalness: 0.5 })
    for (const [x, z] of [
      [-6, -16],
      [12, 13],
      [-15.5, 5],
      [30, -38],
      [-30, -38.2],
      [44, 20],
    ]) {
      B.add(binMat, new THREE.CylinderGeometry(0.3, 0.27, 1.05, 16).translate(0, 0.52, 0), mtx(x, 0.12, z))
      B.add(iron, new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16).translate(0, 1.05, 0), mtx(x, 0.12, z))
    }
    const posters = paintTexture(
      THREE,
      256,
      256,
      (g, w, h) => {
        const r2 = seeded(5)
        g.fillStyle = '#1f3a2c'
        g.fillRect(0, 0, w, h)
        const cs = ['#d6402f', '#f0c330', '#2a6fb5', '#f2efe6', '#1b1b1b', '#e5789a']
        for (let i = 0; i < 4; i++) {
          g.fillStyle = pick(r2, cs)
          g.fillRect(i * (w / 4) + 4, 18, w / 4 - 8, h - 36)
          g.fillStyle = pick(r2, cs)
          g.fillRect(i * (w / 4) + 12, 40 + r2() * 60, w / 4 - 24, 30 + r2() * 50)
        }
      },
      { kind: 'color' }
    )
    const col = new THREE.CylinderGeometry(0.62, 0.62, 3.0, 24, 1, true).translate(0, 1.6, 0)
    B.add(new THREE.MeshStandardMaterial({ map: posters, roughness: 0.6 }), col, mtx(-24, 0, 24))
    B.add(copper, new THREE.SphereGeometry(0.72, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 3.1, 0), mtx(-24, 0, 24))
    B.add(iron, new THREE.CylinderGeometry(0.68, 0.7, 0.12, 24).translate(0, 0.06, 0), mtx(-24, 0, 24))
    // traffic lights at the bridge and the mouth of Leidsestraat
    const red = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a14, emissiveIntensity: 2.4 })
    const green = new THREE.MeshStandardMaterial({ color: 0x002208, emissive: 0x30ff7a, emissiveIntensity: 2.0 })
    for (const [x, z, ry, on] of [
      [-23, -40.6, 0, red],
      [-5, -57.0, Math.PI, green],
      [46.5, 15.4, -Math.PI / 2, green],
    ]) {
      B.add(iron, new THREE.CylinderGeometry(0.06, 0.06, 3.6, 8).translate(0, 1.8, 0), mtx(x, 0.12, z))
      B.add(iron, boxGeo(0.32, 0.95, 0.25), mtx(x, 2.6, z, ry))
      B.add(on, new THREE.CircleGeometry(0.09, 12), mul(mtx(x, 0, z, ry), mtx(0, on === red ? 3.38 : 2.82, 0.13)))
    }
    // café tables and chairs out on the north side (stacked for winter, a few left out)
    const table = mergeGeometries(
      [new THREE.CylinderGeometry(0.35, 0.35, 0.03, 16).translate(0, 0.74, 0), new THREE.CylinderGeometry(0.03, 0.03, 0.74, 6).translate(0, 0.37, 0), new THREE.CylinderGeometry(0.22, 0.22, 0.02, 12)].map((g) => g.toNonIndexed()),
      false
    )
    const chair = mergeGeometries(
      [new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(0, 0.46, 0), new THREE.BoxGeometry(0.42, 0.42, 0.04).translate(0, 0.68, -0.2), ...[-0.18, 0.18].flatMap((x) => [-0.18, 0.18].map((z) => new THREE.CylinderGeometry(0.015, 0.015, 0.46, 5).translate(x, 0.23, z)))].map((g) => g.toNonIndexed()),
      false
    )
    const tSpots = []
    for (let x = -36; x < 38; x += 3.4) tSpots.push([x + range(rand, -0.3, 0.3), 49.6 + range(rand, -0.4, 0.4)])
    const tables = new THREE.InstancedMesh(table, iron, tSpots.length)
    const chairs = new THREE.InstancedMesh(chair, new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.5, metalness: 0.3 }), tSpots.length * 2)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    tSpots.forEach(([x, z], i) => {
      tables.setMatrixAt(i, m4.makeTranslation(x, 0, z))
      for (const s of [0, 1]) {
        q.setFromAxisAngle(V(0, 1, 0), (s ? Math.PI : 0) + range(rand, -0.3, 0.3))
        m4.compose(V(x + (s ? 0.62 : -0.62), 0, z + range(rand, -0.1, 0.1)), q, V(1, 1, 1))
        m4.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
        chairs.setMatrixAt(i * 2 + s, m4)
      }
    })
    tables.castShadow = chairs.castShadow = true
    scene.add(tables, chairs)
  }

  /* --- the city beyond, out into the haze ---------------------------------------------- */

  {
    const sizes = [
      [24, 16.5, 14],
      [30, 19.8, 16],
      [18, 23.1, 12],
    ]
    const looks = [facRed, facTan, facDark]
    const per = []
    for (const fac of looks) {
      for (const [w, h, d] of sizes) {
        const g = new THREE.BoxGeometry(w, h, d)
        g.translate(0, h / 2, 0)
        const uv = g.attributes.uv
        const dims = [
          [d, h],
          [d, h],
          [w, d],
          [w, d],
          [w, h],
          [w, h],
        ]
        for (let f = 0; f < 6; f++) {
          const top = f === 2 || f === 3
          for (let k = 0; k < 4; k++) {
            const i = f * 4 + k
            uv.setXY(i, (uv.getX(i) * dims[f][0]) / (top ? 3 : fac.tile[0]), (uv.getY(i) * dims[f][1]) / (top ? 3 : fac.tile[1]))
          }
        }
        per.push({ geo: g, mats: [fac.mat, fac.mat, roofFlat, roofFlat, fac.mat, fac.mat], list: [] })
      }
    }
    for (let i = 0; i < (low ? 380 : 700); i++) {
      const bx = range(rand, -560, 560)
      const bz = range(rand, -560, 560)
      const core = bx > -240 && bx < 300 && bz > -140 && bz < 130
      const water = bz > CANAL_S - 16 && bz < CANAL_N + 6
      if (core || water) continue
      per[Math.floor(rand() * per.length)].list.push([Math.round(bx / 6) * 6, Math.round(bz / 6) * 6])
    }
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    for (const p of per) {
      if (!p.list.length) continue
      const mesh = new THREE.InstancedMesh(p.geo, p.mats, p.list.length)
      p.list.forEach(([x, z], j) => {
        q.setFromAxisAngle(V(0, 1, 0), (Math.floor(rand() * 4) * Math.PI) / 2)
        m4.compose(V(x, 0, z), q, V(1, 1, 1))
        mesh.setMatrixAt(j, m4)
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.receiveShadow = true
      scene.add(mesh)
    }
  }

  B.build(scene)
  G.build(scene)

  world.focusShadows(V(-4, 0, -14), 78)

  /* --- the views ------------------------------------------------------------------- */

  const spots = [
    // the hero: at the fountain's edge, across the water and the lit trees to the hotel
    { pos: V(2.5, 1.6, 11.5), look: V(-4, 9, -60) },
    // from the west rim: the stepped basins, the jets, the hotel block behind
    { pos: V(-10, 1.7, 4), look: V(6, 6.5, -70) },
    // the American Hotel's corner tower over the canal street, the tram at the stop
    { pos: V(-20, 1.7, -28), look: V(-50, 15, -40) },
    // on the quay: along the Singelgracht to the Leidsebrug
    { pos: V(13.6, 1.7, -58.9), look: V(-90, 1.5, -72) },
    // on the bridge, back across the tracks to the square and its trees
    { pos: V(-14, 1.85, -68), look: V(4, 6, 4) },
    // up at a hotel window over the square: the fountain in its ring of lights
    { pos: V(38, 14, -28), look: V(-8, 0, 6) },
    // across the square to the Stadsschouwburg's loggia
    { pos: V(16, 1.7, 19), look: V(-44, 11, 8) },
    // in Leidsestraat on the tram tracks, looking back to the domed corner
    { pos: V(116, 1.7, 22), look: V(40, 14, 18) },
  ]
  const path = {
    positions: [V(80, 130, 190), V(40, 66, 100), V(14, 20, 40), V(5, 4, 17), spots[0].pos.clone()],
    targets: [V(0, 0, -20), V(0, 4, -30), V(-2, 7, -45), V(-3, 8.5, -55), spots[0].look.clone()],
    fov: 52,
    near: 0.3,
    spots,
  }

  let t0 = null
  return {
    scene,
    world,
    path,
    update(t) {
      if (t0 === null) t0 = t
      const tt = t - t0
      poolMat.userData.tick(tt)
      canal.userData.tick(tt)
      jetsU.uTime.value = tt
    },
  }
}
