/**
 * Motion tokens — the JS half of the system in src/styles/tokens.css.
 * Change a curve or a timing here and in tokens.css together.
 */

/** Strong ease-out. Same curve as --ease in tokens.css. */
export const EASE = [0.16, 1, 0.3, 1]

/** Scroll reveals are editorial, so they are allowed to be slow. UI is not. */
export const DURATION = {
  reveal: 0.95, // <Reveal> fade-and-rise
  mask: 1.1, // <MaskLine> headline slide
  fade: 0.2, // overlays and cross-fades
}

/** Gap between items entering as a group. Decorative — never blocks input. */
export const STAGGER = 0.06

/**
 * Critically damped spring — no overshoot. The default for anything the
 * reader can interrupt or reverse (the nav, the lightbox). Springs start from
 * the element's current on-screen value and carry velocity through a change
 * of target, which a fixed-duration tween cannot.
 */
export const SPRING = { type: 'spring', bounce: 0, duration: 0.4 }

/**
 * Where a flick would come to rest. Apple's projection from "Designing Fluid
 * Interfaces": exponential decay, the same feel as native scroll momentum.
 * velocity in px/s; decelerationRate 0.998 is normal scroll, 0.99 snappier.
 */
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate)
}
