// Delivers one message through Cloudflare Email Service.
// Order of preference:
//   1. a send_email binding named EMAIL (if Pages ever exposes one)
//   2. the Email Service REST API with CF_ACCOUNT_ID + CF_EMAIL_TOKEN (a token with "Email Sending: Edit")
//   3. MAIL_DRY_RUN=1: nothing is sent, the message is stored in the outbox table (local testing)
export function senderMode(env) {
  if (env.EMAIL && typeof env.EMAIL.send === 'function') return 'binding'
  if (env.CF_ACCOUNT_ID && env.CF_EMAIL_TOKEN) return 'api'
  if (env.MAIL_DRY_RUN === '1') return 'dry-run'
  return null
}

export class SendError extends Error {
  constructor(message, { code = '', retry = false, fatal = false } = {}) {
    super(message); this.code = code; this.retry = retry; this.fatal = fatal
  }
}

const RETRY = /RATE_LIMIT|TOO_MANY|429|TEMPORARY|TIMEOUT|5\d\d/i
const FATAL = /SENDER_NOT_VERIFIED|DOMAIN_NOT_AVAILABLE|DAILY_LIMIT|UNAUTHORI[SZ]ED|AUTHENTICATION|FORBIDDEN|\b40[13]\b|NOT_ENTITLED|PLAN/i

// msg: { to, from: {address, name}, replyTo, subject, html, text, headers }
export async function deliver(env, msg) {
  const mode = senderMode(env)
  if (!mode) throw new SendError('No email sender is configured (CF_ACCOUNT_ID and CF_EMAIL_TOKEN).', { fatal: true })

  if (mode === 'dry-run') {
    const r = await env.DB.prepare('INSERT INTO outbox (to_addr, subject, html, text, headers) VALUES (?,?,?,?,?) RETURNING id')
      .bind(msg.to, msg.subject, msg.html, msg.text, JSON.stringify(msg.headers || {})).first()
    return { messageId: `dry-run-${r.id}` }
  }

  if (mode === 'binding') {
    try {
      const r = await env.EMAIL.send({
        to: msg.to, from: msg.from, subject: msg.subject, html: msg.html, text: msg.text,
        ...(msg.replyTo ? { replyTo: msg.replyTo } : {}), headers: msg.headers || {},
      })
      return { messageId: r?.messageId || '' }
    } catch (e) {
      const code = e.code || ''
      throw new SendError(e.message || String(e), { code, retry: RETRY.test(code), fatal: FATAL.test(code) })
    }
  }

  // REST API
  const body = {
    to: msg.to,
    from: msg.from.name ? { address: msg.from.address, name: msg.from.name } : msg.from.address,
    subject: msg.subject, html: msg.html, text: msg.text,
    ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    ...(msg.headers && Object.keys(msg.headers).length ? { headers: msg.headers } : {}),
  }
  let res, data
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/sending/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_EMAIL_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    data = await res.json().catch(() => ({}))
  } catch (e) {
    throw new SendError('Network error reaching Cloudflare: ' + (e.message || e), { retry: true })
  }
  if (res.ok && data.success !== false) {
    return { messageId: data.result?.message_id || data.result?.messageId || data.result?.id || '' }
  }
  const err = (data.errors && data.errors[0]) || {}
  const code = String(err.code || res.status)
  const message = err.message || `Cloudflare returned ${res.status}`
  const tag = `${code} ${message}`
  throw new SendError(message, { code, retry: res.status === 429 || res.status >= 500 || RETRY.test(tag), fatal: res.status === 401 || res.status === 403 || FATAL.test(tag) })
}
