import { useEffect } from 'react'
import Locations from '../components/Locations'
import usePageMeta from '../hooks/usePageMeta'

const LocationsPage = () => {
  usePageMeta({
    title: 'Live Pod locations — Fetch',
    description:
      'Where to find a Fetch Pod. Live at Wrkwrk Triangle (premium coworking) and St Joseph Engineering College in Mangalore, Karnataka, with more sites being fitted. Pay by UPI.',
    canonical: 'https://thefetch.in/locations',
  })

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  return <Locations />
}

export default LocationsPage
