/**
 * The choreography, as a pure function of scroll progress.
 *
 * The experience is an intro followed by one chapter per project. Each
 * chapter plays the same five beats:
 *
 *   body     the camera turns to face you in the dark
 *   lens     you move toward the lens, and through it you see the place
 *   flight   you're inside: a flight through the place to where the shot was taken
 *   shutter  the shutter fires
 *   photo    the place becomes the photograph
 *
 * Everything is derived from progress alone — no state, no timers — so
 * scrolling backwards plays it all in reverse, and the user can stop anywhere.
 */
import { span, clamp01 } from './utils.js'

export const INTRO = 1.1 // screens of scrolling for the intro
export const CHAPTER = 3.2 // screens of scrolling per project

export const BEAT = {
  bodyEnd: 0.16,
  lensEnd: 0.36,
  flightEnd: 0.78,
  shutter: 0.79,
  photoIn: 0.81,
  photoFull: 0.87,
  fadeOut: 0.955,
}

/** How many viewport heights the whole experience scrolls through. */
export function totalScreens(chapters) {
  return INTRO + chapters * CHAPTER
}

/**
 * @param {number} p overall progress 0..1
 * @param {number} n number of chapters
 */
export function timeline(p, n) {
  const total = totalScreens(n)
  const u = clamp01(p) * total
  if (u < INTRO || n === 0) {
    const t = n === 0 ? 1 : u / INTRO
    return {
      chapter: 0,
      t,
      phase: 'intro',
      intro: t,
      mode: 'studio',
      lens: 0,
      flight: 0,
      hud: 0,
      photo: 0,
      black: 1 - span(t, 0, 0.12),
      // the project title only arrives once the intro headline has gone
      caption: span(t, 0.7, 0.92),
    }
  }
  const raw = (u - INTRO) / CHAPTER
  const chapter = Math.min(n - 1, Math.floor(raw))
  const t = clamp01(raw - chapter)
  const lens = span(t, BEAT.bodyEnd, BEAT.lensEnd)
  const phase =
    t < BEAT.bodyEnd ? 'body' : t < BEAT.lensEnd ? 'lens' : t < BEAT.flightEnd ? 'flight' : t < BEAT.photoIn ? 'shutter' : 'photo'

  // fade to black at the end of a chapter; the next one fades back up
  const out = chapter < n - 1 ? span(t, BEAT.fadeOut, 1) : 0
  const inFade = chapter > 0 ? 1 - span(t, 0, 0.04) : 0

  return {
    chapter,
    t,
    phase,
    intro: 1,
    // switch from the studio to the place once the glass fills the screen
    mode: lens >= 0.98 ? 'world' : 'studio',
    lens,
    flight: span(t, BEAT.lensEnd, BEAT.flightEnd),
    hud: span(t, 0.3, 0.38) * (1 - span(t, BEAT.photoFull, BEAT.photoFull + 0.03)),
    photo: span(t, BEAT.photoIn, BEAT.photoFull) * (1 - (chapter < n - 1 ? span(t, BEAT.fadeOut - 0.01, BEAT.fadeOut + 0.03) : 0)),
    black: Math.max(out, inFade),
    caption: 1 - span(t, BEAT.bodyEnd - 0.04, BEAT.bodyEnd + 0.04),
  }
}

/** Scroll position (0..1) at which a given chapter's photo is fully shown. */
export function progressForChapter(i, n, beat = BEAT.photoFull) {
  return (INTRO + (i + beat) * CHAPTER) / totalScreens(n)
}
