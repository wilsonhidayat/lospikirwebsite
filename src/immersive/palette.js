/**
 * Read the sky out of a photograph, so the painted 3D sky matches it.
 *
 * The photo is drawn small onto a canvas and its upper part sampled:
 *  - the top band gives the colour high in the sky (zenith),
 *  - a band lower down gives the colour near the horizon,
 *  - how grey and even it is says how cloudy it was,
 *  - the brightest patch gives the colour of the light.
 * If the top of the photo isn't sky (an interior, a dark night shot, a
 * close-up), it returns null and the place keeps its preset sky.
 */

const cache = new Map()

function avg(data, w, y0, y1) {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      n++
    }
  }
  return [r / n, g / n, b / n]
}

const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
const sat = ([r, g, b]) => {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  return mx === 0 ? 0 : (mx - mn) / mx
}
const hex = ([r, g, b]) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

function variance(data, w, y0, y1, mean) {
  let s = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      s += (data[i] - mean[0]) ** 2 + (data[i + 1] - mean[1]) ** 2 + (data[i + 2] - mean[2]) ** 2
      n++
    }
  }
  return Math.sqrt(s / n / 3) / 255
}

/**
 * @returns {Promise<{ sky: null | {zenith, horizon, sun, cloudLit, cloudShade, clouds, warmth}, tone: {warmth, lum} }>}
 *   sky colours as hex numbers (null if the top of the photo isn't open sky),
 *   and the overall tone of the photo
 */
export function readPhoto(url) {
  if (!url) return Promise.resolve({ sky: null, tone: null })
  if (cache.has(url)) return cache.get(url)
  const job = new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      try {
        const w = 24
        const h = Math.max(8, Math.round((img.naturalHeight / img.naturalWidth) * w))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = c.getContext('2d', { willReadFrequently: true })
        g.drawImage(img, 0, 0, w, h)
        const { data } = g.getImageData(0, 0, w, h)
        const whole = avg(data, w, 0, h)
        const tone = { warmth: (whole[0] - whole[2]) / 255, lum: lum(whole), mean: whole.map((v) => v / 255), sat: sat(whole) }

        // Look for the sky row by row in the upper part of the frame: a run
        // of rows that are bright, even across the width, and coloured like
        // sky (blue, neutral-bright grey, or a saturated sunset) rather than
        // a beige wall or ceiling. This finds a sunset band even below a
        // bridge overhead.
        const looksLikeSky = (c) => {
          const L = lum(c)
          const S = sat(c)
          if (L < 0.45) return false
          if (c[1] > c[0] && c[1] > c[2] * 1.15 && S > 0.25) return false // foliage
          const blue = c[2] >= c[0] * 0.95
          const greyBright = S < 0.08 && L > 0.6
          const sunset = c[0] > c[2] * 1.15 && c[0] > c[1] * 1.2 && S > 0.35
          return blue || greyBright || sunset
        }
        const rows = []
        const scanTo = Math.round(h * 0.65)
        for (let y = 0; y < scanTo; y++) {
          const m = avg(data, w, y, y + 1)
          rows.push(looksLikeSky(m) && variance(data, w, y, y + 1, m) < 0.14)
        }
        let bestRun = null
        for (let y = 0; y < rows.length; ) {
          if (!rows[y]) { y++; continue }
          let e = y
          while (e < rows.length && rows[e]) e++
          if (!bestRun || e - y > bestRun[1] - bestRun[0]) bestRun = [y, e]
          y = e
        }
        const minRun = Math.max(2, Math.round(h * 0.1))
        if (!bestRun || bestRun[1] - bestRun[0] < minRun) return resolve({ sky: null, tone })
        const [y0, y1] = bestRun
        const third = Math.max(1, Math.round((y1 - y0) / 3))
        let top = avg(data, w, y0, y0 + third)
        let low = avg(data, w, y1 - third, y1)
        // the ground under it should be darker than the sky
        const bottom = avg(data, w, Math.min(h - 1, y1 + 1), h)
        if (!(lum(top) > lum(bottom) * 1.1)) return resolve({ sky: null, tone })

        // brightest cell in the band: the colour of the light
        let best = top
        let bestL = 0
        for (let y = y0; y < y1; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4
            const px = [data[i], data[i + 1], data[i + 2]]
            const l = lum(px)
            if (l > bestL) {
              bestL = l
              best = px
            }
          }
        }
        const white = [255, 255, 255]
        // a sky seen in glass or in shade reads too dark: lift it a little
        const lift = (c, target) => {
          const l = lum(c)
          return l >= target ? c : mix(c, white, (target - l) / (1 - l))
        }
        top = lift(top, 0.58)
        low = lift(low, 0.62)
        // grey skies are overcast; blotchy ones are cloudy; clean, even blue
        // (even a pale winter blue) is clear
        const greyness = 1 - Math.min(1, sat(top) * 3)
        const texture = variance(data, w, y0, y1, avg(data, w, y0, y1))
        const clouds = Math.min(0.88, 0.12 + greyness * 0.5 + texture * 3)
        // the photo's band is usually low in the sky; overhead is deeper blue
        if (top[2] >= top[0] * 0.95) {
          const l = (top[0] + top[1] + top[2]) / 3
          top = top.map((v) => Math.max(0, Math.min(255, (l + (v - l) * 1.35) * 0.93)))
        }
        resolve({
          tone,
          sky: {
            zenith: hex(top),
            horizon: hex(mix(low, white, 0.08)),
            sun: hex(mix(best, white, 0.35)),
            cloudLit: hex(mix(mix(top, low, 0.5), white, 0.55)),
            cloudShade: hex(mix(mix(top, low, 0.5), [70, 70, 80], 0.22)),
            clouds,
            warmth: (top[0] - top[2]) / 255,
            from: url,
            // from other photos only a clearly blue sky is trusted: a grey or
            // warm band there could as well be a white wall or sandstone
            blue: top[2] >= top[0] * 0.95 && sat(top) > 0.1,
          },
        })
      } catch {
        resolve({ sky: null, tone: null })
      }
    }
    img.onerror = () => resolve({ sky: null, tone: null })
    img.src = url
  })
  cache.set(url, job)
  return job
}

/** Just the sky of one photo, or null. */
export async function skyFromPhoto(url) {
  return (await readPhoto(url)).sky
}

/**
 * The sky to paint for a project: from its moment photo; or, if that has no
 * open sky (a facade, a bridge overhead), from the project's other photos
 * (only clearly blue skies count there: a grey or warm band may be a wall) —
 * nearest to the moment first, choosing the one whose light is closest in
 * warmth to the moment (so a sunset stays a sunset).
 */
export async function skyFromProject(p) {
  const hero = await readPhoto(p.hero)
  if (hero.sky) return hero.sky
  const srcs = (p.photos || []).map((ph) => ph.src)
  const at = Math.max(0, srcs.indexOf(p.hero))
  const near = srcs
    .map((src, i) => [src, Math.abs(i - at)])
    .sort((a, b) => a[1] - b[1])
    .map(([src]) => src)
    .filter((src) => src !== p.hero)
    .slice(0, 10)
  const found = []
  for (const url of near) {
    const r = await readPhoto(url)
    if (r.sky && r.sky.blue) found.push(r.sky)
    if (found.length >= 4) break
  }
  if (!found.length) return null
  const want = hero.tone?.warmth ?? 0
  found.sort((a, b) => Math.abs(a.warmth - want) - Math.abs(b.warmth - want))
  return found[0]
}

/**
 * How to grade a place so it sits with its photographs: a gentle white
 * balance toward the photos' average colour and a matching saturation.
 * Uses the hero and a few other photos of the project.
 */
export async function gradeFromProject(p) {
  const srcs = [p.hero, ...(p.photos || []).map((ph) => ph.src).filter((s) => s !== p.hero)].slice(0, 4)
  const tones = (await Promise.all(srcs.map((s) => readPhoto(s)))).map((r) => r.tone).filter(Boolean)
  if (!tones.length) return { tint: [1, 1, 1], saturation: 1 }
  const mean = [0, 1, 2].map((i) => tones.reduce((a, t) => a + t.mean[i], 0) / tones.length)
  const grey = (mean[0] + mean[1] + mean[2]) / 3 || 1
  const tint = mean.map((v) => Math.max(0.9, Math.min(1.1, 1 + (v / grey - 1) * 0.3)))
  const s = tones.reduce((a, t) => a + t.sat, 0) / tones.length
  const saturation = Math.max(0.85, Math.min(1.15, 0.8 + s * 0.9))
  return { tint, saturation }
}
