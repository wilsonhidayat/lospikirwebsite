import { site } from '../data/site.js'
import { lines } from '../lib/lines.js'
import MaskLine from './MaskLine.jsx'
import Reveal from './Reveal.jsx'
import Photo from './Photo.jsx'
import '../styles/closing.css'

export default function Closing() {
  return (
    <section className="closing">
      <Photo
        tone="warm"
        caption="Closing photograph"
        parallax={0.1}
        style={{ position: 'absolute', inset: 0, borderRadius: 0 }}
      />
      <div className="closing__scrim" />

      <div className="closing__inner">
        <h2 className="display closing__title">
          {lines(site.closing.headline).map((line, i) => (
            <MaskLine key={line} delay={i * 0.07}>
              {line}
            </MaskLine>
          ))}
        </h2>

        <Reveal className="closing__actions" delay={0.2}>
          <a className="btn" href={site.ctaHref}>
            {site.ctaLabel}
          </a>
          {site.brochureHref && (
            <a className="btn btn--ghost" href={site.brochureHref} download>
              {site.brochureLabel}
            </a>
          )}
        </Reveal>
      </div>
    </section>
  )
}
