import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { animate, useReducedMotion } from 'framer-motion'
import { galleries } from '../data/galleries.js'
import { project } from '../motion.js'
import Photo from './Photo.jsx'
import '../styles/gallery.css'

/** Movement before a press becomes a drag. Below this it is still a click. */
const DRAG_SLOP = 4

/**
 * Recent galleries — a horizontal strip you scroll freely: trackpad swipe,
 * touch, the scrollbar, or click-and-drag. It does not hijack the page scroll.
 *
 * Mouse drag behaves like a thrown object, not a slider: it tracks the
 * pointer 1:1, and on release the strip keeps the hand's velocity, coasts to
 * where that throw would naturally come to rest, and settles on the nearest
 * gallery. Grab it again mid-coast and it stops under the cursor.
 * (Touch and trackpad already get this from the browser's own scrolling.)
 */
export default function PinnedGallery() {
  const trackRef = useRef(null)
  const drag = useRef(null)
  const coast = useRef(null)
  const [index, setIndex] = useState(1)
  const [dragging, setDragging] = useState(false)
  const reduced = useReducedMotion()

  const total = String(galleries.length).padStart(2, '0')

  const onScroll = useCallback(() => {
    const el = trackRef.current
    if (!el || !galleries.length) return
    const step = el.scrollWidth / galleries.length
    const i = Math.min(galleries.length, Math.floor(el.scrollLeft / step + 0.5) + 1)
    setIndex((current) => (current === i ? current : i))
  }, [])

  /** Halt any coasting and hand scroll-snap back to the browser. */
  const stopCoast = useCallback(() => {
    coast.current?.stop()
    coast.current = null
    if (trackRef.current) trackRef.current.style.scrollSnapType = ''
  }, [])

  useEffect(() => stopCoast, [stopCoast])

  /** scrollLeft at which each gallery sits flush left — the same points CSS snaps to. */
  function snapPoints(el) {
    const left = el.getBoundingClientRect().left
    const max = el.scrollWidth - el.clientWidth
    return Array.from(el.children, (child, i) =>
      i === 0
        ? 0 // keep the leading gutter on the first one
        : Math.min(max, Math.max(0, el.scrollLeft + child.getBoundingClientRect().left - left))
    )
  }

  function onPointerDown(e) {
    if (e.pointerType === 'touch' || e.button !== 0) return
    stopCoast() // grabbing a moving strip stops it where it is
    drag.current = {
      startX: e.clientX,
      startLeft: trackRef.current.scrollLeft,
      moved: 0,
      captured: false,
      samples: [{ x: e.clientX, t: e.timeStamp }],
    }
  }

  function onPointerMove(e) {
    const d = drag.current
    if (!d) return
    const el = trackRef.current
    const dx = e.clientX - d.startX
    d.moved = Math.max(d.moved, Math.abs(dx))

    // Commit to a drag only past the slop, so a slightly shaky click still
    // opens the gallery. Capture from here keeps tracking off the strip.
    if (!d.captured) {
      if (d.moved <= DRAG_SLOP) return
      d.captured = true
      el.setPointerCapture(e.pointerId)
      el.style.scrollSnapType = 'none' // snap would fight a hand-driven scrollLeft
      setDragging(true)
    }

    el.scrollLeft = d.startLeft - dx
    d.samples.push({ x: e.clientX, t: e.timeStamp })
    if (d.samples.length > 8) d.samples.shift()
  }

  function onPointerUp(e) {
    const d = drag.current
    if (!d) return
    drag.current = null
    const el = trackRef.current
    if (!d.captured) return // a click — let it through

    el.releasePointerCapture?.(e.pointerId)
    setDragging(false)

    // if this was a drag, swallow the click that follows so we don't navigate
    if (d.moved > 6) {
      const kill = (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
      }
      el.addEventListener('click', kill, { capture: true, once: true })
    }

    // Hand velocity over the last ~100ms, px/s. Holding still before letting
    // go reads as zero, so a careful placement doesn't get flung.
    d.samples.push({ x: e.clientX, t: e.timeStamp })
    const recent = d.samples.filter((s) => e.timeStamp - s.t < 100)
    let handVelocity = 0
    if (recent.length >= 2) {
      const a = recent[0]
      const b = recent[recent.length - 1]
      if (b.t > a.t) handVelocity = ((b.x - a.x) / (b.t - a.t)) * 1000
    }
    const velocity = -handVelocity // the strip scrolls opposite to the hand

    if (reduced) {
      el.style.scrollSnapType = ''
      return
    }

    // Aim for where the throw would naturally stop, then the gallery nearest
    // that — not the one nearest the release point. A flick travels.
    const from = el.scrollLeft
    const resting = from + project(velocity)
    const points = snapPoints(el)
    const target = points.reduce(
      (best, p) => (Math.abs(p - resting) < Math.abs(best - resting) ? p : best),
      points[0] ?? from
    )

    // A spring seeded with the hand's velocity: no seam between dragging
    // and coasting, and no overshoot past the gallery it lands on.
    coast.current = animate(from, target, {
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
  }

  return (
    <section className="gallery" id="work">
      <div className="gallery__head">
        <div className="label gallery__count">
          Selected work — <b>{String(index).padStart(2, '0')}</b> / {total}
        </div>
        <div className="display gallery__title">Recent galleries</div>
      </div>

      <div
        className={`gallery__track${dragging ? ' is-dragging' : ''}`}
        ref={trackRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
