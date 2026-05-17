import { useEffect, useRef } from 'react'
import { FiArrowRight, FiCheck } from 'react-icons/fi'
import './Products.css'

const PODS_FEATURES = [
  'IoT telemetry and real-time inventory',
  'Cashless and UPI checkout out of the box',
  'Digital brand screens on every machine',
  '24/7 availability with proactive service',
]

const GRID_FEATURES = [
  'Discover and onboard distributors in one place',
  'Real-time inventory and sales across every retail surface',
  'Automated reordering, returns and reconciliation',
  'Settlement, billing and audit for retailers and distributors',
]

const Products = () => {
  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const obs = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => e.isIntersecting && e.target.classList.add('visible')),
      { threshold: 0.1 }
    )
    obs.observe(node)
    return () => obs.unobserve(node)
  }, [])

  const scrollTo = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section id="products" ref={ref} className="products">
      <div className="products-container">
        <div className="products-header">
          <span className="eyebrow">The Fetch platform</span>
          <h2 className="section-title">
            Two products. <span className="accent-text">One smart-retail network.</span>
          </h2>
          <p className="section-description">
            Fetch Pods are connected vending machines on the ground. Fetch Grid is
            the retail operations platform that connects <em>any</em> retailer with
            their distributors and runs the day-to-day between them.
          </p>
        </div>

        <div className="products-grid">
          {/* PODS — hardware, live in the wild */}
          <article className="product-card product-card--pods">
            <div className="product-card__art product-card__art--pods" aria-hidden="true">
              <svg viewBox="0 0 100 130" className="product-card__svg" role="img">
                <rect x="8" y="6" width="84" height="118" rx="10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
                <rect x="14" y="12" width="72" height="74" rx="4" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.55" />
                <line x1="14" y1="36" x2="86" y2="36" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
                <line x1="14" y1="60" x2="86" y2="60" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
                <circle cx="26" cy="24" r="4" fill="currentColor" opacity="0.55" />
                <circle cx="50" cy="48" r="5" fill="currentColor" opacity="0.55" />
                <circle cx="74" cy="72" r="4" fill="currentColor" opacity="0.55" />
                <rect x="14" y="94" width="44" height="22" rx="3" fill="currentColor" opacity="0.18" />
                <rect x="62" y="94" width="24" height="22" rx="3" fill="currentColor" opacity="0.34" />
              </svg>
            </div>

            <div className="product-card__body">
              <div className="product-card__head">
                <span className="product-card__pill">Live · Deployed</span>
                <h3 className="product-card__title">Fetch Pods</h3>
                <p className="product-card__tag">
                  Connected vending machines for offices, campuses, healthcare and transit hubs.
                </p>
              </div>

              <ul className="product-card__list">
                {PODS_FEATURES.map((f) => (
                  <li key={f}>
                    <FiCheck aria-hidden="true" /> {f}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="product-card__cta"
                onClick={() => scrollTo('simulator')}
              >
                Try a Pod <FiArrowRight aria-hidden="true" />
              </button>
            </div>
          </article>

          {/* GRID — software, in development */}
          <article className="product-card product-card--grid">
            <div className="product-card__art product-card__art--grid" aria-hidden="true">
              <svg viewBox="0 0 140 100" className="product-card__svg" role="img">
                <defs>
                  <pattern id="grid-dots" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
                    <circle cx="1" cy="1" r="0.85" fill="currentColor" opacity="0.4" />
                  </pattern>
                </defs>
                <rect width="140" height="100" fill="url(#grid-dots)" opacity="0.55" />
                <g stroke="currentColor" strokeWidth="1" opacity="0.6" fill="none">
                  <line x1="20" y1="22" x2="68" y2="48" />
                  <line x1="68" y1="48" x2="120" y2="22" />
                  <line x1="68" y1="48" x2="34" y2="78" />
                  <line x1="68" y1="48" x2="106" y2="78" />
                  <line x1="20" y1="22" x2="34" y2="78" strokeDasharray="2 3" />
                  <line x1="120" y1="22" x2="106" y2="78" strokeDasharray="2 3" />
                </g>
                <g fill="currentColor">
                  <circle cx="20" cy="22" r="4" />
                  <circle cx="68" cy="48" r="5.5" />
                  <circle cx="120" cy="22" r="4" />
                  <circle cx="34" cy="78" r="4" />
                  <circle cx="106" cy="78" r="4" />
                </g>
              </svg>
            </div>

            <div className="product-card__body">
              <div className="product-card__head">
                <span className="product-card__pill product-card__pill--soon">
                  <span className="product-card__pill-dot" aria-hidden="true" />
                  In development
                </span>
                <h3 className="product-card__title">Fetch Grid</h3>
                <p className="product-card__tag">
                  The retail operations platform connecting any retailer with
                  their distributors — Pods, stores, kiosks and warehouses on
                  one network.
                </p>
              </div>

              <ul className="product-card__list">
                {GRID_FEATURES.map((f) => (
                  <li key={f}>
                    <FiCheck aria-hidden="true" /> {f}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="product-card__cta product-card__cta--alt"
                onClick={() => scrollTo('contact')}
              >
                Get early access <FiArrowRight aria-hidden="true" />
              </button>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}

export default Products
