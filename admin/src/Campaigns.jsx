import React, { useEffect, useState } from 'react'
import { api, fmtDate, n } from './api.js'
import { Confirm, useToast } from './ui.jsx'

export default function Campaigns() {
  const toast = useToast()
  const [items, setItems] = useState(null)
  const [del, setDel] = useState(null)
  const load = () => api('campaigns').then(d => setItems(d.items)).catch(toast)
  useEffect(() => { load() }, [])

  const create = async () => {
    try {
      const c = await api('campaigns', { method: 'POST', body: { subject: '', content: { videosTitle: 'Watch' } } })
      location.hash = `#/campaigns/${c.id}`
    } catch (e) { toast(e) }
  }
  const duplicate = async id => {
    try { const c = await api(`campaigns/${id}/duplicate`, { method: 'POST', body: {} }); location.hash = `#/campaigns/${c.id}` }
    catch (e) { toast(e) }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Campaigns</h1><p>Promos and announcements. Drafts autosave; sent campaigns keep their delivery stats.</p></div>
        <div className="actions"><button className="btn primary" onClick={create}>New campaign</button></div>
      </div>
      <div className="table-wrap">
        {items === null ? <div className="empty">Loading…</div> : items.length === 0 ? (
          <div className="empty"><b>No campaigns yet</b>Start one to announce a release, a gig or a new video.<br /><br />
            <button className="btn primary" onClick={create}>New campaign</button></div>
        ) : (
          <table className="t">
            <thead><tr><th>Subject</th><th>Status</th><th>Audience</th><th className="num">Sent</th><th className="num">Failed</th><th>Date</th><th></th></tr></thead>
            <tbody>{items.map(c => (
              <tr key={c.id}>
                <td><a className="rowlink" href={`#/campaigns/${c.id}`}>{c.subject || <i style={{ color: 'var(--faint)' }}>Untitled</i>}</a></td>
                <td><span className={`status ${c.status}`}>{c.status}</span></td>
                <td className="muted">{c.audience ? <span className="chip">{c.audience}</span> : 'Everyone'}</td>
                <td className="num">{c.status === 'draft' ? '—' : `${n(c.sent_count)} / ${n(c.total)}`}</td>
                <td className="num" style={{ color: c.failed_count ? 'var(--red)' : undefined }}>{c.status === 'draft' ? '—' : n(c.failed_count)}</td>
                <td className="muted">{fmtDate(c.finished_at || c.started_at || c.updated_at)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn sm ghost" onClick={() => duplicate(c.id)}>Duplicate</button>
                  {c.status !== 'sending' && <button className="btn sm ghost danger" onClick={() => setDel(c)}>Delete</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {del && <Confirm title="Delete this campaign?" danger confirmLabel="Delete"
        sub={del.status === 'draft' ? 'The draft will be gone for good.' : 'Its delivery history goes with it. Subscribers are not affected.'}
        onConfirm={async () => { await api(`campaigns/${del.id}`, { method: 'DELETE' }); load() }} onClose={() => setDel(null)} />}
    </>
  )
}
