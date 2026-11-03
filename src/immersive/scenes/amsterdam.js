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
      new THREE.CylinderGeometry(0.075, 0.095, 0.82, 10).translate(0, 0.41, 0),
      new THREE.TorusGeometry(0.085, 0.018, 4, 12).rotateX(Math.PI / 2).translate(0, 0.62, 0),
      new THREE.SphereGeometry(0.085, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.82, 0),
    ].map((g) => g.toNonIndexed()),
    false
  )
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a2219, roughness: 0.55, metalness: 0.3 }), spots.length)
  const m = new THREE.Matrix4()
  spots.forEach((s, i) => mesh.setMatrixAt(i, m.makeTranslation(s.x, s.y || 0, s.z)))
  mesh.castShadow = true
  scene.add(mesh)
}

/* --- the scene ---------------------------------------------------------- */

export function buildAmsterdam(THREE, ctx, { light = 'golden' } = {}) {
  const world = createWorld(THREE, ctx, light, {
    // late afternoon: a low sun from the south-west rakes the north quay's fronts
    sun: { elevation: 15, azimuth: 218 },
    fog: { density: 0.0016 },
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
  const water = waterMaterial(THREE, { palette: { ...world.light, water: { deep: 0x2f3a2c, shallow: 0x5e6a4c, stroke: 0xffe9c8 } }, scale: 0.32, strokes: 0.6 })
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

  function house(side, xa, w) {
    const ry = side > 0 ? Math.PI : 0
    const x0 = side > 0 ? xa + w : xa
    const z0 = side * FRONT
    // local (x along the facade, y up, z out toward the canal) → world
    const P = (lx, ly, lz) => new THREE.Vector3(side > 0 ? x0 - lx : x0 + lx, ly, side > 0 ? z0 - lz : z0 + lz)
    const place = (geo) => {
      if (ry) geo.rotateY(ry)
      return geo.translate(x0, 0, z0)
    }
    const painted = rand() < 0.22
    const col = painted ? pick(rand, PAINTS) : pick(rand, BRICKS)
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
      house(side, x, w)
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

  B.flush()

  /* --- viewpoints --------------------------------------------------------- */
  const spot = (px, py, pz, lx, ly, lz) => ({ pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz) })
  const spots = [
    // 0 · sitting on the quay edge: across the water, the moored sloop and the houses
    spot(-4, 1.35, -13.4, -3, 7.2, FRONT),
    // 1 · on the bridge, looking down the canal between the trees
    spot(BRIDGES[0], hump(-3.5) + 1.7, -3.5, -120, 4.5, 0.5),
    // 2 · on the quay by the bridge: its arch, the bikes on its rails, the houses behind
    spot(14, 1.6, -12.2, BRIDGES[0], 2, 1),
    // 3 · the far quay, looking back across at the south houses
    spot(60, 1.7, 13.4, -20, 6.5, -FRONT),
    // 4 · from a first-floor window, along the canal
    spot(-40, 6.5, 19, 40, 3, -2),
    // 5 · low on the water, as from a passing boat
    spot(-45, 1.4, 3, 40, 2.8, 0),
    // 6 · under the limes on the north quay, the gables across the water
    spot(-90, 1.65, 12.9, -70, 6.5, -FRONT),
    // 7 · on the second bridge, back along the canal toward the first
    spot(BRIDGES[1], hump(2) + 1.7, 2, 0, 4, 0),
  ]
  world.focusShadows(new THREE.Vector3(-20, 5, 0), 78)

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
