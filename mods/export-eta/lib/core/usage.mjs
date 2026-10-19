// Canonical copy: lib/core/usage.mjs (repo root). Every mods/<mod>/lib/core/usage.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// Quota windows (5 h and week) for Claude and Codex, from what the usage mod already saved in its data folder
// (~/.claude/usage-mod): samples.jsonl (Claude: {ts, five_hour: {pct, reset}, seven_day: {pct, reset}}) and
// codex.json (Codex: limits.primary / limits.secondary {pct, windowMin, reset}). Never calls an API.
// runOut() is a straight-line estimate from the readings of the current window: when 100 % would be reached at the
// measured pace, or null when the window resets first or the pace is unknown.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DATA_DIR = '~/.claude/usage-mod'
const H = 3600000

export function dataDir(dir = DATA_DIR, home = os.homedir()) {
  return String(dir || DATA_DIR).replace(/^~(?=$|[\\/])/, home)
}

/** samples.jsonl as rows, oldest first (bad lines skipped). */
export function parseSamples(text) {
  const out = []
  for (const l of String(text || '').split('\n')) {
    if (!l.trim()) continue
    try {
      const j = JSON.parse(l)
      if (j && typeof j === 'object') out.push(j)
    } catch { /* partial line */ }
  }
  return out.sort((a, b) => (a.ts || 0) - (b.ts || 0))
}

/**
 * One window's state from readings [{ts, pct, reset}] (oldest first): the latest reading, the pace over the
 * readings of the same window (same reset), and the run-out time. pct and pace in % ; rate in % per hour.
 */
export function runOut(readings, now = Date.now()) {
  const rs = (readings || []).filter((r) => r && Number.isFinite(r.pct) && Number.isFinite(r.ts))
  if (!rs.length) return null
  const last = rs[rs.length - 1]
  const reset = Number.isFinite(last.reset) ? last.reset : null
  if (reset && reset <= now) return { pct: 0, reset: null, at: last.ts, ratePerH: null, runOutAt: null, resetsFirst: true, past: true }
  const same = rs.filter((r) => (r.reset ?? null) === (last.reset ?? null))
  const first = same[0]
  const dt = last.ts - first.ts
  const ratePerH = dt > 0 && last.pct >= first.pct ? ((last.pct - first.pct) / dt) * H : null
  let runOutAt = null
  if (last.pct >= 100) runOutAt = last.ts
  else if (ratePerH && ratePerH > 0) runOutAt = last.ts + ((100 - last.pct) / ratePerH) * H
  const resetsFirst = !!(reset && (!runOutAt || runOutAt > reset))
  return { pct: last.pct, reset, at: last.ts, ratePerH, runOutAt: resetsFirst ? null : runOutAt, resetsFirst, past: false }
}

/** Claude's 5 h and week from the samples: {five, week}, each runOut() or null. */
export function claudeWindows(samples, now = Date.now()) {
  const of = (k) => runOut(samples.filter((s) => s && s[k]).map((s) => ({ ts: s.ts, pct: s[k].pct, reset: s[k].reset })), now)
  return { five: of('five_hour'), week: of('seven_day') }
}

/** Codex's windows from codex.json (only its latest snapshot is kept, so no pace): {five, week}. */
export function codexWindows(cx, now = Date.now()) {
  const lim = cx && cx.limits
  const out = { five: null, week: null }
  if (!lim) return out
  for (const w of [lim.primary, lim.secondary]) {
    if (!w || !Number.isFinite(w.pct)) continue
    const k = w.windowMin === 300 ? 'five' : w.windowMin === 10080 ? 'week' : null
    if (!k) continue
    const past = !!(w.reset && w.reset < now)
    out[k] = { pct: past ? 0 : w.pct, reset: past ? null : w.reset ?? null, at: lim.ts ?? null, ratePerH: null, runOutAt: !past && w.pct >= 100 ? lim.ts ?? now : null, resetsFirst: false, past }
  }
  return out
}

/** Both providers from the usage mod's data folder. Missing files give nulls. */
export function readQuotas(dir = DATA_DIR, now = Date.now()) {
  const d = dataDir(dir)
  let samples = []
  let cx = null
  try { samples = parseSamples(fs.readFileSync(path.join(d, 'samples.jsonl'), 'utf8')) } catch { /* no samples yet */ }
  try { cx = JSON.parse(fs.readFileSync(path.join(d, 'codex.json'), 'utf8')) } catch { /* no codex scan */ }
  return { claude: claudeWindows(samples, now), codex: codexWindows(cx, now), codexAvailable: !!(cx && cx.available) }
}

/**
 * The readings of the current window of Claude's 5 h and week, for a curve: { five: [{ ts, pct, reset }], week: [...] }, each
 * oldest first, only the readings with the latest reading's reset, thinned to at most `max` points (the last kept).
 */
export function claudeSeries(samples, now = Date.now(), max = 60) {
  const of = (k) => {
    const rs = (samples || []).filter((s) => s && s[k] && Number.isFinite(s[k].pct) && Number.isFinite(s.ts) && s.ts <= now)
      .map((s) => ({ ts: s.ts, pct: s[k].pct, reset: s[k].reset ?? null }))
    if (!rs.length) return []
    const last = rs[rs.length - 1]
    if (last.reset && last.reset <= now) return []
    const same = rs.filter((r) => r.reset === last.reset)
    if (same.length <= max) return same
    const step = (same.length - 1) / (max - 1)
    return Array.from({ length: max }, (_, i) => same[Math.round(i * step)])
  }
  return { five: of('five_hour'), week: of('seven_day') }
}

/** claudeSeries() from the usage mod's samples.jsonl. A missing file gives empty series. */
export function readSeries(dir = DATA_DIR, now = Date.now(), max = 60) {
  let samples = []
  try { samples = parseSamples(fs.readFileSync(path.join(dataDir(dir), 'samples.jsonl'), 'utf8')) } catch { /* no samples yet */ }
  return claudeSeries(samples, now, max)
}
