// Turns a campaign into the email HTML and plain text that go out.
// Everything inlined and table-based so it holds up in Gmail, Apple Mail and Outlook.
//
// Click tracking: every link goes through href(url, label). With `track` set, it becomes
// <site>/c?c=<campaign>&t=<subscriber token>&u=<url>, which records the click and redirects.
// The same render with a `links` Map collects every (url → label) so /c only redirects to
// links that really are in the campaign.
const C = { bg: '#110f0d', card: '#191613', ink: '#f1ece4', dim: '#a39c92', lime: '#c6ff00', line: '#2b2621' }
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const MONO = "'IBM Plex Mono', Menlo, Consolas, monospace"

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const safeUrl = u => {
  const s = String(u || '').trim()
  return /^(https?:|mailto:)/i.test(s) ? s : ''
}

// {{name}}, {{name|fallback}}, {{email}}
export function merge(text, sub) {
  return String(text || '').replace(/\{\{\s*(name|first_name|email)\s*(?:\|([^}]*))?\}\}/gi, (_, k, fb) => {
    const key = k.toLowerCase()
    const full = (sub?.name || '').trim()
    const v = key === 'email' ? sub?.email : key === 'first_name' ? full.split(/\s+/)[0] : full
    return v || (fb ?? '').trim()
  })
}

export const SOCIAL = [
  ['Bandcamp', 'https://marceauxmarceaux.bandcamp.com/'],
  ['SoundCloud', 'https://soundcloud.com/marceauxmarceaux'],
  ['Instagram', 'https://www.instagram.com/marceauxmusic'],
]

function makeHref({ track, links }) {
  return (url, label) => {
    const u = safeUrl(url)
    if (!u) return ''
    // Clicks are counted per destination; when several spots share one, the label names them all
    if (links) {
      const prev = links.get(u)
      if (!prev) links.set(u, label)
      else if (!prev.split(' · ').includes(label)) links.set(u, `${prev} · ${label}`)
    }
    if (!track || /^mailto:/i.test(u)) return u
    return `${track.base}/c?c=${track.campaignId}&t=${encodeURIComponent(track.token)}&u=${encodeURIComponent(u)}`
  }
}

// Small Markdown subset: # / ## headings, paragraphs, - lists, **bold**, *italic*, [links](url), bare URLs
function inline(s, href) {
  let out = esc(s)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
    const raw = u.replace(/&amp;/g, '&')
    const h = href(raw, `Link: ${t.replace(/&[a-z#0-9]+;/g, '')}`)
    return h ? `<a href="${esc(h)}" style="color:${C.lime};text-decoration:underline">${t}</a>` : t
  })
  out = out.replace(/(^|[\s(>])(https?:\/\/[^\s<)"]+)/g, (m, pre, u) => {
    const raw = u.replace(/&amp;/g, '&')
    return `${pre}<a href="${esc(href(raw, `Link: ${raw.replace(/^https?:\/\//, '')}`))}" style="color:${C.lime};text-decoration:underline">${u.replace(/^https?:\/\//, '')}</a>`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  return out
}
export function markdown(src, href = u => safeUrl(u)) {
  // Paragraph breaks at blank lines; headings always stand alone, and a list starts its own block
  const lines = String(src || '').replace(/\r/g, '').split('\n')
  const blocks = []
  let cur = []
  const flush = () => { if (cur.length) blocks.push(cur.join('\n').trim()); cur = [] }
  for (const l of lines) {
    const isList = /^\s*[-*]\s+/.test(l)
    if (!l.trim()) flush()
    else if (/^#{1,2}\s/.test(l)) { flush(); blocks.push(l.trim()) }
    else {
      if (cur.length && isList !== /^\s*[-*]\s+/.test(cur[cur.length - 1])) flush()
      cur.push(l)
    }
  }
  flush()
  const p = `margin:0 0 18px;font:16px/1.6 ${FONT};color:${C.ink}`
  return blocks.filter(Boolean).map(b => {
    if (/^#{1,2}\s/.test(b)) {
      const lvl = b.startsWith('## ') ? 2 : 1
      return `<h${lvl + 1} style="margin:28px 0 12px;font:700 ${lvl === 1 ? 24 : 19}px/1.25 ${FONT};color:${C.ink}">${inline(b.replace(/^#{1,2}\s+/, ''), href)}</h${lvl + 1}>`
    }
    const ls = b.split('\n')
    if (ls.every(l => /^\s*[-*]\s+/.test(l))) {
      return `<ul style="margin:0 0 18px;padding-left:22px">${ls.map(l =>
        `<li style="margin:0 0 6px;font:16px/1.6 ${FONT};color:${C.ink}">${inline(l.replace(/^\s*[-*]\s+/, ''), href)}</li>`).join('')}</ul>`
    }
    return `<p style="${p}">${ls.map(l => inline(l, href)).join('<br>')}</p>`
  }).join('\n')
}
function markdownText(src) {
  return String(src || '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^#{1,2}\s+/gm, '').trim()
}

export function parseContent(raw) {
  let c = {}
  try { c = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}) } catch { c = {} }
  const art = c.artwork || {}
  return {
    preheader: String(c.preheader || ''),
    heading: String(c.heading || ''),
    // Album art at the top of the email; `image` was the older field name
    artwork: { url: String(art.url || c.image || ''), link: String(art.link || ''), alt: String(art.alt || '') },
    body: String(c.body || ''),
    button: { label: String(c.button?.label || ''), url: String(c.button?.url || '') },
    download: { label: String(c.download?.label || ''), url: String(c.download?.url || ''), note: String(c.download?.note || '') },
    videos: Array.isArray(c.videos) ? c.videos.filter(v => v && v.slug).slice(0, 12).map(v => ({ slug: String(v.slug), title: String(v.title || '') })) : [],
    videosTitle: String(c.videosTitle || ''),
  }
}

// sub: { email, name, token }   settings: from getSettings()
// track: { base, campaignId, token } for real sends; links: a Map to collect link labels
export function renderEmail({ subject, content, settings, sub, unsubscribeUrl, track, links }) {
  const c = parseContent(content)
  const site = (settings.site_url || '').replace(/\/+$/, '')
  const m = s => merge(s, sub)
  const href = makeHref({ track, links })
  const pre = m(c.preheader)
  const logo = `${site}/assets/email/logo.png`

  const artSrc = safeUrl(c.artwork.url)
  const artHref = artSrc && c.artwork.link ? href(c.artwork.link, 'Artwork') : ''
  const artImg = artSrc ? `<img src="${esc(artSrc)}" width="360" alt="${esc(c.artwork.alt || 'Album artwork')}" style="display:block;width:100%;max-width:360px;height:auto;border:0;border-radius:6px;margin:0 auto">` : ''
  const artwork = artSrc ? `
          <tr><td align="center" class="pad" style="padding:36px 44px 0">
            ${artHref ? `<a href="${esc(artHref)}" style="display:block;text-decoration:none">${artImg}</a>` : artImg}
          </td></tr>` : ''

  const videoCells = c.videos.map(v => {
    const h = href(`${site}/#v=${encodeURIComponent(v.slug)}`, `Video: ${v.title || v.slug}`)
    return `
      <td class="vcell" width="50%" valign="top" style="padding:0 6px 14px">
        <a href="${esc(h)}" style="text-decoration:none;display:block">
          <img src="${esc(site)}/media/${encodeURIComponent(v.slug)}/thumb.jpg" width="258" alt="${esc(v.title)}" style="display:block;width:100%;max-width:258px;height:auto;border:0;border-radius:4px">
          ${v.title ? `<div style="padding-top:8px;font:12px/1.4 ${MONO};letter-spacing:.04em;color:${C.dim}">${esc(v.title)}</div>` : ''}
        </a>
      </td>`
  })
  const rows = []
  for (let i = 0; i < videoCells.length; i += 2) rows.push(`<tr>${videoCells[i]}${videoCells[i + 1] || '<td width="50%" style="padding:0 6px"></td>'}</tr>`)

  const btnHref = c.button.label ? href(c.button.url, `Button: ${c.button.label}`) : ''
  const dlLabel = c.download.label || 'Download'
  const dlHref = href(c.download.url, `Download: ${dlLabel}`)
  const downloadBlock = dlHref ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 18px;border:1px solid ${C.line};border-radius:8px;background:${C.bg}">
              <tr><td style="padding:18px 20px">
                <div style="font:500 11px/1 ${MONO};letter-spacing:.18em;text-transform:uppercase;color:${C.dim};padding-bottom:10px">Download</div>
                ${c.download.note ? `<div style="font:15px/1.5 ${FONT};color:${C.ink};padding-bottom:14px">${esc(m(c.download.note))}</div>` : ''}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="border:2px solid ${C.lime};border-radius:999px">
                    <a href="${esc(dlHref)}" style="display:inline-block;padding:12px 24px;font:700 15px/1 ${FONT};color:${C.lime};text-decoration:none;border-radius:999px">&#8595;&nbsp; ${esc(m(dlLabel))}</a>
                  </td></tr></table>
              </td></tr></table>` : ''
  const siteHref = href(`${site}/#videos`, 'Footer: Videos')
  const social = SOCIAL.map(([name, url]) => `<a href="${esc(href(url, `Footer: ${name}`))}" style="color:${C.dim}">${name}</a>`).join(' &nbsp;·&nbsp; ')
  const logoHref = href(`${site}/`, 'Logo')

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">
<title>${esc(m(subject))}</title>
<style>
  @media (max-width:620px){ .wrap{width:100%!important} .pad{padding-left:22px!important;padding-right:22px!important} }
  @media (max-width:440px){ .vcell{display:block!important;width:100%!important} }
  a{color:${C.lime}}
</style></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${esc(pre)}${'&#8204;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">
  <tr><td align="center" style="padding:32px 12px">
    <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
      <tr><td align="center" style="padding:8px 0 28px">
        <a href="${esc(logoHref)}"><img src="${logo}" width="240" alt="MarceauxMarceaux" style="display:block;width:240px;height:auto;border:0"></a>
      </td></tr>
      <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${artwork}
          <tr><td class="pad" style="padding:36px 44px 20px">
            ${c.heading ? `<h1 style="margin:0 0 20px;font:800 30px/1.15 ${FONT};color:${C.lime};letter-spacing:-.01em">${esc(m(c.heading))}</h1>` : ''}
            ${markdown(m(c.body), href)}
            ${btnHref ? `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 18px"><tr>
              <td style="background:${C.lime};border-radius:999px">
                <a href="${esc(btnHref)}" style="display:inline-block;padding:14px 28px;font:700 15px/1 ${FONT};color:${C.bg};text-decoration:none;border-radius:999px">${esc(m(c.button.label))}</a>
              </td></tr></table>` : ''}
            ${downloadBlock}
          </td></tr>
          ${rows.length ? `
          <tr><td class="pad" style="padding:6px 38px 22px">
            ${c.videosTitle ? `<div style="padding:0 6px 14px;font:500 11px/1 ${MONO};letter-spacing:.18em;text-transform:uppercase;color:${C.dim}">${esc(c.videosTitle)}</div>` : ''}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>
          </td></tr>` : ''}
        </table>
      </td></tr>
      <tr><td align="center" style="padding:28px 20px 8px;font:12px/1.7 ${FONT};color:${C.dim}">
        ${social} &nbsp;·&nbsp; <a href="${esc(siteHref)}" style="color:${C.dim}">Videos</a>
      </td></tr>
      <tr><td align="center" style="padding:6px 20px 32px;font:11px/1.7 ${FONT};color:#7c756c">
        You're getting this because you're on the ${esc(settings.from_name || 'MarceauxMarceaux')} list.<br>
        ${settings.mailing_address ? esc(settings.mailing_address) + '<br>' : ''}
        <a href="${esc(unsubscribeUrl)}" style="color:#7c756c;text-decoration:underline">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`

  const text = [
    c.heading && m(c.heading),
    markdownText(m(c.body)),
    btnHref ? `${m(c.button.label)}: ${btnHref}` : '',
    dlHref ? `${m(dlLabel)}${c.download.note ? ` (${m(c.download.note)})` : ''}: ${dlHref}` : '',
    c.videos.length ? (c.videosTitle ? c.videosTitle + '\n' : '') + c.videos.map(v => `- ${v.title || v.slug}`).join('\n') + `\nWatch: ${siteHref}` : '',
    '—',
    SOCIAL.map(([name, url]) => `${name}: ${url}`).join('\n'),
    settings.mailing_address || '',
    `Unsubscribe: ${unsubscribeUrl}`,
  ].filter(Boolean).join('\n\n')

  return { subject: m(subject), html, text }
}
