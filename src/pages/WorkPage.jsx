import Hero from '../components/Hero.jsx'
import Statement from '../components/Statement.jsx'
import PinnedGallery from '../components/PinnedGallery.jsx'
import Packages from '../components/Packages.jsx'
import Investment from '../components/Investment.jsx'
import Closing from '../components/Closing.jsx'
import Enquire from '../components/Enquire.jsx'

/**
 * The regular site, for visitors who skip the tour: the hero, recent
 * galleries, packages, pricing and the enquiry — no 3D.
 */
export default function WorkPage() {
  return (
    <main>
      <Hero />
      <Statement />
      <PinnedGallery />
      <Packages />
      <Investment />
      <Closing />
      <Enquire />
    </main>
  )
}
