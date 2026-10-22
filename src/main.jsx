import React, { Suspense, lazy, useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import Landing from './Landing.jsx'

// Speed: first-time visitors on the homepage only download the landing page.
// The full app (maps, payments, accounts) loads when they tap "Get started" —
// and is quietly prefetched once the page is idle, so that tap feels instant.
const loadApp = () => import('./AppRoot.jsx')
const AppRoot = lazy(loadApp)
const LegalReader = lazy(() => import('./LegalDocs.jsx').then((m) => ({ default: m.LegalReader })))

function hasSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return true
    }
  } catch { /* private mode */ }
  return false
}
const q = new URLSearchParams(window.location.search)
// Remember which link brought this visitor (?ref=hermantown-moms) — saved to their profile at sign-up.
try {
  const ref = (q.get('ref') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40)
  if (ref && !localStorage.getItem('drift.ref')) localStorage.setItem('drift.ref', ref)
} catch { /* private mode */ }
// A link from a sign-in / password-reset email carries tokens in the URL — open the app for those too.
const authLink = /access_token=|type=recovery|error_description=/.test(window.location.hash) || q.has('code')
const appRoute = window.location.pathname !== '/' || authLink || ['drive', 'admin', 'ops', 'demo', 'reset', 'job', 'offer', 'route', 'go', 'rebook'].some((k) => q.has(k))
const startInApp = appRoute || hasSession()

const Blank = () => <div style={{ minHeight: '100vh', background: '#07090D' }} />

function Root() {
  const [inApp, setInApp] = useState(startInApp)
  const [legal, setLegal] = useState(null)
  useEffect(() => {
    if (inApp) return
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 2500))
    const id = idle(() => { loadApp(); import('./lib/alerts.js').then((m) => m.registerServiceWorker()) }, { timeout: 5000 })
    return () => { try { (window.cancelIdleCallback || clearTimeout)(id) } catch { /* ignore */ } }
  }, [inApp])
  if (inApp) return <Suspense fallback={<Blank />}><AppRoot startEntered={!startInApp} /></Suspense>
  return (
    <>
      <Landing onStart={() => { window.scrollTo(0, 0); setInApp(true) }} onLegal={setLegal} />
      {legal && <Suspense fallback={null}><LegalReader docId={legal} onClose={() => setLegal(null)} /></Suspense>}
    </>
  )
}

// The homepage HTML is pre-rendered at build time — hydrate it instead of redrawing.
const container = document.getElementById('root')
if (!startInApp && container.firstElementChild) ReactDOM.hydrateRoot(container, <Root />)
else { container.innerHTML = ''; ReactDOM.createRoot(container).render(<Root />) }
