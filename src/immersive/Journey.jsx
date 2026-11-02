import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { immersiveSupported, qualityLevel } from './support.js'
import { SPRING, project } from '../motion.js'
import '../styles/journey.css'

const INTRO_KEY = 'lospikir-intro-seen'
const seenIntro = () => {
  try {
    return sessionStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return true
  }
}
const markIntro = () => {
  try {
    sessionStorage.setItem(INTRO_KEY, '1')
  } catch {
    /* private mode: just show it again next time */
  }
}

/**
 * The tour.
 *
 *  intro    first visit only: an instant print slides out, develops, and
 *           opens up into the landing photo
 *  landing  one of Wilson's photos, full screen: Start exploring / Skip
 *  wall     every project as an instant print hanging on twine — the
 *           memories. Choose one…
 *  place    …the view flies into the print, the photo fills the screen and
 *           develops into the 3D place where it was taken. The photos float
 *           in the middle as prints in the wind; each new photo blows in as
 *           the view moves somewhere new. After the last: "View other
 *           memories", back to the wall.
 *
 * Gallery pages go straight into their own place. Without WebGL (or with
 * reduced motion) the same steps work as flat pages with CSS prints.
 *
 * items: galleries — { slug, title, caption, hero, alt, photos, scene }
 */
export default function Journey({
  items,
  variant = 'home',
  landing = null,
  skip = '/work',
  skipLabel = 'Skip the tour',
  after = '#packages',
}) {
  const reduced = useReducedMotion()
  const home = variant === 'home'
  const sectionRef = useRef(null)
  const glRef = useRef(null)
  const viewerRef = useRef(null)
  const printHitRef = useRef(null)

  const [use3D, setUse3D] = useState(() => immersiveSupported())
  const [stage, setStage] = useState(() => (!home ? 'place' : reduced || seenIntro() ? 'landing' : 'intro'))
  const [phase, setPhase] = useState('loading')
  const [chapter, setChapter] = useState(0)
  const [photo, setPhoto] = useState(0)
  const [dir, setDir] = useState(1)
  const [full, setFull] = useState(false)
  const [hover, setHover] = useState(-1)
  const [visible, setVisible] = useState(true)

  const item = items[chapter]
  const photos = useMemo(() => {
    const list = item.photos.length ? item.photos : [{ src: item.hero, alt: item.alt }]
    const heroIdx = list.findIndex((p) => p.src === item.hero)
    return heroIdx > 0 ? [list[heroIdx], ...list.filter((_, i) => i !== heroIdx)] : list
  }, [item])
  const current = photos[Math.min(photo, photos.length - 1)]
  const name = item.title || item.caption
  const last = photo === photos.length - 1
  const altFor = (p, i) => p?.alt || `${name} — photo ${i + 1} of ${photos.length}`
  const landingSrc = landing || items[0]?.hero

  /* --- the 3D viewer ----------------------------------------------------- */

  useEffect(() => {
    if (!use3D) return
    const host = glRef.current
    const canvas = document.createElement('canvas')
    canvas.className = 'jr__canvas'
    canvas.setAttribute('aria-hidden', 'true')
    host.appendChild(canvas)
    let alive = true
    let viewer = null

    // the tap target over the floating print, moved every frame
    const onPrintRect = (r) => {
      const el = printHitRef.current
      if (!el) return
      if (!r.visible) {
        el.style.display = 'none'
        return
      }
      el.style.display = 'block'
      el.style.transform = `translate(${r.x}px, ${r.y}px)`
      el.style.width = `${r.w}px`
      el.style.height = `${r.h}px`
    }

    import('./viewer.js')
      .then(({ createViewer }) =>
        createViewer({
          canvas,
          quality: qualityLevel(),
          onPrintRect,
          onPhase: (p) => alive && setPhase(p),
          onError: (err) => {
            console.error(err)
            if (alive) setUse3D(false)
          },
        })
      )
      .then((v) => {
        if (!alive) {
          v.dispose()
          return
        }
        viewer = v
        viewerRef.current = v
        v.start()
        if (home) v.prepareWall(items).catch((err) => console.error(err))
        else v.enter(0, items[0], { title: items[0].title || items[0].caption })
      })
      .catch((err) => {
        console.error(err)
        if (alive) setUse3D(false)
      })
    return () => {
      alive = false
      viewerRef.current = null
      viewer?.dispose()
      canvas.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [use3D])

  // pause off screen; resize; the view leans gently with the pointer
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.intersectionRatio > 0.2), { threshold: [0, 0.2, 0.6] })
    io.observe(sectionRef.current)
    const onResize = () => viewerRef.current?.resize()
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const onMove = (e) => viewerRef.current?.setPointer((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1))
    window.addEventListener('resize', onResize)
    if (fine) window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      io.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    if (visible) v.start()
    else v.stop()
  }, [visible, phase])

  // the next print, painted ahead of time
  useEffect(() => {
    if (stage !== 'place' || phase !== 'arrived') return
    const next = photos[photo + 1]
    if (next) viewerRef.current?.preloadPrint(next.src)
  }, [stage, phase, photo, photos])

  /* --- moving through the tour ------------------------------------------- */

  function finishIntro() {
    markIntro()
    setStage((s) => (s === 'intro' ? 'landing' : s))
  }

  function startExploring() {
    setStage('wall')
    sectionRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    if (viewerRef.current) viewerRef.current.showWall(items)
    else setPhase('wall')
  }

  function openMemory(i) {
    setChapter(i)
    setPhoto(0)
    setDir(1)
    setHover(-1)
    setStage('place')
    if (viewerRef.current) {
      setPhase('entering')
      viewerRef.current.enter(i, items[i], { title: items[i].title || items[i].caption })
    } else setPhase('arrived')
  }

  const goPhoto = useCallback(
    (next) => {
      if (next < 0 || next >= photos.length || next === photo) return
      const d = next > photo ? 1 : -1
      setDir(d)
      setPhoto(next)
      viewerRef.current?.photo(next, photos[next].src, d)
    },
    [photo, photos]
  )

  function backToMemories() {
    setFull(false)
    if (!home) return
    setStage('wall')
    if (viewerRef.current) {
      setPhase('leaving')
      viewerRef.current.backToWall(current?.src)
    } else setPhase('wall')
  }

  function openFull() {
    setFull(true)
    document.documentElement.classList.add('jr-locked')
  }
  function closeFull() {
    setFull(false)
    document.documentElement.classList.remove('jr-locked')
  }
  useEffect(() => () => document.documentElement.classList.remove('jr-locked'), [])

  // keyboard
  useEffect(() => {
    if (!visible && !full) return
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return
      if (full) {
        if (e.key === 'Escape') closeFull()
        else if (e.key === 'ArrowRight') goPhoto(photo + 1)
        else if (e.key === 'ArrowLeft') goPhoto(photo - 1)
        else return
        e.preventDefault()
        return
      }
      if (stage === 'intro') {
        finishIntro()
        return
      }
      if (stage !== 'place' || (use3D && phase !== 'arrived')) return
      if (e.key === 'ArrowRight') goPhoto(photo + 1)
      else if (e.key === 'ArrowLeft') goPhoto(photo - 1)
      else if (e.key === 'Escape' && home) backToMemories()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // the wall: hover lifts a print, a click opens it, a drag pans
  const wallDrag = useRef(null)
  const toNdc = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)]
  }
  const onWallMove = (e) => {
    const v = viewerRef.current
    if (!v) return
    const d = wallDrag.current
    if (d) {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true
      if (d.moved) v.wallPan(dx, dy)
      d.x = e.clientX
      d.y = e.clientY
      return
    }
    const [x, y] = toNdc(e)
    setHover(v.wallHover(x, y))
  }
  const onWallDown = (e) => {
    wallDrag.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  const onWallUp = (e) => {
    const d = wallDrag.current
    wallDrag.current = null
    if (d?.moved || phase !== 'wall') return
    const v = viewerRef.current
    if (!v) return
    const [x, y] = toNdc(e)
    const i = v.wallHover(x, y)
    if (i >= 0) openMemory(i)
  }

  /* --- render ----------------------------------------------------------- */

  const placeReady = stage === 'place' && (!use3D || phase === 'arrived')
  const arriving = stage === 'place' && use3D && (phase === 'arriving' || phase === 'loading' || phase === 'entering')
  const wallReady = stage === 'wall' && (!use3D || phase === 'wall')
  const slide = reduced ? 0 : 70
  const dragged = useRef(false)

  const skipLink = skip.startsWith('#') ? (
    <a className="jr__skip" href={skip}>
      {skipLabel}
    </a>
  ) : (
    <Link className="jr__skip" to={skip}>
      {skipLabel}
    </Link>
  )

  return (
    <section
      ref={sectionRef}
      className={`jr jr--${stage} jr--${variant}${use3D ? ' jr--3d' : ' jr--flat'}`}
      data-phase={phase}
      aria-label={home ? 'The tour' : name}
    >
      {/* without 3D: a soft copy of the photo behind the flat pages */}
      <div className="jr__flat" aria-hidden="true">
        {stage === 'place' && <img src={current?.src || item.hero} alt="" />}
      </div>
      <div className="jr__gl" ref={glRef} />

      {/* First visit: a print slides out and develops into the landing photo */}
      <AnimatePresence>
        {stage === 'intro' && <IntroReel src={landingSrc} onDone={finishIntro} />}
      </AnimatePresence>

      {/* Landing: one photo, full screen */}
      <AnimatePresence>
        {(stage === 'landing' || stage === 'intro') && (
          <motion.div
            key="landing"
            className="jr__landing"
            initial={false}
            animate={{ opacity: stage === 'landing' ? 1 : 0 }}
            exit={{ opacity: 0, transition: { duration: 1.1 } }}
            transition={{ duration: 0.9 }}
          >
            <img className="jr__landing-photo" src={landingSrc} alt="" />
            <div className="jr__landing-shade" aria-hidden="true" />
            <h1 className="sr-only">Lospikir — photography</h1>
            {stage === 'landing' && (
              <motion.div
                className="jr__landing-actions"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 0.4, duration: 0.9 } }}
              >
                <button type="button" className="btn btn--pill" onClick={startExploring}>
                  Start exploring
                </button>
                {skipLink}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The wall of memories */}
      {stage === 'wall' && use3D && (
        <div
          className={`jr__wallhit${hover >= 0 ? ' is-over' : ''}`}
          onPointerMove={onWallMove}
          onPointerDown={onWallDown}
          onPointerUp={onWallUp}
          onPointerLeave={() => {
            wallDrag.current = null
            setHover(viewerRef.current?.wallHover(-9, -9) ?? -1)
          }}
          aria-hidden="true"
        />
      )}
      <AnimatePresence>
        {wallReady && (
          <motion.div key="wallui" className="jr__wallui" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
            <p className="label jr__hint">{hover >= 0 ? items[hover].title || items[hover].caption : 'Choose a memory'}</p>
            {/* the same choices as plain buttons: for keyboards, screen readers, and no-3D */}
            <ol className={use3D ? 'jr__memlist sr-only-focusable' : 'jr__memlist jr__polaroids'}>
              {items.map((it, i) => (
                <li key={it.slug}>
                  <button type="button" className="jr__mem" onClick={() => openMemory(i)} style={{ '--tilt': `${((i * 37) % 9) - 4}deg` }}>
                    {!use3D && <img src={it.hero} alt="" loading="lazy" />}
                    <span>{it.title || it.caption}</span>
                  </button>
                </li>
              ))}
            </ol>
            {skipLink}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Arriving: the gallery's title */}
      <AnimatePresence>
        {arriving && phase === 'arriving' && (
          <motion.div
            key={`card-${chapter}`}
            className="jr__titlecard"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 1.1, delay: 0.8 } }}
            exit={{ opacity: 0, transition: { duration: 0.7 } }}
            aria-hidden="true"
          >
            <p className="display jr__titlecard-name">{name}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Without 3D: the print in the middle */}
      {stage === 'place' && !use3D && (
        <div className="jr__flatprint">
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.button
              key={current?.src}
              type="button"
              className="jr__print"
              initial={{ opacity: 0, x: dir * slide, rotate: dir * 6 }}
              animate={{ opacity: 1, x: 0, rotate: -1.5 }}
              exit={{ opacity: 0, x: -dir * slide * 1.4, rotate: -dir * 8 }}
              transition={SPRING}
              onClick={() => !dragged.current && openFull()}
              drag={photos.length > 1 ? 'x' : false}
              dragSnapToOrigin
              onDragStart={() => (dragged.current = true)}
              onDragEnd={(_, { offset, velocity }) => {
                const x = offset.x + project(velocity.x)
                if (x < -80) goPhoto(photo + 1)
                else if (x > 80) goPhoto(photo - 1)
                setTimeout(() => (dragged.current = false), 0)
              }}
            >
              <img src={current?.src} alt={altFor(current, photo)} draggable={false} />
              <span className="jr__print-title">{name}</span>
            </motion.button>
          </AnimatePresence>
        </div>
      )}

      {/* Browsing a memory */}
      <button ref={printHitRef} type="button" className="jr__printhit" aria-label={`View ${altFor(current, photo)} full screen`} onClick={openFull} style={{ display: 'none' }} />
      <AnimatePresence>
        {placeReady && (
          <motion.div key="chrome" className="jr__chrome" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.7 } }} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
            {home && (
              <button type="button" className="jr__back" onClick={backToMemories}>
                ← Memories
              </button>
            )}
            <h2 className="display jr__name">{name}</h2>
            <div className="jr__nav">
              <button type="button" className="jr__arrow" aria-label="Previous photo" onClick={() => goPhoto(photo - 1)} disabled={photo === 0}>
                ←
              </button>
              <span className="label jr__count" aria-hidden="true">
                {photo + 1} / {photos.length}
              </span>
              {!last && (
                <button type="button" className="jr__arrow" aria-label="Next photo" onClick={() => goPhoto(photo + 1)}>
                  →
                </button>
              )}
              {last &&
                (home ? (
                  <button type="button" className="btn btn--pill jr__more" onClick={backToMemories}>
                    View other memories
                  </button>
                ) : (
                  <a className="btn btn--pill jr__more" href="#photos">
                    See every photo
                  </a>
                ))}
            </div>
            {home && last && (
              <a className="jr__worktogether" href={after}>
                Work together →
              </a>
            )}
            {skipLink}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The photo, full screen */}
      <AnimatePresence>
        {full && (
          <motion.div
            className="jr__full"
            role="dialog"
            aria-modal="true"
            aria-label={altFor(current, photo)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={(e) => e.target === e.currentTarget && closeFull()}
          >
            <AnimatePresence initial={false} custom={dir} mode="popLayout">
              <motion.img
                key={current?.src}
                src={current?.src}
                alt={altFor(current, photo)}
                className="jr__full-photo"
                initial={{ opacity: 0, x: dir * slide, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -dir * slide }}
                transition={SPRING}
                drag={photos.length > 1 ? 'x' : false}
                dragSnapToOrigin
                dragElastic={0.25}
                onDragEnd={(_, { offset, velocity }) => {
                  const x = offset.x + project(velocity.x)
                  if (x < -80) goPhoto(photo + 1)
                  else if (x > 80) goPhoto(photo - 1)
                }}
                draggable={false}
              />
            </AnimatePresence>
            <button type="button" className="jr__full-close" onClick={closeFull} autoFocus>
              Close
            </button>
            {photos.length > 1 && (
              <>
                {photo > 0 && (
                  <button type="button" className="jr__arrow jr__full-step jr__full-step--prev" aria-label="Previous photo" onClick={() => goPhoto(photo - 1)}>
                    ←
                  </button>
                )}
                {!last && (
                  <button type="button" className="jr__arrow jr__full-step jr__full-step--next" aria-label="Next photo" onClick={() => goPhoto(photo + 1)}>
                    →
                  </button>
                )}
                <p className="label jr__full-count" aria-hidden="true">
                  {photo + 1} / {photos.length}
                </p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <p className="sr-only" aria-live="polite">
        {placeReady ? `${name}. Photo ${photo + 1} of ${photos.length}.` : stage === 'wall' && wallReady ? 'Memories. Choose one.' : ''}
      </p>
    </section>
  )
}

/**
 * First visit: an instant print slides up out of the dark, the photo on it
 * develops from nothing, and then the view dives into it — it opens up into
 * the landing photo. Tap or press any key to skip.
 */
function IntroReel({ src, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4300)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <motion.div className="jr__reel" onClick={onDone} exit={{ opacity: 0, transition: { duration: 0.8 } }}>
      <motion.div
        className="jr__reel-print"
        initial={{ y: '70vh', rotate: -8, scale: 0.9 }}
        animate={{
          y: ['70vh', '0vh', '0vh', '0vh'],
          rotate: [-8, -2, -2, 0],
          scale: [0.9, 1, 1, 7],
          opacity: [1, 1, 1, 0],
        }}
        transition={{ duration: 5.2, times: [0, 0.22, 0.7, 1], ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.img
          src={src}
          alt=""
          initial={{ filter: 'brightness(0.12) sepia(1) saturate(0.2) blur(4px)' }}
          animate={{ filter: 'brightness(1) sepia(0) saturate(1) blur(0px)' }}
          transition={{ delay: 1.1, duration: 2.4, ease: 'easeInOut' }}
        />
        <span className="jr__reel-brand">Lospikir</span>
      </motion.div>
    </motion.div>
  )
}
