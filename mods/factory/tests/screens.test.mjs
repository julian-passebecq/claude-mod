// node --test mods/factory/tests/screens.test.mjs  (factory v2 screens; needs python on PATH for the fixture scan)
// Fixture transcripts only (temp folder), never real data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deepMerge, localDay } from '../hooks/logic.mjs'
import {
  layout, tabsOf, parseArgs, chunk, bar, effortBars, sessionState, mission, timeline, focus, tree, trimNodes, stageOf, pipeline,
  quotas, system, journal, screensConfig,
} from '../hooks/screens.mjs'
import { drawPane } from '../hooks/draw.mjs'
import { el, renderText, widest } from '../scanner/textrender.mjs'
import { quotas as quotasExtra, runner as runnerExtra } from '../scanner/extras.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CFG = JSON.parse(readFileSync(join(HERE, '..', 'factory.config.json'), 'utf8'))
const SCAN = join(HERE, '..', 'scanner', 'factory_scan.py')
const NOW = Date.parse('2026-10-09T12:00:00Z')
const today = localDay(NOW)
const vec = (calls) => [100, 200, 1000, 0, 0, calls]
const min = 60000

// ---- layout and tabs -------------------------------------------------------------------------------------------------

test('layout: counters 2 per row when narrow, 3 at side-panel width, 6 when wide; bars follow the width', () => {
  assert.equal(layout(50, CFG).counterCols, 2)
  assert.equal(layout(75, CFG).counterCols, 3)
  assert.equal(layout(130, CFG).counterCols, 6)
  assert.equal(layout(130, CFG).cardCols, 2)
  assert.equal(layout(75, CFG).cardCols, 1)
  assert.ok(layout(120, CFG).bar > layout(60, CFG).bar)
  assert.equal(layout(0, CFG).cols, 80) // no width from the engine: 80 columns
  assert.equal(layout(75, deepMerge(CFG, { screens: { layout: { narrow: 80 } } })).counterCols, 2) // thresholds from config
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.equal(bar(50, 10), '█████░░░░░')
  assert.equal(effortBars('high'), '▮▮▮▯')
  assert.equal(effortBars(undefined), '····')
})

test('tabs: order and enabled from config, French labels; /factory args pick a tab or a conversation', () => {
  assert.deepEqual(tabsOf(CFG).map((t) => t.label), ['Mission', 'Focus', 'Arbre', 'Pipeline', 'Quotas', 'Système', 'Journal'])
  const c2 = deepMerge(CFG, { screens: { order: ['journal', 'mission', 'nope'], enabled: ['mission', 'journal'] } })
  assert.deepEqual(tabsOf(c2).map((t) => t.id), ['journal', 'mission'])
  assert.deepEqual(parseArgs('quotas', CFG), { tab: 'quotas', rest: '' })
  assert.deepEqual(parseArgs('système', CFG), { tab: 'systeme', rest: '' })
  assert.deepEqual(parseArgs('arbre My lane', CFG), { tab: 'arbre', rest: 'My lane' })
  assert.deepEqual(parseArgs('My lane', CFG), { tab: null, rest: 'My lane' })
  assert.deepEqual(parseArgs('quotas', c2), { tab: null, rest: 'quotas' }) // a disabled tab is not a tab
})

// ---- counters and joins on a hand-made scan --------------------------------------------------------------------------

function S(o) {
  return { models: {}, days: { [today]: { 'claude-opus-5-5': vec(2) } }, subs: [], loops: {}, tools: 10, readonly: 2, ctx: 100000,
    model: 'claude-opus-5-5', app_effort: 'medium', last_activity: (NOW - 5 * min) / 1000, recent: [], ...o }
}

const scanA = () => ({ sessions: [
  S({ cli: 'lead', sid: 'local_lead', app_title: 'Lead lane', cwd: 'C:/code/app-one', live: true,
    subs: [{ id: 'x', type: 'coder', status: 'running', model: 'claude-opus-5-5', days: {} }],
    recent: [['2026-10-09T11:50:00Z', 'compact', 'context compacted (auto)'], ['2026-10-09T11:55:00Z', 'tool', 'Skill handoff']] }),
  S({ cli: 'kid', sid: 'local_kid', app_title: 'Child lane', cwd: 'C:/code/app-one/.claude/worktrees/k', parent: 'local_lead',
    needs_action: 'Log in to the provider', model: 'claude-sonnet-5-5', app_effort: 'low' }),
  S({ cli: 'red', sid: 'local_red', app_title: 'Red lane', cwd: 'C:/code/app-two', pr: { number: 4, url: 'u4' }, ci: { state: 'open', ci: 'failed' },
    ctx: 300000, last_activity: (NOW - 50 * min) / 1000 }),
  S({ cli: 'done', sid: 'local_done', app_title: 'Done lane', cwd: 'C:/code/app-two', status_category: 'completed', merged_prs: 2,
    pr: { number: 3, url: 'u3' }, ci: { state: 'merged', ci: 'success' } }),
  S({ cli: 'calm', sid: 'local_calm', app_title: 'Calm lane', cwd: 'C:/code/app-three', last_activity: (NOW - 90 * min) / 1000, tools: 0, readonly: 0 }),
  S({ cli: 'gone', sid: 'local_gone', app_title: 'Archived', cwd: 'C:/code/app-three', archived: true }),
] })

test('mission: counters (working, idle, blocked with reason, waiting on Julian, done today, cost) and one card per project', () => {
  const m = mission(scanA(), CFG, NOW)
  const c = m.counters
  assert.deepEqual([c.working, c.idle, c.blocked, c.julian, c.done], [1, 1, 1, 1, 1])
  assert.match(c.blockedReasons[0], /Red lane : PR #4 CI failed/)
  assert.ok(c.cost > 0)
  const one = m.projects.find((p) => p.repo === 'app-one')
  assert.equal(one.lead.title, 'Lead lane')
  assert.equal(one.subconvs.length, 1)
  assert.equal(one.subconvs[0].state, 'julian')
  assert.equal(one.workers, 1)
  assert.equal(m.projects[0].repo, 'app-one') // live project first
  assert.equal(m.projects.find((p) => p.repo === 'app-three').sessions, 1) // archived left out
  assert.equal(sessionState({ archived: true }, CFG).state, 'archived')
})

test('focus: timeline has compaction, hand-off, context warning, blocked, merged, quiet, waiting; progress per project', () => {
  const tl = timeline(scanA(), CFG, NOW)
  const kinds = new Set(tl.map((t) => t.kind))
  for (const k of ['compact', 'handoff', 'context', 'blocked', 'merged', 'quiet', 'julian']) assert.ok(kinds.has(k), k)
  assert.ok(tl.every((t, i) => !i || tl[i - 1].ts >= t.ts)) // newest first
  assert.match(tl.find((t) => t.kind === 'context').text, /300K > 250K/)
  const f = focus(scanA(), CFG, NOW)
  assert.equal(f.pulse.running, 1)
  const two = f.progress.find((p) => p.repo === 'app-two')
  assert.deepEqual([two.done, two.total, two.merged], [1, 2, 2])
  const noQuiet = timeline(scanA(), deepMerge(CFG, { screens: { quiet_min: 120 } }), NOW)
  assert.ok(!noQuiet.some((t) => t.kind === 'quiet'))
})

test('pipeline: stage from PR / CI, running agent types, or read-only work', () => {
  assert.equal(stageOf({ pr: { number: 1 }, ci: { state: 'open', ci: 'success' } }, CFG), 'merge')
  assert.equal(stageOf({ pr: { number: 1 }, ci: { state: 'open', ci: 'running' } }, CFG), 'test')
  assert.equal(stageOf({ pr: { number: 1 }, ci: { state: 'merged' } }, CFG), null)
  assert.equal(stageOf({ subs: [{ type: 'architect', status: 'running' }, { type: 'coder', status: 'running' }], tools: 5 }, CFG), 'build')
  assert.equal(stageOf({ subs: [{ type: 'code-review', status: 'running' }], tools: 5 }, CFG), 'review')
  assert.equal(stageOf({ tools: 10, readonly: 10 }, CFG), 'plan')
  assert.equal(stageOf({ tools: 10, readonly: 2 }, CFG), 'build')
  const p = pipeline(scanA(), CFG, NOW)
  assert.equal(p.totals.test, 1) // the red lane
  assert.equal(p.totals.build, 2) // lead (running coder) and the child
  assert.equal(p.totals.plan, 1) // calm lane did nothing yet
  assert.ok(!p.rows.some((r) => Object.values(r.stages).flat().some((x) => x.cli === 'done')))
})

test('quotas: usage mod figures first, live % as fallback, "non chargé" when the usage mod is absent', async () => {
  const live = [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-12T10:00:00Z' }]
  const q1 = quotas(scanA(), CFG, NOW, live, { available: false, reason: 'module non chargé' })
  assert.equal(q1.usage, 'missing')
  assert.equal(q1.windows[1].pct, 40)
  assert.equal(q1.windows[0].available, false)
  const q2 = quotas(scanA(), CFG, NOW, live, { available: true, seven_day: { pct: 41, reset: NOW + 1, forecast: 'épuisé lun' }, five_hour: { pct: 8, reset: NOW + 2, forecast: '' } })
  assert.deepEqual(q2.windows.map((w) => w.pct), [8, 41])
  assert.ok(q2.byModel.length && q2.byProject.length)
  // scanner/extras.mjs: lib/core/usage.mjs over the usage mod's data folder (invented fixture), no usage mod import
  const empty = quotasExtra({ now: NOW, home: mkdtempSync(join(tmpdir(), 'home-')) })
  assert.equal(empty.available, true)
  assert.equal(empty.five_hour, null)
  assert.match(empty.note, /samples\.jsonl absent/)
  const dir = mkdtempSync(join(tmpdir(), 'usage-mod-'))
  const H = 3600000
  const reset5 = NOW + 2 * H
  writeFileSync(join(dir, 'samples.jsonl'), [
    { ts: NOW - 2 * H, five_hour: { pct: 20, reset: reset5 }, seven_day: { pct: 30, reset: NOW + 72 * H } },
    { ts: NOW - H, five_hour: { pct: 60, reset: reset5 }, seven_day: { pct: 31, reset: NOW + 72 * H } },
  ].map((x) => JSON.stringify(x)).join('\n'))
  writeFileSync(join(dir, 'codex.json'), JSON.stringify({ available: true, limits: { ts: NOW, primary: { pct: 12, windowMin: 300, reset: NOW + H }, secondary: { pct: 44, windowMin: 10080, reset: NOW + 50 * H } } }))
  const full = quotasExtra({ now: NOW }, dir)
  assert.equal(full.five_hour.pct, 60)
  assert.match(full.five_hour.forecast, /épuisé .* au rythme actuel/) // 40 %/h from 60 % -> 100 % one hour later, before the reset
  assert.equal(full.seven_day.pct, 31)
  assert.deepEqual(full.codex.windows.map((w) => [w.label, w.pct]), [['5 h', 12], ['Semaine', 44]])
  const q3 = quotas(scanA(), CFG, NOW, [], full)
  assert.deepEqual(q3.windows.map((w) => w.pct), [60, 31])
})

test('extras runner: lib/core/runner.mjs load from the ci cache in the Système shape', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'ci-')), 'cache.json')
  writeFileSync(f, JSON.stringify({ generated: new Date(NOW - 60000).toISOString(), summary: { queue: { backend: 'gitlab-local', label: 'runner local', running: 3, pending: 1, concurrent: 18, runners_online: 1 } } }))
  const r = runnerExtra({ now: NOW }, f)
  assert.deepEqual([r.backends[0].jobs.running, r.backends[0].jobs.pending, r.backends[0].concurrent], [3, 1, 18])
  const s = system({ at: 1, ncpu: 8 }, r)
  assert.equal(s.runners[0].concurrent, 18)
  assert.match(runnerExtra({ now: NOW }, join(tmpdir(), 'nope-' + NOW + '.json')).error, /pas de cache/)
})

test('système: machine sample mapped to gauges; journal filters by kind and project', () => {
  assert.equal(system(null).available, false)
  const s = system({ at: 1, ncpu: 8, cpu: { total: 37.5 }, ram: { total: 32e9, used: 16e9, pct: 50 }, disks: [{ drive: 'C:', total: 1e12, free: 4e11, pct_used: 60 }],
    gpu: { source: 'nvidia-smi', gpus: [{ name: 'RTX', util: 12, mem_used_mb: 1000, mem_total_mb: 8000, temp_c: 50 }] },
    procs: { families: { claude: { count: 3, cpu: 20 } }, runner: { present: true, children: 2 } } },
  { backends: [{ label: 'local', usable: 'yes', jobs: { running: 1 }, runners: 1, concurrent: 18 }] })
  assert.deepEqual([s.cpu, s.ram.pct, s.disks[0].pct, s.gpus[0].pct, s.runners[0].concurrent, s.runnerProc.children], [37.5, 50, 60, 12, 18, 2])
  const j = journal(scanA(), CFG, 'compact')
  assert.equal(j.rows.length, 1)
  assert.equal(j.counts.all, 2)
  assert.equal(journal(scanA(), CFG, 'all', 'app-two').rows.length, 0)
})

// ---- the tree from fixture transcripts: sub-conversation and workflow agent joins -------------------------------------

function line(o) { return JSON.stringify(o) + '\n' }
function asst(id, ts, out, extra = {}, content = []) {
  return line({ type: 'assistant', timestamp: ts, cwd: 'C:\\code\\demo', gitBranch: 'claude/x', perTurnEffort: 'medium', ...extra,
    message: { id, model: 'claude-opus-5-5', stop_reason: 'end_turn', content, usage: { input_tokens: 5, output_tokens: out, cache_read_input_tokens: 1000 } } })
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'factory2-'))
  const projects = join(root, 'projects'), app = join(root, 'app', 'acct', 'org'), boardDir = join(root, 'board')
  const proj = join(projects, 'C--code-demo')
  mkdirSync(join(proj, 'lead-1', 'subagents', 'workflows', 'wf_abc123-1'), { recursive: true })
  mkdirSync(app, { recursive: true }); mkdirSync(boardDir)
  writeFileSync(join(app, 'local_lead.json'), JSON.stringify({ sessionId: 'local_lead', cliSessionId: 'lead-1', cwd: 'C:\\code\\demo', title: 'Lead lane',
    model: 'claude-opus-5-5', effort: 'medium', lastActivityAt: Date.now() }))
  writeFileSync(join(app, 'local_kid.json'), JSON.stringify({ sessionId: 'local_kid', cliSessionId: 'kid-1', cwd: 'C:\\code\\demo', title: 'Child lane',
    model: 'claude-sonnet-5-5', effort: 'low', lastActivityAt: Date.now(), spawnedFrom: { sessionId: 'local_lead', title: 'Lead lane' },
    prs: [{ prNumber: 9, url: 'https://example.invalid/pr/9', state: 'MERGED' }] }))
  writeFileSync(join(proj, 'lead-1.jsonl'),
    line({ type: 'user', timestamp: '2026-10-09T10:00:00Z', origin: { kind: 'human' }, message: { content: 'start the wave' } })
    + asst('m1', '2026-10-09T10:00:01Z', 10, {}, [{ type: 'tool_use', id: 'wf1', name: 'Workflow', input: { script: "export default { name: 'wave-1' }; agent('x', { model: 'sonnet' })" } }])
    + asst('m2', '2026-10-09T10:00:02Z', 10, {}, [{ type: 'tool_use', id: 'ar1', name: 'Agent', input: { subagent_type: 'architect', model: 'opus', effort: 'high', description: 'Review the plan', prompt: 'Review the v2 plan' } }])
    + line({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-09T10:01:00Z', compactMetadata: { trigger: 'auto' } }))
  writeFileSync(join(proj, 'lead-1', 'subagents', 'workflows', 'wf_abc123-1', 'agent-w1.jsonl'),
    line({ type: 'user', isSidechain: true, timestamp: '2026-10-09T10:00:03Z', message: { content: 'build part A' } })
    + asst('w1', '2026-10-09T10:00:04Z', 50, { isSidechain: true, perTurnEffort: 'high' }).replace('claude-opus-5-5', 'claude-sonnet-5-5'))
  writeFileSync(join(proj, 'lead-1', 'subagents', 'workflows', 'wf_abc123-1', 'agent-w1.meta.json'), JSON.stringify({ agentType: 'coder', description: 'part A', workflowPhase: 'Wave A' }))
  writeFileSync(join(proj, 'lead-1', 'subagents', 'agent-ar1.jsonl'), line({ type: 'user', isSidechain: true, timestamp: '2026-10-09T10:00:05Z', message: { content: 'Review the v2 plan' } })
    + asst('a1', '2026-10-09T10:00:06Z', 20, { isSidechain: true }))
  writeFileSync(join(proj, 'lead-1', 'subagents', 'agent-ar1.meta.json'), JSON.stringify({ agentType: 'architect', description: 'Review the plan', toolUseId: 'ar1' }))
  writeFileSync(join(proj, 'kid-1.jsonl'), line({ type: 'user', timestamp: '2026-10-09T10:02:00Z', origin: { kind: 'peer' }, message: { content: 'do part B' } })
    + asst('k1', '2026-10-09T10:02:01Z', 5).replace('claude-opus-5-5', 'claude-sonnet-5-5'))
  return { projects, app: join(root, 'app'), boardDir }
}

function runScan(f) {
  return JSON.parse(execFileSync('python', ['-I', SCAN, '--cache', join(f.boardDir, 'cache.json'), '--projects', f.projects, '--app', f.app,
    '--board', f.boardDir, '--ci-ttl', '0', '--live-s', '0', '--detail', 'lead-1', '--recent', '5'], { encoding: 'utf8' }))
}

test('tree from fixture transcripts: sub-conversation joined by spawnedFrom, workflow agent with its model and effort, architect on call', () => {
  const scan = runScan(fixture())
  const kid = scan.sessions.find((s) => s.cli === 'kid-1')
  assert.equal(kid.merged_prs, 1)
  const lead = scan.sessions.find((s) => s.cli === 'lead-1')
  assert.ok(lead.recent.length > 0 && lead.recent.length <= 5)
  assert.ok(lead.recent.some((e) => e[1] === 'compact'))
  assert.ok(lead.subs.every((x) => 'effort' in x))
  const t = tree(scan, CFG, NOW)
  assert.equal(t.title, 'Lead lane')
  assert.equal(t.children.length, 1)
  assert.equal(t.children[0].title, 'Child lane')
  assert.equal(t.children[0].effort, 'low')
  assert.equal(t.workflows.length, 1)
  const w = t.workflows[0].nodes[0]
  assert.equal(w.type, 'coder')
  assert.equal(w.effort, 'high') // perTurnEffort of the workflow agent's own transcript
  assert.match(w.model, /sonnet/)
  assert.equal(t.architect.calls, 1)
  assert.equal(t.architect.triggers.find((x) => x.id === 'before plan').count, 1)
  assert.ok(t.billSplit.onCall > 0 && Math.abs(t.billSplit.every + t.billSplit.onCall - t.total) < 1e-9)
  assert.match(t.status, /^lead \[opus 5\.5 · medium\]  agents \[\d\/2\]  architecte \[/)
})

test('trimNodes keeps running nodes first and summarises the rest', () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({ id: 'n' + i, type: i % 2 ? 'coder' : 'Explore', status: i === 3 ? 'running' : 'done', ts: `2026-10-09T10:${String(i).padStart(2, '0')}:00Z` }))
  const v = trimNodes(nodes, 5)
  assert.equal(v.shown[0].id, 'n3')
  assert.equal(v.shown[1].id, 'n19')
  assert.equal(v.hidden, 15)
  assert.match(v.hiddenText, /coder ×\d+, Explore ×\d+|Explore ×\d+, coder ×\d+/)
})

// ---- every screen rendered at side-panel width: nothing wider than the pane ---------------------------------------------

test('every screen, rendered at 50, 75 and 120 columns, stacks top to bottom with tabs first and no line wider than the pane', () => {
  const scan = runScan(fixture())
  scan.sessions.push(...scanA().sessions)
  const noop = () => {}
  const act = { tab: noop, go: noop, refresh: noop, filter: noop, jfilter: noop, jproject: noop, pick: noop }
  const machine = { sample: { at: 1, ncpu: 4, cpu: { total: 12 }, ram: { total: 8e9, used: 4e9, pct: 50 }, disks: [], procs: {} }, runner: { backends: [] } }
  for (const cols of [50, 75, 120]) {
    for (const t of tabsOf(CFG)) {
      const text = renderText(drawPane(el, { cfg: CFG, tab: t.id, scan, at: NOW, columns: cols, live: [], quotas: { available: false }, machine, act }), cols)
      assert.ok(widest(text) <= cols, `${t.id} at ${cols}: ${widest(text)}`)
      assert.match(text.split('\n')[0], /\[Mission\]/)
      assert.ok(text.split('\n').length > 5, t.id)
    }
  }
  const mission75 = renderText(drawPane(el, { cfg: CFG, tab: 'mission', scan, at: NOW, columns: 75, act }), 75)
  assert.match(mission75, /en cours/)
  assert.match(mission75, /Lead lane/)
  assert.match(mission75, /cibles V6/)
  const counterRow = mission75.split('\n').find((l) => l.startsWith('╭'))
  assert.equal(counterRow.split('╭').length - 1, 3) // three counters side by side at 75 columns
  const sys = renderText(drawPane(el, { cfg: CFG, tab: 'systeme', scan, at: NOW, columns: 75, machine: { missing: true }, act }), 75)
  assert.match(sys, /module machine non chargé/)
  const arbre = renderText(drawPane(el, { cfg: CFG, tab: 'arbre', scan, at: NOW, columns: 75, act }), 75)
  for (const re of [/Sous-conversations \(\d\)/, /Child lane/, /workflow wf_abc123-1/, /sonnet 5\.5 · ▮▮▮▯ high/, /architecte · sur appel/, /avant un plan ×1/, /Facture/, /Journal de session/, /^lead \[opus 5\.5/m]) {
    assert.match(arbre, re)
  }
  assert.equal(screensConfig(CFG).labels.tabs.systeme, 'Système')
})

// The Workflow screen's tests run with this file in CI (one node --test list in .github/workflows/tests.yml).
import './workflow.test.mjs'
