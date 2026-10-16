// usage mod: parser on synthetic transcripts, forecast math, Plein régime threshold.
//   node --test mods/usage/tests/logic.test.mjs
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { aggregate, costOf, feedLine, kindOfPath, newFileState, priceFor, projectOf, tokensOf, usageOf } from '../lib/transcripts.mjs'
import { scanProjects } from '../lib/scan-node.mjs'
import {
  HOUR, burnRates, calibrate, deepMerge, forecast, heatRow, model, outcome, periodView, pleinRegime, projections, promptLine,
  readings, scenarioFit, statusText, sumRange, when,
} from '../hooks/logic.mjs'
import { addSample, readSamples } from '../scanner/usage_scan.mjs'
import { T0, assistant, tree, write } from './fixture.mjs'
import './codex.test.mjs' // the Codex tab's tests run with this file (CI runs logic.test.mjs)

const here = new URL('..', import.meta.url)
const prices = JSON.parse(readFileSync(new URL('lib/prices.json', here), 'utf8'))
const cfg = JSON.parse(readFileSync(new URL('usage.config.json', here), 'utf8'))
const shipped = JSON.parse(readFileSync(new URL('../scenarios/scenarios.json', here), 'utf8'))
const tmp = mkdtempSync(join(tmpdir(), 'usage-test-'))
after(() => rmSync(tmp, { recursive: true, force: true }))
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

test('paths, projects and prices', () => {
  assert.equal(kindOfPath('P/s.jsonl'), 'main')
  assert.equal(kindOfPath('P/s/subagents/agent-1.jsonl'), 'subagent')
  assert.equal(kindOfPath('P\\s\\subagents\\workflows\\wf_1\\agent-2.jsonl'), 'workflow')
  assert.equal(kindOfPath('P/s/subagents/workflows/wf_1/journal.jsonl'), 'journal')
  assert.equal(projectOf('C:\\code\\app-one\\.claude\\worktrees\\lane-1'), 'app-one')
  assert.equal(projectOf('/srv/x/app-two/'), 'app-two')
  assert.equal(priceFor('claude-opus-5-5-20261001', prices).in, 4)
  assert.equal(priceFor('some-sonnet-preview', prices).out, 10)
  assert.equal(priceFor('unknown', prices).in, 4) // default
  for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']) assert.ok(prices.models[id], id)
  close(costOf([100, 50, 1000, 0, 200, 1, 0, 0], 'claude-opus-5-5', prices), 0.0032)
  close(costOf([100, 50, 1000, 0, 200, 1, 0, 0], 'claude-haiku-5-5', prices), 85e-6)
  close(costOf([200000, 0, 0, 0, 0, 1, 0, 0], 'claude-haiku-5-5', prices), 0.1) // over 100K: the upper tier
})

test('usageOf reads the four token kinds and skips synthetic rows', () => {
  const r = usageOf(JSON.parse(assistant({ id: 'a', req: 'b', ts: T0, cw5: 7, skill: 'handoff', mcp: 'github' })))
  assert.deepEqual(r.v.slice(0, 6), [100, 50, 1000, 7, 200, 1])
  assert.equal(r.key, 'a|b')
  assert.equal(r.skill, 'handoff')
  assert.equal(r.mcp, 'github')
  assert.equal(usageOf({ type: 'assistant', timestamp: '2026-10-14T08:00:00Z', message: { model: '<synthetic>', usage: {} } }), null)
  assert.equal(usageOf({ type: 'user' }), null)
})

test('feedLine: a request repeated in one file counts once, with its last figures', () => {
  const st = newFileState()
  feedLine(st, assistant({ id: 'm', req: 'r', ts: T0, out: 10 }), { prices })
  feedLine(st, assistant({ id: 'm', req: 'r', ts: T0, out: 50 }), { prices })
  const rows = Object.values(st.rows)
  assert.equal(rows.length, 1)
  assert.equal(rows[0][1], 50)
  assert.equal(rows[0][5], 1)
})

test('scanProjects + aggregate on the fixture tree: kinds, projects, surfaces, skills, MCP, sessions, active time', () => {
  const root = join(tmp, 'projects')
  tree(root)
  const cache = { version: 1, files: {} }
  const now = T0 + 2 * HOUR
  const r1 = scanProjects({ root, cache, prices, now })
  assert.equal(r1.read, 5)
  const a = aggregate(cache.files, { now, tzMin: 0, surfaces: cfg.surfaces })
  const d = a.days['2026-10-14']
  assert.equal(d.total[5], 7) // 3 main + 2 subagent + 1 workflow + 1 sub-conversation; synthetic and duplicate left out
  assert.equal(tokensOf(d.kind.main), 3 * 1350)
  assert.equal(d.kind.subagent[5], 2)
  assert.equal(d.kind.workflow[5], 1)
  assert.equal(d.kind.subconversation[5], 1)
  assert.deepEqual(Object.keys(d.project).sort(), ['app-one', 'app-two'])
  assert.equal(d.surface['Onglet Code (app)'][5], 6)
  assert.equal(d.surface.CLI[5], 1)
  assert.equal(d.skill.handoff[5], 1)
  assert.equal(d.mcp.github[5], 1)
  close(d.model['claude-opus-5-5'][7], 4 * 0.0032)
  close(d.model['claude-haiku-5-5'][7], 2 * 85e-6)
  close(d.model['claude-sonnet-5-5'][7], 1600e-6)
  assert.equal(a.sessions['sess-a'].title, 'App one lane')
  assert.equal(a.sessions['sess-b'].kind, 'subconversation')
  assert.equal(a.rates['main|opus'][6], 120 + 300) // gaps between requests, each capped at idle_gap_s
  assert.equal(a.rates['subagent|haiku'][6], 120)

  // incremental: an append is read alone; a partial last line waits; a fork repeating a request does not count twice
  const before = cache.files['C--code-app-two/sess-b.jsonl'].offset
  appendFileSync(join(root, 'C--code-app-two/sess-b.jsonl'), assistant({ id: 'b2', req: 'rb2', ts: T0 + 62 * 60000, session: 'sess-b' }) + '\n{"type":"assist')
  write(root, 'C--code-app-one/fork.jsonl', [assistant({ id: 'm2', req: 'r2', ts: T0 + 3 * 60000 })])
  const r2 = scanProjects({ root, cache, prices, now })
  assert.equal(r2.read, 2)
  assert.ok(cache.files['C--code-app-two/sess-b.jsonl'].offset > before)
  const a2 = aggregate(cache.files, { now, tzMin: 0 })
  assert.equal(a2.days['2026-10-14'].total[5], 8)

  // retention: a file not touched for longer than retentionDays is not read and leaves the cache
  const r3 = scanProjects({ root, cache, prices, now: now + 30 * 86400000, retentionDays: 14 })
  assert.equal(r3.read, 0)
  assert.equal(Object.keys(cache.files).length, 0)
})

// ---- forecast math ---------------------------------------------------------------------------------------------

const flat = (from, hours, units) => {
  const h = {}
  for (let i = 0; i < hours; i++) h[String(from + i * HOUR)] = [0, 0, 0, 0, 0, 0, 0, units]
  return h
}

test('sumRange counts partial hours pro rata', () => {
  const h = flat(T0, 3, 10)
  close(sumRange(h, T0, T0 + 3 * HOUR, 'cost'), 30)
  close(sumRange(h, T0 + HOUR / 2, T0 + 2 * HOUR, 'cost'), 15)
  close(sumRange(h, T0 - 5 * HOUR, T0, 'cost'), 0)
})

test('forecast: exhausted before the reset, or what is left at the reset', () => {
  const now = T0
  const reading = { pct: 40, reset: now + 100 * HOUR }
  const a = forecast(reading, 1, now) // 60 % left at 1 %/h: out after 60 h, before the reset at 100 h
  close(a.exhaustedAt, now + 60 * HOUR)
  const b = forecast(reading, 0.5, now) // 50 % used over 100 h: 10 % left
  close(b.leftAtReset, 10)
  assert.equal(forecast(reading, 0, now).leftAtReset, 60)
  assert.equal(forecast(undefined, 1, now), undefined)
  assert.equal(forecast(reading, undefined, now), undefined)
})

test('calibration: units per 1 % from (time, %, reset) samples, median', () => {
  const reset = T0 + 100 * HOUR
  const start = reset - 168 * HOUR
  const hourly = flat(start, 168, 2) // 2 $ every hour of the week window
  const samples = [
    { ts: start + 10 * HOUR, seven_day: { pct: 4, reset } }, // 20 $ / 4 % = 5
    { ts: start + 20 * HOUR, seven_day: { pct: 8, reset } }, // 40 / 8 = 5
    { ts: start + 30 * HOUR, seven_day: { pct: 10, reset } }, // 60 / 10 = 6
    { ts: start + 1 * HOUR, seven_day: { pct: 1, reset } }, // below min_pct: ignored
  ]
  const c = calibrate(samples, hourly, 'cost', { min_pct: 2 })
  assert.equal(c.seven_day.n, 3)
  close(c.seven_day.unitsPerPct, 5)
  assert.equal(c.five_hour.unitsPerPct, undefined)
})

test('burn rates, projections and the sentence', () => {
  const now = Date.parse('2026-10-16T12:00:00Z')
  const hourly = { ...flat(now - 168 * HOUR, 166, 1), ...flat(now - 2 * HOUR, 2, 4) }
  const r = burnRates(hourly, now, 0, 'cost', 2)
  close(r.recent, 4)
  close(r.today, (10 * 1 + 2 * 4) / 12)
  close(r.week, (166 + 8) / 168)
  const reading = { pct: 50, reset: now + 48 * HOUR }
  const p = projections(cfg, reading, r, 1, now) // 1 $ per 1 %
  assert.deepEqual(p.map(x => x.label), ['calme', 'normal', 'intense'])
  close(p[2].pctPerHour, 6) // max(4, 1.5, 1.04) x 1.5
  close(p[2].result.exhaustedAt, now + (50 / 6) * HOUR)
  assert.ok(p[0].result.leftAtReset > 0)
  const l = cfg.labels
  assert.equal(when(Date.parse('2026-10-16T14:05:00Z'), 0, l), 'ven 16/10 à 14h05')
  assert.equal(when(Date.parse('2026-10-16T14:05:00Z'), 120, l, true), 'ven 16h')
  assert.equal(outcome({ exhaustedAt: Date.parse('2026-10-16T14:00:00Z') }, 0, l, true), 'épuisé ven 14h')
  assert.equal(outcome({ leftAtReset: 12.4 }, 0, l), 'il restera 12 % au reset')
  assert.equal(statusText(cfg, { pct: 34 }, { exhaustedAt: Date.parse('2026-10-16T14:00:00Z') }, 0), 'Semaine 34 % · épuisé ven 14h au rythme actuel')
  assert.equal(statusText(cfg, undefined, undefined, 0), undefined)
})

test('readings: the live value wins, else the latest sample whose window has not reset', () => {
  const now = T0
  const live = [{ kind: 'seven_day', percentUsed: 8, resetsAt: new Date(now + HOUR).toISOString() }, { kind: 'spend_limit', percentUsed: 1 }]
  const samples = [{ ts: now - HOUR, five_hour: { pct: 3, reset: now + 2 * HOUR }, seven_day: { pct: 7, reset: now + HOUR } }, { ts: now - 1, five_hour: { pct: 9, reset: now - 5 } }]
  const r = readings(live, samples, now)
  assert.equal(r.seven_day.pct, 8)
  assert.equal(r.seven_day.live, true)
  assert.equal(r.five_hour.pct, 3) // the newer sample's window already reset
  assert.equal(r.spend_limit, undefined)
})

test('Plein régime: suggested only with more than min_left_pct left and less than max_hours_left to go', () => {
  const now = T0
  const c = deepMerge(cfg, { plein_regime: { min_left_pct: 30, max_hours_left: 48 } })
  const at = (pct, hours, fc) => pleinRegime(c, { pct, reset: now + hours * HOUR }, fc, now).suggest
  assert.equal(at(50, 40), true)
  assert.equal(at(50, 60), false) // too far from the reset
  assert.equal(at(75, 40), false) // 25 % left
  assert.equal(at(70, 40), false) // exactly 30 %: not more
  assert.equal(at(20, 40, { leftAtReset: 31 }), true) // the pace leaves 31 % at the reset
  assert.equal(at(20, 40, { exhaustedAt: now + HOUR }), false)
  assert.equal(pleinRegime(c, undefined, undefined, now).suggest, false)
})

test('scenario fit: S1-S5 from measured rates; S5 is the Plein régime preset', () => {
  const rates = { 'main|opus': [0, 0, 0, 0, 0, 0, 3600, 10], 'workflow|opus': [0, 0, 0, 0, 0, 0, 7200, 10], 'subagent|haiku': [0, 0, 0, 0, 0, 0, 3600, 1] }
  const now = T0
  const reading = { pct: 50, reset: now + 24 * HOUR }
  const f = scenarioFit(shipped.scenarios, rates, cfg, 'cost', reading, 1, now)
  assert.deepEqual(f.rows.map(r => r.id), ['S1', 'S2', 'S3', 'S4', 'S5'])
  close(f.activeHours, 14)
  const s5 = f.rows.find(r => r.id === 'S5')
  assert.ok(f.rows.every(r => r.unitsPerHour <= s5.unitsPerHour), 'S5 burns the most')
  for (const r of f.rows) assert.equal(r.fits, r.needPct <= 50)
  if (f.best) assert.ok(f.rows.find(r => r.id === f.best).fits)
  const s = shipped.scenarios.find(x => x.id === 'S5')
  assert.equal(s.name, 'Plein régime')
  assert.ok(s.roles.every(r => r.model === 'opus' && ['high', 'xhigh'].includes(r.effort)))
  assert.match(promptLine(s, shipped.models), /^Scenario S5 "Plein régime": Lead Opus 5\.5 xhigh as session \(max 1\).*Caps: ci pipelines <= 4, npm ci tsc <= 3\.$/)
})

test('model(): everything the pane needs, without a reading too', () => {
  const now = Date.parse('2026-10-16T12:00:00Z')
  const aggr = { tzMin: 0, hourly: flat(now - 30 * HOUR, 30, 2), days: { '2026-10-16': { total: [1, 1, 1, 1, 1, 3, 0, 5], project: { x: [1, 1, 1, 1, 1, 3, 0, 5] } } }, rates: {}, sessions: {} }
  const none = model(aggr, cfg, { now })
  assert.equal(none.week, undefined)
  assert.equal(none.status, undefined)
  assert.equal(periodView(aggr, now, 'today', 'cost').project[0].key, 'x')
  const live = [{ kind: 'seven_day', percentUsed: 10, resetsAt: new Date(now + 40 * HOUR).toISOString() }]
  const m = model(aggr, cfg, { now, live, scenarios: shipped.scenarios })
  close(m.cal.seven_day.unitsPerPct, 6) // 60 $ since the window began / 10 %
  assert.ok(m.week.current)
  assert.equal(m.full.suggest, true) // 40 h to go and most of the week left
  assert.match(m.status, /^Semaine 10 % · /)
  assert.equal(m.heat.grid.length, 7)
  assert.equal(heatRow([0, 1, 4], 4), ' ░█')
})

test('samples: appended, a repeat within the interval skipped', () => {
  const dir = join(tmp, 'data')
  assert.equal(addSample(dir, { ts: T0, seven_day: { pct: 8, reset: T0 + HOUR } }), true)
  assert.equal(addSample(dir, { ts: T0 + 1000, seven_day: { pct: 8, reset: T0 + HOUR } }), false)
  assert.equal(addSample(dir, { ts: T0 + 2000, seven_day: { pct: 9, reset: T0 + HOUR } }), true)
  assert.deepEqual(readSamples(dir).map(s => s.seven_day.pct), [8, 9])
})
