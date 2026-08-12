import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import CareersPage from './pages/CareersPage'
import PrivacyPage from './pages/PrivacyPage'
import TermsPage from './pages/TermsPage'
import CookiesPage from './pages/CookiesPage'
import RefundsPage from './pages/RefundsPage'
import { EggProvider, useEggs } from './context/EggContext'
import useKonami from './hooks/useKonami'
import './App.css'

/** Non-essential and fixed-position, so it's split out and mounted when idle. */
const MoguraGame = lazy(() => import('./components/MoguraGame'))

/** A floating game button doesn't belong on top of a legal document. */
const NO_GAME_ROUTES = ['/privacy', '/terms', '/cookies', '/refunds']

function AppInner() {
  const [scrollY, setScrollY] = useState(0)
  const [gameReady, setGameReady] = useState(false)
  const { setKonamiActive, triggerConfetti, showToast } = useEggs()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Defer the game chunk until the browser is idle so it never competes with
  // first paint.
  useEffect(() => {
    const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200))
    const cancel = window.cancelIdleCallback || clearTimeout
    const handle = schedule(() => setGameReady(true))
    return () => cancel(handle)
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

  const showGame = gameReady && !NO_GAME_ROUTES.includes(location.pathname)

  return (
    <div className="App">
      <Navbar scrollY={scrollY} />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/careers" element={<CareersPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/cookies" element={<CookiesPage />} />
        <Route path="/refunds" element={<RefundsPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
      <Footer />
      {showGame && (
        <Suspense fallback={null}>
          <MoguraGame />
        </Suspense>
      )}
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
