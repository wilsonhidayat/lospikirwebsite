/**
 * Leidseplein, Amsterdam — a bright winter afternoon.
 *
 * Built from Amara's photos: the round granite fountain with its low stepped
 * basins and jets, ringed by pollarded plane trees, bare for winter and wound
 * with warm fairy lights; the tall brick hotel block behind it; tram tracks
 * and overhead wires crossing the square. Around the edges: the
 * Stadsschouwburg (red brick and white stone, an arcade along its front), the
 * American Hotel with its corner tower, and a row of café houses with
 * awnings. The flight comes down over the square and settles at the
 * fountain's edge, looking across it as in the photographs.
 *
 * Metres. The fountain is at the origin; the hotel block is toward −Z.
 */
import { createWorld, waterMaterial, pavingMaterial } from '../world.js'
import { beamBatch, paintTexture, grain, blotches, seeded, range, pick } from '../utils.js'
import { NO_INK_LAYER } from '../post.js'

/* --- facades ------------------------------------------------------------ */

/**
 * A painted facade: `floors` storeys of `cols` windows on brick or plaster,
 * with an optional ground floor (café awning, arcade, or plain).
 */
function facadeTexture(THREE, { wall = '#7a3a28', mortar = '#a28470', floors = 5, cols = 4, ground = 'plain', band = null, frame = '#efe9dd', seed = 1, awning = '#6b1f22', w = 512, h = 768 }) {
  return paintTexture(
    THREE,
    w,
    h,
    (g) => {
      const rand = seeded(seed)
      g.fillStyle = wall
      g.fillRect(0, 0, w, h)
      if (mortar) {
        g.fillStyle = mortar
        g.globalAlpha = 0.22
        for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1)
        g.globalAlpha = 1
      }
      blotches(g, w, h, { color: 'rgba(0,0,0,0.06)', count: 22, seed })
      const groundH = ground === 'plain' ? h / (floors + 1) : h * 0.2
      const fh = (h - groundH) / floors
      for (let f = 0; f < floors; f++) {
        const y0 = f * fh
        if (band) {
          g.fillStyle = band
          g.fillRect(0, y0 + fh - 7, w, 7)
        }
        for (let c = 0; c < cols; c++) {
          const slot = w / cols
          const ww = slot * 0.46
          const wh = fh * 0.64
          const x = c * slot + (slot - ww) / 2
          const y = y0 + fh * 0.16
          g.fillStyle = frame
          g.fillRect(x - 4, y - 4, ww + 8, wh + 8)
          const grd = g.createLinearGradient(0, y, 0, y + wh)
          grd.addColorStop(0, '#9fb3c4')
          grd.addColorStop(0.5, '#3a434c')
          grd.addColorStop(1, '#22272d')
          g.fillStyle = grd
          g.fillRect(x, y, ww, wh)
          g.fillStyle = frame
          g.fillRect(x + ww / 2 - 1.5, y, 3, wh)
          g.fillRect(x, y + wh * 0.42, ww, 3)
        }
      }
      const gy = h - groundH
      if (ground === 'cafe') {
        // big shop windows, warm inside, and a striped awning
        g.fillStyle = '#2a2420'
        g.fillRect(0, gy, w, groundH)
        for (let c = 0; c < cols; c++) {
          const slot = w / cols
          g.fillStyle = 'rgba(255,196,120,0.75)'
          g.fillRect(c * slot + 10, gy + groundH * 0.32, slot - 20, groundH * 0.62)
        }
        g.fillStyle = awning
        g.fillRect(0, gy + 4, w, groundH * 0.22)
        g.fillStyle = 'rgba(255,255,255,0.22)'
        for (let x = 0; x < w; x += 28) g.fillRect(x, gy + 4, 14, groundH * 0.22)
        // a lit sign
        g.fillStyle = pick(rand, ['#ffd27a', '#ff8f6b', '#f2f0e8'])
        g.fillRect(w * 0.3, gy - 22, w * 0.4, 14)
      } else if (ground === 'arcade') {
        // a row of round arches in pale stone
        g.fillStyle = '#e6dccb'
        g.fillRect(0, gy, w, groundH)
        const n = cols + 1
        for (let i = 0; i < n; i++) {
          const slot = w / n
          const cx = i * slot + slot / 2
          const r = slot * 0.36
          g.fillStyle = '#2b2622'
          g.beginPath()
          g.moveTo(cx - r, h)
          g.lineTo(cx - r, gy + r + 10)
          g.arc(cx, gy + r + 10, r, Math.PI, 0)
          g.lineTo(cx + r, h)
          g.closePath()
          g.fill()
        }
      } else {
        for (let c = 0; c < cols; c++) {
          const slot = w / cols
          g.fillStyle = c === 0 ? '#2a2a2a' : '#30363c'
          g.fillRect(c * slot + slot * 0.25, gy + groundH * 0.2, slot * 0.5, groundH * 0.78)
        }
      }
      grain(g, w, h, 14, seed)
    },
    { kind: 'color' }
  )
}

/** A box building with a painted front (+Z face in its own space) and plain sides. */
function building(THREE, { w, h, d, front, side = 0x6e4a3a, roof = 0x3d3f44, gable = null }) {
  const group = new THREE.Group()
  const sideMat = new THREE.MeshStandardMaterial({ color: side, roughness: 0.92 })
  const frontMat = new THREE.MeshStandardMaterial({ map: front, roughness: 0.9 })
  // box faces: +x, −x, +y, −y, +z, −z
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sideMat, sideMat, sideMat, sideMat, frontMat, sideMat])
  body.position.y = h / 2
  body.castShadow = body.receiveShadow = true
  group.add(body)
  const roofMat = new THREE.MeshStandardMaterial({ color: roof, roughness: 0.6, metalness: 0.2 })
  if (gable) {
    // a stepped or pointed gable on the front, Amsterdam-style
    const shape = new THREE.Shape()
    const gw = w / 2
    if (gable === 'step') {
      shape.moveTo(-gw, 0)
      shape.lineTo(-gw, h * 0.08)
      shape.lineTo(-gw * 0.66, h * 0.08)
      shape.lineTo(-gw * 0.66, h * 0.16)
      shape.lineTo(-gw * 0.33, h * 0.16)
      shape.lineTo(-gw * 0.33, h * 0.24)
      shape.lineTo(gw * 0.33, h * 0.24)
      shape.lineTo(gw * 0.33, h * 0.16)
      shape.lineTo(gw * 0.66, h * 0.16)
      shape.lineTo(gw * 0.66, h * 0.08)
      shape.lineTo(gw, h * 0.08)
      shape.lineTo(gw, 0)
    } else {
      shape.moveTo(-gw, 0)
      shape.lineTo(0, h * 0.22)
      shape.lineTo(gw, 0)
    }
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false })
    const g = new THREE.Mesh(geo, sideMat)
    g.position.set(0, h, d / 2 - 0.6)
    g.castShadow = true
    group.add(g)
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.01, w * 0.62, h * 0.2, 4, 1), roofMat)
    r.rotation.y = Math.PI / 4
    r.scale.set(1, 1, d / w)
    r.position.set(0, h + h * 0.1, -0.5)
    group.add(r)
  } else {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.8, d + 0.6), roofMat)
    r.position.y = h + 0.4
    group.add(r)
  }
  return group
}

/* --- winter plane trees with fairy lights --------------------------------- */

function addPlaneTrees(THREE, scene, spots, { seed = 9, lights = true, low = false } = {}) {
  const rand = seeded(seed)
  const bark = new THREE.MeshStandardMaterial({ color: 0xa79a88, roughness: 0.95 })
  const wood = beamBatch(THREE)
  const bulbs = []
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 1, 8).translate(0, 0.5, 0)
  const trunks = new THREE.InstancedMesh(trunkGeo, bark, spots.length)
  const knobs = []
  const m4 = new THREE.Matrix4()
  spots.forEach((s, i) => {
    const th = range(rand, 3.2, 4.2)
    m4.makeScale(1, th, 1).setPosition(s.x, 0, s.z)
    trunks.setMatrixAt(i, m4)
    const top = V(s.x, th, s.z)
    // pollarded: a few stout limbs rising in a vase, each ending in a knuckle
    // that sprouts a fan of thin whips
    const limbs = 4 + Math.floor(rand() * 2)
    for (let l = 0; l < limbs; l++) {
      const a = (l / limbs) * Math.PI * 2 + range(rand, -0.3, 0.3)
      const lean = range(rand, 0.35, 0.6)
      const len = range(rand, 3.2, 4.6)
      const end = V(s.x + Math.cos(a) * lean * len, th + len, s.z + Math.sin(a) * lean * len)
      wood.add(top, end, 0.22)
      knobs.push(end)
      const twigs = low ? 4 : 7
      for (let t = 0; t < twigs; t++) {
        const ta = a + range(rand, -0.9, 0.9)
        const tl = range(rand, 1.6, 3.2)
        const tip = V(end.x + Math.cos(ta) * tl * 0.35, end.y + tl, end.z + Math.sin(ta) * tl * 0.35)
        wood.add(end, tip, 0.05)
        if (lights) {
          for (let b = 1; b <= 4; b++) bulbs.push(end.clone().lerp(tip, b / 4.5))
        }
      }
      if (lights) for (let b = 1; b <= 6; b++) bulbs.push(top.clone().lerp(end, b / 6.5))
    }
  })
  trunks.castShadow = true
  scene.add(trunks)
  scene.add(wood.build(bark))
  const knobMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 6), bark, knobs.length)
  knobs.forEach((p, i) => knobMesh.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)))
  scene.add(knobMesh)
  if (bulbs.length) {
    const bulbMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.055, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffc56e }),
      bulbs.length
    )
    bulbs.forEach((p, i) => bulbMesh.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)))
    bulbMesh.layers.set(NO_INK_LAYER)
    scene.add(bulbMesh)
  }
}

/* --- the scene ----------------------------------------------------------- */

export function buildLeidseplein(THREE, ctx, { light = 'day' } = {}) {
  const world = createWorld(THREE, ctx, light, {
    // low winter sun from the south-west
    sun: { elevation: 15, azimuth: 215 },
    fog: { color: 0xd6dde3, density: 0.0016 },
  })
  const { scene } = world
  const rand = seeded(1883)
  const low = ctx.quality === 'low'

  // The square: brick paving, a wide pale border
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200),
    pavingMaterial(THREE, { base: '#8f8077', tile: 64, repeat: [300, 300], cobble: true, rough: 0.9 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  const slabs = new THREE.Mesh(
    new THREE.CircleGeometry(15, 48),
    Object.assign(pavingMaterial(THREE, { base: '#9a948c', tile: 96, repeat: [4, 4], rough: 0.85 }), {
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    })
  )
  slabs.rotation.x = -Math.PI / 2
  slabs.position.y = 0.02
  slabs.receiveShadow = true
  scene.add(slabs)

  /* the fountain: an outer granite rim, a sheet of water, stepped inner basins */
  const granite = new THREE.MeshStandardMaterial({ color: 0xb4ada3, roughness: 0.75 })
  const rimGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(8.2, 0),
      new THREE.Vector2(8.2, 0.62),
      new THREE.Vector2(8.6, 0.62),
      new THREE.Vector2(8.6, 0.55),
      new THREE.Vector2(8.95, 0.55),
      new THREE.Vector2(8.95, 0),
    ],
    72
  )
  const rim = new THREE.Mesh(rimGeo, granite)
  rim.castShadow = rim.receiveShadow = true
  scene.add(rim)
  const water = waterMaterial(THREE, { palette: world.light, scale: 0.12, strokes: 0.55 })
  const pool = new THREE.Mesh(new THREE.CircleGeometry(8.25, 64), water)
  pool.rotation.x = -Math.PI / 2
  pool.position.y = 0.42
  scene.add(pool)
  // stepped round platforms in the water, off-centre like the real one
  for (const [x, z, r, h] of [
    [5.2, -2.4, 2.6, 0.75],
    [5.2, -2.4, 1.7, 1.25],
    [-3.4, 3.2, 1.6, 0.6],
  ]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), granite)
    m.position.set(x, h / 2, z)
    m.castShadow = m.receiveShadow = true
    scene.add(m)
  }
  // bronze figures resting on the rim
  const bronze = new THREE.MeshStandardMaterial({ color: 0x8a7a63, roughness: 0.5, metalness: 0.4 })
  for (const a of [0.6, 2.3, 4.1]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 10), bronze)
    m.scale.set(1.9, 0.55, 0.8)
    m.position.set(Math.cos(a) * 7.4, 0.62, Math.sin(a) * 7.4)
    m.rotation.y = -a
    m.castShadow = true
    scene.add(m)
  }
  // the jets: arcs and spouts of water, drawn soft (never inked)
  const jetMat = new THREE.MeshBasicMaterial({ color: 0xf4f7fa, transparent: true, opacity: 0.62, depthWrite: false })
  const jets = []
  const spout = (x, z, h, r = 0.09) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.4, r, h, 8, 1, true).translate(0, h / 2, 0), jetMat)
    m.position.set(x, 0.42, z)
    m.layers.set(NO_INK_LAYER)
    scene.add(m)
    jets.push({ m, h, phase: rand() * 6 })
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    spout(Math.cos(a) * 6.4, Math.sin(a) * 6.4, range(rand, 0.8, 1.5))
  }
  spout(5.2, -2.4, 2.6, 0.14)
  spout(-3.4, 3.2, 1.9, 0.12)
  // arcing jets from the rim toward the middle
  const arcCurve = (a) =>
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(Math.cos(a) * 8.2, 0.6, Math.sin(a) * 8.2),
      new THREE.Vector3(Math.cos(a) * 6.2, 3.1, Math.sin(a) * 6.2),
      new THREE.Vector3(Math.cos(a) * 4.0, 0.42, Math.sin(a) * 4.0)
    )
  for (let i = 0; i < 8; i++) {
    const tube = new THREE.Mesh(new THREE.TubeGeometry(arcCurve((i / 8) * Math.PI * 2 + 0.2), 16, 0.05, 5), jetMat)
    tube.layers.set(NO_INK_LAYER)
    scene.add(tube)
  }

  /* the plane trees around the fountain, and more along the square */
  const trees = []
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.25
    trees.push({ x: Math.cos(a) * 13.5, z: Math.sin(a) * 13.5 })
  }
  for (let x = -40; x <= 40; x += 9) {
    trees.push({ x: x + range(rand, -1, 1), z: -32 + range(rand, -1, 1) })
  }
  addPlaneTrees(THREE, scene, low ? trees.filter((_, i) => i % 2 === 0) : trees, { low })

  /* tram tracks and the overhead wires across the square */
  const rail = new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.4, metalness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 })
  for (const z of [-46, -47.44, -50.4, -51.84]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(400, 0.04, 0.12), rail)
    r.position.set(0, 0.03, z)
    scene.add(r)
  }
  const wires = beamBatch(THREE)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  for (let x = -120; x <= 120; x += 30) {
    wires.add(V(x, 0, -42.5), V(x, 7.2, -42.5), 0.22)
    wires.add(V(x, 0, -55.5), V(x, 7.2, -55.5), 0.22)
    wires.add(V(x, 6.8, -42.5), V(x, 6.8, -55.5), 0.04)
  }
  for (const z of [-46.72, -51.12]) wires.add(V(-140, 6.1, z), V(140, 6.1, z), 0.025)
  scene.add(wires.build(new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.5, metalness: 0.6 })))

  /* a tram, waiting at the stop */
  const tram = new THREE.Group()
  const tramWhite = new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: 0.5 })
  const tramDark = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.25, metalness: 0.3 })
  const tramAccent = new THREE.MeshStandardMaterial({ color: 0xb8312a, roughness: 0.5 })
  for (let i = 0; i < 3; i++) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(9.6, 3.0, 2.4), tramWhite)
    car.position.set(i * 10 - 10, 1.85, 0)
    car.castShadow = true
    tram.add(car)
    const glass = new THREE.Mesh(new THREE.BoxGeometry(8.6, 1.2, 2.44), tramDark)
    glass.position.set(i * 10 - 10, 2.25, 0)
    tram.add(glass)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(9.62, 0.2, 2.42), tramAccent)
    stripe.position.set(i * 10 - 10, 0.75, 0)
    tram.add(stripe)
  }
  const pant = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.1), tramDark)
  pant.position.set(0, 3.7, 0)
  tram.add(pant)
  tram.position.set(-26, 0, -46.72)
  scene.add(tram)

  /* buildings round the square */
  const place = (b, x, z, ry) => {
    b.position.set(x, 0, z)
    b.rotation.y = ry
    scene.add(b)
  }
  // the tall brick hotel behind the fountain
  place(
    building(THREE, {
      w: 64,
      h: 42,
      d: 20,
      front: facadeTexture(THREE, { wall: '#b39a82', mortar: '#cbb8a4', floors: 13, cols: 14, frame: '#d9d2c6', seed: 3, w: 1024, h: 768 }),
      side: 0xa38c76,
    }),
    6,
    -78,
    0
  )
  // lower blocks either side of it
  place(building(THREE, { w: 30, h: 22, d: 16, front: facadeTexture(THREE, { wall: '#6b3a2c', floors: 6, cols: 6, seed: 5 }), side: 0x5d3426 }), -44, -70, 0.12)
  place(building(THREE, { w: 26, h: 18, d: 16, front: facadeTexture(THREE, { wall: '#d9d1c2', mortar: null, floors: 5, cols: 5, frame: '#ffffff', seed: 6 }), side: 0xbdb3a2 }), 52, -70, -0.1)

  // the Stadsschouwburg, on the left: red brick, white stone bands, an arcade
  const schouwburg = building(THREE, {
    w: 50,
    h: 24,
    d: 32,
    front: facadeTexture(THREE, { wall: '#8a3b2b', mortar: '#b07a66', floors: 3, cols: 7, ground: 'arcade', band: '#e9e1d2', frame: '#f2ece0', seed: 8, w: 1024, h: 512 }),
    side: 0x7a3426,
    gable: 'point',
  })
  place(schouwburg, -60, -2, Math.PI / 2)

  // the American Hotel, back right, with its corner tower
  const american = building(THREE, {
    w: 34,
    h: 26,
    d: 26,
    front: facadeTexture(THREE, { wall: '#7d4a33', mortar: '#a3775f', floors: 5, cols: 8, ground: 'cafe', band: '#cfc2a8', seed: 11, awning: '#24344a', w: 1024, h: 768 }),
    side: 0x6e412d,
  })
  place(american, 50, -36, -Math.PI / 4)
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 34, 16), new THREE.MeshStandardMaterial({ color: 0x7d4a33, roughness: 0.9 }))
  tower.position.set(38, 17, -24)
  tower.castShadow = true
  scene.add(tower)
  const dome = new THREE.Mesh(new THREE.ConeGeometry(4.8, 8, 16), new THREE.MeshStandardMaterial({ color: 0x4f6a63, roughness: 0.5, metalness: 0.4 }))
  dome.position.set(38, 38, -24)
  scene.add(dome)

  // café houses down the right-hand side, gables to the square
  const awnings = ['#6b1f22', '#24344a', '#2f4a3b', '#7a5a1e', '#3a2a40']
  const walls = ['#5b3324', '#7a3a28', '#e7e1d5', '#3d2a22', '#6d4a3a', '#2f4a3b']
  let z = -14
  let s = 20
  while (z < 70) {
    const w = range(rand, 7, 11)
    const h = range(rand, 15, 21)
    const b = building(THREE, {
      w,
      h,
      d: 16,
      front: facadeTexture(THREE, { wall: pick(rand, walls), floors: 4, cols: 3, ground: 'cafe', awning: pick(rand, awnings), seed: s++ }),
      side: 0x4f3226,
      gable: pick(rand, ['step', 'point', null]),
    })
    place(b, 48 + range(rand, -0.5, 0.5), z + w / 2, -Math.PI / 2)
    z += w + 0.2
  }
  // and along the far side of the tram line, behind the viewer
  let x = -70
  while (x < 70) {
    const w = range(rand, 7, 11)
    const b = building(THREE, {
      w,
      h: range(rand, 14, 20),
      d: 14,
      front: facadeTexture(THREE, { wall: pick(rand, walls), floors: 4, cols: 3, ground: 'cafe', awning: pick(rand, awnings), seed: s++ }),
      side: 0x4f3226,
      gable: pick(rand, ['step', 'point', null]),
    })
    place(b, x + w / 2, 52, Math.PI)
    x += w + 0.2
  }
  // the city beyond, fading into the haze
  const far = new THREE.MeshStandardMaterial({ color: 0x8f7a6c, roughness: 1 })
  const block = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const blocks = new THREE.InstancedMesh(block, far, 160)
  const m4 = new THREE.Matrix4()
  let n = 0
  for (let i = 0; i < 400 && n < 160; i++) {
    const a = rand() * Math.PI * 2
    const r = range(rand, 120, 420)
    const bx = Math.cos(a) * r
    const bz = Math.sin(a) * r
    if (bz > 40 && Math.abs(bx) < 60) continue
    m4.compose(new THREE.Vector3(bx, 0, bz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 3), new THREE.Vector3(range(rand, 14, 30), range(rand, 12, 26), range(rand, 14, 30)))
    blocks.setMatrixAt(n++, m4)
  }
  blocks.count = n
  scene.add(blocks)

  world.focusShadows(new THREE.Vector3(0, 0, -6), 60)

  // Down over the square, settling at the fountain's edge, looking across it
  const path = {
    positions: [
      new THREE.Vector3(60, 120, 180),
      new THREE.Vector3(30, 60, 90),
      new THREE.Vector3(10, 16, 34),
      new THREE.Vector3(3, 3.4, 16),
      new THREE.Vector3(1.5, 1.7, 12.5),
    ],
    targets: [
      new THREE.Vector3(0, 0, -20),
      new THREE.Vector3(0, 4, -30),
      new THREE.Vector3(0, 6, -40),
      new THREE.Vector3(-1, 7, -40),
      new THREE.Vector3(-2, 7.5, -40),
    ],
    fov: 52,
    near: 0.3,
  }

  return {
    scene,
    world,
    path,
    update(t) {
      water.userData.tick(t)
      for (const j of jets) j.m.scale.y = 0.88 + Math.sin(t * 2.2 + j.phase) * 0.12
    },
  }
}
