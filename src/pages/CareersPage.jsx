import { useEffect } from 'react'
import Careers from '../components/Careers'

const CareersPage = () => {
  useEffect(() => {
    window.scrollTo({ top: 0 })
    const previousTitle = document.title
    document.title = 'Careers — Fetch'
    return () => {
      document.title = previousTitle
    }
  }, [])

  return <Careers />
}

export default CareersPage
