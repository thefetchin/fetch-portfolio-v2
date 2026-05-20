import { useEffect } from 'react'
import usePageMeta from '../hooks/usePageMeta'
import './PolicyLayout.css'

/**
 * Shared layout for the four policy pages. Page components pass their title,
 * meta description, canonical URL, last-updated date and the body of the
 * policy as children. The layout handles:
 *  - <title>, <meta>, <link rel=canonical> via usePageMeta
 *  - scroll-to-top on navigation
 *  - the page hero (eyebrow + title + Last updated)
 *  - the typographic article container
 */
const PolicyLayout = ({
  title,
  description,
  canonical,
  eyebrow = 'Legal',
  lastUpdated,
  children,
}) => {
  usePageMeta({
    title: `${title} — Fetch`,
    description,
    canonical,
  })

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  return (
    <main className="policy">
      <div className="policy-container">
        <header className="policy-header">
          <span className="eyebrow policy-eyebrow">{eyebrow}</span>
          <h1 className="policy-title">{title}</h1>
          {lastUpdated && (
            <p className="policy-meta">Last reviewed: {lastUpdated}</p>
          )}
        </header>

        <article className="policy-body">{children}</article>
      </div>
    </main>
  )
}

export default PolicyLayout
