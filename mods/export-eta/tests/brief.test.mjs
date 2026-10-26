// export-eta - the brief for another AI (lib/brief.mjs pure, exporter/brief.mjs on fixture files only).
//   node --test mods/export-eta/tests/brief.test.mjs
// Invented fixtures; the secret below is assembled from pieces so this file passes the repo's confidentiality scan.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { BRIEF_LABELS, briefBlocks, briefToolLine, linksIn, planOf, prsOpened, renderBrief, renderConv, stateWord, waitingOnQuestion, wrapOf } from '../lib/brief.mjs'
import { countTree, inRepo, makeBrief, sessionRows, treeOf } from '../exporter/brief.mjs'

const NOW = Date.parse('2026-10-26T12:00:00Z')
const at = (min) => new Date(NOW - min * 60000).toISOString()
let n = 0
const uuid = () => `u${++n}`
const user = (text, min) => ({ type: 'user', uuid: uuid(), timestamp: at(min), message: { role: 'user', content: text } })
const said = (text, min) => ({ type: 'assistant', uuid: uuid(), timestamp: at(min), message: { content: [{ type: 'text', text }] } })
const call = (id, name, input, min) => ({ type: 'assistant', uuid: uuid(), timestamp: at(min), message: { content: [{ type: 'tool_use', id, name, input }] } })
const result = (id, text, min, isError = false) => ({ type: 'user', uuid: uuid(), timestamp: at(min), message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] } })

const LINES = [
  user('Ajoute un bouton export sur le bandeau', 60),
  call('p1', 'mcp__ccd_turn__update_plan', { items: [{ content: 'Lire le code', status: 'in_progress' }, { content: 'Coder', status: 'pending' }, { content: 'PR', status: 'pending' }] }, 59),
  call('b1', 'Bash', { command: 'cd "C:/code/app" && npm test', description: 'Run tests' }, 58),
  result('b1', 'FAIL 2 tests\nlong output...', 58, true),
  call('p2', 'mcp__ccd_turn__update_plan', { advance: true }, 50),
  call('b2', 'Bash', { command: 'cd "C:/code/app" && gh pr create --fill' }, 40),
  result('b2', 'https://github.com/acme/app/pull/12', 40),
  call('a1', 'Agent', { description: 'coder lane', subagent_type: 'coder', model: 'opus' }, 35),
  result('a1', 'Merged https://github.com/acme/lib/pull/3 on green.', 30),
  said('PR #12 ouverte, CI en cours.', 29),
  call('w1', 'mcp__ccd_turn__wrap_up', { recap: 'Le bouton est codé, PR #12 attend la CI.', ask: 'Je merge ?' }, 28),
  call('q1', 'AskUserQuestion', { questions: [{ question: 'Quel libellé ?', options: [{ label: 'Export conv' }, { label: 'Brief' }] }] }, 27),
  result('q1', 'User has answered your questions: "Quel libellé ?"="Export conv". You can now continue.', 26),
]

test('briefBlocks: user text in full, tool lines with ok / error, AskUserQuestion with its answer, cd stripped', () => {
  const b = briefBlocks(LINES)
  assert.equal(b[0].role, 'user')
  assert.equal(b[0].items[0].s, 'Ajoute un bouton export sur le bandeau')
  const tools = b.flatMap((x) => x.items).filter((x) => x.kind === 'tool')
  const bash = tools.find((x) => x.s.includes('Run tests'))
  assert.equal(bash.status, 'error')
  assert.match(bash.err, /FAIL 2 tests/)
  assert.ok(!tools.some((x) => x.s.includes('long output')))
  assert.match(tools.find((x) => x.s.includes('gh pr create')).s, /^`Bash` gh pr create --fill$/)
  const ask = b.flatMap((x) => x.items).find((x) => x.kind === 'ask')
  assert.equal(ask.answer, 'Export conv')
  assert.equal(waitingOnQuestion(b), false)
  assert.equal(briefToolLine('mcp__ccd_turn__update_plan', {}), '`turn:update_plan`')
})

test('briefBlocks counts a repeated line once; a pending question means waiting', () => {
  const dup = [user('salut', 5), LINES[11], LINES[11]]
  const b = briefBlocks(dup)
  assert.equal(b[1].items.length, 1)
  assert.equal(waitingOnQuestion(b), true)
  assert.equal(stateWord({ mtime: NOW }, b, NOW), 'waiting')
  assert.equal(stateWord({ mtime: NOW - 10 * 60000 }, [], NOW), 'idle')
  assert.equal(stateWord({ mtime: NOW - 10000 }, [], NOW), 'working')
})

test('planOf applies advance; wrapOf keeps the last recap and ask; wrap_up checks off the step in progress', () => {
  const p = planOf(LINES.slice(0, 6))
  assert.deepEqual(p.map((x) => x.status), ['completed', 'in_progress', 'pending'])
  const done = planOf(LINES)
  assert.deepEqual(done.map((x) => x.status), ['completed', 'completed', 'pending'])
  assert.deepEqual(wrapOf(LINES).recap, 'Le bouton est codé, PR #12 attend la CI.')
  assert.equal(wrapOf(LINES).ask, 'Je merge ?')
})

test('prsOpened: links printed by gh pr create and reported by agents, not every link mentioned', () => {
  const extra = [said('voir https://github.com/other/x/pull/99', 1)]
  const prs = prsOpened([...LINES, ...extra])
  assert.deepEqual(prs.map((p) => `${p.repo}#${p.number}`), ['acme/app#12', 'acme/lib#3'])
  assert.deepEqual(linksIn('https://gitlab.com/grp/sub/proj/-/merge_requests/7')[0], { host: 'gitlab', server: 'gitlab.com', repo: 'grp/sub/proj', number: 7, url: 'https://gitlab.com/grp/sub/proj/-/merge_requests/7' })
})

const conv = (title, extra = {}) => ({
  session: { cli: `cli-${title}`, sid: `local_${title}`, title, cwd: 'C:/code/app', project: 'app', branch: 'feat', model: 'opus', effort: 'medium', created: NOW - 3600000, last_activity: NOW },
  blocks: briefBlocks(LINES), state: 'idle', plan: planOf(LINES), wrap: wrapOf(LINES), lastReply: 'PR #12 ouverte.',
  running: { workflows: [{ id: 'wf_1', name: 'package-wave', phases: ['Build', 'Verify'], phase: 'Verify', phaseIdx: 1, status: 'running', start: NOW - 20 * 60000, last: NOW, agents: [{ id: 'a', label: 'coder', status: 'done' }, { id: 'b', label: 'verify', status: 'running' }], hist: [30 * 60000, 40 * 60000, 50 * 60000] }], agents: [] },
  git: { ok: true, branch: 'feat', base: 'origin/main', ahead: 2, behind: 0, files: ['M a.ts'], moreFiles: 0, commits: ['abc123 2026-10-26 11:00 feat: x'] },
  prs: [{ host: 'github', repo: 'acme/app', number: 12, url: 'https://github.com/acme/app/pull/12', title: 'Export button', state: 'open', checks: { total: 3, ok: 2, bad: 0, run: 1 } }],
  children: [], ...extra,
})

test('renderConv: sections in order, ETA from the Workflow history, cap keeps the head and the newest messages', () => {
  const r = renderConv(conv('Lead'), BRIEF_LABELS, { now: NOW, maxChars: 60000 })
  const order = ['## Ce qu’est cette conversation', '## Où on en est / suite', '## ETA en direct', '## Git', '## GitHub / GitLab', '## Conversation']
  const idx = order.map((h) => r.md.indexOf(h))
  assert.ok(idx.every((i, k) => i > 0 && (k === 0 || i > idx[k - 1])), idx.join(','))
  assert.match(r.md, /- \[x\] Lire le code/)
  assert.match(r.md, /package-wave — phase 2\/2 Verify · agents : 1 fini\(s\), 1 en cours · lancé .* · fin ~\d\d:\d\d/)
  assert.match(r.md, /app#12 Export button — 2 ok · 0 en échec · 1 en cours/)
  assert.match(r.md, /2 commit\(s\) d’avance/)
  assert.match(r.md, /→ erreur : FAIL 2 tests/)
  assert.equal(r.cut, null)
  const many = conv('Big', { blocks: Array.from({ length: 200 }, (_, i) => ({ role: 'user', at: NOW, items: [{ kind: 'text', s: `message ${i} ` + 'x'.repeat(500) }] })) })
  const cut = renderConv(many, BRIEF_LABELS, { now: NOW, maxChars: 20000 })
  assert.ok(cut.md.length <= 21000, String(cut.md.length))
  assert.ok(cut.cut.messages > 100)
  assert.match(cut.md, /\[coupé : \d+ message\(s\) plus ancien\(s\) omis/)
  assert.match(cut.md, /message 199 /)
  assert.ok(!cut.md.includes('message 0 '))
  assert.match(cut.md, /## Où on en est/)
})

test('renderBrief: contents and numbered child sections (recursive)', () => {
  const root = conv('Lead', { children: [conv('Lane A', { children: [conv('Sub A1')] }), conv('Lane B')] })
  const r = renderBrief(root, { now: NOW })
  assert.equal(r.count, 4)
  assert.match(r.md, /et ses 3 sous-conversation\(s\)/)
  assert.match(r.md, /## Sommaire\n\n- 1 Lead — au repos\n  - 1\.1 Lane A — au repos\n    - 1\.1\.1 Sub A1/)
  assert.match(r.md, /# 1\.1\.1 Sub A1 _\(sous-conversation de 1\.1\)_/)
  assert.match(r.md, /# 1\.2 Lane B/)
})

// ---- exporter on a fixture app folder (no gh: forge off; clipboard off) ----
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-'))
  const app = path.join(dir, 'app', 'x', 'y')
  const projects = path.join(dir, 'projects')
  const cwd = path.join(dir, 'work')
  fs.mkdirSync(app, { recursive: true })
  fs.mkdirSync(cwd, { recursive: true })
  const write = (sid, cli, title, parent) => {
    fs.writeFileSync(path.join(app, `${sid}.json`), JSON.stringify({ sessionId: sid, cliSessionId: cli, title, cwd, createdAt: NOW - 3600000, lastActivityAt: NOW, model: 'opus', ...(parent ? { spawnedFrom: { sessionId: parent } } : {}) }))
    const pd = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'))
    fs.mkdirSync(pd, { recursive: true })
    const secret = 'gh' + 'p_' + 'Ab1'.repeat(12)
    fs.writeFileSync(path.join(pd, `${cli}.jsonl`), [user(`travail de ${title}, jeton ${secret}`, 30), said(`fait pour ${title}`, 20)].map((l) => JSON.stringify(l)).join('\n'))
  }
  write('local_root', 'c-root', 'Coordination', '')
  write('local_a', 'c-a', 'Lane A', 'local_root')
  write('local_b', 'c-b', 'Lane B', 'local_root')
  write('local_a1', 'c-a1', 'Sub A1', 'local_a')
  write('local_other', 'c-o', 'Other', '')
  const cfg = { app_dir: path.join(dir, 'app'), projects_dir: projects }
  const B = { dir: path.join(dir, 'briefs'), file: '{day}-{slug}.md', file_children: '{day}-{slug}-avec-enfants.md', max_chars_per_conv: 60000, max_depth: 5, live_s: 120, clipboard: 'off', git_commits: 10, git_files: 30, prs_max: 15, forge: false, timeout_s: 10, labels: BRIEF_LABELS }
  return { dir, cfg, B, cwd }
}

test('sessionRows caches by mtime; treeOf and countTree follow spawnedFrom', () => {
  const f = fixture()
  const cache = path.join(f.dir, 'cache.json')
  const rows = sessionRows(cache, f.cfg)
  assert.equal(rows.length, 5)
  assert.ok(fs.existsSync(cache))
  assert.equal(sessionRows(cache, f.cfg).length, 5)
  const t = treeOf(rows, { cli: 'c-root' }, 5)
  assert.equal(countTree(t), 3)
  assert.deepEqual(t.children.map((k) => k.row.title).sort(), ['Lane A', 'Lane B'])
  assert.equal(countTree(treeOf(rows, { cli: 'c-root' }, 1)), 2)
  assert.equal(treeOf(rows, { cli: 'nope' }), null)
  assert.equal(inRepo(f.cwd), false)
})

test('makeBrief with children: one masked file, every conversation, nothing copied when clipboard is off', async () => {
  const f = fixture()
  const res = await makeBrief({ session: 'c-root', children: true, config: { cfg: f.cfg, B: f.B }, now: NOW })
  assert.equal(res.ok, true, res.error)
  assert.equal(res.count, 4)
  assert.equal(res.copied, false)
  assert.ok(res.masked >= 4)
  assert.match(res.file, /2026-10-26-coordination-avec-enfants\.md$/)
  const md = fs.readFileSync(res.file, 'utf8')
  assert.ok(!md.includes('gh' + 'p_'))
  for (const t of ['# 1 Coordination', '# 1.1 Lane A', '# 1.1.1 Sub A1', '# 1.2 Lane B']) assert.ok(md.includes(t), t)
  assert.ok(!md.includes('Other'))
  assert.match(md, /pas un dépôt git/)
  const one = await makeBrief({ session: 'c-a1', config: { cfg: f.cfg, B: f.B }, now: NOW })
  assert.equal(one.count, 1)
  assert.match(one.file, /2026-10-26-sub-a1\.md$/)
  const miss = await makeBrief({ session: 'zzz', config: { cfg: f.cfg, B: f.B }, now: NOW })
  assert.equal(miss.ok, false)
  const terminal = await makeBrief({ session: 'zzz', cwd: f.cwd, config: { cfg: f.cfg, B: f.B }, now: NOW })
  assert.equal(terminal.ok, true)
})
