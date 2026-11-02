/**
 * The memory wall: every project as an instant print, pegged to strings of
 * twine with little lights, swaying in a warm, dark room. Hover lifts a print
 * toward you; choosing one flies the view into it.
 *
 * Shown without the film curve (post.js `flat`), so the photos keep their
 * true colours.
 */
import { buildPrint, disposePrint } from './prints.js'
import { glowTexture, seeded, range } from './utils.js'
import { NO_INK_LAYER } from './post.js'

const PRINT_W = 1 // a Mini print's width; Wide prints are 1.45×

export async function buildWall(THREE, renderer, items, { quality = 'high' } = {}) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x120e0c)
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
  const rand = seeded(2024)

  // soft room light for the pegs and twine
  scene.add(new THREE.HemisphereLight(0xffe6c8, 0x2a1d16, 1.1))
  const key = new THREE.DirectionalLight(0xffd9ad, 1.4)
  key.position.set(-3, 5, 6)
  scene.add(key)

  // out-of-focus lights far behind: the bokeh of a cosy room
  const glow = glowTexture(THREE, 'rgba(255,200,140,1)')
  const bokeh = []
  for (let i = 0; i < 46; i++) {
    const m = new THREE.SpriteMaterial({
      map: glow,
      color: new THREE.Color().setHSL(range(rand, 0.06, 0.11), 0.8, range(rand, 0.45, 0.65)),
      transparent: true,
      opacity: range(rand, 0.08, 0.3),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const s = new THREE.Sprite(m)
    const z = range(rand, -16, -5)
    s.position.set(range(rand, -16, 16), range(rand, -8, 8), z)
    s.scale.setScalar(range(rand, 0.8, 3.2) * (1 - z / 30))
    s.layers.set(NO_INK_LAYER)
    s.userData = { base: s.position.clone(), phase: rand() * 6 }
    scene.add(s)
    bokeh.push(s)
  }

  // the prints, loaded in parallel
  const prints = await Promise.all(
    items.map(async (item, index) => {
      const mesh = await buildPrint(THREE, renderer, item.hero, { title: item.title || item.caption, width: PRINT_W, maxPx: quality === 'low' ? 700 : 1000 })
      mesh.userData.index = index
      const group = new THREE.Group() // pivots at the peg
      group.add(mesh)
      const peg = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.26, 0.06).translate(0, -0.06, 0.035),
        new THREE.MeshStandardMaterial({ color: 0xb48a5a, roughness: 0.8 })
      )
      group.add(peg)
      scene.add(group)
      return { group, mesh, index, phase: rand() * 6, lift: 0, home: new THREE.Vector3() }
    })
  )

  /* --- layout: rows of twine, sized to the screen ------------------------ */

  const strings = []
  const twineMat = new THREE.MeshStandardMaterial({ color: 0x8c7356, roughness: 1 })
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc777).multiplyScalar(5) })
  let bounds = { top: 0, bottom: 0, half: 1 }
  const pan = new THREE.Vector2()
  const panTarget = new THREE.Vector2()
  let fov = 40

  function clearStrings() {
    for (const s of strings) {
      scene.remove(s)
      s.traverse((o) => o.geometry?.dispose())
    }
    strings.length = 0
  }

  function layout(aspect) {
    clearStrings()
    const cols = aspect < 0.8 ? 2 : aspect < 1.3 ? 4 : 6
    const slot = 1.75
    const rowGap = 2.75
    const rows = []
    // fill rows left to right; a Wide print takes a little more room
    let row = []
    let used = 0
    for (const p of prints) {
      const need = p.mesh.userData.landscape ? 1.45 : 1
      if (row.length && used + need > cols + 0.2) {
        rows.push(row)
        row = []
        used = 0
      }
      row.push(p)
      used += need
    }
    if (row.length) rows.push(row)

    const widest = Math.max(...rows.map((r) => r.reduce((a, p) => a + (p.mesh.userData.landscape ? 1.45 : 1), 0)))
    const half = (widest * slot) / 2 + 0.6
    rows.forEach((r, ri) => {
      const y = -ri * rowGap
      const sag = 0.28
      const total = r.reduce((a, p) => a + (p.mesh.userData.landscape ? 1.45 : 1), 0) * slot
      let x = -total / 2
      const yAt = (px) => y - sag * (1 - Math.pow(px / half, 2))
      r.forEach((p) => {
        const wslot = (p.mesh.userData.landscape ? 1.45 : 1) * slot
        const px = x + wslot / 2
        p.home.set(px + range(rand, -0.06, 0.06), yAt(px), range(rand, -0.08, 0.08))
        p.group.position.copy(p.home)
        x += wslot
      })
      // the twine, drooping between its ends, with lights along it
      const pts = []
      for (let i = 0; i <= 40; i++) {
        const px = -half - 0.6 + ((half + 0.6) * 2 * i) / 40
        pts.push(new THREE.Vector3(px, yAt(Math.min(Math.abs(px), half)) + 0.02, -0.02))
      }
      const curve = new THREE.CatmullRomCurve3(pts)
      const g = new THREE.Group()
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.012, 5), twineMat))
      for (let i = 0; i < 26; i++) {
        const p = curve.getPointAt((i + 0.5) / 26)
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), bulbMat)
        b.position.set(p.x, p.y - 0.05, p.z + 0.02)
        b.layers.set(NO_INK_LAYER)
        g.add(b)
      }
      scene.add(g)
      strings.push(g)
    })
    bounds = { top: 0.4, bottom: -(rows.length - 1) * rowGap - 2.2, half }
    fov = aspect < 0.8 ? 52 : 40
    camera.fov = fov
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    pan.set(0, 0)
    panTarget.set(0, 0)
  }

  /** How far back to stand so the wall's width (and a sensible height) fits. */
  function distance() {
    const t = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const byWidth = (bounds.half + 0.3) / (t * camera.aspect)
    const height = bounds.top - bounds.bottom
    const byHeight = (Math.min(height, 7.2) / 2 + 0.4) / t
    return Math.max(byWidth, byHeight)
  }

  /** Where the camera rests for the whole wall: centred on the visible part. */
  function restPose(out) {
    const d = distance()
    const t = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const visH = d * t * 2
    const height = bounds.top - bounds.bottom
    const midY = (bounds.top + bounds.bottom) / 2
    let y = midY
    let range = 0
    if (height > visH) {
      // taller than the screen: start at the top, pan down
      range = (height - visH) / 2
      y = midY + range
    }
    out.pos.set(pan.x, y - pan.y * 1, d)
    out.look.set(pan.x, y - pan.y * 1, 0)
    out.panRange = range * 2
    return out
  }

  /** The camera pose that fills the screen with print i. */
  function printPose(i, out) {
    const p = prints[i]
    const { w, h } = p.mesh.userData
    const t = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const d = Math.max((h * 0.5) / 0.78 / t, (w * 0.5) / 0.78 / (t * camera.aspect))
    const c = p.group.position.clone().add(new THREE.Vector3(0, -h / 2, 0))
    out.pos.set(c.x, c.y, c.z + d)
    out.look.copy(c)
    return out
  }

  /* --- interaction -------------------------------------------------------- */

  const ray = new THREE.Raycaster()
  const meshes = prints.map((p) => p.mesh)
  let hovered = -1

  function pick(ndc) {
    ray.setFromCamera(ndc, camera)
    const hit = ray.intersectObjects(meshes, false)[0]
    return hit ? hit.object.userData.index : -1
  }

  function update(time, pointer) {
    for (const p of prints) {
      const target = p.index === hovered ? 1 : 0
      p.lift += (target - p.lift) * 0.12
      const s = Math.sin(time * 0.7 + p.phase)
      p.group.rotation.z = s * 0.045 * (1 - p.lift * 0.6)
      p.group.rotation.y = Math.sin(time * 0.5 + p.phase * 1.3) * 0.12 * (1 - p.lift) + pointer.x * 0.08
      p.group.rotation.x = -0.04 + pointer.y * 0.04
      p.group.position.z = p.home.z + p.lift * 0.35
      p.group.scale.setScalar(1 + p.lift * 0.06)
      const u = p.mesh.material.uniforms
      u.uTime.value = time
      u.uWind.value = 0.7 + p.lift * 0.8
      u.uLift.value = p.lift
    }
    for (const b of bokeh) {
      b.position.x = b.userData.base.x + Math.sin(time * 0.07 + b.userData.phase) * 0.6
      b.position.y = b.userData.base.y + Math.cos(time * 0.05 + b.userData.phase) * 0.4
    }
    pan.lerp(panTarget, 0.1)
  }

  return {
    scene,
    camera,
    prints,
    layout,
    restPose,
    printPose,
    update,
    pick,
    hover(i) {
      hovered = i
    },
    /** Drag the wall (phones, when it's taller than the screen). */
    panBy(dx, dy, range) {
      panTarget.y = Math.max(0, Math.min(range, panTarget.y + dy))
      panTarget.x = Math.max(-0.5, Math.min(0.5, panTarget.x + dx * 0.2))
    },
    dispose() {
      clearStrings()
      for (const p of prints) disposePrint(p.mesh)
      glow.dispose()
    },
  }
}
