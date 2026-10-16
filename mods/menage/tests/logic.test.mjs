// menage mod: classification, commands and a full scan of throwaway git repos made at test time.
//   node --test mods/menage/tests/logic.test.mjs
// Made-up names and paths only; every repo and folder lives in a temp folder removed at the end.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import {
  archivable, branchRow, command, commandsOf, expand, filterRows, fmtAge, fmtBytes, mergeState, norm, parseStatus, parseWorktrees,
  pluginDirs, prFor, prIndex, short, slugOf, splitOld, totals, worktreeRow,
} from '../lib/classify.mjs'
import { config, dirSize, findRepos, readSessions, scan } from '../scanner/menage_scan.mjs'

const tmp = norm(mkdtempSync(join(tmpdir(), 'menage-test-')))
after(() => rmSync(tmp, { recursive: true, force: true }))
const shipped = JSON.parse(readFileSync(new URL('../menage.config.json', import.meta.url), 'utf8'))

test('parseWorktrees reads the porcelain list', () => {
  const ws = parseWorktrees('worktree C:/r\nHEAD aaa\nbranch refs/heads/main\n\nworktree C:/r/.claude/worktrees/x\nHEAD bbb\ndetached\nlocked\n\nworktree C:/gone\nHEAD ccc\nbranch refs/heads/feat/y\nprunable gitdir file points to non-existent location\n')
  assert.equal(ws.length, 3)
  assert.equal(ws[0].branch, 'main')
  assert.deepEqual([ws[1].detached, ws[1].locked, ws[1].branch], [true, true, ''])
  assert.deepEqual([ws[2].prunable, ws[2].branch], [true, 'feat/y'])
})

test('status, slug, sizes and ages', () => {
  assert.deepEqual(parseStatus(' M a\n?? b\n?? c\n'), { changed: 1, untracked: 2 })
  assert.equal(slugOf('https://github.com/Owner/Repo.git'), 'owner/repo')
  assert.equal(slugOf('git@example.com:group/sub/proj.git'), 'sub/proj')
  assert.equal(fmtBytes(1536), '1,5 Ko')
  assert.equal(fmtBytes(3 * 1024 ** 3), '3,0 Go')
  assert.equal(fmtAge(0, 5), '—')
  assert.equal(fmtAge(1000, 1000 + 3 * 86400000), '3 j')
  assert.equal(short('C:/code/app/.claude/worktrees/x', ['c:/code']), 'app/.claude/worktrees/x')
  assert.equal(expand('~/x/%TEMP%/y', { HOME: 'C:/Users/me', TEMP: 'T:/tmp' }), 'C:/Users/me/x/T:/tmp/y')
})

test('merge state: ancestor, squash, merged PR, gone only as a hint', () => {
  assert.equal(mergeState({ ancestor: true }).how, 'ancestor')
  assert.equal(mergeState({ ancestor: true, empty: true }).how, 'empty')
  assert.equal(mergeState({ squash: true }).merged, true)
  assert.match(mergeState({ pr: { state: 'MERGED', number: 7 } }).label, /PR #7 mergée/)
  const g = mergeState({ gone: true })
  assert.deepEqual([g.merged, g.how], [false, 'gone'])
  assert.equal(mergeState({ pr: { state: 'OPEN' } }).merged, false)
})

test('worktree rows: clean and merged gets git worktree remove without --force; dirty or unmerged is red', () => {
  const merged = { merged: true, how: 'ancestor', label: 'mergée' }
  const ok = worktreeRow({ path: 'C:/r/.claude/worktrees/a', status: { changed: 0, untracked: 0 }, merge: merged, size: { bytes: 100 } }, 'C:/r')
  assert.equal(ok.level, 'safe')
  assert.equal(ok.command, 'git -C "C:/r" worktree remove "C:/r/.claude/worktrees/a"')
  assert.doesNotMatch(ok.command, /--force|-f\b/)
  assert.equal(ok.reclaim, 100)
  const dirty = worktreeRow({ path: 'C:/r/w', status: { changed: 2, untracked: 1 }, merge: merged }, 'C:/r')
  assert.deepEqual([dirty.level, dirty.command, dirty.reclaim], ['danger', '', 0])
  assert.match(dirty.reasons[0], /2 fichiers modifiés, 1 non suivis/)
  const open = worktreeRow({ path: 'C:/r/w', status: { changed: 0, untracked: 0 }, merge: { merged: false, label: 'non mergée' } }, 'C:/r')
  assert.equal(open.level, 'danger')
  const gone = worktreeRow({ path: 'C:/r/w', prunable: true }, 'C:/r')
  assert.equal(gone.command, 'git -C "C:/r" worktree prune')
})

test('branch rows: -d for merged, -D only for squash (à vérifier), push --delete for remote', () => {
  assert.equal(branchRow({ name: 'feat/a', merge: { how: 'ancestor', label: 'mergée' } }, 'C:/r').command, 'git -C "C:/r" branch -d feat/a')
  const sq = branchRow({ name: 'feat/b', merge: { how: 'squash', label: 'squash' } }, 'C:/r')
  assert.deepEqual([sq.level, sq.command], ['check', 'git -C "C:/r" branch -D feat/b'])
  assert.equal(branchRow({ name: 'feat/c', remote: true, merge: { how: 'ancestor', label: 'm' } }, 'C:/r').command, 'git -C "C:/r" push origin --delete feat/c')
  assert.equal(command('folder_delete', { path: 'C:\\x y\\z' }), 'rm -rf "C:/x y/z"')
  assert.equal(command('branch_delete', { repo: 'C:/r', branch: 'b' }, { branch_delete: 'git -C {repo} branch --delete {branch}' }), 'git -C "C:/r" branch --delete b')
})

test('sessions: archivable only when idle, not archived and every PR merged or closed', () => {
  const now = Date.parse('2026-10-16T12:00:00Z')
  const old = now - 48 * 3600000
  assert.equal(archivable({ lastActivityAt: old, prs: [{ state: 'MERGED' }] }, now), true)
  assert.equal(archivable({ lastActivityAt: old, prs: [{ state: 'MERGED' }, { state: 'OPEN' }] }, now), false)
  assert.equal(archivable({ lastActivityAt: old, prs: [{ state: 'CLOSED' }] }, now), false)
  assert.equal(archivable({ lastActivityAt: now - 3600000, prs: [{ state: 'MERGED' }] }, now), false)
  assert.equal(archivable({ archived: true, lastActivityAt: old, prs: [{ state: 'MERGED' }] }, now), false)
  assert.equal(archivable({ lastActivityAt: old, prs: [] }, now), false)
  const idx = prIndex([{ prs: [{ branch: 'feat/x', repo: 'Owner/App', state: 'OPEN', number: 1 }] }, { prs: [{ branch: 'feat/x', repo: 'owner/app', state: 'MERGED', number: 2 }] }])
  assert.equal(prFor(idx, 'owner/app', 'feat/x').number, 2)
})

test('mods loaded, old backups, totals, filters', () => {
  const env = { HOME: 'C:/Users/me' }
  assert.deepEqual(pluginDirs('~/.claude/mods/a;D:\\m\\b', env), ['c:/users/me/.claude/mods/a', 'd:/m/b'])
  assert.deepEqual(pluginDirs('/h/m/a:/h/m/b', env), ['/h/m/a', '/h/m/b'])
  const { kept, old } = splitOld([{ time: 1 }, { time: 3 }, { time: 2 }], 2)
  assert.deepEqual([kept.map(x => x.time), old.map(x => x.time)], [[3, 2], [1]])
  const sections = [{ rows: [{ level: 'safe', reclaim: 10, command: 'a' }, { level: 'check', reclaim: 5, command: 'b' }, { level: 'danger' }, { level: 'info' }] }]
  assert.deepEqual(totals(sections), { sure: 10, check: 5, rows: 4, danger: 1, commands: 2 })
  assert.deepEqual(commandsOf(sections), ['a'])
  assert.equal(filterRows(sections[0].rows, 'safe').length, 2)
  assert.equal(filterRows(sections[0].rows, 'danger').length, 1)
})

// ---------- a full scan on throwaway repos ----------

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } })
const write = (p, s) => {
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, s)
}

function fixture() {
  const roots = `${tmp}/code`
  const repo = `${roots}/app-one`
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  write(`${repo}/a.txt`, 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
  // merged by fast-forward
  git(repo, 'switch', '-qc', 'feat/merged')
  write(`${repo}/b.txt`, 'b\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'b')
  git(repo, 'switch', '-q', 'main')
  git(repo, 'merge', '-q', '--ff-only', 'feat/merged')
  // merged by squash
  git(repo, 'switch', '-qc', 'feat/squashed')
  write(`${repo}/c.txt`, 'c\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'c1')
  write(`${repo}/c.txt`, 'c2\n')
  git(repo, 'commit', '-qam', 'c2')
  git(repo, 'switch', '-q', 'main')
  git(repo, 'merge', '-q', '--squash', 'feat/squashed')
  git(repo, 'commit', '-qm', 'squash c (#3)')
  // not merged
  git(repo, 'branch', 'feat/open')
  git(repo, 'switch', '-q', 'feat/open')
  write(`${repo}/d.txt`, 'd\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'd')
  git(repo, 'switch', '-q', 'main')
  // worktrees: clean merged, dirty merged, unmerged
  git(repo, 'worktree', 'add', '-q', `${repo}/.claude/worktrees/clean`, '-b', 'wt/clean')
  git(repo, 'worktree', 'add', '-q', `${repo}/.claude/worktrees/dirty`, '-b', 'wt/dirty')
  write(`${repo}/.claude/worktrees/dirty/new.txt`, 'x\n')
  git(repo, 'worktree', 'add', '-q', `${repo}/.claude/worktrees/open`, 'feat/open')
  // a worktree folder git does not list
  write(`${repo}/.claude/worktrees/orphan/file.txt`, 'left over\n')
  // home: mods, backups, transcripts, temp, sessions
  const home = `${tmp}/home`
  write(`${home}/.claude/mods/loaded/x.txt`, 'x')
  write(`${home}/.claude/mods/old-copy/x.txt`, 'xx')
  write(`${home}/.claude/settings.json`, JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/loaded' } }))
  for (const n of ['b1', 'b2', 'b3']) write(`${home}/.claude/effort-board/_deploy_backups/${n}/f.txt`, n)
  utimesSync(`${home}/.claude/effort-board/_deploy_backups/b1`, new Date('2026-09-01'), new Date('2026-09-01'))
  utimesSync(`${home}/.claude/effort-board/_deploy_backups/b2`, new Date('2026-09-02'), new Date('2026-09-02'))
  utimesSync(`${home}/.claude/effort-board/_deploy_backups/b3`, new Date('2026-09-03'), new Date('2026-09-03'))
  write(`${home}/.claude/projects/p-one/s.jsonl`, `${JSON.stringify({ type: 'user', cwd: repo })}\n`)
  write(`${home}/.claude/projects/p-gone/s.jsonl`, `${JSON.stringify({ type: 'user', cwd: `${tmp}/nowhere` })}\n`)
  write(`${home}/temp/claude/old-session/scratch.txt`, 'old')
  utimesSync(`${home}/temp/claude/old-session/scratch.txt`, new Date('2026-09-01'), new Date('2026-09-01'))
  write(`${home}/temp/claude/new-session/scratch.txt`, 'new')
  const now = Date.now()
  write(`${home}/app/sessions/acc/org/local_1.json`, JSON.stringify({ sessionId: 'local_1', title: 'Done lane', isArchived: false, lastActivityAt: now - 72 * 3600000, prs: [{ prNumber: 3, repo: 'owner/app-one', branch: 'feat/squashed', state: 'MERGED' }] }))
  write(`${home}/app/sessions/acc/org/local_2.json`, JSON.stringify({ sessionId: 'local_2', title: 'Busy lane', isArchived: false, lastActivityAt: now - 72 * 3600000, prs: [{ prNumber: 4, state: 'OPEN' }] }))
  return { roots, repo, home, now }
}

test('scan: worktrees, orphans, merged branches, mods, backups, transcripts, temp and sessions', async () => {
  const f = fixture()
  const env = { HOME: f.home, TEMP: `${f.home}/temp`, APPDATA: `${f.home}/app` }
  const ctx = config(`${tmp}/data`, env)
  ctx.cfg.repos.roots = [f.roots]
  ctx.cfg.sizes = { method: 'node' }
  ctx.cfg.temp.dirs = [{ path: '%TEMP%/claude', depth: 1, days: 2 }]
  ctx.cfg.sessions.dir = '%APPDATA%/sessions'
  const m = await scan(ctx, f.now)
  const sec = id => m.sections.find(s => s.id === id).rows
  assert.equal(m.repos, 1)

  const wt = sec('worktrees')
  const by = name => wt.find(r => r.title.endsWith(`/${name}`))
  assert.equal(by('clean').level, 'safe')
  assert.equal(by('clean').command, `git -C "${f.repo}" worktree remove "${f.repo}/.claude/worktrees/clean"`)
  assert.equal(by('dirty').level, 'danger')
  assert.equal(by('dirty').command, '')
  assert.equal(by('open').level, 'danger')
  assert.match(by('open').reasons.join(' '), /non mergée/)

  const orphan = sec('orphans')
  assert.equal(orphan.length, 1)
  assert.equal(orphan[0].level, 'check')
  assert.equal(orphan[0].command, `rm -rf "${f.repo}/.claude/worktrees/orphan"`)

  const br = sec('branches')
  const b = name => br.find(r => r.title.endsWith(` · ${name}`))
  assert.equal(b('feat/merged').command, `git -C "${f.repo}" branch -d feat/merged`)
  assert.equal(b('feat/squashed').level, 'check')
  assert.match(b('feat/squashed').command, /branch -D feat\/squashed$/)
  assert.equal(b('feat/open'), undefined, 'an unmerged branch is never proposed')
  assert.equal(b('main'), undefined)
  assert.equal(b('wt/clean'), undefined, 'a branch checked out in a worktree is never proposed')

  const mods = sec('mods')
  assert.equal(mods.find(r => r.title.endsWith('loaded')).level, 'info')
  assert.equal(mods.find(r => r.title.endsWith('old-copy')).level, 'check')

  const bk = sec('backups')
  assert.equal(bk.length, 0, 'keep 5 by default')
  ctx.cfg.backups.keep = 1
  const m2 = await scan(ctx, f.now)
  const bk2 = m2.sections.find(s => s.id === 'backups').rows
  assert.deepEqual(bk2.map(r => r.title.split('/').pop()).sort(), ['b1', 'b2'])
  assert.ok(bk2.every(r => r.level === 'safe' && /^rm -rf "/.test(r.command)))

  const tr = sec('transcripts')
  assert.equal(tr.find(r => r.title.includes('nowhere')).level, 'check')
  assert.equal(tr.find(r => r.title.includes('nowhere')).command, '', 'transcripts are never given a delete command')

  const tp = sec('temp')
  assert.equal(tp.find(r => r.title === 'old-session').level, 'safe')
  assert.equal(tp.find(r => r.title === 'new-session').level, 'info')

  const ss = sec('sessions')
  assert.deepEqual(ss.map(r => r.title), ['Done lane'])

  assert.ok(m.totals.sure > 0)
  assert.ok(m.totals.danger >= 2)
  // nothing was removed: every folder the scan saw is still there
  assert.ok(findRepos([f.roots]).length === 1 && dirSize(`${f.repo}/.claude/worktrees/orphan`).files === 1)
  assert.equal(readSessions(`${f.home}/app/sessions`).length, 2)
})

test('shipped config: French labels, roots left as a placeholder, no --force anywhere', () => {
  assert.deepEqual(shipped.repos.roots, ['<PROJECTS_ROOT>'])
  assert.equal(shipped.labels.danger_tag, 'ne pas supprimer')
  for (const c of Object.entries(shipped.commands).filter(([k]) => !k.startsWith('_'))) assert.doesNotMatch(c[1], /--force/)
})
