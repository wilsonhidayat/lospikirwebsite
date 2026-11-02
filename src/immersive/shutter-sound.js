/**
 * A mechanical shutter, synthesised — no audio file, nothing to license.
 *
 * A focal-plane shutter makes two sounds a few milliseconds apart: the first
 * curtain opening and the second closing, each a short filtered click with a
 * low mechanical thump under it, then the mirrorless "ka-chk" settle.
 *
 * Audio only starts after the visitor turns sound on (a user gesture), which
 * browsers require anyway.
 */
let ctx = null
let noise = null

function context() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    // one second of white noise, reused for every click
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function click(at, { freq = 3200, q = 1.4, gain = 0.5, decay = 0.022 } = {}) {
  const src = ctx.createBufferSource()
  src.buffer = noise
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = freq
  band.Q.value = q
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0, at)
  amp.gain.linearRampToValueAtTime(gain, at + 0.0015)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  src.connect(band).connect(amp).connect(ctx.destination)
  src.start(at, Math.random() * 0.5, decay + 0.02)

  // the low thump of the mechanism
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(140, at)
  osc.frequency.exponentialRampToValueAtTime(60, at + 0.04)
  const og = ctx.createGain()
  og.gain.setValueAtTime(gain * 0.5, at)
  og.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
  osc.connect(og).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + 0.06)
}

/** Call from a click handler to unlock audio on iOS. */
export function unlockAudio() {
  return !!context()
}

/** Play one exposure. `shutter` is the exposure time in seconds (from EXIF). */
export function playShutter(shutter = 1 / 250) {
  if (!context()) return
  const now = ctx.currentTime + 0.005
  // the gap between the curtains: never shorter than the mechanism allows
  const gap = Math.min(0.25, Math.max(0.035, shutter))
  click(now, { freq: 3600, gain: 0.45 })
  click(now + gap, { freq: 2600, gain: 0.55, decay: 0.03 })
  click(now + gap + 0.045, { freq: 1800, q: 0.9, gain: 0.25, decay: 0.04 })
}
