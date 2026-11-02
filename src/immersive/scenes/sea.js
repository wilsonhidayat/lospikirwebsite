/**
 * The opening: open sea at sunset, a motor yacht flying the LOSPIKIR flag.
 * The journey starts here — "Begin the journey" rises into the clouds and
 * comes down in the first place.
 *
 * The yacht is built from primitives: a lofted hull tapering to the bow,
 * a deck house with a dark window band, a flybridge under a bimini top, a
 * radar dome, rails, a waving flag, and a foaming wake. It cruises along +X;
 * the camera path is relative to it (the engine follows `anchor`).
 *
 * Metres.
 */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createWorld, waterMaterial } from '../world.js'
import { beamBatch, paintTexture, seeded, range } from '../utils.js'
import { NO_INK_LAYER } from '../post.js'

function buildYacht(THREE) {
  const yacht = new THREE.Group()
  const white = new THREE.MeshStandardMaterial({ color: 0xf1eee8, roughness: 0.4 })
  const cream = new THREE.MeshStandardMaterial({ color: 0xe7dcc6, roughness: 0.6 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.25 })
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.3, metalness: 0.6 })

  // Hull: a side profile, extruded across the beam, then tapered to a bow
  const L = 22
  const B = 5.6
  const prof = new THREE.Shape()
  prof.moveTo(0, 0.35)
  prof.lineTo(0, 2.6)
  prof.lineTo(16.5, 2.75)
  prof.quadraticCurveTo(20.8, 2.85, L + 0.6, 3.25)
  prof.quadraticCurveTo(21.2, 1.3, 17.5, 0)
  prof.lineTo(1.6, -0.15)
  prof.closePath()
  const hullGeo = new THREE.ExtrudeGeometry(prof, { depth: B, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.22, bevelSegments: 4, curveSegments: 18, steps: 1 })
  hullGeo.translate(-L / 2, 0, -B / 2)
  {
    const p = hullGeo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const y = p.getY(i)
      let z = p.getZ(i)
      // pinch the beam toward the bow
      const t = Math.min(1, Math.max(0, (x - 3) / 8.6))
      z *= 1 - 0.93 * Math.pow(t, 1.7)
      // a soft V below the waterline
      if (y < 1.2) z *= 0.62 + 0.38 * Math.max(0, y / 1.2)
      p.setZ(i, z)
    }
    hullGeo.computeVertexNormals()
  }
  const hull = new THREE.Mesh(hullGeo, white)
  hull.position.y = -0.7
  yacht.add(hull)

  // A dark boot stripe along the hull, just above the waterline
  const stripe = new THREE.Mesh(hullGeo.clone(), dark)
  stripe.scale.set(1.002, 0.12, 1.01)
  stripe.position.y = 0.25 // a band just above the waterline
  yacht.add(stripe)

  // Portholes
  const port = new THREE.CapsuleGeometry(0.16, 0.3, 4, 8).rotateZ(Math.PI / 2)
  for (const side of [-1, 1]) {
    ;[-3.6, -2.4, -1.2, 0.2, 3.4].forEach((x) => {
      const m = new THREE.Mesh(port, dark)
      m.position.set(x, 1.15, side * (B / 2 + 0.05))
      m.scale.z = 0.4
      yacht.add(m)
    })
  }

  // Deck house with a dark window band and a raked windscreen
  const house = new THREE.Mesh(new RoundedBoxGeometry(11.5, 1.9, 4.3, 3, 0.25), white)
  house.position.set(-1.6, 3.0, 0)
  yacht.add(house)
  const band = new THREE.Mesh(new RoundedBoxGeometry(9.4, 0.8, 4.36, 2, 0.1), dark)
  band.position.set(-1.2, 3.2, 0)
  yacht.add(band)
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 3.8), dark)
  screen.position.set(4.6, 3.25, 0)
  screen.rotation.z = -0.75
  yacht.add(screen)
  const fore = new THREE.Mesh(new RoundedBoxGeometry(5.5, 0.6, 3.6, 2, 0.2), white)
  fore.position.set(6.5, 2.35, 0)
  yacht.add(fore)

  // Flybridge, bimini top and its frame
  const fly = new THREE.Mesh(new RoundedBoxGeometry(7.2, 1.0, 3.9, 3, 0.25), white)
  fly.position.set(-2.4, 4.4, 0)
  yacht.add(fly)
  const bimini = new THREE.Mesh(new RoundedBoxGeometry(5.6, 0.16, 4.1, 2, 0.06), cream)
  bimini.position.set(-3.0, 6.3, 0)
  yacht.add(bimini)
  const frame = beamBatch(THREE)
  for (const z of [-1.9, 1.9]) {
    frame.add(new THREE.Vector3(-5.5, 4.9, z), new THREE.Vector3(-4.6, 6.25, z), 0.06)
    frame.add(new THREE.Vector3(-0.6, 4.9, z), new THREE.Vector3(-1.4, 6.25, z), 0.06)
    frame.add(new THREE.Vector3(-3.0, 4.9, z), new THREE.Vector3(-3.0, 6.25, z), 0.06)
  }
  // radar dome on its arch, and a short mast
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14), white)
  dome.position.set(-0.4, 5.55, 0)
  yacht.add(dome)
  frame.add(new THREE.Vector3(-0.4, 4.9, 0), new THREE.Vector3(-0.4, 5.2, 0), 0.25)
  frame.add(new THREE.Vector3(0.3, 4.9, 0), new THREE.Vector3(0.6, 6.4, 0), 0.05)

  // Deck rails
  for (const side of [-1, 1]) {
    const z = side * (B / 2 - 0.15)
    frame.add(new THREE.Vector3(-10.6, 2.95, z), new THREE.Vector3(9.5, 3.05, z * 0.55), 0.05)
    for (let x = -10.4; x <= 9.4; x += 1.25) {
      const t = Math.min(1, Math.max(0, (x - 3) / 8.6))
      frame.add(new THREE.Vector3(x, 2.15, z * (1 - 0.6 * t)), new THREE.Vector3(x, 3.0, z * (1 - 0.6 * t)), 0.035)
    }
  }
  // bow rail meeting at the stem
  frame.add(new THREE.Vector3(9.5, 3.05, -1.5), new THREE.Vector3(11.2, 3.3, 0), 0.05)
  frame.add(new THREE.Vector3(9.5, 3.05, 1.5), new THREE.Vector3(11.2, 3.3, 0), 0.05)
  yacht.add(frame.build(steel))

  // Swim platform at the stern
  const platform = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 4.6), cream)
  platform.position.set(-11.4, 0.55, 0)
  yacht.add(platform)

  // The flag: LOSPIKIR on black, waving
  const flagTex = paintTexture(
    THREE,
    512,
    320,
    (g, w, h) => {
      g.fillStyle = '#121214'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#f3f1ec'
      g.font = '700 92px "Helvetica Neue", Helvetica, Arial, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('LOSPIKIR', w / 2, h / 2 - 10)
      g.fillRect(w / 2 - 170, h / 2 + 46, 340, 12)
    },
    { kind: 'color' }
  )
  const flagGeo = new THREE.PlaneGeometry(2.4, 1.5, 16, 6)
  flagGeo.translate(-1.2, 0, 0) // hoist edge at x = 0, flying aft (−X)
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 })
  const flagTime = { value: 0 }
  flagMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = flagTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float fly = clamp(-position.x / 2.4, 0.0, 1.0);
        transformed.z += sin(uTime * 4.0 + position.x * 2.6) * 0.22 * fly;
        transformed.y += sin(uTime * 3.1 + position.x * 1.9) * 0.05 * fly;`
      )
  }
  const flag = new THREE.Mesh(flagGeo, flagMat)
  flag.position.set(-10.9, 5.0, 0)
  yacht.add(flag)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 3.2, 8), steel)
  pole.position.set(-10.9, 4.0, 0)
  pole.rotation.z = 0.18
  yacht.add(pole)

  yacht.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return { yacht, flagTime }
}

/** White, broken foam strokes for the wake and bow wave. */
function foamTexture(THREE, seed) {
  return paintTexture(
    THREE,
    512,
    128,
    (g, w, h) => {
      g.clearRect(0, 0, w, h)
      const rand = seeded(seed)
      for (let i = 0; i < 220; i++) {
        const y = h / 2 + (rand() - 0.5) * h * (0.25 + 0.6 * rand())
        const x = rand() * w
        g.fillStyle = `rgba(255,255,255,${0.35 + rand() * 0.6})`
        g.beginPath()
        g.ellipse(x, y, 8 + rand() * 46, 1 + rand() * 3.5, 0, 0, Math.PI * 2)
        g.fill()
      }
    },
    { kind: 'color' }
  )
}

export function buildSea(THREE, ctx) {
  const world = createWorld(THREE, ctx, 'sunset', {
    sun: { elevation: 6, azimuth: 200 },
    fog: { color: 0xf0c49f, density: 0.0007 },
  })
  const { scene } = world
  const rand = seeded(77)

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), waterMaterial(THREE, { palette: world.light, scale: 1.3 }))
  sea.rotation.x = -Math.PI / 2
  scene.add(sea)

  const anchor = new THREE.Group()
  scene.add(anchor)
  const { yacht, flagTime } = buildYacht(THREE)
  anchor.add(yacht)

  // the wake: two diverging foam trails and a churned strip astern
  const foamMat = (seed) =>
    new THREE.MeshBasicMaterial({ map: foamTexture(THREE, seed), transparent: true, depthWrite: false, opacity: 0.9, fog: true })
  const trails = []
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(46, 3.2), foamMat(10 + side))
    m.rotation.x = -Math.PI / 2
    m.rotation.z = side * 0.09
    m.position.set(-22, 0.05, side * 4.5)
    m.layers.set(NO_INK_LAYER)
    anchor.add(m)
    trails.push(m)
  }
  const astern = new THREE.Mesh(new THREE.PlaneGeometry(60, 5), foamMat(30))
  astern.rotation.x = -Math.PI / 2
  astern.position.set(-38, 0.04, 0)
  astern.layers.set(NO_INK_LAYER)
  anchor.add(astern)
  trails.push(astern)
  const bow = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.6), foamMat(40))
  bow.rotation.x = -Math.PI / 2
  bow.position.set(6.5, 0.06, 2.9)
  bow.layers.set(NO_INK_LAYER)
  anchor.add(bow)
  const bow2 = bow.clone()
  bow2.position.z = -2.9
  anchor.add(bow2)
  trails.push(bow, bow2)

  // a few gulls, far off
  const gullGeo = new THREE.BufferGeometry()
  gullGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.6, 0.1, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.1, 0, 0, 0, 0, 0, -0.05, 0.05], 3)
  )
  const gullMat = new THREE.MeshBasicMaterial({ color: 0x5a4a48, side: THREE.DoubleSide, fog: true })
  const gulls = []
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Mesh(gullGeo, gullMat)
    g.position.set(range(rand, -40, 60), range(rand, 22, 40), range(rand, -80, -30))
    g.scale.setScalar(range(rand, 1.6, 2.4))
    g.userData.phase = rand() * 6
    g.layers.set(NO_INK_LAYER)
    anchor.add(g)
    gulls.push(g)
  }

  world.focusShadows(new THREE.Vector3(0, 2, 0), 30)

  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const path = {
    // relative to the yacht: a wide establishing shot settling into the
    // side-on view of the reference
    positions: [V(-90, 38, 120), V(-40, 16, 80), V(-6, 6, 50), V(2, 3.4, 38)],
    targets: [V(0, 2, 0), V(0, 2.5, 0), V(1, 3, 0), V(1, 3.2, 0)],
    fov: 32,
    near: 0.5,
  }

  return {
    scene,
    world,
    path,
    anchor,
    update(t) {
      sea.material.userData.tick(t)
      // cruising along, with a gentle pitch and roll on the swell
      anchor.position.x = t * 4
      yacht.position.y = Math.sin(t * 0.9) * 0.12
      yacht.rotation.z = Math.sin(t * 0.7) * 0.012
      yacht.rotation.x = Math.sin(t * 0.55 + 1) * 0.01
      flagTime.value = t
      for (const m of trails) m.material.map.offset.x = (t * 0.08) % 1
      for (const g of gulls) {
        const ph = t * 3 + g.userData.phase
        g.rotation.z = Math.sin(ph) * 0.3
        g.position.x += Math.sin(t * 0.2 + g.userData.phase) * 0.01
      }
    },
  }
}
