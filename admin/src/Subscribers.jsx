import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fmtDate, n } from './api.js'
import { parseCsv, guessColumns } from './csv.js'
import { Confirm, Field, Modal, useDebounced, useToast } from './ui.jsx'

const PAGE = 50

export default function Subscribers({ stats, onChange }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('subscribed')
  const [tag, setTag] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(new Set())
  const [modal, setModal] = useState(null)
  const dq = useDebounced(q, 250)

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: PAGE, offset })
    if (dq) p.set('q', dq); if (status) p.set('status', status); if (tag) p.set('tag', tag)
    return p
  }, [dq, status, tag, offset])

  const load = useCallback(() => {
    setLoading(true)
    api(`subscribers?${params}`).then(d => { setData(d); setLoading(false) }).catch(e => { toast(e); setLoading(false) })
  }, [params])
  useEffect(load, [load])
  useEffect(() => { setOffset(0); setSel(new Set()) }, [dq, status, tag])

  const changed = () => { load(); onChange(); setSel(new Set()) }
  const allOnPage = data.items.length > 0 && data.items.every(s => sel.has(s.id))
  const toggleAll = () => setSel(allOnPage ? new Set() : new Set(data.items.map(s => s.id)))
  const toggle = id => setSel(s => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x })

  const bulk = async (action, extra = {}) => {
    try {
      const r = await api('subscribers/bulk', { method: 'POST', body: { ids: [...sel], action, ...extra } })
      toast(`${n(r.changed)} updated`); changed()
    } catch (e) { toast(e) }
  }
  const exportHref = `/admin/api/subscribers/export?${new URLSearchParams([...params].filter(([k]) => !['limit', 'offset'].includes(k)))}`

  const c = stats?.counts || {}
  return (
    <>
      <div className="page-head">
        <div><h1>Subscribers</h1><p>Your list. People who unsubscribe stay here as unsubscribed so they're never emailed again.</p></div>
        <div className="actions">
          <a className="btn" href={exportHref}>Export CSV</a>
          <button className="btn" onClick={() => setModal({ kind: 'import' })}>Import CSV</button>
          <button className="btn primary" onClick={() => setModal({ kind: 'add' })}>Add subscribers</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{n(c.subscribed)}</b><span>Subscribed</span></div>
        <div className="stat"><b>{n(c.unsubscribed)}</b><span>Unsubscribed</span></div>
        <div className="stat"><b>{n(c.bounced)}</b><span>Bounced</span></div>
        <div className="stat"><b>{n(stats?.tags?.length)}</b><span>Tags</span></div>
      </div>

      <div className="toolbar">
        <label className="sr-only" htmlFor="sq">Search</label>
        <input id="sq" className="input" placeholder="Search email or name" value={q} onChange={e => setQ(e.target.value)} />
        <select className="select" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          <option value="subscribed">Subscribed</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="bounced">Bounced</option>
          <option value="">All statuses</option>
        </select>
        <select className="select" value={tag} onChange={e => setTag(e.target.value)} aria-label="Tag">
          <option value="">All tags</option>
          {stats?.tags?.map(t => <option key={t.tag} value={t.tag}>{t.tag} ({n(t.n)})</option>)}
        </select>
      </div>

      <div className="table-wrap">
        {data.items.length === 0 && !loading ? (
          <div className="empty">
            {stats?.total ? <><b>No matches</b>Try a different search or filter.</>
              : <><b>No subscribers yet</b>Add people by hand or import a CSV from Bandcamp, Mailchimp or a spreadsheet.</>}
          </div>
        ) : (
          <table className="t">
            <thead><tr>
              <th style={{ width: 36 }}><input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all on this page" /></th>
              <th>Email</th><th>Name</th><th>Tags</th><th>Status</th><th>Added</th><th></th>
            </tr></thead>
            <tbody>
              {data.items.map(s => (
                <tr key={s.id} className={sel.has(s.id) ? 'selected' : ''}>
                  <td><input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.email}`} /></td>
                  <td className="email">{s.email}</td>
                  <td className="muted">{s.name}</td>
                  <td><div className="tags">{s.tags.map(t => <span key={t} className="chip">{t}</span>)}</div></td>
                  <td><span className={`status ${s.status}`}>{s.status}</span></td>
                  <td className="muted" title={s.source ? `Source: ${s.source}` : ''}>{fmtDate(s.created_at)}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn sm ghost" onClick={() => setModal({ kind: 'edit', sub: s })}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data.total > PAGE && (
        <div className="pager">
          <span>{n(offset + 1)}–{n(Math.min(offset + PAGE, data.total))} of {n(data.total)}</span>
          <div className="actions">
            <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
            <button className="btn sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
          </div>
        </div>
      )}

      {sel.size > 0 && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <b>{n(sel.size)} selected</b>
          <button className="btn sm" onClick={() => setModal({ kind: 'tag', mode: 'add_tag' })}>Add tag</button>
          <button className="btn sm" onClick={() => setModal({ kind: 'tag', mode: 'remove_tag' })}>Remove tag</button>
          {status !== 'unsubscribed' && <button className="btn sm" onClick={() => bulk('unsubscribe')}>Unsubscribe</button>}
          <button className="btn sm danger" onClick={() => setModal({ kind: 'delete' })}>Delete</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {modal?.kind === 'add' && <AddModal onClose={() => setModal(null)} onDone={changed} tags={stats?.tags} />}
      {modal?.kind === 'import' && <ImportModal onClose={() => setModal(null)} onDone={changed} tags={stats?.tags} />}
      {modal?.kind === 'edit' && <EditModal sub={modal.sub} onClose={() => setModal(null)} onDone={changed} />}
      {modal?.kind === 'tag' && <TagModal mode={modal.mode} count={sel.size} tags={stats?.tags} onClose={() => setModal(null)} onApply={t => bulk(modal.mode, { tag: t })} />}
      {modal?.kind === 'delete' && (
        <Confirm title={`Delete ${n(sel.size)} subscriber${sel.size === 1 ? '' : 's'}?`} danger confirmLabel="Delete"
          sub="This removes them and their send history for good. To stop emailing someone but remember they opted out, unsubscribe them instead."
          onConfirm={() => bulk('delete')} onClose={() => setModal(null)} />
      )}
    </>
  )
}

function TagInput({ value, onChange, tags, id }) {
  return <>
    <input id={id} className="input" list={`${id}-list`} value={value} onChange={e => onChange(e.target.value)} placeholder="e.g. vip, memphis, sauna" />
    <datalist id={`${id}-list`}>{tags?.map(t => <option key={t.tag} value={t.tag} />)}</datalist>
  </>
}

function AddModal({ onClose, onDone, tags }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [tagStr, setTagStr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false)
  const [res, setRes] = useState(null)
  const count = text.split(/[\n,;]+/).filter(s => s.includes('@')).length
  const submit = async () => {
    setBusy(true)
    try { const r = await api('subscribers', { method: 'POST', body: { emails: text, tags: tagStr, source: 'manual' } }); setRes(r); onDone() }
    catch (e) { toast(e) } finally { setBusy(false) }
  }
  if (res) return <ResultModal res={res} onClose={onClose} />
  return (
    <Modal title="Add subscribers" sub="One per line, or separated by commas. “Name <email>” works too." onClose={onClose} foot={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!count || !ok || busy} onClick={submit}>{busy ? 'Adding…' : `Add ${count || ''}`}</button>
    </>}>
      <Field label="Email addresses"><textarea className="textarea" rows={7} value={text} onChange={e => setText(e.target.value)} placeholder={'fan@example.com\nAlex Doe <alex@example.com>'} /></Field>
      <label className="field"><span>Tags (optional)</span><TagInput id="addtags" value={tagStr} onChange={setTagStr} tags={tags} /></label>
      <label className="check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} />
        <span>These people asked to get MarceauxMarceaux emails.</span></label>
    </Modal>
  )
}

function ResultModal({ res, onClose }) {
  return (
    <Modal title="Done" onClose={onClose} foot={<button className="btn primary" onClick={onClose}>Close</button>}>
      <dl className="kv">
        <dt>Added</dt><dd>{n(res.added)}</dd>
        <dt>Already on the list (tags merged)</dt><dd>{n(res.updated + res.unchanged)}</dd>
        <dt>Not valid</dt><dd>{n(res.invalid.length)}</dd>
      </dl>
      {res.invalid.length > 0 && <div className="sample" style={{ marginTop: 14 }}>{res.invalid.join('\n')}</div>}
      <p className="hint" style={{ marginTop: 14 }}>Anyone already unsubscribed stays unsubscribed.</p>
    </Modal>
  )
}

function ImportModal({ onClose, onDone, tags }) {
  const toast = useToast()
  const fileRef = useRef()
  const [rows, setRows] = useState(null)
  const [fileName, setFileName] = useState('')
  const [map, setMap] = useState(null)
  const [tagStr, setTagStr] = useState('')
  const [ok, setOk] = useState(false)
  const [over, setOver] = useState(false)
  const [prog, setProg] = useState(null)
  const [res, setRes] = useState(null)

  const read = file => {
    if (!file) return
    if (file.size > 20e6) return toast(new Error('That file is over 20 MB.'))
    setFileName(file.name)
    file.text().then(t => {
      const r = parseCsv(t)
      if (!r.length) return toast(new Error('That file looks empty.'))
      const g = guessColumns(r)
      if (g.email < 0) return toast(new Error('Couldn’t find a column of email addresses.'))
      setRows(r); setMap(g)
    })
  }
  const header = rows && map?.hasHeader ? rows[0] : null
  const body = rows ? rows.slice(map?.hasHeader ? 1 : 0) : []
  const cols = rows ? rows[0].map((h, i) => ({ i, label: header ? (h || `Column ${i + 1}`) : `Column ${i + 1}: ${(rows[0][i] || '').slice(0, 24)}` })) : []
  const toRow = r => {
    const name = map.name >= 0 ? r[map.name] : [map.first >= 0 ? r[map.first] : '', map.last >= 0 ? r[map.last] : ''].join(' ')
    return { email: (r[map.email] || '').trim(), name: (name || '').trim(), tags: map.tags >= 0 ? (r[map.tags] || '').replace(/;/g, ',') : '' }
  }
  const start = async () => {
    const all = body.map(toRow).filter(r => r.email)
    const total = { added: 0, updated: 0, unchanged: 0, invalid: [] }
    setProg({ done: 0, total: all.length })
    try {
      for (let i = 0; i < all.length; i += 500) {
        const r = await api('subscribers/import', { method: 'POST', body: { rows: all.slice(i, i + 500), tags: tagStr, source: `import: ${fileName}`.slice(0, 40) } })
        total.added += r.added; total.updated += r.updated; total.unchanged += r.unchanged; total.invalid.push(...r.invalid)
        setProg({ done: Math.min(i + 500, all.length), total: all.length })
      }
      total.invalid = total.invalid.slice(0, 50)
      setRes(total); onDone()
    } catch (e) { toast(e); setProg(null) }
  }
  if (res) return <ResultModal res={res} onClose={onClose} />

  const sel = (key, label, optional = true) => (
    <label className="field"><span>{label}</span>
      <select className="select" value={map[key]} onChange={e => setMap({ ...map, [key]: +e.target.value })}>
        {optional && <option value={-1}>None</option>}
        {cols.map(c => <option key={c.i} value={c.i}>{c.label}</option>)}
      </select>
    </label>
  )
  return (
    <Modal wide title="Import a CSV" sub="Works with exports from Bandcamp, Mailchimp, Squarespace, Google Sheets and most other tools." onClose={prog ? null : onClose} foot={rows && <>
      <button className="btn ghost" onClick={onClose} disabled={!!prog}>Cancel</button>
      <button className="btn primary" disabled={!ok || !!prog || !body.length} onClick={start}>
        {prog ? `Importing ${n(prog.done)} / ${n(prog.total)}…` : `Import ${n(body.length)} rows`}
      </button>
    </>}>
      {!rows ? (
        <div className={`drop ${over ? 'over' : ''}`} onClick={() => fileRef.current.click()} role="button" tabIndex={0}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && fileRef.current.click()}
          onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); read(e.dataTransfer.files[0]) }}>
          <b style={{ color: 'var(--ink)' }}>Drop a .csv file here</b><br />or click to choose one
          <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" hidden onChange={e => read(e.target.files[0])} />
        </div>
      ) : (
        <>
          <p style={{ margin: '0 0 14px' }}><b>{fileName}</b> <span className="muted" style={{ color: 'var(--dim)' }}>· {n(body.length)} rows</span>
            <button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={() => { setRows(null); setMap(null) }}>Choose another</button></p>
          <div className="mapping">
            {sel('email', 'Email column', false)}
            {sel('name', 'Name column')}
            {map.name < 0 && sel('first', 'First name')}
            {map.name < 0 && sel('last', 'Last name')}
            {sel('tags', 'Tags column')}
          </div>
          <div className="label" style={{ marginBottom: 8 }}>Preview</div>
          <div className="sample">{body.slice(0, 6).map(toRow).map((r, i) =>
            <div key={i}>{r.email}{r.name ? ` · ${r.name}` : ''}{r.tags ? ` · [${r.tags}]` : ''}</div>)}</div>
          <label className="field"><span>Add these tags to everyone imported (optional)</span><TagInput id="imptags" value={tagStr} onChange={setTagStr} tags={tags} /></label>
          <label className="check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} />
            <span>Everyone in this file opted in to get MarceauxMarceaux emails. Emailing people who didn't ask hurts deliverability for the whole list.</span></label>
        </>
      )}
    </Modal>
  )
}

function EditModal({ sub, onClose, onDone }) {
  const toast = useToast()
  const [v, setV] = useState({ email: sub.email, name: sub.name, tags: sub.tags.join(', '), status: sub.status })
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState(false)
  const save = async () => {
    setBusy(true)
    try { await api(`subscribers/${sub.id}`, { method: 'PATCH', body: v }); toast('Saved'); onDone(); onClose() }
    catch (e) { toast(e); setBusy(false) }
  }
  if (del) return <Confirm title={`Delete ${sub.email}?`} danger confirmLabel="Delete" sub="This can't be undone. To stop emailing them but keep the record, set them to unsubscribed instead."
    onConfirm={async () => { await api(`subscribers/${sub.id}`, { method: 'DELETE' }); onDone() }} onClose={onClose} />
  return (
    <Modal title="Edit subscriber" sub={`Added ${fmtDate(sub.created_at)}${sub.source ? ` · ${sub.source}` : ''}`} onClose={onClose} foot={<>
      <button className="btn danger ghost" style={{ marginRight: 'auto' }} onClick={() => setDel(true)}>Delete</button>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <Field label="Email"><input className="input" value={v.email} onChange={e => setV({ ...v, email: e.target.value })} /></Field>
      <Field label="Name"><input className="input" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="Tags" hint="Comma separated"><input className="input" value={v.tags} onChange={e => setV({ ...v, tags: e.target.value })} /></Field>
      <Field label="Status" hint={v.status === 'subscribed' && sub.status === 'unsubscribed' ? 'Only re-subscribe someone who asked to be added back.' : null}>
        <select className="select" value={v.status} onChange={e => setV({ ...v, status: e.target.value })}>
          <option value="subscribed">Subscribed</option><option value="unsubscribed">Unsubscribed</option><option value="bounced">Bounced</option>
        </select>
      </Field>
    </Modal>
  )
}

function TagModal({ mode, count, tags, onClose, onApply }) {
  const [t, setT] = useState('')
  return (
    <Modal title={mode === 'add_tag' ? `Tag ${n(count)} subscribers` : `Remove a tag from ${n(count)} subscribers`} onClose={onClose} foot={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!t.trim()} onClick={() => { onApply(t.trim()); onClose() }}>{mode === 'add_tag' ? 'Add tag' : 'Remove tag'}</button>
    </>}>
      <label className="field"><span>Tag</span><TagInput id="bulktag" value={t} onChange={setT} tags={tags} /></label>
    </Modal>
  )
}
