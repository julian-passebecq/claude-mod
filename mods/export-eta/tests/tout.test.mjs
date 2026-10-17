// export-eta « Exporter tout » on invented fixtures only: node --test mods/export-eta/tests/tout.test.mjs
// Secrets below are assembled from pieces so this file itself passes the repo's confidentiality scan.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { main } from '../exporter/export.mjs'
import { toutLine, toutSessions } from '../exporter/tout.mjs'
import { forbidden, maskAll, scanWorkflows, snapStamp, table } from '../lib/snapshot.mjs'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const MIN = 60000
const GH = 'gh' + 'p_' + 'Qw3'.repeat(12)
const SMTP_PASS = 'smtp-' + 'Pa55' + 'wordXyz9'
const ENV_SECRET = 'Zx81' + 'Kq92Lm03Np74Rs65'

const w = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)) }

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-tout-'))
  const app = path.join(dir, 'app', 'acct', 'org')
  const projects = path.join(dir, 'projects')
  const ch = path.join(dir, 'claude')
  const lines = [
    { type: 'user', timestamp: '2026-10-16T11:40:00Z', message: { content: 'Construis le panneau.' } },
    { type: 'assistant', timestamp: '2026-10-16T11:41:00Z', message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Je lance un workflow.' }] } },
  ]
  const add = (cli, title, cwd, o = {}) => {
    w(path.join(app, `local_${cli}.json`), { sessionId: `local_${cli}`, cliSessionId: cli, cwd, originCwd: cwd, title, model: 'claude-opus-5-5', effort: 'medium', createdAt: NOW - 3600000, lastActivityAt: NOW - 10 * MIN, isArchived: false, postTurnSummary: { status_category: 'in_progress', status_detail: 'working' }, prs: [{ url: 'https://example.com/o/app/pull/7', prNumber: 7, repo: 'o/app', state: 'OPEN' }], ...o })
    const f = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'), `${cli}.jsonl`)
    w(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    fs.utimesSync(f, new Date(NOW - 10 * MIN), new Date(NOW - 10 * MIN))
    return f
  }
  const lead = add('aaaaaaaa-1111', 'Lead lane', 'C:/code/app')
  add('bbbbbbbb-2222', 'Old finished lane', 'C:/code/app', { lastActivityAt: NOW - 50 * 3600000, isArchived: true })
  // a workflow of the lead: two agents, one still running
  const wf = path.join(path.dirname(lead), 'aaaaaaaa-1111', 'subagents', 'workflows', 'wf_test-1')
  w(path.join(wf, 'journal.jsonl'), [{ type: 'launched' }, { type: 'started', agentId: 'x1', label: 'code:panel', phase: 'Build' }, { type: 'started', agentId: 'x2', label: 'verify', phase: 'Verify' }, { type: 'result', agentId: 'x1', result: 'ok' }].map((x) => JSON.stringify(x)).join('\n'))
  w(path.join(wf, 'agent-x1.jsonl'), '{}\n')
  w(path.join(wf, 'agent-x2.jsonl'), '{}\n')
  for (const f of ['journal.jsonl', 'agent-x1.jsonl', 'agent-x2.jsonl']) fs.utimesSync(path.join(wf, f), new Date(NOW - 2 * MIN), new Date(NOW - 2 * MIN))
  // ~/.claude as the other mods leave it
  w(path.join(ch, 'CLAUDE.md'), '# Rules V9\n- merge on green\n')
  w(path.join(ch, 'settings.json'), { env: { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-5-5', MY_API_TOKEN: ENV_SECRET, CLAUDE_CODE_PLUGIN_DIRS: path.join(dir, 'mods', 'demo') }, theme: 'dark' })
  w(path.join(dir, 'mods', 'demo', '.claude-plugin', 'plugin.json'), { name: 'demo', version: '1.2.3', description: 'Demo mod' })
  w(path.join(ch, 'veille', 'smtp.json'), { user: 'x', pass: SMTP_PASS })
  w(path.join(ch, '.credentials.json'), { token: SMTP_PASS })
  w(path.join(ch, 'veille', 'state.json'), { mode: 'légère', tours: 4, last_tour: NOW - 5 * MIN, alerts: { a: { key: 'a', kind: 'green', severity: 'warn', what: 'app#7 verte depuis 2 j', julian: false, since: NOW - 2 * 86400000 }, b: { key: 'b', kind: 'fil_needs', severity: 'julian', what: 'Attend Julian : login', julian: true, since: NOW - 3600000 } } })
  w(path.join(ch, 'veille', 'heartbeat.json'), { last_fire: NOW - MIN, fires: 9, last_tour_ok: true })
  w(path.join(ch, 'veille', 'fil.json'), { hours: 48, total: 1, julian: 1, projects: [{ name: 'app', total: 1, convs: [{ cli: 'aaaaaaaa-1111', title: 'Lead lane', state: 'attend', last_at: NOW - MIN, preview: 'Dois-je merger ?' }] }] })
  w(path.join(ch, 'a-faire', 'items.json'), { at: NOW, open: [{ id: 'i1', cat: 'logins', prio: 'now', title: 'Se connecter au tenant', why: 'live rows', steps: ['ouvrir', 'valider'], since: NOW - 86400000 }], snoozed: [], errors: [] })
  w(path.join(ch, 'a-faire', 'summary.json'), { open: 1, by_cat: { logins: 1 }, by_prio: { now: 1 } })
  w(path.join(ch, 'problemes', 'problems.json'), { generated: NOW, totals: { open: 1, fixed: 1 }, problems: [{ id: 'P-001', category: 'ci', title: 'Runner idle', symptom: `log shows ${GH}`, cause: 'monitor died', fix: '', status: 'ouvert', count: 4, last_seen: NOW - 3600000 }, { id: 'P-002', category: 'ci', title: 'Fixed thing', status: 'corrigé', fix: 'restart', changed: NOW - 86400000 }] })
  w(path.join(ch, 'usage-mod', 'classement.json'), { generated: NOW, sessions: { 'aaaaaaaa-1111': { t: 'Lead lane', p: 'app' } }, rows: [[NOW - 3600000, 'aaaaaaaa-1111', 'main', 'claude-opus-5-5', '', '', '', 100, 5000, 200000, 0, 1000, 10, 100, 1.5], [NOW - 3600000, 'aaaaaaaa-1111', 'agent', 'claude-sonnet-5-5', '', '', '', 50, 2000, 50000, 0, 0, 5, 50, 0.3]] })
  w(path.join(ch, 'usage-mod', 'samples.jsonl'), JSON.stringify({ ts: NOW - MIN, five_hour: { pct: 40, reset: NOW + 3600000 }, seven_day: { pct: 20, reset: NOW + 3 * 86400000 } }) + '\n')
  w(path.join(ch, 'ci-pipelines-cache.json'), { generated: new Date(NOW - 5 * MIN).toISOString(), summary: { today: { runs: 3, success: 2, failed: 1, running: 1, pass_rate: 66, minutes: 9 }, by_host: [{ key: 'gitlab-local', runs: 3, success: 2, failed: 1, running: 1, pass_rate: 66, minutes: 9 }], by_app: [{ key: 'app', runs: 3, success: 2, failed: 1, pass_rate: 66, minutes: 9 }], queue: { backend: 'gitlab-local', running: 1, concurrent: 18, runners_online: 1 } }, apps: [{ app: 'app', runs: [
    { app: 'app', workflow: 'ci', status: 'success', created: new Date(NOW - 9 * 3600000).toISOString(), duration_s: 600 },
    { app: 'app', workflow: 'ci', status: 'success', created: new Date(NOW - 8 * 3600000).toISOString(), duration_s: 660 },
    { app: 'app', workflow: 'ci', status: 'success', created: new Date(NOW - 7 * 3600000).toISOString(), duration_s: 720 },
    { app: 'app', workflow: 'ci', status: 'running', branch: 'claude/x', created: new Date(NOW - 4 * MIN).toISOString(), url: 'https://example.com/run/4' },
    { app: 'app', workflow: 'ci', status: 'failed', branch: 'claude/y', title: 'Broken', created: new Date(NOW - 3600000).toISOString(), jobs: [{ name: 'test', status: 'failed' }], url: 'https://example.com/run/3' },
  ] }] })
  w(path.join(ch, 'mods-health', 'veille.json'), { mod: 'veille', lastRun: new Date(NOW - MIN).toISOString(), durationMs: 80, error: null, window: { runs: 5, errors: 0, cpuMs: 1000 } })
  w(path.join(ch, 'mods-health', 'ci.json'), { mod: 'ci', lastRun: new Date(NOW - MIN).toISOString(), durationMs: 80, error: 'gh_failed: timeout', window: { runs: 5, errors: 2, cpuMs: 1000 } })
  w(path.join(ch, 'effort-board', 'audits', '2026-10-15-audit.md'), '# Audit\nall good\n')
  w(path.join(ch, 'effort-board', 'manual-checks.md'), '2026-10-15 · app · son · écouter\n')
  w(path.join(ch, 'effort-board', 'questions.md'), '2026-10-16 · app · merge? · oui · règles\n')
  w(path.join(ch, 'tests-reels', 'recovered.json'), { generated: NOW, counts: { apps: 1 }, sources: { transcripts: 2 }, errors: [], apps: { app: { categories: { cloudflare: 2 }, sessions: [{ id: 's' }], accounts: ['someone' + '@' + 'corp.example'] } } })
  const home = path.join(dir, 'home')
  w(path.join(home, 'config.json'), { tout: { claude_home: ch, rules_files: [path.join(ch, 'CLAUDE.md')] } })
  return { dir, app: path.join(dir, 'app'), projects, home, ch, out: path.join(dir, 'eta') }
}

const quiet = async (fn) => {
  const log = console.log
  let printed = ''
  console.log = (...a) => { printed += a.join(' ') + '\n' }
  try { return { code: await fn(), printed } } finally { console.log = log }
}

test('forbidden files are refused whatever the path', () => {
  for (const f of ['C:/u/.claude/veille/smtp.json', '/h/.claude/.credentials.json', 'x/auth.json', 'k/id_rsa', 'a/b.pem', 'a/c.key']) assert.ok(forbidden(f), f)
  for (const f of ['C:/u/.claude/veille/state.json', 'a/keys.md', 'audit.md']) assert.ok(!forbidden(f), f)
})

test('stamp, table and the result line (labels configurable)', () => {
  assert.match(snapStamp(NOW).folder, /^\d{4}-\d{2}-\d{2}-\d{4}$/)
  assert.match(table(['a'], [['x|y']]), /x\\\|y/)
  assert.equal(toutLine({ files_count: 12, pr: 9, merged: true }), 'Exporté : 12 fichiers, PR #9 mergée')
  assert.equal(toutLine({ files_count: 3, pr: 9, merged: true }, { labels: { tout_done: '{n} files, PR #{pr} merged' } }), '3 files, PR #9 merged')
  assert.match(toutLine({ files_count: 3, error: 'boom' }), /échoué : boom/)
})

test('maskAll: a masked file is kept, an unmaskable one is held', () => {
  const r = maskAll([{ path: 'a.md', content: `token ${GH}` }, { path: 'b.md', content: 'clé ' + '-----BEGIN ' + 'EC PRIVATE KEY-----\nMHcC' }], {})
  assert.deepEqual(r.files.map((f) => f.path), ['a.md'])
  assert.ok(!r.files[0].content.includes(GH))
  assert.deepEqual(r.held.map((h) => h.path), ['b.md'])
})

test('workflows: agents, phases and the running one', () => {
  const f = fixture()
  const wfs = scanWorkflows(f.projects, NOW, {})
  assert.equal(wfs.length, 1)
  assert.equal(wfs[0].active, true)
  assert.deepEqual([wfs[0].done, wfs[0].running], [1, 1])
  assert.equal(wfs[0].session, 'aaaaaaaa-1111')
  fs.rmSync(f.dir, { recursive: true, force: true })
})

test('tout --out: dated snapshot with an INDEX for an AI, every section, secrets masked, credentials never read', async () => {
  const f = fixture()
  const { code, printed } = await quiet(() => main(['tout', '--out', f.out, '--app', f.app, '--projects', f.projects, '--home', f.home, '--now', String(NOW)]))
  assert.equal(code, 0, printed)
  assert.match(printed, /Exporté : \d+ fichiers dans le dossier local/)
  const snaps = path.join(f.out, 'sources', 'claude-control', 'snapshots')
  const [folder] = fs.readdirSync(snaps)
  const S = path.join(snaps, folder)
  const read = (p) => fs.readFileSync(path.join(S, p), 'utf8')
  const index = read('INDEX.md')
  for (const p of ['status/sessions.md', 'status/workflows.md', 'status/ci.md', 'status/usage.md', 'problemes.md', 'veille.md', 'a-faire.md', 'outputs/health.md', 'outputs/audits/2026-10-15-audit.md', 'outputs/manual-checks.md', 'outputs/questions-recent.md', 'outputs/tests-reels.md', 'rules/CLAUDE.md', 'rules/settings-and-mods.md', 'conversations.md']) {
    assert.ok(fs.existsSync(path.join(S, p)), `missing ${p}`)
    assert.ok(index.includes(`(${p})`), `INDEX does not list ${p}`)
  }
  assert.match(index, /Pour l’IA qui analyse/)
  assert.match(read('status/sessions.md'), /Lead lane/)
  assert.match(read('status/workflows.md'), /code:panel[\s\S]*verify \| Verify \| en cours/)
  assert.match(read('status/ci.md'), /claude\/x \| running \| [^|]+ \| 2026-/, 'ETA from 3 green runs')
  assert.match(read('status/ci.md'), /Broken/)
  assert.match(read('status/usage.md'), /Claude 5 h : 40 %[\s\S]*Lead lane/)
  assert.match(read('problemes.md'), /P-001[\s\S]*Fixed thing/)
  assert.match(read('veille.md'), /Attend Julian : 1[\s\S]*Dois-je merger/)
  assert.match(read('a-faire.md'), /Se connecter au tenant/)
  assert.match(read('outputs/health.md'), /gh_failed: timeout/)
  assert.match(read('rules/settings-and-mods.md'), /demo \| 1\.2\.3/)
  assert.match(read('conversations.md'), /Lead lane[\s\S]*sources\/conversations\/app\//)
  // conversations rendered beside the snapshot; the archived old one is not part of it
  const conv = fs.readdirSync(path.join(f.out, 'sources', 'conversations', 'app'))
  assert.ok(conv.some((x) => x.includes('aaaaaaaa')) && !conv.some((x) => x.includes('bbbbbbbb')), conv.join(','))
  // nothing secret anywhere in the output
  const all = []
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : all.push(fs.readFileSync(path.join(d, e.name), 'utf8')) }
  walk(f.out)
  const blob = all.join('\n')
  for (const s of [GH, SMTP_PASS, ENV_SECRET, 'someone' + '@' + 'corp.example']) assert.ok(!blob.includes(s), `leaked ${s.slice(0, 6)}`)
  assert.match(read('problemes.md'), /«masqué:github-token»/)
  const st = JSON.parse(fs.readFileSync(path.join(f.home, 'state.json'), 'utf8'))
  assert.equal(st.history[0].mode, 'tout')
  assert.ok(st.history[0].files_count > 15)
  assert.ok(st.exported['aaaaaaaa-1111'], 'exported conversation remembered')
  fs.rmSync(f.dir, { recursive: true, force: true })
})

test('tout: finished since the last export are added, already exported ones are not', () => {
  const cfg = { exclude: [] }
  const all = [
    { cli: 'o', state: 'ongoing', last_activity: NOW }, { cli: 'f1', state: 'finished', last_activity: NOW - 10 },
    { cli: 'f2', state: 'finished', last_activity: NOW - 20 }, { cli: 'f3', state: 'finished', last_activity: 5 },
  ]
  const state = { since: 100, exported: { f2: { last_activity: NOW - 20 } } }
  assert.deepEqual(toutSessions(all, state, cfg, { conversations: ['ongoing', 'batch'] }, NOW).map((s) => s.cli), ['o', 'f1'])
  assert.deepEqual(toutSessions(all, state, cfg, { conversations: ['ongoing'] }, NOW).map((s) => s.cli), ['o'])
})

test('tout through git on a temp fake eta repo: branch pushed with the snapshot, worktree removed, nothing on main', async (t) => {
  if (spawnSync('git', ['--version']).status !== 0) return t.skip('no git')
  const f = fixture()
  const g = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' })
  const bare = path.join(f.dir, 'eta.git')
  const repo = path.join(f.dir, 'eta-checkout')
  g(['init', '-q', '--bare', '-b', 'main', bare])
  g(['clone', '-q', bare, repo])
  g(['config', 'user.email', 'test' + '@' + 'example.com'], repo)
  g(['config', 'user.name', 'Test'], repo)
  w(path.join(repo, 'README.md'), '# eta\n')
  g(['add', '.'], repo)
  g(['commit', '-q', '-m', 'init'], repo)
  g(['push', '-q', 'origin', 'HEAD:main'], repo)
  w(path.join(f.home, 'config.json'), { eta: { repo }, tout: { claude_home: f.ch } })
  const { printed } = await quiet(() => main(['tout', '--app', f.app, '--projects', f.projects, '--home', f.home, '--now', String(NOW)]))
  // no GitHub here: the PR step fails, but the branch was pushed with the snapshot and main is untouched
  const branches = g(['branch', '--list', 'export/tout-*'], bare).stdout.trim()
  assert.ok(branches, printed)
  const br = branches.replace(/^[*\s]+/, '')
  const files = g(['ls-tree', '-r', '--name-only', br], bare).stdout
  assert.match(files, /sources\/claude-control\/snapshots\/\d{4}-\d{2}-\d{2}-\d{4}\/INDEX\.md/)
  assert.match(files, /sources\/conversations\/app\//)
  assert.equal(g(['ls-tree', '-r', '--name-only', 'main'], bare).stdout.trim(), 'README.md')
  assert.ok(!fs.existsSync(path.join(repo, '.claude', 'worktrees')) || !fs.readdirSync(path.join(repo, '.claude', 'worktrees')).length, 'worktree removed')
  const st = JSON.parse(fs.readFileSync(path.join(f.home, 'state.json'), 'utf8'))
  assert.equal(st.history[0].mode, 'tout')
  assert.equal(st.history[0].merged, false)
  assert.ok(!st.exported['aaaaaaaa-1111'], 'not merged: not marked exported')
  fs.rmSync(f.dir, { recursive: true, force: true })
})
