import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { galleries, galleryBySlug } from '../data/galleries.js'
import { DURATION, SPRING, STAGGER, project } from '../motion.js'
import Reveal from '../components/Reveal.jsx'
import MaskLine from '../components/MaskLine.jsx'
import '../styles/gallery-page.css'

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/** How far a photo travels sideways when stepping to the next one, px. */
const STEP_SHIFT = 120

/**
 * Stepping between photos: the new one arrives from the side you swiped
 * toward and the old one leaves the other way — the same path in both
 * directions. Reduced motion keeps only the cross-fade.
 */
const slide = {
  enter: ({ dir, reduced }) => ({ x: reduced ? 0 : dir * STEP_SHIFT, opacity: 0 }),
  center: { x: 0, y: 0, opacity: 1 },
  exit: ({ dir, reduced }) => ({ x: reduced ? 0 : -dir * STEP_SHIFT, opacity: 0 }),
}

function Lightbox({ photos, index, dir, origin, onClose, onStep }) {
  const reduced = useReducedMotion()

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
  const custom = { dir, reduced }

  // Judge a swipe by where it was heading, not where the finger let go:
  // a short fast flick counts, a long slow drag that hesitates may not.
  function onDragEnd(_, { offset, velocity }) {
    const x = offset.x + project(velocity.x)
    const y = offset.y + project(velocity.y)
    if (Math.abs(x) > Math.abs(y)) {
      const threshold = window.innerWidth * 0.2
      if (x < -threshold) onStep(1)
      else if (x > threshold) onStep(-1)
    } else if (y > window.innerHeight * 0.18) {
      onClose()
    }
    // Anything short of that springs home, carrying the release velocity.
  }

  return (
    <motion.div
      className="lb"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.fade, ease: 'easeOut' }}
      onClick={onClose}
    >
      {/* Grows out of the photo that was tapped and shrinks back into the
          one being viewed, so the reader never loses their place. */}
      <motion.div
        className="lb__frame"
        style={{ originX: origin.x, originY: origin.y }}
        initial={reduced ? false : { transform: 'scale(0.9)' }}
        animate={{ transform: 'scale(1)' }}
        exit={reduced ? undefined : { transform: 'scale(0.9)' }}
        transition={SPRING}
      >
        <button
          className="lb__close"
          aria-label="Close"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
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

        <div className="lb__stage">
          <AnimatePresence initial={false} custom={custom} mode="popLayout">
            <motion.img
              key={index}
              className="lb__img"
              src={photo.src}
              alt={photo.alt || ''}
              draggable={false}
              custom={custom}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={SPRING}
              // Swipe sideways for the next photo, down to close. Tracks the
              // finger 1:1, picks an axis after the first few pixels, and
              // springs home from wherever it is released.
              drag
              dragDirectionLock
              dragSnapToOrigin
              onDragEnd={onDragEnd}
              onClick={(e) => e.stopPropagation()}
            />
          </AnimatePresence>
        </div>

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
    </motion.div>
  )
}

export default function GalleryPage() {
  const { slug } = useParams()
  const gallery = galleryBySlug(slug)
  const [active, setActive] = useState(null)
  const [dir, setDir] = useState(1)

  // Where the lightbox grows from and shrinks back to, as a fraction of the
  // viewport. Motion values, so a closing lightbox reads the latest point.
  const originX = useMotionValue(0.5)
  const originY = useMotionValue(0.5)

  const aimAt = useCallback(
    (el) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      const clamp = (v) => Math.min(0.95, Math.max(0.05, v))
      originX.set(clamp((r.left + r.width / 2) / window.innerWidth))
      originY.set(clamp((r.top + r.height / 2) / window.innerHeight))
    },
    [originX, originY]
  )

  const step = useCallback(
    (d) => {
      setDir(d)
      setActive((i) => {
        if (i === null || !gallery) return i
        const n = gallery.photos.length
        return (i + d + n) % n
      })
    },
    [gallery]
  )

  function open(i, el) {
    aimAt(el)
    setDir(1)
    setActive(i)
  }

  // Shrink back toward the photo being viewed — after a few swipes that is
  // no longer the one that was tapped.
  const close = useCallback(() => {
    if (active !== null) aimAt(document.querySelector(`.gp__cell[data-index="${active}"]`))
    setActive(null)
  }, [active, aimAt])

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
              data-index={i}
              delay={Math.min(i, 6) * STAGGER}
              onClick={(e) => open(i, e.currentTarget)}
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

      <AnimatePresence>
        {active !== null && (
          <Lightbox
            key="lightbox"
            photos={photos}
            index={active}
            dir={dir}
            origin={{ x: originX, y: originY }}
            onClose={close}
            onStep={step}
          />
        )}
      </AnimatePresence>
    </main>
  )
}
