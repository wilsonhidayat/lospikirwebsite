import { motion } from 'framer-motion'
import { site } from '../data/site.js'
import { useHideOnScroll } from '../hooks/useHideOnScroll.js'
import '../styles/nav.css'

export default function Nav() {
  const hidden = useHideOnScroll()

  return (
    <motion.nav
      className="nav"
      initial={{ y: -120, opacity: 0, x: '-50%' }}
      animate={{ y: hidden ? -140 : 0, opacity: hidden ? 0 : 1, x: '-50%' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <a href="#top" aria-label={`${site.name} — home`}>
        <img className="nav__logo" src="/logo-bone.png" alt={site.name} />
      </a>

      <div className="nav__links label">
        {site.nav.map((item) => (
          <a key={item.label} href={item.href}>
            {item.label}
          </a>
        ))}
        <a href={site.contact.clientGallery} target="_blank" rel="noreferrer">
          Client Gallery
        </a>
      </div>

      <a className="nav__cta label" href={site.ctaHref}>
        {site.ctaLabel}
      </a>
    </motion.nav>
  )
}
