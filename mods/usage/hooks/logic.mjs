// Pure logic of the usage mod ("Consommation"): views, calibration, burn rates, forecast, scenario fit and the
// Plein régime suggestion. No `$` here: register.tsx draws, node --test checks this file on its own.
import { V, addInto, familyOf, tokensOf, zero } from '../lib/transcripts.mjs'

export const HOUR = 3600000
export const WINDOWS = { seven_day: 168, five_hour: 5 }

export function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice()
  if (!b || typeof b !== 'object') return b === undefined ? a : b
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v)
  return out
}

export const expandHome = (p, home) => String(p || '').replace(/^~(?=[\\/]|$)/, home).replace(/\\/g, '/')

/** The figure the forecast works in: list-price cost or all tokens. */
export const unitsOf = (v, basis) => (!v ? 0 : basis === 'tokens' ? tokensOf(v) : v[V.cost])

/** Units in [from, to), from hourly buckets; a bucket partly inside counts pro rata (flat within its hour). */
export function sumRange(hourly, from, to, basis) {
  let n = 0
  for (const [h, v] of Object.entries(hourly || {})) {
    const start = Number(h)
    const overlap = Math.min(start + HOUR, to) - Math.max(start, from)
    if (overlap > 0) n += (unitsOf(v, basis) * overlap) / HOUR
  }
  return n
}

/** Rate-limit readings from the session (`$.session.usage().rateLimits`) or, failing that, the latest saved sample. */
export function readings(live, samples, now) {
  const out = {}
  for (const r of live || []) {
    const reset = Date.parse(r.resetsAt || '')
    if (r.kind in WINDOWS && Number.isFinite(r.percentUsed)) out[r.kind] = { pct: r.percentUsed, reset: Number.isFinite(reset) ? reset : undefined, at: now, live: true }
  }
  for (const s of [...(samples || [])].reverse()) {
    for (const kind of Object.keys(WINDOWS)) {
      const w = s[kind]
      if (out[kind] || !w || !Number.isFinite(w.pct)) continue
      if (w.reset && w.reset > now) out[kind] = { pct: w.pct, reset: w.reset, at: s.ts, live: false }
    }
  }
  return out
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : undefined
}

/**
 * Units (cost or tokens) per 1 % of each window, from every (time, %, reset) sample: the units counted locally
 * between the window's start (reset minus its length) and the sample, divided by the %. Median over samples.
 * Local transcripts only: work on another machine or in the cloud makes the % move without local tokens.
 */
export function calibrate(samples, hourly, basis, cfg = {}) {
  const minPct = cfg.min_pct ?? 2
  const keep = cfg.max_samples ?? 50
  const out = {}
  for (const [kind, hours] of Object.entries(WINDOWS)) {
    const per = []
    const tok = []
    for (const s of (samples || []).slice(-keep)) {
      const w = s[kind]
      if (!w || !w.reset || !(w.pct >= minPct)) continue
      const from = w.reset - hours * HOUR
      const at = Math.min(s.ts, w.reset)
      const units = sumRange(hourly, from, at, basis)
      const tokens = sumRange(hourly, from, at, 'tokens')
      if (units > 0) per.push(units / w.pct)
      if (tokens > 0) tok.push(tokens / w.pct)
    }
    out[kind] = { unitsPerPct: median(per), tokensPerPct: median(tok), n: per.length }
  }
  return out
}

/** Local midnight (ms) of the day `now` falls in, `tzMin` minutes east of UTC. */
export const midnight = (now, tzMin = 0) => Math.floor((now + tzMin * 60000) / 86400000) * 86400000 - tzMin * 60000

/** Burn in units per hour: recent (last N hours), today (since local midnight), week (last 7 days). */
export function burnRates(hourly, now, tzMin, basis, recentHours = 2) {
  const m = midnight(now, tzMin)
  const sinceMidnight = Math.max((now - m) / HOUR, 0.25)
  return {
    recent: sumRange(hourly, now - recentHours * HOUR, now, basis) / recentHours,
    today: sumRange(hourly, m, now, basis) / sinceMidnight,
    week: sumRange(hourly, now - 168 * HOUR, now, basis) / 168,
  }
}

/**
 * Where a window ends up at a steady pace: { pctPerHour, hoursLeft, exhaustedAt } when it runs out before its
 * reset, else { pctPerHour, hoursLeft, leftAtReset }.
 */
export function forecast(reading, pctPerHour, now) {
  if (!reading || !reading.reset || !Number.isFinite(pctPerHour)) return undefined
  const hoursLeft = Math.max((reading.reset - now) / HOUR, 0)
  const left = Math.max(100 - reading.pct, 0)
  if (pctPerHour > 0 && left / pctPerHour < hoursLeft) return { pctPerHour, hoursLeft, exhaustedAt: now + (left / pctPerHour) * HOUR }
  return { pctPerHour, hoursLeft, leftAtReset: Math.max(left - pctPerHour * hoursLeft, 0) }
}

/** % per hour for a window: units per hour / units per 1 %. */
export const pctRate = (unitsPerHour, unitsPerPct) => (unitsPerPct > 0 ? unitsPerHour / unitsPerPct : undefined)

/** The configured projections (calme / normal / intense …) for one window. */
export function projections(cfg, reading, rates, unitsPerPct, now) {
  return (cfg.projections || []).map(p => {
    const base = p.basis === 'max' ? Math.max(rates.recent, rates.today, rates.week) : rates[p.basis] ?? rates.week
    const pph = pctRate(base * (p.factor ?? 1), unitsPerPct)
    return { id: p.id, label: p.label ?? p.id, pctPerHour: pph, result: forecast(reading, pph, now) }
  })
}

const pad = n => String(n).padStart(2, '0')
/** "ven 16/10 à 14h05" (long) or "ven 14h" (short), in local time, day names from the config. */
export function when(ms, tzMin, labels, short = false) {
  const d = new Date(ms + tzMin * 60000)
  const day = (labels.days || ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])[d.getUTCDay()]
  const hm = `${d.getUTCHours()}h${d.getUTCMinutes() ? pad(d.getUTCMinutes()) : ''}`
  return short ? `${day} ${d.getUTCHours()}h` : `${day} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} à ${hm}`
}

const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`))

/** One sentence for a forecast: "épuisé ven 16/10 à 14h" or "il restera 12 % au reset". */
export function outcome(fc, tzMin, labels, short = false) {
  if (!fc) return ''
  if (fc.exhaustedAt) return fill(labels.exhausted, { when: when(fc.exhaustedAt, tzMin, labels, short) })
  return fill(labels.left_at_reset, { pct: Math.round(fc.leftAtReset) })
}

/** Day keys of a period: today, or the last 7 days ending today. */
export function periodDays(now, tzMin, period) {
  const n = period === 'week' ? 7 : 1
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(midnight(now, tzMin) + tzMin * 60000 - i * 86400000 + 43200000)
    out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`)
  }
  return out
}

/** Totals and breakdowns of a period, each breakdown sorted by the basis, biggest first. */
export function periodView(aggr, now, period, basis) {
  const keys = periodDays(now, aggr.tzMin || 0, period)
  const total = zero()
  const maps = { project: {}, model: {}, kind: {}, surface: {}, skill: {}, mcp: {}, session: {}, effort: {} }
  for (const k of keys) {
    const d = aggr.days && aggr.days[k]
    if (!d) continue
    addInto(total, d.total)
    for (const f of Object.keys(maps)) for (const [x, v] of Object.entries(d[f] || {})) maps[f][x] = addInto(maps[f][x] || zero(), v)
  }
  const sorted = m => Object.entries(m).map(([key, v]) => ({ key, v })).sort((a, b) => unitsOf(b.v, basis) - unitsOf(a.v, basis))
  const out = { days: keys, total }
  for (const f of Object.keys(maps)) out[f] = sorted(maps[f])
  out.perDay = keys.map(k => ({ day: k, v: (aggr.days && aggr.days[k] && aggr.days[k].total) || zero() }))
  return out
}

/** 7 x 24 grid of units per local hour, oldest day first. */
export function heatmap(aggr, now, basis, days = 7) {
  const tz = aggr.tzMin || 0
  const start = midnight(now, tz) - (days - 1) * 86400000
  const grid = Array.from({ length: days }, () => new Array(24).fill(0))
  for (const [h, v] of Object.entries(aggr.hourly || {})) {
    const t = Number(h)
    if (t < start || t > now) continue
    const idx = Math.floor((t - start) / 86400000)
    const hour = new Date(t + tz * 60000).getUTCHours()
    if (grid[idx]) grid[idx][hour] += unitsOf(v, basis)
  }
  return { start, grid }
}

/** One heatmap row as characters, from the config's ramp (" ░▒▓█"). */
export function heatRow(row, max, ramp = ' ░▒▓█') {
  return row.map(x => (max > 0 && x > 0 ? ramp[Math.min(ramp.length - 1, 1 + Math.floor(((ramp.length - 1) * x) / (max * 1.0001)))] : ramp[0])).join('')
}

/** Measured units per active agent-hour, by kind and model family (rates from the aggregate). */
export function measuredRate(aggrRates, kind, family, basis) {
  const pick = pred => {
    const v = zero()
    for (const [k, x] of Object.entries(aggrRates || {})) if (pred(...k.split('|'))) addInto(v, x)
    return v[V.active_s] > 0 ? unitsOf(v, basis) / (v[V.active_s] / 3600) : undefined
  }
  return pick((k, f) => k === kind && f === family) ?? pick((k, f) => f === family) ?? pick(() => true) ?? 0
}

/** A scenario's expected units per hour of work, role by role. */
export function scenarioRate(s, aggrRates, cfg, basis) {
  const e = cfg.scenario_estimate || {}
  let total = 0
  const roles = (s.roles || []).map(r => {
    const kind = (e.unit_kind || {})[r.unit] || 'main'
    const fam = familyOf((e.aliases || {})[r.model] || r.model)
    const per = measuredRate(aggrRates, kind, fam, basis)
    const rate = per * r.max_parallel * ((e.duty || {})[r.unit] ?? 0.5) * ((e.effort_factor || {})[r.effort] ?? 1)
    total += rate
    return { role: r.label || r.role, kind, family: fam, per, rate }
  })
  return { total, roles }
}

/** Which scenarios fit what is left of the week before its reset, at their estimated pace over the active hours. */
export function scenarioFit(scenarios, aggrRates, cfg, basis, reading, unitsPerPct, now) {
  const hoursLeft = reading && reading.reset ? Math.max((reading.reset - now) / HOUR, 0) : undefined
  const activeHours = hoursLeft === undefined ? undefined : (hoursLeft * ((cfg.scenario_estimate || {}).active_hours_per_day ?? 14)) / 24
  const left = reading ? Math.max(100 - reading.pct, 0) : undefined
  const rows = (scenarios || []).map(s => {
    const r = scenarioRate(s, aggrRates, cfg, basis)
    const pph = pctRate(r.total, unitsPerPct)
    const need = pph !== undefined && activeHours !== undefined ? pph * activeHours : undefined
    return { id: s.id, name: s.name, unitsPerHour: r.total, pctPerHour: pph, needPct: need, fits: need !== undefined && left !== undefined ? need <= left : undefined, roles: r.roles }
  })
  const fitting = rows.filter(r => r.fits).sort((a, b) => b.unitsPerHour - a.unitsPerHour)
  return { hoursLeft, activeHours, left, rows, best: fitting[0] && fitting[0].id }
}

/**
 * Plein régime: suggested when the week will still have more than `min_left_pct` % left at its reset (at the
 * current pace; the raw % left without a pace) and the reset is less than `max_hours_left` hours away.
 */
export function pleinRegime(cfg, reading, fc, now) {
  const p = cfg.plein_regime || {}
  if (!reading || !reading.reset) return { suggest: false, why: 'no_reading' }
  const hoursLeft = (reading.reset - now) / HOUR
  const left = fc ? (fc.exhaustedAt ? 0 : fc.leftAtReset) : 100 - reading.pct
  const suggest = hoursLeft > 0 && hoursLeft < (p.max_hours_left ?? 48) && left > (p.min_left_pct ?? 30)
  return { suggest, left, hoursLeft, scenario: p.scenario || 'S5' }
}

/** Ready-to-paste prompt line for a scenario (same shape as the scenarios mod's "prompt" snippet). */
export function promptLine(s, models = {}) {
  const label = m => (models[m] && models[m].label) || m
  const caps = Object.entries(s.caps || {}).map(([k, v]) => `${k.replace(/_/g, ' ')} <= ${v}`)
  return (
    `Scenario ${s.id} "${s.name}": ` +
    (s.roles || []).map(r => `${r.label || r.role} ${label(r.model)} ${r.effort} as ${r.unit} (max ${r.max_parallel})`).join('; ') +
    '. Every Agent and Workflow agent() call names its model.' +
    (caps.length ? ` Caps: ${caps.join(', ')}.` : '')
  )
}

/** The status-line text, from the config's format: "Semaine 34 % · épuisé ven 14h au rythme actuel". */
export function statusText(cfg, reading, fc, tzMin) {
  const l = cfg.labels || {}
  if (!reading) return undefined
  const pace = fc ? `${outcome(fc, tzMin, l, true)} ${l.pace_now || ''}`.trim() : ''
  return fill(cfg.status_format || '{week_label} {week_pct} % · {pace}', { week_label: l.week_label || 'week', week_pct: Math.round(reading.pct), pace })
    .replace(/\s*·\s*$/, '')
}

/** Everything the pane draws, in one object (also used by the CLI report). */
export function model(aggr, cfg, { now, live = [], samples = [], scenarios = [] }) {
  const basis = cfg.basis === 'tokens' ? 'tokens' : 'cost'
  const tz = aggr.tzMin || 0
  const read = readings(live, samples, now)
  const withLive = [...samples]
  if (read.seven_day && read.seven_day.live) withLive.push({ ts: now, seven_day: read.seven_day, five_hour: read.five_hour })
  const cal = calibrate(withLive, aggr.hourly, basis, cfg.calibration)
  const rates = burnRates(aggr.hourly, now, tz, basis, (cfg.rates || {}).recent_hours ?? 2)
  const pace = rates[cfg.current_pace] ?? rates.recent
  const week = read.seven_day && {
    reading: read.seven_day,
    current: forecast(read.seven_day, pctRate(pace, cal.seven_day.unitsPerPct), now),
    byRate: Object.fromEntries(Object.entries(rates).map(([k, r]) => [k, forecast(read.seven_day, pctRate(r, cal.seven_day.unitsPerPct), now)])),
    projections: projections(cfg, read.seven_day, rates, cal.seven_day.unitsPerPct, now),
  }
  const five = read.five_hour && {
    reading: read.five_hour,
    current: forecast(read.five_hour, pctRate(rates.recent, cal.five_hour.unitsPerPct), now),
  }
  const fit = scenarioFit(scenarios, aggr.rates, cfg, basis, read.seven_day, cal.seven_day.unitsPerPct, now)
  const full = pleinRegime(cfg, read.seven_day, week && week.current, now)
  return {
    basis, tz, rates, cal, week, five, fit, full,
    today: periodView(aggr, now, 'today', basis),
    weekView: periodView(aggr, now, 'week', basis),
    heat: heatmap(aggr, now, basis),
    status: statusText(cfg, read.seven_day, week && week.current, tz),
  }
}

export const fmtTokens = n => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} G` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} k` : `${Math.round(n)}`)
export const fmtUsd = n => `${n >= 100 ? Math.round(n) : n.toFixed(2)} $`
export const fmtPct = n => (n === undefined || !Number.isFinite(n) ? '?' : `${n < 10 ? n.toFixed(1) : Math.round(n)} %`)
