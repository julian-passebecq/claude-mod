// Canonical copy: lib/core/transcripts.mjs (repo root); usage/lib/transcripts.mjs and mods/*/lib/core copies are made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// Shared, pure transcript parsing for the usage mod (and any mod that needs tokens: band imports it).
// No I/O here: lib/scan-node.mjs reads the files, this module turns lines into usage records and per-hour rows.
// Ideas ported from claude-goblin (MIT, github.com/data-goblin/claude-goblin): dedupe on message.id + requestId,
// incremental per-file state, list-price cost table.

/** Index of each figure in a usage vector. */
export const V = { in: 0, out: 1, cache_read: 2, cache_write_5m: 3, cache_write_1h: 4, msgs: 5, active_s: 6, cost: 7 }
export const zero = () => [0, 0, 0, 0, 0, 0, 0, 0]
export const addInto = (a, b, sign = 1) => {
  for (let i = 0; i < a.length; i++) a[i] += sign * (b[i] || 0)
  return a
}
/** All tokens of a vector: input + output + cache read + cache writes. */
export const tokensOf = v => v[0] + v[1] + v[2] + v[3] + v[4]

const HOUR = 3600000

/**
 * What kind of transcript a path is, from its place under ~/.claude/projects:
 *   <project>/<session>.jsonl                                  main thread (or a sub-conversation, see `isSubConversation`)
 *   <project>/<session>/subagents/agent-<id>.jsonl             Agent subagent
 *   <project>/<session>/subagents/workflows/wf_<id>/agent-*.jsonl  Workflow agent()
 *   .../journal.jsonl                                          Workflow journal (no tokens)
 */
export function kindOfPath(rel) {
  const parts = String(rel).replace(/\\/g, '/').split('/').filter(Boolean)
  const file = parts[parts.length - 1] || ''
  if (file === 'journal.jsonl') return 'journal'
  if (parts.includes('workflows')) return 'workflow'
  if (parts.includes('subagents')) return 'subagent'
  return 'main'
}

/** Project name from a cwd: the folder name, with any `.claude/worktrees/<lane>` tail removed. */
export function projectOf(cwd) {
  if (!cwd) return '?'
  const p = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '')
  const base = p.replace(/\/\.claude\/worktrees\/[^/]+.*$/, '').replace(/\/\.worktrees\/[^/]+.*$/, '')
  const parts = base.split('/').filter(Boolean)
  return parts[parts.length - 1] || '?'
}

/** Model family from an id (opus, sonnet, haiku, fable) or the id itself. */
export function familyOf(model) {
  const m = String(model || '').toLowerCase()
  for (const f of ['fable', 'opus', 'sonnet', 'haiku']) if (m.includes(f)) return f
  return m || '?'
}

/** Price entry for a model id: exact id, then the id without a date suffix, then its family, then the default. */
export function priceFor(model, table) {
  const models = (table && table.models) || {}
  const id = String(model || '')
  if (models[id]) return models[id]
  const undated = id.replace(/-\d{8}$/, '')
  if (models[undated]) return models[undated]
  const fam = table && table.families && table.families[familyOf(id)]
  if (fam && models[fam]) return models[fam]
  return models[(table && table.default) || ''] || { in: 0, out: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 }
}

/** List-price cost in USD of one request's tokens. */
export function costOf(v, model, table) {
  let p = priceFor(model, table)
  if (p.above && v[0] + v[2] + v[3] + v[4] > p.above.tokens) p = { ...p, ...p.above }
  return (v[0] * p.in + v[1] * p.out + v[2] * p.cache_read + v[3] * p.cache_write_5m + v[4] * (p.cache_write_1h ?? p.in * 2)) / 1e6
}

/**
 * One usage record from a parsed transcript line, or null. Only assistant rows with a `message.usage` count;
 * `<synthetic>` rows (local notices) are skipped.
 */
export function usageOf(o) {
  if (!o || o.type !== 'assistant') return null
  const m = o.message
  if (!m || typeof m !== 'object' || !m.usage || typeof m.usage !== 'object') return null
  if (!m.model || m.model === '<synthetic>') return null
  const u = m.usage
  const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null
  const cw = Number(u.cache_creation_input_tokens) || 0
  const cw1h = cc ? Number(cc.ephemeral_1h_input_tokens) || 0 : 0
  const cw5 = cc ? Number(cc.ephemeral_5m_input_tokens) || 0 : cw
  const ts = Date.parse(o.timestamp)
  if (!Number.isFinite(ts)) return null
  return {
    key: `${m.id || ''}|${o.requestId || o.uuid || ''}`,
    ts,
    model: m.model,
    v: [Number(u.input_tokens) || 0, Number(u.output_tokens) || 0, Number(u.cache_read_input_tokens) || 0, cw5, cw1h, 1, 0, 0],
    effort: o.effort || o.perTurnEffort || '',
    agent: o.attributionAgent || '',
    skill: o.attributionSkill || '',
    mcp: o.attributionMcpServer || '',
    session: o.sessionId || '',
    cwd: o.cwd || '',
    entrypoint: o.entrypoint || '',
  }
}

/** Fresh per-file state: what the incremental scanner keeps for each transcript. */
export const newFileState = (kind = 'main') => ({
  kind, offset: 0, session: '', cwd: '', entrypoint: '', title: '', agent: '', firstOrigin: '', lastTs: 0,
  rows: {}, recent: {}, keys: {},
})

const RECENT = 200

/**
 * Feeds one transcript line into a file state. `claim(key)` says whether this request is new across files
 * (true) or already counted in another file (false); `prices` turns tokens into a list-price cost.
 * Rows are keyed `hourMs|model|effort|skill|mcp|agent`, each a usage vector.
 * The same request repeated in one file (one line per content block) replaces its earlier figures.
 */
export function feedLine(st, line, { prices, claim = () => true, idleGapS = 300 } = {}) {
  if (!line || line.length < 20) return
  const hasUsage = line.includes('"usage"')
  const wantsMeta = (!st.firstOrigin && line.includes('"origin"')) || line.includes('"custom-title"') || line.includes('"agent-name"')
  if (!hasUsage && !wantsMeta) return
  let o
  try {
    o = JSON.parse(line)
  } catch {
    return
  }
  if (o.type === 'custom-title' && o.customTitle) st.title = String(o.customTitle).slice(0, 120)
  if (o.type === 'agent-name' && o.agentName) st.agent = st.agent || String(o.agentName).slice(0, 60)
  if (!st.firstOrigin && o.type === 'user' && o.origin && o.origin.kind) st.firstOrigin = String(o.origin.kind)
  const r = usageOf(o)
  if (!r) return
  st.session = st.session || r.session
  st.cwd = st.cwd || r.cwd
  st.entrypoint = st.entrypoint || r.entrypoint
  if (r.agent && !st.agent) st.agent = r.agent
  const prev = st.recent[r.key]
  if (!prev) {
    if (st.keys[r.key] !== undefined || !claim(r.key)) return // counted already (here, or in another file)
    if (st.lastTs && r.ts > st.lastTs) r.v[V.active_s] = Math.min((r.ts - st.lastTs) / 1000, idleGapS)
    if (r.ts > st.lastTs) st.lastTs = r.ts
  } else {
    // a later line of the same request: drop the earlier figures, keep its active time and message count
    const old = st.rows[prev.row]
    if (old) addInto(old, prev.v, -1)
    r.v[V.active_s] = prev.v[V.active_s]
  }
  r.v[V.cost] = costOf(r.v, r.model, prices)
  const hour = Math.floor(r.ts / HOUR) * HOUR
  const row = `${hour}|${r.model}|${r.effort}|${r.skill}|${r.mcp}|${r.agent}`
  st.rows[row] = addInto(st.rows[row] || zero(), r.v)
  st.recent[r.key] = { row, v: r.v }
  st.keys[r.key] = hour
  const ks = Object.keys(st.recent)
  if (ks.length > RECENT) for (const k of ks.slice(0, ks.length - RECENT)) delete st.recent[k]
}

/** Drops rows and keys older than `fromMs` (retention). */
export function prune(st, fromMs) {
  for (const k of Object.keys(st.rows)) if (Number(k.split('|')[0]) < fromMs) delete st.rows[k]
  for (const [k, h] of Object.entries(st.keys)) if (h < fromMs) delete st.keys[k]
}

/** Whether a main transcript is a sub-conversation: its first prompt came from another session (non vérifié). */
export const isSubConversation = (st, rule = 'peer') => st.kind === 'main' && Boolean(rule) && st.firstOrigin === rule

const pad = n => String(n).padStart(2, '0')
/** Local day key YYYY-MM-DD for a time, `tzMin` minutes east of UTC. */
export function dayKey(ms, tzMin = 0) {
  const d = new Date(ms + tzMin * 60000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

const bump = (map, key, v) => {
  const k = key || '?'
  map[k] = addInto(map[k] || zero(), v)
}

/**
 * Totals over all file states, for the views: hourly global vectors, per-day breakdowns (project, model, kind,
 * surface, skill, mcp, session, effort) for the last `days` days, session labels, and per-(kind, family) totals with
 * active seconds (the measured burn per agent-hour that the scenario estimates use).
 */
export function aggregate(files, { now, tzMin = 0, days = 8, surfaces = {}, subRule = 'peer' } = {}) {
  const from = now - days * 86400000
  const out = { generated: now, tzMin, hourly: {}, hourlyModel: {}, days: {}, sessions: {}, rates: {} }
  for (const st of Object.values(files)) {
    if (st.kind === 'journal') continue
    const kind = isSubConversation(st, subRule) ? 'subconversation' : st.kind
    const surface = surfaces[st.entrypoint] || st.entrypoint || '?'
    const project = projectOf(st.cwd)
    const sid = st.session || '?'
    if (kind === 'main' || kind === 'subconversation') {
      const s = (out.sessions[sid] = out.sessions[sid] || { title: '', project, kind, surface })
      if (st.title) s.title = st.title
    } else if (!out.sessions[sid]) out.sessions[sid] = { title: '', project, kind: 'main', surface }
    for (const [rk, v] of Object.entries(st.rows)) {
      const [h, model, effort, skill, mcp] = rk.split('|')
      const hour = Number(h)
      const fam = familyOf(model)
      const rate = (out.rates[`${kind}|${fam}`] = out.rates[`${kind}|${fam}`] || zero())
      addInto(rate, v)
      bump(out.hourly, String(hour), v)
      if (hour < from) continue
      const hm = (out.hourlyModel[String(hour)] = out.hourlyModel[String(hour)] || {})
      bump(hm, model, v)
      const day = dayKey(hour, tzMin)
      const d = (out.days[day] = out.days[day] || { total: zero(), project: {}, model: {}, kind: {}, surface: {}, skill: {}, mcp: {}, session: {}, effort: {} })
      addInto(d.total, v)
      bump(d.project, project, v)
      bump(d.model, model, v)
      bump(d.kind, kind, v)
      bump(d.surface, surface, v)
      if (skill) bump(d.skill, skill, v)
      if (mcp) bump(d.mcp, mcp, v)
      bump(d.session, sid, v)
      bump(d.effort, effort || '?', v)
    }
  }
  return out
}
