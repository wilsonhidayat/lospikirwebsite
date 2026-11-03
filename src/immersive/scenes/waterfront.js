/**
 * The waterfront — three real places on a big city river, each its own build:
 *
 *  • 'waterfront-sunset' — Amsterdam, the south bank of the IJ at sunset: a
 *    concert hall's glass foyer under a huge dark cantilevered canopy, a steel
 *    stair with plate parapets climbing over the water to an upper gallery, a
 *    ferry pontoon, brick and glass blocks with balconies along the quay, and
 *    across the water the A'DAM Toren with its lookout, a white angular film
 *    museum, cranes and new housing. The sun sits low over the IJ.
 *  • 'waterfront-night' — Rotterdam at night by the Erasmusbrug: the white bent
 *    pylon, the fan of lit stays, the blue-grey deck with trams and traffic, De
 *    Rotterdam and the other Wilhelminapier towers lit across the Maas, quay
 *    lamps and a slanted-bar railing, long broken reflections on the river.
 *  • 'party-boat' — a 56 m river cruise boat moored at a timber jetty at
 *    night; its upper deck is a party room — dark low ceiling, violet and blue
 *    neon along the ceiling edges, a DJ booth with speakers, a red-lit bar and
 *    a glossy floor — that you can stand in.
 *
 * Metres. Water at y = 0. In every place the river runs along X; the viewer's
 * bank is on +Z.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createWorld, waterMaterial, nightWindows } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { beamBatch, paintTexture, seeded, range, pick, glowTexture, scaleBoxUVs } from '../utils.js'

export function buildWaterfront(THREE, ctx, opts = {}) {
  if (opts.partyBoat) return buildPartyBoat(THREE, ctx)
  if (opts.light === 'night' || opts.bridge) return buildRotterdam(THREE, ctx)
  return buildIJ(THREE, ctx)
}

/* ======================================================================== */
/* shared kit                                                               */
/* ======================================================================== */

/** Strip a geometry down to position/normal/uv, non-indexed, so any can merge. */
function prepGeo(THREE, geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone()
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
  }
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

/**
 * A static-geometry batcher: everything added with the same material is
 * merged into one mesh at flush() — one draw call per material, however many
 * pieces a place is built from.
 */
function toolkit(THREE, root) {
  const lists = new Map()
  const flagMap = new Map()
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const eul = new THREE.Euler()
  const p = new THREE.Vector3()
  const sc = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const zAxis = new THREE.Vector3(0, 0, 1)
  const yAxis = new THREE.Vector3(0, 1, 0)
  const one = new THREE.Vector3(1, 1, 1)
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
  /** Add geometry turned (ry, then rx/rz) and moved to (x, y, z). */
  function put(mat, geo, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    eul.set(rx, ry, rz, 'YXZ')
    q.setFromEuler(eul)
    m4.compose(p.set(x, y, z), q, one)
    putM(mat, geo, m4)
  }
  /** A box-section member from a to b (w across, d deep). */
  function strut(mat, a, b, w, d = w, uvTile = 0) {
    dir.subVectors(b, a)
    const len = dir.length() || 0.001
    q.setFromUnitVectors(zAxis, dir.normalize())
    m4.compose(p.addVectors(a, b).multiplyScalar(0.5), q, one)
    const geo = new THREE.BoxGeometry(w, d, len)
    if (uvTile) scaleBoxUVs(geo, w, d, len, uvTile, uvTile)
    putM(mat, geo, m4)
  }
  /** A round bar from a to b. */
  function rod(mat, a, b, r, seg = 6) {
    dir.subVectors(b, a)
    const len = dir.length() || 0.001
    q.setFromUnitVectors(yAxis, dir.normalize())
    m4.compose(p.addVectors(a, b).multiplyScalar(0.5), q, one)
    putM(mat, new THREE.CylinderGeometry(r, r, len, seg, 1, true), m4)
  }
  /** A box between two points of a slope in the XY plane (stairs, ramps). */
  function slopeX(mat, x0, y0, x1, y1, z, h, t, yOff = 0) {
    const len = Math.hypot(x1 - x0, y1 - y0)
    eul.set(0, 0, Math.atan2(y1 - y0, x1 - x0))
    q.setFromEuler(eul)
    m4.compose(p.set((x0 + x1) / 2, (y0 + y1) / 2 + yOff, z), q, sc.set(1, 1, 1))
    putM(mat, new THREE.BoxGeometry(len, h, t), m4)
  }
  function flush() {
    for (const [mat, arr] of lists) {
      if (!arr.length) continue
      const geo = arr.length === 1 ? arr[0] : mergeGeometries(arr, false)
      if (!geo) continue
      geo.computeBoundingSphere()
      const mesh = new THREE.Mesh(geo, mat)
      const f = flagMap.get(mat) || {}
      mesh.castShadow = f.cast !== false
      mesh.receiveShadow = f.receive !== false
      root.add(mesh)
    }
    lists.clear()
  }
  return { put, putM, strut, rod, slopeX, flush, flags: (mat, f) => flagMap.set(mat, f) }
}

/** A box sitting on y = 0 with UVs in metres / tile; `faces` picks faces (+x,−x,+y,−y,+z,−z). */
function boxGeo(THREE, w, h, d, tu = 1, tv = tu, faces = null, topTile = null) {
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
    const flat = f === 2 || f === 3
    const a = flat && topTile ? topTile : tu
    const b = flat && topTile ? topTile : tv
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / a, (uv.getY(i) * dims[f][1]) / b)
    }
  }
  if (faces) {
    const src = g.index.array
    const keep = []
    for (const f of faces) for (let k = 0; k < 6; k++) keep.push(src[f * 6 + k])
    g.setIndex(keep)
  }
  return g
}
const SIDES = [0, 1, 4, 5]
const TOP = [2]

/** A flat plane at y = 0 with UVs in metres / tile, long side along X if `alongX`. */
function flatGeo(THREE, w, d, tile = 4, alongX = false) {
  const g = alongX ? new THREE.PlaneGeometry(d, w) : new THREE.PlaneGeometry(w, d)
  const uv = g.attributes.uv
  const a = alongX ? d : w
  const b = alongX ? w : d
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * a) / tile, (uv.getY(i) * b) / tile)
  g.rotateX(-Math.PI / 2)
  if (alongX) g.rotateY(Math.PI / 2)
  return g
}

/**
 * Buildings from materials.js facades. (A facade texture holds 2 × 2 bays, so
 * the box UVs repeat every two bays / storeys.)
 */
function makeBuilding(THREE, K) {
  return function building({ x, z, w, d, h, ry = 0, y = 0, fac, roof = null, trim = null, shop = null }) {
    let base = 0
    if (shop) {
      base = shop.tile[1]
      K.put(shop.material, boxGeo(THREE, w, base, d, shop.tile[0] * 2, base, SIDES), x, y, z, ry)
    }
    K.put(fac.material, boxGeo(THREE, w, h - base, d, fac.tile[0] * 2, fac.tile[1] * 2, SIDES), x, y + base, z, ry)
    if (roof) K.put(roof, boxGeo(THREE, w, h, d, 1, 1, TOP, 6), x, y, z, ry)
    if (trim) {
      const c = Math.cos(ry)
      const s = Math.sin(ry)
      for (const [lx, lz, ww, dd] of [
        [0, d / 2, w + 0.3, 0.32],
        [0, -d / 2, w + 0.3, 0.32],
        [w / 2, 0, 0.32, d],
        [-w / 2, 0, 0.32, d],
      ]) {
        K.put(trim, new THREE.BoxGeometry(ww, 0.5, dd), x + lx * c + lz * s, y + h + 0.24, z - lx * s + lz * c, ry)
      }
    }
    return y + h
  }
}

/** Instances of one geometry: items { x, y, z, ry, rx, rz, s | sx sy sz, color }. */
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

/** Balconies (slab + glass balustrade) laid on a building's faces, instanced. */
function balconySet() {
  const items = []
  return {
    rows({ x, z, w, d, ry = 0, y = 0, bay, storey, from = 1, to, every = 2, phase = 0, faces = [-1], depth = 1.4, span = 0.86 }) {
      const c = Math.cos(ry)
      const s = Math.sin(ry)
      const n = Math.floor(w / bay + 1e-6)
      for (const side of faces) {
        for (let k = 0; k < n; k++) {
          if ((k + phase) % every) continue
          const lx = -w / 2 + (k + 0.5) * bay
          const lz = side * (d / 2 + depth / 2)
          for (let f = from; f < to; f++) {
            items.push({ x: x + lx * c + lz * s, y: y + f * storey, z: z - lx * s + lz * c, ry: ry + (side < 0 ? Math.PI : 0), sx: bay * span })
          }
        }
      }
    },
    build(THREE, root, slabMat, glassMat, depth = 1.4) {
      if (!items.length) return
      const slab = mergeParts(THREE, [
        new THREE.BoxGeometry(1, 0.22, depth).translate(0, 0.11, 0),
        new THREE.BoxGeometry(1, 0.05, 0.07).translate(0, 1.18, depth / 2 - 0.04),
      ])
      const glass = mergeParts(THREE, [
        new THREE.BoxGeometry(1, 0.95, 0.025).translate(0, 0.7, depth / 2 - 0.05),
        new THREE.BoxGeometry(0.02, 0.95, depth - 0.1).translate(0.49, 0.7, 0),
        new THREE.BoxGeometry(0.02, 0.95, depth - 0.1).translate(-0.49, 0.7, 0),
      ])
      scatter(THREE, root, slab, slabMat, items)
      scatter(THREE, root, glass, glassMat, items, { cast: false })
    },
  }
}

/** Soft additive glows (lamp heads, windows, signals) as one Points draw. */
function glowPoints(THREE, root, pts, { size = 3, opacity = 0.85 } = {}) {
  if (!pts.length) return null
  const pos = new Float32Array(pts.length * 3)
  const col = new Float32Array(pts.length * 3)
  const c = new THREE.Color()
  pts.forEach((p, i) => {
    pos[i * 3] = p.x
    pos[i * 3 + 1] = p.y
    pos[i * 3 + 2] = p.z
    c.set(p.color ?? 0xffc98a).multiplyScalar(p.k ?? 1)
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const mat = new THREE.PointsMaterial({
    size,
    map: glowTexture(THREE, 'rgba(255,255,255,1)'),
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    fog: false,
  })
  const points = new THREE.Points(g, mat)
  points.frustumCulled = false
  root.add(points)
  return points
}

/** Pools of lamplight on the ground: flat additive discs, instanced. */
function lightPools(THREE, root, list, { opacity = 0.3 } = {}) {
  if (!list.length) return null
  const mat = new THREE.MeshBasicMaterial({
    map: glowTexture(THREE, 'rgba(255,255,255,1)'),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
  })
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  return scatter(THREE, root, geo, mat, list.map((l) => ({ x: l.x, y: (l.y || 0) + 0.03, z: l.z, sx: l.r * 2, sz: l.r * 2, color: l.color ?? 0xffc98a })), { cast: false, receive: false })
}

/** Broken light streaks for reflections on night water. */
function streakTexture(THREE, seed = 3) {
  return paintTexture(
    THREE,
    64,
    512,
    (g, w, h) => {
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, h)
      const rand = seeded(seed)
      for (let i = 0; i < 900; i++) {
        const v = Math.pow(rand(), 1.6) // more dashes near the top (the light's end)
        const y = v * h
        const fade = Math.pow(1 - v, 1.4)
        const cw = w * (0.15 + rand() * 0.5) * (0.6 + (1 - fade) * 0.6)
        const x = w / 2 + (rand() - 0.5) * w * 0.5 - cw / 2
        const a = fade * (0.35 + rand() * 0.65)
        g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`
        g.fillRect(x, y, cw, 1 + rand() * 2.5)
      }
    },
    { kind: 'color' }
  )
}

/** Night reflections: one instanced, additive streak per light source. */
function reflections(THREE, root, list, { opacity = 0.75 } = {}) {
  if (!list.length) return null
  const tex = streakTexture(THREE)
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const mesh = scatter(
    THREE,
    root,
    geo,
    mat,
    list.map((r) => ({ x: r.x, y: 0.05 + (r.lift || 0), z: r.z + (r.dir ?? 1) * r.len / 2, ry: (r.dir ?? 1) > 0 ? 0 : Math.PI, sx: r.w, sz: r.len, color: new THREE.Color(r.color ?? 0xffc98a).multiplyScalar(r.k ?? 1) })),
    { cast: false, receive: false }
  )
  mesh.frustumCulled = false
  mesh.userData.tick = (t) => {
    tex.offset.y = (t * 0.05) % 1
    tex.offset.x = Math.sin(t * 0.7) * 0.03
  }
  return mesh
}

/** Flags: 'amsterdam' (red-black-red, three white crosses) or 'nl' (red-white-blue). */
function flagTexture(THREE, kind) {
  return paintTexture(
    THREE,
    192,
    128,
    (g, w, h) => {
      if (kind === 'nl') {
        ;['#ae1c28', '#f4f4f2', '#21468b'].forEach((c, i) => {
          g.fillStyle = c
          g.fillRect(0, (i * h) / 3, w, h / 3 + 1)
        })
        return
      }
      g.fillStyle = '#d0121e'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#0c0c0c'
      g.fillRect(0, h / 3, w, h / 3)
      g.strokeStyle = '#f2f2f2'
      g.lineWidth = h * 0.07
      for (let i = 0; i < 3; i++) {
        const cx = w * (0.25 + i * 0.25)
        const r = h * 0.12
        g.beginPath()
        g.moveTo(cx - r, h / 2 - r)
        g.lineTo(cx + r, h / 2 + r)
        g.moveTo(cx + r, h / 2 - r)
        g.lineTo(cx - r, h / 2 + r)
        g.stroke()
      }
    },
    { kind: 'color' }
  )
}

/** A waving flag on a pole. Returns { group, tick(t) }. */
function makeFlag(THREE, kind, { pole = 5, w = 1.5, h = 1, pivot = 0 } = {}) {
  const group = new THREE.Group()
  const poleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, pole, 6).translate(0, pole / 2, 0), new THREE.MeshStandardMaterial({ color: 0xdedcd6, roughness: 0.4, metalness: 0.6 }))
  poleMesh.castShadow = true
  const geo = new THREE.PlaneGeometry(w, h, 12, 6).translate(w / 2, 0, 0)
  const base = geo.attributes.position.array.slice()
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: flagTexture(THREE, kind), side: THREE.DoubleSide, roughness: 0.85 }))
  cloth.position.y = pole - h / 2 - 0.05
  cloth.rotation.y = pivot
  group.add(poleMesh, cloth)
  return {
    group,
    tick(t) {
      const a = geo.attributes.position.array
      for (let i = 0; i < a.length; i += 3) {
        const x = base[i]
        const k = x / w
        a[i + 2] = Math.sin(x * 3.2 - t * 5.5) * 0.12 * k + Math.sin(x * 7 - t * 9 + base[i + 1] * 2) * 0.03 * k
        a[i + 1] = base[i + 1] - k * k * 0.08
      }
      geo.attributes.position.needsUpdate = true
      geo.computeVertexNormals()
    },
  }
}

/** A Dutch city bike (step-through frame, rack, upright bars), wheels at y 0.35. */
function bikeGeometry(THREE) {
  const parts = []
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const yA = new THREE.Vector3(0, 1, 0)
  const tube = (a, b, r = 0.018) => {
    const A = new THREE.Vector3(...a)
    const B = new THREE.Vector3(...b)
    const d = new THREE.Vector3().subVectors(B, A)
    const len = d.length()
    q.setFromUnitVectors(yA, d.normalize())
    m4.compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1))
    parts.push(new THREE.CylinderGeometry(r, r, len, 5, 1, true).applyMatrix4(m4))
  }
  parts.push(new THREE.TorusGeometry(0.33, 0.024, 5, 20).translate(-0.53, 0.35, 0))
  parts.push(new THREE.TorusGeometry(0.33, 0.024, 5, 20).translate(0.55, 0.35, 0))
  const R = [-0.53, 0.35, 0]
  const F = [0.55, 0.35, 0]
  const B = [-0.02, 0.3, 0]
  const S = [-0.2, 0.86, 0]
  const H = [0.4, 0.92, 0]
  tube([-0.02, 0.3, 0.05], [-0.53, 0.35, 0.05])
  tube([-0.02, 0.3, -0.05], [-0.53, 0.35, -0.05])
  tube([-0.2, 0.84, 0.04], [-0.53, 0.35, 0.05], 0.014)
  tube([-0.2, 0.84, -0.04], [-0.53, 0.35, -0.05], 0.014)
  tube(B, S, 0.02)
  tube(H, [0.16, 0.42, 0], 0.024)
  tube([0.16, 0.42, 0], B, 0.024)
  tube(H, F, 0.018)
  tube(H, [0.36, 1.06, 0])
  tube([0.36, 1.06, 0], [0.2, 1.08, 0.28])
  tube([0.36, 1.06, 0], [0.2, 1.08, -0.28])
  tube([-0.53, 0.35, 0], [-0.62, 0.78, 0], 0.012)
  parts.push(new THREE.BoxGeometry(0.26, 0.06, 0.15).translate(-0.22, 0.91, 0))
  parts.push(new THREE.BoxGeometry(0.46, 0.025, 0.28).translate(-0.48, 0.78, 0))
  parts.push(new THREE.BoxGeometry(0.48, 0.1, 0.02).translate(-0.27, 0.33, 0.07))
  return mergeParts(THREE, parts)
}

/** Look target: `target`, swung `yaw` degrees left (+) or right (−) around the eye, raised by `lift`. */
function aim(THREE, pos, target, yaw = 0, lift = 0) {
  const d = new THREE.Vector3().subVectors(target, pos)
  d.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yaw))
  return pos.clone().add(d).add(new THREE.Vector3(0, lift, 0))
}

/** True when (x, z) is further than r (in plan) from every leg of the camera's tour. */
function clearOfTour(spots, extra = []) {
  const segs = []
  for (let i = 0; i < spots.length; i++) segs.push([spots[i].pos, spots[(i + 1) % spots.length].pos])
  for (let i = 0; i + 1 < extra.length; i++) segs.push([extra[i], extra[i + 1]])
  return (x, z, r) =>
    segs.every(([a, b]) => {
      const dx = b.x - a.x
      const dz = b.z - a.z
      const L = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L))
      return Math.hypot(a.x + dx * t - x, a.z + dz * t - z) > r
    })
}

/** A hull outline in plan: stern at x0 (rounded transom), bow at x1 (fine entry). */
function hullShape(THREE, x0, x1, half, bowStart) {
  const s = new THREE.Shape()
  const r = half * 0.55
  s.moveTo(x0 + r, -half)
  s.lineTo(bowStart, -half)
  s.bezierCurveTo(bowStart + (x1 - bowStart) * 0.55, -half, x1 - 0.6, -half * 0.42, x1, 0)
  s.bezierCurveTo(x1 - 0.6, half * 0.42, bowStart + (x1 - bowStart) * 0.55, half, bowStart, half)
  s.lineTo(x0 + r, half)
  s.quadraticCurveTo(x0 - 0.35, half, x0 - 0.45, 0)
  s.quadraticCurveTo(x0 - 0.35, -half, x0 + r, -half)
  return s
}
/** Extrude a plan shape upward from y0 to y1 (shape y → −z). */
function planExtrude(THREE, shape, y0, y1, curveSegments = 10) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments })
  g.rotateX(-Math.PI / 2)
  g.translate(0, y0, 0)
  return g
}

const std = (THREE, color, roughness = 0.6, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })

/* ======================================================================== */
/* 1. Amsterdam, the IJ at sunset                                           */
/* ======================================================================== */

function buildIJ(THREE, ctx) {
  const low = ctx.quality === 'low'
  const q = ctx.quality
  const world = createWorld(THREE, ctx, 'sunset', { sun: { elevation: 3.2, azimuth: 226 }, fog: { density: 0.00072 } })
  const { scene } = world
  const K = toolkit(THREE, scene)
  const building = makeBuilding(THREE, K)
  const rand = seeded(1975)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const QUAY = 1.8
  const NORTH = -430 // the far bank's quay edge

  /* --- the tour (defined first so props keep out of its way) ----------- */

  const tower = V(-190, 48, -560)
  const S0 = V(8, 6.2, 6)
  const spots = [
    { pos: S0, look: aim(THREE, S0, tower, 15, 4) }, // under the canopy: the stair over the water, the A'DAM Toren beyond
    { pos: V(60, 3.4, 4), look: V(-60, 9, -64) }, // along the quay edge toward the stair and the sunset
    { pos: V(66, 2.7, -14), look: V(-120, 14, -150) }, // on the ferry pontoon, the IJ and the sun
    { pos: V(-10, 4, -40), look: V(46, 9, 24) }, // from the water: the golden south bank, canopy and stair
    { pos: V(17.5, 3.5, -3.8), look: aim(THREE, V(17.5, 3.5, -3.8), V(-6, 11.4, -4.6), -8) }, // at the foot of the stair, looking up it
    { pos: V(-6, 11.6, -4), look: aim(THREE, V(-6, 11.6, -4), V(18, 1.2, -6), 12) }, // from the top: down the stair to the water
    { pos: V(-95, 3.5, 10), look: V(-170, 7, 46) }, // across the dock: the white footbridge and the warehouse
  ]
  const arrival = [V(300, 150, -520), V(150, 60, -250), V(50, 18, -60), V(19, 7.6, -6), S0.clone()]
  const clear = clearOfTour(spots, arrival.slice(2))

  /* --- materials -------------------------------------------------------- */

  const pave = M.paving(THREE, { kind: 'flags', color: '#8e877c', joint: '#544f48', unit: 0.6, tile: 4, quality: q, seed: 31 })
  const clinker = M.paving(THREE, { kind: 'herringbone', color: '#7c5446', joint: '#46382f', tile: 3, quality: q, seed: 32 })
  const quayWall = M.concrete(THREE, { color: '#5a5650', tile: 4, quality: q, seed: 33 })
  const conc = M.concrete(THREE, { color: '#b0a99f', tile: 4, quality: q, seed: 34 })
  const asphalt = M.asphalt(THREE, { color: '#3e3f42', tile: 6, quality: q, seed: 35 })
  const steelDark = std(THREE, 0x25272b, 0.5, 0.75)
  const steelMid = std(THREE, 0x4a4d52, 0.42, 0.85)
  const white = std(THREE, 0xeceae4, 0.4, 0.05)
  const trim = std(THREE, 0x8d8c88, 0.6, 0.3)
  const glassBal = std(THREE, 0x2c3a42, 0.06, 0.3, { transparent: true, opacity: 0.38, envMapIntensity: 1.3 })

  const fBrickRed = M.facade(THREE, { wall: 'brick', color: '#7b4636', mortar: '#9a8d80', frame: '#2a2a2a', glass: '#1c232a', bay: 3, storey: 3.1, window: { w: 0.62, h: 0.66, bars: null, sill: true, lintel: false }, curtains: 0.3, quality: q, seed: 41 })
  const fBrickDark = M.facade(THREE, { wall: 'brick', color: '#4e3a33', mortar: '#7d736a', frame: '#d8d3c8', glass: '#1d252c', bay: 2.7, storey: 3, window: { w: 0.52, h: 0.62, bars: 'sash', sill: true, lintel: true }, quality: q, seed: 42 })
  const fBrickBuff = M.facade(THREE, { wall: 'brick', color: '#9a8064', mortar: '#b9ad9c', frame: '#333333', glass: '#1e262d', bay: 3.6, storey: 3.1, window: { w: 0.72, h: 0.7, bars: null, sill: false, lintel: false }, curtains: 0.35, quality: q, seed: 43 })
  const fCurtain = M.facade(THREE, { wall: 'curtain', color: '#3a434b', frame: '#c4c6c4', glass: '#24313a', bay: 1.8, storey: 3.6, curtains: 0.1, quality: q, seed: 44 })
  const fWhite = M.facade(THREE, { wall: 'plaster', color: '#d8d2c7', frame: '#3d3d3d', glass: '#1f272e', bay: 3, storey: 3.1, window: { w: 0.66, h: 0.64, bars: null, sill: true, lintel: false }, curtains: 0.3, quality: q, seed: 45 })
  const fTower = M.facade(THREE, { wall: 'concrete', color: '#6e5444', frame: '#3b3430', glass: '#2a2826', bay: 1.8, storey: 3.4, window: { w: 0.8, h: 0.56, bars: null, sill: false, lintel: false }, curtains: 0.05, quality: q, seed: 46 })
  const fWarehouse = M.facade(THREE, { wall: 'brick', color: '#6a3a2a', mortar: '#8f8272', frame: '#e4dccb', glass: '#20262b', bay: 2.6, storey: 3.2, window: { w: 0.42, h: 0.56, bars: 'grid', sill: true, lintel: true }, quality: q, seed: 47 })
  const shop = M.shopfront(THREE, { color: '#2b2622', frame: '#1b1b1b', fascia: '#262626', bay: 3, storey: 4, warm: 0.7, quality: q, seed: 48 })

  /* --- water and land ---------------------------------------------------- */

  const water = waterMaterial(THREE, { palette: world.light, scale: 1.3 })
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), water)
  sea.rotation.x = -Math.PI / 2
  scene.add(sea)

  const land = (x0, x1, z0, z1, top = QUAY, topMat = pave, wall = quayWall) => {
    const w = x1 - x0
    const d = z1 - z0
    K.put(wall, boxGeo(THREE, w, top + 3, d, 4, 4, SIDES), (x0 + x1) / 2, -3, (z0 + z1) / 2)
    K.put(topMat, boxGeo(THREE, w, top + 3, d, 4, 4, TOP, 4), (x0 + x1) / 2, -3, (z0 + z1) / 2)
  }
  land(-100, 1700, 0, 1300)
  land(-1700, -150, 0, 1300)
  land(-150, -100, 230, 1300)
  land(-1700, 1700, -1800, NORTH)
  // granite coping along the quay edges
  for (const [x0, x1, z] of [
    [-100, 1700, 0.3],
    [-1700, -150, 0.3],
    [-1700, 1700, NORTH - 0.3],
  ]) K.put(conc, new THREE.BoxGeometry(x1 - x0, 0.3, 0.6), (x0 + x1) / 2, QUAY - 0.12, z)
  for (const x of [-99.7, -150.3]) K.put(conc, new THREE.BoxGeometry(0.6, 0.3, 230), x, QUAY - 0.12, 115)
  // roads and bike paths behind the quays (clinker brick road, asphalt)
  K.put(asphalt, flatGeo(THREE, 1800, 10, 6, true), 800, QUAY + 0.04, 64)
  K.put(clinker, flatGeo(THREE, 1550, 4, 3, true), -925, QUAY + 0.04, 52)
  K.put(asphalt, flatGeo(THREE, 3400, 12, 6, true), 0, QUAY + 0.04, NORTH - 12)

  /* --- the concert hall: glass foyer, hall box, the great canopy ---------- */

  building({ x: 15, z: 33, w: 90, d: 38, h: 12.6, y: QUAY, fac: fCurtain, roof: asphalt })
  building({ x: 25, z: 37, w: 50, d: 30, h: 16, y: QUAY + 12.6, fac: fCurtain, roof: asphalt, trim })
  // the canopy: a deep dark slab with a ribbed underside and a fascia
  K.put(steelDark, boxGeo(THREE, 120, 1.2, 71, 4, 4), 15, 15.0, 19.5)
  for (let x = -44; x <= 74; x += 4) K.put(steelDark, new THREE.BoxGeometry(0.3, 0.8, 70), x, 14.6, 19.5)
  for (let z = -14; z <= 54; z += 8) K.put(steelDark, new THREE.BoxGeometry(119, 0.5, 0.35), 15, 14.75, z)
  K.put(steelMid, new THREE.BoxGeometry(120.4, 1.8, 0.35), 15, 15.3, -16)
  // slender round columns (in the water at the front, on the quay behind)
  for (const [x, z, y0] of [
    [-35, -14, -1],
    [-10, -14, -1],
    [40, -14, -1],
    [65, -14, -1],
    [-35, 10, QUAY],
    [-10, 10, QUAY],
    [40, 10, QUAY],
  ]) K.put(steelMid, new THREE.CylinderGeometry(0.32, 0.32, 14.2 - y0, 14).translate(0, (14.2 - y0) / 2, 0), x, y0, z)
  // downlights in the canopy's soffit, just switched on
  const downlights = []
  for (let x = -40; x <= 70; x += 10) for (let z = -12; z <= 8; z += 10) downlights.push({ x, y: 14.15, z })
  scatter(THREE, scene, new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd7a0).multiplyScalar(2.2) }), downlights, { cast: false, receive: false })

  // the raised terrace the hero view is taken from, with steps down to the quay
  K.put(conc, boxGeo(THREE, 20, 4.5 - QUAY, 10, 4, 4, SIDES), 12, QUAY, 5)
  K.put(pave, boxGeo(THREE, 20, 4.5 - QUAY, 10, 4, 4, TOP, 4), 12, QUAY, 5)
  for (let i = 0; i < 15; i++) {
    const top = 4.5 - (i + 1) * 0.169
    K.put(conc, boxGeo(THREE, 0.34, top - QUAY, 10, 2, 2), 22.17 + i * 0.34, QUAY, 5)
  }
  const rails = beamBatch(THREE)
  const railRun = (a, b, h = 1.1, step = 1.5, mids = 2) => {
    const len = a.distanceTo(b)
    const n = Math.max(1, Math.round(len / step))
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n)
      rails.add(p, p.clone().add(V(0, h, 0)), 0.05, 0.05)
    }
    rails.add(a.clone().add(V(0, h, 0)), b.clone().add(V(0, h, 0)), 0.07, 0.05)
    for (let k = 1; k <= mids; k++) rails.add(a.clone().add(V(0, (h * k) / (mids + 1), 0)), b.clone().add(V(0, (h * k) / (mids + 1), 0)), 0.025, 0.025)
  }
  railRun(V(2.1, 4.5, 0.1), V(21.9, 4.5, 0.1))
  railRun(V(2.1, 4.5, 0.1), V(2.1, 4.5, 9.9))

  /* --- the stair over the water and the upper gallery -------------------- */

  const sTop = { x: -4, y: 10 }
  const sBot = { x: 14, y: QUAY }
  const zOut = -5.4
  const zIn = -2.6
  // the gallery it climbs to, on columns, and a bridge back to the foyer
  K.put(steelDark, boxGeo(THREE, 26, 0.6, 8, 4, 4), -17, 9.4, -2)
  K.put(steelDark, boxGeo(THREE, 4, 0.6, 12, 4, 4), -6, 9.4, 8)
  for (const z of [-5.6, 1.6]) K.put(steelDark, new THREE.BoxGeometry(26, 0.8, 0.45), -17, 9.0, z)
  for (const [x, z] of [
    [-28, -5.6],
    [-16, -5.6],
    [-28, 1.6],
    [-16, 1.6],
  ]) K.put(steelMid, new THREE.CylinderGeometry(0.22, 0.22, 10, 10).translate(0, 5, 0), x, -1, z)
  K.put(pave, flatGeo(THREE, 26, 8, 4), -17, 10.01, -2)
  railRun(V(-29.9, 10, -5.9), V(-5.4, 10, -5.9))
  railRun(V(-29.9, 10, -5.9), V(-29.9, 10, 1.9))
  railRun(V(-29.9, 10, 1.9), V(-8.1, 10, 1.9))
  railRun(V(-4.1, 10, -2.4), V(-4.1, 10, 1.9))
  // stair: deep plate girders, a solid plate parapet on the water side, an
  // open railing on the other, treads with dark nosings, a soffit
  K.slopeX(steelDark, sTop.x, sTop.y, sBot.x, sBot.y, zOut, 1.75, 0.06, 0.15)
  K.slopeX(steelDark, sTop.x, sTop.y, sBot.x, sBot.y, zIn, 0.85, 0.06, -0.3)
  K.slopeX(steelDark, sTop.x, sTop.y, sBot.x, sBot.y, (zIn + zOut) / 2, 0.06, zIn - zOut, -0.68)
  const steps = 50
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps
    const x = sTop.x + (sBot.x - sTop.x) * t
    const y = sTop.y + (sBot.y - sTop.y) * t
    K.put(steelMid, new THREE.BoxGeometry(0.34, 0.05, zIn - zOut - 0.1), x, y - 0.06, (zIn + zOut) / 2)
    K.put(steelDark, new THREE.BoxGeometry(0.05, 0.16, zIn - zOut - 0.1), x - 0.17, y - 0.12, (zIn + zOut) / 2)
  }
  const stairRail = (z, h) => {
    const a = V(sTop.x, sTop.y + h, z)
    const b = V(sBot.x, sBot.y + h, z)
    K.rod(steelMid, a, b, 0.03)
  }
  stairRail(zIn - 0.05, 1.0)
  stairRail(zIn - 0.05, 0.55)
  stairRail(zOut + 0.08, 0.95)
  for (let i = 0; i <= 12; i++) {
    const t = i / 12
    const x = sTop.x + (sBot.x - sTop.x) * t
    const y = sTop.y + (sBot.y - sTop.y) * t
    rails.add(V(x, y - 0.1, zIn - 0.05), V(x, y + 1.0, zIn - 0.05), 0.045, 0.02)
  }
  // the landing at the foot of the stair, a concrete pier off the quay
  K.put(conc, boxGeo(THREE, 6, QUAY + 1, 6, 4, 4), 17, -1, -3)
  railRun(V(20, QUAY, -5.9), V(20, QUAY, -0.1), 1.05)

  /* --- the ferry pontoon (with a shelter) and a gangway ----------------- */

  K.put(steelMid, boxGeo(THREE, 30, 1.1, 9, 4, 4, SIDES), 70, -0.1, -15)
  K.put(pave, boxGeo(THREE, 30, 1.0, 9, 4, 4, TOP, 4), 70, 0, -15)
  K.put(steelMid, new THREE.BoxGeometry(10.5, 0.18, 4.6), 79, 3.6, -16.5)
  for (const [x, z] of [
    [74.2, -18.5],
    [83.8, -18.5],
    [74.2, -14.5],
    [83.8, -14.5],
  ]) K.put(steelDark, new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8).translate(0, 1.3, 0), x, 1.0, z)
  K.put(glassBal, new THREE.BoxGeometry(9.6, 2.2, 0.03).translate(0, 1.1, 0), 79, 1.1, -18.7)
  K.put(steelMid, new THREE.BoxGeometry(2.2, 0.12, 10.6), 61.5, (QUAY + 1.0) / 2, -5.25, 0, -Math.atan2(QUAY - 1.0, 10.5))
  railRun(V(60.4, 1.05, -10.5), V(60.4, QUAY, 0.2), 1.0, 1.6, 1)
  railRun(V(55.2, 1.0, -19.4), V(84.8, 1.0, -19.4), 1.0, 2, 1)

  /* --- buildings along the south bank -------------------------------- */

  const bal = balconySet()
  // the hotel tower next to the hall, and its low wing
  building({ x: 103, z: 32, w: 30, d: 27, h: 62, y: QUAY, fac: fBrickRed, roof: asphalt, trim, shop })
  building({ x: 135, z: 30, w: 33, d: 24, h: 15.5, y: QUAY, fac: fBrickRed, roof: asphalt, trim })
  // the old black jazz box on its legs
  K.put(steelDark, boxGeo(THREE, 26, 10, 22, 4, 4), -62, 9, 27)
  for (const [x, z] of [
    [-74, 17],
    [-50, 17],
    [-74, 37],
    [-50, 37],
  ]) K.put(steelMid, new THREE.CylinderGeometry(0.35, 0.35, 9 - QUAY, 10).translate(0, (9 - QUAY) / 2, 0), x, QUAY, z)
  // IJ-oevers housing: brick and white blocks with balconies to the water
  const eastFacs = [fBrickBuff, fWhite, fBrickRed, fBrickDark, fBrickBuff, fCurtain]
  for (let x = 160, i = 0; x < 900; i++) {
    const fac = eastFacs[i % eastFacs.length]
    const bay = fac.tile[0]
    const n = Math.round(range(rand, 11, 20))
    const w = n * bay
    const storeys = Math.round(range(rand, 5, 10))
    const h = storeys * fac.tile[1]
    const cx = x + w / 2
    building({ x: cx, z: 34, w, d: 24, h, y: QUAY, fac, roof: asphalt, trim, shop: i % 2 ? shop : null })
    if (fac !== fCurtain && x < 520) bal.rows({ x: cx, z: 34, w, d: 24, y: QUAY, bay, storey: fac.tile[1], from: i % 2 ? 2 : 1, to: storeys, every: 2, phase: i % 2 })
    x += w + range(rand, 6, 14)
  }
  // second row, taller, behind
  for (let x = 140; x < 1000; ) {
    const fac = pick(rand, eastFacs)
    const w = Math.round(range(rand, 30, 60) / fac.tile[0]) * fac.tile[0]
    const h = Math.round(range(rand, 8, 16)) * fac.tile[1]
    building({ x: x + w / 2, z: range(rand, 95, 130), w, d: range(rand, 22, 36), h, y: QUAY, fac, roof: asphalt, trim })
    x += w + range(rand, 8, 30)
  }
  // west across the dock: the old warehouse, the library-like block, housing
  building({ x: -205, z: 32, w: 91, d: 24, h: 19.2, y: QUAY, fac: fWarehouse, roof: asphalt, trim })
  building({ x: -215, z: 92, w: 72, d: 50, h: 36, y: QUAY, fac: fCurtain, roof: asphalt, trim })
  for (let x = -280, i = 0; x > -1100; i++) {
    const fac = pick(rand, [fBrickDark, fWhite, fBrickRed, fBrickBuff])
    const w = Math.round(range(rand, 30, 55) / fac.tile[0]) * fac.tile[0]
    const storeys = Math.round(range(rand, 5, 9))
    building({ x: x - w / 2, z: 34, w, d: 24, h: storeys * fac.tile[1], y: QUAY, fac, roof: asphalt, trim })
    if (x > -600) bal.rows({ x: x - w / 2, z: 34, w, d: 24, y: QUAY, bay: fac.tile[0], storey: fac.tile[1], from: 1, to: storeys, every: 3, phase: i % 3 })
    x -= w + range(rand, 8, 18)
  }
  for (let x = -260; x > -1200; ) {
    const fac = pick(rand, [fBrickDark, fWhite, fCurtain, fBrickRed])
    const w = Math.round(range(rand, 30, 60) / fac.tile[0]) * fac.tile[0]
    building({ x: x - w / 2, z: range(rand, 100, 160), w, d: 30, h: Math.round(range(rand, 6, 14)) * fac.tile[1], y: QUAY, fac, roof: asphalt })
    x -= w + range(rand, 10, 40)
  }

  /* --- the white footbridge over the dock --------------------------- */

  {
    const z = 46
    const y = QUAY + 0.5
    K.put(steelMid, new THREE.BoxGeometry(56, 0.5, 4.4), -125, y - 0.25, z)
    K.put(pave, flatGeo(THREE, 56, 4, 4, true), -125, y + 0.01, z)
    // folded white plate sides: a zigzag of inclined panels
    for (const side of [-1, 1]) {
      for (let i = 0; i < 14; i++) {
        const x0 = -153 + i * 4
        const up = i % 2 === 0
        const a = V(x0, y + (up ? 0 : 2.4), z + side * 2.3)
        const b = V(x0 + 4, y + (up ? 2.4 : 0), z + side * 2.3)
        K.strut(white, a, b, 0.5, 0.12)
      }
      K.put(white, new THREE.BoxGeometry(56, 0.35, 0.5), -125, y + 2.4, z + side * 2.3)
      K.put(white, new THREE.BoxGeometry(56, 0.5, 0.6), -125, y - 0.1, z + side * 2.3)
    }
    for (const x of [-140, -110]) K.put(white, new THREE.BoxGeometry(1.2, y + 1, 3), x, -1, z)
  }

  /* --- the far bank: A'DAM Toren, the film museum, Overhoeks, cranes ----- */

  {
    // the tower: a 1970s office shaft, a projecting double-storey crown, the lookout
    const tx = tower.x
    const tz = tower.z
    building({ x: tx, z: tz, w: 30.6, d: 30.6, h: 71.4, y: QUAY, fac: fTower, roof: asphalt })
    K.put(steelDark, boxGeo(THREE, 27, 3, 27, 4, 4), tx, QUAY + 71.4, tz)
    K.put(fCurtain.material, boxGeo(THREE, 38, 6.4, 38, fCurtain.tile[0] * 2, fCurtain.tile[1] * 2, SIDES), tx, QUAY + 74.4, tz)
    for (const y of [74.2, 77.4, 80.6]) K.put(white, new THREE.BoxGeometry(39.2, 0.45, 39.2), tx, QUAY + y, tz)
    K.put(fCurtain.material, boxGeo(THREE, 26, 3.2, 26, fCurtain.tile[0] * 2, fCurtain.tile[1] * 2, SIDES), tx, QUAY + 81, tz)
    K.put(white, new THREE.BoxGeometry(27, 0.4, 27), tx, QUAY + 84.4, tz)
    const top = QUAY + 84.8
    for (const s of [-1, 1]) {
      rails.add(V(tx - 13, top + 1.2, tz + s * 13), V(tx + 13, top + 1.2, tz + s * 13), 0.08, 0.08)
      rails.add(V(tx + s * 13, top + 1.2, tz - 13), V(tx + s * 13, top + 1.2, tz + 13), 0.08, 0.08)
    }
    // the swing's A-frame and a mast
    for (const s of [-1, 1]) {
      K.strut(steelMid, V(tx + 9, top, tz + s * 4), V(tx + 15, top + 9, tz), 0.5)
      K.strut(steelMid, V(tx + 21, top - 4, tz + s * 4), V(tx + 15, top + 9, tz), 0.5)
    }
    K.put(steelMid, new THREE.CylinderGeometry(0.25, 0.4, 14, 8).translate(0, 7, 0), tx - 6, top, tz - 6)
    // the film museum: white, angular, cantilevered toward the water
    const s = new THREE.Shape()
    s.moveTo(-50, 0)
    s.lineTo(42, 0)
    s.lineTo(58, 9)
    s.lineTo(34, 23)
    s.lineTo(-14, 19)
    s.lineTo(-52, 7)
    s.closePath()
    const eye = new THREE.ExtrudeGeometry(s, { depth: 44, bevelEnabled: false })
    eye.translate(0, 0, -22)
    const uv = eye.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3)
    const eyeMat = M.plaster(THREE, { color: '#ecebe6', dirt: 0.05, tile: 3, quality: q, seed: 49 })
    K.put(eyeMat, eye, -82, QUAY, -482, 0.18)
  }
  // Overhoeks housing towers and slabs behind
  for (const [x, z, w, d, h, fac] of [
    [-300, -520, 24, 24, 74, fWhite],
    [-345, -560, 30, 22, 52, fBrickRed],
    [-270, -600, 40, 26, 40, fCurtain],
    [-410, -515, 48, 24, 28, fBrickBuff],
    [-460, -580, 26, 26, 62, fBrickDark],
    [-120, -560, 54, 24, 22, fBrickRed],
    [-40, -545, 42, 24, 34, fWhite],
  ]) {
    const hh = Math.round(h / fac.tile[1]) * fac.tile[1]
    const ww = Math.round(w / fac.tile[0]) * fac.tile[0]
    building({ x, z, w: ww, d, h: hh, y: QUAY, fac, roof: asphalt, trim })
    if (fac !== fCurtain) bal.rows({ x, z, w: ww, d, y: QUAY, bay: fac.tile[0], storey: fac.tile[1], from: 1, to: Math.round(hh / fac.tile[1]), every: 2, faces: [1] })
  }
  // the east side of Noord: sheds, new blocks, cranes
  for (let x = 10; x < 1100; ) {
    const shed = rand() < 0.35
    const fac = shed ? fWarehouse : pick(rand, [fBrickBuff, fWhite, fBrickRed, fBrickDark, fCurtain])
    const w = Math.round(range(rand, 26, 60) / fac.tile[0]) * fac.tile[0]
    const h = (shed ? Math.round(range(rand, 3, 5)) : Math.round(range(rand, 5, 13))) * fac.tile[1]
    const z = NORTH - 30 - range(rand, 20, 60)
    const d = range(rand, 20, 34)
    building({ x: x + w / 2, z, w, d, h, y: QUAY, fac, roof: asphalt, trim })
    if (!shed && fac !== fCurtain && x < 500) bal.rows({ x: x + w / 2, z, w, d, y: QUAY, bay: fac.tile[0], storey: fac.tile[1], from: 1, to: Math.round(h / fac.tile[1]), every: 2, faces: [1] })
    x += w + range(rand, 8, 26)
  }
  for (let x = -1100; x < 1200; ) {
    const fac = pick(rand, [fBrickBuff, fWhite, fBrickRed, fBrickDark, fCurtain])
    const w = Math.round(range(rand, 30, 70) / fac.tile[0]) * fac.tile[0]
    building({ x: x + w / 2, z: range(rand, -700, -820), w, d: 30, h: Math.round(range(rand, 5, 18)) * fac.tile[1], y: QUAY, fac, roof: asphalt })
    x += w + range(rand, 20, 70)
  }
  for (let x = -1100; x < -500; ) {
    const fac = pick(rand, [fBrickDark, fWhite, fBrickRed])
    const w = Math.round(range(rand, 30, 60) / fac.tile[0]) * fac.tile[0]
    building({ x: x + w / 2, z: NORTH - 45, w, d: 28, h: Math.round(range(rand, 4, 9)) * fac.tile[1], y: QUAY, fac, roof: asphalt })
    x += w + range(rand, 10, 30)
  }
  bal.build(THREE, scene, conc, glassBal)

  // tower cranes over the building sites
  const crane = beamBatch(THREE)
  const addCrane = (cx, cz, H, jib, rot) => {
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    const P = (lx, y, lz) => V(cx + lx * c + lz * s, y, cz - lx * s + lz * c)
    const m = 1
    for (let y = QUAY; y < QUAY + H; y += 2.4) {
      const y2 = Math.min(QUAY + H, y + 2.4)
      for (const [ax, az, bx, bz] of [
        [-m, -m, m, -m],
        [m, -m, m, m],
        [m, m, -m, m],
        [-m, m, -m, -m],
      ]) {
        crane.add(P(ax, y, az), P(ax, y2, az), 0.14)
        crane.add(P(ax, y, az), P(bx, y2, bz), 0.07)
      }
    }
    const top = QUAY + H
    for (const [l0, l1] of [
      [-jib * 0.28, jib],
    ]) {
      for (const lz of [-0.8, 0.8]) crane.add(P(l0, top, lz), P(l1, top, lz), 0.14)
      crane.add(P(l0, top + 1.6, 0), P(l1, top + 1.6, 0), 0.12)
      for (let x = l0; x < l1; x += 2.5) {
        crane.add(P(x, top, -0.8), P(x + 1.25, top + 1.6, 0), 0.06)
        crane.add(P(x, top, 0.8), P(x + 1.25, top + 1.6, 0), 0.06)
      }
    }
    crane.add(P(0, top, 0), P(0, top + 7, 0), 0.3)
    crane.add(P(0, top + 7, 0), P(jib * 0.7, top + 1.6, 0), 0.05)
    crane.add(P(0, top + 7, 0), P(-jib * 0.28, top + 1.6, 0), 0.05)
    crane.add(P(-jib * 0.24, top - 1.4, 0), P(-jib * 0.24, top, 0), 2.2, 2.4)
    crane.add(P(jib * 0.55, top - 12, 0), P(jib * 0.55, top, 0), 0.03)
  }
  addCrane(60, -515, 52, 48, 0.4)
  addCrane(190, -500, 60, 55, -0.6)
  addCrane(330, -540, 46, 42, 1.2)
  scene.add(crane.build(std(THREE, 0xd9b23a, 0.5, 0.4)))

  /* --- quayside props ------------------------------------------------- */

  // bollards on both quays
  const bollards = []
  for (let x = -96; x < 420; x += 13) if ((x < 1 || x > 23) && (x < 54 || x > 88)) bollards.push({ x, y: QUAY, z: 0.85 })
  for (let x = -400; x < 600; x += 16) bollards.push({ x, y: QUAY, z: NORTH - 0.85 })
  scatter(THREE, scene, mergeParts(THREE, [new THREE.CylinderGeometry(0.17, 0.21, 0.6, 12).translate(0, 0.3, 0), new THREE.CylinderGeometry(0.24, 0.24, 0.08, 12).translate(0, 0.62, 0)]), std(THREE, 0x2b2b2d, 0.5, 0.6), bollards)

  // tall slim lamp posts (heads just coming on)
  const lampSpots = []
  for (let x = -95; x < 600; x += 24) if ((x < -48 || x > 80) && clear(x, 12, 1.5)) lampSpots.push({ x, y: QUAY, z: 12 })
  for (let x = -420; x < 620; x += 30) lampSpots.push({ x, y: QUAY, z: NORTH - 4, ry: Math.PI })
  const lampGeo = mergeParts(THREE, [new THREE.CylinderGeometry(0.07, 0.11, 8, 8).translate(0, 4, 0), new THREE.BoxGeometry(1.1, 0.14, 0.32).translate(0.4, 8, 0)])
  scatter(THREE, scene, lampGeo, std(THREE, 0x3a3c3f, 0.45, 0.7), lampSpots.map((l) => ({ ...l, ry: (l.ry || 0) + Math.PI / 2 })))
  scatter(THREE, scene, new THREE.BoxGeometry(0.8, 0.04, 0.22).translate(0.45, 7.91, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffcf96).multiplyScalar(2.4) }), lampSpots.map((l) => ({ ...l, ry: (l.ry || 0) + Math.PI / 2 })), { cast: false, receive: false })

  // Dutch bikes: racks by the hall, a few by the dock
  const bikes = []
  const bikeCols = [0x1b1c1e, 0x2a3b4c, 0x5a1e1e, 0x1e3a2a, 0xd9d4c8, 0x2b2b2b, 0x7a6a50]
  for (let i = 0; i < (low ? 10 : 22); i++) bikes.push({ x: 64 + i * 0.75, y: QUAY, z: 10.6 + (i % 2) * 0.25, ry: Math.PI / 2 + range(rand, -0.08, 0.08), color: pick(rand, bikeCols) })
  for (let i = 0; i < (low ? 6 : 12); i++) bikes.push({ x: -92 + i * 0.8, y: QUAY, z: 15.2, ry: Math.PI / 2 + range(rand, -0.1, 0.1), color: pick(rand, bikeCols) })
  for (let i = 0; i < 4; i++) bikes.push({ x: 128 + i * 9, y: QUAY, z: 13.5, ry: range(rand, -0.3, 0.3), color: pick(rand, bikeCols) })
  scatter(THREE, scene, bikeGeometry(THREE), std(THREE, 0xffffff, 0.45, 0.5), bikes)
  // bike racks (steel hoops)
  K.put(steelMid, new THREE.BoxGeometry(18, 0.05, 0.05), 72, QUAY + 0.65, 10.75)

  // benches and bins
  const benchGeo = mergeParts(THREE, [
    new THREE.BoxGeometry(1.9, 0.07, 0.48).translate(0, 0.46, 0),
    new THREE.BoxGeometry(1.9, 0.42, 0.06).translate(0, 0.75, -0.22),
    new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(-0.8, 0.22, 0),
    new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(0.8, 0.22, 0),
  ])
  const benches = []
  for (const x of [-75, -62, 95, 112, 150, 190]) if (clear(x, 8.5, 1.5)) benches.push({ x, y: QUAY, z: 8.5, ry: Math.PI })
  scatter(THREE, scene, benchGeo, std(THREE, 0x5d4632, 0.7, 0.05), benches)

  // trees: limes along the quay roads
  const treeSpots = []
  for (let x = 162; x < 520; x += 13) treeSpots.push({ x: x + range(rand, -1, 1), y: QUAY, z: 14.5, h: range(rand, 9, 12) })
  for (let x = -1000; x < 900; x += range(rand, 30, 70)) treeSpots.push({ x, y: QUAY, z: NORTH - 24, h: range(rand, 9, 14) })
  addForest(THREE, scene, low ? treeSpots.filter((_, i) => i % 2 === 0) : treeSpots, { species: 'lime', season: 'summer', seed: 7, quality: q })

  // a flag by the tower
  const flag = makeFlag(THREE, 'amsterdam', { pole: 9, w: 2.4, h: 1.6 })
  flag.group.position.set(-150, QUAY, NORTH - 6)
  scene.add(flag.group)

  /* --- boats -------------------------------------------------------------- */

  // the IJ ferry: a white double-ended pontoon ferry with a raised wheelhouse
  const ferry = new THREE.Group()
  {
    const F = toolkit(THREE, ferry)
    const s = new THREE.Shape()
    s.moveTo(-17.5, -3.2)
    s.lineTo(-15, -5.6)
    s.lineTo(15, -5.6)
    s.lineTo(17.5, -3.2)
    s.lineTo(17.5, 3.2)
    s.lineTo(15, 5.6)
    s.lineTo(-15, 5.6)
    s.lineTo(-17.5, 3.2)
    s.closePath()
    const hullW = std(THREE, 0xe9e8e3, 0.45, 0.1)
    const blue = std(THREE, 0x1f4f99, 0.45, 0.2)
    F.put(std(THREE, 0x2a2c2f, 0.7, 0.2), planExtrude(THREE, s, -1, 0.2))
    F.put(blue, planExtrude(THREE, s, 0.2, 0.75))
    F.put(hullW, planExtrude(THREE, s, 0.75, 1.5))
    F.put(std(THREE, 0x6d7074, 0.8, 0.1), new THREE.BoxGeometry(34, 0.05, 10.6), 0, 1.5, 0)
    // wheelhouse on a bridge across the middle
    F.put(hullW, new THREE.BoxGeometry(3, 2.6, 11.6).translate(0, 1.3, 0), 0, 1.5, 0)
    F.put(hullW, new THREE.BoxGeometry(4.4, 2.4, 3.4).translate(0, 1.2, 0), 0, 4.1, 0)
    F.put(std(THREE, 0x162027, 0.06, 0.9), new THREE.BoxGeometry(4.5, 1.0, 3.5), 0, 5.6, 0)
    F.put(blue, new THREE.BoxGeometry(4.8, 0.25, 3.8), 0, 6.6, 0)
    const fr = beamBatch(THREE)
    for (const side of [-1, 1]) {
      fr.add(V(-15, 2.55, side * 5.5), V(15, 2.55, side * 5.5), 0.06)
      for (let x = -15; x <= 15; x += 1.5) fr.add(V(x, 1.5, side * 5.5), V(x, 2.55, side * 5.5), 0.04)
    }
    ferry.add(fr.build(steelMid))
    F.flush()
  }
  ferry.rotation.y = Math.PI / 2
  ferry.position.set(150, 0, -26)
  // it moves, and the sun's shadow map is drawn only once: no shadow from it
  ferry.traverse((o) => {
    if (o.isMesh) o.castShadow = false
  })
  scene.add(ferry)
  // a glass-roofed canal cruiser at the pontoon, and barges on the far bank
  {
    const boatK = K
    const s = hullShape(THREE, -10, 10.5, 2.15, 6)
    boatK.put(std(THREE, 0x1a2433, 0.4, 0.3), planExtrude(THREE, s, -0.6, 0.9), 96, 0, -15)
    boatK.put(std(THREE, 0xd8d6cf, 0.5, 0.1), planExtrude(THREE, hullShape(THREE, -9.6, 9.6, 2.0, 6), 0.9, 1.05), 96, 0, -15)
    boatK.put(std(THREE, 0x0e1418, 0.04, 0.95, { envMapIntensity: 1.4 }), new THREE.BoxGeometry(15, 1.15, 3.6).translate(0, 0.58, 0), 95, 1.05, -15)
    boatK.put(white, new THREE.BoxGeometry(15.2, 0.08, 3.7), 95, 2.24, -15)
    const bargeHull = std(THREE, 0x22262a, 0.6, 0.3)
    const bargeHold = std(THREE, 0x6a2a22, 0.7, 0.2)
    for (const [bx, len] of [
      [150, 80],
      [250, 110],
      [-320, 70],
    ]) {
      const b = hullShape(THREE, -len / 2, len / 2, 4.6, len / 2 - 8)
      K.put(bargeHull, planExtrude(THREE, b, -1.5, 1.6), bx, 0, NORTH + 6)
      K.put(bargeHold, new THREE.BoxGeometry(len * 0.62, 1.4, 7.6), bx + 2, 1.6, NORTH + 6)
      K.put(white, new THREE.BoxGeometry(5, 3.4, 6.5).translate(0, 1.7, 0), bx - len / 2 + 5, 1.6, NORTH + 6)
    }
  }

  scene.add(rails.build(steelMid))
  K.flags(asphalt, { cast: false })
  K.flags(pave, { cast: false })
  K.flags(clinker, { cast: false })
  K.flags(quayWall, { cast: false })
  K.flush()

  world.focusShadows(V(10, 4, -2), low ? 60 : 85)

  return {
    scene,
    world,
    path: {
      positions: arrival,
      targets: [V(-40, 10, -200), V(-90, 22, -330), V(-140, 40, -480), aim(THREE, V(19, 7.6, -6), tower, 12, 4), spots[0].look.clone()],
      fov: 50,
      near: 0.3,
      spots,
    },
    update(t) {
      water.userData.tick(t)
      flag.tick(t)
      // the ferry shuttles across the IJ, dwelling at each bank
      const ph = (t * 0.011) % 2
      const leg = ph < 1 ? ph : 2 - ph
      const k = Math.min(1, Math.max(0, (leg - 0.08) / 0.84))
      const e = k * k * (3 - 2 * k)
      ferry.position.set(150, 0, -26 - e * 378)
    },
  }
}

/* ======================================================================== */
/* 2. Rotterdam at night, the Erasmusbrug                                   */
/* ======================================================================== */

/** Height of the bridge deck's road surface along z. */
function erasmusDeckY(z) {
  if (z >= 130) return 3
  if (z > -10) return 3 + ((130 - z) / 140) * 11.5
  if (z >= -400) return 14.5
  if (z > -480) return 14.5 - ((-400 - z) / 80) * 11.5
  return 3
}

function buildRotterdam(THREE, ctx) {
  const low = ctx.quality === 'low'
  const q = ctx.quality
  const world = createWorld(THREE, ctx, 'night', { fog: { density: 0.0011 } })
  const { scene } = world
  const K = toolkit(THREE, scene)
  const building = makeBuilding(THREE, K)
  const rand = seeded(2024)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const QUAY = 3
  const SOUTH = -380 // Wilhelminapier's quay edge
  const deckY = erasmusDeckY

  /* --- the tour --------------------------------------------------------- */

  const deRotterdam = V(-118, 62, -425)
  const S0 = V(-70, 4.7, 2.5)
  const spots = [
    { pos: S0, look: aim(THREE, S0, deRotterdam, -13, 6) }, // the quay railing, De Rotterdam lit across the Maas
    { pos: V(-262, 4.7, 7), look: aim(THREE, V(-262, 4.7, 7), V(0, 62, -300), 13) }, // Boompjes: the whole bridge from the west
    { pos: V(-15.6, 16.2, -248), look: aim(THREE, V(-15.6, 16.2, -248), V(2, 64, -305), -12) }, // on the bridge by the pylon, the stays overhead
    { pos: V(-15.6, 16.2, -140), look: aim(THREE, V(-15.6, 16.2, -140), deRotterdam, 10) }, // mid-span: the towers of the Kop van Zuid
    { pos: V(-150, 26, 20), look: V(10, 28, -330) }, // up high over the boulevard: bridge and skyline
    { pos: V(-30, 4.7, 150), look: V(10, 5.2, 146) }, // the tram stop at the bridge's north end
    { pos: V(-40, 4.7, -392), look: aim(THREE, V(-40, 4.7, -392), V(0, 40, -150), -12, 6) }, // Wilhelminapier, back to the bridge
  ]
  const arrival = [V(-520, 160, -260), V(-330, 70, -170), V(-160, 20, -60), V(-90, 7, -8), S0.clone()]
  const clear = clearOfTour(spots, arrival.slice(2))

  /* --- materials -------------------------------------------------------- */

  const pave = M.paving(THREE, { kind: 'flags', color: '#77736c', joint: '#3b3935', unit: 0.6, tile: 4, wet: 0.35, quality: q, seed: 61 })
  const asphalt = M.asphalt(THREE, { color: '#2f3033', tile: 6, quality: q, seed: 62 })
  const redLane = M.asphalt(THREE, { color: '#5b2c2a', tile: 6, quality: q, seed: 63 })
  const quayWall = M.concrete(THREE, { color: '#4f4c47', tile: 4, quality: q, seed: 64 })
  const conc = M.concrete(THREE, { color: '#8f8a82', tile: 4, quality: q, seed: 65 })
  const fBrick = M.facade(THREE, { wall: 'brick', color: '#5e3b2e', mortar: '#7c7066', frame: '#cfc9be', glass: '#1a2026', bay: 3, storey: 3.1, window: { w: 0.6, h: 0.64, bars: null, sill: true, lintel: false }, night: 0.42, quality: q, seed: 71 })
  const fWhite = M.facade(THREE, { wall: 'plaster', color: '#cfcac1', frame: '#3a3a3a', glass: '#1b2127', bay: 3, storey: 3.2, window: { w: 0.62, h: 0.62, bars: null, sill: true, lintel: false }, night: 0.38, quality: q, seed: 72 })
  const fConc = M.facade(THREE, { wall: 'concrete', color: '#7c7a76', frame: '#2b2b2b', glass: '#1a2027', bay: 2.7, storey: 3.3, window: { w: 0.7, h: 0.6, bars: null, sill: false, lintel: false }, night: 0.45, quality: q, seed: 73 })
  const shop = M.shopfront(THREE, { color: '#24201c', frame: '#141414', fascia: '#1c1c1c', bay: 3, storey: 4.2, night: 1, quality: q, seed: 74 })
  // towers: big, randomly lit window grids (no visible repeat across a tower)
  const nightFac = (cols, rows, bay, storey, seed, lit, frame) => {
    const t = nightWindows(THREE, { cols, rows, seed, litRatio: lit, frame })
    const material = new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.28, metalness: 0.55 })
    return { material, tile: [(cols * bay) / 2, (rows * storey) / 2] }
  }
  const tGlassA = nightFac(14, 28, 1.8, 3.6, 81, 0.3, '#1c1f24')
  const tGlassB = nightFac(12, 24, 2.0, 3.5, 82, 0.24, '#202328')
  const tGlassC = nightFac(10, 22, 2.4, 3.4, 83, 0.18, '#24262a')
  const tWarm = nightFac(10, 20, 3.0, 3.2, 84, 0.26, '#2b211c')

  const white = std(THREE, 0xf2f3f0, 0.35, 0.15, { emissive: new THREE.Color(0x9fb6e0), emissiveIntensity: 0.5 })
  const deckBlue = std(THREE, 0x8fa4b8, 0.45, 0.35, { emissive: new THREE.Color(0x3c5470), emissiveIntensity: 0.55 })
  const steel = std(THREE, 0x55595f, 0.4, 0.85)
  const darkSteel = std(THREE, 0x222428, 0.5, 0.7)
  const stayMat = new THREE.MeshStandardMaterial({ color: 0xd4dbe3, emissive: 0xbfcce0, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.4 })
  // the pylon: pale-blue painted steel, floodlit from below
  const pylonMat = M.concrete(THREE, { color: '#b9c8d6', ties: false, quality: q, seed: 75 })
  pylonMat.emissive = new THREE.Color(0x3d5574)
  pylonMat.emissiveIntensity = 0.45
  const ledWhite = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8efff).multiplyScalar(2.6) })
  const ledWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc68a).multiplyScalar(3) })
  const ledViolet = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9a4dff).multiplyScalar(3) })

  /* --- water and land ----------------------------------------------------- */

  const water = waterMaterial(THREE, { palette: world.light, scale: 1.2, strokes: 1.2 })
  const river = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), water)
  river.rotation.x = -Math.PI / 2
  scene.add(river)
  const land = (x0, x1, z0, z1, top = QUAY) => {
    K.put(quayWall, boxGeo(THREE, x1 - x0, top + 3, z1 - z0, 4, 4, SIDES), (x0 + x1) / 2, -3, (z0 + z1) / 2)
    K.put(pave, boxGeo(THREE, x1 - x0, top + 3, z1 - z0, 4, 4, TOP, 4), (x0 + x1) / 2, -3, (z0 + z1) / 2)
  }
  land(-2000, 2000, 0, 1400)
  land(-2000, 2000, -2000, SOUTH)
  for (const z of [0.3, SOUTH - 0.3]) K.put(conc, new THREE.BoxGeometry(4000, 0.3, 0.6), 0, QUAY - 0.12, z)
  // the Boompjes boulevard and the road along the pier
  K.put(asphalt, flatGeo(THREE, 4000, 12, 6, true), 0, QUAY + 0.04, 22)
  K.put(asphalt, flatGeo(THREE, 4000, 12, 6, true), 0, QUAY + 0.04, SOUTH - 60)
  const marks = []
  for (let x = -1200; x < 1200; x += 9) {
    if (Math.abs(x) < 22) continue
    marks.push({ x, y: QUAY + 0.06, z: 22 })
    marks.push({ x, y: QUAY + 0.06, z: SOUTH - 60 })
  }
  scatter(THREE, scene, new THREE.BoxGeometry(4, 0.02, 0.14), std(THREE, 0xcfcfc8, 0.7), marks, { cast: false })

  /* --- the Erasmusbrug ---------------------------------------------------- */

  // deck slabs follow the profile: box girder (blue-grey), road, tram strip, red bike lanes
  const profile = [300, 130, 60, -10, -400, -440, -480, -700]
  const m4 = new THREE.Matrix4()
  const qq = new THREE.Quaternion()
  const eul = new THREE.Euler()
  const deckPiece = (mat, zA, zB, xc, w, thick, top, tile = 4) => {
    const z0 = Math.min(zA, zB)
    const z1 = Math.max(zA, zB)
    const y0 = deckY(z0)
    const y1 = deckY(z1)
    const len = Math.hypot(z1 - z0, y1 - y0)
    eul.set(-Math.atan2(y1 - y0, z1 - z0), 0, 0)
    qq.setFromEuler(eul)
    m4.compose(V(xc, (y0 + y1) / 2 + top - thick / 2, (z0 + z1) / 2), qq, V(1, 1, 1))
    const g = boxGeo(THREE, w, thick, len, tile, tile, null, tile)
    g.translate(0, -thick / 2, 0)
    K.putM(mat, g, m4)
  }
  for (let i = 0; i + 1 < profile.length; i++) {
    const a = profile[i]
    const b = profile[i + 1]
    if (b < -470 && a <= -480) continue
    deckPiece(deckBlue, a, b, 0, 33.8, 2.6, -0.06)
    deckPiece(asphalt, a, b, -8, 9, 0.1, 0.02, 6)
    deckPiece(asphalt, a, b, 8, 9, 0.1, 0.02, 6)
    deckPiece(conc, a, b, 0, 7, 0.1, 0.03)
    deckPiece(redLane, a, b, -15.2, 3.3, 0.1, 0.05, 6)
    deckPiece(redLane, a, b, 15.2, 3.3, 0.1, 0.05, 6)
    for (const x of [-12.8, 12.8, -3.6, 3.6]) deckPiece(conc, a, b, x, 0.5, 0.2, 0.17)
    // LED lines along the deck's outer edges
    for (const x of [-16.95, 16.95]) deckPiece(ledWhite, a, b, x, 0.12, 0.12, -0.9)
  }
  K.flags(ledWhite, { cast: false, receive: false })
  // tram rails
  const railItems = []
  for (let z = -560; z < 300; z += 10) {
    for (const x of [-2.72, -1.28, 1.28, 2.72]) railItems.push({ x, y: deckY(z + 5) + 0.17, z: z + 5, rx: -Math.atan2(deckY(z + 10) - deckY(z), 10) })
  }
  scatter(THREE, scene, new THREE.BoxGeometry(0.08, 0.06, 10.05), steel, railItems, { cast: false })
  // railings on both edges: posts, rails, a top tube
  const rail = beamBatch(THREE)
  for (let z = -470; z < 140; z += 2) {
    for (const x of [-16.85, 16.85]) {
      const y = deckY(z)
      rail.add(V(x, y, z), V(x, y + 1.15, z), 0.06, 0.06)
      const y2 = deckY(z + 2)
      rail.add(V(x, y + 1.15, z), V(x, y2 + 1.15, z + 2), 0.07, 0.07)
      rail.add(V(x, y + 0.55, z), V(x, y2 + 0.55, z + 2), 0.03, 0.03)
    }
  }
  // piers: under the north end, mid-river under the pylon, the south abutment
  for (const z of [60, -16]) K.put(conc, boxGeo(THREE, 26, deckY(z) - 2.4 + 2, 6, 4, 4), 0, -2, z)
  K.put(conc, boxGeo(THREE, 64, 5, 22, 4, 4), 0, -3, -305)
  K.put(conc, boxGeo(THREE, 30, 13, 8, 4, 4), 0, -2, -400)

  // the pylon: two raking legs from the pier, the knee, the swan's neck leaning back
  const knee = V(0, 60, -292)
  const top = V(0, 139, -318)
  for (const s of [-1, 1]) K.strut(pylonMat, V(s * 24, 1.5, -305), V(s * 3.2, 60, -292), 4.2, 6.5, 4)
  K.put(pylonMat, scaleBoxUVs(new THREE.BoxGeometry(10, 9, 9), 10, 9, 9, 4, 4), 0, 56, -292)
  K.strut(pylonMat, V(0, 56, -291), top, 5.6, 7.4, 4)
  K.put(pylonMat, scaleBoxUVs(new THREE.BoxGeometry(4.4, 3, 6), 4.4, 3, 6, 4, 4), top.x, top.y + 0.5, top.z)
  const mastAt = (y) => {
    const t = (y - knee.y) / (top.y - knee.y)
    return V(0, y, knee.z + (top.z - knee.z) * t)
  }
  // the fan of front stays (two planes) and the heavy backstays
  const stays = beamBatch(THREE)
  for (let i = 0; i < 16; i++) {
    const y = 82 + i * 3.4
    const zA = -255 + i * 14.6
    const m = mastAt(y)
    for (const s of [-1, 1]) stays.add(V(s * 1.6, m.y, m.z), V(s * 13.6, deckY(zA) + 0.8, zA), 0.2, 0.2)
  }
  for (const s of [-1, 1]) {
    for (const k of [0, 1]) {
      const m = mastAt(126 + k * 6)
      const zA = -404 - k * 8
      stays.add(V(s * 1.8, m.y, m.z), V(s * 9.5, deckY(zA) + 0.6, zA), 0.75, 0.75)
    }
  }
  scene.add(stays.build(stayMat, { castShadow: false }))
  // deck lamps along the central reservation and over the cycle lanes
  const deckLamps = []
  for (let z = -460; z < 150; z += 36) for (const x of [-12.8, 12.8]) deckLamps.push({ x, y: deckY(z), z })
  const deckPole = mergeParts(THREE, [new THREE.CylinderGeometry(0.08, 0.12, 9, 8).translate(0, 4.5, 0), new THREE.BoxGeometry(0.4, 0.2, 1.2).translate(0, 9, 0)])
  scatter(THREE, scene, deckPole, steel, deckLamps, { cast: false })
  scatter(THREE, scene, new THREE.BoxGeometry(0.3, 0.05, 1.0).translate(0, 8.88, 0), ledWhite, deckLamps, { cast: false, receive: false })
  // tram catenary: poles in the middle, two contact wires
  for (let z = -470; z < 300; z += 40) K.put(steel, new THREE.CylinderGeometry(0.12, 0.15, 7, 8).translate(0, 3.5, 0), 0, deckY(z), z)
  const wires = beamBatch(THREE)
  for (let z = -470; z < 300; z += 40) for (const x of [-2, 2]) wires.add(V(x, deckY(z) + 6.2, z), V(x, deckY(z + 40) + 6.2, z + 40), 0.025)
  for (let z = -470; z < 300; z += 40) wires.add(V(-2.3, deckY(z) + 6.4, z), V(2.3, deckY(z) + 6.4, z), 0.05)
  scene.add(wires.build(darkSteel, { castShadow: false }))

  /* --- the trams and the traffic on the bridge ----------------------------- */

  const makeTram = () => {
    const g = new THREE.Group()
    const T = toolkit(THREE, g)
    const body = new THREE.MeshPhysicalMaterial({ color: 0xc9cdd0, roughness: 0.35, metalness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.2 })
    const winMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, emissive: 0xffe0b0, emissiveIntensity: 1.3, roughness: 0.15, metalness: 0.3 })
    const red = std(THREE, 0xb3202a, 0.4, 0.3)
    T.put(body, new THREE.BoxGeometry(2.4, 2.45, 31).translate(0, 1.225, 0), 0, 0.42, 0)
    T.put(winMat, new THREE.BoxGeometry(2.43, 1.05, 30.4), 0, 2.05, 0)
    T.put(red, new THREE.BoxGeometry(2.44, 0.14, 31.05), 0, 1.3, 0)
    T.put(darkSteel, new THREE.BoxGeometry(2.2, 0.45, 30), 0, 0.2, 0)
    for (const z of [-5.3, 5.3]) T.put(darkSteel, new THREE.BoxGeometry(2.46, 2.3, 0.5), 0, 1.6, z)
    for (const z of [-10, 0, 10]) T.put(body, new THREE.BoxGeometry(1.6, 0.45, 3.2), 0, 3.05, z)
    T.strut(darkSteel, V(0, 3.3, 1), V(0, 4.9, -0.6), 0.08)
    T.strut(darkSteel, V(0, 4.9, -0.6), V(0, 6.0, 1), 0.08)
    T.put(darkSteel, new THREE.BoxGeometry(1.6, 0.06, 0.2), 0, 6.0, 1)
    for (const s of [-1, 1]) {
      T.put(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e0).multiplyScalar(4) }), new THREE.BoxGeometry(0.3, 0.14, 0.05), s * 0.8, 1.0, -15.53)
      T.put(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a20).multiplyScalar(3) }), new THREE.BoxGeometry(0.3, 0.14, 0.05), s * 0.8, 1.0, 15.53)
    }
    T.put(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a20).multiplyScalar(2.6) }), new THREE.BoxGeometry(1.5, 0.22, 0.05), 0, 2.72, -15.53)
    T.flush()
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = false
    })
    scene.add(g)
    return g
  }
  const trams = [
    { g: makeTram(), x: -2, dir: -1, speed: 8.5, phase: 0 },
    { g: makeTram(), x: 2, dir: 1, speed: 8.5, phase: 420 },
  ]
  if (!low) trams.push({ g: makeTram(), x: -2, dir: -1, speed: 8.5, phase: 430 })
  const LOOP = 860
  const carN = low ? 10 : 22
  const carBody = mergeParts(THREE, [new THREE.BoxGeometry(1.8, 0.72, 4.4).translate(0, 0.62, 0), new THREE.BoxGeometry(1.62, 0.56, 2.3).translate(0, 1.26, 0.25)])
  const carPaint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 })
  const carCols = [0x111215, 0xd8d8d4, 0x5d6268, 0x1d2b44, 0x7a1418, 0x9aa0a6, 0x202020]
  const cars = []
  for (let i = 0; i < carN; i++) {
    const south = i % 2 === 0
    cars.push({ x: south ? pick(rand, [-6.2, -9.6]) : pick(rand, [6.2, 9.6]), dir: south ? -1 : 1, speed: range(rand, 11, 15), phase: rand() * LOOP })
  }
  const carMesh = scatter(THREE, scene, carBody, carPaint, cars.map((c) => ({ x: c.x, z: 0, color: pick(rand, carCols) })), { cast: false })
  const headMesh = scatter(THREE, scene, new THREE.BoxGeometry(1.5, 0.12, 0.06).translate(0, 0.78, -2.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1dc).multiplyScalar(4) }), cars.map(() => ({ x: 0, z: 0 })), { cast: false, receive: false })
  const tailMesh = scatter(THREE, scene, new THREE.BoxGeometry(1.5, 0.1, 0.06).translate(0, 0.82, 2.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1a10).multiplyScalar(3) }), cars.map(() => ({ x: 0, z: 0 })), { cast: false, receive: false })
  for (const m of [carMesh, headMesh, tailMesh]) m.frustumCulled = false
  const along = (z0, dir, speed, phase, t) => {
    const s = (t * speed + phase) % LOOP
    return dir < 0 ? 280 - s : -580 + s
  }
  const pitchAt = (z) => -Math.atan2(deckY(z + 1) - deckY(z - 1), 2)

  /* --- Wilhelminapier: De Rotterdam, KPN, Maastoren, the pier's towers ------ */

  // De Rotterdam: three stacked towers on a shared plinth
  building({ x: -118, z: -422, w: 126, d: 36, h: 30.6, y: QUAY, fac: tGlassB, roof: asphalt })
  for (const [x, dx] of [
    [-160, 2],
    [-118, -3],
    [-76, 3],
  ]) {
    building({ x, z: -424, w: 34, d: 32, h: 55, y: QUAY + 30.6, fac: tGlassA, roof: asphalt })
    building({ x: x + dx, z: -424 + dx, w: 34, d: 32, h: 62, y: QUAY + 85.6, fac: tGlassA, roof: asphalt })
  }
  // KPN tower with its leaning, light-dotted screen facade and the strut
  building({ x: 58, z: -440, w: 40, d: 30, h: 96, y: QUAY, fac: tGlassC, roof: asphalt })
  {
    const dots = paintTexture(
      THREE,
      256,
      512,
      (g, w, h) => {
        g.fillStyle = '#0a0c0e'
        g.fillRect(0, 0, w, h)
        const r2 = seeded(5)
        for (let y = 4; y < h; y += 8) {
          for (let x = 4; x < w; x += 8) {
            const on = Math.sin(x * 0.05 + y * 0.012) + Math.cos(y * 0.03) > 0.4 || r2() < 0.08
            if (!on) continue
            g.fillStyle = r2() < 0.7 ? '#7dff9a' : '#e8fff0'
            g.fillRect(x - 1.5, y - 1.5, 3, 3)
          }
        }
      },
      { kind: 'color' }
    )
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(40, 98), new THREE.MeshStandardMaterial({ color: 0x15181a, emissiveMap: dots, emissive: 0xffffff, emissiveIntensity: 1.8, roughness: 0.3, metalness: 0.6 }))
    screen.position.set(58, QUAY + 49, -419)
    screen.rotation.x = 0.12
    scene.add(screen)
    K.strut(steel, V(58, QUAY, -395), V(58, QUAY + 60, -417.8), 1.2)
  }
  // Maastoren, New Orleans, Montevideo, World Port Center, Hotel New York
  const pier = [
    [235, -470, 40, 32, 165, tGlassC],
    [-262, -448, 32, 32, 158, tWarm],
    [-330, -430, 30, 26, 140, tGlassB],
    [-420, -440, 46, 30, 123, tGlassA],
    [150, -455, 34, 30, 70, tWarm],
    [330, -480, 48, 30, 58, tGlassB],
    [-205, -470, 44, 30, 46, tWarm],
  ]
  for (const [x, z, w, d, h, fac] of pier) building({ x, z, w, d, h, y: QUAY, fac, roof: asphalt, trim: darkSteel })
  // Hotel New York at the tip: old brick with twin green towers
  building({ x: -540, z: -410, w: 60, d: 26, h: 18.6, y: QUAY, fac: fBrick, roof: asphalt, trim: conc, shop })
  for (const x of [-552, -528]) {
    K.put(conc, new THREE.BoxGeometry(7, 8, 7), x, QUAY + 18.6 + 4, -400)
    K.put(std(THREE, 0x3f6e5e, 0.5, 0.4), new THREE.ConeGeometry(5.2, 6, 4).rotateY(Math.PI / 4), x, QUAY + 18.6 + 11, -400)
  }
  // the pier's lower blocks and the city behind
  for (let x = -1200; x < 1200; ) {
    const fac = pick(rand, [fBrick, fWhite, fConc, tWarm, tGlassC])
    const w = Math.round(range(rand, 30, 60) / fac.tile[0]) * fac.tile[0]
    const cx = x + w / 2
    const z = range(rand, -510, -560)
    if (Math.abs(cx - 0) > 30) building({ x: cx, z, w, d: 30, h: Math.round(range(rand, 6, 16)) * 3.2, y: QUAY, fac, roof: asphalt, trim: darkSteel })
    x += w + range(rand, 10, 30)
  }
  for (let x = -1500; x < 1500; ) {
    const fac = pick(rand, [tGlassA, tGlassB, tGlassC, tWarm, fConc])
    const w = range(rand, 30, 60)
    building({ x: x + w / 2, z: range(rand, -650, -900), w, d: 40, h: range(rand, 30, 110), y: QUAY, fac, roof: asphalt })
    x += w + range(rand, 20, 80)
  }
  // violet uplights along the pier's quay (the reference's purple glow) and its lamps
  const violet = []
  const quayLampsS = []
  for (let x = -600; x < 420; x += 8) violet.push({ x, y: QUAY + 0.1, z: SOUTH - 1.2 })
  for (let x = -600; x < 420; x += 26) if (Math.abs(x) > 20) quayLampsS.push({ x, y: QUAY, z: SOUTH - 6 })
  scatter(THREE, scene, new THREE.BoxGeometry(0.5, 0.2, 0.3), ledViolet, violet, { cast: false, receive: false })

  /* --- the north bank: Boompjes ------------------------------------------------ */

  // the quay railing of the hero photo: inclined flat bars under a round rail
  const bars = []
  const railZ = 0.55
  const railSpans = [
    [-600, -20],
    [20, 500],
  ]
  for (const [x0, x1] of railSpans) {
    for (let x = x0; x < x1; x += 0.24) bars.push({ x, y: QUAY + 0.55, z: railZ, rz: 0.36 })
    K.rod(steel, V(x0, QUAY + 1.12, railZ), V(x1, QUAY + 1.12, railZ), 0.05, 8)
    K.rod(steel, V(x0, QUAY + 0.06, railZ), V(x1, QUAY + 0.06, railZ), 0.035, 6)
    for (let x = x0; x <= x1; x += 2.4) K.put(steel, new THREE.BoxGeometry(0.08, 1.12, 0.08), x, QUAY + 0.56, railZ)
  }
  scatter(THREE, scene, new THREE.BoxGeometry(0.012, 1.18, 0.06), steel, bars, { cast: false })
  // quay lamps along the boulevard
  const quayLampsN = []
  for (let x = -600; x < 500; x += 24) if (Math.abs(x) > 24 && clear(x, 4, 1.2)) quayLampsN.push({ x, y: QUAY, z: 4 })
  const lampsAll = [...quayLampsN, ...quayLampsS]
  const poleGeo = mergeParts(THREE, [new THREE.CylinderGeometry(0.07, 0.11, 6, 8).translate(0, 3, 0), new THREE.CylinderGeometry(0.32, 0.22, 0.32, 12).translate(0, 6.1, 0)])
  scatter(THREE, scene, poleGeo, darkSteel, lampsAll, { cast: false })
  scatter(THREE, scene, new THREE.CylinderGeometry(0.21, 0.21, 0.06, 12).translate(0, 5.92, 0), ledWarm, lampsAll, { cast: false, receive: false })
  // tall towers to the west (Boompjes), the white Willemswerf east of the bridge, blocks between
  for (const [x, z, h] of [
    [-222, 70, 96],
    [-268, 66, 92],
    [-314, 70, 90],
  ]) building({ x, z, w: 24, d: 24, h, y: QUAY, fac: tWarm, roof: asphalt, trim: darkSteel })
  building({ x: 86, z: 82, w: 42, d: 30, h: 76.8, y: QUAY, fac: fWhite, roof: asphalt })
  {
    // its sloping, cut-off top
    const s = new THREE.Shape()
    s.moveTo(-21, 0)
    s.lineTo(21, 0)
    s.lineTo(-21, 16)
    s.closePath()
    const wedge = new THREE.ExtrudeGeometry(s, { depth: 30, bevelEnabled: false }).translate(0, 0, -15)
    const uv = wedge.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (fWhite.tile[0] * 2), uv.getY(i) / (fWhite.tile[1] * 2))
    K.put(fWhite.material, wedge, 86, QUAY + 76.8, 82)
  }
  const northBlocks = []
  for (let x = -900; x < 900; ) {
    const fac = pick(rand, [fBrick, fWhite, fConc])
    const w = Math.round(range(rand, 26, 50) / fac.tile[0]) * fac.tile[0]
    const cx = x + w / 2
    const z = range(rand, 46, 70)
    const inPark = cx > -200 && cx < 30
    const nearBridge = Math.abs(cx) < 40 + w / 2
    const taken = [-222, -268, -314, 86].some((t) => Math.abs(cx - t) < w / 2 + 22)
    if (!inPark && !nearBridge && !taken) {
      building({ x: cx, z, w, d: 24, h: Math.round(range(rand, 5, 11)) * fac.tile[1], y: QUAY, fac, roof: asphalt, trim: darkSteel, shop })
      northBlocks.push(cx)
    }
    x += w + range(rand, 6, 16)
  }
  for (let x = -1400; x < 1400; ) {
    const fac = pick(rand, [tGlassA, tGlassB, tWarm, fConc, fBrick])
    const w = range(rand, 30, 55)
    const cx = x + w / 2
    if (Math.abs(cx) > 50) building({ x: cx, z: range(rand, 190, 330), w, d: 36, h: range(rand, 20, 100), y: QUAY, fac, roof: asphalt })
    x += w + range(rand, 15, 50)
  }
  // the park on the boulevard: plane trees in autumn, kept off the camera's path
  const treeSpots = []
  for (let x = -600; x < 500; x += 13) if (Math.abs(x) > 26 && clear(x, 13, 6)) treeSpots.push({ x: x + range(rand, -1, 1), y: QUAY, z: 13, h: range(rand, 11, 15) })
  for (let i = 0; i < 40; i++) {
    const x = range(rand, -190, -40)
    const z = range(rand, 32, 150)
    if (clear(x, z, 9)) treeSpots.push({ x, y: QUAY, z, h: range(rand, 10, 14) })
  }
  addForest(THREE, scene, low ? treeSpots.filter((_, i) => i % 2 === 0) : treeSpots, { species: 'plane', season: 'autumn', seed: 11, quality: q })
  // tram stop at the north end: island platforms between the tracks and the road
  const shelterGlass = new THREE.MeshStandardMaterial({ color: 0x223040, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.3, depthWrite: false })
  const signLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6e6).multiplyScalar(2.2) })
  for (const s of [-1, 1]) {
    K.put(conc, boxGeo(THREE, 1.3, 0.3, 40, 4, 4), s * 4.35, QUAY, 155)
    K.put(darkSteel, new THREE.BoxGeometry(1.6, 0.12, 12), s * 4.35, QUAY + 3.0, 152)
    K.put(shelterGlass, new THREE.BoxGeometry(0.04, 2.4, 11), s * 4.95, QUAY + 1.5, 152)
    for (const z of [146.2, 157.8]) K.put(darkSteel, new THREE.BoxGeometry(0.08, 2.7, 0.08), s * 4.95, QUAY + 1.65, z)
    K.put(signLight, new THREE.BoxGeometry(0.1, 1.8, 1.2), s * 4.9, QUAY + 1.3, 159)
  }
  // benches on the boulevard
  const benches = []
  for (let x = -560; x < 450; x += 37) if (Math.abs(x) > 30 && clear(x, 6.5, 1.5)) benches.push({ x, y: QUAY, z: 6.5 })
  scatter(THREE, scene, mergeParts(THREE, [new THREE.BoxGeometry(1.9, 0.07, 0.48).translate(0, 0.46, 0), new THREE.BoxGeometry(1.9, 0.42, 0.06).translate(0, 0.75, 0.22), new THREE.BoxGeometry(0.1, 0.45, 0.45).translate(-0.8, 0.22, 0), new THREE.BoxGeometry(0.1, 0.45, 0.45).translate(0.8, 0.22, 0)]), std(THREE, 0x4a3a2c, 0.6), benches)

  /* --- lights: glows, pools, and their long reflections ---------------- */

  const glow = []
  for (const l of lampsAll) glow.push({ x: l.x, y: l.y + 5.9, z: l.z, color: 0xffc68a })
  for (const l of deckLamps) glow.push({ x: l.x, y: l.y + 8.85, z: l.z, color: 0xe6eeff, k: 0.9 })
  glowPoints(THREE, scene, glow, { size: 3.4, opacity: 0.8 })
  glowPoints(THREE, scene, violet.filter((_, i) => i % 2 === 0).map((v) => ({ x: v.x, y: v.y + 0.6, z: v.z, color: 0x8a40ff, k: 1.2 })), { size: 4.5, opacity: 0.7 })
  // floodlights at the pylon foot and the bridge's piers
  glowPoints(THREE, scene, [V(-24, 4, -296), V(24, 4, -296), V(-10, 3, -16), V(10, 3, -16)].map((p) => ({ x: p.x, y: p.y, z: p.z, color: 0xcfe0ff, k: 1.4 })), { size: 9, opacity: 0.7 })
  lightPools(THREE, scene, lampsAll.map((l) => ({ x: l.x, y: l.y, z: l.z, r: 6.5, color: 0xffb877 })), { opacity: 0.32 })
  lightPools(THREE, scene, deckLamps.map((l) => ({ x: l.x, y: l.y + 0.1, z: l.z, r: 8, color: 0xdfe8ff })), { opacity: 0.18 })
  const refl = []
  for (const [x, , w, , h] of pier) refl.push({ x, z: SOUTH, len: Math.min(240, h * 1.6), w: w * 0.5, color: 0xffcf96, k: 0.55 })
  for (const x of [-160, -118, -76]) refl.push({ x, z: SOUTH, len: 300, w: 22, color: 0xffd6a0, k: 0.75 })
  refl.push({ x: 58, z: SOUTH, len: 200, w: 18, color: 0x8dffb0, k: 0.4 })
  for (let i = 0; i < violet.length; i += 4) refl.push({ x: violet[i].x, z: SOUTH, len: range(rand, 40, 90), w: 2.2, color: 0x9a4dff, k: 0.9 })
  for (const l of quayLampsS) refl.push({ x: l.x, z: SOUTH, len: 70, w: 1.6, color: 0xffc07a, k: 0.9 })
  for (const l of quayLampsN) refl.push({ x: l.x, z: 0, len: 60, w: 1.4, color: 0xffc07a, k: 0.8, dir: -1 })
  for (const x of [-16.95, 16.95]) for (let z = -360; z < -20; z += 30) refl.push({ x, z: z, len: 30, w: 3, color: 0xdfe8ff, k: 0.35 })
  refl.push({ x: 0, z: SOUTH, len: 130, w: 10, color: 0xd6e2ff, k: 0.45 })
  const reflMesh = reflections(THREE, scene, refl, { opacity: 0.8 })

  scene.add(rail.build(steel, { castShadow: false }))
  K.flags(asphalt, { cast: false })
  K.flags(pave, { cast: false })
  K.flags(quayWall, { cast: false })
  K.flags(ledViolet, { cast: false, receive: false })
  K.flush()

  world.focusShadows(V(-40, 6, -40), low ? 70 : 90)

  const dummy = new THREE.Object3D()
  return {
    scene,
    world,
    path: {
      positions: arrival,
      targets: [V(0, 60, -300), V(-60, 58, -390), V(-110, 58, -420), aim(THREE, V(-90, 7, -8), deRotterdam, -10, 6), spots[0].look.clone()],
      fov: 48,
      near: 0.3,
      spots,
    },
    update(t) {
      water.userData.tick(t)
      reflMesh.userData.tick(t)
      for (const tr of trams) {
        const z = along(0, tr.dir, tr.speed, tr.phase, t)
        tr.g.position.set(tr.x, deckY(z) + 0.12, z)
        tr.g.rotation.set(pitchAt(z), tr.dir < 0 ? 0 : Math.PI, 0, 'XYZ')
      }
      cars.forEach((c, i) => {
        const z = along(0, c.dir, c.speed, c.phase, t)
        dummy.position.set(c.x, deckY(z) + 0.04, z)
        dummy.rotation.set(pitchAt(z), c.dir < 0 ? 0 : Math.PI, 0, 'XYZ')
        dummy.updateMatrix()
        carMesh.setMatrixAt(i, dummy.matrix)
        headMesh.setMatrixAt(i, dummy.matrix)
        tailMesh.setMatrixAt(i, dummy.matrix)
      })
      carMesh.instanceMatrix.needsUpdate = true
      headMesh.instanceMatrix.needsUpdate = true
      tailMesh.instanceMatrix.needsUpdate = true
    },
  }
}

/* ======================================================================== */
/* 3. The party boat, moored at a timber jetty at night                     */
/* ======================================================================== */

function buildPartyBoat(THREE, ctx) {
  const low = ctx.quality === 'low'
  const q = ctx.quality
  const world = createWorld(THREE, ctx, 'night', { fog: { density: 0.0019 } })
  const { scene } = world
  const K = toolkit(THREE, scene)
  const building = makeBuilding(THREE, K)
  const rand = seeded(808)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)

  // the boat: axis along X, bow at +X, starboard (+Z) against the jetty
  const MAIN = 1.4 // main deck
  const UP = 4.2 // upper (party) deck floor
  const CEIL = 6.85 // party room ceiling
  const JETTY = 0.75
  const QUAY = 2.4

  /* --- the tour --------------------------------------------------------- */

  const S0 = V(-13.4, UP + 1.5, 0)
  const spots = [
    { pos: S0, look: V(15, UP + 1.15, -0.4) }, // behind the DJ booth, down the party room
    { pos: V(-5, UP + 1.45, 1.6), look: V(-14, UP + 1.25, -0.6) }, // on the floor, facing the decks and speakers
    { pos: V(3.5, UP + 1.5, 1.2), look: V(13, UP + 0.9, -2.8) }, // toward the red bar
    { pos: V(21.5, MAIN + 1.6, -0.3), look: V(44, 4.5, 14) }, // out on the bow deck, the flag and the quay lights
    { pos: V(34, JETTY + 1.6, 8.6), look: V(-8, 4.6, 1.2) }, // on the jetty by the bow (the reference)
    { pos: V(-30, 13, 22), look: V(2, 3, -1) }, // above the jetty: the whole boat lit up
    { pos: V(-21, UP + 1.65, 0), look: V(-60, 5.5, 20) }, // the aft sundeck, the flag and the city
  ]
  const arrival = [V(-150, 45, -40), V(-80, 14, -8), V(-36, UP + 2.4, 0), V(-21, UP + 1.75, 0), S0.clone()]
  const clear = clearOfTour(spots, arrival)

  /* --- materials -------------------------------------------------------- */

  const planks = M.planks(THREE, { color: '#7a6247', width: 0.14, tile: 2, quality: q, seed: 91 })
  const deckPlanks = M.planks(THREE, { color: '#8a6d4c', width: 0.1, varnish: 1, tile: 2, quality: q, seed: 92 })
  const pave = M.paving(THREE, { kind: 'setts', color: '#6f6a63', joint: '#34322e', unit: 0.2, tile: 3, wet: 0.4, quality: q, seed: 93 })
  const asphalt = M.asphalt(THREE, { color: '#2c2d30', tile: 6, quality: q, seed: 94 })
  const quayBrick = M.brick(THREE, { color: '#4e3027', mortar: '#615851', dirt: 0.35, tile: 2, quality: q, seed: 95 })
  const floorMat = M.floor(THREE, { kind: 'tile', color: '#26262c', tileSize: 0.6, polish: 0.92, tile: 4, quality: q, seed: 96 })
  const fBrick = M.facade(THREE, { wall: 'brick', color: '#5d3a2c', mortar: '#7a6f66', frame: '#2a2a2a', glass: '#1a2026', bay: 3, storey: 3.1, window: { w: 0.62, h: 0.66, bars: null, sill: true, lintel: false }, night: 0.45, quality: q, seed: 97 })
  const fPale = M.facade(THREE, { wall: 'plaster', color: '#bdb7ad', frame: '#333333', glass: '#1a2026', bay: 3.2, storey: 3.1, window: { w: 0.7, h: 0.62, bars: null, sill: true, lintel: false }, night: 0.4, quality: q, seed: 98 })
  const fGlass = M.facade(THREE, { wall: 'curtain', color: '#2b333a', frame: '#3c4148', glass: '#1a2129', bay: 1.8, storey: 3.4, night: 0.5, quality: q, seed: 99 })
  const shop = M.shopfront(THREE, { color: '#211d1a', frame: '#141414', fascia: '#1d1d1d', bay: 3, storey: 4, night: 1, quality: q, seed: 100 })

  const hullRed = std(THREE, 0x8e1f1a, 0.6, 0.2)
  const hullDark = std(THREE, 0x2a2f31, 0.45, 0.45)
  const hullWhite = std(THREE, 0xe6e2d8, 0.38, 0.15)
  const paint = std(THREE, 0x2f3533, 0.5, 0.4) // the superstructure's dark grey-green
  const ceilMat = std(THREE, 0x141417, 0.92, 0)
  const steel = std(THREE, 0x8a8f94, 0.35, 0.9)
  const blackSteel = std(THREE, 0x1a1b1d, 0.5, 0.6)
  const rubber = std(THREE, 0x111111, 0.9)
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2328, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, envMapIntensity: 1.5, depthWrite: false })
  const neonViolet = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc35cff).multiplyScalar(3.2) })
  const neonBlue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3b5bff).multiplyScalar(3.2) })
  const neonRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1f2e).multiplyScalar(3.4) })
  const redPanel = new THREE.MeshStandardMaterial({ color: 0x3a0508, emissive: 0xff2030, emissiveIntensity: 2.3, roughness: 0.4 })
  const warmLED = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd2a0).multiplyScalar(3) })
  for (const m of [neonViolet, neonBlue, neonRed, warmLED, redPanel]) K.flags(m, { cast: false, receive: false })
  K.flags(glass, { cast: false, receive: false })

  /* --- water, quay, jetty -------------------------------------------------- */

  const water = waterMaterial(THREE, { palette: world.light, scale: 0.9, strokes: 1.3 })
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), water)
  sea.rotation.x = -Math.PI / 2
  scene.add(sea)
  // the quay (brick wall, setts on top), a far bank across the water
  K.put(quayBrick, boxGeo(THREE, 3000, QUAY + 3, 1500, 2, 2, SIDES), 0, -3, 13 + 750)
  K.put(pave, boxGeo(THREE, 3000, QUAY + 3, 1500, 3, 3, TOP, 3), 0, -3, 13 + 750)
  K.put(quayBrick, boxGeo(THREE, 3000, QUAY + 3, 1500, 2, 2, SIDES), 0, -3, -330 - 750)
  K.put(pave, boxGeo(THREE, 3000, QUAY + 3, 1500, 3, 3, TOP, 3), 0, -3, -330 - 750)
  K.put(asphalt, flatGeo(THREE, 3000, 12, 6, true), 0, QUAY + 0.04, 28)
  // the floating timber jetty with steel edges, on pontoons
  K.put(planks, flatGeo(THREE, 150, 8, 2, true), -5, JETTY, 9)
  K.put(blackSteel, new THREE.BoxGeometry(150, 0.6, 8).translate(0, 0.3, 0), -5, JETTY - 0.62, 9)
  for (const z of [5.06, 12.94]) K.put(steel, new THREE.BoxGeometry(150, 0.12, 0.12), -5, JETTY + 0.04, z)
  // the gangway ramp up to the quay
  K.put(steel, new THREE.BoxGeometry(12, 0.14, 2.2), -24, (JETTY + QUAY) / 2, 11.8, 0, 0, Math.atan2(QUAY - JETTY, 12))
  const rails = beamBatch(THREE)
  for (const z of [10.7, 12.9]) {
    rails.add(V(-30, JETTY + 1.0, z), V(-18, QUAY + 1.0, z), 0.05)
    for (let i = 0; i <= 6; i++) rails.add(V(-30 + i * 2, JETTY + (i / 6) * (QUAY - JETTY), z), V(-30 + i * 2, JETTY + (i / 6) * (QUAY - JETTY) + 1.0, z), 0.04)
  }
  // cleats on the jetty edge, a bench, the jetty's lamps
  const cleats = []
  for (let x = -60; x <= 50; x += 11) cleats.push({ x, y: JETTY, z: 5.5 })
  scatter(THREE, scene, mergeParts(THREE, [new THREE.BoxGeometry(0.5, 0.08, 0.12).translate(0, 0.16, 0), new THREE.BoxGeometry(0.12, 0.16, 0.1).translate(-0.12, 0.08, 0), new THREE.BoxGeometry(0.12, 0.16, 0.1).translate(0.12, 0.08, 0)]), steel, cleats)
  K.put(planks, new THREE.BoxGeometry(2.2, 0.08, 0.5), 18, JETTY + 0.46, 11.8)
  K.put(blackSteel, new THREE.BoxGeometry(0.1, 0.44, 0.45).translate(-0.95, 0.22, 0), 18, JETTY, 11.8)
  K.put(blackSteel, new THREE.BoxGeometry(0.1, 0.44, 0.45).translate(0.95, 0.22, 0), 18, JETTY, 11.8)
  const lampSpots = []
  for (const x of [-48, -10, 13, 44]) if (clear(x, 12.4, 1.2)) lampSpots.push({ x, y: JETTY, z: 12.4 })
  const streetLamps = []
  for (let x = -160; x < 160; x += 26) if (clear(x, 15, 1.5)) streetLamps.push({ x, y: QUAY, z: 15 })
  for (let x = -150; x < 160; x += 30) streetLamps.push({ x, y: QUAY, z: 35 })
  const allLamps = [...lampSpots.map((l) => ({ ...l, h: 6.5 })), ...streetLamps.map((l) => ({ ...l, h: 7 }))]
  const pole = mergeParts(THREE, [new THREE.CylinderGeometry(0.06, 0.1, 1, 8).translate(0, 0.5, 0)])
  scatter(THREE, scene, pole, std(THREE, 0x8b9096, 0.4, 0.8), allLamps.map((l) => ({ x: l.x, y: l.y, z: l.z, sy: l.h, sx: 1, sz: 1 })), { cast: false })
  scatter(THREE, scene, new THREE.CylinderGeometry(0.28, 0.2, 0.22, 10), std(THREE, 0x6d7278, 0.4, 0.8), allLamps.map((l) => ({ x: l.x, y: l.y + l.h + 0.1, z: l.z })), { cast: false })
  scatter(THREE, scene, new THREE.CylinderGeometry(0.19, 0.19, 0.04, 10), warmLED, allLamps.map((l) => ({ x: l.x, y: l.y + l.h - 0.02, z: l.z })), { cast: false, receive: false })
  // traffic lights and a bus-stop sign on the street
  const signal = mergeParts(THREE, [new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8).translate(0, 1.6, 0), new THREE.BoxGeometry(0.3, 0.9, 0.25).translate(0, 3.0, 0)])
  const signals = [
    { x: 30, y: QUAY, z: 22.5 },
    { x: 44, y: QUAY, z: 33.5 },
    { x: -40, y: QUAY, z: 22.5 },
  ]
  scatter(THREE, scene, signal, blackSteel, signals, { cast: false })

  /* --- buildings along the street, and the far bank --------------------- */

  for (let x = -260, i = 0; x < 260; i++) {
    const fac = pick(rand, [fBrick, fPale, fGlass, fBrick])
    const w = Math.round(range(rand, 18, 40) / fac.tile[0]) * fac.tile[0]
    const storeys = Math.round(range(rand, 5, 9))
    building({ x: x + w / 2, z: 56, w, d: 26, h: storeys * fac.tile[1], y: QUAY, fac, roof: asphalt, trim: blackSteel, shop: i % 2 ? shop : null })
    x += w + range(rand, 2, 8)
  }
  for (let x = -900; x < 900; ) {
    const fac = pick(rand, [fBrick, fPale, fGlass])
    const w = Math.round(range(rand, 30, 60) / fac.tile[0]) * fac.tile[0]
    building({ x: x + w / 2, z: -360 - range(rand, 0, 40), w, d: 30, h: Math.round(range(rand, 5, 14)) * fac.tile[1], y: QUAY, fac, roof: asphalt })
    x += w + range(rand, 10, 30)
  }
  for (let x = -1200; x < 1200; ) {
    const fac = pick(rand, [fBrick, fPale, fGlass])
    const w = range(rand, 30, 70)
    building({ x: x + w / 2, z: range(rand, 110, 200), w, d: 30, h: range(rand, 15, 45), y: QUAY, fac, roof: asphalt })
    x += w + range(rand, 10, 40)
  }
  const treeSpots = []
  for (let x = -150; x < 150; x += 15) if (clear(x, 19, 6)) treeSpots.push({ x: x + range(rand, -2, 2), y: QUAY, z: 19, h: range(rand, 8, 11) })
  addForest(THREE, scene, low ? treeSpots.filter((_, i) => i % 2 === 0) : treeSpots, { species: 'lime', season: 'autumn', seed: 5, quality: q })

  /* --- the boat ---------------------------------------------------------- */

  const X0 = -28
  const X1 = 28.6
  const HALF = 4.5
  const outline = hullShape(THREE, X0, X1, HALF, 14)
  const inner = hullShape(THREE, X0 + 0.25, X1 - 0.6, HALF - 0.22, 14)
  K.put(hullRed, planExtrude(THREE, hullShape(THREE, X0 + 0.2, X1 - 0.5, HALF - 0.1, 14), -1.3, 0.14))
  K.put(hullDark, planExtrude(THREE, outline, 0.14, 0.95))
  K.put(hullWhite, planExtrude(THREE, outline, 0.95, MAIN - 0.05))
  // the topsides and bulwark: a white ring round the deck edge, a black rubbing strake
  {
    const ring = hullShape(THREE, X0, X1, HALF, 14)
    ring.holes.push(inner)
    K.put(hullWhite, planExtrude(THREE, ring, MAIN - 0.05, 2.35, 16))
    const strake = hullShape(THREE, X0 - 0.06, X1 + 0.06, HALF + 0.07, 14)
    strake.holes.push(hullShape(THREE, X0 + 0.1, X1 - 0.2, HALF - 0.08, 14))
    K.put(blackSteel, planExtrude(THREE, strake, 1.42, 1.58, 16))
    const capRing = hullShape(THREE, X0 - 0.02, X1 + 0.02, HALF + 0.03, 14)
    capRing.holes.push(hullShape(THREE, X0 + 0.22, X1 - 0.65, HALF - 0.25, 14))
    K.put(blackSteel, planExtrude(THREE, capRing, 2.35, 2.42, 16))
  }
  // main deck (steel, non-slip grey) and the bow deck
  K.put(std(THREE, 0x4b4f52, 0.85, 0.2), planExtrude(THREE, inner, MAIN - 0.05, MAIN))
  // the lower salon: dark walls with a band of lit windows
  const lowerWin = (() => {
    const draw = (emit) => (g, w, h) => {
      const r2 = seeded(emit ? 3 : 3)
      g.fillStyle = emit ? '#000' : '#2f3533'
      g.fillRect(0, 0, w, h)
      const n = 8
      for (let i = 0; i < n; i++) {
        const x = (i / n) * w + w * 0.012
        const ww = w / n - w * 0.024
        const y = h * 0.28
        const hh = h * 0.42
        const tint = pick(r2, emit ? ['#ffb77a', '#ffcf96', '#ff5a6a', '#7a6bff', '#ffcf96'] : ['#16191b'])
        if (emit) {
          const grd = g.createLinearGradient(0, y, 0, y + hh)
          grd.addColorStop(0, tint)
          grd.addColorStop(1, 'rgba(60,30,20,0.6)')
          g.fillStyle = grd
          g.globalAlpha = 0.55 + r2() * 0.4
        } else {
          g.fillStyle = '#16191b'
          g.globalAlpha = 1
          g.fillRect(x - 2, y - 2, ww + 4, hh + 4)
          g.fillStyle = '#20262a'
        }
        g.fillRect(x, y, ww, hh)
        g.globalAlpha = 1
      }
    }
    const map = paintTexture(THREE, 1024, 128, draw(false), { kind: 'color' })
    const emissiveMap = paintTexture(THREE, 1024, 128, draw(true), { kind: 'color' })
    return new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.45, metalness: 0.35 })
  })()
  K.flags(lowerWin, { cast: true })
  K.put(lowerWin, boxGeo(THREE, 39, UP - 0.2 - MAIN, 7.8, 12.8, UP - 0.2 - MAIN, SIDES), -2.5, MAIN, 0)
  // upper deck floor (also the lower salon's roof), extending aft over the sundeck
  K.put(paint, boxGeo(THREE, 44, 0.2, 8.6, 4, 4), -5, UP - 0.2, 0)
  K.put(deckPlanks, flatGeo(THREE, 12, 8.4, 2, true), -21, UP + 0.005, 0)
  K.put(floorMat, flatGeo(THREE, 30, 7.6, 4), 0, UP + 0.005, 0)
  for (const x of [-27, -22.5]) for (const z of [-4, 4]) K.put(steel, new THREE.CylinderGeometry(0.06, 0.06, UP - 0.2 - MAIN, 8).translate(0, (UP - 0.2 - MAIN) / 2, 0), x, MAIN, z)

  // the party room's shell: sill walls, glazing with mullions, header, roof
  const roomX0 = -15
  const roomX1 = 15
  const W = 3.8
  const sillTop = UP + 0.8
  const winTop = UP + 2.35
  for (const s of [-1, 1]) {
    K.put(paint, new THREE.BoxGeometry(30, 0.8, 0.14).translate(0, 0.4, 0), 0, UP, s * W)
    K.put(paint, new THREE.BoxGeometry(30, CEIL - winTop + 0.25, 0.14).translate(0, (CEIL - winTop + 0.25) / 2, 0), 0, winTop, s * W)
    K.put(glass, new THREE.BoxGeometry(30, winTop - sillTop, 0.03).translate(0, (winTop - sillTop) / 2, 0), 0, sillTop, s * W)
    for (let x = roomX0; x <= roomX1 + 0.01; x += 1.5) K.put(blackSteel, new THREE.BoxGeometry(0.09, winTop - sillTop, 0.16).translate(0, (winTop - sillTop) / 2, 0), x, sillTop, s * W)
  }
  // aft wall: an open double doorway (2.4 wide, 2.4 high) in a dark wall
  for (const s of [-1, 1]) K.put(paint, new THREE.BoxGeometry(0.14, CEIL - UP, W - 1.2).translate(0, (CEIL - UP) / 2, 0), roomX0, UP, s * (1.2 + (W - 1.2) / 2))
  K.put(paint, new THREE.BoxGeometry(0.14, CEIL - UP - 2.45, 2.4).translate(0, (CEIL - UP - 2.45) / 2, 0), roomX0, UP + 2.45, 0)
  // front wall: windows either side of a narrow door
  for (const s of [-1, 1]) {
    const zc = s * (0.7 + (W - 0.7) / 2)
    const span = W - 0.7
    K.put(paint, new THREE.BoxGeometry(0.14, 0.8, span).translate(0, 0.4, 0), roomX1, UP, zc)
    K.put(glass, new THREE.BoxGeometry(0.03, winTop - sillTop, span).translate(0, (winTop - sillTop) / 2, 0), roomX1, sillTop, zc)
    K.put(paint, new THREE.BoxGeometry(0.14, CEIL - winTop + 0.25, span).translate(0, (CEIL - winTop + 0.25) / 2, 0), roomX1, winTop, zc)
  }
  K.put(paint, new THREE.BoxGeometry(0.14, CEIL - UP - 2.15, 1.4).translate(0, (CEIL - UP - 2.15) / 2, 0), roomX1, UP + 2.15, 0)
  // roof slab (the ceiling inside is its underside) with a white edge outside
  K.put(ceilMat, boxGeo(THREE, 30.4, 0.25, 7.9, 4, 4), 0, CEIL, 0)
  K.put(hullWhite, new THREE.BoxGeometry(30.6, 0.12, 8.1), 0, CEIL + 0.25, 0)
  // the wheelhouse on the roof, forward, with a mast and navigation lights
  K.put(paint, boxGeo(THREE, 5.5, 1.1, 4.6, 4, 4), 11.2, CEIL + 0.28, 0)
  K.put(new THREE.MeshStandardMaterial({ color: 0x0f1418, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.3 }), new THREE.BoxGeometry(5.5, 1.0, 4.62), 11.2, CEIL + 1.37 + 0.5, 0)
  K.put(hullWhite, new THREE.BoxGeometry(6.0, 0.18, 5.2), 11.2, CEIL + 2.45, 0)
  K.put(steel, new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8).translate(0, 1.6, 0), 10.2, CEIL + 2.55, 0)
  K.put(steel, new THREE.BoxGeometry(0.12, 0.1, 2.4), 10.2, CEIL + 4.2, 0)
  const navWhite = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(5) })
  K.put(navWhite, new THREE.SphereGeometry(0.12, 10, 8), 10.2, CEIL + 5.85, 0)
  K.put(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(4) }), new THREE.BoxGeometry(0.2, 0.2, 0.12), 12.5, CEIL + 2.2, -2.4)
  K.put(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x20ff60).multiplyScalar(4) }), new THREE.BoxGeometry(0.2, 0.2, 0.12), 12.5, CEIL + 2.2, 2.4)
  // the deck floodlight on the superstructure front
  K.put(blackSteel, new THREE.BoxGeometry(0.3, 0.3, 0.4), 15.2, CEIL - 0.25, -0.9)
  K.put(navWhite, new THREE.BoxGeometry(0.06, 0.22, 0.3), 15.37, CEIL - 0.25, -0.9)
  // the landing in front of the room and the ladder down to the bow deck
  railRun(V(15.2, UP, -3.9), V(17, UP, -3.9))
  railRun(V(15.2, UP, 3.9), V(17, UP, 3.9))
  function railRun(a, b, h = 1.0) {
    const n = Math.max(1, Math.round(a.distanceTo(b) / 1.2))
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n)
      rails.add(p, p.clone().add(V(0, h, 0)), 0.045)
    }
    rails.add(a.clone().add(V(0, h, 0)), b.clone().add(V(0, h, 0)), 0.06)
    rails.add(a.clone().add(V(0, h / 2, 0)), b.clone().add(V(0, h / 2, 0)), 0.03)
  }
  for (const z of [1.25, 1.95]) K.strut(steel, V(17.1, UP, z), V(19.2, MAIN, z), 0.06, 0.12)
  for (let i = 1; i < 8; i++) {
    const t = i / 8
    K.put(steel, new THREE.BoxGeometry(0.22, 0.04, 0.72), 17.1 + 2.1 * t, UP - (UP - MAIN) * t, 1.6)
  }
  // the sundeck rail (white) around the aft upper deck
  railRun(V(-27, UP, -4.2), V(-15.1, UP, -4.2))
  railRun(V(-27, UP, 4.2), V(-15.1, UP, 4.2))
  railRun(V(-27, UP, -4.2), V(-27, UP, -1.4))
  railRun(V(-27, UP, 1.4), V(-27, UP, 4.2))
  // lifebuoys, fenders, bitts, the gangway, mooring lines
  const buoys = []
  for (const [x, z, ry] of [
    [-6, 3.92, 0],
    [9, 3.92, 0],
    [-6, -3.92, Math.PI],
    [9, -3.92, Math.PI],
    [-24, 4.25, 0],
  ]) buoys.push({ x, y: z === 4.25 ? UP + 0.6 : MAIN + 1.4, z, ry })
  scatter(THREE, scene, new THREE.TorusGeometry(0.34, 0.085, 8, 18), std(THREE, 0xe2462a, 0.6), buoys)
  scatter(THREE, scene, new THREE.CylinderGeometry(0.16, 0.16, 0.9, 10), rubber, [-20, -12, -4, 4, 12].map((x) => ({ x, y: 1.0, z: HALF + 0.18 })))
  const bitts = []
  for (const [x, z] of [
    [19.5, 1.6],
    [19.5, 2.2],
    [-25.5, 2.4],
    [-25.5, 3.0],
  ]) bitts.push({ x, y: MAIN, z })
  scatter(THREE, scene, mergeParts(THREE, [new THREE.CylinderGeometry(0.15, 0.17, 0.55, 12).translate(0, 0.27, 0), new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12).translate(0, 0.56, 0)]), std(THREE, 0x2a2a2a, 0.5, 0.6), bitts)
  const rope = std(THREE, 0xc8b48a, 0.85)
  const line = (bitt, lead, b, sag) => {
    const mid = lead.clone().lerp(b, 0.5)
    mid.y -= sag
    const curve = new THREE.CatmullRomCurve3([bitt, lead, mid, b])
    K.put(rope, new THREE.TubeGeometry(curve, 28, 0.035, 5, false))
  }
  line(V(19.5, MAIN + 0.5, 1.9), V(16, 2.44, 4.45), V(26, JETTY + 0.18, 5.5), 0.35)
  line(V(19.5, MAIN + 0.5, 1.9), V(15.2, 2.44, 4.47), V(8, JETTY + 0.18, 5.5), 0.3)
  line(V(-25.5, MAIN + 0.5, 2.7), V(-25.5, 2.44, 4.47), V(-33, JETTY + 0.18, 5.5), 0.3)
  line(V(-25.5, MAIN + 0.5, 2.7), V(-24.5, 2.44, 4.47), V(-15, JETTY + 0.18, 5.5), 0.3)
  // gangway: an aluminium brow from the jetty to the side door, with handrails
  K.put(steel, new THREE.BoxGeometry(1.2, 0.08, 3.4), -1, (JETTY + 2.35) / 2, 6.3, 0, Math.atan2(2.35 - JETTY, 3.4))
  for (const dx of [-0.6, 0.6]) K.rod(steel, V(-1 + dx, 2.35 + 1.0, 4.6), V(-1 + dx, JETTY + 1.0, 8.0), 0.025)
  // flags: Amsterdam at the bow (as in the photo), the Dutch tricolour at the stern
  const bowFlag = makeFlag(THREE, 'amsterdam', { pole: 4.6, w: 1.5, h: 1.0 })
  bowFlag.group.position.set(27.4, MAIN + 0.2, 0)
  bowFlag.group.rotation.y = Math.PI * 0.85
  const sternFlag = makeFlag(THREE, 'nl', { pole: 4.4, w: 1.4, h: 0.95 })
  sternFlag.group.position.set(-28.1, MAIN, -2.9)
  sternFlag.group.rotation.y = Math.PI * 0.9
  scene.add(bowFlag.group, sternFlag.group)

  /* --- inside the party room ------------------------------------------------- */

  // neon along both ceiling edges (violet), blue across the ends, a red line over the bar
  for (const s of [-1, 1]) {
    K.put(neonViolet, new THREE.BoxGeometry(29.6, 0.035, 0.035), 0, CEIL - 0.08, s * (W - 0.18))
    K.put(neonBlue, new THREE.BoxGeometry(29.6, 0.03, 0.03), 0, winTop + 0.02, s * (W - 0.12))
    K.put(paint, new THREE.BoxGeometry(29.6, 0.12, 0.1), 0, CEIL - 0.02, s * (W - 0.12))
  }
  K.put(neonBlue, new THREE.BoxGeometry(0.035, 0.035, 7.2), roomX0 + 0.18, CEIL - 0.08, 0)
  K.put(neonViolet, new THREE.BoxGeometry(0.035, 0.035, 7.2), roomX1 - 0.18, CEIL - 0.08, 0)
  // the bar (port side, forward): red-glowing front, dark top, back bar with bottles
  K.put(redPanel, new THREE.BoxGeometry(4.8, 1.0, 0.06).translate(0, 0.5, 0), 11.8, UP, -2.25)
  K.put(blackSteel, new THREE.BoxGeometry(4.8, 1.0, 0.9).translate(0, 0.5, 0), 11.8, UP, -2.75)
  K.put(new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.15, metalness: 0.2, clearcoat: 1 }), new THREE.BoxGeometry(5.0, 0.06, 1.1), 11.8, UP + 1.02, -2.72)
  K.put(neonRed, new THREE.BoxGeometry(4.6, 0.04, 0.04), 11.8, CEIL - 0.35, -2.4)
  K.put(blackSteel, new THREE.BoxGeometry(4.6, 1.5, 0.35).translate(0, 0.75, 0), 11.8, UP + 0.4, -3.55)
  const bottles = []
  for (let i = 0; i < 26; i++) bottles.push({ x: 9.7 + i * 0.165, y: UP + 1.92, z: -3.5, color: pick(rand, [0x3a6b3a, 0x7a4a18, 0xdedede, 0x2a3e7a, 0x8a1a1a]) })
  scatter(THREE, scene, new THREE.CylinderGeometry(0.035, 0.04, 0.3, 6).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.2, emissive: 0x501018, emissiveIntensity: 1 }), bottles, { cast: false })
  K.put(neonRed, new THREE.BoxGeometry(4.6, 0.025, 0.025), 11.8, UP + 1.9, -3.36)
  // the DJ booth at the aft end: a flight-case table, decks and mixer, speakers on stands
  K.put(blackSteel, new THREE.BoxGeometry(1.0, 1.02, 2.8).translate(0, 0.51, 0), -11.5, UP, 0)
  K.put(steel, new THREE.BoxGeometry(1.04, 0.04, 2.84), -11.5, UP + 1.02, 0)
  for (const z of [-0.85, 0, 0.85]) K.put(std(THREE, 0x202124, 0.3, 0.6), new THREE.BoxGeometry(0.5, 0.1, z === 0 ? 0.4 : 0.36), -11.5, UP + 1.06, z)
  const screens = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5ab4ff).multiplyScalar(2) })
  for (const z of [-0.85, 0.85]) K.put(screens, new THREE.BoxGeometry(0.16, 0.012, 0.22), -11.62, UP + 1.12, z)
  for (const s of [-1, 1]) {
    K.put(blackSteel, new THREE.CylinderGeometry(0.03, 0.03, 1.3, 6).translate(0, 0.65, 0), -11.6, UP, s * 2.2)
    K.put(std(THREE, 0x18181a, 0.7, 0.1), new THREE.BoxGeometry(0.5, 0.85, 0.5).translate(0, 0.42, 0), -11.6, UP + 1.3, s * 2.2)
    K.put(std(THREE, 0x2a2a2c, 0.9), new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16).rotateZ(Math.PI / 2), -11.34, UP + 1.6, s * 2.2)
  }
  // banquettes under the windows, a few high tables, ceiling speakers
  for (const s of [-1, 1]) K.put(std(THREE, 0x1c1418, 0.8), new THREE.BoxGeometry(18, 0.48, 0.55).translate(0, 0.24, 0), -0.5, UP, s * (W - 0.35))
  const tables = [
    { x: -2, z: 2.6 },
    { x: 6, z: 2.4 },
    { x: -7.5, z: -2.6 },
  ].filter((t) => clear(t.x, t.z, 0.8))
  scatter(THREE, scene, mergeParts(THREE, [new THREE.CylinderGeometry(0.32, 0.32, 0.04, 16).translate(0, 1.08, 0), new THREE.CylinderGeometry(0.04, 0.04, 1.06, 8).translate(0, 0.53, 0), new THREE.CylinderGeometry(0.25, 0.25, 0.03, 16)]), blackSteel, tables.map((t) => ({ x: t.x, y: UP, z: t.z })))
  for (const x of [-8, -1, 6]) K.put(std(THREE, 0x2a2a2c, 0.8), new THREE.CylinderGeometry(0.28, 0.28, 0.02, 16), x, CEIL - 0.01, 0)
  // a mirror ball over the dance floor
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.05, metalness: 1, flatShading: true }))
  ball.position.set(-4, CEIL - 0.42, 0)
  scene.add(ball)
  K.put(steel, new THREE.CylinderGeometry(0.01, 0.01, 0.2, 4), -4, CEIL - 0.2, 0)
  // the lights in the room (cheap point lights, no shadows)
  const lights = [
    { c: 0xb24dff, p: V(-8, CEIL - 0.3, 0), i: 30, d: 16 },
    { c: 0x4a62ff, p: V(0, CEIL - 0.3, 0), i: 34, d: 16 },
    { c: 0x5a6bff, p: V(-3, CEIL - 0.4, 2.4), i: 16, d: 12 },
    { c: 0xb24dff, p: V(7, CEIL - 0.3, 0.5), i: 28, d: 15 },
    { c: 0xff2030, p: V(11.8, UP + 1.6, -1.6), i: 22, d: 10 },
    { c: 0xffe0c0, p: V(-12.5, CEIL - 0.3, 0), i: 12, d: 8 },
  ].map((l) => {
    const pl = new THREE.PointLight(l.c, l.i, l.d, 2)
    pl.position.copy(l.p)
    scene.add(pl)
    return { pl, base: l.i }
  })

  /* --- glows, light pools and reflections ------------------------------------ */

  const glow = []
  for (const l of allLamps) glow.push({ x: l.x, y: l.y + l.h - 0.05, z: l.z, color: 0xffc68a })
  glow.push({ x: 10.2, y: CEIL + 5.85, z: 0, color: 0xffffff, k: 1.2 })
  glow.push({ x: 15.45, y: CEIL - 0.25, z: -0.9, color: 0xfff2dc, k: 1.4 })
  for (const s of signals) glow.push({ x: s.x, y: s.y + 3.15, z: s.z - 0.15, color: pick(rand, [0xff2a20, 0x30ff70]), k: 0.9 })
  glowPoints(THREE, scene, glow, { size: 3.2, opacity: 0.85 })
  glowPoints(THREE, scene, [V(12.5, CEIL + 2.2, -2.5), V(12.5, CEIL + 2.2, 2.5)].map((p, i) => ({ x: p.x, y: p.y, z: p.z, color: i ? 0x30ff70 : 0xff2a20 })), { size: 1.6 })
  lightPools(THREE, scene, allLamps.map((l) => ({ x: l.x, y: l.y, z: l.z, r: 5.5, color: 0xffb877 })), { opacity: 0.34 })
  const refl = []
  for (let x = -14; x <= 14; x += 3) refl.push({ x, z: -HALF, len: 26, w: 2.2, color: pick(rand, [0xc35cff, 0xff3a4a, 0x5a6bff]), k: 0.8, dir: -1 })
  for (let x = -20; x <= 14; x += 4) refl.push({ x, z: -HALF, len: 18, w: 2, color: 0xffb070, k: 0.5, dir: -1 })
  for (const l of allLamps) refl.push({ x: l.x, z: 5, len: 40, w: 1.4, color: 0xffc07a, k: 0.6, dir: -1 })
  for (let x = -600; x < 600; x += 14) refl.push({ x: x + range(rand, -4, 4), z: -330, len: range(rand, 60, 160), w: range(rand, 2, 6), color: pick(rand, [0xffc98a, 0xffd9a8, 0xbcd4ff]), k: 0.45 })
  const reflMesh = reflections(THREE, scene, refl, { opacity: 0.8 })

  scene.add(rails.build(steel, { castShadow: false }))
  K.flags(asphalt, { cast: false })
  K.flags(pave, { cast: false })
  K.flags(quayBrick, { cast: false })
  K.flush()

  world.focusShadows(V(0, 3, 4), low ? 40 : 55)

  return {
    scene,
    world,
    path: {
      positions: arrival,
      targets: [V(0, 4, 0), V(0, 5, 0), V(10, UP + 1.3, 0), V(15, UP + 1.2, -0.2), spots[0].look.clone()],
      fov: 52,
      near: 0.15,
      spots,
    },
    update(t) {
      water.userData.tick(t)
      reflMesh.userData.tick(t)
      bowFlag.tick(t)
      sternFlag.tick(t + 1.3)
      ball.rotation.y = t * 0.6
      // the room breathes with the music: a 124 bpm pulse on the colour lights
      const beat = Math.pow(0.5 + 0.5 * Math.cos(t * Math.PI * 2 * (124 / 60)), 6)
      lights.forEach((l, i) => {
        l.pl.intensity = l.base * (0.75 + 0.45 * (i % 2 ? beat : 1 - beat))
      })
    },
  }
}
