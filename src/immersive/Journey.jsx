import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { immersiveSupported, qualityLevel } from './support.js'
import { SPRING, project } from '../motion.js'
import { site } from '../data/site.js'
import { createSoundscape } from './soundscape.js'
import '../styles/journey.css'

/**
 * The tour.
 *
 *  landing   the LOSPIKIR logo, a line on what this is, Start the experience / Skip the tour —
 *            over a soft gradient, or (?landing=photo) over a photograph
 *  memories  every project as an instant print on a long line of twine;
 *            scroll sideways through them, the one in the middle comes
 *            forward and its name is written large. Click it…
 *  place     …the photo flies out of its print to the middle of the screen
 *            and the 3D place where it was taken develops around it. The
 *            photos are shown as they are — no frame, no filter, full
 *            quality — with arrows either side; each new photo moves the view
 *            somewhere new. After the last: View other memories.
 *
 * The page doesn't scroll while you're in the memories or a place. Gallery
 * pages open straight into their own place. Without WebGL the same steps
 * work over a soft copy of the photo.
 *
 * items: galleries — { slug, title, caption, hero, alt, photos, scene }
 */
export default function Journey({ items, variant = 'home', landing = null, skip = '/work', skipLabel = 'Skip the tour', allPhotos = '#photos', after = '.after-tour' }) {
  const reduced = useReducedMotion()
  const home = variant === 'home'
  const sectionRef = useRef(null)
  const glRef = useRef(null)
  const viewerRef = useRef(null)
  const viewerReady = useRef(null)

  const [use3D, setUse3D] = useState(() => immersiveSupported())
  const [stage, setStage] = useState(home ? 'landing' : 'place') // landing | memories | place
  const [phase, setPhase] = useState('idle')
  const [chapter, setChapter] = useState(0)
  const [photo, setPhoto] = useState(0)
  const [dir, setDir] = useState(1)
  const [flight, setFlight] = useState(null) // the photo flying out of its print
  const [visible, setVisible] = useState(true)
  const [photoOn, setPhotoOn] = useState(!home) // the place's photo is showing
  // home: the page stays put until the visitor finishes or leaves the experience
  const [done, setDone] = useState(false)
  // sound: music and the place's ambience, made in the browser
  const soundRef = useRef(null)
  const [soundOn, setSoundOn] = useState(home)
  const sound = () => (soundRef.current ||= createSoundscape({ music: site.tour?.music || null }))
  const landingStyle = useMemo(() => {
    if (typeof window === 'undefined') return 'gradient'
    const photo = new URLSearchParams(window.location.search).get('landing') === 'photo' || window.location.hash === '#landing-photo'
    return photo ? 'photo' : 'gradient'
  }, [])

  const item = items[chapter]
  // the photos in the order they're shown, each with the place it belongs to
  // (a gallery can span several places) and the viewpoint it uses there
  const seq = useMemo(() => sequence(item), [item])
  const photos = seq.photos
  const current = photos[Math.min(photo, photos.length - 1)]
  const name = item.title || item.caption
  const last = photo === photos.length - 1
  const altFor = (p, i) => p?.alt || `${name} — photo ${i + 1} of ${photos.length}`

  /* --- the 3D viewer (made when first needed) -------------------------- */

  const getViewer = useCallback(() => {
    if (!use3D) return Promise.resolve(null)
    if (viewerReady.current) return viewerReady.current
    const canvas = document.createElement('canvas')
    canvas.className = 'jr__canvas'
    canvas.setAttribute('aria-hidden', 'true')
    glRef.current.appendChild(canvas)
    viewerReady.current = import('./viewer.js')
      .then(({ createViewer }) =>
        createViewer({
          canvas,
          quality: qualityLevel(),
          onPhase: (p) => setPhase(p),
          onError: (err) => {
            console.error(err)
            setUse3D(false)
          },
        })
      )
      .then((v) => {
        viewerRef.current = v
        v.start()
        return v
      })
      .catch((err) => {
        console.error(err)
        setUse3D(false)
        return null
      })
    return viewerReady.current
  }, [use3D])

  useEffect(
    () => () => {
      viewerRef.current?.dispose()
      viewerRef.current = null
      soundRef.current?.dispose()
      soundRef.current = null
    },
    []
  )

  // gallery pages: straight into the place
  useEffect(() => {
    if (home) return
    const first = sequence(items[0])
    getViewer().then((v) => v?.enter(first.locs[0].item, first.spot[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // pause off screen; resize; a breath of parallax with the pointer
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
    if (visible && stage === 'place') v.start()
    else v.stop()
  }, [visible, stage, phase])

  // like a film: the page doesn't scroll until the experience is finished or
  // left — scrolling moves the story instead
  const lock = home && !done
  useEffect(() => {
    if (lock) window.scrollTo({ top: 0, behavior: 'auto' })
    document.documentElement.classList.toggle('jr-tour', lock)
    // a menu link (Packages, Check your date) jumps down the page: that's
    // leaving the experience, so let the page go
    const onScroll = () => {
      if (lock && window.scrollY > 40) {
        soundRef.current?.stop()
        viewerRef.current?.leave()
        setPhotoOn(false)
        setStage('landing')
        setDone(true)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.documentElement.classList.remove('jr-tour')
      window.removeEventListener('scroll', onScroll)
    }
  }, [lock])

  /* --- moving through the tour ------------------------------------------ */

  function startExploring() {
    setDone(false)
    window.scrollTo({ top: sectionRef.current.offsetTop, behavior: 'auto' })
    setChapter(0)
    setStage('memories')
    getViewer() // get the 3D ready in the background
    const snd = sound()
    if (snd) {
      snd.setMuted(!soundOn)
      snd.start()
      snd.setPlace(null)
    }
  }

  function toggleSound() {
    const snd = sound()
    if (!snd) return
    const on = !soundOn
    setSoundOn(on)
    snd.setMuted(!on)
    if (on) {
      snd.start()
      snd.setPlace(stage === 'place' ? seq.locs[seq.loc[photo]]?.scene : null)
    }
  }

  // the chapter in view gets its place ready, so stepping in is quick
  const preloadTimer = useRef(0)
  const preloadSoon = (i) => {
    clearTimeout(preloadTimer.current)
    preloadTimer.current = setTimeout(() => {
      const it = items[i]
      if (!it || !viewerRef.current) return
      viewerRef.current.preload(sequence(it).locs[0].item)
    }, 650)
  }

  // finished, or left: back to the title, and the page scrolls on to the rest
  function finish() {
    soundRef.current?.stop()
    setPhotoOn(false)
    viewerRef.current?.leave()
    setStage('landing')
    setDone(true)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector(after)
        if (el) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
      })
    )
  }

  function openMemory(i, imgEl) {
    const it = items[i]
    const aspect = imgEl?.naturalWidth ? imgEl.naturalWidth / imgEl.naturalHeight : 0.75
    const from = imgEl?.getBoundingClientRect()
    const first = sequence(it)
    setChapter(i)
    setPhoto(0)
    setDir(1)
    setPhotoOn(false)
    if (from && !reduced) setFlight({ src: it.hero, from, to: photoBox(aspect) })
    else setPhotoOn(true)
    setStage('place')
    setPhase('loading')
    soundRef.current?.setPlace(first.locs[0].scene)
    getViewer().then((v) => (v ? v.enter(first.locs[0].item, first.spot[0]) : setPhase('arrived')))
  }

  const goPhoto = useCallback(
    (next) => {
      if (next < 0 || next >= photos.length || next === photo) return
      setDir(next > photo ? 1 : -1)
      setPhoto(next)
      const v = viewerRef.current
      const loc = seq.loc[next]
      if (loc !== seq.loc[photo]) {
        // on to another place of the same shoot: it develops in around the photo
        soundRef.current?.setPlace(seq.locs[loc].scene)
        v?.enter(seq.locs[loc].item, seq.spot[next])
      } else v?.photo(seq.spot[next])
      // get the next place of the shoot ready before it's needed
      const ahead = seq.loc[Math.min(photos.length - 1, next + 2)]
      if (ahead !== loc) v?.preload(seq.locs[ahead].item)
    },
    [photo, photos, seq]
  )

  // back to the line of memories — on the next print when the story moves on
  function backToMemories(next = chapter) {
    setPhotoOn(false)
    viewerRef.current?.leave()
    setChapter(Math.max(0, Math.min(items.length - 1, next)))
    setStage('memories')
    soundRef.current?.setPlace(null)
  }

  // the story's next and previous steps (wheel, swipe up/down)
  const storyStep = (step) => {
    if (stage !== 'place' || !photoOn) return
    const next = photo + step
    if (next >= 0 && next < photos.length) return goPhoto(next)
    if (!home) return
    if (step < 0) return backToMemories(chapter)
    if (chapter >= items.length - 1) return finish()
    backToMemories(chapter + 1)
  }
  const stepRef = useRef(storyStep)
  stepRef.current = storyStep

  // the wheel moves the story one step per gesture (trackpads keep sending
  // momentum for a while, so each step waits for it to settle)
  useEffect(() => {
    if (stage !== 'place') return
    let acc = 0
    let quietUntil = 0
    let last = 0
    const onWheel = (e) => {
      if (!lock && home) return
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
      e.preventDefault()
      const now = performance.now()
      if (now - last > 220) acc = 0
      last = now
      if (now < quietUntil) {
        quietUntil = now + 180 // still the same flick
        return
      }
      acc += e.deltaY
      if (Math.abs(acc) > 50) {
        stepRef.current(acc > 0 ? 1 : -1)
        acc = 0
        quietUntil = now + 650
      }
    }
    let y0 = null
    let x0 = null
    const onStart = (e) => {
      y0 = e.touches[0].clientY
      x0 = e.touches[0].clientX
    }
    const onEnd = (e) => {
      if (y0 == null) return
      const dy = e.changedTouches[0].clientY - y0
      const dx = e.changedTouches[0].clientX - x0
      y0 = null
      if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.3) stepRef.current(dy < 0 ? 1 : -1)
    }
    const el = sectionRef.current
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
    }
  }, [stage, lock, home])

  function backToLanding() {
    setStage('landing')
  }

  // keyboard
  useEffect(() => {
    if (!visible) return
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return
      if (stage !== 'place' || !photoOn) return
      if (e.key === 'ArrowRight') goPhoto(photo + 1)
      else if (e.key === 'ArrowLeft') goPhoto(photo - 1)
      else if (e.key === 'ArrowDown' || e.key === 'PageDown') storyStep(1)
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') storyStep(-1)
      else if (e.key === 'Escape' && home) backToMemories()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* --- render ----------------------------------------------------------- */

  const skipLink = skip.startsWith('#') ? (
    <a className="jr__pill" href={skip}>
      {skipLabel}
    </a>
  ) : (
    <Link className="jr__pill" to={skip}>
      {skipLabel}
    </Link>
  )
  const noCopy = { onContextMenu: (e) => e.preventDefault(), draggable: false }
  const exitPill = (
    <button type="button" className="jr__pill" onClick={finish}>
      Exit<span className="jr__long"> the experience</span>
    </button>
  )
  const tour = site.tour || {}

  return (
    <section
      ref={sectionRef}
      className={`jr jr--${stage} jr--${variant}${use3D ? ' jr--3d' : ' jr--flat'}`}
      data-phase={phase}
      aria-label={home ? 'The tour' : name}
    >
      {/* the place: 3D, or a soft copy of the photo */}
      <div className="jr__gl" ref={glRef} aria-hidden="true" />
      {!use3D && stage === 'place' && (
        <div className="jr__flat" aria-hidden="true">
          <img src={current?.src} alt="" />
        </div>
      )}

      {/* Landing */}
      <AnimatePresence>
        {stage === 'landing' && (
          <motion.div
            key="landing"
            className={`jr__landing jr__landing--${landingStyle}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.8 } }}
            exit={{ opacity: 0, transition: { duration: 0.7 } }}
          >
            {landingStyle === 'photo' && <img className="jr__landing-photo" src={landing || items[0]?.hero} alt="" {...noCopy} />}
            <div className="jr__landing-glow" aria-hidden="true" />
            <div className="jr__landing-center">
              <motion.p className="label jr__eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.2, duration: 0.9 } }}>
                {tour.eyebrow || site.hero?.eyebrow}
              </motion.p>
              <h1 className="jr__logo">
                <motion.img
                  src="/logo-bone.png"
                  alt="Lospikir"
                  initial={reduced ? false : { clipPath: 'inset(0 100% 0 0)', opacity: 0.2, y: 10 }}
                  animate={{ clipPath: 'inset(0 0% 0 0)', opacity: 1, y: 0 }}
                  transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
                  {...noCopy}
                />
              </h1>
              <motion.p className="jr__intro" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 1.1, duration: 0.9 } }}>
                {tour.intro}
              </motion.p>
              <motion.div className="jr__landing-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: 1.4, duration: 0.8 } }}>
                <button type="button" className="btn btn--pill" onClick={startExploring}>
                  {done ? tour.replay || 'Watch it again' : tour.start || 'Start the experience'}
                </button>
                {skipLink}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {stage !== 'landing' && (
        <button type="button" className="jr__pill jr__sound" onClick={toggleSound} aria-pressed={soundOn}>
          {soundOn ? 'Sound on' : 'Sound off'}
        </button>
      )}

      {/* Memories */}
      <AnimatePresence>
        {stage === 'memories' && (
          <Memories key="memories" items={items} start={chapter} onOpen={openMemory} onBack={backToLanding} onFinish={finish} onActive={preloadSoon} skipLink={exitPill} noCopy={noCopy} />
        )}
      </AnimatePresence>

      {/* The photo flying out of its print */}
      {flight && (
        <motion.div
          className="jr__flight"
          initial={{ left: flight.from.left, top: flight.from.top, width: flight.from.width, height: flight.from.height }}
          animate={{ left: flight.to.left, top: flight.to.top, width: flight.to.width, height: flight.to.height }}
          transition={{ duration: 1.1, ease: [0.65, 0, 0.35, 1] }}
          onAnimationComplete={() => {
            setPhotoOn(true)
            requestAnimationFrame(() => setFlight(null))
          }}
        >
          <img src={flight.src} alt="" {...noCopy} />
        </motion.div>
      )}

      {/* A place */}
      <AnimatePresence>
        {stage === 'place' && (photoOn || flight) && (
          <motion.div key={`place-${chapter}`} className="pv" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.6 } }}>
            {home ? (
              <button type="button" className="jr__pill jr__back" onClick={() => backToMemories()}>
                ← Memories
              </button>
            ) : (
              <a className="jr__pill jr__back" href={allPhotos}>
                See every photo ↓
              </a>
            )}

            {home && <div className="mem__skip">{exitPill}</div>}
            <p className="pv__hint label" aria-hidden="true">Scroll to move through the story</p>
            {photos.length > 1 && (
              <>
                <button type="button" className="pv__nav pv__nav--prev" aria-label="Previous photo" disabled={photo === 0} onClick={() => goPhoto(photo - 1)}>
                  <Chevron dir={-1} />
                </button>
                <button type="button" className="pv__nav pv__nav--next" aria-label="Next photo" disabled={last} onClick={() => goPhoto(photo + 1)}>
                  <Chevron dir={1} />
                </button>
              </>
            )}
            <div className="pv__stage">
              <motion.div className="pv__frame" layout transition={SPRING} style={{ visibility: photoOn ? 'visible' : 'hidden' }}>
                <div className="pv__float">
                <AnimatePresence initial={false} custom={dir} mode="popLayout">
                  <motion.img
                    key={current?.src}
                    src={current?.src}
                    alt={altFor(current, photo)}
                    className="pv__photo"
                    custom={dir}
                    variants={reduced ? FADE : WIND}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    drag={photos.length > 1 ? 'x' : false}
                    dragSnapToOrigin
                    dragElastic={0.2}
                    onDragEnd={(_, { offset, velocity }) => {
                      const x = offset.x + project(velocity.x)
                      if (x < -80) goPhoto(photo + 1)
                      else if (x > 80) goPhoto(photo - 1)
                    }}
                    {...noCopy}
                  />
                </AnimatePresence>
                </div>
                <div className="pv__below">
                  <p className="pv__count label" aria-hidden="true">
                    {String(photo + 1).padStart(2, '0')} <span>/</span> {String(photos.length).padStart(2, '0')}
                  </p>
                  <AnimatePresence>
                    {last && home && (
                      <motion.button
                        key="more"
                        type="button"
                        className="btn btn--pill pv__more"
                        onClick={() => backToMemories()}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                      >
                        View other memories
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>

            <div className="pv__story">
              <p className="label pv__kind">{shootLine({ ...item, city: seq.locs[seq.loc[photo]]?.city || item.city })}</p>
              <h2 className="display pv__name">{name}</h2>
              <AnimatePresence mode="wait">
                <motion.p
                  key={storyLine({ ...item, city: seq.locs[seq.loc[photo]]?.city || item.city }, photo, photos.length)}
                  className="pv__line"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.45 }}
                >
                  {storyLine({ ...item, city: seq.locs[seq.loc[photo]]?.city || item.city }, photo, photos.length)}
                </motion.p>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="sr-only" aria-live="polite">
        {stage === 'place' && photoOn ? `${name}. Photo ${photo + 1} of ${photos.length}.` : ''}
      </p>
    </section>
  )
}

/**
 * Next / previous: the photo is caught by the wind — it lifts, turns and
 * blows away, and the next one drifts in, flutters and settles.
 */
const WIND = {
  enter: (d) => ({ opacity: 0, x: d * 380, y: -36, rotate: d * 8, rotateY: d * 30, rotateX: 12 }),
  center: {
    opacity: 1,
    x: 0,
    y: 0,
    rotate: 0,
    rotateY: 0,
    rotateX: 0,
    transition: { type: 'spring', stiffness: 60, damping: 11, mass: 1.15, opacity: { duration: 0.4 } },
  },
  exit: (d) => ({
    opacity: 0,
    x: -d * 640,
    y: -110,
    rotate: -d * 17,
    rotateY: -d * 38,
    rotateX: 22,
    transition: { duration: 0.8, ease: [0.5, 0, 0.75, 0.35] },
  }),
}
const FADE = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.3 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
}

/** Where the photo sits in a place, for a given aspect ratio (CSS px). Matches journey.css. */
function photoBox(aspect) {
  const W = window.innerWidth
  const H = window.innerHeight
  const phone = W <= 820
  const maxW = phone ? W * 0.9 : W * 0.56
  const maxH = phone ? H * 0.48 : H * 0.66
  const w = Math.min(maxW, maxH * aspect)
  const h = w / aspect
  const cy = phone ? H * 0.4 : H * 0.47
  return { left: (W - w) / 2, top: cy - h / 2, width: w, height: h }
}

function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d={dir > 0 ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The memories, as chapters: the chosen shoot fills the screen behind its
 * title (what it was, where, how many photos), with every chapter in a row
 * along the bottom. Scroll, swipe or use the arrow keys to move along the
 * row; Step into the shoot (or click the chosen card) goes in.
 */
function Memories({ items, start = 0, onOpen, onBack, onFinish, onActive, skipLink, noCopy }) {
  const rowRef = useRef(null)
  const bgRef = useRef(null)
  const rootRef = useRef(null)
  const cardRefs = useRef([])
  const [active, setActive] = useState(start)
  const activeRef = useRef(start)
  activeRef.current = active
  const reduced = useReducedMotion()

  const select = (i, smooth = true) => {
    const k = Math.max(0, Math.min(items.length - 1, i))
    setActive(k)
    const el = cardRefs.current[k]
    const row = rowRef.current
    if (el && row) row.scrollTo({ left: el.offsetLeft + el.offsetWidth / 2 - row.clientWidth / 2, behavior: smooth && !reduced ? 'smooth' : 'auto' })
  }
  useLayoutEffect(() => select(start, false), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onActive?.(active), [active]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = () => onOpen(activeRef.current, bgRef.current)
  const selectRef = useRef(select)
  selectRef.current = select
  const openRef = useRef(open)
  openRef.current = open

  // the wheel moves one chapter per flick; arrow keys too
  useEffect(() => {
    let acc = 0
    let last = 0
    let quietUntil = 0
    const onWheel = (e) => {
      e.preventDefault()
      const now = performance.now()
      if (now - last > 220) acc = 0
      last = now
      if (now < quietUntil) {
        quietUntil = now + 160
        return
      }
      acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (Math.abs(acc) > 45) {
        selectRef.current(activeRef.current + (acc > 0 ? 1 : -1))
        acc = 0
        quietUntil = now + 420
      }
    }
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') selectRef.current(activeRef.current + 1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') selectRef.current(activeRef.current - 1)
      else if (e.key === 'Enter' && document.activeElement === document.body) openRef.current()
      else return
      e.preventDefault()
    }
    const el = rootRef.current
    el?.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    return () => {
      el?.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const it = items[active]
  const count = it.photos?.length || 1
  const line = shootLine(it)
  const lastOne = active === items.length - 1

  return (
    <motion.div ref={rootRef} className="mx" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.7 } }} exit={{ opacity: 0, transition: { duration: 0.6 } }}>
      <AnimatePresence initial={false}>
        <motion.img
          key={it.hero}
          ref={bgRef}
          className="mx__bg"
          src={it.hero}
          alt=""
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.9 } }}
          exit={{ opacity: 0, transition: { duration: 0.9 } }}
          {...noCopy}
        />
      </AnimatePresence>
      <div className="mx__scrim" aria-hidden="true" />

      <button type="button" className="jr__pill jr__back" onClick={onBack}>
        ← Home
      </button>
      <div className="mem__skip">{skipLink}</div>

      <div className="mx__info">
        <p className="label mx__eyebrow">
          {site.tour?.memoriesEyebrow || 'Step into a shoot'} <span aria-hidden="true">·</span> Chapter {String(active + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}
        </p>
        <AnimatePresence mode="wait">
          <motion.div key={it.slug} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}>
            <h2 className="display mx__title">{it.title || it.caption}</h2>
            <p className="mx__detail">
              {line}
              {line ? ' · ' : ''}
              {count} photos
            </p>
          </motion.div>
        </AnimatePresence>
        <p className="mx__lede">{site.tour?.memoriesIntro}</p>
        <div className="mx__actions">
          <button type="button" className="btn btn--pill mx__play" onClick={open}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
            </svg>
            Step into the shoot
          </button>
          {lastOne && (
            <button type="button" className="jr__pill mx__finish" onClick={onFinish}>
              Finish the experience
            </button>
          )}
        </div>
      </div>

      <div className="mx__row" ref={rowRef} role="listbox" aria-label="Chapters">
        {items.map((m, i) => (
          <button
            key={m.slug}
            ref={(el) => (cardRefs.current[i] = el)}
            type="button"
            role="option"
            aria-selected={i === active}
            className={`mx__card${i === active ? ' is-active' : ''}`}
            onClick={() => (i === active ? open() : select(i))}
          >
            <span className="mx__thumb">
              <img src={m.hero} alt={m.alt || ''} loading={Math.abs(i - start) < 6 ? 'eager' : 'lazy'} decoding="async" {...noCopy} />
            </span>
            <span className="mx__name">{m.title || m.caption}</span>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

/** "Pre-wedding · Paris" — what kind of shoot, and the city. */
export function shootLine(it) {
  if (!it) return ''
  const kind = (it.caption || '').split(/\s+[—–-]\s+/)[0].trim()
  const parts = []
  if (kind && kind.toLowerCase() !== (it.title || '').toLowerCase()) parts.push(kind)
  // just the city — not the exact spot
  if (it.city) parts.push(it.city)
  return parts.join(' · ')
}

/**
 * The story line under a place, moving on as the photos do: what a session
 * with Wilson is like. Per gallery from the CMS ("story"), otherwise the
 * general one from site settings; {place} becomes the gallery's place.
 */
function storyLine(it, photo, count) {
  const event = /event|party|launch|corporate/i.test(it.caption || '')
  const general = (event && site.tour?.eventStory?.length ? site.tour.eventStory : site.tour?.story) || []
  const lines = it.story && it.story.length ? it.story : general
  if (!lines.length) return ''
  const i = Math.min(lines.length - 1, Math.floor((photo / Math.max(1, count)) * lines.length))
  // "The dunes and the beach" → "the dunes and the beach" mid-sentence
  const where = it.city || ((it.place || '').split(',')[0] || 'the place').replace(/^(The|A|An) /, (w) => w.toLowerCase())
  const line = lines[i].replace('{place}', where)
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/**
 * A gallery's photos in showing order, with the place each belongs to.
 *   locations: [{ scene, photos: '1-7', city?, views?: [spot…] }] — photo
 *   numbers count from 1 in the gallery's own order. Without locations the
 *   whole gallery is one place (its `scene`).
 * The moment photo (hero) comes first, then the rest of its place, then the
 * other places in order. Returns { photos, loc[i], spot[i], locs[] }, where
 * locs[k].item is what the viewer loads for that place.
 */
export function sequence(item) {
  const all = item.photos.length ? item.photos : [{ src: item.hero, alt: item.alt }]
  const parse = (r) => {
    const out = []
    for (const part of String(r ?? '').split(',')) {
      const [a, b] = part.split('-').map((n) => parseInt(n, 10))
      if (!a) continue
      for (let n = a; n <= (b || a); n++) if (n >= 1 && n <= all.length) out.push(n - 1)
    }
    return out
  }
  let locs = (item.locations || []).map((l) => ({ ...l, idx: parse(l.photos) })).filter((l) => l.idx.length)
  if (!locs.length) locs = [{ scene: item.scene, idx: all.map((_, i) => i) }]
  // photos no location claims stay with the first
  const claimed = new Set(locs.flatMap((l) => l.idx))
  all.forEach((_, i) => !claimed.has(i) && locs[0].idx.push(i))
  // the hero's place goes first, the hero first within it
  const heroAt = Math.max(0, all.findIndex((p) => p.src === item.hero))
  const hk = Math.max(0, locs.findIndex((l) => l.idx.includes(heroAt)))
  locs = [locs[hk], ...locs.filter((_, k) => k !== hk)]
  const photos = []
  const loc = []
  const spot = []
  locs.forEach((l, k) => {
    const views = Array.isArray(l.views) ? l.views : null
    const order = k === 0 && l.idx.includes(heroAt) ? [heroAt, ...l.idx.filter((i) => i !== heroAt)] : l.idx
    order.forEach((i, r) => {
      photos.push(all[i])
      loc.push(k)
      spot.push(views ? Number(views[l.idx.indexOf(i)] ?? r) : r)
    })
    const hero = k === 0 ? item.hero || all[order[0]].src : all[order[0]].src
    l.item = { ...item, scene: l.scene, hero }
  })
  return { photos, loc, spot, locs }
}
