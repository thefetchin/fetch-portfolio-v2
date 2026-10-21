import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './invApi.js'
import { printPlanogram, groupRows } from './planogramPrint.js'
import './Planogram.css'

/**
 * What each slot in a machine is meant to hold.
 *
 * Separate from the slot map synced out of VLite, which says what a machine
 * HAS. This is what it SHOULD have, and the gap between the two is the thing a
 * refiller is being asked to close — so the editor shows both and never lets
 * one overwrite the other.
 *
 * Each slot keeps an ordered list rather than one product. The first is what we
 * want there; the rest are what to load when it is not on the van, in the order
 * we would pick them. Nobody standing at a machine can ring up and ask.
 */

const PAGES = [
  { value: 'A4 landscape', label: 'A4 landscape' },
  { value: 'A4 portrait', label: 'A4 portrait' },
  { value: 'A3 landscape', label: 'A3 landscape' },
  { value: 'Letter landscape', label: 'US Letter landscape' },
]

const rupees = (paise) => (paise == null ? '' : `₹${(paise / 100).toLocaleString('en-IN')}`)

/**
 * A product picture, or a space that says there isn't one.
 *
 * A URL that 404s is treated the same as no URL at all: an empty bordered box
 * reads as "this picture is still loading" forever, and the refiller sheet is
 * the one place where that matters. VLite drops images from time to time, so
 * this is a normal state, not an error worth reporting.
 */
function Thumb({ product, size = 'sm' }) {
  const [broken, setBroken] = useState(false)
  const key = product?.imageUrl || ''
  useEffect(() => { setBroken(false) }, [key])

  if (!product) return <div className={`pg-thumb pg-thumb--${size} is-empty`} aria-hidden="true" />

  return product.imageUrl && !broken
    ? (
      <img
        className={`pg-thumb pg-thumb--${size}`}
        src={product.imageUrl} alt="" loading="lazy"
        onError={() => setBroken(true)}
      />
    )
    : (
      <div
        className={`pg-thumb pg-thumb--${size} is-none`}
        title={broken ? 'That picture would not load from VLite' : 'No picture in VLite'}
      >
        <span>no pic</span>
      </div>
    )
}

export default function Planogram({ pods, products, run, say, oops, busy, loadRefs }) {
  const [podId, setPodId] = useState('')
  const [plan, setPlan] = useState(null)       // { pod, slots: [...] }
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState(null)  // slotName being edited
  const [search, setSearch] = useState('')
  const [page, setPage] = useState('A4 landscape')
  const [build, setBuild] = useState({ rows: 6, columns: 8, style: 'letter' })
  const searchRef = useRef(null)

  const byId = useMemo(
    () => Object.fromEntries((products || []).map((p) => [p.id, p])),
    [products]
  )

  /* `oops` is rebuilt by the parent on every one of ITS renders -- showing a
     notice is enough to do it -- so depending on it here would give `load` a
     new identity each time, re-run the effect below, and refetch the plan.
     That silently threw away unsaved edits: build a grid, see the "15 slots
     added" notice, and the grid was gone before you could read it. The ref
     keeps the current function without making the loader unstable. */
  const oopsRef = useRef(oops)
  oopsRef.current = oops

  const load = useCallback(async (id) => {
    if (!id) { setPlan(null); return }
    try {
      setPlan(await api(`/api/inv/planogram/${encodeURIComponent(id)}`))
      setDirty(false)
      setSelected(null)
    } catch (e) { oopsRef.current(e) }
  }, [])

  // Only when the machine changes. Reloading for any other reason would
  // discard whatever is being edited.
  useEffect(() => { load(podId) }, [podId, load])

  /* Opening a slot clears the previous search and puts the cursor in the box.
     Carrying the last slot's search across looks like a filtered list nobody
     asked for -- and the first thing anyone does here is type a product. */
  useEffect(() => {
    if (!selected) return
    setSearch('')
    searchRef.current?.focus()
  }, [selected])

  const slots = plan?.slots || []
  const rows = useMemo(() => groupRows(slots), [slots])
  const current = slots.find((s) => s.slotName === selected) || null

  /* ------------------------------------------------------------ editing -- */

  const patchSlot = (slotName, patch) => {
    setPlan((p) => ({
      ...p,
      slots: p.slots.map((s) => (s.slotName === slotName ? { ...s, ...patch } : s)),
    }))
    setDirty(true)
  }

  const addChoice = (slotName, productId) => {
    const product = byId[productId]
    if (!product) return
    const slot = slots.find((s) => s.slotName === slotName)
    if (!slot || slot.choices.some((c) => c.productId === productId)) return
    patchSlot(slotName, {
      choices: [...slot.choices, {
        rank: slot.choices.length + 1,
        productId,
        name: product.name,
        sku: product.sku,
        mrpPaise: product.mrpPaise,
        imageUrl: product.imageUrl,
        active: product.active,
      }],
    })
  }

  /* Ranks are rebuilt from the order of the list rather than edited directly:
     a gap or a repeat in them would make "second choice" mean nothing on the
     printed sheet, and the server renumbers anyway. */
  const reorder = (slotName, from, to) => {
    const slot = slots.find((s) => s.slotName === slotName)
    if (!slot || to < 0 || to >= slot.choices.length) return
    const next = [...slot.choices]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    patchSlot(slotName, { choices: next.map((c, i) => ({ ...c, rank: i + 1 })) })
  }

  const removeChoice = (slotName, idx) => {
    const slot = slots.find((s) => s.slotName === slotName)
    if (!slot) return
    patchSlot(slotName, {
      choices: slot.choices.filter((_, i) => i !== idx).map((c, i) => ({ ...c, rank: i + 1 })),
    })
  }

  const addSlot = () => {
    const name = window.prompt('Slot name, as printed on the machine (e.g. A1)')
    const slotName = (name || '').trim().slice(0, 20)
    if (!slotName) return
    if (slots.some((s) => s.slotName === slotName)) { say(`Slot ${slotName} already exists.`); return }
    setPlan((p) => ({
      ...p,
      slots: [...p.slots, {
        slotName, rowNumber: null, columnNumber: null,
        capacity: null, note: '', choices: [], actual: null,
      }],
    }))
    setDirty(true)
    setSelected(slotName)
  }

  /**
   * Builds a grid for a machine we have no layout for.
   *
   * Two naming styles because both are painted on real machines: A1..A8 with a
   * letter per row, and 11..18 where the first digit is the row. Getting this
   * wrong means a refiller reading "C4" off the sheet and looking for it on a
   * machine that says "34".
   */
  const buildGrid = () => {
    const rows = Math.min(26, Math.max(1, Number(build.rows) || 0))
    const columns = Math.min(20, Math.max(1, Number(build.columns) || 0))
    const name = (r, c) => (build.style === 'letter'
      ? `${String.fromCharCode(64 + r)}${c}`
      : `${r}${String(c).padStart(2, '0')}`)

    const made = []
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= columns; c++) {
        made.push({
          slotName: name(r, c), rowNumber: r, columnNumber: c,
          capacity: null, note: '', choices: [], actual: null,
        })
      }
    }

    // Anything already planned is kept: this is for filling an empty machine,
    // not for wiping one somebody has started.
    const have = new Set(slots.map((s) => s.slotName))
    const added = made.filter((s) => !have.has(s.slotName))
    if (!added.length) { say('Those slots already exist.'); return }

    setPlan((p) => ({ ...p, slots: [...p.slots, ...added] }))
    setDirty(true)
    say(`${added.length} slot(s) added. Nothing is stored until you save.`)
  }

  const removeSlot = (slotName) => {
    if (!window.confirm(`Remove slot ${slotName} from the plan?`)) return
    setPlan((p) => ({ ...p, slots: p.slots.filter((s) => s.slotName !== slotName) }))
    setSelected(null)
    setDirty(true)
  }

  /* -------------------------------------------------------------- calls -- */

  const save = () => run(async () => {
    const r = await api(`/api/inv/planogram/${encodeURIComponent(podId)}`, {
      method: 'PUT',
      body: {
        slots: slots.map((s) => ({
          slotName: s.slotName,
          rowNumber: s.rowNumber,
          columnNumber: s.columnNumber,
          capacity: s.capacity,
          note: s.note,
          choices: s.choices.map((c) => ({ productId: c.productId })),
        })),
      },
    })
    say(`Plan saved — ${r.slots} slots, ${r.choices} products.`)
    setDirty(false)
    load(podId)
  })

  const pull = () => run(async () => {
    const r = await api(`/api/inv/planogram/${encodeURIComponent(podId)}/pull`, { method: 'POST' })
    say(
      `${r.slots} slot(s) read from VLite`
      + (r.seeded ? `, ${r.seeded} first choice(s) filled in from what the machine holds.` : '.')
      + ' Nothing you had already chosen was changed.'
    )
    load(podId)
  })

  /**
   * Brings the whole VLite catalogue across, then the pictures.
   *
   * Orchestrated here rather than in a new endpoint: importing and linking
   * products is already a careful piece of server code that fills blanks
   * without overwriting anything a manager corrected by hand, and a second
   * copy of that reasoning would be the thing that quietly disagrees with it.
   * This just hands it every product instead of a chosen few.
   */
  const pullProducts = () => run(async () => {
    const cat = await api('/api/inv/vlite/products')
    const missing = (cat.items || [])
      .filter((i) => i.status !== 'linked')
      .map((i) => i.vliteProductId)

    let created = 0
    let linked = 0
    // The import caps a batch at 500, which is also about as much as one
    // request should carry on the free plan's CPU budget.
    for (let i = 0; i < missing.length; i += 200) {
      const r = await api('/api/inv/vlite/products/import', {
        method: 'POST',
        body: { vliteProductIds: missing.slice(i, i + 200) },
      })
      created += r.created?.length ?? 0
      linked += r.linked?.length ?? 0
    }

    const img = await api('/api/inv/product-images/sync', { method: 'POST' })

    say(
      `${cat.summary?.total ?? 0} products in VLite`
      + (created ? `, ${created} added here` : '')
      + (linked ? `, ${linked} matched to existing ones` : '')
      + (!created && !linked ? ', all of them already here' : '')
      + `. ${img.updated} picture(s) refreshed.`
    )
    await loadRefs()
  })

  /* ---------------------------------------------------------------- UI -- */

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    const live = (products || []).filter((p) => p.active)
    if (!q) return live.slice(0, 40)
    return live
      .filter((p) =>
        p.name.toLowerCase().includes(q)
        || (p.sku || '').toLowerCase().includes(q)
        || (p.barcode || '').includes(q))
      .slice(0, 40)
  }, [products, search])

  const planned = slots.filter((s) => s.choices.length).length
  const withAlts = slots.filter((s) => s.choices.length > 1).length
  const noImage = slots.filter((s) => s.choices[0] && !s.choices[0].imageUrl).length

  return (
    <div className="pg">
      <div className="pg-bar">
        <label className="pg-pick">
          <span>Machine</span>
          <select value={podId} onChange={(e) => setPodId(e.target.value)}>
            <option value="">— choose a machine —</option>
            {(pods || []).map((p) => (
              <option key={p.podId} value={p.podId}>
                {p.label} · {p.podId}
              </option>
            ))}
          </select>
        </label>

        {plan && (
          <>
            {/* Only offered while there is no layout. Once a machine's grid is
                in our database it does not change -- the shelves are physical
                -- so a button to re-read it would be a button whose only
                effect is to re-type what is already there. */}
            {!slots.length && plan.pod.vliteMachineId && (
              <button type="button" className="inv-ghost" onClick={pull} disabled={busy}>
                Read layout from VLite
              </button>
            )}
            <button type="button" className="inv-ghost" onClick={pullProducts} disabled={busy}>
              Pull products from VLite
            </button>
            <label className="pg-pick pg-pick--sm">
              <span>Print size</span>
              <select value={page} onChange={(e) => setPage(e.target.value)}>
                {PAGES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <button
              type="button" className="inv-ghost"
              onClick={() => printPlanogram({ pod: plan.pod, slots, page })}
              disabled={!slots.length}
              title={dirty ? 'Unsaved changes are included in the printout' : ''}
            >
              Print / PDF
            </button>
            <button type="button" className="pg-save" onClick={save} disabled={busy || !dirty}>
              {dirty ? 'Save plan' : 'Saved'}
            </button>
          </>
        )}
      </div>

      {!plan && (
        <p className="inv-empty">
          Choose a machine to plan its slots. Read the layout from VLite first and
          the rows, columns and capacities come across; everything after that is
          yours to decide.
        </p>
      )}

      {plan && !slots.length && (
        <div className="pg-build">
          <h3>This machine has no layout yet</h3>
          <p className="pg-build-sub">
            {plan.pod.vliteMachineId
              ? 'Read it from VLite, or lay it out yourself — a machine VLite does not describe properly is quicker to type than to argue with.'
              : 'This machine is not linked to VLite, so lay it out as it is in front of you.'}
          </p>
          <div className="pg-build-row">
            <label className="pg-field">
              <span>Rows</span>
              <input
                type="number" min="1" max="26" value={build.rows}
                onChange={(e) => setBuild({ ...build, rows: e.target.value })}
              />
            </label>
            <label className="pg-field">
              <span>Slots per row</span>
              <input
                type="number" min="1" max="20" value={build.columns}
                onChange={(e) => setBuild({ ...build, columns: e.target.value })}
              />
            </label>
            <label className="pg-field pg-field--wide">
              <span>Named like</span>
              <select
                value={build.style}
                onChange={(e) => setBuild({ ...build, style: e.target.value })}
              >
                <option value="letter">A1, A2 … B1, B2 (letter per row)</option>
                <option value="number">101, 102 … 201, 202 (row then slot)</option>
              </select>
            </label>
            <button type="button" className="pg-save" onClick={buildGrid}>
              Build {Math.max(0, Number(build.rows) || 0) * Math.max(0, Number(build.columns) || 0)} slots
            </button>
          </div>
          <p className="pg-build-note">
            Use whatever is printed on the machine itself. Slots can be renamed,
            added and removed afterwards, and nothing is stored until you save.
          </p>
        </div>
      )}

      {plan && !!slots.length && (
        <>
          <div className="pg-stats">
            <div className="inv-stat"><span>{slots.length}</span><label>Slots</label></div>
            <div className="inv-stat"><span>{planned}</span><label>Planned</label></div>
            <div className={`inv-stat ${withAlts < planned ? 'inv-stat-warn' : ''}`}>
              <span>{withAlts}</span><label>With a fallback</label>
            </div>
            <div className={`inv-stat ${noImage ? 'inv-stat-warn' : ''}`}>
              <span>{noImage}</span><label>No picture</label>
            </div>
          </div>

          <div className="pg-grid">
            {rows.map((r) => (
              <div key={r.rowNumber ?? 'loose'} className="pg-row">
                <div className="pg-rowhead">
                  {r.rowNumber == null ? 'No row' : `Row ${r.rowNumber}`}
                </div>
                <div className="pg-cells">
                  {r.cells.map((s) => {
                    const first = s.choices[0]
                    // The machine is holding something the plan does not name:
                    // worth seeing at a glance, because it is usually the plan
                    // that is out of date, not the machine.
                    const mismatch = s.actual?.productId
                      && first && s.actual.productId !== first.productId
                    return (
                      <button
                        type="button"
                        key={s.slotName}
                        className={`pg-cell ${selected === s.slotName ? 'is-on' : ''} ${first ? '' : 'is-empty'}`}
                        onClick={() => setSelected(s.slotName === selected ? null : s.slotName)}
                      >
                        <div className="pg-cell-top">
                          <span className="pg-slot">{s.slotName}</span>
                          {s.capacity != null && <span className="pg-cap">×{s.capacity}</span>}
                        </div>
                        <Thumb product={first} />
                        <div className="pg-cell-name">{first ? first.name : 'Empty'}</div>
                        {s.choices.length > 1 && (
                          <div className="pg-cell-alts">+{s.choices.length - 1} fallback</div>
                        )}
                        {mismatch && (
                          <div className="pg-cell-flag" title={`Machine currently holds ${s.actual.productName}`}>
                            differs from machine
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <button type="button" className="pg-addslot" onClick={addSlot}>Add a slot</button>
        </>
      )}

      {/* ------------------------------------------------------ the slot -- */}
      {current && (
        <div className="pg-editor">
          <div className="pg-editor-head">
            <h3>Slot {current.slotName}</h3>
            <div className="pg-editor-actions">
              <button type="button" onClick={() => removeSlot(current.slotName)}>Remove slot</button>
              <button type="button" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>

          {current.actual && (
            <p className="pg-actual">
              The machine currently holds{' '}
              <strong>{current.actual.productName || 'nothing we recognise'}</strong>
              {current.actual.stockLimit != null ? ` · holds ${current.actual.stockLimit}` : ''}
              {current.actual.enabled ? '' : ' · slot disabled in VLite'}
            </p>
          )}

          <div className="pg-picker">
            {/* Focused on opening: clicking a slot is almost always the
                first half of "put something in this slot", so the cursor is
                already where the next keystroke was going. */}
            <input
              ref={searchRef}
              className="pg-search" value={search} placeholder={`Search products for slot ${current.slotName}…`}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="pg-results">
              {matches.map((p) => {
                const already = current.choices.some((c) => c.productId === p.id)
                return (
                  <button
                    key={p.id} type="button"
                    className={`pg-result ${already ? 'is-in' : ''}`}
                    disabled={already}
                    onClick={() => addChoice(current.slotName, p.id)}
                  >
                    <Thumb product={p} />
                    <span className="pg-result-name">{p.name}</span>
                    <span className="pg-result-meta">{already ? 'added' : rupees(p.mrpPaise)}</span>
                  </button>
                )
              })}
              {!matches.length && <p className="inv-empty">Nothing matches that.</p>}
            </div>
          </div>

          <div className="pg-choices">
            <div className="pg-choices-head">
              In order of preference — the first is what we want there, the rest
              are what to load when it is not on the van.
            </div>
            {!current.choices.length && (
              <p className="inv-empty">Nothing chosen yet. This slot prints as “leave empty”.</p>
            )}
            {current.choices.map((c, i) => (
              <div key={c.productId} className={`pg-choice ${c.active === false ? 'is-off' : ''}`}>
                <span className="pg-rank">{i + 1}</span>
                <Thumb product={c} />
                <div className="pg-choice-main">
                  <div className="pg-choice-name">{c.name}</div>
                  <div className="pg-choice-meta">
                    {c.sku}{c.mrpPaise != null ? ` · ${rupees(c.mrpPaise)}` : ''}
                    {c.active === false ? ' · product is retired' : ''}
                    {!c.imageUrl ? ' · no picture' : ''}
                  </div>
                </div>
                <div className="pg-choice-actions">
                  <button type="button" disabled={i === 0}
                    onClick={() => reorder(current.slotName, i, i - 1)}
                    aria-label="Move up">↑</button>
                  <button type="button" disabled={i === current.choices.length - 1}
                    onClick={() => reorder(current.slotName, i, i + 1)}
                    aria-label="Move down">↓</button>
                  <button type="button"
                    onClick={() => removeChoice(current.slotName, i)}
                    aria-label="Remove">✕</button>
                </div>
              </div>
            ))}
          </div>

          <div className="pg-editor-row">
            <label className="pg-field">
              <span>Row</span>
              <input
                type="number" min="1" max="50" value={current.rowNumber ?? ''}
                onChange={(e) => patchSlot(current.slotName, {
                  rowNumber: e.target.value === '' ? null : Number(e.target.value),
                })}
              />
            </label>
            <label className="pg-field">
              <span>Column</span>
              <input
                type="number" min="1" max="50" value={current.columnNumber ?? ''}
                onChange={(e) => patchSlot(current.slotName, {
                  columnNumber: e.target.value === '' ? null : Number(e.target.value),
                })}
              />
            </label>
            <label className="pg-field">
              <span>Holds</span>
              <input
                type="number" min="0" max="999" value={current.capacity ?? ''}
                onChange={(e) => patchSlot(current.slotName, {
                  capacity: e.target.value === '' ? null : Number(e.target.value),
                })}
              />
            </label>
            <label className="pg-field pg-field--wide">
              <span>Note for the refiller</span>
              <input
                value={current.note || ''} maxLength={80}
                placeholder="Front row only — tall packs jam"
                onChange={(e) => patchSlot(current.slotName, { note: e.target.value })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
