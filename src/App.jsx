import { useState, useEffect } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import BrandsMarquee from './components/BrandsMarquee'
import About from './components/About'
import Features from './components/Features'
import Partners from './components/Partners'
import Portfolio from './components/Portfolio'
import Contact from './components/Contact'
import Footer from './components/Footer'
import './App.css'

function App() {
  const [scrollY, setScrollY] = useState(0)

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="App">
      <Navbar scrollY={scrollY} />
      <Hero />
      <BrandsMarquee />
      <About />
      <Features />
      <Partners />
      <Portfolio />
      <Contact />
      <Footer />
    </div>
  )
}

export default App
