/**
 * Paris — the Trocadéro on a soft, overcast morning.
 *
 * The Eiffel Tower is a real lattice (four curved legs of square lattice
 * tubes merging into one shaft, the great arches, platforms with their
 * frieze) in "Eiffel Tower brown". Across the Seine: the Pont d'Iéna on five
 * stone arches, the Trocadéro gardens with the long Varsovie basin and its
 * water cannons, the terrace and the great lateral flights of stairs with
 * their solid stone parapets (where Evan & Inez were photographed), the
 * parvis and the two curved colonnaded wings of the Palais de Chaillot.
 * Around it: Haussmann blocks (limestone, wrought-iron balconies on the 2nd
 * and 5th floors, zinc mansards, chimneys), streets with kerbs, lamps,
 * parked cars and café awnings, plane trees, the Champ de Mars.
 *
 * Metres. The tower stands at the origin; the Trocadéro is toward +Z, the
 * Seine runs along X between z = 180 and z = 290.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createWorld, waterMaterial } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { beamBatch, paintTexture, seeded, range, pick, noiseNormalMap } from '../utils.js'
import { NO_INK_LAYER } from '../post.js'

/* --- levels of the site ------------------------------------------------ */

const RIVER_S = 180 // south quay wall (tower side)
const RIVER_N = 290 // north quay wall (Trocadéro side)
const WATER_Y = -5
const BERGE_Y = -3.6 // the low quays along the water
const PARVIS_Y = 20
const TERRACE_Y = 12
const FLIGHT = { x0: 55, x1: 77.5, z0: 686, z1: 712 } // lateral flights (mirrored in x)
const GARDEN_TOP = 600 // terrace balustrade
const GARDEN_FOOT = 520 // bottom of the sloped lawns
const STREET_Z = -60 // the Haussmann street west of the Champ de Mars
const STREET_HALF = 12 // facade to facade 24 m

/* --- small helpers -------------------------------------------------------- */

/**
 * Weathering for stone (and lawns): large honey/cream patches in world space,
 * so neighbouring blocks never share one flat tone, and dark rain streaks
 * running down vertical faces only. Uniform-free, patched into the standard
 * shader once per material.
 */
const WEATHER_GLSL = /* glsl */ `
  varying vec3 vWPos;
  float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float wNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`
function weather(mat, { mottle = 0.14, warm = 0.08, streaks = 0.2, key = 'stone' } = {}) {
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
        float big = wNoise(q * 0.031) * 0.6 + wNoise(q * 0.13 + 7.0) * 0.4;
        float fine = wNoise(q * 0.9 + vec2(0.0, vWPos.y * 0.9));
        vec3 c = diffuseColor.rgb;
        c *= 1.0 + (big - 0.5) * ${f(mottle)} + (fine - 0.5) * ${f(mottle * 0.35)};
        // warmer honey where the stone has been in the sun, cooler cream elsewhere
        c *= mix(vec3(1.0 - ${f(warm * 0.4)}, 1.0, 1.0 + ${f(warm * 0.5)}), vec3(1.0 + ${f(warm)}, 1.0 + ${f(warm * 0.25)}, 1.0 - ${f(warm * 1.4)}), big);
        // rain streaks down the walls: thin, long, darker and a little grey-brown
        float s = wNoise(vec2((vWPos.x + vWPos.z) * 1.1, vWPos.y * 0.05 + (vWPos.x - vWPos.z) * 0.013));
        float streak = smoothstep(0.6, 0.95, s) * vert * ${f(streaks)};
        c = mix(c, c * vec3(0.78, 0.76, 0.74), streak);
        diffuseColor.rgb = c;
      }`
    )
  }
  mat.customProgramCacheKey = () => 'paris-weather-' + key
  mat.needsUpdate = true
  return mat
}

function uvScale(geo, s) {
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s)
  uv.needsUpdate = true
  return geo
}

/** A profile (shape in the z–y plane: shape x → world z) extruded along world x, centred on x = 0. */
function extrudeAlongX(THREE, shape, width, tile, curveSegments = 16) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments })
  geo.rotateY(-Math.PI / 2) // shape x → world z, extrusion → world −x
  geo.translate(width / 2, 0, 0)
  return uvScale(geo, 1 / tile)
}

/** Collect geometries per material, merge them into one mesh each. */
function batcher(THREE, scene) {
  const lists = new Map()
  return {
    add(material, geo) {
      if (!lists.has(material)) lists.set(material, [])
      lists.get(material).push(geo.index ? geo.toNonIndexed() : geo)
    },
    /** A materials.js box (UVs in metres), placed. */
    box(material, tile, w, h, d, x, y, z, ry = 0) {
      const g = M.box(THREE, w, h, d, material, tile).geometry
      if (ry) g.rotateY(ry)
      g.translate(x, y, z)
      this.add(material, g)
    },
    flush({ shadow = true } = {}) {
      lists.forEach((geos, mat) => {
        const keep = geos.map((g) => {
          // ExtrudeGeometry has groups and no index; strip groups so merging is clean
          g.clearGroups()
          for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k)
          return g
        })
        const mesh = new THREE.Mesh(mergeGeometries(keep, false), mat)
        mesh.castShadow = shadow
        mesh.receiveShadow = true
        scene.add(mesh)
      })
      lists.clear()
    },
  }
}

/* --- parked cars ------------------------------------------------------------ */

function addCars(THREE, scene, spots, seed) {
  if (!spots.length) return
  const rand = seeded(seed)
  const body = new RoundedBoxGeometry(4.3, 0.75, 1.78, 2, 0.22).translate(0, 0.62, 0)
  const cabin = new RoundedBoxGeometry(2.35, 0.62, 1.6, 2, 0.18).translate(-0.25, 1.28, 0)
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10).rotateX(Math.PI / 2)
  const wheels = mergeGeometries(
    [
      [1.38, 0.82],
      [1.38, -0.82],
      [-1.32, 0.82],
      [-1.32, -0.82],
    ].map(([x, z]) => wheel.clone().translate(x, 0.33, z)),
    false
  )
  const paint = new THREE.MeshPhysicalMaterial({ roughness: 0.32, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08 })
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x15191d, roughness: 0.05, metalness: 0.6, clearcoat: 1 })
  const tyre = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.85 })
  const mBody = new THREE.InstancedMesh(body, paint, spots.length)
  const mCab = new THREE.InstancedMesh(cabin, glass, spots.length)
  const mWheel = new THREE.InstancedMesh(wheels, tyre, spots.length)
  const cols = [0x1c1d20, 0xeceae4, 0x9aa0a6, 0x1f4f96, 0xa3161f, 0xf4f3ee, 0x2d3036, 0x5e6a74, 0x1d5a48, 0xc8b27a, 0x0f2c5c, 0xb8432a]
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const c = new THREE.Color()
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry || 0)
    const k = range(rand, 0.9, 1.08)
    m.compose(new THREE.Vector3(s.x, s.y || 0, s.z), q, new THREE.Vector3(k, 1, 1))
    mBody.setMatrixAt(i, m)
    mCab.setMatrixAt(i, m)
    mWheel.setMatrixAt(i, m)
    mBody.setColorAt(i, c.setHex(pick(rand, cols)))
  })
  for (const mesh of [mBody, mCab, mWheel]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
  }
}

/* --- Paris lamps: cast-iron candelabra with a lantern ------------------------- */

function addParisLamps(THREE, scene, spots, { double = false } = {}) {
  if (!spots.length) return
  const parts = [
    new THREE.CylinderGeometry(0.2, 0.26, 0.9, 10).translate(0, 0.45, 0), // fluted base
    new THREE.CylinderGeometry(0.07, 0.11, 3.6, 8).translate(0, 2.6, 0),
    new THREE.SphereGeometry(0.13, 8, 6).translate(0, 4.45, 0),
  ]
  const lanterns = []
  const arms = double ? [-0.55, 0.55] : [0]
  for (const ax of arms) {
    if (double) parts.push(new THREE.BoxGeometry(Math.abs(ax) + 0.05, 0.06, 0.06).translate(ax / 2, 4.5, 0))
    parts.push(new THREE.CylinderGeometry(0.3, 0.12, 0.12, 6).translate(ax, 4.62, 0)) // lantern floor
    parts.push(new THREE.ConeGeometry(0.34, 0.32, 6).translate(ax, 5.38, 0)) // roof
    parts.push(new THREE.SphereGeometry(0.06, 6, 4).translate(ax, 5.6, 0))
    lanterns.push(new THREE.CylinderGeometry(0.29, 0.2, 0.62, 6, 1, true).translate(ax, 4.98, 0))
  }
  const iron = new THREE.MeshStandardMaterial({ color: 0x1e2321, roughness: 0.45, metalness: 0.6 })
  const glass = new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.15, metalness: 0.2, emissive: 0xffe2b0, emissiveIntensity: 0.15, side: THREE.DoubleSide })
  const post = new THREE.InstancedMesh(mergeGeometries(parts.map((g) => g.toNonIndexed()), false), iron, spots.length)
  const lan = new THREE.InstancedMesh(mergeGeometries(lanterns, false), glass, spots.length)
  const m = new THREE.Matrix4()
  spots.forEach((s, i) => {
    m.makeRotationY(s.ry || 0).setPosition(s.x, s.y || 0, s.z)
    post.setMatrixAt(i, m)
    lan.setMatrixAt(i, m)
  })
  post.castShadow = true
  scene.add(post, lan)
}

/* --- the tower --------------------------------------------------------- */

// Half-width of the tower at height h: the legs' outer edge, and the inner
// edge of the legs (the arch opening between them closes at the 2nd floor).
const outer = (h) => (h <= 276 ? 62.5 * Math.exp(-h / 95) + 2 : Math.max(1.4, 5.4 - (h - 276) * 0.12))
const inner = (h) => (h < 115 ? 37.5 * Math.pow(1 - h / 115, 1.35) : 0)

function towerLevels() {
  const hs = []
  for (let i = 0; i < 15; i++) hs.push(i * 3.84) // 0 → 53.8
  hs.push(57.6)
  for (let i = 1; i < 13; i++) hs.push(57.6 + i * 4.8) // → 115.2
  for (let i = 0; i < 27; i++) hs.push(115.7 + i * 6) // → 271.7
  hs.push(276, 286, 296, 304)
  return hs
}

/** The frieze of small arches round each platform. */
function friezeTexture(THREE) {
  return paintTexture(
    THREE,
    512,
    128,
    (g, w, h) => {
      g.fillStyle = '#8c6445'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#a87e55'
      g.fillRect(0, 0, w, 12)
      g.fillStyle = '#5a3d27'
      g.fillRect(0, 12, w, 4)
      g.fillRect(0, h - 10, w, 10)
      const n = 8
      for (let i = 0; i < n; i++) {
        const cx = (i + 0.5) * (w / n)
        const r = w / n / 2 - 7
        g.fillStyle = '#2a1c12'
        g.beginPath()
        g.moveTo(cx - r, h - 14)
        g.lineTo(cx - r, 50)
        g.arc(cx, 50, r, Math.PI, 0)
        g.lineTo(cx + r, h - 14)
        g.closePath()
        g.fill()
        g.strokeStyle = 'rgba(176,130,88,0.65)'
        g.lineWidth = 2
        g.beginPath()
        g.moveTo(cx - r, h - 14)
        g.lineTo(cx + r, 50)
        g.moveTo(cx + r, h - 14)
        g.lineTo(cx - r, 50)
        g.moveTo(cx, 50 - r)
        g.lineTo(cx, h - 14)
        g.stroke()
      }
    },
    { kind: 'color' }
  )
}

function buildEiffel(THREE, { low = false } = {}) {
  const group = new THREE.Group()
  // "Eiffel Tower brown": a warm bronze-brown paint with a soft satin sheen
  // (low metalness, so the blue sky doesn't wash the colour out of it)
  const iron = new THREE.MeshStandardMaterial({ color: 0x7e5c3d, roughness: 0.5, metalness: 0.2, envMapIntensity: 0.8 })
  const beams = beamBatch(THREE)
  const P = (x, y, z) => new THREE.Vector3(x, y, z)
  const levels = towerLevels()
  const panel = low ? 6 : 3.4 // metres per lattice bay

  // one lattice side between two corner rails: X-bracing, verticals, a strut, a girder on top
  function side(a0, b0, a1, b1, h0, h1, heavy) {
    const w = (Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) + Math.hypot(b1[0] - a1[0], b1[1] - a1[1])) / 2
    const n = Math.max(1, Math.min(12, Math.round(w / panel)))
    const at = (p, r, t) => [p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t]
    for (let i = 0; i < n; i++) {
      const l0 = at(a0, b0, i / n)
      const r0 = at(a0, b0, (i + 1) / n)
      const l1 = at(a1, b1, i / n)
      const r1 = at(a1, b1, (i + 1) / n)
      const d = heavy ? 0.3 : 0.22
      beams.add(P(l0[0], h0, l0[1]), P(r1[0], h1, r1[1]), d)
      beams.add(P(r0[0], h0, r0[1]), P(l1[0], h1, l1[1]), d)
      if (i > 0) beams.add(P(l0[0], h0, l0[1]), P(l1[0], h1, l1[1]), heavy ? 0.34 : 0.26)
    }
    if (!low && h1 - h0 > 4.5) {
      const m0 = at(a0, a1, 0.5)
      const m1 = at(b0, b1, 0.5)
      beams.add(P(m0[0], (h0 + h1) / 2, m0[1]), P(m1[0], (h0 + h1) / 2, m1[1]), 0.18)
    }
    beams.add(P(a1[0], h1, a1[1]), P(b1[0], h1, b1[1]), heavy ? 0.55 : 0.4, heavy ? 0.9 : 0.55)
  }

  function tube(corners, from, to, heavy) {
    for (let k = 0; k < levels.length - 1; k++) {
      const h0 = levels[k]
      const h1 = levels[k + 1]
      if (h1 <= from || h0 >= to) continue
      const c0 = corners(h0)
      const c1 = corners(h1)
      for (let s = 0; s < 4; s++) {
        const n = (s + 1) % 4
        side(c0[s], c0[n], c1[s], c1[n], h0, h1, heavy)
        beams.add(P(c0[s][0], h0, c0[s][1]), P(c1[s][0], h1, c1[s][1]), heavy ? 1.5 : 0.8)
      }
    }
  }

  // four legs, each a lattice tube from its pier to the 2nd floor, curving in
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      tube(
        (h) => {
          const o = outer(h)
          const i = inner(h)
          return [
            [sx * i, sz * o],
            [sx * o, sz * o],
            [sx * o, sz * i],
            [sx * i, sz * i],
          ]
        },
        0,
        115.7,
        true
      )
    }
  }
  // the shaft from the 2nd floor to the top
  tube(
    (h) => {
      const o = outer(h)
      return [
        [-o, o],
        [o, o],
        [o, -o],
        [-o, -o],
      ]
    },
    115.7,
    310,
    false
  )

  // the great decorative arches under the 1st floor on each face, with the
  // iron lace of their spandrels
  const faceAt = (rot, x, y, inset) => {
    const z = outer(y) - inset
    return P(x * Math.cos(rot) + z * Math.sin(rot), y, -x * Math.sin(rot) + z * Math.cos(rot))
  }
  for (let f = 0; f < 4; f++) {
    const rot = (f * Math.PI) / 2
    const seg = low ? 22 : 36
    const outerArc = []
    const innerArc = []
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI * (i / seg)
      outerArc.push(faceAt(rot, -Math.cos(a) * 37.5, 4 + Math.sin(a) * 37, 1.2))
      innerArc.push(faceAt(rot, -Math.cos(a) * 35, 4 + Math.sin(a) * 34.4, 1.2))
    }
    for (let i = 0; i < seg; i++) {
      beams.add(outerArc[i], outerArc[i + 1], 1.0, 1.3)
      beams.add(innerArc[i], innerArc[i + 1], 0.7, 1.0)
      beams.add(outerArc[i], innerArc[i + 1], 0.22)
      beams.add(innerArc[i], outerArc[i + 1], 0.22)
    }
    for (let i = 1; i < seg; i++) {
      const p = outerArc[i]
      if (p.y > 51) continue
      const x = -Math.cos(Math.PI * (i / seg)) * 37.5
      const top = faceAt(rot, x, 54.2, 1.2)
      beams.add(p, top, 0.26)
      const xn = -Math.cos(Math.PI * ((i + 1) / seg)) * 37.5
      beams.add(p, faceAt(rot, xn, 54.2, 1.2), 0.16)
      // little rings in the spandrels, the tower's lace
      if (!low && i % 3 === 0 && top.y - p.y > 8) {
        const c = p.clone().lerp(top, 0.5)
        const r = Math.min(2.2, (top.y - p.y) / 5)
        const ax = P(Math.cos(rot), 0, -Math.sin(rot))
        for (let k = 0; k < 8; k++) {
          const a0 = (k / 8) * Math.PI * 2
          const a1 = ((k + 1) / 8) * Math.PI * 2
          const q0 = c.clone().addScaledVector(ax, Math.cos(a0) * r).add(P(0, Math.sin(a0) * r, 0))
          const q1 = c.clone().addScaledVector(ax, Math.cos(a1) * r).add(P(0, Math.sin(a1) * r, 0))
          beams.add(q0, q1, 0.14)
        }
      }
    }
  }
  group.add(beams.build(iron))

  // platforms: deck, the frieze of arches round the edge, a railing on top
  const deck = new THREE.MeshStandardMaterial({ color: 0x744e33, roughness: 0.6, metalness: 0.18 })
  const frieze = friezeTexture(THREE)
  const ring = (h, half, band, deckThick) => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(half * 2 - 1, deckThick, half * 2 - 1), deck)
    slab.position.y = h - band / 2
    slab.castShadow = true
    group.add(slab)
    const tex = frieze.clone()
    tex.wrapS = THREE.RepeatWrapping
    tex.repeat.set(Math.max(2, Math.round((half * 2) / 8)), 1)
    tex.needsUpdate = true
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.15 })
    for (let s = 0; s < 4; s++) {
      const sideMesh = new THREE.Mesh(new THREE.BoxGeometry(half * 2, band, 1.2), mat)
      const r = (s * Math.PI) / 2
      sideMesh.position.set(Math.sin(r) * half, h, Math.cos(r) * half)
      sideMesh.rotation.y = r
      sideMesh.castShadow = true
      group.add(sideMesh)
    }
  }
  ring(57.6, outer(57.6) + 3.4, 6.2, 2.2)
  ring(115.7, outer(115.7) + 2.4, 4.2, 1.8)
  // 1st floor glass pavilions, 2nd floor houses (pale, glazed)
  const pav = new THREE.MeshStandardMaterial({ color: 0x8f6d52, roughness: 0.22, metalness: 0.35 })
  for (const [x, z, w, d] of [
    [0, 30, 40, 5],
    [0, -30, 40, 5],
    [30, 0, 5, 40],
    [-30, 0, 5, 40],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 4.5, d), pav)
    m.position.set(x, 60.6, z)
    group.add(m)
  }
  const house = new THREE.Mesh(new THREE.BoxGeometry(15, 5.5, 15), pav)
  house.position.y = 119.6
  group.add(house)

  // the top: the enclosed deck, glazing, Eiffel's lantern and antennas
  const top = new THREE.Mesh(new THREE.BoxGeometry(17, 7, 17), deck)
  top.position.y = 279
  group.add(top)
  const glassBand = new THREE.Mesh(new THREE.BoxGeometry(17.4, 2.6, 17.4), new THREE.MeshStandardMaterial({ color: 0x3a434b, roughness: 0.1, metalness: 0.7 }))
  glassBand.position.y = 279.6
  group.add(glassBand)
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 4.4, 12, 16), deck)
  lantern.position.y = 288.5
  group.add(lantern)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(2.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), deck)
  cap.position.y = 294.5
  group.add(cap)
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.9, 30, 8), deck)
  antenna.position.y = 310
  group.add(antenna)
  for (const [x, z, h] of [
    [1.6, 0.8, 9],
    [-1.4, -1.1, 7],
  ]) {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, h, 6), deck)
    a.position.set(x, 297 + h / 2, z)
    group.add(a)
  }
  return group
}

/* --- the right bank: the Louvre, the Tuileries, a corner of the Palais-Royal, Montmartre --- */

/** Scale a geometry's UVs per axis. */
function uvScale2(geo, su, sv) {
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  uv.needsUpdate = true
  return geo
}

/**
 * A wall panel from a to b ([x, z]), standing from y0 to y0 + h, `t` thick,
 * with rectangular holes { u0, u1, v0, v1 } (metres along / up the panel).
 * Its outer face is on the left of a → b. UVs in metres / tile.
 */
function wallPanel(THREE, a, b, y0, h, t, holes, tileU, tileV) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.lineTo(len, 0)
  s.lineTo(len, h)
  s.lineTo(0, h)
  s.closePath()
  for (const o of holes || []) {
    const p = new THREE.Path()
    p.moveTo(o.u0, o.v0)
    p.lineTo(o.u0, o.v1)
    p.lineTo(o.u1, o.v1)
    p.lineTo(o.u1, o.v0)
    p.closePath()
    s.holes.push(p)
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false })
  uvScale2(g, 1 / tileU, 1 / tileV)
  g.translate(0, 0, -t)
  g.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0]))
  g.translate(a[0], y0, a[1])
  return g
}

/** A square roof (dome à l'impériale or a tall hip) of w × d, h high, from a profile [[r 0..1, y 0..1], …]. */
function squareRoof(THREE, w, d, h, profile, tile = 2) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r * Math.SQRT1_2, y))
  const g = new THREE.LatheGeometry(pts, 4).toNonIndexed()
  g.rotateY(Math.PI / 4)
  g.scale(w, h, d)
  g.computeVertexNormals()
  return uvScale2(g, (2 * (w + d)) / tile, h / tile)
}

/** A leaf texture: many small leaves on a transparent (or solid) ground. */
function leafTexture(THREE, { size = 256, count = 1400, colors, ground = null, min = 4, max = 10, seed = 3 }) {
  const rand = seeded(seed)
  return paintTexture(
    THREE,
    size,
    size,
    (g, w, h) => {
      g.clearRect(0, 0, w, h)
      if (ground) {
        g.fillStyle = ground
        g.fillRect(0, 0, w, h)
      }
      for (let i = 0; i < count; i++) {
        const x = rand() * w
        const y = rand() * h
        const r = min + rand() * (max - min)
        g.fillStyle = colors[Math.floor(rand() * colors.length)]
        // wrap so the tile repeats
        for (const ox of [-w, 0, w]) {
          for (const oy of [-h, 0, h]) {
            if (x + ox < -r || x + ox > w + r || y + oy < -r || y + oy > h + r) continue
            g.beginPath()
            g.ellipse(x + ox, y + oy, r, r * 0.62, rand() * Math.PI, 0, Math.PI * 2)
            g.fill()
          }
        }
      }
    },
    { kind: 'color' }
  )
}

/**
 * The places of the photographs away from the Trocadéro, gathered on the
 * right bank east of it (local origin at world (700, 0, 420); +x downstream,
 * +z away from the river): the Tuileries with the Louvre's west pavilion at
 * the end of its allée, the Cour Napoléon with the pyramid and its little
 * pyramids, the Passage Richelieu, Rue de Rivoli, a square with the café and
 * the orange-tiled flatiron with its glass room, and — across the Concorde
 * end of the gardens — a stair street climbing to a Montmartre-like hilltop.
 */
function rightBank(THREE, scene, K) {
  const { B, stone, STONE_T, flags, gravel, pave, zinc, ironMat, haussmann, mansardGeo, weather, addParisLamps, rand, low, q } = K
  const OX = 700
  const OZ = 420
  const V = (x, y, z) => new THREE.Vector3(OX + x, y, OZ + z)
  const box = (mat, tile, w, h, d, x, y, z, ry = 0) => B.box(mat, tile, w, h, d, OX + x, y, OZ + z, ry)
  const add = (mat, geo) => B.add(mat, geo.translate(OX, 0, OZ))
  const flat = (mat, tile, x, z, w, d, y = 0.03) => {
    const g = M.ground(THREE, w, d, mat, tile)
    g.position.set(OX + x, y, OZ + z)
    scene.add(g)
  }
  const lamps = []
  const singleLamps = []
  const trees = []
  const rails = beamBatch(THREE)
  const gilt = beamBatch(THREE)
  const dark = beamBatch(THREE)

  /* materials */
  const louvre = M.facade(THREE, { wall: 'stone', color: '#ecd7aa', frame: '#3a3a34', glass: '#1d2833', bay: 4.4, storey: 6.4, window: { w: 0.36, h: 0.64, bars: 'grid', sill: true, lintel: true }, curtains: 0.05, quality: q, seed: 71 })
  weather(louvre.material, { mottle: 0.12, warm: 0.08, streaks: 0.22, key: 'louvre' })
  const granite = M.paving(THREE, { kind: 'flags', color: '#d4cbbb', joint: '#8f8678', unit: 1.2, variation: 0.06, tile: 6, quality: q, seed: 72 })
  granite.polygonOffset = true
  granite.polygonOffsetFactor = -1
  granite.polygonOffsetUnits = -2
  const setts = M.paving(THREE, { kind: 'setts', color: '#837b70', joint: '#3e3a35', unit: 0.13, variation: 0.2, tile: 2, quality: q, seed: 73 })
  const stepStone = M.paving(THREE, { kind: 'flags', color: '#aaa398', joint: '#6d675e', unit: 0.9, variation: 0.08, tile: 3, quality: q, seed: 74 })
  const darkGranite = new THREE.MeshStandardMaterial({ color: 0x3b3d3f, roughness: 0.35, metalness: 0.1 })
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.35, metalness: 0.8 })
  const goldLeaf = new THREE.MeshStandardMaterial({ color: 0xe8b94c, roughness: 0.3, metalness: 1 })
  const bark = new THREE.MeshStandardMaterial({ color: 0x6b5f50, roughness: 0.9 })
  const hedgeTex = leafTexture(THREE, { colors: ['#4f7a2c', '#5f8c35', '#3f6524', '#6f9a3c', '#466f28'], ground: '#3d5f22', count: 2600, min: 3, max: 7, seed: 5 })
  hedgeTex.repeat.set(1, 1)
  const hedge = new THREE.MeshStandardMaterial({ map: hedgeTex, roughness: 0.92, normalMap: noiseNormalMap(THREE, 128, { cells: 14, strength: 3.2, octaves: 3 }) })
  // ivy curtains: thick at the top, ragged at the sides and the bottom where the strands run out
  const ivyTex = (() => {
    const r = seeded(9)
    const cols = ['#2f5a1f', '#3b6a26', '#24481a', '#4a7a2c', '#2a4f1c', '#557f30']
    return paintTexture(
      THREE,
      256,
      512,
      (g, w, h) => {
        g.clearRect(0, 0, w, h)
        // each column of strands reaches its own depth
        const reach = []
        let v = 0.7
        for (let x = 0; x < w; x += 4) {
          v = Math.min(0.98, Math.max(0.3, v + (r() - 0.5) * 0.18))
          const edge = Math.min(x, w - x) / (w * 0.18)
          reach.push(v * Math.min(1, 0.35 + edge))
        }
        for (let i = 0; i < 5200; i++) {
          const x = r() * w
          const lim = reach[Math.min(reach.length - 1, Math.floor(x / 4))] * h
          const y = Math.pow(r(), 1.35) * lim
          const sz = 4 + r() * 6
          g.fillStyle = cols[Math.floor(r() * cols.length)]
          g.beginPath()
          g.ellipse(x, y, sz, sz * 0.7, r() * Math.PI, 0, Math.PI * 2)
          g.fill()
        }
      },
      { kind: 'color' }
    )
  })()
  ivyTex.wrapS = ivyTex.wrapT = THREE.ClampToEdgeWrapping
  const ivy = new THREE.MeshStandardMaterial({ map: ivyTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 })
  const glassDark = new THREE.MeshPhysicalMaterial({ color: 0x1a2128, roughness: 0.05, metalness: 0.6, clearcoat: 1 })
  const glassClear = new THREE.MeshPhysicalMaterial({ color: 0xcfdbe2, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.18, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false })

  /* --- ground ------------------------------------------------------------- */
  // the Tuileries' pale sand, the courtyard's granite, the square's flags
  const sandMat = M.sand(THREE, { color: '#c9ad84', ripples: false, tile: 4, quality: q, seed: 79 })
  Object.assign(sandMat, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })
  flat(sandMat, 4, -132, 6, 260, 188)
  flat(granite, 6, 97.5, 0, 172, 136)
  flat(granite, 6, 100, 82, 9, 36, 0.04) // through the passage
  box(flags, [6, 6], 185, 0.14, 68, 82.5, 0, 156) // the square (Palais-Royal)
  box(pave, [3, 3], 586, 0.14, 4, 31, 0, 102) // Rivoli, south pavement
  box(pave, [3, 3], 586, 0.14, 4, 31, 0, 120) // north pavement
  box(setts, [2, 2], 16, 0.14, 52, -293, 0, 81) // the little square at the foot of the stairs
  // zebra crossings over Rivoli and the west branch
  const zebra = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
  for (let z = 104.6; z < 118; z += 1.1) box(zebra, [2, 2], 3.6, 0.012, 0.55, 142, 0, z)
  for (let z = 104.6; z < 118; z += 1.1) box(zebra, [2, 2], 3.6, 0.012, 0.55, 100, 0, z)

  /* --- the Louvre -------------------------------------------------------------- */
  const CORNICE = 19.2
  const body = (x0, x1, z0, z1, top = CORNICE, y = 0) => box(louvre.material, louvre.tile, x1 - x0, top - y, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2)
  // pilasters between the bays and a band at each storey, so the walls read as the Louvre's
  const pilasters = (x0, x1, z0, z1) => {
    for (const [a, b, fixed, alongX, out] of [
      [x0, x1, z0, true, -1],
      [x0, x1, z1, true, 1],
      [z0, z1, x0, false, -1],
      [z0, z1, x1, false, 1],
    ]) {
      const n = Math.floor((b - a) / 4.4)
      for (let i = 1; i < n; i++) {
        const c = a + (i * (b - a)) / n
        if (alongX && c > 95 && c < 105) continue
        if (alongX) box(stone, STONE_T, 0.75, CORNICE - 0.5, 0.36, c, 0.25, fixed + out * 0.18)
        else box(stone, STONE_T, 0.36, CORNICE - 0.5, 0.75, fixed + out * 0.18, 0.25, c)
      }
    }
    box(stone, STONE_T, x1 - x0 + 0.4, 0.35, z1 - z0 + 0.4, (x0 + x1) / 2, 12.7, (z0 + z1) / 2)
  }
  pilasters(0, 195, 70, 95)
  pilasters(0, 195, -90, -66)
  pilasters(171, 195, -66, 70)
  const roofOver = (x0, x1, z0, z1, top = CORNICE) => {
    const w = x1 - x0
    const d = z1 - z0
    box(stone, STONE_T, w + 0.9, 0.9, d + 0.9, (x0 + x1) / 2, top, (z0 + z1) / 2) // cornice
    box(stone, STONE_T, w + 0.3, 0.45, d + 0.3, (x0 + x1) / 2, 6.2, (z0 + z1) / 2) // string course
    const mg = mansardGeo(w, d).scale(1, 2.1, 1)
    mg.translate(OX + (x0 + x1) / 2, top + 0.9, OZ + (z0 + z1) / 2)
    B.add(zinc, mg)
  }
  // north wing (Rivoli side) with the Passage Richelieu through it at x 96 … 104
  body(0, 96, 70, 95)
  body(104, 195, 70, 95)
  body(96, 104, 70, 95, CORNICE, 9.2)
  roofOver(0, 195, 70, 95)
  // south wing and east wing
  body(0, 195, -90, -66)
  roofOver(0, 195, -90, -66)
  body(171, 195, -66, 70)
  roofOver(171, 195, -66, 70)
  // the passage: stone-lined, a coffered ceiling, piers and open iron gates at each end
  {
    // the passage's stone in shade: the same stone, darker
    const shade = new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normalMap, roughnessMap: stone.roughnessMap, color: 0x8c8172, roughness: 1 })
    for (const x of [96.15, 103.85]) box(shade, STONE_T, 0.3, 9.2, 36, x, 0, 82)
    box(shade, STONE_T, 8, 0.4, 36, 100, 8.8, 82)
    for (let z = 66; z < 99; z += 3) box(shade, STONE_T, 7.6, 0.5, 0.35, 100, 8.4, z)
    // round-arched openings at both ends
    const arch = new THREE.Shape()
    arch.moveTo(96, 9.25)
    arch.lineTo(104, 9.25)
    arch.lineTo(104, 5.4)
    arch.absellipse(100, 5.4, 4, 3.3, 0, Math.PI, false)
    arch.lineTo(96, 9.25)
    for (const z of [63.4, 99.4]) add(stone, uvScale2(new THREE.ExtrudeGeometry(arch, { depth: 1.2, bevelEnabled: false, curveSegments: 18 }), 0.25, 0.25).translate(0, 0, z))
    for (const z of [64, 100]) {
      for (const sx of [-1, 1]) {
        box(stone, STONE_T, 1.3, 9.2, 1.2, 100 + sx * 3.45, 0, z)
        // a leaf of the gate, folded back against the passage wall
        const zz = z === 64 ? 65.2 : 98.8
        const dirz = z === 64 ? 1 : -1
        const gx = 100 + sx * 3.55
        for (let k = 0; k <= 22; k++) {
          const p = zz + dirz * k * 0.15
          dark.add(V(gx, 0, p), V(gx, 6.2, p), 0.035)
          gilt.add(V(gx, 6.2, p), V(gx, 6.45, p), 0.05)
        }
        for (const y of [0.3, 1.2, 4.6, 6.1]) dark.add(V(gx, y, zz), V(gx, y, zz + dirz * 3.3), 0.06, 0.08)
      }
    }
  }
  // the pavilions: taller, pilastered, a pediment, and a dome à l'impériale or a tall hipped roof with chimneys
  const pavilion = (x0, x1, z0, z1, { kind = 'dome', face = 'z-', gap = null } = {}) => {
    const top = 23.5
    const w = x1 - x0
    const d = z1 - z0
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    if (gap) {
      body(x0, gap[0], z0, z1, top)
      body(gap[1], x1, z0, z1, top)
      body(gap[0], gap[1], z0, z1, top, 9.2)
    } else body(x0, x1, z0, z1, top)
    box(stone, STONE_T, w + 1.2, 1.1, d + 1.2, cx, top, cz)
    box(stone, STONE_T, w + 0.4, 2.6, d + 0.4, cx, top + 1.1, cz) // attic
    // pilasters (paired) on the main face, a pediment over the centre
    const along = face === 'z-' || face === 'z+' ? w : d
    const n = Math.round(along / 4.4)
    const out = face === 'z-' ? z0 - 0.35 : face === 'z+' ? z1 + 0.35 : face === 'x-' ? x0 - 0.35 : x1 + 0.35
    for (let i = 0; i <= n; i++) {
      const o = -along / 2 + (i * along) / n
      if (face[0] === 'z') box(stone, STONE_T, 0.8, top - 0.6, 0.7, cx + o, 0.3, out)
      else box(stone, STONE_T, 0.7, top - 0.6, 0.8, out, 0.3, cz + o)
    }
    const ped = new THREE.Shape()
    ped.moveTo(-along * 0.3, 0)
    ped.lineTo(along * 0.3, 0)
    ped.lineTo(0, 4.2)
    ped.closePath()
    const pg = uvScale2(new THREE.ExtrudeGeometry(ped, { depth: 1.4, bevelEnabled: false }), 0.25, 0.25)
    if (face === 'z-') pg.translate(cx, top + 1.1, z0 - 0.6)
    else if (face === 'z+') pg.rotateY(Math.PI).translate(cx, top + 1.1, z1 + 0.6)
    else if (face === 'x-') pg.rotateY(-Math.PI / 2).translate(x0 + 0.6, top + 1.1, cz)
    else pg.rotateY(Math.PI / 2).translate(x1 - 0.6, top + 1.1, cz)
    add(stone, pg)
    // statues on the corners of the attic
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const fig = new THREE.CapsuleGeometry(0.42, 1.6, 3, 8).translate(cx + sx * (w / 2 - 0.4), top + 3.7 + 1.2, cz + sz * (d / 2 - 0.4))
        add(stone, fig)
      }
    }
    const rh = kind === 'dome' ? 13 : 15
    const prof = kind === 'dome' ? [[1, 0], [0.97, 0.18], [0.88, 0.42], [0.7, 0.66], [0.45, 0.86], [0.22, 0.96], [0, 1]] : [[1, 0], [0.86, 0.5], [0.62, 0.9], [0.5, 1], [0, 1]]
    const rg = squareRoof(THREE, w - 1.5, d - 1.5, rh, prof, 2)
    rg.translate(OX + cx, top + 3.7, OZ + cz)
    B.add(zinc, rg)
    if (kind === 'dome') {
      // a lantern on top, gilded finial
      box(zinc, [2, 2], 3, 2.6, 3, cx, top + 3.7 + rh - 0.3, cz)
      add(goldLeaf, new THREE.SphereGeometry(0.55, 10, 8).translate(cx, top + 3.7 + rh + 2.8, cz))
    } else {
      // the tall stone chimney stacks
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(stone, STONE_T, 1.5, 9.5, 2.6, cx + sx * w * 0.16, top + 3.7 + rh * 0.42, cz + sz * d * 0.3)
    }
  }
  // Marsan (end of the Tuileries allée), Flore, Richelieu (the passage), Denon, Sully
  pavilion(-25, 3, 62, 100, { kind: 'hip', face: 'x-' })
  pavilion(-25, 3, -94, -58, { kind: 'hip', face: 'x-' })
  pavilion(80, 120, 64, 100, { kind: 'dome', face: 'z-', gap: [96, 104] })
  pavilion(80, 120, -96, -60, { kind: 'dome', face: 'z+' })
  pavilion(165, 201, -20, 20, { kind: 'dome', face: 'x-' })

  /* the pyramid, the three small pyramids, the triangular basins */
  {
    const tex = paintTexture(
      THREE,
      256,
      256,
      (g, w, h) => {
        g.clearRect(0, 0, w, h)
        g.fillStyle = 'rgba(176,196,210,0.34)'
        g.fillRect(0, 0, w, h)
        g.strokeStyle = 'rgba(40,46,52,1)'
        g.lineWidth = 5
        for (const o of [-w, 0, w]) {
          g.beginPath()
          g.moveTo(o, 0)
          g.lineTo(o + w, h)
          g.moveTo(o + w, 0)
          g.lineTo(o, h)
          g.stroke()
        }
        g.lineWidth = 3
        g.beginPath()
        g.moveTo(0, h / 2)
        g.lineTo(w, h / 2)
        g.stroke()
      },
      { kind: 'color' }
    )
    tex.repeat.set(48, 9)
    const glassP = new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, metalness: 0.45, roughness: 0.06, clearcoat: 1, envMapIntensity: 1.7, side: THREE.DoubleSide, depthWrite: false })
    const pyr = (x, z, base, h, reps) => {
      const g = new THREE.ConeGeometry(base * Math.SQRT1_2, h, 4, 1, true)
      g.rotateY(Math.PI / 4)
      g.translate(OX + x, h / 2 + 0.05, OZ + z)
      const m = new THREE.Mesh(g, reps === 48 ? glassP : glassP.clone())
      if (reps !== 48) {
        m.material.map = tex.clone()
        m.material.map.repeat.set(reps, reps / 5)
        m.material.map.needsUpdate = true
      }
      scene.add(m)
      // the steel ridges and the base frame, a darker floor inside
      const half = base / 2
      const apex = V(x, h + 0.05, z)
      const c = [V(x - half, 0.05, z - half), V(x + half, 0.05, z - half), V(x + half, 0.05, z + half), V(x - half, 0.05, z + half)]
      for (let i = 0; i < 4; i++) {
        dark.add(c[i], apex, 0.18)
        dark.add(c[i], c[(i + 1) % 4], 0.3, 0.3)
      }
      box(darkGranite, [2, 2], base - 0.4, 0.04, base - 0.4, x, 0.02, z)
    }
    pyr(100, 0, 35.4, 21.6, 48)
    pyr(100, 33, 7.8, 5, 12)
    pyr(100, -33, 7.8, 5, 12)
    pyr(133, 0, 7.8, 5, 12)
    // the triangular basins round the pyramid
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const A = [100 + sx * 21, sz * 21]
      const Bp = [100 + sx * 45, sz * 21]
      const C = [100 + sx * 21, sz * 45]
      const tri = new THREE.BufferGeometry()
      tri.setAttribute('position', new THREE.Float32BufferAttribute([A[0], 0.42, A[1], Bp[0], 0.42, Bp[1], C[0], 0.42, C[1]], 3))
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2))
      tri.computeVertexNormals()
      const water = new THREE.Mesh(tri, K.basinMat)
      water.position.set(OX, 0, OZ)
      water.material.side = THREE.DoubleSide
      scene.add(water)
      for (const [p, r] of [[A, Bp], [Bp, C], [C, A]]) {
        const len = Math.hypot(r[0] - p[0], r[1] - p[1])
        const g = M.box(THREE, len + 0.6, 0.5, 0.6, darkGranite, [2, 2]).geometry
        g.rotateY(-Math.atan2(r[1] - p[1], r[0] - p[0]))
        g.translate((p[0] + r[0]) / 2, 0, (p[1] + r[1]) / 2)
        add(darkGranite, g)
      }
    }
    lamps.push(...[[30, -40], [30, 40], [160, -40], [160, 40]].map(([x, z]) => ({ x: OX + x, z: OZ + z })))
  }

  /* --- Rue de Rivoli and the Tuileries ---------------------------------- */
  // the gardens' fence along Rivoli (and at the Concorde end), gilded tips
  for (let x = -261; x < -3; x += 0.22) {
    if (x > -82 && x < -62) continue // a gate, where the view glides in from the square
    dark.add(V(x, 0, 99.6), V(x, 2.1, 99.6), 0.035)
    if (Math.round(x / 0.22) % 3 === 0) gilt.add(V(x, 2.1, 99.6), V(x, 2.3, 99.6), 0.06)
  }
  for (const y of [0.25, 1.95]) {
    dark.add(V(-261, y, 99.6), V(-82, y, 99.6), 0.05, 0.08)
    dark.add(V(-62, y, 99.6), V(-3, y, 99.6), 0.05, 0.08)
  }
  for (let z = -86; z < 99; z += 0.22) {
    if (z > 72 && z < 90) continue // the gate toward the stairs
    dark.add(V(-262, 0, z), V(-262, 2.1, z), 0.035)
  }
  for (const y of [0.25, 1.95]) {
    dark.add(V(-262, y, -86), V(-262, y, 72), 0.05, 0.08)
    dark.add(V(-262, y, 90), V(-262, y, 99), 0.05, 0.08)
  }
  // the terrace's low wall on the south side of the allée, with its railing
  box(stone, STONE_T, 205, 0.95, 0.7, -146, 0, 62)
  box(stone, STONE_T, 205.6, 0.14, 0.9, -146, 0.95, 62)
  for (let x = -248; x < -44; x += 2.4) rails.add(V(x, 1.09, 62), V(x, 1.9, 62), 0.04)
  rails.add(V(-248.5, 1.9, 62), V(-43.5, 1.9, 62), 0.05, 0.05)
  // the river side: a wall along the quay
  box(stone, STONE_T, 262, 3.2, 1.2, -132, 0, -88.6)
  // clipped trees: grey trunks under one continuous green "ceiling" each row
  const clipped = []
  for (let x = -250; x <= -36; x += 6.5) {
    clipped.push([x, 69.5])
    if (x < -82 || x > -60) clipped.push([x, 92.5]) // a gap for the glide in from the square
  }
  for (let x = -250; x <= -20; x += 6.5) clipped.push([x, -84])
  {
    const trunk = new THREE.CylinderGeometry(0.2, 0.26, 4.2, 7).translate(0, 2.1, 0)
    const crown = new RoundedBoxGeometry(6.6, 6.2, 5.4, 2, 0.9).translate(0, 7.0, 0)
    const tm = new THREE.InstancedMesh(trunk, bark, clipped.length)
    const cm = new THREE.InstancedMesh(crown, hedge, clipped.length)
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    clipped.forEach(([x, z], i) => {
      const k = range(rand, 0.94, 1.06)
      m.makeScale(1, k, 1).setPosition(OX + x, 0, OZ + z)
      tm.setMatrixAt(i, m)
      cm.setMatrixAt(i, m)
      cm.setColorAt(i, c.setHSL(range(rand, 0.22, 0.27), range(rand, 0.25, 0.45), range(rand, 0.85, 1.0)))
    })
    tm.castShadow = cm.castShadow = true
    cm.receiveShadow = true
    scene.add(tm, cm)
  }
  // the grove of the Grand Couvert, plane trees
  for (let x = -244; x <= -150; x += 16) for (let z = 10; z <= 50; z += 18) trees.push({ x: OX + x + range(rand, -2, 2), z: OZ + z + range(rand, -2, 2), h: range(rand, 15, 21) })
  // along the quay
  for (let x = -250; x <= 190; x += 22) trees.push({ x: OX + x + range(rand, -1, 1), z: OZ - 110, h: range(rand, 15, 20) })
  // green Tuileries chairs, scattered along the allée
  {
    const parts = [
      new THREE.BoxGeometry(0.44, 0.04, 0.4).translate(0, 0.44, 0),
      new THREE.BoxGeometry(0.44, 0.5, 0.03).rotateX(-0.25).translate(0, 0.72, -0.22),
      ...[[-0.19, -0.17], [0.19, -0.17], [-0.19, 0.17], [0.19, 0.17]].map(([x, z]) => new THREE.CylinderGeometry(0.015, 0.015, 0.44, 5).translate(x, 0.22, z)),
    ].map((g) => g.toNonIndexed())
    const chairGeo = mergeGeometries(parts, false)
    const spots = []
    for (let i = 0; i < (low ? 16 : 34); i++) {
      const x = range(rand, -240, -40)
      if (Math.abs(x + 104) < 7) continue
      spots.push([x, rand() < 0.5 ? range(rand, 73, 76) : range(rand, 86, 89), rand() * Math.PI * 2])
    }
    const cm = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ color: 0x2c5a3c, roughness: 0.45, metalness: 0.5 }), Math.max(1, spots.length))
    const m = new THREE.Matrix4()
    spots.forEach(([x, z, r], i) => cm.setMatrixAt(i, m.makeRotationY(r).setPosition(OX + x, 0.03, OZ + z)))
    cm.count = spots.length
    cm.castShadow = true
    scene.add(cm)
  }
  for (let x = -240; x <= -40; x += 40) lamps.push({ x: OX + x, z: OZ + 66 })
  for (const [x, z] of [[10, 135], [55, 135], [10, 176], [55, 176], [120, 176], [170, 132]]) lamps.push({ x: OX + x, z: OZ + z })
  for (let x = -250; x <= 300; x += 30) {
    if (x > -50 && x < -20) continue
    lamps.push({ x: OX + x, z: OZ + 103.4 }, { x: OX + x + 15, z: OZ + 118.6 })
  }

  /* --- Haussmann blocks along Rivoli, round the square, east of the Louvre ---- */
  const D = 12 * 3.6
  haussmann(OX - 197.2, OZ + 122 + D / 2, 129.6, D, 3, { awnings: true })
  haussmann(OX - 62.2, OZ + 122 + D / 2, 104.4, D, 1, { awnings: true })
  haussmann(OX - 197.2, OZ + 190 + D / 2, 129.6, D, 2)
  haussmann(OX - 62.2, OZ + 190 + D / 2, 104.4, D, 0)
  haussmann(OX + 56.6, OZ + 190 + D / 2, 133.2, D, 2, { awnings: true })
  haussmann(OX + 214, OZ + 122 + D / 2, 72, D, 1)
  haussmann(OX + 286, OZ + 122 + D / 2, 64.8, D, 3)
  haussmann(OX + 156, OZ + 205 + D / 2, 36, D, 0)
  haussmann(OX + 214, OZ + 186 + D / 2, 50.4, D, 2)
  haussmann(OX + 260, OZ, D, 180, 1)

  /* --- the café (its pale-green front, a red bow, a teddy bear) ----------- */
  {
    const tex = paintTexture(
      THREE,
      512,
      160,
      (g, w, h) => {
        g.fillStyle = '#b8c9a3'
        g.fillRect(0, 0, w, h)
        const px = w / 14
        // two big windows with warm, dim interiors, the door between
        g.fillStyle = '#4a3326'
        g.fillRect(px * 0.8, h * 0.18, px * 4.6, h * 0.62)
        g.fillRect(px * 8.6, h * 0.18, px * 4.6, h * 0.62)
        g.fillStyle = '#3b2c22'
        g.fillRect(px * 6.0, h * 0.12, px * 2.0, h * 0.88)
        g.strokeStyle = '#c9a24e'
        g.lineWidth = 3
        for (const [x0, ww] of [[px * 0.8, px * 4.6], [px * 8.6, px * 4.6], [px * 6.0, px * 2.0]]) g.strokeRect(x0 - 3, h * 0.12 - 3, ww + 6, h * 0.7 + 6)
        // gilded panels with the menu written on them
        g.fillStyle = '#c99b45'
        g.font = 'italic 15px Georgia, serif'
        const words = ['Pâtisserie', 'Crème brûlée', 'Tarte Tatin', 'Macarons']
        words.forEach((t, i) => g.fillText(t, px * 1.2, h * 0.3 + i * 21))
        g.font = 'italic 22px Georgia, serif'
        g.fillText('Salon de thé', px * 1.3, h * 0.1)
        // the plinth
        g.fillStyle = '#8fa37c'
        g.fillRect(0, h * 0.86, w, h * 0.14)
      },
      { kind: 'color' }
    )
    const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })
    const g = new THREE.BoxGeometry(14, 4.4, 0.3)
    const m = new THREE.Mesh(g, front)
    // only the street face shows the painted front
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) if (i < 20) uv.setXY(i, 0.02, 0.5)
    m.position.set(OX + 100, 2.2 + 0.14, OZ + 189.85)
    m.castShadow = m.receiveShadow = true
    scene.add(m)
    // the big red bow over the window
    const red = new THREE.MeshStandardMaterial({ color: 0xb3101a, roughness: 0.5 })
    for (const sx of [-1, 1]) add(red, new THREE.SphereGeometry(0.42, 12, 8).scale(1.25, 0.8, 0.35).translate(102.2 + sx * 0.55, 4.25, 189.5))
    add(red, new THREE.SphereGeometry(0.18, 10, 8).translate(102.2, 4.25, 189.45))
    for (const sx of [-1, 1]) add(red, new THREE.BoxGeometry(0.28, 1.4, 0.04).rotateZ(sx * 0.18).translate(102.2 + sx * 0.25, 3.45, 189.5))
    // hanging baskets of red flowers
    const wicker = new THREE.MeshStandardMaterial({ color: 0x9b7a4c, roughness: 0.85 })
    for (const x of [94.5, 104.2]) {
      add(wicker, new THREE.CylinderGeometry(0.32, 0.22, 0.32, 10).translate(x, 3.7, 189.3))
      add(red, new THREE.IcosahedronGeometry(0.3, 0).translate(x, 3.95, 189.3))
      add(hedge, new THREE.IcosahedronGeometry(0.28, 0).translate(x + 0.15, 3.85, 189.2))
      rails.add(V(x, 3.86, 189.3), V(x, 4.6, 189.6), 0.015)
    }
    // a marble bistro table and two woven chairs
    const marble = new THREE.MeshStandardMaterial({ color: 0xf0ede6, roughness: 0.25 })
    add(marble, new THREE.CylinderGeometry(0.36, 0.36, 0.035, 20).translate(100, 0.88, 188.3))
    add(ironMat, new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6).translate(100, 0.5, 188.3))
    add(ironMat, new THREE.CylinderGeometry(0.24, 0.28, 0.04, 10).translate(100, 0.16, 188.3))
    add(new THREE.MeshStandardMaterial({ color: 0xc58a3c, roughness: 0.7 }), new THREE.SphereGeometry(0.11, 8, 6).scale(1.4, 0.5, 1).translate(99.9, 0.93, 188.3)) // croissants
    const weave = new THREE.MeshStandardMaterial({ color: 0x5e8a5c, roughness: 0.7 })
    for (const sx of [-1, 1]) {
      const cx = 100 + sx * 0.75
      add(weave, new THREE.BoxGeometry(0.44, 0.05, 0.42).translate(cx, 0.6, 188.3))
      add(weave, new THREE.BoxGeometry(0.05, 0.46, 0.42).translate(cx + sx * 0.21, 0.86, 188.3))
      for (const [lx, lz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) add(ironMat, new THREE.CylinderGeometry(0.014, 0.014, 0.6, 5).translate(cx + lx, 0.44, 188.3 + lz))
    }
    // the giant teddy bear sitting by the door
    const fur = new THREE.MeshStandardMaterial({ color: 0xc19a6b, roughness: 0.95 })
    const bx = 106.4
    const bz = 189.0
    add(fur, new THREE.SphereGeometry(0.62, 14, 10).scale(1, 1.15, 0.9).translate(bx, 0.85, bz))
    add(fur, new THREE.SphereGeometry(0.42, 14, 10).translate(bx, 1.85, bz))
    for (const sx of [-1, 1]) {
      add(fur, new THREE.SphereGeometry(0.15, 10, 8).translate(bx + sx * 0.3, 2.2, bz))
      add(fur, new THREE.CapsuleGeometry(0.17, 0.5, 3, 8).rotateX(Math.PI / 2).translate(bx + sx * 0.38, 0.35, bz - 0.4))
      add(fur, new THREE.CapsuleGeometry(0.15, 0.45, 3, 8).rotateZ(sx * 0.5).translate(bx + sx * 0.62, 1.05, bz - 0.1))
    }
    add(new THREE.MeshStandardMaterial({ color: 0xe0c49c, roughness: 0.9 }), new THREE.SphereGeometry(0.15, 10, 8).scale(1, 0.8, 1).translate(bx, 1.78, bz - 0.38))
  }

  /* --- the flatiron: orange tiles, ivy, and its glass room ---------------- */
  const S14 = Math.sin((14 * Math.PI) / 180)
  const C14 = Math.cos((14 * Math.PI) / 180)
  const FL = [147.5, 150]
  const FR = [152.5, 150]
  const dw = [-S14, C14] // along the west face, from the point back
  const de = [S14, C14]
  const LEN = 50 / C14
  const BL = [FL[0] + dw[0] * LEN, FL[1] + dw[1] * LEN]
  const BR = [FR[0] + de[0] * LEN, FR[1] + de[1] * LEN]
  const nW = [-C14, -S14] // the west face's outward normal
  const along = (s, r = 0) => [FL[0] + dw[0] * s - nW[0] * r, FL[1] + dw[1] * s - nW[1] * r] // r = metres inside
  const WIN = 22 // the open window, s along the west face
  const ROOM = { s0: 15.6, s1: 29.4, depth: 7.4 }
  const Wp = along(WIN)
  const spot21 = [-104, 81]
  const d21 = (() => {
    const dx = spot21[0] - Wp[0]
    const dz = spot21[1] - Wp[1]
    const l = Math.hypot(dx, dz)
    return [dx / l, dz / l]
  })()
  {
    const orange = M.brick(THREE, { color: '#f0946a', mortar: '#f6dccb', variation: 0.07, dirt: 0.02, tile: 0.9, quality: q, seed: 75 })
    orange.roughness = 0.42
    if (orange.normalScale) orange.normalScale.set(0.5, 0.5)
    const cream = M.facade(THREE, { wall: 'plaster', color: '#f1e7d4', frame: '#f4f0e8', glass: '#1d252c', bay: 3.0, storey: 3.3, window: { w: 0.5, h: 0.66, bars: 'sash', sill: true, lintel: false }, curtains: 0.35, quality: q, seed: 76 })
    const G0 = 4.6
    const G1 = 9.0
    const TOP = 22.2
    const wl = (s) => along(s)
    // ground floor: the tiled walls cut with tall dark windows
    const winHoles = (len) => {
      const hs = []
      for (let u = 1.2; u + 2.2 < len - 0.8; u += 4.0) hs.push({ u0: u, u1: u + 2.2, v0: 0.5, v1: 3.9 })
      return hs
    }
    const faces = [
      [FR, FL, 5],
      [FL, BL, LEN],
      [BR, FR, LEN],
    ]
    for (const [a, b, len] of faces) {
      const holes = len > 6 ? winHoles(len) : [{ u0: 1.2, u1: 3.8, v0: 0, v1: 3.3 }]
      add(orange, wallPanel(THREE, a, b, 0, G0, 0.4, holes, 1.2, 1.2))
      // glass and black frames in the openings
      const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
      const nrm = [-dir[1], dir[0]]
      for (const o of holes) {
        const u = (o.u0 + o.u1) / 2
        const gw = o.u1 - o.u0
        const gh = o.v1 - o.v0
        const p = [a[0] + dir[0] * u - nrm[0] * 0.25, a[1] + dir[1] * u - nrm[1] * 0.25]
        const pane = new THREE.PlaneGeometry(gw, gh).rotateY(-Math.atan2(dir[1], dir[0])).translate(p[0], (o.v0 + o.v1) / 2, p[1])
        add(glassDark, pane)
        const q0 = V(a[0] + dir[0] * o.u0 - nrm[0] * 0.2, 0, a[1] + dir[1] * o.u0 - nrm[1] * 0.2)
        const q1 = V(a[0] + dir[0] * o.u1 - nrm[0] * 0.2, 0, a[1] + dir[1] * o.u1 - nrm[1] * 0.2)
        dark.add(q0.clone().setY(o.v0), q0.clone().setY(o.v1), 0.09)
        dark.add(q1.clone().setY(o.v0), q1.clone().setY(o.v1), 0.09)
        dark.add(q0.clone().setY(o.v1), q1.clone().setY(o.v1), 0.09)
        dark.add(q0.clone().setY(o.v0 + gh * 0.72), q1.clone().setY(o.v0 + gh * 0.72), 0.06)
      }
      // round wall lamps between the windows
      if (len > 6) for (let u = 3.9; u < len - 2; u += 8) add(new THREE.MeshStandardMaterial({ color: 0x9a8b74, roughness: 0.4, metalness: 0.6 }), new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).rotateY(-Math.atan2(dir[1], dir[0])).translate(a[0] + dir[0] * u + nrm[0] * 0.02, 3.4, a[1] + dir[1] * u + nrm[1] * 0.02))
    }
    // the narrow front: tiled all the way up, a tall strip of glazing in the middle
    add(orange, wallPanel(THREE, FR, FL, G0, TOP - G0, 0.4, [{ u0: 1.8, u1: 3.2, v0: 0.6, v1: TOP - G0 - 1.2 }], 1.2, 1.2))
    add(glassDark, new THREE.PlaneGeometry(1.4, TOP - G0 - 1.8).rotateY(Math.PI).translate(150, G0 + 0.6 + (TOP - G0 - 1.8) / 2, 150.25))
    for (let y = G0 + 0.6; y < TOP - 1.2; y += 1.25) dark.add(V(149.3, y, 150.15), V(150.7, y, 150.15), 0.06)
    // upper floors on the long faces: cream plaster and windows (the west face's glass room cut out)
    add(cream.material, wallPanel(THREE, FL, BL, G0, G1 - G0, 0.4, [{ u0: ROOM.s0, u1: ROOM.s1, v0: 0, v1: G1 - G0 }], cream.tile[0], cream.tile[1]))
    add(cream.material, wallPanel(THREE, FL, BL, G1, TOP - G1, 0.4, [], cream.tile[0], cream.tile[1]))
    add(cream.material, wallPanel(THREE, BR, FR, G0, TOP - G0, 0.4, [], cream.tile[0], cream.tile[1]))
    add(cream.material, wallPanel(THREE, BL, BR, 0, TOP, 0.4, [], cream.tile[0], cream.tile[1]))
    // cornice, roof slab with a roof garden, floor slabs inside
    const outline = (pts, y, t, holes = []) => {
      const s = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1])))
      for (const h of holes) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], -p[1]))))
      const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false })
      g.rotateX(-Math.PI / 2)
      g.translate(0, y, 0)
      return uvScale2(g, 0.5, 0.5)
    }
    add(stone, outline([FL, FR, BR, BL], TOP, 0.5))
    add(stone, outline([[FL[0] - 0.3, FL[1] - 0.3], [FR[0] + 0.3, FR[1] - 0.3], [BR[0] + 0.3, BR[1]], [BL[0] - 0.3, BL[1]]], TOP - 0.6, 0.3))
    add(stone, outline([FL, FR, BR, BL], G1 - 0.3, 0.3))
    // the first floor's slab, with the stairwell cut in it
    const st = { s0: 16.4, s1: 20.0, r0: 3.4, r1: 5.0 }
    const hole = [along(st.s0, st.r0), along(st.s1, st.r0), along(st.s1, st.r1), along(st.s0, st.r1)]
    const planks = M.planks(THREE, { color: '#7a5a3c', width: 0.12, varnish: 0.5, tile: 2, quality: q, seed: 77 })
    add(planks, outline([FL, FR, BR, BL].map((p) => p), G0 - 0.3, 0.3, [hole]))
    add(new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.9 }), outline([FL, FR, BR, BL], 0.02, 0.1))
    // the roof garden spilling over: ivy curtains down the upper walls
    const curtains = []
    const hang = (a, b, len, n, nrm) => {
      for (let i = 0; i < n; i++) {
        const u = range(rand, 0.5, len - 2.5)
        const w = range(rand, 2.5, 6.5)
        const h = range(rand, 3, 11)
        const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
        const p = [a[0] + dir[0] * (u + w / 2) + nrm[0] * (0.12 + i * 0.01), a[1] + dir[1] * (u + w / 2) + nrm[1] * (0.12 + i * 0.01)]
        const g = new THREE.PlaneGeometry(w, h)
        g.rotateY(-Math.atan2(dir[1], dir[0]))
        g.translate(p[0], TOP - h / 2 + 0.3, p[1])
        curtains.push(g)
      }
    }
    hang(FL, BL, LEN, low ? 6 : 11, nW)
    hang(BR, FR, LEN, low ? 6 : 11, [C14, -S14])
    // ivy round the glass room and over the front's top
    for (const [s0, s1] of [[ROOM.s0 - 3.5, ROOM.s0 + 0.2], [ROOM.s1 - 0.2, ROOM.s1 + 3]]) {
      const w = s1 - s0
      const p = along((s0 + s1) / 2, -0.15)
      const g = new THREE.PlaneGeometry(w, 7.5).rotateY(-Math.atan2(dw[1], dw[0])).translate(p[0], G0 + 3.2, p[1])
      curtains.push(g)
    }
    const ivyMesh = new THREE.Mesh(mergeGeometries(curtains, false), ivy)
    ivyMesh.position.set(OX, 0, OZ)
    ivyMesh.castShadow = true
    scene.add(ivyMesh)
    for (let i = 0; i < 26; i++) {
      const sAt = range(rand, 1.5, LEN - 1.5)
      const t = range(rand, 0.05, 0.95)
      const a = along(sAt)
      const b = [FR[0] + de[0] * sAt, FR[1] + de[1] * sAt]
      const r = range(rand, 0.7, 1.5)
      add(hedge, new THREE.IcosahedronGeometry(r, 1).scale(1.3, 0.8, 1.3).translate(a[0] + (b[0] - a[0]) * t, TOP + 0.5 + r * 0.5, a[1] + (b[1] - a[1]) * t))
    }

    /* the glass room on the first floor: black steel glazing on the street, one leaf open */
    const roomH = G1 - 0.3 - G0
    for (let s = ROOM.s0; s <= ROOM.s1 + 1e-6; s += (ROOM.s1 - ROOM.s0) / 12) {
      const p = along(s, 0.1)
      dark.add(V(p[0], G0, p[1]), V(p[0], G0 + roomH, p[1]), 0.08, 0.12)
    }
    for (const y of [G0 + 0.05, G0 + 1.2, G0 + 2.6, G0 + 3.5, G0 + roomH - 0.05]) {
      // the transoms stop at the open leaf
      const p0 = along(ROOM.s0, 0.1)
      const pa = along(WIN - 1.5, 0.1)
      const pb = along(WIN + 1.5, 0.1)
      const p1 = along(ROOM.s1, 0.1)
      dark.add(V(p0[0], y, p0[1]), V(pa[0], y, pa[1]), 0.07, 0.1)
      dark.add(V(pb[0], y, pb[1]), V(p1[0], y, p1[1]), 0.07, 0.1)
    }
    const glassRun = (s0, s1) => {
      const p = along((s0 + s1) / 2, 0.12)
      add(glassClear, new THREE.PlaneGeometry(s1 - s0, roomH).rotateY(-Math.atan2(dw[1], dw[0])).translate(p[0], G0 + roomH / 2, p[1]))
    }
    glassRun(ROOM.s0, WIN - 1.5)
    glassRun(WIN + 1.5, ROOM.s1)
    // the open French window: two leaves swung in against the reveals
    for (const sx of [-1, 1]) {
      const hinge = along(WIN + sx * 1.5, 0.12)
      const tip = along(WIN + sx * 1.5 - sx * 0.25, 1.45)
      dark.add(V(hinge[0], G0 + 0.05, hinge[1]), V(hinge[0], G0 + 3.4, hinge[1]), 0.06)
      dark.add(V(tip[0], G0 + 0.05, tip[1]), V(tip[0], G0 + 3.4, tip[1]), 0.06)
      dark.add(V(hinge[0], G0 + 1.7, hinge[1]), V(tip[0], G0 + 1.7, tip[1]), 0.05)
    }
    // the room: partition walls, cream, with framed pictures and a mirror
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf0e9dc, roughness: 0.85 })
    const inner = [along(ROOM.s0, ROOM.depth), along(ROOM.s1, ROOM.depth)]
    add(wallMat, wallPanel(THREE, along(ROOM.s0, 0.3), inner[0], G0, roomH, 0.15, [], 2, 2))
    add(wallMat, wallPanel(THREE, inner[1], along(ROOM.s1, 0.3), G0, roomH, 0.15, [], 2, 2))
    add(wallMat, wallPanel(THREE, inner[0], inner[1], G0, roomH, 0.15, [], 2, 2))
    add(wallMat, outline([along(ROOM.s0, 0), along(ROOM.s1, 0), along(ROOM.s1, ROOM.depth), along(ROOM.s0, ROOM.depth)], G1 - 0.32, 0.02))
    // framed pictures crowding the walls: a frame and its picture, instanced
    const frameCols = [0x6b4a2c, 0x2b2b2b, 0xb08a4a, 0x3c5a3a, 0x8a2e2a, 0xd8cdb6]
    const artCols = [0xd9cbb0, 0x7d8f9c, 0xc79a6a, 0x9fb38a, 0xe4d9c4, 0x5a6b7a, 0xb88a7a]
    const nPic = low ? 14 : 34
    const frameMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.05), new THREE.MeshStandardMaterial({ roughness: 0.55 }), nPic)
    const artMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).translate(0, 0, 0.027), new THREE.MeshStandardMaterial({ roughness: 0.8 }), nPic)
    const pm = new THREE.Matrix4()
    const pq = new THREE.Quaternion()
    const pc = new THREE.Color()
    for (let i = 0; i < nPic; i++) {
      const onBack = rand() < 0.6
      const w = range(rand, 0.35, 0.9)
      const h = range(rand, 0.35, 1.0)
      const y = G0 + range(rand, 1.0, 3.6)
      let p
      let ang
      if (onBack) {
        p = along(range(rand, ROOM.s0 + 1, ROOM.s1 - 1), ROOM.depth - 0.1)
        ang = Math.atan2(dw[1], dw[0])
      } else {
        p = along(ROOM.s0 + 0.32, range(rand, 1.2, ROOM.depth - 0.8))
        ang = Math.atan2(-nW[1], -nW[0])
      }
      pq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang)
      pm.compose(new THREE.Vector3(OX + p[0], y, OZ + p[1]), pq, new THREE.Vector3(w, h, 1))
      frameMesh.setMatrixAt(i, pm)
      frameMesh.setColorAt(i, pc.setHex(pick(rand, frameCols)))
      pm.compose(new THREE.Vector3(OX + p[0], y, OZ + p[1]), pq, new THREE.Vector3(w * 0.82, h * 0.82, 1))
      artMesh.setMatrixAt(i, pm)
      artMesh.setColorAt(i, pc.setHex(pick(rand, artCols)))
    }
    scene.add(frameMesh, artMesh)
    // plants: a fig in a terracotta pot, trailing pothos along the glazing
    // a warm pendant over the landing
    {
      const lp = along(22.5, 3.4)
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.3, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }))
      shade.position.set(OX + lp[0], G1 - 1.25, OZ + lp[1])
      scene.add(shade)
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(3) }))
      bulb.position.set(OX + lp[0], G1 - 1.38, OZ + lp[1])
      scene.add(bulb)
      rails.add(V(lp[0], G1 - 1.1, lp[1]), V(lp[0], G1 - 0.32, lp[1]), 0.012)
      const l = new THREE.PointLight(0xffd6a6, 9, 12, 2)
      l.position.set(OX + lp[0], G1 - 1.5, OZ + lp[1])
      scene.add(l)
    }
    const terracotta = new THREE.MeshStandardMaterial({ color: 0xa65a3a, roughness: 0.8 })
    const pp = along(ROOM.s0 + 1.4, 1.3)
    add(terracotta, new THREE.CylinderGeometry(0.38, 0.28, 0.6, 12).translate(pp[0], G0 + 0.3, pp[1]))
    for (let i = 0; i < 7; i++) add(hedge, new THREE.IcosahedronGeometry(range(rand, 0.3, 0.55), 0).translate(pp[0] + range(rand, -0.5, 0.5), G0 + range(rand, 1.0, 2.2), pp[1] + range(rand, -0.5, 0.5)))
    for (let s = ROOM.s0 + 0.5; s < ROOM.s1; s += 1.1) {
      if (Math.abs(s - WIN) < 1.6) continue
      const p = along(s, 0.4)
      add(hedge, new THREE.IcosahedronGeometry(range(rand, 0.25, 0.45), 0).scale(1, 1.8, 1).translate(p[0], G0 + roomH - range(rand, 0.4, 1.2), p[1]))
    }
    // the stair down: wooden treads, a wrought-iron balustrade, a mahogany rail
    for (let i = 0; i < 12; i++) {
      const s = st.s1 - 0.3 * (i + 1)
      const a = along(s, st.r0)
      const b = along(s + 0.3, st.r1)
      const y = G0 - 0.19 * (i + 1)
      const g = M.box(THREE, st.r1 - st.r0 - 0.1, 0.05, 0.3, planks, [2, 2]).geometry
      g.rotateY(-Math.atan2(dw[1], dw[0]) + Math.PI / 2)
      g.translate((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2)
      add(planks, g)
    }
    const r0 = along(st.s1, st.r0 - 0.05)
    const r1 = along(st.s0, st.r0 - 0.05)
    const r2 = along(st.s1, st.r1 + 0.05)
    for (let k = 0; k <= 18; k++) {
      const t = k / 18
      const p = [r0[0] + (r1[0] - r0[0]) * t, r0[1] + (r1[1] - r0[1]) * t]
      dark.add(V(p[0], G0, p[1]), V(p[0], G0 + 0.95, p[1]), 0.022)
    }
    for (let k = 0; k <= 6; k++) {
      const t = k / 6
      const p = [r0[0] + (r2[0] - r0[0]) * t, r0[1] + (r2[1] - r0[1]) * t]
      dark.add(V(p[0], G0, p[1]), V(p[0], G0 + 0.95, p[1]), 0.022)
    }
    rails.add(V(r0[0], G0 + 0.98, r0[1]), V(r1[0], G0 + 0.98, r1[1]), 0.07, 0.05)
    rails.add(V(r0[0], G0 + 0.98, r0[1]), V(r2[0], G0 + 0.98, r2[1]), 0.07, 0.05)
    // the black-and-white tiled landing by the window
    const checks = paintTexture(
      THREE,
      64,
      64,
      (g, w, h) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          g.fillStyle = (x + y) % 2 ? '#1c1c1c' : '#ebe6dc'
          g.fillRect(x * 8, y * 8, 8, 8)
        }
      },
      { kind: 'color' }
    )
    checks.magFilter = THREE.NearestFilter
    const landing = outline([along(st.s1 + 0.1, 0.2), along(ROOM.s1 - 0.2, 0.2), along(ROOM.s1 - 0.2, 3.0), along(st.s1 + 0.1, 3.0)], G0 + 0.005, 0.01)
    uvScale2(landing, 2.2, 2.2)
    add(new THREE.MeshStandardMaterial({ map: checks, roughness: 0.3 }), landing)
  }

  /* --- the stair street to the hilltop ------------------------------------- */
  const HILL = 12
  const mStairY = (x) => (x >= -300 ? 0 : x >= -322 ? ((-300 - x) / 22) * 5.4 : x >= -330 ? 5.4 : x >= -356 ? 5.4 + ((-330 - x) / 26) * (HILL - 5.4) : HILL)
  {
    // lower flight, landing, upper flight (solid stone, merged)
    for (let i = 0; i < 30; i++) {
      const x = -300 - (i + 0.5) * (22 / 30)
      box(stepStone, [3, 3], 22 / 30 + 0.02, (i + 1) * 0.18, 14, x, 0, 81)
    }
    box(setts, [2, 2], 8, 5.4, 14, -326, 0, 81)
    for (let i = 0; i < 37; i++) {
      const x = -330 - (i + 0.5) * (26 / 37)
      box(stepStone, [3, 3], 26 / 37 + 0.02, 5.4 + (i + 1) * ((HILL - 5.4) / 37), 14, x, 0, 81)
    }
    // the planted banks either side, and their low stone walls
    const prof = (lift) => {
      const s = new THREE.Shape()
      s.moveTo(-299.5, 0)
      s.lineTo(-299.5, lift)
      s.lineTo(-322, 5.4 + lift)
      s.lineTo(-330, 5.4 + lift)
      s.lineTo(-356.5, HILL + lift)
      s.lineTo(-356.5, 0)
      s.closePath()
      return s
    }
    for (const [z0, w] of [[67, 7], [88, 7]]) {
      const g = uvScale2(new THREE.ExtrudeGeometry(prof(0.25), { depth: w, bevelEnabled: false }), 0.4, 0.4)
      g.translate(0, 0, z0)
      add(hedge, g)
    }
    for (const z0 of [73.8, 87.8]) {
      const g = uvScale2(new THREE.ExtrudeGeometry(prof(0.75), { depth: 0.4, bevelEnabled: false }), 0.5, 0.5)
      g.translate(0, 0, z0)
      add(stone, g)
    }
    // the central handrail: two bronze-black rails on posts, lamps on it, a scroll by each lamp
    const postsX = []
    for (let x = -301; x > -356; x -= 2.2) if (Math.abs(x + 326) > 1) postsX.push(x)
    for (const x of postsX) rails.add(V(x, mStairY(x), 81), V(x, mStairY(x) + 0.95, 81), 0.05)
    for (const dz of [-0.28, 0.28]) {
      let prev = null
      for (let x = -300.5; x >= -356; x -= 1) {
        const p = V(x, mStairY(x) + 0.95, 81 + dz)
        if (prev) rails.add(prev, p, 0.06, 0.06)
        prev = p
      }
    }
    for (const lx of [-311, -326, -343]) {
      singleLamps.push({ x: OX + lx, y: mStairY(lx), z: OZ + 81 })
      const ring = new THREE.TorusGeometry(0.42, 0.04, 6, 18).rotateY(Math.PI / 2).translate(lx + 0.6, mStairY(lx + 0.6) + 0.55, 81)
      add(ironMat, ring)
    }
    for (let x = -304; x > -354; x -= 8.5) {
      trees.push({ x: OX + x + range(rand, -1, 1), y: mStairY(x) + 0.25, z: OZ + 70.5, h: range(rand, 12, 16) })
      trees.push({ x: OX + x + range(rand, -1, 1), y: mStairY(x) + 0.25, z: OZ + 91.5, h: range(rand, 12, 16) })
    }
    // the hill: a retaining mass, cobbled on top
    box(stone, STONE_T, 84, HILL, 320, -398, 0, 140)
    box(stone, STONE_T, 56.5, HILL, 160, -328, 0, 220)
    flat(setts, 2, -398, 140, 84, 320, HILL + 0.03)
    flat(setts, 2, -328, 220, 56.5, 160, HILL + 0.03)
    // buildings either side of the stairs, standing at the foot
    haussmann(OX - 328, OZ + 67 - D / 2, 54, D, 2)
    haussmann(OX - 328, OZ + 95 + D / 2, 54, D, 1)
    // up top: the street with café terraces under red awnings
    haussmann(OX - 399.6, OZ + 76, D, 72, 0, { awnings: 'east', y0: HILL })
    haussmann(OX - 399.6, OZ + 182, D, 108, 3, { awnings: 'east', y0: HILL })
    haussmann(OX - 334.4, OZ + 194, D, 108, 2, { y0: HILL })
    for (let z = 30; z < 260; z += 24) singleLamps.push({ x: OX - 376.5, y: HILL, z: OZ + z })
    // the pub at the foot of the stairs: its green front, black Guinness parasols, barrels and stools
    const green = new THREE.MeshStandardMaterial({ color: 0x1d3a2c, roughness: 0.45 })
    box(green, [2, 2], 12, 4.2, 0.25, -306, 0, 67.1)
    const word = paintTexture(
      THREE,
      256,
      32,
      (g, w, h) => {
        g.fillStyle = '#111'
        g.fillRect(0, 0, w, h)
        g.fillStyle = '#f2efe6'
        g.font = 'bold 20px Georgia, serif'
        g.textAlign = 'center'
        g.fillText('GUINNESS', w / 2, 23)
      },
      { kind: 'color' }
    )
    const canvas = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, side: THREE.DoubleSide })
    const valance = new THREE.MeshStandardMaterial({ map: word, roughness: 0.9, side: THREE.DoubleSide })
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4428, roughness: 0.7 })
    for (const [px, pz] of [[-292, 60], [-292, 70]]) {
      add(canvas, new THREE.ConeGeometry(2.4, 0.7, 4, 1, true).rotateY(Math.PI / 4).translate(px, 2.85, pz))
      add(ironMat, new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6).translate(px, 1.6, pz))
      for (let s = 0; s < 4; s++) {
        const g = new THREE.PlaneGeometry(3.4, 0.36).translate(0, 0, 1.7).rotateY((s * Math.PI) / 2).translate(px, 2.32, pz)
        add(valance, g)
      }
      for (const [bx, bz] of [[1.1, 0.6], [-1.0, -0.8]]) {
        const barrel = new THREE.LatheGeometry([0.3, 0.36, 0.38, 0.36, 0.3].map((r, i) => new THREE.Vector2(r, i * 0.25)), 14)
        add(wood, barrel.translate(px + bx, 0.14, pz + bz))
        add(wood, new THREE.CircleGeometry(0.3, 14).rotateX(-Math.PI / 2).translate(px + bx, 1.14, pz + bz))
        for (const sx of [-0.6, 0.6]) {
          add(ironMat, new THREE.CylinderGeometry(0.17, 0.17, 0.05, 10).translate(px + bx + sx, 0.9, pz + bz))
          add(ironMat, new THREE.CylinderGeometry(0.02, 0.02, 0.76, 5).translate(px + bx + sx, 0.52, pz + bz))
        }
      }
    }
  }

  /* --- finish ---------------------------------------------------------------- */
  addParisLamps(THREE, scene, lamps, { double: true })
  addParisLamps(THREE, scene, singleLamps)
  const forest = addForest(THREE, scene, low ? trees.filter((_, i) => i % 2 === 0) : trees, { species: 'plane', seed: 17, quality: q })
  for (const mesh of forest.meshes || []) {
    const mat = mesh.material
    if (!mat || !mat.alphaTest || !mesh.isInstancedMesh) continue
    mat.color.setRGB(0.95, 1.08, 0.8)
    const c = new THREE.Color()
    for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, c.setHSL(range(rand, 0.2, 0.3), range(rand, 0.15, 0.35), range(rand, 0.46, 0.56)).multiplyScalar(2.3))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }
  scene.add(rails.build(ironMat), dark.build(steel), gilt.build(goldLeaf, { castShadow: false }))

  /* --- the views (world coordinates) ----------------------------------------- */
  const S = (p, l) => ({ pos: V(...p), look: V(...l) })
  const c19 = [Wp[0] + d21[0] * 10.5, Wp[1] + d21[1] * 10.5]
  const c20 = [Wp[0] - d21[0] * 3.4, Wp[1] - d21[1] * 3.4]
  const l20 = along(16.2, 5.0)
  const views = {
    // 15 · by the north little pyramid, looking down past its glass to the paving
    15: S([95, 1.45, 38.5], [100.5, 0.6, 31]),
    // 16 · deep in the Passage Richelieu, the gates open on the pyramids and Denon
    16: S([100.2, 1.55, 74.5], [100, 7.0, 0]),
    // 17 · the café's green front, the bistro table, the bear and the bow
    17: S([99.2, 1.5, 181.8], [99.6, 3.0, 190]),
    // 18 · on the zebra over Rivoli, the orange flatiron at the fork
    18: S([141.5, 1.6, 109], [151, 11, 176]),
    // 19 · in front of its tiled ground floor, ivy pouring from above
    19: S([c19[0], 1.6, c19[1]], [Wp[0], 4.2, Wp[1]]),
    // 20 · inside the glass room upstairs, down the stairwell
    20: S([c20[0], 6.4, c20[1]], [l20[0], 3.4, l20[1]]),
    // 21 · the Tuileries allée, the Pavillon de Marsan at its end
    21: S([spot21[0], 1.6, spot21[1]], [-12, 13, 81]),
    // 22 · halfway up the stairs, over the central rail, down to the landing and the pub
    22: S([-331.2, mStairY(-331.2) + 1.65, 82.6], [-300, 0.2, 79.6]),
    // 23 · the cobbled street on the hilltop, café terraces on the right
    23: S([-367, HILL + 1.65, 97], [-370, HILL + 3.5, 190]),
  }
  const groundAt = (x, z) => {
    const lx = x - OX
    const lz = z - OZ
    if (lx >= -440 && lx <= -356.5 && lz >= -20 && lz <= 300) return HILL
    if (lx > -356.5 && lx <= -300 && lz >= 140 && lz <= 300) return HILL
    if (lx > -356.5 && lx <= -299.5 && lz >= 67 && lz <= 95) return mStairY(lx)
    return 0
  }
  return { views, groundAt }
}

/* --- the scene ---------------------------------------------------------- */

export function buildParis(THREE, ctx, { light = 'day' } = {}) {
  // The photos' skies are pale and hazy; this place is shown on a clear,
  // deep-blue day instead, so the sky read from the hero photo is ignored.
  ctx.sky = null
  const world = createWorld(THREE, ctx, light, {
    // a high-ish sun behind the Trocadéro (from +Z, a little west): it lights
    // the tower's face toward the terrace, the parapets and the stairs, and
    // leaves the sky opposite it at its deepest blue
    sun: { elevation: 40, azimuth: 322 },
    sky: { zenith: 0x2a63c2, horizon: 0xa9c9ec, ground: 0x9d9a8c, sun: 0xfff1d8, cloudLit: 0xffffff, cloudShade: 0xc4d1e4, clouds: 0.2 },
    // a whisper of haze only, so the far city stays crisp
    fog: { density: 0.00021 },
    sunColor: 0xfff0d9,
    sunIntensity: 2.35,
    hemi: [0xeee9df, 0xbb9d6e, 1.1],
  })
  const { scene } = world
  const rand = seeded(1889)
  const low = ctx.quality === 'low'
  const B = batcher(THREE, scene)
  // stone that receives but doesn't cast sun shadows (see the pavilions below)
  const BN = batcher(THREE, scene)

  /* materials: painted once, shared everywhere */
  const q = ctx.quality
  // Paris limestone (pierre de Lutèce) in sun: honey and cream, never grey
  const stone = M.paving(THREE, { kind: 'flags', color: '#e3c995', joint: '#b2966b', unit: 0.55, variation: 0.1, tile: 4, quality: q, seed: 21 })
  stone.normalScale = new THREE.Vector2(1.5, 1.5)
  weather(stone, { mottle: 0.16, warm: 0.09, streaks: 0.22, key: 'stone' })
  const STONE_T = [4, 4]
  const flags = M.paving(THREE, { kind: 'flags', color: '#d9c094', joint: '#a08560', unit: 0.9, variation: 0.1, tile: 6, quality: q, seed: 22 })
  weather(flags, { mottle: 0.12, warm: 0.06, streaks: 0, key: 'flags' })
  // the stone's shade side: less of the blue sky in it, so shadows stay warm
  stone.envMapIntensity = 0.75
  flags.envMapIntensity = 0.7
  const asphalt = M.asphalt(THREE, { color: '#57534e', tile: 6, quality: q, seed: 23 })
  const pave = M.paving(THREE, { kind: 'flags', color: '#bcae96', joint: '#7d7262', unit: 0.4, tile: 3, quality: q, seed: 24 })
  // the Champ de Mars and the Trocadéro lawns: lush, mown, in full sun
  const lawn = M.lawn(THREE, { color: '#4d812e', worn: 0.06, stripes: true, tile: 4, quality: q, seed: 25 })
  Object.assign(lawn, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
  weather(lawn, { mottle: 0.22, warm: 0.1, streaks: 0, key: 'lawn' })
  // the pale ochre stabilised sand of the garden walks
  const gravel = flags.clone()
  gravel.color = new THREE.Color(0xf0dcb2)
  gravel.polygonOffset = true
  gravel.polygonOffsetFactor = -1
  gravel.polygonOffsetUnits = -2
  weather(gravel, { mottle: 0.12, warm: 0.07, streaks: 0, key: 'gravel' })

  /* the ground: the city at y = 0, cut by the Seine */
  for (const [z0, z1] of [
    [-2600, RIVER_S],
    [RIVER_N, 2600],
  ]) {
    const g = M.ground(THREE, 5200, z1 - z0, asphalt, 6)
    g.position.z = (z0 + z1) / 2
    scene.add(g)
  }
  const flat = (mat, tile, x, z, w, d, y = 0.02) => {
    const g = M.ground(THREE, w, d, mat, tile)
    g.position.set(x, y, z)
    scene.add(g)
    return g
  }

  /* the tower */
  scene.add(buildEiffel(THREE, { low }))

  /* --- the Seine, its quays and the Pont d'Iéna --------------------------- */
  const tickers = []
  const seineMat = waterMaterial(THREE, { palette: { ...world.light, water: { deep: 0x1f4a66, shallow: 0x3a7596, stroke: 0xf2f1ee } }, scale: 0.7, strokes: 0.6 })
  tickers.push((t) => seineMat.userData.tick(t))
  const seine = new THREE.Mesh(new THREE.PlaneGeometry(5200, RIVER_N - RIVER_S), seineMat)
  seine.rotation.x = -Math.PI / 2
  seine.position.set(0, WATER_Y, (RIVER_S + RIVER_N) / 2)
  scene.add(seine)
  const L = 5200
  /** A box running along x the whole length of the river, with a gap |x| < gap. */
  const longBox = (mat, tile, h, d, y, z, gap = 0) => {
    if (!gap) return B.box(mat, tile, L, h, d, 0, y, z)
    const len = L / 2 - gap
    for (const sx of [-1, 1]) B.box(mat, tile, len, h, d, sx * (gap + len / 2), y, z)
  }
  for (const [wallZ, dir] of [
    [RIVER_S, 1],
    [RIVER_N, -1],
  ]) {
    // upper quay wall from the berge up to the street, its coping, and the parapet
    B.box(stone, STONE_T, L, -BERGE_Y, 2, 0, BERGE_Y, wallZ - dir)
    longBox(stone, STONE_T, 0.9, 0.7, 0, wallZ - dir * 0.35, 17.6)
    // the low quay (berge) along the water, and its own wall down into the river
    B.box(flags, [6, 6], L, 0.3, 8, 0, BERGE_Y - 0.3, wallZ + dir * 4)
    B.box(stone, STONE_T, L, BERGE_Y - WATER_Y + 1.2, 0.8, 0, WATER_Y - 1.2, wallZ + dir * 8.4)
  }
  // the river bed, dark, so the water never shows a void
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(L, RIVER_N - RIVER_S), new THREE.MeshBasicMaterial({ color: 0x141815 }))
  bed.rotation.x = -Math.PI / 2
  bed.position.set(0, WATER_Y - 3, (RIVER_S + RIVER_N) / 2)
  scene.add(bed)

  // Pont d'Iéna: five elliptical stone arches on four piers, 35 m wide
  {
    const z0 = RIVER_S - 6
    const z1 = RIVER_N + 6
    const s = new THREE.Shape()
    s.moveTo(z0, WATER_Y - 4)
    s.lineTo(z1, WATER_Y - 4)
    s.lineTo(z1, 0.15)
    s.lineTo(z0, 0.15)
    s.closePath()
    const wz0 = RIVER_S + 8.4
    const wz1 = RIVER_N - 8.4
    const pier = 4.2
    const span = (wz1 - wz0 - pier * 4) / 5
    for (let i = 0; i < 5; i++) {
      const cz = wz0 + span / 2 + i * (span + pier)
      const h = new THREE.Path()
      h.moveTo(cz + span / 2, WATER_Y - 3.5)
      h.lineTo(cz + span / 2, WATER_Y + 0.8)
      h.absellipse(cz, WATER_Y + 0.8, span / 2, 3.4, 0, Math.PI, false)
      h.lineTo(cz - span / 2, WATER_Y - 3.5)
      h.closePath()
      s.holes.push(h)
      // cutwaters on the piers, and the imperial eagles above them
      if (i > 0) {
        const pz = cz - span / 2 - pier / 2
        for (const sx of [-1, 1]) {
          const cut = new THREE.CylinderGeometry(pier / 2, pier / 2, 5.4, 3)
          cut.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2)
          cut.translate(sx * 17.6, WATER_Y + 2.1, pz)
          B.add(stone, uvScale(cut, 0.5))
          const eagle = new THREE.SphereGeometry(0.9, 8, 6)
          eagle.scale(1.2, 1, 0.6)
          eagle.translate(sx * 17.7, -1.3, pz)
          B.add(stone, eagle)
        }
      }
    }
    B.add(stone, extrudeAlongX(THREE, s, 35, 4))
    // deck: asphalt between pale stone pavements, a parapet on both sides
    B.box(asphalt, [6, 6], 22, 0.06, z1 - z0, 0, 0.15, (z0 + z1) / 2)
    for (const sx of [-1, 1]) {
      B.box(pave, [3, 3], 5.4, 0.2, z1 - z0, sx * 14.2, 0.15, (z0 + z1) / 2)
      B.box(stone, STONE_T, 0.7, 1.05, z1 - z0, sx * 17.15, 0.15, (z0 + z1) / 2)
      // the equestrian statues on their pedestals at both ends
      for (const ez of [z0 - 2, z1 + 2]) {
        B.box(stone, STONE_T, 4, 6.5, 8, sx * 15.5, 0, ez)
        const horse = new THREE.CapsuleGeometry(0.9, 2.4, 4, 8).rotateZ(Math.PI / 2)
        horse.translate(sx * 15.5, 8, ez)
        B.add(stone, horse)
        const rider = new THREE.CapsuleGeometry(0.45, 1.2, 4, 8).translate(sx * 15.5, 9.6, ez)
        B.add(stone, rider)
        for (const lz of [-1, 1]) for (const lx of [-0.9, 0.9]) B.add(stone, new THREE.CylinderGeometry(0.18, 0.15, 1.6, 6).translate(sx * 15.5 + lx * 0.5, 7, ez + lz * 1.1 * 0.7))
      }
    }
  }

  // two bateaux-mouches moored on the north berge, a péniche on the south
  {
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e8e3, roughness: 0.45 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.2 })
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x1e262c, roughness: 0.04, metalness: 0.5, clearcoat: 1 })
    const boat = (x, z, len, beam, kind) => {
      const hull = new RoundedBoxGeometry(len, 1.6, beam, 2, 0.5).translate(x, WATER_Y + 0.5, z)
      B.add(kind === 'peniche' ? dark : white, hull)
      if (kind === 'peniche') {
        B.add(white, new THREE.BoxGeometry(8, 2.4, beam - 1).translate(x - len / 2 + 6, WATER_Y + 2.4, z))
        B.add(glass, new THREE.BoxGeometry(8.05, 0.8, beam - 0.9).translate(x - len / 2 + 6, WATER_Y + 2.8, z))
      } else {
        B.add(glass, new THREE.BoxGeometry(len - 6, 1.9, beam - 0.6).translate(x, WATER_Y + 2.2, z))
        B.add(white, new THREE.BoxGeometry(len - 5.6, 0.25, beam - 0.3).translate(x, WATER_Y + 3.25, z))
      }
    }
    boat(-260, RIVER_N - 12.5, 48, 7, 'mouche')
    boat(-205, RIVER_N - 12.5, 40, 6.5, 'mouche')
    boat(230, RIVER_S + 12.6, 38, 5.1, 'peniche')
  }

  // quayside streets: Quai Branly (south) and Avenue de New York (north) — pavements and kerbs
  for (const [z, w] of [
    [RIVER_S - 5, 8],
    [RIVER_S - 33, 6],
    [RIVER_N + 5, 8],
    [RIVER_N + 37, 6],
  ]) {
    longBox(pave, [3, 3], 0.14, w, 0, z, 11.5)
  }

  /* --- the Trocadéro: gardens, basin, terraces, stairs, Chaillot ---------- */
  // gilded bronze: warm gold that catches the sun (a touch rough so it doesn't just mirror the blue sky)
  const gold = new THREE.MeshStandardMaterial({ color: 0xf0bf4a, roughness: 0.32, metalness: 1, emissive: 0x3a2400, emissiveIntensity: 0.25 })
  const jetMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf2f8ff).multiplyScalar(1.12), transparent: true, opacity: 0.5, depthWrite: false })
  const jets = []
  const statue = (x, y, z, ry = 0, scale = 1) => {
    // a gilded figure on a stone pedestal: body, head, a raised arm
    B.box(stone, STONE_T, 1.6 * scale, 2.2 * scale, 1.6 * scale, x, y, z)
    const top = y + 2.2 * scale
    const fig = [
      new THREE.CapsuleGeometry(0.36, 1.3, 4, 10).translate(0, 1.0, 0),
      new THREE.SphereGeometry(0.22, 10, 8).translate(0, 2.05, 0),
      new THREE.CapsuleGeometry(0.1, 0.8, 3, 6).rotateZ(0.5).translate(0.42, 1.8, 0),
      new THREE.CylinderGeometry(0.45, 0.55, 0.2, 10).translate(0, 0.1, 0),
    ].map((g) => g.scale(scale * 1.25, scale * 1.25, scale * 1.25).rotateY(ry).translate(x, top, z))
    for (const g of fig) B.add(gold, g)
  }

  // lower gardens: gravel walks, lawns, and the long Varsovie basin
  flat(gravel, 6, 0, 425, 280, 190)
  for (const sx of [-1, 1]) {
    flat(lawn, 4, sx * 72, 428, 84, 170, 0.04)
    // the wooded lawns on both flanks of the gardens, under the plane avenues
    flat(lawn, 4, sx * 190, 428, 100, 190, 0.04)
  }
  const BASIN = { x: 22, z0: 360, z1: 505 }
  const basinMat = waterMaterial(THREE, { palette: { ...world.light, water: { deep: 0x175f8f, shallow: 0x3c9bc9, stroke: 0xf2f1ee } }, scale: 0.32, strokes: 0.4 })
  tickers.push((t) => basinMat.userData.tick(t))
  const basin = new THREE.Mesh(new THREE.PlaneGeometry(BASIN.x * 2, BASIN.z1 - BASIN.z0), basinMat)
  basin.rotation.x = -Math.PI / 2
  basin.position.set(0, 0.32, (BASIN.z0 + BASIN.z1) / 2)
  scene.add(basin)
  for (const sx of [-1, 1]) B.box(stone, STONE_T, 0.9, 0.62, BASIN.z1 - BASIN.z0 + 1.8, sx * (BASIN.x + 0.45), 0, (BASIN.z0 + BASIN.z1) / 2)
  for (const z of [BASIN.z0 - 0.45, BASIN.z1 + 0.45]) B.box(stone, STONE_T, BASIN.x * 2, 0.62, 0.9, 0, 0, z)
  // the water cannons: arcs from both rims toward the axis, and the great
  // cannons at the foot of the basin firing toward the tower
  const arc = (a, mid, b, r) => {
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 18, r, 6), jetMat)
    tube.layers.set(NO_INK_LAYER)
    scene.add(tube)
    jets.push(tube)
  }
  const n = low ? 8 : 14
  for (let i = 0; i < n; i++) {
    const z = BASIN.z0 + 14 + (i / (n - 1)) * (BASIN.z1 - BASIN.z0 - 28)
    for (const sx of [-1, 1]) {
      const a = new THREE.Vector3(sx * (BASIN.x - 0.6), 0.5, z)
      arc(a, new THREE.Vector3(sx * 11, 9, z - 3), new THREE.Vector3(sx * 1.5, 0.35, z - 6), 0.09)
    }
  }
  for (const x of [-12, -6, 0, 6, 12]) {
    arc(new THREE.Vector3(x, 0.6, BASIN.z0 + 4), new THREE.Vector3(x * 1.1, 14, BASIN.z0 - 24), new THREE.Vector3(x * 1.2, 0.35, BASIN.z0 - 46 + Math.abs(x)), 0.16)
  }
  // a spray of mist where the cannons land, sitting in the basin head
  for (const x of [-12, 0, 12]) {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 10, 1, true), jetMat)
    plume.position.set(x, 2.5, BASIN.z0 + 3)
    plume.layers.set(NO_INK_LAYER)
    scene.add(plume)
  }
  // the cannons' landing pool continues as a lower basin toward the avenue
  {
    const lowBasin = new THREE.Mesh(new THREE.PlaneGeometry(36, 30), basinMat)
    lowBasin.rotation.x = -Math.PI / 2
    lowBasin.position.set(0, 0.32, BASIN.z0 - 32)
    scene.add(lowBasin)
    for (const sx of [-1, 1]) B.box(stone, STONE_T, 0.9, 0.62, 31.8, sx * 18.45, 0, BASIN.z0 - 32)
    B.box(stone, STONE_T, 37.8, 0.62, 0.9, 0, 0, BASIN.z0 - 47.45)
  }
  // the gilded bull and deer at the head of the basin
  statue(-24, 0, BASIN.z1 + 4, 0.6, 1.5)
  statue(24, 0, BASIN.z1 + 4, -0.6, 1.5)

  // the sloped lawns up to the terrace, with the central stairs
  const rise = TERRACE_Y / (GARDEN_TOP - GARDEN_FOOT)
  for (const sx of [-1, 1]) {
    const w = 208
    const len = Math.hypot(GARDEN_TOP - GARDEN_FOOT, TERRACE_Y)
    const g = M.ground(THREE, w, len, lawn, 4)
    g.rotation.x = -Math.atan(rise)
    g.position.set(sx * (22 + w / 2), TERRACE_Y / 2 + 0.05, (GARDEN_FOOT + GARDEN_TOP) / 2)
    scene.add(g)
    // a gravel walk zig-zagging up, drawn as a band on the slope
    const walk = M.ground(THREE, 6, len, gravel, 6)
    walk.rotation.x = -Math.atan(rise)
    walk.position.set(sx * 60, TERRACE_Y / 2 + 0.09, (GARDEN_FOOT + GARDEN_TOP) / 2)
    scene.add(walk)
  }
  {
    const steps = 75
    const tread = (GARDEN_TOP - GARDEN_FOOT) / steps
    for (let i = 0; i < steps; i++) {
      const top = ((i + 1) / steps) * TERRACE_Y
      B.box(flags, [6, 6], 40, top, tread + 0.02, 0, 0, GARDEN_FOOT + (i + 0.5) * tread)
    }
    // cheek walls of the central stairs: sloping stone
    const cheek = new THREE.Shape()
    cheek.moveTo(GARDEN_FOOT - 1, 0)
    cheek.lineTo(GARDEN_TOP, 0)
    cheek.lineTo(GARDEN_TOP, TERRACE_Y + 1.1)
    cheek.lineTo(GARDEN_FOOT - 1, 1.1)
    cheek.closePath()
    for (const sx of [-1, 1]) {
      const g = extrudeAlongX(THREE, cheek, 1.4, 4)
      g.translate(sx * 20.7, 0, 0)
      B.add(stone, g)
    }
  }

  // the terrace, its balustrade over the gardens
  B.box(stone, STONE_T, 460, TERRACE_Y, 160, 0, 0, GARDEN_TOP + 80)
  flat(flags, 6, 0, GARDEN_TOP + 80, 460, 160, TERRACE_Y + 0.02)
  for (const sx of [-1, 1]) {
    const len = 230 - 21.4
    B.box(stone, STONE_T, len, 1.05, 0.7, sx * (21.4 + len / 2), TERRACE_Y, GARDEN_TOP + 0.35)
    B.box(stone, STONE_T, len, 0.16, 0.95, sx * (21.4 + len / 2), TERRACE_Y + 1.05, GARDEN_TOP + 0.35)
  }
  // drains and lamp posts along the terrace
  addParisLamps(
    THREE,
    scene,
    [-200, -150, -100, -50, 50, 100, 150, 200].map((x) => ({ x, y: TERRACE_Y, z: GARDEN_TOP + 2.5 })).concat(
      [-110, -70, 70, 110].flatMap((x) => [
        { x, z: 345 },
        { x, z: 515 },
      ])
    )
  )

  // the parvis between the two pavilions
  B.box(stone, STONE_T, FLIGHT.x0 * 2, PARVIS_Y, 214, 0, 0, FLIGHT.z0 + 107)
  flat(flags, 6, 0, FLIGHT.z0 + 107, FLIGHT.x0 * 2, 214, PARVIS_Y + 0.02)
  B.box(stone, STONE_T, FLIGHT.x0 * 2, 1.1, 0.8, 0, PARVIS_Y, FLIGHT.z0 + 0.4)
  B.box(stone, STONE_T, FLIGHT.x0 * 2 + 0.3, 0.16, 1.05, 0, PARVIS_Y + 1.1, FLIGHT.z0 + 0.4)
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) statue(sx * 47, PARVIS_Y, 712 + i * 32, sx * -Math.PI / 2)

  // the two lateral flights down from the parvis to the terrace, with their
  // solid parapets sloping down toward the tower — where the photo was taken
  {
    const steps = 50
    const run = FLIGHT.x1 - FLIGHT.x0
    const tread = run / steps
    const drop = PARVIS_Y - TERRACE_Y
    const depth = FLIGHT.z1 - FLIGHT.z0
    const ang = Math.atan2(drop, run)
    for (const sx of [-1, 1]) {
      for (let i = 0; i < steps; i++) {
        const top = PARVIS_Y - (i / steps) * drop
        B.box(flags, [6, 6], tread + 0.02, top - TERRACE_Y, depth, sx * (FLIGHT.x0 + (i + 0.5) * tread), TERRACE_Y, (FLIGHT.z0 + FLIGHT.z1) / 2)
      }
      // the parapet: a solid stone wall following the stairs, with a coping
      // (the shape is mirrored for the west flight; ExtrudeGeometry fixes the winding)
      const pts = [
        [FLIGHT.x0 - 6, TERRACE_Y],
        [FLIGHT.x1 + 5, TERRACE_Y],
        [FLIGHT.x1 + 5, TERRACE_Y + 1.1],
        [FLIGHT.x1, TERRACE_Y + 1.1],
        [FLIGHT.x0, PARVIS_Y + 1.1],
        [FLIGHT.x0 - 6, PARVIS_Y + 1.1],
      ]
      const p = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(sx * x, y)))
      const wall = uvScale(new THREE.ExtrudeGeometry(p, { depth: 0.8, bevelEnabled: false }), 0.25)
      wall.translate(0, 0, FLIGHT.z0 - 0.8)
      B.add(stone, wall)
      const slopeLen = Math.hypot(run, drop)
      const cope = M.box(THREE, slopeLen + 0.3, 0.16, 1.0, stone, STONE_T).geometry
      cope.rotateZ(-sx * ang)
      cope.translate(sx * (FLIGHT.x0 + run / 2), (PARVIS_Y + TERRACE_Y) / 2 + 1.1 - 0.02, FLIGHT.z0 - 0.4)
      B.add(stone, cope)
      // the pavilion's great stone flank on the other side of the flight; it
      // casts no sun shadow, so the flights stay in warm light (the sun comes
      // from behind the pavilions and would otherwise drown the stairs in shade)
      BN.box(stone, STONE_T, 46, 32, 46, sx * (FLIGHT.x0 + 23), 0, FLIGHT.z1 + 23)
      BN.box(stone, STONE_T, 47, 0.8, 47, sx * (FLIGHT.x0 + 23), 32, FLIGHT.z1 + 23)
    }
  }

  // the parvis's dark granite bands, the rounded end blocks on its parapet,
  // the great stone blocks at the foot of each flight, and on the terrace below
  // a dark granite field between two clipped hedges (as seen from the parvis)
  {
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x67625b, roughness: 0.5 })
    for (const z of [691.5, 697, 702.5]) B.box(darkStone, [2, 2], FLIGHT.x0 * 2 - 6, 0.035, 0.9, 0, PARVIS_Y, z)
    for (const x of [-30, 30]) B.box(darkStone, [2, 2], 0.9, 0.035, 18, x, PARVIS_Y, 696)
    for (const sx of [-1, 1]) {
      for (const x of [20, 47]) {
        B.box(stone, STONE_T, 1.55, 1.3, 1.35, sx * x, PARVIS_Y, FLIGHT.z0 + 0.4)
        const top = new THREE.CylinderGeometry(0.675, 0.675, 1.55, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2)
        top.translate(sx * x, PARVIS_Y + 1.3, FLIGHT.z0 + 0.4)
        B.add(stone, uvScale(top, 0.25))
      }
      B.box(stone, STONE_T, 8, 7, 10, sx * 82, TERRACE_Y, FLIGHT.z0 + 5)
      B.box(stone, STONE_T, 8.6, 0.5, 10.6, sx * 82, TERRACE_Y + 7, FLIGHT.z0 + 5)
    }
    B.box(darkStone, [2, 2], 24, 0.04, 50, 0, TERRACE_Y, 643)
    const boxHedge = new THREE.MeshStandardMaterial({ color: 0x4f7a2e, roughness: 0.9, normalMap: noiseNormalMap(THREE, 128, { cells: 12, strength: 3, octaves: 3 }) })
    for (const sx of [-1, 1]) B.box(boxHedge, [2, 2], 2.2, 1.1, 56, sx * 21, TERRACE_Y, 643)
  }

  // the Palais de Chaillot: two curved wings embracing the gardens, pale
  // stone, tall windows between pilasters, a flat roof behind a cornice
  {
    const fac = M.facade(THREE, {
      wall: 'stone',
      color: '#e6cc9a',
      frame: '#3a3628',
      glass: '#1c2a38',
      bay: 4.6,
      storey: 7.5,
      window: { w: 0.5, h: 0.74, bars: 'grid', sill: true, lintel: false },
      curtains: 0.1,
      quality: q,
      seed: 31,
    })
    weather(fac.material, { mottle: 0.14, warm: 0.08, streaks: 0.2, key: 'chaillot' })
    const R = 205
    const C = 545
    const H = 40
    for (const sx of [-1, 1]) {
      for (let a = 26; a <= 78; a += 4.5) {
        const r = THREE.MathUtils.degToRad(a)
        const x = sx * Math.sin(r) * R
        const z = C + Math.cos(r) * R
        const ry = Math.atan2(-sx * Math.sin(r), -Math.cos(r))
        const len = (R * Math.PI * 4.6) / 180
        B.box(fac.material, fac.tile, len, H, 22, x, 0, z, ry)
        B.box(stone, STONE_T, len + 0.6, 1.4, 23.2, x, H, z, ry)
        // pilasters on the garden side
        const nx = Math.sin(ry)
        const nz = Math.cos(ry)
        const tx = Math.cos(ry)
        const tz = -Math.sin(ry)
        for (let k = 0; k < 4; k++) {
          const o = -len / 2 + (k + 0.5) * (len / 4) + len / 8
          B.box(stone, STONE_T, 0.9, H - 2, 0.5, x + nx * 11.2 + tx * (o - len / 8), 0, z + nz * 11.2 + tz * (o - len / 8), ry)
        }
      }
    }
  }

  // plane trees: double avenues down the gardens, groves on the slopes
  const gardenTrees = []
  for (let z = 338; z <= 515; z += 14) for (const x of [-132, -120, 120, 132]) gardenTrees.push({ x: x + range(rand, -0.8, 0.8), z: z + range(rand, -0.8, 0.8), h: range(rand, 13, 17) })
  for (let z = GARDEN_FOOT + 6; z < GARDEN_TOP - 4; z += 16) {
    for (const x of [-180, -160, -140, 140, 160, 180]) {
      const zz = z + range(rand, -3, 3)
      gardenTrees.push({ x: x + range(rand, -3, 3), z: zz, y: (zz - GARDEN_FOOT) * rise, h: range(rand, 11, 16) })
    }
  }
  // the quays
  for (let x = -380; x <= 380; x += 23) {
    if (Math.abs(x) < 26) continue
    gardenTrees.push({ x: x + range(rand, -1, 1), z: RIVER_S - 12, h: range(rand, 14, 19) })
    // (the right-bank quay east of x = 280 is planted by the Louvre quarter, leaving the glide to it clear)
    if (x < 280) gardenTrees.push({ x: x + range(rand, -1, 1), z: RIVER_N + 13, h: range(rand, 14, 19) })
  }
  // (planted with the city trees below)

  /* --- the Champ de Mars and the tower's surroundings -------------------- */
  flat(gravel, 6, 0, -10, 300, 290)
  for (const sx of [-1, 1]) {
    B.box(stone, STONE_T, 30, 2.4, 30, sx * 51, 0, 51)
    B.box(stone, STONE_T, 30, 2.4, 30, sx * 51, 0, -51)
    flat(lawn, 4, sx * 52, -580, 72, 860, 0.04)
  }
  flat(gravel, 6, 0, -580, 300, 860)
  const cdmTrees = []
  for (let z = -160; z >= -620; z -= 17) for (const x of [-106, 106]) cdmTrees.push({ x: x + range(rand, -0.6, 0.6), z: z + range(rand, -0.6, 0.6), h: range(rand, 12, 16) })
  const allPlanes = gardenTrees.concat(cdmTrees)
  const forest = addForest(THREE, scene, low ? allPlanes.filter((_, i) => i % 2 === 0) : allPlanes, { species: 'plane', seed: 7, quality: q })
  // summer planes in full sun: a richer, more saturated green, each tree its own shade
  {
    const leafTint = new THREE.Color(0.95, 1.08, 0.8)
    const c = new THREE.Color()
    const seen = new Set()
    for (const mesh of forest.meshes || []) {
      const mat = mesh.material
      if (!mat || !mat.alphaTest || !mesh.isInstancedMesh) continue
      if (!seen.has(mat)) {
        seen.add(mat)
        mat.color.copy(leafTint)
      }
      for (let i = 0; i < mesh.count; i++) {
        c.setHSL(range(rand, 0.2, 0.3), range(rand, 0.15, 0.35), range(rand, 0.46, 0.56))
        c.multiplyScalar(2.3)
        mesh.setColorAt(i, c)
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  /* --- Haussmann: limestone, iron balconies, zinc mansards ---------------- */
  const BAY = 3.6
  const ST = 3.1
  const GROUND = 4.4
  const UPPER = 5
  const H = GROUND + UPPER * ST // cornice line, 19.9 m
  const MAN = { low: 3.4, lowIn: 1.3, high: 1.6, highIn: 4.5 }
  const fac = M.facade(THREE, {
    wall: 'stone',
    color: '#ecd9b4',
    frame: '#f1ebdf',
    glass: '#1e2b3a',
    bay: BAY,
    storey: ST,
    window: { w: 0.42, h: 0.72, bars: 'sash', sill: true, lintel: false },
    curtains: 0.4,
    quality: q,
    seed: 41,
  })
  // a few tones of the same limestone: honey, cream, a pale near-white
  // restoration, a slightly sandier one (the far city adds instance colours)
  const facVariant = (hex, key) => {
    const m = fac.material.clone()
    m.color = hex.isColor ? hex : new THREE.Color(hex)
    return weather(m, { mottle: 0.12, warm: 0.07, streaks: 0.24, key })
  }
  weather(fac.material, { mottle: 0.12, warm: 0.07, streaks: 0.24, key: 'fac0' })
  const facades = [fac.material, facVariant(0xfff0dc, 'fac1'), facVariant(0xf2d4a4, 'fac2'), facVariant(new THREE.Color(1.05, 1.06, 1.1), 'fac3')]
  const shop = M.shopfront(THREE, { color: '#2c2a27', frame: '#1d2421', fascia: '#1f3a30', awning: '#8a1d24', bay: BAY, storey: GROUND, warm: 0.55, quality: q, seed: 42 })
  // zinc mansards: the blue-grey of Paris roofs, a little metallic so they pick up the sky
  const zinc = M.roof(THREE, { kind: 'zinc', color: '#71859a', tile: 2, quality: q, seed: 43 })
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x17191a, roughness: 0.5, metalness: 0.6 })

  /** A mansard: a steep lower slope and a shallow upper one, UVs in metres (u along the eaves, v up the slope). */
  function mansardGeo(w, d) {
    const pos = []
    const uv = []
    const ring = (inset, y) => [
      [-w / 2 + inset, y, d / 2 - inset],
      [w / 2 - inset, y, d / 2 - inset],
      [w / 2 - inset, y, -d / 2 + inset],
      [-w / 2 + inset, y, -d / 2 + inset],
    ]
    const r0 = ring(0, 0)
    const r1 = ring(MAN.lowIn, MAN.low)
    const r2 = ring(MAN.highIn, MAN.low + MAN.high)
    const band = (a, b, slope) => {
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4
        const quad = [a[i], a[j], b[j], b[i]]
        const len = Math.hypot(a[j][0] - a[i][0], a[j][2] - a[i][2])
        const off = (len - Math.hypot(b[j][0] - b[i][0], b[j][2] - b[i][2])) / 2
        const qu = [
          [0, 0],
          [len / 2, 0],
          [(len - off) / 2, slope / 2],
          [off / 2, slope / 2],
        ]
        for (const k of [0, 1, 2, 0, 2, 3]) {
          pos.push(...quad[k])
          uv.push(...qu[k])
        }
      }
    }
    band(r0, r1, Math.hypot(MAN.low, MAN.lowIn))
    band(r1, r2, Math.hypot(MAN.high, MAN.highIn - MAN.lowIn))
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...r2[k])
      uv.push(r2[k][0] / 2, r2[k][2] / 2)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.computeVertexNormals()
    // keep faces outward whichever way the quads wound
    const n = g.attributes.normal
    const p = g.attributes.position
    for (let i = 0; i < p.count; i += 3) {
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3
      const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3
      if (n.getX(i) * cx + n.getZ(i) * cz + n.getY(i) * 0.01 < 0) {
        for (const attr of [p, g.attributes.uv]) {
          const k = attr.itemSize
          for (let c = 0; c < k; c++) {
            const t = attr.array[(i + 1) * k + c]
            attr.array[(i + 1) * k + c] = attr.array[(i + 2) * k + c]
            attr.array[(i + 2) * k + c] = t
          }
        }
      }
    }
    g.computeVertexNormals()
    return g
  }

  // wrought-iron railing panels: one alpha-cut texture, repeated along every run
  const ironTex = paintTexture(
    THREE,
    256,
    128,
    (g, w, h) => {
      g.clearRect(0, 0, w, h)
      g.strokeStyle = '#141617'
      g.lineWidth = 5
      g.strokeRect(0, 3, w, h - 6)
      g.lineWidth = 3
      for (let x = 0; x <= w; x += w / 8) {
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x, h)
        g.stroke()
      }
      // scrolls and rings between the bars
      g.lineWidth = 2.5
      for (let x = w / 16; x < w; x += w / 8) {
        g.beginPath()
        g.ellipse(x, h * 0.32, w / 22, h * 0.13, 0, 0, Math.PI * 2)
        g.stroke()
        g.beginPath()
        g.arc(x - w / 32, h * 0.66, w / 36, -Math.PI / 2, Math.PI)
        g.arc(x + w / 32, h * 0.66, w / 36, 0, Math.PI * 1.5, true)
        g.stroke()
      }
    },
    { kind: 'color' }
  )
  const ironPanelMat = new THREE.MeshStandardMaterial({ map: ironTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 })
  const panels = []
  const rails = beamBatch(THREE)
  const dormers = []
  const chimneys = []
  const cafes = []

  /** A Haussmann block: footprint w × d (multiples of BAY), centred at (x, z). */
  function haussmann(x, z, w, d, i, { awnings = false, y0 = 0 } = {}) {
    const mat = facades[i % facades.length]
    B.box(shop.material, shop.tile, w, GROUND, d, x, y0, z)
    B.box(mat, fac.tile, w, UPPER * ST, d, x, y0 + GROUND, z)
    // string course over the shops, the cornice, the two balcony slabs
    B.box(stone, STONE_T, w + 0.3, 0.35, d + 0.3, x, y0 + GROUND - 0.1, z)
    B.box(stone, STONE_T, w + 0.9, 0.55, d + 0.9, x, y0 + H - 0.2, z)
    const slabs = [y0 + GROUND + ST, y0 + GROUND + 4 * ST]
    for (const y of slabs) B.box(stone, STONE_T, w + 1.8, 0.2, d + 1.8, x, y - 0.2, z)
    const mg = mansardGeo(w, d)
    mg.translate(x, y0 + H + 0.35, z)
    B.add(zinc, mg)
    // the four faces: balconies, window guards, dormers
    const faces = [
      { nx: 0, nz: 1, len: w, cx: x, cz: z + d / 2 },
      { nx: 0, nz: -1, len: w, cx: x, cz: z - d / 2 },
      { nx: 1, nz: 0, len: d, cx: x + w / 2, cz: z },
      { nx: -1, nz: 0, len: d, cx: x - w / 2, cz: z },
    ]
    for (const f of faces) {
      const tx = -f.nz
      const tz = f.nx
      const at = (o, out, y) => new THREE.Vector3(f.cx + tx * o + f.nx * out, y, f.cz + tz * o + f.nz * out)
      const ry = Math.atan2(f.nx, f.nz)
      for (const y of slabs) {
        const a = at(-f.len / 2 - 0.85, 0.88, y + 1.0)
        const b = at(f.len / 2 + 0.85, 0.88, y + 1.0)
        rails.add(a, b, 0.06, 0.05)
        const p = new THREE.PlaneGeometry(f.len + 1.7, 0.95)
        const uv = p.attributes.uv
        for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * ((f.len + 1.7) / 1.4))
        p.rotateY(ry)
        const c = at(0, 0.88, y + 0.5)
        p.translate(c.x, c.y, c.z)
        panels.push(p)
      }
      const nb = Math.round(f.len / BAY)
      for (let k = 0; k < nb; k++) {
        const o = -f.len / 2 + (k + 0.5) * BAY
        // guards on the 1st, 3rd and 4th floors
        for (const s of [0, 2, 3]) {
          const y = y0 + GROUND + s * ST + 0.72
          const p = new THREE.PlaneGeometry(1.5, 0.62)
          p.rotateY(ry)
          const c = at(o, 0.1, y)
          p.translate(c.x, c.y, c.z)
          panels.push(p)
        }
        if (k % 2 === 0 || nb < 4) dormers.push({ p: at(o, -MAN.lowIn * 0.55, y0 + H + 0.35 + 0.1), ry })
        if (k % 4 === 1) chimneys.push(at(o, -MAN.highIn + 0.3, y0 + H + MAN.low + MAN.high - 0.6))
        const cafeFace = awnings === true ? f.nz === -1 : awnings === 'east' ? f.nx === 1 : awnings === 'west' ? f.nx === -1 : false
        if (cafeFace && k < 12) cafes.push({ p: at(o, 0, y0), ry, tx, tz, nx: f.nx, nz: f.nz })
      }
    }
  }

  // the detailed street west of the Champ de Mars (both sides)
  const blockLen = 28 * BAY // 100.8 m
  const blockDepth = 12 * BAY
  let bi = 0
  for (let k = 0; k < 4; k++) {
    const x1 = -152 - k * (blockLen + 16)
    const cx = x1 - blockLen / 2
    haussmann(cx, STREET_Z + STREET_HALF + blockDepth / 2, blockLen, blockDepth, bi++, { awnings: k === 0 || k === 2 })
    haussmann(cx, STREET_Z - STREET_HALF - blockDepth / 2, blockLen, blockDepth, bi++)
  }
  // and a row facing the Champ de Mars on the other side too (Avenue de La Bourdonnais)
  for (let k = 0; k < 4; k++) {
    const cz = -140 - k * (blockLen * 0.5 + 16) - blockLen / 4
    haussmann(152 + blockDepth / 2, cz, blockDepth, blockLen / 2, bi++)
    haussmann(-152 - blockDepth / 2, cz - 60, blockDepth, blockLen / 2, bi++)
  }
  // pavements, kerbs, lamps and parked cars along the street
  const streetX0 = -152 - 4 * (blockLen + 16)
  const streetLen = -152 - streetX0
  for (const sz of [-1, 1]) {
    B.box(pave, [3, 3], streetLen, 0.14, 6, (streetX0 - 152) / 2, 0, STREET_Z + sz * (STREET_HALF - 3))
  }
  B.box(pave, [3, 3], 10, 0.14, 300, -146, 0, -150)
  const lampSpots = []
  const carSpots = []
  for (let x = -165; x > streetX0; x -= 24) {
    lampSpots.push({ x, z: STREET_Z + STREET_HALF - 5.5, ry: Math.PI / 2 }, { x: x - 12, z: STREET_Z - STREET_HALF + 5.5, ry: Math.PI / 2 })
  }
  for (const sz of [-1, 1]) {
    for (let x = -170; x > streetX0 + 5; x -= range(rand, 5.2, 6.4)) {
      if (rand() < 0.22) {
        x -= 4
        continue
      }
      carSpots.push({ x, z: STREET_Z + sz * 4.9, ry: range(rand, -0.02, 0.02) })
    }
  }
  // along the quays and the Champ de Mars avenues
  for (let x = -600; x <= 600; x += 30) {
    if (Math.abs(x) < 25) continue
    lampSpots.push({ x, z: RIVER_S - 2.2 }, { x, z: RIVER_N + 2.2 })
    carSpots.push({ x: x + 8, z: RIVER_S - 27.5, ry: 0 }, { x: x + 14, z: RIVER_N + 32, ry: Math.PI })
  }
  for (let z = -150; z > -900; z -= 30) lampSpots.push({ x: -146, z }, { x: 146, z })
  // the Louvre, the Tuileries, the café and the flatiron, Montmartre (photos 15–23)
  const bank = rightBank(THREE, scene, { B, stone, STONE_T, flags, gravel, pave, zinc, ironMat, haussmann, mansardGeo, weather, addParisLamps, rand, low, q, basinMat })
  addParisLamps(THREE, scene, lampSpots, { double: true })
  addParisLamps(THREE, scene, [-15.5, 15.5].flatMap((x) => [200, 235, 270].map((z) => ({ x, y: 0.15, z }))))
  addCars(THREE, scene, low ? carSpots.filter((_, i) => i % 2 === 0) : carSpots, 51)

  // café awnings and terrace tables on the corner blocks
  if (cafes.length) {
    // canvas awnings: café red, bottle green, navy, a mustard one (instance colours)
    const awn = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })
    const awnCols = [0x9b1c24, 0x1f5a3c, 0x1d2f5e, 0x9b1c24, 0xc8952c, 0x7a1830]
    const awnC = new THREE.Color()
    const awnGeo = new THREE.BoxGeometry(BAY - 0.15, 0.08, 2.4).rotateX(0.32).translate(0, 3.25, 1.15)
    const valance = new THREE.BoxGeometry(BAY - 0.15, 0.32, 0.04).translate(0, 2.72, 2.3)
    const awnings = new THREE.InstancedMesh(mergeGeometries([awnGeo, valance], false), awn, cafes.length)
    const table = mergeGeometries(
      [new THREE.CylinderGeometry(0.32, 0.32, 0.03, 14).translate(0, 0.74, 0), new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6).translate(0, 0.37, 0), new THREE.CylinderGeometry(0.2, 0.22, 0.03, 10).translate(0, 0.015, 0)],
      false
    )
    const chair = mergeGeometries(
      [new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(0, 0.46, 0), new THREE.BoxGeometry(0.42, 0.45, 0.04).translate(0, 0.7, -0.2), new THREE.BoxGeometry(0.03, 0.46, 0.03).translate(0.18, 0.23, 0.18), new THREE.BoxGeometry(0.03, 0.46, 0.03).translate(-0.18, 0.23, 0.18), new THREE.BoxGeometry(0.03, 0.46, 0.03).translate(0.18, 0.23, -0.18), new THREE.BoxGeometry(0.03, 0.46, 0.03).translate(-0.18, 0.23, -0.18)],
      false
    )
    const tables = new THREE.InstancedMesh(table, ironMat, cafes.length)
    const rattan = new THREE.MeshStandardMaterial({ color: 0x9a7b55, roughness: 0.85 })
    const chairs = new THREE.InstancedMesh(chair, rattan, cafes.length * 2)
    const m4 = new THREE.Matrix4()
    cafes.forEach((c, i) => {
      m4.makeRotationY(c.ry).setPosition(c.p.x, c.p.y + 0.14, c.p.z)
      awnings.setMatrixAt(i, m4)
      awnings.setColorAt(i, awnC.setHex(awnCols[Math.floor(i / 3) % awnCols.length]))
      const tx = c.p.x + c.nx * 1.4
      const tz = c.p.z + c.nz * 1.4
      m4.makeRotationY(c.ry).setPosition(tx, c.p.y + 0.14, tz)
      tables.setMatrixAt(i, m4)
      for (const s of [-1, 1]) {
        m4.makeRotationY(c.ry + (s > 0 ? Math.PI / 2 : -Math.PI / 2)).setPosition(tx + c.tx * s * 0.6, c.p.y + 0.14, tz + c.tz * s * 0.6)
        chairs.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), m4)
      }
    })
    for (const mesh of [awnings, tables, chairs]) {
      mesh.castShadow = true
      scene.add(mesh)
    }
  }

  // the distant city: the same blocks, instanced, fading into the haze
  const sizes = [
    [14 * BAY, 10 * BAY],
    [20 * BAY, 12 * BAY],
    [10 * BAY, 10 * BAY],
  ]
  const far = sizes.map(() => [])
  const reach = low ? 1100 : 1600
  for (let gx = -reach; gx <= reach; gx += 82) {
    for (let gz = -reach; gz <= reach + 400; gz += 74) {
      const x = gx + range(rand, -5, 5)
      const z = gz + range(rand, -5, 5)
      const ax = Math.abs(x)
      if (ax < 240 && z < 345) continue // tower, Champ de Mars, avenues
      if (z > 110 && z < 350) continue // the Seine and its quays
      if (ax < 360 && z >= 345 && z < 1000) continue // the Trocadéro
      if (x > streetX0 - 70 && x < -110 && z > -260 && z < 50) continue // the detailed street
      if (ax < 260 && z < -100 && z > -700) continue
      if (x > 236 && x < 1030 && z > 284 && z < 742) continue // the Louvre quarter and its hill
      const y = ax < 360 && z >= 1000 && z < 1400 ? PARVIS_Y : 0
      far[Math.floor(rand() * sizes.length)].push({ x, z, y, ry: rand() < 0.5 ? 0 : Math.PI / 2 })
    }
  }
  // the plateau behind Chaillot (Place du Trocadéro)
  B.box(stone, STONE_T, 720, PARVIS_Y, 400, 0, 0, 1200)
  flat(asphalt, 6, 0, 1200, 720, 400, PARVIS_Y + 0.02)
  const m4 = new THREE.Matrix4()
  const tone = new THREE.Color()
  const STONE_TONES = [0xffffff, 0xfff1dc, 0xf3d6a6, 0xffe8c4, 0xe9ddca, 0xfbe2b6, 0xf7f3ec, 0xeccb97]
  const ZINC_TONES = [0xffffff, 0xdfe8f2, 0xc7d0da, 0xe8ecef, 0xb3bfcc]
  const qy = new THREE.Quaternion()
  const yAx = new THREE.Vector3(0, 1, 0)
  sizes.forEach(([w, d], si) => {
    const list = far[si]
    if (!list.length) return
    const bodyGeo = M.box(THREE, w, H, d, fac.material, fac.tile).geometry
    const manGeo = mansardGeo(w, d).translate(0, H, 0)
    // one instanced mesh per block size; every block its own limestone tone
    // and its own zinc (instance colours), so the city reads as many buildings
    const bodies = new THREE.InstancedMesh(bodyGeo, fac.material, list.length)
    const roofs = new THREE.InstancedMesh(manGeo, zinc, list.length)
    list.forEach((b, i) => {
      qy.setFromAxisAngle(yAx, b.ry)
      const hk = range(rand, 0.92, 1.06)
      m4.compose(new THREE.Vector3(b.x, b.y, b.z), qy, new THREE.Vector3(1, hk, 1))
      bodies.setMatrixAt(i, m4)
      bodies.setColorAt(i, tone.setHex(pick(rand, STONE_TONES)))
      m4.compose(new THREE.Vector3(b.x, b.y + H * (hk - 1), b.z), qy, new THREE.Vector3(1, 1, 1))
      roofs.setMatrixAt(i, m4)
      roofs.setColorAt(i, tone.setHex(pick(rand, ZINC_TONES)))
    })
    bodies.receiveShadow = true
    bodies.castShadow = false
    scene.add(bodies, roofs)
  })

  // dormers, chimneys and iron for the detailed blocks
  {
    const dormerGeo = mergeGeometries(
      [M.box(THREE, 1.5, 2.0, 1.5, stone, STONE_T).geometry, new THREE.ConeGeometry(1.15, 0.7, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 1.15).translate(0, 2.35, 0).toNonIndexed()].map((g) => {
        const n = g.index ? g.toNonIndexed() : g
        return n
      }),
      false
    )
    const winGeo = new THREE.PlaneGeometry(0.85, 1.25).translate(0, 1.05, 0.76)
    const dormerMesh = new THREE.InstancedMesh(dormerGeo, stone, dormers.length)
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x1d2329, roughness: 0.05, metalness: 0.6, clearcoat: 1 })
    const winMesh = new THREE.InstancedMesh(winGeo, glassMat, dormers.length)
    dormers.forEach((dm, i) => {
      m4.makeRotationY(dm.ry).setPosition(dm.p.x, dm.p.y, dm.p.z)
      dormerMesh.setMatrixAt(i, m4)
      winMesh.setMatrixAt(i, m4)
    })
    dormerMesh.castShadow = true
    scene.add(dormerMesh, winMesh)
    const stack = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2.4, 0.9).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0xe0c99f, roughness: 0.9 }), chimneys.length)
    const pots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.15, 0.6, 6, 1, true).translate(0, 2.7, 0), new THREE.MeshStandardMaterial({ color: 0xbc5a36, roughness: 0.85 }), chimneys.length * 4)
    chimneys.forEach((c, i) => {
      m4.makeTranslation(c.x, c.y, c.z)
      stack.setMatrixAt(i, m4)
      for (let k = 0; k < 4; k++) {
        m4.makeTranslation(c.x - 0.8 + k * 0.53, c.y, c.z)
        pots.setMatrixAt(i * 4 + k, m4)
      }
    })
    stack.castShadow = true
    scene.add(stack, pots)
    if (panels.length) {
      const pm = new THREE.Mesh(mergeGeometries(panels, false), ironPanelMat)
      pm.layers.set(NO_INK_LAYER)
      scene.add(pm)
    }
    scene.add(rails.build(ironMat, { castShadow: false }))
  }

  B.flush()
  BN.flush({ shadow: false })

  /* --- viewpoints ------------------------------------------------------- */
  const spot = (px, py, pz, lx, ly, lz) => ({ pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz) })
  const stairY = (x) => PARVIS_Y - ((Math.abs(x) - FLIGHT.x0) / (FLIGHT.x1 - FLIGHT.x0)) * (PARVIS_Y - TERRACE_Y)
  // One viewpoint per photograph, where it was taken from. The hero (photo 8)
  // is spot 0; then photos 1–7, 9–23 in order (views: [1,2,3,4,5,6,7,0,8,…,22]).
  const T = (p, l) => spot(p[0], p[1], p[2], l[0], l[1], l[2])
  const spots = [
    // 0 · photo 8: low on the west flight, the parapet climbing to the right, the tower over it
    T([-73, stairY(-73) + 1.6, 699], [141, 138, 0]),
    // 1 · photo 1: on the parvis close to the couple, the tower off to the left
    T([6, PARVIS_Y + 1.65, 691], [180, 45, 0]),
    // 2 · photo 2: behind them at the parapet, on the axis, the tower dead ahead
    T([0.5, PARVIS_Y + 1.6, 694], [0, 48, 0]),
    // 3 · photo 3: facing the parapet square on, the tower above it
    T([-2.5, PARVIS_Y + 1.6, 700], [2, 38, 0]),
    // 4 · photo 4: at the back of the east flight, down its length to the tower
    T([60.5, stairY(60.5) + 1.7, 711], [-6, 12, 0]),
    // 5 · photo 5: on the west flight, across the steps to the parapet and the gardens below
    T([-66, stairY(-66) + 1.6, 702], [35, 95, 0]),
    // 6 · photo 6: at the parvis's edge, down over the terrace and the gardens
    T([7, PARVIS_Y + 2.2, 688.5], [0, -55, 230]),
    // 7 · photo 7: close by the flight's parapet, the tower huge beyond
    T([-60, stairY(-60) + 1.6, 690], [-96, 75, 0]),
    // 8 · photo 9: at the top of the west flight, down the steps to the terrace and its balustrade
    T([-57, PARVIS_Y + 1.7, 706], [-260, 0, 0]),
    // 9 · photo 10: low, on the parvis bands, the parapet across and the tower centred
    T([1, PARVIS_Y + 1.2, 712], [0, 52, 0]),
    // 10 · photo 11: a little west, the tower filling the sky
    T([-6, PARVIS_Y + 1.5, 705], [-1, 72, 0]),
    // 11 · photo 12: by the parapet, the tower behind and left
    T([9, PARVIS_Y + 1.55, 696], [-14, 58, 0]),
    // 12 · photo 13: behind the rounded end block of the parapet, the tower straight beyond it
    T([-47.4, PARVIS_Y + 1.5, 693.5], [0, 52, 0]),
    // 13 · photo 14: on the Pont d'Iéna by its parapet, up at the tower
    T([4, 1.6, 186], [-7, 64, 0]),
    // 14–22 · photos 15–23: the Louvre, the Passage Richelieu, the café, the flatiron, its glass room, the Tuileries, Montmartre
    bank.views[15],
    bank.views[16],
    bank.views[17],
    bank.views[18],
    bank.views[19],
    bank.views[20],
    bank.views[21],
    bank.views[22],
    bank.views[23],
  ]
  world.focusShadows(new THREE.Vector3(40, 10, 640), 80)
  const zones = [
    { at: [0, 700], c: new THREE.Vector3(40, 10, 640), r: 80 },
    { at: [-12, 187], c: new THREE.Vector3(0, 20, 110), r: 115 },
    { at: [797, 480], c: new THREE.Vector3(790, 0, 440), r: 100 },
    { at: [820, 585], c: new THREE.Vector3(838, 0, 580), r: 75 },
    { at: [596, 501], c: new THREE.Vector3(640, 0, 500), r: 90 },
    { at: [350, 505], c: new THREE.Vector3(345, 6, 525), r: 70 },
  ]
  let zone = 0

  const s0 = spots[0]
  const path = {
    positions: [
      new THREE.Vector3(-420, 260, 1350),
      new THREE.Vector3(-160, 130, 1050),
      new THREE.Vector3(0, 52, 820),
      new THREE.Vector3(40, 26, 694),
      s0.pos.clone(),
    ],
    targets: [
      new THREE.Vector3(0, 160, 0),
      new THREE.Vector3(0, 140, 0),
      new THREE.Vector3(20, 90, 200),
      new THREE.Vector3(70, 40, 500),
      s0.look.clone(),
    ],
    fov: 50,
    near: 0.3,
    spots,
  }

  function groundAt(x, z) {
    if (x > 236) return bank.groundAt(x, z)
    const ax = Math.abs(x)
    if (z >= FLIGHT.z0 && ax < FLIGHT.x0) return PARVIS_Y
    if (z >= FLIGHT.z0 && z <= FLIGHT.z1 && ax <= FLIGHT.x1) return stairY(x)
    if (z >= GARDEN_TOP && z < FLIGHT.z0 && ax < 230) return TERRACE_Y
    if (z >= GARDEN_FOOT && z < GARDEN_TOP && ax < 230) return ((z - GARDEN_FOOT) / (GARDEN_TOP - GARDEN_FOOT)) * TERRACE_Y
    return 0
  }

  return {
    scene,
    world,
    path,
    groundAt,
    clearance: 1.2,
    update(t) {
      for (const f of tickers) f(t)
      // keep the sun's (static) shadow map over whichever part of Paris the view is in
      const cam = this && this.camera
      if (cam) {
        let best = 0
        let bd = Infinity
        for (let i = 0; i < zones.length; i++) {
          const d = (cam.position.x - zones[i].at[0]) ** 2 + (cam.position.z - zones[i].at[1]) ** 2
          if (d < bd) {
            bd = d
            best = i
          }
        }
        if (best !== zone) {
          zone = best
          world.focusShadows(zones[best].c, zones[best].r)
        }
      }
    },
  }
}
