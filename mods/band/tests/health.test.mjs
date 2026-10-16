// band: the shared health record for « Santé des mods » (mods/sante/README.md).
//   node --test mods/band/tests/health.test.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { writeHealth } from '../scanner/health.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'band-health-'))
after(() => rmSync(tmp, { recursive: true, force: true }))
const NOW = Date.parse('2026-10-16T12:00:00Z')

test('writeHealth writes ~/.claude/mods-health/band.json: lastRun, durationMs, cpuMs, error, lastOk, 24 h window', () => {
  const env = { MODS_HEALTH_DIR: tmp }
  const a = writeHealth('band', null, env, NOW)
  const b = writeHealth('band', 'boom', env, NOW + 1000)
  const rec = JSON.parse(readFileSync(join(tmp, 'band.json'), 'utf8'))
  assert.deepEqual(rec, b)
  assert.equal(a.lastOk, '2026-10-16T12:00:00.000Z')
  assert.equal(rec.error, 'boom')
  assert.equal(rec.lastOk, a.lastOk)
  assert.ok(rec.durationMs >= 0 && rec.cpuMs >= 0)
  assert.deepEqual([rec.window.start, rec.window.runs, rec.window.errors], [a.lastRun, 2, 1])
  assert.equal(writeHealth('band', null, env, NOW + 25 * 3600000).window.runs, 1)
})

test('MODS_HEALTH=0 writes nothing; a bad folder never throws', () => {
  assert.equal(writeHealth('band', null, { MODS_HEALTH: '0', MODS_HEALTH_DIR: join(tmp, 'off') }, NOW), undefined)
  assert.equal(existsSync(join(tmp, 'off')), false)
  assert.equal(writeHealth('band', null, { MODS_HEALTH_DIR: '\0bad' }, NOW), undefined)
})
