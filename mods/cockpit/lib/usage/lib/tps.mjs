// Tokens per second (pure, no I/O): the Débit tab's table and recent streams, from aggregate.json (Claude) and
// codex.json (Codex). A TPS row is [output tokens, ms, streams, {bucket: streams}] with geometric buckets (x1.15), so
// the median and the range are read from the buckets (±7 %); the weighted TPS is exact (all tokens / all time).
// How a stream is timed: lib/core/transcripts.mjs (Claude) and lib/core/codex.mjs (Codex).
const STEP = Math.log(1.15)
const mid = b => Math.exp((Number(b) + 0.5) * STEP)

/** Percentile `q` (0-100) of the per-stream TPS, from the buckets. */
export function tpsPercentile(hist, q) {
  const bs = Object.entries(hist || {}).map(([b, n]) => [Number(b), n]).filter(x => x[1] > 0).sort((a, b) => a[0] - b[0])
  const n = bs.reduce((s, x) => s + x[1], 0)
  if (!n) return undefined
  const want = Math.max(1, Math.ceil((q / 100) * n))
  let seen = 0
  for (const [b, c] of bs) {
    seen += c
    if (seen >= want) return mid(b)
  }
  return mid(bs[bs.length - 1][0])
}

/** Sums TPS rows into one. */
export function mergeTps(rows) {
  const out = [0, 0, 0, {}]
  for (const r of rows) {
    out[0] += r[0]
    out[1] += r[1]
    out[2] += r[2]
    for (const [b, n] of Object.entries(r[3] || {})) out[3][b] = (out[3][b] || 0) + n
  }
  return out
}

/** Weighted TPS, median and range of one row. */
export function tpsStats(row, range = [10, 90]) {
  const [out, ms, n, hist] = row
  return { out, ms, n, weighted: ms > 0 ? out / (ms / 1000) : undefined, median: tpsPercentile(hist, 50), lo: tpsPercentile(hist, range[0]), hi: tpsPercentile(hist, range[1]) }
}

const dayKey = (ms, tzMin) => new Date(ms + tzMin * 60000).toISOString().slice(0, 10)

/**
 * Table rows for the Débit tab: one per source and model (`by: 'model'`) or per source, model and effort
 * (`by: 'effort'`), sorted by output tokens. Claude rows come from aggregate.tps (`model|effort` over the scan's
 * view_days); Codex rows from codex.tps (`day|model|effort`, kept for the last `days` days) when `codex` is given.
 */
export function tpsTable(aggr, codex, { by = 'model', days = 7, now = Date.now(), tzMin = 0, range = [10, 90] } = {}) {
  const groups = {}
  const put = (source, model, effort, row) => {
    const key = by === 'effort' ? `${source}|${model}|${effort || '?'}` : `${source}|${model}`
    ;(groups[key] = groups[key] || { source, model, effort: by === 'effort' ? effort || '?' : '', rows: [] }).rows.push(row)
  }
  for (const [k, row] of Object.entries((aggr && aggr.tps) || {})) {
    const [model, effort] = k.split('|')
    put('claude', model, effort, row)
  }
  if (codex && codex.tps) {
    const from = dayKey(now - (days - 1) * 86400000, tzMin)
    for (const [k, row] of Object.entries(codex.tps)) {
      const [day, model, effort] = k.split('|')
      if (day >= from) put('codex', model, effort, row)
    }
  }
  const rows = Object.values(groups).map(g => ({ source: g.source, model: g.model, effort: g.effort, ...tpsStats(mergeTps(g.rows), range) }))
  return rows.filter(r => r.n > 0).sort((a, b) => (a.source === b.source ? b.out - a.out : a.source === 'claude' ? -1 : 1))
}

/** The most recent streams, Claude and (when given) Codex, newest first. */
export function recentStreams(aggr, codex, n = 12) {
  const xs = [...((aggr && aggr.streams) || []).map(s => ({ ...s, source: 'claude' })), ...((codex && codex.streams) || []).map(s => ({ ...s, source: 'codex' }))]
  return xs.sort((a, b) => b.ts - a.ts).slice(0, n).map(s => ({ ...s, tps: s.out / (s.ms / 1000) }))
}

/** Short model name: the configured alias, else the id without "claude-" and a date suffix. */
export function shortModel(id, aliases = {}) {
  if (aliases[id]) return aliases[id]
  return String(id || '?').replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

/** « 12 s », « 3 min 05 », « 1 h 02 ». */
export function fmtDur(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
}

/** « 48 » / « 7.5 » tokens per second, « ? » when unknown. */
export const fmtTps = x => (x === undefined || !Number.isFinite(x) ? '?' : x >= 10 ? String(Math.round(x)) : x.toFixed(1))
