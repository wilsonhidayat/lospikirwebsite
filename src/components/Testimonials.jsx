import { testimonials } from '../data/testimonials.js'
import MaskLine from './MaskLine.jsx'
import Reveal from './Reveal.jsx'
import '../styles/testimonials.css'

export default function Testimonials() {
  if (!testimonials.length) return null

  return (
    <section className="section testimonials" id="words">
      <div className="wrap">
        <MaskLine className="label testimonials__eyebrow">In their words</MaskLine>

        <div className="testimonials__list">
          {testimonials.map((item, i) => (
            <Reveal
              as="figure"
              className="quote"
              key={`${item.name}-${i}`}
              delay={Math.min(i, 3) * 0.08}
            >
              <blockquote className="quote__text">{item.quote}</blockquote>
              <figcaption className="quote__by label">
                <span className="quote__name">{item.name}</span>
                {item.context && <span className="quote__context">{item.context}</span>}
              </figcaption>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
