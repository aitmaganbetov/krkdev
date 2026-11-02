import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import locales from './vite-plugin-locales.js'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), locales()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        // X-Forwarded-Host/Proto: адрес сайта для ссылок в QR-кодах документов (services/request_meta.py)
        xfwd: true,
      },
    },
  },
})
