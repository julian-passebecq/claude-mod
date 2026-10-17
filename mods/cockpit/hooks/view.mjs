// cockpit - draws the one side pane, top to bottom at the pane's width, from native elements (Box, Text, Button, Svg
// where the surface has it). Pure except for the element factory `el` and the callbacks in V.act.
// Order by scope: a small breadcrumb, then four foldable sections, each a one-line summary while closed:
//   ▾ Cette conversation (open)  status line, its tree lead → sub-conversations → Workflows → agents, step, PR/CI
//   ▸ Ce projet                  project tree + factory's Focus and Pipeline (lib/factory/hooks/draw.mjs drawScreen)
//   ▸ Tous les projets           one or two lines per project
//   ▸ Qui consomme               top 3 conversations + top project of a window (usage's classement.json), full view button
//   ▸ Claude global              quotas (band's bar, lib/band/hooks/gauge.ts), Veille alerts, a /machine button
import { drawScreen } from '../lib/factory/hooks/draw.mjs'
import { drawWorkflowBody } from '../lib/factory/hooks/workflow_draw.mjs'
import { layout, clip } from '../lib/factory/hooks/screens.mjs'
import { barSvg } from '../lib/band/hooks/gauge.ts'
import {
  cockpitConfig, sectionsOf, crumbs, treeRows, scanForRepo, agentCard, canOpenAgent, usageLine, fill, fmtTokens, fmtUsd, short, effortBars, hhmm, LEVELS,
  projectsOf, convHead, convSummary, projectSummary, allSummary, projectLine, globalSummary, findSession, repoOf, consoSummary, tabsOf, menuOf,
} from './nav.mjs'
import { treeSvg } from './svg.mjs'
import { drawNuit, drawRelais, drawGalerie } from './decide_view.mjs'
import { drawDepuis } from './depuis_view.mjs'
import { depuisConfig } from '../lib/depuis.mjs'

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
  // a label on the left, a number on the right (padded so digits line up)
  const lr = (left, right, o = {}) => row([T(left, { bold: o.bold, dim: o.dimLeft, wrap: 'truncate-end' }), T(right, { dim: o.dimRight, tone: o.tone })],
    { justifyContent: 'space-between', flexWrap: 'nowrap', ...(o.key ? { key: o.key } : {}) })
  return { T, row, col, box, btn, svg, lr, c }
}

// V = { cfg, fcfg, scan, nav, self, busy, error, at, columns, filter, usage, veille, open, act, tab, cards, wf…, machine,
//       who, nuitData, relaisData, galerieData, galView, launch, nuitMsg, teamSession, teamTitle, now }
// The vertical menu (the band's 6 entries) sits at the left; under menu.min_columns it is one row on top.
export function drawCockpit(el, V0) {
  const h0 = kit(el, V0.cfg)
  const menu = menuOf(V0.cfg, V0.columns)
  const V = { ...V0, el, columns: menu.position === 'left' && V0.columns ? Math.max(30, V0.columns - menu.width - 1) : V0.columns }
  const body = drawBody(el, V)
  if (menu.position === 'off') return body
  const btns = menu.items.map((m, i) => h0.btn(m.label, () => V.act.menu(m), Boolean(m.self), 'menu-' + i))
  if (menu.position === 'top') return h0.col([h0.row(btns, { key: 'menu', marginBottom: 1 }), body])
  return el.Box({ flexDirection: 'row', flexWrap: 'nowrap', gap: 1, children: [
    el.Box({ flexDirection: 'column', width: menu.width, flexShrink: 0, key: 'menu', children: btns }),
    el.Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, key: 'body', children: [body] }),
  ] })
}

function drawBody(el, V) {
  const h = kit(el, V.cfg)
  const L = h.c.labels
  const tabs = tabsOf(V.cfg)
  const tab = tabs.some((t) => t.id === V.tab) || V.tab === 'nuit' || V.tab === 'depuis' ? V.tab : 'home'
  const out = [h.row(tabs.map((t) => h.btn(t.label, () => V.act.tab(t.id), t.id === tab, 'tab-' + t.id)), { key: 'tabs', marginBottom: 1 })]
  if (tab === 'nuit') return h.col([...out, ...drawNuit(h, V)])
  if (tab === 'depuis') return h.col([...out, ...drawDepuis(h, V)])
  if (tab === 'relais') return h.col([...out, ...drawRelais(h, V)])
  if (tab === 'galerie') return h.col([...out, ...drawGalerie(h, V)])
  if (tab !== 'home') return h.col([...out, ...drawTab(h, V, L, tab)])
  // Nuit · Jour · Codex: the day/night decision and the Claude-only default of the cards
  const dn = h.c.day_night || {}
  const dc = depuisConfig(V.cfg)
  if (dc.enabled !== false) out.push(h.btn(dc.labels.button, () => V.act.tab('depuis'), true, 'btn-depuis'))
  out.push(h.row([
    dn.enabled !== false ? h.btn(L.night_button, () => V.act.tab('nuit'), false, 'btn-nuit') : null,
    dn.enabled !== false ? h.btn(L.day_button, () => V.act.day(), false, 'btn-jour') : null,
    h.btn(V.who === 'all' ? L.codex_on : L.codex_off, () => V.act.who(V.who === 'all' ? 'claude' : 'all'), V.who === 'all', 'btn-codex'),
  ], { key: 'day-night', marginBottom: 1 }))
  const secs = sectionsOf(V.cfg)
  if (secs[0] !== 'breadcrumb') out.push(drawCards(h, V, L))
  for (const s of secs) {
    const part = { breadcrumb: drawCrumbs, conv: drawConv, project: drawProject, all: drawAll, conso: drawConso, global: drawGlobal, fichiers: drawFiles }[s](h, V, L)
    if (part) out.push(part)
    if (s === 'breadcrumb') out.push(drawCards(h, V, L)) // the cards right under the breadcrumb, above the sections
  }
  if (V.error) out.push(h.T(`scanner : ${V.error}`, { tone: 'bad', key: 'scan-error' }))
  return h.col(out)
}

// ---- 0. the summary cards: one line each, a button to the detail ----------------------------------------------------

function drawCards(h, V, L) {
  const list = V.cards || []
  if (!list.length) return null
  const rows = list.map((c) => h.col([
    h.row([
      h.T(c.title, { bold: true, wrap: 'truncate-end' }),
      h.btn(L.card_open || 'Voir', () => V.act.card(c), false, 'card-btn-' + c.id),
    ], { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }),
    h.T(c.line, { tone: c.tone || undefined, dim: c.tone === 'dim', wrap: 'wrap', key: 'card-line-' + c.id }),
    ...(c.items || []).map((it, i) => h.T(`• ${it.text}`, { dim: true, key: `card-${c.id}-${i}`, wrap: 'wrap' })),
    c.more ? h.T(`+ ${c.more}`, { dim: true, key: `card-${c.id}-more` }) : null,
  ], { key: 'card-' + c.id, marginBottom: 1 }))
  if (V.cardsError) rows.push(h.T(`cartes : ${V.cardsError}`, { tone: 'bad', key: 'cards-error' }))
  return h.box(null, rows, { key: 'cards' })
}

// ---- factory's screens and Machine, as tabs of the same pane --------------------------------------------------------

function drawTab(h, V, L, tab) {
  const head = h.row([h.btn((tab === 'workflow' ? V.wfBusy : V.busy) ? '…' : '↻', () => V.act.refresh(), false, 'tab-refresh'),
    h.T(V.at ? hhmm(tab === 'workflow' ? V.wfAt || V.at : V.at).slice(0, 5) : '--:--', { dim: true, key: 'tab-time' })], { key: 'tab-head', alignItems: 'center', marginBottom: 1 })
  const base = { cfg: V.fcfg, at: V.at, busy: V.busy, error: V.error, columns: V.columns, filter: V.filter || 'all', jfilter: V.jfilter || 'all', jproject: V.jproject || '',
    picking: false, live: [], quotas: null, machine: V.machine || {}, embedded: true, target: V.nav && V.nav.conv, self: V.self, scan: V.scan,
    canView: V.canView, viewAgent: V.viewAgent,
    wf: V.wf, wfAt: V.wfAt, wfBusy: V.wfBusy, wfError: V.wfError, wfScope: V.wfScope, wfOpen: V.wfOpen,
    act: { tab: (id) => V.act.tab(id), go: (cli) => V.act.go(cli), refresh: () => V.act.refresh(), filter: (k) => V.act.filter(k), jfilter: (k) => V.act.jfilter(k),
      jproject: (p) => V.act.jproject(p), pick: () => V.act.pick(), wfScope: (k) => V.act.wfScope(k), wfToggle: (k, o) => V.act.wfToggle(k, o),
      openAgent: (id) => V.act.openAgent(id), backToConv: () => V.act.backToConv() } }
  if (tab === 'workflow') return [head, ...drawWorkflowBody(V.el, base)]
  if (tab === 'machine') {
    const m = V.machine || {}
    const body = m.sample ? drawScreen(V.el, { ...base, scan: V.scan || { sessions: [] } }, 'systeme') : [h.T(m.error ? `machine : ${m.error}` : L.scanning, { tone: m.error ? 'bad' : undefined, dim: !m.error, key: 'm-wait' })]
    return [head, ...body]
  }
  if (!V.scan) return [head, V.error ? h.T(`scanner : ${V.error}`, { tone: 'bad', key: 'tab-err' }) : null, h.T(L.scanning, { dim: true, key: 'tab-scan' })].filter(Boolean)
  return [head, ...drawScreen(V.el, base, tab)]
}

// One small row: Méga › projet › conversation › agent, then refresh and the time.
function drawCrumbs(h, V, L) {
  const list = crumbs(V.nav, V.scan, V.cfg)
  const parts = []
  list.forEach((cr, i) => {
    if (i) parts.push(h.T('›', { dim: true, key: 'sep' + i }))
    parts.push(h.btn(clip(cr.label, 24), () => V.act.crumb(cr.level), cr.current, 'crumb-' + cr.level))
  })
  parts.push(h.btn(V.busy ? '…' : '↻', () => V.act.refresh(), false, 'refresh'))
  parts.push(h.T(V.at ? hhmm(V.at).slice(0, 5) : '--:--', { dim: true, key: 'time' }))
  return h.row(parts, { key: 'breadcrumb', alignItems: 'center', marginBottom: 1 })
}

// A foldable section: one header button (▸ closed, ▾ open) and its one-line summary; the body only when open.
// The summary shows only while closed (open, the body says it); it is clipped to stay on the header's line.
function section(h, V, id, title, summary, body) {
  const open = Boolean(V.open && V.open[id])
  const label = `${open ? '▾' : '▸'} ${title}`
  const room = (V.columns || 75) - label.length - 6
  return h.col([
    h.row([h.btn(label, () => V.act.toggle(id), false, 'sec-' + id), summary && !open && room > 8 ? h.T(clip(summary, room), { dim: true, wrap: 'truncate-end' }) : null],
      { alignItems: 'center', flexWrap: 'nowrap' }),
    open ? h.col(body(), { marginLeft: 1 }) : null,
  ], { key: 'sec-' + id, marginBottom: 1 })
}

function treeItems(h, V, L, rows) {
  const lay = layout(V.columns, V.fcfg)
  return rows.map((r) => {
    const indent = r.depth ? 2 * r.depth : 0
    const mark = r.kind === 'workflow' ? '◇' : r.kind === 'project' ? '■' : '●'
    return h.col([
      h.row([
        r.depth ? h.T('└', { dim: true }) : null,
        h.T(mark, { tone: r.tone }),
        h.btn(clip(`${r.label}${r.self ? ` (${L.this_conv})` : ''}`, Math.max(16, lay.textMax - 8 - indent)), () => V.act.select(r), r.selected, 'node-' + r.key),
      ], { alignItems: 'center', flexWrap: 'nowrap' }),
      r.meta ? h.col([h.T(r.meta, { dim: true, wrap: 'truncate-end' })], { marginLeft: r.depth ? 4 : 2 }) : null,
    ], { key: 'row-' + r.key, ...(indent ? { marginLeft: indent } : {}) })
  })
}

// ---- 1. Cette conversation --------------------------------------------------------------------------------------------

function drawConv(h, V, L) {
  const cli = V.nav.conv || V.self
  const head = V.scan && cli ? convHead(V.scan, cli, V.fcfg, V.at) : null
  const mine = cli && cli === V.self
  const title = mine ? L.sec_conv : `${L.sec_conv_other} · ${clip(head ? head.title : String(cli || ''), 28)}`
  return section(h, V, 'conv', title, head ? convSummary(head, V.fcfg) : (V.busy ? L.scanning : L.no_convs), () => {
    if (!head) return [h.T(V.busy ? L.scanning : L.no_convs, { dim: true })]
    const out = [
      h.row([h.T(head.model, { bold: true }), h.T(`${effortBars(head.effort)} ${head.effort}`), h.T(`ctx ${head.ctxPct} %`), h.T(head.stateLabel, { tone: head.tone, bold: true })], { key: 'cv-status' }),
    ]
    if (head.reason) out.push(h.T(head.reason, { tone: head.tone, key: 'cv-reason', wrap: 'truncate-end' }))
    const s0 = findSession(V.scan, cli)
    const nav = V.nav.conv ? V.nav : { ...V.nav, conv: cli, repo: V.nav.repo || (s0 ? repoOf(s0) : null) }
    const all = treeRows({ ...nav, level: LEVELS.indexOf(nav.level) >= 2 ? nav.level : 'medium' }, V.scan, V.fcfg, V.at, V.self, { convOnly: true })
    // finished agents and Workflows fold into one line unless asked (a button), so the running work stays in view
    const showDone = Boolean(V.open && V.open.conv_done)
    const keep = (r) => r.kind === 'conv' || r.state === 'running' || r.selected
    const rows = showDone ? all : all.filter(keep)
    const hidden = all.length - rows.length
    out.push(...treeItems(h, V, L, rows))
    if (hidden || showDone) out.push(h.btn(showDone ? L.hide_done : fill(L.show_done, { n: hidden }), () => V.act.toggle('conv_done'), false, 'conv-done'))
    const bits = []
    if (head.workflow) bits.push(head.workflow)
    if (head.step) bits.push(`${L.step} : ${head.step}`)
    if (bits.length) out.push(h.T(bits.join(' · '), { dim: true, key: 'cv-step', wrap: 'truncate-end' }))
    out.push(head.pr
      ? h.T(`PR #${head.pr.number} · ${head.pr.state} · CI ${head.pr.ci}`, { key: 'cv-pr', tone: head.pr.ci === 'failed' ? 'bad' : head.pr.ci === 'success' ? 'ok' : undefined })
      : h.T(L.no_pr, { dim: true, key: 'cv-pr' }))
    if (V.nav.level === 'micro') out.push(...drawAgent(h, V, L))
    return out
  })
}

function drawAgent(h, V, L) {
  const a = agentCard(V.scan, V.nav.agent, V.fcfg)
  if (!a) return [h.T(L.agent_none, { dim: true, key: 'agent-none' })]
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
  // « Ouvrir l'agent »: the engine's own transcript view of this agent ($.ui.view, 2.1.300+), and the way back
  const nav = h.row([
    canOpenAgent(a, V.self, V.canView) && V.viewAgent !== a.id ? h.btn(L.open_agent, () => V.act.openAgent(a.id), true, 'agent-open') : null,
    V.canView && V.viewAgent ? h.btn(L.back_conv, () => V.act.backToConv(), false, 'agent-back') : null,
  ], { key: 'agent-nav' })
  const log = h.box(L.agent_log, a.events.length
    ? a.events.map((e, i) => h.row([h.T(hhmm(e.at).slice(0, 5), { dim: true }), h.T(e.kind, { bold: e.kind === 'prompt' }), h.T(clip(e.text, lay.textMax - 16))], { key: 'ae' + i, flexWrap: 'nowrap' }))
    : [h.T(a.hasLog ? '—' : L.scanning, { dim: true })], { key: 'agent-log' })
  return [card, nav, log]
}

// ---- 2. Ce projet -----------------------------------------------------------------------------------------------------

function drawProject(h, V, L) {
  const repo = V.nav.repo
  const p = V.scan && repo ? projectsOf(V.scan, V.fcfg, V.at).find((x) => x.repo === repo) : null
  return section(h, V, 'project', repo ? `${L.sec_project} · ${clip(repo, 24)}` : L.sec_project, p ? projectSummary(p, V.fcfg) : '', () => {
    if (!V.scan || !repo) return [h.T(V.busy ? L.scanning : L.no_convs, { dim: true })]
    const nav = { ...V.nav, level: V.nav.level === 'mega' ? 'macro' : V.nav.level }
    const rows = treeRows({ ...nav, level: 'macro' }, V.scan, V.fcfg, V.at, V.self).filter((r) => r.kind !== 'project')
    const out = [...treeItems(h, V, L, rows.map((r) => ({ ...r, depth: r.depth - 1 })))]
    const c = h.c
    if (c.diagram.enabled && V.el.Svg && rows.length) {
      const alt = `${L.diagram_alt} : ${rows.map((r) => `${'  '.repeat(r.depth)}${r.label}`).join(' ; ')}`.slice(0, 2000)
      out.push(h.svg(treeSvg(rows, c.colors, c.diagram), alt, 'diagram-svg'))
    }
    const base = { cfg: V.fcfg, at: V.at, busy: V.busy, error: '', columns: V.columns, filter: V.filter || 'all', jfilter: 'all', jproject: '',
      picking: false, live: [], quotas: null, machine: {}, embedded: true, target: V.nav.conv,
      act: { tab: NOOP, go: (cli) => V.act.select({ kind: 'conv', id: cli }), refresh: () => V.act.refresh(), filter: (k) => V.act.filter(k), jfilter: NOOP, jproject: NOOP, pick: NOOP } }
    const s = scanForRepo(V.scan, repo)
    out.push(...drawScreen(V.el, { ...base, scan: s }, 'focus'), ...drawScreen(V.el, { ...base, scan: s }, 'pipeline'))
    return out
  })
}

// ---- 3. Tous les projets ----------------------------------------------------------------------------------------------

function drawAll(h, V, L) {
  const ps = V.scan ? projectsOf(V.scan, V.fcfg, V.at) : []
  return section(h, V, 'all', L.sec_all, ps.length ? allSummary(ps, V.fcfg) : '', () => {
    if (!ps.length) return [h.T(V.busy ? L.scanning : L.no_convs, { dim: true })]
    const w = Math.max(...ps.map((p) => fmtUsd(p.cost).length))
    return ps.map((p) => h.col([
      h.row([
        h.row([h.T('■', { tone: p.tone }), h.btn(clip(p.repo, 30), () => V.act.select({ kind: 'project', id: p.repo }), p.repo === V.nav.repo, 'proj-' + p.repo)], { alignItems: 'center', flexWrap: 'nowrap' }),
        h.T(fmtUsd(p.cost).padStart(w), { dim: true }),
      ], { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }),
      h.T(projectLine(p, V.fcfg), { dim: true, wrap: 'truncate-end' }),
    ], { key: 'pl-' + p.repo, marginLeft: 1 }))
  })
}

// ---- 4. Claude global -------------------------------------------------------------------------------------------------

function bar(h, V, pct, key, width) {
  const c = h.c
  const s = h.svg(barSvg(pct, c.colors.usage, width || c.usage_bar_width || 160), `${Math.round(pct)} %`, key)
  if (s) return s
  const w = 12
  const full = Math.round((Math.max(0, Math.min(100, pct)) / 100) * w)
  return h.T('█'.repeat(full) + '░'.repeat(w - full), { tone: 'running', key })
}

function drawGlobal(h, V, L) {
  const u = V.usage
  const vm = V.veille
  return section(h, V, 'global', L.sec_global, globalSummary(u, vm), () => {
    const out = []
    if (u) {
      u.windows.forEach((w, i) => {
        if (!w.available) { out.push(h.lr(w.label, w.text, { key: 'uw' + i, dimLeft: true, dimRight: true })); return }
        out.push(h.lr(w.label, `${String(Math.round(w.pct)).padStart(3)} %`, { key: 'uw' + i, bold: true }))
        out.push(h.row([bar(h, V, w.pct, 'ub' + i), w.when ? h.T(w.when, { dim: true }) : null], { key: 'ubr' + i, alignItems: 'center', flexWrap: 'nowrap' }))
      })
      out.push(h.lr(L.credits, u.credits.text, { key: 'ucr', dimLeft: !u.credits.available, dimRight: !u.credits.available }))
      const line = usageLine(u)
      if (line) out.push(h.lr(L.this_session, line, { key: 'uts' }))
    } else out.push(h.T(L.not_readable, { dim: true, key: 'u-none' }))
    // Veille
    if (!vm) out.push(h.lr(L.veille, L.veille_off.replace(/^veille : /, ''), { key: 'v-off', dimLeft: true, dimRight: true }))
    else {
      const open = vm.alerts.filter((a) => !a.acked)
      out.push(h.lr(L.veille, `${vm.mode.label || vm.mode.name} · ${open.length} alerte(s)`, { key: 'v-head', bold: true, tone: vm.watcher.tone === 'bad' ? 'bad' : undefined }))
      if (vm.watcher.tone === 'bad') out.push(h.T(vm.watcher.text, { tone: 'bad', key: 'v-w' }))
      open.slice(0, 3).forEach((a, i) => out.push(h.T(`• ${a.what || a.key}${a.title ? ' · ' + a.title : ''}`, { tone: a.julian ? 'warn' : a.severity === 'bad' ? 'bad' : undefined, key: 'va' + i, wrap: 'truncate-end' })))
    }
    out.push(h.row([h.T(L.machine, { bold: true }), h.btn(L.machine_button, () => V.act.machine(), false, 'machine')], { key: 'machine-row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
    return out
  })
}

// « Qui consomme »: preset toggle, top conversations, the top project, a button to the full Classement (/conso classement).
function drawConso(h, V, L) {
  const c = V.conso
  return section(h, V, 'conso', L.sec_conso, consoSummary(c), () => {
    const out = []
    const presets = (c && c.presets) || (h.c.qui_consomme && h.c.qui_consomme.presets) || []
    const cur = c ? c.preset.id : V.consoPreset
    out.push(h.row(presets.map((p) => h.btn(p.label, () => V.act.consoPreset(p.id), p.id === cur, 'cp-' + p.id)), { key: 'conso-presets', alignItems: 'center' }))
    if (!c) out.push(h.T(L.conso_none, { dim: true, key: 'conso-none' }))
    else {
      out.push(h.lr(`${c.preset.label}`, `${fmtTokens(c.total.tokens)} · ${fmtUsd(c.total.cost)}`, { key: 'conso-total', bold: true }))
      c.rows.forEach((r, i) => out.push(h.lr(`${i + 1}. ${clip(r.label, 34)}${r.project ? ` (${r.project})` : ''}`, `${fmtUsd(r.cost)} · ${r.pct} %`, { key: 'conso-r' + i })))
      if (c.project) out.push(h.lr(`${L.conso_project} : ${c.project.label}`, `${fmtUsd(c.project.cost)} · ${c.project.pct} %`, { key: 'conso-p', dimLeft: true }))
    }
    out.push(h.row([h.btn(L.conso_full, () => V.act.consoFull(), false, 'conso-full')], { key: 'conso-full-row' }))
    return out
  })
}

function drawFiles(h, V, L) {
  return h.row([h.btn(L.fichiers_button, () => V.act.files(), false, 'files')], { key: 'fichiers', alignItems: 'center', marginBottom: 1 })
}

export { LEVELS }
