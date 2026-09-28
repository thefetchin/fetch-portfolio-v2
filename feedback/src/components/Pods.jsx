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
  // Decides which questions this machine's QR will ask.
  const [machineType, setMachineType] = useState('snacks')
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
        body: JSON.stringify({ podId, location, city, label, machineType }),
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

  const [editing, setEditing] = useState(null)   // podId being edited
  const [draft, setDraft] = useState({ label: '', location: '', city: '' })
  const [subs, setSubs] = useState({})           // podId -> active subscriber count

  // How many people would actually receive a message, per Pod. Shown on the
  // button so nobody presses "notify" without knowing the size of the audience.
  const loadSubs = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/whatsapp?status=active', { credentials: 'include' })
      if (!r.ok) return
      const d = await r.json()
      const counts = {}
      for (const o of d.optins || []) counts[o.pod_id] = (counts[o.pod_id] || 0) + 1
      setSubs(counts)
    } catch { /* the page is still useful without the counts */ }
  }, [])

  useEffect(() => { loadSubs() }, [loadSubs])

  const startEdit = (pod) => {
    setEditing(pod.podId)
    setDraft({
      label: pod.label || '', location: pod.location || '', city: pod.city || '',
      machineType: pod.machineType || 'snacks',
    })
    setError(null)
  }

  const saveEdit = async (pod) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/pods/${pod.podId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.message || 'Could not save those details.')
      setEditing(null)
      setNotice(`${d.pod.label} updated. The QR code is unchanged.`)
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const notify = async (pod) => {
    const n = subs[pod.podId] || 0
    if (!window.confirm(
      `Send the refill message to ${n} ${n === 1 ? 'person' : 'people'} subscribed to `
      + `${pod.label}?\n\nThis reaches real phones and cannot be undone.`
    )) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/admin/pods/${pod.podId}/notify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.message || 'Could not send.')
      setNotice(d.message)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
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
            <span>Machine type</span>
            <select value={machineType} onChange={(e) => setMachineType(e.target.value)}>
              <option value="snacks">Snacks &amp; drinks</option>
              <option value="coffee">Coffee</option>
            </select>
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
              <div className="pod-kind">
                {pod.machineType === 'coffee' ? '☕ Coffee' : '🍫 Snacks & drinks'}
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
                <button type="button" onClick={() => startEdit(pod)}>Edit details</button>
                <button
                  type="button"
                  className="pod-notify"
                  disabled={busy || !pod.active || !(subs[pod.podId] > 0)}
                  onClick={() => notify(pod)}
                  title={subs[pod.podId]
                    ? 'Send the refill message to everyone subscribed to this Pod'
                    : 'Nobody has subscribed to this Pod yet'}
                >
                  Notify {subs[pod.podId] || 0}
                </button>
                <button type="button" onClick={() => toggleActive(pod)}>
                  {pod.active ? 'Retire' : 'Reactivate'}
                </button>
              </div>

              {editing === pod.podId && (
                <div className="pod-edit">
                  {/*
                    The machine ID is shown but not editable. It is baked into
                    the printed QR and signed, so changing it would silently
                    break every sticker already on a machine.
                  */}
                  <p className="pod-edit-fixed">
                    Machine ID <code>{pod.podId}</code> cannot change — it is printed
                    in the QR code on the machine.
                  </p>
                  <label>
                    <span>Display name</span>
                    <input
                      value={draft.label} maxLength={60}
                      onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Location</span>
                    <input
                      value={draft.location} maxLength={120}
                      onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>City</span>
                    <input
                      value={draft.city} maxLength={60}
                      onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Machine type</span>
                    <select
                      value={draft.machineType || 'snacks'}
                      onChange={(e) => setDraft({ ...draft, machineType: e.target.value })}
                    >
                      <option value="snacks">Snacks &amp; drinks</option>
                      <option value="coffee">Coffee</option>
                    </select>
                    <span className="pod-edit-note">
                      Changes which questions this machine&apos;s QR asks. The QR itself
                      is unaffected.
                    </span>
                  </label>
                  <p className="pod-edit-note">
                    These appear on the feedback page and in the WhatsApp refill
                    message, so they are read by customers.
                  </p>
                  <div className="pod-card-actions">
                    <button type="button" onClick={() => saveEdit(pod)} disabled={busy}>
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
