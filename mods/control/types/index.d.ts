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
export type ModInfo = {
  name: string
  version: string
  path: string
  /** loaded = in CLAUDE_CODE_PLUGIN_DIRS; installed = folder found, not loaded; shadowed = installed copy of a mod loaded
   * from another folder; dev = desktop dev-mod; missing = listed, no folder */
  state: 'loaded' | 'installed' | 'shadowed' | 'dev' | 'missing'
  sources: string[]
  description: string
}
export type LiveRules = {
  /** first line of ~/.claude/CLAUDE.md, e.g. 'Claude Control V5.8 (15 Oct 2026)' */
  title: string
  /** '5.8', '' when the title has no version */
  version: string
  label: string
  claude_md: string
  changed: string | null
  sections: number
  /** settings.json env names (values never written except config secrets.show_values) */
  env_names: string[]
  settings_hooks: number
  agents: number
  skills: number
  workflows: number
  mods_loaded: number
  mods_total: number
}
export type SetupData = {
  generated: string
  rules_version: string
  live?: LiveRules
  mods?: { items: ModInfo[]; settings_dirs: number; env_dirs: number; differ: boolean }
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
export type UsageData = {
  generated: string
  files: number
  rescanned: number
  rules_version?: string
  version?: string
  windows: UsageWindow[]
}

export type Evidence = { kind: 'cite' | 'practices' | 'metric' | 'setup'; text: string; state: string }
export type RuleLine = { text: string; evidence: Evidence[]; state: string; metrics: string[] }
export type RuleSection = { num: string; title: string; heading: string; lines: RuleLine[]; state: string; evidence: number }
export type V6Changes = {
  state: 'pending' | 'none' | 'no_repo'
  source?: string
  repo?: string
  title?: string
  groups?: Record<string, { count: number; items: string[] }>
}
export type PracticesData = {
  generated: string
  window: string | null
  rules_version: string
  version?: string
  label?: string
  /** one per heading of the live CLAUDE.md */
  sections: RuleSection[]
  v6?: V6Changes
  best: string[]
  worst: string[]
  audit_right: string[]
  audit_wrong: string[]
  /** docs/PRACTICES.md and docs/HISTORY.md as read at scan time */
  reference_md: string
  history_md: string
}

/** One leaf of the CONFIG tree (scanner/config_scan.py). Its full text is in content shard `shard` under `id`. */
export type ConfigItem = {
  id: string
  name: string
  path: string
  exists: boolean | null
  size: number | null
  mtime: number | null
  changed: string | null
  /** md = Markdown, json = masked JSON, text = plain, none = no content (fields only) */
  kind: 'md' | 'json' | 'text' | 'none'
  chars: number
  meta: [string, string][]
  summary: string
  flags: Flag[]
  badge: string
  shard: number | null
}
export type ConfigSub = { id: string; title: string; items: ConfigItem[] }
export type ConfigCategory = { id: string; title: string; count: number; badge: string; subs: ConfigSub[] }
export type ConfigChange = { id: string; name: string; path: string; changed: string; mtime: number; where: string }
export type ConfigData = {
  generated: string
  project: string
  categories: ConfigCategory[]
  changes: ConfigChange[]
  changes_days: number
  shards: string[]
  counts: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    control: {
      /** CONFIG: open categories, sub-categories and the Changes list ('cat:rules', 'sub:rules.global', 'changes') */
      cfgOpen: string[]
      /** CONFIG: the item whose detail and content are shown ('' = none) */
      cfgItem: string
      /** CONFIG: search box text */
      cfgQuery: string
      /** CONFIG: the open item is shown raw instead of rendered Markdown */
      cfgRaw: boolean
      /** CONFIG: page of the open item's content */
      cfgPage: number
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
      /** PRACTICES section unfolded ('' = headings only) */
      rule: string
    }
  }
}
