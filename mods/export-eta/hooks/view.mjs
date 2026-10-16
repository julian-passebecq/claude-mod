// export-eta - view model of the pane and of the line above the prompt. Pure (no $, no I/O), tested with node --test.
// Inputs: the merged config, <home>/sessions.json, pending.json and state.json (written by exporter/export.mjs).
import { byProject, fill } from '../lib/layout.mjs'

export function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} j`
}

export function hm(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export const maskedText = (m) => {
  const e = Object.entries(m || {})
  return e.length ? e.map(([k, v]) => `${k} ${v}`).join(', ') : '0'
}

/** History rows: date, count, PR link, merged, masked counts, held-back files, error. */
export function historyRows(state, n = 10) {
  return ((state && state.history) || []).slice(0, n).map((h) => ({
    at: h.at, when: hm(h.at), mode: h.mode, count: h.count || 0, url: h.url || '', pr: h.pr ? `#${h.pr}` : '',
    merged: !!h.merged, masked: maskedText(h.masked), held: (h.held || []).map((x) => x.title || x.cli), error: h.error || '', dry: !!h.dry,
    tone: h.error && !h.merged ? 'bad' : h.held && h.held.length ? 'warn' : 'ok',
  }))
}

/** Ongoing conversations (snapshot list). */
export function ongoing(sessions) {
  return (sessions || []).filter((s) => s.state === 'ongoing' || s.state === 'live')
}

/** Finished conversations grouped by project for the checkbox list; `selected` and `open` are Sets. */
export function selection(sessions, selected, open, max = 40) {
  const fin = (sessions || []).filter((s) => s.state === 'finished')
  return byProject(fin).map((g) => ({
    project: g.project, open: open.has(g.project), count: g.list.length,
    picked: g.list.filter((s) => selected.has(s.cli)).length,
    rows: g.list.slice(0, max).map((s) => ({ cli: s.cli, title: s.title || s.cli.slice(0, 8), when: hm(s.last_activity), checked: selected.has(s.cli), exported: !!s.exported_at })),
    more: Math.max(0, g.list.length - max),
  }))
}

/** The batch tab and the band line. */
export function batchView(pending, cfg) {
  const L = cfg.labels || {}
  if (!pending) return { ready: false, text: '', none: fill(L.batch_none, { n: 0, min: cfg.batch_min ?? 3 }), titles: [] }
  return {
    ready: !!pending.ready, count: pending.count || 0, auto: !!pending.auto,
    text: pending.ready ? pending.text || fill(L.batch_notice, { n: pending.count }) : '',
    none: fill(L.batch_none, { n: pending.count || 0, min: cfg.batch_min ?? 3 }),
    reason: pending.reason === 'lead' ? 'un lead et toutes ses sous-conversations sont terminés' : pending.reason === 'count' ? `seuil ${cfg.batch_min ?? 3} atteint` : '',
    titles: (pending.titles || []).map((t) => `${t.project} · ${t.title || t.cli.slice(0, 8)}`),
  }
}

/** The line above the prompt: only when a batch is ready and not dismissed for this batch. */
export function bandLine(pending, cfg, dismissedKey) {
  const b = batchView(pending, cfg)
  if (!b.ready) return null
  const key = (pending.ids || []).slice().sort().join(',')
  if (key && key === dismissedKey) return null
  return { text: b.text, key }
}
