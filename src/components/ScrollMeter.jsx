import { useEffect, useRef } from 'react'
import { useMotionValueEvent, useScroll } from 'framer-motion'
import '../styles/meter.css'

const TICKS = 18

/**
 * Scroll position as a tick scale.
 *
 * Writes straight to the DOM instead of going through React state. Scroll
 * fires every frame; routing it through setState re-rendered the whole meter
 * about a hundred times per page, competing with the parallax for the frame.
 */
export default function ScrollMeter() {
  const { scrollYProgress } = useScroll()
  const ticks = useRef([])
  const value = useRef(null)
  const last = useRef(-1)

  function paint(progress) {
    const pct = Math.round(progress * 100)
    if (pct === last.current) return
    last.current = pct

    if (value.current) value.current.textContent = String(pct).padStart(3, '0')

    const lit = Math.floor(progress * TICKS)
    ticks.current.forEach((el, i) => {
      if (!el) return
      el.classList.toggle('meter__tick--on', i < lit)
      el.classList.toggle('meter__tick--edge', i === lit)
    })
  }

  useMotionValueEvent(scrollYProgress, 'change', paint)

  // A reload can land mid-page; paint the starting position once.
  useEffect(() => {
    paint(scrollYProgress.get())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollYProgress])

  return (
    <div className="meter" aria-hidden="true">
      <span className="meter__label">Scroll</span>

      <div className="meter__ticks">
        {Array.from({ length: TICKS }, (_, i) => (
          <span
            key={i}
            className="meter__tick"
            ref={(el) => {
              ticks.current[i] = el
            }}
          />
        ))}
      </div>

      <b className="meter__value" ref={value}>
        000
      </b>
    </div>
  )
}
