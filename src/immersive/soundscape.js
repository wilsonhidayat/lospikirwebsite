/**
 * The experience's sound, made in the browser — no audio files, nothing to
 * license.
 *
 *  music     a slow, warm pad (four soft chords, eight seconds each) with a
 *            few high notes falling into a long reverb, like a film score
 *            under a photo. If site settings name a music file
 *            (tour.music, e.g. /music/theme.mp3) that plays instead.
 *  ambience  the place itself, under the music: waves and wind on the
 *            dunes, a city's hum, water at night, the party deck's bass
 *            through the floor, a quiet room.
 *
 * Nothing plays until the visitor starts the experience (a click — which
 * browsers require anyway), and there's always a button to turn it off.
 */

const CHORDS = [
  [174.61, 220.0, 261.63, 329.63], // Fmaj7
  [220.0, 261.63, 329.63, 392.0], // Am7
  [130.81, 196.0, 246.94, 329.63], // Cmaj7 (open)
  [196.0, 246.94, 293.66, 329.63], // G6
]
const BAR = 8 // seconds per chord

const PLACE_SOUND = {
  coast: 'sea',
  paris: 'city',
  amsterdam: 'city',
  leidseplein: 'city',
  eindhoven: 'city',
  campus: 'open',
  erasmus: 'open',
  'waterfront-sunset': 'harbour',
  'waterfront-night': 'night',
  'party-boat': 'party',
  interior: 'room',
  studio: 'room',
  hall: 'room',
}

export function createSoundscape({ music = null } = {}) {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!AC) return null
  let ctx = null
  let master = null
  let musicBus = null
  let ambBus = null
  let reverb = null
  let brown = null
  let white = null
  let running = false
  let muted = false
  let timer = 0
  let bar = 0
  let nextBar = 0
  let nextNote = 0
  let ambience = null // { gain, stop }
  let kind = null
  let file = null

  function init() {
    if (ctx) return
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)
    // a long, soft room for everything to sit in
    reverb = ctx.createConvolver()
    reverb.buffer = impulse(3.2, 2.6)
    const wet = ctx.createGain()
    wet.gain.value = 0.55
    reverb.connect(wet).connect(master)
    musicBus = ctx.createGain()
    musicBus.gain.value = 0.5
    musicBus.connect(master)
    musicBus.connect(reverb)
    ambBus = ctx.createGain()
    ambBus.gain.value = 1
    ambBus.connect(master)
    brown = noiseBuffer('brown')
    white = noiseBuffer('white')
    if (music) {
      file = new Audio(music)
      file.loop = true
      file.crossOrigin = 'anonymous'
      ctx.createMediaElementSource(file).connect(musicBus)
    }
  }

  function impulse(seconds, decay) {
    const n = Math.floor(ctx.sampleRate * seconds)
    const b = ctx.createBuffer(2, n, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c)
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay)
    }
    return b
  }

  function noiseBuffer(type) {
    const n = ctx.sampleRate * 4
    const b = ctx.createBuffer(1, n, ctx.sampleRate)
    const d = b.getChannelData(0)
    let last = 0
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1
      if (type === 'brown') {
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      } else d[i] = w
    }
    return b
  }

  /* --- the music -------------------------------------------------------- */

  function playChord(at, notes) {
    for (const f of notes) {
      for (const [type, detune, level] of [
        ['triangle', -5, 0.05],
        ['sine', 6, 0.07],
      ]) {
        const o = ctx.createOscillator()
        o.type = type
        o.frequency.value = f
        o.detune.value = detune
        const lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 1100
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, at)
        g.gain.linearRampToValueAtTime(level, at + 3)
        g.gain.setValueAtTime(level, at + BAR - 1)
        g.gain.linearRampToValueAtTime(0, at + BAR + 3)
        o.connect(lp).connect(g).connect(musicBus)
        o.start(at)
        o.stop(at + BAR + 3.2)
      }
    }
    // a low root under it
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = notes[0] / 2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(0.08, at + 2)
    g.gain.linearRampToValueAtTime(0, at + BAR + 2)
    o.connect(g).connect(musicBus)
    o.start(at)
    o.stop(at + BAR + 2.2)
  }

  function playNote(at, f) {
    // a soft, bell-like note: two sines, a quick attack, a long fall
    for (const [mult, level] of [
      [1, 0.06],
      [2.01, 0.015],
    ]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f * mult
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(level, at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 3.2)
      o.connect(g)
      g.connect(musicBus)
      g.connect(reverb)
      o.start(at)
      o.stop(at + 3.3)
    }
  }

  function schedule() {
    if (!running || file) return
    const now = ctx.currentTime
    while (nextBar < now + 1.5) {
      playChord(nextBar, CHORDS[bar % CHORDS.length])
      bar++
      nextBar += BAR
    }
    while (nextNote < now + 1.5) {
      const chord = CHORDS[(bar - 1 + CHORDS.length) % CHORDS.length]
      const f = chord[Math.floor(Math.random() * chord.length)] * (Math.random() < 0.5 ? 2 : 4)
      playNote(nextNote, f)
      nextNote += 2.2 + Math.random() * 2.6
    }
  }

  /* --- the place -------------------------------------------------------- */

  function loop(buffer) {
    const s = ctx.createBufferSource()
    s.buffer = buffer
    s.loop = true
    s.loopStart = Math.random() * 2
    s.start(ctx.currentTime, Math.random() * 3)
    return s
  }
  function lfo(rate, depth, target, offset) {
    const o = ctx.createOscillator()
    o.frequency.value = rate
    const g = ctx.createGain()
    g.gain.value = depth
    o.connect(g).connect(target)
    target.value = offset
    o.start()
    return o
  }

  function makeAmbience(type) {
    const out = ctx.createGain()
    out.gain.value = 0
    out.connect(ambBus)
    const nodes = []
    const filtered = (buffer, ftype, freq, q, level) => {
      const s = loop(buffer)
      const f = ctx.createBiquadFilter()
      f.type = ftype
      f.frequency.value = freq
      f.Q.value = q
      const g = ctx.createGain()
      g.gain.value = level
      s.connect(f).connect(g).connect(out)
      nodes.push(s)
      return { s, f, g }
    }
    if (type === 'sea' || type === 'harbour') {
      // waves: low rumble that swells and draws back
      const w = filtered(brown, 'lowpass', 700, 0.5, 0)
      nodes.push(lfo(type === 'sea' ? 0.09 : 0.13, 0.22, w.g.gain, 0.3))
      const h = filtered(white, 'bandpass', 1800, 0.6, 0)
      nodes.push(lfo(type === 'sea' ? 0.09 : 0.13, 0.025, h.g.gain, 0.03))
      if (type === 'sea') {
        const wind = filtered(white, 'bandpass', 500, 0.8, 0.035)
        nodes.push(lfo(0.05, 180, wind.f.frequency, 520))
      } else filtered(brown, 'lowpass', 300, 0.4, 0.12)
    } else if (type === 'city' || type === 'open' || type === 'night') {
      // a city's distant hum and air
      filtered(brown, 'lowpass', type === 'night' ? 220 : 380, 0.5, type === 'open' ? 0.12 : 0.22)
      const air = filtered(white, 'bandpass', 900, 0.4, type === 'night' ? 0.008 : 0.016)
      nodes.push(lfo(0.04, 300, air.f.frequency, 900))
    } else if (type === 'party') {
      // the deck below: bass through the floor, the crowd's murmur
      filtered(white, 'bandpass', 700, 0.7, 0.03)
      const kick = ctx.createGain()
      kick.gain.value = 1
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 160
      kick.connect(lp).connect(out)
      const beat = 60 / 122
      let t = ctx.currentTime + 0.1
      const tick = setInterval(() => {
        while (t < ctx.currentTime + 1) {
          const o = ctx.createOscillator()
          const g = ctx.createGain()
          o.frequency.setValueAtTime(110, t)
          o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
          g.gain.setValueAtTime(0.0001, t)
          g.gain.exponentialRampToValueAtTime(0.5, t + 0.005)
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
          o.connect(g).connect(kick)
          o.start(t)
          o.stop(t + 0.4)
          t += beat
        }
      }, 300)
      nodes.push({ stop: () => clearInterval(tick) })
    } else {
      // a quiet room
      filtered(brown, 'lowpass', 200, 0.4, 0.05)
    }
    return {
      gain: out,
      stop() {
        for (const n of nodes) {
          try {
            n.stop()
          } catch {
            /* already stopped */
          }
        }
        out.disconnect()
      },
    }
  }

  function crossfadeTo(type) {
    if (!ctx || type === kind) return
    kind = type
    const t = ctx.currentTime
    if (ambience) {
      const old = ambience
      old.gain.gain.cancelScheduledValues(t)
      old.gain.gain.setValueAtTime(old.gain.gain.value, t)
      old.gain.gain.linearRampToValueAtTime(0, t + 2.5)
      setTimeout(() => old.stop(), 2800)
      ambience = null
    }
    if (!type) return
    ambience = makeAmbience(type)
    ambience.gain.gain.setValueAtTime(0, t)
    ambience.gain.gain.linearRampToValueAtTime(1, t + 3)
    // the music sits back a little in a loud place, comes forward in a quiet one
    musicBus.gain.setTargetAtTime(type === 'party' ? 0.28 : 0.5, t, 1.2)
  }

  function fadeMaster(to, seconds) {
    const t = ctx.currentTime
    master.gain.cancelScheduledValues(t)
    master.gain.setValueAtTime(master.gain.value, t)
    master.gain.linearRampToValueAtTime(to, t + seconds)
  }

  return {
    get muted() {
      return muted
    },
    get running() {
      return running
    },
    /** Start (must be called from a click or key press). */
    start() {
      init()
      if (ctx.state === 'suspended') ctx.resume()
      if (running) return
      running = true
      nextBar = ctx.currentTime + 0.1
      nextNote = ctx.currentTime + 4
      if (file) file.play().catch(() => {})
      schedule()
      timer = setInterval(schedule, 500)
      if (!muted) fadeMaster(0.9, 2.5)
    },
    /** The place's own sound under the music: a scene name, or null for none. */
    setPlace(scene) {
      if (!ctx) return
      crossfadeTo(scene ? PLACE_SOUND[scene] || 'open' : null)
    },
    setMuted(m) {
      muted = m
      if (!ctx) return
      if (m) fadeMaster(0, 0.6)
      else {
        if (ctx.state === 'suspended') ctx.resume()
        if (running) fadeMaster(0.9, 1.2)
      }
    },
    /** Fade everything out and stop. */
    stop() {
      if (!ctx || !running) return
      running = false
      clearInterval(timer)
      fadeMaster(0, 2)
      setTimeout(() => {
        if (running) return
        crossfadeTo(null)
        file?.pause()
      }, 2100)
    },
    dispose() {
      clearInterval(timer)
      ambience?.stop()
      file?.pause()
      ctx?.close()
    },
  }
}
