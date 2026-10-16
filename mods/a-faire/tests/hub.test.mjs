// a-faire as « À toi »: summary.json's stable shape read by lib/core/veille.mjs aToi(), and the mods-not-loaded check
// on top of lib/core/mods.mjs. node --test mods/a-faire/tests/hub.test.mjs. Invented fixtures only.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { aToi, readVeille } from '../lib/core/veille.mjs'
import { counterText, summary } from '../lib/items.mjs'
import { modFolders, modsNotLoaded } from '../lib/mods-check.mjs'

const NOW = Date.parse('2026-10-16T12:00:00Z')

test('summary.json: { total, high, updatedAt } (+ open/at for older readers), counts only, read by core aToi()', () => {
  const open = [{ id: 'a', cat: 'config', prio: 'now', title: 'secret title' }, { id: 'b', cat: 'decisions', prio: 'feature', title: 'b' }, { id: 'c', cat: 'manual', prio: 'now', title: 'c' }]
  const s = summary(open, [{ id: 'z' }], NOW, ['gh'])
  assert.equal(s.total, 3)
  assert.equal(s.high, 2)
  assert.equal(s.updatedAt, NOW)
  assert.equal(s.open, s.total)
  assert.equal(s.at, s.updatedAt)
  assert.equal(aToi(s), 3)
  assert.equal(counterText(s), 'À toi : 3')
  assert.equal(counterText({ total: 0 }), '')
  assert.equal(JSON.stringify(s).includes('secret title'), false)
  const dir = mkdtempSync(join(tmpdir(), 'af-hub-'))
  try {
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(s))
    const v = readVeille({ veilleHome: join(dir, 'none'), afaireHome: dir, env: {} })
    assert.equal(v.aToi, 3)
    assert.equal(v.aToiAvailable, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('mods not loaded: lib/core/mods.mjs folders against CLAUDE_CODE_PLUGIN_DIRS, by path or by folder name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'af-mods-'))
  try {
    for (const m of ['band', 'veille', 'demo']) {
      mkdirSync(join(dir, m, '.claude-plugin'), { recursive: true })
      writeFileSync(join(dir, m, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: m }))
    }
    mkdirSync(join(dir, 'not-a-mod'))
    const found = modFolders([dir])
    assert.deepEqual(found.map((m) => m.name), ['band', 'demo', 'veille'])
    const root = found[0].path.replace(/\/band$/, '')
    const r = modsNotLoaded(found, `${root}/band;E:/elsewhere/veille`)
    assert.deepEqual(r.notLoaded.map((m) => m.name), ['demo'])
    assert.equal(r.value, `${root}/band;E:/elsewhere/veille;${root}/demo`)
    assert.deepEqual(modsNotLoaded(found, '').notLoaded.length, 3)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
