// Serves /media/* from the R2 bucket bound as MEDIA, on the site's own domain.
// Supports byte ranges (video seeking), conditional requests and HEAD.
const TYPES = { mp4: 'video/mp4', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const parts = Array.isArray(params.path) ? params.path : [params.path]
  const key = parts.map(decodeURIComponent).join('/')
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 })

  const headers = new Headers()
  const finish = (obj) => {
    obj.writeHttpMetadata(headers)
    if (!headers.has('content-type')) headers.set('content-type', TYPES[key.split('.').pop().toLowerCase()] || 'application/octet-stream')
    headers.set('etag', obj.httpEtag)
    headers.set('accept-ranges', 'bytes')
    headers.set('cache-control', 'public, max-age=604800')
  }

  if (request.method === 'HEAD') {
    const obj = await env.MEDIA.head(key)
    if (!obj) return new Response(null, { status: 404 })
    finish(obj)
    headers.set('content-length', String(obj.size))
    return new Response(null, { headers })
  }

  const obj = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers })
  if (obj === null) return new Response('Not found', { status: 404 })
  finish(obj)
  if (!('body' in obj)) return new Response(null, { status: 304, headers }) // If-None-Match hit

  if (request.headers.has('range') && obj.range) {
    const r = obj.range
    const offset = 'suffix' in r ? obj.size - r.suffix : (r.offset ?? 0)
    const length = 'suffix' in r ? r.suffix : (r.length ?? obj.size - offset)
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`)
    headers.set('content-length', String(length))
    return new Response(obj.body, { status: 206, headers })
  }
  headers.set('content-length', String(obj.size))
  return new Response(obj.body, { headers })
}
