// band mod: the Jauge never cuts a field (Julian, 22 Oct, narrow chat column: « ▶ 7 c… .1… .3… » — « I don't understand
// that »). layoutJauge wraps onto a second row, then drops whole fields; the relay is a red chip, then RESUME alone.
// Invented fixtures only. node --test mods/band/tests/wrap.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { cells, jaugeCfg, layoutJauge, relayCells, relayText } from '../hooks/jauge.ts'

const CFG = JSON.parse(readFileSync(new URL('../band.config.json', import.meta.url), 'utf8'))
const jc = jaugeCfg(CFG.jauge)
const RELAY = { hint: jc.labels.relay_hint, button: jc.labels.relay_button, mark: jc.labels.relay_mark }

// busy: 7 conversations, a Workflow, 3 agents, CI cache too old, context 63 % past the relay (62.5 %), 5 h 2 %, sem 77 %
const BUSY = {
  relayAt: 250000,
  relayPct: 62.5,
  waiting: 0,
  ctxPct: 63,
  five: 2,
  week: 77,
  tps: { tps_all: 2100 },
  act: { convs: 7, workflows: 1, agents: 3, ci: { running: 0, failed: 0, stale: true } },
}

// every atomic text a field can show at this facts, full and short labels
const atoms = () => {
  const out = new Set()
  for (const L of [jc.labels, { ...jc.labels, ...jc.labels_short }]) {
    const lay = layoutJauge(jc.line1, BUSY, { ...jc, labels: L, labels_short: {} }, 500)
    for (const r of lay.rows) for (const f of r.line.flat()) out.add(f.text)
  }
  return out
}

for (const cols of [40, 50, 60, 80]) {
  test(`busy Jauge at ${cols} columns: whole fields only, row 1 shows the conv count, nothing wider than the band`, () => {
    const lay = layoutJauge(jc.line1, BUSY, jc, cols, RELAY)
    const ok = atoms()
    assert.ok(lay.rows.length >= 1 && lay.rows.length <= 2)
    for (const [i, r] of lay.rows.entries()) {
      const w = cells(r.text) + (i === 0 ? relayCells(RELAY, lay.relay, jc) : 0)
      assert.ok(w <= cols, `${cols}: row ${i} « ${r.text} » + relay = ${w}`)
      assert.ok(!/\.\.|…/.test(r.text), r.text)
      for (const f of r.line.flat()) assert.ok(ok.has(f.text), `cut field « ${f.text} »`)
      // the row's text is exactly its fields joined: no field squeezed
      assert.equal(r.text, r.line.map(g => g.map(x => x.text).join(r.dot)).join(r.sep))
    }
    assert.match(lay.rows[0].text, /^▶ 7 conv/)
    assert.ok(lay.rows[0].line.flat().some(f => f.id === 'act_conv'))
    assert.notEqual(lay.relay, 'none')
    // context and week are never dropped
    const ids = lay.rows.flatMap(r => r.line.flat().map(f => f.id))
    for (const id of ['context', 'week', 'act_conv']) assert.ok(ids.includes(id), `${cols}: ${id} missing (${ids})`)
  })
}

test('busy at 80: two rows (status, then ctx · 5 h · sem · tok/s), full labels, the red chip next to RESUME', () => {
  const lay = layoutJauge(jc.line1, BUSY, jc, 80, RELAY)
  assert.deepEqual(
    lay.rows.map(r => r.text),
    ['▶ 7 conv · 1 wf · 3 ag · CI ?', 'ctx ▰▰▰▱▱ 63 % │ 5 h ▱▱▱▱▱ 2 % │ sem ▰▰▰▰▱ 77 % │ 2.1k tok/s'],
  )
  assert.equal(lay.relay, 'chip')
  assert.equal(relayText(RELAY, lay.relay), 'relais conseillé')
  assert.deepEqual(lay.dropped, [])
  // zeros grey, non-zero green, as before
  const by = Object.fromEntries(lay.rows[0].line.flat().map(f => [f.id, f.tone]))
  assert.deepEqual(by, { act_conv: 'ok', act_wf: 'ok', act_ag: 'ok', act_ci: 'dim' })
  const zero = layoutJauge(jc.line1, { ...BUSY, act: { convs: 2, workflows: 0, agents: 0, ci: { running: 0, failed: 0, stale: false } } }, jc, 40)
  const z = Object.fromEntries(zero.rows[0].line.flat().map(f => [f.id, f.tone]))
  assert.deepEqual([z.act_wf, z.act_ag, z.act_ci], ['dim', 'dim', 'dim'])
})

test('busy at 40: RESUME alone on row 1, tok/s and 5 h dropped first, the status counts kept', () => {
  const lay = layoutJauge(jc.line1, BUSY, jc, 40, RELAY)
  assert.equal(lay.relay, 'button')
  assert.equal(relayText(RELAY, lay.relay), '')
  assert.equal(lay.rows[0].text, '▶ 7 conv · 1 wf · 3 ag · CI ?')
  assert.deepEqual(lay.dropped, ['tps_all', 'five'])
  assert.equal(lay.rows[1].text, 'ctx ▰▰▰▱▱ 63 % │ sem ▰▰▰▰▱ 77 %')
})

test('drop order is configurable and reaches the activity parts (CI, ag, wf), never conv', () => {
  const tight = jaugeCfg({ ...CFG.jauge, drop_order: ['act_ci', 'act_ag', 'act_wf', 'tps_all', 'five'] })
  const lay = layoutJauge(tight.line1, BUSY, tight, 24)
  assert.match(lay.rows[0].text, /^▶ 7 conv/)
  assert.ok(lay.dropped.includes('act_ci'))
  assert.ok(!lay.rows[0].line.flat().some(f => f.id === 'act_ci'))
})

test('wide and idle: one row as before; wrap_at moves the split', () => {
  const idle = { ...BUSY, ctxPct: 19, act: { convs: 0, workflows: 0, agents: 0, ci: { running: 0, failed: 0, stale: false } } }
  const one = layoutJauge(jc.line1, idle, jc, 120)
  assert.equal(one.rows.length, 1)
  assert.equal(one.relay, 'none')
  assert.match(one.rows[0].text, /^✓ au repos │ ctx /)
  const atWeek = jaugeCfg({ ...CFG.jauge, wrap_at: 'week' })
  const two = layoutJauge(atWeek.line1, BUSY, atWeek, 80)
  assert.match(two.rows[1].text, /^sem /)
})
