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

declare module 'claude-code' {
  interface PluginState {
    ci: {
      /** last `ci.py show` output as JSON text ('' before the first read) */
      snapshot: string
      /** a status check (network) is running */
      checking: boolean
      /** last error line from ci.py, '' when fine */
      error: string
    }
  }
}
