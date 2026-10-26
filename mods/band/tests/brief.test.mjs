// band mod: « Export conv » / « Export + enfants » (hooks/brief.ts), pure.   node --test mods/band/tests/brief.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { briefArgv, briefButtons, briefCfg, briefToast, infoOf, scriptPath } from '../hooks/brief.ts'

const shipped = JSON.parse(readFileSync(new URL('../band.config.json', import.meta.url), 'utf8'))
const bc = briefCfg(shipped.export_brief)

test('shipped config: two buttons in config order, tree only with children, its count filled in', () => {
  assert.deepEqual(briefButtons(bc, { ready: true, children: 0 }).map((b) => b.label), ['Export conv'])
  assert.deepEqual(briefButtons(bc, { ready: true, children: 3 }).map((b) => b.label), ['Export conv', 'Export + enfants +3'])
  assert.deepEqual(briefButtons(bc, { ready: false, children: 3 }), [])
  const grey = briefButtons({ ...bc, when_missing: 'grey' }, { ready: false, children: 0 })
  assert.equal(grey.length, 1)
  assert.equal(grey[0].enabled, false)
  const busy = briefButtons(bc, { ready: true, children: 2, busy: 'tree' })
  assert.deepEqual(busy.map((b) => [b.label, b.enabled]), [['Export conv', false], ['export…', false]])
  assert.deepEqual(briefButtons({ ...bc, enabled: false }, { ready: true, children: 2 }), [])
})

test('labels and order come from the config', () => {
  const own = briefCfg({ buttons: [{ id: 'tree', label: 'Tout', count: ' ({n})' }, { id: 'conv', label: 'Moi' }] })
  assert.deepEqual(briefButtons(own, { ready: true, children: 4 }).map((b) => b.label), ['Tout (4)', 'Moi'])
})

test('script path, argv, info and toast', () => {
  assert.equal(scriptPath('C:\\code\\claude-mod\\mods\\band', '../export-eta/exporter/brief.mjs'), 'C:/code/claude-mod/mods/export-eta/exporter/brief.mjs')
  assert.equal(scriptPath('/x/mods/band', 'D:/elsewhere/brief.mjs'), 'D:/elsewhere/brief.mjs')
  assert.deepEqual(briefArgv('node', 's.mjs', 'tree', 'abc', 'C:/w'), ['node', 's.mjs', 'run', '--session', 'abc', '--cwd', 'C:/w', '--json', '--children'])
  assert.deepEqual(briefArgv('node', 's.mjs', 'conv', 'abc'), ['node', 's.mjs', 'run', '--session', 'abc', '--json'])
  assert.deepEqual(infoOf('{"found":true,"children":3}\n'), { found: true, children: 3 })
  assert.deepEqual(infoOf('garbage'), { found: false, children: 0 })
  assert.equal(briefToast(bc, { exitCode: 0, stdout: '{"ok":true,"line":"Brief : C:/x.md · copié"}', stderr: '' }), 'Brief : C:/x.md · copié')
  assert.equal(briefToast(bc, { exitCode: 1, stdout: '{"ok":false,"error":"introuvable"}', stderr: '' }), 'Brief échoué : introuvable')
  assert.equal(briefToast(bc, { exitCode: 1, stdout: '', stderr: 'boom' }), 'Brief échoué : boom')
})
