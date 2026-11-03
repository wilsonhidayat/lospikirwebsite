/**
 * Realistic trees, cheap to draw.
 *
 * Each species is grown once as a branching skeleton (tapered limbs, merged
 * into one geometry) with clusters of leaf cards at the twig ends — quads
 * carrying a painted, alpha-cut texture of many small leaves. A few variants
 * per species are grown, then every tree in a scene is an instance of one of
 * them (scaled, turned, tinted): two draw calls per variant however many
 * trees there are. Leaves cast proper dappled shadows.
 *
 *   addForest(THREE, scene, spots, { species: 'lime' })
 *   spots: [{ x, z, y?, h? }]   h = height in metres
 *
 * species: 'lime' (linden — Dutch canals), 'plane' (London plane — Paris,
 *          squares), 'birch', 'oak', 'poplar' (tall, narrow), 'olive'
 *          (indoor / Mediterranean), 'bare' (winter, no leaves)
 * season:  'summer' | 'autumn' | 'winter' (winter = bare)
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { seeded, range } from './utils.js'

const SPECIES = {
  lime: { trunk: 0.38, crown: 0.62, spread: 0.62, upward: 0.55, leaf: ['#4d6b2c', '#5f7d34', '#3f5a24'], bark: '#4a4038', clusters: 70, card: 1.6 },
  plane: { trunk: 0.42, crown: 0.58, spread: 0.7, upward: 0.45, leaf: ['#56702f', '#6a8438', '#465f27'], bark: '#8c8270', clusters: 80, card: 1.8 },
  birch: { trunk: 0.3, crown: 0.7, spread: 0.4, upward: 0.7, leaf: ['#7a9440', '#6c8838', '#8aa24a'], bark: '#d8d4cc', clusters: 50, card: 1.2 },
  oak: { trunk: 0.32, crown: 0.68, spread: 0.85, upward: 0.35, leaf: ['#41592a', '#4f6a30', '#364d22'], bark: '#3e352d', clusters: 90, card: 1.9 },
  poplar: { trunk: 0.2, crown: 0.8, spread: 0.22, upward: 0.9, leaf: ['#5b7a32', '#6e8c3c', '#4b6629'], bark: '#6f6a5f', clusters: 60, card: 1.3 },
  olive: { trunk: 0.35, crown: 0.65, spread: 0.6, upward: 0.4, leaf: ['#7d8a62', '#6c7a54', '#8e9a72'], bark: '#6d6152', clusters: 40, card: 0.9 },
}

/* --- textures ------------------------------------------------------------ */

const leafCache = new Map()
function leafTexture(THREE, colors, autumn, seed) {
  const key = colors.join() + autumn
  if (leafCache.has(key)) return leafCache.get(key)
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  const rand = seeded(seed)
  g.clearRect(0, 0, S, S)
  const autumnCols = ['#b06a2a', '#c58a35', '#8e4b23', '#a87a2c']
  // a dense middle thinning to the edges, like a real cluster of twigs
  for (let i = 0; i < 420; i++) {
    const a = rand() * Math.PI * 2
    const r = Math.pow(rand(), 0.7) * S * 0.46
    const x = S / 2 + Math.cos(a) * r
    const y = S / 2 + Math.sin(a) * r
    const size = range(rand, 7, 14)
    const col = autumn && rand() < 0.6 ? autumnCols[Math.floor(rand() * autumnCols.length)] : colors[Math.floor(rand() * colors.length)]
    g.save()
    g.translate(x, y)
    g.rotate(rand() * Math.PI * 2)
    const light = 0.75 + rand() * 0.45
    g.fillStyle = col
    g.globalAlpha = 1
    g.filter = `brightness(${light})`
    g.beginPath()
    g.ellipse(0, 0, size * 0.42, size, 0, 0, Math.PI * 2)
    g.fill()
    g.filter = 'none'
    g.strokeStyle = 'rgba(30,40,15,0.35)'
    g.lineWidth = 0.8
    g.beginPath()
    g.moveTo(0, -size)
    g.lineTo(0, size)
    g.stroke()
    g.restore()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  leafCache.set(key, t)
  return t
}

function barkTexture(THREE, color, seed) {
  const W = 128
  const H = 256
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  g.fillStyle = color
  g.fillRect(0, 0, W, H)
  const rand = seeded(seed)
  for (let i = 0; i < 140; i++) {
    g.strokeStyle = `rgba(0,0,0,${range(rand, 0.08, 0.3)})`
    g.lineWidth = range(rand, 1, 3)
    const x = rand() * W
    g.beginPath()
    g.moveTo(x, rand() * H)
    g.lineTo(x + range(rand, -4, 4), rand() * H)
    g.stroke()
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(255,255,240,${range(rand, 0.04, 0.14)})`
    g.fillRect(rand() * W, rand() * H, range(rand, 3, 12), range(rand, 2, 8))
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/* --- growing a tree -------------------------------------------------------- */

/** Grow one tree of unit height: { wood: BufferGeometry, leaves: BufferGeometry|null }. */
function grow(THREE, sp, seed, bare) {
  const rand = seeded(seed)
  const woods = []
  const cards = []
  const up = new THREE.Vector3(0, 1, 0)
  const q = new THREE.Quaternion()
  const tips = []

  function limb(start, dir, len, r0, depth) {
    const end = start.clone().addScaledVector(dir, len)
    const r1 = r0 * 0.62
    const geo = new THREE.CylinderGeometry(r1, r0, len, depth > 1 ? 6 : 4, 1, true)
    geo.translate(0, len / 2, 0)
    q.setFromUnitVectors(up, dir)
    geo.applyQuaternion(q)
    geo.translate(start.x, start.y, start.z)
    // bark UVs: wrap around, run along the limb
    woods.push(geo)
    if (depth >= 4 || r1 < 0.004) {
      tips.push(end)
      return
    }
    const kids = depth === 0 ? 4 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2)
    for (let k = 0; k < kids; k++) {
      const a = (k / kids) * Math.PI * 2 + rand() * 1.2
      const tilt = depth === 0 ? sp.spread * range(rand, 0.6, 1.1) : range(rand, 0.3, 0.9)
      const nd = new THREE.Vector3(Math.cos(a) * tilt, sp.upward + range(rand, -0.1, 0.25), Math.sin(a) * tilt).normalize()
      nd.lerp(dir, depth === 0 ? 0.15 : 0.35).normalize()
      const at = depth === 0 ? start.clone().lerp(end, range(rand, 0.75, 1)) : end
      limb(at, nd, len * range(rand, 0.55, 0.78), r1, depth + 1)
    }
    // the leader carries on upward
    if (depth < 2) limb(end, dir.clone().lerp(up, 0.5).normalize(), len * 0.6, r1 * 0.9, depth + 1)
  }

  const trunkLen = sp.trunk
  limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(range(rand, -0.04, 0.04), 1, range(rand, -0.04, 0.04)).normalize(), trunkLen, 0.035, 0)

  if (!bare) {
    // leaf cards: crossed pairs of quads at twig tips, filling out the crown
    const n = Math.min(tips.length, sp.clusters)
    const chosen = tips.sort(() => rand() - 0.5).slice(0, n)
    for (const p of chosen) {
      const s = sp.card * range(rand, 0.18, 0.28)
      for (let k = 0; k < 2; k++) {
        const plane = new THREE.PlaneGeometry(s, s)
        plane.rotateY(rand() * Math.PI)
        plane.rotateX(range(rand, -0.6, 0.6))
        plane.rotateZ(range(rand, -0.6, 0.6))
        plane.translate(p.x + range(rand, -0.03, 0.03), p.y + range(rand, -0.02, 0.04), p.z + range(rand, -0.03, 0.03))
        // normals point out from the crown's centre: soft, rounded shading
        const pos = plane.attributes.position
        const nor = plane.attributes.normal
        for (let i = 0; i < pos.count; i++) {
          const v = new THREE.Vector3(pos.getX(i), pos.getY(i) - sp.trunk - sp.crown * 0.4, pos.getZ(i)).normalize()
          nor.setXYZ(i, v.x, v.y * 0.7 + 0.3, v.z)
        }
        cards.push(plane)
      }
    }
  }
  const wood = mergeGeometries(woods.map((g) => g.toNonIndexed()), false)
  wood.computeVertexNormals()
  const leaves = cards.length ? mergeGeometries(cards, false) : null
  return { wood, leaves }
}

/* --- planting ----------------------------------------------------------- */

const VARIANTS = 3

/**
 * Plant trees. Returns { meshes } (already added to the scene).
 * spots: [{ x, z, y?, h? }]; species and season as above.
 */
export function addForest(THREE, scene, spots, { species = 'lime', season = 'summer', seed = 1, quality = 'high' } = {}) {
  if (!spots.length) return { meshes: [] }
  const sp = SPECIES[species] || SPECIES.lime
  const bare = season === 'winter'
  const rand = seeded(seed * 31 + 7)
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture(THREE, sp.bark, seed), roughness: 0.95 })
  const leafTex = bare ? null : leafTexture(THREE, sp.leaf, season === 'autumn', seed)
  const leafMat = bare
    ? null
    : new THREE.MeshStandardMaterial({
        map: leafTex,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.75,
        // a little light comes through the leaves
        emissive: new THREE.Color(sp.leaf[0]).multiplyScalar(0.06),
      })
  const leafDepth = bare
    ? null
    : new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.45 })

  const variants = []
  const nVar = quality === 'low' ? 2 : VARIANTS
  for (let v = 0; v < nVar; v++) variants.push(grow(THREE, sp, seed * 101 + v * 13, bare))

  const groups = variants.map(() => [])
  spots.forEach((s, i) => groups[i % nVar].push(s))
  const meshes = []
  const m = new THREE.Matrix4()
  const qq = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)
  variants.forEach((v, vi) => {
    const list = groups[vi]
    if (!list.length) return
    const wood = new THREE.InstancedMesh(v.wood, bark, list.length)
    const leaves = v.leaves ? new THREE.InstancedMesh(v.leaves, leafMat, list.length) : null
    list.forEach((s, j) => {
      const h = s.h || range(rand, 10, 16)
      const w = h * range(rand, 0.9, 1.1)
      qq.setFromAxisAngle(yAxis, rand() * Math.PI * 2)
      m.compose(new THREE.Vector3(s.x, s.y || 0, s.z), qq, new THREE.Vector3(w, h, w))
      wood.setMatrixAt(j, m)
      if (leaves) {
        leaves.setMatrixAt(j, m)
        const c = new THREE.Color().setHSL(0, 0, range(rand, 0.85, 1.1))
        leaves.setColorAt(j, c)
      }
    })
    wood.castShadow = wood.receiveShadow = true
    scene.add(wood)
    meshes.push(wood)
    if (leaves) {
      leaves.castShadow = leaves.receiveShadow = true
      leaves.customDepthMaterial = leafDepth
      if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true
      scene.add(leaves)
      meshes.push(leaves)
    }
  })
  return { meshes }
}
