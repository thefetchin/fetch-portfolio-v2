import { useRef, useState } from 'react'
import './BrandsMarquee.css'

const BRANDS = [
  'Lay’s',
  'Coca-Cola',
  'Paper Boat',
  'Mogu Mogu',
  'Pringles',
  'SuperYou',
  'Sweet Karam Coffee',
  'Pepsi',
  'Cadbury',
  'KitKat',
  'Oreo',
  'Snickers',
  'Red Bull',
  'Bisleri',
  'Sprite',
  'Haldiram’s',
]

// Per-brand emoji used in the tap-to-pop easter egg
const BRAND_EMOJI = {
  'Lay’s': '🥔',
  'Coca-Cola': '🥤',
  'Paper Boat': '⛵',
  'Mogu Mogu': '🧋',
  'Pringles': '🥒',
  'SuperYou': '💪',
  'Sweet Karam Coffee': '☕',
  'Pepsi': '🥤',
  'Cadbury': '🍫',
  'KitKat': '🍫',
  'Oreo': '🍪',
  'Snickers': '🥜',
  'Red Bull': '⚡',
  'Bisleri': '💧',
  'Sprite': '🌿',
  'Haldiram’s': '🥨',
}

const BrandsMarquee = () => {
  const loop = [...BRANDS, ...BRANDS]
  const [poppedKey, setPoppedKey] = useState(null)
  const timerRef = useRef(null)

  const pop = (key) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setPoppedKey(key)
    timerRef.current = setTimeout(() => setPoppedKey(null), 750)
  }

  return (
    <section
      className={`brands-marquee ${poppedKey ? 'is-popping' : ''}`}
      aria-label="Brands stocked in our vending machines"
    >
      <div className="brands-marquee__header">
        <span className="brands-marquee__eyebrow">Stocking the brands you love</span>
      </div>

      <div className="brands-marquee__viewport">
        <div className="brands-marquee__track" role="list">
          {loop.map((name, i) => {
            const key = `${name}-${i}`
            const isPopping = poppedKey === key
            return (
              <button
                type="button"
                className={`brands-marquee__item ${isPopping ? 'is-popping' : ''}`}
                role="listitem"
                key={key}
                onClick={() => pop(key)}
                aria-hidden={i >= BRANDS.length}
                aria-label={name}
              >
                <span className="brands-marquee__wordmark">{name}</span>
                <span className="brands-marquee__emoji" aria-hidden="true">
                  {BRAND_EMOJI[name] || '✨'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default BrandsMarquee
