// export-eta - pure logic and the exporter on fixture sessions only: node --test mods/export-eta/tests/logic.test.mjs
// Secrets below are assembled from pieces so this file itself passes the repo's confidentiality scan.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { check, looksSecret, mask } from '../lib/mask.mjs'
import { batchOf, frontMatter, pathOf, projectOf, stateOf } from '../lib/layout.mjs'
import { blocksOf, render, split, toolLine } from '../lib/render.mjs'
import { bandLine, batchView, historyRows, selection } from '../hooks/view.mjs'
import { build, main } from '../exporter/export.mjs'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const MIN = 60000
const AT = '@'
const SECRETS = {
  github: 'gh' + 'p_' + 'Ab1'.repeat(12),
  gitlab: 'gl' + 'pat-' + 'x9Y'.repeat(7),
  anthropic: 'sk-' + 'ant-' + 'api03-' + 'Zq7'.repeat(10),
  openai: 'sk-' + 'proj-' + 'Rt5'.repeat(14),
  aws: 'AK' + 'IA' + 'ABCDEFGHIJ234567',
  jwt: 'ey' + 'JhbGciOiJIUzI1NiJ9.' + 'ey' + 'JzdWIiOiIxMjM0NTY3ODkwIn0.' + 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  password: 'Hunter2-' + 'Sup3r',
  conn: 'Server=sql01;Database=app;User Id=sa;Pass' + 'word=Tr0ub4dor&3;',
  cookie: 'Cook' + 'ie: sessionid=abc123def456ghi789; csrftoken=zzz',
  url: 'https://deploy:' + 'S3cr3tPassw0rd' + AT + 'git.corp.io/x.git',
  bearer: 'Authorization: Bearer ' + 'aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gI',
  key: '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0\nabc\n-----END ' + 'RSA PRIVATE KEY-----',
  mail: 'bob.martin' + AT + 'client-corp.com',
}
const OWN = 'me' + AT + 'mine.dev'

test('mask: every kind of secret is replaced and counted, none survives', () => {
  const text = [
    `token GitHub ${SECRETS.github}`, `GitLab ${SECRETS.gitlab}`, `clé ${SECRETS.anthropic}`, `openai ${SECRETS.openai}`, `aws ${SECRETS.aws}`,
    `jwt ${SECRETS.jwt}`, `password: ${SECRETS.password}`, SECRETS.conn, SECRETS.cookie, `clone ${SECRETS.url}`, SECRETS.bearer, SECRETS.key,
    `écris à ${SECRETS.mail} et à ${OWN}`, 'API_KEY=Zx81Kq92Lm03Np74Rs65', 'client_secret: "aV3bW4cX5dY6eZ7fA8gB9h"',
  ].join('\n')
  const m = mask(text, { own_emails: [OWN] })
  for (const [k, v] of Object.entries(SECRETS)) {
    const core = k === 'conn' ? 'Tr0ub4dor' : k === 'cookie' ? 'abc123def456' : k === 'url' ? 'S3cr3tPassw0rd' : k === 'bearer' ? 'aB3dE5gH7jK9' : k === 'key' ? 'MIIEowIBAAK' : v
    assert.ok(!m.text.includes(core), `${k} survived: ${m.text}`)
  }
  assert.ok(!m.text.includes('Zx81Kq92Lm03'))
  assert.ok(!m.text.includes('aV3bW4cX5dY6'))
  assert.ok(m.text.includes(OWN), 'own e-mail kept')
  assert.ok(m.text.includes('git.corp.io'), 'host kept, only the password masked')
  assert.ok(m.total >= 14, `counted ${m.total}`)
  assert.equal(m.counts.email, 1)
  assert.equal(m.counts['private-key'], 1)
  assert.deepEqual(check(m.text, { own_emails: [OWN] }), [], 'nothing left after masking')
})

test('mask: prose is left alone (tokens, secrets, placeholders)', () => {
  const prose = 'Le contexte a 300K tokens; token: 250000; secret: oui; password: <PASSWORD>; API_KEY=$API_KEY; voir docs.'
  const m = mask(prose, {})
  assert.equal(m.text, prose)
  assert.equal(m.total, 0)
  assert.equal(looksSecret('250000'), false)
  assert.equal(looksSecret('Zx81Kq92Lm03Np74Rs65'), true)
})

test('mask: config patterns and pattern files (tests-reels) add rules', () => {
  const m = mask('le code client FOIL-CLIENT-4471 est privé', { extra_patterns: [{ name: 'client-code', regex: 'FOIL-CLIENT-\\d+' }] })
  assert.ok(!m.text.includes('4471'))
  assert.equal(m.counts['client-code'], 1)
  const f = mask('ticket TR-SECRET-99', { file_patterns: [{ name: 'tests-reels', pattern: 'TR-SECRET-\\d+' }] })
  assert.equal(f.counts['tests-reels'], 1)
})

test('held back: what cannot be masked is reported (half a private key)', () => {
  const half = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA (coupé)'
  const m = mask(half, {})
  const hits = check(m.text, {})
  assert.ok(hits.some((h) => /private-key/.test(h.kind)), JSON.stringify(hits))
})

const LINES = [
  { type: 'user', timestamp: '2026-10-16T10:00:00Z', message: { content: `<system-reminder>caché</system-reminder>Lance les tests, mot de passe password=${SECRETS.password}` } },
  { type: 'assistant', timestamp: '2026-10-16T10:00:05Z', message: { content: [{ type: 'thinking', thinking: 'secret thoughts' }, { type: 'text', text: 'Je lance les tests.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Run the unit tests' } }] } },
  { type: 'user', timestamp: '2026-10-16T10:00:20Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'FULL TOOL OUTPUT 500 lines' }] } },
  { type: 'assistant', timestamp: '2026-10-16T10:00:30Z', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'C:/code/app/src/index.ts' } }, { type: 'tool_use', id: 't3', name: 'Agent', input: { description: 'Search call sites', subagent_type: 'explore-fast', model: 'haiku', prompt: 'long prompt' } }] } },
  { type: 'user', timestamp: '2026-10-16T10:00:31Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'FILE DUMP export const x = 1' }] } },
  { type: 'assistant', isSidechain: true, timestamp: '2026-10-16T10:00:40Z', message: { content: [{ type: 'text', text: 'SIDECHAIN TEXT' }] } },
  { type: 'user', timestamp: '2026-10-16T10:01:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: [{ type: 'text', text: '## Found 3 call sites\nsrc/a.ts:10\nagentId: abc' }] }] } },
  { type: 'assistant', timestamp: '2026-10-16T10:01:10Z', message: { content: [{ type: 'text', text: 'Tests verts, 3 appels trouvés.' }] } },
  { type: 'user', timestamp: '2026-10-16T10:05:00Z', message: { content: '<task-notification><status>completed</status><summary>Agent "coder" finished</summary><result>PR #12 merged</result></task-notification>' } },
  { type: 'user', timestamp: '2026-10-16T10:06:00Z', message: { content: '<command-name>/factory</command-name><command-args>focus</command-args>' } },
]
const SESSION = {
  cli: 'aaaaaaaa-1111-2222-3333-444444444444', sid: 'local_a', title: 'Lane A: tests', project: 'app', cwd: 'C:/code/app/.claude/worktrees/x', origin: 'C:/code/app',
  branch: 'claude/a', model: 'claude-opus-5-5', effort: 'medium', created: Date.parse('2026-10-16T10:00:00Z'), last_activity: Date.parse('2026-10-16T10:06:00Z'),
  state: 'finished', state_label: 'terminée', status_detail: 'PR #12 merged', parent: 'local_lead', parent_title: 'LEAD', children: [],
  prs: [{ url: 'https://github.com/o/app/pull/12', number: 12, repo: 'o/app', state: 'merged' }],
}

test('render: header, messages in order, one line per tool, outputs and sidechains omitted, agent result in one line', () => {
  const { md, last, counts } = render(SESSION, LINES, { now: NOW })
  assert.match(md, /^---\ntitle: "Lane A: tests"/)
  assert.match(md, /\| Modèle · effort \| claude-opus-5-5 · medium \|/)
  assert.match(md, /\| Conversation parente \| LEAD \(`local_lead`\) \|/)
  assert.match(md, /\[app#12\]\(https:\/\/github.com\/o\/app\/pull\/12\) merged/)
  assert.match(md, /- `Bash` Run the unit tests/)
  assert.match(md, /- `Read` src\/index.ts/)
  assert.match(md, /- `Agent` Search call sites \(explore-fast · haiku\)/)
  assert.match(md, /↳ résultat Agent : Found 3 call sites/)
  assert.match(md, /> .* · résultat en arrière-plan \(completed\) : Agent "coder" finished — PR #12 merged/)
  assert.match(md, /### Julian · .*\n\n\/factory focus/)
  for (const gone of ['FULL TOOL OUTPUT', 'FILE DUMP', 'SIDECHAIN', 'secret thoughts', 'caché', 'long prompt']) assert.ok(!md.includes(gone), gone)
  assert.ok(md.indexOf('Je lance les tests.') < md.indexOf('`Bash`'), 'text then tool, in order')
  assert.ok(md.indexOf('`Bash`') < md.indexOf('Tests verts'))
  assert.equal(counts.user, 2)
  assert.match(last, /^Julian : \/factory focus/)
  assert.equal(frontMatter(md).state, 'terminée')
})

test('toolLine never copies content: Bash without description shows only the tool name', () => {
  assert.equal(toolLine('Bash', { command: 'cat secrets.txt' }), '`Bash`')
  assert.equal(toolLine('Write', { file_path: 'D:/x/y/z.md', content: 'BIG' }), '`Write` y/z.md')
})

test('split: long files become parts on message boundaries; past max_parts, a truncation note', () => {
  const lines = Array.from({ length: 60 }, (_, i) => ({ type: i % 2 ? 'assistant' : 'user', timestamp: `2026-10-16T10:${String(i).padStart(2, '0')}:00Z`, message: { content: i % 2 ? [{ type: 'text', text: 'r'.repeat(900) }] : 'q'.repeat(900) } }))
  const { md } = render(SESSION, lines, { now: NOW })
  const parts = split(md, 8 * 1024, 10)
  assert.ok(parts.length >= 6, String(parts.length))
  assert.ok(parts.every((p) => Buffer.byteLength(p) <= 8 * 1024 + 200))
  assert.ok(parts.slice(1).every((p) => /^<!-- partie \d+\/\d+ -->/.test(p)))
  const cut = split(md, 8 * 1024, 2)
  assert.equal(cut.length, 2)
  assert.match(cut[1], /tronqué : \d+ partie\(s\) de plus/)
})

test('paths: project from the repo folder (worktrees included), file name stable, re-export reuses its own file', () => {
  assert.equal(projectOf({ cwd: 'D:\\code\\My Repo\\.claude\\worktrees\\abc' }), 'my-repo')
  const cfg = { dest_dir: 'sources/conversations/{project}' }
  const p = pathOf(SESSION, cfg, '2026-10-16', [])
  assert.equal(p, 'sources/conversations/app/2026-10-16-lane-a-tests-aaaaaaaa.md')
  const renamed = { ...SESSION, title: 'Renamed later' }
  const existing = [p, 'sources/conversations/app/2026-10-15-other-bbbbbbbb.md']
  assert.equal(pathOf(renamed, cfg, '2026-10-16', existing), p, 'same id → same file, whatever the title')
  assert.equal(pathOf({ ...SESSION, cli: 'bbbbbbbb-x' }, cfg, '2026-10-16', existing), existing[1])
})

test('state: archived or completed and quiet = finished; live wins; recent = ongoing', () => {
  const cfg = { finished_categories: ['completed'], finished_quiet_min: 5, live_s: 180, ongoing_hours: 24 }
  assert.equal(stateOf({ archived: true, last_activity: NOW - 99 * 3600000 }, cfg, NOW), 'finished')
  assert.equal(stateOf({ status_category: 'completed', last_activity: NOW - 10 * MIN }, cfg, NOW), 'finished')
  assert.equal(stateOf({ status_category: 'completed', last_activity: NOW - 2 * MIN, mtime: NOW - 60000 }, cfg, NOW), 'live')
  assert.equal(stateOf({ status_category: 'blocked', last_activity: NOW - 60 * MIN }, cfg, NOW), 'ongoing')
  assert.equal(stateOf({ status_category: 'review_ready', last_activity: NOW - 48 * 3600000 }, cfg, NOW), 'old')
})

const S = (cli, o = {}) => ({ cli, sid: `local_${cli}`, title: cli, status_category: 'completed', last_activity: NOW - 30 * MIN, mtime: NOW - 30 * MIN, ...o })

test('batch: ready at N finished since the last export; exported ones drop out; old history never counts', () => {
  const cfg = { batch_min: 3, finished_categories: ['completed'] }
  const sessions = [S('a'), S('b'), S('c'), S('d', { status_category: 'blocked' }), S('old', { last_activity: NOW - 99 * 3600000 })]
  const st = { since: NOW - 48 * 3600000, exported: {} }
  const b = batchOf(sessions, st, cfg, NOW)
  assert.equal(b.ready, true)
  assert.equal(b.reason, 'count')
  assert.deepEqual(b.ids.sort(), ['a', 'b', 'c'])
  const after = batchOf(sessions, { ...st, exported: { a: { last_activity: NOW - 30 * MIN } } }, cfg, NOW)
  assert.equal(after.ready, false)
  assert.equal(after.count, 2)
  const moved = batchOf(sessions.map((s) => (s.cli === 'a' ? { ...s, last_activity: NOW - 10 * MIN } : s)), { ...st, exported: { a: { last_activity: NOW - 30 * MIN } } }, cfg, NOW)
  assert.equal(moved.count, 3, 'a conversation that moved after its export comes back')
  assert.equal(batchOf(sessions, { since: NOW - 20 * MIN, exported: {} }, cfg, NOW).count, 0, 'finished before `since`: not proposed')
})

test('batch: a lead and all its sub-conversations finished make a batch below N', () => {
  const cfg = { batch_min: 5, finished_categories: ['completed'] }
  const lead = S('lead')
  const kids = [S('k1', { parent: 'local_lead' }), S('k2', { parent: 'local_lead' })]
  const st = { since: NOW - 3600000 * 48, exported: {} }
  const b = batchOf([lead, ...kids], st, cfg, NOW)
  assert.equal(b.ready, true)
  assert.equal(b.reason, 'lead')
  assert.deepEqual(b.ids.sort(), ['k1', 'k2', 'lead'])
  const busy = batchOf([lead, kids[0], { ...kids[1], status_category: 'blocked' }], st, cfg, NOW)
  assert.equal(busy.ready, false, 'one sub-conversation still running')
})

test('view: band line only for a ready batch, dismiss per batch; history and selection rows', () => {
  const cfg = { batch_min: 3, labels: { batch_notice: '{n} conversations terminées — Exporter vers eta', batch_none: '{n}/{min}' } }
  const pending = { ready: true, count: 4, ids: ['b', 'a', 'c', 'd'], reason: 'count', text: '' }
  assert.equal(bandLine(pending, cfg, '').text, '4 conversations terminées — Exporter vers eta')
  assert.equal(bandLine(pending, cfg, 'a,b,c,d'), null)
  assert.equal(bandLine({ ...pending, ready: false }, cfg, ''), null)
  assert.equal(batchView({ ready: false, count: 1 }, cfg).none, '1/3')
  const h = historyRows({ history: [{ at: NOW, mode: 'batch', count: 4, pr: 7, url: 'https://x/pull/7', merged: true, masked: { email: 2, jwt: 1 }, held: [{ title: 'T' }] }] })
  assert.equal(h[0].masked, 'email 2, jwt 1')
  assert.deepEqual(h[0].held, ['T'])
  assert.equal(h[0].tone, 'warn')
  const g = selection([{ ...S('a'), project: 'p1', state: 'finished' }, { ...S('b'), project: 'p1', state: 'finished' }, { ...S('c'), project: 'p2', state: 'ongoing' }], new Set(['a']), new Set(['p1']))
  assert.equal(g.length, 1)
  assert.equal(g[0].picked, 1)
  assert.equal(g[0].rows.find((r) => r.cli === 'a').checked, true)
})

// ---- exporter end to end on fixture files (no git: --out) -----------------------------------------------------------

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-eta-'))
  const app = path.join(dir, 'app', 'acct', 'org')
  const projects = path.join(dir, 'projects')
  fs.mkdirSync(app, { recursive: true })
  const add = (cli, title, cwd, lines, o = {}) => {
    fs.writeFileSync(path.join(app, `local_${cli}.json`), JSON.stringify({
      sessionId: `local_${cli}`, cliSessionId: cli, cwd, originCwd: cwd, title, model: 'claude-opus-5-5', effort: 'medium',
      createdAt: NOW - 3600000, lastActivityAt: NOW - 30 * MIN, isArchived: false, postTurnSummary: { status_category: 'completed', status_detail: 'done' }, ...o,
    }))
    const folder = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'))
    fs.mkdirSync(folder, { recursive: true })
    const f = path.join(folder, `${cli}.jsonl`)
    fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    fs.utimesSync(f, new Date(NOW - 30 * MIN), new Date(NOW - 30 * MIN))
  }
  add('11111111-aaaa', 'Clean lane', 'C:/code/app', LINES)
  add('22222222-bbbb', 'Leaky lane', 'C:/code/app', [{ type: 'user', timestamp: '2026-10-16T10:00:00Z', message: { content: 'voici la clé ' + '-----BEGIN ' + 'EC PRIVATE KEY-----\nMHcCAQEE (collé à moitié)' } }])
  add('33333333-cccc', 'Other repo', 'C:/code/web', [{ type: 'user', timestamp: '2026-10-16T10:00:00Z', message: { content: `token ${SECRETS.github}` } }])
  return { dir, app: path.join(dir, 'app'), projects, home: path.join(dir, 'home'), out: path.join(dir, 'eta') }
}

test('exporter --out: masked files, held-back file listed not written, indexes, idempotent re-export', async () => {
  const f = fixture()
  const common = ['--app', f.app, '--projects', f.projects, '--home', f.home, '--now', String(NOW)]
  const log = console.log
  let printed = ''
  console.log = (s) => { printed += s + '\n' }
  try {
    assert.equal(await main(['run', '--mode', 'selection', '--ids', '11111111-aaaa,22222222-bbbb,33333333-cccc', '--out', f.out, ...common]), 0)
  } finally { console.log = log }
  const root = path.join(f.out, 'sources', 'conversations')
  const clean = path.join(root, 'app', '2026-10-16-clean-lane-11111111.md')
  assert.ok(fs.existsSync(clean), printed)
  assert.ok(!fs.readFileSync(clean, 'utf8').includes(SECRETS.password))
  assert.ok(!fs.readdirSync(path.join(root, 'app')).some((x) => x.includes('22222222')), 'leaky file held back')
  const web = fs.readFileSync(path.join(root, 'web', '2026-10-16-other-repo-33333333.md'), 'utf8')
  assert.ok(!web.includes(SECRETS.github) && web.includes('«masqué:github-token»'))
  assert.match(fs.readFileSync(path.join(root, 'INDEX.md'), 'utf8'), /\[app\]\(app\/INDEX.md\) \| 1 \|/)
  assert.match(fs.readFileSync(path.join(root, 'app', 'INDEX.md'), 'utf8'), /Clean lane/)
  const st = JSON.parse(fs.readFileSync(path.join(f.home, 'state.json'), 'utf8'))
  assert.equal(st.history[0].count, 2)
  assert.deepEqual(st.history[0].held.map((h) => h.title), ['Leaky lane'])
  assert.ok(st.history[0].masked['github-token'] >= 1 && (st.history[0].masked.password || 0) + (st.history[0].masked['connection-string'] || 0) >= 1)
  // a hand-made file of another conversation stays untouched; re-export rewrites only its own file
  const other = path.join(root, 'app', '2026-10-01-someone-else-99999999.md')
  fs.writeFileSync(other, '---\ntitle: "Someone"\nlast_activity: "2026-10-01 10:00"\n---\nkeep me\n')
  fs.writeFileSync(path.join(f.app, 'acct', 'org', 'local_11111111-aaaa.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(f.app, 'acct', 'org', 'local_11111111-aaaa.json'), 'utf8')), title: 'Clean lane renamed' }))
  console.log = () => {}
  try { assert.equal(await main(['run', '--mode', 'selection', '--ids', '11111111-aaaa', '--out', f.out, ...common]), 0) } finally { console.log = log }
  const files = fs.readdirSync(path.join(root, 'app')).filter((x) => x.includes('11111111'))
  assert.deepEqual(files, ['2026-10-16-clean-lane-11111111.md'], 'same file, no duplicate after a rename')
  assert.match(fs.readFileSync(clean, 'utf8'), /title: "Clean lane renamed"/)
  assert.equal(fs.readFileSync(other, 'utf8').includes('keep me'), true)
  assert.match(fs.readFileSync(path.join(root, 'app', 'INDEX.md'), 'utf8'), /Someone/)
  fs.rmSync(f.dir, { recursive: true, force: true })
})

test('build: a re-export with fewer parts removes only its own stale parts', () => {
  const s = { ...SESSION, lines: LINES }
  const existing = ['sources/conversations/app/2026-10-16-lane-a-tests-aaaaaaaa.md', 'sources/conversations/app/2026-10-16-lane-a-tests-aaaaaaaa.part2.md', 'sources/conversations/app/2026-10-16-x-bbbbbbbb.part2.md']
  const r = build([s], { max_kb: 300 }, existing, NOW)
  assert.deepEqual(r.stale, ['sources/conversations/app/2026-10-16-lane-a-tests-aaaaaaaa.part2.md'])
  assert.equal(r.files.length, 1)
})
