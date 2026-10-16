// metrics mod: pure formatting for the pane and the scanner's report (sparklines, markers, before/after rows).
// No $ and no I/O: node --test covers it directly.

const SPARK = '▁▂▃▄▅▆▇█'

/** Number with French separators: 1 234,5. */
export function fmtNum(v, digits = 0) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const s = Math.abs(v).toFixed(digits).replace('.', ',')
  const [i, d] = s.split(',')
  const out = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d ? `,${d}` : '')
  return v < 0 ? `-${out}` : out
}

/** Tokens as 12,3 M / 450 K. */
export function fmtTok(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1e9) return `${fmtNum(v / 1e9, 2)} G`
  if (Math.abs(v) >= 1e6) return `${fmtNum(v / 1e6, 1)} M`
  if (Math.abs(v) >= 1e3) return `${fmtNum(v / 1e3, 0)} K`
  return fmtNum(v, 0)
}

/** One metric value as text, by its config entry (format: tokens | usd | pct | number; digits). */
export function fmtMetric(m, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const f = m.format || (m.unit === '%' ? 'pct' : 'number')
  if (f === 'tokens') return fmtTok(v)
  if (f === 'usd') return `${fmtNum(v, m.digits ?? 2)} $`
  if (f === 'pct') return `${fmtNum(v, m.digits ?? 0)} %`
  return `${fmtNum(v, m.digits ?? 1)}${m.unit && m.unit !== '%' ? ` ${m.unit}` : ''}`
}

/** Sparkline: one character per value, scaled 0..max of the series; a missing value is `gap`. */
export function spark(values, chars = SPARK, gap = '·') {
  const xs = (values || []).filter(v => v !== null && v !== undefined && Number.isFinite(v))
  const max = Math.max(0, ...xs)
  const cs = [...chars]
  return (values || []).map(v => {
    if (v === null || v === undefined || !Number.isFinite(v)) return gap
    if (max <= 0) return cs[0]
    return cs[Math.min(cs.length - 1, Math.round((v / max) * (cs.length - 1)))]
  }).join('')
}

/** A row as wide as the sparklines with `mark` at each marker's day. */
export function markerLine(n, markers, mark = '│') {
  const row = Array.from({ length: n }, () => ' ')
  for (const m of markers || []) if (m.day >= 0 && m.day < n) row[m.day] = mark
  return row.join('')
}

/** Markers grouped by day: « 13/10 V5.1–V5.7 · 15/10 V5.8 ». */
export function markerLegend(markers, days) {
  const byDay = new Map()
  for (const m of markers || []) {
    if (!byDay.has(m.day)) byDay.set(m.day, [])
    byDay.get(m.day).push(m.version)
  }
  return [...byDay.entries()].map(([d, vs]) => {
    const key = (days || [])[d] || ''
    const label = key ? `${key.slice(8, 10)}/${key.slice(5, 7)}` : `j${d}`
    return `${label} ${vs.length > 2 ? `${vs[0]}–${vs[vs.length - 1]}` : vs.join(', ')}`
  }).join(' · ')
}

/** Last measured value of a series (or null). */
export const latest = values => {
  for (let i = (values || []).length - 1; i >= 0; i--) if (values[i] !== null && values[i] !== undefined && Number.isFinite(values[i])) return values[i]
  return null
}

/**
 * Before/after rows for one version against the previous one: label, both values as text, an arrow and whether the
 * change is better / worse / flat by the metric's `better` (up | down | none) and the config's `flat_pct`.
 */
export function metricRows(cfg, prev, cur) {
  const flat = cfg.flat_pct ?? 10
  return (cfg.metrics || []).filter(m => m.show !== false).map(m => {
    const a = prev && prev.values ? prev.values[m.id] : null
    const b = cur && cur.values ? cur.values[m.id] : null
    let arrow = ''
    let verdict = 'none'
    if (Number.isFinite(a) && Number.isFinite(b) && a !== null && b !== null) {
      const base = Math.max(Math.abs(a), 1e-9)
      const pct = ((b - a) / base) * 100
      arrow = Math.abs(pct) < flat ? '=' : b > a ? '↑' : '↓'
      if (m.better === 'up' || m.better === 'down') verdict = arrow === '=' ? 'flat' : (arrow === '↑') === (m.better === 'up') ? 'better' : 'worse'
    }
    const target = m.target === undefined ? '' : fmtMetric(m, m.target)
    return { id: m.id, label: m.label || m.id, before: fmtMetric(m, a), after: fmtMetric(m, b), arrow, verdict, target }
  })
}

/** Index of the version to show: the one named `want` (V5.8), else the latest. */
export function pickVersion(versions, want) {
  const vs = versions || []
  const i = want ? vs.findIndex(v => v.version.toLowerCase() === String(want).toLowerCase()) : -1
  return i >= 0 ? i : vs.length - 1
}

/** Deep merge of config objects (arrays and scalars of `b` replace). */
export function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice()
  if (!b || typeof b !== 'object') return b === undefined ? a : b
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v)
  return out
}

/** `~` to the home folder, forward slashes. */
export const expandHome = (p, home) => String(p || '').replace(/^~(?=[\\/]|$)/, home).replace(/\\/g, '/')

/** `{name}` placeholders from `vars`. */
export const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])))

/** Local time as dd/mm hh:mm for a UTC ms and a zone offset in minutes. */
export function when(ms, tzMin = 0) {
  if (!ms) return '—'
  const d = new Date(ms + tzMin * 60000)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** A window length: « 36 h » under two days, else « 2,5 j ». */
export const duration = h => (h >= 48 ? `${fmtNum(h / 24, 1)} j` : `${fmtNum(h, 0)} h`)
