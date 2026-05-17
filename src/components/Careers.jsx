import { useEffect, useRef } from 'react'
import {
  FiCode,
  FiCpu,
  FiMap,
  FiBriefcase,
  FiPenTool,
  FiArrowRight,
} from 'react-icons/fi'
import './Careers.css'

const APPLY_EMAIL = 'thefetch.in@gmail.com'

const ROLES = [
  {
    icon: FiCode,
    title: 'Software Engineering',
    types: ['Internship', 'Full-time'],
    blurb:
      'Build Fetch Grid — distributor APIs, retailer dashboards and the data plane behind every Pod. React, Node, Postgres, real customers shipping every week.',
  },
  {
    icon: FiCpu,
    title: 'Hardware & Firmware',
    types: ['Internship', 'Full-time'],
    blurb:
      'Design and ship the next generation of Fetch Pods — embedded firmware, payments, sensors and reliable connectivity in the wild.',
  },
  {
    icon: FiMap,
    title: 'Operations & Deployments',
    types: ['Internship', 'Full-time'],
    blurb:
      'Roll out new Pods on the ground and onboard distributors onto Grid. Field ops, supply chain and a lot of fast problem-solving.',
  },
  {
    icon: FiBriefcase,
    title: 'Business Development',
    types: ['Full-time'],
    blurb:
      'Partner with retailers, brands and distributors to grow the Fetch network. Own deals end-to-end — outreach, demos, contracts, onboarding.',
  },
  {
    icon: FiPenTool,
    title: 'Product Design',
    types: ['Internship', 'Full-time'],
    blurb:
      'Shape the touch UI on every Pod and the dashboards inside Grid. Visual, interaction and a healthy dose of motion design.',
  },
]

const mailto = (subject, prefill = '') => {
  const params = new URLSearchParams()
  params.set('subject', subject)
  if (prefill) params.set('body', prefill)
  return `mailto:${APPLY_EMAIL}?${params.toString()}`
}

const Careers = () => {
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

  return (
    <section id="careers" ref={ref} className="careers">
      <div className="careers-container">
        <div className="careers-header">
          <span className="eyebrow">Careers · We're hiring</span>
          <h2 className="section-title">
            Help us build the <span className="accent-text">smart retail stack.</span>
          </h2>
          <p className="section-description">
            Fetch is a small, hungry team turning India's retail floor into a
            connected network. If you want to ship hardware, software or
            relationships that show up in the real world, come work with us.
          </p>
        </div>

        <div className="careers-grid">
          {ROLES.map(({ icon: Icon, title, types, blurb }) => {
            const prefill = `Hi Fetch team,\n\nI'd like to apply for the ${title} role.\n\nA bit about me:\n\n— `
            return (
              <article className="role-card" key={title}>
                <div className="role-icon" aria-hidden="true"><Icon /></div>
                <h3 className="role-title">{title}</h3>
                <div className="role-types">
                  {types.map((t) => (
                    <span
                      key={t}
                      className={`role-chip ${t === 'Internship' ? 'is-intern' : ''}`}
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <p className="role-blurb">{blurb}</p>
                <a
                  className="role-apply"
                  href={mailto(`Application · ${title}`, prefill)}
                >
                  Apply <FiArrowRight aria-hidden="true" />
                </a>
              </article>
            )
          })}
        </div>

        <div className="careers-cta">
          <div className="careers-cta__body">
            <h3>Don't see your role?</h3>
            <p>
              We're hiring across the board. If you think you'd be a fit, send a
              note with what you'd want to build and we'll go from there.
            </p>
          </div>
          <a
            className="careers-cta__btn"
            href={mailto('Hello Fetch — careers')}
          >
            Email us <FiArrowRight aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  )
}

export default Careers
