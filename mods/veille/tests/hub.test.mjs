// veille as the « Veille » hub: one count of what waits on Julian, the Export eta tab's view model, the health record
// of the watcher's errors. node --test mods/veille/tests/hub.test.mjs. Invented fixtures only.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { attendJulian, filWaiting } from '../lib/core/veille.mjs'
import { writeHealth } from '../lib/core/health.mjs'
import { julianCount, viewModel } from '../hooks/view.mjs'
import { buildFil } from '../lib/fil.mjs'
import { EXPORT_PENDING, EXPORT_RUN, exportTabLabel, exportView } from '../lib/export-view.mjs'
import { EXPORT_RUN as BATCH_RUN } from '../watcher/export-batch.mjs'
import { BIN_FILES, healthError, isError } from '../watcher/veille.mjs'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const CFG = JSON.parse(readFileSync(new URL('../veille.config.json', import.meta.url), 'utf8'))

const STATES = [
  null,
  {},
  { alerts: {} },
  { alerts: { a: { key: 'a', julian: true, severity: 'julian' }, b: { key: 'b', julian: true, acked: true }, c: { key: 'c', julian: false, severity: 'bad' } } },
  { alerts: { a: { key: 'a', julian: true }, b: { key: 'b', julian: true }, d: { key: 'd', julian: true } } },
]
const ACKS = [[], ['a'], ['*'], ['zz', 'b']]

test('one « attend Julian » count: the pane (view.mjs) gives lib/core/veille.mjs attendJulian on every fixture', () => {
  for (const s of STATES) {
    for (const a of ACKS) {
      assert.equal(julianCount(s, a), attendJulian(s, a), JSON.stringify({ s, a }))
      assert.equal(viewModel(CFG, s, null, a, NOW).julian, attendJulian(s, a))
    }
  }
  assert.equal(attendJulian(STATES[4], ['b']), 2)
})

test('the Fil\'s own julian field equals core filWaiting on the same digest', () => {
  const row = (sid, o = {}) => ({ sid, cli: `c-${sid}`, title: sid, cwd: 'C:/code/alpha', last_activity: NOW - 60000, msg: { text: 'Done.', text_at: NOW - 60000 }, ...o })
  const fil = buildFil([
    row('s1'),
    row('s2', { needs_action: 'Choose the name', msg: { text: 'Which name do you want?', text_at: NOW - 60000 } }),
    row('s3', { parent: 's1', pending_ask: { question: 'Merge or wait?' } }),
  ], CFG, NOW)
  assert.equal(fil.julian, filWaiting(fil).length)
})

test('Export eta tab: ready batch, reason, titles, history; nothing pending; file absent', () => {
  const pending = { generated: NOW, ready: true, count: 4, ids: ['a', 'b', 'c', 'd'], reason: 'count', text: '4 conversations terminées — Exporter vers eta',
    titles: [{ cli: 'a1b2c3d4e5', title: 'Lane A', project: 'alpha' }, { cli: 'f6e5d4c3b2', title: '', project: 'beta' }] }
  const state = { history: [{ at: NOW - 3600000, mode: 'batch', count: 3, pr: 12, url: 'https://github.com/o/eta/pull/12', merged: true, held: [{ cli: 'x', title: 'Held one' }] }] }
  const v = exportView(pending, state, CFG)
  assert.equal(v.ready, true)
  assert.equal(v.text, '4 conversations terminées — Exporter vers eta')
  assert.equal(v.reason, 'seuil 3 atteint')
  assert.deepEqual(v.titles, ['alpha · Lane A', 'beta · f6e5d4c3'])
  assert.equal(v.history[0].pr, '#12')
  assert.deepEqual(v.history[0].held, ['Held one'])
  assert.equal(exportTabLabel(v), 'Export eta (4)')
  const idle = exportView({ ready: false, count: 1, ids: [] }, null, CFG)
  assert.equal(idle.ready, false)
  assert.match(idle.none, /1 terminée\(s\) depuis le dernier export, seuil 3/)
  assert.equal(exportTabLabel(idle), 'Export eta')
  assert.match(exportView(null, null, CFG).none, /pending\.json absent/)
  assert.equal(exportView({ ready: true, count: 2, ids: ['a', 'b'], reason: 'lead' }, null, { export: { labels: { ready_reason_lead: 'LEAD' } } }).reason, 'LEAD')
})

test('the tab and the watcher alert run the same exporter argv; the installed copy carries the shared files', () => {
  assert.deepEqual(BATCH_RUN, EXPORT_RUN)
  assert.deepEqual(EXPORT_RUN, ['export-eta/exporter/export.mjs', 'run', '--mode', 'batch'])
  assert.deepEqual(EXPORT_PENDING, ['export-eta/exporter/export.mjs', 'pending'])
  for (const f of ['veille/lib/export-view.mjs', 'veille/lib/core/veille.mjs', 'veille/lib/core/health.mjs', 'export-eta/lib/core/health.mjs']) assert.ok(BIN_FILES.includes(f), f)
})

test('watcher errors become one health record ~/.claude/mods-health/veille.json (lib/core/health.mjs)', () => {
  assert.equal(isError('mail_failed'), true)
  assert.equal(isError('export_failed'), true)
  assert.equal(isError('mail_skipped'), false)
  assert.equal(healthError([]), null)
  assert.equal(healthError(['mail_failed: smtp 535', 'mail_failed: smtp 535', 'toast_failed: exit 1']), 'mail_failed: smtp 535 | toast_failed: exit 1')
  const dir = mkdtempSync(join(tmpdir(), 'veille-health-'))
  try {
    const env = { MODS_HEALTH_DIR: dir }
    const bad = writeHealth('veille', healthError(['fil_failed: boom']), env, NOW)
    assert.equal(bad.mod, 'veille')
    assert.equal(bad.error, 'fil_failed: boom')
    assert.equal(bad.window.errors, 1)
    const rec = JSON.parse(readFileSync(join(dir, 'veille.json'), 'utf8'))
    assert.equal(rec.error, 'fil_failed: boom')
    const ok = writeHealth('veille', healthError([]), env, NOW + 60000)
    assert.equal(ok.error, null)
    assert.equal(ok.lastOk, new Date(NOW + 60000).toISOString())
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
