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
  /** the last PR/MR the app linked to this conversation (transcript entry type "pr-link") */
  pr?: { number: number; url?: string }
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
  conv?: {
    ctx?: number
    ctxT?: number
    growthTpm?: number
    last?: number
    title?: string
    /** its agents seen in the kept window: running = wrote within sections.running_s; the running Workflow's id */
    agents?: { running: number; total: number; workflow?: string }
    pr?: { number: number; url?: string }
  }
  /** the whole PC: agents running (wrote within sections.running_s), conversations active (within jauge.active_s) */
  pc?: { agents: number; convs: number }
  /** Codex's quota windows from the usage mod's data folder (lib/core/usage.mjs readQuotas), % used */
  codex?: { five?: number; week?: number }
  /** Claude's quota windows from the same folder, used when the engine gives no rate limits */
  /** fiveProj / weekProj: % projected at the window's reset at the current pace (usage mod's samples), when known */
  claude?: { five?: number; week?: number; fiveProj?: number; weekProj?: number }
  /** machine load: CPU % between two scans (os.cpus), GPU % (nvidia-smi or the Windows 3D-engine counter) */
  machine?: { cpu?: number; gpu?: number }
  files: number
  ms: number
  /** where the per-line usage and the prices came from: "lib/core" (shared, the mod's synced copy) or "band" (fallback) */
  lib: string
  /** « À toi : N » and « attend Julian : N », counted once by lib/core/veille.mjs (readVeille) in the scanner */
  waiting?: { aToi: number; julian: number; available: boolean; aToiAvailable: boolean }
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
  /** every rate limit the account reports (five_hour, seven_day, ...), with when it resets */
  limits?: { kind: string; percentUsed: number; resetsAt?: string }[]
  /** this session's cost from the engine ($.session.usage().cost.usd) */
  cost?: number
  /** this session's model ($.session.model()) and effort (CLAUDE_EFFORT, when the engine sets it) */
  model?: string
  effort?: string
  at: number
}

/** The compact band's folding: the sections list unfolded under line 1, and which sections are open. */
export type BandUi = { expanded: boolean; open: string[] }

/** The hand-off helper's state in this session. */
export type HandoffState = {
  /** the RESUME file found (mtime set), or the first place looked when absent (no mtime) */
  resume?: { path: string; mtime?: number }
  /** when the hand-off command ran in this session (ms), from the button or typed */
  ran: number[]
  /** this conversation's start ($.session.usage().startedAt) */
  startedAt?: number
  /** the RESUME preview is shown in the pane */
  show: boolean
  /** its text (cut at preview_chars) */
  text?: string
}

/** One agent of the « en cours » rows (a Workflow agent, or an Agent-tool agent outside Workflows). */
export type EnCoursAgent = { id: string; label?: string; type?: string; model?: string; status: string; start?: number; last?: number; stalled?: boolean; shape?: string; phase?: string }
/** A running (or just failed) Workflow of this conversation. */
export type EnCoursWorkflow = { id: string; name: string; phases: string[]; phase?: string; phaseIdx?: number; status: string; start?: number; last?: number; stalled?: boolean; agents: EnCoursAgent[]; eta?: number; overrun?: boolean }
export type EnCours = { now?: number; workflows?: EnCoursWorkflow[]; agents?: EnCoursAgent[] }

declare module 'claude-code' {
  interface PluginState {
    band: {
      /** what runs in THIS conversation (scanner/encours.mjs): the Jauge's « en cours » rows; null before the first read */
      encours: EnCours | null
      /** last scanner result */
      view: View | null
      /** this conversation's context and rate-limit figures */
      engine: EngineFigures | null
      /** last scanner error line, '' when fine */
      error: string
      /** the Mods button bar: slash commands seen in this session ($.command.list()) and the mods it opened */
      launcher: { commands: { name: string; plugin?: string }[]; open: string[] }
      /** the hand-off helper: RESUME found (path, mtime), /handoff runs seen in this session, the RESUME preview */
      handoff: HandoffState
      /** the compact band's folding (remembered in $.store under "sections" when sections.remember is "store") */
      ui: BandUi
      /** when each stamped button (Exporter) last ran, by its open-state key (ms); kept in $.store under "stamps" */
      stamps: Record<string, number>
    }
  }
}
