// a-faire - view model of the pane: pure (no $, no I/O), tested with node --test.
// Input: the merged config, ~/.claude/a-faire/items.json (written by the scanner) and which categories are unfolded.
import { CATS, groups, oneLine } from '../lib/items.mjs'

export function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} j`
}

// « échéance 2026-11-05 (J-19) », « … (aujourd’hui) », « … (dépassée) »: days counted from local midnight.
export function dueText(i, now, L = {}) {
  const day = 86400000
  const n = Math.round((new Date(i.due).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / day)
  const when = n > 0 ? `J-${n}` : n === 0 ? L.today || 'aujourd’hui' : L.overdue || 'dépassée'
  return `${L.due || 'échéance'} ${i.dueDay || new Date(i.due).toISOString().slice(0, 10)} (${when})`
}

// Which categories are unfolded when nothing was clicked yet: config.open = nonempty | all | none | [ids].
export function initialOpen(cfg, data) {
  const o = cfg.open ?? 'nonempty'
  const order = cfg.order || CATS
  if (Array.isArray(o)) return o
  if (o === 'all') return [...order]
  if (o === 'none') return []
  const open = (data && data.open) || []
  return order.filter((c) => open.some((i) => i.cat === c))
}

export function viewModel(cfg, data, openCats, now) {
  const L = cfg.labels || {}
  const names = cfg.categories || {}
  const P = cfg.priorities || {}
  const open = (data && data.open) || []
  const cats = groups(open, cfg.order || CATS).map(({ cat, items }) => {
    const top = items[0]
    const now_n = items.filter((i) => i.prio === 'now').length
    return {
      cat, label: names[cat] || cat, n: items.length, unfolded: (openCats || []).includes(cat),
      tone: now_n ? 'now' : items.some((i) => i.prio === 'feature') ? 'feature' : items.length ? 'comfort' : 'dim',
      summary: top ? oneLine(top.title, 90) + (items.length > 1 ? ` (+${items.length - 1})` : '') : L.empty_cat || 'rien',
      items: items.map((i) => ({ ...i, prioLabel: P[i.prio] || i.prio, sinceText: i.due ? dueText(i, now, L) : i.since ? `${L.since || 'depuis'} ${ago(now - i.since)}` : '' })),
    }
  })
  const high = open.filter((i) => i.prio === 'now').length
  return {
    title: `${L.title || 'À toi'} · ${open.length}`,
    head: open.length ? `${high} ${P.now || 'bloque une conversation'} · ${open.filter((i) => i.prio === 'feature').length} ${P.feature || 'bloque une fonction'} · ${open.filter((i) => i.prio === 'comfort').length} ${P.comfort || 'confort'}` : L.none || "Rien n'attend Julian.",
    total: open.length, high, cats,
    snoozed: ((data && data.snoozed) || []).length,
    errors: (data && data.errors) || [],
    at: data && data.at,
  }
}
