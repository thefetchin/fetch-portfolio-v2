import { createContext, useCallback, useContext, useRef, useState } from 'react'
import ConfettiOverlay from '../components/Confetti'

const EggContext = createContext({
  konamiActive: false,
  setKonamiActive: () => {},
  triggerConfetti: () => {},
  toast: null,
  showToast: () => {},
})

export const EggProvider = ({ children }) => {
  const [konamiActive, setKonamiActive] = useState(false)
  const [bursts, setBursts] = useState([])
  const [toast, setToast] = useState(null)
  const burstIdRef = useRef(0)
  const toastTimerRef = useRef(null)

  const triggerConfetti = useCallback((opts = {}) => {
    const id = ++burstIdRef.current
    const burst = {
      id,
      origin: opts.origin || { x: window.innerWidth / 2, y: 0 },
      count: opts.count ?? 50,
      duration: opts.duration ?? 1700,
      spreadY: opts.spreadY ?? 220,
    }
    setBursts((b) => [...b, burst])
  }, [])

  const removeBurst = useCallback((id) => {
    setBursts((b) => b.filter((x) => x.id !== id))
  }, [])

  const showToast = useCallback((message, ms = 3200) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(message)
    toastTimerRef.current = setTimeout(() => setToast(null), ms)
  }, [])

  return (
    <EggContext.Provider
      value={{ konamiActive, setKonamiActive, triggerConfetti, toast, showToast }}
    >
      {children}
      <ConfettiOverlay bursts={bursts} removeBurst={removeBurst} />
      {toast && (
        <div className="egg-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </EggContext.Provider>
  )
}

export const useEggs = () => useContext(EggContext)
