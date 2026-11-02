/**
 * Whether to show the immersive 3D experience, or the classic page.
 *
 * Classic when: the visitor asked for reduced motion, the browser has no
 * WebGL 2, Data Saver is on, or the URL has ?classic. The classic page has
 * the same content — nobody misses anything.
 */
export function immersiveSupported() {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).has('classic')) return false
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    if (navigator.connection && navigator.connection.saveData) return false
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

/** Phones and modest laptops get fewer grass blades, softer shadows, lower resolution. */
export function qualityLevel() {
  if (typeof window === 'undefined') return 'low'
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const memory = navigator.deviceMemory || 8
  const cores = navigator.hardwareConcurrency || 8
  return coarse || memory <= 4 || cores <= 4 ? 'low' : 'high'
}
