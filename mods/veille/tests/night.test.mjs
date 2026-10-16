// veille night, safe wake, deadlines, vendored mods: node --test mods/veille/tests/night.test.mjs
// Invented fixtures only (no real session, path or account).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  wakeSettings, wakeArgv, wakeEnv, parseWakeLog, transcriptSettings, verifyWake, nightSummary, deadlineAlerts, vendorDue, vendorAlerts,
} from '../lib/night.mjs'
import { brief, deepMerge } from '../lib/core.mjs'
import { findSession, findTranscript, BIN_FILES } from '../watcher/veille.mjs'
import { wakeLines } from '../hooks/fil-view.mjs'
import { shownSummary } from '../hooks/register.mjs'

const BASE = JSON.parse(fs.readFileSync(new URL('../veille.config.json', import.meta.url), 'utf8'))
const NOW = new Date(2026, 9, 16, 12, 0).getTime()
const H = 3600000
const SESS = { sessionId: 'local_aaa', cliSessionId: 'cli-aaa', cwd: 'D:/work/alpha', title: 'Lane alpha', model: 'claude-opus-5-5', effort: 'low', permissionMode: 'acceptEdits' }

test('the wake is a fresh session with the target settings, never --resume', () => {
  const s = wakeSettings(SESS)
  assert.equal(s.ok, true)
  const argv = wakeArgv('claude', s, 'brief', 'Veille · Lane alpha')
  assert.ok(!argv.includes('--resume') && !argv.includes('-r') && !argv.includes('--continue'))
  const at = (k) => argv[argv.indexOf(k) + 1]
  assert.equal(at('--model'), 'claude-opus-5-5')
  assert.equal(at('--effort'), 'low')
  assert.equal(at('--permission-mode'), 'acceptEdits')
  assert.equal(argv[argv.length - 1], 'brief')
  assert.equal(wakeEnv({ CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-5-5', X: '1' }, s).CLAUDE_CODE_SUBAGENT_MODEL, 'claude-opus-5-5')
})

test('missing or odd settings: no wake (no default that could raise effort or permissions)', () => {
  assert.equal(wakeSettings(null).ok, false)
  assert.match(wakeSettings({ ...SESS, effort: '' }).why, /effort/)
  assert.match(wakeSettings({ ...SESS, permissionMode: 'yolo' }).why, /permission/)
  assert.match(wakeSettings({ ...SESS, model: 'x; rm' }).why, /modèle/)
  assert.match(wakeSettings({ ...SESS, cwd: '', originCwd: '' }).why, /dossier/)
})

test('the wake brief stays at most 10 lines and says it is a fresh session', () => {
  const cfg = deepMerge(BASE, { mode: 'active' })
  const text = brief({ key: 'idle:x', kind: 'idle', what: 'lane idle', title: 'Lane alpha', cli: 'cli-aaa', link: 'https://example.invalid/pr/1', since: NOW - H }, cfg, NOW, 'node veille.mjs ack', { archive: 3, fresh: true })
  assert.ok(text.split('\n').length <= 10)
  assert.match(text.split('\n')[0], /session neuve/)
})

test('findSession reads the target session file under <account>/<org>', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veille-night-'))
  try {
    const d = path.join(tmp, 'acct', 'org')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'local_aaa.json'), JSON.stringify(SESS))
    fs.writeFileSync(path.join(d, 'local_bbb.json'), JSON.stringify({ ...SESS, sessionId: 'local_bbb', cliSessionId: 'cli-bbb' }))
    assert.equal(findSession({}, { cli: 'cli-bbb' }, tmp).sessionId, 'local_bbb')
    assert.equal(findSession({}, { sid: 'local_aaa' }, tmp).cliSessionId, 'cli-aaa')
    assert.equal(findSession({}, { cli: 'nope' }, tmp), null)
    const proj = path.join(tmp, 'projects', 'D--work-alpha')
    fs.mkdirSync(proj, { recursive: true })
    fs.writeFileSync(path.join(proj, 'sess-12345678.jsonl'), '')
    assert.equal(findTranscript('sess-12345678', tmp), path.join(proj, 'sess-12345678.jsonl'))
    assert.equal(findTranscript('../x', tmp), null)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})

test('the check compares what the woken session really ran with', () => {
  const log = parseWakeLog([
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5-5', permissionMode: 'acceptEdits' }),
    'not json',
    JSON.stringify({ type: 'result', result: 'done', is_error: false, session_id: 'sess-1', total_cost_usd: 0.01, modelUsage: { 'claude-opus-5-5': {} } }),
  ].join('\n'))
  assert.equal(log.done, true)
  assert.equal(log.result, 'done')
  const tr = transcriptSettings([
    JSON.stringify({ type: 'user', permissionMode: 'acceptEdits' }),
    JSON.stringify({ type: 'assistant', effort: 'low', message: { model: 'claude-opus-5-5' } }),
    JSON.stringify({ type: 'assistant', isSidechain: true, effort: 'high', message: { model: 'claude-haiku-5-5' } }),
  ].join('\n'))
  const want = { model: 'claude-opus-5-5', effort: 'low', permission: 'acceptEdits' }
  assert.deepEqual(verifyWake(want, log, tr), { ok: true, diffs: [] })
  // the 16 Oct --resume case: effort low -> medium, acceptEdits -> bypass
  const bad = verifyWake(want, { ...log, permission: 'bypassPermissions' }, { model: ['claude-opus-5-5'], effort: ['medium'], permission: ['bypassPermissions'] })
  assert.equal(bad.ok, false)
  assert.equal(bad.diffs.length, 2)
  assert.match(verifyWake(want, log, null).diffs.join(), /effort non lu/)
})

test('the Fil lists the wakes with their state and result', () => {
  const lines = wakeLines({ wakes: [{ at: NOW, title: 'Lane alpha', want: { model: 'claude-opus-5-5', effort: 'low', permission: 'acceptEdits' }, status: 'ok', result: 'merged #12', reason: 'PR verte' }] }, BASE)
  assert.equal(lines.length, 1)
  assert.match(lines[0].head, /Lane alpha · opus-5-5 · low · acceptEdits · conforme/)
  assert.deepEqual(lines[0].detail, ['PR verte', 'merged #12'])
  assert.deepEqual(wakeLines(null, BASE), [])
})

test('night summary: merges, failures, waits once per key, wakes since the night started', () => {
  const start = NOW - 8 * H
  const ev = [
    { at: start - H, kind: 'merged', pr: 'before#1' },
    { at: start + H, kind: 'merged', pr: 'alpha#3' },
    { at: start + 2 * H, kind: 'merge_failed', pr: 'beta#4', error: 'conflict' },
    { at: start + 2 * H, kind: 'alert', key: 'k1', severity: 'julian', what: 'choisir', title: 'Lane B' },
    { at: start + 3 * H, kind: 'alert', key: 'k1', severity: 'julian', what: 'choisir' },
    { at: start + 3 * H, kind: 'alert', key: 'k2', severity: 'warn', what: 'verte' },
    { at: start + 4 * H, kind: 'woken', target: 'coord', reason: 'idle' },
  ]
  const s = nightSummary(ev, start, NOW)
  assert.deepEqual([s.merged.length, s.failed.length, s.waits.length, s.woken.length], [1, 1, 1, 1])
  assert.match(s.lines[0], /Bilan de la nuit : 04:00 → 12:00 \(8 h\) · 1 mergées · 1 échecs · 1 attentes de Julian · 1 réveils/)
  assert.ok(s.lines.some((l) => /alpha#3/.test(l)))
  assert.equal(shownSummary({ generated: NOW - H, lines: s.lines }, BASE, NOW).lines.length, s.lines.length)
  assert.equal(shownSummary({ generated: NOW - 20 * H, lines: s.lines }, BASE, NOW), null)
})

test('deadlines: J-7 then J-1 (new key), overdue stays, undated and done lines skipped', () => {
  const md = [
    '# À faire',
    '- [ ] 2026-10-23 · haute · Utiliser les crédits · ils expirent · essayer',
    '- [ ] 2026-10-17 · moyenne · Renouveler le domaine · expire',
    '- [ ] 2026-10-10 · basse · Vieux rappel · en retard',
    '- [ ] 2026-11-30 · basse · Plus tard · loin',
    '- [x] 2026-10-18 · haute · Déjà fait · ok',
    '- [ ] — · haute · Sans date · x',
  ].join('\n')
  const a = deadlineAlerts(md, NOW, { days: [7, 1], title: 'À toi' })
  assert.deepEqual(a.map((x) => [x.kind, x.days_left]), [['deadline_j7', 7], ['deadline_j1', 1], ['deadline_j1', -6]])
  assert.match(a[0].what, /Échéance dans 7 j \(2026-10-23, J-7\) : Utiliser les crédits · haute/)
  assert.match(a[1].what, /demain/)
  assert.match(a[2].what, /en retard de 6 j/)
  const j1 = deadlineAlerts(md, NOW + 6 * 24 * H, { days: [7, 1] })[0]
  assert.notEqual(j1.key, a[0].key, 'J-1 is a new alert, so it notifies again')
  assert.equal(BASE.alerts.severity.deadline_j1, 'warn')
})

test('vendored mods: weekly check, info alert while upstream is newer', () => {
  assert.equal(vendorDue(null, NOW), true)
  assert.equal(vendorDue({ checked_at: NOW - 2 * 24 * H }, NOW, 7), false)
  assert.equal(vendorDue({ checked_at: NOW - 8 * 24 * H }, NOW, 7), true)
  const st = { checked_at: NOW, items: [{ name: 'filetree', repo: 'example/filetree', vendored: '0.2.26', latest: 'v0.2.27' }, { name: 'same', repo: 'example/same', vendored: '1.0.0', latest: 'v1.0.0' }] }
  const al = vendorAlerts(st)
  assert.equal(al.length, 1)
  assert.equal(al[0].key, 'vendor:filetree:0.2.27')
  assert.match(al[0].what, /filetree v0\.2\.27 publié en amont, copie vendored 0\.2\.26/)
  assert.equal(BASE.alerts.severity.vendor, 'info')
  assert.ok(BASE.vendor_check.items.every((it) => fs.existsSync(new URL(`../../../${it.plugin_json}`, import.meta.url))), 'the vendored plugin.json exists in the repo')
})

test('the installed copy carries the night module', () => {
  assert.ok(BIN_FILES.includes('veille/lib/night.mjs'))
})
