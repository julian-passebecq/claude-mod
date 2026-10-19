// cockpit Panneau - the Gantt models (Julian, 19 Oct: « judicious visual diagrams… gantt »), pure: no $, no I/O.
//   dayGantt   « Aujourd’hui », under the CONVERSATIONS rows: one track per active conversation (max 6), one bar per
//              Workflow (or the background agents) over today's time axis, the colour of its dominant model, amber
//              hatched when « à l’arrêt », a « maintenant » line, the estimated end as a dashed continuation, hour ticks.
//   wfGantt    a Workflow unfolded: one bar per agent, grouped by phase, over the Workflow's own time axis, the ETA.
//   textCells  the ▕███░░▏ fallback of one track (terminal and text surfaces have no Svg).
// Positions are fractions of the axis (0..1), so the drawing (hooks/viz_gantt.mjs) fits any pane width.
// Input: the cards of lib/panel_conv.mjs convFactory (k.phases[].agents[] = { ts, ms, status, model }, k.live,
// k.stalled, k.failed, k.eta « HH:MM » or k.etaMs).
import { modelFamily } from './viz_palette.mjs'

const MIN = 60000
const HOUR = 3600000
const fin = (v) => Number.isFinite(v)

export const GANTT_DEFAULTS = {
  max_tracks: 6,
  labels: {
    day: 'Aujourd’hui', now: 'maintenant', eta: 'fin estimée', stalled: 'à l’arrêt', done: 'fini', running: 'en cours',
    more: '+ {n} autres', summary: '{from} → {to} · {n} conv.', none: 'aucun Workflow aujourd’hui',
  },
}

/** panel.gantt of cockpit.config.json over the defaults. */
export function ganttConfig(cfg) {
  const g = (cfg && cfg.panel && cfg.panel.gantt) || {}
  return { ...GANTT_DEFAULTS, ...g, labels: { ...GANTT_DEFAULTS.labels, ...(g.labels || {}) } }
}

/** Local midnight of the day of `ms`. */
export function dayStart(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const floorHour = (ms) => { const d = new Date(ms); d.setMinutes(0, 0, 0); return d.getTime() }
const ceilHour = (ms) => { const f = floorHour(ms); return f === ms ? ms : f + HOUR }
/** « 16h », « 16h30 » in local time. */
export function hourLabel(ms) {
  const d = new Date(ms)
  const m = d.getMinutes()
  return `${d.getHours()}h${m ? String(m).padStart(2, '0') : ''}`
}

/**
 * The time axis from t0 to t1: x(t) in 0..1 and ticks at a round step (hours for the day axis, minutes below an hour)
 * so that no more than maxTicks show. -> { t0, t1, x, ticks: [{ at, x, label }] }.
 */
export function axis(t0, t1, maxTicks = 6) {
  const a = Math.min(t0, t1)
  const b = Math.max(t1, a + MIN)
  const x = (t) => Math.max(0, Math.min(1, (t - a) / (b - a)))
  const steps = [5, 10, 15, 30, 60, 120, 180, 240, 360].map((m) => m * MIN)
  const span = b - a
  const step = steps.find((s) => span / s <= Math.max(1, maxTicks)) || 720 * MIN
  const ticks = []
  // round to the step in local time: from the local hour, then by step
  let t = floorHour(a)
  if (step >= HOUR) {
    if (t < a) t += HOUR
    while (new Date(t).getHours() % (step / HOUR)) t += HOUR
  } else while (t < a) t += step
  for (; t <= b && ticks.length < 50; t += step) ticks.push({ at: t, x: x(t), label: hourLabel(t) })
  return { t0: a, t1: b, x, ticks }
}

/** The estimated end of a live card in ms: k.etaMs, else its « HH:MM » today (tomorrow if that is long past). */
export function etaOf(k, nowMs) {
  if (!k || !k.live) return null
  if (fin(k.etaMs)) return k.etaMs > nowMs ? k.etaMs : null
  const m = /^(\d{1,2}):(\d{2})/.exec(String(k.eta || ''))
  if (!m) return null
  const d = new Date(nowMs)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  let t = d.getTime()
  if (t < nowMs - 12 * HOUR) t += 24 * HOUR
  return t > nowMs ? t : null
}

const agentsOf = (k) => ((k && k.phases) || []).flatMap((p) => p.agents || [])
const endOf = (a, nowMs) => (a.status === 'running' ? nowMs : (a.ts || 0) + (a.ms || 0))

/** The family that ran longest among `agents` (time, then tokens); 'other' when none is known. */
export function dominantFamily(agents, nowMs) {
  const w = {}
  for (const a of agents || []) {
    const f = modelFamily(a.model)
    const t = a.ts ? Math.max(0, endOf(a, nowMs) - a.ts) : 0
    w[f] = (w[f] || 0) + t + (a.tokens || 0) / 1e9
  }
  const best = Object.entries(w).filter(([f]) => f !== 'other').sort((a, b) => b[1] - a[1])[0]
  return best ? best[0] : 'other'
}

/** A card's state on a bar: failed, stalled (« à l’arrêt »), running, done. */
export const cardState = (k) => (k.failed ? 'failed' : k.stalled ? 'stalled' : k.live ? 'running' : 'done')

/** One card as a bar in ms: { key, start, end, eta, state, family } or null (no agent started). */
export function cardSpan(k, nowMs) {
  const agents = agentsOf(k).filter((a) => a.ts)
  if (!agents.length) return null
  const start = Math.min(...agents.map((a) => a.ts))
  const end = k.live ? nowMs : Math.max(start, ...agents.map((a) => endOf(a, nowMs)))
  return { key: k.key, label: k.title, start, end, eta: etaOf(k, nowMs), state: cardState(k), family: dominantFamily(agents, nowMs) }
}

/**
 * The « Aujourd’hui » Gantt. convs: [{ key, label, active, cards }] in the rows' order (cards: live and finished);
 * o: { maxTracks (6), maxTicks (6) }. Only today's part of a bar is drawn; a conversation is a track when it is active
 * (works or waits) or one of its cards runs, and something of it ran today. The axis runs from the hour before the
 * first bar (at least one hour before now) to the hour after now or the latest ETA.
 * -> { empty, t0, t1, now (0..1), ticks, tracks: [{ key, label, bars: [{ key, label, x0, x1, eta, state, family }] }], more }.
 */
export function dayGantt(convs, nowMs, o = {}) {
  const max = Math.max(1, Number(o.maxTracks) || GANTT_DEFAULTS.max_tracks)
  const midnight = dayStart(nowMs)
  const raw = []
  for (const c of convs || []) {
    const cards = c.cards || []
    const live = cards.some((k) => k.live)
    if (!c.active && !live) continue
    const spans = cards.map((k) => cardSpan(k, nowMs)).filter((s) => s && s.end >= midnight)
    if (spans.length) raw.push({ key: c.key, label: c.label, spans })
  }
  if (!raw.length) return { empty: true, tracks: [], ticks: [], more: 0, now: 1, t0: midnight, t1: nowMs }
  const shown = raw.slice(0, max)
  const all = shown.flatMap((t) => t.spans)
  const first = Math.max(midnight, Math.min(nowMs - HOUR, ...all.map((s) => s.start)))
  const last = Math.max(nowMs + 10 * MIN, ...all.map((s) => s.eta || 0), ...all.map((s) => s.end))
  const ax = axis(floorHour(first), ceilHour(last), o.maxTicks || 6)
  const tracks = shown.map((t) => ({
    key: t.key, label: t.label,
    bars: t.spans.sort((a, b) => a.start - b.start).map((s) => ({
      key: s.key, label: s.label, x0: ax.x(Math.max(s.start, ax.t0)), x1: ax.x(s.end), eta: s.eta ? ax.x(s.eta) : null, state: s.state, family: s.family,
    })),
  }))
  return { empty: false, t0: ax.t0, t1: ax.t1, now: ax.x(nowMs), ticks: ax.ticks, tracks, more: raw.length - shown.length }
}

/**
 * A Workflow's own Gantt: its phases in order, one row per agent (model, state; a pending agent has no bar), over the
 * span from its first start to now (live) or its last end, and its ETA. A running agent of a stalled card is stalled.
 * -> { empty, t0, t1, now (0..1 | null when finished), eta (0..1 | null), ticks, phases: [{ key, title, rows: [{ key,
 *    model, family, state, x0, x1, eta }] }] }.
 */
export function wfGantt(k, nowMs, o = {}) {
  const agents = agentsOf(k)
  const started = agents.filter((a) => a.ts)
  if (!started.length) return { empty: true, phases: [], ticks: [], now: null, eta: null }
  const start = Math.min(...started.map((a) => a.ts))
  const end = Math.max(...started.map((a) => endOf(a, nowMs)), k.live ? nowMs : 0)
  const eta = etaOf(k, nowMs)
  const ax = axis(start, Math.max(end, eta || 0), o.maxTicks || 4)
  const stateOf = (a) => (a.status === 'failed' ? 'failed' : a.status === 'running' ? (k.stalled ? 'stalled' : 'running') : a.status === 'done' ? 'done' : 'pending')
  const phases = (k.phases || []).map((p) => ({
    key: p.key, title: p.title,
    rows: (p.agents || []).slice().sort((a, b) => (a.ts || Infinity) - (b.ts || Infinity)).map((a) => {
      const st = a.ts ? stateOf(a) : 'pending'
      const bar = a.ts && !(st === 'pending' && !a.ms)
      return {
        key: `${p.key}-${a.id}`, model: a.model || '?', family: modelFamily(a.model), state: st,
        x0: bar ? ax.x(a.ts) : null, x1: bar ? ax.x(endOf(a, nowMs)) : null,
        eta: eta && (st === 'running' || st === 'stalled') ? ax.x(eta) : null,
      }
    }),
  })).filter((p) => p.rows.length)
  return { empty: false, t0: ax.t0, t1: ax.t1, now: k.live ? ax.x(nowMs) : null, eta: eta ? ax.x(eta) : null, ticks: ax.ticks, phases }
}

// ---- the text fallback ------------------------------------------------------------------------------------------------

export const GLYPHS = { done: '█', run: '█', head: '▓', stalled: '▒', failed: '▒', eta: '░', now: '│', empty: ' ' }

/**
 * One track as `cells` characters: █ a bar (run: a running one, ▓ its end), ▒ stalled or failed, ░ the estimated end, │ now (on
 * an empty cell), ' ' empty. bars: [{ x0, x1, eta, state }] (fractions). -> [{ text, kind }] runs of one kind each.
 */
export function textCells(bars, cells, now = null) {
  const n = Math.max(2, Math.floor(cells))
  const col = (x) => Math.max(0, Math.min(n - 1, Math.floor(x * n)))
  const last = (x, from) => Math.max(from, Math.min(n - 1, Math.ceil(x * n) - 1))
  const kinds = new Array(n).fill('empty')
  const at = now === null || now === undefined ? -1 : col(now)
  for (const b of bars || []) {
    if (b.x0 === null || b.x0 === undefined) continue
    const a = col(b.x0)
    const z = last(b.x1, a)
    if (fin(b.eta) && b.eta > b.x1) for (let i = z + 1; i <= last(b.eta, z); i++) if (kinds[i] === 'empty') kinds[i] = 'eta'
    for (let i = a; i <= z; i++) kinds[i] = b.state === 'stalled' ? 'stalled' : b.state === 'failed' ? 'failed' : b.state === 'running' ? 'run' : 'done'
    if (b.state === 'running' && z > a) kinds[z] = 'head'
  }
  if (at >= 0 && kinds[at] === 'empty') kinds[at] = 'now'
  const runs = []
  for (const k of kinds) {
    const g = GLYPHS[k]
    const last = runs[runs.length - 1]
    if (last && last.kind === k) last.text += g
    else runs.push({ text: g, kind: k })
  }
  return runs
}

/** The tick labels on a line of `cells` characters (each label starts at its tick, none overlaps). */
export function tickLine(ticks, cells) {
  const n = Math.max(2, Math.floor(cells))
  const out = new Array(n).fill(' ')
  let free = 0
  for (const t of ticks || []) {
    const i = Math.min(n - 1, Math.floor(t.x * n))
    const s = [...t.label]
    if (i < free || i + s.length > n) continue
    s.forEach((ch, j) => { out[i + j] = ch })
    free = i + s.length + 1
  }
  return out.join('')
}
