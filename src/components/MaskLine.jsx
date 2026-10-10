import { useRef } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { DURATION, EASE } from '../motion.js'

/**
 * A single line of display type sliding up out of a clipping mask.
 *
 * One line per <MaskLine> — that is deliberate. A two-line string inside one
 * mask gets its descenders clipped, and separate masks let the lines stagger.
 *
 * The visibility check watches the *wrapper*, not the sliding text. In its
 * start position the text is translated a full line-height down and can sit
 * below the fold — if the observer watched the text itself, an above-the-fold
 * line would never register as "in view" and would never animate up.
 */
export default function MaskLine({ children, delay = 0, className = '' }) {
  const reduced = useReducedMotion()
  const ref = useRef(null)
  const inView = useInView(ref, {
    once: true,
    amount: 0.2,
    margin: '0px 0px -8% 0px',
  })

  return (
    <span className="mask-line" ref={ref}>
      <motion.span
        style={{ display: 'block', paddingBottom: '0.07em' }}
        className={className}
        initial={reduced ? false : { transform: 'translateY(120%)' }}
        animate={
          reduced ? undefined : { transform: inView ? 'translateY(0%)' : 'translateY(120%)' }
        }
        transition={{ duration: DURATION.mask, delay, ease: EASE }}
      >
        {children}
      </motion.span>
    </span>
  )
}
