import { Suspense, lazy, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import usePageMeta from '../hooks/usePageMeta'
import Hero from '../components/Hero'
import About from '../components/About'
import Products from '../components/Products'
import Features from '../components/Features'
import Partners from '../components/Partners'
import Portfolio from '../components/Portfolio'
import Contact from '../components/Contact'

/**
 * The Pod simulator is the heaviest thing on the page and sits below the fold,
 * so it's code-split. The Suspense fallback deliberately keeps `id="simulator"`
 * and a matching min-height: the navbar's "Try a Pod" link and the Konami
 * easter egg both scroll to that id, and without it they'd target nothing and
 * the swap would shift the page.
 */
const VendingSim = lazy(() => import('../components/VendingSim'))

const SimulatorPlaceholder = () => (
  <section id="simulator" aria-busy="true" style={{ minHeight: '620px' }} />
)

const HomePage = () => {
  const location = useLocation()

  usePageMeta({
    title: 'Fetch | Fetch Pods & Fetch Grid — Smart Retail by AIUM Tech',
    description:
      'Fetch is a smart retail technology company by AIUM Tech Private Limited. Fetch Pods are connected vending machines with UPI checkout and live inventory, deployed at Wrkwrk Triangle and St Joseph Engineering College in Mangalore. Fetch Grid is the retail operations platform connecting any retailer with their distributors.',
    canonical: 'https://thefetch.in/',
  })

  // Navigating in via /#section-id scrolls to that section after render.
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
      <Suspense fallback={<SimulatorPlaceholder />}>
        <VendingSim />
      </Suspense>
      <Features />
      <Partners />
      <Portfolio />
      <Contact />
    </>
  )
}

export default HomePage
