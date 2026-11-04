/**
 * Interiors — rooms that have to pass for photographs of real rooms.
 *
 * 'villa'  (Laura): a modern Dutch countryside villa — an open-plan barn
 *          with a pitched, white-boarded ceiling on grey steel rafters, a
 *          wall of oak-framed sliding glass doors onto a terrace and flat
 *          fields, a travertine island, a walnut dining table under
 *          pebble-shaped pendant lamps, a cream bouclé sofa, a rust lounge
 *          chair, olive trees in pots, a textured white artwork, and an
 *          oak-and-glass screen into a beamed corridor. Low winter sun.
 *
 * 'studio' (bobbi.intl): a bare dance studio in an old school building — a
 *          mirror wall with ballet barres, an upright mahogany piano, a
 *          blue-grey dance floor, soft window light and a pink gel light
 *          washing one wall.
 *
 * How the light is made believable indoors:
 *  - each room carries its own image-based light: an HDR "probe" ray-cast
 *    from the room's own layout (bright windows, sun patches on the floor,
 *    off-white walls, the ceiling) and assigned as `envMap` to every
 *    material inside, so walls are lit by the windows, not by an open sky,
 *    and polished floors reflect the window shapes;
 *  - the shadowed sun pours through the real window openings;
 *  - rectangular area lights at the big windows add the soft fall-off away
 *    from the glass; a few low point lights for lamps; no light is strong.
 *  - the studio's mirror wall is a true mirror: the room (and the street
 *    outside its windows) is built twice, the copy reflected behind the
 *    mirror plane, so the reflection has correct parallax.
 *
 * Metres; y up. Exports buildInterior(THREE, ctx, { variant }).
 */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { createWorld } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { seeded, range, beamBatch, noiseNormalMap } from '../utils.js'

let ltcReady = false
function initRectLights() {
  if (ltcReady) return
  RectAreaLightUniformsLib.init()
  ltcReady = true
}

/* ======================================================================== */
/* the kit: geometry, batching, painted PBR textures, room light probes       */
/* ======================================================================== */

/** The interior kit — also used by hall.js. */
export function makeKit(THREE, ctx) {
  const low = ctx.quality === 'low'
  const TEX = low ? 256 : 512
  const _p = new THREE.Vector3()
  const _q = new THREE.Quaternion()
  const _s = new THREE.Vector3()
  const _e = new THREE.Euler(0, 0, 0, 'YXZ')
  const _m = new THREE.Matrix4()
  const UP = new THREE.Vector3(0, 1, 0)

  /** Transform a geometry in place: position, rotation (yaw applied last), scale. */
  const tf = (geo, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => {
    _m.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2], 'YXZ')), _s.set(s[0], s[1], s[2]))
    return geo.applyMatrix4(_m)
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
  const rbox = (w, h, d, r, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)))
  const cyl = (rt, rb, h, seg = 24, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)
  const sphere = (r, ws = 24, hs = 16) => new THREE.SphereGeometry(r, ws, hs)
  const lathe = (pts, seg = 32) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg)

  /** A cylinder from point a to point b (radius r1 at a, r2 at b). */
  function rod(a, b, r1, r2 = r1, seg = 8) {
    const A = new THREE.Vector3(a[0], a[1], a[2])
    const Bv = new THREE.Vector3(b[0], b[1], b[2])
    const dir = Bv.clone().sub(A)
    const len = Math.max(1e-4, dir.length())
    const g = new THREE.CylinderGeometry(r2, r1, len, seg, 1)
    g.translate(0, len / 2, 0)
    g.applyQuaternion(_q.setFromUnitVectors(UP, dir.normalize()))
    g.translate(A.x, A.y, A.z)
    return g
  }

  /** Planar UVs in metres / tile, picked per vertex by the dominant normal axis. */
  function planarUV(geo, tu = 1, tv = tu) {
    if (!geo.attributes.normal) geo.computeVertexNormals()
    const p = geo.attributes.position
    const n = geo.attributes.normal
    const uv = new Float32Array(p.count * 2)
    for (let i = 0; i < p.count; i++) {
      const nx = n.getX(i)
      const ny = n.getY(i)
      const nz = n.getZ(i)
      const ax = Math.abs(nx)
      const ay = Math.abs(ny)
      const az = Math.abs(nz)
      let u
      let v
      if (ay >= ax && ay >= az) {
        u = p.getX(i)
        v = -p.getZ(i)
      } else if (ax >= az) {
        u = nx > 0 ? -p.getZ(i) : p.getZ(i)
        v = p.getY(i)
      } else {
        u = nz > 0 ? p.getX(i) : -p.getX(i)
        v = p.getY(i)
      }
      uv[2 * i] = u / tu
      uv[2 * i + 1] = v / tv
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    return geo
  }

  /** An axis-aligned box from min/max corners, UVs in metres. */
  function slab(x0, x1, y0, y1, z0, z1, tile = 3) {
    const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    return planarUV(g, tile)
  }

  /** A quad from 4 corners, facing `toward`; uv = [[u,v] x4]. */
  function quad(c, uv, toward) {
    const a = new THREE.Vector3(...c[0])
    const b = new THREE.Vector3(...c[1])
    const d = new THREE.Vector3(...c[3])
    const n = b.clone().sub(a).cross(d.clone().sub(a))
    const order = n.dot(toward) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]
    const pos = []
    const uvs = []
    for (const i of order) {
      pos.push(...c[i])
      uvs.push(...uv[i])
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.computeVertexNormals()
    return g
  }

  /** Vertical flutes on a cylinder (round fluted wood bases). */
  function flute(geo, n = 20, depth = 0.04) {
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const z = p.getZ(i)
      const r = Math.hypot(x, z)
      if (r < 1e-4) continue
      const a = Math.atan2(z, x)
      const k = 1 - depth * (1 - Math.pow(Math.abs(Math.cos((a * n) / 2)), 0.6))
      p.setX(i, x * k)
      p.setZ(i, z * k)
    }
    geo.computeVertexNormals()
    return geo
  }

  function mergeAll(list) {
    const ready = list.map((g0) => {
      const g = g0.index ? g0.toNonIndexed() : g0
      if (!g.attributes.normal) g.computeVertexNormals()
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k)
      g.morphAttributes = {}
      return g
    })
    return ready.length === 1 ? ready[0] : mergeGeometries(ready, false)
  }

  /** Collects static geometry per material; one draw call per material. */
  function batcher() {
    const groups = new Map()
    return {
      add(mat, geo, cast = true) {
        const key = mat.uuid + (cast ? '+' : '-')
        let g = groups.get(key)
        if (!g) groups.set(key, (g = { mat, cast, list: [] }))
        g.list.push(geo)
        return geo
      },
      /** Add several [material, geometry] parts, all moved by p / r. */
      parts(list, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
        for (const [mat, geo, cast] of list) this.add(mat, tf(geo.clone(), p, r, s), cast !== false)
      },
      build(parent) {
        for (const { mat, cast, list } of groups.values()) {
          const merged = mergeAll(list)
          const meshes = merged ? [new THREE.Mesh(merged, mat)] : list.map((g) => new THREE.Mesh(g, mat))
          for (const mesh of meshes) {
            mesh.castShadow = cast
            mesh.receiveShadow = true
            parent.add(mesh)
          }
        }
        groups.clear()
      },
    }
  }

  /* --- painted textures ------------------------------------------------ */

  function canvas(w, h = w) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  function texOf(c, srgb, rep) {
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    if (rep) t.repeat.set(rep[0], rep[1])
    t.needsUpdate = true
    return t
  }
  /** Height canvas → tangent-space normal map, rows flipped to match CanvasTexture. */
  function normalTex(hc, strength = 2) {
    const w = hc.width
    const h = hc.height
    const src = hc.getContext('2d').getImageData(0, 0, w, h).data
    const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255
    const out = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      const row = (h - 1 - y) * w
      for (let x = 0; x < w; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * strength
        const dy = (H(x, y + 1) - H(x, y - 1)) * strength
        const l = Math.hypot(dx, dy, 1)
        const i = (row + x) * 4
        out[i] = (-dx / l) * 127.5 + 127.5
        out[i + 1] = (dy / l) * 127.5 + 127.5
        out[i + 2] = (1 / l) * 127.5 + 127.5
        out[i + 3] = 255
      }
    }
    const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  }
  /**
   * A full PBR material painted on three canvases: paint(albedo, height, rough, size).
   * Height starts mid-grey, roughness light grey, albedo white.
   */
  function pbr(paint, { size = TEX, normal = 2, physical = false, ...params } = {}) {
    const A = canvas(size)
    const Hc = canvas(size)
    const R = canvas(size)
    const a = A.getContext('2d')
    const h = Hc.getContext('2d', { willReadFrequently: true })
    const r = R.getContext('2d')
    a.fillStyle = '#ffffff'
    a.fillRect(0, 0, size, size)
    h.fillStyle = '#808080'
    h.fillRect(0, 0, size, size)
    r.fillStyle = '#c0c0c0'
    r.fillRect(0, 0, size, size)
    paint(a, h, r, size)
    const Mat = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial
    return new Mat({ map: texOf(A, true), normalMap: normalTex(Hc, normal), roughnessMap: texOf(R, false), roughness: 1, ...params })
  }
  /** Per-pixel white noise on a canvas layer (grain, grit). */
  function grit(g, size, amp, rand) {
    const img = g.getImageData(0, 0, size, size)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const n = (rand() - 0.5) * amp
      d[i] += n
      d[i + 1] += n
      d[i + 2] += n
    }
    g.putImageData(img, 0, 0)
  }
  /** Soft round blotches, wrapped so the texture tiles. */
  function blots(g, size, n, color, r0, r1, rand) {
    for (let i = 0; i < n; i++) {
      const x = rand() * size
      const y = rand() * size
      const r = range(rand, r0, r1) * size
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const cx = x + ox
          const cy = y + oy
          if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue
          const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r)
          grd.addColorStop(0, color)
          grd.addColorStop(1, 'rgba(0,0,0,0)')
          g.fillStyle = grd
          g.fillRect(cx - r, cy - r, r * 2, r * 2)
        }
      }
    }
  }
  /** Draw a path at the 9 wrapped offsets so strokes tile seamlessly. */
  function wrapped(g, size, fn) {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        g.save()
        g.translate(ox, oy)
        fn(g)
        g.restore()
      }
    }
  }

  /* --- shared material recipes ------------------------------------------- */

  let woodMaps = null
  /** Neutral wood grain (horizontal, along u), tinted per material by `color`. */
  function wood(color, { rough = 0.55, clearcoat = 0, tile = 1, ...params } = {}) {
    if (!woodMaps) {
      const rand = seeded(77)
      const holder = pbr(
        (a, h, r, S) => {
          a.fillStyle = '#d8d8d8'
          a.fillRect(0, 0, S, S)
          // broad growth bands
          for (let i = 0; i < 26; i++) {
            const y = rand() * S
            const hh = range(rand, 4, 22)
            a.fillStyle = `rgba(0,0,0,${range(rand, 0.03, 0.09)})`
            a.fillRect(0, y, S, hh)
            a.fillRect(0, y - S, S, hh)
          }
          // fine wavy grain lines, periodic in x so they tile
          for (let i = 0; i < S / 2.2; i++) {
            const y0 = rand() * S
            const amp = range(rand, 1, 7)
            const k = 1 + Math.floor(rand() * 3)
            const ph = rand() * 6.28
            const al = range(rand, 0.05, 0.22)
            const lw = range(rand, 0.5, 2.2)
            for (const oy of [-S, 0, S]) {
              a.strokeStyle = `rgba(40,25,10,${al})`
              a.lineWidth = lw
              h.strokeStyle = `rgba(0,0,0,${al * 1.2})`
              h.lineWidth = lw
              for (const g of [a, h]) {
                g.beginPath()
                for (let x = 0; x <= S; x += 8) {
                  const y = y0 + oy + Math.sin((x / S) * Math.PI * 2 * k + ph) * amp
                  if (x === 0) g.moveTo(x, y)
                  else g.lineTo(x, y)
                }
                g.stroke()
              }
            }
          }
          grit(a, S, 10, rand)
          r.fillStyle = '#8a8a8a'
          r.fillRect(0, 0, S, S)
          grit(r, S, 24, rand)
        },
        { normal: 1.2 }
      )
      woodMaps = { map: holder.map, normalMap: holder.normalMap, roughnessMap: holder.roughnessMap }
      holder.dispose()
    }
    const Mat = clearcoat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial
    const m = new Mat({ ...woodMaps, color: new THREE.Color(color), roughness: rough / 0.54, ...params })
    if (clearcoat) {
      m.clearcoat = clearcoat
      m.clearcoatRoughness = 0.12
    }
    return m
  }

  let fineNormal = null
  /** A shared fine bump (stoneware, painted metal, plaster shades). */
  function fine() {
    if (!fineNormal) fineNormal = noiseNormalMap(THREE, low ? 128 : 256, { cells: 48, strength: 1.4, octaves: 3 })
    return fineNormal
  }
  const std = (color, rough = 0.6, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal, ...extra })

  /** Bouclé / velvet / linen — physical cloth with sheen, painted pile. */
  function fabric(kind, color, sheen) {
    const rand = seeded(kind === 'boucle' ? 31 : kind === 'velvet' ? 32 : 33)
    const m = pbr(
      (a, h, r, S) => {
        a.fillStyle = '#ffffff'
        a.fillRect(0, 0, S, S)
        if (kind === 'boucle') {
          // little loops of yarn, raised
          for (let i = 0; i < S * 14; i++) {
            const x = rand() * S
            const y = rand() * S
            const rr = range(rand, 1.2, 3.4)
            h.strokeStyle = `rgba(255,255,255,${range(rand, 0.25, 0.6)})`
            h.lineWidth = range(rand, 0.8, 1.6)
            h.beginPath()
            h.arc(x, y, rr, 0, Math.PI * 2)
            h.stroke()
            a.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'
            a.fillRect(x, y, 2, 2)
          }
          blots(h, S, 30, 'rgba(0,0,0,0.25)', 0.01, 0.03, rand)
          r.fillStyle = '#f2f2f2'
          r.fillRect(0, 0, S, S)
        } else if (kind === 'velvet') {
          blots(a, S, 18, 'rgba(0,0,0,0.12)', 0.05, 0.2, rand)
          blots(a, S, 14, 'rgba(255,255,255,0.1)', 0.05, 0.2, rand)
          blots(h, S, 24, 'rgba(0,0,0,0.3)', 0.03, 0.12, rand)
          grit(a, S, 8, rand)
          r.fillStyle = '#e8e8e8'
          r.fillRect(0, 0, S, S)
        } else {
          // linen weave
          for (let y = 0; y < S; y += 2) {
            a.fillStyle = `rgba(0,0,0,${range(rand, 0.0, 0.07)})`
            a.fillRect(0, y, S, 1)
            h.fillStyle = `rgba(0,0,0,${range(rand, 0.1, 0.3)})`
            h.fillRect(0, y, S, 1)
          }
          for (let x = 0; x < S; x += 2) {
            a.fillStyle = `rgba(0,0,0,${range(rand, 0.0, 0.06)})`
            a.fillRect(x, 0, 1, S)
            h.fillStyle = `rgba(0,0,0,${range(rand, 0.1, 0.25)})`
            h.fillRect(x, 0, 1, S)
          }
          r.fillStyle = '#ececec'
          r.fillRect(0, 0, S, S)
        }
        grit(h, S, 30, rand)
      },
      { size: low ? 128 : 256, normal: kind === 'boucle' ? 3.5 : kind === 'velvet' ? 1.2 : 1.6, physical: true, color: new THREE.Color(color) }
    )
    m.sheen = 1
    m.sheenColor = new THREE.Color(sheen)
    m.sheenRoughness = kind === 'velvet' ? 0.35 : 0.8
    m.normalScale = new THREE.Vector2(0.8, 0.8)
    return m
  }

  /* --- light probes -------------------------------------------------------- */

  /** An HDR equirectangular environment, ray-cast from the room's layout. */
  function probe(W, H, radiance) {
    const toHalf = THREE.DataUtils.toHalfFloat
    const data = new Uint16Array(W * H * 4)
    const d = new THREE.Vector3()
    const one = toHalf(1)
    for (let j = 0; j < H; j++) {
      const lat = ((j + 0.5) / H - 0.5) * Math.PI
      const cl = Math.cos(lat)
      const sl = Math.sin(lat)
      for (let i = 0; i < W; i++) {
        const lon = ((i + 0.5) / W - 0.5) * Math.PI * 2
        d.set(Math.cos(lon) * cl, sl, Math.sin(lon) * cl)
        const c = radiance(d)
        const k = (j * W + i) * 4
        data[k] = toHalf(Math.max(0, Math.min(60, c[0])))
        data[k + 1] = toHalf(Math.max(0, Math.min(60, c[1])))
        data[k + 2] = toHalf(Math.max(0, Math.min(60, c[2])))
        data[k + 3] = one
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
  /** Give every PBR material under root the room's own environment. */
  function applyEnv(root, env) {
    root.traverse((o) => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      for (const m of ms) if (m.isMeshStandardMaterial && !m.envMap) m.envMap = env
    })
  }
  /** Ray vs axis-aligned room box from inside: { t, face: 'x+','x-','y+','y-','z+','z-' }. */
  function roomHit(P, d, b) {
    let t = Infinity
    let face = null
    const test = (tt, f) => {
      if (tt > 1e-4 && tt < t) {
        t = tt
        face = f
      }
    }
    if (d.x > 1e-6) test((b.x1 - P.x) / d.x, 'x+')
    if (d.x < -1e-6) test((b.x0 - P.x) / d.x, 'x-')
    if (d.y > 1e-6) test((b.y1 - P.y) / d.y, 'y+')
    if (d.y < -1e-6) test((b.y0 - P.y) / d.y, 'y-')
    if (d.z > 1e-6) test((b.z1 - P.z) / d.z, 'z+')
    if (d.z < -1e-6) test((b.z0 - P.z) / d.z, 'z-')
    return { t, face }
  }
  const inRect = (a, y, o) => a >= o.a0 && a <= o.a1 && y >= o.y0 && y <= o.y1

  /**
   * A straight wall run with rectangular openings, built from boxes.
   * axis 'z': the wall runs along x, thickness c0..c1 in z; 'x': runs along z.
   * openings: [{ a0, a1, y0, y1 }] along the run.
   */
  function wallRun(B, mat, axis, c0, c1, from, to, height, openings = [], tile = 3) {
    const piece = (a0, a1, y0, y1) => {
      if (a1 - a0 < 1e-3 || y1 - y0 < 1e-3) return
      B.add(mat, axis === 'z' ? slab(a0, a1, y0, y1, c0, c1, tile) : slab(c0, c1, y0, y1, a0, a1, tile))
    }
    let a = from
    for (const o of [...openings].sort((p, q) => p.a0 - q.a0)) {
      piece(a, o.a0, 0, height)
      piece(o.a0, o.a1, 0, o.y0)
      piece(o.a0, o.a1, o.y1, height)
      a = o.a1
    }
    piece(a, to, 0, height)
  }

  /**
   * Window/door frames and glass for an opening. axis 'z': wall plane z = c;
   * 'x': wall plane x = c. Frames go in a beamBatch, glass quads in `glass`.
   */
  function glazing(frames, glass, axis, c, o, { fw = 0.07, fd = 0.1, mullions = [], transoms = [], skipGlass = [] } = {}) {
    const P = (a, y) => (axis === 'z' ? new THREE.Vector3(a, y, c) : new THREE.Vector3(c, y, a))
    const vert = axis === 'z' ? [fw, fd] : [fd, fw]
    const hor = [fd, fw]
    const hw = fw / 2
    frames.add(P(o.a0 + hw, o.y0), P(o.a0 + hw, o.y1), ...vert)
    frames.add(P(o.a1 - hw, o.y0), P(o.a1 - hw, o.y1), ...vert)
    frames.add(P(o.a0, o.y0 + hw), P(o.a1, o.y0 + hw), ...hor)
    frames.add(P(o.a0, o.y1 - hw), P(o.a1, o.y1 - hw), ...hor)
    for (const a of mullions) frames.add(P(a, o.y0), P(a, o.y1), vert[0] * 0.8, vert[1] * 0.8)
    for (const y of transoms) frames.add(P(o.a0, y), P(o.a1, y), hor[0] * 0.8, hor[1] * 0.8)
    // one glass quad per bay between mullions
    const cuts = [o.a0, ...mullions, o.a1]
    for (let i = 0; i < cuts.length - 1; i++) {
      if (skipGlass.includes(i)) continue
      const g = new THREE.PlaneGeometry(cuts[i + 1] - cuts[i], o.y1 - o.y0)
      if (axis === 'x') g.rotateY(Math.PI / 2)
      const mid = (cuts[i] + cuts[i + 1]) / 2
      g.translate(axis === 'z' ? mid : c, (o.y0 + o.y1) / 2, axis === 'z' ? c : mid)
      glass.push(g)
    }
  }

  /** Sheer curtain with folds: a wavy strip in the plane z = zc (axis 'z'). */
  function curtain(a0, a1, y0, y1, c, { period = 0.16, amp = 0.05, axis = 'z', seed = 5 } = {}) {
    const rand = seeded(seed)
    const w = a1 - a0
    const segs = Math.max(12, Math.round((w / period) * 8))
    const g = new THREE.PlaneGeometry(w, y1 - y0, segs, 4)
    const p = g.attributes.position
    const ph = rand() * 6
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const y = p.getY(i)
      const k = amp * (0.75 + 0.25 * Math.sin(x * 1.7 + ph)) * (1 + (0.5 - y / (y1 - y0)) * 0.25)
      p.setZ(i, Math.sin((x / period) * Math.PI * 2 + Math.sin(x * 3.1) * 0.6) * k)
    }
    g.computeVertexNormals()
    if (axis === 'x') g.rotateY(Math.PI / 2)
    g.translate(axis === 'z' ? (a0 + a1) / 2 : c, (y0 + y1) / 2, axis === 'z' ? c : (a0 + a1) / 2)
    return g
  }

  /** Glass that keeps its full reflection: black body, premultiplied blending. */
  function glassMaterial(env = 3) {
    return new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
      envMapIntensity: env,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
  }

  return {
    low,
    TEX,
    tf,
    box,
    rbox,
    cyl,
    sphere,
    lathe,
    rod,
    planarUV,
    slab,
    quad,
    flute,
    batcher,
    canvas,
    texOf,
    normalTex,
    pbr,
    grit,
    blots,
    wrapped,
    wood,
    fine,
    std,
    fabric,
    probe,
    applyEnv,
    roomHit,
    inRect,
    wallRun,
    glazing,
    curtain,
    glassMaterial,
  }
}

const lin = (THREE, hex) => {
  const c = new THREE.Color(hex)
  return [c.r, c.g, c.b]
}

/* ======================================================================== */
/* villa                                                                     */
/* ======================================================================== */

function buildVilla(THREE, ctx) {
  initRectLights()
  const K = makeKit(THREE, ctx)
  const { low, tf, box, rbox, cyl, sphere, lathe, rod, slab, pbr, std } = K
  const q = ctx.quality
  const rand = seeded(2024)
  const world = createWorld(THREE, ctx, 'interior', {
    sun: { elevation: 15, azimuth: 232 },
    sunIntensity: 7,
    sunColor: 0xffe9cf,
    exposure: 1.2,
    fog: { density: 0.0022 },
    sky: { zenith: 0x8db1d4, horizon: 0xe8ecec, ground: 0x9a9677, sun: 0xfff0d8, cloudLit: 0xffffff, cloudShade: 0xc7d0d8, clouds: 0.42 },
  })
  const { scene } = world
  world.hemi.intensity = 0.55 // the viewer keeps 35% of this; the room probe does the rest
  const inside = new THREE.Group()
  const outside = new THREE.Group()
  scene.add(inside, outside)
  const B = K.batcher()
  const O = K.batcher()
  const frames = beamBatch(THREE)
  const glassGeos = []

  /* --- dimensions ------------------------------------------------------- */
  const HX = 11 // half length (x)
  const HZ = 5 // half depth (z); glazed long wall at z = -HZ faces the sun
  const EAVES = 3.4
  const RIDGE = 6.8
  const T = 0.3
  const KS = (RIDGE - EAVES) / HZ
  const ceilY = (z) => RIDGE - KS * Math.abs(z)

  // openings (a = position along the wall, y = height)
  const GLAZE = { a0: -10.6, a1: 4.0, y0: 0, y1: 3.05 }
  const S_WIN = { a0: 7.2, a1: 8.2, y0: 0.5, y1: 3.0 }
  const N_OPEN = { a0: -4.2, a1: 0.4, y0: 0, y1: 2.7 } // the oak-and-glass screen: passage, then the glazed den
  const N_WIN = { a0: 5.2, a1: 8.4, y0: 1.1, y1: 2.0 }
  // gables: a = z
  const E_WINS = [
    { a0: -3.0, a1: 0.0, y0: 0.3, y1: 2.7 },
    { a0: 1.0, a1: 1.8, y0: 0.45, y1: 4.3 },
    { a0: 2.6, a1: 3.4, y0: 0.45, y1: 3.9 },
  ]
  const W_WINS = [
    { a0: 1.15, a1: 2.45, y0: 0.05, y1: 3.2 }, // floor-to-ceiling, left of the sofa (laura-01/02)
    { a0: -3.75, a1: -3.2, y0: 0.45, y1: 3.0 }, // the slit behind the olive tree
    { a0: -0.6, a1: 0.6, y0: 4.0, y1: 5.6 },
  ]
  const PANELS = [-10.6, -8.167, -5.733, -3.3, -0.867, 1.567, 4.0] // sliding-door mullions

  /* --- materials ------------------------------------------------------------ */
  const wallMat = M.plaster(THREE, { color: '#e8e1d6', dirt: 0.025, tile: 3, quality: q, seed: 21 })
  const floorMat = M.floor(THREE, { kind: 'concrete', color: '#d3cabd', polish: 0.82, tile: 5, quality: q, seed: 5 })
  floorMat.envMapIntensity = 1.1
  const roofMat = M.roof(THREE, { kind: 'zinc', color: '#3a3d40', tile: 2, quality: q, seed: 9 })
  const boards = pbr(
    (a, h, r, S) => {
      a.fillStyle = '#efebe4'
      a.fillRect(0, 0, S, S)
      const n = 12
      for (let i = 0; i < n; i++) {
        const y = (i / n) * S
        a.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.03})`
        a.fillRect(0, y, S, S / n)
        a.fillStyle = 'rgba(90,80,70,0.35)'
        a.fillRect(0, y, S, 1.5)
        h.fillStyle = '#202020'
        h.fillRect(0, y, S, 2)
      }
      K.grit(a, S, 6, rand)
      r.fillStyle = '#b8b8b8'
      r.fillRect(0, 0, S, S)
    },
    { normal: 2.5 }
  )
  const oak = K.wood('#c2875a', { rough: 0.5 })
  const walnut = K.wood('#8a5a3c', { rough: 0.42 })
  const frameMat = std('#93623b', 0.5, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(0.3, 0.3) })
  const glass = K.glassMaterial(3)
  const steel = std('#727775', 0.55, 0.35)
  const duct = std('#c9cccf', 0.3, 1)
  const black = std('#151515', 0.4, 0.6)
  const chrome = std('#dfe2e4', 0.12, 1)
  const whiteWood = std('#efebe3', 0.45, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(0.15, 0.15) })
  const ceramic = std('#d8cab6', 0.7, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(0.5, 0.5) })
  const ceramicDark = std('#8c7b68', 0.75, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(0.5, 0.5) })
  const potMat = std('#b3a796', 0.85, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(0.8, 0.8) })
  const soil = std('#3a2e24', 1)
  const marble = pbr(
    (a, h, r, S) => {
      a.fillStyle = '#ece4d8'
      a.fillRect(0, 0, S, S)
      K.blots(a, S, 22, 'rgba(205,190,170,0.45)', 0.08, 0.3, rand)
      K.blots(a, S, 14, 'rgba(255,252,246,0.5)', 0.05, 0.2, rand)
      // veins: soft wide halo, a mid line, a sharp core — all wrapped
      for (let v = 0; v < 16; v++) {
        let x = rand() * S
        let y = rand() * S
        let ang = range(rand, -0.6, 0.9)
        const pts = [[x, y]]
        for (let k = 0; k < 40; k++) {
          ang += range(rand, -0.35, 0.35)
          x += Math.cos(ang) * S * 0.02
          y += Math.sin(ang) * S * 0.02
          pts.push([x, y])
        }
        const strong = rand() < 0.4
        for (const [lw, al] of [
          [9, 0.05],
          [3.5, 0.12],
          [1, strong ? 0.5 : 0.28],
        ]) {
          K.wrapped(a, S, (g) => {
            g.strokeStyle = `rgba(${strong ? '130,105,80' : '160,140,120'},${al})`
            g.lineWidth = lw * (S / 512)
            g.beginPath()
            pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)))
            g.stroke()
          })
        }
      }
      K.grit(a, S, 5, rand)
      r.fillStyle = '#383838'
      r.fillRect(0, 0, S, S)
      K.grit(r, S, 10, rand)
    },
    { normal: 0.3, physical: true, clearcoat: 0.7, clearcoatRoughness: 0.08 }
  )
  const boucle = K.fabric('boucle', '#e7dfd2', '#ffffff')
  const velvetBrown = K.fabric('velvet', '#5a3b27', '#b98a62')
  const forsythia = std('#f2b51e', 0.7, 0, { emissive: new THREE.Color('#3a2400'), emissiveIntensity: 0.4 })
  // travertine: warm cream stone, soft horizontal banding, small open pores
  const travertine = pbr(
    (a, h, r, S) => {
      a.fillStyle = '#e3d3b9'
      a.fillRect(0, 0, S, S)
      for (let i = 0; i < 34; i++) {
        const y = rand() * S
        const hh = range(rand, 2, 16)
        const tone = rand() < 0.5 ? `rgba(190,160,120,${range(rand, 0.08, 0.22)})` : `rgba(255,248,232,${range(rand, 0.1, 0.3)})`
        a.fillStyle = tone
        for (const oy of [-S, 0, S]) a.fillRect(0, y + oy, S, hh)
      }
      for (let i = 0; i < S * 1.6; i++) {
        const x = rand() * S
        const y = rand() * S
        const w = range(rand, 1.5, 7)
        const hh = range(rand, 0.8, 2.2)
        a.fillStyle = `rgba(150,120,85,${range(rand, 0.3, 0.6)})`
        h.fillStyle = 'rgba(0,0,0,0.7)'
        for (const g of [a, h]) {
          g.beginPath()
          g.ellipse(x, y, w, hh, 0, 0, Math.PI * 2)
          g.fill()
        }
      }
      K.grit(a, S, 6, rand)
      r.fillStyle = '#5a5a5a'
      r.fillRect(0, 0, S, S)
      K.grit(r, S, 14, rand)
    },
    { normal: 0.9, physical: true, clearcoat: 0.35, clearcoatRoughness: 0.25 }
  )
  // limewash / tadelakt: big soft trowel clouds in warm sand and cream (laura-08)
  const limewash = pbr(
    (a, h, r, S) => {
      a.fillStyle = '#e2cfb8'
      a.fillRect(0, 0, S, S)
      K.blots(a, S, 26, 'rgba(246,236,220,0.38)', 0.1, 0.32, rand)
      K.blots(a, S, 18, 'rgba(190,156,122,0.18)', 0.08, 0.28, rand)
      // trowel strokes: short wide arcs, light and dark, wrapped so it tiles
      for (let i = 0; i < 70; i++) {
        const x = rand() * S
        const y = rand() * S
        const len = range(rand, 0.15, 0.4) * S
        const ang = range(rand, -0.9, 0.9) + (rand() < 0.5 ? Math.PI / 2 : 0)
        const light = rand() < 0.6
        const al = range(rand, 0.03, 0.08)
        K.wrapped(a, S, (g) => {
          g.strokeStyle = light ? `rgba(250,242,228,${al})` : `rgba(170,138,104,${al * 0.5})`
          g.lineWidth = range(rand, 30, 70) * (S / 512)
          g.lineCap = 'round'
          g.beginPath()
          g.moveTo(x, y)
          g.quadraticCurveTo(x + Math.cos(ang) * len * 0.5 + range(rand, -8, 8), y + Math.sin(ang) * len * 0.5 + range(rand, -8, 8), x + Math.cos(ang) * len, y + Math.sin(ang) * len)
          g.stroke()
        })
      }
      K.blots(h, S, 40, 'rgba(255,255,255,0.12)', 0.03, 0.12, rand)
      K.grit(a, S, 5, rand)
      r.fillStyle = '#d4d4d4'
      r.fillRect(0, 0, S, S)
      K.blots(r, S, 26, 'rgba(120,120,120,0.35)', 0.04, 0.14, rand)
    },
    { normal: 1.2 }
  )
  const velvet = K.fabric('velvet', '#7b4729', '#d49a6a')
  const linen = K.fabric('linen', '#d9cfbf', '#fff6ea')
  const linenRust = K.fabric('linen', '#a8653a', '#f0b080')
  const rugMat = pbr(
    (a, h, r, S) => {
      a.fillStyle = '#d9cfbe'
      a.fillRect(0, 0, S, S)
      for (let i = 0; i < S * 20; i++) {
        const x = rand() * S
        const y = rand() * S
        h.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'
        h.fillRect(x, y, 2, 2)
        a.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(80,60,40,0.1)'
        a.fillRect(x, y, 2, 2)
      }
      r.fillStyle = '#f5f5f5'
      r.fillRect(0, 0, S, S)
    },
    { size: low ? 128 : 256, normal: 3 }
  )
  const shadeMat = std('#e6dfd4', 0.95, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(1.2, 1.2), side: THREE.DoubleSide })
  const shadeGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color('#ffb36e'), emissiveIntensity: 2.4, side: THREE.DoubleSide })
  const bulb = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.4, 2.8) })
  const opal = new THREE.MeshStandardMaterial({ color: 0xfaf6ee, roughness: 0.3, emissive: new THREE.Color('#ffe0b8'), emissiveIntensity: 1.5 })
  const artMat = pbr(
    (a, h, r, S) => {
      a.fillStyle = '#f1ece3'
      a.fillRect(0, 0, S, S)
      // crumpled, layered plaster on canvas: long soft ridges
      for (let i = 0; i < 160; i++) {
        let x = rand() * S
        let y = rand() * S
        let ang = range(rand, 0, Math.PI * 2)
        const bright = rand() < 0.5
        h.strokeStyle = bright ? `rgba(255,255,255,${range(rand, 0.2, 0.5)})` : `rgba(0,0,0,${range(rand, 0.2, 0.45)})`
        h.lineWidth = range(rand, 2, 9)
        h.lineCap = 'round'
        h.beginPath()
        h.moveTo(x, y)
        for (let k = 0; k < 10; k++) {
          ang += range(rand, -0.6, 0.6)
          x += Math.cos(ang) * S * 0.03
          y += Math.sin(ang) * S * 0.03
          h.lineTo(x, y)
        }
        h.stroke()
      }
      K.blots(a, S, 12, 'rgba(200,190,175,0.07)', 0.08, 0.25, rand)
      K.grit(h, S, 20, rand)
      r.fillStyle = '#e0e0e0'
      r.fillRect(0, 0, S, S)
    },
    { normal: 5 }
  )
  const cabinetMat = std('#d4cbbd', 0.55, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(0.2, 0.2) })
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 1, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, emissive: new THREE.Color('#2a2824') })
  const screenMat = std('#1b1d20', 0.15, 0.2)
  const alu = std('#b9bcbf', 0.35, 1)
  const blossom = std('#f0d3d6', 0.8)
  const twig = std('#4a3b2e', 0.9)
  const bookMats = [std('#d9d2c4', 0.8), std('#8e7a62', 0.8), std('#b9a58a', 0.8)]

  /* --- shell ---------------------------------------------------------------- */
  // floor slab (house) and corridor floor
  B.add(floorMat, slab(-HX - T, HX + T, -0.3, 0, -HZ - T, HZ + T, 5))
  B.add(floorMat, slab(-4.5, -2.5, -0.3, 0, HZ + T, 11.8, 5))
  B.add(floorMat, slab(-2.8, 2.7, -0.3, 0, HZ + T, 9.9, 5))
  // long walls
  K.wallRun(B, wallMat, 'z', -HZ - T, -HZ, -HX - T, HX + T, EAVES, [GLAZE, S_WIN])
  K.wallRun(B, wallMat, 'z', HZ, HZ + T, -HX - T, HX + T, EAVES, [N_OPEN, N_WIN])
  // gable walls: pentagons with window holes, extruded through the wall
  function gable(x0, wins) {
    const s = new THREE.Shape()
    s.moveTo(-HZ, 0)
    s.lineTo(HZ, 0)
    s.lineTo(HZ, EAVES)
    s.lineTo(0, RIDGE)
    s.lineTo(-HZ, EAVES)
    s.lineTo(-HZ, 0)
    for (const w of wins) {
      const hole = new THREE.Path()
      hole.moveTo(-w.a1, w.y0)
      hole.lineTo(-w.a0, w.y0)
      hole.lineTo(-w.a0, w.y1)
      hole.lineTo(-w.a1, w.y1)
      hole.lineTo(-w.a1, w.y0)
      s.holes.push(hole)
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false, curveSegments: 1 })
    g.rotateY(Math.PI / 2) // shape x → −z, extrusion → +x
    g.translate(x0, 0, 0)
    K.planarUV(g, 3)
    B.add(wallMat, g)
  }
  gable(HX, E_WINS)
  gable(-HX - T, W_WINS)

  // pitched roof: zinc outside, white boarded ceiling inside
  const slope = Math.atan(KS)
  const run = HZ + T + 0.55
  const slopeLen = run / Math.cos(slope)
  for (const sz of [-1, 1]) {
    const L = slopeLen + 0.3
    const sc = (slopeLen - 0.3) / 2 // centre, measured along the slope from the ridge
    const n = new THREE.Vector3(0, Math.cos(slope), sz * Math.sin(slope))
    const cz = sz * sc * Math.cos(slope)
    const cy = RIDGE - sc * Math.sin(slope)
    const g = box(2 * HX + 2 * T + 1.0, 0.3, L)
    g.rotateX(sz * slope)
    g.translate(n.x * 0.17, cy + n.y * 0.17, cz + n.z * 0.17)
    K.planarUV(g, 2)
    O.add(roofMat, g)
    // ceiling boards
    const sl = Math.hypot(HZ, RIDGE - EAVES)
    B.add(
      boards,
      K.quad(
        [
          [-HX, RIDGE, 0],
          [HX, RIDGE, 0],
          [HX, EAVES, sz * HZ],
          [-HX, EAVES, sz * HZ],
        ],
        [
          [-HX / 2.4, 0],
          [HX / 2.4, 0],
          [HX / 2.4, sl / 2.4],
          [-HX / 2.4, sl / 2.4],
        ],
        new THREE.Vector3(0, -1, -sz)
      ),
      false
    )
    // zinc gutter and the fascia under the eaves
    const gz = sz * (run + 0.06)
    const gy = RIDGE - run * KS - 0.12
    O.add(chrome, rod([-HX - 0.6, gy, gz], [HX + 0.6, gy, gz], 0.075, 0.075, 10))
    for (const sx of [-1, 1]) O.add(chrome, rod([sx * (HX + 0.45), 0, gz], [sx * (HX + 0.45), gy, gz], 0.045, 0.045, 8))
  }
  // grey steel rafters following the slopes, a ridge beam, a silver duct
  const rafters = beamBatch(THREE)
  for (let x = -9.6; x <= 9.61; x += 3.2) {
    for (const sz of [-1, 1]) {
      const off = 0.14
      rafters.add(new THREE.Vector3(x, RIDGE - off / Math.cos(slope), 0), new THREE.Vector3(x, EAVES - off / Math.cos(slope) + 0.02, sz * (HZ - 0.02)), 0.12, 0.26)
    }
  }
  rafters.add(new THREE.Vector3(-HX, RIDGE - 0.2, 0), new THREE.Vector3(HX, RIDGE - 0.2, 0), 0.2, 0.3)
  inside.add(rafters.build(steel))
  {
    const dz = -1.3
    const dy = ceilY(dz) - 0.58
    const dg = rod([-HX + 0.4, dy, dz], [HX - 0.4, dy, dz], 0.17, 0.17, 20)
    B.add(duct, dg)
    for (let x = -HX + 0.4; x < HX - 0.4; x += 0.42) B.add(duct, rod([x, dy, dz], [x + 0.025, dy, dz], 0.176, 0.176, 20))
    for (let x = -8; x <= 8; x += 4) B.add(steel, rod([x, dy + 0.17, dz], [x, ceilY(dz), dz], 0.012))
  }

  // skirting boards (white, 8 cm) along the solid stretches of wall
  const skirt = (x0, x1, z0, z1) => B.add(whiteWood, slab(x0, x1, 0, 0.08, z0, z1, 1))
  skirt(-HX, N_OPEN.a0, HZ - 0.012, HZ)
  skirt(N_OPEN.a1, HX, HZ - 0.012, HZ)
  skirt(GLAZE.a1, HX, -HZ, -HZ + 0.012)
  skirt(HX - 0.012, HX, -HZ, E_WINS[0].a0)
  skirt(HX - 0.012, HX, E_WINS[0].a1, HZ)
  skirt(-HX, -HX + 0.012, -HZ, HZ)

  /* --- windows ------------------------------------------------------------------ */
  // the sliding glass wall: a frame per sash, the last bay slid open
  const zc = -HZ - T / 2
  K.glazing(frames, glassGeos, 'z', zc, GLAZE, { fw: 0.09, fd: 0.14, mullions: PANELS.slice(1, -1), skipGlass: [5] })
  for (let i = 0; i < PANELS.length - 2; i++) {
    // inner sash frames make each panel read as a door
    const o = { a0: PANELS[i] + 0.05, a1: PANELS[i + 1] - 0.05, y0: 0.05, y1: GLAZE.y1 - 0.05 }
    K.glazing(frames, [], 'z', zc + 0.04, o, { fw: 0.06, fd: 0.06 })
  }
  // the open sash, parked behind its neighbour
  K.glazing(frames, glassGeos, 'z', zc + 0.11, { a0: PANELS[4] + 0.1, a1: PANELS[5] - 0.02, y0: 0.05, y1: GLAZE.y1 - 0.05 }, { fw: 0.06, fd: 0.05 })
  K.glazing(frames, glassGeos, 'z', zc, S_WIN, { transoms: [2.25] })
  K.glazing(frames, glassGeos, 'z', HZ + T / 2, N_WIN, { mullions: [6.8] })
  K.glazing(frames, glassGeos, 'x', HX + T / 2, E_WINS[0], {})
  K.glazing(frames, glassGeos, 'x', HX + T / 2, E_WINS[1], { transoms: [3.0] })
  K.glazing(frames, glassGeos, 'x', HX + T / 2, E_WINS[2], { transoms: [2.8] })
  K.glazing(frames, glassGeos, 'x', -HX - T / 2, W_WINS[0], { fw: 0.08, fd: 0.12 })
  K.glazing(frames, glassGeos, 'x', -HX - T / 2, W_WINS[1], {})
  K.glazing(frames, glassGeos, 'x', -HX - T / 2, W_WINS[2], {})
  // inside sills (oak) under the gable windows
  B.add(oak, slab(HX - 0.04, HX + 0.02, E_WINS[0].y0 - 0.03, E_WINS[0].y0, E_WINS[0].a0, E_WINS[0].a1, 1))

  // sheer curtains gathered at the west end of the glass, on a ceiling track
  B.add(curtainMat, K.curtain(-10.55, -8.7, 0.03, 3.0, -HZ + 0.22, { period: 0.13, amp: 0.06, seed: 3 }), false)
  B.add(curtainMat, K.curtain(-5.95, -5.15, 0.03, 3.0, -HZ + 0.22, { period: 0.1, amp: 0.07, seed: 4 }), false)
  B.add(alu, slab(-10.6, 4.0, 3.02, 3.05, -HZ + 0.19, -HZ + 0.25, 1))

  /* --- behind the oak-and-glass screen: a beamed corridor and a glazed den --------- */
  // The screen fills N_OPEN: an open passage (x -4.2..-2.8) into the corridor,
  // an oak post, then a glazed bay with a glass door into a small den with a
  // picture window onto the fields (laura-03 is taken looking through it).
  const CW = { x0: -4.2, x1: -2.8, z1: 11.5, h: 2.7 }
  const DEN = { x0: -2.5, x1: 2.4, z1: 9.6 }
  const CWIN = { a0: 7.6, a1: 8.8, y0: 0.9, y1: 2.2 }
  const DWIN = { a0: -1.7, a1: 1.5, y0: 0.4, y1: 2.35 }
  K.wallRun(B, wallMat, 'x', CW.x0 - T, CW.x0, HZ + T, CW.z1 + T, CW.h + 0.3, [CWIN])
  K.wallRun(B, wallMat, 'x', CW.x1, CW.x1 + T, HZ + T, CW.z1 + T, CW.h + 0.3, [])
  B.add(wallMat, slab(CW.x0, CW.x1, 0, CW.h + 0.3, CW.z1, CW.z1 + T))
  B.add(wallMat, slab(CW.x0, CW.x1, CW.h, CW.h + 0.3, HZ + T, CW.z1, 3))
  O.add(roofMat, slab(CW.x0 - T - 0.1, CW.x1 + T + 0.05, CW.h + 0.3, CW.h + 0.5, HZ + T, CW.z1 + T + 0.1, 2))
  // the den: its own walls, ceiling and roof
  K.wallRun(B, wallMat, 'z', DEN.z1, DEN.z1 + T, CW.x1 + T, DEN.x1 + T, CW.h + 0.3, [DWIN])
  K.wallRun(B, wallMat, 'x', DEN.x1, DEN.x1 + T, HZ + T, DEN.z1, CW.h + 0.3, [])
  B.add(wallMat, slab(DEN.x0, DEN.x1, CW.h, CW.h + 0.3, HZ + T, DEN.z1, 3))
  O.add(roofMat, slab(DEN.x0 - 0.05, DEN.x1 + T + 0.1, CW.h + 0.3, CW.h + 0.5, HZ + T, DEN.z1 + T + 0.1, 2))
  K.glazing(frames, glassGeos, 'z', DEN.z1 + T / 2, DWIN, { mullions: [-0.1], fw: 0.08 })
  B.add(oak, slab(DWIN.a0, DWIN.a1, DWIN.y0 - 0.03, DWIN.y0, DEN.z1 - 0.05, DEN.z1 + 0.02, 1))
  // white painted joists across corridor and den (laura-03)
  for (let z = HZ + 0.55; z < CW.z1 - 0.2; z += 0.7) B.add(whiteWood, slab(CW.x0, CW.x1, CW.h - 0.24, CW.h, z, z + 0.14, 1))
  for (let z = HZ + 0.55; z < DEN.z1 - 0.2; z += 0.7) B.add(whiteWood, slab(DEN.x0, DEN.x1, CW.h - 0.24, CW.h, z, z + 0.14, 1))
  K.glazing(frames, glassGeos, 'x', CW.x0 - T / 2, CWIN, { mullions: [8.2] })
  // the door at the end of the corridor, a second door in its east wall
  const doorAt = (x0, x1, z, dir) => {
    B.add(whiteWood, slab(x0, x1, 0, 2.15, z - 0.04, z, 1))
    B.add(whiteWood, slab(x0 - 0.08, x1 + 0.08, 2.15, 2.22, z - 0.05, z, 1))
    B.add(whiteWood, slab(x0 - 0.08, x0, 0, 2.15, z - 0.05, z, 1))
    B.add(whiteWood, slab(x1, x1 + 0.08, 0, 2.15, z - 0.05, z, 1))
    B.add(black, rod([x1 - 0.1, 1.02, z - 0.05], [x1 - 0.1, 1.02, z - 0.1], 0.01))
    B.add(black, rod([x1 - 0.1, 1.02, z - 0.1], [x1 - 0.25 * dir, 1.02, z - 0.1], 0.01))
  }
  doorAt(-3.95, -3.05, CW.z1, 1)
  {
    // a white door on the corridor's east wall (seen at the right in laura-03)
    const z0 = 9.9
    const z1 = 10.8
    const x = CW.x1 - 0.002
    B.add(whiteWood, slab(x - 0.04, x, 0, 2.15, z0, z1, 1))
    B.add(whiteWood, slab(x - 0.05, x, 2.15, 2.22, z0 - 0.08, z1 + 0.08, 1))
    B.add(whiteWood, slab(x - 0.05, x, 0, 2.15, z0 - 0.08, z0, 1))
    B.add(whiteWood, slab(x - 0.05, x, 0, 2.15, z1, z1 + 0.08, 1))
    B.add(black, rod([x - 0.05, 1.02, z0 + 0.1], [x - 0.1, 1.02, z0 + 0.1], 0.01))
    B.add(black, rod([x - 0.1, 1.02, z0 + 0.1], [x - 0.1, 1.02, z0 + 0.25], 0.01))
  }
  // cane chair against the corridor's west wall
  {
    const cane = std('#b8945f', 0.8)
    const p = [-3.92, 0, 9.0]
    const r = [0, Math.PI / 2, 0]
    B.parts(
      [
        [walnut, box(0.46, 0.03, 0.44).translate(0, 0.46, 0)],
        [cane, box(0.4, 0.012, 0.38).translate(0, 0.478, 0)],
        [cane, box(0.4, 0.3, 0.012).translate(0, 0.72, -0.2)],
        [walnut, box(0.46, 0.04, 0.03).translate(0, 0.89, -0.21)],
        ...[-1, 1].flatMap((sx) => [
          [walnut, box(0.035, 0.46, 0.035).translate(sx * 0.21, 0.23, 0.2)],
          [walnut, box(0.035, 0.91, 0.035).translate(sx * 0.21, 0.455, -0.2)],
        ]),
      ],
      p,
      r
    )
  }
  // oak screen in the opening: the passage, a post, a glazed bay with a glass door
  {
    const zc2 = HZ + T / 2
    const GX0 = CW.x1
    const GX1 = N_OPEN.a1
    const post = (x, w = 0.045) => B.add(oak, slab(x - w, x + w, 0, CW.h, zc2 - 0.05, zc2 + 0.05, 1))
    post(GX0 + 0.06, 0.06)
    post(GX1 - 0.05)
    post(GX0 + 1.0, 0.035) // the glass door's hanging stile
    B.add(oak, slab(GX0, GX1, CW.h - 0.09, CW.h, zc2 - 0.05, zc2 + 0.05, 1))
    B.add(oak, slab(CW.x0, GX0, CW.h - 0.09, CW.h, zc2 - 0.05, zc2 + 0.05, 1))
    B.add(oak, slab(GX0, GX1, 0, 0.06, zc2 - 0.04, zc2 + 0.04, 1))
    for (const y of [0.95, 1.22]) B.add(oak, slab(GX0, GX1, y - 0.022, y + 0.022, zc2 - 0.03, zc2 + 0.03, 1))
    // the door's lever handle
    B.add(chrome, rod([GX0 + 0.92, 1.05, zc2 - 0.04], [GX0 + 0.92, 1.05, zc2 - 0.1], 0.01))
    B.add(chrome, rod([GX0 + 0.92, 1.05, zc2 - 0.1], [GX0 + 0.75, 1.05, zc2 - 0.1], 0.01))
    const g = new THREE.PlaneGeometry(GX1 - GX0, CW.h - 0.15)
    g.translate((GX0 + GX1) / 2, (CW.h - 0.15) / 2 + 0.06, zc2)
    glassGeos.push(g)
  }
  // the den: a cream sofa under the window, a pebble pendant, a side table
  const denSofaAt = { p: [-0.1, 0, DEN.z1 - 0.62], r: [0, Math.PI, 0], s: [0.85, 1, 1] }
  /* --- kitchen: travertine island, back run, open shelf ---------------------------- */
  const ISL = { x: 6.0, z: 2.5, w: 3.0, d: 1.05, h: 0.92 }
  {
    const g = rbox(ISL.w, ISL.h, ISL.d, 0.012, 2)
    g.translate(ISL.x, ISL.h / 2, ISL.z)
    K.planarUV(g, 1.4)
    B.add(marble, g)
  }
  // bar stools (walnut, splayed legs, foot rails)
  {
    const parts = [[walnut, cyl(0.19, 0.185, 0.045, 32).translate(0, 0.6375, 0)]]
    const corners = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ]
    for (const [sx, sz] of corners) parts.push([walnut, rod([sx * 0.11, 0.62, sz * 0.11], [sx * 0.17, 0, sz * 0.17], 0.017, 0.02, 8)])
    const rr = 0.11 + 0.06 * ((0.62 - 0.24) / 0.62)
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i]
      const [bx, bz] = corners[(i + 1) % 4]
      parts.push([walnut, rod([ax * rr, 0.24, az * rr], [bx * rr, 0.24, bz * rr], 0.011)])
    }
    for (const x of [5.0, 5.75, 6.5]) B.parts(parts, [x, 0, ISL.z - 0.86], [0, rand() * 2, 0])
  }
  // back run along the north wall: cabinets with handleless fronts
  {
    const z0 = HZ - 0.65
    const x0 = 2.9
    const x1 = 9.5
    B.add(black, slab(x0, x1, 0, 0.1, z0 + 0.06, HZ, 1))
    B.add(cabinetMat, slab(x0, x1, 0.1, 0.87, z0 + 0.02, HZ, 1))
    for (let x = x0; x < x1 - 0.05; x += 0.6) {
      const g = rbox(0.594, 0.74, 0.02, 0.004, 1)
      g.translate(x + 0.3, 0.485, z0 + 0.01)
      B.add(cabinetMat, g)
    }
    B.add(marble, K.planarUV(rbox(x1 - x0 + 0.02, 0.04, 0.67, 0.006, 1).translate((x0 + x1) / 2, 0.89, HZ - 0.335), 1.4))
    B.add(marble, slab(x0, x1, 0.91, 1.06, HZ - 0.02, HZ, 1.4))
    // tall units up to the fridge column
    B.add(cabinetMat, slab(9.6, HX, 0, 2.4, z0 + 0.02, HZ, 1))
    for (let x = 9.6; x < HX - 0.05; x += 0.7) {
      const g = rbox(0.694, 2.38, 0.02, 0.004, 1)
      g.translate(x + 0.35, 1.2, z0 + 0.01)
      B.add(cabinetMat, g)
    }
    // sink and tap, hob
    B.add(black, slab(6.1, 6.9, 0.905, 0.912, HZ - 0.55, HZ - 0.12, 1))
    B.add(chrome, rod([6.5, 0.91, HZ - 0.08], [6.5, 1.25, HZ - 0.08], 0.015))
    B.add(chrome, rod([6.5, 1.25, HZ - 0.08], [6.5, 1.25, HZ - 0.3], 0.013))
    B.add(chrome, rod([6.5, 1.25, HZ - 0.3], [6.5, 1.17, HZ - 0.3], 0.012))
    B.add(screenMat, slab(3.4, 4.2, 0.91, 0.916, HZ - 0.58, HZ - 0.08, 1))
    // open oak shelf with stoneware
    B.add(oak, slab(3.0, 4.95, 1.62, 1.66, HZ - 0.28, HZ, 1))
    B.add(ceramic, lathe([[0, 0], [0.07, 0], [0.09, 0.08], [0.06, 0.2], [0.035, 0.26], [0.04, 0.29], [0, 0.29]], 24).translate(3.3, 1.66, HZ - 0.14))
    B.add(ceramicDark, lathe([[0, 0], [0.1, 0], [0.12, 0.06], [0.08, 0.16], [0, 0.16]], 24).translate(3.7, 1.66, HZ - 0.14))
    for (let i = 0; i < 4; i++) B.add(ceramic, cyl(0.12 - i * 0.004, 0.1 - i * 0.004, 0.025, 24).translate(4.3, 1.672 + i * 0.026, HZ - 0.14))
    B.add(ceramic, lathe([[0, 0], [0.05, 0], [0.11, 0.07], [0.14, 0.09], [0, 0.03]], 24).translate(4.7, 1.66, HZ - 0.14))
  }
  // on the island: a sculptural vase of blossom branches, books, a laptop
  {
    B.add(ceramic, lathe([[0, 0], [0.08, 0], [0.11, 0.06], [0.09, 0.14], [0.05, 0.19], [0.1, 0.27], [0.12, 0.33], [0.06, 0.4], [0.035, 0.44], [0.04, 0.47], [0, 0.47]], 32).translate(7.05, ISL.h, ISL.z + 0.15))
    const base = [7.05, ISL.h + 0.42, ISL.z + 0.15]
    const blooms = []
    for (let b = 0; b < 5; b++) {
      let p = base.slice()
      let dir = new THREE.Vector3(range(rand, -0.35, 0.35), 1, range(rand, -0.35, 0.35)).normalize()
      for (let s = 0; s < 6; s++) {
        const len = range(rand, 0.12, 0.2)
        const np = [p[0] + dir.x * len, p[1] + dir.y * len, p[2] + dir.z * len]
        B.add(twig, rod(p, np, 0.008 - s * 0.001, 0.007 - s * 0.001, 5))
        for (let k = 0; k < 5; k++) blooms.push(sphere(range(rand, 0.012, 0.02), 6, 4).translate(np[0] + range(rand, -0.06, 0.06), np[1] + range(rand, -0.05, 0.05), np[2] + range(rand, -0.06, 0.06)))
        p = np
        dir.add(new THREE.Vector3(range(rand, -0.3, 0.3), range(rand, -0.05, 0.1), range(rand, -0.3, 0.3))).normalize()
      }
    }
    for (const g of blooms) B.add(blossom, g)
    B.add(bookMats[0], rbox(0.24, 0.03, 0.32, 0.004, 1).translate(6.2, ISL.h + 0.015, ISL.z + 0.2))
    B.add(bookMats[1], rbox(0.22, 0.025, 0.3, 0.004, 1).translate(6.21, ISL.h + 0.043, ISL.z + 0.19))
    // laptop: base and screen hinged open
    B.add(alu, rbox(0.31, 0.014, 0.22, 0.004, 1).translate(5.35, ISL.h + 0.007, ISL.z - 0.18))
    const scr = rbox(0.31, 0.21, 0.008, 0.003, 1)
    scr.translate(0, 0.105, 0)
    scr.rotateX(0.28)
    scr.translate(5.35, ISL.h + 0.014, ISL.z - 0.07)
    B.add(alu, scr)
  }

  /* --- dining: walnut table, bouclé chairs, pebble pendants ------------------------- */
  const TAB = { x: -1.0, z: -1.5 }
  {
    B.add(walnut, rbox(3.2, 0.06, 1.0, 0.012, 2).translate(TAB.x, 0.72, TAB.z))
    B.add(walnut, rbox(2.1, 0.69, 0.07, 0.01, 1).translate(TAB.x, 0.345, TAB.z))
    for (const sx of [-1, 1]) B.add(walnut, rbox(0.07, 0.69, 0.72, 0.01, 1).translate(TAB.x + sx * 1.05, 0.345, TAB.z))
    // dining chairs: a padded seat, a curved padded back on a stem, black steel legs
    const chair = []
    chair.push([boucle, rbox(0.5, 0.075, 0.47, 0.035).translate(0, 0.47, 0.02)])
    const arc = 2.5
    const ring = new THREE.TorusGeometry(0.235, 0.048, 10, 24, arc)
    ring.rotateX(-Math.PI / 2)
    ring.rotateY(Math.PI / 2 - arc / 2)
    ring.translate(0, 0.79, 0)
    chair.push([boucle, ring])
    chair.push([boucle, rbox(0.13, 0.28, 0.05, 0.02).translate(0, 0.63, -0.215)])
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) chair.push([black, rod([sx * 0.19, 0.44, sz * 0.17], [sx * 0.23, 0, sz * 0.21], 0.011)])
    for (const x of [-2.2, -1.4, -0.6, 0.2]) {
      B.parts(chair, [x + range(rand, -0.04, 0.04), 0, TAB.z - 0.72], [0, range(rand, -0.06, 0.06), 0])
      B.parts(chair, [x + range(rand, -0.04, 0.04), 0, TAB.z + 0.72], [0, Math.PI + range(rand, -0.06, 0.06), 0])
    }
    // on the table: a turned bowl, a coral-like sculpture, a stoneware jug
    B.add(walnut, lathe([[0, 0], [0.06, 0], [0.13, 0.05], [0.15, 0.09], [0.14, 0.095], [0.12, 0.06], [0, 0.03]], 32).translate(TAB.x + 0.6, 0.75, TAB.z + 0.1))
    {
      const coral = new THREE.IcosahedronGeometry(0.11, 2)
      const p = coral.attributes.position
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i)
        const y = p.getY(i)
        const z = p.getZ(i)
        const k = 1 + 0.35 * Math.sin(x * 40) * Math.sin(y * 37) * Math.sin(z * 33)
        p.setXYZ(i, x * k, y * k * 0.8, z * k)
      }
      B.add(ceramic, coral.translate(TAB.x - 0.4, 0.84, TAB.z - 0.05))
      B.add(black, rod([TAB.x - 0.4, 0.75, TAB.z - 0.05], [TAB.x - 0.4, 0.76, TAB.z - 0.05], 0.05))
    }
    B.add(ceramicDark, lathe([[0, 0], [0.06, 0], [0.08, 0.1], [0.05, 0.2], [0.04, 0.24], [0, 0.24]], 24).translate(TAB.x - 1.2, 0.75, TAB.z + 0.15))
    // pendants: three pebble shades, glowing warm inside
    const prof = [[0.0, 0.34], [0.06, 0.335], [0.16, 0.31], [0.25, 0.26], [0.31, 0.18], [0.335, 0.09], [0.33, 0.03], [0.31, 0.0]]
    const inner = prof.map(([r, y]) => [r * 0.95, y * 0.96 + 0.005])
    ;[
      [-2.0, 1.72, 0.85, 0.12],
      [-1.0, 1.66, 1.0, -0.1],
      [0.0, 1.76, 0.92, 0.18],
    ].forEach(([x, y, s, tilt]) => {
      const pos = [x, y, TAB.z]
      const rot = [tilt, x * 1.3, 0]
      B.add(shadeMat, tf(lathe(prof, 40), pos, rot, [s, s * 0.8, s * 0.95]), true)
      B.add(shadeGlow, tf(lathe(inner, 40), pos, rot, [s, s * 0.8, s * 0.95]), false)
      B.add(bulb, sphere(0.035, 12, 8).translate(x, y + 0.06, TAB.z), false)
      B.add(black, rod([x, y + 0.26 * s, TAB.z], [x, ceilY(TAB.z), TAB.z], 0.004, 0.004, 4), false)
    })
    const pl = new THREE.PointLight(0xffb06a, 4, 8, 2)
    pl.position.set(TAB.x, 1.6, TAB.z)
    inside.add(pl)
  }
  // island globes
  {
    for (const x of [5.25, 6.75]) {
      B.add(opal, sphere(0.16, 32, 20).translate(x, 2.12, ISL.z), false)
      B.add(alu, cyl(0.03, 0.03, 0.05, 12).translate(x, 2.3, ISL.z))
      B.add(black, rod([x, 2.32, ISL.z], [x, ceilY(ISL.z), ISL.z], 0.004, 0.004, 4), false)
    }
    const pl = new THREE.PointLight(0xffc28a, 2.2, 7, 2)
    pl.position.set(ISL.x, 1.95, ISL.z)
    inside.add(pl)
  }

  /* --- living: bouclé sofa, rust lounge chair, fluted wood tables, rug ----------- */
  {
    // the sofa (local: seat faces +z, centred on x)
    const sofa = []
    sofa.push([boucle, rbox(2.6, 0.26, 0.96, 0.07, 4).translate(0, 0.19, 0)])
    for (const sx of [-1, 1]) sofa.push([boucle, rbox(1.25, 0.19, 0.8, 0.08, 4).translate(sx * 0.64, 0.4, 0.07)])
    sofa.push([boucle, rbox(2.6, 0.48, 0.25, 0.11, 4).translate(0, 0.5, -0.36)])
    for (const sx of [-1, 1]) sofa.push([boucle, tf(rbox(1.22, 0.44, 0.2, 0.1, 4), [sx * 0.63, 0.66, -0.2], [-0.14, 0, 0])])
    for (const sx of [-1, 1]) sofa.push([boucle, rbox(0.24, 0.44, 0.96, 0.11, 4).translate(sx * 1.38, 0.4, 0)])
    sofa.push([black, box(2.5, 0.06, 0.82).translate(0, 0.03, 0)])
    sofa.push([linenRust, tf(rbox(0.46, 0.44, 0.14, 0.09, 4), [-0.8, 0.68, -0.05], [-0.25, 0.2, 0.05])])
    sofa.push([linen, tf(rbox(0.52, 0.5, 0.15, 0.1, 4), [0.75, 0.7, -0.06], [-0.22, -0.15, -0.04])])
    sofa.push([boucle, tf(new THREE.SphereGeometry(0.2, 24, 16).scale(1, 0.62, 1), [0.25, 0.63, 0.05], [0, 0, 0])])
    B.parts(sofa, [-9.35, 0, -0.6], [0, Math.PI / 2, 0])
    // the same sofa, shorter, in the den; and a cream modular one by the east gable
    B.parts(sofa, denSofaAt.p, denSofaAt.r, denSofaAt.s)
    B.parts(sofa, [10.3, 0, 2.35], [0, -Math.PI / 2, 0])
    // lounge chair, rust velvet, deep and slouchy
    const lounge = []
    lounge.push([velvet, rbox(0.92, 0.34, 0.95, 0.15, 5).translate(0, 0.17, 0.02)])
    lounge.push([velvet, tf(rbox(0.92, 0.72, 0.34, 0.16, 5), [0, 0.46, -0.32], [-0.32, 0, 0])])
    for (let i = 0; i < 3; i++) lounge.push([velvet, tf(new THREE.CapsuleGeometry(0.055, 0.72, 4, 10), [0, 0.36 + i * 0.17, -0.18 - i * 0.055], [-0.32, 0, Math.PI / 2])])
    lounge.push([velvet, tf(new THREE.CapsuleGeometry(0.07, 0.75, 4, 10), [0, 0.34, 0.42], [0, 0, Math.PI / 2])])
    B.parts(lounge, [-6.7, 0, -2.85], [0, -0.55, 0])
    // pebble coffee table on a fluted base
    const pebble = new THREE.Shape()
    const NP = 48
    for (let i = 0; i <= NP; i++) {
      const a = (i / NP) * Math.PI * 2
      const r = 0.5 + 0.06 * Math.sin(2 * a + 0.6) + 0.04 * Math.sin(3 * a + 1.3)
      const x = Math.cos(a) * r * 1.45
      const y = Math.sin(a) * r
      if (i === 0) pebble.moveTo(x, y)
      else pebble.lineTo(x, y)
    }
    const top = new THREE.ExtrudeGeometry(pebble, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 })
    top.rotateX(-Math.PI / 2)
    top.translate(0, 0.34, 0)
    K.planarUV(top, 1)
    const ct = [[travertine, top]]
    ct.push([walnut, K.planarUV(K.flute(cyl(0.27, 0.27, 0.33, 72), 22, 0.05).translate(-0.3, 0.165, 0.02), 1)])
    ct.push([walnut, K.planarUV(K.flute(cyl(0.2, 0.2, 0.33, 60), 18, 0.05).translate(0.38, 0.165, -0.05), 1)])
    B.parts(ct, [-7.85, 0, -0.8], [0, 0.25, 0])
    // on it (laura-02): a stack of turned wood coasters, an hourglass travertine
    // candle holder with a twisted ivory candle, books, a stoneware vase
    for (let i = 0; i < 5; i++) B.add(walnut, cyl(0.055, 0.055, 0.011, 28).translate(-7.55 + (i % 2) * 0.004, 0.405 + i * 0.012, -1.05))
    B.add(travertine, lathe([[0, 0], [0.05, 0], [0.052, 0.02], [0.03, 0.07], [0.022, 0.1], [0.03, 0.13], [0.05, 0.18], [0.045, 0.2], [0, 0.2]], 28).translate(-7.3, 0.4, -1.2))
    {
      // the twisted candle: a lathe whose radius ripples, spun up the height
      const cg = new THREE.CylinderGeometry(0.018, 0.018, 0.2, 12, 24)
      const pp = cg.attributes.position
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i)
        const y = pp.getY(i)
        const z = pp.getZ(i)
        const a = Math.atan2(z, x) + y * 40
        const k = 1 + 0.35 * Math.cos(a * 2)
        pp.setX(i, x * k)
        pp.setZ(i, z * k)
      }
      cg.computeVertexNormals()
      B.add(std('#f1ebdf', 0.6), cg.translate(-7.3, 0.7, -1.2))
    }
    B.add(bookMats[2], rbox(0.3, 0.04, 0.23, 0.004, 1).translate(-8.25, 0.42, -0.55))
    B.add(bookMats[0], rbox(0.26, 0.03, 0.2, 0.004, 1).translate(-8.25, 0.455, -0.54))
    B.add(ceramic, lathe([[0, 0], [0.06, 0], [0.075, 0.08], [0.045, 0.16], [0.05, 0.3], [0.03, 0.34], [0, 0.34]], 24).translate(-8.45, 0.4, -1.0))
    // fluted side table by the sofa
    B.add(walnut, K.planarUV(K.flute(cyl(0.22, 0.22, 0.48, 64), 20, 0.05).translate(-9.35, 0.24, 1.02), 1))
    B.add(travertine, K.planarUV(cyl(0.25, 0.25, 0.03, 48).translate(-9.35, 0.495, 1.02), 1))
    B.add(ceramicDark, lathe([[0, 0], [0.05, 0], [0.07, 0.05], [0.07, 0.09], [0, 0.09]], 20).translate(-9.3, 0.51, 1.02))
    // forsythia branches in a tall stoneware jar in the corner (laura-02)
    {
      const jx = -10.55
      const jz = 0.78
      B.add(ceramicDark, lathe([[0, 0], [0.11, 0], [0.15, 0.2], [0.13, 0.42], [0.08, 0.5], [0.09, 0.55], [0, 0.55]], 28).translate(jx, 0, jz))
      const br = seeded(41)
      const blooms = []
      for (let b = 0; b < 7; b++) {
        let p = [jx, 0.5, jz]
        const dir = new THREE.Vector3(range(br, -0.4, 0.5), 1, range(br, -0.5, 0.4)).normalize()
        for (let k = 0; k < 7; k++) {
          const len = range(br, 0.13, 0.22)
          const np = [p[0] + dir.x * len, p[1] + dir.y * len, p[2] + dir.z * len]
          B.add(twig, rod(p, np, 0.007, 0.005, 4))
          for (let f = 0; f < 4; f++) blooms.push(new THREE.OctahedronGeometry(range(br, 0.014, 0.022), 0).translate(np[0] + range(br, -0.05, 0.05), np[1] + range(br, -0.06, 0.03), np[2] + range(br, -0.05, 0.05)))
          p = np
          dir.add(new THREE.Vector3(range(br, -0.25, 0.25), 0.02, range(br, -0.25, 0.25))).normalize()
        }
      }
      for (const g of blooms) B.add(forsythia, g, false)
    }
    // rug: a soft-cornered wool rectangle
    const rugShape = new THREE.Shape()
    const rw = 1.75
    const rd = 1.45
    const rr = 0.25
    rugShape.moveTo(-rw + rr, -rd)
    rugShape.lineTo(rw - rr, -rd)
    rugShape.quadraticCurveTo(rw, -rd, rw, -rd + rr)
    rugShape.lineTo(rw, rd - rr)
    rugShape.quadraticCurveTo(rw, rd, rw - rr, rd)
    rugShape.lineTo(-rw + rr, rd)
    rugShape.quadraticCurveTo(-rw, rd, -rw, rd - rr)
    rugShape.lineTo(-rw, -rd + rr)
    rugShape.quadraticCurveTo(-rw, -rd, -rw + rr, -rd)
    const rug = new THREE.ExtrudeGeometry(rugShape, { depth: 0.014, bevelEnabled: false, curveSegments: 6 })
    rug.rotateX(-Math.PI / 2)
    rug.translate(-7.9, 0.0, -0.8)
    K.planarUV(rug, 0.6)
    B.add(rugMat, rug)
    // a globe floor lamp in the corner (off)
    B.add(alu, cyl(0.16, 0.18, 0.02, 32).translate(-10.4, 0.01, 3.9))
    B.add(alu, rod([-10.4, 0, 3.9], [-10.4, 1.42, 3.9], 0.012))
    B.add(std('#f4f1ea', 0.35), sphere(0.2, 32, 20).translate(-10.4, 1.6, 3.9))
  }

  /* --- the textured artwork with a wooden chair, the limewash wall, a console ------ */
  {
    const ax = -8.65
    B.add(artMat, K.planarUV(box(1.3, 1.8, 0.04).translate(ax, 1.75, HZ - 0.04), 1.3))
    const f = 0.03
    for (const [w, h, x, y] of [
      [1.36, f, 0, 0.9 + f / 2],
      [1.36, f, 0, -0.9 - f / 2],
      [f, 1.86, 0.65 + f / 2, 0],
      [f, 1.86, -0.65 - f / 2, 0],
    ])
      B.add(oak, K.planarUV(box(w, h, 0.06).translate(ax + x, 1.75 + y, HZ - 0.03), 1))
    // a solid wood chair in front of it
    const ch = []
    ch.push([oak, K.planarUV(rbox(0.46, 0.045, 0.43, 0.01, 1).translate(0, 0.45, 0), 1)])
    ch.push([oak, K.planarUV(tf(rbox(0.46, 0.4, 0.035, 0.01, 1), [0, 0.74, -0.2], [-0.1, 0, 0]), 1)])
    for (const sx of [-1, 1]) {
      ch.push([oak, box(0.04, 0.43, 0.04).translate(sx * 0.2, 0.215, 0.18)])
      ch.push([oak, box(0.04, 0.45, 0.04).translate(sx * 0.2, 0.225, -0.18)])
    }
    ch.push([oak, box(0.4, 0.035, 0.025).translate(0, 0.16, 0.18)])
    B.parts(ch, [ax + 0.05, 0, HZ - 0.55], [0, Math.PI + 0.15, 0])
    // the limewash feature wall (laura-08): a hand-trowelled panel, full height
    const LW = { x0: -7.55, x1: -4.45 }
    B.add(limewash, K.planarUV(box(LW.x1 - LW.x0, EAVES - 0.08, 0.012).translate((LW.x0 + LW.x1) / 2, 0.08 + (EAVES - 0.08) / 2, HZ - 0.006), 2.6))
    B.add(whiteWood, slab(LW.x0, LW.x1, 0, 0.08, HZ - 0.016, HZ - 0.012, 1))
    // a bouclé stool on black hairpin legs in front of it
    {
      const st = []
      st.push([boucle, rbox(0.4, 0.07, 0.4, 0.03, 3).translate(0, 0.47, 0)])
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) st.push([black, rod([sx * 0.13, 0.44, sz * 0.13], [sx * 0.17, 0, sz * 0.17], 0.009)])
      st.push([black, box(0.3, 0.012, 0.3).translate(0, 0.435, 0)])
      B.parts(st, [-6.0, 0, HZ - 0.55], [0, 0.1, 0])
    }
    // walnut console right of the screen, with vessels
    const cx = 1.65
    B.add(walnut, K.planarUV(rbox(1.7, 0.04, 0.38, 0.006, 1).translate(cx, 0.8, HZ - 0.2), 1))
    for (const sx of [-1, 1]) B.add(walnut, K.planarUV(box(0.04, 0.78, 0.36).translate(cx + sx * 0.8, 0.39, HZ - 0.2), 1))
    B.add(ceramic, lathe([[0, 0], [0.09, 0], [0.13, 0.12], [0.1, 0.3], [0.05, 0.38], [0.055, 0.42], [0, 0.42]], 28).translate(cx - 0.45, 0.82, HZ - 0.2))
    B.add(ceramicDark, lathe([[0, 0], [0.08, 0], [0.1, 0.09], [0.07, 0.17], [0, 0.17]], 24).translate(cx + 0.15, 0.82, HZ - 0.22))
    B.add(bookMats[1], rbox(0.28, 0.05, 0.22, 0.004, 1).translate(cx + 0.5, 0.845, HZ - 0.2))
  }

  /* --- the sitting corner by the east gable: a brown velvet lounger, a Zig-Zag chair -- */
  {
    // a low, quilted, backless-looking lounger (the Togo look): rolls of padding
    const togo = []
    togo.push([velvetBrown, rbox(0.95, 0.3, 0.92, 0.14, 5).translate(0, 0.15, 0.06)])
    for (let i = 0; i < 4; i++) togo.push([velvetBrown, tf(new THREE.CapsuleGeometry(0.11, 0.72, 4, 12), [0, 0.32 + i * 0.13, -0.24 - i * 0.07], [-0.5, 0, Math.PI / 2])])
    for (const sx of [-1, 1]) togo.push([velvetBrown, tf(new THREE.CapsuleGeometry(0.1, 0.62, 4, 10), [sx * 0.42, 0.33, 0.02], [Math.PI / 2, 0, 0])])
    togo.push([velvetBrown, tf(new THREE.CapsuleGeometry(0.1, 0.72, 4, 10), [0, 0.3, 0.45], [0, 0, Math.PI / 2])])
    B.parts(togo, [8.45, 0, -0.85], [0, -Math.PI / 2 + 0.35, 0])
    // the Zig-Zag chair: four oak planks
    const zz = []
    const pl = (w, len, ang, p) => zz.push([oak, K.planarUV(tf(box(w, 0.022, len), p, [ang, 0, 0]), 1)])
    pl(0.38, 0.4, 0, [0, 0.011, 0.02]) // foot
    pl(0.38, 0.62, -(Math.PI / 2 - 0.86), [0, 0.22, 0.02]) // the diagonal
    pl(0.38, 0.4, 0, [0, 0.43, 0.02]) // seat
    pl(0.38, 0.42, Math.PI / 2, [0, 0.64, -0.17]) // back
    B.parts(zz, [9.25, 0, -2.55], [0, -2.2, 0])
    // two fluted side tables with travertine tops, a ceramic bowl
    for (const [x, z, r, h] of [
      [9.35, 0.45, 0.24, 0.42],
      [8.95, 0.95, 0.19, 0.34],
    ]) {
      B.add(walnut, K.planarUV(K.flute(cyl(r - 0.02, r - 0.02, h, 56), 18, 0.05).translate(x, h / 2, z), 1))
      B.add(travertine, K.planarUV(cyl(r, r, 0.03, 48).translate(x, h + 0.015, z), 1))
    }
    B.add(ceramic, lathe([[0, 0], [0.05, 0], [0.12, 0.05], [0.14, 0.08], [0, 0.03]], 24).translate(9.35, 0.45, 0.45))
    // a round wool rug under it all
    const rg = new THREE.CircleGeometry(1.5, 64).rotateX(-Math.PI / 2)
    rg.translate(8.9, 0.008, -0.3)
    K.planarUV(rg, 0.6)
    B.add(rugMat, rg)
  }

  /* --- olive trees in stone planters ---------------------------------------------- */
  const olives = [
    { x: -10.25, z: -2.75, h: 3.1, pot: 0.72, r: 0.5 }, // laura-01: big round planter, the slit window behind
    { x: 9.9, z: 0.15, h: 2.6, pot: 0.55, r: 0.39 },
    { x: 1.7, z: 8.6, h: 2.1, pot: 0.45, r: 0.32 }, // in the den
  ]
  for (const o of olives) {
    const k = o.r / 0.39
    B.add(potMat, lathe([[0, 0], [0.3 * k, 0], [0.36 * k, 0.06], [0.385 * k, o.pot * 0.6], [0.37 * k, o.pot - 0.04], [0.36 * k, o.pot], [0.33 * k, o.pot], [0.32 * k, o.pot - 0.04], [0, o.pot - 0.04]], 40).translate(o.x, 0, o.z))
    B.add(soil, cyl(0.335 * k, 0.335 * k, 0.02, 30).translate(o.x, o.pot - 0.03, o.z))
  }
  addForest(
    THREE,
    inside,
    olives.map((o) => ({ x: o.x, y: o.pot - 0.05, z: o.z, h: o.h })),
    { species: 'olive', seed: 12, quality: q }
  )

  /* --- glass, frames ----------------------------------------------------------------- */
  inside.add(frames.build(frameMat))
  {
    const g = K.batcher()
    for (const gg of glassGeos) g.add(glass, gg, false)
    g.build(inside)
  }

  /* --- outside: terrace, garden, flat fields, tree lines, barns ---------------------- */
  const lawnMat = M.lawn(THREE, { color: '#64753e', worn: 0.08, tile: 3, quality: q, seed: 14 })
  const terraceMat = M.paving(THREE, { kind: 'flags', color: '#bcb6ab', joint: '#8f8a82', unit: 0.6, tile: 4, quality: q, seed: 16 })
  const gravelMat = M.sand(THREE, { color: '#a9a397', ripples: false, tile: 2, quality: q, seed: 18 })
  // patchwork of fields seen from human height
  {
    const S2 = low ? 512 : 1024
    const c = K.canvas(S2)
    const g = c.getContext('2d')
    const crops = ['#6f7d45', '#7a894b', '#68583f', '#9f9667', '#848a55', '#5f6e3b', '#a39a6b']
    let x = 0
    while (x < S2) {
      const w = range(rand, 40, 140) * (S2 / 1024)
      const col = crops[Math.floor(rand() * crops.length)]
      g.fillStyle = col
      g.fillRect(x, 0, w, S2)
      for (let y = 0; y < S2; y += 3) {
        g.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`
        g.fillRect(x, y, w, 1)
      }
      g.fillStyle = 'rgba(40,50,25,0.5)'
      g.fillRect(x, 0, 2, S2)
      x += w
    }
    K.blots(g, S2, 30, 'rgba(60,50,30,0.12)', 0.04, 0.12, rand)
    const fieldTex = K.texOf(c, true, [10, 10])
    const fields = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshStandardMaterial({ map: fieldTex, roughness: 1 }))
    fields.rotation.x = -Math.PI / 2
    fields.position.y = -0.25
    fields.receiveShadow = true
    outside.add(fields)
  }
  {
    const lawn = new THREE.Mesh(K.planarUV(new THREE.CircleGeometry(70, 64).rotateX(-Math.PI / 2), 3), lawnMat)
    lawn.position.y = -0.06
    lawn.receiveShadow = true
    outside.add(lawn)
  }
  O.add(terraceMat, slab(-12.5, 6.0, -0.3, -0.02, -9.3, -HZ - T, 4))
  O.add(gravelMat, slab(-HX - T - 1.2, HX + T + 1.2, -0.3, -0.03, -HZ - T, HZ + T + 1.2, 2))
  O.add(gravelMat, slab(1.8, 3.8, -0.3, -0.035, -30, -9.3, 2))
  // clipped box balls along the terrace, a beech hedge, tall grasses
  {
    const leafy = pbr(
      (a, h, r, S) => {
        a.fillStyle = '#9a9a9a'
        a.fillRect(0, 0, S, S)
        for (let i = 0; i < S * 6; i++) {
          const x = rand() * S
          const y = rand() * S
          const l = range(rand, 0.75, 1.25)
          a.fillStyle = `rgb(${Math.round(150 * l)},${Math.round(150 * l)},${Math.round(150 * l)})`
          a.beginPath()
          a.ellipse(x, y, 3, 1.6, rand() * 3, 0, Math.PI * 2)
          a.fill()
          h.fillStyle = `rgba(255,255,255,${range(rand, 0.2, 0.6)})`
          h.beginPath()
          h.ellipse(x, y, 3, 1.6, rand() * 3, 0, Math.PI * 2)
          h.fill()
        }
        K.grit(h, S, 60, rand)
        r.fillStyle = '#d0d0d0'
        r.fillRect(0, 0, S, S)
      },
      { size: low ? 128 : 256, normal: 4 }
    )
    const boxwood = leafy.clone()
    boxwood.color = new THREE.Color('#3f5a2a')
    const beech = leafy.clone()
    beech.color = new THREE.Color('#5d6b38')
    let ball = new THREE.IcosahedronGeometry(1, 3)
    const p = ball.attributes.position
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i)
      v.multiplyScalar(1 + 0.04 * Math.sin(v.x * 9) * Math.sin(v.y * 7 + v.z * 5))
      p.setXYZ(i, v.x, v.y, v.z)
    }
    K.planarUV(ball, 0.6)
    for (const [x, z, r] of [
      [-11.6, -9.9, 0.5],
      [-9.0, -9.9, 0.42],
      [-6.2, -9.9, 0.5],
      [-3.4, -9.9, 0.45],
      [-0.6, -9.9, 0.5],
      [5.6, -9.9, 0.48],
      [7.8, -6.2, 0.55],
      [-13.2, -6.0, 0.6],
    ])
      O.add(boxwood, ball.clone().scale(r, r * 0.92, r).translate(x, r * 0.85, z))
    O.add(beech, K.planarUV(rbox(1.0, 1.7, 40, 0.3, 2).translate(17, 0.85, 0), 1))
    O.add(beech, K.planarUV(rbox(30, 1.4, 1.0, 0.3, 2).translate(2, 0.7, 16), 1))
    // ornamental grasses: clumps of thin arching blades
    const blades = []
    const br = seeded(9)
    for (let i = 0; i < 26; i++) {
      const a = br() * Math.PI * 2
      const h = range(br, 0.9, 1.6)
      const lean = range(br, 0.1, 0.45)
      const g = new THREE.PlaneGeometry(0.035, h, 1, 4)
      const pp = g.attributes.position
      for (let k = 0; k < pp.count; k++) {
        const y = pp.getY(k) + h / 2
        pp.setY(k, y)
        pp.setZ(k, Math.pow(y / h, 2) * lean * h)
      }
      g.rotateY(a)
      g.translate(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08)
      blades.push(g)
    }
    const clump = mergeGeometries(blades.map((g) => g.toNonIndexed()), false)
    clump.computeVertexNormals()
    const grassMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c2ab7e'), roughness: 0.9, side: THREE.DoubleSide })
    const spots = []
    for (let i = 0; i < (low ? 18 : 36); i++) {
      const sx = rand() < 0.6
      spots.push(sx ? [range(rand, -14.5, -12.2), range(rand, -6, 4)] : [range(rand, -12, -6.8), range(rand, -11.4, -10.4)])
    }
    const im = new THREE.InstancedMesh(clump, grassMat, spots.length)
    const m4 = new THREE.Matrix4()
    spots.forEach(([x, z], i) => {
      const s = range(rand, 0.8, 1.25)
      m4.compose(new THREE.Vector3(x, -0.05, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28), new THREE.Vector3(s, s, s))
      im.setMatrixAt(i, m4)
    })
    im.instanceMatrix.needsUpdate = true
    im.castShadow = im.receiveShadow = true
    outside.add(im)
  }
  // field fences
  {
    const fence = beamBatch(THREE)
    for (let x = -60; x <= 60; x += 3) fence.add(new THREE.Vector3(x, -0.2, -38), new THREE.Vector3(x, 1.2, -38), 0.09, 0.09)
    for (const y of [0.45, 0.9]) fence.add(new THREE.Vector3(-60, y, -38), new THREE.Vector3(60, y, -38), 0.012, 0.012)
    for (let z = -38; z <= 30; z += 3) fence.add(new THREE.Vector3(60, -0.2, z), new THREE.Vector3(60, 1.2, z), 0.09, 0.09)
    outside.add(fence.build(std('#5d554b', 0.9)))
  }
  // dark green farm sheds across the fields (seen through the east windows)
  {
    const corr = pbr(
      (a, h, r, S) => {
        a.fillStyle = '#cfcfcf'
        a.fillRect(0, 0, S, S)
        const n = 26
        for (let x = 0; x < S; x++) {
          const v = 128 + 100 * Math.sin((x / S) * n * Math.PI * 2)
          h.fillStyle = `rgb(${v},${v},${v})`
          h.fillRect(x, 0, 1, S)
        }
        for (let i = 0; i < 30; i++) {
          a.fillStyle = `rgba(30,30,20,${range(rand, 0.03, 0.08)})`
          a.fillRect(rand() * S, 0, range(rand, 3, 20), S * range(rand, 0.3, 1))
        }
        r.fillStyle = '#909090'
        r.fillRect(0, 0, S, S)
      },
      { size: low ? 128 : 256, normal: 3, metalness: 0.4 }
    )
    const shed = corr.clone()
    shed.color = new THREE.Color('#3e5a46')
    const shedRoof = corr.clone()
    shedRoof.color = new THREE.Color('#7d857c')
    for (const [x, z, w, d, h] of [
      [62, -26, 34, 15, 6.5],
      [84, -6, 30, 14, 6.0],
      [-70, 60, 28, 12, 5.5],
    ]) {
      O.add(shed, K.planarUV(box(w, h, d).translate(x, h / 2 - 0.2, z), 2))
      const pr = new THREE.Shape()
      pr.moveTo(-d / 2 - 0.4, 0)
      pr.lineTo(0, d * 0.22)
      pr.lineTo(d / 2 + 0.4, 0)
      pr.lineTo(-d / 2 - 0.4, 0)
      const rg = new THREE.ExtrudeGeometry(pr, { depth: w + 0.6, bevelEnabled: false })
      rg.translate(0, 0, -(w + 0.6) / 2)
      rg.rotateY(Math.PI / 2)
      rg.translate(x, h - 0.2, z)
      K.planarUV(rg, 2)
      O.add(shedRoof, rg)
    }
  }
  // tree lines along the field edges; a copper beech and birches in the garden
  {
    const n = low ? 0.5 : 1
    const row = (fn, count) => {
      const out = []
      for (let i = 0; i < Math.round(count * n); i++) out.push(fn(i / Math.max(1, Math.round(count * n) - 1)))
      return out
    }
    addForest(THREE, outside, row((t) => ({ x: -420 + t * 840 + range(rand, -4, 4), z: -170 + range(rand, -8, 8), h: range(rand, 12, 19) }), 70), { species: 'oak', season: 'autumn', seed: 3, quality: q })
    addForest(THREE, outside, row((t) => ({ x: 230 + range(rand, -2, 2), z: -220 + t * 440, h: range(rand, 18, 24) }), 46), { species: 'poplar', season: 'summer', seed: 4, quality: q })
    addForest(THREE, outside, row((t) => ({ x: -420 + t * 840 + range(rand, -4, 4), z: 190 + range(rand, -10, 10), h: range(rand, 11, 17) }), 56), { species: 'lime', season: 'autumn', seed: 5, quality: q })
    addForest(
      THREE,
      outside,
      [
        { x: 19, z: 6, h: 10 },
        { x: 24, z: -16, h: 12 },
        { x: -26, z: -22, h: 11 },
      ],
      { species: 'oak', season: 'autumn', seed: 6, quality: q }
    )
    addForest(
      THREE,
      outside,
      [
        { x: -19, z: -12, h: 9 },
        { x: -22, z: 9, h: 10 },
        { x: 14, z: -24, h: 8 },
      ],
      { species: 'birch', season: 'autumn', seed: 7, quality: q }
    )
  }

  B.build(inside)
  O.build(outside)

  /* --- light ---------------------------------------------------------------------- */
  // soft light from the glass wall and the picture window, falling off into the room
  {
    const a = new THREE.RectAreaLight(0xe4ecf2, 1.1, GLAZE.a1 - GLAZE.a0, 2.9)
    a.position.set((GLAZE.a0 + GLAZE.a1) / 2, 1.5, -HZ + 0.02)
    a.lookAt(a.position.x, 1.5, 0)
    scene.add(a)
    const b = new THREE.RectAreaLight(0xe4ecf2, 0.9, 2.9, 2.3)
    b.position.set(HX - 0.02, 1.5, -1.5)
    b.lookAt(0, 1.5, -1.5)
    scene.add(b)
  }
  world.focusShadows(new THREE.Vector3(0, 2, 1), 17)

  /* --- the room's own image-based light ------------------------------------------- */
  {
    const hor = new THREE.Color(world.light.sky.horizon)
    const zen = new THREE.Color(world.light.sky.zenith)
    const sunD = world.sunDir.clone().normalize()
    const sunC = new THREE.Color(world.light.sunColor)
    const SUNK = world.light.sunIntensity / Math.PI
    const P0 = new THREE.Vector3(0, 1.8, 0)
    const Q = new THREE.Vector3()
    const view = (d) => {
      if (d.y >= 0) {
        const k = Math.pow(Math.min(1, d.y / 0.7), 0.6)
        const s = Math.max(0, d.dot(sunD))
        const glow = Math.pow(s, 24) * 1.5 + Math.pow(s, 4) * 0.15
        return [hor.r + (zen.r - hor.r) * k + glow * sunC.r, hor.g + (zen.g - hor.g) * k + glow * sunC.g, hor.b + (zen.b - hor.b) * k + glow * sunC.b]
      }
      const g = 0.085 * (1 + SUNK * sunD.y * 1.2)
      return [g * 1.05, g * 1.12, g * 0.68]
    }
    const lit = (P) => {
      if (sunD.z < -1e-3) {
        const t = (-HZ - P.z) / sunD.z
        if (t > 0) {
          const x = P.x + t * sunD.x
          const y = P.y + t * sunD.y
          if (K.inRect(x, y, GLAZE) || K.inRect(x, y, S_WIN)) return true
        }
      }
      if (sunD.x < -1e-3) {
        const t = (-HX - P.x) / sunD.x
        if (t > 0) {
          const z = P.z + t * sunD.z
          const y = P.y + t * sunD.y
          for (const w of W_WINS) if (K.inRect(z, y, w)) return true
        }
      }
      return false
    }
    const ALB = { floor: lin(THREE, '#cfc6b9'), wall: lin(THREE, '#e8e1d6'), ceil: lin(THREE, '#efebe4') }
    const N = {
      'y-': new THREE.Vector3(0, 1, 0),
      'x+': new THREE.Vector3(-1, 0, 0),
      'x-': new THREE.Vector3(1, 0, 0),
      'z+': new THREE.Vector3(0, 0, -1),
      'z-': new THREE.Vector3(0, 0, 1),
      'c-': new THREE.Vector3(0, -1, KS).normalize(),
      'c+': new THREE.Vector3(0, -1, -KS).normalize(),
    }
    const env = K.probe(low ? 128 : 256, low ? 64 : 128, (d) => {
      let { t, face } = K.roomHit(P0, d, { x0: -HX, x1: HX, y0: 0, y1: 99, z0: -HZ, z1: HZ })
      for (const sz of [-1, 1]) {
        const den = d.y + sz * KS * d.z
        if (den > 1e-6) {
          const tc = (RIDGE - sz * KS * P0.z - P0.y) / den
          const z = P0.z + tc * d.z
          if (tc > 0 && tc < t && z * sz >= 0) {
            t = tc
            face = sz < 0 ? 'c-' : 'c+'
          }
        }
      }
      Q.copy(P0).addScaledVector(d, t)
      if (face === 'z-' && (K.inRect(Q.x, Q.y, GLAZE) || K.inRect(Q.x, Q.y, S_WIN))) return view(d)
      if (face === 'z+' && K.inRect(Q.x, Q.y, N_WIN)) return view(d)
      if (face === 'z+' && K.inRect(Q.x, Q.y, N_OPEN)) return [0.3, 0.28, 0.25]
      if (face === 'x+' && E_WINS.some((w) => K.inRect(Q.z, Q.y, w))) return view(d)
      if (face === 'x-' && W_WINS.some((w) => K.inRect(Q.z, Q.y, w))) return view(d)
      const alb = face === 'y-' ? ALB.floor : face === 'c-' || face === 'c+' ? ALB.ceil : ALB.wall
      const R0 = face === 'y-' ? 0.3 : face[0] === 'c' ? 0.36 : 0.32
      let sun = 0
      const n = N[face]
      if (n && lit(Q)) sun = SUNK * Math.max(0, n.dot(sunD))
      const warm = [1.0, 0.97, 0.92]
      return [alb[0] * (R0 + sun * sunC.r) * warm[0], alb[1] * (R0 + sun * sunC.g) * warm[1], alb[2] * (R0 + sun * sunC.b) * warm[2]]
    })
    K.applyEnv(inside, env)
  }

  /* --- viewpoints ------------------------------------------------------------------ */
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  // One viewpoint per photograph, where it was taken from (laura-01..08);
  // spots[0] is the hero (laura-04). The gallery's views list maps photo → spot.
  const spots = [
    { pos: V(2.6, 1.22, 2.25), look: V(11, 1.6, 0.55) }, // 0 · laura-04: at the island's waterfall end, the east gable's picture window and tall windows beyond
    { pos: V(-6.1, 1.0, -0.62), look: V(-11, 1.2, -0.42) }, // 1 · laura-01: low, square to the sofa; the tall window left, the olive in its big planter right
    { pos: V(-6.95, 0.95, -2.45), look: V(-10.7, 1.08, 0.95) }, // 2 · laura-02: low over the travertine coffee table to the sofa's corner and the window
    { pos: V(-3.35, 1.5, 3.25), look: V(-3.0, 1.42, 11) }, // 3 · laura-03: at the oak post; the beamed corridor right, the glazed den left
    { pos: V(-8.6, 1.22, 2.15), look: V(-8.6, 1.5, 5.0) }, // 4 · laura-05: square to the textured artwork and the wooden chair
    { pos: V(-4.6, 1.3, -2.2), look: V(9, 1.5, -0.6) }, // 5 · laura-06: along the walnut table, the pebble pendants, curtains left, the gable windows
    { pos: V(-4.4, 1.35, -3.9), look: V(10, 2.0, 2.6) }, // 6 · laura-07: from the glass wall across the table to the sitting corner and the tall windows
    { pos: V(-6.0, 1.1, 1.95), look: V(-6.0, 1.35, 5.0) }, // 7 · laura-08: square to the limewash wall and the bouclé stool
  ]
  const path = {
    positions: [V(-40, 30, -110), V(-12, 10, -42), V(2.8, 2.3, -13), V(2.8, 1.7, -6.2), spots[0].pos.clone()],
    targets: [V(0, 2, 0), V(2, 2, 0), V(5, 1.8, 0), V(8, 1.8, 1), spots[0].look.clone()],
    fov: 52,
    near: 0.1,
    spots,
  }
  return { scene, world, path, update() {} }
}

/* ======================================================================== */
/* studio                                                                    */
/* ======================================================================== */

function buildStudio(THREE, ctx) {
  initRectLights()
  const K = makeKit(THREE, ctx)
  const { low, tf, box, rbox, cyl, sphere, rod, slab, pbr, std } = K
  const q = ctx.quality
  const rand = seeded(808)
  const world = createWorld(THREE, ctx, 'overcast', {
    sun: { elevation: 24, azimuth: 160 },
    sunIntensity: 1.5,
    sunColor: 0xf2f1ee,
    exposure: 1.25,
    fog: { density: 0.004 },
    sky: { zenith: 0xa7b2bc, horizon: 0xdfe2e4, ground: 0x8e9092, cloudLit: 0xf0f0ee, cloudShade: 0xb4bac0, clouds: 0.9 },
  })
  const { scene } = world
  world.hemi.intensity = 0.5

  const HX = 7
  const HZ = 5 // the mirror is the inner face of the north wall, z = HZ
  const H = 3.4 // suspended ceiling
  const HW = 4.2 // walls (to the roof slab)
  const T = 0.3
  const WINS = [-4.5, 0, 4.5].map((c) => ({ a0: c - 1.2, a1: c + 1.2, y0: 0.85, y1: 3.05 }))
  const DOOR = { a0: -3.7, a1: -2.6, y0: 0, y1: 2.2 }
  const MIR = { a0: -6.4, a1: 3.6, y0: 0.22, y1: 2.42 }

  const content = new THREE.Group() // everything the mirror reflects
  const fixed = new THREE.Group() // the mirror wall itself
  scene.add(content, fixed)
  const B = K.batcher()
  const F = K.batcher()
  const frames = beamBatch(THREE)
  const glassGeos = []

  /* --- materials ------------------------------------------------------------------- */
  const wallMat = M.plaster(THREE, { color: '#d9d8d4', dirt: 0.07, tile: 3, quality: q, seed: 41 })
  const floorMat = M.floor(THREE, { kind: 'concrete', color: '#7e878c', polish: 0.72, tile: 4, quality: q, seed: 42 })
  const darkWall = wallMat.clone()
  darkWall.envMapIntensity = 0.18
  const ceilMat = pbr(
    (a, h, r, S) => {
      a.fillStyle = '#e6e5e1'
      a.fillRect(0, 0, S, S)
      for (let i = 0; i < S * 12; i++) {
        const x = rand() * S
        const y = rand() * S
        a.fillStyle = `rgba(90,90,85,${range(rand, 0.05, 0.2)})`
        a.fillRect(x, y, range(rand, 1, 3), 1)
        h.fillStyle = 'rgba(0,0,0,0.5)'
        h.fillRect(x, y, range(rand, 1, 3), 1)
      }
      // T-bar grid, 2 x 2 tiles of 60 cm per texture
      for (const k of [0, 0.5]) {
        for (const g of [a, h]) {
          g.fillStyle = g === a ? '#f2f2f0' : '#ffffff'
          g.fillRect(k * S - 3, 0, 6, S)
          g.fillRect(0, k * S - 3, S, 6)
          g.fillRect(S - 3, 0, 3, S)
          g.fillRect(0, S - 3, S, 3)
        }
      }
      r.fillStyle = '#e8e8e8'
      r.fillRect(0, 0, S, S)
    },
    { normal: 2 }
  )
  const mahogany = K.wood('#7a301b', { rough: 0.32, clearcoat: 1 })
  mahogany.normalScale = new THREE.Vector2(0.25, 0.25)
  const beech = K.wood('#cfa676', { rough: 0.45 })
  const white = std('#ecebe7', 0.5, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(0.15, 0.15) })
  const black = std('#141414', 0.45, 0.4)
  const rubber = std('#1c1c1d', 0.8)
  const leather = std('#141414', 0.42)
  const steel = std('#c3c6c8', 0.3, 1)
  const brass = std('#b89458', 0.3, 1)
  const ivory = std('#f3f0e7', 0.25, 0, { emissive: new THREE.Color('#3a3834'), emissiveIntensity: 0.6 })
  const glass = K.glassMaterial(3)
  const frameWhite = std('#e9e9e6', 0.45, 0.2)

  /* --- shell (reflected) ---------------------------------------------------------------- */
  B.add(floorMat, slab(-HX - T, HX + T, -0.3, 0, -HZ - T, HZ, 4))
  K.wallRun(B, wallMat, 'z', -HZ - T, -HZ, -HX - T, HX + T, HW, WINS)
  K.wallRun(B, wallMat, 'x', -HX - T, -HX, -HZ - T, HZ, HW, [DOOR])
  K.wallRun(B, wallMat, 'x', HX, HX + T, -HZ - T, HZ, HW, [])
  B.add(
    ceilMat,
    K.quad(
      [
        [-HX, H, -HZ],
        [HX, H, -HZ],
        [HX, H, HZ],
        [-HX, H, HZ],
      ],
      [
        [-HX / 1.2, HZ / 1.2],
        [HX / 1.2, HZ / 1.2],
        [HX / 1.2, -HZ / 1.2],
        [-HX / 1.2, -HZ / 1.2],
      ],
      new THREE.Vector3(0, -1, 0)
    ),
    false
  )
  B.add(M.concrete(THREE, { color: '#8d8a85', tile: 4, quality: q, seed: 43 }), slab(-HX - T, HX + T, HW, HW + 0.3, -HZ - T, HZ, 4))
  // LED panels (off), sprinkler heads, a smoke detector in the ceiling grid
  const panelMat = std('#f3f4f5', 0.2, 0, { emissive: new THREE.Color('#e8eef4'), emissiveIntensity: 0.06 })
  for (const x of [-4.8, 0, 4.8]) for (const z of [-2.4, 2.4]) B.add(panelMat, slab(x - 0.3, x + 0.3, H - 0.012, H, z - 0.6, z + 0.6, 1), false)
  for (const x of [-3, 3]) for (const z of [-1.2, 3.6]) B.add(steel, cyl(0.02, 0.012, 0.05, 10).translate(x, H - 0.025, z), false)
  B.add(white, cyl(0.06, 0.065, 0.045, 24).translate(1.2, H - 0.022, 0.6), false)
  // black rubber skirting
  const sk = (x0, x1, z0, z1) => B.add(rubber, slab(x0, x1, 0, 0.1, z0, z1, 1))
  sk(-HX, HX, -HZ, -HZ + 0.01)
  sk(-HX, -HX + 0.01, -HZ, DOOR.a0)
  sk(-HX, -HX + 0.01, DOOR.a1, HZ)
  sk(HX - 0.01, HX, -HZ, HZ)
  // white cable trunking with sockets along the side walls
  for (const z of [-4.6, 3.4]) B.add(white, rbox(0.03, 0.08, 0.08, 0.008, 1).translate(HX - 0.015, 0.34, z))

  /* --- windows with radiators beneath --------------------------------------------- */
  const rad = pbr(
    (a, h, r, S) => {
      a.fillStyle = '#e9e8e4'
      a.fillRect(0, 0, S, S)
      for (let x = 0; x < S; x += S / 16) {
        h.fillStyle = '#303030'
        h.fillRect(x, 0, 2, S)
        a.fillStyle = 'rgba(0,0,0,0.06)'
        a.fillRect(x, 0, 2, S)
      }
      r.fillStyle = '#707070'
      r.fillRect(0, 0, S, S)
    },
    { size: 128, normal: 3 }
  )
  for (const w of WINS) {
    K.glazing(frames, glassGeos, 'z', -HZ - T / 2, w, { fw: 0.06, fd: 0.08, mullions: [(w.a0 + w.a1) / 2], transoms: [2.35] })
    B.add(white, slab(w.a0 - 0.05, w.a1 + 0.05, w.y0 - 0.03, w.y0, -HZ, -HZ + 0.22, 1))
    // panel radiator with vertical fins, on pipes
    const rg = box(w.a1 - w.a0 - 0.5, 0.55, 0.1)
    rg.translate((w.a0 + w.a1) / 2, 0.42, -HZ + 0.12)
    K.planarUV(rg, 0.8, 0.55)
    B.add(rad, rg)
    B.add(white, rod([w.a0 + 0.2, 0, -HZ + 0.12], [w.a0 + 0.2, 0.2, -HZ + 0.12], 0.012))
    B.add(white, rod([w.a1 - 0.2, 0, -HZ + 0.12], [w.a1 - 0.2, 0.2, -HZ + 0.12], 0.012))
  }

  /* --- the door to a dark corridor ----------------------------------------------- */
  {
    const cx0 = -HX - T - 3.2
    B.add(floorMat, slab(cx0, -HX - T, -0.3, 0, DOOR.a0 - 1.0, DOOR.a1 + 1.0, 4))
    B.add(darkWall, slab(cx0, -HX - T, 0, 2.7, DOOR.a0 - 1.3, DOOR.a0 - 1.0))
    B.add(darkWall, slab(cx0, -HX - T, 0, 2.7, DOOR.a1 + 1.0, DOOR.a1 + 1.3))
    B.add(darkWall, slab(cx0 - 0.3, cx0, 0, 2.7, DOOR.a0 - 1.3, DOOR.a1 + 1.3))
    B.add(darkWall, slab(cx0 - 0.3, -HX - T, 2.7, 3.0, DOOR.a0 - 1.3, DOOR.a1 + 1.3))
    // frame and the open leaf against the wall
    for (const z of [DOOR.a0 - 0.03, DOOR.a1 + 0.03]) B.add(white, slab(-HX - 0.02, -HX + 0.015, 0, DOOR.y1 + 0.05, z - 0.03, z + 0.03, 1))
    B.add(white, slab(-HX - 0.02, -HX + 0.015, DOOR.y1, DOOR.y1 + 0.06, DOOR.a0 - 0.06, DOOR.a1 + 0.06, 1))
    B.add(white, slab(-HX + 0.015, -HX + 0.055, 0.01, 2.16, DOOR.a1 + 0.08, DOOR.a1 + 1.1, 1))
    B.add(steel, rod([-HX + 0.06, 1.02, DOOR.a1 + 1.0], [-HX + 0.12, 1.02, DOOR.a1 + 1.0], 0.009))
    B.add(steel, rod([-HX + 0.12, 1.02, DOOR.a1 + 1.0], [-HX + 0.12, 1.02, DOOR.a1 + 0.88], 0.009))
    // the green exit sign above the door
    const c = K.canvas(256, 128)
    const g = c.getContext('2d')
    g.fillStyle = '#0f8a4a'
    g.fillRect(0, 0, 256, 128)
    g.fillStyle = '#ffffff'
    g.fillRect(150, 20, 70, 88)
    g.fillStyle = '#0f8a4a'
    g.fillRect(160, 30, 50, 78)
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.arc(110, 34, 11, 0, Math.PI * 2)
    g.fill()
    g.lineWidth = 12
    g.strokeStyle = '#ffffff'
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(104, 50)
    g.lineTo(92, 80)
    g.lineTo(70, 104)
    g.moveTo(92, 80)
    g.lineTo(116, 100)
    g.moveTo(100, 58)
    g.lineTo(126, 66)
    g.moveTo(100, 58)
    g.lineTo(78, 64)
    g.stroke()
    g.fillRect(24, 54, 36, 20)
    g.beginPath()
    g.moveTo(20, 64)
    g.lineTo(38, 44)
    g.lineTo(38, 84)
    g.fill()
    const signTex = K.texOf(c, true)
    const sign = new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.3 })
    const sg = new THREE.PlaneGeometry(0.36, 0.18)
    sg.rotateY(Math.PI / 2)
    sg.translate(-HX + 0.03, 2.45, (DOOR.a0 + DOOR.a1) / 2)
    B.add(sign, sg, false)
    B.add(white, slab(-HX, -HX + 0.025, 2.35, 2.55, (DOOR.a0 + DOOR.a1) / 2 - 0.2, (DOOR.a0 + DOOR.a1) / 2 + 0.2, 1))
    // light switch, fire extinguisher on its bracket
    B.add(white, rbox(0.02, 0.085, 0.085, 0.008, 1).translate(-HX + 0.01, 1.05, DOOR.a1 + 0.25))
    const red = std('#b0161a', 0.35, 0.1)
    B.add(red, cyl(0.075, 0.075, 0.45, 20).translate(-HX + 0.11, 0.62, DOOR.a0 - 0.6))
    B.add(red, sphere(0.075, 16, 8).scale(1, 0.5, 1).translate(-HX + 0.11, 0.845, DOOR.a0 - 0.6))
    B.add(black, cyl(0.02, 0.025, 0.06, 10).translate(-HX + 0.11, 0.9, DOOR.a0 - 0.6))
    B.add(black, rod([-HX + 0.11, 0.92, DOOR.a0 - 0.6], [-HX + 0.18, 0.6, DOOR.a0 - 0.52], 0.008))
  }

  /* --- wall barres in front of the mirror; a portable barre ---------------------------- */
  {
    const zb = HZ - 0.26
    for (const y of [0.86, 1.08]) B.add(beech, rod([MIR.a0 + 0.1, y, zb], [MIR.a1 - 0.1, y, zb], 0.021, 0.021, 14))
    for (let x = MIR.a0 + 0.3; x <= MIR.a1 - 0.25; x += 1.6) {
      B.add(steel, rod([x, 0.86, HZ], [x, 0.86, zb - 0.01], 0.012))
      B.add(steel, rod([x, 1.08, HZ], [x, 1.08, zb - 0.01], 0.012))
      B.add(steel, cyl(0.03, 0.03, 0.01, 16).rotateX(Math.PI / 2).translate(x, 0.86, HZ - 0.005))
      B.add(steel, cyl(0.03, 0.03, 0.01, 16).rotateX(Math.PI / 2).translate(x, 1.08, HZ - 0.005))
      B.add(steel, rod([x, 0.83, zb], [x, 1.11, zb], 0.009))
    }
    // freestanding aluminium double barre
    const bz = 2.9
    for (const x of [-2.0, 0.0]) {
      B.add(steel, rod([x, 0, bz], [x, 1.12, bz], 0.022))
      B.add(rubber, rod([x, 0.015, bz - 0.36], [x, 0.015, bz + 0.36], 0.025))
    }
    for (const y of [0.84, 1.1]) B.add(steel, rod([-2.4, y, bz], [0.4, y, bz], 0.019, 0.019, 14))
  }

  /* --- upright piano (mahogany, polished) and its bench -------------------------- */
  {
    const P = []
    const W = 1.5
    P.push([mahogany, K.planarUV(box(W, 0.56, 0.42).translate(0, 0.34, 0.21), 1)])
    P.push([mahogany, K.planarUV(box(W, 0.1, 0.64).translate(0, 0.67, 0.32), 1)])
    P.push([mahogany, K.planarUV(box(W, 0.54, 0.33).translate(0, 0.99, 0.165), 1)])
    P.push([mahogany, K.planarUV(rbox(W + 0.03, 0.03, 0.37, 0.008, 1).translate(0, 1.275, 0.17), 1)])
    for (const sx of [-1, 1]) P.push([mahogany, K.planarUV(rbox(0.055, 0.2, 0.66, 0.012, 1).translate(sx * (W / 2 - 0.0275), 0.76, 0.33), 1)])
    P.push([mahogany, K.planarUV(box(W - 0.11, 0.12, 0.03).translate(0, 0.8, 0.345), 1)]) // folded fall board
    P.push([mahogany, K.planarUV(box(W - 0.11, 0.05, 0.03).translate(0, 0.745, 0.625), 1)]) // key slip
    for (const sx of [-1, 1]) {
      P.push([mahogany, K.planarUV(box(0.07, 0.56, 0.07).translate(sx * 0.66, 0.34, 0.56), 1)])
      P.push([mahogany, K.planarUV(box(0.08, 0.06, 0.66).translate(sx * 0.66, 0.03, 0.33), 1)])
    }
    // keys: 52 white, 36 black
    const kw = (W - 0.11) / 52
    for (let i = 0; i < 52; i++) P.push([ivory, box(kw - 0.0015, 0.022, 0.145).translate(-(W - 0.11) / 2 + kw * (i + 0.5), 0.731, 0.535)])
    const hasBlack = [1, 1, 0, 1, 1, 1, 0] // after C, D, (E), F, G, A, (B)
    for (let i = 0; i < 51; i++) {
      const note = (i + 5) % 7 // the keyboard starts on A
      if (!hasBlack[note]) continue
      P.push([black, box(kw * 0.55, 0.018, 0.09).translate(-(W - 0.11) / 2 + kw * (i + 1), 0.75, 0.505)])
    }
    for (const x of [-0.07, 0, 0.07]) P.push([brass, box(0.022, 0.012, 0.09).translate(x, 0.075, 0.47)])
    P.push([mahogany, box(0.36, 0.1, 0.05).translate(0, 0.1, 0.43)])
    B.parts(P, [HX - 0.02, 0, 1.6], [0, -Math.PI / 2, 0])
    // bench
    const bench = []
    bench.push([leather, rbox(0.76, 0.07, 0.36, 0.025, 3).translate(0, 0.5, 0)])
    bench.push([black, box(0.7, 0.08, 0.3).translate(0, 0.43, 0)])
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bench.push([black, box(0.045, 0.4, 0.045).translate(sx * 0.32, 0.2, sz * 0.13)])
    B.parts(bench, [HX - 1.05, 0, 1.55], [0, -Math.PI / 2, 0])
  }

  /* --- props: stacking chair, a speaker on a stand, a bag, the clock, a pink light ----- */
  {
    const ch = []
    ch.push([black, rbox(0.44, 0.03, 0.42, 0.01, 1).translate(0, 0.46, 0)])
    ch.push([black, tf(rbox(0.42, 0.28, 0.025, 0.01, 1), [0, 0.74, -0.2], [-0.12, 0, 0])])
    for (const sx of [-1, 1]) {
      ch.push([steel, rod([sx * 0.2, 0, 0.2], [sx * 0.19, 0.45, 0.18], 0.009)])
      ch.push([steel, rod([sx * 0.2, 0, -0.2], [sx * 0.2, 0.88, -0.23], 0.009)])
    }
    B.parts(ch, [-4.4, 0, -4.4], [0, 0.6, 0])
    B.parts(ch, [1.9, 0, -4.5], [0, -2.6, 0])
    // speaker on a tripod
    const sp = []
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      sp.push([black, rod([Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5], [0, 0.6, 0], 0.012)])
    }
    sp.push([black, rod([0, 0.4, 0], [0, 1.45, 0], 0.018)])
    sp.push([rubber, rbox(0.32, 0.5, 0.28, 0.03, 2).translate(0, 1.7, 0)])
    sp.push([black, cyl(0.1, 0.1, 0.01, 24).rotateX(Math.PI / 2).translate(0, 1.64, 0.141)])
    B.parts(sp, [-6.2, 0, -4.3], [0, 0.7, 0])
    // a holdall on the floor, a water bottle
    B.add(std('#3a2a20', 0.55), tf(rbox(0.55, 0.28, 0.3, 0.12, 4), [3.2, 0.14, -4.4], [0, 0.4, 0]))
    B.add(std('#9fb6c2', 0.15, 0.1), cyl(0.035, 0.035, 0.24, 16).translate(3.65, 0.12, -4.55))
    // round clock on the east wall
    const clockTex = (() => {
      const c = K.canvas(256)
      const g = c.getContext('2d')
      g.fillStyle = '#f7f6f2'
      g.fillRect(0, 0, 256, 256)
      g.strokeStyle = '#111'
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2
        const l = i % 5 ? 8 : 22
        g.lineWidth = i % 5 ? 2 : 6
        g.beginPath()
        g.moveTo(128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118)
        g.lineTo(128 + Math.cos(a) * (118 - l), 128 + Math.sin(a) * (118 - l))
        g.stroke()
      }
      g.lineWidth = 8
      g.beginPath()
      g.moveTo(128, 128)
      g.lineTo(128 + 50, 128 - 40)
      g.moveTo(128, 128)
      g.lineTo(128 - 20, 128 - 85)
      g.stroke()
      g.strokeStyle = '#b01010'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(128, 128)
      g.lineTo(128 + 30, 128 + 90)
      g.stroke()
      return K.texOf(c, true)
    })()
    const face = new THREE.CircleGeometry(0.15, 40)
    face.translate(-2.25, 2.7, -HZ + 0.035)
    B.add(new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.2 }), face, false)
    B.add(black, new THREE.TorusGeometry(0.155, 0.014, 8, 40).translate(-2.25, 2.7, -HZ + 0.035))
    // the gel light on a stand: a small LED panel, pink
    const ls = []
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3
      ls.push([black, rod([Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45], [0, 0.55, 0], 0.011)])
    }
    ls.push([black, rod([0, 0.4, 0], [0, 1.25, 0], 0.016)])
    ls.push([black, rbox(0.32, 0.22, 0.06, 0.01, 1).translate(0, 1.36, 0)])
    B.parts(ls, [-2.6, 0, -3.6], [0, -0.85, 0])
    const pinkFace = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.3, 2.0) })
    const pf = new THREE.PlaneGeometry(0.28, 0.18)
    pf.translate(0, 1.36, 0.031)
    B.add(pinkFace, tf(pf, [-2.6, 0, -3.6], [0, -0.85, 0]), false)
  }

  /* --- the walls' history: a hairline crack, scuffs, old tape and pencil marks -------- */
  {
    const c = K.canvas(1024, 512)
    const g = c.getContext('2d')
    g.clearRect(0, 0, 1024, 512)
    g.scale(2, 2)
    const dr = seeded(77)
    // the long hairline crack, wandering down from the ceiling (bobbi-01/02/05)
    const crack = (x0, y0, y1, w) => {
      g.strokeStyle = 'rgba(60,60,58,0.42)'
      g.lineWidth = w
      g.beginPath()
      let x = x0
      g.moveTo(x, y0)
      for (let y = y0; y < y1; y += 3) {
        x += range(dr, -1.6, 1.6)
        g.lineTo(x, y)
      }
      g.stroke()
    }
    crack(150, 0, 120, 0.55)
    crack(152, 60, 95, 0.4)
    crack(380, 0, 70, 0.45)
    // scuffs along the bottom from shoes and bags, grey smudges higher up
    for (let i = 0; i < 70; i++) {
      const x = dr() * 512
      const y = range(dr, 225, 254)
      g.fillStyle = `rgba(30,30,30,${range(dr, 0.05, 0.22)})`
      g.fillRect(x, y, range(dr, 2, 18), range(dr, 0.6, 2))
    }
    for (let i = 0; i < 26; i++) {
      const x = dr() * 512
      const y = range(dr, 40, 230)
      const r = range(dr, 6, 26)
      const grd = g.createRadialGradient(x, y, 0, x, y, r)
      grd.addColorStop(0, `rgba(${dr() < 0.3 ? '150,110,80' : '80,80,76'},${range(dr, 0.05, 0.13)})`)
      grd.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grd
      g.fillRect(x - r, y - r, 2 * r, 2 * r)
    }
    // ghosts of tape, a few filled screw holes
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(255,255,250,0.22)'
      g.fillRect(dr() * 500, range(dr, 60, 180), range(dr, 10, 22), 3)
      g.fillStyle = 'rgba(60,60,60,0.35)'
      g.beginPath()
      g.arc(dr() * 512, range(dr, 40, 200), 1.3, 0, Math.PI * 2)
      g.fill()
    }
    const tex = K.texOf(c, true)
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    const decal = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    // the bare east wall (bobbi-01, 03, 05, 06, 07) and the pink-washed west wall (bobbi-02)
    const e = new THREE.PlaneGeometry(6.4, H)
    e.rotateY(-Math.PI / 2)
    e.translate(HX - 0.003, H / 2, -2.0)
    B.add(decal, e, false)
    const w = new THREE.PlaneGeometry(6.4, H)
    w.rotateY(Math.PI / 2)
    w.translate(-HX + 0.003, H / 2, 1.2)
    B.add(decal, w, false)
  }
  // the vinyl dance floor's welded seams, every 1.5 m, running with the mirror wall
  {
    const seam = std('#4f585d', 0.45)
    for (let z = -HZ + 1.0; z < HZ; z += 1.5) B.add(seam, slab(-HX, HX, 0, 0.0012, z - 0.004, z + 0.004, 1), false)
  }
  // a black flight case against the west wall (the dark block at the edge of bobbi-02)
  {
    const fc = std('#121213', 0.55, 0.1, { normalMap: K.fine(), normalScale: new THREE.Vector2(0.6, 0.6) })
    B.add(fc, rbox(0.62, 0.92, 0.56, 0.02, 2).translate(-HX + 0.4, 0.46, 2.75))
    for (const y of [0.02, 0.9]) B.add(steel, slab(-HX + 0.08, -HX + 0.72, y, y + 0.025, 2.46, 3.04, 1))
    for (const z of [2.47, 3.03]) B.add(steel, slab(-HX + 0.08, -HX + 0.72, 0.02, 0.92, z - 0.012, z + 0.012, 1))
  }

  /* --- outside: the street and an old brick school across it ------------------------- */
  {
    const pave = M.paving(THREE, { kind: 'flags', color: '#8f8a83', joint: '#5b5853', unit: 0.3, tile: 3, quality: q, seed: 44 })
    const asph = M.asphalt(THREE, { color: '#3b3c3e', tile: 6, quality: q, seed: 45 })
    B.add(pave, slab(-70, 70, -0.6, -0.12, -8.6, -HZ - T, 3))
    B.add(asph, slab(-70, 70, -0.6, -0.26, -15.4, -8.6, 6))
    B.add(pave, slab(-70, 70, -0.6, -0.12, -19, -15.4, 3))
    const kerb = std('#9a968e', 0.8, 0, { normalMap: K.fine() })
    B.add(kerb, slab(-70, 70, -0.26, -0.12, -8.75, -8.6, 1))
    B.add(kerb, slab(-70, 70, -0.26, -0.12, -15.4, -15.25, 1))
    const brick = M.facade(THREE, { wall: 'brick', color: '#8e4527', mortar: '#b7a58f', frame: '#e8e2d6', glass: '#20262c', bay: 3.4, storey: 4.2, window: { w: 0.5, h: 0.7, bars: 'grid', sill: true, lintel: true }, curtains: 0.15, quality: q, seed: 46 })
    const plast = M.facade(THREE, { wall: 'plaster', color: '#cfc8bb', frame: '#f2efe8', glass: '#1d242a', bay: 3.0, storey: 3.4, window: { w: 0.55, h: 0.62, bars: 'sash', sill: true }, curtains: 0.3, quality: q, seed: 47 })
    const slate = M.roof(THREE, { kind: 'slate', tile: 2, quality: q, seed: 48 })
    const trim = std('#e1dbd0', 0.7)
    const school = M.townhouse(THREE, { w: 54, d: 14, storeys: 3, facade: brick, roof: 'pitched', roofMat: slate, trim })
    school.group.position.set(-4, -0.12, -26)
    content.add(school.group)
    for (const [x, w, s] of [
      [-44, 26, 4],
      [36, 20, 4],
    ]) {
      const b = M.townhouse(THREE, { w, d: 12, storeys: s, facade: plast, roof: 'flat', trim })
      b.group.position.set(x, -0.12, -25)
      content.add(b.group)
    }
    // the studio's neighbours in the same block
    B.add(wallMat, slab(HX + T, 30, 0, 9, -HZ - T, HZ, 3))
    B.add(wallMat, slab(-30, -HX - T - 3.5, 0, 9, -HZ - T, HZ, 3))
    B.add(wallMat, slab(-HX - T - 3.5, -HX - T, 3.0, 9, -HZ - T, HZ, 3))
    B.add(wallMat, slab(-HX - T - 3.5, -HX - T, 0, 3.0, -HZ - T, DOOR.a0 - 1.3, 3))
    B.add(wallMat, slab(-HX - T - 3.5, -HX - T, 0, 3.0, DOOR.a1 + 1.3, HZ, 3))
    // lamp posts and autumn limes on the far pavement
    for (const x of [-14, 12]) {
      B.add(black, rod([x, -0.12, -16.2], [x, 6, -16.2], 0.07, 0.05))
      B.add(black, rbox(0.5, 0.14, 0.24, 0.04, 2).translate(x, 6.05, -16))
    }
    addForest(
      THREE,
      content,
      [-20, -6, 6, 20].map((x) => ({ x, y: -0.12, z: -17.4, h: 9 + rand() * 2 })),
      { species: 'lime', season: 'autumn', seed: 21, quality: q }
    )
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: 0x55574f, roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.62
    ground.receiveShadow = true
    scene.add(ground)
  }

  /* --- the mirror wall (not reflected) --------------------------------------------- */
  {
    const t0 = HZ
    const t1 = HZ + 0.02
    F.add(wallMat, slab(-HX, MIR.a0, 0, H, t0, t1))
    F.add(wallMat, slab(MIR.a1, HX, 0, H, t0, t1))
    F.add(wallMat, slab(MIR.a0, MIR.a1, 0, MIR.y0, t0, t1))
    F.add(wallMat, slab(MIR.a0, MIR.a1, MIR.y1, H, t0, t1))
    F.add(rubber, slab(-HX, HX, 0, 0.1, t0 - 0.01, t0, 1))
    // thin aluminium edges and joints between mirror panels
    const al = std('#b8bbbd', 0.3, 1)
    for (let x = MIR.a0; x <= MIR.a1 + 1e-3; x += (MIR.a1 - MIR.a0) / 8) F.add(al, slab(x - 0.012, x + 0.012, MIR.y0, MIR.y1, t0 - 0.008, t0, 1))
    F.add(al, slab(MIR.a0 - 0.012, MIR.a1 + 0.012, MIR.y0 - 0.02, MIR.y0, t0 - 0.012, t0, 1))
    F.add(al, slab(MIR.a0 - 0.012, MIR.a1 + 0.012, MIR.y1, MIR.y1 + 0.02, t0 - 0.012, t0, 1))
    // the east end of the mirror run is closed by a beech edge strip (bobbi-04)
    F.add(beech, slab(MIR.a1, MIR.a1 + 0.04, MIR.y0 - 0.03, MIR.y1 + 0.03, t0 - 0.022, t0, 1))
    // the silvering: a faint green-grey cast over the reflected room
    const tint = new THREE.MeshBasicMaterial({ color: 0x0f1a17, transparent: true, opacity: 0.16, depthWrite: false })
    const tg = new THREE.PlaneGeometry(MIR.a1 - MIR.a0, MIR.y1 - MIR.y0)
    tg.rotateY(Math.PI)
    tg.translate((MIR.a0 + MIR.a1) / 2, (MIR.y0 + MIR.y1) / 2, t0 - 0.002)
    F.add(tint, tg, false)
    // an invisible sheet that keeps the sun out of the reflected room (it casts
    // shadow only; transparent, so the viewer keeps it out of the AO pass)
    const blocker = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    const bg = new THREE.PlaneGeometry(2 * HX, HW)
    bg.translate(0, HW / 2, t1 + 0.01)
    F.add(blocker, bg, true)
  }

  content.add(frames.build(frameWhite))
  {
    const g = K.batcher()
    for (const gg of glassGeos) g.add(glass, gg, false)
    g.build(content)
  }
  B.build(content)
  F.build(fixed)

  /* --- light -------------------------------------------------------------------------- */
  const pinkSpot = (z0, zt) => {
    const s = new THREE.SpotLight(0xff8fbc, 45, 16, 0.62, 1, 2)
    s.position.set(-2.6, 1.36, z0)
    s.target.position.set(-HX, 1.5, zt)
    scene.add(s, s.target)
  }
  pinkSpot(-3.6, 0.6)
  pinkSpot(2 * HZ + 3.6, 2 * HZ - 0.6)
  for (const [z, look] of [
    [-HZ + 0.02, 1],
    [3 * HZ - 0.02, -1],
  ]) {
    const a = new THREE.RectAreaLight(0xdfe6ec, 1.5, 12, 2.2)
    a.position.set(0, 1.95, z)
    a.lookAt(0, 1.95, z + look)
    scene.add(a)
  }
  world.focusShadows(new THREE.Vector3(0, 1.5, 0), 14)

  /* --- the room's light probe (with the mirror) ------------------------------------- */
  {
    const hor = new THREE.Color(world.light.sky.horizon)
    const zen = new THREE.Color(world.light.sky.zenith)
    const room = { x0: -HX, x1: HX, y0: 0, y1: H, z0: -HZ, z1: HZ }
    const ALB = { floor: lin(THREE, '#7e878c'), wall: lin(THREE, '#d9d8d4'), ceil: lin(THREE, '#e6e5e1') }
    const pink = [0.42, 0.17, 0.27]
    const Pk = new THREE.Vector3(-HX, 1.5, 0.6)
    const view = (d) => {
      if (d.y > 0.2) {
        const k = Math.min(1, (d.y - 0.2) / 0.6)
        return [hor.r + (zen.r - hor.r) * k, hor.g + (zen.g - hor.g) * k, hor.b + (zen.b - hor.b) * k]
      }
      if (d.y > -0.03) return [0.15, 0.085, 0.06] // the brick school opposite
      return [0.06, 0.06, 0.065]
    }
    const Q = new THREE.Vector3()
    const trace = (P, d, depth) => {
      const { t, face } = K.roomHit(P, d, room)
      Q.copy(P).addScaledVector(d, t)
      if (face === 'z-' && WINS.some((w) => K.inRect(Q.x, Q.y, w))) return view(d)
      if (face === 'x-' && K.inRect(Q.z, Q.y, DOOR)) return [0.02, 0.02, 0.022]
      if (face === 'z+' && depth === 0 && K.inRect(Q.x, Q.y, MIR)) {
        const c = trace(Q.clone(), new THREE.Vector3(d.x, d.y, -d.z), 1)
        return [c[0] * 0.84, c[1] * 0.86, c[2] * 0.85]
      }
      const alb = face === 'y-' ? ALB.floor : face === 'y+' ? ALB.ceil : ALB.wall
      const R0 = face === 'y-' ? 0.42 : face === 'y+' ? 0.3 : 0.36
      // window light falls off away from the glass
      const near = face === 'y-' || face === 'y+' ? 0.75 + 0.5 * Math.max(0, -Q.z / HZ) : 1
      const out = [alb[0] * R0 * near, alb[1] * R0 * near, alb[2] * R0 * near]
      if (face === 'x-') {
        const k = Math.exp(-Q.distanceToSquared(Pk) / 3.2)
        out[0] += pink[0] * k
        out[1] += pink[1] * k
        out[2] += pink[2] * k
      }
      return out
    }
    const P0 = new THREE.Vector3(0, 1.6, 0)
    const env = K.probe(low ? 128 : 256, low ? 64 : 128, (d) => trace(P0, d, 0))
    K.applyEnv(content, env)
    K.applyEnv(fixed, env)
  }

  // the reflection: the whole room (and the street) mirrored behind the mirror plane
  const mirrored = content.clone(true)
  mirrored.scale.z = -1
  mirrored.position.z = 2 * HZ
  {
    const src = []
    content.traverse((o) => src.push(o))
    let i = 0
    mirrored.traverse((o) => {
      const s = src[i++]
      if (s && s.customDepthMaterial) o.customDepthMaterial = s.customDepthMaterial
    })
  }
  scene.add(mirrored)

  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  // One viewpoint per photograph (bobbi-01..10); spots[0] is the hero (bobbi-02).
  const spots = [
    { pos: V(-3.3, 1.2, 0.9), look: V(-7, 1.25, 0.9) }, // 0 · bobbi-02: square to the pink-washed west wall, the flight case at the left edge
    { pos: V(3.35, 1.3, -2.2), look: V(7, 1.2, -2.2) }, // 1 · bobbi-01: square to the bare east wall and its crack
    { pos: V(3.55, 1.35, -0.95), look: V(7, 1.25, -0.9) }, // 2 · bobbi-03: the same wall, a step to the left
    { pos: V(5.35, 2.0, 3.05), look: V(4.2, 0.25, 4.75) }, // 3 · bobbi-04: high, looking down at the floor where the wall meets the mirror's beech edge
    { pos: V(3.1, 0.7, -3.4), look: V(7, 0.78, -3.4) }, // 4 · bobbi-05: low, the floor's sheen against the wall
    { pos: V(3.2, 1.35, -4.0), look: V(7, 1.3, -3.6) }, // 5 · bobbi-06: square on, by the window corner
    { pos: V(3.6, 1.05, -2.8), look: V(7, 1.0, -2.9) }, // 6 · bobbi-07: low-ish, along the wall
    { pos: V(-1.0, 1.0, 2.45), look: V(-0.25, 1.3, 5) }, // 7 · bobbi-08: behind the portable barre, into the mirrors
    { pos: V(5.35, 1.15, 0.35), look: V(6.6, 0.85, 1.95) }, // 8 · bobbi-09: at the bass end of the piano, along the keys
    { pos: V(5.75, 1.3, 2.95), look: V(6.4, 0.75, 0.9) }, // 9 · bobbi-10: from the treble end, the keyboard and the bench
  ]
  return {
    scene,
    world,
    path: {
      positions: [V(10, 14, -42), V(3, 4.5, -20), V(0.4, 1.9, -9), V(0.6, 1.6, -4.2), spots[0].pos.clone()],
      targets: [V(0, 2, 0), V(0, 1.8, 0), V(-1, 1.5, 0), V(-3, 1.4, 0.4), spots[0].look.clone()],
      fov: 50,
      near: 0.1,
      spots,
    },
    update() {},
  }
}

export function buildInterior(THREE, ctx, { variant = 'villa' } = {}) {
  return variant === 'studio' ? buildStudio(THREE, ctx) : buildVilla(THREE, ctx)
}
