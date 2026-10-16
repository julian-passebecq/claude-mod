// Synthetic transcripts for the usage tests: made-up ids, paths and numbers, no real data.
// Written to a temp folder at test time (the repo keeps no .jsonl files).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const T0 = Date.parse('2026-10-14T08:00:00Z')
const iso = ms => new Date(ms).toISOString()

export function assistant({ id, req, ts, model = 'claude-opus-5-5', inp = 100, out = 50, cr = 1000, cw5 = 0, cw1h = 200, session = 'sess-a', cwd = 'C:/code/app-one', entrypoint = 'claude-desktop', effort = 'medium', skill, mcp, agent }) {
  const o = {
    type: 'assistant', sessionId: session, cwd, entrypoint, timestamp: iso(ts), requestId: req, uuid: `u-${id}-${req}`, effort,
    message: { id, model, role: 'assistant', usage: { input_tokens: inp, output_tokens: out, cache_read_input_tokens: cr, cache_creation_input_tokens: cw5 + cw1h, cache_creation: { ephemeral_5m_input_tokens: cw5, ephemeral_1h_input_tokens: cw1h } } },
  }
  if (skill) o.attributionSkill = skill
  if (mcp) o.attributionMcpServer = mcp
  if (agent) o.attributionAgent = agent
  return JSON.stringify(o)
}
export const user = ({ ts, session = 'sess-a', kind = 'human' }) => JSON.stringify({ type: 'user', sessionId: session, timestamp: iso(ts), origin: { kind }, message: { role: 'user', content: 'do the thing' } })
export const title = (t, session = 'sess-a') => JSON.stringify({ type: 'custom-title', customTitle: t, sessionId: session })

export function write(root, rel, lines, { partial = '' } = {}) {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, lines.join('\n') + '\n' + partial)
  return p
}

/** A small projects tree: a main thread (with a repeated request and a skill/MCP), a subagent, a Workflow agent,
 * a sub-conversation started by a peer, and a forked copy that repeats one request. */
export function tree(root) {
  const m = 60000
  write(root, 'C--code-app-one/sess-a.jsonl', [
    title('App one lane'),
    user({ ts: T0 }),
    assistant({ id: 'm1', req: 'r1', ts: T0 + 1 * m, out: 10 }),
    assistant({ id: 'm1', req: 'r1', ts: T0 + 1 * m, out: 50 }), // same request, second content block: replaces
    assistant({ id: 'm2', req: 'r2', ts: T0 + 3 * m, skill: 'handoff' }),
    assistant({ id: 'm3', req: 'r3', ts: T0 + 30 * m, mcp: 'github' }), // 27 min later: active time capped
    JSON.stringify({ type: 'assistant', timestamp: iso(T0), message: { id: 'x', model: '<synthetic>', usage: { input_tokens: 5 } } }),
  ])
  write(root, 'C--code-app-one/sess-a/subagents/agent-s1.jsonl', [
    assistant({ id: 's1', req: 'rs1', ts: T0 + 2 * m, model: 'claude-haiku-5-5', agent: 'explore-fast' }),
    assistant({ id: 's2', req: 'rs2', ts: T0 + 4 * m, model: 'claude-haiku-5-5', agent: 'explore-fast' }),
  ])
  write(root, 'C--code-app-one/sess-a/subagents/workflows/wf_1/agent-w1.jsonl', [
    assistant({ id: 'w1', req: 'rw1', ts: T0 + 5 * m, model: 'claude-sonnet-5-5', cwd: 'C:/code/app-one/.claude/worktrees/lane-1', agent: 'coder' }),
  ])
  write(root, 'C--code-app-one/sess-a/subagents/workflows/wf_1/journal.jsonl', [JSON.stringify({ type: 'started', label: 'x' })])
  write(root, 'C--code-app-two/sess-b.jsonl', [
    user({ ts: T0 + 60 * m, session: 'sess-b', kind: 'peer' }),
    assistant({ id: 'b1', req: 'rb1', ts: T0 + 61 * m, session: 'sess-b', cwd: 'C:/code/app-two', entrypoint: 'cli' }),
  ])
}
