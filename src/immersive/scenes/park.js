/**
 * An Amsterdam park in autumn at the end of the day — Vondelpark / Amstelpark.
 *
 * A wide, deep-green lawn (an ellipse ~116 × 80 m) ringed by a winding
 * asphalt path, and beyond it a belt of big trees in autumn colour — oaks,
 * limes, planes, birches, poplars — with dark shrubbery at their feet and,
 * on the sunset side, bare trees whose fine twigs stand against the sky. A
 * weeping willow, nearly bare, hangs its strands over the middle of the lawn
 * (where the shoot happened), a pond with reeds and a few mallards lies
 * toward the sun, benches and lit park lanterns line the path, leaves drift
 * across the grass, and a row of Amsterdam townhouses shows through the
 * trees to the east, their top floors catching the last sun.
 *
 * The sun is low in the west-south-west (behind the trees): warm rim light,
 * long cool shadows over the lawn, a clear blue sky.
 *
 * Metres. Lawn centred on the origin, x east, sun toward −x.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createWorld, waterMaterial, NOISE_GLSL } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { seeded, range, pick, glowTexture, noiseNormalMap } from '../utils.js'

const NO_INK = 2 // post.js NO_INK_LAYER: alpha cards stay out of the AO pass

const LA = 58 // lawn ellipse, half-length along x
const LB = 40 // half-width along z
const PATH_E = 1.1 // the path follows the lawn's ellipse scaled by this
const PATH_W = 3.6
// the pond lies south-east of the willow, out of every photograph's view
const POND = { x: 8, z: -30, rx: 13, rz: 6.5 }
const WILLOW = { x: -20, z: 0 }
const HOUSE_X = 104 // the townhouses' front line (they face −x, toward the park)

const eOf = (x, z) => Math.hypot(x / LA, z / LB)
const inPond = (x, z, m = 0) => ((x - POND.x) / (POND.rx + m)) ** 2 + ((z - POND.z) / (POND.rz + m)) ** 2 < 1

/* --- small helpers --------------------------------------------------------- */

/** A canvas texture for an alpha-cut card (clamped, sRGB). */
function cardTex(THREE, w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  g.clearRect(0, 0, w, h)
  draw(g, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

let cacheId = 0
/**
 * Alpha-tested cards lose their fine detail in the mip chain (the alpha
 * averages below the cut-off and twigs vanish at a distance); boost alpha
 * with the mip level so thin things keep their thickness.
 */
function keepThin(mat, size = 256, extra = null) {
  const key = 'park-thin-' + cacheId++
  mat.onBeforeCompile = (sh) => {
    extra?.(sh)
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <alphatest_fragment>',
      `{
        vec2 dd = fwidth(vMapUv) * ${size.toFixed(1)};
        float mip = max(0.0, log2(max(max(dd.x, dd.y), 1e-4)));
        diffuseColor.a *= 1.0 + mip * 0.32;
      }
      #include <alphatest_fragment>`
    )
  }
  mat.customProgramCacheKey = () => key
  return mat
}

function cardMaterial(THREE, map, { size = 256, cut = 0.42, rough = 0.85, color = 0xffffff, emissive = null, extra = null } = {}) {
  const mat = new THREE.MeshStandardMaterial({ map, color, alphaTest: cut, side: THREE.DoubleSide, roughness: rough, metalness: 0 })
  if (emissive) mat.emissive = new THREE.Color(emissive)
  keepThin(mat, size, extra)
  return mat
}

function cardDepth(THREE, map, cut = 0.42) {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: cut })
}

/** Set every normal of a geometry to one direction (cards that shade like the ground). */
function flatNormals(geo, x, y, z) {
  const n = geo.attributes.normal
  for (let i = 0; i < n.count; i++) n.setXYZ(i, x, y, z)
  return geo
}

/** Normals pointing out from a centre (soft, rounded crowns from flat cards). */
function radialNormals(geo, cx, cy, cz, lift = 0.3) {
  const p = geo.attributes.position
  const n = geo.attributes.normal
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) - cx
    let y = p.getY(i) - cy
    let z = p.getZ(i) - cz
    const l = Math.hypot(x, y, z) || 1
    x /= l
    y /= l
    z /= l
    y = y * (1 - lift) + lift
    const l2 = Math.hypot(x, y, z) || 1
    n.setXYZ(i, x / l2, y / l2, z / l2)
  }
  return geo
}

/** Paint a flat vertex colour on a geometry. */
function vcolor(THREE, geo, hex) {
  const c = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r
    a[i * 3 + 1] = c.g
    a[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return geo
}

/** A tapered cylinder from a to b. */
function cylBetween(THREE, a, b, r0, r1, seg = 8) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length() || 0.001
  const geo = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true)
  geo.translate(0, len / 2, 0)
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()))
  geo.translate(a.x, a.y, a.z)
  return geo
}

/** A box beam from a to b (bench frames, lamp brackets). */
function beamGeo(THREE, a, b, t, d = t) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length() || 0.001
  const geo = new THREE.BoxGeometry(t, d, len)
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize()))
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  geo.translate(mid.x, mid.y, mid.z)
  return geo
}

function boxAt(THREE, w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z)
}

/** Merge a group's meshes per material into a few big meshes (draw calls). */
function mergeByMaterial(THREE, root, scene) {
  root.updateMatrixWorld(true)
  const lists = new Map()
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld)
    if (g.index) g = g.toNonIndexed()
    g.clearGroups()
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k)
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    if (!lists.has(o.material)) lists.set(o.material, [])
    lists.get(o.material).push(g)
  })
  lists.forEach((geos, mat) => {
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat)
    mesh.castShadow = mesh.receiveShadow = true
    scene.add(mesh)
  })
}

/* --- painted textures ------------------------------------------------------ */

/** Fine bare twigs fanning up from the bottom centre, a few late leaves. */
function twigTexture(THREE, seed, leafy = 0.12) {
  const S = 256
  return cardTex(THREE, S, S, (g) => {
    const rand = seeded(seed)
    g.lineCap = 'round'
    const leaves = []
    function br(x, y, a, len, w, d) {
      const x2 = x + Math.sin(a) * len
      const y2 = y - Math.cos(a) * len
      const mx = (x + x2) / 2 + range(rand, -len * 0.15, len * 0.15)
      const my = (y + y2) / 2
      g.strokeStyle = d < 2 ? '#352a24' : d < 4 ? '#43362d' : '#4d4036'
      g.lineWidth = Math.max(1.4, w)
      g.beginPath()
      g.moveTo(x, y)
      g.quadraticCurveTo(mx, my, x2, y2)
      g.stroke()
      if (d >= 5 || len < 6) {
        if (rand() < leafy) leaves.push([x2, y2])
        return
      }
      const n = d < 1 ? 3 : 2 + (rand() < 0.15 ? 1 : 0)
      for (let k = 0; k < n; k++) br(x2, y2, a + range(rand, -0.8, 0.8), len * range(rand, 0.6, 0.8), w * 0.66, d + 1)
    }
    br(S / 2, S, range(rand, -0.1, 0.1), S * 0.24, 5, 0)
    br(S / 2 + 8, S, 0.45, S * 0.2, 3.4, 1)
    br(S / 2 - 8, S, -0.5, S * 0.2, 3.4, 1)
    const cols = ['#c0782c', '#a4521f', '#d19a3a', '#8e4a22', '#b8862e']
    for (const [x, y] of leaves) {
      g.save()
      g.translate(x, y)
      g.rotate(rand() * Math.PI * 2)
      g.fillStyle = pick(rand, cols)
      g.beginPath()
      g.ellipse(0, 0, 3, 5.5, 0, 0, Math.PI * 2)
      g.fill()
      g.restore()
    }
  })
}

/** Willow strands: thin hanging twigs with a few small golden leaves. */
function curtainTexture(THREE, seed) {
  const W = 128
  const H = 512
  return cardTex(THREE, W, H, (g) => {
    const rand = seeded(seed)
    const cols = ['#c9a23c', '#b8952f', '#dab653', '#9f8b35', '#a9a646', '#c58a2e']
    for (let i = 0; i < 12; i++) {
      let x = range(rand, 6, W - 6)
      const len = H * range(rand, 0.5, 1)
      const drift = range(rand, -0.25, 0.25)
      const pts = []
      for (let y = 0; y <= len; y += 6) {
        pts.push([x, y])
        x += drift + range(rand, -0.7, 0.7)
      }
      g.strokeStyle = 'rgba(78,62,44,0.95)'
      g.lineWidth = i < 4 ? 2 : 1.5
      g.beginPath()
      pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py)))
      g.stroke()
      for (let k = 2; k < pts.length; k += 1 + Math.floor(rand() * 2)) {
        if (rand() > 0.5) continue
        const [px, py] = pts[k]
        g.save()
        g.translate(px + range(rand, -2, 2), py)
        g.rotate(range(rand, -0.5, 0.5) + (rand() < 0.5 ? 0.35 : -0.35))
        g.fillStyle = pick(rand, cols)
        g.beginPath()
        g.ellipse(0, 4, 1.8, 6, 0, 0, Math.PI * 2)
        g.fill()
        g.restore()
      }
    }
  })
}

/** A dense cluster of small leaves (shrubs, willow crown). */
function clusterTexture(THREE, cols, seed, { n = 420, size = [6, 12] } = {}) {
  const S = 256
  return cardTex(THREE, S, S, (g) => {
    const rand = seeded(seed)
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2
      const r = Math.pow(rand(), 0.7) * S * 0.46
      const x = S / 2 + Math.cos(a) * r
      const y = S / 2 + Math.sin(a) * r
      const s = range(rand, size[0], size[1])
      g.save()
      g.translate(x, y)
      g.rotate(rand() * Math.PI * 2)
      g.fillStyle = pick(rand, cols)
      g.beginPath()
      g.ellipse(0, 0, s * 0.45, s, 0, 0, Math.PI * 2)
      g.fill()
      const v = rand()
      g.fillStyle = v < 0.5 ? `rgba(0,0,0,${(0.5 - v) * 0.6})` : `rgba(255,240,200,${(v - 0.5) * 0.35})`
      g.fill()
      g.restore()
    }
  })
}

/** One fallen leaf, pale grey (tinted per instance). */
function leafTexture(THREE) {
  return cardTex(THREE, 64, 64, (g) => {
    g.translate(32, 33)
    g.beginPath()
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2
      const serr = 1 + (i % 2 ? 0.05 : -0.03)
      const rx = 17 * (1 - 0.18 * Math.sin(a))
      const ry = 25
      const x = Math.cos(a) * rx * serr
      const y = Math.sin(a) * ry * serr * (Math.sin(a) < 0 ? 1.05 : 0.9)
      i ? g.lineTo(x, y) : g.moveTo(x, y)
    }
    g.closePath()
    g.fillStyle = 'rgb(232,232,232)'
    g.fill()
    g.strokeStyle = 'rgba(120,120,120,0.6)'
    g.lineWidth = 1.2
    g.stroke()
    g.strokeStyle = 'rgba(150,150,150,0.9)'
    g.lineWidth = 1.4
    g.beginPath()
    g.moveTo(0, 30)
    g.lineTo(0, -22)
    for (let k = 0; k < 4; k++) {
      const y = 14 - k * 9
      g.moveTo(0, y)
      g.lineTo(-11 + k, y - 7)
      g.moveTo(0, y)
      g.lineTo(11 - k, y - 7)
    }
    g.stroke()
  })
}

/** Reeds and bulrushes, golden in autumn. */
function reedTexture(THREE) {
  return cardTex(THREE, 128, 256, (g) => {
    const rand = seeded(91)
    const cols = ['#b39a5a', '#9c8448', '#c4ab6a', '#7f6a3c', '#8d8a4a']
    for (let i = 0; i < 30; i++) {
      const x0 = 64 + (rand() - 0.5) * (rand() * 110)
      const h = range(rand, 60, 250)
      const lean = range(rand, -26, 26)
      g.strokeStyle = pick(rand, cols)
      g.lineWidth = range(rand, 1.2, 2.4)
      g.beginPath()
      g.moveTo(x0, 256)
      g.quadraticCurveTo(x0 + lean * 0.2, 256 - h * 0.6, x0 + lean, 256 - h)
      g.stroke()
      if (rand() < 0.18) {
        g.fillStyle = '#4a3122'
        g.beginPath()
        g.ellipse(x0 + lean * 0.85, 256 - h * 0.86, 3.2, 12, lean * 0.01, 0, Math.PI * 2)
        g.fill()
      }
    }
  })
}

/** A distant tree line: crowns in autumn colour, bare tops, a dark understorey. */
function treeWallTexture(THREE, seed) {
  const W = 512
  const H = 256
  return cardTex(THREE, W, H, (g) => {
    const rand = seeded(seed)
    const palettes = [
      ['#a35a26', '#c07a30', '#7a3a1c', '#8f5a26'],
      ['#b8902e', '#a87a28', '#c9a443', '#8a7a2c'],
      ['#4f6428', '#3e5222', '#5d6e2c', '#6e6a2c'],
      ['#7d3b1d', '#93441f', '#6a3418', '#a4552a'],
    ]
    // the woods further back: a continuous dark mass with a ragged top
    for (let k = 0; k < 900; k++) {
      const x = rand() * W
      const y = range(rand, H * 0.5, H * 0.8)
      g.fillStyle = pick(rand, ['#2a3020', '#33331f', '#3a2c1c', '#262b1d', '#40361f'])
      g.beginPath()
      g.arc(x, y, range(rand, 4, 10), 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = '#262b1d'
    g.fillRect(0, H * 0.62, W, H * 0.2)
    for (let c = 0; c < 18; c++) {
      const cx = range(rand, 10, W - 10)
      const top = range(rand, 14, 110)
      const w = range(rand, 50, 120)
      const base = H * 0.78
      // trunk
      g.strokeStyle = '#2d241e'
      g.lineWidth = range(rand, 2, 4)
      g.beginPath()
      g.moveTo(cx, H)
      g.lineTo(cx + range(rand, -4, 4), top + (base - top) * 0.5)
      g.stroke()
      if (rand() < 0.3) {
        // bare: a fan of twigs
        g.strokeStyle = 'rgba(58,46,40,0.9)'
        for (let k = 0; k < 40; k++) {
          const a = range(rand, -1.1, 1.1)
          const l = range(rand, 0.4, 1) * (base - top) * 0.75
          const sx = cx + range(rand, -6, 6)
          const sy = top + (base - top) * 0.55
          g.lineWidth = range(rand, 0.8, 1.8)
          g.beginPath()
          g.moveTo(sx, sy)
          g.quadraticCurveTo(sx + Math.sin(a) * l * 0.4, sy - l * 0.6, sx + Math.sin(a) * l * 0.8, sy - Math.cos(a) * l)
          g.stroke()
        }
        continue
      }
      const pal = pick(rand, palettes)
      const cy = top + (base - top) * 0.42
      const ry = (base - top) * 0.45
      for (let k = 0; k < 300; k++) {
        const a = rand() * Math.PI * 2
        const r = Math.sqrt(rand())
        const x = cx + Math.cos(a) * r * w * 0.5
        const y = cy + Math.sin(a) * r * ry
        g.fillStyle = pick(rand, pal)
        g.beginPath()
        g.arc(x, y, range(rand, 2.2, 5), 0, Math.PI * 2)
        g.fill()
        // shade the lower half of each crown
        if (y > cy) {
          g.fillStyle = `rgba(10,12,8,${((y - cy) / ry) * 0.45})`
          g.fill()
        }
      }
    }
    // the dark understorey and hedges at the foot
    g.fillStyle = '#1b2217'
    g.fillRect(0, H * 0.8, W, H * 0.2)
    for (let k = 0; k < 500; k++) {
      const x = rand() * W
      const y = H * 0.8 + range(rand, -14, 4)
      g.fillStyle = pick(rand, ['#1b2217', '#232c1c', '#2a2a1a', '#1e2419'])
      g.beginPath()
      g.arc(x, y, range(rand, 3, 8), 0, Math.PI * 2)
      g.fill()
    }
  })
}

function barkTexture(THREE, color, seed) {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = color
  g.fillRect(0, 0, 128, 256)
  const rand = seeded(seed)
  for (let i = 0; i < 150; i++) {
    g.strokeStyle = `rgba(0,0,0,${range(rand, 0.1, 0.32)})`
    g.lineWidth = range(rand, 1, 3)
    const x = rand() * 128
    g.beginPath()
    g.moveTo(x, rand() * 256)
    g.lineTo(x + range(rand, -4, 4), rand() * 256)
    g.stroke()
  }
  for (let i = 0; i < 50; i++) {
    g.fillStyle = `rgba(150,170,110,${range(rand, 0.05, 0.16)})` // a little green moss
    g.fillRect(rand() * 128, rand() * 256, range(rand, 4, 14), range(rand, 4, 20))
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/* --- ground shaders ------------------------------------------------------ */

const LITTER_GLSL = /* glsl */ `
  vec3 parkLeafColor(vec2 p) {
    float f1 = vnoise(p * 2.7);
    float f2 = vnoise(p * 6.1 + 13.0);
    float f3 = vnoise(p * 1.3 + 31.0);
    vec3 rust = vec3(0.27, 0.075, 0.022);
    vec3 ochre = vec3(0.48, 0.25, 0.045);
    vec3 gold = vec3(0.55, 0.38, 0.06);
    vec3 brown = vec3(0.11, 0.06, 0.03);
    vec3 c = mix(rust, ochre, smoothstep(0.25, 0.85, f1));
    c = mix(c, gold, smoothstep(0.6, 0.95, f3) * 0.6);
    return mix(c, brown, smoothstep(0.45, 0.95, f2) * 0.7);
  }
  float parkLitter(vec2 p) {
    float big = fbm(p * 0.03);
    float mid = vnoise(p * 0.21);
    float e = length(p / vec2(${LA.toFixed(1)}, ${LB.toFixed(1)}));
    float under = smoothstep(1.0, 1.16, e + (big - 0.5) * 0.3 + (mid - 0.5) * 0.12);
    float drift = smoothstep(0.64, 0.86, fbm(p * 0.09 + 7.0)) * 0.55;
    return max(under, drift);
  }
`

/** Lawn → leaf litter: patchy grass on the lawn, a carpet of leaves under the trees. */
function parkGround(THREE, mat, mode) {
  const key = 'park-ground-' + mode
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vParkW;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvParkW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    let body = ''
    if (mode === 'lawn') {
      body = `
        float big = fbm(pp * 0.03);
        float wear = vnoise(pp * 0.6);
        diffuseColor.rgb *= mix(vec3(0.74, 0.86, 0.8), vec3(1.12, 1.1, 0.84), big);
        diffuseColor.rgb *= 0.9 + 0.2 * wear;
        float lit = parkLitter(pp);
        float bits = smoothstep(0.3, 0.7, vnoise(pp * 11.0) * 0.6 + vnoise(pp * 4.3) * 0.4 + lit * 0.5 - 0.15);
        float k = clamp(lit * mix(0.4, 1.0, bits), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, parkLeafColor(pp) * (0.75 + 0.5 * vnoise(pp * 17.0)), k);`
    } else if (mode === 'path') {
      body = `
        float across = vMapUv.x * PATH_TILE;
        float edge = 1.0 - smoothstep(0.0, 0.55, min(across, PATH_W - across));
        float bits = smoothstep(0.45, 0.75, vnoise(pp * 9.0) * 0.6 + vnoise(pp * 3.1) * 0.4);
        float k = clamp((edge * 0.85 + smoothstep(0.6, 0.85, vnoise(pp * 0.4)) * 0.5) * bits, 0.0, 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, parkLeafColor(pp), k);`
    } else {
      body = `
        float bits = smoothstep(0.4, 0.7, vnoise(pp * 8.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, parkLeafColor(pp), bits * 0.55);`
    }
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vParkW;\n#define PATH_TILE ${(5).toFixed(1)}\n#define PATH_W ${PATH_W.toFixed(1)}\n${NOISE_GLSL}\n${LITTER_GLSL}`
      )
      .replace('#include <map_fragment>', `#include <map_fragment>\n{ vec2 pp = vParkW.xz;\n${body}\n}`)
  }
  mat.customProgramCacheKey = () => key
  return mat
}

/* --- trees ------------------------------------------------------------------ */

/** Grow a bare (or nearly bare) tree of unit height: tapered limbs and twig cards. */
function growBare(THREE, seed, sp) {
  const rand = seeded(seed)
  const woods = []
  const cards = []
  const up = new THREE.Vector3(0, 1, 0)
  const q = new THREE.Quaternion()
  const MAXD = 3
  function twigs(p, dir, n) {
    for (let k = 0; k < n; k++) {
      const s = sp.twig * range(rand, 0.75, 1.3)
      const plane = new THREE.PlaneGeometry(s, s)
      plane.translate(0, s * 0.45, 0)
      plane.rotateY(rand() * Math.PI)
      const d = dir.clone().lerp(up, 0.35)
      d.x += range(rand, -0.3, 0.3)
      d.z += range(rand, -0.3, 0.3)
      q.setFromUnitVectors(up, d.normalize())
      plane.applyQuaternion(q)
      plane.translate(p.x, p.y, p.z)
      cards.push(plane)
    }
  }
  function limb(start, dir, len, r0, d) {
    const end = start.clone().addScaledVector(dir, len)
    const r1 = r0 * 0.6
    woods.push(cylBetween(THREE, start, end, r0, r1, d < 2 ? 7 : 5))
    if (d >= MAXD) {
      twigs(end, dir, rand() < 0.4 ? 2 : 1)
      return
    }
    if (d >= 1 && rand() < 0.3) twigs(start.clone().lerp(end, range(rand, 0.4, 0.8)), dir, 1)
    const kids = d === 0 ? 4 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2)
    for (let k = 0; k < kids; k++) {
      const a = (k / kids) * Math.PI * 2 + rand() * 1.3
      const tilt = d === 0 ? sp.spread * range(rand, 0.6, 1.15) : range(rand, 0.35, 0.95)
      const nd = new THREE.Vector3(Math.cos(a) * tilt, sp.upward + range(rand, -0.15, 0.3), Math.sin(a) * tilt).normalize()
      nd.lerp(dir, d === 0 ? 0.12 : 0.3).normalize()
      const at = start.clone().lerp(end, d === 0 ? range(rand, 0.65, 1) : range(rand, 0.75, 1))
      limb(at, nd, len * range(rand, 0.58, 0.8), r1, d + 1)
    }
    if (d < 2) limb(end, dir.clone().lerp(up, 0.5).normalize(), len * 0.62, r1 * 0.9, d + 1)
  }
  limb(new THREE.Vector3(), new THREE.Vector3(range(rand, -0.05, 0.05), 1, range(rand, -0.05, 0.05)).normalize(), sp.trunk, sp.radius, 0)
  const wood = mergeGeometries(woods, false)
  const twig = mergeGeometries(cards, false)
  radialNormals(twig, 0, sp.trunk + 0.25, 0, 0.3)
  return { wood, twig }
}

/** Plant bare trees (instanced: two draw calls per variant). */
function addBareTrees(THREE, scene, spots, { seed = 3, quality = 'high' } = {}) {
  if (!spots.length) return
  const rand = seeded(seed)
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture(THREE, '#5a5048', seed), roughness: 0.95 })
  const nVar = quality === 'low' ? 2 : 3
  const variants = []
  for (let v = 0; v < nVar; v++) {
    const tex = twigTexture(THREE, seed * 7 + v, v === 0 ? 0.25 : 0.08)
    const mat = cardMaterial(THREE, tex, { cut: 0.4, rough: 0.9 })
    variants.push({
      geo: growBare(THREE, seed * 53 + v * 11, { trunk: range(rand, 0.28, 0.36), radius: 0.024, spread: range(rand, 0.6, 0.85), upward: range(rand, 0.45, 0.65), twig: 0.2 }),
      mat,
      depth: cardDepth(THREE, tex, 0.4),
    })
  }
  const groups = variants.map(() => [])
  spots.forEach((s, i) => groups[i % nVar].push(s))
  const m = new THREE.Matrix4()
  const qq = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)
  variants.forEach((v, vi) => {
    const list = groups[vi]
    if (!list.length) return
    const wood = new THREE.InstancedMesh(v.geo.wood, bark, list.length)
    const twig = new THREE.InstancedMesh(v.geo.twig, v.mat, list.length)
    list.forEach((s, j) => {
      const h = s.h || range(rand, 14, 20)
      const w = h * range(rand, 0.85, 1.1)
      qq.setFromAxisAngle(yAxis, rand() * Math.PI * 2)
      m.compose(new THREE.Vector3(s.x, 0, s.z), qq, new THREE.Vector3(w, h, w))
      wood.setMatrixAt(j, m)
      twig.setMatrixAt(j, m)
    })
    wood.castShadow = wood.receiveShadow = true
    twig.castShadow = true
    twig.receiveShadow = true
    twig.customDepthMaterial = v.depth
    twig.layers.set(NO_INK)
    scene.add(wood, twig)
  })
}

/**
 * The weeping willow in the middle of the lawn, late in the year: a short
 * leaning trunk, limbs arching up and out, and a curtain of thin strands
 * with a few golden leaves left, swaying in the wind.
 */
function addWillow(THREE, scene, { x, z, quality }, time) {
  const rand = seeded(404)
  const low = quality === 'low'
  const woods = []
  const base = new THREE.Vector3(x, 0, z)
  const fork = new THREE.Vector3(x + 0.4, 3.4, z - 0.2)
  woods.push(cylBetween(THREE, base.clone().setY(-0.2), fork, 0.55, 0.38, 12))
  const tips = []
  const nLimbs = 7
  for (let i = 0; i < nLimbs; i++) {
    const a = (i / nLimbs) * Math.PI * 2 + range(rand, -0.3, 0.3)
    const r1 = range(rand, 2.2, 3.4)
    const mid = new THREE.Vector3(x + Math.cos(a) * r1, range(rand, 6.4, 7.8), z + Math.sin(a) * r1)
    woods.push(cylBetween(THREE, fork, mid, 0.26, 0.15, 8))
    for (let k = 0; k < 3; k++) {
      const a2 = a + range(rand, -0.55, 0.55)
      const r2 = range(rand, 4.2, 6.2)
      const tip = new THREE.Vector3(x + Math.cos(a2) * r2, range(rand, 8.6, 10.6), z + Math.sin(a2) * r2)
      woods.push(cylBetween(THREE, mid, tip, 0.13, 0.04, 6))
      tips.push(tip)
    }
  }
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture(THREE, '#5b5045', 9), roughness: 0.95 })
  const wood = new THREE.Mesh(mergeGeometries(woods, false), bark)
  wood.castShadow = wood.receiveShadow = true
  scene.add(wood)

  // the hanging curtain
  const cards = []
  const nCards = low ? 70 : 140
  for (let i = 0; i < nCards; i++) {
    const a = rand() * Math.PI * 2
    const r = 2 + Math.sqrt(rand()) * 4.6
    const top = 10.6 - (r / 6.6) ** 2 * 3.0 + range(rand, -0.5, 0.4)
    const bottom = range(rand, 2.5, 4.9)
    const L = Math.max(1.5, top - bottom)
    const wid = range(rand, 1.0, 1.7)
    const p = new THREE.PlaneGeometry(wid, L)
    p.translate(0, -L / 2, 0)
    p.rotateY(rand() * Math.PI)
    p.translate(x + Math.cos(a) * r, top, z + Math.sin(a) * r)
    radialNormals(p, x, 5, z, 0.35)
    cards.push(p)
  }
  const ctex = curtainTexture(THREE, 12)
  const cmat = cardMaterial(THREE, ctex, {
    size: 512,
    cut: 0.38,
    rough: 0.8,
    extra: (sh) => {
      sh.uniforms.uParkTime = time
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uParkTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float sw = pow(1.0 - uv.y, 1.5);
        transformed.x += sin(uParkTime * 1.3 + position.z * 0.6 + position.y * 0.3) * 0.16 * sw;
        transformed.z += sin(uParkTime * 0.9 + position.x * 0.5) * 0.12 * sw;`
      )
    },
  })
  const curtain = new THREE.Mesh(mergeGeometries(cards, false), cmat)
  curtain.castShadow = curtain.receiveShadow = true
  curtain.customDepthMaterial = cardDepth(THREE, ctex, 0.38)
  curtain.layers.set(NO_INK)
  scene.add(curtain)

  // what's left of the crown: sparse golden clusters at the tips
  const crown = []
  for (const t of tips) {
    for (let k = 0; k < 2; k++) {
      const s = range(rand, 1.6, 2.4)
      const p = new THREE.PlaneGeometry(s, s)
      p.rotateY(rand() * Math.PI)
      p.rotateX(range(rand, -0.6, 0.6))
      p.translate(t.x + range(rand, -0.6, 0.6), t.y + range(rand, -0.6, 0.3), t.z + range(rand, -0.6, 0.6))
      crown.push(p)
    }
  }
  const ktex = clusterTexture(THREE, ['#b8962f', '#a88a2c', '#c9a843', '#8f8a34', '#6f7a2c'], 21, { n: 260, size: [5, 10] })
  const crownGeo = radialNormals(mergeGeometries(crown, false), x, 7.5, z, 0.3)
  const crownMesh = new THREE.Mesh(crownGeo, cardMaterial(THREE, ktex, { cut: 0.45 }))
  crownMesh.castShadow = true
  crownMesh.customDepthMaterial = cardDepth(THREE, ktex, 0.45)
  crownMesh.layers.set(NO_INK)
  scene.add(crownMesh)
}

/** Dark shrubbery at the foot of the tree belt: a leafy shell round a dark core. */
function addShrubs(THREE, scene, spots, { colors = null, core: coreColor = 0x1e2a16, seed = 55 } = {}) {
  if (!spots.length) return
  const rand = seeded(seed)
  let core = new THREE.IcosahedronGeometry(1, 1)
  {
    const p = core.attributes.position
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i)
      const vy = p.getY(i)
      const vz = p.getZ(i)
      const n = 0.85 + 0.22 * Math.sin(vx * 4.1 + vy * 2.3) * Math.cos(vz * 3.7 - vy * 1.9)
      p.setXYZ(i, vx * n, vy * n, vz * n)
    }
    core.computeVertexNormals()
  }
  const shell = []
  for (let i = 0; i < 28; i++) {
    const a = rand() * Math.PI * 2
    const y = range(rand, -0.2, 0.95)
    const r = Math.sqrt(1 - y * y)
    const s = range(rand, 0.85, 1.25)
    const p = new THREE.PlaneGeometry(s, s)
    p.rotateY(rand() * Math.PI)
    p.rotateX(range(rand, -0.7, 0.7))
    p.translate(Math.cos(a) * r * 0.95, y * 0.95, Math.sin(a) * r * 0.95)
    shell.push(p)
  }
  const shellGeo = radialNormals(mergeGeometries(shell, false), 0, -0.3, 0, 0.2)
  const tex = clusterTexture(THREE, colors || ['#2e4220', '#3a5226', '#26381b', '#4a5a2a', '#5a4a24', '#6a4a22'], seed - 22, { n: 520, size: [6, 11] })
  const coreMat = new THREE.MeshStandardMaterial({ color: coreColor, roughness: 0.95, normalMap: noiseNormalMap(THREE, 128, { cells: 16, strength: 3 }) })
  const shellMat = cardMaterial(THREE, tex, { cut: 0.45 })
  const cores = new THREE.InstancedMesh(core, coreMat, spots.length)
  const shells = new THREE.InstancedMesh(shellGeo, shellMat, spots.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  spots.forEach((s, i) => {
    q.setFromAxisAngle(yAxis, rand() * Math.PI * 2)
    m.compose(new THREE.Vector3(s.x, s.r * 0.42, s.z), q, new THREE.Vector3(s.r, s.r * 0.72, s.r * range(rand, 0.8, 1.2)))
    cores.setMatrixAt(i, m)
    shells.setMatrixAt(i, m)
    c.setRGB(range(rand, 0.75, 1.1), range(rand, 0.8, 1.1), range(rand, 0.7, 1.0))
    shells.setColorAt(i, c)
  })
  cores.castShadow = cores.receiveShadow = true
  shells.castShadow = shells.receiveShadow = true
  shells.customDepthMaterial = cardDepth(THREE, tex, 0.45)
  shells.layers.set(NO_INK)
  if (shells.instanceColor) shells.instanceColor.needsUpdate = true
  scene.add(cores, shells)
}

/* --- props ----------------------------------------------------------------- */

/** An Amsterdam park bench: wooden slats on dark cast-iron ends. Front = +z. */
function benchGeometries(THREE) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const wood = []
  for (let i = 0; i < 4; i++) wood.push(boxAt(THREE, 1.9, 0.035, 0.09, 0, 0.45, 0.14 - i * 0.105))
  for (let i = 0; i < 3; i++) {
    const y = 0.62 + i * 0.12
    const g = new THREE.BoxGeometry(1.9, 0.09, 0.03)
    g.rotateX(-0.22)
    g.translate(0, y, -0.27 - (y - 0.6) * 0.24)
    wood.push(g)
  }
  const iron = []
  for (const sx of [-0.82, 0.82]) {
    iron.push(beamGeo(THREE, V(sx, 0, -0.28), V(sx, 0.96, -0.37), 0.05, 0.06))
    iron.push(beamGeo(THREE, V(sx, 0, 0.16), V(sx, 0.45, 0.14), 0.05, 0.06))
    iron.push(beamGeo(THREE, V(sx, 0.42, -0.3), V(sx, 0.42, 0.2), 0.05, 0.05))
    iron.push(beamGeo(THREE, V(sx, 0.66, -0.33), V(sx, 0.64, 0.2), 0.05, 0.04))
    iron.push(beamGeo(THREE, V(sx, 0.43, 0.15), V(sx, 0.64, 0.17), 0.035))
    iron.push(boxAt(THREE, 0.09, 0.03, 0.12, sx, 0.015, -0.28))
    iron.push(boxAt(THREE, 0.09, 0.03, 0.12, sx, 0.015, 0.16))
  }
  const strip = (list) =>
    list.map((g) => {
      const n = g.index ? g.toNonIndexed() : g
      return n
    })
  return { wood: mergeGeometries(strip(wood), false), iron: mergeGeometries(strip(iron), false) }
}

/** A classic park lantern on a dark green post (about 3.9 m). */
function lampGeometries(THREE) {
  const post = []
  post.push(new THREE.CylinderGeometry(0.11, 0.16, 0.6, 10).translate(0, 0.3, 0))
  post.push(new THREE.CylinderGeometry(0.055, 0.075, 3.0, 10).translate(0, 2.1, 0))
  post.push(new THREE.CylinderGeometry(0.09, 0.07, 0.12, 10).translate(0, 3.62, 0))
  post.push(new THREE.CylinderGeometry(0.03, 0.26, 0.2, 4).rotateY(Math.PI / 4).translate(0, 4.22, 0))
  post.push(new THREE.CylinderGeometry(0.015, 0.03, 0.18, 6).translate(0, 4.4, 0))
  post.push(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 4).rotateY(Math.PI / 4).translate(0, 3.7, 0))
  const glass = new THREE.CylinderGeometry(0.22, 0.14, 0.42, 4).rotateY(Math.PI / 4).translate(0, 3.92, 0)
  return { post: mergeGeometries(post.map((g) => g.toNonIndexed()), false), glass }
}

/** A mallard, built from a few spheres; vertex-coloured. Faces +z. */
function duckGeometry(THREE) {
  const parts = []
  parts.push(vcolor(THREE, new THREE.SphereGeometry(1, 14, 10).scale(0.15, 0.085, 0.27).translate(0, 0.05, 0), '#8f8a80'))
  parts.push(vcolor(THREE, new THREE.SphereGeometry(1, 10, 8).scale(0.12, 0.08, 0.1).translate(0, 0.07, 0.17), '#5a3426'))
  parts.push(vcolor(THREE, new THREE.SphereGeometry(1, 8, 6).scale(0.08, 0.05, 0.11).translate(0, 0.09, -0.24), '#262626'))
  parts.push(vcolor(THREE, new THREE.CylinderGeometry(0.035, 0.045, 0.12, 8).translate(0, 0.15, 0.19), '#1b4a2a'))
  parts.push(vcolor(THREE, new THREE.SphereGeometry(0.062, 12, 10).translate(0, 0.22, 0.21), '#1b4a2a'))
  parts.push(vcolor(THREE, new THREE.BoxGeometry(0.035, 0.018, 0.075).translate(0, 0.21, 0.285), '#d6a933'))
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)
}

/** A ribbon along a closed loop of points (path, pond bank). UVs in metres / tile. */
function loopRibbon(THREE, pts, width, tile, y) {
  const n = pts.length
  const pos = []
  const uv = []
  const nor = []
  const idx = []
  let acc = 0
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n]
    const prev = pts[(i - 1 + n) % n]
    const next = pts[(i + 1) % n]
    let tx = next.x - prev.x
    let tz = next.z - prev.z
    const tl = Math.hypot(tx, tz) || 1
    tx /= tl
    tz /= tl
    if (i > 0) acc += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z)
    const w = (p.w ?? width) / 2
    pos.push(p.x - tz * w, y, p.z + tx * w, p.x + tz * w, y, p.z - tx * w)
    uv.push(0, acc / tile, width / tile, acc / tile)
    nor.push(0, 1, 0, 0, 1, 0)
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  return geo
}

/* --- the place ------------------------------------------------------------ */

export function buildPark(THREE, ctx, { light = 'golden' } = {}) {
  // our own clear evening sky, not the pale one read from the photos
  ctx.sky = null
  const quality = ctx.quality
  const low = quality === 'low'
  const world = createWorld(THREE, ctx, light, {
    sun: { elevation: 6.5, azimuth: 255 },
    sky: {
      zenith: 0x3a6cb6,
      horizon: 0xc9d9e6,
      ground: 0x5d6448,
      sun: 0xffc27a,
      cloudLit: 0xffd6a8,
      cloudShade: 0x7c7f98,
      clouds: 0.2,
    },
    fog: { density: 0.0019 },
    sunColor: 0xffb46e,
    sunIntensity: 2.7,
    hemi: [0x9dbbe8, 0x3f4d2a, 1.0],
    water: { deep: 0x142226, shallow: 0x2e4642, stroke: 0xffe6c0 },
    exposure: 1.05,
  })
  const { scene } = world

  // a warm glow low round the setting sun, cooler blue away from it
  {
    const sm = world.sky.material
    sm.fragmentShader = sm.fragmentShader.replace(
      'gl_FragColor = vec4(col, 1.0);',
      `float lowSky = 1.0 - smoothstep(-0.02, 0.42, h);
        col += uSunColor * (pow(sd, 3.0) * 0.5 + pow(sd, 14.0) * 0.6) * lowSky * day;
        col = mix(col, col * vec3(0.9, 0.98, 1.1), (1.0 - sd) * 0.35);
        gl_FragColor = vec4(col, 1.0);`
    )
    sm.needsUpdate = true
  }

  const time = { value: 0 }
  const tickers = []

  /* ground: one big lawn, turning to leaf litter under the trees ------------- */
  const lawnMat = parkGround(THREE, M.lawn(THREE, { color: '#3b6c27', worn: 0.12, tile: 3, quality, seed: 12 }), 'lawn')
  const groundMesh = M.ground(THREE, 900, 900, lawnMat, 3)
  scene.add(groundMesh)

  // the path round the lawn, wobbling a little
  const pathPts = []
  {
    const N = 220
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      const wob = 1 + 0.025 * Math.sin(a * 3 + 1) + 0.015 * Math.sin(a * 7)
      pathPts.push({ x: Math.cos(a) * LA * PATH_E * wob, z: Math.sin(a) * LB * PATH_E * wob })
    }
    const pathMat = M.asphalt(THREE, { color: '#8a7a68', tile: 5, quality, seed: 31 })
    pathMat.polygonOffset = true
    pathMat.polygonOffsetFactor = -2
    pathMat.polygonOffsetUnits = -4
    pathMat.side = THREE.DoubleSide
    parkGround(THREE, pathMat, 'path')
    const path = new THREE.Mesh(loopRibbon(THREE, pathPts, PATH_W, 5, 0.025), pathMat)
    path.receiveShadow = true
    scene.add(path)
  }
  const pathAt = (a, off = 0) => {
    const wob = 1 + 0.025 * Math.sin(a * 3 + 1) + 0.015 * Math.sin(a * 7)
    const x = Math.cos(a) * LA * PATH_E * wob
    const z = Math.sin(a) * LB * PATH_E * wob
    let nx = Math.cos(a) / LA
    let nz = Math.sin(a) / LB
    const l = Math.hypot(nx, nz)
    nx /= l
    nz /= l
    return { x: x + nx * off, z: z + nz * off, nx, nz }
  }

  /* the pond ----------------------------------------------------------------- */
  {
    const L = world.light
    // reflections: the dark tree line low down, the blue sky higher up
    const pal = { ...L, sky: { ...L.sky, horizon: 0x262e22, zenith: 0x4f6f95 } }
    const water = waterMaterial(THREE, { palette: pal, scale: 0.55 })
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2), water)
    pond.scale.set(POND.rx, 1, POND.rz)
    pond.position.set(POND.x, 0.04, POND.z)
    scene.add(pond)
    tickers.push((t) => water.userData.tick(t))

    const bankPts = []
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2
      const k = 0.35 + 0.25 * Math.sin(a * 5 + 2)
      bankPts.push({ x: POND.x + Math.cos(a) * (POND.rx + k), z: POND.z + Math.sin(a) * (POND.rz + k), w: 1.4 + 0.5 * Math.sin(a * 3) })
    }
    const bankMat = new THREE.MeshStandardMaterial({
      color: 0x3a3122,
      roughness: 0.92,
      normalMap: noiseNormalMap(THREE, 128, { cells: 12, strength: 3 }),
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    })
    parkGround(THREE, bankMat, 'bank')
    const bank = new THREE.Mesh(loopRibbon(THREE, bankPts, 1.6, 2, 0.02), bankMat)
    bank.receiveShadow = true
    scene.add(bank)

    // reeds round the far (sunward) half of the pond
    const rtex = reedTexture(THREE)
    const reedGeo = mergeGeometries(
      [0, 1, 2].map((k) => new THREE.PlaneGeometry(0.9, 1.7).translate(0, 0.85, 0).rotateY((k * Math.PI) / 3)),
      false
    )
    flatNormals(reedGeo, 0, 1, 0)
    const rand = seeded(61)
    const reedSpots = []
    for (let i = 0; i < (low ? 40 : 80); i++) {
      const a = range(rand, Math.PI * 0.55, Math.PI * 1.75)
      const k = range(rand, -0.4, 0.5)
      reedSpots.push([POND.x + Math.cos(a) * (POND.rx + k), POND.z + Math.sin(a) * (POND.rz + k)])
    }
    const reeds = new THREE.InstancedMesh(reedGeo, cardMaterial(THREE, rtex, { cut: 0.4 }), reedSpots.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const yAxis = new THREE.Vector3(0, 1, 0)
    reedSpots.forEach(([x, z], i) => {
      q.setFromAxisAngle(yAxis, rand() * Math.PI)
      const s = range(rand, 0.6, 1.15)
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * range(rand, 0.6, 1.25), s))
      reeds.setMatrixAt(i, m)
    })
    reeds.castShadow = true
    reeds.customDepthMaterial = cardDepth(THREE, rtex, 0.4)
    reeds.layers.set(NO_INK)
    scene.add(reeds)

    // a few mallards drifting about
    const nDucks = 7
    const ducks = new THREE.InstancedMesh(duckGeometry(THREE), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), nDucks)
    const dd = []
    for (let i = 0; i < nDucks; i++) {
      dd.push({ cx: POND.x + range(rand, -5, 5), cz: POND.z + range(rand, -1.6, 1.6), r: range(rand, 1.2, 3.5), sp: range(rand, 0.05, 0.12) * (rand() < 0.5 ? -1 : 1), ph: rand() * 6.28 })
      ducks.setColorAt(i, i % 3 === 2 ? new THREE.Color(0.95, 0.72, 0.55) : new THREE.Color(1, 1, 1))
    }
    if (ducks.instanceColor) ducks.instanceColor.needsUpdate = true
    const dummy = new THREE.Object3D()
    const placeDucks = (t) => {
      dd.forEach((d, i) => {
        const a = d.ph + t * d.sp
        const x = d.cx + Math.cos(a) * d.r
        const z = d.cz + Math.sin(a) * d.r * 0.45
        dummy.position.set(x, 0.035 + Math.sin(t * 1.7 + i) * 0.008, z)
        // heading along the motion
        const vx = -Math.sin(a) * d.sp
        const vz = Math.cos(a) * d.sp * 0.45
        dummy.rotation.set(0, Math.atan2(vx, vz), Math.sin(t * 1.3 + i) * 0.03)
        dummy.updateMatrix()
        ducks.setMatrixAt(i, dummy.matrix)
      })
      ducks.instanceMatrix.needsUpdate = true
    }
    placeDucks(0)
    tickers.push(placeDucks)
    scene.add(ducks)
  }

  /* the trees ---------------------------------------------------------------- */
  {
    const rand = seeded(2024)
    const pts = []
    const maxTrees = low ? 60 : 125
    const minD = 10.5
    for (let tries = 0; tries < 5000 && pts.length < maxTrees; tries++) {
      const x = range(rand, -150, 120)
      const z = range(rand, -100, 100)
      const e = eOf(x, z)
      const emax = x > 30 ? 1.58 : 2.15
      if (e < 1.2 || e > emax) continue
      if (x > HOUSE_X - 14) continue
      if (pts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minD * minD)) continue
      pts.push({ x, z, e })
    }
    const lists = { oak: [], lime: [], plane: [], birch: [], poplar: [], bare: [] }
    for (const p of pts) {
      const r = rand()
      let sp
      // late in the year: half the trees already bare, the rest in thin gold and rust
      if (p.x < -40) sp = r < 0.62 ? 'bare' : r < 0.8 ? 'oak' : r < 0.9 ? 'plane' : 'birch'
      else if (p.e > 1.55 && r < 0.25) sp = 'poplar'
      else sp = r < 0.22 ? 'oak' : r < 0.36 ? 'lime' : r < 0.5 ? 'plane' : r < 0.6 ? 'birch' : 'bare'
      const h = {
        oak: range(rand, 16, 22),
        lime: range(rand, 15, 21),
        plane: range(rand, 18, 25),
        birch: range(rand, 12, 17),
        poplar: range(rand, 22, 28),
        bare: range(rand, 15, 22),
      }[sp]
      lists[sp].push({ x: p.x, z: p.z, h })
    }
    // a grove of big trees standing out on the lawn (spot 5), and a plane by the path
    lists.oak.push({ x: 34, z: 24, h: 22 })
    lists.plane.push({ x: 45, z: 35, h: 25 })
    lists.lime.push({ x: 27, z: 36, h: 19 })
    lists.plane.push({ x: -48, z: 27, h: 23 })
    lists.bare.push({ x: -2, z: -41, h: 17 })

    const tints = {
      oak: [[1.18, 0.78, 0.5], [1.0, 0.86, 0.62], [0.95, 0.95, 0.8], [1.2, 0.68, 0.42]],
      lime: [[1.3, 1.1, 0.5], [1.2, 1.05, 0.6], [1.1, 1.0, 0.7]],
      plane: [[1.15, 0.95, 0.6], [1.2, 0.85, 0.5], [1.0, 0.95, 0.75]],
      birch: [[1.35, 1.15, 0.42], [1.3, 1.1, 0.5]],
      poplar: [[1.3, 1.12, 0.45], [1.2, 1.05, 0.55]],
    }
    let seed = 5
    for (const sp of ['oak', 'lime', 'plane', 'birch', 'poplar']) {
      const { meshes } = addForest(THREE, scene, lists[sp], { species: sp, season: 'autumn', seed: seed++, quality })
      const c = new THREE.Color()
      for (const mesh of meshes) {
        if (!(mesh.material.alphaTest > 0)) continue
        mesh.layers.set(NO_INK)
        for (let j = 0; j < mesh.count; j++) {
          const t = pick(rand, tints[sp])
          const k = range(rand, 0.85, 1.1)
          c.setRGB(t[0] * k, t[1] * k, t[2] * k)
          mesh.setColorAt(j, c)
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    }
    addBareTrees(THREE, scene, lists.bare, { seed: 8, quality })

    // shrubbery along the inner edge of the belt, with gaps
    const shrubs = []
    const srand = seeded(99)
    const nShrub = low ? 140 : 300
    for (let i = 0; i < nShrub * 3 && shrubs.length < nShrub; i++) {
      const a = srand() * Math.PI * 2
      const e = range(srand, 1.2, 1.5)
      const x = Math.cos(a) * LA * e
      const z = Math.sin(a) * LB * e
      if (x > HOUSE_X - 12) continue
      // gaps where the lawn runs on into the woods
      if (Math.sin(a * 5 + 1.3) + Math.sin(a * 11) * 0.5 > 1.0) continue
      shrubs.push({ x, z, r: range(srand, 1.1, 2.3) })
    }
    addShrubs(THREE, scene, shrubs)
    // a few shrubs already turned yellow, by the grove (photo 17) and round the lawn
    addShrubs(
      THREE,
      scene,
      [
        { x: 36.6, z: 26.6, r: 1.25 },
        { x: 38.8, z: 24.4, r: 0.95 },
        { x: 17.5, z: 27.5, r: 1.1 },
        { x: -40, z: 30, r: 1.3 },
        { x: -52, z: -26, r: 1.2 },
      ],
      { colors: ['#b58a22', '#c99a2a', '#a0761c', '#d4ab3c', '#8a6a1e', '#6f5a1c'], core: 0x5a4518, seed: 77 }
    )
  }

  addWillow(THREE, scene, { x: WILLOW.x, z: WILLOW.z, quality }, time)

  /* the far tree line: painted cards in a ring, fading into the haze -------- */
  {
    const rand = seeded(7)
    const n = low ? 24 : 40
    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)
    // lit like a crown: facing the lawn and a little upward
    flatNormals(geo, 0, 0.45, 0.9)
    const texA = treeWallTexture(THREE, 3)
    const texB = treeWallTexture(THREE, 4)
    const meshes = [texA, texB].map((t) => {
      const mesh = new THREE.InstancedMesh(geo, cardMaterial(THREE, t, { size: 512, cut: 0.4, rough: 0.95 }), Math.ceil(n / 2))
      mesh.layers.set(NO_INK)
      mesh.count = 0
      scene.add(mesh)
      return mesh
    })
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const yAxis = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + range(rand, -0.04, 0.04)
      const R = range(rand, 180, 205)
      const x = Math.cos(a) * R
      const z = Math.sin(a) * R * 0.85
      q.setFromAxisAngle(yAxis, Math.atan2(-x, -z))
      m.compose(new THREE.Vector3(x, -1.5, z), q, new THREE.Vector3(range(rand, 60, 80), range(rand, 28, 38), 1))
      const mesh = meshes[i % 2]
      mesh.setMatrixAt(mesh.count++, m)
    }
    meshes.forEach((mm) => (mm.instanceMatrix.needsUpdate = true))
  }

  /* townhouses to the east, beyond the trees ------------------------------- */
  {
    const rand = seeded(17)
    const facades = [
      M.facade(THREE, { wall: 'brick', color: '#6a3324', mortar: '#8f8272', frame: '#3b2f28', bay: 2.4, storey: 3.2, quality, seed: 41 }),
      M.facade(THREE, { wall: 'brick', color: '#4f2a1f', mortar: '#857867', frame: '#2c2a26', bay: 2.4, storey: 3.2, quality, seed: 42 }),
      M.facade(THREE, { wall: 'brick', color: '#5e3324', mortar: '#7d7062', frame: '#3a3631', bay: 2.6, storey: 3.3, quality, seed: 43 }),
      M.facade(THREE, { wall: 'brick', color: '#7a3e26', mortar: '#a09380', frame: '#2f3a32', bay: 2.4, storey: 3.2, quality, seed: 44 }),
    ]
    const roofMat = M.roof(THREE, { kind: 'slate', tile: 2, quality, seed: 45 })
    const trim = new THREE.MeshStandardMaterial({ color: 0xe9e3d6, roughness: 0.7 })
    const row = new THREE.Group()
    let z = -78
    while (z < 78) {
      const w = range(rand, 5.5, 9)
      const d = range(rand, 11, 13)
      const f = rand() < 0.2 ? facades[2] : facades[[0, 1, 3][Math.floor(rand() * 3)]]
      const { group } = M.townhouse(THREE, {
        w,
        d,
        storeys: 3 + Math.floor(rand() * 3),
        facade: f,
        roof: pick(rand, ['gable', 'step', 'pitched', 'gable']),
        roofMat,
        trim,
      })
      group.rotation.y = -Math.PI / 2
      group.position.set(HOUSE_X + d / 2 + range(rand, -0.4, 0.6), 0, z + w / 2)
      row.add(group)
      z += w
    }
    mergeByMaterial(THREE, row, scene)
    // the street in front of them
    const road = M.ground(THREE, 9, 180, M.asphalt(THREE, { color: '#3b3c3e', tile: 6, quality, seed: 46 }), 6)
    road.position.set(HOUSE_X - 7.5, 0.03, 0)
    scene.add(road)
    const pave = M.ground(THREE, 3, 180, M.paving(THREE, { kind: 'flags', color: '#9c968b', tile: 4, quality, seed: 47 }), 4)
    pave.position.set(HOUSE_X - 1.5, 0.05, 0)
    scene.add(pave)
  }

  /* benches, lanterns and bins along the path ----------------------------- */
  {
    const bench = benchGeometries(THREE)
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.72, normalMap: noiseNormalMap(THREE, 128, { cells: 10, strength: 1.5, stretch: [1, 8] }) })
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1d2620, roughness: 0.5, metalness: 0.5 })
    const benchSpots = []
    for (const a of [0.35, 0.95, 1.55, 2.25, 2.85, 3.55, 4.15, 4.75, 5.35, 5.95]) {
      const p = pathAt(a, PATH_W / 2 + 0.75)
      benchSpots.push({ x: p.x, z: p.z, ry: Math.atan2(-p.nx, -p.nz) })
    }
    // two by the pond, facing the water
    benchSpots.push({ x: POND.x - 5, z: POND.z + 8.8, ry: Math.PI }, { x: POND.x + 5.5, z: POND.z + 8.6, ry: Math.PI })
    const woods = new THREE.InstancedMesh(bench.wood, woodMat, benchSpots.length)
    const irons = new THREE.InstancedMesh(bench.iron, ironMat, benchSpots.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const one = new THREE.Vector3(1, 1, 1)
    const yAxis = new THREE.Vector3(0, 1, 0)
    benchSpots.forEach((b, i) => {
      q.setFromAxisAngle(yAxis, b.ry)
      m.compose(new THREE.Vector3(b.x, 0, b.z), q, one)
      woods.setMatrixAt(i, m)
      irons.setMatrixAt(i, m)
    })
    woods.castShadow = woods.receiveShadow = irons.castShadow = true
    scene.add(woods, irons)

    // bins beside every other bench
    const binGeo = mergeGeometries(
      [new THREE.CylinderGeometry(0.28, 0.25, 0.85, 14).translate(0, 0.43, 0), new THREE.CylinderGeometry(0.3, 0.3, 0.06, 14).translate(0, 0.88, 0)].map((g) => g.toNonIndexed()),
      false
    )
    const bins = new THREE.InstancedMesh(binGeo, new THREE.MeshStandardMaterial({ color: 0x24402c, roughness: 0.55, metalness: 0.3 }), 5)
    for (let i = 0; i < 5; i++) {
      const b = benchSpots[i * 2]
      const ox = Math.cos(b.ry) * 1.4
      const oz = -Math.sin(b.ry) * 1.4
      m.makeTranslation(b.x + ox, 0, b.z + oz)
      bins.setMatrixAt(i, m)
    }
    bins.castShadow = true
    scene.add(bins)

    // lanterns, already lit in the dusk
    const lamp = lampGeometries(THREE)
    const lampSpots = []
    for (let i = 0; i < (low ? 10 : 16); i++) {
      const p = pathAt((i / (low ? 10 : 16)) * Math.PI * 2 + 0.2, PATH_W / 2 + 0.6)
      lampSpots.push(p)
    }
    lampSpots.push({ x: POND.x + 1, z: POND.z + 9.8 })
    const posts = new THREE.InstancedMesh(lamp.post, new THREE.MeshStandardMaterial({ color: 0x1c2a22, roughness: 0.45, metalness: 0.55 }), lampSpots.length)
    const glass = new THREE.InstancedMesh(
      lamp.glass,
      new THREE.MeshStandardMaterial({ color: 0xffe2b8, emissive: 0xffb466, emissiveIntensity: 3.2, roughness: 0.3 }),
      lampSpots.length
    )
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(255,200,140,1)'), color: 0xffc58a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.4 })
    lampSpots.forEach((p, i) => {
      m.makeTranslation(p.x, 0, p.z)
      posts.setMatrixAt(i, m)
      glass.setMatrixAt(i, m)
      const s = new THREE.Sprite(glowMat)
      s.position.set(p.x, 3.92, p.z)
      s.scale.setScalar(1.8)
      scene.add(s)
    })
    posts.castShadow = true
    scene.add(posts, glass)
  }

  /* spots (photos 12–18) --------------------------------------------------- */
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  // one viewpoint per photograph (12 … 18), where each was taken from:
  // x, z, eye height, azimuth (0 → +z, 90 → +x; the sun is at 255), pitch
  const view = (x, z, eye, az, pitch) => {
    const a = (az * Math.PI) / 180
    const p = (pitch * Math.PI) / 180
    const D = 50
    return { pos: V(x, eye, z), look: V(x + Math.sin(a) * Math.cos(p) * D, eye + Math.sin(p) * D, z + Math.cos(a) * Math.cos(p) * D) }
  }
  const spots = [
    // 12 · close portrait on the open lawn west of the willow, toward the low
    // sun: the backlit belt of trees glowing orange left of centre, dark hedge
    view(-27.5, -7, 1.6, 241, -4),
    // 13 · a few steps on, in under the willow (its bare strands hanging
    // across the top of the frame), the same backlit trees, more sky
    view(-21.5, -1.8, 1.55, 247, 1.5),
    // 14 · turned north with the sun behind: the dark tree line and hedge, the
    // tops of the bare trees catching the last light, a pale blue sky
    view(-21.6, 1.0, 1.55, 18, -1),
    // 15 · east from under the willow, beside its trunk: bare trees, and behind them the long
    // dark brick row of townhouses
    view(-20.3, 2.0, 1.6, 94, -2),
    // 16 · crouched low out on the open lawn, looking up into the blue over
    // the far tree line, the sunset glow on the right
    view(30, 10, 1.05, 300, 13),
    // 17 · on the lawn by the grove: a big trunk and a yellow shrub to the
    // left, the darker woods beyond
    view(21.5, 13.5, 1.75, 30, -7),
    // 18 · low across the whole lawn toward the sunset sky, the trees black
    // against it
    view(42, -4, 1.15, 274, 1),
  ]

  /* the floor at the camera's feet: fallen leaves ---------- */
  {
    const rand = seeded(303)
    const nLeaves = low ? 3000 : 9000
    const centres = spots.map((s) => s.pos).concat([V(34, 0, 24), V(WILLOW.x, 0, WILLOW.z), V(POND.x + 1, 0, POND.z + 9)])
    const leafGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    const ltex = leafTexture(THREE)
    const leafMat = cardMaterial(THREE, ltex, { size: 64, cut: 0.5, rough: 0.8 })
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, nLeaves)
    const leafCols = ['#b5541f', '#c9762a', '#8e3a17', '#d39a35', '#a8632a', '#7a4a22', '#c4a040', '#6e3a1e', '#e0a83a']
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const c = new THREE.Color()
    let k = 0
    while (k < nLeaves) {
      const cen = centres[k % centres.length]
      const r = 20 * Math.pow(rand(), 0.75)
      const a = rand() * Math.PI * 2
      const x = cen.x + Math.cos(a) * r
      const z = cen.z + Math.sin(a) * r
      if (inPond(x, z, 0.2)) continue
      e.set(range(rand, -0.25, 0.25), rand() * Math.PI * 2, range(rand, -0.25, 0.25))
      q.setFromEuler(e)
      const s = range(rand, 0.06, 0.12)
      m.compose(new THREE.Vector3(x, 0.03 + rand() * 0.02, z), q, new THREE.Vector3(s, s, s * range(rand, 0.9, 1.2)))
      leaves.setMatrixAt(k, m)
      c.set(pick(rand, leafCols))
      leaves.setColorAt(k, c)
      k++
    }
    leaves.receiveShadow = true
    leaves.layers.set(NO_INK)
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true
    scene.add(leaves)

  }

  world.focusShadows(new THREE.Vector3(-5, 0, 0), 95)

  const path = {
    positions: [V(150, 70, 120), V(80, 34, 60), V(24, 10, 16), V(-12, 3, -12), spots[0].pos.clone()],
    targets: [V(0, 5, 0), V(-20, 4, -4), V(-40, 4, -14), V(-60, 4, -24), spots[0].look.clone()],
    fov: 50,
    near: 0.2,
    spots,
  }

  return {
    scene,
    world,
    path,
    groundAt: () => 0,
    clearance: 1.0,
    update(t) {
      world.tick(t)
      time.value = t
      for (const f of tickers) f(t)
    },
  }
}
