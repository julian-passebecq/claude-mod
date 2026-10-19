// cockpit Panneau, DÉBIT unfolded: a 24 h TPS sparkline per model next to each table's title (Julian, 19 Oct). One
// point per clock hour of the last `hours` (24): the weighted TPS of that model in that hour (all output tokens ÷ all
// time, every effort), null for an hour with no reply. From usage's debit.json hourly rows (`hour|model|effort`:
// [output, ms, streams, hist]), the same rows as lib/debit.mjs. Pure: no $, no I/O.
import { modelLabel, DEBIT_DEFAULTS } from './debit.mjs'

const HOUR = 3600000

/**
 * debit: usage's debit.json; now: ms; cfg: the cockpit config (panel.debit.aliases names the models as the cards do).
 * -> { [card label]: { values: [24 numbers | null], max, last } } for the Claude models (the cards' `label`).
 */
export function tpsHourly(debit, now, cfg = {}, hours = 24) {
  const aliases = { ...DEBIT_DEFAULTS.aliases, ...((cfg && cfg.panel && cfg.panel.debit && cfg.panel.debit.aliases) || {}) }
  const out = {}
  if (!debit || !debit.hourly) return out
  const first = Math.floor(now / HOUR) * HOUR - (hours - 1) * HOUR
  const acc = {}
  for (const [k, row] of Object.entries(debit.hourly)) {
    const [h, model] = k.split('|')
    const t = Number(h)
    if (!(t >= first) || t > now || !Array.isArray(row)) continue
    const i = Math.round((t - first) / HOUR)
    if (i < 0 || i >= hours) continue
    const label = modelLabel(model, aliases)
    const a = acc[label] || (acc[label] = Array.from({ length: hours }, () => [0, 0]))
    a[i][0] += Number(row[0]) || 0
    a[i][1] += Number(row[1]) || 0
  }
  for (const [label, a] of Object.entries(acc)) {
    const values = a.map(([o, ms]) => (ms > 0 ? o / (ms / 1000) : null))
    const known = values.filter((v) => v !== null)
    if (!known.length) continue
    out[label] = { values, max: Math.max(...known), last: [...values].reverse().find((v) => v !== null) }
  }
  return out
}
