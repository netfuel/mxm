// Thin fetch wrapper for /admin/api. Errors carry the server's message.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/admin/api/${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json().catch(() => ({})) : {}
  if (!res.ok) {
    const e = new Error(data.error || (res.status === 401 ? 'Your sign-in expired. Reload the page.' : `Request failed (${res.status})`))
    e.status = res.status
    throw e
  }
  return data
}

// The site's own video list (public/assets/videos.js sets window.VIDEOS)
let videosPromise
export function loadVideos() {
  if (!videosPromise) {
    videosPromise = fetch('/assets/videos.js').then(r => r.text()).then(t => {
      const json = t.slice(t.indexOf('['), t.lastIndexOf(']') + 1)
      return JSON.parse(json)
    }).catch(() => [])
  }
  return videosPromise
}

export const fmtDate = s => {
  if (!s) return ''
  const d = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'))
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
export const n = v => Number(v || 0).toLocaleString()
