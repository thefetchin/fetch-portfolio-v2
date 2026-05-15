import './Footer.css'

const Footer = () => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-content">
          <div className="footer-brand">
            <img src="/fetch-logo.svg" alt="Fetch" className="footer-logo-image" />
            <p>Smart vending solutions for modern spaces</p>
          </div>
          <div className="footer-links">
            <div className="footer-column">
              <h4>Company</h4>
              <a href="#about">About</a>
              <a href="#services">Services</a>
              <a href="#portfolio">Portfolio</a>
            </div>
            <div className="footer-column">
              <h4>Resources</h4>
              <a href="#contact">Contact</a>
              <a href="#contact">Support</a>
              <a href="#contact">FAQ</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} Fetch. All rights reserved.</p>
          <button className="scroll-to-top" onClick={scrollToTop} aria-label="Scroll to top">
            ↑
          </button>
        </div>
      </div>
    </footer>
  )
}

export default Footer

