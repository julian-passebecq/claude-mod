// lib/core/activity.mjs on invented fixtures only: node --test tests/activity.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ACTIVITY_DEFAULTS, activityCounts, ciNow, mainThreadBusy, restingSince, toMs } from '../lib/core/activity.mjs'

const T = Date.parse('2026-10-21T15:36:00Z')
const MIN = 60000

test('mainThreadBusy: a turn in progress = written within busy_min and the last message did not end the turn', () => {
  assert.equal(ACTIVITY_DEFAULTS.busy_min, 2)
  // 28 s ago, a tool call pending: busy (Julian, 21 Oct 17:36)
  assert.equal(mainThreadBusy({ mtime: (T - 28000) / 1000, stop: 'tool_use' }, T), true)
  // the turn ended, or failed, or nothing written for 3 min: not busy
  assert.equal(mainThreadBusy({ mtime: (T - 28000) / 1000, stop: 'end_turn' }, T), false)
  assert.equal(mainThreadBusy({ mtime: (T - 28000) / 1000, stop: 'tool_use', api_error: true }, T), false)
  assert.equal(mainThreadBusy({ mtime: (T - 3 * MIN) / 1000, stop: 'tool_use' }, T), false)
  assert.equal(mainThreadBusy({ mtime: (T - 3 * MIN) / 1000, stop: 'tool_use' }, T, { busy_min: 5 }), true)
  // a prompt newer than the ended turn: a new turn started
  assert.equal(mainThreadBusy({ mtime: (T - 5000) / 1000, stop: 'end_turn', last_ts: new Date(T - 5000).toISOString(), last_prompt_ts: new Date(T - 5000).toISOString() }, T), true)
  // the engine's own flag wins
  assert.equal(mainThreadBusy({ busy: true, mtime: 0 }, T), true)
  assert.equal(mainThreadBusy({ busy: false, mtime: (T - 1000) / 1000, stop: 'tool_use' }, T), false)
  assert.equal(mainThreadBusy(null, T), false)
})

const CACHE = {
  generated: new Date(T - 2 * MIN).toISOString(),
  apps: [
    { app: 'repo-a', runs: [
      { backend: 'gh', status: 'running', branch: 'claude/x', created: new Date(T - 6 * MIN).toISOString(), jobs: [{ name: 'lint', status: 'success' }, { name: 'tests', status: 'running' }] },
      { backend: 'gh', status: 'success', branch: 'main', created: new Date(T - 60 * MIN).toISOString() },
    ] },
    { app: 'repo-b', runs: [{ backend: 'gl', status: 'running', branch: 'codex/y', created: new Date(T - 20 * MIN).toISOString(), jobs: [{ name: 'build', status: 'failed' }, { name: 'e2e', status: 'running' }] }] },
  ],
}

test('ciNow: the running pipelines with repo, branch, running job and elapsed time; a stale or missing cache is « not read »', () => {
  const c = ciNow(CACHE, T)
  assert.deepEqual([c.read, c.stale, c.running, c.failed, c.ageMs], [true, false, 2, 1, 2 * MIN])
  assert.deepEqual(c.list.map((x) => [x.repo, x.branch, x.job, x.ms / MIN, x.failed]), [['repo-b', 'codex/y', 'e2e', 20, true], ['repo-a', 'claude/x', 'tests', 6, false]])
  const old = ciNow({ ...CACHE, generated: new Date(T - 40 * MIN).toISOString() }, T)
  assert.deepEqual([old.read, old.stale, old.ageMs], [true, true, 40 * MIN])
  assert.equal(ciNow({ ...CACHE, generated: new Date(T - 40 * MIN).toISOString() }, T, { ci_stale_min: 60 }).stale, false)
  const none = ciNow(null, T)
  assert.deepEqual([none.read, none.stale, none.ageMs, none.running], [false, true, null, 0])
})

test('activityCounts: idle only when every count is zero and nothing is blocked; a stale CI is not a zero', () => {
  const fresh = ciNow({ generated: new Date(T - MIN).toISOString(), apps: [] }, T)
  assert.equal(activityCounts({ ci: fresh }).idle, true)
  assert.equal(activityCounts({ convs: 1, ci: fresh }).idle, false)
  assert.equal(activityCounts({ blocked: 1, ci: fresh }).idle, false)
  assert.equal(activityCounts({ ci: ciNow(CACHE, T) }).ci, 2)
  const stale = activityCounts({ ci: ciNow(CACHE, T + 60 * MIN) })
  assert.deepEqual([stale.ci, stale.ciStale, stale.idle], [0, true, true])
  assert.equal(activityCounts().ciStale, true)
})

test('restingSince and toMs', () => {
  assert.deepEqual(restingSince([{ name: 'a', at: T - 30 * MIN }, { name: 'b', at: new Date(T - 12 * MIN).toISOString() }, null], T), { name: 'b', at: T - 12 * MIN, ago: 12 * MIN })
  assert.equal(restingSince([], T), null)
  assert.deepEqual([toMs(1700000000), toMs(1700000000000), toMs(''), toMs('nope')], [1700000000000, 1700000000000, 0, 0])
})
