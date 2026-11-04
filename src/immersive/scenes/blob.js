/**
 * Inside the Blob, Eindhoven — where the SRC × MANA run ended: MANA's café on
 * an upper floor of Massimiliano Fuksas's free-form gridshell on 18 Septemberplein.
 *
 * The Blob is a five-storey concrete frame wrapped in a free-standing skin of
 * triangulated white steel — clear glass above, dense white panels on the lower
 * body and in drifting islands — its floors cut by elliptical voids. MANA's level
 * (photos 08–13): a polished concrete floor, a concrete core with formwork joints
 * and big thin "MANA" letters backlit warm, a concrete ceiling slab with linear
 * LED strips over the bar, round concrete columns, a long black bar with a pale
 * travertine ledge, espresso machines, grinders, cup stacks, platters of fruit
 * and brownies, the DJ's controller at the end of the bar, slim black pendants
 * with disc shades, glass balustrades along the floor's edge, and beyond the
 * sloping glass the square: Piazza's canopy and McDonald's, the offices round it.
 * No people: an empty café just after the crowd left — cups on the high tables,
 * bags by the columns, jackets over the handrail, the run's flags against the core.
 *
 * Metres. This file's frame is eindhoven.js's turned half round (see insideHere):
 * the Blob's centre at the origin, its long axis along x, the square (east) is −x,
 * the station (north) +z. The café floor is at y = 9.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createWorld } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { seeded, range, pick, paintTexture } from '../utils.js'

/* --- the dome --------------------------------------------------------------- */

const L1 = 4.5 // first floor
const L2 = 9.0 // MANA's floor
const L3 = 13.6 // the floor above (the café's ceiling)
const X0 = -6.5 // the café's local origin (bar line at X0 + 0.5)
const HOLE2 = { x: -9.8, z: -7.2, rx: 2.4, rz: 1.9 } // the void in MANA's floor
const HOLE1 = { x: -12.5, z: -4, rx: 6.5, rz: 4.4 } // the void in the floor below


/* --- the Blob's form (the same code in eindhoven.js and blob.js) -------------------
 *
 * Fuksas's Admirant Entrance Building: a five-storey concrete frame inside a
 * free-form gridshell — ~950 m² on the ground shrinking to ~250 m² at the top
 * office floor, ~21 m high at its west head: a half-droplet, long and low, steep
 * lower walls rolling over into a back that sinks toward the square, four soft dimples.
 * The lattice runs in horizontal rings (row height ~1.7 m) with diagonals
 * between them: wide isosceles triangles (~3.2 m base) low down, a little
 * smaller toward the top (rows sink a little toward the low east end); dense white aluminium panels on the lower body and in
 * drifting islands, "maritime blue" glass everywhere else.
 *
 * Eindhoven frame: the Blob's centre at the origin, east +x, south +z.
 */
const BLOB_H = 21.5
const BLOB_A = 22.5
const BLOB_B = 14.5
const DOOR_PHI = 0.9 // MANA's door faces south-east, onto the square
// the dimples: polar angle, height fraction, depth, angular width, vertical width
const DIMPLES = [
  [0.22, 0.6, 0.085, 0.3, 0.13],
  [2.05, 0.5, 0.075, 0.28, 0.12],
  [3.35, 0.6, 0.085, 0.26, 0.12],
  [4.7, 0.42, 0.07, 0.3, 0.14],
]
const TAU = Math.PI * 2
function angDiff(a, b) {
  let d = (a - b) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}
/** The crown drifts west as the skin rises. */
const blobCx = (t) => -3.4 * t * t
/** A half-droplet: the whole form sinks toward its east end, a long low back running down to the square. */
function blobSquash(x) {
  const u = Math.min(1, Math.max(0, (x + 12) / 34))
  return 1 - 0.36 * u * u * (3 - 2 * u)
}
/** Horizontal radius of the skin round the axis, at polar angle phi and height fraction t. */
function blobRho(phi, t) {
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  let rho = Math.pow(Math.pow(Math.abs(c) / BLOB_A, 2.35) + Math.pow(Math.abs(s) / BLOB_B, 2.35), -1 / 2.35)
  rho *= 1 + 0.09 * Math.max(0, -c) * s * s // the west end a little fuller
  const tt = Math.min(1, Math.max(0, t))
  rho *= Math.pow(Math.max(0, 1 - Math.pow(tt, 2.5)), 1 / 2.5)
  rho *= 1 + 0.045 * Math.sin(Math.PI * Math.min(1, tt / 0.55)) // the walls belly out a little above the door
  rho *= 1 + 0.018 * Math.sin(3 * phi + 1.3 + 5 * tt)
  for (const [p0, t0, dep, wp, wt] of DIMPLES) {
    const dp = angDiff(phi, p0) / wp
    const dt = (tt - t0) / wt
    rho *= 1 - dep * Math.exp(-dp * dp - dt * dt)
  }
  return rho
}
function blobPoint(phi, t) {
  const r = blobRho(phi, t)
  const x = blobCx(t) + r * Math.cos(phi)
  return [x, BLOB_H * t * blobSquash(x), r * Math.sin(phi)]
}
function insideBlob(x, y, z) {
  const t = y / (BLOB_H * blobSquash(x))
  if (t < 0 || t >= 1) return false
  const dx = x - blobCx(t)
  return Math.hypot(dx, z) < blobRho(Math.atan2(z, dx), t)
}
function hash3(x, y, z, s = 0) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + s * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function noise3(x, y, z) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const f = (v) => v * v * (3 - 2 * v)
  const u = f(x - xi)
  const v = f(y - yi)
  const w = f(z - zi)
  let out = 0
  for (let k = 0; k < 8; k++) {
    const dx = k & 1
    const dy = (k >> 1) & 1
    const dz = (k >> 2) & 1
    out += hash3(xi + dx, yi + dy, zi + dz, 5) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w)
  }
  return out
}

/**
 * The skin's lattice: rings of vertices at equal steps up the meridian, spread
 * evenly by arc length (alternate rings offset by half a panel), stitched into
 * triangles; a fan closes the crown. Returns { verts: [[x,y,z]], tris: [[a,b,c]] },
 * every triangle wound to face outward.
 */
function blobLattice({ row = 1.9, base = 3.2 } = {}) {
  const N = 480
  const S = [0]
  let pa = blobPoint(Math.PI / 2, 0)
  let pb = blobPoint(-Math.PI / 2, 0)
  for (let i = 1; i <= N; i++) {
    const a = blobPoint(Math.PI / 2, i / N)
    const b = blobPoint(-Math.PI / 2, i / N)
    S.push(S[i - 1] + (Math.hypot(a[0] - pa[0], a[1] - pa[1], a[2] - pa[2]) + Math.hypot(b[0] - pb[0], b[1] - pb[1], b[2] - pb[2])) / 2)
    pa = a
    pb = b
  }
  const L = S[N]
  const tAt = (s) => {
    let lo = 0
    let hi = N
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (S[m] <= s) lo = m
      else hi = m
    }
    return (lo + (s - S[lo]) / Math.max(1e-6, S[hi] - S[lo])) / N
  }
  const rows = Math.round(L / row)
  const verts = []
  const rings = []
  let n = 0
  const M = 256
  for (let j = 0; j < rows; j++) {
    const t = tAt((j / rows) * L)
    const pts = []
    const cum = [0]
    for (let k = 0; k <= M; k++) {
      pts.push(blobPoint((k / M) * TAU, t))
      if (k) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]))
    }
    const P = cum[M]
    const e = base * (1 - 0.22 * t)
    if (!n || Math.abs(P / n - e) > e * 0.14) n = Math.round(P / e)
    if (n < 6) break
    const off = (j % 2) * 0.5
    const ring = { idx: [], f: [] }
    let k = 0
    for (let q = 0; q < n; q++) {
      const f = (q + off) / n
      const s = f * P
      while (k < M - 1 && cum[k + 1] < s) k++
      const a = (s - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k])
      const p = pts[k]
      const p2 = pts[k + 1]
      ring.idx.push(verts.length)
      ring.f.push(f)
      verts.push([p[0] + (p2[0] - p[0]) * a, p[1], p[2] + (p2[2] - p[2]) * a])
    }
    rings.push(ring)
  }
  const tris = []
  for (let j = 0; j + 1 < rings.length; j++) {
    const ra = rings[j]
    const rb = rings[j + 1]
    const na = ra.idx.length
    const nb = rb.idx.length
    let k0 = 0
    let best = 9
    for (let k = 0; k < nb; k++) {
      let d = rb.f[k] - ra.f[0]
      d -= Math.round(d)
      if (Math.abs(d) < best) {
        best = Math.abs(d)
        k0 = k
      }
    }
    const shift = Math.round(rb.f[k0] - ra.f[0])
    const fa = (i) => ra.f[i % na] + Math.floor(i / na)
    const fb = (m) => rb.f[(k0 + m) % nb] + Math.floor((k0 + m) / nb) - shift
    let i = 0
    let m = 0
    while (i < na || m < nb) {
      const A0 = ra.idx[i % na]
      const B0 = rb.idx[(k0 + m) % nb]
      if (m >= nb || (i < na && fa(i + 1) <= fb(m + 1))) {
        tris.push([A0, ra.idx[(i + 1) % na], B0])
        i++
      } else {
        tris.push([A0, rb.idx[(k0 + m + 1) % nb], B0])
        m++
      }
    }
  }
  const top = rings[rings.length - 1]
  const apex = verts.length
  const ax = top.idx.reduce((s, i) => s + verts[i][0], 0) / top.idx.length
  const az = top.idx.reduce((s, i) => s + verts[i][2], 0) / top.idx.length
  verts.push([ax, BLOB_H * blobSquash(ax), az])
  for (let q = 0; q < top.idx.length; q++) tris.push([top.idx[q], top.idx[(q + 1) % top.idx.length], apex])
  // wind every triangle outward
  for (const tr of tris) {
    const [a, b, c] = tr.map((i) => verts[i])
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const cx = (a[0] + b[0] + c[0]) / 3
    const cy = (a[1] + b[1] + c[1]) / 3
    const cz = (a[2] + b[2] + c[2]) / 3
    const ox = cx - blobCx(cy / (BLOB_H * blobSquash(cx)))
    const oy = cy - BLOB_H * 0.3
    if (nx * ox + ny * oy + nz * cz < 0) {
      const tmp = tr[1]
      tr[1] = tr[2]
      tr[2] = tmp
    }
  }
  return { verts, tris }
}

/** What fills a triangle of the skin, from its centroid: 'white' | 'glass' | 'shop'. */
function blobPanel(c) {
  const y = c[1]
  const t = y / (BLOB_H * blobSquash(c[0]))
  const phi = Math.atan2(c[2], c[0] - blobCx(t))
  const h = hash3(Math.round(c[0] * 10), Math.round(c[1] * 10), Math.round(c[2] * 10), 11)
  const bump = (p, w) => Math.exp(-((angDiff(phi, p) / w) ** 2))
  // shop windows on the ground floor, all round except MANA's white wall
  if (y < 3.6 && Math.abs(angDiff(phi, DOOR_PHI)) > 0.78 && Math.sin(phi * 4 + 0.6) > -0.5) return 'shop'
  // the white lower body: its upper edge rises in slow waves, highest just west of MANA's door
  const edge = 4.6 + 9 * bump(1.4, 0.5) + 6.5 * bump(3.2, 0.55) + 4 * bump(4.85, 0.4) - 1.4 * bump(0, 0.55) + 2.4 * noise3(c[0] / 7, 0.5, c[2] / 7)
  if (y < edge + (h - 0.5) * 3.4) return 'white'
  // islands of white in the glass, fraying at their edges
  const isl = Math.exp(-(((c[0] - 17) / 4.5) ** 2 + ((c[1] - 13.5) / 3.2) ** 2 + ((c[2] + 6) / 4.5) ** 2))
  if (isl + (h - 0.5) * 0.3 > 0.42) return 'white'
  const n = noise3(c[0] / 8 + 3.1, c[1] / 8, c[2] / 8 + 7.7)
  if (n + (h - 0.5) * 0.2 > 0.66 - 0.05 * t) return 'white'
  return 'glass'
}

/*
 * This file's frame is the Eindhoven frame turned half round — (x, z) → (−x, −z) —
 * so the café's views out over the square (east, toward Piazza) look down −x.
 */
const insideHere = (x, y, z) => insideBlob(-x, y, -z)

/** Horizontal distance from the axis to the skin, in a direction, at a height. */
function skinR(theta, y) {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  // march out to the first crossing of the skin, then refine it
  let lo = 0
  while (lo < 45 && insideHere(c * (lo + 0.25), y, s * (lo + 0.25))) lo += 0.25
  let hi = lo + 0.25
  for (let i = 0; i < 12; i++) {
    const m = (lo + hi) / 2
    if (insideHere(c * m, y, s * m)) lo = m
    else hi = m
  }
  return lo
}
/** The skin's plan at a height, pulled in by `inset` metres: [[x, z], ...]. */
function outline(y, inset, n = 120) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2
    const r = Math.max(0.5, skinR(th, y) - inset)
    pts.push([Math.cos(th) * r, Math.sin(th) * r])
  }
  return pts
}

/** The edge of the ceiling slab over the bar (world x as a function of z). */
const ceilingEdge = (z) => X0 - 2.8 - 0.9 * Math.cos(z * 0.25)

/* --- small geometry kit ------------------------------------------------------ */

/** Collects geometry per material and merges it: one draw call per material. */
function makeBatch(THREE) {
  const byMat = new Map()
  const push = (mat, g) => {
    if (!byMat.has(mat)) byMat.set(mat, [])
    byMat.get(mat).push(g)
    return g
  }
  return {
    add: push,
    /** A box sitting on y, UVs in metres / tile. */
    box(mat, w, h, d, x, y, z, ry = 0, tile = 1) {
      const g = new THREE.BoxGeometry(w, h, d)
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
          uv.setXY(i, (uv.getX(i) * faces[f][0]) / tile, (uv.getY(i) * faces[f][1]) / tile)
        }
      }
      g.translate(0, h / 2, 0)
      if (ry) g.rotateY(ry)
      g.translate(x, y, z)
      return push(mat, g)
    },
    /** A vertical cylinder standing on y. */
    cyl(mat, rBottom, rTop, h, x, y, z, seg = 16) {
      const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg)
      g.translate(x, y + h / 2, z)
      return push(mat, g)
    },
    build(parent, { cast = true, receive = true } = {}) {
      const out = []
      for (const [mat, list] of byMat) {
        const g = list.length === 1 ? list[0] : mergeGeometries(list, false)
        if (!g) continue
        const mesh = new THREE.Mesh(g, mat)
        mesh.castShadow = cast && !mat.transparent
        mesh.receiveShadow = receive
        if (mat.transparent) mesh.renderOrder = 3
        parent.add(mesh)
        out.push(mesh)
      }
      return out
    },
  }
}

/** Many copies of one geometry: [{x, y, z, rx?, ry?, rz?, s?, sx?, sy?, sz?, color?}]. */
function instanced(THREE, parent, geo, mat, items, { cast = true, receive = true } = {}) {
  if (!items.length) return null
  const mesh = new THREE.InstancedMesh(geo, mat, items.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const c = new THREE.Color()
  const coloured = items.some((it) => it.color !== undefined)
  items.forEach((it, i) => {
    e.set(it.rx || 0, it.ry || 0, it.rz || 0)
    q.setFromEuler(e)
    p.set(it.x, it.y, it.z)
    const k = it.s ?? 1
    s.set(it.sx ?? k, it.sy ?? k, it.sz ?? k)
    m.compose(p, q, s)
    mesh.setMatrixAt(i, m)
    if (coloured) mesh.setColorAt(i, c.set(it.color ?? 0xffffff))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = cast
  mesh.receiveShadow = receive
  parent.add(mesh)
  return mesh
}

/**
 * Beams as one instanced box each, turned so their depth runs along `n`
 * (the skin's normal) — rectangular steel sections that all face the same way.
 */
function orientedBeams(THREE, beams, mat, { cast = true } = {}) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, beams.length))
  const m = new THREE.Matrix4()
  const X = new THREE.Vector3()
  const Y = new THREE.Vector3()
  const Z = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const sc = new THREE.Vector3()
  beams.forEach(({ a, b, w, d, n }, i) => {
    Z.subVectors(b, a)
    const len = Z.length() || 0.001
    Z.divideScalar(len)
    Y.copy(n || up).addScaledVector(Z, -(n || up).dot(Z))
    if (Y.lengthSq() < 1e-6) Y.set(1, 0, 0).addScaledVector(Z, -Z.x)
    Y.normalize()
    X.crossVectors(Y, Z)
    m.makeBasis(X, Y, Z)
    m.scale(sc.set(w, d, len))
    m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
    mesh.setMatrixAt(i, m)
  })
  mesh.count = beams.length
  mesh.instanceMatrix.needsUpdate = true
  mesh.castShadow = cast
  mesh.receiveShadow = true
  return mesh
}

/** A floor slab with the skin's outline and elliptical voids; top surface at y. */
function slab(THREE, poly, holes, y, thick, mats) {
  const s = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)))
  for (const h of holes) {
    const p = new THREE.Path()
    p.absellipse(h.x, -h.z, h.rx, h.rz, 0, Math.PI * 2, true, 0)
    s.holes.push(p)
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 40 })
  g.rotateX(-Math.PI / 2)
  const pos = g.attributes.position
  const uv = g.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4)
  const mesh = new THREE.Mesh(g, mats)
  mesh.position.y = y - thick
  mesh.castShadow = mesh.receiveShadow = true
  return mesh
}

/** Points round an ellipse, as [[x, z], ...]. */
function ellipsePts(h, grow, n) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push([h.x + Math.cos(a) * (h.rx + grow), h.z + Math.sin(a) * (h.rz + grow)])
  }
  return pts
}

/**
 * A glass balustrade along a polyline: a ribbon of glass, a steel handrail,
 * a base channel and posts.
 */
function balustrade(THREE, pts, y, closed, glassArr, rails) {
  const V = (x, yy, z) => new THREE.Vector3(x, yy, z)
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const [x0, z0] = pts[i]
    const [x1, z1] = pts[(i + 1) % pts.length]
    glassArr.push(x0, y + 0.05, z0, x1, y + 0.05, z1, x1, y + 1.0, z1, x0, y + 0.05, z0, x1, y + 1.0, z1, x0, y + 1.0, z0)
    rails.push({ a: V(x0, y + 1.04, z0), b: V(x1, y + 1.04, z1), w: 0.05, d: 0.05 })
    rails.push({ a: V(x0, y + 0.04, z0), b: V(x1, y + 0.04, z1), w: 0.07, d: 0.08 })
    if (i % 3 === 0) rails.push({ a: V(x0, y, z0), b: V(x0, y + 1.04, z0), w: 0.035, d: 0.035, n: new THREE.Vector3(1, 0, 0) })
  }
}

/* --- the sign -------------------------------------------------------------- */

/** The strokes of MANA's thin sans letters, in a unit box per letter: [u0, v0, u1, v1]. */
function letterStrokes(ch, W, H) {
  if (ch === 'M')
    return [
      [0, 0, 0, H],
      [0, H, W / 2, H * 0.22],
      [W / 2, H * 0.22, W, H],
      [W, H, W, 0],
    ]
  if (ch === 'A')
    return [
      [0, 0, W / 2, H],
      [W / 2, H, W, 0],
    ]
  if (ch === 'N')
    return [
      [0, 0, 0, H],
      [0, H, W, 0],
      [W, 0, W, H],
    ]
  return []
}

/* --- the place ------------------------------------------------------------ */

export function buildBlobInterior(THREE, ctx) {
  // a clear blue spring sky, whatever the photos' pale skies say
  ctx.sky = null
  const low = ctx.quality === 'low'
  const quality = ctx.quality
  const rand = seeded(1809)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)

  const world = createWorld(THREE, ctx, 'day', {
    // the same late-morning sun as the square outside (eindhoven.js: azimuth 28, turned half round)
    sun: { elevation: 36, azimuth: 208 },
    sky: { zenith: 0x3f7fd0, horizon: 0xbcd6ee, clouds: 0.28 },
    fog: { density: 0.0005 },
    exposure: 1.0,
  })
  const { scene } = world

  /* --- viewpoints: one per photo, src-mana 08–13 in order ------------------------ */
  const spots = [
    // 0 · photo 08: low on the guests' side by the DJ's decks at the end of the bar, the backlit MANA letters on the core
    { pos: V(-8.3, 10.35, 6.0), look: V(-4.2, 10.9, 2.6) },
    // 1 · photo 09: behind the grinders, across the travertine ledge to the floor and the white skin's nodes beyond
    { pos: V(-4.65, 10.4, -0.3), look: V(-11, 10.95, 0.4) },
    // 2 · photo 10: standing behind the bar, over the espresso machine to the floor, the glass skin and Piazza's canopy outside
    { pos: V(-3.6, 11.05, -2.2), look: V(-15.5, 11.6, -4.6) },
    // 3 · photo 11: the busy end of the bar, the slim pendants hanging down from the lattice
    { pos: V(-4.8, 10.65, 1.0), look: V(-12, 12.3, 4.4) },
    // 4 · photo 12: out on the floor, looking up at the white lattice sloping down to the glass
    { pos: V(-9.3, 10.55, 3.1), look: V(-15.5, 12.5, 4.8) },
    // 5 · photo 13: by the balustrade at the floor's edge, the glass close behind, the offices over the square outside
    { pos: V(-10.9, 10.45, -0.9), look: V(-18.5, 11.3, -3.4) },
  ]
  const arrival = { positions: [V(-12, 12.8, 0), V(-11, 12.2, 5), V(-9.8, 11.2, 7.0), spots[0].pos.clone()], targets: [V(-4, 11.5, 0), V(-4.5, 11.2, 2), V(-4.4, 11, 2.8), spots[0].look.clone()] }

  /* --- materials ------------------------------------------------------------- */
  const floorMat = M.floor(THREE, { kind: 'concrete', color: '#b3aa9c', polish: 0.3, tile: 4, quality, seed: 21 })
  floorMat.envMapIntensity = 0.35
  const ceilMat = M.concrete(THREE, { color: '#c4c1ba', tile: 3, ties: false, quality, seed: 22 })
  const coreMat = M.concrete(THREE, { color: '#d0cbc2', tile: 2.4, quality, seed: 23 })
  const travertine = M.floor(THREE, { kind: 'concrete', color: '#cdb995', polish: 0.4, tile: 1.6, quality, seed: 24 })
  const paving = M.paving(THREE, { kind: 'flags', color: '#bdb5a8', joint: '#6f6a62', unit: 0.6, tile: 4, quality, seed: 25 })
  const asphalt = M.asphalt(THREE, { tile: 6, quality, seed: 26 })
  const black = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.42 })
  const matBlack = new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.7 })
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe2e2e2, metalness: 1, roughness: 0.16 })
  const steelRail = new THREE.MeshStandardMaterial({ color: 0xd4d6d8, metalness: 0.85, roughness: 0.25 })
  const whiteGloss = new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.3 })
  const glassSmall = new THREE.MeshStandardMaterial({ color: 0xb8c0c4, roughness: 0.08, transparent: true, opacity: 0.3, depthWrite: false })

  /* --- the skin ---------------------------------------------------------- */
  // gaskets: a dark line along each edge of the white steel sections (photo 9)
  const gasket = paintTexture(THREE, 128, 128, (g, w, h) => {
    g.fillStyle = '#f0efea'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#34373a'
    const b = 5
    g.fillRect(0, 0, w, b)
    g.fillRect(0, h - b, w, b)
    g.fillRect(0, 0, b, h)
    g.fillRect(w - b, 0, b, h)
  })
  // slim pale-grey steel, as it reads in the photos against the bright sky
  const steel = new THREE.MeshStandardMaterial({ color: 0xdfe1e1, map: gasket, roughness: 0.42, metalness: 0.25 })
  const panelWhite = new THREE.MeshStandardMaterial({ color: 0xecebe7, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide })
  const frosted = new THREE.MeshStandardMaterial({
    color: 0xf3f5f5,
    emissive: 0xdde6ec,
    emissiveIntensity: 0.16,
    roughness: 0.45,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const clearGlass = new THREE.MeshStandardMaterial({
    color: 0xcfe2e8,
    roughness: 0.03,
    metalness: 0.1,
    transparent: true,
    opacity: 0.11,
    envMapIntensity: 1.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  // glass reflects more, and lets less through, at grazing angles
  clearGlass.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float fresBlob = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
       diffuseColor.a = clamp(diffuseColor.a + fresBlob * 0.5, 0.0, 0.85);
       #include <opaque_fragment>`
    )
  }
  {
    // the same lattice and panels as the Blob seen from the square (eindhoven.js), turned half round
    // inside, up close, the lattice reads finer than from the square: rows ~1.35 m, triangles ~2.1 m
    const { verts: vE, tris } = blobLattice({ row: 1.35, base: 2.1 })
    const verts = vE.map((p) => V(-p[0], p[1], -p[2]))
    const lists = { white: [], frost: [], clear: [] }
    const vn = verts.map(() => V(0, 0, 0))
    const edges = new Map()
    const used = new Set()
    const e1 = V(0, 0, 0)
    const e2 = V(0, 0, 0)
    for (const tr of tris) {
      const [a, b, c] = tr.map((i) => vE[i])
      const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
      const kind0 = blobPanel(cen)
      const h = hash3(Math.round(cen[0] * 10), Math.round(cen[1] * 10), Math.round(cen[2] * 10), 23)
      // inside, the shop glazing is just glass; round MANA's floor it's nearly all clear
      // (the white body stays below the floor), a few panes frosted
      const kind = kind0 === 'white' && cen[1] < L2 - 1.2 ? 'white' : h < (cen[1] < L2 + 0.5 ? 0.14 : 0.05) ? 'frost' : 'clear'
      const [A, B, C] = tr.map((i) => verts[i])
      lists[kind].push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z)
      const n = e1.subVectors(B, A).cross(e2.subVectors(C, A)).normalize()
      for (let k = 0; k < 3; k++) {
        const i = tr[k]
        const j = tr[(k + 1) % 3]
        vn[i].add(n)
        used.add(i)
        const key = i < j ? i + ':' + j : j + ':' + i
        if (!edges.has(key)) edges.set(key, [i, j])
      }
    }
    for (const n of vn) n.normalize()
    const skinMesh = (arr, mat, order) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
      g.computeVertexNormals()
      const m = new THREE.Mesh(g, mat)
      m.castShadow = mat === panelWhite
      m.receiveShadow = mat === panelWhite
      m.renderOrder = order
      scene.add(m)
    }
    skinMesh(lists.white, panelWhite, 0)
    skinMesh(lists.frost, frosted, 1)
    skinMesh(lists.clear, clearGlass, 2)
    // the white steel lattice, its sections deep along the skin's normal, sitting inside the panels
    const beams = []
    for (const [i, j] of edges.values()) {
      if (verts[i].y < 0.02 && verts[j].y < 0.02) continue
      const n = vn[i].clone().add(vn[j]).normalize()
      const A = verts[i].clone().addScaledVector(n, -0.08)
      const B = verts[j].clone().addScaledVector(n, -0.08)
      beams.push({ a: A, b: B, w: 0.07, d: 0.15, n })
    }
    scene.add(orientedBeams(THREE, beams, steel))
    // a cast node at every joint
    const nodeList = [...used].filter((i) => verts[i].y > 0.02)
    const hub = new THREE.CylinderGeometry(0.075, 0.075, 0.18, 10)
    const knots = new THREE.InstancedMesh(hub, steel, nodeList.length)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const one = V(1, 1, 1)
    const yAx = V(0, 1, 0)
    nodeList.forEach((i, k) => {
      q.setFromUnitVectors(yAx, vn[i])
      const P0 = verts[i].clone().addScaledVector(vn[i], -0.08)
      knots.setMatrixAt(k, m4.compose(P0, q, one))
    })
    knots.instanceMatrix.needsUpdate = true
    knots.castShadow = true
    scene.add(knots)
  }

  /* --- floors, voids, the ceiling over the bar ------------------------------- */
  const poly2 = outline(L2, 1.0)
  {
    const edge = new THREE.MeshStandardMaterial({ color: 0xeeede9, roughness: 0.6 })
    scene.add(slab(THREE, outline(L1, 1.0), [HOLE1], L1, 0.45, [floorMat, edge]))
    scene.add(slab(THREE, poly2, [HOLE2], L2, 0.45, [floorMat, edge]))
    // ground floor inside the dome
    const gpoly = outline(0.4, 0.2)
    const gs = new THREE.Shape(gpoly.map(([x, z]) => new THREE.Vector2(x, -z)))
    const gg = new THREE.ShapeGeometry(gs)
    gg.rotateX(-Math.PI / 2)
    const gp = gg.attributes.position
    const guv = gg.attributes.uv
    for (let i = 0; i < gp.count; i++) guv.setXY(i, gp.getX(i) / 4, gp.getZ(i) / 4)
    const gm = new THREE.Mesh(gg, floorMat)
    gm.position.y = 0.03
    gm.receiveShadow = true
    scene.add(gm)

    // the ceiling slab: the floor above, covering the bar and the core, its edge a long curve
    const out3 = outline(L3, 1.0, 160)
    const ok = (p) => p[0] >= ceilingEdge(p[1])
    let i1 = 0
    while (i1 < out3.length - 1 && ok(out3[i1 + 1])) i1++
    let i2 = out3.length
    while (i2 > i1 + 1 && ok(out3[i2 - 1])) i2--
    const poly3 = []
    for (let i = i2; i < out3.length; i++) poly3.push(out3[i])
    for (let i = 0; i <= i1; i++) poly3.push(out3[i])
    const zTop = out3[i1][1]
    const zBot = out3[i2 % out3.length][1]
    const edgePts = []
    for (let k = 1; k < 24; k++) {
      const z = zTop + ((zBot - zTop) * k) / 24
      edgePts.push([ceilingEdge(z), z])
    }
    poly3.push(...edgePts)
    scene.add(slab(THREE, poly3, [], L3 + 0.5, 0.5, [ceilMat, ceilMat]))

    // glass balustrades: round MANA's floor, the void, the floor below's void and the edge above
    const glassArr = []
    const rails = []
    balustrade(THREE, outline(L2, 1.1), L2, true, glassArr, rails)
    balustrade(THREE, ellipsePts(HOLE2, 0.1, 48), L2, true, glassArr, rails)
    balustrade(THREE, ellipsePts(HOLE1, 0.1, 56), L1, true, glassArr, rails)
    balustrade(THREE, [[ceilingEdge(zTop - 0.5) + 0.1, zTop - 0.5], ...edgePts.map(([x, z]) => [x + 0.1, z]), [ceilingEdge(zBot + 0.5) + 0.1, zBot + 0.5]], L3 + 0.5, false, glassArr, rails)
    const gg2 = new THREE.BufferGeometry()
    gg2.setAttribute('position', new THREE.Float32BufferAttribute(glassArr, 3))
    gg2.computeVertexNormals()
    const bg = new THREE.Mesh(gg2, new THREE.MeshStandardMaterial({ color: 0xdcebea, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4 }))
    bg.renderOrder = 3
    scene.add(bg)
    scene.add(orientedBeams(THREE, rails, steelRail, { cast: true }))
  }

  /* --- the café ------------------------------------------------------------ */
  // built in its own frame: the bar line at x = 0.5, the core's face at x = 4
  const cafe = new THREE.Group()
  cafe.position.x = X0
  scene.add(cafe)
  const B = makeBatch(THREE)
  const F = L2 // floor level
  {
    // the concrete core with MANA's wall, and columns
    B.box(coreMat, 5, L3 - F, 12, 6.5, F, 0, 0, 2.4)
    for (const [x, z] of [
      [-1.0, 9.0],
      [3.2, -8.6],
      [7.5, 8.5],
    ]) {
      const g = new THREE.CylinderGeometry(0.3, 0.3, L3 - F, 24)
      const uv = g.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.8, uv.getY(i) * 1.9)
      g.translate(x, F + (L3 - F) / 2, z)
      B.add(coreMat, g)
    }
    // formwork joints on the core's face
    const joint = new THREE.MeshStandardMaterial({ color: 0x8f8a82, roughness: 0.9 })
    for (let z = -6; z <= 6.01; z += 1.2) B.box(joint, 0.012, L3 - F, 0.014, 3.996, F, z)
    for (const y of [F + 2.4]) B.box(joint, 0.012, 0.014, 12, 3.996, y, 0)

    // the bar: black body, black work top, a raised travertine ledge on the guests' side
    B.box(black, 0.85, 0.97, 8.0, 0.525, F, -3.0)
    B.box(black, 0.66, 0.04, 8.0, 0.67, F + 0.97, -3.0)
    B.box(travertine, 0.47, 0.3, 8.06, 0.115, F + 0.86, -3.0, 0, 1.6)
    B.box(matBlack, 0.8, 0.08, 7.9, 0.53, F, -3.0) // plinth shadow line
    // the back counter against the core
    B.box(black, 0.7, 0.92, 7.4, 3.6, F, -2.6)
    B.box(travertine, 0.72, 0.03, 7.42, 3.6, F + 0.92, -2.6, 0, 1.6)
    // the DJ's table at the end of the bar
    B.box(black, 0.85, 0.93, 1.8, 0.525, F, 3.8)

    // espresso machines (staff side, facing +x)
    const top = F + 1.01
    const emitRed = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 2.2 })
    const machines = [-2.2, -4.8]
    const knobs = []
    const reds = []
    for (const z of machines) {
      B.box(chrome, 0.55, 0.44, 0.8, 0.69, top, z)
      B.box(black, 0.5, 0.02, 0.76, 0.69, top + 0.44, z) // cup tray
      B.box(matBlack, 0.12, 0.02, 0.7, 0.98, top, z) // drip tray
      for (const dz of [-0.2, 0.2]) {
        B.cyl(chrome, 0.045, 0.05, 0.06, 0.99, top + 0.2, z + dz, 12) // group head
        B.box(matBlack, 0.18, 0.025, 0.03, 1.07, top + 0.17, z + dz) // portafilter handle
        reds.push({ x: 0.968, y: top + 0.36, z: z + dz - 0.04 }, { x: 0.968, y: top + 0.36, z: z + dz + 0.04 })
      }
      B.cyl(chrome, 0.008, 0.008, 0.25, 0.98, top + 0.08, z + 0.36, 6) // steam wand
      // cups warming on top
      for (let k = 0; k < 7; k++) knobs.push({ x: 0.6 + (k % 2) * 0.12, y: top + 0.46, z: z - 0.3 + k * 0.1, color: 0xf4f3ef })
    }
    instanced(THREE, cafe, new THREE.BoxGeometry(0.02, 0.012, 0.03), emitRed, reds, { cast: false })
    instanced(THREE, cafe, new THREE.CylinderGeometry(0.035, 0.028, 0.07, 8).translate(0, 0.035, 0), whiteGloss, knobs)
    // grinders: black bodies, glass hoppers full of beans
    const beans = new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: 0.8 })
    for (const z of [0.15, 0.7, -1.5, -3.5, -5.9]) {
      B.box(black, 0.17, 0.34, 0.2, 0.72, top, z)
      B.box(matBlack, 0.24, 0.02, 0.24, 0.74, top, z) // base plate
      B.box(chrome, 0.035, 0.03, 0.035, 0.83, top + 0.17, z) // spout
      B.cyl(glassSmall, 0.055, 0.085, 0.24, 0.72, top + 0.34, z, 14)
      B.cyl(beans, 0.05, 0.075, 0.17, 0.72, top + 0.35, z, 12)
      B.cyl(black, 0.088, 0.086, 0.025, 0.72, top + 0.58, z, 14)
    }
    // milk jugs, a knock box, tampers
    const jugs = []
    for (let k = 0; k < 9; k++) jugs.push({ x: range(rand, 0.5, 0.9), y: top, z: range(rand, -6.5, 0.6), s: range(rand, 0.85, 1.15) })
    instanced(THREE, cafe, new THREE.CylinderGeometry(0.04, 0.048, 0.11, 10).translate(0, 0.055, 0), chrome, jugs)

    // black paper cups in stacks, white plates and bowls, on the ledge
    const ledge = F + 1.16
    const stacks = []
    const plates = []
    for (const z of [-6.3, -5.6, -3.0, -1.9, 0.1, 0.55, -4.0]) {
      for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) stacks.push({ x: range(rand, 0.0, 0.25), y: ledge, z: z + range(rand, -0.18, 0.18), sy: range(rand, 2.5, 4.5) })
    }
    // on the back counter too
    for (let k = 0; k < 8; k++) stacks.push({ x: range(rand, 3.4, 3.8), y: F + 0.95, z: range(rand, -6, 0.5), sy: range(rand, 2, 5) })
    instanced(THREE, cafe, new THREE.CylinderGeometry(0.042, 0.033, 0.1, 10).translate(0, 0.05, 0), matBlack, stacks)
    for (const z of [-5.2, -2.6, 0.9]) {
      plates.push({ x: 0.18, y: ledge, z, sy: range(rand, 1, 1.6) })
      plates.push({ x: 0.12, y: ledge, z: z + 0.3, sy: 0.8, sx: 0.85, sz: 0.85 })
    }
    instanced(THREE, cafe, new THREE.CylinderGeometry(0.125, 0.105, 0.09, 18).translate(0, 0.045, 0), whiteGloss, plates)

    // platters: brownies and heaped fruit on steel trays
    const trays = []
    const brownies = []
    const fruit = []
    const FRUIT = [0xf08a1c, 0xf29a2a, 0xc8202a, 0x9cc23a, 0xa9cc4a, 0x5a2340, 0xf2c84b, 0xe0404a, 0x2f6b2a]
    const tray = (x, y, z, kind) => {
      trays.push({ x, y, z })
      for (let i = 0; i < (kind === 'brownie' ? 24 : 34); i++) {
        if (kind === 'brownie') {
          brownies.push({ x: x - 0.12 + (i % 4) * 0.08, y: y + 0.012, z: z - 0.2 + Math.floor(i / 4) * 0.08, ry: range(rand, -0.1, 0.1), sy: range(rand, 0.85, 1.15), color: rand() < 0.5 ? 0x4a2a18 : 0x5e3620 })
        } else {
          const a = rand() * Math.PI * 2
          const r = Math.sqrt(rand())
          fruit.push({ x: x + Math.cos(a) * r * 0.14, y: y + 0.03 + (1 - r) * 0.04, z: z + Math.sin(a) * r * 0.21, s: range(rand, 0.6, 1.3), color: pick(rand, FRUIT) })
        }
      }
    }
    tray(0.12, ledge, -6.0, 'fruit')
    tray(0.12, ledge, -3.6, 'brownie')
    tray(0.12, ledge, -1.2, 'fruit')
    tray(0.12, ledge, 0.0 - 0.45, 'brownie')
    tray(3.6, F + 0.95, -1.0, 'fruit')
    tray(3.6, F + 0.95, -4.4, 'fruit')
    instanced(THREE, cafe, new THREE.BoxGeometry(0.34, 0.014, 0.5), chrome, trays)
    instanced(THREE, cafe, new THREE.BoxGeometry(0.07, 0.04, 0.07).translate(0, 0.02, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }), brownies)
    instanced(THREE, cafe, new THREE.IcosahedronGeometry(0.03, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), fruit)
    // watermelons and melons on the back counter, a blender
    instanced(
      THREE,
      cafe,
      new THREE.SphereGeometry(0.14, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }),
      [
        { x: 3.55, y: F + 1.07, z: 0.2, sx: 1, sy: 0.85, sz: 1.2, color: 0x2f5a25 },
        { x: 3.65, y: F + 1.07, z: -0.3, sx: 1, sy: 0.85, sz: 1.2, color: 0x35612a },
        { x: 3.6, y: F + 1.03, z: -0.75, s: 0.65, color: 0xd9b24a },
        { x: 3.5, y: F + 1.03, z: -0.95, s: 0.6, color: 0xe2c25a },
      ]
    )
    B.box(black, 0.18, 0.16, 0.18, 3.6, F + 0.95, 0.7)
    B.cyl(glassSmall, 0.07, 0.09, 0.26, 3.6, F + 1.11, 0.7, 12)

    // the DJ's controller: two jog wheels, a mixer of knobs, glowing pads
    B.box(matBlack, 0.44, 0.06, 0.82, 0.5, F + 0.93, 3.8)
    for (const dz of [-0.25, 0.25]) {
      B.cyl(new THREE.MeshStandardMaterial({ color: 0x2a2c2f, metalness: 0.6, roughness: 0.35 }), 0.12, 0.12, 0.02, 0.48, F + 0.99, 3.8 + dz, 24)
      B.cyl(chrome, 0.04, 0.04, 0.024, 0.48, F + 0.99, 3.8 + dz, 12)
    }
    const djKnobs = []
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) djKnobs.push({ x: 0.36 + i * 0.07, y: F + 0.99, z: 3.72 + j * 0.05 })
    instanced(THREE, cafe, new THREE.CylinderGeometry(0.011, 0.011, 0.02, 8).translate(0, 0.01, 0), chrome, djKnobs)
    const pads = []
    for (let i = 0; i < 4; i++) for (const dz of [-0.33, 0.17]) pads.push({ x: 0.62, y: F + 0.995, z: 3.8 + dz + i * 0.042, color: i % 2 ? 0xff7a1a : 0x2a8cff })
    instanced(THREE, cafe, new THREE.BoxGeometry(0.04, 0.008, 0.035), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4 }), pads, { cast: false })
    // a laptop beside the decks
    B.box(new THREE.MeshStandardMaterial({ color: 0xb9bcc0, metalness: 0.8, roughness: 0.3 }), 0.24, 0.015, 0.32, 0.55, F + 0.93, 4.5)

    // a clothes rail with MANA's kit (photo 8)
    const rail = []
    rail.push({ a: V(2.2, F, 7.0), b: V(2.2, F + 1.75, 7.0), w: 0.03, d: 0.03, n: V(1, 0, 0) })
    rail.push({ a: V(2.2, F, 8.6), b: V(2.2, F + 1.75, 8.6), w: 0.03, d: 0.03, n: V(1, 0, 0) })
    rail.push({ a: V(2.2, F + 1.74, 7.0), b: V(2.2, F + 1.74, 8.6), w: 0.03, d: 0.03 })
    rail.push({ a: V(1.9, F + 0.02, 7.0), b: V(2.5, F + 0.02, 7.0), w: 0.03, d: 0.03 })
    rail.push({ a: V(1.9, F + 0.02, 8.6), b: V(2.5, F + 0.02, 8.6), w: 0.03, d: 0.03 })
    cafe.add(orientedBeams(THREE, rail, matBlack))
    const clothes = []
    for (let i = 0; i < 9; i++) clothes.push({ x: 2.2, y: F + 1.12, z: 7.15 + i * 0.16, sx: 0.48, sy: range(rand, 0.55, 0.75), sz: 0.05, color: pick(rand, [0x151515, 0x151515, 0xe8e6e0, 0x8f9194, 0x151515]) })
    instanced(THREE, cafe, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), clothes)

    // the ceiling: linear LED strips and a black ventilation slot (photo 8)
    const led = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e6, emissiveIntensity: 2.6 })
    for (const [x, z0, z1] of [
      [-1.6, -7.5, -1.0],
      [-1.6, 1.0, 7.0],
      [2.1, -7.0, -0.5],
      [2.1, 1.5, 7.5],
      [-0.2, -9.5, -8.0],
    ]) B.box(led, 0.06, 0.03, z1 - z0, x, L3 - 0.03, (z0 + z1) / 2)
    B.box(matBlack, 0.1, 0.02, 9, 0.9, L3 - 0.02, 0.5)
    B.box(matBlack, 5, 0.02, 0.1, 6.5 - 5.5, L3 - 0.02, 7.2)
    // an exit sign at the ceiling edge (photo 10)
    B.box(new THREE.MeshStandardMaterial({ color: 0x0c7a3c, emissive: 0x13b45a, emissiveIntensity: 1.1 }), 0.05, 0.16, 0.42, -1.6, L3 - 0.38, -7.4)

    // pendants: a black rod and a flat disc with a warm point of light below (photos 8, 9, 11)
    const bulb = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd6a0, emissiveIntensity: 3.2 })
    const cables = []
    const pend = (x, z, yTop, yBot) => {
      cables.push({ a: V(x, yBot + 0.5, z), b: V(x, yTop, z), w: 0.008, d: 0.008 })
      B.cyl(matBlack, 0.024, 0.024, 0.5, x, yBot, z, 10)
      B.cyl(matBlack, 0.16, 0.16, 0.012, x, yBot + 0.02, z, 24)
      B.cyl(bulb, 0.022, 0.022, 0.02, x, yBot, z, 10)
    }
    for (const z of [-5.8, -3.6, -1.3, 0.6]) pend(-0.3, z, L3, F + 2.25)
    pend(0.45, 3.4, L3, F + 2.4)
    // from the dome over the floor (world x = local + X0)
    for (const [x, z, y] of [
      [-2.6, -1.5, F + 3.2],
      [-4.4, 2.6, F + 3.0],
      [-5.2, -3.4, F + 2.85],
      [-3.4, 5.0, F + 3.1],
      [-5.6, 0.8, F + 2.7],
    ]) {
      const wx = x + X0
      const top2 = skinTop(wx, z) - 0.4
      pend(x, z, top2, y)
    }
    cafe.add(orientedBeams(THREE, cables, matBlack, { cast: false }))

    // olive trees in concrete planters
    B.box(coreMat, 0.9, 0.55, 0.9, -4.0, F, 7.4, 0, 2.4)
    B.box(coreMat, 0.9, 0.55, 0.9, -2.0, F, -9.6, 0, 2.4)
  }
  B.build(cafe)
  addForest(
    THREE,
    scene,
    [
      { x: X0 - 4.0, y: F + 0.55, z: 7.4, h: 2.6 },
      { x: X0 - 2.0, y: F + 0.55, z: -9.6, h: 2.4 },
    ],
    { species: 'olive', season: 'summer', seed: 5, quality }
  )

  /** Where the skin is above a point (to hang pendants from it). */
  function skinTop(x, z) {
    let y = L2
    while (y < 22 && insideHere(x, y, z)) y += 0.25
    return y - 0.25
  }

  /* --- what the runners left about: no people, but a lived-in floor ------------ */
  {
    const P = makeBatch(THREE)
    const prand = seeded(4242)
    // high tables: a black steel foot and stem, a round dark top; paper cups and bottles on them
    const tables = [
      [-10.6, 1.9],
      [-12.4, -3.6],
      [-8.6, -3.2],
      [-13.6, 4.6],
    ]
    const cups = []
    const bottles = []
    for (const [x, z] of tables) {
      P.cyl(matBlack, 0.24, 0.24, 0.03, x, L2, z, 20)
      P.cyl(black, 0.03, 0.03, 1.05, x, L2, z, 10)
      P.cyl(black, 0.35, 0.35, 0.035, x, L2 + 1.05, z, 28)
      for (let k = 0; k < 2 + Math.floor(prand() * 3); k++) {
        const a = prand() * Math.PI * 2
        const r = range(prand, 0.08, 0.26)
        cups.push({ x: x + Math.cos(a) * r, y: L2 + 1.085, z: z + Math.sin(a) * r })
      }
      if (prand() < 0.7) bottles.push({ x: x + range(prand, -0.2, 0.2), y: L2 + 1.085, z: z + range(prand, -0.2, 0.2), color: pick(prand, [0xd9e4ea, 0x1d1e20, 0xe8442e]) })
    }
    instanced(THREE, scene, new THREE.CylinderGeometry(0.042, 0.033, 0.1, 10).translate(0, 0.05, 0), matBlack, cups)
    instanced(THREE, scene, new THREE.CylinderGeometry(0.035, 0.035, 0.24, 10).translate(0, 0.12, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.3 }), bottles)
    // backpacks and gym bags dropped by the columns, the planters and the balustrade
    const bagGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    const bags = []
    for (const [x, z, w, h, d, ry] of [
      [-14.6, 2.2, 0.34, 0.46, 0.22, 0.4],
      [-14.9, 1.4, 0.62, 0.3, 0.3, 1.2],
      [-13.4, -5.6, 0.32, 0.44, 0.22, -0.5],
      [-7.3, 8.2, 0.6, 0.3, 0.32, 0.2],
      [-12.0, 7.0, 0.33, 0.42, 0.2, 2.1],
      [-14.3, 6.5, 0.3, 0.4, 0.22, 0.9],
    ])
      bags.push({ x, y: L2, z, sx: w, sy: h, sz: d, ry, color: pick(prand, [0x18191b, 0x232527, 0x3b3f44, 0x18191b, 0xd8d6d0, 0x2c4a7a]) })
    instanced(THREE, scene, bagGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }), bags)
    // jackets and hoodies thrown over the balustrade's handrail
    const rail = outline(L2, 1.1)
    const coats = []
    for (let i = 0; i < rail.length; i++) {
      const [x, z] = rail[i]
      const [x2, z2] = rail[(i + 1) % rail.length]
      if (x > -12 || prand() < 0.78) continue
      const ry = Math.atan2(-(z2 - z), x2 - x)
      coats.push({ x, y: L2 + 0.5, z, sx: range(prand, 0.4, 0.55), sy: 0.58, sz: 0.05, rx: range(prand, -0.08, 0.08), ry, color: pick(prand, [0x151517, 0x151517, 0x2a2b2f, 0x3b3f44, 0xb9bab8]) })
    }
    instanced(THREE, scene, new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }), coats)
    // the run's two white MANA flags, leaning against the core by the clothes rail
    const flagTex = paintTexture(THREE, 256, 192, (g, w, h) => {
      g.fillStyle = '#f4f3ef'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#1a1a1a'
      g.font = '500 66px "Helvetica Neue", Arial, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('MANA', w / 2, h * 0.56)
      g.strokeStyle = '#d4252b'
      g.lineWidth = 10
      g.beginPath()
      g.arc(w * 0.83, h * 0.24, 22, Math.PI * 0.6, Math.PI * 1.7)
      g.stroke()
    })
    const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, roughness: 0.8, side: THREE.DoubleSide })
    for (const [x, z, lean] of [
      [-2.95, 6.35, 0.13],
      [-2.75, 6.9, 0.18],
    ]) {
      const f = new THREE.Group()
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 2.6, 8).translate(0, 1.3, 0), steelRail)
      f.add(pole)
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.85, 6, 4), flagMat)
      const pp = cloth.geometry.attributes.position
      for (let i = 0; i < pp.count; i++) pp.setZ(i, Math.sin(pp.getX(i) * 4 + pp.getY(i)) * 0.06 - (pp.getY(i) + 0.42) * 0.25 * (pp.getX(i) + 0.57))
      cloth.geometry.computeVertexNormals()
      cloth.position.set(0.6, 2.1, 0)
      f.add(cloth)
      f.position.set(x, L2, z)
      f.rotation.set(0, -Math.PI / 2, lean)
      f.traverse((o) => {
        o.castShadow = true
      })
      scene.add(f)
    }
    // the DJ's headphones on the decks, a phone, a tote with the brand on it
    const hp = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 18, Math.PI), matBlack)
    hp.rotation.set(-Math.PI / 2, 0, 0.6)
    hp.position.set(X0 + 0.36, L2 + 0.97, 4.45)
    scene.add(hp)
    P.box(black, 0.08, 0.008, 0.16, X0 + 0.3, L2 + 1.165, -0.9, 0.3)
    P.build(scene)
  }

  /* --- the MANA letters, backlit on the concrete ---------------------------- */
  {
    const H = 0.82
    const SW = 0.055
    const letters = [
      ['M', 0.92],
      ['A', 0.84],
      ['N', 0.74],
      ['A', 0.84],
    ]
    const gap = 0.36
    const total = letters.reduce((s, l) => s + l[1], 0) + gap * (letters.length - 1)
    const geos = []
    const segs = []
    let u = -total / 2
    for (const [ch, W] of letters) {
      for (const [u0, v0, u1, v1] of letterStrokes(ch, W, H)) {
        const len = Math.hypot(u1 - u0, v1 - v0)
        const g = new THREE.BoxGeometry(len + SW * 0.6, SW, 0.045)
        g.rotateZ(Math.atan2(v1 - v0, u1 - u0))
        g.translate(u + (u0 + u1) / 2, (v0 + v1) / 2 - H / 2, 0.06)
        geos.push(g)
        segs.push([u + u0, v0 - H / 2, u + u1, v1 - H / 2])
      }
      u += W + gap
    }
    const sign = new THREE.Group()
    sign.position.set(X0 + 3.99, L2 + 2.95, 1.7)
    sign.rotation.y = -Math.PI / 2
    const lm = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshStandardMaterial({ color: 0x5b6672, metalness: 0.55, roughness: 0.38 }))
    lm.castShadow = true
    sign.add(lm)
    // the warm halo the LEDs behind the letters throw on the wall
    const PW = total + 1.0
    const PH = H + 0.9
    const halo = paintTexture(THREE, 1024, 256, (g, w, h) => {
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, h)
      const sx = w / PW
      const sy = h / PH
      g.lineCap = 'round'
      g.lineJoin = 'round'
      for (const [blur, width, alpha] of [
        [40, 34, 0.35],
        [18, 22, 0.55],
        [6, 14, 0.8],
      ]) {
        g.shadowColor = `rgba(255,170,90,${alpha})`
        g.shadowBlur = blur
        g.strokeStyle = `rgba(255,190,120,${alpha})`
        g.lineWidth = width
        for (const [a, b, c, d] of segs) {
          g.beginPath()
          g.moveTo(w / 2 + a * sx, h / 2 - b * sy)
          g.lineTo(w / 2 + c * sx, h / 2 - d * sy)
          g.stroke()
        }
      }
    })
    const hm = new THREE.Mesh(
      new THREE.PlaneGeometry(PW, PH),
      new THREE.MeshBasicMaterial({ map: halo, color: new THREE.Color(1.25, 0.95, 0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    )
    hm.position.z = 0.012
    hm.renderOrder = 4
    sign.add(hm)
    scene.add(sign)
  }

  /* --- outside: 18 Septemberplein as it really lies round the Blob ------------
   * Laid out in the Eindhoven frame (east +x, south +z, as eindhoven.js) and
   * turned half round into this file's frame by E(): Piazza's canopy and its
   * McDonald's, the white offices over Piazza, the Bijenkorf, the Bubble, the
   * Admirant's glass north over the Mathildelaan, the Lichttoren west. */
  {
    const out = makeBatch(THREE)
    const E = (x, z) => [-x, -z]
    const g = M.ground(THREE, 900, 900, asphalt, 6)
    scene.add(g)
    const sq = M.ground(THREE, 108, 132, paving, 4)
    sq.position.set(...[E(24, 30)].map(([x, z]) => [x, 0.02, z])[0])
    scene.add(sq)
    const F = (o) => M.facade(THREE, { quality, ...o })
    const fac = {
      ribbon: F({ wall: 'plaster', color: '#eeece6', frame: '#c9ccce', glass: '#2b3a46', bay: 1.8, storey: 3.6, window: { w: 0.96, h: 0.5, bars: 'grid', sill: false, lintel: false }, curtains: 0.15, seed: 31 }),
      brick: F({ wall: 'brick', color: '#8a4a32', bay: 3.2, storey: 3.3, window: { w: 0.55, h: 0.6, bars: null, sill: true, lintel: true }, seed: 32 }),
      brick2: F({ wall: 'brick', color: '#6c3a2a', frame: '#e6e0d4', bay: 3.4, storey: 3.4, window: { w: 0.6, h: 0.62, bars: 'grid', sill: true, lintel: true }, seed: 33 }),
      white: F({ wall: 'curtain', frame: '#e4e6e6', glass: '#3b6a78', bay: 1.8, storey: 3.8, curtains: 0.08, seed: 34 }),
      teal: F({ wall: 'curtain', frame: '#8fa0a3', glass: '#2f6874', bay: 1.8, storey: 3.8, curtains: 0.05, seed: 35 }),
      cream: F({ wall: 'brick', color: '#cdb98d', frame: '#2f3a34', bay: 3.0, storey: 3.6, window: { w: 0.7, h: 0.66, bars: 'grid', sill: true, lintel: false }, seed: 36 }),
      dame: F({ wall: 'plaster', color: '#f3f1ea', frame: '#3a3d40', bay: 3.6, storey: 3.9, window: { w: 0.8, h: 0.72, bars: 'grid', sill: false, lintel: false }, seed: 37 }),
      tiles: F({ wall: 'stone', color: '#7f8a84', frame: '#2b2e30', glass: '#26313a', bay: 4.0, storey: 4.0, window: { w: 0.3, h: 0.35, bars: null, sill: false, lintel: false }, seed: 38 }),
      sand: F({ wall: 'stone', color: '#d9c39a', frame: '#3b3f44', glass: '#26313a', bay: 3.0, storey: 3.5, window: { w: 0.62, h: 0.62, bars: null, sill: true, lintel: false }, seed: 39 }),
      shop: M.shopfront(THREE, { color: '#3b3f44', fascia: '#e8e3d8', bay: 3.2, storey: 4.2, warm: 0.4, quality, seed: 22 }),
    }
    // [x0, x1, z0, z1, y, h, facade] in the Eindhoven frame
    const blocks = [
      [80, 156, 24, 84, 4.6, 16.4, 'ribbon'], // Piazza's offices over the shops
      [79.8, 156, 24, 84, 0, 4.6, 'shop'],
      [96, 156, -34, 20, 0, 24, 'tiles'], // the Bijenkorf
      [-62, 4, -104, -54, 0, 26, 'white'], // the Admirant
      [22, 58, -104, -54, 0, 33, 'teal'],
      [58.2, 92, -100, -56, 0, 24, 'white'],
      [-104, -50, -33, 16, 0, 21.6, 'cream'], // the Lichttoren's wings
      [-63, -53, -32, -22, 0, 36, 'cream'],
      [-108, -50, 24, 94, 0, 27.3, 'dame'], // De Witte Dame
      [-110, -50, 114, 140, 0, 14, 'brick'],
      [-10, 75, 114, 135, 0, 15, 'brick2'],
      [96, 150, 118, 146, 0, 54, 'teal'],
      [100, 156, -150, -114, 0, 22, 'brick'],
      [-80, 90, -150, -114, 0, 20, 'brick2'],
      [200, 236, -150, 20, 0, 22, 'brick2'],
      [215, 245, 30, 60, 0, 44, 'brick'],
      [84, 106, -226, -204, 0, 90, 'teal'],
      [-33, -7, -239, -221, 0, 62, 'sand'],
      [-90, -70, -215, -195, 0, 72, 'sand'],
      [188, 212, -272, -248, 0, 70, 'white'],
      [-51, -29, -331, -309, 0, 100, 'teal'],
      [117, 143, -343, -317, 0, 76, 'sand'],
      [-163, -137, -311, -289, 0, 55, 'white'],
    ]
    for (const [x0, x1, z0, z1, y, h, k] of blocks) {
      const f = fac[k]
      const mesh = M.box(THREE, x1 - x0, h, z1 - z0, f.material, f.tile)
      const [cx, cz] = E((x0 + x1) / 2, (z0 + z1) / 2)
      mesh.geometry.translate(cx, y, cz)
      out.add(f.material, mesh.geometry)
    }
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.95 })
    for (const [x0, x1, z0, z1, y, h, k] of blocks) {
      if (k === 'shop') continue
      const [cx, cz] = E((x0 + x1) / 2, (z0 + z1) / 2)
      out.box(roofMat, x1 - x0 + 0.4, 0.5, z1 - z0 + 0.4, cx, y + h, cz)
    }
    // the Lichttoren's glass lantern
    {
      const [lx, lz] = E(-58, -27)
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 6, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0x5f8f96, metalness: 0.6, roughness: 0.1 }))
      lantern.position.set(lx, 39, lz)
      scene.add(lantern)
      const dome = new THREE.Mesh(new THREE.SphereGeometry(4.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6d8f86, metalness: 0.6, roughness: 0.4 }))
      dome.scale.y = 0.55
      dome.position.set(lx, 42, lz)
      scene.add(dome)
    }
    out.build(scene, { cast: false })

    // Piazza's canopy: glass on a deep steel grid at 12.6 m, brown masts (it fills the café's view, photo 10)
    {
      const steelC = new THREE.MeshStandardMaterial({ color: 0xd8dadb, metalness: 0.5, roughness: 0.35 })
      const brown = new THREE.MeshStandardMaterial({ color: 0x5b3524, roughness: 0.7, metalness: 0.25 })
      const glassC = new THREE.MeshStandardMaterial({ color: 0xc9dde0, metalness: 0.3, roughness: 0.06, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
      const [x0, x1, z0, z1, y] = [62, 80, -32, 84, 12.6]
      const [cx, cz] = E((x0 + x1) / 2, (z0 + z1) / 2)
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), glassC)
      pane.position.set(cx, y + 0.9, cz)
      scene.add(pane)
      const grid = []
      const P = (x, yy, z) => {
        const [a, b] = E(x, z)
        return V(a, yy, b)
      }
      for (let z = z0; z <= z1 + 0.01; z += 3.6) grid.push({ a: P(x0, y + 0.5, z), b: P(x1, y + 0.5, z), w: 0.14, d: 0.8 })
      for (let x = x0; x <= x1 + 0.01; x += 3.6) grid.push({ a: P(x, y + 0.5, z0), b: P(x, y + 0.5, z1), w: 0.14, d: 0.8 })
      grid.push({ a: P(x0, y + 0.3, z0), b: P(x0, y + 0.3, z1), w: 0.35, d: 1.4 })
      scene.add(orientedBeams(THREE, grid, steelC))
      const B2 = makeBatch(THREE)
      for (let z = z0 + 10; z <= z1; z += 14.4) {
        const [px, pz] = E(x0 + 1.5, z)
        B2.box(brown, 0.8, y, 0.8, px, 0, pz)
      }
      // the square's tall brown light masts
      for (const [x, z] of [
        [-2, 66],
        [14, 46],
        [30, 20],
        [40, 66],
        [22, -14],
        [58, -6],
      ]) {
        const [px, pz] = E(x, z)
        B2.box(brown, 0.62, 17, 0.62, px, 0, pz)
      }
      // McDonald's sign under the canopy, the big M on the Bijenkorf's corner
      const gold = new THREE.MeshStandardMaterial({ color: 0xffc72c, emissive: 0xffb000, emissiveIntensity: 0.5, roughness: 0.4 })
      const mArch = (cxE, yy, czE, s) => {
        const [mx, mz] = E(cxE, czE)
        // two arches of a fat ribbon on three legs, facing the Blob (+x here)
        for (const dz of [-0.5, 0.5]) {
          const arch = new THREE.TorusGeometry(0.5 * s, 0.11 * s, 6, 18, Math.PI)
          arch.scale(1, 1.9, 1)
          arch.rotateY(Math.PI / 2)
          arch.translate(mx, yy, mz + dz * s)
          B2.add(gold, arch)
        }
        for (const dz of [-1, 0, 1]) B2.box(gold, 0.2 * s, 0.9 * s, 0.22 * s, mx, yy - 0.9 * s, mz + dz * s)
      }
      mArch(79.5, 5.9, 28, 1.0)
      B2.box(new THREE.MeshStandardMaterial({ color: 0x27382c, roughness: 0.5 }), 0.2, 1.8, 9, ...[E(79.75, 28)].map(([x, z]) => [x, 4.6, z])[0])
      B2.box(new THREE.MeshStandardMaterial({ color: 0x3a2f2a, roughness: 0.6 }), 0.15, 7, 5, ...[E(95.5, 15)].map(([x, z]) => [x, 9, z])[0])
      mArch(95.3, 12.8, 15, 2.1)
      B2.build(scene)
    }
    // the Bubble: a small geodesic globe of greenish glass on the square
    {
      const [bx, bz] = E(52, 32)
      const ico = new THREE.IcosahedronGeometry(8.5, 2)
      ico.scale(1, 1.15, 0.95)
      ico.translate(bx, 1.2, bz)
      const bub = new THREE.Mesh(ico, new THREE.MeshStandardMaterial({ color: 0x5f9aa6, metalness: 0.6, roughness: 0.08, transparent: true, opacity: 0.7, flatShading: true }))
      scene.add(bub)
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(ico, 1), new THREE.LineBasicMaterial({ color: 0xd5dbdc }))
      scene.add(wire)
    }
    // trees round the square and along the Vestdijk (bare, early spring)
    const trees = []
    for (let x = -24; x < 78; x += low ? 22 : 11) trees.push({ x, z: 33.2, h: range(rand, 9, 12) })
    for (let z = -28; z < 96; z += low ? 22 : 11) trees.push({ x: 45.5, z, h: range(rand, 9, 12) })
    for (const [x, z] of [
      [22, -34],
      [-60, 70],
      [-40, 34],
      [-60, 4],
      [-24, -80],
    ])
      trees.push({ x, z, h: range(rand, 7, 9) })
    addForest(THREE, scene, trees.map((t) => ({ ...t, x: -t.x, z: -t.z })), { species: 'lime', season: 'winter', seed: 7, quality })
  }

  // daylight bouncing off the pale floor: lifts the ceiling and the undersides of things
  scene.add(new THREE.HemisphereLight(0x3c4248, 0xe6dccd, 0.85))
  world.focusShadows(V(-11, 10, 0), 24)

  return {
    scene,
    world,
    path: {
      positions: arrival.positions,
      targets: arrival.targets,
      fov: 52,
      near: 0.1,
      spots,
    },
    groundAt: () => L2,
    clearance: 1.0,
    update() {},
  }
}
