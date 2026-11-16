import React, { useEffect, useMemo, useState } from 'react'
import { api, fmtDate, n } from './api.js'
import { useToast } from './ui.jsx'

const pct = (a, b) => (b ? `${Math.round(1000 * a / b) / 10}%` : '—')

export default function Stats({ id }) {
  return id ? <Report id={id} /> : <Overview />
}

function Overview() {
  const toast = useToast()
  const [items, setItems] = useState(null)
  useEffect(() => { api('stats/campaigns').then(d => setItems(d.items)).catch(toast) }, [])
  return (
    <>
      <div className="page-head"><div><h1>Stats</h1><p>Who clicked what in each campaign. Every link in a sent email is tracked per subscriber.</p></div></div>
      <div className="table-wrap">
        {items === null ? <div className="empty">Loading…</div> : items.length === 0 ? (
          <div className="empty"><b>Nothing sent yet</b>Stats show up here once a campaign goes out.</div>
        ) : (
          <table className="t">
            <thead><tr><th>Campaign</th><th>Sent</th><th className="num">Delivered</th><th className="num">Clicked</th><th className="num">Click rate</th><th className="num">Downloaded</th></tr></thead>
            <tbody>{items.map(c => (
              <tr key={c.id} className="clickable" onClick={() => { location.hash = `#/stats/${c.id}` }}>
                <td><a className="rowlink" href={`#/stats/${c.id}`}>{c.subject || 'Untitled'}</a>
                  {c.audience && <> <span className="chip">{c.audience}</span></>}</td>
                <td className="muted">{fmtDate(c.finished_at || c.started_at)}{c.status === 'sending' && <> · <span className="status sending">sending</span></>}</td>
                <td className="num">{n(c.sent_count)}</td>
                <td className="num">{n(c.clickers)}</td>
                <td className="num">{pct(c.clickers, c.sent_count)}</td>
                <td className="num">{n(c.downloaders)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <p className="hint" style={{ marginTop: 14 }}>Some mail security scanners open links to check them, so a few clicks can come from software rather than people.</p>
    </>
  )
}

function Report({ id }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [only, setOnly] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { api(`campaigns/${id}/report`).then(setData).catch(e => { toast(e); location.hash = '#/stats' }) }, [id])
  const people = useMemo(() => {
    if (!data) return []
    const label = only ? data.links.find(l => l.url === only)?.label : ''
    const qq = q.trim().toLowerCase()
    return data.people.filter(p => (!label || p.links.includes(label)) && (!qq || p.email.includes(qq) || (p.name || '').toLowerCase().includes(qq)))
  }, [data, only, q])
  if (!data) return <div className="empty">Loading…</div>
  const { campaign: c, links, clickers } = data
  const top = Math.max(1, ...links.map(l => l.people))
  const downloads = links.filter(l => l.label.includes('Download:')).reduce((s, l) => s + l.people, 0)
  const totalClicks = links.reduce((s, l) => s + l.clicks, 0)

  return (
    <>
      <div className="page-head">
        <div>
          <a href="#/stats" style={{ color: 'var(--dim)', textDecoration: 'none', fontSize: 13 }}>← Stats</a>
          <h1 style={{ marginTop: 6 }}>{c.subject || 'Untitled'}</h1>
          <p>Sent {fmtDate(c.finished_at || c.started_at)} to {c.audience ? `“${c.audience}”` : 'everyone subscribed'} · <a href={`#/campaigns/${c.id}`}>View email</a></p>
        </div>
        <div className="actions"><a className="btn" href={`/admin/api/campaigns/${id}/report.csv`}>Export clicks CSV</a></div>
      </div>

      <div className="stats">
        <div className="stat"><b>{n(c.sent)}</b><span>Delivered</span></div>
        <div className="stat"><b>{n(clickers)}</b><span>People clicked · {pct(clickers, c.sent)}</span></div>
        <div className="stat"><b>{n(totalClicks)}</b><span>Total clicks</span></div>
        <div className="stat"><b>{n(downloads)}</b><span>Downloaded</span></div>
      </div>

      <div className="section-title"><h2>Links</h2>{only && <button className="btn sm ghost" onClick={() => setOnly('')}>Show everyone</button>}</div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Link</th><th style={{ width: '28%' }}></th><th className="num">People</th><th className="num">Clicks</th></tr></thead>
          <tbody>{links.map(l => (
            <tr key={l.url} className={`clickable ${only === l.url ? 'active' : ''}`} onClick={() => setOnly(only === l.url ? '' : l.url)} title="Show who clicked this">
              <td><b style={{ fontWeight: 600 }}>{l.label}</b><span className="linkurl">{l.url}</span></td>
              <td><div className="bar"><i style={{ width: `${100 * l.people / top}%` }} /></div></td>
              <td className="num">{n(l.people)}</td>
              <td className="num">{n(l.clicks)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="section-title">
        <h2>{only ? `Who clicked “${links.find(l => l.url === only)?.label}”` : 'Who clicked'} <span className="saved" style={{ fontWeight: 400 }}>{n(people.length)}</span></h2>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search email or name" value={q} onChange={e => setQ(e.target.value)} aria-label="Search people" />
      </div>
      <div className="table-wrap">
        {people.length === 0 ? <div className="empty">{clickers ? 'No one matches.' : 'No clicks yet.'}</div> : (
          <table className="t">
            <thead><tr><th>Email</th><th>Name</th><th>Clicked</th><th className="num">Clicks</th><th>Last click</th></tr></thead>
            <tbody>{people.map(p => (
              <tr key={p.id}>
                <td className="email">{p.email}</td>
                <td className="muted">{p.name}</td>
                <td><div className="tags">{p.links.map(l => <span key={l} className="chip" style={l.includes('Download:') ? { borderColor: 'var(--lime)' } : null}>{l}</span>)}</div></td>
                <td className="num">{n(p.clicks)}</td>
                <td className="muted">{fmtDate(p.last_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  )
}
