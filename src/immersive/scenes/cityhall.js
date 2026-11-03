/**
 * Rotterdam City Hall (Stadhuis, Coolsingel 40; Henri Evers, 1914–1920) —
 * the first part of Mieri & Fathi's pre-wedding, in warm late-afternoon sun.
 *
 * The building as the monument register describes it: a rectangle of about
 * 106 × 86 m in four wings round inner courtyards, three storeys on a
 * bluestone (hardsteen) plinth, the outer walls in honey sandstone, the
 * courtyard walls in brick, steep slate saddle-, hip- and tent roofs with lead
 * crowns on the corner pavilions, steel-framed windows (painted green), and
 * the 71.5 m tower over the central hall: a square stone shaft, an octagonal
 * lantern and a copper crown with clock faces and a gilded figure on top.
 *
 * Built from the photographs: the deep round-arched openings framed by heavy
 * rusticated voussoirs; the passage to the inner courtyard behind a dark-green
 * wrought-iron gate with a red "no entry" sign beside it (photo 1); an arched
 * doorway with a glazed green steel door in stepped orders (2); the portal of
 * the Burgerlijke Stand — two orange wooden doors, a statue between them, a
 * green plaque with gold letters, steps with green tube railings (3); the
 * deep arched niche with a window at its back (4); the colonnaded loggia up
 * five steps, with yellow-brick domed vaults (5) and a blind arch with a
 * window inside it (6); and the green iron railing on a stone kerb along the
 * pavement, guarding the light well, with flower boxes on the windows (7).
 *
 * Metres. +Z = south (the Doelwater side, where the shoot happened), +X =
 * east (Coolsingel). The south face of the building is the plane z = 0 from
 * x = −53 to 53; the Coolsingel front is the plane x = 53.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createWorld } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { beamBatch, seeded, range, paintTexture } from '../utils.js'

/* --- tileable noise --------------------------------------------------------- */

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

/* --- painted PBR texture sets ---------------------------------------------- */

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
 * out.h (height 0..1), out.ro (roughness), out.me (metalness). v runs up.
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
      paint((x + 0.5) / W, (y + 0.5) / H, o, x, y)
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
 * Sandstone ashlar: courses of blocks of varying length, each its own tone
 * (honey, a little pink or grey), fine joints with a chamfered arris, grain.
 * TW × TH metres per tile. Rusticated work = taller courses, deep V-joints and
 * a rougher face.
 */
function stoneSet(THREE, S, o) {
  const { TW, TH, course, minL, maxL, joint, chamfer, relief, base, mortar, seed, tone, normal } = o
  const rand = seeded(seed)
  const nRows = Math.max(1, Math.round(TH / course))
  const ch = TH / nRows
  const rows = []
  for (let r = 0; r < nRows; r++) {
    const e = []
    let x = rand() * maxL
    while (x < TW - minL * 0.5) {
      e.push(x)
      x += range(rand, minL, maxL)
    }
    if (!e.length) e.push(0)
    rows.push(e)
  }
  const hj = joint / 2
  return pbr(
    THREE,
    S,
    S,
    (u, v, out) => {
      const x = u * TW
      const y = v * TH
      const r = Math.min(nRows - 1, Math.floor(y / ch))
      const fy = y - r * ch
      const dy = Math.min(fy, ch - fy)
      const e = rows[r]
      let k = 0
      let dx = 1e9
      for (let i = 0; i < e.length; i++) {
        if (e[i] <= x) k++
        let d = Math.abs(x - e[i])
        d = Math.min(d, TW - d)
        if (d < dx) dx = d
      }
      const id = k === 0 || k === e.length ? 0 : k
      const d = Math.min(dx, dy)
      const g = fbm(u, v, 40, 2, seed)
      const st = fbm(u, v, 4, 3, seed + 9)
      if (d < hj) {
        const m = 0.9 + 0.2 * g
        out.r = mortar[0] * m
        out.g = mortar[1] * m
        out.b = mortar[2] * m
        out.h = 0.08
        out.ro = 0.95
        return
      }
      const t = hash(r, id, seed)
      const t2 = hash(r + 31, id, seed + 1)
      const ed = sstep(hj, hj + chamfer, d)
      const k1 = (1 + (t - 0.5) * 2 * tone) * (0.92 + 0.16 * g) * (0.9 + 0.2 * st) * (0.85 + 0.15 * ed)
      out.r = base[0] * k1 * (1 + (t2 - 0.5) * 0.08)
      out.g = base[1] * k1
      out.b = base[2] * k1 * (1 - (t2 - 0.5) * 0.12)
      out.h = 0.25 + 0.5 * ed + (g - 0.5) * relief
      out.ro = 0.72 + 0.2 * g
    },
    { normal }
  )
}

/** One dressed stone per face: a drafted margin round a tooled field. For voussoirs, quoins, copings. */
function blockSet(THREE, S, seed) {
  return pbr(
    THREE,
    S,
    S,
    (u, v, o) => {
      const e = Math.min(u, 1 - u, v, 1 - v)
      const g = fbm(u, v, 12, 3, seed)
      const f = fbm(u, v, 48, 1, seed + 4)
      const field = sstep(0.05, 0.075, e)
      const edge = sstep(0.0, 0.035, e)
      const k = (0.9 + 0.16 * g) * (0.8 + 0.2 * edge) * (1 + 0.05 * (1 - field))
      o.r = 0.79 * k
      o.g = 0.685 * k
      o.b = 0.53 * k
      o.h = edge * (0.55 + field * (0.06 + (f - 0.5) * 0.3))
      o.ro = 0.75 + 0.15 * f
    },
    { normal: 2.2 }
  )
}

/** Belgian bluestone (hardsteen): blue-grey, finely tooled, with pale fossil flecks. Tile 1.5 m. */
function bluestoneSet(THREE, S, seed) {
  return pbr(
    THREE,
    S,
    S,
    (u, v, o, px, py) => {
      const g = fbm(u, v, 16, 3, seed)
      const s = Math.sin((v * 140 + g * 4) * Math.PI * 2) * 0.5 + 0.5
      const sp = hash(px, py, seed)
      const k = 0.82 + 0.26 * g + 0.05 * s
      o.r = 0.43 * k
      o.g = 0.415 * k
      o.b = 0.39 * k
      if (sp > 0.994) {
        o.r += 0.16
        o.g += 0.16
        o.b += 0.15
      }
      o.h = 0.5 + 0.06 * s + 0.25 * (g - 0.5)
      o.ro = 0.74 + 0.16 * g
    },
    { normal: 1.2 }
  )
}

/** Green-painted steel window: three lights by five, a transom, and a diamond lattice in the head. */
function windowSet(THREE, W, seed) {
  const H = W * 2
  return pbr(
    THREE,
    W,
    H,
    (u, v, o) => {
      const fu = 0.055
      const fv = 0.028
      const tr0 = 0.73
      const tr1 = 0.755
      let frame = u < fu || u > 1 - fu || v < fv || v > 1 - fv || (v > tr0 && v < tr1)
      const iu = (u - fu) / (1 - 2 * fu)
      let pane = 0
      if (!frame) {
        const mu = iu * 3
        if (Math.abs(mu - Math.round(mu)) < 0.05) frame = true
        if (v < tr0) {
          const iv = ((v - fv) / (tr0 - fv)) * 5
          const rv = Math.round(iv)
          if (rv > 0 && rv < 5 && Math.abs(iv - rv) < 0.045) frame = true
          pane = Math.floor(mu) * 7 + Math.floor(iv)
        } else {
          const a = iu * 6
          const b = ((v - tr1) / (1 - fv - tr1)) * 2.5
          const p1 = (((a + b) % 1) + 1) % 1
          const p2 = (((a - b) % 1) + 1) % 1
          if (p1 < 0.07 || p1 > 0.93 || p2 < 0.07 || p2 > 0.93) frame = true
          pane = 40
        }
      }
      if (frame) {
        const g = 0.92 + 0.1 * hash(Math.floor(u * 50), Math.floor(v * 90), seed)
        o.r = 0.12 * g
        o.g = 0.27 * g
        o.b = 0.19 * g
        o.h = 0.85
        o.ro = 0.42
        o.me = 0.1
      } else {
        const t = hash(pane, 3, seed)
        // a little of the dim room behind the glass, plus a mirror of the sky
        o.r = 0.3 + t * 0.05
        o.g = 0.33 + t * 0.05
        o.b = 0.35 + t * 0.04
        o.h = 0.3
        o.ro = 0.04 + 0.08 * t
        o.me = 1
        if (t > 0.93 && v < tr0) {
          // a blind half down behind the odd pane
          o.r = 0.42
          o.g = 0.38
          o.b = 0.33
          o.ro = 0.5
          o.me = 0.5
        }
      }
    },
    { normal: 2.5 }
  )
}

/** Doors: 'green' = glazed steel double door; 'wood' = panelled timber double door in `color`. */
function doorSet(THREE, W, { kind = 'wood', color = [0.6, 0.27, 0.13], seed = 5 } = {}) {
  const H = W * 2
  return pbr(
    THREE,
    W,
    H,
    (u, v, o) => {
      const leafU = u < 0.5 ? u * 2 : (u - 0.5) * 2 // 0..1 across each leaf
      const edge = Math.min(leafU, 1 - leafU)
      const stile = edge < 0.12 || v < 0.035 || v > 0.965
      if (kind === 'green') {
        const g = [0.1, 0.24, 0.17]
        let glass = false
        let panel = false
        if (!stile) {
          if (v > 0.38 && v < 0.94) {
            const gu = ((leafU - 0.12) / 0.76) * 2
            const gv = ((v - 0.38) / 0.56) * 6
            const bu = Math.abs(gu - Math.round(gu)) < 0.06
            const bv = Math.abs(gv - Math.round(gv)) < 0.05
            glass = !bu && !bv
          } else if (v > 0.06 && v < 0.33) panel = true
        }
        if (glass) {
          o.r = 0.12
          o.g = 0.15
          o.b = 0.16
          o.h = 0.3
          o.ro = 0.06
          o.me = 1
        } else {
          const ps = panel ? sstep(0.12, 0.17, edge) * sstep(0.06, 0.09, v) * sstep(0.33, 0.3, v) : 0
          const rv = !panel && !stile ? 0 : 0
          o.r = g[0] * (0.95 + rv)
          o.g = g[1]
          o.b = g[2]
          o.h = 0.7 + ps * 0.15
          o.ro = 0.38
          o.me = 0.25
        }
        return
      }
      // timber: vertical grain, three raised panels a leaf, a dark meeting stile
      const grain = vnoise(u * 60, v * 4, 1000, seed) * 0.6 + vnoise(u * 160, v * 9, 1000, seed + 3) * 0.4
      let k = 0.85 + 0.25 * grain
      let h = 0.6
      if (!stile) {
        const pv = ((v - 0.035) / 0.93) * 3
        const fr = pv - Math.floor(pv)
        const pe = Math.min(fr, 1 - fr) / 3
        const inPanel = pe > 0.03 && edge > 0.16
        if (inPanel) {
          const bev = sstep(0.03, 0.06, pe) * sstep(0.16, 0.2, edge)
          h = 0.45 + 0.3 * bev
          k *= 0.92 + 0.12 * bev
        } else h = 0.6
      }
      if (Math.abs(u - 0.5) < 0.008) k *= 0.4
      o.r = color[0] * k
      o.g = color[1] * k
      o.b = color[2] * k
      o.h = h
      o.ro = 0.42 + 0.2 * grain
    },
    { normal: 2.5 }
  )
}

/** Weathered copper: verdigris with darker streaks and bronze patches. */
function copperSet(THREE, S, seed) {
  return pbr(
    THREE,
    S,
    S,
    (u, v, o) => {
      const g = fbm(u, v, 6, 4, seed)
      const s = fbm(u, v * 0.25 + 0.5, 24, 2, seed + 2)
      const dark = sstep(0.55, 0.8, s) * 0.35
      const k = 0.85 + 0.3 * g
      o.r = (0.36 + 0.06 * g) * k * (1 - dark)
      o.g = 0.62 * k * (1 - dark)
      o.b = 0.52 * k * (1 - dark)
      o.h = 0.5 + 0.2 * (g - 0.5)
      o.ro = 0.5 + 0.2 * g
      o.me = 0.25
    },
    { normal: 1 }
  )
}

/* --- shader: weathering on the stone -------------------------------------- */

const WEATHER_GLSL = /* glsl */ `
  varying vec3 vWPos;
  float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float wNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`
/**
 * Large honey/cream mottling in world space (so no two walls share one flat
 * tone), soft dark rain streaks down vertical faces, and the grime of a
 * century of pavement splash at the foot of the walls.
 */
function weather(mat, { key = 'stone', mottle = 0.14, warm = 0.07, streaks = 0.24, grime = 0.3 } = {}) {
  const f = (v) => v.toFixed(4)
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        vWPos = (modelMatrix * wp).xyz;
      }`
    )
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + WEATHER_GLSL).replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec3 wn = inverseTransformDirection(normal, viewMatrix);
        float vert = 1.0 - smoothstep(0.55, 0.85, abs(wn.y));
        vec2 q = vWPos.xz + vec2(vWPos.y * 0.37);
        float big = wNoise(q * 0.045) * 0.6 + wNoise(q * 0.17 + 7.0) * 0.4;
        vec3 c = diffuseColor.rgb;
        c *= 1.0 + (big - 0.5) * ${f(mottle)};
        c *= mix(vec3(1.0 - ${f(warm * 0.4)}, 1.0, 1.0 + ${f(warm * 0.5)}), vec3(1.0 + ${f(warm)}, 1.0 + ${f(warm * 0.25)}, 1.0 - ${f(warm * 1.4)}), big);
        float s = wNoise(vec2((vWPos.x + vWPos.z) * 1.3, vWPos.y * 0.06 + (vWPos.x - vWPos.z) * 0.011));
        float streak = smoothstep(0.62, 0.95, s) * vert * ${f(streaks)};
        c = mix(c, c * vec3(0.74, 0.71, 0.68), streak);
        float foot = (1.0 - smoothstep(0.1, 1.7, vWPos.y)) * vert * ${f(grime)};
        c *= 1.0 - foot * (0.6 + 0.4 * wNoise(vWPos.xz * 2.3 + vWPos.y));
        diffuseColor.rgb = c;
      }`
    )
  }
  mat.customProgramCacheKey = () => 'cityhall-weather-' + key
  mat.needsUpdate = true
  return mat
}

/* --- geometry helpers ------------------------------------------------------- */

/**
 * UVs in metres from the face normal (before the geometry is placed): fronts
 * (±z) get (x, y), jambs (±x) get (z, y), soffits and tops (±y) get (x, z), so
 * stone courses stay level on every face of an opening.
 */
function uvByNormal(geo, tw, th) {
  const p = geo.attributes.position
  const n = geo.attributes.normal
  const uv = geo.attributes.uv
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i))
    const ny = Math.abs(n.getY(i))
    const nz = Math.abs(n.getZ(i))
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    let u
    let v
    if (nz >= 0.5) {
      u = x
      v = y
    } else {
      u = z * nx + x * ny
      v = y * nx + z * ny
    }
    uv.setXY(i, u / tw, v / th)
  }
  uv.needsUpdate = true
  return geo
}

function batcher(THREE, scene) {
  const lists = new Map()
  return {
    add(material, geo) {
      if (!lists.has(material)) lists.set(material, [])
      lists.get(material).push(geo.index ? geo.toNonIndexed() : geo)
    },
    flush() {
      lists.forEach((geos, mat) => {
        const keep = geos.map((g) => {
          g.clearGroups()
          for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k)
          return g
        })
        const merged = mergeGeometries(keep, false)
        if (!merged) return
        const mesh = new THREE.Mesh(merged, mat)
        mesh.castShadow = !mat.userData.noCast
        mesh.receiveShadow = true
        scene.add(mesh)
      })
      lists.clear()
    },
  }
}

/** Hole outline (rectangle, or with a round-arched head) for Shape.holes. */
function holePath(THREE, h) {
  const p = new THREE.Path()
  const x0 = h.x - h.w / 2
  const x1 = h.x + h.w / 2
  p.moveTo(x0, h.y0)
  p.lineTo(x1, h.y0)
  if (h.arch) {
    const spring = h.top - h.w / 2
    p.lineTo(x1, spring)
    p.absarc(h.x, spring, h.w / 2, 0, Math.PI, false)
  } else {
    p.lineTo(x1, h.top)
    p.lineTo(x0, h.top)
  }
  p.lineTo(x0, h.y0)
  return p
}

/* --- the scene ------------------------------------------------------------- */

export function buildCityHall(THREE, ctx, { light = 'golden' } = {}) {
  // a clear, deep-blue late afternoon: the photos are all walls and no sky,
  // so the sky read from them is ignored in favour of a sunny one
  ctx.sky = null
  const world = createWorld(THREE, ctx, light, {
    // low sun from the west-south-west: it rakes along the Doelwater face,
    // fills the arcades from the side and gilds the tower
    sun: { elevation: 19, azimuth: 300 },
    sky: { zenith: 0x3b74c4, horizon: 0xf1d7b2, ground: 0xb09a82, sun: 0xffdca6, cloudLit: 0xfff1de, cloudShade: 0xcaa999, clouds: 0.22 },
    fog: { density: 0.00042 },
    sunColor: 0xffcf98,
    sunIntensity: 3.0,
    hemi: [0xeae2d4, 0x9a7656, 0.8],
  })
  const { scene } = world
  const low = ctx.quality === 'low'
  const q = ctx.quality
  const rand = seeded(1920)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const B = batcher(THREE, scene)
  const TS = low ? 256 : 512
  const TSs = low ? 128 : 256

  /* --- materials ----------------------------------------------------------- */
  const AT = [4.8, 4.5] // ashlar tile (m)
  const RT = [4.8, 4.8] // rusticated tile
  const BT = [1.5, 1.5] // bluestone tile
  const stone = weather(
    pbrMat(THREE, stoneSet(THREE, TS, { TW: AT[0], TH: AT[1], course: 0.45, minL: 0.7, maxL: 1.6, joint: 0.012, chamfer: 0.02, relief: 0.1, base: [0.79, 0.69, 0.54], mortar: [0.62, 0.55, 0.46], seed: 11, tone: 0.085, normal: 2 })),
    { key: 'ashlar' }
  )
  const rustic = weather(
    pbrMat(THREE, stoneSet(THREE, TS, { TW: RT[0], TH: RT[1], course: 0.6, minL: 1.0, maxL: 1.9, joint: 0.022, chamfer: 0.05, relief: 0.1, base: [0.78, 0.68, 0.53], mortar: [0.66, 0.6, 0.5], seed: 12, tone: 0.09, normal: 2.2 })),
    { key: 'rustic', grime: 0.34 }
  )
  const block = weather(pbrMat(THREE, blockSet(THREE, TSs, 13)), { key: 'block', streaks: 0.12 })
  const blue = pbrMat(THREE, bluestoneSet(THREE, TSs, 14))
  const winMat = pbrMat(THREE, windowSet(THREE, low ? 128 : 256, 15), { envMapIntensity: 1.35 })
  const doorGreen = pbrMat(THREE, doorSet(THREE, 128, { kind: 'green', seed: 16 }), { envMapIntensity: 1.2 })
  const doorOrange = pbrMat(THREE, doorSet(THREE, 128, { kind: 'wood', color: [0.66, 0.28, 0.13], seed: 17 }))
  const doorDark = pbrMat(THREE, doorSet(THREE, 128, { kind: 'wood', color: [0.27, 0.18, 0.12], seed: 18 }))
  const copper = pbrMat(THREE, copperSet(THREE, low ? 64 : 128, 19))
  const yBrick = M.brick(THREE, { color: '#c99d60', mortar: '#d9c7a2', variation: 0.12, dirt: 0.08, tile: 2, quality: q, seed: 21 })
  const yBrickIn = yBrick.clone()
  yBrickIn.side = THREE.BackSide
  const rBrick = M.brick(THREE, { color: '#8c432c', mortar: '#a19484', tile: 2, quality: q, seed: 22 })
  const slate = M.roof(THREE, { kind: 'slate', color: '#3d4550', tile: 2, quality: q, seed: 23 })
  const redPave = M.paving(THREE, { kind: 'herringbone', color: '#ad7454', joint: '#66503f', variation: 0.16, tile: 3, quality: q, seed: 24 })
  const greyPave = M.paving(THREE, { kind: 'flags', color: '#ab9f8c', joint: '#57534d', unit: 0.2, variation: 0.1, tile: 2, quality: q, seed: 25 })
  const setts = M.paving(THREE, { kind: 'setts', color: '#7f7a72', joint: '#4a463f', unit: 0.14, tile: 2, quality: q, seed: 26 })
  const asphalt = M.asphalt(THREE, { color: '#46474b', tile: 6, quality: q, seed: 27 })
  const bikeLane = M.asphalt(THREE, { color: '#8e4535', tile: 6, quality: q, seed: 28 })
  const loggiaFloor = M.floor(THREE, { kind: 'tile', color: '#8c7660', tileSize: 0.8, polish: 0.72, tile: 4, quality: q, seed: 29 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x15110d, roughness: 1 })
  const iron = new THREE.MeshStandardMaterial({ color: 0x1c3a2a, roughness: 0.42, metalness: 0.55 })
  const galv = new THREE.MeshStandardMaterial({ color: 0x9ea3a6, roughness: 0.35, metalness: 0.85 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xe0ad48, roughness: 0.25, metalness: 1, emissive: 0x3a2000, emissiveIntensity: 0.4 })
  const lead = new THREE.MeshStandardMaterial({ color: 0x555b62, roughness: 0.45, metalness: 0.6 })
  const bronze = new THREE.MeshStandardMaterial({ color: 0x3b2f24, roughness: 0.4, metalness: 0.75 })
  const planter = new THREE.MeshStandardMaterial({ color: 0x3b3e40, roughness: 0.55, metalness: 0.4 })

  /* --- small builders ------------------------------------------------------ */
  const _m = new THREE.Matrix4()
  const _q = new THREE.Quaternion()
  const _e = new THREE.Euler()
  const _p = new THREE.Vector3()
  const _s = new THREE.Vector3()
  /** A local transform (in frame F) as a world matrix. */
  const L = (F, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    _e.set(rx, ry, rz)
    _q.setFromEuler(_e)
    _p.set(x, y, z)
    _s.set(sx, sy, sz)
    return new THREE.Matrix4().compose(_p, _q, _s).premultiply(F)
  }
  const frame = (x, z, ry) => new THREE.Matrix4().makeRotationY(ry).premultiply(new THREE.Matrix4().makeTranslation(x, 0, z))
  const I4 = new THREE.Matrix4()
  const place = (mat, geo, F) => {
    geo.applyMatrix4(F)
    B.add(mat, geo)
  }
  /** A wall band in a facade's frame: x0..x1, y0..y1, `depth` thick behind z = 0, with openings. */
  const wallGeo = (x0, x1, y0, y1, depth, holes, tile) => {
    const s = new THREE.Shape()
    s.moveTo(x0, y0)
    s.lineTo(x1, y0)
    s.lineTo(x1, y1)
    s.lineTo(x0, y1)
    s.lineTo(x0, y0)
    for (const h of holes) s.holes.push(holePath(THREE, h))
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 14 })
    g.translate(0, 0, -depth)
    return uvByNormal(g, tile[0], tile[1])
  }
  /** A tunnel (the reveal of a deep opening): a block cx±hw, yb..yt minus the opening, from z1 up to z0. */
  const tunnelGeo = (cx, hw, yb, yt, hole, z0, z1, tile) => {
    const g = wallGeo(cx - hw, cx + hw, yb, yt, z0 - z1, [hole], tile)
    g.translate(0, 0, z0)
    return uvByNormal(g, tile[0], tile[1])
  }
  /** A box in a frame, UVs in metres. */
  const boxGeo = (w, h, d, cx, cy, cz, tile) => {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(cx, cy, cz)
    return uvByNormal(g, tile[0], tile[1])
  }
  const addBox = (mat, tile, F, w, h, d, cx, cy, cz) => place(mat, boxGeo(w, h, d, cx, cy, cz, tile), F)

  // instanced collections
  const WIN = [] // window planes
  const DOORS = { green: [], orange: [], dark: [] }
  const VOUS = [] // dressed stones: voussoirs, quoins, keystones
  const SILL = [] // bluestone sills, ledges
  const BOXES = [] // flower boxes
  const FLOWERS = []
  const BALU = [] // balusters
  const FIN = [] // spear finials
  const fence = beamBatch(THREE)
  const stoneTone = () => {
    const k = range(rand, 0.86, 1.06)
    return new THREE.Color(k * range(rand, 0.98, 1.03), k, k * range(rand, 0.9, 1.0))
  }

  /** Rusticated voussoirs round an arch: alternating long and short, a proud keystone. */
  const archRing = (F, cx, spring, r, { n = 11, rw = 0.6, alt = 0.2, out = 0.07, depth = 0.5, key = 0.12 } = {}) => {
    for (let i = 0; i < n; i++) {
      const a0 = (Math.PI * i) / n
      const a1 = (Math.PI * (i + 1)) / n
      const am = (a0 + a1) / 2
      const isKey = i === (n - 1) / 2
      const len = rw * (i % 2 ? 1 : 1 + alt) + (isKey ? key : 0)
      const rm = r + len / 2
      const wdt = 2 * (r + len * 0.45) * Math.sin((a1 - a0) / 2) - 0.02
      const o = out + (isKey ? 0.05 : 0)
      VOUS.push({ m: L(F, cx + Math.cos(am) * rm, spring + Math.sin(am) * rm, o - depth / 2, len, wdt, depth, 0, 0, am), c: stoneTone() })
    }
  }
  /** Window planes, sills (and optionally voussoirs / flower boxes) for a list of openings in frame F. */
  const fitWindows = (F, holes, { z = -0.3, ring = null, flowers = false, sill = true } = {}) => {
    for (const h of holes) {
      const hh = h.top - h.y0
      WIN.push({ m: L(F, h.x, h.y0 + hh / 2, z, h.w, hh, 1) })
      if (sill) SILL.push({ m: L(F, h.x, h.y0 - 0.07, -0.08, h.w + 0.36, 0.16, 0.5) })
      if (ring && h.arch) archRing(F, h.x, h.top - h.w / 2, h.w / 2, ring)
      if (flowers) {
        for (const side of [-1, 1]) {
          const bx = h.x + side * h.w * 0.25
          BOXES.push({ m: L(F, bx, h.y0 + 0.16, 0.2, h.w * 0.46, 0.3, 0.3) })
          const nF = low ? 10 : 24
          for (let k = 0; k < nF; k++) {
            const fx = bx + range(rand, -h.w * 0.21, h.w * 0.21)
            const leaf = rand() < 0.55
            const col = leaf
              ? new THREE.Color().setHSL(range(rand, 0.22, 0.3), 0.45, range(rand, 0.18, 0.28))
              : new THREE.Color().setHSL(pickHue(rand), range(rand, 0.5, 0.75), range(rand, 0.42, 0.56))
            const s = range(rand, 0.7, 1.3) * (leaf ? 1.3 : 1)
            FLOWERS.push({ m: L(F, fx, h.y0 + 0.34 + range(rand, 0, 0.16), 0.2 + range(rand, -0.11, 0.11), s, s * 0.8, s, rand(), rand(), 0), c: col })
          }
        }
      }
    }
  }
  /** Classical cornice along a facade's top (frame F, x0..x1, base height y). */
  const cornice = (F, x0, x1, y, mat = stone) => {
    const s = new THREE.Shape()
    const pts = [
      [-0.6, 0],
      [0.12, 0],
      [0.12, 0.18],
      [0.22, 0.22],
      [0.22, 0.34],
      [0.42, 0.42],
      [0.62, 0.6],
      [0.72, 0.66],
      [0.8, 0.7],
      [0.8, 0.95],
      [0.86, 0.98],
      [0.86, 1.1],
      [-0.6, 1.1],
    ]
    s.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1])
    s.lineTo(pts[0][0], pts[0][1])
    const D = x1 - x0 + 1.7
    const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false })
    g.rotateY(-Math.PI / 2)
    g.translate(x1 + 0.85, y, 0)
    uvByNormal(g, AT[0], AT[1])
    place(mat, g, F)
  }
  /** A bluestone plinth strip, between openings. */
  const plinth = (F, segs, top = 0.9) => {
    for (const [a, b, bottom = -0.6] of segs) addBox(blue, BT, F, b - a, top - bottom, 0.32, (a + b) / 2, (top + bottom) / 2, -0.06)
  }
  /** Rusticated quoins up a building corner: corner point, and the inward direction along the first face. */
  const quoins = (cx, cz, ax, az, y0 = 0.9, y1 = 19.0) => {
    // b = a × up
    const bx = -az
    const bz = ax
    const F = new THREE.Matrix4().makeBasis(V(ax, 0, az), V(0, 1, 0), V(bx, 0, bz)).premultiply(new THREE.Matrix4().makeTranslation(cx, 0, cz))
    const n = Math.floor((y1 - y0) / 0.5)
    for (let k = 0; k < n; k++) {
      const la = k % 2 ? 1.05 : 0.6
      const lb = k % 2 ? 0.6 : 1.05
      VOUS.push({ m: L(F, la / 2 - 0.06, y0 + k * 0.5 + 0.24, lb / 2 - 0.06, la, 0.47, lb), c: stoneTone() })
    }
  }
  /** Hip roof (or a pyramid when square) over x0..x1 × z0..z1, eaves at y, ridge h higher. */
  const hipRoof = (x0, x1, z0, z1, y, h, over = 0.5, mat = slate) => {
    x0 -= over
    x1 += over
    z0 -= over
    z1 += over
    const lx = x1 - x0
    const lz = z1 - z0
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    const A = [x0, 0, z1]
    const Bp = [x1, 0, z1]
    const C = [x1, 0, z0]
    const D = [x0, 0, z0]
    const faces = []
    if (lx >= lz) {
      const i = lz / 2
      const r0 = [x0 + i, h, cz]
      const r1 = [x1 - i, h, cz]
      faces.push([A, Bp, r1, r0], [C, D, r0, r1], [Bp, C, r1], [D, A, r0])
    } else {
      const i = lx / 2
      const r0 = [cx, h, z1 - i]
      const r1 = [cx, h, z0 + i]
      faces.push([A, Bp, r0], [Bp, C, r1, r0], [C, D, r1], [D, A, r0, r1])
    }
    const pos = []
    const uvs = []
    for (const f of faces) {
      // eave direction and inward horizontal normal of this face
      const ex = f[1][0] - f[0][0]
      const ez = f[1][2] - f[0][2]
      const el = Math.hypot(ex, ez)
      const ux = ex / el
      const uz = ez / el
      const tri = f.length === 4 ? [f[0], f[1], f[2], f[0], f[2], f[3]] : [f[0], f[1], f[2]]
      for (const p of tri) {
        pos.push(p[0], p[1] + y, p[2])
        const along = (p[0] - f[0][0]) * ux + (p[2] - f[0][2]) * uz
        const inward = Math.abs((p[0] - f[0][0]) * -uz + (p[2] - f[0][2]) * ux)
        uvs.push(along / 2, Math.hypot(inward, p[1]) / 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.computeVertexNormals()
    B.add(mat, g)
    return { apex: [cx, y + h, cz] }
  }
  /** A saddle roof: triangle (width w, height h) in a frame's x–y plane, run from z0 back to z1. */
  const saddle = (F, cx, w, y, h, z0, z1) => {
    const s = new THREE.Shape()
    s.moveTo(cx - w / 2, y)
    s.lineTo(cx + w / 2, y)
    s.lineTo(cx, y + h)
    s.lineTo(cx - w / 2, y)
    const g = new THREE.ExtrudeGeometry(s, { depth: z0 - z1, bevelEnabled: false })
    g.translate(0, 0, z1)
    uvByNormal(g, 2, 2)
    place(slate, g, F)
  }
  /** A round column with base and capital (frame F, centred at x, z; from y0 to y1). */
  const column = (F, x, z, y0, y1, r = 0.34) => {
    const h = y1 - y0 - 0.65
    const shaft = new THREE.CylinderGeometry(r * 0.92, r, h, 20, 1, true)
    shaft.translate(x, y0 + 0.3 + h / 2, z)
    const uv = shaft.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 * Math.PI * r) / AT[0], (uv.getY(i) * h) / AT[1])
    place(stone, shaft, F)
    const base = new THREE.CylinderGeometry(r * 1.25, r * 1.35, 0.3, 20)
    base.translate(x, y0 + 0.15, z)
    place(stone, uvByNormal(base, 1, 1), F)
    addBox(block, [1, 1], F, r * 2.9, 0.35, r * 2.9, x, y1 - 0.175, z)
    const neck = new THREE.CylinderGeometry(r * 1.35, r * 0.95, 0.3, 20)
    neck.translate(x, y1 - 0.5, z)
    place(stone, uvByNormal(neck, 1, 1), F)
  }
  const steps = (F, x0, x1, z0, rise, tread, n, extraBack = 0) => {
    // n steps rising toward −z, the first at z0 (front edge), each `tread` deep
    for (let k = 1; k <= n; k++) {
      const front = z0 - tread * (k - 1)
      const back = -extraBack
      addBox(blue, BT, F, x1 - x0, rise * k, front - back, (x0 + x1) / 2, (rise * k) / 2, (front + back) / 2)
    }
  }

  /* ========================================================================= */
  /* the south face, on the Doelwater (where the photographs were taken)       */
  /* ========================================================================= */
  const FS = frame(-53, 0, 0) // local x 0..106 → world x −53..53
  const GT = 7.4 // top of the rusticated ground storey
  const TOP = 19.0 // cornice
  const OPEN = {
    gate: { x: 17, w: 4.8, y0: -0.3, top: 6.6, arch: true },
    door: { x: 28.5, w: 3.6, y0: -0.3, top: 5.7, arch: true },
    portal: { x: 39.5, w: 5.6, y0: -0.3, top: 6.6, arch: true },
    niche: { x: 51, w: 3.4, y0: 1.4, top: 6.0, arch: true },
  }
  const LOGX = [67.95, 73.55, 79.15]
  const LOG = LOGX.map((x) => ({ x, w: 4.3, y0: -0.3, top: 6.55, arch: true }))
  const gWinX = [4.5, 10.5, 23, 33, 45.5, 56.5, 61, 87, 92.5, 98, 103.5]
  const gWin = gWinX.map((x) => ({ x, w: 2.2, y0: 2.6, top: 6.0 }))
  place(rustic, wallGeo(0, 106, -0.6, GT, 0.75, [...gWin, OPEN.gate, OPEN.door, OPEN.portal, OPEN.niche, ...LOG], RT), FS)
  fitWindows(FS, gWin, { flowers: true })
  const U = [4.5, 10.5, 17, 23, 28.5, 33, 39.5, 45.5, 51, 56.5, 61, 67.95, 73.55, 79.15, 87, 92.5, 98, 103.5]
  const w1 = U.map((x) => ({ x, w: 2.0, y0: 8.6, top: 12.6, arch: true }))
  const w2 = U.map((x) => ({ x, w: 2.0, y0: 14.0, top: 17.2 }))
  place(stone, wallGeo(0, 106, GT, TOP, 0.75, [...w1, ...w2], AT), FS)
  const smallRing = { n: 9, rw: 0.42, alt: 0.18, out: 0.06, depth: 0.4, key: 0.1 }
  fitWindows(FS, w1, { ring: smallRing })
  fitWindows(FS, w2)
  // string course over the ground storey, and the cornice
  addBox(block, [3, 0.4], FS, 106.6, 0.36, 0.52, 53, GT + 0.06, -0.04)
  cornice(FS, 0, 106, TOP)
  plinth(FS, [
    [0, 14.6],
    [19.4, 26.7],
    [30.3, 36.1],
    [42.9, 63.9],
    [83.2, 84.0],
    [84.0, 106, -2.75],
  ])
  // the big arches' voussoirs
  archRing(FS, OPEN.gate.x, 4.2, 2.4, { n: 13, rw: 0.62, alt: 0.2 })
  archRing(FS, OPEN.door.x, 3.9, 1.8, { n: 11, rw: 0.58, alt: 0.22 })
  archRing(FS, OPEN.portal.x, 3.8, 2.8, { n: 15, rw: 0.6, alt: 0.2 })
  archRing(FS, OPEN.niche.x, 4.3, 1.7, { n: 11, rw: 0.78, alt: 0.25 })
  for (const x of LOGX) archRing(FS, x, 4.4, 2.15, { n: 13, rw: 0.55, alt: 0.12 })
  quoins(53, 0, -1, 0)
  quoins(-53, 0, 0, -1)

  /* --- photo 1: the passage to the courtyard, behind the iron gate --------- */
  {
    const g = OPEN.gate
    place(stone, tunnelGeo(g.x, 3.6, -0.6, 7.3, g, -0.75, -14, AT), FS)
    // the floor of the passage
    addBox(setts, [2, 2], FS, 4.9, 0.1, 13.3, g.x, -0.05, -7.4)
    // the gate: bars to the arch line, rails, scrolls, spear tips
    const r = g.w / 2
    const spring = g.top - r
    const zG = -0.42
    for (let x = -r + 0.06; x <= r - 0.05; x += 0.125) {
      const top = spring + Math.sqrt(Math.max(0, r * r - x * x)) - 0.06
      const thick = Math.abs(x) < 0.07 || Math.abs(Math.abs(x) - (r - 0.06)) < 0.07 ? 0.06 : 0.026
      fence.add(V(g.x + x, 0.04, zG).applyMatrix4(FS), V(g.x + x, top, zG).applyMatrix4(FS), thick, thick)
    }
    for (const y of [0.16, 0.95, 2.45, 2.62, 4.2]) {
      const hw = y > spring ? Math.sqrt(r * r - (y - spring) ** 2) : r
      fence.add(V(g.x - hw + 0.04, y, zG).applyMatrix4(FS), V(g.x + hw - 0.04, y, zG).applyMatrix4(FS), 0.05, 0.04)
    }
    // the little lyre scrolls between the two rails, every third bar
    for (let x = -r + 0.31; x < r - 0.2; x += 0.375) {
      for (const s of [-1, 1]) fence.add(V(g.x + x, 2.62, zG).applyMatrix4(FS), V(g.x + x + s * 0.09, 2.9, zG).applyMatrix4(FS), 0.022, 0.022)
      for (const s of [-1, 1]) fence.add(V(g.x + x, 2.45, zG).applyMatrix4(FS), V(g.x + x + s * 0.08, 2.25, zG).applyMatrix4(FS), 0.022, 0.022)
    }
    // green panels behind the bars (letterbox, notice board)
    addBox(iron, [1, 1], FS, 0.62, 0.72, 0.12, g.x + 0.65, 1.45, zG - 0.08)
    addBox(iron, [1, 1], FS, 0.7, 1.05, 0.1, g.x - 0.55, 3.25, zG - 0.08)
    // bronze plaques on the left pier
    addBox(bronze, [1, 1], FS, 0.72, 0.36, 0.03, g.x - 3.35, 2.1, 0.015)
    addBox(bronze, [1, 1], FS, 0.62, 0.2, 0.03, g.x - 3.35, 2.62, 0.015)
  }

  /* --- photo 2: the green glazed door in stepped orders -------------------- */
  {
    const d = OPEN.door
    const o1 = { x: d.x, w: 3.0, y0: -0.3, top: 3.9 + 1.5, arch: true }
    const o2 = { x: d.x, w: 2.5, y0: -0.3, top: 3.9 + 1.25, arch: true }
    place(rustic, tunnelGeo(d.x, 2.4, -0.6, 6.6, o1, -0.75, -1.2, RT), FS)
    place(rustic, tunnelGeo(d.x, 2.4, -0.6, 6.6, o2, -1.2, -1.75, RT), FS)
    addBox(blue, BT, FS, 3.5, 0.36, 1.75, d.x, 0.18, -0.875)
    addBox(blue, BT, FS, 3.8, 0.18, 0.42, d.x, 0.09, 0.21)
    DOORS.green.push({ m: L(FS, d.x, 0.36 + (3.9 - 0.36) / 2, -1.6, 2.5, 3.9 - 0.36, 1) })
    WIN.push({ m: L(FS, d.x, 3.9 + 0.62, -1.62, 2.5, 1.25, 1) })
  }

  /* --- photo 3: the Burgerlijke Stand portal ------------------------------- */
  const PORTAL_LAND = 0.54
  {
    const p = OPEN.portal
    place(rustic, tunnelGeo(p.x, 3.6, -0.6, 7.3, p, -0.75, -2.2, RT), FS)
    const doors = [-1.3, 1.3].map((dx) => ({ x: p.x + dx, w: 1.7, y0: 0.4, top: 3.75, arch: true }))
    place(stone, wallGeo(p.x - 2.95, p.x + 2.95, -0.6, 7.2, 0.4, doors, AT).translate(0, 0, -2.2), FS)
    for (const dh of doors) {
      DOORS.orange.push({ m: L(FS, dh.x, PORTAL_LAND + (2.9 - PORTAL_LAND) / 2, -2.48, 1.7, 2.9 - PORTAL_LAND, 1) })
      WIN.push({ m: L(FS, dh.x, 2.9 + 0.43, -2.5, 1.7, 0.86, 1) })
      archRing(FS, dh.x, 2.9, 0.85, { n: 9, rw: 0.32, alt: 0.15, out: 0.05, depth: 0.3, key: 0.06 })
    }
    // landing and steps
    addBox(blue, BT, FS, 5.6, PORTAL_LAND, 2.2, p.x, PORTAL_LAND / 2, -1.1)
    steps(FS, p.x - 3.3, p.x + 3.3, 1.05, 0.18, 0.35, 3)
    // statue on a pedestal between the doors
    addBox(block, [1, 1], FS, 0.7, 1.35, 0.5, p.x, PORTAL_LAND + 0.675, -1.95)
    const robe = new THREE.LatheGeometry(
      [V(0.001, 0, 0), V(0.3, 0, 0), V(0.27, 0.5, 0), V(0.22, 1.0, 0), V(0.25, 1.25, 0), V(0.14, 1.38, 0), V(0.07, 1.45, 0), V(0.001, 1.45, 0)].map((v) => new THREE.Vector2(v.x, v.y)),
      14
    )
    robe.translate(p.x, PORTAL_LAND + 1.35, -1.95)
    place(stone, uvByNormal(robe, 1, 1), FS)
    const head = new THREE.SphereGeometry(0.13, 12, 10)
    head.translate(p.x, PORTAL_LAND + 1.35 + 1.58, -1.95)
    place(stone, uvByNormal(head, 1, 1), FS)
    // the plaque: AFDEELINGEN BURGERLIJKE STAND …
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(2.7, 0.98),
      new THREE.MeshStandardMaterial({ map: plaqueTexture(THREE), roughness: 0.45, metalness: 0.35 })
    )
    plaque.applyMatrix4(L(FS, p.x, 4.78, -2.17))
    scene.add(plaque)
    // a carved head over the keystone, pilasters each side with capped tops
    const mask = new THREE.SphereGeometry(0.3, 12, 10)
    mask.scale(1, 1.2, 0.7)
    mask.translate(p.x, GT - 0.15 + 0.6, 0.12)
    place(block, uvByNormal(mask, 1, 1), FS)
    for (const s of [-1, 1]) {
      addBox(rustic, RT, FS, 0.9, GT + 0.6, 0.45, p.x + s * 3.9, (GT + 0.6) / 2 - 0.3, 0.2)
      addBox(block, [1, 1], FS, 1.15, 0.45, 0.7, p.x + s * 3.9, GT + 0.5, 0.2)
      const beast = new THREE.SphereGeometry(0.34, 10, 8)
      beast.scale(1.2, 0.9, 0.8)
      beast.translate(p.x + s * 3.9, GT + 1.0, 0.2)
      place(block, uvByNormal(beast, 1, 1), FS)
    }
    // green tube railings up both sides of the steps and along the landing
    for (const s of [-1, 1]) {
      const x = p.x + s * 3.1
      const pts = [V(x, 0.18 + 0.95, 0.95), V(x, PORTAL_LAND + 0.95, -0.1), V(x, PORTAL_LAND + 0.95, -1.9)]
      for (let i = 0; i < 2; i++) {
        const a = pts[i].clone().applyMatrix4(FS)
        const b = pts[i + 1].clone().applyMatrix4(FS)
        fence.add(a, b, 0.05, 0.05)
        fence.add(a.clone().setY(a.y - 0.45), b.clone().setY(b.y - 0.45), 0.04, 0.04)
      }
      for (const pz of [0.95, -0.1, -1.9]) {
        const base = pz > 0.5 ? 0.18 : PORTAL_LAND
        fence.add(V(x, base, pz).applyMatrix4(FS), V(x, base + 0.97, pz).applyMatrix4(FS), 0.05, 0.05)
      }
    }
    const lx0 = p.x + 0.4
    fence.add(V(lx0, PORTAL_LAND + 0.95, -0.12).applyMatrix4(FS), V(p.x + 3.1, PORTAL_LAND + 0.95, -0.12).applyMatrix4(FS), 0.05, 0.05)
    fence.add(V(lx0, PORTAL_LAND + 0.5, -0.12).applyMatrix4(FS), V(p.x + 3.1, PORTAL_LAND + 0.5, -0.12).applyMatrix4(FS), 0.04, 0.04)
    fence.add(V(lx0, PORTAL_LAND, -0.12).applyMatrix4(FS), V(lx0, PORTAL_LAND + 0.97, -0.12).applyMatrix4(FS), 0.05, 0.05)
  }

  /* --- photo 4: the deep arched niche with a window at its back ------------ */
  {
    const n = OPEN.niche
    const inner = { x: n.x, w: 2.6, y0: n.y0, top: 4.3 + 1.3, arch: true }
    place(rustic, tunnelGeo(n.x, 2.4, 1.0, 7.2, inner, -0.75, -1.25, RT), FS)
    place(stone, tunnelGeo(n.x, 2.0, 1.0, 7.0, inner, -1.25, -1.95, AT), FS)
    const win = { x: n.x, w: 1.3, y0: 2.0, top: 4.25, arch: true }
    place(stone, wallGeo(n.x - 1.6, n.x + 1.6, 1.0, 6.2, 0.3, [win], AT).translate(0, 0, -1.95), FS)
    WIN.push({ m: L(FS, n.x, (win.y0 + win.top) / 2, -2.12, 1.3, win.top - win.y0, 1) })
    SILL.push({ m: L(FS, n.x, 1.31, -0.25, 4.1, 0.2, 1.15) })
    // the vault of the niche: a half dome in thin yellow brick
    // (a quarter sphere: above the springing, reaching back to the back wall)
    const dome = new THREE.SphereGeometry(1, 20, 8, Math.PI, Math.PI, 0, Math.PI / 2)
    dome.scale(1.27, 1.27, 0.56)
    dome.translate(n.x, 4.3, -1.39)
    const uv = dome.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 1.2)
    place(yBrickIn, dome, FS)
  }

  /* --- photos 5 and 6: the loggia up five steps, with domed vaults --------- */
  const LOGGIA = { x0: 12.2, x1: 28.9, zb: -7.0, floor: 0.9 }
  {
    const FL = 0.9
    const zb = -7.0
    // the floor slab, steps and pedestals
    addBox(loggiaFloor, [4, 4], I4, 16.7, FL, 7.0, 20.55, FL / 2, -3.5)
    steps(I4, 10.9, 30.2, 1.9, 0.18, 0.38, 5, 0.0)
    // side walls and the back wall with a door and two blind arches
    addBox(stone, AT, I4, 0.7, 8.2, 6.4, 11.85, 4.1, -3.85)
    addBox(stone, AT, I4, 0.7, 8.2, 6.4, 29.25, 4.1, -3.85)
    const FB = frame(0, zb, 0)
    const backDoor = { x: 20.55, w: 2.6, y0: 0.7, top: 5.6, arch: true }
    const blind = [14.95, 26.15].map((x) => ({ x, w: 2.9, y0: 1.5, top: 6.1, arch: true }))
    place(stone, wallGeo(12.2, 28.9, 0.6, 8.0, 0.45, [backDoor, ...blind], AT), FB)
    DOORS.dark.push({ m: L(FB, 20.55, FL + (4.3 - FL) / 2, -0.35, 2.6, 4.3 - FL, 1) })
    WIN.push({ m: L(FB, 20.55, 4.3 + 0.65, -0.37, 2.6, 1.3, 1) })
    archRing(FB, 20.55, 4.3, 1.3, { n: 11, rw: 0.38, alt: 0.1, out: 0.05, depth: 0.3, key: 0.06 })
    for (const b of blind) {
      const win = { x: b.x, w: 1.4, y0: 2.5, top: 5.2, arch: true }
      place(stone, wallGeo(b.x - 1.7, b.x + 1.7, 1.0, 6.6, 0.3, [win], AT).translate(0, 0, -0.45), FB)
      WIN.push({ m: L(FB, b.x, (win.y0 + win.top) / 2, -0.62, 1.4, win.top - win.y0, 1) })
      SILL.push({ m: L(FB, b.x, 1.42, -0.2, 3.1, 0.16, 0.5) })
      archRing(FB, b.x, 6.1 - 1.45, 1.45, { n: 13, rw: 0.36, alt: 0.08, out: 0.04, depth: 0.25, key: 0.05 })
    }
    // transverse arches between the bays (in the y–z plane)
    const FT = (x) => frame(x, 0, Math.PI / 2) // local x → world −z
    for (const x of [17.75, 23.35]) {
      const g = wallGeo(0.75, 7.0, 0.6, 7.0, 0.9, [{ x: 3.875, w: 5.05, y0: 0.7, top: 4.4 + 2.525, arch: true }], AT)
      g.translate(0, 0, 0.45)
      place(stone, g, FT(x))
    }
    // the flat ceiling between the domes, and the domes in yellow brick
    const cs = new THREE.Shape()
    cs.moveTo(12.2, 0.75)
    cs.lineTo(28.9, 0.75)
    cs.lineTo(28.9, 7.0)
    cs.lineTo(12.2, 7.0)
    cs.lineTo(12.2, 0.75)
    for (const x of [14.95, 20.55, 26.15]) {
      const h = new THREE.Path()
      h.absellipse(x, 3.875, 2.25, 2.6, 0, Math.PI * 2, true)
      cs.holes.push(h)
    }
    const ceil = new THREE.ShapeGeometry(cs, 24)
    ceil.rotateX(Math.PI / 2) // shape y → world +z … flip to −z below
    ceil.scale(1, 1, -1)
    ceil.translate(0, 7.0, 0)
    // after the mirror the triangles face up; flip them back to face down
    flipWinding(ceil)
    ceil.computeVertexNormals()
    uvByNormal(ceil, 2, 2)
    B.add(yBrick, ceil)
    for (const x of [14.95, 20.55, 26.15]) {
      const d = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2)
      d.scale(2.25, 1.5, 2.6)
      d.translate(x, 7.0, -3.875)
      const uv = d.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7.5, uv.getY(i) * 3.4)
      B.add(yBrickIn, d)
    }
    // the inside face of the front wall above the arches is the wall's own back
    // columns in front of the piers, on pedestals
    for (const px of [12.15, 17.75, 23.35, 28.95]) {
      addBox(blue, BT, I4, 1.05, 1.1, 1.05, px, 0.55, 0.42)
      column(I4, px, 0.42, 1.1, 4.55, 0.34)
    }
  }

  /* --- photo 7: the light well, its railing and the flower boxes ----------- */
  const WELL = { x0: 31, x1: 52.8, z1: 2.4, y: -2.75 }
  {
    const bw = [87, 92.5, 98, 103.5].map((x) => ({ x, w: 1.6, y0: -2.3, top: -1.0 }))
    place(stone, wallGeo(84, 106, -2.75, -0.6, 0.75, bw, AT), FS)
    fitWindows(FS, bw, { sill: false })
    addBox(blue, BT, I4, WELL.x1 - WELL.x0, 0.2, WELL.z1, (WELL.x0 + WELL.x1) / 2, WELL.y - 0.1, WELL.z1 / 2)
    addBox(stone, AT, I4, WELL.x1 - WELL.x0 + 0.6, -WELL.y, 0.3, (WELL.x0 + WELL.x1) / 2, WELL.y / 2, WELL.z1 + 0.15)
    addBox(stone, AT, I4, 0.3, -WELL.y, WELL.z1, WELL.x0 - 0.15, WELL.y / 2, WELL.z1 / 2)
    addBox(stone, AT, I4, 0.3, -WELL.y, WELL.z1, WELL.x1 + 0.15, WELL.y / 2, WELL.z1 / 2)
    // the kerb the railing stands on
    addBox(blue, BT, I4, WELL.x1 - WELL.x0 + 0.6, 0.24, 0.34, (WELL.x0 + WELL.x1) / 2, 0.12, WELL.z1 + 0.15)
    addBox(blue, BT, I4, 0.34, 0.24, WELL.z1, WELL.x0 - 0.15, 0.12, WELL.z1 / 2)
    // granite posts between the windows
    const posts = [31, 36.75, 42.25, 47.75, 52.8]
    for (const x of posts) {
      addBox(blue, BT, I4, 0.46, 1.55, 0.46, x, 0.24 + 0.775, WELL.z1 + 0.15)
      const cap = new THREE.CylinderGeometry(0.16, 0.3, 0.22, 4, 1)
      cap.rotateY(Math.PI / 4)
      cap.translate(x, 0.24 + 1.55 + 0.11, WELL.z1 + 0.15)
      B.add(blue, uvByNormal(cap, 1, 1))
      addBox(blue, BT, I4, 0.54, 0.1, 0.54, x, 0.24 + 1.5, WELL.z1 + 0.15)
    }
    // bars with spear tips, two rails and a bottom rail, between the posts
    const zf = WELL.z1 + 0.15
    const barTop = 0.24 + 1.42
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i] + 0.26
      const b = posts[i + 1] - 0.26
      for (const y of [0.36, 1.3, 1.5]) fence.add(V(a, y, zf), V(b, y, zf), 0.045, 0.03)
      for (let x = a + 0.06; x < b - 0.03; x += 0.13) {
        fence.add(V(x, 0.24, zf), V(x, barTop, zf), 0.022, 0.022)
        FIN.push({ m: L(I4, x, barTop + 0.06, zf, 1, 1, 1) })
      }
      // a scroll band low down
      for (let x = a + 0.12; x < b - 0.1; x += 0.39) fence.add(V(x - 0.06, 0.36, zf), V(x + 0.06, 0.62, zf), 0.018, 0.018)
    }
    // the short return at the west end, back to the wall
    for (let z = 0.15; z < WELL.z1 - 0.1; z += 0.13) {
      fence.add(V(WELL.x0 - 0.15, 0.24, z), V(WELL.x0 - 0.15, barTop, z), 0.022, 0.022)
      FIN.push({ m: L(I4, WELL.x0 - 0.15, barTop + 0.06, z, 1, 1, 1) })
    }
    for (const y of [0.36, 1.3, 1.5]) fence.add(V(WELL.x0 - 0.15, y, 0.05), V(WELL.x0 - 0.15, y, WELL.z1), 0.03, 0.045)
    // a small round "no cycling" sign wired to the railing
    const sg = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), signMaterial(THREE, 'nobike'))
    sg.position.set(33.2, 1.05, zf + 0.03)
    scene.add(sg)
  }

  /* --- dormer gables and dormers on the south roof ------------------------- */
  const gable = (F, x, w, h, wins) => {
    const s = new THREE.Shape()
    s.moveTo(x - w / 2, TOP)
    s.lineTo(x + w / 2, TOP)
    s.lineTo(x + w / 2, TOP + 2.6)
    s.lineTo(x, TOP + h)
    s.lineTo(x - w / 2, TOP + 2.6)
    s.lineTo(x - w / 2, TOP)
    for (const wh of wins) s.holes.push(holePath(THREE, wh))
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.6, bevelEnabled: false, curveSegments: 12 })
    g.translate(0, 0, -0.6)
    place(stone, uvByNormal(g, AT[0], AT[1]), F)
    fitWindows(F, wins, { z: -0.28, ring: smallRing })
    // copings up the slopes, a finial at the top, ball-topped blocks at the feet
    const slope = Math.atan2(h - 2.6, w / 2)
    const len = Math.hypot(h - 2.6, w / 2) + 0.3
    for (const sd of [-1, 1]) {
      const g2 = new THREE.BoxGeometry(len, 0.3, 0.8)
      g2.rotateZ(sd * -slope)
      g2.translate(x + (sd * w) / 4, TOP + 2.6 + (h - 2.6) / 2 + 0.12, -0.2)
      place(block, uvByNormal(g2, 1.2, 1.2), F)
      addBox(block, [1, 1], F, 0.7, 0.9, 0.8, x + (sd * w) / 2, TOP + 2.6 + 0.3, -0.2)
      const ob = new THREE.ConeGeometry(0.28, 1.4, 4)
      ob.rotateY(Math.PI / 4)
      ob.translate(x + (sd * w) / 2, TOP + 2.6 + 0.75 + 0.7, -0.2)
      place(block, uvByNormal(ob, 1, 1), F)
    }
    const fin = new THREE.ConeGeometry(0.3, 1.6, 4)
    fin.rotateY(Math.PI / 4)
    fin.translate(x, TOP + h + 0.9, -0.2)
    place(block, uvByNormal(fin, 1, 1), F)
    saddle(F, x, w - 0.2, TOP, h - 0.3, -0.5, -7.2)
  }
  gable(FS, 17, 5.2, 6.6, [{ x: 17, w: 1.5, y0: TOP + 1.3, top: TOP + 4.0, arch: true }])
  gable(FS, 39.5, 5.2, 6.6, [{ x: 39.5, w: 1.5, y0: TOP + 1.3, top: TOP + 4.0, arch: true }])
  gable(FS, 73.55, 9.0, 8.4, [
    { x: 72.3, w: 1.6, y0: TOP + 1.3, top: TOP + 4.4, arch: true },
    { x: 74.8, w: 1.6, y0: TOP + 1.3, top: TOP + 4.4, arch: true },
  ])
  const dormer = (F, x, zFront) => {
    // the roof plane of a 14 m wing: eave at z = +0.5, y = TOP + 1.1; ridge at −7, +8.5
    const yR = TOP + 1.1 + (0.5 - zFront) * (8.5 / 7.5)
    addBox(stone, AT, F, 1.9, 2.4, 2.6, x, yR + 0.9, zFront - 1.3)
    WIN.push({ m: L(F, x, yR + 0.95, zFront + 0.01, 1.1, 1.5, 1) })
    saddle(F, x, 2.4, yR + 2.1, 1.0, zFront + 0.15, zFront - 2.8)
  }
  for (const x of [28.5, 51, 61, 87.5]) dormer(FS, x, -1.6)

  /* ========================================================================= */
  /* the Coolsingel front (east), with the main entrance and stepped gable     */
  /* ========================================================================= */
  const FE = frame(53, 0, Math.PI / 2) // local x 0..86 → world z 0..−86, facing +X
  const plainFacade = (F, x0, x1, xs, { ringUp = true, flowers = false } = {}) => {
    const gw = xs.map((x) => ({ x, w: 2.2, y0: 2.6, top: 6.0 }))
    place(rustic, wallGeo(x0, x1, -0.6, GT, 0.75, gw, RT), F)
    fitWindows(F, gw, { flowers })
    const a = xs.map((x) => ({ x, w: 2.0, y0: 8.6, top: 12.6, arch: true }))
    const b = xs.map((x) => ({ x, w: 2.0, y0: 14.0, top: 17.2 }))
    place(stone, wallGeo(x0, x1, GT, TOP, 0.75, [...a, ...b], AT), F)
    fitWindows(F, a, { ring: ringUp ? smallRing : null })
    fitWindows(F, b)
    addBox(block, [3, 0.4], F, x1 - x0 + 0.6, 0.36, 0.52, (x0 + x1) / 2, GT + 0.06, -0.04)
    cornice(F, x0, x1, TOP)
    plinth(F, [[x0, x1]])
  }
  plainFacade(FE, 0.75, 31, [4.5, 10, 15.5, 21, 26.5], { flowers: true })
  plainFacade(FE, 55, 85.25, [59.5, 65, 70.5, 76, 81.5], { flowers: true })
  {
    // the central projection, 1.2 m forward, taller, with the entrance
    const FP = new THREE.Matrix4().makeTranslation(0, 0, 1.2).premultiply(FE)
    const PT = 21.5
    const ent = [39.3, 43, 46.7].map((x) => ({ x, w: 3.0, y0: 1.0, top: 5.5, arch: true }))
    const side = [34, 52].map((x) => ({ x, w: 2.0, y0: 2.6, top: 6.0 }))
    place(rustic, wallGeo(31, 55, -0.6, GT, 0.75, [...ent, ...side], RT), FP)
    fitWindows(FP, side)
    for (const e of ent) {
      archRing(FP, e.x, 4.0, 1.5, { n: 11, rw: 0.45, alt: 0.15 })
      place(stone, tunnelGeo(e.x, 1.85, 0.6, 6.2, e, -0.75, -3.0, AT), FP)
      DOORS.dark.push({ m: L(FP, e.x, 1.3 + (4.0 - 1.3) / 2, -2.9, 3.0, 4.0 - 1.3, 1) })
      WIN.push({ m: L(FP, e.x, 4.0 + 0.75, -2.92, 3.0, 1.5, 1) })
    }
    addBox(blue, BT, FP, 12.6, 1.3, 3.0, 43, 0.65, -1.5)
    steps(FP, 35.8, 50.2, 2.8, 0.186, 0.4, 7, 0)
    for (const cx of [37.6, 41.15, 44.85, 48.4]) column(FP, cx, 0.32, 1.3, 4.4, 0.3)
    // the Burgerzaal: five tall arched windows; side windows
    const hall = [37, 40, 43, 46, 49].map((x) => ({ x, w: 2.2, y0: 8.6, top: 15.0, arch: true }))
    const s1 = [34, 52].map((x) => ({ x, w: 2.0, y0: 8.6, top: 12.6, arch: true }))
    const s2 = [34, 52].map((x) => ({ x, w: 2.0, y0: 14.0, top: 17.2 }))
    const s3 = [34, 52, 37, 40, 43, 46, 49].map((x) => ({ x, w: 1.6, y0: 17.6, top: 19.8 }))
    place(stone, wallGeo(31, 55, GT, PT, 0.75, [...hall, ...s1, ...s2, ...s3], AT), FP)
    fitWindows(FP, hall, { ring: smallRing })
    fitWindows(FP, s1, { ring: smallRing })
    fitWindows(FP, [...s2, ...s3])
    addBox(block, [3, 0.4], FP, 24.6, 0.36, 0.52, 43, GT + 0.06, -0.04)
    cornice(FP, 31, 55, PT)
    plinth(FP, [
      [31, 35.5],
      [50.5, 55],
    ])
    // side returns of the projection
    for (const x of [31, 55]) addBox(stone, AT, FE, 0.75, PT + 0.6, 1.2, x + (x < 40 ? 0.375 : -0.375), (PT + 0.6) / 2 - 0.6, 0.6)
    // balcony over the entrance
    addBox(blue, BT, FP, 13.2, 0.32, 1.8, 43, GT - 0.06, 0.9)
    for (let x = 36.7; x <= 49.3; x += 0.32) BALU.push({ m: L(FP, x, GT + 0.1, 1.62, 1, 1, 1) })
    addBox(blue, BT, FP, 13.2, 0.14, 0.3, 43, GT + 0.87, 1.62)
    // the stepped gable with obelisks and an oculus
    const sg = new THREE.Shape()
    const gy = PT + 1.1
    const gp = [
      [31, gy], [55, gy], [55, gy + 2.4], [52.5, gy + 2.4], [52.5, gy + 4.4], [50, gy + 4.4], [50, gy + 6.4], [47.5, gy + 6.4], [47.5, gy + 8.4], [45.5, gy + 8.4], [45.5, gy + 10],
      [40.5, gy + 10], [40.5, gy + 8.4], [38.5, gy + 8.4], [38.5, gy + 6.4], [36, gy + 6.4], [36, gy + 4.4], [33.5, gy + 4.4], [33.5, gy + 2.4], [31, gy + 2.4],
    ]
    sg.moveTo(gp[0][0], gp[0][1])
    for (let i = 1; i < gp.length; i++) sg.lineTo(gp[i][0], gp[i][1])
    sg.lineTo(gp[0][0], gp[0][1])
    const oc = new THREE.Path()
    oc.absarc(43, gy + 5.8, 1.1, 0, Math.PI * 2, true)
    sg.holes.push(oc)
    const gg = new THREE.ExtrudeGeometry(sg, { depth: 0.8, bevelEnabled: false, curveSegments: 18 })
    gg.translate(0, 0, -0.8)
    place(stone, uvByNormal(gg, AT[0], AT[1]), FP)
    WIN.push({ m: L(FP, 43, gy + 5.8, -0.5, 2.3, 2.3, 1) })
    for (const [ox, oy] of [[31.6, gy + 2.4], [54.4, gy + 2.4], [36.6, gy + 6.4], [49.4, gy + 6.4], [41.1, gy + 10], [44.9, gy + 10]]) {
      addBox(block, [1, 1], FP, 0.8, 0.5, 0.9, ox, oy + 0.25, -0.4)
      const ob = new THREE.ConeGeometry(0.3, 1.8, 4)
      ob.rotateY(Math.PI / 4)
      ob.translate(ox, oy + 0.5 + 0.9, -0.4)
      place(block, uvByNormal(ob, 1, 1), FP)
    }
    saddle(FP, 43, 24, PT + 1.1, 9.4, -0.6, -15)
    // two wrought-iron lanterns at the foot of the stairs
    for (const x of [35.2, 50.8]) {
      fence.add(V(x, 0, 3.1).applyMatrix4(FP), V(x, 3.4, 3.1).applyMatrix4(FP), 0.1, 0.1)
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.6, 6), new THREE.MeshStandardMaterial({ color: 0x2a2a24, emissive: 0xffc27a, emissiveIntensity: 0.9, roughness: 0.4 }))
      lamp.position.set(x, 3.7, 3.1).applyMatrix4(FP)
      scene.add(lamp)
    }
  }

  /* --- north and west faces ------------------------------------------------ */
  const FN = frame(53, -86, Math.PI) // local 0..106 → world x 53..−53, facing −Z
  plainFacade(FN, 0, 106, [4.5, 10.5, 16.5, 22.5, 28.5, 34.5, 40.5, 46.5, 53, 59.5, 65.5, 71.5, 77.5, 83.5, 89.5, 95.5, 101.5])
  const FW = frame(-53, -86, -Math.PI / 2) // local 0..86 → world z −86..0, facing −X
  plainFacade(FW, 0.75, 85.25, [5, 11, 17, 23, 29, 35, 43, 51, 57, 63, 69, 75, 81])
  quoins(53, -86, 0, 1)
  quoins(-53, -86, 1, 0)

  /* --- roofs: wings, corner pavilions with lead crowns, the central hall --- */
  const RY = TOP + 1.1
  hipRoof(-39, 39, -14, 0, RY, 8.5)
  hipRoof(-39, 39, -86, -72, RY, 8.5)
  hipRoof(39, 53, -72, -14, RY, 8.5)
  hipRoof(-53, -39, -72, -14, RY, 8.5)
  for (const [x0, z0] of [[-53, -14], [39, -14], [39, -86], [-53, -86]]) {
    const { apex } = hipRoof(x0, x0 + 14, z0, z0 + 14, RY, 12.5)
    const crown = new THREE.LatheGeometry(
      [[0.001, 0], [0.55, 0], [0.5, 0.4], [0.28, 0.8], [0.42, 1.25], [0.2, 1.8], [0.08, 2.6], [0.001, 2.9]].map(([a, b]) => new THREE.Vector2(a, b)),
      8
    )
    crown.translate(apex[0], apex[1] - 0.3, apex[2])
    B.add(lead, crown)
  }
  // inner wings and the central hall (seen from the air and over the roofs)
  addBox(rBrick, [2, 2], I4, 11, 17, 58, 8.5, 8.5, -43)
  hipRoof(3, 14, -72, -14, 17, 6)
  addBox(stone, AT, I4, 25, 18.5, 30, 26.5, 9.25, -43)
  hipRoof(14, 39, -58, -28, 18.5, 7.5)

  /* --- the courtyard seen through the gate --------------------------------- */
  {
    addBox(setts, [2, 2], I4, 42, 0.04, 58, -18, 0.0, -43)
    // the brick range across the courtyard with its arcade under the Raadzaal
    const FC = frame(0, -36, 0)
    const arc = [-35, -28, -21, -14, -7].map((x) => ({ x, w: 4.0, y0: -0.3, top: 5.2, arch: true }))
    const cw = [-35, -28, -21, -14, -7].flatMap((x) => [
      { x, w: 1.7, y0: 7.0, top: 9.6 },
      { x, w: 1.7, y0: 10.8, top: 12.9 },
    ])
    place(rBrick, wallGeo(-39, 3, -0.6, 14.5, 0.5, [...arc, ...cw], [2, 2]), FC)
    fitWindows(FC, cw, { z: -0.25 })
    for (const y of [5.55, 9.9, 13.6]) addBox(block, [3, 0.4], FC, 42, 0.3, 0.2, -18, y, 0.05)
    for (const a of arc) archRing(FC, a.x, 3.2, 2.0, { n: 11, rw: 0.32, alt: 0, out: 0.04, depth: 0.3, key: 0.05 })
    addBox(dark, [1, 1], FC, 42, 6, 5.5, -18, 2.6, -3.3)
    hipRoof(-39, 3, -48, -36, 14.5, 6.0)
    // the courtyard sides of the wings
    addBox(rBrick, [2, 2], I4, 0.6, 19, 58, -39.3, 9.5, -43)
    addBox(rBrick, [2, 2], I4, 71.4, 19, 0.6, 3.3, 9.5, -14.3)
    addBox(rBrick, [2, 2], I4, 7.2, 11.7, 0.6, -36, 13.15, -14.3)
  }

  /* ========================================================================= */
  /* the tower: stone shaft, octagonal lantern, copper crown, gilded figure    */
  /* ========================================================================= */
  const TX = 31
  const TZ = -43
  {
    for (let k = 0; k < 4; k++) {
      const F = frame(TX + Math.sin((k * Math.PI) / 2) * 5.5, TZ + Math.cos((k * Math.PI) / 2) * 5.5, (k * Math.PI) / 2)
      const holes = [
        { x: -1.5, w: 1.5, y0: 36.5, top: 42.5, arch: true },
        { x: 1.5, w: 1.5, y0: 36.5, top: 42.5, arch: true },
        { x: 0, w: 1.1, y0: 28.5, top: 32.5, arch: true },
      ]
      place(stone, wallGeo(-4.7, 4.7, 18, 46, 0.8, holes, AT), F)
      WIN.push({ m: L(F, 0, 30.5, -0.35, 1.1, 4.0, 1) })
      for (const h of holes.slice(0, 2)) {
        archRing(F, h.x, 41.75, 0.75, { n: 9, rw: 0.36, alt: 0.15, out: 0.05, depth: 0.4, key: 0.08 })
        SILL.push({ m: L(F, h.x, 36.42, -0.1, 1.9, 0.16, 0.5) })
      }
      archRing(F, 0, 31.95, 0.55, { n: 7, rw: 0.3, alt: 0.15, out: 0.05, depth: 0.4, key: 0.06 })
      // a clock-less stone panel and a string course
      addBox(block, [3, 0.4], F, 9.4, 0.36, 0.4, 0, 35.6, 0.1)
    }
    addBox(dark, [1, 1], I4, 9.3, 28, 9.3, TX, 32, TZ)
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) addBox(stone, AT, I4, 1.8, 26.6, 1.8, TX + sx * 5.5, 18 + 13.3, TZ + sz * 5.5)
    addBox(block, [4, 1], I4, 13.4, 0.9, 13.4, TX, 46.45, TZ)
    // balustrade round the top of the shaft
    for (let k = 0; k < 4; k++) {
      const F = frame(TX + Math.sin((k * Math.PI) / 2) * 6.25, TZ + Math.cos((k * Math.PI) / 2) * 6.25, (k * Math.PI) / 2)
      for (let x = -5.9; x <= 5.9; x += 0.33) BALU.push({ m: L(F, x, 46.9, 0, 1, 1.1, 1) })
      addBox(block, [3, 0.4], F, 12.9, 0.18, 0.36, 0, 47.75, 0)
    }
    // the lantern: octagonal core with dark arched openings, eight columns
    const core = new THREE.CylinderGeometry(3.6, 3.7, 9.2, 8)
    core.rotateY(Math.PI / 8)
    core.translate(TX, 46.9 + 4.6, TZ)
    const cuv = core.attributes.uv
    for (let i = 0; i < cuv.count; i++) cuv.setXY(i, (cuv.getX(i) * 23) / AT[0], (cuv.getY(i) * 9.2) / AT[1])
    B.add(stone, core)
    const ap = 3.6 * Math.cos(Math.PI / 8) + 0.02
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4
      const F = frame(TX + Math.sin(a) * ap, TZ + Math.cos(a) * ap, a)
      const op = new THREE.PlaneGeometry(1.5, 5.4)
      op.translate(0, 51.6, 0)
      place(dark, op, F)
      const head = new THREE.CircleGeometry(0.75, 12, 0, Math.PI)
      head.translate(0, 54.3, 0)
      place(dark, head, F)
      const c = (k * Math.PI) / 4 + Math.PI / 8
      column(I4, TX + Math.sin(c) * 4.55, TZ + Math.cos(c) * 4.55, 46.9, 56.1, 0.3)
    }
    const ent = new THREE.CylinderGeometry(5.0, 5.0, 1.0, 8)
    ent.rotateY(Math.PI / 8)
    ent.translate(TX, 56.6, TZ)
    B.add(block, ent)
    // the copper crown: drum with clocks, ogee dome, little lantern, spire
    const prof = [
      [4.9, 0], [4.9, 2.6], [5.15, 2.8], [5.15, 3.1], [4.6, 3.3], [4.45, 4.2], [4.0, 5.5], [3.2, 6.8], [2.2, 7.9], [1.3, 8.7], [0.95, 9.3],
      [1.25, 9.6], [1.25, 10.8], [0.6, 11.2], [0.25, 12.3], [0.06, 12.9], [0.001, 12.95],
    ].map(([r, y]) => new THREE.Vector2(r, y))
    const crown = new THREE.LatheGeometry(prof, 8)
    crown.rotateY(Math.PI / 8)
    crown.translate(TX, 57.1, TZ)
    const kuv = crown.attributes.uv
    for (let i = 0; i < kuv.count; i++) kuv.setXY(i, kuv.getX(i) * 4, kuv.getY(i) * 3)
    B.add(copper, crown)
    const ball = new THREE.SphereGeometry(0.42, 16, 12)
    ball.translate(TX, 57.1 + 12.0, TZ)
    B.add(gold, ball)
    const fig = new THREE.LatheGeometry(
      [[0.001, 0], [0.32, 0], [0.24, 0.6], [0.2, 1.05], [0.12, 1.2], [0.001, 1.25]].map(([r, y]) => new THREE.Vector2(r, y)),
      10
    )
    fig.translate(TX, 57.1 + 12.95, TZ)
    B.add(gold, fig)
    const fh = new THREE.SphereGeometry(0.15, 10, 8)
    fh.translate(TX, 57.1 + 12.95 + 1.38, TZ)
    B.add(gold, fh)
    // four clock faces on the drum, with gilded hands
    const clockMat = new THREE.MeshStandardMaterial({ map: clockTexture(THREE), roughness: 0.5, metalness: 0.2 })
    const capo = 4.9 * Math.cos(Math.PI / 8) + 0.03
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2
      const F = frame(TX + Math.sin(a) * capo, TZ + Math.cos(a) * capo, a)
      const cm = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), clockMat)
      cm.applyMatrix4(L(F, 0, 58.5, 0))
      scene.add(cm)
      const h1 = new THREE.BoxGeometry(0.08, 0.7, 0.03)
      h1.translate(0, 0.32, 0)
      h1.rotateZ(-0.9)
      h1.translate(0, 58.5, 0.04)
      place(gold, h1, F)
      const h2 = new THREE.BoxGeometry(0.06, 0.95, 0.03)
      h2.translate(0, 0.45, 0)
      h2.rotateZ(2.6)
      h2.translate(0, 58.5, 0.05)
      place(gold, h2, F)
    }
  }

  /* ========================================================================= */
  /* streets: pavements, kerbs, roads, the tram on Coolsingel                  */
  /* ========================================================================= */
  {
    // the asphalt everywhere, with the light well cut out of it
    const gs = new THREE.Shape()
    gs.moveTo(-900, -900)
    gs.lineTo(900, -900)
    gs.lineTo(900, 900)
    gs.lineTo(-900, 900)
    gs.lineTo(-900, -900)
    const hole = new THREE.Path()
    hole.moveTo(WELL.x0, 0)
    hole.lineTo(WELL.x1, 0)
    hole.lineTo(WELL.x1, WELL.z1)
    hole.lineTo(WELL.x0, WELL.z1)
    hole.lineTo(WELL.x0, 0)
    gs.holes.push(hole)
    const gg = new THREE.ShapeGeometry(gs)
    gg.rotateX(Math.PI / 2)
    flipWinding(gg)
    gg.computeVertexNormals()
    // shape y became world z; UVs in 6 m tiles
    const p = gg.attributes.position
    const uv = gg.attributes.uv
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 6, p.getZ(i) / 6)
    gg.translate(0, -0.12, 0)
    const gm = new THREE.Mesh(gg, asphalt)
    gm.receiveShadow = true
    scene.add(gm)

    const pave = (mat, x0, x1, z0, z1, tile = 3) => {
      const g = boxGeo(x1 - x0, 0.12, z1 - z0, (x0 + x1) / 2, -0.06, (z0 + z1) / 2, [tile, tile])
      B.add(mat, g)
    }
    // Doelwater side: grey pavers by the gate, red brick pavers further east
    pave(greyPave, -62, -20, 0, 9.2, 2)
    pave(redPave, -20, WELL.x0 - 0.3, 0, 9.2)
    pave(redPave, WELL.x0 - 0.3, 62, WELL.z1 + 0.3, 9.2)
    pave(redPave, WELL.x1 + 0.3, 62, 0, WELL.z1 + 0.3)
    // Coolsingel pavement in front of the hall, and its far side
    pave(redPave, 53, 62, -110, 0)
    pave(redPave, 90.5, 100, -200, 120)
    // west and north streets
    pave(greyPave, -62, -53, -95, 0, 2)
    pave(greyPave, -62, 62, -95, -86, 2)
    // the south side of Doelwater
    pave(greyPave, -120, 62, 19, 35, 2)
    // the corner pavements across Coolsingel and south
    pave(redPave, 53, 62, 9.2, 120)
    // kerbs
    const kerb = (x0, x1, z0, z1) => B.add(blue, boxGeo(x1 - x0, 0.14, z1 - z0, (x0 + x1) / 2, -0.05, (z0 + z1) / 2, BT))
    kerb(-120, 53, 9.1, 9.3)
    kerb(-120, 53, 18.9, 19.1)
    kerb(61.9, 62.1, -200, 9.2)
    kerb(61.9, 62.1, 19, 120)
    kerb(90.4, 90.6, -200, 120)
    kerb(-62.1, -61.9, -95, 9.2)
    // cycle paths on Coolsingel and the tram track bed
    const strip = (mat, x0, x1, z0, z1, y = -0.115) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0)
      g.rotateX(-Math.PI / 2)
      const uv = g.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / 6, (uv.getY(i) * (z1 - z0)) / 6)
      g.translate((x0 + x1) / 2, y, (z0 + z1) / 2)
      B.add(mat, g)
    }
    strip(bikeLane, 62.1, 64.6, -300, 300)
    strip(bikeLane, 88, 90.4, -300, 300)
    strip(setts, 71.5, 81, -300, 300, -0.113)
    // rails
    const rails = beamBatch(THREE)
    for (const cx of [74.0, 78.5]) for (const s of [-0.72, 0.72]) rails.add(V(cx + s, -0.1, -300), V(cx + s, -0.1, 300), 0.07, 0.03)
    const railMesh = rails.build(galv, { castShadow: false })
    scene.add(railMesh)
    // lane markings
    const marks = []
    for (let x = -115; x < 50; x += 6) marks.push({ m: L(I4, x, -0.11, 14.1, 3, 0.01, 0.12) })
    for (let z = -295; z < 300; z += 6) {
      marks.push({ m: L(I4, 68, -0.11, z, 0.12, 0.01, 3) })
      marks.push({ m: L(I4, 84.5, -0.11, z, 0.12, 0.01, 3) })
    }
    for (let x = 64.8; x < 71.3; x += 0.9) marks.push({ m: L(I4, x, -0.11, 13.5, 0.5, 0.01, 4.5) }) // zebra
    instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.7 }), marks, { cast: false })
  }

  /* --- the "no entry" and warning signs by the gate ------------------------- */
  {
    const px = -36 + 2.4 + 1.05
    const pz = 0.42
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.5, 10).translate(0, 1.75, 0), galv)
    pole.position.set(px, 0, pz)
    pole.castShadow = true
    scene.add(pole)
    const back = new THREE.MeshStandardMaterial({ color: 0x8c8f92, metalness: 0.7, roughness: 0.45 })
    const ne = new THREE.Mesh(new THREE.CircleGeometry(0.33, 32), signMaterial(THREE, 'noentry'))
    ne.position.set(px, 2.55, pz + 0.05)
    const ne2 = new THREE.Mesh(new THREE.CircleGeometry(0.33, 32), back)
    ne2.position.set(px, 2.55, pz + 0.04)
    ne2.rotation.y = Math.PI
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.7), signMaterial(THREE, 'warning'))
    tr.position.set(px, 3.2, pz + 0.05)
    for (const m of [ne, ne2, tr]) {
      m.castShadow = true
      scene.add(m)
    }
  }

  /* --- lamps, bollards, bins, bikes, parked cars ---------------------------- */
  {
    const lamps = [-52, -20, -8, 6, 54].map((x) => ({ x, z: 8.7, r: Math.PI }))
    for (let z = -100; z <= 0; z += 24) lamps.push({ x: 61.4, z, r: -Math.PI / 2 })
    for (let z = -110; z <= 100; z += 30) lamps.push({ x: 76.25, z, r: 0, dbl: true })
    const poles = []
    const heads = []
    for (const l of lamps) {
      poles.push({ m: L(I4, l.x, 3.4, l.z, 1, 1, 1) })
      for (const dx of l.dbl ? [-1.1, 1.1] : [0]) heads.push({ m: L(I4, l.x + dx, 6.75, l.z, 1, 1, 1) })
    }
    instanced(new THREE.CylinderGeometry(0.06, 0.1, 6.8, 8), new THREE.MeshStandardMaterial({ color: 0x2b2e30, metalness: 0.6, roughness: 0.45 }), poles)
    instanced(
      new THREE.CylinderGeometry(0.28, 0.2, 0.42, 8),
      new THREE.MeshStandardMaterial({ color: 0x2b2e30, metalness: 0.5, roughness: 0.4, emissive: 0xfff0d8, emissiveIntensity: 0.06 }),
      heads
    )
    const bol = []
    for (let x = -60; x < 52; x += 2.6) if (x < -42 || x > -30) bol.push({ m: L(I4, x, 0.45, 8.85, 1, 1, 1) })
    for (let z = -100; z < 8; z += 2.6) bol.push({ m: L(I4, 61.6, 0.45, z, 1, 1, 1) })
    instanced(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0x2e3133, metalness: 0.4, roughness: 0.5 }), low ? bol.filter((_, i) => i % 2 === 0) : bol)
    // bikes: in a rack across the street and leaning by the Coolsingel corner
    const bikes = []
    for (let i = 0; i < (low ? 6 : 12); i++) bikes.push({ x: -16 + i * 0.75, z: 22.0, r: Math.PI / 2 + range(rand, -0.08, 0.08) })
    for (let i = 0; i < (low ? 3 : 6); i++) bikes.push({ x: 59.8, z: 4.5 + i * 0.8, r: range(rand, -0.1, 0.1) })
    for (let i = 0; i < (low ? 2 : 4); i++) bikes.push({ x: -58 + i * 0.8, z: 7.6, r: Math.PI / 2 })
    addBikes(THREE, scene, bikes, rand)
    addCars(
      THREE,
      scene,
      [
        { x: -48, z: 11.2, r: 0 },
        { x: -6, z: 11.2, r: 0 },
        { x: 20, z: 16.8, r: Math.PI },
        { x: 67, z: -32, r: Math.PI / 2 },
        { x: 86, z: 22, r: -Math.PI / 2 },
      ],
      rand
    )
  }

  /* --- the surroundings: buildings across the streets, trees, the skyline -- */
  {
    const fBrick = M.facade(THREE, { wall: 'brick', color: '#7c4330', mortar: '#a39686', frame: '#e8e2d6', bay: 3.4, storey: 3.3, quality: q, seed: 41 })
    const fStone = M.facade(THREE, { wall: 'stone', color: '#cdb995', frame: '#2b2b2b', bay: 3.2, storey: 3.4, window: { w: 0.55, h: 0.6, bars: 'grid', sill: true }, quality: q, seed: 42 })
    const fPlaster = M.facade(THREE, { wall: 'plaster', color: '#d9cdb6', frame: '#3a3a36', bay: 3.0, storey: 3.2, window: { w: 0.62, h: 0.58, bars: null, sill: true }, quality: q, seed: 43 })
    const fGlass = M.facade(THREE, { wall: 'curtain', color: '#4a5866', frame: '#9aa3ab', glass: '#28394a', bay: 3, storey: 3.6, quality: q, seed: 44 })
    const shop = M.shopfront(THREE, { color: '#2c2824', frame: '#1d1d1d', fascia: '#262422', awning: null, bay: 3.4, storey: 4.2, quality: q, seed: 45 })
    const shopRed = M.shopfront(THREE, { color: '#2c2824', frame: '#1d1d1d', fascia: '#5a2a22', awning: '#8a2f24', bay: 3.4, storey: 4.2, quality: q, seed: 46 })
    const trim = new THREE.MeshStandardMaterial({ color: 0xd6ccb8, roughness: 0.8 })
    const facs = [fBrick, fStone, fPlaster, fBrick, fGlass]
    const town = (x, z, w, d, storeys, fac, sh, ry) => {
      const { group } = M.townhouse(THREE, { w, d, storeys, facade: fac, shop: sh, roof: 'flat', trim })
      group.position.set(x, 0, z)
      group.rotation.y = ry
      group.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true
      })
      scene.add(group)
    }
    // south side of Doelwater, facing the hall
    let x = -112
    let k = 0
    while (x < 60) {
      const w = range(rand, 14, 26)
      const d = 16
      town(x + w / 2, 35 + d / 2, w, d, Math.round(range(rand, 3, 5)), facs[k % 4], k % 3 === 1 ? shopRed : shop, Math.PI)
      x += w + 0.4
      k++
    }
    // across Coolsingel
    let z = 60
    k = 0
    while (z > -200) {
      const w = range(rand, 18, 34)
      const d = 20
      town(100 + d / 2, z - w / 2, w, d, Math.round(range(rand, 6, 9)), facs[(k + 1) % 5], k % 2 ? shop : shopRed, -Math.PI / 2)
      z -= w + 0.5
      k++
    }
    // west and north
    for (let zz = -110; zz < 20; zz += 26) town(-78 - 8, zz + 12, 24, 16, 6, facs[(zz / 26) & 3 ? 0 : 2], shop, Math.PI / 2)
    for (let xx = -100; xx < 60; xx += 28) town(xx + 13, -110 - 8, 26, 16, 7, facs[1], shop, 0)
    // the World Trade Center tower across Coolsingel, and other high-rises far off
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    const uvs = unit.attributes.uv.array
    for (let i = 0; i < uvs.length; i++) uvs[i] *= 4
    const towers = [
      { x: 132, z: -70, w: 26, h: 93, d: 22 },
      { x: -230, z: -330, w: 30, h: 150, d: 26 },
      { x: -170, z: -380, w: 24, h: 110, d: 24 },
      { x: 260, z: 340, w: 26, h: 140, d: 24 },
      { x: 320, z: 260, w: 22, h: 120, d: 22 },
      { x: 120, z: 420, w: 30, h: 160, d: 30 },
      { x: -320, z: 60, w: 26, h: 96, d: 22 },
      { x: 360, z: -200, w: 24, h: 104, d: 24 },
    ]
    instanced(unit, fGlass.material, towers.map((t) => ({ m: L(I4, t.x, 0, t.z, t.w, t.h, t.d) })), { cast: false })
    const blocks = [[], []]
    for (let i = 0; i < (low ? 120 : 240); i++) {
      const bx = range(rand, -650, 650)
      const bz = range(rand, -650, 650)
      if (bx > -150 && bx < 170 && bz > -170 && bz < 70) continue
      blocks[i % 2].push({ m: L(I4, bx, 0, bz, range(rand, 20, 44), range(rand, 12, 32), range(rand, 14, 24), 0, Math.floor(rand() * 2) * (Math.PI / 2), 0) })
    }
    instanced(unit.clone(), fBrick.material, blocks[0], { cast: false })
    instanced(unit.clone(), fPlaster.material, blocks[1], { cast: false })
    // trees: limes along Doelwater's far pavement, planes along Coolsingel
    const limes = []
    for (let tx = -110; tx < 58; tx += 9.5) limes.push({ x: tx + range(rand, -0.6, 0.6), z: 28, h: range(rand, 9, 12) })
    addForest(THREE, scene, low ? limes.filter((_, i) => i % 2 === 0) : limes, { species: 'lime', season: 'summer', seed: 7, quality: q })
    const planes = []
    for (let tz = -190; tz < 110; tz += 12) {
      planes.push({ x: 66.5, z: tz + range(rand, -1, 1), h: range(rand, 14, 19) })
      planes.push({ x: 93.5, z: tz + 6 + range(rand, -1, 1), h: range(rand, 14, 19) })
    }
    addForest(THREE, scene, low ? planes.filter((_, i) => i % 2 === 0) : planes, { species: 'plane', season: 'summer', seed: 9, quality: q })
  }

  /* --- instanced collections ------------------------------------------------ */
  instanced(new THREE.PlaneGeometry(1, 1), winMat, WIN, { cast: false })
  instanced(new THREE.PlaneGeometry(1, 1), doorGreen, DOORS.green, { cast: false })
  instanced(new THREE.PlaneGeometry(1, 1), doorOrange, DOORS.orange, { cast: false })
  instanced(new THREE.PlaneGeometry(1, 1), doorDark, DOORS.dark, { cast: false })
  instanced(new THREE.BoxGeometry(1, 1, 1), block, VOUS)
  instanced(new THREE.BoxGeometry(1, 1, 1), blue, SILL)
  instanced(new THREE.BoxGeometry(1, 1, 1), planter, BOXES)
  instanced(new THREE.IcosahedronGeometry(0.06, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), FLOWERS)
  const baluster = new THREE.LatheGeometry(
    [[0.001, 0], [0.075, 0], [0.075, 0.06], [0.05, 0.1], [0.09, 0.3], [0.05, 0.56], [0.075, 0.63], [0.075, 0.72], [0.001, 0.72]].map(([r, y]) => new THREE.Vector2(r, y)),
    8
  )
  instanced(baluster, block, BALU)
  instanced(new THREE.ConeGeometry(0.028, 0.13, 6), iron, FIN)
  scene.add(fence.build(iron))

  B.flush()

  /* --- trams on Coolsingel -------------------------------------------------- */
  const trams = [makeTram(THREE), makeTram(THREE)]
  trams[0].position.set(74.0, 0, 0)
  trams[1].position.set(78.5, 0, 0)
  trams[1].rotation.y = Math.PI
  for (const t of trams) scene.add(t)

  /* --- light, the flight in, the viewpoints --------------------------------- */
  world.focusShadows(V(6, 0, -6), 64)

  const spots = [
    // 0 · photo 1: the iron gate between its rusticated piers, the no-entry sign
    { pos: V(-29.8, 1.7, 12.2), look: V(-31.6, 4.4, -0.5) },
    // 1 · photo 2: the green glazed door in its stepped arch
    { pos: V(-21.3, 1.65, 5.6), look: V(-23.4, 3.0, -1.4) },
    // 2 · photo 3: low under the Burgerlijke Stand portal, railings and steps
    { pos: V(-10.2, 1.25, 6.9), look: V(-12.3, 4.7, -1.6) },
    // 3 · photo 4: the deep niche with its window, rusticated voussoirs
    { pos: V(1.6, 1.65, 9.6), look: V(0.9, 4.6, -1.0) },
    // 4 · photo 5: the colonnaded loggia up its five steps
    { pos: V(33.2, 1.7, 6.6), look: V(21.0, 3.8, -2.6) },
    // 5 · photo 6: inside the loggia, the blind arch with its window
    { pos: V(25.6, 2.55, -1.25), look: V(24.3, 3.9, -7.2) },
    // 6 · photo 7: along the railing and the light well, flower boxes above
    { pos: V(45.8, 1.65, 9.4), look: V(40.2, 3.4, 0.5) },
  ]
  const end = spots[0]
  const path = {
    positions: [V(190, 135, 175), V(125, 80, 115), V(50, 34, 60), V(-14, 8, 24), end.pos.clone()],
    targets: [V(31, 45, -43), V(22, 32, -30), V(-6, 14, -6), V(-32, 5.5, 0), end.look.clone()],
    fov: 50,
    near: 0.3,
    spots,
  }

  const groundAt = (x, z) => {
    if (x > LOGGIA.x0 && x < LOGGIA.x1 && z > LOGGIA.zb && z < 0) return LOGGIA.floor
    return 0
  }

  return {
    scene,
    world,
    path,
    groundAt,
    clearance: 1.2,
    update(t) {
      const span = 640
      trams[0].position.z = ((t * 7.5) % span) - span / 2
      trams[1].position.z = span / 2 - ((t * 6.5 + 260) % span)
    },
  }

  function instanced(geo, mat, items, { cast = true } = {}) {
    if (!items.length) return null
    const mesh = new THREE.InstancedMesh(geo, mat, items.length)
    const colored = !!items[0].c
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m)
      if (colored) mesh.setColorAt(i, it.c || new THREE.Color(1, 1, 1))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.castShadow = cast
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    scene.add(mesh)
    return mesh
  }
}

/* --- small pieces outside the builder ----------------------------------------- */

function pickHue(rand) {
  const hues = [0.0, 0.02, 0.05, 0.08, 0.95, 0.9, 0.13]
  return hues[Math.floor(rand() * hues.length)]
}

/** Reverse every triangle of a non-indexed or indexed geometry. */
function flipWinding(geo) {
  if (geo.index) {
    const a = geo.index.array
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1]
      a[i + 1] = a[i + 2]
      a[i + 2] = t
    }
    geo.index.needsUpdate = true
    return geo
  }
  for (const key of Object.keys(geo.attributes)) {
    const at = geo.attributes[key]
    const s = at.itemSize
    const arr = at.array
    for (let i = 0; i < at.count; i += 3) {
      for (let c = 0; c < s; c++) {
        const t = arr[(i + 1) * s + c]
        arr[(i + 1) * s + c] = arr[(i + 2) * s + c]
        arr[(i + 2) * s + c] = t
      }
    }
    at.needsUpdate = true
  }
  return geo
}

/** The dark green enamel plaque over the Burgerlijke Stand doors, gold letters. */
function plaqueTexture(THREE) {
  return paintTexture(THREE, 512, 192, (g, w, h) => {
    g.fillStyle = '#1d2f27'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#c9a24c'
    g.lineWidth = 5
    g.strokeRect(8, 8, w - 16, h - 16)
    g.fillStyle = '#d8b25a'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = 'bold 34px Georgia, serif'
    g.fillText('AFDEELINGEN', w / 2, 40)
    g.font = 'bold 22px Georgia, serif'
    g.fillText('BURGERLIJKE STAND  BEVOLKING  ONDERWIJS', w / 2, 84)
    g.fillText('MILITAIRE ZAKEN  REGELING BELASTINGEN', w / 2, 116)
    g.fillText('PENSIOENBUREAU', w / 2, 148)
  })
}

/** Road signs: 'noentry' (red disc, white bar), 'warning' (red triangle), 'nobike'. */
function signMaterial(THREE, kind) {
  const tex = paintTexture(THREE, 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h)
    if (kind === 'warning') {
      g.fillStyle = '#d0281f'
      g.beginPath()
      g.moveTo(w / 2, 14)
      g.lineTo(w - 10, h - 34)
      g.lineTo(10, h - 34)
      g.closePath()
      g.fill()
      g.fillStyle = '#f4f2ee'
      g.beginPath()
      g.moveTo(w / 2, 58)
      g.lineTo(w - 50, h - 56)
      g.lineTo(50, h - 56)
      g.closePath()
      g.fill()
      g.fillStyle = '#222'
      g.fillRect(w / 2 - 34, h - 110, 68, 26)
      g.fillRect(w / 2 - 24, h - 128, 44, 20)
      g.beginPath()
      g.arc(w / 2 - 20, h - 82, 8, 0, Math.PI * 2)
      g.arc(w / 2 + 20, h - 82, 8, 0, Math.PI * 2)
      g.fill()
      return
    }
    g.fillStyle = '#d0281f'
    g.beginPath()
    g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2)
    g.fill()
    if (kind === 'noentry') {
      g.fillStyle = '#f6f4f0'
      g.fillRect(w * 0.16, h * 0.42, w * 0.68, h * 0.16)
    } else {
      g.fillStyle = '#f6f4f0'
      g.beginPath()
      g.arc(w / 2, h / 2, w / 2 - 26, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#111'
      g.lineWidth = 8
      g.beginPath()
      g.arc(w / 2 - 40, h / 2 + 20, 24, 0, Math.PI * 2)
      g.arc(w / 2 + 40, h / 2 + 20, 24, 0, Math.PI * 2)
      g.stroke()
      g.beginPath()
      g.moveTo(w / 2 - 40, h / 2 + 20)
      g.lineTo(w / 2 - 10, h / 2 - 20)
      g.lineTo(w / 2 + 40, h / 2 + 20)
      g.stroke()
    }
  })
  return new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.45, side: THREE.FrontSide })
}

function clockTexture(THREE) {
  return paintTexture(THREE, 256, 256, (g, w) => {
    const c = w / 2
    g.fillStyle = '#e9e1cc'
    g.beginPath()
    g.arc(c, c, c, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = '#c9a24c'
    g.lineWidth = 12
    g.beginPath()
    g.arc(c, c, c - 8, 0, Math.PI * 2)
    g.stroke()
    g.fillStyle = '#1e1e1e'
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      g.save()
      g.translate(c + Math.sin(a) * (c - 34), c - Math.cos(a) * (c - 34))
      g.rotate(a)
      g.fillRect(-4, -14, 8, 28)
      g.restore()
    }
  })
}

/** A RET tram (Citadis): five sections, grey and white with a red skirt, dark window band. */
function makeTram(THREE) {
  const tex = paintTexture(THREE, 512, 128, (g, w, h) => {
    g.fillStyle = '#e8e9ea'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#9da3a8'
    g.fillRect(0, h * 0.72, w, h * 0.28)
    g.fillStyle = '#c4241c'
    g.fillRect(0, h * 0.86, w, h * 0.14)
    g.fillStyle = '#1d2329'
    for (let x = 6; x < w - 20; x += 64) g.fillRect(x, h * 0.18, 56, h * 0.42)
  })
  const body = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.3 })
  const roof = new THREE.MeshStandardMaterial({ color: 0x7c8186, roughness: 0.5, metalness: 0.5 })
  const g = new THREE.Group()
  const lens = [7.2, 5.5, 6.8, 5.5, 7.2]
  let z = -16
  for (const l of lens) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.9, l - 0.12), body)
    m.position.set(0, 0.35 + 1.45, z + l / 2)
    g.add(m)
    const r = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, l * 0.6), roof)
    r.position.set(0, 3.42, z + l / 2)
    g.add(r)
    z += l
  }
  return g
}

function addBikes(THREE, scene, list, rand) {
  if (!list.length) return
  const parts = []
  const beam = (a, b, t) => {
    const dir = new THREE.Vector3().subVectors(b, a)
    const len = dir.length()
    const geo = new THREE.BoxGeometry(t, t, len)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize())
    geo.applyQuaternion(q)
    geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
    parts.push(geo.toNonIndexed())
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  for (const x of [-0.53, 0.53]) {
    const w = new THREE.TorusGeometry(0.34, 0.025, 6, 20)
    w.translate(x, 0.34, 0)
    parts.push(w.toNonIndexed())
  }
  // a Dutch city bike: low step-through frame, upright bars, rack, mudguards
  beam(V(-0.53, 0.34, 0), V(-0.12, 0.38, 0), 0.035)
  beam(V(-0.12, 0.38, 0), V(0.38, 0.72, 0), 0.04)
  beam(V(-0.12, 0.38, 0), V(-0.25, 0.85, 0), 0.04)
  beam(V(-0.25, 0.85, 0), V(-0.53, 0.34, 0), 0.03)
  beam(V(0.38, 0.72, 0), V(0.53, 0.34, 0), 0.035)
  beam(V(0.38, 0.72, 0), V(0.32, 1.05, 0), 0.035)
  beam(V(0.32, 1.05, -0.28), V(0.32, 1.05, 0.28), 0.03)
  beam(V(-0.25, 0.85, 0), V(-0.27, 0.95, 0), 0.03)
  beam(V(-0.36, 0.97, 0), V(-0.16, 0.97, 0), 0.07)
  beam(V(-0.8, 0.7, 0), V(-0.3, 0.7, 0), 0.08)
  const geo = mergeGeometries(parts, false)
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.5 })
  const mesh = new THREE.InstancedMesh(geo, mat, list.length)
  const cols = [0x1c1c1e, 0x23324a, 0x2f3b2c, 0x6a1d1a, 0x1c1c1e, 0xbcb7ad]
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  list.forEach((b, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.r)
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), range(rand, -0.06, 0.06)))
    m.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(1, 1, 1))
    mesh.setMatrixAt(i, m)
    mesh.setColorAt(i, new THREE.Color(cols[Math.floor(rand() * cols.length)]))
  })
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
}

function addCars(THREE, scene, list, rand) {
  if (!list.length) return
  const body = new RoundedBoxGeometry(4.4, 0.78, 1.8, 2, 0.22).translate(0, 0.62, 0)
  const cabin = new RoundedBoxGeometry(2.4, 0.62, 1.62, 2, 0.16).translate(-0.2, 1.3, 0)
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateX(Math.PI / 2)
  const wheels = mergeGeometries(
    [
      [1.4, 0.82],
      [1.4, -0.82],
      [-1.35, 0.82],
      [-1.35, -0.82],
    ].map(([x, z]) => wheel.clone().translate(x, 0.33, z)),
    false
  )
  const paint = new THREE.MeshPhysicalMaterial({ roughness: 0.35, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.08 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2128, roughness: 0.05, metalness: 0.9 })
  const tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 })
  const cols = [0xf2f2f0, 0x1b2a44, 0x7a1f1b, 0x2d2f33, 0x9aa0a6]
  const meshes = [new THREE.InstancedMesh(body, paint, list.length), new THREE.InstancedMesh(cabin, glass, list.length), new THREE.InstancedMesh(wheels, tyre, list.length)]
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  list.forEach((c, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.r)
    m.compose(new THREE.Vector3(c.x, -0.12, c.z), q, new THREE.Vector3(1, 1, 1))
    for (const me of meshes) me.setMatrixAt(i, m)
    meshes[0].setColorAt(i, new THREE.Color(cols[Math.floor(rand() * cols.length)]))
  })
  for (const me of meshes) {
    me.castShadow = me.receiveShadow = true
    scene.add(me)
  }
}
