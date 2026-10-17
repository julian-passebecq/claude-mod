// node --test mods/cockpit/tests/panel.test.mjs - the Panneau's pure parts (invented fixtures only).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panelConfig, foldTree, synthesis, cycle, barsOf, activeWorkflows, stateGroup, contexteOf, otherViews, textBar, durText, dayText } from '../lib/panel.mjs'
import { convFactory, convFactorySummary } from '../lib/panel_conv.mjs'
import { tabValid, parseArgs, usageCard } from '../hooks/nav.mjs'

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

test('defaults: five sections, Fichiers folded, Claude only, top 15, hand-off at 250 k', () => {
  const c = panelConfig({})
  assert.deepEqual(c.order, ['fichiers', 'conv', 'convs', 'barres', 'graphe'])
  assert.deepEqual(c.open, ['conv', 'convs', 'barres', 'graphe']) // the file tree starts folded (Julian, 17 Oct)
  assert.equal(c.contexte.handoff_tokens, 250000)
  // an order written with « contexte » (now in the lead's card) gets « barres » back after « convs »
  assert.deepEqual(panelConfig({ panel: { order: ['fichiers', 'conv', 'contexte', 'convs', 'graphe'] } }).order, c.order)
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
  // the usage card's reset texts as the grey detail, credits only when the engine reads them
  const card = { windows: [{ when: 'reset dans 2 h' }, { when: 'reset dim 20:30' }], credits: { available: true, pct: 12 } }
  assert.deepEqual(barsOf({ ...q, card }, {}).map((x) => [x.id, x.detail]).slice(0, 3), [['five', 'reset dans 2 h'], ['week', 'reset dim 20:30'], ['credits', 'montant non lu']])
  assert.equal(barsOf({}, {})[0].text, 'non lu')
})

test('credits read like Claude’s Usage pane: amount and expiry when the engine gives them, else the % and « montant non lu »', () => {
  // today's engine: spend_limit has percentUsed (and maybe resetsAt) only
  const only = barsOf({ card: usageCard({ rateLimits: [{ kind: 'spend_limit', percentUsed: 99.6 }] }, null, {}, NOW) }, {}).find((x) => x.id === 'credits')
  assert.deepEqual([only.label, only.text, only.detail, only.under], ['Crédits cloud', '100 %', 'montant non lu', ''])
  // an engine that adds the amounts and the expiry
  const exp = Date.parse('2026-11-05T08:59:00')
  const full = barsOf({ card: usageCard({ rateLimits: [{ kind: 'spend_limit', percentUsed: 99.6, usedUsd: 249, limitUsd: 250, expiresAt: new Date(exp).toISOString() }] }, null, {}, NOW) }, {}).find((x) => x.id === 'credits')
  assert.deepEqual([full.text, full.detail, full.under, full.pct], ['249 $ sur 250 $', '', 'expire le 5 nov 08:59', 99.6])
  assert.equal(dayText(exp, {}), '5 nov 08:59')
  // no spend limit at all: no credits row
  assert.equal(barsOf({ card: usageCard({ rateLimits: [] }, null, {}, NOW) }, {}).some((x) => x.id === 'credits'), false)
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
  assert.equal([...x.bar].indexOf('|'), 25) // 250 k of 400 k
  assert.equal(x.markPct, 62.5)
  assert.equal(x.detail, '100K / 400K · relais 250K')
  assert.doesNotMatch(x.bar, /[█░┃]/)
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

test('thin bars and durations as Claude writes them', () => {
  assert.equal(textBar(50, 10, {}), '▰▰▰▰▰▱▱▱▱▱')
  assert.equal(textBar(0, 4, {}, 50), '▱▱|▱')
  assert.equal(durText(6 * 3600000 + 54 * 60000 + 13000), '6h 54m 13s')
  assert.equal(durText(4 * 60000 + 2000), '4m 02s')
  assert.equal(durText(12000), '12s')
  assert.equal(durText(6 * 3600000 + 56 * 60000 + 13000, true), '6h 56m') // the mini card's elapsed
  assert.equal(durText(4 * 60000 + 2000, true), '4m 02s')
})

test('Cette conversation: the lead card (stats), one card per Workflow + background agents, finished ones apart, log', () => {
  const m = convFactory(FSCAN, 'me', {}, {}, NOW)
  assert.equal(m.available, true)
  assert.equal(m.lead.title, 'Lane alpha')
  assert.equal(m.lead.model, 'Opus 5.5')
  assert.equal(m.lead.effort, 'high')
  assert.equal(m.stats.tokens, 1660)
  assert.equal(m.stats.agents, 3)
  assert.equal(m.stats.running, 1)
  // the running Workflow is a card; the finished background agents go under « Terminés »
  assert.deepEqual(m.cards.map((l) => [l.key, l.title, l.count, l.running]), [['pfw-wf_1', 'package-wave', 2, 1]])
  assert.deepEqual(m.finished.cards.map((l) => [l.key, l.title]), [['pfw-bg', 'Agents en arrière-plan']])
  assert.equal(m.finished.open, false)
  assert.equal(convFactory(FSCAN, 'me', {}, {}, NOW, { 'pfw-finished': false }).finished.open, true)
  // without factory's Workflow screen: one phase holding the agents, running first
  const ph = m.cards[0].phases
  assert.equal(ph.length, 1)
  assert.equal(ph[0].open, true)
  assert.deepEqual(ph[0].dots, ['failed', 'running'])
  // the card: one dot per agent (done, failed, running, pending), folded by default (Claude's mini card)
  assert.deepEqual(m.cards[0].dots, ['failed', 'running'])
  assert.equal(m.cards[0].open, false)
  assert.equal(convFactory(FSCAN, 'me', {}, {}, NOW, { 'pfw-wf_1': false }).cards[0].open, true)
  assert.equal(convFactory(FSCAN, 'me', {}, { panel: { style: { workflow_open: true } } }, NOW).cards[0].open, true)
  const coder = ph[0].agents[0]
  assert.equal(coder.label, 'coder · build') // the label, never just « general-purpose »
  assert.equal(coder.stateLabel, 'en cours')
  assert.equal(coder.tokens, 1000)
  assert.ok(Math.abs(coder.tps - 1000 / 3600) < 1e-9) // running: up to now
  assert.ok(Math.abs(ph[0].agents[1].tps - 600 / 600) < 1e-9) // failed: its own 10 minutes
  // the last 6 events, oldest first: agents started / finished, PR opened, PR merged; a plain tool call is not one
  assert.deepEqual(m.log.map((e) => e.text), ['▶ explore-fast démarré', '✓ explore-fast terminé', '▶ verify démarré', '✗ verify en échec', 'PR #7 ouverte', 'PR #6 mergée'])
  assert.match(convFactorySummary(m), /^Opus 5\.5 · high · .*agents 1\/3$/)
  assert.equal(convFactory(FSCAN, 'nobody', {}, {}, NOW).available, false)
})

test('Cette conversation with factory\'s Workflow run: its phases, ETA and cost; a done phase starts folded', () => {
  const run = { id: 'wf_1', cli: 'me', name: 'package-wave', live: true, elapsed: 3000000, cost: 2.5, estimate: { enough: true, eta: { mid: NOW + 600000 } },
    agents: [{ id: 'r1', label: 'general-purpose', type: 'general-purpose', desc: '', phase: 'A', model: 'claude-sonnet-5-5', status: 'done', start: T0, end: T0 + 60000, durMs: 60000, tokens: 10, cost: 1 },
      { id: 'r2', label: 'coder: pkg-one', phase: 'B', model: 'claude-opus-5-5', effort: 'medium', status: 'running', start: T0, durMs: 120000, tokens: 20, cost: 1.5 }],
    phases: [{ title: 'A', status: 'done', agents: [{ id: 'r1' }] }, { title: 'B', status: 'running', agents: [{ id: 'r2' }] }] }
  const m = convFactory(FSCAN, 'me', {}, {}, NOW, {}, { runs: [run], tps: 12 })
  const k = m.cards[0]
  assert.equal(k.cost, 2.5)
  assert.equal(k.elapsed, 3000000)
  assert.match(k.eta, /^\d\d:\d\d$/)
  assert.deepEqual(k.phases.map((p) => [p.title, p.done, p.count, p.open]), [['A', 1, 1, false], ['B', 0, 1, true]])
  assert.equal(k.phases[1].agents[0].label, 'coder: pkg-one')
  assert.equal(k.phases[1].agents[0].ms, 120000)
  assert.equal(m.stats.tps, 12)
  // the viewer's own fold wins over the default
  const m2 = convFactory(FSCAN, 'me', {}, {}, NOW, { 'pfw-wf_1-ph0': false, 'pfw-wf_1-ph1': true }, { runs: [run] })
  assert.deepEqual(m2.cards[0].phases.map((p) => p.open), [true, false])
})

// ---- the drawing at the two widths Julian uses (the fixtures preview.mjs --panneau draws) --------------------------
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { widest } from '../lib/factory/scanner/textrender.mjs'
import { panneauText } from '../scripts/fixtures/panneau.mjs'

const PREVIEW = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'preview.mjs')
const HEADERS = ['▸ Fichiers', '▾ Cette conversation', '▾ Toutes les conversations', '▾ Barres', '▾ Graphe des conversations']
// box-drawing borders and connectors (Julian, 17 Oct: they look weird and eat the width)
const BOX = /[─│╭╮╰╯├└┬┴┼┃┄█░]/

for (const columns of [45, 60, 75]) {
  test(`preview --panneau at ${columns} columns: the 5 section headers in order, no tab bar, no box drawing, nothing wider than the pane`, () => {
    const text = execFileSync(process.execPath, [PREVIEW, '--panneau', '--cols', String(columns)], { encoding: 'utf8' })
    const at = HEADERS.map((k) => text.indexOf(k))
    assert.ok(at.every((i) => i >= 0), text)
    assert.deepEqual([...at].sort((a, b) => a - b), at, text)
    // no tab bar at all: no Panneau / Plus button, no old tab, no left menu
    assert.doesNotMatch(text, /\[Panneau\]|\[Plus ▾|\[Moins ▴|\[Mission\]|\[Cockpit\]|\[Journal\]|\[Jauge\]|\[Registres\]/)
    // the old views by their command, one grey line at the very bottom
    const body = text.split('\n').slice(1).join('\n').trimEnd()
    assert.match(body.slice(body.lastIndexOf('Autres vues')).replace(/\s+/g, ' '), /^Autres vues, par \/cockpit … : cartes · mission/)
    assert.ok(body.indexOf('Autres vues') > body.indexOf('▾ Graphe des conversations'))
    assert.ok(widest(body) <= columns, `${widest(body)} columns\n${body}`)
    assert.doesNotMatch(body, BOX, body)
  })
}

test('the numbers are never cut at 45 columns: titles are', () => {
  const text = panneauText(45)
  for (const k of ['30 %', '$9.50', '5.1M', '80 %', '40m 00s', '2/2', '■■■□', 'Modèle Temps', '20m 00s', '1.5M tok', '1250 tok/s', '3.6M', '71 %', '21 %', '85 %', '852 tok/s', '3.6M · ctx 30 %']) assert.ok(text.includes(k), k + '\n' + text)
  assert.match(text, /Lane alpha · tableau de… 3\.6M/) // the title is the part that gives way
})

test('Panneau: Claude-style cards for the lead and the Workflow, compact rows, bars, the graph', () => {
  const text = panneauText(75)
  for (const k of ['Lane alpha · tableau de bord', 'Opus 5.5 · medium · en cours', 'Contexte 120K / 400K · relais 250K 30 %', '|', 'Coût', 'Cache hit', 'Sous-agents', '40 %',
    'Modèles : Opus 100 %', 'Ce qui contribue', '[package-wave ⌄]', 'Workflow  4 agents fin vers 18:55 40m 00s', '■■■□', '2.0M tokens  $9.40', 'Phases', '[Wave A ›] 2/2 ■■', '[Wave B ⌄] 0/1 ■',
    '[Merge ›] 0/1 □', 'Modèle Temps', '● Opus 5.5 20m 00s', 'coder: cockpit-claude-style · medium · 1.5M tok · 1250 tok/s', '[Terminés 1 ›]', 'PR #42 ouverte', 'PR #41 mergée',
    '● Lane alpha · tableau de bord 3.6M · $12.00 ▰▰▰▰▰▰▰▱▱▱ 71 %', 'Workflows actifs', 'Session 5 h reset dans 2 h 10 21 %', 'Semaine', 'Crédits cloud montant non lu 12 %', 'tok/s toutes conv',
    'À toi de cliquer (1)', '★ proj-one · 4']) assert.ok(text.includes(k), k + '\n' + text)
  assert.doesNotMatch(text, /general-purpose/)
  assert.doesNotMatch(text, /Codex semaine/) // only while Codex is toggled
  assert.match(panneauText(75, { who: 'codex' }), /Codex semaine/)
  // the Workflow card as it opens in the app: Claude's mini card, name ›, Workflow  N agents  time, one dot per agent
  const folded = panneauText(75, { closed: { 'pfw-wf_1': true } })
  assert.match(folded, /\[package-wave ›\]\n Workflow  4 agents fin vers 18:55 40m 00s\n ■■■□\n/)
  assert.doesNotMatch(folded.slice(0, folded.indexOf('Toutes les conversations')), /Phases|Modèle Temps/)
  // a phase unfolded is Claude's table: header, ✓ model … time, our extras on the grey line under it
  assert.match(panneauText(75, { closed: { 'pfw-wf_1-ph0': false } }), /\[Wave A ⌄\] 2\/2 ■■\n   Modèle Temps\n   ✓ Sonnet 5\.5 15m 00s\n\s+verify · low · 408K tok · \d+ tok\/s\n   ✓ Haiku 5\.5 5m 00s\n/)
  // « Terminés » unfolds to the finished background agents
  assert.match(panneauText(75, { closed: { 'pfw-finished': false } }), /Agents en arrière-plan[\s\S]*explore-fast · find the tests/)
})

test('Panneau folded: one header line per section with its summary', () => {
  const text = panneauText(75, { open: {} })
  for (const k of HEADERS) assert.ok(text.includes(k.replace('▾', '▸')), text)
  // the file tree, unfolded on demand
  assert.match(panneauText(60, { open: { fichiers: true } }), /▾ Fichiers\][\s\S]*proj-one · main/)
  assert.match(text, /▸ Cette conversation\] Opus 5\.5 · medium · ctx 30 %/)
  assert.match(text, /▸ Barres\] Session 5 h 21 %/)
  assert.doesNotMatch(text, /Workflows actifs|Cache hit/)
})


