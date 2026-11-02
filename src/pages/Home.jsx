import { useState } from 'react'
import Hero from '../components/Hero.jsx'
import Statement from '../components/Statement.jsx'
import PinnedGallery from '../components/PinnedGallery.jsx'
import Packages from '../components/Packages.jsx'
import Investment from '../components/Investment.jsx'
import Closing from '../components/Closing.jsx'
import Enquire from '../components/Enquire.jsx'
import Immersive from '../immersive/Immersive.jsx'
import { immersiveSupported } from '../immersive/support.js'
import { featuredGalleries } from '../data/galleries.js'

export default function Home() {
  // The 3D sequence where the browser can run it; the classic hero otherwise
  // (reduced motion, no WebGL 2, Data Saver, ?classic, or if it fails).
  const [immersive, setImmersive] = useState(() => featuredGalleries.length > 0 && immersiveSupported())

  return (
    <main>
      {immersive ? (
        <Immersive chapters={featuredGalleries} onFail={() => setImmersive(false)} />
      ) : (
        <Hero />
      )}
      <Statement />
      <PinnedGallery />
      <Packages />
      <Investment />
      <Closing />
      <Enquire />
    </main>
  )
}
