import { useEffect, useRef } from 'react'
import { FiHome, FiTv, FiTag, FiCheck } from 'react-icons/fi'
import './Partners.css'

const Partners = () => {
  const partnersRef = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('visible')
        })
      },
      { threshold: 0.1 }
    )

    if (partnersRef.current) observer.observe(partnersRef.current)
    return () => {
      if (partnersRef.current) partnersRef.current && partnersRef.current.classList
    }
  }, [])

  const partners = [
    {
      title: 'Spaces',
      description:
        "Transform your location with smart vending. Whether it's an office, campus, healthcare facility, or transit hub, we elevate the visitor experience without adding operational load.",
      features: [
        'Strategic placement analysis',
        'Seamless space integration',
        'Premium visitor experience',
      ],
      icon: FiHome,
    },
    {
      title: 'Advertisers',
      description:
        'Reach high-intent audiences through our network of vending machines with digital screens — at eye level, in moments of purchase.',
      features: [
        'Digital display advertising',
        'Targeted audience reach',
        'Real-time campaign analytics',
      ],
      icon: FiTv,
    },
    {
      title: 'Brands',
      description:
        'Place your products inside the machines your customers already use. Full inventory visibility, real sell-through data, and a presence in premium locations.',
      features: [
        'Premium product placement',
        'Live inventory management',
        'Sales performance tracking',
      ],
      icon: FiTag,
    },
  ]

  return (
    <section id="partners" ref={partnersRef} className="partners">
      <div className="partners-container">
        <div className="partners-header">
          <span className="eyebrow">Partnerships</span>
          <h2 className="section-title">
            Who we <span className="accent-text">work with</span>
          </h2>
          <p className="section-description">
            We connect spaces, advertisers, and brands through a single smart-vending network.
          </p>
        </div>
        <div className="partners-grid">
          {partners.map((partner) => {
            const Icon = partner.icon
            return (
              <div key={partner.title} className="partner-card">
                <div className="partner-icon-wrapper">
                  <div className="partner-icon"><Icon aria-hidden="true" /></div>
                </div>
                <h3 className="partner-title">{partner.title}</h3>
                <p className="partner-description">{partner.description}</p>
                <ul className="partner-features">
                  {partner.features.map((feature) => (
                    <li key={feature} className="feature-item">
                      <span className="feature-check"><FiCheck aria-hidden="true" /></span>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default Partners
