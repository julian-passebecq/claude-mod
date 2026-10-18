// cockpit Panneau, section 5 « Graphe des conversations »: draws lib/graphe.mjs grapheModel(...), in the row style of
// Claude's panes, ONE line per conversation (Julian, 18 Oct: « too tall »): state dot, title (a button that opens it),
// grey project name when its group has one member (no header then), right-aligned « 47.6M · ctx 75 % » and a tiny
// context bar; a second grey line only for a « lancée par / ⇢ message » relation. Groups of 2+ get a small grey header
// and their rows indented. One compact filter row, one short legend line (folded behind « Légende › » when narrow).
// drawGraphe(h, model, L, width, act, o) -> element list (the section's body). h: view.mjs's kit (T, row, col, btn, lr);
// L: panel labels; width: the columns of the body (every line stays <= width); act: { openConv(link), gfilter(k, v),
// gcycle('project'), ptoggle(id) }; o: { bar(pct, key, { cells, tone }) -> element (Svg or text), open: { id: bool },
// ctxCells, handoffPct }.
import { fill, kTok } from '../lib/panel.mjs'

const len = (s) => [...String(s ?? '')].length
const clip = (t, n) => {
  const a = [...String(t ?? '')]
  return a.length > n ? a.slice(0, Math.max(1, n - 1)).join('') + '…' : a.join('')
}

const NOOP = () => {}
const nb = (n) => String.fromCharCode(160).repeat(Math.max(0, n))
const PERIODS = ['24h', '7j', 'tout']

export function drawGraphe(h, model, L, width, act = {}, o = {}) {
  if (!model || !model.ready) return [h.T(L.graphe_slot, { dim: true, key: 'pg-slot' })]
  const open = act.openConv || NOOP
  const gf = act.gfilter || NOOP
  const out = []
  const f = model.filter
  // À toi de cliquer: the full detail lives here only; the list below marks the same conversation ◆ on one line
  out.push(h.T(`${L.graphe_click}${model.waiting.length ? ` (${model.waiting.length})` : ''}`, { bold: true, tone: model.waiting.length ? 'warn' : undefined, key: 'pg-click' }))
  if (!model.waiting.length) out.push(h.T(L.graphe_click_none, { dim: true, key: 'pg-click-none' }))
  for (const w of model.waiting) {
    out.push(h.row([h.T('◆', { tone: 'warn' }), h.btn(clip(w.title + (w.self ? ' ' + L.graphe_here : ''), width - 6), () => open(w.link), true, 'pgw-' + w.key)],
      { key: 'pgwr-' + w.key, alignItems: 'center', flexWrap: 'nowrap' }))
    out.push(h.T(nb(2) + clip(fill(L.graphe_wait_line, { reason: w.reason, age: w.age }), width - 2), { tone: 'warn', wrap: 'truncate-end', key: 'pgwl-' + w.key }))
  }
  // the legend: one line of coloured marks, or « Légende › » when it does not fit
  const legend = model.legend || []
  const legendLen = legend.reduce((a, x) => a + len(x.glyph) + 1 + len(x.label), 0) + Math.max(0, legend.length - 1)
  const legendRow = () => h.row(legend.map((x, i) => h.row([h.T(x.glyph, { tone: x.tone === 'dim' ? undefined : x.tone, dim: x.tone === 'dim' }), h.T(x.label, { dim: true })],
    { flexWrap: 'nowrap', gap: 1, key: 'pg-lg-' + i })), { key: 'pg-legend', flexWrap: 'nowrap', gap: 1 })
  if (legend.length && legendLen <= width) out.push(legendRow())
  else if (legend.length) {
    const lo = Boolean(o.open && o.open['pg-legend'])
    out.push(h.row([h.btn(`${L.graphe_legend_fold} ${lo ? '⌄' : '›'}`, () => (act.ptoggle || NOOP)('pg-legend'), false, 'pg-legend-btn')], { key: 'pg-legend-fold' }))
    if (lo) legend.forEach((x, i) => out.push(h.row([h.T(x.glyph, { tone: x.tone === 'dim' ? undefined : x.tone, dim: x.tone === 'dim' }), h.T(x.label, { dim: true })], { flexWrap: 'nowrap', gap: 1, key: 'pg-lgl-' + i })))
  }
  // one compact filter row (kept in $.store with the Panneau's): period ▾ cycles, Projet ▾ cycles, two toggles
  const nextPeriod = PERIODS[(PERIODS.indexOf(f.period) + 1) % PERIODS.length]
  out.push(h.row([
    h.btn(`${L.graphe_periods[f.period] || f.period} ▾`, () => gf('period', nextPeriod), false, 'pg-f-period'),
    h.btn(`${clip(f.project || L.graphe_project, 16)} ▾`, () => (act.gcycle || NOOP)('project'), Boolean(f.project), 'pg-f-project'),
    h.btn(L.graphe_active, () => gf('active', !f.active), f.active, 'pg-f-active'),
    h.btn(L.graphe_archived, () => gf('archived', !f.archived), f.archived, 'pg-f-archived'),
  ], { key: 'pg-f', alignItems: 'center' }))
  if (model.empty) { out.push(h.T(L.graphe_none, { dim: true, key: 'pg-none' })); return out }
  const ctxCells = Math.max(3, Number(o.ctxCells) || 4)
  for (const g of model.groups) {
    const single = g.lines.length === 1 && g.count === 1
    const base = single ? 0 : 2
    if (!single) out.push(h.T(clip(fill(L.graphe_group, { name: (g.starred ? '★ ' : '') + g.name, n: g.count }), width), { dim: true, wrap: 'truncate-end', key: 'pgg-' + g.name }))
    for (const r of g.lines) {
      const pad = base + 2 * Math.min(r.depth || 0, 4)
      const right = [r.tokens !== null ? kTok(r.tokens) : '', r.ctx !== null ? fill(L.graphe_ctx, { pct: r.ctx }) : ''].filter(Boolean).join(' · ')
      const bar = r.ctx !== null && o.bar ? o.bar(Math.min(100, r.ctx), 'pglb-' + r.key, { cells: ctxCells, tone: o.handoffPct && r.ctx >= o.handoffPct ? 'warn' : undefined }) : null
      const rightLen = len(right) + (bar ? ctxCells + 1 : 0)
      const tail = `${r.starred ? ' ★' : ''}${r.self ? ' ' + L.graphe_here : ''}`
      const grey = [single ? g.name : '', (L.graphe_role_marks || {})[r.roleId] || ''].filter(Boolean).join(' · ')
      // the title gives way first, then the grey part; the numbers never
      // what is not the title: the indent and its gap, the mark and its gap, the button's brackets, the gap before the right
      let room = width - (pad ? pad + 1 : 0) - 2 - 2 - len(tail) - 1 - rightLen
      const greyShown = grey && room - len(grey) - 1 >= 8 ? grey : ''
      room = Math.max(6, room - (greyShown ? len(greyShown) + 1 : 0))
      out.push(h.row([
        h.row([pad ? h.T(nb(pad)) : null, h.T(r.dot, { tone: r.tone === 'dim' ? undefined : r.tone, dim: r.tone === 'dim' || !r.tone }), h.btn(clip(r.title, room) + tail, () => open(r.link), false, 'pgl-' + r.key),
          greyShown ? h.T(greyShown, { dim: true, wrap: 'truncate-end' }) : null], { flexWrap: 'nowrap', gap: 1, alignItems: 'center' }),
        right || bar ? h.row([right ? h.T(right, { dim: true }) : null, bar], { flexWrap: 'nowrap', gap: 1, alignItems: 'center' }) : null,
      ], { key: 'pglr-' + r.key, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
      const notes = [r.from ? fill(L.graphe_from, { title: r.from }) : '', ...r.peers.map((t) => fill(L.graphe_peer, { title: t }))].filter(Boolean)
      if (notes.length) out.push(h.T(nb(pad + 2) + clip(notes.join(' · '), Math.max(8, width - pad - 2)), { dim: true, wrap: 'truncate-end', key: 'pglm-' + r.key }))
    }
  }
  if (model.hidden) out.push(h.T(fill(L.graphe_hidden, { n: model.hidden }), { dim: true, key: 'pg-hidden' }))
  return out
}
