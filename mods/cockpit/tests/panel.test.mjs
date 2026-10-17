// node --test mods/cockpit/tests/panel.test.mjs - the Panneau's pure parts (invented fixtures only).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panelConfig, foldTree, synthesis, cycle, barsOf, activeWorkflows, stateGroup, contexteOf, otherViews } from '../lib/panel.mjs'
import { convFactory, factoryLines } from '../lib/panel_conv.mjs'
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

test('defaults: five sections, all open, Claude only, top 15, hand-off at 250 k', () => {
  const c = panelConfig({})
  assert.deepEqual(c.order, ['fichiers', 'conv', 'contexte', 'convs', 'graphe'])
  assert.deepEqual(c.open, ['fichiers', 'conv', 'contexte', 'convs', 'graphe'])
  assert.equal(c.contexte.handoff_tokens, 250000)
  // an order written for the old four-section Panneau reads as the new default
  assert.deepEqual(panelConfig({ panel: { order: ['fichiers', 'conv', 'convs', 'barres'] } }).order, c.order)
  assert.equal(c.convs.who, 'claude')
  assert.equal(c.convs.top, 15)
  assert.equal(c.fichiers.attach_selection, true)
  assert.deepEqual(panelConfig({ panel: { order: ['graphe', 'nope', 'conv'] } }).order, ['graphe', 'conv'])
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

test('bars: engine figures first, quotas file second, Codex only when toggled, unknown said', () => {
  const q = { usage: { rateLimits: [{ kind: 'five_hour', percentUsed: 21 }] }, quotas: { claude: { week: { pct: 14 } }, codex: { week: { pct: 30 } } }, tps: 434.4 }
  assert.deepEqual(barsOf({ ...q, codex: true }, {}).map((x) => [x.id, x.text]), [['five', '21 %'], ['week', '14 %'], ['codex_week', '30 %'], ['tps', '434 tok/s']])
  assert.deepEqual(barsOf(q, {}).map((x) => x.id), ['five', 'week', 'tps'])
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

test('contexte: %, tokens, the hand-off threshold marked on the bar, over the threshold said', () => {
  const x = contexteOf({ usage: null, ctxTokens: 100000, fwin: 400000 }, {})
  assert.equal(x.known, true)
  assert.equal(Math.round(x.pct), 25)
  assert.equal(x.text, '25 % · 100K / 400K tokens')
  assert.equal(x.note, 'seuil de relais 250K · reste 150K')
  assert.equal([...x.bar].length, 40)
  assert.equal([...x.bar].indexOf('┃'), 25) // 250 k of 400 k
  const over = contexteOf({ usage: { context: { percent: 70 } }, ctxTokens: 280000, fwin: 400000 }, {})
  assert.equal(over.over, true)
  assert.match(over.note, /dépassé/)
  assert.equal(contexteOf({}, {}).known, false)
  assert.equal(contexteOf({ ctxTokens: 50000 }, { panel: { contexte: { handoff_tokens: 100000, window: 200000 } } }).note, 'seuil de relais 100K · reste 50K')
})

test('other views: one line of /cockpit words, home is « cartes », the Panneau itself left out', () => {
  assert.equal(otherViews([{ id: 'panneau' }, { id: 'home' }, { id: 'mission' }], ['depuis'], {}), 'Autres vues, par /cockpit … : cartes · mission · depuis')
  assert.equal(otherViews([], [], {}), '')
})

// a conversation with a Workflow of two agents, one background agent, a PR opened and one merged (invented)
const T0 = NOW - 3600000
const iso = (m) => new Date(T0 + m * 60000).toISOString()
const FSCAN = {
  sessions: [{ cli: 'me', app_title: 'Lane alpha', live: true, model: 'claude-opus-5-5', app_effort: 'high', ctx: 1000, recent: [] }],
  detail: {
    cli: 'me', calls: [{ tool: 'Workflow', runId: 'wf_1', desc: 'package-wave' }],
    subs: [
      { id: 'x1', type: 'coder', desc: 'build', workflow: 'wf_1', model: 'claude-opus-5-5', effort: 'medium', status: 'running', ts: iso(0), last_ts: iso(50), models: { m: [1000, 0, 0, 0, 0] } },
      { id: 'x2', type: 'verify', workflow: 'wf_1', model: 'claude-sonnet-5-5', effort: 'low', status: 'failed', ts: iso(10), last_ts: iso(20), models: { m: [600, 0, 0, 0, 0] } },
      { id: 'x3', type: 'explore-fast', model: 'claude-haiku-5-5', effort: 'low', status: 'done', ts: iso(1), last_ts: iso(2), models: { m: [60, 0, 0, 0, 0] } },
    ],
    events: [[iso(30), 'pr', 'PR/MR #7 linked'], [iso(40), 'tool', 'Bash gh pr merge 6 --squash'], [iso(41), 'tool', 'Bash ls']],
  },
}

test('factory view: lead, one layer per Workflow + background agents, cards with model, effort, state, tokens, tok/s, log', () => {
  const m = convFactory(FSCAN, 'me', {}, {}, NOW)
  assert.equal(m.available, true)
  assert.equal(m.lead.title, 'Lane alpha')
  assert.equal(m.lead.bars, '▮▮▮▯')
  assert.deepEqual(m.layers.map((l) => [l.key, l.title, l.count, l.running]), [['pfw-wf_1', 'Workflow package-wave', 2, 1], ['pfw-bg', 'Agents en arrière-plan', 1, 0]])
  const coder = m.layers[0].agents[0]
  assert.equal(coder.label, 'coder · build')
  assert.equal(coder.bars, '▮▮▯▯')
  assert.equal(coder.stateLabel, 'en cours')
  assert.equal(coder.tokens, 1000)
  assert.ok(Math.abs(coder.tps - 1000 / 3600) < 1e-9) // running: up to now
  assert.ok(Math.abs(m.layers[0].agents[1].tps - 600 / 600) < 1e-9) // failed: its own 10 minutes
  // the last 6 events, oldest first: agents started / finished, PR opened, PR merged; a plain tool call is not one
  assert.deepEqual(m.log.map((e) => e.text), ['▶ explore-fast démarré', '✓ explore-fast terminé', '▶ verify démarré', '✗ verify en échec', 'PR #7 ouverte', 'PR #6 mergée'])
  assert.equal(convFactory(FSCAN, 'nobody', {}, {}, NOW).available, false)
})

test('factory view as text: boxes and connectors, a folded layer hides its cards, every line fits', () => {
  for (const w of [40, 60, 75]) {
    const lines = factoryLines(convFactory(FSCAN, 'me', {}, {}, NOW), w, {})
    const line = (l) => l.text + (l.fold ? ' [' + l.label + ']' : '')
    const text = lines.map(line).join('\n')
    for (const k of ['╭─ Lead', '├─ Workflows · agents en arrière-plan', '▾ ◇ Workflow package-wave', '╭─ ● coder · build', '▾ ● Agents en arrière-plan', 'retour au lead · review + merge', 'Journal de la session']) assert.ok(text.includes(k), k + '\n' + text)
    assert.ok(lines.every((l) => [...line(l)].length <= w), text)
  }
  const folded = factoryLines(convFactory(FSCAN, 'me', {}, {}, NOW, { 'pfw-wf_1': true }), 60, {})
  assert.ok(folded.some((l) => l.fold === 'pfw-wf_1' && l.label.startsWith('▸')))
  assert.ok(!folded.some((l) => l.text.includes('coder · build')))
})

// ---- the drawing at the two widths Julian uses (the fixtures preview.mjs --panneau draws) --------------------------
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { widest } from '../lib/factory/scanner/textrender.mjs'
import { panneauText } from '../scripts/fixtures/panneau.mjs'

const PREVIEW = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'preview.mjs')
const HEADERS = ['▾ Fichiers', '▾ Cette conversation', '▾ Contexte de cette conversation', '▾ Toutes les conversations', '▾ Graphe des conversations']

for (const columns of [60, 75]) {
  test(`preview --panneau at ${columns} columns: the 5 section headers in order, no tab bar, nothing wider than the pane`, () => {
    const text = execFileSync(process.execPath, [PREVIEW, '--panneau', '--cols', String(columns)], { encoding: 'utf8' })
    const at = HEADERS.map((k) => text.indexOf(k))
    assert.ok(at.every((i) => i >= 0), text)
    assert.deepEqual([...at].sort((a, b) => a - b), at, text)
    // no tab bar at all: no Panneau / Plus button, no old tab, no left menu
    assert.doesNotMatch(text, /\[Panneau\]|\[Plus ▾|\[Moins ▴|\[Mission\]|\[Cockpit\]|\[Journal\]|\[Jauge\]|\[Registres\]/)
    // the old views by their command, one grey line at the very bottom
    const body = text.split('\n').slice(1).join('\n').trimEnd()
    assert.match(body.slice(body.lastIndexOf('Autres vues')), /^Autres vues, par \/cockpit … : cartes · mission/)
    assert.ok(body.indexOf('Autres vues') > body.indexOf('▾ Graphe des conversations'))
    assert.ok(widest(body) <= columns, `${widest(body)} columns\n${body}`)
  })
}

test('Panneau: the factory view, the context and the reserved graph slot are drawn', () => {
  const text = panneauText(75)
  for (const k of ['╭─ Lead', '▮▮▯▯ medium', '◇ Workflow package-wave', '╭─ ● coder · build the panel', 'tok/s', 'retour au lead · review + merge', 'PR #42 ouverte', 'PR #41 mergée',
    '┃', '30 % · 120K / 400K tokens', 'seuil de relais 250K · reste 130K', '1. Lane alpha', 'Workflows actifs', '5 h', 'Semaine', 'tok/s toutes conv', 'emplacement réservé']) assert.ok(text.includes(k), k + '\n' + text)
  assert.doesNotMatch(text, /Codex semaine/) // only while Codex is toggled
  assert.match(panneauText(75, { who: 'codex' }), /Codex semaine/)
})

test('Panneau folded: one header line per section with its summary', () => {
  const text = panneauText(75, { open: {} })
  for (const k of HEADERS) assert.ok(text.includes(k.replace('▾', '▸')), text)
  assert.match(text, /▸ Contexte de cette conversation\]? 30 %/)
  assert.doesNotMatch(text, /Workflows actifs|╭─ Lead/)
})
