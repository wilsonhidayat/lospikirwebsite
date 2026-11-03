/**
 * Eindhoven centre — the SRC × MANA run club on a sunny spring morning.
 *
 * The real layout around 18 Septemberplein (Fuksas, 2010), from references:
 *  - the Blob (Admirant Entrance Building): a five-storey free-form shell of
 *    triangular panels, dense white aluminium panels alternating with
 *    "maritime blue" glass, four dimples in the skin, ~3000 m², ~23 m high.
 *    MANA (social performance club) has its door in the white skin (photo 7).
 *  - the Bubble: a small three-storey geodesic dome of greenish-blue glass
 *    and silver-green panels on the square (photo 5, right).
 *  - the Tube: the underground bike park, its entrances white horn-like
 *    shells rising out of the paving (photo 5, left); the other one painted
 *    with colourful graffiti rings (photo 6, right).
 *  - the square: 7000 m² of grey flags with a ceramic strip and glass light
 *    inserts; Piazza (shopping centre) with Fuksas's glass canopy on the east,
 *    the Bijenkorf (Gio Ponti, tiles and hexagonal windows) beside it.
 *  - the Admirant offices to the north: blue-green curtain walls and a glass
 *    skybridge over the Mathildelaan with its red cycle lanes (photo 6).
 *  - the Lichttoren (Philips' 1920s light tower, cream brick, glass lantern)
 *    and De Witte Dame (the white Philips factory) across the Emmasingel.
 *  - the Vestdijk to the east: bus lanes in the middle, red cycle lanes, and
 *    the Lightyards building site behind a printed hoarding (photo 4).
 *  - the station-area towers to the north with cranes on them (photo 5).
 *  - south of the centre: a brick-paved street with young bare trees and a
 *    big gridded office block (photo 3), a park with a brick promenade
 *    between old trees (photo 2) and a white sports hall with a long canopy
 *    and a willow, where the run starts (photo 1).
 *
 * Metres. The Blob is at the origin; north (the station) is −Z, east is +X.
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

/* --- free-form shells: the Blob and the Bubble ------------------------------------ */

const unit3 = (x, y, z) => {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}
const BLOB = { ax: 20, ay: 17.5, az: 15, y0: 6 }
// soft shoulders (+) and the four dimples (−) in the skin
const BUMPS = [
  [unit3(0.7, 0.3, -0.6), 0.09, 0.16],
  [unit3(-0.85, 0.2, 0.3), 0.1, 0.14],
  [unit3(-0.2, 0.55, -0.8), 0.06, 0.14],
  [unit3(0.97, 0.25, 0.05), -0.16, 0.07],
  [unit3(-0.35, 0.3, 0.9), -0.15, 0.07],
  [unit3(-0.6, 0.35, -0.72), -0.15, 0.07],
  [unit3(0.25, 0.97, 0.1), -0.09, 0.08],
]
/** Radius factor of the Blob in a direction of its unit ellipsoid. */
function blobR(dx, dy, dz) {
  let r = 1 - 0.1 * sstep(0.6, 1, dy) + 0.025 * Math.sin(dx * 6.1 + dz * 4.3)
  for (const [L, a, w] of BUMPS) r += a * Math.exp(-(1 - (dx * L[0] + dy * L[1] + dz * L[2])) / w)
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
/**
 * A geodesic shell: a subdivided icosahedron pushed out to an ellipsoid with
 * a radius function, cut at the ground. Every triangle a flat panel (glass or
 * solid, chosen by `classify`), glazing bars along the edges of the glass,
 * thin seams between solid panels.
 */
function geodesic(THREE, scene, o) {
  const { cx = 0, cz = 0, ax, ay, az, y0, detail, rf, classify, glassMat, solidMat, barMat, seamMat, bar = 0.14, seam = 0.05 } = o
  const ico = new THREE.IcosahedronGeometry(1, detail)
  const P = ico.attributes.position
  const glass = []
  const solid = []
  const edges = new Map()
  const key = (p) => `${Math.round(p[0] * 40)},${Math.round(p[1] * 40)},${Math.round(p[2] * 40)}`
  const vert = (i) => {
    const d = unit3(P.getX(i), P.getY(i), P.getZ(i))
    const r = rf(d[0], d[1], d[2])
    return [cx + d[0] * ax * r, Math.max(0, y0 + d[1] * ay * r), cz + d[2] * az * r]
  }
  for (let i = 0; i < P.count; i += 3) {
    const v = [vert(i), vert(i + 1), vert(i + 2)]
    if (v[0][1] <= 0.02 && v[1][1] <= 0.02 && v[2][1] <= 0.02) continue
    const c = [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3, (v[0][2] + v[1][2] + v[2][2]) / 3]
    if (o.skip && o.skip(c)) continue
    const d = unit3((c[0] - cx) / ax, (c[1] - y0) / ay, (c[2] - cz) / az)
    const isGlass = classify(d, c)
    const list = isGlass ? glass : solid
    for (const p of v) list.push(p[0], p[1], p[2])
    for (let k = 0; k < 3; k++) {
      const a = v[k]
      const b = v[(k + 1) % 3]
      if (a[1] <= 0.02 && b[1] <= 0.02) continue
      const ka = key(a)
      const kb = key(b)
      const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka
      const e = edges.get(ek)
      if (e) e.glass = e.glass || isGlass
      else edges.set(ek, { a, b, glass: isGlass })
    }
  }
  const out = {}
  const mesh = (arr, mat, cast) => {
    if (!arr.length) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, mat)
    m.castShadow = cast
    m.receiveShadow = true
    scene.add(m)
    return m
  }
  out.solid = mesh(solid, solidMat, true)
  out.glass = mesh(glass, glassMat, false)
  if (out.glass) out.glass.renderOrder = 2
  const bars = beamBatch(THREE)
  const seams = beamBatch(THREE)
  const A = new THREE.Vector3()
  const B = new THREE.Vector3()
  for (const e of edges.values()) {
    A.set(e.a[0], e.a[1], e.a[2])
    B.set(e.b[0], e.b[1], e.b[2])
    if (e.glass) bars.add(A, B, bar, bar * 1.6)
    else if (seamMat) seams.add(A, B, seam, seam)
  }
  if (bars.size) scene.add(bars.build(barMat))
  if (seamMat && seams.size) scene.add(seams.build(seamMat, { castShadow: false }))
  return out
}

/* --- the Tube's horn-shaped entrances ---------------------------------------------- */

/** A half cone lying on the ground, wide mouth toward +Z, with a rim and a glass screen. */
function hornEntrance(THREE, scene, { x, z, ry, shellMat, rimMat, glassMat, darkMat, r0 = 1.0, r1 = 4.4, len = 18 }) {
  const grp = new THREE.Group()
  const shell = new THREE.CylinderGeometry(r0, r1, len, 36, 4, true, -Math.PI / 2, Math.PI)
  shell.rotateX(-Math.PI / 2)
  const s = new THREE.Mesh(shell, shellMat)
  s.castShadow = s.receiveShadow = true
  grp.add(s)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r1, 0.24, 8, 40, Math.PI), rimMat)
  rim.position.z = len / 2
  rim.castShadow = true
  grp.add(rim)
  // a glazed screen over half the mouth, the rest open onto the ramp down
  const q = new THREE.Shape()
  q.moveTo(0, 0)
  q.lineTo(-r1 * 0.96, 0)
  q.absarc(0, 0, r1 * 0.96, Math.PI, Math.PI / 2, true)
  q.lineTo(0, 0)
  const scr = new THREE.ShapeGeometry(q, 12)
  const uv = scr.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.5, uv.getY(i) / 1.5)
  const screen = new THREE.Mesh(scr, glassMat)
  screen.position.z = len / 2 - 1.2
  grp.add(screen)
  // the dark ramp sinking into the bike park
  const ramp = new THREE.Mesh(new THREE.PlaneGeometry(r1 * 1.3, len * 0.85).rotateX(-Math.PI / 2), darkMat)
  ramp.position.set(r1 * 0.2, 0.06, len * 0.05)
  ramp.receiveShadow = true
  grp.add(ramp)
  grp.position.set(x, 0, z)
  grp.rotation.y = ry
  scene.add(grp)
  return grp
}

/** The graffiti on the eastern Tube entrance: colourful rings and swirls on white. */
function graffitiTexture(THREE) {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 512
  const g = c.getContext('2d')
  g.fillStyle = '#f2f0ea'
  g.fillRect(0, 0, c.width, c.height)
  const cols = ['#1565d8', '#14b8c8', '#0b2f7a', '#ff6f2c', '#ffcf33', '#ec3f86', '#25b56b', '#7b3fd0', '#ffffff']
  const swirl = (cx, cy, R, k, sq, rot) => {
    for (let r = R, i = 0; r > 8; r -= 13, i++) {
      g.strokeStyle = cols[(k + i) % cols.length]
      g.lineWidth = 11
      g.beginPath()
      g.ellipse(cx, cy, r * sq, r, rot, 0, Math.PI * 2)
      g.stroke()
    }
  }
  swirl(250, 250, 230, 0, 1.3, 0.3)
  swirl(720, 230, 210, 3, 1.5, -0.2)
  swirl(500, 420, 120, 5, 1.4, 0.1)
  swirl(960, 400, 150, 1, 1.2, 0.6)
  swirl(60, 60, 90, 6, 1.1, 0)
  // a few hard-edged black outlines
  g.strokeStyle = '#141414'
  g.lineWidth = 6
  for (const [x, y, r] of [
    [250, 250, 236],
    [720, 230, 216],
  ]) {
    g.beginPath()
    g.ellipse(x, y, r * 1.4, r, 0.1, 0, Math.PI * 2)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** The printed hoarding of the Lightyards building site (photo 4). */
function hoardingTexture(THREE) {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 1024, 0)
  grad.addColorStop(0, '#1f6b67')
  grad.addColorStop(0.35, '#3a8f7a')
  grad.addColorStop(0.55, '#d9c98a')
  grad.addColorStop(0.75, '#9ccf86')
  grad.addColorStop(1, '#2f9f8f')
  g.fillStyle = grad
  g.fillRect(0, 0, 1024, 256)
  g.fillStyle = 'rgba(255,255,255,0.18)'
  for (let i = 0; i < 6; i++) {
    g.beginPath()
    g.arc(120 + i * 170, 140 + (i % 2) * 30, 60 + (i % 3) * 18, 0, Math.PI * 2)
    g.fill()
  }
  // sparrows
  g.fillStyle = '#5b4632'
  for (const [x, y, s] of [
    [380, 90, 1],
    [430, 70, 0.8],
    [860, 120, 1.2],
  ]) {
    g.beginPath()
    g.ellipse(x, y, 22 * s, 12 * s, -0.3, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.moveTo(x - 10 * s, y)
    g.lineTo(x - 40 * s, y - 26 * s)
    g.lineTo(x + 8 * s, y - 6 * s)
    g.fill()
  }
  g.fillStyle = '#ffffff'
  g.font = 'italic 600 34px "Helvetica Neue", Arial, sans-serif'
  g.fillText('hier nest ik...', 470, 150)
  g.fillText('hier overbrug ik...', 640, 205)
  g.fillStyle = '#d4252b'
  g.fillRect(40, 196, 26, 26)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

/** A road sign disc (no parking) or a blue name plate, painted on a canvas. */
function signTexture(THREE, kind, text = '') {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = kind === 'plate' ? 64 : 256
  const g = c.getContext('2d')
  if (kind === 'plate') {
    g.fillStyle = '#1f5fae'
    g.fillRect(0, 0, 256, 64)
    g.strokeStyle = '#ffffff'
    g.lineWidth = 4
    g.strokeRect(5, 5, 246, 54)
    g.fillStyle = '#ffffff'
    g.font = '600 30px "Helvetica Neue", Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 128, 33)
  } else {
    g.fillStyle = '#d6202a'
    g.beginPath()
    g.arc(128, 128, 124, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#1f5fae'
    g.beginPath()
    g.arc(128, 128, 96, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = '#d6202a'
    g.lineWidth = 26
    g.beginPath()
    g.moveTo(60, 60)
    g.lineTo(196, 196)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Tower cranes: lattice masts and jibs, one draw call for all. */
function addCranes(THREE, scene, list, mat) {
  const b = beamBatch(THREE)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  for (const { x, z, h, jib = 40, a = 0, y = 0 } of list) {
    const s = 0.9
    const corners = [
      [-s, -s],
      [s, -s],
      [s, s],
      [-s, s],
    ]
    for (const [cx, cz] of corners) b.add(V(x + cx, y, z + cz), V(x + cx, y + h, z + cz), 0.14)
    for (let yy = y; yy < y + h; yy += 2.4) {
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k]
        const [bx, bz] = corners[(k + 1) % 4]
        b.add(V(x + ax, yy, z + az), V(x + bx, yy + 2.4, z + bz), 0.07)
      }
    }
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const top = y + h
    b.add(V(x - ca * 12, top + 0.6, z - sa * 12), V(x + ca * jib, top + 0.6, z + sa * jib), 1.0, 1.1)
    b.add(V(x, top + 0.6, z), V(x, top + 7, z), 0.5)
    b.add(V(x, top + 7, z), V(x + ca * jib * 0.6, top + 1.1, z + sa * jib * 0.6), 0.08)
    b.add(V(x, top + 7, z), V(x - ca * 11, top + 1.1, z - sa * 11), 0.08)
    // counterweight and cab
    b.add(V(x - ca * 11, top - 0.6, z - sa * 11), V(x - ca * 8, top - 0.6, z - sa * 8), 2.2, 1.8)
    b.add(V(x + ca * 1.6, top - 1.4, z + sa * 1.6), V(x + ca * 3.2, top - 1.4, z + sa * 3.2), 1.6, 2.2)
    // the hook line
    const hx = x + ca * jib * 0.7
    const hz = z + sa * jib * 0.7
    b.add(V(hx, top + 0.2, hz), V(hx, top - 18, hz), 0.04)
  }
  scene.add(b.build(mat))
}

/** City buses on the Vestdijk bus lanes: articulated, white with red skirts. */
function addBuses(THREE, scene, list) {
  if (!list.length) return
  const body = new RoundedBoxGeometry(18, 2.6, 2.55, 2, 0.18).translate(0, 1.75, 0)
  const win = new RoundedBoxGeometry(17.2, 1.1, 2.6, 1, 0.08).translate(0.3, 2.15, 0)
  const skirt = new RoundedBoxGeometry(18.05, 0.55, 2.6, 1, 0.1).translate(0, 0.72, 0)
  const wheels = []
  for (const x of [-6.5, 1.5, 6.6]) {
    for (const z of [-1.1, 1.1]) {
      const t = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 14)
      t.rotateX(Math.PI / 2)
      t.translate(x, 0.5, z)
      wheels.push(t)
    }
  }
  const parts = [
    [body, new THREE.MeshPhysicalMaterial({ color: 0xf3f3f1, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 })],
    [win, new THREE.MeshPhysicalMaterial({ color: 0x14181c, roughness: 0.05, metalness: 0.3, clearcoat: 1 })],
    [skirt, new THREE.MeshStandardMaterial({ color: 0xc8202b, roughness: 0.45 })],
    [mergeGeometries(wheels, false), new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 })],
  ]
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  const yAxis = new THREE.Vector3(0, 1, 0)
  for (const [geo, mat] of parts) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length)
    list.forEach((b, i) => {
      q.setFromAxisAngle(yAxis, b.r)
      m.compose(new THREE.Vector3(b.x, 0, b.z), q, one)
      mesh.setMatrixAt(i, m)
    })
    mesh.castShadow = true
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)
  }
}

/* --- the place ---------------------------------------------------------------------- */

export function buildEindhoven(THREE, ctx, { light = 'day' } = {}) {
  // a clear blue spring sky, whatever the photos' pale skies say
  ctx.sky = null
  const world = createWorld(THREE, ctx, light === 'day' ? 'day' : light, {
    sun: { elevation: 36, azimuth: 28 },
    sky: { zenith: 0x3a78cc, horizon: 0xb9d4ee, clouds: 0.22 },
    fog: { density: 0.00045 },
    sunIntensity: 2.3,
  })
  const { scene } = world
  const low = ctx.quality === 'low'
  const q = ctx.quality
  const s2 = low ? 128 : 256
  const rand = seeded(1809)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const batch = makeBatch(THREE)
  /** A block from its corners: x0..x1, z0..z1, base y, height h. */
  const blk = (mat, x0, x1, z0, z1, y, h, tile) => batch.box(mat, x1 - x0, h, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2, tile)

  /* materials ------------------------------------------------------------------------ */
  const asphalt = M.asphalt(THREE, { color: '#3b3c3f', tile: 6, quality: 'low' })
  const flags = M.paving(THREE, { kind: 'flags', color: '#a3a5a6', joint: '#6c6e70', unit: 0.6, variation: 0.1, tile: 3.6, quality: q, seed: 14 })
  const ceramic = M.paving(THREE, { kind: 'flags', color: '#d8d2c6', joint: '#9a948a', unit: 0.3, variation: 0.08, tile: 2.4, quality: 'low', seed: 15 })
  const brickPavers = M.paving(THREE, { kind: 'herringbone', color: '#94503d', joint: '#5a463c', variation: 0.2, tile: 2, quality: q, seed: 22 })
  const brickRoad = M.paving(THREE, { kind: 'herringbone', color: '#7c4436', joint: '#4c3c33', variation: 0.18, tile: 2, quality: 'low', seed: 23 })
  const lawn = M.lawn(THREE, { color: '#5f8a34', worn: 0.18, tile: 3, quality: q, seed: 12 })
  const kerb = M.concrete(THREE, { color: '#bdbab3', tile: 3, ties: false, quality: 'low', seed: 3 })
  const whiteConcrete = M.concrete(THREE, { color: '#eeece6', tile: 4, ties: false, quality: 'low', seed: 33 })
  const rawConcrete = M.concrete(THREE, { color: '#a7a39a', tile: 4, ties: true, quality: 'low', seed: 34 })
  const interiorFloor = M.floor(THREE, { kind: 'concrete', color: '#8e8a83', polish: 0.6, quality: 'low', seed: 2 })
  const redLane = new THREE.MeshStandardMaterial({ normalMap: asphalt.normalMap, color: 0xa8483c, roughness: 0.85 })
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.7, roughness: 0.38 })
  const white = new THREE.MeshStandardMaterial({ color: 0xf1efea, roughness: 0.5 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.95 })
  const paintWhite = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.6 })

  // Eindhoven's brick: warm red-brown, a darker purple-brown, a yellow buff
  const fac = [
    M.facade(THREE, { wall: 'brick', color: '#8e4430', frame: '#f1ece2', bay: 3.2, storey: 3.1, window: { w: 0.56, h: 0.6, bars: null, sill: true, lintel: true }, quality: q, seed: 11 }),
    M.facade(THREE, { wall: 'brick', color: '#5e3a2e', frame: '#2a2a2a', bay: 3.4, storey: 3.1, window: { w: 0.62, h: 0.62, bars: 'grid', sill: true, lintel: true }, quality: 'low', seed: 12 }),
    M.facade(THREE, { wall: 'brick', color: '#b8925c', frame: '#ffffff', bay: 3, storey: 3.1, window: { w: 0.5, h: 0.6, bars: 'sash', sill: true, lintel: true }, quality: 'low', seed: 13 }),
  ].map((f) => ({ mat: f.material, tile: [f.tile[0] * 2, f.tile[1] * 2] }))
  const plasterFac = M.facade(THREE, { wall: 'plaster', color: '#f3f1ea', frame: '#3a3d40', bay: 3.6, storey: 3.9, window: { w: 0.8, h: 0.72, bars: 'grid', sill: false, lintel: false }, quality: 'low', seed: 16 })
  const witteDame = { mat: plasterFac.material, tile: [plasterFac.tile[0] * 2, plasterFac.tile[1] * 2] }
  const lichtFac = M.facade(THREE, { wall: 'brick', color: '#cdb98d', frame: '#2f3a34', bay: 3.0, storey: 3.6, window: { w: 0.7, h: 0.66, bars: 'grid', sill: true, lintel: false }, quality: 'low', seed: 17 })
  const lichttoren = { mat: lichtFac.material, tile: [lichtFac.tile[0] * 2, lichtFac.tile[1] * 2] }
  const shops = [
    M.shopfront(THREE, { color: '#2a2420', fascia: '#1d1d1d', bay: 3.2, storey: 4.2, quality: q, seed: 21 }),
    M.shopfront(THREE, { color: '#3b3f44', fascia: '#e8e3d8', bay: 3.2, storey: 4.2, warm: 0.4, quality: q, seed: 22 }),
  ].map((f) => ({ mat: f.material, tile: [6.4, 4.2] }))

  // blue-green curtain walls (photo 6), the gridded office (photo 3), towers
  const admA = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [3.6, 3.8], cols: 2, rows: 2, wall: [0.62, 0.7, 0.72], win: [0, 1, 0, 1], frame: [0.62, 0.7, 0.72], fw: 0.035, glass: [0.22, 0.52, 0.62], spandrel: [0, 0.2, [0.14, 0.4, 0.5]], blinds: 0.05, seed: 31 }),
    { envMapIntensity: 1.5 }
  )
  const admB = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [3.6, 3.8], cols: 2, rows: 2, wall: [0.9, 0.9, 0.88], wallRough: 0.5, win: [0.08, 0.92, 0.1, 0.9], frame: [0.85, 0.86, 0.86], fw: 0.04, mull: 2, glass: [0.26, 0.55, 0.62], blinds: 0.12, seed: 32 }),
    { envMapIntensity: 1.4 }
  )
  const gridOffice = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [3.6, 3.6], cols: 2, rows: 2, wall: [0.36, 0.42, 0.48], wallRough: 0.5, win: [0.07, 0.93, 0.1, 0.9], frame: [0.5, 0.56, 0.6], fw: 0.03, glass: [0.3, 0.46, 0.62], blinds: 0.1, seed: 33 }),
    { envMapIntensity: 1.4 }
  )
  const lobby = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [6, 4], cols: 3, rows: 1, wall: [0.15, 0.15, 0.16], win: [0, 1, 0, 1], frame: [0.12, 0.12, 0.13], fw: 0.05, transom: 0.75, glass: [0.16, 0.2, 0.23], blinds: 0, seed: 34 }),
    { envMapIntensity: 1.1, side: THREE.DoubleSide }
  )
  const resiGrey = pbrMat(THREE, facadeTex(THREE, s2, { tile: [12, 12], cols: 4, rows: 4, wall: [0.86, 0.85, 0.82], win: [0.08, 0.92, 0.18, 0.86], frame: [0.3, 0.3, 0.32], fw: 0.06, mull: 2, glass: [0.3, 0.42, 0.52], blinds: 0.3, seed: 38 }), { envMapIntensity: 1.1 })
  const resiBeige = pbrMat(THREE, facadeTex(THREE, s2, { tile: [12, 12], cols: 4, rows: 4, wall: [0.84, 0.76, 0.62], win: [0.12, 0.88, 0.0, 0.8], frame: [0.32, 0.32, 0.33], fw: 0.06, mull: 3, glass: [0.3, 0.4, 0.5], blinds: 0.25, seed: 37 }), { envMapIntensity: 1.1 })
  const towerDark = pbrMat(THREE, facadeTex(THREE, s2, { tile: [6, 12], cols: 4, rows: 4, wall: [0.3, 0.24, 0.2], win: [0.25, 0.75, 0.1, 0.92], frame: [0.2, 0.18, 0.17], fw: 0.05, glass: [0.28, 0.36, 0.44], blinds: 0.15, seed: 39 }), { envMapIntensity: 1.1 })
  const towerGlass = pbrMat(THREE, facadeTex(THREE, s2, { tile: [9, 12], cols: 6, rows: 3, wall: [0.24, 0.3, 0.36], win: [0.03, 0.97, 0.25, 0.98], frame: [0.45, 0.5, 0.55], fw: 0.05, glass: [0.28, 0.48, 0.66], blinds: 0.08, seed: 40 }), { envMapIntensity: 1.4 })
  const whiteBlocks = pbrMat(THREE, facadeTex(THREE, s2, { tile: [2.4, 1.2], cols: 2, rows: 2, wall: [0.92, 0.92, 0.9], wallRough: 0.55, joints: true, win: [0, 0, 0, 0], seed: 35 }), { metalness: 0 })
  const hallBand = pbrMat(THREE, facadeTex(THREE, s2, { tile: [6, 4], cols: 4, rows: 1, wall: [0.9, 0.9, 0.88], wallRough: 0.6, win: [0, 1, 0.2, 0.85], frame: [0.82, 0.82, 0.82], fw: 0.05, glass: [0.28, 0.36, 0.42], blinds: 0.35, seed: 36 }), { envMapIntensity: 1.1 })
  // the Bijenkorf (Gio Ponti, 1969): small grey-green ceramic tiles, hexagonal windows
  const HEX = [
    [2, 3, 1.1],
    [6.5, 2.4, 0.8],
    [9.6, 4.2, 1.2],
    [4, 7.4, 1.0],
    [8.1, 8.6, 0.9],
    [1.5, 10.2, 0.7],
    [10.6, 10.6, 0.8],
  ]
  const bijenkorf = pbrMat(
    THREE,
    pbr(THREE, s2, s2, (u, v, p) => {
      const x = u * 12
      const y = v * 12
      for (const [cx, cy, r] of HEX) {
        const dx = Math.abs(x - cx)
        const dy = Math.abs(y - cy)
        const hd = Math.max(dx * 0.866 + dy * 0.5, dy)
        if (hd < r) {
          if (hd > r - 0.12) {
            p.r = p.g = p.b = 0.18
            p.h = 0.55
            p.ro = 0.4
            p.me = 0.6
          } else {
            p.r = 0.2
            p.g = 0.3
            p.b = 0.38
            p.h = 0.25
            p.ro = 0.06
            p.me = 1
          }
          return
        }
      }
      const tx = x / 0.25
      const ty = y / 0.25
      const fx = tx - Math.floor(tx)
      const fy = ty - Math.floor(ty)
      const t = hash(Math.floor(tx), Math.floor(ty), 5)
      const k = 0.88 + t * 0.22
      p.r = 0.47 * k
      p.g = 0.53 * k
      p.b = 0.5 * k
      p.ro = 0.35
      p.me = 0.05
      p.h = 0.6
      if (fx < 0.08 || fy < 0.08) {
        p.r *= 0.6
        p.g *= 0.6
        p.b *= 0.6
        p.h = 0.45
        p.ro = 0.9
      }
    }),
    { envMapIntensity: 1.2 }
  )
  // vertical dark slats round MANA's door
  const slats = pbrMat(
    THREE,
    pbr(THREE, 128, 128, (u, v, p) => {
      const f = (u * 10) % 1
      const k = f < 0.6 ? 0.9 + 0.1 * Math.sin(f * 5) : 0.45
      p.r = 0.26 * k
      p.g = 0.26 * k
      p.b = 0.27 * k
      p.h = f < 0.6 ? 0.8 : 0.3
      p.ro = 0.45
      p.me = 0.5
    }),
    {}
  )

  // the shells
  const glassBlue = new THREE.MeshPhysicalMaterial({
    color: 0x3f7fb4,
    metalness: 0.45,
    roughness: 0.05,
    transparent: true,
    opacity: 0.66,
    envMapIntensity: 1.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  })
  const glassTeal = glassBlue.clone()
  glassTeal.color.setHex(0x3a96a8)
  glassTeal.opacity = 0.74
  const blobWhite = new THREE.MeshStandardMaterial({ color: 0xf4f4f1, roughness: 0.32, metalness: 0.12, side: THREE.DoubleSide, envMapIntensity: 0.9 })
  const steelWhite = new THREE.MeshStandardMaterial({ color: 0xf0f0ed, roughness: 0.35, metalness: 0.3 })
  const seamGrey = new THREE.MeshStandardMaterial({ color: 0x9fa3a7, roughness: 0.5, metalness: 0.3 })
  const silverGreen = new THREE.MeshStandardMaterial({ color: 0xa3b0a6, roughness: 0.3, metalness: 0.7, side: THREE.DoubleSide })

  /* the ground ------------------------------------------------------------------------- */
  scene.add(flat(THREE, 4000, 4000, asphalt, 6, 0, 0, 0))
  // 18 Septemberplein: grey flags, a ceramic strip down the middle with glass light inserts
  scene.add(flat(THREE, 108, 132, flags, 3.6, 24, 0.03, 30))
  scene.add(flat(THREE, 9, 132, ceramic, 2.4, 33, 0.04, 30))
  {
    const inserts = []
    for (let z = -32; z < 95; z += 3.2) for (const x of [30.5, 33, 35.5]) if (hash(Math.round(x), Math.round(z), 3) < 0.55) inserts.push({ x, y: 0.035, z, w: 0.9, h: 0.02, d: 0.9 })
    instBoxes(THREE, scene, inserts, new THREE.MeshStandardMaterial({ color: 0xbfd9e6, metalness: 0.6, roughness: 0.06, emissive: 0x9ec8e0, emissiveIntensity: 0.15 }), { cast: false })
  }
  // brick pavements: Emmasingel west side, the south street both sides, the Vestdijk east side
  scene.add(flat(THREE, 6, 360, brickPavers, 2, -45, 0.04, 60))
  scene.add(flat(THREE, 210, 4, brickPavers, 2, 55, 0.04, 98))
  scene.add(flat(THREE, 240, 6, brickPavers, 2, 40, 0.04, 111))
  scene.add(flat(THREE, 10, 400, flags, 3.6, 192, 0.04, 40))
  scene.add(flat(THREE, 4, 400, flags, 3.6, 158, 0.04, 40))
  // pavements along the Mathildelaan
  scene.add(flat(THREE, 600, 3, flags, 3.6, 0, 0.04, -51.5))
  // the park's brick promenade (photo 2)
  scene.add(flat(THREE, 12, 150, brickRoad, 2, -24, 0.05, 186))
  // the park
  batch.box(lawn, 93, 0.1, 76, 28.5, 0, 152, [3, 3])
  batch.box(lawn, 93, 0.1, 16, 28.5, 0, 203, [3, 3])
  batch.box(lawn, 19, 0.1, 36, 84.5, 0, 132, [3, 3])
  scene.add(flat(THREE, 93, 3, asphalt, 6, 28.5, 0.12, 193.5))
  batch.box(kerb, 93, 0.14, 0.12, 28.5, 0, 191.9, [3, 3])
  batch.box(kerb, 93, 0.14, 0.12, 28.5, 0, 195.1, [3, 3])
  // the hall's forecourt
  scene.add(flat(THREE, 64, 14, flags, 3.6, 25, 0.05, 218))
  // red cycle lanes on the Mathildelaan and the Vestdijk
  scene.add(flat(THREE, 600, 2.2, redLane, 6, 0, 0.035, -37.3))
  scene.add(flat(THREE, 600, 2.2, redLane, 6, 0, 0.035, -48.7))
  scene.add(flat(THREE, 2.4, 400, redLane, 6, 185.6, 0.035, 40))
  scene.add(flat(THREE, 2.4, 400, redLane, 6, 163.4, 0.035, 40))
  // kerbs
  for (const z of [-36, -50]) batch.box(kerb, 600, 0.13, 0.2, 0, 0, z, [3, 3])
  for (const z of [100, 108]) batch.box(kerb, 205, 0.13, 0.2, 57.5, 0, z, [3, 3])
  for (const x of [-42, -30]) batch.box(kerb, 0.2, 0.13, 132, x, 0, 30, [3, 3])
  for (const x of [160, 187]) batch.box(kerb, 0.2, 0.13, 400, x, 0, 40, [3, 3])
  // the Vestdijk's bus lanes: a raised concrete strip each side
  batch.box(kerb, 0.3, 0.15, 400, 169.8, 0, 40, [3, 3])
  batch.box(kerb, 0.3, 0.15, 400, 177.2, 0, 40, [3, 3])
  batch.box(lawn, 2, 0.16, 400, 173.5, 0, 40, [3, 3])
  batch.box(kerb, 2.3, 0.14, 400, 173.5, 0, 40, [3, 3])
  {
    const marks = []
    for (let x = -300; x < 300; x += 6) if (Math.abs(x - 15) > 6) marks.push({ x, y: 0.05, z: -43, w: 3, h: 0.01, d: 0.12 })
    for (let x = -40; x < 158; x += 6) marks.push({ x, y: 0.05, z: 104, w: 3, h: 0.01, d: 0.12 })
    // zebra crossings over the Mathildelaan, the south street and the Vestdijk
    for (let i = 0; i < 7; i++) marks.push({ x: 9 + i * 1.0, y: 0.05, z: -43, w: 0.5, h: 0.01, d: 13 })
    for (let i = 0; i < 6; i++) marks.push({ x: -10 + i * 1.0, y: 0.05, z: 104, w: 0.5, h: 0.01, d: 7.5 })
    for (let i = 0; i < 9; i++) marks.push({ x: 173.5, y: 0.17, z: 0 + i * 1.0, w: 26, h: 0.01, d: 0.5 })
    instBoxes(THREE, scene, marks, new THREE.MeshStandardMaterial({ color: 0xe8e7e2, roughness: 0.6 }), { cast: false })
    // bike symbols' white edge lines on the red lanes
    const lines = []
    for (let x = -300; x < 300; x += 2) lines.push({ x, y: 0.045, z: -38.3, w: 1, h: 0.01, d: 0.1 }, { x, y: 0.045, z: -47.7, w: 1, h: 0.01, d: 0.1 })
    instBoxes(THREE, scene, lines, new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 }), { cast: false })
    for (const z of [-20, 60, 140]) {
      const bus = lettering(THREE, 'BUS', { w: 4.5, h: 1.6, font: '700 {px}px "Helvetica Neue", Arial, sans-serif', color: '#f2f1ec', px: 128 })
      bus.rotation.x = -Math.PI / 2
      bus.rotation.z = Math.PI / 2
      bus.position.set(171.2, 0.06, z)
      scene.add(bus)
    }
  }

  /* the Blob ---------------------------------------------------------------------------- */
  // the door's direction: south-east, toward the square
  const EN = unit3(0.62, 0, 0.78)
  const entAng = Math.atan2(EN[2], EN[0])
  // where the glides into and out of the café pass through the skin: keep those panels glass
  const clear = [
    [10.2, 10.6, 12.9],
    [9.3, 13.2, 13.4],
  ]
  geodesic(THREE, scene, {
    ax: BLOB.ax,
    ay: BLOB.ay,
    az: BLOB.az,
    y0: BLOB.y0,
    detail: low ? 5 : 7,
    rf: blobR,
    glassMat: glassBlue,
    solidMat: blobWhite,
    barMat: steelWhite,
    seamMat: seamGrey,
    bar: 0.16,
    seam: 0.045,
    // the panels where MANA's portal is pushed through the skin
    skip: (c) => Math.abs(c[0] * EN[2] - c[2] * EN[0]) < 5.1 && c[1] < 3.8 && c[0] * EN[0] + c[2] * EN[2] > 0,
    classify(d, c) {
      if (clear.some((p) => Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) < 3.2)) return true
      const ang = Math.atan2(d[2], d[0])
      const top = d[1] + 0.22 * Math.sin(ang * 2 + 1.1) + 0.1 * Math.sin(ang * 5 + 0.3)
      if (top > 0.44) return true
      // a glass ribbon winding round the body — but not over MANA's white wall
      let da = Math.abs(ang - entAng)
      if (da > Math.PI) da = Math.PI * 2 - da
      const band = d[1] - 0.05 - 0.2 * Math.sin(ang * 2 - 0.6) - 0.06 * Math.sin(ang * 3)
      if (da > 0.6 && Math.abs(band) < 0.08 && c[1] > 4.5) return true
      // shop windows low down on the north and west
      if (da > 1.2 && c[1] < 4.2 && c[1] > 0.3 && Math.sin(ang * 6) > 0.2) return true
      return false
    },
  })

  // MANA's entrance: a dark slatted portal set in the white skin (photo 7)
  const entRy = Math.atan2(EN[0], EN[2])
  const at = (dist, side) => [EN[0] * dist + EN[2] * side, EN[2] * dist - EN[0] * side]
  // the portal's face stands just proud of the skin everywhere across its width
  let zf = 0
  for (let side = -5.6; side <= 5.6; side += 0.8) {
    for (const y of [0.3, 2.8, 5.6, 6.6]) {
      for (let d = 40; d > 0; d -= 0.1) {
        const [x, z] = at(d, side)
        if (insideBlob(x, y, z)) {
          zf = Math.max(zf, d)
          break
        }
      }
    }
  }
  zf += 0.25
  {
    const depth = 7
    const [px, pz] = at(zf - depth / 2, 0)
    batch.box(slats, 11, 5.6, depth, px, 0, pz, [1.2, 5.6], entRy)
    batch.box(darkMetal, 11.3, 0.3, depth + 0.1, px, 5.6, pz, [2, 2], entRy)
    const [dx, dz] = at(zf + 0.03, 0)
    batch.box(lobby, 3.2, 3.2, 0.1, dx, 0, dz, [6, 4], entRy)
    const sign = lettering(THREE, 'MANA', { w: 3.8, h: 0.8, font: '600 {px}px "Helvetica Neue", Arial, sans-serif', color: '#ff6a24', px: 160, emissive: 1.4 })
    const [sx, sz] = at(zf + 0.08, 0)
    sign.position.set(sx, 4.5, sz)
    sign.rotation.y = entRy
    scene.add(sign)
    const sub = lettering(THREE, 'SOCIAL PERFORMANCE CLUB', { w: 3.0, h: 0.26, font: '600 {px}px "Helvetica Neue", Arial, sans-serif', color: '#f2f0ea', px: 80, emissive: 0.4 })
    const [bx, bz] = at(zf + 0.08, 2.9)
    sub.position.set(bx, 3.75, bz)
    sub.rotation.y = entRy
    scene.add(sub)
    const no = lettering(THREE, '12-14', { w: 0.7, h: 0.3, font: '600 {px}px "Helvetica Neue", Arial, sans-serif', color: '#f2f0ea', px: 80 })
    const [nx, nz] = at(zf + 0.08, -0.9)
    no.position.set(nx, 3.6, nz)
    no.rotation.y = entRy
    scene.add(no)
    // two black feather banners either side of the door
    const feather = new THREE.Shape()
    feather.moveTo(0, 0.4)
    feather.lineTo(0, 3.6)
    feather.quadraticCurveTo(0.2, 4.1, 0.9, 3.7)
    feather.quadraticCurveTo(0.95, 2, 0.75, 0.9)
    feather.lineTo(0, 0.4)
    const fgeo = new THREE.ShapeGeometry(feather, 8)
    const fmat = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.6, side: THREE.DoubleSide })
    const flash = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6, side: THREE.DoubleSide })
    for (const side of [-4.9, 4.7]) {
      const [fx, fz] = at(zf + 0.9, side)
      const f = new THREE.Mesh(fgeo, fmat)
      f.position.set(fx, 0, fz)
      f.rotation.y = entRy + 0.3
      f.castShadow = true
      scene.add(f)
      const chev = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.08), flash)
      chev.position.set(0.42, 3.0, 0.01)
      chev.rotation.z = 0.5
      f.add(chev)
      const chev2 = chev.clone()
      chev2.position.y = 2.7
      f.add(chev2)
      batch.box(darkMetal, 0.05, 4.0, 0.05, fx, 0, fz, [1, 1])
    }
    // the planted bed in front: last year's stalks, new grass, bare soil (photo 7)
    const [cx, cz] = at(zf + 6.5, 0)
    batch.box(lawn, 26, 0.12, 8, cx, 0, cz, [3, 3], entRy)
    const [k1x, k1z] = at(zf + 2.45, 0)
    batch.box(kerb, 26, 0.18, 0.15, k1x, 0, k1z, [3, 3], entRy)
    const stalks = []
    const tufts = []
    for (let i = 0; i < (low ? 70 : 170); i++) {
      const [x, z] = at(zf + range(rand, 3, 10.3), range(rand, -12.5, 12.5))
      if (rand() < 0.45) stalks.push({ x, y: 0.1, z, w: range(rand, 0.25, 0.5), h: range(rand, 0.6, 1.2), d: range(rand, 0.25, 0.5), r: rand() * 3 })
      else tufts.push({ x, y: 0.08, z, w: range(rand, 0.3, 0.7), h: range(rand, 0.15, 0.4), d: range(rand, 0.3, 0.7), r: rand() * 3 })
    }
    // a clump: thin blades leaning out from a common root
    const blades = []
    for (let k = 0; k < 9; k++) {
      const b = new THREE.BoxGeometry(0.035, 1, 0.012).translate(0, 0.5, 0)
      b.rotateZ(0.12 + (k % 3) * 0.16)
      b.rotateY((k / 9) * Math.PI * 2 + k * 0.7)
      blades.push(b)
    }
    const clump = mergeGeometries(blades, false)
    instBoxes(THREE, scene, stalks, new THREE.MeshStandardMaterial({ color: 0xa88a5c, roughness: 0.95 }), { geo: clump })
    instBoxes(THREE, scene, tufts, new THREE.MeshStandardMaterial({ color: 0x6a9a34, roughness: 0.9 }), { geo: clump.clone(), cast: false })
  }

  // inside: two floors under the shell, the café with its long bar up top (photos 8–13)
  {
    const level = (h) => Math.sqrt(Math.max(0, 1 - ((h - BLOB.y0) / BLOB.ay) ** 2)) * 0.9
    const f1 = level(5.2)
    const sl1 = new THREE.Mesh(ellipseSlab(THREE, BLOB.ax * f1 - 1.2, BLOB.az * f1 - 1.2, 0.4, [-6, 0, 8, 6]), interiorFloor)
    sl1.position.y = 5.2
    sl1.receiveShadow = sl1.castShadow = true
    scene.add(sl1)
    const f2 = level(11.8)
    const sl2 = new THREE.Mesh(ellipseSlab(THREE, BLOB.ax * f2 - 1.6, BLOB.az * f2 - 1.6, 0.4, [-11, 0, 6.5, 6]), interiorFloor)
    sl2.position.y = 11.8
    sl2.receiveShadow = sl2.castShadow = true
    scene.add(sl2)
    const top = 12.2
    // the bar: black body, pale stone top, coffee machines, the DJ's decks
    const barBlack = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.5 })
    batch.box(barBlack, 10, 1.02, 0.85, -2, top, -6.6, [2, 2])
    batch.box(new THREE.MeshStandardMaterial({ color: 0xded3bf, roughness: 0.45 }), 10.2, 0.07, 1.0, -2, top + 1.02, -6.6, [2, 2])
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 1, roughness: 0.18 })
    batch.box(chrome, 0.85, 0.48, 0.55, 0.2, top + 1.09, -6.7, [1, 1])
    batch.box(chrome, 0.25, 0.55, 0.25, 1.3, top + 1.09, -6.6, [1, 1])
    batch.box(darkMetal, 1.2, 0.12, 0.6, -4.8, top + 1.09, -6.6, [1, 1])
    batch.box(barBlack, 3, 1.0, 0.8, 5, top, -2.5, [2, 2])
    // a white wall with the MANA name behind the bar
    batch.box(white, 9, 3.4, 0.25, -2, top, -9.3, [2, 2])
    const wall = lettering(THREE, 'M A N A', { w: 3.6, h: 0.7, font: '300 {px}px "Helvetica Neue", Arial, sans-serif', color: '#5c5f63', px: 120 })
    wall.position.set(-2, top + 2.2, -9.15)
    scene.add(wall)
    // pendant lamps hanging from the shell
    const cables = beamBatch(THREE)
    const bulbs = []
    for (const [x, z] of [
      [-5, -5.5],
      [-2, -5.5],
      [1, -5.5],
      [4, -1],
      [-1, 1],
    ]) {
      cables.add(V(x, 19.5, z), V(x, 15.2, z), 0.012)
      bulbs.push({ x, y: 14.9, z, w: 0.07, h: 0.3, d: 0.07 })
    }
    scene.add(cables.build(darkMetal, { castShadow: false }))
    instBoxes(THREE, scene, bulbs, new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd9a0, emissiveIntensity: 1.6 }), { cast: false })
    // glass balustrades round the voids
    const rail = beamBatch(THREE)
    for (const [cy, hx, hz, rx, rz] of [
      [5.6, -6, 0, 8, 6],
      [12.2, -11, 0, 6.5, 6],
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
    const tables = []
    for (let i = 0; i < 14; i++) {
      const x = range(rand, -14, 12)
      const z = range(rand, -9, 9)
      if (!insideBlob(x, 1, z) || Math.hypot(x + 6, z) < 8.5) continue
      tables.push({ x, y: 0.05, z, w: 0.8, h: 0.75, d: 0.8 })
    }
    for (const [x, z] of [
      [3, 2],
      [6, -1],
      [2, -2],
      [6.5, 3.5],
    ])
      tables.push({ x, y: top, z, w: 0.75, h: 0.75, d: 0.75 })
    instBoxes(THREE, scene, tables, new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.45 }), { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 18).translate(0, 0.5, 0) })
    addForest(
      THREE,
      scene,
      [
        { x: 9, y: top, z: -3, h: 3.0 },
        { x: -8.5, y: top, z: -5, h: 2.8 },
        { x: -2, y: 5.6, z: 8, h: 3.4 },
      ],
      { species: 'olive', season: 'summer', seed: 4, quality: q }
    )
  }

  /* the square: the Bubble, the Tube's entrances, trees ------------------------------------ */
  geodesic(THREE, scene, {
    cx: 52,
    cz: 32,
    ax: 8.5,
    ay: 10,
    az: 8,
    y0: 1.2,
    detail: low ? 2 : 3,
    rf: (dx, dy, dz) => 1 + 0.06 * Math.sin(dx * 4 + dz * 3) - 0.08 * sstep(0.6, 1, dy),
    glassMat: glassTeal,
    solidMat: silverGreen,
    barMat: new THREE.MeshStandardMaterial({ color: 0xc9cdcf, roughness: 0.35, metalness: 0.6 }),
    seamMat: null,
    bar: 0.12,
    classify: (d, c) => !(hash(Math.round(c[0] * 3), Math.round(c[2] * 3) + Math.round(c[1] * 3) * 97, 9) > 0.75 || c[1] < 0.9),
  })
  const hornShell = new THREE.MeshStandardMaterial({ map: whiteConcrete.map, normalMap: whiteConcrete.normalMap, roughnessMap: whiteConcrete.roughnessMap, roughness: 0.85, color: 0xffffff, side: THREE.DoubleSide })
  const hornDark = new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.9 })
  // the western entrance: white (photo 5)
  hornEntrance(THREE, scene, { x: 8, z: 63, ry: 0, shellMat: hornShell, rimMat: white, glassMat: lobby, darkMat: hornDark })
  // the eastern one, painted with graffiti rings (photo 6)
  const graffiti = new THREE.MeshStandardMaterial({ map: graffitiTexture(THREE), roughness: 0.6, side: THREE.DoubleSide })
  hornEntrance(THREE, scene, { x: 44, z: -29, ry: Math.PI / 2, shellMat: graffiti, rimMat: white, glassMat: lobby, darkMat: hornDark })
  // the canopy over Piazza's front (Fuksas): glass on a steel grid, leaning out over the square
  {
    const g = new THREE.PlaneGeometry(14, 76, 1, 1)
    g.rotateX(-Math.PI / 2)
    g.rotateZ(0.34)
    const canopy = new THREE.Mesh(g, glassTeal)
    canopy.position.set(73, 13.2, 36)
    scene.add(canopy)
    const grid = beamBatch(THREE)
    const ca = Math.cos(0.34)
    const sa = Math.sin(0.34)
    for (let z = -2; z <= 74; z += 3.8) grid.add(V(73 - 7 * ca, 13.2 - 7 * sa, z), V(73 + 7 * ca, 13.2 + 7 * sa, z), 0.12, 0.3)
    for (let i = -3; i <= 3; i++) grid.add(V(73 + i * 2.33 * ca, 13.2 + i * 2.33 * sa, -2), V(73 + i * 2.33 * ca, 13.2 + i * 2.33 * sa, 74), 0.1, 0.2)
    for (let z = 2; z <= 72; z += 11.4) {
      grid.add(V(68, 0, z), V(68, 9.6, z), 0.36)
      grid.add(V(68, 9.6, z), V(66.6, 10.8, z - 3), 0.14)
      grid.add(V(68, 9.6, z), V(66.6, 10.8, z + 3), 0.14)
    }
    scene.add(grid.build(steelWhite))
  }

  /* buildings ----------------------------------------------------------------------------- */
  const roofCap = (x0, x1, z0, z1, h) => blk(roofMat, x0 - 0.2, x1 + 0.2, z0 - 0.2, z1 + 0.2, h, 0.5, [4, 4])
  // the Admirant offices north of the Mathildelaan (photo 6) and the skybridge between them
  blk(admA, -62, 4, -104, -54, 0, 33, [3.6, 3.8])
  roofCap(-62, 4, -104, -54, 33)
  blk(lobby, -61.6, 3.6, -103.6, -53.8, 0, 4.2, [6, 4])
  blk(admB, 22, 86, -104, -54, 0, 26, [3.6, 3.8])
  roofCap(22, 86, -104, -54, 26)
  blk(lobby, 22.4, 85.6, -103.6, -53.8, 0, 4.2, [6, 4])
  blk(admA, 3.5, 22.5, -67, -60, 7.4, 3.8, [3.6, 3.8])
  blk(white, 3.5, 22.5, -67.2, -59.8, 11.2, 0.4, [2, 2])
  blk(white, 3.5, 22.5, -67.2, -59.8, 7.0, 0.4, [2, 2])
  {
    const sup = lettering(THREE, 'SUPERMARKT', { w: 7, h: 0.9, font: '700 {px}px "Helvetica Neue", Arial, sans-serif', color: '#ffc93a', px: 128, emissive: 1.8 })
    sup.position.set(-14, 3.4, -53.5)
    scene.add(sup)
    const adm = lettering(THREE, 'ADMIRANT', { w: 9, h: 1.2, font: '600 {px}px "Helvetica Neue", Arial, sans-serif', color: '#ffffff', px: 128, emissive: 0.3 })
    adm.position.set(54, 23, -53.7)
    scene.add(adm)
  }
  // the Lichttoren: cream brick, a tower with a glass lantern on the corner
  blk(lichttoren.mat, -104, -50, -33, 16, 0, 21.6, lichttoren.tile)
  roofCap(-104, -50, -33, 16, 21.6)
  blk(shops[0].mat, -50.2, -49.9, -20, 12, 0, 4.2, shops[0].tile)
  {
    const tx = -58
    const tz = -27
    blk(lichttoren.mat, tx - 5, tx + 5, tz - 5, tz + 5, 0, 36, lichttoren.tile)
    blk(whiteConcrete, tx - 5.6, tx + 5.6, tz - 5.6, tz + 5.6, 36, 1, [4, 4])
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 6, 8, 1, true), glassTeal)
    lantern.position.set(tx, 40, tz)
    scene.add(lantern)
    const ribs = beamBatch(THREE)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8
      ribs.add(V(tx + Math.cos(a) * 4.15, 37, tz + Math.sin(a) * 4.15), V(tx + Math.cos(a) * 4.15, 43, tz + Math.sin(a) * 4.15), 0.18)
    }
    scene.add(ribs.build(darkMetal))
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6d8f86, metalness: 0.6, roughness: 0.4 }))
    dome.scale.y = 0.55
    dome.position.set(tx, 43, tz)
    dome.castShadow = true
    scene.add(dome)
    batch.box(darkMetal, 0.25, 4, 0.25, tx, 45.2, tz, [1, 1])
  }
  // De Witte Dame: the white Philips factory of 1928, big steel windows
  blk(witteDame.mat, -108, -50, 24, 94, 0, 27.3, witteDame.tile)
  roofCap(-108, -50, 24, 94, 27.3)
  blk(whiteConcrete, -50.4, -49.6, 24, 94, 27.3, 0.9, [4, 4])
  // Piazza (shops) and the Bijenkorf on the square's east side
  blk(resiBeige, 80, 156, 24, 90, 4.6, 16.4, [12, 12])
  blk(shops[1].mat, 79.8, 156, 24, 90, 0, 4.6, shops[1].tile)
  roofCap(80, 156, 24, 90, 21)
  {
    const word = lettering(THREE, 'PIAZZA', { w: 14, h: 2.6, font: '700 {px}px "Helvetica Neue", Arial, sans-serif', color: '#ffffff', px: 160, emissive: 0.4 })
    word.position.set(79.6, 17.5, 57)
    word.rotation.y = -Math.PI / 2
    scene.add(word)
  }
  blk(bijenkorf, 96, 156, -34, 20, 0, 24, [12, 12])
  blk(lobby, 95.8, 156, -34, 20, 0, 4.4, [6, 4])
  blk(darkMetal, 95.5, 156.5, -34.5, 20.5, 24, 1.4, [2, 2])
  {
    const bk = lettering(THREE, 'de Bijenkorf', { w: 12, h: 2, font: 'italic 600 {px}px Georgia, serif', color: '#1d1d1d', px: 140 })
    bk.position.set(95.6, 18.5, -7)
    bk.rotation.y = -Math.PI / 2
    scene.add(bk)
  }
  // the gridded office block south of the centre (photo 3)
  blk(gridOffice, 96, 150, 118, 146, 0, 54, [3.6, 3.6])
  blk(lobby, 95.8, 150.2, 117.8, 146.2, 0, 4.8, [6, 4])
  roofCap(96, 150, 118, 146, 54)
  blk(darkMetal, 110, 136, 124, 140, 54.5, 3.5, [2, 2])
  // the sports hall where the run starts (photo 1): white blocks, a ribbon window, a long canopy
  {
    const x0 = -5
    const x1 = 55
    blk(whiteBlocks, x0, x1, 225, 249, 0, 15, [2.4, 1.2])
    blk(hallBand, x0 - 0.1, x1 + 0.1, 224.9, 249.1, 10, 4, [6, 4])
    blk(whiteConcrete, x0 - 0.3, x1 + 0.3, 224.7, 249.3, 15, 0.6, [4, 4])
    blk(lobby, x0 + 2, x1 - 2, 224.7, 225.1, 0, 4.4, [6, 4])
    // the canopy: a thin white slab on slender posts, a railing round its roof terrace
    blk(white, x0 - 2, x1 + 2, 211, 225, 4.6, 0.55, [2, 2])
    const posts = []
    for (let x = x0; x <= x1; x += 6.5) posts.push({ x, y: 0, z: 212, w: 0.16, h: 4.6, d: 0.16 })
    instBoxes(THREE, scene, posts, darkMetal)
    const rail = beamBatch(THREE)
    for (let x = x0 - 1.8; x < x1 + 1.8; x += 1.6) rail.add(V(x, 5.15, 211.2), V(x, 6.2, 211.2), 0.05)
    rail.add(V(x0 - 1.8, 6.2, 211.2), V(x1 + 1.8, 6.2, 211.2), 0.07)
    rail.add(V(x0 - 1.8, 5.7, 211.2), V(x1 + 1.8, 5.7, 211.2), 0.04)
    // a caged ladder up the facade
    const lx = 30
    for (let y = 5; y < 15.4; y += 0.3) rail.add(V(lx - 0.25, y, 224.7), V(lx + 0.25, y, 224.7), 0.03)
    rail.add(V(lx - 0.25, 5, 224.7), V(lx - 0.25, 15.6, 224.7), 0.05)
    rail.add(V(lx + 0.25, 5, 224.7), V(lx + 0.25, 15.6, 224.7), 0.05)
    for (let y = 7; y < 15.4; y += 0.9) {
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI
        const a1 = ((i + 1) / 8) * Math.PI
        rail.add(V(lx + Math.cos(a0) * 0.42, y, 224.7 - Math.sin(a0) * 0.7), V(lx + Math.cos(a1) * 0.42, y, 224.7 - Math.sin(a1) * 0.7), 0.03)
      }
    }
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * Math.PI
      rail.add(V(lx + Math.cos(a) * 0.42, 7, 224.7 - Math.sin(a) * 0.7), V(lx + Math.cos(a) * 0.42, 15.6, 224.7 - Math.sin(a) * 0.7), 0.03)
    }
    scene.add(rail.build(paintWhite))
    // steps and white picnic tables on the grass
    for (let i = 0; i < 3; i++) blk(kerb, 10, 26, 205.4 + i * 0.4, 211, 0, 0.15 * (i + 1), [3, 3])
    const planks = []
    for (const [x, z] of [
      [12, 198.5],
      [44, 199],
      [-6, 170],
    ]) {
      planks.push({ x, y: 0.72, z, w: 1.9, h: 0.06, d: 0.8 }, { x, y: 0.42, z: z - 0.65, w: 1.9, h: 0.05, d: 0.3 }, { x, y: 0.42, z: z + 0.65, w: 1.9, h: 0.05, d: 0.3 })
      for (const dx of [-0.75, 0.75]) planks.push({ x: x + dx, y: 0, z, w: 0.08, h: 0.72, d: 1.5 })
    }
    instBoxes(THREE, scene, planks, white)
  }

  // brick streets of town houses and flats around the centre
  const row = (x0, x1, z0, z1, axis, hMin, hMax, faceShop = 0) => {
    // a run of buildings along `axis` ('x' or 'z') filling the rectangle
    let p = axis === 'x' ? x0 : z0
    const end = axis === 'x' ? x1 : z1
    let k = Math.floor(rand() * 3)
    while (p < end - 4) {
      const w = Math.min(end - p, range(rand, 7, 16))
      const h = 3.1 * Math.round(range(rand, hMin, hMax)) + 1
      const f = fac[k % 3]
      if (axis === 'x') {
        blk(f.mat, p, p + w, z0, z1, 0, h, f.tile)
        roofCap(p, p + w, z0, z1, h)
        if (faceShop) blk(shops[k % 2].mat, p + 0.2, p + w - 0.2, faceShop > 0 ? z1 - 0.1 : z0 - 0.05, faceShop > 0 ? z1 + 0.05 : z0 + 0.1, 0, 4.2, shops[k % 2].tile)
      } else {
        blk(f.mat, x0, x1, p, p + w, 0, h, f.tile)
        roofCap(x0, x1, p, p + w, h)
        if (faceShop) blk(shops[k % 2].mat, faceShop > 0 ? x1 - 0.1 : x0 - 0.05, faceShop > 0 ? x1 + 0.05 : x0 + 0.1, p + 0.2, p + w - 0.2, 0, 4.2, shops[k % 2].tile)
      }
      p += w + 0.15
      k++
    }
  }
  // west of the park, south of De Witte Dame
  row(-110, -50, 114, 140, 'x', 3, 5, 1)
  row(-80, -50, 146, 250, 'z', 3, 5, 1)
  // east of the park
  row(78, 92, 152, 250, 'z', 3, 5, -1)
  // behind the hall
  row(-60, 100, 258, 276, 'x', 3, 6)
  // west of the Lichttoren and De Witte Dame
  row(-150, -114, -120, -56, 'z', 4, 7)
  row(-150, -114, -30, 110, 'z', 4, 7)
  // north of the Admirant
  row(-80, 90, -150, -114, 'x', 5, 8, -1)
  // the Vestdijk's west side north of the Mathildelaan
  row(100, 156, -104, -56, 'x', 5, 8)
  row(100, 156, -150, -114, 'x', 5, 8)
  // the Vestdijk's east side north of the Lightyards site
  row(200, 236, -150, 20, 'z', 4, 8, -1)

  // the Lightyards site behind its printed hoarding (photo 4)
  {
    const fx = 197.5
    const z0 = 28
    const z1 = 176
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0, 2.0), new THREE.MeshStandardMaterial({ map: hoardingTexture(THREE), roughness: 0.7, side: THREE.DoubleSide }))
    banner.material.map.repeat.set((z1 - z0) / 9, 1)
    banner.rotation.y = -Math.PI / 2
    banner.position.set(fx, 1.15, (z0 + z1) / 2)
    banner.castShadow = banner.receiveShadow = true
    scene.add(banner)
    const fence = beamBatch(THREE)
    for (let z = z0; z <= z1; z += 3.5) fence.add(V(fx + 0.05, 0, z), V(fx + 0.05, 2.25, z), 0.05)
    fence.add(V(fx + 0.05, 2.2, z0), V(fx + 0.05, 2.2, z1), 0.04)
    scene.add(fence.build(new THREE.MeshStandardMaterial({ color: 0x9a9da0, metalness: 0.8, roughness: 0.35 })))
    // the blue name board in front
    const board = lettering(THREE, 'Lightyards Mussentuin', { w: 3.4, h: 0.36, font: '600 {px}px "Helvetica Neue", Arial, sans-serif', color: '#ffffff', px: 96 })
    blk(new THREE.MeshStandardMaterial({ color: 0x2a74c4, roughness: 0.5 }), fx - 0.32, fx - 0.26, 85.1, 88.9, 2.15, 0.5, [1, 1])
    board.position.set(fx - 0.34, 2.4, 87)
    board.rotation.y = -Math.PI / 2
    scene.add(board)
    for (const z of [85.4, 88.6]) blk(darkMetal, fx - 0.33, fx - 0.25, z - 0.04, z + 0.04, 0, 2.15, [1, 1])
    // the site: a rising concrete tower, a finished brick one, a crane
    const cx = 240
    const cz = 110
    blk(rawConcrete, cx - 6, cx + 6, cz - 5, cz + 5, 0, 60, [4, 4])
    for (let y = 3.2; y < 50; y += 3.2) blk(rawConcrete, cx - 13, cx + 13, cz - 12, cz + 12, y, 0.3, [4, 4])
    const cols = []
    for (const x of [-12.6, -6, 0, 6, 12.6]) for (const z of [-11.6, 11.6]) cols.push({ x: cx + x, y: 0, z: cz + z, w: 0.5, h: 50, d: 0.5 })
    instBoxes(THREE, scene, cols, rawConcrete)
    blk(gridOffice, cx - 13, cx + 13, cz - 12, cz + 12, 0, 22, [3.6, 3.6])
    blk(fac[0].mat, 215, 245, 30, 60, 0, 44, fac[0].tile)
    roofCap(215, 245, 30, 60, 44)
    blk(resiGrey, 215, 250, 140, 175, 0, 30, [12, 12])
    roofCap(215, 250, 140, 175, 30)
    // the sparrow garden: soil and young planting inside the fence
    batch.box(lawn, 16, 0.08, 148, 206, 0, 102, [3, 3])
  }

  /* the station area and its towers to the north (photo 5) -------------------------------------- */
  {
    const towers = [
      // x, z, w, d, h, material, tile
      [95, -215, 22, 22, 90, towerDark, [6, 12]], // the dark tower over the Vestdijk
      [-20, -230, 26, 18, 62, resiGrey, [12, 12]],
      [45, -300, 24, 24, 84, rawConcrete, [4, 4]], // going up, cranes on top
      [150, -175, 40, 16, 40, resiGrey, [12, 12]],
      [-80, -205, 20, 20, 72, resiBeige, [12, 12]],
      [200, -260, 24, 24, 70, towerGlass, [9, 12]],
      [-150, -300, 26, 22, 55, towerGlass, [9, 12]],
      [-40, -320, 22, 22, 100, towerGlass, [9, 12]],
      [130, -330, 26, 26, 76, resiBeige, [12, 12]],
    ]
    for (const [x, z, w, d, h, mat, tile] of towers) {
      batch.box(mat, w, h, d, x, 0, z, tile)
      batch.box(roofMat, w + 0.4, 0.6, d + 0.4, x, h, z, [4, 4])
      if (mat !== rawConcrete) batch.box(darkMetal, w * 0.5, 3, d * 0.5, x, h + 0.6, z, [2, 2])
    }
    // balconies on the white slab
    for (let y = 4; y < 38; y += 3.1) blk(white, 131, 169, -166.6, -165.6, y, 0.2, [2, 2])
    // the station: a long low hall, glass along the front, a slim tower with a clock
    blk(lobby, -150, 150, -400, -376, 0, 12, [6, 4])
    blk(whiteConcrete, -152, 152, -402, -374, 12, 1.2, [4, 4])
    blk(whiteConcrete, -46, -38, -382, -374, 0, 44, [4, 4])
    const clock = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }))
    clock.position.set(-42, 38, -373.9)
    scene.add(clock)
    addCranes(
      THREE,
      scene,
      [
        { x: 45, z: -300, h: 96, jib: 44, a: 2.4 },
        { x: 70, z: -270, h: 70, jib: 38, a: 0.6 },
        { x: 252, z: 98, h: 72, jib: 42, a: 2.8 },
      ].slice(0, low ? 2 : 3),
      new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, metalness: 0.3 })
    )
    // and the rest of the city, lower, all round
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    const uvs = unit.attributes.uv.array
    for (let i = 0; i < uvs.length; i++) uvs[i] *= 3
    const per = [[], [], []]
    for (let i = 0; i < (low ? 160 : 320); i++) {
      const x = range(rand, -700, 700)
      const z = range(rand, -700, 700)
      if (x > -175 && x < 270 && z > -170 && z < 290) continue
      if (x > -200 && x < 230 && z > -420 && z < -160) continue
      per[i % 3].push({ x, z, w: range(rand, 20, 44), h: range(rand, 12, 32), d: range(rand, 14, 24), r: Math.floor(rand() * 2) * (Math.PI / 2) })
    }
    instBoxes(THREE, scene, per[0], resiGrey, { cast: false, geo: unit })
    instBoxes(THREE, scene, per[1], fac[0].mat, { cast: false, geo: unit.clone() })
    instBoxes(THREE, scene, per[2], resiBeige, { cast: false, geo: unit.clone() })
  }

  /* trees: bare limes along the streets, young trees in the brick, fresh birches in the park ------ */
  const bare = []
  // the promenade's old trees (photo 2)
  for (let z = 118; z < 250; z += 9) bare.push({ x: -31 + range(rand, -0.5, 0.5), z, h: range(rand, 14, 18) }, { x: -17 + range(rand, -0.5, 0.5), z: z + 4.5, h: range(rand, 14, 18) })
  // the Emmasingel
  for (let z = -28; z < 96; z += 11) bare.push({ x: -45.5, z, h: range(rand, 9, 12) })
  // the Mathildelaan
  for (let x = -24; x < 78; x += 11) if (Math.abs(x - 13) > 8 && (x < 26 || x > 60)) bare.push({ x, z: -33.2, h: range(rand, 9, 12) })
  // the Vestdijk median and the Lightyards garden
  for (let z = -140; z < 240; z += 14) if (Math.abs(z - 100) > 14 && Math.abs(z - 4) > 8) bare.push({ x: 173.5, z, h: range(rand, 8, 11) })
  for (let z = 34; z < 172; z += 7) bare.push({ x: range(rand, 201, 212), z: z + range(rand, -2, 2), h: range(rand, 9, 15) })
  const young = []
  // the south street's young trees (photo 3)
  for (let x = -15; x < 155; x += 10) young.push({ x, z: 113.3, h: range(rand, 6, 8) })
  young.push({ x: -2, z: 208, h: 6.5 })
  for (let x = -16; x < 78; x += 12) young.push({ x, z: 97.5, h: range(rand, 6, 7.5) })
  // a few on the square and by MANA's bed
  young.push({ x: -22, z: 34, h: 7 }, { x: 60, z: 70, h: 7.5 }, { x: 64, z: 4, h: 7 }, { x: -16, z: 60, h: 7 }, { x: -24, z: 80, h: 7.5 })
  {
    const [tx, tz] = at(zf + 4.5, -14.5)
    young.push({ x: tx, z: tz, h: 6.5 })
  }
  // and the park's trees
  for (let i = 0; i < 16; i++) bare.push({ x: range(rand, -10, 70), z: range(rand, 120, 180), h: range(rand, 10, 16) })
  addForest(THREE, scene, low ? bare.filter((_, i) => i % 2 === 0) : bare, { species: 'lime', season: 'winter', seed: 7, quality: q })
  addForest(THREE, scene, low ? young.filter((_, i) => i % 2 === 0) : young, { species: 'plane', season: 'winter', seed: 9, quality: q })
  const fresh = [
    { x: -10, z: 205, h: 9 },
    { x: 66, z: 206, h: 10 },
    { x: 8, z: 140, h: 11 },
    { x: 86, z: 124, h: 9 },
    { x: 82, z: 143, h: 8 },
    { x: 60, z: 150, h: 10 },
    { x: 214, z: 60, h: 8 },
    { x: 214, z: 130, h: 9 },
    { x: 205, z: 160, h: 6 },
    { x: 205, z: 48, h: 5 },
  ]
  addForest(THREE, scene, fresh, { species: 'birch', season: 'summer', seed: 3, quality: q })
  addWillow(THREE, scene, 2, 201, rand, { low })

  /* street furniture ------------------------------------------------------------------------------- */
  const lamps = []
  for (let x = -20; x <= 70; x += 22) lamps.push({ x, z: -34.8, r: Math.PI / 2 }, { x, z: 95, r: -Math.PI / 2 })
  for (let z = -20; z <= 90; z += 22) lamps.push({ x: -27.5, z }, { x: 76, z, r: Math.PI })
  for (let z = -120; z <= 240; z += 26) lamps.push({ x: 173.5, z, r: 0 }, { x: 173.5, z: z + 0.01, r: Math.PI })
  for (let z = 122; z <= 240; z += 24) lamps.push({ x: -28.6, z })
  addLampPosts(THREE, scene, lamps, { height: 8 })
  const bins = []
  for (const [x, z] of [
    [16, 74],
    [-20, 30],
    [40, 45],
    [-28, 160],
    [60, 196.5],
    [74, 111.5],
    [189, 92],
  ])
    bins.push({ x, z, w: 1, h: 1, d: 1 })
  instBoxes(THREE, scene, bins, new THREE.MeshStandardMaterial({ color: 0x2b2c2e, metalness: 0.5, roughness: 0.45 }), { geo: new THREE.CylinderGeometry(0.28, 0.28, 1.05, 12).translate(0, 0.525, 0) })
  const bollards = []
  for (let x = -18; x < 76; x += 2.4) bollards.push({ x, z: 96.6, w: 0.14, h: 0.8, d: 0.14 })
  for (let z = -30; z < 94; z += 2.4) bollards.push({ x: -29.2, z, w: 0.14, h: 0.8, d: 0.14 })
  instBoxes(THREE, scene, bollards, darkMetal)
  addBikes(
    THREE,
    scene,
    [
      { x: -6, z: 72, len: 14, dir: Math.PI / 2 },
      { x: 17, z: 74, len: 12, dir: Math.PI / 2 },
      { x: 30, z: -32.5, len: 16, dir: 0 },
      { x: -21, z: 150, len: 10, dir: Math.PI / 2, fill: 0.7 },
      { x: 192, z: 70, len: 14, dir: Math.PI / 2 },
      { x: 120, z: 112, len: 12, dir: 0 },
    ].slice(0, low ? 3 : 6),
    rand
  )
  // the no-parking sign and the blue street sign on the south street (photo 3)
  {
    const pole = (x, z, h) => batch.box(new THREE.MeshStandardMaterial({ color: 0xc9cbcd, metalness: 0.7, roughness: 0.35 }), 0.07, h, 0.07, x, 0, z, [1, 1])
    pole(86, 109.2, 2.9)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshStandardMaterial({ map: signTexture(THREE, 'disc'), roughness: 0.5 }))
    disc.position.set(86, 2.55, 109.15)
    disc.rotation.y = Math.PI
    scene.add(disc)
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshStandardMaterial({ map: signTexture(THREE, 'plate', 'Kerkstraat'), roughness: 0.5, side: THREE.DoubleSide }))
    plate.position.set(86.5, 3.05, 109.2)
    scene.add(plate)
    pole(-36, 96.6, 3.2)
    const plate2 = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshStandardMaterial({ map: signTexture(THREE, 'plate', 'Emmasingel'), roughness: 0.5, side: THREE.DoubleSide }))
    plate2.position.set(-36, 3.0, 96.5)
    plate2.rotation.y = Math.PI / 2
    scene.add(plate2)
  }
  // traffic: cars on the Mathildelaan and the Vestdijk, buses in their lanes
  const cars = []
  for (let z = -140; z < 240; z += range(rand, 8, 18)) {
    if (rand() > 0.6 || (z > 80 && z < 120)) continue
    const south = rand() < 0.5
    cars.push({ x: south ? 165 : 182, z, r: south ? Math.PI / 2 : -Math.PI / 2 })
  }
  for (let x = -150; x < 155; x += range(rand, 8, 18)) {
    if (rand() > 0.55 || Math.abs(x - 12) < 9) continue
    const east = rand() < 0.5
    cars.push({ x, z: east ? -40.5 : -45.5, r: east ? 0 : Math.PI })
  }
  for (const x of [-34, 40]) cars.push({ x, z: 102, r: 0 })
  addCars(THREE, scene, low ? cars.filter((_, i) => i % 2 === 0) : cars, rand)
  addBuses(THREE, scene, [
    { x: 171.15, z: 30, r: Math.PI / 2 },
    { x: 175.85, z: -70, r: -Math.PI / 2 },
  ])

  batch.build(scene)

  /* light, the flight in, the viewpoints --------------------------------------------------------- */
  world.focusShadows(V(60, 0, 90), 160)

  const spots = [
    // 0 · the start (photo 1): the runners' path through the park, the white hall, its canopy, the willow
    { pos: V(22, 1.6, 180), look: V(24, 9, 224) },
    // 1 · the brick promenade between old bare trees, looking north to the centre (photo 2)
    { pos: V(-24, 1.7, 199.5), look: V(-20, 9, 110) },
    // 2 · the brick pavement of the south street, young trees, the gridded office tower (photo 3)
    { pos: V(55, 1.7, 110.4), look: V(110, 16, 140) },
    // 3 · on the Vestdijk's cycle lane by the Lightyards hoarding (photo 4)
    { pos: V(185.5, 1.6, 104), look: V(205, 4, 84) },
    // 4 · 18 Septemberplein: the white Tube entrance left, the Bubble right, towers ahead (photo 5)
    { pos: V(22, 1.7, 86), look: V(26, 15, -40) },
    // 5 · the Admirant's blue glass and skybridge over the Mathildelaan, the graffiti Tube right (photo 6)
    { pos: V(44, 1.7, -14), look: V(8, 11, -62) },
    // 6 · the Blob: MANA's door in the white skin, the planted bed in front (photo 7)
    { pos: V(21, 1.6, 26.5), look: V(1, 8, 2) },
    // 7 · inside: the café under the glass lattice (photos 8–13)
    { pos: V(8, 13.85, 6), look: V(-8, 14.5, -6) },
  ]
  const end = spots[0]
  const path = {
    positions: [V(170, 170, -130), V(95, 75, 55), V(42, 26, 128), V(22, 4.5, 160), end.pos.clone()],
    targets: [V(0, 10, 0), V(10, 8, 100), V(22, 8, 200), V(24, 7, 222), end.look.clone()],
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
