/**
 * Paris — the Trocadéro on a soft, overcast morning.
 *
 * The Eiffel Tower is a real lattice (four curved legs of square lattice
 * tubes merging into one shaft, the great arches, platforms with their
 * frieze) in "Eiffel Tower brown". Across the Seine: the Pont d'Iéna on five
 * stone arches, the Trocadéro gardens with the long Varsovie basin and its
 * water cannons, the terrace and the great lateral flights of stairs with
 * their solid stone parapets (where Evan & Inez were photographed), the
 * parvis and the two curved colonnaded wings of the Palais de Chaillot.
 * Around it: Haussmann blocks (limestone, wrought-iron balconies on the 2nd
 * and 5th floors, zinc mansards, chimneys), streets with kerbs, lamps,
 * parked cars and café awnings, plane trees, the Champ de Mars.
 *
 * Metres. The tower stands at the origin; the Trocadéro is toward +Z, the
 * Seine runs along X between z = 180 and z = 290.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createWorld, waterMaterial } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { beamBatch, paintTexture, seeded, range, pick } from '../utils.js'
import { NO_INK_LAYER } from '../post.js'

/* --- levels of the site ------------------------------------------------ */

const RIVER_S = 180 // south quay wall (tower side)
const RIVER_N = 290 // north quay wall (Trocadéro side)
const WATER_Y = -5
const BERGE_Y = -3.6 // the low quays along the water
const PARVIS_Y = 20
const TERRACE_Y = 12
const FLIGHT = { x0: 55, x1: 77.5, z0: 686, z1: 700 } // lateral flights (mirrored in x)
const GARDEN_TOP = 600 // terrace balustrade
const GARDEN_FOOT = 520 // bottom of the sloped lawns
const STREET_Z = -60 // the Haussmann street west of the Champ de Mars
const STREET_HALF = 12 // facade to facade 24 m

/* --- small helpers -------------------------------------------------------- */

function uvScale(geo, s) {
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s)
  uv.needsUpdate = true
  return geo
}

/** A profile (shape in the z–y plane: shape x → world z) extruded along world x, centred on x = 0. */
function extrudeAlongX(THREE, shape, width, tile, curveSegments = 16) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments })
  geo.rotateY(-Math.PI / 2) // shape x → world z, extrusion → world −x
  geo.translate(width / 2, 0, 0)
  return uvScale(geo, 1 / tile)
}

/** Collect geometries per material, merge them into one mesh each. */
function batcher(THREE, scene) {
  const lists = new Map()
  return {
    add(material, geo) {
      if (!lists.has(material)) lists.set(material, [])
      lists.get(material).push(geo.index ? geo.toNonIndexed() : geo)
    },
    /** A materials.js box (UVs in metres), placed. */
    box(material, tile, w, h, d, x, y, z, ry = 0) {
      const g = M.box(THREE, w, h, d, material, tile).geometry
      if (ry) g.rotateY(ry)
      g.translate(x, y, z)
      this.add(material, g)
    },
    flush({ shadow = true } = {}) {
      lists.forEach((geos, mat) => {
        const keep = geos.map((g) => {
          // ExtrudeGeometry has groups and no index; strip groups so merging is clean
          g.clearGroups()
          for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k)
          return g
        })
        const mesh = new THREE.Mesh(mergeGeometries(keep, false), mat)
        mesh.castShadow = shadow
        mesh.receiveShadow = true
        scene.add(mesh)
      })
      lists.clear()
    },
  }
}

/* --- parked cars ------------------------------------------------------------ */

function addCars(THREE, scene, spots, seed) {
  if (!spots.length) return
  const rand = seeded(seed)
  const body = new RoundedBoxGeometry(4.3, 0.75, 1.78, 3, 0.22).translate(0, 0.62, 0)
  const cabin = new RoundedBoxGeometry(2.35, 0.62, 1.6, 3, 0.18).translate(-0.25, 1.28, 0)
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateX(Math.PI / 2)
  const wheels = mergeGeometries(
    [
      [1.38, 0.82],
      [1.38, -0.82],
      [-1.32, 0.82],
      [-1.32, -0.82],
    ].map(([x, z]) => wheel.clone().translate(x, 0.33, z)),
    false
  )
  const paint = new THREE.MeshPhysicalMaterial({ roughness: 0.32, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08 })
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x15191d, roughness: 0.05, metalness: 0.6, clearcoat: 1 })
  const tyre = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.85 })
  const mBody = new THREE.InstancedMesh(body, paint, spots.length)
  const mCab = new THREE.InstancedMesh(cabin, glass, spots.length)
  const mWheel = new THREE.InstancedMesh(wheels, tyre, spots.length)
  const cols = [0x1c1d20, 0xd9d9d6, 0x8d9194, 0x2b3a55, 0x5a1e1e, 0xe8e6e0, 0x3b3f44, 0x6c6f73, 0x24402f]
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const c = new THREE.Color()
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry || 0)
    const k = range(rand, 0.9, 1.08)
    m.compose(new THREE.Vector3(s.x, s.y || 0, s.z), q, new THREE.Vector3(k, 1, 1))
    mBody.setMatrixAt(i, m)
    mCab.setMatrixAt(i, m)
    mWheel.setMatrixAt(i, m)
    mBody.setColorAt(i, c.setHex(pick(rand, cols)))
  })
  for (const mesh of [mBody, mCab, mWheel]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
  }
}

/* --- Paris lamps: cast-iron candelabra with a lantern ------------------------- */

function addParisLamps(THREE, scene, spots, { double = false } = {}) {
  if (!spots.length) return
  const parts = [
    new THREE.CylinderGeometry(0.2, 0.26, 0.9, 10).translate(0, 0.45, 0), // fluted base
    new THREE.CylinderGeometry(0.07, 0.11, 3.6, 8).translate(0, 2.6, 0),
    new THREE.SphereGeometry(0.13, 8, 6).translate(0, 4.45, 0),
  ]
  const lanterns = []
  const arms = double ? [-0.55, 0.55] : [0]
  for (const ax of arms) {
    if (double) parts.push(new THREE.BoxGeometry(Math.abs(ax) + 0.05, 0.06, 0.06).translate(ax / 2, 4.5, 0))
    parts.push(new THREE.CylinderGeometry(0.3, 0.12, 0.12, 6).translate(ax, 4.62, 0)) // lantern floor
    parts.push(new THREE.ConeGeometry(0.34, 0.32, 6).translate(ax, 5.38, 0)) // roof
    parts.push(new THREE.SphereGeometry(0.06, 6, 4).translate(ax, 5.6, 0))
    lanterns.push(new THREE.CylinderGeometry(0.29, 0.2, 0.62, 6, 1, true).translate(ax, 4.98, 0))
  }
  const iron = new THREE.MeshStandardMaterial({ color: 0x1e2321, roughness: 0.45, metalness: 0.6 })
  const glass = new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.15, metalness: 0.2, emissive: 0xffe2b0, emissiveIntensity: 0.15, side: THREE.DoubleSide })
  const post = new THREE.InstancedMesh(mergeGeometries(parts.map((g) => g.toNonIndexed()), false), iron, spots.length)
  const lan = new THREE.InstancedMesh(mergeGeometries(lanterns, false), glass, spots.length)
  const m = new THREE.Matrix4()
  spots.forEach((s, i) => {
    m.makeRotationY(s.ry || 0).setPosition(s.x, s.y || 0, s.z)
    post.setMatrixAt(i, m)
    lan.setMatrixAt(i, m)
  })
  post.castShadow = true
  scene.add(post, lan)
}

/* --- the tower --------------------------------------------------------- */

// Half-width of the tower at height h: the legs' outer edge, and the inner
// edge of the legs (the arch opening between them closes at the 2nd floor).
const outer = (h) => (h <= 276 ? 62.5 * Math.exp(-h / 95) + 2 : Math.max(1.4, 5.4 - (h - 276) * 0.12))
const inner = (h) => (h < 115 ? 37.5 * Math.pow(1 - h / 115, 1.35) : 0)

function towerLevels() {
  const hs = []
  for (let i = 0; i < 15; i++) hs.push(i * 3.84) // 0 → 53.8
  hs.push(57.6)
  for (let i = 1; i < 13; i++) hs.push(57.6 + i * 4.8) // → 115.2
  for (let i = 0; i < 27; i++) hs.push(115.7 + i * 6) // → 271.7
  hs.push(276, 286, 296, 304)
  return hs
}

/** The frieze of small arches round each platform. */
function friezeTexture(THREE) {
  return paintTexture(
    THREE,
    512,
    128,
    (g, w, h) => {
      g.fillStyle = '#7b624d'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#90765f'
      g.fillRect(0, 0, w, 12)
      g.fillStyle = '#4a392c'
      g.fillRect(0, 12, w, 4)
      g.fillRect(0, h - 10, w, 10)
      const n = 8
      for (let i = 0; i < n; i++) {
        const cx = (i + 0.5) * (w / n)
        const r = w / n / 2 - 7
        g.fillStyle = '#261d17'
        g.beginPath()
        g.moveTo(cx - r, h - 14)
        g.lineTo(cx - r, 50)
        g.arc(cx, 50, r, Math.PI, 0)
        g.lineTo(cx + r, h - 14)
        g.closePath()
        g.fill()
        g.strokeStyle = 'rgba(150,120,95,0.6)'
        g.lineWidth = 2
        g.beginPath()
        g.moveTo(cx - r, h - 14)
        g.lineTo(cx + r, 50)
        g.moveTo(cx + r, h - 14)
        g.lineTo(cx - r, 50)
        g.moveTo(cx, 50 - r)
        g.lineTo(cx, h - 14)
        g.stroke()
      }
    },
    { kind: 'color' }
  )
}

function buildEiffel(THREE, { low = false } = {}) {
  const group = new THREE.Group()
  // "Eiffel Tower brown": a warm bronze, a little sheen on the paint
  const iron = new THREE.MeshStandardMaterial({ color: 0x7d6049, roughness: 0.58, metalness: 0.32 })
  const beams = beamBatch(THREE)
  const P = (x, y, z) => new THREE.Vector3(x, y, z)
  const levels = towerLevels()
  const panel = low ? 6 : 3.4 // metres per lattice bay

  // one lattice side between two corner rails: X-bracing, verticals, a strut, a girder on top
  function side(a0, b0, a1, b1, h0, h1, heavy) {
    const w = (Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) + Math.hypot(b1[0] - a1[0], b1[1] - a1[1])) / 2
    const n = Math.max(1, Math.min(12, Math.round(w / panel)))
    const at = (p, r, t) => [p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t]
    for (let i = 0; i < n; i++) {
      const l0 = at(a0, b0, i / n)
      const r0 = at(a0, b0, (i + 1) / n)
      const l1 = at(a1, b1, i / n)
      const r1 = at(a1, b1, (i + 1) / n)
      const d = heavy ? 0.3 : 0.22
      beams.add(P(l0[0], h0, l0[1]), P(r1[0], h1, r1[1]), d)
      beams.add(P(r0[0], h0, r0[1]), P(l1[0], h1, l1[1]), d)
      if (i > 0) beams.add(P(l0[0], h0, l0[1]), P(l1[0], h1, l1[1]), heavy ? 0.34 : 0.26)
    }
    if (!low && h1 - h0 > 4.5) {
      const m0 = at(a0, a1, 0.5)
      const m1 = at(b0, b1, 0.5)
      beams.add(P(m0[0], (h0 + h1) / 2, m0[1]), P(m1[0], (h0 + h1) / 2, m1[1]), 0.18)
    }
    beams.add(P(a1[0], h1, a1[1]), P(b1[0], h1, b1[1]), heavy ? 0.55 : 0.4, heavy ? 0.9 : 0.55)
  }

  function tube(corners, from, to, heavy) {
    for (let k = 0; k < levels.length - 1; k++) {
      const h0 = levels[k]
      const h1 = levels[k + 1]
      if (h1 <= from || h0 >= to) continue
      const c0 = corners(h0)
      const c1 = corners(h1)
      for (let s = 0; s < 4; s++) {
        const n = (s + 1) % 4
        side(c0[s], c0[n], c1[s], c1[n], h0, h1, heavy)
        beams.add(P(c0[s][0], h0, c0[s][1]), P(c1[s][0], h1, c1[s][1]), heavy ? 1.5 : 0.8)
      }
    }
  }

  // four legs, each a lattice tube from its pier to the 2nd floor, curving in
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      tube(
        (h) => {
          const o = outer(h)
          const i = inner(h)
          return [
            [sx * i, sz * o],
            [sx * o, sz * o],
            [sx * o, sz * i],
            [sx * i, sz * i],
          ]
        },
        0,
        115.7,
        true
      )
    }
  }
  // the shaft from the 2nd floor to the top
  tube(
    (h) => {
      const o = outer(h)
      return [
        [-o, o],
        [o, o],
        [o, -o],
        [-o, -o],
      ]
    },
    115.7,
    310,
    false
  )

  // the great decorative arches under the 1st floor on each face, with the
  // iron lace of their spandrels
  const faceAt = (rot, x, y, inset) => {
    const z = outer(y) - inset
    return P(x * Math.cos(rot) + z * Math.sin(rot), y, -x * Math.sin(rot) + z * Math.cos(rot))
  }
  for (let f = 0; f < 4; f++) {
    const rot = (f * Math.PI) / 2
    const seg = low ? 22 : 36
    const outerArc = []
    const innerArc = []
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI * (i / seg)
      outerArc.push(faceAt(rot, -Math.cos(a) * 37.5, 4 + Math.sin(a) * 37, 1.2))
      innerArc.push(faceAt(rot, -Math.cos(a) * 35, 4 + Math.sin(a) * 34.4, 1.2))
    }
    for (let i = 0; i < seg; i++) {
      beams.add(outerArc[i], outerArc[i + 1], 1.0, 1.3)
      beams.add(innerArc[i], innerArc[i + 1], 0.7, 1.0)
      beams.add(outerArc[i], innerArc[i + 1], 0.22)
      beams.add(innerArc[i], outerArc[i + 1], 0.22)
    }
    for (let i = 1; i < seg; i++) {
      const p = outerArc[i]
      if (p.y > 51) continue
      const x = -Math.cos(Math.PI * (i / seg)) * 37.5
      const top = faceAt(rot, x, 54.2, 1.2)
      beams.add(p, top, 0.26)
      const xn = -Math.cos(Math.PI * ((i + 1) / seg)) * 37.5
      beams.add(p, faceAt(rot, xn, 54.2, 1.2), 0.16)
      // little rings in the spandrels, the tower's lace
      if (!low && i % 3 === 0 && top.y - p.y > 8) {
        const c = p.clone().lerp(top, 0.5)
        const r = Math.min(2.2, (top.y - p.y) / 5)
        const ax = P(Math.cos(rot), 0, -Math.sin(rot))
        for (let k = 0; k < 8; k++) {
          const a0 = (k / 8) * Math.PI * 2
          const a1 = ((k + 1) / 8) * Math.PI * 2
          const q0 = c.clone().addScaledVector(ax, Math.cos(a0) * r).add(P(0, Math.sin(a0) * r, 0))
          const q1 = c.clone().addScaledVector(ax, Math.cos(a1) * r).add(P(0, Math.sin(a1) * r, 0))
          beams.add(q0, q1, 0.14)
        }
      }
    }
  }
  group.add(beams.build(iron))

  // platforms: deck, the frieze of arches round the edge, a railing on top
  const deck = new THREE.MeshStandardMaterial({ color: 0x5d4836, roughness: 0.7, metalness: 0.3 })
  const frieze = friezeTexture(THREE)
  const ring = (h, half, band, deckThick) => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(half * 2 - 1, deckThick, half * 2 - 1), deck)
    slab.position.y = h - band / 2
    slab.castShadow = true
    group.add(slab)
    const tex = frieze.clone()
    tex.wrapS = THREE.RepeatWrapping
    tex.repeat.set(Math.max(2, Math.round((half * 2) / 8)), 1)
    tex.needsUpdate = true
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65, metalness: 0.3 })
    for (let s = 0; s < 4; s++) {
      const sideMesh = new THREE.Mesh(new THREE.BoxGeometry(half * 2, band, 1.2), mat)
      const r = (s * Math.PI) / 2
      sideMesh.position.set(Math.sin(r) * half, h, Math.cos(r) * half)
      sideMesh.rotation.y = r
      sideMesh.castShadow = true
      group.add(sideMesh)
    }
  }
  ring(57.6, outer(57.6) + 3.4, 6.2, 2.2)
  ring(115.7, outer(115.7) + 2.4, 4.2, 1.8)
  // 1st floor glass pavilions, 2nd floor houses (pale, glazed)
  const pav = new THREE.MeshStandardMaterial({ color: 0x8a786a, roughness: 0.25, metalness: 0.4 })
  for (const [x, z, w, d] of [
    [0, 30, 40, 5],
    [0, -30, 40, 5],
    [30, 0, 5, 40],
    [-30, 0, 5, 40],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 4.5, d), pav)
    m.position.set(x, 60.6, z)
    group.add(m)
  }
  const house = new THREE.Mesh(new THREE.BoxGeometry(15, 5.5, 15), pav)
  house.position.y = 119.6
  group.add(house)

  // the top: the enclosed deck, glazing, Eiffel's lantern and antennas
  const top = new THREE.Mesh(new THREE.BoxGeometry(17, 7, 17), deck)
  top.position.y = 279
  group.add(top)
  const glassBand = new THREE.Mesh(new THREE.BoxGeometry(17.4, 2.6, 17.4), new THREE.MeshStandardMaterial({ color: 0x3a434b, roughness: 0.1, metalness: 0.7 }))
  glassBand.position.y = 279.6
  group.add(glassBand)
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 4.4, 12, 16), deck)
  lantern.position.y = 288.5
  group.add(lantern)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(2.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), deck)
  cap.position.y = 294.5
  group.add(cap)
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.9, 30, 8), deck)
  antenna.position.y = 310
  group.add(antenna)
  for (const [x, z, h] of [
    [1.6, 0.8, 9],
    [-1.4, -1.1, 7],
  ]) {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, h, 6), deck)
    a.position.set(x, 297 + h / 2, z)
    group.add(a)
  }
  return group
}

/* --- the scene ---------------------------------------------------------- */

export function buildParis(THREE, ctx, { light = 'overcast' } = {}) {
  const world = createWorld(THREE, ctx, light, {
    // a soft morning sun from the east, behind thin cloud
    sun: { elevation: 30, azimuth: 212 },
    fog: { density: 0.00055 },
    sunIntensity: 1.5,
  })
  const { scene } = world
  const rand = seeded(1889)
  const low = ctx.quality === 'low'
  const B = batcher(THREE, scene)

  /* materials: painted once, shared everywhere */
  const q = ctx.quality
  const stone = M.paving(THREE, { kind: 'flags', color: '#d8cdb6', joint: '#b9ad97', unit: 0.55, variation: 0.06, tile: 4, quality: q, seed: 21 })
  const STONE_T = [4, 4]
  const flags = M.paving(THREE, { kind: 'flags', color: '#d2c8b5', joint: '#9d9483', unit: 0.9, variation: 0.08, tile: 6, quality: q, seed: 22 })
  const asphalt = M.asphalt(THREE, { color: '#46474a', tile: 6, quality: q, seed: 23 })
  const pave = M.paving(THREE, { kind: 'flags', color: '#9f9a92', joint: '#6f6b65', unit: 0.4, tile: 3, quality: q, seed: 24 })
  const lawn = M.lawn(THREE, { color: '#5d7a35', worn: 0.12, stripes: true, tile: 4, quality: q, seed: 25 })
  Object.assign(lawn, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
  const gravel = flags.clone()
  gravel.color = new THREE.Color(0xd9cdb4)
  gravel.polygonOffset = true
  gravel.polygonOffsetFactor = -1
  gravel.polygonOffsetUnits = -2

  /* the ground: the city at y = 0, cut by the Seine */
  for (const [z0, z1] of [
    [-2600, RIVER_S],
    [RIVER_N, 2600],
  ]) {
    const g = M.ground(THREE, 5200, z1 - z0, asphalt, 6)
    g.position.z = (z0 + z1) / 2
    scene.add(g)
  }
  const flat = (mat, tile, x, z, w, d, y = 0.02) => {
    const g = M.ground(THREE, w, d, mat, tile)
    g.position.set(x, y, z)
    scene.add(g)
    return g
  }

  /* the tower */
  scene.add(buildEiffel(THREE, { low }))

  /* --- the Seine, its quays and the Pont d'Iéna --------------------------- */
  const tickers = []
  const seineMat = waterMaterial(THREE, { palette: { ...world.light, water: { deep: 0x4d5852, shallow: 0x73807a, stroke: 0xf2f1ee } }, scale: 0.7, strokes: 0.6 })
  tickers.push((t) => seineMat.userData.tick(t))
  const seine = new THREE.Mesh(new THREE.PlaneGeometry(5200, RIVER_N - RIVER_S), seineMat)
  seine.rotation.x = -Math.PI / 2
  seine.position.set(0, WATER_Y, (RIVER_S + RIVER_N) / 2)
  scene.add(seine)
  const L = 5200
  /** A box running along x the whole length of the river, with a gap |x| < gap. */
  const longBox = (mat, tile, h, d, y, z, gap = 0) => {
    if (!gap) return B.box(mat, tile, L, h, d, 0, y, z)
    const len = L / 2 - gap
    for (const sx of [-1, 1]) B.box(mat, tile, len, h, d, sx * (gap + len / 2), y, z)
  }
  for (const [wallZ, dir] of [
    [RIVER_S, 1],
    [RIVER_N, -1],
  ]) {
    // upper quay wall from the berge up to the street, its coping, and the parapet
    B.box(stone, STONE_T, L, -BERGE_Y, 2, 0, BERGE_Y, wallZ - dir)
    longBox(stone, STONE_T, 0.9, 0.7, 0, wallZ - dir * 0.35, 17.6)
    // the low quay (berge) along the water, and its own wall down into the river
    B.box(flags, [6, 6], L, 0.3, 8, 0, BERGE_Y - 0.3, wallZ + dir * 4)
    B.box(stone, STONE_T, L, BERGE_Y - WATER_Y + 1.2, 0.8, 0, WATER_Y - 1.2, wallZ + dir * 8.4)
  }
  // the river bed, dark, so the water never shows a void
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(L, RIVER_N - RIVER_S), new THREE.MeshBasicMaterial({ color: 0x141815 }))
  bed.rotation.x = -Math.PI / 2
  bed.position.set(0, WATER_Y - 3, (RIVER_S + RIVER_N) / 2)
  scene.add(bed)

  // Pont d'Iéna: five elliptical stone arches on four piers, 35 m wide
  {
    const z0 = RIVER_S - 6
    const z1 = RIVER_N + 6
    const s = new THREE.Shape()
    s.moveTo(z0, WATER_Y - 4)
    s.lineTo(z1, WATER_Y - 4)
    s.lineTo(z1, 0.15)
    s.lineTo(z0, 0.15)
    s.closePath()
    const wz0 = RIVER_S + 8.4
    const wz1 = RIVER_N - 8.4
    const pier = 4.2
    const span = (wz1 - wz0 - pier * 4) / 5
    for (let i = 0; i < 5; i++) {
      const cz = wz0 + span / 2 + i * (span + pier)
      const h = new THREE.Path()
      h.moveTo(cz + span / 2, WATER_Y - 3.5)
      h.lineTo(cz + span / 2, WATER_Y + 0.8)
      h.absellipse(cz, WATER_Y + 0.8, span / 2, 3.4, 0, Math.PI, false)
      h.lineTo(cz - span / 2, WATER_Y - 3.5)
      h.closePath()
      s.holes.push(h)
      // cutwaters on the piers, and the imperial eagles above them
      if (i > 0) {
        const pz = cz - span / 2 - pier / 2
        for (const sx of [-1, 1]) {
          const cut = new THREE.CylinderGeometry(pier / 2, pier / 2, 5.4, 3)
          cut.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2)
          cut.translate(sx * 17.6, WATER_Y + 2.1, pz)
          B.add(stone, uvScale(cut, 0.5))
          const eagle = new THREE.SphereGeometry(0.9, 8, 6)
          eagle.scale(1.2, 1, 0.6)
          eagle.translate(sx * 17.7, -1.3, pz)
          B.add(stone, eagle)
        }
      }
    }
    B.add(stone, extrudeAlongX(THREE, s, 35, 4))
    // deck: asphalt between pale stone pavements, a parapet on both sides
    B.box(asphalt, [6, 6], 22, 0.06, z1 - z0, 0, 0.15, (z0 + z1) / 2)
    for (const sx of [-1, 1]) {
      B.box(pave, [3, 3], 5.4, 0.2, z1 - z0, sx * 14.2, 0.15, (z0 + z1) / 2)
      B.box(stone, STONE_T, 0.7, 1.05, z1 - z0, sx * 17.15, 0.15, (z0 + z1) / 2)
      // the equestrian statues on their pedestals at both ends
      for (const ez of [z0 - 2, z1 + 2]) {
        B.box(stone, STONE_T, 4, 6.5, 8, sx * 15.5, 0, ez)
        const horse = new THREE.CapsuleGeometry(0.9, 2.4, 4, 8).rotateZ(Math.PI / 2)
        horse.translate(sx * 15.5, 8, ez)
        B.add(stone, horse)
        const rider = new THREE.CapsuleGeometry(0.45, 1.2, 4, 8).translate(sx * 15.5, 9.6, ez)
        B.add(stone, rider)
        for (const lz of [-1, 1]) for (const lx of [-0.9, 0.9]) B.add(stone, new THREE.CylinderGeometry(0.18, 0.15, 1.6, 6).translate(sx * 15.5 + lx * 0.5, 7, ez + lz * 1.1 * 0.7))
      }
    }
  }

  // two bateaux-mouches moored on the north berge, a péniche on the south
  {
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e8e3, roughness: 0.45 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.2 })
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x1e262c, roughness: 0.04, metalness: 0.5, clearcoat: 1 })
    const boat = (x, z, len, beam, kind) => {
      const hull = new RoundedBoxGeometry(len, 1.6, beam, 2, 0.5).translate(x, WATER_Y + 0.5, z)
      B.add(kind === 'peniche' ? dark : white, hull)
      if (kind === 'peniche') {
        B.add(white, new THREE.BoxGeometry(8, 2.4, beam - 1).translate(x - len / 2 + 6, WATER_Y + 2.4, z))
        B.add(glass, new THREE.BoxGeometry(8.05, 0.8, beam - 0.9).translate(x - len / 2 + 6, WATER_Y + 2.8, z))
      } else {
        B.add(glass, new THREE.BoxGeometry(len - 6, 1.9, beam - 0.6).translate(x, WATER_Y + 2.2, z))
        B.add(white, new THREE.BoxGeometry(len - 5.6, 0.25, beam - 0.3).translate(x, WATER_Y + 3.25, z))
      }
    }
    boat(-260, RIVER_N - 12.5, 48, 7, 'mouche')
    boat(-205, RIVER_N - 12.5, 40, 6.5, 'mouche')
    boat(230, RIVER_S + 12.6, 38, 5.1, 'peniche')
  }

  // quayside streets: Quai Branly (south) and Avenue de New York (north) — pavements and kerbs
  for (const [z, w] of [
    [RIVER_S - 5, 8],
    [RIVER_S - 33, 6],
    [RIVER_N + 5, 8],
    [RIVER_N + 37, 6],
  ]) {
    longBox(pave, [3, 3], 0.14, w, 0, z, 11.5)
  }

  /* --- the Trocadéro: gardens, basin, terraces, stairs, Chaillot ---------- */
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8ad4c, roughness: 0.28, metalness: 1 })
  const jetMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf4f7fa).multiplyScalar(1.05), transparent: true, opacity: 0.42, depthWrite: false })
  const jets = []
  const statue = (x, y, z, ry = 0, scale = 1) => {
    // a gilded figure on a stone pedestal: body, head, a raised arm
    B.box(stone, STONE_T, 1.6 * scale, 2.2 * scale, 1.6 * scale, x, y, z)
    const top = y + 2.2 * scale
    const fig = [
      new THREE.CapsuleGeometry(0.36, 1.3, 4, 10).translate(0, 1.0, 0),
      new THREE.SphereGeometry(0.22, 10, 8).translate(0, 2.05, 0),
      new THREE.CapsuleGeometry(0.1, 0.8, 3, 6).rotateZ(0.5).translate(0.42, 1.8, 0),
      new THREE.CylinderGeometry(0.45, 0.55, 0.2, 10).translate(0, 0.1, 0),
    ].map((g) => g.scale(scale * 1.25, scale * 1.25, scale * 1.25).rotateY(ry).translate(x, top, z))
    for (const g of fig) B.add(gold, g)
  }

  // lower gardens: gravel walks, lawns, and the long Varsovie basin
  flat(gravel, 6, 0, 425, 280, 190)
  for (const sx of [-1, 1]) flat(lawn, 4, sx * 72, 428, 84, 170, 0.04)
  const BASIN = { x: 22, z0: 360, z1: 505 }
  const basinMat = waterMaterial(THREE, { palette: { ...world.light, water: { deep: 0x5c6c70, shallow: 0x8a9aa0, stroke: 0xf2f1ee } }, scale: 0.18, strokes: 0.4 })
  tickers.push((t) => basinMat.userData.tick(t))
  const basin = new THREE.Mesh(new THREE.PlaneGeometry(BASIN.x * 2, BASIN.z1 - BASIN.z0), basinMat)
  basin.rotation.x = -Math.PI / 2
  basin.position.set(0, 0.32, (BASIN.z0 + BASIN.z1) / 2)
  scene.add(basin)
  for (const sx of [-1, 1]) B.box(stone, STONE_T, 0.9, 0.62, BASIN.z1 - BASIN.z0 + 1.8, sx * (BASIN.x + 0.45), 0, (BASIN.z0 + BASIN.z1) / 2)
  for (const z of [BASIN.z0 - 0.45, BASIN.z1 + 0.45]) B.box(stone, STONE_T, BASIN.x * 2, 0.62, 0.9, 0, 0, z)
  // the water cannons: arcs from both rims toward the axis, and the great
  // cannons at the foot of the basin firing toward the tower
  const arc = (a, mid, b, r) => {
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 18, r, 6), jetMat)
    tube.layers.set(NO_INK_LAYER)
    scene.add(tube)
    jets.push(tube)
  }
  const n = low ? 8 : 14
  for (let i = 0; i < n; i++) {
    const z = BASIN.z0 + 14 + (i / (n - 1)) * (BASIN.z1 - BASIN.z0 - 28)
    for (const sx of [-1, 1]) {
      const a = new THREE.Vector3(sx * (BASIN.x - 0.6), 0.5, z)
      arc(a, new THREE.Vector3(sx * 11, 9, z - 3), new THREE.Vector3(sx * 1.5, 0.35, z - 6), 0.09)
    }
  }
  for (const x of [-12, -6, 0, 6, 12]) {
    arc(new THREE.Vector3(x, 0.6, BASIN.z0 + 4), new THREE.Vector3(x * 1.1, 14, BASIN.z0 - 24), new THREE.Vector3(x * 1.2, 0.35, BASIN.z0 - 46 + Math.abs(x)), 0.16)
  }
  // a spray of mist where the cannons land, sitting in the basin head
  for (const x of [-12, 0, 12]) {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 10, 1, true), jetMat)
    plume.position.set(x, 2.5, BASIN.z0 + 3)
    plume.layers.set(NO_INK_LAYER)
    scene.add(plume)
  }
  // the cannons' landing pool continues as a lower basin toward the avenue
  {
    const lowBasin = new THREE.Mesh(new THREE.PlaneGeometry(36, 30), basinMat)
    lowBasin.rotation.x = -Math.PI / 2
    lowBasin.position.set(0, 0.32, BASIN.z0 - 32)
    scene.add(lowBasin)
    for (const sx of [-1, 1]) B.box(stone, STONE_T, 0.9, 0.62, 31.8, sx * 18.45, 0, BASIN.z0 - 32)
    B.box(stone, STONE_T, 37.8, 0.62, 0.9, 0, 0, BASIN.z0 - 47.45)
  }
  // the gilded bull and deer at the head of the basin
  statue(-24, 0, BASIN.z1 + 4, 0.6, 1.5)
  statue(24, 0, BASIN.z1 + 4, -0.6, 1.5)

  // the sloped lawns up to the terrace, with the central stairs
  const rise = TERRACE_Y / (GARDEN_TOP - GARDEN_FOOT)
  for (const sx of [-1, 1]) {
    const w = 208
    const len = Math.hypot(GARDEN_TOP - GARDEN_FOOT, TERRACE_Y)
    const g = M.ground(THREE, w, len, lawn, 4)
    g.rotation.x = -Math.atan(rise)
    g.position.set(sx * (22 + w / 2), TERRACE_Y / 2 + 0.05, (GARDEN_FOOT + GARDEN_TOP) / 2)
    scene.add(g)
    // a gravel walk zig-zagging up, drawn as a band on the slope
    const walk = M.ground(THREE, 6, len, gravel, 6)
    walk.rotation.x = -Math.atan(rise)
    walk.position.set(sx * 60, TERRACE_Y / 2 + 0.09, (GARDEN_FOOT + GARDEN_TOP) / 2)
    scene.add(walk)
  }
  {
    const steps = 75
    const tread = (GARDEN_TOP - GARDEN_FOOT) / steps
    for (let i = 0; i < steps; i++) {
      const top = ((i + 1) / steps) * TERRACE_Y
      B.box(flags, [6, 6], 40, top, tread + 0.02, 0, 0, GARDEN_FOOT + (i + 0.5) * tread)
    }
    // cheek walls of the central stairs: sloping stone
    const cheek = new THREE.Shape()
    cheek.moveTo(GARDEN_FOOT - 1, 0)
    cheek.lineTo(GARDEN_TOP, 0)
    cheek.lineTo(GARDEN_TOP, TERRACE_Y + 1.1)
    cheek.lineTo(GARDEN_FOOT - 1, 1.1)
    cheek.closePath()
    for (const sx of [-1, 1]) {
      const g = extrudeAlongX(THREE, cheek, 1.4, 4)
      g.translate(sx * 20.7, 0, 0)
      B.add(stone, g)
    }
  }

  // the terrace, its balustrade over the gardens
  B.box(stone, STONE_T, 460, TERRACE_Y, 160, 0, 0, GARDEN_TOP + 80)
  flat(flags, 6, 0, GARDEN_TOP + 80, 460, 160, TERRACE_Y + 0.02)
  for (const sx of [-1, 1]) {
    const len = 230 - 21.4
    B.box(stone, STONE_T, len, 1.05, 0.7, sx * (21.4 + len / 2), TERRACE_Y, GARDEN_TOP + 0.35)
    B.box(stone, STONE_T, len, 0.16, 0.95, sx * (21.4 + len / 2), TERRACE_Y + 1.05, GARDEN_TOP + 0.35)
  }
  // drains and lamp posts along the terrace
  addParisLamps(
    THREE,
    scene,
    [-200, -150, -100, -50, 50, 100, 150, 200].map((x) => ({ x, y: TERRACE_Y, z: GARDEN_TOP + 2.5 })).concat(
      [-110, -70, 70, 110].flatMap((x) => [
        { x, z: 345 },
        { x, z: 515 },
      ])
    )
  )

  // the parvis between the two pavilions
  B.box(stone, STONE_T, FLIGHT.x0 * 2, PARVIS_Y, 214, 0, 0, FLIGHT.z0 + 107)
  flat(flags, 6, 0, FLIGHT.z0 + 107, FLIGHT.x0 * 2, 214, PARVIS_Y + 0.02)
  B.box(stone, STONE_T, FLIGHT.x0 * 2, 1.1, 0.8, 0, PARVIS_Y, FLIGHT.z0 + 0.4)
  B.box(stone, STONE_T, FLIGHT.x0 * 2 + 0.3, 0.16, 1.05, 0, PARVIS_Y + 1.1, FLIGHT.z0 + 0.4)
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) statue(sx * 47, PARVIS_Y, 712 + i * 32, sx * -Math.PI / 2)

  // the two lateral flights down from the parvis to the terrace, with their
  // solid parapets sloping down toward the tower — where the photo was taken
  {
    const steps = 50
    const run = FLIGHT.x1 - FLIGHT.x0
    const tread = run / steps
    const drop = PARVIS_Y - TERRACE_Y
    const depth = FLIGHT.z1 - FLIGHT.z0
    const ang = Math.atan2(drop, run)
    for (const sx of [-1, 1]) {
      for (let i = 0; i < steps; i++) {
        const top = PARVIS_Y - (i / steps) * drop
        B.box(flags, [6, 6], tread + 0.02, top - TERRACE_Y, depth, sx * (FLIGHT.x0 + (i + 0.5) * tread), TERRACE_Y, (FLIGHT.z0 + FLIGHT.z1) / 2)
      }
      // the parapet: a solid stone wall following the stairs, with a coping
      // (the shape is mirrored for the west flight; ExtrudeGeometry fixes the winding)
      const pts = [
        [FLIGHT.x0 - 6, TERRACE_Y],
        [FLIGHT.x1 + 5, TERRACE_Y],
        [FLIGHT.x1 + 5, TERRACE_Y + 1.1],
        [FLIGHT.x1, TERRACE_Y + 1.1],
        [FLIGHT.x0, PARVIS_Y + 1.1],
        [FLIGHT.x0 - 6, PARVIS_Y + 1.1],
      ]
      const p = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(sx * x, y)))
      const wall = uvScale(new THREE.ExtrudeGeometry(p, { depth: 0.8, bevelEnabled: false }), 0.25)
      wall.translate(0, 0, FLIGHT.z0 - 0.8)
      B.add(stone, wall)
      const slopeLen = Math.hypot(run, drop)
      const cope = M.box(THREE, slopeLen + 0.3, 0.16, 1.0, stone, STONE_T).geometry
      cope.rotateZ(-sx * ang)
      cope.translate(sx * (FLIGHT.x0 + run / 2), (PARVIS_Y + TERRACE_Y) / 2 + 1.1 - 0.02, FLIGHT.z0 - 0.4)
      B.add(stone, cope)
      // the pavilion's great stone flank on the other side of the flight
      B.box(stone, STONE_T, 46, 32, 46, sx * (FLIGHT.x0 + 23), 0, FLIGHT.z1 + 23)
      B.box(stone, STONE_T, 47, 0.8, 47, sx * (FLIGHT.x0 + 23), 32, FLIGHT.z1 + 23)
    }
  }

  // the Palais de Chaillot: two curved wings embracing the gardens, pale
  // stone, tall windows between pilasters, a flat roof behind a cornice
  {
    const fac = M.facade(THREE, {
      wall: 'stone',
      color: '#ddd3be',
      frame: '#3b3c3a',
      glass: '#20262b',
      bay: 4.6,
      storey: 7.5,
      window: { w: 0.5, h: 0.74, bars: 'grid', sill: true, lintel: false },
      curtains: 0.1,
      quality: q,
      seed: 31,
    })
    const R = 205
    const C = 545
    const H = 40
    for (const sx of [-1, 1]) {
      for (let a = 26; a <= 78; a += 4.5) {
        const r = THREE.MathUtils.degToRad(a)
        const x = sx * Math.sin(r) * R
        const z = C + Math.cos(r) * R
        const ry = Math.atan2(-sx * Math.sin(r), -Math.cos(r))
        const len = (R * Math.PI * 4.6) / 180
        B.box(fac.material, fac.tile, len, H, 22, x, 0, z, ry)
        B.box(stone, STONE_T, len + 0.6, 1.4, 23.2, x, H, z, ry)
        // pilasters on the garden side
        const nx = Math.sin(ry)
        const nz = Math.cos(ry)
        const tx = Math.cos(ry)
        const tz = -Math.sin(ry)
        for (let k = 0; k < 4; k++) {
          const o = -len / 2 + (k + 0.5) * (len / 4) + len / 8
          B.box(stone, STONE_T, 0.9, H - 2, 0.5, x + nx * 11.2 + tx * (o - len / 8), 0, z + nz * 11.2 + tz * (o - len / 8), ry)
        }
      }
    }
  }

  // plane trees: double avenues down the gardens, groves on the slopes
  const gardenTrees = []
  for (let z = 338; z <= 515; z += 11) for (const x of [-132, -120, 120, 132]) gardenTrees.push({ x: x + range(rand, -0.8, 0.8), z: z + range(rand, -0.8, 0.8), h: range(rand, 13, 17) })
  for (let z = GARDEN_FOOT + 6; z < GARDEN_TOP - 4; z += 12) {
    for (const x of [-180, -160, -140, 140, 160, 180]) {
      const zz = z + range(rand, -3, 3)
      gardenTrees.push({ x: x + range(rand, -3, 3), z: zz, y: (zz - GARDEN_FOOT) * rise, h: range(rand, 11, 16) })
    }
  }
  // the quays
  for (let x = -380; x <= 380; x += 18) {
    if (Math.abs(x) < 26) continue
    gardenTrees.push({ x: x + range(rand, -1, 1), z: RIVER_S - 12, h: range(rand, 14, 19) })
    gardenTrees.push({ x: x + range(rand, -1, 1), z: RIVER_N + 13, h: range(rand, 14, 19) })
  }
  // (planted with the city trees below)

  /* --- the Champ de Mars and the tower's surroundings -------------------- */
  flat(gravel, 6, 0, -10, 300, 290)
  for (const sx of [-1, 1]) {
    B.box(stone, STONE_T, 30, 2.4, 30, sx * 51, 0, 51)
    B.box(stone, STONE_T, 30, 2.4, 30, sx * 51, 0, -51)
    flat(lawn, 4, sx * 52, -580, 72, 860, 0.04)
  }
  flat(gravel, 6, 0, -580, 300, 860)
  const cdmTrees = []
  for (let z = -160; z >= -620; z -= 13) for (const x of [-106, 106]) cdmTrees.push({ x: x + range(rand, -0.6, 0.6), z: z + range(rand, -0.6, 0.6), h: range(rand, 12, 16) })
  const allPlanes = gardenTrees.concat(cdmTrees)
  addForest(THREE, scene, low ? allPlanes.filter((_, i) => i % 2 === 0) : allPlanes, { species: 'plane', seed: 7, quality: q })

  /* --- Haussmann: limestone, iron balconies, zinc mansards ---------------- */
  const BAY = 3.6
  const ST = 3.1
  const GROUND = 4.4
  const UPPER = 5
  const H = GROUND + UPPER * ST // cornice line, 19.9 m
  const MAN = { low: 3.4, lowIn: 1.3, high: 1.6, highIn: 4.5 }
  const fac = M.facade(THREE, {
    wall: 'stone',
    color: '#e3d8c2',
    frame: '#ece7dc',
    glass: '#242a30',
    bay: BAY,
    storey: ST,
    window: { w: 0.42, h: 0.72, bars: 'sash', sill: true, lintel: false },
    curtains: 0.4,
    quality: q,
    seed: 41,
  })
  const facWarm = fac.material.clone()
  facWarm.color = new THREE.Color(0xf2e9da)
  const facGrey = fac.material.clone()
  facGrey.color = new THREE.Color(0xe6e6e2)
  const facades = [fac.material, facWarm, facGrey]
  const shop = M.shopfront(THREE, { color: '#2c2a27', frame: '#1d2421', fascia: '#24302b', awning: '#7a1f24', bay: BAY, storey: GROUND, warm: 0.55, quality: q, seed: 42 })
  const zinc = M.roof(THREE, { kind: 'zinc', color: '#7f878d', tile: 2, quality: q, seed: 43 })
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x17191a, roughness: 0.5, metalness: 0.6 })

  /** A mansard: a steep lower slope and a shallow upper one, UVs in metres (u along the eaves, v up the slope). */
  function mansardGeo(w, d) {
    const pos = []
    const uv = []
    const ring = (inset, y) => [
      [-w / 2 + inset, y, d / 2 - inset],
      [w / 2 - inset, y, d / 2 - inset],
      [w / 2 - inset, y, -d / 2 + inset],
      [-w / 2 + inset, y, -d / 2 + inset],
    ]
    const r0 = ring(0, 0)
    const r1 = ring(MAN.lowIn, MAN.low)
    const r2 = ring(MAN.highIn, MAN.low + MAN.high)
    const band = (a, b, slope) => {
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4
        const quad = [a[i], a[j], b[j], b[i]]
        const len = Math.hypot(a[j][0] - a[i][0], a[j][2] - a[i][2])
        const off = (len - Math.hypot(b[j][0] - b[i][0], b[j][2] - b[i][2])) / 2
        const qu = [
          [0, 0],
          [len / 2, 0],
          [(len - off) / 2, slope / 2],
          [off / 2, slope / 2],
        ]
        for (const k of [0, 1, 2, 0, 2, 3]) {
          pos.push(...quad[k])
          uv.push(...qu[k])
        }
      }
    }
    band(r0, r1, Math.hypot(MAN.low, MAN.lowIn))
    band(r1, r2, Math.hypot(MAN.high, MAN.highIn - MAN.lowIn))
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...r2[k])
      uv.push(r2[k][0] / 2, r2[k][2] / 2)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.computeVertexNormals()
    // keep faces outward whichever way the quads wound
    const n = g.attributes.normal
    const p = g.attributes.position
    for (let i = 0; i < p.count; i += 3) {
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3
      const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3
      if (n.getX(i) * cx + n.getZ(i) * cz + n.getY(i) * 0.01 < 0) {
        for (const attr of [p, g.attributes.uv]) {
          const k = attr.itemSize
          for (let c = 0; c < k; c++) {
            const t = attr.array[(i + 1) * k + c]
            attr.array[(i + 1) * k + c] = attr.array[(i + 2) * k + c]
            attr.array[(i + 2) * k + c] = t
          }
        }
      }
    }
    g.computeVertexNormals()
    return g
  }

  // wrought-iron railing panels: one alpha-cut texture, repeated along every run
  const ironTex = paintTexture(
    THREE,
    256,
    128,
    (g, w, h) => {
      g.clearRect(0, 0, w, h)
      g.strokeStyle = '#141617'
      g.lineWidth = 5
      g.strokeRect(0, 3, w, h - 6)
      g.lineWidth = 3
      for (let x = 0; x <= w; x += w / 8) {
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x, h)
        g.stroke()
      }
      // scrolls and rings between the bars
      g.lineWidth = 2.5
      for (let x = w / 16; x < w; x += w / 8) {
        g.beginPath()
        g.ellipse(x, h * 0.32, w / 22, h * 0.13, 0, 0, Math.PI * 2)
        g.stroke()
        g.beginPath()
        g.arc(x - w / 32, h * 0.66, w / 36, -Math.PI / 2, Math.PI)
        g.arc(x + w / 32, h * 0.66, w / 36, 0, Math.PI * 1.5, true)
        g.stroke()
      }
    },
    { kind: 'color' }
  )
  const ironPanelMat = new THREE.MeshStandardMaterial({ map: ironTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 })
  const panels = []
  const rails = beamBatch(THREE)
  const dormers = []
  const chimneys = []
  const cafes = []

  /** A Haussmann block: footprint w × d (multiples of BAY), centred at (x, z). */
  function haussmann(x, z, w, d, i, { awnings = false } = {}) {
    const mat = facades[i % facades.length]
    B.box(shop.material, shop.tile, w, GROUND, d, x, 0, z)
    B.box(mat, fac.tile, w, UPPER * ST, d, x, GROUND, z)
    // string course over the shops, the cornice, the two balcony slabs
    B.box(stone, STONE_T, w + 0.3, 0.35, d + 0.3, x, GROUND - 0.1, z)
    B.box(stone, STONE_T, w + 0.9, 0.55, d + 0.9, x, H - 0.2, z)
    const slabs = [GROUND + ST, GROUND + 4 * ST]
    for (const y of slabs) B.box(stone, STONE_T, w + 1.8, 0.2, d + 1.8, x, y - 0.2, z)
    const mg = mansardGeo(w, d)
    mg.translate(x, H + 0.35, z)
    B.add(zinc, mg)
    // the four faces: balconies, window guards, dormers
    const faces = [
      { nx: 0, nz: 1, len: w, cx: x, cz: z + d / 2 },
      { nx: 0, nz: -1, len: w, cx: x, cz: z - d / 2 },
      { nx: 1, nz: 0, len: d, cx: x + w / 2, cz: z },
      { nx: -1, nz: 0, len: d, cx: x - w / 2, cz: z },
    ]
    for (const f of faces) {
      const tx = -f.nz
      const tz = f.nx
      const at = (o, out, y) => new THREE.Vector3(f.cx + tx * o + f.nx * out, y, f.cz + tz * o + f.nz * out)
      const ry = Math.atan2(f.nx, f.nz)
      for (const y of slabs) {
        const a = at(-f.len / 2 - 0.85, 0.88, y + 1.0)
        const b = at(f.len / 2 + 0.85, 0.88, y + 1.0)
        rails.add(a, b, 0.06, 0.05)
        const p = new THREE.PlaneGeometry(f.len + 1.7, 0.95)
        const uv = p.attributes.uv
        for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * ((f.len + 1.7) / 1.4))
        p.rotateY(ry)
        const c = at(0, 0.88, y + 0.5)
        p.translate(c.x, c.y, c.z)
        panels.push(p)
      }
      const nb = Math.round(f.len / BAY)
      for (let k = 0; k < nb; k++) {
        const o = -f.len / 2 + (k + 0.5) * BAY
        // guards on the 1st, 3rd and 4th floors
        for (const s of [0, 2, 3]) {
          const y = GROUND + s * ST + 0.72
          const p = new THREE.PlaneGeometry(1.5, 0.62)
          p.rotateY(ry)
          const c = at(o, 0.1, y)
          p.translate(c.x, c.y, c.z)
          panels.push(p)
        }
        if (k % 2 === 0 || nb < 4) dormers.push({ p: at(o, -MAN.lowIn * 0.55, H + 0.35 + 0.1), ry })
        if (k % 4 === 1) chimneys.push(at(o, -MAN.highIn + 0.3, H + MAN.low + MAN.high - 0.6))
        if (awnings && f.nz === -1 && k < 12) cafes.push({ p: at(o, 0, 0), ry, tx, tz, nx: f.nx, nz: f.nz })
      }
    }
  }

  // the detailed street west of the Champ de Mars (both sides)
  const blockLen = 28 * BAY // 100.8 m
  const blockDepth = 12 * BAY
  let bi = 0
  for (let k = 0; k < 4; k++) {
    const x1 = -152 - k * (blockLen + 16)
    const cx = x1 - blockLen / 2
    haussmann(cx, STREET_Z + STREET_HALF + blockDepth / 2, blockLen, blockDepth, bi++, { awnings: k === 0 || k === 2 })
    haussmann(cx, STREET_Z - STREET_HALF - blockDepth / 2, blockLen, blockDepth, bi++)
  }
  // and a row facing the Champ de Mars on the other side too (Avenue de La Bourdonnais)
  for (let k = 0; k < 4; k++) {
    const cz = -140 - k * (blockLen * 0.5 + 16) - blockLen / 4
    haussmann(152 + blockDepth / 2, cz, blockDepth, blockLen / 2, bi++)
    haussmann(-152 - blockDepth / 2, cz - 60, blockDepth, blockLen / 2, bi++)
  }
  // pavements, kerbs, lamps and parked cars along the street
  const streetX0 = -152 - 4 * (blockLen + 16)
  const streetLen = -152 - streetX0
  for (const sz of [-1, 1]) {
    B.box(pave, [3, 3], streetLen, 0.14, 6, (streetX0 - 152) / 2, 0, STREET_Z + sz * (STREET_HALF - 3))
  }
  B.box(pave, [3, 3], 10, 0.14, 300, -146, 0, -150)
  const lampSpots = []
  const carSpots = []
  for (let x = -165; x > streetX0; x -= 24) {
    lampSpots.push({ x, z: STREET_Z + STREET_HALF - 5.5, ry: Math.PI / 2 }, { x: x - 12, z: STREET_Z - STREET_HALF + 5.5, ry: Math.PI / 2 })
  }
  for (const sz of [-1, 1]) {
    for (let x = -170; x > streetX0 + 5; x -= range(rand, 5.2, 6.4)) {
      if (rand() < 0.22) {
        x -= 4
        continue
      }
      carSpots.push({ x, z: STREET_Z + sz * 4.9, ry: range(rand, -0.02, 0.02) })
    }
  }
  // along the quays and the Champ de Mars avenues
  for (let x = -600; x <= 600; x += 30) {
    if (Math.abs(x) < 25) continue
    lampSpots.push({ x, z: RIVER_S - 2.2 }, { x, z: RIVER_N + 2.2 })
    carSpots.push({ x: x + 8, z: RIVER_S - 27.5, ry: 0 }, { x: x + 14, z: RIVER_N + 32, ry: Math.PI })
  }
  for (let z = -150; z > -900; z -= 30) lampSpots.push({ x: -146, z }, { x: 146, z })
  addParisLamps(THREE, scene, lampSpots, { double: true })
  addParisLamps(THREE, scene, [-15.5, 15.5].flatMap((x) => [200, 235, 270].map((z) => ({ x, y: 0.15, z }))))
  addCars(THREE, scene, low ? carSpots.filter((_, i) => i % 2 === 0) : carSpots, 51)

  // café awnings and terrace tables on the corner blocks
  if (cafes.length) {
    const awn = new THREE.MeshStandardMaterial({ color: 0x7c1d22, roughness: 0.8 })
    const awnGeo = new THREE.BoxGeometry(BAY - 0.15, 0.08, 2.4).rotateX(0.32).translate(0, 3.25, 1.15)
    const valance = new THREE.BoxGeometry(BAY - 0.15, 0.32, 0.04).translate(0, 2.72, 2.3)
    const awnings = new THREE.InstancedMesh(mergeGeometries([awnGeo, valance], false), awn, cafes.length)
    const table = mergeGeometries(
      [new THREE.CylinderGeometry(0.32, 0.32, 0.03, 14).translate(0, 0.74, 0), new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6).translate(0, 0.37, 0), new THREE.CylinderGeometry(0.2, 0.22, 0.03, 10).translate(0, 0.015, 0)],
      false
    )
    const chair = mergeGeometries(
      [new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(0, 0.46, 0), new THREE.BoxGeometry(0.42, 0.45, 0.04).translate(0, 0.7, -0.2), new THREE.BoxGeometry(0.03, 0.46, 0.03).translate(0.18, 0.23, 0.18), new THREE.BoxGeometry(0.03, 0.46, 0.03).translate(-0.18, 0.23, 0.18), new THREE.BoxGeometry(0.03, 0.46, 0.03).translate(0.18, 0.23, -0.18), new THREE.BoxGeometry(0.03, 0.46, 0.03).translate(-0.18, 0.23, -0.18)],
      false
    )
    const tables = new THREE.InstancedMesh(table, ironMat, cafes.length)
    const rattan = new THREE.MeshStandardMaterial({ color: 0x9a7b55, roughness: 0.85 })
    const chairs = new THREE.InstancedMesh(chair, rattan, cafes.length * 2)
    const m4 = new THREE.Matrix4()
    cafes.forEach((c, i) => {
      m4.makeRotationY(c.ry).setPosition(c.p.x, 0.14, c.p.z)
      awnings.setMatrixAt(i, m4)
      const tx = c.p.x + c.nx * 1.4
      const tz = c.p.z + c.nz * 1.4
      m4.makeRotationY(c.ry).setPosition(tx, 0.14, tz)
      tables.setMatrixAt(i, m4)
      for (const s of [-1, 1]) {
        m4.makeRotationY(c.ry + (s > 0 ? Math.PI / 2 : -Math.PI / 2)).setPosition(tx + c.tx * s * 0.6, 0.14, tz + c.tz * s * 0.6)
        chairs.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), m4)
      }
    })
    for (const mesh of [awnings, tables, chairs]) {
      mesh.castShadow = true
      scene.add(mesh)
    }
  }

  // the distant city: the same blocks, instanced, fading into the haze
  const sizes = [
    [14 * BAY, 10 * BAY],
    [20 * BAY, 12 * BAY],
    [10 * BAY, 10 * BAY],
  ]
  const far = sizes.map(() => [])
  const reach = low ? 1100 : 1600
  for (let gx = -reach; gx <= reach; gx += 82) {
    for (let gz = -reach; gz <= reach + 400; gz += 74) {
      const x = gx + range(rand, -5, 5)
      const z = gz + range(rand, -5, 5)
      const ax = Math.abs(x)
      if (ax < 240 && z < 345) continue // tower, Champ de Mars, avenues
      if (z > 110 && z < 350) continue // the Seine and its quays
      if (ax < 360 && z >= 345 && z < 1000) continue // the Trocadéro
      if (x > streetX0 - 70 && x < -110 && z > -260 && z < 50) continue // the detailed street
      if (ax < 260 && z < -100 && z > -700) continue
      const y = ax < 360 && z >= 1000 && z < 1400 ? PARVIS_Y : 0
      far[Math.floor(rand() * sizes.length)].push({ x, z, y, ry: rand() < 0.5 ? 0 : Math.PI / 2 })
    }
  }
  // the plateau behind Chaillot (Place du Trocadéro)
  B.box(stone, STONE_T, 720, PARVIS_Y, 400, 0, 0, 1200)
  flat(asphalt, 6, 0, 1200, 720, 400, PARVIS_Y + 0.02)
  const m4 = new THREE.Matrix4()
  const qy = new THREE.Quaternion()
  const yAx = new THREE.Vector3(0, 1, 0)
  sizes.forEach(([w, d], si) => {
    const list = far[si]
    if (!list.length) return
    const bodyGeo = M.box(THREE, w, H, d, fac.material, fac.tile).geometry
    const manGeo = mansardGeo(w, d).translate(0, H, 0)
    const bodies = facades.map((mat) => new THREE.InstancedMesh(bodyGeo, mat, list.length))
    const counts = facades.map(() => 0)
    const roofs = new THREE.InstancedMesh(manGeo, zinc, list.length)
    list.forEach((b, i) => {
      qy.setFromAxisAngle(yAx, b.ry)
      const hk = range(rand, 0.92, 1.06)
      m4.compose(new THREE.Vector3(b.x, b.y, b.z), qy, new THREE.Vector3(1, hk, 1))
      const mi = i % facades.length
      bodies[mi].setMatrixAt(counts[mi]++, m4)
      m4.compose(new THREE.Vector3(b.x, b.y + H * (hk - 1), b.z), qy, new THREE.Vector3(1, 1, 1))
      roofs.setMatrixAt(i, m4)
    })
    bodies.forEach((mesh, mi) => {
      mesh.count = counts[mi]
      mesh.receiveShadow = true
      mesh.castShadow = false
      scene.add(mesh)
    })
    scene.add(roofs)
  })

  // dormers, chimneys and iron for the detailed blocks
  {
    const dormerGeo = mergeGeometries(
      [M.box(THREE, 1.5, 2.0, 1.5, stone, STONE_T).geometry, new THREE.ConeGeometry(1.15, 0.7, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 1.15).translate(0, 2.35, 0).toNonIndexed()].map((g) => {
        const n = g.index ? g.toNonIndexed() : g
        return n
      }),
      false
    )
    const winGeo = new THREE.PlaneGeometry(0.85, 1.25).translate(0, 1.05, 0.76)
    const dormerMesh = new THREE.InstancedMesh(dormerGeo, stone, dormers.length)
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x1d2329, roughness: 0.05, metalness: 0.6, clearcoat: 1 })
    const winMesh = new THREE.InstancedMesh(winGeo, glassMat, dormers.length)
    dormers.forEach((dm, i) => {
      m4.makeRotationY(dm.ry).setPosition(dm.p.x, dm.p.y, dm.p.z)
      dormerMesh.setMatrixAt(i, m4)
      winMesh.setMatrixAt(i, m4)
    })
    dormerMesh.castShadow = true
    scene.add(dormerMesh, winMesh)
    const stack = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2.4, 0.9).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0xcfc3ad, roughness: 0.9 }), chimneys.length)
    const pots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.15, 0.6, 8).translate(0, 2.7, 0), new THREE.MeshStandardMaterial({ color: 0xa9563a, roughness: 0.85 }), chimneys.length * 4)
    chimneys.forEach((c, i) => {
      m4.makeTranslation(c.x, c.y, c.z)
      stack.setMatrixAt(i, m4)
      for (let k = 0; k < 4; k++) {
        m4.makeTranslation(c.x - 0.8 + k * 0.53, c.y, c.z)
        pots.setMatrixAt(i * 4 + k, m4)
      }
    })
    stack.castShadow = true
    scene.add(stack, pots)
    if (panels.length) {
      const pm = new THREE.Mesh(mergeGeometries(panels, false), ironPanelMat)
      pm.layers.set(NO_INK_LAYER)
      scene.add(pm)
    }
    scene.add(rails.build(ironMat, { castShadow: false }))
  }

  B.flush()

  /* --- viewpoints ------------------------------------------------------- */
  const spot = (px, py, pz, lx, ly, lz) => ({ pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz) })
  const stairY = (x) => PARVIS_Y - ((Math.abs(x) - FLIGHT.x0) / (FLIGHT.x1 - FLIGHT.x0)) * (PARVIS_Y - TERRACE_Y)
  const spots = [
    // 0 · on the lateral flight, the parapet sloping up to the right, the tower beyond it
    spot(70, stairY(70) + 1.7, 692.5, 91, stairY(70) + 16, 595),
    // 1 · the terrace balustrade over the gardens and the basin
    spot(-30, TERRACE_Y + 1.7, 604, -190, 58, 0),
    // 2 · down by the Varsovie basin, the water cannons in front
    spot(30, 1.7, 470, -110, 110, 0),
    // 3 · on the quay of the Avenue de New York, the bridge and tower across the river
    spot(-120, 1.75, 296, 40, 30, 110),
    // 4 · the Champ de Mars side, under the west leg
    spot(-110, 1.7, -58, 10, 105, 25),
    // 5 · a Haussmann street, the tower peeking over the roofs
    spot(-430, 1.7, STREET_Z - 2, 0, 110, STREET_Z - 50),
    // 6 · right under the tower, looking up into the lattice
    spot(-20, 1.7, -70, 4, 95, 12),
    // 7 · on the Pont d'Iéna, the tower close and huge
    spot(14, 1.8, 250, -40, 92, 0),
  ]
  world.focusShadows(new THREE.Vector3(40, 10, 640), 80)

  const s0 = spots[0]
  const path = {
    positions: [
      new THREE.Vector3(-420, 260, 1350),
      new THREE.Vector3(-160, 130, 1050),
      new THREE.Vector3(0, 52, 820),
      new THREE.Vector3(40, 26, 694),
      s0.pos.clone(),
    ],
    targets: [
      new THREE.Vector3(0, 160, 0),
      new THREE.Vector3(0, 140, 0),
      new THREE.Vector3(20, 90, 200),
      new THREE.Vector3(70, 40, 500),
      s0.look.clone(),
    ],
    fov: 50,
    near: 0.3,
    spots,
  }

  function groundAt(x, z) {
    const ax = Math.abs(x)
    if (z >= FLIGHT.z0 && ax < FLIGHT.x0) return PARVIS_Y
    if (z >= FLIGHT.z0 && z <= FLIGHT.z1 && ax <= FLIGHT.x1) return stairY(x)
    if (z >= GARDEN_TOP && z < FLIGHT.z0 && ax < 230) return TERRACE_Y
    if (z >= GARDEN_FOOT && z < GARDEN_TOP && ax < 230) return ((z - GARDEN_FOOT) / (GARDEN_TOP - GARDEN_FOOT)) * TERRACE_Y
    return 0
  }

  return {
    scene,
    world,
    path,
    groundAt,
    clearance: 1.2,
    update(t) {
      for (const f of tickers) f(t)
    },
  }
}
