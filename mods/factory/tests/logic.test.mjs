// node --test mods/factory/tests/logic.test.mjs  (needs python on PATH for the scanner tests)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  costOf, rateFor, warnings, architectReason, dashboard, conversation, pickSession, deepMerge, scanArgs, short, repoOf,
} from '../hooks/logic.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CFG = JSON.parse(readFileSync(join(HERE, '..', 'factory.config.json'), 'utf8'))
const SCAN = join(HERE, '..', 'scanner', 'factory_scan.py')

test('pricing: exact id, family fallback, default; cache writes split 5m / 1h', () => {
  // 1M in + 1M out + 1M read + 1M 5m write + 1M 1h write on Opus 5.5 = 4 + 20 + 0.4 + 5 + 8
  assert.equal(costOf('claude-opus-5-5', [1e6, 1e6, 1e6, 1e6, 1e6, 3], CFG).toFixed(2), '37.40')
  assert.equal(rateFor('claude-sonnet-9-9', CFG).in, CFG.rates.sonnet.in)
  assert.equal(rateFor('gpt-x', CFG), CFG.rates.default)
  assert.equal(short('claude-opus-5-5'), 'opus 5.5')
})

test('config override deep-merges and keeps the other keys', () => {
  const c = deepMerge(CFG, { thresholds: { handoff_tokens: 100 }, colors: { opus: 'red' } })
  assert.equal(c.thresholds.handoff_tokens, 100)
  assert.equal(c.thresholds.live_s, CFG.thresholds.live_s)
  assert.equal(c.colors.opus, 'red')
  assert.equal(c.colors.sonnet, CFG.colors.sonnet)
})

test('warnings: no explicit model, Opus read-only, context without RESUME.md, loop tools', () => {
  const s = {
    model: 'claude-opus-5-5', ctx: 300000, resume_md: false, tools: 10, readonly: 1, loops: { Monitor: 2 },
    subs: [
      { type: 'coder', model: 'claude-opus-5-5', explicit_model: null, tools: 3, readonly: 0, desc: 'pkg A' },
      { type: 'Explore', model: 'claude-opus-5-5', explicit_model: 'opus', tools: 2, readonly: 2, desc: 'find X' },
      { type: 'workflow-subagent', workflow: 'wf_1', model: 'claude-haiku-5-5', tools: 9, readonly: 9, loops: { CronCreate: 1 } },
    ],
  }
  const w = warnings(s, CFG).map((x) => x.text).join('\n')
  assert.match(w, /1 subagent\(s\) without explicit model/)
  assert.match(w, /Opus doing read-only search in 1 subagent/)
  assert.match(w, /context 300K > 250K and no handoff\/RESUME.md/)
  assert.match(w, /Monitor x2; CronCreate x1/)
  assert.equal(warnings({ ...s, ctx: 300000, resume_md: true, loops: {}, subs: [] }, CFG).length, 0)
})

test('architect calls are marked before plan / error repeats / before done', () => {
  assert.equal(architectReason('Review the v2.2 plan before the wave', CFG), 'before plan')
  assert.equal(architectReason('The same fix failed twice on CI', CFG), 'error repeats')
  assert.equal(architectReason('Final review before it is declared done', CFG), 'before done')
})

const NOW = Date.parse('2026-10-09T12:00:00Z')
const today = (() => { const d = new Date(NOW); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
const vec = (calls, out = 1000) => [10, out, 100000, 1000, 0, calls]

test('dashboard: cost today, running subagents, waiting on Julian, routing shares vs targets', () => {
  const scan = { sessions: [
    { cli: 'aaa', app_title: 'Lane A', origin: 'C:\\code\\app-one', cwd: 'C:\\code\\app-one\\.claude\\worktrees\\x', model: 'claude-opus-5-5',
      app_effort: 'medium', ctx: 200000, days: { [today]: { 'claude-opus-5-5': vec(8) }, '2000-01-01': { 'claude-opus-5-5': vec(99) } },
      subs: [{ status: 'running', model: 'claude-haiku-5-5', explicit_model: 'haiku', days: { [today]: { 'claude-haiku-5-5': vec(2) } } }],
      pr: { number: 7, url: 'u' }, ci: { state: 'opened', ci: 'running' }, ask_open: true, live: true, last_activity: 2 },
    { cli: 'bbb', title: 'Lane B', cwd: 'C:\\code\\app-two', model: 'claude-sonnet-5-5', ctx: 10, days: { [today]: { 'claude-sonnet-5-5': vec(10) } },
      subs: [], last_activity: 1 },
  ] }
  const g = dashboard(scan, CFG, NOW)
  assert.equal(g.rows.length, 2)
  const a = g.rows[0]
  assert.equal(a.title, 'Lane A')
  assert.equal(a.repo, 'app-one')
  assert.equal(a.running, 1)
  assert.equal(a.waiting, true)
  assert.equal(a.pr.ci, 'running')
  assert.equal(a.ctxPct, 50)
  assert.ok(Math.abs(a.costToday - (costOf('claude-opus-5-5', vec(8), CFG) + costOf('claude-haiku-5-5', vec(2), CFG))) < 1e-9)
  assert.equal(g.totalCalls, 20)
  const share = Object.fromEntries(g.share.map((s) => [s.family, s]))
  assert.equal(share.opus.share, 0.4)
  assert.equal(share.opus.ok, true)
  assert.equal(share.haiku.share, 0.1)
  assert.equal(share.haiku.ok, false) // target >= 15 %
  assert.ok(g.byProject['app-one'].cost > 0 && g.byProject['app-two'].cost > 0)
})

test('conversation: tree, workflows grouped, architect mark, per-turn cost includes subagents started in the turn', () => {
  const d = {
    cli: 'c1', app_title: 'T', model: 'claude-opus-5-5', ctx: 1000, models: { 'claude-opus-5-5': vec(3) },
    turns: [{ ts: '2026-10-09T10:00:00Z', kind: 'human', text: 'go', models: { 'claude-opus-5-5': vec(2) } },
      { ts: '2026-10-09T11:00:00Z', kind: 'notif', text: 'done', models: { 'claude-opus-5-5': vec(1) } }],
    calls: [{ tool: 'Workflow', runId: 'wf_9', desc: 'wave-1' }],
    subs: [
      { id: 'a1', type: 'architect', model: 'claude-opus-5-5', explicit_model: 'opus', status: 'done', desc: 'Review plan v3', ts: '2026-10-09T10:05:00Z', models: { 'claude-opus-5-5': vec(1) } },
      { id: 'w1', type: 'workflow-subagent', workflow: 'wf_9', model: 'claude-haiku-5-5', explicit_model: 'haiku', status: 'running', ts: '2026-10-09T11:05:00Z', models: { 'claude-haiku-5-5': vec(1) } },
    ],
    events: [['2026-10-09T10:00:00Z', 'prompt', 'go']],
    errors: [['2026-10-09T10:01:00Z', 'tool', 'Permission denied by cc-control guard'], ['2026-10-09T10:02:00Z', 'tool', 'file not found']],
    guards: [['2026-10-09T10:03:00Z', 'deny', 'sends_max']],
  }
  const c = conversation(d, CFG, NOW)
  assert.equal(c.agents.length, 1)
  assert.equal(c.agents[0].architect, 'before plan')
  assert.equal(c.workflows.length, 1)
  assert.equal(c.workflows[0].name, 'wave-1')
  assert.equal(c.workflows[0].running, 1)
  assert.equal(c.turns[0].agents, 1)
  assert.ok(Math.abs(c.turns[0].cost - (costOf('claude-opus-5-5', vec(2), CFG) + costOf('claude-opus-5-5', vec(1), CFG))) < 1e-9)
  assert.equal(c.guards.length, 2) // the guard-like tool error and the cc-control row, not "file not found"
  assert.ok(Math.abs(c.total - (costOf('claude-opus-5-5', vec(3), CFG) * 1 + costOf('claude-opus-5-5', vec(1), CFG) + costOf('claude-haiku-5-5', vec(1), CFG))) < 1e-9)
})

test('pickSession by id prefix, app id or title fragment; scanArgs from config', () => {
  const ss = [{ cli: 'd902ca1f-1', sid: 'local_d8f1e15f', app_title: 'App One V2.1 recovery' }, { cli: 'x', title: 'Wind Lane' }]
  assert.equal(pickSession(ss, 'd902').cli, 'd902ca1f-1')
  assert.equal(pickSession(ss, 'd8f1e').cli, 'd902ca1f-1')
  assert.equal(pickSession(ss, 'wind lane').cli, 'x')
  assert.equal(pickSession(ss, 'nothing'), null)
  const a = scanArgs({ ...CFG, include_cli: true }, { script: 's.py', cache: 'c.json', detail: 'id1' })
  assert.deepEqual(a.slice(0, 3), ['s.py', '--cache', 'c.json'])
  assert.ok(a.includes('--cli') && a.includes('id1'))
  assert.equal(repoOf({ cwd: 'C:/x/y' }), 'y')
})

// ---- scanner on a fixture ----------------------------------------------------------------------------------------

function line(o) { return JSON.stringify(o) + '\n' }
function asst(id, ts, out, extra = {}, content = []) {
  return line({ type: 'assistant', timestamp: ts, cwd: 'C:\\code\\demo', gitBranch: 'claude/x', perTurnEffort: 'medium', ...extra,
    message: { id, model: 'claude-opus-5-5', stop_reason: 'end_turn', content,
      usage: { input_tokens: 5, output_tokens: out, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200,
        cache_creation: { ephemeral_1h_input_tokens: 200, ephemeral_5m_input_tokens: 0 } } } })
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'factory-'))
  const projects = join(root, 'projects'), app = join(root, 'app', 'acct', 'org'), boardDir = join(root, 'board')
  mkdirSync(join(projects, 'C--code-demo', 'cli-1', 'subagents'), { recursive: true })
  mkdirSync(app, { recursive: true }); mkdirSync(boardDir)
  writeFileSync(join(app, 'local_s1.json'), JSON.stringify({ sessionId: 'local_s1', cliSessionId: 'cli-1', cwd: 'C:\\code\\demo', title: 'Demo lane',
    model: 'claude-opus-5-5', effort: 'medium', lastActivityAt: Date.now(), postTurnSummary: { needs_action: '' } }))
  const main = join(projects, 'C--code-demo', 'cli-1.jsonl')
  writeFileSync(main,
    line({ type: 'user', timestamp: '2026-10-09T10:00:00Z', origin: { kind: 'human' }, message: { content: 'build it' } })
    + asst('m1', '2026-10-09T10:00:01Z', 10, {}, [{ type: 'text', text: 'ok' }])
    + asst('m1', '2026-10-09T10:00:02Z', 40, {}, [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { subagent_type: 'coder', description: 'pkg', prompt: 'do pkg', run_in_background: true } }])
    + line({ type: 'user', timestamp: '2026-10-09T10:00:03Z', toolUseResult: { status: 'async_launched', agentId: 'ag1' }, message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'launched' }] } })
    + asst('m2', '2026-10-09T10:00:04Z', 7, {}, [{ type: 'tool_use', id: 'tu2', name: 'Monitor', input: {} }])
    + line({ type: 'pr-link', prNumber: 3, prUrl: 'https://example.invalid/pr/3', prRepository: 'o/r', timestamp: '2026-10-09T10:00:05Z' }))
  const sub = join(projects, 'C--code-demo', 'cli-1', 'subagents', 'agent-ag1.jsonl')
  writeFileSync(sub, line({ type: 'user', isSidechain: true, timestamp: '2026-10-09T10:00:03Z', message: { content: 'do pkg' } })
    + asst('s1', '2026-10-09T10:00:05Z', 100, { isSidechain: true }, [{ type: 'tool_use', id: 'x', name: 'Grep', input: {} }]))
  writeFileSync(sub.replace('.jsonl', '.meta.json'), JSON.stringify({ agentType: 'coder', description: 'pkg', toolUseId: 'tu1', requestShape: 'background' }))
  return { root, projects, app: join(root, 'app'), boardDir, main, sub }
}

function runScan(f, extra = []) {
  const out = execFileSync('python', ['-I', SCAN, '--cache', join(f.boardDir, 'cache.json'), '--projects', f.projects, '--app', f.app,
    '--board', f.boardDir, '--ci-ttl', '0', '--live-s', '0', '--detail', 'cli-1', ...extra], { encoding: 'utf8' })
  return JSON.parse(out)
}

test('scanner: joins app file, de-duplicates streamed blocks by message.id, links subagent, reads tails incrementally', () => {
  const f = fixture()
  let d = runScan(f).detail
  assert.equal(d.app_title, 'Demo lane')
  assert.equal(d.app_effort, 'medium')
  const v = d.models['claude-opus-5-5']
  assert.deepEqual(v, [10, 47, 2000, 0, 400, 2]) // m1 counted once with its larger usage (40), plus m2 (7)
  assert.equal(d.subs.length, 1)
  assert.equal(d.subs[0].type, 'coder')
  assert.equal(d.subs[0].explicit_model, null)
  assert.equal(d.subs[0].status, 'done') // stop_reason end_turn, not live
  assert.equal(d.subs[0].readonly, 1)
  assert.equal(d.loops.Monitor, 1)
  assert.equal(d.pr.number, 3)
  assert.equal(d.turns.length, 1)
  // incremental: a notification and a new turn appended; the cache keeps the earlier totals
  appendFileSync(f.main, line({ type: 'user', timestamp: '2026-10-09T10:05:00Z', origin: { kind: 'task-notification' },
    message: { content: '<task-notification><tool-use-id>tu1</tool-use-id><status>failed</status><summary>Agent "pkg" failed</summary></task-notification>' } })
    + asst('m3', '2026-10-09T10:05:01Z', 3))
  d = runScan(f).detail
  assert.deepEqual(d.models['claude-opus-5-5'], [15, 50, 3000, 0, 600, 3])
  assert.equal(d.subs[0].status, 'failed')
  assert.equal(d.turns.length, 2)
  assert.equal(d.turns[1].kind, 'notif')
  const cache = JSON.parse(readFileSync(join(f.boardDir, 'cache.json'), 'utf8'))
  assert.ok(cache.files[f.main].off > 0)
})

test('architects are exempt from the Opus read-only warning; a release review is "before done"', () => {
  const s = { model: 'claude-opus-5-5', subs: [{ type: 'architect', model: 'claude-opus-5-5', explicit_model: 'opus', tools: 9, readonly: 9 }] }
  assert.equal(warnings(s, CFG).length, 0)
  assert.equal(architectReason('Architect review of 2.1.0', CFG), 'before done')
})

test('session log collapses repeated rows and names MCP tools; short() drops a date suffix', async () => {
  const { compactEvents } = await import('../hooks/logic.mjs')
  const ev = compactEvents([['t1', 'tool', 'mcp__ccd_session_mgmt__archive_session'], ['t2', 'tool', 'mcp__ccd_session_mgmt__archive_session'], ['t3', 'prompt', '<b>&']])
  assert.deepEqual(ev.map((e) => e[2]), ['archive_session (session_mgmt) ×2', '<b>&'])
  assert.equal(short('claude-haiku-4-5-20251001'), 'haiku 4.5')
})

// ---- "Ça t'attend" strip -----------------------------------------------------------------------------------------

test('waiting: green PR left open, question pending, needs action, idle lane on red / skipped / conflict PR', async () => {
  const { waitingRows } = await import('../hooks/waiting.mjs')
  const min = 60000
  const scan = {
    reviews: { errors: [], items: [
      { provider: 'github', repo: 'o/app-one', number: 5, url: 'https://github.com/o/app-one/pull/5', ci: 'success', conflict: false, green_since: (NOW - 45 * min) / 1000 },
      { provider: 'github', repo: 'o/app-one', number: 6, url: 'https://github.com/o/app-one/pull/6', ci: 'success', conflict: false, green_since: (NOW - 5 * min) / 1000 },
      { provider: 'gitlab', repo: 'g/app-two', number: 9, url: 'https://gitlab.com/g/app-two/-/merge_requests/9', ci: 'skipped', conflict: false },
      { provider: 'github', repo: 'o/app-three', number: 2, url: 'https://github.com/o/app-three/pull/2', ci: 'success', conflict: true, green_since: (NOW - 90 * min) / 1000 },
    ] },
    sessions: [
      { cli: 'c1', sid: 'local_1', app_title: 'Lane one', live: false, last_activity: (NOW - 60 * min) / 1000, pr: { url: 'https://github.com/o/app-one/pull/5', number: 5 } },
      { cli: 'c2', sid: 'local_2', app_title: 'Lane two', live: false, last_activity: (NOW - 30 * min) / 1000,
        app_prs: [{ url: 'https://gitlab.com/g/app-two/-/merge_requests/9', number: 9 }], ask_open: true, ask_ts: new Date(NOW - 10 * min).toISOString(), ask_q: 'Which repo?' },
      { cli: 'c3', sid: 'local_3', app_title: 'Lane three', live: false, last_activity: (NOW - 25 * min) / 1000,
        app_prs: [{ url: 'https://github.com/o/app-three/pull/2/', number: 2 }], needs_action: 'Log in to Cloudflare', status_category: 'blocked' },
      { cli: 'c4', sid: 'local_4', app_title: 'Lane four', live: true, last_activity: NOW / 1000, pr: { url: 'https://github.com/o/x/pull/1', number: 1, repo: 'o/x' },
        ci: { state: 'open', ci: 'failed' }, ask_open: true, ask_ts: new Date(NOW - 1 * min).toISOString() },
      { cli: 'c5', sid: 'local_5', app_title: 'Old archived', archived: true, needs_action: 'x', last_activity: (NOW - 600 * min) / 1000 },
      { cli: 'c6', sid: 'local_6', app_title: 'Lane six', live: false, last_activity: (NOW - 40 * min) / 1000, pr: { url: 'https://github.com/o/y/pull/4', number: 4, repo: 'o/y' },
        ci: { state: 'open', ci: 'failed' } },
    ],
  }
  const { rows } = waitingRows(scan, CFG, NOW)
  const by = (k) => rows.filter((r) => r.kind === k)
  assert.equal(by('green').length, 1) // #6 green only 5 min, #2 conflicting
  assert.match(by('green')[0].what, /app-one#5 verte depuis 45 min/)
  assert.equal(by('green')[0].session.title, 'Lane one')
  assert.equal(by('ask').length, 1) // c4 asked 1 min ago: under ask_min
  assert.match(by('ask')[0].what, /Which repo\?/)
  assert.equal(by('ask')[0].link, 'claude://claude.ai/epitaxy/local_2')
  assert.equal(by('needs').length, 1) // the archived one is skipped
  assert.equal(by('needs')[0].level, 'bad')
  const idle = by('idle').map((r) => r.what)
  assert.equal(idle.length, 3) // skipped pipeline (A4), conflict, and a red PR known only from the session's CI lookup; c4 is live
  assert.ok(idle.some((t) => /app-two!9 est sans pipeline \(skipped\)/.test(t)))
  assert.ok(idle.some((t) => /app-three#2 est en conflit/.test(t)))
  assert.ok(idle.some((t) => /y#4 est rouge/.test(t)))
  assert.ok(rows.every((r, i) => !i || rows[i - 1].since <= r.since)) // oldest first
  const off = waitingRows(scan, deepMerge(CFG, { waiting: { idle_pr_states: ['failed'], green_min: 1 } }), NOW).rows
  assert.equal(off.filter((r) => r.kind === 'idle').length, 1)
  assert.equal(off.filter((r) => r.kind === 'green').length, 2)
})

test('waiting: sub-conversations grouped under their lead with a state each', async () => {
  const { childGroups, waitingConfig } = await import('../hooks/waiting.mjs')
  const w = waitingConfig(CFG)
  const g = childGroups([
    { cli: 'L', sid: 'local_L', app_title: 'Lead', last_activity: 1 },
    { cli: 'a', sid: 'local_a', app_title: 'Child A', parent: 'local_L', live: true, last_activity: 5 },
    { cli: 'b', sid: 'local_b', app_title: 'Child B', parent: 'local_L', needs_action: 'answer', last_activity: 4 },
    { cli: 'c', sid: 'local_c', app_title: 'Child C', parent: 'local_L', status_category: 'completed', last_activity: 3 },
    { cli: 'd', sid: 'local_d', app_title: 'Gone', parent: 'local_L', archived: true },
    { cli: 'e', sid: 'local_e', app_title: 'Orphan', parent: 'local_X', parent_title: 'Old lead' },
  ], w, NOW)
  assert.equal(g.length, 2)
  assert.equal(g[0].title, 'Lead')
  assert.equal(g[0].cli, 'L')
  assert.deepEqual(g[0].children.map((c) => c.label), ['travaille', 'attend Julian', 'terminée'])
  assert.equal(g[1].title, 'Old lead')
})

test('waiting: one notification per row ever, nothing for rows present on the first run, lease shared by sessions', async () => {
  const { toAnnounce, holdsLease, waitingArgs } = await import('../hooks/waiting.mjs')
  const r1 = { key: 'green:a', kind: 'green', what: 'A' }
  const r2 = { key: 'ask:b', kind: 'ask', what: 'B' }
  const first = toAnnounce([r1], null, CFG, NOW)
  assert.equal(first.announce.length, 0)
  const second = toAnnounce([r1, r2], first.seen, CFG, NOW + 1)
  assert.deepEqual(second.announce.map((r) => r.key), ['ask:b'])
  assert.equal(toAnnounce([r1, r2], second.seen, CFG, NOW + 2).announce.length, 0)
  const many = Array.from({ length: 5 }, (_, i) => ({ key: 'idle:' + i, kind: 'idle', what: 'x' }))
  const capped = toAnnounce(many, {}, CFG, NOW)
  assert.equal(capped.announce.length, 3)
  assert.equal(capped.more, 2)
  assert.equal(toAnnounce(many, {}, deepMerge(CFG, { waiting: { notify: false } }), NOW).announce.length, 0)
  assert.equal(toAnnounce([r2], { 'ask:b': NOW - 30 * 86400000 }, CFG, NOW).announce.length, 1) // pruned after notify_keep_days
  assert.equal(holdsLease(null, 's1', NOW, 1000), true)
  assert.equal(holdsLease({ sid: 's2', at: NOW - 1000 }, 's1', NOW, 1000), false)
  assert.equal(holdsLease({ sid: 's2', at: NOW - 5000 }, 's1', NOW, 1000), true)
  assert.ok(waitingArgs(CFG).includes('--waiting'))
  assert.deepEqual(waitingArgs(deepMerge(CFG, { waiting: { enabled: false } })), [])
})

test('scanner: CI states from gh check rollups and GitLab pipelines (skipped counts as stuck)', () => {
  const code = [
    'import sys, json', "sys.argv = ['x']", `sys.path.insert(0, ${JSON.stringify(dirname(SCAN))})`, 'import factory_scan as f',
    "S = lambda c: {'conclusion': c, 'completedAt': '2026-10-09T10:00:00Z'}",
    "print(json.dumps([f.gh_ci([]), f.gh_ci([S('SUCCESS'), S('SKIPPED')]), f.gh_ci([S('SKIPPED')]), f.gh_ci([S('FAILURE'), S('SUCCESS')]),",
    "  f.gh_ci([{'status': 'IN_PROGRESS'}]), f.gl_ci(None), f.gl_ci({'status': 'skipped'}), f.gl_ci({'status': 'success', 'finished_at': '2026-10-09T10:00:00Z'}),",
    "  f.gl_ci({'status': 'pending'})]))",
  ].join('\n')
  const r = JSON.parse(execFileSync('python', ['-I', '-c', code], { encoding: 'utf8' }))
  const t = Date.parse('2026-10-09T10:00:00Z') / 1000
  assert.deepEqual(r, [['none', null], ['success', t], ['skipped', null], ['failed', null], ['running', null], ['none', null], ['skipped', null], ['success', t], ['running', null]])
})

test('scanner: app session fields for the strip (lead link, open PRs, pending question)', () => {
  const f = fixture()
  const appFile = join(f.app, 'acct', 'org', 'local_s1.json')
  const j = JSON.parse(readFileSync(appFile, 'utf8'))
  writeFileSync(appFile, JSON.stringify({ ...j, spawnedFrom: { sessionId: 'local_lead', title: 'Lead' }, postTurnSummary: { status_category: 'blocked', needs_action: 'Log in' },
    prs: [{ prNumber: 3, url: 'https://example.invalid/pr/3', state: 'OPEN', provider: 'github', repo: 'o/r' }, { prNumber: 2, url: 'https://example.invalid/pr/2', state: 'MERGED' }] }))
  appendFileSync(f.main, asst('m9', '2026-10-09T10:06:00Z', 2, {}, [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ question: 'Which repo?' }] } }]))
  const d = runScan(f).detail
  assert.equal(d.parent, 'local_lead')
  assert.equal(d.parent_title, 'Lead')
  assert.equal(d.status_category, 'blocked')
  assert.deepEqual(d.app_prs.map((p) => p.number), [3])
  assert.equal(d.ask_open, true)
  assert.equal(d.ask_q, 'Which repo?')
  assert.equal(d.ask_ts, '2026-10-09T10:06:00Z')
})
