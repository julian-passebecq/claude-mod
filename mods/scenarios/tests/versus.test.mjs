// « Claude vs GPT » data and helpers: node --test mods/scenarios/tests/versus.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { blended, checkVersus, rowLine, rowsFor, scatterSvg, scoreConfirmed, versusText, vsLabels } from '../hooks/versus.ts'
import { VERSUS } from './versus_shipped.ts'

const raw = readFileSync(new URL('../versus.json', import.meta.url), 'utf8')
const shipped = JSON.parse(raw)

test('the shipped versus.json has no problems; every number carries an https source and an ISO date', () => {
  assert.deepEqual(checkVersus(shipped), [])
  for (const s of shipped.scores) if (typeof s.value === 'number') {
    assert.match(s.source_url, /^https:\/\//)
    assert.match(s.source_date, /^\d{4}-\d{2}-\d{2}$/)
  }
  for (const p of shipped.prices) assert.match(p.source_url, /^https:\/\//)
  const vendors = new Set(shipped.models.map(m => m.vendor))
  assert.deepEqual([...vendors].sort(), ['anthropic', 'openai'])
})

test('the test kit copy matches versus.json (node mods/scenarios/scripts/regen-shipped.mjs)', () => {
  assert.deepEqual(JSON.parse(VERSUS), shipped)
})

// invented figures below, only to test the rules
const file = {
  checked: '2026-01-02',
  blend: { in: 1, out: 1 },
  benchmarks: [{ id: 'b', label: 'Bench B' }],
  models: [
    { id: 'c1', vendor: 'anthropic', label: 'Claude Test' },
    { id: 'g1', vendor: 'openai', label: 'GPT-Test' },
    { id: 'c2', vendor: 'anthropic', label: 'Claude Sans Source' },
  ],
  prices: [
    { model: 'c1', in: 2, out: 4, source_url: 'https://example.test/p', source_date: '2026-01-01' },
    { model: 'g1', in: 1, out: 3, source_url: 'https://example.test/p', source_date: '2026-01-01' },
  ],
  scores: [
    { model: 'c1', bench: 'b', value: 50, effort: 'high', reported_by: 'A', source_url: 'https://example.test/s', source_date: '2026-01-01' },
    { model: 'g1', bench: 'b', value: 60, reported_by: 'B', source_url: 'https://example.test/s', source_date: '2026-01-01' },
    { model: 'c2', bench: 'b', value: 99, reported_by: 'rumour' },
  ],
}

test('a number without a source is a problem and shows « non confirmé », never as a point', () => {
  assert.deepEqual(checkVersus(file), ['score c2 b: a number without an https source and a YYYY-MM-DD date'])
  const rows = rowsFor(file, 'b')
  assert.deepEqual(rows.map(r => [r.model.id, r.confirmed]), [['g1', true], ['c1', true], ['c2', false]])
  assert.equal(scoreConfirmed(file.scores[2]), false)
  assert.match(rowLine(vsLabels(file), rows[2]), /Claude Sans Source · non confirmé \(rumour\) · prix non confirmé/)
  assert.doesNotMatch(scatterSvg(file, 'b'), /Sans Source/)
  assert.match(scatterSvg(file, 'b'), /<svg[^>]*>.*Test 50.*<\/svg>/)
})

test('blended cost follows the file weights; a price without source has no cost', () => {
  assert.equal(blended(file.prices[0], { in: 1, out: 1 }), 3)
  assert.equal(blended(file.prices[0], { in: 3, out: 1 }), 2.5)
  assert.equal(blended({ model: 'x', in: 1, out: 1 }, {}), null)
  assert.match(versusText(file, 'b'), /Claude vs GPT · Bench B · vérifié le 2026-01-02/)
  assert.match(versusText(file, 'b'), /GPT-Test · 60 % \(B\) · 2.0 \$\/M · 2026-01-01/)
})

test('an empty or missing file says so instead of throwing', () => {
  assert.deepEqual(checkVersus(undefined), ['versus.json: absent ou illisible'])
  assert.deepEqual(rowsFor(undefined, 'b'), [])
  assert.match(versusText({}), /aucun benchmark/)
})
