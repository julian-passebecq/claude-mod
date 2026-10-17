// cockpit - draws « Depuis ton dernier message » from lib/depuis.mjs's model. h = view.mjs's kit (T, row, col, box, btn).
// Pure except for the callbacks in V.act. Read-only: « Ouvrir » hands a claude:// link to the desktop app, « Copier »
// puts text on the clipboard; « Demander un résumé à VEILLE » only shows the text to paste, it never sends it.
import { depuisConfig, depuisModel } from '../lib/depuis.mjs'

export function drawDepuis(h, V) {
  const c = depuisConfig(V.cfg)
  const L = c.labels
  const D = V.depuis || {}
  const out = [h.T(L.title, { bold: true, key: 'd-title' })]
  const cur = D.preset || c.default
  out.push(h.row([
    ...c.presets.filter((p) => p && p.id).map((p) => h.btn(p.label || p.id, () => V.act.depuisPreset(p.id), String(cur).toLowerCase() === String(p.id).toLowerCase(), 'd-p-' + p.id)),
    h.btn(D.busy ? '…' : L.refresh, () => V.act.depuisPreset(cur), false, 'd-refresh'),
  ], { key: 'd-presets', marginBottom: 1 }))
  if (!D.raw) {
    out.push(h.T(D.busy ? L.loading : D.error || L.loading, { dim: !D.error, tone: D.error ? 'bad' : undefined, key: 'd-wait' }))
    return out
  }
  const m = depuisModel(D.raw, D.extra || {}, V.cfg, D.at || V.now)
  out.push(h.T(m.headline, { bold: true, key: 'd-head' }))
  out.push(h.T(m.sub, { dim: true, key: 'd-sub' }))
  if (m.errors) out.push(h.T(m.errors, { tone: 'warn', key: 'd-err' }))
  const open = D.open || {}
  const groups = [...m.groups, ...(m.general ? [m.general] : [])]
  groups.forEach((g, i) => {
    const isOpen = open[g.name] !== undefined ? open[g.name] : i < m.open
    const head = h.row([
      h.btn(`${isOpen ? '▾' : '▸'} ${g.name}`, () => V.act.depuisToggle(g.name, !isOpen), false, 'd-g-' + i),
      h.T(g.summary, { dim: !g.tone, tone: g.tone || undefined, wrap: 'truncate-end' }),
    ], { alignItems: 'center', flexWrap: 'nowrap' })
    if (!isOpen) { out.push(h.col([head], { key: 'd-grp-' + i })); return }
    const body = []
    for (const k of g.kinds) {
      body.push(h.T(k.title, { bold: true, key: `d-${i}-${k.kind}` }))
      k.items.forEach((it, j) => {
        body.push(h.T(`• ${it.text}`, { tone: it.tone || undefined, key: `d-${i}-${k.kind}-${j}` }))
        if (it.detail) body.push(h.T(`  ${it.detail}`, { dim: true, key: `d-${i}-${k.kind}-${j}-d` }))
        if (it.sid || it.cli) {
          body.push(h.row([
            it.link ? h.btn(L.open, () => V.act.openConv(it.link), false, `d-open-${i}-${k.kind}-${j}`) : null,
            h.btn(L.copy_id, (press) => V.act.copy(it.sid || it.cli, press, 'id'), false, `d-copy-${i}-${k.kind}-${j}`),
            h.T(it.sid || it.cli, { dim: true, wrap: 'truncate-end' }),
          ], { key: `d-${i}-${k.kind}-${j}-b`, alignItems: 'center' }))
        }
      })
      if (k.more) body.push(h.T(L.more.replace('{n}', k.more), { dim: true, key: `d-${i}-${k.kind}-more` }))
    }
    if (g.cost) body.push(h.T(`${L.kinds.cost} : ${g.cost}`, { dim: true, key: `d-${i}-cost` }))
    out.push(h.col([head, h.box(null, body, { key: 'd-body-' + i, tone: g.tone || undefined })], { key: 'd-grp-' + i }))
  })
  if (m.night) out.push(h.box(m.night.title, m.night.lines.map((l, i) => h.T(l, { dim: i > 0, key: 'd-n-' + i })), { key: 'd-night' }))
  out.push(h.btn(L.ask, () => V.act.depuisAsk(), Boolean(D.ask), 'd-ask'))
  if (D.ask) {
    out.push(h.box(null, [
      h.T(m.ask, { key: 'd-ask-text' }),
      h.T(L.ask_hint, { dim: true, key: 'd-ask-hint' }),
      h.btn(L.ask_copy, (press) => V.act.copy(m.ask, press, 'text'), false, 'd-ask-copy'),
    ], { key: 'd-ask-box', tone: 'running' }))
  }
  if (D.msg) out.push(h.T(D.msg, { dim: true, key: 'd-msg' }))
  return out
}
