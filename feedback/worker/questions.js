import { cleanText } from './validate.js'

/**
 * Questions that live in the database instead of in a deploy.
 *
 * One ordered set per (machine type, feedback|complaint). A snack Pod asks what
 * to stock; a coffee machine asks about strength and temperature. Both are just
 * rows now.
 *
 * What stays in code, because it is behaviour rather than wording: the rating
 * scale, the payment block that appears for payment-type issues, and the
 * closing step with the comment and the WhatsApp opt-in. A question editor that
 * can delete those is one that can break a refund.
 */

export const MACHINE_TYPES = [
  { value: 'snacks', label: 'Snacks & drinks' },
  { value: 'coffee', label: 'Coffee' },
]
export const MACHINE_TYPE_VALUES = MACHINE_TYPES.map((m) => m.value)

/**
 * `item_grid` is a row per item (a coffee flavour, say), each rated on the same
 * scale. It exists because the figure worth having is per flavour, and someone
 * who has tried three drinks can say so in one step. Rows they leave alone are
 * simply absent from the answer -- "didn't try" and "not answered" are the same
 * thing to anyone counting, so the form clears the row rather than storing a
 * value that every query would then have to filter out.
 */
export const QUESTION_TYPES = ['single', 'multi', 'text', 'item_grid']

/** Legacy submissions columns a question may also write to. Anything outside
 *  this list would be a column that does not exist, so it is a whitelist. */
export const MAPPABLE = [
  'issue_type', 'occurred_when', 'product_category',
  'price_feel', 'usage_freq', 'wanted_categories', 'wanted_text',
]

function parseOptions(raw) {
  try {
    const o = JSON.parse(raw || '[]')
    return Array.isArray(o) ? o : []
  } catch { return [] }
}

/** The questions one machine type asks, for one kind of submission. */
export async function loadQuestions(env, machineType, kind) {
  const rows = await env.DB.prepare(
    `SELECT q.question_id, q.qkey, q.position, q.type, q.kicker, q.title, q.hint,
            q.options, q.scale, q.extra_placeholder, q.optional, q.maps_to
       FROM questions q
       JOIN question_sets s ON s.set_id = q.set_id
      WHERE s.machine_type = ?1 AND s.kind = ?2 AND q.active = 1
      ORDER BY q.position, q.created_at`
  ).bind(machineType, kind).all()

  return (rows.results || []).map((r) => ({
    id: r.question_id,
    key: r.qkey,
    type: r.type,
    kicker: r.kicker,
    title: r.title,
    hint: r.hint,
    options: parseOptions(r.options),
    scale: parseOptions(r.scale),
    extraPlaceholder: r.extra_placeholder,
    optional: !!r.optional,
    mapsTo: r.maps_to,
  }))
}

/**
 * Checks answers against the questions that were actually asked.
 *
 * The client is told what to ask by us, but it is still a client: an answer
 * naming an option that is not on the question is dropped, exactly as the
 * hardcoded enums used to be whitelisted.
 *
 * Returns { answers, mapped, errors } -- `mapped` is what to write to the
 * legacy columns so everything reading them keeps working.
 */
export function validateAnswers(questions, incoming) {
  const given = incoming && typeof incoming === 'object' ? incoming : {}
  const answers = {}
  const mapped = {}
  const errors = []

  for (const q of questions) {
    const raw = given[q.key]
    const allowed = new Set(q.options.map((o) => o.value))
    let value = null

    if (q.type === 'multi') {
      const picked = [...new Set(
        (Array.isArray(raw) ? raw : []).filter((v) => typeof v === 'string' && allowed.has(v))
      )].slice(0, 30)
      value = picked.length ? picked : null
    } else if (q.type === 'single') {
      value = typeof raw === 'string' && allowed.has(raw) ? raw : null
    } else if (q.type === 'item_grid') {
      // { flavour: level } -- rows and levels are whitelisted separately, so a
      // level in an item slot or an item that is not on the question is
      // dropped rather than stored. Rows they did not rate never appear.
      const levels = new Set((q.scale || []).map((o) => o.value))
      const grid = {}
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [item, level] of Object.entries(raw)) {
          if (allowed.has(item) && levels.has(level)) grid[item] = level
        }
      }
      value = Object.keys(grid).length ? grid : null
    } else {
      value = cleanText(raw, 200)
    }

    // The companion free-text box, when the question has one.
    const extra = q.extraPlaceholder ? cleanText(given[`${q.key}__extra`], 200) : null

    if (!q.optional && value == null) {
      errors.push(`${q.title} — please answer this.`)
      continue
    }

    if (value != null) answers[q.key] = value
    if (extra) answers[`${q.key}__extra`] = extra

    if (q.mapsTo && value != null) {
      mapped[q.mapsTo] = typeof value === 'string' ? value : JSON.stringify(value)
    }
    // wanted_text is the one legacy column fed by a companion box rather than
    // by the answer itself.
    if (extra && q.mapsTo === 'wanted_categories') mapped.wanted_text = extra
  }

  return { answers, mapped, errors }
}

/** Does the chosen issue option want the amount-and-reference block? */
export function isPaymentIssue(questions, answers) {
  for (const q of questions) {
    if (q.mapsTo !== 'issue_type') continue
    const chosen = answers[q.key]
    const opt = q.options.find((o) => o.value === chosen)
    if (opt?.payment) return true
  }
  return false
}

/* ---------------------------------------------------------------- admin -- */

export async function handleQuestionsList(env, json) {
  const sets = await env.DB.prepare(
    'SELECT set_id, machine_type, kind FROM question_sets ORDER BY machine_type, kind'
  ).all()

  const rows = await env.DB.prepare(
    `SELECT question_id, set_id, qkey, position, type, kicker, title, hint,
            options, scale, extra_placeholder, optional, maps_to, active
       FROM questions ORDER BY set_id, position, created_at`
  ).all()

  return json({
    sets: sets.results || [],
    questions: (rows.results || []).map((r) => ({
      ...r,
      options: parseOptions(r.options),
      scale: parseOptions(r.scale),
    })),
    machineTypes: MACHINE_TYPES,
    mappable: MAPPABLE,
  })
}

export async function handleQuestionSave(request, env, json, questionId) {
  let body
  try { body = await request.json() } catch { body = {} }

  const title = cleanText(body.title, 120)
  if (!title) return json({ error: 'validation', message: 'The question needs a title.' }, 422)

  const type = QUESTION_TYPES.includes(body.type) ? body.type : 'single'
  const options = Array.isArray(body.options)
    ? body.options
        .map((o) => ({
          value: cleanText(o?.value, 40),
          label: cleanText(o?.label, 80),
          ...(o?.payment ? { payment: true } : {}),
        }))
        .filter((o) => o.value && o.label)
        .slice(0, 30)
    : []

  if (type !== 'text' && !options.length) {
    return json({ error: 'validation', message: 'A choice question needs at least one option.' }, 422)
  }

  // The scale is stored apart from the options so flavours can be added
  // without touching the wording of the scale, and the other way round.
  const scale = Array.isArray(body.scale)
    ? body.scale
        .map((o) => ({ value: cleanText(o?.value, 40), label: cleanText(o?.label, 80) }))
        .filter((o) => o.value && o.label)
        .slice(0, 10)
    : []

  if (type === 'item_grid' && scale.length < 2) {
    return json({
      error: 'validation',
      message: 'This question needs at least two points on the scale.',
    }, 422)
  }

  const mapsTo = MAPPABLE.includes(body.mapsTo) ? body.mapsTo : null
  const fields = {
    title,
    type,
    kicker: cleanText(body.kicker, 60),
    hint: cleanText(body.hint, 160),
    options: JSON.stringify(options),
    scale: JSON.stringify(scale),
    extra_placeholder: cleanText(body.extraPlaceholder, 80),
    optional: body.optional === false ? 0 : 1,
    position: Number.isInteger(body.position) ? body.position : 50,
    active: body.active === false ? 0 : 1,
  }

  if (questionId) {
    // qkey and set_id are deliberately not editable: the key is what every
    // answer already given is filed under, and moving a question between sets
    // would change which machines ask it.
    const sets = Object.keys(fields).map((k, i) => `${k} = ?${i + 2}`).join(', ')
    const res = await env.DB.prepare(
      `UPDATE questions SET ${sets}, maps_to = ?${Object.keys(fields).length + 2} WHERE question_id = ?1`
    ).bind(questionId, ...Object.values(fields), mapsTo).run()
    if (!res.meta?.changes) return json({ error: 'not_found', message: 'No such question.' }, 404)
    return json({ ok: true, questionId })
  }

  const setId = cleanText(body.setId, 40)
  const set = setId
    ? await env.DB.prepare('SELECT set_id FROM question_sets WHERE set_id = ?1').bind(setId).first()
    : null
  if (!set) return json({ error: 'validation', message: 'Choose which machine type this is for.' }, 422)

  const key = (cleanText(body.qkey, 40) || title)
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  if (!key) return json({ error: 'validation', message: 'Could not make a key from that title.' }, 422)

  const id = `q_${crypto.randomUUID().slice(0, 8)}`
  try {
    await env.DB.prepare(
      `INSERT INTO questions
         (question_id, set_id, qkey, position, type, kicker, title, hint,
          options, scale, extra_placeholder, optional, maps_to, active)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`
    ).bind(id, setId, key, fields.position, fields.type, fields.kicker, fields.title,
           fields.hint, fields.options, fields.scale, fields.extra_placeholder,
           fields.optional, mapsTo, fields.active).run()
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE')) {
      return json({
        error: 'validation',
        message: `This machine type already has a question keyed "${key}". Reword the title.`,
      }, 409)
    }
    throw err
  }
  return json({ ok: true, questionId: id, qkey: key })
}

/**
 * Removes a question.
 *
 * Deactivates rather than deletes when answers already reference it: a row in
 * submissions.answers keyed by a question nobody can look up is a number with
 * no question, and reports would quietly lose its meaning.
 */
export async function handleQuestionDelete(env, json, questionId) {
  const q = await env.DB.prepare(
    'SELECT question_id, qkey FROM questions WHERE question_id = ?1'
  ).bind(questionId).first()
  if (!q) return json({ error: 'not_found', message: 'No such question.' }, 404)

  // If this check cannot run, do NOT fall through to deleting. A swallowed
  // error here means answers are destroyed because a count failed, which is
  // the worst possible reading of "we are not sure".
  let used
  try {
    used = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM submissions
        WHERE answers IS NOT NULL AND json_extract(answers, '$.' || ?1) IS NOT NULL`
    ).bind(q.qkey).first()
  } catch (err) {
    return json({
      error: 'server_error',
      message: 'Could not check whether anyone has answered this, so it was left alone.',
    }, 500)
  }

  if ((used?.n ?? 0) > 0) {
    await env.DB.prepare('UPDATE questions SET active = 0 WHERE question_id = ?1')
      .bind(questionId).run()
    return json({
      ok: true,
      deactivated: true,
      message: `Hidden rather than deleted — ${used.n} submission(s) already answered it, `
        + 'and those answers would otherwise lose their question.',
    })
  }

  await env.DB.prepare('DELETE FROM questions WHERE question_id = ?1').bind(questionId).run()
  return json({ ok: true, deleted: true })
}
