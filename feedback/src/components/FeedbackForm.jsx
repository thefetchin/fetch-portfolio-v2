import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

/**
 * One question per screen.
 *
 * Someone standing at a Pod will not scroll a long form, so the flow is a
 * wizard: single-choice questions auto-advance the moment they're tapped,
 * multi-choice and text steps get a Next button, and optional steps can be
 * skipped. A progress bar is pinned to the bottom.
 *
 * Feedback is the default path because that's what most people have to say;
 * reporting a problem is one tap away from the first screen.
 */

const FEEDBACK = 'feedback'
const COMPLAINT = 'complaint'

export default function FeedbackForm({ podId, podToken }) {
  const [pod, setPod] = useState(null)
  const [podError, setPodError] = useState(null)
  const [mode, setMode] = useState(FEEDBACK)
  const [stepIndex, setStepIndex] = useState(0)
  const [direction, setDirection] = useState(1) // 1 forward, -1 back
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const [turnstileToken, setTurnstileToken] = useState(null)
  const [siteKey, setSiteKey] = useState(null)

  const [honeypot, setHoneypot] = useState('')
  const mountedAt = useRef(Date.now())
  const advanceTimer = useRef(null)

  // answers
  const [rating, setRating] = useState(null)
  const [wantedCategories, setWantedCategories] = useState([])
  const [wantedText, setWantedText] = useState('')
  const [priceFeel, setPriceFeel] = useState(null)
  const [usageFreq, setUsageFreq] = useState(null)

  const [issueType, setIssueType] = useState(null)
  const [occurredWhen, setOccurredWhen] = useState(null)
  const [amount, setAmount] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [refundRequested, setRefundRequested] = useState(false)

  const [productCategory, setProductCategory] = useState(null)
  const [productText, setProductText] = useState('')
  const [comment, setComment] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [notifyOptIn, setNotifyOptIn] = useState(false)

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

    return () => { cancelled = true }
  }, [podId, podToken])

  const isPaymentIssue = PAYMENT_ISSUES.includes(issueType)

  /* ------------------------------------------------------------ steps -- */

  const steps = useMemo(() => {
    if (mode === FEEDBACK) {
      return [
        {
          key: 'rating',
          kicker: 'First things first',
          title: 'How was it?',
          type: 'rating',
          answered: rating != null,
        },
        {
          key: 'wanted',
          kicker: 'Your call',
          title: 'What should we stock here?',
          hint: 'Pick as many as you like.',
          type: 'multi',
          options: PRODUCT_CATEGORIES,
          value: wantedCategories,
          onChange: setWantedCategories,
          extra: {
            placeholder: 'Any particular brand or item?',
            value: wantedText,
            onChange: setWantedText,
            max: LIMITS.wantedText,
          },
          optional: true,
        },
        {
          key: 'price',
          kicker: 'Be honest',
          title: 'How do the prices feel?',
          type: 'single',
          options: PRICE_FEEL,
          value: priceFeel,
          onChange: setPriceFeel,
          optional: true,
        },
        {
          key: 'usage',
          kicker: 'Last one',
          title: 'How often do you use this Pod?',
          type: 'single',
          options: USAGE_FREQ,
          value: usageFreq,
          onChange: setUsageFreq,
          optional: true,
        },
        { key: 'wrap', kicker: 'Anything else?', title: 'Want to add something?', type: 'wrap' },
      ]
    }

    return [
      {
        key: 'issue',
        kicker: 'Sorry about this',
        title: 'What went wrong?',
        type: 'single',
        options: ISSUE_TYPES,
        value: issueType,
        onChange: setIssueType,
        answered: issueType != null,
      },
      {
        key: 'when',
        kicker: 'Timing',
        title: 'When did it happen?',
        type: 'single',
        options: OCCURRED_WHEN,
        value: occurredWhen,
        onChange: setOccurredWhen,
        answered: occurredWhen != null,
      },
      {
        key: 'product',
        kicker: 'Optional',
        title: 'Which product was it?',
        type: 'single',
        options: PRODUCT_CATEGORIES,
        value: productCategory,
        onChange: setProductCategory,
        extra: {
          placeholder: 'Name the item, if you remember',
          value: productText,
          onChange: setProductText,
          max: LIMITS.productText,
        },
        optional: true,
        stay: true, // don't auto-advance; they may want to type
      },
      ...(isPaymentIssue
        ? [{ key: 'payment', kicker: 'For your refund', title: 'What did you pay?', type: 'payment', optional: true }]
        : []),
      { key: 'wrap', kicker: 'Almost done', title: 'How can we reach you?', type: 'wrap' },
    ]
  }, [
    mode, rating, wantedCategories, wantedText, priceFeel, usageFreq,
    issueType, occurredWhen, productCategory, productText, isPaymentIssue,
  ])

  const step = steps[Math.min(stepIndex, steps.length - 1)]
  const isLast = stepIndex >= steps.length - 1
  // Count the step you're on, so the first screen already shows movement
  // instead of an empty bar that looks broken.
  const progress = ((stepIndex + 1) / steps.length) * 100

  const go = useCallback((delta) => {
    // Cancel a queued auto-advance. Without this, tapping an option and then
    // immediately tapping Next fires both and skips a whole question.
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current)
      advanceTimer.current = null
    }
    setError(null)
    setDirection(delta)
    setStepIndex((i) => Math.max(0, Math.min(i + delta, steps.length - 1)))
  }, [steps.length])

  // Never leave a timer running after unmount.
  useEffect(() => () => clearTimeout(advanceTimer.current), [])

  const switchMode = (next) => {
    setMode(next)
    setStepIndex(0)
    setDirection(1)
    setError(null)
  }

  /** Single-select taps feel best when they move you along automatically. */
  const pickSingle = (option, s) => {
    s.onChange(s.value === option.value ? null : option.value)
    if (!s.stay && s.value !== option.value) {
      clearTimeout(advanceTimer.current)
      advanceTimer.current = setTimeout(() => go(1), 180)
    }
  }

  const canContinue = () => {
    if (step.type === 'rating') return rating != null
    if (step.key === 'issue') return issueType != null
    if (step.key === 'when') return occurredWhen != null
    return true
  }

  /* ----------------------------------------------------------- submit -- */

  const submit = async () => {
    setError(null)
    if (mode === COMPLAINT) {
      if (!issueType) return setError('Please tell us what went wrong.')
      if (!occurredWhen) return setError('Please tell us when this happened.')
      if (refundRequested && !contactEmail.trim() && !contactPhone.trim()) {
        return setError('Add an email or phone number so we can send the refund.')
      }
    } else if (!rating) {
      return setError('Please tap a rating.')
    }
    if (notifyOptIn && !contactEmail.trim()) {
      return setError("Add your email if you'd like us to tell you when we stock it.")
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          podId, podToken, kind: mode, turnstileToken,
          website: honeypot,
          dwellMs: Date.now() - mountedAt.current,
          issueType, occurredWhen, amount: amount || null, paymentRef, refundRequested,
          rating, wantedCategories, wantedText, priceFeel, usageFreq, notifyOptIn,
          productCategory, productText, comment, contactEmail, contactPhone,
        }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.message || 'Something went wrong. Please try again.')
      else setDone(mode)
    } catch {
      setError('We could not reach the server. Please check your connection.')
    } finally {
      setSubmitting(false)
    }
  }

  /* ----------------------------------------------------------- states -- */

  if (podError) {
    return (
      <main className="fx">
        <div className="fx-card fx-msg">
          <div className="fx-msg-mark fx-msg-mark--warn">!</div>
          <h1>This link isn&apos;t valid</h1>
          <p>{podError}</p>
          <p className="fx-muted">
            Scan the code directly from the Pod, or email{' '}
            <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>.
          </p>
        </div>
      </main>
    )
  }

  if (done) {
    return (
      <main className="fx">
        <div className="fx-card fx-msg">
          <div className="fx-msg-mark fx-msg-mark--ok">✓</div>
          <h1>{done === COMPLAINT ? "We're on it" : 'Thank you!'}</h1>
          <p>
            {done === COMPLAINT
              ? refundRequested
                ? "Logged. If a refund is due we'll have it back to you within 7 business days."
                : 'Logged — the team will look into this Pod.'
              : 'This goes straight to the team who decides what this Pod stocks.'}
          </p>
          <button type="button" className="fx-btn fx-btn--ghost" onClick={() => window.location.reload()}>
            Send another
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="fx">
      <div className="fx-card">
        <header className="fx-head">
          <img src="/fetch-logo.svg" alt="Fetch" className="fx-logo" />
          <div className="fx-pod">
            {pod ? (
              <>
                <span className="fx-pod-dot" aria-hidden="true" />
                <span className="fx-pod-name">{pod.label}</span>
              </>
            ) : (
              <span className="fx-pod-skeleton" />
            )}
          </div>
        </header>

        <form
          className="fx-body"
          onSubmit={(e) => { e.preventDefault(); isLast ? submit() : go(1) }}
        >
          <input
            type="text" name="website" className="visually-hidden" tabIndex={-1}
            autoComplete="off" aria-hidden="true"
            value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
          />

          <div
            className={`fx-step ${direction > 0 ? 'from-right' : 'from-left'}`}
            key={`${mode}-${step.key}`}
          >
            <div className="fx-kicker">
              <span className="fx-step-no">{String(stepIndex + 1).padStart(2, '0')}</span>
              <span>{step.kicker}</span>
            </div>

            <h1 className="fx-question">{step.title}</h1>
            {step.hint && <p className="fx-hint">{step.hint}</p>}

            {/* ---------- rating ---------- */}
            {step.type === 'rating' && (
              <div className="fx-ratings" role="radiogroup" aria-label="Rating">
                {RATINGS.map((r) => (
                  <button
                    type="button" key={r.value}
                    className={`fx-rating ${rating === r.value ? 'is-on' : ''}`}
                    aria-pressed={rating === r.value}
                    onClick={() => {
                      setRating(r.value)
                      clearTimeout(advanceTimer.current)
                      advanceTimer.current = setTimeout(() => go(1), 220)
                    }}
                  >
                    <span className="fx-rating-face">{r.emoji}</span>
                    <span className="fx-rating-word">{r.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* ---------- single / multi choice ---------- */}
            {/* Long option lists go two-up so the step still fits one screen
                — the whole point of the wizard. */}
            {(step.type === 'single' || step.type === 'multi') && (
              <div
                className={`fx-options ${step.options.length > 5 ? 'is-grid' : ''}`}
                role="group"
              >
                {step.options.map((opt) => {
                  const on = step.type === 'multi'
                    ? step.value.includes(opt.value)
                    : step.value === opt.value
                  return (
                    <button
                      type="button" key={opt.value}
                      className={`fx-option ${on ? 'is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() =>
                        step.type === 'multi'
                          // Functional update: two quick taps on different
                          // options would otherwise both read the same stale
                          // array from this closure and one would be lost.
                          ? step.onChange((prev) =>
                              prev.includes(opt.value)
                                ? prev.filter((v) => v !== opt.value)
                                : [...prev, opt.value])
                          : pickSingle(opt, step)
                      }
                    >
                      <span className="fx-option-label">{opt.label}</span>
                      <span className="fx-option-mark" aria-hidden="true">{on ? '✓' : ''}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {step.extra && (
              <input
                className="fx-input"
                type="text"
                placeholder={step.extra.placeholder}
                maxLength={step.extra.max}
                value={step.extra.value}
                onChange={(e) => step.extra.onChange(e.target.value)}
              />
            )}

            {/* ---------- payment ---------- */}
            {step.type === 'payment' && (
              <div className="fx-stack">
                <input
                  className="fx-input" type="number" inputMode="decimal" min="1"
                  placeholder="Amount paid (₹)"
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                />
                <input
                  className="fx-input" type="text" placeholder="UPI / transaction reference"
                  maxLength={LIMITS.paymentRef}
                  value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)}
                />
                <label className="fx-check">
                  <input
                    type="checkbox" checked={refundRequested}
                    onChange={(e) => setRefundRequested(e.target.checked)}
                  />
                  <span>I&apos;d like a refund</span>
                </label>
              </div>
            )}

            {/* ---------- wrap-up ---------- */}
            {step.type === 'wrap' && (
              <div className="fx-stack">
                <textarea
                  className="fx-input fx-textarea" rows={3} maxLength={LIMITS.comment}
                  placeholder={mode === COMPLAINT
                    ? 'Tell us what happened…'
                    : 'Anything you want the team to know…'}
                  value={comment} onChange={(e) => setComment(e.target.value)}
                />
                <div className="fx-duo">
                  <input
                    className="fx-input" type="email" inputMode="email" autoComplete="email"
                    placeholder="Email" maxLength={LIMITS.email}
                    value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                  />
                  <input
                    className="fx-input" type="tel" inputMode="tel" autoComplete="tel"
                    placeholder="Phone" maxLength={LIMITS.phone}
                    value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                  />
                </div>
                {mode === FEEDBACK && (
                  <label className="fx-check">
                    <input
                      type="checkbox" checked={notifyOptIn}
                      onChange={(e) => setNotifyOptIn(e.target.checked)}
                    />
                    <span>Tell me when you stock what I asked for</span>
                  </label>
                )}
                <p className="fx-fine">
                  {mode === COMPLAINT && refundRequested
                    ? 'Needed so we can send your refund.'
                    : 'Optional — only used to reply to you.'}{' '}
                  <a href="https://thefetch.in/privacy" target="_blank" rel="noreferrer">Privacy</a>
                </p>
              </div>
            )}
          </div>

          {siteKey && <Turnstile siteKey={siteKey} onToken={setTurnstileToken} />}
          {error && <div className="fx-error" role="alert">{error}</div>}

          <div className="fx-actions">
            {stepIndex > 0 && (
              <button type="button" className="fx-btn fx-btn--ghost" onClick={() => go(-1)}>
                Back
              </button>
            )}
            <button
              type="submit"
              className="fx-btn fx-btn--go"
              disabled={submitting || !pod || !canContinue()}
            >
              {submitting
                ? 'Sending…'
                : isLast
                ? (mode === COMPLAINT ? 'Send report' : 'Send feedback')
                : step.optional && !canContinue()
                ? 'Skip'
                : 'Next'}
            </button>
          </div>
        </form>

        <div className="fx-progress" aria-hidden="true">
          <div className="fx-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="fx-switch">
        {mode === FEEDBACK ? (
          <button type="button" onClick={() => switchMode(COMPLAINT)}>
            Something went wrong? <strong>Report a problem</strong>
          </button>
        ) : (
          <button type="button" onClick={() => switchMode(FEEDBACK)}>
            Just want to give feedback? <strong>Switch back</strong>
          </button>
        )}
      </div>
    </main>
  )
}
