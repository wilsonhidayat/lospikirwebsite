import { useState } from 'react'
import { site } from '../data/site.js'
import { packages } from '../data/packages.js'
import { lines } from '../lib/lines.js'
import MaskLine from './MaskLine.jsx'
import Reveal from './Reveal.jsx'
import '../styles/enquire.css'

const FORM_NAME = 'enquiry'

function encode(data) {
  return Object.keys(data)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(data[k])}`)
    .join('&')
}

export default function Enquire() {
  const { eyebrow, body, success } = site.enquire
  const headline = lines(site.enquire.headline)
  const [status, setStatus] = useState('idle') // idle | sending | done | error

  async function handleSubmit(event) {
    event.preventDefault()
    const form = event.target
    const data = Object.fromEntries(new FormData(form).entries())

    if (data['bot-field']) return // honeypot tripped

    setStatus('sending')
    try {
      const response = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encode({ 'form-name': FORM_NAME, ...data }),
      })
      setStatus(response.ok ? 'done' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="section enquire" id="enquire">
      <div className="wrap enquire__grid">
        <div className="enquire__intro">
          <MaskLine className="label enquire__eyebrow">{eyebrow}</MaskLine>
          <h2 className="display enquire__title">
            {headline.map((line, i) => (
              <MaskLine key={line} delay={0.06 * (i + 1)}>
                {line}
              </MaskLine>
            ))}
          </h2>
          <Reveal as="p" className="enquire__body" delay={0.1}>
            {body}
          </Reveal>
          <Reveal className="enquire__alt label" delay={0.16}>
            <span>Prefer to write directly?</span>
            <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>
            <a href={site.contact.whatsapp} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          </Reveal>
        </div>

        <Reveal className="enquire__formwrap" delay={0.12}>
          {status === 'done' ? (
            <p className="enquire__success" role="status">
              {success}
            </p>
          ) : (
            <form
              className="enquire__form"
              name={FORM_NAME}
              method="POST"
              data-netlify="true"
              netlify-honeypot="bot-field"
              onSubmit={handleSubmit}
            >
              <input type="hidden" name="form-name" value={FORM_NAME} />
              <p className="enquire__hp" aria-hidden="true">
                <label>
                  Leave this field empty
                  <input name="bot-field" tabIndex={-1} autoComplete="off" />
                </label>
              </p>

              <label className="field">
                <span className="field__label label">Name</span>
                <input className="field__input" type="text" name="name" required />
              </label>

              <label className="field">
                <span className="field__label label">Email</span>
                <input className="field__input" type="email" name="email" required />
              </label>

              <label className="field">
                <span className="field__label label">Session</span>
                <select className="field__input" name="session" defaultValue="">
                  <option value="" disabled>
                    Choose one
                  </option>
                  {packages.map((p) => {
                    const name = lines(p.title).join(' ')
                    return (
                      <option key={p.id} value={name}>
                        {name}
                      </option>
                    )
                  })}
                </select>
              </label>

              <div className="field field--split">
                <label className="field">
                  <span className="field__label label">Date (rough is fine)</span>
                  <input className="field__input" type="text" name="date" placeholder="e.g. late May" />
                </label>
                <label className="field">
                  <span className="field__label label">Location</span>
                  <input className="field__input" type="text" name="location" placeholder="City or area" />
                </label>
              </div>

              <label className="field">
                <span className="field__label label">Anything else</span>
                <textarea className="field__input" name="message" rows={4} />
              </label>

              <button className="btn enquire__submit" type="submit" disabled={status === 'sending'}>
                {status === 'sending' ? 'Sending…' : 'Send enquiry'}
              </button>

              {status === 'error' && (
                <p className="enquire__error" role="alert">
                  Something went wrong sending that. Please email {site.contact.email} instead.
                </p>
              )}
            </form>
          )}
        </Reveal>
      </div>
    </section>
  )
}
