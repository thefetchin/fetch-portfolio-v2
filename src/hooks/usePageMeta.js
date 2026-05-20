import { useEffect } from 'react'

/**
 * Sets <title> + <meta name="description"> for the duration of the
 * component's lifetime, then restores the previous values on unmount.
 * Lets each route advertise its own snippet to crawlers without
 * pulling in a Helmet-style dependency.
 */
export default function usePageMeta({ title, description, canonical } = {}) {
  useEffect(() => {
    const prevTitle = document.title
    const descEl = document.querySelector('meta[name="description"]')
    const prevDesc = descEl ? descEl.getAttribute('content') : null
    const canonEl = document.querySelector('link[rel="canonical"]')
    const prevCanon = canonEl ? canonEl.getAttribute('href') : null

    if (title) document.title = title
    if (description && descEl) descEl.setAttribute('content', description)
    if (canonical && canonEl) canonEl.setAttribute('href', canonical)

    return () => {
      document.title = prevTitle
      if (descEl && prevDesc != null) descEl.setAttribute('content', prevDesc)
      if (canonEl && prevCanon != null) canonEl.setAttribute('href', prevCanon)
    }
  }, [title, description, canonical])
}
