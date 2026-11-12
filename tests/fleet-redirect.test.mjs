// scripts/install-fleet-redirect.mjs on a scratch home: an old Fleet copy is backed up and replaced, a second run is a no-op.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'install-fleet-redirect.mjs')
const run = (home, ...a) => execFileSync(process.execPath, [script, '--home', home, ...a], { encoding: 'utf8' })

test('old Fleet copy -> backup + redirect; second run already; --check exit 0', () => {
  const home = mkdtempSync(join(tmpdir(), 'fleet-redirect-'))
  try {
    const old = join(home, '.claude', 'mods', 'fleet', '.claude-plugin')
    mkdirSync(old, { recursive: true })
    writeFileSync(join(old, 'plugin.json'), JSON.stringify({ name: 'fleet', version: '0.1.0' }))
    assert.match(run(home), /old copy 0\.1\.0 kept at .*FLEET_REDIRECT_OK/s)
    const v = JSON.parse(readFileSync(join(home, '.claude', 'mods', 'fleet', '.claude-plugin', 'plugin.json'), 'utf8')).version
    assert.equal(v, '0.2.0')
    assert.equal(readdirSync(join(home, '.claude', 'mods-backup')).length, 1)
    assert.match(run(home), /\(already\)/)
    assert.match(run(home, '--check'), /installed=0\.2\.0/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
