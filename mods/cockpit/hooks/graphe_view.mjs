// cockpit Panneau, section 5 « Graphe des conversations »: draws lib/graphe.mjs grapheModel(...), in the row style of
// Claude's panes (dot, title, grey detail on the right; children indented, no box-drawing connectors).
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
  // one group per project; each conversation a row like Claude's panes: dot + title (a button) on the left, tokens
  // today and context on the right (never cut), its state and role in grey under it; children indented, no box lines
  const ind = (n) => String.fromCharCode(160).repeat(n)
  for (const g of model.groups) {
    out.push(h.col([h.T(clip(fill(L.graphe_group, { name: (g.starred ? '★ ' : '') + g.name, n: g.count }), width), { bold: true, wrap: 'truncate-end' })], { key: 'pgg-' + g.name, marginTop: 1 }))
    for (const r of g.lines) {
      const pad = 2 * Math.min(r.depth || 0, 4)
      const right = [r.tokens !== null ? kTok(r.tokens) : '', r.ctx !== null ? fill(L.graphe_ctx, { pct: r.ctx }) : ''].filter(Boolean).join(' · ')
      const tail = `${r.starred ? ' ★' : ''}${r.self ? ' ' + L.graphe_here : ''}`
      const room = Math.max(6, width - pad - 2 - [...right].length - [...tail].length - 5)
      out.push(h.row([
        h.row([pad ? h.T(ind(pad)) : null, h.T(r.dot, { tone: r.tone, dim: !r.tone }), h.btn(clip(r.title, room) + tail, () => open(r.link), false, 'pgl-' + r.key)], { flexWrap: 'nowrap', gap: 1, alignItems: 'center' }),
        right ? h.T(right, { dim: true }) : null,
      ], { key: 'pglr-' + r.key, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
      const meta = [r.word, r.role].filter(Boolean).join(' · ')
      const notes = [r.from ? fill(L.graphe_from, { title: r.from }) : '', ...r.peers.map((t) => fill(L.graphe_peer, { title: t }))].filter(Boolean)
      out.push(h.T(ind(pad + 2) + clip([meta, ...notes].filter(Boolean).join(' · '), Math.max(8, width - pad - 2)), { tone: r.state === 'waiting' || r.state === 'blocked' ? r.tone : undefined, dim: r.state !== 'waiting' && r.state !== 'blocked', wrap: 'truncate-end', key: 'pglm-' + r.key }))
    }
  }
  if (model.hidden) out.push(h.T(fill(L.graphe_hidden, { n: model.hidden }), { dim: true, key: 'pg-hidden' }))
  return out
}
