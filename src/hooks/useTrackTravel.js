import { useCallback, useEffect, useState } from 'react'

/**
 * How far a horizontal track has to slide before its last item is on screen.
 * Measured from the real DOM, so adding or removing gallery entries needs no
 * other change — the pinned section simply gets longer or shorter.
 */
export function useTrackTravel(trackRef) {
  const [travel, setTravel] = useState(0)

  const measure = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const overflow = track.scrollWidth - window.innerWidth
    setTravel(Math.max(0, overflow + 40))
  }, [trackRef])

  useEffect(() => {
    measure()

    window.addEventListener('resize', measure)

    // Re-measure once images have decoded, which changes the track width.
    const images = trackRef.current?.querySelectorAll('img') ?? []
    images.forEach((img) => img.addEventListener('load', measure))

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (observer && trackRef.current) observer.observe(trackRef.current)

    return () => {
      window.removeEventListener('resize', measure)
      images.forEach((img) => img.removeEventListener('load', measure))
      observer?.disconnect()
    }
  }, [measure, trackRef])

  return travel
}
