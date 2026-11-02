/**
 * The shared kit every place is built from: a sky (gradient from the photo,
 * soft lit clouds, a bright sun) that also lights the scene, haze that melts
 * into the horizon, a shadow-casting sun, realistic water with ripples and
 * sun glitter, trees, lamps with pools of light, and lit windows at night.
 *
 * Colours are authored as sRGB hex; post.js maps the HDR result to the
 * screen with a filmic curve.
 *
 * World units are metres.
 */
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { paintTexture, grain, blotches, seeded, range, glowTexture, noiseNormalMap } from './utils.js'

/** Sun direction from elevation/azimuth in degrees (azimuth 0 = +Z, 90 = +X). */
export function sunVector(THREE, elevation, azimuth) {
  const phi = THREE.MathUtils.degToRad(90 - elevation)
  const theta = THREE.MathUtils.degToRad(azimuth)
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta)
}

/**
 * Light presets — the time of day each photograph was taken in — as a
 * painter's palette: sky, clouds, haze, water, and the light on things.
 */
export const LIGHT = {
  day: {
    sun: { elevation: 38, azimuth: 200 },
    sky: { zenith: 0x6f9fd8, horizon: 0xd3e2ee, ground: 0x9aa4ab, sun: 0xfff3dc, cloudLit: 0xffffff, cloudShade: 0xbac8da, clouds: 0.45 },
    water: { deep: 0x3f5d70, shallow: 0x6f8fa3, stroke: 0xf3f6f8 },
    fog: { color: 0xd3e2ee, density: 0.00065 },
    sunColor: 0xfff2e2,
    sunIntensity: 2.0,
    hemi: [0xdfeaff, 0x8a8070, 0.9],
    exposure: 1.0,
  },
  overcast: {
    sun: { elevation: 30, azimuth: 160 },
    sky: { zenith: 0xa7b4c3, horizon: 0xe4e7ea, ground: 0xb0b2b2, sun: 0xfffaf0, cloudLit: 0xf6f5f2, cloudShade: 0xb9bec5, clouds: 0.85 },
    water: { deep: 0x55616a, shallow: 0x7e8a92, stroke: 0xf2f1ee },
    fog: { color: 0xdde1e5, density: 0.0011 },
    sunColor: 0xf6f3ee,
    sunIntensity: 1.3,
    hemi: [0xeef1f5, 0x8f8a82, 1.25],
    exposure: 1.0,
  },
  golden: {
    sun: { elevation: 9, azimuth: 250 },
    sky: { zenith: 0x7ea3c9, horizon: 0xf6d3a4, ground: 0xb79f86, sun: 0xffd590, cloudLit: 0xffe4c0, cloudShade: 0xc79e8f, clouds: 0.5 },
    water: { deep: 0x4c5a5e, shallow: 0x8a8f86, stroke: 0xfff1dc },
    fog: { color: 0xeed4b2, density: 0.0009 },
    sunColor: 0xffc994,
    sunIntensity: 2.2,
    hemi: [0xffe2c0, 0x6f5d4c, 0.75],
    exposure: 1.0,
  },
  sunset: {
    // the palette of the reference: a peach sky, soft clouds, slate-grey sea
    sun: { elevation: 3, azimuth: 255 },
    sky: { zenith: 0xe8a37f, horizon: 0xf6c9a1, ground: 0xc79a80, sun: 0xfff0d6, cloudLit: 0xfad8b6, cloudShade: 0xdc9d80, clouds: 0.55 },
    water: { deep: 0x58616c, shallow: 0x7b838c, stroke: 0xf1e7dd },
    fog: { color: 0xf0c49f, density: 0.0012 },
    sunColor: 0xffb98a,
    sunIntensity: 2.0,
    hemi: [0xffcfa8, 0x5b4c55, 0.7],
    exposure: 1.0,
  },
  night: {
    night: true,
    sun: { elevation: -12, azimuth: 300 },
    moon: { elevation: 28, azimuth: 120 },
    sky: { zenith: 0x060a19, horizon: 0x1d2646, ground: 0x0d1020, sun: 0x9fb2e0, cloudLit: 0x2b3352, cloudShade: 0x161b30, clouds: 0.3 },
    water: { deep: 0x0b1222, shallow: 0x18223a, stroke: 0xffd7a6 },
    fog: { color: 0x141b33, density: 0.0016 },
    sunColor: 0x9db4ff,
    sunIntensity: 0.35,
    hemi: [0x34436b, 0x0d0d12, 0.45],
    exposure: 1.0,
  },
  interior: {
    sun: { elevation: 24, azimuth: 230 },
    sky: { zenith: 0x83aedb, horizon: 0xe6eef2, ground: 0xb3ab9a, sun: 0xfff3dc, cloudLit: 0xffffff, cloudShade: 0xc6d2de, clouds: 0.35 },
    water: { deep: 0x3f5d70, shallow: 0x6f8fa3, stroke: 0xf3f6f8 },
    fog: null,
    sunColor: 0xfff0dc,
    sunIntensity: 2.4,
    hemi: [0xfaf1e2, 0x9a8b78, 1.05],
    exposure: 1.0,
  },
}

/* --- the painted sky -------------------------------------------------- */

const NOISE_GLSL = /* glsl */ `
  float hash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
`
export { NOISE_GLSL }

/**
 * A sky dome painted in a shader: a gradient from horizon to zenith, a soft
 * glowing sun, and rounded clouds with a lit side and a shaded side — the
 * gentle cel look of the reference. At night: deep blue and stars.
 */
function paintedSky(THREE, L, sunDir) {
  const S = L.sky
  const col = (h) => new THREE.Color(h)
  const uniforms = {
    uZenith: { value: col(S.zenith) },
    uHorizon: { value: col(S.horizon) },
    uGround: { value: col(S.ground) },
    uSunDir: { value: sunDir.clone() },
    uSunColor: { value: col(S.sun) },
    uCloudLit: { value: col(S.cloudLit) },
    uCloudShade: { value: col(S.cloudShade) },
    uClouds: { value: S.clouds },
    uNight: { value: L.night ? 1 : 0 },
    uTime: { value: 0 },
  }
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // always at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
      uniform vec3 uSunDir; uniform vec3 uSunColor;
      uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform float uClouds;
      uniform float uNight; uniform float uTime;
      varying vec3 vDir;
      ${NOISE_GLSL}
      float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sunDir = normalize(uSunDir);
        float sd = max(dot(d, sunDir), 0.0);
        // the sky's own gradient (read from the photo), with denser air and a
        // brighter, whiter haze low down — and forward scattering round the sun
        vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.75, h), 0.7));
        col = mix(col, uHorizon * 1.08 + 0.02, (1.0 - smoothstep(0.0, 0.12, h)) * 0.5);
        col = mix(col, uGround, smoothstep(0.0, -0.08, h));
        float day = 1.0 - uNight * 0.85;
        col += uSunColor * (pow(sd, 4.0) * 0.12 + pow(sd, 24.0) * 0.25 + pow(sd, 400.0) * 0.8) * day;
        // the sun's disc, far brighter than anything else (it blooms and casts rays)
        col += uSunColor * smoothstep(0.99955, 0.99975, sd) * 16.0 * day;

        // clouds on a high layer: soft-edged, thick in the middle, lit from the
        // sun's side, dark-bellied, with a bright rim when the sun is behind them
        if (h > 0.0) {
          vec2 p = d.xz / (h + 0.12) * 0.9 + vec2(uTime * 0.0035, uTime * 0.001);
          float n = fbm(p) * 0.75 + fbm(p * 2.3 + 7.0) * 0.25;
          float edge = 0.6 - uClouds * 0.26;
          float density = smoothstep(edge - 0.04, edge + 0.22, n);
          vec2 toSun = normalize(sunDir.xz + 0.0001) * 0.08;
          float nSun = fbm(p + toSun) * 0.75 + fbm((p + toSun) * 2.3 + 7.0) * 0.25;
          float lit = clamp(0.55 + (n - nSun) * 5.0, 0.0, 1.0);
          vec3 base = mix(uCloudShade * 0.82, uCloudLit, lit);
          base = mix(base, uCloudShade * 0.7, smoothstep(0.55, 1.0, density) * 0.35);
          float rim = pow(sd, 6.0) * (1.0 - smoothstep(0.0, 0.6, density));
          base += uSunColor * (rim * 1.6 + pow(sd, 18.0) * 0.4) * day;
          float fade = smoothstep(0.0, 0.1, h);
          col = mix(col, base, density * fade * 0.97);
        }
        // stars at night
        if (uNight > 0.5) {
          vec3 cell = floor(d * 420.0);
          float star = step(0.9975, hash3(cell)) * smoothstep(0.05, 0.4, h);
          col += vec3(star) * (0.6 + 0.4 * hash3(cell + 3.1));
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -1
  mesh.userData.tick = (t) => {
    uniforms.uTime.value = t
  }
  return mesh
}

/**
 * Create a lit, hazy world. Returns the scene, its sun (for shadows) and a
 * helper to aim the shadow camera at the area the viewer ends up in.
 */
export function createWorld(THREE, ctx, lightName = 'day', overrides = {}) {
  const base = LIGHT[lightName]
  const L = {
    ...base,
    ...overrides,
    sky: { ...base.sky, ...(overrides.sky || {}) },
    water: { ...base.water, ...(overrides.water || {}) },
  }
  // The sky read from the project's own photograph (palette.js), when it has
  // one: the painted sky, the haze and the water's reflections all follow it.
  if (ctx.sky && !L.night) L.sky = { ...L.sky, ...ctx.sky }
  const scene = new THREE.Scene()
  const sunDir = sunVector(THREE, L.sun.elevation, L.sun.azimuth)

  const sky = paintedSky(THREE, L, sunDir)
  scene.add(sky)
  // the haze takes the sky's horizon colour, so the land melts into it
  if (L.fog) scene.fog = new THREE.FogExp2(L.sky.horizon, L.fog.density)
  scene.userData.light = L

  const hemi = new THREE.HemisphereLight(L.hemi[0], L.hemi[1], L.hemi[2])
  scene.add(hemi)

  // Sun (or moon at night) with soft shadows
  const lightDir = L.night ? sunVector(THREE, L.moon.elevation, L.moon.azimuth) : sunDir
  const sun = new THREE.DirectionalLight(L.sunColor, L.sunIntensity)
  sun.position.copy(lightDir).multiplyScalar(300)
  sun.castShadow = true
  const size = ctx.quality === 'low' ? 1024 : 2048
  sun.shadow.mapSize.set(size, size)
  sun.shadow.bias = -0.0003
  sun.shadow.normalBias = 0.04
  sun.shadow.radius = 3
  const sc = sun.shadow.camera
  sc.near = 1
  sc.far = 900
  sc.left = sc.bottom = -70
  sc.right = sc.top = 70
  // nothing that casts a shadow moves, so draw the shadow map once
  sun.shadow.autoUpdate = false
  sun.shadow.needsUpdate = true
  scene.add(sun)
  scene.add(sun.target)

  /** Centre the sun's shadow box on a point (where the camera lands). */
  function focusShadows(point, radius = 70) {
    sun.target.position.copy(point)
    sun.position.copy(point).addScaledVector(lightDir, 350)
    sc.left = sc.bottom = -radius
    sc.right = sc.top = radius
    sc.updateProjectionMatrix()
    sun.shadow.needsUpdate = true
  }

  // the stylised water picks up this world's palette
  ctx.palette = L

  return {
    scene,
    sun,
    sunDir: lightDir,
    sky,
    hemi,
    light: L,
    exposure: L.exposure,
    focusShadows,
    tick(t) {
      sky.userData.tick(t)
    },
    dispose() {},
  }
}

/* --- materials ------------------------------------------------------- */

/**
 * Stylised water, like the sea in the reference: a slate body that turns
 * toward the sky's colour at grazing angles, white wave strokes that drift,
 * and a glittering path toward the sun. Uses the palette of the most recently
 * created world (createWorld sets ctx.palette), or `palette` if given.
 * Call material.userData.tick(t) every frame.
 */
export function waterMaterial(THREE, { palette = null, scale = 1, strokes = 1, ctx = null } = {}) {
  const L = palette || ctx?.palette || LIGHT.day
  const W = L.water
  const sunDir = sunVector(THREE, L.night ? L.moon.elevation : L.sun.elevation, L.night ? L.moon.azimuth : L.sun.azimuth)
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(W.deep) },
      uShallow: { value: new THREE.Color(W.shallow) },
      uSky: { value: new THREE.Color(L.sky.horizon) },
      uZenith: { value: new THREE.Color(L.sky.zenith) },
      uStroke: { value: new THREE.Color(W.stroke) },
      uSun: { value: new THREE.Color(L.sky.sun) },
      uSunDir: { value: sunDir },
      uScale: { value: scale },
      uStrokes: { value: strokes },
      uNight: { value: L.night ? 1 : 0 },
    },
  ])
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uZenith;
      uniform vec3 uStroke; uniform vec3 uSun; uniform vec3 uSunDir;
      uniform float uScale; uniform float uStrokes; uniform float uNight;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      // two sets of ripples drifting different ways
      float waves(vec2 p, float t) {
        return fbm(p + vec2(t * 0.4, t * 0.15)) * 0.6 + fbm(p * 2.7 - vec2(t * 0.25, t * 0.5)) * 0.4;
      }
      void main() {
        vec3 toEye = cameraPosition - vWorld;
        float dist = length(toEye);
        vec3 v = toEye / dist;
        vec2 p = vWorld.xz * 0.16 / uScale;
        float t = uTime * 0.35;
        float e = 0.03;
        float h0 = waves(p, t);
        float hx = waves(p + vec2(e, 0.0), t);
        float hz = waves(p + vec2(0.0, e), t);
        // ripples flatten with distance, as real water does (and to stay calm on screen)
        float chop = 0.55 / (1.0 + dist * 0.012 * uScale);
        vec3 n = normalize(vec3(-(hx - h0) / e * chop, 1.0, -(hz - h0) / e * chop));

        vec3 r = reflect(-v, n);
        r.y = abs(r.y);
        float cosT = max(dot(n, v), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        vec3 sunDir = normalize(uSunDir);
        float sd = max(dot(r, sunDir), 0.0);
        vec3 refl = mix(uSky, uZenith, smoothstep(0.0, 0.5, r.y));
        // the sun's glitter: a hard specular core and a softer sheen
        refl += uSun * (pow(sd, 900.0) * 60.0 + pow(sd, 80.0) * 0.8) * (1.0 - uNight * 0.85);
        // what's under the surface: dark, a little lighter where the ripples face the light
        vec3 body = mix(uDeep, uShallow, clamp(0.35 + n.x * 2.0 + n.z, 0.0, 1.0));
        body *= 0.55 + 0.45 * max(dot(n, sunDir), 0.0);
        vec3 col = mix(body, refl, fres);
        // night: the city's lights broken into long wobbling streaks on the water
        if (uNight > 0.5) {
          float streak = fbm(vec2(vWorld.x * 0.08, vWorld.z * 0.9 + t * 0.6));
          float cluster = smoothstep(0.45, 0.8, fbm(vWorld.xz * 0.015 + 4.0));
          col += uStroke * pow(max(streak - 0.35, 0.0) * 2.4, 3.0) * cluster * 2.5 * uStrokes;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  })
  mat.userData.tick = (t) => {
    mat.uniforms.uTime.value = t
  }
  return mat
}

/** A flat paving / ground material painted on canvas. */
export function pavingMaterial(THREE, { base = '#a39b8e', joint = 'rgba(40,36,30,0.35)', tile = 64, repeat = [60, 60], seed = 11, rough = 0.9, cobble = false } = {}) {
  const tex = paintTexture(
    THREE,
    512,
    512,
    (g, w, h) => {
      g.fillStyle = base
      g.fillRect(0, 0, w, h)
      const rand = seeded(seed)
      if (cobble) {
        // offset rows of rounded setts
        const s = tile / 2
        for (let y = 0; y < h; y += s) {
          const off = (y / s) % 2 ? s / 2 : 0
          for (let x = -s; x < w + s; x += s) {
            const shade = Math.floor(range(rand, -22, 22))
            g.fillStyle = `rgba(${shade > 0 ? 255 : 0},${shade > 0 ? 255 : 0},${shade > 0 ? 255 : 0},${Math.abs(shade) / 255})`
            g.beginPath()
            // roundRect is missing on Safari < 16 / Firefox < 112
            if (g.roundRect) g.roundRect(x + off + 2, y + 2, s - 4, s - 4, 6)
            else g.rect(x + off + 2, y + 2, s - 4, s - 4)
            g.fill()
          }
        }
        g.strokeStyle = joint
        g.lineWidth = 3
        for (let y = 0; y < h; y += s) {
          g.beginPath()
          g.moveTo(0, y)
          g.lineTo(w, y)
          g.stroke()
        }
      } else {
        g.strokeStyle = joint
        g.lineWidth = 2
        for (let y = 0; y <= h; y += tile) {
          g.beginPath()
          g.moveTo(0, y)
          g.lineTo(w, y)
          g.stroke()
        }
        for (let y = 0; y < h; y += tile) {
          for (let x = 0; x <= w; x += tile) {
            g.beginPath()
            g.moveTo(x + ((y / tile) % 2 ? tile / 2 : 0), y)
            g.lineTo(x + ((y / tile) % 2 ? tile / 2 : 0), y + tile)
            g.stroke()
          }
        }
      }
      blotches(g, w, h, { color: 'rgba(0,0,0,0.05)', count: 30, seed })
      grain(g, w, h, 22, seed)
    },
    { kind: 'color', repeat }
  )
  return new THREE.MeshStandardMaterial({ map: tex, roughness: rough, metalness: 0 })
}

/**
 * A mown lawn: mottled greens, faint mowing stripes and blade-level grain, so
 * grass reads as grass rather than a flat green sheet.
 */
export function grassMaterial(THREE, { base = '#557236', repeat = [40, 40], stripes = true, seed = 21 } = {}) {
  const map = paintTexture(
    THREE,
    512,
    512,
    (g, w, h) => {
      g.fillStyle = base
      g.fillRect(0, 0, w, h)
      const rand = seeded(seed)
      if (stripes) {
        for (let x = 0; x < w; x += 64) {
          g.fillStyle = (x / 64) % 2 ? 'rgba(255,255,220,0.05)' : 'rgba(0,20,0,0.06)'
          g.fillRect(x, 0, 64, h)
        }
      }
      blotches(g, w, h, { color: 'rgba(80,70,20,0.10)', count: 26, seed, size: 0.18 })
      blotches(g, w, h, { color: 'rgba(10,40,10,0.10)', count: 26, seed: seed + 5, size: 0.14 })
      // individual blades
      for (let i = 0; i < 9000; i++) {
        const x = rand() * w
        const y = rand() * h
        const l = 2 + rand() * 4
        g.strokeStyle = rand() < 0.5 ? 'rgba(170,190,90,0.22)' : 'rgba(20,40,10,0.25)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x + (rand() - 0.5) * 2, y - l)
        g.stroke()
      }
      grain(g, w, h, 16, seed)
    },
    { kind: 'color', repeat }
  )
  const normalMap = noiseNormalMap(THREE, 256, { cells: 64, strength: 2, octaves: 2 })
  normalMap.repeat.set(repeat[0] * 2, repeat[1] * 2)
  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.95,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  })
}

/* --- vegetation -------------------------------------------------------- */

/**
 * Trees as instanced canopies (lumpy displaced spheres, several per tree)
 * plus trunks. `spots` is a list of {x, y, z, h} where h is the tree height.
 */
export function addTrees(THREE, scene, spots, { seed = 5, leaf = [0x3d5a2a, 0x52703a, 0x2f4a24], autumn = false } = {}) {
  if (!spots.length) return null
  const rand = seeded(seed)
  // Icosahedrons are a triangle soup; weld the vertices so the lumps shade smoothly
  let canopyGeo = new THREE.IcosahedronGeometry(1, 2)
  canopyGeo.deleteAttribute('normal')
  canopyGeo.deleteAttribute('uv')
  canopyGeo = mergeVertices(canopyGeo)
  {
    const p = canopyGeo.attributes.position
    const v = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
      const n = 0.82 + 0.3 * Math.sin(v.x * 5.1 + v.y * 3.7) * Math.cos(v.z * 4.3 - v.y * 2.1)
      v.multiplyScalar(n)
      p.setXYZ(i, v.x, v.y, v.z)
    }
    canopyGeo.computeVertexNormals()
  }
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 7)
  trunkGeo.translate(0, 0.5, 0)

  const blobsPer = 4
  // spherical UVs so a leafy bump can wrap the lumps
  {
    const p = canopyGeo.attributes.position
    const uv = new Float32Array(p.count * 2)
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const y = p.getY(i)
      const z = p.getZ(i)
      uv[i * 2] = 0.5 + Math.atan2(z, x) / (2 * Math.PI)
      uv[i * 2 + 1] = 0.5 + Math.asin(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z)))) / Math.PI
    }
    canopyGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  }
  const leafy = noiseNormalMap(THREE, 256, { cells: 40, strength: 4, octaves: 3 })
  leafy.repeat.set(4, 3)
  const canopy = new THREE.InstancedMesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, normalMap: leafy, normalScale: new THREE.Vector2(1.2, 1.2) }),
    spots.length * blobsPer
  )
  const trunks = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({ color: 0x3b3128, roughness: 1 }),
    spots.length
  )
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  const c = new THREE.Color()
  let k = 0
  spots.forEach((t, i) => {
    const h = t.h || range(rand, 9, 15)
    const trunkH = h * 0.42
    p.set(t.x, t.y || 0, t.z)
    q.identity()
    s.set(1 + h * 0.02, trunkH, 1 + h * 0.02)
    m.compose(p, q, s)
    trunks.setMatrixAt(i, m)
    for (let b = 0; b < blobsPer; b++) {
      const r = h * range(rand, 0.22, 0.32)
      p.set(
        t.x + range(rand, -1, 1) * h * 0.18,
        (t.y || 0) + trunkH + r * 0.6 + b * h * 0.1,
        t.z + range(rand, -1, 1) * h * 0.18
      )
      q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3))
      s.set(r * range(rand, 1, 1.3), r * range(rand, 0.75, 1), r * range(rand, 1, 1.3))
      m.compose(p, q, s)
      canopy.setMatrixAt(k, m)
      c.setHex(leaf[Math.floor(rand() * leaf.length)])
      if (autumn && rand() < 0.5) c.lerp(new THREE.Color(0xa86a2a), range(rand, 0.3, 0.8))
      c.offsetHSL(0, 0, range(rand, -0.04, 0.04))
      canopy.setColorAt(k, c)
      k++
    }
  })
  canopy.instanceMatrix.needsUpdate = true
  if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true
  trunks.instanceMatrix.needsUpdate = true
  canopy.castShadow = trunks.castShadow = true
  canopy.receiveShadow = true
  scene.add(canopy, trunks)
  return { canopy, trunks }
}

/* --- night lighting ---------------------------------------------------- */

/** Warm street lamps: a pole, a lamp head and a soft additive glow sprite. */
export function addLamps(THREE, scene, spots, { color = 0xffc98a, height = 5 } = {}) {
  if (!spots.length) return
  const pole = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.06, 0.09, height, 6).translate(0, height / 2, 0),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.6, metalness: 0.6 }),
    spots.length
  )
  const head = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.22, 12, 8),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 6 }),
    spots.length
  )
  const m = new THREE.Matrix4()
  spots.forEach((s, i) => {
    m.makeTranslation(s.x, s.y || 0, s.z)
    pole.setMatrixAt(i, m)
    m.makeTranslation(s.x, (s.y || 0) + height, s.z)
    head.setMatrixAt(i, m)
  })
  scene.add(pole, head)
  const glowTex = glowTexture(THREE, 'rgba(255,205,150,1)')
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.55,
  })
  // the pool of light each lamp throws on the ground
  const poolMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    color,
    transparent: true,
    opacity: 0.32,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
  })
  const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  spots.forEach((s) => {
    const sp = new THREE.Sprite(glowMat)
    sp.position.set(s.x, (s.y || 0) + height, s.z)
    sp.scale.setScalar(3.2)
    scene.add(sp)
    const pool = new THREE.Mesh(poolGeo, poolMat)
    pool.position.set(s.x, (s.y || 0) + 0.04, s.z)
    pool.scale.setScalar(height * 2.6)
    scene.add(pool)
  })
}

/**
 * A facade texture of a modern building at night: a grid of windows, some
 * lit warm, some cool, most dark. Returned as { map, emissive } textures.
 */
export function nightWindows(THREE, { cols = 8, rows = 16, seed = 4, litRatio = 0.38, frame = '#1a1c20' } = {}) {
  const rand = seeded(seed)
  const lit = []
  for (let i = 0; i < cols * rows; i++) lit.push(rand() < litRatio ? (rand() < 0.75 ? 'warm' : 'cool') : null)
  const draw = (emissive) => (g, w, h) => {
    g.fillStyle = emissive ? '#000' : frame
    g.fillRect(0, 0, w, h)
    const cw = w / cols
    const rh = h / rows
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const state = lit[r * cols + c]
        const x = c * cw + cw * 0.12
        const y = r * rh + rh * 0.14
        if (emissive) {
          if (!state) continue
          g.fillStyle = state === 'warm' ? 'rgb(255,196,128)' : 'rgb(190,215,255)'
          g.globalAlpha = 0.55 + rand() * 0.45
        } else {
          g.fillStyle = state ? '#3b3226' : '#0d1015'
          g.globalAlpha = 1
        }
        g.fillRect(x, y, cw * 0.76, rh * 0.68)
      }
    }
    g.globalAlpha = 1
  }
  return {
    map: paintTexture(THREE, 512, 1024, draw(false), { kind: 'color' }),
    emissive: paintTexture(THREE, 512, 1024, draw(true), { kind: 'color' }),
  }
}
