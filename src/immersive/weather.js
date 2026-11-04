/**
 * Weathering: what makes a modelled place look lived in rather than freshly
 * rendered. Every solid surface gets, in world space (so nothing repeats
 * with its texture):
 *
 *  - broad, soft patchiness in its colour — sun-faded here, damp there
 *  - a fine mottle, like the grain of real stone, paint and metal
 *  - faint streaks running down walls, where rain has carried the dirt
 *  - a little dust settled on what faces up (ledges, sills, tops)
 *  - roughness that varies with all of the above, so highlights break up
 *
 * All of it is a few lines in the materials' own shaders — no textures to
 * download. Glass, water, foliage, lamps and signs are left alone.
 */

const VERT_DECL = /* glsl */ `
varying vec3 vWthPos;
varying vec3 vWthNrm;
`
const VERT_MAIN = /* glsl */ `
#include <project_vertex>
{
  vec4 wthP = vec4(transformed, 1.0);
  vec3 wthN = objectNormal;
  #ifdef USE_INSTANCING
    wthP = instanceMatrix * wthP;
    wthN = mat3(instanceMatrix) * wthN;
  #endif
  vWthPos = (modelMatrix * wthP).xyz;
  vWthNrm = normalize(mat3(modelMatrix) * wthN);
}
`
const FRAG_DECL = /* glsl */ `
varying vec3 vWthPos;
varying vec3 vWthNrm;
float wthHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float wthNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wthHash(i), wthHash(i + vec3(1, 0, 0)), f.x), mix(wthHash(i + vec3(0, 1, 0)), wthHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(wthHash(i + vec3(0, 0, 1)), wthHash(i + vec3(1, 0, 1)), f.x), mix(wthHash(i + vec3(0, 1, 1)), wthHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float wthPatch;
`
const FRAG_COLOR = /* glsl */ `
#include <map_fragment>
{
  vec3 P = vWthPos;
  vec3 N = normalize(vWthNrm);
  // broad patches (a few metres) and a fine mottle (centimetres)
  wthPatch = wthNoise(P * 0.35) * 0.65 + wthNoise(P * 1.3 + 7.0) * 0.35;
  float mottle = wthNoise(P * 9.0 + 3.0);
  float k = WTH_AMOUNT;
  vec3 col = diffuseColor.rgb;
  col *= 1.0 + k * ((wthPatch - 0.5) * 0.32 + (mottle - 0.5) * 0.1);
  // damp, darker patches drift a little cooler; sun-faded ones a little warmer and paler
  col = mix(col, col * vec3(1.03, 1.0, 0.95) + 0.015, k * smoothstep(0.62, 0.85, wthPatch));
  col = mix(col, col * vec3(0.94, 0.96, 1.0), k * smoothstep(0.38, 0.15, wthPatch));
  // rain streaks down walls: long in y, narrow across
  float wall = 1.0 - abs(N.y);
  float across = dot(P.xz, normalize(vec2(-N.z, N.x) + 1e-4));
  float streak = wthNoise(vec3(across * 2.4, P.y * 0.18, 1.7)) * wthNoise(vec3(across * 0.7, P.y * 0.5, 4.2));
  col *= 1.0 - k * wall * smoothstep(0.32, 0.6, streak) * 0.14;
  // dust on what faces up
  float up = smoothstep(0.75, 0.98, N.y);
  float l = dot(col, vec3(0.333));
  col = mix(col, vec3(l) * vec3(1.02, 1.0, 0.96) + 0.03, k * up * 0.12 * smoothstep(0.35, 0.75, wthPatch));
  diffuseColor.rgb = col;
}
`
const FRAG_ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor * (1.0 + WTH_AMOUNT * (wthPatch - 0.5) * 0.5), 0.03, 1.0);
`

function skip(m) {
  if (!m || !m.isMeshStandardMaterial) return true
  if (m.userData?.noWeather) return true
  if (m.transparent || m.alphaTest > 0 || m.transmission > 0) return true
  if (m.emissive && m.emissiveIntensity > 0.6 && (m.emissive.r + m.emissive.g + m.emissive.b > 0.3)) return true
  return false
}

/** Weather every solid surface in a place. amount: 0..1 (about 1 outdoors, less inside). */
export function weatherScene(scene, { amount = 1 } = {}) {
  const done = new Set()
  scene.traverse((o) => {
    if (!o.isMesh || o.isSprite) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (done.has(m) || skip(m)) continue
      done.add(m)
      weatherMaterial(m, amount)
    }
  })
}

export function weatherMaterial(m, amount = 1) {
  const prev = m.onBeforeCompile
  const prevKey = m.customProgramCacheKey()
  m.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r)
    // only when the material's shader still has the usual places to hook in
    if (!sh.vertexShader.includes('#include <project_vertex>') || !sh.fragmentShader.includes('#include <map_fragment>')) return
    sh.vertexShader = VERT_DECL + sh.vertexShader.replace('#include <project_vertex>', VERT_MAIN)
    sh.fragmentShader =
      `#define WTH_AMOUNT ${amount.toFixed(3)}\n` +
      FRAG_DECL +
      sh.fragmentShader.replace('#include <map_fragment>', FRAG_COLOR).replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
  }
  m.customProgramCacheKey = () => prevKey + '|wth' + amount.toFixed(2)
  m.needsUpdate = true
}
