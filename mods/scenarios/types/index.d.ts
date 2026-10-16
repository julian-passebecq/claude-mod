// Shapes of scenarios.json (and of a user's extra scenarios file) and the `$.state` values of the scenarios mod.

export type ModelInfo = { label: string; id: string }
export type UnitInfo = {
  label: string
  /** what to set for a role run as this unit (one line) */
  how: string
  /** key into `sources` */
  source: string
}
export type Limit = {
  id: string
  text: string
  /** key into `sources` */
  source: string
  /** false: not found in the docs ("non vérifié") */
  verified: boolean
  /** with `unit`: the most agents of that unit that run at once */
  max?: number
  unit?: string
}
export type Role = {
  role: string
  label?: string
  /** alias from `models` (opus, sonnet, haiku) or a full model id */
  model: string
  effort: string
  /** key into `units`: session, sub-conversation, workflow-agent, subagent */
  unit: string
  max_parallel: number
  /** agent file name (subagent_type) for subagent and workflow-agent roles */
  agent?: string
  note?: string
}
export type Scenario = {
  id: string
  name: string
  summary?: string
  roles: Role[]
  /** free caps shown as rules: { "ci_pipelines": 4, "workflows": 1 } */
  caps?: Record<string, number>
  /** may a role move up the effort ladder after a failure */
  escalation?: boolean
  /** default model for the env vars; else the first role of that unit */
  defaults?: { subagent_model?: string; workflow_model?: string }
}
export type ScenarioFile = {
  schema?: number
  sources?: Record<string, string>
  models?: Record<string, ModelInfo>
  efforts?: string[]
  units?: Record<string, UnitInfo>
  limits?: Limit[]
  snippets?: string[]
  scenarios?: Scenario[]
}
export type Catalog = Required<Omit<ScenarioFile, 'schema'>>
export type Checked = { catalog: Catalog; errors: string[]; warnings: string[] }

declare module 'claude-code' {
  interface PluginState {
    scenarios: {
      /** id of the scenario the pane shows */
      selected: string
      /** snippet kind the pane shows: prompt, agent, workflow, frontmatter, env */
      kind: string
      /** last copy's outcome line */
      copied: string
    }
  }
}
