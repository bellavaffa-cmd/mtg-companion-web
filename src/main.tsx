import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import './responsive.css'
import App from './App.tsx'

// Keeps the app's files on the device so it opens offline and can be installed (pwa/sw.template.js).
// Built sites only: the dev server serves fresh files on every change.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Not supported here (a private window, say): the app works the same, just not offline.
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
