import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/big-shoulders-display/800'
import '@fontsource/big-shoulders-display/900'
import '@fontsource/instrument-sans/400'
import '@fontsource/instrument-sans/500'
import '@fontsource/instrument-sans/600'
import '@fontsource/instrument-sans/700'
import '@fontsource/ibm-plex-mono/500'
import App from './App.jsx'
import { AuthProvider } from './lib/auth.jsx'
import { registerServiceWorker } from './lib/alerts.js'

registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <App />
  </AuthProvider>
)
