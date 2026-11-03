/**
 * The final image: what turns the raw render into something that reads like
 * a photograph.
 *
 *  1. The scene renders into an HDR target (anti-aliased on capable devices),
 *     lit by the sun, the sky's own image-based light, and soft shadows.
 *  2. A second, cheap pass renders surface normals and depth.
 *  3. Bright light (the sun, its glints on water, lamps, windows, fairy
 *     lights) is extracted at quarter resolution and blurred: lens bloom.
 *  4. Sun rays: the open sky around the sun, smeared toward it at quarter
 *     resolution, so light pours through gaps in clouds, trees and lattice.
 *  5. One composite shader then
 *       - adds ambient occlusion — the soft contact shadow in corners, under
 *         trees and where things meet the ground,
 *       - adds the bloom and the sun rays,
 *       - maps the HDR light to the screen with a filmic (ACES) curve,
 *       - matches the colour to the project's photographs (white balance and
 *         saturation, set per place),
 *       - and can "develop" the place out of the dark (uReveal 0 → 1).
 *
 * No grain, vignette or lens effects: the image is kept clean. The photos
 * themselves are never drawn here — they sit over the canvas as real <img>s.
 *
 * Objects on layer 2 (sprites, transparent water jets, glows) are skipped by
 * the normal pass.
 */
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { NOISE_GLSL } from './world.js'

export const NO_INK_LAYER = 2

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

export function createPost(THREE, renderer, { quality = 'high' } = {}) {
  const high = quality !== 'low'

  const color = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    samples: high ? 4 : 0,
  })
  const depthTexture = new THREE.DepthTexture(2, 2)
  const normals = new THREE.WebGLRenderTarget(2, 2, { depthTexture })
  const normalMaterial = new THREE.MeshNormalMaterial()
  // the floating camera only marks its pixels in the normal target (alpha 0),
  // leaving the place's depth underneath untouched
  const rigNormalMaterial = new THREE.ShaderMaterial({
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      void main() { gl_FragColor = vec4(0.5, 0.5, 1.0, 0.0); }`,
  })

  const quarter = { type: THREE.HalfFloatType, depthBuffer: false }
  const bloomA = new THREE.WebGLRenderTarget(2, 2, quarter)
  const bloomB = new THREE.WebGLRenderTarget(2, 2, quarter)
  const rays = new THREE.WebGLRenderTarget(2, 2, quarter)

  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: color.texture }, uThreshold: { value: 1.0 }, uExposure: { value: 1 } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor; uniform float uThreshold; uniform float uExposure;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tColor, vUv).rgb * uExposure;
        float l = max(c.r, max(c.g, c.b));
        // a soft knee, so the glow eases in rather than switching on
        float k = clamp(l - uThreshold + 0.5, 0.0, 1.0);
        float w = max(k * k * 0.5, l - uThreshold) / max(l, 1e-4);
        gl_FragColor = vec4(min(c * w, vec3(40.0)), 1.0);
      }`,
  })
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tInput: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tInput; uniform vec2 uDir;
      varying vec2 vUv;
      void main() {
        // 9-tap gaussian, using linear filtering to reach 17 texels
        vec3 c = texture2D(tInput, vUv).rgb * 0.1964825;
        c += texture2D(tInput, vUv + uDir * 1.411765).rgb * 0.2969069;
        c += texture2D(tInput, vUv - uDir * 1.411765).rgb * 0.2969069;
        c += texture2D(tInput, vUv + uDir * 3.294118).rgb * 0.0944703;
        c += texture2D(tInput, vUv - uDir * 3.294118).rgb * 0.0944703;
        c += texture2D(tInput, vUv + uDir * 5.176471).rgb * 0.0103813;
        c += texture2D(tInput, vUv - uDir * 5.176471).rgb * 0.0103813;
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const raysMat = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: color.texture },
      tNormal: { value: normals.texture },
      tDepth: { value: depthTexture },
      uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
    },
    defines: { RAY_SAMPLES: high ? 56 : 28 },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor; uniform sampler2D tNormal; uniform sampler2D tDepth;
      uniform vec2 uSun; uniform float uAspect;
      varying vec2 vUv;
      // the light a pixel lets through: bright open sky only
      float source(vec2 uv) {
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
        if (texture2D(tDepth, uv).x < 1.0) return 0.0;      // something solid
        if (texture2D(tNormal, uv).a < 0.5) return 0.0;     // the floating camera
        vec3 c = texture2D(tColor, uv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
        return max(l - 0.55, 0.0) * exp(-dot(d, d) * 5.0);
      }
      void main() {
        vec2 step = (vUv - uSun) / float(RAY_SAMPLES) * 0.9;
        vec2 uv = vUv;
        float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
        uv -= step * jitter;
        float sum = 0.0;
        float decay = 1.0;
        for (int i = 0; i < RAY_SAMPLES; i++) {
          sum += source(uv) * decay;
          decay *= 0.965;
          uv -= step;
        }
        gl_FragColor = vec4(vec3(sum / float(RAY_SAMPLES) * 6.0), 1.0);
      }`,
  })
  const brightQuad = new FullScreenQuad(brightMat)
  const blurQuad = new FullScreenQuad(blurMat)
  const raysQuad = new FullScreenQuad(raysMat)

  const uniforms = {
    tColor: { value: color.texture },
    tNormal: { value: normals.texture },
    tDepth: { value: depthTexture },
    tBloom: { value: bloomA.texture },
    tRays: { value: rays.texture },
    uRes: { value: new THREE.Vector2(1, 1) },
    uProjInv: { value: new THREE.Matrix4() },
    uProjScale: { value: 1 },
    uAO: { value: high ? 1 : 0.7 },
    uAORadius: { value: 1.4 }, // metres
    uBloom: { value: 0.1 },
    uRays: { value: 0 },
    uRayColor: { value: new THREE.Color(0xfff0d8) },
    uExposure: { value: 1 },
    uTime: { value: 0 },
    // the place's colour, matched to its photographs: a gentle white
    // balance (display-space multipliers) and saturation
    uSaturation: { value: 1.0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uCloud: { value: 0 },
    uCloudLit: { value: new THREE.Color(0xfff4ea) },
    uCloudShade: { value: new THREE.Color(0xe2c7b8) },
    uFade: { value: 0 },
    // 0 → 1: the place develops out of the dark in soft patches
    uReveal: { value: 1 },
    uRevealColor: { value: new THREE.Vector3(0.043, 0.043, 0.047) },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    defines: { AO_SAMPLES: high ? 12 : 6 },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor; uniform sampler2D tNormal; uniform sampler2D tDepth;
      uniform sampler2D tBloom; uniform sampler2D tRays;
      uniform vec2 uRes; uniform mat4 uProjInv; uniform float uProjScale;
      uniform float uAO; uniform float uAORadius; uniform float uBloom; uniform float uRays; uniform vec3 uRayColor;
      uniform float uExposure; uniform float uTime;
      uniform float uSaturation; uniform vec3 uTint;
      uniform float uCloud; uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform float uFade;
      uniform float uReveal; uniform vec3 uRevealColor;
      varying vec2 vUv;
      ${NOISE_GLSL}

      vec3 toSRGB(vec3 c) {
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      }
      // ACES filmic, as fitted by Stephen Hill (the curve three.js uses)
      vec3 rrtOdt(vec3 v) {
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return a / b;
      }
      vec3 aces(vec3 c) {
        const mat3 IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
        const mat3 OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
        return clamp(OUT * rrtOdt(IN * c), 0.0, 1.0);
      }

      vec3 viewPos(vec2 uv, float d) {
        vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return v.xyz / v.w;
      }

      // scalable ambient obscurance: how much of the hemisphere above each
      // point is closed in by nearby surfaces
      float occlusion(vec2 uv) {
        float d = texture2D(tDepth, uv).x;
        vec4 nt = texture2D(tNormal, uv);
        if (d >= 1.0 || nt.a < 0.5) return 1.0;
        vec3 p = viewPos(uv, d);
        vec3 n = normalize(nt.xyz * 2.0 - 1.0);
        float radiusPx = uAORadius * uProjScale / max(-p.z, 0.1);
        if (radiusPx < 1.5) return 1.0;
        radiusPx = min(radiusPx, 80.0);
        float spin = fract(sin(dot(uv * uRes, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
        float sum = 0.0;
        for (int i = 0; i < AO_SAMPLES; i++) {
          float t = (float(i) + 0.5) / float(AO_SAMPLES);
          float a = t * 6.2831 * 2.6 + spin;
          vec2 su = uv + vec2(cos(a), sin(a)) * t * radiusPx / uRes;
          float sd = texture2D(tDepth, su).x;
          if (sd >= 1.0) continue;
          vec3 v = viewPos(su, sd) - p;
          float vv = dot(v, v);
          float fall = max(0.0, 1.0 - vv / (uAORadius * uAORadius * 4.0));
          sum += fall * max(0.0, dot(v, n) + p.z * 0.0015) / (vv + 0.02);
        }
        return clamp(1.0 - 2.0 * sum / float(AO_SAMPLES), 0.0, 1.0);
      }

      void main() {
        vec3 c = texture2D(tColor, vUv).rgb;
        if (uAO > 0.0) c *= mix(1.0, occlusion(vUv), uAO);

        vec3 glow = texture2D(tBloom, vUv).rgb * uBloom + texture2D(tRays, vUv).r * uRays * uRayColor;
        // the film curve, then the photographs' own colour
        c = toSRGB(aces((c * uExposure + glow) / 0.6));
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation) * uTint;

        // developing: the place comes up out of the dark in soft patches
        if (uReveal < 0.999) {
          vec2 q = vUv * vec2(uRes.x / uRes.y, 1.0);
          float n = fbm(q * 2.4) * 0.75 + fbm(q * 9.0 + 3.0) * 0.25;
          float edge = uReveal * 1.45 - 0.22;
          float m = smoothstep(edge - 0.1, edge + 0.1, n);
          c = mix(c, uRevealColor, m);
        }

        // clouds for travelling between places
        if (uCloud > 0.001) {
          vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.4;
          float t = uTime * 0.05;
          float field = fbm(p + vec2(t, -t * 0.4)) * 0.7 + fbm(p * 2.1 - t) * 0.3;
          float cover = smoothstep(1.0 - uCloud * 1.25, 1.3 - uCloud * 1.25, field + uCloud * 0.35);
          float lit = smoothstep(0.3, 0.8, fbm(p * 1.3 + vec2(0.3, 0.6) + t));
          vec3 cc = toSRGB(mix(uCloudShade, uCloudLit, lit));
          c = mix(c, cc, clamp(cover, 0.0, 1.0));
        }

        c = mix(c, vec3(0.02), uFade);
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const quad = new FullScreenQuad(material)

  function setSize(w, h) {
    color.setSize(w, h)
    normals.setSize(w, h)
    const qw = Math.max(2, Math.round(w / 4))
    const qh = Math.max(2, Math.round(h / 4))
    bloomA.setSize(qw, qh)
    bloomB.setSize(qw, qh)
    rays.setSize(qw, qh)
    uniforms.uRes.value.set(w, h)
    raysMat.uniforms.uAspect.value = w / h
  }

  /** Draw `overlay` ({ scene, camera }) on top of what's already in the target. */
  function drawOver(overlay, normalsPass) {
    if (!overlay) return
    const auto = renderer.autoClear
    renderer.autoClear = false
    if (normalsPass) {
      overlay.camera.layers.disable(NO_INK_LAYER)
      overlay.scene.overrideMaterial = rigNormalMaterial
    } else {
      renderer.clearDepth()
      overlay.camera.layers.enable(NO_INK_LAYER)
    }
    renderer.render(overlay.scene, overlay.camera)
    overlay.scene.overrideMaterial = null
    overlay.camera.layers.enable(NO_INK_LAYER)
    renderer.autoClear = auto
  }

  function bloom(exposure) {
    brightMat.uniforms.uExposure.value = exposure
    renderer.setRenderTarget(bloomA)
    brightQuad.render(renderer)
    for (let i = 0; i < 2; i++) {
      blurMat.uniforms.tInput.value = bloomA.texture
      blurMat.uniforms.uDir.value.set(1 / bloomA.width, 0)
      renderer.setRenderTarget(bloomB)
      blurQuad.render(renderer)
      blurMat.uniforms.tInput.value = bloomB.texture
      blurMat.uniforms.uDir.value.set(0, 1 / bloomA.height)
      renderer.setRenderTarget(bloomA)
      blurQuad.render(renderer)
    }
  }

  /**
   * overlay: an optional { scene, camera } drawn over the place with its own
   * depth — the floating print, which must never cut into the scenery.
   * sun: { uv: Vector2 (screen 0..1), strength 0..1, color } for the sun rays.
   */
  function render(scene, camera, { time = 0, exposure = 1, overlay = null, sun = null, flat = false } = {}) {
    uniforms.uTime.value = time
    uniforms.uExposure.value = exposure
    uniforms.uProjInv.value.copy(camera.projectionMatrixInverse)
    // pixels per metre at 1 m distance, for sizing the occlusion radius
    uniforms.uProjScale.value = (camera.projectionMatrix.elements[5] * uniforms.uRes.value.y) / 2

    // 1. colour, including the layer that never gets a normal
    camera.layers.enable(NO_INK_LAYER)
    renderer.setRenderTarget(color)
    renderer.render(scene, camera)
    drawOver(overlay, false)

    // 2. normals and depth, without that layer (not needed when shown flat)
    if (!flat) {
    camera.layers.disable(NO_INK_LAYER)
    const fog = scene.fog
    scene.fog = null
    scene.overrideMaterial = normalMaterial
    renderer.setRenderTarget(normals)
    renderer.render(scene, camera)
    scene.overrideMaterial = null
    scene.fog = fog
    camera.layers.enable(NO_INK_LAYER)
    drawOver(overlay, true)
    }

    // 3. bloom
    bloom(exposure)

    // 4. sun rays, when the sun is in front of us
    const strength = flat ? 0 : sun?.strength ?? 0
    uniforms.uRays.value = strength * 0.3
    if (strength > 0.001) {
      raysMat.uniforms.uSun.value.copy(sun.uv)
      if (sun.color) uniforms.uRayColor.value.copy(sun.color)
      renderer.setRenderTarget(rays)
      raysQuad.render(renderer)
    }

    // 5. composite to the screen
    renderer.setRenderTarget(null)
    quad.render(renderer)
  }

  /** Just the cloud layer (and fade), over black — while the next place loads. */
  function renderClouds(time) {
    uniforms.uTime.value = time
    uniforms.uRays.value = 0
    for (const t of [color, normals, bloomA]) {
      renderer.setRenderTarget(t)
      renderer.clear()
    }
    renderer.setRenderTarget(null)
    quad.render(renderer)
  }

  return {
    uniforms,
    setSize,
    render,
    renderClouds,
    dispose() {
      for (const t of [color, normals, bloomA, bloomB, rays]) t.dispose()
      depthTexture.dispose()
      normalMaterial.dispose()
      rigNormalMaterial.dispose()
      for (const m of [material, brightMat, blurMat, raysMat]) m.dispose()
      for (const q of [quad, brightQuad, blurQuad, raysQuad]) q.dispose()
    },
  }
}
