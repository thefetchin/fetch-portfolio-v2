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

const BrandsMarquee = () => {
  const loop = [...BRANDS, ...BRANDS]

  return (
    <section className="brands-marquee" aria-label="Brands stocked in our vending machines">
      <div className="brands-marquee__header">
        <span className="brands-marquee__eyebrow">Stocking the brands you love</span>
      </div>

      <div className="brands-marquee__viewport">
        <div className="brands-marquee__track" role="list">
          {loop.map((name, i) => (
            <div className="brands-marquee__item" role="listitem" key={`${name}-${i}`} aria-hidden={i >= BRANDS.length}>
              <span className="brands-marquee__wordmark">{name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default BrandsMarquee
