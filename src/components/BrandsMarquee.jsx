import { useEffect, useRef, useState } from 'react'
import './BrandsMarquee.css'

// Drop logo files into /public/brands/ using the `slug` below as the filename
// (e.g. `coca-cola.svg`, `lays.png`, `pringles.webp`). The marquee will pick
// them up automatically. If a file isn't present, the branded text chip is
// shown instead. `color` is used to tint the fallback chip and the hover
// state.
const BRANDS = [
  { name: 'Lay’s',              slug: 'lays',              color: '#FFD200' },
  { name: 'Coca-Cola',          slug: 'coca-cola',         color: '#F40009' },
  { name: 'Paper Boat',         slug: 'paper-boat',        color: '#1F6CB1' },
  { name: 'Mogu Mogu',          slug: 'mogu-mogu',         color: '#7AC74F' },
  { name: 'Pringles',           slug: 'pringles',          color: '#C8102E' },
  { name: 'SuperYou',           slug: 'superyou',          color: '#0EA5E9' },
  { name: 'Sweet Karam Coffee', slug: 'sweet-karam-coffee', color: '#5C2C0F' },
  { name: 'Pepsi',              slug: 'pepsi',             color: '#004B93' },
  { name: 'Cadbury',            slug: 'cadbury',           color: '#3A1B5A' },
  { name: 'KitKat',             slug: 'kitkat',            color: '#D62300' },
  { name: 'Oreo',               slug: 'oreo',              color: '#0033A0' },
  { name: 'Snickers',           slug: 'snickers',          color: '#6E2810' },
  { name: 'Red Bull',           slug: 'red-bull',          color: '#001E45' },
  { name: 'Bisleri',            slug: 'bisleri',           color: '#00A3E0' },
  { name: 'Sprite',             slug: 'sprite',            color: '#00964F' },
  { name: 'Haldiram’s',         slug: 'haldirams',         color: '#C8102E' },
]

const LOGO_EXTS = ['svg', 'png', 'webp']

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

const BrandLogo = ({ brand }) => {
  const [extIdx, setExtIdx] = useState(0)
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <span
        className="brands-marquee__wordmark"
        style={{ '--brand-color': brand.color }}
      >
        {brand.name}
      </span>
    )
  }

  const src = `/brands/${brand.slug}.${LOGO_EXTS[extIdx]}`
  return (
    <img
      src={src}
      alt={brand.name}
      className="brands-marquee__logo"
      loading="lazy"
      onError={() => {
        if (extIdx + 1 < LOGO_EXTS.length) {
          setExtIdx(extIdx + 1)
        } else {
          setFailed(true)
        }
      }}
    />
  )
}

const BrandsMarquee = () => {
  const loop = [...BRANDS, ...BRANDS]
  const [poppedKey, setPoppedKey] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

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
          {loop.map((brand, i) => {
            const key = `${brand.slug}-${i}`
            const isPopping = poppedKey === key
            return (
              <button
                type="button"
                className={`brands-marquee__item ${isPopping ? 'is-popping' : ''}`}
                role="listitem"
                key={key}
                onClick={() => pop(key)}
                aria-hidden={i >= BRANDS.length}
                aria-label={brand.name}
                style={{ '--brand-color': brand.color }}
              >
                <BrandLogo brand={brand} />
                <span className="brands-marquee__emoji" aria-hidden="true">
                  {BRAND_EMOJI[brand.name] || '✨'}
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
