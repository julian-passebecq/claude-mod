// Scenario JSON validation and snippet generation: node --test mods/scenarios/tests/logic.test.mjs (Node 22.18+ strips the types)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { KINDS, check, expandHome, limitsFor, merge, parseArgs, settingsFor, snippet } from '../hooks/logic.ts'

const shipped = JSON.parse(readFileSync(new URL('../scenarios.json', import.meta.url), 'utf8'))
const clone = x => JSON.parse(JSON.stringify(x))

test('the shipped scenarios are valid, S1-S4, every source an https URL', () => {
  const { catalog, errors, warnings } = check(merge(shipped))
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
  assert.deepEqual(catalog.scenarios.map(s => s.id), ['S1', 'S2', 'S3', 'S4'])
  for (const l of catalog.limits) assert.match(catalog.sources[l.source], /^https:\/\/code\.claude\.com\/docs\//)
})

test('a user file adds S5 and replaces a shipped scenario by id', () => {
  const user = {
    scenarios: [
      { id: 'S5', name: 'Solo', roles: [{ role: 'lead', model: 'sonnet', effort: 'medium', unit: 'session', max_parallel: 1 }] },
      { id: 'S2', name: 'Économe bis', roles: [{ role: 'lead', model: 'haiku', effort: 'low', unit: 'session', max_parallel: 1 }] },
    ],
  }
  const { catalog, errors } = check(merge(shipped, user))
  assert.deepEqual(errors, [])
  assert.deepEqual(catalog.scenarios.map(s => s.id), ['S1', 'S3', 'S4', 'S5', 'S2'])
  assert.equal(catalog.scenarios.find(s => s.id === 'S2').name, 'Économe bis')
})

test('broken scenarios are dropped with one error per problem', () => {
  const bad = clone(shipped)
  bad.scenarios.push(
    { id: 'X1', name: 'bad', roles: [{ role: 'coder', model: 'gpt', effort: 'huge', unit: 'thread', max_parallel: 0 }] },
    { id: 'X2', name: 'too many', roles: [{ role: 'search', model: 'haiku', effort: 'low', unit: 'subagent', max_parallel: 21 }] },
    { id: 'S1', name: 'dup', roles: [{ role: 'lead', model: 'opus', effort: 'low', unit: 'session', max_parallel: 1 }] },
    { name: 'no id', roles: [] },
  )
  // merge keeps the last S1; check its duplicate rule on a raw catalog instead
  const { catalog, errors } = check(merge(bad))
  assert.ok(!catalog.scenarios.some(s => s.id === 'X1' || s.id === 'X2'))
  assert.ok(errors.some(e => /X1 role coder: unknown model "gpt"/.test(e)))
  assert.ok(errors.some(e => /effort "huge" is not one of low, medium/.test(e)))
  assert.ok(errors.some(e => /unit "thread"/.test(e)))
  assert.ok(errors.some(e => /max_parallel must be a whole number/.test(e)))
  assert.ok(errors.some(e => /X2 role search: max_parallel 21 is above the limit "20 running subagents/.test(e)))
  assert.ok(errors.some(e => /scenario \?: missing id/.test(e)))
  const raw = { ...merge(shipped), scenarios: [shipped.scenarios[0], shipped.scenarios[0]] }
  assert.ok(check(raw).errors.some(e => /S1: duplicate id/.test(e)))
})

test('warnings: sub-conversation above its parent, total over the Workflow cap; full model ids pass', () => {
  const s = {
    id: 'W', name: 'w',
    roles: [
      { role: 'lead', model: 'opus', effort: 'medium', unit: 'session', max_parallel: 1 },
      { role: 'lane', model: 'claude-opus-5-5', effort: 'high', unit: 'sub-conversation', max_parallel: 2 },
      { role: 'a', model: 'opus', effort: 'medium', unit: 'workflow-agent', max_parallel: 10 },
      { role: 'b', model: 'sonnet', effort: 'low', unit: 'workflow-agent', max_parallel: 10 },
    ],
  }
  const { catalog, errors, warnings } = check(merge(shipped, { scenarios: [s] }))
  assert.deepEqual(errors, [])
  assert.ok(catalog.scenarios.some(x => x.id === 'W'))
  assert.ok(warnings.some(w => /lane: a sub-conversation's effort \(high\) is above its parent's \(medium\).*non vérifié/.test(w)))
  assert.ok(warnings.some(w => /20 workflow-agent at once/.test(w)))
})

test('bad sources and limits are reported', () => {
  const { errors } = check(merge(shipped, { sources: { x: 'http://insecure' }, limits: [{ id: 'l', text: 't', source: 'nowhere' }] }))
  assert.ok(errors.includes('source x: not an https URL'))
  assert.ok(errors.some(e => /limit l: needs id, text and a known source/.test(e)))
})

const S = id => check(merge(shipped)).catalog.scenarios.find(s => s.id === id)
const C = () => check(merge(shipped)).catalog

test('prompt snippet: every role, the model rule, caps, no escalation at night', () => {
  const p1 = snippet(C(), S('S1'), 'prompt')
  assert.match(p1, /^Scenario S1 "Standard V6": Lead Opus 5\.5 medium as Session \(max 1\); Coders Opus 5\.5 medium as Workflow agent\(\) \(max 4\)/)
  assert.match(p1, /Search Haiku 5\.5 low as Agent subagent \(max 5\)/)
  assert.match(p1, /Every Agent and Workflow agent\(\) call names its model\./)
  assert.match(p1, /Caps: ci pipelines <= 4, npm ci tsc <= 3\.$/)
  assert.doesNotMatch(p1, /No effort escalation/)
  assert.match(snippet(C(), S('S4'), 'prompt'), /No effort escalation\. Caps: workflows <= 1, ci pipelines <= 4\./)
})

test('agent, workflow, frontmatter and env snippets', () => {
  const agent = snippet(C(), S('S1'), 'agent')
  assert.match(agent, /Agent\(\{ description: "<3-5 words>", subagent_type: "explore-fast", model: "haiku", effort: "low", prompt: "<task>" \}\)/)
  assert.doesNotMatch(agent, /coder/) // coders are Workflow agents in S1
  const wf = snippet(C(), S('S2'), 'workflow')
  assert.match(wf, /"coder": \{ model: 'sonnet' \}, \/\/ effort high: agents\/coder\.md \(agent\(\) effort undocumented\); max 4 at once/)
  assert.match(snippet(C(), S('S3'), 'frontmatter'), /# agents\/architect\.md\n---\nname: architect\ndescription: Architect\nmodel: opus\neffort: xhigh\n---/)
  const env = snippet(C(), S('S1'), 'env')
  assert.match(env, /CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: non vérifié/)
  const json = JSON.parse(env.split('\n').filter(l => !l.startsWith('//')).join('\n'))
  assert.deepEqual(json, { env: { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-5-5', CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: 'claude-sonnet-5-5' } })
  const solo = { id: 'S9', name: 'solo', roles: [{ role: 'lead', model: 'opus', effort: 'medium', unit: 'session', max_parallel: 1 }] }
  assert.equal(snippet(C(), solo, 'agent'), '// S9: no role runs as an Agent subagent')
  assert.equal(snippet(C(), solo, 'workflow'), '// S9: no role runs as a Workflow agent')
  for (const k of KINDS) assert.ok(snippet(C(), S('S4'), k).length > 0)
})

test('settings per unit cite a source; the undocumented ones say so', () => {
  const s1 = S('S1')
  const coder = settingsFor(C(), s1.roles.find(r => r.role === 'coder'))
  assert.ok(coder.some(l => !l.verified && /effort medium: no documented agent\(\) option/.test(l.text)))
  const search = settingsFor(C(), s1.roles.find(r => r.role === 'search'))
  assert.ok(search.every(l => l.verified && l.source === 'sub-agents'))
  assert.ok(limitsFor(C(), s1).some(l => l.id === 'workflow-concurrent'))
  assert.ok(!limitsFor(C(), s1).some(l => l.id === 'subconv-effort')) // S1 has no sub-conversation
})

test('args and paths', () => {
  assert.deepEqual(parseArgs('', ['S1']), {})
  assert.deepEqual(parseArgs('s2 ENV', ['S1', 'S2']), { id: 'S2', kind: 'env' })
  assert.deepEqual(parseArgs('workflow S9', ['S1']), { id: 'S9', kind: 'workflow' })
  assert.equal(expandHome('~\\x\\s.json', 'C:/Users/me'), 'C:/Users/me/x/s.json')
})

test('tests/shipped.ts (the test kit copy) equals scenarios.json', async () => {
  const { SHIPPED } = await import('./shipped.ts')
  assert.deepEqual(JSON.parse(SHIPPED), shipped)
})
