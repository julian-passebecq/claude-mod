// usage mod: counting once (message.id + requestId), daily history, tokens per second. Synthetic data only.
//   node --test mods/usage/tests/accuracy.test.mjs   (also loaded by logic.test.mjs)
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { aggregate, feedLine, keyOf, newFileState, tokensOf } from '../lib/transcripts.mjs'
import { scanProjects } from '../lib/scan-node.mjs'
import { HISTORY_VERSION, historyView, mergeHistory } from '../lib/history.mjs'
import { fmtDur, fmtTps, recentStreams, tpsPercentile, tpsStats, tpsTable } from '../lib/tps.mjs'
import { aggregateCodex, feedCodexLine, newCodexState } from '../lib/codex.mjs'
import { T0, assistant, user, write } from './fixture.mjs'

const prices = JSON.parse(readFileSync(new URL('../lib/prices.json', import.meta.url), 'utf8'))
const tmp = mkdtempSync(join(tmpdir(), 'usage-acc-'))
after(() => rmSync(tmp, { recursive: true, force: true }))
const S = 1000
const M = 60 * S
const iso = ms => new Date(ms).toISOString()
const toolResult = ts => JSON.stringify({ type: 'user', sessionId: 'sess-a', timestamp: iso(ts), message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } })
const noise = ts => JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(ts), sessionId: 'sess-a' })

test('keyOf: message.id + requestId; the line uuid only without a message.id', () => {
  assert.equal(keyOf({ requestId: 'r', uuid: 'u1', message: { id: 'm' } }), 'm|r')
  assert.equal(keyOf({ uuid: 'u1', message: { id: 'm' } }), 'm|') // two content blocks of one response, no requestId
  assert.equal(keyOf({ uuid: 'u2', message: { id: 'm' } }), 'm|')
  assert.equal(keyOf({ uuid: 'u3', message: {} }), '|u3')
})

test('duplicated entries across a transcript, a fork and a subagent file count once', () => {
  const root = join(tmp, 'dup')
  const blocks = id => [assistant({ id, req: `q-${id}`, ts: T0 + M, out: 10 }), assistant({ id, req: `q-${id}`, ts: T0 + M, out: 60 })]
  write(root, 'P/sess-a.jsonl', [user({ ts: T0 }), ...blocks('m1'), ...blocks('m2')])
  // a resume / fork repeats both responses, a subagent file repeats one, and one response has no requestId
  write(root, 'P/sess-a-fork.jsonl', [...blocks('m1'), ...blocks('m2'), assistant({ id: 'm3', ts: T0 + 2 * M }), assistant({ id: 'm3', ts: T0 + 2 * M })])
  write(root, 'P/sess-a/subagents/agent-1.jsonl', [...blocks('m2')])
  const cache = { version: 1, files: {} }
  scanProjects({ root, cache, prices, now: T0 + 3 * M, retentionDays: 2 })
  const a = aggregate(cache.files, { now: T0 + 3 * M, days: 2 })
  const day = Object.values(a.days)[0]
  // 3 responses: m1 and m2 (100 + 60 + 1000 + 200 each) and m3 (100 + 50 + 1000 + 200); naive line count would give 12
  assert.equal(day.total[5], 3)
  assert.equal(tokensOf(day.total), 2 * 1360 + 1350)
})

test('a rewritten file is counted again from the start, not dropped as already seen', () => {
  const root = join(tmp, 'rewrite')
  const p = write(root, 'P/s.jsonl', [assistant({ id: 'a', req: 'r', ts: T0 }), assistant({ id: 'b', req: 'r2', ts: T0 + M })])
  const cache = { version: 1, files: {} }
  scanProjects({ root, cache, prices, now: T0 + 2 * M, retentionDays: 2 })
  writeFileSync(p, assistant({ id: 'a', req: 'r', ts: T0 }) + '\n') // shorter: the file was rewritten
  scanProjects({ root, cache, prices, now: T0 + 2 * M, retentionDays: 2 })
  const a = aggregate(cache.files, { now: T0 + 2 * M, days: 2 })
  assert.equal(Object.values(a.days)[0].total[5], 1)
})

test('stream timing: from the tool result that sent it to its last block; bookkeeping lines do not move the start', () => {
  const st = newFileState()
  const feed = l => feedLine(st, l, { prices })
  feed(user({ ts: T0 }))
  feed(noise(T0 + 5 * S)) // written while the response streams: ignored
  feed(assistant({ id: 'm1', req: 'r1', ts: T0 + 4 * S, out: 30 })) // thinking block, interim count
  feed(assistant({ id: 'm1', req: 'r1', ts: T0 + 10 * S, out: 500 })) // last block: 500 tokens in 10 s
  feed(toolResult(T0 + 12 * S))
  feed(assistant({ id: 'm2', req: 'r2', ts: T0 + 16 * S, out: 200 })) // 200 in 4 s
  feed(toolResult(T0 + 17 * S))
  feed(assistant({ id: 'm3', req: 'r3', ts: T0 + 18 * S, out: 20 })) // under 50 tokens: left out
  const rows = Object.values(st.tps)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].slice(0, 3), [700, 14000, 2])
  assert.deepEqual(st.streams.map(x => [x.out, x.ms]), [[500, 10000], [200, 4000]])
  const a = aggregate({ f: st }, { now: T0 + M, days: 1 })
  assert.deepEqual(a.tps['claude-opus-5-5|medium'].slice(0, 3), [700, 14000, 2])
  assert.equal(a.streams[0].out, 200) // newest first
})

test('tpsStats: weighted TPS is exact, median and range from the buckets', () => {
  const st = newFileState()
  let t = T0
  for (const [out, sec] of [[100, 10], [500, 10], [1000, 10], [5000, 50]]) {
    feedLine(st, user({ ts: t }), { prices })
    t += sec * S
    feedLine(st, assistant({ id: `m${t}`, req: `r${t}`, ts: t, out }), { prices })
  }
  const row = Object.values(st.tps)[0]
  const s = tpsStats(row)
  assert.equal(s.weighted, 6600 / 80)
  assert.ok(Math.abs(s.median - 50) / 50 < 0.15, `median ${s.median}`)
  assert.ok(s.lo <= s.median && s.median <= s.hi)
  assert.equal(tpsPercentile({}, 50), undefined)
  assert.equal(fmtTps(82.4), '82')
  assert.equal(fmtTps(7.46), '7.5')
  assert.equal(fmtDur(4000), '4 s')
  assert.equal(fmtDur(185000), '3 min 05')
})

const cx = (ts, type, payload) => JSON.stringify({ timestamp: iso(ts), type, payload })
test('Codex: a response runs from task_started or the last tool output to its token_usage_record', () => {
  const st = newCodexState()
  const f = l => feedCodexLine(st, l, 0)
  f(cx(T0, 'event_msg', { type: 'task_started', turn_id: 't' }))
  f(cx(T0 + S, 'turn_context', { model: 'gpt-x', effort: 'high' }))
  f(cx(T0 + 21 * S, 'token_usage_record', { response_id: 'r1', usage: { output_tokens: 800 } })) // 800 in 21 s
  f(cx(T0 + 21 * S, 'token_usage_record', { response_id: 'r1', usage: { output_tokens: 800 } })) // repeated: once
  f(cx(T0 + 30 * S, 'response_item', { type: 'function_call_output', call_id: 'c', output: 'x'.repeat(500) }))
  f(cx(T0 + 40 * S, 'token_usage_record', { response_id: 'r2', usage: { output_tokens: 400 } })) // 400 in 10 s
  const a = aggregateCodex({ f: st }, { now: T0 + M })
  const k = Object.keys(a.tps)[0]
  assert.match(k, /\|gpt-x\|high$/)
  assert.deepEqual(a.tps[k].slice(0, 3), [1200, 31000, 2])
  const table = tpsTable({ tps: {} }, a, { now: T0 + M, days: 7 })
  assert.equal(table[0].source, 'codex')
  assert.equal(table[0].model, 'gpt-x')
  assert.equal(recentStreams({ streams: [] }, a, 5)[0].tps, 40)
  assert.equal(tpsTable({ tps: {} }, undefined, { now: T0 + M }).length, 0) // Codex hidden: no row
})

const day = (tok, model = 'claude-opus-5-5') => ({ total: [tok, 0, 0, 0, 0, 1, 0, 1], model: { [model]: [tok, 0, 0, 0, 0, 1, 0, 1] }, project: { 'app-one': [tok, 0, 0, 0, 0, 1, 0, 1] }, kind: {} })
test('history: days are kept after the transcripts go; an old day that shrank keeps its figures', () => {
  const now = Date.parse('2026-10-16T12:00:00Z')
  let h = mergeHistory(undefined, { '2026-09-15': day(5), '2026-09-16': day(100), '2026-09-20': day(100), '2026-10-10': day(50), '2026-10-16': day(10) }, { now, retentionDays: 31, trustDays: 25 })
  assert.deepEqual(Object.keys(h.days).sort(), ['2026-09-16', '2026-09-20', '2026-10-10', '2026-10-16']) // 09-15 is only partly in the window
  assert.equal(h.days['2026-09-16'].v, HISTORY_VERSION)
  // two days later: 09-16 left the window and stays; 09-20 seen smaller (transcripts cleaned up) keeps 100
  h = mergeHistory(h, { '2026-09-20': day(40), '2026-10-10': day(20), '2026-10-16': day(12) }, { now: now + 2 * 86400000, retentionDays: 31, trustDays: 25 })
  assert.equal(h.days['2026-09-16'].total[0], 100)
  assert.equal(h.days['2026-09-20'].total[0], 100)
  assert.equal(h.days['2026-10-10'].total[0], 20) // recent: the new count wins
  h = mergeHistory(h, {}, { now: now + 60 * 86400000, retentionDays: 31 })
  assert.equal(Object.keys(h.days).length, 4) // nothing seen any more, nothing lost
  const v = historyView(h, { now: now + 60 * 86400000, days: 0 })
  assert.equal(tokensOf(v.total), 232)
  assert.equal(v.unit, 'week')
  assert.equal(v.first, '2026-09-16')
  assert.equal(historyView(h, { now, days: 30, maxRows: 40 }).unit, 'day')
  assert.equal(historyView(h, { now: now + 60 * 86400000, days: 30 }).n, 0)
})
