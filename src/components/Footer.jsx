import { FiArrowUp, FiInstagram, FiLinkedin, FiMail, FiPhone } from 'react-icons/fi'
import { useLocation, useNavigate } from 'react-router-dom'
import './Footer.css'

const Footer = () => {
  const navigate = useNavigate()
  const location = useLocation()

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  // Section links go to /#id, navigating home first if needed.
  const goToSection = (id) => (e) => {
    e.preventDefault()
    if (location.pathname !== '/') {
      navigate(`/#${id}`)
      return
    }
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }

  const goToPath = (path) => (e) => {
    e.preventDefault()
    navigate(path)
  }

  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-content">
          <div className="footer-brand">
            <img src="/fetch-logo.svg" alt="Fetch" className="footer-logo-image" />
            <p>
              Smart retail technology — Fetch Pods on the ground and Fetch Grid
              in the cloud, connecting retailers, distributors and brands across
              India.
            </p>
            <div className="footer-social">
              <a href="https://instagram.com/" aria-label="Instagram" target="_blank" rel="noreferrer"><FiInstagram /></a>
              <a href="https://linkedin.com/" aria-label="LinkedIn" target="_blank" rel="noreferrer"><FiLinkedin /></a>
              <a href="mailto:thefetch.in@gmail.com" aria-label="Email"><FiMail /></a>
              <a href="tel:+919019526185" aria-label="Phone"><FiPhone /></a>
            </div>
          </div>
          <div className="footer-links">
            <div className="footer-column">
              <h4>Products</h4>
              <a href="/#products"  onClick={goToSection('products')}>Fetch Pods</a>
              <a href="/#products"  onClick={goToSection('products')}>Fetch Grid <span className="footer-tag">soon</span></a>
              <a href="/#simulator" onClick={goToSection('simulator')}>Try a Pod</a>
            </div>
            <div className="footer-column">
              <h4>Company</h4>
              <a href="/#about"     onClick={goToSection('about')}>About</a>
              <a href="/#partners"  onClick={goToSection('partners')}>Partners</a>
              <a href="/#portfolio" onClick={goToSection('portfolio')}>Portfolio</a>
              <a href="/careers"    onClick={goToPath('/careers')}>Careers</a>
            </div>
            <div className="footer-column">
              <h4>Contact</h4>
              <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>
              <a href="tel:+919019526185">+91 90195 26185</a>
              <a href="/#contact" onClick={goToSection('contact')}>Get in touch</a>
            </div>
          </div>
        </div>
        <nav className="footer-legal" aria-label="Legal">
          <a href="/privacy" onClick={goToPath('/privacy')}>Privacy</a>
          <span aria-hidden="true">·</span>
          <a href="/terms" onClick={goToPath('/terms')}>Terms</a>
          <span aria-hidden="true">·</span>
          <a href="/cookies" onClick={goToPath('/cookies')}>Cookies</a>
          <span aria-hidden="true">·</span>
          <a href="/refunds" onClick={goToPath('/refunds')}>Refunds &amp; Grievance</a>
        </nav>
        <div className="footer-bottom">
          <p>
            &copy; {new Date().getFullYear()} <strong>AIUM Tech Private Limited</strong>
            <span className="footer-sep" aria-hidden="true"> · </span>
            <span>Operating as Fetch · Mangalore, India.</span>
          </p>
          <button className="scroll-to-top" onClick={scrollToTop} aria-label="Scroll to top">
            <FiArrowUp />
          </button>
        </div>
      </div>
    </footer>
  )
}

export default Footer
