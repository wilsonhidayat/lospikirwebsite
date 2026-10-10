import { useRef, useState } from 'react'
import { useMotionValueEvent, useScroll } from 'framer-motion'

/**
 * True once the page is scrolling down past `threshold`, false again as soon
 * as the reader scrolls back up. Used to slide the nav out of the way so
 * nothing sits over the photographs while you are reading them.
 *
 * Only calls setState when the answer actually flips, so the nav re-renders
 * a handful of times per visit rather than being asked on every scroll frame.
 */
export function useHideOnScroll(threshold = 140) {
  const { scrollY } = useScroll()
  const [hidden, setHidden] = useState(false)
  const current = useRef(false)

  useMotionValueEvent(scrollY, 'change', (y) => {
    const previous = scrollY.getPrevious() ?? 0
    let next = current.current
    if (y > threshold && y > previous + 4) next = true
    else if (y < previous - 4 || y < threshold) next = false
    if (next !== current.current) {
      current.current = next
      setHidden(next)
    }
  })

  return hidden
}
