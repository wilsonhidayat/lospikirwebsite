/**
 * Two indoor places of an Amsterdam wedding day:
 *
 *  • 'stadsloket' — the civil wedding at the Stadsloket (the city hall's
 *    public counter, Amstel 1). A small wedding room: a wall of warm
 *    wood-veneer panels, an oak parquet floor, the white signing table with
 *    a bunch of peonies and lilies, the open black register folder and pen,
 *    black leather aluminium-frame office chairs either side, rows of grey
 *    guest chairs with coats left on them. The room opens onto the lobby
 *    and the street front: a timber-framed glass facade with "Stadsloket" in
 *    silver letters, a big revolving door (turning slowly), a side door left
 *    open, the red opening-hours panel, timber louvres, and red and buff
 *    herringbone brick paving with a tactile strip to the door.
 *  • 'restaurant' — the wedding dinner: a long table of honey-oak tables
 *    laid for fourteen (napkins, cutlery, glasses, carafes, salt and pepper
 *    mills, menus, candles), grey woven armchairs, coats on the backs, a big
 *    potted tree hung with fairy lights, a tall leafy plant, a coat rack,
 *    brass pendants in a dark back room, an orange timber-clad column and a
 *    gong on its stand. No people anywhere — it reads as the moment before
 *    everyone sits down.
 *
 * Metres, y up. Built from merged static geometry (one draw call per
 * material) and instancing; interiors carry their own small light probe so
 * metal, glass and varnish reflect a room, not the sky.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createWorld } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { paintTexture, seeded, range, pick, glowTexture, noiseNormalMap } from '../utils.js'

export function buildStadsloket(THREE, ctx, { variant = 'stadsloket' } = {}) {
  ctx.sky = null
  if (variant === 'restaurant') return buildRestaurant(THREE, ctx)
  return buildCityHall(THREE, ctx)
}

/* ======================================================================== */
/* kit                                                                      */
/* ======================================================================== */

function prepGeo(THREE, geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone()
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
  if (!g.attributes.normal) g.computeVertexNormals()
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
  g.clearGroups()
  g.morphAttributes = {}
  return g
}
function mergeParts(THREE, parts) {
  const list = parts.map((p) => prepGeo(THREE, p))
  return list.length === 1 ? list[0] : mergeGeometries(list, false)
}

/** Static batcher: one merged mesh per material at flush(). */
function toolkit(THREE, root) {
  const lists = new Map()
  const flags = new Map()
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const p = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const dir = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const zAxis = new THREE.Vector3(0, 0, 1)
  const listOf = (mat) => {
    let l = lists.get(mat)
    if (!l) lists.set(mat, (l = []))
    return l
  }
  function putM(mat, geo, matrix) {
    const g = prepGeo(THREE, geo)
    g.applyMatrix4(matrix)
    listOf(mat).push(g)
  }
  function put(mat, geo, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    e.set(rx, ry, rz, 'YXZ')
    q.setFromEuler(e)
    m4.compose(p.set(x, y, z), q, one)
    putM(mat, geo, m4)
  }
  function strut(mat, a, b, w, d = w) {
    dir.subVectors(b, a)
    const len = dir.length() || 0.001
    q.setFromUnitVectors(zAxis, dir.normalize())
    m4.compose(p.addVectors(a, b).multiplyScalar(0.5), q, one)
    putM(mat, new THREE.BoxGeometry(w, d, len), m4)
  }
  function rod(mat, a, b, r, seg = 8) {
    dir.subVectors(b, a)
    const len = dir.length() || 0.001
    q.setFromUnitVectors(yAxis, dir.normalize())
    m4.compose(p.addVectors(a, b).multiplyScalar(0.5), q, one)
    putM(mat, new THREE.CylinderGeometry(r, r, len, seg, 1, true), m4)
  }
  function flush() {
    const meshes = []
    for (const [mat, arr] of lists) {
      if (!arr.length) continue
      const geo = arr.length === 1 ? arr[0] : mergeGeometries(arr, false)
      if (!geo) continue
      geo.computeBoundingSphere()
      const mesh = new THREE.Mesh(geo, mat)
      const f = flags.get(mat) || {}
      mesh.castShadow = f.cast !== false
      mesh.receiveShadow = f.receive !== false
      root.add(mesh)
      meshes.push(mesh)
    }
    lists.clear()
    return meshes
  }
  return { put, putM, strut, rod, flush, flags: (mat, f) => flags.set(mat, f) }
}

/** A box sitting on y = 0, UVs in metres / tile (u, v); `faces` picks faces (+x,−x,+y,−y,+z,−z). */
function boxGeo(THREE, w, h, d, tu = 1, tv = tu, faces = null) {
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
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k
    uv.setXY(i, (uv.getX(i) * dims[f][0]) / tu, (uv.getY(i) * dims[f][1]) / tv)
  }
  if (faces) {
    const src = g.index.array
    const keep = []
    for (const f of faces) for (let k = 0; k < 6; k++) keep.push(src[f * 6 + k])
    g.setIndex(keep)
  }
  return g
}
/** A flat rectangle at y = 0, UVs in metres / tile. */
function flatGeo(THREE, w, d, tile = 1) {
  const g = new THREE.PlaneGeometry(w, d)
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile)
  g.rotateX(-Math.PI / 2)
  return g
}

function scatter(THREE, root, geo, mat, items, { cast = true, receive = true } = {}) {
  if (!items.length) return null
  const mesh = new THREE.InstancedMesh(geo, mat, items.length)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const c = new THREE.Color()
  items.forEach((it, i) => {
    e.set(it.rx || 0, it.ry || 0, it.rz || 0, 'YXZ')
    q.setFromEuler(e)
    const k = it.s ?? 1
    s.set(it.sx ?? k, it.sy ?? k, it.sz ?? k)
    m4.compose(p.set(it.x, it.y || 0, it.z), q, s)
    mesh.setMatrixAt(i, m4)
    if (it.color != null) mesh.setColorAt(i, c.set(it.color))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = cast
  mesh.receiveShadow = receive
  root.add(mesh)
  return mesh
}

const std = (THREE, color, roughness = 0.6, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })

/**
 * A room's own light: an HDR equirectangular probe painted from the room's
 * colours (floor below, walls around, a bright ceiling and its lamps).
 * lamps: [{ dir: Vector3 (unit), color: [r,g,b], k, size }]
 */
function roomProbe(THREE, { floor, wall, ceil, lamps = [], low = false }) {
  const W = low ? 64 : 128
  const H = W / 2
  const toHalf = THREE.DataUtils.toHalfFloat
  const data = new Uint16Array(W * H * 4)
  const d = new THREE.Vector3()
  for (let j = 0; j < H; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W - 0.5) * Math.PI * 2
      d.set(Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat))
      let c
      if (d.y < -0.25) c = floor
      else if (d.y > 0.72) c = ceil
      else {
        const k = (d.y + 0.25) / 0.97
        c = [wall[0] * (0.8 + k * 0.4), wall[1] * (0.8 + k * 0.4), wall[2] * (0.8 + k * 0.4)]
      }
      let r = c[0]
      let g = c[1]
      let b = c[2]
      for (const L of lamps) {
        const a = Math.max(0, d.dot(L.dir))
        const s = Math.pow(a, L.size || 400) * (L.k || 20)
        r += L.color[0] * s
        g += L.color[1] * s
        b += L.color[2] * s
      }
      const n = (j * W + i) * 4
      data[n] = toHalf(Math.min(60, r))
      data[n + 1] = toHalf(Math.min(60, g))
      data[n + 2] = toHalf(Math.min(60, b))
      data[n + 3] = toHalf(1)
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType)
  t.mapping = THREE.EquirectangularReflectionMapping
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}
function applyEnv(root, env, intensity = 1) {
  root.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of ms) {
      if (m.isMeshStandardMaterial && !m.envMap) {
        m.envMap = env
        m.envMapIntensity = (m.envMapIntensity ?? 1) * intensity
      }
    }
  })
}

/** Wood veneer: fine vertical grain, a panel per texture with a dark reveal down its left edge. */
function veneerTexture(THREE, { color = '#b89a7a', reveal = true, seed = 3, size = 256 } = {}) {
  return paintTexture(
    THREE,
    size,
    size,
    (g, w, h) => {
      g.fillStyle = color
      g.fillRect(0, 0, w, h)
      const rand = seeded(seed)
      for (let i = 0; i < 260; i++) {
        const x = rand() * w
        const a = 0.025 + rand() * 0.06
        g.strokeStyle = rand() < 0.5 ? `rgba(90,60,35,${a})` : `rgba(255,235,205,${a})`
        g.lineWidth = 0.6 + rand() * 1.8
        g.beginPath()
        g.moveTo(x, 0)
        for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin(y * 0.02 + i) * 1.5, y)
        g.stroke()
      }
      // a soft flame in the middle of the leaf
      const grd = g.createLinearGradient(0, 0, w, 0)
      grd.addColorStop(0, 'rgba(70,45,25,0.08)')
      grd.addColorStop(0.5, 'rgba(255,240,215,0.05)')
      grd.addColorStop(1, 'rgba(70,45,25,0.08)')
      g.fillStyle = grd
      g.fillRect(0, 0, w, h)
      if (reveal) {
        g.fillStyle = 'rgba(40,28,18,0.85)'
        g.fillRect(0, 0, Math.max(2, w * 0.008), h)
        g.fillStyle = 'rgba(255,240,220,0.25)'
        g.fillRect(Math.max(2, w * 0.008), 0, 1, h)
      }
    },
    { kind: 'color' }
  )
}

/** Text on a transparent canvas (signs, lettering, menus). */
function textTexture(THREE, w, h, draw) {
  const t = paintTexture(THREE, w, h, draw, { kind: 'color' })
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

/* ======================================================================== */
/* 1. The Stadsloket: the wedding room, the lobby, the street front         */
/* ======================================================================== */

function buildCityHall(THREE, ctx) {
  const low = ctx.quality === 'low'
  const q = ctx.quality
  const world = createWorld(THREE, ctx, 'day', {
    sun: { elevation: 34, azimuth: 205 },
    sky: { zenith: 0x4a86d2, horizon: 0xc4dbef, clouds: 0.3 },
    fog: { density: 0.0009 },
    sunIntensity: 2.1,
    hemi: [0xe6eef8, 0x8a7a68, 1.0],
  })
  const { scene } = world
  const inside = new THREE.Group()
  const outside = new THREE.Group()
  scene.add(inside, outside)
  const K = toolkit(THREE, inside)
  const O = toolkit(THREE, outside)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const rand = seeded(322)

  // the plan: the wedding room's panelled wall at z = −8, the room's door at
  // z = 0 into the lobby, the street facade at z = 8 (the street is +z)
  const RX = -10.3 // the room's centre line
  const RW = 9 // room width (x)
  const RZ0 = -8
  const RZ1 = 0
  const RH = 3.1
  const FZ = 8 // facade plane
  const GF = 3.4 // ground-floor glazing height (transom)
  const FL = 4.2 // storey height above

  /* --- the tour --------------------------------------------------------- */

  const S0 = V(RX + 0.05, 1.62, -7.45)
  const spots = [
    { pos: S0, look: V(RX + 0.35, 0.74, -6.35) }, // 0 · photo 01: over the signing table, the register and the flowers
    { pos: V(RX, 1.36, -2.2), look: V(RX, 1.22, RZ0) }, // 1 · photo 02: the panelled wall, the table, the black chairs
    { pos: V(0.35, 1.42, 14.6), look: V(0, 2.5, FZ) }, // 2 · photo 03: the revolving door under the Stadsloket letters
  ]
  const arrival = [V(RX, 2.6, -0.6), V(RX + 0.4, 2.3, -3.2), V(RX + 0.2, 2.0, -5.6), V(RX + 0.08, 1.75, -6.9), S0.clone()]

  /* --- materials -------------------------------------------------------- */

  const veneerMap = veneerTexture(THREE, { color: '#a99683', seed: 7, size: low ? 128 : 256 })
  const grainN = noiseNormalMap(THREE, low ? 64 : 128, { cells: 3, strength: 0.35, octaves: 2, stretch: [1, 10] })
  const veneer = new THREE.MeshStandardMaterial({ map: veneerMap, normalMap: grainN, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.52, metalness: 0 })
  const parquet = M.planks(THREE, { color: '#94613a', width: 0.07, gap: 0.002, varnish: 1, tile: 1.2, quality: q, seed: 21 })
  const plasterW = M.plaster(THREE, { color: '#ece8e1', dirt: 0.03, tile: 3, quality: q, seed: 22 })
  const ceilingMat = std(THREE, 0xf1efea, 0.85)
  const whiteTop = std(THREE, 0xf4f3ef, 0.32, 0)
  const leather = std(THREE, 0x121214, 0.42, 0, { envMapIntensity: 1.2 })
  const chrome = std(THREE, 0xe4e7ea, 0.16, 1)
  const alu = std(THREE, 0xb8bcc0, 0.3, 0.95)
  const fabric = std(THREE, 0x4c4e53, 0.96)
  const blackMetal = std(THREE, 0x18191b, 0.45, 0.6)
  const ceramic = std(THREE, 0xf7f5f0, 0.18, 0, { envMapIntensity: 1.3 })
  const folderMat = std(THREE, 0x161514, 0.5, 0)
  const doorWood = std(THREE, 0x8a6a4c, 0.5)
  const coatCols = [0x1c1d22, 0x6b5a48, 0x2a3346, 0xb9b0a2, 0x5a2420]
  const paper = new THREE.MeshStandardMaterial({
    map: textTexture(THREE, 256, 180, (g, w, h) => {
      g.fillStyle = '#f3efe6'
      g.fillRect(0, 0, w, h)
      g.fillStyle = 'rgba(40,40,45,0.75)'
      const r = seeded(9)
      for (let y = 14; y < h - 10; y += 9) {
        if (r() < 0.12) continue
        const x0 = 18 + r() * 30
        g.fillRect(x0, y, w * (0.25 + r() * 0.5), 2)
      }
      g.fillRect(20, h - 30, w - 40, 1)
    }),
    roughness: 0.85,
  })

  /* --- the wedding room ---------------------------------------------------- */

  const xL = RX - RW / 2
  const xR = RX + RW / 2
  // floor, ceiling, walls (veneer on the ceremony wall and returns; plaster behind)
  K.put(parquet, flatGeo(THREE, RW, RZ1 - RZ0, 1.4), RX, 0, (RZ0 + RZ1) / 2)
  K.put(ceilingMat, flatGeo(THREE, RW, RZ1 - RZ0, 2).rotateX(Math.PI), RX, RH, (RZ0 + RZ1) / 2)
  K.put(veneer, boxGeo(THREE, RW, RH, 0.06, 1.2, RH, [4]), RX, 0, RZ0 - 0.03)
  for (const [x, s] of [
    [xL - 0.03, 1],
    [xR + 0.03, -1],
  ]) {
    // side walls: veneer for the first 3 m from the ceremony wall, plaster on
    const g = boxGeo(THREE, 0.06, RH, 3.0, 1.2, RH, [s > 0 ? 0 : 1])
    K.put(veneer, g, x, 0, RZ0 + 1.5)
    K.put(plasterW, boxGeo(THREE, 0.06, RH, RZ1 - RZ0 - 3, 3, 3, [s > 0 ? 0 : 1]), x, 0, RZ0 + 3 + (RZ1 - RZ0 - 3) / 2)
  }
  // the back wall with a wide double doorway (doors open) into the lobby
  const DX0 = -10.1
  const DX1 = -7.5
  const DH = 2.85
  K.put(plasterW, boxGeo(THREE, DX0 - xL, RH, 0.16, 3, 3), (xL + DX0) / 2, 0, RZ1)
  K.put(plasterW, boxGeo(THREE, xR - DX1, RH, 0.16, 3, 3), (DX1 + xR) / 2, 0, RZ1)
  K.put(plasterW, boxGeo(THREE, DX1 - DX0, RH - DH, 0.16, 3, 3), (DX0 + DX1) / 2, DH, RZ1)
  for (const [x, a] of [
    [DX0, -1.25],
    [DX1, 1.25],
  ]) {
    // door leaves swung back into the lobby
    const leaf = new THREE.BoxGeometry(1.28, DH - 0.02, 0.05).translate(Math.sign(a) * -0.64, (DH - 0.02) / 2, 0)
    K.put(doorWood, leaf, x, 0, RZ1 + 0.1, a)
  }
  // skirting and a shadow gap under the veneer
  K.put(blackMetal, new THREE.BoxGeometry(RW, 0.04, 0.02), RX, 0.02, RZ0 + 0.01)
  // recessed downlights and the room's warm light
  const downs = []
  for (const x of [RX - 3, RX, RX + 3]) for (const z of [RZ0 + 1.3, RZ0 + 4, RZ0 + 6.6]) downs.push({ x, y: RH - 0.005, z })
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0d8).multiplyScalar(2.4) })
  scatter(THREE, inside, new THREE.CircleGeometry(0.075, 16).rotateX(Math.PI / 2), lampMat, downs, { cast: false, receive: false })
  scatter(THREE, inside, new THREE.TorusGeometry(0.085, 0.012, 4, 18).rotateX(Math.PI / 2), alu, downs, { cast: false, receive: false })
  for (const [x, z, i] of [
    [RX - 2.6, RZ0 + 1.6, 7],
    [RX + 2.6, RZ0 + 1.6, 7],
    [RX, RZ0 + 4.4, 9],
    [RX, RZ0 + 7.2, 6],
  ]) {
    const l = new THREE.PointLight(0xffd9ad, i, 9, 2)
    l.position.set(x, RH - 0.3, z)
    inside.add(l)
  }
  // wall-washers grazing the veneer
  for (const x of [RX - 2.4, RX + 2.4]) {
    const s = new THREE.SpotLight(0xffd6a6, 14, 7, 0.75, 0.8, 2)
    s.position.set(x, RH - 0.1, RZ0 + 1.0)
    s.target.position.set(x, 0.6, RZ0)
    inside.add(s, s.target)
  }

  // the signing table: white top on slim white legs
  const TZ = RZ0 + 1.45
  K.put(whiteTop, boxGeo(THREE, 1.9, 0.035, 0.85), RX, 0.735, TZ)
  K.put(whiteTop, new THREE.BoxGeometry(1.84, 0.09, 0.79).translate(0, -0.045, 0), RX, 0.735, TZ)
  for (const sx of [-0.88, 0.88]) for (const sz of [-0.36, 0.36]) K.put(whiteTop, new THREE.BoxGeometry(0.045, 0.69, 0.045).translate(0, 0.345, 0), RX + sx, 0, TZ + sz)
  // the register: an open black folder, two pages, a pen
  const FX = RX + 0.25
  const FZ2 = TZ + 0.12
  for (const s of [-1, 1]) {
    K.put(folderMat, new THREE.BoxGeometry(0.31, 0.008, 0.44), FX + s * 0.158, 0.772, FZ2, 0, 0, s * 0.025)
    K.put(paper, new THREE.PlaneGeometry(0.27, 0.38).rotateX(-Math.PI / 2), FX + s * 0.16, 0.779, FZ2, Math.PI, 0, s * 0.025)
  }
  K.put(ceramic, new THREE.CylinderGeometry(0.006, 0.006, 0.14, 8).rotateZ(Math.PI / 2), FX + 0.05, 0.79, FZ2 + 0.1, 0.6)
  K.put(chrome, new THREE.ConeGeometry(0.006, 0.02, 8).rotateZ(-Math.PI / 2), FX + 0.11, 0.79, FZ2 + 0.06, 0.6)
  // the vase and its flowers: pink peonies, orange lilies, blue sprigs
  const VX = RX - 0.6
  const VZ = TZ - 0.12
  K.put(ceramic, new THREE.LatheGeometry([new THREE.Vector2(0.0, 0), new THREE.Vector2(0.055, 0), new THREE.Vector2(0.075, 0.06), new THREE.Vector2(0.07, 0.13), new THREE.Vector2(0.045, 0.17), new THREE.Vector2(0.05, 0.19)], 20), VX, 0.77, VZ)
  const blooms = []
  const bloomCols = [0xe0306f, 0xd42a62, 0xf04d8a, 0xff8a24, 0xff9a36, 0x4b78e0, 0x6a92f0]
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * 0.2
    const kind = i < 8 ? 0 : i < 16 ? 1 : 2
    blooms.push({ x: VX + Math.cos(a) * r, y: 0.98 + rand() * 0.2 - r * 0.35, z: VZ + Math.sin(a) * r, s: kind === 0 ? range(rand, 0.9, 1.25) : kind === 1 ? 0.75 : 0.42, sy: kind === 1 ? 0.5 : undefined, color: kind === 0 ? pick(rand, bloomCols.slice(0, 3)) : kind === 1 ? pick(rand, bloomCols.slice(3, 5)) : pick(rand, bloomCols.slice(5)) })
  }
  scatter(THREE, inside, new THREE.IcosahedronGeometry(0.05, 1), std(THREE, 0xffffff, 0.75), blooms, { cast: false })
  const leaves = []
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2
    leaves.push({ x: VX + Math.cos(a) * 0.14, y: 0.98 + rand() * 0.12, z: VZ + Math.sin(a) * 0.14, ry: a, rx: range(rand, -0.6, 0.6), sx: 0.035, sy: 0.006, sz: 0.11 })
  }
  scatter(THREE, inside, new THREE.SphereGeometry(1, 8, 6), std(THREE, 0x2f6a2a, 0.6), leaves, { cast: false })

  // black leather office chairs (aluminium side frames, ribbed pads, four-star base)
  const chairParts = eamesChair(THREE)
  const blackChairs = [
    { x: RX - 2.15, z: TZ + 1.7, ry: 0.25 },
    { x: RX + 2.2, z: TZ + 1.75, ry: -0.3 },
    { x: RX + 0.2, z: TZ + 0.95, ry: Math.PI + 0.08 }, // the bride's, pulled up to the table
    { x: RX - 0.9, z: TZ + 1.0, ry: Math.PI - 0.2 },
  ]
  scatter(THREE, inside, chairParts.pads, leather, blackChairs, { receive: true })
  scatter(THREE, inside, chairParts.frame, chrome, blackChairs, { receive: false })
  // the guests' chairs: two short rows each side of the aisle, coats left on a few
  const guestGeo = mergeParts(THREE, [
    new THREE.BoxGeometry(0.47, 0.07, 0.46).translate(0, 0.46, 0),
    new THREE.BoxGeometry(0.47, 0.4, 0.06).translate(0, 0.74, -0.21),
  ])
  const guestLegs = mergeParts(THREE, [
    ...[-0.2, 0.2].flatMap((x) => [-0.18, 0.18].map((z) => new THREE.CylinderGeometry(0.012, 0.012, 0.44, 5).translate(x, 0.22, z))),
    new THREE.BoxGeometry(0.02, 0.36, 0.02).translate(-0.2, 0.7, -0.22),
    new THREE.BoxGeometry(0.02, 0.36, 0.02).translate(0.2, 0.7, -0.22),
  ])
  const guests = []
  for (const z of [TZ + 3.3, TZ + 4.4]) {
    for (const x of [RX - 3.6, RX - 3.0, RX - 2.4, RX - 1.8, RX + 1.8, RX + 2.4, RX + 3.0, RX + 3.6]) guests.push({ x: x + range(rand, -0.04, 0.04), z: z + range(rand, -0.05, 0.05), ry: Math.PI + range(rand, -0.08, 0.08) })
  }
  scatter(THREE, inside, guestGeo, fabric, guests)
  scatter(THREE, inside, guestLegs, blackMetal, guests)
  // coats over chair backs, a handbag on a seat, a bouquet's paper on another
  const coats = []
  for (const i of [1, 6, 9, 13]) {
    const g = guests[i]
    coats.push({ x: g.x - 0.25 * Math.sin(g.ry), y: 0.62, z: g.z - 0.25 * Math.cos(g.ry), ry: g.ry, color: pick(rand, coatCols) })
  }
  const coatGeo = mergeParts(THREE, [new THREE.BoxGeometry(0.5, 0.55, 0.05).translate(0, 0.05, 0), new THREE.BoxGeometry(0.44, 0.08, 0.16).translate(0, 0.33, -0.04)])
  scatter(THREE, inside, coatGeo, std(THREE, 0xffffff, 0.92), coats)
  K.put(std(THREE, 0x2b1d18, 0.4), new THREE.BoxGeometry(0.3, 0.2, 0.12).translate(0, 0.1, 0), guests[10].x, 0.5, guests[10].z, 0.4)
  // a little side table by the wall with a glass of water and a box of tissues
  K.put(whiteTop, boxGeo(THREE, 0.5, 0.7, 0.4), xR - 0.45, 0, RZ0 + 3.6)
  const tumblerMat = new THREE.MeshStandardMaterial({ color: 0xe8eef0, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false })
  K.flags(tumblerMat, { cast: false, receive: false })
  K.put(tumblerMat, new THREE.CylinderGeometry(0.035, 0.03, 0.1, 14, 1, true).translate(0, 0.05, 0), xR - 0.5, 0.7, RZ0 + 3.6)
  K.put(std(THREE, 0xd9d4c8, 0.8), new THREE.BoxGeometry(0.2, 0.08, 0.11), xR - 0.38, 0.74, RZ0 + 3.5)

  /* --- the lobby ------------------------------------------------------------ */

  const LX0 = -18
  const LX1 = 15
  const stone = M.floor(THREE, { kind: 'tile', color: '#8f8c86', tileSize: 0.6, polish: 0.75, tile: 3, quality: q, seed: 23 })
  K.put(stone, flatGeo(THREE, LX1 - LX0, FZ - RZ1, 3), (LX0 + LX1) / 2, 0.003, (RZ1 + FZ) / 2)
  K.put(ceilingMat, flatGeo(THREE, LX1 - LX0, FZ - RZ1, 2).rotateX(Math.PI), (LX0 + LX1) / 2, FL, (RZ1 + FZ) / 2)
  // the back wall of the lobby beyond the room, and the floors above
  K.put(plasterW, boxGeo(THREE, LX1 - (xR + 0.1), FL, 0.2, 3, 3), (xR + 0.1 + LX1) / 2, 0, RZ1 - 0.02)
  K.put(plasterW, boxGeo(THREE, xL - LX0, FL, 0.2, 3, 3), (LX0 + xL) / 2, 0, RZ1 - 0.02)
  K.put(plasterW, boxGeo(THREE, xR - xL + 0.2, FL - RH, 0.2, 3, 3), RX, RH, RZ1 - 0.02)
  for (const x of [LX0, LX1]) K.put(plasterW, boxGeo(THREE, 0.2, FL * 3, FZ - RZ1, 3, 3), x, 0, (RZ1 + FZ) / 2)
  for (let f = 1; f < 3; f++) {
    K.put(stone, flatGeo(THREE, LX1 - LX0, FZ - RZ1, 3), (LX0 + LX1) / 2, f * FL + 0.25, (RZ1 + FZ) / 2)
    K.put(ceilingMat, flatGeo(THREE, LX1 - LX0, FZ - RZ1, 2).rotateX(Math.PI), (LX0 + LX1) / 2, (f + 1) * FL, (RZ1 + FZ) / 2)
    K.put(plasterW, boxGeo(THREE, LX1 - LX0, FL, 0.2, 3, 3), (LX0 + LX1) / 2, f * FL, RZ1)
    K.put(std(THREE, 0x8e8a84, 0.8), new THREE.BoxGeometry(LX1 - LX0, 0.25, FZ - RZ1), (LX0 + LX1) / 2, f * FL + 0.125, (RZ1 + FZ) / 2)
  }
  const lobbyDowns = []
  for (let f = 0; f < 3; f++) for (let x = LX0 + 1.5; x < LX1; x += 2.4) for (const z of [RZ1 + 2, RZ1 + 5.5]) lobbyDowns.push({ x, y: (f + 1) * FL - 0.005, z })
  scatter(THREE, inside, new THREE.CircleGeometry(0.08, 14).rotateX(Math.PI / 2), lampMat, lobbyDowns, { cast: false, receive: false })
  for (const x of [-12, -2, 8]) {
    const l = new THREE.PointLight(0xfff0dc, 10, 12, 2)
    l.position.set(x, FL - 0.3, 4)
    inside.add(l)
  }
  // a white round column, the reception counter, a stair with oak treads
  K.put(plasterW, new THREE.CylinderGeometry(0.32, 0.32, FL * 3, 20).translate(0, (FL * 3) / 2, 0), 3.6, 0, 3.4)
  K.put(std(THREE, 0xe9e5dd, 0.4), boxGeo(THREE, 4.2, 1.05, 0.7), 8.2, 0, 2.2)
  K.put(std(THREE, 0x3a3a3c, 0.35, 0.2), boxGeo(THREE, 4.3, 0.04, 0.8), 8.2, 1.05, 2.2)
  const oak = std(THREE, 0x9a6a3e, 0.45)
  for (let i = 0; i < 22; i++) K.put(oak, new THREE.BoxGeometry(1.4, 0.05, 0.3), -15.6, 0.19 * (i + 1), 1.1 + i * 0.27)
  K.strut(blackMetal, V(-16.3, 0.0, 0.9), V(-16.3, 4.2, 7.0), 0.08, 0.25)
  K.strut(blackMetal, V(-14.9, 0.0, 0.9), V(-14.9, 4.2, 7.0), 0.08, 0.25)
  // a mat and a plant inside the door
  K.put(std(THREE, 0x262626, 0.98), flatGeo(THREE, 4, 2.4, 1), 0, 0.01, FZ - 2.2)
  addForest(THREE, inside, [{ x: 12.2, z: 6.6, y: 0.45, h: 2.4 }], { species: 'olive', seed: 4, quality: q })
  K.put(std(THREE, 0x2a2a2a, 0.6), new THREE.CylinderGeometry(0.4, 0.32, 0.5, 18).translate(0, 0.25, 0), 12.2, 0, 6.6)

  /* --- the street front ----------------------------------------------------- */

  // timber posts and transoms, glass, louvres, the letters, the door, the panel
  const timber = std(THREE, 0xffffff, 0.6, 0, { map: veneerTexture(THREE, { color: '#8a5a36', reveal: false, seed: 11, size: 128 }) })
  const steelFrame = std(THREE, 0x9fa3a6, 0.32, 0.85)
  const glass = new THREE.MeshStandardMaterial({ color: 0x2a3438, roughness: 0.04, metalness: 0.85, transparent: true, opacity: 0.32, envMapIntensity: 1.6, depthWrite: false })
  O.flags(glass, { cast: false, receive: false })
  const FX0 = -18
  const FX1 = 15
  const DR = 1.6
  const DHt = 2.42
  const posts = []
  for (let x = -16.8; x <= FX1; x += 2.4) posts.push(x)
  const FHT = FL * 3 + 0.6
  for (const x of posts) {
    // the post behind the revolving door starts above its canopy
    const y0 = Math.abs(x) < DR + 0.25 ? DHt + 0.4 : 0
    O.put(timber, boxGeo(THREE, 0.22, FHT - y0, 0.36), x, y0, FZ + 0.12)
  }
  for (const y of [GF, GF + 0.6, FL + GF - 0.2, FL * 2 + 0.25, FL * 2 + GF - 0.2, FL * 3 + 0.25, FHT - 0.3]) O.put(timber, boxGeo(THREE, FX1 - FX0, 0.16, 0.32), (FX0 + FX1) / 2, y, FZ + 0.1)
  for (const [x0, x1] of [
    [FX0, -4.15],
    [-3.0, -DR - 0.2],
    [DR + 0.2, FX1],
  ])
    O.put(timber, boxGeo(THREE, x1 - x0, 0.1, 0.3), (x0 + x1) / 2, 0, FZ + 0.1)
  // glass panes, leaving the revolving door's drum and the side door open
  const pane = (x0, x1, y0, y1) => O.put(glass, new THREE.PlaneGeometry(x1 - x0, y1 - y0).translate((x0 + x1) / 2, (y0 + y1) / 2, 0), 0, 0, FZ + 0.02)
  pane(FX0, -4.15, 0, GF)
  pane(-3.0, -1.78, 0, GF)
  pane(1.78, FX1, 0, GF)
  pane(-1.78, 1.78, 2.62, GF)
  pane(FX0, FX1, GF, FHT)
  // the side door: a timber frame, the leaf swung in, the fanlight open
  for (const x of [-4.15, -3.0]) O.put(timber, boxGeo(THREE, 0.1, GF, 0.2), x, 0, FZ + 0.05)
  O.put(timber, new THREE.BoxGeometry(1.1, 2.45, 0.06).translate(0.55, 1.225, 0), -4.1, 0, FZ - 0.05, 1.35)
  O.put(glass, new THREE.PlaneGeometry(0.82, 1.9).translate(0.55, 1.25, 0.04), -4.1, 0, FZ - 0.05, 1.35)
  O.put(std(THREE, 0xffffff, 0.6), new THREE.PlaneGeometry(0.3, 0.3).translate(0.55, 1.62, 0.045), -4.1, 0, FZ - 0.05, 1.35)
  // horizontal timber louvres on the outer bays
  for (const [x0, x1] of [
    [4.8, FX1],
    [FX0, -7.2],
  ]) {
    for (let y = GF + 0.15; y < FHT - 0.4; y += 0.62) O.put(timber, boxGeo(THREE, x1 - x0, 0.05, 0.42), (x0 + x1) / 2, y, FZ + 0.42)
  }
  // "Stadsloket": silver letters with depth (stacked layers)
  const letters = textTexture(THREE, 1024, 192, (g, w, h) => {
    g.clearRect(0, 0, w, h)
    g.fillStyle = '#ffffff'
    g.font = `600 ${Math.round(h * 0.78)}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('Stadsloket', w / 2, h * 0.52)
  })
  const LW = 4.7
  const letterGeo = new THREE.PlaneGeometry(LW, (LW * 192) / 1024)
  const silver = new THREE.MeshStandardMaterial({ map: letters, color: 0xf2f2f0, alphaTest: 0.5, roughness: 0.35, metalness: 0.35, envMapIntensity: 0.8 })
  const silverSide = new THREE.MeshStandardMaterial({ map: letters, color: 0x6c6e70, alphaTest: 0.5, roughness: 0.5, metalness: 0.6 })
  O.put(silver, letterGeo, 0, GF + 1.58, FZ + 0.5)
  for (let k = 1; k <= 4; k++) O.put(silverSide, letterGeo, 0, GF + 1.58 - k * 0.004, FZ + 0.5 - k * 0.018)
  // the revolving door: drum walls, posts, canopy ring, floor ring, wings
  const drumWall = (a0, a1) => new THREE.CylinderGeometry(DR, DR, DHt, 24, 1, true, a0, a1 - a0).translate(0, DHt / 2, 0)
  // openings face ±z (the street and the lobby): walls on the ±x sides
  O.put(glass, drumWall(Math.PI * 0.27, Math.PI * 0.73), 0, 0.02, FZ)
  O.put(glass, drumWall(Math.PI * 1.27, Math.PI * 1.73), 0, 0.02, FZ)
  for (const a of [0.27, 0.73, 1.27, 1.73]) {
    const ang = Math.PI * a
    O.put(steelFrame, new THREE.BoxGeometry(0.07, DHt, 0.07).translate(0, DHt / 2, 0), Math.sin(ang) * DR, 0.02, FZ + Math.cos(ang) * DR, ang)
  }
  O.put(steelFrame, new THREE.CylinderGeometry(DR + 0.12, DR + 0.12, 0.36, 36, 1, true).translate(0, 0.18, 0), 0, DHt, FZ)
  O.put(steelFrame, new THREE.CylinderGeometry(DR + 0.12, DR + 0.12, 0.02, 36).translate(0, 0.35, 0), 0, DHt, FZ)
  O.put(std(THREE, 0xdedfdd, 0.7), new THREE.CircleGeometry(DR, 36).rotateX(Math.PI / 2), 0, DHt - 0.001, FZ)
  O.put(std(THREE, 0x8c8f92, 0.4, 0.8), new THREE.RingGeometry(DR - 0.05, DR + 0.14, 40).rotateX(-Math.PI / 2), 0, 0.012, FZ)
  O.put(std(THREE, 0x2c2c2d, 0.95), new THREE.CircleGeometry(DR - 0.05, 36).rotateX(-Math.PI / 2), 0, 0.011, FZ)
  // two camera domes and red no-entry stickers on the drum
  for (const x of [-0.45, 0.45]) O.put(std(THREE, 0x1a1a1c, 0.15, 0.4), new THREE.SphereGeometry(0.075, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI), x, DHt + 0.33, FZ + DR + 0.12)
  const redSticker = std(THREE, 0xd8241f, 0.6)
  for (const a of [0.36, 1.64]) O.put(redSticker, new THREE.CylinderGeometry(DR + 0.005, DR + 0.005, 0.11, 10, 1, true, Math.PI * a - 0.18, 0.36).translate(0, 1.35, 0), 0, 0, FZ)
  const wings = new THREE.Group()
  {
    const W = toolkit(THREE, wings)
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2
      const g = new THREE.BoxGeometry(DR - 0.08, DHt - 0.1, 0.02).translate((DR - 0.08) / 2, (DHt - 0.1) / 2 + 0.05, 0)
      W.put(glass, g, 0, 0, 0, a)
      W.put(steelFrame, new THREE.BoxGeometry(0.05, DHt - 0.1, 0.05).translate(DR - 0.1, (DHt - 0.1) / 2 + 0.05, 0), 0, 0, 0, a)
      W.put(steelFrame, new THREE.BoxGeometry(DR - 0.1, 0.05, 0.05).translate((DR - 0.1) / 2, 0.08, 0), 0, 0, 0, a)
      W.put(steelFrame, new THREE.BoxGeometry(DR - 0.1, 0.035, 0.035).translate((DR - 0.1) / 2, 1.0, 0), 0, 0, 0, a)
    }
    W.put(steelFrame, new THREE.CylinderGeometry(0.06, 0.06, DHt, 12).translate(0, DHt / 2, 0))
    W.flags(glass, { cast: false, receive: false })
    W.flush()
    wings.traverse((o) => {
      if (o.isMesh) o.castShadow = false
    })
  }
  wings.position.set(0, 0, FZ)
  wings.rotation.y = Math.PI / 4
  outside.add(wings)
  // the red opening-hours panel to the right of the door
  const hours = textTexture(THREE, 256, 192, (g, w, h) => {
    g.fillStyle = '#e1251d'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#ffffff'
    g.font = 'bold 15px Helvetica, Arial, sans-serif'
    g.fillText('Openingstijden Stadsloket', 14, 26)
    g.font = '12px Helvetica, Arial, sans-serif'
    ;['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag'].forEach((d, i) => {
      g.fillText(d, 14, 52 + i * 15)
      g.fillText(i === 3 ? '09.00 – 20.00 uur' : '09.00 – 17.00 uur', 110, 52 + i * 15)
    })
    g.fillRect(150, 150, 70, 10)
  })
  O.put(new THREE.MeshStandardMaterial({ map: hours, roughness: 0.45 }), new THREE.PlaneGeometry(1.45, 1.05), 3.0, 1.95, FZ + 0.06)
  // a small blue wheelchair sign and pictograms by the side door
  O.put(std(THREE, 0x1f5fb5, 0.5), new THREE.PlaneGeometry(0.2, 0.2), -2.4, 1.75, FZ + 0.06)
  O.put(redSticker, new THREE.PlaneGeometry(0.42, 0.12), -2.4, 1.48, FZ + 0.06)

  // the pavement: red brick herringbone to the left, buff to the right, a tactile strip
  const brickRed = M.paving(THREE, { kind: 'herringbone', color: '#9a4b3c', joint: '#5f4a40', tile: 2, quality: q, seed: 24 })
  const brickBuff = M.paving(THREE, { kind: 'herringbone', color: '#c39a6a', joint: '#7a6550', tile: 2, quality: q, seed: 25 })
  O.put(brickRed, flatGeo(THREE, 40, 9, 2), -20 + 0.4, 0, FZ + 4.5)
  O.put(brickBuff, flatGeo(THREE, 20, 9, 2), 10.4, 0.002, FZ + 4.5)
  O.put(std(THREE, 0xe3e1da, 0.6), flatGeo(THREE, 0.3, 4.5, 1), 0.38, 0.006, FZ + DR + 2.3)
  const ribs = []
  for (let z = FZ + DR + 0.15; z < FZ + DR + 4.5; z += 0.3) for (const x of [0.29, 0.38, 0.47]) ribs.push({ x, y: 0.006, z })
  scatter(THREE, outside, new THREE.BoxGeometry(0.03, 0.012, 0.26), std(THREE, 0xc9c6bf, 0.55), ribs, { cast: false })
  // a red-bristled boot brush by the door
  O.put(std(THREE, 0x9a9da0, 0.4, 0.8), new THREE.BoxGeometry(0.55, 0.05, 0.32).translate(0, 0.025, 0), 4.9, 0, FZ + 1.0, -0.4)
  O.put(std(THREE, 0xc0282a, 0.95), new THREE.BoxGeometry(0.5, 0.16, 0.2).translate(0, 0.13, 0), 4.9, 0, FZ + 1.0, -0.4)
  // the street beyond: kerb, asphalt, the brick housing opposite (seen in the glass)
  const asphalt = M.asphalt(THREE, { color: '#3e3e40', tile: 6, quality: q, seed: 26 })
  O.put(std(THREE, 0x8d8a84, 0.8), boxGeo(THREE, 60, 0.12, 0.3), -1, 0, FZ + 9.1)
  O.put(asphalt, flatGeo(THREE, 80, 10, 6), -1, -0.02, FZ + 14.2)
  O.put(brickRed, flatGeo(THREE, 80, 6, 2), -1, 0, FZ + 22)
  const fHouse = M.facade(THREE, { wall: 'brick', color: '#8a4a36', mortar: '#a69684', frame: '#2a2a2a', glass: '#1e262d', bay: 3.2, storey: 3, window: { w: 0.6, h: 0.62, bars: null, sill: true, lintel: false }, curtains: 0.3, quality: q, seed: 27 })
  O.put(fHouse.material, boxGeo(THREE, 64, 15, 14, fHouse.tile[0] * 2, fHouse.tile[1] * 2, [0, 1, 4, 5]), -2, 0, FZ + 32)
  // the city hall's own brick returns either side of the glazing, and a roof line
  const brickWall = M.brick(THREE, { color: '#8e4632', mortar: '#a8988a', tile: 2, quality: q, seed: 28 })
  O.put(brickWall, boxGeo(THREE, 12, FHT + 2, 14, 2, 2), FX0 - 6, 0, FZ - 6.9)
  O.put(brickWall, boxGeo(THREE, 14, FHT + 2, 14, 2, 2), FX1 + 7, 0, FZ - 6.9)
  O.put(std(THREE, 0x55585c, 0.6, 0.4), boxGeo(THREE, FX1 - FX0 + 0.4, 0.5, 0.7), (FX0 + FX1) / 2, FHT, FZ + 0.1)
  // bikes against the wall to the left, a street tree to the right
  const bikes = []
  const bikeCols = [0x1b1c1e, 0x2a3b4c, 0x5a1e1e, 0xd9d4c8, 0x2b2b2b]
  for (let i = 0; i < 5; i++) bikes.push({ x: -11 - i * 0.8, y: 0, z: FZ + 1.3, ry: Math.PI / 2 + range(rand, -0.1, 0.1), color: pick(rand, bikeCols) })
  scatter(THREE, outside, bikeGeometry(THREE), std(THREE, 0xffffff, 0.45, 0.5), bikes)
  addForest(THREE, outside, [{ x: 9.5, z: FZ + 8.2, h: 9 }, { x: -14, z: FZ + 8.4, h: 8.5 }], { species: 'lime', season: 'summer', seed: 9, quality: q })

  for (const m of [lampMat]) K.flags(m, { cast: false, receive: false })
  K.flags(parquet, { cast: false })
  K.flags(ceilingMat, { cast: false })
  K.flags(stone, { cast: false })
  K.flush()
  O.flags(brickRed, { cast: false })
  O.flags(brickBuff, { cast: false })
  O.flags(asphalt, { cast: false })
  O.flush()

  // the room's own reflections
  const env = roomProbe(THREE, {
    floor: [0.42, 0.26, 0.14],
    wall: [0.62, 0.5, 0.38],
    ceil: [1.1, 1.05, 0.98],
    lamps: [
      { dir: V(0.3, 0.9, 0.3).normalize(), color: [1, 0.9, 0.75], k: 30, size: 600 },
      { dir: V(-0.3, 0.9, -0.3).normalize(), color: [1, 0.9, 0.75], k: 30, size: 600 },
      { dir: V(0, 0.95, 0.31).normalize(), color: [1, 0.9, 0.75], k: 26, size: 600 },
    ],
    low,
  })
  applyEnv(inside, env, 1)

  world.focusShadows(V(0, 2, FZ + 3), 22)

  return {
    scene,
    world,
    path: { positions: arrival, targets: [V(RX, 1.4, -8), V(RX, 1.2, -7), V(RX + 0.2, 0.9, -6.6), V(RX + 0.3, 0.8, -6.4), spots[0].look.clone()], fov: 52, near: 0.08, spots },
    groundAt: () => 0,
    clearance: 0.9,
    update(t) {
      wings.rotation.y = Math.PI / 4 + t * 0.22
    },
  }
}

/**
 * An aluminium-group office chair, facing +z: `pads` (ribbed black leather
 * seat and high back, arm pads) and `frame` (polished side rails, arms,
 * column, four-star base with castors). Seat height 0.46 m.
 */
function eamesChair(THREE) {
  const pads = []
  const frame = []
  for (let i = 0; i < 5; i++) pads.push(new THREE.BoxGeometry(0.44, 0.045, 0.088).translate(0, 0.47, -0.19 + i * 0.09))
  const back = 0.2 // recline
  for (let i = 0; i < 8; i++) {
    const y = 0.56 + i * 0.082
    pads.push(new THREE.BoxGeometry(0.44, 0.078, 0.04).rotateX(-back).translate(0, y, -0.24 - (y - 0.56) * Math.tan(back)))
  }
  for (const s of [-1, 1]) pads.push(new THREE.BoxGeometry(0.05, 0.025, 0.26).translate(s * 0.29, 0.665, 0.0))
  const tube = (a, b, r) => {
    const A = new THREE.Vector3(...a)
    const B = new THREE.Vector3(...b)
    const d = new THREE.Vector3().subVectors(B, A)
    const len = d.length()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
    frame.push(new THREE.CylinderGeometry(r, r, len, 6, 1, true).applyQuaternion(q).translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2))
  }
  for (const s of [-1, 1]) {
    const x = s * 0.235
    tube([x, 0.455, 0.23], [x, 0.45, -0.22], 0.014)
    tube([x, 0.45, -0.22], [x, 1.2, -0.37], 0.016)
    tube([s * 0.29, 0.65, 0.12], [s * 0.29, 0.65, -0.12], 0.012)
    tube([s * 0.29, 0.65, -0.12], [x, 0.5, -0.2], 0.012)
    tube([s * 0.29, 0.65, 0.1], [x, 0.455, 0.12], 0.012)
  }
  tube([-0.235, 0.45, 0.0], [0.235, 0.45, 0.0], 0.012)
  tube([0, 0.08, 0], [0, 0.44, 0], 0.028)
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4
    frame.push(new THREE.BoxGeometry(0.34, 0.035, 0.05).translate(0.17, 0.08, 0).rotateY(a))
    frame.push(new THREE.SphereGeometry(0.03, 8, 6).translate(Math.cos(a) * 0.33, 0.03, -Math.sin(a) * 0.33))
  }
  return { pads: mergeParts(THREE, pads), frame: mergeParts(THREE, frame) }
}

/** A Dutch city bike, wheels at y 0.35, along x. */
function bikeGeometry(THREE) {
  const parts = []
  const tube = (a, b, r = 0.018) => {
    const A = new THREE.Vector3(...a)
    const B = new THREE.Vector3(...b)
    const d = new THREE.Vector3().subVectors(B, A)
    const len = d.length()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
    parts.push(new THREE.CylinderGeometry(r, r, len, 5, 1, true).applyQuaternion(q).translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2))
  }
  parts.push(new THREE.TorusGeometry(0.33, 0.024, 5, 20).translate(-0.53, 0.35, 0))
  parts.push(new THREE.TorusGeometry(0.33, 0.024, 5, 20).translate(0.55, 0.35, 0))
  tube([-0.02, 0.3, 0], [-0.53, 0.35, 0])
  tube([-0.2, 0.84, 0], [-0.53, 0.35, 0], 0.014)
  tube([-0.02, 0.3, 0], [-0.2, 0.86, 0], 0.02)
  tube([0.4, 0.92, 0], [0.16, 0.42, 0], 0.024)
  tube([0.16, 0.42, 0], [-0.02, 0.3, 0], 0.024)
  tube([0.4, 0.92, 0], [0.55, 0.35, 0])
  tube([0.4, 0.92, 0], [0.36, 1.06, 0])
  tube([0.36, 1.06, 0], [0.2, 1.08, 0.28])
  tube([0.36, 1.06, 0], [0.2, 1.08, -0.28])
  parts.push(new THREE.BoxGeometry(0.26, 0.06, 0.15).translate(-0.22, 0.91, 0))
  parts.push(new THREE.BoxGeometry(0.46, 0.025, 0.28).translate(-0.48, 0.78, 0))
  return mergeParts(THREE, parts)
}

/* ======================================================================== */
/* 2. The restaurant: the long table                                        */
/* ======================================================================== */

function buildRestaurant(THREE, ctx) {
  const low = ctx.quality === 'low'
  const q = ctx.quality
  const world = createWorld(THREE, ctx, 'interior', {
    sun: { elevation: -8, azimuth: 250 },
    sunIntensity: 0.0,
    sky: { zenith: 0x0b1020, horizon: 0x1a1d2a, ground: 0x0d0d10, clouds: 0.1 },
    hemi: [0xffd9a8, 0x3a2a1c, 0.55],
  })
  const { scene } = world
  const room = new THREE.Group()
  scene.add(room)
  const K = toolkit(THREE, room)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const rand = seeded(1414)

  // the long table runs along −z from the camera; the room around it
  const X0 = -6.5
  const X1 = 6.5
  const Z0 = -12
  const Z1 = 3.5
  const H = 4.6
  const T0 = 0.4 // table's near end
  const TL = 6.6 // its length (four tables)
  const TW = 0.86
  const TY = 0.75

  const S0 = V(0.25, 1.42, 1.75)
  const spots = [
    { pos: S0, look: V(-0.05, 0.62, -5.4) }, // 0 · photo 14: from the head of the table, down its length to the plants
    { pos: V(-2.7, 1.55, -1.2), look: V(0.6, 0.8, -4.2) }, // 1 · from the side, by the olive tree
    { pos: V(1.4, 1.6, -7.9), look: V(-0.4, 0.8, 0.6) }, // 2 · from the far end, back up the table
  ]
  const arrival = [V(0.6, 2.4, 3.2), V(0.5, 2.0, 2.8), V(0.35, 1.7, 2.3), V(0.28, 1.5, 1.95), S0.clone()]

  /* --- materials -------------------------------------------------------- */

  const floorMat = M.floor(THREE, { kind: 'tile', color: '#3e3934', tileSize: 0.6, polish: 0.7, tile: 3, quality: q, seed: 41 })
  const oakTop = new THREE.MeshStandardMaterial({ map: veneerTexture(THREE, { color: '#d39a45', reveal: false, seed: 42, size: low ? 128 : 256 }), roughness: 0.38, metalness: 0, envMapIntensity: 1.1 })
  const darkWall = M.plaster(THREE, { color: '#3a332c', dirt: 0.1, tile: 3, quality: q, seed: 45 })
  const whiteWall = M.plaster(THREE, { color: '#e6e1d8', dirt: 0.04, tile: 3, quality: q, seed: 43 })
  const teak = new THREE.MeshStandardMaterial({ map: veneerTexture(THREE, { color: '#c06a2a', reveal: true, seed: 44, size: 128 }), roughness: 0.45 })
  const blackMetal = std(THREE, 0x161616, 0.5, 0.6)
  const wicker = new THREE.MeshStandardMaterial({
    color: 0x77746d,
    roughness: 0.9,
    side: THREE.DoubleSide,
    normalMap: noiseNormalMap(THREE, low ? 64 : 128, { cells: 16, strength: 1.4, octaves: 2, stretch: [1, 3] }),
    normalScale: new THREE.Vector2(0.8, 0.8),
  })
  const napkin = std(THREE, 0xf6f4ef, 0.8)
  const cutlery = std(THREE, 0xdfe2e5, 0.18, 1)
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xdfe8ea, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.28, envMapIntensity: 2.2, depthWrite: false })
  const waterMat = new THREE.MeshStandardMaterial({ color: 0xc8dade, roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false })
  const ceramicW = std(THREE, 0xf3f1ec, 0.3)
  const ceramicB = std(THREE, 0x1a1a1a, 0.35)
  const brass = std(THREE, 0xc89a52, 0.3, 1)
  const menu = new THREE.MeshStandardMaterial({
    map: textTexture(THREE, 128, 192, (g, w, h) => {
      g.fillStyle = '#f5f2ea'
      g.fillRect(0, 0, w, h)
      g.fillStyle = 'rgba(30,30,30,0.8)'
      const r = seeded(5)
      for (let y = 16; y < h - 30; y += 7) g.fillRect(10, y, 40 + r() * 60, 2)
      g.fillStyle = '#2f6b35'
      g.fillRect(0, h - 26, w, 26)
    }),
    roughness: 0.8,
    side: THREE.DoubleSide,
  })
  for (const m of [glassMat, waterMat]) K.flags(m, { cast: false, receive: false })

  /* --- the room ---------------------------------------------------------------- */

  K.put(floorMat, flatGeo(THREE, X1 - X0, Z1 - Z0, 4), 0, 0, (Z0 + Z1) / 2)
  K.put(darkWall, flatGeo(THREE, X1 - X0, Z1 - Z0, 4).rotateX(Math.PI), 0, H, (Z0 + Z1) / 2)
  K.put(darkWall, boxGeo(THREE, X1 - X0, H, 0.2, 3, 3), 0, 0, Z0)
  K.put(darkWall, boxGeo(THREE, 0.2, H, Z1 - Z0, 3, 3), X0, 0, (Z0 + Z1) / 2)
  K.put(darkWall, boxGeo(THREE, X1 - X0, H, 0.2, 3, 3), 0, 0, Z1)
  // the right-hand side: a white wall above an orange teak-clad pier, the service corner
  K.put(whiteWall, boxGeo(THREE, 0.2, H, Z1 - Z0, 3, 3), X1, 0, (Z0 + Z1) / 2)
  K.put(teak, boxGeo(THREE, 0.9, H - 0.6, 1.1, 0.6, H - 0.6), X1 - 0.6, 0, -1.6)
  K.put(teak, boxGeo(THREE, 0.9, H - 0.6, 1.1, 0.6, H - 0.6), X1 - 0.6, 0, -6.4)
  K.put(std(THREE, 0xeeeeea, 0.5), boxGeo(THREE, 1.4, 1.0, 0.7), X1 - 1.2, 0, -4.0)
  K.put(std(THREE, 0x4a4c4e, 0.4, 0.7), boxGeo(THREE, 1.5, 0.05, 0.75), X1 - 1.2, 1.0, -4.0)
  K.put(std(THREE, 0x1b1b1b, 0.5), new THREE.BoxGeometry(0.22, 0.34, 0.2), X1 - 0.3, 2.55, -2.8)
  // the gong on its black stand
  {
    const gx = X1 - 1.0
    const gz = -0.4
    for (const s of [-1, 1]) K.put(blackMetal, boxGeo(THREE, 0.07, 1.7, 0.07), gx, 0, gz + s * 0.55)
    K.put(blackMetal, new THREE.BoxGeometry(0.08, 0.08, 1.3), gx, 1.72, gz)
    for (const s of [-1, 1]) K.put(blackMetal, new THREE.SphereGeometry(0.06, 10, 8), gx, 1.78, gz + s * 0.65)
    K.put(std(THREE, 0x3a2c1e, 0.32, 0.9), new THREE.CylinderGeometry(0.42, 0.42, 0.03, 32).rotateZ(Math.PI / 2), gx, 1.18, gz)
    K.put(brass, new THREE.CylinderGeometry(0.12, 0.12, 0.04, 20).rotateZ(Math.PI / 2), gx + 0.01, 1.18, gz)
  }
  // back of the room: shelving, a coat rack heavy with coats, brass pendants
  for (let i = 0; i < 4; i++) K.put(std(THREE, 0x3b2d22, 0.6), boxGeo(THREE, 3.2, 0.04, 0.35), -2.6, 0.9 + i * 0.6, Z0 + 0.3)
  for (const x of [-4.2, -1.0]) K.put(blackMetal, boxGeo(THREE, 0.04, 2.8, 0.04), x, 0, Z0 + 0.3)
  K.put(blackMetal, new THREE.BoxGeometry(1.8, 0.03, 0.03), -4.6, 1.85, -4.0)
  for (const x of [-5.5, -3.7]) K.put(blackMetal, boxGeo(THREE, 0.03, 1.85, 0.03), x, 0, -4.0)
  const coats = []
  const coatCols = [0x4a2420, 0x2e2d2c, 0x5a3a22, 0x1f2228, 0x55504a, 0x6a4626]
  for (let i = 0; i < 6; i++) coats.push({ x: -5.35 + i * 0.3, y: 0.78, z: -4.0 + range(rand, -0.06, 0.06), ry: range(rand, -0.3, 0.3), sx: range(rand, 0.85, 1.05), color: coatCols[i] })
  scatter(THREE, room, mergeParts(THREE, [new THREE.CylinderGeometry(0.11, 0.2, 1.0, 10).scale(1, 1, 0.55).translate(0, 0.5, 0), new THREE.SphereGeometry(0.12, 10, 8).scale(1.3, 0.5, 0.7).translate(0, 1.0, 0)]), std(THREE, 0xffffff, 0.92), coats)
  // pendant lamps in the dark back room and over the table
  const pend = []
  for (const [x, y, z] of [
    [-2.4, 3.3, -9.0],
    [-1.2, 3.0, -9.6],
    [0.2, 3.5, -10.2],
    [-3.4, 3.7, -10.6],
    [2.1, 3.1, -9.3],
  ])
    pend.push({ x, y, z })
  scatter(THREE, room, new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), brass, pend, { cast: false })
  const bulb = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc27a).multiplyScalar(2.6) })
  K.flags(bulb, { cast: false, receive: false })
  scatter(THREE, room, new THREE.CircleGeometry(0.1, 14).rotateX(Math.PI / 2), bulb, pend.map((p) => ({ ...p, y: p.y - 0.005 })), { cast: false, receive: false })
  for (const p of pend) K.put(blackMetal, new THREE.CylinderGeometry(0.004, 0.004, H - p.y, 4).translate(0, (H - p.y) / 2, 0), p.x, p.y, p.z)
  // the light: warm downlights over the table, the pendants, a glow off the white wall
  for (const [x, y, z, i, d] of [
    [0, H - 0.3, -0.6, 14, 9],
    [0, H - 0.3, -3.6, 14, 9],
    [0, H - 0.3, -6.6, 10, 9],
    [-1.4, 3.0, -9.6, 4, 6],
    [4.8, 3.2, -2.5, 6, 7],
    [-4.6, 2.6, -1.5, 4, 5],
  ]) {
    const l = new THREE.PointLight(0xffc98f, i, d, 2)
    l.position.set(x, y, z)
    room.add(l)
  }
  const downs = []
  for (const z of [-0.6, -2.1, -3.6, -5.1, -6.6]) downs.push({ x: 0, y: H - 0.005, z })
  scatter(THREE, room, new THREE.CircleGeometry(0.07, 14).rotateX(Math.PI / 2), bulb, downs, { cast: false, receive: false })

  /* --- the table ---------------------------------------------------------------- */

  for (let i = 0; i < 4; i++) {
    const zc = T0 - (i + 0.5) * (TL / 4)
    K.put(oakTop, boxGeo(THREE, TW, 0.04, TL / 4 - 0.006, 0.86, 1.6), 0, TY - 0.04, zc)
    for (const sx of [-0.38, 0.38]) for (const sz of [-0.74, 0.74]) K.put(blackMetal, boxGeo(THREE, 0.04, TY - 0.04, 0.04), sx, 0, zc + sz)
  }
  // fourteen places: a folded napkin, fork, knife and spoon, a water glass
  const places = []
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) places.push({ x: s * 0.26, z: T0 - 0.55 - i * 0.92, s })
  const napkins = []
  const forks = []
  const glasses = []
  for (const p of places) {
    napkins.push({ x: p.x, y: TY + 0.008, z: p.z, ry: range(rand, -0.06, 0.06) })
    forks.push({ x: p.x + p.s * 0.02, y: TY + 0.02, z: p.z - 0.04, ry: Math.PI / 2 + range(rand, -0.05, 0.05) })
    forks.push({ x: p.x - p.s * 0.02, y: TY + 0.02, z: p.z + 0.04, ry: Math.PI / 2 + range(rand, -0.05, 0.05) })
    glasses.push({ x: p.x - p.s * 0.12, y: TY, z: p.z - 0.22 })
  }
  scatter(THREE, room, new THREE.BoxGeometry(0.3, 0.016, 0.16), napkin, napkins, { cast: true })
  scatter(THREE, room, new THREE.BoxGeometry(0.2, 0.006, 0.018), cutlery, forks, { cast: false })
  const tumbler = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.032, 0), new THREE.Vector2(0.036, 0.004), new THREE.Vector2(0.042, 0.09), new THREE.Vector2(0.04, 0.095)], 18)
  scatter(THREE, room, tumbler, glassMat, glasses, { cast: false, receive: false })
  // carafes, salt and pepper mills, candles, menus — between every other pair
  const carafes = []
  const mills = []
  const mills2 = []
  const candles = []
  const menus = []
  for (let i = 0; i < 4; i++) {
    const z = T0 - 1.0 - i * 1.75
    carafes.push({ x: 0.04, y: TY, z })
    mills.push({ x: -0.06, y: TY, z: z - 0.28 })
    mills2.push({ x: 0.05, y: TY, z: z - 0.32 })
    candles.push({ x: 0.0, y: TY, z: z + 0.42 })
    menus.push({ x: 0.06 * (i % 2 ? 1 : -1), y: TY + 0.11, z: z - 0.62, ry: Math.PI / 2 + range(rand, -0.3, 0.3) })
  }
  const carafe = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.05, 0), new THREE.Vector2(0.055, 0.04), new THREE.Vector2(0.055, 0.17), new THREE.Vector2(0.03, 0.22), new THREE.Vector2(0.022, 0.27), new THREE.Vector2(0.024, 0.28)], 18)
  scatter(THREE, room, carafe, glassMat, carafes, { cast: false, receive: false })
  scatter(THREE, room, new THREE.CylinderGeometry(0.048, 0.048, 0.15, 14).translate(0, 0.08, 0), waterMat, carafes, { cast: false, receive: false })
  scatter(THREE, room, new THREE.CylinderGeometry(0.024, 0.026, 0.13, 12).translate(0, 0.065, 0), ceramicW, mills, { cast: false })
  scatter(THREE, room, new THREE.CylinderGeometry(0.024, 0.026, 0.13, 12).translate(0, 0.065, 0), ceramicB, mills2, { cast: false })
  scatter(THREE, room, new THREE.BoxGeometry(0.09, 0.1, 0.09).translate(0, 0.05, 0), glassMat, candles, { cast: false, receive: false })
  const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb15a).multiplyScalar(3.2) })
  scatter(THREE, room, new THREE.SphereGeometry(0.012, 8, 6).scale(1, 1.8, 1).translate(0, 0.06, 0), flame, candles, { cast: false, receive: false })
  scatter(THREE, room, new THREE.PlaneGeometry(0.16, 0.22), menu, menus, { cast: false })
  // phones and a beaded bag left on the table
  K.put(std(THREE, 0x111111, 0.2, 0.4), new THREE.BoxGeometry(0.075, 0.008, 0.155), 0.3, TY + 0.004, -4.35, 0.3)
  K.put(std(THREE, 0x7ab0d8, 0.3), new THREE.BoxGeometry(0.075, 0.008, 0.155), -0.22, TY + 0.004, -2.6, -0.2)
  K.put(std(THREE, 0xe8e2d6, 0.5), new THREE.TorusGeometry(0.05, 0.016, 6, 16).rotateX(Math.PI / 2), 0.22, TY + 0.016, -0.95)

  // grey woven armchairs, pushed back a little as if everyone just stood up
  const chairs = []
  for (let i = 0; i < 7; i++) {
    for (const s of [-1, 1]) {
      const z = T0 - 0.55 - i * 0.92 + range(rand, -0.06, 0.06)
      chairs.push({ x: s * (0.82 + range(rand, 0, 0.22)), z, ry: (s < 0 ? Math.PI / 2 : -Math.PI / 2) + range(rand, -0.25, 0.25) })
    }
  }
  // a woven tub chair: a rounded seat drum, a cushion, a curved back that wraps into the arms
  const chairGeo = mergeParts(THREE, [
    new THREE.CylinderGeometry(0.3, 0.25, 0.4, 18).translate(0, 0.2, 0),
    new THREE.CylinderGeometry(0.27, 0.27, 0.06, 18).translate(0, 0.43, 0.01),
    new THREE.CylinderGeometry(0.31, 0.3, 0.36, 18, 1, true, Math.PI * 0.45, Math.PI * 1.1).translate(0, 0.58, 0),
    new THREE.CylinderGeometry(0.27, 0.27, 0.36, 18, 1, true, Math.PI * 0.45, Math.PI * 1.1).translate(0, 0.58, 0),
    new THREE.TorusGeometry(0.29, 0.025, 6, 18, Math.PI * 1.1).rotateX(Math.PI / 2).rotateY(-Math.PI * 0.95).translate(0, 0.76, 0),
  ])
  // chairs face +z in their own frame; turn so they face the table
  scatter(THREE, room, chairGeo, wicker, chairs)
  // coats and a scarf on some chair backs
  const backs = []
  for (const i of [1, 4, 6, 9, 12]) {
    const c = chairs[i]
    backs.push({ x: c.x - Math.sin(c.ry) * 0.3, y: 0.5, z: c.z - Math.cos(c.ry) * 0.3, ry: c.ry, color: pick(rand, coatCols) })
  }
  scatter(THREE, room, new THREE.BoxGeometry(0.5, 0.45, 0.07), std(THREE, 0xffffff, 0.92), backs)

  // plants: a big olive tree hung with fairy lights, a tall leafy one behind the table
  const planter = std(THREE, 0x2b2a28, 0.7)
  for (const [x, z, r, h] of [
    [-3.8, -1.2, 0.55, 0.6],
    [0.9, -8.6, 0.45, 0.55],
    [-1.6, -8.9, 0.4, 0.5],
  ])
    K.put(planter, new THREE.CylinderGeometry(r, r * 0.85, h, 20).translate(0, h / 2, 0), x, 0, z)
  addForest(THREE, room, [{ x: -3.8, z: -1.2, y: 0.55, h: 4.1 }], { species: 'olive', seed: 14, quality: q })
  addForest(THREE, room, [{ x: 0.9, z: -8.6, y: 0.5, h: 3.9 }, { x: -1.6, z: -8.9, y: 0.45, h: 3.2 }], { species: 'lime', seed: 15, quality: q })
  const fairy = []
  for (let i = 0; i < (low ? 60 : 140); i++) {
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * 1.5
    fairy.push(V(-3.8 + Math.cos(a) * r, 1.6 + rand() * 2.4, -1.2 + Math.sin(a) * r))
  }
  const fg = new THREE.BufferGeometry().setFromPoints(fairy)
  const fairyPts = new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.09, map: glowTexture(THREE, 'rgba(255,200,120,1)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.8, 1.4, 0.9) }))
  room.add(fairyPts)

  K.flags(floorMat, { cast: false })
  K.flags(darkWall, { cast: false })
  K.flags(whiteWall, { cast: false })
  K.flush()

  const env = roomProbe(THREE, {
    floor: [0.12, 0.1, 0.08],
    wall: [0.18, 0.13, 0.09],
    ceil: [0.1, 0.08, 0.06],
    lamps: [
      { dir: V(0, 1, 0), color: [1, 0.8, 0.55], k: 40, size: 300 },
      { dir: V(0, 0.4, -0.9).normalize(), color: [1, 0.75, 0.45], k: 16, size: 120 },
      { dir: V(0.9, 0.2, 0.2).normalize(), color: [0.9, 0.85, 0.8], k: 3, size: 6 },
    ],
    low,
  })
  applyEnv(room, env, 1)
  world.focusShadows(V(0, 1, -3), 10)

  return {
    scene,
    world,
    path: { positions: arrival, targets: [V(0, 1.2, -4), V(0, 1.0, -4.5), V(0, 0.8, -5), V(0, 0.7, -5.2), spots[0].look.clone()], fov: 54, near: 0.08, spots },
    groundAt: () => 0,
    clearance: 0.9,
    update(t) {
      fairyPts.material.opacity = 0.85 + Math.sin(t * 1.7) * 0.08
    },
  }
}
