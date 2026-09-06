import Nav from './components/Nav.jsx'
import ScrollMeter from './components/ScrollMeter.jsx'
import Hero from './components/Hero.jsx'
import Statement from './components/Statement.jsx'
import PinnedGallery from './components/PinnedGallery.jsx'
import Packages from './components/Packages.jsx'
import Testimonials from './components/Testimonials.jsx'
import Investment from './components/Investment.jsx'
import Closing from './components/Closing.jsx'
import Enquire from './components/Enquire.jsx'
import Footer from './components/Footer.jsx'

export default function App() {
  return (
    <>
      <Nav />
      <ScrollMeter />

      <main>
        <Hero />
        <Statement />
        <PinnedGallery />
        <Packages />
        <Testimonials />
        <Investment />
        <Closing />
        <Enquire />
      </main>

      <Footer />
    </>
  )
}
