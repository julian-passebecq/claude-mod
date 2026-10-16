// veille « À archiver »: node --test mods/veille/tests/archive.test.mjs (also loaded by fil.test.mjs, which CI runs).
// Invented session files and transcripts only, no real data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { archiveCandidates, archiveIds, archiveText, buildArchive } from '../lib/archive.mjs'
import { archiveFromDisk, writeArchive } from '../watcher/archive.mjs'
import { archiveLines } from '../hooks/fil-view.mjs'
import { brief } from '../lib/core.mjs'
import { BIN_FILES } from '../watcher/veille.mjs'

const H = 3600000
const NOW = Date.parse('2026-10-16T12:00:00Z')
const CFG = JSON.parse(fs.readFileSync(new URL('../veille.config.json', import.meta.url), 'utf8'))
const done = { text: 'All merged.', text_current: true, wrap: null, ask_open: null, pending_tool: null }

const row = (o) => ({ sid: `local_${o.id}`, cli: `c-${o.id}`, title: o.title || o.id, cwd: o.cwd || 'C:/work/alpha', origin: o.cwd || 'C:/work/alpha',
  archived: false, pinned: false, exempt: false, last_activity: NOW - (o.h ?? 10) * H, activity: NOW - (o.h ?? 10) * H, mtime: NOW - (o.h ?? 10) * H,
  status_category: 'completed', needs_action: '', awaiting: false, prs: [], msg: done, ...o })

function fixtureRows() {
  return [
    row({ id: 'newest', title: 'Alpha newest', h: 0.5 }), // newest of alpha: kept so the project stays in the sidebar
    row({ id: 'merged', title: 'Alpha lane merged', h: 9, prs: [{ url: 'https://github.com/acme/alpha/pull/21', state: 'MERGED', prNumber: 21 }] }),
    row({ id: 'closed', title: 'Alpha lane closed', h: 30, prs: [{ url: 'https://github.com/acme/alpha/pull/22', state: 'CLOSED' }] }),
    row({ id: 'nopr', title: 'Alpha question answered', h: 50, status_category: '' }),
    row({ id: 'openpr', title: 'Alpha lane open PR', h: 12, prs: [{ url: 'https://github.com/acme/alpha/pull/23', state: 'MERGED' }, { url: 'https://github.com/acme/alpha/pull/24', state: 'OPEN' }] }),
    row({ id: 'pinned', title: 'Alpha pinned', h: 40, pinned: true }),
    row({ id: 'exempt', title: 'Alpha exempt', h: 40, exempt: true }),
    row({ id: 'role', title: 'VEILLE 1', h: 20 }),
    row({ id: 'role2', title: 'CLAUDE CONTROL AUDIT 2 (V4 proposal)', h: 20 }),
    row({ id: 'notrole', title: 'CODER V4 NAVCTX1 (N27)', h: 8 }), // upper case but no « name number »: a candidate
    row({ id: 'recent', title: 'Alpha recent', h: 2 }),
    row({ id: 'bg', title: 'Alpha background agents', h: 20, activity: NOW - 1 * H }), // sub-agent files written 1 h ago
    row({ id: 'ask', title: 'Alpha asks', h: 20, msg: { ...done, ask_open: { q: 'Keep the schema?', at: NOW - 20 * H } } }),
    row({ id: 'needs', title: 'Alpha needs', h: 20, needs_action: 'Approve in TE2' }),
    row({ id: 'question', title: 'Alpha closing question', h: 20, msg: { ...done, text: 'PR is green.\n\nShould I merge it?' } }),
    row({ id: 'blocked', title: 'Alpha blocked', h: 20, status_category: 'blocked' }),
    row({ id: 'old-archived', title: 'Alpha archived', h: 90, archived: true }),
    row({ id: 'beta', title: 'Beta only one', cwd: 'C:/work/beta', h: 100 }), // alone in its project: the newest, kept
    row({ id: 'beta-wt', title: 'Beta worktree lane', cwd: 'C:/work/beta/.claude/worktrees/x', h: 120 }), // same project as beta
  ]
}

test('candidates: finished, idle ≥ N h, PR merged/closed or none; reasons and the oldest first', () => {
  const r = archiveCandidates(fixtureRows(), CFG, NOW)
  assert.deepEqual(r.candidates.map((c) => c.title), ['Beta worktree lane', 'Alpha question answered', 'Alpha lane closed', 'Alpha lane merged', 'CODER V4 NAVCTX1 (N27)'])
  const by = Object.fromEntries(r.candidates.map((c) => [c.title, c]))
  assert.equal(by['Alpha lane merged'].reason, 'PR #21 mergée, terminée, inactive 9 h')
  assert.equal(by['Alpha lane closed'].reason, 'PR #22 fermée, terminée, inactive 30 h')
  assert.equal(by['Alpha question answered'].reason, 'pas de PR, tour fini, inactive 2 j')
  assert.equal(by['Beta worktree lane'].reason, 'pas de PR, terminée, inactive 5 j')
  assert.equal(by['Beta worktree lane'].project, 'beta')
  assert.equal(by['Alpha lane merged'].sid, 'local_merged')
  assert.equal(r.open, 18, 'archived sessions are not counted')
  assert.deepEqual(r.kept, { pinned: 2, role: 2, newest: 2, active: 2, julian: 3, status: 1, open_pr: 1, running: 0 })
})

test('never candidates: each keep rule alone', () => {
  const ids = (rows, cfg = CFG) => archiveCandidates(rows, cfg, NOW).candidates.map((c) => c.sid)
  const two = (o) => [row({ id: 'anchor', h: 1 }), row({ id: 'x', h: 10, ...o })] // anchor = newest, so x is judged alone
  assert.deepEqual(ids(two({})), ['local_x'])
  assert.deepEqual(ids(two({ pinned: true })), [])
  assert.deepEqual(ids(two({ title: 'MODS 1' })), [])
  assert.deepEqual(ids(two({ title: 'MODS 1' }), { ...CFG, archive: { ...CFG.archive, role_pattern: '^NOPE' } }), ['local_x'], 'pattern configurable')
  assert.deepEqual(ids(two({ h: 5 })), [], 'idle < 6 h')
  assert.deepEqual(ids(two({ h: 5 }), { archive: { idle_h: 4 } }), ['local_x'], 'idle_h configurable')
  assert.deepEqual(ids(two({ awaiting: true })), [])
  assert.deepEqual(ids(two({ msg: { ...done, wrap: { recap: 'r', ask: 'Go?', actions: [], blocked: false, at: 0, current: true } } })), [])
  assert.deepEqual(ids(two({ msg: { ...done, pending_tool: { name: 'Bash', at: NOW - 10 * H } } })), [], 'a tool call with no result')
  assert.deepEqual(ids(two({ prs: [{ url: 'https://gitlab.com/g/p/-/merge_requests/3', state: 'opened' }] })), [], 'an open MR')
  assert.deepEqual(ids([row({ id: 'only', h: 99 })]), [], 'the only conversation of a project')
  assert.deepEqual(ids([row({ id: 'only', h: 99 })], { archive: { keep_newest_per_project: false } }), ['local_only'])
  assert.deepEqual(ids(two({ title: 'bad', }), { archive: { role_pattern: '(' } }), ['local_x'], 'a broken pattern keeps nothing out, breaks nothing')
})

test('archive.json, the ids to copy, the text of /veille archiver, the pane lines, the wake brief', () => {
  const a = buildArchive(fixtureRows(), CFG, NOW)
  assert.equal(a.count, 5)
  assert.equal(a.idle_h, 6)
  assert.equal(archiveIds(a).split('\n').length, 5)
  const t = archiveText(a, NOW + 5 * 60000)
  assert.match(t[0], /^À archiver : 5 sur 18 conversation\(s\) ouvertes \(inactives ≥ 6 h\), calculé il y a 0 h/)
  assert.ok(t.some((l) => l.includes('Alpha lane merged · alpha · PR #21 mergée, terminée, inactive 9 h · local_merged')))
  assert.match(t[t.length - 1], /archive_session/)
  assert.match(archiveText(null)[0], /archive\.json absent/)
  assert.deepEqual(archiveText(buildArchive([], CFG, NOW), NOW).slice(1), ['Rien à archiver.'])
  assert.equal(archiveLines(a, CFG)[0], 'À archiver (5)')
  const b = brief({ key: 'k', kind: 'idle', what: 'x', title: 'Lane', cli: 'c', link: 'https://e/1', since: NOW - 60000 }, CFG, NOW, 'node veille.mjs ack', { archive: 5, file: 'C:/u/.claude/veille/archive.json' })
  assert.ok(b.split('\n').length <= 10)
  assert.match(b, /5 conversations à archiver, liste dans C:\/u\/\.claude\/veille\/archive\.json/)
  assert.match(b, /ack k$/m, 'the ack line is kept')
  assert.doesNotMatch(brief({ key: 'k', what: 'x' }, CFG, NOW, 'ack'), /archiver/)
})

// Lays out session files and transcripts as the desktop app and Claude Code do.
function layout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veille-archive-'))
  const app = path.join(root, 'app', 'acct', 'org')
  const projects = path.join(root, 'projects')
  fs.mkdirSync(app, { recursive: true })
  const add = (id, o, lines = [], bgAgo = null) => {
    const cwd = o.cwd || 'C:/work/alpha'
    fs.writeFileSync(path.join(app, `local_${id}.json`), JSON.stringify({ sessionId: `local_${id}`, cliSessionId: `c-${id}`, cwd, originCwd: cwd, title: o.title || id,
      isArchived: !!o.isArchived, isStarred: !!o.isStarred, lastActivityAt: NOW - o.h * H, postTurnSummary: { status_category: 'completed' }, prs: o.prs || [] }))
    const dir = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'))
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, `c-${id}.jsonl`)
    fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    fs.utimesSync(f, (NOW - o.h * H) / 1000, (NOW - o.h * H) / 1000)
    if (bgAgo !== null) {
      const sub = path.join(dir, `c-${id}`, 'subagents')
      fs.mkdirSync(sub, { recursive: true })
      fs.writeFileSync(path.join(sub, 'agent-1.jsonl'), '{}\n')
      fs.utimesSync(path.join(sub, 'agent-1.jsonl'), (NOW - bgAgo * H) / 1000, (NOW - bgAgo * H) / 1000)
    }
  }
  const said = (t) => [{ type: 'user', timestamp: new Date(NOW - 11 * H).toISOString(), message: { role: 'user', content: 'go' } },
    { type: 'assistant', timestamp: new Date(NOW - 10 * H).toISOString(), message: { id: 'a', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: t }] } }]
  add('lead', { h: 1, title: 'Alpha lead' }, said('Working.'))
  add('done', { h: 10, title: 'Alpha done', prs: [{ url: 'https://github.com/acme/alpha/pull/7', state: 'MERGED', prNumber: 7 }] }, said('PR #7 merged. Nothing left.'))
  add('asks', { h: 10, title: 'Alpha asks' }, said('Ready.\n\nShould I merge #8?'))
  add('bg', { h: 10, title: 'Alpha background' }, said('Workflow started.'), 0.5)
  add('pin', { h: 10, title: 'Alpha pinned', isStarred: true }, said('Done.'))
  add('arch', { h: 100, title: 'Alpha archived', isArchived: true }, said('Done.'))
  return { root, app: path.join(root, 'app'), projects }
}

test('from disk: every open session whatever its age, transcripts and sub-agent files read, archive.json written', () => {
  const d = layout()
  try {
    const a = archiveFromDisk(CFG, { app: d.app, projects: d.projects, nowMs: NOW })
    assert.deepEqual(a.candidates.map((c) => c.title), ['Alpha done'])
    assert.equal(a.candidates[0].reason, 'PR #7 mergée, terminée, inactive 10 h')
    assert.equal(a.open, 5)
    assert.equal(a.kept.julian, 1, 'the closing question in the transcript')
    assert.equal(a.kept.active, 1, 'sub-agent files written 30 min ago')
    const file = path.join(d.root, 'veille', 'archive.json')
    writeArchive(CFG, file, { app: d.app, projects: d.projects, nowMs: NOW })
    const back = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(back.count, 1)
    assert.equal(typeof back.duration_ms, 'number')
    const cache = JSON.parse(fs.readFileSync(path.join(d.root, 'veille', 'archive_cache.json'), 'utf8'))
    assert.deepEqual(Object.keys(cache).map((k) => path.basename(k)), ['local_arch.json'], 'archived files are cached by mtime')
    // unarchived later (the file changes): read again, then a candidate
    const f = Object.keys(cache)[0]
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    fs.writeFileSync(f, JSON.stringify({ ...j, isArchived: false, cwd: 'C:/work/gamma', originCwd: 'C:/work/gamma' }))
    fs.utimesSync(f, NOW / 1000, (NOW - 1000) / 1000)
    const again = writeArchive(CFG, file, { app: d.app, projects: d.projects, nowMs: NOW })
    assert.equal(again.open, 6)
  } finally { fs.rmSync(d.root, { recursive: true, force: true }) }
})

test('the installed copy carries the archive files', () => {
  for (const f of ['veille/lib/archive.mjs', 'veille/watcher/archive.mjs']) assert.ok(BIN_FILES.includes(f), f)
})
