/**
 * The coast — dunes of marram grass at golden hour, a sandy path through
 * them, and the beach and North Sea beyond, the sun sitting low over the
 * water.
 *
 * Tens of thousands of grass blades are instanced and sway in the wind on the
 * GPU. The flight comes in high from inland, drops over the dune crest and
 * settles on the path behind where the couple walked, looking out to sea into
 * the low sun.
 *
 * Metres. The sea is toward −Z.
 */
import { createWorld, waterMaterial } from '../world.js'
import { fbm, ridged, seeded, range, paintTexture, grain } from '../utils.js'
import { NO_INK_LAYER } from '../post.js'

// The path wanders through the dunes toward the sea
const pathX = (z) => 14 * Math.sin(z * 0.012) + 5 * Math.sin(z * 0.031 + 1.3)

/** Dune height at (x, z): ridged crests inland, flattening to the beach. */
function height(x, z) {
  const inland = Math.min(1, Math.max(0, (z + 150) / 260)) // 0 at the beach, 1 inland
  const dunes = 11 * ridged(x * 0.011 + 3.1, z * 0.014 - 1.7, 4) + 4 * fbm(x * 0.035, z * 0.035, 4)
  let h = dunes * inland
  // the beach slopes gently to the waterline
  if (z < -150) h = Math.max(-1.2, (z + 150) * 0.03)
  // the path is a shallow trough worn into the sand
  const d = Math.abs(x - pathX(z))
  const trough = Math.max(0, 1 - d / 3.2)
  h -= trough * trough * 0.9 * inland
  return h
}

export function buildCoast(THREE, ctx, { light = 'sunset' } = {}) {
  const world = createWorld(THREE, ctx, light, {
    sun: { elevation: light === 'sunset' ? 3.2 : 9, azimuth: 188 },
    fog: { color: light === 'sunset' ? 0xe0b58f : 0xd9c6a4, density: 0.0016 },
  })
  const { scene } = world
  const low = ctx.quality === 'low'
  const rand = seeded(2025)

  /* --- terrain ----------------------------------------------------- */

  // wide enough that its edges are lost in the haze from anywhere on the flight
  const seg = low ? 160 : 260
  const geo = new THREE.PlaneGeometry(1800, 900, Math.round(seg * 2), seg)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, 0, 120)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const sand = new THREE.Color(0xd9c09a)
  const wetSand = new THREE.Color(0x8e7a62)
  const grassy = new THREE.Color(0x9a8a52)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const h = height(x, z)
    pos.setY(i, h)
    const inland = Math.min(1, Math.max(0, (z + 130) / 200))
    const onPath = Math.abs(x - pathX(z)) < 2.4
    c.copy(sand).lerp(grassy, onPath ? 0 : inland * (0.55 + 0.45 * fbm(x * 0.05, z * 0.05, 3)))
    if (z < -175) c.lerp(wetSand, Math.min(1, (-175 - z) / 20))
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  const sandTex = paintTexture(
    THREE,
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, w, h)
      grain(g, w, h, 40, 9)
    },
    { kind: 'color', repeat: [220, 220] }
  )
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, map: sandTex, roughness: 0.96, metalness: 0 })
  )
  terrain.receiveShadow = true
  terrain.castShadow = true
  scene.add(terrain)

  /* --- the sea ------------------------------------------------------ */

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 4000),
    waterMaterial(THREE, { palette: world.light, scale: 1.4 })
  )
  sea.rotation.x = -Math.PI / 2
  sea.position.set(0, -0.9, -2200)
  scene.add(sea)
  // a band of foam where the waves run up the beach
  const foamTex = paintTexture(
    THREE,
    512,
    64,
    (g, w, h) => {
      g.clearRect(0, 0, w, h)
      for (let i = 0; i < 260; i++) {
        const x = Math.random() * w
        const y = Math.random() * h
        g.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.4})`
        g.fillRect(x, y, 6 + Math.random() * 40, 1 + Math.random() * 2)
      }
    },
    { kind: 'color', repeat: [30, 1] }
  )
  const foam = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 14),
    new THREE.MeshStandardMaterial({ map: foamTex, transparent: true, depthWrite: false, roughness: 0.6 })
  )
  foam.rotation.x = -Math.PI / 2
  foam.position.set(0, -0.84, -185)
  scene.add(foam)

  /* --- marram grass ------------------------------------------------- */

  // A single blade: a thin tapered strip bent slightly forward
  const blade = new THREE.BufferGeometry()
  const bladeH = 1
  const segs = 4
  const verts = []
  const uvs = []
  const idx = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const w = 0.025 * (1 - t * 0.9)
    const bend = t * t * 0.18
    verts.push(-w, t * bladeH, bend, w, t * bladeH, bend)
    uvs.push(0, t, 1, t)
    if (i < segs) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  blade.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  blade.setIndex(idx)
  blade.computeVertexNormals()

  const grassMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.75,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const time = { value: 0 }
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // wind: a slow swell plus a quicker flutter, stronger toward the tip
        vec3 root = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        float gust = sin(uTime * 0.9 + root.x * 0.07 + root.z * 0.05) * 0.5 + 0.5;
        float sway = (sin(uTime * 2.3 + root.x * 0.6 + root.z * 0.4) * 0.35 + gust) * 0.22;
        float tip = position.y * position.y; // blade-local height, 0 at the root
        transformed.x += sway * tip;
        transformed.z += sway * 0.6 * tip;`
      )
    // back-lit blades glow: a touch of translucency toward the sun
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * 0.18;`
    )
  }

  const count = low ? 22000 : 70000
  const grass = new THREE.InstancedMesh(blade, grassMat, count)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  const gold = [0xc8a764, 0xb89a58, 0xd6b878, 0x9c8a4e, 0xa8975c, 0xe0c58c]
  let placed = 0
  const endZ = 70
  for (let tries = 0; placed < count && tries < count * 6; tries++) {
    // dense around where the camera lands, thinning further out
    const r = Math.pow(rand(), 1.6) * 260
    const a = rand() * Math.PI * 2
    const x = pathX(endZ) + Math.cos(a) * r
    const z = endZ + Math.sin(a) * r * 1.4
    if (z < -130) continue // no grass on the beach
    if (Math.abs(x - pathX(z)) < 1.9) continue // keep the path clear
    const h = height(x, z)
    p.set(x, h - 0.05, z)
    e.set(range(rand, -0.25, 0.25), rand() * Math.PI * 2, range(rand, -0.25, 0.25))
    q.setFromEuler(e)
    const tall = range(rand, 0.55, 1.25)
    s.set(1, tall, 1)
    m.compose(p, q, s)
    grass.setMatrixAt(placed, m)
    c.setHex(gold[Math.floor(rand() * gold.length)]).offsetHSL(0, 0, range(rand, -0.05, 0.05))
    grass.setColorAt(placed, c)
    placed++
  }
  grass.count = placed
  grass.instanceMatrix.needsUpdate = true
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true
  grass.receiveShadow = true
  grass.frustumCulled = false
  grass.layers.set(NO_INK_LAYER) // blades sway in the shader; no ink lines on them
  scene.add(grass)

  // A few wooden posts of an old beach fence along the dune foot
  const postGeo = new THREE.CylinderGeometry(0.07, 0.08, 1.2, 6).translate(0, 0.6, 0)
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x6b5a46, roughness: 1 }), 60)
  for (let i = 0; i < 60; i++) {
    const x = -120 + i * 4 + range(rand, -0.5, 0.5)
    const z = -128 + range(rand, -1, 1)
    m.compose(new THREE.Vector3(x, height(x, z) - 0.2, z), q.identity(), new THREE.Vector3(1, range(rand, 0.6, 1.1), 1))
    posts.setMatrixAt(i, m)
  }
  posts.castShadow = true
  scene.add(posts)

  /* --- the flight ----------------------------------------------------- */

  const endX = pathX(endZ)
  const end = new THREE.Vector3(endX + 0.6, height(endX, endZ) + 1.55, endZ)
  world.focusShadows(new THREE.Vector3(endX, 2, endZ - 20), 40)

  const pts = (list) => list.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  const path = {
    positions: pts([
      [-160, 120, 520],
      [-40, 55, 300],
      [pathX(170) + 6, height(pathX(170), 170) + 12, 170],
      [pathX(110), height(pathX(110), 110) + 3.2, 110],
      [end.x, end.y, end.z],
    ]),
    targets: pts([
      [0, 0, -300],
      [0, 0, -400],
      [pathX(60), 2, 40],
      [pathX(40), 2.5, 20],
      [pathX(-80), 2.4, -110],
    ]),
    fov: 52,
    near: 0.3,
  }

  return {
    scene,
    world,
    path,
    // the engine keeps the camera at least this far above the sand
    groundAt: height,
    clearance: 1.25,
    update(t) {
      time.value = t
      sea.material.userData.tick(t)
      foam.material.map.offset.x = t * 0.004
    },
  }
}
