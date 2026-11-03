/**
 * Eindhoven centre and the Blob — the SRC × MANA run club on a bright, hazy
 * early-spring morning.
 *
 * Built from the club's photographs: the run starts along a park strip past a
 * white sports pavilion with a long flat canopy and a weeping willow (photo
 * 1), runs down a brick-paved street of bare trees (2), across 18
 * Septemberplein past the white arched hood of the underground bike park,
 * station-area towers in the haze (5), to the Blob — Fuksas's free-form dome
 * of triangulated steel, glass above and white panels low down — where MANA
 * has its entrance (7) and a café with a DJ under the glass (8–13). Beside it
 * the curved glass Admirant tower, Piazza shopping centre to the north, the
 * Vestdijk to the east.
 *
 * Metres. The Blob is at the origin; north (the station) is −Z.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createWorld } from '../world.js'
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
 * out.h (height 0..1), out.ro (roughness), out.me (metalness). v runs up the
 * face (row 0 is the bottom). Roughness and metalness share one texture (G, B).
 */
function pbr(THREE, W, H, paint, { normal = 2 } = {}) {
  const n = W * H
  const col = new Uint8Array(n * 4)
  const rm = new Uint8Array(n * 4)
  const hgt = new Float32Array(n)
  const o = { r: 0, g: 0, b: 0, h: 0, ro: 0, me: 0 }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      o.r = o.g = o.b = 0.5
      o.h = 0.5
      o.ro = 0.85
      o.me = 0
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
  return { map: dataTex(THREE, col, W, H, true), normalMap: dataTex(THREE, nm, W, H, false), rm: dataTex(THREE, rm, W, H, false) }
}
function pbrMat(THREE, set, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.rm,
    metalnessMap: set.rm,
    roughness: 1,
    metalness: 1,
    ...extra,
  })
}

/**
 * A facade, one tile = cols × rows cells of tile[0] × tile[1] metres.
 * win: window rect inside each cell [x0, x1, y0, y1] (fractions). Frames,
 * mullions (`mull` panes per window), a transom, blinds behind some panes,
 * dark spandrel glass, panel joints, white mullion caps. Glass is smooth and
 * metallic so it mirrors the sky.
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
    spandrel = null,
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
        // the wall: tone, grit, panel joints, a faint dirt streak under each sill
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
      if (spandrel && ly / wh > spandrel[0] && ly / wh < spandrel[1] && !isFrame) {
        const c = spandrel[2]
        const j = 0.94 + vnoise(u * 9, v * 9, 9, seed + 5) * 0.12
        p.r = c[0] * j
        p.g = c[1] * j
        p.b = c[2] * j
        p.h = 0.42
        p.ro = 0.32
        p.me = 0.35
        return
      }
      if (isFrame) {
        p.r = frame[0]
        p.g = frame[1]
        p.b = frame[2]
        p.h = 0.5
        p.ro = 0.42
        p.me = 0.55
        return
      }
      // glass: each pane a slightly different tint and flatness
      const id = ix * 7 + iy * 131 + pane * 17
      const t = 0.9 + hash(id, 3, seed) * 0.2
      p.r = glass[0] * t
      p.g = glass[1] * t
      p.b = glass[2] * t
      p.h = 0.3
      p.ro = 0.04 + hash(id, 5, seed) * 0.1
      p.me = 1
      // the deep reveal throws a little shade over the top of the pane
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
    build(scene, { cast = true, receive = true } = {}) {
      for (const [mat, list] of groups) {
        // merging needs all-indexed or all-non-indexed geometry (extrusions are non-indexed)
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

/** Lettering painted on a transparent plane (faces +Z). */
function lettering(THREE, text, { w, h, font, color = '#ffffff', px = 160, align = 'center', emissive = 0 }) {
  const c = document.createElement('canvas')
  const ratio = w / h
  c.height = px
  c.width = Math.min(4096, Math.round(px * ratio))
  const g = c.getContext('2d')
  g.clearRect(0, 0, c.width, c.height)
  g.fillStyle = color
  g.font = font.replace('{px}', Math.round(px * 0.78))
  g.textBaseline = 'middle'
  g.textAlign = align
  g.fillText(text, align === 'center' ? c.width / 2 : 4, c.height / 2)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  const mat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.4, roughness: 0.45, metalness: 0.2, emissive: new THREE.Color(color), emissiveMap: t, emissiveIntensity: emissive })
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
}

/* --- props ------------------------------------------------------------------ */

/** A Dutch step-through city bike, along +X, wheels on the ground. */
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
  return mergeGeometries(parts, false)
}

/**
 * Rows of bikes in steel hoop racks. rows: [{ x, z, len, dir (radians of the
 * row), n }]. Bikes stand across the row.
 */
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
        // the hoop: across the row
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
  const palette = [0x161616, 0x1b1c1e, 0x111214, 0x22262c, 0x2d3d52, 0x5b1c1c, 0x6b6e70, 0xc9c1ad, 0x23402e, 0x161616]
  list.forEach((b, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw)
    m.compose(new THREE.Vector3(b.x, 0, b.z), q, s)
    bikes.setMatrixAt(i, m)
    bikes.setColorAt(i, col.setHex(pick(rand, palette)))
  })
  bikes.castShadow = true
  bikes.instanceMatrix.needsUpdate = true
  if (bikes.instanceColor) bikes.instanceColor.needsUpdate = true
  scene.add(bikes)
}

/** Slim modern campus lamp posts with a flat LED head. */
function addLampPosts(THREE, scene, spots, { height = 6 } = {}) {
  if (!spots.length) return
  const metal = new THREE.MeshStandardMaterial({ color: 0x3b3e42, metalness: 0.7, roughness: 0.4 })
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.085, height, 8).translate(0, height / 2, 0), metal, spots.length)
  const headGeo = new THREE.BoxGeometry(0.75, 0.09, 0.22).translate(0.3, height, 0)
  const head = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0x2f3236, metalness: 0.6, roughness: 0.4, emissive: 0xfff1d8, emissiveIntensity: 0.05 }), spots.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.r || 0)
    m.compose(new THREE.Vector3(s.x, s.y || 0, s.z), q, one)
    pole.setMatrixAt(i, m)
    head.setMatrixAt(i, m)
  })
  pole.castShadow = head.castShadow = true
  scene.add(pole, head)
}

/** Instanced boxes from a list of { x, y, z, w, h, d, r } (unit box scaled). */
function instBoxes(THREE, scene, list, mat, { cast = true, geo = null } = {}) {
  if (!list.length) return null
  const mesh = new THREE.InstancedMesh(geo || new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, list.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)
  list.forEach((b, i) => {
    q.setFromAxisAngle(yAxis, b.r || 0)
    m.compose(new THREE.Vector3(b.x, b.y || 0, b.z), q, new THREE.Vector3(b.w, b.h, b.d))
    mesh.setMatrixAt(i, m)
  })
  mesh.castShadow = cast
  mesh.receiveShadow = true
  scene.add(mesh)
  return mesh
}


/* --- the Blob ------------------------------------------------------------------ */

const BLOB = { ax: 24, ay: 19, az: 16, y0: 5 }
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
/** The Blob's skin at (x, y), walking in from the south. */
function blobSouth(x, y) {
  for (let z = 45; z > 0; z -= 0.05) if (insideBlob(x, y, z)) return z
  return 0
}

/**
 * The Blob: a deformed geodesic sphere, cut at the ground. Every triangle is
 * a panel (glass above, white aluminium low down and here and there); every
 * edge a white steel member, every vertex a node.
 */
function buildBlob(THREE, scene, { low, rand, glassMat, whiteMat, steelMat, clear = [] }) {
  const ico = new THREE.IcosahedronGeometry(1, low ? 5 : 7)
  const P = ico.attributes.position
  const glass = []
  const white = []
  const edges = new Map()
  const nodes = new Map()
  const key = (p) => `${Math.round(p[0] * 200)},${Math.round(p[1] * 200)},${Math.round(p[2] * 200)}`
  const vert = (i) => {
    const d = unit3(P.getX(i), P.getY(i), P.getZ(i))
    const r = blobR(d[0], d[1], d[2])
    return [d[0] * BLOB.ax * r, Math.max(0, BLOB.y0 + d[1] * BLOB.ay * r), d[2] * BLOB.az * r]
  }
  for (let i = 0; i < P.count; i += 3) {
    const v = [vert(i), vert(i + 1), vert(i + 2)]
    if (v[0][1] <= 0.02 && v[1][1] <= 0.02 && v[2][1] <= 0.02) continue
    const cx = (v[0][0] + v[1][0] + v[2][0]) / 3
    const cy = (v[0][1] + v[1][1] + v[2][1]) / 3
    const cz = (v[0][2] + v[1][2] + v[2][2]) / 3
    const ang = Math.atan2(cz, cx)
    const line = 6.2 + 2.6 * Math.sin(ang * 2 + 0.5) + 1.2 * Math.sin(ang * 5)
    // a few white panels scattered through the glass, kept off the camera's way in and out
    const near = clear.some((c) => Math.hypot(cx - c[0], cy - c[1], cz - c[2]) < 5)
    const isWhite = cy < line || (rand() < 0.06 && !near) || (cy < 9 && cz > 8 && cx > -14 && cx < 6)
    const list = isWhite ? white : glass
    for (const p of v) list.push(p[0], p[1], p[2])
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
  const mesh = (arr, mat) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, mat)
    m.castShadow = mat !== glassMat
    m.receiveShadow = true
    scene.add(m)
    return m
  }
  mesh(white, whiteMat)
  const glassMesh = mesh(glass, glassMat)
  glassMesh.renderOrder = 2
  const beams = beamBatch(THREE)
  const A = new THREE.Vector3()
  const B = new THREE.Vector3()
  for (const [a, b] of edges.values()) beams.add(A.set(a[0], a[1], a[2]), B.set(b[0], b[1], b[2]), 0.15, 0.24)
  const lattice = beams.build(steelMat)
  lattice.receiveShadow = true
  scene.add(lattice)
  const nodeList = [...nodes.values()]
  const knots = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.17, 0), steelMat, nodeList.length)
  const m4 = new THREE.Matrix4()
  nodeList.forEach((p, i) => knots.setMatrixAt(i, m4.makeTranslation(p[0], p[1], p[2])))
  knots.instanceMatrix.needsUpdate = true
  scene.add(knots)
}

/** An extruded slab with an elliptical outline (and an optional elliptical hole). */
function ellipseSlab(THREE, rx, rz, thick, hole = null) {
  const s = new THREE.Shape()
  s.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false, 0)
  if (hole) {
    const h = new THREE.Path()
    h.absellipse(hole[0], -hole[1], hole[2], hole[3], 0, Math.PI * 2, true, 0)
    s.holes.push(h)
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 48 })
  g.rotateX(-Math.PI / 2)
  // planar UVs in metres
  const pos = g.attributes.position
  const uv = g.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4)
  return g
}

/* --- buildings ------------------------------------------------------------------ */

/** A rounded tower (superellipse plan, a slight bulge and twist), UVs in metres. */
function roundTower(THREE, { a, b, h, n = 2.6, bulge = 0.05, taper = 0.06, twist = 0, rings = 16, segs = 56, tile = [3.6, 7.6] }) {
  const pos = []
  const uv = []
  const idx = []
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    const y = h * t
    const s = 1 + bulge * Math.sin(Math.PI * t) - taper * t
    const tw = twist * t
    let arc = 0
    let px = 0
    let pz = 0
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * Math.PI * 2
      const c = Math.cos(th)
      const sn = Math.sin(th)
      const x = a * s * Math.sign(c) * Math.pow(Math.abs(c), 2 / n)
      const z = b * s * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n)
      const xr = x * Math.cos(tw) - z * Math.sin(tw)
      const zr = x * Math.sin(tw) + z * Math.cos(tw)
      if (j) arc += Math.hypot(xr - px, zr - pz)
      px = xr
      pz = zr
      pos.push(xr, y, zr)
      uv.push(arc / tile[0], y / tile[1])
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const p = i * (segs + 1) + j
      const q = p + segs + 1
      idx.push(p, q, p + 1, q, q + 1, p + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Parked / waiting cars: rounded body, dark glass cabin, tyres. Three draw calls. */
function addCars(THREE, scene, list, rand) {
  if (!list.length) return
  const body = new RoundedBoxGeometry(4.3, 0.72, 1.78, 2, 0.2)
  body.translate(0, 0.62, 0)
  const roof = new RoundedBoxGeometry(2.0, 0.08, 1.46, 1, 0.03)
  roof.translate(-0.25, 1.5, 0)
  const paintGeo = mergeGeometries([body, roof], false)
  const cabin = new RoundedBoxGeometry(2.4, 0.56, 1.58, 2, 0.16)
  cabin.translate(-0.25, 1.2, 0)
  const tyres = []
  for (const x of [-1.4, 1.35]) {
    for (const z of [-0.8, 0.8]) {
      const t = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14)
      t.rotateX(Math.PI / 2)
      t.translate(x, 0.33, z)
      tyres.push(t)
    }
  }
  const tyreGeo = mergeGeometries(tyres, false)
  const paint = new THREE.InstancedMesh(paintGeo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }), list.length)
  const glass = new THREE.InstancedMesh(cabin, new THREE.MeshPhysicalMaterial({ color: 0x15191d, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 }), list.length)
  const tyre = new THREE.InstancedMesh(tyreGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.85 }), list.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  const col = new THREE.Color()
  const colours = [0x1c1d20, 0xd9dadc, 0x6f7377, 0x23324a, 0xe9e9e6, 0x8a1c1c, 0x3a3c3f, 0xb7b9bb, 0x1f3a33]
  list.forEach((c, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.r)
    m.compose(new THREE.Vector3(c.x, 0, c.z), q, one)
    paint.setMatrixAt(i, m)
    glass.setMatrixAt(i, m)
    tyre.setMatrixAt(i, m)
    paint.setColorAt(i, col.setHex(pick(rand, colours)))
  })
  for (const mesh of [paint, glass, tyre]) {
    mesh.castShadow = true
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)
  }
  if (paint.instanceColor) paint.instanceColor.needsUpdate = true
}

/** A weeping willow: a leaning trunk, a few limbs, curtains of fresh green strands. */
function addWillow(THREE, scene, x, z, rand, { low = false } = {}) {
  const V = (a, b, c) => new THREE.Vector3(a, b, c)
  const wood = beamBatch(THREE)
  const top = V(x + 0.6, 4.2, z)
  wood.add(V(x, 0, z), top, 0.55)
  const crowns = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + range(rand, -0.3, 0.3)
    const e = V(x + Math.cos(a) * range(rand, 2.5, 3.8), range(rand, 7.5, 9.5), z + Math.sin(a) * range(rand, 2.5, 3.8))
    wood.add(top, e, 0.22)
    crowns.push(e)
  }
  scene.add(wood.build(new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.95 })))
  const strands = beamBatch(THREE)
  const n = low ? 260 : 620
  for (let i = 0; i < n; i++) {
    const c = crowns[i % crowns.length]
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * 4.6
    const s = V(c.x + Math.cos(a) * r * 0.7, c.y - range(rand, 0, 1.2) + Math.cos((r / 4.6) * 1.5) * 0.8, c.z + Math.sin(a) * r * 0.7)
    // arching out, then hanging straight down
    const out = V(s.x + Math.cos(a) * 0.8, s.y - 1.2, s.z + Math.sin(a) * 0.8)
    const end = V(out.x + range(rand, -0.2, 0.2), range(rand, 1.2, 3.4), out.z + range(rand, -0.2, 0.2))
    strands.add(s, out, 0.07, 0.025)
    strands.add(out, end, 0.07, 0.025)
  }
  const leaves = strands.build(new THREE.MeshStandardMaterial({ color: 0x9cab4a, roughness: 0.8, emissive: 0x2a3008, emissiveIntensity: 0.25 }))
  scene.add(leaves)
}

/* --- the place --------------------------------------------------------------------- */

export function buildEindhoven(THREE, ctx, { light = 'day' } = {}) {
  const world = createWorld(THREE, ctx, light, {
    sun: { elevation: 30, azimuth: 318 },
    fog: { density: 0.00125 },
  })
  const { scene } = world
  const low = ctx.quality === 'low'
  const q = ctx.quality
  const S = low ? 256 : 512
  const s2 = low ? 128 : 256
  const rand = seeded(1809)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const batch = makeBatch(THREE)

  /* materials --------------------------------------------------------------------- */
  const asphalt = M.asphalt(THREE, { color: '#3c3d3f', tile: 6, quality: 'low' })
  const squareFlags = M.paving(THREE, { kind: 'flags', color: '#9d9c97', joint: '#6b6a66', unit: 0.3, tile: 3, quality: q, seed: 14 })
  const brickPavers = M.paving(THREE, { kind: 'herringbone', color: '#84483a', joint: '#4f4038', variation: 0.16, tile: 2, quality: q, seed: 22 })
  const lawn = M.lawn(THREE, { color: '#5f7438', worn: 0.32, tile: 3, quality: q, seed: 12 })
  const kerb = M.concrete(THREE, { color: '#b4b1aa', tile: 3, ties: false, quality: 'low', seed: 3 })
  const whiteConcrete = M.concrete(THREE, { color: '#e3e1dc', tile: 4, ties: false, quality: 'low', seed: 33 })
  const slats = M.planks(THREE, { color: '#a1835c', width: 0.07, gap: 0.012, tile: 2, quality: 'low', seed: 9 })
  const interiorFloor = M.floor(THREE, { kind: 'concrete', color: '#bdb7ad', polish: 0.6, quality: 'low', seed: 2 })
  const brick = M.brick(THREE, { color: '#6e3a2a', tile: 2, quality: 'low', seed: 8 })
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.7, roughness: 0.38 })
  const white = new THREE.MeshStandardMaterial({ color: 0xeceae5, roughness: 0.55 })
  const soil = new THREE.MeshStandardMaterial({ color: 0x3d3128, roughness: 1 })

  // street houses (materials.js paints 2 × 2 bays per tile: tile = 2 bays × 2 storeys)
  const fac = [
    M.facade(THREE, { wall: 'brick', color: '#7a3a28', frame: '#efe9dd', bay: 3.2, storey: 3.2, quality: q, seed: 11 }),
    M.facade(THREE, { wall: 'brick', color: '#5b3a2c', frame: '#2a2a2a', bay: 3.4, storey: 3.2, window: { w: 0.6, h: 0.62, bars: 'grid', sill: true, lintel: true }, quality: q, seed: 12 }),
    M.facade(THREE, { wall: 'plaster', color: '#e3dccd', frame: '#ffffff', bay: 3, storey: 3.2, quality: q, seed: 13 }),
  ].map((f, i) => ({ mat: f.material, tile: [[6.4, 6.4], [6.8, 6.4], [6, 6.4]][i] }))
  const shops = [
    M.shopfront(THREE, { color: '#2a2420', fascia: '#1d1d1d', bay: 3.2, storey: 4.2, quality: q, seed: 21 }),
    M.shopfront(THREE, { color: '#3b3f44', fascia: '#e8e3d8', bay: 3.2, storey: 4.2, warm: 0.4, quality: q, seed: 22 }),
  ].map((f) => ({ mat: f.material, tile: [6.4, 4.2] }))

  const admirantGlass = pbrMat(
    THREE,
    facadeTex(THREE, S, { tile: [3.6, 7.6], cols: 2, rows: 2, wall: [0.3, 0.33, 0.36], win: [0, 1, 0, 1], frame: [0.55, 0.58, 0.6], fw: 0.04, glass: [0.36, 0.46, 0.54], spandrel: [0, 0.22, [0.2, 0.25, 0.3]], blinds: 0.06, seed: 31 }),
    { envMapIntensity: 1.25, side: THREE.DoubleSide }
  )
  const whiteBlocks = pbrMat(THREE, facadeTex(THREE, s2, { tile: [2.4, 1.2], cols: 2, rows: 2, wall: [0.86, 0.86, 0.84], wallRough: 0.6, joints: true, win: [0, 0, 0, 0], seed: 32 }), { metalness: 0 })
  const lobby = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [6, 4], cols: 3, rows: 1, wall: [0.15, 0.15, 0.16], win: [0, 1, 0, 1], frame: [0.12, 0.12, 0.13], fw: 0.05, transom: 0.75, glass: [0.18, 0.21, 0.23], blinds: 0, seed: 33 }),
    { envMapIntensity: 1.1 }
  )
  const ribbon = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [6, 4], cols: 4, rows: 1, wall: [0.86, 0.86, 0.84], wallRough: 0.6, win: [0, 1, 0.25, 0.85], frame: [0.8, 0.8, 0.8], fw: 0.05, glass: [0.3, 0.35, 0.38], blinds: 0.3, seed: 34 }),
    { envMapIntensity: 1.1 }
  )
  const piazzaGlass = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [9, 8], cols: 6, rows: 2, wall: [0.3, 0.3, 0.32], win: [0, 1, 0, 1], frame: [0.62, 0.64, 0.66], fw: 0.06, glass: [0.34, 0.4, 0.45], blinds: 0, seed: 35 }),
    { envMapIntensity: 1.2 }
  )
  const piazzaPanels = pbrMat(THREE, facadeTex(THREE, s2, { tile: [12, 8], cols: 4, rows: 2, wall: [0.78, 0.74, 0.66], joints: true, win: [0.1, 0.9, 0.6, 0.85], frame: [0.3, 0.3, 0.3], fw: 0.05, glass: [0.3, 0.34, 0.38], seed: 36 }), { envMapIntensity: 1 })
  const resiBeige = pbrMat(THREE, facadeTex(THREE, S, { tile: [12, 12], cols: 4, rows: 4, wall: [0.8, 0.76, 0.68], win: [0.12, 0.88, 0.0, 0.8], frame: [0.32, 0.32, 0.33], fw: 0.06, mull: 3, glass: [0.3, 0.36, 0.42], blinds: 0.25, seed: 37 }), { envMapIntensity: 1 })
  const resiGrey = pbrMat(THREE, facadeTex(THREE, s2, { tile: [12, 12], cols: 4, rows: 4, wall: [0.7, 0.7, 0.69], win: [0.08, 0.92, 0.18, 0.86], frame: [0.85, 0.85, 0.85], fw: 0.06, mull: 2, glass: [0.3, 0.35, 0.4], blinds: 0.3, seed: 38 }), { envMapIntensity: 1 })
  const towerBrown = pbrMat(THREE, facadeTex(THREE, s2, { tile: [6, 12], cols: 4, rows: 4, wall: [0.36, 0.28, 0.23], win: [0.3, 0.7, 0.1, 0.92], frame: [0.2, 0.18, 0.17], fw: 0.05, glass: [0.27, 0.31, 0.34], blinds: 0.15, seed: 39 }), { envMapIntensity: 1 })
  const towerGlass = pbrMat(THREE, facadeTex(THREE, s2, { tile: [9, 12], cols: 6, rows: 3, wall: [0.24, 0.27, 0.3], win: [0.03, 0.97, 0.25, 0.98], frame: [0.4, 0.42, 0.44], fw: 0.05, glass: [0.32, 0.4, 0.48], blinds: 0.08, seed: 40 }), { envMapIntensity: 1.2 })

  /* the ground ------------------------------------------------------------------------ */
  scene.add(flat(THREE, 4000, 4000, asphalt, 6, 0, 0, 0))
  // 18 Septemberplein
  scene.add(flat(THREE, 132, 126, squareFlags, 3, -6, 0.04, 29))
  // pavements along the streets
  scene.add(flat(THREE, 260, 3, squareFlags, 3, 30, 0.05, -47.5))
  scene.add(flat(THREE, 4, 240, squareFlags, 3, 78, 0.05, 30))
  scene.add(flat(THREE, 4, 240, squareFlags, 3, 60, 0.05, 30))
  scene.add(flat(THREE, 160, 4, squareFlags, 3, 0, 0.05, 94))
  // the brick street to the west (photo 2)
  scene.add(flat(THREE, 200, 18, brickPavers, 2, -170, 0.05, 20))
  // a lawn in the corner pocket between the brick street and the park
  batch.box(lawn, 46, 0.1, 15, -97, 0, 37.5, [3, 3])
  // kerbs
  batch.box(kerb, 260, 0.13, 0.2, 30, 0, -34, [3, 3])
  batch.box(kerb, 260, 0.13, 0.2, 30, 0, -46, [3, 3])
  batch.box(kerb, 0.2, 0.13, 240, 62, 0, 30, [3, 3])
  batch.box(kerb, 0.2, 0.13, 240, 76, 0, 30, [3, 3])
  batch.box(kerb, 160, 0.13, 0.2, 0, 0, 92, [3, 3])
  // road markings: dashed centre lines
  {
    const dashes = []
    for (let x = -120; x < 160; x += 6) dashes.push({ x, y: 0.06, z: -40, w: 3, h: 0.01, d: 0.12 })
    for (let z = -80; z < 150; z += 6) dashes.push({ x: 69, y: 0.06, z, w: 0.12, h: 0.01, d: 3 })
    instBoxes(THREE, scene, dashes, new THREE.MeshStandardMaterial({ color: 0xd9d8d2, roughness: 0.6 }), { cast: false })
  }
  // the park strip: lawn, a path, and the sports pavilion (photo 1)
  batch.box(lawn, 186, 0.1, 58, -165, 0, 75, [3, 3])
  scene.add(flat(THREE, 186, 3, asphalt, 6, -165, 0.12, 86))
  batch.box(kerb, 186, 0.14, 0.12, -165, 0, 87.5, [3, 3])
  batch.box(kerb, 186, 0.14, 0.12, -165, 0, 84.5, [3, 3])

  /* the Blob --------------------------------------------------------------------------- */
  const blobGlass = new THREE.MeshPhysicalMaterial({
    color: 0xa9cddc,
    metalness: 0.15,
    roughness: 0.04,
    transparent: true,
    opacity: 0.34,
    envMapIntensity: 2.4,
    side: THREE.DoubleSide,
    depthWrite: false,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
  })
  const blobWhite = new THREE.MeshStandardMaterial({ color: 0xe7e6e2, roughness: 0.38, metalness: 0.15, side: THREE.DoubleSide })
  const steel = new THREE.MeshStandardMaterial({ color: 0xe6e6e3, roughness: 0.32, metalness: 0.35 })
  // where the glides into and out of the café pass through the skin (spots 4 → 5 → 6)
  const clear = [
    [-4.4, 11.1, 15.9],
    [9.2, 17.9, 8.3],
  ]
  buildBlob(THREE, scene, { low, rand, glassMat: blobGlass, whiteMat: blobWhite, steelMat: steel, clear })

  // MANA's entrance: a timber-slatted portal pushed through the white skin (photo 7)
  {
    const zf = Math.max(blobSouth(-4, 0.3), blobSouth(-4, 5.4), blobSouth(-9, 5.4), blobSouth(1, 5.4)) + 0.35
    const depth = 6
    batch.box(slats, 10, 5.4, depth, -4, 0, zf - depth / 2, [2, 2])
    batch.box(darkMetal, 10.3, 0.35, depth + 0.1, -4, 5.4, zf - depth / 2, [2, 2])
    batch.box(lobby, 3.4, 3.2, 0.12, -4, 0, zf + 0.02, [6, 4])
    const sign = lettering(THREE, 'MANA', { w: 5.2, h: 1.1, font: '600 {px}px "Helvetica Neue", Arial, sans-serif', color: '#ff6a2b', px: 160, emissive: 1.6 })
    sign.position.set(-4, 4.45, zf + 0.08)
    scene.add(sign)
    const sub = lettering(THREE, 'SOCIAL PERFORMANCE CLUB', { w: 3.6, h: 0.32, font: '500 {px}px "Helvetica Neue", Arial, sans-serif', color: '#f2f0ea', px: 96, emissive: 0.5 })
    sub.position.set(-1.0, 3.6, zf + 0.08)
    scene.add(sub)
    // two feather banners either side of the door
    const feather = new THREE.Shape()
    feather.moveTo(0, 0.4)
    feather.lineTo(0, 3.6)
    feather.quadraticCurveTo(0.2, 4.1, 0.9, 3.7)
    feather.quadraticCurveTo(0.95, 2, 0.75, 0.9)
    feather.lineTo(0, 0.4)
    const fgeo = new THREE.ShapeGeometry(feather, 8)
    const fmat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.6, side: THREE.DoubleSide })
    for (const x of [-8.6, 0.8]) {
      const f = new THREE.Mesh(fgeo, fmat)
      f.position.set(x, 0, zf + 0.9)
      f.rotation.y = 0.35
      f.castShadow = true
      scene.add(f)
      batch.box(darkMetal, 0.05, 4.0, 0.05, x, 0, zf + 0.9, [1, 1])
    }
    // the planted bed in front, last year's stalks and new grass (photo 7)
    batch.box(lawn, 22, 0.16, 7, -4, 0, zf + 9, [3, 3])
    const tufts = []
    for (let i = 0; i < (low ? 50 : 120); i++) tufts.push({ x: range(rand, -14.5, 6.5), y: 0.1, z: zf + range(rand, 5.8, 12.2), w: range(rand, 0.3, 0.7), h: range(rand, 0.3, 1.1), d: range(rand, 0.3, 0.6), r: rand() * 3 })
    instBoxes(THREE, scene, tufts, new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 0.95 }), { cast: true })
  }

  // inside: two floors under the dome, the café with its long bar on the upper one
  {
    const level = (h) => Math.sqrt(Math.max(0, 1 - ((h - BLOB.y0) / BLOB.ay) ** 2)) * 0.9
    const f1 = level(5.5)
    const s1 = new THREE.Mesh(ellipseSlab(THREE, BLOB.ax * f1 - 1, BLOB.az * f1 - 1, 0.4, [-6, 0, 8, 6]), interiorFloor)
    s1.position.y = 5.5
    s1.receiveShadow = s1.castShadow = true
    scene.add(s1)
    const f2 = level(11)
    const s2m = new THREE.Mesh(ellipseSlab(THREE, BLOB.ax * f2 - 1.6, BLOB.az * f2 - 1.6, 0.4, [-11, 0, 6.5, 6]), interiorFloor)
    s2m.position.y = 11
    s2m.receiveShadow = s2m.castShadow = true
    scene.add(s2m)
    // a white ceiling with linear lights over the back of the café
    batch.box(white, 10, 0.35, 8, 11, 15, -6, [2, 2])
    const strips = []
    for (const z of [-8.5, -6, -3.5]) strips.push({ x: 11, y: 14.97, z, w: 7, h: 0.03, d: 0.12 })
    instBoxes(THREE, scene, strips, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e2, emissiveIntensity: 2.2 }), { cast: false })
    // the bar: black body, pale travertine top, coffee machines, the DJ's decks
    batch.box(new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.5 }), 9, 1.02, 0.85, 11, 11.4, 3, [2, 2])
    batch.box(new THREE.MeshStandardMaterial({ color: 0xd9cdb8, roughness: 0.45 }), 9.2, 0.07, 1.0, 11, 12.42, 3, [2, 2])
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 1, roughness: 0.18 })
    batch.box(chrome, 0.85, 0.48, 0.55, 13.2, 12.49, 2.85, [1, 1])
    batch.box(chrome, 0.25, 0.55, 0.25, 14.3, 12.49, 2.9, [1, 1])
    batch.box(darkMetal, 1.2, 0.12, 0.6, 8.2, 12.49, 2.95, [1, 1])
    batch.box(new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.5 }), 3, 1.0, 0.8, 4.5, 11.4, -4.5, [2, 2])
    // pendant lamps hanging from the dome
    const cables = beamBatch(THREE)
    const bulbs = []
    for (const [x, z] of [
      [8, 3],
      [11, 3],
      [14, 3],
      [6, 8],
      [12, 9],
    ]) {
      cables.add(V(x, 18.5, z), V(x, 13.9, z), 0.012)
      bulbs.push({ x, y: 13.6, z, w: 0.07, h: 0.3, d: 0.07 })
    }
    scene.add(cables.build(darkMetal, { castShadow: false }))
    instBoxes(THREE, scene, bulbs, new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd9a0, emissiveIntensity: 1.4 }), { cast: false })
    // glass balustrades round the voids
    const rail = beamBatch(THREE)
    for (const [cy, hx, hz, rx, rz] of [
      [5.9, -6, 0, 8, 6],
      [11.4, -11, 0, 6.5, 6],
    ]) {
      const n = 40
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2
        const a1 = ((i + 1) / n) * Math.PI * 2
        const p0 = V(hx + Math.cos(a0) * rx, cy + 1.05, hz + Math.sin(a0) * rz)
        const p1 = V(hx + Math.cos(a1) * rx, cy + 1.05, hz + Math.sin(a1) * rz)
        if (!insideBlob(p0.x, p0.y, p0.z)) continue
        rail.add(p0, p1, 0.06)
        if (i % 2 === 0) rail.add(p0.clone().setY(cy), p0, 0.04)
      }
    }
    scene.add(rail.build(chrome, { castShadow: false }))
    // a few tables downstairs and potted olive trees up in the café
    const tables = []
    for (let i = 0; i < 10; i++) {
      const x = range(rand, -14, 10)
      const z = range(rand, -9, 9)
      if (!insideBlob(x, 1, z)) continue
      tables.push({ x, y: 0.05, z, w: 0.8, h: 0.75, d: 0.8 })
    }
    instBoxes(THREE, scene, tables, new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.6 }))
    addForest(THREE, scene, [
      { x: 15.5, y: 11.4, z: 3, h: 3.2 },
      { x: 2.5, y: 11.4, z: -7, h: 2.8 },
      { x: -2, y: 5.9, z: 8, h: 3.4 },
    ], { species: 'olive', season: 'summer', seed: 4, quality: q })
  }

  /* around the square --------------------------------------------------------------------- */
  // the sunken bike park's entrance: a white arched hood over the ramp (photo 5)
  {
    const R = 3.3
    const len = 15
    const shell = new THREE.CylinderGeometry(R, R, len, 28, 1, true, -Math.PI / 2, Math.PI)
    shell.rotateX(-Math.PI / 2)
    const uv = shell.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.6, uv.getY(i) * 3.7)
    const hood = new THREE.Mesh(shell, new THREE.MeshStandardMaterial({ map: whiteConcrete.map, normalMap: whiteConcrete.normalMap, roughnessMap: whiteConcrete.roughnessMap, roughness: 1, side: THREE.DoubleSide }))
    hood.position.set(-46, 0, 47)
    hood.castShadow = hood.receiveShadow = true
    scene.add(hood)
    const lip = new THREE.TorusGeometry(R, 0.22, 8, 28, Math.PI)
    batch.add(whiteConcrete, lip, -46, 0, 47 + len / 2)
    // glass and mesh panels down one side, a dark ramp inside
    batch.box(lobby, 0.12, 2.6, len - 2, -49.1, 0, 47, [6, 4])
    // the ramp going down into the dark (the square's paving can't be cut, so it's painted)
    batch.box(new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: 0.9 }), 5.4, 0.04, len - 0.5, -46, 0.05, 47, [2, 2])
    // a weathered steel pillar beside it
    batch.box(new THREE.MeshStandardMaterial({ color: 0x7a4a2e, roughness: 0.7, metalness: 0.4 }), 0.9, 9, 0.9, -51, 0, 43, [1, 1])
  }

  // the Admirant: a tall, rounded glass tower at the square's north-west corner
  {
    const g = roundTower(THREE, { a: 15, b: 10.5, h: 52, n: 2.6, bulge: 0.06, taper: 0.05, twist: 0.12, tile: [3.6, 7.6] })
    const t = new THREE.Mesh(g, admirantGlass)
    t.position.set(-54, 0, -22)
    t.rotation.y = 0.3
    t.castShadow = t.receiveShadow = true
    scene.add(t)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.8, 56), darkMetal)
    cap.scale.set(15 * 0.95 * 1.07, 1, 10.5 * 0.95 * 1.07)
    cap.position.set(-54, 52, -22)
    cap.rotation.y = 0.3 - 0.12
    scene.add(cap)
  }
  // Piazza shopping centre to the north-east, its glass front on the street
  {
    const body = new THREE.Mesh(boxGeo(THREE, 90, 24, 54, [12, 8]), [piazzaPanels, piazzaPanels, darkMetal, darkMetal, piazzaGlass, piazzaPanels])
    body.position.set(65, 0, -73)
    body.castShadow = body.receiveShadow = true
    scene.add(body)
    batch.box(darkMetal, 40, 0.8, 3.2, 50, 6, -47.6, [2, 2])
    const word = lettering(THREE, 'PIAZZA', { w: 14, h: 2.6, font: '700 {px}px "Helvetica Neue", Arial, sans-serif', color: '#f3f1ec', px: 160, emissive: 0.4 })
    word.position.set(50, 18, -45.9)
    scene.add(word)
  }
  // the square's south side: shops under offices, a café with a big glass canopy
  {
    let x = -64
    let k = 0
    while (x < 58) {
      const w = range(rand, 12, 20)
      const h = 4.2 + 3.2 * Math.floor(range(rand, 3, 6))
      const f = fac[k % 3]
      const s = shops[k % 2]
      batch.box(f.mat, w, h - 1, 16, x + w / 2, 1, 106, f.tile)
      batch.box(brick, w, 1, 16, x + w / 2, 0, 106, [2, 2])
      batch.box(s.mat, w - 0.4, 4.2, 0.3, x + w / 2, 0, 97.95, s.tile)
      batch.box(kerb, w + 0.3, 0.45, 16.3, x + w / 2, h, 106, [3, 3])
      x += w + 0.2
      k++
    }
    batch.box(new THREE.MeshStandardMaterial({ color: 0xcfd6da, metalness: 0.6, roughness: 0.15, transparent: false }), 26, 0.25, 6, 14, 4.6, 95, [2, 2])
    const cafe = lettering(THREE, 'EETCAFÉ', { w: 9, h: 1.6, font: '700 {px}px Georgia, serif', color: '#ffd04a', px: 140, emissive: 1.2 })
    cafe.rotation.y = Math.PI
    cafe.position.set(14, 6.2, 97.6)
    scene.add(cafe)
  }
  // the Vestdijk: a row of five- to eight-storey blocks east of the road
  {
    let z = -26
    let k = 0
    while (z < 140) {
      const d = range(rand, 14, 22)
      const h = 4.2 + 3.2 * Math.floor(range(rand, 4, 8))
      const mat = k % 2 ? resiGrey : fac[(k + 1) % 3].mat
      const tile = k % 2 ? [12, 12] : fac[(k + 1) % 3].tile
      batch.box(mat, 22, h - 1, d, 92, 1, z + d / 2, tile)
      batch.box(brick, 22, 1, d, 92, 0, z + d / 2, [2, 2])
      batch.box(shops[k % 2].mat, 0.3, 4.2, d - 0.4, 80.95, 0, z + d / 2, shops[k % 2].tile)
      batch.box(kerb, 22.3, 0.45, d + 0.3, 92, h, z + d / 2, [3, 3])
      z += d + 0.2
      k++
    }
  }

  // the brick street: houses both sides, shops below (photo 2)
  const street = (x0, x1, zc, front) => {
    let x = x0
    let k = Math.floor(rand() * 3)
    while (x < x1 - 5) {
      const w = Math.min(x1 - x, range(rand, 6, 11))
      const h = 4.2 + 3.2 * Math.floor(range(rand, 2, 4.4))
      const f = fac[k % 3]
      const s = shops[k % 2]
      batch.box(f.mat, w, h - 1, 17, x + w / 2, 1, zc, f.tile)
      batch.box(brick, w, 1, 17, x + w / 2, 0, zc, [2, 2])
      batch.box(s.mat, w - 0.3, 4.2, 0.3, x + w / 2, 0, front, s.tile)
      batch.box(kerb, w + 0.25, 0.4, 17.3, x + w / 2, h, zc, [3, 3])
      x += w + 0.1
      k++
    }
  }
  street(-262, -75, 2.5, 11.1)
  street(-262, -122, 37.5, 28.9)
  // the far side of the park: houses behind the pavilion
  street(-262, -205, 112, 103.4)
  street(-122, -66, 112, 103.4)

  // the sports pavilion: white block walls, a dark glazed ground floor, a long thin canopy (photo 1)
  {
    const x0 = -196
    const x1 = -128
    batch.box(whiteBlocks, 60, 15, 22, -164, 0, 123, [2.4, 1.2])
    batch.box(ribbon, 60.2, 4, 22.2, -164, 10, 123, [6, 4])
    batch.box(whiteConcrete, 60.6, 0.6, 22.6, -164, 15, 123, [4, 4])
    batch.box(kerb, x1 - x0, 0.45, 12, (x0 + x1) / 2, 0, 106, [3, 3])
    for (let i = 0; i < 3; i++) batch.box(kerb, 16, 0.15 * (i + 1), 0.35, -160, 0, 100 - (2 - i) * 0.35 - 0.175, [3, 3])
    batch.box(lobby, x1 - x0 - 6, 4, 0.3, (x0 + x1) / 2, 0.45, 111.6, [6, 4])
    batch.box(white, x1 - x0 + 2, 0.55, 13, (x0 + x1) / 2, 4.9, 105.6, [2, 2])
    const cols = []
    for (let x = x0 + 2; x <= x1; x += 6.5) cols.push({ x, y: 0.45, z: 99.8, w: 0.16, h: 4.45, d: 0.16 })
    instBoxes(THREE, scene, cols, darkMetal)
    const name = lettering(THREE, 'SPORTCENTRUM', { w: 18, h: 0.5, font: '500 {px}px "Helvetica Neue", Arial, sans-serif', color: '#2c2e31', px: 100 })
    name.rotation.y = Math.PI
    name.position.set(-162, 5.2, 99.05)
    scene.add(name)
    // a spiral escape stair caged on the hall's corner
    const cage = beamBatch(THREE)
    const cx = -131.5
    const cz = 126
    for (let y = 1; y < 14; y += 0.9) {
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * Math.PI * 2
        const a1 = ((i + 1) / 16) * Math.PI * 2
        cage.add(V(cx + Math.cos(a0) * 1.6, y, cz + Math.sin(a0) * 1.6), V(cx + Math.cos(a1) * 1.6, y, cz + Math.sin(a1) * 1.6), 0.04)
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      cage.add(V(cx + Math.cos(a) * 1.6, 0, cz + Math.sin(a) * 1.6), V(cx + Math.cos(a) * 1.6, 14, cz + Math.sin(a) * 1.6), 0.06)
    }
    scene.add(cage.build(darkMetal))
    // white picnic tables and benches on the grass
    const planks = []
    for (const [x, z] of [
      [-146, 94],
      [-176, 95],
      [-120, 60],
    ]) {
      planks.push({ x, y: 0.72, z, w: 1.9, h: 0.06, d: 0.8 }, { x, y: 0.42, z: z - 0.65, w: 1.9, h: 0.05, d: 0.3 }, { x, y: 0.42, z: z + 0.65, w: 1.9, h: 0.05, d: 0.3 })
      for (const dx of [-0.75, 0.75]) planks.push({ x: x + dx, y: 0, z, w: 0.08, h: 0.72, d: 1.5 })
    }
    instBoxes(THREE, scene, planks, white)
  }

  /* station-area towers to the north, fading into the haze (photo 5) ---------------------------- */
  {
    const towers = [
      [-30, -150, 24, 92, 22, resiBeige, [12, 12]],
      [30, -170, 22, 78, 22, resiGrey, [12, 12]],
      [-90, -190, 20, 104, 20, towerBrown, [6, 12]],
      [90, -150, 30, 60, 24, towerGlass, [9, 12]],
      [150, -210, 26, 88, 24, resiBeige, [12, 12]],
      [-160, -140, 28, 54, 22, resiGrey, [12, 12]],
      [10, -260, 26, 120, 26, towerGlass, [9, 12]],
      [-60, -300, 24, 96, 24, resiBeige, [12, 12]],
      [120, -320, 30, 70, 30, towerBrown, [6, 12]],
      [-200, -260, 30, 64, 24, towerGlass, [9, 12]],
      [-10, -110, 40, 30, 24, resiGrey, [12, 12]],
      [-110, -100, 40, 26, 24, piazzaPanels, [12, 8]],
    ]
    for (const [x, z, w, h, d, mat, tile] of towers) {
      batch.box(mat, w, h, d, x, 0, z, tile)
      batch.box(darkMetal, w * 0.5, 3, d * 0.5, x, h, z, [2, 2])
    }
    // balconies on the beige towers' south faces
    for (const [x, z, w, h, d, mat] of towers) {
      if (mat !== resiBeige) continue
      for (let y = 6; y < h - 3; y += 3) for (let i = 0; i < 3; i++) batch.box(white, w / 3 - 1.2, 0.2, 1.4, x - w / 3 + (i * w) / 3, y, z + d / 2 + 0.7, [2, 2])
    }
    // and the rest of the city, lower, all round
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    const uvs = unit.attributes.uv.array
    for (let i = 0; i < uvs.length; i++) uvs[i] *= 3
    const per = [[], [], []]
    for (let i = 0; i < (low ? 180 : 360); i++) {
      const x = range(rand, -800, 800)
      const z = range(rand, -800, 800)
      if (x > -280 && x < 120 && z > -100 && z < 150) continue
      per[i % 3].push({ x, z, w: range(rand, 20, 44), h: range(rand, 12, 30), d: range(rand, 14, 22), r: Math.floor(rand() * 2) * (Math.PI / 2) })
    }
    instBoxes(THREE, scene, per[0], resiGrey, { cast: false, geo: unit })
    instBoxes(THREE, scene, per[1], piazzaPanels, { cast: false, geo: unit.clone() })
    instBoxes(THREE, scene, per[2], resiBeige, { cast: false, geo: unit.clone() })
  }

  /* trees: bare limes along the streets, fresh birches in the park --------------------------- */
  const bare = []
  for (let x = -255; x <= -102; x += 11) {
    bare.push({ x: x + range(rand, -1, 1), z: 13.2, h: range(rand, 9, 12) })
    bare.push({ x: x + 5 + range(rand, -1, 1), z: 26.8, h: range(rand, 9, 12) })
  }
  for (let z = -24; z < 140; z += 12) bare.push({ x: 58.5, z, h: range(rand, 10, 14) }, { x: 79.5, z: z + 6, h: range(rand, 10, 14) })
  for (let x = -34; x < 57; x += 13) bare.push({ x, z: -29, h: range(rand, 10, 13) })
  bare.push({ x: -86, z: 44, h: 11 }, { x: -100, z: 42, h: 12 }, { x: -60, z: 70, h: 10 }, { x: -62, z: 86, h: 11 }, { x: 40, z: 60, h: 9 }, { x: 46, z: 30, h: 9 }, { x: -24, z: 30, h: 8 })
  addForest(THREE, scene, low ? bare.filter((_, i) => i % 2 === 0) : bare, { species: 'lime', season: 'winter', seed: 7, quality: q })
  const park = []
  for (let x = -250; x < -80; x += 9) {
    if (x < -138 || x > -102) park.push({ x: x + range(rand, -2, 2), z: range(rand, 49, 58), h: range(rand, 8, 13) })
    if (x < -192 || x > -125) park.push({ x: x + range(rand, -2, 2), z: range(rand, 93, 101), h: range(rand, 7, 11) })
  }
  addForest(THREE, scene, low ? park.filter((_, i) => i % 2 === 0) : park, { species: 'birch', season: 'summer', seed: 3, quality: q })
  addWillow(THREE, scene, -171, 96, rand, { low })

  /* street furniture --------------------------------------------------------------------------- */
  const lamps = []
  for (let x = -60; x <= 50; x += 22) lamps.push({ x, z: 88 }, { x, z: -26, r: Math.PI })
  for (let z = -10; z <= 80; z += 22) lamps.push({ x: -66, z }, { x: 56, z, r: Math.PI })
  for (const x of [-240, -205, -120, -95]) lamps.push({ x, z: 89, r: Math.PI })
  addLampPosts(THREE, scene, lamps, { height: 8 })
  const bollards = []
  for (let x = -255; x < -76; x += 2.5) bollards.push({ x, z: 11.6, w: 0.16, h: 0.85, d: 0.16 }, { x: x + 1.2, z: 28.4, w: 0.16, h: 0.85, d: 0.16 })
  instBoxes(THREE, scene, bollards, darkMetal)
  const bins = []
  for (const [x, z] of [
    [-40, 56],
    [-20, 30],
    [20, 40],
    [-140, 84],
    [-96, 26],
  ]) bins.push({ x, z, w: 0.5, h: 1.05, d: 0.5 })
  instBoxes(THREE, scene, bins, new THREE.MeshStandardMaterial({ color: 0x232426, metalness: 0.5, roughness: 0.4 }))
  addBikes(
    THREE,
    scene,
    [
      { x: -30, z: 72, len: 22, dir: 0 },
      { x: 30, z: 80, len: 26, dir: 0 },
      { x: -134.5, z: 25.8, len: 7, dir: 0, fill: 0.7 },
      { x: -194.5, z: 14.2, len: 7, dir: 0, fill: 0.7 },
      { x: 50, z: 20, len: 20, dir: Math.PI / 2 },
    ].slice(0, low ? 3 : 5),
    rand
  )
  // traffic on the Vestdijk and in front of Piazza
  const cars = []
  for (let z = -20; z < 140; z += range(rand, 7, 16)) {
    if (rand() > 0.75) continue
    const south = rand() < 0.5
    cars.push({ x: south ? 66.5 : 71.5, z, r: south ? Math.PI / 2 : -Math.PI / 2 })
  }
  for (let x = -110; x < 150; x += range(rand, 8, 18)) {
    if (rand() > 0.6 || Math.abs(x - 69) < 8) continue
    const east = rand() < 0.5
    cars.push({ x, z: east ? -37.5 : -42.5, r: east ? 0 : Math.PI })
  }
  addCars(THREE, scene, low ? cars.filter((_, i) => i % 2 === 0) : cars, rand)

  batch.build(scene)

  /* light, the flight in, the viewpoints ----------------------------------------------------- */
  world.focusShadows(V(-60, 0, 45), 125)

  const spots = [
    // 0 · the park strip: runners' path, the white sports pavilion and its canopy, the willow (photo 1)
    { pos: V(-150, 1.6, 74), look: V(-160, 6, 125) },
    // 1 · down the brick street between bare trees (photo 2)
    { pos: V(-90, 1.7, 21), look: V(-200, 5, 19) },
    // 2 · on 18 Septemberplein: the bike park's white hood, towers ahead, the Blob to the right (photo 5)
    { pos: V(-38, 1.7, 62), look: V(-30, 12, -80) },
    // 3 · the Admirant rising over the square, the Blob's glass beside it (photos 3, 6)
    { pos: V(-22, 1.7, 52), look: V(-46, 22, -40) },
    // 4 · MANA's door in the Blob's white skin, the planted bed in front (photo 7)
    { pos: V(-12, 1.6, 33), look: V(-1, 7.5, 10) },
    // 5 · inside: the café under the glass lattice, looking out over the square (photos 8–13)
    { pos: V(4, 13.05, -3), look: V(30, 9, 40) },
    // 6 · above the square: the Blob, the Admirant and the city beyond
    { pos: V(34, 26, 62), look: V(-6, 6, -6) },
  ]
  const end = spots[0]
  const path = {
    positions: [V(140, 170, -160), V(30, 80, 40), V(-90, 30, 66), V(-140, 5.5, 71), end.pos.clone()],
    targets: [V(-10, 10, 0), V(-70, 8, 50), V(-150, 6, 110), V(-158, 5.5, 122), end.look.clone()],
    fov: 50,
    near: 0.3,
    spots,
  }

  return {
    scene,
    world,
    path,
    update(t) {
      void t
    },
  }
}
