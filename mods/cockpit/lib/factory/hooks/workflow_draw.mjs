// factory « Workflow » screen and the pane around every screen, native elements only (Box, Text, Button).
// drawFactoryPane is drawPane (draw.mjs) plus a « Workflow » tab: the top bar is drawn here and the other screens come
// from draw.mjs's drawScreen, so draw.mjs, screens.mjs and factory.config.json (byte-copied by cockpit) stay as they are.
// Pure except for `el` and the callbacks in V.act. View models: workflow.mjs; the Gantt bars, axis and legend are
// lib/core/gantt.mjs's (the ci mod's Diagramme draws with the same renderer).
import { hhmm, short, family } from './logic.mjs'
import { screensConfig, tabsOf, layout, clip } from './screens.mjs'
import { drawScreen } from './draw.mjs'
import {
  workflowConfig, workflowScreen, gantt, axis, ganttLegend, fill, frTokens, frUsd, frDur, clock,
} from './workflow.mjs'

function mk(el, cfg) {
  const color = (k) => (cfg && cfg.colors && cfg.colors[k]) || undefined
  const T = (text, o = {}) => {
    const p = { children: [String(text ?? '')], wrap: o.wrap || 'wrap' }
    if (o.color) p.color = color(o.color) || o.color
    if (o.bold) p.bold = true
    if (o.dim) p.dimColor = true
    return el.Text(p)
  }
  const row = (parts, o = {}) => el.Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, ...o, children: parts.filter(Boolean) })
  const col = (parts, o = {}) => el.Box({ flexDirection: 'column', ...o, children: parts.filter(Boolean) })
  const section = (title, parts, o = {}) => el.Box({
    flexDirection: 'column', borderStyle: 'round', borderColor: color(o.color || 'dim'), paddingX: 1, marginBottom: 1,
    ...(o.key ? { key: o.key } : {}), ...(o.marginLeft ? { marginLeft: o.marginLeft } : {}),
    children: [title ? T(title, { bold: true, color: o.color }) : null, ...parts].filter(Boolean),
  })
  const btn = (label, onPress, primary) => el.Button({ children: [label], variant: primary ? 'primary' : 'secondary', onPress })
  return { T, row, col, section, btn, color }
}

const hm = (ts) => hhmm(ts).slice(0, 5)

export function workflowTab(cfg) {
  return { id: 'workflow', label: workflowConfig(cfg).labels.tab }
}

// Tabs of factory with « Workflow » inserted after workflow.tab_after (or at the end).
export function allTabs(cfg) {
  const tabs = [...tabsOf(cfg)]
  const at = tabs.findIndex((t) => t.id === workflowConfig(cfg).tab_after)
  tabs.splice(at >= 0 ? at + 1 : tabs.length, 0, workflowTab(cfg))
  return tabs
}

// V = drawPane's V + { wf, wfAt, wfBusy, wfError, wfScope, wfOpen }
export function drawFactoryPane(el, V) {
  const cfg = V.cfg || {}
  const L = screensConfig(cfg).labels
  const h = mk(el, cfg)
  const tabs = allTabs(cfg)
  const tab = tabs.some((t) => t.id === V.tab) ? V.tab : (tabs[0] || { id: 'mission' }).id
  const isWf = tab === 'workflow'
  const at = isWf ? V.wfAt : V.at
  const top = [
    h.row(tabs.map((t) => h.btn(t.label, () => V.act.tab(t.id), t.id === tab)), { marginBottom: 1 }),
    h.row([
      h.btn((isWf ? V.wfBusy : V.busy) ? L.refreshing : L.refresh, () => V.act.refresh()),
      h.T(fill(L.updated, { time: at ? hm(at) : '--:--' }), { dim: true }),
    ], { marginBottom: 1, alignItems: 'center' }),
  ]
  if (isWf) {
    if (V.wfError) top.push(h.T(`workflow_scan : ${V.wfError}`, { color: 'bad' }))
    if (!V.wf) return h.col([...top, h.T(workflowConfig(cfg).labels.scanning, { dim: true })])
    return h.col([...top, ...drawWorkflow(h, V, cfg, layout(V.columns, cfg))])
  }
  if (V.error) top.push(h.T(`scanner : ${V.error}`, { color: 'bad' }))
  if (!V.scan) return h.col([...top, h.T(L.scanning, { dim: true })])
  return h.col([...top, ...drawScreen(el, V, tab)])
}

// The Workflow screen's body without factory's tab bar, for a mod that composes it in its own pane (cockpit).
export function drawWorkflowBody(el, V) {
  const cfg = V.cfg || {}
  const h = mk(el, cfg)
  const out = []
  if (V.wfError) out.push(h.T(`workflow_scan : ${V.wfError}`, { color: 'bad' }))
  if (!V.wf) return [...out, h.T(workflowConfig(cfg).labels.scanning, { dim: true })]
  return [...out, ...drawWorkflow(h, V, cfg, layout(V.columns, cfg))]
}

const STATUS_COLOR = { running: 'running', done: 'done', completed: 'done', failed: 'failed', killed: 'warn', interrupted: 'warn', skipped: 'dim', waiting: 'dim', tail: 'running', now: 'warn', empty: 'dim' }

function isOpen(V, key, dflt) {
  const o = V.wfOpen || {}
  return Object.prototype.hasOwnProperty.call(o, key) ? Boolean(o[key]) : dflt
}

// A foldable block: « ▾ title » button, then its parts when open.
function fold(h, V, W, key, title, parts, dflt, o = {}) {
  const open = isOpen(V, key, dflt)
  return h.col([
    h.row([h.btn(`${open ? W.labels.open : W.labels.closed} ${title}`, () => V.act.wfToggle(key, !open)), ...(o.extra || [])], { alignItems: 'center' }),
    open ? h.col(parts, { marginLeft: 2 }) : null,
  ], { key: 'fold-' + key, marginBottom: 1 })
}

export function drawWorkflow(h, V, cfg, lay) {
  const W = workflowConfig(cfg)
  const WL = W.labels
  const now = V.wfAt || Date.now()
  const s = workflowScreen(V.wf, cfg, now)
  const scope = V.wfScope || W.scope
  const out = [h.T(WL.title, { bold: true })]
  out.push(h.row([
    h.btn(WL.scope_conv, () => V.act.wfScope('conversation'), scope !== 'all'),
    h.btn(WL.scope_all, () => V.act.wfScope('all'), scope === 'all'),
  ], { marginBottom: 1 }))
  // PC-wide parallelism vs the rules
  const lim = s.limits
  out.push(h.section(WL.limits, [
    h.T(lim.text, { color: lim.level === 'bad' ? 'bad' : lim.level === 'warn' ? 'warn' : undefined, bold: lim.level !== 'ok' }),
    ...lim.highlights.map((x) => h.T(`▲ ${x.text}`, { color: x.level })),
    h.T(WL.limits_note, { dim: true }),
  ], { key: 'limits', color: lim.level === 'bad' ? 'bad' : 'dim' }))
  // Vitesse of the whole scope
  if (s.runs.length) out.push(speedBlock(h, V, W, s.speed, 'scope', fill(WL.speed_scope, { scope: scope === 'all' ? WL.scope_all.toLowerCase() : WL.scope_conv.toLowerCase() }), false))
  if (!s.runs.length) out.push(h.T(fill(scope === 'all' ? WL.none_all : WL.none, { hours: W.hours }), { dim: true }))
  for (const v of s.runs) out.push(runBlock(h, V, cfg, W, lay, v, now))
  out.push(h.T(WL.glossary, { dim: true }))
  return out
}

function speedBlock(h, V, W, sp, key, title, dflt) {
  const WL = W.labels
  return fold(h, V, W, 'speed-' + key, `${title} : ${sp.sentence}`, sp.empty ? [h.T(sp.sentence, { dim: true })] : [
    h.row([h.T(`0 ┤${sp.spark}├ ${sp.max}`, { color: 'running' }), h.T(`moy. ${sp.avg.toFixed(1).replace('.', ',')} · plafond ${sp.cap}`, { dim: true })], { flexWrap: 'nowrap' }),
    h.T(sp.capText, { dim: true }),
    sp.idleText ? h.T(sp.idleText) : null,
    ...sp.could.slice(0, 6).map((c) => h.T(`↔ ${WL.speed_could} : ${c.text}`, { color: 'warn' })),
    sp.limitsHit ? h.T(sp.limitsText, { color: 'bad' }) : h.T(sp.limitsText, { color: 'ok' }),
  ], dflt)
}

function runBlock(h, V, cfg, W, lay, v, now) {
  const WL = W.labels
  const st = (WL.status || {})[v.status] || v.status
  const key = v.id
  const open = isOpen(V, key, v.live || W.open_finished)
  const head = [
    h.row([
      h.btn(`${open ? WL.open : WL.closed} ${clip(v.name, lay.textMax - 30)}`, () => V.act.wfToggle(key, !open), v.live),
      h.T(st, { color: STATUS_COLOR[v.status], bold: true }),
      h.T(`${WL.complexity} ${v.badge}`, { bold: true, color: v.badge === 'XL' || v.badge === 'L' ? 'warn' : 'dim' }),
      h.T(v.live ? fill(WL.elapsed, { dur: frDur(v.elapsed) }) : `${clock(v.start)} → ${clock(v.end)}`, { dim: true }),
    ], { alignItems: 'center' }),
    h.T(v.sentence, { bold: v.live }),
  ]
  if (!open) return h.section(null, head, { key: 'run-' + key, color: v.highlights.some((x) => x.level === 'bad') ? 'bad' : v.live ? 'running' : 'dim' })
  const parts = [...head]
  if (v.description) parts.push(h.T(v.description, { dim: true }))
  parts.push(h.T(`${frTokens(v.tokens)} tokens · ~${frUsd(v.cost)} (${cfg.cost_label || 'estimation'}) · ${v.agents.length} agent(s) · ${v.models.join(', ') || '?'}${V.wfScope === 'all' ? ' · ' + v.project.replace(/^[A-Z]--/, '').slice(0, 40) : ''}`, { dim: true }))
  // highlights
  if (v.highlights.length) {
    parts.push(h.col(v.highlights.map((x, i) => h.T(`▲ ${x.text}`, { color: x.level, key: 'hl' + i })), { marginBottom: 1 }))
  }
  // phases: vertical timeline with agents under each
  parts.push(fold(h, V, W, key + ':phases', WL.phases, v.phases.map((p) => phaseBlock(h, W, lay, p, v, now)), true))
  // estimates
  if (v.live) parts.push(fold(h, V, W, key + ':est', WL.estimates, estimateLines(h, W, v), true))
  // Gantt
  parts.push(fold(h, V, W, key + ':gantt', WL.gantt, ganttLines(h, W, v, now, lay.cols - 12, cfg), v.live))
  // speed
  parts.push(speedBlock(h, V, W, v.speed, key, WL.speed, false))
  return h.section(null, parts, { key: 'run-' + key, color: v.highlights.some((x) => x.level === 'bad') ? 'bad' : v.live ? 'running' : 'dim' })
}

const PHASE_MARK = { done: '●', running: '◐', waiting: '○', failed: '✗' }

function phaseBlock(h, W, lay, p, v, now) {
  const WL = W.labels
  const pst = (WL.phase_status || {})[p.status] || p.status
  const pe = v.estimate ? v.estimate.phases.find((x) => x.index === p.index) : null
  const kids = [
    h.row([
      h.T(PHASE_MARK[p.status] || '○', { color: STATUS_COLOR[p.status], bold: true }),
      h.T(`${p.index}. ${p.title || '-'}`, { bold: true }),
      h.T(pst, { color: STATUS_COLOR[p.status] }),
      h.T(`${p.agents.length} agent(s)${p.running ? `, ${p.running} en cours` : ''}`, { dim: true }),
      pe && pe.enough && pe.ms ? h.T(`reste ~${frDur(pe.ms.mid)}`, { dim: true }) : null,
    ]),
    p.detail ? h.T(`│  ${clip(p.detail, lay.textMax - 4)}`, { dim: true }) : null,
  ]
  for (const a of p.agents) kids.push(agentLines(h, W, lay, a, now))
  return h.col(kids, { key: 'ph-' + p.index, marginBottom: 1 })
}

function agentLines(h, W, lay, a, now) {
  const WL = W.labels
  const st = a.stuck ? `${WL.agent_status.running} · bloqué ?` : (WL.agent_status || {})[a.status] || a.status
  const color = a.stuck || a.status === 'failed' ? 'bad' : STATUS_COLOR[a.status]
  return h.col([
    h.row([h.T('│ ├', { dim: true }), h.T(clip(a.label, lay.textMax - 24), { bold: true }), h.T(st, { color, bold: a.stuck || a.status === 'failed' })]),
    h.row([
      h.T('│ │ ', { dim: true }),
      h.T(`${short(a.model)}${a.effort ? ' · ' + a.effort : ''}`, { color: family(a.model) }),
      a.explicit ? null : h.T(WL.model_inherited, { color: 'warn' }),
      h.T(`${frDur(a.durMs)} · ${frTokens(a.tokens)} tok · ${frUsd(a.cost)}`, { dim: true }),
    ]),
    a.lastLine ? h.T(`│ │  ${clip(a.lastLine, Math.min(100, lay.textMax - 6))}`, { dim: a.status !== 'running' }) : null,
    a.branch || a.worktree || a.pr ? h.T(`│ │  ${[a.branch ? 'branche ' + a.branch : '', a.worktree && !a.branch ? 'worktree ' + a.worktree : '', a.pr ? 'PR #' + a.pr : ''].filter(Boolean).join(' · ')}`, { dim: true }) : null,
    a.est ? h.T(`│ │  ${a.est.overrun ? WL.overrun : `reste ~${frDur(a.est.ms.mid)} (${frDur(a.est.ms.lo)}–${frDur(a.est.ms.hi)}), ${fill(WL.samples, { n: a.est.n })}`}`, { color: a.est.overrun ? 'warn' : 'dim' }) : null,
  ], { key: 'ag-' + a.id })
}

function estimateLines(h, W, v) {
  const WL = W.labels
  const e = v.estimate
  if (!e) return [h.T(WL.no_history, { dim: true })]
  const lines = []
  const row = (what, x) => (x && x.ms ? fill(WL.est_row, {
    what, dur: frDur(x.ms.mid), range: `(${frDur(x.ms.lo)}–${frDur(x.ms.hi)})`, tokens: frTokens(x.tok.mid), cost: frUsd(x.usd ? x.usd.mid : 0),
    n: fill(WL.samples, { n: x.n }) + (x.level ? ' · ' + ((WL.est_level || {})[x.level] || x.level) : ''),
  }) : `${what} : ${WL.no_history}`)
  if (e.enough) {
    lines.push(h.T(`${fill(WL.eta, { time: clock(e.eta.mid) })} ${fill(WL.eta_range, { lo: clock(e.eta.lo), hi: clock(e.eta.hi) })}`, { bold: true }))
    lines.push(h.T(`${WL.est_total} : ~${frTokens(e.finalTokens.mid)} tokens (${frTokens(e.finalTokens.lo)}–${frTokens(e.finalTokens.hi)}) · ~${frUsd(e.finalCost.mid)} (${frUsd(e.finalCost.lo)}–${frUsd(e.finalCost.hi)}) · ${fill(WL.samples, { n: e.n })}`))
  } else {
    lines.push(h.T(`${WL.est_total} : ${WL.no_history} (${fill(WL.samples, { n: e.n })}, il en faut ${W.min_samples})`, { dim: true }))
  }
  for (const p of e.phases) lines.push(h.T(row(fill(WL.est_phase, { title: p.title || p.index }), p.enough ? p : null), { dim: !p.enough }))
  if (e.overrun.length) lines.push(h.T(`${WL.overrun} : ${e.overrun.join(', ')}`, { color: 'warn' }))
  return lines
}

function ganttLines(h, W, v, now, width, cfg) {
  const g = gantt(v, now, Math.max(20, width), cfg)
  if (g.mode === 'empty') return [h.T(W.labels.nothing, { dim: true })]
  if (g.mode === 'vertical') {
    return g.rows.map((r, i) => h.row([h.T(r.time, { dim: true }), h.T(r.text, { color: STATUS_COLOR[r.kind], bold: r.kind === 'now' })], { key: 'gv' + i, flexWrap: 'nowrap' }))
  }
  const out = [h.T(axis(g), { dim: true })]
  for (const grp of g.groups) {
    out.push(h.T(`${grp.index}. ${grp.title || '-'}`, { bold: true }))
    for (const [i, r] of grp.rows.entries()) {
      out.push(h.row([
        h.T(clip(r.label, g.labelW).padEnd(g.labelW, ' ') + ' ', { dim: r.status !== 'running' }),
        ...r.cells.map((c, j) => h.T(c.text, { color: STATUS_COLOR[c.kind], key: 'c' + j })),
      ], { key: `g-${grp.index}-${i}`, flexWrap: 'nowrap', gap: 0 }))
    }
  }
  out.push(h.T(ganttLegend({ est: W.labels.est_tail, now: W.labels.now }), { dim: true })) // lib/core/gantt.mjs, same as ci's Diagramme
  return out
}
