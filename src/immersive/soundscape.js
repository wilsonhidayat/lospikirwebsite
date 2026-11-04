/**
 * The experience's sound, made in the browser — no audio files, nothing to
 * license.
 *
 *  music     each place has its own: a musette waltz in Paris, lo-fi keys by
 *            the canals, a house beat on the party boat, bright plucks on
 *            campus, strings in the halls, a felt piano in a quiet room… and
 *            a slow warm theme for the landing and the memories. When the
 *            place changes, the music hands over within a breath. If site
 *            settings name a music file (tour.music, e.g. /music/theme.mp3)
 *            that plays instead.
 *  ambience  the place itself, under the music: waves, wind and gulls on the
 *            dunes, bike bells and water in Amsterdam, a tram bell on the
 *            square, birds in the park, glasses in the restaurant, a boat's
 *            horn across the water at night, the party deck's bass.
 *  tick      a soft detent as the memories carousel turns.
 *
 * Nothing plays until the visitor starts the experience (a click — which
 * browsers require anyway), and there's always a button to turn it off.
 */

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)

/* --- the music for each mood --------------------------------------------- */
// pattern: pad (held chords) · waltz · arp (broken chords) · stabs (house) · felt
const MOODS = {
  theme: { pattern: 'pad', voice: 'pad', bar: 8, bells: 1, chords: [[53, 57, 60, 64], [57, 60, 64, 67], [48, 55, 59, 64], [55, 59, 62, 64]] },
  paris: { pattern: 'waltz', voice: 'reed', bpm: 100, chords: [[57, 60, 64], [50, 53, 57, 62], [52, 56, 59, 62], [57, 60, 64, 69]] },
  canal: { pattern: 'arp', voice: 'keys', bpm: 76, steps: 16, pad: 0.5, chords: [[51, 55, 58, 62], [48, 51, 55, 58], [44, 48, 51, 55], [46, 50, 53, 55]] },
  square: { pattern: 'arp', voice: 'keys', bpm: 84, steps: 16, pad: 0.5, chords: [[55, 59, 62, 66], [52, 55, 59, 62], [48, 52, 55, 59], [50, 54, 57, 60]] },
  sea: { pattern: 'pad', voice: 'air', bar: 10, bells: 2, chords: [[50, 52, 57, 64], [45, 50, 52, 57], [47, 50, 54, 57], [43, 50, 55, 57]] },
  sunset: { pattern: 'arp', voice: 'keys', bpm: 68, steps: 8, pad: 0.7, chords: [[46, 50, 53, 57], [45, 48, 52, 55], [43, 46, 50, 57], [41, 45, 48, 52]] },
  night: { pattern: 'pad', voice: 'dark', bar: 10, bells: 0.5, low: 1, chords: [[45, 48, 52, 59], [41, 45, 48, 52], [48, 50, 55, 60], [40, 47, 50, 55]] },
  party: { pattern: 'stabs', voice: 'stab', bpm: 122, chords: [[57, 60, 64, 67], [50, 53, 57, 60], [55, 60, 62, 67], [48, 52, 55, 59]] },
  grad: { pattern: 'arp', voice: 'pluck', bpm: 104, steps: 16, pad: 0.35, chords: [[48, 52, 55, 60], [47, 50, 55, 59], [45, 48, 52, 57], [41, 45, 48, 53]] },
  park: { pattern: 'arp', voice: 'pluck', bpm: 88, steps: 16, soft: 1, pad: 0.4, chords: [[43, 50, 55, 59], [40, 47, 52, 55], [48, 52, 55, 60], [50, 54, 57, 62]] },
  room: { pattern: 'felt', voice: 'felt', bar: 7, chords: [[48, 52, 55, 59, 62], [45, 48, 52, 55, 59], [41, 45, 48, 52, 55], [43, 47, 50, 52]] },
  ceremony: { pattern: 'pad', voice: 'strings', bar: 7, bells: 1, chords: [[50, 54, 57, 62], [49, 52, 57, 64], [47, 50, 54, 59], [43, 50, 55, 59]] },
}

/* --- each place: its music and its own sound ------------------------------ */
const PLACES = {
  paris: ['paris', 'paris'],
  amsterdam: ['canal', 'canal'],
  leidseplein: ['square', 'square'],
  'leidseplein-hotel': ['ceremony', 'lobby'],
  restaurant: ['room', 'restaurant'],
  coast: ['sea', 'sea'],
  'waterfront-sunset': ['sunset', 'harbour'],
  'waterfront-night': ['night', 'night'],
  'party-boat': ['party', 'party'],
  campus: ['grad', 'campus'],
  erasmus: ['grad', 'campus'],
  eindhoven: ['grad', 'city'],
  blob: ['grad', 'citynight'],
  park: ['park', 'park'],
  interior: ['room', 'room'],
  studio: ['room', 'room'],
  hall: ['ceremony', 'hall'],
  cityhall: ['ceremony', 'hall'],
  stadsloket: ['ceremony', 'hall'],
}

export function createSoundscape({ music = null } = {}) {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!AC) return null
  let ctx = null
  let master = null
  let musicBus = null
  let ambBus = null
  let fxBus = null
  let reverb = null
  let brown = null
  let white = null
  let running = false
  let muted = false
  let timer = 0
  let bar = 0
  let nextBar = 0
  let mood = MOODS.theme
  let bars = [] // { gain, end } — one per scheduled bar of music, so a change can fade it
  let ambience = null // { gain, stop }
  let kind = null
  let file = null
  let lastTick = 0

  function init() {
    if (ctx) return
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0
    // keep a busy moment (party bass + gulls + a chord) from ever clipping
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    master.connect(comp).connect(ctx.destination)
    // a long, soft room for everything to sit in
    reverb = ctx.createConvolver()
    reverb.buffer = impulse(3.2, 2.6)
    const wet = ctx.createGain()
    wet.gain.value = 0.5
    reverb.connect(wet).connect(master)
    musicBus = ctx.createGain()
    musicBus.gain.value = 0.5
    musicBus.connect(master)
    musicBus.connect(reverb)
    ambBus = ctx.createGain()
    ambBus.gain.value = 1
    ambBus.connect(master)
    fxBus = ctx.createGain()
    fxBus.gain.value = 0.9
    fxBus.connect(master)
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

  function osc(type, f, detune = 0) {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = f
    o.detune.value = detune
    return o
  }
  function filter(type, f, q = 0.7) {
    const b = ctx.createBiquadFilter()
    b.type = type
    b.frequency.value = f
    b.Q.value = q
    return b
  }
  function panner(p) {
    if (!ctx.createStereoPanner) return ctx.createGain()
    const s = ctx.createStereoPanner()
    s.pan.value = p
    return s
  }

  /* --- the instruments ----------------------------------------------------- */

  // one note on an instrument, into `out`; `len` is how long it's held
  function note(out, voice, at, f, len, level = 1) {
    const end = (o, t) => {
      o.start(at)
      o.stop(t + 0.05)
    }
    const g = ctx.createGain()
    g.connect(out)
    if (voice === 'pad' || voice === 'air' || voice === 'dark') {
      const cut = voice === 'air' ? 2200 : voice === 'dark' ? 650 : 1100
      const lp = filter('lowpass', cut)
      lp.connect(g)
      const a = Math.min(3, len * 0.4)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(0.06 * level, at + a)
      g.gain.setValueAtTime(0.06 * level, at + len - 0.5)
      g.gain.linearRampToValueAtTime(0, at + len + 3)
      for (const [t, d] of [['triangle', -5], ['sine', 6]]) {
        const o = osc(t, f, d)
        o.connect(lp)
        end(o, at + len + 3)
      }
    } else if (voice === 'strings') {
      const lp = filter('lowpass', 1500)
      lp.connect(g)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(0.028 * level, at + 1.6)
      g.gain.setValueAtTime(0.028 * level, at + len - 0.5)
      g.gain.linearRampToValueAtTime(0, at + len + 2.5)
      const vib = osc('sine', 5.2)
      const vg = ctx.createGain()
      vg.gain.value = 5
      vib.connect(vg)
      for (const d of [-7, 7]) {
        const o = osc('sawtooth', f, d)
        vg.connect(o.detune)
        o.connect(lp)
        end(o, at + len + 2.5)
      }
      end(vib, at + len + 2.5)
    } else if (voice === 'reed') {
      // an accordion: two reeds a little apart (the musette's shimmer)
      const bp = filter('bandpass', 1400, 0.6)
      bp.connect(g)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(0.03 * level, at + 0.04)
      g.gain.setValueAtTime(0.03 * level, at + len)
      g.gain.linearRampToValueAtTime(0, at + len + 0.18)
      for (const d of [-11, 11]) {
        const o = osc('sawtooth', f, d)
        o.connect(bp)
        end(o, at + len + 0.2)
      }
    } else if (voice === 'keys') {
      // an electric piano: a round tone with a little bell on top
      const lp = filter('lowpass', 2200)
      lp.connect(g)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(0.07 * level, at + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 2.4)
      const o = osc('sine', f)
      o.connect(lp)
      end(o, at + 2.4)
      const t = osc('sine', f * 4)
      const tg = ctx.createGain()
      tg.gain.setValueAtTime(0.25, at)
      tg.gain.exponentialRampToValueAtTime(0.001, at + 0.4)
      t.connect(tg).connect(lp)
      end(t, at + 0.45)
    } else if (voice === 'pluck' || voice === 'stab') {
      // a plucked string / a house chord stab: the filter closes as it rings
      const lp = filter('lowpass', 3200, voice === 'stab' ? 2 : 1)
      lp.connect(g)
      const dec = voice === 'stab' ? 0.28 : 0.8
      lp.frequency.setValueAtTime(voice === 'stab' ? 2400 : 3600, at)
      lp.frequency.exponentialRampToValueAtTime(380, at + dec)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime((voice === 'stab' ? 0.035 : 0.045) * level, at + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, at + dec + 0.3)
      for (const d of [-6, 6]) {
        const o = osc('sawtooth', f, d)
        o.connect(lp)
        end(o, at + dec + 0.3)
      }
    } else if (voice === 'felt') {
      // a felt piano, close and soft
      const lp = filter('lowpass', 1300)
      lp.connect(g)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(0.11 * level, at + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 3.6)
      const o = osc('triangle', f)
      const o2 = osc('sine', f * 2.002)
      const g2 = ctx.createGain()
      g2.gain.value = 0.2
      o.connect(lp)
      o2.connect(g2).connect(lp)
      end(o, at + 3.6)
      end(o2, at + 3.6)
    } else if (voice === 'bell') {
      // a soft, bell-like note: two sines, a quick attack, a long fall
      for (const [mult, lvl] of [[1, 0.06], [2.01, 0.015]]) {
        const o = osc('sine', f * mult)
        const bg = ctx.createGain()
        bg.gain.setValueAtTime(0, at)
        bg.gain.linearRampToValueAtTime(lvl * level, at + 0.02)
        bg.gain.exponentialRampToValueAtTime(0.0001, at + 3.2)
        o.connect(bg).connect(g)
        g.connect(reverb)
        end(o, at + 3.3)
      }
    } else if (voice === 'bass') {
      const o = osc('sine', f)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(0.09 * level, at + Math.min(0.02 + len * 0.2, 2))
      g.gain.linearRampToValueAtTime(0, at + len + 0.3)
      o.connect(g)
      end(o, at + len + 0.4)
    }
  }

  // one bar of the current mood, into its own gain (so it can be faded away)
  function playBar(at, m, chord) {
    const out = ctx.createGain()
    out.gain.value = 1
    out.connect(musicBus)
    const beat = m.bpm ? 60 / m.bpm : 0
    let len
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
    if (m.pattern === 'pad') {
      len = m.bar
      for (const f of chord) note(out, m.voice, at, hz(f), len)
      note(out, 'bass', at, hz(chord[0] - 12), len, m.low ? 1.2 : 0.9)
      // a few high notes falling into the reverb
      let t = at + 1 + Math.random() * 2
      while (t < at + len) {
        if (Math.random() < 0.6 * (m.bells || 1)) note(out, 'bell', t, hz(pick(chord) + (m.low ? 12 : pick([12, 24]))), 1)
        t += 2.2 + Math.random() * 2.6
      }
    } else if (m.pattern === 'waltz') {
      // oom-pa-pa, twice: bass on one, the chord on two and three
      len = beat * 6
      for (let k = 0; k < 6; k++) {
        const t = at + k * beat
        if (k % 3 === 0) note(out, 'bass', t, hz(chord[0] - (k ? 5 : 12)), beat * 0.8, 1.1)
        else for (const f of chord.slice(0, 3)) note(out, m.voice, t, hz(f), beat * 0.45, 0.8)
      }
      // and a melody line above, a note per measure
      note(out, m.voice, at, hz(pick(chord) + 12), beat * 2.6, 1.1)
      note(out, m.voice, at + beat * 3, hz(pick(chord) + 12), beat * 2.6, 1)
    } else if (m.pattern === 'arp') {
      const step = beat / 2
      len = step * m.steps
      const ladder = [...chord, chord[1] + 12, chord[2] + 12, chord[1] + 12]
      for (let k = 0; k < m.steps; k++) {
        // a little human: some steps rest, the first of each four is fuller
        if (k % 4 !== 0 && Math.random() < (m.soft ? 0.35 : 0.2)) continue
        note(out, m.voice, at + k * step + (Math.random() - 0.5) * 0.012, hz(ladder[k % ladder.length] + 12), step, k % 4 === 0 ? 1 : 0.7)
      }
      note(out, 'bass', at, hz(chord[0] - 12), len - 0.2, 0.8)
      if (m.pad) for (const f of chord) note(out, 'pad', at, hz(f), len, m.pad)
    } else if (m.pattern === 'stabs') {
      // two measures: chord stabs on the off-beats, bass walking the roots
      len = beat * 8
      for (let k = 0; k < 8; k++) {
        for (const f of chord) note(out, m.voice, at + k * beat + beat / 2, hz(f), 0.2)
        note(out, 'bass', at + k * beat, hz(chord[0] - 24 + (k % 4 === 3 ? 7 : 0)), beat * 0.5, 1.4)
      }
    } else {
      // felt: the chord rolled, then a couple of melody notes
      len = m.bar
      chord.forEach((f, i) => note(out, m.voice, at + i * 0.09, hz(f), 2, 0.8))
      note(out, m.voice, at + len * 0.45, hz(pick(chord) + 12), 2, 0.9)
      if (Math.random() < 0.7) note(out, m.voice, at + len * 0.72, hz(pick(chord) + 12), 2, 0.7)
      note(out, 'bass', at, hz(chord[0] - 12), len, 0.6)
    }
    bars.push({ gain: out, end: at + len + 4 })
    return len
  }

  function schedule() {
    if (!running || file) return
    const now = ctx.currentTime
    bars = bars.filter((b) => {
      if (b.end > now) return true
      b.gain.disconnect()
      return false
    })
    while (nextBar < now + 1.5) {
      const len = playBar(nextBar, mood, mood.chords[bar % mood.chords.length])
      bar++
      nextBar += len
    }
  }

  function setMood(name) {
    const m = MOODS[name] || MOODS.theme
    if (m === mood) return
    mood = m
    if (!ctx || !running || file) return
    // hand over: what's playing (and already scheduled) fades, the new piece starts
    const t = ctx.currentTime
    for (const b of bars) {
      b.gain.gain.cancelScheduledValues(t)
      b.gain.gain.setValueAtTime(b.gain.gain.value, t)
      b.gain.gain.linearRampToValueAtTime(0, t + 1.4)
      b.end = Math.min(b.end, t + 1.6)
    }
    bar = 0
    nextBar = t + 0.35
    schedule()
  }

  /* --- the place's sounds ---------------------------------------------------- */

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

  // little events, somewhere around you
  const events = {
    bird(out, t) {
      // a few quick chirps, each a fast sweep
      const n = 2 + Math.floor(Math.random() * 5)
      const base = 2800 + Math.random() * 2200
      for (let i = 0; i < n; i++) {
        const at = t + i * (0.09 + Math.random() * 0.07)
        const o = osc('sine', base)
        o.frequency.setValueAtTime(base * (0.8 + Math.random() * 0.3), at)
        o.frequency.exponentialRampToValueAtTime(base * (1.15 + Math.random() * 0.4), at + 0.06)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, at)
        g.gain.linearRampToValueAtTime(0.018, at + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08)
        o.connect(g).connect(out)
        o.start(at)
        o.stop(at + 0.1)
      }
    },
    gull(out, t) {
      // a gull's "kyow", two or three times, falling
      const n = 2 + Math.floor(Math.random() * 2)
      for (let i = 0; i < n; i++) {
        const at = t + i * 0.42
        const o = osc('sawtooth', 1350)
        o.frequency.setValueAtTime(1300 + Math.random() * 200, at)
        o.frequency.exponentialRampToValueAtTime(780, at + 0.32)
        const bp = filter('bandpass', 1600, 2.5)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, at)
        g.gain.linearRampToValueAtTime(0.012, at + 0.04)
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.34)
        o.connect(bp).connect(g).connect(out)
        g.connect(reverb)
        o.start(at)
        o.stop(at + 0.36)
      }
    },
    bike(out, t) {
      // a bicycle bell: bright, a little out of tune with itself, rung twice
      for (const at of [t, t + 0.16]) {
        for (const [f, lvl] of [[2350, 0.02], [2350 * 2.76, 0.006], [2410, 0.012]]) {
          const o = osc('sine', f)
          const g = ctx.createGain()
          g.gain.setValueAtTime(0, at)
          g.gain.linearRampToValueAtTime(lvl, at + 0.003)
          g.gain.exponentialRampToValueAtTime(0.0001, at + 1.1)
          o.connect(g).connect(out)
          o.start(at)
          o.stop(at + 1.2)
        }
      }
    },
    tram(out, t) {
      // the tram's ding-ding
      for (const at of [t, t + 0.32]) {
        for (const [f, lvl] of [[1180, 0.02], [1180 * 2.4, 0.006]]) {
          const o = osc('sine', f)
          const g = ctx.createGain()
          g.gain.setValueAtTime(0, at)
          g.gain.linearRampToValueAtTime(lvl, at + 0.004)
          g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4)
          o.connect(g).connect(out)
          g.connect(reverb)
          o.start(at)
          o.stop(at + 1.5)
        }
      }
    },
    church(out, t) {
      // a church bell far off: low, many partials, a long ring
      for (const [m, lvl] of [[0.5, 0.012], [1, 0.016], [1.19, 0.008], [1.5, 0.006], [2, 0.006], [2.6, 0.003]]) {
        const o = osc('sine', 196 * m)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(lvl, t + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 6)
        o.connect(g)
        g.connect(out)
        g.connect(reverb)
        o.start(t)
        o.stop(t + 6.1)
      }
    },
    horn(out, t) {
      // a ship's horn across the water
      const lp = filter('lowpass', 420)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.03, t + 0.4)
      g.gain.setValueAtTime(0.03, t + 2)
      g.gain.linearRampToValueAtTime(0, t + 3.2)
      lp.connect(g).connect(out)
      g.connect(reverb)
      for (const f of [98, 123.5]) {
        const o = osc('sawtooth', f)
        o.connect(lp)
        o.start(t)
        o.stop(t + 3.3)
      }
    },
    clink(out, t) {
      // two glasses touching
      for (const [f, lvl] of [[2900, 0.012], [4300, 0.006], [5600, 0.004]]) {
        const o = osc('sine', f * (0.95 + Math.random() * 0.1))
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(lvl, t + 0.002)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
        o.connect(g).connect(out)
        o.start(t)
        o.stop(t + 0.75)
      }
    },
    steps(out, t) {
      // footsteps across a stone floor, echoing
      const n = 3 + Math.floor(Math.random() * 4)
      for (let i = 0; i < n; i++) {
        const at = t + i * 0.52
        const s = ctx.createBufferSource()
        s.buffer = white
        const bp = filter('bandpass', 900, 1.2)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.03, at)
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06)
        s.connect(bp).connect(g).connect(out)
        g.connect(reverb)
        s.start(at, Math.random() * 3)
        s.stop(at + 0.08)
      }
    },
  }

  function makeAmbience(type) {
    const out = ctx.createGain()
    out.gain.value = 0
    out.connect(ambBus)
    const nodes = []
    const timers = []
    const filtered = (buffer, ftype, freq, q, level) => {
      const s = loop(buffer)
      const f = filter(ftype, freq, q)
      const g = ctx.createGain()
      g.gain.value = level
      s.connect(f).connect(g).connect(out)
      nodes.push(s)
      return { s, f, g }
    }
    // every so often (min–max seconds), somewhere left or right
    const every = (min, max, name) => {
      const go = () => {
        const id = setTimeout(() => {
          if (ctx && running && !muted) {
            const p = panner(Math.random() * 1.6 - 0.8)
            p.connect(out)
            events[name](p, ctx.currentTime + 0.05)
            setTimeout(() => p.disconnect(), 8000)
          }
          go()
        }, (min + Math.random() * (max - min)) * 1000)
        timers.push(id)
      }
      go()
    }
    const waves = (rate, level) => {
      const w = filtered(brown, 'lowpass', 700, 0.5, 0)
      nodes.push(lfo(rate, 0.22 * level, w.g.gain, 0.3 * level))
      const h = filtered(white, 'bandpass', 1800, 0.6, 0)
      nodes.push(lfo(rate, 0.025 * level, h.g.gain, 0.03 * level))
    }
    const hum = (cut, level) => filtered(brown, 'lowpass', cut, 0.5, level)
    const air = (level) => {
      const a = filtered(white, 'bandpass', 900, 0.4, level)
      nodes.push(lfo(0.04, 300, a.f.frequency, 900))
    }
    const wind = (level) => {
      const w = filtered(white, 'bandpass', 500, 0.8, level)
      nodes.push(lfo(0.05, 180, w.f.frequency, 520))
      nodes.push(lfo(0.07, level * 0.6, w.g.gain, level))
    }
    // people talking: the voice band, moving at the rate of syllables
    const murmur = (level) => {
      for (const [f, rate] of [[480, 3.1], [900, 4.3], [1500, 5.2]]) {
        const m = filtered(white, 'bandpass', f, 1.4, level)
        nodes.push(lfo(rate, level * 0.7, m.g.gain, level))
      }
    }
    const lapping = (level) => {
      const w = filtered(brown, 'bandpass', 420, 0.9, level)
      nodes.push(lfo(0.32, level * 0.8, w.g.gain, level))
    }

    switch (type) {
      case 'paris':
        hum(380, 0.18)
        air(0.012)
        every(3, 9, 'bird')
        every(30, 60, 'church')
        break
      case 'canal':
        hum(320, 0.12)
        lapping(0.18)
        every(7, 16, 'bike')
        every(5, 12, 'bird')
        break
      case 'square':
        hum(400, 0.2)
        murmur(0.016)
        every(14, 28, 'tram')
        every(10, 22, 'bike')
        break
      case 'lobby':
        hum(200, 0.05)
        murmur(0.008)
        every(6, 14, 'clink')
        every(12, 25, 'steps')
        break
      case 'restaurant':
        hum(200, 0.05)
        murmur(0.014)
        every(3, 8, 'clink')
        break
      case 'sea':
        waves(0.09, 1)
        wind(0.035)
        every(6, 14, 'gull')
        break
      case 'harbour':
        waves(0.13, 0.7)
        hum(300, 0.1)
        every(9, 20, 'gull')
        break
      case 'night':
        hum(220, 0.2)
        lapping(0.12)
        air(0.006)
        every(25, 50, 'horn')
        break
      case 'party': {
        // the deck below: bass through the floor, the crowd
        murmur(0.02)
        lapping(0.08)
        const kick = ctx.createGain()
        const lp = filter('lowpass', 160)
        kick.connect(lp).connect(out)
        const beat = 60 / 122
        let t = ctx.currentTime + 0.1
        const tick = setInterval(() => {
          while (t < ctx.currentTime + 1) {
            const o = osc('sine', 110)
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
        every(8, 18, 'clink')
        break
      }
      case 'campus':
        hum(300, 0.1)
        air(0.012)
        murmur(0.006)
        every(4, 11, 'bird')
        every(15, 30, 'bike')
        break
      case 'city':
        hum(400, 0.2)
        air(0.014)
        every(12, 26, 'bike')
        break
      case 'citynight':
        hum(260, 0.2)
        murmur(0.008)
        air(0.006)
        break
      case 'park':
        wind(0.025)
        air(0.01)
        every(1.5, 5, 'bird')
        break
      case 'hall':
        hum(180, 0.06)
        murmur(0.006)
        every(8, 18, 'steps')
        break
      default:
        // a quiet room
        hum(200, 0.05)
    }
    return {
      gain: out,
      stop() {
        for (const id of timers) clearTimeout(id)
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
      bar = 0
      nextBar = ctx.currentTime + 0.1
      if (file) file.play().catch(() => {})
      schedule()
      timer = setInterval(schedule, 400)
      if (!muted) fadeMaster(0.9, 2.5)
    },
    /** The place: its music and its sound. A scene name, or null for the theme. */
    setPlace(scene) {
      const [m, amb] = scene ? PLACES[scene] || ['theme', 'campus'] : ['theme', null]
      setMood(m)
      if (!ctx) return
      crossfadeTo(amb)
      // the music sits back in a loud place
      musicBus.gain.setTargetAtTime(amb === 'party' ? 0.32 : 0.5, ctx.currentTime, 1.2)
    },
    /** A soft detent as the carousel turns one card (dir: 1 forward, -1 back). */
    tick(dir = 1) {
      if (!ctx || !running || muted) return
      const t = ctx.currentTime
      if (t - lastTick < 0.05) return
      lastTick = t
      // the click: a short wooden knock
      const s = ctx.createBufferSource()
      s.buffer = white
      const bp = filter('bandpass', dir > 0 ? 2300 : 1900, 3)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.09, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045)
      s.connect(bp).connect(g).connect(fxBus)
      s.start(t, Math.random() * 3)
      s.stop(t + 0.06)
      const o = osc('sine', dir > 0 ? 190 : 165)
      const og = ctx.createGain()
      og.gain.setValueAtTime(0.07, t)
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      o.connect(og).connect(fxBus)
      o.start(t)
      o.stop(t + 0.1)
      // and the air the card moves through
      const w = ctx.createBufferSource()
      w.buffer = white
      const wf = filter('bandpass', 500, 1.2)
      wf.frequency.setValueAtTime(450, t)
      wf.frequency.exponentialRampToValueAtTime(1400, t + 0.22)
      const wg = ctx.createGain()
      wg.gain.setValueAtTime(0, t)
      wg.gain.linearRampToValueAtTime(0.035, t + 0.06)
      wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      const p = panner(dir > 0 ? 0.35 : -0.35)
      w.connect(wf).connect(wg).connect(p).connect(fxBus)
      w.start(t, Math.random() * 3)
      w.stop(t + 0.32)
    },
    /**
     * The wind taking a photo, sweeping across the stereo field the way the
     * photo goes. big: the camera flying on to another place — longer, deeper.
     */
    whoosh(dir = 1, big = false) {
      if (!ctx || !running || muted) return
      const t = ctx.currentTime + 0.02
      const len = big ? 1.7 : 0.95
      const s = ctx.createBufferSource()
      s.buffer = white
      const bp = filter('bandpass', 300, big ? 0.9 : 1.3)
      bp.frequency.setValueAtTime(big ? 180 : 320, t)
      bp.frequency.exponentialRampToValueAtTime(big ? 1600 : 2600, t + len * 0.45)
      bp.frequency.exponentialRampToValueAtTime(big ? 260 : 700, t + len)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(big ? 0.22 : 0.16, t + len * 0.4)
      g.gain.exponentialRampToValueAtTime(0.0001, t + len)
      const p = panner(0)
      if (p.pan) {
        p.pan.setValueAtTime(dir * 0.5, t)
        p.pan.linearRampToValueAtTime(-dir * 0.8, t + len)
      }
      s.connect(bp).connect(g).connect(p).connect(fxBus)
      g.connect(reverb)
      s.start(t, Math.random() * 2)
      s.stop(t + len + 0.05)
      // the rush of air under it
      const r = ctx.createBufferSource()
      r.buffer = brown
      const lp = filter('lowpass', big ? 380 : 260)
      const rg = ctx.createGain()
      rg.gain.setValueAtTime(0, t)
      rg.gain.linearRampToValueAtTime(big ? 0.5 : 0.28, t + len * 0.35)
      rg.gain.exponentialRampToValueAtTime(0.0001, t + len * 1.1)
      r.connect(lp).connect(rg).connect(fxBus)
      r.start(t, Math.random() * 2)
      r.stop(t + len * 1.1 + 0.05)
      // and the paper fluttering as it goes
      if (!big) {
        const f = ctx.createBufferSource()
        f.buffer = white
        const hp = filter('bandpass', 3800, 2)
        const fg = ctx.createGain()
        fg.gain.value = 0
        const am = osc('square', 22)
        const amg = ctx.createGain()
        amg.gain.value = 0.02
        am.connect(amg).connect(fg.gain)
        const env = ctx.createGain()
        env.gain.setValueAtTime(0, t)
        env.gain.linearRampToValueAtTime(1, t + 0.12)
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
        f.connect(hp).connect(fg).connect(env).connect(p)
        f.start(t, Math.random() * 2)
        f.stop(t + 0.65)
        am.start(t)
        am.stop(t + 0.65)
      }
    },
    /** A camera's shutter, quiet and close, `delay` seconds from now. */
    shutter(delay = 1) {
      if (!ctx || !running || muted) return
      const t0 = ctx.currentTime + delay
      // mirror up, then the curtain closing
      for (const [at, f, lvl] of [[0, 2600, 0.11], [0.075, 1700, 0.08]]) {
        const t = t0 + at
        const s = ctx.createBufferSource()
        s.buffer = white
        const bp = filter('bandpass', f, 1.8)
        const g = ctx.createGain()
        g.gain.setValueAtTime(lvl, t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035)
        s.connect(bp).connect(g).connect(fxBus)
        s.start(t, Math.random() * 3)
        s.stop(t + 0.05)
        const o = osc('sine', at ? 140 : 210)
        const og = ctx.createGain()
        og.gain.setValueAtTime(lvl * 0.5, t)
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
        o.connect(og).connect(fxBus)
        o.start(t)
        o.stop(t + 0.06)
      }
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
        for (const b of bars) b.gain.disconnect()
        bars = []
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
