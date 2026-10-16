// usage mod, Codex tab: parser and scanner on synthetic rollout files (made-up ids and numbers, no real data).
//   node --test mods/usage/tests/codex.test.mjs   (also loaded by logic.test.mjs)
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { CV, aggregateCodex, codexEnabled, codexView, feedCodexLine, newCodexState } from '../lib/codex.mjs'
import { scanCodex } from '../lib/codex-scan.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'usage-codex-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

const NOW = Date.parse('2026-10-16T12:00:00Z')
const H = 3600000
const iso = ms => new Date(ms).toISOString()
const ctx = (ts, model) => JSON.stringify({ timestamp: iso(ts), type: 'turn_context', payload: { turn_id: 't', cwd: '/x', model, effort: 'high' } })
const tok = (ts, inp, out, rl) => JSON.stringify({
  timestamp: iso(ts), type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: { input_tokens: inp, cached_input_tokens: Math.floor(inp / 2), output_tokens: out, reasoning_output_tokens: Math.floor(out / 4), total_tokens: inp + out } }, rate_limits: rl ?? null },
})
const RL = (pct, win = 10080, at = NOW + 48 * H) => ({ limit_id: 'codex', primary: { used_percent: pct, window_minutes: win, resets_at: Math.floor(at / 1000) }, secondary: null, credits: { balance: '0' }, plan_type: 'pro' })

test('feedCodexLine: cumulative totals become per-event differences, per day and model', () => {
  const st = newCodexState()
  feedCodexLine(st, ctx(NOW - 30 * H, 'gpt-a'), 0)
  feedCodexLine(st, tok(NOW - 30 * H, 1000, 100), 0) // yesterday (2026-10-15)
  feedCodexLine(st, tok(NOW - 2 * H, 1500, 150), 0) // today: +500/+50
  feedCodexLine(st, tok(NOW - 2 * H, 1500, 150), 0) // repeated snapshot: nothing new
  feedCodexLine(st, ctx(NOW - H, 'gpt-b'), 0)
  feedCodexLine(st, tok(NOW - H, 2000, 200, RL(40)), 0) // +500/+50 with gpt-b
  feedCodexLine(st, '{"type":"response_item","payload":{"type":"message","content":"token_count? no"}}', 0)
  feedCodexLine(st, 'not json "token_count"', 0)
  assert.deepEqual(st.days['2026-10-15']['gpt-a'], [1000, 500, 100, 25, 1100])
  assert.deepEqual(st.days['2026-10-16']['gpt-a'], [500, 250, 50, 12, 550])
  assert.deepEqual(st.days['2026-10-16']['gpt-b'], [500, 250, 50, 13, 550])
  assert.equal(st.rl.primary.pct, 40)
  assert.equal(st.rl.primary.windowMin, 10080)
  assert.equal(st.rl.plan, 'pro')
  assert.equal(st.rl.credits, undefined) // the balance is not kept
})

test('a counter that goes down starts over', () => {
  const st = newCodexState()
  feedCodexLine(st, tok(NOW - H, 1000, 100), 0)
  feedCodexLine(st, tok(NOW, 300, 30), 0)
  assert.equal(st.days['2026-10-16']['?'][CV.total], 1100 + 330)
})

test('codexView: today, 7 days, by model, limit windows with labels, stale and missing windows', () => {
  const a = newCodexState()
  feedCodexLine(a, ctx(NOW - 3 * 86400000, 'gpt-a'), 0)
  feedCodexLine(a, tok(NOW - 3 * 86400000, 4000, 400, RL(10)), 0)
  const b = newCodexState()
  feedCodexLine(b, ctx(NOW - H, 'gpt-b'), 0)
  feedCodexLine(b, tok(NOW - H, 1000, 100, RL(55)), 0)
  const cx = aggregateCodex({ a, b }, { now: NOW })
  assert.equal(cx.sessions, 2)
  assert.equal(cx.model, 'gpt-b')
  const cfg = { codex: { window_labels: { 300: 'Fenêtre 5 h', 10080: 'Semaine' }, expected_windows: [300, 10080], stale_limits_h: 24 } }
  const v = codexView(cx, cfg, { now: NOW, tzMin: 0 })
  assert.equal(v.today.total[CV.total], 1100)
  assert.equal(v.week.total[CV.total], 5500)
  assert.deepEqual(v.week.model.map(x => x.key), ['gpt-a', 'gpt-b'])
  assert.equal(v.week.perDay.length, 7)
  assert.equal(v.windows.length, 1)
  assert.equal(v.windows[0].label, 'Semaine')
  assert.equal(v.windows[0].pct, 55) // the newest snapshot wins
  assert.equal(v.windows[0].stale, false)
  assert.deepEqual(v.missing, ['Fenêtre 5 h'])
  assert.equal(codexView(cx, cfg, { now: NOW + 30 * H }).windows[0].stale, true)
  assert.equal(codexView({ available: false, error: 'no_dir', days: {} }, cfg, { now: NOW }).available, false)
  assert.equal(codexView(aggregateCodex({}, { now: NOW }), cfg, { now: NOW }).hasData, false)
})

test('codexEnabled: auto follows the folder, on and off win', () => {
  assert.equal(codexEnabled('auto', true), true)
  assert.equal(codexEnabled('auto', false), false)
  assert.equal(codexEnabled(undefined, true), true)
  assert.equal(codexEnabled('on', false), true)
  assert.equal(codexEnabled('off', true), false)
})

test('scanCodex reads rollout files incrementally and ignores everything else', () => {
  const dir = join(tmp, 'sessions')
  const day = join(dir, '2026', '10', '16')
  mkdirSync(day, { recursive: true })
  const f = join(day, 'rollout-2026-10-16T10-00-00-aaaa.jsonl')
  writeFileSync(f, [ctx(NOW - 2 * H, 'gpt-a'), tok(NOW - 2 * H, 1000, 100, RL(20))].join('\n') + '\n' + tok(NOW - H, 1200, 120).slice(0, 30))
  writeFileSync(join(day, 'notes.jsonl'), tok(NOW - H, 9e9, 9e9) + '\n') // not a rollout file
  writeFileSync(join(dir, 'auth.json'), '{"secret":"x"}')
  const cache = { version: 1, files: {} }
  const r1 = scanCodex({ dir, cache, now: NOW, tzMin: 0 })
  assert.equal(r1.read, 1)
  assert.equal(r1.aggr.days['2026-10-16']['gpt-a'][CV.total], 1100)
  // finish the partial line and add one more event: only the new bytes are read
  appendFileSync(f, tok(NOW - H, 1200, 120).slice(30) + '\n' + tok(NOW - H / 2, 1500, 150, RL(25)) + '\n')
  const r2 = scanCodex({ dir, cache, now: NOW, tzMin: 0 })
  assert.equal(r2.aggr.days['2026-10-16']['gpt-a'][CV.total], 1650)
  assert.equal(r2.aggr.limits.primary.pct, 25)
  assert.ok(r2.bytes < 1000)
  const none = scanCodex({ dir: join(tmp, 'missing'), cache: { version: 1, files: {} }, now: NOW })
  assert.equal(none.aggr.available, false)
})
