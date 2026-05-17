import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import Hero from '../components/Hero'
import About from '../components/About'
import Products from '../components/Products'
import Features from '../components/Features'
import Partners from '../components/Partners'
import Portfolio from '../components/Portfolio'
import VendingSim from '../components/VendingSim'
import Contact from '../components/Contact'

const HomePage = () => {
  const location = useLocation()

  // When navigating in via /#section-id, scroll to that section after render.
  useEffect(() => {
    if (!location.hash) {
      window.scrollTo({ top: 0 })
      return
    }
    const id = location.hash.slice(1)
    const t = setTimeout(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth' })
    }, 90)
    return () => clearTimeout(t)
  }, [location.hash, location.key])

  return (
    <>
      <Hero />
      <About />
      <Products />
      <Features />
      <Partners />
      <Portfolio />
      <VendingSim />
      <Contact />
    </>
  )
}

export default HomePage
