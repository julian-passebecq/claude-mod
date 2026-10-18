// The Panneau drawn from invented fixtures (no transcript, no scan, no Claude Code): what Julian sees when Cockpit opens,
// at a given pane width. Used by scripts/preview.mjs --panneau [--cols 60] and tests/panel.test.mjs.
import { el, renderText } from '../../lib/factory/scanner/textrender.mjs'
import { drawCockpit } from '../../hooks/view.mjs'
import { synthesis, barsOf, activeWorkflows, contexteOf } from '../../lib/panel.mjs'
import { usageCard } from '../../hooks/nav.mjs'
import { convFactory } from '../../lib/panel_conv.mjs'
import { grapheModel } from '../../lib/graphe.mjs'

export const NOW = Date.parse('2026-10-16T16:30:00Z')
const H = Math.floor(NOW / 3600000) * 3600000
const iso = (minAgo) => new Date(NOW - minAgo * 60000).toISOString()
const V = (n) => ({ 'claude-opus-5-5': [n, Math.round(n / 10), n * 4, 0, 0, 3] })

// usage's classement.json: [hour, sid, kind, model, agent, skill, mcp, in, out, cr, cw5, cw1h, msgs, active, cost]
const R = (h, sid, tok, usd) => [H - h * 3600000, sid, 'main', 'claude-opus-5-5', '', '', '', tok, 0, 0, 0, 0, 1, 0, usd]
export const CLASSEMENT = {
  v: 1, generated: NOW, tzMin: 0, days: 31,
  sessions: { lead: { t: 'Lane alpha · tableau de bord', p: 'proj-one' }, b: { t: 'Lane beta', p: 'proj-two' }, c: { t: 'Lane gamma', p: 'proj-one' } },
  rows: [R(0, 'lead', 3600000, 12), R(0, 'b', 1000000, 4), R(2, 'c', 500000, 0.5)],
}

const SUBS = [
  { id: 'a1', type: 'coder', desc: 'build the panel', model: 'claude-opus-5-5', effort: 'medium', status: 'running', workflow: 'wf_1', ts: iso(20), last_ts: iso(0), models: V(300000) },
  { id: 'a2', type: 'verify', desc: 'wait for CI', model: 'claude-sonnet-5-5', effort: 'low', status: 'done', workflow: 'wf_1', ts: iso(40), last_ts: iso(25), models: V(80000) },
  { id: 'a3', type: 'explore-fast', desc: 'find the tests', model: 'claude-haiku-5-5', effort: 'low', status: 'done', ts: iso(50), last_ts: iso(48), models: V(20000) },
]
export const SCAN = {
  sessions: [
    { cli: 'lead', sid: 'local_lead', app_title: 'Lane alpha · tableau de bord', cwd: 'C:/code/proj-one', live: true, model: 'claude-opus-5-5', app_effort: 'medium', ctx: 120000, subs: SUBS, recent: [], models: V(600000) },
    { cli: 'b', live: false, awaiting: true, cwd: 'C:/code/proj-two', needs_action: 'Choisir la version' },
  ],
  detail: {
    cli: 'lead', subs: SUBS, calls: [{ tool: 'Workflow', runId: 'wf_1', desc: 'package-wave' }],
    events: [[iso(30), 'pr', 'PR/MR #42 linked'], [iso(10), 'tool', 'Bash gh pr merge 41 --squash --delete-branch']],
  },
}

// the app's session files as lib/core/sessions.mjs graphRow returns them (invented)
const G = (o) => ({ sid: 'local_' + o.cli, title: '', cwd: 'C:/code/proj-one', origin: 'C:/code/proj-one', repo: 'proj-one', archived: false, starred: false,
  last_activity: NOW - 5 * 60000, created: NOW - 5 * 3600000, model: 'claude-opus-5-5', effort: 'medium', parent: '', peers: [], awaiting: false, prs: [], branch: '', ...o })
export const GRAPH_ROWS = [
  G({ cli: 'lead', title: 'Lane alpha · tableau de bord', last_activity: NOW - 30000, starred: true }),
  G({ cli: 'k1', title: 'Package one: a rather long lane title that must be cut', parent: 'local_lead', last_activity: NOW - 3 * 3600000, prs: [{ number: 41, state: 'merged' }] }),
  G({ cli: 'k2', title: 'Package two', parent: 'local_lead', last_activity: NOW - 60000, peers: [{ target: 'local_pm', at: NOW - 120000 }] }),
  G({ cli: 'k3', title: 'Package two · verify', parent: 'local_k2', last_activity: NOW - 9 * 3600000 }),
  G({ cli: 'pm', title: 'PM BETA', repo: 'proj-two', cwd: 'C:/code/proj-two', origin: 'C:/code/proj-two', last_activity: NOW - 40 * 60000 }),
  G({ cli: 'b', title: 'Lane beta', repo: 'proj-two', cwd: 'C:/code/proj-two/.claude/worktrees/x', origin: 'C:/code/proj-two', parent: 'local_pm', awaiting: true, last_activity: NOW - 2 * 3600000 }),
  G({ cli: 'c', title: 'Lane gamma', repo: 'proj-three', last_activity: NOW - 30 * 3600000 }),
  G({ cli: 'old', title: 'Archived lane', archived: true, last_activity: NOW - 3 * 3600000 }),
]

// invented rates ($ per million tokens) so the cards show a cost
export const FCFG = { rates: {
  opus: { in: 5, out: 25, cache_read: 0.5, cache_write_5m: 6.25, cache_write_1h: 10 },
  sonnet: { in: 3, out: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 },
  haiku: { in: 1, out: 5, cache_read: 0.1, cache_write_5m: 1.25, cache_write_1h: 2 },
} }
// factory's Workflow screen run of this conversation's Workflow (phases, ETA, cost), as workflowScreen(...).runs has it
const RA = (id, label, phase, model, effort, status, minAgo, minDur, tokens, cost) => ({ id, label, phase, model, effort, status, start: NOW - minAgo * 60000,
  end: status === 'running' ? null : NOW - (minAgo - minDur) * 60000, durMs: (status === 'running' ? minAgo : minDur) * 60000, tokens, cost })
export const RUNS = [{
  id: 'wf_1', cli: 'lead', name: 'package-wave', live: true, status: 'running', elapsed: 40 * 60000, cost: 9.4,
  estimate: { enough: true, eta: { mid: NOW + 25 * 60000 } },
  agents: [RA('a1', 'coder: cockpit-claude-style', 'Wave B', 'claude-opus-5-5', 'medium', 'running', 20, 20, 1500000, 7.9), RA('a2', 'verify', 'Wave A', 'claude-sonnet-5-5', 'low', 'done', 40, 15, 408000, 1.5),
    RA('a3', 'explore-fast: map files', 'Wave A', 'claude-haiku-5-5', 'low', 'done', 40, 5, 100000, 0), RA('a4', 'verify: CI', 'Merge', 'claude-sonnet-5-5', 'low', 'waiting', 0, 0, 0, 0)],
  phases: [{ title: 'Wave A', status: 'done', agents: [{ id: 'a2' }, { id: 'a3' }] }, { title: 'Wave B', status: 'running', agents: [{ id: 'a1' }] }, { title: 'Merge', status: 'waiting', agents: [{ id: 'a4' }] }],
}]

const noop = () => {}
const ACT = { openConv: noop, gfilter: noop, gcycle: noop, tab: noop, ptoggle: noop, nodeToggle: noop, pfilter: noop, pcycle: noop, filePress: noop, filesClear: noop, filesMore: noop, filesRefresh: noop }

/**
 * The Pane's view model on the Panneau. open: sections unfolded (all but Fichiers by default); closed: folded nodes
 * (the preview unfolds the live Workflow card, so both its mini-card head with one dot per agent and the « Modèle |
 * Temps » table show; { 'pfw-wf_1': true } draws it folded as it opens in the app).
 */
export function panneauView(columns, o = {}) {
  o = { ...o, closed: { 'pfw-wf_1': false, ...(o.closed || {}) } }
  // as the Panneau opens: every section unfolded but Fichiers (folded by default, Julian 17 Oct)
  const open = o.open || { conv: true, convs: true, barres: true, graphe: true, 'wf:r1': true }
  const filter = { period: 'today', project: '', state: '', who: o.who || 'claude' }
  const syn = synthesis(CLASSEMENT, SCAN, null, filter, {}, NOW)
  const usage = { rateLimits: [{ kind: 'five_hour', percentUsed: 21, resetsAt: new Date(NOW + 130 * 60000).toISOString() }, { kind: 'seven_day', percentUsed: 85, resetsAt: new Date(NOW + 50 * 3600000).toISOString() }, { kind: 'spend_limit', percentUsed: 12 }] }
  const card = usageCard(usage, SCAN.sessions[0], FCFG, NOW)
  const panel = {
    open, closed: o.closed || {}, act: ACT,
    files: { head: 'proj-one · main', rows: [{ id: 'C:/code/proj-one/src', label: '▾ src', git: 'M', color: '#e5c07b', selected: false }, { id: 'C:/code/proj-one/src/panel.ts', label: '  · panel.ts', git: '?', selected: true }], more: 3, selected: 'src/panel.ts', attach: true, busy: false },
    factory: convFactory(SCAN, 'lead', FCFG, {}, NOW, o.closed || {}, { runs: RUNS, card, contexte: contexteOf({ usage: null, ctxTokens: 120000, fwin: 400000 }, {}), tps: synthesis(CLASSEMENT, SCAN, null, { period: 'today' }, {}, NOW).tpsById.lead }),
    syn, filter,
    bars: barsOf({ usage, quotas: { codex: { week: { pct: 30 } } }, tps: syn.tps, codex: filter.who === 'codex', card }, {}),
    workflows: activeWorkflows({ runs: [{ id: 'r1', name: 'package-wave', live: true, agents: [{ id: '1', label: 'coder', model: 'claude-opus-5-5', status: 'running', tokens: 300000 }, { id: '2', label: 'verify', model: 'claude-sonnet-5-5', status: 'done', tokens: 80000 }] }] }, {}),
    graphe: grapheModel({ rows: GRAPH_ROWS, scan: SCAN, workflows: RUNS, conso: CLASSEMENT, fcfg: {}, filter: o.graphe || {} }, 'lead', {}, NOW),
  }
  return { cfg: {}, fcfg: {}, scan: SCAN, nav: { level: 'mega' }, self: 'lead', busy: false, error: '', at: NOW, columns, filter: 'all',
    usage: null, veille: null, open: {}, act: { tab: noop, menu: noop }, tab: 'panneau', panel }
}

export function panneauText(columns, o = {}) {
  return renderText(drawCockpit(el, panneauView(columns, o)), columns)
}
