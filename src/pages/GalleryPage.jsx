import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { galleries, galleryBySlug } from '../data/galleries.js'
import Reveal from '../components/Reveal.jsx'
import MaskLine from '../components/MaskLine.jsx'
import '../styles/gallery-page.css'

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function Lightbox({ photos, index, onClose, onStep }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onStep(1)
      if (e.key === 'ArrowLeft') onStep(-1)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, onStep])

  const photo = photos[index]

  return (
    <motion.div
      className="lb"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
    >
      <button className="lb__close" aria-label="Close" onClick={onClose}>
        ✕
      </button>
      <button
        className="lb__nav lb__nav--prev"
        aria-label="Previous"
        onClick={(e) => {
          e.stopPropagation()
          onStep(-1)
        }}
      >
        ‹
      </button>
      <img
        className="lb__img"
        src={photo.src}
        alt={photo.alt || ''}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        className="lb__nav lb__nav--next"
        aria-label="Next"
        onClick={(e) => {
          e.stopPropagation()
          onStep(1)
        }}
      >
        ›
      </button>
      <span className="lb__count label">
        {index + 1} / {photos.length}
      </span>
    </motion.div>
  )
}

export default function GalleryPage() {
  const { slug } = useParams()
  const gallery = galleryBySlug(slug)
  const [active, setActive] = useState(null)

  const step = useCallback(
    (dir) => {
      setActive((i) => {
        if (i === null || !gallery) return i
        const n = gallery.photos.length
        return (i + dir + n) % n
      })
    },
    [gallery]
  )

  if (!gallery) {
    return (
      <main className="gp gp--empty">
        <p className="gp__notice">That gallery has moved or doesn’t exist.</p>
        <Link className="gp__back" to="/#work">
          ← All galleries
        </Link>
      </main>
    )
  }

  const { title, caption, date, intro, photos } = gallery
  const others = galleries.filter((g) => g.slug !== gallery.slug).slice(0, 4)

  return (
    <main className="gp">
      <header className="gp__head">
        <Link className="gp__back label" to="/#work">
          ← All galleries
        </Link>

        {title && caption && (
          <MaskLine className="label gp__caption">{caption}</MaskLine>
        )}
        <h1 className="display gp__title">
          <MaskLine>{title || caption || 'Gallery'}</MaskLine>
        </h1>
        {date && <div className="label gp__date">{formatDate(date)}</div>}
        {intro && (
          <Reveal as="p" className="gp__intro" delay={0.1}>
            {intro}
          </Reveal>
        )}
      </header>

      {photos.length > 0 ? (
        <div className="gp__grid">
          {photos.map((photo, i) => (
            <Reveal
              as="button"
              className="gp__cell"
              key={photo.src + i}
              delay={Math.min(i, 6) * 0.05}
              onClick={() => setActive(i)}
            >
              <img src={photo.src} alt={photo.alt || ''} loading="lazy" />
            </Reveal>
          ))}
        </div>
      ) : (
        <p className="gp__notice">Photographs from this session are on their way.</p>
      )}

      {others.length > 0 && (
        <nav className="gp__more">
          <span className="label gp__more-label">More galleries</span>
          <ul className="gp__more-list">
            {others.map((g) => (
              <li key={g.slug}>
                <Link className="label" to={`/gallery/${g.slug}`}>
                  {g.title || g.caption} →
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {active !== null && (
        <Lightbox
          photos={photos}
          index={active}
          onClose={() => setActive(null)}
          onStep={step}
        />
      )}
    </main>
  )
}
