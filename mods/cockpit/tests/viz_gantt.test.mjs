// The Gantts of the Panneau (lib/viz_gantt.mjs, hooks/viz_gantt.mjs): time axis, bar positions, the now line, the
// ETA, stalled bars, the text fallback and the SVG. Invented fixtures only; times are local (runs with any TZ).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { axis, dayStart, etaOf, cardSpan, dayGantt, wfGantt, textCells, tickLine, dominantFamily, hourLabel } from '../lib/viz_gantt.mjs'
import { modelFamily, palette, modelColor, MODEL_COLORS } from '../lib/viz_palette.mjs'
import { ganttSvg } from '../hooks/viz_gantt.mjs'
import { panneauText } from '../scripts/fixtures/panneau.mjs'

const MIN = 60000
const HOUR = 3600000
const DAY0 = dayStart(Date.parse('2026-10-16T12:00:00Z'))
const NOW = DAY0 + 16 * HOUR + 30 * MIN // 16:30 local
const at = (h, m = 0) => DAY0 + h * HOUR + m * MIN
const A = (id, model, status, from, to) => ({ id, model, status, ts: from, ms: (status === 'running' ? NOW : to) - from, tokens: 1000 })
const card = (key, o, agents) => ({ key, title: key, live: false, stalled: false, failed: false, eta: '', phases: [{ key: key + '-ph0', title: 'Wave', agents }], ...o })

test('palette: one colour per model family, states, config overrides', () => {
  assert.equal(modelFamily('Opus 5.5'), 'opus')
  assert.equal(modelFamily('claude-sonnet-5-5'), 'sonnet')
  assert.equal(modelFamily('gpt-5-codex'), 'codex')
  assert.equal(modelFamily('?'), 'other')
  assert.equal(modelColor('Haiku 5.5'), MODEL_COLORS.haiku)
  const p = palette({ warn: '#ffaa00', model_opus: '#ff0000' })
  assert.equal(p.states.warn, '#ffaa00')
  assert.equal(p.models.opus, '#ff0000')
  assert.equal(p.models.fable, MODEL_COLORS.fable)
})

test('axis: fractions from t0 to t1, hour ticks at a round local step', () => {
  const ax = axis(at(14), at(17), 6)
  assert.equal(ax.x(at(14)), 0)
  assert.equal(ax.x(at(17)), 1)
  assert.equal(ax.x(at(15, 30)), 0.5)
  assert.equal(ax.x(at(20)), 1) // clamped
  assert.deepEqual(ax.ticks.map((t) => t.label), ['14h', '14h30', '15h', '15h30', '16h', '16h30', '17h'])
  assert.deepEqual(axis(at(8), at(18), 6).ticks.map((t) => t.label), ['8h', '10h', '12h', '14h', '16h', '18h'])
  assert.equal(hourLabel(at(9, 5)), '9h05')
})

test('ETA: k.etaMs, else « HH:MM » today; none when finished or past', () => {
  assert.equal(etaOf({ live: true, eta: '16:55' }, NOW), at(16, 55))
  assert.equal(etaOf({ live: true, etaMs: at(17) }, NOW), at(17))
  assert.equal(etaOf({ live: false, eta: '16:55' }, NOW), null)
  assert.equal(etaOf({ live: true, eta: '16:10' }, NOW), null)
  assert.equal(etaOf({ live: true, eta: '' }, NOW), null)
})

test('a card as a bar: first start to now (live) or last end, the dominant model, its state', () => {
  const k = card('w', { live: true }, [A('a', 'Opus 5.5', 'running', at(16), null), A('b', 'Haiku 5.5', 'done', at(15, 50), at(15, 55))])
  const s = cardSpan(k, NOW)
  assert.equal(s.start, at(15, 50))
  assert.equal(s.end, NOW)
  assert.equal(s.family, 'opus')
  assert.equal(s.state, 'running')
  assert.equal(cardSpan({ ...k, stalled: true }, NOW).state, 'stalled')
  assert.equal(cardSpan({ ...k, failed: true }, NOW).state, 'failed')
  const done = card('d', {}, [A('a', 'Sonnet 5.5', 'done', at(10), at(11)), A('b', 'Sonnet 5.5', 'done', at(11), at(12))])
  assert.equal(cardSpan(done, NOW).end, at(12))
  assert.equal(cardSpan(card('e', {}, [{ id: 'x', model: 'opus', status: 'waiting', ts: 0, ms: 0 }]), NOW), null)
  assert.equal(dominantFamily([A('a', 'Sonnet 5.5', 'done', at(10), at(12)), A('b', 'Opus 5.5', 'done', at(10), at(10, 5))], NOW), 'sonnet')
})

test('day Gantt: one track per active conversation (max 6), bar positions, now line, ETA, stalled, ticks', () => {
  const alpha = { key: 'a', label: 'Lane alpha', active: true, cards: [
    card('w1', { live: true, eta: '17:00' }, [A('x', 'Opus 5.5', 'running', at(15, 30), null)]),
    card('w0', {}, [A('y', 'Haiku 5.5', 'done', at(15), at(15, 15))]),
  ] }
  const delta = { key: 'd', label: 'Lane delta', active: true, cards: [card('w2', { live: true, stalled: true }, [A('z', 'Sonnet 5.5', 'running', at(16), null)])] }
  const idle = { key: 'i', label: 'idle', active: false, cards: [card('w3', {}, [A('q', 'Opus 5.5', 'done', at(9), at(10))])] }
  const yesterday = { key: 'y', label: 'old', active: true, cards: [card('w4', {}, [A('q', 'Opus 5.5', 'done', DAY0 - 3 * HOUR, DAY0 - 2 * HOUR)])] }
  const m = dayGantt([alpha, delta, idle, yesterday], NOW)
  assert.equal(m.empty, false)
  assert.deepEqual(m.tracks.map((t) => t.key), ['a', 'd']) // inactive and yesterday-only left out
  assert.equal(m.t0, at(15)) // the hour of the first bar
  assert.equal(m.t1, at(17)) // the hour after the latest ETA
  assert.equal(m.now, 0.75)
  const [b0, b1] = m.tracks[0].bars // sorted by start
  assert.deepEqual([b0.key, b0.x0, b0.x1, b0.state, b0.family, b0.eta], ['w0', 0, 0.125, 'done', 'haiku', null])
  assert.deepEqual([b1.key, b1.x0, b1.x1, b1.state, b1.family, b1.eta], ['w1', 0.25, 0.75, 'running', 'opus', 1])
  assert.equal(m.tracks[1].bars[0].state, 'stalled')
  assert.deepEqual(m.ticks.map((t) => t.label), ['15h', '15h30', '16h', '16h30', '17h'])
  // max 6 tracks, the rest counted; a bar from before midnight starts at the axis
  const many = Array.from({ length: 8 }, (_, i) => ({ key: 'c' + i, label: 'c' + i, active: true, cards: [card('k' + i, {}, [A('a', 'Opus', 'done', DAY0 - HOUR, at(16))])] }))
  const mm = dayGantt(many, NOW)
  assert.equal(mm.tracks.length, 6)
  assert.equal(mm.more, 2)
  assert.equal(mm.t0, DAY0)
  assert.equal(mm.tracks[0].bars[0].x0, 0)
  assert.equal(dayGantt([idle], NOW).empty, true)
})

test('Workflow Gantt: one row per agent by phase, pending without a bar, ETA dashed on the running ones', () => {
  const k = { key: 'w', live: true, stalled: false, eta: '17:00', phases: [
    { key: 'p0', title: 'Wave A', agents: [A('a', 'Sonnet 5.5', 'done', at(16), at(16, 15)), A('b', 'Haiku 5.5', 'done', at(16), at(16, 5))] },
    { key: 'p1', title: 'Wave B', agents: [A('c', 'Opus 5.5', 'running', at(16, 15), null)] },
    { key: 'p2', title: 'Merge', agents: [{ id: 'd', model: 'Sonnet 5.5', status: 'waiting', ts: 0, ms: 0 }] },
  ] }
  const m = wfGantt(k, NOW)
  assert.equal(m.t0, at(16))
  assert.equal(m.t1, at(17))
  assert.equal(m.now, 0.5)
  assert.equal(m.eta, 1)
  assert.deepEqual(m.phases.map((p) => p.title), ['Wave A', 'Wave B', 'Merge'])
  assert.deepEqual(m.phases[0].rows.map((r) => [r.family, r.state, r.x0, r.x1]), [['sonnet', 'done', 0, 0.25], ['haiku', 'done', 0, 1 / 12]])
  assert.deepEqual([m.phases[1].rows[0].state, m.phases[1].rows[0].eta], ['running', 1])
  assert.deepEqual([m.phases[2].rows[0].state, m.phases[2].rows[0].x0], ['pending', null])
  assert.equal(wfGantt({ ...k, stalled: true }, NOW).phases[1].rows[0].state, 'stalled')
  const done = wfGantt({ ...k, live: false }, NOW)
  assert.equal(done.now, null)
  assert.equal(done.eta, null)
})

test('text fallback: █ bars, ▓ the running end, ▒ stalled, ░ ETA, │ now on an empty cell', () => {
  const s = (runs) => runs.map((r) => r.text).join('')
  assert.equal(s(textCells([{ x0: 0, x1: 0.5, state: 'done' }], 10, 0.8)), '█████   │ ')
  assert.equal(s(textCells([{ x0: 0.2, x1: 0.5, eta: 0.9, state: 'running' }], 10, 0.5)), '  ██▓░░░░ ')
  assert.equal(s(textCells([{ x0: 0, x1: 0.3, state: 'stalled' }], 10)), '▒▒▒       ')
  assert.equal(textCells([{ x0: 0, x1: 0.3, state: 'failed' }], 10)[0].kind, 'failed')
  assert.equal(s(textCells([{ x0: null, x1: null, state: 'pending' }], 4, 0.5)), '  │ ')
  assert.equal(tickLine([{ x: 0, label: '15h' }, { x: 0.1, label: '16h' }, { x: 0.5, label: '17h' }], 10), '15h  17h  ')
})

test('SVG: bars in model colours, hatched stalled, dashed ETA, the now line, a tiny legend', () => {
  const pal = palette()
  const svg = ganttSvg([{ label: 'Lane <a>', bars: [{ x0: 0, x1: 0.5, eta: 0.8, state: 'running', family: 'opus' }, { x0: 0.6, x1: 0.7, state: 'stalled', family: 'sonnet' }] }, { phase: 'Wave B' }],
    { now: 0.5, ticks: [{ x: 0, label: '15h' }] }, pal, { width: 300, legend: [{ kind: 'model', family: 'opus', text: 'opus' }, { kind: 'now', text: 'maintenant' }] })
  assert.match(svg, /^<svg [^>]*width="300"/)
  assert.ok(svg.includes(MODEL_COLORS.opus))
  assert.match(svg, /fill="url\(#gh\)"/)
  assert.match(svg, /stroke-dasharray="3 2"/)
  assert.ok(svg.includes(`stroke="${pal.ink.now}"`))
  assert.ok(svg.includes('Lane &lt;a&gt;') && svg.includes('Wave B') && svg.includes('maintenant') && svg.includes('15h'))
  const h = Number(/height="(\d+)"/.exec(svg)[1])
  assert.ok(h < 80, 'small: ' + h)
})

test('Panneau: « Aujourd’hui » inside Graphe unfolded (not in the default view), folded with its title; a Workflow unfolded shows its Gantt', () => {
  for (const cols of [45, 60, 75]) {
    assert.doesNotMatch(panneauText(cols), /Aujourd’hui/)
    const t = panneauText(cols, { open: { convs: true, graphe: true } })
    assert.match(t, /\n {2}\[Aujourd’hui ⌄\][^\n]*\n {2}Lane alpha[^\n]*▕[^\n]*▏\n {2}Lane delta[^\n]*▕[^\n]*▏\n[^\n]*\dh/, t)
    for (const l of t.split('\n')) assert.ok([...l].length <= cols, `${cols}: ${l}`)
  }
  const folded = panneauText(75, { open: { convs: true, graphe: true }, closed: { pgantt: true } })
  assert.match(folded, /\[Aujourd’hui ›\][^\n]*\n─ \[Fichiers\]/)
  // a Workflow's title unfolds its tokens, cost and Gantt under its row, behind the rule
  const wf = panneauText(75, { closed: { 'pfw-wf_1': false } })
  assert.match(wf, /│  ◇ \[package-wave\] · workflow[^\n]*\n│  │  4 agents  2\.0M tokens[^\n]*\n│  │  Wave A\n│  │  sonnet\s+▕█+[^\n]*▏\n/, wf)
})
