import { useEffect, useState } from 'react'
import FeedbackForm from './components/FeedbackForm'
import Admin from './components/Admin'
import './App.css'

/**
 * Tiny hand-rolled router — this app has exactly two surfaces, so pulling in
 * react-router would be more weight than the whole form.
 *
 *   /p/<POD_ID>?t=<sig>  → the feedback form for that Pod
 *   /admin               → the Cloudflare Access-protected dashboard
 */
function parseRoute() {
  const { pathname, searchParams } = new URL(window.location.href)

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return { view: 'admin' }
  }

  const podMatch = pathname.match(/^\/p\/([^/]+)\/?$/)
  if (podMatch) {
    return {
      view: 'form',
      podId: decodeURIComponent(podMatch[1]),
      podToken: searchParams.get('t') || '',
    }
  }

  return { view: 'landing' }
}

export default function App() {
  const [route] = useState(parseRoute)

  useEffect(() => {
    document.title =
      route.view === 'admin' ? 'Submissions — Fetch' : 'Feedback — Fetch'
  }, [route.view])

  if (route.view === 'admin') return <Admin />

  if (route.view === 'form') {
    return <FeedbackForm podId={route.podId} podToken={route.podToken} />
  }

  return (
    <main className="landing">
      <div className="landing-card">
        <img src="/fetch-logo.svg" alt="Fetch" className="landing-logo" />
        <h1>Scan the QR on a Fetch Pod</h1>
        <p>
          This page is for feedback about a specific Fetch Pod. Scan the QR
          code on the machine to tell us what happened — it takes about
          twenty seconds.
        </p>
        <p className="landing-alt">
          Need us for something else?{' '}
          <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>
        </p>
      </div>
    </main>
  )
}
