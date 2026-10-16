// « Appliquer ce scénario »: record, frontmatter, diff and the file side on an in-memory io (invented files only).
//   node --test mods/scenarios/tests/apply.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { appliedRecord, diffApplied, diffSummary, envOf, frontmatter, sameModel } from '../hooks/apply.ts'
import { applyScenario, readApplied } from '../hooks/apply_io.ts'
import { check, merge } from '../hooks/logic.ts'

const { catalog } = check(merge(JSON.parse(readFileSync(new URL('../scenarios.json', import.meta.url), 'utf8'))))
const S1 = catalog.scenarios.find(s => s.id === 'S1')
const AT = '2026-10-16T12:00:00.000Z'

test('appliedRecord keeps every role with its model id, effort and agent file; env defaults as ids', () => {
  const a = appliedRecord(catalog, S1, AT)
  assert.equal(a.scenario, 'S1')
  assert.equal(a.applied_at, AT)
  assert.deepEqual(a.roles.find(r => r.role === 'coder'), { role: 'coder', label: 'Coders', unit: 'workflow-agent', agent: 'coder', model: 'opus', model_id: 'claude-opus-5-5', effort: 'medium' })
  assert.equal(a.roles.find(r => r.role === 'lead').agent, undefined)
  assert.deepEqual(envOf(catalog, S1), { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-5-5', CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: 'claude-sonnet-5-5' })
  assert.match(a.note, /rien de ceci n'a modifié settings\.json/)
})

test('frontmatter reads key: value lines; none without a block', () => {
  assert.deepEqual(frontmatter('---\nname: coder\nmodel: "opus"\neffort: medium\n---\nbody'), { name: 'coder', model: 'opus', effort: 'medium' })
  assert.deepEqual(frontmatter('# no frontmatter'), {})
  assert.deepEqual(frontmatter(undefined), {})
})

test('sameModel: alias, full id and [1m] suffix are the same model', () => {
  assert.equal(sameModel(catalog, 'opus', 'claude-opus-5-5'), true)
  assert.equal(sameModel(catalog, 'claude-opus-5-5[1m]', 'opus'), true)
  assert.equal(sameModel(catalog, 'sonnet', 'opus'), false)
})

test('diffApplied: session against settings.json, agents against their files, env defaults; absent values differ', () => {
  const a = appliedRecord(catalog, S1, AT)
  const d = diffApplied(catalog, a, {
    settings: { model: 'claude-opus-5-5', effortLevel: 'high', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-5-5' } },
    agents: { coder: { model: 'opus', effort: 'medium' }, architect: { model: 'sonnet', effort: 'high' }, tester: undefined },
  })
  const row = (role, field) => d.find(x => x.role === role && x.field === field)
  assert.equal(row('Lead', 'model').same, true)
  assert.deepEqual([row('Lead', 'effortLevel').same, row('Lead', 'effortLevel').current, row('Lead', 'effortLevel').applied], [false, 'high', 'medium'])
  assert.equal(row('Coders', 'model').same, true)
  assert.equal(row('Review', 'model').same, false)
  assert.equal(row('Review', 'model').where, 'agents/architect.md')
  assert.equal(row('Tests', 'model').current, '(absent)')
  assert.equal(row('env', 'CLAUDE_CODE_SUBAGENT_MODEL').same, true)
  assert.equal(row('env', 'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL').same, false)
  assert.match(diffSummary(a, d), /^S1 Standard V6 noté le 2026-10-16 12:00 : \d+ écarts sur \d+$/)
})

test('applyScenario writes applied.json, keeps the previous as applied.prev.json, touches nothing else', async () => {
  const files = new Map([
    ['C:/u/.claude/settings.json', JSON.stringify({ model: 'opus', effortLevel: 'medium', env: {} })],
    ['C:/u/.claude/agents/coder.md', '---\nname: coder\nmodel: opus\neffort: medium\n---\n'],
  ])
  const writes = []
  const io = { read: async p => files.get(p), write: async (p, t) => { writes.push(p); files.set(p, t) } }
  const first = await applyScenario(io, catalog, S1, 'C:/u/.claude', AT)
  assert.equal(first, 'S1 noté dans ~/.claude/scenarios/applied.json')
  const S2 = catalog.scenarios.find(s => s.id === 'S2')
  const second = await applyScenario(io, catalog, S2, 'C:/u/.claude/', AT)
  assert.match(second, /précédent : applied\.prev\.json/)
  assert.deepEqual(writes, ['C:/u/.claude/scenarios/applied.json', 'C:/u/.claude/scenarios/applied.prev.json', 'C:/u/.claude/scenarios/applied.json'])
  assert.equal(JSON.parse(files.get('C:/u/.claude/scenarios/applied.prev.json')).scenario, 'S1')
  const got = await readApplied(io, catalog, 'C:/u/.claude')
  assert.equal(got.record.scenario, 'S2')
  assert.ok(got.diff.some(x => x.where === 'agents/coder.md' && x.field === 'effort' && !x.same))
  assert.equal(await readApplied({ read: async () => undefined, write: async () => {} }, catalog, 'C:/u/.claude'), undefined)
})
