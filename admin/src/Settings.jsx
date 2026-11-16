import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import { Field, useToast } from './ui.jsx'

export default function Settings({ me, onSaved }) {
  const toast = useToast()
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('settings').then(setS).catch(toast) }, [])
  if (!s) return <div className="empty">Loading…</div>
  const set = k => e => setS({ ...s, [k]: e.target.value })
  const save = async e => {
    e.preventDefault(); setBusy(true)
    try { setS(await api('settings', { method: 'PUT', body: s })); toast('Settings saved'); onSaved() }
    catch (err) { toast(err) } finally { setBusy(false) }
  }
  const senderLabel = { api: 'Cloudflare Email Service (API)', binding: 'Cloudflare Email Service (binding)', 'dry-run': 'Dry run: messages are stored, not sent' }[me?.sender] || 'Not connected'

  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p>Who your emails come from and what goes in every footer.</p></div></div>
      <div className="editor" style={{ gridTemplateColumns: 'minmax(340px, 560px) 1fr' }}>
        <form onSubmit={save}>
          <div className="card">
            <h2>Sender</h2>
            <div className="row">
              <Field label="From name"><input className="input" value={s.from_name} onChange={set('from_name')} /></Field>
              <Field label="From address" hint="Must be on your domain set up in Cloudflare Email Service.">
                <input className="input" type="email" value={s.from_email} onChange={set('from_email')} placeholder="news@yourdomain.com" /></Field>
            </div>
            <Field label="Reply-to (optional)" hint="Where replies go. Leave empty to use the From address.">
              <input className="input" type="email" value={s.reply_to} onChange={set('reply_to')} placeholder="you@gmail.com" /></Field>
            <Field label="Mailing address" hint="Required in promotional email by US law (CAN-SPAM). A PO box works.">
              <input className="input" value={s.mailing_address} onChange={set('mailing_address')} placeholder="PO Box 123, Memphis, TN 38104" /></Field>
          </div>
          <div className="card">
            <h2>Testing and links</h2>
            <Field label="Test addresses" hint="Default recipients for “Send test”. Comma separated, up to 5.">
              <input className="input" value={s.test_emails} onChange={set('test_emails')} placeholder="you@example.com" /></Field>
            <Field label="Site URL" hint="Used for images, video links and unsubscribe links. Change it if you add a custom domain.">
              <input className="input" value={s.site_url} onChange={set('site_url')} /></Field>
          </div>
          <div style={{ marginTop: 16 }}><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
        </form>
        <div className="card">
          <h2>Status</h2>
          <dl className="kv" style={{ marginBottom: 18 }}>
            <dt>Sending</dt><dd><span className={`status ${me?.sender === 'api' || me?.sender === 'binding' ? 'sent' : me?.sender ? 'sending' : 'failed'}`}>{senderLabel}</span></dd>
            <dt>Footer</dt><dd><span className={`status ${s.from_email && s.mailing_address ? 'sent' : 'failed'}`}>{s.from_email && s.mailing_address ? 'Ready' : 'Needs From address and mailing address'}</span></dd>
          </dl>
          <div className="label" style={{ marginBottom: 10 }}>Every email includes</div>
          <ul className="steps">
            <li className="done">A personal one-click unsubscribe link and List-Unsubscribe header</li>
            <li className="done">Your mailing address and links to Bandcamp, SoundCloud, Instagram and the videos</li>
            <li className="done">A plain-text version for clients that don't show HTML</li>
          </ul>
          <p className="hint" style={{ marginTop: 16 }}>Cloudflare starts new senders on low limits that rise as you build a sending history. Start with smaller sends.</p>
        </div>
      </div>
    </>
  )
}
