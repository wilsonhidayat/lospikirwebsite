/**
 * Amsterdam — a canal of the ring on a golden late afternoon.
 *
 * Narrow canal houses, each one built for real: a brick (or painted) front
 * with its own gable — step, neck, bell, spout, or a flat cornice — cut with
 * tall, recessed, white-framed windows, a raised front door up its stone
 * steps, basement windows at pavement level, a hoist beam at the top, the
 * roof running back behind. Brick quays with no railings, the canal water,
 * open sloops and houseboats moored along the walls, big leafy limes leaning
 * over the water, an arched brick bridge crowded with Dutch bikes, cars
 * between the trees, red-brown bollards. The low sun rakes the facades.
 *
 * Metres. The canal runs along X; quay tops (the streets) at y = 0, the water
 * 1.3 m below. The facades stand at z = ±FRONT.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createWorld, waterMaterial } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { beamBatch, paintTexture, seeded, range, pick } from '../utils.js'

const W = 10 // half the canal's width (20 m of water)
const WATER_Y = -1.3
const STRIP = 12.6 // canal edge → end of the tree / parking strip
const ROAD = 17.6 // end of the carriageway, start of the pavement
const FRONT = 21 // facade line
const BRIDGES = [36, -150] // x of the two bridges
const BRIDGE_W = 12 // their width along x

/* --- helpers --------------------------------------------------------------- */

/** Give a geometry a flat vertex colour (for vertex-tinted shared materials). */
function tint(geo, c) {
  const n = geo.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[i * 3] = c[0]
    a[i * 3 + 1] = c[1]
    a[i * 3 + 2] = c[2]
  }
  geo.setAttribute('color', new geo.attributes.position.constructor(a, 3))
  return geo
}

function uvScale(geo, s) {
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s)
  uv.needsUpdate = true
  return geo
}

/** Merge lists of geometries per material into meshes. */
function batcher(THREE, scene) {
  const lists = new Map()
  return {
    add(material, geo) {
      if (!lists.has(material)) lists.set(material, [])
      const g = geo.index ? geo.toNonIndexed() : geo
      g.clearGroups()
      lists.get(material).push(g)
    },
    flush() {
      lists.forEach((geos, mat) => {
        const keep = mat.vertexColors ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv']
        for (const g of geos) {
          for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k)
          if (mat.vertexColors && !g.attributes.color) tint(g, [1, 1, 1])
          if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
        }
        const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat)
        mesh.castShadow = true
        mesh.receiveShadow = true
        scene.add(mesh)
      })
      lists.clear()
    },
  }
}

/** A materials.js box geometry (UVs in metres), placed. */
function boxGeo(THREE, w, h, d, tile, x, y, z, ry = 0) {
  const g = M.box(THREE, w, h, d, null, tile).geometry
  if (ry) g.rotateY(ry)
  return g.translate(x, y, z)
}

/* --- gables: outline of a house front, from (0,0) to (w,0) up to the top --- */

/**
 * The outline above the cornice line (y = 0 here) as points from the right
 * edge round to the left, for each gable type. Returns { pts, top, hoist }.
 */
function gableOutline(type, w, rand) {
  const pts = []
  const P = (x, y) => pts.push([x, y])
  let top = 0
  let hoist = null
  if (type === 'step') {
    const steps = w > 7 ? 4 : 3
    const gh = w * range(rand, 0.85, 1.0)
    const topW = w * 0.24
    for (let i = 0; i < steps; i++) {
      const y = (gh * (i + 1)) / (steps + 1)
      P(w - ((w - topW) / 2) * (i / steps), y)
      P(w - ((w - topW) / 2) * ((i + 1) / steps), y)
    }
    P((w + topW) / 2, gh)
    P((w - topW) / 2, gh)
    for (let i = steps - 1; i >= 0; i--) {
      const y = (gh * (i + 1)) / (steps + 1)
      P(((w - topW) / 2) * ((i + 1) / steps), y)
      P(((w - topW) / 2) * (i / steps), y)
    }
    top = gh
    hoist = gh * 0.82
  } else if (type === 'neck') {
    // shoulders with curved claw pieces, a tall neck, a small pediment
    const nw = w * 0.46
    const sh = range(rand, 0.9, 1.4)
    const nh = range(rand, 3.4, 4.4)
    const a = (w + nw) / 2
    const b = (w - nw) / 2
    P(w, sh)
    for (let k = 1; k <= 6; k++) {
      const t = k / 6
      P(w - (w - a) * Math.sin((t * Math.PI) / 2), sh + nh * 0.45 * (1 - Math.cos((t * Math.PI) / 2)))
    }
    P(a, sh + nh)
    P(a + 0.15, sh + nh)
    P(w / 2, sh + nh + 1.1)
    P(b - 0.15, sh + nh)
    P(b, sh + nh)
    for (let k = 6; k >= 1; k--) {
      const t = k / 6
      P((b - 0) * Math.sin((t * Math.PI) / 2) * 1 + 0 * t, sh + nh * 0.45 * (1 - Math.cos((t * Math.PI) / 2)))
    }
    P(0, sh)
    top = sh + nh + 1.1
    hoist = sh + nh - 0.4
  } else if (type === 'bell') {
    const nw = w * 0.5
    const gh = range(rand, 4.6, 5.6)
    const a = (w + nw) / 2
    const b = (w - nw) / 2
    for (let k = 0; k <= 10; k++) {
      const t = k / 10
      // an S-curve from the cornice corner in to the neck
      const s = t * t * (3 - 2 * t)
      P(w - (w - a) * s, gh * 0.7 * t)
    }
    for (let k = 1; k <= 8; k++) {
      const t = k / 8
      P(a - (a - w / 2) * (1 - Math.cos((t * Math.PI) / 2)) * 1, gh * 0.7 + gh * 0.3 * Math.sin((t * Math.PI) / 2))
    }
    for (let k = 7; k >= 0; k--) {
      const t = k / 8
      P(b + (w / 2 - b) * (1 - Math.cos((t * Math.PI) / 2)), gh * 0.7 + gh * 0.3 * Math.sin((t * Math.PI) / 2))
    }
    for (let k = 9; k >= 0; k--) {
      const t = k / 10
      const s = t * t * (3 - 2 * t)
      P(b * s, gh * 0.7 * t)
    }
    top = gh
    hoist = gh * 0.78
  } else if (type === 'spout') {
    const gh = w * range(rand, 0.75, 0.9)
    const sw = w * 0.22
    P(w, 0.5)
    P((w + sw) / 2, gh - 0.6)
    P((w + sw) / 2, gh)
    P((w - sw) / 2, gh)
    P((w - sw) / 2, gh - 0.6)
    P(0, 0.5)
    top = gh
    hoist = gh - 0.9
  } else if (type === 'point') {
    const gh = w * 0.62
    P(w, 0)
    P(w / 2, gh)
    P(0, 0)
    top = gh
    hoist = gh * 0.7
  } else {
    // cornice: a flat top (the cornice itself is added as trim)
    P(w, 0.9)
    P(0, 0.9)
    top = 0.9
  }
  return { pts, top, hoist }
}

/* --- props --------------------------------------------------------------- */

/** A Dutch bike: frame (tinted per instance), black parts, and spoked wheels. */
function bikeGeometries(THREE) {
  const tube = (a, b, r = 0.018) => {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const len = va.distanceTo(vb)
    const g = new THREE.CylinderGeometry(r, r, len, 5, 1, true)
    g.translate(0, len / 2, 0)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()))
    return g.translate(va.x, va.y, va.z).toNonIndexed()
  }
  const R = 0.34
  const rear = [-0.55, R, 0]
  const front = [0.58, R, 0]
  const seat = [-0.25, 0.86, 0]
  const head = [0.42, 0.9, 0]
  const crank = [0, 0.3, 0]
  const frame = mergeGeometries(
    [
      tube(seat, crank, 0.022),
      tube(head, crank, 0.024), // the low step-through tube
      tube([0.42, 0.8, 0], [-0.2, 0.72, 0], 0.02),
      tube(seat, rear),
      tube(crank, rear),
      tube(head, front, 0.02),
      tube([0.42, 0.9, 0], [0.38, 1.05, 0], 0.02),
      // the rack over the rear wheel, mudguards
      tube([-0.25, 0.72, 0.08], [-0.85, 0.72, 0.08], 0.012),
      tube([-0.25, 0.72, -0.08], [-0.85, 0.72, -0.08], 0.012),
      tube([-0.85, 0.72, 0], [-0.55, R, 0], 0.012),
      new THREE.TorusGeometry(R + 0.04, 0.03, 3, 12, Math.PI).rotateZ(0.15).translate(-0.55, R, 0).toNonIndexed(),
      new THREE.TorusGeometry(R + 0.04, 0.03, 3, 12, Math.PI).rotateZ(0.5).translate(0.58, R, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.62, 0.22, 0.02).translate(-0.05, 0.36, 0.06).toNonIndexed(), // chain guard
    ],
    false
  )
  const black = mergeGeometries(
    [
      new THREE.TorusGeometry(R, 0.022, 4, 22).translate(...rear).toNonIndexed(),
      new THREE.TorusGeometry(R, 0.022, 4, 22).translate(...front).toNonIndexed(),
      new THREE.BoxGeometry(0.26, 0.06, 0.14).translate(-0.27, 0.9, 0).toNonIndexed(), // saddle
      tube([0.36, 1.05, -0.3], [0.38, 1.05, 0.3], 0.014), // handlebar
      tube([0.34, 1.08, -0.3], [0.24, 1.1, -0.36], 0.018),
      tube([0.34, 1.08, 0.3], [0.24, 1.1, 0.36], 0.018),
    ],
    false
  )
  const wheels = mergeGeometries([new THREE.CircleGeometry(R - 0.01, 20).translate(...rear), new THREE.CircleGeometry(R - 0.01, 20).translate(...front)], false)
  return { frame, black, wheels }
}

function spokeTexture(THREE) {
  return paintTexture(
    THREE,
    128,
    128,
    (g, w) => {
      g.clearRect(0, 0, w, w)
      g.strokeStyle = '#b9bcbf'
      g.lineWidth = 1.2
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2
        g.beginPath()
        g.moveTo(w / 2 + Math.cos(a) * 4, w / 2 + Math.sin(a) * 4)
        g.lineTo(w / 2 + Math.cos(a + 0.35) * (w / 2 - 2), w / 2 + Math.sin(a + 0.35) * (w / 2 - 2))
        g.stroke()
      }
      g.lineWidth = 3
      g.beginPath()
      g.arc(w / 2, w / 2, w / 2 - 3, 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = '#9a9da0'
      g.beginPath()
      g.arc(w / 2, w / 2, 6, 0, Math.PI * 2)
      g.fill()
    },
    { kind: 'color' }
  )
}

function addBikes(THREE, scene, spots, seed) {
  if (!spots.length) return
  const rand = seeded(seed)
  const g = bikeGeometries(THREE)
  const paint = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.35 })
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7 })
  const spokes = new THREE.MeshStandardMaterial({ map: spokeTexture(THREE), alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 })
  const meshes = [new THREE.InstancedMesh(g.frame, paint, spots.length), new THREE.InstancedMesh(g.black, black, spots.length), new THREE.InstancedMesh(g.wheels, spokes, spots.length)]
  const cols = [0x18191b, 0x18191b, 0x1f2a24, 0x2a2d33, 0x5b1d1d, 0x1d2c44, 0x6d6f70, 0xd8d3c6, 0x3a3020]
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const c = new THREE.Color()
  spots.forEach((s, i) => {
    // leaning a little on its kickstand or against the rail
    e.set(s.lean ?? range(rand, -0.12, 0.12), s.ry, 0, 'YXZ')
    q.setFromEuler(e)
    m.compose(new THREE.Vector3(s.x, s.y || 0, s.z), q, new THREE.Vector3(1, 1, 1))
    for (const mesh of meshes) mesh.setMatrixAt(i, m)
    meshes[0].setColorAt(i, c.setHex(pick(rand, cols)))
  })
  for (const mesh of meshes) {
    mesh.castShadow = true
    scene.add(mesh)
  }
}

/** A boat hull surface: length along x (stern at −L/2), beam across z, the part of the cross-section with u in [u0, u1] (−1 gunwale … 0 keel … 1 gunwale). */
function hullGeo(THREE, L, B, D, u0 = -1, u1 = 1) {
  const N = 16
  const K = 8
  const pos = []
  const uv = []
  const idx = []
  const half = (t) => {
    if (t < 0.12) return (B / 2) * (0.82 + 0.18 * Math.sin((t / 0.12) * (Math.PI / 2)))
    if (t > 0.6) return (B / 2) * Math.sqrt(Math.max(0.0004, 1 - ((t - 0.6) / 0.4) ** 2))
    return B / 2
  }
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const hw = half(t)
    const sheer = D + (t > 0.7 ? ((t - 0.7) / 0.3) ** 2 * 0.25 : 0) + (t < 0.05 ? 0.05 : 0)
    for (let j = 0; j <= K; j++) {
      const u = u0 + (u1 - u0) * (j / K)
      const y = sheer * Math.pow(Math.abs(u), 2.2) + (t > 0.6 ? ((t - 0.6) / 0.4) ** 1.5 * D * 0.55 * (1 - Math.abs(u)) : 0)
      pos.push(-L / 2 + t * L, y, hw * u)
      uv.push(t * L, (j / K) * D)
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < K; j++) {
      const a = i * (K + 1) + j
      const b = a + K + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Open sloops moored along the walls: { x, z, ry, len } */
function addSloops(THREE, scene, spots, seed) {
  if (!spots.length) return
  const rand = seeded(seed)
  const L = 6.4
  const Bm = 2.1
  const D = 0.78
  const body = hullGeo(THREE, L, Bm, D, -0.86, 0.86)
  const band = mergeGeometries([hullGeo(THREE, L, Bm, D, -1, -0.86), hullGeo(THREE, L, Bm, D, 0.86, 1)], false)
  const inside = mergeGeometries(
    [
      new THREE.BoxGeometry(L * 0.78, 0.04, Bm * 0.72).translate(-0.1, 0.32, 0),
      new THREE.BoxGeometry(0.3, 0.05, Bm * 0.86).translate(-1.4, 0.55, 0),
      new THREE.BoxGeometry(0.3, 0.05, Bm * 0.86).translate(0.6, 0.55, 0),
      new THREE.BoxGeometry(L * 0.5, 0.05, 0.3).translate(-1.3, 0.55, Bm * 0.36),
      new THREE.BoxGeometry(L * 0.5, 0.05, 0.3).translate(-1.3, 0.55, -Bm * 0.36),
    ],
    false
  )
  const motor = new THREE.BoxGeometry(0.35, 0.5, 0.3).translate(-L / 2 - 0.1, 0.75, 0)
  const cover = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(L * 0.42, 0.45, Bm * 0.47).translate(0, D, 0)
  const hullMat = new THREE.MeshPhysicalMaterial({ roughness: 0.35, metalness: 0.05, clearcoat: 0.6, side: THREE.DoubleSide })
  const bandMat = new THREE.MeshStandardMaterial({ roughness: 0.4, side: THREE.DoubleSide })
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.55 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.5 })
  const coverMat = new THREE.MeshStandardMaterial({ color: 0x24384a, roughness: 0.9 })
  const covered = spots.filter((s) => s.covered)
  const mk = (geo, mat, n) => new THREE.InstancedMesh(geo, mat, Math.max(1, n))
  const mBody = mk(body, hullMat, spots.length)
  const mBand = mk(band, bandMat, spots.length)
  const mIn = mk(inside, wood, spots.length)
  const mMotor = mk(motor, darkMat, spots.length)
  const mCover = mk(cover, coverMat, covered.length)
  const hulls = [0x1f2b26, 0xe8e4da, 0x2a2f38, 0x6b2a22, 0x1c1d1f, 0x3f5a4a, 0xd9d2c0]
  const bands = [0xa8322a, 0x7a5a3a, 0xe9e5dc, 0x2a3a5c, 0xa8322a]
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const c = new THREE.Color()
  let k = 0
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry)
    m.compose(new THREE.Vector3(s.x, WATER_Y - 0.32, s.z), q, new THREE.Vector3(s.len / L, 1, 1))
    for (const mesh of [mBody, mBand, mIn, mMotor]) mesh.setMatrixAt(i, m)
    mBody.setColorAt(i, c.setHex(s.hull ?? pick(rand, hulls)))
    mBand.setColorAt(i, c.setHex(s.band ?? pick(rand, bands)))
    if (s.covered) mCover.setMatrixAt(k++, m)
  })
  mCover.count = k
  for (const mesh of [mBody, mBand, mIn, mMotor, mCover]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
  }
}

/** Houseboats: steel hulls, a long cabin, windows, planters on the roof. */
function addHouseboats(THREE, B, spots, mats) {
  const rand = seeded(77)
  for (const s of spots) {
    const L = s.len
    const geo = (g) => g.translate(s.x, 0, s.z)
    B.add(mats.steel, geo(new RoundedBoxGeometry(L, 1.5, 4.6, 2, 0.3).translate(0, WATER_Y + 0.25, 0)))
    B.add(mats.steel, geo(new THREE.BoxGeometry(L + 0.1, 0.12, 4.7).translate(0, WATER_Y + 1.0, 0)))
    const cabin = pick(rand, [mats.cabinA, mats.cabinB, mats.cabinC])
    B.add(cabin, geo(new THREE.BoxGeometry(L - 2.4, 2.3, 4.0).translate(-0.4, WATER_Y + 2.15, 0)))
    B.add(mats.glass, geo(new THREE.BoxGeometry(L - 3.6, 1.0, 4.06).translate(-0.4, WATER_Y + 2.45, 0)))
    for (let x = -L / 2 + 2; x < L / 2 - 2; x += 2.2) B.add(cabin, geo(new THREE.BoxGeometry(0.16, 1.05, 4.1).translate(x, WATER_Y + 2.45, 0)))
    B.add(mats.roof, geo(new THREE.BoxGeometry(L - 2.2, 0.14, 4.2).translate(-0.4, WATER_Y + 3.35, 0)))
    for (let x = -L / 2 + 2; x < L / 2 - 3; x += range(rand, 1.6, 2.8)) {
      B.add(mats.planter, geo(new THREE.BoxGeometry(0.9, 0.4, 0.5).translate(x, WATER_Y + 3.62, range(rand, -1.4, 1.4))))
      B.add(mats.leaf, geo(new THREE.IcosahedronGeometry(range(rand, 0.35, 0.6), 0).translate(x, WATER_Y + 4.05, range(rand, -1.4, 1.4))))
    }
  }
}

/** Parked cars, glossy. spots: { x, z, ry } */
function addCars(THREE, scene, spots, seed) {
  if (!spots.length) return
  const rand = seeded(seed)
  const body = new RoundedBoxGeometry(4.2, 0.75, 1.76, 3, 0.22).translate(0, 0.62, 0)
  const cabin = new RoundedBoxGeometry(2.3, 0.62, 1.58, 3, 0.18).translate(-0.25, 1.28, 0)
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateX(Math.PI / 2)
  const wheels = mergeGeometries(
    [
      [1.35, 0.81],
      [1.35, -0.81],
      [-1.3, 0.81],
      [-1.3, -0.81],
    ].map(([x, z]) => wheel.clone().translate(x, 0.33, z)),
    false
  )
  const paint = new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08 })
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x15191d, roughness: 0.05, metalness: 0.6, clearcoat: 1 })
  const tyre = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.85 })
  const mB = new THREE.InstancedMesh(body, paint, spots.length)
  const mC = new THREE.InstancedMesh(cabin, glass, spots.length)
  const mW = new THREE.InstancedMesh(wheels, tyre, spots.length)
  const cols = [0x1c1d20, 0xdedcd6, 0x8d9194, 0x2b3a55, 0x7a1e1e, 0xe8e6e0, 0x3b3f44, 0x24402f]
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const c = new THREE.Color()
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry || 0)
    m.compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(range(rand, 0.9, 1.06), 1, 1))
    mB.setMatrixAt(i, m)
    mC.setMatrixAt(i, m)
    mW.setMatrixAt(i, m)
    mB.setColorAt(i, c.setHex(pick(rand, cols)))
  })
  for (const mesh of [mB, mC, mW]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
  }
}

/** Amsterdam street lamps: dark green cast-iron posts with a lantern. */
function addLamps(THREE, scene, spots) {
  if (!spots.length) return
  const post = mergeGeometries(
    [
      new THREE.CylinderGeometry(0.16, 0.22, 0.8, 8).translate(0, 0.4, 0),
      new THREE.CylinderGeometry(0.06, 0.09, 3.6, 8).translate(0, 2.6, 0),
      new THREE.TorusGeometry(0.1, 0.025, 4, 10).rotateX(Math.PI / 2).translate(0, 4.35, 0),
      new THREE.CylinderGeometry(0.24, 0.1, 0.12, 6).translate(0, 4.5, 0),
      new THREE.ConeGeometry(0.3, 0.34, 6).translate(0, 5.25, 0),
      new THREE.SphereGeometry(0.05, 6, 4).translate(0, 5.48, 0),
    ].map((g) => g.toNonIndexed()),
    false
  )
  const lan = new THREE.CylinderGeometry(0.26, 0.17, 0.6, 6, 1, true).translate(0, 4.85, 0)
  const iron = new THREE.MeshStandardMaterial({ color: 0x1f3128, roughness: 0.45, metalness: 0.5 })
  const glass = new THREE.MeshStandardMaterial({ color: 0xece4cf, roughness: 0.2, emissive: 0xffd9a0, emissiveIntensity: 0.2, side: THREE.DoubleSide })
  const a = new THREE.InstancedMesh(post, iron, spots.length)
  const b = new THREE.InstancedMesh(lan, glass, spots.length)
  const m = new THREE.Matrix4()
  spots.forEach((s, i) => {
    m.makeTranslation(s.x, s.y || 0, s.z)
    a.setMatrixAt(i, m)
    b.setMatrixAt(i, m)
  })
  a.castShadow = true
  scene.add(a, b)
}

/** Amsterdammertjes: the red-brown cast-iron bollards along the pavements. */
function addBollards(THREE, scene, spots) {
  if (!spots.length) return
  const geo = mergeGeometries(
    [
      new THREE.CylinderGeometry(0.075, 0.095, 0.82, 7, 1, true).translate(0, 0.41, 0),
      new THREE.TorusGeometry(0.085, 0.018, 3, 8).rotateX(Math.PI / 2).translate(0, 0.62, 0),
      new THREE.SphereGeometry(0.085, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.82, 0),
    ].map((g) => g.toNonIndexed()),
    false
  )
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a2219, roughness: 0.55, metalness: 0.3 }), spots.length)
  const m = new THREE.Matrix4()
  spots.forEach((s, i) => mesh.setMatrixAt(i, m.makeTranslation(s.x, s.y || 0, s.z)))
  mesh.castShadow = true
  scene.add(mesh)
}

/* --- beyond the city: the Zaanse Schans, and the Amstel ------------------------- */

/** Horizontal weatherboards: a colour map and a normal map (tile 2 m). */
function clapboard(THREE, color, seed = 3) {
  const rand = seeded(seed)
  const n = 10 // boards per 2 m
  const map = paintTexture(
    THREE,
    256,
    256,
    (g, w, h) => {
      g.fillStyle = color
      g.fillRect(0, 0, w, h)
      const bh = h / n
      for (let i = 0; i < n; i++) {
        g.fillStyle = `rgba(255,255,255,${(rand() * 0.06).toFixed(3)})`
        g.fillRect(0, i * bh, w, bh)
        g.fillStyle = 'rgba(0,0,0,0.35)'
        g.fillRect(0, (i + 1) * bh - 2, w, 2)
        g.fillStyle = 'rgba(255,255,255,0.08)'
        g.fillRect(0, i * bh, w, 1)
      }
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(0,0,0,${(rand() * 0.05).toFixed(3)})`
        g.fillRect(rand() * w, rand() * h, 6 + rand() * 30, 1)
      }
    },
    { kind: 'color' }
  )
  const normal = paintTexture(
    THREE,
    64,
    256,
    (g, w, h) => {
      g.fillStyle = 'rgb(128,128,255)'
      g.fillRect(0, 0, w, h)
      const bh = h / n
      for (let i = 0; i < n; i++) {
        // each board tilts out at its foot (overlapping weatherboards)
        g.fillStyle = 'rgb(128,150,245)'
        g.fillRect(0, i * bh, w, bh * 0.7)
        g.fillStyle = 'rgb(128,40,200)'
        g.fillRect(0, (i + 1) * bh - 3, w, 3)
      }
    },
    { kind: 'data' }
  )
  return new THREE.MeshStandardMaterial({ map, normalMap: normal, roughness: 0.62 })
}

/**
 * The Zaanse Schans, out past the end of the canal (+x): the river Zaan along
 * the south, its dyke with a row of working windmills (their sails turning),
 * green wooden houses with white-trimmed gables along a lane, a ditch with a
 * little wooden bridge, a meadow behind a post-and-rail fence.
 */
function zaanse(THREE, scene, B, K) {
  const { white, roofMat, glassMat, rand, low, q, water, lawnMat } = K
  const sails = []
  // the meadow and the river
  const meadow = M.ground(THREE, 1400, 724, lawnMat, 4)
  meadow.position.set(1315, 0, 338)
  scene.add(meadow)
  const farBank = M.ground(THREE, 1400, 540, lawnMat, 4)
  farBank.position.set(1315, 0, -434)
  scene.add(farBank)
  const zaan = new THREE.Mesh(new THREE.PlaneGeometry(1300, 140), water)
  zaan.rotation.x = -Math.PI / 2
  zaan.position.set(1265, -1.3, -94)
  scene.add(zaan)
  // the dyke along it: a low grassy bank with a path
  const dyke = new THREE.Shape()
  dyke.moveTo(26, -1.6)
  dyke.lineTo(24, 1.5)
  dyke.lineTo(19, 1.5)
  dyke.lineTo(13, 0)
  dyke.lineTo(13, -1.6)
  dyke.closePath()
  {
    const g = new THREE.ExtrudeGeometry(dyke, { depth: 1300, bevelEnabled: false })
    // shape x → world z (negated), extrude → world x
    g.rotateY(Math.PI / 2)
    g.translate(615, 0, 0)
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4)
    B.add(lawnMat, g)
  }
  // the canal's mouth: the quays stop, a stone edge turns the corner
  B.add(white, new THREE.BoxGeometry(1.2, 0.4, 22).translate(615.6, -0.2, 0))

  /* windmills: octagonal smock mills on a brick base, a stage round them, a boat-shaped cap, four lattice sails */
  const millWood = clapboard(THREE, '#2f3a33', 41)
  const millGreen = clapboard(THREE, '#2b5236', 42)
  const brick = M.brick(THREE, { color: '#7a3b2c', tile: 2, quality: q, seed: 43 })
  const timber = new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.8 })
  const sailCloth = new THREE.MeshStandardMaterial({ color: 0xe8e1d0, roughness: 0.9, side: THREE.DoubleSide })
  const red = new THREE.MeshStandardMaterial({ color: 0xb0412b, roughness: 0.6 })
  const mills = [
    { x: 870, z: -19, h: 13, mat: millWood, base: 4 },
    { x: 948, z: -20, h: 11, mat: millGreen, base: 0 },
    { x: 1020, z: -19, h: 12, mat: millWood, base: 3 },
    { x: 1105, z: -20, h: 10, mat: millGreen, base: 0 },
    { x: 1190, z: -19, h: 12, mat: millWood, base: 3 },
  ]
  for (const m of mills) {
    const y0 = 1.5
    if (m.base) {
      const b = new THREE.CylinderGeometry(4.6, 4.9, m.base, 8).translate(m.x, y0 + m.base / 2, m.z)
      for (let i = 0, uv = b.attributes.uv; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 15, uv.getY(i) * m.base / 2)
      B.add(brick, b)
    }
    const yb = y0 + m.base
    const body = new THREE.CylinderGeometry(2.3, 4.1, m.h, 8).translate(m.x, yb + m.h / 2, m.z)
    for (let i = 0, uv = body.attributes.uv; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, (uv.getY(i) * m.h) / 2)
    B.add(m.mat, body)
    // the stage (balcony) round the body, on struts
    const sy = yb + (m.base ? 0.4 : m.h * 0.3)
    B.add(timber, new THREE.CylinderGeometry(6.2, 6.2, 0.22, 16).translate(m.x, sy, m.z))
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      B.add(timber, new THREE.BoxGeometry(0.1, 1.0, 0.1).translate(m.x + Math.cos(a) * 6.1, sy + 0.6, m.z + Math.sin(a) * 6.1))
    }
    B.add(timber, new THREE.TorusGeometry(6.1, 0.05, 4, 32).rotateX(Math.PI / 2).translate(m.x, sy + 1.1, m.z))
    // the cap: a rounded hood with its tail toward the dyke
    const top = yb + m.h
    B.add(m.mat, new THREE.SphereGeometry(2.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.25, 0.9, 1).translate(m.x, top, m.z))
    B.add(timber, new THREE.BoxGeometry(0.3, 0.3, 9).rotateX(0.75).translate(m.x, top - 3.2, m.z + 3.6)) // the tail pole
    B.add(red, new THREE.BoxGeometry(0.5, 0.5, 0.6).translate(m.x, top + 0.4, m.z - 3.1)) // the shaft's head
    // the sails, on a pivot facing the river
    const pivot = new THREE.Group()
    pivot.position.set(m.x, top + 0.4, m.z - 3.4)
    const parts = []
    const cloth = []
    const L = 11.5
    for (let s = 0; s < 4; s++) {
      const a = (s * Math.PI) / 2
      const rot = new THREE.Matrix4().makeRotationZ(a)
      parts.push(new THREE.BoxGeometry(0.28, L, 0.24).translate(0, L / 2, 0).applyMatrix4(rot))
      // the lattice of the sail beside the stock
      for (let k = 1; k <= 12; k++) parts.push(new THREE.BoxGeometry(1.9, 0.06, 0.06).translate(1.05, 1.6 + k * 0.82, 0.05).applyMatrix4(rot))
      parts.push(new THREE.BoxGeometry(0.07, L - 1.4, 0.07).translate(2.0, (L + 1.4) / 2, 0.05).applyMatrix4(rot))
      // half the sails carry their cloth, furled part-way
      if (s % 2 === 0) cloth.push(new THREE.PlaneGeometry(1.8, (L - 1.8) * 0.75).translate(1.05, 1.8 + ((L - 1.8) * 0.75) / 2, 0.1).applyMatrix4(rot))
    }
    pivot.add(new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed()), false), timber))
    if (cloth.length) pivot.add(new THREE.Mesh(mergeGeometries(cloth, false), sailCloth))
    pivot.rotation.z = rand() * Math.PI
    pivot.traverse((o) => {
      if (o.isMesh) o.castShadow = true
    })
    scene.add(pivot)
    sails.push({ pivot, speed: range(rand, 0.25, 0.45) })
  }
  // a small red-roofed house on the dyke between two mills (as in the photo)
  B.add(millGreen, M.box(THREE, 8, 3, 6, millGreen, [2, 2]).geometry.translate(985, 1.5, -21))
  {
    const rs = new THREE.Shape()
    rs.moveTo(-4.3, 0)
    rs.lineTo(4.3, 0)
    rs.lineTo(0, 3.4)
    rs.closePath()
    const rg = new THREE.ExtrudeGeometry(rs, { depth: 6.6, bevelEnabled: false })
    for (let i = 0, uv = rg.attributes.uv; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2)
    B.add(K.redRoof, rg.translate(985, 4.5, -24.3))
  }

  /* the green wooden houses along a lane, white bargeboards, dark tiled roofs */
  const houseGreen = clapboard(THREE, '#235236', 44)
  const darkTiles = M.roof(THREE, { kind: 'tiles', color: '#3d3732', tile: 2, quality: q, seed: 45 })
  const frameMat = white
  const houses = [
    { x: 690, z: 46, w: 8.5, d: 11, h: 4.2, ry: 0, sign: true },
    { x: 668, z: 50, w: 7, d: 9, h: 3.6, ry: 0 },
    { x: 714, z: 52, w: 7.5, d: 10, h: 3.8, ry: 0 },
    { x: 737, z: 47, w: 9, d: 12, h: 4.4, ry: 0 },
    { x: 648, z: 82, w: 8, d: 10, h: 4, ry: Math.PI },
    { x: 700, z: 88, w: 9, d: 11, h: 4.2, ry: Math.PI },
    { x: 760, z: 84, w: 7.5, d: 10, h: 3.6, ry: Math.PI },
  ]
  const frames = beamBatch(THREE)
  const panes = []
  for (const hs of houses) {
    const grp = new THREE.Group()
    const gh = hs.w * 0.72 // gable height
    // walls + gable as one extruded outline (front at +z/2 in the house's frame, facing −z after rotation)
    const s = new THREE.Shape()
    s.moveTo(-hs.w / 2, 0)
    s.lineTo(hs.w / 2, 0)
    s.lineTo(hs.w / 2, hs.h)
    s.lineTo(0, hs.h + gh)
    s.lineTo(-hs.w / 2, hs.h)
    s.closePath()
    const wall = new THREE.ExtrudeGeometry(s, { depth: hs.d, bevelEnabled: false })
    for (let i = 0, uv = wall.attributes.uv; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2)
    wall.translate(0, 0, -hs.d / 2)
    const frame = new THREE.Matrix4().makeRotationY(hs.ry + Math.PI).setPosition(hs.x, 0, hs.z)
    B.add(houseGreen, wall.applyMatrix4(frame))
    // roof: two slopes overhanging the gables
    const slope = Math.hypot(hs.w / 2 + 0.5, gh + 0.4)
    for (const sx of [-1, 1]) {
      const g = M.box(THREE, slope, 0.18, hs.d + 1.0, darkTiles, [2, 2]).geometry
      g.translate(0, 0, 0)
      g.rotateZ(sx * -Math.atan2(gh, hs.w / 2))
      g.translate((sx * (hs.w / 2 + 0.25)) / 2 - sx * 0.05, hs.h + gh / 2 + 0.05, 0)
      B.add(darkTiles, g.applyMatrix4(frame))
    }
    // white bargeboards up both edges of the front gable, with a curled foot and a top ornament
    const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(frame)
    const zf = hs.d / 2 + 0.55
    frames.add(P(-hs.w / 2 - 0.5, hs.h - 0.35, zf), P(0, hs.h + gh + 0.35, zf), 0.36, 0.08)
    frames.add(P(hs.w / 2 + 0.5, hs.h - 0.35, zf), P(0, hs.h + gh + 0.35, zf), 0.36, 0.08)
    frames.add(P(0, hs.h + gh + 0.2, zf), P(0, hs.h + gh + 1.3, zf), 0.18, 0.08)
    for (const sx of [-1, 1]) frames.add(P(sx * (hs.w / 2 + 0.5), hs.h - 0.35, zf), P(sx * (hs.w / 2 + 0.2), hs.h - 0.9, zf), 0.22, 0.08)
    // the corner boards, a white band at the eaves line
    for (const sx of [-1, 1]) frames.add(P(sx * (hs.w / 2 + 0.03), 0, hs.d / 2 + 0.03), P(sx * (hs.w / 2 + 0.03), hs.h, hs.d / 2 + 0.03), 0.2, 0.06)
    frames.add(P(-hs.w / 2, hs.h, hs.d / 2 + 0.05), P(hs.w / 2, hs.h, hs.d / 2 + 0.05), 0.12, 0.06)
    // windows: white frames with small panes, dark shutters; a door
    const win = (cx, cy, w, h) => {
      panes.push({ m: new THREE.Matrix4().makeTranslation(cx, cy, hs.d / 2 + 0.02).premultiply(frame), w, h })
      const x0 = cx - w / 2
      const x1 = cx + w / 2
      const y0 = cy - h / 2
      const y1 = cy + h / 2
      const z = hs.d / 2 + 0.06
      frames.add(P(x0, y0, z), P(x0, y1, z), 0.09, 0.06)
      frames.add(P(x1, y0, z), P(x1, y1, z), 0.09, 0.06)
      frames.add(P(x0, y0, z), P(x1, y0, z), 0.09, 0.06)
      frames.add(P(x0, y1, z), P(x1, y1, z), 0.09, 0.06)
      for (let k = 1; k < 4; k++) frames.add(P(x0 + (w * k) / 4, y0, z), P(x0 + (w * k) / 4, y1, z), 0.035, 0.04)
      frames.add(P(x0, (y0 + y1) / 2, z), P(x1, (y0 + y1) / 2, z), 0.035, 0.04)
      for (const sx of [-1, 1]) B.add(K.shutter, new THREE.BoxGeometry(w * 0.32, h, 0.06).translate(cx + sx * (w / 2 + w * 0.16 + 0.05), cy, hs.d / 2 + 0.05).applyMatrix4(frame))
    }
    win(-hs.w * 0.25, 1.9, 1.5, 1.3)
    win(hs.w * 0.25, 1.9, 1.5, 1.3)
    win(0, hs.h + gh * 0.4, 1.8, 1.0)
    B.add(K.shutter, new THREE.BoxGeometry(0.95, 2.1, 0.08).translate(0, 1.05, hs.d / 2 + 0.04).applyMatrix4(frame))
    // the name board under the gable window, in white script on green
    if (hs.sign) {
      const tex = paintTexture(
        THREE,
        256,
        48,
        (g, w, h) => {
          g.fillStyle = '#1e4a30'
          g.fillRect(0, 0, w, h)
          g.strokeStyle = '#f2efe6'
          g.lineWidth = 2
          g.strokeRect(3, 3, w - 6, h - 6)
          g.fillStyle = '#f2efe6'
          g.font = 'italic bold 22px Georgia, serif'
          g.textAlign = 'center'
          g.fillText('Kaasmakerij & Comp.', w / 2, 32)
        },
        { kind: 'color' }
      )
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }))
      sign.applyMatrix4(new THREE.Matrix4().makeTranslation(0, hs.h + 0.1, hs.d / 2 + 0.07).premultiply(frame))
      scene.add(sign)
    }
    void grp
  }
  {
    const pg = new THREE.PlaneGeometry(1, 1)
    const mesh = new THREE.InstancedMesh(pg, glassMat, panes.length)
    const c = new THREE.Color()
    panes.forEach((p, i) => {
      mesh.setMatrixAt(i, p.m.clone().multiply(new THREE.Matrix4().makeScale(p.w, p.h, 1)))
      mesh.setColorAt(i, c.setRGB(0.12, 0.13, 0.14))
    })
    scene.add(mesh)
    scene.add(frames.build(frameMat))
  }
  // the lane in front of the houses: brick, a ditch along it, the little bridge
  {
    const lane = M.ground(THREE, 140, 6, K.klinker, 3)
    lane.position.set(700, 0.02, 38)
    scene.add(lane)
    const ditch = new THREE.Mesh(new THREE.PlaneGeometry(160, 4), water)
    ditch.rotation.x = -Math.PI / 2
    ditch.position.set(700, 0.035, 32.5)
    scene.add(ditch)
    for (const z of [30.4, 34.6]) B.add(timber, new THREE.BoxGeometry(160, 0.16, 0.2).translate(700, 0.08, z))
    // the bridge: planks painted green, black handrails, white-tipped posts
    const deckGreen = new THREE.MeshStandardMaterial({ color: 0x2f8a46, roughness: 0.6 })
    const black = new THREE.MeshStandardMaterial({ color: 0x18201b, roughness: 0.5 })
    B.add(timber, new THREE.BoxGeometry(1.8, 0.14, 7.4).translate(700, 0.12, 32.5))
    const rail = beamBatch(THREE)
    for (const sx of [-1, 1]) {
      const x = 700 + sx * 0.88
      for (const z of [29.1, 31.3, 33.7, 35.9]) {
        rail.add(new THREE.Vector3(x, 0.19, z), new THREE.Vector3(x, 1.12, z), 0.11)
        B.add(white, new THREE.BoxGeometry(0.12, 0.12, 0.12).translate(x, 1.18, z))
      }
      rail.add(new THREE.Vector3(x, 1.08, 29.0), new THREE.Vector3(x, 1.08, 36.0), 0.09, 0.07)
      // green boards along the lower rail and diagonal braces
      B.add(deckGreen, new THREE.BoxGeometry(0.05, 0.22, 7.0).translate(x, 0.55, 32.5))
      rail.add(new THREE.Vector3(x, 0.25, 29.2), new THREE.Vector3(x, 1.0, 31.2), 0.05)
      rail.add(new THREE.Vector3(x, 0.25, 35.8), new THREE.Vector3(x, 1.0, 33.8), 0.05)
    }
    scene.add(rail.build(black))
  }
  // the post-and-rail fence across the meadow, and tussocks of long grass
  {
    const fence = beamBatch(THREE)
    for (let x = 700; x <= 900; x += 2.4) fence.add(new THREE.Vector3(x, 0, 10.5), new THREE.Vector3(x, 1.15, 10.5), 0.11)
    for (const y of [0.55, 1.05]) fence.add(new THREE.Vector3(700, y, 10.55), new THREE.Vector3(900, y, 10.55), 0.07, 0.14)
    scene.add(fence.build(new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 0.9 })))
    // tussocks of long meadow grass: crossed cards of painted blades
    const blades = paintTexture(
      THREE,
      128,
      128,
      (g, w, h) => {
        g.clearRect(0, 0, w, h)
        const r = seeded(61)
        for (let i = 0; i < 90; i++) {
          const x = w * (0.1 + r() * 0.8)
          const top = h * (0.05 + r() * 0.55)
          const lean = (r() - 0.5) * 40
          const t = r()
          g.strokeStyle = t < 0.5 ? '#6f8a3a' : t < 0.8 ? '#8f9c4a' : '#b5ad6a'
          g.lineWidth = 1.2 + r() * 1.6
          g.beginPath()
          g.moveTo(x, h)
          g.quadraticCurveTo(x + lean * 0.3, (h + top) / 2, x + lean, top)
          g.stroke()
        }
      },
      { kind: 'color' }
    )
    blades.wrapS = blades.wrapT = THREE.ClampToEdgeWrapping
    const card = mergeGeometries([new THREE.PlaneGeometry(1.2, 0.8).translate(0, 0.4, 0), new THREE.PlaneGeometry(1.2, 0.8).translate(0, 0.4, 0).rotateY(Math.PI / 2)], false)
    const n = low ? 500 : 1600
    const mesh = new THREE.InstancedMesh(card, new THREE.MeshStandardMaterial({ map: blades, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 }), n)
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      const x = range(rand, 640, 1250)
      const z = i < n * 0.3 ? range(rand, 8, 16) : range(rand, -12, 120)
      const k = range(rand, 0.7, 1.6)
      m.makeRotationY(rand() * Math.PI).scale(new THREE.Vector3(k, k * range(rand, 0.8, 1.3), k)).setPosition(x, 0, z)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.setHSL(0, 0, range(rand, 0.8, 1.15)))
    }
    mesh.castShadow = true
    scene.add(mesh)
  }
  // poplars and willows on the horizon, a few farm sheds
  const trees = []
  for (let x = 640; x < 1400; x += range(rand, 30, 55)) trees.push({ x, z: range(rand, 120, 160), h: range(rand, 14, 20) })
  for (let x = 900; x < 1600; x += range(rand, 45, 80)) trees.push({ x, z: range(rand, -170, -150), h: range(rand, 12, 18) })
  return { sails, trees }
}

/**
 * The Amstel, at the west end of the canal (−x): a wide river running across,
 * a bridge over it with black iron railings, grand nineteenth-century houses
 * on its far bank with houseboats moored below, autumn trees on the near quay.
 */
function amstel(THREE, scene, B, K) {
  const { brick, plaster, white, roofMat, water, rand, q, klinker } = K
  const X0 = -695 // west quay wall
  const X1 = -625 // east quay wall
  const river = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, 1400), water)
  river.rotation.x = -Math.PI / 2
  river.position.set((X0 + X1) / 2, -1.3, 0)
  scene.add(river)
  for (const [x0, x1, z0, z1] of [[-1400, X0, -700, 700], [X1, -615, -700, -10.6], [X1, -615, 10.6, 700]]) {
    const g = M.ground(THREE, x1 - x0, z1 - z0, klinker, 3)
    g.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2)
    scene.add(g)
  }
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(12, 21.2), water)
  mouth.rotation.x = -Math.PI / 2
  mouth.position.set(-620, -1.3, 0)
  scene.add(mouth)
  for (const x of [X0 - 0.6, X1 + 0.6]) B.add(brick, tint(boxGeo(THREE, 1.2, 2.6, 1400, [2, 2], x, -2.5, 0), [0.4, 0.3, 0.26]))
  B.add(white, new THREE.BoxGeometry(0.5, 0.16, 1400).translate(X0 - 0.25, -0.05, 0))
  B.add(white, new THREE.BoxGeometry(0.5, 0.16, 1400).translate(X1 + 0.25, -0.05, 0))
  // the bridge across the river, just south of the canal's mouth: a flat deck on stone piers
  const BZ = -16
  B.add(plaster, tint(boxGeo(THREE, X1 - X0 + 4, 0.9, 12, [3, 3], (X0 + X1) / 2, -0.75, BZ), [0.55, 0.52, 0.48]))
  for (let x = X0 + 14; x < X1 - 5; x += 14) B.add(brick, tint(boxGeo(THREE, 2.2, 1.6, 11, [2, 2], x, -2.4, BZ), [0.45, 0.33, 0.28]))
  const deck = M.ground(THREE, X1 - X0 + 4, 11.6, klinker, 3)
  deck.position.set((X0 + X1) / 2, 0.16, BZ)
  scene.add(deck)
  const rails = beamBatch(THREE)
  for (const z of [BZ - 5.85, BZ + 5.85]) {
    for (let x = X0 - 1.5; x <= X1 + 1.5; x += 2.6) {
      rails.add(new THREE.Vector3(x, 0.16, z), new THREE.Vector3(x, 1.15, z), 0.1)
      rails.add(new THREE.Vector3(x, 0.16, z), new THREE.Vector3(x, 0.32, z), 0.17)
      B.add(K.ironDark, new THREE.SphereGeometry(0.08, 8, 6).translate(x, 1.2, z))
    }
    rails.add(new THREE.Vector3(X0 - 1.5, 1.12, z), new THREE.Vector3(X1 + 1.5, 1.12, z), 0.07, 0.07)
    rails.add(new THREE.Vector3(X0 - 1.5, 0.62, z), new THREE.Vector3(X1 + 1.5, 0.62, z), 0.04, 0.04)
  }
  scene.add(rails.build(K.ironDark))

  // the grand houses on the west bank: tall, red brick and stone bands, mansards, a corner turret or two
  const fac = M.facade(THREE, { wall: 'brick', color: '#8a4a36', mortar: '#c9b7a2', frame: '#efe9dd', glass: '#1d242b', bay: 2.8, storey: 3.6, window: { w: 0.5, h: 0.62, bars: 'sash', sill: true, lintel: true }, curtains: 0.35, quality: q, seed: 81 })
  const facPale = fac.material.clone()
  facPale.color = new THREE.Color(1.15, 1.05, 0.95)
  const slate = M.roof(THREE, { kind: 'slate', color: '#4a4f57', tile: 2, quality: q, seed: 82 })
  let z = 30
  let i = 0
  while (z > -420) {
    const w = range(rand, 12, 22)
    const storeys = 4 + Math.floor(rand() * 2)
    const h = storeys * 3.6 + 1
    const cz = z - w / 2
    const x = X0 - 8 - 10
    const mat = i % 3 === 1 ? facPale : fac.material
    B.add(mat, M.box(THREE, 20, h, w, mat, fac.tile).geometry.translate(x, 0, cz))
    B.add(white, new THREE.BoxGeometry(0.8, 0.5, w + 0.2).translate(x + 10.1, h - 0.25, cz))
    for (let s = 1; s < storeys; s++) B.add(white, new THREE.BoxGeometry(0.3, 0.22, w).translate(x + 10.05, 4.6 + (s - 1) * 3.6, cz))
    // a mansard or a stepped/curved gable over the front
    if (rand() < 0.55) {
      const g = new THREE.CylinderGeometry(0.5, 0.75, 4.2, 4, 1).rotateY(Math.PI / 4)
      g.scale((20 * 0.95) / 0.75 / Math.SQRT2, 1, (w * 0.98) / 0.75 / Math.SQRT2)
      g.translate(x, h + 2.1, cz)
      for (let k = 0, uv = g.attributes.uv; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 12, uv.getY(k) * 2)
      B.add(slate, g)
      for (let k = 0; k < Math.floor(w / 4); k++) B.add(white, new THREE.BoxGeometry(1.4, 1.6, 1.2).translate(x + 8.6, h + 1.2, cz - w / 2 + 2 + k * 4))
    } else {
      const s = new THREE.Shape()
      s.moveTo(-w / 2, 0)
      s.lineTo(w / 2, 0)
      s.lineTo(w / 2, 1.5)
      s.lineTo(w * 0.3, 1.5)
      s.lineTo(w * 0.3, 3.6)
      s.lineTo(w * 0.12, 3.6)
      s.lineTo(0, 6)
      s.lineTo(-w * 0.12, 3.6)
      s.lineTo(-w * 0.3, 3.6)
      s.lineTo(-w * 0.3, 1.5)
      s.lineTo(-w / 2, 1.5)
      s.closePath()
      const gg = new THREE.ExtrudeGeometry(s, { depth: 0.6, bevelEnabled: false })
      for (let k = 0, uv = gg.attributes.uv; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 2, uv.getY(k) / 2)
      gg.rotateY(Math.PI / 2).translate(x + 9.6, h, cz)
      B.add(brick, tint(gg, [0.62, 0.38, 0.3]))
      B.add(roofMat, new THREE.BoxGeometry(18, 0.3, w).translate(x - 1, h + 0.1, cz))
    }
    if (i % 4 === 2) {
      const t = new THREE.CylinderGeometry(2.4, 2.4, h + 2, 12).translate(x + 9.2, (h + 2) / 2, z - 0.5)
      B.add(white, t)
      B.add(slate, new THREE.ConeGeometry(2.8, 5, 12).translate(x + 9.2, h + 4.5, z - 0.5))
    }
    z -= w + 0.05
    i++
  }
  // the near (east) bank: houses set back behind the trees, and houses closing the view down river
  for (let zz = -14; zz > -420; zz -= range(rand, 9, 16)) {
    const w = range(rand, 8, 14)
    B.add(fac.material, M.box(THREE, 14, range(rand, 14, 19), w, fac.material, fac.tile).geometry.translate(X1 + 26, 0, zz - w / 2))
  }
  for (let xx = -760; xx < -560; xx += range(rand, 10, 18)) B.add(facPale, M.box(THREE, 12, range(rand, 15, 20), 14, facPale, fac.tile).geometry.translate(xx, 0, -470))
  // houseboats along the west bank, low arks with windows
  const W = -1.3
  for (let zz = -34; zz > -380; zz -= range(rand, 24, 34)) {
    const L = range(rand, 16, 24)
    const cz = zz - L / 2
    const x = X0 + 3.2
    const cabin = pick(rand, K.cabins)
    B.add(K.steel, new RoundedBoxGeometry(4.6, 1.5, L, 2, 0.3).translate(x, W + 0.25, cz))
    B.add(K.steel, new THREE.BoxGeometry(4.7, 0.12, L + 0.1).translate(x, W + 1.0, cz))
    B.add(cabin, new THREE.BoxGeometry(4.0, 2.3, L - 2.4).translate(x, W + 2.15, cz + 0.4))
    B.add(K.glassMat, new THREE.BoxGeometry(4.06, 1.0, L - 3.6).translate(x, W + 2.45, cz + 0.4))
    for (let k = -L / 2 + 2; k < L / 2 - 2; k += 2.2) B.add(cabin, new THREE.BoxGeometry(4.1, 1.05, 0.16).translate(x, W + 2.45, cz + k))
    B.add(K.boatRoof, new THREE.BoxGeometry(4.2, 0.14, L - 2.2).translate(x, W + 3.35, cz + 0.4))
    for (let k = -L / 2 + 2; k < L / 2 - 3; k += range(rand, 1.6, 2.8)) {
      B.add(K.planter, new THREE.BoxGeometry(0.5, 0.4, 0.9).translate(x + range(rand, -1.4, 1.4), W + 3.62, cz + k))
      B.add(K.leafy, new THREE.IcosahedronGeometry(range(rand, 0.35, 0.6), 0).translate(x + range(rand, -1.4, 1.4), W + 4.05, cz + k))
    }
  }
  // trees: autumn limes on the east quay (yellow and bare), some on the west bank
  const trees = []
  for (let zz = -26; zz > -330; zz -= range(rand, 12, 16)) trees.push({ x: X1 + 4, z: zz, h: range(rand, 15, 21) })
  for (let zz = -60; zz > -300; zz -= range(rand, 30, 40)) trees.push({ x: X0 - 4.5, z: zz, h: range(rand, 13, 18) })
  return { trees }
}

/* --- the scene ---------------------------------------------------------- */

export function buildAmsterdam(THREE, ctx, { light = 'golden' } = {}) {
  // Evan & Inez's day was bright and clear: a deep blue sky over the canals
  // whatever the hero photo's sky reads as (the loader's 'golden' is ignored)
  void light
  ctx.sky = null
  const world = createWorld(THREE, ctx, 'day', {
    // a high spring sun from the south-west: the north quay's fronts in full light
    sun: { elevation: 44, azimuth: 208 },
    sky: { zenith: 0x2f6fc6, horizon: 0xb4d1ee, ground: 0x9d9a8c, sun: 0xfff3dc, cloudLit: 0xffffff, cloudShade: 0xc8d4e4, clouds: 0.22 },
    fog: { density: 0.00055 },
    sunColor: 0xfff1dc,
    sunIntensity: 2.3,
    hemi: [0xe8efff, 0x9a8a72, 1.0],
  })
  const { scene } = world
  const rand = seeded(1612)
  const low = ctx.quality === 'low'
  const q = ctx.quality
  const reach = low ? 105 : 165
  const B = batcher(THREE, scene)

  /* materials (painted once, tinted per house through vertex colours) */
  const brick = M.brick(THREE, { color: '#9a5843', mortar: '#b9ad9c', variation: 0.2, dirt: 0.14, tile: 2, quality: q, seed: 3 })
  brick.vertexColors = true
  const plaster = M.plaster(THREE, { color: '#f1ede4', dirt: 0.1, tile: 3, quality: q, seed: 4 })
  plaster.vertexColors = true
  const roofMat = M.roof(THREE, { kind: 'tiles', color: '#4a3f3a', tile: 2, quality: q, seed: 5 })
  const klinker = M.paving(THREE, { kind: 'herringbone', color: '#8a5b47', joint: '#5b4a40', variation: 0.16, tile: 3, quality: q, seed: 6 })
  const road = klinker.clone()
  road.color = new THREE.Color(0xb9b0aa)
  const tiles = M.paving(THREE, { kind: 'flags', color: '#9a958d', joint: '#6e6a64', unit: 0.3, variation: 0.08, tile: 3, quality: q, seed: 7 })
  const white = new THREE.MeshStandardMaterial({ color: 0xf1ede3, roughness: 0.55 })
  const darkGreen = new THREE.MeshStandardMaterial({ color: 0x1f3229, roughness: 0.5 })
  const ironGreen = new THREE.MeshStandardMaterial({ color: 0x24392f, roughness: 0.45, metalness: 0.5 })
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3 })
  const lacquer = new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 0.8 })
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.75 })

  const BRICKS = [
    [0.62, 0.42, 0.38], // dark red-brown
    [0.82, 0.6, 0.52], // red
    [0.42, 0.3, 0.27], // deep brown
    [0.3, 0.24, 0.22], // nearly black
    [1.02, 0.78, 0.62], // warm orange-red
    [0.7, 0.5, 0.5], // aubergine
    [0.55, 0.45, 0.4],
  ]
  const PAINTS = [
    [1, 1, 1], // white
    [0.98, 0.93, 0.82], // cream
    [0.16, 0.3, 0.22], // canal green
    [0.42, 0.44, 0.45], // grey
    [0.12, 0.12, 0.13], // black
    [0.75, 0.62, 0.42], // ochre
  ]
  const DOORS = [0x1d3328, 0x161616, 0x5a1a1a, 0x1c2a40, 0x2f3a2f, 0x3a2418]

  /* --- ground, water, quays ------------------------------------------- */
  const tickers = []
  const water = waterMaterial(THREE, { palette: { ...world.light, water: { deep: 0x253a38, shallow: 0x4d6f6a, stroke: 0xffffff } }, scale: 0.32, strokes: 0.5 })
  tickers.push((t) => water.userData.tick(t))
  const LEN = reach * 2 + 900
  const canal = new THREE.Mesh(new THREE.PlaneGeometry(LEN, W * 2), water)
  canal.rotation.x = -Math.PI / 2
  canal.position.y = WATER_Y
  scene.add(canal)
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(LEN, W * 2), new THREE.MeshBasicMaterial({ color: 0x15170f }))
  bed.rotation.x = -Math.PI / 2
  bed.position.y = WATER_Y - 2.5
  scene.add(bed)
  for (const s of [-1, 1]) {
    const g = M.ground(THREE, LEN, 700, klinker, 3)
    g.position.z = s * (W + 350)
    scene.add(g)
    // carriageway (a darker klinker), the raised pavement with its kerb, the quay wall
    const r = M.ground(THREE, LEN, ROAD - STRIP, road, 3)
    r.position.set(0, 0.01, s * (STRIP + ROAD) / 2)
    road.polygonOffset = true
    road.polygonOffsetFactor = -1
    scene.add(r)
    B.add(tiles, boxGeo(THREE, LEN, 0.12, FRONT - ROAD + 0.2, [3, 3], 0, 0, s * (ROAD + FRONT + 0.2) / 2))
    B.add(brick, tint(boxGeo(THREE, LEN, -0.05 - WATER_Y - 0.5, 1.2, [2, 2], 0, WATER_Y + 0.5, s * (W + 0.6)), [0.5, 0.36, 0.3]))
    B.add(brick, tint(boxGeo(THREE, LEN, 2.5, 1.2, [2, 2], 0, WATER_Y - 2, s * (W + 0.6)), [0.16, 0.18, 0.12]))
    B.add(plaster, tint(boxGeo(THREE, LEN, 0.16, 0.42, [3, 3], 0, -0.11, s * (W + 0.21)), [0.55, 0.54, 0.52]))
  }

  /* --- the canal houses --------------------------------------------------- */
  const frames = { white: beamBatch(THREE), green: beamBatch(THREE) }
  const iron = beamBatch(THREE)
  const panes = [] // { x, y, z, w, h, ry, c }
  const doors = []
  const bikeSpots = []
  const stoneTint = [0.36, 0.38, 0.41] // blue-grey hardstone

  function house(side, xa, w, force = null) {
    const ry = side > 0 ? Math.PI : 0
    const x0 = side > 0 ? xa + w : xa
    const z0 = side * FRONT
    // local (x along the facade, y up, z out toward the canal) → world
    const P = (lx, ly, lz) => new THREE.Vector3(side > 0 ? x0 - lx : x0 + lx, ly, side > 0 ? z0 - lz : z0 + lz)
    const place = (geo) => {
      if (ry) geo.rotateY(ry)
      return geo.translate(x0, 0, z0)
    }
    const painted = force ? true : rand() < 0.22
    const col = force || (painted ? pick(rand, PAINTS) : pick(rand, BRICKS))
    const wallMat = painted ? plaster : brick
    const frameKey = painted && col[1] > 0.9 && rand() < 0.5 ? 'green' : 'white'
    const fr = frames[frameKey]
    const upper = 3 + Math.floor(rand() * 2) + (w > 7.6 && rand() < 0.5 ? 1 : 0)
    const GH = 4.0 // the raised ground floor, over a basement
    const storeys = [GH]
    for (let i = 0; i < upper; i++) storeys.push(range(rand, 3.0, 3.35) - i * 0.12)
    const Hw = storeys.reduce((a, b) => a + b, 0)
    const d = range(rand, 12, 16)
    const type = w > 8 && rand() < 0.6 ? 'cornice' : pick(rand, ['neck', 'neck', 'bell', 'bell', 'step', 'spout', 'cornice', 'point'])
    const gable = gableOutline(type, w, rand)

    // the front wall, cut with windows, door and basement lights
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    shape.lineTo(w, 0)
    shape.lineTo(w, Hw)
    for (const [gx, gy] of gable.pts) shape.lineTo(gx, Hw + gy)
    shape.lineTo(0, Hw)
    shape.closePath()
    const nW = w < 6.2 ? 2 : w < 8.2 ? 3 : 4
    const bay = w / nW
    const ww = Math.min(1.3, bay * 0.56)
    const doorBay = rand() < 0.5 ? 0 : nW - 1
    const hole = (cx, y0, wd, ht, kind) => {
      const h = new THREE.Path()
      h.moveTo(cx - wd / 2, y0)
      h.lineTo(cx - wd / 2, y0 + ht)
      h.lineTo(cx + wd / 2, y0 + ht)
      h.lineTo(cx + wd / 2, y0)
      h.closePath()
      shape.holes.push(h)
      if (kind === 'door') {
        doors.push({ p: P(cx, y0 + 1.15, -0.2), ry, w: wd - 0.16, h: 2.3, c: pick(rand, DOORS) })
        panes.push({ p: P(cx, y0 + 2.66, -0.16), ry, w: wd - 0.2, h: ht - 2.5, c: 0.8 })
        fr.add(P(cx - wd / 2 + 0.05, y0, -0.16), P(cx - wd / 2 + 0.05, y0 + ht, -0.16), 0.1, 0.1)
        fr.add(P(cx + wd / 2 - 0.05, y0, -0.16), P(cx + wd / 2 - 0.05, y0 + ht, -0.16), 0.1, 0.1)
        fr.add(P(cx - wd / 2, y0 + ht - 0.05, -0.16), P(cx + wd / 2, y0 + ht - 0.05, -0.16), 0.1, 0.1)
        fr.add(P(cx - wd / 2, y0 + 2.36, -0.16), P(cx + wd / 2, y0 + 2.36, -0.16), 0.1, 0.1)
        return
      }
      // a recessed window: glass at the back of the reveal, a frame, bars
      const r = -0.17
      panes.push({ p: P(cx, y0 + ht / 2, r - 0.02), ry, w: wd, h: ht, c: range(rand, 0.55, 1.1) })
      const t = 0.085
      fr.add(P(cx - wd / 2 + t / 2, y0, r), P(cx - wd / 2 + t / 2, y0 + ht, r), t, 0.09)
      fr.add(P(cx + wd / 2 - t / 2, y0, r), P(cx + wd / 2 - t / 2, y0 + ht, r), t, 0.09)
      fr.add(P(cx - wd / 2, y0 + t / 2, r), P(cx + wd / 2, y0 + t / 2, r), 0.09, t)
      fr.add(P(cx - wd / 2, y0 + ht - t / 2, r), P(cx + wd / 2, y0 + ht - t / 2, r), 0.09, t)
      if (kind === 'basement') {
        for (let k = 1; k < 4; k++) iron.add(P(cx - wd / 2 + (wd * k) / 4, y0, r + 0.06), P(cx - wd / 2 + (wd * k) / 4, y0 + ht, r + 0.06), 0.025, 0.025)
        return
      }
      const tr = y0 + ht * (kind === 'attic' ? 1 : 0.74)
      if (kind !== 'attic') fr.add(P(cx - wd / 2, tr, r), P(cx + wd / 2, tr, r), 0.09, 0.07)
      fr.add(P(cx, y0, r), P(cx, kind === 'attic' ? y0 + ht : tr, r), 0.06, 0.08)
      if (kind === 'upper') {
        const mr = y0 + (tr - y0) * 0.5
        fr.add(P(cx - wd / 2, mr, r + 0.02), P(cx + wd / 2, mr, r + 0.02), 0.08, 0.06)
        // the top light in small panes
        for (const k of [0.25, 0.75]) fr.add(P(cx - wd / 2 + wd * k, tr, r + 0.01), P(cx - wd / 2 + wd * k, y0 + ht, r + 0.01), 0.035, 0.05)
      } else {
        fr.add(P(cx - wd / 2, y0 + (tr - y0) * 0.5, r + 0.01), P(cx + wd / 2, y0 + (tr - y0) * 0.5, r + 0.01), 0.04, 0.05)
        fr.add(P(cx - wd / 4, y0, r + 0.01), P(cx - wd / 4, tr, r + 0.01), 0.035, 0.05)
        fr.add(P(cx + wd / 4, y0, r + 0.01), P(cx + wd / 4, tr, r + 0.01), 0.035, 0.05)
      }
      // a stone sill
      B.add(white, place(new THREE.BoxGeometry(wd + 0.18, 0.08, 0.24).translate(cx, y0 - 0.04, -0.02)))
    }
    // basement lights and the raised ground floor
    for (let b = 0; b < nW; b++) {
      const cx = (b + 0.5) * bay
      if (b === doorBay) hole(cx, 0.95, Math.min(1.25, bay * 0.62), 3.0, 'door')
      else {
        hole(cx, 0.18, ww, 0.6, 'basement')
        hole(cx, 1.45, ww * 1.06, GH - 1.9, 'ground')
      }
    }
    let y = GH
    for (let s = 1; s < storeys.length; s++) {
      const sh = storeys[s]
      for (let b = 0; b < nW; b++) hole((b + 0.5) * bay, y + 0.5, ww, sh - 0.95, 'upper')
      y += sh
    }
    // attic windows in the gable
    if (type !== 'cornice') {
      const ay = Hw + (type === 'neck' ? 0.5 + gable.hoist * 0.25 : 0.55)
      const ah = Math.min(1.5, gable.top * 0.32)
      if (type === 'step' && w > 6.5) {
        hole(w * 0.34, ay, 0.8, ah, 'attic')
        hole(w * 0.66, ay, 0.8, ah, 'attic')
      } else hole(w / 2, ay, Math.min(1.0, w * 0.18), ah, 'attic')
    }
    const front = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false, curveSegments: 6 })
    front.translate(0, 0, -0.35)
    uvScale(front, painted ? 1 / 3 : 1 / 2)
    B.add(wallMat, tint(place(front), col))
    // a dark-painted plinth over the basement
    if (rand() < 0.6) {
      const pl = new THREE.Shape()
      pl.moveTo(0, 0)
      pl.lineTo(w, 0)
      pl.lineTo(w, 0.92)
      pl.lineTo(0, 0.92)
      pl.closePath()
      for (let b = 0; b < nW; b++) {
        if (b === doorBay) continue
        const cx = (b + 0.5) * bay
        const h = new THREE.Path()
        h.moveTo(cx - ww / 2, 0.18)
        h.lineTo(cx - ww / 2, 0.78)
        h.lineTo(cx + ww / 2, 0.78)
        h.lineTo(cx + ww / 2, 0.18)
        h.closePath()
        pl.holes.push(h)
      }
      const pg = uvScale(new THREE.ExtrudeGeometry(pl, { depth: 0.04, bevelEnabled: false }), 1 / 3)
      B.add(plaster, tint(place(pg), [0.09, 0.1, 0.1]))
    }

    // the body behind, its roof running back from the gable
    B.add(brick, tint(place(boxGeo(THREE, w, Hw, d - 0.35, [2, 2], w / 2, 0, -0.35 - (d - 0.35) / 2)), painted ? BRICKS[0] : col.map((v) => v * 0.9)))
    const rh = type === 'cornice' ? w * 0.42 : Math.min(gable.top * 0.92, w * 0.8)
    const rs = new THREE.Shape()
    rs.moveTo(-0.15, 0)
    rs.lineTo(w + 0.15, 0)
    rs.lineTo(w / 2, rh)
    rs.closePath()
    const roof = new THREE.ExtrudeGeometry(rs, { depth: d - (type === 'cornice' ? 1.6 : 0.6), bevelEnabled: false })
    roof.translate(0, Hw, -d + 0.1)
    B.add(roofMat, place(uvScale(roof, 0.5)))

    // white sandstone coping round the gable, cornices, a band over the ground floor
    const pts = gable.pts
    if (type === 'cornice') {
      B.add(white, place(new THREE.BoxGeometry(w + 0.1, 0.5, 0.55).translate(w / 2, Hw + 0.55, 0.1)))
      B.add(white, place(new THREE.BoxGeometry(w + 0.3, 0.14, 0.75).translate(w / 2, Hw + 0.86, 0.15)))
      B.add(white, place(new THREE.BoxGeometry(w, 0.9, 0.04).translate(w / 2, Hw + 0.45, 0.02)))
    } else {
      const cop = []
      let prev = [w, 0]
      for (const p of [...pts, [0, 0]]) {
        const dx = p[0] - prev[0]
        const dy = p[1] - prev[1]
        const len = Math.hypot(dx, dy)
        if (len > 0.05 && !(p[1] === 0 && prev[1] === 0)) {
          cop.push(new THREE.BoxGeometry(len + 0.1, 0.14, 0.46).rotateZ(Math.atan2(dy, dx)).translate((p[0] + prev[0]) / 2, Hw + (p[1] + prev[1]) / 2, -0.17))
        }
        prev = p
      }
      if (cop.length) B.add(white, place(mergeGeometries(cop, false)))
      // the hoist beam with its hook
      if (gable.hoist) {
        const hb = P(w / 2, Hw + gable.hoist, 0)
        const ho = P(w / 2, Hw + gable.hoist, 1.05)
        iron.add(hb, ho, 0.16, 0.2)
        iron.add(ho, P(w / 2, Hw + gable.hoist - 0.5, 1.0), 0.03, 0.03)
      }
    }
    if (!painted && rand() < 0.55) B.add(white, place(new THREE.BoxGeometry(w, 0.26, 0.16).translate(w / 2, GH + 0.05, 0.06)))
    // the stoep: hardstone steps up to the door, a little iron railing
    const dcx = (doorBay + 0.5) * bay
    for (let k = 0; k < 3; k++) {
      const top = 0.95 - k * 0.3
      B.add(plaster, tint(place(boxGeo(THREE, 1.7, top - 0.12, 0.36, [3, 3], dcx, 0.12, 0.18 + k * 0.36)), stoneTint))
    }
    const rx = doorBay === 0 ? dcx + 0.85 : dcx - 0.85
    iron.add(P(rx, 1.95, 0.05), P(rx, 1.0, 1.15), 0.035, 0.035)
    iron.add(P(rx, 0.12, 1.15), P(rx, 1.0, 1.15), 0.035, 0.035)
    // a bike or two leaning on the front
    if (rand() < 0.45) {
      const bx = doorBay === 0 ? w * 0.7 : w * 0.3
      const p = P(bx, 0.12, 0.45)
      bikeSpots.push({ x: p.x, y: 0.12, z: p.z, ry: rand() < 0.5 ? 0 : Math.PI })
    }
  }

  for (const side of [-1, 1]) {
    let x = -reach
    while (x < reach) {
      let w = range(rand, 5.2, 9.2)
      // leave the cross street at each bridge open: fit a narrower house, or jump the street
      const bx = BRIDGES.find((b) => x + w > b - BRIDGE_W / 2 - 1.5 && x < b + BRIDGE_W / 2 + 1.5)
      if (bx !== undefined) {
        const limit = bx - BRIDGE_W / 2 - 1.5
        if (limit - x >= 4.6) w = limit - x - 0.02
        else {
          x = bx + BRIDGE_W / 2 + 1.6
          continue
        }
      }
      // the canal-green house straight across from where Evan & Inez sat (photo 1)
      house(side, x, w, side > 0 && x <= -3 && x + w > -3 ? [0.17, 0.33, 0.24] : null)
      x += w + 0.02
    }
  }

  // windows and doors: glass (instanced, each a little different), frames, iron
  {
    const pg = new THREE.PlaneGeometry(1, 1)
    const glass = new THREE.InstancedMesh(pg, glassMat, panes.length)
    const m = new THREE.Matrix4()
    const qq = new THREE.Quaternion()
    const yAx = new THREE.Vector3(0, 1, 0)
    const c = new THREE.Color()
    panes.forEach((p, i) => {
      qq.setFromAxisAngle(yAx, p.ry)
      m.compose(p.p, qq, new THREE.Vector3(p.w, p.h, 1))
      glass.setMatrixAt(i, m)
      // dark glass reflecting the sky; some with curtains or a lit lamp behind
      const k = p.c
      glass.setColorAt(i, rand() < 0.15 ? c.setRGB(0.55 * k, 0.48 * k, 0.4 * k) : c.setRGB(0.09 * k, 0.1 * k, 0.11 * k))
    })
    glass.receiveShadow = true
    scene.add(glass)
    const doorMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.08), lacquer, doors.length)
    doors.forEach((d, i) => {
      qq.setFromAxisAngle(yAx, d.ry)
      m.compose(d.p, qq, new THREE.Vector3(d.w, d.h, 1))
      doorMesh.setMatrixAt(i, m)
      doorMesh.setColorAt(i, c.setHex(d.c))
    })
    doorMesh.castShadow = true
    scene.add(doorMesh)
    scene.add(frames.white.build(white))
    if (frames.green.size) scene.add(frames.green.build(darkGreen))
  }

  /* --- the bridges: a brick arch, a white stone ring, green iron rails ---- */
  const HUMP = 1.1
  const BR = STRIP + 0.4 // the ramps start on the streets
  const hump = (z) => (Math.abs(z) >= BR ? 0 : HUMP * (1 - (z / BR) ** 2))
  const greenRails = beamBatch(THREE)
  const leafy = new THREE.MeshStandardMaterial({ color: 0x4f6e2e, roughness: 0.8, flatShading: true })
  const lampSpots = []
  const planters = []
  const extrudeX = (shape, width, tile) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 20 })
    g.rotateY(-Math.PI / 2)
    g.translate(width / 2, 0, 0)
    return uvScale(g, 1 / tile)
  }
  for (const bx of BRIDGES) {
    const SPAN = 5.4
    const RISE = 1.2
    const SPRING = WATER_Y + 0.15
    const s = new THREE.Shape()
    s.moveTo(-BR - 0.5, WATER_Y - 2.4)
    s.lineTo(BR + 0.5, WATER_Y - 2.4)
    s.lineTo(BR + 0.5, -0.02)
    for (let i = 20; i >= -20; i--) {
      const z = (i / 20) * BR
      s.lineTo(z, hump(z))
    }
    s.lineTo(-BR - 0.5, -0.02)
    s.closePath()
    const arch = new THREE.Path()
    arch.moveTo(SPAN, WATER_Y - 2)
    arch.lineTo(SPAN, SPRING)
    arch.absellipse(0, SPRING, SPAN, RISE, 0, Math.PI, false)
    arch.lineTo(-SPAN, WATER_Y - 2)
    arch.closePath()
    s.holes.push(arch)
    B.add(brick, tint(extrudeX(s, BRIDGE_W, 2).translate(bx, 0, 0), [0.62, 0.44, 0.38]))
    // the white stone ring round the arch, on both faces
    const ring = new THREE.Shape()
    const T = 0.42
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI
      ring[i ? 'lineTo' : 'moveTo'](Math.cos(a) * (SPAN + T), SPRING + Math.sin(a) * (RISE + T))
    }
    for (let i = 24; i >= 0; i--) {
      const a = (i / 24) * Math.PI
      ring.lineTo(Math.cos(a) * SPAN, SPRING + Math.sin(a) * RISE)
    }
    ring.closePath()
    for (const sx of [-1, 1]) B.add(white, extrudeX(ring, 0.1, 1).translate(bx + sx * (BRIDGE_W / 2 + 0.05), 0, 0))
    // the deck: klinkers following the hump
    const deck = new THREE.PlaneGeometry(BRIDGE_W - 0.6, BR * 2, 1, 24)
    deck.rotateX(-Math.PI / 2)
    const dp = deck.attributes.position
    for (let i = 0; i < dp.count; i++) dp.setY(i, hump(dp.getZ(i)) + 0.03)
    const duv = deck.attributes.uv
    for (let i = 0; i < duv.count; i++) duv.setXY(i, (duv.getX(i) * (BRIDGE_W - 0.6)) / 3, (duv.getY(i) * BR * 2) / 3)
    deck.computeVertexNormals()
    deck.translate(bx, 0, 0)
    B.add(klinker, deck)
    // stone edge beams and the iron railings on them
    for (const sx of [-1, 1]) {
      const e = new THREE.Shape()
      e.moveTo(-BR, -0.45)
      for (let i = -20; i <= 20; i++) e.lineTo((i / 20) * BR, hump((i / 20) * BR) - 0.45)
      for (let i = 20; i >= -20; i--) e.lineTo((i / 20) * BR, hump((i / 20) * BR) + 0.14)
      e.closePath()
      const ex = bx + sx * (BRIDGE_W / 2 - 0.25)
      B.add(plaster, tint(extrudeX(e, 0.55, 3).translate(ex, 0, 0), [0.62, 0.6, 0.56]))
      let prev = null
      for (let z = -BR + 0.3; z <= BR - 0.3 + 1e-6; z += (2 * BR - 0.6) / 14) {
        const y0 = hump(z) + 0.14
        const p0 = new THREE.Vector3(ex, y0, z)
        const p1 = new THREE.Vector3(ex, y0 + 1.0, z)
        greenRails.add(p0, p1, 0.09, 0.09)
        greenRails.add(new THREE.Vector3(ex, y0, z), new THREE.Vector3(ex, y0 + 0.18, z), 0.16, 0.16)
        if (prev) {
          greenRails.add(prev[1], p1, 0.06, 0.07)
          greenRails.add(prev[0].clone().setY(prev[0].y + 0.45), p0.clone().setY(y0 + 0.45), 0.04, 0.04)
        }
        prev = [p0, p1]
        // bikes locked to the rail, all along
        if (Math.abs(z) < BR - 1 && rand() < (low ? 0.4 : 0.75)) {
          bikeSpots.push({ x: ex - sx * 0.32, y: hump(z) + 0.02, z: z + range(rand, -0.3, 0.3), ry: Math.PI / 2 + (rand() < 0.5 ? 0 : Math.PI), lean: sx * 0.12 })
        }
      }
      planters.push(new THREE.Vector3(ex - sx * 0.1, hump(-2) + 1.15, -2), new THREE.Vector3(ex - sx * 0.1, hump(3) + 1.15, 3))
      lampSpots.push({ x: ex + sx * 0.05, y: hump(BR - 0.8) + 0.14, z: -(BR - 0.8) }, { x: ex + sx * 0.05, y: hump(BR - 0.8) + 0.14, z: BR - 0.8 })
    }
  }
  scene.add(greenRails.build(ironGreen))
  // flower boxes hung on the bridge rails
  for (const p of planters) {
    B.add(darkGreen, new THREE.BoxGeometry(0.5, 0.35, 1.4).translate(p.x, p.y, p.z))
    for (let k = 0; k < 4; k++) B.add(leafy, new THREE.IcosahedronGeometry(0.28, 0).translate(p.x, p.y + 0.3, p.z - 0.5 + k * 0.33))
  }

  /* --- trees, cars, bikes, bollards, lamps along the quays ---------------- */
  const clear = {
    '-1': [
      [-12, 18],
    ],
    1: [
      [-47, -36],
      [-100, -80],
      [54, 64],
    ],
  }
  const isClear = (side, x, pad = 0) => clear[side].some(([a, b]) => x > a - pad && x < b + pad) || BRIDGES.some((bx) => Math.abs(x - bx) < BRIDGE_W / 2 + 2 + pad)
  const treeSpots = []
  const carSpots = []
  const bollards = []
  for (const side of [-1, 1]) {
    const tz = side * (W + 1.4)
    const xs = []
    for (let x = -reach; x <= reach; x += range(rand, 9.5, 12)) if (!isClear(side, x, 1)) xs.push(x)
    if (side > 0) xs.push(4.5) // the tree on the right of the hero photograph
    xs.sort((a, b) => a - b)
    for (const x of xs) treeSpots.push({ x, y: 0, z: tz + range(rand, -0.15, 0.15), h: range(rand, 17, 22) })
    for (let i = 0; i < xs.length - 1; i++) {
      const mid = (xs[i] + xs[i + 1]) / 2
      if (i % 3 === 1) lampSpots.push({ x: xs[i] + 1.0, z: side * (W + 0.6) })
      if (xs[i + 1] - xs[i] > 7.5 && rand() < 0.6 && !isClear(side, mid, 3)) carSpots.push({ x: mid, z: side * (W + 1.35), ry: 0 })
      else if (i % 3 !== 1 && rand() < 0.7 && !isClear(side, mid, 1)) {
        // bikes against the tree or parked on the strip
        for (let k = 0; k < 1 + Math.floor(rand() * 3); k++) bikeSpots.push({ x: xs[i] + 1.2 + k * 0.7, y: 0, z: side * (W + 1.9), ry: Math.PI / 2 + range(rand, -0.15, 0.15) })
      }
    }
    for (let x = -reach; x < reach; x += 1.75) if (!BRIDGES.some((bx) => Math.abs(x - bx) < BRIDGE_W / 2 + 1)) bollards.push({ x, y: 0.12, z: side * (ROAD + 0.3) })
  }
  // big leafy limes; a second, smaller planting at the same spots fills the crowns out
  addForest(THREE, scene, treeSpots, { species: 'lime', seed: 12, quality: q })
  if (!low) addForest(THREE, scene, treeSpots.map((t) => ({ x: t.x + 0.3, y: 0, z: t.z - Math.sign(t.z) * 0.4, h: t.h * 0.82 })), { species: 'lime', seed: 29, quality: q })
  addCars(THREE, scene, carSpots, 31)
  addBikes(THREE, scene, low ? bikeSpots.filter((_, i) => i % 2 === 0) : bikeSpots, 41)
  addBollards(THREE, scene, low ? bollards.filter((_, i) => i % 2 === 0) : bollards)
  addLamps(THREE, scene, lampSpots)
  scene.add(iron.build(new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.5, metalness: 0.5 })))

  /* --- boats: sloops and houseboats along the walls ----------------------- */
  const sloops = [{ x: -4, z: W - 1.25, ry: 0.02, len: 6.6, hull: 0x1c1f22, band: 0xa8322a }]
  const houseboats = [
    { x: -118, z: -(W - 2.6), len: 20 },
    { x: -92, z: -(W - 2.6), len: 18 },
    { x: 105, z: W - 2.6, len: 19 },
  ]
  for (const side of [-1, 1]) {
    for (let x = -reach + 6; x < reach - 6; x += range(rand, 7, 16)) {
      if (BRIDGES.some((bx) => Math.abs(x - bx) < BRIDGE_W / 2 + 4)) continue
      if (houseboats.some((h) => Math.sign(h.z) === side && Math.abs(x - h.x) < h.len / 2 + 4)) continue
      if (side > 0 && Math.abs(x + 4) < 8) continue
      if (side < 0 && x > -14 && x < 20) continue // keep the hero's near wall clear
      if (rand() < 0.35) continue
      sloops.push({ x, z: side * (W - 1.25 - range(rand, 0, 0.3)), ry: range(rand, -0.04, 0.04) + (rand() < 0.5 ? 0 : Math.PI), len: range(rand, 5.4, 7.6), covered: rand() < 0.3 })
    }
  }
  addSloops(THREE, scene, sloops, 51)
  addHouseboats(THREE, B, houseboats, {
    steel: new THREE.MeshStandardMaterial({ color: 0x1d2022, roughness: 0.6, metalness: 0.4 }),
    cabinA: new THREE.MeshStandardMaterial({ color: 0x3e5a4a, roughness: 0.7 }),
    cabinB: new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.75 }),
    cabinC: new THREE.MeshStandardMaterial({ color: 0x2c3a52, roughness: 0.7 }),
    glass: glassMat,
    roof: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 }),
    planter: wood,
    leaf: leafy,
  })

  /* --- the city beyond: back rows, the canal running on, cross streets ---- */
  {
    const fac = M.facade(THREE, {
      wall: 'brick',
      color: '#6e3a2a',
      mortar: '#9c8a78',
      frame: '#efe9dd',
      bay: 2.6,
      storey: 3.2,
      window: { w: 0.5, h: 0.62, bars: 'sash', sill: true, lintel: true },
      curtains: 0.3,
      quality: q,
      seed: 61,
    })
    const sizes = [
      [7.8, 16, 14],
      [10.4, 13, 14],
      [6.5, 19, 14],
    ]
    const lists = sizes.map(() => [])
    const put = (x, z, ry) => lists[Math.floor(rand() * sizes.length)].push({ x, z, ry })
    // rows behind the canal houses, and further streets
    for (const side of [-1, 1]) {
      for (const zc of [48, 78, 112, 150, 196]) {
        if (low && zc > 120) continue
        for (let x = -reach - 120; x < reach + 120; x += range(rand, 7, 10.5)) {
          if (BRIDGES.some((bx) => Math.abs(x - bx) < BRIDGE_W / 2 + 4)) continue
          put(x, side * (zc + range(rand, -1, 1)), side > 0 ? Math.PI : 0)
        }
      }
      // the canal running on beyond the detailed houses, both ways
      for (const dir of [-1, 1]) {
        for (let x = reach + 2; x < reach + (low ? 200 : 380); x += range(rand, 6.5, 10.5)) put(dir * x, side * (FRONT + 7), side > 0 ? Math.PI : 0)
      }
    }
    const m = new THREE.Matrix4()
    const qq = new THREE.Quaternion()
    const yAx = new THREE.Vector3(0, 1, 0)
    sizes.forEach(([w, h, d], si) => {
      const list = lists[si]
      if (!list.length) return
      const body = new THREE.InstancedMesh(M.box(THREE, w, h, d, fac.material, fac.tile).geometry, fac.material, list.length)
      const rs = new THREE.Shape()
      rs.moveTo(-w / 2 - 0.1, 0)
      rs.lineTo(w / 2 + 0.1, 0)
      rs.lineTo(0, w * 0.7)
      rs.closePath()
      const rg = uvScale(new THREE.ExtrudeGeometry(rs, { depth: d, bevelEnabled: false }), 0.5).translate(0, h, -d / 2)
      const roofs = new THREE.InstancedMesh(rg, roofMat, list.length)
      const gableG = new THREE.ExtrudeGeometry(gableShapeSimple(THREE, w, rand), { depth: 0.3, bevelEnabled: false })
      uvScale(gableG, 0.5).translate(-w / 2, h, d / 2 - 0.3)
      const gables = new THREE.InstancedMesh(tint(gableG, [0.55, 0.38, 0.32]), brick, list.length)
      list.forEach((b, i) => {
        qq.setFromAxisAngle(yAx, b.ry)
        const k = range(rand, 0.85, 1.12)
        m.compose(new THREE.Vector3(b.x, 0, b.z), qq, new THREE.Vector3(1, k, 1))
        body.setMatrixAt(i, m)
        m.compose(new THREE.Vector3(b.x, h * (k - 1), b.z), qq, new THREE.Vector3(1, 1, 1))
        roofs.setMatrixAt(i, m)
        gables.setMatrixAt(i, m)
      })
      for (const mesh of [body, roofs, gables]) {
        mesh.receiveShadow = true
        scene.add(mesh)
      }
    })
  }

  /* --- beyond the ring: the Zaanse Schans (photos 7–8) and the Amstel (bobbi.intl) --- */
  const extras = {
    white,
    roofMat,
    glassMat,
    rand,
    low,
    q,
    water,
    klinker,
    brick,
    plaster,
    leafy,
    planter: wood,
    lawnMat: M.lawn(THREE, { color: '#76903f', worn: 0.22, tile: 4, quality: q, seed: 91 }),
    redRoof: M.roof(THREE, { kind: 'tiles', color: '#a8452c', tile: 2, quality: q, seed: 92 }),
    shutter: new THREE.MeshStandardMaterial({ color: 0x1d3b2a, roughness: 0.5 }),
    ironDark: new THREE.MeshStandardMaterial({ color: 0x1a1c1d, roughness: 0.45, metalness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x1d2022, roughness: 0.6, metalness: 0.4 }),
    boatRoof: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 }),
    cabins: [0x3e5a4a, 0x6b4a32, 0x2c3a52, 0xe4dfd2].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })),
  }
  const zs = zaanse(THREE, scene, B, extras)
  const am = amstel(THREE, scene, B, extras)
  addForest(THREE, scene, low ? zs.trees.filter((_, i) => i % 2 === 0) : zs.trees, { species: 'poplar', seed: 33, quality: q })
  addForest(THREE, scene, am.trees, { species: 'lime', season: 'autumn', seed: 35, quality: q })

  B.flush()

  /* --- viewpoints --------------------------------------------------------- */
  const spot = (px, py, pz, lx, ly, lz) => ({ pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz) })
  // One viewpoint per photograph (Evan & Inez 1–8 → spots 0–7; bobbi.intl 11 → spot 8)
  const spots = [
    // 0 · photo 1: behind the couple on the quay edge, across the water to the moored sloop and the green house
    spot(-4, 1.35, -13.4, -3, 7.2, FRONT),
    // 1 · photo 2: low over the water, square on to the bridge's side, bikes along its rail
    spot(21.5, 0.35, -2.5, 30, 0.9, -1.0),
    // 2 · photo 3: low over the water off the south quay, down the canal under the limes
    spot(58, 1.6, -5.5, -60, 4.5, -1),
    // 3 · photo 4: on the far bridge, back along the canal to the first one
    spot(BRIDGES[1], hump(-2) + 1.6, -2, 40, 2.5, 1),
    // 4 · photo 5: on the bridge behind its rail of parked bikes, down the tree-lined canal
    spot(31.9, hump(1) + 1.6, 1, -120, 3.2, 0),
    // 5 · photo 6: on the bridge, close, the south houses behind
    spot(37, hump(-4.5) + 1.6, -4.5, 22, 3.6, -21),
    // 6 · photo 7: in the meadow at the Zaanse Schans, the windmills along the dyke
    spot(815, 1.45, 12, 905, 11, -19),
    // 7 · photo 8: by the little green bridge, the green wooden house behind
    spot(703.6, 1.25, 28.2, 690, 3.6, 41),
    // 8 · bobbi.intl photo 11: on the bridge over the Amstel, down the river past the houseboats
    spot(-652, 1.8, -20.4, -676, -3.5, -220),
  ]
  world.focusShadows(new THREE.Vector3(-20, 5, 0), 78)
  const zones = [
    { at: [-20, 0], c: new THREE.Vector3(-20, 5, 0), r: 78 },
    { at: [740, 15], c: new THREE.Vector3(790, 2, 5), r: 110 },
    { at: [-650, -20], c: new THREE.Vector3(-660, 2, -80), r: 95 },
  ]
  let zone = 0

  const path = {
    positions: [
      new THREE.Vector3(-280, 70, -40),
      new THREE.Vector3(-160, 28, 0),
      new THREE.Vector3(-70, 6, -2),
      new THREE.Vector3(-16, 2.6, -8),
      spots[0].pos.clone(),
    ],
    targets: [
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(20, 4, 0),
      new THREE.Vector3(10, 5, 8),
      new THREE.Vector3(-3, 6.5, 21),
      spots[0].look.clone(),
    ],
    fov: 50,
    near: 0.2,
    spots,
  }

  return {
    scene,
    world,
    path,
    update(t) {
      for (const f of tickers) f(t)
      for (const s of zs.sails) s.pivot.rotation.z = -t * s.speed
      const cam = this && this.camera
      if (cam) {
        let best = 0
        let bd = Infinity
        zones.forEach((z, i) => {
          const d = (cam.position.x - z.at[0]) ** 2 + (cam.position.z - z.at[1]) ** 2
          if (d < bd) {
            bd = d
            best = i
          }
        })
        if (best !== zone) {
          zone = best
          world.focusShadows(zones[best].c, zones[best].r)
        }
      }
    },
  }
}

/** A simple stepped or spout gable for the background houses. */
function gableShapeSimple(THREE, w, rand) {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.lineTo(w, 0)
  if (rand() < 0.5) {
    s.lineTo(w, w * 0.2)
    s.lineTo(w * 0.8, w * 0.2)
    s.lineTo(w * 0.8, w * 0.4)
    s.lineTo(w * 0.6, w * 0.4)
    s.lineTo(w * 0.6, w * 0.62)
    s.lineTo(w * 0.4, w * 0.62)
    s.lineTo(w * 0.4, w * 0.4)
    s.lineTo(w * 0.2, w * 0.4)
    s.lineTo(w * 0.2, w * 0.2)
    s.lineTo(0, w * 0.2)
  } else {
    s.lineTo(w * 0.5, w * 0.7)
  }
  s.closePath()
  return s
}
