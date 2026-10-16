// Shapes of the JSON the scanner writes (scanner/control_scan.py) and the `$.state` values of the control mod.

export type Flag = { kind: string; text: string }
export type SetupItem = {
  name: string
  path: string
  exists: boolean
  size: number | null
  changed: string | null
  what: string
  flags: Flag[]
  hidden: boolean
  section?: string
}
export type SetupSection = { id: string; title: string; items: SetupItem[] }
export type SetupData = {
  generated: string
  rules_version: string
  sections: SetupSection[]
  hidden: SetupItem[]
  /** hooks, mod deny paths, blocking scripts, permission deny rules (V5 expects none active) */
  blockers?: SetupItem[]
  active_blockers?: number
  counts: Record<string, number>
}

export type MetricState = 'green' | 'amber' | 'red' | 'info' | 'none'
export type Metric = {
  id: string
  label: string
  unit: string
  value: number | null
  detail: string
  state: MetricState
  target: string
  rule: string
}
export type ModelRow = {
  model: string
  turns: number
  main: number
  sub: number
  out: number
  cache_in: number
  usd: number
  usd_main: number
  usd_sub: number
}
export type Summary = {
  turns: number
  usd: number
  models: ModelRow[]
  efforts: { key: string; turns: number; usd: number }[]
  projects: { project: string; turns: number; usd: number }[]
  main_turns: number
  sub_turns: number
  agent: {
    total: number
    with_model: number
    no_model: number
    background: number
    worktree: number
    types: [string, number][]
    models: Record<string, number>
  }
  workflow: { runs: number; agent_calls: number; with_model: number; models: Record<string, number> }
  tools: Record<string, number>
  context: Record<string, number>
  readonly: Record<string, number>
}
export type UsageWindow = {
  id: string
  label: string
  from: string
  to: string
  days: number
  summary: Summary
  metrics: Metric[]
}
export type UsageData = { generated: string; files: number; rescanned: number; windows: UsageWindow[] }

export type Practice = {
  id: string
  title: string
  rule_line: string
  in_rules: boolean
  state: string
  metrics: string[]
  evidence: string[]
}
export type PracticesData = {
  generated: string
  window: string | null
  rules_version: string
  practices: Practice[]
  best: string[]
  worst: string[]
  audit_right: string[]
  audit_wrong: string[]
  /** docs/PRACTICES.md and docs/HISTORY.md as read at scan time */
  reference_md: string
  history_md: string
}

declare module 'claude-code' {
  interface PluginState {
    control: {
      /** bumped after a scan so every pane re-reads its file */
      tick: number
      /** a scan is running (started by /control or a Rescan button) */
      scanning: boolean
      /** last scan's error line, '' when it went fine */
      error: string
      /** USAGE window id: 1d, 7d, 30d or ref */
      window: string
      /** SETUP section shown in full ('' = hidden rules and section heads only) */
      section: string
      /** PRACTICES pane shows docs/PRACTICES.md in full */
      showReference: boolean
    }
  }
}
