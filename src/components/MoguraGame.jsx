import { useCallback, useEffect, useRef, useState } from 'react'
import './MoguraGame.css'

const GRID = 9
const ROUND_SECONDS = 30
const SPAWN_MS = 720
const POP_MS = 950
const STORAGE_KEY = 'fetch.mogura.best'

const randomEmpty = (holes) => {
  const empties = []
  for (let i = 0; i < holes.length; i++) if (holes[i] == null) empties.push(i)
  if (!empties.length) return -1
  return empties[Math.floor(Math.random() * empties.length)]
}

export default function MoguraGame() {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState('idle') // 'idle' | 'playing' | 'done'
  const [score, setScore] = useState(0)
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS)
  const [holes, setHoles] = useState(() => Array(GRID).fill(null))
  const [best, setBest] = useState(0)

  const spawnRef = useRef(null)
  const tickRef = useRef(null)
  const popTimersRef = useRef([])

  // Load best score
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) setBest(parseInt(stored, 10) || 0)
    } catch {}
  }, [])

  const stopTimers = useCallback(() => {
    if (spawnRef.current) clearInterval(spawnRef.current)
    if (tickRef.current) clearInterval(tickRef.current)
    spawnRef.current = null
    tickRef.current = null
    popTimersRef.current.forEach(clearTimeout)
    popTimersRef.current = []
  }, [])

  useEffect(() => () => stopTimers(), [stopTimers])

  // Body scroll lock while modal open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const closeModal = useCallback(() => {
    stopTimers()
    setOpen(false)
    setPhase('idle')
    setHoles(Array(GRID).fill(null))
    setScore(0)
    setTimeLeft(ROUND_SECONDS)
  }, [stopTimers])

  // Esc to close
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeModal])

  const start = () => {
    stopTimers()
    setScore(0)
    setTimeLeft(ROUND_SECONDS)
    setHoles(Array(GRID).fill(null))
    setPhase('playing')

    spawnRef.current = setInterval(() => {
      setHoles((prev) => {
        const i = randomEmpty(prev)
        if (i < 0) return prev
        const isBomb = Math.random() < 0.18
        const next = prev.slice()
        next[i] = isBomb ? 'bomb' : 'mole'
        const t = setTimeout(() => {
          setHoles((curr) => {
            if (curr[i] === 'mole' || curr[i] === 'bomb') {
              const n = curr.slice()
              n[i] = null
              return n
            }
            return curr
          })
        }, POP_MS)
        popTimersRef.current.push(t)
        return next
      })
    }, SPAWN_MS)

    tickRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          stopTimers()
          setPhase('done')
          return 0
        }
        return t - 1
      })
    }, 1000)
  }

  // Persist best score when a round ends
  useEffect(() => {
    if (phase !== 'done') return
    setBest((prev) => {
      const next = Math.max(prev, score)
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next))
      } catch {}
      return next
    })
  }, [phase, score])

  const hit = (i) => {
    if (phase !== 'playing') return
    const state = holes[i]
    if (state === 'mole') {
      setHoles((prev) => {
        const n = prev.slice()
        n[i] = 'hit-mole'
        return n
      })
      setScore((s) => s + 1)
      const t = setTimeout(() => {
        setHoles((prev) => {
          if (prev[i] === 'hit-mole') {
            const n = prev.slice()
            n[i] = null
            return n
          }
          return prev
        })
      }, 260)
      popTimersRef.current.push(t)
    } else if (state === 'bomb') {
      setHoles((prev) => {
        const n = prev.slice()
        n[i] = 'hit-bomb'
        return n
      })
      setScore((s) => Math.max(0, s - 2))
      const t = setTimeout(() => {
        setHoles((prev) => {
          if (prev[i] === 'hit-bomb') {
            const n = prev.slice()
            n[i] = null
            return n
          }
          return prev
        })
      }, 420)
      popTimersRef.current.push(t)
    }
  }

  return (
    <>
      <button
        type="button"
        className="mogura-fab"
        onClick={() => setOpen(true)}
        aria-label="Open Mogura Tataki mini-game"
      >
        <span className="mogura-fab__icon" aria-hidden="true">🎮</span>
        <span className="mogura-fab__label">ゲーム · Play</span>
      </button>

      {open && (
        <div
          className="mogura-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mogura-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="mogura-card">
            <header className="mogura-head">
              <div>
                <div className="mogura-kicker">Mini game · Whack-a-Mogura</div>
                <h2 id="mogura-title" className="mogura-title">もぐらたたき</h2>
              </div>
              <button
                type="button"
                className="mogura-close"
                onClick={closeModal}
                aria-label="Close game"
              >
                ×
              </button>
            </header>

            <div className="mogura-stats" role="group" aria-label="Stats">
              <div className="mogura-stat">
                <span className="mogura-stat-label">SCORE</span>
                <span className="mogura-stat-value">{score}</span>
              </div>
              <div className="mogura-stat mogura-stat-time">
                <span className="mogura-stat-label">TIME</span>
                <span className="mogura-stat-value">{timeLeft}</span>
              </div>
              <div className="mogura-stat">
                <span className="mogura-stat-label">BEST</span>
                <span className="mogura-stat-value">{best}</span>
              </div>
            </div>

            <div className="mogura-board" role="grid" aria-label="Whack-a-Mogura board">
              {holes.map((state, i) => (
                <button
                  key={i}
                  type="button"
                  className={`mogura-hole ${state ? `is-${state}` : ''}`}
                  onClick={() => hit(i)}
                  disabled={phase !== 'playing'}
                  aria-label={`Hole ${i + 1}${state ? `, ${state}` : ''}`}
                >
                  <span className="mogura-hole-bg" aria-hidden="true" />
                  <span className="mogura-creature" aria-hidden="true">
                    {state === 'mole' || state === 'hit-mole' ? '🐭' : null}
                    {state === 'bomb' || state === 'hit-bomb' ? '💣' : null}
                  </span>
                </button>
              ))}
            </div>

            <div className="mogura-actions">
              {phase === 'idle' && (
                <>
                  <p className="mogura-tip">
                    Tap moles 🐭 to score · avoid bombs 💣 (−2). 30 seconds.
                  </p>
                  <button type="button" className="mogura-start" onClick={start}>
                    Start · スタート
                  </button>
                </>
              )}
              {phase === 'playing' && (
                <p className="mogura-tip">頑張れ! · {timeLeft}s left</p>
              )}
              {phase === 'done' && (
                <>
                  <p className="mogura-tip">
                    Final score: <strong>{score}</strong>
                    {score >= best && score > 0 ? ' — new best! 🎉' : ''}
                  </p>
                  <button type="button" className="mogura-start" onClick={start}>
                    Play again · もう一度
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
