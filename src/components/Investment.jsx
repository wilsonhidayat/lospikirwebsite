import { packages } from '../data/packages.js'
import { site } from '../data/site.js'
import { lines } from '../lib/lines.js'
import MaskLine from './MaskLine.jsx'
import Reveal from './Reveal.jsx'
import '../styles/investment.css'

export default function Investment() {
  const { eyebrow, body } = site.investment
  const headline = lines(site.investment.headline)

  return (
    <section className="section investment" id="investment">
      <div className="wrap">
        <MaskLine className="label investment__eyebrow">{eyebrow}</MaskLine>

        <h2 className="display investment__title">
          {headline.map((line, i) => (
            <MaskLine key={line} delay={0.06 * (i + 1)}>
              {line}
            </MaskLine>
          ))}
        </h2>

        <Reveal as="p" className="investment__body" delay={0.1}>
          {body}
        </Reveal>

        <Reveal className="investment__actions" delay={0.18}>
          <a className="btn btn--pill" href={site.brochureHref} download>
            {site.brochureLabel}
          </a>
          <a
            className="btn btn--ghost btn--pill"
            href={site.contact.whatsapp}
            target="_blank"
            rel="noreferrer"
          >
            Message on WhatsApp
          </a>
        </Reveal>

        <div className="investment__rows">
          {packages.map((item, i) => (
            <Reveal
              as="a"
              className="row"
              key={item.id}
              href={item.href}
              delay={Math.min(i, 4) * 0.08}
            >
              <span className="label row__index">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="display row__title">{lines(item.title).join(' ')}</h3>
              <p className="row__specs">{item.specs}</p>
              <span className="label row__go">{item.cta} &rarr;</span>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
