import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion'
import { galleries } from '../data/galleries.js'
import { useTrackTravel } from '../hooks/useTrackTravel.js'
import Photo from './Photo.jsx'
import '../styles/gallery.css'

export default function PinnedGallery() {
  const sectionRef = useRef(null)
  const trackRef = useRef(null)
  const travel = useTrackTravel(trackRef)
  const [index, setIndex] = useState(1)

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  })

  const x = useTransform(scrollYProgress, [0, 1], [0, -travel])

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    const next = Math.min(
      galleries.length,
      Math.floor(value * galleries.length * 0.999) + 1
    )
    setIndex((current) => (current === next ? current : next))
  })

  const total = String(galleries.length).padStart(2, '0')

  return (
    <section
      className="gallery"
      id="work"
      ref={sectionRef}
      style={{ height: `calc(100svh + ${travel}px)` }}
    >
      <div className="gallery__stage">
        <div className="gallery__head">
          <div className="label gallery__count">
            Selected work — <b>{String(index).padStart(2, '0')}</b> / {total}
          </div>
          <div className="display gallery__title">Recent galleries</div>
        </div>

        <motion.div className="gallery__track" ref={trackRef} style={{ x }}>
          {galleries.map((item, i) => (
            <Link className="gallery__slide" key={item.slug} to={`/gallery/${item.slug}`}>
              <Photo
                tone={item.tone}
                image={item.cover}
                caption={item.caption}
                parallax={0}
              />
              <div className="gallery__meta label">
                <span>{item.title || item.caption}</span>
                <span className="gallery__view">
                  View{item.photos.length ? ` · ${item.photos.length}` : ''} →
                </span>
              </div>
            </Link>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
