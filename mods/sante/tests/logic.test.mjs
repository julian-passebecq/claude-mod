// sante mod: pure logic and the scanner on a made-up mods folder.
//   node --test mods/sante/tests/logic.test.mjs
// Made-up names, paths and numbers only; the fixture folder is written to a temp folder at test time.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { cmpVersion, commandsOf, cpuCost, evaluate, fmtBytes, fmtDur, nextHealth, registeredCommands, splitDirs, summarize } from '../hooks/logic.mjs'
import { diskUsage, findingsOf, installedPlugins, logErrors, readJson, scan, writeHealth } from '../scanner/sante_scan.mjs'
import { splitDirs as coreSplitDirs } from '../lib/core/mods.mjs'

const here = new URL('..', import.meta.url)
const CFG = JSON.parse(readFileSync(new URL('sante.config.json', here), 'utf8'))
const tmp = mkdtempSync(join(tmpdir(), 'sante-test-'))
after(() => rmSync(tmp, { recursive: true, force: true }))
const NOW = Date.parse('2026-10-16T12:00:00Z')
const slash = p => p.replace(/\\/g, '/')

test('splitDirs: ; on Windows, : elsewhere, one drive path stays one', () => {
  assert.deepEqual(splitDirs('C:/a/mods/band;C:\\a\\mods\\ci\\'), ['C:/a/mods/band', 'C:/a/mods/ci'])
  assert.deepEqual(splitDirs('/opt/m/band:/opt/m/ci'), ['/opt/m/band', '/opt/m/ci'])
  assert.deepEqual(splitDirs('D:/x/band'), ['D:/x/band'])
  assert.deepEqual(splitDirs(''), [])
  assert.deepEqual(splitDirs(undefined), [])
})

test('cmpVersion compares the release numbers, dev builds included', () => {
  assert.equal(cmpVersion('2.1.293', '2.1.287'), 1)
  assert.equal(cmpVersion('2.1.280-dev.20260920.t1', '2.1.287'), -1)
  assert.equal(cmpVersion('2.1.287', '2.1.287'), 0)
  assert.equal(cmpVersion('2.10.0', '2.9.9'), 1)
  assert.equal(cmpVersion('?', '2.1.287'), undefined)
})

test('registeredCommands reads $.command.register names, not comments', () => {
  const src = "// $.command.register({ name: 'x' })\n/* command.register({ name: 'y' }) */\nawait $.command.register({\n  name: 'conso',\n  description: 'a',\n})\nawait $.command.register({ name: \"regles\" })"
  assert.deepEqual(registeredCommands(src), ['conso', 'regles'])
})

test('commandsOf: by plugin name, name@marketplace, or by an expected name when the plugin is unknown', () => {
  const cmds = [
    { name: 'conso', source: 'plugin', plugin: 'usage' },
    { name: 'ci', source: 'plugin', plugin: 'other' },
    { name: 'x1', source: 'plugin', plugin: 'usage@market' },
    { name: 'regles', source: 'plugin' },
    { name: 'help', source: 'builtin' },
  ]
  assert.deepEqual(commandsOf('usage', cmds), ['conso', 'x1'])
  assert.deepEqual(commandsOf('ci', cmds, ['ci']), [])
  assert.deepEqual(commandsOf('metrics', cmds, ['regles']), ['regles'])
})

test('nextHealth keeps lastOk on error and rolls a 24 h window; cpuCost reads it', () => {
  const a = nextHealth(undefined, { mod: 'm', now: NOW, durationMs: 400, cpuMs: 200 })
  assert.equal(a.lastOk, a.lastRun)
  assert.deepEqual(a.window, { start: '2026-10-16T12:00:00.000Z', runs: 1, cpuMs: 200, durationMs: 400, errors: 0 })
  const b = nextHealth(a, { mod: 'm', now: NOW + 3600000, durationMs: 600, cpuMs: 300, error: 'boom' })
  assert.equal(b.error, 'boom')
  assert.equal(b.lastOk, a.lastRun)
  assert.deepEqual(b.window, { start: a.window.start, runs: 2, cpuMs: 500, durationMs: 1000, errors: 1 })
  const c = nextHealth(b, { mod: 'm', now: NOW + 25 * 3600000, durationMs: 10, cpuMs: 5 })
  assert.equal(c.window.runs, 1)
  const cost = cpuCost(b, NOW + 3600000)
  assert.ok(Math.abs(cost.runsPerHour - 2) < 1e-9)
  assert.ok(Math.abs(cost.corePct - (500 / 3600000) * 100) < 1e-9)
})

test('formatting in French', () => {
  assert.equal(fmtBytes(512), '512 o')
  assert.equal(fmtBytes(1536), '1,5 Ko')
  assert.equal(fmtBytes(25 * 1024 * 1024), '25,0 Mo')
  assert.equal(fmtDur(850), '850 ms')
  assert.equal(fmtDur(2300), '2,3 s')
  assert.equal(fmtDur(3 * 3600000), '3 h')
})

const mod = (over = {}) => ({
  key: 'k', name: 'alpha', dir: 'C:/m/alpha', source: 'env', exists: true, manifest: { ok: true, version: '0.1.0' }, hooks: { ok: true },
  expected: ['alpha'], configs: [{ path: 'C:/m/alpha/alpha.config.json', ok: true }], caches: [], logs: [], fields: [], ...over,
})
const CMDS = [{ name: 'alpha', source: 'plugin', plugin: 'alpha' }]

test('evaluate: a healthy loaded mod is green and the summary line says vert', () => {
  const h = nextHealth(undefined, { mod: 'alpha', now: NOW - 60000, durationMs: 300, cpuMs: 120 })
  const { rows, summary } = evaluate({ mods: [mod({ health: h, caches: [{ path: 'C:/c/alpha', bytes: 2048, newest: NOW - 120000 }] })] }, { commands: CMDS, engine: '2.1.293', cfg: CFG, now: NOW })
  assert.equal(rows[0].level, 'ok')
  assert.equal(rows[0].loaded, true)
  assert.equal(rows[0].lastRefresh, NOW - 60000) // the health record's lastOk is newer than the cache
  assert.equal(rows[0].cost.cpuMs, 120)
  assert.equal(summary.level, 'ok')
  assert.match(summary.text, /^vert · 1 mods actifs : 1 OK, 0 orange, 0 rouge · 0 non chargés · Claude Code 2\.1\.293$/)
})

test('evaluate: red for invalid JSON, old engine, missing folder and a recent scan error', () => {
  const bad = evaluate({ mods: [mod({ configs: [{ path: 'C:/u/alpha.json', ok: false, error: 'Unexpected token } in JSON at position 12' }] })] }, { commands: CMDS, engine: '2.1.293', cfg: CFG, now: NOW })
  assert.equal(bad.rows[0].level, 'error')
  assert.match(bad.rows[0].reasons[0].text, /JSON invalide : C:\/u\/alpha\.json \(Unexpected token/)
  assert.match(bad.summary.text, /^rouge · .* alpha : JSON invalide/)
  const old = evaluate({ mods: [mod()] }, { commands: CMDS, engine: '2.1.280', cfg: CFG, now: NOW })
  assert.match(old.rows[0].reasons[0].text, /Claude Code 2\.1\.280 < minimum 2\.1\.287/)
  const gone = evaluate({ mods: [mod({ exists: false, manifest: undefined })] }, { commands: [], engine: '2.1.293', cfg: CFG, now: NOW })
  assert.equal(gone.rows[0].level, 'error')
  assert.match(gone.rows[0].reasons[0].text, /dossier introuvable : C:\/m\/alpha/)
  const failed = nextHealth(undefined, { mod: 'alpha', now: NOW - 3600000, durationMs: 1, cpuMs: 1, error: 'ENOENT projects' })
  assert.equal(evaluate({ mods: [mod({ health: failed })] }, { commands: CMDS, engine: '2.1.293', cfg: CFG, now: NOW }).rows[0].level, 'error')
  assert.equal(evaluate({ mods: [mod({ health: failed })] }, { commands: CMDS, engine: '2.1.293', cfg: CFG, now: NOW + 48 * 3600000 }).rows[0].level, 'ok')
})

test('evaluate: orange for env-but-no-command, stale cache, heavy cache (with a command to run yourself), field errors', () => {
  const notLoaded = evaluate({ mods: [mod()] }, { commands: [], engine: '2.1.293', cfg: CFG, now: NOW })
  assert.equal(notLoaded.rows[0].level, 'warn')
  assert.match(notLoaded.rows[0].reasons[0].text, /aucune commande enregistrée \(\/alpha\)/)
  const cfg = { ...CFG, mods: { alpha: { stale_min: 30, cache_warn_mb: 1 } } }
  const r = evaluate({ mods: [mod({ caches: [{ path: 'C:/c/alpha', bytes: 3 * 1024 * 1024, newest: NOW - 3 * 3600000 }], fields: [{ path: 'C:/c/m.json', field: 'meta.errors', count: 2, last: 'gh: not logged in' }] })] }, { commands: CMDS, engine: '2.1.293', cfg, now: NOW })
  assert.equal(r.rows[0].level, 'warn')
  const texts = r.rows[0].reasons.map(x => x.text).join('\n')
  assert.match(texts, /pas rafraîchi depuis 3 h \(attendu < 30 min\)/)
  assert.match(texts, /cache lourd : C:\/c\/alpha 3,0 Mo/)
  assert.match(texts, /2 erreur\(s\) dans C:\/c\/m\.json → meta\.errors : gh: not logged in/)
  assert.deepEqual(r.rows[0].cleanup, ['Remove-Item -LiteralPath "C:/c/alpha" -Recurse'])
  assert.match(r.summary.text, /^orange · /)
})

test('evaluate: a folder mod not in the env and without commands is « off » and out of the counts', () => {
  const { rows, summary } = evaluate({ mods: [mod(), mod({ name: 'beta', source: 'dir', expected: ['beta'] })] }, { commands: CMDS, engine: '2.1.293', cfg: CFG, now: NOW })
  assert.deepEqual(rows.map(r => r.level), ['ok', 'off'])
  assert.match(summary.text, /1 mods actifs .* 1 non chargés/)
  assert.equal(summarize([], { report: { error: 'scanner exit 1' }, cfg: CFG }).level, 'error')
})

function fixture() {
  const root = join(tmp, 'mods')
  const mk = (name, files) => {
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(join(root, name, p, '..'), { recursive: true })
      writeFileSync(join(root, name, p), text)
    }
  }
  mk('alpha', {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', version: '0.3.0' }),
    'hooks/hooks.json': '{ "modules": ["./register.tsx"] }',
    'hooks/register.tsx': "await $.command.register({ name: 'alpha', description: 'd' })",
    'alpha.config.json': '{ "a": 1, }',
    'scan-cache.json': 'not checked: matches skip_json',
  })
  mk('beta', { '.claude-plugin/plugin.json': '{ "name": "beta", "version": "1.0.0" }', 'hooks/hooks.json': '{ "modules": ["./gone.ts"] }' })
  mk('gamma', { '.claude-plugin/plugin.json': '{ "name": "gamma" }' })
  const home = join(tmp, 'home')
  mkdirSync(join(home, '.claude', 'alpha-cache', 'sub'), { recursive: true })
  writeFileSync(join(home, '.claude', 'alpha-cache', 'a.json'), 'x'.repeat(1000))
  writeFileSync(join(home, '.claude', 'alpha-cache', 'sub', 'b.json'), 'y'.repeat(24))
  utimesSync(join(home, '.claude', 'alpha-cache', 'sub', 'b.json'), new Date(NOW - 5000), new Date(NOW - 5000))
  writeFileSync(join(home, '.claude', 'alpha.log'), 'ok\nERROR first\nfine\nTraceback: second\n')
  writeFileSync(join(home, '.claude', 'out.json'), JSON.stringify({ meta: { errors: ['gh absent'] } }))
  mkdirSync(join(home, '.claude', 'mods-health'), { recursive: true })
  writeFileSync(join(home, '.claude', 'mods-health', 'alpha.json'), JSON.stringify(nextHealth(undefined, { mod: 'alpha', now: NOW, durationMs: 5, cpuMs: 3 })))
  writeFileSync(join(home, '.claude', 'mods-health', 'orphan.json'), '{ broken')
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'gamma@market': [{ installPath: join(root, 'gamma') }], 'delta@market': [{ installPath: join(tmp, 'nowhere') }] } }))
  return { root, home }
}

test('scan: manifests, hooks, configs, caches, logs, error fields, health records, installed and orphan', () => {
  const { root, home } = fixture()
  const cfg = {
    ...CFG,
    extra_dirs: [],
    installed_plugins_file: '~/.claude/plugins/installed_plugins.json',
    mods: { alpha: { caches: ['~/.claude/alpha-cache', '~/.claude/none'], logs: ['~/.claude/alpha.log'], error_fields: [{ file: '~/.claude/out.json', field: 'meta.errors' }], configs: ['~/.claude/absent.json'] } },
  }
  const r = scan({ dirs: [join(root, 'alpha'), join(root, 'beta'), join(root, 'missing')], home, cfg, now: NOW })
  const by = Object.fromEntries(r.mods.map(m => [m.name, m]))
  assert.deepEqual(r.mods.map(m => `${m.source}:${m.name}`), ['env:alpha', 'env:beta', 'env:missing', 'marketplace:gamma', 'marketplace:delta', 'health:orphan'])
  assert.equal(by.alpha.manifest.version, '0.3.0')
  assert.deepEqual(by.alpha.expected, ['alpha'])
  const bad = by.alpha.configs.filter(c => !c.ok)
  assert.equal(bad.length, 1)
  assert.match(bad[0].path, /alpha\/alpha\.config\.json$/)
  assert.ok(!by.alpha.configs.some(c => /scan-cache/.test(c.path)))
  assert.deepEqual([by.alpha.caches.length, by.alpha.caches[0].bytes, by.alpha.caches[0].files, by.alpha.caches[0].newest > 0], [1, 1024, 2, true])
  assert.deepEqual([by.alpha.logs[0].errors, by.alpha.logs[0].last], [2, 'Traceback: second'])
  assert.deepEqual(by.alpha.fields[0], { path: slash(join(home, '.claude', 'out.json')), field: 'meta.errors', count: 1, last: 'gh absent' })
  assert.equal(by.alpha.health.cpuMs, 3)
  assert.equal(by.beta.hooks.ok, false)
  assert.match(by.beta.hooks.error, /module absent : \.\/gone\.ts/)
  assert.equal(by.missing.exists, false)
  assert.equal(by.orphan.health.invalid.length > 0, true)

  const { rows, summary } = evaluate(r, { commands: [{ name: 'alpha', source: 'plugin', plugin: 'alpha' }], engine: '2.1.293', cfg, now: NOW })
  const lv = Object.fromEntries(rows.map(x => [x.name, x.level]))
  assert.deepEqual(lv, { alpha: 'error', beta: 'error', missing: 'error', gamma: 'off', delta: 'off', orphan: 'error' })
  assert.equal(summary.level, 'error')
})

test('readJson, diskUsage, logErrors, installedPlugins on missing paths do not throw', () => {
  assert.equal(readJson(join(tmp, 'nope.json')).error, 'absent')
  assert.equal(diskUsage(join(tmp, 'nope')).exists, false)
  assert.equal(logErrors(join(tmp, 'nope.log')).exists, false)
  assert.deepEqual(installedPlugins(join(tmp, 'nope.json')), [])
})

test('writeHealth goes through lib/core/health.mjs and adds the findings (red and orange lines)', () => {
  const env = { MODS_HEALTH_DIR: join(tmp, 'health') }
  writeHealth(null, [], env, NOW)
  const rec0 = writeHealth('boom', [{ level: 'error', mod: 'beta', text: 'JSON invalide : x' }], env, NOW + 1000)
  const rec = JSON.parse(readFileSync(join(tmp, 'health', 'sante.json'), 'utf8'))
  assert.deepEqual(rec, rec0)
  assert.equal(rec.mod, 'sante')
  assert.equal(rec.error, 'boom')
  assert.equal(rec.lastOk, new Date(NOW).toISOString())
  assert.deepEqual([rec.window.runs, rec.window.errors], [2, 1])
  assert.deepEqual(rec.findings, [{ level: 'error', mod: 'beta', text: 'JSON invalide : x' }])
  assert.equal(writeHealth(null, [], { ...env, MODS_HEALTH: '0' }, NOW), undefined)
})

test('findingsOf lists every red and orange reason with its mod', () => {
  const report = {
    generated: NOW,
    mods: [
      { key: 'a', name: 'alpha', dir: '/m/alpha', source: 'env', exists: true, manifest: { ok: true }, hooks: { ok: true }, expected: ['alpha'], configs: [], caches: [], logs: [], fields: [] },
      { key: 'b', name: 'beta', dir: '/m/beta', source: 'env', exists: true, manifest: { ok: true }, hooks: { ok: true }, expected: ['beta'], configs: [{ path: '/m/beta/x.json', ok: false, error: 'Unexpected token' }], caches: [], logs: [], fields: [] },
    ],
  }
  const f = findingsOf(report, { commands: [{ name: 'alpha', source: 'plugin', plugin: 'alpha' }, { name: 'beta', source: 'plugin', plugin: 'beta' }], engine: '2.1.293', cfg: CFG, now: NOW })
  assert.deepEqual(f, [{ level: 'error', mod: 'beta', text: 'JSON invalide : /m/beta/x.json (Unexpected token)' }])
})

test('the hook splitDirs (pure, logic.mjs) and lib/core/mods.mjs agree', () => {
  for (const v of ['C:/a/mods/band;C:\\a\\mods\\ci\\','/opt/m/band:/opt/m/ci', 'D:/x/band', '', ' "C:/q/x" ; D:/y ']) assert.deepEqual(splitDirs(v), coreSplitDirs(v), v)
})
