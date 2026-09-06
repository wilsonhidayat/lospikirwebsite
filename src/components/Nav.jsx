import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { site } from '../data/site.js'
import { useHideOnScroll } from '../hooks/useHideOnScroll.js'
import '../styles/nav.css'

/**
 * A nav entry. "#work" becomes a router link to "/#work" so it also works
 * from a gallery sub-page (App's ScrollManager does the scrolling). Anything
 * else — the brochure PDF, external links — stays a plain anchor.
 */
function NavLink({ href, className, children }) {
  if (href.startsWith('#')) {
    return (
      <Link to={`/${href}`} className={className}>
        {children}
      </Link>
    )
  }
  const external = /^https?:/.test(href)
  return (
    <a
      href={href}
      className={className}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {children}
    </a>
  )
}

export default function Nav() {
  const hidden = useHideOnScroll()

  return (
    <motion.nav
      className="nav"
      initial={{ y: -120, opacity: 0, x: '-50%' }}
      animate={{ y: hidden ? -140 : 0, opacity: hidden ? 0 : 1, x: '-50%' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link to="/" aria-label={`${site.name} — home`}>
        <img className="nav__logo" src="/logo-bone.png" alt={site.name} />
      </Link>

      <div className="nav__links label">
        {site.nav.map((item) => (
          <NavLink key={item.label} href={item.href}>
            {item.label}
          </NavLink>
        ))}
        <a href={site.contact.clientGallery} target="_blank" rel="noreferrer">
          Client Gallery
        </a>
      </div>

      <NavLink href={site.ctaHref} className="nav__cta label">
        {site.ctaLabel}
      </NavLink>
    </motion.nav>
  )
}
