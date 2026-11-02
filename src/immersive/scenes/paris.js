/**
 * Paris — the Trocadéro at the end of a soft, overcast afternoon.
 *
 * The Eiffel Tower is built as a real lattice (four square lattice legs that
 * merge into one shaft, the decorative arches, the platforms), seen across the
 * Seine from the Trocadéro steps where Evan & Inez were photographed.
 * Around it: the Pont d'Iéna, the Trocadéro gardens and fountain basin, the
 * Palais de Chaillot, and Haussmann blocks fading into the haze.
 *
 * Coordinates in metres. The tower stands at the origin; the Trocadéro is
 * toward +Z.
 */
import { createWorld, waterMaterial, pavingMaterial, addTrees } from '../world.js'
import { beamBatch, paintTexture, grain, blotches, seeded, range } from '../utils.js'

/* --- the tower --------------------------------------------------------- */

const outer = (h) => (h <= 276 ? 62.5 * Math.exp(-h / 95) + 2 : Math.max(1.4, 5.4 - (h - 276) * 0.12))
const inner = (h) => (h < 115 ? 37.5 * Math.pow(1 - h / 115, 1.35) : 0)

function towerLevels() {
  const hs = []
  for (let i = 0; i < 12; i++) hs.push(i * 4.75) // 0 → 52.25
  for (let i = 0; i < 10; i++) hs.push(57 + i * 5.8) // 57 → 109.2
  for (let i = 0; i < 21; i++) hs.push(115 + i * 8) // 115 → 275
  hs.push(276, 286, 296, 304)
  return hs
}

function buildEiffel(THREE) {
  const group = new THREE.Group()
  const iron = new THREE.MeshStandardMaterial({ color: 0x5c4a3a, roughness: 0.62, metalness: 0.45 })
  const beams = beamBatch(THREE)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const levels = towerLevels()

  // A lattice side between two corner rails (a: [x,z] at h0 → at h1; b likewise)
  function side(a0, b0, a1, b1, h0, h1, heavy) {
    const w = (Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) + Math.hypot(b1[0] - a1[0], b1[1] - a1[1])) / 2
    const n = Math.max(1, Math.min(6, Math.round(w / 7)))
    const at = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
    for (let i = 0; i < n; i++) {
      const l0 = at(a0, b0, i / n)
      const r0 = at(a0, b0, (i + 1) / n)
      const l1 = at(a1, b1, i / n)
      const r1 = at(a1, b1, (i + 1) / n)
      beams.add(V(l0[0], h0, l0[1]), V(r1[0], h1, r1[1]), heavy ? 0.42 : 0.3)
      beams.add(V(r0[0], h0, r0[1]), V(l1[0], h1, l1[1]), heavy ? 0.42 : 0.3)
      if (i > 0) beams.add(V(l0[0], h0, l0[1]), V(l1[0], h1, l1[1]), 0.32)
    }
    // horizontal girder along the top of this panel row
    beams.add(V(a1[0], h1, a1[1]), V(b1[0], h1, b1[1]), heavy ? 0.7 : 0.45, heavy ? 1.1 : 0.6)
  }

  // A square lattice tube whose four corners are given as a function of height
  function tube(corners, from, to, heavy) {
    for (let k = 0; k < levels.length - 1; k++) {
      const h0 = levels[k]
      const h1 = levels[k + 1]
      if (h1 <= from || h0 >= to) continue
      const c0 = corners(h0)
      const c1 = corners(h1)
      for (let s = 0; s < 4; s++) {
        const n = (s + 1) % 4
        side(c0[s], c0[n], c1[s], c1[n], h0, h1, heavy)
        // corner rails — the strongest members
        beams.add(V(c0[s][0], h0, c0[s][1]), V(c1[s][0], h1, c1[s][1]), heavy ? 1.3 : 0.75)
      }
    }
  }

  // Four legs, each a square tube from the ground to the second platform
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      tube(
        (h) => {
          const o = outer(h)
          const i = inner(h)
          return [
            [sx * i, sz * o],
            [sx * o, sz * o],
            [sx * o, sz * i],
            [sx * i, sz * i],
          ]
        },
        0,
        115,
        true
      )
    }
  }
  // One shaft from the second platform to the top
  tube(
    (h) => {
      const o = outer(h)
      return [
        [-o, o],
        [o, o],
        [o, -o],
        [-o, -o],
      ]
    },
    115,
    310,
    false
  )

  // The decorative arches between the legs, on each face
  for (let f = 0; f < 4; f++) {
    const rot = (f * Math.PI) / 2
    const pts = []
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      const ang = Math.PI * t
      const x = -Math.cos(ang) * 37
      const y = 4 + Math.sin(ang) * 35
      const z = outer(y) - 1.5
      pts.push(new THREE.Vector3(x * Math.cos(rot) + z * Math.sin(rot), y, -x * Math.sin(rot) + z * Math.cos(rot)))
    }
    for (let i = 0; i < pts.length - 1; i++) beams.add(pts[i], pts[i + 1], 1.1, 1.6)
  }

  group.add(beams.build(iron))

  // Platforms: a deep girder band with a lighter deck
  const deck = new THREE.MeshStandardMaterial({ color: 0x4d3e31, roughness: 0.7, metalness: 0.4 })
  const platform = (h, half, thick) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(half * 2, thick, half * 2), deck)
    m.position.y = h
    m.castShadow = true
    group.add(m)
  }
  platform(57.6, outer(57) + 3.5, 4.2)
  platform(115.7, outer(115) + 2.5, 3.6)
  platform(276, 8, 4.5)
  // Top: the lantern and the antenna
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, 14, 12), deck)
  lantern.position.y = 286
  group.add(lantern)
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 32, 8), deck)
  antenna.position.y = 309
  group.add(antenna)

  // Four stone footings
  const stone = new THREE.MeshStandardMaterial({ color: 0xb8ab94, roughness: 0.9 })
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(26, 3, 26), stone)
      m.position.set(sx * 50, 1.5, sz * 50)
      m.receiveShadow = true
      group.add(m)
    }
  }
  return group
}

/* --- Haussmann facades -------------------------------------------------- */

/** One 4-bay, 7-storey slice of a Haussmann facade. Colour + roughness. */
function haussmannTextures(THREE, seed, tone = '#d7cbb2') {
  const W = 512
  const H = 768
  const floors = [0.22, 0.12, 0.13, 0.13, 0.13, 0.13, 0.14] // ground, entresol, 2nd–5th, 6th (bottom→top)
  const draw = (rough) => (g) => {
    const rand = seeded(seed)
    g.fillStyle = rough ? '#e8e8e8' : tone
    g.fillRect(0, 0, W, H)
    if (!rough) {
      blotches(g, W, H, { color: 'rgba(60,45,25,0.07)', count: 30, seed })
      grain(g, W, H, 16, seed)
    }
    let y = H
    floors.forEach((f, level) => {
      const fh = f * H
      y -= fh
      // cornice / string course
      if (!rough) {
        g.fillStyle = 'rgba(255,250,240,0.35)'
        g.fillRect(0, y + fh - 6, W, 4)
        g.fillStyle = 'rgba(40,30,20,0.25)'
        g.fillRect(0, y + fh - 2, W, 3)
      }
      const bays = 4
      for (let b = 0; b < bays; b++) {
        const bw = W / bays
        const ww = level === 0 ? bw * 0.62 : bw * 0.36
        const wh = level === 0 ? fh * 0.7 : fh * 0.68
        const wx = b * bw + (bw - ww) / 2
        const wy = y + fh - wh - (level === 0 ? 4 : fh * 0.12)
        if (rough) {
          g.fillStyle = '#202020' // glass: glossy
          g.fillRect(wx, wy, ww, wh)
          continue
        }
        // frame
        g.fillStyle = '#efe9dd'
        g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6)
        // glass with a hint of sky reflected at the top
        const grd = g.createLinearGradient(0, wy, 0, wy + wh)
        grd.addColorStop(0, level === 0 ? '#3a352f' : '#5e6872')
        grd.addColorStop(1, '#1f2329')
        g.fillStyle = grd
        g.fillRect(wx, wy, ww, wh)
        // glazing bars
        g.fillStyle = 'rgba(235,230,220,0.85)'
        g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh)
        g.fillRect(wx, wy + wh * 0.33, ww, 2)
        g.fillRect(wx, wy + wh * 0.66, ww, 2)
        // individual wrought-iron guard on the upper floors
        if (level >= 2 && level !== 2 && level !== 5) {
          g.fillStyle = '#1b1b1d'
          g.fillRect(wx - 2, wy + wh - fh * 0.2, ww + 4, 2)
          for (let k = 0; k <= 8; k++) g.fillRect(wx + (ww / 8) * k, wy + wh - fh * 0.2, 1.5, fh * 0.2)
        }
        // shopfront awnings, sometimes
        if (level === 0 && rand() < 0.4) {
          g.fillStyle = rand() < 0.5 ? '#6b1f22' : '#24344a'
          g.fillRect(wx - 6, wy - 10, ww + 12, 14)
        }
      }
      // continuous balconies on the 2nd and 5th floors
      if (!rough && (level === 2 || level === 5)) {
        g.fillStyle = 'rgba(25,25,27,0.95)'
        g.fillRect(0, y + fh - 18, W, 3)
        for (let x = 0; x < W; x += 6) g.fillRect(x, y + fh - 18, 1.5, 16)
        g.fillStyle = 'rgba(0,0,0,0.18)'
        g.fillRect(0, y + fh - 2, W, 6)
      }
    })
    if (!rough) {
      // ground floor is a darker, rusticated stone
      g.fillStyle = 'rgba(70,55,35,0.12)'
      g.fillRect(0, H - floors[0] * H, W, floors[0] * H)
    }
  }
  return {
    map: paintTexture(THREE, W, H, draw(false), { kind: 'color' }),
    roughnessMap: paintTexture(THREE, W, H, draw(true), { kind: 'data' }),
  }
}

/** Palais de Chaillot: pale stone, tall regular openings. */
function chaillotTexture(THREE) {
  return paintTexture(
    THREE,
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#ddd2bd'
      g.fillRect(0, 0, w, h)
      blotches(g, w, h, { color: 'rgba(80,60,30,0.06)', count: 24, seed: 41 })
      for (let i = 0; i < 6; i++) {
        const x = i * (w / 6) + 18
        g.fillStyle = '#3a3a38'
        g.fillRect(x, h * 0.12, w / 6 - 36, h * 0.6)
        g.fillStyle = 'rgba(255,255,255,0.25)'
        g.fillRect(x + (w / 6 - 36) / 2 - 1, h * 0.12, 2, h * 0.6)
      }
      g.fillStyle = 'rgba(40,30,20,0.25)'
      g.fillRect(0, h * 0.08, w, 4)
      g.fillRect(0, h * 0.78, w, 5)
      grain(g, w, h, 14, 41)
    },
    { kind: 'color', repeat: [1, 1] }
  )
}

/* --- the scene ---------------------------------------------------------- */

export function buildParis(THREE, ctx, { light = 'overcast' } = {}) {
  const world = createWorld(THREE, ctx, light, {
    sun: { elevation: 24, azimuth: 235 },
    // lighter haze than the default overcast, so the tower reads from 1.5 km
    fog: { color: 0xc9cfd6, density: 0.0005 },
  })
  const { scene } = world
  const rand = seeded(1889)
  const low = ctx.quality === 'low'

  // Ground: asphalt and pale gravel
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    pavingMaterial(THREE, { base: '#8d8a84', tile: 128, repeat: [400, 400], rough: 0.95 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  // The tower
  const tower = buildEiffel(THREE)
  scene.add(tower)

  // Champ de Mars lawn behind the tower
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0x4f6a35, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 })
  const lawn = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lawnMat)
    m.rotation.x = -Math.PI / 2
    m.position.set(x, 0.05, z)
    m.receiveShadow = true
    scene.add(m)
  }
  lawn(-45, -620, 70, 900)
  lawn(45, -620, 70, 900)

  // The Seine, with stone quays
  const water = waterMaterial(THREE, { color: 0x27332f, repeat: 60, stretch: [1, 3] })
  const seine = new THREE.Mesh(new THREE.PlaneGeometry(6000, 110), water)
  seine.rotation.x = -Math.PI / 2
  seine.position.set(0, -4, 285)
  scene.add(seine)
  const quayStone = new THREE.MeshStandardMaterial({ color: 0xb4a78f, roughness: 0.92 })
  for (const z of [228, 342]) {
    const quay = new THREE.Mesh(new THREE.BoxGeometry(6000, 6, 4), quayStone)
    quay.position.set(0, -2, z)
    quay.receiveShadow = true
    scene.add(quay)
  }
  // cut the river out of the ground
  const riverBed = new THREE.Mesh(new THREE.BoxGeometry(6000, 0.2, 110), new THREE.MeshBasicMaterial({ color: 0x0c0f0e }))
  riverBed.position.set(0, -6, 285)
  scene.add(riverBed)
  ground.position.y = 0
  // ground has a hole where the river is: two strips instead of one plane
  scene.remove(ground)
  const groundMat = ground.material
  for (const [z, d] of [
    [-1385, 3226],
    [1671, 2658],
  ]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(6000, d), groundMat)
    g.rotation.x = -Math.PI / 2
    g.position.set(0, 0, z)
    g.receiveShadow = true
    scene.add(g)
  }

  // Pont d'Iéna: a stone deck on four piers
  const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(35, 2.4, 118), quayStone)
  bridgeDeck.position.set(0, 0.6, 285)
  bridgeDeck.castShadow = bridgeDeck.receiveShadow = true
  scene.add(bridgeDeck)
  for (let i = 1; i <= 4; i++) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(33, 6, 5), quayStone)
    pier.position.set(0, -3, 230 + i * 22)
    scene.add(pier)
  }

  // Trocadéro gardens: lawns, the long fountain basin, tree rows
  lawn(-70, 470, 80, 280)
  lawn(70, 470, 80, 280)
  const basinMat = waterMaterial(THREE, { color: 0x2c3a3c, repeat: 12 })
  Object.assign(basinMat, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 })
  const basin = new THREE.Mesh(new THREE.PlaneGeometry(50, 180), basinMat)
  basin.rotation.x = -Math.PI / 2
  basin.position.set(0, 0.25, 470)
  scene.add(basin)
  const kerb = new THREE.MeshStandardMaterial({ color: 0xcfc4ae, roughness: 0.9 })
  for (const x of [-25.5, 25.5]) {
    const k = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 180), kerb)
    k.position.set(x, 0.3, 470)
    scene.add(k)
  }

  // Palais de Chaillot: the raised parvis and the two curved wings
  const stone = new THREE.MeshStandardMaterial({ color: 0xd6ccb8, roughness: 0.88 })
  const PLAZA = 13
  const parvis = new THREE.Mesh(new THREE.BoxGeometry(130, PLAZA, 120), pavingMaterial(THREE, { base: '#cfc6b4', tile: 96, repeat: [8, 8], rough: 0.85 }))
  parvis.position.set(0, PLAZA / 2, 750)
  parvis.receiveShadow = parvis.castShadow = true
  scene.add(parvis)

  const wingTex = chaillotTexture(THREE)
  const wingMat = new THREE.MeshStandardMaterial({ map: wingTex, roughness: 0.85 })
  for (const sx of [-1, 1]) {
    const cx = 0
    const cz = 520
    const R = 235
    for (let a = 18; a <= 78; a += 6) {
      const ang = THREE.MathUtils.degToRad(a)
      const m = new THREE.Mesh(new THREE.BoxGeometry(25, 34, 24), wingMat)
      m.position.set(cx + sx * Math.sin(ang) * R, 17, cz + Math.cos(ang) * R)
      m.rotation.y = sx * ang
      m.castShadow = m.receiveShadow = true
      scene.add(m)
    }
  }

  // The great stairs down from the parvis, with stone side walls
  const steps = 26
  const tread = 1.4
  const rise = PLAZA / steps
  const stepGeo = new THREE.BoxGeometry(76, rise, tread)
  const stepMesh = new THREE.InstancedMesh(stepGeo, pavingMaterial(THREE, { base: '#d3cab8', tile: 256, repeat: [6, 1], rough: 0.8 }), steps)
  const m4 = new THREE.Matrix4()
  for (let i = 0; i < steps; i++) {
    // fill each step down to the ground so the flight reads as solid stone
    const top = PLAZA - i * rise
    m4.compose(
      new THREE.Vector3(0, top / 2, 690 - i * tread - tread / 2),
      new THREE.Quaternion(),
      new THREE.Vector3(1, top / rise, 1)
    )
    stepMesh.setMatrixAt(i, m4)
  }
  stepMesh.castShadow = stepMesh.receiveShadow = true
  scene.add(stepMesh)
  const flightLen = steps * tread
  // Solid stone cheek walls either side of the flight: a triangle in
  // profile (low at the bottom, parvis height at the top) with a parapet on top
  const cheek = new THREE.Shape()
  cheek.moveTo(0, 0)
  cheek.lineTo(flightLen, 0)
  cheek.lineTo(flightLen, PLAZA)
  cheek.closePath()
  const cheekGeo = new THREE.ExtrudeGeometry(cheek, { depth: 3, bevelEnabled: false })
  cheekGeo.rotateY(-Math.PI / 2) // profile runs along +Z, thickness along -X
  for (const x of [-38, 41]) {
    const wall = new THREE.Mesh(cheekGeo, stone)
    wall.position.set(x, 0, 690 - flightLen)
    wall.castShadow = wall.receiveShadow = true
    scene.add(wall)
    const slope = new THREE.Mesh(new THREE.BoxGeometry(3, 1.3, Math.hypot(flightLen, PLAZA)), stone)
    slope.position.set(x - 1.5, PLAZA / 2 + 0.65, 690 - flightLen / 2)
    slope.rotation.x = -Math.atan2(PLAZA, flightLen) // high end toward the parvis
    slope.castShadow = slope.receiveShadow = true
    scene.add(slope)
    const level = new THREE.Mesh(new THREE.BoxGeometry(3, 1.3, 30), stone)
    level.position.set(x - 1.5, PLAZA + 0.65, 705)
    level.castShadow = true
    scene.add(level)
  }
  // the parvis balustrade facing the tower
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(26, 1.3, 2.4), stone)
    wall.position.set(sx * 52, PLAZA + 0.65, 691)
    wall.castShadow = true
    scene.add(wall)
  }

  // Haussmann blocks everywhere else, fading into the haze
  const tones = ['#d9cdb4', '#cfc2a6', '#e0d6c2']
  const facadeMats = tones.map((tone, i) => {
    const t = haussmannTextures(THREE, 100 + i, tone)
    t.map.repeat.set(5, 1)
    t.roughnessMap.repeat.set(5, 1)
    return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, roughness: 1, metalness: 0 })
  })
  const blockGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const roofGeo = new THREE.CylinderGeometry(0.7071 * 0.78, 0.7071, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0)
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x69727a, roughness: 0.5, metalness: 0.55 })
  const chimneyMat = new THREE.MeshStandardMaterial({ color: 0xb57a5a, roughness: 0.9 })

  const spots = []
  const step = 86
  const reach = low ? 1300 : 1900
  for (let x = -reach; x <= reach; x += step) {
    for (let z = -reach; z <= reach + 600; z += step) {
      const bx = x + range(rand, -6, 6)
      const bz = z + range(rand, -6, 6)
      const axis = Math.abs(bx) < 150 && bz > -1150 && bz < 860
      const river = bz > 190 && bz < 380
      const palais = bz > 560 && bz < 930 && Math.abs(bx) < 360
      const nearTower = Math.hypot(bx, bz) < 160
      if (axis || river || palais || nearTower) continue
      spots.push([bx, bz])
    }
  }
  const perMat = [[], [], []]
  spots.forEach((s) => perMat[Math.floor(rand() * 3)].push(s))
  const roofs = new THREE.InstancedMesh(roofGeo, roofMat, spots.length)
  const chimneys = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), chimneyMat, spots.length * 3)
  const q = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)
  let r = 0
  let c = 0
  perMat.forEach((list, mi) => {
    const blocks = new THREE.InstancedMesh(blockGeo, facadeMats[mi], list.length)
    list.forEach(([bx, bz], i) => {
      const h = range(rand, 19, 23)
      const size = range(rand, 62, 70)
      q.setFromAxisAngle(yAxis, (Math.floor(rand() * 4) * Math.PI) / 2)
      m4.compose(new THREE.Vector3(bx, 0, bz), q, new THREE.Vector3(size, h, size))
      blocks.setMatrixAt(i, m4)
      m4.compose(new THREE.Vector3(bx, h, bz), q, new THREE.Vector3(size, range(rand, 5.5, 7.5), size))
      roofs.setMatrixAt(r++, m4)
      for (let k = 0; k < 3; k++) {
        m4.compose(
          new THREE.Vector3(bx + range(rand, -0.38, 0.38) * size, h + 5, bz + range(rand, -0.38, 0.38) * size),
          q,
          new THREE.Vector3(range(rand, 2, 5), range(rand, 2.5, 4), 1.2)
        )
        chimneys.setMatrixAt(c++, m4)
      }
    })
    blocks.castShadow = blocks.receiveShadow = true
    scene.add(blocks)
  })
  roofs.castShadow = true
  scene.add(roofs, chimneys)

  // Trees: Trocadéro gardens, along the Seine, the Champ de Mars
  const trees = []
  for (let z = 350; z <= 640; z += 14) {
    for (const x of [-118, -104, 104, 118]) trees.push({ x: x + range(rand, -2, 2), z: z + range(rand, -2, 2), h: range(rand, 11, 16) })
  }
  for (let x = -900; x <= 900; x += 15) {
    if (Math.abs(x) < 30) continue
    trees.push({ x, z: 214, h: range(rand, 13, 18) })
    trees.push({ x, z: 356, h: range(rand, 13, 18) })
  }
  for (let z = -1050; z <= -130; z += 13) {
    for (const x of [-95, -82, 82, 95]) trees.push({ x, z, h: range(rand, 12, 17) })
  }
  addTrees(THREE, scene, low ? trees.filter((_, i) => i % 2 === 0) : trees, { seed: 75 })

  // Where the flight lands: on the steps, looking up at the tower
  const end = new THREE.Vector3(30, 9.3, 676)
  world.focusShadows(new THREE.Vector3(20, 6, 680), 60)

  const path = {
    positions: [
      new THREE.Vector3(-560, 300, 1420),
      new THREE.Vector3(-300, 150, 1040),
      new THREE.Vector3(-70, 52, 820),
      new THREE.Vector3(22, 22, 724),
      new THREE.Vector3(28, 15, 692),
      end,
    ],
    targets: [
      new THREE.Vector3(0, 170, 0),
      new THREE.Vector3(0, 150, 0),
      new THREE.Vector3(0, 125, 0),
      new THREE.Vector3(-4, 112, 0),
      new THREE.Vector3(-15, 115, 0),
      new THREE.Vector3(-26, 118, 0),
    ],
    fov: 46,
    near: 1,
  }

  return {
    scene,
    world,
    path,
    update(t) {
      water.userData.tick(t)
      basin.material.userData.tick(t)
    },
  }
}
