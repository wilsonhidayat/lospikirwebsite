import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { immersiveSupported, qualityLevel } from './support.js'
import { project } from '../motion.js'
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
  const [gust, setGust] = useState(0)
  const openTok = useRef(0)
  const [flight, setFlight] = useState(null) // the photo flying out of its print
  const [visible, setVisible] = useState(true)
  const [photoOn, setPhotoOn] = useState(!home) // the place's photo is showing
  // home: the page stays put until the visitor finishes or leaves the experience
  const [done, setDone] = useState(false)
  // sound: music and the place's ambience, made in the browser
  const soundRef = useRef(null)
  const [soundOn, setSoundOn] = useState(home)
  const sound = () => (soundRef.current ||= createSoundscape({ music: site.tour?.music || null }))
  // how a shoot is shown: 'places' (the modelled places), 'photo' (each photo
  // turned into 3D from its depth — the photo is the place) or 'hybrid' (the
  // photo in 3D, floating in the modelled place). Site settings → tour.mode;
  // #photo3d / #hybrid / #places (or ?mode=) to try one.
  const mode = useMemo(() => {
    const ok = ['places', 'photo', 'hybrid']
    if (typeof window === 'undefined') return site.tour?.mode || 'places'
    const q = new URLSearchParams(window.location.search).get('mode')
    const h = { '#photo3d': 'photo', '#hybrid': 'hybrid', '#places': 'places' }[window.location.hash]
    return ok.includes(q) ? q : h || (ok.includes(site.tour?.mode) ? site.tour.mode : 'places')
  }, [])
  const photoMode = mode !== 'places'
  const photo3dRef = useRef(null)
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
  // each photo's shape, so the frame is sized before the photo flies in
  const [ratios, setRatios] = useState({})
  const noteRatio = (img) => {
    const key = img?.getAttribute('src')
    if (!key || !img.naturalWidth) return
    setRatios((m) => (m[key] ? m : { ...m, [key]: img.naturalWidth / img.naturalHeight }))
  }
  const [, setViewport] = useState(0)
  useEffect(() => {
    const on = () => setViewport((n) => n + 1)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const box = (mode === 'photo' ? fullBox : photoBox)(ratios[current?.src] || 1.5)
  // the next and previous photos load before they're asked for
  useEffect(() => {
    for (const k of [photo + 1, photo - 1, photo + 2]) {
      const p = photos[k]
      if (!p || ratios[p.src]) continue
      const img = new Image()
      img.onload = () => setRatios((m) => (m[p.src] ? m : { ...m, [p.src]: img.naturalWidth / img.naturalHeight }))
      img.src = p.src
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, photos])
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

  // the photo-in-3D layer (photo and hybrid modes), above the places
  const getPhoto3D = useCallback(() => {
    if (!use3D || !photoMode) return Promise.resolve(null)
    if (photo3dRef.current) return Promise.resolve(photo3dRef.current)
    const canvas = document.createElement('canvas')
    canvas.className = 'jr__canvas jr__photo3d'
    canvas.setAttribute('aria-hidden', 'true')
    glRef.current.appendChild(canvas)
    return import('./photo3d.js').then(({ createPhoto3D }) => {
      if (photo3dRef.current) return photo3dRef.current
      const p3 = createPhoto3D({ canvas, quality: qualityLevel(), surround: mode === 'photo', box: mode === 'hybrid' ? photoBox : null })
      photo3dRef.current = p3
      p3.start()
      return p3
    })
  }, [use3D, photoMode, mode])

  useEffect(
    () => () => {
      photo3dRef.current?.dispose()
      photo3dRef.current = null
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
    if (photoMode) getPhoto3D().then((p3) => p3?.show(first.photos[0].src, 1))
    if (mode !== 'photo') getViewer().then((v) => v?.enter(first.locs[0].item, first.spot[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // pause off screen; resize; a breath of parallax with the pointer
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.intersectionRatio > 0.2), { threshold: [0, 0.2, 0.6] })
    io.observe(sectionRef.current)
    const onResize = () => {
      viewerRef.current?.resize()
      photo3dRef.current?.resize()
    }
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const onMove = (e) => {
      const x = (e.clientX / innerWidth) * 2 - 1
      const y = -((e.clientY / innerHeight) * 2 - 1)
      viewerRef.current?.setPointer(x, y)
      photo3dRef.current?.setPointer(x, y)
    }
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
    if (visible && stage === 'place' && mode !== 'photo') v.start()
    else v.stop()
  }, [visible, stage, phase])
  useEffect(() => {
    const p3 = photo3dRef.current
    if (!p3) return
    if (visible && stage === 'place') p3.start()
    else p3.stop()
  }, [visible, stage, photo])

  // like a film: the page doesn't scroll until the experience is finished or
  // left — scrolling moves the story instead
  const lock = home && !done
  useEffect(() => {
    if (lock) window.scrollTo({ top: 0, behavior: 'auto' })
    document.documentElement.classList.toggle('jr-tour', lock)
    // a menu link (Packages, Check your date) jumps down the page: that's
    // leaving the experience, so let the page go. Any other page scroll
    // (a phone's rubber-band, a stray key) snaps back and the film goes on.
    let linkAt = 0
    const onClick = (e) => {
      if (e.target.closest?.('a[href]')) linkAt = Date.now()
    }
    const onScroll = () => {
      if (!lock || window.scrollY <= 40) return
      if (Date.now() - linkAt < 2000) {
        soundRef.current?.stop()
        viewerRef.current?.leave()
        setPhotoOn(false)
        setStage('landing')
        setDone(true)
      } else {
        window.scrollTo({ top: 0, behavior: 'auto' })
      }
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.documentElement.classList.remove('jr-tour')
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('scroll', onScroll)
    }
  }, [lock])

  /* --- moving through the tour ------------------------------------------ */

  function startExploring() {
    setDone(false)
    window.scrollTo({ top: sectionRef.current.offsetTop, behavior: 'auto' })
    setChapter(0)
    setStage('memories')
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

  // the carousel turning: a soft detent per card, and that shoot's place gets ready
  const lastChapter = useRef(null)
  const onChapter = (i) => {
    if (lastChapter.current != null && lastChapter.current !== i) soundRef.current?.tick(i > lastChapter.current ? 1 : -1)
    lastChapter.current = i
    // no building places in the background here: it would stutter the carousel.
    // A place is built when the visitor steps in, after the photo's flight.
  }


  // finished, or left: back to the title, and the page scrolls on to the rest
  function finish() {
    openTok.current++
    soundRef.current?.stop()
    photo3dRef.current?.clear()
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

  function openMemory(i, imgEl, fromRect = null) {
    const it = items[i]
    const aspect = imgEl?.naturalWidth ? imgEl.naturalWidth / imgEl.naturalHeight : 0.75
    const from = fromRect || imgEl?.getBoundingClientRect()
    const first = sequence(it)
    if (imgEl?.naturalWidth) setRatios((m) => ({ ...m, [it.hero]: aspect }))
    setChapter(i)
    setPhoto(0)
    setDir(1)
    setPhotoOn(false)
    const to = mode === 'photo' ? fullBox(aspect) : photoBox(aspect)
    if (from && !reduced) setFlight({ src: it.hero, from, to })
    else setPhotoOn(true)
    setStage('place')
    setPhase('loading')
    setGust(0)
    soundRef.current?.setPlace(first.locs[0].scene)
    soundRef.current?.whoosh(1, true)
    if (mode === 'photo') {
      // the map sinks away; the photo itself becomes the place
      viewerRef.current?.leave()
      getPhoto3D().then((p3) => p3?.show(first.photos[0].src, 1))
      setPhase('arrived')
      return
    }
    // a place not built yet is heavy to build: let the photo's flight finish first
    const flying = !!(from && !reduced)
    getViewer().then((v) => {
      if (!v) return setPhase('arrived')
      const tok = ++openTok.current
      const go = () => tok === openTok.current && v.enter(first.locs[0].item, first.spot[0])
      if (!flying || v.has(first.locs[0].item)) go()
      else setTimeout(go, 1150)
    })
    if (mode === 'hybrid') getPhoto3D().then((p3) => p3?.show(first.photos[0].src, 1))
  }

  const goPhoto = useCallback(
    (next) => {
      if (next < 0 || next >= photos.length || next === photo) return
      const d = next > photo ? 1 : -1
      setDir(d)
      setPhoto(next)
      if (!reduced) setGust((g) => g + 1)
      // the wind (and the camera moving on), then a shutter as it lands
      const snd = soundRef.current
      const moving = mode !== 'photo' && seq.loc[next] !== seq.loc[photo]
      snd?.whoosh(d, moving)
      snd?.shutter(moving ? 1.6 : 1.05)
      const p3 = photo3dRef.current
      if (p3) {
        p3.show(photos[next].src, next > photo ? 1 : -1)
        if (photos[next + 1]) p3.preload(photos[next + 1].src)
      }
      if (mode === 'photo') return
      const v = viewerRef.current
      const loc = seq.loc[next]
      if (loc !== seq.loc[photo]) {
        // on to another place of the same shoot: it develops in around the photo
        soundRef.current?.setPlace(seq.locs[loc].scene)
        v?.enter(seq.locs[loc].item, seq.spot[next])
      } else v?.photo(seq.spot[next])
      // get the next place of the shoot ready before it's needed — after the
      // photo has landed, when the browser is idle
      const ahead = seq.loc[Math.min(photos.length - 1, next + 2)]
      if (ahead !== loc) setTimeout(() => idle(() => v?.preload(seq.locs[ahead].item)), 1500)
    },
    [photo, photos, seq, mode, reduced]
  )

  // back to the line of memories — on the next print when the story moves on
  function backToMemories(next = chapter) {
    openTok.current++
    setPhotoOn(false)
    photo3dRef.current?.clear()
    viewerRef.current?.leave()
    setChapter(Math.max(0, Math.min(items.length - 1, next)))
    setStage('memories')
    soundRef.current?.setPlace(null)
    soundRef.current?.whoosh(-1, true)
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
    let lastMag = 0
    const onWheel = (e) => {
      if (!lock && home) return
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
      e.preventDefault()
      const now = performance.now()
      const mag = Math.abs(e.deltaY)
      if (now - last > 200) acc = 0
      last = now
      if (now < quietUntil) {
        // a trackpad's momentum only ever fades: a sudden stronger push is a
        // new flick, and it counts at once instead of waiting the tail out
        const fresh = mag > lastMag * 1.8 + 6 && now > quietUntil - 260
        lastMag = mag
        if (!fresh) {
          quietUntil = Math.max(quietUntil, now + 120) // still the same flick
          return
        }
        quietUntil = 0
        acc = 0
      }
      lastMag = mag
      acc += e.deltaY
      if (Math.abs(acc) > 40) {
        stepRef.current(acc > 0 ? 1 : -1)
        acc = 0
        quietUntil = now + 420
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
      className={`jr jr--${stage} jr--${variant}${use3D ? ' jr--3d' : ' jr--flat'} jr--mode-${mode}`}
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
          <Memories key="memories" items={items} start={chapter} onOpen={openMemory} onBack={backToLanding} onFinish={finish} onActive={onChapter} skipLink={exitPill} noCopy={noCopy} />
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
            {gust > 0 && <Gust key={gust} dir={dir} />}
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
              <div className="pv__frame" style={{ visibility: photoOn ? 'visible' : 'hidden', width: box.width, height: box.height }}>
                <div className="pv__float" style={photoMode && use3D ? { opacity: 0 } : undefined}>
                <AnimatePresence initial={false} custom={dir}>
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
                    onLoad={(e) => noteRatio(e.currentTarget)}
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
              </div>
            </div>

            <div className="pv__story">
              <p className="label pv__kind">{shootLine({ ...item, city: seq.locs[seq.loc[photo]]?.city || item.city })}</p>
              <h2 className="display pv__name">{name}</h2>

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
const idle = (fn) => (typeof window !== 'undefined' && window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 200))
const vw = () => (typeof window === 'undefined' ? 1280 : window.innerWidth)
const WIND = {
  // blown in from the far side: it tumbles in on the gust, overshoots a
  // little, flutters and settles flat
  enter: (d) => ({
    opacity: 0,
    x: d * vw() * 0.7,
    y: 70,
    rotate: d * 18,
    rotateY: -d * 50,
    rotateX: 12,
    scale: 0.9,
    zIndex: 2,
  }),
  center: (d) => ({
    opacity: [0, 1, 1, 1, 1],
    x: [d * vw() * 0.7, d * 46, -d * 14, d * 4, 0],
    y: [70, -16, 6, -2, 0],
    rotate: [d * 18, -d * 4, d * 1.6, -d * 0.5, 0],
    rotateY: [-d * 50, d * 10, -d * 4, d * 1, 0],
    rotateX: [12, -5, 2, -0.5, 0],
    scale: [0.9, 1.01, 1, 1, 1],
    zIndex: 2,
    transition: { duration: 1.25, times: [0, 0.45, 0.68, 0.85, 1], ease: 'easeOut', delay: 0.16 },
  }),
  // caught by the wind: it lifts at the edge, curls, and is carried off
  exit: (d) => ({
    opacity: [1, 1, 0.95, 0],
    x: [0, d * 18, -d * vw() * 0.38, -d * vw() * 1.05],
    y: [0, 6, -70, -220],
    rotate: [0, d * 2, -d * 16, -d * 38],
    rotateY: [0, -d * 8, d * 38, d * 70],
    rotateX: [0, 4, 16, 28],
    scale: [1, 1, 0.94, 0.82],
    zIndex: 1,
    transition: { duration: 1, times: [0, 0.14, 0.55, 1], ease: 'easeIn' },
  }),
}

/** Streaks of wind across the screen as a photo blows away. */
function Gust({ dir }) {
  const lines = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        top: 8 + Math.random() * 78,
        len: 18 + Math.random() * 30,
        delay: i * 0.035 + Math.random() * 0.12,
        dur: 0.55 + Math.random() * 0.35,
        o: 0.18 + Math.random() * 0.3,
        h: Math.random() < 0.3 ? 2 : 1,
      })),
    []
  )
  return (
    <div className={`pv__gust pv__gust--${dir > 0 ? 'l' : 'r'}`} aria-hidden="true">
      {lines.map((l, i) => (
        <span
          key={i}
          style={{
            top: `${l.top}%`,
            width: `${l.len}vw`,
            height: l.h,
            '--o': l.o,
            animationDelay: `${l.delay}s`,
            animationDuration: `${l.dur}s`,
          }}
        />
      ))}
    </div>
  )
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

/** Photo mode: the photo as large as fits the screen (matches photo3d.js). */
function fullBox(aspect) {
  const W = window.innerWidth
  const H = window.innerHeight
  const w = Math.min(W * 0.98, H * 0.98 * aspect)
  const h = w / aspect
  return { left: (W - w) / 2, top: (H - h) / 2, width: w, height: h }
}

function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d={dir > 0 ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The memories as a 3D carousel: every shoot is a print standing on a slowly
 * turning ring. Scroll, swipe, drag or use the arrow keys to turn it; the
 * shoot at the front is lit and its name, type, city and year are written
 * beside it. Step into the shoot (or click the front print) goes in.
 */
function Memories({ items, start = 0, onOpen, onBack, onFinish, onActive, skipLink, noCopy }) {
  const rootRef = useRef(null)
  const ringRef = useRef(null)
  const cardRefs = useRef([])
  const shadeRefs = useRef([])
  const [active, setActive] = useState(start)
  const activeRef = useRef(start)
  activeRef.current = active
  const reduced = useReducedMotion()
  const n = items.length
  const STEP = 360 / n
  const target = useRef(-start * STEP)
  const shown = useRef(-start * STEP)
  const [geo, setGeo] = useState(() => ringSize(n))
  useEffect(() => {
    const on = () => setGeo(ringSize(n))
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [n])
  useEffect(() => onActive?.(active), [active]) // eslint-disable-line react-hooks/exhaustive-deps

  const norm = (d) => ((((d + 180) % 360) + 360) % 360) - 180
  const select = (i) => {
    const k = ((i % n) + n) % n
    target.current = target.current + norm(-k * STEP - target.current)
    setActive(k)
  }
  const selectRef = useRef(select)
  selectRef.current = select
  const open = () => {
    const img = cardRefs.current[activeRef.current]?.querySelector('img')
    onOpen(activeRef.current, img)
  }
  const openRef = useRef(open)
  openRef.current = open

  // turn the ring: ease toward the target, light the front, shade the rest
  useEffect(() => {
    let raf = 0
    let settled = false
    let lastT = performance.now()
    const loop = (now) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000))
      lastT = now
      // at rest: nothing to write (no style work while the visitor reads)
      const gap = target.current - shown.current
      if (Math.abs(gap) < 0.005) {
        if (settled) return
        settled = true
        shown.current = target.current
      } else settled = false
      // follow the target smoothly, the same at 60 or 120 frames a second
      shown.current += gap * (reduced ? 1 : 1 - Math.exp(-dt * 9))
      if (ringRef.current) ringRef.current.style.transform = `translateZ(${-geo.R}px) rotateY(${shown.current.toFixed(3)}deg)`
      for (let i = 0; i < n; i++) {
        const d = Math.abs(norm(i * STEP + shown.current))
        const sh = shadeRefs.current[i]
        if (sh) sh.style.opacity = Math.min(0.78, d / 70).toFixed(3)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [geo, n, STEP, reduced])

  // wheel and trackpad turn the ring continuously, then it settles on the
  // nearest print; keys step; drag and swipe turn it by hand
  useEffect(() => {
    const el = rootRef.current
    let snapTimer = 0
    const nearest = () => Math.round(-target.current / STEP)
    const follow = () => {
      const k = ((nearest() % n) + n) % n
      if (k !== activeRef.current) {
        activeRef.current = k
        setActive(k)
      }
    }
    const snap = () => {
      const k = nearest()
      target.current = -k * STEP
      follow()
    }
    const onWheel = (e) => {
      e.preventDefault()
      let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (e.deltaMode === 1) d *= 33 // lines (Firefox mice)
      else if (e.deltaMode === 2) d *= 400
      // a mouse wheel notch (~100 px) turns about one print; a trackpad glides
      d = Math.max(-140, Math.min(140, d))
      target.current -= (d / 105) * STEP
      follow()
      clearTimeout(snapTimer)
      snapTimer = setTimeout(snap, 140)
    }
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') selectRef.current(activeRef.current + 1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') selectRef.current(activeRef.current - 1)
      else if (e.key === 'Enter' && document.activeElement === document.body) openRef.current()
      else return
      e.preventDefault()
    }
    let dx = null
    let moved = 0
    const down = (e) => {
      if (e.target.closest('button, a')) return
      dx = e.clientX
      moved = 0
    }
    const move = (e) => {
      if (dx == null) return
      const d = e.clientX - dx
      moved += Math.abs(d)
      target.current += d * 0.09
      dx = e.clientX
      follow()
    }
    const up = () => {
      if (dx == null) return
      dx = null
      if (moved < 4) return
      snap()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(snapTimer)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', onKey)
    }
  }, [STEP, n])

  const it = items[active]
  const line = shootLine(it)
  const year = String(it.date || '').slice(0, 4)
  const count = it.photos?.length || 1
  const words = String(it.title || it.caption).split(/\s+/)

  return (
    <motion.div ref={rootRef} className="rx" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.7 } }} exit={{ opacity: 0, transition: { duration: 0.6 } }}>
      <div className="rx__glow" aria-hidden="true" />
      <button type="button" className="jr__pill jr__back" onClick={onBack}>
        ← Home
      </button>
      <div className="mem__skip">{skipLink}</div>

      <div className="rx__info">
        <p className="label rx__eyebrow">
          {site.tour?.memoriesEyebrow || 'Step into a shoot'} <span aria-hidden="true">·</span> {String(active + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
        </p>
          {/* keyed by the shoot: the name changes the moment the front photo does */}
          <motion.div key={it.slug} className="rx__now">
            <h2 className="display rx__title" aria-label={it.title || it.caption}>
              {words.map((w, k) => (
                <span className="mx__word" key={k} aria-hidden="true">
                  <motion.span initial={reduced ? false : { y: '105%' }} animate={{ y: '0%' }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: 0.03 * k }}>
                    {w}
                  </motion.span>
                </span>
              ))}
            </h2>
            <motion.p className="mx__meta" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.35 } }}>
              {[line, `${count} photos`, year].filter(Boolean).map((m, k) => (
                <span key={k}>{m}</span>
              ))}
            </motion.p>
          </motion.div>
        <div className="mx__actions">
          <button type="button" className="btn btn--pill mx__play" onClick={open}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
            </svg>
            Step into the shoot
          </button>
          {active === n - 1 && (
            <button type="button" className="jr__pill mx__finish" onClick={onFinish}>
              Finish the experience
            </button>
          )}
        </div>
      </div>

      <div className="rx__stage" aria-hidden="false">
        <div className="rx__ring" ref={ringRef} role="listbox" aria-label="Shoots">
          {items.map((m, i) => (
            <button
              key={m.slug}
              ref={(el) => (cardRefs.current[i] = el)}
              type="button"
              role="option"
              aria-selected={i === active}
              aria-label={m.title || m.caption}
              className={`rx__card${i === active ? ' is-active' : ''}`}
              style={{
                width: geo.w,
                height: geo.h,
                marginLeft: -geo.w / 2,
                marginTop: -geo.h / 2,
                transform: `rotateY(${i * STEP}deg) translateZ(${geo.R}px)`,
              }}
              onClick={() => (i === active ? open() : select(i))}
            >
              <img src={m.hero} alt="" loading={Math.abs(i - start) < 4 ? 'eager' : 'lazy'} decoding="async" {...noCopy} />
              <span className="rx__reflect" style={{ backgroundImage: `linear-gradient(0deg, rgba(11, 9, 8, 0.1) 0%, rgba(11, 9, 8, 1) 75%), url("${m.hero}")` }} aria-hidden="true" />
              <span className="rx__shade" ref={(el) => (shadeRefs.current[i] = el)} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

    </motion.div>
  )
}

/** The ring's card size and radius for this screen. */
function ringSize(n) {
  const W = typeof window === 'undefined' ? 1280 : window.innerWidth
  const H = typeof window === 'undefined' ? 800 : window.innerHeight
  const phone = W <= 820
  const h = Math.round(Math.min(H * (phone ? 0.42 : 0.46), 500))
  const w = Math.round(h * 0.78)
  const gap = w * (phone ? 0.18 : 0.26)
  const R = Math.max((n * (w + gap)) / (2 * Math.PI), phone ? 300 : 520)
  return { w, h, R }
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

