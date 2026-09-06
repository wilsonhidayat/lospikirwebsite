import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { site } from '../data/site.js'
import '../styles/statement.css'

function Word({ children, progress, start, end }) {
  const opacity = useTransform(progress, [start, end], [0.2, 1])
  return (
    <motion.span className="statement__word" style={{ opacity }}>
      {children}&nbsp;
    </motion.span>
  )
}

export default function Statement() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.85', 'end 0.45'],
  })

  const words = site.statement.split(' ')

  return (
    <section className="section" id="about">
      <p className="statement wrap" ref={ref}>
        {words.map((word, i) => {
          const start = (i / words.length) * 0.85
          return (
            <Word
              key={`${word}-${i}`}
              progress={scrollYProgress}
              start={start}
              end={start + 0.15}
            >
              {word}
            </Word>
          )
        })}
      </p>
    </section>
  )
}
