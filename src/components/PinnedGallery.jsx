import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { animate, useReducedMotion } from 'framer-motion'
import { galleries } from '../data/galleries.js'
import { project } from '../motion.js'
import Photo from './Photo.jsx'
import '../styles/gallery.css'

/** Movement before a press becomes a drag. Below this it is still a click. */
const DRAG_SLOP = 6

/**
 * Recent galleries — a horizontal strip you scroll freely: trackpad swipe,
 * touch, the scrollbar, click-and-drag, or the arrow buttons. It does not
 * hijack the page scroll.
 *
 * Mouse drag behaves like a thrown object: it tracks the pointer 1:1, and on
 * release the strip keeps the hand's velocity, coasts to where that throw
 * would come to rest, and settles on the nearest gallery. Grab it again
 * mid-coast and it stops under the cursor. (Touch and trackpad already get
 * this from the browser's own scrolling.)
 *
 * Clicks: the strip never takes pointer capture. Capture makes the browser
 * deliver the click to the strip instead of the gallery link, which is what
 * broke opening a gallery. Instead, a drag is followed through window
 * listeners, and only a press that actually became a drag has its click
 * cancelled.
 */
export default function PinnedGallery() {
  const trackRef = useRef(null)
  const drag = useRef(null)
  const dragged = useRef(false)
  const coast = useRef(null)
  const [index, setIndex] = useState(1)
  const [edges, setEdges] = useState({ start: true, end: galleries.length < 2 })
  const [dragging, setDragging] = useState(false)
  const reduced = useReducedMotion()

  const total = String(galleries.length).padStart(2, '0')

  const onScroll = useCallback(() => {
    const el = trackRef.current
    if (!el || !galleries.length) return
    const step = el.scrollWidth / galleries.length
    const i = Math.min(galleries.length, Math.floor(el.scrollLeft / step + 0.5) + 1)
    setIndex((current) => (current === i ? current : i))

    const max = el.scrollWidth - el.clientWidth
    const start = el.scrollLeft <= 2
    const end = el.scrollLeft >= max - 2
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }))
  }, [])

  // Arrow states are right on first paint and after a resize.
  useEffect(() => {
    onScroll()
    window.addEventListener('resize', onScroll)
    return () => window.removeEventListener('resize', onScroll)
  }, [onScroll])

  /** Halt any coasting and hand scroll-snap back to the browser. */
  const stopCoast = useCallback(() => {
    coast.current?.stop()
    coast.current = null
    if (trackRef.current) trackRef.current.style.scrollSnapType = ''
  }, [])

  /**
   * scrollLeft at which each gallery sits at the page gutter — the same points
   * CSS snaps to (the track's scroll-padding keeps that gutter).
   */
  function snapPoints(el) {
    const left = el.getBoundingClientRect().left + (parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0)
    const max = el.scrollWidth - el.clientWidth
    return Array.from(el.children, (child) =>
      Math.round(Math.min(max, Math.max(0, el.scrollLeft + child.getBoundingClientRect().left - left)))
    )
  }

  /** Spring the strip to a scrollLeft, optionally carrying a velocity. */
  const glideTo = useCallback(
    (target, velocity = 0) => {
      const el = trackRef.current
      if (!el) return
      stopCoast()
      if (reduced) {
        el.scrollLeft = target
        return
      }
      el.style.scrollSnapType = 'none' // snap would fight a script-driven scrollLeft
      coast.current = animate(el.scrollLeft, target, {
        type: 'spring',
        velocity,
        bounce: 0,
        duration: 0.6,
        onUpdate: (x) => {
          el.scrollLeft = x
        },
        onComplete: () => {
          coast.current = null
          el.style.scrollSnapType = ''
        },
      })
    },
    [reduced, stopCoast]
  )

  /** The arrow buttons: one gallery at a time. */
  function stepBy(dir) {
    const el = trackRef.current
    if (!el) return
    const points = snapPoints(el)
    const now = el.scrollLeft
    const target =
      dir > 0
        ? points.find((p) => p > now + 2) ?? points[points.length - 1]
        : [...points].reverse().find((p) => p < now - 2) ?? 0
    glideTo(target)
  }

  function onPointerDown(e) {
    if (e.pointerType === 'touch' || e.button !== 0) return
    stopCoast() // grabbing a moving strip stops it where it is
    dragged.current = false

    const el = trackRef.current
    drag.current = {
      startX: e.clientX,
      startLeft: el.scrollLeft,
      samples: [{ x: e.clientX, t: e.timeStamp }],
    }

    const move = (ev) => {
      const d = drag.current
      if (!d) return
      const dx = ev.clientX - d.startX

      if (!dragged.current) {
        if (Math.abs(dx) <= DRAG_SLOP) return
        dragged.current = true
        el.style.scrollSnapType = 'none'
        setDragging(true)
      }

      ev.preventDefault() // no text selection while dragging
      el.scrollLeft = d.startLeft - dx
      d.samples.push({ x: ev.clientX, t: ev.timeStamp })
      if (d.samples.length > 8) d.samples.shift()
    }

    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const d = drag.current
      drag.current = null
      if (!d || !dragged.current) return // a plain click — the link handles it

      setDragging(false)

      // Hand velocity over the last ~100ms, px/s. Holding still before letting
      // go reads as zero, so a careful placement doesn't get flung.
      d.samples.push({ x: ev.clientX, t: ev.timeStamp })
      const recent = d.samples.filter((s) => ev.timeStamp - s.t < 100)
      let handVelocity = 0
      if (recent.length >= 2) {
        const a = recent[0]
        const b = recent[recent.length - 1]
        if (b.t > a.t) handVelocity = ((b.x - a.x) / (b.t - a.t)) * 1000
      }
      const velocity = -handVelocity // the strip scrolls opposite to the hand

      // Aim for where the throw would naturally stop, then the gallery nearest
      // that — not the one nearest the release point. A flick travels.
      const resting = el.scrollLeft + project(velocity)
      const points = snapPoints(el)
      const target = points.reduce(
        (best, p) => (Math.abs(p - resting) < Math.abs(best - resting) ? p : best),
        points[0] ?? el.scrollLeft
      )
      glideTo(target, velocity)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  // A press that turned into a drag must not also open the gallery under it.
  function onClickCapture(e) {
    if (!dragged.current) return
    e.preventDefault()
    e.stopPropagation()
    dragged.current = false
  }

  useEffect(() => stopCoast, [stopCoast])

  return (
    <section className="gallery" id="work">
      <div className="gallery__head">
        <div className="gallery__heading">
          <div className="label gallery__count">
            Selected work — <b>{String(index).padStart(2, '0')}</b> / {total}
          </div>
          <div className="display gallery__title">Recent galleries</div>
        </div>

        {galleries.length > 1 && (
          <div className="gallery__arrows">
            <button
              type="button"
              className="gallery__arrow"
              aria-label="Previous gallery"
              disabled={edges.start}
              onClick={() => stepBy(-1)}
            >
              ←
            </button>
            <button
              type="button"
              className="gallery__arrow"
              aria-label="Next gallery"
              disabled={edges.end}
              onClick={() => stepBy(1)}
            >
              →
            </button>
          </div>
        )}
      </div>

      <div
        className={`gallery__track${dragging ? ' is-dragging' : ''}`}
        ref={trackRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        // Any other way of scrolling takes over from a coast immediately.
        onWheel={stopCoast}
        onTouchStart={stopCoast}
      >
        {galleries.map((item) => (
          <Link className="gallery__slide" key={item.slug} to={`/gallery/${item.slug}`} draggable={false}>
            <Photo tone={item.tone} image={item.cover} caption={item.caption} parallax={0} />
            <div className="gallery__meta label">
              <span>{item.title || item.caption}</span>
              <span className="gallery__view">
                View{item.photos.length ? ` · ${item.photos.length}` : ''} →
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
