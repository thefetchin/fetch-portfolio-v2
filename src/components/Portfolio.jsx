import { useEffect, useRef } from 'react'
import './Portfolio.css'

const Portfolio = () => {
  const portfolioRef = useRef(null)

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

    if (portfolioRef.current) {
      observer.observe(portfolioRef.current)
    }

    return () => {
      if (portfolioRef.current) {
        observer.unobserve(portfolioRef.current)
      }
    }
  }, [])

  const projects = [
    {
      title: 'Corporate Office Space',
      location: 'Modern Business Environment',
      description: 'Transformed office floors with smart retail solutions, creating convenient access points for employees throughout the workspace.',
      transformation: 'Enhanced workplace convenience and employee satisfaction'
    },
    {
      title: 'University Campus',
      location: 'Educational Institution',
      description: 'Integrated smart vending solutions across campus locations, seamlessly blending with the academic environment.',
      transformation: 'Improved student experience with accessible retail options'
    },
    {
      title: 'Healthcare Facility',
      location: 'Medical Center',
      description: 'Designed specialized smart retail solutions for healthcare settings, focusing on health-conscious options and accessibility.',
      transformation: 'Better service for patients, staff, and visitors'
    },
    {
      title: 'Transportation Hub',
      location: 'Transit Center',
      description: 'Implemented smart retail solutions in high-traffic areas, designed for diverse users and multiple payment methods.',
      transformation: 'Modern convenience for travelers on the go'
    }
  ]

  return (
    <section id="portfolio" ref={portfolioRef} className="portfolio">
      <div className="portfolio-container">
        <div className="portfolio-header">
          <span className="eyebrow">Portfolio</span>
          <h2 className="section-title">
            Smart vending, <span className="accent-text">in the wild</span>
          </h2>
          <p className="section-description">
            A look at how Fetch transforms different environments — from corporate floors to transit hubs.
          </p>
        </div>
        <div className="portfolio-grid">
          {projects.map((project, index) => (
            <div key={index} className="portfolio-card">
              <div className="portfolio-card-header">
                <div className="portfolio-number">{String(index + 1).padStart(2, '0')}</div>
              </div>
              <h3 className="portfolio-title">{project.title}</h3>
              <p className="portfolio-location">{project.location}</p>
              <p className="portfolio-description">{project.description}</p>
              <div className="portfolio-transformation">
                <span className="transformation-label">Transformation:</span>
                <span className="transformation-text">{project.transformation}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Portfolio

