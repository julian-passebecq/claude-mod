// node --test mods/factory/tests/workflow.test.mjs  (the Workflow screen; needs python on PATH for the fixture scan)
// Invented fixtures only (temp folder, made-up ids, labels and history), never real data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deepMerge } from '../hooks/logic.mjs'
import {
  workflowConfig, estimator, remainingOf, quantiles, runView, limitsView, workflowScreen, speed, capOf, gantt, ganttLegend, scrub,
  parseWorkflowArgs, workflowArgs, frTokens, frUsd, frDur,
} from '../hooks/workflow.mjs'
import { drawFactoryPane, allTabs } from '../hooks/workflow_draw.mjs'
import { el, renderText, widest } from '../scanner/textrender.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CFG = deepMerge(JSON.parse(readFileSync(join(HERE, '..', 'factory.config.json'), 'utf8')), { workflow: JSON.parse(readFileSync(join(HERE, '..', 'workflow.config.json'), 'utf8')) })
const SCAN = join(HERE, '..', 'scanner', 'workflow_scan.py')
const NOW = Date.parse('2026-10-16T20:00:00Z')
const min = 60000
// fake secrets assembled at run time so that the repository holds none
const FAKE_GH = 'gh' + 'p_' + 'Ab1'.repeat(10)
const FAKE_MAIL = 'someone' + '@' + 'corp-mail.test'

// ---- invented history: 4 coders on opus in phase Build, 2 verifiers on haiku -------------------------------------

const H = (run, label, phase, model, durMin, tokens) => ({ run, name: 'wave', label, phase, model, duration_ms: durMin * min, tokens, vec: [0, tokens / 10, tokens * 0.9, 0, 0], type: label.split(':')[0] })
const HISTORY = [
  H('r1', 'coder:a', 'Build', 'claude-opus-5-5', 20, 1e6), H('r1', 'coder:b', 'Build', 'claude-opus-5-5', 30, 2e6),
  H('r2', 'coder:c', 'Build', 'claude-opus-5-5', 40, 3e6), H('r2', 'coder:d', 'Build', 'claude-opus-5-5', 50, 4e6),
  H('r1', 'verify:x', 'Verify', 'claude-haiku-5-5', 5, 1e5), H('r2', 'verify:y', 'Verify', 'claude-haiku-5-5', 7, 2e5),
  H('r3', 'verify:z', 'Verify', 'claude-haiku-5-5', 9, 3e5),
]

test('quantiles: median and quartiles with linear interpolation', () => {
  assert.deepEqual(quantiles([40, 10, 30, 20]), { n: 4, median: 25, p25: 17.5, p75: 32.5 })
  assert.equal(quantiles([]).n, 0)
})

test('estimator: same role, model and phase first; fewer than min_samples → null (pas assez d’historique)', () => {
  const est = estimator(HISTORY, CFG)
  const e = est.agent({ label: 'coder:new', phase: 'Build', model: 'claude-opus-5-5', workflow: 'other' })
  assert.equal(e.level, 'role')
  assert.equal(e.n, 4)
  assert.equal(e.dur.median, 35 * min)
  assert.equal(est.agent({ label: 'x', phase: 'Build', model: 'claude-sonnet-5-5' }), null)
  // two samples only (history cut) → null
  assert.equal(estimator(HISTORY.slice(0, 2), CFG).agent({ label: 'coder:z', phase: 'Build', model: 'claude-opus-5-5' }), null)
  // a waiting phase: past phases of runs with the same workflow name (r1, r2, r3 have Verify)
  const ph = est.phase('wave', 'Verify')
  assert.equal(ph.level, 'workflow')
  assert.equal(ph.n, 3)
  assert.equal(ph.dur.median, 7 * min)
})

test('remainingOf: range from the quartiles minus the elapsed time, overrun past p75', () => {
  const e = estimator(HISTORY, CFG).agent({ label: 'coder:new', phase: 'Build', model: 'claude-opus-5-5' })
  const r = remainingOf(e, 10 * min, 0, 0)
  assert.equal(r.ms.mid, 25 * min)
  assert.ok(r.ms.lo < r.ms.mid && r.ms.mid < r.ms.hi)
  assert.ok(r.usd.mid > 0)
  assert.equal(remainingOf(e, 60 * min, 0).overrun, true)
})

// ---- runs ------------------------------------------------------------------------------------------------------

const agent = (o) => ({ id: o.id, label: o.label, phase: o.phase, type: 'coder', explicit_model: o.explicit === false ? null : 'opus', model: o.model || 'claude-opus-5-5',
  effort: 'medium', status: o.status, start: o.start, end: o.end || null, last: o.last || o.end || o.start, models: { [o.model || 'claude-opus-5-5']: [10, 1000, 100000, 1000, 0, 4] },
  last_tool: o.tool || 'Bash run tests', last_text: '', last_cmd: o.cmd || '', worktree: '', branch: 'claude/x', pr: o.pr || null, rate_limits: o.rate || 0 })

const RUN = {
  run_id: 'wf_test-1', cli: 'conv-1', project: 'D--code-app', name: 'wave', description: 'two phases', status: 'running', start: NOW - 30 * min,
  phases: [{ title: 'Build', detail: 'coders' }, { title: 'Verify', detail: 'checks' }], last_activity: NOW,
  agents: [
    agent({ id: 'a1', label: 'coder:one', phase: 'Build', status: 'running', start: NOW - 10 * min, last: NOW - min, cmd: 'gh pr checks 12 --watch', pr: 12 }),
    agent({ id: 'a2', label: 'coder:two', phase: 'Build', status: 'running', start: NOW - 10 * min, last: NOW - 40 * min + 30 * min - 20 * min, explicit: false, cmd: 'npm ci' }),
    agent({ id: 'a3', label: 'coder:three', phase: 'Build', status: 'failed', start: NOW - 30 * min, end: NOW - 20 * min }),
  ],
}

test('runView: phases as a timeline, stuck and failed in red, inherited model in orange, ETA sentence', () => {
  const v = runView(RUN, estimator(HISTORY, CFG), CFG, NOW)
  assert.deepEqual(v.phases.map((p) => p.status), ['running', 'waiting'])
  const a2 = v.agents.find((a) => a.id === 'a2')
  assert.equal(a2.stuck, true) // last event 30 min ago > stuck_min 15
  assert.ok(v.highlights.some((h) => h.level === 'bad' && /coder:two/.test(h.text)))
  assert.ok(v.highlights.some((h) => h.level === 'bad' && /coder:three a échoué/.test(h.text)))
  assert.ok(v.highlights.some((h) => h.level === 'warn' && /sans modèle explicite/.test(h.text)))
  assert.ok(!v.highlights.some((h) => h.level === 'bad' && /modèle/.test(h.text)), 'an inherited model is not a red problem')
  assert.equal(v.estimate.enough, true)
  assert.match(v.sentence, /^Phase 1 sur 2 \(Build\), 2 agent\(s\) en cours, fini vers \d\d:\d\d, ~[\d,]+ [MK] tokens, ~[\d,]+ \$$/)
  assert.ok(v.estimate.eta.lo <= v.estimate.eta.mid && v.estimate.eta.mid <= v.estimate.eta.hi)
  assert.ok(['S', 'M', 'L', 'XL'].includes(v.badge))
})

test('runView: without history the sentence says « pas assez d’historique »', () => {
  const v = runView(RUN, estimator([], CFG), CFG, NOW)
  assert.match(v.sentence, /pas assez d’historique/)
})

test('runView: a finished run says when it ended, its length and its cost', () => {
  const done = { ...RUN, status: 'completed', end: NOW - 5 * min, agents: RUN.agents.map((a) => ({ ...a, status: 'done', end: NOW - 5 * min })) }
  const v = runView(done, estimator(HISTORY, CFG), CFG, NOW)
  assert.match(v.sentence, /^Terminé à \d\d:\d\d en 25 min, 3 agent\(s\)/)
  assert.equal(v.estimate, null)
})

test('limitsView: CI and npm ci / tsc counted from the last shell command, over the rule in red', () => {
  const v = runView(RUN, null, CFG, NOW)
  const ok = limitsView([v], CFG)
  assert.equal(ok.ci, 1)
  assert.equal(ok.npm, 1)
  assert.equal(ok.level, 'ok')
  const tight = deepMerge(CFG, { workflow: { limits: { ci: 0, npm: 3 } } })
  const bad = limitsView([runView(RUN, null, tight, NOW)], tight)
  assert.equal(bad.level, 'bad')
  assert.match(bad.highlights[0].text, /CI : 1 pipelines/)
})

test('speed: average width vs cap, idle gaps, sequential agents of one phase flagged, 429s counted', () => {
  const seq = { ...RUN, status: 'completed', agents: [
    agent({ id: 's1', label: 'coder:a', phase: 'Build', status: 'done', start: NOW - 60 * min, end: NOW - 50 * min }),
    agent({ id: 's2', label: 'coder:b', phase: 'Build', status: 'done', start: NOW - 50 * min + 30000, end: NOW - 40 * min, rate: 2 }),
    agent({ id: 's3', label: 'verify:a', phase: 'Verify', status: 'done', start: NOW - 30 * min, end: NOW - 20 * min }),
  ] }
  const v = runView(seq, null, CFG, NOW)
  const sp = speed([v], CFG, 22, NOW, null)
  assert.equal(sp.cap, 16) // min(16, 22 − 2)
  assert.equal(capOf(CFG, 8), 6)
  assert.equal(sp.max, 1)
  assert.equal(sp.could.length, 1)
  assert.equal(sp.could[0].label, 'coder:b')
  assert.equal(sp.idleMs, 10 * min + 30000)
  assert.equal(sp.rate, 2)
  assert.match(sp.sentence, /^Utilisé 0,7\/16 agents en moyenne \(pic 1\), 1 agent\(s\) auraient pu tourner en parallèle, limites atteintes : 2 erreur/)
  const none = speed([runView(RUN, null, CFG, NOW)], CFG, 22, NOW, null)
  assert.match(none.sentence, /aucune limite atteinte/)
})

test('gantt: horizontal with a now line and a dashed estimated tail when wide, vertical (time goes down) when narrow', () => {
  const v = runView(RUN, estimator(HISTORY, CFG), CFG, NOW)
  const g = gantt(v, NOW, 70, CFG)
  assert.equal(g.mode, 'horizontal')
  const one = g.groups[0].rows.find((r) => r.label === 'coder:one')
  assert.ok(one.cells.some((c) => c.kind === 'tail'))
  assert.ok(g.groups[0].rows.every((r) => r.cells.reduce((n, c) => n + [...c.text].length, 0) === g.barW))
  const nv = gantt(v, NOW, 20, CFG)
  assert.equal(nv.mode, 'vertical')
  assert.ok(nv.rows.some((r) => r.kind === 'now'))
  assert.deepEqual(nv.rows.map((r) => r.ts), [...nv.rows.map((r) => r.ts)].sort((a, b) => a - b))
})

test('gantt: drawn by lib/core/gantt.mjs (same symbols and legend as the ci Diagramme)', async () => {
  const core = await import('../lib/core/gantt.mjs')
  const v = runView(RUN, estimator(HISTORY, CFG), CFG, NOW)
  const g = gantt(v, NOW, 70, CFG)
  const glyphs = new Set(g.groups.flatMap((x) => x.rows.flatMap((r) => r.cells.flatMap((c) => [...c.text]))))
  const allowed = new Set(Object.values(core.SYMBOLS))
  assert.ok([...glyphs].every((c) => allowed.has(c)), [...glyphs].join(''))
  assert.equal(ganttLegend(), core.legend())
})

test('scrub: tokens, passwords, e-mails and home folders masked, one line, ≤ 100 characters', () => {
  const s = scrub(`push ${FAKE_GH} password=hunter2 to ${FAKE_MAIL} from C:\\Users\\me\\repo\nnext line ` + 'x'.repeat(200))
  assert.ok(!s.includes(FAKE_GH) && !s.includes('hunter2') && !s.includes(FAKE_MAIL) && !s.includes("Users"))
  assert.ok(!s.includes('\n'))
  assert.ok(s.length <= 100)
})

test('parseWorkflowArgs and workflowArgs: /factory workflow [all], scanner flags', () => {
  assert.deepEqual(parseWorkflowArgs('workflow'), { workflow: true, scope: null })
  assert.deepEqual(parseWorkflowArgs('wf all'), { workflow: true, scope: 'all' })
  assert.equal(parseWorkflowArgs('My lane').workflow, false)
  assert.ok(workflowArgs(CFG, { script: 's.py', cache: 'c.json', scope: 'all' }).includes('--all'))
  assert.deepEqual(workflowArgs(CFG, { script: 's.py', cache: 'c.json', scope: 'conversation', session: 'conv-1' }).slice(-2), ['--session', 'conv-1'])
})

test('formatting in French', () => {
  assert.equal(frTokens(1234567), '1,2 M')
  assert.equal(frTokens(68000), '68 K')
  assert.equal(frUsd(18.4), '18 $')
  assert.equal(frUsd(4.1), '4,10 $')
  assert.equal(frDur(75 * min), '1 h 15')
})

test('drawFactoryPane: a Workflow tab after Arbre, the screen fits a side panel (60 and 75 columns)', () => {
  assert.deepEqual(allTabs(CFG).map((t) => t.id).slice(0, 4), ['mission', 'focus', 'arbre', 'workflow'])
  const noop = () => {}
  const wf = { cpus: 22, runs: [RUN], live: [], history: HISTORY }
  for (const cols of [60, 75]) {
    const tree = drawFactoryPane(el, { cfg: CFG, tab: 'workflow', wf, wfAt: NOW, wfScope: 'conversation', wfOpen: {}, columns: cols,
      act: { tab: noop, refresh: noop, wfScope: noop, wfToggle: noop } })
    const text = renderText(tree, cols)
    assert.ok(widest(text) <= cols, `${cols}: ${widest(text)}`)
    for (const re of [/Workflows/, /Phase 1 sur 2/, /Parallélisme sur ce PC/, /Gantt/, /Estimations/, /Vitesse/, /Worktree :/, /modèle hérité/]) assert.match(text, re)
  }
})

// ---- the scanner on an invented ~/.claude/projects --------------------------------------------------------------

function line(o) { return JSON.stringify(o) + '\n' }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wfscan-'))
  const sess = join(root, 'D--code-app', 'conv-1')
  const now = Date.now()
  const iso = (ms) => new Date(ms).toISOString()
  const asst = (ts, id, tools, text, model = 'claude-opus-5-5') => line({ type: 'assistant', timestamp: iso(ts), cwd: 'D:/code/app', gitBranch: 'claude/pkg', perTurnEffort: 'medium',
    message: { id, model, usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
      content: [...(text ? [{ type: 'text', text }] : []), ...tools.map((t) => ({ type: 'tool_use', name: t.name, input: t.input }))] } })
  // finished run wf_done-1 with a record (history)
  const dDone = join(sess, 'subagents', 'workflows', 'wf_done-1')
  mkdirSync(dDone, { recursive: true })
  mkdirSync(join(sess, 'workflows', 'scripts'), { recursive: true })
  writeFileSync(join(sess, 'workflows', 'wf_done-1.json'), JSON.stringify({ runId: 'wf_done-1', status: 'completed', workflowName: 'wave', startTime: String(now - 3600000), durationMs: '600000',
    totalTokens: '5000', agentCount: '1', phases: [{ title: 'Build', detail: 'x' }], script: "export const meta = {\n  name: 'wave',\n  description: 'old',\n  phases: [{ title: 'Build' }],\n}\n",
    workflowProgress: [{ type: 'workflow_phase', index: '1', title: 'Build' }, { type: 'workflow_agent', agentId: 'aold', label: 'coder:old', phaseTitle: 'Build', model: 'claude-opus-5-5', state: 'done', tokens: '4000', durationMs: '600000', startedAt: String(now - 3600000) }] }))
  writeFileSync(join(dDone, 'journal.jsonl'), line({ type: 'launched' }) + line({ type: 'started', agentId: 'aold', label: 'coder:old', phase: 'Build' }) + line({ type: 'result', agentId: 'aold', result: 'ok' }))
  writeFileSync(join(dDone, 'agent-aold.jsonl'), asst(now - 3600000, 'm1', [], 'done') + asst(now - 3000000, 'm2', [], 'see https://example.test/o/r/pull/41'))
  writeFileSync(join(dDone, 'agent-aold.meta.json'), JSON.stringify({ agentType: 'coder', workflowPhase: 'Build', model: 'opus' }))
  const old = (now - 3000000) / 1000
  for (const f of ['journal.jsonl', 'agent-aold.jsonl']) utimesSync(join(dDone, f), old, old)
  // running run wf_live-2: no record, script on disk, one agent running (secret in its command), one failed
  const dLive = join(sess, 'subagents', 'workflows', 'wf_live-2')
  mkdirSync(dLive, { recursive: true })
  writeFileSync(join(sess, 'workflows', 'scripts', 'wave-wf_live-2.js'), "export const meta = {\n  name: 'wave',\n  description: 'Two phases: build then verify',\n  phases: [\n    { title: 'Build', detail: 'coders' },\n    { title: 'Verify', detail: 'checks' },\n  ],\n}\nexport default async () => {}\n")
  writeFileSync(join(dLive, 'journal.jsonl'), line({ type: 'launched' }) + line({ type: 'started', agentId: 'ar', label: 'coder:run', phase: 'Build' }) + line({ type: 'started', agentId: 'af', label: 'coder:fail', phase: 'Build' }) + line({ type: 'failed', agentId: 'af' }))
  writeFileSync(join(dLive, 'agent-ar.jsonl'), asst(now - 120000, 'm1', [{ name: 'Bash', input: { command: `git push https://x:${FAKE_GH}@example.test/r.git && gh pr checks 7 --watch` } }]) +
    line({ type: 'system', subtype: 'api_error', timestamp: iso(now - 60000), error: { status: 429, message: 'rate_limit_error' } }))
  writeFileSync(join(dLive, 'agent-ar.meta.json'), JSON.stringify({ agentType: 'coder', workflowPhase: 'Build', worktreePath: 'D:/code/app/.claude/worktrees/run' }))
  writeFileSync(join(dLive, 'agent-af.jsonl'), asst(now - 100000, 'm9', [], 'gave up'))
  writeFileSync(join(dLive, 'agent-af.meta.json'), JSON.stringify({ agentType: 'coder', workflowPhase: 'Build', model: 'sonnet' }))
  return root
}

test('workflow_scan.py: run layout read, statuses, history from records, secrets scrubbed, incremental second pass', () => {
  const root = fixture()
  const cache = join(root, 'cache.json')
  const run = (...a) => JSON.parse(execFileSync(CFG.python || 'python', ['-I', SCAN, '--projects', root, '--cache', cache, ...a], { encoding: 'utf8' }))
  const out = run('--session', 'conv-1')
  assert.equal(out.runs.length, 2)
  const live = out.runs.find((r) => r.run_id === 'wf_live-2')
  assert.equal(live.status, 'running')
  assert.equal(live.name, 'wave')
  assert.deepEqual(live.phases.map((p) => p.title), ['Build', 'Verify'])
  const ar = live.agents.find((a) => a.id === 'ar')
  const af = live.agents.find((a) => a.id === 'af')
  assert.equal(ar.status, 'running')
  assert.equal(af.status, 'failed')
  assert.equal(ar.explicit_model, null)
  assert.equal(af.explicit_model, 'sonnet')
  assert.equal(ar.effort, 'medium')
  assert.equal(ar.branch, 'claude/pkg')
  assert.equal(ar.rate_limits, 1)
  assert.ok(!JSON.stringify(out).includes(FAKE_GH), 'a token never leaves the scanner')
  assert.ok(ar.last_tool.length <= 100)
  assert.match(ar.last_cmd, /gh pr checks 7 --watch/)
  const done = out.runs.find((r) => r.run_id === 'wf_done-1')
  assert.equal(done.status, 'completed')
  assert.equal(done.agents[0].status, 'done')
  assert.equal(done.agents[0].pr, 41)
  assert.equal(out.history.length, 1)
  assert.equal(out.history[0].tokens, 2 * 1110) // used tokens from the transcript, not the record's context size
  // another conversation: nothing of conv-1 is shown, the running run still counts for the PC-wide limits
  const other = run('--session', 'conv-9')
  assert.equal(other.runs.length, 0)
  assert.equal(other.live.length, 1)
  // second pass reads from the cached offsets and gives the same result
  assert.deepEqual(run('--session', 'conv-1').runs.map((r) => r.agents.length), out.runs.map((r) => r.agents.length))
  // the screen built from it
  const s = workflowScreen(out, CFG, Date.now())
  assert.equal(s.runs[0].live, true)
  assert.equal(s.limits.ci, 1)
})
