// tests-reels logic: node --test mods/tests-reels/tests/logic.test.mjs
// Fixtures are invented (example.org accounts, made-up GUIDs, fake secrets built by concatenation).
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import { assertNoSecret, findSecrets, looksSecret, redact, stripUrl } from '../lib/secrets.mjs'
import { addAccount, addEnv, appSummary, buildView, ensureApp, mask, parseRuns, runRecord, todoLine } from '../lib/registry.mjs'
import { addHit, appFromCwd, compile, counts, extract, finalize, mergeAgg, parseManualLine } from '../lib/recover.mjs'
import { main, parseArgs } from '../cli.mjs'

const here = new URL('.', import.meta.url)
const CFG = JSON.parse(readFileSync(new URL('../tests-reels.config.json', here), 'utf8'))
const fixture = JSON.parse(readFileSync(new URL('fixtures/registry.example.json', here), 'utf8'))

// fake secrets, never real, split so that no scanner flags this file
const PW = 'Pil0t' + '-Secr3t!'
const JWT = 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'abcdefghijklmnop'
const GH = 'gh' + 'p_' + 'Ab1Cd2Ef3Gh4'.repeat(3)
const GUID = '11111111-2222-3333-4444-555555555555'

test('secrets: detected by kind, values never returned, redacted in place', () => {
  assert.deepEqual(findSecrets(`password: ${PW}`), ['mot de passe'])
  assert.deepEqual(findSecrets(`Authorization: Bearer ${JWT}`).sort(), ['jeton Bearer', 'jeton JWT'])
  assert.deepEqual(findSecrets(`export GH=${GH}`), ['jeton GitHub'])
  assert.deepEqual(findSecrets('const token = getToken()'), [])
  assert.deepEqual(findSecrets('password: <PASSWORD>'), [])
  assert.deepEqual(findSecrets(`tenant id: ${GUID}`), [])
  assert.equal(looksSecret('cfg.token'), false)
  assert.deepEqual(findSecrets('AKIA' + 'IOSFODNN7EXAMPLE'), [], 'documentation sample')
  assert.deepEqual(findSecrets('gh' + 'p_' + 'A'.repeat(36)), [], 'test fake')
  assert.deepEqual(findSecrets('password: Playwright` and pass: 12/12'), [])
  const r = redact(`login with password=${PW} and Bearer ${JWT}`)
  assert.ok(!r.includes(PW) && !r.includes(JWT))
  assert.match(r, /password=«masqué»/)
  assert.equal(stripUrl('https://app.example.org/x?code=abc#frag'), 'https://app.example.org/x')
})

test('assertNoSecret refuses a secret field or value, accepts a reference', () => {
  assert.throws(() => assertNoSecret({ login: 'a', password: 'x' }), /refusé/)
  assert.throws(() => assertNoSecret({ note: `pwd=${PW}` }), /ressemble à un secret/)
  assert.doesNotThrow(() => assertNoSecret({ login: 'pilot.tester@example.org', secret_ref: { store: 'wincred', target: 'demo-tenant-pilot' } }))
})

test('mask hides logins by default', () => {
  assert.equal(mask('pilot.tester@example.org'), 'pi•••@ex•••')
  assert.equal(mask('svc'), 'sv•••')
  assert.equal(mask('ab'), '••')
})

test('view: per app, last runs green/red/never, « jamais testé en réel », À ranger', () => {
  const runs = parseRuns([
    JSON.stringify({ date: '2026-10-14T10:00:00Z', app: 'Demo Studio', env: 'TEST tenant', procedure: 'Lecture live', result: 'pass' }),
    JSON.stringify({ date: '2026-10-15T09:00:00Z', app: 'Demo Studio', env: 'TEST tenant', procedure: 'Lecture live', result: 'fail', evidence: ['reports/live.md'] }),
    'not json',
    JSON.stringify({ date: '2026-10-15T11:00:00Z', app: 'Demo Studio', procedure: 'Inconnue', result: 'partial' }),
  ].join('\n'))
  const recovered = {
    generated: 1,
    apps: {
      'demo-worker': { sessions: [{ id: 's1', title: 'Worker QA', date: '2026-10-10', hits: 3, cats: ['cloudflare'] }], commands: [], ids: [], secrets: [] },
      'quiet-repo': { sessions: [], commands: [], ids: [], secrets: [{ kind: 'mot de passe', title: 'Old session', date: '2026-10-01', count: 2 }] },
    },
  }
  const v = buildView(fixture, runs, recovered, CFG)
  const names = v.apps.map(a => a.name)
  assert.deepEqual(names.slice(0, 2), ['Demo Studio', 'Demo Worker'])
  assert.ok(names.includes('demo-worker') === false, 'demo-worker merges into Demo Worker (case-insensitive)')
  const studio = v.apps[0]
  const live = studio.procedures.find(p => p.name === 'Lecture live')
  assert.equal(live.status, 'fail')
  assert.equal(live.runs.length, 2)
  assert.equal(studio.procedures.find(p => p.name === 'Inconnue').undeclared, true)
  assert.equal(studio.procedures.find(p => p.name === 'Export PBIX').status, 'never')
  const worker = v.apps.find(a => a.name === 'Demo Worker')
  assert.equal(worker.neverReal, true)
  assert.match(appSummary(worker, CFG.labels), /jamais testé en réel/)
  assert.ok(worker.recovered, 'recovered evidence attached to the curated app')
  // À ranger: account without secret ref first, then missing id, then secrets seen (also from an unlisted app)
  assert.deepEqual(v.todo.map(t => t.kind), ['secret_unknown', 'id_missing', 'secret_seen'])
  assert.match(todoLine(v.todo[0], CFG.labels), /secret non enregistré, à ranger dans le Gestionnaire d'identification Windows/)
  assert.match(todoLine(v.todo[2], CFG.labels), /mot de passe vu dans la session « Old session » le 2026-10-01 \(2×\)/)
  assert.equal(v.totals.secrets_seen, 2)
  assert.equal(v.totals.runs, 3)
})

test('recovery extract: ids, urls without query, test accounts, commands redacted, secrets counted only', () => {
  const P = compile({ ...CFG.recovery, ignore_accounts: ['noreply@'] })
  const h = extract(`Fabric TEST tenant pilot: tenant id ${GUID}, workspace "Pilot WS", opened https://demo.workers.dev/app?token=abc as test account pilot.tester@example.org, password=${PW}`, 'text', P)
  assert.ok(h.cats.includes('fabric') && h.cats.includes('cloudflare'))
  assert.deepEqual(h.ids, [{ kind: 'tenant', value: GUID }])
  assert.deepEqual(h.urls, ['https://demo.workers.dev/app'])
  assert.deepEqual(h.accounts, ['pilot.tester@example.org'])
  assert.deepEqual(h.workspaces, ['Pilot WS'])
  assert.deepEqual(h.secrets, ['mot de passe'])
  assert.ok(!h.mention.includes(PW))
  const c = extract(`npx wrangler deploy && curl -H "Authorization: Bearer ${JWT}" https://demo.workers.dev/health`, 'command', P)
  assert.ok(c.command && !c.command.includes(JWT))
  assert.equal(extract('nothing relevant here', 'text', P), null)
  assert.equal(appFromCwd('C:/code/demo-app/.claude/worktrees/lane-1'), 'demo-app')
})

test('recovery aggregate: merge per file, finalize lists, counts only', () => {
  const P = compile(CFG.recovery)
  const a1 = {}
  const a2 = {}
  addHit(a1, extract(`wrangler tail on demo.workers.dev, live test, tenant id ${GUID}`, 'text', P), { app: 'demo', session: 's1', date: '2026-10-01T00:00:00Z' })
  addHit(a2, extract('npx wrangler deploy for the real test on demo.workers.dev', 'command', P), { app: 'demo', session: 's2', date: '2026-10-02T00:00:00Z' })
  addHit(a2, { cats: [], secrets: ['jeton JWT'] }, { app: 'other', session: 's3', date: '2026-10-03' })
  const total = mergeAgg(mergeAgg({}, a1), a2)
  const c = counts(total)
  assert.equal(c.sessions, 2)
  assert.equal(c.commands, 1)
  assert.equal(c.secrets_seen, 1)
  const out = finalize(total, { s1: 'Session one' })
  assert.equal(out.demo.sessions.find(s => s.id === 's1').title, 'Session one')
  assert.equal(out.other.secrets[0].kind, 'jeton JWT')
  assert.ok(!JSON.stringify(out).includes(JWT))
})

test('manual-checks.md lines: date · project · what · how, struck and done', () => {
  const m = parseManualLine('2026-10-14 · demo-app 1.2 · Access owner login on demo.workers.dev · DONE by Julian')
  assert.equal(m.app, 'demo-app')
  assert.equal(m.status, 'fait')
  const s = parseManualLine('~~2026-10-14 · demo-app · screen reader · run NVDA~~ GELÉ')
  assert.equal(s.status, 'GELÉ')
  assert.equal(parseManualLine('# title'), null)
})

test('cli: add, run-log and show write only the data folder and refuse secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tests-reels-'))
  try {
    const lines = []
    const run = (...a) => main([...a, '--data-dir', dir], s => lines.push(s))
    run('add', 'env', '--app', 'Demo', '--name', 'TEST tenant', '--kind', 'tenant', '--id', `tenant=${GUID}`, '--url', 'https://app.example.org')
    run('add', 'account', '--app', 'Demo', '--env', 'TEST tenant', '--login', 'pilot.tester@example.org', '--secret-store', 'wincred', '--secret-target', 'demo-tenant-pilot')
    run('add', 'procedure', '--app', 'Demo', '--name', 'Lecture live', '--env', 'TEST tenant', '--step', 'open', '--step', 'read')
    run('run-log', '--app', 'Demo', '--env', 'TEST tenant', '--procedure', 'Lecture live', '--result', 'pass', '--evidence', 'reports/x.md')
    const reg = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'))
    assert.equal(reg.apps[0].environments[0].ids.tenant, GUID)
    assert.deepEqual(reg.apps[0].accounts[0].secret_ref, { store: 'wincred', target: 'demo-tenant-pilot' })
    assert.deepEqual(reg.apps[0].procedures[0].steps, ['open', 'read'])
    assert.equal(parseRuns(readFileSync(join(dir, 'runs.jsonl'), 'utf8'))[0].result, 'pass')
    assert.throws(() => run('add', 'account', '--app', 'Demo', '--login', 'x', '--password', PW), e => e.code === 2)
    assert.throws(() => run('run-log', '--app', 'Demo', '--procedure', 'p', '--result', 'pass', '--note', `token=${PW}`), e => e.code === 2)
    lines.length = 0
    run('show', '--app', 'Demo')
    assert.match(lines.join('\n'), /pi•••@ex•••/)
    assert.ok(!lines.join('\n').includes('pilot.tester@example.org'))
    assert.ok(!readFileSync(join(dir, 'registry.json'), 'utf8').includes(PW))
    assert.deepEqual(parseArgs(['add', 'env', '--url', 'a', '--url', 'b']).url, ['a', 'b'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recovery scanner end to end on invented files: counts only on stdout, nothing secret written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tests-reels-scan-'))
  try {
    const proj = join(dir, 'projects', 'C--code-demo-app')
    mkdirSync(proj, { recursive: true })
    const lines = [
      { type: 'custom-title', customTitle: 'Pilot run', sessionId: 'sess-1' },
      { type: 'user', cwd: 'C:/code/demo-app', sessionId: 'sess-1', timestamp: '2026-10-12T08:00:00Z', message: { content: `Run the Fabric TEST tenant pilot, tenant id ${GUID}, account pilot.tester@example.org password: ${PW}` } },
      { type: 'assistant', cwd: 'C:/code/demo-app', sessionId: 'sess-1', timestamp: '2026-10-12T08:01:00Z', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'curl -s https://api.fabric.microsoft.com/v1/workspaces' } }] } },
      { type: 'user', cwd: 'C:/code/demo-app', sessionId: 'sess-1', timestamp: '2026-10-12T08:01:05Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true, content: 'HTTP 401' }] } },
      { type: 'user', cwd: 'C:/code/other', sessionId: 'sess-1', timestamp: '2026-10-12T08:02:00Z', message: { content: `unrelated GH=${GH}` } },
    ]
    writeFileSync(join(proj, 'sess-1.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
    const mc = join(dir, 'manual-checks.md')
    writeFileSync(mc, '# checks\n2026-10-13 · demo-app · Access login on demo.workers.dev · open it\n')
    const data = join(dir, 'data')
    mkdirSync(data)
    writeFileSync(join(data, 'config.json'), JSON.stringify({ recovery: { sources: { transcripts: [join(dir, 'projects')], manual_checks: [mc], repo_roots: [], extra_roots: [] } } }))
    const r = spawnSync(process.execPath, [new URL('../scanner/recover.mjs', here).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--data-dir', data], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout.trim())
    assert.equal(out.counts.secrets_seen, 2)
    assert.equal(out.counts.commands, 1)
    assert.ok(!r.stdout.includes(GUID) && !r.stdout.includes('example.org'), 'stdout: counts only')
    const saved = readFileSync(join(data, 'recovered.json'), 'utf8')
    assert.ok(!saved.includes(PW) && !saved.includes(GH), 'no secret value saved')
    const rec = JSON.parse(saved)
    assert.equal(rec.apps['demo-app'].commands[0].errors, 1)
    assert.equal(rec.apps['demo-app'].sessions[0].title, 'Pilot run')
    assert.equal(rec.apps['demo-app'].manual.length, 1)
    assert.equal(rec.apps['demo-app'].ids[0].value, GUID)
    assert.equal(rec.apps.other.secrets[0].kind, 'jeton GitHub')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
