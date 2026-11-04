import { Link } from 'react-router-dom'
import { site } from '../data/site.js'
import '../styles/about-page.css'

/**
 * Privacy statement. Written to match what the site actually does: no
 * cookies, no ad trackers, an enquiry form processed by Netlify, and —
 * only if VITE_PLAUSIBLE_DOMAIN is set at build time — cookie-free visitor
 * statistics from Plausible.
 *
 * Not legal advice: have it checked before relying on it.
 */
const analytics = Boolean(import.meta.env.VITE_PLAUSIBLE_DOMAIN)

export default function PrivacyPage() {
  return (
    <main className="about">
      <header className="about__head">
        <p className="label about__eyebrow">Privacy</p>
        <h1 className="display about__title">How this site handles your data</h1>
      </header>

      <div className="about__grid">
        <div className="about__text privacy">
          <p className="about__lead">
            Short version: no cookies, no advertising trackers, and your details are only used to answer your enquiry.
          </p>

          <h2>Who is responsible</h2>
          <p>
            {site.name} is run by {site.photographer}, registered with the Dutch Chamber of Commerce (KVK {site.kvk}).
            For anything about your data, email <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>.
          </p>

          <h2>The enquiry form</h2>
          <p>
            When you send an enquiry, the details you type (your name, email address, the kind of session, a date,
            a location and your message) are delivered to me through Netlify Forms, the service that hosts this site.
            I use them only to reply to you and, if we work together, to plan the shoot. I keep enquiries for as long
            as needed for that and for my bookkeeping obligations, and delete them on request.
          </p>

          <h2>Cookies</h2>
          <p>
            This site sets no cookies and does not use advertising or cross-site tracking, so there is nothing to
            accept or decline.
          </p>

          <h2>Visitor statistics</h2>
          {analytics ? (
            <p>
              I count visits with Plausible Analytics, which works without cookies and without collecting personal
              data: it records which pages are viewed, where visitors come from and their country, in aggregate.
              No individual visitor can be identified or followed across sites.
            </p>
          ) : (
            <p>This site does not currently collect visitor statistics.</p>
          )}

          <h2>Hosting</h2>
          <p>
            The site is hosted by Netlify, which, like any web host, processes technical data such as IP addresses
            to deliver pages and protect against abuse.
          </p>

          <h2>Your rights</h2>
          <p>
            Under the GDPR (AVG) you can ask to see, correct or delete the personal data I hold about you, or object
            to how it is used. Email me and I will respond within a month. You can also complain to the Dutch Data
            Protection Authority (Autoriteit Persoonsgegevens).
          </p>

          <p className="label privacy__updated">Last updated: November 2026</p>
          <p>
            <Link className="label" to="/">
              ← Back to the site
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
