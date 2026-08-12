import { useEffect, useRef, useState } from 'react'
import {
  ISSUE_TYPES,
  OCCURRED_WHEN,
  PRODUCT_CATEGORIES,
  PRICE_FEEL,
  USAGE_FREQ,
  RATINGS,
  PAYMENT_ISSUES,
  LIMITS,
} from '../../shared/constants.js'
import Turnstile from './Turnstile'
import './FeedbackForm.css'

const CHIP = 'chip'

function Chips({ options, value, onChange, name, multi = false }) {
  const isOn = (v) => (multi ? value.includes(v) : value === v)
  const toggle = (v) => {
    if (!multi) return onChange(value === v ? null : v)
    return onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  }

  return (
    <div className="chips" role={multi ? 'group' : 'radiogroup'} aria-label={name}>
      {options.map((opt) => (
        <button
          type="button"
          key={opt.value}
          className={`${CHIP} ${isOn(opt.value) ? 'is-on' : ''}`}
          onClick={() => toggle(opt.value)}
          aria-pressed={isOn(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default function FeedbackForm({ podId, podToken }) {
  const [pod, setPod] = useState(null)
  const [podError, setPodError] = useState(null)
  const [tab, setTab] = useState('complaint')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const [turnstileToken, setTurnstileToken] = useState(null)
  const [siteKey, setSiteKey] = useState(null)

  // Honeypot + dwell time: bots fill hidden fields and submit instantly.
  const [honeypot, setHoneypot] = useState('')
  const mountedAt = useRef(Date.now())

  // Complaint state
  const [issueType, setIssueType] = useState(null)
  const [occurredWhen, setOccurredWhen] = useState(null)
  const [amount, setAmount] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [refundRequested, setRefundRequested] = useState(false)

  // Feedback state
  const [rating, setRating] = useState(null)
  const [wantedCategories, setWantedCategories] = useState([])
  const [wantedText, setWantedText] = useState('')
  const [priceFeel, setPriceFeel] = useState(null)
  const [usageFreq, setUsageFreq] = useState(null)
  const [notifyOptIn, setNotifyOptIn] = useState(false)

  // Shared
  const [productCategory, setProductCategory] = useState(null)
  const [productText, setProductText] = useState('')
  const [comment, setComment] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')

  useEffect(() => {
    let cancelled = false

    fetch(`/api/pod/${encodeURIComponent(podId)}?t=${encodeURIComponent(podToken)}`)
      .then(async (res) => {
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) setPodError(data.message || 'This link is not valid.')
        else setPod(data.pod)
      })
      .catch(() => !cancelled && setPodError('We could not reach the server.'))

    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => !cancelled && setSiteKey(d.turnstileSiteKey))
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [podId, podToken])

  const isPaymentIssue = PAYMENT_ISSUES.includes(issueType)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)

    // Client-side mirror of the server rules, purely so the user gets a fast
    // answer. The server re-checks everything regardless.
    if (tab === 'complaint') {
      if (!issueType) return setError('Please tell us what went wrong.')
      if (!occurredWhen) return setError('Please tell us when this happened.')
      if (refundRequested && !contactEmail.trim() && !contactPhone.trim()) {
        return setError('Add an email or phone number so we can process the refund.')
      }
    } else {
      if (!rating) return setError('Please tap a rating.')
      if (notifyOptIn && !contactEmail.trim()) {
        return setError("Add your email if you'd like us to tell you when we stock it.")
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          podId,
          podToken,
          kind: tab,
          turnstileToken,
          website: honeypot, // honeypot — always empty for real users
          dwellMs: Date.now() - mountedAt.current,
          // complaint
          issueType,
          occurredWhen,
          amount: amount || null,
          paymentRef,
          refundRequested,
          // feedback
          rating,
          wantedCategories,
          wantedText,
          priceFeel,
          usageFreq,
          notifyOptIn,
          // shared
          productCategory,
          productText,
          comment,
          contactEmail,
          contactPhone,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || 'Something went wrong. Please try again.')
      } else {
        setDone(tab)
      }
    } catch {
      setError('We could not reach the server. Please check your connection.')
    } finally {
      setSubmitting(false)
    }
  }

  /* ---------------------------------------------------------- states --- */

  if (podError) {
    return (
      <main className="shell">
        <div className="card card-message">
          <div className="msg-icon msg-icon-warn">!</div>
          <h1>This link isn&apos;t valid</h1>
          <p>{podError}</p>
          <p className="muted">
            Please scan the QR code directly from the Pod, or email us at{' '}
            <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>.
          </p>
        </div>
      </main>
    )
  }

  if (done) {
    return (
      <main className="shell">
        <div className="card card-message">
          <div className="msg-icon msg-icon-ok">✓</div>
          <h1>{done === 'complaint' ? 'Thanks — we&apos;re on it' : 'Thanks for the feedback'}</h1>
          <p>
            {done === 'complaint'
              ? refundRequested
                ? 'We\'ve logged your report. If a refund is due, we\'ll get it back to you within 7 business days.'
                : 'We\'ve logged your report and the team will look into it.'
              : 'This goes straight to the team that decides what each Pod stocks.'}
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => window.location.reload()}
          >
            Send another
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="shell">
      <div className="card">
        <header className="head">
          <img src="/fetch-logo.svg" alt="Fetch" className="head-logo" />
          {pod ? (
            <div className="pod">
              <span className="pod-label">{pod.label}</span>
              {pod.location && <span className="pod-loc">{pod.location}</span>}
            </div>
          ) : (
            <div className="pod pod-loading">
              <span className="skeleton" />
            </div>
          )}
        </header>

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'complaint'}
            className={`tab ${tab === 'complaint' ? 'is-active' : ''}`}
            onClick={() => { setTab('complaint'); setError(null) }}
          >
            Report a problem
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'feedback'}
            className={`tab ${tab === 'feedback' ? 'is-active' : ''}`}
            onClick={() => { setTab('feedback'); setError(null) }}
          >
            Feedback &amp; requests
          </button>
        </div>

        <form className="form" onSubmit={submit} noValidate>
          {/* honeypot — visually hidden, never filled by a human */}
          <input
            type="text"
            name="website"
            className="visually-hidden"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            aria-hidden="true"
          />

          {tab === 'complaint' ? (
            <>
              <section className="field">
                <label className="label">What went wrong?</label>
                <Chips
                  name="Issue"
                  options={ISSUE_TYPES}
                  value={issueType}
                  onChange={setIssueType}
                />
              </section>

              <section className="field">
                <label className="label">When did it happen?</label>
                <Chips
                  name="When"
                  options={OCCURRED_WHEN}
                  value={occurredWhen}
                  onChange={setOccurredWhen}
                />
              </section>

              <section className="field">
                <label className="label">
                  Which product? <span className="optional">optional</span>
                </label>
                <Chips
                  name="Product"
                  options={PRODUCT_CATEGORIES}
                  value={productCategory}
                  onChange={setProductCategory}
                />
                <input
                  className="input"
                  type="text"
                  placeholder="Name the item (optional)"
                  maxLength={LIMITS.productText}
                  value={productText}
                  onChange={(e) => setProductText(e.target.value)}
                />
              </section>

              {isPaymentIssue && (
                <section className="field field-highlight">
                  <label className="label">
                    Payment details <span className="optional">helps us refund faster</span>
                  </label>
                  <div className="row">
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="1"
                      placeholder="Amount ₹"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <input
                      className="input"
                      type="text"
                      placeholder="UPI / txn ref"
                      maxLength={LIMITS.paymentRef}
                      value={paymentRef}
                      onChange={(e) => setPaymentRef(e.target.value)}
                    />
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={refundRequested}
                      onChange={(e) => setRefundRequested(e.target.checked)}
                    />
                    <span>I&apos;d like a refund</span>
                  </label>
                </section>
              )}
            </>
          ) : (
            <>
              <section className="field">
                <label className="label">How was your experience?</label>
                <div className="ratings" role="radiogroup" aria-label="Rating">
                  {RATINGS.map((r) => (
                    <button
                      type="button"
                      key={r.value}
                      className={`rating ${rating === r.value ? 'is-on' : ''}`}
                      onClick={() => setRating(r.value)}
                      aria-pressed={rating === r.value}
                      aria-label={r.label}
                    >
                      <span className="rating-emoji">{r.emoji}</span>
                      <span className="rating-label">{r.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="field">
                <label className="label">
                  What should we stock here? <span className="optional">pick any</span>
                </label>
                <Chips
                  name="Wanted categories"
                  options={PRODUCT_CATEGORIES}
                  value={wantedCategories}
                  onChange={setWantedCategories}
                  multi
                />
                <input
                  className="input"
                  type="text"
                  placeholder="Any specific brand or item?"
                  maxLength={LIMITS.wantedText}
                  value={wantedText}
                  onChange={(e) => setWantedText(e.target.value)}
                />
              </section>

              <section className="field">
                <label className="label">
                  Pricing feels… <span className="optional">optional</span>
                </label>
                <Chips
                  name="Price"
                  options={PRICE_FEEL}
                  value={priceFeel}
                  onChange={setPriceFeel}
                />
              </section>

              <section className="field">
                <label className="label">
                  How often do you use this Pod? <span className="optional">optional</span>
                </label>
                <Chips
                  name="Usage"
                  options={USAGE_FREQ}
                  value={usageFreq}
                  onChange={setUsageFreq}
                />
              </section>
            </>
          )}

          <section className="field">
            <label className="label" htmlFor="comment">
              Anything else? <span className="optional">optional</span>
            </label>
            <textarea
              id="comment"
              className="input textarea"
              rows={3}
              maxLength={LIMITS.comment}
              placeholder={
                tab === 'complaint'
                  ? 'Tell us what happened in a line or two…'
                  : 'Anything you want the team to know…'
              }
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="counter">{comment.length}/{LIMITS.comment}</div>
          </section>

          <section className="field">
            <label className="label">
              {tab === 'complaint' && refundRequested ? (
                <>How can we reach you? <span className="required">required for refund</span></>
              ) : (
                <>How can we reach you? <span className="optional">optional</span></>
              )}
            </label>
            <div className="row">
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Email"
                maxLength={LIMITS.email}
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
              <input
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="Phone"
                maxLength={LIMITS.phone}
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </div>

            {tab === 'feedback' && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={notifyOptIn}
                  onChange={(e) => setNotifyOptIn(e.target.checked)}
                />
                <span>Email me if you stock what I asked for</span>
              </label>
            )}

            <p className="fineprint">
              We only use this to follow up on your message. See our{' '}
              <a href="https://thefetch.in/privacy" target="_blank" rel="noreferrer">
                privacy policy
              </a>
              .
            </p>
          </section>

          {siteKey && (
            <Turnstile siteKey={siteKey} onToken={setTurnstileToken} />
          )}

          {error && <div className="error" role="alert">{error}</div>}

          <button type="submit" className="btn btn-primary" disabled={submitting || !pod}>
            {submitting ? 'Sending…' : tab === 'complaint' ? 'Send report' : 'Send feedback'}
          </button>
        </form>
      </div>

      <footer className="foot">
        <span>Fetch · AIUM Tech Private Limited</span>
      </footer>
    </main>
  )
}
