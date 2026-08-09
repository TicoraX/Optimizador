import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fuentes self-hosted: la app corre offline, un @import a Google Fonts no
// resuelve y ademas bloqueaba el render con dos round-trips externos.
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
