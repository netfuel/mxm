// Every request under /admin (the React app and its API) must carry a valid Cloudflare Access login.
import { verifyAccess } from '../../lib/mail/access.js'

export async function onRequest({ request, env, next, data }) {
  const who = await verifyAccess(request, env)
  if (who.error) {
    const isApi = new URL(request.url).pathname.startsWith('/admin/api/')
    return isApi
      ? Response.json({ error: who.error }, { status: who.status, headers: { 'cache-control': 'no-store' } })
      : new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mail admin</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#110f0d;color:#f1ece4;font:15px/1.5 system-ui,sans-serif;padding:24px">
<p style="max-width:420px;text-align:center">${who.error}</p></body>`, { status: who.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
  }
  data.user = who.email
  const res = await next()
  const out = new Response(res.body, res)
  out.headers.set('cache-control', 'no-store')
  out.headers.set('x-robots-tag', 'noindex, nofollow')
  return out
}
