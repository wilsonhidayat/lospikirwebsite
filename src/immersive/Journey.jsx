import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { playShutter, unlockAudio } from './shutter-sound.js'
import { immersiveSupported, qualityLevel } from './support.js'
import { quadTransform } from './quad.js'
import { SPRING, project } from '../motion.js'
import '../styles/journey.css'

// the photo layer's own size; it is corner-pinned onto the camera's screen
const LCD_W = 600
const LCD_H = 400

/**
 * The tour: each project's place in 3D, with Wilson's camera floating in it.
 *
 *  - Home opens in the first place, the camera out in the scene, lens toward
 *    you. "Start the tour" turns it round and brings it close: its screen
 *    shows the project's photos — big, crisp, the centre of everything.
 *    Flick through them (arrows, swipe, ← →); tap one to see it full screen.
 *  - The view of the place stays still while browsing. It only moves to
 *    travel to the next place, through the clouds.
 *  - "Step inside": the camera drops away so you can look around the place;
 *    "Take the shot" brings it back with the shutter.
 *  - "Skip the tour" is always there, for the regular site.
 *
 * Without WebGL (or with reduced motion) the same screen sits over a soft,
 * blurred copy of the photo.
 *
 * items: galleries — { slug, title, caption, scene, hero, alt, photos }
 * skip: where "Skip the tour" goes — a route ('/work') or an anchor ('#photos')
 * after: where the end of the tour leads ('#packages')
 */
export default function Journey({ items, intro = true, variant = 'home', skip = '/work', skipLabel = 'Skip the tour', after = '#packages' }) {
  const reduced = useReducedMotion()
  const sectionRef = useRef(null)
  const glRef = useRef(null)
  const lcdRef = useRef(null)
  const flashRef = useRef(null)
  const viewerRef = useRef(null)
  const soundRef = useRef(false)
  const lcdLive = useRef(false)
  const startedRef = useRef(!intro) // the visitor has started the tour

  const [use3D, setUse3D] = useState(() => immersiveSupported())
  const [stage, setStage] = useState(intro ? 'intro' : 'pick') // intro | pick | inside | returning
  const [phase, setPhase] = useState('loading') // loading | leaving | arriving | arrived
  const [turned, setTurned] = useState(!intro) // the camera's screen is facing the visitor
  const [chapter, setChapter] = useState(0)
  const [photo, setPhoto] = useState(0)
  const [dir, setDir] = useState(1)
  const [sound, setSound] = useState(false)
  const [visible, setVisible] = useState(true)
  const [full, setFull] = useState(false) // the photo full screen

  const item = items[chapter]
  const photos = useMemo(() => {
    // the moment photo first, then the rest of the project
    const list = item.photos.length ? item.photos : [{ src: item.hero, alt: item.alt }]
    const heroIdx = list.findIndex((p) => p.src === item.hero)
    return heroIdx > 0 ? [list[heroIdx], ...list.filter((_, i) => i !== heroIdx)] : list
  }, [item])
  const current = photos[Math.min(photo, photos.length - 1)]
  const name = item.title || item.caption
  const last = chapter === items.length - 1
  const altFor = (p, i) => p?.alt || `${name} — photo ${i + 1} of ${photos.length}`

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

    // lay the photo over the camera's screen, every frame
    const onScreen = ({ quad, facing, cloud, away }) => {
      const el = lcdRef.current
      if (!el) return
      const show = Math.max(0, Math.min(1, (facing - 0.8) / 0.14)) * (1 - cloud) * Math.max(0, 1 - away * 3)
      el.style.transform = quadTransform(LCD_W, LCD_H, quad)
      el.style.opacity = show.toFixed(3)
      const live = show > 0.6
      if (live !== lcdLive.current) {
        lcdLive.current = live
        el.style.pointerEvents = live ? 'auto' : 'none'
        el.toggleAttribute('inert', !live)
      }
    }

    import('./viewer.js')
      .then(({ createViewer }) =>
        createViewer({
          canvas,
          quality: qualityLevel(),
          onScreen,
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
        if (startedRef.current) v.pose('review', intro ? 2.8 : 0).then(() => alive && setTurned(true))
        v.start()
        v.open(items[0])
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
    // the item list is fixed for the life of the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [use3D])

  // pause rendering off screen; resize with the window; the camera leans to the pointer
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.intersectionRatio > 0.35), { threshold: [0, 0.35, 0.6] })
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
    if (visible || stage === 'inside') v.start()
    else v.stop()
  }, [visible, stage, phase])

  // get the next place ready while this one is browsed
  useEffect(() => {
    if (phase !== 'arrived' || items.length < 2) return
    const t = setTimeout(() => viewerRef.current?.preload(items[(chapter + 1) % items.length]), 1500)
    return () => clearTimeout(t)
  }, [phase, chapter, items])

  /* --- navigation -------------------------------------------------------- */

  const goPhoto = useCallback(
    (next) => {
      const n = photos.length
      const i = ((next % n) + n) % n
      setDir(next > photo ? 1 : -1)
      setPhoto(i)
    },
    [photo, photos.length]
  )

  const goChapter = useCallback(
    (next) => {
      const i = ((next % items.length) + items.length) % items.length
      setDir(next > chapter ? 1 : -1)
      setChapter(i)
      setPhoto(0)
      setStage('pick')
      setFull(false)
      if (viewerRef.current) {
        setPhase('leaving')
        viewerRef.current.open(items[i])
      } else {
        setPhase('arrived')
      }
    },
    [chapter, items]
  )

  async function begin() {
    startedRef.current = true
    setStage('pick')
    const v = viewerRef.current
    if (!v) {
      // no 3D, or it's still loading (it turns the camera itself once ready)
      if (!use3D) setTurned(true)
      return
    }
    await v.pose('review', reduced ? 0.01 : 2.8)
    setTurned(true)
  }

  function stepInside() {
    // bring the whole place into view, then hold the page still while inside
    sectionRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    setStage('inside')
    document.documentElement.classList.add('jr-locked')
    viewerRef.current?.setMode('inside')
  }

  function leaveInside() {
    setStage('pick')
    document.documentElement.classList.remove('jr-locked')
    viewerRef.current?.setMode('pick')
  }

  function fire() {
    const el = flashRef.current
    if (el) {
      el.classList.remove('is-firing')
      void el.offsetWidth
      el.classList.add('is-firing')
    }
    if (soundRef.current) playShutter(1 / 250)
  }

  async function takeTheShot() {
    const v = viewerRef.current
    setStage('returning')
    fire()
    if (v) await v.returnToMoment()
    document.documentElement.classList.remove('jr-locked')
    setStage('pick')
    v?.setMode('pick')
  }

  function openFull() {
    setFull(true)
    document.documentElement.classList.add('jr-locked')
  }
  function closeFull() {
    setFull(false)
    if (stage !== 'inside') document.documentElement.classList.remove('jr-locked')
  }

  useEffect(() => () => document.documentElement.classList.remove('jr-locked'), [])

  // keyboard: ← → photos, [ ] or PageUp/PageDown places, Esc back
  useEffect(() => {
    if (!visible && stage !== 'inside' && !full) return
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
        if (e.key === 'Enter' && document.activeElement === document.body) begin()
        return
      }
      if (stage === 'inside') {
        if (e.key === 'Escape') leaveInside()
        return
      }
      if (stage !== 'pick') return
      if (e.key === 'ArrowRight') goPhoto(photo + 1)
      else if (e.key === 'ArrowLeft') goPhoto(photo - 1)
      else if (e.key === ']' || e.key === 'PageDown') goChapter(chapter + 1)
      else if (e.key === '[' || e.key === 'PageUp') goChapter(chapter - 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // drag to look around while inside
  const dragRef = useRef(null)
  const onLookDown = (e) => {
    // presses on the buttons are clicks, not drags — never capture those
    if (e.target.closest('button, a')) return
    dragRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onLookMove = (e) => {
    const d = dragRef.current
    if (!d) return
    viewerRef.current?.drag(e.clientX - d.x, e.clientY - d.y)
    d.x = e.clientX
    d.y = e.clientY
  }
  const onLookUp = () => (dragRef.current = null)

  function toggleSound() {
    const next = !sound
    if (next) unlockAudio()
    soundRef.current = next
    setSound(next)
  }

  /* --- render ----------------------------------------------------------- */

  const arriving = phase === 'leaving' || phase === 'loading' || phase === 'arriving'
  const browsing = stage === 'pick' && (!use3D || (turned && phase === 'arrived'))
  const slide = reduced ? 0 : 80
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
      className={`jr jr--${stage} jr--${variant}${use3D ? ' jr--3d' : ' jr--flat'}${browsing ? ' is-browsing' : ''}`}
      data-phase={phase}
      aria-label={variant === 'home' ? 'The tour' : name}
      aria-roledescription="gallery"
    >
      {/* Background: the 3D place, or a soft copy of the photo */}
      <div className="jr__flat" aria-hidden="true">
        <img src={current?.src || item.hero} alt="" />
      </div>
      <div className="jr__gl" ref={glRef} />
      <div className="jr__scrim" aria-hidden="true" />

      {/* The camera's screen: the photos. Pinned onto the 3D camera, or centred without 3D. */}
      <div
        ref={lcdRef}
        className="jr__lcd"
        style={use3D ? { width: LCD_W, height: LCD_H, opacity: 0, pointerEvents: 'none' } : undefined}
        aria-hidden={!browsing}
      >
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.img
            key={current?.src}
            src={current?.src}
            alt={altFor(current, photo)}
            className="jr__photo"
            custom={dir}
            initial={{ opacity: 0, x: dir * slide }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -dir * slide }}
            transition={SPRING}
            drag={photos.length > 1 ? 'x' : false}
            dragSnapToOrigin
            dragElastic={0.25}
            onDragStart={() => (dragged.current = true)}
            onDragEnd={(_, { offset, velocity }) => {
              const x = offset.x + project(velocity.x)
              if (x < -80) goPhoto(photo + 1)
              else if (x > 80) goPhoto(photo - 1)
              setTimeout(() => (dragged.current = false), 0)
            }}
            onClick={() => !dragged.current && openFull()}
            draggable={false}
          />
        </AnimatePresence>
        <div className="jr__osd" aria-hidden="true">
          <span className="jr__play" />
          <span>
            {photo + 1}/{photos.length}
          </span>
        </div>
        {photos.length > 1 && (
          <>
            <button type="button" className="jr__step jr__step--prev" aria-label="Previous photo" onClick={() => goPhoto(photo - 1)}>
              ‹
            </button>
            <button type="button" className="jr__step jr__step--next" aria-label="Next photo" onClick={() => goPhoto(photo + 1)}>
              ›
            </button>
          </>
        )}
      </div>

      {/* Opening: the camera out in the first place */}
      <AnimatePresence>
        {stage === 'intro' && (
          <motion.div
            className="jr__intro"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: use3D ? 1.6 : 0, duration: 1 } }}
            exit={{ opacity: 0, transition: { duration: 0.5 } }}
          >
            <h1 className="sr-only">Lospikir — photography</h1>
            <button type="button" className="btn btn--pill" onClick={begin}>
              Start the tour
            </button>
            {skipLink}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The gallery's title, while arriving */}
      <AnimatePresence>
        {stage === 'pick' && use3D && arriving && phase !== 'leaving' && (
          <motion.div
            key={`card-${chapter}`}
            className="jr__titlecard"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 1.1, delay: 0.3 } }}
            exit={{ opacity: 0, transition: { duration: 0.7 } }}
            aria-hidden="true"
          >
            <p className="display jr__titlecard-name">{name}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Browsing */}
      <AnimatePresence>
        {browsing && (
          <motion.div
            key="chrome"
            className="jr__chrome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.8 } }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
          >
            <div className="jr__info">
              <h2 className="display jr__name">{name}</h2>
              {use3D && (
                <button type="button" className="btn btn--ghost btn--pill btn--sm" onClick={stepInside}>
                  Step inside
                </button>
              )}
            </div>

            {items.length > 1 && (
              <nav className="jr__places" aria-label="Galleries">
                <button
                  type="button"
                  className="jr__place-step"
                  aria-label={`Previous: ${items[(chapter - 1 + items.length) % items.length].title}`}
                  onClick={() => goChapter(chapter - 1)}
                >
                  ←
                </button>
                <span className="label jr__place-count" aria-hidden="true">
                  {String(chapter + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}
                </span>
                <ol className="jr__dots">
                  {items.map((it, i) => (
                    <li key={it.slug}>
                      <button
                        type="button"
                        className={`jr__dot${i === chapter ? ' is-current' : ''}`}
                        aria-label={it.title || it.caption}
                        aria-current={i === chapter}
                        onClick={() => i !== chapter && goChapter(i)}
                      />
                    </li>
                  ))}
                </ol>
                {last && variant === 'home' ? (
                  <a className="jr__place-step jr__place-step--end" href={after}>
                    Work together →
                  </a>
                ) : (
                  <button
                    type="button"
                    className="jr__place-step"
                    aria-label={`Next: ${items[(chapter + 1) % items.length].title}`}
                    onClick={() => goChapter(chapter + 1)}
                  >
                    →
                  </button>
                )}
              </nav>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stepped inside */}
      {(stage === 'inside' || stage === 'returning') && (
        <div className="jr__inside" onPointerDown={onLookDown} onPointerMove={onLookMove} onPointerUp={onLookUp} onPointerCancel={onLookUp}>
          <div className="jr__inside-top">
            <button type="button" className="btn btn--ghost btn--pill" onClick={leaveInside} disabled={stage === 'returning'}>
              ← Back to the photos
            </button>
          </div>
          <p className="label jr__inside-hint">Drag to look around</p>
          <div className="jr__inside-bottom">
            <button type="button" className="btn btn--pill" onClick={takeTheShot} disabled={stage === 'returning'}>
              Take the shot
            </button>
          </div>
        </div>
      )}

      {/* Always there: leave the tour for the regular site */}
      {stage !== 'intro' && stage !== 'inside' && stage !== 'returning' && skipLink}

      <div className="jr__flash" ref={flashRef} aria-hidden="true" />

      <button type="button" className="jr__sound" aria-pressed={sound} onClick={toggleSound}>
        <span className="jr__sound-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {sound ? 'Sound on' : 'Sound off'}
      </button>

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
                <button type="button" className="jr__step jr__step--prev jr__full-step" aria-label="Previous photo" onClick={() => goPhoto(photo - 1)}>
                  ‹
                </button>
                <button type="button" className="jr__step jr__step--next jr__full-step" aria-label="Next photo" onClick={() => goPhoto(photo + 1)}>
                  ›
                </button>
                <p className="label jr__full-count" aria-hidden="true">
                  {photo + 1} / {photos.length}
                </p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <p className="sr-only" aria-live="polite">
        {browsing ? `${name}. Photo ${photo + 1} of ${photos.length}.` : ''}
      </p>
    </section>
  )
}
