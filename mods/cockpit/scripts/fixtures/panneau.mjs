// The Panneau drawn from invented fixtures (no transcript, no scan, no Claude Code): what Julian sees when Cockpit opens,
// at a given pane width. Used by scripts/preview.mjs --panneau [--cols 60] and tests/panel.test.mjs.
import { el, renderText } from '../../lib/factory/scanner/textrender.mjs'
import { drawCockpit } from '../../hooks/view.mjs'
import { synthesis, barsOf, contexteOf } from '../../lib/panel.mjs'
import { usageCard } from '../../hooks/nav.mjs'
import { convFactory } from '../../lib/panel_conv.mjs'
import { panelConvs, ciBranches, todayOf } from '../../lib/panel_list.mjs'
import { quotaCurves } from '../../lib/viz_quota.mjs'
import { grapheModel } from '../../lib/graphe.mjs'
import { ciNow } from '../../lib/core/activity.mjs'
import { debitModel } from '../../lib/debit.mjs'

export const NOW = Date.parse('2026-10-16T16:30:00Z')
const H = Math.floor(NOW / 3600000) * 3600000
const iso = (minAgo) => new Date(NOW - minAgo * 60000).toISOString()
const V = (n) => ({ 'claude-opus-5-5': [n, Math.round(n / 10), n * 4, 0, 0, 3] })

// usage's classement.json: [hour, sid, kind, model, agent, skill, mcp, in, out, cr, cw5, cw1h, msgs, active, cost]
const R = (h, sid, tok, usd) => [H - h * 3600000, sid, 'main', 'claude-opus-5-5', '', '', '', tok, 0, 0, 0, 0, 1, 0, usd]
export const CLASSEMENT = {
  v: 1, generated: NOW, tzMin: 0, days: 31,
  sessions: { lead: { t: 'Lane alpha · tableau de bord', p: 'proj-one' }, b: { t: 'Lane beta', p: 'proj-two' }, c: { t: 'Lane gamma', p: 'proj-one' }, d: { t: 'Lane delta', p: 'proj-one' }, k4: { t: 'Package four', p: 'proj-one' } },
  rows: [R(0, 'lead', 3600000, 12), R(0, 'b', 1000000, 4), R(2, 'c', 500000, 0.5), R(2, 'd', 800000, 3), R(3, 'k4', 200000, 1)],
}

const SUBS = [
  { id: 'a1', type: 'coder', desc: 'build the panel', model: 'claude-opus-5-5', effort: 'medium', status: 'running', workflow: 'wf_1', ts: iso(20), last_ts: iso(0), models: V(300000) },
  { id: 'a2', type: 'verify', desc: 'wait for CI', model: 'claude-sonnet-5-5', effort: 'low', status: 'done', workflow: 'wf_1', ts: iso(40), last_ts: iso(25), models: V(80000) },
  { id: 'a3', type: 'explore-fast', desc: 'find the tests', model: 'claude-haiku-5-5', effort: 'low', status: 'done', ts: iso(50), last_ts: iso(48), models: V(20000) },
]
export const SCAN = {
  sessions: [
    { cli: 'lead', sid: 'local_lead', app_title: 'Lane alpha · tableau de bord', cwd: 'C:/code/proj-one', live: true, mtime: (NOW - 20000) / 1000, stop: 'tool_use', model: 'claude-opus-5-5', app_effort: 'medium', ctx: 120000, subs: SUBS, recent: [], models: V(600000) },
    // b was spawned by a PM that is not in the list: « ↖ lancée par PM BETA »; k4 by this conversation: nested under it
    { cli: 'b', sid: 'local_b', parent: 'local_pm', app_title: 'Lane beta', live: false, awaiting: true, cwd: 'C:/code/proj-two', needs_action: 'Choisir la version' },
    // this conversation's main thread works (written 20 s ago, a tool call pending); Lane delta's ended its turn and only
    // its Workflow works. Another conversation working, with its own Workflow: it unfolds under its row by default
    { cli: 'd', sid: 'local_d', app_title: 'Lane delta', cwd: 'C:/code/proj-one', live: true, mtime: (NOW - 90000) / 1000, stop: 'end_turn', model: 'claude-sonnet-5-5', app_effort: 'low', ctx: 60000, recent: [], models: V(200000),
      subs: [{ id: 'd1', type: 'coder', desc: 'write the docs', model: 'claude-sonnet-5-5', effort: 'low', status: 'running', workflow: 'wf_2', ts: iso(12), last_ts: iso(0), models: V(90000) },
        { id: 'd2', type: 'tester', desc: 'run the tests', model: 'claude-haiku-5-5', effort: 'low', status: 'done', workflow: 'wf_2', ts: iso(15), last_ts: iso(13), models: V(10000) }] },
    { cli: 'pm', sid: 'local_pm', app_title: 'PM BETA', cwd: 'C:/code/proj-two', recent: [] },
    { cli: 'k4', sid: 'local_k4', parent: 'local_lead', app_title: 'Package four', cwd: 'C:/code/proj-one', ctx: 40000, model: 'claude-opus-5-5', app_effort: 'medium', recent: [], models: V(50000) },
  ],
  detail: {
    cli: 'lead', subs: SUBS, calls: [{ tool: 'Workflow', runId: 'wf_1', desc: 'package-wave' }],
    events: [[iso(30), 'pr', 'PR/MR #42 linked'], [iso(10), 'tool', 'Bash gh pr merge 41 --squash --delete-branch']],
  },
}

// « busy » (Julian, 21 Oct: « I don't see what is running right now »): the same evening with a background agent of this
// conversation still running (◦, outside a Workflow) and its sub-conversation Package four working: 2 running
// Workflows (package-wave here, wf_2 in Lane delta), 1 background agent, 1 sub-conversation
const BG = { id: 'a5', type: 'coder', desc: 'p44-migration', model: 'claude-opus-5-5', effort: 'medium', status: 'running', ts: iso(70), last_ts: iso(1), models: V(180000) }
export const SCAN_BUSY = {
  sessions: SCAN.sessions.map((x) => (x.cli === 'lead' ? { ...x, subs: [...SUBS, BG] } : x.cli === 'k4' ? { ...x, live: true } : x)),
  detail: { ...SCAN.detail, subs: [...SUBS, BG] },
}

// « main » (Julian, 21 Oct 17:36: « 1 conv · 0 wf · 0 ag. » while a turn ran for 28 s): this conversation's main thread
// works (its transcript written 28 s ago, the last message a tool call), nothing else runs: no Workflow, no agent
const DONE = (x, minAgo = 14) => ({ ...x, status: x.status === 'running' ? 'done' : x.status, last_ts: x.status === 'running' ? iso(minAgo) : x.last_ts })
const quiet = (x, minAgo) => ({ ...x, live: false, mtime: (NOW - minAgo * 60000) / 1000, stop: 'end_turn', subs: (x.subs || []).map((a) => DONE(a, minAgo)) })
export const SCAN_MAIN = {
  sessions: SCAN.sessions.map((x) => (x.cli === 'lead' ? { ...x, live: true, mtime: (NOW - 28000) / 1000, stop: 'tool_use', subs: SUBS.map((a) => DONE(a)) } : quiet(x, 12))),
  detail: { ...SCAN.detail, subs: SUBS.map((a) => DONE(a)) },
}
// « idle »: nothing runs anywhere, every conversation ended its turn 12 min ago or more, the CI cache is fresh with no
// pipeline: the green « ✓ Rien ne tourne » line
export const SCAN_IDLE = {
  sessions: SCAN.sessions.map((x) => quiet({ ...x, awaiting: false, needs_action: '' }, x.cli === 'lead' ? 12 : 40)),
  detail: { ...SCAN.detail, subs: SUBS.map((a) => DONE(a)) },
}
const RUNS_DONE = () => RUNS.map((r) => ({ ...r, live: false, status: 'done', end: NOW - 14 * 60000, agents: r.agents.map((a) => ({ ...a, status: a.status === 'running' || a.status === 'waiting' ? 'done' : a.status, end: a.end || NOW - 14 * 60000 })) }))

// the ci mod's pipelines cache (~/.claude/ci-pipelines-cache.json), invented: fresh with nothing running, fresh with one
// pipeline running, and 40 min old (« CI : non lu depuis 40 min »)
export const CI_CACHE = {
  idle: { generated: new Date(NOW - 60000).toISOString(), apps: [{ app: 'proj-one', runs: [{ app: 'proj-one', backend: 'gh', status: 'success', created: iso(90), branch: 'main', duration_s: 300 },
    { app: 'proj-one', backend: 'gh', status: 'success', created: iso(20), branch: 'claude/panel', duration_s: 240 }] }] },
  busy: { generated: new Date(NOW - 60000).toISOString(), apps: [{ app: 'proj-one', runs: [{ app: 'proj-one', backend: 'gh', who: 'claude', status: 'running', created: iso(6), branch: 'claude/panel', jobs: [{ name: 'lint', status: 'success' }, { name: 'tests', status: 'running' }] }] }] },
  stale: { generated: new Date(NOW - 40 * 60000).toISOString(), apps: [] },
}

// the app's session files as lib/core/sessions.mjs graphRow returns them (invented)
const G = (o) => ({ sid: 'local_' + o.cli, title: '', cwd: 'C:/code/proj-one', origin: 'C:/code/proj-one', repo: 'proj-one', archived: false, starred: false,
  last_activity: NOW - 5 * 60000, created: NOW - 5 * 3600000, model: 'claude-opus-5-5', effort: 'medium', parent: '', peers: [], awaiting: false, prs: [], branch: '', ...o })
export const GRAPH_ROWS = [
  G({ cli: 'lead', title: 'Lane alpha · tableau de bord', last_activity: NOW - 30000, starred: true, created: NOW - 130 * 60000, branch: 'claude/panel', prs: [{ number: 120, state: 'open' }] }),
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

// usage's debit.json (invented): TPS rows per hour|model|effort [output, ms, streams, {bucket: streams}] and the last
// hour's streams. Buckets are x1.15 from 1 tok/s: bucket 29 ≈ 60 tok/s, 31 ≈ 79, 33 ≈ 105, 26 ≈ 39.
const HR = (hAgo, model, effort, out, ms, hist) => [`${H - hAgo * 3600000}|${model}|${effort}`, [out, ms, Object.values(hist).reduce((a, b) => a + b, 0), hist]]
const ST = (sAgo, model, effort, out, ms) => ({ ts: NOW - sAgo * 1000, model, effort, out, ms, kind: 'main', project: 'proj-one', session: 'lead' })
const RECENT = [ST(12, 'claude-opus-5-5', 'medium', 171, 2890), ST(40, 'claude-sonnet-5-5', 'low', 820, 9100), ST(95, 'claude-opus-5-5', 'medium', 1210, 24000),
  ST(160, 'claude-haiku-5-5', 'low', 640, 3900), ST(300, 'claude-opus-5-5', 'high', 2400, 41000), ST(700, 'claude-sonnet-5-5', 'low', 300, 3700)]
export const DEBIT = {
  v: 1, generated: NOW, tzMin: 0, days: 32,
  hourly: Object.fromEntries([
    HR(0, 'claude-opus-5-5', 'medium', 1381, 26890, { 29: 1, 28: 1 }), HR(0, 'claude-opus-5-5', 'high', 2400, 41000, { 29: 1 }),
    HR(0, 'claude-sonnet-5-5', 'low', 1120, 12800, { 32: 1, 31: 1 }), HR(0, 'claude-haiku-5-5', 'low', 640, 3900, { 36: 1 }),
    HR(5, 'claude-opus-5-5', 'medium', 52000, 900000, { 29: 20, 26: 6, 31: 4 }), HR(30, 'claude-opus-5-5', 'medium', 410000, 7200000, { 29: 150, 26: 40, 33: 10 }),
    HR(200, 'claude-opus-5-5', 'medium', 1900000, 32000000, { 29: 600, 26: 200, 33: 80 }), HR(50, 'claude-sonnet-5-5', 'low', 120000, 1500000, { 31: 60, 33: 20 }),
    HR(400, 'claude-fable-5-1', 'medium', 80000, 2100000, { 26: 40 }),
  ]),
  recent: RECENT,
  streams: RECENT,
}
export const CODEX = { generated: NOW, available: true, days: {}, tps: { '2026-10-16|gpt-5-codex|high': [9000, 150000, 6, { 29: 6 }] }, streams: [{ ts: NOW - 20000, model: 'gpt-5-codex', effort: 'high', out: 600, ms: 10000 }] }

const noop = () => {}
const ACT = { preset: noop, openConv: noop, gfilter: noop, gcycle: noop, tab: noop, ptoggle: noop, nodeToggle: noop, pfilter: noop, pcycle: noop, filePress: noop, filesClear: noop, filesMore: noop, filesRefresh: noop }

/**
 * The Pane's view model on the Panneau. open: sections unfolded (all but Fichiers by default); closed: folded nodes
 * (the preview unfolds the live Workflow card, so both its mini-card head with one dot per agent and the « Modèle |
 * Temps » table show; { 'pfw-wf_1': true } draws it folded as it opens in the app).
 */
export function panneauView(columns, o = {}) {
  // as the Panneau opens (one list since 22 Oct): the banners, ONE list of conversations with their running Workflows and
  // agents, Quotas / Débit / Graphe / Fichiers one folded line each; o.open / o.closed unfold the details
  const open = o.open || { conv: true, convs: true }
  const filter = { period: 'today', project: '', state: '', who: o.who || 'claude' }
  // o.scene: 'busy' (o.busy), 'main' (only a main thread works), 'idle' (nothing runs); o.ci: a key of CI_CACHE or a cache
  const scene = o.scene || (o.busy ? 'busy' : '')
  const scan = scene === 'busy' ? SCAN_BUSY : scene === 'main' ? SCAN_MAIN : scene === 'idle' ? SCAN_IDLE : SCAN
  const runs = scene === 'main' || scene === 'idle' ? RUNS_DONE() : RUNS
  const ciCache = typeof o.ci === 'object' && o.ci ? o.ci : CI_CACHE[o.ci || (scene === 'busy' ? 'busy' : 'idle')]
  const syn = synthesis(o.data || CLASSEMENT, scan, null, filter, {}, NOW)
  // EN COURS counts every conversation of the window, not only the top N listed (as hooks/register.mjs passes it)
  const every = { ...syn, rows: syn.every || syn.rows }
  const usage = { rateLimits: [{ kind: 'five_hour', percentUsed: 21, resetsAt: new Date(NOW + 130 * 60000).toISOString() }, { kind: 'seven_day', percentUsed: 85, resetsAt: new Date(NOW + 50 * 3600000).toISOString() }, { kind: 'spend_limit', percentUsed: 12 }] }
  const card = usageCard(usage, scan.sessions[0], FCFG, NOW)
  const panel = {
    open, closed: o.closed || {}, act: ACT,
    files: { head: 'proj-one · main', rows: [{ id: 'C:/code/proj-one/src', label: '▾ src', git: 'M', color: '#e5c07b', selected: false }, { id: 'C:/code/proj-one/src/panel.ts', label: '  · panel.ts', git: '?', selected: true }], more: 3, selected: 'src/panel.ts', attach: true, busy: false },
    factory: convFactory(scan, 'lead', FCFG, {}, NOW, o.closed || {}, { runs, card, contexte: contexteOf({ usage: null, ctxTokens: 120000, fwin: 400000 }, {}), tps: synthesis(CLASSEMENT, scan, null, { period: 'today' }, {}, NOW).tpsById.lead }),
    syn, synAll: every, filter,
    bars: barsOf({ usage, quotas: { codex: { week: { pct: 30 } } }, tps: syn.tps, codex: filter.who === 'codex', card }, {}),
    ci: ciNow(ciCache, NOW, {}),
    graphe: grapheModel({ rows: GRAPH_ROWS, scan, workflows: runs, conso: CLASSEMENT, fcfg: {}, filter: o.graphe || {} }, 'lead', {}, NOW),
    link: 'claude://claude.ai/epitaxy/{id}', self: 'lead',
    // panel.detail normal: each row's branch CI, « Aujourd’hui », the quotas' projection (invented readings)
    ciBranches: ciBranches(ciCache),
    today: todayOf(synthesis(o.data || CLASSEMENT, scan, null, { period: 'today', who: 'claude' }, {}, NOW)),
    quotaCurves: quotaCurves({ series: { five: [{ ts: NOW - 60 * 60000, pct: 15 }], week: [{ ts: NOW - 24 * 3600000, pct: 80 }] }, usage, now: NOW }),
    debit: debitModel({ debit: o.debit === undefined ? DEBIT : o.debit, codex: CODEX, showCodex: filter.who === 'codex', now: NOW }, {}),
  }
  // CONVERSATIONS as hooks/register.mjs builds it (lib/panel_list.mjs): the sessions of GRAPHE with the activity of EN
  // COURS; every conversation row has its factory (counts, détails); a running one (d works) shows its children by default
  const x = panelConvs({ syn, graphRows: o.graphRows || GRAPH_ROWS, graphe: panel.graphe, scan, runs, conso: o.data || CLASSEMENT, fcfg: FCFG, self: 'lead', selfFactory: panel.factory,
    closed: o.closed || {}, tpsById: syn.tpsById, cardOf: (s) => usageCard(null, s, FCFG, NOW), filter: { ...filter, ...(o.filter || {}) } }, {}, NOW)
  const under = x.under
  panel.convList = x.list
  panel.synAll = { ...every, rows: x.pool }
  panel.filter = { ...filter, ...(o.filter || {}) }
  panel.unfold = under.unfold
  panel.tree = under.tree
  panel.kids = under.kids
  panel.convFactories = under.factories
  // o.indent: panel.tree.indent (columns per tree level, or "auto")
  // o.detail: panel.detail (compact | normal | full)
  const pcfg = { ...(o.indent === undefined ? {} : { list: { indent: o.indent } }), ...(o.detail ? { detail: o.detail } : {}) }
  if (o.detail === 'full' && !o.open) panel.open = { ...panel.open, debit: true }
  return { cfg: Object.keys(pcfg).length ? { panel: pcfg } : {}, fcfg: {}, scan, nav: { level: 'mega' }, self: 'lead', busy: false, error: '', at: NOW, columns, filter: 'all',
    usage: null, veille: null, open: {}, act: { tab: noop, menu: noop }, tab: 'panneau', panel }
}

export function panneauText(columns, o = {}) {
  // the tree's connector columns are no-break spaces (a surface may drop a Text's leading spaces): plain spaces here
  return renderText(drawCockpit(el, panneauView(columns, o)), columns).replace(/\u00a0/g, ' ')
}
