import { useCallback, useEffect, useState } from 'react'
import './Questions.css'

/**
 * The questions each machine type asks.
 *
 * These used to be a constants file and a deploy. They are rows now, so a
 * coffee machine can ask about strength while a snack Pod asks what to stock.
 *
 * Three things are deliberately absent, because they are behaviour rather than
 * wording: the rating, the payment block that appears for payment-type issues,
 * and the closing step with the comment and WhatsApp opt-in. An editor that
 * could delete those could break a refund or a consent record.
 */

const TYPES = [
  { value: 'single', label: 'Pick one' },
  { value: 'multi', label: 'Pick any' },
  { value: 'text', label: 'Free text' },
  { value: 'item_grid', label: 'Rate each one' },
]

const blank = (setId) => ({
  setId, title: '', kicker: '', hint: '', type: 'single',
  options: [{ value: '', label: '' }],
  extraPlaceholder: '', optional: true, position: 50, mapsTo: null,
  scale: [{ value: '', label: '' }],
})

/**
 * The option rows, used twice: once for what they pick, once for the scale they
 * rate it on. Kept as one list so flavours can be added without anyone going
 * near the wording of the scale, and the other way round.
 *
 * `locked` is on once the question has been saved: the stored value is what
 * every answer already given is filed under, so renaming it would orphan them.
 * It applies per ROW, not to the list -- a row added just now has no answers
 * behind it, and locking it would leave it with an empty stored value, which
 * the server drops. That is how adding a flavour to a saved question would
 * silently do nothing.
 */
function OptionRows({ label, hint, rows, locked, onChange, addLabel }) {
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="qz-field">
      <span>{label}</span>
      {hint && <em className="qz-hint">{hint}</em>}
      {rows.map((o, i) => {
        const rowLocked = locked && !o.isNew
        return (
        <div key={i} className="qz-opt">
          <input
            value={o.label} placeholder="What they see" maxLength={80}
            onChange={(e) => set(i, {
              label: e.target.value,
              value: rowLocked ? o.value
                : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40),
            })}
          />
          <input
            className="qz-val" value={o.value} placeholder="stored as" maxLength={40}
            readOnly={rowLocked}
            title={rowLocked
              ? 'Fixed once saved — answers already given reference it'
              : 'What gets stored'}
            onChange={(e) => set(i, { value: e.target.value })}
          />
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      )})}
      <button
        type="button" className="qz-addopt"
        onClick={() => onChange([...rows, { value: '', label: '', isNew: true }])}
      >{addLabel}</button>
    </div>
  )
}

export default function Questions() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  const [setId, setSetId] = useState('snacks_feedback')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/questions', { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not load the questions.')
      setData(d)
    } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy(true); setError(null)
    try {
      const isNew = !editing.question_id
      const r = await fetch(
        isNew ? '/api/admin/questions' : `/api/admin/questions/${editing.question_id}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(editing),
        }
      )
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not save it.')
      setEditing(null)
      setNotice(isNew ? 'Question added.' : 'Question saved.')
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const remove = async (q) => {
    if (!window.confirm(`Remove "${q.title}"?`)) return
    try {
      const r = await fetch(`/api/admin/questions/${q.question_id}`, {
        method: 'DELETE', credentials: 'include',
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not remove it.')
      setNotice(d.message || 'Removed.')
      load()
    } catch (e) { setError(e.message) }
  }

  if (!data) return <p className="qz-empty">Loading…</p>

  const sets = data.sets || []
  const mine = (data.questions || []).filter((q) => q.set_id === setId)
  const current = sets.find((s) => s.set_id === setId)

  return (
    <section className="qz">
      {error && <div className="qz-error" role="alert">{error}</div>}
      {notice && <div className="qz-notice" role="status">{notice}</div>}

      <div className="qz-head">
        <div>
          <h2>Questions</h2>
          <p className="qz-sub">
            What each machine asks when someone scans its QR. The rating, the
            payment details for a refund, and the closing comment are always
            asked and are not listed here — they carry logic rather than wording.
          </p>
        </div>
      </div>

      <div className="qz-sets">
        {sets.map((s) => (
          <button
            key={s.set_id} type="button"
            className={`qz-set ${setId === s.set_id ? 'is-active' : ''}`}
            onClick={() => { setSetId(s.set_id); setEditing(null) }}
          >
            {s.machine_type === 'coffee' ? '☕' : '🍫'}{' '}
            {s.machine_type === 'coffee' ? 'Coffee' : 'Snacks'} ·{' '}
            {s.kind === 'feedback' ? 'Feedback' : 'Problem report'}
          </button>
        ))}
      </div>

      {!mine.length && <p className="qz-empty">This set asks nothing extra yet.</p>}

      <ol className="qz-list">
        {mine.map((q) => (
          <li key={q.question_id} className={q.active ? '' : 'is-off'}>
            <div className="qz-q">
              <div className="qz-title">
                {q.title}
                {!q.optional && <span className="qz-req">required</span>}
                {!q.active && <span className="qz-req qz-hidden">hidden</span>}
              </div>
              <div className="qz-meta">
                {TYPES.find((t) => t.value === q.type)?.label}
                {q.options?.length
                  ? ` · ${q.options.length} ${q.type === 'item_grid' ? 'items' : 'options'}`
                  : ''}
                {q.type === 'item_grid' && q.scale?.length ? ` · ${q.scale.length}-point scale` : ''}
                {q.maps_to ? ` · saved as ${q.maps_to}` : ''}
              </div>
              {!!q.options?.length && (
                <div className="qz-opts">{q.options.map((o) => o.label).join(' · ')}</div>
              )}
            </div>
            <div className="qz-actions">
              <button type="button" onClick={() => setEditing({
                ...q, mapsTo: q.maps_to, extraPlaceholder: q.extra_placeholder,
                optional: !!q.optional, active: !!q.active, scale: q.scale || [],
              })}>Edit</button>
              <button type="button" onClick={() => remove(q)}>Remove</button>
            </div>
          </li>
        ))}
      </ol>

      {!editing && (
        <button type="button" className="qz-add" onClick={() => setEditing(blank(setId))}>
          Add a question to {current?.machine_type === 'coffee' ? 'coffee' : 'snacks'} ·{' '}
          {current?.kind === 'feedback' ? 'feedback' : 'problem reports'}
        </button>
      )}

      {editing && (
        <div className="qz-form">
          <h3>{editing.question_id ? 'Edit question' : 'New question'}</h3>

          <label className="qz-field">
            <span>Question</span>
            <input
              value={editing.title} maxLength={120}
              placeholder="How was the strength?"
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
          </label>

          <div className="qz-row">
            <label className="qz-field">
              <span>Small line above it</span>
              <input
                value={editing.kicker || ''} maxLength={60} placeholder="The important bit"
                onChange={(e) => setEditing({ ...editing, kicker: e.target.value })}
              />
            </label>
            <label className="qz-field">
              <span>Answer style</span>
              <select
                value={editing.type}
                onChange={(e) => setEditing({ ...editing, type: e.target.value })}
              >
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>

          {editing.type !== 'text' && (
            <OptionRows
              label={editing.type === 'item_grid' ? 'What they pick' : 'Options'}
              hint={editing.type === 'item_grid'
                ? 'One row per drink on the form, each with the buttons below beside it. Adding a flavour here leaves the scale alone.'
                : null}
              rows={editing.options || []}
              locked={!!editing.question_id}
              onChange={(options) => setEditing({ ...editing, options })}
              addLabel={editing.type === 'item_grid' ? 'Add a drink' : 'Add an option'}
            />
          )}

          {editing.type === 'item_grid' && (
            <OptionRows
              label="How they rate it"
              hint="The buttons beside every row, worst to best. The form adds a Didn't try button of its own, so there is no need for one here."
              rows={editing.scale || []}
              locked={!!editing.question_id}
              onChange={(scale) => setEditing({ ...editing, scale })}
              addLabel="Add a point to the scale"
            />
          )}

          <div className="qz-row">
            <label className="qz-field">
              <span>Text box under it, if any</span>
              <input
                value={editing.extraPlaceholder || ''} maxLength={80}
                placeholder="Any particular brand or item?"
                onChange={(e) => setEditing({ ...editing, extraPlaceholder: e.target.value })}
              />
            </label>
            <label className="qz-field">
              <span>Order</span>
              <input
                type="number" value={editing.position ?? 50}
                onChange={(e) => setEditing({ ...editing, position: Number(e.target.value) })}
              />
            </label>
          </div>

          <label className="qz-check">
            <input
              type="checkbox" checked={editing.optional === false}
              onChange={(e) => setEditing({ ...editing, optional: !e.target.checked })}
            />
            <span>They must answer this before continuing</span>
          </label>

          <div className="qz-actions">
            <button type="button" className="qz-save" onClick={save} disabled={busy || !editing.title.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}
