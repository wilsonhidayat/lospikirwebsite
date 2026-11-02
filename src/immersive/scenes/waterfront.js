/**
 * The waterfront — a wide city river, at sunset or at night.
 *
 * Sunset (Amsterdam, the IJ): a far bank of modern brick blocks and a slim
 * lookout tower against an orange sky, a steel stair down to the water.
 * Night (Rotterdam / a party cruise): a skyline of lit towers, a white
 * cable-stayed bridge with an angled pylon, quay lamps, light trails across
 * the water and, optionally, a lit boat sliding past.
 *
 * Metres. The viewer's quay is along z ≈ 0; the river runs along X toward −Z.
 */
import { createWorld, waterMaterial, pavingMaterial, addLamps, nightWindows } from '../world.js'
import { beamBatch, paintTexture, grain, seeded, range, pick, glowTexture } from '../utils.js'

const RIVER_FAR = -330

function brickBlock(THREE, wall, seed) {
  return paintTexture(
    THREE,
    256,
    512,
    (g, w, h) => {
      g.fillStyle = wall
      g.fillRect(0, 0, w, h)
      const rand = seeded(seed)
      const cols = 6
      const rows = 10
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = (c * w) / cols + 6
          const y = (r * h) / rows + 8
          const grd = g.createLinearGradient(0, y, 0, y + h / rows - 16)
          grd.addColorStop(0, '#9aa0a6')
          grd.addColorStop(1, '#2a2d31')
          g.fillStyle = grd
          g.fillRect(x, y, w / cols - 12, h / rows - 18)
          if (rand() < 0.2) {
            g.fillStyle = 'rgba(255,190,120,0.35)'
            g.fillRect(x, y, w / cols - 12, h / rows - 18)
          }
        }
      }
      grain(g, w, h, 14, seed)
    },
    { kind: 'color' }
  )
}

export function buildWaterfront(THREE, ctx, { light = 'sunset', bridge = false, partyBoat = false, lookout = true } = {}) {
  const night = light === 'night'
  const world = createWorld(THREE, ctx, light, night ? {} : { sun: { elevation: 3.5, azimuth: 170 } })
  const { scene } = world
  const rand = seeded(night ? 2024 : 1975)
  const low = ctx.quality === 'low'

  /* --- water and quays ------------------------------------------------ */

  const water = waterMaterial(THREE, { palette: world.light, scale: 1.1 })
  const river = new THREE.Mesh(new THREE.PlaneGeometry(4000, -RIVER_FAR + 10), water)
  river.rotation.x = -Math.PI / 2
  river.position.set(0, 0, RIVER_FAR / 2 - 5)
  scene.add(river)

  const quayMat = pavingMaterial(THREE, { base: night ? '#55524d' : '#8f8678', tile: 96, repeat: [300, 60], rough: night ? 0.55 : 0.85, seed: 5 })
  // Quays: boxes whose tops sit at y = 2, two metres above the water
  const nearQuay = new THREE.Mesh(new THREE.BoxGeometry(4000, 3, 400), quayMat)
  nearQuay.position.set(0, 0.5, 200)
  nearQuay.receiveShadow = true
  scene.add(nearQuay)
  const farQuay = new THREE.Mesh(new THREE.BoxGeometry(4000, 3, 1200), quayMat)
  farQuay.position.set(0, 0.5, RIVER_FAR - 600)
  scene.add(farQuay)

  // Timber boardwalk edge with a steel rail on the viewer's side
  const rail = beamBatch(THREE)
  for (let x = -120; x <= 120; x += 2.4) rail.add(new THREE.Vector3(x, 2, 0.4), new THREE.Vector3(x, 3.1, 0.4), 0.05)
  rail.add(new THREE.Vector3(-120, 3.1, 0.4), new THREE.Vector3(120, 3.1, 0.4), 0.07)
  scene.add(rail.build(new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.4, metalness: 0.8 })))

  /* --- the far bank ---------------------------------------------------- */

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const buildings = []
  for (let x = -1400; x < 1400; ) {
    const w = range(rand, 24, 60)
    const tall = night ? rand() < 0.22 : rand() < 0.06
    const h = tall ? range(rand, 70, night ? 160 : 95) : range(rand, 14, 34)
    const d = range(rand, 24, 46)
    buildings.push({ x: x + w / 2, z: RIVER_FAR - 16 - d / 2 - range(rand, 0, 30), w, h, d })
    x += w + range(rand, 2, 14)
  }
  // a second, taller row behind for depth
  for (let x = -1500; x < 1500; ) {
    const w = range(rand, 30, 70)
    const h = night ? range(rand, 40, 190) : range(rand, 20, 60)
    buildings.push({ x: x + w / 2, z: RIVER_FAR - 140 - range(rand, 0, 160), w, h, d: range(rand, 30, 50) })
    x += w + range(rand, 10, 60)
  }

  const materials = night
    ? [0, 1, 2].map((i) => {
        const t = nightWindows(THREE, { seed: 40 + i, litRatio: 0.32 + i * 0.08 })
        return new THREE.MeshStandardMaterial({
          map: t.map,
          emissiveMap: t.emissive,
          emissive: 0xffffff,
          emissiveIntensity: 2.2,
          roughness: 0.35,
          metalness: 0.4,
        })
      })
    : ['#7a4a35', '#5f3a2c', '#9a8c7c', '#3f3a37'].map(
        (c, i) => new THREE.MeshStandardMaterial({ map: brickBlock(THREE, c, 60 + i), roughness: 0.85 })
      )
  const perMat = materials.map(() => [])
  buildings.forEach((b) => perMat[Math.floor(rand() * materials.length)].push(b))
  perMat.forEach((list, i) => {
    const mesh = new THREE.InstancedMesh(boxGeo, materials[i], Math.max(1, list.length))
    list.forEach((b, k) => {
      m.compose(new THREE.Vector3(b.x, 2, b.z), q, new THREE.Vector3(b.w, b.h, b.d))
      mesh.setMatrixAt(k, m)
    })
    mesh.count = list.length
    mesh.castShadow = !night
    scene.add(mesh)
  })

  // A slim lookout tower with a lit crown (sunset only)
  if (lookout && !night) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(22, 84, 22), materials[3])
    tower.position.set(140, 44, RIVER_FAR - 40)
    scene.add(tower)
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(26, 9, 26),
      new THREE.MeshStandardMaterial({ color: 0x1d1f22, emissive: 0xff8a3a, emissiveIntensity: 0.35, roughness: 0.4 })
    )
    crown.position.set(140, 90, RIVER_FAR - 40)
    scene.add(crown)
  }

  /* --- a white cable-stayed bridge (night / Rotterdam) ---------------- */

  if (bridge) {
    const white = new THREE.MeshStandardMaterial({
      color: 0xf2f2f0,
      roughness: 0.4,
      metalness: 0.2,
      emissive: night ? 0x9fb4d8 : 0x000000,
      emissiveIntensity: night ? 0.25 : 0,
    })
    const bx = -120
    const deckY = 14
    const deck = new THREE.Mesh(new THREE.BoxGeometry(34, 3, -RIVER_FAR + 60), white)
    deck.position.set(bx, deckY, RIVER_FAR / 2)
    scene.add(deck)
    // piers
    for (const z of [-60, -180, -280]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(10, deckY, 6), white)
      pier.position.set(bx, deckY / 2, z)
      scene.add(pier)
    }
    // the angled pylon: two legs that kink once on the way up
    const pylon = beamBatch(THREE)
    const base = -120
    const kink = new THREE.Vector3(bx, 70, base - 22)
    const top = new THREE.Vector3(bx, 139, base + 6)
    for (const dx of [-5, 5]) {
      pylon.add(new THREE.Vector3(bx + dx, deckY, base), new THREE.Vector3(kink.x + dx * 0.4, kink.y, kink.z), 3.2, 4.2)
    }
    pylon.add(kink, top, 3.6, 4.6)
    scene.add(pylon.build(white))
    // the fan of stays
    const stays = beamBatch(THREE)
    for (let i = 1; i <= 16; i++) {
      for (const dir of [-1, 1]) {
        const z = base + dir * i * 9.5
        if (z > 20 || z < RIVER_FAR - 20) continue
        stays.add(top.clone().add(new THREE.Vector3(0, -i * 1.6, 0)), new THREE.Vector3(bx, deckY + 1.5, z), 0.22)
      }
    }
    const stayMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: night ? 0xdfe8ff : 0x000000,
      emissiveIntensity: night ? 1.4 : 0,
      roughness: 0.3,
    })
    scene.add(stays.build(stayMat, { castShadow: false }))
  }

  /* --- a steel stair down to the water (sunset) --------------------- */

  if (!night) {
    // An elevated footbridge deck along the quay, and a steel stair from it
    // down to a pontoon on the water
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.45, metalness: 0.85 })
    const st = beamBatch(THREE)
    const sx = -12
    const deckY = 8.5
    const pontoonY = 1.0
    const run = 15
    const drop = deckY - pontoonY
    const deck = new THREE.Mesh(new THREE.BoxGeometry(70, 0.8, 4), steel)
    deck.position.set(sx, deckY - 0.4, -0.5)
    deck.castShadow = deck.receiveShadow = true
    scene.add(deck)
    for (const x of [sx - 30, sx - 6, sx + 18]) st.add(new THREE.Vector3(x, 0, -0.5), new THREE.Vector3(x, deckY - 0.8, -0.5), 0.5)
    st.add(new THREE.Vector3(sx - 35, deckY + 1.1, -2.4), new THREE.Vector3(sx + 35, deckY + 1.1, -2.4), 0.07)
    for (const off of [-1.1, 1.1]) {
      st.add(new THREE.Vector3(sx + off, deckY, -2.5), new THREE.Vector3(sx + off, pontoonY, -2.5 - run), 0.18, 0.4) // stringers
      st.add(new THREE.Vector3(sx + off, deckY + 1, -2.5), new THREE.Vector3(sx + off, pontoonY + 1, -2.5 - run), 0.06) // handrails
      for (let i = 0; i <= 10; i++) {
        const t = i / 10
        st.add(
          new THREE.Vector3(sx + off, deckY - drop * t, -2.5 - run * t),
          new THREE.Vector3(sx + off, deckY + 1 - drop * t, -2.5 - run * t),
          0.04
        )
      }
    }
    for (let i = 0; i < 22; i++) {
      const t = i / 21
      const y = deckY - drop * t
      const z = -2.5 - run * t
      st.add(new THREE.Vector3(sx - 1.1, y, z), new THREE.Vector3(sx + 1.1, y, z), 0.06, 0.34) // treads
    }
    const pontoon = new THREE.Mesh(new THREE.BoxGeometry(10, 0.8, 9), steel)
    pontoon.position.set(sx, pontoonY - 0.4, -2.5 - run - 4)
    pontoon.receiveShadow = true
    scene.add(pontoon)
    scene.add(st.build(steel))
  }

  /* --- night lights ---------------------------------------------------- */

  if (night) {
    const lamps = []
    for (let x = -110; x <= 110; x += 18) lamps.push({ x, y: 2, z: 3 })
    addLamps(THREE, scene, lamps, { height: 5.5 })
    // light trails: the skyline's lights stretched across the water
    const trailTex = paintTexture(
      THREE,
      32,
      256,
      (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, 0, h)
        grd.addColorStop(0, 'rgba(255,255,255,0)')
        grd.addColorStop(0.15, 'rgba(255,255,255,0.9)')
        grd.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = grd
        g.fillRect(w * 0.3, 0, w * 0.4, h)
      },
      { kind: 'color' }
    )
    const trailMat = new THREE.MeshBasicMaterial({
      map: trailTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.5,
      fog: false,
    })
    const trails = new THREE.Group()
    for (let i = 0; i < (low ? 40 : 90); i++) {
      const b = pick(rand, buildings)
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(range(rand, 1.5, 4), range(rand, 60, 180)), trailMat.clone())
      plane.material.color.setHex(pick(rand, [0xffc98a, 0xffd9a8, 0xbcd4ff, 0xffffff]))
      plane.material.opacity = range(rand, 0.15, 0.45)
      plane.rotation.x = -Math.PI / 2
      plane.position.set(b.x + range(rand, -b.w / 3, b.w / 3), 0.06, RIVER_FAR + 70 + range(rand, -20, 20))
      trails.add(plane)
    }
    scene.add(trails)
    // the near-bank lamps reflected just in front of the viewer
    for (const l of lamps) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 26), trailMat.clone())
      plane.material.color.setHex(0xffc98a)
      plane.material.opacity = 0.45
      plane.rotation.x = -Math.PI / 2
      plane.position.set(l.x, 0.07, -16)
      scene.add(plane)
    }
  }

  // A lit boat gliding past (the party cruise)
  let boat = null
  if (partyBoat) {
    boat = new THREE.Group()
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(48, 3, 9),
      new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.4, metalness: 0.3 })
    )
    hull.position.y = 1.2
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(38, 3.2, 7.4),
      new THREE.MeshStandardMaterial({ color: 0x0c0c10, emissive: 0xb04cff, emissiveIntensity: 1.6, roughness: 0.2 })
    )
    cabin.position.y = 4.2
    const roof = new THREE.Mesh(new THREE.BoxGeometry(40, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 }))
    roof.position.y = 6
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(255,90,200,1)'), color: 0xff5ac8, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.55, depthWrite: false })
    )
    glow.scale.set(80, 22, 1)
    glow.position.y = 4
    boat.add(hull, cabin, roof, glow)
    boat.position.set(0, 0, -70)
    scene.add(boat)
  }

  /* --- the flight -------------------------------------------------------- */

  // standing on the quay just behind the railing
  const end = night ? new THREE.Vector3(18, 3.65, 1.6) : new THREE.Vector3(-4, 3.6, 1.6)
  world.focusShadows(new THREE.Vector3(-6, 3, -10), 40)

  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const path = night
    ? {
        positions: [V(-380, 150, 160), V(-220, 60, 60), V(-40, 20, -40), V(-5, 8, -20), end],
        targets: [V(-200, 40, -320), V(-180, 45, -320), V(-120, 42, -330), V(-130, 40, -330), V(-150, 40, -330)],
        fov: 46,
        near: 0.5,
      }
    : {
        positions: [V(260, 90, -520), V(120, 40, -260), V(30, 10, -90), V(0, 6, -24), end],
        targets: [V(0, 10, 0), V(-10, 8, 0), V(-20, 10, -60), V(-20, 18, -200), V(30, 22, -330)],
        fov: 48,
        near: 0.5,
      }

  return {
    scene,
    world,
    path,
    update(t) {
      water.userData.tick(t)
      if (boat) boat.position.x = ((t * 6) % 900) - 450
    },
  }
}
