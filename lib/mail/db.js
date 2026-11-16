// D1 schema for the mailing list. Created on first use, so a fresh database needs no manual SQL.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS subscribers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL DEFAULT '',
     tags TEXT NOT NULL DEFAULT '',            -- ",tag-a,tag-b," so LIKE '%,tag,%' matches whole tags
     status TEXT NOT NULL DEFAULT 'subscribed', -- subscribed | unsubscribed | bounced
     source TEXT NOT NULL DEFAULT '',
     token TEXT NOT NULL UNIQUE,               -- secret used in unsubscribe links
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     unsubscribed_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS subscribers_status ON subscribers(status)`,
  `CREATE TABLE IF NOT EXISTS campaigns (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     subject TEXT NOT NULL DEFAULT '',
     content TEXT NOT NULL DEFAULT '{}',       -- JSON: preheader, heading, body, button, videos, image
     audience TEXT NOT NULL DEFAULT '',        -- '' = everyone subscribed, otherwise a tag
     status TEXT NOT NULL DEFAULT 'draft',     -- draft | sending | sent
     total INTEGER NOT NULL DEFAULT 0,
     sent_count INTEGER NOT NULL DEFAULT 0,
     failed_count INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     started_at TEXT,
     finished_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS sends (
     campaign_id INTEGER NOT NULL,
     subscriber_id INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'queued',    -- queued | sent | failed | skipped
     message_id TEXT,
     error TEXT,
     sent_at TEXT,
     PRIMARY KEY (campaign_id, subscriber_id)
   )`,
  `CREATE INDEX IF NOT EXISTS sends_queue ON sends(campaign_id, status)`,
  // Every tracked link in a campaign (recorded when sending starts), and who clicked what
  `CREATE TABLE IF NOT EXISTS campaign_links (
     campaign_id INTEGER NOT NULL,
     url TEXT NOT NULL,
     label TEXT NOT NULL DEFAULT '',
     position INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (campaign_id, url)
   )`,
  `CREATE TABLE IF NOT EXISTS clicks (
     campaign_id INTEGER NOT NULL,
     subscriber_id INTEGER NOT NULL,
     url TEXT NOT NULL,
     clicks INTEGER NOT NULL DEFAULT 1,
     first_at TEXT NOT NULL DEFAULT (datetime('now')),
     last_at TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (campaign_id, subscriber_id, url)
   )`,
  `CREATE INDEX IF NOT EXISTS clicks_sub ON clicks(subscriber_id)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // Local dry-run sends land here instead of going out (only used when no sender is configured and MAIL_DRY_RUN=1)
  `CREATE TABLE IF NOT EXISTS outbox (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     to_addr TEXT, subject TEXT, html TEXT, text TEXT, headers TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
]

let ready = null
export function db(env) {
  if (!env.DB) throw httpError(503, 'The D1 database is not bound. Add a D1 binding named DB to the Pages project.')
  if (!ready) ready = env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))).catch(e => { ready = null; throw e })
  return ready.then(() => env.DB)
}

export const DEFAULT_SETTINGS = {
  from_name: 'MarceauxMarceaux',
  from_email: '',
  reply_to: '',
  mailing_address: '',
  test_emails: '',
  site_url: 'https://mxm-eho.pages.dev',
}

export async function getSettings(env) {
  const d = await db(env)
  const { results } = await d.prepare('SELECT key, value FROM settings').all()
  const s = { ...DEFAULT_SETTINGS }
  for (const r of results) if (r.key in s) s[r.key] = r.value
  return s
}

export function httpError(status, message) {
  const e = new Error(message); e.status = status; return e
}

export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[a-z]{2,}$/i
export function cleanEmail(v) {
  const e = String(v || '').trim().replace(/^mailto:/i, '').toLowerCase()
  return EMAIL_RE.test(e) && e.length <= 254 ? e : null
}

export function cleanTags(v) {
  const list = (Array.isArray(v) ? v : String(v || '').split(/[,;|]/))
    .map(t => String(t).trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, '-'))
    .filter(Boolean)
  const uniq = [...new Set(list)].slice(0, 20)
  return uniq.length ? ',' + uniq.join(',') + ',' : ''
}
export const tagList = s => String(s || '').split(',').filter(Boolean)
