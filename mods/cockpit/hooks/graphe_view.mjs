// cockpit Panneau, section 5 « Graphe des conversations »: draws lib/graphe.mjs grapheModel(...).
// drawGraphe(h, model, L, width, act) -> element list (the section's body). h: view.mjs's kit (T, row, col, btn, lr);
// L: panel labels; width: the columns of the body (every line stays <= width); act: { openConv(link), gfilter(k, v),
// gcycle('project') }. A title is a button that opens that conversation in the app (claude:// link, as « Depuis »).
import { fill, kTok } from '../lib/panel.mjs'

const clip = (t, n) => {
  const s = String(t ?? '')
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s
}

const NOOP = () => {}
// leading spaces of a continuation line are kept (a text line may be trimmed): non-breaking spaces, same width
const keep = (t) => String(t).replace(/^ +/, (m) => String.fromCharCode(160).repeat(m.length))

export function drawGraphe(h, model, L, width, act = {}) {
  if (!model || !model.ready) return [h.T(L.graphe_slot, { dim: true, key: 'pg-slot' })]
  const open = act.openConv || NOOP
  const out = []
  const f = model.filter
  // À toi de cliquer
  out.push(h.T(`${L.graphe_click}${model.waiting.length ? ` (${model.waiting.length})` : ''}`, { bold: true, tone: model.waiting.length ? 'warn' : undefined, key: 'pg-click' }))
  if (!model.waiting.length) out.push(h.T(L.graphe_click_none, { dim: true, key: 'pg-click-none' }))
  for (const w of model.waiting) {
    out.push(h.row([h.T('◆', { tone: 'warn' }), h.btn(clip(w.title + (w.self ? ' ' + L.graphe_here : ''), width - 6), () => open(w.link), true, 'pgw-' + w.key)],
      { key: 'pgwr-' + w.key, alignItems: 'center', flexWrap: 'nowrap' }))
    out.push(h.T(keep(clip('  ' + fill(L.graphe_wait_line, { reason: w.reason, age: w.age }), width)), { tone: 'warn', wrap: 'truncate-end', key: 'pgwl-' + w.key }))
  }
  out.push(h.T(model.legend, { dim: true, key: 'pg-legend' }))
  // filters (kept in $.store with the Panneau's)
  out.push(h.row([
    h.btn(fill(L.graphe_project, { name: clip(f.project || L.graphe_all_projects, 18) }), () => (act.gcycle || NOOP)('project'), Boolean(f.project), 'pg-f-project'),
    h.btn(L.graphe_active, () => (act.gfilter || NOOP)('active', !f.active), f.active, 'pg-f-active'),
  ], { key: 'pg-f1', alignItems: 'center' }))
  out.push(h.row([
    ...['24h', '7j', 'tout'].map((p) => h.btn(L.graphe_periods[p] || p, () => (act.gfilter || NOOP)('period', p), f.period === p, 'pg-f-' + p)),
    h.btn(L.graphe_archived, () => (act.gfilter || NOOP)('archived', !f.archived), f.archived, 'pg-f-archived'),
  ], { key: 'pg-f2', alignItems: 'center' }))
  if (model.empty) { out.push(h.T(L.graphe_none, { dim: true, key: 'pg-none' })); return out }
  for (const g of model.groups) {
    out.push(h.T(clip(fill(L.graphe_group, { name: (g.starred ? '★ ' : '') + g.name, n: g.count }), width), { bold: true, key: 'pgg-' + g.name, wrap: 'truncate-end' }))
    for (const r of g.lines) {
      const head = `${r.prefix}${r.dot}`
      const tail = `${r.starred ? ' ★' : ''}${r.self ? ' ' + L.graphe_here : ''}`
      const room = Math.max(8, width - head.length - tail.length - 4)
      out.push(h.row([
        h.T(head, { tone: r.tone, dim: !r.tone }),
        h.btn(clip(r.title, room) + tail, () => open(r.link), false, 'pgl-' + r.key),
      ], { key: 'pglr-' + r.key, alignItems: 'center', flexWrap: 'nowrap' }))
      const meta = [r.word, r.role, r.tokens !== null ? fill(L.graphe_tokens, { tokens: kTok(r.tokens) }) : '', r.ctx !== null ? fill(L.graphe_ctx, { pct: r.ctx }) : ''].filter(Boolean).join(' · ')
      out.push(h.T(keep(clip(r.cont + meta, width)), { tone: r.state === 'waiting' || r.state === 'blocked' ? r.tone : undefined, dim: r.state !== 'waiting' && r.state !== 'blocked', wrap: 'truncate-end', key: 'pglm-' + r.key }))
      const notes = [r.from ? fill(L.graphe_from, { title: r.from }) : '', ...r.peers.map((t) => fill(L.graphe_peer, { title: t }))].filter(Boolean)
      if (notes.length) out.push(h.T(keep(clip(r.cont + notes.join('  '), width)), { dim: true, wrap: 'truncate-end', key: 'pgln-' + r.key }))
    }
  }
  if (model.hidden) out.push(h.T(fill(L.graphe_hidden, { n: model.hidden }), { dim: true, key: 'pg-hidden' }))
  return out
}
