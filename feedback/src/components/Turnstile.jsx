import { useEffect, useRef } from 'react'

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise = null

function loadScript() {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = SCRIPT_SRC
    el.async = true
    el.defer = true
    el.onload = resolve
    el.onerror = reject
    document.head.appendChild(el)
  })
  return scriptPromise
}

/**
 * Invisible-by-default Cloudflare Turnstile widget.
 * Calls onToken(token) once the challenge passes; onToken(null) if it
 * expires so the form can't submit a stale token.
 */
export default function Turnstile({ siteKey, onToken }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          appearance: 'interaction-only',
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        })
      })
      .catch(() => {
        // Script blocked or offline. onToken stays null, and the Worker
        // rejects a tokenless submit with "Bot check missing. Please retry."
        // once TURNSTILE_SECRET is configured. Before you configure it, the
        // Worker skips the check entirely, so the form still works.
        onToken(null)
      })

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          /* widget already gone */
        }
      }
    }
  }, [siteKey, onToken])

  return <div className="turnstile" ref={containerRef} />
}
