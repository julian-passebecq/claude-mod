// lib/hub.mjs (model of the local Cockpit's data) and hooks/hub_view.mjs (drawing), on invented fixtures.
// node --test mods/cockpit/tests/hub.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hubModel, hubTabs, hubIdOf, tabKey, parseTarget, sendResult, summaryText, badgeText, tokenOf, inOrg, orgsOf, HUB_TABS } from '../lib/hub.mjs'
import { drawHub, hubBar } from '../hooks/hub_view.mjs'
import { kit, drawCockpit } from '../hooks/view.mjs'
import { tabValid, parseArgs } from '../hooks/nav.mjs'
import { el, renderText } from '../lib/factory/scanner/textrender.mjs'
import { LOCAL, DATA } from '../scripts/fixtures/hub.mjs'

const NOW = LOCAL.now

test('the tabs: nine hub tabs in order, hub ids round-trip, nav accepts them', () => {
  assert.deepEqual(hubTabs({}).map((t) => t.label), ['Overview', 'To do', 'Questions and checks', 'Fleet', 'Quota', 'Alerts', 'Journal', 'Watch', 'Lanes'])
  assert.equal(hubIdOf(tabKey('fleet')), 'fleet')
  assert.equal(hubIdOf('journal'), null)
  assert.ok(tabValid({}, 'hub-quota'))
  assert.ok(!tabValid({ hub: { tabs: { order: ['todo'] } } }, 'hub-quota'))
  assert.ok(!tabValid({ hub: { enabled: false } }, 'hub-todo'))
  assert.equal(parseArgs('fleet').tab, 'hub-fleet')
  assert.equal(parseArgs('journal').tab, 'journal')
  assert.equal(parseArgs('events').tab, 'hub-journal')
  assert.equal(HUB_TABS.length, 9)
})

test('to do: urgent first, then ongoing, here, elsewhere; tags from the title; Run only for delivered items here', () => {
  const m = hubModel(LOCAL, DATA, {}, { now: NOW })
  assert.deepEqual(m.todo.urgent.map((t) => t.id), ['pc1-urgent'])
  assert.deepEqual(m.todo.ongoing.map((t) => t.id), ['pc1-marked'])
  assert.deepEqual(m.todo.here.map((t) => t.id), ['pc1-plain'])
  assert.deepEqual(m.todo.elsewhere.map((t) => t.id), ['pc2-item'])
  const u = m.todo.urgent[0]
  assert.equal(u.title, 'Rotate the test key')
  assert.deepEqual(u.tags, ['security'])
  assert.ok(u.canRun)
  assert.ok(!m.todo.elsewhere[0].canRun)
  assert.ok(!m.todo.ongoing[0].canRun)
  assert.equal(m.hereOpen, 3) // the page's count: marked done ones too
  assert.equal(badgeText(m), 'Fleet: 3 to do')
  assert.equal(badgeText(null), 'Fleet: offline')
})

test('overview, questions, fleet, quota, alerts, journal, watch, lanes come from the same data', () => {
  const m = hubModel(LOCAL, DATA, {}, { now: NOW, usage: { windows: [{ label: '5 h', available: true, pct: 12, when: 'reset 18:00' }] }, veille: { alerts: [{ key: 'k', what: 'PR green', acked: false }] } })
  assert.equal(m.overview.errors[0].severity, 'urgent')
  assert.equal(m.overview.apps[0].label, 'App one')
  assert.equal(m.questions.questions[0].id, 'I1')
  assert.equal(m.questions.answers[0].q, 'Which box stays awake?')
  assert.equal(m.questions.checks.length, 1)
  assert.equal(m.fleet.machines.length, 2)
  assert.match(m.fleet.herd, /2 machines up/)
  assert.equal(m.quota.hub[0].provider, 'Claude')
  assert.equal(m.quota.hub[0].pct, 40)
  assert.equal(m.quota.local[0].text, '12 % · reset 18:00')
  assert.equal(m.alerts.hub.length, 2)
  assert.equal(m.alerts.local[0].text, 'PR green')
  assert.ok(m.journal.rows.length >= 3)
  assert.ok(m.journal.rows[0].t >= m.journal.rows.at(-1).t)
  assert.equal(m.watch.name, 'DIGEST-2026-01-02.md')
  assert.equal(m.lanes.lanes[0].id, 'R1')
  assert.equal(m.lanes.jobs[0].machine, 'Computer one')
})

test('absent parts: no quota block, no organizations, no data at all', () => {
  const m = hubModel(LOCAL, { labels: {} }, {}, { now: NOW })
  assert.equal(m.quota.hub.length, 0)
  assert.equal(m.orgs.length, 0)
  assert.equal(m.todo.all.length, 0)
  const d = hubModel(LOCAL, null, {}, { now: NOW })
  assert.equal(d.hasData, false)
  assert.match(summaryText(null, {}), /not reachable/)
})

test('organizations: switch filters items naming another org, keeps shared ones', () => {
  const data = { ...DATA, organizations: [{ id: 'acme', label: 'Acme' }, { id: 'beta', label: 'Beta' }] }
  assert.deepEqual(orgsOf(data).map((o) => o.label), ['Acme', 'Beta'])
  assert.deepEqual(orgsOf({ organizations: { acme: 'Acme' } }), [{ id: 'acme', label: 'Acme' }])
  assert.ok(inOrg({ org: 'acme' }, 'acme') && !inOrg({ org: 'beta' }, 'acme') && inOrg({}, 'acme'))
  const all = hubModel(LOCAL, data, {}, { now: NOW })
  const beta = hubModel(LOCAL, data, {}, { now: NOW, org: 'beta' })
  assert.ok(beta.todo.all.length < all.todo.all.length)
  assert.ok(!beta.todo.all.some((t) => t.org === 'acme'))
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

test('every hub tab draws at a narrow and a wide width, with the shared tab bar', () => {
  const m = hubModel(LOCAL, DATA, {}, { now: NOW, usage: { windows: [] } })
  const act = { hubTab() {}, panneau() {}, refresh() {}, org() {}, run() {}, done() {} }
  for (const cols of [45, 90]) {
    for (const id of HUB_TABS) {
      const text = renderText(drawHub(kit(el, {}), { cfg: {}, tab: id, model: m, columns: cols, act }), cols)
      assert.match(text, /Overview/, id)
      assert.match(text, /Conversations/, id)
    }
  }
  const todo = renderText(drawHub(kit(el, {}), { cfg: {}, tab: 'todo', model: m, columns: 90, act }), 90)
  assert.ok(todo.indexOf('Urgent') < todo.indexOf('Ongoing') && todo.indexOf('Ongoing') < todo.indexOf('On this computer'))
  assert.match(todo, /\[security\]/)
  const off = renderText(drawHub(kit(el, {}), { cfg: {}, tab: 'todo', model: null, error: 'offline here', columns: 60, act }), 60)
  assert.match(off, /offline here/)
  assert.ok(hubBar(kit(el, {}), { hub: { enabled: false } }, 'todo', m, act) === null)
})

test('the pane: a hub tab takes the whole width (no left menu)', () => {
  const m = hubModel(LOCAL, DATA, {}, { now: NOW })
  const act = { hubTab() {}, panneau() {}, refresh() {}, org() {}, run() {}, done() {} }
  const text = renderText(drawCockpit(el, { cfg: {}, fcfg: {}, tab: 'hub-fleet', columns: 80, hub: { model: m }, act }), 80)
  assert.match(text, /Computer one/)
  assert.doesNotMatch(text, /Jauge/)
})

test('the shapes the hub publishes since 12 Nov evening: quota providers list, journal text, lanes block, inbox orgs', () => {
  const data = {
    ...DATA,
    quota: { generated_at: '2026-01-02T11:58:00Z', providers: [{ id: 'codex', label: 'Codex', windows: [{ window: '7d', used_pct: 2, state: 'ok', account: 'plan' }] }] },
    journal: { name: '2026-01-02.md', date: '2026-01-02', text: '# Journal 2026-01-02\n\n\n## Day in short\n\n- One PR merged.', cut: true },
    lanes: { running: { jobs: [{ id: 5, machine: 'pc2', kind: 'ps', eta_ts: DATA.generated_ts + 60 }], lanes: [{ id: 'R9', title: 'Lane nine', owner: 'hub/pm' }], runner: { t: '2026-01-02T11:00:00Z', text: 'picked R9' } },
      presence: { last_active: '2026-01-02T10:00:00Z', away_hours: 2 } },
    inbox: { orgs: [{ id: 'acme', label: 'Acme' }, { id: 'secret', label: 'Secret', confidential: true }], confidential: ['secret'],
      todo_org: { 'pc1-urgent': 'acme', 'pc1-plain': 'secret' },
      items: [{ id: 'Q1', title: 'Pick a name', category: 'question', you: true, urgency: 'soon', priority: 'p1', org: 'acme' },
        { id: 'Q2', title: 'Hidden one', category: 'question', you: true, urgency: 'now', priority: 'p0', org: 'secret' },
        { id: 'X1', title: 'Not a question', category: 'issue', you: true, org: 'acme' }] },
  }
  const all = hubModel(LOCAL, data, {}, { now: NOW })
  assert.deepEqual(all.orgs.map((o) => o.id), ['acme', 'secret'])
  assert.equal(all.quota.hub[0].provider, 'Codex')
  assert.equal(all.journal.lines[0], '# Journal 2026-01-02')
  assert.ok(!all.journal.lines.includes('') || all.journal.lines.filter((l, i, a) => !l && !a[i - 1]).length === 0)
  assert.equal(all.lanes.lanes[0].id, 'R9')
  assert.equal(all.lanes.jobs[0].machine, 'Computer two')
  assert.match(all.lanes.presence, /away 2 h/)
  // confidential: hidden under All, shown in its own workspace
  assert.deepEqual(all.questions.inbox.map((q) => q.id), ['Q1'])
  assert.ok(!all.todo.all.some((t) => t.id === 'pc1-plain'))
  const sec = hubModel(LOCAL, data, {}, { now: NOW, org: 'secret' })
  assert.deepEqual(sec.questions.inbox.map((q) => q.id), ['Q2'])
  assert.ok(sec.todo.all.some((t) => t.id === 'pc1-plain'))
  assert.ok(!sec.todo.all.some((t) => t.id === 'pc1-urgent'))
  for (const id of ['questions', 'journal', 'lanes', 'quota']) {
    const text = renderText(drawHub(kit(el, {}), { cfg: {}, tab: id, model: all, columns: 70, act: { hubTab() {}, panneau() {}, refresh() {}, org() {}, run() {}, done() {} } }), 70)
    assert.match(text, /Workspace \[All\] \[Acme\] \[Secret\]/, id)
  }
})
