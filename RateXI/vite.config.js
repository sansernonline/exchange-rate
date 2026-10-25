import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { handleLatestRates } from './server/latest-rates.js'

try { process.loadEnvFile() } catch { /* no .env file — use real environment */ }

// Same /api proxy as server/index.js, so `npm run dev` works without a second process
const apiDev = {
  name: 'ratexi-api',
  configureServer(server) {
    server.middlewares.use((req, res, next) =>
      req.url.startsWith('/api/latest/') ? handleLatestRates(req, res) : next())
  },
}

export default defineConfig({
  base: './',
  plugins: [react(), apiDev],
  server: { port: 7100 },
})
