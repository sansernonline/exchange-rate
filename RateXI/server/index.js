// Production server for Render: serves the Vite build in dist/ and the /api proxy.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleLatestRates } from './latest-rates.js'

try { process.loadEnvFile() } catch { /* no .env file — use real environment */ }

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const PORT = process.env.PORT || 7100
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.webp': 'image/webp',
}

function serveFile(res, file) {
  const headers = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }
  // hashed Vite assets never change, so cache them for a year
  if (file.includes(`${join('dist', 'assets')}`)) headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}

createServer((req, res) => {
  if (req.url.startsWith('/api/latest/')) return handleLatestRates(req, res)
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end() }

  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = normalize(join(DIST, path))
  if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) return serveFile(res, file)
  serveFile(res, join(DIST, 'index.html')) // SPA fallback
}).listen(PORT, () => console.log(`RateXI on http://localhost:${PORT}`))
