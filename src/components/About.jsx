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
          <h2 className="section-title">
            About <span className="accent-text">Fetch</span>
          </h2>
          <p className="section-description">
            Fetch specializes in smart vending machine solutions that transform ordinary spaces 
            into convenient, modern environments. We design and implement intelligent 
            vending machine installations that seamlessly integrate into your space, 
            connecting spaces, advertisers, and brands through innovative technology.
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

