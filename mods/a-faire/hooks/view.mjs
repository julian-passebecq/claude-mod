// a-faire - view model of the pane: pure (no $, no I/O), tested with node --test.
// Input: the merged config, ~/.claude/a-faire/items.json (written by the scanner) and which categories are unfolded.
import { CATS, groups, oneLine } from '../lib/items.mjs'

export function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} j`
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
      items: items.map((i) => ({ ...i, prioLabel: P[i.prio] || i.prio, sinceText: i.since ? `${L.since || 'depuis'} ${ago(now - i.since)}` : '' })),
    }
  })
  const high = open.filter((i) => i.prio === 'now').length
  return {
    title: `${L.title || 'À faire par Julian'} · ${open.length}`,
    head: open.length ? `${high} ${P.now || 'bloque une conversation'} · ${open.filter((i) => i.prio === 'feature').length} ${P.feature || 'bloque une fonction'} · ${open.filter((i) => i.prio === 'comfort').length} ${P.comfort || 'confort'}` : L.none || "Rien n'attend Julian.",
    total: open.length, high, cats,
    snoozed: ((data && data.snoozed) || []).length,
    errors: (data && data.errors) || [],
    at: data && data.at,
  }
}
