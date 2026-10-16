// Classement tab: ranking per window and grouping, on the synthetic transcripts of fixture.mjs (no real data).
//   node --test mods/usage/tests/classement.test.mjs   (also run by logic.test.mjs, which CI runs)
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { aggregate, tokensOf } from '../lib/transcripts.mjs'
import { scanProjects } from '../lib/scan-node.mjs'
import { bar, buildClassement, codexTokens, isAppLink, linksFromFil, rank, trendText, windowOf } from '../lib/classement.mjs'
import { periodView } from '../hooks/logic.mjs'
import { T0, assistant, tree, write } from './fixture.mjs'

const here = new URL('..', import.meta.url)
const prices = JSON.parse(readFileSync(new URL('lib/prices.json', here), 'utf8'))
const cfg = JSON.parse(readFileSync(new URL('usage.config.json', here), 'utf8'))
const tmp = mkdtempSync(join(tmpdir(), 'usage-cls-'))
after(() => rmSync(tmp, { recursive: true, force: true }))
const H = 3600000
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)
const preset = id => cfg.classement.presets.find(p => p.id === id)

function world(name, extra) {
  const root = join(tmp, name)
  tree(root)
  if (extra) extra(root)
  const cache = { version: 1, files: {} }
  const now = T0 + 3 * H
  scanProjects({ root, cache, prices, now, retentionDays: 31 })
  return { cache, now }
}

test('today: totals equal the Aujourd\'hui tab, subagents counted under their parent with a split', () => {
  const { cache, now } = world('a')
  const aggr = aggregate(cache.files, { now, tzMin: 0 })
  const data = buildClassement(cache.files, { now, tzMin: 0, days: 31 })
  const r = rank(data, { now, preset: preset('today'), group: 'conversation', basis: 'cost', labels: cfg.classement.labels })
  const tab = periodView(aggr, now, 'today', 'cost')
  assert.deepEqual(r.total.slice(0, 6), tab.total.slice(0, 6))
  close(r.total[7], tab.total[7])
  assert.deepEqual(r.rows.map(x => x.id), ['sess-a', 'sess-b'])
  const a = r.rows[0]
  assert.equal(a.label, 'App one lane')
  assert.equal(a.project, 'app-one')
  // the explore-fast subagent (2 requests) and the Workflow coder (1) belong to sess-a
  const one = 100 + 50 + 1000 + 200
  assert.equal(a.sub, 3 * one)
  assert.equal(tokensOf(a.v), 6 * one)
  close(r.rows.reduce((n, x) => n + x.share, 0), 1)
})

test('groupings: project, model, agent type, feature, source', () => {
  const { cache, now } = world('b')
  const data = buildClassement(cache.files, { now, tzMin: 0 })
  const by = group => rank(data, { now, preset: preset('today'), group, basis: 'tokens', labels: cfg.classement.labels }).rows.map(x => x.label)
  assert.deepEqual(by('project').sort(), ['app-one', 'app-two'])
  assert.deepEqual(by('model').sort(), ['Haiku', 'Opus', 'Sonnet'])
  assert.ok(by('agent').includes('sous-agent (Agent) · explore-fast'))
  assert.ok(by('agent').includes('agent de Workflow · coder'))
  assert.ok(by('agent').includes('sous-conversation'))
  const f = by('feature')
  for (const x of ['skill handoff', 'MCP github', 'Agent', 'Workflow', 'fil principal', 'sous-conversation']) assert.ok(f.includes(x), x)
  assert.deepEqual(by('source'), ['Claude'])
})

test('windows, trend vs the previous window, top N and autres', () => {
  const extra = root => {
    const lines = []
    for (let i = 0; i < 5; i++) lines.push(assistant({ id: `x${i}`, req: `rx${i}`, ts: T0 - 2 * H + i * 60000, session: `sess-x${i}`, cwd: `C:/code/p${i}`, out: 10 * (i + 1) }))
    write(root, 'C--code-old/old.jsonl', lines)
    // one file per session, as Claude Code writes them: an earlier request of sess-a (a resumed part)
    write(root, 'C--code-app-one/sess-a-earlier.jsonl', [assistant({ id: 'aa', req: 'raa', ts: T0 - 2 * H, session: 'sess-a' })])
  }
  const { cache, now } = world('c', extra)
  const data = buildClassement(cache.files, { now, tzMin: 0 })
  // 4 h at T0+3h: buckets from T0-1h; the previous 4 buckets hold the T0-2h requests
  const w = windowOf({ hours: 4 }, now, 0)
  assert.equal(w.from, T0 - H)
  assert.equal(w.to, T0 + 4 * H)
  const r = rank(data, { now, preset: { hours: 4 }, group: 'conversation', basis: 'tokens', top: 1, labels: cfg.classement.labels })
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].id, 'sess-a')
  assert.ok(r.rows[0].trend > 0) // sess-a had one request before, six now
  assert.equal(r.others.count, 1)
  assert.equal(r.others.label, 'autres')
  assert.ok(r.others.isNew === undefined)
  const b = rank(data, { now, preset: { hours: 4 }, group: 'conversation', basis: 'tokens', labels: {} })
  assert.equal(b.rows.find(x => x.id === 'sess-b').isNew, true)
  assert.equal(trendText(b.rows.find(x => x.id === 'sess-b'), {}), 'nouveau')
  // 1 h: only the hour buckets touching the last hour (none hold data at T0+3h)
  assert.equal(tokensOf(rank(data, { now, preset: { hours: 1 }, basis: 'tokens' }).total), 0)
  // 30 j with 31 days kept: the previous window is outside, so no trend
  const m = rank(data, { now, preset: preset('30d'), basis: 'tokens' })
  assert.equal(m.partialPrev, true)
  assert.equal(m.trend, undefined)
  assert.equal(trendText(m.rows[0], {}), '')
})

test('today window follows the local day (timezone east of UTC)', () => {
  const now = Date.parse('2026-10-16T10:30:00Z')
  const w = windowOf({ since: 'midnight' }, now, 120)
  assert.equal(w.from, Date.parse('2026-10-15T22:00:00Z'))
  assert.equal(w.to, Date.parse('2026-10-16T11:00:00Z'))
  assert.equal(w.today, '2026-10-16')
})

test('helpers: bar, links from veille fil.json, app links only, Codex by day', () => {
  assert.equal(bar(0.5, 0.5, 4), '████')
  assert.equal(bar(0.25, 0.5, 4), '██··')
  const fil = { projects: [{ convs: [{ cli: 'c1', sid: 'local_1', link: 'claude://claude.ai/epitaxy/local_1', children: [{ cli: 'c2', sid: 'local_2', link: 'claude://claude.ai/epitaxy/local_2' }] }] }] }
  assert.deepEqual(Object.keys(linksFromFil(fil)).sort(), ['c1', 'c2'])
  assert.equal(isAppLink('claude://claude.ai/epitaxy/local_1'), true)
  assert.equal(isAppLink('https://example.com/x'), false)
  assert.equal(isAppLink('claude://claude.ai/epitaxy/a b'), false)
  const now = Date.parse('2026-10-16T12:00:00Z')
  const cx = { days: { '2026-10-16': { m: [1, 0, 1, 0, 100] }, '2026-10-15': { m: [1, 0, 1, 0, 50] } } }
  assert.equal(codexTokens(cx, windowOf({ since: 'midnight' }, now, 0), 0), 100)
  assert.equal(codexTokens(cx, windowOf({ hours: 48 }, now, 0), 0), 150)
  assert.equal(codexTokens(undefined, windowOf({ hours: 1 }, now, 0), 0), undefined)
})

test('the presets and groups of the config are complete', () => {
  assert.deepEqual(cfg.classement.presets.map(p => p.id), ['1h', '4h', 'today', '2d', '7d', '30d'])
  assert.deepEqual(cfg.classement.groups.map(g => g.id), ['conversation', 'project', 'model', 'agent', 'feature', 'source'])
  assert.ok(cfg.retention_days >= cfg.classement.days)
})
