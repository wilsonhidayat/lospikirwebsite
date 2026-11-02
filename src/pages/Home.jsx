import Statement from '../components/Statement.jsx'
import PinnedGallery from '../components/PinnedGallery.jsx'
import Packages from '../components/Packages.jsx'
import Investment from '../components/Investment.jsx'
import Closing from '../components/Closing.jsx'
import Enquire from '../components/Enquire.jsx'
import Journey from '../immersive/Journey.jsx'
import { journeyGalleries } from '../data/galleries.js'

export default function Home() {
  return (
    <main>
      {/* The journey: every project as a chapter in the place it was shot.
          It handles its own fallback (no WebGL / reduced motion). */}
      <Journey items={journeyGalleries} after="#about" />
      <Statement />
      <PinnedGallery />
      <Packages />
      <Investment />
      <Closing />
      <Enquire />
    </main>
  )
}
