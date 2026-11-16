// Turns a campaign into the email HTML and plain text that go out.
// Everything inlined and table-based so it holds up in Gmail, Apple Mail and Outlook.
const C = { bg: '#110f0d', card: '#191613', ink: '#f1ece4', dim: '#a39c92', lime: '#c6ff00', line: '#2b2621' }
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const MONO = "'IBM Plex Mono', Menlo, Consolas, monospace"

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const safeUrl = u => {
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

// Small Markdown subset: # / ## headings, paragraphs, - lists, **bold**, *italic*, [links](url), bare URLs
function inline(s) {
  let out = esc(s)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
    const url = safeUrl(u.replace(/&amp;/g, '&'))
    return url ? `<a href="${esc(url)}" style="color:${C.lime};text-decoration:underline">${t}</a>` : t
  })
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, u) =>
    `${pre}<a href="${u}" style="color:${C.lime};text-decoration:underline">${u.replace(/^https?:\/\//, '')}</a>`)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  return out
}
export function markdown(src) {
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
      return `<h${lvl + 1} style="margin:28px 0 12px;font:700 ${lvl === 1 ? 24 : 19}px/1.25 ${FONT};color:${C.ink}">${inline(b.replace(/^#{1,2}\s+/, ''))}</h${lvl + 1}>`
    }
    const lines = b.split('\n')
    if (lines.every(l => /^\s*[-*]\s+/.test(l))) {
      return `<ul style="margin:0 0 18px;padding-left:22px">${lines.map(l =>
        `<li style="margin:0 0 6px;font:16px/1.6 ${FONT};color:${C.ink}">${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`
    }
    return `<p style="${p}">${lines.map(inline).join('<br>')}</p>`
  }).join('\n')
}
function markdownText(src) {
  return String(src || '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^#{1,2}\s+/gm, '').trim()
}

export function parseContent(raw) {
  let c = {}
  try { c = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}) } catch { c = {} }
  return {
    preheader: String(c.preheader || ''),
    heading: String(c.heading || ''),
    image: String(c.image || ''),
    body: String(c.body || ''),
    button: { label: String(c.button?.label || ''), url: String(c.button?.url || '') },
    videos: Array.isArray(c.videos) ? c.videos.filter(v => v && v.slug).slice(0, 12).map(v => ({ slug: String(v.slug), title: String(v.title || '') })) : [],
    videosTitle: String(c.videosTitle || ''),
  }
}

// sub: { email, name, token }   settings: from getSettings()
export function renderEmail({ subject, content, settings, sub, unsubscribeUrl }) {
  const c = parseContent(content)
  const site = (settings.site_url || '').replace(/\/+$/, '')
  const m = s => merge(s, sub)
  const pre = m(c.preheader)
  const logo = `${site}/assets/email/logo.png`

  const videoCells = c.videos.map(v => `
      <td class="vcell" width="50%" valign="top" style="padding:0 6px 14px">
        <a href="${esc(site)}/" style="text-decoration:none;display:block">
          <img src="${esc(site)}/media/${encodeURIComponent(v.slug)}/thumb.jpg" width="258" alt="${esc(v.title)}" style="display:block;width:100%;max-width:258px;height:auto;border:0;border-radius:4px">
          ${v.title ? `<div style="padding-top:8px;font:12px/1.4 ${MONO};letter-spacing:.04em;color:${C.dim}">${esc(v.title)}</div>` : ''}
        </a>
      </td>`)
  const rows = []
  for (let i = 0; i < videoCells.length; i += 2) rows.push(`<tr>${videoCells[i]}${videoCells[i + 1] || '<td width="50%" style="padding:0 6px"></td>'}</tr>`)

  const btnUrl = safeUrl(c.button.url)
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
        <a href="${esc(site)}/"><img src="${logo}" width="240" alt="MarceauxMarceaux" style="display:block;width:240px;height:auto;border:0"></a>
      </td></tr>
      <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:8px">
        ${c.image && safeUrl(c.image) ? `<img src="${esc(safeUrl(c.image))}" width="600" alt="" style="display:block;width:100%;height:auto;border:0;border-radius:8px 8px 0 0">` : ''}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td class="pad" style="padding:36px 44px 20px">
            ${c.heading ? `<h1 style="margin:0 0 20px;font:800 30px/1.15 ${FONT};color:${C.lime};letter-spacing:-.01em">${esc(m(c.heading))}</h1>` : ''}
            ${markdown(m(c.body))}
            ${btnUrl && c.button.label ? `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 18px"><tr>
              <td style="background:${C.lime};border-radius:999px">
                <a href="${esc(btnUrl)}" style="display:inline-block;padding:14px 28px;font:700 15px/1 ${FONT};color:${C.bg};text-decoration:none;border-radius:999px">${esc(m(c.button.label))}</a>
              </td></tr></table>` : ''}
          </td></tr>
          ${rows.length ? `
          <tr><td class="pad" style="padding:6px 38px 22px">
            ${c.videosTitle ? `<div style="padding:0 6px 14px;font:500 11px/1 ${MONO};letter-spacing:.18em;text-transform:uppercase;color:${C.dim}">${esc(c.videosTitle)}</div>` : ''}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>
          </td></tr>` : ''}
        </table>
      </td></tr>
      <tr><td align="center" style="padding:28px 20px 8px;font:12px/1.7 ${FONT};color:${C.dim}">
        <a href="https://marceauxmarceaux.bandcamp.com/" style="color:${C.dim}">Bandcamp</a> &nbsp;·&nbsp;
        <a href="https://soundcloud.com/marceauxmarceaux" style="color:${C.dim}">SoundCloud</a> &nbsp;·&nbsp;
        <a href="https://www.instagram.com/marceauxmusic" style="color:${C.dim}">Instagram</a> &nbsp;·&nbsp;
        <a href="${esc(site)}/" style="color:${C.dim}">Videos</a>
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
    btnUrl && c.button.label ? `${m(c.button.label)}: ${btnUrl}` : '',
    c.videos.length ? (c.videosTitle ? c.videosTitle + '\n' : '') + c.videos.map(v => `- ${v.title || v.slug}`).join('\n') + `\nWatch: ${site}/` : '',
    '—',
    'Bandcamp: https://marceauxmarceaux.bandcamp.com/\nSoundCloud: https://soundcloud.com/marceauxmarceaux\nInstagram: https://www.instagram.com/marceauxmusic',
    settings.mailing_address || '',
    `Unsubscribe: ${unsubscribeUrl}`,
  ].filter(Boolean).join('\n\n')

  return { subject: m(subject), html, text }
}
