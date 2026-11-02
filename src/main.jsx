import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'

import './styles/tokens.css'
import './styles/base.css'

// iOS Safari only applies :active styles when a touchstart listener exists
// somewhere above the element. One passive no-op turns on every press state.
document.addEventListener('touchstart', () => {}, { passive: true })

// Cookie-free visitor statistics (Plausible) — only when a domain is set in
// Netlify's environment variables (VITE_PLAUSIBLE_DOMAIN=lospikir.com).
// No cookies, so no consent banner is needed. See /privacy.
const plausible = import.meta.env.VITE_PLAUSIBLE_DOMAIN
if (plausible) {
  const s = document.createElement('script')
  s.defer = true
  s.dataset.domain = plausible
  s.src = 'https://plausible.io/js/script.js'
  document.head.appendChild(s)
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
