/**
 * Erasmus University Rotterdam, campus Woudestein — Ayesha's graduation, on a
 * soft, overcast early-autumn day.
 *
 * Built from her photographs: the bronze Erasmus (reading his book, in his
 * fur-collared gown and cap) on a low bronze plinth, on pale polygonal stone
 * paving, with a row of concrete benches and a clipped hedge behind him and
 * tall dark trees; the Erasmus Building — the 1960s–70s high-rise slab with
 * its strong horizontal concrete bands and ribbon windows, "ERASMUS
 * UNIVERSITEIT" across the top and the teal script logo on the roof; the
 * campus heart in front of it: a rectangular pond with a round coping, wide
 * concrete sitting steps between terraced hedges rising to a raised deck;
 * the modern glass Polak building above the steps; the Sanders building with
 * "THE ERASMIAN WAY" across its dark glass band; the white-finned Mandeville
 * tower; trees turning, bikes everywhere.
 *
 * Metres. The pond is at the origin; north (the Erasmus Building) is −Z.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'
import { createWorld, waterMaterial, addTrees } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { beamBatch, seeded, range, pick } from '../utils.js'
import { makeKit } from './interior.js'

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

/* --- textures specific to Woudestein ---------------------------------------- */

/** Pale polygonal stone paving (irregular pentagons/hexagons), 4 m tile. */
function polyPaving(THREE, S, { tile = 4, cells = 7, color = [0.8, 0.75, 0.67], joint = [0.47, 0.44, 0.39], seed = 3 } = {}) {
  const P = []
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) P.push([(i + 0.12 + 0.76 * hash(i, j, seed)) / cells, (j + 0.12 + 0.76 * hash(i, j, seed + 1)) / cells])
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      const ci = Math.floor(u * cells)
      const cj = Math.floor(v * cells)
      let d1 = 9
      let d2 = 9
      let ax = 0
      let ay = 0
      let bx = 0
      let by = 0
      let id = 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di
          const jj = cj + dj
          const wi = ((ii % cells) + cells) % cells
          const wj = ((jj % cells) + cells) % cells
          const q = P[wj * cells + wi]
          const qx = q[0] + (ii - wi) / cells
          const qy = q[1] + (jj - wj) / cells
          const d = (qx - u) * (qx - u) + (qy - v) * (qy - v)
          if (d < d1) {
            d2 = d1
            bx = ax
            by = ay
            d1 = d
            ax = qx
            ay = qy
            id = wj * cells + wi
          } else if (d < d2) {
            d2 = d
            bx = qx
            by = qy
          }
        }
      }
      const e = ((d2 - d1) / (2 * Math.hypot(bx - ax, by - ay) + 1e-6)) * tile // metres to the joint
      const n = fbm(u, v, 6, 3, seed + 4)
      const grit = hash(Math.floor(u * 1013), Math.floor(v * 1009), seed)
      if (e < 0.007) {
        const k = 0.85 + n * 0.3
        p.r = joint[0] * k
        p.g = joint[1] * k
        p.b = joint[2] * k
        p.h = 0.2
        p.ro = 0.95
        return
      }
      const k = (0.92 + hash(id, 1, seed) * 0.14) * (0.9 + n * 0.2) + (grit - 0.5) * 0.08
      p.r = color[0] * k
      p.g = color[1] * k * (0.99 + hash(id, 2, seed) * 0.02)
      p.b = color[2] * k
      p.h = 0.45 + 0.35 * sstep(0.007, 0.03, e) + (grit - 0.5) * 0.04
      p.ro = 0.78 + grit * 0.12
    },
    { normal: 2.2 }
  )
}

/** Clipped hedge: small leaves, deep gaps between them. */
function hedgeTex(THREE, S, { color = [0.2, 0.3, 0.13], seed = 7 } = {}) {
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      const a = fbm(u, v, 40, 2, seed)
      const b = fbm(u, v, 6, 3, seed + 3)
      const leaf = sstep(0.38, 0.62, a)
      const k = (0.45 + leaf * 0.75) * (0.85 + b * 0.3)
      p.r = color[0] * k * (0.9 + hash(Math.floor(u * 97), Math.floor(v * 89), seed) * 0.25)
      p.g = color[1] * k
      p.b = color[2] * k
      p.h = 0.2 + leaf * 0.7
      p.ro = 0.7 + (1 - leaf) * 0.25
    },
    { normal: 3 }
  )
}

/** Bronze with a mottled verdigris patina, darker in the folds. */
function bronzeTex(THREE, S, seed = 13) {
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      const n = fbm(u, v, 18, 4, seed)
      const m = fbm(u, v, 7, 3, seed + 2)
      const g = sstep(0.38, 0.7, n * 0.7 + m * 0.5)
      const streak = fbm(u * 0.3, v, 24, 2, seed + 6)
      p.r = 0.16 + g * 0.1 - streak * 0.04
      p.g = 0.15 + g * 0.24 - streak * 0.03
      p.b = 0.12 + g * 0.2 - streak * 0.02
      p.h = 0.5 + (n - 0.5) * 0.5
      p.ro = 0.48 + g * 0.3
      p.me = 0.75 - g * 0.55
    },
    { normal: 2.5 }
  )
}

/* --- the statue of Erasmus ---------------------------------------------------- */

/** Erasmus reading, in gown, fur collar and cap: one merged geometry, faces +Z. */
function statueGeometry(THREE) {
  const parts = []
  const up = new THREE.Vector3(0, 1, 0)
  // the gown: a lathe, heavy folds at the hem, flattened front to back
  const prof = [
    [0.0, 0.0],
    [0.5, 0.0],
    [0.56, 0.06],
    [0.53, 0.25],
    [0.47, 0.7],
    [0.42, 1.1],
    [0.38, 1.45],
    [0.4, 1.72],
    [0.36, 1.9],
    [0.18, 2.02],
    [0.0, 2.04],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const gown = new THREE.LatheGeometry(prof, 28)
  {
    const pos = gown.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      const a = Math.atan2(z, x)
      // vertical folds, deeper toward the hem
      const fold = 1 + Math.sin(a * 9) * 0.045 * (1 - Math.min(1, y / 1.6)) + Math.sin(a * 5 + 1) * 0.02
      pos.setXYZ(i, x * fold, y, z * fold * 0.78)
    }
    gown.computeVertexNormals()
  }
  parts.push(gown)
  // fur collar draped over the shoulders and down the front
  const collar = new THREE.TorusGeometry(0.29, 0.09, 8, 22)
  collar.rotateX(Math.PI / 2)
  collar.scale(1.05, 1, 0.82)
  collar.translate(0, 1.93, 0.02)
  parts.push(collar)
  for (const sx of [-1, 1]) {
    const lapel = new THREE.CylinderGeometry(0.075, 0.1, 0.9, 8)
    lapel.translate(0, -0.45, 0)
    lapel.rotateZ(sx * 0.12)
    lapel.translate(sx * 0.16, 1.92, 0.26)
    parts.push(lapel)
  }
  const head = new THREE.SphereGeometry(0.135, 16, 12)
  head.scale(1, 1.18, 1.02)
  head.translate(0, 2.17, 0.05)
  parts.push(head)
  const nose = new THREE.ConeGeometry(0.025, 0.07, 6)
  nose.rotateX(Math.PI / 2)
  nose.translate(0, 2.15, 0.19)
  parts.push(nose)
  // the soft cap
  const cap = new THREE.CylinderGeometry(0.17, 0.15, 0.1, 18)
  cap.translate(0, 2.33, 0.03)
  parts.push(cap)
  const brim = new THREE.TorusGeometry(0.155, 0.035, 6, 18)
  brim.rotateX(Math.PI / 2)
  brim.translate(0, 2.29, 0.03)
  parts.push(brim)
  // sleeves bent to hold the book
  const limb = (a, b, r0, r1) => {
    const A = new THREE.Vector3(...a)
    const B = new THREE.Vector3(...b)
    const len = A.distanceTo(B)
    const g = new THREE.CylinderGeometry(r1, r0, len, 10)
    g.translate(0, len / 2, 0)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, B.clone().sub(A).normalize()))
    g.translate(A.x, A.y, A.z)
    parts.push(g)
  }
  limb([-0.36, 1.86, 0], [-0.33, 1.45, 0.12], 0.12, 0.14)
  limb([-0.33, 1.45, 0.12], [-0.12, 1.5, 0.42], 0.15, 0.13)
  limb([0.36, 1.86, 0], [0.32, 1.5, 0.14], 0.12, 0.14)
  limb([0.32, 1.5, 0.14], [0.08, 1.56, 0.42], 0.15, 0.12)
  for (const [x, y, z] of [
    [-0.1, 1.5, 0.44],
    [0.06, 1.6, 0.42],
  ]) {
    const hand = new THREE.SphereGeometry(0.055, 8, 6)
    hand.translate(x, y, z)
    parts.push(hand)
  }
  // the open book, tilted up toward his face
  for (const sx of [-1, 1]) {
    const leaf = new THREE.BoxGeometry(0.22, 0.04, 0.3)
    leaf.translate(sx * 0.11, 0, 0)
    leaf.rotateZ(-sx * 0.12)
    leaf.rotateX(-0.75)
    leaf.translate(-0.02, 1.55, 0.44)
    parts.push(leaf)
  }
  return mergeGeometries(parts, false)
}


/* --- the central hall of the Erasmus Building (ayesha-02) ---------------------- */

/** The colourful fused-glass frieze on the first-floor balustrade: a long strip. */
function friezeCanvas(W, H, rand) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#1b1a1c'
  g.fillRect(0, 0, W, H)
  const cols = ['#d23a2e', '#e8892b', '#f2c230', '#2f7fc1', '#1f4f9a', '#6a3f98', '#2e9a5a', '#c43c7a', '#e6e1d4', '#7fb6d9']
  let x = 0
  while (x < W) {
    const w = range(rand, 0.25, 0.7) * H
    // a little stained-glass panel: stacked blocks and a disc
    let y = 0
    while (y < H) {
      const h = range(rand, 0.15, 0.45) * H
      g.fillStyle = pick(rand, cols)
      g.fillRect(x + 2, y + 2, w - 4, h - 4)
      y += h
    }
    if (rand() < 0.5) {
      g.fillStyle = pick(rand, cols)
      g.beginPath()
      g.arc(x + w / 2, range(rand, 0.25, 0.75) * H, w * 0.28, 0, Math.PI * 2)
      g.fill()
    }
    x += w + range(rand, 0.02, 0.2) * H
  }
  return c
}

/** A hanging typographic banner (no faces: the hall's banners are printed text). */
function bannerCanvas(W, H) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#0d2236'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#f2c230'
  g.fillRect(0, H * 0.72, W, H * 0.28)
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.font = `700 ${Math.round(W * 0.16)}px "Helvetica Neue", Arial, sans-serif`
  g.fillText('MAKE IT', W / 2, H * 0.3)
  g.fillText('HAPPEN.', W / 2, H * 0.46)
  g.font = `400 ${Math.round(W * 0.06)}px "Helvetica Neue", Arial, sans-serif`
  g.fillText('Erasmus University Rotterdam', W / 2, H * 0.6)
  g.fillStyle = '#0d2236'
  g.font = `italic 400 ${Math.round(W * 0.13)}px "Brush Script MT", "Segoe Script", cursive`
  g.fillText('Erasmus', W / 2, H * 0.88)
  return c
}

/** Info-booth panels: white and navy with a big blue curve and a line of text. */
function boothCanvas(W, H, text) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#f4f4f2'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#1f3e8f'
  g.beginPath()
  g.arc(W * 0.1, H * 0.55, W * 0.55, -0.8, 1.2)
  g.lineTo(0, H)
  g.fill()
  g.fillStyle = '#5aa0e0'
  g.beginPath()
  g.arc(W * 0.95, H * 0.95, W * 0.3, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ffffff'
  g.font = `800 ${Math.round(W * 0.11)}px "Helvetica Neue", Arial, sans-serif`
  text.split('\n').forEach((t, i) => g.fillText(t, W * 0.08, H * 0.2 + i * W * 0.12))
  return c
}

/**
 * The great hall: dark polished marble floor, board-marked concrete balconies
 * on two levels round three sides, a deep red slatted ceiling 12 m up, a wall
 * of tall windows on the east, the Polyhedral Netstructure (white polyhedra on
 * white rods) in the middle, a coffee bar, an info booth, a red poster stand.
 * H = { x0, x1, z0, z1, h }; the glazed entrance end is z1 (south).
 */
function buildHallInterior(THREE, ctx, scene, H, rand) {
  const K = makeKit(THREE, ctx)
  const low = K.low
  const S = low ? 256 : 512
  const hall = new THREE.Group()
  scene.add(hall)
  const B = K.batcher()
  const frames = beamBatch(THREE)
  const glassGeos = []
  const { slab, box, rbox, cyl, rod, std } = K
  const W = H.x1 - H.x0
  const D = H.z1 - H.z0
  const BAL = 3.2 // balcony depth
  const LV = [4.2, 8.2] // balcony floor levels

  /* materials */
  const marbleSet = pbr(THREE, S, S, (u, v, p) => {
    // 1.2 m tile: 4 courses of 0.3 m, stones 0.6 m long, running bond
    const row = Math.floor(v * 4)
    const uu = u * 2 + (row % 2) * 0.5
    const col = Math.floor(uu)
    const fx = uu - col
    const fy = v * 4 - row
    const id = row * 7 + (((col % 2) + 2) % 2) * 13 + col * 3
    const vein = fbm(u * 0.7 + hash(id, 1, 4) * 0.3, v, 9, 4, 11)
    const ve = Math.abs(vein - 0.5) < 0.018 ? 1 : 0
    const tone = 0.85 + hash(id, 2, 4) * 0.3
    const n = fbm(u, v, 14, 3, 9)
    p.r = (0.2 + n * 0.07) * tone + ve * 0.16
    p.g = (0.18 + n * 0.06) * tone + ve * 0.15
    p.b = (0.165 + n * 0.05) * tone + ve * 0.14
    const joint = fx < 0.006 || fx > 0.994 || fy < 0.012 || fy > 0.988
    p.h = joint ? 0.3 : 0.6
    p.ro = joint ? 0.6 : 0.1 + n * 0.08
    if (joint) {
      p.r *= 0.6
      p.g *= 0.6
      p.b *= 0.6
    }
  }, { normal: 1.2 })
  const floorMat = pbrMat(THREE, marbleSet, { metalness: 0, envMapIntensity: 1.2 })
  const board = pbr(THREE, S, S, (u, v, p) => {
    // board-marked concrete: horizontal boards 15 cm, grain, tie holes
    const b = Math.floor(v * 8)
    const fv = v * 8 - b
    const n = fbm(u, v, 8, 3, 21)
    const grain = fbm(u * 0.15, v * 8, 30, 2, 22 + b)
    const k = 0.9 + n * 0.12 + (grain - 0.5) * 0.08 + hash(b, 1, 5) * 0.05
    p.r = 0.74 * k
    p.g = 0.68 * k
    p.b = 0.58 * k
    p.h = 0.5 + (grain - 0.5) * 0.3 - (fv < 0.03 ? 0.25 : 0)
    p.ro = 0.85
    const tx = (u * 4) % 1
    const ty = (v * 2) % 1
    if (Math.hypot(tx - 0.5, (ty - 0.5) * 0.5) < 0.02) {
      p.r *= 0.55
      p.g *= 0.55
      p.b *= 0.55
      p.h = 0.2
    }
  }, { normal: 1.6 })
  const concrete = pbrMat(THREE, board, { metalness: 0 })
  const redSet = pbr(THREE, low ? 128 : 256, low ? 128 : 256, (u, v, p) => {
    // a deep red slatted ceiling: slats 8 cm, shadow gaps
    const f = (u * 16) % 1
    const n = fbm(u, v, 6, 2, 31)
    const gap = f > 0.86
    p.r = gap ? 0.16 : 0.62 + n * 0.06
    p.g = gap ? 0.02 : 0.05
    p.b = gap ? 0.03 : 0.07
    p.h = gap ? 0.1 : 0.6 + Math.sin(f * Math.PI) * 0.2
    p.ro = 0.6
  }, { normal: 2 })
  const redCeil = pbrMat(THREE, redSet, { metalness: 0 })
  const woodMat = K.wood('#8a5b37', { rough: 0.55 })
  const dark = std('#202124', 0.5, 0.4)
  const white = std('#f3f2ee', 0.45, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(0.2, 0.2) })
  const glass = K.glassMaterial(2.5)
  const steel = std('#2b2d30', 0.4, 0.7)

  /* shell */
  B.add(floorMat, slab(H.x0, H.x1, -0.3, 0.06, H.z0, H.z1, 1.2))
  B.add(concrete, slab(H.x0 - 0.4, H.x0, 0, H.h + 0.6, H.z0 - 0.4, H.z1, 2.4))
  B.add(concrete, slab(H.x0 - 0.4, H.x1 + 0.3, 0, H.h + 0.6, H.z0 - 0.4, H.z0, 2.4))
  B.add(redCeil, K.quad(
    [
      [H.x0, H.h, H.z0],
      [H.x1, H.h, H.z0],
      [H.x1, H.h, H.z1],
      [H.x0, H.h, H.z1],
    ],
    [
      [0, 0],
      [W / 1.6, 0],
      [W / 1.6, D / 1.6],
      [0, D / 1.6],
    ],
    new THREE.Vector3(0, -1, 0)
  ), false)
  B.add(concrete, slab(H.x0 - 0.4, H.x1 + 0.3, H.h, H.h + 0.6, H.z0 - 0.4, H.z1 + 0.2, 2.4)) // the roof slab
  // the east wall: a warm timber base, a band, then tall windows to the roof
  const BASE = 2.8
  B.add(woodMat, slab(H.x1, H.x1 + 0.25, 0, BASE, H.z0, H.z1, 1.2))
  B.add(concrete, slab(H.x1 - 0.05, H.x1 + 0.3, BASE, BASE + 0.5, H.z0, H.z1, 2.4))
  for (let z = H.z0 + 0.6; z <= H.z1 - 0.5; z += 1.8) frames.add(new THREE.Vector3(H.x1 + 0.1, BASE + 0.5, z), new THREE.Vector3(H.x1 + 0.1, H.h, z), 0.16, 0.08)
  for (const y of [5.6, 8.6, H.h - 0.1]) frames.add(new THREE.Vector3(H.x1 + 0.1, y, H.z0), new THREE.Vector3(H.x1 + 0.1, y, H.z1), 0.12, 0.08)
  {
    const g = new THREE.PlaneGeometry(D, H.h - BASE - 0.5)
    g.rotateY(-Math.PI / 2)
    g.translate(H.x1 + 0.12, (H.h + BASE + 0.5) / 2, (H.z0 + H.z1) / 2)
    glassGeos.push(g)
  }
  // glazed doors into the timber base
  for (const zc of [H.z0 + 10, H.z0 + 26]) {
    B.add(dark, slab(H.x1 - 0.02, H.x1 + 0.05, 0, 2.6, zc - 1.25, zc + 1.25, 1))
    const g = new THREE.PlaneGeometry(2.3, 2.4)
    g.rotateY(-Math.PI / 2)
    g.translate(H.x1 - 0.03, 1.25, zc)
    glassGeos.push(g)
    frames.add(new THREE.Vector3(H.x1 - 0.04, 0, zc), new THREE.Vector3(H.x1 - 0.04, 2.5, zc), 0.05, 0.06)
  }
  // the glazed entrance end (south)
  for (let x = H.x0 + 2.2; x < H.x1; x += 2.2) frames.add(new THREE.Vector3(x, 0, H.z1), new THREE.Vector3(x, H.h, H.z1), 0.1, 0.18)
  for (const y of [0.05, 3.0, 7.0, H.h - 0.1]) frames.add(new THREE.Vector3(H.x0, y, H.z1), new THREE.Vector3(H.x1, y, H.z1), 0.18, 0.12)
  {
    const g = new THREE.PlaneGeometry(W, H.h)
    g.translate((H.x0 + H.x1) / 2, H.h / 2, H.z1)
    glassGeos.push(g)
  }
  // balconies on two levels along the west wall and the north end, with
  // deep concrete balustrade fascias and square columns at their edge
  for (const y of LV) {
    B.add(concrete, slab(H.x0, H.x0 + BAL, y - 0.35, y, H.z0, H.z1 - 1.5, 2.4))
    B.add(concrete, slab(H.x0, H.x1, y - 0.35, y, H.z0, H.z0 + BAL, 2.4))
    B.add(floorMat, slab(H.x0, H.x0 + BAL, y, y + 0.01, H.z0, H.z1 - 1.5, 1.2))
    B.add(concrete, slab(H.x0 + BAL, H.x0 + BAL + 0.25, y - 0.5, y + 1.05, H.z0 + BAL, H.z1 - 1.5, 2.4))
    B.add(concrete, slab(H.x0 + BAL, H.x1, y - 0.5, y + 1.05, H.z0 + BAL, H.z0 + BAL + 0.25, 2.4))
    // dark doorways and office glazing at the back of each level
    for (let z = H.z0 + 5; z < H.z1 - 4; z += 6) B.add(dark, slab(H.x0 + 0.001, H.x0 + 0.03, y + 0.05, y + 2.4, z, z + 2.2, 1))
  }
  for (let z = H.z1 - 4; z > H.z0 + BAL; z -= 7.2) B.add(concrete, slab(H.x0 + BAL - 0.05, H.x0 + BAL + 0.6, 0, H.h, z - 0.35, z + 0.35, 2.4))
  for (const x of [H.x0 + BAL + 7.2, H.x0 + BAL + 14.4]) B.add(concrete, slab(x - 0.35, x + 0.35, 0, H.h, H.z0 + BAL - 0.05, H.z0 + BAL + 0.6, 2.4))
  // the frieze of coloured glass on the first-floor balustrade (Frishert)
  {
    const fc = friezeCanvas(low ? 2048 : 4096, 128, rand)
    const t = new THREE.CanvasTexture(fc)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.2, metalness: 0, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35 })
    const g = new THREE.PlaneGeometry(D - BAL - 3, 1.0)
    g.rotateY(Math.PI / 2)
    g.translate(H.x0 + BAL + 0.26, LV[0] + 0.45, (H.z0 + BAL + H.z1 - 1.5) / 2)
    B.add(m, g, false)
  }
  // ceiling spots: small black cans
  {
    const cans = []
    for (let x = H.x0 + 2; x < H.x1; x += 4) for (let z = H.z0 + 3; z < H.z1; z += 6) cans.push([x, z])
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 12), dark, cans.length)
    const m4 = new THREE.Matrix4()
    cans.forEach(([x, z], i) => im.setMatrixAt(i, m4.makeTranslation(x, H.h - 0.11, z)))
    im.instanceMatrix.needsUpdate = true
    hall.add(im)
  }
  // the far banner, hanging between the levels
  {
    const t = new THREE.CanvasTexture(bannerCanvas(512, 640))
    t.colorSpace = THREE.SRGBColorSpace
    const g = new THREE.PlaneGeometry(3.6, 4.5)
    g.translate((H.x0 + H.x1) / 2 + 1.2, 6.4, H.z0 + BAL + 0.4)
    B.add(new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }), g, false)
    for (const dx of [-1.7, 1.7]) frames.add(new THREE.Vector3((H.x0 + H.x1) / 2 + 1.2 + dx, 8.65, H.z0 + BAL + 0.4), new THREE.Vector3((H.x0 + H.x1) / 2 + 1.2 + dx, H.h, H.z0 + BAL + 0.4), 0.01, 0.01)
  }
  // the coffee bar under the north balcony: counter, a lit back bar, a menu board
  {
    const cx = H.x0 + BAL + 6.5
    const cz = H.z0 + 1.6
    B.add(woodMat, slab(cx - 3, cx + 3, 0, 1.05, cz + 0.6, cz + 1.2, 1))
    B.add(dark, slab(cx - 3.05, cx + 3.05, 1.05, 1.1, cz + 0.55, cz + 1.25, 1))
    const glow = new THREE.MeshStandardMaterial({ color: 0x101214, emissive: 0xcfe6ee, emissiveIntensity: 0.9, roughness: 0.2 })
    B.add(glow, slab(cx - 2.8, cx + 2.8, 0.9, 2.2, H.z0 + 0.02, H.z0 + 0.3, 1), false)
    B.add(white, slab(cx - 3.2, cx + 3.2, 2.6, 3.1, H.z0 + 0.02, H.z0 + 0.6, 1))
  }
  // the info booth (blue and white panels) with two high stools
  {
    const t = new THREE.CanvasTexture(boothCanvas(512, 768, 'UNLOCK\nYOUR\nPOTENTIAL'))
    t.colorSpace = THREE.SRGBColorSpace
    const pm = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 })
    const bx = H.x0 + BAL + 1.4
    const bz = H.z1 - 12
    B.add(white, slab(bx - 0.05, bx + 0.05, 0, 2.5, bz - 1.1, bz + 1.1, 1))
    const g = new THREE.PlaneGeometry(2.2, 2.5)
    g.rotateY(Math.PI / 2)
    g.translate(bx + 0.06, 1.25, bz)
    B.add(pm, g, false)
    B.add(std('#1f3e8f', 0.6), slab(bx, bx + 2.0, 0, 2.5, bz - 1.25, bz - 1.15, 1))
    B.add(white, slab(bx + 0.4, bx + 1.6, 1.0, 1.05, bz - 0.4, bz + 0.4, 1))
    for (const dz of [-0.3, 0.3]) {
      B.add(steel, cyl(0.02, 0.02, 0.78, 8).translate(bx + 1.9, 0.39, bz + dz))
      B.add(dark, cyl(0.17, 0.17, 0.05, 20).translate(bx + 1.9, 0.8, bz + dz))
      B.add(steel, cyl(0.18, 0.2, 0.02, 20).translate(bx + 1.9, 0.01, bz + dz))
    }
  }
  // a red poster stand by the windows, bins
  {
    const pc = document.createElement('canvas')
    pc.width = 256
    pc.height = 384
    const g = pc.getContext('2d')
    g.fillStyle = '#d32a2a'
    g.fillRect(0, 0, 256, 384)
    g.fillStyle = '#ffd400'
    g.font = '800 30px "Helvetica Neue", Arial, sans-serif'
    ;['THESIS', 'WEEK', '2024'].forEach((t, i) => g.fillText(t, 22, 70 + i * 38))
    g.fillStyle = '#ffffff'
    g.font = '500 16px "Helvetica Neue", Arial, sans-serif'
    for (let i = 0; i < 6; i++) g.fillRect(22, 220 + i * 20, 120 + (i % 3) * 30, 6)
    const t = new THREE.CanvasTexture(pc)
    t.colorSpace = THREE.SRGBColorSpace
    const sx = H.x1 - 1.4
    const sz = H.z0 + 13
    const pg = new THREE.PlaneGeometry(0.9, 1.35)
    pg.rotateY(-Math.PI / 2 + 0.25)
    pg.translate(sx, 1.25, sz)
    B.add(new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }), pg, false)
    B.add(white, tf3(THREE, box(0.95, 1.45, 0.03), [sx + 0.02, 1.25, sz], -Math.PI / 2 + 0.25))
    B.add(white, slab(sx - 0.25, sx + 0.25, 0, 0.03, sz - 0.25, sz + 0.25, 1))
    B.add(white, rod([sx + 0.03, 0, sz], [sx + 0.03, 0.55, sz], 0.02))
    for (let i = 0; i < 3; i++) B.add(std(['#3a6fb0', '#d9852b', '#4a8a3c'][i], 0.5), slab(H.x0 + 0.1, H.x0 + 0.6, 0, 1.0, H.z1 - 6 - i * 0.55, H.z1 - 5.55 - i * 0.55, 1))
  }

  /* the Polyhedral Netstructure: white truncated octahedra on a net of white rods */
  {
    const sc = new THREE.Vector3((H.x0 + H.x1) / 2 - 0.5, 0, H.z1 - 13)
    B.add(std('#55585c', 0.6), slab(sc.x - 0.8, sc.x + 0.8, 0, 1.15, sc.z - 0.8, sc.z + 0.8, 1))
    const pts = []
    for (const a of [-1, 1]) for (const b of [-2, 2]) {
      pts.push(new THREE.Vector3(0, a, b), new THREE.Vector3(0, b, a), new THREE.Vector3(a, 0, b), new THREE.Vector3(b, 0, a), new THREE.Vector3(a, b, 0), new THREE.Vector3(b, a, 0))
    }
    const unit = new ConvexGeometry(pts)
    unit.scale(0.3, 0.3, 0.3)
    const nodes = [
      [0.2, 4.0, 0.3, 1.0],
      [-1.2, 5.6, -0.5, 1.1],
      [1.0, 6.4, 0.8, 1.15],
      [-0.2, 7.9, -0.2, 1.05],
      [1.4, 8.6, -0.9, 0.95],
      [-1.4, 3.4, 1.0, 0.9],
    ]
    const sculptMat = std('#f1f0ec', 0.38)
    for (const [x, y, z, k] of nodes) {
      const g = unit.clone()
      g.rotateY(rand() * 3)
      g.rotateX(rand() * 0.6)
      g.scale(k, k, k)
      g.translate(sc.x + x, y, sc.z + z)
      B.add(sculptMat, g)
    }
    const rods = beamBatch(THREE)
    const P = (n) => new THREE.Vector3(sc.x + n[0], n[1], sc.z + n[2])
    // rods tie the nodes together and shoot out past them into the air
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      if (rand() < 0.45) continue
      const a = P(nodes[i])
      const b = P(nodes[j])
      const dir = b.clone().sub(a).normalize()
      rods.add(a.clone().addScaledVector(dir, -range(rand, 0.4, 1.6)), b.clone().addScaledVector(dir, range(rand, 0.4, 2.4)), 0.045, 0.045)
    }
    for (let i = 0; i < 4; i++) rods.add(new THREE.Vector3(sc.x + range(rand, -0.3, 0.3), 1.15, sc.z + range(rand, -0.3, 0.3)), P(nodes[i]), 0.05, 0.05)
    hall.add(rods.build(sculptMat))
  }

  hall.add(frames.build(steel))
  {
    const g = K.batcher()
    for (const gg of glassGeos) g.add(glass, gg, false)
    g.build(hall)
  }
  B.build(hall)
  hall.traverse((o) => {
    if (o.isMesh) o.receiveShadow = true
  })

  /* the hall's own light probe: red ceiling, beige concrete, a wall of daylight */
  {
    const room = { x0: H.x0, x1: H.x1, y0: 0, y1: H.h, z0: H.z0, z1: H.z1 }
    const P0 = new THREE.Vector3((H.x0 + H.x1) / 2 + 2, 3.5, (H.z0 + H.z1) / 2)
    const Q = new THREE.Vector3()
    const env = K.probe(low ? 96 : 192, low ? 48 : 96, (d) => {
      const { t, face } = K.roomHit(P0, d, room)
      Q.copy(P0).addScaledVector(d, t)
      const sky = [0.75 + d.y * 0.3, 0.85 + d.y * 0.3, 1.0 + d.y * 0.4]
      if (face === 'x+') return Q.y > BASE + 0.5 ? sky : [0.22, 0.14, 0.09]
      if (face === 'z+') return Q.y > 0.3 ? [sky[0] * 0.9, sky[1] * 0.9, sky[2] * 0.9] : [0.3, 0.3, 0.28]
      if (face === 'y+') return [0.28, 0.025, 0.03]
      if (face === 'y-') return [0.05, 0.04, 0.035]
      return [0.3, 0.27, 0.22]
    })
    K.applyEnv(hall, env)
  }
  // a little warm fill from the ceiling cans
  for (const z of [H.z0 + 8, H.z0 + 22, H.z0 + 34]) {
    const pl = new THREE.PointLight(0xffd7a8, 9, 14, 2)
    pl.position.set((H.x0 + H.x1) / 2 + 3, 5.5, z)
    scene.add(pl)
  }
}

/** Transform helper: position and a yaw. */
function tf3(THREE, g, p, ry) {
  g.rotateY(ry)
  g.translate(p[0], p[1], p[2])
  return g
}

/* --- the place ----------------------------------------------------------------- */

export function buildErasmus(THREE, ctx) {
  // a fine early-autumn day with a clear blue sky (the photographer's wish),
  // whatever the photos' own pale skies say
  ctx.sky = null
  const world = createWorld(THREE, ctx, 'day', {
    sun: { elevation: 36, azimuth: 330 },
    sunIntensity: 2.3,
    fog: { density: 0.0006 },
    sky: { zenith: 0x3f7fd0, horizon: 0xbcd6ee, clouds: 0.3 },
  })
  const { scene } = world
  const low = ctx.quality === 'low'
  const S = low ? 256 : 512
  const s2 = low ? 128 : 256
  const rand = seeded(1913)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const batch = makeBatch(THREE)

  /* materials ----------------------------------------------------------------- */
  const lawn = M.lawn(THREE, { color: '#5b6f37', worn: 0.15, tile: 3, quality: 'low', seed: 21 })
  const asphalt = M.asphalt(THREE, { color: '#3b3c3e', tile: 6, quality: 'low' })
  const deckFlags = M.paving(THREE, { kind: 'flags', color: '#a8a59e', joint: '#5c5a55', unit: 0.6, tile: 4, quality: ctx.quality, seed: 31 })
  const stepConcrete = M.concrete(THREE, { color: '#a49c8f', tile: 3, ties: false, quality: ctx.quality, seed: 5 })
  const ebConcrete = M.concrete(THREE, { color: '#9e917e', tile: 4, ties: false, quality: ctx.quality, seed: 8 })
  const wood = M.planks(THREE, { color: '#6d5a45', width: 0.09, tile: 2, quality: 'low', seed: 4 })
  const polySet = polyPaving(THREE, S, { seed: 3, color: [0.76, 0.7, 0.6] })
  const poly = pbrMat(THREE, polySet, { metalness: 0 })
  const hedge = pbrMat(THREE, hedgeTex(THREE, s2), { metalness: 0 })
  const bronze = pbrMat(THREE, bronzeTex(THREE, s2), { envMapIntensity: 0.9 })
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.7, roughness: 0.38 })
  const soil = new THREE.MeshStandardMaterial({ color: 0x3a3127, roughness: 1 })

  // the Erasmus Building: beige-brown concrete bands, ribbon windows, blinds
  const ebTile = [7.2, 13.6]
  const ebFacade = pbrMat(
    THREE,
    facadeTex(THREE, S, {
      tile: ebTile,
      cols: 6,
      rows: 4,
      wall: [0.6, 0.55, 0.48],
      win: [0, 1, 0.47, 0.94],
      frame: [0.36, 0.34, 0.31],
      fw: 0.07,
      glass: [0.3, 0.35, 0.34],
      blinds: 0.35,
      blindColor: [0.82, 0.8, 0.74],
      seed: 4,
    }),
    { envMapIntensity: 1.1 }
  )
  const ebCore = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [6, 13.6], cols: 1, rows: 4, wall: [0.6, 0.55, 0.48], win: [0.08, 0.22, 0.3, 0.9], frame: [0.3, 0.29, 0.27], fw: 0.06, glass: [0.26, 0.3, 0.31], blinds: 0, joints: true, seed: 6 }),
    { envMapIntensity: 1.0 }
  )
  const lobbyGlass = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [7.2, 7], cols: 4, rows: 1, wall: [0.2, 0.2, 0.21], win: [0, 1, 0, 1], frame: [0.22, 0.22, 0.23], fw: 0.06, transom: 0.52, glass: [0.22, 0.26, 0.28], blinds: 0, seed: 9 }),
    { envMapIntensity: 1.0 }
  )
  // Polak: square windows in deep dark frames, a modern grid
  const polak = pbrMat(
    THREE,
    facadeTex(THREE, S, { tile: [7.2, 8], cols: 4, rows: 2, wall: [0.28, 0.29, 0.3], wallRough: 0.5, win: [0.05, 0.95, 0.12, 0.96], frame: [0.18, 0.19, 0.2], fw: 0.09, mull: 1, glass: [0.42, 0.5, 0.56], blinds: 0.12, joints: true, seed: 12 }),
    { envMapIntensity: 1.2 }
  )
  // Sanders: a dark glass band above a glazed ground floor
  const sanders = pbrMat(
    THREE,
    facadeTex(THREE, S, { tile: [6, 8], cols: 4, rows: 2, wall: [0.2, 0.21, 0.22], wallRough: 0.4, win: [0, 1, 0.08, 1], frame: [0.55, 0.56, 0.57], fw: 0.05, glass: [0.17, 0.2, 0.23], spandrel: [0, 0.18, [0.12, 0.13, 0.14]], blinds: 0.05, seed: 14 }),
    { envMapIntensity: 1.2 }
  )
  const sandersGround = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [6, 4.5], cols: 2, rows: 1, wall: [0.3, 0.3, 0.31], win: [0.02, 0.98, 0.0, 0.95], frame: [0.25, 0.25, 0.26], fw: 0.06, transom: 0.7, glass: [0.3, 0.33, 0.35], blinds: 0, seed: 15 }),
    { envMapIntensity: 1.0 }
  )
  // Tinbergen-like: brown-grey precast panels, paired windows
  const tinbergen = pbrMat(
    THREE,
    facadeTex(THREE, S, { tile: [6.4, 7.2], cols: 2, rows: 2, wall: [0.5, 0.45, 0.4], win: [0.14, 0.86, 0.3, 0.84], frame: [0.24, 0.24, 0.25], fw: 0.07, mull: 2, glass: [0.33, 0.4, 0.45], blinds: 0.2, joints: true, seed: 17 }),
    { envMapIntensity: 1.1 }
  )
  // Mandeville: white vertical fins against blue glass
  const mandeville = pbrMat(
    THREE,
    facadeTex(THREE, S, { tile: [6, 7.6], cols: 2, rows: 2, wall: [0.86, 0.86, 0.84], wallRough: 0.5, win: [0.22, 1, 0.0, 1], frame: [0.3, 0.33, 0.37], fw: 0.05, glass: [0.28, 0.4, 0.55], spandrel: [0.0, 0.14, [0.18, 0.24, 0.32]], blinds: 0.08, seed: 19 }),
    { envMapIntensity: 1.2 }
  )
  // housing and offices beyond the campus
  const cityBrick = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [12, 12], cols: 4, rows: 4, wall: [0.47, 0.3, 0.24], win: [0.2, 0.8, 0.22, 0.82], frame: [0.85, 0.84, 0.8], fw: 0.07, mull: 2, glass: [0.25, 0.3, 0.33], blinds: 0.25, seed: 23 }),
    { envMapIntensity: 0.9 }
  )
  const cityGrey = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [12, 12], cols: 4, rows: 4, wall: [0.68, 0.66, 0.62], win: [0.12, 0.88, 0.3, 0.86], frame: [0.3, 0.3, 0.32], fw: 0.06, mull: 3, glass: [0.27, 0.32, 0.36], blinds: 0.2, seed: 24 }),
    { envMapIntensity: 0.9 }
  )
  const towerGlass = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [12, 16], cols: 8, rows: 4, wall: [0.2, 0.22, 0.24], win: [0.04, 0.96, 0.24, 0.98], frame: [0.3, 0.32, 0.34], fw: 0.05, glass: [0.3, 0.37, 0.43], blinds: 0.05, seed: 25 }),
    { envMapIntensity: 1.1 }
  )

  /* the ground ----------------------------------------------------------------- */
  scene.add(flat(THREE, 4000, 4000, lawn, 3, 0, 0, 0))
  const campusPave = flat(THREE, 250, 230, poly, 4, 0, 0.04, -35)
  scene.add(campusPave)
  // roads: Burgemeester Oudlaan (west, with the tram), and one to the south
  const road = (w, d, x, z) => scene.add(flat(THREE, w, d, asphalt, 6, x, 0.05, z))
  road(16, 1400, -150, 0)
  road(1400, 12, 0, 104)
  road(12, 600, 160, -100)
  // pavements, with a kerb on the road side
  for (const [x, z, w, d, kx, kz] of [
    [-140.5, 0, 3, 1400, -142, 0],
    [-159.5, 0, 3, 1400, -158, 0],
    [0, 96.5, 1400, 3, 0, 98],
    [0, 111.5, 1400, 3, 0, 110],
  ]) {
    scene.add(flat(THREE, w, d, deckFlags, 4, x, 0.08, z))
    batch.box(stepConcrete, w === 3 ? 0.18 : w, 0.13, d === 3 ? 0.18 : d, kx || x, 0, kz || z, [3, 3])
  }
  // tram rails and overhead wires on the Oudlaan
  const rails = beamBatch(THREE)
  for (const x of [-152.7, -151.3, -148.7, -147.3]) rails.add(V(x, 0.05, -700), V(x, 0.05, 700), 0.07, 0.04)
  for (let z = -300; z <= 300; z += 30) {
    rails.add(V(-150, 0, z), V(-150, 6.6, z), 0.2)
    rails.add(V(-154, 6.4, z), V(-146, 6.4, z), 0.08)
  }
  for (const x of [-152, -148]) rails.add(V(x, 6.0, -300), V(x, 6.0, 300), 0.025)
  scene.add(rails.build(new THREE.MeshStandardMaterial({ color: 0x4a4c50, metalness: 0.8, roughness: 0.35 })))

  /* the pond, the sitting steps, the terraces, the deck ------------------------- */
  const pondW = 40
  const pondD = 16
  const pondPal = { ...world.light, water: { deep: 0x252e2b, shallow: 0x4a5752, stroke: 0xf2f1ee } }
  const water = waterMaterial(THREE, { palette: pondPal, scale: 0.1, strokes: 0.12 })
  const pond = new THREE.Mesh(new THREE.PlaneGeometry(pondW, pondD), water)
  pond.rotation.x = -Math.PI / 2
  pond.position.set(0, 0.22, 0)
  scene.add(pond)
  // rim: a low concrete wall with a rounded coping
  for (const [w, d, x, z] of [
    [pondW + 0.8, 0.4, 0, pondD / 2 + 0.2],
    [pondW + 0.8, 0.4, 0, -pondD / 2 - 0.2],
    [0.4, pondD, pondW / 2 + 0.2, 0],
    [0.4, pondD, -pondW / 2 - 0.2, 0],
  ]) batch.box(stepConcrete, w, 0.38, d, x, 0, z, [3, 3])
  const coping = new THREE.MeshStandardMaterial({ color: 0xc9c6bf, roughness: 0.45, metalness: 0.1 })
  for (const [len, x, z, ry] of [
    [pondW + 0.8, 0, pondD / 2 + 0.2, 0],
    [pondW + 0.8, 0, -pondD / 2 - 0.2, 0],
    [pondD + 0.8, pondW / 2 + 0.2, 0, Math.PI / 2],
    [pondD + 0.8, -pondW / 2 - 0.2, 0, Math.PI / 2],
  ]) {
    const g = new THREE.CylinderGeometry(0.16, 0.16, len, 12)
    g.rotateZ(Math.PI / 2)
    batch.add(coping, g, x, 0.42, z, ry)
  }
  // reeds and flowering plants along the north edge of the pond
  {
    // clumps of thin arching blades (one merged clump, instanced), not boxes
    const blades = []
    const br = seeded(19)
    for (let i = 0; i < 18; i++) {
      const a = br() * Math.PI * 2
      const h = range(br, 0.6, 1.0)
      const lean = range(br, 0.1, 0.5)
      const g = new THREE.PlaneGeometry(0.03, h, 1, 3)
      const pp = g.attributes.position
      for (let k = 0; k < pp.count; k++) {
        const y = pp.getY(k) + h / 2
        pp.setY(k, y)
        pp.setZ(k, Math.pow(y / h, 2) * lean * h)
      }
      g.rotateY(a)
      g.translate(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06)
      blades.push(g.toNonIndexed())
    }
    const clump = mergeGeometries(blades, false)
    clump.computeVertexNormals()
    const tufts = []
    for (let i = 0; i < (low ? 40 : 90); i++) {
      const k = range(rand, 0.6, 1.3)
      tufts.push({ x: range(rand, -19.5, 19.5), z: range(rand, -7.9, -6.8), y: 0.2, w: k, h: k, d: k, r: rand() * 6 })
    }
    instBoxes(THREE, scene, tufts, new THREE.MeshStandardMaterial({ color: 0x6b7a38, roughness: 0.85, side: THREE.DoubleSide }), { geo: clump })
  }

  const deck = { x0: -34, x1: 34, z0: -56, z1: -16.2, h: 3.6 }
  // twelve wide sitting steps, 30 cm rise, 60 cm deep
  for (let i = 0; i < 12; i++) batch.box(stepConcrete, 28, 0.3 * (i + 1), 0.6, 0, 0, -9 - 0.6 * i - 0.3, [3, 3])
  // the terraces either side: a tier of lawn with a clipped hedge along its edge
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const cx = side * 22
      const z = -9 - 1.2 * i - 0.6
      batch.box(lawn, 16, 0.6 * (i + 1), 1.2, cx, 0, z, [3, 3])
      batch.box(hedge, 16, 0.42, 0.55, cx, 0.6 * (i + 1), z + 0.3, [1.5, 1.5])
    }
  }
  // the deck: a low pavilion whose roof is the upper campus
  batch.box(deckFlags, deck.x1 - deck.x0, deck.h, deck.z1 - deck.z0, 0, 0, (deck.z0 + deck.z1) / 2, [4, 4])
  // its glazed sides at ground level
  batch.box(lobbyGlass, 0.3, 3.4, deck.z1 - deck.z0 - 2, deck.x0 - 0.1, 0, (deck.z0 + deck.z1) / 2, [7.2, 7])
  batch.box(lobbyGlass, 0.3, 3.4, deck.z1 - deck.z0 - 2, deck.x1 + 0.1, 0, (deck.z0 + deck.z1) / 2, [7.2, 7])
  batch.box(lobbyGlass, deck.x1 - deck.x0 - 2, 3.4, 0.3, 0, 0, deck.z0 - 0.1, [7.2, 7])
  // pebble-dash parapets round the deck's open edges
  const pebble = ebConcrete
  batch.box(pebble, deck.x1 - deck.x0, 1.05, 0.35, 0, deck.h, deck.z0 + 0.2, [1.5, 1.5])
  batch.box(pebble, 0.35, 1.05, deck.z1 - deck.z0 - 10, deck.x0 + 0.2, deck.h, (deck.z0 + deck.z1) / 2 - 5, [1.5, 1.5])
  batch.box(pebble, 0.35, 1.05, deck.z1 - deck.z0 - 10, deck.x1 - 0.2, deck.h, (deck.z0 + deck.z1) / 2 - 5, [1.5, 1.5])
  // wooden deck benches and dark plant boxes up top (photo 3)
  for (const [x, z] of [
    [-27.2, -54.6],
    [-2, -53.5],
    [26, -26],
  ]) {
    batch.box(darkMetal, 1.4, 1.1, 1.4, x, deck.h, z, [1, 1])
    batch.box(wood, 2.6, 0.45, 0.6, x + 2.4, deck.h, z, [2, 2])
  }

  /* the Polak building, on the deck above the steps ------------------------------ */
  {
    const x0 = -34
    const x1 = -4
    const z0 = -48
    const z1 = -26
    const h = 16
    const g = boxGeo(THREE, x1 - x0, h, z1 - z0, [7.2, 8])
    const mesh = new THREE.Mesh(g, polak)
    mesh.position.set((x0 + x1) / 2, deck.h, (z0 + z1) / 2)
    mesh.castShadow = mesh.receiveShadow = true
    scene.add(mesh)
    // a thin roof edge and a recessed, glazed ground storey
    batch.box(darkMetal, x1 - x0 + 0.6, 0.5, z1 - z0 + 0.6, (x0 + x1) / 2, deck.h + h, (z0 + z1) / 2, [2, 2])
  }

  /* a five-storey brown precast block on the deck behind the steps (photo 6) ------- */
  {
    const x0 = -3
    const x1 = 36
    const z0 = -50
    const z1 = -36
    const h = 17
    const mesh = new THREE.Mesh(boxGeo(THREE, x1 - x0, h, z1 - z0, [6.4, 7.2]), tinbergen)
    mesh.position.set((x0 + x1) / 2, deck.h, (z0 + z1) / 2)
    mesh.castShadow = mesh.receiveShadow = true
    scene.add(mesh)
    batch.box(ebConcrete, x1 - x0 + 0.5, 0.7, z1 - z0 + 0.5, (x0 + x1) / 2, deck.h + h, (z0 + z1) / 2, [4, 4])
    // a glazed stair tower on its west end
    batch.box(lobbyGlass, 4, h + 1.5, 5, x0 - 1.6, deck.h, z1 - 4, [7.2, 7])
  }
  // the sunken courtyard between the deck and the Erasmus Building: a glass
  // roof light with a red edge (seen over the parapet in photo 3)
  {
    const gx0 = -40
    const gx1 = -21
    batch.box(lobbyGlass, gx1 - gx0, 2.4, 5.5, (gx0 + gx1) / 2, 0, -61, [7.2, 7])
    batch.box(new THREE.MeshStandardMaterial({ color: 0xb21f24, roughness: 0.5 }), gx1 - gx0 + 0.3, 0.25, 5.8, (gx0 + gx1) / 2, 2.4, -61, [2, 2])
    const roof = new THREE.Mesh(new THREE.BoxGeometry(gx1 - gx0, 0.06, 5.5), new THREE.MeshStandardMaterial({ color: 0x1d2a30, roughness: 0.05, metalness: 0.9 }))
    roof.position.set((gx0 + gx1) / 2, 2.68, -61)
    scene.add(roof)
  }

  /* the Erasmus Building ---------------------------------------------------------- */
  const EB = { x0: -46.8, x1: 46.8, z0: -82, z1: -66, base: 7, storey: 3.4, storeys: 16 }
  const ebTop = EB.base + EB.storey * EB.storeys
  {
    const L = EB.x1 - EB.x0
    const D = EB.z1 - EB.z0
    const body = new THREE.Mesh(boxGeo(THREE, L, ebTop - EB.base, D, ebTile), [ebCore, ebCore, ebConcrete, ebConcrete, ebFacade, ebFacade])
    body.position.set(0, EB.base, (EB.z0 + EB.z1) / 2)
    body.castShadow = body.receiveShadow = true
    scene.add(body)
    // the deep horizontal concrete bands, proud of the windows, on both long faces
    for (let s = 0; s < EB.storeys; s++) {
      const y = EB.base + s * EB.storey - 0.2
      for (const z of [EB.z1 + 0.18, EB.z0 - 0.18]) batch.box(ebConcrete, L + 0.4, 1.78, 0.36, 0, y, z, [4, 4])
    }
    // end cores, solid, with a column of narrow windows near the corner
    for (const x of [EB.x0 - 2.4, EB.x1 + 2.4]) {
      const core = new THREE.Mesh(boxGeo(THREE, 5, ebTop + 2, D + 2, [6, 13.6]), ebCore)
      core.position.set(x, 0, (EB.z0 + EB.z1) / 2)
      core.castShadow = core.receiveShadow = true
      scene.add(core)
    }
    // parapet and the plant room on the roof
    batch.box(ebConcrete, L + 0.8, 2.2, D + 0.8, 0, ebTop, (EB.z0 + EB.z1) / 2, [4, 4])
    batch.box(ebConcrete, 28, 4.5, 9, -6, ebTop + 2.2, (EB.z0 + EB.z1) / 2, [4, 4])
    // the podium: two recessed glazed storeys behind a colonnade
    batch.box(lobbyGlass, L - 4, EB.base - 0.6, D - 6, 0, 0, (EB.z0 + EB.z1) / 2, [7.2, 7])
    const cols = []
    for (let x = EB.x0 + 3.6; x < EB.x1; x += 7.2) for (const z of [EB.z0 + 0.6, EB.z1 - 0.6]) cols.push({ x, z, y: 0, w: 0.9, h: EB.base, d: 0.9 })
    instBoxes(THREE, scene, cols, ebConcrete)
    // a projecting canopy band over the entrance
    batch.box(ebConcrete, 40, 0.6, 5, 0, 4.2, EB.z1 + 2, [4, 4])
    // "ERASMUS UNIVERSITEIT" across the top band, the teal script on the roof
    const name = lettering(THREE, 'ERASMUS UNIVERSITEIT', { w: 46, h: 3.2, font: '600 {px}px "Helvetica Neue", Arial, sans-serif', color: '#2b3f4f', px: 200 })
    name.position.set(4, ebTop + 1.1, EB.z1 + 0.5)
    scene.add(name)
    const logo = lettering(THREE, 'Erasmus', { w: 30, h: 9, font: 'italic 400 {px}px "Brush Script MT", "Segoe Script", "Snell Roundhand", cursive', color: '#3f9fb0', px: 220, emissive: 0.25 })
    logo.position.set(-6, ebTop + 2.2 + 4.5, EB.z1 - 2)
    scene.add(logo)
  }

  /* Sanders — "THE ERASMIAN WAY" ----------------------------------------------------- */
  {
    const x0 = 44
    const x1 = 86
    const z0 = -16
    const z1 = 24
    const mesh = new THREE.Mesh(boxGeo(THREE, x1 - x0, 8, z1 - z0, [6, 8]), sanders)
    mesh.position.set((x0 + x1) / 2, 4.5, (z0 + z1) / 2)
    mesh.castShadow = mesh.receiveShadow = true
    scene.add(mesh)
    // the glazed ground storey, set back under the band
    batch.box(sandersGround, x1 - x0 - 3, 4.5, z1 - z0 - 3, (x0 + x1) / 2 + 1, 0, (z0 + z1) / 2, [6, 4.5])
    batch.box(darkMetal, x1 - x0 + 0.4, 0.4, z1 - z0 + 0.4, (x0 + x1) / 2, 12.5, (z0 + z1) / 2, [2, 2])
    const cols = []
    for (let z = z0 + 2; z < z1; z += 6) cols.push({ x: x0 + 1.2, z, w: 0.5, h: 4.5, d: 0.5 })
    instBoxes(THREE, scene, cols, darkMetal)
    // the dark glass band: "THE ERASMIAN WAY" in wide white capitals, coloured
    // dots and a line drawing on the glass (photo 5)
    {
      const c = document.createElement('canvas')
      c.width = 4096
      c.height = 256
      const g = c.getContext('2d')
      g.fillStyle = '#16191c'
      g.fillRect(0, 0, 4096, 256)
      // reflections of the sky in the glazing, mullions every 1.3 m
      const grd = g.createLinearGradient(0, 0, 0, 256)
      grd.addColorStop(0, 'rgba(120,150,180,0.35)')
      grd.addColorStop(1, 'rgba(40,55,70,0.15)')
      g.fillStyle = grd
      g.fillRect(0, 0, 4096, 256)
      g.fillStyle = '#0a0b0c'
      for (let x = 0; x < 4096; x += 133) g.fillRect(x, 0, 6, 256)
      g.fillRect(0, 0, 4096, 10)
      g.fillRect(0, 246, 4096, 10)
      const dots = ['#2f86d6', '#e0452c', '#7a3fb0', '#f08a24', '#22a35a', '#2f86d6', '#e0452c']
      for (let i = 0; i < 16; i++) {
        g.fillStyle = dots[i % dots.length]
        g.beginPath()
        g.arc(80 + i * 250 + ((i * 97) % 90), 40 + ((i * 53) % 170), 22 + ((i * 31) % 22), 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = '#1fb36a'
      g.beginPath()
      g.moveTo(3500, 256)
      g.lineTo(3700, 120)
      g.lineTo(3780, 256)
      g.fill()
      g.strokeStyle = 'rgba(240,240,240,0.85)'
      g.lineWidth = 5
      g.beginPath()
      g.moveTo(3200, 230)
      g.bezierCurveTo(3260, 60, 3380, 60, 3420, 180)
      g.bezierCurveTo(3450, 250, 3330, 240, 3360, 120)
      g.stroke()
      g.fillStyle = '#f4f4f2'
      g.font = '500 150px "Helvetica Neue", Arial, sans-serif'
      g.textBaseline = 'middle'
      const word = 'THE  ERASMIAN  WAY'
      let x = 420
      for (const ch of word) {
        g.fillText(ch, x, 132)
        x += g.measureText(ch).width + 34
      }
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      const band = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0, 3.2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.12, metalness: 0.4, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.12 }))
      band.rotation.y = -Math.PI / 2
      band.position.set(x0 - 0.05, 8.7, (z0 + z1) / 2)
      scene.add(band)
    }
    // concrete bollards and a set of coloured recycling bins along the verge
    const bol = []
    for (let z = z0 - 6; z <= z1; z += 3.2) bol.push({ x: x0 - 3.2, z, w: 0.45, h: 0.6, d: 0.45 })
    instBoxes(THREE, scene, bol, stepConcrete)
    for (let i = 0; i < 3; i++) batch.box(new THREE.MeshStandardMaterial({ color: [0x8c9296, 0xd9692b, 0x3f8a3a][i], roughness: 0.5 }), 0.7, 1.25, 0.7, x0 - 2.0, 0, z0 + 2 + i * 0.75, [1, 1])
    // a bright info screen in the ground-floor glazing
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x1b6f62, emissive: 0x2e9c84, emissiveIntensity: 0.9, roughness: 0.3 })
    )
    screen.rotation.y = -Math.PI / 2
    screen.position.set(x0 + 1.4, 2.2, 14)
    scene.add(screen)
  }

  /* Tinbergen (brown precast), Mandeville (white fins), Theil (bands) ----------------- */
  {
    const t = new THREE.Mesh(boxGeo(THREE, 70.4, 18, 16, [6.4, 7.2]), tinbergen)
    t.position.set(80, 0, -50)
    t.castShadow = t.receiveShadow = true
    scene.add(t)
    batch.box(ebConcrete, 71, 1, 16.6, 80, 18, -50, [4, 4])
    const m = new THREE.Mesh(boxGeo(THREE, 24, 84, 24, [6, 7.6]), mandeville)
    m.position.set(110, 0, -92)
    m.castShadow = m.receiveShadow = true
    scene.add(m)
    batch.box(darkMetal, 24.6, 1.6, 24.6, 110, 84, -92, [2, 2])
    const theilMat = ebFacade.clone()
    theilMat.color = new THREE.Color(0xb7b4b0)
    // the long banded slab rising behind Sanders (photo 5)
    const sb = new THREE.Mesh(boxGeo(THREE, 16, 34, 66, ebTile), [ebFacade, ebFacade, ebConcrete, ebConcrete, ebCore, ebCore])
    sb.position.set(98, 0, 2)
    sb.castShadow = sb.receiveShadow = true
    scene.add(sb)
    batch.box(ebConcrete, 16.6, 1.6, 66.6, 98, 34, 2, [4, 4])
    const th = new THREE.Mesh(boxGeo(THREE, 50.4, 40.8, 15, ebTile), theilMat)
    th.position.set(-112, 0, -100)
    th.castShadow = th.receiveShadow = true
    scene.add(th)
    batch.box(ebConcrete, 51, 1.4, 15.6, -112, 40.8, -100, [4, 4])
    // low teaching wings closing the campus to the east and west
    const wingA = new THREE.Mesh(boxGeo(THREE, 16, 14.4, 64, [6.4, 7.2]), tinbergen)
    wingA.position.set(-108, 0, -20)
    wingA.castShadow = wingA.receiveShadow = true
    scene.add(wingA)
    const wingB = new THREE.Mesh(boxGeo(THREE, 36, 16, 26, [7.2, 8]), polak)
    wingB.position.set(-75, 0, -78)
    wingB.castShadow = wingB.receiveShadow = true
    scene.add(wingB)
  }

  /* the statue of Erasmus, with benches and a hedge behind ---------------------------- */
  const statueAt = V(-52, 0, 26)
  {
    const fig = new THREE.Mesh(statueGeometry(THREE), bronze)
    fig.scale.setScalar(1.12)
    fig.position.set(statueAt.x, 0.38, statueAt.z)
    fig.castShadow = fig.receiveShadow = true
    scene.add(fig)
    batch.box(bronze, 1.35, 0.3, 1.05, statueAt.x, 0.06, statueAt.z, [1, 1])
    batch.box(stepConcrete, 1.6, 0.06, 1.3, statueAt.x, 0, statueAt.z, [2, 2])
    const plaque = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), new THREE.MeshStandardMaterial({ color: 0x6f5a35, metalness: 0.85, roughness: 0.35 }))
    plaque.scale.set(1.6, 0.8, 1)
    plaque.position.set(statueAt.x, 0.21, statueAt.z + 0.53)
    scene.add(plaque)
    // the bench row: concrete legs, timber slats
    const legs = []
    const tops = []
    for (let i = 0; i < 7; i++) {
      const x = statueAt.x - 10.5 + i * 3.5
      legs.push({ x: x - 0.75, z: statueAt.z - 4.2, w: 0.42, h: 0.42, d: 0.5 }, { x: x + 0.75, z: statueAt.z - 4.2, w: 0.42, h: 0.42, d: 0.5 })
      tops.push({ x, y: 0.42, z: statueAt.z - 4.2, w: 2.1, h: 0.09, d: 0.52 })
    }
    instBoxes(THREE, scene, legs, stepConcrete)
    instBoxes(THREE, scene, tops, wood)
    batch.box(hedge, 30, 1.25, 1.1, statueAt.x, 0, statueAt.z - 5.6, [1.5, 1.5])
    // a lawn strip east of the statue with a pale path through it (photo 4)
    scene.add(flat(THREE, 7, 18, lawn, 3, -38.6, 0.055, statueAt.z + 4.5))
    const path = flat(THREE, 1.3, 19, deckFlags, 4, -38.2, 0.07, statueAt.z + 4.5)
    path.rotation.y = 0.32
    scene.add(path)
    batch.box(hedge, 1.1, 1.25, 12, statueAt.x - 15.5, 0, statueAt.z - 0.6, [1.5, 1.5])
    // beds behind, under the big trees
    batch.box(soil, 44, 0.12, 22, statueAt.x - 2, 0, statueAt.z - 18, [4, 4])
  }

  /* lawns, beds and hedges round the plaza ------------------------------------------- */
  for (const [x, z, w, d] of [
    [52, 52, 60, 20],
    [-6, 66, 70, 16],
    [-88, 40, 30, 56],
    [100, 10, 22, 70],
  ]) {
    batch.box(lawn, w, 0.14, d, x, 0, z, [3, 3])
    batch.box(stepConcrete, w + 0.3, 0.12, 0.15, x, 0, z + d / 2, [3, 3])
    batch.box(stepConcrete, w + 0.3, 0.12, 0.15, x, 0, z - d / 2, [3, 3])
  }
  // flower bed in front of Sanders (yellow, out of focus in photo 5)
  {
    // daffodil-like yellow heads on thin stems, leaves at the foot
    const stems = []
    const heads = []
    const fr = seeded(23)
    for (let i = 0; i < 3; i++) {
      const top = new THREE.Vector3(range(fr, -0.08, 0.08), range(fr, 0.55, 0.8), range(fr, -0.08, 0.08))
      const st = new THREE.CylinderGeometry(0.006, 0.008, 1, 5)
      st.translate(0, 0.5, 0)
      st.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().normalize()))
      st.scale(1, top.length(), 1)
      stems.push(st.toNonIndexed())
      const hd = new THREE.IcosahedronGeometry(0.045, 1)
      hd.scale(1, 0.6, 1)
      hd.translate(top.x, top.y, top.z)
      heads.push(hd)
    }
    for (let i = 0; i < 4; i++) {
      const lf = new THREE.PlaneGeometry(0.03, 0.35)
      lf.translate(0, 0.17, 0)
      lf.rotateX(range(fr, -0.3, 0.3))
      lf.rotateY(fr() * 3)
      stems.push(lf.toNonIndexed())
    }
    const stemGeo = mergeGeometries(stems, false)
    stemGeo.computeVertexNormals()
    const headGeo = mergeGeometries(heads, false)
    const fl = []
    for (let i = 0; i < (low ? 70 : 170); i++) {
      const k = range(rand, 0.8, 1.2)
      fl.push({ x: range(rand, 30, 40), y: 0.2, z: range(rand, -6, 10), w: k, h: k, d: k, r: rand() * 6 })
    }
    instBoxes(THREE, scene, fl, new THREE.MeshStandardMaterial({ color: 0x4f6b2a, roughness: 0.8, side: THREE.DoubleSide }), { cast: false, geo: stemGeo })
    instBoxes(THREE, scene, fl, new THREE.MeshStandardMaterial({ color: 0xf2bf2a, roughness: 0.6, emissive: 0x4a3008, emissiveIntensity: 0.35 }), { cast: false, geo: headGeo })
    batch.box(soil, 11, 0.2, 17, 35, 0, 2, [3, 3])
  }

  /* trees ---------------------------------------------------------------------------- */
  const tq = ctx.quality
  const big = []
  for (let i = 0; i < (low ? 9 : 16); i++) big.push({ x: statueAt.x + range(rand, -22, 10), z: statueAt.z - range(rand, 9, 28), h: range(rand, 15, 21) })
  for (let i = 0; i < (low ? 5 : 10); i++) big.push({ x: range(rand, -104, -76), z: range(rand, 14, 66), h: range(rand, 13, 19) })
  addForest(THREE, scene, big, { species: 'oak', season: 'summer', seed: 11, quality: tq })
  const autumn = []
  // a row of small turning trees behind the terraces (photo 6)
  for (const side of [-1, 1]) for (let i = side > 0 ? 2 : 0; i < 4; i++) autumn.push({ x: side * (17 + i * 4.2) + range(rand, -0.6, 0.6), y: deck.h, z: -19.5 + range(rand, -0.8, 0.8), h: range(rand, 6.5, 8.5) })
  autumn.push({ x: 28, y: deck.h, z: -52, h: 8 }, { x: 4, y: deck.h, z: -54, h: 7.5 }, { x: -8, y: deck.h, z: -22, h: 7 })
  // round the pond and along the paths
  for (const [x, z] of [
    [26, 30],
    [40, 34],
    [-28, 12],
    [-6, 28],
    [-14, 29],
    [62, 36],
    [78, 34],
    [92, 40],
    [108, -20],
    [108, 30],
    [-46, -60],
    [40, -60],
    [-47, -40],
    [-64, -10],
  ]) autumn.push({ x: x + range(rand, -1, 1), z: z + range(rand, -1, 1), h: range(rand, 8, 12) })
  addForest(THREE, scene, autumn, { species: 'lime', season: 'autumn', seed: 5, quality: tq })
  const planes = []
  for (let z = -220; z <= 220; z += 16) {
    if (rand() < 0.15) continue
    planes.push({ x: -139 + range(rand, -0.3, 0.3), z, h: range(rand, 14, 19) })
    planes.push({ x: -161 + range(rand, -0.3, 0.3), z, h: range(rand, 14, 19) })
  }
  for (let x = -130; x <= 220; x += 16) planes.push({ x, z: 95, h: range(rand, 12, 17) })
  addForest(THREE, scene, low ? planes.filter((_, i) => i % 2 === 0) : planes, { species: 'plane', season: 'autumn', seed: 9, quality: tq })
  // the Kralingse Bos and the park east of the campus: a far wood (cheap crowns)
  const wood2 = []
  for (let i = 0; i < (low ? 60 : 120); i++) {
    const x = range(rand, 170, 600)
    const z = range(rand, -500, 300)
    wood2.push({ x, z, h: range(rand, 14, 22) })
  }
  addTrees(THREE, scene, wood2, { seed: 4, leaf: [0x3f5428, 0x4d5f2c, 0x6e6a2e, 0x7a5a2a], autumn: true })

  /* bikes, lamps, bins ---------------------------------------------------------------- */
  addBikes(
    THREE,
    scene,
    [
      { x: 58, z: 30.5, len: 30, dir: 0 },
      { x: 58, z: 34, len: 30, dir: 0 },
      { x: 2, z: -61, len: 24, dir: 0, fill: 0.9 },
      { x: 30, z: -60, len: 22, dir: 0 },
      { x: -64, z: 2, len: 20, dir: Math.PI / 2 },
      { x: -40, z: 50, len: 18, dir: 0 },
      { x: 40, z: -36, len: 20, dir: Math.PI / 2 },
    ].slice(0, low ? 4 : 7),
    rand
  )
  const lamps = []
  for (let x = -40; x <= 40; x += 16) lamps.push({ x, z: 17 })
  for (let z = -6; z <= 40; z += 15) lamps.push({ x: 30, z, r: Math.PI })
  lamps.push({ x: -34, z: -6 }, { x: -34, z: 8 })
  for (let x = -100; x <= 120; x += 20) if (x < -78 || x > -50) lamps.push({ x, z: -60 })
  for (let z = -60; z <= 90; z += 25) lamps.push({ x: -136, z, r: Math.PI })
  addLampPosts(THREE, scene, lamps, { height: 6 })
  const bins = []
  for (const [x, z] of [
    [-44, 22],
    [14, 12],
    [-14, 12],
    [30, -2],
    [6, -58],
    [48, 28],
  ]) bins.push({ x, z, w: 0.55, h: 1.0, d: 0.55 })
  instBoxes(THREE, scene, bins, new THREE.MeshStandardMaterial({ color: 0x2c3a33, roughness: 0.5, metalness: 0.4 }))
  // plaza benches round the pond (concrete + timber)
  {
    const legs = []
    const tops = []
    for (const [x, z, r] of [
      [-12, 13, 0],
      [0, 13, 0],
      [12, 13, 0],
      [-26, -3, Math.PI / 2],
      [24, -3, Math.PI / 2],
      [8, 40, 0],
      [-24, 40, 0],
    ]) {
      const c = Math.cos(r)
      const s = Math.sin(r)
      legs.push({ x: x - c * 0.8, z: z + s * 0.8, w: 0.42, h: 0.42, d: 0.55, r }, { x: x + c * 0.8, z: z - s * 0.8, w: 0.42, h: 0.42, d: 0.55, r })
      tops.push({ x, y: 0.42, z, w: 2.2, h: 0.09, d: 0.55, r })
    }
    instBoxes(THREE, scene, legs, stepConcrete)
    instBoxes(THREE, scene, tops, wood)
  }

  /* the rest of Rotterdam, into the haze ------------------------------------------------- */
  {
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    // instanced blocks share UVs: about three facade tiles across each face
    const uvs = unit.attributes.uv.array
    for (let i = 0; i < uvs.length; i++) uvs[i] *= 3
    const mats = [cityBrick, cityGrey]
    const per = [[], []]
    for (let i = 0; i < (low ? 160 : 320); i++) {
      const x = range(rand, -700, 700)
      const z = range(rand, -700, 700)
      if (x > -175 && x < 165 && z > -170 && z < 120) continue // the campus
      if (x > 165 && x < 720 && z > -520 && z < 320) continue // the wood
      if (Math.abs(x + 150) < 16) continue
      per[i % 2].push({ x, z, w: range(rand, 20, 46), h: range(rand, 10, 28), d: range(rand, 12, 18), r: Math.floor(rand() * 2) * (Math.PI / 2) })
    }
    per.forEach((list, k) => instBoxes(THREE, scene, list, mats[k], { cast: false, geo: unit }))
    // the city's towers far off to the west
    const towers = []
    for (let i = 0; i < 14; i++) towers.push({ x: range(rand, -1100, -600), z: range(rand, -400, 250), w: range(rand, 24, 40), h: range(rand, 70, 160), d: range(rand, 20, 34) })
    instBoxes(THREE, scene, towers, towerGlass, { cast: false, geo: unit.clone() })
  }

  // the central hall of the Erasmus Building (photo 2), its glazed end to the south
  const HALL = { x0: -76, x1: -54, z0: -64, z1: -24, h: 12 }
  buildHallInterior(THREE, ctx, scene, HALL, seeded(77))
  // its outside: concrete, a parapet
  batch.box(ebConcrete, HALL.x1 - HALL.x0 + 1.4, 1.2, HALL.z1 - HALL.z0 + 1, (HALL.x0 + HALL.x1) / 2, HALL.h + 0.6, (HALL.z0 + HALL.z1) / 2, [4, 4])

  batch.build(scene)

  /* light, the flight in, the viewpoints ---------------------------------------------- */
  world.focusShadows(V(-20, 0, -30), 100)

  // One viewpoint per photograph (ayesha-01..07), in photo order; spots[0] is the hero.
  const spots = [
    // 0 · ayesha-01: square to the bronze Erasmus, the bench row, hedge and dark trees behind
    { pos: V(-50.0, 1.4, 30.3), look: V(-51.3, 2.2, 22) },
    // 1 · ayesha-02: inside the Erasmus Building's great hall: red ceiling, balconies left, tall windows right, the Polyhedral Netstructure
    { pos: V(-64.2, 1.5, -27.0), look: V(-65.4, 6.2, -64) },
    // 2 · ayesha-03: low on the deck's north edge, the Erasmus Building towering over the parapet
    { pos: V(-30, 3.6 + 1.25, -53), look: V(-12, 24, -70) },
    // 3 · ayesha-04: looking down at the polygonal paving and the lawn edge by the statue
    { pos: V(-43.0, 1.65, 32.0), look: V(-41.9, 0.0, 31.2) },
    // 4 · ayesha-05: low behind the yellow flowers, "THE ERASMIAN WAY" across Sanders, the slab behind
    { pos: V(29.0, 1.0, 6.0), look: V(44, 6.5, 0.5) },
    // 5 · ayesha-06: at the pond's south rim: water, terraces and steps, the brown block, the Erasmus tower
    { pos: V(0.5, 1.25, 9.6), look: V(0.5, 9.5, -60) },
    // 6 · ayesha-07: at the foot of the sitting steps, looking up to Polak's glass grid
    { pos: V(6.0, 1.3, -8.4), look: V(-12, 8.5, -32) },
  ]
  const end = spots[0]
  const path = {
    positions: [V(260, 150, 300), V(140, 80, 190), V(30, 32, 100), V(-36, 6, 52), end.pos.clone()],
    targets: [V(0, 20, -50), V(-20, 16, -20), V(-40, 8, 4), V(-46, 5, 2), end.look.clone()],
    fov: 50,
    near: 0.3,
    spots,
  }

  const groundAt = (x, z) => {
    if (x > deck.x0 && x < deck.x1 && z > deck.z0 && z < deck.z1) return deck.h
    if (z <= -9 && z > deck.z1 && Math.abs(x) < 30) return Math.min(deck.h, 0.3 * Math.ceil((-9 - z) / 0.6))
    return 0
  }

  return {
    scene,
    world,
    path,
    groundAt,
    clearance: 0.9,
    update(t) {
      water.userData.tick(t)
    },
  }
}
