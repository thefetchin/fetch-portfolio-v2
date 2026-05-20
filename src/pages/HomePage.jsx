import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import usePageMeta from '../hooks/usePageMeta'
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

  usePageMeta({
    title: 'Fetch | Fetch Pods & Fetch Grid — Smart Retail by AIUM Tech',
    description:
      'Fetch is a smart retail technology company by AIUM Tech Private Limited. Fetch Pods are connected vending machines with UPI checkout and live inventory. Fetch Grid is the retail operations platform connecting any retailer with their distributors.',
    canonical: 'https://thefetch.in/',
  })

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
