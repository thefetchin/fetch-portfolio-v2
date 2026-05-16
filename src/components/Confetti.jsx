import { useEffect, useMemo } from 'react'
import './Confetti.css'

const COLORS = [
  '#0ea5e9', '#22c55e', '#facc15', '#f97316',
  '#a855f7', '#ef4444', '#06b6d4', '#fb7185',
]

/**
 * A single confetti burst. Renders `count` absolutely positioned particles
 * that fly outward from `origin` (viewport coordinates) for `duration` ms.
 * Cleans itself up via the parent's `onDone` once finished.
 */
const ConfettiBurst = ({ origin, count = 40, duration = 1600, spreadY = 220, onDone }) => {
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2
      const distance = 80 + Math.random() * 260
      return {
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance + spreadY,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rot: Math.random() * 720 - 360,
        size: 6 + Math.random() * 6,
        delay: Math.random() * 100,
        dur: duration * (0.7 + Math.random() * 0.45),
        ratio: 0.5 + Math.random() * 1.2,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const longest = Math.max(...particles.map((p) => p.delay + p.dur)) + 50
    const t = setTimeout(() => onDone && onDone(), longest)
    return () => clearTimeout(t)
  }, [particles, onDone])

  return (
    <>
      {particles.map((p, i) => (
        <span
          key={i}
          className="confetti-particle"
          style={{
            left: `${origin.x}px`,
            top: `${origin.y}px`,
            background: p.color,
            width: `${p.size * p.ratio}px`,
            height: `${p.size}px`,
            '--dx': `${p.dx}px`,
            '--dy': `${p.dy}px`,
            '--rot': `${p.rot}deg`,
            '--delay': `${p.delay}ms`,
            '--dur': `${p.dur}ms`,
          }}
        />
      ))}
    </>
  )
}

const ConfettiOverlay = ({ bursts, removeBurst }) => {
  return (
    <div className="confetti-overlay" aria-hidden="true">
      {bursts.map((b) => (
        <ConfettiBurst
          key={b.id}
          origin={b.origin}
          count={b.count}
          duration={b.duration}
          spreadY={b.spreadY}
          onDone={() => removeBurst(b.id)}
        />
      ))}
    </div>
  )
}

export default ConfettiOverlay
