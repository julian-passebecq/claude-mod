// problemes mod: santé and veille errors become register entries (source santé / veille), deduped by signature and
// counted once per failed run. Invented mods, records and report in a temp folder, removed at the end.
//   node --test mods/problemes/tests/health.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { classify, healthSource, hitsOfHealth, hitsOfSante, planLines, signatureOf, slash } from '../lib/core.mjs'

const tmp = slash(mkdtempSync(join(tmpdir(), 'problemes-health-')))
after(() => rmSync(tmp, { recursive: true, force: true }))
const RULES = JSON.parse(readFileSync(new URL('../problemes.config.json', import.meta.url), 'utf8')).rules.list
const NOW = Date.parse('2026-10-16T12:00:00Z')

test('a health record gives a hit only when its last run failed; veille.json is source veille', () => {
  assert.deepEqual(hitsOfHealth({ mod: 'demo-mod', lastRun: '2026-10-16T10:00:00Z', error: null }, 'demo-mod'), [])
  const [h] = hitsOfHealth({ mod: 'veille', lastRun: '2026-10-16T10:00:00Z', error: 'smtp: connexion refusée (port 587)' }, 'veille', '/h/veille.json')
  assert.equal(h.kind, 'mod_health')
  assert.equal(h.source, 'veille')
  assert.equal(h.text, '[veille] smtp: connexion refusée (port 587)')
  assert.equal(h.at, Date.parse('2026-10-16T10:00:00Z'))
  assert.equal(hitsOfHealth({ error: 'x', lastRun: 'r' }, 'sante')[0].source, 'santé')
  assert.match(hitsOfHealth(undefined, 'broken', '', 'Unexpected token')[0].text, /^\[broken\] fichier santé illisible/)
  assert.equal(healthSource('Veille'), 'veille')
})

test('santé report: manifest, hooks, configs, logs and error fields become sante_error hits', () => {
  const report = {
    generated: NOW,
    mods: [
      { name: 'demo-a', manifest: { ok: false, error: 'Unexpected end of JSON' }, hooks: { ok: true }, configs: [{ path: 'C:/x/demo-a.config.json', ok: false, error: 'JSON invalide' }, { path: 'C:/x/absent.json', ok: false, error: 'absent' }], logs: [], fields: [] },
      { name: 'demo-b', hooks: { ok: false, error: 'module absent : ./register.tsx' }, configs: [{ path: 'p', ok: true }], logs: [{ path: 'C:/x/run.log', errors: 2, last: 'Error: boom' }], fields: [{ path: 'C:/x/out.json', field: 'errors', count: 1, last: 'quota dépassé' }] },
      { name: 'demo-ok', manifest: { ok: true }, hooks: { ok: true }, configs: [], logs: [{ errors: 0 }], fields: [{ count: 0 }] },
    ],
  }
  const hits = hitsOfSante(report, '/s/report.json')
  assert.deepEqual(hits.map(h => h.text), [
    '[demo-a] plugin.json : Unexpected end of JSON',
    '[demo-a] config demo-a.config.json : JSON invalide',
    '[demo-b] module absent : ./register.tsx',
    '[demo-b] journal run.log : Error: boom',
    '[demo-b] out.json errors : quota dépassé',
  ])
  assert.ok(hits.every(h => h.kind === 'sante_error' && h.source === 'santé' && h.at === NOW && h.key.startsWith('sante:')))
  assert.deepEqual(hitsOfSante(null), [])
})

test('classified under Mods, one problem per mod and message, source kept on the entry', () => {
  const a1 = hitsOfHealth({ mod: 'veille', lastRun: '2026-10-16T10:00:00Z', error: 'smtp: timeout after 30000 ms' }, 'veille')[0]
  const a2 = hitsOfHealth({ mod: 'veille', lastRun: '2026-10-16T11:00:00Z', error: 'smtp: timeout after 45000 ms' }, 'veille')[0]
  const b = hitsOfSante({ generated: NOW, mods: [{ name: 'demo-b', hooks: { ok: false, error: 'module absent' } }] })[0]
  const r = classify(a1, RULES)
  assert.equal(r.id, 'mod-error')
  assert.equal(signatureOf(a1, r), signatureOf(a2, r)) // numbers differ, same problem
  assert.notEqual(signatureOf(a1, r), signatureOf(b, classify(b, RULES)))
  const plan = planLines([a1, a2, b], [], RULES, NOW)
  const adds = plan.lines.filter(l => l.op === 'add')
  assert.deepEqual(adds.map(l => [l.category, l.source, l.title]), [['mods', 'veille', 'Mod veille en erreur'], ['mods', 'santé', 'Mod demo-b en erreur']])
  assert.equal(plan.lines.find(l => l.op === 'seen' && l.id === adds[0].id).n, 2)
})

test('collector: reads the health folder and the santé report, each failed run once', async () => {
  const home = `${tmp}/home`
  const hdir = `${home}/.claude/mods-health`
  mkdirSync(hdir, { recursive: true })
  mkdirSync(`${home}/.claude/sante-mod`, { recursive: true })
  writeFileSync(`${hdir}/veille.json`, JSON.stringify({ mod: 'veille', lastRun: '2026-10-16T10:00:00Z', error: 'watcher: lock perdu' }))
  writeFileSync(`${hdir}/demo-ok.json`, JSON.stringify({ mod: 'demo-ok', lastRun: '2026-10-16T10:00:00Z', error: null }))
  writeFileSync(`${hdir}/demo-bad.json`, '{ not json')
  writeFileSync(`${home}/.claude/sante-mod/report.json`, JSON.stringify({ generated: NOW, mods: [{ name: 'demo-b', logs: [{ path: 'C:/x/run.log', errors: 1, last: 'fatal: boom' }] }] }))
  const env = { HOME: home, USERPROFILE: home, PROBLEMES_DIR: `${home}/.claude/problemes` }
  const S = await import('../scanner/problemes_scan.mjs')
  const cfg = S.config(env)
  cfg.collect = { ...cfg.collect, transcripts: `${home}/none`, sessions: [], roots: [] }
  const s1 = S.collect(cfg, { now: NOW })
  assert.deepEqual([s1.health, s1.hits, s1.new], [3, 3, 3])
  const snap = JSON.parse(readFileSync(`${home}/.claude/problemes/problems.json`, 'utf8'))
  const by = Object.fromEntries(snap.problems.map(p => [p.title, p]))
  assert.equal(by['Mod veille en erreur'].source, 'veille')
  assert.equal(by['Mod demo-b en erreur'].source, 'santé')
  assert.equal(by['Mod demo-bad en erreur'].category, 'mods')
  // Read again: nothing new. A new failed veille run counts once more on the same problem.
  assert.equal(S.collect(cfg, { now: NOW + 1000 }).hits, 0)
  writeFileSync(`${hdir}/veille.json`, JSON.stringify({ mod: 'veille', lastRun: '2026-10-16T11:00:00Z', error: 'watcher: lock perdu' }))
  const s3 = S.collect(cfg, { now: NOW + 2000 })
  assert.deepEqual([s3.hits, s3.new], [1, 0])
  const again = JSON.parse(readFileSync(`${home}/.claude/problemes/problems.json`, 'utf8')).problems.find(p => p.title === 'Mod veille en erreur')
  assert.equal(again.count, 2)
  // health: false turns both off.
  assert.deepEqual(S.healthHits({ ...cfg, collect: { ...cfg.collect, health: false } }), [])
})
