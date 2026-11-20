import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api, fmtDate, loadVideos, n } from './api.js'
import { Confirm, Field, Modal, useDebounced, useToast } from './ui.jsx'
import UploadButton, { fileName } from './Upload.jsx'

const sleep = ms => new Promise(r => setTimeout(r, ms))

export default function CampaignEditor({ id, stats, me }) {
  const toast = useToast()
  const [camp, setCamp] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saveState, setSaveState] = useState('saved')
  const [modal, setModal] = useState(null)
  const [sending, setSending] = useState(null)   // { running, progress, error }
  const loaded = useRef(false)

  const load = useCallback(() => api(`campaigns/${id}`).then(c => {
    setCamp(c); setDraft({ subject: c.subject, audience: c.audience, content: c.content }); loaded.current = true
    return c
  }).catch(e => { toast(e); location.hash = '#/campaigns' }), [id])
  useEffect(() => { load().then(c => { if (c?.status === 'sending') setSending({ running: false, progress: null }) }) }, [load])

  // Autosave drafts
  const debounced = useDebounced(draft, 700)
  useEffect(() => {
    if (!debounced || !camp || camp.status !== 'draft' || !loaded.current) return
    if (JSON.stringify(debounced) === JSON.stringify({ subject: camp.subject, audience: camp.audience, content: camp.content })) return
    setSaveState('saving')
    api(`campaigns/${id}`, { method: 'PUT', body: debounced })
      .then(c => { setCamp(c); setSaveState('saved') }).catch(e => { setSaveState('error'); toast(e) })
  }, [debounced])
  useEffect(() => { if (draft && camp && saveState === 'saved' && JSON.stringify(draft) !== JSON.stringify({ subject: camp.subject, audience: camp.audience, content: camp.content })) setSaveState('dirty') }, [draft])

  // Sending loop: the browser drives batches of ~20 until the queue is empty
  const runRef = useRef(false)
  const runSend = useCallback(async () => {
    runRef.current = true
    setSending(s => ({ ...s, running: true, error: null }))
    while (runRef.current) {
      let p
      try { p = await api(`campaigns/${id}/batch`, { method: 'POST', body: {} }) }
      catch (e) { setSending(s => ({ ...s, running: false, error: e.message })); runRef.current = false; break }
      setSending(s => ({ ...s, progress: p }))
      if (p.error) { setSending(s => ({ ...s, running: false, error: p.error })); runRef.current = false; break }
      if (p.done || p.status !== 'sending') { runRef.current = false; setSending(s => ({ ...s, running: false })); load(); break }
      if (p.backoff) await sleep(p.backoff * 1000)
    }
  }, [id])
  useEffect(() => () => { runRef.current = false }, [])
  useEffect(() => {
    const warn = e => { if (runRef.current) { e.preventDefault(); e.returnValue = '' } }
    addEventListener('beforeunload', warn); return () => removeEventListener('beforeunload', warn)
  }, [])

  if (!camp || !draft) return <div className="empty">Loading…</div>
  const editable = camp.status === 'draft'
  const c = draft.content
  const setC = patch => setDraft(d => ({ ...d, content: { ...d.content, ...patch } }))
  const audienceCount = draft.audience ? (stats?.tags?.find(t => t.tag === draft.audience)?.n || 0) : (stats?.counts?.subscribed || 0)

  return (
    <>
      <div className="page-head">
        <div>
          <a href="#/campaigns" style={{ color: 'var(--dim)', textDecoration: 'none', fontSize: 13 }}>← Campaigns</a>
          <h1 style={{ marginTop: 6 }}>{draft.subject || 'Untitled campaign'}</h1>
          <p><span className={`status ${camp.status}`}>{camp.status}</span>
            {editable && <span className="saved" style={{ marginLeft: 12 }}>{{ saved: 'Saved', saving: 'Saving…', dirty: 'Editing…', error: 'Not saved' }[saveState]}</span>}
            {camp.finished_at && <span className="saved" style={{ marginLeft: 12 }}>Sent {fmtDate(camp.finished_at)}</span>}</p>
        </div>
        {editable && (
          <div className="actions">
            <button className="btn" disabled={!me?.sender} onClick={() => setModal('test')}>Send test</button>
            <button className="btn primary" disabled={!me?.sender || !me?.ready || !draft.subject.trim() || !audienceCount || saveState !== 'saved'}
              onClick={() => setModal('send')}>Send to {n(audienceCount)}</button>
          </div>
        )}
      </div>

      {sending && <SendPanel sending={sending} camp={camp} onResume={runSend} onPause={() => { runRef.current = false }} />}
      {!editable && !sending && <SentPanel camp={camp} onRetry={async () => {
        try { await api(`campaigns/${id}/retry`, { method: 'POST', body: {} }); await load(); setSending({ running: false, progress: null }); runSend() } catch (e) { toast(e) }
      }} />}

      <div className="editor">
        <div>
          <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="card">
              <Field label="Subject"><input className="input" value={draft.subject} maxLength={300} onChange={e => setDraft({ ...draft, subject: e.target.value })} placeholder="New video: Bloghaus" /></Field>
              <Field label="Preview text" hint="The grey line after the subject in most inboxes.">
                <input className="input" value={c.preheader} onChange={e => setC({ preheader: e.target.value })} placeholder="Fresh out of the studio, plus a few edits I've been playing out" /></Field>
              <Field label="Send to">
                <select className="select" value={draft.audience} onChange={e => setDraft({ ...draft, audience: e.target.value })}>
                  <option value="">Everyone subscribed ({n(stats?.counts?.subscribed)})</option>
                  {stats?.tags?.map(t => <option key={t.tag} value={t.tag}>Tagged “{t.tag}” ({n(t.n)})</option>)}
                </select>
              </Field>
            </div>
            <div className="card">
              <h2>Artwork <span className="saved" style={{ fontWeight: 400 }}>optional</span></h2>
              <div className="art-row">
                {c.artwork.url ? <img className="art-thumb" src={c.artwork.url} alt="" /> : <div className="art-thumb empty">No art</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Field label="Image" hint="Square album art works best. JPG, PNG or WebP; shown up to 360 px wide.">
                    <div className="inline">
                      <input className="input" value={c.artwork.url} onChange={e => setC({ artwork: { ...c.artwork, url: e.target.value } })} placeholder="https://… or upload" />
                      <UploadButton kind="artwork" accept="image/jpeg,image/png,image/gif,image/webp" onDone={r => setC({ artwork: { ...c.artwork, url: r.url } })} />
                    </div>
                  </Field>
                  <Field label="Links to (optional)" hint="Where a click on the art goes, like the release on Bandcamp.">
                    <input className="input" value={c.artwork.link} onChange={e => setC({ artwork: { ...c.artwork, link: e.target.value } })} placeholder="https://marceauxmarceaux.bandcamp.com/album/…" /></Field>
                  <Field label="Description (for screen readers)">
                    <input className="input" value={c.artwork.alt} onChange={e => setC({ artwork: { ...c.artwork, alt: e.target.value } })} placeholder="Bloghaus cover art" /></Field>
                </div>
              </div>
            </div>
            <div className="card">
              <h2>Message</h2>
              <Field label="Heading"><input className="input" value={c.heading} onChange={e => setC({ heading: e.target.value })} placeholder="Hey {{name|there}}," /></Field>
              <Field label="Body"><textarea className="textarea body" value={c.body} onChange={e => setC({ body: e.target.value })}
                placeholder={'New one out today.\n\n**Bloghaus** is up on Bandcamp, and the video is on the site.\n\n- Friday: SAUNA Memphis\n- Saturday: New Orleans'} /></Field>
              <p className="hint">Blank line = new paragraph. <code>**bold**</code> <code>*italic*</code> <code>[text](https://…)</code> <code>- list</code> <code>## heading</code> · Personalize with <code>{'{{name|there}}'}</code></p>
              <div className="row">
                <Field label="Button label"><input className="input" value={c.button.label} onChange={e => setC({ button: { ...c.button, label: e.target.value } })} placeholder="Listen on Bandcamp" /></Field>
                <Field label="Button link"><input className="input" value={c.button.url} onChange={e => setC({ button: { ...c.button, url: e.target.value } })} placeholder="https://marceauxmarceaux.bandcamp.com/…" /></Field>
              </div>
            </div>
            <div className="card">
              <h2>Listen <span className="saved" style={{ fontWeight: 400 }}>optional</span></h2>
              <div className="row">
                <Field label="SoundCloud link"><input className="input" value={c.listen.url} onChange={e => setC({ listen: { ...c.listen, url: e.target.value } })} placeholder="https://soundcloud.com/marceauxmarceaux/…" /></Field>
                <Field label="Button label"><input className="input" value={c.listen.label} onChange={e => setC({ listen: { ...c.listen, label: e.target.value } })} placeholder="Listen on SoundCloud" /></Field>
              </div>
            </div>
            <div className="card">
              <h2>Download <span className="saved" style={{ fontWeight: 400 }}>optional</span></h2>
              <Field label="File (optional)" hint="Upload up to 95 MB, or paste a Dropbox, Google Drive or Bandcamp code link for bigger files.">
                <div className="inline">
                  <input className="input" value={c.download.url} onChange={e => setC({ download: { ...c.download, url: e.target.value } })} placeholder="https://… or upload" />
                  <UploadButton kind="download" onDone={r => setC({ download: { ...c.download, url: r.url, label: c.download.label || 'Download' } })} />
                </div>
                {c.download.url && fileName(c.download.url) && <small>File: {fileName(c.download.url)}</small>}
              </Field>
              <div className="row">
                <Field label="Button label"><input className="input" value={c.download.label} onChange={e => setC({ download: { ...c.download, label: e.target.value } })} placeholder="Download Bloghaus (WAV)" /></Field>
              </div>
              <div className="row">
                <Field label="Ramble link (optional)" hint="Adds a second button so DJs can grab it on Ramble.">
                  <input className="input" value={c.download.ramble} onChange={e => setC({ download: { ...c.download, ramble: e.target.value } })} placeholder="https://theramble.co/…" /></Field>
                <Field label="Ramble button label"><input className="input" value={c.download.rambleLabel} onChange={e => setC({ download: { ...c.download, rambleLabel: e.target.value } })} placeholder="Download on Ramble" /></Field>
              </div>
              <Field label="Note (optional)"><input className="input" value={c.download.note} onChange={e => setC({ download: { ...c.download, note: e.target.value } })} placeholder="Free for DJs. Please don't share the file." /></Field>
            </div>
            <VideoPicker value={c.videos} title={c.videosTitle} onChange={(videos) => setC({ videos })} onTitle={t => setC({ videosTitle: t })} />
          </fieldset>
        </div>
        <Preview subject={draft.subject} content={c} />
      </div>

      {modal === 'test' && <TestModal id={id} onClose={() => setModal(null)} />}
      {modal === 'send' && (
        <Confirm title={`Send to ${n(audienceCount)} ${audienceCount === 1 ? 'person' : 'people'}?`} confirmLabel="Send now"
          sub="This can't be undone. Keep this tab open while it sends; you can pause and resume."
          onConfirm={async () => { const p = await api(`campaigns/${id}/start`, { method: 'POST', body: {} }); await load(); setSending({ running: false, progress: p }); runSend() }}
          onClose={() => setModal(null)}>
          <dl className="kv">
            <dt>Subject</dt><dd>{draft.subject}</dd>
            <dt>Audience</dt><dd>{draft.audience ? `Tagged “${draft.audience}”` : 'Everyone subscribed'}</dd>
          </dl>
        </Confirm>
      )}
    </>
  )
}

function SendPanel({ sending, camp, onPause, onResume }) {
  const p = sending.progress || { total: camp.total, sent: camp.sent_count, failed: camp.failed_count, queued: camp.total - camp.sent_count - camp.failed_count }
  const done = (p.sent || 0) + (p.failed || 0) + (p.skipped || 0)
  const pct = p.total ? Math.round(100 * done / p.total) : 0
  const finished = p.done || camp.status === 'sent'
  return (
    <div className={`notice ${sending.error ? 'err' : finished ? 'ok' : ''}`} style={{ display: 'block' }}>
      <div className="split" style={{ marginTop: 0, marginBottom: 10, color: 'var(--ink)' }}>
        <b>{finished ? 'Sent' : sending.running ? 'Sending…' : 'Paused'}</b>
        <span>{n(p.sent)} sent{p.failed ? ` · ${n(p.failed)} failed` : ''}{p.skipped ? ` · ${n(p.skipped)} skipped` : ''} · {n(p.total)} total</span>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
      {sending.error && <p style={{ marginTop: 10 }}>{sending.error}</p>}
      {!finished && (
        <div className="split">
          <span>{sending.running ? 'Keep this tab open until it finishes.' : 'Nothing is lost while paused. Unsent messages stay queued.'}</span>
          {sending.running ? <button className="btn sm" onClick={onPause}>Pause</button> : <button className="btn sm primary" onClick={onResume}>Resume sending</button>}
        </div>
      )}
    </div>
  )
}

function SentPanel({ camp, onRetry }) {
  const [fails, setFails] = useState(null)
  useEffect(() => { if (camp.failed_count) api(`campaigns/${camp.id}/failures`).then(d => setFails(d.items)).catch(() => {}) }, [camp.id, camp.failed_count])
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="stats" style={{ marginBottom: camp.failed_count ? 16 : 0 }}>
        <div className="stat"><b>{n(camp.sent_count)}</b><span>Sent</span></div>
        <div className="stat"><b>{n(camp.failed_count)}</b><span>Failed</span></div>
        <div className="stat"><b>{n(camp.total)}</b><span>Audience</span></div>
      </div>
      <a className="btn sm" href={`#/stats/${camp.id}`} style={{ marginBottom: camp.failed_count ? 14 : 0 }}>See who clicked what</a>
      {camp.failed_count > 0 && <>
        <div className="sample">{fails ? fails.map(f => `${f.email}: ${f.error}`).join('\n') : 'Loading…'}</div>
        <button className="btn sm" onClick={onRetry}>Retry failed</button>
      </>}
    </div>
  )
}

function Preview({ subject, content }) {
  const [html, setHtml] = useState('')
  const [mode, setMode] = useState('desktop')
  const dSubject = useDebounced(subject, 350)
  const dContent = useDebounced(content, 350)
  useEffect(() => {
    let live = true
    api('preview', { method: 'POST', body: { subject: dSubject, content: dContent } }).then(r => { if (live) setHtml(r.html) }).catch(() => {})
    return () => { live = false }
  }, [dSubject, JSON.stringify(dContent)])
  return (
    <div className="preview">
      <div className="preview-bar">
        <div className="meta"><b>{subject || 'No subject'}</b><span>{content.preheader || 'No preview text'}</span></div>
        <div className="seg" role="group" aria-label="Preview width">
          <button aria-pressed={mode === 'desktop'} onClick={() => setMode('desktop')}>Desktop</button>
          <button aria-pressed={mode === 'mobile'} onClick={() => setMode('mobile')}>Phone</button>
        </div>
      </div>
      <div className={`frame-wrap ${mode}`}><iframe title="Email preview" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" /></div>
    </div>
  )
}

function VideoPicker({ value, title, onChange, onTitle }) {
  const [videos, setVideos] = useState([])
  useEffect(() => { loadVideos().then(setVideos) }, [])
  const picked = new Map(value.map((v, i) => [v.slug, i + 1]))
  const toggle = v => picked.has(v.slug) ? onChange(value.filter(x => x.slug !== v.slug)) : onChange([...value, { slug: v.slug, title: v.title }])
  return (
    <div className="card">
      <h2>Videos <span className="saved" style={{ fontWeight: 400 }}>{value.length ? `${value.length} picked` : 'optional'}</span></h2>
      <Field label="Section label"><input className="input" value={title} onChange={e => onTitle(e.target.value)} placeholder="Watch" /></Field>
      <div className="vgrid">
        {videos.map(v => (
          <button key={v.slug} type="button" className="vpick" aria-pressed={picked.has(v.slug)} data-n={picked.get(v.slug) || ''} onClick={() => toggle(v)} title={v.title}>
            <img src={`/media/${v.media || v.slug}/thumb.jpg`} alt="" loading="lazy" /><span>{v.title}</span>
          </button>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>Thumbnails link to the video site. Picked order is the order in the email.</p>
    </div>
  )
}

function TestModal({ id, onClose }) {
  const toast = useToast()
  const [emails, setEmails] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('settings').then(s => setEmails(s.test_emails)).catch(() => {}) }, [])
  const send = async () => {
    setBusy(true)
    try { const r = await api(`campaigns/${id}/test`, { method: 'POST', body: { emails } }); toast(`Test sent to ${r.sent.join(', ')}`); onClose() }
    catch (e) { toast(e); setBusy(false) }
  }
  return (
    <Modal title="Send a test" sub="Goes out with “[Test]” in the subject. Up to 5 addresses." onClose={onClose} foot={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!emails.trim() || busy} onClick={send}>{busy ? 'Sending…' : 'Send test'}</button>
    </>}>
      <Field label="Send to" hint="Separate addresses with commas. Save defaults in Settings."><input className="input" value={emails} onChange={e => setEmails(e.target.value)} placeholder="you@example.com" /></Field>
    </Modal>
  )
}
