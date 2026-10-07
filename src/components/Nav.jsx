import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { site } from '../data/site.js'
import { useHideOnScroll } from '../hooks/useHideOnScroll.js'
import { DURATION, SPRING } from '../motion.js'
import '../styles/nav.css'

/**
 * A nav entry. "#work" becomes a router link to "/#work" so it also works
 * from a gallery sub-page (App's ScrollManager does the scrolling). Anything
 * else — the brochure PDF, external links — stays a plain anchor.
 */
function NavLink({ href, className, children }) {
  const isHash = href.startsWith('#')
  // an in-app route: "/about", "/#work" — but not a file like "/brochure/x.pdf"
  const isRoute = isHash || (href.startsWith('/') && !/\.[a-z0-9]+$/i.test(href))
  if (isRoute) {
    return (
      <Link to={isHash ? `/${href}` : href} className={className}>
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

// Centred with left:50% in CSS; the -50% lives in the transform.
const SHOWN = 'translate(-50%, 0px)'
const HIDDEN = 'translate(-50%, -140px)'

export default function Nav() {
  const hidden = useHideOnScroll()
  const reduced = useReducedMotion()

  // Reduced motion: no sliding, only a short fade.
  const transform = reduced ? SHOWN : hidden ? HIDDEN : SHOWN

  return (
    <motion.nav
      className="nav"
      initial={{ opacity: 0, transform: reduced ? SHOWN : 'translate(-50%, -120px)' }}
      animate={{ opacity: hidden ? 0 : 1, transform }}
      // A spring, because the reader reverses this constantly just by
      // changing scroll direction. It picks up from wherever the bar is and
      // carries its velocity, so a quick down-up-down never feels mushy.
      transition={reduced ? { duration: DURATION.fade } : SPRING}
      // Invisible still means clickable unless we say otherwise.
      style={{ pointerEvents: hidden ? 'none' : 'auto' }}
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
