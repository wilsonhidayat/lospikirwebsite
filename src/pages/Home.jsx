import Packages from '../components/Packages.jsx'
import Investment from '../components/Investment.jsx'
import Enquire from '../components/Enquire.jsx'
import Journey from '../immersive/Journey.jsx'
import { journeyGalleries } from '../data/galleries.js'
import '../styles/after-tour.css'

/**
 * Home: the tour, and straight after it the two things a visitor who took it
 * wants next — how to work together, and what it costs — then the enquiry.
 * "Skip the tour" goes to the regular site (/work) instead.
 */
export default function Home() {
  return (
    <main className="home-tour">
      <Journey items={journeyGalleries} skip="/work" after="#packages" />
      <div className="after-tour">
        <Packages />
        <Investment />
        <Enquire />
      </div>
    </main>
  )
}
