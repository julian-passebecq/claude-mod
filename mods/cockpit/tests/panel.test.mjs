// node --test mods/cockpit/tests/panel.test.mjs - the Panneau's pure parts (invented fixtures only).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panelConfig, foldTree, synthesis, cycle, barsOf, activeWorkflows, stateGroup, contexteOf, otherViews, textBar, durText, dayText, unfoldPlan, convKey, activeClis, liveness, effectiveWindow } from '../lib/panel.mjs'
import { convFactory, convFactorySummary, convFactories, enCours, runningNow } from '../lib/panel_conv.mjs'
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

test('defaults: six sections, Fichiers folded, Claude only, top 15, hand-off at 250 k', () => {
  const c = panelConfig({})
  assert.deepEqual(c.order, ['fichiers', 'conv', 'convs', 'barres', 'debit', 'graphe'])
  // the macro view (Julian, 19 Oct): the conversations as rows; Quotas, Débit, Graphe one line each; Fichiers folded
  assert.deepEqual(c.open, ['conv', 'convs'])
  assert.equal(c.convs.unfold_max, 0) // nothing unfolds by itself
  assert.equal(c.style.ctx_warn_pct, 62.5)
  assert.equal(c.contexte.handoff_tokens, 250000)
  // an order written with « contexte » (now in the lead's card) gets « barres » back after « convs »
  assert.deepEqual(panelConfig({ panel: { order: ['fichiers', 'conv', 'contexte', 'convs', 'graphe'] } }).order, c.order)
  assert.equal(c.convs.who, 'claude')
  assert.equal(c.convs.top, 15)
  assert.equal(c.fichiers.attach_selection, true)
  assert.deepEqual(panelConfig({ panel: { order: ['graphe', 'nope', 'conv'] } }).order, ['graphe', 'conv'])
  // an order written before Débit gets it right after « barres » (Julian, 18 Oct)
  assert.deepEqual(panelConfig({ panel: { order: ['fichiers', 'conv', 'convs', 'barres', 'graphe'] } }).order, c.order)
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
  assert.equal(otherViews([{ id: 'panneau' }, { id: 'home' }, { id: 'mission' }], ['depuis'], {}), 'Autres vues : /cockpit cartes · mission · depuis')
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
import { widest, el, renderText } from '../lib/factory/scanner/textrender.mjs'
import { panneauText, panneauView, SCAN as PSCAN, FCFG as PFCFG, CLASSEMENT } from '../scripts/fixtures/panneau.mjs'
import { drawCockpit } from '../hooks/view.mjs'
import { treeGlyphs } from '../hooks/panel_view.mjs'

const PREVIEW = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'preview.mjs')
// the tree's connectors at a width (Julian, 20 Oct: « ajoute de l'indentation »): 6-column indents, 4 under
// style.wide_cols (60)
const TREE = (cols) => (cols < 60 ? { m: '├── ', e: '└── ', b: '│   ', n: '    ' } : { m: '├──── ', e: '└──── ', b: '│     ', n: '      ' })
const q = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// the macro view's headers, in order (Julian, 19 Oct: small one-line headers, no big chips)
const HEADERS = ['▸ Fichiers', 'CETTE CONVERSATION', 'CONVERSATIONS · 3 actives', '[QUOTAS]', '[DÉBIT]', '[GRAPHE]']
// box-drawing borders and connectors (Julian, 17 Oct: they look weird and eat the width); since 18 Oct a thin « │ » rule
// runs down an unfolded detail and since 19 Oct the Workflows hang under their conversation with ├ / └: both allowed
const BOX = /[╭╮╰╯┬┴┼┃┄█░]/
const find = (n, key) => { if (!n || typeof n !== 'object') return null; if (n.props && n.props.key === key) return n; for (const c of (n.props && n.props.children) || []) { const f = find(c, key); if (f) return f } return null }
const texts = (n, out = []) => { if (!n || typeof n !== 'object') return out; if (n.type === 'Text') out.push(n); for (const c of (n.props && n.props.children) || []) texts(c, out); return out }

for (const columns of [45, 60, 75]) {
  test(`preview --panneau at ${columns} columns: the macro view, headers in order, no tab bar, nothing wider than the pane`, () => {
    const text = execFileSync(process.execPath, [PREVIEW, '--panneau', '--cols', String(columns)], { encoding: 'utf8' })
    const at = HEADERS.map((k) => text.indexOf(k))
    assert.ok(at.every((i) => i >= 0), text)
    assert.deepEqual([...at].sort((a, b) => a - b), at, text)
    assert.doesNotMatch(text, /\[Panneau\]|\[Plus ▾|\[Moins ▴|\[Mission\]|\[Cockpit\]|\[Journal\]|\[Jauge\]|\[Registres\]/)
    const body = text.split('\n').slice(1).join('\n').trimEnd()
    const foot = body.slice(body.lastIndexOf('Autres vues'))
    assert.match(foot, /^Autres vues : \/cockpit cartes · mission/)
    assert.equal(foot.split('\n').length, 1, foot)
    assert.ok(body.indexOf('Autres vues') > body.indexOf('[GRAPHE]'))
    assert.ok(widest(body) <= columns, `${widest(body)} columns\n${body}`)
    // the « Aujourd’hui » Gantt's ▕███░░▏ rows are the one place block glyphs are drawn
    assert.doesNotMatch(body.split('\n').filter((l) => !/▕.*▏/.test(l)).join('\n'), BOX, body)
    // macro: no card, no table, no stats, no « Workflows actifs » (the tree under each conversation says it)
    assert.doesNotMatch(body, /Workflows actifs|Cache hit|Ce qui contribue|Journal de la session|Modèle Temps|Fenêtre|Phases|Session 5 h/)
    // À toi de cliquer: one amber line at the very top, EN COURS right under it (Julian, 20 Oct)
    assert.match(body, /^◆ À toi de cliquer : \[Lane beta\][^\n]*\nEN COURS {2}\[2 conv\] · 2 (?:workflows|wf) · 2 (?:agents en cours|ag\.)/)
    // folded by default: no card, no journal, no duplicate « Opus 5.5 · medium · travaille » line
    assert.doesNotMatch(body, /journal \(|Opus 5\.5 · medium|Contexte \d/)
    // the quotas, the débit and the graph: one line each
    for (const re of [/^\[QUOTAS\] 5 h .*21 % sem .*85 %.* \[›\]$/m, /^\[DÉBIT\] opus 56 .*TPS \(30 min\) \[›\]$/m, /^\[GRAPHE\] 7 conv · 3 coord · 1 t’attend.* \[›\]$/m]) assert.match(body, re)
    // the conversations as a project-structure tree (Julian, 19 Oct): ├──── └──── │ connectors (├── └── │ at 45); a
    // running conversation has its node line and its metrics line, its children unfolded (Workflows, Terminés N ›,
    // sub-conversations); one with nothing running is ONE line (Julian, 20 Oct: « so the running ones stand out »)
    const g = TREE(columns)
    const seq = (...ls) => assert.match(body, new RegExp('^' + ls.map(q).join('\\n') + '$', 'm'), body)
    const starts = (...ls) => assert.match(body, new RegExp('^' + ls.map((l, i) => q(l) + (i === ls.length - 1 ? '' : '[^\\n]*')).join('\\n'), 'm'), body)
    // Cette conversation: one root (● conversation), its running Workflow (◇) with its running phase (▸) and agent (•)
    // always drawn (Julian, 21 Oct), then « Terminés 1 » under it
    starts(`${g.e}● [Lane alpha · tableau de b`, `${g.n}│ `, `${g.n}│`, `${g.n}${g.m}◇ [package-wave] workflow [›]`, `${g.n}${g.b}│ 2/4 ■■●□ · `,
      `${g.n}${g.b}${g.e}▸ Wave B phase 0/1`, `${g.n}${g.b}${g.n}${g.e}• coder: cock`, `${g.n}│`, `${g.n}${g.e}✓ [Terminés 1] [›]`)
    assert.match(body, new RegExp(`\n${g.n}│ [^\n]*30 % · [^\n]*1 wf · [^\n]*\[détails ›\]`))
    assert.match(body, new RegExp(`\n${g.n}│ {${g.n.length - 1}}│ 2/4 ■■●□ · [^\n]*40 min`))
    // Conversations: a spacer under the header, then the roots; a sub-conversation is ↳
    starts('CONVERSATIONS · 3 actives [filtres ›]', '│', `${g.m}● [Lane alpha · tableau de b`, `│${g.n.slice(1)}│ `, `│${g.n.slice(1)}│`, `│${g.n.slice(1)}${g.e}↳ [Package four]`)
    seq('│', `${g.m}↳ [Lane beta] sous-conv 1.0M`, '│', `${g.m}● [Lane delta] conv [⌄]`)
    starts(`${g.m}● [Lane delta] conv [⌄]`, `│${g.n.slice(1)}│ `, `│${g.n.slice(1)}│`, `│${g.n.slice(1)}${g.e}◇ [wf_2] workflow [›]`, `│${g.n.slice(1)}${g.n}│ 1/2 ■● · `,
      `│${g.n.slice(1)}${g.n}${g.e}• coder · write`, '│', `${g.e}● [Lane gamma] conv 500K`)
    assert.match(body, /\[wf_2\] workflow \[›\]\n│ +│ 1\/2 ■● · [^\n]*15 min\n/)
    seq('│', `${g.e}● [Lane gamma] conv 500K`)
  })
}

test('tree rows: counts on the metrics line; the node line cuts its title; the metrics line drops words, never a number', () => {
  const t75 = panneauText(75)
  const t45 = panneauText(45)
  const t36 = panneauText(36)
  // a Workflow: done/count and dots, the phase, how many agents run on which model, the time
  // at 75 columns the model breakdown goes first, « fin ~HH:MM » stays (Julian, 20 Oct)
  assert.match(t75, /\n {6}│ {5}│ 2\/4 ■■●□ · Wave B · 1 agent en cours · 40 min · fin ~\d\d:\d\d\n/)
  assert.match(panneauText(60), /\n {6}│ {5}│ 2\/4 ■■●□ · 1 agent en cours · 40 min\n/) // then the phase, then the ETA
  assert.match(t45, /\n {4}│ {3}│ 2\/4 ■■●□ · 1 ag\. · 40 min\n/) // « 1 ag. » only when the width forces it
  assert.match(t36, /\n {4}│ {3}│ 2\/4 ■■●□ · 1 ag\. · 40 min\n/)
  // a conversation: ctx, value, its live Workflows, its running agents, its sub-conversations; « détails › » at the right
  assert.match(t75, /└──── ● \[Lane alpha · tableau de bord\] (?:conv )?\[⌄\]\n {6}│ ctx [▰▱|]{10} 30 % · \$9\.50 · 1 wf · 1 agent en cours \[détails ›\]\n/)
  assert.match(t75, /├──── ● \[Lane alpha · tableau de bord\] (?:conv )?\[⌄\]\n│ {5}│ ctx [▰▱|]{10} 30 % · 3\.6M · 1 wf · 1 agent en cours · 1 sous-conv\n/)
  // at 45 the counts (what runs) keep their place, the cost goes (« détails › » has it)
  assert.match(t45, /└── ● \[Lane alpha · tableau de bord\] (?:conv )?\[⌄\]\n {4}│ 30 % · 1 wf · 1 ag\. \[détails ›\]\n/)
  assert.match(t36, /└── ● \[Lane alpha · tableau d…\] \[⌄\]\n {4}│ 30 % · \$9\.50 \[détails ›\]\n/) // the title cut
  for (const k of ['30 %', '$9.50', '3.6M', '800K', '500K', '1.0M', '200K', '2/4', '1/2', '40 min', '15 min']) assert.ok(t36.includes(k), k + '\n' + t36)
  for (const t of [t45, panneauText(60), t75]) for (const k of ['30 %', ...(t === t45 ? [] : ['$9.50']), '3.6M', '800K', '500K', '1.0M', '200K', '2/4', '1/2', '40 min', '15 min', '1 wf', '21 %', '85 %', '852 tok/s']) assert.ok(t.includes(k), k + '\n' + t)
  for (const [t, cols] of [[t36, 36], [t45, 45], [t75, 75]]) for (const l of t.split('\n')) assert.ok([...l].length <= cols, `${cols}: ${l}`)
})

// ---- indentation (Julian, 20 Oct after PR #65: « ajoute de l'indentation ») -----------------------------------------
// the column of a node's connector (├ └) on a line, -1 when none
const connAt = (l) => l.search(/[├└]/)

test('tree indent: 6 columns per level at 60 / 75, 4 at 45; conversation, sub-conversation, Workflow, agent stepped; panel.tree.indent', () => {
  const auto = panelConfig({})
  assert.equal(auto.tree.indent, 'auto')
  assert.deepEqual(treeGlyphs(auto, 75), { mid: '├──── ', end: '└──── ', bar: '│     ', none: '      ' })
  assert.deepEqual(treeGlyphs(auto, 60), treeGlyphs(auto, 75))
  assert.deepEqual(treeGlyphs(auto, 45), { mid: '├── ', end: '└── ', bar: '│   ', none: '    ' })
  assert.deepEqual(treeGlyphs(panelConfig({ panel: { tree: { indent: 3 } } }), 75), { mid: '├─ ', end: '└─ ', bar: '│  ', none: '   ' })
  assert.equal(treeGlyphs(panelConfig({ panel: { tree: { indent: 1 } } }), 75).mid, '├ ') // at least 2
  for (const [cols, n] of [[45, 4], [60, 6], [75, 6]]) {
    // CETTE CONVERSATION with its Workflow unfolded: the conversation at 0, its Workflow one level in, its agents two
    const t = panneauText(cols, { closed: { 'pfw-wf_1': false } }).split('\n')
    const at = (re) => connAt(t.find((l) => re.test(l)) || '')
    assert.equal(at(/[├└]─+ ● \[Lane alpha/), 0, t.join('\n'))
    assert.equal(at(/[├└]─+ ◇ \[package-wave/), n, t.join('\n'))
    // its phases two levels in, their agents three (Julian, 21 Oct: at least 4 columns per level at 45, titles cut first)
    for (const p of ['Wave A', 'Wave B', 'Merge']) assert.equal(at(new RegExp(`[├└]─+ ▸ ${q(p)}`)), 2 * n, p + '\n' + t.join('\n'))
    for (const a of ['verify(?!:)', 'explore-fast', 'coder: ', 'verify: ']) assert.equal(at(new RegExp(`[├└]─+ • ${a}`)), 3 * n, a + '\n' + t.join('\n'))
    // CONVERSATIONS: a sub-conversation one level under its conversation, a Workflow too
    const c = t.slice(t.findIndex((l) => l.startsWith('CONVERSATIONS')))
    assert.equal(connAt(c.find((l) => l.includes('[Package four]'))), n, c.join('\n'))
    assert.equal(connAt(c.find((l) => l.includes('[wf_2] workflow'))), n, c.join('\n'))
    assert.equal(connAt(c.find((l) => l.includes('[Lane delta]'))), 0, c.join('\n'))
  }
  // a number in the config: that many columns per level, at every width
  const t3 = panneauText(75, { indent: 3 })
  assert.match(t3, /\n└─ ● \[Lane alpha · tableau de bord\] (?:conv )?\[⌄\]\n {3}│ ctx /)
  assert.match(t3, /\n {3}├─ ◇ \[package-wave\] workflow \[›\]\n/)
})

test('tree: the metrics line starts under the title’s first letter and wraps nowhere', () => {
  for (const cols of [45, 60, 75]) {
    for (const o of [{}, { closed: { 'pfw-wf_1': false } }, { closed: { [convKey('b')]: false, [convKey('c')]: false } }]) {
      const t = panneauText(cols, o).split('\n')
      let checked = 0
      t.forEach((l, i) => {
        // a node line: connector, state mark, then the title (a plain button, drawn « [ » here)
        const m = /^([│ ]*[├└]─+ )[●◆✕✓○⚠·] \[/.exec(l)
        const next = t[i + 1] || ''
        if (!m || /^[│ ]*$/.test(next) || /[├└]/.test(next) || !/^[│ ]+\S/.test(next)) return
        const title = m[1].length + 2
        const start = next.search(/[^│ ]/)
        assert.equal(start, title, `${cols} columns, under « ${l} »:\n${next}`)
        // one line: the line after the metrics line is a spacer, a node, a detail line under the same column, or the end
        const after = t[i + 2] || ''
        assert.ok(/^[│ ]*$/.test(after) || /[├└]/.test(after) || after.search(/[^│ ]/) === title || !/^[│ ]/.test(after), `${cols}: wrapped?\n${l}\n${next}\n${after}`)
        assert.ok([...next].length <= cols, next)
        checked++
      })
      assert.ok(checked >= 3, `${cols} ${JSON.stringify(o)}: ${checked} metrics lines\n${t.join('\n')}`)
    }
  }
})

test('tree: a blank « │ » line between sibling conversations at the top level, none between the agents of one Workflow', () => {
  for (const cols of [45, 60, 75]) {
    const t = panneauText(cols, { closed: { 'pfw-wf_1': false } }).split('\n')
    const c = t.slice(t.findIndex((l) => l.startsWith('CONVERSATIONS')))
    const roots = c.map((l, i) => [l, i]).filter(([l]) => /^[├└]─+ /.test(l))
    assert.equal(roots.length, 4, c.join('\n'))
    for (const [, i] of roots) assert.equal(c[i - 1], '│', `${cols}: no spacer above « ${c[i]} »\n${c.join('\n')}`)
    // the phases and agents of the unfolded Workflow: seven node lines in a row (3 phases, 4 agents)
    const first = t.findIndex((l) => /[├└]─+ ▸ Wave A/.test(l))
    assert.ok(first > 0, t.join('\n'))
    for (let k = first; k < first + 7; k++) assert.match(t[k], /[├└]─+ [▸•] /, `${cols}: a spacer between agents\n${t.join('\n')}`)
  }
})

test('EN COURS counts every conversation of the scan: a 16th conversation, past the top 15 shown, still counts', () => {
  // 13 idle conversations between Lane beta (1.0M) and Lane delta (800K): Lane delta, working with its Workflow, is 16th
  const fill13 = Array.from({ length: 13 }, (_, i) => `f${i}`)
  const data = { ...CLASSEMENT, sessions: { ...CLASSEMENT.sessions, ...Object.fromEntries(fill13.map((id, i) => [id, { t: `Filler ${i}`, p: 'proj-one' }])) },
    rows: [...CLASSEMENT.rows, ...fill13.map((id) => [Math.floor(NOW / 3600000) * 3600000 - 3600000, id, 'main', 'claude-opus-5-5', '', '', '', 900000, 0, 0, 0, 0, 1, 0, 1])] }
  const view = panneauView(75, { data })
  const P = view.panel
  assert.equal(P.syn.rows.length, 15)
  assert.ok(!P.syn.rows.some((r) => r.id === 'd'), P.syn.rows.map((r) => r.id).join(' '))
  assert.equal(P.syn.every.length, 18)
  assert.equal(P.syn.every.findIndex((r) => r.id === 'd'), 15)
  const n = enCours({ syn: P.synAll, factory: P.factory, factories: P.convFactories, self: 'lead' })
  assert.deepEqual([n.convs, n.workflows, n.agents], [2, 2, 2])
  assert.match(renderText(drawCockpit(el, view), 75), /\nEN COURS {2}\[2 conv\] · 2 workflows · 2 agents en cours \[voir ›\]\n/)
  // the rows shown only (no synAll): its factory, built for an active conversation of the scan, still counts it
  assert.deepEqual(enCours({ syn: P.syn, factory: P.factory, factories: P.convFactories, self: 'lead' }).workflows, 2)
})

test('EN COURS: conversations, Workflows, running agents by model, blocked ones, counted from the fixtures', () => {
  const view = panneauView(75)
  const P = view.panel
  assert.deepEqual(enCours({ syn: P.syn, factory: P.factory, factories: P.convFactories, self: 'lead' }),
    { convs: 2, workflows: 2, agents: 2, fams: [['opus', 1], ['sonnet', 1]], blocked: 0 })
  // a blocked row, a stalled Workflow: blocked, not running; a row that only works: one conversation
  const stuck = convFactory(STALL_SCAN(70), 'w', {}, {}, NOW, {}, { runs: STALL_RUN(70) })
  const syn = { rows: [{ id: 'x', mark: 'blocked' }, { id: 'y', mark: 'working' }, { id: 'w', mark: 'working' }, { id: 'z', mark: 'done' }] }
  assert.deepEqual(enCours({ syn, factory: null, factories: { w: stuck }, self: 'me' }), { convs: 1, workflows: 1, agents: 1, fams: [['opus', 1]], blocked: 2 })
  assert.deepEqual(enCours({}), { convs: 0, workflows: 0, agents: 0, fams: [], blocked: 0 })
  // « N agents en cours » as on every row (Julian, 20 Oct); the models go first, « 2 ag. » only when the width forces it
  // « voir › » at the right (Julian, 21 Oct) takes its room from the models first
  assert.match(panneauText(90), /\nEN COURS {2}\[2 conv\] · 2 workflows · 2 agents en cours \(1 opus, 1 sonnet\) \[voir ›\]\n/)
  assert.match(panneauText(75), /\nEN COURS {2}\[2 conv\] · 2 workflows · 2 agents en cours \[voir ›\]\n/)
  assert.match(panneauText(60), /\nEN COURS {2}\[2 conv\] · 2 wf · 2 agents en cours \[voir ›\]\n/)
  assert.match(panneauText(45), /\nEN COURS {2}\[2 conv\] · 2 wf · 2 ag\. \[voir ›\]\n/)
  const blockedSyn = { ...P.syn, rows: [...P.syn.rows.slice(0, 1).map((r) => ({ ...r, mark: 'blocked' })), ...P.syn.rows.slice(1)] }
  const t = renderText(drawCockpit(el, { ...view, panel: { ...P, syn: blockedSyn, synAll: blockedSyn } }), 75)
  assert.match(t, /\nEN COURS {2}\[1 conv\] · 2 workflows · 2 agents en cours · \[1 bloqué\] \[voir ›\]\n/) // the models make room for it
  const idle = renderText(drawCockpit(el, { ...view, panel: { ...P, factory: null, syn: { ...P.syn, rows: [] }, synAll: null, convFactories: {} } }), 75)
  assert.match(idle, /\nEN COURS {2}rien ne tourne\n/)
  // the numbers filter CONVERSATIONS: en cours, t'attend
  const filtered = []
  const v2 = panneauView(75)
  v2.panel.act = { ...v2.panel.act, pfilter: (k, x) => filtered.push([k, x]) }
  find(drawCockpit(el, v2), 'pec-conv').props.onPress()
  assert.deepEqual(filtered, [['state', 'running']])
})

test('micro: unfolding a conversation shows its children only; « détails › » its card; journal folded; no duplicate model line', () => {
  // folded by default for every conversation, the current one included
  const plain = panneauText(75)
  assert.doesNotMatch(plain, /Cache hit|Ce qui contribue|Contexte \d|journal \(/)
  assert.equal((plain.match(/\[détails ›\]/g) || []).length, 2, plain) // this conversation and Lane delta (running)
  const self = panneauText(75, { closed: { pdetails: false } })
  for (const k of ['Contexte 120K / 400K · relais 250K 30 %', 'Coût', 'Cache hit', 'Sous-agents', 'Modèles : Opus 100 %', 'Ce qui contribue', '[journal (6) ›]', '[détails ⌄]']) assert.ok(self.includes(k), k + '\n' + self)
  // no « Opus 5.5 · medium · travaille » line under the row: the metrics line says it
  assert.doesNotMatch(self, /Opus 5\.5 · medium|Journal de la session|PR #42 ouverte/)
  assert.match(self, /└──── ● \[Lane alpha · tableau de bord\] (?:conv )?\[⌄\]\n {6}│ ctx [^\n]*\[détails ⌄\]\n {6}│ Contexte 120K/)
  assert.match(self, /\[journal \(6\) ›\]\n {6}│\n {6}├──── ◇ \[package-wave\] workflow \[›\]\n/)
  const log = panneauText(75, { closed: { pdetails: false, pjournal: false } })
  for (const k of ['[journal (6) ⌄]', 'PR #42 ouverte', 'PR #41 mergée']) assert.ok(log.includes(k), k + '\n' + log)
  assert.doesNotMatch(self, /general-purpose/)
  // its children folded: the row and its metrics line, nothing under it
  const folded = panneauText(75, { closed: { pself: true } })
  assert.match(folded, /└──── ● \[Lane alpha · tableau de bord\] (?:conv )?\[›\]\n {8}ctx [^\n]*\n\nCONVERSATIONS/)
  // folded, a Workflow still shows its running phase and agents (Julian, 21 Oct); unfolded: its metrics, tokens, cost,
  // Gantt, then every phase (▸) with every agent (•), dense (no spacer between them)
  assert.match(plain, /├──── ◇ \[package-wave\] workflow \[›\]\n {6}│ {5}│ 2\/4 ■■●□ · [^\n]*\n {6}│ {5}└──── ▸ Wave B phase 0\/1\n {6}│ {11}└──── • coder: cockpit-claude-style opus · 20 min · 1\.5M\n {6}│\n/)
  const wf = panneauText(75, { closed: { 'pfw-wf_1': false } })
  assert.match(wf, /├──── ◇ \[package-wave\] workflow \[⌄\]\n {6}│ {5}│ 2\/4 ■■●□ · [^\n]*\n {6}│ {5}│ 4 agents {2}2\.0M tokens {2}\$9\.40 {2}40m 00s {2}fin vers \d\d:\d\d\n(?: {6}│ {5}│[^\n]*\n)+? {6}│ {5}├──── ▸ Wave A phase 2\/2\n {6}│ {5}│ {5}├──── • verify sonnet · 15 min · 408K\n {6}│ {5}│ {5}└──── • explore-fast: map files haiku · 5 min · 100K\n {6}│ {5}├──── ▸ Wave B phase 0\/1\n {6}│ {5}│ {5}└──── • coder: cockpit-claude-style opus · 20 min · 1\.5M\n {6}│ {5}└──── ▸ Merge phase 0\/1\n {6}│ {11}└──── • verify: CI sonnet · 0\n/)
  assert.doesNotMatch(wf, /Phases|Modèle Temps/) // the agents are its children: no table repeating them
  // « Terminés N › » is a child, folded; unfolded one line per finished Workflow / agent: name, ✓, duration, how long ago
  assert.match(panneauText(75, { closed: { 'pfw-finished': false } }), /└──── ✓ \[Terminés 1\] \[⌄\]\n {12}└──── ◦ explore-fast · find the te[^\n]* ✓ · 2 min · il y a 48 min\n/)
  // another conversation: its children (its Workflow), « détails › » adds « ouvrir ↗ » and its card; the Workflow drawn once
  const d = panneauText(75, { closed: { 'cv:d:pdetails': false } })
  assert.match(d, /├──── ● \[Lane delta\] conv \[⌄\]\n│ {5}│ ctx [^\n]*\[détails ⌄\]\n│ {5}│ \[ouvrir ↗\]\n│ {5}│ Contexte 60K[^\n]*\n(?:│ {5}│[^\n]*\n)+│ {5}└──── ◇ \[wf_2\] workflow \[›\]\n/)
  assert.equal(d.split('\n').filter((l) => l.includes('[wf_2')).length, 1, d)
  // an idle conversation is ONE line, its bullet grey; unfolded, its metrics line (its state said), « détails › »
  assert.match(plain, /\n└──── ● \[Lane gamma\] conv 500K\n/)
  assert.match(panneauText(75, { closed: { [convKey('c')]: false } }), /└──── ● \[Lane gamma\] conv \[⌄\]\n {8}500K · terminée \[détails ›\]\n/)
  assert.match(panneauText(75, { closed: { [convKey('c')]: false, 'cv:c:pdetails': false } }), /500K · terminée \[détails ⌄\]\n {8}fabrique non lue/)
  const b = panneauText(75, { closed: { [convKey('b')]: false } })
  assert.match(b, /├──── ↳ \[Lane beta\] sous-conv \[⌄\]\n│ {7}1\.0M · t’attend · ↖ lancée par PM BETA \[détails ›\]\n│\n├──── ● \[Lane delta\]/)
})

test('micro: Quotas unfold to the Usage-like bars, Débit to its tables, Graphe to its tree; filters behind « filtres › »', () => {
  const q = panneauText(75, { open: { conv: true, convs: true, barres: true } })
  for (const k of ['Session 5 h reset dans 2 h 10 21 %', 'Crédits cloud montant non lu 12 %', 'tok/s toutes conv 852 tok/s']) assert.ok(q.includes(k), k + '\n' + q)
  assert.match(q, /\[QUOTAS\][^\n]*\[⌄\]\n {2}Session 5 h/)
  assert.match(q, /Semaine reset .+ 85 %/) // the reset day and hour follow the local clock
  assert.doesNotMatch(panneauText(75, { open: { conv: true, convs: true, barres: true } }), /Codex semaine/)
  assert.match(panneauText(75, { who: 'codex', open: { conv: true, convs: true, barres: true } }), /Codex semaine/)
  const g = panneauText(75, { open: { conv: true, convs: true, graphe: true } })
  for (const k of ['[24 h ▾] [Projet ▾] [Actives] [Archivées]', '★ proj-one · 5', '● travaille ◆ attend']) assert.ok(g.includes(k), k + '\n' + g)
  // À toi de cliquer is at the top only, not repeated in the graph
  assert.equal(g.split('\n').filter((l) => l.includes('Choisir la version')).length, 1, g)
  assert.doesNotMatch(panneauText(75), /\[aujourd’hui ▾\]/)
  const f = panneauText(75, { open: { conv: true, convs: true, convs_filters: true } })
  assert.match(f, /CONVERSATIONS · 3 actives \[filtres ⌄\]\n {2}\[aujourd’hui ▾\] \[Projet ▾\] \[État ▾\] \[Claude ▾\]\n {2}Total aujourd’hui/)
  assert.match(panneauText(45, { open: { conv: true, convs: true, convs_filters: true } }), /\n {2}\[auj\. ▾\] \[Projet ▾\] \[État ▾\] \[Claude ▾\]\n/)
})

test('colours: one state colour per line, numbers bold only when alarming (ctx at 62.5 % amber, past the hand-off red ⚠)', () => {
  const view = panneauView(75)
  const pick = (tree, k) => texts(find(tree, k)).map((t) => [String(t.props.children[0]), Boolean(t.props.bold)])
  const alpha = pick(drawCockpit(el, view), 'pc-lead-m')
  assert.deepEqual(alpha.find((x) => x[0] === '30 %'), ['30 %', false]) // 30 %: grey, not bold
  assert.equal(alpha.filter((x) => x[1]).length, 0, JSON.stringify(alpha))
  // a conversation at 70 % of 400 K (amber, bold) and one past the 250 K hand-off (red, bold, ⚠)
  const base = view.panel.syn.rows[2]
  const syn = { ...view.panel.syn, rows: [{ ...base, id: 'w', ctx: 280000 }, { ...base, id: 'x', ctx: 300000 }] }
  const tree = drawCockpit(el, { ...view, panel: { ...view.panel, syn } })
  assert.deepEqual(pick(tree, 'pc-w-m').find((x) => x[0] === '70 %'), ['70 %', true])
  assert.ok(pick(tree, 'pc-x-m').some((x) => x[0] === '75 %' && x[1]) && pick(tree, 'pc-x-n').some((x) => x[0] === '⚠'), JSON.stringify(pick(tree, 'pc-x-n')))
  // a stalled Workflow: amber ⚠ and « à l'arrêt 1 h 10 » in bold
  const stuck = convFactory(STALL_SCAN(70), 'w', {}, {}, NOW, {}, { runs: STALL_RUN(70) })
  const t = renderText(drawCockpit(el, { ...view, panel: { ...view.panel, factory: stuck } }), 75)
  assert.match(t.replace(/\u00a0/g, ' '), /── ◇ \[Preview release\] workflow \[›\]\n {6}[│ ] {5}│ 0\/1 ● · 1 agent en cours \(opus\) · à l’arrêt 1 h 10\n/)
  // typed bullets, the state on their colour (Julian, 21 Oct): the stalled Workflow's ◇ amber, its agent's • green
  const st = drawCockpit(el, { ...view, panel: { ...view.panel, factory: stuck } })
  const first = (tr, k) => texts(find(tr, k))[0].props
  assert.deepEqual([first(st, 'pkh-pfw-wf_s').children[0], first(st, 'pkh-pfw-wf_s').color], ['◇', 'warning'])
  assert.deepEqual([first(st, 'pkah-pfw-wf_s-w1').children[0], first(st, 'pkah-pfw-wf_s-w1').color], ['•', 'success'])
  // a finished conversation's ● is grey, a waiting sub-conversation's ↳ amber
  const base2 = drawCockpit(el, view)
  assert.deepEqual([first(base2, 'pc-c-h').children[0], first(base2, 'pc-c-h').dimColor], ['●', true])
  assert.deepEqual([first(base2, 'pc-b-h').children[0], first(base2, 'pc-b-h').color], ['↳', 'warning'])
  // running nodes bold, finished / idle grey
  const conv = find(drawCockpit(el, view), 'pcv-d')
  assert.equal(conv.props.children[0].props.bold, true)
  assert.equal(find(drawCockpit(el, view), 'pcv-c').props.children[0].props.dimColor, true)
})

test('section headers: small bold one-liners, a plain button for the one-line sections; every row toggles its own key', () => {
  const tree = drawCockpit(el, panneauView(75))
  const head = find(tree, 'p-sec-barres')
  assert.equal(head.type, 'Button')
  assert.equal(head.props.label, 'QUOTAS')
  assert.equal(head.props.plain, true)
  assert.equal(head.props.children[0].props.bold, true)
  assert.equal(head.props.children[0].props.size, undefined) // no heading size, no big chip
  const convs = find(tree, 'p-sec-convs')
  assert.equal(convs.type, 'Text')
  assert.equal(convs.props.bold, true)
  const toggled = []
  const opened = []
  const view = panneauView(75)
  view.panel.act = { ...view.panel.act, ptoggle: (id) => toggled.push(id), nodeToggle: (k, o) => toggled.push([k, o]), openConv: (l) => opened.push(l) }
  const t2 = drawCockpit(el, view)
  for (const k of ['p-sec-barres', 'p-sec-debit-x', 'p-sec-graphe', 'pcv-d', 'pcv-d-x', 'pcv-lead', 'pk-pfw-wf_1-t', 'pgw-b']) find(t2, k).props.onPress()
  // d and this conversation run a Workflow: their children are unfolded, a click folds them
  assert.deepEqual(toggled, ['barres', 'debit', 'graphe', [convKey('d'), true], [convKey('d'), true], ['pself', true], ['pfw-wf_1', false]])
  assert.deepEqual(opened, ['claude://claude.ai/epitaxy/local_b'])
})

test('Graphe unfolded: an active conversation unfolds under its row, its title folds it, « ouvrir ↗ » opens it', () => {
  const opened = []
  const toggled = []
  const view = panneauView(75, { open: { conv: true, convs: true, graphe: true }, closed: { [convKey('b')]: false } })
  view.panel.act = { ...view.panel.act, openConv: (l) => opened.push(l), nodeToggle: (k, o) => toggled.push([k, o]) }
  const tree = drawCockpit(el, view)
  const text = renderText(tree, 75)
  const g = text.slice(text.indexOf('[GRAPHE]'), text.indexOf('Autres vues'))
  assert.match(g, /◆ \[Lane beta ⌄\] 1\.0M \[ouvrir ↗\]\n {6,}│ /)
  assert.match(g, /○ \[PM BETA ›\] coord \[ouvrir ↗\]/) // inactive: folded
  find(tree, 'pgl-b').props.onPress()
  find(tree, 'pgo-b').props.onPress()
  assert.deepEqual(toggled, [[convKey('b'), true]])
  assert.deepEqual(opened, ['claude://claude.ai/epitaxy/local_b'])
})

// The engine draws the first 100,000 characters of a tree's texts (children, labels, alts) and cuts the rest; the pane
// itself scrolls with no line limit (plugin reference, ui.render). The macro view keeps a busy evening far under it,
// even with 6 busy conversations unfolded by the viewer.
test('the engine bound holds with 6 busy conversations unfolded in both lists (100,000 characters of text drawn, 32 deep)', () => {
  const view = panneauView(75, { open: { conv: true, convs: true, graphe: true } })
  const subs = (w) => Array.from({ length: 12 }, (_, i) => ({ id: `${w}-${i}`, type: 'coder', desc: 'a rather long task description for this agent', model: 'claude-opus-5-5', effort: 'medium',
    status: i % 3 ? 'done' : 'running', workflow: w, ts: new Date(NOW - 3600000).toISOString(), last_ts: new Date(NOW).toISOString(), models: { 'claude-opus-5-5': [1000, 100, 9000, 0, 0, 3] } }))
  const sessions = Array.from({ length: 10 }, (_, i) => ({ cli: 'busy' + i, sid: 'local_busy' + i, app_title: 'Busy lane number ' + i, cwd: 'C:/code/proj-one', live: true, model: 'claude-opus-5-5', ctx: 200000, recent: [], models: { 'claude-opus-5-5': [1000, 100, 9000, 0, 0, 3] }, subs: subs('wf_b' + i) }))
  const scan = { sessions: [...PSCAN.sessions, ...sessions], detail: PSCAN.detail }
  const syn = { ...view.panel.syn, rows: sessions.map((s, i) => ({ id: s.cli, sid: s.sid, label: s.app_title, project: 'proj-one', state: 'running', mark: 'working', tokens: 1000 * (i + 1), cost: 1, tps: 1, last: '', ctx: 200000, model: s.model, effort: 'medium' })) }
  const graphe = { ...view.panel.graphe, groups: [{ name: 'proj-one', count: 10, starred: false, lines: sessions.map((s) => ({ key: s.cli, depth: 0, prefix: '', cont: '', state: 'working', word: 'travaille', dot: '●', tone: 'ok', title: s.app_title, starred: false, self: false, role: 'lane', roleId: 'lane', tokens: 1000, ctx: 50, peers: [], from: '', link: 'claude://claude.ai/epitaxy/' + s.sid })) }] }
  const closed = Object.fromEntries(sessions.slice(0, 6).flatMap((s) => [[convKey(s.cli), false], [convKey(s.cli) + ':pdetails', false]]))
  const under = convFactories({ scan, runs: [], syn, graphe, self: 'lead', selfFactory: view.panel.factory, closed, tpsById: {}, cardOf: (s) => usageCard(null, s, PFCFG, NOW) }, PFCFG, {}, NOW)
  assert.equal(under.unfold.size, 6)
  assert.ok(under.kids.size <= 6 + panelConfig({}).convs.tree_max, String(under.kids.size))
  assert.equal(convFactories({ scan, runs: [], syn, graphe, self: 'lead', closed: {} }, PFCFG, {}, NOW).unfold.size, 0) // nothing by itself
  const svgEl = { ...el, Svg: (props) => ({ type: 'Svg', props }) }
  const tree = drawCockpit(svgEl, { ...view, panel: { ...view.panel, syn, graphe, unfold: under.unfold, tree: under.tree, kids: under.kids, convFactories: under.factories }, colors: { usage: '#2f81f7' } })
  let chars = 0
  let depth = 0
  const walk = (n, d) => {
    if (typeof n === 'string') { chars += n.length; return }
    if (!n || typeof n !== 'object') return
    depth = Math.max(depth, d)
    chars += String(n.props.label || '').length + String(n.props.alt || '').length
    for (const c of n.props.children || []) walk(c, d + 1)
  }
  walk(tree, 1)
  assert.ok(chars < 100000, `${chars} characters of text`)
  assert.ok(depth <= 32, `${depth} deep`)
})

test('unfoldPlan: the viewer decides; unfold_max > 0 brings back the active conversations unfolded', () => {
  const active = new Set(['a', 'b', 'c', 'me'])
  assert.deepEqual([...unfoldPlan(['me', 'a', 'x', 'b', 'c', 'a'], active, {}, 'me', {})], [])
  assert.deepEqual([...unfoldPlan(['a', 'b', 'c'], active, {}, 'me', { panel: { convs: { unfold_max: 2 } } })], ['a', 'b'])
  assert.deepEqual([...unfoldPlan(['me', 'a', 'x'], active, { [convKey('a')]: true, [convKey('x')]: false, [convKey('me')]: false }, 'me', {})].sort(), ['me', 'x'])
  assert.equal(convKey('abc'), 'cv:abc')
})

test('activeClis: travaille / attend lines of the graph, a live or waiting scan row, a running agent, a live Workflow run', () => {
  const scan = { sessions: [{ cli: 'live', live: true }, { cli: 'wait', awaiting: true }, { cli: 'sub', subs: [{ status: 'running' }] }, { cli: 'old' }, { cli: 'arch', live: true, archived: true }] }
  const graphe = { ready: true, waiting: [{ key: 'gw' }], groups: [{ lines: [{ key: 'gl', state: 'working' }, { key: 'gd', state: 'done' }] }] }
  const a = activeClis({ scan, runs: [{ cli: 'run', live: true }, { cli: 'gone', live: false }], graphe }, {}, NOW)
  assert.deepEqual([...a].sort(), ['gl', 'gw', 'live', 'run', 'sub', 'wait'])
})

// Julian's screenshot of 18 Oct (PR #58 state): « au repos » next to a phase running for 1h10m, $0.00 for 243K tokens,
// « / 1.0M » here and « / 400K » elsewhere, 12 lines of empty stats for an idle conversation (invented fixtures)
const STALL_SCAN = (lastMin) => ({ sessions: [{ cli: 'w', app_title: 'Wave lane', live: false, model: 'claude-opus-5-5', app_effort: 'medium', ctx: 90000, recent: [],
  models: { 'claude-opus-5-5': [1000, 0, 0, 0, 0, 1] },
  subs: [{ id: 'w1', type: 'coder', desc: 'release', workflow: 'wf_s', model: 'claude-opus-5-5', status: 'running', ts: new Date(NOW - 80 * 60000).toISOString(), last_ts: new Date(NOW - lastMin * 60000).toISOString(), models: { 'claude-opus-5-5': [500, 0, 0, 0, 0, 1] } }] }] })
const STALL_RUN = (lastMin) => [{ id: 'wf_s', cli: 'w', name: 'Preview release', live: true, status: 'running', elapsed: 80 * 60000,
  agents: [{ id: 'w1', label: 'coder', phase: 'Preview release', model: 'claude-opus-5-5', status: 'running', start: NOW - 80 * 60000, idle: lastMin * 60000, durMs: 80 * 60000, tokens: 500, cost: 0 }],
  phases: [{ title: 'Preview release', status: 'running', agents: [{ id: 'w1' }] }] }]

test('a running Workflow that wrote nothing for 30 min: card « à l’arrêt ? », conversation « bloquée ? »; written recently: « travaille »', () => {
  const stuck = convFactory(STALL_SCAN(70), 'w', {}, {}, NOW, {}, { runs: STALL_RUN(70) })
  assert.equal(stuck.lead.stateId, 'stalled')
  assert.equal(stuck.lead.state, 'bloquée ?')
  assert.equal(stuck.lead.tone, 'warn')
  assert.equal(stuck.cards[0].stalled, true)
  assert.equal(stuck.cards[0].stalledText, 'à l’arrêt ? rien d’écrit depuis 1h 10m')
  const moving = convFactory(STALL_SCAN(5), 'w', {}, {}, NOW, {}, { runs: STALL_RUN(5) })
  assert.equal(moving.lead.state, 'travaille')
  assert.equal(moving.lead.live, true)
  assert.equal(moving.cards[0].stalled, false)
  assert.equal(liveness(STALL_SCAN(70).sessions[0], STALL_RUN(70), 'w', NOW, {}).state, 'stalled')
  assert.equal(liveness(STALL_SCAN(70).sessions[0], STALL_RUN(70), 'w', NOW, { panel: { conv: { stall_min: 90 } } }).state, 'working')
  assert.equal(liveness({ subs: [] }, [], 'w', NOW, {}), null)
  // the same state in « Toutes les conversations »
  const data = { v: 1, generated: NOW, tzMin: 0, days: 31, sessions: { w: { t: 'Wave lane', p: 'proj-one' } }, rows: [R(0, 'w', 1000, 1)] }
  const row = (min) => synthesis(data, STALL_SCAN(min), null, { period: 'today', runs: STALL_RUN(min) }, {}, NOW).rows[0]
  assert.deepEqual([row(70).mark, row(70).stateLabel], ['stalled', 'bloquée ?'])
  assert.deepEqual([row(5).mark, row(5).state], ['working', 'running'])
  assert.equal(synthesis(data, STALL_SCAN(70), null, { period: 'today' }, {}, NOW).rows[0].mark, 'idle') // without the runs: the scan alone
})

test('cost: the price table over the transcripts, then the row, then the engine; never $0.00 for tokens spent', () => {
  const s = { cli: 'me', app_title: 'Lead', live: true, model: 'claude-opus-5-5', models: { 'claude-opus-5-5': [200000, 43000, 0, 0, 0, 3] } }
  const scan = { sessions: [s] }
  const engineZero = { session: { cost: 0 } }
  assert.equal(convFactory(scan, 'me', {}, {}, NOW, {}, { card: engineZero }).stats.cost, null) // drawn « — »
  assert.equal(convFactory(scan, 'me', {}, {}, NOW, {}, { card: engineZero, rowCost: 3.2 }).stats.cost, 3.2)
  assert.equal(convFactory(scan, 'me', {}, {}, NOW, {}, { card: { session: { cost: 4.5 } } }).stats.cost, 4.5)
  const priced = convFactory(scan, 'me', PFCFG, {}, NOW, {}, { card: engineZero }).stats.cost
  assert.ok(Math.abs(priced - (200000 * 5 + 43000 * 25) / 1e6) < 1e-9, String(priced)) // the same rates as every other row
  assert.equal(convFactory({ sessions: [{ ...s, models: {} }] }, 'me', {}, {}, NOW, {}, { card: engineZero }).stats.cost, 0) // nothing spent
})

test('context: one effective window for every conversation (CLAUDE_CODE_AUTO_COMPACT_WINDOW), the same label', () => {
  const engine = { context: { window: 1000000, tokens: 82000, percent: 8.2 } }
  const here = contexteOf({ usage: engine, ctxTokens: 82000, fwin: 400000, auto: 400000 }, {})
  assert.equal(here.window, 400000)
  assert.equal(here.detail, '82K / 400K · relais 250K')
  assert.equal(Math.round(here.pct), 21) // 82 K of 400 K, not the engine's 8 % of 1 M
  assert.equal(effectiveWindow({}, 400000, 1000000, 200000), 400000)
  assert.equal(effectiveWindow({}, 0, 1000000, 400000), 1000000)
  assert.equal(effectiveWindow({}, 0, null, 400000), 400000)
  assert.equal(effectiveWindow({ panel: { contexte: { window: 300000 } } }, 400000, 1000000, 400000), 300000)
  // the other conversations under their rows: the same window and label
  const view = panneauView(75)
  const under = convFactories({ scan: PSCAN, runs: [], syn: view.panel.syn, graphe: null, self: 'lead', closed: { 'cv:d': false }, autoWindow: 500000, cardOf: (s) => usageCard(null, s, PFCFG, NOW) }, { context_window: 400000 }, {}, NOW)
  assert.equal(under.factories.d.ctx.window, 500000)
  assert.equal(under.factories.d.ctx.detail, '60K / 500K · relais 250K')
})

test('a conversation with no Workflow nor agent and little spent: two lines until « détails », then the full card', () => {
  const s = { cli: 'q', app_title: 'Quiet lane', live: false, model: 'claude-sonnet-5-5', app_effort: 'low', ctx: 12000, recent: [], models: { 'claude-sonnet-5-5': [3000, 300, 0, 0, 0, 1] } }
  const ctx = contexteOf({ ctxTokens: 12000, fwin: 400000 }, {})
  const m = convFactory({ sessions: [s] }, 'q', {}, {}, NOW, {}, { contexte: ctx, prefix: 'cv:q:' })
  assert.equal(m.compactable, true)
  assert.equal(m.compact, true)
  assert.equal(m.detailsKey, 'cv:q:pdetails')
  assert.equal(convFactory({ sessions: [s] }, 'q', {}, {}, NOW, { 'cv:q:pdetails': false }, { contexte: ctx, prefix: 'cv:q:' }).compact, false)
  assert.equal(convFactory({ sessions: [{ ...s, models: { 'claude-sonnet-5-5': [300000, 0, 0, 0, 0, 1] } }] }, 'q', {}, {}, NOW, {}, { contexte: ctx }).compactable, false) // a big one keeps its card
  assert.equal(convFactory(FSCAN, 'me', {}, {}, NOW).compactable, false) // a Workflow keeps its card
})

test('stats grid: fixed equal columns, every label over its value; « Ce qui contribue » on thin bars; ⚠ past the hand-off', () => {
  const text = panneauText(75, { closed: { pdetails: false } })
  const lines = text.split('\n')
  const i = lines.findIndex((l) => /Coût +Tokens +Cache hit/.test(l))
  assert.ok(i > 0, text)
  const starts = (l) => [...l.matchAll(/(?:^|\s{2,})(\S)/g)].map((x) => x.index + x[0].length - 1)
  for (const [a, b] of [[i, i + 1], [i + 2, i + 3]]) assert.deepEqual(starts(lines[a]), starts(lines[b]), lines[a] + '\n' + lines[b])
  assert.match(text, /fil principal +▰+▱* +\d+ %/)
  const data = { v: 1, generated: NOW, tzMin: 0, days: 31, sessions: { w: { t: 'Wave lane', p: 'proj-one' } }, rows: [R(0, 'w', 1000, 1)] }
  const big = { sessions: [{ ...STALL_SCAN(5).sessions[0], ctx: 300000 }] }
  assert.equal(synthesis(data, big, null, { period: 'today' }, {}, NOW).rows[0].over, true)
  assert.equal(synthesis(data, STALL_SCAN(5), null, { period: 'today' }, {}, NOW).rows[0].over, false)
})

// ---- what runs right now (Julian, 21 Oct: « I don't see what is running right now, which agent, which workflow; more
// indentation, bullets ») ------------------------------------------------------------------------------------------------

// a conversation running one Workflow without named phases: `n` running agents and one done
const MANY = (n) => ({ sessions: [{ cli: 'm', app_title: 'Many lane', live: true, model: 'claude-opus-5-5', app_effort: 'medium', ctx: 90000, recent: [], models: { 'claude-opus-5-5': [1000, 0, 0, 0, 0, 1] },
  subs: [...Array.from({ length: n }, (_, i) => ({ id: 'r' + i, type: 'coder', desc: 'p' + i, workflow: 'wf_m', model: 'claude-opus-5-5', status: 'running', ts: new Date(NOW - (10 + i) * 60000).toISOString(), last_ts: new Date(NOW).toISOString(), models: { 'claude-opus-5-5': [500, 0, 0, 0, 0, 1] } })),
    { id: 'dn', type: 'verify', desc: 'old check', workflow: 'wf_m', model: 'claude-sonnet-5-5', status: 'done', ts: new Date(NOW - 50 * 60000).toISOString(), last_ts: new Date(NOW - 40 * 60000).toISOString(), models: {} }] }] })

test('running agents are always listed under their Workflow / phase without unfolding, up to running_max then « +N »', () => {
  // the fixture: package-wave folded shows its running phase « ▸ Wave B 0/1 » and its running agent, not the done ones
  const t = panneauText(75)
  const conv = t.slice(t.indexOf('CETTE CONVERSATION'), t.indexOf('CONVERSATIONS ·'))
  assert.match(conv, /◇ \[package-wave\] workflow \[›\]\n[^\n]*2\/4[^\n]*\n[^\n]*└──── ▸ Wave B phase 0\/1\n[^\n]*└──── • coder: cockpit-claude-style opus · 20 min · 1\.5M\n/)
  assert.doesNotMatch(conv, /Wave A|verify sonnet|explore-fast: map/)
  // 11 running agents: 8 lines then « +3 agents en cours », the done one folded; panel.conv.running_max sets it
  const view = panneauView(75)
  const draw = (cfg) => renderText(drawCockpit(el, { ...view, ...(cfg ? { cfg } : {}), panel: { ...view.panel, factory: convFactory(MANY(11), 'm', {}, cfg || {}, NOW, {}, {}) } }), 75).replace(/\u00a0/g, ' ')
  const a = draw()
  const lines = a.split('\n').filter((l) => /[├└]──── • coder · p\d+/.test(l))
  assert.equal(lines.length, 8, a)
  assert.match(a, /└──── \+3 agents en cours\n/)
  assert.doesNotMatch(a, /old check/)
  assert.match(lines[0], /• coder · p0 opus · 10 min · 500$/) // the newest first, model · time · tokens at the right
  assert.equal(draw({ panel: { conv: { running_max: 3 } } }).split('\n').filter((l) => /• coder · p\d+/.test(l)).length, 3)
  // unfolded, every agent of it
  const open = renderText(drawCockpit(el, { ...view, panel: { ...view.panel, factory: convFactory(MANY(3), 'm', {}, {}, NOW, { 'pfw-wf_m': false }, {}) } }), 75)
  assert.match(open, /• verify · old check/)
})

test('a background agent (Agent tool outside a Workflow) is a ◦ line under its conversation, counted; « Agents 0/1 » never with nothing listed', () => {
  const t = panneauText(75, { busy: true, closed: { pdetails: false } })
  const conv = t.slice(t.indexOf('CETTE CONVERSATION'), t.indexOf('CONVERSATIONS ·'))
  assert.match(conv, /\n {6}├──── ◦ coder · p44-migration opus · 1 h 10 · 918K\n/)
  assert.match(conv, /Agents +tok\/s\n[^\n]*2\/4 /) // two running: the Workflow's coder and the background one
  assert.match(conv, /1 wf · 2 agents en cours/)
  // the scan's running agent outside a Workflow, whatever its phase: listed under its conversation
  const one = { sessions: [{ cli: 'x', app_title: 'Solo', live: false, model: 'claude-opus-5-5', recent: [], models: {}, subs: [{ id: 'f1', type: 'tester', desc: 'run tests', model: 'claude-sonnet-5-5', status: 'running', ts: new Date(NOW - 5 * 60000).toISOString(), last_ts: new Date(NOW - 4 * 60000).toISOString(), models: {} }] }] }
  const m = convFactory(one, 'x', {}, {}, NOW, {}, {})
  assert.deepEqual([m.stats.running, m.stats.agents, m.live.agents, m.lead.stateId], [1, 1, 1, 'working'])
  const view = panneauView(75)
  const text = renderText(drawCockpit(el, { ...view, panel: { ...view.panel, factory: m } }), 75)
  assert.match(text, /◦ tester · run tests sonnet · 5 min/)
})

test('EN COURS › « En ce moment »: every running agent, its path, model and time, longest first; nothing runs: the last one finished', () => {
  const view = panneauView(75, { busy: true })
  const n = runningNow({ factory: view.panel.factory, factories: view.panel.convFactories, self: 'lead' }, {})
  assert.deepEqual(n.list.map((x) => [x.kind, x.label, x.model, x.path.join(' › ')]), [
    ['background', 'coder · p44-migration', 'opus', 'Lane alpha · tableau de bord'],
    ['agent', 'coder: cockpit-claude-style', 'opus', 'Lane alpha · tableau de bord › package-wave › Wave B'],
    ['agent', 'coder · write the docs', 'sonnet', 'Lane delta › wf_2'],
    ['main', 'fil principal', 'opus', 'Package four'],
  ])
  const toggled = []
  view.panel.act = { ...view.panel.act, ptoggle: (id) => toggled.push(id) }
  find(drawCockpit(el, view), 'pec-more').props.onPress()
  assert.deepEqual(toggled, ['encours'])
  for (const cols of [45, 75]) {
    const t = panneauText(cols, { busy: true, open: { conv: true, convs: true, encours: true } })
    assert.match(t, /\nEN COURS {2}\[3 conv\][^\n]*\[voir ⌄\]\n {2}En ce moment \(4\)\n {2}◦ coder · p44-migration opus · 1 h 10\n {4}Lane alpha · tableau de bord\n {2}• coder: cockpit-cla[^\n]* opus · 20 min\n {4}Lane alpha[^\n]* › package-wave › Wave B\n/, t)
    for (const l of t.split('\n')) assert.ok([...l].length <= cols, `${cols}: ${l}`)
  }
  // folded by default
  assert.doesNotMatch(panneauText(75, { busy: true }), /En ce moment/)
  // nothing runs: « rien ne tourne · dernier fini il y a 40 min (verify · old check) »
  const idle = { sessions: [{ cli: 'q', app_title: 'Quiet', live: false, model: 'claude-opus-5-5', recent: [], models: {}, subs: [{ id: 'dn', type: 'verify', desc: 'old check', model: 'claude-sonnet-5-5', status: 'done', ts: new Date(NOW - 50 * 60000).toISOString(), last_ts: new Date(NOW - 40 * 60000).toISOString(), models: {} }] }] }
  const qf = convFactory(idle, 'q', {}, {}, NOW, {}, {})
  const P = view.panel
  const text = renderText(drawCockpit(el, { ...view, panel: { ...P, factory: qf, syn: { ...P.syn, rows: [] }, synAll: null, convFactories: {}, self: 'q' } }), 75)
  assert.match(text, /\nEN COURS {2}rien ne tourne · dernier fini il y a 40 min \(verify · old check\)\n/)
})
