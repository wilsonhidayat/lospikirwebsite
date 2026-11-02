/**
 * Amsterdam — a canal on a warm, sunny afternoon.
 *
 * Narrow brick canal houses with neck, step, bell and spout gables line both
 * quays; elms lean over the water; boats are moored along the walls; an arched
 * brick bridge crosses further down. The flight drops to water level, glides
 * along the canal and settles on the quay edge where the couple sat, looking
 * across the water at the houses.
 *
 * Metres. The canal runs along X; water at y = 0.2, quay tops at y = 2.2.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createWorld, waterMaterial, pavingMaterial, addTrees } from '../world.js'
import { beamBatch, paintTexture, grain, blotches, seeded, range, pick, scaleBoxUVs } from '../utils.js'

const QUAY = 2.2
const CANAL_HALF = 12
const FRONT = 22 // facade line, both sides

/* --- facades -------------------------------------------------------- */

const PALETTES = [
  { wall: '#5b3324', mortar: '#8a6f5c', name: 'dark brick' },
  { wall: '#7a3a28', mortar: '#a28470', name: 'red brick' },
  { wall: '#2f4a3b', mortar: null, name: 'painted green' },
  { wall: '#e7e1d5', mortar: null, name: 'white plaster' },
  { wall: '#5f5d5a', mortar: null, name: 'grey paint' },
  { wall: '#3d2a22', mortar: '#6d5848', name: 'aubergine brick' },
]

function brick(g, w, h, wall, mortar, seed) {
  g.fillStyle = wall
  g.fillRect(0, 0, w, h)
  if (mortar) {
    const rand = seeded(seed)
    const bh = 7
    const bw = 22
    for (let y = 0; y < h; y += bh) {
      const off = (y / bh) % 2 ? bw / 2 : 0
      for (let x = -bw; x < w + bw; x += bw) {
        const v = Math.floor(range(rand, -18, 18))
        g.fillStyle = v > 0 ? `rgba(255,220,190,${v / 255})` : `rgba(0,0,0,${-v / 255})`
        g.fillRect(x + off + 1, y + 1, bw - 2, bh - 2)
      }
      g.fillStyle = mortar
      g.globalAlpha = 0.35
      g.fillRect(0, y, w, 1)
      g.globalAlpha = 1
    }
  }
  blotches(g, w, h, { color: 'rgba(0,0,0,0.07)', count: 18, seed })
  grain(g, w, h, 14, seed)
}

/** One storey of a canal-house front with `n` tall sash windows. */
function storeyTexture(THREE, palette, n, seed, ground = false) {
  return paintTexture(
    THREE,
    256,
    256,
    (g, w, h) => {
      brick(g, w, h, palette.wall, palette.mortar, seed)
      const rand = seeded(seed + 9)
      const light = palette.wall === '#e7e1d5'
      for (let i = 0; i < n; i++) {
        const slot = w / n
        const ww = slot * (ground ? 0.62 : 0.56)
        const wh = h * (ground ? 0.78 : 0.7)
        const x = i * slot + (slot - ww) / 2
        const y = ground ? h - wh - 4 : h * 0.14
        const door = ground && i === 0 && n > 1
        // white frame (dark green on the white houses)
        g.fillStyle = light ? '#2f3a33' : '#f1ede4'
        g.fillRect(x - 4, y - 4, ww + 8, wh + 8)
        if (door) {
          g.fillStyle = pick(rand, ['#1e2a24', '#5a1f1f', '#1c2433', '#2b2b2b'])
          g.fillRect(x, y + wh * 0.08, ww, wh * 0.92)
          g.fillStyle = 'rgba(255,255,255,0.25)'
          g.fillRect(x + ww * 0.15, y + wh * 0.12, ww * 0.7, wh * 0.18)
          continue
        }
        const grd = g.createLinearGradient(0, y, 0, y + wh)
        grd.addColorStop(0, '#6f7c86')
        grd.addColorStop(0.45, '#2b3238')
        grd.addColorStop(1, '#1b1f23')
        g.fillStyle = grd
        g.fillRect(x, y, ww, wh)
        // sash bars
        g.fillStyle = light ? '#2f3a33' : '#f1ede4'
        g.fillRect(x, y + wh / 2 - 2, ww, 4)
        g.fillRect(x + ww / 2 - 1.5, y, 3, wh)
        g.fillRect(x, y + wh / 4, ww, 2)
        g.fillRect(x, y + (wh * 3) / 4, ww, 2)
        // a curtain or a plant in some windows
        if (rand() < 0.3) {
          g.fillStyle = 'rgba(235,225,205,0.35)'
          g.fillRect(x + 2, y + 2, ww * 0.3, wh * 0.45)
        }
      }
      // lintel shadow under each storey
      g.fillStyle = 'rgba(0,0,0,0.12)'
      g.fillRect(0, 0, w, 5)
    },
    { kind: 'color' }
  )
}

function glossTexture(THREE, n, ground) {
  // glass is glossy, brick is not
  return paintTexture(
    THREE,
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#ebebeb'
      g.fillRect(0, 0, w, h)
      for (let i = 0; i < n; i++) {
        const slot = w / n
        const ww = slot * (ground ? 0.62 : 0.56)
        const wh = h * (ground ? 0.78 : 0.7)
        const x = i * slot + (slot - ww) / 2
        const y = ground ? h - wh - 4 : h * 0.14
        if (ground && i === 0 && n > 1) continue
        g.fillStyle = '#1a1a1a'
        g.fillRect(x, y, ww, wh)
      }
    },
    { kind: 'data' }
  )
}

/* --- gables ----------------------------------------------------------- */

function gableShape(THREE, type, w, gh) {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.lineTo(w, 0)
  switch (type) {
    case 'step': {
      const steps = 3
      for (let i = 0; i < steps; i++) {
        const y = (gh * (i + 1)) / (steps + 1)
        const x = w - (w * 0.35 * (i + 1)) / steps
        s.lineTo(w - (w * 0.35 * i) / steps, y)
        s.lineTo(x, y)
      }
      s.lineTo(w * 0.62, gh)
      s.lineTo(w * 0.38, gh)
      for (let i = steps - 1; i >= 0; i--) {
        const y = (gh * (i + 1)) / (steps + 1)
        s.lineTo((w * 0.35 * (i + 1)) / steps, y)
        s.lineTo((w * 0.35 * i) / steps, y)
      }
      break
    }
    case 'neck':
      s.lineTo(w, gh * 0.22)
      s.quadraticCurveTo(w * 0.82, gh * 0.3, w * 0.74, gh * 0.42)
      s.lineTo(w * 0.74, gh * 0.9)
      s.lineTo(w * 0.5, gh)
      s.lineTo(w * 0.26, gh * 0.9)
      s.lineTo(w * 0.26, gh * 0.42)
      s.quadraticCurveTo(w * 0.18, gh * 0.3, 0, gh * 0.22)
      break
    case 'bell':
      s.quadraticCurveTo(w, gh * 0.5, w * 0.66, gh * 0.62)
      s.lineTo(w * 0.66, gh * 0.88)
      s.quadraticCurveTo(w * 0.5, gh * 1.06, w * 0.34, gh * 0.88)
      s.lineTo(w * 0.34, gh * 0.62)
      s.quadraticCurveTo(0, gh * 0.5, 0, 0)
      break
    case 'cornice':
      s.lineTo(w, gh * 0.28)
      s.lineTo(0, gh * 0.28)
      break
    default: // spout
      s.lineTo(w * 0.5, gh)
  }
  s.closePath()
  return s
}

/* --- the scene ---------------------------------------------------------- */

export function buildAmsterdam(THREE, ctx, { light = 'golden' } = {}) {
  const world = createWorld(THREE, ctx, light, {
    sun: { elevation: 21, azimuth: 205 },
  })
  const { scene } = world
  const rand = seeded(1612)
  const low = ctx.quality === 'low'
  const reach = low ? 130 : 210

  // Water
  const water = waterMaterial(THREE, { color: 0x2e3524, repeat: 18, stretch: [3, 1], strength: 0.25 })
  const canal = new THREE.Mesh(new THREE.PlaneGeometry(reach * 2 + 120, CANAL_HALF * 2), water)
  canal.rotation.x = -Math.PI / 2
  canal.position.y = 0.2
  scene.add(canal)

  // Quay walls (dark brick, wet at the waterline) and the cobbled streets
  const quayWall = new THREE.MeshStandardMaterial({
    map: paintTexture(THREE, 256, 256, (g, w, h) => brick(g, w, h, '#4a2e24', '#6b5446', 77), { kind: 'color', repeat: [80, 1] }),
    roughness: 0.9,
  })
  const street = pavingMaterial(THREE, { base: '#8a7765', cobble: true, tile: 40, repeat: [160, 6], rough: 0.88, seed: 31 })
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(reach * 2 + 120, QUAY + 1, 1.2), quayWall)
    wall.position.set(0, (QUAY - 1) / 2, side * (CANAL_HALF + 0.6))
    wall.receiveShadow = true
    scene.add(wall)
    const s = new THREE.Mesh(new THREE.BoxGeometry(reach * 2 + 120, 0.4, FRONT - CANAL_HALF), street)
    s.position.set(0, QUAY - 0.2, side * (CANAL_HALF + (FRONT - CANAL_HALF) / 2))
    s.receiveShadow = true
    scene.add(s)
    // a kerb of pale stone along the quay edge
    const kerb = new THREE.Mesh(
      new THREE.BoxGeometry(reach * 2 + 120, 0.18, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.8 })
    )
    kerb.position.set(0, QUAY + 0.06, side * (CANAL_HALF + 0.25))
    kerb.receiveShadow = true
    scene.add(kerb)
  }

  // The rest of the city behind the canal houses: streets and a back row of
  // roofs, so nothing floats when seen from above
  const backGround = pavingMaterial(THREE, { base: '#6f655a', tile: 64, repeat: [300, 150], rough: 0.95, seed: 8 })
  const backRoof = new THREE.MeshStandardMaterial({ color: 0x4a3f38, roughness: 0.85 })
  const backWall = new THREE.MeshStandardMaterial({ color: 0x5e3a2c, roughness: 0.9 })
  const blockGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(3000, 1500), backGround)
    g.rotation.x = -Math.PI / 2
    g.position.set(0, QUAY - 0.02, side * (CANAL_HALF + 750))
    g.receiveShadow = true
    scene.add(g)
    // two rows of plain blocks with pitched roofs, behind the canal-front houses
    const n = Math.ceil((reach * 2 + 200) / 9)
    const walls = new THREE.InstancedMesh(blockGeo, backWall, n * 2)
    const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(0.72, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0), backRoof, n * 2)
    const bm = new THREE.Matrix4()
    let k = 0
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < n; i++) {
        const bx = -reach - 100 + i * 9 + range(rand, -1, 1)
        const bz = side * (FRONT + 22 + row * 26 + range(rand, 0, 4))
        const bh = range(rand, 11, 17)
        bm.compose(new THREE.Vector3(bx, QUAY, bz), new THREE.Quaternion(), new THREE.Vector3(8.4, bh, 18))
        walls.setMatrixAt(k, bm)
        bm.compose(new THREE.Vector3(bx, QUAY + bh, bz), new THREE.Quaternion(), new THREE.Vector3(8.4, range(rand, 4, 6), 18))
        roofs.setMatrixAt(k, bm)
        k++
      }
    }
    walls.castShadow = roofs.castShadow = true
    scene.add(walls, roofs)
  }

  // Houses, both sides
  const storeyH = 3.3
  const groups = new Map() // material key → geometries
  const add = (key, make, geo) => {
    if (!groups.has(key)) groups.set(key, { make, geos: [] })
    groups.get(key).geos.push(geo)
  }
  const gableMats = PALETTES.map((p, i) =>
    new THREE.MeshStandardMaterial({
      map: paintTexture(THREE, 256, 256, (g, w, h) => brick(g, w, h, p.wall, p.mortar, 300 + i), { kind: 'color', repeat: [0.35, 0.35] }),
      roughness: 0.92,
    })
  )
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x38322f, roughness: 0.8 })
  const atticMat = new THREE.MeshStandardMaterial({ color: 0x1b1f23, roughness: 0.15 })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xefe9de, roughness: 0.7 })
  const roofGeos = []
  const atticGeos = []
  const trimGeos = []
  const gableGeos = PALETTES.map(() => [])

  for (const side of [-1, 1]) {
    let x = -reach
    while (x < reach) {
      const w = range(rand, 5.4, 8.6)
      const n = w > 7.2 ? 3 : 2
      const floors = Math.floor(range(rand, 3, 5.99))
      const h = 3.8 + floors * storeyH
      const d = range(rand, 12, 16)
      const pi = Math.floor(rand() * PALETTES.length)
      const key = `${pi}-${n}`

      const body = new THREE.BoxGeometry(w, h, d)
      scaleBoxUVs(body, w, h, d, w, storeyH)
      // the box faces +Z for side −1 houses (facing the canal) and −Z for side +1
      const m = new THREE.Matrix4().makeRotationY(side > 0 ? Math.PI : 0)
      m.setPosition(x + w / 2, QUAY + h / 2, side * (FRONT + d / 2))
      body.applyMatrix4(m)
      add(
        key,
        () => {
          const map = storeyTexture(THREE, PALETTES[pi], n, 500 + pi * 7 + n)
          const roughnessMap = glossTexture(THREE, n, false)
          return new THREE.MeshStandardMaterial({ map, roughnessMap, roughness: 1, metalness: 0 })
        },
        body
      )

      // gable on top of the front wall
      const type = pick(rand, ['neck', 'step', 'bell', 'spout', 'cornice', 'neck', 'bell'])
      const gh = type === 'cornice' ? 4.2 : range(rand, 4.8, 7)
      const gShape = gableShape(THREE, type, w, gh)
      const gGeo = new THREE.ExtrudeGeometry(gShape, { depth: 0.55, bevelEnabled: false, curveSegments: 10 })
      gGeo.translate(-w / 2, 0, -0.55)
      const gm = new THREE.Matrix4().makeRotationY(side > 0 ? Math.PI : 0)
      gm.setPosition(x + w / 2, QUAY + h, side * FRONT)
      gGeo.applyMatrix4(gm)
      gableGeos[pi].push(gGeo)

      // pitched roof behind the gable
      const roof = new THREE.Shape()
      roof.moveTo(-w / 2, 0)
      roof.lineTo(w / 2, 0)
      roof.lineTo(0, Math.min(gh * 0.85, 5.5))
      roof.closePath()
      const rDepth = d - 0.6
      const rGeo = new THREE.ExtrudeGeometry(roof, { depth: rDepth, bevelEnabled: false })
      // the extrusion runs +Z; start it so it always runs away from the canal
      rGeo.translate(x + w / 2, QUAY + h, side > 0 ? FRONT + 0.55 : -(FRONT + 0.55) - rDepth)
      roofGeos.push(rGeo)

      // attic window and hoist beam on the gable
      if (type !== 'cornice') {
        const win = new THREE.PlaneGeometry(w * 0.2, gh * 0.22)
        const wm = new THREE.Matrix4().makeRotationY(side > 0 ? Math.PI : 0)
        wm.setPosition(x + w / 2, QUAY + h + gh * 0.45, side * (FRONT - 0.02))
        win.applyMatrix4(wm)
        atticGeos.push(win)
        const beam = new THREE.BoxGeometry(0.22, 0.22, 1.1)
        beam.translate(x + w / 2, QUAY + h + gh * 0.82, side * FRONT - side * 0.55)
        trimGeos.push(beam)
      } else {
        // a cornice: a projecting white moulding
        const cornice = new THREE.BoxGeometry(w + 0.1, 0.45, 0.6)
        cornice.translate(x + w / 2, QUAY + h + gh * 0.28, side * FRONT - side * 0.3)
        trimGeos.push(cornice)
      }
      x += w + range(rand, 0, 0.15)
    }
  }

  const merged = (geos, mat) => {
    if (!geos.length) return
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat)
    mesh.castShadow = mesh.receiveShadow = true
    scene.add(mesh)
  }
  groups.forEach(({ make, geos }) => merged(geos, make()))
  gableGeos.forEach((geos, i) => merged(geos, gableMats[i]))
  merged(roofGeos, roofMat)
  merged(atticGeos, atticMat)
  merged(trimGeos, trimMat)

  // Elms along both quays
  const trees = []
  for (let x = -reach; x <= reach; x += range(rand, 9, 12)) {
    for (const side of [-1, 1]) {
      if (Math.abs(x - 42) < 7) continue // keep the bridge clear
      trees.push({ x: x + range(rand, -1, 1), y: QUAY, z: side * (CANAL_HALF + 4.5), h: range(rand, 13, 17) })
    }
  }
  addTrees(THREE, scene, trees, { seed: 12, leaf: [0x4b6b2c, 0x5d7c34, 0x3f5c27] })

  // Moored boats along the walls
  const hullGeo = new THREE.CapsuleGeometry(1, 1, 4, 12)
  hullGeo.rotateZ(Math.PI / 2)
  const hulls = new THREE.InstancedMesh(hullGeo, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 }), 40)
  const hm = new THREE.Matrix4()
  const col = new THREE.Color()
  let b = 0
  for (let x = -reach + 10; x < reach - 10 && b < 40; x += range(rand, 9, 20)) {
    const side = rand() < 0.5 ? -1 : 1
    const len = range(rand, 4, 7)
    hm.compose(
      new THREE.Vector3(x, 0.35, side * (CANAL_HALF - 1.6)),
      new THREE.Quaternion(),
      new THREE.Vector3(len / 3, 0.42, 0.95)
    )
    hulls.setMatrixAt(b, hm)
    hulls.setColorAt(b, col.setHex(pick(rand, [0x1f3b2c, 0x6b2a22, 0x2a2f38, 0x7a5b3a, 0xe9e5dc])))
    b++
  }
  hulls.count = b
  hulls.castShadow = true
  scene.add(hulls)

  // An arched brick bridge
  const span = CANAL_HALF * 2 + 4
  const bridgeShape = new THREE.Shape()
  bridgeShape.moveTo(-span / 2, -0.5)
  bridgeShape.lineTo(span / 2, -0.5)
  bridgeShape.lineTo(span / 2, QUAY + 0.5)
  bridgeShape.lineTo(-span / 2, QUAY + 0.5)
  bridgeShape.closePath()
  const arch = new THREE.Path()
  arch.moveTo(-6.5, 0)
  arch.lineTo(6.5, 0)
  arch.absellipse(0, 0, 6.5, 1.9, 0, Math.PI, false)
  arch.closePath()
  bridgeShape.holes.push(arch)
  const bridgeGeo = new THREE.ExtrudeGeometry(bridgeShape, { depth: 8, bevelEnabled: false, curveSegments: 24 })
  bridgeGeo.rotateY(Math.PI / 2)
  bridgeGeo.translate(38, 0, 0)
  const bridge = new THREE.Mesh(bridgeGeo, gableMats[0])
  bridge.castShadow = bridge.receiveShadow = true
  scene.add(bridge)
  const rails = beamBatch(THREE)
  for (const x of [38.2, 45.8]) {
    rails.add(new THREE.Vector3(x, QUAY + 1.4, -span / 2), new THREE.Vector3(x, QUAY + 1.4, span / 2), 0.08)
    for (let z = -span / 2; z <= span / 2; z += 1.6) rails.add(new THREE.Vector3(x, QUAY + 0.5, z), new THREE.Vector3(x, QUAY + 1.4, z), 0.06)
  }
  scene.add(rails.build(new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.7 })))

  // Where the flight lands: on the quay edge, looking across at the houses
  const end = new THREE.Vector3(-4, QUAY + 1.15, -(CANAL_HALF + 1.6))
  world.focusShadows(new THREE.Vector3(0, 6, 8), 45)

  const path = {
    positions: [
      new THREE.Vector3(-reach + 20, 46, 70),
      new THREE.Vector3(-120, 18, 6),
      new THREE.Vector3(-60, 3.2, 0),
      new THREE.Vector3(-18, 3.0, -4),
      end,
    ],
    targets: [
      new THREE.Vector3(-40, 8, 0),
      new THREE.Vector3(0, 4, 0),
      new THREE.Vector3(30, 5, 6),
      new THREE.Vector3(0, 9, 30),
      new THREE.Vector3(-3, 10.5, FRONT + 4),
    ],
    fov: 48,
    near: 0.3,
  }

  return {
    scene,
    world,
    path,
    update(t) {
      water.userData.tick(t)
    },
  }
}
