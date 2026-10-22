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

test('defaults: the list then four folded lines, Fichiers last, Claude only, top 15, hand-off at 250 k; the shipped config agrees', () => {
  const c = panelConfig({})
  assert.deepEqual(c.order, ['convs', 'barres', 'debit', 'graphe', 'fichiers'])
  // since 22 Oct: ONE list unfolded, Quotas, Débit, Graphe and Fichiers one folded line each
  assert.deepEqual(c.open, ['convs'])
  assert.equal(c.convs.unfold_max, 0) // nothing unfolds by itself
  assert.equal(c.style.ctx_warn_pct, 62.5)
  assert.equal(c.contexte.handoff_tokens, 250000)
  // an order written with « contexte » (now in the lead's card) gets « barres » back after « convs »; « conv » is gone
  assert.deepEqual(panelConfig({ panel: { order: ['convs', 'conv', 'contexte', 'graphe', 'fichiers'] } }).order, c.order)
  assert.equal(c.convs.who, 'claude')
  assert.equal(c.convs.top, 15)
  assert.equal(c.fichiers.attach_selection, true)
  assert.deepEqual(panelConfig({ panel: { order: ['graphe', 'nope', 'conv'] } }).order, ['graphe'])
  // an order written before Débit gets it right after « barres » (Julian, 18 Oct)
  assert.deepEqual(panelConfig({ panel: { order: ['convs', 'barres', 'graphe', 'fichiers'] } }).order, c.order)
  assert.equal(panelConfig({ panel: { labels: { panneau: 'Vue' } } }).labels.panneau, 'Vue') // labels configurable
  // cockpit.config.json ships the same: the list open, the period 24 h (PR #75's default, « aujourd’hui » hid most)
  const shipped = panelConfig(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'cockpit.config.json'), 'utf8')))
  assert.deepEqual([shipped.order, shipped.open, shipped.convs.period], [c.order, ['convs'], '24h'])
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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { widest, el, renderText } from '../lib/factory/scanner/textrender.mjs'
import { panneauText, panneauView, SCAN as PSCAN, FCFG as PFCFG, CLASSEMENT } from '../scripts/fixtures/panneau.mjs'
import { drawCockpit } from '../hooks/view.mjs'

const PREVIEW = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'preview.mjs')
const q = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// box-drawing borders and connectors (Julian, 17 Oct: they look weird and eat the width); since 18 Oct a thin « │ » rule
// runs down an unfolded detail and since 19 Oct the Workflows hang under their conversation with ├ / └: both allowed
const BOX = /[╭╮╰╯┬┴┼┃┄█░]/
const find = (n, key) => { if (!n || typeof n !== 'object') return null; if (n.props && n.props.key === key) return n; for (const c of (n.props && n.props.children) || []) { const f = find(c, key); if (f) return f } return null }
const texts = (n, out = []) => { if (!n || typeof n !== 'object') return out; if (n.type === 'Text') out.push(n); for (const c of (n.props && n.props.children) || []) texts(c, out); return out }

// ---- the Panneau since 22 Oct: banners, ONE list, folded extras (Julian, 01:17-01:25: « a lot going on, it's not clear;
// way better UI/UX: visibility, indentation, bullets, agents, sub-agents, workflows, progress bars ») -----------------
for (const columns of [45, 60, 75]) {
  test(`preview --panneau at ${columns} columns: banners, one list, the folded lines at the bottom; no tab bar, nothing wider than the pane`, () => {
    const text = execFileSync(process.execPath, [PREVIEW, '--panneau', '--cols', String(columns), '--detail', 'compact'], { encoding: 'utf8' })
    const body = text.split('\n').slice(1).join('\n').trimEnd()
    assert.ok(widest(body) <= columns, `${widest(body)} columns\n${body}`)
    assert.doesNotMatch(body, /\[Panneau\]|\[Plus ▾|\[Moins ▴|\[Mission\]|\[Cockpit\]|\[Journal\]|\[Jauge\]|\[Registres\]/)
    assert.doesNotMatch(body, BOX, body)
    // gone from the default view: CETTE CONVERSATION, the project group headers, the Gantt, the « Autres vues » footer,
    // EN COURS's header, the tree connectors, any card or table
    assert.doesNotMatch(body, /CETTE CONVERSATION|EN COURS|\nproj-one · \d|\nproj-two · \d|Aujourd’hui|Autres vues|[├└]|Cache hit|Ce qui contribue|Modèle Temps|Phases|Session 5 h/, body)
    // 1. the banners: green « ● 2 conversations travaillent · … », amber « ◆ 1 t’attend : Lane beta · reason »
    assert.match(body, /^ ● \[2 conv(?:ersations travaillent|\.)\] · \[2 (?:wf|workflows)\] · \[2 (?:agents|ag\.)\][^\n]*\[voir ›\]\n ◆ 1 t’attend : \[Lane beta\] · Choisir la/, body)
    // 2. ONE list, children under their parent behind the grey rule, this conversation « (ici) » at 60 columns and more
    const at = ['CONVERSATIONS [filtres ›]', '● [Lane alpha · tableau de bord]', '│  ◇ [package-wave] · workflow', '│  │  ● coder: cockpit-cl', '│  ○ [Package two]', '│  │  ○ [Package two · verify] au repos 9 h',
      '● [Lane delta]', '│  ◇ [wf_2] · workflow', '│  │  ● coder · write the d', '○ [PM BETA]', '│  ◆ [Lane beta] t’attend', '○ [+ 1 au repos ›]',
      '─ [Quotas] · 5 h 21 % · sem 85 %', '─ [Débit] · opus 56', '─ [Graphe] · 7 conv · 3 coord', '─ [Fichiers] · proj-one · main']
    const idx = at.map((k) => body.indexOf('\n' + k))
    assert.ok(idx.every((i) => i >= 0), at.filter((k, i) => idx[i] < 0).join(' | ') + '\n' + body)
    assert.deepEqual([...idx].sort((a, b) => a - b), idx, body)
    if (columns >= 60) assert.match(body, /\n● \[Lane alpha · tableau de bord\] coord \(ici\) (?:Terminés 1 )?[▰▱]{5} 30 %\n/, body)
    // Julian's narrow pane (22 Oct): one line per conversation, no line with the rule alone, no project header line, the
    // project a short grey suffix, the conversations at rest folded into « + N au repos › »
    assert.doesNotMatch(body, /\n│ *\n|\nproj-(?:one|two)\n/, body)
    assert.match(body, /\n○ \[PM BETA\] coord proj-two au repos 40 min\n/, body)
    assert.doesNotMatch(body, /Lane gamma/, body)
    // the progress of a Workflow: its bar and done/total; a working conversation: its context bar and %
    assert.match(body, /\n│  ◇ \[package-wave\] · workflow [▰▱]{5} 2\/4\n/)
    assert.match(body, /\n● \[Lane delta\] proj-one [▰▱]{5} 15 %\n/)
    // 3. one folded line each, in that order, at the very bottom
    assert.match(body, /\n\n─ \[Quotas\][^\n]*\[›\]\n─ \[Débit\][^\n]*\[›\]\n─ \[Graphe\][^\n]*\[›\]\n─ \[Fichiers\][^\n]*\[›\]$/, body)
  })
}

test('one list: one row per conversation, never twice; nested levels step by panel.list.indent columns', () => {
  const all = panneauText(75, { detail: 'compact', detail: 'compact' })
  const t = all.slice(all.indexOf('CONVERSATIONS'))
  for (const k of ['[Lane alpha', '[Lane delta]', '[PM BETA]', '[Lane beta]', '[Package two]', '[wf_2]', '[package-wave]']) assert.equal(t.split('\n').filter((l) => l.includes(k)).length, 1, k + '\n' + t)
  const col = (re) => { const l = t.split('\n').find((x) => re.test(x)); return l ? l.search(/[●○◆◇◦✓✕]/) : -1 }
  assert.deepEqual([col(/\[Lane alpha/), col(/\[package-wave\]/), col(/coder: cockpit/), col(/\[Package two\]/), col(/\[Package two · verify\]/)], [0, 3, 6, 3, 6])
  const t4 = panneauText(75, { detail: 'compact', indent: 4 })
  assert.match(t4, /\n│   ◇ \[package-wave\] · workflow[^\n]*\n│   │   ● coder: cockpit/, t4)
  assert.deepEqual(panelConfig({}).list, { indent: 3, rule: '│', rest_shown: 0, project_max: 14, bar_cells: 5, bar_color: 'suggestion', chip_bg: 'subtle', chip_fg: 'inverseText' })
})

test('details only on a click of the row title: this conversation’s card and journal, another’s « ouvrir ↗ », a Workflow’s tokens and Gantt', () => {
  const plain = panneauText(75, { detail: 'compact', detail: 'compact' })
  assert.doesNotMatch(plain, /Cache hit|Contexte \d|journal \(|ouvrir ↗|tokens/)
  const self = panneauText(75, { detail: 'compact', closed: { pdetails: false } })
  for (const k of ['Contexte 120K / 400K · relais 250K 30 %', 'Coût', 'Cache hit', 'Sous-agents', 'Modèles : Opus 100 %', 'Ce qui contribue', '[journal (6) ›]']) assert.ok(self.includes(k), k + '\n' + self)
  assert.match(self, /\n● \[Lane alpha · tableau de bord\] coord \(ici\) [^\n]*\n│  Contexte 120K/, self)
  assert.doesNotMatch(self, /Opus 5\.5 · medium|ouvrir ↗/) // no duplicate model line; this one is open already
  const log = panneauText(75, { detail: 'compact', closed: { pdetails: false, pjournal: false } })
  for (const k of ['[journal (6) ⌄]', 'PR #42 ouverte', 'PR #41 mergée']) assert.ok(log.includes(k), k + '\n' + log)
  const d = panneauText(75, { detail: 'compact', closed: { 'cv:d:pdetails': false } })
  assert.match(d, /\n● \[Lane delta\] [^\n]*\n│  \[ouvrir ↗\]\n│  Contexte 60K[^\n]*\n(?:│[^\n]*\n)+│  ◇ \[wf_2\] · workflow/, d)
  assert.match(panneauText(75, { detail: 'compact', open: { convs: true, convs_rest: true }, closed: { 'cv:c:pdetails': false } }), /\n○ \[Lane gamma\] proj-three au repos 30 h\n│  \[ouvrir ↗\]\n│  fabrique non lue/)
  // no line with the rule « │ » alone inside the details (the stats grid's blank line is gone in the tree)
  assert.doesNotMatch(self, /\n│ *\n/, self)
  const wf = panneauText(75, { detail: 'compact', closed: { 'pfw-wf_1': false } })
  assert.match(wf, /\n│  ◇ \[package-wave\] · workflow [^\n]*\n│  │  4 agents  2\.0M tokens  \$9\.40  40m 00s  fin vers \d\d:\d\d\n/, wf)
})

test('the folded lines unfold: Quotas to the Usage-like bars, Débit to its tables, Graphe to its diagram, Fichiers to the tree and the other views', () => {
  const q = panneauText(75, { open: { convs: true, barres: true } })
  for (const k of ['Session 5 h reset dans 2 h 10 21 %', 'Crédits cloud montant non lu 12 %', 'tok/s toutes conv 852 tok/s']) assert.ok(q.includes(k), k + '\n' + q)
  assert.match(q, /\n─ \[Quotas\][^\n]*\[⌄\]\n {2}Session 5 h/)
  assert.doesNotMatch(q, /Codex semaine/)
  assert.match(panneauText(75, { who: 'codex', open: { convs: true, barres: true } }), /Codex semaine/)
  const f = panneauText(75, { open: { convs: true, fichiers: true } })
  assert.match(f, /\n─ \[Fichiers\][^\n]*\[⌄\]\n {2}proj-one · main \[↻\]\n {2}\[▾ src\] M\n/, f)
  assert.match(f, /\n {2}Autres vues : \/cockpit cartes · mission/, f)
  // the filters behind « filtres › »
  const fl = panneauText(75, { open: { convs: true, convs_filters: true } })
  assert.match(fl, /CONVERSATIONS \[filtres ⌄\]\n {2}\[aujourd’hui ▾\] \[Projet ▾\] \[État ▾\] \[Claude ▾\]\n {2}Total aujourd’hui/)
  assert.match(panneauText(45, { open: { convs: true, convs_filters: true } }), /\n {2}\[auj\. ▾\] \[Projet ▾\] \[État ▾\] \[Claude ▾\]\n/)
})

test('banners: tinted rows (green while something runs or nothing does, amber while someone waits); idle « ✓ Rien ne tourne · dernier fini il y a N min »', () => {
  const tree = drawCockpit(el, panneauView(75))
  assert.equal(find(tree, 'p-encours-b').props.backgroundColor, 'diffAddedDimmed')
  assert.equal(find(tree, 'p-click').props.backgroundColor, 'warning')
  assert.equal(find(find(tree, 'p-click'), 'pgw-b').props.children[0].props.color, 'inverseText')
  const idle = drawCockpit(el, panneauView(75, { scene: 'idle' }))
  assert.equal(find(idle, 'p-encours').props.backgroundColor, 'diffAddedDimmed')
  assert.match(panneauText(75, { scene: 'idle' }), /^ ✓ Rien ne tourne · dernier fini il y a 12 min \(wf_2\)\n ◆ 1 t’attend/)
  // nobody waits: no amber banner
  const v = panneauView(75)
  v.panel.graphe = { ...v.panel.graphe, waiting: [] }
  assert.equal(find(drawCockpit(el, v), 'p-click'), null)
  // panel.banners sets the tints
  const own = panneauView(75)
  own.cfg = { panel: { banners: { ok_bg: '#123456', warn_bg: '', warn_fg: '' } } }
  const t2 = drawCockpit(el, own)
  assert.equal(find(t2, 'p-encours-b').props.backgroundColor, '#123456')
  assert.equal(find(t2, 'p-click').props.backgroundColor, undefined)
})

test('colours: one state colour per row, numbers bold only when alarming (ctx at 62.5 % amber, past the hand-off red ⚠)', () => {
  const view = panneauView(75, { detail: 'compact', detail: 'compact' })
  const pick = (tree, k) => texts(find(tree, k)).map((t) => [String(t.props.children[0]), Boolean(t.props.bold), t.props.color])
  const lead = pick(drawCockpit(el, view), 'pc-lead')
  assert.deepEqual(lead.find((x) => x[0] === '30 %'), ['30 %', false, undefined]) // 30 %: grey, not bold
  // a conversation at 67 % of a 300 K window (amber, bold) and one past the 250 K hand-off (red, bold, ⚠)
  const rows = view.panel.convList.rows
  const base = rows.find((r) => r.id === 'd')
  const list = { ...view.panel.convList, groups: [{ name: 'p', count: 2, working: 2, roots: [{ row: { ...base, id: 'w', ctx: 200000 }, kids: [] }, { row: { ...base, id: 'x', ctx: 270000 }, kids: [] }] }] }
  const tree = drawCockpit(el, { ...view, panel: { ...view.panel, convList: list, ctxWindow: 300000 } })
  assert.deepEqual(pick(tree, 'pc-w').find((x) => x[0] === '67 %'), ['67 %', true, 'warning'])
  assert.ok(pick(tree, 'pc-x').some((x) => x[0] === '90 %' && x[1] && x[2] === 'error') && pick(tree, 'pc-x').some((x) => x[0] === '⚠'), JSON.stringify(pick(tree, 'pc-x')))
  // a stalled Workflow: amber ◇ and « à l’arrêt 1 h 10 » bold, its agent's ● green
  const stuck = convFactory(STALL_SCAN(70), 'w', {}, {}, NOW, {}, { runs: STALL_RUN(70) })
  const sv = { ...view, panel: { ...view.panel, factory: stuck, self: 'w', convList: { ...list, groups: [{ name: 'p', count: 1, working: 1, roots: [{ row: { ...base, id: 'w', label: 'Wave lane' }, kids: [] }] }] } } }
  const st = drawCockpit(el, sv)
  assert.match(renderText(st, 75).replace(/\u00a0/g, ' '), /\n│  ◇ \[Preview release\] · workflow [▰▱]{5} à l’arrêt 1 h 10\n│  │  ● coder opus · 1 h 20\n/)
  const first = (tr, k) => texts(find(tr, k))[0].props
  assert.deepEqual([first(st, 'plw-pfw-wf_s').children[0], first(st, 'plw-pfw-wf_s').color], ['◇', 'warning'])
  assert.deepEqual([first(st, 'pla-pfw-wf_s-w1').children[0], first(st, 'pla-pfw-wf_s-w1').color], ['●', 'success'])
  // at rest: grey ○ and grey title; waiting: amber ◆; working: green ●, bold
  const base2 = drawCockpit(el, { ...view, panel: { ...view.panel, open: { ...view.panel.open, convs_rest: true } } })
  assert.deepEqual([first(base2, 'plc-h-c').children[0], first(base2, 'plc-h-c').dimColor], ['○', true])
  assert.deepEqual([first(base2, 'plc-h-b').children[0], first(base2, 'plc-h-b').color], ['◆', 'warning'])
  assert.deepEqual([first(base2, 'plc-h-d').children[0], first(base2, 'plc-h-d').color], ['●', 'success'])
  assert.equal(find(base2, 'pcv-d').props.children[0].props.bold, true)
  assert.equal(find(base2, 'pcv-c').props.children[0].props.dimColor, true)
})

test('every row toggles its own key: a title its details, a Workflow its card, the banners open or filter, the folds', () => {
  const tree = drawCockpit(el, panneauView(75))
  const head = find(tree, 'p-sec-barres')
  assert.equal(head.type, 'Button')
  assert.equal(head.props.label, 'Quotas')
  assert.equal(head.props.plain, true)
  assert.equal(head.props.children[0].props.bold, true)
  assert.equal(find(tree, 'p-sec-convs').props.bold, true)
  const toggled = []
  const opened = []
  const filtered = []
  const view = panneauView(75)
  view.panel.act = { ...view.panel.act, ptoggle: (id) => toggled.push(id), nodeToggle: (k, o) => toggled.push([k, o]), openConv: (l) => opened.push(l), pfilter: (k, v) => filtered.push([k, v]) }
  const t2 = drawCockpit(el, view)
  for (const k of ['p-sec-barres', 'p-sec-debit-x', 'p-sec-graphe', 'p-sec-fichiers', 'pcv-d', 'pcv-lead', 'pk-pfw-wf_1-t', 'pgw-b', 'pec-more', 'pec-wf', 'pec-conv']) find(t2, k).props.onPress()
  assert.deepEqual(toggled, ['barres', 'debit', 'graphe', 'fichiers', ['cv:d:pdetails', false], ['pdetails', false], ['pfw-wf_1', false], 'encours', 'encours'])
  assert.deepEqual(opened, ['claude://claude.ai/epitaxy/local_b'])
  assert.deepEqual(filtered, [['state', 'running']])
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
  assert.match(renderText(drawCockpit(el, view), 75), /^ ● \[2 conversations travaillent\] · \[2 wf\] · \[2 agents\] · 0 CI \[voir ›\]\n/)
  // the rows shown only (no synAll): its factory, built for an active conversation of the scan, still counts it
  assert.deepEqual(enCours({ syn: P.syn, factory: P.factory, factories: P.convFactories, self: 'lead' }).workflows, 2)
})

test('EN COURS: conversations, Workflows, running agents by model, blocked ones, counted from the fixtures', () => {
  const view = panneauView(75)
  const P = view.panel
  const n0 = enCours({ syn: P.syn, factory: P.factory, factories: P.convFactories, self: 'lead' })
  assert.deepEqual({ ...n0, eta: Boolean(n0.eta) },
    { convs: 2, main: 1, workflows: 2, agents: 2, subagents: 0, fams: [['opus', 1], ['sonnet', 1]], blocked: 0, stalledWf: 0, stalledSub: 0, failed: 0, eta: true })
  // a blocked row, a stalled Workflow: blocked, not running; a row that only works: one conversation
  const stuck = convFactory(STALL_SCAN(70), 'w', {}, {}, NOW, {}, { runs: STALL_RUN(70) })
  const syn = { rows: [{ id: 'x', mark: 'blocked' }, { id: 'y', mark: 'working' }, { id: 'w', mark: 'working' }, { id: 'z', mark: 'done' }] }
  const n1 = enCours({ syn, factory: null, factories: { w: stuck }, self: 'me' })
  assert.deepEqual([n1.convs, n1.workflows, n1.agents, n1.subagents, n1.blocked, n1.stalledWf], [1, 1, 1, 0, 2, 1])
  assert.deepEqual(enCours({}), { convs: 0, main: 0, workflows: 0, agents: 0, subagents: 0, fams: [], blocked: 0, stalledWf: 0, stalledSub: 0, failed: 0, eta: '' })
  // one green banner line, every count shown, a zero in grey (Julian, 21 Oct: « 0 workflow, 0 agent, 0 CI »); short of
  // room the words get short: a number is never cut
  assert.match(panneauText(75), /^ ● \[2 conversations travaillent\] · \[2 wf\] · \[2 agents\] · 0 CI \[voir ›\]\n/)
  assert.match(panneauText(60), /^ ● \[2 conv\.\] · \[2 workflows\] · \[2 agents\] · 0 CI \[voir ›\]\n/)
  assert.match(panneauText(45), /^ ● \[2 conv\.\] · \[2 wf\] · \[2 ag\.\] [^\n]*\[voir ›\]\n/)
  for (const cols of [45, 60, 75]) for (const l of panneauText(cols, { busy: true }).split('\n').slice(0, 2)) assert.ok([...l].length <= cols, `${cols}: ${l}`)
  const blockedSyn = { ...P.syn, rows: [...P.syn.rows.slice(0, 1).map((r) => ({ ...r, mark: 'blocked' })), ...P.syn.rows.slice(1)] }
  const t = renderText(drawCockpit(el, { ...view, panel: { ...P, syn: blockedSyn, synAll: blockedSyn } }), 75)
  assert.match(t, /^ ● \[1 conv\.\] · \[2 workflows\] · \[2 agents\] · 0 CI · \[1 bloquée\] \[voir ›\]\n/)
  const idle = renderText(drawCockpit(el, { ...view, panel: { ...P, factory: null, syn: { ...P.syn, rows: [] }, synAll: null, convFactories: {} } }), 75)
  assert.match(idle, /^ ✓ Rien ne tourne\n/)
  // the numbers filter CONVERSATIONS: en cours, t'attend
  const filtered = []
  const v2 = panneauView(75)
  v2.panel.act = { ...v2.panel.act, pfilter: (k, x) => filtered.push([k, x]) }
  find(drawCockpit(el, v2), 'pec-conv').props.onPress()
  assert.deepEqual(filtered, [['state', 'running']])
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

test('running agents are always listed under their Workflow, up to running_max then « +N agents en cours »; the done ones never', () => {
  // the fixture: package-wave shows its running agent only, not the done ones
  const t = panneauText(75, { detail: 'compact', detail: 'compact' })
  assert.match(t, /\n│  ◇ \[package-wave\] · workflow [▰▱]{5} 2\/4\n│  │  ● coder: cockpit-claude-style opus · 20 min\n│  ○ \[Package two\]/, t)
  assert.doesNotMatch(t, /Wave A|verify sonnet|explore-fast: map/)
  // 11 running agents: 8 lines then « +3 agents en cours », the done one left out; panel.conv.running_max sets it
  const view = panneauView(75, { detail: 'compact', detail: 'compact' })
  const row = { id: 'm', label: 'Many lane', cat: 'working', mark: 'working', project: 'p', ctx: 90000, last: NOW }
  const draw = (cfg, closed = {}) => renderText(drawCockpit(el, { ...view, ...(cfg ? { cfg } : {}), panel: { ...view.panel, self: 'm', factory: convFactory(MANY(11), 'm', {}, cfg || {}, NOW, closed, {}),
    convList: { ...view.panel.convList, groups: [{ name: 'p', count: 1, working: 1, roots: [{ row, kids: [] }] }] } } }), 75).replace(/ /g, ' ')
  const a = draw()
  const lines = a.split('\n').filter((l) => /^│  │  ● coder · p\d+/.test(l))
  assert.equal(lines.length, 8, a)
  assert.match(a, /\n│  │  \+3 agents en cours\n/)
  assert.doesNotMatch(a, /old check/)
  assert.match(lines[0], /● coder · p0 opus · 10 min$/) // the newest first, model · time at the right
  assert.equal(draw({ panel: { conv: { running_max: 3 } } }).split('\n').filter((l) => /● coder · p\d+/.test(l)).length, 3)
})

test('a background agent (Agent tool outside a Workflow) is a ◦ line right under its conversation, counted in the banner', () => {
  const t = panneauText(75, { detail: 'compact', busy: true })
  assert.match(t, /\n│  ◦ coder · p44-migration opus · 1 h 10\n/, t)
  assert.match(t, /^ ● \[3 conversations travaillent\] · \[2 wf\] · \[3 agents\] · \[1 CI\] \[voir ›\]\n/, t) // the Workflows' 2 and the background one
  // the scan's running agent outside a Workflow, whatever its phase: listed under its conversation
  const one = { sessions: [{ cli: 'x', app_title: 'Solo', live: false, model: 'claude-opus-5-5', recent: [], models: {}, subs: [{ id: 'f1', type: 'tester', desc: 'run tests', model: 'claude-sonnet-5-5', status: 'running', ts: new Date(NOW - 5 * 60000).toISOString(), last_ts: new Date(NOW - 4 * 60000).toISOString(), models: {} }] }] }
  const m = convFactory(one, 'x', {}, {}, NOW, {}, {})
  assert.deepEqual([m.stats.running, m.stats.agents, m.live.agents, m.lead.stateId], [1, 1, 1, 'working'])
  const view = panneauView(75, { detail: 'compact', detail: 'compact' })
  const text = renderText(drawCockpit(el, { ...view, panel: { ...view.panel, factory: m, self: 'x' } }), 75).replace(/ /g, ' ')
  assert.match(text, /\n● \[Solo\] \(ici\)[^\n]*\n│  ◦ tester · run tests sonnet · 5 min\n/, text)
})

test('EN COURS › « En ce moment »: every running agent, its path, model and time, longest first; nothing runs: the last one finished', () => {
  const view = panneauView(75, { busy: true })
  const n = runningNow({ factory: view.panel.factory, factories: view.panel.convFactories, self: 'lead' }, {})
  assert.deepEqual(n.list.map((x) => [x.kind, x.label, x.model, x.path.join(' › ')]), [
    ['background', 'coder · p44-migration', 'opus', 'Lane alpha · tableau de bord'],
    ['agent', 'coder: cockpit-claude-style', 'opus', 'Lane alpha · tableau de bord › package-wave › Wave B'],
    ['agent', 'coder · write the docs', 'sonnet', 'Lane delta › wf_2'],
    // the main threads at work: this conversation's (a tool call pending) and Package four's; Lane delta ended its turn
    ['main', 'fil principal', 'opus', 'Lane alpha · tableau de bord'],
    ['main', 'fil principal', 'opus', 'Package four'],
  ])
  const toggled = []
  view.panel.act = { ...view.panel.act, ptoggle: (id) => toggled.push(id) }
  find(drawCockpit(el, view), 'pec-more').props.onPress()
  assert.deepEqual(toggled, ['encours'])
  // a non-zero count opens « En ce moment » too
  find(drawCockpit(el, view), 'pec-ci').props.onPress()
  assert.deepEqual(toggled, ['encours', 'encours'])
  for (const cols of [45, 75]) {
    const t = panneauText(cols, { busy: true, open: { conv: true, convs: true, encours: true } })
    assert.match(t, /^ ● \[3 conv[^\n]*\[voir ⌄\]\n {2}En ce moment \(6\)\n {2}◦ coder · p44-migration opus · 1 h 10\n {4}Lane alpha · tableau de bord\n {2}● coder: cockpit-cla[^\n]* opus · 20 min\n {4}Lane alpha[^\n]* › package-wave › Wave B\n/, t)
    // the running pipeline: repo · branch, its running job, its time
    assert.match(t, /\n {2}◆ proj-one · claude\/panel tests · 6 min\n/, t)
    for (const l of t.split('\n')) assert.ok([...l].length <= cols, `${cols}: ${l}`)
  }
  // folded by default
  assert.doesNotMatch(panneauText(75, { busy: true }), /En ce moment/)
  // nothing runs: « ✓ Rien ne tourne · tout est au repos · dernier fini il y a 40 min (verify · old check) »
  const idle = { sessions: [{ cli: 'q', app_title: 'Quiet', live: false, model: 'claude-opus-5-5', recent: [], models: {}, subs: [{ id: 'dn', type: 'verify', desc: 'old check', model: 'claude-sonnet-5-5', status: 'done', ts: new Date(NOW - 50 * 60000).toISOString(), last_ts: new Date(NOW - 40 * 60000).toISOString(), models: {} }] }] }
  const qf = convFactory(idle, 'q', {}, {}, NOW, {}, {})
  const P = view.panel
  const quietCi = { ...P.ci, list: [], running: 0, failed: 0 }
  const text = renderText(drawCockpit(el, { ...view, columns: 90, panel: { ...P, ci: quietCi, factory: qf, syn: { ...P.syn, rows: [] }, synAll: null, convFactories: {}, self: 'q' } }), 90)
  assert.match(text, /^ ✓ Rien ne tourne · dernier fini il y a 40 min \(verify · old check\)\n ◆ /)
})

test('EN COURS: a main thread with a turn in progress counts, with nothing else running (Julian, 21 Oct 17:36)', () => {
  // « 1 conv · 0 wf · 0 ag. » while a turn ran for 28 s: now said in words, every zero shown
  const t = panneauText(75, { scene: 'main' })
  assert.match(t, /^ ● \[1 conversation travaille\] · 0 workflow · 0 agent · 0 CI \[voir ›\]\n/, t)
  const view = panneauView(75, { scene: 'main' })
  const n = enCours({ syn: view.panel.synAll, factory: view.panel.factory, factories: view.panel.convFactories, self: 'lead' })
  assert.deepEqual([n.convs, n.main, n.workflows, n.agents, n.subagents], [1, 1, 0, 0, 0])
  assert.equal(view.panel.factory.lead.mainBusy, true)
  // the list says it: this conversation « fil principal » before its context bar, the others « au repos 12 min »
  assert.match(t, /\n● \[Lane alpha · tableau de bord\] coord \(ici\) fil principal [▰▱]{5} 30 %\n/, t)
  assert.match(t, /\n│  ○ \[Package four\] au repos 12 min\n/, t)
  // the same transcript 3 min later, or with its turn ended: the main thread is idle
  const late = convFactory({ sessions: [{ cli: 'x', mtime: (NOW - 180000) / 1000, stop: 'tool_use', live: true, recent: [], models: {} }] }, 'x', {}, {}, NOW, {}, {})
  const ended = convFactory({ sessions: [{ cli: 'x', mtime: (NOW - 20000) / 1000, stop: 'end_turn', live: true, recent: [], models: {} }] }, 'x', {}, {}, NOW, {}, {})
  assert.deepEqual([late.lead.mainBusy, ended.lead.mainBusy], [false, false])
})

test('EN COURS: everything at zero is one green line; a stale CI cache says « CI : non lu depuis N min », not 0', () => {
  const t = panneauText(75, { scene: 'idle' })
  assert.match(t, /^ ✓ Rien ne tourne · dernier fini il y a 12 min \(wf_2\)\n ◆ 1 t’attend/, t)
  assert.doesNotMatch(t.split('\n\n')[0], / 0 /)
  // the CI cache 40 min old: the green line stays, the CI is said unread in grey under it
  const stale = panneauText(75, { scene: 'idle', ci: 'stale' })
  assert.match(stale, /^ ✓ Rien ne tourne[^\n]*\n CI : non lu depuis 40 min\n/, stale)
  // with work running, the stale CI takes the place of « 0 CI »
  const busy = panneauText(90, { scene: 'main', ci: 'stale' })
  assert.match(busy, /^ ● \[1 conversation travaille\] · 0 wf · 0 agent · CI : non lu depuis 40 min \[voir ›\]\n/, busy)
  assert.doesNotMatch(busy.split('\n\n')[0], /0 CI/)
  // no cache at all: « CI : non lu »
  const none = panneauView(75, { scene: 'idle' })
  none.panel.ci = null
  assert.match(renderText(drawCockpit(el, none), 75), /^ ✓ Rien ne tourne[^\n]*\n CI : non lu\n/)
})

// ---- panel.detail (Julian, 22 Oct, a tall ~50-column pane: « cleaner, but there is space for more detail, it's too
// minimalist, but I prefer that style ») -------------------------------------------------------------------------------
import { detailOf } from '../lib/panel.mjs'
import { ciBranches, ciOfRow, todayOf } from '../lib/panel_list.mjs'
import { CI_CACHE } from '../scripts/fixtures/panneau.mjs'

test('panel.detail: normal by default, compact / full / anything else; the shipped config says normal', () => {
  assert.equal(detailOf({}), 'normal')
  assert.equal(detailOf({ panel: { detail: 'compact' } }), 'compact')
  assert.equal(detailOf({ panel: { detail: 'full' } }), 'full')
  assert.equal(detailOf({ panel: { detail: 'huge' } }), 'normal')
  const shipped = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'cockpit.config.json'), 'utf8'))
  assert.equal(detailOf(shipped), 'normal')
})

test('ciBranches: the newest run of each branch, by repo|branch and by branch (not main); todayOf counts conversations with tokens', () => {
  const m = ciBranches(CI_CACHE.idle)
  assert.equal(m['proj-one|claude/panel'], 'ok')
  assert.equal(m['claude/panel'], 'ok')
  assert.equal(m['proj-one|main'], 'ok')
  assert.equal(m.main, undefined)
  assert.equal(ciBranches(CI_CACHE.busy)['claude/panel'], 'running')
  assert.equal(ciOfRow(m, { project: 'proj-one', branch: 'claude/panel' }), 'ok')
  assert.equal(ciOfRow(m, { project: 'proj-one', branch: '' }), '')
  const failed = { apps: [{ app: 'x', runs: [{ status: 'success', branch: 'b', created: '2026-10-16T10:00:00Z' }, { status: 'failed', branch: 'b', created: '2026-10-16T11:00:00Z' }] }] }
  assert.equal(ciBranches(failed)['x|b'], 'bad')
  assert.deepEqual(todayOf({ hasData: true, rows: [{ id: 'a', tokens: 5 }, { id: 'b', tokens: 0 }], total: { tokens: 5, cost: 1.5 } }), { convs: 1, tokens: 5, cost: 1.5 })
  assert.equal(todayOf({ hasData: false }), null)
})

for (const columns of [45, 50, 60]) {
  test(`panel.detail normal at ${columns} columns: a second grey line per working / waiting row, Quotas two rows, « Aujourd’hui »; no field cut, nothing wider`, () => {
    for (const busy of [false, true]) {
      const t = panneauText(columns, { busy })
      for (const l of t.split('\n')) assert.ok([...l].length <= columns, `${columns}: ${l}\n${t}`)
      // this conversation: model·effort · tokens · since its start · its PR and its branch's CI (✓ passed, ● running);
      // short of room a field goes whole (the model first), never cut
      assert.match(t, busy ? /\n│ (?:opus·med · )?(?:\d+\.\d+M · )?2 h 10 · PR #120 ●\n/ : /\n│ (?:opus·med · )?(?:\d+\.\d+M · )?2 h 10 · PR #120 ✓\n/, t)
      // a waiting row: since when, then its question
      assert.match(t, /\n│ {4}2 h 00 · Choisir la version\n/, t)
      // a Workflow: its phase and its running agents
      assert.match(t, /\n│  ◇ \[package-wave\] (?:· Wave B )?[▰▱]{5} 2\/4 · 1 ag\.\n/, t)
      // a row at rest: one line
      assert.match(t, /\n│  │  ○ \[Package two · verify\][^\n]*au repos 9 h\n│  ✓ \[Package one/, t)
      // Quotas: two compact rows under the line, no chart; « Aujourd’hui » folded right after
      assert.match(t, /\n─ \[Quotas\][^\n]*\[›\]\n {2}5 h [▰▱]{5} 21 %[^\n]*\n {2}sem [▰▱]{5} 85 %[^\n]*\n─ \[Aujourd’hui\] · 5 conv\./, t)
      assert.doesNotMatch(t, /Session 5 h|Semaine reset/, t)
      for (const l of t.split('\n').filter((x) => /^ {2}(?:5 h|sem) /.test(x))) assert.doesNotMatch(l, /…/, l)
    }
  })
}

test('panel.detail normal: the projection of the week at 60 columns; « Aujourd’hui › » holds the Gantt, Graphe no longer; full unfolds Débit', () => {
  assert.match(panneauText(60), /\n {2}sem [▰▱]{5} 85 % · reset dim 20:30 · à ce rythme 95 %\n/)
  const day = panneauText(60, { open: { conv: true, convs: true, today: true } })
  assert.match(day, /\n─ \[Aujourd’hui\][^\n]*\[⌄\]\n {2}\[Aujourd’hui ⌄\]/, day)
  const g = panneauText(60, { open: { conv: true, convs: true, graphe: true } })
  assert.doesNotMatch(g.slice(g.indexOf('[Graphe]')), /\[Aujourd’hui ⌄\]/, g)
  // the charts stay behind Quotas' ›
  assert.match(panneauText(60, { open: { conv: true, convs: true, barres: true } }), /Session 5 h/)
  const full = panneauText(50, { detail: 'full' })
  assert.match(full, /\n─ \[Débit\][^\n]*\[⌄\]\n {2}Modèle : opus/, full)
  for (const l of full.split('\n')) assert.ok([...l].length <= 50, l)
  // compact: PR #77's look, no second line, no « Aujourd’hui »
  const compact = panneauText(50, { detail: 'compact' })
  assert.doesNotMatch(compact, /PR #120|Aujourd’hui|opus·med|1 ag\./, compact)
})
