// band mod: the transcript parser, the one piece meant to be swapped for a shared one (mods/usage) later.
// Reads complete JSONL lines of ~/.claude/projects/<project>/<session>.jsonl and of its subagent files
// (<session>/subagents/agent-<id>.jsonl, <session>/subagents/workflows/<wf>/agent-<id>.jsonl) into events (one per API
// response, deduplicated by message id: a response split over several entries repeats its usage) and session facts
// (cwd, title, last activity, main-thread context, compactions). Pure: the scanner does the file I/O.
import type { Compaction, Ev, SessionMeta } from './logic'

export type FileKind = { s: string; a?: string; w?: string }
export type FileState = { lastTs?: number; pendingCompact?: boolean }

/** Which session (and agent, workflow) a transcript path belongs to, from its path under the projects root. */
export const classifyPath = (rel: string): FileKind | undefined => {
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean)
  const base = (parts.at(-1) ?? '').replace(/\.jsonl$/, '')
  if (!parts.at(-1)?.endsWith('.jsonl')) return undefined
  if (parts.length === 2) return { s: base }
  if (parts.length === 4 && parts[2] === 'subagents') return { s: parts[1], a: base.replace(/^agent-/, '') }
  if (parts.length === 6 && parts[2] === 'subagents' && parts[3] === 'workflows') return { s: parts[1], w: parts[4], a: base.replace(/^agent-/, '') }
  return undefined
}

export const emptyMeta = (s: string): SessionMeta => ({ s, last: 0, compactions: [], samples: [] })

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

/**
 * Parses complete lines (text that ends at a newline) of one file. Appends to `events` (replacing a duplicate response
 * already there), updates `meta` and the per-file `state`. Returns how many lines were read.
 */
export const parseLines = (text: string, kind: FileKind, state: FileState, meta: SessionMeta, events: Ev[], keepFrom: number) => {
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

    if (o.type === 'assistant' && o.message?.usage && Number.isFinite(ts)) {
      const u = o.message.usage
      const usage = { inp: num(u.input_tokens), cw: num(u.cache_creation_input_tokens), cr: num(u.cache_read_input_tokens), out: num(u.output_tokens) }
      const id: string | undefined = o.message.id ?? o.requestId
      if (isMain && !o.isSidechain) {
        const ctx = usage.inp + usage.cw + usage.cr
        if (ctx > 0) {
          meta.ctx = ctx
          meta.ctxT = ts
          if (ts >= keepFrom) {
            const last = meta.samples.at(-1)
            if (last && last[0] === ts) last[1] = ctx
            else meta.samples.push([ts, ctx])
          }
        }
        if (typeof o.message.model === 'string' && !o.message.model.startsWith('<')) meta.model = o.message.model
      }
      if (ts >= keepFrom) {
        let dup = -1
        if (id) {
          for (let i = events.length - 1, k = 0; i >= 0 && k < 400; i--, k++) {
            const e = events[i]
            if (e.id === id && e.s === kind.s && e.a === kind.a) {
              dup = i
              break
            }
          }
        }
        if (dup >= 0) {
          const p = events[dup].u
          events[dup].u = { inp: Math.max(p.inp, usage.inp), cw: Math.max(p.cw, usage.cw), cr: Math.max(p.cr, usage.cr), out: Math.max(p.out, usage.out) }
        } else {
          events.push({
            t: ts,
            s: kind.s,
            ...(kind.a ? { a: kind.a } : {}),
            ...(kind.w ? { w: kind.w } : {}),
            m: typeof o.message.model === 'string' ? o.message.model : '?',
            ...(id ? { id } : {}),
            u: usage,
          })
        }
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
