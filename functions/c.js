// Tracked link: /c?c=<campaign>&t=<subscriber token>&u=<destination>
// Records the click, then redirects. Only redirects to links that were in that campaign
// (recorded in campaign_links when it was sent), so this can't be used as an open redirect.
import { db } from '../lib/mail/db.js'

export async function onRequestGet({ request, env, waitUntil }) {
  const q = new URL(request.url).searchParams
  const campaignId = Number(q.get('c'))
  const token = q.get('t') || ''
  const url = q.get('u') || ''
  const home = new URL('/', request.url).href
  if (!Number.isInteger(campaignId) || !url) return Response.redirect(home, 302)

  let d
  try { d = await db(env) } catch { return /^https?:\/\//i.test(url) && url.startsWith(home) ? Response.redirect(url, 302) : Response.redirect(home, 302) }

  const link = await d.prepare('SELECT url FROM campaign_links WHERE campaign_id = ? AND url = ?').bind(campaignId, url).first()
  if (!link) return Response.redirect(home, 302)

  // Record without making the reader wait
  waitUntil((async () => {
    const sub = token && await d.prepare('SELECT id FROM subscribers WHERE token = ?').bind(token).first()
    if (!sub) return
    await d.prepare(`INSERT INTO clicks (campaign_id, subscriber_id, url) VALUES (?,?,?)
      ON CONFLICT(campaign_id, subscriber_id, url) DO UPDATE SET clicks = clicks + 1, last_at = datetime('now')`)
      .bind(campaignId, sub.id, url).run()
  })().catch(e => console.error('click log failed', e)))

  return new Response(null, { status: 302, headers: { location: link.url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
}
