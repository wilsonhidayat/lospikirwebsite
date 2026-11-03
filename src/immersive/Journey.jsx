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

  // the shape of every project's moment photo, known before the memories show
  const [aspects, setAspects] = useState(() => items.map(() => 0))
  useEffect(() => {
    if (!home) return
    let alive = true
    items.forEach((it, i) => {
      const img = new Image()
      img.onload = () => alive && setAspects((a) => a.map((v, k) => (k === i ? img.naturalWidth / img.naturalHeight : v)))
      img.src = it.hero
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    getViewer().then((v) => v?.enter(items[0]))
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
      snd.setPlace(stage === 'place' ? item.scene : null)
    }
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
    setChapter(i)
    setPhoto(0)
    setDir(1)
    setPhotoOn(false)
    if (from && !reduced) setFlight({ src: it.hero, from, to: photoBox(aspect) })
    else setPhotoOn(true)
    setStage('place')
    setPhase('loading')
    soundRef.current?.setPlace(it.scene)
    getViewer().then((v) => (v ? v.enter(it) : setPhase('arrived')))
  }

  const goPhoto = useCallback(
    (next) => {
      if (next < 0 || next >= photos.length || next === photo) return
      setDir(next > photo ? 1 : -1)
      setPhoto(next)
      viewerRef.current?.photo(next)
    },
    [photo, photos]
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
          <Memories key="memories" items={items} aspects={aspects} start={chapter} onOpen={openMemory} onBack={backToLanding} onFinish={finish} skipLink={exitPill} noCopy={noCopy} />
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
            <div className="pv__stage">
              <motion.div className="pv__frame" layout transition={SPRING} style={{ visibility: photoOn ? 'visible' : 'hidden' }}>
                <AnimatePresence initial={false} custom={dir} mode="popLayout">
                  <motion.img
                    key={current?.src}
                    src={current?.src}
                    alt={altFor(current, photo)}
                    className="pv__photo"
                    custom={dir}
                    initial={{ opacity: 0, x: dir * 90, rotateY: dir * 10 }}
                    animate={{ opacity: 1, x: 0, rotateY: 0 }}
                    exit={{ opacity: 0, x: -dir * 90, rotateY: -dir * 10 }}
                    transition={SPRING}
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
                {photos.length > 1 && photo > 0 && (
                  <button type="button" className="pv__arrow pv__arrow--prev" aria-label="Previous photo" onClick={() => goPhoto(photo - 1)}>
                    <Chevron dir={-1} />
                  </button>
                )}
                {photos.length > 1 && !last && (
                  <button type="button" className="pv__arrow pv__arrow--next" aria-label="Next photo" onClick={() => goPhoto(photo + 1)}>
                    <Chevron dir={1} />
                  </button>
                )}
                <p className="pv__credit">
                  © <img src="/logo-bone.png" alt="Lospikir" {...noCopy} />
                </p>
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
              <p className="label pv__kind">{shootLine(item)}</p>
              <h2 className="display pv__name">{name}</h2>
              <AnimatePresence mode="wait">
                <motion.p
                  key={storyLine(item, photo, photos.length)}
                  className="pv__line"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.45 }}
                >
                  {storyLine(item, photo, photos.length)}
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
 * The memories: a long line of twine with every project hanging from it as
 * an instant print. Scroll sideways (wheel, trackpad, drag, swipe, arrow
 * keys); the print in the middle comes forward and its name is written large
 * beneath. Click it to go in.
 */
function Memories({ items, aspects, start = 0, onOpen, onBack, onFinish, skipLink, noCopy }) {
  const trackRef = useRef(null)
  const lineRef = useRef(null)
  const wallRef = useRef(null)
  const cardRefs = useRef([])
  const [active, setActive] = useState(start)
  const wide = aspects.map((a) => a > 1.1)
  const drag = useRef(null)
  const activeRef = useRef(start)

  // centre the starting print before the first paint
  useLayoutEffect(() => {
    const el = cardRefs.current[start]
    const track = trackRef.current
    if (el && track) track.scrollLeft = el.offsetLeft + el.offsetWidth / 2 - track.clientWidth / 2
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // each print leans back the further it is from the middle
  useEffect(() => {
    const track = trackRef.current
    let raf = 0
    const update = () => {
      raf = 0
      const mid = track.clientWidth / 2
      let best = 0
      let bestD = Infinity
      cardRefs.current.forEach((el, i) => {
        if (!el) return
        const c = el.offsetLeft + el.offsetWidth / 2 - track.scrollLeft
        const d = (c - mid) / Math.max(1, el.offsetWidth)
        const a = Math.min(1, Math.abs(d))
        el.style.setProperty('--d', d.toFixed(3))
        el.style.setProperty('--a', a.toFixed(3))
        el.style.zIndex = String(100 - Math.round(Math.abs(d) * 10))
        if (Math.abs(d) < bestD) {
          bestD = Math.abs(d)
          best = i
        }
      })
      // the wall moves with the line (a little slower: it sits behind it)
      if (wallRef.current) wallRef.current.style.backgroundPosition = `${(-track.scrollLeft * 0.9).toFixed(1)}px 0`
      if (best !== activeRef.current) {
        activeRef.current = best
        setActive(best)
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    // the twine runs the whole length of the line
    const sizeLine = () => drawLine(track, lineRef.current, cardRefs.current)
    sizeLine()
    const ro = new ResizeObserver(() => {
      sizeLine()
      onScroll()
    })
    ro.observe(track)
    // a vertical wheel scrolls the line sideways
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      track.scrollBy({ left: e.deltaY * 1.1, behavior: 'auto' })
    }
    update()
    track.addEventListener('scroll', onScroll, { passive: true })
    track.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', onScroll)
    return () => {
      track.removeEventListener('scroll', onScroll)
      track.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onScroll)
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  // the prints change width once their photos' shapes are known: keep the
  // active one in the middle
  const wideKey = wide.join()
  useLayoutEffect(() => {
    const el = cardRefs.current[activeRef.current]
    const track = trackRef.current
    if (track) drawLine(track, lineRef.current, cardRefs.current)
    if (el && track) track.scrollLeft = el.offsetLeft + el.offsetWidth / 2 - track.clientWidth / 2
    track?.dispatchEvent(new Event('scroll'))
  }, [wideKey])

  const centre = (i, smooth = true) => {
    const el = cardRefs.current[i]
    const track = trackRef.current
    if (!el || !track) return
    track.scrollTo({ left: el.offsetLeft + el.offsetWidth / 2 - track.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' })
  }

  // keyboard: ← → move along the line, Enter opens
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return
      if (e.key === 'ArrowRight') centre(Math.min(items.length - 1, activeRef.current + 1))
      else if (e.key === 'ArrowLeft') centre(Math.max(0, activeRef.current - 1))
      else if (e.key === 'Enter' && document.activeElement === document.body) {
        const el = cardRefs.current[activeRef.current]
        onOpen(activeRef.current, el?.querySelector('img'))
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // mouse drag (touch scrolls natively)
  const onDown = (e) => {
    if (e.pointerType !== 'mouse') return
    drag.current = { x: e.clientX, left: trackRef.current.scrollLeft, moved: false }
  }
  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > 5) d.moved = true
    trackRef.current.scrollLeft = d.left - dx
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.moved) centre(activeRef.current)
  }

  const click = (i, e) => {
    if (drag.current?.moved) return
    if (i !== activeRef.current) centre(i)
    else onOpen(i, e.currentTarget.querySelector('img'))
  }

  const it = items[active]

  return (
    <motion.div className="mem" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.7 } }} exit={{ opacity: 0, transition: { duration: 0.6 } }}>
      <div className="mem__wall" ref={wallRef} aria-hidden="true" />
      <div className="mem__light" aria-hidden="true" />
      <button type="button" className="jr__pill jr__back" onClick={onBack}>
        ← Home
      </button>
      <div className="mem__skip">{skipLink}</div>
      <div className="mem__intro">
        <p className="label mem__eyebrow">{site.tour?.memoriesEyebrow || 'Step into a shoot'}</p>
        <p className="mem__lede">{site.tour?.memoriesIntro}</p>
      </div>

      <div className="mem__track" ref={trackRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
        <svg className="mem__line" ref={lineRef} aria-hidden="true" />
        {items.map((m, i) => (
          <button
            key={m.slug}
            ref={(el) => (cardRefs.current[i] = el)}
            type="button"
            className={`mem__card${wide[i] ? ' mem__card--wide' : ''}${i === active ? ' is-active' : ''}`}
            style={{ '--sway': `${(i * 0.73) % 2}s` }}
            onClick={(e) => click(i, e)}
            aria-label={i === active ? `Open ${m.title || m.caption}` : m.title || m.caption}
          >
            <span className="mem__peg" aria-hidden="true" />
            <span className="mem__print">
              <span className="mem__window">
                <img
                  src={m.hero}
                  alt={m.alt || ''}
                  loading={Math.abs(i - start) < 4 ? 'eager' : 'lazy'}
                  decoding="async"
                  {...noCopy}
                />
              </span>
              <span className="mem__hand">{m.title || m.caption}</span>
              <span className="mem__shade" aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>

      <div className="mem__caption">
        <AnimatePresence mode="wait">
          <motion.h2
            key={it.slug}
            className="display mem__name"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35 }}
          >
            {it.title || it.caption}
          </motion.h2>
        </AnimatePresence>
        <p className="mem__detail">{shootLine(it)}</p>
        <p className="mem__meta label">
          {String(active + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}
          <span aria-hidden="true"> · </span>
          <span className="mem__hint">Click the print to step in</span>
        </p>
        <AnimatePresence>
          {active === items.length - 1 && (
            <motion.button key="fin" type="button" className="btn btn--pill mem__finish" onClick={onFinish} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              Finish the experience
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

/**
 * The string of fairy lights: a wire that sags between the pegs, with a warm
 * bulb every ~50 px and the glow each bulb throws on the wall.
 */
const SVG_NS = 'http://www.w3.org/2000/svg'
function drawLine(track, svg, cards) {
  if (!svg || !track) return
  const W = track.scrollWidth
  const Y = 24 // where the pegs grip the wire
  const pegs = cards.filter(Boolean).map((el) => el.offsetLeft + el.offsetWidth / 2)
  const pts = [0, ...pegs, W]
  let d = `M0 ${Y + 10}`
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const sag = Math.min(46, (b - a) * 0.075)
    const ya = i === 1 ? Y + 10 : Y
    const yb = i === pts.length - 1 ? Y + 10 : Y
    d += ` Q${((a + b) / 2).toFixed(1)} ${(Math.max(ya, yb) + sag * 2).toFixed(1)} ${b.toFixed(1)} ${yb}`
  }
  svg.setAttribute('width', W)
  svg.setAttribute('height', 140)
  svg.setAttribute('viewBox', `0 0 ${W} 140`)
  svg.style.width = `${W}px`
  svg.innerHTML = `
    <defs>
      <radialGradient id="mem-glow"><stop offset="0" stop-color="#ffd9a0" stop-opacity="0.9"/><stop offset="0.35" stop-color="#ffb866" stop-opacity="0.32"/><stop offset="1" stop-color="#ff9a40" stop-opacity="0"/></radialGradient>
      <radialGradient id="mem-pool"><stop offset="0" stop-color="#ffbe7a" stop-opacity="0.16"/><stop offset="1" stop-color="#ffbe7a" stop-opacity="0"/></radialGradient>
      <radialGradient id="mem-bulb" cx="0.4" cy="0.35"><stop offset="0" stop-color="#fffaf0"/><stop offset="0.6" stop-color="#ffe2b0"/><stop offset="1" stop-color="#e7a35a"/></radialGradient>
    </defs>
    <g class="mem__pools"></g>
    <path d="${d}" fill="none" stroke="#1c1612" stroke-width="2.2" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="#5a4636" stroke-width="0.8" stroke-linecap="round" transform="translate(0 -0.6)"/>
    <g class="mem__bulbs"></g>`
  const path = svg.querySelectorAll('path')[0]
  const pools = svg.querySelector('.mem__pools')
  const bulbs = svg.querySelector('.mem__bulbs')
  const len = path.getTotalLength()
  let poolsHtml = ''
  let bulbsHtml = ''
  let k = 0
  for (let s = 18; s < len; s += 52, k++) {
    const p = path.getPointAtLength(s)
    const x = p.x.toFixed(1)
    const y = (p.y + 7).toFixed(1)
    poolsHtml += `<circle cx="${x}" cy="${(p.y + 30).toFixed(1)}" r="70" fill="url(#mem-pool)"/>`
    bulbsHtml += `<g class="mem__bulb" style="--k:${(k * 0.37) % 3}s"><line x1="${x}" y1="${p.y.toFixed(1)}" x2="${x}" y2="${(p.y + 4).toFixed(1)}" stroke="#1c1612" stroke-width="1.6"/><circle class="mem__halo" cx="${x}" cy="${y}" r="15" fill="url(#mem-glow)"/><ellipse cx="${x}" cy="${y}" rx="2.6" ry="3.4" fill="url(#mem-bulb)"/></g>`
  }
  pools.innerHTML = poolsHtml
  bulbs.innerHTML = bulbsHtml
}

/** "Pre-wedding · Trocadéro, Paris" — what kind of shoot, and where. */
export function shootLine(it) {
  if (!it) return ''
  const kind = (it.caption || '').split(/\s+[—–-]\s+/)[0].trim()
  const parts = []
  if (kind && kind.toLowerCase() !== (it.title || '').toLowerCase()) parts.push(kind)
  if (it.place) parts.push(it.place)
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
  const where = ((it.place || '').split(',')[0] || 'the place').replace(/^(The|A|An) /, (w) => w.toLowerCase())
  return lines[i].replace('{place}', where)
}
