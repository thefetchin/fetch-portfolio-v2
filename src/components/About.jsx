import { useEffect, useRef } from 'react'
import './About.css'

const About = () => {
  const aboutRef = useRef(null)

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

    if (aboutRef.current) {
      observer.observe(aboutRef.current)
    }

    return () => {
      if (aboutRef.current) {
        observer.unobserve(aboutRef.current)
      }
    }
  }, [])

  return (
    <section id="about" ref={aboutRef} className="about">
      <div className="about-container">
        <div className="about-content">
          <span className="eyebrow">About Fetch</span>
          <h2 className="section-title">
            We build the infrastructure behind <span className="accent-text">effortless retail.</span>
          </h2>
          <p className="section-description">
            Fetch designs, deploys and operates a fleet of connected vending machines for
            modern spaces. By bringing together IoT-grade hardware, cashless payments and
            real-time inventory, we turn passive corners into always-on retail surfaces —
            for spaces, brands, and advertisers alike.
          </p>
          <div className="about-highlights">
            <div className="highlight-item">
              <div className="highlight-number">01</div>
              <div className="highlight-content">
                <h3>Smart Technology</h3>
                <p>IoT-connected vending machines with real-time monitoring and analytics</p>
              </div>
            </div>
            <div className="highlight-item">
              <div className="highlight-number">02</div>
              <div className="highlight-content">
                <h3>Seamless Integration</h3>
                <p>Design solutions that blend perfectly with your existing space</p>
              </div>
            </div>
            <div className="highlight-item">
              <div className="highlight-number">03</div>
              <div className="highlight-content">
                <h3>Complete Support</h3>
                <p>From installation to maintenance, we handle everything</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default About

