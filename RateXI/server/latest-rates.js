// GET /api/latest/:base — proxies ExchangeRate-API so the key never reaches the browser.
// With EXCHANGERATE_API_KEY set it uses the keyed v6 API, otherwise the free open endpoint.

const CACHE_MS = 60 * 60 * 1000
const cache = new Map() // base → { at, body }

async function fetchLatest(base) {
  const key = process.env.EXCHANGERATE_API_KEY
  const url = key
    ? `https://v6.exchangerate-api.com/v6/${encodeURIComponent(key)}/latest/${base}`
    : `https://open.er-api.com/v6/latest/${base}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  const json = await res.json()
  if (json.result !== 'success') throw new Error(`upstream ${json['error-type'] || res.status}`)
  // keyed API returns conversion_rates, open API returns rates — normalise to one shape
  return { result: 'success', rates: json.rates || json.conversion_rates, time_last_update_utc: json.time_last_update_utc }
}

export async function handleLatestRates(req, res) {
  const base = (req.url.match(/^\/api\/latest\/([A-Za-z]{3})\/?(\?.*)?$/) || [])[1]?.toUpperCase()
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  if (!base) return send(400, { result: 'error', message: 'base must be a 3-letter currency code' })

  const hit = cache.get(base)
  if (hit && Date.now() - hit.at < CACHE_MS) return send(200, hit.body)
  try {
    const body = await fetchLatest(base)
    cache.set(base, { at: Date.now(), body })
    send(200, body)
  } catch (err) {
    console.error('latest rates failed:', base, err.message) // message never contains the key
    send(502, { result: 'error', message: 'rates unavailable' })
  }
}
