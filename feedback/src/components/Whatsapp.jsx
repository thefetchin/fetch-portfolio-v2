import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WHATSAPP_STATUSES } from '../../shared/constants.js'
import './Whatsapp.css'

/**
 * WhatsApp refill notifications — the list of who to message when a Pod is
 * filled, and the consent behind each number.
 *
 * Nothing here sends a message. This is the list and the evidence; sending is
 * a separate decision made with a separate tool, and keeping the two apart is
 * what stops "export the numbers" quietly becoming "message the numbers".
 */

const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

/** 919876543210 -> +91 98765 43210 */
const fmtNumber = (n) =>
  /^91\d{10}$/.test(n) ? `+91 ${n.slice(2, 7)} ${n.slice(7)}` : `+${n}`

const STATUS_LABELS = {
  active: 'Subscribed',
  unsubscribed: 'Opted out',
  invalid: 'Bad number',
}

const VARIABLE_FIELDS = [
  { value: 'pod_label', label: 'Pod display name' },
  { value: 'pod_location', label: 'Pod location' },
  { value: 'pod_city', label: 'Pod city' },
]

/**
 * A short, friendly body to register with Meta.
 *
 * One emoji, not one per item: a line of them reads as a promotion nobody
 * asked for, and these people asked. {{1}} is a POSITIONAL parameter -- Meta's
 * editor also offers named ones, and the sender here fills positions in order.
 */
const SUGGESTED_BODY =
  '\u{1F389} Good news \u2014 the Fetch Pod at {{1}} has just been restocked.\n\n'
  + 'Fresh snacks, chocolates and chilled drinks are waiting for you.\n\n'
  + 'Pop by whenever you fancy something.'

/**
 * Message settings.
 *
 * WhatsApp does not let a business send arbitrary text. Every message here is
 * one we start, so Meta requires an APPROVED TEMPLATE -- free text is only
 * allowed inside a 24-hour window a customer opens by writing to us first.
 *
 * So what is configurable here is which template and what goes in its
 * variables. The sentence itself lives at Meta. A box that let you type a
 * message and press send would fail on every attempt, and the error would look
 * like our bug.
 */
function Settings({ onError, onNotice }) {
  const [s, setS] = useState(null)
  const [tpl, setTpl] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/whatsapp/settings', { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not load the settings.')
      setS(d.settings)
      // What Meta says the template expects, so a mismatch is visible here
      // rather than arriving later as a 132012 that names nothing.
      const t = await fetch('/api/admin/whatsapp/template', { credentials: 'include' })
      setTpl(await t.json())
    } catch (e) { onError(e.message) }
  }, [onError])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/whatsapp/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(s),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not save.')
      setS(d.settings)
      onNotice('Message settings saved.')
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }

  if (!s) return null

  const toggleVar = (v) => setS({
    ...s,
    variables: s.variables.includes(v)
      ? s.variables.filter((x) => x !== v)
      : [...s.variables, v],
  })

  return (
    <details className="wa-settings" open={!s.templateName}>
      <summary>Message settings</summary>

      {!s.configured && (
        <div className="wa-error" role="alert">
          WhatsApp is not connected. Set <code>WHATSAPP_TOKEN</code> and{' '}
          <code>WHATSAPP_PHONE_ID</code> as Worker secrets, then reload.
        </div>
      )}

      <p className="wa-sub">
        WhatsApp only lets a business send a message it started if the wording
        has been approved by Meta in advance. So the sentence lives in a
        template registered at Meta, and what you choose here is which template
        to use and what to put in its blanks.
      </p>

      <label className="wa-field">
        <span>Template name</span>
        <input
          value={s.templateName}
          placeholder="fetch_pod_refilled"
          onChange={(e) => setS({ ...s, templateName: e.target.value })}
        />
        <em>Exactly as registered at Meta — lowercase, digits and underscores.</em>
      </label>

      <label className="wa-field">
        <span>Language</span>
        <input
          value={s.languageCode}
          placeholder="en_US"
          onChange={(e) => setS({ ...s, languageCode: e.target.value })}
        />
        <em>The language code on the approved template, e.g. en_US or en_GB.</em>
      </label>

      <fieldset className="wa-field">
        <legend>What fills the blanks</legend>
        <em>
          Tick in the order the template uses them: the first ticked fills
          &#123;&#123;1&#125;&#125;, the second &#123;&#123;2&#125;&#125;.
        </em>
        {VARIABLE_FIELDS.map((f) => (
          <label key={f.value} className="wa-check">
            <input
              type="checkbox"
              checked={s.variables.includes(f.value)}
              onChange={() => toggleVar(f.value)}
            />
            <span>
              {f.label}
              {s.variables.includes(f.value)
                && ` — fills {{${s.variables.indexOf(f.value) + 1}}}`}
            </span>
          </label>
        ))}
      </fieldset>

      {tpl?.found && (
        <div className={`wa-tplcheck ${tpl.matches ? 'is-ok' : 'is-bad'}`}>
          <strong>
            {tpl.matches
              ? 'This matches the approved template.'
              : 'This does not match the approved template.'}
          </strong>
          <p className="wa-fine">
            Meta says <code>{tpl.name}</code> ({tpl.language}, {tpl.category}) expects{' '}
            {tpl.wants.headerFormat === 'NONE' ? 'no header' : `a ${tpl.wants.headerFormat} header`}
            {' and '}{tpl.wants.bodyVariables} body variable{tpl.wants.bodyVariables === 1 ? '' : 's'}.
          </p>
          {tpl.problems?.map((p) => <p key={p} className="wa-fine">{p}</p>)}
        </div>
      )}

      <label className="wa-field">
        <span>Header</span>
        <select
          value={s.headerFormat || 'NONE'}
          onChange={(e) => setS({ ...s, headerFormat: e.target.value })}
        >
          <option value="NONE">No header</option>
          <option value="IMAGE">Image</option>
          <option value="VIDEO">Video</option>
          <option value="DOCUMENT">Document</option>
        </select>
        <em>
          Adding an image to the template at Meta adds a header, and every send
          then has to supply the file. Leave as &ldquo;No header&rdquo; unless the
          template has one.
        </em>
      </label>

      {s.headerFormat && s.headerFormat !== 'NONE' && (
        <label className="wa-field">
          <span>Header file URL</span>
          <input
            value={s.headerMediaUrl || ''}
            placeholder="https://thefetch.in/og-image.png"
            onChange={(e) => setS({ ...s, headerMediaUrl: e.target.value })}
          />
          <em>
            WhatsApp fetches this itself when the message is sent, so it must be
            a public https URL — not behind a login.
          </em>
        </label>
      )}

      <label className="wa-field">
        <span>Approved wording, for reference</span>
        <textarea
          rows={6} value={s.bodyPreview}
          placeholder={SUGGESTED_BODY}
          onChange={(e) => setS({ ...s, bodyPreview: e.target.value })}
        />
        <em>
          A copy of what you registered at Meta, shown here so the panel can
          display what is about to go out. Editing it changes nothing at Meta.
        </em>
      </label>

      <button
        type="button" className="abtn"
        onClick={() => setS({ ...s, bodyPreview: SUGGESTED_BODY, variables: ['pod_label'] })}
      >
        Use the suggested wording
      </button>

      <label className="wa-check wa-enable">
        <input
          type="checkbox" checked={s.enabled}
          onChange={(e) => setS({ ...s, enabled: e.target.checked })}
        />
        <span>Sending is on</span>
      </label>

      <div className="wa-actions">
        <button type="button" className="abtn" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {s.updatedAt && (
        <p className="wa-fine">Last changed {s.updatedAt}{s.updatedBy ? ` by ${s.updatedBy}` : ''}.</p>
      )}
    </details>
  )
}

/**
 * Managing the pre-typed replies.
 *
 * Editable here rather than hardcoded so the wording can be fixed by whoever
 * is answering, at the moment they notice it is wrong -- which is the only
 * moment anybody ever notices.
 */
function CannedManager({ onError, onChanged }) {
  const [list, setList] = useState([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/whatsapp/canned', { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not load the replies.')
      setList(d.canned || [])
    } catch (e) { onError(e.message) }
  }, [onError])

  useEffect(() => { load() }, [load])

  const add = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/whatsapp/canned', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, body }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not save it.')
      setTitle(''); setBody('')
      await load()
      onChanged?.()
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }

  const remove = async (id, name) => {
    if (!window.confirm(`Remove "${name}"?`)) return
    try {
      const r = await fetch(`/api/admin/whatsapp/canned/${id}`, {
        method: 'DELETE', credentials: 'include',
      })
      if (!r.ok) throw new Error((await r.json()).message || 'Could not remove it.')
      await load()
      onChanged?.()
    } catch (e) { onError(e.message) }
  }

  return (
    <details className="wa-settings">
      <summary>Pre-typed replies ({list.length})</summary>

      <p className="wa-sub">
        Shown as buttons above the reply box. Choosing one puts the text in the
        box for you to adjust — it is never sent on its own. These are ordinary
        replies, so they only work inside the 24-hour window.
      </p>

      {!!list.length && (
        <ul className="wa-canned-list">
          {list.map((c) => (
            <li key={c.canned_id}>
              <div>
                <strong>{c.title}</strong>
                <p className="wa-canned-body">{c.body}</p>
              </div>
              <button
                type="button" className="abtn abtn--quiet"
                onClick={() => remove(c.canned_id, c.title)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="wa-field">
        <span>Name</span>
        <input
          value={title} maxLength={60} placeholder="Refund guidelines"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="wa-field">
        <span>Message</span>
        <textarea
          rows={4} maxLength={1000} value={body}
          placeholder="What should go in the reply box…"
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <button
        type="button" className="abtn"
        onClick={add} disabled={busy || !title.trim() || !body.trim()}
      >
        {busy ? 'Saving…' : 'Add reply'}
      </button>
    </details>
  )
}

/**
 * WhatsApp conversations.
 *
 * The 24-hour rule governs everything here: a reply may be ordinary text only
 * within 24 hours of the customer's last message, and after that only an
 * approved template will send. The composer is disabled with the reason on
 * screen rather than letting someone type a paragraph and watch it fail --
 * the failure would arrive as Meta's error 131047 and look like our bug.
 */
function Chats({ onError, cannedVersion }) {
  const [chats, setChats] = useState(null)
  const [active, setActive] = useState(null)
  const [thread, setThread] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  /*
    `silent` is for the background poll. A refresh the user did not ask for must
    not raise an error banner -- one dropped request would otherwise paint a red
    "Failed to fetch" over a working screen every five seconds, and a flaky
    connection would make the panel look broken when nothing is.
  */
  const loadChats = useCallback(async (silent) => {
    try {
      const r = await fetch('/api/admin/whatsapp/chats', { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not load conversations.')
      setChats(d.chats || [])
    } catch (e) { if (!silent) onError(e.message) }
  }, [onError])

  const loadThread = useCallback(async (num, silent) => {
    if (!num) return
    try {
      const r = await fetch(`/api/admin/whatsapp/chats/${num}`, { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not load that conversation.')
      setThread(d)
    } catch (e) { if (!silent) onError(e.message) }
  }, [onError])

  const [canned, setCanned] = useState([])

  const loadCanned = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/whatsapp/canned', { credentials: 'include' })
      const d = await r.json()
      if (r.ok) setCanned(d.canned || [])
    } catch { /* the composer still works without them */ }
  }, [])

  useEffect(() => { loadChats() }, [loadChats])
  useEffect(() => { loadThread(active) }, [active, loadThread])
  useEffect(() => { loadCanned() }, [loadCanned, cannedVersion])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [thread])

  /*
    Live updates by polling.
    
    A WebSocket would need a Durable Object: a Worker request cannot push to a
    socket opened by a different request, so the webhook that receives a
    customer message has no route to this browser without one. For a panel with
    a handful of users, five seconds of latency is indistinguishable and costs
    no architecture.

    Polling stops while the tab is hidden -- otherwise a forgotten tab quietly
    burns requests all weekend.
  */
  useEffect(() => {
    let stop = false
    const tick = async () => {
      if (stop || document.visibilityState !== 'visible') return
      await loadChats(true)
      if (active) await loadThread(active, true)
    }
    const id = setInterval(tick, 5000)
    document.addEventListener('visibilitychange', tick)
    return () => { stop = true; clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [active, loadChats, loadThread])

  const send = async () => {
    const body = draft.trim()
    if (!body || !active) return
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/whatsapp/chats/${active}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not send.')
      setDraft('')
      await loadThread(active)
      await loadChats()
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }

  const list = chats || []

  return (
    <details className="wa-settings" open>
      <summary>Chats{list.some((c) => c.open_count > 0) ? ' — replies waiting' : ''}</summary>

      {!list.length && (
        <p className="wa-fine">
          No conversations yet. They appear as soon as a customer messages
          +91 90195 26185.
        </p>
      )}

      {!!list.length && (
        <div className="wa-chat">
          <ul className="wa-chat-list">
            {list.map((c) => (
              <li key={c.wa_number}>
                <button
                  type="button"
                  className={`wa-chat-item ${active === c.wa_number ? 'is-active' : ''}`}
                  onClick={() => setActive(c.wa_number)}
                >
                  <span className="wa-chat-who">
                    {c.profile_name || fmtNumber(c.wa_number)}
                    {c.open_count > 0 && <em className="wa-dot" aria-label="needs a reply" />}
                  </span>
                  <span className="wa-chat-last">{c.last_body || '(no text)'}</span>
                  <span className="wa-fine">
                    {fmtDate(c.last_inbound_at)}
                    {c.windowOpen ? ` · ${c.hoursLeft}h left to reply` : ' · window closed'}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="wa-chat-thread">
            {!active && <p className="wa-fine">Pick a conversation.</p>}

            {active && thread && (
              <>
                <div className="wa-bubbles">
                  {thread.messages.map((m) => (
                    <div key={m.id} className={`wa-bubble is-${m.direction} ${m.kind === 'template' ? 'is-tpl' : ''}`}>
                      <div className="wa-bubble-body">{m.body || `(${m.kind})`}</div>
                      <div className="wa-bubble-meta">
                        {fmtDate(m.at)}
                        {m.direction === 'out' && m.status === 'failed' && ' · failed'}
                        {m.direction === 'out' && m.delivery_status && ` · ${m.delivery_status}`}
                        {m.error ? ` · ${m.error}` : ''}
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>

                {thread.windowOpen ? (
                  <div className="wa-composer">
                    <textarea
                      rows={2} maxLength={1000} value={draft}
                      placeholder={`Reply to ${fmtNumber(active)}…`}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
                      }}
                    />
                    {!!canned.length && (
                      <div className="wa-canned">
                        {canned.map((c) => (
                          <button
                            key={c.canned_id} type="button" className="wa-chip"
                            title={c.body}
                            /* Inserted, not sent. The person still reads it and
                               presses Send, so it can be adjusted to what was
                               actually asked. */
                            onClick={() => setDraft((d) => (d ? `${d}\n\n${c.body}` : c.body))}
                          >
                            {c.title}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="wa-composer-actions">
                      <span className="wa-fine">
                        {thread.hoursLeft}h left · ⌘↵ to send
                      </span>
                      <button
                        type="button" className="abtn"
                        onClick={send} disabled={busy || !draft.trim()}
                      >
                        {busy ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="wa-composer is-closed">
                    <strong>The 24-hour reply window has closed.</strong>
                    <p className="wa-fine">
                      WhatsApp only allows a typed reply within 24 hours of a
                      customer&apos;s message. Reaching them now needs an approved
                      template, which is sent from Pods &amp; QR codes.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </details>
  )
}

/**
 * Messages customers have sent us.
 *
 * The 24-hour flag is the operational fact: inside it you may reply with
 * ordinary text, outside it only an approved template will send. Somebody
 * typing a friendly reply on hour 25 and watching it fail is exactly the
 * confusion this is here to prevent.
 */
function Inbox({ onError }) {
  const [data, setData] = useState(null)
  const [openOnly, setOpenOnly] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/whatsapp/inbox?${openOnly ? 'open=1' : ''}`,
        { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not load the inbox.')
      setData(d)
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }, [openOnly, onError])

  useEffect(() => { load() }, [load])

  const mark = async (id, handled) => {
    try {
      await fetch(`/api/admin/whatsapp/inbox/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handled }),
      })
      load()
    } catch (e) { onError(e.message) }
  }

  const items = data?.inbound || []
  const st = data?.stats

  return (
    <details className="wa-settings" open={!!st?.open}>
      <summary>Inbox{st?.open ? ` — ${st.open} waiting` : ''}</summary>

      <div className="wa-filters">
        <label className="wa-check">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          <span>Only what needs a reply</span>
        </label>
        <button type="button" className="abtn" onClick={load} disabled={busy}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {!items.length && !busy && (
        <p className="wa-fine">
          Nothing yet. Customer messages appear here once the webhook is
          connected and subscribed to <code>messages</code>.
        </p>
      )}

      {!!items.length && (
        <div className="wa-table-wrap">
          <table className="wa-table">
            <thead>
              <tr><th>When</th><th>From</th><th>Message</th><th>Reply window</th><th /></tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.message_id} className={m.handled_at ? 'is-off' : ''}>
                  <td className="wa-nowrap">{fmtDate(m.received_at)}</td>
                  <td>
                    <a href={`https://wa.me/${m.wa_number}`} target="_blank" rel="noreferrer">
                      {fmtNumber(m.wa_number)}
                    </a>
                    {m.profile_name && <div className="wa-fine">{m.profile_name}</div>}
                  </td>
                  <td>
                    {m.body || <span className="wa-fine">({m.type}, no text)</span>}
                  </td>
                  <td>
                    <span className={`wa-badge wa-badge--${m.windowOpen ? 'active' : 'unsubscribed'}`}>
                      {m.windowOpen ? 'Open — free text' : 'Closed — template only'}
                    </span>
                  </td>
                  <td className="wa-nowrap">
                    <button
                      type="button" className="abtn abtn--quiet"
                      onClick={() => mark(m.message_id, !m.handled_at)}
                    >
                      {m.handled_at ? 'Reopen' : 'Done'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="wa-fine">
        Replies are sent from WhatsApp itself, not from here. A reply within 24
        hours of a customer&apos;s message can be ordinary text; after that only an
        approved template will send.
      </p>
    </details>
  )
}

/**
 * What number we are actually sending from.
 *
 * The commonest reason a message is accepted and never arrives is that the
 * sender is one of Meta's TEST numbers, which can only reach a short
 * allow-list configured in their dashboard. Nothing in the send response hints
 * at it, so this asks Meta directly.
 */
function Connection({ onError }) {
  const [c, setC] = useState(null)
  const [busy, setBusy] = useState(false)

  const [waba, setWaba] = useState(null)

  const check = useCallback(async () => {
    setBusy(true)
    try {
      const [s, w] = await Promise.all([
        fetch('/api/admin/whatsapp/status', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/admin/whatsapp/waba', { credentials: 'include' }).then((r) => r.json()),
      ])
      setC(s)
      setWaba(w)
    } catch {
      // Mount-time check. If it cannot be reached the panel below still works,
      // and Re-check gives a deliberate retry.
    } finally { setBusy(false) }
  }, [])

  /* Binds the WhatsApp account to our app. Without it no message or status
     reaches the webhook, however correct the callback URL is -- and there is
     no error anywhere to say so. */
  const connect = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/whatsapp/waba/subscribe', {
        method: 'POST', credentials: 'include',
      })
      const d = await r.json()
      if (!r.ok) throw new Error([d.message, d.hint].filter(Boolean).join(' '))
      await check()
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }

  useEffect(() => { check() }, [check])

  if (!c) return null

  return (
    <div className={`wa-conn ${c.ok ? '' : 'is-bad'}`}>
      <div className="wa-conn-head">
        <strong>
          {!c.configured ? 'WhatsApp not connected'
            : c.ok ? `Sending from ${c.phoneNumber || 'an unknown number'}`
            : 'WhatsApp connection problem'}
        </strong>
        <button type="button" className="abtn" onClick={check} disabled={busy}>
          {busy ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {!c.ok && <p className="wa-fine">{c.message}</p>}
      {c.tokenExpired && (
        <p className="wa-fine">
          The access token has expired. A short-lived token lasts 24 hours — use a
          System User token for something that runs unattended.
        </p>
      )}

      {c.ok && (
        <p className="wa-fine">
          {c.verifiedName ? `${c.verifiedName} · ` : ''}
          {c.qualityRating ? `quality ${c.qualityRating} · ` : ''}
          {c.throughput ? `throughput ${c.throughput}` : ''}
        </p>
      )}

      {c.ok && c.nameStatus && c.nameStatus !== 'APPROVED' && (
        <p className="wa-fine">
          Display name status is <strong>{c.nameStatus}</strong>, not APPROVED.
        </p>
      )}

      {/*
        Being connected to the app is separate from the callback URL being
        right, and it is the part with no error message of its own: unsubscribed
        means messages and statuses simply never arrive.
      */}
      {waba && waba.configured && (
        waba.ok && waba.count > 0 ? (
          <p className="wa-fine">
            Receiving is on — this account routes to{' '}
            {waba.subscribedApps.map((a) => a.name || a.id).join(', ') || 'this app'}.
          </p>
        ) : (
          <div className="wa-waba-warn">
            <strong>
              {waba.ok
                ? 'This WhatsApp account is not connected to the app.'
                : 'Could not check whether the account is connected.'}
            </strong>
            <p className="wa-fine">
              {waba.ok
                ? 'Messages from customers and delivery statuses will not reach us '
                  + 'until it is, no matter how the callback URL is set.'
                : waba.message}
            </p>
            <button type="button" className="abtn" onClick={connect} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect this account'}
            </button>
          </div>
        )
      )}
    </div>
  )
}

/**
 * What actually happened to a message.
 *
 * "Accepted" is the honest word for a message Meta took but never reported on
 * again -- which is every message until a delivery webhook is connected.
 * Calling that "Sent" implies an arrival nobody has confirmed.
 */
function deliveryLabel(r) {
  if (r.status !== 'sent') return r.status === 'failed' ? 'Rejected' : 'Skipped'
  switch (r.delivery_status) {
    case 'read': return 'Read'
    case 'delivered': return 'Delivered'
    case 'failed': return 'Not delivered'
    case 'sent': return 'Sent to handset'
    default: return 'Accepted'
  }
}

function deliveryTone(r) {
  if (r.status !== 'sent') return 'invalid'
  if (r.delivery_status === 'failed') return 'invalid'
  if (r.delivery_status === 'delivered' || r.delivery_status === 'read') return 'active'
  return 'unsubscribed'   // accepted but unconfirmed: grey, not green
}

/**
 * The send log.
 *
 * Failures show Meta's own wording, not ours. That text is the whole
 * diagnostic: "(#132001) Template name does not exist in the translation"
 * says the template name is fine and the LANGUAGE is wrong, which is not
 * something a generic "send failed" would ever have revealed.
 */
function SendLog({ onError }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      const r = await fetch(`/api/admin/whatsapp/sends?${qs}`, { credentials: 'include' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || 'Could not load the send log.')
      setData(d)
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }, [status, onError])

  useEffect(() => { load() }, [load])

  const sends = data?.sends || []
  const st = data?.stats

  return (
    <details className="wa-settings" open>
      <summary>Send log</summary>

      {st && (
        <div className="wa-stats">
          <div className="wa-stat"><span>{st.delivered ?? 0}</span><label>Delivered</label></div>
          <div className={`wa-stat ${st.unknown ? 'is-unknown' : ''}`}>
            <span>{st.unknown ?? 0}</span><label>Accepted, not confirmed</label>
          </div>
          <div className="wa-stat"><span>{(st.failed ?? 0) + (st.undelivered ?? 0)}</span><label>Failed</label></div>
          <div className="wa-stat"><span>{st.people ?? 0}</span><label>People</label></div>
        </div>
      )}

      <div className="wa-filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Everything</option>
          <option value="sent">Delivered to Meta</option>
          <option value="failed">Failed</option>
        </select>
        <button type="button" className="abtn" onClick={load} disabled={busy}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {!sends.length && !busy && (
        <p className="wa-fine">
          Nothing sent yet. Use <strong>Notify</strong> on a Pod in Pods &amp; QR codes.
        </p>
      )}

      {!!sends.length && (
        <div className="wa-table-wrap">
          <table className="wa-table">
            <thead>
              <tr>
                <th>When</th><th>Pod</th><th>To</th><th>Status</th><th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((r) => (
                <tr key={r.send_id} className={r.status === 'sent' ? '' : 'is-off'}>
                  <td className="wa-nowrap">{fmtDate(r.created_at)}</td>
                  <td>
                    <div>{r.pod_label || r.pod_id}</div>
                    <div className="wa-fine">{r.template}</div>
                  </td>
                  <td className="wa-nowrap">{fmtNumber(r.wa_number)}</td>
                  <td>
                    {/*
                      Two different facts, deliberately not merged. The send
                      status is whether Meta ACCEPTED the message; the delivery
                      status is what happened to it afterwards, and only a
                      webhook can tell us that. Showing acceptance alone as
                      "Sent" is what made a message that never arrived look
                      like a success.
                    */}
                    <span className={`wa-badge wa-badge--${deliveryTone(r)}`}>
                      {deliveryLabel(r)}
                    </span>
                  </td>
                  <td>
                    {r.error || r.delivery_error
                      ? <span className="wa-err">{r.error || r.delivery_error}</span>
                      : <span className="wa-fine wa-msgid">{r.wa_message_id || '—'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="wa-fine">
        {st?.unknown
          ? <><strong>Accepted</strong> means WhatsApp took the message but has not
            told us what became of it. Connect the delivery webhook and these
            become Delivered, Read or Not delivered.</>
          : <>Delivery is reported by Meta&apos;s webhook. &ldquo;Read&rdquo; only
            appears if the recipient has read receipts on.</>}
      </p>
    </details>
  )
}

export default function Whatsapp() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [cannedVersion, setCannedVersion] = useState(0)
  const [pod, setPod] = useState('')
  const [status, setStatus] = useState('active')

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (pod) qs.set('pod', pod)
      if (status) qs.set('status', status)
      const res = await fetch(`/api/admin/whatsapp?${qs}`, { credentials: 'include' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || 'Could not load the list.')
      setData(body)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [pod, status])

  useEffect(() => { load() }, [load])

  const rows = data?.optins || []
  const stats = data?.stats

  const pods = useMemo(() => {
    const seen = new Map()
    for (const r of rows) if (!seen.has(r.pod_id)) seen.set(r.pod_id, r.pod_label || r.pod_id)
    return [...seen.entries()]
  }, [rows])

  const setRowStatus = async (optinId, next) => {
    setError(null)
    try {
      const res = await fetch(`/api/admin/whatsapp/${optinId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || 'Could not update that row.')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  /**
   * CSV of the CURRENT filter, consent columns included.
   *
   * The consent date and wording travel with the number deliberately: a bare
   * column of phone numbers in a spreadsheet is the format in which consent
   * gets forgotten.
   */
  const exportCsv = () => {
    const head = [
      'whatsapp_number', 'pod_id', 'pod_label', 'pod_location', 'status',
      'consented_at', 'reconfirmed_at', 'unsubscribed_at', 'consent_text',
      'source', 'last_sent_at', 'send_count',
    ]
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [head.join(',')]
    for (const r of rows) {
      lines.push([
        r.wa_number, r.pod_id, r.pod_label, r.pod_location, r.status,
        r.consented_at, r.reconfirmed_at, r.unsubscribed_at, r.consent_text,
        r.source, r.last_sent_at, r.send_count,
      ].map(esc).join(','))
    }
    const url = URL.createObjectURL(
      new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `whatsapp-optins-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="wa">
      <div className="wa-head">
        <div>
          <h2>WhatsApp refill notifications</h2>
          <p className="wa-sub">
            People who asked to be told when a Pod is refilled. Each row records
            the number, the Pod, and the exact wording they agreed to.
            Nothing here sends a message.
          </p>
        </div>
        <div className="wa-actions">
          <button type="button" className="abtn" onClick={load} disabled={busy}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" className="abtn" onClick={exportCsv} disabled={!rows.length}>
            Export CSV
          </button>
        </div>
      </div>

      {error && <div className="wa-error" role="alert">{error}</div>}

      <Connection onError={setError} />
      <Chats onError={setError} cannedVersion={cannedVersion} />
      <CannedManager onError={setError} onChanged={() => setCannedVersion((v) => v + 1)} />
      <Inbox onError={setError} />
      <Settings onError={setError} onNotice={(m) => { setError(null); setNotice(m) }} />
      <SendLog onError={setError} />
      {notice && <div className="wa-notice" role="status">{notice}</div>}

      {stats && (
        <div className="wa-stats">
          <div className="wa-stat"><span>{stats.active ?? 0}</span><label>Subscribed</label></div>
          <div className="wa-stat"><span>{stats.people ?? 0}</span><label>People</label></div>
          <div className="wa-stat"><span>{stats.pods_covered ?? 0}</span><label>Pods covered</label></div>
          <div className="wa-stat"><span>{stats.unsubscribed ?? 0}</span><label>Opted out</label></div>
        </div>
      )}

      <div className="wa-filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {WHATSAPP_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select value={pod} onChange={(e) => setPod(e.target.value)}>
          <option value="">All Pods</option>
          {pods.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>

      {!rows.length && !busy && (
        <div className="wa-empty">
          <p>No one has opted in yet.</p>
          <p className="wa-fine">
            The checkbox sits at the end of the feedback form on
            feedback.thefetch.in, on both the feedback and the problem-report
            paths.
          </p>
        </div>
      )}

      {!!rows.length && (
        <div className="wa-table-wrap">
          <table className="wa-table">
            <thead>
              <tr>
                <th>WhatsApp</th>
                <th>Pod</th>
                <th>Consented</th>
                <th>Status</th>
                <th>Sent</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.optin_id} className={r.status === 'active' ? '' : 'is-off'}>
                  <td>
                    <a href={`https://wa.me/${r.wa_number}`} target="_blank" rel="noreferrer">
                      {fmtNumber(r.wa_number)}
                    </a>
                    {r.display_name && <div className="wa-fine">{r.display_name}</div>}
                  </td>
                  <td>
                    <div>{r.pod_label || r.pod_id}</div>
                    {r.pod_location && <div className="wa-fine">{r.pod_location}</div>}
                  </td>
                  <td>
                    <div>{fmtDate(r.consented_at)}</div>
                    {r.reconfirmed_at && (
                      <div className="wa-fine">re-confirmed {fmtDate(r.reconfirmed_at)}</div>
                    )}
                    <div className="wa-fine wa-consent" title={r.consent_text}>
                      “{r.consent_text}”
                    </div>
                  </td>
                  <td>
                    <span className={`wa-badge wa-badge--${r.status}`}>
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                    {r.unsubscribed_at && (
                      <div className="wa-fine">{fmtDate(r.unsubscribed_at)}</div>
                    )}
                  </td>
                  <td>
                    {r.send_count || 0}
                    {r.last_sent_at && <div className="wa-fine">{fmtDate(r.last_sent_at)}</div>}
                  </td>
                  <td className="wa-row-actions">
                    {/*
                      Opting someone out is always available. Opting them back
                      IN is not: an opt-out may only be reversed by that person
                      ticking the box again on the form. A re-subscribe button
                      here is the single change that would turn this consent
                      ledger into an ordinary marketing list.

                      'invalid' is different -- it is our note that a number
                      failed to deliver, not their decision -- so clearing it
                      is allowed.
                    */}
                    {r.status === 'active' && (
                      <button
                        type="button" className="abtn abtn--quiet"
                        onClick={() => setRowStatus(r.optin_id, 'unsubscribed')}
                      >
                        Opt out
                      </button>
                    )}
                    {r.status === 'invalid' && (
                      <button
                        type="button" className="abtn abtn--quiet"
                        onClick={() => setRowStatus(r.optin_id, 'active')}
                      >
                        Number is fine
                      </button>
                    )}
                    {r.status === 'unsubscribed' && (
                      <span className="wa-fine">They must re-opt-in themselves</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
