import { motion, useReducedMotion } from 'framer-motion'

/**
 * Fade-and-rise as the element enters the viewport.
 *
 * <Reveal delay={0.1}>…</Reveal>
 *
 * This is the workhorse for adding animation to anything new: wrap it and
 * you are done. Honours the reader's reduced-motion setting.
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
      initial={reduced ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.95, delay, ease: [0.16, 1, 0.3, 1] }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
