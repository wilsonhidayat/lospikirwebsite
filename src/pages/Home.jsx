import Hero from '../components/Hero.jsx'
import Statement from '../components/Statement.jsx'
import PinnedGallery from '../components/PinnedGallery.jsx'
import Packages from '../components/Packages.jsx'
import Investment from '../components/Investment.jsx'
import Closing from '../components/Closing.jsx'
import Enquire from '../components/Enquire.jsx'

export default function Home() {
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
