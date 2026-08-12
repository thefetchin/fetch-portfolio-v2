import { useEffect, useRef } from 'react'
import './Portfolio.css'

/**
 * Use cases, not a client list.
 *
 * This section describes the environments Fetch Pods are built for and what a
 * deployment involves. It deliberately makes no claim about completed
 * installations — replace individual cards with real case studies (named site,
 * photo, measured outcome) as deployments go live.
 *
 * The section id stays "portfolio" so existing links and the sitemap entry
 * keep resolving.
 */
const Portfolio = () => {
  const portfolioRef = useRef(null)

  useEffect(() => {
    const node = portfolioRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('visible')
        })
      },
      { threshold: 0.1 }
    )
    observer.observe(node)
    return () => observer.unobserve(node)
  }, [])

  const environments = [
    {
      title: 'Offices',
      host: 'Corporate floors & co-working',
      live: 'wrkwrk Triangle, Mangalore',
      description:
        'A Pod on the floor means staff stop leaving the building for a snack. Placed near lifts, break-out areas or reception, it runs unattended and restocks on a schedule set by real consumption data.',
      solves: 'Convenience without a staffed pantry',
    },
    {
      title: 'Campuses',
      host: 'Universities & training institutes',
      live: 'St Joseph Engineering College, Mangalore',
      description:
        'Long teaching days and scattered buildings make a single canteen a bottleneck. Pods extend food and drink access to libraries, hostels and departments that could never justify their own counter.',
      solves: 'Coverage where a canteen cannot reach',
    },
    {
      title: 'Healthcare',
      host: 'Hospitals & clinics',
      description:
        'Visitors, night staff and patients need something at hours nothing else is open. Assortment can be weighted towards water, healthier snacks and caffeine, with 24/7 availability and cashless-only payment.',
      solves: 'Round-the-clock access on quiet wards',
    },
    {
      title: 'Transit',
      host: 'Stations, terminals & transport hubs',
      description:
        'High footfall, short dwell time, and customers who will not queue. A Pod handles a purchase in seconds over UPI, and the digital screen doubles as brand inventory in a high-attention location.',
      solves: 'Seconds-long purchases at peak flow',
    },
  ]

  return (
    <section id="portfolio" ref={portfolioRef} className="portfolio">
      <div className="portfolio-container">
        <div className="portfolio-header">
          <span className="eyebrow">Where Pods fit</span>
          <h2 className="section-title">
            Built for the places <span className="accent-text">people pass through</span>
          </h2>
          <p className="section-description">
            Pods are live in coworking and on campus in Mangalore. These are the
            settings they're built for, and what a deployment looks like in each.
          </p>
        </div>
        <div
          className="portfolio-grid"
          tabIndex={0}
          role="group"
          aria-label="Environments Fetch Pods are built for — scroll horizontally"
        >
          {environments.map((env, index) => (
            <div key={env.title} className="portfolio-card">
              <div className="portfolio-card-header">
                <div className="portfolio-number">{String(index + 1).padStart(2, '0')}</div>
                {env.live && (
                  <span className="portfolio-live">
                    <span className="portfolio-live-dot" aria-hidden="true" />
                    Live
                  </span>
                )}
              </div>
              <h3 className="portfolio-title">{env.title}</h3>
              <p className="portfolio-location">{env.host}</p>
              <p className="portfolio-description">{env.description}</p>
              <div className="portfolio-transformation">
                <span className="transformation-label">
                  {env.live ? 'Deployed at' : 'What it solves'}
                </span>
                <span className="transformation-text">
                  {env.live || env.solves}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Portfolio
