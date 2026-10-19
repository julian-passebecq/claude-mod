// cockpit Panneau, QUOTAS unfolded: the 5 h and week curves (Julian, 19 Oct: « progression »): the readings of the
// current window (usage's samples.jsonl, lib/core/usage.mjs claudeSeries) and the engine's latest figure, with a
// dashed projection to the reset at the current rate; red when it passes 100 %, with « à ce rythme : 100 % vers
// HH:MM ». The current rate = the slope over the last `rate_min` minutes of readings (5 h: 60, week: 24 h), else over
// the whole window. Pure: no $, no I/O (node --test mods/cockpit/tests/viz.test.mjs).

const MIN = 60000
const H = 3600000

export const QUOTA_DEFAULTS = {
  five: { span_h: 5, rate_min: 60 },
  week: { span_h: 168, rate_min: 1440 },
  labels: { hit: 'à ce rythme : 100 % vers {at}', reach: 'à ce rythme : {pct} % au reset', days: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'] },
}

const p2 = (n) => String(n).padStart(2, '0')
/** « 14:20 », or « jeu 14:20 » when it is not within the next 20 h (local clock). */
export function atText(ms, now, days = QUOTA_DEFAULTS.labels.days) {
  const d = new Date(ms)
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`
  return ms - now > 20 * H ? `${days[d.getDay()]} ${hm}` : hm
}

/**
 * The projection of one window. readings: [{ ts, pct }] oldest first; o: { pct (the engine's figure now, wins over the
 * last reading), reset (ms; else the readings' own), now, span_h, rate_min }.
 * -> null without a reading, else { start, end, now, points, last, ratePerH, projPct (at the reset), hitAt (ms when
 *    100 % is reached before the reset, else null), over }.
 */
export function quotaProjection(readings, o = {}) {
  const now = Number(o.now) || Date.now()
  const given = (readings || []).filter((r) => r && Number.isFinite(r.reset)).pop()
  const reset = Number.isFinite(o.reset) ? o.reset : given ? given.reset : NaN
  const pts = (readings || []).filter((r) => r && Number.isFinite(r.ts) && Number.isFinite(r.pct) && r.ts <= now).map((r) => ({ ts: r.ts, pct: r.pct }))
  if (Number.isFinite(o.pct)) {
    if (pts.length && now - pts[pts.length - 1].ts < MIN) pts[pts.length - 1] = { ts: now, pct: o.pct }
    else pts.push({ ts: now, pct: o.pct })
  }
  if (!pts.length) return null
  const span = (Number(o.span_h) || 5) * H
  const end = Number.isFinite(reset) && reset > now ? reset : null
  const start = end ? end - span : pts[0].ts
  const inWin = pts.filter((p) => p.ts >= start)
  const points = inWin.length ? inWin : [pts[pts.length - 1]]
  const last = points[points.length - 1]
  const recent = points.filter((p) => p.ts >= last.ts - (Number(o.rate_min) || 60) * MIN)
  const base = recent.length >= 2 ? recent : points
  const first = base[0]
  const dt = last.ts - first.ts
  const ratePerH = dt > 0 ? Math.max(0, ((last.pct - first.pct) / dt) * H) : null
  let projPct = last.pct
  let hitAt = last.pct >= 100 ? last.ts : null
  if (end && ratePerH !== null) {
    projPct = last.pct + (ratePerH * (end - last.ts)) / H
    if (hitAt === null && ratePerH > 0 && projPct >= 100) hitAt = last.ts + ((100 - last.pct) / ratePerH) * H
  }
  return { start, end, now, points, last, ratePerH, projPct, hitAt, over: hitAt !== null }
}

/** The text under a curve: « à ce rythme : 100 % vers 14:20 » (red) or « à ce rythme : 64 % au reset », else ''. */
export function projectionText(p, labels = {}) {
  const L = { ...QUOTA_DEFAULTS.labels, ...labels }
  if (!p) return ''
  if (p.over) return L.hit.replace('{at}', atText(p.hitAt, p.now, L.days))
  if (p.end && p.ratePerH !== null) return L.reach.replace('{pct}', String(Math.round(p.projPct)))
  return ''
}

/**
 * Both windows. series: the cards scanner's quotaSeries ({ five, week }); usage: $.session.usage() ({ rateLimits:
 * [{ kind, percentUsed, resetsAt }] }); cfg: panel.viz.quota overrides. -> { five, week } (quotaProjection or null),
 * each with its `text`.
 */
export function quotaCurves({ series, usage, now }, cfg = {}) {
  const c = { ...QUOTA_DEFAULTS, ...(cfg || {}) }
  const limits = (usage && usage.rateLimits) || []
  const one = (id, kind) => {
    const r = limits.find((x) => x && x.kind === kind)
    const reset = r ? Date.parse(r.resetsAt || '') : NaN
    const p = quotaProjection((series && series[id]) || [], { now, pct: r && Number.isFinite(r.percentUsed) ? r.percentUsed : undefined, reset: Number.isFinite(reset) ? reset : undefined, ...c[id] })
    return p ? { ...p, text: projectionText(p, c.labels) } : null
  }
  return { five: one('five', 'five_hour'), week: one('week', 'seven_day') }
}
