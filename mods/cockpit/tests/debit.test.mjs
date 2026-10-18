// node --test mods/cockpit/tests/debit.test.mjs - the Panneau's « Débit » (tokens per second), invented fixtures only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { debitModel, streamStats, rowStats, modelLabel, fitColumns, secText, tpsText, tokText } from '../lib/debit.mjs'
import { aggregate, feedLine, newFileState, tpsBucket } from '../lib/core/transcripts.mjs'
import { panneauText } from '../scripts/fixtures/panneau.mjs'

const NOW = Date.parse('2026-10-16T16:30:00Z')
const H = Math.floor(NOW / 3600000) * 3600000
const MIN = 60000
// one TPS row [output tokens, ms, streams, {bucket: streams}] from streams [[out, ms], ...]
const row = (...xs) => {
  const r = [0, 0, 0, {}]
  for (const [out, ms] of xs) {
    r[0] += out
    r[1] += ms
    r[2]++
    const b = tpsBucket(out / (ms / 1000))
    r[3][b] = (r[3][b] || 0) + 1
  }
  return r
}
const near = (a, b, pct = 7.5) => Math.abs(a - b) <= (b * pct) / 100

test('weighted TPS is the sum of tokens over the sum of time, not the mean of the speeds', () => {
  // 100 tok in 1 s (100 TPS) and 900 tok in 9 s... and 1000 tok in 40 s (25 TPS)
  const s = streamStats([{ out: 100, ms: 1000 }, { out: 1000, ms: 40000 }])
  assert.equal(s.n, 2)
  assert.equal(s.out, 1100)
  assert.equal(s.ms, 41000)
  assert.ok(Math.abs(s.weighted - 1100 / 41) < 1e-9)
  assert.ok(Math.abs(s.median - 62.5) < 1e-9) // even count: the mean of the two middle speeds
  assert.equal(s.lo, 25)
  assert.equal(s.hi, 100)
  const odd = streamStats([{ out: 300, ms: 10000 }, { out: 500, ms: 10000 }, { out: 800, ms: 10000 }])
  assert.equal(odd.median, 50)
  assert.equal(streamStats([]).weighted, undefined)
})

test('hourly rows: weighted exact, median and range read in the x1.15 buckets (±7 %)', () => {
  const s = rowStats([row([600, 10000], [400, 10000]), row([2000, 20000])])
  assert.equal(s.n, 3)
  assert.equal(s.out, 3000)
  assert.ok(Math.abs(s.weighted - 75) < 1e-9)
  assert.ok(near(s.median, 60), String(s.median))
  assert.ok(near(s.lo, 40), String(s.lo))
  assert.ok(near(s.hi, 100), String(s.hi))
})

test('window cuts: 30 min from the exact streams, 1 j / 7 j / 30 j by whole clock hours', () => {
  const debit = {
    generated: NOW, tzMin: 0,
    hourly: {
      [`${H}|claude-opus-5-5|medium`]: row([600, 10000]),
      [`${H - 23 * 3600000}|claude-opus-5-5|medium`]: row([500, 10000]),
      [`${H - 30 * 3600000}|claude-opus-5-5|high`]: row([400, 10000]), // 7 j only
      [`${H - 20 * 86400000}|claude-opus-5-5-20261001|medium`]: row([300, 10000]), // 30 j only, dated id merges
      [`${H - 40 * 86400000}|claude-opus-5-5|medium`]: row([200, 10000]), // past 30 j: left out
      [`${H}|claude-sonnet-5-5|low`]: row([900, 10000]),
    },
    recent: [
      { ts: NOW - 5 * MIN, model: 'claude-opus-5-5', effort: 'medium', out: 600, ms: 10000 },
      { ts: NOW - 45 * MIN, model: 'claude-opus-5-5', effort: 'medium', out: 999, ms: 10000 }, // older than 30 min
      { ts: NOW - 2 * MIN, model: 'claude-sonnet-5-5', effort: 'low', out: 900, ms: 10000 },
    ],
    streams: [],
  }
  const m = debitModel({ debit, now: NOW })
  assert.equal(m.ready, true)
  assert.deepEqual(m.cards.map((k) => k.label), ['opus 5.5', 'sonnet 5.5']) // by output tokens over 30 j
  const opus = Object.fromEntries(m.cards[0].rows.map((r) => [r.id, r]))
  assert.equal(opus['30m'].n, 1)
  assert.equal(opus['30m'].out, 600)
  assert.equal(opus['30m'].exact, true)
  assert.equal(opus['1d'].n, 2)
  assert.equal(opus['1d'].out, 1100)
  assert.equal(opus['7d'].n, 3)
  assert.equal(opus['30d'].n, 4)
  assert.equal(opus['30d'].out, 1800)
  assert.ok(Math.abs(opus['30d'].weighted - 1800 / 40) < 1e-9)
  // the last streams, newest first; green at or above the model's 1 j median
  assert.deepEqual(m.streams.map((s) => s.label), ['sonnet 5.5', 'opus 5.5', 'opus 5.5'])
  assert.equal(m.streams[0].effort, 'low')
  assert.ok(Math.abs(m.streams[1].tps - 60) < 1e-9)
  assert.equal(m.streams[1].fast, true) // 60 TPS against a 1 j median of ~55
  assert.equal(m.streams[2].fast, true) // 99.9 TPS
  assert.equal(m.codex, 'off')
})

test('Codex: shown only with the toggle, by whole local days, « non lu » when codex.json has no timings', () => {
  const debit = { generated: NOW, tzMin: 0, hourly: {}, recent: [], streams: [] }
  const codex = { tps: { '2026-10-16|gpt-5-codex|high': row([600, 10000]), '2026-10-01|gpt-5-codex|high': row([300, 10000]) }, streams: [{ ts: NOW - MIN, model: 'gpt-5-codex', effort: 'high', out: 600, ms: 10000 }] }
  assert.equal(debitModel({ debit, codex, showCodex: false, now: NOW }).cards.length, 0)
  const m = debitModel({ debit, codex, showCodex: true, now: NOW })
  assert.equal(m.codex, 'read')
  assert.equal(m.cards[0].label, 'Codex gpt-5-codex')
  const r = Object.fromEntries(m.cards[0].rows.map((x) => [x.id, x]))
  assert.equal(r['30m'].n, 1)
  assert.equal(r['1d'].n, 1) // today only
  assert.equal(r['7d'].n, 1)
  assert.equal(r['30d'].n, 2)
  assert.equal(debitModel({ debit, codex: { days: {} }, showCodex: true, now: NOW }).codex, 'unread')
  assert.equal(debitModel({ debit: null, now: NOW }).ready, false)
})

test('names, widths and formats', () => {
  assert.equal(modelLabel('claude-opus-5-5'), 'opus 5.5')
  assert.equal(modelLabel('claude-fable-5-1-20261001'), 'fable 5.1')
  assert.equal(modelLabel('gpt-5-codex'), 'gpt-5-codex')
  assert.equal(modelLabel('claude-opus-5-5', { 'claude-opus-5-5': 'Opus' }), 'Opus')
  const cols = [{ id: 'n', w: 8 }, { id: 'tokens', w: 6 }, { id: 'time', w: 7 }, { id: 'tps', w: 11 }, { id: 'median', w: 7 }, { id: 'range', w: 9 }]
  assert.deepEqual(fitColumns(cols, 74, 6).map((x) => x.id), ['n', 'tokens', 'time', 'tps', 'median', 'range'])
  assert.deepEqual(fitColumns(cols, 55, 6).map((x) => x.id), ['n', 'tokens', 'time', 'tps', 'median']) // Plage first
  assert.deepEqual(fitColumns(cols, 44, 6).map((x) => x.id), ['n', 'tokens', 'tps', 'median']) // then Temps
  assert.equal(secText(2890), '2.89 s')
  assert.equal(secText(24000), '24.0 s')
  assert.equal(secText(65000), '1m 05s')
  assert.equal(tpsText(59.14), '59.1')
  assert.equal(tpsText(164.4), '164')
  assert.equal(tokText(3781), '3.8K')
})

test('the usage scan keeps every stream of the last hour and hourly TPS rows (message.id + requestId once)', () => {
  const st = newFileState('main')
  const line = (o) => JSON.stringify(o)
  const ts = (s) => new Date(NOW - 40 * MIN + s * 1000).toISOString()
  // 15 responses, each sent by a prompt; the 3rd response is written twice (two content blocks, same id): counted once
  for (let i = 0; i < 15; i++) {
    feedLine(st, line({ type: 'user', timestamp: ts(i * 60), message: { role: 'user', content: 'x' } }))
    const a = { type: 'assistant', timestamp: ts(i * 60 + 4), requestId: 'req' + i, sessionId: 's', message: { id: 'msg' + i, model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 200 } } }
    feedLine(st, line(a))
    if (i === 2) feedLine(st, line({ ...a, timestamp: ts(i * 60 + 5), message: { ...a.message, usage: { input_tokens: 1, output_tokens: 250 } } }))
  }
  assert.equal(st.streams.length, 15) // more than the 10 kept for the usage pane: all of the last hour
  const ag = aggregate({ f: st }, { now: NOW, days: 31 })
  assert.equal(ag.recentStreams.length, 15)
  const rows = Object.values(ag.tpsHourly)
  assert.equal(rows.reduce((a, r) => a + r[2], 0), 15)
  assert.equal(rows.reduce((a, r) => a + r[0], 0), 14 * 200 + 250)
  const m = debitModel({ debit: { generated: NOW, tzMin: 0, hourly: ag.tpsHourly, recent: ag.recentStreams, streams: ag.streams }, now: NOW })
  assert.equal(m.cards[0].rows.find((r) => r.id === '30m').n, 5) // one a minute from 40 min ago: the last 5 are within 30 min
  assert.equal(m.cards[0].rows.find((r) => r.id === '1d').n, 15)
  assert.equal(m.streams.length, 10)
})

test('preview: Débit is one line after Quotas, its tables one click away, numbers whole at 45, 60 and 75 columns', () => {
  const OPEN = { conv: true, convs: true, debit: true }
  const macro = panneauText(75)
  assert.ok(macro.indexOf('[DÉBIT]') > macro.indexOf('[QUOTAS]'))
  assert.ok(macro.indexOf('[DÉBIT]') < macro.indexOf('[GRAPHE]'))
  // folded: the 30 min weighted TPS of each model in use, on one line; no table, no footnote
  assert.match(macro, /\[DÉBIT\] opus 56 · sonnet 88 · haiku 164 TPS \(30 min\) \[›\]/)
  assert.doesNotMatch(macro, /Modèle : |Fenêtre|message\.id/)
  const t75 = panneauText(75, { open: OPEN })
  assert.match(t75, /Modèle : opus 5\.5/)
  assert.match(t75, /Fenêtre\s+Réponses\s+Tokens\s+Temps TPS pondéré\s+Médiane\s+Plage/)
  assert.match(t75, /\d\d:\d\d:\d\d {2}opus 5\.5 medium : 59\.2 TPS \(171 tok en 2\.89 s\)/)
  assert.match(t75, /10 derniers flux|\d derniers flux/)
  // a model with no reply in 7 days (fable: 30 j only) is behind « anciens › »; the footnote behind « comment c'est mesuré › »
  assert.doesNotMatch(t75, /Modèle : fable/)
  assert.match(t75, /\[anciens \(1\) ›\]/)
  assert.match(panneauText(75, { open: { ...OPEN, 'pd-old': true } }), /\[anciens \(1\) ⌄\][\s\S]*Modèle : fable 5\.1/)
  assert.doesNotMatch(t75, /message\.id \+ requestId/)
  assert.match(t75, /\[comment c’est mesuré ›\]/)
  assert.match(panneauText(75, { open: { ...OPEN, 'pd-note': true } }), /message\.id \+ requestId/)
  assert.doesNotMatch(t75, /Codex gpt/) // Codex models only with the toggle
  const t60 = panneauText(60, { open: OPEN })
  assert.match(t60, /Fenêtre\s+Réponses\s+Tokens\s+Temps TPS pondéré\s+Médiane\n/)
  const t45 = panneauText(45, { open: OPEN })
  assert.match(t45, /Rép\.\s+Tok\.\s+Temps\s+TPS\s+Méd\.\n/) // two steps in: the short headers, no number cut
  for (const k of ['1113', '2.4M', '58.9', '61.7']) assert.ok(t45.includes(k), k)
  assert.match(panneauText(75, { who: 'codex', open: OPEN }), /Modèle : Codex gpt-5-codex/)
  assert.match(panneauText(75, { debit: null, open: OPEN }), /debit\.json/)
})

test('model: the models in use (a reply in 7 days) and the old ones apart; the macro line over the shortest window with replies', () => {
  const H0 = Math.floor(NOW / 3600000) * 3600000
  const debit = { generated: NOW, tzMin: 0, recent: [], streams: [], hourly: {
    [`${H0 - 2 * 3600000}|claude-opus-5-5|medium`]: row([600, 10000]),
    [`${H0 - 400 * 3600000}|claude-sonnet-5|low`]: row([300, 10000]),
  } }
  const m = debitModel({ debit, now: NOW })
  assert.deepEqual(m.cards.map((k) => k.label), ['opus 5.5'])
  assert.deepEqual(m.old.map((k) => k.label), ['sonnet 5'])
  // no reply in 30 min: the macro line takes 1 j
  assert.equal(m.macro.window, '1 j')
  assert.deepEqual(m.macro.list.map((x) => [x.label, Math.round(x.tps)]), [['opus', 60]])
})
