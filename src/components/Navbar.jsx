import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './Navbar.css'

const Navbar = ({ scrollY }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    setIsScrolled(scrollY > 50)
  }, [scrollY])

  const closeMenu = () => setIsMenuOpen(false)

  // Section nav — works from any page. If we're not on /, we navigate to
  // /#id and let HomePage's effect handle the scroll after render.
  const goToSection = (id) => {
    closeMenu()
    if (location.pathname !== '/') {
      navigate(`/#${id}`)
      return
    }
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const goToPath = (path) => {
    closeMenu()
    navigate(path)
  }

  const onLogo = () => {
    closeMenu()
    if (location.pathname !== '/') {
      navigate('/')
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <nav className={`navbar ${isScrolled ? 'scrolled' : ''}`}>
      <div className="nav-container">
        <div className="nav-logo" onClick={onLogo}>
          <img src="/fetch-logo.svg" alt="Fetch" className="logo-image" />
        </div>
        <div className={`nav-menu ${isMenuOpen ? 'active' : ''}`}>
          <a href="/#about"     onClick={(e) => { e.preventDefault(); goToSection('about') }}>About</a>
          <a href="/#products"  onClick={(e) => { e.preventDefault(); goToSection('products') }}>Products</a>
          <a href="/#partners"  onClick={(e) => { e.preventDefault(); goToSection('partners') }}>Partners</a>
          <a href="/#portfolio" onClick={(e) => { e.preventDefault(); goToSection('portfolio') }}>Portfolio</a>
          <a href="/careers"    onClick={(e) => { e.preventDefault(); goToPath('/careers') }}>Careers</a>
          <a href="/#simulator" onClick={(e) => { e.preventDefault(); goToSection('simulator') }}>Try a Pod</a>
          <button
            type="button"
            className="nav-cta"
            onClick={() => goToSection('contact')}
          >
            Get in touch
          </button>
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
