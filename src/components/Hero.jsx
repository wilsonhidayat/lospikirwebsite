import { site } from '../data/site.js'
import { lines } from '../lib/lines.js'
import MaskLine from './MaskLine.jsx'
import Reveal from './Reveal.jsx'
import Photo from './Photo.jsx'
import '../styles/hero.css'

export default function Hero() {
  const { eyebrow, headlineLight } = site.hero
  const headline = lines(site.hero.headline)

  return (
    <section className="hero" id="top">
      <Photo
        tone="dusk"
        image={site.hero.image}
        caption="Hero photograph"
        parallax={0.1}
        className="hero__photo"
        style={{ position: 'absolute', inset: 0, borderRadius: 0 }}
      />
      <div className="hero__scrim" />

      <div className="hero__inner">
        <Reveal y={0}>
          <div className="hero__bar" />
        </Reveal>

        <MaskLine className="label hero__eyebrow" delay={0.05}>
          {eyebrow}
        </MaskLine>

        <h1 className="display hero__title">
          {headline.map((line, i) => (
            <MaskLine key={line} delay={0.1 + i * 0.07}>
              {line}
            </MaskLine>
          ))}
          <MaskLine delay={0.1 + headline.length * 0.07}>
            <span className="display--light">{headlineLight}</span>
          </MaskLine>
        </h1>

        <Reveal className="hero__actions" delay={0.35}>
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

      <div className="hero__cue" />
    </section>
  )
}
