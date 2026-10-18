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
 * The key an API response is counted once under: message.id + requestId. Every content block of one response is a
 * separate transcript line with its own uuid but the same message.id, and a fork, a resume or a subagent file can
 * repeat the same response, so the uuid is used only when the line has no message.id at all.
 */
export function keyOf(o) {
  const m = (o && o.message) || {}
  if (m.id) return `${m.id}|${o.requestId || ''}`
  return `|${o.requestId || o.uuid || o.timestamp || ''}`
}

/** Timestamp (ms) of a raw transcript line without parsing it, or 0. Only an unescaped top-level key matches. */
export function lineTs(line) {
  const i = line.indexOf('"timestamp":"')
  if (i < 0) return 0
  const t = Date.parse(line.slice(i + 13, line.indexOf('"', i + 13)))
  return Number.isFinite(t) ? t : 0
}

/** Whether a raw line sends a request (a prompt or a tool result): only those start a stream. Bookkeeping lines (queue,
 * hooks, PR links, titles, attachments) can be written at any time, even while a response streams. */
const sendsRequest = line => line.slice(0, 400).includes('"type":"user"')

/**
 * Output speed. One stream = one API response: it starts at the last transcript line written before its first
 * content block (the prompt or tool result that sent it) and ends at its last content block, so the time includes the
 * wait for the first token. TPS = output tokens (thinking included) / that time. Per hour, model and effort the state
 * keeps [output tokens, ms, streams, {bucket: streams}]; buckets are geometric (x1.15 from 1 tok/s) for the median
 * and the range. Streams under TPS_MIN_OUT output tokens or longer than TPS_MAX_MS are left out (latency or a pause,
 * not speed).
 */
export const TPS_MIN_OUT = 50
export const TPS_MAX_MS = 30 * 60000
const TPS_STEP = Math.log(1.15)
export const tpsBucket = tps => Math.max(0, Math.floor(Math.log(Math.max(tps, 1)) / TPS_STEP))
export const tpsOfBucket = b => Math.exp((b + 0.5) * TPS_STEP)
/** Adds (sign 1) or removes (sign -1) one stream in a TPS row [out, ms, n, hist]. */
export function tpsAdd(row, out, ms, sign = 1) {
  row[0] += sign * out
  row[1] += sign * ms
  row[2] += sign
  const b = tpsBucket(out / (ms / 1000))
  row[3][b] = (row[3][b] || 0) + sign
  if (!row[3][b]) delete row[3][b]
  return row
}
const STREAMS_KEPT = 10
/** Besides the last STREAMS_KEPT, a file keeps every stream of the hour before its newest (at most STREAMS_HOUR_MAX):
 * the exact streams behind the Panneau's « 30 min » row (cockpit Débit). */
export const STREAMS_HOUR_MS = HOUR
const STREAMS_HOUR_MAX = 400

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
    key: keyOf(o),
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
  rows: {}, recent: {}, keys: {}, lineTs: 0, tps: {}, streams: [],
})

const RECENT = 200

/** Puts one stream's timing in the file state, replacing what an earlier line of the same response gave. */
function timeStream(st, r, rec) {
  st.tps = st.tps || {}
  st.streams = st.streams || []
  if (rec.t) {
    const old = st.tps[rec.t.row]
    if (old) {
      tpsAdd(old, rec.t.out, rec.t.ms, -1)
      if (old[2] <= 0) delete st.tps[rec.t.row]
    }
  }
  const out = r.v[V.out]
  const ms = r.ts - rec.start
  rec.t = null
  const i = st.streams.findIndex(x => x.k === r.key)
  if (i >= 0) st.streams.splice(i, 1)
  if (!(rec.start > 0) || ms <= 0 || ms > TPS_MAX_MS || out < TPS_MIN_OUT) return
  const row = `${Math.floor(rec.start / HOUR) * HOUR}|${r.model}|${r.effort}`
  tpsAdd((st.tps[row] = st.tps[row] || [0, 0, 0, {}]), out, ms)
  rec.t = { row, out, ms }
  st.streams.push({ k: r.key, ts: r.ts, model: r.model, effort: r.effort, out, ms })
  while (st.streams.length > STREAMS_KEPT && (st.streams.length > STREAMS_HOUR_MAX || st.streams[0].ts < r.ts - STREAMS_HOUR_MS)) st.streams.shift()
}

/**
 * Feeds one transcript line into a file state. `claim(key)` says whether this response is new across files
 * (true) or already counted in another file (false); `prices` turns tokens into a list-price cost.
 * Rows are keyed `hourMs|model|effort|skill|mcp|agent`, each a usage vector.
 * The same response repeated in one file (one line per content block) replaces its earlier figures.
 */
export function feedLine(st, line, { prices, claim = () => true, idleGapS = 300 } = {}) {
  if (!line || line.length < 20) return
  const hasUsage = line.includes('"usage"')
  const wantsMeta = (!st.firstOrigin && line.includes('"origin"')) || line.includes('"custom-title"') || line.includes('"agent-name"')
  const ts = lineTs(line)
  if (!hasUsage && !wantsMeta) {
    if (ts && sendsRequest(line)) st.lineTs = ts
    return
  }
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
  const before = st.lineTs || 0
  if (ts && (r || o.type === 'user')) st.lineTs = ts
  if (!r) return
  st.session = st.session || r.session
  st.cwd = st.cwd || r.cwd
  st.entrypoint = st.entrypoint || r.entrypoint
  if (r.agent && !st.agent) st.agent = r.agent
  const prev = st.recent[r.key]
  let start = before
  if (!prev) {
    if (st.keys[r.key] !== undefined || !claim(r.key)) return // counted already (here, or in another file)
    if (st.lastTs && r.ts > st.lastTs) r.v[V.active_s] = Math.min((r.ts - st.lastTs) / 1000, idleGapS)
    if (r.ts > st.lastTs) st.lastTs = r.ts
  } else {
    // a later line of the same response: drop the earlier figures, keep its active time and message count
    const old = st.rows[prev.row]
    if (old) addInto(old, prev.v, -1)
    r.v[V.active_s] = prev.v[V.active_s]
    start = prev.start
  }
  r.v[V.cost] = costOf(r.v, r.model, prices)
  const hour = Math.floor(r.ts / HOUR) * HOUR
  const row = `${hour}|${r.model}|${r.effort}|${r.skill}|${r.mcp}|${r.agent}`
  st.rows[row] = addInto(st.rows[row] || zero(), r.v)
  const rec = { row, v: r.v, start, t: prev ? prev.t : null }
  timeStream(st, r, rec)
  delete st.recent[r.key]
  st.recent[r.key] = rec
  st.keys[r.key] = hour
  const ks = Object.keys(st.recent)
  if (ks.length > RECENT) for (const k of ks.slice(0, ks.length - RECENT)) delete st.recent[k]
}

/** Drops rows and keys older than `fromMs` (retention). */
export function prune(st, fromMs) {
  for (const k of Object.keys(st.rows)) if (Number(k.split('|')[0]) < fromMs) delete st.rows[k]
  for (const k of Object.keys(st.tps || {})) if (Number(k.split('|')[0]) < fromMs) delete st.tps[k]
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
  const out = { generated: now, tzMin, hourly: {}, hourlyModel: {}, days: {}, sessions: {}, rates: {}, tps: {}, streams: [], tpsHourly: {}, recentStreams: [] }
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
    for (const [rk, t] of Object.entries(st.tps || {})) {
      const [h, model, effort] = rk.split('|')
      if (Number(h) < from) continue
      for (const row of [(out.tps[`${model}|${effort}`] = out.tps[`${model}|${effort}`] || [0, 0, 0, {}]), (out.tpsHourly[rk] = out.tpsHourly[rk] || [0, 0, 0, {}])]) {
        row[0] += t[0]
        row[1] += t[1]
        row[2] += t[2]
        for (const [b, n] of Object.entries(t[3])) row[3][b] = (row[3][b] || 0) + n
      }
    }
    for (const x of st.streams || []) {
      if (x.ts < from) continue
      const one = { ts: x.ts, model: x.model, effort: x.effort, out: x.out, ms: x.ms, kind, project, session: sid }
      out.streams.push(one)
      if (x.ts >= now - STREAMS_HOUR_MS) out.recentStreams.push(one)
    }
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
  out.streams = out.streams.sort((a, b) => b.ts - a.ts).slice(0, STREAMS_KEPT * 3)
  // tpsHourly: the same TPS rows per `hour|model|effort`, so a reader can cut its own windows (cockpit's Débit);
  // recentStreams: every stream of the last hour, newest first
  out.recentStreams = out.recentStreams.sort((a, b) => b.ts - a.ts).slice(0, 4000)
  return out
}
