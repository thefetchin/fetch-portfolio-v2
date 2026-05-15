import { useEffect, useRef } from 'react'
import './Services.css'

const Services = () => {
  const servicesRef = useRef(null)

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

    if (servicesRef.current) {
      observer.observe(servicesRef.current)
    }

    return () => {
      if (servicesRef.current) {
        observer.unobserve(servicesRef.current)
      }
    }
  }, [])

  const services = [
    {
      icon: '📍',
      title: 'Strategic Placement',
      description: 'Expert analysis of your space to determine optimal vending machine locations for maximum visibility and accessibility.'
    },
    {
      icon: '🤖',
      title: 'Smart Vending Technology',
      description: 'State-of-the-art vending machines with IoT connectivity, digital displays, touchless interfaces, and real-time inventory tracking.'
    },
    {
      icon: '💳',
      title: 'Modern Payment Systems',
      description: 'Multiple payment options including contactless cards, mobile payments, QR codes, and cash for seamless transactions.'
    },
    {
      icon: '📊',
      title: 'Inventory Management',
      description: 'Automated inventory tracking and analytics to optimize product selection and ensure machines are always stocked.'
    },
    {
      icon: '🔄',
      title: 'Maintenance & Restocking',
      description: 'Regular maintenance, cleaning, and restocking services to keep your vending machines operating at peak performance.'
    },
    {
      icon: '📱',
      title: 'Remote Monitoring',
      description: '24/7 remote monitoring and alerts to track machine status, sales data, and maintenance needs in real-time.'
    }
  ]

  return (
    <section id="services" ref={servicesRef} className="services">
      <div className="services-container">
        <div className="services-header">
          <h2 className="section-title">
            Our <span className="accent-text">Services</span>
          </h2>
          <p className="section-description">
            Comprehensive smart vending machine solutions tailored to your needs
          </p>
        </div>
        <div className="services-grid">
          {services.map((service, index) => (
            <div key={index} className="service-card">
              <div className="service-icon">{service.icon}</div>
              <h3 className="service-title">{service.title}</h3>
              <p className="service-description">{service.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Services

