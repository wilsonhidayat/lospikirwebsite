/**
 * Interior — two variants.
 *
 * 'loft': a light-filled country house. Full-height windows onto flat fields,
 * warm plaster walls, a polished concrete floor catching patches of sun,
 * a pitched ceiling with exposed timber beams, a sofa, a dining table under
 * pendant lamps, an olive tree in a pot. The flight crosses the fields and
 * comes in through the open glass doors.
 *
 * 'studio': a white cyclorama in a dark studio, softboxes either side.
 *
 * Metres. The room is centred on the origin; its glazed wall faces −Z.
 */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createWorld, addTrees } from '../world.js'
import { paintTexture, grain, blotches, seeded, range, beamBatch } from '../utils.js'

function plasterTexture(THREE, tone, seed) {
  return paintTexture(
    THREE,
    512,
    512,
    (g, w, h) => {
      g.fillStyle = tone
      g.fillRect(0, 0, w, h)
      blotches(g, w, h, { color: 'rgba(120,100,70,0.06)', count: 40, seed, size: 0.18 })
      grain(g, w, h, 8, seed)
    },
    { kind: 'color', repeat: [3, 2] }
  )
}

function buildLoft(THREE, ctx) {
  const world = createWorld(THREE, ctx, 'interior', { sun: { elevation: 22, azimuth: 205 } })
  const { scene } = world
  const rand = seeded(42)

  const W = 16
  const D = 12
  const H = 4.2 // eaves
  const ridge = 7

  /* --- outside: fields and a far tree line --------------------------- */
  const fields = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({
      color: 0x8a8a52,
      roughness: 1,
      map: paintTexture(
        THREE,
        512,
        512,
        (g, w, h) => {
          g.fillStyle = '#9c9a62'
          g.fillRect(0, 0, w, h)
          for (let y = 0; y < h; y += 6) {
            g.fillStyle = `rgba(60,70,30,${0.05 + (y % 12 ? 0.04 : 0)})`
            g.fillRect(0, y, w, 3)
          }
          grain(g, w, h, 20, 6)
        },
        { kind: 'color', repeat: [80, 80] }
      ),
    })
  )
  fields.rotation.x = -Math.PI / 2
  fields.position.y = -0.02
  fields.receiveShadow = true
  scene.add(fields)
  const line = []
  for (let x = -900; x <= 900; x += range(rand, 8, 18)) line.push({ x, z: -420 + range(rand, -20, 20), h: range(rand, 10, 18) })
  for (let x = -900; x <= 900; x += range(rand, 10, 24)) line.push({ x, z: 360 + range(rand, -20, 20), h: range(rand, 10, 18) })
  addTrees(THREE, scene, line, { seed: 8, leaf: [0x5b6b3c, 0x6b7a44, 0x4d5c34] })
  // tall dry grass by the house
  const reeds = []
  for (let i = 0; i < 70; i++) reeds.push({ x: range(rand, -30, 30), z: -D / 2 - range(rand, 6, 20), h: range(rand, 1.2, 2) })
  addTrees(THREE, scene, reeds, { seed: 10, leaf: [0xb59d6a, 0xa38c5c, 0xc6ae7c] })

  /* --- the room ------------------------------------------------------ */
  const plaster = new THREE.MeshStandardMaterial({ map: plasterTexture(THREE, '#ece4d6', 3), roughness: 0.95 })
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshPhysicalMaterial({
      map: paintTexture(
        THREE,
        512,
        512,
        (g, w, h) => {
          g.fillStyle = '#cfc6b8'
          g.fillRect(0, 0, w, h)
          blotches(g, w, h, { color: 'rgba(90,80,60,0.08)', count: 50, seed: 12, size: 0.12 })
          grain(g, w, h, 10, 12)
        },
        { kind: 'color', repeat: [2, 2] }
      ),
      roughness: 0.32,
      clearcoat: 0.5,
      clearcoatRoughness: 0.18,
    })
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  // back and side walls, with a gable shape for the pitched roof
  const gable = new THREE.Shape()
  gable.moveTo(-D / 2, 0)
  gable.lineTo(D / 2, 0)
  gable.lineTo(D / 2, H)
  gable.lineTo(0, ridge)
  gable.lineTo(-D / 2, H)
  gable.closePath()
  for (const sx of [-1, 1]) {
    // side gable walls, each with one tall window cut out
    const shape = gable.clone()
    const hole = new THREE.Path()
    hole.moveTo(-1.2, 0.4)
    hole.lineTo(1.2, 0.4)
    hole.lineTo(1.2, 3.6)
    hole.lineTo(-1.2, 3.6)
    hole.closePath()
    shape.holes.push(hole)
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false })
    geo.rotateY(Math.PI / 2)
    const wall = new THREE.Mesh(geo, plaster)
    wall.position.x = sx * (W / 2) + (sx > 0 ? 0 : -0.3)
    wall.castShadow = wall.receiveShadow = true
    scene.add(wall)
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.3), plaster)
  back.position.set(0, H / 2, D / 2 + 0.15)
  back.castShadow = back.receiveShadow = true
  scene.add(back)

  // the glazed front: thin black steel frames, a pair of open doors in the middle
  const frame = beamBatch(THREE)
  const fz = -D / 2
  for (let x = -W / 2; x <= W / 2 + 0.01; x += 2) {
    if (Math.abs(x) < 1.2) continue // the open double doors
    frame.add(new THREE.Vector3(x, 0, fz), new THREE.Vector3(x, H, fz), 0.08, 0.12)
  }
  for (const x of [-1.2, 1.2]) frame.add(new THREE.Vector3(x, 0, fz), new THREE.Vector3(x, H, fz), 0.1, 0.14) // door jambs
  frame.add(new THREE.Vector3(-W / 2, H, fz), new THREE.Vector3(W / 2, H, fz), 0.12)
  frame.add(new THREE.Vector3(-W / 2, 0.02, fz), new THREE.Vector3(W / 2, 0.02, fz), 0.1)
  frame.add(new THREE.Vector3(-W / 2, 2.5, fz), new THREE.Vector3(-1.2, 2.5, fz), 0.05)
  frame.add(new THREE.Vector3(1.2, 2.5, fz), new THREE.Vector3(W / 2, 2.5, fz), 0.05)
  const steel = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.5, metalness: 0.6 })
  scene.add(frame.build(steel))
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.03,
    metalness: 0,
    transmission: 0,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  })
  for (const [x0, x1] of [
    [-W / 2, -1.2],
    [1.2, W / 2],
  ]) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, H), glass)
    pane.position.set((x0 + x1) / 2, H / 2, fz)
    scene.add(pane)
  }
  // pitched roof planes (the ridge runs left–right) with exposed timber beams below
  const slope = Math.atan2(ridge - H, D / 2)
  const half = Math.hypot(D / 2, ridge - H)
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe9e1d3, roughness: 0.9, side: THREE.DoubleSide })
  for (const sz of [-1, 1]) {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.25, half + 0.4), roofMat)
    roof.position.set(0, H + (ridge - H) / 2 + 0.1, (sz * D) / 4)
    roof.rotation.x = sz * slope
    roof.castShadow = roof.receiveShadow = true
    scene.add(roof)
  }
  const timber = new THREE.MeshStandardMaterial({
    color: 0xb08a5e,
    roughness: 0.8,
    map: paintTexture(
      THREE,
      64,
      512,
      (g, w, h) => {
        g.fillStyle = '#b48d60'
        g.fillRect(0, 0, w, h)
        for (let y = 0; y < h; y += 3) {
          g.fillStyle = `rgba(80,50,25,${Math.random() * 0.12})`
          g.fillRect(0, y, w, 2)
        }
      },
      { kind: 'color' }
    ),
  })
  const beams = beamBatch(THREE)
  for (let x = -W / 2 + 1; x < W / 2; x += 2) {
    beams.add(new THREE.Vector3(x, H - 0.1, -D / 2), new THREE.Vector3(x, ridge - 0.25, 0), 0.18, 0.28)
    beams.add(new THREE.Vector3(x, ridge - 0.25, 0), new THREE.Vector3(x, H - 0.1, D / 2), 0.18, 0.28)
  }
  beams.add(new THREE.Vector3(-W / 2, ridge - 0.3, 0), new THREE.Vector3(W / 2, ridge - 0.3, 0), 0.3, 0.3)
  scene.add(beams.build(timber))

  /* --- furniture ----------------------------------------------------- */
  const linen = new THREE.MeshStandardMaterial({ color: 0xece5d8, roughness: 0.95 })
  const oak = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.55 })
  const stone = new THREE.MeshPhysicalMaterial({ color: 0xe6e0d6, roughness: 0.25, clearcoat: 0.6 })
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.rotation.y = ry
    m.castShadow = m.receiveShadow = true
    scene.add(m)
    return m
  }
  // sofa by the window
  add(new RoundedBoxGeometry(3.2, 0.45, 1.0, 4, 0.12), linen, -4.5, 0.32, -3.6)
  add(new RoundedBoxGeometry(3.2, 0.6, 0.3, 4, 0.12), linen, -4.5, 0.75, -3.15)
  add(new RoundedBoxGeometry(0.3, 0.55, 1.0, 4, 0.12), linen, -6.0, 0.55, -3.6)
  add(new RoundedBoxGeometry(0.3, 0.55, 1.0, 4, 0.12), linen, -3.0, 0.55, -3.6)
  // round coffee table
  add(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 40), oak, -4.4, 0.2, -2.1)
  // dining table, benches
  add(new RoundedBoxGeometry(3.4, 0.08, 1.1, 2, 0.03), oak, 3.2, 0.76, 1.4)
  for (const x of [1.8, 4.6]) for (const z of [1.0, 1.8]) add(new THREE.BoxGeometry(0.08, 0.72, 0.08), oak, x, 0.36, z)
  for (let i = 0; i < 6; i++) {
    const x = 2.0 + (i % 3) * 1.2
    const z = i < 3 ? 0.55 : 2.25
    add(new RoundedBoxGeometry(0.45, 0.06, 0.45, 2, 0.02), oak, x, 0.46, z)
    add(new RoundedBoxGeometry(0.45, 0.5, 0.05, 2, 0.02), oak, x, 0.72, z + (i < 3 ? -0.2 : 0.2))
  }
  // kitchen island in pale stone
  add(new RoundedBoxGeometry(2.6, 0.95, 0.9, 3, 0.04), stone, 4.6, 0.48, -2.6)
  // pendant lamps over the table
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.3, metalness: 0.9, emissive: 0x3a2a10 })
  const brassOpen = brass.clone()
  brassOpen.side = THREE.DoubleSide // open shades: the inside shows from below
  for (const x of [2.2, 3.2, 4.2]) {
    add(new THREE.CylinderGeometry(0.01, 0.01, 3.8, 4), steel, x, 4.5, 1.4) // cable up to the ceiling
    add(new THREE.ConeGeometry(0.28, 0.32, 32, 1, true), brassOpen, x, 2.45, 1.4)
  }
  // potted olive tree and a vase of dry stems
  add(new THREE.CylinderGeometry(0.35, 0.28, 0.6, 24), stone, -6.8, 0.3, -1.0)
  addTrees(THREE, scene, [{ x: -6.8, y: 0.6, z: -1.0, h: 2.6 }], { seed: 2, leaf: [0x6c7a52, 0x7b8a5e] })

  const end = new THREE.Vector3(-1.6, 1.45, 0.8)
  world.focusShadows(new THREE.Vector3(0, 2, 0), 14)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  return {
    scene,
    world,
    path: {
      positions: [V(40, 30, -120), V(10, 9, -45), V(0, 2.4, -14), V(-0.4, 1.7, -4), end],
      targets: [V(0, 3, 0), V(0, 2.5, 0), V(-1, 1.6, 0), V(-3, 1.2, -2), V(-4.6, 0.9, -3.6)],
      fov: 52,
      near: 0.1,
    },
    update() {},
  }
}

function buildStudio(THREE, ctx) {
  const world = createWorld(THREE, ctx, 'interior', { fog: null })
  const { scene } = world
  scene.background = new THREE.Color(0x0e0e10)
  scene.environmentIntensity = 0.25
  const white = new THREE.MeshStandardMaterial({ color: 0xecebe8, roughness: 0.9 })
  // seen from inside the curve, so both faces render
  const sweepMat = new THREE.MeshStandardMaterial({ color: 0xecebe8, roughness: 0.9, side: THREE.DoubleSide })
  // the sweep: floor curving up into a wall
  const R = 3
  const sweep = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 12, 32, 1, true, Math.PI * 1.5, Math.PI / 2), sweepMat)
  sweep.rotation.z = Math.PI / 2
  sweep.position.set(0, R, 4 - R)
  scene.add(sweep)
  const floorS = new THREE.Mesh(new THREE.PlaneGeometry(12, 14), white)
  floorS.rotation.x = -Math.PI / 2
  floorS.position.set(0, 0, 1 - 7) // runs from the foot of the sweep toward the camera
  floorS.receiveShadow = true
  scene.add(floorS)
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), white)
  wall.position.set(0, R + 4, 4)
  wall.rotation.y = Math.PI
  scene.add(wall)
  // dark surroundings
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 14, 40), new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 1, side: THREE.BackSide }))
  room.position.y = 7
  scene.add(room)
  // softboxes
  for (const sx of [-1, 1]) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.8, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 3 })
    )
    box.position.set(sx * 4, 2.4, -1)
    box.lookAt(0, 1.4, 2)
    scene.add(box)
    const light = new THREE.SpotLight(0xfff4e6, 120, 30, 0.7, 0.8)
    light.position.copy(box.position)
    light.target.position.set(0, 1, 2)
    light.castShadow = true
    scene.add(light, light.target)
  }
  world.sun.intensity = 0.3
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  return {
    scene,
    world,
    path: {
      positions: [V(0, 9, -18), V(0, 4, -12), V(0, 2, -8), V(0, 1.6, -6), V(0.3, 1.5, -5)],
      targets: [V(0, 1, 3), V(0, 1.2, 3), V(0, 1.4, 3), V(0, 1.4, 3), V(0, 1.3, 3)],
      fov: 40,
    },
    update() {},
  }
}

export function buildInterior(THREE, ctx, { variant = 'loft' } = {}) {
  return variant === 'studio' ? buildStudio(THREE, ctx) : buildLoft(THREE, ctx)
}
