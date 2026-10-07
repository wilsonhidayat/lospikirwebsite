import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'

/**
 * A photograph, or the placeholder gradient standing in for one.
 *
 * The inner fill is inset by 16% top and bottom, and drifts within that
 * overscan as the block crosses the screen — so the edge never shows.
 */
export default function Photo({
  tone = 'dusk',
  image = null,
  caption = null,
  parallax = 0.08,
  className = '',
  style,
}) {
  const ref = useRef(null)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  })

  const drift = Math.min(Math.max(parallax, 0), 0.12) * 100
  const y = useTransform(scrollYProgress, [0, 1], [`-${drift}%`, `${drift}%`])

  // Static fills (gallery covers, reduced motion) are not bound to scroll at
  // all and don't get a compositor layer they would never use.
  const moving = !reduced && drift > 0

  return (
    <div ref={ref} className={`photo ${className}`} style={style}>
      <motion.span
        className={`photo__fill${moving ? ' photo__fill--moving' : ''}${image ? '' : ` tone-${tone}`}`}
        style={{
          y: moving ? y : 0,
          backgroundImage: image ? `url(${image})` : undefined,
        }}
      />
      {caption && !image && <span className="photo__caption">{caption}</span>}
    </div>
  )
}
