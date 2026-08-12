import { useEffect, useRef } from 'react'
import { FiMapPin } from 'react-icons/fi'
import './Deployments.css'

/**
 * Live deployments — real proof, placed directly under the hero.
 *
 * Only add a site here once a Pod is actually installed and running. This is
 * the section a prospect uses to decide whether Fetch is real, so an
 * aspirational entry here costs more than it gains.
 *
 * The wrkwrk wordmark is supplied as white artwork on a solid black plate,
 * so it's composited with `mix-blend-mode: screen` against the dark strip —
 * that drops the black to nothing without re-cutting the asset.
 */
const SITES = [
  {
    name: 'wrkwrk Triangle',
    kind: 'Premium coworking',
    city: 'Mangalore',
    logo: '/partners/wrkwrk.png',
    logoAlt: 'wrkwrk',
  },
  {
    name: 'St Joseph Engineering College',
    kind: 'Engineering campus',
    city: 'Mangalore',
    logo: null,
  },
]

const Deployments = () => {
  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('visible')),
      { threshold: 0.1 }
    )
    obs.observe(node)
    return () => obs.unobserve(node)
  }, [])

  return (
    <section id="deployments" ref={ref} className="deployments">
      <div className="deployments-container">
        <p className="deployments-eyebrow">
          <span className="deployments-dot" aria-hidden="true" />
          Pods live now in Mangalore
        </p>

        <ul className="deployments-list">
          {SITES.map((site) => (
            <li className="deployment" key={site.name}>
              {site.logo ? (
                <img
                  src={site.logo}
                  alt={site.logoAlt}
                  className="deployment-logo"
                  loading="lazy"
                />
              ) : (
                <span className="deployment-name">{site.name}</span>
              )}
              <span className="deployment-meta">
                {site.logo && <span className="deployment-name-sm">{site.name}</span>}
                <span className="deployment-kind">
                  {site.kind}
                  <span className="deployment-city">
                    <FiMapPin aria-hidden="true" /> {site.city}
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default Deployments
