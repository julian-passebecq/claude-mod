// Local daily history of the usage mod (pure part, no I/O): one record per day, kept in <data_dir>/history.json after
// the transcripts are gone. Claude Code deletes transcripts after `cleanupPeriodDays` (30 by default) and the scanner
// keeps only `retention_days`, so without this file nothing older than a month could be shown.
// A day is (re)written only while the scanner still sees all of it: from the first full day of the retention window to
// today. Inside that window a recomputed day replaces the saved one when it is recent (trust_days), when the counting
// rule changed (HISTORY_VERSION) or when it is not smaller; an older day that shrank lost transcripts to the cleanup,
// so the saved figures stay.
import { addInto, tokensOf, zero } from './transcripts.mjs'

/** Counting rule of the saved days: bump it when the way tokens are counted changes. 2 = message.id + requestId. */
export const HISTORY_VERSION = 2
const DAY = 86400000
const round = v => v.map((x, i) => (i === 7 ? Math.round(x * 10000) / 10000 : Math.round(x)))
const roundMap = m => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, round(v)]))

/** Local day key (YYYY-MM-DD) of a time, `tzMin` minutes east of UTC. */
const dayOf = (ms, tzMin) => new Date(ms + tzMin * 60000).toISOString().slice(0, 10)
/** Start (ms) of a local day key. */
export const dayStart = (key, tzMin = 0) => Date.parse(`${key}T00:00:00Z`) - tzMin * 60000

/**
 * Merges the per-day breakdowns of `aggregate()` (computed over the whole retention window) into a saved history.
 * Returns the new history { v, updated, days: { day: { total, model, project, kind, v } } }.
 */
export function mergeHistory(hist, aggrDays, { now, tzMin = 0, retentionDays = 31, trustDays = 25, keepDays = 0 } = {}) {
  const out = { v: HISTORY_VERSION, updated: now, days: { ...((hist && hist.days) || {}) } }
  const firstFull = dayOf(now - retentionDays * DAY, tzMin) // partly outside the window: never written
  const trustFrom = dayOf(now - trustDays * DAY, tzMin)
  for (const [day, d] of Object.entries(aggrDays || {})) {
    if (day <= firstFull) continue
    const rec = { total: round(d.total), model: roundMap(d.model), project: roundMap(d.project), kind: roundMap(d.kind), v: HISTORY_VERSION }
    const old = out.days[day]
    if (!old || old.v !== HISTORY_VERSION || day >= trustFrom || tokensOf(rec.total) >= tokensOf(old.total)) out.days[day] = rec
  }
  if (keepDays > 0) {
    const from = dayOf(now - keepDays * DAY, tzMin)
    for (const day of Object.keys(out.days)) if (day < from) delete out.days[day]
  }
  return out
}

const bump = (map, key, v) => addInto((map[key] = map[key] || zero()), v)
const sorted = m => Object.entries(m).map(([key, v]) => ({ key, v })).sort((a, b) => tokensOf(b.v) - tokensOf(a.v))

/** Monday (local) of a day key, as a day key. */
function weekOf(key) {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/**
 * What the Historique tab draws for one preset ({ days } or { days: 0 } for everything): the total, buckets per day,
 * week or month (the finest that fits in `maxRows`), and per-model / per-project totals. Days without data count as 0.
 */
export function historyView(hist, { now, tzMin = 0, days = 90, maxRows = 16 } = {}) {
  const all = Object.keys((hist && hist.days) || {}).sort()
  const first = all[0]
  const from = days > 0 ? dayOf(now - (days - 1) * DAY, tzMin) : first
  const keys = all.filter(k => !from || k >= from)
  const total = zero()
  const model = {}
  const project = {}
  const span = from ? Math.round((dayStart(dayOf(now, tzMin)) - dayStart(from)) / DAY) + 1 : 0
  const unit = span <= maxRows ? 'day' : span <= maxRows * 7 ? 'week' : 'month'
  const bucketOf = k => (unit === 'day' ? k : unit === 'week' ? weekOf(k) : k.slice(0, 7))
  const buckets = {}
  for (const k of keys) {
    const d = hist.days[k]
    addInto(total, d.total)
    for (const [m, v] of Object.entries(d.model || {})) bump(model, m, v)
    for (const [p, v] of Object.entries(d.project || {})) bump(project, p, v)
    bump(buckets, bucketOf(k), d.total)
  }
  return {
    first, from, span, unit, n: keys.length, total,
    buckets: Object.entries(buckets).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, v]) => ({ key, v })),
    model: sorted(model), project: sorted(project),
  }
}
