// Checks the Cloudflare Access login token on every /admin request.
// Access sits in front of /admin and signs in with a one-time code; this re-verifies its JWT
// so the admin stays locked even if the Access policy is ever removed or misconfigured.
// Needs ACCESS_TEAM_DOMAIN (e.g. "mxm.cloudflareaccess.com") and ACCESS_AUD (the application's AUD tag).
let jwksCache = { url: '', keys: null, at: 0 }

const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0))
const json = s => JSON.parse(new TextDecoder().decode(b64url(s)))

async function keys(team) {
  const url = `https://${team}/cdn-cgi/access/certs`
  if (jwksCache.url === url && jwksCache.keys && Date.now() - jwksCache.at < 3600e3) return jwksCache.keys
  const r = await fetch(url)
  if (!r.ok) throw new Error('Could not load Access signing keys')
  const { keys } = await r.json()
  jwksCache = { url, keys, at: Date.now() }
  return keys
}

export async function verifyAccess(request, env) {
  const host = new URL(request.url).hostname
  if (env.DEV_NO_AUTH === '1' && (host === 'localhost' || host === '127.0.0.1')) return { email: 'dev@localhost' }

  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const aud = env.ACCESS_AUD || ''
  if (!team || !aud) return { error: 'The admin is not set up yet: ACCESS_TEAM_DOMAIN and ACCESS_AUD are missing.', status: 503 }

  const token = request.headers.get('cf-access-jwt-assertion') ||
    (request.headers.get('cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1]
  if (!token) return { error: 'Sign in required.', status: 401 }

  try {
    const [h, p, sig] = token.split('.')
    const header = json(h), payload = json(p)
    const jwk = (await keys(team)).find(k => k.kid === header.kid)
    if (!jwk || header.alg !== 'RS256') throw new Error('unknown key')
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`))
    const now = Date.now() / 1000
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (!ok || !auds.includes(aud) || payload.iss !== `https://${team}` || payload.exp < now) throw new Error('invalid token')
    return { email: payload.email || '' }
  } catch {
    return { error: 'Your sign-in has expired or is not valid. Reload to sign in again.', status: 401 }
  }
}
