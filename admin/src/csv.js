// Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF), plus header detection.
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', q = false
  const s = text.replace(/^﻿/, '')
  // Delimiter: whichever of , ; tab appears most in the first line
  const first = s.split(/\r?\n/, 1)[0] || ''
  const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0]
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += ch
    } else if (ch === '"') q = true
    else if (ch === delim) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(c => c.trim() !== '')) rows.push(row)
  return rows
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

// Guess which columns hold email, name (or first/last) and tags
export function guessColumns(rows) {
  const head = (rows[0] || []).map(h => h.trim().toLowerCase())
  const hasHeader = head.length && !head.some(h => EMAIL.test(h))
  const find = re => head.findIndex(h => re.test(h))
  let email = hasHeader ? find(/e-?mail/) : -1
  if (email < 0) {
    // the column with the most email-looking values
    const sample = rows.slice(hasHeader ? 1 : 0, 50)
    let best = -1, bestN = 0
    for (let c = 0; c < (rows[0] || []).length; c++) {
      const k = sample.filter(r => EMAIL.test((r[c] || '').trim())).length
      if (k > bestN) { best = c; bestN = k }
    }
    email = best
  }
  return {
    hasHeader,
    email,
    name: hasHeader ? find(/^(full ?name|name|display ?name)$/) : -1,
    first: hasHeader ? find(/first/) : -1,
    last: hasHeader ? find(/last|surname/) : -1,
    tags: hasHeader ? find(/^(tags?|labels?|groups?|lists?)$/) : -1,
  }
}
