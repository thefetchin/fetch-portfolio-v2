import { useEffect, useRef } from 'react'
import './Partners.css'

const Partners = () => {
  const partnersRef = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible')
          }
        })
      },
      { threshold: 0.1 }
    )

    if (partnersRef.current) {
      observer.observe(partnersRef.current)
    }

    return () => {
      if (partnersRef.current) {
        observer.unobserve(partnersRef.current)
      }
    }
  }, [])

  const partners = [
    {
      title: 'Spaces',
      description: 'Transform your location with smart vending machines. Whether it\'s an office, campus, healthcare facility, or transit hub, we help you enhance your space with convenient, modern retail solutions.',
      features: [
        'Strategic placement analysis',
        'Seamless space integration',
        'Enhanced visitor experience'
      ],
      icon: '🏢'
    },
    {
      title: 'Advertisers',
      description: 'Reach your target audience through our smart vending network. Display your brand on high-traffic machines with digital screens and interactive displays that capture attention.',
      features: [
        'Digital display advertising',
        'Targeted audience reach',
        'Real-time analytics'
      ],
      icon: '📢'
    },
    {
      title: 'Brands',
      description: 'Host your products in our smart vending machines. Expand your retail presence and reach customers where they are, with full inventory management and sales tracking.',
      features: [
        'Product placement opportunities',
        'Inventory management',
        'Sales performance tracking'
      ],
      icon: '🏷️'
    }
  ]

  return (
    <section id="partners" ref={partnersRef} className="partners">
      <div className="partners-container">
        <div className="partners-header">
          <h2 className="section-title">
            Who We <span className="accent-text">Work With</span>
          </h2>
          <p className="section-description">
            We connect spaces, advertisers, and brands through smart vending solutions
          </p>
        </div>
        <div className="partners-grid">
          {partners.map((partner, index) => (
            <div key={index} className="partner-card">
              <div className="partner-icon-wrapper">
                <div className="partner-icon">{partner.icon}</div>
              </div>
              <h3 className="partner-title">{partner.title}</h3>
              <p className="partner-description">{partner.description}</p>
              <ul className="partner-features">
                {partner.features.map((feature, idx) => (
                  <li key={idx} className="feature-item">
                    <span className="feature-check">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Partners

