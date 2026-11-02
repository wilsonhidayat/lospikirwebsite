import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { totalScreens, BEAT } from './timeline.js'
import { loadExif } from './exif.js'
import { playShutter, unlockAudio } from './shutter-sound.js'
import { qualityLevel } from './support.js'
import Viewfinder from './Viewfinder.jsx'
import '../styles/immersive.css'

/**
 * The immersive opening. A tall section that scrolls through a sticky,
 * full-screen stage: the camera turns to face you, you move through its lens
 * into the place each photograph was taken, the shutter fires, and the place
 * becomes the photograph.
 *
 * chapters: [{ slug, title, caption, place, scene, hero }]
 * variant: 'home' (several projects, ends at the packages) or
 *          'gallery' (one project, ends at its photos)
 * onFail: called if WebGL fails, so the page can show the classic version
 */
export default function Immersive({ chapters, variant = 'home', skipTo = '#packages', skipLabel = 'Skip to packages', onFail }) {
  const sectionRef = useRef(null)
  const stageRef = useRef(null)
  const glRef = useRef(null)
  const flashRef = useRef(null)
  const engineRef = useRef(null)
  const progressRef = useRef(0)
  const lastRef = useRef(null)
  const soundRef = useRef(false)
  const exifRef = useRef([])

  const [loaded, setLoaded] = useState(0)
  const [ready, setReady] = useState(false)
  const [active, setActive] = useState({ chapter: 0, phase: 'intro' })
  const [sound, setSound] = useState(false)
  const [exif, setExif] = useState([])

  const n = chapters.length
  const screens = totalScreens(n)

  // Camera settings for each photograph, read from its EXIF
  useEffect(() => {
    let alive = true
    Promise.all(chapters.map((c) => loadExif(c.hero))).then((list) => {
      if (!alive) return
      exifRef.current = list
      setExif(list)
    })
    return () => {
      alive = false
    }
  }, [chapters])

  // The shutter: a white flash, a blink, and (if sound is on) the click
  const fire = useCallback((i) => {
    const el = flashRef.current
    if (el) {
      el.classList.remove('is-firing')
      // restart the animation
      void el.offsetWidth
      el.classList.add('is-firing')
    }
    if (soundRef.current) {
      const s = exifRef.current[i]?.shutter
      const seconds = s ? (s.startsWith('1/') ? 1 / Number(s.slice(2)) : parseFloat(s)) : 1 / 250
      playShutter(seconds)
    }
  }, [])

  // Every rendered frame: push the timeline's values into CSS variables
  const onFrame = useCallback(
    (s) => {
      const stage = stageRef.current
      if (!stage) return
      const st = stage.style
      st.setProperty('--imm-black', s.black.toFixed(3))
      st.setProperty('--imm-photo', s.photo.toFixed(3))
      st.setProperty('--imm-hud', s.hud.toFixed(3))
      st.setProperty('--imm-caption', s.caption.toFixed(3))
      st.setProperty('--imm-intro', s.phase === 'intro' ? (1 - Math.min(1, Math.max(0, (s.t - 0.42) / 0.22))).toFixed(3) : '0')
      st.setProperty('--imm-lock', s.t > BEAT.flightEnd - 0.05 && s.phase !== 'intro' ? '1' : '0')
      st.setProperty('--imm-lens', s.lens.toFixed(3))

      const last = lastRef.current
      if (last && last.chapter === s.chapter && last.t < BEAT.shutter && s.t >= BEAT.shutter && s.phase !== 'intro') {
        fire(s.chapter)
      }
      if (!last || last.chapter !== s.chapter || last.phase !== s.phase) {
        setActive({ chapter: s.chapter, phase: s.phase })
      }
      lastRef.current = s
    },
    [fire]
  )

  // Boot the engine (three.js loads only now, in its own chunk). Each boot
  // gets its own canvas — and so its own WebGL context — and can be aborted
  // mid-load, so a remount (or React StrictMode in development) never has two
  // renderers sharing one context.
  useEffect(() => {
    const host = glRef.current
    const canvas = document.createElement('canvas')
    canvas.className = 'imm__canvas'
    canvas.setAttribute('aria-hidden', 'true')
    host.appendChild(canvas)
    const abort = new AbortController()
    let engine = null

    import('./engine.js')
      .then(({ createEngine }) =>
        abort.signal.aborted
          ? null
          : createEngine({
              canvas,
              chapters,
              quality: qualityLevel(),
              signal: abort.signal,
              onLoad: (f) => !abort.signal.aborted && setLoaded(f),
              onFrame,
              onError: (err) => {
                console.error(err)
                if (!abort.signal.aborted) onFail?.(err)
              },
            })
      )
      .then((e) => {
        if (!e) return
        if (abort.signal.aborted) {
          e.dispose()
          return
        }
        engine = e
        engineRef.current = e
        e.setProgress(progressRef.current)
        e.start()
        setReady(true)
      })
      .catch((err) => {
        console.error(err)
        if (!abort.signal.aborted) onFail?.(err)
      })

    return () => {
      abort.abort()
      engineRef.current = null
      engine?.dispose()
      canvas.remove()
    }
    // chapters are fixed for the life of the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scroll → progress
  useEffect(() => {
    const section = sectionRef.current
    const update = () => {
      const r = section.getBoundingClientRect()
      const range = r.height - window.innerHeight
      const p = range > 0 ? Math.min(1, Math.max(0, -r.top / range)) : 0
      progressRef.current = p
      engineRef.current?.setProgress(p)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  // Resize, run only while on screen, pointer parallax on real pointers
  useEffect(() => {
    if (!ready) return
    const engine = engineRef.current
    const onResize = () => engine?.resize()
    window.addEventListener('resize', onResize)
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? engine?.start() : engine?.stop()), {
      rootMargin: '100px',
    })
    io.observe(sectionRef.current)
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const onMove = (e) => engine?.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1))
    if (fine) window.addEventListener('pointermove', onMove, { passive: true })
    const onVisibility = () => (document.hidden ? engine?.stop() : engine?.start())
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', onVisibility)
      io.disconnect()
    }
  }, [ready])

  function toggleSound() {
    const next = !sound
    if (next) unlockAudio()
    soundRef.current = next
    setSound(next)
  }

  const ch = chapters[active.chapter] || chapters[0]
  const chExif = exif[active.chapter]
  const settings = useMemo(
    () => (chExif ? [chExif.shutter, chExif.aperture, chExif.iso && `ISO ${chExif.iso}`, chExif.focal].filter(Boolean).join(' · ') : ''),
    [chExif]
  )
  const pct = Math.round(loaded * 100)

  return (
    <section
      className={`imm imm--${variant}`}
      ref={sectionRef}
      style={{ height: `${(screens + 1) * 100}vh` }}
      aria-label={variant === 'home' ? 'Selected work, as an immersive sequence' : `${ch.title || ch.caption}, as an immersive sequence`}
    >
      <a className="imm__skip-link" href={skipTo}>
        Skip the 3D sequence
      </a>

      <div className="imm__stage" ref={stageRef} data-phase={active.phase}>
        <div className="imm__gl" ref={glRef} />

        {/* Intro */}
        <div className="imm__intro">
          <p className="label imm__eyebrow">Lospikir · Photography</p>
          <h2 className="display imm__headline">
            <span>Every photograph</span>
            <span>is a place.</span>
          </h2>
          <p className="imm__hint">Scroll to step inside</p>
        </div>

        {/* Chapter caption, shown while the camera faces you */}
        <div className="imm__caption" aria-live="polite">
          <p className="label imm__count">
            {String(active.chapter + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
          </p>
          <h2 className="display imm__title">{ch.title || ch.caption}</h2>
          <p className="imm__place">
            {ch.caption}
            {ch.place ? ` · ${ch.place}` : ''}
          </p>
        </div>

        <Viewfinder exif={chExif} index={active.chapter} total={n} />

        {/* The photograph the place becomes */}
        <div className="imm__photo" aria-hidden={active.phase !== 'photo'}>
          <figure className="imm__print">
            {ch.hero && <img src={ch.hero} alt={ch.alt || `${ch.title || ch.caption}, ${ch.place || ch.caption}`} />}
          </figure>
          <div className="imm__meta">
            <h3 className="display imm__meta-title">{ch.title || ch.caption}</h3>
            <p className="imm__meta-place">{ch.place || ch.caption}</p>
            {settings && <p className="label imm__meta-exif">{settings}</p>}
            {variant === 'home' ? (
              <Link className="btn btn--pill imm__cta" to={`/gallery/${ch.slug}`} tabIndex={active.phase === 'photo' ? 0 : -1}>
                View the gallery
              </Link>
            ) : (
              <a className="btn btn--pill imm__cta" href={skipTo} tabIndex={active.phase === 'photo' ? 0 : -1}>
                See every photograph
              </a>
            )}
          </div>
        </div>

        <div className="imm__flash" ref={flashRef} aria-hidden="true" />
        <div className="imm__black" aria-hidden="true" />

        {!ready && (
          <div className="imm__loader" role="status">
            <span className="imm__loader-mark">LOSPIKIR</span>
            <span className="imm__loader-bar">
              <i style={{ transform: `scaleX(${loaded})` }} />
            </span>
            <span className="label imm__loader-pct">{pct}%</span>
          </div>
        )}

        <div className="imm__controls">
          <a className="imm__skip" href={skipTo}>
            {skipLabel}
          </a>
          <button type="button" className="imm__sound" aria-pressed={sound} onClick={toggleSound}>
            <span className="imm__sound-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {sound ? 'Sound on' : 'Sound off'}
          </button>
        </div>
      </div>

      {/* For screen readers and search engines: the same projects, as a list */}
      <ol className="sr-only">
        {chapters.map((c) => (
          <li key={c.slug}>
            <Link to={`/gallery/${c.slug}`}>
              {c.title || c.caption} — {c.caption}
              {c.place ? `, ${c.place}` : ''}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
