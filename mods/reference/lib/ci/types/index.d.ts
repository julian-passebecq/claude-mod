// Shapes of the JSON that scanner/ci.py prints (`show`) and the `$.state` values of the ci mod.

export type Tri = 'yes' | 'no' | 'unknown'
export type Check = {
  id: string
  /** presence only, never a value: source is 'env:NAME', 'gh', 'glab' or '' */
  token: { present: Tri; source: string }
  runners: { online: number; offline: number; total: number } | null
  jobs: { running: number | null; pending: number | null } | null
  actions: { repo: string; actions: Tri; why: string }[]
  usable: Tri
  why: string
}
export type Backend = {
  id: string
  label: string
  kind: 'github' | 'gitlab'
  host: string
  runner_tag: string
  status: 'active' | 'coming-soon' | 'disabled'
  notes: string
  group?: string
  concurrent?: number | string
  minutes_month?: number
  check: Check | null
}
export type Route = { key: string; kind: 'repo' | 'session'; backend: string; set_by: string; set_at: string }
export type Labels = {
  title?: string
  backends?: string
  routes?: string
  here?: string
  no_route?: string
  usable?: Partial<Record<Tri, string>>
  status?: Record<string, string>
  colors?: Record<string, string>
}
export type Snapshot = {
  generated: string | null
  stale: boolean
  config: string
  routing_file: string
  labels: Labels
  options: { status_line: boolean; prompt_note: boolean }
  backends: Backend[]
  routes: Route[]
  current: (Route & { match: 'repo' | 'session' }) | null
}

// ---- Diagramme view: `ci.py pipelines` (scanner/pipelines.py)
export type RunStatus = 'success' | 'failed' | 'running' | 'queued' | 'cancelled' | 'skipped'
export type Who = 'claude' | 'codex' | 'unknown'
export type Job = {
  id?: number | string | null
  name: string
  stage: string
  status: RunStatus
  duration_s: number | null
  queued_s?: number | null
  created?: string | null
  started?: string | null
  finished?: string | null
  url?: string
  /** GitLab allow_failure: a red job that does not make the pipeline red (shown orange, never red) */
  allow_failure?: boolean
}
export type JobEstimate = { n: number; median_s: number | null; start: string | null; end: string | null; samples_s?: number[] }
export type Estimate = {
  eta: string | null
  basis: 'jobs' | 'pipeline' | null
  samples: number
  jobs: Record<string, JobEstimate>
  reason?: string
  /** successful durations of the lane's last pipelines (basis pipeline, or too few) */
  durations_s?: number[]
}
export type Conv = { id: string; title: string; project: string; pr?: string }
export type Run = {
  forge: 'github' | 'gitlab'
  slug: string
  backend: string
  host_inferred?: boolean
  id: number | string
  url: string
  branch: string
  sha: string
  event: string
  title: string
  workflow: string
  status: RunStatus
  created: string | null
  duration_s: number | null
  queued_s: number | null
  jobs: Job[] | null
  mr: number | null
  app: string
  who: Who
  who_from?: 'conversation'
  conv: Conv | null
  /** only for running or queued pipelines */
  estimate?: Estimate | null
  host?: string
}
export type App = { app: string; path: string; github: string | null; gitlab: string[]; fetched: boolean; runs: Run[] }
export type Stats = { runs: number; success: number; failed: number; running: number; pass_rate: number | null; minutes: number }
export type Summary = {
  today: Stats
  week: Stats
  by_host: (Stats & { key: string })[]
  by_who: (Stats & { key: string })[]
  by_app: (Stats & { key: string })[]
  queue: { backend: string; label: string; tag: string; running: number | null; pending: number | null; runners_online: number | null; pipelines_open: number
    concurrent?: number | null; wait_s?: number | null; wait_n?: number } | null
}
export type DiagramLabels = Partial<Record<
  'tab_routing' | 'tab_diagram' | 'all' | 'claude' | 'codex' | 'unknown' | 'by_host' | 'by_app' | 'by_conv' | 'no_conv' |
  'today' | 'week' | 'pass_rate' | 'minutes' | 'queue' | 'last_runs' | 'no_runs' | 'not_fetched', string>> & {
  status?: Partial<Record<RunStatus, string>>
}
export type Diagram = {
  generated: string | null
  stale: boolean
  hosts: { id: string; label: string; kind: string; runner_tag: string; status: string }[]
  labels: DiagramLabels
  colors?: Partial<Record<RunStatus, string>>
  svg_colors?: Record<string, string>
  summary: Summary | null
  apps: App[]
  conversations: (Conv & { runs: number })[]
}
export type WhoFilter = 'all' | Who
export type GroupBy = 'host' | 'app' | 'conv'

declare module 'claude-code' {
  interface PluginState {
    ci: {
      /** which tab of the pane shows: CI routing or the pipeline diagram */
      tab: 'routing' | 'diagram'
      /** last `ci.py pipelines` output as JSON text ('' before the first read) */
      diagram: string
      /** a pipelines fetch (gh/glab) is running */
      fetching: boolean
      /** Diagramme filters: who made the run, and how lanes are grouped */
      who: WhoFilter
      group: GroupBy
      /** keys of the Diagramme sections folded by the viewer; `gantt:<lane>` keys are lanes unfolded to their Gantt */
      folded: string[]
      /** last `ci.py show` output as JSON text ('' before the first read) */
      snapshot: string
      /** a status check (network) is running */
      checking: boolean
      /** last error line from ci.py, '' when fine */
      error: string
    }
  }
}
