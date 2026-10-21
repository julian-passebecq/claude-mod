// band mod: the Jauge's « en cours » rows (hooks/encours.ts) and the reader behind them (lib/core/running.mjs via
// scanner/encours.mjs). node --test mods/band/tests/encours.test.mjs. Invented fixtures, written to a temp folder.
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ecCfg, enCoursView, levelOf, progressOf, rowText } from '../hooks/encours.ts'
import { enCours } from '../scanner/encours.mjs'
import { newRunningState, scriptMeta } from '../lib/core/running.mjs'

const NOW = Date.parse('2026-10-21T22:00:00Z')
const MIN = 60000
const cfg = (j = {}) => ecCfg({ en_cours_rows: 5, ...j })
const agent = (id, label, extra = {}) => ({ id, label, type: 'coder', model: 'opus', status: 'running', start: NOW - 47 * MIN, last: NOW - MIN, ...extra })
const wf = (extra = {}) => ({
  id: 'wf_1', name: 'cockpit-preview-g2', phases: ['Preview release', 'Verify'], phase: 'Preview release', phaseIdx: 0, status: 'running',
  start: NOW - 47 * MIN, last: NOW - MIN, agents: [agent('a1', 'p43-rag-identity'), agent('a2', 'p44-migration')], ...extra,
})

test('nothing runs: no row (the Jauge stays one line)', () => {
  assert.deepEqual(enCoursView({ workflows: [], agents: [] }, cfg(), 160, NOW), { rows: [], more: 0 })
  assert.deepEqual(enCoursView(null, cfg(), 160, NOW), { rows: [], more: 0 })
})

test('one Workflow with 2 agents: its row, then one indented row of both agents', () => {
  const v = enCoursView({ workflows: [wf({ eta: NOW + 20 * MIN })] }, cfg(), 160, NOW)
  assert.equal(v.rows.length, 2)
  const head = rowText(v.rows[0])
  assert.match(head, /^◇ cockpit-preview-g2 ▱▱▱▱▱ 0\/2 · ▸ Preview release · 2 agents opus · 47 min · fin ~\d\d:\d\d$/)
  assert.equal(v.rows[0].segs[0].tone, 'ok')
  const bar = v.rows[0].segs.find((s) => s.bar !== undefined)
  assert.deepEqual([bar.text, bar.bar, bar.tone], ['▱▱▱▱▱', 0, 'ok']) // the desktop draws it as an Svg
  assert.ok(v.rows[0].segs.some((s) => s.text === '2 agents' && s.dim))
  assert.equal(rowText(v.rows[1]), '   • coder p43-rag-identity · opus · 47 min    • coder p44-migration · opus · 47 min')
  assert.ok(v.rows[1].segs.some((s) => s.text === 'coder ' && s.dim))
})

test('agents wrap to a second row, then « +N »', () => {
  const many = Array.from({ length: 6 }, (_, i) => agent(`a${i}`, `package-number-${i}`))
  const v = enCoursView({ workflows: [wf({ agents: many })] }, cfg(), 90, NOW)
  assert.equal(v.rows.length, 3)
  assert.ok(rowText(v.rows[2]).endsWith('+4') || /\+\d$/.test(rowText(v.rows[2])))
  for (const r of v.rows.slice(1)) assert.ok([...rowText(r)].length <= 90, rowText(r))
})

test('a background agent outside Workflows: ◦ agent d\'arrière-plan · type · model · elapsed; a foreground one: •', () => {
  const v = enCoursView({ agents: [{ id: 'b1', type: 'auditor', model: 'sonnet', shape: 'background', status: 'running', start: NOW - 3 * MIN, last: NOW }, { id: 'f1', type: 'explore-fast', label: 'find usages', model: 'haiku', shape: 'foreground', status: 'running', start: NOW - 30000, last: NOW }] }, cfg(), 160, NOW)
  assert.equal(rowText(v.rows[0]), "◦ agent d'arrière-plan · auditor · sonnet · 3 min")
  assert.ok(v.rows[0].segs.some((s) => s.text === "agent d'arrière-plan" && s.dim))
  assert.equal(rowText(v.rows[1]), '• agent · explore-fast find usages · haiku · < 1 min')
})

test('row cap: en_cours_rows then « +N de plus »', () => {
  const lone = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, type: 'tester', model: 'sonnet', shape: 'background', status: 'running', start: NOW - MIN, last: NOW }))
  const v = enCoursView({ workflows: [wf()], agents: lone }, cfg({ en_cours_rows: 3 }), 160, NOW)
  assert.equal(v.rows.length, 2)
  assert.equal(v.more, 4)
  assert.equal(enCoursView({ workflows: [wf()] }, cfg({ en_cours_rows: 0 }), 160, NOW).rows.length, 0)
})

test('traffic light: green while it writes, orange after 15 min without a write, red after 30 min or failed', () => {
  const v = enCoursView({ workflows: [wf({ stalled: true, last: NOW - 22 * MIN, agents: [agent('a1', 'x', { last: NOW - 20 * MIN }), agent('a2', 'y', { status: 'failed' })] })] }, cfg(), 160, NOW)
  assert.equal(v.rows[0].segs[0].tone, 'warn')
  assert.match(rowText(v.rows[0]), /rien écrit depuis 22 min/)
  assert.equal(v.rows[0].segs.find((s) => s.bar !== undefined).tone, 'warn') // the bar takes the row's colour
  const bullets = v.rows[1].segs.filter((s) => s.tone)
  assert.deepEqual(bullets.map((s) => s.tone), ['warn', 'bad'])
  const red = enCoursView({ workflows: [wf({ last: NOW - 42 * MIN })] }, cfg(), 160, NOW)
  assert.equal(red.rows[0].segs[0].tone, 'bad')
  assert.match(rowText(red.rows[0]), /rien écrit depuis 42 min/)
  const c = cfg()
  assert.deepEqual([5, 15, 29, 30].map((m) => levelOf({ status: 'running', last: NOW - m * MIN }, NOW, c)), ['ok', 'warn', 'warn', 'bad'])
  assert.equal(levelOf({ status: 'failed', last: NOW }, NOW, c), 'bad')
  // own thresholds
  assert.equal(levelOf({ status: 'running', last: NOW - 6 * MIN }, NOW, cfg({ en_cours: { warn_min: 5, bad_min: 10 } })), 'warn')
})

test('progress: phases done/total, else agents done/total', () => {
  assert.deepEqual(progressOf(wf({ phases: ['A', 'B', 'C', 'D', 'E'], phase: 'D', phaseIdx: 3 })), { done: 3, total: 5 })
  assert.deepEqual(progressOf(wf({ phases: [], phase: '', phaseIdx: -1, agents: [agent('a', 'x', { status: 'done' }), agent('b', 'y'), agent('c', 'z')] })), { done: 1, total: 3 })
  assert.equal(progressOf(wf({ phases: [], phase: '', phaseIdx: -1, agents: [] })), undefined)
  const v = enCoursView({ workflows: [wf({ phases: ['A', 'B', 'C', 'D', 'E'], phase: 'D', phaseIdx: 3 })] }, cfg(), 160, NOW)
  assert.match(rowText(v.rows[0]), /^◇ cockpit-preview-g2 ▰▰▰▱▱ 3\/5 · ▸ D · /)
})

// Widths the band really has (Julian's narrow panes): nothing wider than the band, names cut first, the bullet, bar,
// count, elapsed time and state always kept.
for (const cols of [60, 90]) {
  test(`en cours rows fit ${cols} columns; names are cut first`, () => {
    const long = wf({
      name: 'datapass-factory-release-wave-g7-long-name', phases: ['Build', 'Preview release candidate', 'Verify'], phase: 'Preview release candidate', phaseIdx: 1,
      eta: NOW + 20 * MIN, agents: [agent('a1', 'p43-rag-identity-and-access-review'), agent('a2', 'p44-migration'), agent('a3', 'p45-docs', { model: 'sonnet' })],
    })
    const failed = wf({ id: 'wf_2', name: 'nightly-audit', status: 'failed', phases: [], phase: '', phaseIdx: -1, agents: [] })
    const lone = { id: 'b1', type: 'auditor', label: 'confidentiality scan of every mod folder', model: 'sonnet', shape: 'background', status: 'running', start: NOW - 3 * MIN, last: NOW - 16 * MIN }
    const v = enCoursView({ workflows: [long, failed], agents: [lone] }, cfg({ en_cours_rows: 10 }), cols, NOW)
    for (const r of v.rows) assert.ok([...rowText(r)].length <= cols, `${cols}: « ${rowText(r)} » (${[...rowText(r)].length})`)
    const head = rowText(v.rows[0])
    assert.match(head, /^◇ /)
    assert.match(head, /▰▱▱ 1\/3|▰▱▱▱▱ 1\/3|▱ 1\/3/)
    assert.match(head, /47 min/)
    if (cols === 60) {
      assert.match(head, /^◇ datapass-[^ ]*… /) // the name is cut before anything else goes
      assert.ok(!/agents/.test(head), head) // then the agents and models (the ETA comes back when it fits)
    } else {
      assert.match(head, /…/)
      assert.match(head, /2 agents|3 agents/)
    }
    const f = v.rows.find((r) => r.key === 'ec-wf-wf_2')
    assert.match(rowText(f), /nightly-audit.*échoué/)
    const b = v.rows.find((r) => r.key === 'ec-ag-b1')
    assert.match(rowText(b), /^◦ /)
    assert.match(rowText(b), /rien écrit depuis 16 min/)
    assert.equal(b.segs[0].tone, 'warn')
  })
}

test('scriptMeta reads name and phases from the literals only', () => {
  const m = scriptMeta("export const meta = {\n  name: 'demo-wave',\n  description: 'x',\n  phases: [{ title: 'Build' }, { title: 'Verify', detail: 'ci' }],\n}\nconst X = 1\n")
  assert.deepEqual(m, { name: 'demo-wave', phases: ['Build', 'Verify'] })
})

// ---------- reader on an invented conversation folder ----------

const line = (o) => JSON.stringify(o) + '\n'
const iso = (ms) => new Date(ms).toISOString()
const asst = (ms, stop, model = 'claude-opus-5-5') => line({ type: 'assistant', timestamp: iso(ms), message: { model, stop_reason: stop, usage: {} } })
const user = (ms) => line({ type: 'user', timestamp: iso(ms), message: { content: [] } })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'band-encours-'))
  const conv = join(root, 'C--code-app', 'sess-1')
  const wdir = join(conv, 'subagents', 'workflows', 'wf_aa11')
  mkdirSync(wdir, { recursive: true })
  mkdirSync(join(conv, 'workflows', 'scripts'), { recursive: true })
  writeFileSync(join(conv, 'workflows', 'scripts', 'demo-wave-wf_aa11.js'), "export const meta = {\n  name: 'demo-wave',\n  phases: [{ title: 'Build' }, { title: 'Verify' }],\n}\n")
  writeFileSync(join(wdir, 'journal.jsonl'), line({ type: 'launched' }) + line({ type: 'started', agentId: 'x1', label: 'lane-a', phase: 'Build' }) + line({ type: 'started', agentId: 'x2', label: 'lane-b', phase: 'Build' }))
  for (const id of ['x1', 'x2']) {
    writeFileSync(join(wdir, `agent-${id}.jsonl`), user(NOW - 10 * MIN) + asst(NOW - 9 * MIN, 'tool_use'))
    writeFileSync(join(wdir, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'coder', description: id, workflowPhase: 'Build', model: 'opus' }))
  }
  const sdir = join(conv, 'subagents')
  writeFileSync(join(sdir, 'agent-bg1.jsonl'), user(NOW - 3 * MIN) + asst(NOW - 2 * MIN, 'tool_use', 'claude-sonnet-5-5'))
  writeFileSync(join(sdir, 'agent-bg1.meta.json'), JSON.stringify({ agentType: 'auditor', description: 'audit lane', requestShape: 'background' }))
  writeFileSync(join(sdir, 'agent-done.jsonl'), user(NOW - 5 * MIN) + asst(NOW - 4 * MIN, 'end_turn'))
  writeFileSync(join(sdir, 'agent-done.meta.json'), JSON.stringify({ agentType: 'explore-fast', requestShape: 'foreground' }))
  // three past completed runs of the same Workflow in another conversation: 30, 40, 50 min
  const old = join(root, 'C--code-app', 'sess-0', 'workflows')
  mkdirSync(join(old, 'scripts'), { recursive: true })
  ;[30, 40, 50].forEach((m, i) => {
    writeFileSync(join(old, 'scripts', `demo-wave-wf_old${i}.js`), "export const meta = { name: 'demo-wave' }\n")
    writeFileSync(join(old, `wf_old${i}.json`), JSON.stringify({ status: 'completed', workflowName: 'demo-wave', startTime: NOW - 86400000, durationMs: m * MIN }))
  })
  for (const f of ['journal.jsonl', 'agent-x1.jsonl', 'agent-x2.jsonl']) utimesSync(join(wdir, f), (NOW - MIN) / 1000, (NOW - MIN) / 1000)
  for (const f of ['agent-bg1.jsonl', 'agent-done.jsonl']) utimesSync(join(sdir, f), (NOW - MIN) / 1000, (NOW - MIN) / 1000)
  utimesSync(join(conv, 'workflows', 'scripts', 'demo-wave-wf_aa11.js'), (NOW - 10 * MIN) / 1000, (NOW - 10 * MIN) / 1000)
  return { root, conv, wdir, sdir }
}

test('reader: the running Workflow (phase, 2 agents, ETA from 3 past runs) and the background agent; a finished agent is left out', () => {
  const fx = fixture()
  try {
    const state = newRunningState()
    const out = enCours({ projects_root: fx.root, session: 'sess-1', now: NOW, cfg: {} }, state)
    assert.equal(out.workflows.length, 1)
    const w = out.workflows[0]
    assert.equal(w.name, 'demo-wave')
    assert.equal(w.phaseIdx, 0)
    assert.deepEqual(w.agents.map((a) => [a.label, a.model, a.status]), [['lane-a', 'opus', 'running'], ['lane-b', 'opus', 'running']])
    assert.equal(w.eta, NOW + 30 * MIN) // median 40 min, started 10 min ago
    assert.deepEqual(out.agents.map((a) => [a.id, a.type, a.model, a.shape, a.status]), [['bg1', 'auditor', 'sonnet', 'background', 'running']])
    // a result in the journal ends that agent; the run record ends the run
    appendFileSync(join(fx.wdir, 'journal.jsonl'), line({ type: 'result', agentId: 'x1' }))
    const again = enCours({ projects_root: fx.root, session: 'sess-1', now: NOW, cfg: {} }, state)
    assert.deepEqual(again.workflows[0].agents.map((a) => a.status), ['done', 'running'])
    writeFileSync(join(fx.conv, 'workflows', 'wf_aa11.json'), JSON.stringify({ status: 'completed', workflowName: 'demo-wave', durationMs: 11 * MIN }))
    appendFileSync(join(fx.sdir, 'agent-bg1.jsonl'), asst(NOW, 'end_turn', 'claude-sonnet-5-5'))
    const idle = enCours({ projects_root: fx.root, session: 'sess-1', now: NOW, cfg: {} }, state)
    assert.deepEqual([idle.workflows.length, idle.agents.length], [0, 0])
  } finally {
    rmSync(fx.root, { recursive: true, force: true })
  }
})

test('reader: silent for stall_min -> stalled; silent for stale_h -> not shown', () => {
  const fx = fixture()
  try {
    const later = enCours({ projects_root: fx.root, session: 'sess-1', now: NOW + 40 * MIN, cfg: { jauge: { en_cours: { stall_min: 30 } } } }, newRunningState())
    assert.equal(later.workflows[0].stalled, true)
    assert.equal(later.agents[0].stalled, true)
    const gone = enCours({ projects_root: fx.root, session: 'sess-1', now: NOW + 7 * 3600000, cfg: {} }, newRunningState())
    assert.deepEqual([gone.workflows.length, gone.agents.length], [0, 0])
    assert.deepEqual(enCours({ projects_root: fx.root, session: 'nope', now: NOW, cfg: {} }, newRunningState()).workflows, [])
  } finally {
    rmSync(fx.root, { recursive: true, force: true })
  }
})
