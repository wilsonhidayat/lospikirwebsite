import { motion, useReducedMotion } from 'framer-motion'
import { DURATION, EASE } from '../motion.js'

/**
 * Fade-and-rise as the element enters the viewport.
 *
 * <Reveal delay={0.1}>…</Reveal>
 *
 * This is the workhorse for adding animation to anything new: wrap it and
 * you are done. Honours the reader's reduced-motion setting.
 *
 * Animates a full `transform` string rather than Framer's `y` shorthand, so
 * the browser can hand it to the compositor. Note it leaves `transform`
 * written inline on the element — any CSS hover or press effect on the same
 * element must use the individual `translate` / `scale` properties instead.
 */
export default function Reveal({
  children,
  delay = 0,
  y = 26,
  className = '',
  as = 'div',
  ...rest
}) {
  const reduced = useReducedMotion()
  const Tag = motion[as] ?? motion.div

  return (
    <Tag
      className={className}
      initial={reduced ? false : { opacity: 0, transform: `translateY(${y}px)` }}
      whileInView={{ opacity: 1, transform: 'translateY(0px)' }}
      viewport={{ once: true, amount: 0.15, margin: '0px 0px -10% 0px' }}
      transition={{ duration: DURATION.reveal, delay, ease: EASE }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
