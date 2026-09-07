import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { galleries } from '../data/galleries.js'
import Photo from './Photo.jsx'
import '../styles/gallery.css'

/**
 * Recent galleries — a horizontal strip you scroll freely: trackpad swipe,
 * touch, the scrollbar, or click-and-drag. It does not hijack the page scroll.
 */
export default function PinnedGallery() {
  const trackRef = useRef(null)
  const drag = useRef(null)
  const [index, setIndex] = useState(1)

  const total = String(galleries.length).padStart(2, '0')

  const onScroll = useCallback(() => {
    const el = trackRef.current
    if (!el || !galleries.length) return
    const step = el.scrollWidth / galleries.length
    const i = Math.min(galleries.length, Math.floor(el.scrollLeft / step + 0.5) + 1)
    setIndex((current) => (current === i ? current : i))
  }, [])

  function onPointerDown(e) {
    if (e.pointerType === 'touch') return
    const el = trackRef.current
    drag.current = { startX: e.clientX, startLeft: el.scrollLeft, moved: 0 }
    el.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    if (!drag.current) return
    const dx = e.clientX - drag.current.startX
    drag.current.moved = Math.max(drag.current.moved, Math.abs(dx))
    trackRef.current.scrollLeft = drag.current.startLeft - dx
  }

  function onPointerUp(e) {
    if (!drag.current) return
    trackRef.current.releasePointerCapture?.(e.pointerId)
    // if this was a drag, swallow the click that follows so we don't navigate
    if (drag.current.moved > 6) {
      const kill = (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
      }
      trackRef.current.addEventListener('click', kill, { capture: true, once: true })
    }
    drag.current = null
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
        className="gallery__track"
        ref={trackRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
