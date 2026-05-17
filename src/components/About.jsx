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
            Smart retail technology, <span className="accent-text">end to end.</span>
          </h2>
          <p className="section-description">
            Fetch is a smart retail technology company. We design and operate
            <strong> Fetch Pods</strong> — connected vending machines deployed
            across offices, campuses, healthcare and transit hubs — and we are
            building <strong>Fetch Grid</strong>, the software platform that
            links the retailers running those Pods with the distributors stocking
            them. Hardware on the ground, software in the cloud, one network
            end to end.
          </p>
          <div className="about-highlights">
            <div className="highlight-item">
              <div className="highlight-number">01</div>
              <div className="highlight-content">
                <h3>Hardware that thinks</h3>
                <p>Fetch Pods are IoT-grade vending machines with real-time inventory, cashless checkout and remote management built in.</p>
              </div>
            </div>
            <div className="highlight-item">
              <div className="highlight-number">02</div>
              <div className="highlight-content">
                <h3>Software that connects</h3>
                <p>Fetch Grid (in development) brings retailers, distributors and brand teams onto one platform for restocking, analytics and settlement.</p>
              </div>
            </div>
            <div className="highlight-item">
              <div className="highlight-number">03</div>
              <div className="highlight-content">
                <h3>One network, end to end</h3>
                <p>From the Pod on the wall to the distributor's warehouse, every SKU, sale and shipment lives on the same network.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default About

