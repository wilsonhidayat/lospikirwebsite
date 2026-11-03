/**
 * Graduation hall — the Avans University atrium on the evening of Owen's
 * graduation.
 *
 * A two-storey atrium: dark 30 × 60 cm floor tiles with a soft sheen, white
 * painted brick walls washed by warm downlight scallops, round white columns
 * carrying a gallery with a dense black balustrade, a wide open-tread oak
 * stair up to it, a glass facade onto a dark plaza with street lamps, lit
 * rooms behind interior windows, lockers, signs, trees in white planters —
 * and the photographer's corner: the hot-pink "GRADUATED / GESLAAGD" printed
 * backdrop with the avans logo, two softboxes on stands, and a high table
 * with bouquets (sunflowers in kraft paper, pink gerberas) and yearbooks.
 *
 * Lighting is the hall's own: warm recessed downlights (emissive discs that
 * bloom, with their light pools and wall scallops), a handful of real low
 * point lights for the light on things and the glints in the floor, two
 * spots from the softboxes on the backdrop, and the night outside. Every
 * material inside gets the hall's own HDR light probe (see interior.js).
 *
 * Metres; the facade faces −Z; the gallery runs along the north side.
 */
import { createWorld, addLamps } from '../world.js'
import * as M from '../materials.js'
import { addForest } from '../trees.js'
import { seeded, range, beamBatch, glowTexture } from '../utils.js'
import { makeKit } from './interior.js'

/* --- painted prints ---------------------------------------------------------- */

const FONT = '"Open Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif'

/** The printed backdrop: GRADUATED / GESLAAGD in many sizes on avans red. */
function backdropCanvas(K, W, H, rand) {
  const c = K.canvas(W, H)
  const g = c.getContext('2d')
  const s = H / 900
  g.fillStyle = '#d3124b'
  g.fillRect(0, 0, W, H)
  // a little unevenness in the print / light
  const grd = g.createRadialGradient(W * 0.5, H * 0.45, H * 0.1, W * 0.5, H * 0.5, W * 0.7)
  grd.addColorStop(0, 'rgba(255,255,255,0.04)')
  grd.addColorStop(1, 'rgba(0,0,0,0.08)')
  g.fillStyle = grd
  g.fillRect(0, 0, W, H)
  g.textBaseline = 'alphabetic'
  const sizes = [62, 78, 96, 120, 150, 210, 290]
  let y = 0
  let row = 0
  while (y < H + 60 * s) {
    const big = rand() < 0.28
    const size = (big ? sizes[4 + Math.floor(rand() * 3)] : sizes[Math.floor(rand() * 4)]) * s
    y += size * 0.86
    let x = -rand() * size * 3
    while (x < W) {
      const word = rand() < 0.5 ? 'GRADUATED' : 'GESLAAGD'
      const bold = word === 'GESLAAGD' ? rand() < 0.8 : rand() < 0.35
      const italic = rand() < 0.3
      const outline = size > 180 * s && rand() < 0.45
      g.font = `${italic ? 'italic ' : ''}${bold ? 800 : 500} ${Math.round(size)}px ${FONT}`
      if (outline) {
        g.strokeStyle = 'rgba(255,255,255,0.95)'
        g.lineWidth = 3 * s
        g.strokeText(word, x, y)
      } else {
        g.fillStyle = 'rgba(255,255,255,0.96)'
        g.fillText(word, x, y)
      }
      x += g.measureText(word).width + size * range(rand, 0.18, 0.4)
    }
    y += size * 0.08
    row++
  }
  // the avans logo block, top left
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 420 * s, 170 * s)
  g.fillStyle = '#d3124b'
  g.font = `italic 800 ${Math.round(96 * s)}px ${FONT}`
  g.fillText('avans', 30 * s, 92 * s)
  g.font = `500 ${Math.round(34 * s)}px ${FONT}`
  g.fillText('university', 190 * s, 128 * s)
  g.font = `500 ${Math.round(22 * s)}px ${FONT}`
  g.fillText('of applied sciences', 190 * s, 156 * s)
  return c
}

/** A wall banner: STUDENT Support on red. */
function bannerCanvas(K, W, H) {
  const c = K.canvas(W, H)
  const g = c.getContext('2d')
  g.fillStyle = '#c8183f'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#ffffff'
  g.font = `800 ${Math.round(W * 0.19)}px ${FONT}`
  g.fillText('STUDENT', W * 0.07, H * 0.16)
  g.font = `500 ${Math.round(W * 0.15)}px ${FONT}`
  g.fillText('Support', W * 0.07, H * 0.27)
  g.font = `600 ${Math.round(W * 0.07)}px ${FONT}`
  const lines = ['Welzijn, begeleiding', 'en ontwikkeling', 'naast je studie']
  lines.forEach((l, i) => g.fillText(l, W * 0.07, H * (0.4 + i * 0.06)))
  g.fillStyle = 'rgba(255,255,255,0.9)'
  g.fillRect(W * 0.07, H * 0.86, W * 0.4, H * 0.05)
  g.fillStyle = '#c8183f'
  g.font = `italic 800 ${Math.round(W * 0.07)}px ${FONT}`
  g.fillText('avans', W * 0.1, H * 0.9)
  return c
}

/** Locker doors: a grid of red-brown doors with keypads and numbers. */
function lockerCanvas(K, W, H, cols, rows) {
  const c = K.canvas(W, H)
  const g = c.getContext('2d')
  g.fillStyle = '#2a1714'
  g.fillRect(0, 0, W, H)
  const cw = W / cols
  const rh = H / rows
  let n = 101
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = k * cw
      const y = r * rh
      g.fillStyle = '#7d3127'
      g.fillRect(x + 2, y + 2, cw - 4, rh - 4)
      g.fillStyle = 'rgba(255,255,255,0.06)'
      g.fillRect(x + 2, y + 2, cw - 4, 3)
      g.fillStyle = '#1b1b1d'
      g.fillRect(x + cw * 0.72, y + rh * 0.42, cw * 0.16, rh * 0.2)
      g.fillStyle = '#5fd0a0'
      g.fillRect(x + cw * 0.75, y + rh * 0.45, cw * 0.04, rh * 0.03)
      g.fillStyle = '#e8e2d8'
      g.font = `600 ${Math.round(rh * 0.08)}px ${FONT}`
      g.fillText(String(n++), x + cw * 0.12, y + rh * 0.15)
    }
  }
  return c
}

/** Wayfinding sign. */
function signCanvas(K, W, H) {
  const c = K.canvas(W, H)
  const g = c.getContext('2d')
  g.fillStyle = '#f4f4f2'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#1c1c1e'
  const row = (y, arrow, a, b) => {
    g.font = `700 ${Math.round(H * 0.12)}px ${FONT}`
    g.fillText(a, W * 0.2, y)
    g.font = `500 ${Math.round(H * 0.075)}px ${FONT}`
    g.fillText(b, W * 0.2, y + H * 0.1)
    g.save()
    g.translate(W * 0.1, y - H * 0.04)
    g.rotate(arrow)
    g.beginPath()
    g.moveTo(-W * 0.035, H * 0.012)
    g.lineTo(W * 0.01, H * 0.012)
    g.lineTo(W * 0.01, H * 0.04)
    g.lineTo(W * 0.05, 0)
    g.lineTo(W * 0.01, -H * 0.04)
    g.lineTo(W * 0.01, -H * 0.012)
    g.lineTo(-W * 0.035, -H * 0.012)
    g.fill()
    g.restore()
  }
  row(H * 0.22, -Math.PI / 2, 'ZONE D', 'Grand café · Plaza')
  row(H * 0.52, 0, 'ZONE B', 'Restaurant · Aula')
  row(H * 0.82, Math.PI, 'SERRE A', 'Collegezalen')
  return c
}

/** A warm lit room glimpsed through an interior window. */
function roomCanvas(K, W, H, rand) {
  const c = K.canvas(W, H)
  const g = c.getContext('2d')
  const grd = g.createLinearGradient(0, 0, 0, H)
  grd.addColorStop(0, '#fff0d8')
  grd.addColorStop(0.35, '#e8b07a')
  grd.addColorStop(1, '#5a3a22')
  g.fillStyle = grd
  g.fillRect(0, 0, W, H)
  // furniture and people-shaped shadows inside
  for (let i = 0; i < 9; i++) {
    g.fillStyle = `rgba(30,18,10,${range(rand, 0.3, 0.7)})`
    const x = rand() * W
    const w = range(rand, 0.05, 0.18) * W
    const h = range(rand, 0.15, 0.45) * H
    g.fillRect(x, H - h, w, h)
  }
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(255,248,230,0.9)'
    g.fillRect(rand() * W, H * 0.04, W * 0.1, H * 0.03)
  }
  return c
}

/** Magazine cover: a red band and a photo of graduates throwing their caps. */
function coverCanvas(K, W, H, rand) {
  const c = K.canvas(W, H)
  const g = c.getContext('2d')
  const sky = g.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#4f86c6')
  sky.addColorStop(0.6, '#a9c9e8')
  sky.addColorStop(1, '#6d7d8c')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  g.fillStyle = 'rgba(200,220,235,0.8)'
  for (let i = 0; i < 6; i++) g.fillRect(i * W * 0.17, H * 0.3, W * 0.12, H * 0.35)
  for (let i = 0; i < 260; i++) {
    g.fillStyle = ['#222', '#e9d1b8', '#c9a27d', '#7a4b32', '#f0f0f0', '#1d2a50'][Math.floor(rand() * 6)]
    g.fillRect(rand() * W, H * range(rand, 0.6, 0.98), W * 0.025, H * 0.04)
  }
  for (let i = 0; i < 18; i++) {
    g.fillStyle = '#111'
    g.fillRect(rand() * W, H * range(rand, 0.15, 0.5), W * 0.03, H * 0.012)
  }
  g.fillStyle = '#d3124b'
  g.fillRect(0, 0, W, H * 0.04)
  g.fillRect(0, 0, W * 0.04, H)
  g.fillStyle = '#ffffff'
  g.font = `italic 800 ${Math.round(H * 0.07)}px ${FONT}`
  g.fillText('avans', W * 0.62, H * 0.12)
  return c
}

/** Additive light shapes: a downlight's scallop on a wall, a pool on the floor. */
function scallopTexture(THREE, K) {
  const W = 64
  const H = 128
  const c = K.canvas(W, H)
  const g = c.getContext('2d')
  const img = g.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    const v = y / H
    const w = 0.12 + 0.9 * Math.sqrt(v)
    for (let x = 0; x < W; x++) {
      const u = (x / (W - 1)) * 2 - 1
      const cone = Math.exp(-Math.pow(u / w, 2) * 2.6)
      const top = Math.min(1, v / 0.05)
      const fall = Math.exp(-v * 2.2)
      const arc = 1 + 1.6 * Math.exp(-Math.pow((v - 0.13 - Math.abs(u) * 0.12) / 0.07, 2))
      const k = Math.min(1, cone * top * fall * arc * 0.75)
      const i = (y * W + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round(k * 255)
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.needsUpdate = true
  return t
}

/* --- the hall ------------------------------------------------------------------ */

export function buildHall(THREE, ctx) {
  const K = makeKit(THREE, ctx)
  const { low, tf, box, rbox, cyl, sphere, lathe, rod, slab, pbr, std } = K
  const q = ctx.quality
  const rand = seeded(2407)
  const world = createWorld(THREE, ctx, 'night', {
    exposure: 1.55,
    fog: { density: 0.0016 },
    moon: { elevation: 32, azimuth: 150 },
    sunIntensity: 0.3,
  })
  const { scene } = world
  world.hemi.intensity = 0.3
  const inside = new THREE.Group()
  const outside = new THREE.Group()
  scene.add(inside, outside)
  const B = K.batcher()
  const O = K.batcher()
  const iron = beamBatch(THREE) // balustrades, stringers, mullions
  const glassGeos = []

  const HX = 15
  const HZ = 10
  const T = 0.3
  const GZ = 4.0 // gallery front edge
  const GY0 = 3.6 // gallery soffit
  const GY1 = 4.4 // gallery floor
  const ROOF = 8.5
  const SKY = { z0: -6.5, z1: -2.5 } // skylight strip in the roof
  const ST = { x0: -10.5, x1: -8.1, z0: -2.5, z1: GZ, n: 23 } // the stair
  const BD = { x0: 0.5, x1: 6.5, z: 2.5, h: 2.6 } // the printed backdrop
  const V = (x, y, z) => new THREE.Vector3(x, y, z)

  /* --- materials ----------------------------------------------------------------- */
  const tiles = pbr(
    (a, h, r, S) => {
      a.fillStyle = '#1c1b1a'
      a.fillRect(0, 0, S, S)
      h.fillStyle = '#202020'
      h.fillRect(0, 0, S, S)
      r.fillStyle = '#8a8a8a'
      r.fillRect(0, 0, S, S)
      const rows = 4
      const ch = S / rows
      const cw = S / 2
      const gap = Math.max(1.5, S * 0.004)
      for (let ri = 0; ri < rows; ri++) {
        const off = ri % 2 ? cw / 2 : 0
        for (let ci = -1; ci <= 2; ci++) {
          const x = ci * cw + off + gap
          const y = ri * ch + gap
          const k = range(rand, 0.86, 1.14)
          a.fillStyle = `rgb(${Math.round(48 * k)},${Math.round(47 * k)},${Math.round(45 * k)})`
          a.fillRect(x, y, cw - 2 * gap, ch - 2 * gap)
          h.fillStyle = '#c8c8c8'
          h.fillRect(x, y, cw - 2 * gap, ch - 2 * gap)
          const v = Math.round(range(rand, 62, 96))
          r.fillStyle = `rgb(${v},${v},${v})`
          r.fillRect(x, y, cw - 2 * gap, ch - 2 * gap)
        }
      }
      K.blots(a, S, 18, 'rgba(255,255,255,0.025)', 0.05, 0.2, rand)
      K.grit(a, S, 6, rand)
      K.blots(r, S, 22, 'rgba(255,255,255,0.1)', 0.04, 0.16, rand)
    },
    { normal: 2 }
  )
  const brick = M.brick(THREE, { color: '#e2ded6', mortar: '#cbc5bb', variation: 0.04, dirt: 0.04, tile: 2, quality: q, seed: 61 })
  const plasterW = M.plaster(THREE, { color: '#e6e3dd', dirt: 0.03, tile: 3, quality: q, seed: 62 })
  const ceilTiles = pbr(
    (a, h, r, S) => {
      a.fillStyle = '#dcdbd7'
      a.fillRect(0, 0, S, S)
      for (let i = 0; i < S * 10; i++) {
        const x = rand() * S
        const y = rand() * S
        a.fillStyle = `rgba(80,80,75,${range(rand, 0.05, 0.18)})`
        a.fillRect(x, y, range(rand, 1, 3), 1)
        h.fillStyle = 'rgba(0,0,0,0.45)'
        h.fillRect(x, y, range(rand, 1, 3), 1)
      }
      for (const g of [a, h]) {
        g.fillStyle = g === a ? '#efefed' : '#ffffff'
        for (const k of [0, 0.5]) {
          g.fillRect(k * S, 0, 4, S)
          g.fillRect(0, k * S, S, 4)
        }
      }
      r.fillStyle = '#e4e4e4'
      r.fillRect(0, 0, S, S)
    },
    { normal: 2 }
  )
  const darkCeil = std('#26272a', 0.9, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(0.4, 0.4) })
  const roofTop = std('#2c2c2d', 0.95)
  const columnMat = std('#ebe9e4', 0.55, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(0.2, 0.2) })
  const steel = std('#1d1e20', 0.42, 0.6)
  const tread = K.wood('#b88d62', { rough: 0.5 })
  const doorWood = K.wood('#9a6a44', { rough: 0.55 })
  const glass = K.glassMaterial(2)
  const whiteMat = std('#f0efeb', 0.5)
  const black = std('#121213', 0.5, 0.3)
  const fabricBlack = std('#151517', 0.95)
  const roomTex = K.texOf(roomCanvas(K, 256, 128, rand), true)
  const roomMat = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 1, emissiveMap: roomTex, emissive: 0xffffff, emissiveIntensity: 0.55 })

  /* --- shell ------------------------------------------------------------------------- */
  B.add(tiles, slab(-HX - T, HX + T, -0.3, 0, -HZ - T, HZ + T, 1.2))
  K.wallRun(B, brick, 'z', HZ, HZ + T, -HX - T, HX + T, ROOF + 0.3, [], 2)
  K.wallRun(B, brick, 'x', -HX - T, -HX, -HZ - T, HZ, ROOF + 0.3, [], 2)
  K.wallRun(B, brick, 'x', HX, HX + T, -HZ - T, HZ, ROOF + 0.3, [], 2)
  // the gallery: slab, tiled floor, suspended tile soffit, a white fascia
  B.add(plasterW, slab(-HX, HX, GY0 + 0.02, GY1 - 0.02, GZ, HZ, 3))
  B.add(tiles, slab(-HX, HX, GY1 - 0.02, GY1, GZ, HZ, 1.2))
  B.add(
    ceilTiles,
    K.quad(
      [
        [-HX, GY0, GZ],
        [HX, GY0, GZ],
        [HX, GY0, HZ],
        [-HX, GY0, HZ],
      ],
      [
        [-HX / 1.2, -GZ / 1.2],
        [HX / 1.2, -GZ / 1.2],
        [HX / 1.2, -HZ / 1.2],
        [-HX / 1.2, -HZ / 1.2],
      ],
      V(0, -1, 0)
    ),
    false
  )
  B.add(whiteMat, slab(-HX, HX, GY0 - 0.12, GY1, GZ - 0.04, GZ, 1))
  // the roof with its skylight strip, and a dark acoustic ceiling
  O.add(roofTop, slab(-HX - T, HX + T, ROOF, ROOF + 0.4, -HZ - T, SKY.z0, 3))
  O.add(roofTop, slab(-HX - T, HX + T, ROOF, ROOF + 0.4, SKY.z1, HZ + T, 3))
  for (const [z0, z1] of [
    [-HZ, SKY.z0],
    [SKY.z1, HZ],
  ]) {
    B.add(
      darkCeil,
      K.quad(
        [
          [-HX, ROOF - 0.005, z0],
          [HX, ROOF - 0.005, z0],
          [HX, ROOF - 0.005, z1],
          [-HX, ROOF - 0.005, z1],
        ],
        [
          [0, 0],
          [10, 0],
          [10, 4],
          [0, 4],
        ],
        V(0, -1, 0)
      ),
      false
    )
  }
  for (let x = -HX; x <= HX + 0.01; x += 2.5) iron.add(V(x, ROOF + 0.05, SKY.z0), V(x, ROOF + 0.05, SKY.z1), 0.12, 0.25)
  {
    const g = new THREE.PlaneGeometry(2 * HX, SKY.z1 - SKY.z0)
    g.rotateX(Math.PI / 2)
    g.translate(0, ROOF + 0.35, (SKY.z0 + SKY.z1) / 2)
    glassGeos.push(g)
  }

  // white round columns under the gallery; slender steel ones up to the roof
  for (const x of [-12, -6, 0, 6, 12]) {
    B.add(columnMat, K.planarUV(cyl(0.22, 0.22, GY0, 40).translate(x, GY0 / 2, GZ + 0.3), 1))
    B.add(columnMat, cyl(0.25, 0.25, 0.04, 40).translate(x, 0.02, GZ + 0.3))
  }
  for (const x of [-12, 0, 12]) B.add(steel, cyl(0.11, 0.11, ROOF - GY1, 20).translate(x, (GY1 + ROOF) / 2, GZ + 0.3))

  // the balustrade along the gallery edge (open where the stair arrives)
  {
    const y0 = GY1
    const top = GY1 + 1.05
    const zr = GZ + 0.06
    for (const [a, b] of [
      [-HX, ST.x0],
      [ST.x1, HX],
    ]) {
      for (let x = a + 0.06; x < b - 0.02; x += 0.12) iron.add(V(x, y0 + 0.08, zr), V(x, top - 0.04, zr), 0.018, 0.018)
      for (let x = a + 0.05; x <= b; x += 1.5) iron.add(V(x, y0, zr), V(x, top, zr), 0.05, 0.05)
      iron.add(V(a, top - 0.02, zr), V(b, top - 0.02, zr), 0.06, 0.05)
      iron.add(V(a, y0 + 0.08, zr), V(b, y0 + 0.08, zr), 0.04, 0.03)
    }
  }

  /* --- the stair: oak treads on steel stringers, handrails ------------------------ */
  {
    const rise = GY1 / ST.n
    const go = (ST.z1 - ST.z0) / ST.n
    for (let i = 0; i < ST.n - 1; i++) {
      const y = (i + 1) * rise
      const z = ST.z0 + i * go
      B.add(tread, slab(ST.x0 + 0.04, ST.x1 - 0.04, y - 0.05, y, z - 0.02, z + go + 0.02, 1))
    }
    const slopeTo = (x, dy) => [V(x, dy, ST.z0 - 0.05), V(x, GY1 + dy - 0.05, ST.z1)]
    for (const x of [ST.x0, ST.x1]) {
      const [a, b] = slopeTo(x, -0.12)
      iron.add(a, b, 0.03, 0.32)
      const [ha, hb] = slopeTo(x, 0.95)
      iron.add(ha, hb, 0.05, 0.04)
      const [ma, mb] = slopeTo(x, 0.5)
      iron.add(ma, mb, 0.02, 0.02)
      for (let k = 0; k <= 7; k++) {
        const t = k / 7
        const z = ST.z0 + t * (ST.z1 - ST.z0)
        const y = t * GY1
        iron.add(V(x, y, z), V(x, y + 0.95, z), 0.04, 0.04)
      }
    }
  }

  /* --- the glass facade with its entrance --------------------------------------- */
  {
    const zf = -HZ - 0.15
    const mullions = []
    for (let x = -12.5; x <= 12.51; x += 2.5) if (Math.abs(x) > 1) mullions.push(x)
    for (const x of [-HX + 0.05, HX - 0.05, ...mullions]) iron.add(V(x, 0, zf), V(x, ROOF, zf), 0.09, 0.22)
    for (const y of [0.05, 2.8, 5.6, ROOF - 0.08]) iron.add(V(-HX, y, zf), V(HX, y, zf), 0.18, 0.1)
    const cuts = [-HX, ...mullions, HX]
    for (let i = 0; i < cuts.length - 1; i++) {
      for (const [y0, y1] of [
        [0.05, 2.8],
        [2.8, 5.6],
        [5.6, ROOF - 0.08],
      ]) {
        if (y0 < 1 && cuts[i] < 0 && cuts[i + 1] > 0) continue // the open entrance
        const g = new THREE.PlaneGeometry(cuts[i + 1] - cuts[i], y1 - y0)
        g.translate((cuts[i] + cuts[i + 1]) / 2, (y0 + y1) / 2, zf)
        glassGeos.push(g)
      }
    }
    // sliding door leaves parked open either side of the entrance
    for (const sx of [-1, 1]) {
      const x0 = sx * 1.3
      const x1 = sx * 2.45
      const a = Math.min(x0, x1)
      const b = Math.max(x0, x1)
      iron.add(V(a, 0, zf + 0.12), V(a, 2.7, zf + 0.12), 0.05, 0.05)
      iron.add(V(b, 0, zf + 0.12), V(b, 2.7, zf + 0.12), 0.05, 0.05)
      iron.add(V(a, 2.7, zf + 0.12), V(b, 2.7, zf + 0.12), 0.05, 0.08)
      const g = new THREE.PlaneGeometry(b - a, 2.65)
      g.translate((a + b) / 2, 1.35, zf + 0.12)
      glassGeos.push(g)
    }
    B.add(black, slab(-2.5, 2.5, 0, 0.008, zf - 1.2, zf + 1.0, 1)) // entrance mat
  }

  /* --- walls: doors, lit rooms behind glass, lockers, signs, a banner -------------- */
  // a door on a wall: axis 'z' (wall at z = c, facing dir) or 'x'
  const door = (axis, c, dir, a, w, h = 2.3, y0 = 0, mat = doorWood) => {
    const d = 0.05 * dir
    const P = (u, y, depth) => (axis === 'z' ? [u, y, c + depth] : [c + depth, y, u])
    const S = (u0, u1, y0, y1, d0, d1) => {
      const [x0, yy0, z0] = P(u0, y0, d0)
      const [x1, yy1, z1] = P(u1, y1, d1)
      return slab(Math.min(x0, x1), Math.max(x0, x1), yy0, yy1, Math.min(z0, z1), Math.max(z0, z1), 1)
    }
    B.add(mat, S(a - w / 2, a + w / 2, y0, y0 + h, 0, d))
    B.add(steel, S(a - w / 2 - 0.06, a - w / 2, y0, y0 + h + 0.06, 0, d * 1.3))
    B.add(steel, S(a + w / 2, a + w / 2 + 0.06, y0, y0 + h + 0.06, 0, d * 1.3))
    B.add(steel, S(a - w / 2 - 0.06, a + w / 2 + 0.06, y0 + h, y0 + h + 0.06, 0, d * 1.3))
    const [hx, hy, hz] = P(a + w / 2 - 0.1, y0 + 1.05, d * 1.8)
    const [hx2, , hz2] = P(a + w / 2 - 0.25, y0 + 1.05, d * 1.8)
    B.add(whiteMat, rod([hx, hy, hz], [hx2, hy, hz2], 0.011))
  }
  // a window into a warm room: emissive back, frame, glass in front
  const roomWindow = (axis, c, dir, a0, a1, y0, y1) => {
    const g = new THREE.PlaneGeometry(a1 - a0, y1 - y0)
    if (axis === 'z') {
      if (dir < 0) g.rotateY(Math.PI)
      g.translate((a0 + a1) / 2, (y0 + y1) / 2, c + dir * 0.004)
    } else {
      g.rotateY(dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      g.translate(c + dir * 0.004, (y0 + y1) / 2, (a0 + a1) / 2)
    }
    B.add(roomMat, g, false)
    const mull = []
    for (let a = a0 + 1.2; a < a1 - 0.3; a += 1.2) mull.push(a)
    K.glazing(iron, glassGeos, axis, c + dir * 0.05, { a0, a1, y0, y1 }, { fw: 0.06, fd: 0.06, mullions: mull })
  }
  // north wall, ground floor (under the gallery)
  door('z', HZ, -1, -12.6, 1.0)
  door('z', HZ, -1, -3.7, 0.95)
  door('z', HZ, -1, -2.75, 0.95)
  door('z', HZ, -1, 4.2, 1.0)
  roomWindow('z', HZ, -1, -10.8, -6.2, 0.9, 2.9)
  roomWindow('z', HZ, -1, 0.0, 2.6, 0.9, 2.9)
  // north wall, upper floor
  door('z', HZ, -1, -9.0, 1.0, 2.3, GY1)
  roomWindow('z', HZ, -1, -6.2, -1.2, GY1 + 0.9, GY1 + 2.9)
  roomWindow('z', HZ, -1, 3.6, 7.2, GY1 + 0.9, GY1 + 2.9)
  door('z', HZ, -1, 9.5, 1.0, 2.3, GY1)
  // west wall: the glazed "Serre A" room, a door
  roomWindow('x', -HX, 1, -6.4, -1.6, 0.9, 2.8)
  door('x', -HX, 1, -8.4, 1.0)
  // east wall: a glass door to a lit corridor
  roomWindow('x', HX, -1, -7.6, -6.4, 0.05, 2.4)
  door('x', HX, -1, 6.5, 1.0)
  // the "SERRE A" plate, a wall clock-like info screen
  {
    const c = K.canvas(256, 128)
    const g = c.getContext('2d')
    g.fillStyle = '#f2f2f0'
    g.fillRect(0, 0, 256, 128)
    g.fillStyle = '#1b1b1d'
    g.font = `700 52px ${FONT}`
    g.fillText('SERRE', 34, 62)
    g.font = `700 52px ${FONT}`
    g.fillText('A', 34, 114)
    const pl = new THREE.PlaneGeometry(0.34, 0.17)
    pl.rotateY(Math.PI / 2)
    pl.translate(-HX + 0.012, 2.25, -1.25)
    B.add(new THREE.MeshStandardMaterial({ map: K.texOf(c, true), roughness: 0.5 }), pl, false)
    // info screen on the north wall
    const sc = K.canvas(256, 144)
    const sg = sc.getContext('2d')
    const grd = sg.createLinearGradient(0, 0, 256, 144)
    grd.addColorStop(0, '#1b3d6e')
    grd.addColorStop(1, '#3a7ab8')
    sg.fillStyle = grd
    sg.fillRect(0, 0, 256, 144)
    sg.fillStyle = '#ffffff'
    sg.font = `700 22px ${FONT}`
    sg.fillText('Diploma-uitreiking', 18, 40)
    sg.font = `500 16px ${FONT}`
    sg.fillText('Zaal 1 · 19:30', 18, 66)
    sg.fillStyle = '#d3124b'
    sg.fillRect(18, 100, 70, 22)
    const st = K.texOf(sc, true)
    const sp = new THREE.PlaneGeometry(1.0, 0.56)
    sp.rotateY(Math.PI)
    sp.translate(6.4, 1.7, HZ - 0.035)
    B.add(new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 0.8, roughness: 0.15 }), sp, false)
    B.add(black, slab(5.88, 6.92, 1.4, 2.0, HZ - 0.03, HZ, 1))
  }
  // lockers
  {
    const lt = K.texOf(lockerCanvas(K, 512, 256, 8, 4), true)
    B.add(std('#2a1714', 0.6), slab(8.4, 12.8, 0, 1.95, HZ - 0.55, HZ, 1))
    const f = new THREE.PlaneGeometry(4.4, 1.85)
    f.rotateY(Math.PI)
    f.translate(10.6, 1.0, HZ - 0.553)
    B.add(new THREE.MeshStandardMaterial({ map: lt, roughness: 0.45, metalness: 0.3 }), f, false)
  }
  // the big red banner on the east wall
  {
    const bt = K.texOf(bannerCanvas(K, 512, 768), true)
    const g = new THREE.PlaneGeometry(2.4, 3.6)
    g.rotateY(-Math.PI / 2)
    g.translate(HX - 0.02, 2.4, -3.0)
    B.add(new THREE.MeshStandardMaterial({ map: bt, roughness: 0.7 }), g, false)
  }
  // the wayfinding sign on a column
  {
    const st = K.texOf(signCanvas(K, 256, 192), true)
    const g = new THREE.PlaneGeometry(0.8, 0.6)
    g.rotateY(Math.PI)
    g.translate(-6, 2.45, GZ + 0.3 - 0.24)
    B.add(new THREE.MeshStandardMaterial({ map: st, roughness: 0.5 }), g, false)
    B.add(steel, slab(-6.42, -5.58, 2.13, 2.77, GZ + 0.3 - 0.235, GZ + 0.3 - 0.215, 1))
  }

  /* --- the photographer's corner: the printed backdrop, softboxes, flowers ----------- */
  {
    const bw = BD.x1 - BD.x0
    const [W, H] = low ? [1024, 448] : [2048, 896]
    const tex = K.texOf(backdropCanvas(K, W, H, seeded(5)), true)
    const print = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, normalMap: K.fine(), normalScale: new THREE.Vector2(0.25, 0.25) })
    const g = new THREE.PlaneGeometry(bw, BD.h)
    g.rotateY(Math.PI)
    g.translate((BD.x0 + BD.x1) / 2, BD.h / 2 + 0.02, BD.z - 0.026)
    B.add(print, g)
    B.add(std('#5c5d60', 0.8), slab(BD.x0, BD.x1, 0.02, BD.h + 0.02, BD.z - 0.025, BD.z + 0.025, 1))
    const alu = std('#9fa3a6', 0.35, 1)
    for (const x of [BD.x0 + 0.05, (BD.x0 + BD.x1) / 2, BD.x1 - 0.05]) {
      B.add(alu, rod([x, 0, BD.z + 0.06], [x, BD.h + 0.03, BD.z + 0.06], 0.02))
      B.add(alu, slab(x - 0.03, x + 0.03, 0, 0.025, BD.z - 0.3, BD.z + 0.5, 1))
    }
    // softboxes on stands, angled at the backdrop
    const softFront = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 4.1, 3.9) })
    const head = new THREE.CylinderGeometry(0.6, 0.16, 0.42, 4, 1, true)
    head.rotateY(Math.PI / 4)
    head.rotateX(Math.PI / 2) // axis along z, wide end at +z
    for (const [x, z] of [
      [1.1, -1.25],
      [6.0, -1.25],
    ]) {
      const tgt = V(3.5, 1.35, BD.z)
      const yaw = Math.atan2(tgt.x - x, tgt.z - z)
      const hy = 2.0
      const pitch = Math.atan2(hy - tgt.y, Math.hypot(tgt.x - x, tgt.z - z))
      const parts = []
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        parts.push([black, rod([Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45], [0, 0.7, 0], 0.012)])
      }
      parts.push([black, rod([0, 0.5, 0], [0, hy - 0.05, 0], 0.017)])
      B.parts(parts, [x, 0, z], [0, 0, 0])
      B.add(fabricBlack, tf(head.clone(), [x, hy, z], [pitch, yaw, 0]), true)
      const face = new THREE.PlaneGeometry(0.84, 0.84)
      face.translate(0, 0, 0.215)
      B.add(softFront, tf(face, [x, hy, z], [pitch, yaw, 0]), false)
      const s = new THREE.SpotLight(0xfff1e2, 16, 18, 0.72, 0.9, 2)
      s.position.set(x, hy, z)
      s.target.position.copy(tgt)
      scene.add(s, s.target)
    }
    // a tripod with a camera, in front
    const tri = []
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4
      tri.push([black, rod([Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38], [0, 1.3, 0], 0.012)])
    }
    tri.push([black, rbox(0.14, 0.1, 0.08, 0.015, 2).translate(0, 1.4, 0)])
    tri.push([black, cyl(0.04, 0.04, 0.1, 20).rotateX(Math.PI / 2).translate(0, 1.4, 0.09)])
    B.parts(tri, [2.0, 0, -2.9], [0, 0.2, 0])
  }
  // a high table with bouquets and yearbooks
  {
    const tx = 8.6
    const tz = -0.6
    B.add(whiteMat, cyl(0.38, 0.38, 0.03, 40).translate(tx, 1.08, tz))
    B.add(black, cyl(0.035, 0.035, 1.06, 12).translate(tx, 0.54, tz))
    B.add(black, cyl(0.24, 0.26, 0.02, 32).translate(tx, 0.01, tz))
    // petals: one painted texture, tinted per flower
    const pc = K.canvas(128)
    const pg = pc.getContext('2d')
    for (let i = 0; i < 22; i++) {
      pg.save()
      pg.translate(64, 64)
      pg.rotate((i / 22) * Math.PI * 2)
      pg.fillStyle = i % 2 ? '#ffffff' : '#ececec'
      pg.beginPath()
      pg.ellipse(0, -36, 7, 26, 0, 0, Math.PI * 2)
      pg.fill()
      pg.restore()
    }
    const petalTex = K.texOf(pc, true)
    const petal = (color) => new THREE.MeshStandardMaterial({ map: petalTex, color: new THREE.Color(color), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 })
    const yellow = petal('#f2b21b')
    const pink = petal('#e9739e')
    const whiteP = petal('#f4f1ea')
    const lilac = petal('#c9a6d6')
    const brown = std('#3a2412', 0.9)
    const green = std('#4c6b2c', 0.7, 0, { side: THREE.DoubleSide })
    const kraft = std('#b8916a', 0.85, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(2, 2), side: THREE.DoubleSide })
    const heart = std('#c8b23a', 0.8)
    const lilacPaper = std('#9f86b8', 0.6, 0, { normalMap: K.fine(), normalScale: new THREE.Vector2(1.5, 1.5), side: THREE.DoubleSide })
    // a bouquet lying on its side: paper cone along +z, heads at the wide end
    const bouquet = (sun) => {
      const parts = []
      const cone = new THREE.CylinderGeometry(0.17, 0.03, 0.5, 14, 3, true)
      const cp = cone.attributes.position
      for (let i = 0; i < cp.count; i++) {
        const k = 1 + 0.12 * Math.sin(i * 1.7)
        cp.setX(i, cp.getX(i) * k)
        cp.setZ(i, cp.getZ(i) * k)
      }
      cone.computeVertexNormals()
      cone.rotateX(Math.PI / 2)
      cone.translate(0, 0, 0.25)
      parts.push([sun ? kraft : lilacPaper, cone])
      const br = seeded(sun ? 3 : 4)
      const n = sun ? 5 : 9
      for (let i = 0; i < n; i++) {
        const a = br() * Math.PI * 2
        const rr = br() * 0.1
        const p = [Math.cos(a) * rr, Math.sin(a) * rr, 0.5 + br() * 0.06]
        const r = [range(br, -0.4, 0.4), range(br, -0.4, 0.4), 0]
        const big = sun || i % 3 === 0
        const R = sun ? 0.085 : big ? 0.055 : 0.035
        const disc = new THREE.CircleGeometry(R, 16)
        parts.push([sun ? yellow : i % 3 === 0 ? pink : i % 3 === 1 ? whiteP : lilac, tf(disc, p, r)])
        parts.push([sun ? brown : heart, tf(cyl(R * 0.38, R * 0.38, 0.02, 16).rotateX(Math.PI / 2), [p[0], p[1], p[2] + 0.008], r)])
      }
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.PlaneGeometry(0.06, 0.2)
        parts.push([green, tf(leaf, [range(br, -0.12, 0.12), range(br, -0.1, 0.1), 0.48], [range(br, -1, 1), range(br, -1, 1), range(br, 0, 3)])])
      }
      return parts
    }
    B.parts(bouquet(true), [tx - 0.05, 1.125, tz - 0.1], [-0.28, 2.1, 0.25])
    B.parts(bouquet(false), [tx + 0.1, 1.125, tz + 0.05], [-0.28, -0.9, -0.3])
    // two yearbooks
    const cover = new THREE.MeshStandardMaterial({ map: K.texOf(coverCanvas(K, 256, 340, rand), true), roughness: 0.35 })
    for (const [dx, dz, ry] of [
      [-0.12, 0.18, 0.3],
      [0.05, 0.2, -0.2],
    ]) {
      const g = new THREE.PlaneGeometry(0.21, 0.28)
      g.rotateX(-Math.PI / 2)
      B.add(cover, tf(g, [tx + dx, 1.097 + dz * 0.01, tz + dz], [0, ry, 0]), false)
      B.add(whiteMat, tf(box(0.21, 0.004, 0.28), [tx + dx, 1.095 + dz * 0.01, tz + dz], [0, ry, 0]))
    }
  }

  /* --- furniture: trees in white planters, bistro tables ----------------------- */
  const trees = [
    { x: -5.0, z: -1.5 },
    { x: 9.5, z: -5.0 },
    { x: -13.0, z: 1.5 },
  ]
  for (const t of trees) {
    B.add(whiteMat, K.planarUV(rbox(1.0, 0.9, 1.0, 0.02, 1).translate(t.x, 0.45, t.z), 1))
    B.add(std('#2b2119', 1), slab(t.x - 0.46, t.x + 0.46, 0.86, 0.885, t.z - 0.46, t.z + 0.46, 1))
  }
  addForest(
    THREE,
    inside,
    trees.map((t) => ({ x: t.x, y: 0.88, z: t.z, h: 4.2 + rand() * 0.8 })),
    { species: 'birch', season: 'summer', seed: 33, quality: q }
  )
  {
    const table = []
    table.push([whiteMat, cyl(0.4, 0.4, 0.03, 40).translate(0, 0.74, 0)])
    table.push([black, cyl(0.03, 0.03, 0.72, 12).translate(0, 0.37, 0)])
    table.push([black, cyl(0.22, 0.24, 0.02, 32).translate(0, 0.01, 0)])
    const chair = []
    chair.push([black, rbox(0.42, 0.03, 0.42, 0.01, 1).translate(0, 0.46, 0)])
    chair.push([black, tf(rbox(0.42, 0.3, 0.02, 0.01, 1), [0, 0.74, -0.2], [-0.1, 0, 0])])
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) chair.push([steel, rod([sx * 0.18, 0.45, sz * 0.18], [sx * 0.2, 0, sz * 0.2], 0.01)])
    for (const [x, z] of [
      [2.5, -7.5],
      [6.5, -8.0],
      [10.5, -7.4],
      [-6.5, -7.8],
    ]) {
      B.parts(table, [x, 0, z])
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + x
        B.parts(chair, [x + Math.sin(a) * 0.65, 0, z + Math.cos(a) * 0.65], [0, a + Math.PI, 0])
      }
    }
    // gallery benches
    for (const x of [-4, 3, 10]) B.add(doorWood, slab(x - 0.9, x + 0.9, 0.4, 0.45, HZ - 1.4, HZ - 1.0, 1).translate(0, GY1, 0))
  }

  /* --- downlights: discs that bloom, their pools, their scallops ------------------- */
  {
    const discs = []
    for (let x = -14.1; x <= 14.11; x += 1.8) for (const z of [5.2, 7.0, 8.8]) discs.push([x, GY0 - 0.006, z])
    for (let x = -13.2; x <= 13.21; x += 2.4) {
      for (const z of [-8.6, -7.2, -1.2, 1.4, 5.4, 8.2]) discs.push([x, ROOF - 0.012, z])
    }
    const discMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6.5, 4.6, 2.7) })
    const dg = new THREE.CylinderGeometry(0.075, 0.075, 0.01, 20)
    const ring = new THREE.TorusGeometry(0.095, 0.012, 6, 24)
    ring.rotateX(Math.PI / 2)
    const im = new THREE.InstancedMesh(dg, discMat, discs.length)
    const rim = new THREE.InstancedMesh(ring, whiteMat, discs.length)
    const m4 = new THREE.Matrix4()
    discs.forEach(([x, y, z], i) => {
      m4.makeTranslation(x, y, z)
      im.setMatrixAt(i, m4)
      rim.setMatrixAt(i, m4)
    })
    im.instanceMatrix.needsUpdate = true
    rim.instanceMatrix.needsUpdate = true
    inside.add(im, rim)

    const scTex = scallopTexture(THREE, K)
    const warm = new THREE.Color(1.0, 0.6, 0.3)
    const scMat = new THREE.MeshBasicMaterial({ map: scTex, color: warm.clone().multiplyScalar(0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
    const scallops = []
    for (let x = -13.5; x <= 13.51; x += 1.8) scallops.push({ p: [x, GY0 - 1.45, HZ - 0.012], ry: Math.PI, w: 1.3, h: 2.9 })
    for (let x = -13.2; x <= 13.21; x += 2.4) scallops.push({ p: [x, ROOF - 1.95, HZ - 0.012], ry: Math.PI, w: 1.7, h: 3.9 })
    for (const z of [-8.6, -7.2, -1.2, 1.4]) {
      scallops.push({ p: [-HX + 0.012, ROOF - 1.95, z], ry: Math.PI / 2, w: 1.7, h: 3.9 })
      scallops.push({ p: [HX - 0.012, ROOF - 1.95, z], ry: -Math.PI / 2, w: 1.7, h: 3.9 })
    }
    for (const z of [5.2, 7.0, 8.8]) {
      scallops.push({ p: [-HX + 0.012, GY0 - 1.45, z], ry: Math.PI / 2, w: 1.3, h: 2.9 })
      scallops.push({ p: [HX - 0.012, GY0 - 1.45, z], ry: -Math.PI / 2, w: 1.3, h: 2.9 })
    }
    const sm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), scMat, scallops.length)
    const q4 = new THREE.Quaternion()
    const yA = V(0, 1, 0)
    scallops.forEach((s, i) => {
      q4.setFromAxisAngle(yA, s.ry)
      m4.compose(V(...s.p), q4, V(s.w, s.h, 1))
      sm.setMatrixAt(i, m4)
    })
    sm.instanceMatrix.needsUpdate = true
    sm.frustumCulled = false
    inside.add(sm)

    const poolTex = glowTexture(THREE, 'rgba(255,255,255,1)', 128)
    const pool = (k) => new THREE.MeshBasicMaterial({ map: poolTex, color: warm.clone().multiplyScalar(k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
    const pg = new THREE.PlaneGeometry(1, 1)
    pg.rotateX(-Math.PI / 2)
    const pools = discs.filter(([, y]) => y < GY1)
    const pm = new THREE.InstancedMesh(pg, pool(0.16), pools.length)
    pools.forEach(([x, , z], i) => {
      m4.compose(V(x, 0.004, z), q4.identity(), V(2.4, 1, 2.4))
      pm.setMatrixAt(i, m4)
    })
    pm.instanceMatrix.needsUpdate = true
    pm.frustumCulled = false
    inside.add(pm)
    // the gallery floor and the hall floor under the high downlights
    const high = discs.filter(([, y, z]) => y > GY1)
    const hm = new THREE.InstancedMesh(pg, pool(0.07), high.length)
    high.forEach(([x, , z], i) => {
      const onGallery = z > GZ
      m4.compose(V(x, onGallery ? GY1 + 0.004 : 0.004, z), q4.identity(), V(4, 1, 4))
      hm.setMatrixAt(i, m4)
    })
    hm.instanceMatrix.needsUpdate = true
    hm.frustumCulled = false
    inside.add(hm)
  }

  /* --- real lights (few, low) -------------------------------------------------------- */
  {
    const warm = 0xffb46e
    const under = low ? [-9, 3, 12] : [-12, -6, 0, 6, 12]
    for (const x of under) {
      const p = new THREE.PointLight(warm, 9, 10, 2)
      p.position.set(x, GY0 - 0.3, 7.0)
      scene.add(p)
    }
    for (const [x, y, z, i] of low
      ? [[0, 7.6, -4, 40]]
      : [
          [-6, 7.6, -3.5, 30],
          [6, 7.6, -4.5, 30],
          [-8, 7.8, 7.2, 12],
          [8, 7.8, 7.2, 12],
        ]) {
      const p = new THREE.PointLight(warm, i, 22, 2)
      p.position.set(x, y, z)
      scene.add(p)
    }
  }

  /* --- outside: a dark plaza, street lamps, lit buildings -------------------------- */
  {
    const plaza = M.paving(THREE, { kind: 'flags', color: '#77736d', joint: '#4a4743', unit: 0.6, tile: 4, wet: 0.3, quality: q, seed: 63 })
    O.add(plaza, slab(-80, 80, -0.4, -0.02, -70, -HZ - T, 4))
    O.add(plaza, slab(-80, -HX - T, -0.4, -0.02, -HZ - T, 40, 4))
    O.add(plaza, slab(HX + T, 80, -0.4, -0.02, -HZ - T, 40, 4))
    const lamps = []
    for (const x of [-24, -12, 12, 24]) lamps.push({ x, z: -20 })
    for (const x of [-30, 0, 30]) lamps.push({ x, z: -40 })
    addLamps(THREE, outside, lamps, { color: 0xffc98a, height: 5 })
    addForest(
      THREE,
      outside,
      [-30, -18, -6, 6, 18, 30].map((x) => ({ x, z: -28 + rand() * 2, h: 9 + rand() * 2 })),
      { species: 'lime', season: 'summer', seed: 34, quality: q }
    )
    const fac = M.facade(THREE, { wall: 'curtain', color: '#3a4048', frame: '#2a2e33', glass: '#121820', bay: 3.0, storey: 3.6, night: 0.45, quality: q, seed: 64 })
    const fac2 = M.facade(THREE, { wall: 'brick', color: '#6e3a28', frame: '#d9d2c4', bay: 3.2, storey: 3.4, night: 0.4, quality: q, seed: 65 })
    O.add(fac.material, M.box(THREE, 60, 18, 14, fac.material, fac.tile).geometry.translate(-10, 0, -80))
    O.add(fac2.material, M.box(THREE, 34, 13, 12, fac2.material, fac2.tile).geometry.translate(48, 0, -66))
    O.add(fac2.material, M.box(THREE, 30, 12, 12, fac2.material, fac2.tile).geometry.translate(-58, 0, -62))
    // the building itself, seen from the plaza: brick above the glass box
    O.add(brick, slab(-HX - T, HX + T, ROOF + 0.4, ROOF + 1.2, -HZ - T, -HZ, 2))
  }

  /* --- assemble ---------------------------------------------------------------------- */
  inside.add(iron.build(steel))
  {
    const g = K.batcher()
    for (const gg of glassGeos) g.add(glass, gg, false)
    g.build(inside)
  }
  B.build(inside)
  O.build(outside)
  world.focusShadows(V(0, 3, 0), 26)

  /* --- the hall's own light probe ------------------------------------------------------ */
  {
    const warm = [1.0, 0.68, 0.42]
    const room = { x0: -HX, x1: HX, y0: 0, y1: ROOF, z0: -HZ, z1: HZ }
    const P0 = V(0, 2.4, -2)
    const Q = V(0, 0, 0)
    const env = K.probe(low ? 128 : 256, low ? 64 : 128, (d) => {
      // the red backdrop, if the ray meets it first
      if (d.z > 1e-4) {
        const t = (BD.z - P0.z) / d.z
        const x = P0.x + d.x * t
        const y = P0.y + d.y * t
        if (x > BD.x0 && x < BD.x1 && y > 0 && y < BD.h) return [0.42, 0.03, 0.07]
      }
      // the gallery soffit and fascia
      if (d.z > 1e-4) {
        const t = (GZ - P0.z) / d.z
        const y = P0.y + d.y * t
        if (y > GY0 && y < GY1 + 1.05) return y < GY1 ? [0.16, 0.15, 0.14] : [0.03, 0.025, 0.02]
      }
      if (d.y > 1e-4) {
        const t = (GY0 - P0.y) / d.y
        const z = P0.z + d.z * t
        if (z > GZ && z < HZ) return [0.22 * warm[0], 0.22 * warm[1], 0.22 * warm[2]]
      }
      const { t, face } = K.roomHit(P0, d, room)
      Q.copy(P0).addScaledVector(d, t)
      if (face === 'z-') {
        // the glass facade: night, a few lamps
        const lamp = Q.y < 4 && Math.abs(Math.sin(Q.x * 0.5)) > 0.97 ? 1.2 : 0
        return [0.012 + lamp * 1.0, 0.016 + lamp * 0.7, 0.03 + lamp * 0.4]
      }
      if (face === 'y-') return [0.02, 0.018, 0.016]
      if (face === 'y+') {
        const dot = Math.abs(Math.sin(Q.x * 1.3)) > 0.985 && Math.abs(Math.sin(Q.z * 1.3)) > 0.9 ? 6 : 0
        if (Q.z > SKY.z0 && Q.z < SKY.z1) return [0.01, 0.014, 0.03]
        return [0.02 + dot * warm[0], 0.02 + dot * warm[1], 0.02 + dot * warm[2]]
      }
      // white brick walls in warm scallops
      const band = Q.y < GY0 ? 0.22 : Q.y > GY1 ? 0.14 * Math.exp(-Math.pow((Q.y - (ROOF - 1.4)) / 2.2, 2)) + 0.03 : 0.05
      return [band * warm[0], band * warm[1], band * warm[2]]
    })
    K.applyEnv(inside, env)
  }

  /* --- viewpoints ---------------------------------------------------------------------- */
  const spots = [
    { pos: V(-2.5, 1.5, -4.5), look: V(1.0, 2.5, 8.0) }, // owen-06: columns, the gallery and its balustrade, warm downlights
    { pos: V(3.5, 1.5, -2.6), look: V(3.5, 1.45, 2.5) }, // owen-01..04: the printed GRADUATED / GESLAAGD backdrop
    { pos: V(10.5, 1.6, 6.6), look: V(-5, 1.5, 8.2) }, // under the gallery: lockers, doors, scallops on white brick
    { pos: V(6.0, 1.6, -3.5), look: V(2.0, 2.5, -16) }, // out through the glass facade to the night plaza
    { pos: V(-9.3, 1.6, -6.2), look: V(-9.3, 4.6, 6) }, // owen-05: at the foot of the wide stair
    { pos: V(-9.3, 4.45, 1.5), look: V(4, 1.0, -0.5) }, // halfway up the stair, over the hall
    { pos: V(-4, 6.1, 5.6), look: V(3.5, 0.6, -1) }, // on the gallery, looking down at the backdrop
  ]
  return {
    scene,
    world,
    path: {
      positions: [V(-6, 14, -48), V(-2, 4.5, -24), V(-0.4, 1.8, -13), V(-1.2, 1.6, -8.0), spots[0].pos.clone()],
      targets: [V(0, 3, 0), V(0, 3, 0), V(-0.5, 2.4, 0), V(0, 2.4, 4), spots[0].look.clone()],
      fov: 52,
      near: 0.1,
      spots,
    },
    update() {},
  }
}
