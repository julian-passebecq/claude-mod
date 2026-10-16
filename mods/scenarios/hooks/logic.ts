// Pure logic of the scenarios mod: merge, validate, describe and turn a scenario into ready-to-paste snippets.
// No `$`, no imports but types: the engine loads it from register.tsx and `node --test` loads it as plain TS.
import type { Catalog, Checked, Limit, Role, Scenario, ScenarioFile } from '../types'

export const KINDS = ['prompt', 'agent', 'workflow', 'frontmatter', 'env'] as const
export type Kind = (typeof KINDS)[number]
export const KIND_LABEL: Record<Kind, string> = {
  prompt: 'Prompt line',
  agent: 'Agent calls',
  workflow: 'Workflow agent()',
  frontmatter: 'Agent files',
  env: 'Env vars',
}

const EMPTY: Catalog = { sources: {}, models: {}, efforts: [], units: {}, limits: [], snippets: [], scenarios: [] }

/** Shipped file first, then the user's: tables merge by key, limits and scenarios by id (the later one wins). */
export function merge(...files: (ScenarioFile | undefined)[]): Catalog {
  const out: Catalog = { ...EMPTY, sources: {}, models: {}, units: {}, limits: [], scenarios: [] }
  for (const f of files) {
    if (!f || typeof f !== 'object') continue
    Object.assign(out.sources, f.sources ?? {})
    Object.assign(out.models, f.models ?? {})
    Object.assign(out.units, f.units ?? {})
    if (Array.isArray(f.efforts) && f.efforts.length) out.efforts = [...f.efforts]
    if (Array.isArray(f.snippets) && f.snippets.length) out.snippets = [...f.snippets]
    for (const l of Array.isArray(f.limits) ? f.limits : []) out.limits = [...out.limits.filter(x => x.id !== l?.id), l]
    for (const s of Array.isArray(f.scenarios) ? f.scenarios : []) out.scenarios = [...out.scenarios.filter(x => x.id !== s?.id), s]
  }
  return out
}

const isFullId = (m: string) => /^claude-[a-z0-9.-]+$/.test(m)
const rank = (c: Catalog, effort: string) => c.efforts.indexOf(effort)
const leadOf = (s: Scenario) => s.roles.find(r => r.unit === 'session')

/** Checks every scenario against the catalog's tables and the documented limits; a broken scenario is dropped with its errors. */
export function check(c: Catalog): Checked {
  const errors: string[] = []
  const warnings: string[] = []
  for (const [key, url] of Object.entries(c.sources)) if (!/^https:\/\//.test(String(url))) errors.push(`source ${key}: not an https URL`)
  for (const l of c.limits) if (!l || !l.id || !l.text || !(l.source in c.sources)) errors.push(`limit ${l?.id ?? '?'}: needs id, text and a known source`)
  const seen = new Set<string>()
  const kept: Scenario[] = []
  for (const s of c.scenarios) {
    const where = `scenario ${s?.id ?? '?'}`
    const own: string[] = []
    if (!s || typeof s !== 'object') { errors.push(`${where}: not an object`); continue }
    if (!s.id || typeof s.id !== 'string') own.push(`${where}: missing id`)
    else if (seen.has(s.id)) own.push(`${where}: duplicate id`)
    if (!s.name || typeof s.name !== 'string') own.push(`${where}: missing name`)
    if (!Array.isArray(s.roles) || s.roles.length === 0) own.push(`${where}: needs at least one role`)
    for (const r of Array.isArray(s.roles) ? s.roles : []) {
      const at = `${where} role ${r?.role ?? '?'}`
      if (!r || !r.role) { own.push(`${at}: missing role name`); continue }
      if (!(r.model in c.models) && !isFullId(String(r.model))) own.push(`${at}: unknown model "${r.model}"`)
      if (rank(c, r.effort) < 0) own.push(`${at}: effort "${r.effort}" is not one of ${c.efforts.join(', ')}`)
      if (!(r.unit in c.units)) own.push(`${at}: unit "${r.unit}" is not one of ${Object.keys(c.units).join(', ')}`)
      if (!Number.isInteger(r.max_parallel) || r.max_parallel < 1) own.push(`${at}: max_parallel must be a whole number >= 1`)
      for (const l of c.limits) {
        if (l.max != null && l.unit === r.unit && r.max_parallel > l.max) own.push(`${at}: max_parallel ${r.max_parallel} is above the limit "${l.text}"`)
      }
    }
    if (own.length === 0) {
      const lead = leadOf(s)
      for (const r of s.roles) {
        if (lead && r.unit === 'sub-conversation' && rank(c, r.effort) > rank(c, lead.effort)) {
          warnings.push(`${where} role ${r.role}: a sub-conversation's effort (${r.effort}) is above its parent's (${lead.effort}); expected at most the parent's (non vérifié)`)
        }
      }
      for (const l of c.limits) {
        if (l.max == null || !l.unit) continue
        const total = s.roles.filter(r => r.unit === l.unit).reduce((n, r) => n + r.max_parallel, 0)
        if (total > l.max) warnings.push(`${where}: ${total} ${l.unit} at once if every role peaks together; limit "${l.text}"`)
      }
    }
    if (s?.id) seen.add(s.id)
    if (own.length) errors.push(...own)
    else kept.push(s)
  }
  return { catalog: { ...c, scenarios: kept }, errors, warnings }
}

export const modelLabel = (c: Catalog, m: string) => c.models[m]?.label ?? m
const roleName = (r: Role) => r.label ?? r.role
const unitLabel = (c: Catalog, u: string) => c.units[u]?.label ?? u

/** One line per role: what it runs on and as what. */
export function roleLine(c: Catalog, r: Role): string {
  return `${roleName(r)}: ${modelLabel(c, r.model)} · ${r.effort} · ${unitLabel(c, r.unit)} · max ${r.max_parallel}${r.note ? ` (${r.note})` : ''}`
}

/** The exact settings for a role, by the unit it runs as. Each line ends with the doc key it rests on. */
export function settingsFor(c: Catalog, r: Role): { text: string; source: string; verified: boolean }[] {
  const agent = r.agent ?? r.role
  const out: { text: string; source: string; verified: boolean }[] = []
  switch (r.unit) {
    case 'session':
      out.push({ text: `start the session with --model ${r.model} and /effort ${r.effort} (or "model" / "effortLevel" in settings); never switch a running session`, source: 'model-config', verified: true })
      break
    case 'sub-conversation':
      out.push({ text: `start it on ${r.model}, effort ${r.effort}; its effort is expected to be at most the parent's`, source: 'model-config', verified: false })
      break
    case 'subagent':
      out.push({ text: `Agent call: model: "${r.model}", effort: "${r.effort}", subagent_type: "${agent}"`, source: 'sub-agents', verified: true })
      out.push({ text: `or agents/${agent}.md frontmatter: model: ${r.model}, effort: ${r.effort}`, source: 'sub-agents', verified: true })
      break
    case 'workflow-agent':
      out.push({ text: `the model a script names for an agent() counts as the per-invocation model: ${r.model}`, source: 'workflows', verified: true })
      out.push({ text: `agent() opts: { model: '${r.model}' } (option spelling not shown in the docs)`, source: 'workflows', verified: false })
      out.push({ text: `effort ${r.effort}: no documented agent() option; set it in agents/${agent}.md frontmatter`, source: 'workflows', verified: false })
      break
  }
  return out
}

const envDefault = (s: Scenario, unit: string) => s.roles.find(r => r.unit === unit)?.model

/** A ready-to-paste snippet of one kind for one scenario. */
export function snippet(c: Catalog, s: Scenario, kind: Kind): string {
  const subs = s.roles.filter(r => r.unit === 'subagent')
  const wfs = s.roles.filter(r => r.unit === 'workflow-agent')
  switch (kind) {
    case 'prompt': {
      const caps = Object.entries(s.caps ?? {}).map(([k, v]) => `${k.replace(/_/g, ' ')} <= ${v}`)
      return (
        `Scenario ${s.id} "${s.name}": ` +
        s.roles.map(r => `${roleName(r)} ${modelLabel(c, r.model)} ${r.effort} as ${unitLabel(c, r.unit)} (max ${r.max_parallel})`).join('; ') +
        `. Every Agent and Workflow agent() call names its model.` +
        (s.escalation === false ? ' No effort escalation.' : '') +
        (caps.length ? ` Caps: ${caps.join(', ')}.` : '')
      )
    }
    case 'agent':
      if (!subs.length) return `// ${s.id}: no role runs as an Agent subagent`
      return subs
        .map(r => `// ${roleName(r)}, up to ${r.max_parallel} at once\nAgent({ description: "<3-5 words>", subagent_type: "${r.agent ?? r.role}", model: "${r.model}", effort: "${r.effort}", prompt: "<task>" })`)
        .join('\n')
    case 'workflow': {
      if (!wfs.length) return `// ${s.id}: no role runs as a Workflow agent`
      const lines = wfs.map(r => `  ${JSON.stringify(r.role)}: { model: '${r.model}' }, // effort ${r.effort}: agents/${r.agent ?? r.role}.md (agent() effort undocumented); max ${r.max_parallel} at once`)
      return `// Scenario ${s.id} "${s.name}": opts for each agent() call\nconst ROLE_OPTS = {\n${lines.join('\n')}\n}`
    }
    case 'frontmatter': {
      const files = [...subs, ...wfs]
      if (!files.length) return `# ${s.id}: no agent roles`
      return files.map(r => `# agents/${r.agent ?? r.role}.md\n---\nname: ${r.agent ?? r.role}\ndescription: ${roleName(r)}\nmodel: ${r.model}\neffort: ${r.effort}\n---`).join('\n\n')
    }
    case 'env': {
      const env: Record<string, string> = {}
      const sub = s.defaults?.subagent_model ?? envDefault(s, 'subagent')
      const wf = s.defaults?.workflow_model ?? envDefault(s, 'workflow-agent')
      if (sub) env.CLAUDE_CODE_SUBAGENT_MODEL = c.models[sub]?.id ?? sub
      if (wf) env.CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL = c.models[wf]?.id ?? wf
      return (
        `// ~/.claude/settings.json: the model a call that names none falls back to (after its agent file's model)\n` +
        (wf ? `// CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: non vérifié (not in the workflows docs; workflow agents follow the subagent order)\n` : '') +
        JSON.stringify({ env }, null, 2)
      )
    }
  }
}

/** Limits that apply to a scenario: every limit with no unit, and those whose unit a role uses. */
export function limitsFor(c: Catalog, s: Scenario): Limit[] {
  const units = new Set(s.roles.map(r => r.unit))
  return c.limits.filter(l => !l.unit || units.has(l.unit))
}

/** `/scenarios [id] [kind]`, in either order, case-insensitive. */
export function parseArgs(args: string, ids: string[]): { id?: string; kind?: Kind } {
  const out: { id?: string; kind?: Kind } = {}
  for (const word of args.trim().split(/\s+/).filter(Boolean)) {
    const low = word.toLowerCase()
    const kind = KINDS.find(k => k === low)
    if (kind) out.kind = kind
    else out.id = ids.find(i => i.toLowerCase() === low) ?? word
  }
  return out
}

/** `~` and `%USERPROFILE%`-free path for a user's file. */
export const expandHome = (p: string, home: string) => p.replace(/^~(?=[\\/]|$)/, home).replace(/\\/g, '/')
