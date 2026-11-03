/**
 * Inside the Blob, Eindhoven — where the SRC × MANA run ended: MANA's café on
 * an upper floor of Massimiliano Fuksas's free-form dome on 18 Septemberplein.
 *
 * The Blob is a five-storey concrete frame wrapped in a free-standing skin of
 * triangulated white steel with glass panels — clear above, frosted and solid
 * white low down and at the back of house — its floors cut by elliptical
 * voids so daylight falls through the whole building. MANA's level (photos
 * 8–13): a polished concrete floor, a concrete core with formwork joints and
 * big thin "MANA" letters backlit warm, a white ceiling slab with linear LED
 * strips over the bar, round concrete columns, a long black bar with a pale
 * travertine ledge, two espresso machines, grinders, cup stacks, platters of
 * fruit and brownies, a DJ on a controller at the end of the bar, slim black
 * pendants with disc shades, glass balustrades along the floor edge — and a
 * crowd of runners in black and bright sportswear under the dome, the city's
 * towers outside the glass.
 *
 * Metres. The Blob's centre is the origin, its long axis along x (west −x),
 * north (the station) −z. The café floor is at y = 9.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createWorld } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { seeded, range, pick, paintTexture } from '../utils.js'

/* --- the dome --------------------------------------------------------------- */

const BLOB = { ax: 24, ay: 19, az: 16, y0: 5 }
const L1 = 4.5 // first floor
const L2 = 9.0 // MANA's floor
const L3 = 13.6 // the floor above (the café's ceiling)
const X0 = -6.5 // the café's local origin (bar line at X0 + 0.5)
const HOLE2 = { x: -14, z: -6.5, rx: 4.2, rz: 2.8 } // the void in MANA's floor
const HOLE1 = { x: -12.5, z: -4, rx: 6.5, rz: 4.4 } // the void in the floor below

const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const unit3 = (x, y, z) => {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}
const LOBES = [
  [unit3(0.75, 0.45, -0.35), 0.17, 0.16],
  [unit3(-0.75, 0.15, 0.5), 0.12, 0.14],
  [unit3(0.2, 0.2, 0.95), 0.06, 0.2],
  [unit3(-0.4, 0.6, -0.7), 0.07, 0.12],
]
/** Radius factor of the Blob in a direction (of the unit ellipsoid). */
function blobR(dx, dy, dz) {
  let r = 1 - 0.14 * sstep(0.5, 1, dy) + 0.03 * Math.sin(dx * 6.1 + dz * 4.3)
  for (const [L, a, w] of LOBES) r += a * Math.exp(-(1 - (dx * L[0] + dy * L[1] + dz * L[2])) / w)
  return r
}
function insideBlob(x, y, z) {
  const qx = x / BLOB.ax
  const qy = (y - BLOB.y0) / BLOB.ay
  const qz = z / BLOB.az
  const l = Math.hypot(qx, qy, qz)
  if (l < 1e-6) return true
  return l < blobR(qx / l, qy / l, qz / l)
}
/** Horizontal distance from the axis to the skin, in a direction, at a height. */
function skinR(theta, y) {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  let lo = 0
  let hi = 45
  for (let i = 0; i < 28; i++) {
    const m = (lo + hi) / 2
    if (insideBlob(c * m, y, s * m)) lo = m
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
function inPoly(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
const inEllipse = (x, z, h, grow = 0) => ((x - h.x) / (h.rx + grow)) ** 2 + ((z - h.z) / (h.rz + grow)) ** 2 < 1

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

/* --- people -------------------------------------------------------------- */

/**
 * The parts of a standing figure (1.75 m tall, facing +z), each merged into
 * one geometry so a whole crowd is a handful of instanced draws: torso and
 * upper arms, forearms (sleeves or skin), hands, head, three hairstyles,
 * trousers or shorts with bare shins, shoes — in four poses.
 */
function personKit(THREE) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const up = V(0, 1, 0)
  const limb = (a, b, r0, r1, seg = 7) => {
    const d = b.clone().sub(a)
    const len = d.length()
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true)
    g.translate(0, len / 2, 0)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.normalize()))
    g.translate(a.x, a.y, a.z)
    return g
  }
  const ball = (r, p, sx = 1, sy = 1, sz = 1, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h).scale(sx, sy, sz).translate(p.x, p.y, p.z)
  const merge = (list) => mergeGeometries(list, false)
  const mirror = (v) => V(-v.x, v.y, v.z)

  // torso: a lathed profile, flattened front to back
  const prof = [
    [0.148, 0.9],
    [0.156, 1.0],
    [0.148, 1.1],
    [0.16, 1.22],
    [0.178, 1.33],
    [0.183, 1.4],
    [0.15, 1.465],
    [0.07, 1.5],
    [0.0, 1.505],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const torso = new THREE.LatheGeometry(prof, 12).scale(1, 1, 0.64)
  const shoulders = [ball(0.062, V(0.183, 1.4, 0)), ball(0.062, V(-0.183, 1.4, 0))]

  const S = V(0.19, 1.4, 0)
  const relaxed = [S, V(0.215, 1.12, -0.02), V(0.225, 0.87, 0.03)]
  const POSES = [
    { L: relaxed, R: relaxed.map(mirror) },
    // holding a cup
    { L: relaxed, R: [mirror(S), V(-0.215, 1.13, 0.0), V(-0.17, 1.2, 0.25)], cup: V(-0.165, 1.22, 0.31) },
    // arms crossed
    { L: [S, V(0.2, 1.15, 0.08), V(-0.1, 1.24, 0.18)], R: [mirror(S), V(-0.2, 1.15, 0.08), V(0.1, 1.21, 0.2)] },
    // working on a counter
    { L: [S, V(0.22, 1.16, 0.07), V(0.17, 1.0, 0.33)], R: [mirror(S), V(-0.22, 1.16, 0.07), V(-0.17, 1.0, 0.33)] },
  ]
  const top = []
  const fore = []
  const hands = []
  let cup = null
  for (const P of POSES) {
    const t = [torso.clone(), ...shoulders.map((g) => g.clone())]
    const f = []
    const h = []
    for (const [s, e, w] of [P.L, P.R]) {
      t.push(limb(s, e, 0.052, 0.045))
      f.push(ball(0.045, e, 1, 1, 1, 6, 5), limb(e, w, 0.043, 0.034))
      const dir = w.clone().sub(e).normalize()
      h.push(ball(0.04, w.clone().addScaledVector(dir, 0.045), 0.8, 1.15, 0.6, 7, 5))
    }
    top.push(merge(t))
    fore.push(merge(f))
    hands.push(merge(h))
    if (P.cup) cup = new THREE.CylinderGeometry(0.042, 0.032, 0.105, 10).translate(P.cup.x, P.cup.y, P.cup.z)
  }

  // the face is painted on the head's own UVs (front = u 0.25); the rest sits on a plain patch
  const flatUV = (g) => {
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.75, 0.2)
    return g
  }
  const head = merge([
    flatUV(limb(V(0, 1.46, 0), V(0, 1.565, 0.012), 0.052, 0.048)),
    ball(0.1, V(0, 1.645, 0.012), 0.9, 1.12, 1.0, 16, 12),
    flatUV(new THREE.BoxGeometry(0.024, 0.04, 0.028).translate(0, 1.628, 0.112)),
    flatUV(ball(0.022, V(0.09, 1.64, 0.0), 0.5, 1, 0.8, 5, 4)),
    flatUV(ball(0.022, V(-0.09, 1.64, 0.0), 0.5, 1, 0.8, 5, 4)),
  ])
  const cap = (r, thetaLen, tilt) => new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, thetaLen).scale(0.93, 1.12, 1.04).rotateX(tilt)
  const hair = [
    // short
    merge([cap(0.106, Math.PI * 0.5, -0.62).translate(0, 1.66, -0.004)]),
    // long, down the back
    merge([cap(0.108, Math.PI * 0.52, -0.58).translate(0, 1.658, -0.006), new THREE.BoxGeometry(0.2, 0.34, 0.07).translate(0, 1.52, -0.075), ball(0.075, V(0, 1.4, -0.07), 1.2, 0.8, 0.7)]),
    // baseball cap
    merge([cap(0.112, Math.PI * 0.5, -0.12).translate(0, 1.665, 0.0), new THREE.BoxGeometry(0.17, 0.014, 0.11).rotateX(0.12).translate(0, 1.672, 0.13)]),
  ]
  const hip = (y0, y1) => new THREE.CylinderGeometry(0.152, 0.146, y1 - y0, 12).scale(1, 1, 0.66).translate(0, (y0 + y1) / 2, 0)
  const trousers = merge([
    hip(0.8, 0.98),
    ...[1, -1].flatMap((sx) => [
      limb(V(0.092 * sx, 0.86, 0), V(0.1 * sx, 0.47, 0.012), 0.084, 0.062),
      ball(0.062, V(0.1 * sx, 0.47, 0.012), 1, 1, 1, 7, 5),
      limb(V(0.1 * sx, 0.47, 0.012), V(0.1 * sx, 0.07, -0.01), 0.06, 0.047),
    ]),
  ])
  const shorts = merge([hip(0.8, 0.98), ...[1, -1].map((sx) => limb(V(0.092 * sx, 0.86, 0), V(0.1 * sx, 0.56, 0.01), 0.092, 0.084))])
  const shins = merge(
    [1, -1].flatMap((sx) => [
      limb(V(0.098 * sx, 0.6, 0.008), V(0.1 * sx, 0.47, 0.012), 0.066, 0.058),
      ball(0.056, V(0.1 * sx, 0.47, 0.012), 1, 1, 1, 7, 5),
      limb(V(0.1 * sx, 0.47, 0.012), V(0.1 * sx, 0.07, -0.01), 0.055, 0.037),
    ])
  )
  const shoes = merge([1, -1].map((sx) => new THREE.CylinderGeometry(0.5, 0.5, 1, 10).scale(0.085, 0.07, 0.25).translate(0.105 * sx, 0.035, 0.035)))
  return { top, fore, hands, cup, head, hair, trousers, shorts, shins, shoes }
}

const TOPS = ['#141518', '#141518', '#17181b', '#1c1d21', '#141518', '#2a2b2f', '#e9e7e2', '#f3f2ee', '#9a9da3', '#c5c4c0', '#2457c5', '#6e43c9', '#d43a9a', '#d6352f', '#f0a01f', '#1f3b70', '#2f8f88', '#e66a2c', '#3c7bd8']
const BOTTOMS = ['#121316', '#121316', '#18191d', '#22252c', '#1e2a44', '#7d9cc0', '#8f9196', '#2f3034']
const SKINS = ['#f2cdb0', '#e8b896', '#ddb08c', '#c99470', '#b07a55', '#8c5a3c', '#6a432d', '#4c2f21']
const HAIRS = ['#16110e', '#16110e', '#2b1d16', '#3d2a1e', '#5b3d27', '#8a6a45', '#c9a46a', '#d8c08f', '#8e8a86']
const SHOES = ['#f1f0ec', '#141414', '#eaeaea', '#262626', '#c7c9cc', '#e2532f', '#3b6fd8', '#f1f0ec']
const CAPS = ['#121212', '#121212', '#1d2a3d', '#2f4a2f', '#e9e7e2', '#121212']

/** A random runner (or barista): sizes, clothes and hair. */
function randomPerson(rand, over = {}) {
  const woman = rand() < 0.42
  const p = {
    h: woman ? range(rand, 1.58, 1.74) : range(rand, 1.7, 1.93),
    w: woman ? range(rand, 0.88, 0.96) : range(rand, 0.98, 1.1),
    pose: rand() < 0.42 ? 1 : rand() < 0.5 ? 0 : 2,
    top: pick(rand, TOPS),
    bottom: pick(rand, BOTTOMS),
    skin: pick(rand, SKINS),
    sleeve: rand() < 0.55,
    shorts: rand() < 0.38,
    shoe: pick(rand, SHOES),
  }
  p.hair = woman ? (rand() < 0.82 ? 1 : 0) : rand() < 0.36 ? 2 : 0
  p.hairC = p.hair === 2 ? pick(rand, CAPS) : pick(rand, HAIRS)
  return Object.assign(p, over)
}

function buildCrowd(THREE, parent, people, kit) {
  const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84 })
  const skin = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.52 })
  const hair = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.68 })
  const shoe = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 })
  const cupMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 })
  const face = paintTexture(THREE, 128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, w, h)
    const cx = w * 0.25
    // soft shading round the eye sockets and under the nose, cheeks a touch warmer
    g.fillStyle = 'rgba(150,95,80,0.18)'
    g.beginPath()
    g.ellipse(cx, h * 0.6, 13, 5, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = 'rgba(230,120,110,0.12)'
    for (const dx of [-9, 9]) {
      g.beginPath()
      g.ellipse(cx + dx, h * 0.66, 4, 3, 0, 0, Math.PI * 2)
      g.fill()
    }
    for (const dx of [-5.5, 5.5]) {
      g.fillStyle = 'rgba(25,16,12,0.92)'
      g.beginPath()
      g.ellipse(cx + dx, h * 0.6, 2.2, 1.3, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(40,26,18,0.6)'
      g.fillRect(cx + dx - 3, h * 0.6 - 4.5, 6, 1.4)
    }
    g.fillStyle = 'rgba(90,50,40,0.25)'
    g.fillRect(cx - 1.5, h * 0.69, 3, 1.2)
    g.fillStyle = 'rgba(120,55,50,0.55)'
    g.fillRect(cx - 3.5, h * 0.745, 7, 1.3)
  })
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, map: face })
  const buckets = new Map()
  const put = (key, geo, mat, m, color) => {
    let b = buckets.get(key)
    if (!b) buckets.set(key, (b = { geo, mat, list: [] }))
    b.list.push([m, color])
  }
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  for (const p of people) {
    const s = p.h / 1.75
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.ry), new THREE.Vector3(s * p.w, s, s * (0.55 + 0.45 * p.w)))
    put('top' + p.pose, kit.top[p.pose], cloth, m, p.top)
    put('fore' + p.pose, kit.fore[p.pose], cloth, m, p.sleeve ? p.top : p.skin)
    put('hand' + p.pose, kit.hands[p.pose], skin, m, p.skin)
    put('head', kit.head, headMat, m, p.skin)
    put('hair' + p.hair, kit.hair[p.hair], hair, m, p.hairC)
    put('shoe', kit.shoes, shoe, m, p.shoe)
    if (p.shorts) {
      put('shorts', kit.shorts, cloth, m, p.bottom)
      put('shins', kit.shins, skin, m, p.skin)
    } else put('legs', kit.trousers, cloth, m, p.bottom)
    if (p.pose === 1 && kit.cup) put('cup', kit.cup, cupMat, m, p.cupC || '#141414')
  }
  const c = new THREE.Color()
  for (const b of buckets.values()) {
    const mesh = new THREE.InstancedMesh(b.geo, b.mat, b.list.length)
    b.list.forEach(([m, col], i) => {
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.set(col))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
    mesh.castShadow = mesh.receiveShadow = true
    parent.add(mesh)
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
    sun: { elevation: 36, azimuth: 300 },
    sky: { zenith: 0x3f7fd0, horizon: 0xbcd6ee, clouds: 0.28 },
    fog: { density: 0.0005 },
    exposure: 1.0,
  })
  const { scene } = world

  /* --- viewpoints (they shape where the crowd may stand) -------------------- */
  const spots = [
    // 08 · the DJ at his controller at the end of the bar, the backlit MANA letters on the concrete core
    { pos: V(-8.5, 10.45, 6.3), look: V(-4.6, 10.95, 2.7) },
    // 09 · from behind the bar, across the grinders, a runner leaning on the counter under the pendants
    { pos: V(-4.65, 10.4, -0.3), look: V(-11, 10.9, -1.2) },
    // 10 · the wide one: over the bar and the espresso machine to the crowd and the glass dome, the city outside
    { pos: V(-3.6, 11.05, -2.2), look: V(-15.5, 11.7, -4.6) },
    // 11 · the busy end of the bar, the pendants hanging from the dome
    { pos: V(-4.8, 10.65, 1.0), look: V(-12, 12.3, 4.4) },
    // 12 · in the crowd under the lattice
    { pos: V(-12.7, 10.6, 4.0), look: V(-18.5, 11.75, 6.0) },
    // 13 · four friends by the glass, sun through the skin, the offices of the square outside
    { pos: V(-18.3, 10.5, -0.6), look: V(-25, 11.9, -2.6) },
  ]
  const arrival = { positions: [V(-14, 17.5, -4), V(-14, 15, 2), V(-12.5, 12.2, 6.2), spots[0].pos.clone()], targets: [V(-6, 11.5, 0), V(-5, 11, 2), V(-4.8, 11.0, 3.0), spots[0].look.clone()] }

  /* --- materials ------------------------------------------------------------- */
  const floorMat = M.floor(THREE, { kind: 'concrete', color: '#b3aa9c', polish: 0.3, tile: 4, quality, seed: 21 })
  floorMat.envMapIntensity = 0.55
  const ceilMat = M.plaster(THREE, { color: '#f2f1ed', dirt: 0.03, tile: 3, quality, seed: 22 })
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
  const steel = new THREE.MeshStandardMaterial({ color: 0xffffff, map: gasket, roughness: 0.38, metalness: 0.15 })
  const panelWhite = new THREE.MeshStandardMaterial({ color: 0xecebe7, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide })
  const frosted = new THREE.MeshStandardMaterial({
    color: 0xf3f5f5,
    emissive: 0xdde6ec,
    emissiveIntensity: 0.42,
    roughness: 0.45,
    transparent: true,
    opacity: 0.84,
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
    // panels kept clear where the views look out
    const clearAt = [
      [-24, 12, -3],
      [-23, 12, -6.5],
      [-21, 12.5, 7],
      [-22, 15, 0],
    ]
    const ico = new THREE.IcosahedronGeometry(1, 7)
    const P = ico.attributes.position
    const lists = { white: [], frost: [], clear: [] }
    const edges = new Map()
    const nodes = new Map()
    const key = (p) => `${Math.round(p[0] * 200)},${Math.round(p[1] * 200)},${Math.round(p[2] * 200)}`
    const vert = (i) => {
      const d = unit3(P.getX(i), P.getY(i), P.getZ(i))
      const r = blobR(d[0], d[1], d[2])
      return [d[0] * BLOB.ax * r, Math.max(0, BLOB.y0 + d[1] * BLOB.ay * r), d[2] * BLOB.az * r]
    }
    const prand = seeded(77)
    for (let i = 0; i < P.count; i += 3) {
      const v = [vert(i), vert(i + 1), vert(i + 2)]
      if (v[0][1] <= 0.02 && v[1][1] <= 0.02 && v[2][1] <= 0.02) continue
      const cx = (v[0][0] + v[1][0] + v[2][0]) / 3
      const cy = (v[0][1] + v[1][1] + v[2][1]) / 3
      const cz = (v[0][2] + v[1][2] + v[2][2]) / 3
      const ang = Math.atan2(cz, cx)
      const r = prand()
      let kind
      if (cy < 5.6 + 1.4 * Math.sin(ang * 2 + 0.5)) kind = 'white'
      else if (cx > 5 && cy < 17) kind = r < 0.72 ? 'white' : 'frost'
      else if (clearAt.some((c) => Math.hypot(cx - c[0], cy - c[1], cz - c[2]) < 4.5)) kind = 'clear'
      else if (cy > 17) kind = r < 0.42 ? 'frost' : 'clear'
      else kind = r < 0.06 ? 'white' : r < 0.36 ? 'frost' : 'clear'
      for (const p of v) lists[kind].push(p[0], p[1], p[2])
      for (let k = 0; k < 3; k++) {
        const a = v[k]
        const b = v[(k + 1) % 3]
        if (a[1] <= 0.02 && b[1] <= 0.02) continue
        const ka = key(a)
        const kb = key(b)
        const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka
        if (!edges.has(ek)) edges.set(ek, [a, b])
        if (!nodes.has(ka)) nodes.set(ka, a)
      }
    }
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
    const centre = V(0, BLOB.y0, 0)
    const beams = []
    for (const [a, b] of edges.values()) {
      const A = V(a[0], a[1], a[2])
      const B = V(b[0], b[1], b[2])
      const n = A.clone().add(B).multiplyScalar(0.5).sub(centre).normalize()
      A.addScaledVector(n, -0.13)
      B.addScaledVector(n, -0.13)
      beams.push({ a: A, b: B, w: 0.15, d: 0.26, n })
    }
    scene.add(orientedBeams(THREE, beams, steel))
    // a cast node at every joint
    const nodeList = [...nodes.values()]
    const hub = new THREE.CylinderGeometry(0.17, 0.17, 0.34, 12)
    const knots = new THREE.InstancedMesh(hub, steel, nodeList.length)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const one = V(1, 1, 1)
    const yAx = V(0, 1, 0)
    nodeList.forEach((p, i) => {
      const P0 = V(p[0], p[1], p[2])
      const n = P0.clone().sub(centre).normalize()
      q.setFromUnitVectors(yAx, n)
      P0.addScaledVector(n, -0.14)
      knots.setMatrixAt(i, m4.compose(P0, q, one))
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
    // from the dome over the crowd (world x = local + X0)
    for (const [x, z, y] of [
      [-4.5, -1.2, F + 3.1],
      [-7.5, 2.8, F + 3.3],
      [-8.5, -0.5, F + 2.9],
      [-9.5, -2.4, F + 3.4],
      [-3.3, -5.0, F + 3.0],
    ]) {
      const wx = x + X0
      const top2 = skinTop(wx, z) - 0.4
      pend(x, z, top2, y)
    }
    cafe.add(orientedBeams(THREE, cables, matBlack, { cast: false }))

    // olive trees in concrete planters
    B.box(coreMat, 0.9, 0.55, 0.9, -12.0, F, 8.6, 0, 2.4)
    B.box(coreMat, 0.9, 0.55, 0.9, -4.0, F, -10.5, 0, 2.4)
  }
  B.build(cafe)
  addForest(
    THREE,
    scene,
    [
      { x: X0 - 12.0, y: F + 0.55, z: 8.6, h: 2.8 },
      { x: X0 - 4.0, y: F + 0.55, z: -10.5, h: 2.6 },
    ],
    { species: 'olive', season: 'summer', seed: 5, quality }
  )

  /** Where the skin is above a point (to hang pendants from it). */
  function skinTop(x, z) {
    let y = L2
    while (y < 22 && insideBlob(x, y, z)) y += 0.25
    return y - 0.25
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

  /* --- people ---------------------------------------------------------------- */
  {
    const kit = personKit(THREE)
    const people = []
    const prand = seeded(4242)
    const toward = (x, z, tx, tz) => Math.atan2(tx - x, tz - z)
    const add = (x, z, ry, over = {}, y = L2) => {
      const p = randomPerson(prand, over)
      p.x = x
      p.y = y
      p.z = z
      p.ry = ry
      people.push(p)
      return p
    }
    // the café's own people
    const bx = X0 + 1.4
    add(X0 + 1.35, 3.8, -Math.PI / 2, { h: 1.82, w: 1.1, pose: 3, top: '#151517', sleeve: false, bottom: '#141518', shorts: false, skin: '#8c5a3c', hair: 0, hairC: '#16110e', shoe: '#141414' }) // the DJ
    add(bx, -1.9, -Math.PI / 2 + 0.2, { h: 1.66, w: 0.9, pose: 3, top: '#f1f0ec', sleeve: true, bottom: '#1e2a44', shorts: false, skin: '#e8b896', hair: 1, hairC: '#2b1d16' })
    add(bx, -4.4, -Math.PI / 2 - 0.15, { h: 1.68, w: 0.9, pose: 3, top: '#141518', sleeve: true, bottom: '#141518', shorts: false, skin: '#ddb08c', hair: 1, hairC: '#16110e' })
    add(bx, -6.3, -Math.PI / 2, { h: 1.6, w: 0.95, pose: 3, top: '#141518', sleeve: false, bottom: '#141518', shorts: false, skin: '#e8b896', hair: 1, hairC: '#9a9690' })
    add(X0 + 2.9, -5.3, Math.PI / 2, { h: 1.84, w: 1.08, pose: 3, top: '#5f6266', sleeve: false, bottom: '#7d9cc0', shorts: false, skin: '#e0b090', hair: 0, hairC: '#2b1d16' })
    // photo 9: the runner leaning on the counter, a man with a cup beside her
    add(X0 - 1.0, -1.8, toward(X0 - 1.0, -1.8, spots[1].pos.x, spots[1].pos.z) + 0.3, { h: 1.68, w: 0.92, pose: 2, top: '#141518', sleeve: true, bottom: '#141518', skin: '#f2cdb0', hair: 1, hairC: '#3d2a1e' })
    add(X0 - 0.75, 0.25, toward(X0 - 0.75, 0.25, X0 + 0.5, -1.0), { h: 1.8, w: 1.05, pose: 1, top: '#c5c4c0', sleeve: true, bottom: '#1e2a44', skin: '#c99470', hair: 0, hairC: '#16110e' })
    // photo 12: the man with folded arms, others round him
    {
      const s = spots[4]
      const f = s.look.clone().sub(s.pos).setY(0).normalize()
      const r = V(-f.z, 0, f.x)
      const at = (a, l) => s.pos.clone().addScaledVector(f, a).addScaledVector(r, l)
      const p1 = at(2.4, 0.1)
      add(p1.x, p1.z, toward(p1.x, p1.z, s.pos.x, s.pos.z), { h: 1.86, w: 1.06, pose: 2, top: '#141518', sleeve: true, bottom: '#141518', shorts: false, skin: '#4c2f21', hair: 0, hairC: '#16110e' })
      const p2 = at(1.7, 0.95)
      add(p2.x, p2.z, toward(p2.x, p2.z, p2.x + f.x, p2.z + f.z) + 0.4, { h: 1.66, w: 0.9, pose: 1, top: '#d43a9a', sleeve: false, bottom: '#141518', shorts: true, skin: '#f2cdb0', hair: 1, hairC: '#c9a46a' })
      const p3 = at(1.6, -1.05)
      add(p3.x, p3.z, toward(p3.x, p3.z, p1.x, p1.z), { h: 1.7, w: 0.92, pose: 0, top: '#141518', sleeve: true, bottom: '#141518', skin: '#e8b896', hair: 1, hairC: '#16110e' })
      const p4 = at(4.2, -0.9)
      add(p4.x, p4.z, toward(p4.x, p4.z, s.pos.x, s.pos.z), { h: 1.8, pose: 1, top: '#17181b', sleeve: true, hair: 0 })
      const p5 = at(4.0, 1.3)
      add(p5.x, p5.z, toward(p5.x, p5.z, p4.x, p4.z), { h: 1.84, pose: 0, top: '#2a2b2f', hair: 0 })
      const p6 = at(1.3, 1.9)
      add(p6.x, p6.z, toward(p6.x, p6.z, p1.x, p1.z), { h: 1.78, pose: 1, top: '#9a9da3', sleeve: true, hair: 2, hairC: '#121212', skin: '#c99470' })
    }
    // photo 13: four friends in front of the glass
    {
      const s = spots[5]
      const f = s.look.clone().sub(s.pos).setY(0).normalize()
      const r = V(-f.z, 0, f.x)
      const crew = [
        { h: 1.66, w: 0.9, pose: 0, top: '#141518', sleeve: true, bottom: '#141518', shorts: true, skin: '#f2cdb0', hair: 1, hairC: '#16110e', shoe: '#f1f0ec' },
        { h: 1.68, w: 0.95, pose: 0, top: '#b9bab8', sleeve: true, bottom: '#b9bab8', shorts: false, skin: '#b07a55', hair: 1, hairC: '#16110e', shoe: '#f1f0ec' },
        { h: 1.74, w: 1.0, pose: 1, top: '#1c1d21', sleeve: true, bottom: '#141518', shorts: true, skin: '#e8c09a', hair: 2, hairC: '#121212', shoe: '#141414' },
        { h: 1.86, w: 1.04, pose: 2, top: '#141518', sleeve: true, bottom: '#141518', shorts: true, skin: '#5a3826', hair: 0, hairC: '#16110e', shoe: '#141414' },
      ]
      crew.forEach((o, i) => {
        const lat = (i - 1.5) * 0.56
        const p = s.pos.clone().addScaledVector(f, 3.3 + Math.abs(lat) * 0.15).addScaledVector(r, lat)
        add(p.x, p.z, toward(p.x, p.z, s.pos.x, s.pos.z) + (i - 1.5) * 0.12, o)
      })
    }

    // the crowd: small groups round the floor and a line at the bar, kept out of the views and the camera's glides
    const segs = []
    for (let i = 0; i < spots.length; i++) segs.push([spots[i].pos, spots[(i + 1) % spots.length].pos])
    segs.push([arrival.positions[2], spots[0].pos])
    const segDist = (x, z, a, b) => {
      const dx = b.x - a.x
      const dz = b.z - a.z
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)))
      return Math.hypot(x - a.x - dx * t, z - a.z - dz * t)
    }
    const floorPoly = outline(L2, 1.9)
    const cols = [
      [X0 - 1.0, 9.0],
      [X0 + 3.2, -8.6],
      [X0 - 12, 8.6],
      [X0 - 4.0, -10.5],
    ]
    const free = (x, z, minGap = 0.56) => {
      if (!inPoly(x, z, floorPoly)) return false
      if (inEllipse(x, z, HOLE2, 0.75)) return false
      if (x > X0 - 0.75) return false
      for (const [cx, cz] of cols) if (Math.hypot(x - cx, z - cz) < 0.85) return false
      for (const s of spots) {
        const fx = s.look.x - s.pos.x
        const fz = s.look.z - s.pos.z
        const fl = Math.hypot(fx, fz)
        const rx = x - s.pos.x
        const rz = z - s.pos.z
        const along = (rx * fx + rz * fz) / fl
        const lat = Math.abs(rx * fz - rz * fx) / fl
        if (Math.hypot(rx, rz) < 1.4) return false
        if (along > 0 && along < 3.0 && lat < 0.35 + along * 0.15) return false
      }
      for (const [a, b] of segs) if (segDist(x, z, a, b) < 0.65) return false
      for (const p of people) if (p.y === L2 && Math.hypot(p.x - x, p.z - z) < minGap) return false
      return true
    }
    // the queue along the bar
    for (let z = -6.6; z < 0.9; z += range(prand, 0.55, 0.9)) {
      const x = X0 - 0.95 - range(prand, 0, 0.35)
      if (prand() < 0.8 && free(x, z)) add(x, z, Math.PI / 2 + range(prand, -0.5, 0.5))
    }
    const target = low ? 60 : 125
    let tries = 0
    while (people.length < target && tries++ < 3000) {
      const cx = range(prand, -22, X0 - 1.2)
      const cz = range(prand, -13, 13)
      if (!free(cx, cz, 1.0)) continue
      const n = 1 + Math.floor(prand() * 4.5)
      const base = prand() * Math.PI * 2
      const rad = n === 1 ? 0 : 0.36 + n * 0.08
      for (let k = 0; k < n; k++) {
        const a = base + (k / n) * Math.PI * 2 + range(prand, -0.3, 0.3)
        const x = cx + Math.cos(a) * rad
        const z = cz + Math.sin(a) * rad
        if (!free(x, z)) continue
        const ry = n === 1 ? toward(x, z, X0, z + range(prand, -4, 4)) : toward(x, z, cx, cz) + range(prand, -0.35, 0.35)
        add(x, z, ry)
      }
    }
    // a few on the floor below, seen through the void
    const poly1 = outline(L1, 2.0)
    for (let i = 0, n = 0; i < 400 && n < (low ? 6 : 14); i++) {
      const x = range(prand, -22, 4)
      const z = range(prand, -13, 13)
      if (!inPoly(x, z, poly1) || inEllipse(x, z, HOLE1, 0.7)) continue
      if (people.some((p) => p.y === L1 && Math.hypot(p.x - x, p.z - z) < 0.7)) continue
      add(x, z, prand() * Math.PI * 2, {}, L1)
      n++
    }
    buildCrowd(THREE, scene, people, kit)

    // the DJ's headphones
    const dj = people[0]
    const s = dj.h / 1.75
    const hp = new THREE.Group()
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.014, 6, 18, Math.PI), matBlack)
    band.rotation.y = Math.PI / 2
    hp.add(band)
    for (const dz of [-0.11, 0.11]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 12), matBlack)
      cup.rotation.x = Math.PI / 2
      cup.position.set(0, -0.005, dz)
      hp.add(cup)
    }
    hp.position.set(dj.x, dj.y + 1.65 * s, dj.z)
    hp.scale.setScalar(s)
    scene.add(hp)
  }

  /* --- outside: 18 Septemberplein and the city's towers ---------------------- */
  {
    const out = makeBatch(THREE)
    const g = M.ground(THREE, 460, 460, paving, 4)
    scene.add(g)
    // the Vestdijk to the east, a street along the north side
    const road1 = M.ground(THREE, 14, 420, asphalt, 6)
    road1.position.set(69, 0.02, 0)
    scene.add(road1)
    const road2 = M.ground(THREE, 420, 12, asphalt, 6)
    road2.position.set(0, 0.02, -42)
    scene.add(road2)
    const F = (o) => M.facade(THREE, { quality, ...o })
    const fac = {
      white: F({ wall: 'plaster', color: '#e8e3d8', frame: '#d4d5d3', glass: '#27323c', bay: 3.0, storey: 3.6, window: { w: 0.8, h: 0.62, bars: 'grid', sill: false, lintel: false }, curtains: 0.1, seed: 31 }),
      brick: F({ wall: 'brick', color: '#8a4a32', bay: 3.2, storey: 3.3, window: { w: 0.55, h: 0.6, bars: null, sill: true, lintel: true }, seed: 32 }),
      brick2: F({ wall: 'brick', color: '#6c3a2a', frame: '#e6e0d4', bay: 3.4, storey: 3.4, window: { w: 0.6, h: 0.62, bars: 'grid', sill: true, lintel: true }, seed: 33 }),
      blue: F({ wall: 'curtain', frame: '#c9ced2', glass: '#2d5070', bay: 1.6, storey: 3.8, curtains: 0.05, seed: 34 }),
      teal: F({ wall: 'curtain', frame: '#3a3d40', glass: '#36606a', bay: 1.8, storey: 3.6, curtains: 0.05, seed: 35 }),
      sand: F({ wall: 'stone', color: '#d9c39a', frame: '#3b3f44', glass: '#26313a', bay: 3.0, storey: 3.5, window: { w: 0.62, h: 0.62, bars: null, sill: true, lintel: false }, seed: 37 }),
      conc: F({ wall: 'concrete', color: '#a89f92', frame: '#55585b', glass: '#2a333b', bay: 2.7, storey: 3.4, window: { w: 0.7, h: 0.55, bars: 'grid', sill: false, lintel: false }, seed: 36 }),
    }
    const blocks = [
      [-62, 12, 18, 32, 22, 'white'],
      [-58, -14, 14, 14, 30, 'conc'],
      [-50, 44, 30, 18, 19, 'brick'],
      [-14, 54, 40, 16, 18, 'brick2'],
      [30, 52, 30, 18, 24, 'sand'],
      [58, 26, 16, 36, 20, 'brick'],
      [86, 4, 18, 40, 26, 'brick2'],
      [65, -73, 90, 54, 24, 'conc'],
      [62, -14, 20, 22, 30, 'blue'],
      [6, -64, 50, 18, 22, 'blue'],
      [-30, -66, 22, 22, 46, 'teal'],
      [-10, -140, 26, 26, 92, 'blue'],
      [36, -150, 22, 22, 106, 'conc'],
      [84, -122, 22, 22, 74, 'teal'],
      [-74, -118, 24, 22, 64, 'teal'],
      [124, 42, 30, 30, 45, 'brick'],
      [-122, 62, 30, 30, 40, 'sand'],
      [-132, -38, 30, 26, 58, 'blue'],
      [20, 132, 40, 20, 30, 'brick2'],
      [-64, 122, 30, 30, 36, 'conc'],
      [-104, 14, 26, 40, 28, 'brick'],
      [118, -40, 26, 30, 52, 'sand'],
    ]
    for (const [x, z, w, d, h, k] of blocks) {
      const mesh = M.box(THREE, w, h, d, fac[k].material, fac[k].tile)
      mesh.geometry.translate(x, 0, z)
      out.add(fac[k].material, mesh.geometry)
    }
    // the Admirant: a rounded glass tower at the square's north-west corner
    {
      const a = 15
      const b = 10.5
      const h = 52
      const cg = new THREE.CylinderGeometry(1, 1, h, 48, 1, false)
      cg.scale(a, 1, b)
      const circ = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
      const uv = cg.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / fac.teal.tile[0], (uv.getY(i) * h) / fac.teal.tile[1])
      cg.rotateY(0.3)
      cg.translate(-54, h / 2, -32)
      out.add(fac.teal.material, cg)
    }
    out.build(scene, { cast: false })
    // plane trees along the Vestdijk and round the square
    const trees = []
    for (let z = -30; z <= 70; z += low ? 16 : 9) trees.push({ x: 60, z, h: range(rand, 11, 14) }, { x: 78, z: z + 4, h: range(rand, 11, 14) })
    for (const [x, z] of [
      [-34, 30],
      [-38, -12],
      [22, 34],
      [30, -30],
    ])
      trees.push({ x, z, h: range(rand, 9, 12) })
    addForest(THREE, scene, trees, { species: 'plane', season: 'summer', seed: 9, quality })
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
