// Types of the band mod (Jauge): the view scanner/scan.mjs prints (hooks/logic.ts buildView) and the `$.state` values.
// Self-contained, as a mod contract must be; hooks/logic.ts and hooks/parse.ts take their shapes from here.

/** Tokens of one response: input, cache write (all of it; cw1h its 1-hour part), cache read, output. */
export type Usage = { inp: number; cw: number; cr: number; out: number; cw1h?: number }

/** One API response: t ms, main session id, agent id (subagent or Workflow agent), workflow id, model, usage. */
export type Ev = { t: number; s: string; a?: string; w?: string; m: string; id?: string; u: Usage }

export type Compaction = {
  t: number
  /** compactMetadata.trigger as written ("auto", "manual", ...); "?" when the entry has none */
  trigger: string
  pre?: number
  post?: number
  /** minutes between the entry before the boundary and the boundary (inactive time) */
  gapMin?: number
  /** subagent / Workflow agent id when the compaction is an agent's own transcript */
  a?: string
}

export type SessionMeta = {
  s: string
  cwd?: string
  repo?: string
  title?: string
  /** last entry seen, any file of the session (ms) */
  last: number
  /** main thread: input side of the last response (input + cache write + cache read) and when */
  ctx?: number
  ctxT?: number
  model?: string
  compactions: Compaction[]
  /** main thread [t, ctx] samples within the kept window */
  samples: [number, number][]
}

export type CountMode = 'fresh' | 'all'

export type ScopeId = 'conv' | 'conv_all' | 'agents' | 'workflows' | 'project' | 'all'

export type Rate = { w: number; tokens: number; tps: number; tpm: number; tph: number; usdPerH: number; calls: number }

export type ScopeRow = { id: ScopeId; rates: Rate[]; spark: number[] }

export type TopRow = {
  s: string
  title: string
  repo: string
  tps: number
  usdPerH: number
  ctx?: number
  compactions: number
  lastCompact?: number
  last: number
  isThis: boolean
}

export type CompactRow = { s: string; title: string; repo: string; isThis: boolean; items: Compaction[] }

export type View = {
  now: number
  windows: number[]
  spark_min: number
  bucket_s: number
  count: CountMode
  repo?: string
  scopes: ScopeRow[]
  top: TopRow[]
  projects: { repo: string; tps: number; usdPerH: number; sessions: number }[]
  compactions: CompactRow[]
  marks: { conv: number[]; project: number[]; all: number[] }
  conv?: { ctx?: number; ctxT?: number; growthTpm?: number; last?: number; title?: string }
  files: number
  ms: number
  /** where the per-line usage and the prices came from: "mods/usage/lib" (shared) or "band" (fallback) */
  lib: string
}

/** This conversation's figures from the engine ($.session.usage / session.measure). */
export type EngineFigures = {
  tokens?: number
  window?: number
  percent?: number
  /** context.breakdown.autoCompactThreshold (summary breakdown, counted locally) */
  autoCompactThreshold?: number
  /** rateLimits seven_day percentUsed, when the account reports it */
  week?: number
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    band: {
      /** last scanner result */
      view: View | null
      /** this conversation's context and rate-limit figures */
      engine: EngineFigures | null
      /** last scanner error line, '' when fine */
      error: string
    }
  }
}
