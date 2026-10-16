// veille logic: node --test mods/veille/tests/logic.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  modeOf, modeName, may, inQuietHours, tourDue, gapOf, watcherState, alertsOf, reconcile, plan, due, markSent, budgetLeft,
  repoAllowed, ghEligible, glEligible, mergeCandidates, wakeDecision, brief, scrub, deepMerge,
} from '../lib/core.mjs'
import { viewModel, bandLine, eventText } from '../hooks/view.mjs'
import { taskXml, BIN_FILES } from '../watcher/veille.mjs'

const BASE = JSON.parse(readFileSync(new URL('../veille.config.json', import.meta.url), 'utf8'))
const cfgOf = (over = {}) => deepMerge(BASE, over)
const NOW = Date.parse('2026-10-16T12:00:00Z')
const MIN = 60000

test('each mode lists exactly what it may do', () => {
  const allowed = (m, over = {}) => ['alert', 'notify', 'notify_julian', 'mail', 'push_claude', 'merge', 'wake'].filter((a) => may(cfgOf({ mode: m, ...over }), a))
  assert.deepEqual(allowed('rien'), [])
  assert.deepEqual(allowed('légère'), ['alert', 'notify', 'mail'])
  assert.deepEqual(allowed('active'), ['alert', 'notify', 'mail'], 'wake stays off until wake.enabled')
  assert.deepEqual(allowed('active', { wake: { enabled: true } }), ['alert', 'notify', 'mail', 'wake'])
  assert.deepEqual(allowed('nuit-active'), ['alert', 'notify_julian', 'mail', 'merge'])
  assert.deepEqual(allowed('nuit-test-légère'), ['alert', 'notify', 'mail'], 'push_claude stays off until push.claude')
  assert.deepEqual(allowed('nuit-test-légère', { push: { claude: true } }), ['alert', 'notify', 'mail', 'push_claude'])
  for (const m of ['légère', 'nuit-test-légère']) assert.ok(!may(cfgOf({ mode: m, wake: { enabled: true } }), 'merge'))
  assert.equal(modeOf(cfgOf({ mode: 'inconnu' })).name, 'rien', 'an unknown mode does nothing')
  assert.equal(modeName(BASE, 'LEGERE'), 'légère')
  assert.equal(modeName(BASE, 'nuit-test-legere'), 'nuit-test-légère')
  assert.equal(modeOf(cfgOf({ mode: 'légère' })).interval_min, 30)
  assert.equal(modeOf(cfgOf({ mode: 'active' })).interval_min, 5)
})

test('quiet hours wrap past midnight; tours are due by the mode interval', () => {
  const at = (h, m) => new Date(2026, 9, 16, h, m)
  assert.ok(inQuietHours('23:00-07:30', at(23, 30)))
  assert.ok(inQuietHours('23:00-07:30', at(3, 0)))
  assert.ok(!inQuietHours('23:00-07:30', at(7, 30)))
  assert.ok(!inQuietHours('23:00-07:30', at(12, 0)))
  assert.ok(inQuietHours('12:00-13:00', at(12, 59)))
  assert.ok(!inQuietHours('', at(3, 0)))
  const legere = modeOf(cfgOf({ mode: 'légère' }))
  assert.ok(tourDue(legere, 0, NOW))
  assert.ok(!tourDue(legere, NOW - 20 * MIN, NOW))
  assert.ok(tourDue(legere, NOW - 30 * MIN, NOW))
  assert.ok(!tourDue(modeOf(cfgOf({ mode: 'rien' })), 0, NOW))
})

test('missed tours: a gap of more than two fires is detected; the pane goes red', () => {
  assert.equal(gapOf(0, NOW, 5), null)
  assert.equal(gapOf(NOW - 6 * MIN, NOW, 5), null)
  assert.deepEqual(gapOf(NOW - 12 * MIN, NOW, 5), { from: NOW - 12 * MIN, to: NOW })
  const cfg = cfgOf({ installed: true })
  assert.equal(watcherState({ last_fire: NOW - 4 * MIN, last_tour: NOW - 4 * MIN }, cfg, NOW).state, 'ok')
  assert.equal(watcherState({ last_fire: NOW - 12 * MIN }, cfg, NOW).state, 'stopped')
  assert.equal(watcherState(null, cfg, NOW).state, 'stopped')
  assert.equal(watcherState({ last_fire: NOW }, cfgOf(), NOW).state, 'not_installed')
  const vm = viewModel(cfgOf({ installed: true, mode: 'légère' }), {}, { last_fire: NOW - 40 * MIN, last_tour: NOW - 40 * MIN }, [], NOW)
  assert.equal(vm.watcher.tone, 'bad')
  assert.match(vm.watcher.text, /VEILLE ARRÊTÉE/)
  assert.equal(bandLine(vm, BASE)[1].tone, 'bad')
  const off = viewModel(cfgOf({ installed: true, mode: 'rien' }), {}, { last_fire: NOW - 40 * MIN }, [], NOW)
  assert.notEqual(off.watcher.tone, 'bad', 'rien: a silent watcher is expected')
})

const session = (o) => ({ cli: 'c1', sid: 'local_1', app_title: 'Lane A', cwd: 'C:/code/a', last_activity: (NOW - 60 * MIN) / 1000, live: false, ...o })
const SCAN = {
  sessions: [
    session({ cli: 'c1', needs_action: 'Choisir le nom du produit', status_category: 'blocked' }),
    session({ cli: 'c2', sid: 'local_2', app_title: 'Lane B', pr: { url: 'https://github.com/julian-passebecq/x/pull/7', number: 7, repo: 'julian-passebecq/x' } }),
    session({ cli: 'c3', sid: 'local_3', app_title: 'Lane C', subs: [{ workflow: 'wf1', status: 'stopped', last_ts: '2026-10-16T10:00:00Z' }] }),
  ],
  reviews: { items: [
    { provider: 'github', repo: 'julian-passebecq/x', number: 7, url: 'https://github.com/julian-passebecq/x/pull/7', ci: 'success', conflict: false, green_since: (NOW - 90 * MIN) / 1000, title: 'Feature' },
    { provider: 'github', repo: 'someone/else', number: 2, url: 'https://github.com/someone/else/pull/2', ci: 'success', conflict: false, green_since: (NOW - 90 * MIN) / 1000, title: 'Other' },
    { provider: 'gitlab', repo: 'juliandatapass-group/y', number: 3, url: 'https://gitlab.com/juliandatapass-group/y/-/merge_requests/3', ci: 'skipped', conflict: false, title: 'Skipped' },
  ], errors: [] },
}

test('alerts reuse the factory rows and add veille kinds with severities', () => {
  const alerts = alertsOf(SCAN, cfgOf(), NOW)
  const kinds = alerts.map((a) => a.kind).sort()
  assert.deepEqual(kinds, ['green', 'green', 'needs', 'workflow'])
  const needs = alerts.find((a) => a.kind === 'needs')
  assert.equal(needs.severity, 'julian')
  assert.equal(needs.julian, true)
  assert.equal(needs.title, 'Lane A')
  assert.equal(alerts.find((a) => a.kind === 'workflow').severity, 'bad')
  assert.ok(alertsOf(SCAN, cfgOf(), NOW, [{ key: 'missed:1', kind: 'missed', what: 'x' }]).some((a) => a.kind === 'missed' && a.severity === 'bad'))
})

test('dedup: a row is announced once, mail and push at most once per repeat window, acks silence it', () => {
  const cfg = cfgOf({ mode: 'légère' })
  const day = new Date(2026, 9, 16, 12, 0)
  const a1 = alertsOf(SCAN, cfg, NOW)
  const r1 = reconcile({}, a1, [], NOW)
  assert.equal(r1.fresh.length, a1.length)
  const p1 = plan(Object.values(r1.alerts), r1.fresh.map((a) => r1.alerts[a.key]), cfg, {}, NOW, day)
  assert.equal(p1.notify.length, a1.length)
  assert.deepEqual(p1.mail.map((a) => a.kind), ['needs'])
  const sent = markSent({}, 'mail', p1.mail.map((a) => a.key), NOW)
  const r2 = reconcile({ alerts: r1.alerts }, a1, [], NOW + 30 * MIN)
  assert.equal(r2.fresh.length, 0, 'same rows: nothing new')
  const p2 = plan(Object.values(r2.alerts), [], cfg, { sent }, NOW + 30 * MIN, day)
  assert.equal(p2.notify.length, 0)
  assert.equal(p2.mail.length, 0, 'within repeat_h: no second e-mail')
  const p3 = plan(Object.values(r2.alerts), [], cfg, { sent }, NOW + 7 * 3600000, day)
  assert.equal(p3.mail.length, 1, 'after repeat_h: reminded')
  const r4 = reconcile({ alerts: r2.alerts }, a1, [p1.mail[0].key], NOW + 7 * 3600000)
  assert.equal(plan(Object.values(r4.alerts), [], cfg, { sent }, NOW + 7 * 3600000, day).mail.length, 0, 'acked: silent')
  assert.ok(due({}, 'mail', 'k', NOW, 6))
  assert.ok(!due({ mail: { k: NOW - MIN } }, 'mail', 'k', NOW, 6))
  const r5 = reconcile({ alerts: r1.alerts }, a1.filter((a) => a.kind !== 'needs'), [], NOW)
  assert.equal(r5.gone.length, 1)
})

test('quiet hours and nuit-active: only what needs Julian is notified', () => {
  const night = new Date(2026, 9, 16, 2, 0)
  const a = alertsOf(SCAN, cfgOf(), NOW)
  for (const cfg of [cfgOf({ mode: 'légère' }), cfgOf({ mode: 'nuit-active' })]) {
    const r = reconcile({}, a, [], NOW)
    const p = plan(Object.values(r.alerts), r.fresh.map((x) => r.alerts[x.key]), cfg, {}, NOW, night)
    assert.deepEqual(p.notify.map((x) => x.kind), ['needs'])
  }
  const r = reconcile({}, a, [], NOW)
  const day = plan(Object.values(r.alerts), r.fresh.map((x) => r.alerts[x.key]), cfgOf({ mode: 'nuit-active' }), {}, NOW, new Date(2026, 9, 16, 12, 0))
  assert.deepEqual(day.notify.map((x) => x.kind), ['needs'], 'nuit-active notifies only needs-Julian, day or night')
})

test('token budget per hour', () => {
  assert.equal(budgetLeft([], 100000, NOW), 100000)
  assert.equal(budgetLeft([{ at: NOW - 10 * MIN, tokens: 70000 }, { at: NOW - 70 * MIN, tokens: 90000 }], 100000, NOW), 30000)
  assert.equal(budgetLeft([{ at: NOW, tokens: 500000 }], 100000, NOW), 0)
})

// ---- merge eligibility -----------------------------------------------------------------------------------------------

const SHA = 'abc123'
const ok = { repo: 'julian-passebecq/x', merge: BASE.merge, now: NOW, ownerLive: false, seen: { sha: SHA, since: NOW - 40 * MIN } }
const ghPr = (o = {}) => ({ state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', headRefOid: SHA, baseRefName: 'main', title: 'Feature', labels: [],
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'SUCCESS' }], ...o })

test('GitHub: merge only when every check is success, up to date, stable, owner idle, repo allowed', () => {
  assert.ok(ghEligible(ghPr(), { behind_by: 0 }, ok).ok)
  const no = (pr, cmp, ctx, re) => { const v = ghEligible(pr, cmp, ctx); assert.equal(v.ok, false); assert.match(v.why.join(' ; '), re) }
  no(ghPr({ statusCheckRollup: [] }), { behind_by: 0 }, ok, /aucun check/)
  no(ghPr({ statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'SKIPPED' }] }), { behind_by: 0 }, ok, /skipped/)
  no(ghPr({ statusCheckRollup: [{ __typename: 'CheckRun', name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'CheckRun', name: 'b', status: 'COMPLETED', conclusion: 'SKIPPED' }] }), { behind_by: 0 }, ok, /b skipped/)
  no(ghPr({ statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'CANCELLED' }] }), { behind_by: 0 }, ok, /cancelled/)
  no(ghPr({ statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'NEUTRAL' }] }), { behind_by: 0 }, ok, /neutral/)
  no(ghPr({ statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'IN_PROGRESS', conclusion: '' }] }), { behind_by: 0 }, ok, /en cours/)
  no(ghPr({ statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci/gitlab', state: 'PENDING' }] }), { behind_by: 0 }, ok, /pending/)
  assert.ok(ghEligible(ghPr({ statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci/gitlab', state: 'SUCCESS' }] }), { behind_by: 0 }, ok).ok, 'old-style status: state')
  no(ghPr(), { behind_by: 2 }, ok, /en retard de 2/)
  no(ghPr(), null, ok, /retard sur la base inconnu/)
  no(ghPr({ mergeable: 'CONFLICTING' }), { behind_by: 0 }, ok, /mergeable=CONFLICTING/)
  no(ghPr({ isDraft: true }), { behind_by: 0 }, ok, /brouillon/)
  no(ghPr({ labels: [{ name: 'no-merge' }] }), { behind_by: 0 }, ok, /ne pas merger/)
  no(ghPr({ title: '[WIP] thing' }), { behind_by: 0 }, ok, /ne pas merger/)
  no(ghPr(), { behind_by: 0 }, { ...ok, repo: 'someone/else' }, /hors liste/)
  no(ghPr(), { behind_by: 0 }, { ...ok, ownerLive: true }, /travaille/)
  no(ghPr(), { behind_by: 0 }, { ...ok, seen: { sha: SHA, since: NOW - 5 * MIN } }, /stable depuis moins/)
  no(ghPr(), { behind_by: 0 }, { ...ok, seen: { sha: 'other', since: NOW - 90 * MIN } }, /jamais vue/)
  no(ghPr(), { behind_by: 0 }, { ...ok, seen: null }, /jamais vue/)
})

const glMr = (o = {}) => ({ state: 'opened', draft: false, has_conflicts: false, diverged_commits_count: 0, sha: SHA, title: 'MR', labels: [], target_branch: 'main',
  head_pipeline: { id: 9, status: 'success', sha: SHA }, ...o })
const job = (status, name = 'test') => ({ name, status })

test('GitLab: skipped, cancelled, manual or zero-job pipelines never merge (incident A4)', () => {
  const ctx = { ...ok, repo: 'juliandatapass-group/y' }
  assert.ok(glEligible(glMr(), [job('success'), job('success', 'lint')], ctx).ok)
  const no = (mr, jobs, re) => { const v = glEligible(mr, jobs, ctx); assert.equal(v.ok, false); assert.match(v.why.join(' ; '), re); return v }
  no(glMr({ head_pipeline: { id: 9, status: 'skipped', sha: SHA } }), [], /pipeline skipped/)
  no(glMr(), [], /sans job/)
  no(glMr(), [job('success'), job('skipped', 'deploy')], /deploy skipped/)
  no(glMr(), [job('canceled')], /canceled/)
  assert.ok(no(glMr(), [job('success'), job('manual', 'release')], /release manual/).manual)
  no(glMr({ head_pipeline: null }), null, /aucun pipeline/)
  no(glMr({ head_pipeline: { id: 9, status: 'success', sha: 'old' } }), [job('success')], /autre commit/)
  no(glMr({ diverged_commits_count: 3 }), [job('success')], /en retard de 3/)
  no(glMr({ diverged_commits_count: undefined }), [job('success')], /inconnu/)
  no(glMr({ has_conflicts: true }), [job('success')], /conflit/)
  no(glMr({ draft: true }), [job('success')], /brouillon/)
})

test('merge candidates: green, no conflict, in the allow-list (base repo owner)', () => {
  assert.deepEqual(mergeCandidates(SCAN, cfgOf()).map((r) => r.number), [7])
  assert.ok(repoAllowed('julian-passebecq/claude-mod', BASE.merge.repos))
  assert.ok(!repoAllowed('julian-passebecq-evil/x', BASE.merge.repos))
  assert.ok(!repoAllowed('julian-passebecq', BASE.merge.repos))
})

// ---- wake ----------------------------------------------------------------------------------------------------------------

test('wake: off by default, coordinator only, budgeted, at most twice per row, never a live session', () => {
  const alert = { key: 'idle:c2:x', kind: 'idle', what: 'Aucun tour depuis 1 h alors que x#7 est rouge', title: 'Lane B', cli: 'c2', since: NOW - 60 * MIN }
  const scan = { sessions: [...SCAN.sessions, session({ cli: 'coord', app_title: 'COORD', ctx: 120000 })] }
  assert.equal(wakeDecision(alert, scan, cfgOf({ mode: 'active' }), {}, NOW).ok, false, 'wake.enabled false')
  const cfg = cfgOf({ mode: 'active', wake: { enabled: true }, coordinator_session: 'coord' })
  const d = wakeDecision(alert, scan, cfg, {}, NOW)
  assert.equal(d.ok, true)
  assert.equal(d.target.cli, 'coord')
  assert.equal(d.tokens, 120000)
  assert.equal(wakeDecision(alert, scan, cfgOf({ mode: 'légère', wake: { enabled: true }, coordinator_session: 'coord' }), {}, NOW).ok, false, 'légère never wakes')
  assert.match(wakeDecision(alert, scan, cfgOf({ mode: 'active', wake: { enabled: true } }), {}, NOW).why, /coordinateur/)
  const liveScan = { sessions: [session({ cli: 'coord', live: true })] }
  assert.match(wakeDecision(alert, liveScan, cfg, {}, NOW).why, /active/)
  assert.match(wakeDecision(alert, scan, cfg, { wakes: { [alert.key]: [NOW - 30 * MIN] } }, NOW).why, /récemment/)
  assert.equal(wakeDecision(alert, scan, cfg, { wakes: { [alert.key]: [NOW - 5 * 3600000, NOW - 3 * 3600000] } }, NOW).why, 'exhausted')
  assert.match(wakeDecision(alert, scan, cfg, { spent: [{ at: NOW - MIN, tokens: 550000 }] }, NOW).why, /budget/)
  assert.equal(wakeDecision({ ...alert, acked: true }, scan, cfg, {}, NOW).ok, false)
  const own = wakeDecision(alert, scan, cfgOf({ mode: 'active', wake: { enabled: true, target: 'owner' } }), {}, NOW)
  assert.equal(own.target.cli, 'c2')
})

test('the wake brief is at most 10 lines and states the hard limits', () => {
  const b = brief({ key: 'k', kind: 'idle', what: 'x', title: 'Lane', cli: 'c', link: 'https://e/1', since: NOW - MIN }, cfgOf({ mode: 'nuit-active' }), NOW, 'node veille.mjs ack')
  assert.ok(b.split('\n').length <= 10)
  assert.match(b, /force-push/)
  assert.match(b, /ack k$/m)
})

// ---- secrets ----------------------------------------------------------------------------------------------------------

test('scrub removes the SMTP password, its base64 and token-like strings', () => {
  const pw = 'abcd efgh ijkl mnop'
  const t = scrub(`fail ${pw} ${Buffer.from(pw).toString('base64')} ghp_${'a'.repeat(30)} glpat-${'b'.repeat(20)}`, [pw])
  assert.doesNotMatch(t, /abcd efgh|ghp_a|glpat-b/)
  assert.doesNotMatch(t, new RegExp(Buffer.from(pw).toString('base64')))
})

test('view: alerts sorted by severity, acked last; events in French', () => {
  const st = { alerts: {
    a: { key: 'a', kind: 'green', severity: 'warn', what: 'verte', since: NOW - 10 * MIN },
    b: { key: 'b', kind: 'needs', severity: 'julian', julian: true, what: 'attend', since: NOW - 5 * MIN },
    c: { key: 'c', kind: 'idle', severity: 'bad', what: 'rouge', since: NOW - 50 * MIN },
  }, mail: 'not_configured' }
  const vm = viewModel(cfgOf({ installed: true }), st, { last_fire: NOW - MIN, last_tour: NOW - MIN }, ['c'], NOW)
  assert.deepEqual(vm.alerts.map((a) => a.key), ['b', 'a', 'c'])
  assert.equal(vm.julian, 1)
  assert.equal(vm.mail, 'e-mail non configuré')
  assert.match(bandLine(vm, BASE).map((p) => p.text).join(' · '), /Veille : Légère · tour \d\d:\d\d .* · 1 attend\(ent\) Julian/)
  assert.match(eventText({ at: NOW, kind: 'merged', pr: 'x#7', reason: 'ok' }), /mergée : x#7/)
})

test('task XML: per-user, no admin, every 5 min, one instance, own time limit', () => {
  const x = taskXml({ user: 'PC\\me', command: 'C:\\Windows\\System32\\wscript.exe', args: '//B "a&b.vbs"', everyMin: 5, start: '2026-10-16T12:00:00' })
  assert.match(x, /<LogonType>InteractiveToken<\/LogonType>/)
  assert.match(x, /<RunLevel>LeastPrivilege<\/RunLevel>/)
  assert.match(x, /<Interval>PT5M<\/Interval>/)
  assert.match(x, /IgnoreNew/)
  assert.match(x, /<StartWhenAvailable>true/)
  assert.match(x, /a&amp;b\.vbs/)
  assert.ok(BIN_FILES.includes('factory/hooks/waiting.mjs'), 'the installed copy carries the factory library it imports')
})
