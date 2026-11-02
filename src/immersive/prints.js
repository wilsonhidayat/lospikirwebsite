/**
 * Instant-film prints: a photo in an Instax-style frame — Mini (portrait)
 * for upright photos, Wide (landscape) for the rest — on soft paper, with a
 * handwritten title on the broad bottom edge.
 *
 * The print is a finely divided plane whose vertex shader bends it like
 * paper in a breeze (the wave grows toward the free edge); its fragment
 * shader shades the bend softly and adds the gloss of the photo's surface.
 * Colours are kept exact: post.js shows these pixels without the film curve.
 */

// real proportions (mm): card and picture area
const MINI = { w: 54, h: 86, img: [46, 62], top: 6 }
const WIDE = { w: 108, h: 86, img: [99, 62], top: 6 }

let fontReady = null
function handwriting() {
  if (!fontReady) {
    fontReady =
      typeof document !== 'undefined' && document.fonts?.load
        ? Promise.race([document.fonts.load('48px Caveat'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {})
        : Promise.resolve()
  }
  return fontReady
}

const images = new Map()
export function loadImage(src) {
  if (!images.has(src)) {
    images.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image()
        img.decoding = 'async'
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
      })
    )
  }
  return images.get(src)
}

/**
 * Paint a print onto a canvas. Returns { canvas, format } where format is the
 * card's size in mm, so the mesh can match it.
 */
export async function paintPrint(src, { title = '', maxPx = 1400 } = {}) {
  const [img] = await Promise.all([loadImage(src), handwriting()])
  const landscape = img.naturalWidth > img.naturalHeight * 1.1
  const F = landscape ? WIDE : MINI
  const scale = maxPx / Math.max(F.w, F.h)
  const W = Math.round(F.w * scale)
  const H = Math.round(F.h * scale)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')

  // the paper: warm white, a faint sheen and fibre
  const paper = g.createLinearGradient(0, 0, W, H)
  paper.addColorStop(0, '#f7f5ef')
  paper.addColorStop(1, '#ebe7de')
  g.fillStyle = paper
  g.fillRect(0, 0, W, H)
  const fibre = g.getImageData(0, 0, W, H)
  for (let i = 0; i < fibre.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 7
    fibre.data[i] += n
    fibre.data[i + 1] += n
    fibre.data[i + 2] += n
  }
  g.putImageData(fibre, 0, 0)

  // the picture, cropped to fill its window like a real exposure
  const iw = F.img[0] * scale
  const ih = F.img[1] * scale
  const ix = (W - iw) / 2
  const iy = F.top * scale
  const r = Math.max(iw / img.naturalWidth, ih / img.naturalHeight)
  const sw = iw / r
  const sh = ih / r
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, ix, iy, iw, ih)
  // instant film's slight lift in the blacks and a soft edge falloff
  g.fillStyle = 'rgba(40, 30, 20, 0.05)'
  g.fillRect(ix, iy, iw, ih)
  const v = g.createRadialGradient(ix + iw / 2, iy + ih / 2, Math.min(iw, ih) * 0.35, ix + iw / 2, iy + ih / 2, Math.max(iw, ih) * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.16)')
  g.fillStyle = v
  g.fillRect(ix, iy, iw, ih)
  g.strokeStyle = 'rgba(0,0,0,0.12)'
  g.lineWidth = Math.max(1, scale * 0.12)
  g.strokeRect(ix, iy, iw, ih)

  // the title, written by hand on the bottom edge
  if (title) {
    const by = iy + ih
    const bh = H - by
    g.fillStyle = 'rgba(38, 36, 44, 0.86)'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    let size = bh * 0.42
    g.font = `${size}px Caveat, 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive`
    while (g.measureText(title).width > iw * 0.92 && size > 10) {
      size *= 0.92
      g.font = `${size}px Caveat, 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive`
    }
    g.save()
    g.translate(W / 2, by + bh * 0.5)
    g.rotate(-0.025)
    g.fillText(title, 0, 0)
    g.restore()
  }
  return { canvas: c, format: F, landscape }
}

/** The bending, glossy print material. */
export function printMaterial(THREE, texture, { w, h }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uTime: { value: 0 },
      uWind: { value: 1 },
      uPhase: { value: Math.random() * 10 },
      uSize: { value: new THREE.Vector2(w, h) },
      uLight: { value: new THREE.Vector3(-0.4, 0.6, 1).normalize() },
      uOpacity: { value: 1 },
      uLift: { value: 0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uWind; uniform float uPhase; uniform vec2 uSize;
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      // how far the paper moves out of its plane at (x, y); y = 0 is the top edge
      float bend(vec2 p) {
        float free = clamp(-p.y / uSize.y, 0.0, 1.0); // pinned at the top
        float t = uTime + uPhase;
        float wave = sin(p.y * 2.1 / uSize.y * 3.0 + t * 1.7) * 0.6
                   + sin(p.x * 2.6 / uSize.x * 2.0 + t * 1.15 + 1.3) * 0.4
                   + sin((p.x + p.y) * 4.0 / uSize.y + t * 2.6) * 0.15;
        float curl = (p.x / uSize.x) * (p.x / uSize.x) * 0.5; // edges curl a touch
        return uWind * uSize.y * (0.045 * wave * free * free + 0.02 * curl * free);
      }
      void main() {
        vUv = uv;
        vec3 p = position;
        float e = uSize.y * 0.01;
        float z = bend(p.xy);
        float dx = (bend(p.xy + vec2(e, 0.0)) - z) / e;
        float dy = (bend(p.xy + vec2(0.0, e)) - z) / e;
        p.z += z;
        vN = normalize(normalMatrix * normalize(vec3(-dx, -dy, 1.0)));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec3 uLight; uniform float uOpacity; uniform float uLift;
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) { n = -n; c = vec3(0.86, 0.84, 0.8); } // the back is plain paper
        vec3 v = normalize(vView);
        vec3 l = normalize(uLight);
        float diff = max(dot(n, l), 0.0);
        float shade = 0.84 + 0.16 * diff + uLift * 0.04;
        // the glossy surface catches a soft highlight as it bends
        vec3 hv = normalize(l + v);
        float spec = pow(max(dot(n, hv), 0.0), 70.0) * 0.18 + pow(max(dot(n, hv), 0.0), 8.0) * 0.03;
        gl_FragColor = vec4(c * shade + spec, uOpacity);
      }`,
  })
}

/**
 * A print mesh, its top edge at the origin (so it hangs from a peg there).
 * Width in world units; height follows the format.
 */
export async function buildPrint(THREE, renderer, src, { title = '', width = 1, maxPx = 1400 } = {}) {
  const { canvas, format, landscape } = await paintPrint(src, { title, maxPx })
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  const w = width * (landscape ? 1.45 : 1)
  const h = (w * format.h) / format.w
  const geo = new THREE.PlaneGeometry(w, h, 20, 28)
  geo.translate(0, -h / 2, 0)
  const mat = printMaterial(THREE, tex, { w, h })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData = { w, h, landscape, tex }
  return mesh
}

export function disposePrint(mesh) {
  mesh.geometry.dispose()
  mesh.material.dispose()
  mesh.userData.tex?.dispose()
}
