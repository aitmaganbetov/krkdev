import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { i18nReady } from './i18n'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

// Казахский и английский словари загружаются отдельно — отрисовка ждёт выбранный язык
i18nReady.finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
})
