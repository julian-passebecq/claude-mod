// band mod: the transcript parser. Usage figures per line come from the shared parser of mods/usage
// (lib/transcripts.mjs usageOf: dedupe key, <synthetic> rows skipped, 1-hour cache writes) when the scanner finds it
// beside this mod; `ownUsage` below is the fallback for a band installed alone. This file adds what band alone needs:
// compactions, titles, cwd and the main thread's context. Reads complete JSONL lines of ~/.claude/projects/<project>/<session>.jsonl and of its subagent files
// (<session>/subagents/agent-<id>.jsonl, <session>/subagents/workflows/<wf>/agent-<id>.jsonl) into events (one per API
// response, deduplicated by message id: a response split over several entries repeats its usage) and session facts
// (cwd, title, last activity, main-thread context, compactions). Pure: the scanner does the file I/O.
import type { Compaction, Ev, SessionMeta } from './logic'

export type FileKind = { s: string; a?: string; w?: string }
export type FileState = { lastTs?: number; pendingCompact?: boolean }
/** One line's usage, in mods/usage's shape: v = [input, output, cache read, cache write 5m, cache write 1h, ...]. */
export type UsageRecord = { key: string; ts: number; model: string; v: number[] }
export type Extract = (o: any) => UsageRecord | null

/** Which session (and agent, workflow) a transcript path belongs to, from its path under the projects root. */
export const classifyPath = (rel: string): FileKind | undefined => {
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean)
  const base = (parts.at(-1) ?? '').replace(/\.jsonl$/, '')
  if (!parts.at(-1)?.endsWith('.jsonl')) return undefined
  if (base === 'journal') return undefined
  if (parts.length === 2) return { s: base }
  if (parts.length === 4 && parts[2] === 'subagents') return { s: parts[1], a: base.replace(/^agent-/, '') }
  if (parts.length === 6 && parts[2] === 'subagents' && parts[3] === 'workflows') return { s: parts[1], w: parts[4], a: base.replace(/^agent-/, '') }
  return undefined
}

export const emptyMeta = (s: string): SessionMeta => ({ s, last: 0, compactions: [], samples: [] })

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

/** Fallback for mods/usage's usageOf: same record from an assistant row with message.usage. */
export const ownUsage: Extract = o => {
  if (!o || o.type !== 'assistant' || !o.message?.usage || !o.message.model || o.message.model === '<synthetic>') return null
  const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
  if (!Number.isFinite(ts)) return null
  const u = o.message.usage
  const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null
  const cw = num(u.cache_creation_input_tokens)
  const cw1h = cc ? num(cc.ephemeral_1h_input_tokens) : 0
  return { key: `${o.message.id || ''}|${o.requestId || o.uuid || ''}`, ts, model: o.message.model, v: [num(u.input_tokens), num(u.output_tokens), num(u.cache_read_input_tokens), cc ? num(cc.ephemeral_5m_input_tokens) : cw, cw1h] }
}

/**
 * Parses complete lines (text that ends at a newline) of one file. Appends to `events` (replacing a duplicate response
 * already there), updates `meta` and the per-file `state`. Returns how many lines were read.
 */
export const parseLines = (
  text: string,
  kind: FileKind,
  state: FileState,
  meta: SessionMeta,
  events: Ev[],
  keepFrom: number,
  extract: Extract = ownUsage,
) => {
  let n = 0
  const isMain = !kind.a
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let o: any
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    n++
    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
    if (Number.isFinite(ts)) {
      if (state.pendingCompact) {
        const c = meta.compactions.at(-1)
        if (c) {
          c.t = ts
          if (state.lastTs) c.gapMin = Math.max(0, (ts - state.lastTs) / 60000)
        }
        state.pendingCompact = false
      }
    }
    if (isMain && typeof o.cwd === 'string') meta.cwd = o.cwd
    if (o.type === 'custom-title' && typeof o.customTitle === 'string' && isMain) meta.title = o.customTitle
    else if (o.type === 'agent-name' && typeof o.agentName === 'string' && isMain && !meta.title) meta.title = o.agentName

    if (o.type === 'system' && o.subtype === 'compact_boundary') {
      const m = o.compactMetadata ?? {}
      const c: Compaction = {
        t: Number.isFinite(ts) ? ts : (state.lastTs ?? 0),
        trigger: typeof m.trigger === 'string' ? m.trigger : '?',
        ...(typeof m.preTokens === 'number' ? { pre: m.preTokens } : {}),
        ...(typeof m.postTokens === 'number' ? { post: m.postTokens } : {}),
        ...(kind.a ? { a: kind.a } : {}),
      }
      if (Number.isFinite(ts) && state.lastTs) c.gapMin = Math.max(0, (ts - state.lastTs) / 60000)
      if (!Number.isFinite(ts)) state.pendingCompact = true
      meta.compactions.push(c)
      if (isMain && c.post !== undefined) {
        meta.ctx = c.post
        meta.ctxT = Number.isFinite(ts) ? ts : state.lastTs
      }
    }

    const r = o.type === 'assistant' ? extract(o) : null
    if (r) {
      const usage = { inp: r.v[0] ?? 0, out: r.v[1] ?? 0, cr: r.v[2] ?? 0, cw: (r.v[3] ?? 0) + (r.v[4] ?? 0), ...(r.v[4] ? { cw1h: r.v[4] } : {}) }
      const id = r.key
      if (isMain && !o.isSidechain) {
        const ctx = usage.inp + usage.cw + usage.cr
        if (ctx > 0) {
          meta.ctx = ctx
          meta.ctxT = r.ts
          if (r.ts >= keepFrom) {
            const last = meta.samples.at(-1)
            if (last && last[0] === r.ts) last[1] = ctx
            else meta.samples.push([r.ts, ctx])
          }
        }
        meta.model = r.model
      }
      if (r.ts >= keepFrom) {
        let dup = -1
        for (let i = events.length - 1, k = 0; i >= 0 && k < 400; i--, k++) {
          const e = events[i]
          if (e.id === id && e.s === kind.s && e.a === kind.a) {
            dup = i
            break
          }
        }
        if (dup >= 0) events[dup].u = usage // a later line of the same response carries its final figures
        else events.push({ t: r.ts, s: kind.s, ...(kind.a ? { a: kind.a } : {}), ...(kind.w ? { w: kind.w } : {}), m: r.model, id, u: usage })
      }
    }
    if (Number.isFinite(ts)) {
      state.lastTs = ts
      if (ts > meta.last) meta.last = ts
    }
  }
  return n
}

/** Drops what is older than `keepFrom` (events, samples); compactions are kept for `compactFrom`. */
export const prune = (events: Ev[], sessions: Record<string, SessionMeta>, keepFrom: number, compactFrom: number) => {
  const kept = events.filter(e => e.t >= keepFrom)
  for (const [s, m] of Object.entries(sessions)) {
    m.samples = m.samples.filter(([t]) => t >= keepFrom)
    m.compactions = m.compactions.filter(c => c.t >= compactFrom)
    if (m.last < compactFrom) delete sessions[s]
  }
  return kept
}
