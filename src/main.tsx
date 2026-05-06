import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AppProvider } from './AppContext.tsx'
import { ToasterProvider } from './components/Toaster.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToasterProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ToasterProvider>
    </BrowserRouter>
  </StrictMode>,
)
