// lib/hub.mjs (the dispatcher's model of the local Cockpit's data) and hooks/hub_view.mjs (drawing), on invented fixtures.
// node --test mods/cockpit/tests/hub.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hubModel, hubTabs, hubIdOf, tabKey, hubConfig, parseTarget, sendResult, summaryText, badgeText, tokenOf, inOrg, orgsOf, moduleOf, moduleUrl,
  answerText, answerButtons, youList, HUB_TABS, MODULES } from '../lib/hub.mjs'
import { drawHub, hubBar } from '../hooks/hub_view.mjs'
import { kit, drawCockpit } from '../hooks/view.mjs'
import { tabValid, parseArgs } from '../hooks/nav.mjs'
import { el, renderText } from '../lib/factory/scanner/textrender.mjs'
import { LOCAL, DATA } from '../scripts/fixtures/hub.mjs'

const NOW = LOCAL.now
const ACT = { hubTab() {}, panneau() {}, refresh() {}, org() {}, run() {}, done() {}, answer() {}, fill() {}, open() {} }
const draw = (m, cols, o = {}) => renderText(drawHub(kit(el, {}), { cfg: {}, model: m, columns: cols, act: ACT, ...o }), cols)

test('one hub view, the dispatcher; the nine old tab ids and /cockpit words open it', () => {
  assert.deepEqual(HUB_TABS, ['home'])
  assert.deepEqual(hubTabs({}).map((t) => t.label), ['Dispatcher'])
  assert.deepEqual(hubTabs({ hub: { enabled: false } }), [])
  for (const old of ['overview', 'todo', 'fleet', 'journal', 'lanes']) {
    assert.equal(tabKey(old), 'hub-home')
    assert.equal(hubIdOf('hub-' + old), 'home')
    assert.equal(parseArgs(old === 'journal' ? 'events' : old).tab, 'hub-home')
  }
  assert.equal(parseArgs('journal').tab, 'journal') // factory's own
  assert.equal(hubIdOf('journal'), null)
  assert.ok(tabValid({}, 'hub-home') && tabValid({}, 'hub-fleet'))
  assert.ok(!tabValid({ hub: { enabled: false } }, 'hub-home'))
  // an old start (#82/#83 configs) opens the dispatcher
  assert.equal(hubConfig({ hub: { start: 'overview' } }).start, 'home')
  assert.equal(hubConfig({ hub: { start: 'panneau' } }).start, 'panneau')
})

test('This laptop: to-dos here urgent first (marked done last), Run only for delivered items, machine state', () => {
  const m = hubModel(LOCAL, DATA, {}, { now: NOW })
  const P = m.laptop
  assert.deepEqual(P.todos.map((t) => t.id), ['pc1-urgent', 'pc1-plain', 'pc1-marked'])
  assert.ok(P.todos[0].urgent && P.todos[0].canRun)
  assert.deepEqual(P.todos[0].tags, ['security'])
  assert.ok(!P.todos[2].canRun && P.todos[2].marked)
  assert.equal(P.label, 'Computer one')
  assert.match(P.line, /^live · mode not published · CPU 12 % · RAM 50 %$/)
  assert.equal(P.temp.text, 'temperature: no sensor reading in the hub data')
  assert.equal(P.work[0].text, 'job #9 claude · since 11:59 UTC · ETA 12:01 UTC')
  assert.equal(m.hereOpen, 3) // the page's count: marked done ones too
  assert.equal(badgeText(m), 'Fleet: 3 to do')
  assert.equal(badgeText(null), 'Fleet: offline')
})

test('This laptop: health and mode when the hub publishes them; hot, low disk and past ETA are said', () => {
  const data = structuredClone(DATA)
  data.health = { machines: { pc1: { cpu_c: 97, gpu_c: 60, cpu_pct: 80, agents: 25, status: 'hot', severity: 'urgent', reasons: ['hot for 2 readings'] } } }
  data.modes = { pc1: { mode: 'coding' } }
  data.fleet.machines[0].load.disks = [{ mount: 'C:', free_pct: 4 }]
  data.overview.running.jobs[0].eta_ts = NOW / 1000 - 600
  const P = hubModel(LOCAL, data, {}, { now: NOW }).laptop
  assert.match(P.line, /mode coding · CPU 80 %/)
  assert.equal(P.temp.text, 'temperature CPU 97 °C · GPU 60 °C')
  assert.equal(P.temp.tone, 'bad')
  assert.equal(P.agents, '25 agent processes')
  assert.deepEqual(P.warn.map((w) => [w.text, w.tone]), [['hot for 2 readings', 'bad'], ['temperature CPU 97 °C · GPU 60 °C', 'bad'], ['disk C: 4 % free', 'bad']])
  assert.match(P.work[0].text, /past its ETA 11:50 UTC/)
  assert.equal(P.work[0].tone, 'warn')
  // gaming from the worker, GPU sensor of the load sample
  const d2 = structuredClone(DATA)
  d2.fleet.machines[0].load.gpu = [{ temp_c: 43 }]
  const P2 = hubModel({ ...LOCAL, gaming: true }, d2, {}, { now: NOW }).laptop
  assert.match(P2.line, /mode gaming/)
  assert.equal(P2.temp.text, 'temperature GPU 43 °C')
})

test('Global: the page’s You list (blocking only, most urgent first), answers recommended first, errors, fleet line', () => {
  const m = hubModel(LOCAL, DATA, {}, { now: NOW })
  const G = m.global
  assert.deepEqual(G.you.map((q) => q.id), ['I1', 'Q2']) // I3 does not block; I9 is confidential
  assert.equal(G.youTotal, 2)
  assert.deepEqual(G.you[0].answers.map((a) => [a.key, a.rec]), [['a', true], ['b', false]])
  assert.equal(G.answerMachine, 'hub')
  assert.equal(answerText(G.answerTemplate, 'I1', 'a'), 'Answer I1: a')
  assert.equal(answerText('x', 'Q2', 'a'), null) // only register questions are answered this way, as on the page
  assert.deepEqual(G.errors.map((e) => e.text), ['Claude quota at 40 % of the week']) // high is in the page's Overview
  assert.equal(G.fleetLine, '1 of 2 workers busy · jobs: 1 running, 0 queued · 2 alerts')
  assert.deepEqual(G.dots.map((d) => [d.label, d.state, d.tone]), [['Computer one', 'live', 'ok'], ['Computer two', 'busy', 'running']])
  assert.equal(G.urgentElsewhere, 0)
  // an answer sent from the pane replaces the buttons by its confirmation
  const sent = hubModel(LOCAL, DATA, {}, { now: NOW, answered: { 'issue:I1': { key: 'a', label: 'a) cap at 3', t: NOW } } })
  assert.equal(sent.global.you[0].sent.label, 'a) cap at 3')
  assert.match(draw(sent, 160), /Sent "a\) cap at 3" at 12:00 UTC; Oracle records it within about 2 minutes\./)
})

test('workspaces: All hides confidential items; an org shows only its own, the confidential one its own key', () => {
  assert.deepEqual(orgsOf(DATA).map((o) => o.id), ['acme', 'tools', 'secret'])
  assert.deepEqual(orgsOf({ organizations: { acme: 'Acme' } }), [{ id: 'acme', label: 'Acme' }])
  assert.ok(inOrg({ org: 'acme' }, 'acme') && !inOrg({ org: 'beta' }, 'acme') && inOrg({}, 'acme'))
  const acme = hubModel(LOCAL, DATA, {}, { now: NOW, org: 'acme' })
  assert.deepEqual(acme.global.you.map((q) => q.id), ['Q2'])
  assert.ok(acme.todo.all.some((t) => t.id === 'pc2-item'))
  const tools = hubModel(LOCAL, DATA, {}, { now: NOW, org: 'tools' })
  assert.ok(!tools.todo.all.some((t) => t.id === 'pc2-item'))
  const secret = hubModel(LOCAL, DATA, {}, { now: NOW, org: 'secret' })
  assert.deepEqual(secret.global.you.map((q) => q.id), ['I9'])
  assert.ok(!draw(hubModel(LOCAL, DATA, {}, { now: NOW }), 70).includes('Secret question'))
  // youList is the page's: non-blocking items stay out of the top list but count in all
  const yl = youList(DATA.inbox.items, 5)
  assert.equal(yl.blocking, 2)
  assert.equal(yl.all.length, 3)
  assert.deepEqual(answerButtons({ answerable: true, rec_key: 'rec', recommended: 'do it', options: [{ key: 'a', label: 'x' }] }).map((a) => a.key), ['rec', 'a'])
})

test('absent parts: no inbox (overview questions), no organizations, no data at all', () => {
  const data = structuredClone(DATA)
  delete data.inbox
  const m = hubModel(LOCAL, data, {}, { now: NOW })
  assert.deepEqual(m.global.you.map((q) => q.id), ['I1']) // the overview's urgent question
  assert.equal(m.orgs.length, 0)
  const bare = hubModel(LOCAL, { labels: {} }, {}, { now: NOW })
  assert.equal(bare.todo.all.length, 0)
  assert.equal(bare.laptop.known, false)
  assert.match(draw(bare, 60), /Nothing to do here\./)
  assert.match(draw(bare, 60), /Nothing waits on you\./)
  assert.equal(hubModel(LOCAL, null, {}, { now: NOW }).hasData, false)
  assert.match(summaryText(null, {}), /not reachable/)
})

test('the dispatcher draws both blocks and the Open in Cockpit links at 45 and 90 columns; no full tab', () => {
  const m = hubModel(LOCAL, DATA, {}, { now: NOW })
  for (const cols of [45, 90]) {
    const text = draw(m, cols)
    for (const re of [/This laptop · Computer one/, /Global/, /You: what blocks work now \(2\)/, /\[a\) cap at 3 · recommended\]/, /Errors now/,
      /\[Job or prompt to a machine…\]/, /\[To-do for Julian…\]/, /Open in Cockpit/, /\[Questions and checks\]/, /\[Dispatcher\]/, /\[Conversations\]/]) assert.match(text, re, `${re} at ${cols}`)
    assert.ok(text.indexOf('This laptop') < text.indexOf('Global') && text.indexOf('Global') < text.indexOf('Open in Cockpit'))
    for (const gone of [/Watch digest/, /Answer sheet/, /By application/, /Lost jobs/, /Fleet quota/]) assert.doesNotMatch(text, gone)
  }
  const off = draw(null, 60, { error: 'offline here' })
  assert.match(off, /offline here/)
  assert.match(off, /\[Open in Cockpit\]/)
  assert.ok(hubBar(kit(el, {}), { hub: { enabled: false } }, 'home', m, ACT) === null)
  assert.deepEqual(m.modules.map((x) => x.id), MODULES)
  assert.equal(m.modules[2].url, 'http://127.0.0.1:24365/#inbox')
  assert.equal(m.modules[2].label, 'Questions and checks')
})

test('the pane: the dispatcher takes the whole width (no left menu); /fleet text and module links', () => {
  const m = hubModel(LOCAL, DATA, {}, { now: NOW })
  const text = renderText(drawCockpit(el, { cfg: {}, fcfg: {}, tab: 'hub-fleet', columns: 80, hub: { model: m }, act: ACT }), 80)
  assert.match(text, /This laptop · Computer one/)
  assert.doesNotMatch(text, /Jauge/)
  const s = summaryText(m, {})
  assert.match(s, /^This laptop · Computer one \(pulled 20 s ago · built 12:00 UTC\)/)
  assert.match(s, /\n {4}! 01 Rotate the test key\n/)
  assert.match(s, /\nGlobal\n/)
  assert.match(s, /I1 · Cap tool work\? \[Tools\] · recommended: a\) cap at 3/)
  assert.equal(moduleOf('questions'), 'inbox')
  assert.equal(moduleOf('fleet'), 'fleet')
  assert.equal(moduleOf('nope'), '')
  assert.equal(moduleUrl('http://127.0.0.1:24365/', 'fleet'), 'http://127.0.0.1:24365/#fleet')
})

test('sending: targets, results, token', () => {
  assert.deepEqual(parseTarget('pc2 run the backup', DATA.labels), { machine: 'pc2', text: 'run the backup' })
  assert.deepEqual(parseTarget('"Computer two" x', DATA.labels).error.startsWith('unknown machine'), true)
  assert.deepEqual(parseTarget('computertwo hello', DATA.labels), { machine: 'pc2', text: 'hello' })
  assert.match(parseTarget('nope', DATA.labels).error, /usage/)
  assert.match(sendResult('dispatch', { status: 404 }), /not available yet/)
  assert.equal(sendResult('dispatch', { status: 200, ok: true, text: '{"job":7}' }), 'dispatch: sent as job 7')
  assert.match(sendResult('todo', null), /did not answer/)
  assert.equal(tokenOf('<meta name="cockpit-token" content="abcdef0123456789">'), 'abcdef0123456789')
})
