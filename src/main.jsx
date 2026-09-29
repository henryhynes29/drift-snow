import React, { Suspense, lazy, useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/big-shoulders-display/800'
import '@fontsource/big-shoulders-display/900'
import '@fontsource/instrument-sans/400'
import '@fontsource/instrument-sans/500'
import '@fontsource/instrument-sans/600'
import '@fontsource/instrument-sans/700'
import '@fontsource/ibm-plex-mono/500'
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
const appRoute = window.location.pathname !== '/' || ['drive', 'admin', 'ops', 'demo'].some((k) => q.has(k))
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

ReactDOM.createRoot(document.getElementById('root')).render(<Root />)
