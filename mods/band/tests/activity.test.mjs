// band: the activity status at the start of the Jauge (« ▶ 1 conv · 0 wf · 0 ag · 0 CI » / « ✓ au repos »), from
// lib/core/busy.mjs (this mod's synced copy). Invented fixtures only.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { busyCounts, ciActivity, feedTurn, resting, turnBusy } from '../lib/core/busy.mjs'
import { actFields, fitLine, jaugeCfg } from '../hooks/jauge.ts'
import { activityOf } from '../scanner/scan.mjs'

const NOW = Date.parse('2026-10-21T15:00:00Z')
const iso = (ms) => new Date(ms).toISOString()
const S = 1000
const MIN = 60000

const turnOf = (entries) => entries.reduce((t, e) => feedTurn(t, e), undefined)
const user = (t, text = 'demo prompt') => ({ type: 'user', timestamp: iso(t), message: { role: 'user', content: text } })
const asst = (t, stop) => ({ type: 'assistant', timestamp: iso(t), message: { model: 'claude-opus-5-5', stop_reason: stop, content: [] } })

test('feedTurn: a prompt or a tool call opens the turn, a final answer closes it', () => {
  assert.equal(turnOf([user(NOW - 28 * S)]).open, true)
  assert.equal(turnOf([user(NOW - 40 * S), asst(NOW - 30 * S, 'tool_use')]).open, true)
  assert.equal(turnOf([user(NOW - 40 * S), asst(NOW - 30 * S, 'end_turn')]).open, false)
  assert.equal(turnOf([user(NOW - 40 * S), user(NOW - 30 * S, '[Request interrupted by user]')]).open, false)
  // entries after the answer (titles, system rows) and sidechain rows do not reopen it
  const t = turnOf([user(NOW - 40 * S), asst(NOW - 30 * S, 'end_turn'), { type: 'custom-title', customTitle: 'x' }, { ...user(NOW - 5 * S), isSidechain: true }])
  assert.equal(t.open, false)
  assert.equal(t.last, NOW - 30 * S)
})

test('turnBusy: open and written within busy_s', () => {
  assert.equal(turnBusy({ open: true, last: NOW - 28 * S }, NOW), true)
  assert.equal(turnBusy({ open: true, last: NOW - 3 * MIN }, NOW), false)
  assert.equal(turnBusy({ open: false, last: NOW - 5 * S }, NOW), false)
  assert.equal(turnBusy(undefined, NOW), false)
})

test('busyCounts: busy main threads, Workflows and agents of the whole PC, the last one finished', () => {
  const sessions = {
    'sess-a': { turn: { open: true, last: NOW - 28 * S }, title: 'demo-busy' },
    'sess-b': { turn: { open: false, last: NOW - 7 * MIN }, title: 'demo-done' },
    'sess-c': { turn: { open: false, last: NOW - 20 * MIN }, title: 'older' },
  }
  const events = [
    { t: NOW - 30 * S, s: 'sess-a', a: 'w1', w: 'wf_demo' },
    { t: NOW - 20 * S, s: 'sess-a', a: 'w2', w: 'wf_demo' },
    { t: NOW - 10 * S, s: 'sess-b', a: 'bg1' },
    { t: NOW - 10 * MIN, s: 'sess-c', a: 'old' },
    { t: NOW - 5 * S, s: 'sess-a' },
  ]
  const c = busyCounts({ sessions, events, now: NOW })
  assert.equal(c.convs, 1)
  assert.deepEqual(c.busy, ['sess-a'])
  assert.equal(c.workflows, 1)
  assert.equal(c.agents, 3)
  assert.deepEqual(c.lastDone, { s: 'sess-b', title: 'demo-done', t: NOW - 7 * MIN })
  assert.equal(resting(c), false)
  assert.equal(resting({ ...busyCounts({ sessions: { x: sessions['sess-b'] }, events: [], now: NOW }), ci: { stale: false, running: 0 } }), true)
})

test('ciActivity: running + queued, stale when the cache is old or has no date, unavailable without apps', () => {
  const cache = (genAgo) => ({
    generated: iso(NOW - genAgo),
    apps: [{ app: 'demo-app', runs: [{ status: 'running' }, { status: 'queued' }, { status: 'success' }, { status: 'failed', created: iso(NOW - 9 * MIN), duration_s: 120 }] }],
  })
  const fresh = ciActivity(cache(2 * MIN), NOW)
  assert.equal(fresh.running, 2)
  assert.equal(fresh.failed, 1)
  assert.equal(fresh.stale, false)
  assert.equal(ciActivity(cache(40 * MIN), NOW).stale, true)
  assert.equal(ciActivity({ apps: [] }, NOW).stale, true)
  assert.equal(ciActivity(null, NOW).available, false)
})

const L = jaugeCfg({}).labels
const texts = (fs) => fs.map((f) => `${f.text}:${f.tone}`)

test('actFields busy: « ▶ 1 conv · 0 wf · 0 ag · 0 CI », zeros grey, non-zero green / amber / red', () => {
  assert.deepEqual(texts(actFields({ convs: 1, workflows: 0, agents: 0, ci: { running: 0, failed: 0, stale: false } }, L)), ['▶ 1 conv:ok', '0 wf:dim', '0 ag:dim', '0 CI:dim'])
  assert.deepEqual(texts(actFields({ convs: 1, workflows: 1, agents: 3, wfTone: 'warn', agTone: 'bad', ci: { running: 2, failed: 0, stale: false } }, L)), ['▶ 1 conv:ok', '1 wf:warn', '3 ag:bad', '2 CI:ok'])
  assert.deepEqual(texts(actFields({ convs: 0, workflows: 0, agents: 0, ci: { running: 1, failed: 1, stale: false } }, L)), ['▶ 0 conv:dim', '0 wf:dim', '0 ag:dim', '1 CI:bad'])
})

test('actFields idle: one green « ✓ au repos »', () => {
  assert.deepEqual(texts(actFields({ convs: 0, workflows: 0, agents: 0, ci: { running: 0, failed: 0, stale: false } }, L)), ['✓ au repos:ok'])
  assert.deepEqual(texts(actFields({ convs: 0, workflows: 0, agents: 0 }, L)), ['✓ au repos:ok'])
  assert.deepEqual(actFields(undefined, L), [])
})

test('actFields stale CI cache: « CI ? » grey, never « 0 CI »', () => {
  assert.deepEqual(texts(actFields({ convs: 1, workflows: 0, agents: 0, ci: { running: 3, failed: 0, stale: true } }, L)), ['▶ 1 conv:ok', '0 wf:dim', '0 ag:dim', 'CI ?:dim'])
  assert.deepEqual(texts(actFields({ convs: 0, workflows: 0, agents: 0, ci: { running: 0, failed: 0, stale: true } }, L)), ['✓ au repos:ok', 'CI ?:dim'])
})

test('the line starts with the status; tok/s goes first when narrow, the status stays', () => {
  const cfg = JSON.parse(JSON.stringify({ line1: ['activity', '|', 'waiting', '|', 'context', '|', 'five', '|', 'week', '|', 'tps_all'], drop_order: ['tps_all', 'five', 'week'] }))
  const jc = jaugeCfg(cfg)
  const f = { relayAt: 250000, relayPct: 62.5, waiting: 0, ctxPct: 19, five: 3, week: 41, tps: { tps_all: 4400 }, act: { convs: 1, workflows: 0, agents: 0, ci: { running: 0, failed: 0, stale: false } } }
  const wide = fitLine(jc.line1, f, jc, 120)
  assert.match(wide.text, /^▶ 1 conv · 0 wf · 0 ag · 0 CI │ ctx /)
  assert.match(wide.text, /tok\/s$/)
  const narrow = fitLine(jc.line1, f, jc, 60)
  assert.ok(narrow.dropped.includes('tps_all'))
  assert.match(narrow.text, /^▶ 1 conv · 0 wf · 0 ag · 0 CI/)
  assert.ok([...narrow.text].length <= 60, narrow.text)
  const idle = fitLine(jc.line1, { ...f, act: { convs: 0, workflows: 0, agents: 0 } }, jc, 120)
  assert.match(idle.text, /^✓ au repos │ ctx /)
})

test('activityOf (scanner): counts from the cache, thisBusy, CI from the ci cache or off', () => {
  const cache = {
    sessions: { 'sess-a': { s: 'sess-a', turn: { open: true, last: NOW - 28 * S }, title: 'demo' }, 'sess-b': { s: 'sess-b', turn: { open: false, last: NOW - 4 * MIN } } },
    events: [{ t: NOW - 30 * S, s: 'sess-b', a: 'bg1' }],
  }
  const ci = { available: true, running: 0, queued: 0, failed: 0, age_ms: 60000, stale: false }
  const a = activityOf(cache, { jauge: {} }, NOW, { readCi: () => ci }, 'sess-a')
  assert.equal(a.convs, 1)
  assert.equal(a.thisBusy, true)
  assert.equal(a.agents, 1)
  assert.equal(a.workflows, 0)
  assert.deepEqual(a.ci, ci)
  assert.equal(activityOf(cache, { jauge: { activity: { ci_cache: '' } } }, NOW, { readCi: () => ci }, 'sess-b').ci, undefined)
})
