import React, { useEffect, useState, useCallback } from 'react'
import { api, n } from './api.js'
import { ToastProvider } from './ui.jsx'
import Subscribers from './Subscribers.jsx'
import Campaigns from './Campaigns.jsx'
import CampaignEditor from './CampaignEditor.jsx'
import Settings from './Settings.jsx'
import Stats from './Stats.jsx'

// Hash routes: #/campaigns, #/campaigns/12, #/subscribers, #/settings
function useRoute() {
  const get = () => (location.hash.replace(/^#\/?/, '') || 'campaigns').split('/')
  const [r, setR] = useState(get)
  useEffect(() => { const f = () => setR(get()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return r
}

export default function App() {
  const [section, id] = useRoute()
  const [me, setMe] = useState(null)
  const [stats, setStats] = useState(null)
  const [fatal, setFatal] = useState('')
  const refresh = useCallback(() => {
    api('me').then(setMe).catch(e => setFatal(e.message))
    api('stats').then(setStats).catch(() => {})
  }, [])
  useEffect(refresh, [refresh])
  useEffect(() => { window.scrollTo(0, 0) }, [section, id])

  if (fatal) return <div className="main"><div className="notice err"><p>{fatal}</p></div></div>

  const nav = [
    ['campaigns', 'Campaigns', null],
    ['subscribers', 'Subscribers', stats ? n(stats.counts.subscribed) : ''],
    ['stats', 'Stats', null],
    ['settings', 'Settings', null],
  ]
  return (
    <ToastProvider>
      <div className="shell">
        <aside className="side">
          <a className="brand" href="#/campaigns"><img src="/assets/logo.svg" alt="MarceauxMarceaux" /><small>Mail</small></a>
          <nav className="nav" aria-label="Sections">
            {nav.map(([k, label, count]) => (
              <a key={k} href={`#/${k}`} aria-current={section === k ? 'page' : undefined}>{label}{count !== null && <span className="count">{count}</span>}</a>
            ))}
          </nav>
          {me && <div className="who">Signed in as {me.user}</div>}
        </aside>
        <main className="main">
          {me && (!me.sender || !me.ready) && section !== 'settings' && (
            <div className="notice warn"><p>
              {!me.sender ? 'Sending is not connected yet, so test and send buttons won’t work. ' : ''}
              {!me.ready ? 'Add your From address and mailing address in ' : ''}
              {!me.ready && <a href="#/settings">Settings</a>}{!me.ready ? '.' : ''}
              {!me.sender && me.ready ? <>See <a href="#/settings">Settings</a> for setup.</> : ''}
            </p></div>
          )}
          {section === 'subscribers' && <Subscribers stats={stats} onChange={refresh} />}
          {section === 'campaigns' && !id && <Campaigns />}
          {section === 'campaigns' && id && <CampaignEditor id={+id} stats={stats} me={me} />}
          {section === 'stats' && <Stats id={id ? +id : null} />}
          {section === 'settings' && <Settings me={me} onSaved={refresh} />}
        </main>
      </div>
    </ToastProvider>
  )
}
