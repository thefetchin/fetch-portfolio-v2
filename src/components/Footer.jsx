import { FiArrowUp, FiInstagram, FiLinkedin, FiMail, FiPhone } from 'react-icons/fi'
import './Footer.css'

const Footer = () => {
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  const scrollTo = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
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
              <a href="#products" onClick={(e) => { e.preventDefault(); scrollTo('products') }}>Fetch Pods</a>
              <a href="#products" onClick={(e) => { e.preventDefault(); scrollTo('products') }}>Fetch Grid <span className="footer-tag">soon</span></a>
              <a href="#simulator" onClick={(e) => { e.preventDefault(); scrollTo('simulator') }}>Try a Pod</a>
            </div>
            <div className="footer-column">
              <h4>Company</h4>
              <a href="#about" onClick={(e) => { e.preventDefault(); scrollTo('about') }}>About</a>
              <a href="#partners" onClick={(e) => { e.preventDefault(); scrollTo('partners') }}>Partners</a>
              <a href="#portfolio" onClick={(e) => { e.preventDefault(); scrollTo('portfolio') }}>Portfolio</a>
            </div>
            <div className="footer-column">
              <h4>Contact</h4>
              <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>
              <a href="tel:+919019526185">+91 90195 26185</a>
              <a href="#contact" onClick={(e) => { e.preventDefault(); scrollTo('contact') }}>Get in touch</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} Fetch. All rights reserved.</p>
          <button className="scroll-to-top" onClick={scrollToTop} aria-label="Scroll to top">
            <FiArrowUp />
          </button>
        </div>
      </div>
    </footer>
  )
}

export default Footer
