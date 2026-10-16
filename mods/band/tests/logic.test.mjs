// band mod: rate math, scope grouping, context and compaction figures, incremental scanner.
//   node --test mods/band/tests/logic.test.mjs     (Node 22.18+ strips the types)
// Fixture transcripts are generated here into a temp folder: no transcript file is committed, no real data.
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  bandParts,
  bandText,
  buildView,
  compactLabel,
  contextInfo,
  costOf,
  deepMerge,
  fmtTok,
  growthTpm,
  rateOf,
  repoKey,
  sparkline,
} from '../hooks/logic.ts'
import { classifyPath, emptyMeta, parseLines } from '../hooks/parse.ts'
import { scan, sharedLib } from '../scanner/scan.mjs'

const CFG = JSON.parse(readFileSync(new URL('../band.config.json', import.meta.url), 'utf8'))
const NOW = Date.parse('2026-10-16T12:00:00Z')
const iso = sAgo => new Date(NOW - sAgo * 1000).toISOString()
const U = (inp, cw, cr, out) => ({ input_tokens: inp, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out })
const asst = (sAgo, id, usage, extra = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: iso(sAgo), isSidechain: false, cwd: extra.cwd, message: { id, model: extra.model ?? 'claude-opus-5-5', usage } })
const ev = (sAgo, s, tokens, extra = {}) => ({ t: NOW - sAgo * 1000, s, m: 'claude-opus-5-5', u: { inp: tokens, cw: 0, cr: 0, out: 0 }, ...extra })

test('tests/shipped.ts is a current copy of band.config.json', () => {
  const src = readFileSync(new URL('./shipped.ts', import.meta.url), 'utf8')
  const copy = JSON.parse(JSON.parse(/SHIPPED = (".*")\s*$/m.exec(src)[1]))
  assert.deepEqual(copy, CFG)
})

test('rate math: sliding window, per s / min / h, list-price $/h', () => {
  const evs = [ev(10, 'a', 600), ev(30, 'a', 600), ev(59, 'a', 600), ev(61, 'a', 6000), ev(-5, 'a', 999)]
  const r = rateOf(evs, NOW, 60, 'fresh', CFG.rates)
  assert.equal(r.tokens, 1800)
  assert.equal(r.calls, 3)
  assert.equal(r.tps, 30)
  assert.equal(r.tpm, 1800)
  assert.equal(r.tph, 108000)
  // 1800 input tokens of claude-opus-5-5 at 4 $/M in 60 s -> 0.0072 $ per minute -> 0.432 $/h
  assert.ok(Math.abs(r.usdPerH - 0.432) < 1e-9)
  const ten = rateOf(evs, NOW, 600, 'fresh', CFG.rates)
  assert.equal(ten.tokens, 7800)
  assert.equal(ten.tps, 13)
})

test('count mode: fresh leaves cache reads out, all counts them; cost prices each part', () => {
  const e = { t: NOW, s: 'a', m: 'claude-sonnet-5-5', u: { inp: 100, cw: 1000, cr: 100000, out: 500 } }
  assert.equal(rateOf([e], NOW, 1, 'fresh', CFG.rates).tokens, 1600)
  assert.equal(rateOf([e], NOW, 1, 'all', CFG.rates).tokens, 101600)
  // 100*2 + 1000*2.5 + 100000*0.2 + 500*10 = 27700 per M
  assert.ok(Math.abs(costOf(e, CFG.rates) - 0.0277) < 1e-12)
  // unknown full id falls back to its family, then to default
  assert.equal(costOf({ ...e, m: 'claude-haiku-9' }, CFG.rates), (100 * 1 + 1000 * 1.25 + 100000 * 0.1 + 500 * 5) / 1e6)
})

test('scope grouping: a worktree counts as its repo; conv, agents, workflows, project, all', () => {
  const M = CFG.worktree_markers
  assert.equal(repoKey('C:\\code\\app\\.claude\\worktrees\\band', M), 'C:/code/app')
  assert.equal(repoKey('c:/code/app/.worktrees/x/sub', M), 'C:/code/app')
  assert.equal(repoKey('C:/code/app/', M), 'C:/code/app')
  const sessions = {
    me: { ...emptyMeta('me'), cwd: 'C:/code/app/.claude/worktrees/band', last: NOW },
    twin: { ...emptyMeta('twin'), cwd: 'C:/code/app', last: NOW },
    other: { ...emptyMeta('other'), cwd: 'C:/code/web', last: NOW },
  }
  const evs = [
    ev(5, 'me', 600),
    ev(6, 'me', 1200, { a: 'sub1' }),
    ev(7, 'me', 1800, { a: 'wf-a', w: 'wf_1' }),
    ev(8, 'twin', 3000),
    ev(9, 'other', 6000),
  ]
  const v = buildView(evs, sessions, CFG, { now: NOW, session: 'me', cwd: 'C:/code/app/.claude/worktrees/band' })
  const tps = id => v.scopes.find(s => s.id === id).rates[0].tps
  assert.equal(tps('conv'), 10)
  assert.equal(tps('conv_all'), 60)
  assert.equal(tps('agents'), 50)
  assert.equal(tps('workflows'), 30)
  assert.equal(tps('project'), 110)
  assert.equal(tps('all'), 210)
  assert.equal(v.repo, 'app')
  assert.deepEqual(v.projects.map(p => [p.repo, p.sessions]), [['app', 2], ['web', 1]])
  assert.equal(v.top[0].s, 'other')
  assert.equal(v.top.find(t => t.s === 'me').isThis, true)
})

test('context: % of window, threshold from the engine or the fallback, ETA, relay and idle markers', () => {
  const c = contextInfo({ tokens: 180000, window: 400000, percent: 45, autoCompactThreshold: 368000, growthTpm: 4000, last: NOW - 60000, now: NOW }, CFG.context, CFG.idle_compact)
  assert.equal(c.usedPct, 45)
  assert.equal(c.threshold, 368000)
  assert.equal(c.thresholdPct, 92)
  assert.equal(c.thresholdSource, 'engine')
  assert.equal(c.toCompact, 188000)
  assert.equal(c.toCompactPct, 47)
  assert.equal(c.etaMin, 47)
  assert.equal(c.relay, 'ok')
  assert.equal(c.level, 'ok')
  assert.equal(c.idleEtaMin, undefined)
  const near = contextInfo({ tokens: 230000, window: 400000, now: NOW, last: NOW - 20 * 60000 }, CFG.context, CFG.idle_compact)
  assert.equal(near.thresholdSource, 'config')
  assert.equal(near.threshold, 368000)
  assert.equal(near.usedPct, 57.5)
  assert.equal(near.relay, 'near')
  assert.equal(near.level, 'warn')
  assert.equal(Math.round(near.idleEtaMin), 34)
  const over = contextInfo({ tokens: 260000, window: 400000, now: NOW }, CFG.context, CFG.idle_compact)
  assert.equal(over.relay, 'over')
  assert.equal(over.level, 'bad')
})

test('context growth: slope since the last drop, none when flat', () => {
  const s = [[NOW - 500000, 300000], [NOW - 400000, 20000], [NOW - 300000, 50000], [NOW - 60000, 90000]]
  assert.equal(growthTpm(s, NOW, 600), ((90000 - 20000) / 340000) * 60000)
  assert.equal(growthTpm([[NOW - 10, 5], [NOW, 5]], NOW, 600), undefined)
})

test('band text in French, scopes and items from the settings, week only when known', () => {
  const sessions = { me: { ...emptyMeta('me'), cwd: 'C:/code/app', last: NOW } }
  const v = buildView([ev(10, 'me', 7200), ev(20, 'me', 120000, { a: 'x' })], sessions, CFG, { now: NOW, session: 'me', cwd: 'C:/code/app' })
  const ctx = contextInfo({ tokens: 164000, window: 400000, percent: 41, autoCompactThreshold: 368000, now: NOW }, CFG.context, CFG.idle_compact)
  const txt = bandText(bandParts(v, ctx, 37, CFG.band, CFG))
  assert.equal(txt, 'ctx 41 % (164 k) · compact à 92 % · reste 51 % · cette conv 120 tok/s · projet 2,1 k tok/s · tout 2,1 k tok/s · semaine 37 %')
  assert.doesNotMatch(bandText(bandParts(v, ctx, undefined, CFG.band, CFG)), /semaine/)
  const only = bandText(bandParts(v, ctx, undefined, { items: ['rates'], scopes: ['conv_all'] }, CFG))
  assert.equal(only, 'conv + agents 2,1 k tok/s')
  assert.equal(fmtTok(999), '999')
  assert.equal(fmtTok(41000), '41 k')
  assert.equal(fmtTok(1200000), '1,2 M')
})

test('paths: main, subagent and Workflow agent transcripts', () => {
  assert.deepEqual(classifyPath('proj/abc.jsonl'), { s: 'abc' })
  assert.deepEqual(classifyPath('proj/abc/subagents/agent-a1.jsonl'), { s: 'abc', a: 'a1' })
  assert.deepEqual(classifyPath('proj/abc/subagents/workflows/wf_1/agent-a2.jsonl'), { s: 'abc', w: 'wf_1', a: 'a2' })
  assert.equal(classifyPath('proj/abc/tool-results/x.txt'), undefined)
})

test('parser: a response split over entries counts once; compactions with and without timestamp', () => {
  const meta = emptyMeta('s')
  const events = []
  const st = {}
  const lines = [
    JSON.stringify({ type: 'custom-title', customTitle: 'LANE A', sessionId: 's' }),
    asst(3000, 'm1', U(10, 100, 1000, 5), { cwd: 'C:/code/app' }),
    asst(3000, 'm1', U(10, 100, 1000, 50)),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 368000, postTokens: 17000 } }),
    JSON.stringify({ type: 'user', isCompactSummary: true, timestamp: iso(2990) }),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: iso(100), compactMetadata: { trigger: 'manual', preTokens: 90000, postTokens: 9000 } }),
  ]
  parseLines(lines.join('\n') + '\n', { s: 's' }, st, meta, events, NOW - 3600000)
  assert.equal(events.length, 1)
  assert.equal(events[0].u.out, 50)
  assert.equal(meta.title, 'LANE A')
  assert.equal(meta.cwd, 'C:/code/app')
  assert.equal(meta.compactions.length, 2)
  assert.equal(meta.compactions[0].t, NOW - 2990000)
  assert.equal(meta.compactions[1].trigger, 'manual')
  assert.equal(meta.ctx, 9000)
  assert.equal(compactLabel(meta.compactions[1], CFG.labels, 54), '/compact')
  assert.equal(compactLabel({ t: 0, trigger: 'auto', gapMin: 55 }, CFG.labels, 54), 'au repos (déduit)')
  assert.equal(compactLabel({ t: 0, trigger: 'auto', gapMin: 1 }, CFG.labels, 54), 'auto')
})

test('scanner: incremental tail, worktree grouping, compaction markers, shared parser', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'band-test-'))
  try {
    const root = join(dir, 'projects')
    const repo = join(dir, 'code', 'app')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const wt = join(repo, '.claude', 'worktrees', 'band')
    mkdirSync(wt, { recursive: true })
    const p1 = join(root, 'C--code-app')
    mkdirSync(join(p1, 'me', 'subagents', 'workflows', 'wf_1'), { recursive: true })
    const main = join(p1, 'me.jsonl')
    writeFileSync(main, [asst(50, 'r1', U(100, 500, 9000, 600), { cwd: wt }), asst(40, 'r2', U(100, 500, 9500, 600), { cwd: wt })].join('\n') + '\n')
    writeFileSync(join(p1, 'me', 'subagents', 'agent-s1.jsonl'), asst(30, 'r3', U(0, 0, 0, 1200), { cwd: wt }) + '\n')
    writeFileSync(join(p1, 'me', 'subagents', 'workflows', 'wf_1', 'agent-w1.jsonl'), asst(20, 'r4', U(0, 0, 0, 600), { cwd: wt }) + '\n')
    const p2 = join(root, 'C--code-app-2')
    mkdirSync(p2, { recursive: true })
    writeFileSync(join(p2, 'twin.jsonl'), asst(15, 'r5', U(0, 0, 0, 3000), { cwd: repo }) + '\n')
    const cache = join(dir, 'cache', 'scan-cache.json')
    const req = { projects_root: root, cache_file: cache, session: 'me', cwd: wt, now: NOW, cfg: deepMerge(CFG, {}) }

    const v1 = scan(req)
    const r = id => v1.scopes.find(s => s.id === id).rates[0].tokens
    assert.equal(r('conv'), 2400)
    assert.equal(r('agents'), 1800)
    assert.equal(r('workflows'), 600)
    assert.equal(r('project'), 7200)
    assert.equal(v1.repo, 'app')
    assert.equal(v1.files, 4)

    // second run: nothing new, nothing read; then an appended partial line waits for its newline
    const v2 = scan({ ...req, now: NOW + 1000 })
    assert.equal(v2.files, 0)
    const half = JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: iso(5), compactMetadata: { trigger: 'auto', preTokens: 300000, postTokens: 20000 } })
    appendFileSync(main, half.slice(0, 40))
    assert.equal(scan(req).compactions.length, 0)
    appendFileSync(main, half.slice(40) + '\n')
    const v3 = scan(req)
    assert.equal(v3.compactions.length, 1)
    assert.equal(v3.compactions[0].isThis, true)
    assert.equal(v3.compactions[0].items[0].pre, 300000)
    assert.equal(v3.marks.conv.length, 1)
    assert.equal(v3.marks.conv[0], 29)
    assert.equal(v3.scopes.find(s => s.id === 'conv').rates[0].tokens, 2400)
    assert.equal(v3.conv.ctx, 20000)
    assert.match(sparkline(v3.scopes.find(s => s.id === 'all').spark), /[▁-█]$/)
    assert.equal(v3.lib, 'band')

    // the shared parser and price table of mods/usage give the same tokens; a fresh cache reads every file again
    const lib = await sharedLib(CFG)
    assert.equal(lib?.name, 'mods/usage/lib')
    const v4 = scan({ ...req, cache_file: join(dir, 'cache2.json') }, lib)
    assert.equal(v4.lib, 'mods/usage/lib')
    for (const id of ['conv', 'agents', 'workflows', 'project']) {
      assert.equal(v4.scopes.find(s => s.id === id).rates[0].tokens, v3.scopes.find(s => s.id === id).rates[0].tokens, id)
    }
    assert.ok(v4.scopes.find(s => s.id === 'all').rates[0].usdPerH > 0)
    assert.equal(await sharedLib({ ...CFG, shared_lib: 'off' }), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
