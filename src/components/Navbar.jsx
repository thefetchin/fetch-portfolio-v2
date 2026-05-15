import { useState, useEffect } from 'react'
import './Navbar.css'

const Navbar = ({ scrollY }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    setIsScrolled(scrollY > 50)
  }, [scrollY])

  const scrollToSection = (id) => {
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setIsMenuOpen(false)
    }
  }

  return (
    <nav className={`navbar ${isScrolled ? 'scrolled' : ''}`}>
      <div className="nav-container">
        <div className="nav-logo" onClick={() => scrollToSection('hero')}>
          <img src="/fetch-logo.svg" alt="Fetch" className="logo-image" />
        </div>
        <div className={`nav-menu ${isMenuOpen ? 'active' : ''}`}>
          <a href="#about" onClick={(e) => { e.preventDefault(); scrollToSection('about') }}>About</a>
          <a href="#partners" onClick={(e) => { e.preventDefault(); scrollToSection('partners') }}>Partners</a>
          <a href="#portfolio" onClick={(e) => { e.preventDefault(); scrollToSection('portfolio') }}>Portfolio</a>
          <a href="#contact" onClick={(e) => { e.preventDefault(); scrollToSection('contact') }}>Contact</a>
        </div>
        <button 
          className={`nav-toggle ${isMenuOpen ? 'active' : ''}`}
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label="Toggle menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>
    </nav>
  )
}

export default Navbar

