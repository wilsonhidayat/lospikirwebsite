/**
 * The illustrated look, applied to a finished scene.
 *
 * Every physically based material is swapped for a toon material that keeps
 * its colour, textures and glow but lights it in a few soft bands — the gentle
 * cel shading of a hand-painted background. Shaders written by hand (sky,
 * water) and sprites are left alone. Combined with the ink outlines and grade
 * in post.js, it reads like the reference illustration rather than a render.
 */

let gradient = null

/** Five soft tones from shade to light, filtered so the bands blend a little. */
export function toonGradient(THREE) {
  if (gradient) return gradient
  const tones = new Uint8Array([70, 120, 168, 214, 255])
  gradient = new THREE.DataTexture(tones, tones.length, 1, THREE.RedFormat)
  gradient.minFilter = THREE.LinearFilter
  gradient.magFilter = THREE.LinearFilter
  gradient.generateMipmaps = false
  gradient.needsUpdate = true
  return gradient
}

const KEEP = [
  'color',
  'map',
  'emissive',
  'emissiveMap',
  'emissiveIntensity',
  'normalMap',
  'normalScale',
  'bumpMap',
  'bumpScale',
  'alphaMap',
  'transparent',
  'opacity',
  'side',
  'vertexColors',
  'depthWrite',
  'depthTest',
  'blending',
  'polygonOffset',
  'polygonOffsetFactor',
  'polygonOffsetUnits',
  'fog',
  'name',
]

function toToon(THREE, m) {
  const t = new THREE.MeshToonMaterial({ gradientMap: toonGradient(THREE) })
  for (const k of KEEP) {
    if (m[k] === undefined) continue
    if (m[k] && typeof m[k].clone === 'function' && !m[k].isTexture) t[k] = m[k].clone()
    else t[k] = m[k]
  }
  // hand-written vertex animation (e.g. grass in the wind) carries over
  if (m.onBeforeCompile && m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
    t.onBeforeCompile = m.onBeforeCompile
    t.customProgramCacheKey = () => m.uuid
  }
  t.userData = { ...m.userData }
  return t
}

/** Convert every lit material in a scene to the illustrated toon look. */
export function stylize(THREE, scene) {
  const swapped = new Map()
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return
    const swap = (m) => {
      if (!m || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return m
      if (!swapped.has(m)) {
        swapped.set(m, toToon(THREE, m))
        m.dispose()
      }
      return swapped.get(m)
    }
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material)
  })
  return scene
}
