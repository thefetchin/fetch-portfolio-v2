import { useEffect, useRef, useState } from 'react'
import './Hero.css'

const Hero = () => {
  const heroRef = useRef(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

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

    if (heroRef.current) {
      observer.observe(heroRef.current)
    }

    return () => {
      if (heroRef.current) {
        observer.unobserve(heroRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handleMouseMove = (e) => {
      const hero = heroRef.current
      if (!hero) return
      
      const rect = hero.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2
      
      setMousePosition({ x, y })
    }

    const hero = heroRef.current
    if (hero) {
      hero.addEventListener('mousemove', handleMouseMove)
      return () => hero.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  const scrollToSection = (id) => {
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const products = [
    { src: '/sandwich.svg', name: 'sandwich', delay: 0 },
    { src: '/green bottle.svg', name: 'bottle', delay: 0.2 },
    { src: '/dry fruit bag.svg', name: 'fruits', delay: 0.4 },
    { src: '/drink can.svg', name: 'can', delay: 0.6 },
    { src: '/donut.svg', name: 'donut', delay: 0.8 },
    { src: '/Croissant.svg', name: 'croissant', delay: 1.0 },
    { src: '/chocolate-1.svg', name: 'chocolate1', delay: 1.2 },
    { src: '/chocolate-2.svg', name: 'chocolate2', delay: 1.4 },
    { src: '/chocolate-3.svg', name: 'chocolate3', delay: 1.6 }
  ]

  return (
    <section id="hero" ref={heroRef} className="hero">
      <div className="hero-background">
        <div className="gradient-orb orb-1"></div>
        <div className="gradient-orb orb-2"></div>
        <div className="gradient-orb orb-3"></div>
      </div>
      
      {/* Floating Product SVGs with Parallax */}
      <div className="floating-products">
        {products.map((product, index) => {
          const parallaxX = mousePosition.x * (15 + index * 3)
          const parallaxY = mousePosition.y * (15 + index * 3)
          return (
            <div
              key={index}
              className={`floating-product product-${index + 1}`}
              style={{
                transform: `translate(${parallaxX}px, ${parallaxY}px)`,
                transition: 'transform 0.15s ease-out'
              }}
            >
              <img 
                src={product.src} 
                alt={product.name}
                className="product-svg"
              />
            </div>
          )
        })}
      </div>

      <div className="hero-container">
        <div className="hero-content">
          <div className="hero-badge">
            <span>Smart Retail Solutions</span>
          </div>
          <h1 className="hero-title">
            Transform Your Space
            <br />
            <span className="accent-text">With Intelligent Vending</span>
          </h1>
          <p className="hero-subtitle">
            Elevate your environment with smart retail solutions that seamlessly 
            integrate into any space, bringing convenience and modern technology together.
          </p>
          <div className="hero-buttons">
            <button 
              className="btn btn-primary"
              onClick={() => scrollToSection('contact')}
            >
              Transform Your Space
              <span className="btn-arrow">→</span>
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => scrollToSection('portfolio')}
            >
              View Portfolio
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

export default Hero

