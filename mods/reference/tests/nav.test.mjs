// Référence hub: arguments, aliases and tab order (pure), plus the shipped config.
//   node --test mods/reference/tests/nav.test.mjs     (Node 22.18+ strips the types of nav.ts)
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { ALIASES, TABS, aliasArgs, deepMerge, expandHome, missingAliases, parseArgs, tabsOf } from '../hooks/nav.ts'

const here = new URL('..', import.meta.url)

test('/reference words: tab, its own arguments, close', () => {
  assert.deepEqual(parseArgs(''), { close: false, rest: [] })
  assert.deepEqual(parseArgs('ci diagramme refresh codex'), { close: false, tab: 'ci', rest: ['diagramme', 'refresh', 'codex'] })
  assert.deepEqual(parseArgs('Santé refresh'), { close: false, tab: 'sante', rest: ['refresh'] })
  assert.deepEqual(parseArgs('guide claude plugin'), { close: false, tab: 'guide', rest: ['claude', 'plugin'] })
  assert.deepEqual(parseArgs('config-claude scan'), { close: false, tab: 'config', rest: ['scan'] })
  assert.deepEqual(parseArgs('close'), { close: true, rest: [] })
})

test('old commands map to their tab with their words untouched', () => {
  assert.deepEqual(Object.keys(ALIASES).sort(), ['ci', 'config-claude', 'control', 'mods-guide', 'sante', 'scenarios'])
  assert.deepEqual(aliasArgs('mods-guide', 'claude plugin'), { close: false, tab: 'guide', rest: ['claude', 'plugin'] })
  assert.deepEqual(aliasArgs('ci', 'diagramme codex'), { close: false, tab: 'ci', rest: ['diagramme', 'codex'] })
  assert.deepEqual(aliasArgs('scenarios', 'close'), { close: true, rest: [] })
})

test('missingAliases keeps only names no command of the session uses', () => {
  assert.deepEqual(missingAliases([]), Object.keys(ALIASES))
  assert.deepEqual(missingAliases([{ name: 'ci' }, { name: 'control' }, { name: 'help' }]), ['config-claude', 'mods-guide', 'scenarios', 'sante'])
})

test('tabsOf: configured order, unknown ids dropped, empty = all five', () => {
  assert.deepEqual(tabsOf(['ci', 'guide', 'nope', 'ci']), ['ci', 'guide'])
  assert.deepEqual(tabsOf(undefined), [...TABS])
  assert.deepEqual(tabsOf([]), [...TABS])
})

test('helpers: ~ expansion and deep merge', () => {
  assert.equal(expandHome('~/.claude/x', 'C:/Users/me'), 'C:/Users/me/.claude/x')
  assert.equal(expandHome('D:\\a\\b', 'C:/Users/me'), 'D:/a/b')
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, t: [1] }, { a: { c: 3 }, t: [2] }), { a: { b: 1, c: 3 }, t: [2] })
})

test('shipped config: every tab labelled, every path under ~, synced owner files present', () => {
  const cfg = JSON.parse(readFileSync(new URL('reference.config.json', here), 'utf8'))
  assert.deepEqual(tabsOf(cfg.tabs), [...TABS])
  for (const t of TABS) assert.ok(cfg.labels[`tab_${t}`], t)
  for (const [k, v] of Object.entries(cfg.paths)) if (!k.startsWith('_') && v) assert.match(v, /^~\//, k)
  for (const f of ['lib/control/hooks/config_draw.tsx', 'lib/guide/hooks/draw.tsx', 'lib/guide/MODE-EMPLOI.md', 'lib/scenarios/hooks/draw.tsx',
    'lib/scenarios/scenarios.json', 'lib/sante/hooks/draw.tsx', 'lib/sante/scanner/sante_scan.mjs', 'lib/ci/hooks/draw.tsx', 'lib/ci/lib/core/gantt.mjs']) {
    assert.ok(existsSync(new URL(f, here)), f)
  }
})
