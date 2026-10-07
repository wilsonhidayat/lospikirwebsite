import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'

import './styles/tokens.css'
import './styles/base.css'

// iOS Safari only applies :active styles when a touchstart listener exists
// somewhere above the element. One passive no-op turns on every press state.
document.addEventListener('touchstart', () => {}, { passive: true })

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
