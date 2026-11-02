/**
 * A full-frame mirrorless body with a 24-70mm f/2.8 zoom, modelled after
 * the A7 III + Sigma 24-70 DG DN Art that Wilson actually shoots with.
 *
 * Built entirely from primitives — no model file to license — and with no
 * manufacturer logos or wordmarks (those are trademarks). The only marking is
 * a small LOSPIKIR engraving on the top plate.
 *
 * Units: 1 = 100 mm. The camera faces +Z (lens toward the viewer).
 * Returns { group, screen } — `screen` is the rear display's picture area in
 * the group's space, where the journey lays the photo over the render.
 */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { paintTexture, noiseNormalMap } from './utils.js'
import { NO_INK_LAYER } from './post.js'

export function buildCameraModel(THREE) {
  const group = new THREE.Group()
  group.name = 'camera'

  /* --- materials ------------------------------------------------------ */

  const leatheretteNormal = noiseNormalMap(THREE, 256, { cells: 48, strength: 3.5, octaves: 2 })
  leatheretteNormal.repeat.set(3, 3)

  const body = new THREE.MeshPhysicalMaterial({
    color: 0x2a2b30,
    roughness: 0.58,
    metalness: 0.15,
    clearcoat: 0.25,
    clearcoatRoughness: 0.6,
  })
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x1f2024,
    roughness: 0.92,
    metalness: 0,
    normalMap: leatheretteNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
  })
  const metalDark = new THREE.MeshStandardMaterial({ color: 0x3b3c42, roughness: 0.35, metalness: 0.9 })
  const metalBright = new THREE.MeshStandardMaterial({ color: 0xb9bbbf, roughness: 0.22, metalness: 1 })
  const satin = new THREE.MeshStandardMaterial({ color: 0x2c2d32, roughness: 0.42, metalness: 0.55 })

  // Ribbed rubber for the zoom and focus rings
  const ribs = paintTexture(
    THREE,
    512,
    32,
    (g, w, h) => {
      g.fillStyle = '#808080'
      g.fillRect(0, 0, w, h)
      for (let x = 0; x < w; x += 8) {
        g.fillStyle = '#ffffff'
        g.fillRect(x, 0, 4, h)
        g.fillStyle = '#202020'
        g.fillRect(x + 4, 0, 2, h)
      }
    },
    { kind: 'data', repeat: [12, 1] }
  )
  const ribbed = new THREE.MeshStandardMaterial({
    color: 0x222327,
    roughness: 0.85,
    metalness: 0.05,
    bumpMap: ribs,
    bumpScale: 1.4,
  })

  /* --- body ----------------------------------------------------------- */

  const W = 1.27 // 127 mm wide
  const H = 0.74 // main block height (below the viewfinder hump)
  const D = 0.42 // depth without the grip

  const main = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 5, 0.07), body)
  main.position.set(0, 0, 0)
  group.add(main)

  // Front leatherette panel (slightly proud of the body)
  const panel = new THREE.Mesh(new RoundedBoxGeometry(W * 0.9, H * 0.78, 0.04, 3, 0.018), rubber)
  panel.position.set(0.04, -0.02, D / 2 + 0.006)
  group.add(panel)

  // Grip — on the photographer's right, which is the viewer's left
  const grip = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.76, 0.66, 6, 0.14), rubber)
  grip.position.set(-0.47, -0.01, 0.11)
  group.add(grip)

  // Viewfinder hump: a trapezoid extruded front-to-back, bevelled
  const hump = new THREE.Shape()
  hump.moveTo(-0.29, 0)
  hump.lineTo(0.29, 0)
  hump.lineTo(0.17, 0.27)
  hump.lineTo(-0.17, 0.27)
  hump.closePath()
  const humpGeo = new THREE.ExtrudeGeometry(hump, {
    depth: 0.34,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 4,
    curveSegments: 8,
  })
  humpGeo.translate(0, 0, -0.17)
  const humpMesh = new THREE.Mesh(humpGeo, body)
  humpMesh.position.set(0.04, H / 2 - 0.03, -0.03)
  group.add(humpMesh)

  // Top plate controls
  const dial = (r, h, x, z, material = satin) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), material)
    m.position.set(x, H / 2 + h / 2, z)
    group.add(m)
    // knurled rim
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 64), metalDark)
    rim.rotation.x = Math.PI / 2
    rim.position.set(x, H / 2 + h * 0.8, z)
    group.add(rim)
    return m
  }
  // clear of the viewfinder hump (its bevel reaches x ≈ ±0.27)
  dial(0.115, 0.08, 0.48, -0.04) // mode dial (viewer's right)
  dial(0.11, 0.07, -0.45, -0.08) // exposure compensation, by the grip

  // Shutter button on the grip, with its collar
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.035, 40), metalDark)
  collar.position.set(-0.49, H / 2 + 0.0175, 0.24) // sits on the grip top
  collar.rotation.x = 0.18
  group.add(collar)
  const shutter = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 40), metalBright)
  shutter.position.set(-0.49, H / 2 + 0.045, 0.245)
  shutter.rotation.x = 0.18
  group.add(shutter)
  // Front command dial, peeking out of the grip
  const frontDial = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 40), ribbed)
  frontDial.rotation.z = Math.PI / 2
  frontDial.position.set(-0.47, H / 2 - 0.05, 0.43)
  group.add(frontDial)

  // Hot shoe
  const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.18), metalDark)
  shoe.position.set(0.04, H / 2 + 0.29, -0.03)
  group.add(shoe)

  // Strap lugs
  for (const x of [-W / 2 - 0.02, W / 2 + 0.02]) {
    const lug = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 8, 24), metalBright)
    lug.position.set(x, H / 2 - 0.12, 0.02)
    lug.rotation.y = Math.PI / 2
    group.add(lug)
  }

  // Lens release button and the small AF-assist window by the grip
  const release = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 32), satin)
  release.rotation.x = Math.PI / 2
  release.position.set(0.42, -0.12, D / 2 + 0.03)
  group.add(release)
  const lamp = new THREE.Mesh(
    new THREE.CircleGeometry(0.022, 24),
    new THREE.MeshStandardMaterial({ color: 0x3a1410, roughness: 0.2, metalness: 0.2, emissive: 0x140504 })
  )
  lamp.position.set(-0.29, 0.25, D / 2 + 0.03)
  group.add(lamp)

  // LOSPIKIR engraving on the hump front
  const engraving = paintTexture(
    THREE,
    512,
    96,
    (g, w, h) => {
      g.clearRect(0, 0, w, h)
      g.fillStyle = 'rgba(240,238,232,0.92)'
      g.font = '700 58px "Helvetica Neue", Helvetica, Arial, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('LOSPIKIR', w / 2, h / 2 - 6)
      g.fillRect(w / 2 - 128, h - 20, 256, 6)
    },
    { kind: 'color' }
  )
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.049),
    new THREE.MeshStandardMaterial({
      map: engraving,
      transparent: true,
      roughness: 0.6,
      metalness: 0,
      depthWrite: false,
    })
  )
  // The hump's front face is sloped; sit the label on it
  // flat on the hump's front face
  label.position.set(0.04, H / 2 + 0.11, 0.172)
  label.layers.set(NO_INK_LAYER)
  group.add(label)

  /* --- the back: rear screen, viewfinder eyecup, controls ------------- */

  // The intro turns the camera around, so the back is modelled too.
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.1, metalness: 0.1 })
  const lcd = new THREE.Mesh(new RoundedBoxGeometry(0.74, 0.5, 0.04, 3, 0.018), screenMat)
  lcd.position.set(0.14, -0.06, -D / 2 - 0.012)
  group.add(lcd)
  const lcdFrame = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.56, 0.03, 3, 0.014), satin)
  lcdFrame.position.set(0.14, -0.06, -D / 2 - 0.004)
  group.add(lcdFrame)
  const eyecup = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.26, 0.14, 4, 0.06), rubber)
  eyecup.position.set(0.04, H / 2 + 0.12, -D / 2 - 0.08)
  group.add(eyecup)
  const eyepiece = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.13, 0.02, 3, 0.008), screenMat)
  eyepiece.position.set(0.04, H / 2 + 0.12, -D / 2 - 0.152)
  group.add(eyepiece)
  // control wheel and a column of small buttons, on the grip side
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 10, 48), metalDark)
  wheel.position.set(-0.4, -0.16, -D / 2 - 0.012)
  group.add(wheel)
  const wheelBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 24), satin)
  wheelBtn.rotation.x = Math.PI / 2
  wheelBtn.position.set(-0.4, -0.16, -D / 2 - 0.012)
  group.add(wheelBtn)
  for (const [x, y] of [
    [-0.4, 0.12],
    [-0.52, 0.02],
    [-0.4, -0.34],
    [-0.52, -0.3],
  ]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20), satin)
    b.rotation.x = Math.PI / 2
    b.position.set(x, y, -D / 2 - 0.012)
    group.add(b)
  }
  // thumb rest
  const thumb = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.26, 0.05, 3, 0.02), rubber)
  thumb.position.set(-0.48, 0.2, -D / 2 - 0.02)
  group.add(thumb)

  /* --- lens mount + lens --------------------------------------------- */

  const axisX = 0.07
  const axisY = -0.04
  const mountZ = D / 2 + 0.02

  const mountRing = new THREE.Mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.04, 96, 1, true), metalBright)
  mountRing.rotation.x = Math.PI / 2
  mountRing.position.set(axisX, axisY, mountZ)
  group.add(mountRing)

  // The barrel is a lathe: (radius, distance from mount) profile, revolved
  const P = (r, z) => new THREE.Vector2(r, z)
  const L = 1.23 // 123 mm long
  const shell = [
    P(0.305, 0),
    P(0.33, 0.02),
    P(0.36, 0.05),
    P(0.38, 0.12),
    P(0.385, 0.3),
    P(0.4, 0.33),
    P(0.41, 0.62),
    P(0.42, 0.66),
    P(0.425, 1.0),
    P(0.44, 1.05),
    P(0.44, L - 0.02),
    P(0.43, L),
    P(0.39, L),
  ]
  const barrelGeo = new THREE.LatheGeometry(shell, 128)
  barrelGeo.rotateX(Math.PI / 2)
  const barrel = new THREE.Mesh(barrelGeo, satin)
  barrel.position.set(axisX, axisY, mountZ)
  group.add(barrel)

  // Rubber zoom ring and focus ring, sitting proud of the barrel
  const ring = (r, z0, z1, material) => {
    const geo = new THREE.CylinderGeometry(r, r, z1 - z0, 128, 1, true)
    geo.rotateX(Math.PI / 2)
    const m = new THREE.Mesh(geo, material)
    m.position.set(axisX, axisY, mountZ + (z0 + z1) / 2)
    group.add(m)
    return m
  }
  ring(0.416, 0.36, 0.6, ribbed) // zoom
  ring(0.432, 0.72, 0.98, ribbed) // focus
  ring(0.446, 1.06, 1.075, metalBright) // the thin silver accent ring

  // Front: filter thread, black baffle, recessed glass
  const frontZ = mountZ + L
  const thread = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.018, 12, 128), metalDark)
  thread.position.set(axisX, axisY, frontZ - 0.01)
  group.add(thread)

  // long enough that the glass rim always sits inside it — no gap to see through
  const baffleGeo = new THREE.CylinderGeometry(0.39, 0.34, 0.12, 96, 1, true)
  baffleGeo.rotateX(Math.PI / 2)
  const baffle = new THREE.Mesh(
    baffleGeo,
    new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.95, side: THREE.DoubleSide })
  )
  baffle.position.set(axisX, axisY, frontZ - 0.07)
  group.add(baffle)

  // Front element: a shallow spherical cap facing +Z.
  const capR = 0.9
  const capAngle = Math.asin(0.345 / capR)
  const glassGeo = new THREE.SphereGeometry(capR, 96, 24, 0, Math.PI * 2, 0, capAngle)
  glassGeo.rotateX(Math.PI / 2)
  // the cap's pole sits at +capR on Z; move it so the rim sits inside the baffle
  const capDepth = capR - capR * Math.cos(capAngle)
  glassGeo.translate(0, 0, -capR + capDepth * 0.5)
  const glass = new THREE.Mesh(
    glassGeo,
    new THREE.MeshStandardMaterial({ color: 0x14202e, roughness: 0.12, metalness: 0.2, emissive: 0x05080c })
  )
  glass.position.set(axisX, axisY, frontZ - 0.07)
  glass.name = 'lens-glass'
  group.add(glass)

  // Inner rings visible through the glass edge
  for (let i = 0; i < 3; i++) {
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.3 - i * 0.07, 0.012, 8, 96), satin)
    inner.position.set(axisX, axisY, frontZ - 0.16 - i * 0.12)
    group.add(inner)
  }

  // floats in front of the view, so it neither casts nor receives the place's shadows
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = false
  })

  // Centre the whole camera on the lens axis so it turns about the lens
  group.position.set(-axisX, -axisY, 0)
  const pivot = new THREE.Group()
  pivot.add(group)

  // The rear display's picture area (3:2, inside the bezel), in pivot space.
  // Its outward normal is −Z: the photographer's side.
  const lcdBack = -D / 2 - 0.012 - 0.02 - 0.001
  return {
    group: pivot,
    screen: {
      center: new THREE.Vector3(0.14 - axisX, -0.06 - axisY, lcdBack),
      halfW: 0.345,
      halfH: 0.23,
    },
  }
}
