// node --test mods/cockpit/tests/panel.test.mjs - the Panneau's pure parts (invented fixtures only).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panelConfig, foldTree, synthesis, cycle, barsOf, activeWorkflows, stateGroup } from '../lib/panel.mjs'
import { tabValid, parseArgs } from '../hooks/nav.mjs'

const NOW = Date.parse('2026-10-16T16:30:00Z')
const H = Math.floor(NOW / 3600000) * 3600000
// [hour, sid, kind, model, agent, skill, mcp, in, out, cr, cw5, cw1h, msgs, active, cost]
const R = (h, sid, tok, usd) => [H - h * 3600000, sid, 'main', 'claude-opus-5-5', '', '', '', tok, 0, 0, 0, 0, 1, 0, usd]
const DATA = {
  v: 1, generated: NOW, tzMin: 0, days: 31,
  sessions: { a: { t: 'Lane alpha', p: 'proj-one' }, b: { t: 'Lane beta', p: 'proj-two' }, c: { t: 'Lane gamma', p: 'proj-one' } },
  rows: [R(0, 'a', 3600, 1), R(0, 'b', 1000, 4), R(2, 'c', 500, 0.5), R(100, 'b', 99999, 9)],
}
const SCAN = { sessions: [
  { cli: 'a', live: true, cwd: 'C:/code/proj-one', last_tool: 'Bash' },
  { cli: 'b', live: false, awaiting: true, cwd: 'C:/code/proj-two', needs_action: 'Choisir la version' },
] }

test('defaults: four sections, all open, Claude only, top 15', () => {
  const c = panelConfig({})
  assert.deepEqual(c.order, ['fichiers', 'conv', 'convs', 'barres'])
  assert.deepEqual(c.open, ['fichiers', 'conv', 'convs', 'barres'])
  assert.equal(c.convs.who, 'claude')
  assert.equal(c.convs.top, 15)
  assert.equal(c.fichiers.attach_selection, true)
  assert.deepEqual(panelConfig({ panel: { order: ['barres', 'nope', 'conv'] } }).order, ['barres', 'conv'])
  assert.equal(panelConfig({ panel: { labels: { panneau: 'Vue' } } }).labels.panneau, 'Vue') // labels configurable
})

test('foldTree hides the children of a folded node, keeps its siblings', () => {
  const rows = [{ key: 'c', depth: 0 }, { key: 'w', depth: 1 }, { key: 'a1', depth: 2 }, { key: 'a2', depth: 2 }, { key: 'x', depth: 1 }]
  assert.deepEqual(foldTree(rows, {}).map((r) => [r.key, r.hasKids, r.isOpen]), [['c', true, true], ['w', true, true], ['a1', false, false], ['a2', false, false], ['x', false, false]])
  assert.deepEqual(foldTree(rows, { w: true }).map((r) => r.key), ['c', 'w', 'x'])
  assert.deepEqual(foldTree(rows, { c: true }).map((r) => r.key), ['c'])
})

test('synthesis: sorted by tokens, state from the scan, tok/s over the last hour, filters, top + autres', () => {
  const s = synthesis(DATA, SCAN, null, { period: 'today' }, {}, NOW)
  assert.equal(s.hasData, true)
  assert.deepEqual(s.rows.map((r) => r.id), ['a', 'b', 'c'])
  assert.equal(s.rows[0].state, 'running')
  assert.equal(s.rows[0].stateLabel, 'en cours')
  assert.equal(s.rows[1].state, 'waiting') // awaiting the person
  assert.equal(s.rows[1].last, 'Choisir la version')
  assert.equal(s.rows[2].state, 'done') // not in the scan
  assert.equal(s.rows[0].last, 'dernier outil : Bash')
  assert.equal(s.rows[0].project, 'proj-one')
  // the 1 h window covers the current clock hour and the one before: 3600 tokens over 5400 s
  assert.ok(Math.abs(s.rows[0].tps - 3600 / 5400) < 1e-9)
  assert.deepEqual(s.projects, ['proj-one', 'proj-two'])
  assert.deepEqual(synthesis(DATA, SCAN, null, { period: 'today', project: 'proj-one' }, {}, NOW).rows.map((r) => r.id), ['a', 'c'])
  assert.deepEqual(synthesis(DATA, SCAN, null, { period: 'today', state: 'waiting' }, {}, NOW).rows.map((r) => r.id), ['b'])
  const top1 = synthesis(DATA, SCAN, null, { period: 'today' }, { panel: { convs: { top: 1 } } }, NOW)
  assert.equal(top1.rows.length, 1)
  assert.equal(top1.others.count, 2)
  assert.equal(top1.others.label, 'autres (2)')
  // 7 days reaches the old row of b
  assert.equal(synthesis(DATA, SCAN, null, { period: '7d' }, {}, NOW).rows[0].id, 'b')
  // cost basis
  assert.equal(synthesis(DATA, SCAN, null, { period: 'today' }, { panel: { convs: { basis: 'cost' } } }, NOW).rows[0].id, 'b')
})

test('synthesis: no classement yet, Codex as one line from codex.json', () => {
  assert.equal(synthesis(null, SCAN, null, {}, {}, NOW).hasData, false)
  const day = new Date(NOW).toISOString().slice(0, 10)
  const cx = synthesis(DATA, SCAN, { days: { [day]: { 'gpt-x': [10, 0, 5, 0, 15] } } }, { who: 'codex', period: 'today' }, {}, NOW)
  assert.equal(cx.rows.length, 1)
  assert.equal(cx.rows[0].tokens, 15)
  assert.equal(synthesis(DATA, SCAN, null, { who: 'codex' }, {}, NOW).hasData, false)
})

test('cycle walks all → each value → all', () => {
  assert.equal(cycle(['x', 'y'], ''), 'x')
  assert.equal(cycle(['x', 'y'], 'x'), 'y')
  assert.equal(cycle(['x', 'y'], 'y'), '')
  assert.equal(stateGroup('blocked', {}), 'waiting')
})

test('bars: engine figures first, quotas file second, unknown said', () => {
  const b = barsOf({ usage: { rateLimits: [{ kind: 'five_hour', percentUsed: 21 }] }, quotas: { claude: { week: { pct: 14 } }, codex: { week: { pct: 30 } } }, tps: 434.4, ctxPct: 12 }, {})
  assert.deepEqual(b.map((x) => [x.id, x.text]), [['five', '21 %'], ['week', '14 %'], ['codex_week', '30 %'], ['ctx', '12 %'], ['tps', '434 tok/s']])
  assert.equal(barsOf({}, {})[0].text, 'non lu')
})

test('active Workflows: live runs only, running agents first', () => {
  const w = activeWorkflows({ runs: [
    { id: 'r1', name: 'package-wave', live: true, agents: [{ id: '1', label: 'verify', status: 'done', tokens: 5 }, { id: '2', label: 'coder', status: 'running', model: 'claude-opus-5-5', tokens: 7 }] },
    { id: 'r2', name: 'old', live: false, agents: [] },
  ] }, {})
  assert.equal(w.length, 1)
  assert.equal(w[0].key, 'wf:r1')
  assert.equal(w[0].running, 1)
  assert.equal(w[0].tokens, 12)
  assert.equal(w[0].agents[0].label, 'coder')
})

test('/cockpit panneau is a tab; off when panel.enabled is false', () => {
  assert.equal(parseArgs('panneau').tab, 'panneau')
  assert.equal(tabValid({}, 'panneau'), true)
  assert.equal(tabValid({ panel: { enabled: false } }, 'panneau'), false)
})

// ---- the drawing, at the two widths Julian uses ------------------------------------------------------------------------
import { el, renderText, widest } from '../lib/factory/scanner/textrender.mjs'
import { drawCockpit } from '../hooks/view.mjs'

const noop = () => {}
const PACT = { tab: noop, plus: noop, ptoggle: noop, nodeToggle: noop, pfilter: noop, pcycle: noop, filePress: noop, filesClear: noop, filesMore: noop, filesRefresh: noop }
const PANEL = (open) => ({
  open, closed: {}, act: PACT,
  files: { head: 'proj-one · main', rows: [{ id: 'C:/code/proj-one/src', label: '▾ src', git: 'M', color: '#e5c07b', selected: false }, { id: 'C:/code/proj-one/src/a-very-long-file-name-that-goes-on-and-on.ts', label: '  · a-very-long-file-name-that-goes-on-and-on.ts', git: '?', selected: true }], more: 3, selected: 'src/a.ts', attach: true, busy: false },
  tree: foldTree([{ key: 'c-a', kind: 'conv', depth: 0, label: 'Lane alpha with a long title for the narrow pane', state: 'working', meta: 'Opus · medium · ctx 12%' }, { key: 'w-1', kind: 'workflow', depth: 1, label: 'workflow package-wave', state: 'running', meta: '2 agents' }, { key: 'a-1', kind: 'agent', depth: 2, label: 'coder · build', state: 'running', meta: 'Opus · medium · 1.2M tok · $3.00' }], {}),
  syn: synthesis(DATA, SCAN, null, { period: 'today' }, {}, NOW), filter: { period: 'today', project: '', state: '', who: 'claude' },
  bars: barsOf({ usage: { rateLimits: [{ kind: 'five_hour', percentUsed: 21 }, { kind: 'seven_day', percentUsed: 85 }] }, tps: 12, ctxPct: 30 }, {}),
  workflows: [{ key: 'wf:r1', name: 'package-wave', count: 2, running: 1, tokens: 12, agents: [{ label: 'coder', model: 'claude-opus-5-5', status: 'running', tokens: 7 }], hidden: 0 }],
})
const PV = (columns, open) => ({ cfg: {}, fcfg: {}, scan: { sessions: [] }, nav: { level: 'mega' }, self: null, busy: false, error: '', at: NOW, columns, filter: 'all',
  usage: null, veille: null, open: {}, act: { tab: noop, plus: noop, menu: noop }, tab: 'panneau', plus: false, panel: PANEL(open) })

for (const columns of [60, 75]) {
  test(`Panneau at ${columns} columns: four sections in order, no left menu, other tabs behind « Plus ▾ »`, () => {
    const all = { fichiers: true, conv: true, convs: true, barres: true, 'wf:r1': true }
    const text = renderText(drawCockpit(el, PV(columns, all)), columns)
    const order = ['[Panneau]', '[Plus ▾]', '▾ Fichiers', 'proj-one · main', '▾ src', 'sélection : src/a.ts', '▾ Cette conversation', 'Lane alpha', 'coder · build',
      '▾ Toutes les conversations', 'aujourd’hui', 'Projet : tous', 'État : tous', '[Claude]', '1. Lane alpha', '▾ Barres', '5 h', 'Semaine', 'Codex semaine', 'tok/s toutes conv', 'Workflows actifs', '▾ package-wave']
      .map((k) => text.indexOf(k))
    assert.ok(order.every((i) => i >= 0), text)
    assert.deepEqual([...order].sort((a, b) => a - b), order, text)
    assert.doesNotMatch(text, /\[Mission\]|\[Jauge\]|\[Registres\]/) // tabs and the left menu are not on the Panneau
    assert.ok(widest(text) <= columns, `${widest(text)} columns\n${text}`)
  })
}

test('Panneau folded: one header line per section with its summary', () => {
  const text = renderText(drawCockpit(el, PV(75, {})), 75)
  for (const k of ['▸ Fichiers', '▸ Cette conversation', '▸ Toutes les conversations', '▸ Barres']) assert.ok(text.includes(k), text)
  assert.match(text, /▸ Barres\]? 5 h 21 %/)
  assert.doesNotMatch(text, /Workflows actifs/)
})
