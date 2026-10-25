import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// ---------- Data ----------

const CURRENCIES = [
  ['THB', 'Thai Baht', '฿'], ['USD', 'US Dollar', '$'], ['EUR', 'Euro', '€'],
  ['JPY', 'Japanese Yen', '¥'], ['GBP', 'British Pound', '£'],
  ['CNY', 'Chinese Yuan', '¥'], ['SGD', 'Singapore Dollar', 'S$'],
  ['KRW', 'South Korean Won', '₩'], ['HKD', 'Hong Kong Dollar', 'HK$'],
  ['AUD', 'Australian Dollar', 'A$'], ['CHF', 'Swiss Franc', 'Fr'],
  ['CAD', 'Canadian Dollar', 'C$'], ['MYR', 'Malaysian Ringgit', 'RM'],
  ['TWD', 'Taiwan Dollar', 'NT$'], ['VND', 'Vietnamese Dong', '₫'],
  ['IDR', 'Indonesian Rupiah', 'Rp'], ['INR', 'Indian Rupee', '₹'],
  ['PHP', 'Philippine Peso', '₱'], ['NZD', 'New Zealand Dollar', 'NZ$'],
  ['AED', 'UAE Dirham', 'د.إ'], ['SAR', 'Saudi Riyal', '﷼'],
  ['SEK', 'Swedish Krona', 'kr'], ['NOK', 'Norwegian Krone', 'kr'],
  ['DKK', 'Danish Krone', 'kr'], ['PLN', 'Polish Zloty', 'zł'],
  ['CZK', 'Czech Koruna', 'Kč'], ['HUF', 'Hungarian Forint', 'Ft'],
  ['TRY', 'Turkish Lira', '₺'], ['ZAR', 'South African Rand', 'R'],
  ['BRL', 'Brazilian Real', 'R$'], ['MXN', 'Mexican Peso', 'MX$'],
  ['RUB', 'Russian Ruble', '₽'], ['LAK', 'Lao Kip', '₭'],
  ['KHR', 'Cambodian Riel', '៛'], ['MMK', 'Myanmar Kyat', 'K'],
].map(([code, name, symbol]) => ({ code, name, symbol }))


// Offline fallback (USD base) — used only when fetch fails and nothing is cached
const FALLBACK_USD = { USD: 1, THB: 32.75, EUR: 0.863, JPY: 151.9, GBP: 0.752, CNY: 7.12, SGD: 1.301, KRW: 1430, HKD: 7.78, AUD: 1.538, CHF: 0.795, CAD: 1.403, MYR: 4.22 }

const cur = (code) => CURRENCIES.find((c) => c.code === code) ?? { code, name: code, symbol: code }

// ---------- Formatting ----------

const fmtRate = (n) =>
  !isFinite(n) ? '—'
  : n >= 10000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  : n >= 100 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  : n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  : n.toLocaleString('en-US', { maximumFractionDigits: 6 })

const fmtAmount = (n) =>
  !isFinite(n) ? '—'
  : n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 2 : 4 })

const parseAmount = (raw) => parseFloat(raw.replace(/[^0-9.]/g, '')) || 0

function timeAgo(utc) {
  const t = new Date(utc).getTime()
  if (!utc || isNaN(t)) return '—'
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (m < 1) return 'เมื่อสักครู่'
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h} ชั่วโมงที่แล้ว` : `${Math.floor(h / 24)} วันที่แล้ว`
}

const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fmtDateTH = (iso) =>
  iso
    ? new Date(iso + 'T00:00:00').toLocaleDateString('th-TH-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' })
    : ''

// ---------- Latest rates (ExchangeRate-API via our /api proxy, hourly cache) ----------

function useRates(base) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)

  const load = useCallback(async (force = false) => {
    const key = `ratexi:${base}`
    const cached = (() => { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } })()
    if (cached) setData(cached.data)
    if (!force && cached && Date.now() - cached.at < 3600_000) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/latest/${base}`)
      const json = await res.json()
      if (json.result !== 'success') throw new Error()
      const fresh = { rates: json.rates, updated: json.time_last_update_utc, live: true }
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: fresh }))
      setData(fresh)
      setOffline(false)
    } catch {
      if (cached) {
        setData({ ...cached.data, live: false })
      } else {
        const fb = FALLBACK_USD[base]
        const rates = fb
          ? Object.fromEntries(Object.entries(FALLBACK_USD).map(([c, r]) => [c, r / fb]))
          : {}
        setData({ rates, updated: '', live: false })
      }
      setOffline(true)
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { setLoading(true); load() }, [load])
  return { data, loading, offline, reload: () => load(true) }
}

// ---------- Historical rate (Frankfurter/ECB primary, currency-api CDN fallback) ----------

function useHistoricalRate(from, to, date) {
  const [state, setState] = useState({ rate: null, actualDate: '', source: '', loading: false, error: false })

  useEffect(() => {
    if (!date) {
      setState({ rate: null, actualDate: '', source: '', loading: false, error: false })
      return
    }
    let cancelled = false
    setState({ rate: null, actualDate: '', source: '', loading: true, error: false })
    ;(async () => {
      try {
        const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${from}&symbols=${to}`)
        if (!res.ok) throw new Error()
        const json = await res.json()
        const r = json.rates?.[to]
        if (r == null) throw new Error()
        if (!cancelled) setState({ rate: r, actualDate: json.date, source: 'ECB', loading: false, error: false })
      } catch {
        try {
          const res = await fetch(
            `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${from.toLowerCase()}.json`,
          )
          if (!res.ok) throw new Error()
          const json = await res.json()
          const r = json?.[from.toLowerCase()]?.[to.toLowerCase()]
          if (r == null) throw new Error()
          if (!cancelled)
            setState({ rate: r, actualDate: json.date || date, source: 'currency-api', loading: false, error: false })
        } catch {
          if (!cancelled) setState({ rate: null, actualDate: '', source: '', loading: false, error: true })
        }
      }
    })()
    return () => { cancelled = true }
  }, [from, to, date])

  return state
}

// ---------- Inline icons ----------

const Icon = ({ d, className = 'h-4 w-4', style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    {d.map((p, i) => <path key={i} d={p} />)}
  </svg>
)
const ICONS = {
  logo: ['M22 7l-8.5 8.5-5-5L2 17', 'M16 7h6v6'],
  swap: ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16'],
  refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
  alert: ['M12 8v4', 'M12 16h.01', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
  zap: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
  chevron: ['m6 9 6 6 6-6'],
  chevronL: ['m15 18-6-6 6-6'],
  chevronR: ['m9 18 6-6-6-6'],
  check: ['M20 6 9 17l-5-5'],
  copy: ['M10 8h10v12H10z', 'M14 8V4H4v10h4'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16', 'm21 21-4.3-4.3'],
  calendar: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
}

// ---------- Currency dropdown ----------

function CurrencySelect({ value, onChange, accent = 'emerald' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)
  const c = cur(value)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const list = q.trim()
    ? CURRENCIES.filter((x) => (x.code + x.name).toLowerCase().includes(q.trim().toLowerCase()))
    : CURRENCIES

  const dot = accent === 'emerald'
    ? 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30'
    : 'bg-sky-400/15 text-sky-300 ring-sky-400/30'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left transition hover:border-white/20 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-1 ${dot}`}>
          {c.code.slice(0, 2)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-white">{c.code}</span>
          <span className="block truncate text-xs text-white/50">{c.name}</span>
        </span>
        <Icon d={ICONS.chevron} className="h-4 w-4 shrink-0 text-white/40 transition group-hover:text-white/70" />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full min-w-64 rounded-2xl border border-white/10 bg-zinc-900/95 p-2 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
            <Icon d={ICONS.search} className="h-4 w-4 text-white/40" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาสกุลเงิน…"
              className="w-full bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto pr-1">
            {list.length === 0 && <p className="px-2 py-6 text-center text-sm text-white/40">ไม่พบสกุลเงิน</p>}
            {list.map((x) => (
              <button
                key={x.code}
                type="button"
                onClick={() => { onChange(x.code); setOpen(false); setQ('') }}
                className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.06] ${x.code === value ? 'bg-white/[0.06]' : ''}`}
              >
                <span className="flex h-7 w-9 items-center justify-center rounded-md bg-white/[0.06] text-[10px] font-bold text-white/70">{x.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-white">{x.code}</span>
                  <span className="block truncate text-xs text-white/45">{x.name}</span>
                </span>
                {x.code === value && <Icon d={ICONS.check} className="h-4 w-4 text-emerald-400" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Custom calendar date picker ----------

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const TH_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const MIN_VIEW = '1999-01'
const MIN_DATE = '1999-01-04'
const WHEEL_ROW = 32 // px — one row of the month/year wheel
const WHEEL_NOTCH = 50 // wheel deltaY that moves one row (a mouse notch is ~100, trackpads send small steps)

// Clamp to 1999-01 … current month so the wheels never land on a month without data
const clampView = (y, m) => {
  const v = `${y}-${String(m).padStart(2, '0')}`
  const max = todayLocal().slice(0, 7)
  return v > max ? max : v < MIN_VIEW ? MIN_VIEW : v
}

// Typed date: dd/mm/yyyy in ค.ศ.
const fmtDateInput = (iso) => (iso ? iso.split('-').reverse().join('/') : '')
const maskDateInput = (raw) => {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/')
}
const parseDateInput = (text) => {
  const [d, m, y] = text.split('/').map(Number)
  const dt = new Date(y, m - 1, d)
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const valid = String(y).length === 4 && dt.getMonth() === m - 1 && dt.getDate() === d &&
    iso >= MIN_DATE && iso <= todayLocal()
  return valid ? iso : null
}

// Scroll wheel: once scrolling stops, snaps to the nearest row and commits it.
// Snapping is done here, not with CSS scroll-snap — the browser re-snaps on every
// React re-render and the wheel drifts off the selected value.
function Wheel({ items, index, onPick, width, isDisabled = () => false }) {
  const ref = useRef(null)
  const timer = useRef()
  const current = useRef(index)
  const wheelTarget = useRef(null)
  useLayoutEffect(() => { current.current = index; ref.current.scrollTop = index * WHEEL_ROW }, [index])
  useEffect(() => () => clearTimeout(timer.current), [])

  // Mouse wheel: one notch = one row (native scrolling jumps several rows per notch).
  // Needs a non-passive listener to cancel the native scroll; React's onWheel is passive.
  useEffect(() => {
    const el = ref.current
    let acc = 0
    const onWheel = (e) => {
      e.preventDefault()
      acc += e.deltaY
      if (Math.abs(acc) < WHEEL_NOTCH) return
      // step from where the previous notch was heading, not the mid-animation position
      const from = wheelTarget.current ?? Math.round(el.scrollTop / WHEEL_ROW)
      wheelTarget.current = Math.max(0, Math.min(items.length - 1, from + Math.sign(acc)))
      acc = 0
      el.scrollTo({ top: wheelTarget.current * WHEEL_ROW, behavior: 'smooth' })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [items.length])

  const settle = () => ref.current?.scrollTo({ top: current.current * WHEEL_ROW, behavior: 'smooth' })
  const onScroll = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      wheelTarget.current = null
      const i = Math.max(0, Math.min(items.length - 1, Math.round(ref.current.scrollTop / WHEEL_ROW)))
      if (i !== current.current) onPick(i)
      // if the pick was clamped to the same value, index never changes — snap back by hand
      setTimeout(() => { if (ref.current && ref.current.scrollTop !== current.current * WHEEL_ROW) settle() }, 50)
    }, 120)
  }

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className={`h-24 overflow-y-auto py-8 [overflow-anchor:none] [mask-image:linear-gradient(transparent,#000_35%,#000_65%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${width}`}
    >
      {items.map((label, i) => (
        <button
          key={label}
          type="button"
          disabled={isDisabled(i)}
          onClick={() => ref.current.scrollTo({ top: i * WHEEL_ROW, behavior: 'smooth' })}
          className={`block h-8 w-full text-sm tabular-nums ${
            i === index ? 'font-semibold text-white' : isDisabled(i) ? 'cursor-default text-white/15' : 'text-white/45'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function DatePicker({ value, onChange, onInvalid }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const today = todayLocal()
  const [view, setView] = useState((value || today).slice(0, 7))
  const [text, setText] = useState(fmtDateInput(value))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => { setText(fmtDateInput(value)); setInvalid(false) }, [value])
  useEffect(() => { onInvalid?.(invalid) }, [invalid, onInvalid])

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const [y, m] = view.split('-').map(Number)
  const firstDow = new Date(y, m - 1, 1).getDay()
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const firstYear = Number(MIN_VIEW.slice(0, 4))
  const years = Array.from({ length: Number(today.slice(0, 4)) - firstYear + 1 }, (_, i) => String(firstYear + i))

  const canPrev = view > MIN_VIEW
  const canNext = view < today.slice(0, 7)
  const shift = (dir) => {
    const nm = m + dir
    setView(clampView(nm > 12 ? y + 1 : nm < 1 ? y - 1 : y, ((nm - 1 + 12) % 12) + 1))
  }

  const isoOf = (d) => `${view}-${String(d).padStart(2, '0')}`
  const disabled = (d) => { const iso = isoOf(d); return iso > today || iso < MIN_DATE }

  const commitText = () => {
    if (text === fmtDateInput(value)) return
    if (!text) return onChange('')
    const iso = parseDateInput(text)
    if (iso) onChange(iso)
    else setInvalid(true)
  }

  const toggle = (e) => {
    if (e.target.tagName === 'INPUT') return
    setView((value || today).slice(0, 7))
    setOpen((o) => !o)
  }

  return (
    <div ref={ref} className="relative w-full">
      <div
        onClick={toggle}
        className={`group flex w-full cursor-pointer items-center gap-3 rounded-xl border bg-white/[0.04] px-4 py-[15px] transition focus-within:border-violet-400/60 ${
          value ? 'border-violet-400/40' : 'border-white/10 hover:border-white/20'
        }`}
      >
        <Icon d={ICONS.calendar} className={`h-4 w-4 shrink-0 ${value ? 'text-violet-300' : 'text-white/40'}`} />
        <input
          value={text}
          onChange={(e) => { setText(maskDateInput(e.target.value)); setInvalid(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          onBlur={commitText}
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          placeholder="วว/ดด/ปปปป (ค.ศ.)"
          aria-label="วันที่ (วว/ดด/ปปปป)"
          className={`min-w-0 flex-1 cursor-text bg-transparent text-sm tabular-nums placeholder:text-white/35 focus:outline-none ${
            invalid ? 'text-rose-300' : value ? 'font-medium text-white' : 'text-white'
          }`}
        />
        <Icon d={ICONS.chevron} className="h-4 w-4 shrink-0 text-white/40 transition group-hover:text-white/70" />
      </div>

      {open && (
        <div className="absolute z-50 mt-2 w-full min-w-72 rounded-2xl border border-white/10 bg-zinc-900 p-4 shadow-2xl shadow-black/50">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shift(-1)}
              disabled={!canPrev}
              className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
              aria-label="เดือนก่อนหน้า"
            >
              <Icon d={ICONS.chevronL} className="h-4 w-4" />
            </button>
            <div className="relative flex flex-1 justify-center gap-14">
              <div className="pointer-events-none absolute inset-x-2 top-8 h-8 rounded-lg bg-violet-400/[0.12] ring-1 ring-inset ring-violet-400/25" />
              <Wheel
                items={TH_MONTHS}
                index={m - 1}
                width="w-[110px]"
                isDisabled={(i) => clampView(y, i + 1) !== `${y}-${String(i + 1).padStart(2, '0')}`}
                onPick={(i) => setView(clampView(y, i + 1))}
              />
              <Wheel items={years} index={y - firstYear} width="w-[72px]" onPick={(i) => setView(clampView(firstYear + i, m))} />
            </div>
            <button
              type="button"
              onClick={() => shift(1)}
              disabled={!canNext}
              className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
              aria-label="เดือนถัดไป"
            >
              <Icon d={ICONS.chevronR} className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-white/35">
            {TH_DAYS.map((d, i) => (
              <span key={i} className={i === 0 ? 'text-rose-300/60' : ''}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-x-1 gap-y-1.5">
            {cells.map((d, i) =>
              d == null ? (
                <span key={`e${i}`} />
              ) : (
                <button
                  key={d}
                  type="button"
                  disabled={disabled(d)}
                  onClick={() => { onChange(isoOf(d)); setOpen(false) }}
                  className={`flex h-9 items-center justify-center rounded-lg text-xs tabular-nums transition ${
                    isoOf(d) === value
                      ? 'bg-gradient-to-br from-violet-400 to-purple-600 font-bold text-white shadow-lg shadow-violet-500/30'
                      : disabled(d)
                        ? 'cursor-not-allowed text-white/20'
                        : `text-white/70 hover:bg-violet-400/15 hover:text-white ${isoOf(d) === today ? 'ring-1 ring-violet-300/60' : ''}`
                  }`}
                >
                  {d}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- App ----------

export default function App() {
  const [amountRaw, setAmountRaw] = useState('1,000')
  const [from, setFrom] = useState('USD')
  const [to, setTo] = useState('THB')
  const [swaps, setSwaps] = useState(0)
  const [copied, setCopied] = useState(false)
  const { data, loading, offline, reload } = useRates(from)
  const [histDate, setHistDate] = useState('')
  const [dateInvalid, setDateInvalid] = useState(false)
  const hist = useHistoricalRate(from, to, histDate)

  const amount = parseAmount(amountRaw)
  const rate = histDate ? hist.rate : data?.rates?.[to]
  const converted = rate != null ? amount * rate : null
  const resultLoading = histDate ? hist.loading : loading && !data

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07090d] text-white antialiased">
      {/* background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-emerald-500/[0.13] blur-[140px]" />
        <div className="absolute right-[-120px] top-1/3 h-[360px] w-[360px] rounded-full bg-sky-500/[0.09] blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-5 pb-20 pt-5">
        {/* nav */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-500/25">
              <Icon d={ICONS.logo} className="h-5 w-5 text-emerald-950" />
            </div>
            <span className="text-lg font-bold tracking-tight">Rate<span className="text-emerald-400">XI</span></span>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
            histDate
              ? 'border-violet-400/25 bg-violet-400/10 text-violet-300'
              : data?.live
                ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                : 'border-amber-400/25 bg-amber-400/10 text-amber-300'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              histDate ? 'bg-violet-400' : data?.live ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'
            }`} />
            {histDate ? 'HISTORY' : data?.live ? 'LIVE' : 'OFFLINE DATA'}
          </div>
        </header>

        {/* hero */}
        <div className="mt-7 text-center">
          <div className="mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60">
            <Icon d={ICONS.zap} className="h-3.5 w-3.5 text-emerald-400" />
            อัตราแลกเปลี่ยนกลาง (mid-market) · 160+ สกุลเงิน
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            แปลงสกุลเงิน
            <span className="bg-gradient-to-r from-emerald-300 to-teal-400 bg-clip-text text-transparent"> แบบเรียลไทม์</span>
          </h1>
        </div>

        {/* converter card */}
        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.035] p-6 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-8">
          {offline && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-200">
              <Icon d={ICONS.alert} className="h-4 w-4 shrink-0" />
              เครือข่ายมีปัญหา — แสดงอัตราที่บันทึกไว้หรืออัตราโดยประมาณ
            </div>
          )}

          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/45">จำนวนเงิน</label>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 transition focus-within:border-emerald-400/50 focus-within:ring-2 focus-within:ring-emerald-400/20">
            <span className="text-2xl font-semibold text-white/40">{cur(from).symbol}</span>
            <input
              value={amountRaw}
              onChange={(e) => setAmountRaw(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full bg-transparent text-3xl font-bold tabular-nums tracking-tight placeholder:text-white/20 focus:outline-none"
            />
            <span className="shrink-0 rounded-lg bg-white/[0.07] px-2.5 py-1 text-sm font-bold text-white/70">{from}</span>
          </div>

          <div className="mt-6 grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/45">จาก</label>
              <CurrencySelect value={from} onChange={setFrom} accent="emerald" />
            </div>
            <button
              type="button"
              aria-label="สลับสกุลเงิน"
              onClick={() => { setFrom(to); setTo(from); setSwaps((s) => s + 1) }}
              className="mx-auto flex h-11 w-11 items-center sm:mb-[11px] justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 transition hover:scale-105 hover:bg-emerald-400/20 active:scale-95"
            >
              <Icon
                d={ICONS.swap}
                className="h-5 w-5 transition-transform duration-300"
                style={{ transform: `rotate(${swaps * 180}deg)` }}
              />
            </button>
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/45">เป็น</label>
              <CurrencySelect value={to} onChange={setTo} accent="sky" />
            </div>
          </div>

          {/* historical date */}
          <div className="mt-6">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/45">
              ดูอัตราย้อนหลัง
            </label>
            <div className="flex items-stretch gap-2">
              <DatePicker value={histDate} onChange={setHistDate} onInvalid={setDateInvalid} />
              {histDate && (
                <button
                  type="button"
                  onClick={() => setHistDate('')}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-xs text-white/60 transition hover:border-white/25 hover:text-white"
                >
                  <Icon d={ICONS.x} className="h-3.5 w-3.5" />
                  อัตราล่าสุด
                </button>
              )}
            </div>
            {dateInvalid && (
              <p className="mt-1.5 text-[11px] text-rose-300/80">
                วันที่ไม่ถูกต้อง — พิมพ์แบบ วว/ดด/ปปปป ตั้งแต่ 04/01/1999 ถึงวันนี้
              </p>
            )}
            {!dateInvalid && histDate && hist.actualDate && hist.actualDate !== histDate && (
              <p className="mt-1.5 text-[11px] text-white/35">
                วันที่เลือกไม่มีการประกาศอัตรา — แสดงของวันที่ {fmtDateTH(hist.actualDate)} แทน
              </p>
            )}
          </div>

          {/* result */}
          <div className={`mt-7 rounded-2xl border px-6 py-6 text-center ${
            histDate
              ? 'border-violet-400/20 bg-gradient-to-br from-violet-400/[0.09] to-purple-500/[0.04]'
              : 'border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.09] to-teal-500/[0.04]'
          }`}>
            {histDate && hist.error ? (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-amber-200/80">
                <Icon d={ICONS.alert} className="h-4 w-4 shrink-0" />
                ไม่พบอัตราของวันที่ {fmtDateTH(histDate)} สำหรับคู่สกุลเงินนี้
              </div>
            ) : converted != null && !resultLoading ? (
              <div key={`${from}-${to}-${histDate}-${converted.toFixed(6)}`} className="animate-[fadeUp_.35s_ease]">
                {histDate && (
                  <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-0.5 text-[11px] font-medium text-violet-300">
                    อัตราย้อนหลัง · {fmtDateTH(hist.actualDate)} · ที่มา: {hist.source === 'ECB' ? 'ECB (ธนาคารกลางยุโรป)' : 'currency-api'}
                  </p>
                )}
                <p className="text-sm text-white/55">{fmtAmount(amount)} {from} =</p>
                <p className={`mt-1 bg-gradient-to-r bg-clip-text text-4xl font-extrabold tabular-nums tracking-tight text-transparent sm:text-5xl ${
                  histDate ? 'from-violet-200 to-purple-300' : 'from-emerald-200 to-teal-300'
                }`}>
                  {fmtAmount(converted)}<span className="ml-2 text-2xl font-bold">{to}</span>
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const text = fmtAmount(converted).replace(/,/g, '')
                    try {
                      await navigator.clipboard.writeText(text)
                    } catch {
                      const el = document.createElement('textarea')
                      el.value = text
                      document.body.appendChild(el)
                      el.select()
                      document.execCommand('copy')
                      el.remove()
                    }
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                  className={`mx-auto mt-4 flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-medium transition active:scale-95 ${
                    copied
                      ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-300'
                      : 'border-white/15 bg-white/[0.05] text-white/60 hover:border-white/30 hover:text-white'
                  }`}
                >
                  <Icon d={copied ? ICONS.check : ICONS.copy} className="h-3.5 w-3.5" />
                  {copied ? 'คัดลอกแล้ว' : 'คัดลอกยอดเงิน'}
                </button>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs tabular-nums text-white/50">
                  <span>1 {from} = {fmtRate(rate)} {to}</span>
                  <span className="text-white/25">•</span>
                  <span>1 {to} = {fmtRate(1 / rate)} {from}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-white/45">
                <Icon d={ICONS.refresh} className="h-4 w-4 animate-spin" />
                กำลังโหลดอัตราแลกเปลี่ยน…
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-white/40">
            <span>
              {histDate
                ? `อัตราของวันที่ ${fmtDateTH(hist.actualDate || histDate)}`
                : `อัปเดตล่าสุด: ${timeAgo(data?.updated)}`}
            </span>
            <button
              type="button"
              onClick={reload}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition hover:bg-white/[0.06] hover:text-white/70 disabled:opacity-40"
            >
              <Icon d={ICONS.refresh} className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              รีเฟรช
            </button>
          </div>
        </div>

        {/* footer */}
        <footer className="mt-12 border-t border-white/[0.06] pt-6 text-center text-xs leading-relaxed text-white/35">
          <p>
            ข้อมูลจาก{' '}
            <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer" className="text-white/55 underline decoration-white/20 underline-offset-2 transition hover:text-emerald-300">
              ExchangeRate-API
            </a>{' '}
            · อัตรากลางตลาด (mid-market) อัปเดตวันละครั้งบนแผนฟรี
          </p>
          <p className="mt-1">อัตราซื้อขายจริงของธนาคาร/ตู้แลกเงินจะต่างจากนี้ตามสเปรดของแต่ละผู้ให้บริการ</p>
        </footer>
      </div>
    </div>
  )
}
