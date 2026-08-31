import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import { applyAppearance, initialAppearance } from './hooks/use-theme.js'
import './index.css'

// Before the first render, not during it. React would paint the light palette
// and then correct it, and that flash is the thing dark mode users complain
// about most - it is a white screen at night.
applyAppearance(initialAppearance())

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
