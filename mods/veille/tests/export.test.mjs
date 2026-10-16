// veille × export-eta batch (watcher/export-batch.mjs): node --test mods/veille/tests/export.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { alertsOf } from '../lib/core.mjs'
import { eventText } from '../hooks/view.mjs'
import { exportAlert, exportBatch, EXPORT_RUN } from '../watcher/export-batch.mjs'
import { BIN_FILES } from '../watcher/veille.mjs'

test('a ready batch becomes one « Exporter vers eta » alert with its run button; none when not ready', () => {
  const a = exportAlert({ ready: true, count: 4, ids: ['d', 'a'], text: '4 conversations terminées — Exporter vers eta' }, 1000)
  assert.equal(a.key, 'export:a,d')
  assert.equal(a.kind, 'export')
  assert.deepEqual(a.run, EXPORT_RUN)
  assert.equal(a.run_label, 'Exporter vers eta')
  assert.equal(exportAlert({ ready: false, ids: ['a'] }, 1000), null)
  const cfg = JSON.parse(readFileSync(new URL('../veille.config.json', import.meta.url), 'utf8'))
  const [row] = alertsOf({ sessions: [] }, cfg, 1000, [a]).filter((x) => x.kind === 'export')
  assert.equal(row.severity, 'warn')
  assert.equal(row.julian, false, 'not a needs-Julian alert: no e-mail')
  assert.deepEqual(row.run, EXPORT_RUN, 'the run argv survives alertsOf')
  assert.ok(BIN_FILES.includes('export-eta/exporter/export.mjs') && BIN_FILES.includes('veille/watcher/export-batch.mjs'))
  assert.match(eventText({ at: 0, kind: 'exported', reason: 'ok · 4 exportée(s)' }), /export eta : ok · 4/)
})

test('exportBatch asks `pending`, exports by itself only with auto, and is silent without the mod', async () => {
  const mods = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const calls = []
  const fake = (pending, code = 0) => async (argv) => {
    calls.push(argv.slice(2).join(' '))
    return argv[2] === 'pending' ? { code: 0, out: JSON.stringify(pending) } : { code, out: 'export-eta: ok · 4 exportée(s)', err: 'boom' }
  }
  let r = await exportBatch(fake({ ready: true, count: 4, ids: ['a'], auto: false }), mods, {}, 1, 'node')
  assert.ok(r.alert && !r.event)
  assert.deepEqual(calls, ['pending --json'])
  r = await exportBatch(fake({ ready: true, count: 4, ids: ['a'], auto: true }), mods, {}, 1, 'node')
  assert.equal(r.alert, null)
  assert.equal(r.event.kind, 'exported')
  r = await exportBatch(fake({ ready: true, count: 4, ids: ['a'], auto: true }, 1), mods, {}, 1, 'node')
  assert.ok(r.alert && r.event.kind === 'export_failed', 'a failed auto export keeps the button')
  r = await exportBatch(fake({}), join(mods, 'nowhere'), {}, 1, 'node')
  assert.deepEqual(r, { alert: null, event: null })
})
