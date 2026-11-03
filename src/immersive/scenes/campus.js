/**
 * TU/e campus, Eindhoven — graduation day, soft overcast light.
 *
 * Built from Kenneth's, Adriel's, Amara's and Alyssa's photographs: Atlas,
 * the main building — a long glass slab with dark spandrel bands and white
 * mullion caps, lifted on massive concrete pilotis with flared brackets under
 * a deep transfer beam (where the caps went up, photo kenneth-04); the
 * reflecting pool with the flags in front of it; the red "TU/e" letters on
 * the lawn; the concrete shelter on the green; MetaForum's glass box above
 * its grand steps; the old brick chimney beyond; trees, paths and a great
 * many bikes, and the green Dommel at the campus edge.
 *
 * Metres. Atlas's south face runs along z = −19; north is −Z.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createWorld, waterMaterial } from '../world.js'
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


/* --- textures specific to the TU/e campus ------------------------------------------ */

/**
 * Atlas's curtain wall: 1.35 m mullion bays, 3.75 m storeys, a dark spandrel
 * band with an aluminium cover at each floor, light glass, and short white
 * mullion caps staggered from storey to storey. Tile = 4 bays × 2 storeys.
 */
function atlasTex(THREE, S, seed = 41) {
  const bw = 1.35
  const sh = 3.75
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      const xm = u * bw * 4
      const ym = v * sh * 2
      const bay = Math.floor(xm / bw)
      const fx = xm - bay * bw
      const st = Math.floor(ym / sh)
      const fy = ym - st * sh
      const n = fbm(u, v, 6, 2, seed)
      const onMullion = fx < 0.055 || fx > bw - 0.055
      if (onMullion) {
        const capHigh = (bay + st) % 2 === 0
        const cap = capHigh ? fy > 2.05 && fy < 3.6 : fy > 0.95 && fy < 2.3
        if (cap) {
          p.r = p.g = p.b = 0.86
          p.h = 0.85
          p.ro = 0.35
          p.me = 0.3
          return
        }
        p.r = 0.24
        p.g = 0.25
        p.b = 0.26
        p.h = 0.6
        p.ro = 0.4
        p.me = 0.6
        return
      }
      if (fy < 0.95) {
        // floor zone: dark enamelled spandrel, a bright aluminium cover strip on top
        if (fy > 0.82) {
          p.r = 0.58
          p.g = 0.6
          p.b = 0.62
          p.h = 0.65
          p.ro = 0.3
          p.me = 0.8
          return
        }
        const k = 0.9 + n * 0.2
        p.r = 0.16 * k
        p.g = 0.17 * k
        p.b = 0.19 * k
        p.h = 0.5
        p.ro = 0.25
        p.me = 0.4
        return
      }
      const id = bay * 13 + st * 7
      const t = 0.92 + hash(id, 1, seed) * 0.16
      p.r = 0.44 * t
      p.g = 0.56 * t
      p.b = 0.66 * t
      p.h = 0.45
      p.ro = 0.03 + hash(id, 2, seed) * 0.07
      p.me = 1
      // ceiling lights and blinds deep inside, faintly, near the top of each pane
      if (fy > 3.35 && hash(id, 3, seed) < 0.5) {
        p.r *= 0.8
        p.g *= 0.8
        p.b *= 0.8
      }
    },
    { normal: 2 }
  )
}

/** Fritted glass: fine white horizontal lines over grey-green glass (MetaForum's box). */
function fritTex(THREE, S, seed = 43) {
  return pbr(
    THREE,
    S,
    S,
    (u, v, p) => {
      const xm = u * 6
      const ym = v * 6
      const fx = xm % 1.5
      const fy = ym % 3
      if (fx < 0.05 || fy < 0.06) {
        p.r = p.g = p.b = 0.3
        p.h = 0.6
        p.ro = 0.4
        p.me = 0.6
        return
      }
      const line = (ym * 12) % 1 < 0.42
      const id = Math.floor(xm / 1.5) * 7 + Math.floor(ym / 3) * 3
      const t = 0.92 + hash(id, 4, seed) * 0.16
      if (line) {
        p.r = 0.78 * t
        p.g = 0.8 * t
        p.b = 0.78 * t
        p.h = 0.47
        p.ro = 0.3
        p.me = 0.15
      } else {
        p.r = 0.34 * t
        p.g = 0.4 * t
        p.b = 0.4 * t
        p.h = 0.45
        p.ro = 0.05
        p.me = 1
      }
    },
    { normal: 1 }
  )
}

/* --- the red TU/e letters ------------------------------------------------------------- */

/** "TU/e" as extruded shapes, 2 m tall, standing on y = 0, reading along +X, facing +Z. */
function tueLetters(THREE) {
  const shapes = []
  const T = new THREE.Shape()
  T.moveTo(0, 1.62)
  T.lineTo(0, 2)
  T.lineTo(1.6, 2)
  T.lineTo(1.6, 1.62)
  T.lineTo(1.0, 1.62)
  T.lineTo(1.0, 0)
  T.lineTo(0.6, 0)
  T.lineTo(0.6, 1.62)
  T.closePath()
  shapes.push([T, 0])
  const U = new THREE.Shape()
  U.moveTo(0, 2)
  U.lineTo(0, 0.72)
  U.absarc(0.7, 0.72, 0.7, Math.PI, Math.PI * 2, false)
  U.lineTo(1.4, 2)
  U.lineTo(1.0, 2)
  U.lineTo(1.0, 0.72)
  U.absarc(0.7, 0.72, 0.3, 0, -Math.PI, true)
  U.lineTo(0.4, 2)
  U.closePath()
  shapes.push([U, 1.72])
  const slash = new THREE.Shape()
  slash.moveTo(0, -0.05)
  slash.lineTo(0.42, -0.05)
  slash.lineTo(1.25, 2.25)
  slash.lineTo(0.83, 2.25)
  slash.closePath()
  shapes.push([slash, 3.15])
  const e = new THREE.Shape()
  const R = 0.76
  const r = 0.4
  const gap = 0.7
  e.moveTo(R, 0)
  e.absarc(0, 0, R, 0, Math.PI * 2 - gap, false)
  e.lineTo(r * Math.cos(-gap), r * Math.sin(-gap))
  e.absarc(0, 0, r, -gap, -Math.PI, true)
  e.lineTo(r, 0)
  e.closePath()
  const eye = new THREE.Path()
  const a0 = Math.asin(0.15 / r)
  eye.moveTo(r * Math.cos(a0), 0.15)
  eye.absarc(0, 0, r, a0, Math.PI - a0, false)
  eye.closePath()
  e.holes.push(eye)
  shapes.push([e, 4.55])
  const geos = shapes.map(([s, x]) => {
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2, curveSegments: 16 })
    if (s === e) g.translate(0.76, 0.76, 0)
    g.translate(x, 0, -0.18)
    return g
  })
  const g = mergeGeometries(geos, false)
  g.translate(-3.04, 0, 0)
  return g
}

/** A flag on its pole, waving: { mesh, tick(t) }. */
function flag(THREE, paint, { x, z, h = 10, rot = 0, seed = 1 }) {
  const c = document.createElement('canvas')
  c.width = 192
  c.height = 128
  paint(c.getContext('2d'), 192, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const geo = new THREE.PlaneGeometry(2.4, 1.6, 10, 2)
  geo.translate(1.2, 0, 0)
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }))
  mesh.position.set(x, h - 0.9, z)
  mesh.rotation.y = rot
  mesh.castShadow = true
  const pos = geo.attributes.position
  const base = Float32Array.from(pos.array)
  return {
    mesh,
    tick(t) {
      for (let i = 0; i < pos.count; i++) {
        const px = base[i * 3]
        const k = px / 2.4
        pos.setZ(i, Math.sin(px * 2.2 - t * 3.1 + seed) * 0.16 * k + Math.sin(px * 4.1 - t * 4.7) * 0.05 * k)
      }
      pos.needsUpdate = true
    },
  }
}

/* --- the place --------------------------------------------------------------------------- */

export function buildCampus(THREE, ctx, { light = 'overcast' } = {}) {
  const world = createWorld(THREE, ctx, light, {
    sun: { elevation: 32, azimuth: 325 },
    fog: { density: 0.00115 },
  })
  const { scene } = world
  const low = ctx.quality === 'low'
  const q = ctx.quality
  const S = low ? 256 : 512
  const s2 = low ? 128 : 256
  const rand = seeded(1956)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const batch = makeBatch(THREE)

  /* materials -------------------------------------------------------------------------- */
  const tiles = M.paving(THREE, { kind: 'flags', color: '#a9a8a3', joint: '#6f6e6a', unit: 0.6, tile: 4, quality: q, seed: 6 })
  const lawn = M.lawn(THREE, { color: '#55703a', worn: 0.12, tile: 3, quality: q, seed: 10 })
  const asphalt = M.asphalt(THREE, { color: '#3d3e40', tile: 6, quality: 'low' })
  const concrete = M.concrete(THREE, { color: '#a8a39a', tile: 4, ties: true, quality: q, seed: 3 })
  const smooth = M.concrete(THREE, { color: '#bdb9b1', tile: 3, ties: false, quality: q, seed: 9 })
  const brick = M.brick(THREE, { color: '#7d3e2c', tile: 2, quality: 'low', seed: 4 })
  const wood = M.planks(THREE, { color: '#6d5a45', width: 0.09, tile: 2, quality: 'low', seed: 5 })
  const atlas = pbrMat(THREE, atlasTex(THREE, S), { envMapIntensity: 1.25 })
  const frit = pbrMat(THREE, fritTex(THREE, S), { envMapIntensity: 1.15 })
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2c2e31, metalness: 0.7, roughness: 0.38 })
  const lobbyGlass = pbrMat(
    THREE,
    facadeTex(THREE, s2, { tile: [7.5, 6.2], cols: 5, rows: 1, wall: [0.2, 0.2, 0.21], win: [0, 1, 0, 1], frame: [0.2, 0.21, 0.22], fw: 0.06, transom: 0.62, glass: [0.24, 0.28, 0.3], blinds: 0, seed: 51 }),
    { envMapIntensity: 1.0 }
  )
  const flux = pbrMat(THREE, facadeTex(THREE, s2, { tile: [7.2, 8], cols: 4, rows: 2, wall: [0.86, 0.86, 0.85], wallRough: 0.45, win: [0.08, 0.92, 0.28, 0.95], frame: [0.82, 0.83, 0.84], fw: 0.05, mull: 2, glass: [0.32, 0.4, 0.46], blinds: 0.3, seed: 52 }), { envMapIntensity: 1.1 })
  const gemini = pbrMat(THREE, facadeTex(THREE, s2, { tile: [7.2, 7.2], cols: 4, rows: 2, wall: [0.64, 0.63, 0.6], win: [0, 1, 0.42, 0.92], frame: [0.3, 0.3, 0.31], fw: 0.06, glass: [0.3, 0.35, 0.38], blinds: 0.3, seed: 53 }), { envMapIntensity: 1 })
  const vertigo = pbrMat(THREE, facadeTex(THREE, s2, { tile: [7.2, 7.2], cols: 4, rows: 2, wall: [0.68, 0.66, 0.62], win: [0.12, 0.88, 0.3, 0.86], frame: [0.25, 0.25, 0.26], fw: 0.06, glass: [0.28, 0.33, 0.36], blinds: 0.3, joints: true, seed: 54 }), { envMapIntensity: 1 })
  const hallFacade = pbrMat(THREE, facadeTex(THREE, s2, { tile: [6, 5.5], cols: 2, rows: 1, wall: [0.44, 0.24, 0.18], win: [0.05, 0.95, 0.35, 0.9], frame: [0.18, 0.18, 0.19], fw: 0.06, mull: 3, glass: [0.26, 0.3, 0.33], blinds: 0.1, seed: 55 }), { envMapIntensity: 1 })
  const cityMat = pbrMat(THREE, facadeTex(THREE, s2, { tile: [12, 12], cols: 4, rows: 4, wall: [0.62, 0.6, 0.56], win: [0.1, 0.9, 0.25, 0.85], frame: [0.3, 0.3, 0.3], fw: 0.06, mull: 2, glass: [0.28, 0.33, 0.37], blinds: 0.2, seed: 56 }), { envMapIntensity: 0.9 })
  const red = new THREE.MeshPhysicalMaterial({ color: 0xc8102e, roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12 })

  /* the ground ------------------------------------------------------------------------- */
  scene.add(flat(THREE, 4000, 4000, lawn, 3, 0, 0, 0))
  scene.add(flat(THREE, 330, 100, tiles, 4, 30, 0.04, -40))
  scene.add(flat(THREE, 40, 160, tiles, 4, 85, 0.04, 70))
  scene.add(flat(THREE, 30, 160, tiles, 4, -80, 0.04, 70))
  // the central green with crossing paths
  batch.box(lawn, 116, 0.09, 60, 0, 0, 30, [3, 3])
  batch.box(smooth, 116.4, 0.12, 0.2, 0, 0, 0, [3, 3])
  for (const [x0, z0, x1, z1] of [
    [-58, 60, 58, 2],
    [-58, 6, 40, 60],
    [0, 0, 0, 60],
  ]) {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const g = new THREE.PlaneGeometry(3, len)
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 3) / 4, (uv.getY(i) * len) / 4)
    g.rotateX(-Math.PI / 2)
    g.rotateY(Math.atan2(x1 - x0, z1 - z0))
    batch.add(tiles, g, (x0 + x1) / 2, 0.11, (z0 + z1) / 2)
  }
  // ring road and the campus street to the north
  scene.add(flat(THREE, 1200, 10, asphalt, 6, 0, 0.05, -140))
  scene.add(flat(THREE, 10, 600, asphalt, 6, 200, 0.05, 0))

  /* Atlas ------------------------------------------------------------------------------- */
  const A = { x0: -75.6, x1: 75.6, z0: -41, z1: -19, lift: 6.2, beam: 2.2, storey: 3.75, storeys: 10 }
  const glassBase = A.lift + A.beam
  const atlasTop = glassBase + A.storey * A.storeys
  {
    const L = A.x1 - A.x0
    const D = A.z1 - A.z0
    const cz = (A.z0 + A.z1) / 2
    const box = new THREE.Mesh(boxGeo(THREE, L, atlasTop - glassBase, D, [5.4, 7.5]), atlas)
    box.position.set(0, glassBase, cz)
    box.castShadow = box.receiveShadow = true
    scene.add(box)
    // the deep transfer beam, the roof band, plant on the roof
    batch.box(concrete, L + 0.8, A.beam, D + 0.8, 0, A.lift, cz, [4, 4])
    batch.box(darkMetal, L + 0.3, 1.3, D + 0.3, 0, atlasTop, cz, [2, 2])
    batch.box(smooth, 40, 4, 12, -20, atlasTop + 1.3, cz, [3, 3])
    batch.box(smooth, 18, 3, 10, 38, atlasTop + 1.3, cz, [3, 3])
    // the glazed ground floor, set well back under the slab
    batch.box(lobbyGlass, L - 10, A.lift, 7, 0, 0, -31.5, [7.5, 6.2])
    // pilotis: square concrete columns flaring into brackets under the beam
    const colGeo = boxGeo(THREE, 1.3, 4.7, 1.3, [2, 2])
    const brk = new THREE.CylinderGeometry(2.25, 0.92, 1.5, 4, 1)
    brk.rotateY(Math.PI / 4)
    brk.scale(1, 1, 0.75)
    brk.translate(0, 4.7 + 0.75, 0)
    const pil = []
    for (let k = 0; k < 20; k++) for (const z of [-37.5, -22.5]) pil.push(-71.25 + 7.5 * k, z)
    const n = pil.length / 2
    const cols = new THREE.InstancedMesh(colGeo, concrete, n)
    const brks = new THREE.InstancedMesh(brk, concrete, n)
    const m4 = new THREE.Matrix4()
    for (let i = 0; i < n; i++) {
      m4.makeTranslation(pil[i * 2], 0, pil[i * 2 + 1])
      cols.setMatrixAt(i, m4)
      brks.setMatrixAt(i, m4)
    }
    for (const mesh of [cols, brks]) {
      mesh.castShadow = mesh.receiveShadow = true
      scene.add(mesh)
    }
    // banners hung between the front columns (photo kenneth-02)
    const bannerMat = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.7, side: THREE.DoubleSide })
    for (const x of [-30, -7.5, 15, 37.5]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.4), bannerMat)
      b.position.set(x, 3.4, -22.5)
      scene.add(b)
    }
    // lettering on the beam over the entrance
    const word = lettering(THREE, 'ATLAS', { w: 9, h: 1.3, font: '600 {px}px "Helvetica Neue", Arial, sans-serif', color: '#f1f0ec', px: 140, emissive: 0.15 })
    word.position.set(-30, A.lift + 1.1, A.z1 + 0.5)
    scene.add(word)
  }

  /* the reflecting pool and the flags -------------------------------------------------------- */
  const poolPal = { ...world.light, water: { deep: 0x3d4a45, shallow: 0x62706a, stroke: 0xf2f1ee } }
  const pool = waterMaterial(THREE, { palette: poolPal, scale: 0.22, strokes: 0.3 })
  {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(44, 10), pool)
    w.rotation.x = -Math.PI / 2
    w.position.set(-40, 0.32, -9)
    scene.add(w)
    for (const [bw, bd, x, z] of [
      [44.8, 0.4, -40, -3.8],
      [44.8, 0.4, -40, -14.2],
      [0.4, 10, -17.8, -9],
      [0.4, 10, -62.2, -9],
    ]) batch.box(smooth, bw, 0.45, bd, x, 0, z, [3, 3])
    // small jets along the middle
    const jets = []
    for (let x = -58; x <= -22; x += 4) jets.push({ x, y: 0.3, z: -9, w: 0.06, h: 0.9, d: 0.06 })
    instBoxes(THREE, scene, jets, new THREE.MeshStandardMaterial({ color: 0xeaf2f4, roughness: 0.2, transparent: true, opacity: 0.55, depthWrite: false }), { cast: false })
  }
  const flags = []
  {
    const poles = []
    const paints = [
      (g, w, h) => {
        g.fillStyle = '#1f3e93'
        g.fillRect(0, 0, w, h)
        g.fillStyle = '#ffd200'
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2
          g.beginPath()
          g.arc(w / 2 + Math.cos(a) * 34, h / 2 + Math.sin(a) * 34, 4.5, 0, Math.PI * 2)
          g.fill()
        }
      },
      (g, w, h) => {
        g.fillStyle = '#ae1c28'
        g.fillRect(0, 0, w, h / 3)
        g.fillStyle = '#ffffff'
        g.fillRect(0, h / 3, w, h / 3)
        g.fillStyle = '#21468b'
        g.fillRect(0, (2 * h) / 3, w, h / 3)
      },
      (g, w, h) => {
        g.fillStyle = '#c8102e'
        g.fillRect(0, 0, w, h)
        g.fillStyle = '#ffffff'
        g.font = '700 54px "Helvetica Neue", Arial, sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText('TU/e', w / 2, h / 2)
      },
      (g, w, h) => {
        g.fillStyle = '#5a2d82'
        g.fillRect(0, 0, w, h)
        g.fillStyle = '#ffffff'
        g.fillRect(0, h * 0.44, w, h * 0.12)
      },
    ]
    paints.forEach((p, i) => {
      const x = -70 + i * 3.2
      const z = -3
      poles.push({ x, z, w: 0.12, h: 10.4, d: 0.12 })
      const f = flag(THREE, p, { x: x + 0.06, z, h: 10.2, rot: -0.4, seed: i * 1.7 })
      scene.add(f.mesh)
      flags.push(f)
    })
    instBoxes(THREE, scene, poles, new THREE.MeshStandardMaterial({ color: 0xd9d9d6, metalness: 0.8, roughness: 0.3 }))
  }

  /* the red TU/e letters on the lawn ------------------------------------------------------- */
  const LET = V(16, 0, 18)
  {
    const letters = new THREE.Mesh(tueLetters(THREE), red)
    letters.position.set(LET.x, 0.42, LET.z)
    letters.castShadow = letters.receiveShadow = true
    scene.add(letters)
    batch.box(smooth, 7.6, 0.42, 1.0, LET.x, 0, LET.z, [3, 3])
  }

  /* the concrete shelter on the green (photo kenneth-06) ------------------------------------ */
  const SH = V(-46, 0, 30)
  {
    for (const [dx, dz] of [
      [-3.2, -1.9],
      [3.2, -1.9],
      [-3.2, 1.9],
      [3.2, 1.9],
    ])
      batch.box(concrete, 0.55, 3.0, 0.55, SH.x + dx, 0, SH.z + dz, [4, 4])
    batch.box(concrete, 8.2, 0.55, 5.2, SH.x, 3.0, SH.z, [4, 4])
    batch.box(smooth, 7, 0.12, 4.6, SH.x, 0, SH.z, [3, 3])
    batch.box(concrete, 4.5, 0.45, 0.6, SH.x, 0, SH.z - 1.4, [4, 4])
    batch.box(concrete, 0.4, 1.8, 3.6, SH.x - 3.2, 0, SH.z, [4, 4])
  }

  /* MetaForum: the old hall below, a fritted-glass box floating above, grand steps --------- */
  {
    const x0 = 95
    const x1 = 175
    const z0 = -72
    const z1 = -8
    batch.box(hallFacade, x1 - x0, 11, z1 - z0, (x0 + x1) / 2, 0, (z0 + z1) / 2, [6, 5.5])
    batch.box(darkMetal, x1 - x0 - 10, 3, z1 - z0 - 10, (x0 + x1) / 2, 11, (z0 + z1) / 2, [2, 2])
    const top = new THREE.Mesh(boxGeo(THREE, x1 - x0 + 6, 14, z1 - z0 + 6, [6, 6]), frit)
    top.position.set((x0 + x1) / 2, 14, (z0 + z1) / 2)
    top.castShadow = top.receiveShadow = true
    scene.add(top)
    batch.box(darkMetal, x1 - x0 + 6.4, 0.7, z1 - z0 + 6.4, (x0 + x1) / 2, 28, (z0 + z1) / 2, [2, 2])
    // steel columns carrying the box's overhang
    const sc = []
    for (let z = z0 + 4; z < z1; z += 8) sc.push({ x: x0 - 1.8, z, w: 0.5, h: 14, d: 0.5 })
    instBoxes(THREE, scene, sc, darkMetal)
    // the grand steps up to the entrance terrace (photo kenneth-05)
    for (let i = 0; i < 10; i++) batch.box(smooth, 0.36, 0.17 * (i + 1), 28, 88.2 + i * 0.36, 0, -30, [3, 3])
    batch.box(smooth, 3.6, 1.7, 28, 93.4, 0, -30, [3, 3])
    batch.box(lobbyGlass, 0.3, 6.2, 22, 95.1, 1.7, -30, [7.5, 6.2])
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(3, 5), new THREE.MeshStandardMaterial({ color: 0xb3122a, roughness: 0.6, emissive: 0x3a0508, emissiveIntensity: 0.4 }))
    banner.rotation.y = -Math.PI / 2
    banner.position.set(94.8, 5.2, -22)
    scene.add(banner)
  }

  /* the rest of the campus ------------------------------------------------------------------- */
  {
    // Auditorium (concrete, sloping roof), Vertigo (tall concrete grid), Gemini, Flux
    batch.box(concrete, 32, 14, 40, -104, 0, -56, [4, 4])
    const roofW = new THREE.Shape()
    roofW.moveTo(-20, 0)
    roofW.lineTo(20, 0)
    roofW.lineTo(20, 9)
    roofW.closePath()
    const rg = new THREE.ExtrudeGeometry(roofW, { depth: 32, bevelEnabled: false })
    rg.translate(0, 0, -16)
    rg.rotateY(Math.PI / 2)
    batch.add(concrete, rg, -104, 14, -56)
    batch.box(vertigo, 36, 46.8, 20, -40, 0, -110, [7.2, 7.2])
    batch.box(darkMetal, 36.4, 1.2, 20.4, -40, 46.8, -110, [2, 2])
    batch.box(gemini, 72, 18, 20, -96, 0, 72, [7.2, 7.2])
    batch.box(flux, 50, 24, 34, 86, 0, 120, [7.2, 8])
    batch.box(flux, 34, 16, 50, 140, 0, 40, [7.2, 8])
    batch.box(gemini, 60, 21.6, 18, 60, 0, -105, [7.2, 7.2])
    batch.box(vertigo, 24, 28.8, 24, 150, 0, -105, [7.2, 7.2])
    // the brick boiler house and its chimney
    batch.box(brick, 26, 12, 18, -138, 0, -118, [2, 2])
    const ch = new THREE.CylinderGeometry(1.7, 2.8, 62, 28, 1, true)
    ch.translate(0, 31, 0)
    const uv = ch.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7, uv.getY(i) * 31)
    batch.add(brick, ch, -128, 0, -112)
    batch.box(darkMetal, 3.8, 1.0, 3.8, -128, 61.5, -112, [2, 2])
    // the city to the south and east, far off
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    const uvs = unit.attributes.uv.array
    for (let i = 0; i < uvs.length; i++) uvs[i] *= 3
    const blocks = []
    for (let i = 0; i < (low ? 120 : 260); i++) {
      const x = range(rand, -800, 800)
      const z = range(rand, -800, 800)
      if (x > -240 && x < 230 && z > -170 && z < 160) continue
      blocks.push({ x, z, w: range(rand, 20, 50), h: range(rand, 10, 34), d: range(rand, 14, 24), r: Math.floor(rand() * 2) * (Math.PI / 2) })
    }
    instBoxes(THREE, scene, blocks, cityMat, { cast: false, geo: unit })
  }

  /* the Dommel: a green stream along the campus's west edge ----------------------------------- */
  const dommelPal = { ...world.light, water: { deep: 0x2e3a2c, shallow: 0x55634a, stroke: 0xf2f1ee } }
  const dommel = waterMaterial(THREE, { palette: dommelPal, scale: 0.4, strokes: 0.4 })
  {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(14, 900), dommel)
    w.rotation.x = -Math.PI / 2
    w.position.set(-208, 0.06, 0)
    scene.add(w)
  }

  /* trees -------------------------------------------------------------------------------------- */
  const big = []
  // a line of mature trees along the green's east and west edges, and round the shelter
  for (let z = 6; z < 60; z += 9) {
    big.push({ x: -63 + range(rand, -1, 1), z, h: range(rand, 13, 18) })
    if (z + 4 > 40) big.push({ x: 63 + range(rand, -1, 1), z: z + 4, h: range(rand, 13, 18) })
  }
  for (const [x, z] of [
    [-54, 40],
    [-38, 46],
    [-30, 56],
    [24, 60],
    [46, 8],
    [36, 12],
    [-8, 54],
    [-100, 20],
    [-110, 0],
    [-96, -10],
    [110, 10],
    [120, -2],
    [-150, 30],
    [-160, -40],
    [180, -60],
    [175, 80],
  ]) big.push({ x: x + range(rand, -1.5, 1.5), z: z + range(rand, -1.5, 1.5), h: range(rand, 12, 17) })
  addForest(THREE, scene, big, { species: 'plane', season: 'summer', seed: 13, quality: q })
  const lime = []
  for (let x = -76; x <= 80; x += 12) lime.push({ x, z: -50, h: range(rand, 10, 13) })
  for (let x = -230; x < 230; x += 28) lime.push({ x, z: -133 + range(rand, -1, 1), h: range(rand, 11, 15) }, { x: x + 14, z: -147, h: range(rand, 11, 15) })
  addForest(THREE, scene, low ? lime.filter((_, i) => i % 2 === 0) : lime, { species: 'lime', season: 'summer', seed: 17, quality: q })
  const banks = []
  for (let z = -200; z < 200; z += 14) {
    banks.push({ x: -218 + range(rand, -2, 1), z: z + range(rand, -3, 3), h: range(rand, 10, 16) })
    if (rand() < 0.6) banks.push({ x: -197 + range(rand, -1, 2), z: z + 5, h: range(rand, 9, 14) })
  }
  addForest(THREE, scene, low ? banks.filter((_, i) => i % 2 === 0) : banks, { species: 'poplar', season: 'summer', seed: 19, quality: q })

  /* bikes, lamps, benches, bins ------------------------------------------------------------------ */
  addBikes(
    THREE,
    scene,
    [
      { x: 30, z: -14, len: 36, dir: 0 },
      { x: 30, z: -11.2, len: 36, dir: 0, fill: 0.6 },
      { x: 62, z: -44, len: 26, dir: 0 },
      { x: -50, z: -45, len: 30, dir: 0 },
      { x: 84, z: 6, len: 24, dir: Math.PI / 2, fill: 0.7 },
      { x: -14, z: -44, len: 20, dir: 0 },
    ].slice(0, low ? 3 : 6),
    rand
  )
  const lamps = []
  for (let x = -60; x <= 60; x += 20) lamps.push({ x, z: -1.2, r: Math.PI / 2 })
  for (let z = 8; z <= 56; z += 16) lamps.push({ x: -59.5, z }, { x: 59.5, z, r: Math.PI })
  for (let x = -90; x <= 180; x += 24) lamps.push({ x, z: -54 })
  addLampPosts(THREE, scene, lamps, { height: 5.5 })
  {
    const legs = []
    const tops = []
    for (const [x, z, r] of [
      [-6, 2.2, 0],
      [8, 2.2, 0],
      [28, 2.2, 0],
      [-30, 1.5, 0],
      [52, 20, Math.PI / 2],
      [-52, 14, Math.PI / 2],
      [10, 40, 0],
    ]) {
      const c = Math.cos(r)
      const s = Math.sin(r)
      legs.push({ x: x - c * 0.8, z: z + s * 0.8, w: 0.42, h: 0.42, d: 0.55, r }, { x: x + c * 0.8, z: z - s * 0.8, w: 0.42, h: 0.42, d: 0.55, r })
      tops.push({ x, y: 0.42, z, w: 2.2, h: 0.09, d: 0.55, r })
    }
    instBoxes(THREE, scene, legs, smooth)
    instBoxes(THREE, scene, tops, wood)
    const bins = []
    for (const [x, z] of [
      [-12, -1.5],
      [16, -1.5],
      [80, -16],
      [-40, 26],
    ]) bins.push({ x, z, w: 0.5, h: 1.0, d: 0.5 })
    instBoxes(THREE, scene, bins, darkMetal)
    // the picnic sets on the lawn behind the letters (photo kenneth-07)
    const pic = []
    for (const [x, z] of [
      [6, 10],
      [26, 12],
    ]) {
      pic.push({ x, y: 0.72, z, w: 1.9, h: 0.06, d: 0.8 }, { x, y: 0.42, z: z - 0.65, w: 1.9, h: 0.05, d: 0.3 }, { x, y: 0.42, z: z + 0.65, w: 1.9, h: 0.05, d: 0.3 })
      for (const dx of [-0.75, 0.75]) pic.push({ x: x + dx, y: 0, z, w: 0.08, h: 0.72, d: 1.5 })
    }
    instBoxes(THREE, scene, pic, new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.5 }))
  }

  batch.build(scene)

  /* light, the flight in, the viewpoints ----------------------------------------------------- */
  world.focusShadows(V(5, 0, -8), 92)

  const spots = [
    // 0 · in front of Atlas, looking up its glass over the pilotis (photo kenneth-04)
    { pos: V(4, 1.5, -2), look: V(0, 14, -19) },
    // 1 · under the slab, along the colonnade and its banners (photo kenneth-02)
    { pos: V(-7, 1.7, -25.2), look: V(60, 3.5, -27) },
    // 2 · by the reflecting pool, flags behind it, Atlas to the right (photos kenneth-03, adriel-02)
    { pos: V(-30, 1.6, 4), look: V(-62, 7, -16) },
    // 3 · the concrete shelter on the green (photo kenneth-06)
    { pos: V(-34, 1.65, 38), look: V(-46, 5, 6) },
    // 4 · the red TU/e letters on the lawn, Atlas behind (photos amara-05, kenneth-07)
    { pos: V(4, 1.6, 34), look: V(8, 9, -12) },
    // 5 · above the green: Atlas end to end, MetaForum beyond
    { pos: V(40, 16, 46), look: V(18, 15, -30) },
    // 6 · at MetaForum's grand steps (photo kenneth-05)
    { pos: V(83.5, 1.6, -14), look: V(98, 5, -31) },
  ]
  const end = spots[0]
  const path = {
    positions: [V(200, 140, 220), V(100, 70, 120), V(30, 24, 40), V(8, 4, 5), end.pos.clone()],
    targets: [V(0, 20, -30), V(0, 22, -30), V(0, 20, -25), V(1, 16, -20), end.look.clone()],
    fov: 50,
    near: 0.3,
    spots,
  }

  return {
    scene,
    world,
    path,
    update(t) {
      pool.userData.tick(t)
      dommel.userData.tick(t)
      for (const f of flags) f.tick(t)
    },
  }
}
