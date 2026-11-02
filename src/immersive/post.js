/**
 * The final image: what turns a 3D render into an illustration.
 *
 *  1. The scene renders into an HDR target (anti-aliased on capable devices).
 *  2. A second, cheap pass renders surface normals and depth.
 *  3. One composite shader then
 *       - smooths colour into painted patches (a small Kuwahara filter),
 *       - draws soft ink lines where depth or surface direction changes,
 *         fading with distance the way a painter loses detail in the haze,
 *       - rolls off highlights gently (mid-tones stay exactly as authored),
 *       - grades warm, adds a soft vignette and fine film grain,
 *       - and paints a layer of clouds over everything when travelling
 *         between places (uCloud 0 → 1).
 *
 * Objects on layer 2 (sprites, transparent decals, wind-blown grass) are
 * skipped by the normal pass so they never get outlined.
 */
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { NOISE_GLSL } from './world.js'

export const NO_INK_LAYER = 2

export function createPost(THREE, renderer, { quality = 'high' } = {}) {
  const high = quality !== 'low'

  const color = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    samples: high ? 4 : 0,
  })
  const depthTexture = new THREE.DepthTexture(2, 2)
  const normals = new THREE.WebGLRenderTarget(2, 2, { depthTexture })
  const normalMaterial = new THREE.MeshNormalMaterial()

  const uniforms = {
    tColor: { value: color.texture },
    tNormal: { value: normals.texture },
    tDepth: { value: depthTexture },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.3 },
    uFar: { value: 20000 },
    uInk: { value: new THREE.Color(0x3a2a24) },
    uInkStrength: { value: 0.75 },
    uExposure: { value: 1 },
    uTime: { value: 0 },
    uGrain: { value: high ? 0.045 : 0.03 },
    uVignette: { value: 0.32 },
    uSaturation: { value: 1.06 },
    uWarmth: { value: new THREE.Color(0xfff0e0) },
    uCloud: { value: 0 },
    uCloudLit: { value: new THREE.Color(0xfff4ea) },
    uCloudShade: { value: new THREE.Color(0xe2c7b8) },
    uFade: { value: 0 },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    defines: high ? { KUWAHARA: 1 } : {},
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform sampler2D tColor; uniform sampler2D tNormal; uniform sampler2D tDepth;
      uniform vec2 uRes; uniform vec2 uTexel; uniform float uNear; uniform float uFar;
      uniform vec3 uInk; uniform float uInkStrength; uniform float uExposure; uniform float uTime;
      uniform float uGrain; uniform float uVignette; uniform float uSaturation; uniform vec3 uWarmth;
      uniform float uCloud; uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform float uFade;
      varying vec2 vUv;
      ${NOISE_GLSL}

      float viewDepth(vec2 uv) {
        float d = texture2D(tDepth, uv).x;
        if (d >= 1.0) return uFar;
        return -perspectiveDepthToViewZ(d, uNear, uFar);
      }
      vec3 normalAt(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

      vec3 shoulder(vec3 c) {
        // leave everything below 0.8 untouched, roll off what's above it
        vec3 over = max(c - 0.8, 0.0);
        return min(c, 0.8) + 0.2 * (1.0 - exp(-over / 0.2));
      }
      vec3 toSRGB(vec3 c) {
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      }

      #ifdef KUWAHARA
      // a small Kuwahara filter: each pixel takes the calmest of four
      // neighbouring patches, which flattens texture into brush-like areas
      vec3 painted(vec2 uv) {
        vec2 px = 1.0 / uRes;
        vec3 mean[4]; float var[4];
        for (int q = 0; q < 4; q++) {
          vec2 dir = vec2(q == 1 || q == 3 ? 1.0 : -1.0, q >= 2 ? 1.0 : -1.0);
          vec3 s = vec3(0.0); vec3 s2 = vec3(0.0);
          for (int i = 0; i <= 2; i++) {
            for (int j = 0; j <= 2; j++) {
              vec3 c = texture2D(tColor, uv + vec2(float(i), float(j)) * dir * px).rgb;
              s += c; s2 += c * c;
            }
          }
          mean[q] = s / 9.0;
          vec3 v = abs(s2 / 9.0 - mean[q] * mean[q]);
          var[q] = v.r + v.g + v.b;
        }
        vec3 best = mean[0]; float bv = var[0];
        for (int q = 1; q < 4; q++) if (var[q] < bv) { bv = var[q]; best = mean[q]; }
        return best;
      }
      #endif

      void main() {
        #ifdef KUWAHARA
          vec3 c = painted(vUv);
        #else
          vec3 c = texture2D(tColor, vUv).rgb;
        #endif

        // ink: where depth jumps (silhouettes) or the surface turns (creases)
        float z = viewDepth(vUv);
        vec3 n = normalAt(vUv);
        float dEdge = 0.0; float nEdge = 0.0;
        vec2 offs[4];
        offs[0] = vec2(uTexel.x, 0.0); offs[1] = vec2(-uTexel.x, 0.0);
        offs[2] = vec2(0.0, uTexel.y); offs[3] = vec2(0.0, -uTexel.y);
        for (int i = 0; i < 4; i++) {
          float zn = viewDepth(vUv + offs[i]);
          dEdge = max(dEdge, abs(zn - z) / max(min(z, zn), 1.0));
          nEdge = max(nEdge, 1.0 - dot(n, normalAt(vUv + offs[i])));
        }
        float ink = max(smoothstep(0.04, 0.12, dEdge), smoothstep(0.22, 0.55, nEdge) * step(z, uFar * 0.9));
        ink *= 1.0 - smoothstep(90.0, 700.0, z); // detail dissolves into the haze
        c = mix(c, c * uInk * 2.2, ink * uInkStrength);

        // exposure, highlight roll-off, display colour
        c = shoulder(c * uExposure);
        c = toSRGB(clamp(c, 0.0, 1.0));

        // grade: a little saturation, warm light, cooler shade
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        c *= mix(vec3(0.96, 0.98, 1.03), uWarmth, smoothstep(0.25, 0.85, l));

        // clouds for travelling between places
        if (uCloud > 0.001) {
          vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.4;
          float t = uTime * 0.05;
          float field = fbm(p + vec2(t, -t * 0.4)) * 0.7 + fbm(p * 2.1 - t) * 0.3;
          float cover = smoothstep(1.0 - uCloud * 1.25, 1.18 - uCloud * 1.25, field + uCloud * 0.35);
          float lit = smoothstep(0.35, 0.75, fbm(p * 1.3 + vec2(0.3, 0.6) + t));
          vec3 cc = mix(uCloudShade, uCloudLit, lit);
          c = mix(c, cc, clamp(cover, 0.0, 1.0));
        }

        // vignette and grain
        vec2 d = vUv - 0.5;
        c *= 1.0 - uVignette * smoothstep(0.2, 0.85, dot(d, d) * 2.2);
        float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        c += g * uGrain * (1.0 - l * 0.5);

        c = mix(c, vec3(0.02), uFade);
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const quad = new FullScreenQuad(material)
  const normalScale = high ? 1 : 0.5

  function setSize(w, h) {
    color.setSize(w, h)
    const nw = Math.max(2, Math.round(w * normalScale))
    const nh = Math.max(2, Math.round(h * normalScale))
    normals.setSize(nw, nh)
    uniforms.uRes.value.set(w, h)
    uniforms.uTexel.value.set(1 / nw, 1 / nh)
  }

  function render(scene, camera, { time = 0, exposure = 1 } = {}) {
    uniforms.uTime.value = time
    uniforms.uExposure.value = exposure
    uniforms.uNear.value = camera.near
    uniforms.uFar.value = camera.far

    // 1. colour, including the layer that never gets inked
    camera.layers.enable(NO_INK_LAYER)
    renderer.setRenderTarget(color)
    renderer.render(scene, camera)

    // 2. normals and depth, without that layer
    camera.layers.disable(NO_INK_LAYER)
    const fog = scene.fog
    scene.fog = null
    scene.overrideMaterial = normalMaterial
    renderer.setRenderTarget(normals)
    renderer.render(scene, camera)
    scene.overrideMaterial = null
    scene.fog = fog
    camera.layers.enable(NO_INK_LAYER)

    // 3. composite to the screen
    renderer.setRenderTarget(null)
    quad.render(renderer)
  }

  /** Just the cloud layer (and fade), over black — while the next place loads. */
  function renderClouds(time) {
    uniforms.uTime.value = time
    renderer.setRenderTarget(color)
    renderer.clear()
    renderer.setRenderTarget(normals)
    renderer.clear()
    renderer.setRenderTarget(null)
    quad.render(renderer)
  }

  return {
    uniforms,
    setSize,
    render,
    renderClouds,
    dispose() {
      color.dispose()
      normals.dispose()
      depthTexture.dispose()
      normalMaterial.dispose()
      material.dispose()
      quad.dispose()
    },
  }
}
