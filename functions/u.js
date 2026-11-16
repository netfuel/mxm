// Public unsubscribe page: /u?t=<token>
// GET shows a confirm button (so link scanners can't unsubscribe people by prefetching);
// POST unsubscribes. Mail apps' one-click unsubscribe (RFC 8058) POSTs here directly.
import { db } from '../lib/mail/db.js'

const page = (title, body, status = 200) => new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title}: MarceauxMarceaux</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#110f0d;color:#f1ece4;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;box-sizing:border-box}
  main{max-width:420px;text-align:center}
  img{width:220px;height:auto;margin:0 auto 28px;display:block}
  h1{font-size:22px;margin:0 0 10px} p{margin:0 0 22px;color:#a39c92}
  button,a.btn{font:600 15px/1 inherit;font-family:inherit;background:#c6ff00;color:#110f0d;border:0;border-radius:999px;padding:14px 26px;cursor:pointer;text-decoration:none;display:inline-block}
  button:focus-visible,a:focus-visible{outline:2px solid #f1ece4;outline-offset:3px}
  a{color:#c6ff00}
</style></head>
<body><main><a href="/"><img src="/assets/logo.svg" alt="MarceauxMarceaux"></a>${body}</main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const mask = e => { const [u, dom] = e.split('@'); return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${dom}` }

export async function onRequest({ request, env }) {
  const url = new URL(request.url)
  const token = url.searchParams.get('t') || ''
  if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!token || token === 'preview' || token === 'test') {
    return page('Unsubscribe', `<h1>This is a preview link</h1><p>Real emails carry a personal unsubscribe link.</p>`)
  }
  let d
  try { d = await db(env) } catch { return page('Unavailable', '<h1>Something went wrong</h1><p>Please try again in a minute.</p>', 503) }
  const sub = await d.prepare('SELECT id, email, status FROM subscribers WHERE token = ?').bind(token).first()
  if (!sub) return page('Not found', `<h1>Link not recognized</h1><p>This unsubscribe link isn't valid. If you keep getting emails, reply to one and we'll take you off.</p>`, 404)

  if (request.method === 'POST') {
    if (sub.status === 'subscribed') {
      await d.prepare(`UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(sub.id).run()
    }
    return page('Unsubscribed', `<h1>You're unsubscribed</h1><p>${esc(mask(sub.email))} won't get any more emails from MarceauxMarceaux.</p><a class="btn" href="/">Watch the videos</a>`)
  }
  if (sub.status !== 'subscribed') {
    return page('Unsubscribed', `<h1>You're already unsubscribed</h1><p>${esc(mask(sub.email))} isn't on the list.</p><a class="btn" href="/">Watch the videos</a>`)
  }
  return page('Unsubscribe', `<h1>Unsubscribe?</h1><p>Stop MarceauxMarceaux emails to ${esc(mask(sub.email))}.</p>
    <form method="post" action="/u?t=${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form>`)
}
