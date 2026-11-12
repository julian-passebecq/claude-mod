// lib/hub.mjs (the dispatcher's model of the local Cockpit's data) and hooks/hub_view.mjs (drawing), on invented fixtures.
// node --test mods/cockpit/tests/hub.test.mjs
process.env.TZ = 'UTC' // the one clock is local; the tests pin it
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hubModel, hubTabs, hubIdOf, tabKey, hubConfig, parseTarget, sendResult, summaryText, badgeText, tokenOf, inOrg, orgsOf, moduleOf, moduleUrl,
  answerText, answerButtons, youList, HUB_TABS, MODULES, at, localize, foldRelated } from '../lib/hub.mjs'
import { drawHub, hubBar } from '../hooks/hub_view.mjs'
import { kit, drawCockpit } from '../hooks/view.mjs'
import { tabValid, parseArgs } from '../hooks/nav.mjs'
import { el, renderText } from '../lib/factory/scanner/textrender.mjs'
import { LOCAL, DATA, DATA2 } from '../scripts/fixtures/hub.mjs'

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
  assert.match(P.line, /^live · mode unknown · CPU 12 % · RAM 50 %$/)
  assert.equal(P.temp.text, 'temperature: no sensor reading in the hub data')
  // the machine's own queue is the one source of running jobs: pc1's is empty, so the overview's job 9 is not shown
  assert.deepEqual(P.work, [])
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
  data.fleet.machines[0].queue.running = [{ id: 9, kind: 'claude' }]
  const P = hubModel(LOCAL, data, {}, { now: NOW }).laptop
  assert.match(P.line, /mode coding · CPU 80 %/)
  assert.equal(P.temp.text, 'temperature CPU 97 °C') // the hotter sensor
  assert.equal(P.temp.tone, 'bad')
  assert.equal(P.agents, '25 agent processes')
  assert.deepEqual(P.warn.map((w) => [w.text, w.tone]), [['hot for 2 readings', 'bad'], ['temperature CPU 97 °C', 'bad'], ['disk C: 4 % free', 'bad']])
  assert.equal(P.work[0].text, 'job #9 claude · since 11:59 · past its ETA 11:50')
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
  // the page's Problems now, every severity, most severe first (no quota.json reading in this old fixture: its row stays)
  assert.deepEqual(G.errors.map((e) => e.text), ['Claude quota at 40 % of the week', 'job 14 lost on Computer two'])
  assert.equal(G.fleetLine, '1 of 2 workers busy · jobs: 1 running, 0 queued')
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
  assert.match(draw(bare, 60), /Nothing needs you now\./)
  assert.match(draw(bare, 60), /No problem now\./)
  assert.equal(hubModel(LOCAL, null, {}, { now: NOW }).hasData, false)
  assert.match(summaryText(null, {}), /not reachable/)
})

test('the dispatcher draws both blocks and the Open in Cockpit links at 45 and 90 columns; no full tab', () => {
  const m = hubModel(LOCAL, DATA, {}, { now: NOW })
  for (const cols of [45, 90]) {
    const text = draw(m, cols)
    for (const re of [/This laptop · Computer one/, /Global/, /Needs you now \(2\)/, /\[a\) cap at 3 · recommended\]/, /Problems now/,
      /\[Job or prompt to a machine…\]/, /\[To-do for Julian…\]/, /Open in Cockpit/, /\[Questions and checks\]/, /\[Dispatcher\]/, /\[Conversations\]/]) assert.match(text, re, `${re} at ${cols}`)
    assert.ok(text.indexOf('This laptop') < text.indexOf('Global') && text.indexOf('Global') < text.indexOf('Open in Cockpit'))
    for (const gone of [/Watch digest/, /Answer sheet/, /By application/, /Lost jobs/, /Fleet quota/]) assert.doesNotMatch(text, gone)
  }
  const off = draw(null, 60, { error: 'offline here' })
  assert.match(off, /offline here/)
  assert.match(off, /\[Open in Cockpit\]/)
  assert.ok(hubBar(kit(el, {}), { hub: { enabled: false } }, 'home', m, ACT) === null)
  assert.deepEqual(m.modules.map((x) => x.id), MODULES)
  assert.equal(m.modules[1].url, 'http://127.0.0.1:24365/#inbox')
  assert.equal(m.modules[1].label, 'Questions and checks')
})

test('the pane: the dispatcher takes the whole width (no left menu); /fleet text and module links', () => {
  const m = hubModel(LOCAL, DATA, {}, { now: NOW })
  const text = renderText(drawCockpit(el, { cfg: {}, fcfg: {}, tab: 'hub-fleet', columns: 80, hub: { model: m }, act: ACT }), 80)
  assert.match(text, /This laptop · Computer one/)
  assert.doesNotMatch(text, /Jauge/)
  const s = summaryText(m, {})
  assert.match(s, /^This laptop · Computer one \(pulled 20 s ago · built 12:00\)/)
  assert.match(s, /\n {4}! Rotate the test key\n/)
  assert.match(s, /\nGlobal\n/)
  assert.match(s, /\n {4}Cap tool work\? · recommended: a\) cap at 3\n {6}Tools · I1\n/)
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

// ---- review of 12 Nov (rules 7, 8, 11-16): one quota story, the page's counts, folded rows, one clock, plain labels ----

test('quota: one row from quota.json (the Quota module reading), its exhaust and reading time; unlimited mode = yellow', () => {
  const m = hubModel(LOCAL, DATA2, {}, { now: NOW })
  const q = m.global.errors.find((e) => e.kind === 'quota')
  assert.equal(q.text, 'Claude quota: 20 % used of the 7-day window, empties Sat 3 Jan 15:02 at this pace (resets Thu 8 Jan 12:00)')
  assert.deepEqual(q.meta, ['read 11:29', 'unlimited mode until Thu 8 Jan 12:00', 'covers I13'])
  assert.equal(q.tone, 'warn') // the unlimited mode he set: yellow, not red
  // the overview's own quota row (19.0 %, 07:31) and I13 are gone: one story
  const all = m.global.errors.map((e) => e.text).join('\n')
  assert.doesNotMatch(all, /19\.0%|07:31|I13|burns/)
  assert.equal(m.global.errors.filter((e) => /quota/i.test(e.text)).length, 1)
  // normal mode: red; expired unlimited: red again
  const d = structuredClone(DATA2)
  d.quota_mode = { mode: 'normal', source: 'file' }
  assert.equal(hubModel(LOCAL, d, {}, { now: NOW }).global.errors.find((e) => e.kind === 'quota').tone, 'bad')
  d.quota_mode = { mode: 'unlimited', expired: true }
  assert.equal(hubModel(LOCAL, d, {}, { now: NOW }).global.errors.find((e) => e.kind === 'quota').tone, 'bad')
})

test('the page counts and sentence, not recomputed: fleet sentence, tiles order, Problems now total, alerts', () => {
  const m = hubModel(LOCAL, DATA2, {}, { now: NOW })
  const G = m.global
  assert.equal(G.fleetLine, 'Fleet coding is working: 1 of 2 machines busy, utilisation 50 % (at 11:59)')
  assert.deepEqual(G.dots.map((d) => [d.label, d.state, d.tone]), [['Computer two', 'busy', 'ok'], ['Computer one', 'on', 'warn'], ['Tablet', 'off', 'dim']])
  // Problems now: quota (once), I10, the job row; I2 is under Needs you now and only counted
  assert.deepEqual(G.errors.map((e) => e.kind), ['quota', 'issue', 'job'])
  assert.equal(G.errorsTotal, 3)
  assert.equal(G.covered, 1)
  // alerts: the page's rows of the workspace (5), minus I2 and I90 (Needs you now) and the quota alert (the quota row)
  assert.equal(G.alerts.text, 'Alerts: 1 open, 0 urgent')
  assert.equal(G.alerts.listed, '3 more are listed above')
  assert.equal(G.alerts.total, 5)
  // the running job comes from the tile alone: pc1's tile has none, so the overview's stale job 9 is not running here
  assert.deepEqual(m.laptop.work, [])
  const d = structuredClone(DATA2)
  d.fleet_view.tiles[1].running = [{ id: 9, kind: 'claude' }]
  assert.equal(hubModel(LOCAL, d, {}, { now: NOW }).laptop.work[0].text, 'job #9 claude · since 11:59 · ETA 12:01')
})

test('Needs you now: related items folded into one row (the question with its buttons, covers I2, I4 and 1 to-do)', () => {
  const m = hubModel(LOCAL, DATA2, {}, { now: NOW })
  const G = m.global
  assert.deepEqual(G.you.map((q) => q.id), ['I90', 'Q1'])
  assert.equal(G.you[0].covers, 'covers I2, I4 and 1 to-do')
  assert.deepEqual(G.you[0].answers.map((a) => a.key), ['a', 'b'])
  assert.equal(G.youTotal, 2)
  const groups = foldRelated(DATA2.inbox.items.filter((x) => x.you))
  assert.equal(groups.length, 3) // I90 group, Q1, I3
  const text = draw(m, 50)
  assert.equal((text.match(/Port 22/g) || []).length, 0) // I2 shows nowhere else in the pane
})

test('one clock: local 24 h, 19:22 today, Fri 13 Nov 16:02 another day; hub-written dates formatted in the renderer', () => {
  const now = Date.parse('2026-11-12T18:24:00Z')
  assert.equal(at('2026-11-12T18:22:00Z', now), '18:22')
  assert.equal(at('2026-11-13T16:02:36Z', now), 'Fri 13 Nov 16:02')
  assert.equal(at(1794507842, now), '18:24')
  assert.equal(at('2026-11-12T19:05:00Z', now, { time: { hour12: true } }), '7:05 PM')
  assert.equal(localize('empties 2026-11-13T07:31:57Z before its reset', now), 'empties Fri 13 Nov 07:31 before its reset')
  assert.equal(localize('last check 2026-11-12 18:00Z', now), 'last check 18:00')
  assert.equal(localize('since 2026-11-11', now), 'since Wed 11 Nov')
  assert.equal(localize('empty around 13 Nov 06:00 UTC', now), 'empty around Fri 13 Nov 06:00')
  assert.equal(localize('built 16:55 UTC', now), 'built 16:55')
  assert.equal(localize('no date here: 7 jobs, 2026 lines', now), 'no date here: 7 jobs, 2026 lines')
  // another zone: the clock follows this computer
  process.env.TZ = 'Europe/Paris'
  try { assert.equal(at('2026-11-12T18:22:00Z', now), '19:22') } finally { process.env.TZ = 'UTC' }
  // the rows of the pane carry no ISO stamp
  const text = draw(hubModel(LOCAL, DATA2, {}, { now: NOW }), 60)
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}|UTC/)
  assert.match(text, /3 failed jobs in 24 h, last check 11:00/)
  assert.match(text, /Hub disk at 74 % since Thu 1 Jan/)
})

test('plain labels: title first, the id small at the end of a plain-word meta line; to-dos one line, Run on the first only', () => {
  const m = hubModel(LOCAL, DATA2, {}, { now: NOW })
  const q1 = m.global.you.find((q) => q.id === 'Q1')
  assert.equal(q1.title, 'Pick the backup disk')
  assert.deepEqual(q1.meta, ['App one', 'waits on you', 'priority 1', 'Q1'])
  const i10 = m.global.errors.find((e) => e.text.startsWith('Hub disk'))
  assert.deepEqual(i10.meta, ['an agent works on it', 'I10'])
  const text = draw(m, 50)
  assert.match(text, /Pick the backup disk\s*│\n│ App one · waits on you · priority 1 · Q1/)
  assert.doesNotMatch(text, /blocked-user|waiting-julian|\bp0\b|not published/)
  // headings and module list are the page's
  assert.match(text, /Needs you now \(2\)/)
  assert.match(text, /Problems now/)
  assert.deepEqual(m.modules.map((x) => x.label), ['Overview', 'Questions and checks', 'To do', 'Fleet', 'Alerts', 'Quota', 'Dispatch plan', 'My messages'])
  // This laptop from its tile: power, mode, the hotter sensor and the 1 h maximum, the tile's yellow reasons
  assert.equal(m.laptop.line, 'on · mode normal · CPU 5 % · RAM 50 %')
  assert.equal(m.laptop.temp.text, 'temperature CPU 59 °C (max 95 °C in the last hour)')
  assert.deepEqual(m.laptop.warn.map((w) => w.text), ['27 agent processes, cap 12', 'disk C: 8.4 % free'])
  assert.equal(m.laptop.agents, '')
  // 3 to-dos, one line each, Run only on the first, then show all
  const d = structuredClone(DATA2)
  d.todo.pc1 = Array.from({ length: 12 }, (_, i) => ({ id: `pc1-t${i}`, nn: String(i + 1).padStart(2, '0'), title: `Step ${i + 1}` }))
  const L2 = { ...LOCAL, delivered: d.todo.pc1.map((t) => ({ id: t.id })), marked_done: [] }
  const t2 = draw(hubModel(L2, d, {}, { now: NOW }), 50)
  assert.equal((t2.match(/\[Run\]/g) || []).length, 1)
  assert.match(t2, /\[show all 12\]/)
  assert.doesNotMatch(t2, /Step 4\b/)
})

test('the pane at 50 columns stays short with today-shaped data', () => {
  const text = draw(hubModel(LOCAL, DATA2, {}, { now: NOW }), 50)
  assert.ok(text.split('\n').length < 75, `${text.split('\n').length} lines`)
})
