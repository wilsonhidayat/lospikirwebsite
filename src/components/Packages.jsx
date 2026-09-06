import { packages } from '../data/packages.js'
import { lines } from '../lib/lines.js'
import MaskLine from './MaskLine.jsx'
import Reveal from './Reveal.jsx'
import '../styles/packages.css'

function Card({ item, index, delay }) {
  const number = String(index + 1).padStart(2, '0')
  const title = lines(item.title)

  return (
    <Reveal
      as="a"
      className={`card${item.ask ? ' card--ask' : ''}`}
      delay={delay}
      href={item.href}
    >
      {!item.ask && (
        <div className="card__shot">
          <span
            className={item.image ? '' : `tone-${item.tone}`}
            style={item.image ? { backgroundImage: `url(${item.image})` } : undefined}
          />
          {!item.image && <span className="card__caption">{title.join(' ')}</span>}
        </div>
      )}

      <div className="card__body">
        <span className="label card__index">{number}</span>

        <h3 className="display card__title">
          {title.map((line) => (
            <span key={line} style={{ display: 'block' }}>
              {line}
            </span>
          ))}
        </h3>

        <p className="card__text">{item.body}</p>

        <span className="card__go">
          {item.cta} <i className="card__arrow">&rarr;</i>
        </span>
      </div>
    </Reveal>
  )
}

export default function Packages() {
  return (
    <section className="section packages" id="packages">
      <div className="packages__panel">
        <div className="packages__head">
          <MaskLine className="label packages__eyebrow">What I photograph</MaskLine>
          <h2 className="display packages__title">
            <MaskLine delay={0.06}>Ways to</MaskLine>
            <MaskLine delay={0.12}>work together</MaskLine>
          </h2>
        </div>

        <div className="packages__grid">
          {packages.map((item, i) => (
            <Card key={item.id} item={item} index={i} delay={Math.min(i, 4) * 0.09} />
          ))}
        </div>
      </div>
    </section>
  )
}
