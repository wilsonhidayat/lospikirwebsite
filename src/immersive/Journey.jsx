import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { loadExif } from './exif.js'
import { playShutter, unlockAudio } from './shutter-sound.js'
import { immersiveSupported, qualityLevel } from './support.js'
import { SPRING, project } from '../motion.js'
import '../styles/journey.css'

/**
 * The journey: a full-screen, illustrated 3D world you move through at your
 * own pace — nothing is tied to scrolling, and the page scrolls on normally
 * underneath.
 *
 *  - It opens on the sea at sunset (home page only). "Begin the journey".
 *  - Each project is a chapter set in its place. You browse its photos like
 *    reviewing shots on a camera; the world stays, the camera moves to a new
 *    viewpoint for each photo.
 *  - "Next place" travels through the clouds to the next chapter.
 *  - "Step inside" dissolves the photo into its place: drag to look around,
 *    then "Take the shot" flies back to the exact spot and fires the shutter.
 *
 * Without WebGL (or with reduced motion) the same browsing works over a soft,
 * blurred copy of the photo instead of the 3D world.
 *
 * items: galleries — { slug, title, caption, place, scene, hero, alt, photos }
 */
export default function Journey({ items, intro = true, variant = 'home', after = '#about' }) {
  const reduced = useReducedMotion()
  const sectionRef = useRef(null)
  const glRef = useRef(null)
  const flashRef = useRef(null)
  const viewerRef = useRef(null)
  const soundRef = useRef(false)

  const [use3D, setUse3D] = useState(() => immersiveSupported())
  const [stage, setStage] = useState(intro ? 'intro' : 'pick') // intro | pick | inside
  const [phase, setPhase] = useState('loading') // loading | leaving | arriving | arrived
  const [chapter, setChapter] = useState(0)
  const [photo, setPhoto] = useState(0)
  const [dir, setDir] = useState(1)
  const [exif, setExif] = useState(null)
  const [sound, setSound] = useState(false)
  const [visible, setVisible] = useState(true)

  const item = items[chapter]
  const photos = useMemo(() => {
    // the moment photo first, then the rest of the project
    const list = item.photos.length ? item.photos : [{ src: item.hero, alt: item.alt }]
    const heroIdx = list.findIndex((p) => p.src === item.hero)
    return heroIdx > 0 ? [list[heroIdx], ...list.filter((_, i) => i !== heroIdx)] : list
  }, [item])
  const current = photos[Math.min(photo, photos.length - 1)]
  const name = item.title || item.caption

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
    import('./viewer.js')
      .then(({ createViewer }) =>
        createViewer({
          canvas,
          quality: qualityLevel(),
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
        const first = intro ? { scene: 'sea', hero: null } : items[0]
        v.open(first, { photo: 0, photos: items[0].photos.length || 1 })
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

  // pause rendering off screen; resize with the window; pointer parallax
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

  // the camera settings of the photo on show
  useEffect(() => {
    let alive = true
    setExif(null)
    loadExif(current?.src).then((e) => alive && setExif(e))
    return () => {
      alive = false
    }
  }, [current?.src])

  /* --- navigation -------------------------------------------------------- */

  const goPhoto = useCallback(
    (next) => {
      const n = photos.length
      const i = ((next % n) + n) % n
      setDir(next > photo ? 1 : -1)
      setPhoto(i)
      viewerRef.current?.viewpoint(i, n)
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
      if (viewerRef.current) {
        setPhase('leaving')
        viewerRef.current.open(items[i], { photo: 0, photos: items[i].photos.length || 1 })
      } else {
        setPhase('arrived')
      }
    },
    [chapter, items]
  )

  function begin() {
    setStage('pick')
    if (viewerRef.current) {
      setPhase('leaving')
      viewerRef.current.open(items[0], { photo: 0, photos: items[0].photos.length || 1 })
    } else {
      setPhase('arrived')
    }
  }

  function stepInside() {
    // bring the whole world into view, then hold the page still while inside
    sectionRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    setStage('inside')
    document.documentElement.classList.add('jr-locked')
    viewerRef.current?.setMode('inside', { photo, photos: photos.length })
  }

  function leaveInside() {
    setStage('pick')
    document.documentElement.classList.remove('jr-locked')
    viewerRef.current?.setMode('pick', { photo, photos: photos.length })
  }

  function fire() {
    const el = flashRef.current
    if (el) {
      el.classList.remove('is-firing')
      void el.offsetWidth
      el.classList.add('is-firing')
    }
    if (soundRef.current) {
      const s = exif?.shutter
      playShutter(s ? (s.startsWith('1/') ? 1 / Number(s.slice(2)) : parseFloat(s)) : 1 / 250)
    }
  }

  async function takeTheShot() {
    const v = viewerRef.current
    setStage('returning')
    if (v) await v.returnToMoment(photo, photos.length)
    fire()
    document.documentElement.classList.remove('jr-locked')
    setStage('pick')
    v?.setMode('pick', { photo, photos: photos.length })
  }

  useEffect(() => () => document.documentElement.classList.remove('jr-locked'), [])

  // keyboard: ← → photos, [ ] or PageUp/PageDown places, Enter step inside, Esc back
  useEffect(() => {
    if (!visible && stage !== 'inside') return
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return
      if (stage === 'intro') {
        if (e.key === 'Enter') begin()
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
      else if (e.key === 'Enter' && use3D && document.activeElement === document.body) stepInside()
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
  // the playback screen appears once the camera has settled in the place
  const showChrome = stage === 'pick' && (!use3D || phase === 'arrived')
  const settings = exif ? [exif.shutter, exif.aperture, exif.iso && `ISO ${exif.iso}`, exif.focal].filter(Boolean) : []
  const slide = reduced ? 0 : 60

  return (
    <section
      ref={sectionRef}
      className={`jr jr--${stage} jr--${variant}${use3D ? ' jr--3d' : ' jr--flat'}`}
      data-phase={phase}
      aria-label={variant === 'home' ? 'Selected work' : `${name} — ${item.caption}`}
      aria-roledescription="gallery"
    >
      {/* Background: the 3D world, or a soft copy of the photo */}
      <div className="jr__flat" aria-hidden="true">
        <img src={current?.src || item.hero} alt="" />
      </div>
      <div className="jr__gl" ref={glRef} />
      <div className="jr__scrim" aria-hidden="true" />

      {/* Intro on the sea */}
      <AnimatePresence>
        {stage === 'intro' && (
          <motion.div
            className="jr__intro"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: use3D ? 1.2 : 0, duration: 1.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.6 } }}
          >
            <p className="label jr__eyebrow">Lospikir · Photography</p>
            <h1 className="display jr__headline">
              <motion.span initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0, transition: { delay: 1.6, duration: 1.1 } }}>
                Every photograph
              </motion.span>
              <motion.span initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0, transition: { delay: 2.3, duration: 1.1 } }}>
                is a place.
              </motion.span>
            </h1>
            <motion.p className="jr__lede" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 3.1, duration: 1 } }}>
              Come along to where each picture was taken — {items.length} places, from Paris to the Dutch coast.
            </motion.p>
            <motion.div className="jr__intro-actions" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 3.6, duration: 0.8 } }}>
              <button type="button" className="btn btn--pill" onClick={begin}>
                Begin the journey
              </button>
              <a className="btn btn--ghost btn--pill" href={after}>
                Skip to the studio
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chapter title card, while arriving */}
      <AnimatePresence>
        {stage === 'pick' && use3D && arriving && phase !== 'leaving' && (
          <motion.div
            key={`card-${chapter}`}
            className="jr__titlecard"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 1.2, delay: 0.4 } }}
            exit={{ opacity: 0, transition: { duration: 0.8 } }}
            aria-hidden="true"
          >
            <p className="label">
              {variant === 'home' ? `Chapter ${String(chapter + 1).padStart(2, '0')}` : item.caption}
            </p>
            <p className="display jr__titlecard-place">{item.place || item.caption}</p>
            <p className="jr__titlecard-name">{name}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Browsing: the camera's playback screen */}
      <AnimatePresence>
        {showChrome && (
          <motion.div
            key="chrome"
            className="jr__chrome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.9 } }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
          >
            <div className="jr__info">
              {variant === 'home' && (
                <p className="label jr__chapter">
                  Chapter {String(chapter + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}
                </p>
              )}
              <h2 className="display jr__name">{name}</h2>
              <p className="jr__where">
                {item.caption}
                {item.place ? ` · ${item.place}` : ''}
              </p>
              <div className="jr__actions">
                {use3D && (
                  <button type="button" className="btn btn--pill" onClick={stepInside}>
                    Step inside
                  </button>
                )}
                {variant === 'home' && (
                  <Link className="btn btn--ghost btn--pill" to={`/gallery/${item.slug}`}>
                    Open the gallery
                  </Link>
                )}
              </div>
            </div>

            <div className="jr__playback">
              <div className="jr__screen">
                <div className="jr__screen-top label">
                  <span className="jr__play" aria-hidden="true" />
                  <span>
                    {String(photo + 1).padStart(3, '0')} / {String(photos.length).padStart(3, '0')}
                  </span>
                </div>
                <div className="jr__frame">
                  <AnimatePresence initial={false} custom={dir} mode="popLayout">
                    <motion.img
                      key={current?.src}
                      src={current?.src}
                      alt={current?.alt || `${name}, ${item.caption} — photo ${photo + 1} of ${photos.length}`}
                      className="jr__photo"
                      custom={dir}
                      initial={{ opacity: 0, x: dir * slide }}
                      animate={{ opacity: 1, x: 0 }}
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
                <div className="jr__screen-bottom label">
                  {settings.length ? settings.map((s) => <span key={s}>{s}</span>) : <span>&nbsp;</span>}
                </div>
              </div>

              {photos.length > 1 && (
                <ol className="jr__strip" aria-label="Photos in this project">
                  {photos.map((p, i) => (
                    <li key={p.src + i}>
                      <button
                        type="button"
                        className={`jr__thumb${i === photo ? ' is-current' : ''}`}
                        aria-label={`Photo ${i + 1}`}
                        aria-current={i === photo}
                        onClick={() => goPhoto(i)}
                      >
                        <img src={p.src} alt="" loading="lazy" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {variant === 'home' && items.length > 1 && (
              <nav className="jr__places" aria-label="Places">
                <button
                  type="button"
                  className="jr__place-step"
                  aria-label={`Previous place: ${items[(chapter - 1 + items.length) % items.length].place || 'previous'}`}
                  onClick={() => goChapter(chapter - 1)}
                >
                  ← <span className="jr__place-name">{items[(chapter - 1 + items.length) % items.length].place?.split(',')[0] || 'Previous'}</span>
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
                        aria-label={`${it.title || it.caption}${it.place ? `, ${it.place}` : ''}`}
                        aria-current={i === chapter}
                        onClick={() => i !== chapter && goChapter(i)}
                      />
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  className="jr__place-step"
                  aria-label={`Next place: ${items[(chapter + 1) % items.length].place || 'next'}`}
                  onClick={() => goChapter(chapter + 1)}
                >
                  <span className="jr__place-name">{items[(chapter + 1) % items.length].place?.split(',')[0] || 'Next'}</span> →
                </button>
              </nav>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stepped inside */}
      {(stage === 'inside' || stage === 'returning') && (
        <div
          className="jr__inside"
          onPointerDown={onLookDown}
          onPointerMove={onLookMove}
          onPointerUp={onLookUp}
          onPointerCancel={onLookUp}
        >
          <div className="jr__inside-top">
            <button type="button" className="btn btn--ghost btn--pill" onClick={leaveInside} disabled={stage === 'returning'}>
              ← Back to the photos
            </button>
            <p className="label jr__inside-where">{item.place || item.caption}</p>
          </div>
          <p className="label jr__inside-hint">Drag to look around</p>
          <div className="jr__inside-bottom">
            <button type="button" className="btn btn--pill" onClick={takeTheShot} disabled={stage === 'returning'}>
              Take the shot
            </button>
          </div>
          {stage === 'returning' && <div className="jr__focus" aria-hidden="true" />}
        </div>
      )}

      <div className="jr__flash" ref={flashRef} aria-hidden="true" />

      <button type="button" className="jr__sound" aria-pressed={sound} onClick={toggleSound}>
        <span className="jr__sound-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {sound ? 'Sound on' : 'Sound off'}
      </button>

      <p className="sr-only" aria-live="polite">
        {stage === 'pick' ? `${name}, ${item.place || item.caption}. Photo ${photo + 1} of ${photos.length}.` : ''}
      </p>
    </section>
  )
}
