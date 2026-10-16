// metrics mod: detection on synthetic transcripts, rules versions, forges, stalls, per-version values, formatting.
//   node --test mods/metrics/tests/logic.test.mjs
// Made-up ids, paths and numbers only; transcripts are written to a temp folder at test time.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'

import {
  DAY, HOUR, build, ciRuns, detectors, feed, githubPrs, gitlabMrs, hourly, mergePrs, newFile, parseRemote, stalls, values, versions, workflowAgents,
} from '../lib/collect.mjs'
import { duration, fmtMetric, fmtNum, fmtTok, latest, markerLegend, markerLine, metricRows, pickVersion, spark } from '../hooks/view.mjs'
import { scan } from '../scanner/metrics_scan.mjs'

const here = new URL('..', import.meta.url)
const cfg = JSON.parse(readFileSync(new URL('metrics.config.json', here), 'utf8'))
const prices = JSON.parse(readFileSync(new URL('../usage/lib/prices.json', here), 'utf8'))
const det = detectors(cfg.detect)
const tmp = mkdtempSync(join(tmpdir(), 'metrics-test-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

const T0 = Date.parse('2026-10-14T08:00:00Z')
const iso = ms => new Date(ms).toISOString()
const usage = (inp = 100, cr = 1000) => ({ input_tokens: inp, output_tokens: 50, cache_read_input_tokens: cr, cache_creation_input_tokens: 0 })
const asst = ({ id, ts, model = 'claude-opus-5-5', content = [], inp, cr, cwd = 'C:/code/app-one' }) =>
  JSON.stringify({ type: 'assistant', sessionId: 's-1', cwd, timestamp: iso(ts), requestId: `r-${id}`, message: { id, model, role: 'assistant', content, usage: usage(inp, cr) } })
const usr = (ts, content) => JSON.stringify({ type: 'user', sessionId: 's-1', cwd: 'C:/code/app-one', timestamp: iso(ts), message: { role: 'user', content } })
const err = text => [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: text }]

function lines() {
  const m = 60000
  return [
    asst({ id: 'a1', ts: T0, content: [{ type: 'tool_use', name: 'Agent', input: { prompt: 'x', model: 'haiku' } }] }),
    asst({ id: 'a1', ts: T0, content: [{ type: 'text', text: 'same request, second block' }] }), // repeated: one turn
    asst({ id: 'a2', ts: T0 + m, content: [{ type: 'tool_use', name: 'Agent', input: { prompt: 'y' } }] }),
    asst({ id: 'a3', ts: T0 + 2 * m, model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', name: 'Workflow', input: { script: "await agent('a', { model: 'haiku' })\nawait agent('b')" } }] }),
    asst({ id: 'a4', ts: T0 + 3 * m, model: 'claude-haiku-5-5', inp: 1000, cr: 260000, content: [{ type: 'tool_use', name: 'Monitor', input: {} }] }),
    asst({ id: 'a5', ts: T0 + 4 * m, content: [{ type: 'text', text: 'BLOCKED: CI red twice on the same fix' }] }),
    usr(T0 + 5 * m, [{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
    usr(T0 + 6 * m, err("The user doesn't want to proceed with this tool use. The tool use was rejected")),
    usr(T0 + 7 * m, err('This agent is isolated in the worktree <w> but this command names git in a form ...')),
    usr(T0 + 8 * m, err('Exit code 1 something else')),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: iso(T0 + 9 * m), compactMetadata: { trigger: 'auto' } }),
    JSON.stringify({ type: 'assistant', timestamp: iso(T0), message: { id: 'z', model: '<synthetic>', usage: usage() } }),
  ]
}

test('feed counts turns per model, M1, M2, stops, refusals, guards, BLOCKED, wake-ups, compactions', () => {
  const st = newFile('main')
  for (const l of lines()) feed(st, l, { det, prices })
  const c = Object.values(st.hours)[0]
  assert.equal(Object.keys(st.hours).length, 1)
  assert.equal(c.turns, 5)
  assert.deepEqual([c.opus, c.sonnet, c.haiku], [3, 1, 1])
  assert.deepEqual([c.agent, c.agent_model, c.wf, c.wf_model], [2, 1, 2, 1])
  assert.equal(c.main, 5)
  assert.equal(c.main_big, 1) // 1000 + 260000 >= 250 K
  assert.deepEqual([c.stop, c.perm, c.guard, c.blocked, c.wake, c.compact], [1, 1, 1, 1, 1, 1])
  assert.equal(c.tok, 4 * 1150 + 261050)
  assert.equal(st.cwd, 'C:/code/app-one')
})

test('a request seen in another file is not counted twice; subagent turns are not main turns', () => {
  const seen = new Set()
  const claim = k => (seen.has(k) ? false : (seen.add(k), true))
  const a = newFile('main')
  const b = newFile('subagent')
  feed(a, asst({ id: 'x1', ts: T0 }), { det, prices, claim })
  feed(b, asst({ id: 'x1', ts: T0 }), { det, prices, claim })
  feed(b, asst({ id: 'x2', ts: T0 }), { det, prices, claim })
  const cb = Object.values(b.hours)[0]
  assert.equal(Object.values(a.hours)[0].turns, 1)
  assert.equal(cb.turns, 1)
  assert.equal(cb.main, 0)
})

test('workflowAgents finds agent() calls and those naming a model', () => {
  assert.deepEqual(workflowAgents("agent('a', { model: 'opus' }); agent('b'); agent(`c`, {model:'haiku'})"), { calls: 3, named: 2 })
  assert.deepEqual(workflowAgents(''), { calls: 0, named: 0 })
})

test('versions: first commit per version, minor and major grain, sorted', () => {
  const log = [
    'c3|2026-10-15T00:04:37+02:00|V5.8: briefs cannot hold merges (#167)',
    'c2|2026-10-13T21:53:38+02:00|V5.7: workflows by default (#166)',
    'c1b|2026-10-13T16:42:18+02:00|V5.1: rm -rf form (#160)',
    'c1|2026-10-13T14:06:01+02:00|V5.1: pre-granted push (#158)',
    'c0|2026-10-09T17:55:46+02:00|V5: rules rewritten (#143)',
    'cx|2026-10-09T17:37:36+02:00|night audit fixes (#139)',
  ].join('\n')
  const v = versions(log)
  assert.deepEqual(v.map(x => x.version), ['V5', 'V5.1', 'V5.7', 'V5.8'])
  assert.equal(v[1].sha, 'c1')
  assert.equal(v[3].start, Date.parse('2026-10-14T22:04:37Z'))
  assert.deepEqual(versions(log, { grain: 'major' }).map(x => x.version), ['V5'])
  assert.deepEqual(versions('c9|2026-10-20T10:00:00Z|V6: new rules').map(x => x.version), ['V6'])
})

test('remotes, PRs, MRs and CI runs', () => {
  assert.deepEqual(parseRemote('https://github.com/Owner/App-One.git'), { forge: 'github', host: 'github.com', slug: 'Owner/App-One', name: 'app-one' })
  assert.equal(parseRemote('git@gitlab.com:group/sub/proj.git').slug, 'group/sub/proj')
  assert.equal(parseRemote('https://user@gitlab.com/group/proj').forge, 'gitlab')
  assert.equal(parseRemote('https://example.org/x/y'), null)
  const gh = githubPrs([{ repository: { nameWithOwner: 'Owner/App-One' }, number: 3, closedAt: iso(T0), createdAt: iso(T0 - HOUR) }])
  assert.deepEqual(gh[0], { forge: 'github', repo: 'owner/app-one', number: 3, merged: T0, created: T0 - HOUR })
  const gl = gitlabMrs([{ iid: 7, state: 'merged', merged_at: iso(T0), created_at: iso(T0) }, { iid: 8, state: 'opened', created_at: iso(T0) }], 'group/proj')
  assert.equal(gl.length, 1)
  assert.equal(mergePrs(gh, [...gh, ...gl]).length, 2)
  const runs = ciRuns([{ status: 'completed', startedAt: iso(T0), updatedAt: iso(T0 + 600000) }, { status: 'running', created_at: iso(T0 + HOUR) }], 'github:o/a', T0 + 2 * HOUR)
  assert.deepEqual(runs.map(r => (r.end - r.start) / 60000), [10, 60])
})

test('stalls: gaps of at least min_gap_min inside the day CI span', () => {
  const r = (h0, h1) => ({ repo: 'x', start: T0 + h0 * HOUR, end: T0 + h1 * HOUR })
  const s = stalls([r(0, 1), r(0.5, 2), r(2.5, 3), r(5, 6)], { minGapMin: 60 })
  assert.deepEqual(s, { '2026-10-14': 2 }) // 2.5 → 3 gap is 30 min (ignored), 3 → 5 counts
})

test('values and build: rates per day, shares, per-version windows and markers', () => {
  const st = newFile('main')
  for (const l of lines()) feed(st, l, { det, prices })
  const hours = hourly({ a: st }, name => (name === 'app-one' ? 'github:o/app-one' : undefined))
  const prs = [{ forge: 'github', repo: 'o/app-one', number: 1, merged: T0 + HOUR }, { forge: 'github', repo: 'o/app-one', number: 2, merged: T0 + 2 * HOUR }]
  const v = values({ hours, prs, stallByDay: {}, from: T0 - HOUR, to: T0 - HOUR + DAY })
  assert.equal(v.prs, 2)
  assert.equal(v.tok_per_pr, (4 * 1150 + 261050) / 2)
  assert.equal(v.opus_share, 60)
  assert.equal(v.m1_named, 50)
  assert.equal(v.m2_big, 20)
  assert.equal(v.stops, 1)
  assert.equal(v.stall_h, null)
  const now = T0 + 3 * DAY
  const vers = [{ version: 'V5', start: T0 - 40 * DAY, sha: 'a', subject: '' }, { version: 'V5.8', start: T0 + 0.5 * HOUR, sha: 'b', subject: '' }]
  const m = build({ hours, prs, runs: [], vers, now, historyDays: 7 })
  assert.equal(m.days.length, 7)
  assert.equal(m.days[6], '2026-10-17')
  assert.equal(m.series.prs[3], 2)
  assert.deepEqual(m.versions.map(w => w.version), ['V5', 'V5.8'])
  assert.equal(m.versions[0].from, m.from) // clipped to the window
  assert.equal(m.versions[1].values.prs > 0, true)
  assert.equal(m.versions[0].values.prs, 0)
  assert.deepEqual(m.markers, [{ version: 'V5.8', day: 3, start: T0 + 0.5 * HOUR }])
})

test('view: numbers, sparklines, markers, before/after verdicts', () => {
  assert.equal(fmtNum(1234.5, 1), '1 234,5')
  assert.equal(fmtTok(3_200_000), '3,2 M')
  assert.equal(fmtMetric({ format: 'pct' }, 42.4), '42 %')
  assert.equal(fmtMetric({ format: 'usd', digits: 1 }, 3.25), '3,3 $')
  assert.equal(fmtMetric({ format: 'number', unit: 'h' }, 2), '2,0 h')
  assert.equal(fmtMetric({}, null), '—')
  assert.equal(spark([0, 1, 2, null, 4]), '▁▃▅·█')
  assert.equal(spark([0, 0]), '▁▁')
  assert.equal(markerLine(5, [{ day: 1 }, { day: 4 }]), ' │  │')
  const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']
  assert.equal(markerLegend([{ version: 'V5.1', day: 1 }, { version: 'V5.2', day: 1 }, { version: 'V5.7', day: 1 }, { version: 'V5.8', day: 3 }], days), '13/10 V5.1–V5.7 · 15/10 V5.8')
  assert.equal(latest([1, 2, null]), 2)
  assert.equal(duration(36), '36 h')
  assert.equal(duration(60), '2,5 j')
  const rows = metricRows(cfg, { values: { prs: 10, tok_per_pr: 4e6, opus_share: 90 } }, { values: { prs: 20, tok_per_pr: 5e6, opus_share: 89 } })
  const by = Object.fromEntries(rows.map(r => [r.id, r]))
  assert.equal(by.prs.verdict, 'better')
  assert.equal(by.prs.arrow, '↑')
  assert.equal(by.tok_per_pr.verdict, 'worse')
  assert.equal(by.opus_share.arrow, '=')
  assert.equal(by.m1_named.target, '100 %')
  assert.equal(pickVersion([{ version: 'V5.7' }, { version: 'V5.8' }], 'v5.7'), 0)
  assert.equal(pickVersion([{ version: 'V5.7' }, { version: 'V5.8' }], ''), 1)
})

test('config: every metric has a label, a short label and a known id; labels are French', () => {
  const ids = Object.keys(values({ hours: {}, prs: [], stallByDay: {}, from: 0, to: DAY }))
  for (const m of cfg.metrics) {
    assert.ok(ids.includes(m.id), m.id)
    assert.ok(m.label && m.short, m.id)
  }
  for (const id of cfg.summary_metrics) assert.ok(cfg.metrics.some(m => m.id === id), id)
  assert.match(cfg.labels.pane_title, /règles/)
})

test('scanner, offline: incremental transcripts scan writes metrics.json', async () => {
  const projects = join(tmp, 'projects')
  const file = join(projects, 'C--code-app-one', 's-1.jsonl')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, lines().join('\n') + '\n')
  const dataDir = join(tmp, 'data')
  const ctx = { cfg: { ...cfg, rules: { repo: '<CLAUDE_CONTROL_REPO>' }, repos: { ...cfg.repos, roots: ['<PROJECTS_ROOT>'] } }, prices, dataDir, projects, home: tmp }
  const now = T0 + DAY
  const r1 = await scan(ctx, now, { offline: true })
  assert.equal(r1.info.read, 1)
  assert.equal(r1.model.series.opus_share.at(-2), 60)
  assert.match(r1.model.meta.errors[0], /rules\.repo/)
  const r2 = await scan(ctx, now, { offline: true })
  assert.equal(r2.info.read, 0) // nothing appended: nothing read
  const out = JSON.parse(readFileSync(join(dataDir, 'metrics.json'), 'utf8'))
  assert.equal(out.days.length, 30)
})
