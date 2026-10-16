// scripts/sync-libs.mjs on an invented repo, plus the real repo's copies being current.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pairs, stale, sync } from '../scripts/sync-libs.mjs'

function fakeRepo() {
  const d = mkdtempSync(join(tmpdir(), 'sync-test-'))
  mkdirSync(join(d, 'lib', 'core'), { recursive: true })
  mkdirSync(join(d, 'mods', 'alpha', 'hooks'), { recursive: true })
  mkdirSync(join(d, 'mods', 'beta'), { recursive: true })
  writeFileSync(join(d, 'lib', 'core', 'util.mjs'), 'export const a = 1\n')
  writeFileSync(join(d, 'lib', 'core', 'x.mjs'), 'export const x = 1\n')
  writeFileSync(join(d, 'mods', 'alpha', 'hooks', 'src.mjs'), 'export const s = 1\n')
  writeFileSync(join(d, 'lib', 'core', 'targets.json'), JSON.stringify({
    _doc: 'test',
    core: { alpha: ['util.mjs', 'x.mjs'], beta: ['util.mjs'] },
    files: [['lib/core/x.mjs', 'mods/alpha/hooks/x.mjs'], ['mods/alpha/hooks/src.mjs', 'mods/beta/lib/src.mjs']],
  }))
  return d
}

test('sync copies every target, --check logic lists missing, edited and extra copies', () => {
  const d = fakeRepo()
  try {
    assert.equal(pairs(d).length, 5)
    assert.equal(stale(d).length, 5, 'all missing at first')
    assert.equal(sync(d), 5)
    assert.deepEqual(stale(d), [])
    assert.equal(readFileSync(join(d, 'mods', 'beta', 'lib', 'core', 'util.mjs'), 'utf8'), 'export const a = 1\n')
    // CRLF vs LF is not drift
    writeFileSync(join(d, 'mods', 'beta', 'lib', 'core', 'util.mjs'), 'export const a = 1\r\n')
    assert.deepEqual(stale(d), [])
    // a hand edit is
    writeFileSync(join(d, 'mods', 'alpha', 'hooks', 'x.mjs'), 'export const x = 2\n')
    assert.deepEqual(stale(d), ['mods/alpha/hooks/x.mjs (differs from lib/core/x.mjs)'])
    // a copy no target produces is
    writeFileSync(join(d, 'mods', 'beta', 'lib', 'core', 'old.mjs'), '')
    assert.equal(stale(d).length, 2)
    sync(d)
    assert.deepEqual(stale(d), [])
    assert.equal(existsSync(join(d, 'mods', 'beta', 'lib', 'core', 'old.mjs')), false)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('every mod gets lib/core/util.mjs and the repo copies are current (node scripts/sync-libs.mjs)', () => {
  const dsts = pairs().map(([, b]) => b)
  const mods = new Set(dsts.filter((b) => b.endsWith('/lib/core/util.mjs')).map((b) => b.split('/')[1]))
  assert.ok(mods.size >= 17, `${mods.size} mods with util.mjs`)
  assert.deepEqual(stale(), [])
})
