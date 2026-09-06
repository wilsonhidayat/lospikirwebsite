import { Link } from 'react-router-dom'
import { site } from '../data/site.js'
import { lines } from '../lib/lines.js'
import MaskLine from '../components/MaskLine.jsx'
import Reveal from '../components/Reveal.jsx'
import '../styles/about-page.css'

export default function AboutPage() {
  const about = site.about ?? {}
  const headline = lines(about.headline)
  const paragraphs = String(about.body ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <main className="about">
      <header className="about__head">
        {about.eyebrow && (
          <MaskLine className="label about__eyebrow">{about.eyebrow}</MaskLine>
        )}
        <h1 className="display about__title">
          {headline.map((line, i) => (
            <MaskLine key={line} delay={0.06 * (i + 1)}>
              {line}
            </MaskLine>
          ))}
        </h1>
      </header>

      <div className="about__grid">
        {about.portrait && (
          <Reveal className="about__portrait">
            <img src={about.portrait} alt={site.photographer} />
          </Reveal>
        )}

        <div className="about__text">
          {about.lead && (
            <Reveal as="p" className="about__lead">
              {about.lead}
            </Reveal>
          )}

          {paragraphs.map((p, i) => (
            <Reveal as="p" className="about__para" key={i} delay={0.06 + i * 0.05}>
              {p}
            </Reveal>
          ))}

          {about.meta && (
            <Reveal as="p" className="about__meta label" delay={0.1}>
              {about.meta}
            </Reveal>
          )}

          <Reveal className="about__links label" delay={0.14}>
            <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>
            {site.contact.instagram && (
              <a href={site.contact.instagram} target="_blank" rel="noreferrer">
                Instagram
              </a>
            )}
            {site.contact.whatsapp && (
              <a href={site.contact.whatsapp} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
            )}
          </Reveal>

          <Reveal className="about__cta" delay={0.18}>
            <Link className="btn" to="/#enquire">
              {site.ctaLabel}
            </Link>
            <Link className="btn btn--ghost" to="/#work">
              See the work
            </Link>
          </Reveal>
        </div>
      </div>
    </main>
  )
}
