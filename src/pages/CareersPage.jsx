import Careers from '../components/Careers'
import usePageMeta from '../hooks/usePageMeta'
import { useEffect } from 'react'

const CareersPage = () => {
  usePageMeta({
    title: 'Careers & Internships — Fetch (AIUM Tech)',
    description:
      'Internships at Fetch (AIUM Tech Private Limited) across software, hardware, operations and product design. Help us build Fetch Pods and Fetch Grid — smart retail end to end.',
    canonical: 'https://thefetch.in/careers',
  })

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  return <Careers />
}

export default CareersPage
