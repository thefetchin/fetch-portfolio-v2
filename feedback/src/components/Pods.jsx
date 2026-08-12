import { useCallback, useEffect, useRef, useState } from 'react'
import './Pods.css'

/**
 * Pod registry + QR generation.
 *
 * The signed URL always comes from the Worker (only it holds QR_SECRET).
 * This component just renders that URL as a QR code and offers downloads.
 *
 * `qrcode` is pulled in with a dynamic import so it lands in its own chunk —
 * the public feedback form must not pay for a library only the dashboard
 * uses.
 */
let qrLibPromise = null
const loadQrLib = () => {
  if (!qrLibPromise) qrLibPromise = import('qrcode')
  return qrLibPromise
}

const QR_OPTIONS = {
  errorCorrectionLevel: 'H', // survives a logo sticker over the centre
  margin: 2,
  color: { dark: '#0a0e1a', light: '#ffffff' },
}

function PodQr({ pod }) {
  const [dataUrl, setDataUrl] = useState(null)
  const [svg, setSvg] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadQrLib()
      .then(async (mod) => {
        const QRCode = mod.default || mod
        const [png, svgText] = await Promise.all([
          QRCode.toDataURL(pod.url, { ...QR_OPTIONS, width: 1024 }),
          QRCode.toString(pod.url, { ...QR_OPTIONS, type: 'svg' }),
        ])
        if (!cancelled) {
          setDataUrl(png)
          setSvg(svgText)
        }
      })
      .catch(() => !cancelled && setFailed(true))
    return () => { cancelled = true }
  }, [pod.url])

  const download = (href, ext) => {
    const a = document.createElement('a')
    a.href = href
    a.download = `${pod.podId}.${ext}`
    a.click()
  }

  const downloadSvg = () => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    download(url, 'svg')
    URL.revokeObjectURL(url)
  }

  const printQr = () => {
    const w = window.open('', '_blank', 'width=600,height=800')
    if (!w) return
    w.document.write(`
      <html><head><title>${pod.podId}</title>
      <style>
        body{font-family:Inter,system-ui,sans-serif;text-align:center;padding:40px;margin:0}
        img{width:320px;height:320px;image-rendering:pixelated}
        h1{font-size:20px;margin:18px 0 4px;letter-spacing:-.01em}
        p{color:#555;margin:0;font-size:14px}
        .hint{margin-top:22px;font-size:15px;font-weight:600}
        @media print{@page{margin:12mm}}
      </style></head>
      <body>
        <img src="${dataUrl}" alt="${pod.podId}" />
        <h1>${pod.label}</h1>
        <p>${pod.location || ''}${pod.city ? ` · ${pod.city}` : ''}</p>
        <p class="hint">Scan to report a problem or give feedback</p>
        <script>window.onload=()=>window.print()<\/script>
      </body></html>`)
    w.document.close()
  }

  if (failed) {
    return <div className="qr-box qr-failed">Could not render the QR code.</div>
  }

  return (
    <div className="qr-box">
      {dataUrl
        ? <img className="qr-img" src={dataUrl} alt={`QR code for ${pod.podId}`} />
        : <div className="qr-skeleton" />}
      <div className="qr-actions">
        <button type="button" onClick={() => download(dataUrl, 'png')} disabled={!dataUrl}>PNG</button>
        <button type="button" onClick={downloadSvg} disabled={!svg}>SVG</button>
        <button type="button" onClick={printQr} disabled={!dataUrl}>Print</button>
      </div>
    </div>
  )
}

export default function Pods() {
  const [pods, setPods] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  const [podId, setPodId] = useState('')
  const [location, setLocation] = useState('')
  const [city, setCity] = useState('')
  const [label, setLabel] = useState('')
  const newestRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/pods')
      if (!res.ok) { setError('Could not load Pods.'); return }
      const data = await res.json()
      setPods(data.pods || [])
    } catch {
      setError('Could not reach the server.')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const res = await fetch('/api/admin/pods', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ podId, location, city, label }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || 'Could not save the Pod.')
      } else {
        setNotice(
          data.updated
            ? `${data.pod.podId} updated — its existing QR code still works.`
            : `${data.pod.podId} registered. Print its QR code below.`
        )
        setPodId(''); setLocation(''); setCity(''); setLabel('')
        await load()
        setTimeout(() => newestRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (pod) => {
    await fetch(`/api/admin/pods/${pod.podId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: !pod.active }),
    })
    load()
  }

  return (
    <section className="pods">
      <form className="pod-form" onSubmit={submit}>
        <h2>Add a Pod</h2>
        <p className="pod-form-sub">
          Registering a Pod creates its signed QR code. A Pod must exist here
          before its QR will accept any feedback.
        </p>

        <div className="pod-form-grid">
          <label>
            <span>Machine ID <em>required</em></span>
            <input
              value={podId}
              onChange={(e) => setPodId(e.target.value.toUpperCase())}
              placeholder="POD-MNG-003"
              required
            />
          </label>
          <label>
            <span>Location <em>required</em></span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Infosys Campus, Gate 2"
              required
            />
          </label>
          <label>
            <span>City</span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Mangalore"
            />
          </label>
          <label>
            <span>Display name</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="auto from the ID"
            />
          </label>
        </div>

        {error && <div className="pod-error" role="alert">{error}</div>}
        {notice && <div className="pod-notice" role="status">{notice}</div>}

        <button className="pod-submit" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Register Pod & generate QR'}
        </button>
      </form>

      <div className="pod-list-head">
        <h2>Pods</h2>
        <span>{pods ? `${pods.length} registered` : ''}</span>
      </div>

      {!pods && <p className="pod-empty">Loading…</p>}
      {pods?.length === 0 && <p className="pod-empty">No Pods registered yet.</p>}

      <div className="pod-grid">
        {pods?.map((pod, i) => (
          <article
            className={`pod-card ${pod.active ? '' : 'is-inactive'}`}
            key={pod.podId}
            ref={i === 0 ? newestRef : null}
          >
            <PodQr pod={pod} />
            <div className="pod-meta">
              <div className="pod-id">{pod.podId}</div>
              <div className="pod-label">{pod.label}</div>
              <div className="pod-loc">
                {pod.location}{pod.city ? ` · ${pod.city}` : ''}
              </div>
              <div className="pod-stats">
                {pod.submissionCount} submission{pod.submissionCount === 1 ? '' : 's'}
                {!pod.active && <span className="pod-badge">retired</span>}
              </div>
              <div className="pod-url" title={pod.url}>{pod.url}</div>
              <div className="pod-card-actions">
                <button type="button" onClick={() => navigator.clipboard?.writeText(pod.url)}>
                  Copy link
                </button>
                <button type="button" onClick={() => toggleActive(pod)}>
                  {pod.active ? 'Retire' : 'Reactivate'}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
