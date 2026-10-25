// band mod: the clarity Jauge's rows (hooks/clarity.ts), pure.   node --test mods/band/tests/clarity.test.mjs
// Invented fixtures only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { clarityCfg, clarityView, rowCells, segsText } from '../hooks/clarity.ts'
import { jaugeCfg } from '../hooks/jauge.ts'

const shipped = JSON.parse(readFileSync(new URL('../band.config.json', import.meta.url), 'utf8'))
const cc = clarityCfg(shipped.jauge.clarity)
const lv = jaugeCfg(shipped.jauge).levels
const NOW = Date.parse('2026-10-25T10:00:00Z')
const MIN = 60000
const agent = (id, extra = {}) => ({ id, type: 'coder', label: `lane-${id}`, model: 'opus', status: 'running', start: NOW - 20 * MIN, last: NOW - MIN, ...extra })
const WF = { id: 'w1', name: 'release-wave', phases: ['Plan', 'Build', 'Verify', 'Merge'], phase: 'Verify', phaseIdx: 2, status: 'running', start: NOW - 40 * MIN, last: NOW - MIN, eta: NOW + 10 * MIN, agents: [agent('a'), agent('b', { tokens: 1240000 })] }
const base = { now: NOW, working: false, running: null, ctxPct: 30, tokens: 120000, window: 400000, relayAt: 250000, relayPct: 62.5, five: 3, week: 11, tps: 473 }
const text = r => segsText(r.segs)

test('shipped config: the clarity layout is the default and every label has a value', () => {
  assert.equal(shipped.jauge.layout, 'clarity')
  for (const [k, v] of Object.entries(cc.labels)) assert.equal(typeof v, 'string', k)
  assert.deepEqual(cc.sections, ['running', 'gauges', 'pc', 'mods'])
})

test('folded: ONE row, the running state first, grey when nothing runs', () => {
  const v = clarityView(base, cc, lv, 120, false)
  assert.equal(v.rows.length, 1)
  assert.match(text(v.rows[0]), /^▶ ○ rien en cours · ctx ▰▰▱▱▱ 30 % · 5 h ▱▱▱▱▱ 3 % · sem ▰▱▱▱▱ 11 %$/)
  assert.equal(v.tone, 'dim')
})

test('folded: what runs in this conversation, coloured by its worst state', () => {
  const ok = clarityView({ ...base, running: { workflows: [WF], agents: [agent('c', { shape: 'background' })] } }, cc, lv, 120, false)
  assert.match(text(ok.rows[0]), /^▶ ● 1 workflow · 3 agents en cours · ctx/)
  assert.equal(ok.tone, 'ok')
  const silent = clarityView({ ...base, running: { workflows: [], agents: [agent('c', { last: NOW - 20 * MIN })] } }, cc, lv, 120, false)
  assert.equal(silent.tone, 'warn')
  assert.match(text(silent.rows[0]), /1 agent en cours · 1 silencieux/)
  const failed = clarityView({ ...base, running: { workflows: [], agents: [agent('c', { status: 'failed' })] } }, cc, lv, 120, false)
  assert.equal(failed.tone, 'bad')
  const main = clarityView({ ...base, working: true }, cc, lv, 120, false)
  assert.match(text(main.rows[0]), /^▶ ● Claude travaille/)
})

test('unfolded: sections after a blank line, a header each, tree rows with ├ └ │, zeros left out', () => {
  const pc = { convs: 4, workflows: 0, agents: 2, ci: { running: 0, failed: 0, stale: true } }
  const v = clarityView({ ...base, running: { workflows: [WF], agents: [agent('c', { shape: 'background' })] }, pc }, cc, lv, 120, true)
  const lines = v.rows.map(text)
  assert.match(lines[0], /^▼ /)
  const heads = v.rows.filter(r => r.kind === 'header').map(text)
  assert.deepEqual(heads, ['  En cours · cette conversation', '  Jauges', '  Ailleurs sur ce PC', '  Mods'])
  for (const r of v.rows.filter(r => r.kind === 'header')) assert.equal(v.rows[v.rows.indexOf(r) - 1].kind, 'blank')
  assert.ok(lines.some(l => /^  ├ ◇ release-wave ▰▰▰▰▰▱▱▱▱▱ 50 % · 2\/4 · ▸ Verify · 40 min · fin ~\d\d:\d\d$/.test(l)), lines.join('\n'))
  assert.ok(lines.some(l => /^  │ ├ • coder lane-a · opus · 20 min$/.test(l)))
  assert.ok(lines.some(l => /^  │ └ • coder lane-b · opus · 20 min · 1,2 M tok$/.test(l)))
  assert.ok(lines.some(l => /^  └ ◦ coder lane-c · opus · 20 min$/.test(l)))
  assert.ok(lines.some(l => /^  ├ ctx +▰▰▰▱▱▱▱▱▱▱ +30 % · 120 k \/ 400 k · relais 250 k$/.test(l)))
  assert.ok(lines.some(l => /^  └ débit 473 tok\/s$/.test(l)))
  assert.ok(lines.includes('  └ 4 conv · 2 ag · CI ?'))
  assert.ok(!lines.some(l => /arrière-plan|0 wf/.test(l)))
})

test('gauges: green → orange → red from jauge.levels, and the thresholds are settings', () => {
  const v = clarityView({ ...base, ctxPct: 70, five: 65, week: 90 }, cc, lv, 160, true)
  const tone = id => v.rows.find(r => r.key === `gauge-${id}`).segs.find(s => s.bar !== undefined).tone
  assert.deepEqual([tone('context'), tone('five'), tone('week')], ['bad', 'warn', 'bad'])
  const loose = { ...lv, quota: { ...lv.quota, warn_pct: 70, bad_pct: 95 } }
  const w = clarityView({ ...base, five: 65, week: 90 }, cc, loose, 160, true)
  assert.equal(w.rows.find(r => r.key === 'gauge-five').segs.find(s => s.bar !== undefined).tone, 'ok')
  assert.equal(w.rows.find(r => r.key === 'gauge-week').segs.find(s => s.bar !== undefined).tone, 'warn')
})

test('every row fits from 40 to 120 columns; the relay keeps RESUME', () => {
  const f = { ...base, working: true, waiting: 2, running: { workflows: [WF], agents: [agent('c', { label: 'a-very-long-background-agent-name' })] }, pc: { convs: 7, workflows: 1, agents: 3 } }
  for (const cols of [40, 50, 60, 80, 120]) {
    for (const expanded of [false, true]) {
      const v = clarityView(f, cc, lv, cols, expanded, { hint: 'relais conseillé', button: 'RESUME', pad: 4 })
      assert.notEqual(v.relay, 'none')
      assert.ok(rowCells(v.rows[0]) + v.reserve <= cols, `${cols}: ${text(v.rows[0])}`)
      for (const r of v.rows.slice(1)) assert.ok(rowCells(r) <= cols, `${cols}: ${text(r)}`)
    }
  }
})

test('labels and glyphs come from the config', () => {
  const own = clarityCfg({ ...shipped.jauge.clarity, glyphs: { closed: '+' }, labels: { idle: 'idle' }, blank_lines: false, sections: ['gauges'] })
  const v = clarityView(base, own, lv, 120, true)
  assert.match(text(v.rows[0]), /^▼ ○ idle/)
  assert.ok(!v.rows.some(r => r.kind === 'blank'))
  assert.deepEqual(v.rows.filter(r => r.kind === 'header').map(text), ['  Jauges'])
  assert.match(text(clarityView(base, own, lv, 120, false).rows[0]), /^\+ ○ idle/)
})
