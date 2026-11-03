/**
 * The coast — Dutch dunes and the North Sea at the golden end of the day.
 *
 * Mieri & Fathi walked through tall marram grass on the dunes toward the sea,
 * then down onto the beach as the sun touched the water. Built from that:
 *
 *  - a real heightfield: a broad foredune along the beach (steep to the sea,
 *    a plateau on top), rolling dune ridges inland, wind-scooped blowouts of
 *    bare sand, and a path worn through a notch in the foredune to the beach;
 *  - marram grass with plumes, in three levels of detail: blade-by-blade
 *    clumps around every viewpoint, crossed alpha cards further out, sparse
 *    cards to the haze — all swaying in one gusting wind on the GPU and
 *    glowing gold when the low sun shines through them;
 *  - sea-buckthorn bushes, brushwood sand fences, a beach pole, a pavilion on
 *    stilts down the beach;
 *  - the beach: dry rippled sand, a tide line, then wet sand that turns to a
 *    mirror of the sky toward the water;
 *  - the sea: swell rolling in, breaking into lines of foam in the surf zone
 *    and running up the sand in a lacy swash edge; offshore, ships, sails and
 *    a wind farm faint in the haze.
 *
 * Metres. The sea is toward −Z; the sun sits low over it, a little to the
 * left as you face the water.
 */
import { createWorld, waterMaterial } from '../world.js'
import * as M from '../materials.js'
import { fbm, ridged, seeded, range, beamBatch, noiseNormalMap, paintTexture } from '../utils.js'
import { NO_INK_LAYER } from '../post.js'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

/* --- the land ----------------------------------------------------------------- */

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const smax = (a, b, k) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k))

/** Where the still water meets the sand (z of the waterline at x). */
const shoreZ = (x) => -195 + 4 * Math.sin(x * 0.013) + 2 * Math.sin(x * 0.041 + 1)
/** The foot of the dunes, where the beach ends. */
const footZ = (x) => -122 + 5 * Math.sin(x * 0.021 + 0.5) + 3 * Math.sin(x * 0.057 + 2)
/** The crest line of the foredune. */
const crestZ = (x) => -101 + 6 * Math.sin(x * 0.017 + 2)
/** The sandy path that wanders through the dunes and the notch to the beach. */
const pathX = (z) => -4 + 7 * Math.sin(z * 0.017 + 0.4) + 4 * Math.sin(z * 0.043 + 1.3)
/** The beach and sea bed: a gentle slope up from the water, shelving off under it. */
function bedY(x, z) {
  const d = z - shoreZ(x)
  return d > 0 ? d * 0.035 : Math.max(-7, d * 0.028)
}
// bowls the wind has scooped out of the dunes: bare sand
const BLOWOUTS = [
  { x: 48, z: -52, r: 20, d: 4.5 },
  { x: -62, z: 8, r: 26, d: 5.5 },
  { x: 130, z: -20, r: 22, d: 5 },
  { x: -150, z: -58, r: 24, d: 5 },
  { x: 70, z: 60, r: 30, d: 6 },
  { x: -20, z: 120, r: 26, d: 5 },
]

/** Ground height at (x, z). */
function duneH(x, z) {
  const foot = footZ(x)
  if (z < foot - 12) return bedY(x, z)
  const beach = bedY(x, Math.min(z, foot))
  const crest = crestZ(x)
  const dz = z - crest
  const pathD = Math.abs(x - pathX(z))
  // the foredune: steep to the sea, a broad plateau behind; cut down where the path goes through
  const notch = 1 - 0.72 * Math.exp(-(pathD * pathD) / 110)
  const rh = (7.5 + 6 * fbm(x * 0.006 + 5, 1.3, 3)) * notch
  const ridge = dz < 0 ? rh * Math.exp(-(dz * dz) / 150) : rh * Math.exp(-((dz / 34) ** 4))
  // older dunes inland: ridged crests and soft hollows
  const inland = smoothstep(crest + 10, crest + 60, z)
  const roll = (1 + 11 * ridged(x * 0.0105 + 3.1, z * 0.0135 - 1.7, 4) + 3 * fbm(x * 0.028 + 7, z * 0.028, 3)) * inland
  let h = smax(ridge, roll, 6)
  // hummocks round the grass tussocks
  h += (fbm(x * 0.09, z * 0.09, 2) - 0.5) * 1.4
  for (const b of BLOWOUTS) {
    const q = ((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r)
    if (q < 1) h -= b.d * (1 - q) * (1 - q)
  }
  // the path is a shallow trough trodden into the sand
  const trough = Math.max(0, 1 - pathD / 3)
  h -= trough * trough * 0.7
  h *= smoothstep(foot - 12, foot + 4, z)
  return beach + h
}

/** How much marram grows here (0 bare sand … 1 dense). */
function grassiness(x, z) {
  const foot = footZ(x)
  if (z < foot + 1) return 0
  let g = smoothstep(foot + 1, foot + 13, z)
  g *= smoothstep(1.3, 2.8, Math.abs(x - pathX(z)))
  for (const b of BLOWOUTS) {
    const q = ((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r)
    if (q < 1) g *= smoothstep(0.3, 0.95, q)
  }
  g *= 0.4 + 0.6 * smoothstep(0.3, 0.56, fbm(x * 0.045 + 11, z * 0.045 - 3, 3))
  return g
}

/** Where the sea buckthorn thickets grow: hollows inland. */
function shrubbiness(x, z) {
  if (z < crestZ(x) + 25) return 0
  return smoothstep(0.56, 0.7, fbm(x * 0.022 + 40, z * 0.022 - 9, 3)) * smoothstep(1.3, 3, Math.abs(x - pathX(z)))
}

/* --- shader snippets ------------------------------------------------------------- */

// The beach profile and the swell, shared by the sea's vertex and fragment shaders
const SEA_GLSL = /* glsl */ `
  float shoreZ(float x) { return -195.0 + 4.0 * sin(x * 0.013) + 2.0 * sin(x * 0.041 + 1.0); }
  float bedY(vec2 p) { float d = p.y - shoreZ(p.x); return d > 0.0 ? d * 0.035 : max(-7.0, d * 0.028); }
  float wavePhase(vec2 p, float t) { return p.y * 0.45 + 0.9 * sin(p.x * 0.011) + 0.5 * sin(p.x * 0.037 + 2.0) - t * 1.15; }
  float surgeH(vec2 p, float t) { return 0.07 * sin(t * 0.42 + p.x * 0.021) + 0.045 * sin(t * 0.71 - p.x * 0.034 + 1.3); }
  float swellH(vec2 p, float t) {
    float off = shoreZ(p.x) - p.y;
    float amp = 0.17 * smoothstep(0.5, 14.0, off) * (1.0 - smoothstep(95.0, 125.0, off));
    float s = 0.5 + 0.5 * sin(wavePhase(p, t));
    return amp * (s * s * s * 1.7 - 0.42) + surgeH(p, t);
  }
`

/** Add swell, shallows and surf foam to world.js's water shader. */
function surfPatch(THREE, mat) {
  mat.uniforms.uFoam = { value: new THREE.Color(0xf3ebe0) }
  mat.uniforms.uSandTint = { value: new THREE.Color(0x8f8a72) }
  const vs = mat.vertexShader
  const fs = mat.fragmentShader
  const vAnchor = 'vec4 wp = modelMatrix * vec4(position, 1.0);'
  if (vs.includes(vAnchor) && vs.includes('varying vec3 vWorld;')) {
    mat.vertexShader = vs
      .replace('varying vec3 vWorld;', `varying vec3 vWorld;\nuniform float uTime;\n${SEA_GLSL}`)
      .replace(vAnchor, `${vAnchor}\n        wp.y += swellH(wp.xz, uTime);`)
  }
  const fA = 'vec3 r = reflect(-v, n);'
  const fB = 'gl_FragColor = vec4(col, 1.0);'
  if (fs.includes(fA) && fs.includes(fB) && fs.includes('varying vec3 vWorld;')) {
    mat.fragmentShader = fs
      .replace('varying vec3 vWorld;', `varying vec3 vWorld;\nuniform vec3 uFoam; uniform vec3 uSandTint;\n${SEA_GLSL}`)
      .replace(
        fA,
        `{
          // the swell's slope tilts the surface
          float se = 0.3;
          float s0 = swellH(vWorld.xz, uTime);
          float sx = swellH(vWorld.xz + vec2(se, 0.0), uTime);
          float sz = swellH(vWorld.xz + vec2(0.0, se), uTime);
          n = normalize(n + vec3(-(sx - s0) / se, 0.0, -(sz - s0) / se) * (1.3 / (1.0 + dist * 0.004)));
        }
        ${fA}`
      )
      .replace(
        fB,
        `{
          vec2 sp = vWorld.xz;
          float depth = vWorld.y - bedY(sp);
          float off = shoreZ(sp.x) - sp.y;
          // shallows: sand shows through, the water turns lighter and greener
          float shallow = 1.0 - smoothstep(0.0, 1.8, depth);
          col = mix(col, uSandTint * (0.6 + 0.4 * max(dot(n, sunDir), 0.0)), shallow * (1.0 - fres) * 0.6);
          float fadeD = 1.0 / (1.0 + dist * 0.006);
          float lace = fbm(sp * vec2(0.55, 1.4) + vec2(0.0, -uTime * 0.35));
          float fine = vnoise(sp * vec2(2.6, 5.5) + vec2(uTime * 0.2, -uTime * 0.9));
          // the swash: a lacy edge where the last of each wave runs up the sand
          float edge = 1.0 - smoothstep(0.0, 0.05 + 0.16 * lace, depth);
          // breakers: foam along each crest in the surf zone, trailing behind it
          float w = fract((1.5707963 - wavePhase(sp, uTime)) / 6.2831853);
          float crest = exp(-w * 9.0) * (0.55 + 0.45 * lace);
          float surf = smoothstep(2.0, 8.0, off) * (1.0 - smoothstep(30.0, 55.0, off));
          float bar = smoothstep(62.0, 72.0, off) * (1.0 - smoothstep(84.0, 100.0, off)) * 0.55;
          float foam = edge * 0.95 + crest * (surf + bar) + smoothstep(0.58, 0.82, lace) * surf * 0.5;
          foam *= mix(1.0, smoothstep(0.18, 0.55, fine * 0.6 + lace * 0.6), fadeD);
          foam = clamp(foam, 0.0, 1.0);
          col = mix(col, uFoam * (0.72 + 0.28 * max(dot(n, sunDir), 0.0)), foam);
        }
        ${fB}`
      )
  }
  return mat
}

/**
 * Wind and back-light for grass (near clumps and cards): a slow gust rolling
 * inland plus a flutter, stronger toward the tips; blades glow when you look
 * toward the sun through them. Normals are kept one-sided so both faces of a
 * blade shade alike.
 */
function grassPatch(mat, U) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime
    sh.uniforms.uSunDirW = U.uSunDirW
    sh.uniforms.uSunTint = U.uSunTint
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vTipF;')
      .replace(
        '#include <project_vertex>',
        `vTipF = clamp(position.y / 1.15, 0.0, 1.0);
        vec4 mvPosition = vec4(transformed, 1.0);
        vec2 root = vec2(0.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          root = instanceMatrix[3].xz;
        #endif
        float bend = vTipF * vTipF;
        float gust = sin(dot(root, vec2(0.045, 0.03)) - uTime * 1.3) * 0.5 + 0.5;
        gust *= gust;
        float flutter = sin(uTime * 3.1 + root.x * 1.7 + root.y * 1.3 + position.y * 2.0) * 0.06;
        float push = 0.1 + gust * 0.32;
        mvPosition.x += (push + flutter) * bend * 0.85;
        mvPosition.z += (push * 0.55 - flutter * 0.6) * bend;
        mvPosition.y -= push * push * bend * 0.35;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`
      )
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDirW;\nuniform vec3 uSunTint;\nvarying float vTipF;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 sunV = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
        float backLit = pow(max(dot(normalize(-vViewPosition), sunV), 0.0), 4.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSunTint * (backLit * 1.1 * (0.2 + vTipF) + 0.06);`
      )
  }
}

/* --- grass geometry ------------------------------------------------------------- */

/** One marram tussock, blade by blade: rolled leaves fanning out and a few plumed stalks. */
function tussockGeometry(THREE, rand) {
  const pos = []
  const nor = []
  const col = []
  const idx = []
  const up = new THREE.Vector3(0, 1, 0)
  const cBase = new THREE.Color(0x4f4826)
  const cMid = new THREE.Color(0x9a8448)
  const cTip = new THREE.Color(0xd8bd80)
  const cStalk = new THREE.Color(0xbfa66a)
  const cPlume = new THREE.Color(0xf2dfae)
  const tmp = new THREE.Color()
  const strip = (pts, widths, side, n, colors) => {
    const start = pos.length / 3
    pts.forEach((p, i) => {
      const w = widths[i] / 2
      pos.push(p.x - side.x * w, p.y - side.y * w, p.z - side.z * w, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w)
      nor.push(n.x, n.y, n.z, n.x, n.y, n.z)
      const c = colors[i]
      col.push(c.r, c.g, c.b, c.r, c.g, c.b)
      if (i < pts.length - 1) {
        const a = start + i * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    })
  }
  // leaves
  for (let b = 0; b < 6; b++) {
    const a = rand() * Math.PI * 2
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))
    const root = out.clone().multiplyScalar(rand() * 0.1)
    const h = range(rand, 0.55, 1.0)
    const lean = range(rand, 0.15, 0.6)
    const droop = range(rand, 0.05, 0.32)
    const pts = []
    const cols = []
    for (let i = 0; i <= 3; i++) {
      const t = i / 3
      pts.push(
        root
          .clone()
          .addScaledVector(out, Math.sin(lean) * h * t + droop * t * t * 0.6)
          .addScaledVector(up, Math.cos(lean) * h * t - droop * t * t * 0.5)
      )
      cols.push(t < 0.5 ? tmp.copy(cBase).lerp(cMid, t * 2).clone() : tmp.copy(cMid).lerp(cTip, t * 2 - 1).clone())
    }
    const n = up.clone().multiplyScalar(0.75).addScaledVector(out, 0.45).normalize()
    strip(pts, [0.045, 0.034, 0.02, 0.003], side, n, cols)
  }
  // plumed stalks, taller than the leaves
  for (let b = 0; b < 3; b++) {
    const a = rand() * Math.PI * 2
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))
    const root = out.clone().multiplyScalar(rand() * 0.06)
    const H = range(rand, 0.85, 1.15)
    const lean = range(rand, 0.05, 0.28)
    const dir = up.clone().multiplyScalar(Math.cos(lean)).addScaledVector(out, Math.sin(lean))
    const top = root.clone().addScaledVector(dir, H)
    const n = up.clone().multiplyScalar(0.8).addScaledVector(out, 0.35).normalize()
    strip([root, root.clone().addScaledVector(dir, H * 0.5), top], [0.012, 0.009, 0.006], side, n, [cBase, cStalk, cStalk])
    // the plume: a spindle, two crossed strips, nodding a little
    const pdir = dir.clone().addScaledVector(out, 0.35).normalize()
    const L = range(rand, 0.16, 0.26)
    const p1 = top.clone().addScaledVector(pdir, L * 0.5)
    const p2 = top.clone().addScaledVector(pdir, L)
    const side2 = new THREE.Vector3().crossVectors(pdir, side).normalize()
    for (const s of [side, side2]) strip([top, p1, p2], [0.008, 0.05, 0.004], s, n, [cStalk, cPlume, cPlume])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

/** Crossed vertical cards, `n` planes round the centre, carrying the painted grass texture. */
function cardGeometry(THREE, n, w, h) {
  const parts = []
  for (let i = 0; i < n; i++) {
    const p = new THREE.PlaneGeometry(w, h, 1, 2)
    p.translate(0, h / 2, 0)
    p.rotateY((i / n) * Math.PI)
    const nor = p.attributes.normal
    const ang = (i / n) * Math.PI
    // mostly up, a little toward the face: soft, even shading from all sides
    for (let k = 0; k < nor.count; k++) nor.setXYZ(k, Math.sin(ang) * 0.3, 0.92, Math.cos(ang) * 0.3)
    parts.push(p)
  }
  return mergeGeometries(parts, false)
}

/** A texture of a whole tussock: dozens of leaves, plumes on top, alpha-cut. */
function tussockTexture(THREE, seed) {
  const S = 512
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  const rand = seeded(seed)
  g.clearRect(0, 0, S, S)
  g.lineCap = 'round'
  // leaves: curved strokes from the base, darker low down, gold at the tips
  for (let i = 0; i < 110; i++) {
    const x0 = S * range(rand, 0.3, 0.7)
    const lean = range(rand, -0.45, 0.45)
    const h = S * range(rand, 0.45, 0.92)
    const x1 = x0 + lean * h + range(rand, -20, 20)
    const y1 = S - h
    const grd = g.createLinearGradient(0, S, 0, y1)
    const lift = range(rand, -18, 18)
    grd.addColorStop(0, `rgb(${70 + lift},${62 + lift},${32 + lift})`)
    grd.addColorStop(0.45, `rgb(${150 + lift},${128 + lift},${72 + lift})`)
    grd.addColorStop(1, `rgb(${222 + lift * 0.5},${196 + lift * 0.5},${136 + lift * 0.5})`)
    g.strokeStyle = grd
    const segs = 6
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs
      const t1 = (s + 1) / segs
      const bx = (t) => x0 + (x1 - x0) * t * t + lean * 10 * t
      const by = (t) => S - h * t
      g.lineWidth = Math.max(0.6, range(rand, 4.5, 7) * (1 - t0 * 0.85))
      g.beginPath()
      g.moveTo(bx(t0), by(t0))
      g.lineTo(bx(t1), by(t1))
      g.stroke()
    }
  }
  // plumes on thin stalks
  for (let i = 0; i < 18; i++) {
    const x0 = S * range(rand, 0.3, 0.7)
    const lean = range(rand, -0.25, 0.25)
    const h = S * range(rand, 0.72, 0.93)
    const tx = x0 + lean * h
    const ty = S - h
    g.strokeStyle = 'rgb(176,152,96)'
    g.lineWidth = 1.6
    g.beginPath()
    g.moveTo(x0, S)
    g.quadraticCurveTo(x0 + lean * h * 0.4, S - h * 0.5, tx, ty)
    g.stroke()
    for (let k = 0; k < 14; k++) {
      const t = k / 13
      const px = tx + lean * 40 * t
      const py = ty - t * 60
      g.fillStyle = `rgba(${236 + range(rand, -12, 12)},${214 + range(rand, -12, 12)},${160 + range(rand, -12, 12)},1)`
      g.beginPath()
      g.ellipse(px + range(rand, -3, 3), py, 5 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) + 1.2, 6, lean, 0, Math.PI * 2)
      g.fill()
    }
  }
  // copy into a texture, giving the transparent texels the grass colour so
  // filtering never pulls a dark fringe into the edges
  const img = g.getImageData(0, 0, S, S).data
  const out = new Uint8Array(S * S * 4)
  for (let y = 0; y < S; y++) {
    const sy = S - 1 - y
    for (let x = 0; x < S; x++) {
      const i = (sy * S + x) * 4
      const o = (y * S + x) * 4
      const a = img[i + 3]
      if (a < 8) {
        out[o] = 150
        out[o + 1] = 128
        out[o + 2] = 76
        out[o + 3] = 0
      } else {
        out[o] = img[i]
        out[o + 1] = img[i + 1]
        out[o + 2] = img[i + 2]
        out[o + 3] = a
      }
    }
  }
  const t = new THREE.DataTexture(out, S, S, THREE.RGBAFormat)
  t.colorSpace = THREE.SRGBColorSpace
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

/* --- the scene -------------------------------------------------------------------- */

export function buildCoast(THREE, ctx, { light = 'sunset' } = {}) {
  const sunset = light === 'sunset'
  const world = createWorld(THREE, ctx, light, {
    // low over the sea, a little to the left as you face the water
    sun: { elevation: sunset ? 6 : 11, azimuth: 206 },
    fog: { density: 0.0014 },
    sunColor: sunset ? 0xffc38c : 0xffd6a4,
    sunIntensity: sunset ? 2.5 : 2.3,
  })
  const { scene } = world
  const low = ctx.quality === 'low'
  const rand = seeded(2025)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  // low sun: keep the long grazing shadows clean
  world.sun.shadow.bias = -0.0005
  world.sun.shadow.normalBias = 0.09
  // the grass lives on the no-outline layer; let it cast shadows all the same
  world.sun.shadow.camera.layers.enable(NO_INK_LAYER)

  /* --- terrain ----------------------------------------------------------- */

  // one grid, fine (≈1 m) where the viewpoints are, stretching coarser to the haze
  const NX = low ? 170 : 300
  const NZ = low ? 150 : 260
  const geo = new THREE.PlaneGeometry(2, 2, NX, NZ)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const colors = new Float32Array(pos.count * 3)
  const wetA = new Float32Array(pos.count)
  const cSand = new THREE.Color(1, 0.99, 0.97)
  const cPath = new THREE.Color(1.06, 1.03, 0.99)
  const cGrass = new THREE.Color(0.46, 0.42, 0.26)
  const cGrassDark = new THREE.Color(0.27, 0.26, 0.16)
  const cShrub = new THREE.Color(0.25, 0.27, 0.17)
  const cWet = new THREE.Color(0.44, 0.4, 0.38)
  const cSoaked = new THREE.Color(0.33, 0.31, 0.3)
  const cWrack = new THREE.Color(0.55, 0.5, 0.44)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i)
    const v = pos.getZ(i)
    const x = 150 * u + 1050 * u * u * u
    const z = -90 + 170 * v + 760 * v * v * v
    const h = duneH(x, z)
    pos.setXYZ(i, x, h, z)
    uv.setXY(i, x / 4, z / 4)
    const shore = shoreZ(x)
    const g = grassiness(x, z)
    const n1 = fbm(x * 0.07 + 3, z * 0.07, 3)
    c.copy(cSand).multiplyScalar(0.94 + 0.12 * n1)
    if (Math.abs(x - pathX(z)) < 2.2 && z > footZ(x) - 4) c.lerp(cPath, 0.8)
    c.lerp(cGrass, smoothstep(0, 0.5, g) * 0.9)
    c.lerp(cGrassDark, smoothstep(0.45, 1, g) * (0.4 + 0.5 * n1))
    c.lerp(cShrub, shrubbiness(x, z) * 0.85)
    // the tide line: a dark ribbon of shells and weed
    const tl = z - (shore + 34 + 3 * Math.sin(x * 0.05))
    c.lerp(cWrack, Math.exp(-tl * tl * 0.6) * (0.4 + 0.6 * fbm(x * 0.4, z * 0.4, 2)))
    // wet sand toward the water, soaked and mirror-smooth at the swash
    const wet = smoothstep(shore + 24, shore + 6, z)
    const soaked = smoothstep(shore + 7, shore + 1, z)
    c.lerp(cWet, wet * 0.9).lerp(cSoaked, soaked)
    wetA[i] = Math.min(1, wet * 0.65 + soaked * 0.35)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('aWet', new THREE.BufferAttribute(wetA, 1))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  const sandMat = M.sand(THREE, { color: '#d8c19c', tile: 4, quality: ctx.quality, seed: 61 })
  sandMat.vertexColors = true
  sandMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWet;\nvarying float vWet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWet = aWet;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWet;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.06, vWet);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, normalize(vNormal), vWet * 0.85));')
  }
  const terrain = new THREE.Mesh(geo, sandMat)
  terrain.receiveShadow = true
  terrain.castShadow = true
  scene.add(terrain)

  /* --- the sea ------------------------------------------------------------- */

  const seaMat = surfPatch(
    THREE,
    waterMaterial(THREE, {
      palette: { ...world.light, water: { deep: 0x4b5961, shallow: 0x7a8887, stroke: 0xf1e7dd } },
      scale: 1,
    })
  )
  // near the beach: dense enough for the swell to roll the surface
  const SX = low ? 120 : 220
  const SZ = low ? 60 : 110
  const nearGeo = new THREE.PlaneGeometry(2, 2, SX, SZ)
  nearGeo.rotateX(-Math.PI / 2)
  {
    const p = nearGeo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i)
      const v = p.getZ(i) // −1 … 1
      // keep x and z increasing with the grid so the triangles still face up
      p.setXYZ(i, 150 * u + 1050 * u * u * u, 0, -340 + (v * 0.5 + 0.5) * 164)
    }
    nearGeo.computeBoundingSphere()
  }
  const seaNear = new THREE.Mesh(nearGeo, seaMat)
  scene.add(seaNear)
  const seaFar = new THREE.Mesh(new THREE.PlaneGeometry(18000, 8700), seaMat)
  seaFar.rotation.x = -Math.PI / 2
  seaFar.position.set(0, -0.05, -320 - 4350)
  scene.add(seaFar)

  /* --- marram grass -------------------------------------------------------- */

  const windU = {
    uTime: { value: 0 },
    uSunDirW: { value: world.sunDir.clone() },
    uSunTint: { value: new THREE.Color(world.light.sunColor).multiplyScalar(0.95) },
  }
  const bladeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide })
  grassPatch(bladeMat, windU)
  const cardTex = tussockTexture(THREE, 77)
  const cardMat = new THREE.MeshStandardMaterial({ map: cardTex, alphaTest: 0.42, roughness: 0.8, metalness: 0, side: THREE.DoubleSide })
  grassPatch(cardMat, windU)
  const cardDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: cardTex, alphaTest: 0.42 })

  // the viewpoints in the dunes (x, z): blade-level grass grows densest round these
  const duneSpots = [
    [12, -88],
    [pathX(-80), -80],
    [25, -45],
    [-40, -90],
    [60, crestZ(60)],
  ]
  const nearestSpot = (x, z) => {
    let best = 1e9
    for (const [sx, sz] of duneSpots) best = Math.min(best, Math.hypot(x - sx, z - sz))
    return best
  }
  const NEAR_R = 17
  const MID_R = 70
  const near = []
  const mid = []
  const far = []
  const kq = low ? 0.45 : 1
  for (const [sx, sz] of duneSpots) {
    // thickest right round the camera: the grass you look through
    const nC = Math.round(Math.PI * 49 * 1.4 * kq)
    for (let i = 0; i < nC; i++) {
      const r = 7 * Math.sqrt(rand())
      const a = rand() * Math.PI * 2
      const x = sx + Math.cos(a) * r
      const z = sz + Math.sin(a) * r
      if (r < 1.3 || rand() > grassiness(x, z)) continue
      near.push([x, z])
    }
    const nN = Math.round(Math.PI * NEAR_R * NEAR_R * 0.9 * kq)
    for (let i = 0; i < nN; i++) {
      const r = NEAR_R * Math.sqrt(rand())
      const a = rand() * Math.PI * 2
      const x = sx + Math.cos(a) * r
      const z = sz + Math.sin(a) * r
      if (r < 1.3) continue // not right on the lens
      if (rand() > grassiness(x, z)) continue
      near.push([x, z])
    }
    const nM = Math.round(Math.PI * (MID_R * MID_R - NEAR_R * NEAR_R) * 0.42 * kq)
    for (let i = 0; i < nM; i++) {
      const r = Math.sqrt(NEAR_R * NEAR_R + rand() * (MID_R * MID_R - NEAR_R * NEAR_R))
      const a = rand() * Math.PI * 2
      const x = sx + Math.cos(a) * r
      const z = sz + Math.sin(a) * r
      if (nearestSpot(x, z) < NEAR_R - 1) continue
      if (rand() > grassiness(x, z)) continue
      mid.push([x, z])
    }
  }
  // the foredune's sea face, seen from the beach: mid detail along it
  for (let i = 0, n = Math.round(9000 * kq); i < n; i++) {
    const x = range(rand, -260, 260)
    const z = footZ(x) + range(rand, 0, 30)
    if (nearestSpot(x, z) < MID_R) continue
    if (rand() > grassiness(x, z)) continue
    mid.push([x, z])
  }
  // and sparse big tussocks out to the haze
  for (let i = 0, n = Math.round(30000 * kq); i < n; i++) {
    const x = range(rand, -650, 650)
    const z = range(rand, -125, 520)
    if (nearestSpot(x, z) < MID_R - 6) continue
    if (z < footZ(x) + 30 && Math.abs(x) < 262) continue
    if (rand() > grassiness(x, z)) continue
    far.push([x, z])
  }

  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const sc = new THREE.Vector3()
  const p3 = new THREE.Vector3()
  const gold = [0xffffff, 0xf2e6cc, 0xe6d6b0, 0xfff4dc, 0xd9c79f, 0xf8ecd2]
  const plant = (mesh, list, { sMin, sMax, tilt, castShadow }) => {
    list.forEach(([x, z], i) => {
      p3.set(x, duneH(x, z) - 0.06, z)
      e.set(range(rand, -tilt, tilt), rand() * Math.PI * 2, range(rand, -tilt, tilt))
      q.setFromEuler(e)
      const s = range(rand, sMin, sMax)
      sc.set(s * range(rand, 0.85, 1.2), s * range(rand, 0.85, 1.15), s * range(rand, 0.85, 1.2))
      m4.compose(p3, q, sc)
      mesh.setMatrixAt(i, m4)
      c.setHex(gold[Math.floor(rand() * gold.length)]).multiplyScalar(range(rand, 0.85, 1.05))
      mesh.setColorAt(i, c)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    mesh.layers.set(NO_INK_LAYER)
    scene.add(mesh)
    return mesh
  }
  // two tussock shapes, alternating
  const tussocks = [tussockGeometry(THREE, seeded(11)), tussockGeometry(THREE, seeded(29))]
  const nearA = near.filter((_, i) => i % 2 === 0)
  const nearB = near.filter((_, i) => i % 2 === 1)
  if (nearA.length) plant(new THREE.InstancedMesh(tussocks[0], bladeMat, nearA.length), nearA, { sMin: 0.85, sMax: 1.25, tilt: 0.12, castShadow: true })
  if (nearB.length) plant(new THREE.InstancedMesh(tussocks[1], bladeMat, nearB.length), nearB, { sMin: 0.85, sMax: 1.25, tilt: 0.12, castShadow: true })
  if (mid.length) {
    const mesh = plant(new THREE.InstancedMesh(cardGeometry(THREE, 3, 1.25, 1.05), cardMat, mid.length), mid, { sMin: 0.8, sMax: 1.25, tilt: 0.08, castShadow: true })
    mesh.customDepthMaterial = cardDepth
  }
  if (far.length) {
    const mesh = plant(new THREE.InstancedMesh(cardGeometry(THREE, 2, 1.6, 1.15), cardMat, far.length), far, { sMin: 0.9, sMax: 1.4, tilt: 0.06, castShadow: false })
    mesh.customDepthMaterial = cardDepth
  }

  /* --- sea buckthorn thickets ------------------------------------------------ */

  {
    let g = new THREE.IcosahedronGeometry(1, 2)
    g.deleteAttribute('normal')
    g.deleteAttribute('uv')
    g = mergeVertices(g)
    const p = g.attributes.position
    const v = new THREE.Vector3()
    const uvs = new Float32Array(p.count * 2)
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
      const k = 0.78 + 0.38 * fbm(v.x * 1.6 + 4, v.z * 1.6 + v.y * 1.3, 3)
      v.multiplyScalar(k)
      v.y = Math.max(v.y, -0.2) * 0.62
      p.setXYZ(i, v.x, v.y + 0.12, v.z)
      uvs[i * 2] = 0.5 + Math.atan2(v.z, v.x) / (2 * Math.PI)
      uvs[i * 2 + 1] = v.y * 0.5 + 0.5
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    g.computeVertexNormals()
    const leafy = noiseNormalMap(THREE, 256, { cells: 36, strength: 4, octaves: 3 })
    leafy.repeat.set(5, 3)
    const shrubMat = new THREE.MeshStandardMaterial({ color: 0x55603a, roughness: 0.92, metalness: 0, normalMap: leafy, normalScale: new THREE.Vector2(1.4, 1.4) })
    const spots = []
    for (let i = 0, n = low ? 2500 : 6000; i < n && spots.length < (low ? 90 : 190); i++) {
      const x = range(rand, -220, 220)
      const z = range(rand, -70, 260)
      if (rand() > shrubbiness(x, z)) continue
      if (nearestSpot(x, z) < 6) continue
      spots.push([x, z])
    }
    if (spots.length) {
      const shrubs = new THREE.InstancedMesh(g, shrubMat, spots.length)
      spots.forEach(([x, z], i) => {
        const s = range(rand, 0.9, 2.4)
        q.setFromAxisAngle(V(0, 1, 0), rand() * Math.PI * 2)
        m4.compose(V(x, duneH(x, z) - 0.15, z), q, V(s * range(rand, 0.9, 1.5), s * range(rand, 0.7, 1.1), s))
        shrubs.setMatrixAt(i, m4)
        c.setHex(rand() < 0.4 ? 0x8a8a62 : 0x6e7448).multiplyScalar(range(rand, 0.8, 1.1))
        shrubs.setColorAt(i, c)
      })
      shrubs.instanceMatrix.needsUpdate = true
      if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true
      shrubs.castShadow = shrubs.receiveShadow = true
      scene.add(shrubs)
    }
  }

  /* --- brushwood sand fences along the dune foot ------------------------------- */

  const woodMat = M.planks(THREE, { color: '#8d7a63', width: 0.16, tile: 2, quality: ctx.quality, seed: 71 })
  {
    const sticks = []
    for (let x = -240; x < 240; x += range(rand, 7, 12)) {
      if (Math.abs(x - pathX(footZ(x))) < 8) continue
      // short runs set at an angle to the beach, the classic herringbone of stuifschermen
      const len = range(rand, 3, 6)
      const ang = rand() < 0.5 ? 0.5 : -0.5
      const z0 = footZ(x) + range(rand, 1, 6)
      for (let t = 0; t < len; t += 0.11) {
        const sx = x + Math.cos(ang) * t + range(rand, -0.03, 0.03)
        const sz = z0 + Math.sin(ang) * t + range(rand, -0.03, 0.03)
        sticks.push([sx, sz, range(rand, 0.6, 1.1), range(rand, -0.12, 0.12)])
      }
    }
    const stickGeo = new THREE.CylinderGeometry(0.018, 0.026, 1, 4, 1, true).translate(0, 0.5, 0)
    const fence = new THREE.InstancedMesh(stickGeo, new THREE.MeshStandardMaterial({ color: 0x7a6650, roughness: 1 }), sticks.length)
    sticks.forEach(([x, z, h, lean], i) => {
      e.set(lean, rand() * 3, lean * 0.5)
      q.setFromEuler(e)
      m4.compose(V(x, duneH(x, z) - 0.25, z), q, V(1, h, 1))
      fence.setMatrixAt(i, m4)
    })
    fence.instanceMatrix.needsUpdate = true
    fence.castShadow = true
    scene.add(fence)
  }

  /* --- beach poles (strandpalen) -------------------------------------------- */

  const numberBoard = (label) =>
    paintTexture(
      THREE,
      128,
      160,
      (g, w, h) => {
        g.fillStyle = '#f1efe8'
        g.fillRect(0, 0, w, h)
        g.strokeStyle = '#1d1d1d'
        g.lineWidth = 6
        g.strokeRect(4, 4, w - 8, h - 8)
        g.fillStyle = '#1b1b1b'
        g.font = 'bold 72px sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(label, w / 2, h / 2 + 4)
      },
      { kind: 'color' }
    )
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.9, normalMap: noiseNormalMap(THREE, 128, { cells: 6, strength: 3, octaves: 3, stretch: [1, 6] }) })
  const capMat = new THREE.MeshStandardMaterial({ color: 0xa8281e, roughness: 0.6 })
  const strandpaal = (x, z, label) => {
    const gY = duneH(x, z)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 4.2, 14).translate(0, 2.1, 0), poleMat)
    pole.position.set(x, gY - 0.5, z)
    pole.castShadow = true
    scene.add(pole)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.5, 14), capMat)
    cap.position.set(x, gY + 3.45, z)
    scene.add(cap)
    const boardMat = new THREE.MeshStandardMaterial({ map: numberBoard(label), roughness: 0.6 })
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.04), [poleMat, poleMat, poleMat, poleMat, boardMat, boardMat])
    board.position.set(x, gY + 2.75, z - 0.17)
    board.castShadow = true
    scene.add(board)
  }
  strandpaal(-24, -134, '58')
  strandpaal(980, -133, '59')

  /* --- a beach pavilion on stilts, down the beach ------------------------------ */

  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x1d252b, roughness: 0.06, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.3 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c2a27, roughness: 0.7 })
  function pavilion(cx, cz, w = 26, d = 13) {
    const g = new THREE.Group()
    const gy = bedY(cx, cz)
    const deckY = gy + 1.8
    // piles
    const pileGeo = new THREE.CylinderGeometry(0.16, 0.16, deckY - gy + 0.5, 8).translate(0, (deckY - gy + 0.5) / 2 - 0.5, 0)
    const piles = new THREE.InstancedMesh(pileGeo, woodMat, 24)
    let k = 0
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 4; j++) {
        m4.makeTranslation(-w / 2 + 1 + (i * (w - 2)) / 5, gy - deckY, -d / 2 - 4 + 0.6 + (j * (d + 3.8)) / 3)
        piles.setMatrixAt(k++, m4)
      }
    }
    piles.castShadow = true
    g.add(piles)
    // deck with the terrace on the sea side (−z)
    const deck = M.box(THREE, w, 0.3, d + 5, woodMat, [2, 2])
    deck.position.set(0, -0.3, -2.5)
    g.add(deck)
    // the building: vertical boarding, glass to the sea, a flat roof overhanging
    const body = M.box(THREE, w - 2, 3.6, d - 2, woodMat, [2, 2])
    body.position.set(0, 0, 1)
    g.add(body)
    const glazing = new THREE.Mesh(new THREE.BoxGeometry(w - 3, 2.7, 0.06), glassMat)
    glazing.position.set(0, 1.55, 1 - (d - 2) / 2 - 0.02)
    g.add(glazing)
    const roofSlab = M.box(THREE, w + 1, 0.35, d + 1.5, darkMat, [2, 2])
    roofSlab.position.set(0, 3.6, 0.2)
    g.add(roofSlab)
    // railing and flags
    const rails = beamBatch(THREE)
    const zf = -2.5 - (d + 5) / 2 + 0.1
    rails.add(V(-w / 2, 1.0, zf), V(w / 2, 1.0, zf), 0.07)
    for (let x = -w / 2; x <= w / 2 + 0.01; x += 1.3) rails.add(V(x, 0, zf), V(x, 1.0, zf), 0.05)
    for (let i = 0; i < 3; i++) rails.add(V(-w / 2 + 3 + i * 3, 0, zf + 0.3), V(-w / 2 + 3 + i * 3, 8, zf + 0.3), 0.07)
    g.add(rails.build(new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.5, metalness: 0.4 })))
    const flagCols = [0xd23b2a, 0x2a4f9a, 0xf0c23a]
    for (let i = 0; i < 3; i++) {
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0, 4, 1), new THREE.MeshStandardMaterial({ color: flagCols[i], roughness: 0.8, side: THREE.DoubleSide }))
      flag.position.set(-w / 2 + 3 + i * 3 + 0.8, 7.4, zf + 0.3)
      flag.rotation.y = 0.4
      g.add(flag)
    }
    g.position.set(cx, deckY, cz)
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true
    })
    scene.add(g)
  }
  pavilion(240, footZ(240) - 9)
  pavilion(-560, footZ(-560) - 9)

  /* --- far out on the water: ships, sails, a wind farm in the haze ------------ */

  {
    // seen through kilometres of air: drawn in the haze's own colour, darker
    // or lighter by how much they stand out, without the fog that would erase them
    const haze = new THREE.Color(world.light.sky.horizon)
    const tone = (k) => new THREE.MeshBasicMaterial({ color: haze.clone().multiplyScalar(k), fog: false })
    const hullMat = tone(0.72)
    const deckMat = tone(0.8)
    const lightMat = tone(1.04)
    const ship = (x, z, len, ry) => {
      const s = new THREE.Group()
      const hull = new THREE.Mesh(new THREE.BoxGeometry(len, len * 0.07, len * 0.13), hullMat)
      hull.position.y = len * 0.03
      s.add(hull)
      const stack = new THREE.Mesh(new THREE.BoxGeometry(len * 0.62, len * 0.06, len * 0.12), deckMat)
      stack.position.set(-len * 0.05, len * 0.09, 0)
      s.add(stack)
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(len * 0.07, len * 0.14, len * 0.12), lightMat)
      bridge.position.set(len * 0.36, len * 0.13, 0)
      s.add(bridge)
      s.position.set(x, 0, z)
      s.rotation.y = ry
      scene.add(s)
    }
    ship(-1500, -4200, 210, 0.05)
    ship(900, -5600, 260, -0.03)
    ship(2600, -3600, 160, 0.1)
    // small yachts closer in, sails lit by the low sun
    const sailMat = tone(1.12)
    for (const [x, z] of [
      [420, -1300],
      [520, -1450],
    ]) {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 2.6), hullMat)
      hull.position.set(x, 0.4, z)
      scene.add(hull)
      const shape = new THREE.Shape()
      shape.moveTo(0, 0)
      shape.lineTo(3.8, 0)
      shape.lineTo(0, 11)
      shape.closePath()
      const sail = new THREE.Mesh(new THREE.ShapeGeometry(shape), sailMat)
      sail.material.side = THREE.DoubleSide
      sail.position.set(x - 1.5, 1.2, z)
      sail.rotation.y = 0.5
      scene.add(sail)
    }
  }
  const turbine = { rotors: null, list: [] }
  {
    const haze = new THREE.Color(world.light.sky.horizon)
    const tMat = new THREE.MeshBasicMaterial({ color: haze.clone().multiplyScalar(0.9), fog: false })
    const spots = []
    for (let i = 0; i < 14; i++) spots.push([-3800 + i * 380 + range(rand, -60, 60), -6800 + range(rand, -500, 500)])
    const towers = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.6, 2.6, 110, 6).translate(0, 55, 0), tMat, spots.length)
    const blades = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 62, 0.6).translate(0, 31, 0), tMat, spots.length * 3)
    spots.forEach(([x, z], i) => {
      m4.makeTranslation(x, 0, z)
      towers.setMatrixAt(i, m4)
      turbine.list.push({ x, z, phase: rand() * 6 })
    })
    turbine.rotors = blades
    const tick = (t) => {
      turbine.list.forEach((tb, i) => {
        for (let b = 0; b < 3; b++) {
          q.setFromAxisAngle(V(0, 0, 1), tb.phase + t * 1.1 + (b * Math.PI * 2) / 3)
          m4.compose(V(tb.x, 110, tb.z + 3), q, V(1, 1, 1))
          blades.setMatrixAt(i * 3 + b, m4)
        }
      })
      blades.instanceMatrix.needsUpdate = true
    }
    tick(0)
    turbine.tick = tick
    towers.frustumCulled = blades.frustumCulled = false
    scene.add(towers, blades)
  }

  /* --- the views ------------------------------------------------------------------ */

  const at = (x, z, eye) => V(x, duneH(x, z) + eye, z)
  const s0 = at(12, -88, 1.65)
  const spots = [
    // the hero: on the foredune plateau in the grass, the sea beyond, the sun low on the left
    { pos: s0, look: V(26, s0.y - 9, -400) },
    // down the path into the notch, the sea framed by the dune shoulders
    { pos: at(pathX(-74), -74, 1.7), look: V(pathX(-160) - 4, 2.2, -260) },
    // in the tall grass on a dune slope, across the rolling dunes, sun from behind-left
    { pos: at(25, -45, 1.6), look: V(150, 9, -20) },
    // from the plateau, inland over the dunes and thickets, long shadows ahead
    { pos: at(-40, -90, 1.7), look: V(-10, 6, 120) },
    // up on the foredune crest: the beach and the sea along the coast
    { pos: at(60, crestZ(60), 4.5), look: V(-120, 0.5, -175) },
    // down on the beach at the foot of the path, toward the sea and the sun
    { pos: at(-6, -150, 1.7), look: V(-60, 1.5, -420) },
    // at the water's edge, the wet sand mirroring the sky, along the surf
    { pos: at(22, shoreZ(22) + 4.5, 1.6), look: V(-160, 0.8, -300) },
    // from near the water back up at the dunes, the beach pole and the pavilion
    { pos: at(-48, shoreZ(-48) + 9, 1.7), look: V(10, 7, -100) },
  ]
  world.focusShadows(V(8, 6, -112), 95)

  const path = {
    positions: [V(70, 110, 380), V(30, 62, 200), V(16, 34, 40), V(14, 22, -40), s0.clone()],
    targets: [V(0, 0, -150), V(0, 4, -260), V(10, 6, -320), V(20, 8, -380), spots[0].look.clone()],
    fov: 52,
    near: 0.3,
    spots,
  }

  let t0 = null
  return {
    scene,
    world,
    path,
    // the camera keeps above the sand (and never dips under the sea)
    groundAt: (x, z) => Math.max(duneH(x, z), 0.3),
    clearance: 1.25,
    update(t) {
      if (t0 === null) t0 = t
      const tt = t - t0
      windU.uTime.value = tt
      seaMat.userData.tick(tt)
      turbine.tick(tt)
    },
  }
}
