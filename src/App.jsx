import { useCallback, useEffect, useState } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import BrandsMarquee from './components/BrandsMarquee'
import About from './components/About'
import Features from './components/Features'
import Partners from './components/Partners'
import Portfolio from './components/Portfolio'
import VendingSim from './components/VendingSim'
import Contact from './components/Contact'
import Footer from './components/Footer'
import MoguraGame from './components/MoguraGame'
import { EggProvider, useEggs } from './context/EggContext'
import useKonami from './hooks/useKonami'
import './App.css'

function AppInner() {
  const [scrollY, setScrollY] = useState(0)
  const { setKonamiActive, triggerConfetti, showToast } = useEggs()

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const onKonami = useCallback(() => {
    setKonamiActive(true)
    triggerConfetti({
      origin: { x: window.innerWidth / 2, y: 40 },
      count: 80,
      duration: 2000,
      spreadY: 320,
    })
    showToast("Konami mode unlocked — vending's on us 🎉")
    setTimeout(() => {
      const el = document.getElementById('simulator')
      if (el) el.scrollIntoView({ behavior: 'smooth' })
    }, 250)
  }, [setKonamiActive, triggerConfetti, showToast])

  useKonami(onKonami)

  return (
    <div className="App">
      <Navbar scrollY={scrollY} />
      <Hero />
      <BrandsMarquee />
      <About />
      <Features />
      <Partners />
      <Portfolio />
      <VendingSim />
      <Contact />
      <Footer />
      <MoguraGame />
    </div>
  )
}

export default function App() {
  return (
    <EggProvider>
      <AppInner />
    </EggProvider>
  )
}
