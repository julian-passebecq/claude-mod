// registres mod: pure helpers, and the copies of the owners' views drawn with an invented element table.
//   node --test mods/registres/tests/logic.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { aliasesToRegister, deepMerge, isStale, parseArgs, tabOrder, TABS } from '../hooks/logic.mjs'
import { drawTestsReels } from '../lib/tests-reels/hooks/view.mjs'
import { drawMenage } from '../lib/menage/hooks/view.mjs'
import { drawProblemes } from '../lib/problemes/hooks/view.mjs'
import { drawRegles } from '../lib/metrics/hooks/pane.mjs'
import { buildView } from '../lib/tests-reels/lib/registry.mjs'

const NOW = Date.parse('2026-10-16T12:00:00Z')

test('arguments: tab word, synonyms, alias, close, and the rest passed on', () => {
  assert.deepEqual(parseArgs(''), { close: false, tab: 'problemes', rest: '' })
  assert.deepEqual(parseArgs('regles V5.8 refresh'), { close: false, tab: 'regles', rest: 'V5.8 refresh' })
  assert.deepEqual(parseArgs('Ménage refresh'), { close: false, tab: 'menage', rest: 'refresh' })
  assert.deepEqual(parseArgs('P-012', { alias: 'problemes' }), { close: false, tab: 'problemes', rest: 'P-012' })
  assert.deepEqual(parseArgs('refresh', { alias: 'tests' }), { close: false, tab: 'tests', rest: 'refresh' })
  assert.deepEqual(parseArgs('close', { current: 'menage' }), { close: true, tab: 'menage', rest: '' })
  assert.equal(parseArgs('refresh', { current: 'regles' }).tab, 'regles')
  assert.equal(parseArgs('', { cfg: { default_tab: 'menage' } }).tab, 'menage')
})

test('tab order follows the config and keeps every tab once', () => {
  assert.deepEqual(tabOrder({}), TABS)
  assert.deepEqual(tabOrder({ tabs: ['menage', 'bogus', 'tests'] }), ['menage', 'tests', 'problemes', 'regles'])
  assert.deepEqual(tabOrder({ hidden_tabs: ['regles'] }), ['problemes', 'tests', 'menage'])
})

test('aliases: only names nobody else serves; our own earlier registration does not count', () => {
  const list = [{ name: 'problemes', plugin: 'problemes' }, { name: 'menage', plugin: 'registres@local' }, { name: 'tests', source: 'user' }]
  assert.deepEqual(aliasesToRegister(list, ['problemes', 'tests', 'regles', 'menage']), ['regles', 'menage'])
})

test('staleness and deep merge', () => {
  assert.equal(isStale(0, NOW), true)
  assert.equal(isStale(NOW - 29 * 60000, NOW, 30), false)
  assert.equal(isStale(NOW - 31 * 60000, NOW, 30), true)
  assert.deepEqual(deepMerge({ a: { b: 1, c: [1] } }, { a: { c: [2] } }), { a: { b: 1, c: [2] } })
})

// An element table that records what is drawn: each element is { type, props, children }.
const el = new Proxy({}, { get: (_, type) => (props) => ({ type, ...props }) })
const texts = (n, out = []) => {
  if (n == null || typeof n !== 'object') {
    if (n != null) out.push(String(n))
    return out
  }
  if (Array.isArray(n)) { n.forEach((x) => texts(x, out)); return out }
  for (const c of n.children ?? []) texts(c, out)
  return out
}
const noop = () => {}

test('the copied views draw with any element table; tests-reels never shows a secret value nor an unrevealed login', () => {
  const cfg = JSON.parse(readFileSync(new URL('../lib/tests-reels/tests-reels.config.json', import.meta.url), 'utf8'))
  const reg = { apps: [{ name: 'Demo', environments: [], accounts: [{ login: 'pilot.tester@example.org', secret_ref: { store: 'wincred', target: 'demo-t' }, password: 'hunter2-not-real' }], procedures: [] }] }
  const view = buildView(reg, [], null, cfg)
  const t = texts(drawTestsReels(el, { cfg, view, now: NOW, openList: ['app:Demo'], reveal: [], status: '' }, { toggle: noop, reveal: noop, reload: noop, recover: noop })).join('\n')
  assert.match(t, /demo-t/)
  assert.doesNotMatch(t, /pilot\.tester@example\.org/)
  assert.doesNotMatch(t, /hunter2/)
  const m = texts(drawMenage(el, { cfg: { labels: { first_scan: 'premier' } }, model: null, now: NOW, filter: 'all', copied: '' }, {})).join('|')
  assert.equal(m, 'premier')
  const p = texts(drawProblemes(el, { cfg: { labels: { first: 'premier {days}' } }, snap: null, now: NOW, f: {}, open: [] }, {})).join('|')
  assert.equal(p, 'premier 14')
  const r = texts(drawRegles(el, { cfg: { labels: { first_scan: 'calcul {days}' } }, model: null, want: '' }, {})).join('|')
  assert.equal(r, 'calcul 30')
})
