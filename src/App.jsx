import { useCallback, useEffect, useState } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import MoguraGame from './components/MoguraGame'
import HomePage from './pages/HomePage'
import CareersPage from './pages/CareersPage'
import { EggProvider, useEggs } from './context/EggContext'
import useKonami from './hooks/useKonami'
import './App.css'

function AppInner() {
  const [scrollY, setScrollY] = useState(0)
  const { setKonamiActive, triggerConfetti, showToast } = useEggs()
  const navigate = useNavigate()
  const location = useLocation()

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
    if (location.pathname !== '/') {
      navigate('/#simulator')
    } else {
      setTimeout(() => {
        const el = document.getElementById('simulator')
        if (el) el.scrollIntoView({ behavior: 'smooth' })
      }, 250)
    }
  }, [setKonamiActive, triggerConfetti, showToast, navigate, location.pathname])

  useKonami(onKonami)

  return (
    <div className="App">
      <Navbar scrollY={scrollY} />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/careers" element={<CareersPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
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
