/**
 * The shared kit every place is built from: a physically based sky and sun,
 * atmospheric haze, image-based lighting taken from that sky, water, trees,
 * glowing lamps and lit windows for night scenes.
 *
 * World units are metres.
 */
import { Sky } from 'three/addons/objects/Sky.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { noiseNormalMap, paintTexture, grain, blotches, seeded, range, glowTexture } from './utils.js'

/** Sun direction from elevation/azimuth in degrees (azimuth 0 = +Z, 90 = +X). */
export function sunVector(THREE, elevation, azimuth) {
  const phi = THREE.MathUtils.degToRad(90 - elevation)
  const theta = THREE.MathUtils.degToRad(azimuth)
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta)
}

/**
 * Light presets — the time of day each photograph was taken in.
 * exposure is renderer.toneMappingExposure.
 */
export const LIGHT = {
  day: {
    sun: { elevation: 38, azimuth: 200 },
    sky: { turbidity: 6, rayleigh: 1.4, mieCoefficient: 0.004, mieDirectionalG: 0.8 },
    fog: { color: 0xbcc8d4, density: 0.00065 },
    sunColor: 0xfff2e2,
    sunIntensity: 3.2,
    hemi: [0xcfe0ff, 0x6b6150, 0.9],
    exposure: 0.55,
  },
  overcast: {
    sun: { elevation: 30, azimuth: 160 },
    sky: { turbidity: 14, rayleigh: 2.4, mieCoefficient: 0.012, mieDirectionalG: 0.7 },
    fog: { color: 0xc9cfd6, density: 0.0011 },
    sunColor: 0xf3f1ee,
    sunIntensity: 1.5,
    hemi: [0xe2e8ef, 0x75706a, 1.4],
    exposure: 0.62,
  },
  golden: {
    sun: { elevation: 9, azimuth: 250 },
    sky: { turbidity: 8, rayleigh: 2.2, mieCoefficient: 0.006, mieDirectionalG: 0.86 },
    fog: { color: 0xe6c9a3, density: 0.0009 },
    sunColor: 0xffc58a,
    sunIntensity: 3.6,
    hemi: [0xffd9b0, 0x5a4a3a, 0.7],
    exposure: 0.5,
  },
  sunset: {
    sun: { elevation: 2.2, azimuth: 255 },
    sky: { turbidity: 9, rayleigh: 3, mieCoefficient: 0.008, mieDirectionalG: 0.9 },
    fog: { color: 0xd9a77f, density: 0.0012 },
    sunColor: 0xff9a55,
    sunIntensity: 3.0,
    hemi: [0xffb98a, 0x3d3040, 0.6],
    exposure: 0.48,
  },
  night: {
    night: true,
    sun: { elevation: -12, azimuth: 300 },
    moon: { elevation: 28, azimuth: 120 },
    fog: { color: 0x0b1020, density: 0.0016 },
    sunColor: 0x9db4ff,
    sunIntensity: 0.25,
    hemi: [0x22304f, 0x0a0a0c, 0.35],
    exposure: 0.95,
  },
  interior: {
    sun: { elevation: 24, azimuth: 230 },
    sky: { turbidity: 5, rayleigh: 1.2, mieCoefficient: 0.004, mieDirectionalG: 0.8 },
    fog: null,
    sunColor: 0xfff0dc,
    sunIntensity: 4.0,
    hemi: [0xf4ead8, 0x8a7b68, 1.1],
    exposure: 0.62,
  },
}

/* --- night sky: gradient + stars, as a shader on a big sphere ---------- */

function nightDome(THREE) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x02040b) },
      horizon: { value: new THREE.Color(0x1a2240) },
      glow: { value: new THREE.Color(0x4a3a40) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // always at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 glow;
      varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.45));
        // city light pollution near the horizon
        col += glow * exp(-h * 14.0) * 0.6;
        // stars, thinned near the horizon
        vec3 cell = floor(vDir * 420.0);
        float s = hash(cell);
        float star = step(0.9975, s) * smoothstep(0.05, 0.4, h);
        col += vec3(star) * (0.6 + 0.4 * hash(cell + 3.1));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -1
  return mesh
}

/**
 * Create a lit, hazy world. Returns the scene, its sun (for shadows) and a
 * helper to aim the shadow camera at the area the viewer ends up in.
 */
export function createWorld(THREE, ctx, lightName = 'day', overrides = {}) {
  const L = { ...LIGHT[lightName], ...overrides }
  const scene = new THREE.Scene()
  const sunDir = sunVector(THREE, L.sun.elevation, L.sun.azimuth)

  // Sky — used both as the visible backdrop and as the lighting environment
  let skyMesh
  if (L.night) {
    skyMesh = nightDome(THREE)
  } else {
    const sky = new Sky()
    sky.scale.setScalar(9000)
    const u = sky.material.uniforms
    u.turbidity.value = L.sky.turbidity
    u.rayleigh.value = L.sky.rayleigh
    u.mieCoefficient.value = L.sky.mieCoefficient
    u.mieDirectionalG.value = L.sky.mieDirectionalG
    u.sunPosition.value.copy(sunDir)
    skyMesh = sky
  }
  scene.add(skyMesh)

  // Image-based light from the sky itself, so every surface is lit by the
  // same sky the viewer sees. Rendered once.
  const envScene = new THREE.Scene()
  envScene.add(skyMesh.clone())
  const envRT = ctx.pmrem.fromScene(envScene, 0.02, 1, 12000)
  scene.environment = envRT.texture
  scene.environmentIntensity = L.night ? 0.35 : 1.0

  if (L.fog) scene.fog = new THREE.FogExp2(L.fog.color, L.fog.density)

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

  return {
    scene,
    sun,
    sunDir,
    light: L,
    exposure: L.exposure,
    focusShadows,
    dispose() {
      envRT.dispose()
    },
  }
}

/* --- materials ------------------------------------------------------- */

/** Water: dark, glossy, with drifting ripples. Call tick(t) every frame. */
export function waterMaterial(THREE, { color = 0x1d2b2e, roughness = 0.06, repeat = 40, stretch = [1, 3], strength = 0.35 } = {}) {
  const normalA = noiseNormalMap(THREE, 256, { cells: 6, strength: 2.2, octaves: 4, stretch })
  const normalB = normalA.clone()
  normalB.needsUpdate = true
  normalA.repeat.set(repeat, repeat)
  normalB.repeat.set(repeat * 1.7, repeat * 1.7)
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    normalMap: normalA,
    normalScale: new THREE.Vector2(strength, strength),
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    clearcoatNormalMap: normalB,
    clearcoatNormalScale: new THREE.Vector2(strength * 0.6, strength * 0.6),
  })
  mat.userData.tick = (t) => {
    normalA.offset.set(t * 0.004, t * 0.011)
    normalB.offset.set(-t * 0.006, t * 0.007)
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
  const canopy = new THREE.InstancedMesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: false }),
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
  spots.forEach((s) => {
    const sp = new THREE.Sprite(glowMat)
    sp.position.set(s.x, (s.y || 0) + height, s.z)
    sp.scale.setScalar(4.5)
    scene.add(sp)
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
