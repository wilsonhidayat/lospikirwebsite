/**
 * Campus — a modern Dutch university on a bright, overcast graduation day.
 *
 * A glass curtain-wall building lifted on concrete pilotis, a long 1960s
 * concrete slab with ribbon windows, a tall tower, a brick chimney (a campus
 * landmark), a pond, lawns and trees. The flight swoops between the buildings
 * and lands on the plaza under the glass building, looking up at its facade —
 * where the caps went up in the air.
 *
 * Metres.
 */
import { createWorld, grassMaterial, waterMaterial, pavingMaterial, addTrees } from '../world.js'
import { paintTexture, grain, blotches, seeded, range, scaleBoxUVs, beamBatch } from '../utils.js'

function curtainWall(THREE, { tint = '#5d6b78', seed = 3, cols = 8, rows = 4 } = {}) {
  const draw = (rough) => (g, w, h) => {
    const rand = seeded(seed)
    g.fillStyle = rough ? '#6a6a6a' : '#3a3e43' // aluminium mullions
    g.fillRect(0, 0, w, h)
    const cw = w / cols
    const rh = h / rows
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw + 3
        const y = r * rh + 3
        if (rough) {
          g.fillStyle = '#0c0c0c'
        } else {
          const grd = g.createLinearGradient(0, y, 0, y + rh)
          const base = new Array(3).fill(0).map((_, i) => parseInt(tint.slice(1 + i * 2, 3 + i * 2), 16))
          const v = range(rand, -14, 14)
          const col = (k) => `rgb(${base.map((b) => Math.max(0, Math.min(255, b + v + k))).join(',')})`
          grd.addColorStop(0, col(30))
          grd.addColorStop(1, col(-25))
          g.fillStyle = grd
        }
        g.fillRect(x, y, cw - 6, rh - 6)
        // spandrel panel at floor level
        if (!rough) {
          g.fillStyle = 'rgba(30,32,36,0.65)'
          g.fillRect(x, y + rh - 6 - rh * 0.18, cw - 6, rh * 0.18)
        }
      }
    }
  }
  return {
    map: paintTexture(THREE, 512, 512, draw(false), { kind: 'color' }),
    roughnessMap: paintTexture(THREE, 512, 512, draw(true), { kind: 'data' }),
  }
}

function concreteRibbon(THREE, { floors = 6, seed = 8, tone = '#bdb8ae' } = {}) {
  return paintTexture(
    THREE,
    512,
    512,
    (g, w, h) => {
      g.fillStyle = tone
      g.fillRect(0, 0, w, h)
      // board-marked concrete
      g.strokeStyle = 'rgba(0,0,0,0.05)'
      for (let y = 0; y < h; y += 9) {
        g.beginPath()
        g.moveTo(0, y)
        g.lineTo(w, y)
        g.stroke()
      }
      blotches(g, w, h, { color: 'rgba(40,40,35,0.08)', count: 26, seed })
      const fh = h / floors
      for (let f = 0; f < floors; f++) {
        const y = f * fh + fh * 0.3
        const grd = g.createLinearGradient(0, y, 0, y + fh * 0.5)
        grd.addColorStop(0, '#6f7a84')
        grd.addColorStop(1, '#262b31')
        g.fillStyle = grd
        g.fillRect(0, y, w, fh * 0.5)
        g.fillStyle = 'rgba(220,220,215,0.8)'
        for (let x = 0; x < w; x += w / 10) g.fillRect(x, y, 3, fh * 0.5)
      }
      grain(g, w, h, 16, seed)
    },
    { kind: 'color' }
  )
}

export function buildCampus(THREE, ctx, { light = 'overcast' } = {}) {
  const world = createWorld(THREE, ctx, light, {
    sun: { elevation: 34, azimuth: 150 },
  })
  const { scene } = world
  const rand = seeded(1956)
  const low = ctx.quality === 'low'

  // Plaza paving, lawns, a pond
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), pavingMaterial(THREE, { base: '#a9a49b', tile: 64, repeat: [600, 600], rough: 0.9, seed: 2 }))
  plaza.rotation.x = -Math.PI / 2
  plaza.receiveShadow = true
  scene.add(plaza)
  const lawnMat = grassMaterial(THREE, { repeat: [1, 1] })
  for (const [x, z, w, d] of [
    [-70, 40, 80, 60],
    [80, 60, 70, 90],
    [-20, -120, 160, 70],
  ]) {
    const geo = new THREE.PlaneGeometry(w, d)
    const uv = geo.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 8, (uv.getY(i) * d) / 8) // 8 m per tile
    const l = new THREE.Mesh(geo, lawnMat)
    l.rotation.x = -Math.PI / 2
    l.position.set(x, 0.04, z)
    l.receiveShadow = true
    scene.add(l)
  }
  const pondMat = waterMaterial(THREE, { palette: world.light, scale: 0.3, strokes: 0.5 })
  Object.assign(pondMat, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 })
  const pond = new THREE.Mesh(new THREE.PlaneGeometry(70, 26), pondMat)
  pond.rotation.x = -Math.PI / 2
  pond.position.set(10, 0.08, 42)
  scene.add(pond)
  const pondEdge = new THREE.Mesh(
    new THREE.BoxGeometry(72, 0.5, 28),
    new THREE.MeshStandardMaterial({ color: 0x8f8a82, roughness: 0.9 })
  )
  pondEdge.position.set(10, -0.2, 42)
  scene.add(pondEdge)

  const concrete = new THREE.MeshStandardMaterial({ color: 0xb7b2a8, roughness: 0.92 })

  // Building A — glass curtain wall on pilotis (the landing spot)
  const glassTex = curtainWall(THREE, { tint: '#62717f', seed: 5 })
  const glassMat = new THREE.MeshStandardMaterial({
    map: glassTex.map,
    roughnessMap: glassTex.roughnessMap,
    roughness: 1,
    metalness: 0.55,
  })
  const A = { x: 0, z: -20, w: 96, d: 42, h: 44, lift: 7 }
  const aGeo = new THREE.BoxGeometry(A.w, A.h, A.d)
  scaleBoxUVs(aGeo, A.w, A.h, A.d, 14.4, 14.4)
  const aMesh = new THREE.Mesh(aGeo, glassMat)
  aMesh.position.set(A.x, A.lift + A.h / 2, A.z)
  aMesh.castShadow = aMesh.receiveShadow = true
  scene.add(aMesh)
  // the soffit and the pilotis under it
  const soffit = new THREE.Mesh(new THREE.BoxGeometry(A.w, 1.2, A.d), concrete)
  soffit.position.set(A.x, A.lift - 0.6, A.z)
  scene.add(soffit)
  const colGeo = new THREE.CylinderGeometry(0.55, 0.55, A.lift, 20).translate(0, A.lift / 2, 0)
  const cols = new THREE.InstancedMesh(colGeo, concrete, 64)
  const m = new THREE.Matrix4()
  let n = 0
  for (let x = -A.w / 2 + 6; x <= A.w / 2 - 6; x += 12) {
    for (const z of [A.z - A.d / 2 + 5, A.z, A.z + A.d / 2 - 5]) {
      m.makeTranslation(x, 0, z)
      cols.setMatrixAt(n++, m)
    }
  }
  cols.count = n
  cols.castShadow = true
  scene.add(cols)
  // an enclosed glass lobby set back under the slab
  const lobby = new THREE.Mesh(new THREE.BoxGeometry(30, A.lift - 1.2, 16), glassMat)
  lobby.position.set(-20, (A.lift - 1.2) / 2, A.z)
  scene.add(lobby)

  // Building B — a long concrete slab with ribbon windows
  const ribbon = concreteRibbon(THREE, { floors: 6, seed: 9 })
  ribbon.repeat.set(1, 1)
  const bGeo = new THREE.BoxGeometry(150, 22, 20)
  scaleBoxUVs(bGeo, 150, 22, 20, 22, 22)
  const bMesh = new THREE.Mesh(bGeo, new THREE.MeshStandardMaterial({ map: ribbon, roughness: 0.85 }))
  bMesh.position.set(-40, 6 + 11, 130)
  bMesh.castShadow = bMesh.receiveShadow = true
  scene.add(bMesh)
  for (let x = -110; x <= 30; x += 10) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1, 6, 1), concrete)
    c.position.set(x, 3, 130)
    scene.add(c)
  }

  // Building C — a tall slab tower
  const towerTex = concreteRibbon(THREE, { floors: 8, seed: 21, tone: '#c9c3b6' })
  const cGeo = new THREE.BoxGeometry(46, 78, 22)
  scaleBoxUVs(cGeo, 46, 78, 22, 24, 24)
  const cMesh = new THREE.Mesh(cGeo, new THREE.MeshStandardMaterial({ map: towerTex, roughness: 0.85 }))
  cMesh.position.set(130, 39, -60)
  cMesh.castShadow = cMesh.receiveShadow = true
  scene.add(cMesh)

  // A second glass block further back
  const dGeo = new THREE.BoxGeometry(60, 30, 40)
  scaleBoxUVs(dGeo, 60, 30, 40, 14.4, 14.4)
  const dMesh = new THREE.Mesh(dGeo, glassMat)
  dMesh.position.set(-120, 15, -110)
  dMesh.castShadow = true
  scene.add(dMesh)

  // The brick chimney
  const brickTex = paintTexture(
    THREE,
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#7d3e2c'
      g.fillRect(0, 0, w, h)
      for (let y = 0; y < h; y += 8) {
        const off = (y / 8) % 2 ? 12 : 0
        for (let x = -24; x < w; x += 24) {
          g.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`
          g.fillRect(x + off + 1, y + 1, 22, 6)
        }
      }
      grain(g, w, h, 12, 4)
    },
    { kind: 'color', repeat: [6, 30] }
  )
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 64, 32), new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.9 }))
  chimney.position.set(-160, 32, 40)
  chimney.castShadow = true
  scene.add(chimney)

  // Elevated walkway linking A and B
  const bridge = beamBatch(THREE)
  const walkway = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 92), glassMat)
  walkway.position.set(-30, 10.5, 55)
  walkway.castShadow = true
  scene.add(walkway)
  bridge.add(new THREE.Vector3(-30, 0, 55), new THREE.Vector3(-30, 9, 55), 0.8)
  scene.add(bridge.build(concrete))

  // Trees and lamp posts
  const trees = []
  for (let i = 0; i < (low ? 40 : 80); i++) {
    const x = range(rand, -200, 200)
    const z = range(rand, -180, 220)
    if (Math.abs(x - A.x) < A.w / 2 + 8 && Math.abs(z - A.z) < A.d / 2 + 8) continue
    if (Math.abs(x + 40) < 82 && Math.abs(z - 130) < 16) continue
    if (Math.abs(x - 130) < 30 && Math.abs(z + 60) < 18) continue
    if (Math.abs(x + 120) < 36 && Math.abs(z + 110) < 26) continue
    if (Math.abs(x - 10) < 38 && Math.abs(z - 42) < 16) continue
    if (Math.abs(x) < 14 && z > 10 && z < 40) continue // keep the camera's view clear
    trees.push({ x, z, h: range(rand, 9, 15) })
  }
  addTrees(THREE, scene, trees, { seed: 33, leaf: [0x5a7a3a, 0x4a6a30, 0x6b8a44] })

  // Landing: on the plaza just in front of the glass building, looking up
  const end = new THREE.Vector3(6, 1.5, 12)
  world.focusShadows(new THREE.Vector3(0, 10, -5), 70)

  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const path = {
    positions: [V(220, 120, 260), V(110, 60, 150), V(40, 20, 70), V(14, 5, 30), end],
    targets: [V(0, 20, -20), V(0, 22, -20), V(0, 24, -20), V(2, 26, -20), V(-2, 34, -42)],
    fov: 50,
    near: 0.5,
  }

  return {
    scene,
    world,
    path,
    update(t) {
      pond.material.userData.tick(t)
    },
  }
}
