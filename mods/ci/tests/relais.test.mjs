// Claude <-> Codex dataset: node --test mods/ci/tests/relais.test.mjs. All repos, PRs, people and commands are invented.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { branchAgent, ciVerdict, commitAgent, dependencies, handoffs, mergesFromCommands, openerAgent, parseRemote, prRow, repoNameFromCwd, summaryText, totals } from '../scanner/relais_core.mjs'
import { collect, mergeCommands } from '../scanner/relais.mjs'

const C = (body, authors = ['Some Dev']) => ({ headline: 'x', body, authors })
const CLAUDE = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
const CODEX = 'Co-authored-by: Codex <codex@example.test>'

test('attribution: branch, trailer, body, author; anything else is unknown', () => {
  assert.equal(branchAgent('claude/fix-a'), 'claude')
  assert.equal(branchAgent('worktree-agent-12'), 'claude')
  assert.equal(branchAgent('codex/feat'), 'codex')
  assert.equal(branchAgent('feature/x'), null)
  assert.equal(commitAgent(C(CLAUDE)), 'claude')
  assert.equal(commitAgent(C(CODEX)), 'codex')
  assert.equal(commitAgent(C('', ['chatgpt-codex-connector[bot]'])), 'codex')
  assert.equal(commitAgent(C('plain')), 'unknown')
  assert.equal(openerAgent({ branch: 'x', body: '🤖 Generated with [Claude Code](https://claude.com/claude-code)' }), 'claude')
  assert.equal(openerAgent({ branch: 'x', body: '', author: 'someone', commits: [C(CODEX)] }), 'codex')
  assert.equal(openerAgent({ branch: 'x', body: '', author: 'someone' }), 'unknown')
})

test('CI verdicts from GitHub rollups and GitLab statuses', () => {
  assert.equal(ciVerdict([{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }]), 'success')
  assert.equal(ciVerdict([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }]), 'failed')
  assert.equal(ciVerdict([{ status: 'IN_PROGRESS', conclusion: '' }]), 'pending')
  assert.equal(ciVerdict([]), 'none')
  assert.equal(ciVerdict('success'), 'success')
  assert.equal(ciVerdict('failed'), 'failed')
  assert.equal(ciVerdict('running'), 'pending')
})

test('dependencies and hand-offs', () => {
  const all = [{ number: 1, branch: 'claude/base' }, { number: 2, branch: 'codex/top', base: 'claude/base', body: 'Depends on #7, after #1' }]
  assert.deepEqual(dependencies(all[1], all), [1, 7])
  assert.deepEqual(handoffs(['claude', 'claude', 'unknown', 'codex', 'claude']), ['claude→codex', 'codex→claude'])
})

test('a PR opened by Codex, fixed by Claude, merged by Claude: two agents, one hand-off', () => {
  const pr = { number: 5, branch: 'codex/feat', base: 'main', state: 'merged', commits: [C(CODEX), C(CLAUDE), C(CLAUDE)], checks: [{ conclusion: 'SUCCESS' }] }
  const row = prRow(pr, undefined, [pr], 'claude')
  assert.equal(row.opened_by, 'codex')
  assert.deepEqual(row.fixed_by, ['claude'])
  assert.equal(row.merged_by, 'claude')
  assert.deepEqual(row.handoffs, ['codex→claude'])
  assert.deepEqual(row.commits_by, { codex: 1, claude: 2 })
  const t = totals([row], [{ who: 'claude', status: 'success' }, { who: 'claude', status: 'failed' }, { who: 'codex', status: 'success' }])
  assert.equal(t.by_agent.codex.opened, 1)
  assert.equal(t.by_agent.codex.pr_ci.rate, 100)
  assert.equal(t.by_agent.claude.fixed, 1)
  assert.equal(t.by_agent.claude.runs.rate, 50)
  assert.equal(t.handoffs, 1)
  // an unmarked commit on codex/* counts for Codex (the branch is the mark); on feature/* it stays unknown
  assert.deepEqual(prRow({ ...pr, commits: [C('plain')] }).commits_by, { codex: 1 })
  assert.deepEqual(prRow({ ...pr, branch: 'feature/x', commits: [C('plain')] }).commits_by, { unknown: 1 })
})

test('merges come from gh/glab merge commands in transcripts, worktrees resolved to their repo', () => {
  assert.equal(repoNameFromCwd('D:/code/app-one/.claude/worktrees/lane-a'), 'app-one')
  assert.equal(repoNameFromCwd('C:\\code\\app-two'), 'app-two')
  const m = mergesFromCommands([
    { agent: 'claude', cwd: 'D:/code/app-one/.claude/worktrees/x', command: 'gh pr merge 12 --squash --delete-branch' },
    { agent: 'codex', cwd: 'D:/elsewhere', command: 'gh pr merge --squash 3 -R acme/app-two' },
    { agent: 'claude', cwd: 'D:/code/app-three', command: 'glab mr merge 8 --auto-merge --squash' },
    { agent: 'claude', cwd: 'D:/code/app-one', command: 'gh pr view 12' },
    { agent: 'claude', cwd: 'C:/scratch/x', command: 'cd D:\\code\\app-four; gh pr merge 139 --squash --delete-branch 2>&1 | Select -Last 2' },
    { agent: 'claude', cwd: 'C:/scratch/x', command: 'gh pr merge $n --squash 2>&1' },
    { agent: 'codex', cwd: 'C:/scratch/x', command: 'gh pr merge https://github.com/acme/app-five/pull/21 --squash' },
  ])
  assert.equal(m.get('app-one#12'), 'claude')
  assert.equal(m.get('app-two#3'), 'codex')
  assert.equal(m.get('app-three#8'), 'claude')
  assert.equal(m.get('app-four#139'), 'claude')
  assert.equal(m.get('app-five#21'), 'codex')
  assert.equal(m.size, 5, [...m.keys()].join(' '))
})

test('remotes: GitHub and the configured GitLab hosts only', () => {
  assert.deepEqual(parseRemote('https://github.com/acme/app-one.git'), { kind: 'github', host: 'github.com', path: 'acme/app-one' })
  assert.deepEqual(parseRemote('https://gitlab.com/group/sub/app.git'), { kind: 'gitlab', host: 'gitlab.com', path: 'group/sub/app' })
  assert.equal(parseRemote('https://example.test/x/y.git'), null)
})

test('collect: gh and glab (read verbs only), transcripts and the pipelines cache make one dataset', async () => {
  const calls = []
  const run = async (cmd, args) => {
    calls.push([cmd, ...args])
    if (cmd === 'git') {
      const repo = args[1]
      if (repo.endsWith('app-one')) return { code: 0, stdout: 'origin\thttps://github.com/acme/app-one.git (fetch)\n', stderr: '' }
      if (repo.endsWith('app-two')) return { code: 0, stdout: 'origin\thttps://gitlab.com/grp/app-two.git (fetch)\n', stderr: '' }
      return { code: 0, stdout: 'origin\thttps://github.com/acme/private-x.git (fetch)\n', stderr: '' }
    }
    if (cmd === 'gh') {
      if (args.includes('acme/private-x')) return { code: 1, stdout: '', stderr: 'HTTP 404: Not Found' }
      return {
        code: 0, stderr: '', stdout: JSON.stringify([
          { number: 2, title: 'feat', headRefName: 'codex/feat', baseRefName: 'main', state: 'MERGED', createdAt: '2026-01-10T10:00:00Z', mergedAt: '2026-01-10T12:00:00Z',
            author: { login: 'dev' }, mergedBy: { login: 'dev' }, url: 'https://github.com/acme/app-one/pull/2', body: '',
            commits: [{ messageHeadline: 'a', messageBody: CODEX, authors: [{ name: 'dev' }] }, { messageHeadline: 'fix', messageBody: CLAUDE, authors: [{ name: 'dev' }] }],
            statusCheckRollup: [{ conclusion: 'SUCCESS' }] },
          { number: 1, title: 'old', headRefName: 'claude/old', baseRefName: 'main', state: 'CLOSED', createdAt: '2025-06-01T00:00:00Z', commits: [], statusCheckRollup: [] },
        ]),
      }
    }
    if (cmd === 'glab') {
      const path = args[args.length - 1]
      if (/merge_requests\?/.test(path)) return { code: 0, stderr: '', stdout: JSON.stringify([{ iid: 4, title: 'mr', source_branch: 'claude/mr', target_branch: 'main', state: 'opened', created_at: '2026-01-12T00:00:00Z', web_url: 'https://gitlab.com/grp/app-two/-/merge_requests/4', author: { username: 'dev' }, description: 'Depends on !3' }]) }
      if (/commits/.test(path)) return { code: 0, stderr: '', stdout: JSON.stringify([{ title: 'b', message: CODEX, author_name: 'dev' }, { title: 'a', message: CLAUDE, author_name: 'dev' }]) }
      if (/pipelines/.test(path)) return { code: 0, stderr: '', stdout: JSON.stringify([{ status: 'failed' }]) }
    }
    return { code: 1, stdout: '', stderr: 'unexpected' }
  }
  const data = await collect({ relais: { days: 30 } }, {
    now: Date.parse('2026-01-15T00:00:00Z'),
    run,
    clones: ['D:/code/app-one', 'D:/code/app-two', 'D:/code/private-x'],
    commands: [{ agent: 'claude', cwd: 'D:/code/app-one/.claude/worktrees/w', command: 'gh pr merge 2 --squash' }],
    runs: new Map([['app-one', [{ who: 'claude', status: 'success' }, { who: 'codex', status: 'failed' }]]]),
  })
  // read-only: gh pr list, glab api without a method flag, git remote
  for (const c of calls) {
    if (c[0] === 'gh') assert.deepEqual(c.slice(1, 3), ['pr', 'list'])
    if (c[0] === 'glab') { assert.equal(c[1], 'api'); assert.ok(!c.includes('-X') && !c.includes('--method')) }
    if (c[0] === 'git') assert.deepEqual(c.slice(3), ['remote', '-v'])
  }
  assert.equal(data.repos.length, 2)
  assert.deepEqual(data.errors.map(e => e.repo), ['private-x'])
  const one = data.repos.find(r => r.name === 'app-one')
  assert.equal(one.prs.length, 1, 'the PR older than 30 days is left out')
  assert.deepEqual([one.prs[0].opened_by, one.prs[0].fixed_by, one.prs[0].merged_by], ['codex', ['claude'], 'claude'])
  const two = data.repos.find(r => r.name === 'app-two')
  assert.equal(two.prs[0].opened_by, 'claude')
  assert.deepEqual(two.prs[0].fixed_by, ['codex'])
  assert.deepEqual(two.prs[0].depends_on, [3])
  assert.equal(two.prs[0].ci, 'failed')
  assert.equal(data.totals.handoffs, 2)
  assert.equal(data.totals.by_agent.claude.runs.rate, 100)
  assert.equal(data.totals.by_agent.codex.runs.rate, 0)
  assert.match(summaryText(data), /Claude ↔ Codex · 2 repo\(s\) · 2 PR\/MR sur 30 j/)
  assert.match(summaryText(data), /relais : 2 \(codex→claude 1, claude→codex 1\) dans 2 PR/)
  assert.match(summaryText(data), /1 repo\(s\) non lus/)
})

test('merge commands are read from Claude and Codex transcript lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'relais-'))
  mkdirSync(join(dir, 'p'))
  const claude = join(dir, 'p', 'a.jsonl')
  writeFileSync(claude, [
    JSON.stringify({ type: 'user', cwd: 'D:/code/app-one', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', cwd: 'D:/code/app-one', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'gh pr merge 9 --squash --delete-branch' } }] } }),
  ].join('\n'))
  const codex = join(dir, 'p', 'b.jsonl')
  writeFileSync(codex, [
    JSON.stringify({ type: 'session_meta', payload: { cwd: 'C:/work/app-two' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'gh pr merge 4 --squash'] }) } }),
  ].join('\n'))
  const cmds = await mergeCommands([{ agent: 'claude', path: claude }, { agent: 'codex', path: codex }])
  const m = mergesFromCommands(cmds)
  assert.equal(m.get('app-one#9'), 'claude')
  assert.equal(m.get('app-two#4'), 'codex')
})
