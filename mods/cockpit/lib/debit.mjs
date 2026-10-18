// cockpit « Débit » - tokens per second per model, as Codex's « tokens per second » table (Julian, 18 Oct): one card per
// model in use, rows = windows (30 min, 1 j, 7 j, 30 j), columns Réponses · Tokens · Temps · TPS pondéré · Médiane ·
// Plage, then the last streams. Pure: no $, no I/O (node --test mods/cockpit/tests/debit.test.mjs).
// Where the figures come from: the usage mod's scanner (lib/core/transcripts.mjs) times every API response of the
// transcripts, counted once under message.id + requestId: from the last line that sent it (the prompt or the tool
// result) to its last content block, so the time includes the wait for the first token; output tokens include
// thinking; streams under 50 output tokens or over 30 min are left out. It writes debit.json: TPS rows per
// `hour|model|effort` ([output, ms, streams, {bucket: streams}], buckets x1.15) and every stream of the last hour.
// Codex (codex.json, lib/core/codex.mjs): the same rule, rows per `day|model|effort`, the newest streams per file.
// So: 30 min = exact streams; 1 j, 7 j, 30 j = whole clock hours (Codex: whole local days), median and range read in
// the buckets (±7 %); the weighted TPS (all tokens / all time) is exact everywhere.
import { mergeTps, tpsPercentile } from './usage/lib/tps.mjs'

const MIN = 60000
const HOUR = 3600000
const DAY = 86400000

export const DEBIT_DEFAULTS = {
  // rows of each card: minutes or hours back from now; exact: computed from the streams themselves
  windows: [
    { id: '30m', label: '30 min', minutes: 30, exact: true },
    { id: '1d', label: '1 j', hours: 24 },
    { id: '7d', label: '7 j', hours: 168 },
    { id: '30d', label: '30 j', hours: 720 },
  ],
  // the window whose median colours the last streams (green at or above it, grey under)
  ref_window: '1d',
  recent: 10,
  cards_max: 8,
  // short model names: { "<model id>": "<name>" }; otherwise claude-opus-5-5 -> opus 5.5
  aliases: {},
}

/** claude-opus-5-5-20261001 -> « opus 5.5 », gpt-5-codex -> « gpt-5-codex » (or the alias). */
export function modelLabel(id, aliases = {}) {
  const raw = String(id || '?')
  if (aliases && aliases[raw]) return aliases[raw]
  const s = raw.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  if (aliases && aliases[s]) return aliases[s]
  let m = s.match(/^([a-z]+)-(\d+)-(\d+)$/)
  if (m) return `${m[1]} ${m[2]}.${m[3]}`
  m = s.match(/^([a-z]+)-(\d+)$/)
  if (m && !/^gpt/.test(m[1])) return `${m[1]} ${m[2]}`
  return s
}

const median = (xs) => {
  if (!xs.length) return undefined
  const a = xs.slice().sort((x, y) => x - y)
  const i = Math.floor(a.length / 2)
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2
}

/** Exact figures of a list of streams [{ out, ms }]: { n, out, ms, weighted, median, lo (min), hi (max) }. */
export function streamStats(list) {
  const xs = (list || []).filter((s) => s && s.ms > 0)
  const out = xs.reduce((a, s) => a + s.out, 0)
  const ms = xs.reduce((a, s) => a + s.ms, 0)
  const tps = xs.map((s) => s.out / (s.ms / 1000))
  return { n: xs.length, out, ms, weighted: ms > 0 ? out / (ms / 1000) : undefined, median: median(tps), lo: tps.length ? Math.min(...tps) : undefined, hi: tps.length ? Math.max(...tps) : undefined, exact: true }
}

/** Figures of TPS rows [out, ms, n, hist] merged: the weighted TPS exact, median / min / max read in the buckets. */
export function rowStats(rows) {
  const [out, ms, n, hist] = mergeTps(rows || [])
  return { n, out, ms, weighted: ms > 0 ? out / (ms / 1000) : undefined, median: tpsPercentile(hist, 50), lo: tpsPercentile(hist, 0), hi: tpsPercentile(hist, 100), exact: false }
}

const dayKey = (ms, tzMin) => new Date(ms + tzMin * MIN).toISOString().slice(0, 10)
const spanOf = (w) => (Number(w.minutes) || 0) * MIN + (Number(w.hours) || 0) * HOUR

/**
 * The section's model. debit: usage's debit.json; codex: usage's codex.json (read only when showCodex, the Codex
 * toggle of « Toutes les conversations »); now in ms. ->
 * { ready, cards: [{ key, source, label, rows: [{ id, label, n, out, ms, weighted, median, lo, hi, exact }], ref }],
 *   streams: [{ ts, source, label, effort, out, ms, tps, fast }], summary, codex: 'off' | 'read' | 'unread' }
 * Cards: one per source and model with at least one stream in the longest window, by output tokens over it.
 */
export function debitModel({ debit, codex, showCodex, now }, cfg = {}) {
  const c = { ...DEBIT_DEFAULTS, ...((cfg && cfg.panel && cfg.panel.debit) || {}) }
  const wins = (c.windows || []).filter((w) => spanOf(w) > 0)
  const longest = wins.reduce((a, w) => Math.max(a, spanOf(w)), 0)
  const tzMin = (debit && Number.isFinite(debit.tzMin) ? debit.tzMin : 0)
  const groups = new Map()
  const group = (source, model) => {
    const label = (source === 'codex' ? 'Codex ' : '') + modelLabel(model, c.aliases)
    const key = source + '|' + label
    if (!groups.has(key)) groups.set(key, { key, source, label, hourly: [], streams: [] })
    return groups.get(key)
  }
  // Claude: the hourly rows and the last hour's exact streams
  if (debit && debit.hourly) {
    for (const [k, row] of Object.entries(debit.hourly)) {
      const [h, model] = k.split('|')
      const hour = Number(h)
      if (!(hour >= Math.floor((now - longest) / HOUR) * HOUR) || hour > now) continue
      group('claude', model).hourly.push({ t: hour, row })
    }
    for (const s of debit.recent || []) group('claude', s.model).streams.push(s)
  }
  // Codex: day rows (a row's time is its local day) and the newest streams of each file
  const codexState = !showCodex ? 'off' : codex && codex.tps ? 'read' : 'unread'
  if (codexState === 'read') {
    for (const [k, row] of Object.entries(codex.tps)) {
      const [day, model] = k.split('|')
      group('codex', model).hourly.push({ day, row })
    }
    for (const s of codex.streams || []) group('codex', s.model).streams.push(s)
  }
  const cards = []
  for (const g of groups.values()) {
    const rows = wins.map((w) => {
      const span = spanOf(w)
      let st
      if (w.exact) st = streamStats(g.streams.filter((s) => s.ts > now - span && s.ts <= now))
      else if (g.source === 'codex') {
        const from = dayKey(now - (Math.max(1, Math.ceil(span / DAY)) - 1) * DAY, tzMin)
        st = rowStats(g.hourly.filter((x) => x.day >= from && x.day <= dayKey(now, tzMin)).map((x) => x.row))
      } else {
        const from = Math.floor((now - span) / HOUR) * HOUR
        st = rowStats(g.hourly.filter((x) => x.t >= from).map((x) => x.row))
      }
      return { id: w.id, label: w.label || w.id, ...st }
    })
    const all = rows.reduce((a, r) => (r.n > a.n || (r.n === a.n && r.out > a.out) ? r : a), { n: 0, out: 0 })
    if (!all.n) continue
    const ref = (rows.find((r) => r.id === c.ref_window && r.n) || rows.find((r) => r.n) || {}).median
    cards.push({ key: g.key, source: g.source, label: g.label, rows, ref, total: all.out })
  }
  cards.sort((a, b) => (a.source === b.source ? b.total - a.total : a.source === 'claude' ? -1 : 1))
  const shown = cards.slice(0, Math.max(1, Number(c.cards_max) || 8))
  // the last streams, newest first: Claude's recent and newest ones (deduplicated), Codex's when shown
  const seen = new Set()
  const pool = []
  const add = (source, s) => {
    const k = `${source}|${s.ts}|${s.model}|${s.out}|${s.ms}`
    if (seen.has(k) || !(s.ms > 0) || s.ts > now) return
    seen.add(k)
    pool.push({ ...s, source })
  }
  for (const s of (debit && debit.recent) || []) add('claude', s)
  for (const s of (debit && debit.streams) || []) add('claude', s)
  if (codexState === 'read') for (const s of codex.streams || []) add('codex', s)
  const refOf = new Map(cards.map((k) => [k.key, k.ref]))
  const streams = pool.sort((a, b) => b.ts - a.ts).slice(0, Math.max(1, Number(c.recent) || 10)).map((s) => {
    const label = (s.source === 'codex' ? 'Codex ' : '') + modelLabel(s.model, c.aliases)
    const tps = s.out / (s.ms / 1000)
    const ref = refOf.get(s.source + '|' + label)
    return { ts: s.ts, source: s.source, label, effort: s.effort || '', out: s.out, ms: s.ms, tps, fast: Number.isFinite(ref) && tps >= ref }
  })
  const pick = (k) => k.rows.find((r) => r.id === c.ref_window && r.n) || k.rows.find((r) => r.n)
  const summary = shown.slice(0, 3).map((k) => `${k.label} ${tpsText(pick(k).weighted)} TPS`).join(' · ')
  return { ready: Boolean(debit), cards: shown, hidden: cards.length - shown.length, streams, summary, codex: codexState, windows: wins }
}

/** « 59.1 », « 120 », « ? ». */
export const tpsText = (x) => (x === undefined || x === null || !Number.isFinite(x) ? '?' : x >= 100 ? String(Math.round(x)) : x.toFixed(1))

/** Tokens: « 640 », « 3.8K », « 468K », « 2.4M ». */
export function tokText(n) {
  const x = Math.round(Number(n) || 0)
  if (x < 1000) return String(x)
  if (x < 10000) return `${(x / 1000).toFixed(1)}K`
  if (x < 1e6) return `${Math.round(x / 1000)}K`
  return `${(x / 1e6).toFixed(1)}M`
}

/** A stream's time: « 2.89 s », « 12.3 s », then « 1m 05s ». */
export function secText(ms) {
  const s = (Number(ms) || 0) / 1000
  if (s < 10) return `${s.toFixed(2)} s`
  if (s < 60) return `${s.toFixed(1)} s`
  const t = Math.round(s)
  return t < 3600 ? `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s` : `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}m`
}

/** « HH:MM:SS » of a time, local clock. */
export function clockText(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * Which columns fit `width` cells. cols: [{ id, w }] in order; drop: the ids to leave out first, in order (Plage then
 * Temps). The window label keeps labelW. -> the kept columns.
 */
export function fitColumns(cols, width, labelW, drop = ['range', 'time']) {
  let kept = cols.slice()
  const need = (xs) => labelW + xs.reduce((a, x) => a + x.w + 1, 0)
  for (const id of drop) {
    if (need(kept) <= width) break
    kept = kept.filter((x) => x.id !== id)
  }
  return kept
}
