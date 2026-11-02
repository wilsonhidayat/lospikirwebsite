/**
 * Reads the camera settings out of a JPEG's EXIF block — ISO, shutter speed,
 * aperture, focal length, lens and body — so the viewfinder shows the real
 * settings each photograph was taken with. No library: the handful of tags we
 * need sit in the first few kilobytes of the file.
 *
 * Returns null if the image has no EXIF (e.g. it was exported with metadata
 * stripped); the viewfinder then simply leaves those readouts blank.
 */

const TAGS = {
  0x0110: 'model',
  0x8769: 'exifPointer',
  0x829a: 'exposureTime',
  0x829d: 'fNumber',
  0x8827: 'iso',
  0x920a: 'focalLength',
  0xa434: 'lens',
}

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

function readIFD(view, tiff, offset, little, out) {
  if (offset + 2 > view.byteLength) return
  const count = view.getUint16(offset, little)
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12
    if (entry + 12 > view.byteLength) return
    const tag = view.getUint16(entry, little)
    const name = TAGS[tag]
    if (!name) continue
    const type = view.getUint16(entry + 2, little)
    const n = view.getUint32(entry + 4, little)
    const size = (TYPE_SIZE[type] || 1) * n
    const at = size > 4 ? tiff + view.getUint32(entry + 8, little) : entry + 8
    if (at + size > view.byteLength) continue

    if (type === 2) {
      let s = ''
      for (let k = 0; k < n; k++) {
        const c = view.getUint8(at + k)
        if (c === 0) break
        s += String.fromCharCode(c)
      }
      out[name] = s.trim()
    } else if (type === 3) {
      out[name] = view.getUint16(at, little)
    } else if (type === 4) {
      out[name] = view.getUint32(at, little)
    } else if (type === 5 || type === 10) {
      const num = type === 5 ? view.getUint32(at, little) : view.getInt32(at, little)
      const den = type === 5 ? view.getUint32(at + 4, little) : view.getInt32(at + 4, little)
      out[name] = den ? num / den : 0
    }
  }
}

/** Parse EXIF from the bytes of a JPEG. Exported for testing. */
export function parseExif(buffer) {
  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null

  let offset = 2
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset)
    const length = view.getUint16(offset + 2)
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
      // "Exif\0\0", then a TIFF header
      const tiff = offset + 10
      const little = view.getUint16(tiff) === 0x4949
      const raw = {}
      readIFD(view, tiff, tiff + view.getUint32(tiff + 4, little), little, raw)
      if (raw.exifPointer) readIFD(view, tiff, tiff + raw.exifPointer, little, raw)
      delete raw.exifPointer
      return Object.keys(raw).length ? raw : null
    }
    if (marker === 0xffda) break // start of image data: no EXIF before it
    offset += 2 + length
  }
  return null
}

/** Shutter speed as a photographer writes it: 1/250, 1/8, 0.5", 2". */
export function formatShutter(seconds) {
  if (!seconds) return null
  if (seconds >= 0.3) return `${Number(seconds.toFixed(1))}"`
  return `1/${Math.round(1 / seconds)}`
}

const BODY_NAMES = {
  'ILCE-7M3': 'A7 III',
  'ILCE-7M4': 'A7 IV',
  'ILCE-7RM3': 'A7R III',
  'ILCE-7RM4': 'A7R IV',
  'ILCE-7CM2': 'A7C II',
}

/** Turn raw EXIF into the strings the viewfinder shows. */
export function formatExif(raw) {
  if (!raw) return null
  return {
    iso: raw.iso ? String(raw.iso) : null,
    shutter: formatShutter(raw.exposureTime),
    aperture: raw.fNumber ? `F${Number(raw.fNumber.toFixed(1))}` : null,
    focal: raw.focalLength ? `${Math.round(raw.focalLength)}mm` : null,
    lens: raw.lens || null,
    body: raw.model ? BODY_NAMES[raw.model] || raw.model : null,
  }
}

const cache = new Map()

/**
 * Fetch just the head of an image and read its EXIF. Cached per URL.
 * Asks for the first 128 KB; servers that ignore Range send the whole file,
 * which still works.
 */
export function loadExif(url) {
  if (!url) return Promise.resolve(null)
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url, { headers: { Range: 'bytes=0-131071' } })
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((buf) => (buf ? formatExif(parseExif(buf)) : null))
        .catch(() => null)
    )
  }
  return cache.get(url)
}
