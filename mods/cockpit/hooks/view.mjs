// cockpit - draws the one side pane, top to bottom at the pane's width, from native elements (Box, Text, Button, Svg
// where the surface has it). Pure except for the element factory `el` and the callbacks in V.act. The detail views are
// factory's own screen renderers (lib/factory/hooks/draw.mjs drawScreen), the gauge is band's (lib/band/hooks/gauge.ts),
// the Veille strip reads veille's view model (lib/veille/hooks/view.mjs): composed here, never copied by hand.
import { drawScreen } from '../lib/factory/hooks/draw.mjs'
import { layout, clip } from '../lib/factory/hooks/screens.mjs'
import { gaugeSvg, gaugeText, barSvg } from '../lib/band/hooks/gauge.ts'
import { cockpitConfig, sectionsOf, crumbs, treeRows, scanForRepo, agentCard, usageLine, fill, fmtTokens, fmtUsd, short, effortBars, hhmm, LEVELS } from './nav.mjs'
import { treeSvg } from './svg.mjs'

const NOOP = () => {}

function kit(el, cfg) {
  const c = cockpitConfig(cfg)
  const fc = (k) => (c.term_colors && c.term_colors[k]) || { running: 'claude', ok: 'success', warn: 'warning', bad: 'error', dim: 'inactive' }[k]
  const T = (text, o = {}) => {
    const p = { children: [String(text ?? '')], wrap: o.wrap || 'wrap' }
    if (o.tone && fc(o.tone)) p.color = fc(o.tone)
    if (o.bold) p.bold = true
    if (o.dim) p.dimColor = true
    if (o.key) p.key = o.key
    return el.Text(p)
  }
  const row = (parts, o = {}) => el.Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, ...o, children: parts.filter(Boolean) })
  const col = (parts, o = {}) => el.Box({ flexDirection: 'column', ...o, children: parts.filter(Boolean) })
  const box = (title, parts, o = {}) => el.Box({
    flexDirection: 'column', borderStyle: 'round', paddingX: 1, marginBottom: 1, ...(o.key ? { key: o.key } : {}),
    ...(o.tone && fc(o.tone) ? { borderColor: fc(o.tone) } : {}),
    children: [title ? T(title, { bold: true }) : null, ...parts].filter(Boolean),
  })
  const btn = (label, onPress, primary, key) => el.Button({ children: [label], variant: primary ? 'primary' : 'secondary', onPress, ...(key ? { key } : {}) })
  const svg = (source, alt, key) => (el.Svg ? el.Svg({ source, alt, ...(key ? { key } : {}) }) : null)
  return { T, row, col, box, btn, svg, c }
}

// V = { cfg, fcfg, scan, nav, self, busy, error, at, columns, filter, usage, gauge, veille, open, act }
export function drawCockpit(el, V0) {
  const V = { ...V0, el }
  const h = kit(el, V.cfg)
  const c = h.c
  const L = c.labels
  const out = []
  for (const s of sectionsOf(V.cfg)) {
    const part = {
      breadcrumb: drawCrumbs, tree: drawTree, diagram: drawDiagram, detail: drawDetail,
      jauge: drawJauge, usage: drawUsage, veille: drawVeille, fichiers: drawFiles,
    }[s](h, V, L)
    if (part) out.push(part)
  }
  if (V.error) out.splice(1, 0, h.T(`scanner : ${V.error}`, { tone: 'bad' }))
  return h.col(out)
}

function drawCrumbs(h, V, L) {
  const list = crumbs(V.nav, V.scan, V.cfg)
  const parts = []
  list.forEach((cr, i) => {
    if (i) parts.push(h.T('›', { dim: true, key: 'sep' + i }))
    parts.push(h.btn(clip(cr.label, 34), () => V.act.crumb(cr.level), cr.current, 'crumb-' + cr.level))
  })
  return h.col([
    h.row(parts, { alignItems: 'center' }),
    h.row([
      h.T(L.level_hint[V.nav.level] || '', { dim: true }),
      h.btn(V.busy ? L.scanning : L.refresh, () => V.act.refresh(), false, 'refresh'),
      h.T(fill(L.updated, { time: V.at ? hhmm(V.at).slice(0, 5) : '--:--' }), { dim: true }),
    ], { alignItems: 'center', marginBottom: 1 }),
  ], { key: 'breadcrumb' })
}

function rowsOf(V) {
  return V.scan ? treeRows(V.nav, V.scan, V.fcfg, V.at, V.self) : []
}

function drawTree(h, V, L) {
  if (!V.scan) return h.box(L.tree, [h.T(V.busy ? L.scanning : L.no_convs, { dim: true })], { key: 'tree' })
  const rows = rowsOf(V)
  const lay = layout(V.columns, V.fcfg)
  const items = rows.map((r) => {
    const indent = r.depth ? 2 * (r.depth - 1) : 0
    const mark = r.kind === 'workflow' ? '◇' : r.kind === 'project' ? '■' : '●'
    return h.col([
      h.row([
        r.depth ? h.T('└', { dim: true }) : null,
        h.T(mark, { tone: r.tone }),
        h.btn(clip(`${r.label}${r.self ? ` (${L.this_conv})` : ''}`, Math.max(16, lay.textMax - 8 - indent)), () => V.act.select(r), r.selected, 'node-' + r.key),
      ], { alignItems: 'center', flexWrap: 'nowrap' }),
      r.meta ? h.col([h.T(r.meta, { dim: true })], { marginLeft: r.depth ? 4 : 2 }) : null,
    ], { key: 'row-' + r.key, ...(indent ? { marginLeft: indent } : {}) })
  })
  if (rows.length <= 1 && V.nav.level !== 'mega') items.push(h.T(L.no_convs, { dim: true }))
  return h.box(`${L.tree} · ${L.levels[V.nav.level]}`, items, { key: 'tree' })
}

function drawDiagram(h, V, L) {
  const c = h.c
  if (!c.diagram.enabled || !V.scan || !V.el.Svg) return null
  const rows = rowsOf(V)
  if (!rows.length) return null
  const alt = `${L.diagram_alt} : ${rows.map((r) => `${'  '.repeat(r.depth)}${r.label}`).join(' ; ')}`.slice(0, 2000)
  return h.col([h.svg(treeSvg(rows, c.colors, c.diagram), alt, 'diagram-svg')], { key: 'diagram', marginBottom: 1 })
}

// The detail under the tree: factory's screens for the selected level, an agent card at micro.
function drawDetail(h, V, L) {
  if (!V.scan) return null
  const base = { cfg: V.fcfg, at: V.at, busy: V.busy, error: '', columns: V.columns, filter: V.filter || 'all', jfilter: 'all', jproject: '',
    picking: false, live: [], quotas: null, machine: {}, embedded: true, target: V.nav.conv,
    act: { tab: NOOP, go: (cli) => V.act.select({ kind: 'conv', id: cli }), refresh: () => V.act.refresh(), filter: (k) => V.act.filter(k), jfilter: NOOP, jproject: NOOP, pick: NOOP } }
  let body = []
  const lvl = V.nav.level
  if (lvl === 'mega') body = drawScreen(V.el, { ...base, scan: V.scan }, 'mission')
  else if (lvl === 'macro') {
    const s = scanForRepo(V.scan, V.nav.repo)
    body = [...drawScreen(V.el, { ...base, scan: s }, 'focus'), ...drawScreen(V.el, { ...base, scan: s }, 'pipeline')]
  } else if (lvl === 'medium') {
    body = V.scan.detail && V.scan.detail.cli === V.nav.conv ? drawScreen(V.el, { ...base, scan: V.scan }, 'arbre') : [h.T(L.scanning, { dim: true })]
  } else body = drawAgent(h, V, L)
  return h.col([h.T(`${L.detail} · ${L.levels[lvl]}`, { bold: true }), ...body], { key: 'detail', marginBottom: 1 })
}

function drawAgent(h, V, L) {
  const a = agentCard(V.scan, V.nav.agent, V.fcfg)
  if (!a) return [h.T(L.agent_none, { dim: true })]
  const lay = layout(V.columns, V.fcfg)
  const tone = { running: 'running', done: 'ok', failed: 'bad', stopped: 'dim' }[a.status] || 'dim'
  const card = h.box(`${L.agent_title} · ${a.type}`, [
    a.desc ? h.T(a.desc) : null,
    h.row([h.T(short(a.model), { bold: true }), h.T(`effort ${effortBars(a.effort)} ${a.effort}`), h.T(a.status, { tone, bold: true }),
      a.explicit ? null : h.T('modèle non précisé (hérité)', { tone: 'warn' })]),
    h.row([h.T(`${fmtTokens(a.tokens)} tok`), h.T(fmtUsd(a.cost)), h.T(`ctx ${fmtTokens(a.ctx)}`, { dim: true }),
      h.T(`outils ${a.tools} (lecture ${a.readonly})`, { dim: true })]),
    a.workflow ? h.T(`workflow ${a.workflow}${a.phase ? ' · phase ' + a.phase : ''}`, { dim: true }) : null,
    a.started ? h.T(`début ${hhmm(a.started).slice(0, 5)}${a.last ? ' · dernier ' + hhmm(a.last).slice(0, 5) : ''}${a.lastTool ? ' · ' + a.lastTool : ''}`, { dim: true }) : null,
    a.task ? h.T(clip(a.task, lay.textMax * 3), { dim: true }) : null,
  ], { key: 'agent-card', tone })
  const log = h.box(L.agent_log, a.events.length
    ? a.events.map((e, i) => h.row([h.T(hhmm(e.at).slice(0, 5), { dim: true }), h.T(e.kind, { bold: e.kind === 'prompt' }), h.T(clip(e.text, lay.textMax - 16))], { key: 'ae' + i, flexWrap: 'nowrap' }))
    : [h.T(a.hasLog ? '—' : L.scanning, { dim: true })], { key: 'agent-log' })
  return [card, log]
}

// ---- strips: one header button each (▸ closed, ▾ open) with a one-line summary; the body only when open ------------

function strip(h, V, id, title, summary, body) {
  const open = Boolean(V.open && V.open[id])
  return h.col([
    h.row([h.btn(`${open ? '▾' : '▸'} ${title}`, () => V.act.toggle(id), false, 'strip-' + id), summary ? h.T(summary, { dim: true }) : null], { alignItems: 'center' }),
    open ? h.col(body(), { marginLeft: 2 }) : null,
  ], { key: 'strip-' + id, marginBottom: 1 })
}

function drawJauge(h, V, L) {
  const g = V.gauge
  const gc = (V.bandCfg && V.bandCfg.gauge) || {}
  return strip(h, V, 'jauge', L.jauge, g ? g.title : L.not_readable, () => {
    if (!g) return [h.T(L.not_readable, { dim: true })]
    const lay = layout(V.columns, V.fcfg)
    return [
      h.svg(gaugeSvg(g, gc.colors || {}, gc.width || 300), `${g.title}${g.marks.map((m) => ' · ' + m.label).join('')}`, 'gauge-svg')
        || h.T(gaugeText(g, Math.min(gc.text_width || 30, lay.textMax)), { tone: g.level }),
      g.line ? h.T(g.line, { dim: true }) : null,
      V.bandMissing ? h.T(fill(L.module_missing, { mod: 'band' }), { dim: true }) : null,
    ]
  })
}

function bar(h, V, pct, key) {
  const c = h.c
  const lay = layout(V.columns, V.fcfg)
  const s = h.svg(barSvg(pct, c.colors.usage, c.usage_bar_width || 300), `${Math.round(pct)} %`, key)
  if (s) return s
  const w = Math.min(30, lay.bar)
  const full = Math.round((Math.max(0, Math.min(100, pct)) / 100) * w)
  return h.T('█'.repeat(full) + '░'.repeat(w - full), { tone: 'running', key })
}

function drawUsage(h, V, L) {
  const u = V.usage
  const head = u ? [u.windows[0], u.windows[1]].filter((w) => w.available).map((w) => `${w.label.split(' ')[0]} ${Math.round(w.pct)} %`).join(' · ') : ''
  return strip(h, V, 'usage', L.usage, head || (u ? usageLine(u) : L.not_readable), () => {
    if (!u) return [h.T(L.not_readable, { dim: true })]
    const out = []
    u.windows.forEach((w, i) => {
      out.push(h.row([h.T(w.label, { bold: true }), h.T(w.available ? `${Math.round(w.pct)} %` : w.text, { dim: !w.available })], { key: 'uw' + i, justifyContent: 'space-between', flexWrap: 'nowrap' }))
      if (w.available) { out.push(bar(h, V, w.pct, 'ub' + i)); if (w.when) out.push(h.T(w.when, { dim: true, key: 'uwh' + i })) }
    })
    out.push(h.row([h.T(L.credits, { bold: true }), h.T(u.credits.text, { dim: !u.credits.available })], { key: 'ucr', justifyContent: 'space-between' }))
    const s = u.session
    out.push(h.T(L.this_session, { bold: true, key: 'uts' }))
    out.push(h.row([
      s.cost !== null && s.cost !== undefined ? h.T(`${L.cost} ${fmtUsd(s.cost)}`) : null,
      ...s.share.map((x) => h.T(`${x.family[0].toUpperCase()}${x.family.slice(1)} ${x.pct} %`)),
      s.cacheHit !== null ? h.T(`${L.cache_hit} ${s.cacheHit} %`) : null,
    ], { key: 'usess' }))
    if (s.contributors.length) {
      out.push(h.T(L.contributing, { dim: true, key: 'ucon' }))
      s.contributors.forEach((x, i) => {
        out.push(h.row([h.T(x.type, { bold: true }), h.T(`${x.pct} %`, { dim: true })], { key: 'uc' + i, justifyContent: 'space-between' }))
        out.push(bar(h, V, x.pct, 'ucb' + i))
      })
    }
    return out
  })
}

function drawVeille(h, V, L) {
  const vm = V.veille
  if (!vm) return strip(h, V, 'veille', L.veille, L.veille_off, () => [h.T(L.veille_off, { dim: true })])
  const open = vm.alerts.filter((a) => !a.acked)
  const summary = `${vm.mode.label || vm.mode.name} · ${open.length} alerte(s)${vm.julian ? ` · ${vm.julian} attend(ent) Julian` : ''}`
  return strip(h, V, 'veille', L.veille, summary, () => [
    h.T(vm.watcher.text, { tone: vm.watcher.tone === 'bad' ? 'bad' : undefined, dim: vm.watcher.tone !== 'bad' }),
    ...(open.length ? open.slice(0, 5).map((a, i) => h.T(`• ${a.what || a.key}${a.title ? ' · ' + a.title : ''}`, { tone: a.julian ? 'warn' : a.severity === 'bad' ? 'bad' : undefined, key: 'va' + i }))
      : [h.T(L.veille_none, { dim: true })]),
  ])
}

function drawFiles(h, V, L) {
  return h.row([h.btn(L.fichiers_button, () => V.act.files(), false, 'files'), h.T(L.fichiers_hint, { dim: true })], { key: 'fichiers', alignItems: 'center', marginBottom: 1 })
}

export { LEVELS }
