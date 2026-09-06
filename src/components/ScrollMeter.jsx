import { useState } from 'react'
import { useMotionValueEvent, useScroll } from 'framer-motion'
import '../styles/meter.css'

const TICKS = 18

export default function ScrollMeter() {
  const { scrollYProgress } = useScroll()
  const [progress, setProgress] = useState(0)

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    const next = Math.round(value * 100)
    setProgress((current) => (current === next ? current : next))
  })

  const lit = (progress / 100) * TICKS

  return (
    <div className="meter" aria-hidden="true">
      <span className="meter__label">Scroll</span>

      <div className="meter__ticks">
        {Array.from({ length: TICKS }, (_, i) => {
          const on = i < Math.floor(lit)
          const edge = !on && i === Math.floor(lit)
          return (
            <span
              key={i}
              className={
                'meter__tick' +
                (on ? ' meter__tick--on' : '') +
                (edge ? ' meter__tick--edge' : '')
              }
            />
          )
        })}
      </div>

      <b className="meter__value">{String(progress).padStart(3, '0')}</b>
    </div>
  )
}
