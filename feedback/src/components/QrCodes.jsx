import { useCallback, useEffect, useState } from 'react'
import './QrCodes.css'

/**
 * A general-purpose QR generator.
 *
 * Distinct from Pods & QR codes: those are signed, tied to a machine and point
 * at the feedback form. These are for posters, flyers and table tents, and
 * encode whatever they are given.
 *
 * `qrcode` is pulled in with a dynamic import, as the Pods tab does, so the
 * public feedback form never pays for a library only the dashboard uses.
 */
let qrLibPromise = null
const loadQrLib = () => {
  if (!qrLibPromise) qrLibPromise = import('qrcode')
  return qrLibPromise
}

const QR_OPTIONS = {
  errorCorrectionLevel: 'H',   // survives a logo or a scuff on a printed poster
  margin: 2,
  color: { dark: '#0a0e1a', light: '#ffffff' },
}

const fmtWhen = (iso) => {
  if (!iso) return 'never'
  const d = new Date(String(iso).replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function Qr({ value, label }) {
  const [png, setPng] = useState(null)
  const [svg, setSvg] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadQrLib()
      .then(async (mod) => {
        const QRCode = mod.default || mod
        const [p, s] = await Promise.all([
          QRCode.toDataURL(value, { ...QR_OPTIONS, width: 1024 }),
          QRCode.toString(value, { ...QR_OPTIONS, type: 'svg' }),
        ])
        if (!cancelled) { setPng(p); setSvg(s) }
      })
      .catch(() => !cancelled && setFailed(true))
    return () => { cancelled = true }
  }, [value])

  const safeName = (label || 'qr').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const download = (href, ext, revoke) => {
    const a = document.createElement('a')
    a.href = href
    a.download = `${safeName}.${ext}`
    a.click()
    if (revoke) URL.revokeObjectURL(href)
  }

  if (failed) return <div className="qr-box qr-failed">Could not draw this code.</div>
  if (!png) return <div className="qr-box qr-skeleton" />

  return (
    <div className="qr-box">
      <img className="qr-img" src={png} alt={`QR code for ${label}`} />
      <div className="qr-actions">
        <button type="button" onClick={() => download(png, 'png')}>PNG</button>
        <button
          type="button"
          onClick={() => download(
            URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), 'svg', true
          )}
        >
          SVG
        </button>
      </div>
    </div>
  )
}

export default function QrCodes() {
  const [codes, setCodes] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [scans, setScans] = useState({})

  const [kind, setKind] = useState('link')
  const [label, setLabel] = useState('')
  const [content, setContent] = useState('')
  const [tracked, setTracked] = useState(true)
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [security, setSecurity] = useState('WPA')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/qr', { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not load the codes.')
      setCodes(d.codes || [])
    } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      const body = kind === 'wifi'
        ? { label, kind, ssid, password, security }
        : { label, kind, content, tracked: kind === 'link' ? tracked : false }
      const r = await fetch('/api/admin/qr', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not create it.')
      setLabel(''); setContent(''); setSsid(''); setPassword('')
      setNotice(`Created ${d.code}.`)
      load()
    } catch (e2) { setError(e2.message) } finally { setBusy(false) }
  }

  const patch = async (code, body, msg) => {
    try {
      const r = await fetch(`/api/admin/qr/${code}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not update it.')
      setNotice(msg)
      load()
    } catch (e) { setError(e.message) }
  }

  const showScans = async (code) => {
    if (scans[code]) { setScans((s) => ({ ...s, [code]: null })); return }
    try {
      const r = await fetch(`/api/admin/qr/${code}/scans`, { credentials: 'include' })
      const d = await r.json()
      setScans((s) => ({ ...s, [code]: d }))
    } catch (e) { setError(e.message) }
  }

  const list = codes || []

  return (
    <section className="qrg">
      {error && <div className="qrg-error" role="alert">{error}</div>}
      {notice && <div className="qrg-notice" role="status">{notice}</div>}

      <form className="qrg-form" onSubmit={create}>
        <h2>Make a QR code</h2>
        <p className="qrg-sub">
          For posters, flyers and table tents. The Pod codes on the
          <strong> Pods &amp; QR codes </strong> tab are separate — those are signed
          and tied to a machine.
        </p>

        <div className="qrg-kinds">
          {[['link', 'Web link'], ['text', 'Plain text'], ['wifi', 'Wi-Fi']].map(([k, l]) => (
            <button
              key={k} type="button"
              className={`qrg-kind ${kind === k ? 'is-active' : ''}`}
              onClick={() => setKind(k)}
            >
              {l}
            </button>
          ))}
        </div>

        <label className="qrg-field">
          <span>What is it for</span>
          <input
            value={label} maxLength={80} required
            placeholder="Lobby poster, SJEC"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>

        {kind === 'link' && (
          <>
            <label className="qrg-field">
              <span>Web address</span>
              <input
                value={content} maxLength={900} required
                placeholder="https://thefetch.in"
                onChange={(e) => setContent(e.target.value)}
              />
            </label>
            <label className="qrg-check">
              <input
                type="checkbox" checked={tracked}
                onChange={(e) => setTracked(e.target.checked)}
              />
              <span>Count scans, and let me change where it points later</span>
            </label>
            <p className="qrg-hint">
              {tracked
                ? 'The code will encode a short link of ours, so scans can be counted '
                  + 'and the destination changed after the poster is printed. It stops '
                  + 'working if this service does.'
                : 'The code will encode the address directly. Nothing is counted and it '
                  + 'cannot be repointed once printed — but it keeps working regardless '
                  + 'of us.'}
            </p>
          </>
        )}

        {kind === 'text' && (
          <label className="qrg-field">
            <span>Text</span>
            <textarea
              rows={3} value={content} maxLength={900} required
              placeholder="Anything a phone should show when scanned"
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
        )}

        {kind === 'wifi' && (
          <>
            <label className="qrg-field">
              <span>Network name</span>
              <input value={ssid} maxLength={64} required onChange={(e) => setSsid(e.target.value)} />
            </label>
            <label className="qrg-field">
              <span>Security</span>
              <select value={security} onChange={(e) => setSecurity(e.target.value)}>
                <option value="WPA">WPA / WPA2</option>
                <option value="WEP">WEP</option>
                <option value="nopass">Open, no password</option>
              </select>
            </label>
            {security !== 'nopass' && (
              <label className="qrg-field">
                <span>Password</span>
                <input value={password} maxLength={96} onChange={(e) => setPassword(e.target.value)} />
                <em>
                  Encoded into the QR in plain text — anyone who scans it joins the
                  network. Use it for a guest network, not your own.
                </em>
              </label>
            )}
          </>
        )}

        <button type="submit" className="qrg-submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create QR code'}
        </button>
      </form>

      <div className="qrg-list-head">
        <h2>Codes</h2>
        <span className="qrg-count">{list.length} made</span>
      </div>

      {!codes && <p className="qrg-empty">Loading…</p>}
      {codes?.length === 0 && <p className="qrg-empty">Nothing yet.</p>}

      <div className="qrg-grid">
        {list.map((c) => (
          <article key={c.code} className={`qrg-card ${c.active ? '' : 'is-off'}`}>
            <Qr value={c.value} label={c.label} />
            <div className="qrg-meta">
              <div className="qrg-label">{c.label}</div>
              <div className="qrg-code">{c.code} · {c.kind}{c.tracked ? ' · tracked' : ''}</div>

              <div className="qrg-value" title={c.value}>{c.value}</div>

              {c.tracked ? (
                <div className="qrg-stats">
                  <span><strong>{c.scans}</strong> scans</span>
                  <span><strong>{c.people}</strong> people</span>
                  <span>last {fmtWhen(c.last_scan_at)}</span>
                </div>
              ) : (
                <div className="qrg-stats qrg-untracked">
                  Not tracked — nothing is counted for this one.
                </div>
              )}

              <div className="qrg-actions">
                <button type="button" onClick={() => navigator.clipboard?.writeText(c.value)}>
                  Copy
                </button>
                {c.tracked && (
                  <button type="button" onClick={() => showScans(c.code)}>
                    {scans[c.code] ? 'Hide scans' : 'Scans'}
                  </button>
                )}
                {c.tracked && c.active && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = window.prompt('Point this code somewhere else:', c.content)
                      if (next && next !== c.content) {
                        patch(c.code, { content: next }, 'Repointed. Printed codes keep working.')
                      }
                    }}
                  >
                    Repoint
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => patch(c.code, { active: !c.active },
                    c.active ? 'Retired.' : 'Back in use.')}
                >
                  {c.active ? 'Retire' : 'Reactivate'}
                </button>
              </div>

              {scans[c.code] && (
                <div className="qrg-scans">
                  {!scans[c.code].daily?.length && <p className="qrg-hint">No scans yet.</p>}
                  {scans[c.code].daily?.map((d) => (
                    <div key={d.day} className="qrg-day">
                      <span>{d.day}</span>
                      <span className="qrg-bar" style={{ width: `${Math.min(100, d.scans * 8)}%` }} />
                      <span>{d.scans}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
