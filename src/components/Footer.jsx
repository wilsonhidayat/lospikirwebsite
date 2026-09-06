import { site } from '../data/site.js'
import '../styles/closing.css'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="footer">
      <div className="footer__inner">
        <img className="footer__logo" src="/logo-bone.png" alt={site.name} />

        <div className="footer__links label">
          <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>
          <a href={site.contact.whatsapp} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <a href={site.contact.instagram} target="_blank" rel="noreferrer">
            Instagram
          </a>
          <a href={site.contact.linkedin} target="_blank" rel="noreferrer">
            LinkedIn
          </a>
          <a href={site.contact.clientGallery} target="_blank" rel="noreferrer">
            Client Gallery
          </a>
        </div>

        <div className="footer__legal label">
          © {year} {site.name} — {site.photographer} · KVK {site.kvk}
        </div>
      </div>
    </footer>
  )
}
