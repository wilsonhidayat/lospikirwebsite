import { useState } from 'react'
import { useMotionValueEvent, useScroll } from 'framer-motion'

/**
 * True once the page is scrolling down past `threshold`, false again as soon
 * as the reader scrolls back up. Used to slide the nav out of the way so
 * nothing sits over the photographs while you are reading them.
 */
export function useHideOnScroll(threshold = 140) {
  const { scrollY } = useScroll()
  const [hidden, setHidden] = useState(false)

  useMotionValueEvent(scrollY, 'change', (y) => {
    const previous = scrollY.getPrevious() ?? 0
    if (y > threshold && y > previous + 4) setHidden(true)
    else if (y < previous - 4 || y < threshold) setHidden(false)
  })

  return hidden
}
