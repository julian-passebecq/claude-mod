// node --test mods/cockpit/tests/cards.test.mjs   Summary cards, tabs, aliases, the cards scanner over lib/core.
// Invented fixtures only (temp folders), never real data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { el, renderText, widest } from '../lib/factory/scanner/textrender.mjs'
import { ciSummary, ciSentence, pipelinesLive, problemsToday, quotaText, cardsOf, pickTarget, encoursItems, workflowsLive, runnerBackends, hm } from '../lib/cards.mjs'
import { estimateOf, etaOf } from '../lib/core/estimate.mjs'
import { claudeWindows, codexWindows } from '../lib/core/usage.mjs'
import { parseArgs, aliasArgs, tabsOf, cockpitConfig } from '../hooks/nav.mjs'
import { drawCockpit } from '../hooks/view.mjs'
import { cardsData } from '../scanner/cards.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FCFG = JSON.parse(readFileSync(join(HERE, '..', 'lib', 'factory', 'factory.config.json'), 'utf8'))
const CCFG = JSON.parse(readFileSync(join(HERE, '..', 'cockpit.config.json'), 'utf8'))
const NOW = Date.parse('2026-10-16T16:00:00Z')
const H = 3600000
const iso = (ms) => new Date(ms).toISOString()

// ci pipelines cache: lane a (claude) running with a ci estimate, lane b (codex) running without one but 3 past
// successes, lane c newest run red (job lint), lane c older run green.
const CACHE = {
  generated: iso(NOW - 60000),
  summary: { queue: { backend: 'gitlab-local', label: 'runner local', running: 3, pending: 2, concurrent: 18, runners_online: 1 } },
  apps: [
    { app: 'app-a', runs: [{ app: 'app-a', backend: 'gh', who: 'claude', status: 'running', created: iso(NOW - 5 * 60000), branch: 'claude/x', estimate: { eta: iso(NOW + 10 * 60000) } }] },
    { app: 'app-b', runs: [
      { app: 'app-b', backend: 'gl', who: 'codex', status: 'running', created: iso(NOW - 2 * 60000), branch: 'codex/y' },
      ...[300, 360, 420].map((s, i) => ({ app: 'app-b', backend: 'gl', who: 'codex', status: 'success', created: iso(NOW - (i + 2) * H), duration_s: s })),
    ] },
    { app: 'app-c', runs: [
      { app: 'app-c', backend: 'gh', who: 'claude', status: 'failed', created: iso(NOW - H), jobs: [{ name: 'lint', status: 'failed' }, { name: 'e2e', status: 'failed', allow_failure: true }] },
      { app: 'app-c', backend: 'gh', who: 'claude', status: 'success', created: iso(NOW - 3 * H), duration_s: 100 },
    ] },
  ],
}

test('ciSummary + ciSentence: the Diagramme sentence, Claude / Codex split, red lane with its red job, runner load', () => {
  const ci = ciSummary(CACHE)
  assert.deepEqual(ci.running, { claude: 1, codex: 1, unknown: 0, total: 2 })
  assert.deepEqual(ci.reds, [{ app: 'app-c', who: 'claude', jobs: ['lint'] }])
  assert.equal(ciSentence(ci, 'runner local à 3/18 · 2 en file'), '2 pipelines en cours (Claude 1 · Codex 1), 1 rouge dans app-c (job lint), runner local à 3/18 · 2 en file')
  assert.equal(ciSummary(null).available, false)
})

test('pipelinesLive: the ci scanner ETA first, else lib/core/estimate over the lane’s past successes', () => {
  const p = pipelinesLive(CACHE, NOW, estimateOf, etaOf)
  assert.deepEqual(p.map((x) => [x.app, x.basis]), [['app-b', 'core'], ['app-a', 'ci']])
  assert.equal(p[0].eta.mid, NOW - 2 * 60000 + 360000) // median 360 s from its start
  const items = encoursItems([{ name: 'package-wave', eta: { mid: NOW + H } }], p, NOW).items
  assert.match(items[0].text, /^Workflow package-wave : fin vers \d\d:\d\d$/)
  assert.match(items[1].text, /^Pipeline app-b \(codex\/y\) · Codex, depuis 2 min : vert ou rouge vers \d\d:\d\d$/)
  const none = encoursItems([{ name: 'w' }], [], NOW).items
  assert.match(none[0].text, /pas assez d’historique/)
})

test('problemsToday: problems seen since local midnight, open ones, top by occurrences', () => {
  const lines = [
    { op: 'add', id: 'p1', at: NOW - 48 * H, title: 'Old one', status: 'ouvert' },
    { op: 'add', id: 'p2', at: NOW - 48 * H, title: 'CI rouge sur lint', status: 'ouvert' },
    { op: 'seen', id: 'p2', at: NOW - 60000, n: 4 },
    { op: 'add', id: 'p3', at: NOW - 60000, title: 'Question en attente', status: 'ouvert' },
    { op: 'update', id: 'p3', at: NOW, fields: { status: 'corrigé' } },
  ]
  const p = problemsToday(lines, NOW)
  assert.deepEqual([p.total, p.today, p.open, p.top.title, p.top.today], [3, 2, 1, 'CI rouge sur lint', 4])
})

test('quotaText: lib/core/usage windows, the earliest run-out date', () => {
  const samples = [{ ts: NOW - 2 * H, five_hour: { pct: 20, reset: NOW + 2 * H }, seven_day: { pct: 40, reset: NOW + 90 * H } },
    { ts: NOW - H, five_hour: { pct: 60, reset: NOW + 2 * H }, seven_day: { pct: 41, reset: NOW + 90 * H } }]
  const t = quotaText(claudeWindows(samples, NOW))
  assert.match(t, /^5 h 60 % · semaine 41 % · épuisé \w{3} \d\d:\d\d$/)
  assert.equal(quotaText(codexWindows(null, NOW)), '')
})

const DATA = () => ({
  conso: { preset: { id: 'today', label: 'aujourd’hui' }, total: { tokens: 1, cost: 12.5 }, rows: [{ label: 'Lead conv', pct: 40 }], project: { label: 'eta', pct: 60 } },
  veille: { available: true, julian: 2, aToi: 5, aToiAvailable: true, filTop: 'Fabric handoff' }, waiting: 1,
  quotas: { claude: claudeWindows([{ ts: NOW - H, five_hour: { pct: 24, reset: NOW + H }, seven_day: { pct: 14, reset: NOW + 50 * H } }], NOW), codex: codexWindows({ limits: { ts: NOW, primary: { pct: 10, windowMin: 300, reset: NOW + H } } }, NOW) },
  runnerText: 'runner local à 3/18', ci: ciSummary(CACHE), problemes: { available: true, today: 2, open: 1, top: { title: 'CI rouge', today: 4 } },
  workflows: [{ name: 'package-wave', eta: null }], pipelines: pipelinesLive(CACHE, NOW, estimateOf, etaOf),
})

test('cardsOf: eight cards in order, one line each, button targets with fallbacks (who all: Claude and Codex)', () => {
  const cs = cardsOf({ ...DATA(), who: 'all' }, CCFG, NOW)
  assert.deepEqual(cs.map((c) => c.id), ['conso', 'attend', 'atoi', 'controle', 'ci', 'quota', 'problemes', 'encours'])
  const by = Object.fromEntries(cs.map((c) => [c.id, c]))
  assert.equal(by.conso.line, 'aujourd’hui $12.50 · Lead conv 40 % · projet eta 60 %')
  assert.equal(by.attend.line, 'attend Julian : 2 · Ça t’attend : 1 · Fabric handoff')
  assert.equal(by.atoi.line, 'À toi : 5')
  assert.match(by.ci.line, /^2 pipelines en cours \(Claude 1 · Codex 1\), 1 rouge dans app-c \(job lint\), runner local à 3\/18$/)
  assert.equal(by.quota.line, 'Claude 5 h 24 % · semaine 14 % | Codex 5 h 10 % · semaine ?')
  assert.match(by.problemes.line, /2 vu\(s\) aujourd’hui · 1 ouvert\(s\) · en tête : CI rouge \(×4\)/)
  assert.equal(by.encours.items.length, 3)
  // buttons: /reference ci diagramme when loaded, else /ci diagramme; problems: /registres problemes, else /problemes
  assert.deepEqual(pickTarget(by.ci.button, ['ci', 'reference']), { command: 'reference', args: 'ci diagramme' })
  assert.deepEqual(pickTarget(by.ci.button, ['ci']), { command: 'ci', args: 'diagramme' })
  assert.deepEqual(pickTarget(by.problemes.button, ['problemes']), { command: 'problemes' })
  assert.equal(pickTarget(by.atoi.button, []), null)
  assert.deepEqual(pickTarget(by.encours.button, []), { tab: 'workflow' }) // own tab: no command needed
  // nothing read: every card says so, none throws
  assert.ok(cardsOf({}, CCFG, NOW).every((c) => c.line && c.tone === 'dim'))
})

test('cardsOf: Claude only by default (cards.who), Codex on demand; lone agents in « En cours »', () => {
  const ciBy = { all: ciSummary(CACHE, 'all'), claude: ciSummary(CACHE, 'claude'), codex: ciSummary(CACHE, 'codex') }
  const lone = [{ type: 'coder', desc: 'build x', bg: true, start: NOW - 20 * 60000, eta: { mid: NOW + 10 * 60000, overrun: false } }]
  const by = Object.fromEntries(cardsOf({ ...DATA(), ciBy, lone }, CCFG, NOW).map((c) => [c.id, c]))
  assert.equal(cockpitConfig(CCFG).cards.who, 'claude')
  assert.equal(by.quota.line, 'Claude 5 h 24 % · semaine 14 %')
  assert.doesNotMatch(by.ci.line, /Codex/)
  assert.ok(by.encours.items.every((it) => !/Codex/.test(it.text)))
  assert.match(by.encours.items.map((it) => it.text).join('\n'), /Agent coder · build x \(arrière-plan\), depuis 20 min : fin vers/)
  const all = Object.fromEntries(cardsOf({ ...DATA(), ciBy, who: 'all' }, CCFG, NOW).map((c) => [c.id, c]))
  assert.match(all.quota.line, /Codex 5 h 10 %/)
  assert.match(all.ci.line, /Claude 1 · Codex 1/)
})

test('parseArgs / aliasArgs / tabsOf: /cockpit levels and tabs, /factory and /machine mapped onto cockpit', () => {
  assert.deepEqual(parseArgs('workflow all'), { close: false, level: null, tab: 'workflow', scope: 'all', rest: '' })
  assert.equal(parseArgs('machine').tab, 'machine')
  assert.equal(parseArgs('conv').level, 'medium')
  assert.equal(parseArgs('projet eta').rest, 'eta')
  assert.equal(parseArgs('close').close, true)
  assert.equal(aliasArgs('factory', ''), 'mission')
  assert.equal(aliasArgs('factory', 'workflow all'), 'workflow all')
  assert.equal(aliasArgs('factory', 'systeme'), 'machine')
  assert.equal(aliasArgs('factory', 'quotas'), 'home')
  assert.equal(aliasArgs('machine', 'refresh'), 'machine')
  assert.equal(aliasArgs('machine', 'close'), 'close')
  const ids = tabsOf(CCFG).map((t) => t.id)
  assert.deepEqual(ids, ['home', 'mission', 'focus', 'arbre', 'pipeline', 'workflow', 'journal', 'machine', 'relais', 'galerie'])
  assert.equal(parseArgs('nuit').tab, 'nuit')
  assert.equal(parseArgs('codex').tab, 'relais')
  assert.ok(!ids.includes('quotas') && !ids.includes('systeme'))
  assert.deepEqual(cockpitConfig(CCFG).aliases.names, ['factory', 'machine'])
})

test('runnerBackends + workflowsLive: core runner load in the Système shape; only live Workflows', () => {
  const r = runnerBackends({ label: 'runner local', running: 3, pending: 1, concurrent: 18, online: 1, generated: NOW })
  assert.deepEqual([r.backends[0].jobs.running, r.backends[0].concurrent, r.backends[0].usable], [3, 18, true])
  assert.match(runnerBackends(null).error, /pas de cache/)
  const live = workflowsLive({ runs: [{ live: true, name: 'a', sentence: 's', estimate: { enough: true, eta: { mid: NOW } } }, { live: false, name: 'b' }] })
  assert.deepEqual(live.map((w) => [w.name, hm(w.eta.mid)]), [['a', hm(NOW)]])
})

const noop = () => {}
const ACT = { tab: noop, crumb: noop, select: noop, refresh: noop, filter: noop, toggle: noop, files: noop, machine: noop, card: noop, go: noop, jfilter: noop, jproject: noop, pick: noop, wfScope: noop, wfToggle: noop }
const NOMENU = { ...CCFG, menu: { ...CCFG.menu, position: 'off' } }
const VIEW = (o) => ({ cfg: NOMENU, fcfg: FCFG, scan: { sessions: [] }, nav: { level: 'mega' }, self: null, busy: false, error: '', at: NOW, columns: 60, filter: 'all',
  usage: null, veille: null, open: {}, act: ACT, ...o })

test('pane: tab row, then the cards under the breadcrumb, each one line + « Voir », within 60 columns', () => {
  const text = renderText(drawCockpit(el, VIEW({ tab: 'home', cards: cardsOf(DATA(), CCFG, NOW) })), 60)
  const order = ['Cockpit', 'Workflow', 'Machine', '[Nuit]', '[Jour]', '[Codex]', 'Méga', 'Qui consomme', 'T’attend', 'À toi', 'Claude Control', 'CI', 'Quota', 'Problèmes du jour', 'En cours', '▸ Tous les projets'].map((k) => text.indexOf(k))
  assert.ok(order.every((i) => i >= 0), text)
  assert.deepEqual([...order].sort((a, b) => a - b), order, text)
  assert.equal((text.match(/Voir/g) || []).length, 8)
  assert.ok(widest(text) <= 60, `${widest(text)} columns`)
  assert.doesNotMatch(text, /Quotas|Système/) // factory's two tabs are not in cockpit
})

test('pane: Workflow and Machine tabs draw factory’s screens through the synced copies', () => {
  const wf = renderText(drawCockpit(el, VIEW({ tab: 'workflow', wf: { runs: [], live: [], history: [] }, wfAt: NOW })), 60)
  assert.match(wf, /Workflow/)
  const sample = { at: NOW, ncpu: 8, cpu: { total: 30 }, ram: { total: 32e9, used: 8e9, pct: 25 }, disks: [], gpu: null, procs: { families: {} } }
  const m = renderText(drawCockpit(el, VIEW({ tab: 'machine', machine: { sample, runner: runnerBackends({ label: 'runner local', running: 2, pending: 0, concurrent: 18, online: 1 }) } })), 60)
  assert.match(m, /CPU[\s\S]*30 %[\s\S]*runner local : utilisable · jobs 2 en cours, 0 en/)
  const wait = renderText(drawCockpit(el, VIEW({ tab: 'machine', machine: {} })), 60)
  assert.match(wait, /Lecture/)
})

test('scanner/cards.mjs: lib/core readers over invented files in a temp home', () => {
  const home = mkdtempSync(join(tmpdir(), 'cockpit-home-'))
  const c = (p) => join(home, '.claude', p)
  for (const d of ['usage-mod', 'veille', 'a-faire', 'problemes']) mkdirSync(c(d), { recursive: true })
  writeFileSync(c('usage-mod/samples.jsonl'), JSON.stringify({ ts: NOW - H, five_hour: { pct: 33, reset: NOW + H }, seven_day: { pct: 12, reset: NOW + 80 * H } }) + '\n')
  writeFileSync(c('veille/state.json'), JSON.stringify({ alerts: { a: { key: 'a', julian: true, severity: 'warn' }, b: { key: 'b', severity: 'info' } } }))
  writeFileSync(c('a-faire/summary.json'), JSON.stringify({ open: 3 }))
  writeFileSync(c('ci-pipelines-cache.json'), JSON.stringify(CACHE))
  writeFileSync(c('problemes/register.jsonl'), JSON.stringify({ op: 'add', id: 'p', at: NOW - 1000, title: 'x', status: 'ouvert' }) + '\n')
  const d = cardsData({ now: NOW, home })
  assert.equal(d.quotas.claude.five.pct, 33)
  assert.deepEqual([d.veille.julian, d.veille.open, d.veille.aToi], [1, 2, 3])
  assert.equal(d.runnerText, 'runner local à 3/18 · 2 en file')
  assert.equal(d.ci.running.total, 2)
  assert.equal(d.pipelines.length, 2)
  assert.equal(d.problemes.today, 1)
  const empty = cardsData({ now: NOW, home: mkdtempSync(join(tmpdir(), 'cockpit-empty-')) })
  assert.deepEqual([empty.veille, empty.ci.available, empty.problemes.available, empty.quotas.claude.five], [null, false, false, null])
})
