// The Panneau drawn from invented fixtures (no transcript, no scan, no Claude Code): what Julian sees when Cockpit opens,
// at a given pane width. Used by scripts/preview.mjs --panneau [--cols 60] and tests/panel.test.mjs.
import { el, renderText } from '../../lib/factory/scanner/textrender.mjs'
import { drawCockpit } from '../../hooks/view.mjs'
import { synthesis, barsOf, activeWorkflows, contexteOf } from '../../lib/panel.mjs'
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
    { cli: 'lead', sid: 'local_lead', app_title: 'Lane alpha · tableau de bord', cwd: 'C:/code/proj-one', live: true, model: 'claude-opus-5-5', app_effort: 'medium', ctx: 120000, subs: SUBS, recent: [] },
    { cli: 'b', live: false, awaiting: true, cwd: 'C:/code/proj-two', needs_action: 'Choisir la version' },
  ],
  detail: {
    cli: 'lead', subs: SUBS, calls: [{ tool: 'Workflow', runId: 'wf_1', desc: 'package-wave' }],
    events: [[iso(30), 'pr', 'PR/MR #42 linked'], [iso(10), 'tool', 'Bash gh pr merge 41 --squash --delete-branch']],
  },
}

const noop = () => {}
const ACT = { tab: noop, ptoggle: noop, nodeToggle: noop, pfilter: noop, pcycle: noop, filePress: noop, filesClear: noop, filesMore: noop, filesRefresh: noop }

/** The Pane's view model on the Panneau. open: sections unfolded (all by default); closed: folded layers. */
export function panneauView(columns, o = {}) {
  const open = o.open || { fichiers: true, conv: true, contexte: true, convs: true, graphe: true, 'wf:r1': true }
  const filter = { period: 'today', project: '', state: '', who: o.who || 'claude' }
  const syn = synthesis(CLASSEMENT, SCAN, null, filter, {}, NOW)
  const panel = {
    open, closed: o.closed || {}, act: ACT,
    files: { head: 'proj-one · main', rows: [{ id: 'C:/code/proj-one/src', label: '▾ src', git: 'M', color: '#e5c07b', selected: false }, { id: 'C:/code/proj-one/src/panel.ts', label: '  · panel.ts', git: '?', selected: true }], more: 3, selected: 'src/panel.ts', attach: true, busy: false },
    factory: convFactory(SCAN, 'lead', {}, {}, NOW, o.closed || {}),
    contexte: contexteOf({ usage: null, ctxTokens: 120000, fwin: 400000 }, {}),
    syn, filter,
    bars: barsOf({ usage: { rateLimits: [{ kind: 'five_hour', percentUsed: 21 }, { kind: 'seven_day', percentUsed: 85 }] }, quotas: { codex: { week: { pct: 30 } } }, tps: syn.tps, codex: filter.who === 'codex' }, {}),
    workflows: activeWorkflows({ runs: [{ id: 'r1', name: 'package-wave', live: true, agents: [{ id: '1', label: 'coder', model: 'claude-opus-5-5', status: 'running', tokens: 300000 }, { id: '2', label: 'verify', model: 'claude-sonnet-5-5', status: 'done', tokens: 80000 }] }] }, {}),
    graphe: grapheModel(SCAN, 'lead', {}, NOW),
  }
  return { cfg: {}, fcfg: {}, scan: SCAN, nav: { level: 'mega' }, self: 'lead', busy: false, error: '', at: NOW, columns, filter: 'all',
    usage: null, veille: null, open: {}, act: { tab: noop, menu: noop }, tab: 'panneau', panel }
}

export function panneauText(columns, o = {}) {
  return renderText(drawCockpit(el, panneauView(columns, o)), columns)
}
