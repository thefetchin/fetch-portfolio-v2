import { useNavigate } from 'react-router-dom'
import { FiMapPin, FiArrowRight, FiArrowLeft } from 'react-icons/fi'
import './Locations.css'

/**
 * Live Pod locations.
 *
 * Add a site here only once its Pod is installed and serving. Everything
 * stated per-site must be verifiable — name, venue type, city. Access hours
 * are deliberately described as "the host's opening hours" rather than
 * claiming 24/7, because that depends on the building, not on us.
 *
 * The wrkwrk wordmark is supplied as white artwork on a solid black plate, so
 * it sits on a dark tile with mix-blend-mode: screen to drop the plate.
 */
const LOCATIONS = [
  {
    name: 'Wrkwrk Triangle',
    venue: 'Premium coworking & managed workspaces',
    city: 'Mangalore, Karnataka',
    logo: '/partners/wrkwrk.png',
    logoAlt: 'Wrkwrk',
    audience: 'Members, teams and visitors',
    note:
      'A Pod on the workspace floor, so members can grab a drink or a snack between calls without leaving the building.',
  },
  {
    name: 'St Joseph Engineering College',
    venue: 'Engineering campus',
    city: 'Mangalore, Karnataka',
    logo: null,
    audience: 'Students, faculty and staff',
    note:
      'Serving a campus where teaching runs long and the canteen cannot be everywhere at once.',
  },
]

const Locations = () => {
  const navigate = useNavigate()

  return (
    <main className="locations">
      <div className="locations-container">
        <header className="locations-head">
          <button
            type="button"
            className="locations-back"
            onClick={() => navigate('/')}
          >
            <FiArrowLeft aria-hidden="true" /> Back to Fetch
          </button>

          <span className="locations-eyebrow">
            <span className="locations-dot" aria-hidden="true" />
            Live now
          </span>

          <h1 className="locations-title">
            Where you'll find a <span className="accent-text">Fetch Pod</span>
          </h1>
          <p className="locations-sub">
            Our Pods are live in Mangalore, with more sites being fitted. Each one
            takes payment over UPI, and is restocked on what it actually sells
            rather than on a fixed round.
          </p>
        </header>

        <ul className="locations-list">
          {LOCATIONS.map((loc) => (
            <li className="location" key={loc.name}>
              <div className={`location-mark ${loc.logo ? 'has-logo' : ''}`}>
                {loc.logo ? (
                  <img src={loc.logo} alt={loc.logoAlt} loading="lazy" />
                ) : (
                  <span aria-hidden="true">{loc.name.charAt(0)}</span>
                )}
              </div>

              <div className="location-body">
                <div className="location-top">
                  <h2 className="location-name">{loc.name}</h2>
                  <span className="location-live">
                    <span className="location-live-dot" aria-hidden="true" />
                    Pod live
                  </span>
                </div>

                <p className="location-venue">{loc.venue}</p>
                <p className="location-note">{loc.note}</p>

                <dl className="location-facts">
                  <div>
                    <dt>City</dt>
                    <dd>
                      <FiMapPin aria-hidden="true" /> {loc.city}
                    </dd>
                  </div>
                  <div>
                    <dt>Serves</dt>
                    <dd>{loc.audience}</dd>
                  </div>
                  <div>
                    <dt>Access</dt>
                    <dd>The host's opening hours</dd>
                  </div>
                </dl>
              </div>
            </li>
          ))}
        </ul>

        <section className="locations-cta">
          <div>
            <h2>Want a Pod at your site?</h2>
            <p>
              Offices, campuses, healthcare and transit hubs. Tell us about the
              space and we'll come back within one business day with a
              recommendation.
            </p>
          </div>
          <div className="locations-cta-actions">
            <button
              type="button"
              className="locations-btn"
              onClick={() => navigate('/#contact')}
            >
              Host a Pod <FiArrowRight aria-hidden="true" />
            </button>
            <button
              type="button"
              className="locations-btn locations-btn--ghost"
              onClick={() => navigate('/#simulator')}
            >
              Try a Pod first
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}

export default Locations
