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

process.env.TZ = 'UTC' // the pane prints local time (the page's format); the fixtures are read in UTC

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
  assert.match(P.line, /^live · CPU 12 % · RAM 50 %$/)
  assert.equal(P.temp.text, 'temperature: no sensor reading in the hub data')
  assert.equal(P.work[0].text, 'claude job (job 9) · since 11:59 · ETA 12:01')
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
  assert.match(P.work[0].text, /past its ETA 11:50/)
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
  assert.match(draw(sent, 160), /Sent "a\) cap at 3" at 12:00; Oracle records it within about 2 minutes\./)
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
    for (const re of [/This laptop · Computer one/, /Global/, /You: what blocks work now \(2\)/, /\[a\) cap at 3 · recommended\]/, /Problems now/,
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
  assert.match(s, /^This laptop · Computer one \(pulled 20 s ago · built 12:00\)/)
  assert.match(s, /\n {4}! 01 Rotate the test key\n/)
  assert.match(s, /\nGlobal\n/)
  assert.match(s, /Cap tool work\? \[Tools\] · recommended: a\) cap at 3 \(I1\)/) // plain title first, the id at the end
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

// ---- cockpit-ui-fix (12 Nov review): the page's ONE reading (data.glance), its words and its time format ----
test('glance: fleet sentence and alert count of the page, quota row in unlimited mode, collapsed You rows, the page problems', () => {
  const d = structuredClone(DATA)
  const T = NOW / 1000
  d.fleet_view = { generated_ts: T, sentence: 'Fleet coding is working: 1 of 2 machines busy, utilisation 50 %',
    tiles: [{ id: 'pc1', label: 'Computer one', colour: 'yellow', power: 'on', busy: false, mode: 'coding', alerts: [] },
      { id: 'pc2', label: 'Computer two', colour: 'red', power: 'on', busy: true, alerts: [] }] }
  d.inbox.items[0].covers = [{ id: 'I5', type: 'issue' }, { id: 'pc1-urgent', type: 'todo' }]
  d.inbox.items.push({ uid: 'issue:I5', type: 'issue', section: 'look', id: 'I5', title: 'Port open', org: 'tools', urgency: 'now', you: true, blocks_work: true, covered_by: 'issue:I1' })
  d.glance = {
    time: { hour12: false }, jobs: [{ id: 12, machine: 'pc1', kind: 'ps', tag: 'modes', started_ts: T - 60, eta_ts: null }],
    alerts: { shown: 4, entries: 19 },
    quota: { colour: 'yellow', text: 'Claude quota: 20 % used of the 7-day window, empties 2026-01-03T15:02:36Z at this pace; unlimited mode until 2026-01-05T12:00:00Z (read 2026-01-02T11:29:01Z)', covers: ['I13'] },
    problems: [{ kind: 'machine', severity: 'urgent', text: 'Computer two: CPU 97 C', org: null }, { kind: 'issue', severity: 'urgent', text: 'Acme build broken', id: 'I77', org: 'acme' }],
    later: [{ kind: 'job', severity: 'high', text: '3 failed jobs', org: null }, { kind: 'quota', severity: 'high', text: 'q', org: null }],
    freshness: [{ id: 'data', ts: T, due_ts: T + 400 }, { id: 'overview', label: 'overview', ts: T - 7200, next_ts: T - 1500, due_ts: T - 1200 }],
  }
  const m = hubModel(LOCAL, d, {}, { now: NOW })
  const G = m.global
  assert.equal(G.fleetLine, 'Fleet coding is working: 1 of 2 machines busy, utilisation 50 % (12:00) · 4 alerts')
  assert.deepEqual(G.dots.map((x) => [x.label, x.tone]), [['Computer one', 'warn'], ['Computer two', 'bad']])
  assert.equal(G.quota.tone, 'warn')
  assert.equal(G.quota.text, 'Claude quota: 20 % used of the 7-day window, empties Sat 3 Jan 15:02 at this pace; unlimited mode until Mon 5 Jan 12:00 (read 11:29)')
  assert.deepEqual(G.you.map((q) => q.id), ['I1', 'Q2'])           // I5 is covered by I1
  assert.equal(G.you[0].covers, 'covers I5 and 1 to-do')
  assert.deepEqual(G.errors.map((e) => e.text), ['Computer two: CPU 97 C', 'Acme build broken (I77)'])
  assert.equal(G.later, 1)                                             // the quota row is above, not counted twice
  assert.match(m.laptop.line, /^live · mode coding · CPU 12 %/)
  assert.deepEqual(m.laptop.work.map((w) => w.text), ['modes job (job 12) · since 11:59', 'Write the folder table (R1)'].slice(0, 1))
  assert.equal(m.stale, 'Not up to date: overview refresh due 11:35 did not run (from 10:00)')
  // a workspace: shared rows in the default org, a register row in its own org only
  const acme = hubModel(LOCAL, d, {}, { now: NOW, org: 'acme' }).global
  assert.deepEqual(acme.errors.map((e) => e.text), ['Acme build broken (I77)'])
  assert.equal(acme.quota, null)
  const s = summaryText(m, {})
  assert.match(s, /Cap tool work\? \[Tools\] · covers I5 and 1 to-do · recommended: a\) cap at 3 \(I1\)/)
  assert.match(s, /1 more to look at when you have time/)
  assert.doesNotMatch(s, /UTC|2026-01-0/)
})
