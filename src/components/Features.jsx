import { useEffect, useRef } from 'react'
import {
  FiCpu,
  FiCreditCard,
  FiActivity,
  FiShield,
  FiMonitor,
  FiClock,
} from 'react-icons/fi'
import './Features.css'

const FEATURES = [
  {
    icon: FiCpu,
    title: 'IoT-Connected Machines',
    body: 'Every unit is online, telemetry-rich and remotely managed — no more guessing what is stocked or sold.',
  },
  {
    icon: FiCreditCard,
    title: 'Cashless & UPI Ready',
    body: 'UPI, cards, wallets and tap-to-pay out of the box. Frictionless checkout for every customer.',
  },
  {
    icon: FiActivity,
    title: 'Real-Time Inventory',
    body: 'Live stock levels and predictive restocking mean shelves are never empty when customers arrive.',
  },
  {
    icon: FiMonitor,
    title: 'Digital Brand Screens',
    body: 'Built-in displays turn every machine into a high-attention advertising surface for partner brands.',
  },
  {
    icon: FiClock,
    title: '24/7 Availability',
    body: 'Always-on convenience for offices, campuses and transit hubs — without the staffing overhead.',
  },
  {
    icon: FiShield,
    title: 'Service-Level Guarantee',
    body: 'Proactive monitoring with rapid on-site response. We own uptime, so you do not have to.',
  },
]

const Features = () => {
  const ref = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add('visible')
        })
      },
      { threshold: 0.1 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => {
      if (ref.current) observer.unobserve(ref.current)
    }
  }, [])

  return (
    <section id="features" ref={ref} className="features">
      <div className="features-container">
        <div className="features-header">
          <span className="eyebrow">Why Fetch</span>
          <h2 className="section-title">
            Vending, <span className="accent-text">re-engineered</span> for modern spaces.
          </h2>
          <p className="section-description">
            We pair industrial-grade hardware with cloud-native software so every machine
            in our network performs like a flagship retail point.
          </p>
        </div>

        <div className="features-grid">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article className="feature-card" key={title}>
              <div className="feature-icon"><Icon aria-hidden="true" /></div>
              <h3 className="feature-title">{title}</h3>
              <p className="feature-body">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Features
