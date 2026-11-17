// JSON API for the mail admin at /admin. Access-checked by functions/admin/_middleware.js.
import { db, getSettings, DEFAULT_SETTINGS, httpError, newToken, cleanEmail, cleanTags, tagList } from '../../../lib/mail/db.js'
import { renderEmail, parseContent } from '../../../lib/mail/render.js'
import { deliver, senderMode, SendError } from '../../../lib/mail/send.js'

const BATCH = 20        // messages per /batch request
const PARALLEL = 4      // concurrent sends inside a batch
const STALE_MIN = 10    // a claimed-but-unfinished send older than this is marked failed

export async function onRequest(ctx) {
  try {
    return await route(ctx)
  } catch (e) {
    const status = e.status || 500
    if (status >= 500) console.error(e)
    return Response.json({ error: e.message || 'Server error' }, { status })
  }
}

async function route({ request, env, params, data }) {
  const parts = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean)
  const method = request.method
  const isUpload = parts[0] === 'uploads'
  const body = method === 'GET' || method === 'DELETE' || isUpload ? {} : await request.json().catch(() => { throw httpError(400, 'Request body must be JSON') })
  const url = new URL(request.url)
  const d = await db(env)
  const [a, b, c] = parts

  if (a === 'me' && method === 'GET') {
    const s = await getSettings(env)
    return ok({ user: data.user, sender: senderMode(env), ready: !!(s.from_email && s.mailing_address) })
  }
  if (a === 'stats' && !b && method === 'GET') return ok(await stats(d))
  if (a === 'settings') {
    if (method === 'GET') return ok(await getSettings(env))
    if (method === 'PUT') return ok(await saveSettings(env, d, body))
  }
  if (a === 'subscribers') {
    if (!b && method === 'GET') return ok(await listSubscribers(d, url.searchParams))
    if (!b && method === 'POST') return ok(await addSubscribers(d, body))
    if (b === 'import' && method === 'POST') return ok(await importRows(d, body))
    if (b === 'bulk' && method === 'POST') return ok(await bulk(d, body))
    if (b === 'export' && method === 'GET') return exportCsv(d, url.searchParams)
    if (b && /^\d+$/.test(b) && method === 'PATCH') return ok(await updateSubscriber(d, +b, body))
    if (b && /^\d+$/.test(b) && method === 'DELETE') {
      await d.batch([d.prepare('DELETE FROM sends WHERE subscriber_id = ?').bind(+b), d.prepare('DELETE FROM clicks WHERE subscriber_id = ?').bind(+b), d.prepare('DELETE FROM subscribers WHERE id = ?').bind(+b)])
      return ok({ deleted: 1 })
    }
  }
  if (a === 'uploads' && method === 'POST') return ok(await upload(env, request, url.searchParams))
  if (a === 'stats' && b === 'campaigns' && method === 'GET') return ok(await campaignStats(d))
  if (a === 'preview' && method === 'POST') {
    const s = await getSettings(env)
    const r = renderEmail({ subject: body.subject || '', content: body.content, settings: s,
      sub: { email: 'fan@example.com', name: body.sampleName ?? 'Alex' }, unsubscribeUrl: `${site(s)}/u?t=preview` })
    return ok(r)
  }
  if (a === 'outbox' && method === 'GET') {
    if (senderMode(env) !== 'dry-run') throw httpError(404, 'Not found')
    const cols = url.searchParams.get('full') ? '*' : 'id, to_addr, subject, headers, created_at'
    const { results } = await d.prepare(`SELECT ${cols} FROM outbox ORDER BY id DESC LIMIT 200`).all()
    return ok({ items: results })
  }
  if (a === 'campaigns') {
    if (!b && method === 'GET') {
      const { results } = await d.prepare('SELECT id, subject, audience, status, total, sent_count, failed_count, created_at, updated_at, started_at, finished_at FROM campaigns ORDER BY id DESC').all()
      return ok({ items: results })
    }
    if (!b && method === 'POST') {
      const r = await d.prepare('INSERT INTO campaigns (subject, content, audience) VALUES (?,?,?) RETURNING id')
        .bind(String(body.subject || ''), JSON.stringify(parseContent(body.content)), cleanTags(body.audience).replace(/,/g, '')).first()
      return ok(await getCampaign(d, r.id))
    }
    if (!/^\d+$/.test(b || '')) throw httpError(404, 'Not found')
    const id = +b
    if (!c && method === 'GET') return ok(await getCampaign(d, id))
    if (!c && method === 'PUT') return ok(await saveCampaign(d, id, body))
    if (!c && method === 'DELETE') {
      const camp = await getCampaign(d, id)
      if (camp.status === 'sending') throw httpError(409, 'This campaign is sending. Let it finish first.')
      await d.batch(['sends', 'campaign_links', 'clicks'].map(t => d.prepare(`DELETE FROM ${t} WHERE campaign_id = ?`).bind(id))
        .concat(d.prepare('DELETE FROM campaigns WHERE id = ?').bind(id)))
      return ok({ deleted: 1 })
    }
    if (c === 'duplicate' && method === 'POST') {
      const camp = await getCampaign(d, id)
      const r = await d.prepare('INSERT INTO campaigns (subject, content, audience) VALUES (?,?,?) RETURNING id')
        .bind(camp.subject, JSON.stringify(camp.content), camp.audience).first()
      return ok(await getCampaign(d, r.id))
    }
    if (c === 'audience' && method === 'GET') {
      const camp = await getCampaign(d, id)
      return ok({ count: await audienceCount(d, camp.audience) })
    }
    if (c === 'test' && method === 'POST') return ok(await sendTest(env, d, id, body))
    if (c === 'start' && method === 'POST') return ok(await startCampaign(env, d, id))
    if (c === 'batch' && method === 'POST') return ok(await sendBatch(env, d, id))
    if (c === 'retry' && method === 'POST') {
      await d.batch([
        d.prepare(`UPDATE sends SET status = 'queued', error = NULL WHERE campaign_id = ? AND status = 'failed'`).bind(id),
        d.prepare(`UPDATE campaigns SET status = 'sending', finished_at = NULL WHERE id = ?`).bind(id),
      ])
      return ok(await progress(d, id))
    }
    if (c === 'report' && method === 'GET') return ok(await report(d, id, url.searchParams))
    if (c === 'report.csv' && method === 'GET') return reportCsv(d, id)
    if (c === 'failures' && method === 'GET') {
      const { results } = await d.prepare(`SELECT s.email, x.error, x.sent_at FROM sends x JOIN subscribers s ON s.id = x.subscriber_id
        WHERE x.campaign_id = ? AND x.status = 'failed' ORDER BY s.email LIMIT 500`).bind(id).all()
      return ok({ items: results })
    }
  }
  throw httpError(404, 'Not found')
}

const ok = v => Response.json(v)
const site = s => (s.site_url || DEFAULT_SETTINGS.site_url).replace(/\/+$/, '')

/* ---------------- Settings ---------------- */
async function saveSettings(env, d, body) {
  const allowed = Object.keys(DEFAULT_SETTINGS)
  const v = {}
  for (const k of allowed) if (k in body) v[k] = String(body[k] ?? '').trim()
  if (v.from_email && !cleanEmail(v.from_email)) throw httpError(400, 'From address is not a valid email address.')
  if (v.reply_to && !cleanEmail(v.reply_to)) throw httpError(400, 'Reply-to is not a valid email address.')
  if (v.test_emails) {
    const list = v.test_emails.split(/[\s,;]+/).filter(Boolean)
    const bad = list.filter(e => !cleanEmail(e))
    if (bad.length) throw httpError(400, `Not valid: ${bad.join(', ')}`)
    v.test_emails = list.map(cleanEmail).join(', ')
  }
  if (v.site_url && !/^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)/.test(v.site_url)) throw httpError(400, 'Site URL must start with https://')
  const stmts = Object.entries(v).map(([k, val]) =>
    d.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, val))
  if (stmts.length) await d.batch(stmts)
  return getSettings(env)
}

/* ---------------- Subscribers ---------------- */
async function stats(d) {
  const { results: byStatus } = await d.prepare('SELECT status, COUNT(*) n FROM subscribers GROUP BY status').all()
  const { results: tagRows } = await d.prepare(`SELECT tags FROM subscribers WHERE tags != '' AND status = 'subscribed'`).all()
  const tags = {}
  for (const r of tagRows) for (const t of tagList(r.tags)) tags[t] = (tags[t] || 0) + 1
  const counts = { subscribed: 0, unsubscribed: 0, bounced: 0 }
  for (const r of byStatus) counts[r.status] = r.n
  return { counts, total: byStatus.reduce((s, r) => s + r.n, 0), tags: Object.entries(tags).sort((x, y) => y[1] - x[1]).map(([tag, n]) => ({ tag, n })) }
}

function filters(params) {
  const where = [], args = []
  const q = (params.get('q') || '').trim()
  if (q) { where.push('(email LIKE ? OR name LIKE ?)'); args.push(`%${q}%`, `%${q}%`) }
  const status = params.get('status')
  if (status && ['subscribed', 'unsubscribed', 'bounced'].includes(status)) { where.push('status = ?'); args.push(status) }
  const tag = cleanTags(params.get('tag') || '')
  if (tag) { where.push('tags LIKE ?'); args.push(`%${tag}%`) }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args }
}

async function listSubscribers(d, params) {
  const { sql, args } = filters(params)
  const limit = Math.min(200, Math.max(1, +params.get('limit') || 50))
  const offset = Math.max(0, +params.get('offset') || 0)
  const sort = { newest: 'id DESC', oldest: 'id ASC', email: 'email ASC' }[params.get('sort')] || 'id DESC'
  const [{ results }, total] = await Promise.all([
    d.prepare(`SELECT id, email, name, tags, status, source, created_at, unsubscribed_at FROM subscribers ${sql} ORDER BY ${sort} LIMIT ? OFFSET ?`).bind(...args, limit, offset).all(),
    d.prepare(`SELECT COUNT(*) n FROM subscribers ${sql}`).bind(...args).first('n'),
  ])
  return { items: results.map(r => ({ ...r, tags: tagList(r.tags) })), total, limit, offset }
}

async function addSubscribers(d, body) {
  const raw = Array.isArray(body.emails) ? body.emails.join('\n') : String(body.emails || '')
  // Accept "Name <email>", plain addresses, one per line or separated by commas/semicolons
  const rows = []
  for (const piece of raw.split(/[\n;]+|,(?![^<]*>)/)) {
    const s = piece.trim(); if (!s) continue
    const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
    rows.push(m ? { email: m[2], name: m[1] || body.name } : { email: s, name: body.name })
  }
  return importRows(d, { rows, tags: body.tags, source: body.source || 'manual' })
}

// rows: [{ email, name?, tags? }]. Existing subscribers keep their status (an unsubscribed person is never re-subscribed by an import).
async function importRows(d, body) {
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : []
  const extraTags = tagList(cleanTags(body.tags))
  const source = String(body.source || 'import').slice(0, 40)
  const result = { added: 0, updated: 0, unchanged: 0, invalid: [], total: rows.length }
  const seen = new Set()
  const valid = []
  for (const r of rows) {
    const email = cleanEmail(r?.email)
    if (!email) { if (String(r?.email || '').trim()) result.invalid.push(String(r.email).slice(0, 100)); continue }
    if (seen.has(email)) continue
    seen.add(email)
    valid.push({ email, name: String(r.name || '').trim().slice(0, 120), tags: [...tagList(cleanTags(r.tags)), ...extraTags] })
  }
  for (let i = 0; i < valid.length; i += 50) {
    const chunk = valid.slice(i, i + 50)
    const ph = chunk.map(() => '?').join(',')
    const { results: existing } = await d.prepare(`SELECT id, email, name, tags FROM subscribers WHERE email IN (${ph})`).bind(...chunk.map(r => r.email)).all()
    const byEmail = new Map(existing.map(e => [e.email.toLowerCase(), e]))
    const stmts = []
    for (const r of chunk) {
      const ex = byEmail.get(r.email)
      if (!ex) {
        stmts.push(d.prepare('INSERT INTO subscribers (email, name, tags, source, token) VALUES (?,?,?,?,?)').bind(r.email, r.name, cleanTags(r.tags), source, newToken()))
        result.added++
      } else {
        const tags = cleanTags([...tagList(ex.tags), ...r.tags])
        const name = ex.name || r.name
        if (tags !== ex.tags || name !== ex.name) {
          stmts.push(d.prepare(`UPDATE subscribers SET tags = ?, name = ?, updated_at = datetime('now') WHERE id = ?`).bind(tags, name, ex.id))
          result.updated++
        } else result.unchanged++
      }
    }
    if (stmts.length) await d.batch(stmts)
  }
  result.invalid = result.invalid.slice(0, 50)
  return result
}

async function updateSubscriber(d, id, body) {
  const cur = await d.prepare('SELECT * FROM subscribers WHERE id = ?').bind(id).first()
  if (!cur) throw httpError(404, 'Subscriber not found')
  const name = 'name' in body ? String(body.name || '').trim().slice(0, 120) : cur.name
  const tags = 'tags' in body ? cleanTags(body.tags) : cur.tags
  let status = cur.status, unsubAt = cur.unsubscribed_at
  if ('status' in body && body.status !== cur.status) {
    if (!['subscribed', 'unsubscribed', 'bounced'].includes(body.status)) throw httpError(400, 'Unknown status')
    status = body.status
    unsubAt = status === 'subscribed' ? null : new Date().toISOString().slice(0, 19).replace('T', ' ')
  }
  let email = cur.email
  if ('email' in body && body.email !== cur.email) {
    email = cleanEmail(body.email)
    if (!email) throw httpError(400, 'Not a valid email address')
    const clash = await d.prepare('SELECT id FROM subscribers WHERE email = ? AND id != ?').bind(email, id).first()
    if (clash) throw httpError(409, 'Another subscriber already has that address')
  }
  await d.prepare(`UPDATE subscribers SET email = ?, name = ?, tags = ?, status = ?, unsubscribed_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(email, name, tags, status, unsubAt, id).run()
  const r = await d.prepare('SELECT id, email, name, tags, status, source, created_at, unsubscribed_at FROM subscribers WHERE id = ?').bind(id).first()
  return { ...r, tags: tagList(r.tags) }
}

async function bulk(d, body) {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger).slice(0, 1000)
  if (!ids.length) return { changed: 0 }
  const tag = cleanTags(body.tag).replace(/,/g, '')
  let changed = 0
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90), ph = chunk.map(() => '?').join(',')
    let stmts
    switch (body.action) {
      case 'delete':
        stmts = [d.prepare(`DELETE FROM sends WHERE subscriber_id IN (${ph})`).bind(...chunk), d.prepare(`DELETE FROM clicks WHERE subscriber_id IN (${ph})`).bind(...chunk), d.prepare(`DELETE FROM subscribers WHERE id IN (${ph})`).bind(...chunk)]; break
      case 'unsubscribe':
        stmts = [d.prepare(`UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now'), updated_at = datetime('now') WHERE status != 'unsubscribed' AND id IN (${ph})`).bind(...chunk)]; break
      case 'resubscribe':
        stmts = [d.prepare(`UPDATE subscribers SET status = 'subscribed', unsubscribed_at = NULL, updated_at = datetime('now') WHERE status != 'subscribed' AND id IN (${ph})`).bind(...chunk)]; break
      case 'add_tag':
        if (!tag) throw httpError(400, 'Tag required')
        stmts = [d.prepare(`UPDATE subscribers SET tags = CASE WHEN tags = '' THEN ? ELSE tags || ? END, updated_at = datetime('now') WHERE tags NOT LIKE ? AND id IN (${ph})`)
          .bind(`,${tag},`, `${tag},`, `%,${tag},%`, ...chunk)]; break
      case 'remove_tag':
        if (!tag) throw httpError(400, 'Tag required')
        stmts = [d.prepare(`UPDATE subscribers SET tags = CASE WHEN REPLACE(tags, ?, ',') = ',' THEN '' ELSE REPLACE(tags, ?, ',') END, updated_at = datetime('now') WHERE tags LIKE ? AND id IN (${ph})`)
          .bind(`,${tag},`, `,${tag},`, `%,${tag},%`, ...chunk)]; break
      default: throw httpError(400, 'Unknown action')
    }
    const res = await d.batch(stmts)
    changed += res[res.length - 1].meta.changes || 0
  }
  return { changed }
}

async function exportCsv(d, params) {
  const { sql, args } = filters(params)
  const { results } = await d.prepare(`SELECT email, name, tags, status, source, created_at, unsubscribed_at FROM subscribers ${sql} ORDER BY id`).bind(...args).all()
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = ['email,name,tags,status,source,created_at,unsubscribed_at',
    ...results.map(r => [r.email, r.name, tagList(r.tags).join(';'), r.status, r.source, r.created_at, r.unsubscribed_at].map(cell).join(','))]
  return new Response(lines.join('\n') + '\n', { headers: {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="mxm-subscribers-${new Date().toISOString().slice(0, 10)}.csv"` } })
}

/* ---------------- Campaigns ---------------- */
async function getCampaign(d, id) {
  const r = await d.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first()
  if (!r) throw httpError(404, 'Campaign not found')
  return { ...r, content: parseContent(r.content) }
}

async function saveCampaign(d, id, body) {
  const cur = await getCampaign(d, id)
  if (cur.status !== 'draft') throw httpError(409, 'This campaign has already been sent and can no longer be edited. Duplicate it to make a new one.')
  const subject = 'subject' in body ? String(body.subject || '').slice(0, 300) : cur.subject
  const content = 'content' in body ? parseContent(body.content) : cur.content
  const audience = 'audience' in body ? cleanTags(body.audience).replace(/,/g, '') : cur.audience
  await d.prepare(`UPDATE campaigns SET subject = ?, content = ?, audience = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(subject, JSON.stringify(content), audience, id).run()
  return getCampaign(d, id)
}

const audienceWhere = tag => tag ? [`status = 'subscribed' AND tags LIKE ?`, [`%,${tag},%`]] : [`status = 'subscribed'`, []]
async function audienceCount(d, tag) {
  const [w, args] = audienceWhere(tag)
  return d.prepare(`SELECT COUNT(*) n FROM subscribers WHERE ${w}`).bind(...args).first('n')
}

function senderFrom(s) {
  const address = cleanEmail(s.from_email)
  if (!address) throw httpError(400, 'Set a From address in Settings first.')
  if (!s.mailing_address) throw httpError(400, 'Add a mailing address in Settings first. Promotional email must include one (CAN-SPAM).')
  return { address, name: s.from_name || '' }
}

// track = true for real sends: every link becomes a per-subscriber /c?… redirect. Tests use the plain links.
function buildMessage(camp, s, sub, track = false) {
  const unsubscribeUrl = `${site(s)}/u?t=${encodeURIComponent(sub.token)}`
  const r = renderEmail({ subject: camp.subject, content: camp.content, settings: s, sub, unsubscribeUrl,
    track: track ? { base: site(s), campaignId: camp.id, token: sub.token } : null })
  return {
    to: sub.email, from: senderFrom(s), replyTo: cleanEmail(s.reply_to) || undefined,
    subject: r.subject, html: r.html, text: r.text,
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }
}

async function sendTest(env, d, id, body) {
  const camp = await getCampaign(d, id)
  if (!camp.subject.trim()) throw httpError(400, 'Add a subject first.')
  const s = await getSettings(env)
  const list = String(body.emails || s.test_emails || '').split(/[\s,;]+/).map(cleanEmail).filter(Boolean).slice(0, 5)
  if (!list.length) throw httpError(400, 'Add a test address in Settings (or type one in).')
  const sent = []
  for (const email of list) {
    const known = await d.prepare('SELECT email, name, token FROM subscribers WHERE email = ?').bind(email).first()
    const msg = buildMessage(camp, s, known || { email, name: '', token: 'test' })
    msg.subject = `[Test] ${msg.subject}`
    try { await deliver(env, msg); sent.push(email) }
    catch (e) { throw httpError(502, `Test to ${email} failed: ${e.message}${e.code ? ` (${e.code})` : ''}`) }
  }
  return { sent }
}

async function startCampaign(env, d, id) {
  const camp = await getCampaign(d, id)
  if (camp.status !== 'draft') throw httpError(409, 'This campaign has already been started.')
  if (!camp.subject.trim()) throw httpError(400, 'Add a subject first.')
  const s = await getSettings(env)
  senderFrom(s)
  if (!senderMode(env)) throw httpError(503, 'No email sender is configured yet (CF_ACCOUNT_ID and CF_EMAIL_TOKEN).')
  const [w, args] = audienceWhere(camp.audience)
  // Claim the draft first so two clicks can't start it twice
  const claim = await d.prepare(`UPDATE campaigns SET status = 'sending', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'draft'`).bind(id).run()
  if (!claim.meta.changes) throw httpError(409, 'This campaign has already been started.')
  // Record every link in the email so the click redirect only goes where the campaign points
  const links = new Map()
  renderEmail({ subject: camp.subject, content: camp.content, settings: s, sub: { email: '', name: '', token: 'x' }, unsubscribeUrl: '', links })
  const linkRows = [...links].map(([u, label], i) =>
    d.prepare('INSERT OR REPLACE INTO campaign_links (campaign_id, url, label, position) VALUES (?,?,?,?)').bind(id, u, label.slice(0, 200), i))
  if (linkRows.length) await d.batch(linkRows)
  await d.prepare(`INSERT OR IGNORE INTO sends (campaign_id, subscriber_id) SELECT ?, id FROM subscribers WHERE ${w}`).bind(id, ...args).run()
  const total = await d.prepare('SELECT COUNT(*) n FROM sends WHERE campaign_id = ?').bind(id).first('n')
  await d.prepare('UPDATE campaigns SET total = ? WHERE id = ?').bind(total, id).run()
  return progress(d, id)
}

async function progress(d, id) {
  const { results } = await d.prepare('SELECT status, COUNT(*) n FROM sends WHERE campaign_id = ? GROUP BY status').bind(id).all()
  const p = { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0 }
  for (const r of results) p[r.status] = r.n
  const total = Object.values(p).reduce((x, y) => x + y, 0)
  const done = p.queued === 0 && p.sending === 0
  await d.prepare(`UPDATE campaigns SET sent_count = ?, failed_count = ?, total = ?,
      status = CASE WHEN ? AND status = 'sending' THEN 'sent' ELSE status END,
      finished_at = CASE WHEN ? AND status = 'sending' THEN datetime('now') ELSE finished_at END
    WHERE id = ?`).bind(p.sent, p.failed, total, done ? 1 : 0, done ? 1 : 0, id).run()
  const camp = await d.prepare('SELECT status FROM campaigns WHERE id = ?').bind(id).first()
  return { ...p, total, done, status: camp?.status }
}

async function sendBatch(env, d, id) {
  const camp = await getCampaign(d, id)
  if (camp.status !== 'sending') return { ...(await progress(d, id)), note: 'Not sending' }
  const s = await getSettings(env)

  // A send claimed by a request that died mid-flight may or may not have gone out. Don't resend it blindly.
  await d.prepare(`UPDATE sends SET status = 'failed', error = 'Interrupted: may or may not have been delivered'
    WHERE campaign_id = ? AND status = 'sending' AND sent_at < datetime('now', ?)`).bind(id, `-${STALE_MIN} minutes`).run()

  const { results: next } = await d.prepare(`SELECT subscriber_id FROM sends WHERE campaign_id = ? AND status = 'queued' LIMIT ?`).bind(id, BATCH).all()
  if (!next.length) return progress(d, id)
  const ph = next.map(() => '?').join(',')
  const { results: claimed } = await d.prepare(`UPDATE sends SET status = 'sending', sent_at = datetime('now')
    WHERE campaign_id = ? AND status = 'queued' AND subscriber_id IN (${ph}) RETURNING subscriber_id`).bind(id, ...next.map(n => n.subscriber_id)).all()
  if (!claimed.length) return progress(d, id)
  const ids = claimed.map(r => r.subscriber_id)
  const { results: subs } = await d.prepare(`SELECT id, email, name, token, status FROM subscribers WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()
  const byId = new Map(subs.map(x => [x.id, x]))

  const updates = []
  let stop = null, backoff = 0
  const queue = [...ids]
  const worker = async () => {
    while (queue.length && !stop) {
      const sid = queue.shift()
      const sub = byId.get(sid)
      if (!sub || sub.status !== 'subscribed') {
        updates.push(d.prepare(`UPDATE sends SET status = 'skipped', error = 'No longer subscribed' WHERE campaign_id = ? AND subscriber_id = ?`).bind(id, sid)); continue
      }
      try {
        const r = await deliver(env, buildMessage(camp, s, sub, true))
        if (r.bounced || r.suppressed) {
          // Hard bounce or suppressed: never email this address again
          updates.push(d.prepare(`UPDATE sends SET status = 'failed', error = ? WHERE campaign_id = ? AND subscriber_id = ?`).bind(r.bounced ? 'Bounced (address does not exist)' : 'On Cloudflare suppression list', id, sid))
          updates.push(d.prepare(`UPDATE subscribers SET status = 'bounced', unsubscribed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(sid))
        } else {
          updates.push(d.prepare(`UPDATE sends SET status = 'sent', message_id = ?, error = NULL, sent_at = datetime('now') WHERE campaign_id = ? AND subscriber_id = ?`).bind(r.messageId || '', id, sid))
        }
      } catch (e) {
        if (e instanceof SendError && (e.fatal || e.retry)) {
          // Put it back in the queue; stop this batch
          updates.push(d.prepare(`UPDATE sends SET status = 'queued' WHERE campaign_id = ? AND subscriber_id = ?`).bind(id, sid))
          if (e.fatal) stop = `${e.message}${e.code ? ` (${e.code})` : ''}`
          else { stop = stop || 'rate'; backoff = 20 }
        } else {
          updates.push(d.prepare(`UPDATE sends SET status = 'failed', error = ? WHERE campaign_id = ? AND subscriber_id = ?`).bind(String(e.message || e).slice(0, 300), id, sid))
        }
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  // anything not attempted because we stopped goes back in the queue
  for (const sid of queue) updates.push(d.prepare(`UPDATE sends SET status = 'queued' WHERE campaign_id = ? AND subscriber_id = ?`).bind(id, sid))
  if (updates.length) await d.batch(updates)
  const p = await progress(d, id)
  if (stop === 'rate') return { ...p, backoff }
  if (stop) return { ...p, error: stop }
  return p
}

/* ---------------- Uploads (artwork, downloads) to R2 ---------------- */
const UPLOAD_MAX = 95 * 1024 * 1024   // Cloudflare caps a request body at 100 MB
async function upload(env, request, params) {
  if (!env.MEDIA) throw httpError(503, 'The R2 bucket is not bound (MEDIA).')
  const kind = params.get('kind') === 'artwork' ? 'artwork' : 'download'
  // Original name (for the download's filename) and a URL-safe version for the storage key
  const original = String(params.get('name') || 'file').replace(/[\\/"\r\n]+/g, '').trim().slice(-120) || 'file'
  const name = original.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/[\s-]+/g, '-').replace(/^-|-$/g, '').slice(-90) || 'file'
  const size = Number(request.headers.get('content-length') || 0)
  if (size > UPLOAD_MAX) throw httpError(413, 'That file is over 95 MB. Upload it to Dropbox or Google Drive and paste the share link instead.')
  const type = request.headers.get('content-type') || 'application/octet-stream'
  if (kind === 'artwork' && !/^image\/(jpeg|png|gif|webp)$/.test(type)) throw httpError(400, 'Artwork must be a JPG, PNG, GIF or WebP image.')
  const rand = crypto.getRandomValues(new Uint8Array(6)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')
  const key = `uploads/${kind}/${new Date().toISOString().slice(0, 7)}/${rand}-${name}`
  const obj = await env.MEDIA.put(key, request.body, {
    httpMetadata: { contentType: type, ...(kind === 'download' ? { contentDisposition: `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(original).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}` } : {}) },
  })
  const s = await getSettings(env)
  return { url: `${site(s)}/media/${key}`, key, size: obj?.size ?? size, name: original }
}

/* ---------------- Click stats ---------------- */
async function campaignStats(d) {
  const { results } = await d.prepare(`
    SELECT c.id, c.subject, c.status, c.audience, c.total, c.sent_count, c.started_at, c.finished_at,
      (SELECT COUNT(DISTINCT subscriber_id) FROM clicks k WHERE k.campaign_id = c.id) AS clickers,
      (SELECT COALESCE(SUM(clicks), 0) FROM clicks k WHERE k.campaign_id = c.id) AS clicks,
      (SELECT COUNT(DISTINCT k.subscriber_id) FROM clicks k JOIN campaign_links l ON l.campaign_id = k.campaign_id AND l.url = k.url
         WHERE k.campaign_id = c.id AND l.label LIKE '%Download:%') AS downloaders
    FROM campaigns c WHERE c.status != 'draft' ORDER BY COALESCE(c.started_at, c.created_at) DESC`).all()
  return { items: results }
}

async function report(d, id, params) {
  const camp = await getCampaign(d, id)
  const { results: links } = await d.prepare(`
    SELECT l.url, l.label, l.position, COUNT(k.subscriber_id) AS people, COALESCE(SUM(k.clicks), 0) AS clicks
    FROM campaign_links l LEFT JOIN clicks k ON k.campaign_id = l.campaign_id AND k.url = l.url
    WHERE l.campaign_id = ? GROUP BY l.url ORDER BY people DESC, l.position`).bind(id).all()
  const only = params.get('url')
  const { results: rows } = await d.prepare(`
    SELECT s.id, s.email, s.name, k.url, k.clicks, k.first_at, k.last_at
    FROM clicks k JOIN subscribers s ON s.id = k.subscriber_id
    WHERE k.campaign_id = ? ${only ? 'AND k.url = ?' : ''} ORDER BY k.last_at DESC LIMIT 5000`).bind(...(only ? [id, only] : [id])).all()
  const label = new Map(links.map(l => [l.url, l.label]))
  const people = new Map()
  for (const r of rows) {
    const p = people.get(r.id) || { id: r.id, email: r.email, name: r.name, links: [], clicks: 0, first_at: r.first_at, last_at: r.last_at }
    p.links.push(label.get(r.url) || r.url); p.clicks += r.clicks
    if (r.first_at < p.first_at) p.first_at = r.first_at
    if (r.last_at > p.last_at) p.last_at = r.last_at
    people.set(r.id, p)
  }
  const clickers = (await d.prepare('SELECT COUNT(DISTINCT subscriber_id) n FROM clicks WHERE campaign_id = ?').bind(id).first('n')) || 0
  return {
    campaign: { id: camp.id, subject: camp.subject, status: camp.status, audience: camp.audience, total: camp.total, sent: camp.sent_count, failed: camp.failed_count, started_at: camp.started_at, finished_at: camp.finished_at },
    clickers, links, people: [...people.values()],
  }
}

async function reportCsv(d, id) {
  const camp = await getCampaign(d, id)
  const { results } = await d.prepare(`
    SELECT s.email, s.name, l.label, k.url, k.clicks, k.first_at, k.last_at
    FROM clicks k JOIN subscribers s ON s.id = k.subscriber_id
    LEFT JOIN campaign_links l ON l.campaign_id = k.campaign_id AND l.url = k.url
    WHERE k.campaign_id = ? ORDER BY s.email, l.position`).bind(id).all()
  const cell = v => { const x = String(v ?? ''); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x }
  const lines = ['email,name,link,url,clicks,first_click,last_click', ...results.map(r =>
    [r.email, r.name, r.label, r.url, r.clicks, r.first_at, r.last_at].map(cell).join(','))]
  const slug = (camp.subject || `campaign-${id}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return new Response(lines.join('\n') + '\n', { headers: {
    'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="clicks-${slug}.csv"` } })
}
