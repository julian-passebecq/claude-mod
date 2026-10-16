// Canonical copy: lib/core/estimate.mjs (repo root). Every mods/<mod>/lib/core/estimate.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// One estimate rule for Workflows (factory) and pipelines (ci): from past successful durations, the median and the
// p25-p75 range, ONLY when there are at least MIN_SAMPLES of them; else a fallback list may serve, else no estimate
// (« pas assez d'historique »). Pure.

export const MIN_SAMPLES = 3

/** n, median, p25, p75 (linear interpolation; same as factory's workflow.mjs quantiles). */
export function quantiles(xs) {
  const v = (xs || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return { n: 0, median: 0, p25: 0, p75: 0 }
  const q = (p) => {
    const i = (v.length - 1) * p
    const lo = Math.floor(i)
    return v[lo] + (v[Math.min(v.length - 1, lo + 1)] - v[lo]) * (i - lo)
  }
  return { n: v.length, median: q(0.5), p25: q(0.25), p75: q(0.75) }
}

/**
 * Duration estimate from past successful runs [{ms, ok}] or plain numbers (ms). The first list with at least
 * `min` successes wins (basis 'primary' or 'fallback'); else {enough: false, n} with the larger sample size.
 */
export function estimateOf(runs, { fallback = [], min = MIN_SAMPLES } = {}) {
  const ok = (xs) => (xs || []).map((r) => (typeof r === 'number' ? r : r && r.ok !== false ? r.ms : NaN)).filter((x) => Number.isFinite(x) && x >= 0)
  const a = ok(runs)
  if (a.length >= min) return { enough: true, basis: 'primary', ...quantiles(a) }
  const b = ok(fallback)
  if (b.length >= min) return { enough: true, basis: 'fallback', ...quantiles(b) }
  return { enough: false, basis: null, n: Math.max(a.length, b.length), median: 0, p25: 0, p75: 0 }
}

/** What is left after `elapsedMs`: {lo, mid, hi} ms (never negative), overrun once past p75. Null without estimate. */
export function remaining(est, elapsedMs) {
  if (!est || est.enough === false) return null
  const e = Math.max(0, elapsedMs || 0)
  return {
    lo: Math.max(0, est.p25 - e), mid: Math.max(0, est.median - e), hi: Math.max(0, est.p75 - e),
    overrun: e > est.p75, n: est.n,
  }
}

/** End times {lo, mid, hi} (epoch ms) of something started at startMs, never before now. Null without estimate. */
export function etaOf(est, startMs, nowMs) {
  const r = remaining(est, nowMs - startMs)
  if (!r) return null
  return { lo: nowMs + r.lo, mid: nowMs + r.mid, hi: nowMs + r.hi, overrun: r.overrun, n: r.n }
}
