import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
/* The option lists that used to live here are rows now -- the server tells
   each machine what to ask. Only RATINGS stays, because the rating scale is
   behaviour: it is the one answer every report has and the one the dashboard
   averages. */
import { RATINGS, LIMITS, WA_CONSENT_TEXT } from '../../shared/constants.js'
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

  /* Answers live in one object keyed by question, because the questions are
     now rows in the database and a machine type can have any number of them.
     A useState per question stopped being possible the moment coffee machines
     asked different ones. */
  const [answers, setAnswers] = useState({})
  const [questions, setQuestions] = useState({ feedback: [], complaint: [] })

  /* Rows they have explicitly marked "didn't try". Deliberately NOT part of
     `answers`: to the server, and to anyone counting later, it is the same as
     leaving the row alone. It exists only so the button looks tapped when they
     tap it -- showing it as chosen by default made an untouched row read as
     answered. */
  const [skipped, setSkipped] = useState({})
  const markSkipped = (key, on) => setSkipped((s) => ({ ...s, [key]: on }))

  /* Takes a value or an updater. The updater form matters where two taps can
     land in the same tick -- both would otherwise read the same stale array
     from a closure and one tap would be lost. `fallback` is the empty answer,
     since only the caller knows whether that is [] or null. */
  const setAnswer = (key, value, fallback = null) =>
    setAnswers((a) => ({
      ...a,
      [key]: typeof value === 'function' ? value(a[key] ?? fallback) : value,
    }))

  const [amount, setAmount] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [refundRequested, setRefundRequested] = useState(false)

  const [comment, setComment] = useState('')
  // One contact field, and it is the WhatsApp number. The +91 is fixed in the
  // markup rather than sitting in this value, so it cannot be half-deleted and
  // cannot be typed twice -- the state holds ten digits or nothing.
  const [contactPhone, setContactPhone] = useState('')
  const [whatsappOptIn, setWhatsappOptIn] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/pod/${encodeURIComponent(podId)}?t=${encodeURIComponent(podToken)}`)
      .then(async (res) => {
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) setPodError(data.message || 'This link is not valid.')
        else {
          setPod(data.pod)
          // The server says what to ask. A new machine type is rows, not a deploy.
          setQuestions(data.questions || { feedback: [], complaint: [] })
        }
      })
      .catch(() => !cancelled && setPodError('We could not reach the server.'))

    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => !cancelled && setSiteKey(d.turnstileSiteKey))
      .catch(() => {})

    return () => { cancelled = true }
  }, [podId, podToken])

  /* Whether to ask for an amount follows the option they picked, which carries
     the flag, rather than a hardcoded list the form could disagree with. */
  const isPaymentIssue = (questions.complaint || []).some((q) => {
    if (q.mapsTo !== 'issue_type') return false
    return q.options?.find((o) => o.value === answers[q.key])?.payment === true
  })

  /* ------------------------------------------------------------ steps -- */

  /**
   * The steps are built from whatever the server said this machine asks.
   *
   * Only three things are still hardcoded, because they are behaviour rather
   * than wording: the rating, the payment block that appears for payment-type
   * issues, and the closing step with the comment and the WhatsApp opt-in. An
   * editor that could delete those could break a refund or a consent record.
   */
  const steps = useMemo(() => {
    const asked = (questions[mode] || []).map((q) => ({
      key: q.key,
      kicker: q.kicker,
      title: q.title,
      hint: q.hint,
      type: q.type,
      options: q.options,
      scale: q.scale || [],
      value: answers[q.key] ?? (q.type === 'multi' ? [] : null),
      onChange: (v) => setAnswer(q.key, v, q.type === 'multi' ? [] : null),
      optional: q.optional,
      answered: q.type === 'multi'
        ? (answers[q.key] || []).length > 0
        // A grid is answered once any one row is: nobody has tried every
        // drink, and insisting on it would be a questionnaire, not a question.
        : q.type === 'item_grid'
          ? Object.keys(answers[q.key] || {}).length > 0
          : answers[q.key] != null,
      ...(q.extraPlaceholder ? {
        extra: {
          placeholder: q.extraPlaceholder,
          value: answers[`${q.key}__extra`] || '',
          onChange: (v) => setAnswer(`${q.key}__extra`, v),
          max: 200,
        },
        // Don't auto-advance past a question with a text box under it; they
        // may still be typing.
        stay: true,
      } : {}),
    }))

    if (mode === FEEDBACK) {
      return [
        {
          key: 'rating',
          kicker: 'First things first',
          title: 'How was it?',
          type: 'rating',
          answered: rating != null,
        },
        ...asked,
        { key: 'wrap', kicker: 'Anything else?', title: 'Want to add something?', type: 'wrap' },
      ]
    }

    return [
      ...asked,
      ...(isPaymentIssue
        ? [{ key: 'payment', kicker: 'For your refund', title: 'What did you pay?', type: 'payment', optional: true }]
        : []),
      { key: 'wrap', kicker: 'Almost done', title: 'How can we reach you?', type: 'wrap' },
    ]
  }, [mode, questions, answers, rating, isPaymentIssue])

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

  /**
   * Indian mobile numbers are ten digits starting 6-9. The field only ever
   * accepts digits, so this is the whole check -- and it runs before the
   * request rather than after it, because being told on the next screen that
   * a number was wrong is the point at which people give up.
   */
  const phoneEntered = contactPhone.length > 0
  const phoneValid = /^[6-9]\d{9}$/.test(contactPhone)

  /* A required question blocks Next. Which questions are required is now a
     column, so this asks the step rather than naming keys it cannot know. */
  const canContinue = () => {
    if (step.type === 'rating') return rating != null
    if (step.optional === false) return step.answered === true
    return true
  }

  /* ----------------------------------------------------------- submit -- */

  const submit = async () => {
    setError(null)
    if (mode === COMPLAINT) {
      const missing = (questions.complaint || [])
        .find((q) => !q.optional && answers[q.key] == null)
      if (missing) return setError(`${missing.title} — please answer this.`)
      if (refundRequested && !phoneEntered) {
        return setError('Add your WhatsApp number so we can send the refund.')
      }
    } else if (!rating) {
      return setError('Please tap a rating.')
    }
    if (whatsappOptIn && !phoneEntered) {
      return setError('Add your WhatsApp number so we can tell you when this Pod is refilled.')
    }
    // The field already carries the detail inline, so this says what to DO
    // rather than repeating the same sentence a second time on one screen.
    if (phoneEntered && !phoneValid) {
      return setError('Check your WhatsApp number before sending.')
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
          amount: amount || null, paymentRef, refundRequested,
          rating, whatsappOptIn: pod.refillOptIn !== false && whatsappOptIn,
          // Keyed by question, because the questions are data now.
          answers,
          comment, contactPhone,
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

            {/* ---------- a row per item, rated on one scale ---------- */}
            {/* Every drink is listed with the same buttons beside it, so
                someone who has had three can rate three without hunting for
                them. Nothing is chosen to begin with: a row they never touch
                is a drink they did not have, which is what "Didn't try" says
                anyway. The button is there to say it out loud, or to undo a
                mis-tap -- not a state the form assumes on their behalf. */}
            {step.type === 'item_grid' && (
              <div className="fx-grid" role="group">
                {step.options.map((opt) => {
                  const chosen = step.value?.[opt.value] || null
                  const skipKey = `${step.key}:${opt.value}`
                  const skipOn = !chosen && !!skipped[skipKey]
                  return (
                    <div key={opt.value} className={`fx-grid-row ${chosen ? 'is-done' : ''}`}>
                      <span className="fx-grid-name">{opt.label}</span>
                      <div className="fx-grid-scale">
                        {step.scale.map((lv) => {
                          const on = chosen === lv.value
                          return (
                            <button
                              type="button" key={lv.value}
                              className={`fx-grid-btn ${on ? 'is-on' : ''}`}
                              aria-pressed={on}
                              aria-label={`${opt.label}: ${lv.label}`}
                              onClick={() => {
                                if (skipped[skipKey]) markSkipped(skipKey, false)
                                step.onChange((prev) => ({
                                  ...(prev || {}),
                                  [opt.value]: lv.value,
                                }))
                              }}
                            >{lv.label}</button>
                          )
                        })}
                        <button
                          type="button"
                          className={`fx-grid-btn ${skipOn ? 'is-on' : ''}`}
                          aria-pressed={skipOn}
                          aria-label={`${opt.label}: didn't try`}
                          onClick={() => {
                            markSkipped(skipKey, !skipOn)
                            step.onChange((prev) => {
                              const next = { ...(prev || {}) }
                              delete next[opt.value]
                              return next
                            })
                          }}
                        >Didn't try</button>
                      </div>
                    </div>
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
                {/*
                  The +91 is a fixed label, not part of the value. A prefilled
                  "+91 " gets half-deleted, or typed a second time by someone
                  who always writes their number in full; neither is possible
                  when the country code is not editable and the box holds ten
                  digits and nothing else.

                  inputMode="numeric" rather than "tel": the telephone keypad
                  carries *, # and pauses, none of which belong in a value that
                  is about to be checked against ten digits.
                */}
                <div className={`fx-phone ${phoneEntered && !phoneValid ? 'is-bad' : ''}`}>
                  <span className="fx-phone-cc" aria-hidden="true">+91</span>
                  <input
                    className="fx-phone-input" type="tel" inputMode="numeric"
                    pattern="[0-9]*" autoComplete="tel-national"
                    aria-label="WhatsApp number"
                    aria-invalid={phoneEntered && !phoneValid}
                    placeholder="WhatsApp number" maxLength={10}
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  />
                </div>
                {phoneEntered && !phoneValid && (
                  <p className="fx-fine fx-fine--bad" role="alert">
                    That needs to be 10 digits, starting 6 to 9.
                  </p>
                )}
                {/* Offered per machine. A Pod refilled on a fixed round has
                    nothing worth announcing, and asking anyway would collect
                    consent for a message nobody ever sends. The number box
                    stays either way -- it is how we reply to them. */}
                {pod.refillOptIn !== false && (
                  <label className="fx-check">
                    <input
                      type="checkbox" checked={whatsappOptIn}
                      onChange={(e) => setWhatsappOptIn(e.target.checked)}
                    />
                    <span>{WA_CONSENT_TEXT}</span>
                  </label>
                )}
                {whatsappOptIn && (
                  /*
                    Do not promise "reply STOP" here until something actually
                    reads inbound messages. Nothing does yet, so the honest
                    version is the address people can already reach us at.
                    Whoever builds the sending side should honour STOP and
                    then this line can say so.
                  */
                  <p className="fx-fine">
                    Only used to tell you when this Pod is refilled. Email{' '}
                    <a href="mailto:thefetch.in@gmail.com">thefetch.in@gmail.com</a>{' '}
                    any time to come off the list.
                  </p>
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
