// « Appliquer ce scénario », pure: the record written to ~/.claude/scenarios/applied.json (the previous one is kept as
// applied.prev.json by the hook) and the diff between that record and what the agent files and settings say now.
// Nothing here, and nothing in the hook, edits settings.json, an agent file or an env var: the record is a note for
// Julian and his agents; the diff says what would have to change by hand.
import type { Catalog, Role, Scenario } from '../types'

export type AppliedRole = { role: string; label: string; unit: string; agent?: string; model: string; model_id: string; effort: string }
export type Applied = {
  schema: 1
  scenario: string
  name: string
  applied_at: string
  roles: AppliedRole[]
  env: Record<string, string>
  note: string
}
/** What the files say now: ~/.claude/settings.json (model, effortLevel, env) and the frontmatter of each agent file. */
export type Current = {
  settings?: { model?: string; effortLevel?: string; env?: Record<string, string> } | undefined
  agents: Record<string, { model?: string; effort?: string } | undefined>
}
export type DiffLine = { role: string; where: string; field: string; current: string; applied: string; same: boolean }

export const NOTE = 'Note locale : rien de ceci n\'a modifié settings.json, les agents ou l\'environnement.'

const modelId = (c: Catalog, m: string | undefined) => (m ? c.models[m]?.id ?? m : '')
const roleAgent = (r: Role) => (r.unit === 'subagent' || r.unit === 'workflow-agent' ? r.agent ?? r.role : undefined)

/** The env defaults a scenario implies (same rule as the env snippet). */
export function envOf(c: Catalog, s: Scenario): Record<string, string> {
  const env: Record<string, string> = {}
  const sub = s.defaults?.subagent_model ?? s.roles.find(r => r.unit === 'subagent')?.model
  const wf = s.defaults?.workflow_model ?? s.roles.find(r => r.unit === 'workflow-agent')?.model
  if (sub) env.CLAUDE_CODE_SUBAGENT_MODEL = modelId(c, sub)
  if (wf) env.CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL = modelId(c, wf)
  return env
}

/** The record for one scenario, at ISO time `at`. */
export function appliedRecord(c: Catalog, s: Scenario, at: string): Applied {
  return {
    schema: 1,
    scenario: s.id,
    name: s.name,
    applied_at: at,
    roles: s.roles.map(r => ({
      role: r.role, label: r.label ?? r.role, unit: r.unit, ...(roleAgent(r) ? { agent: roleAgent(r) } : {}),
      model: r.model, model_id: modelId(c, r.model), effort: r.effort,
    })),
    env: envOf(c, s),
    note: NOTE,
  }
}

/** `model:` and `effort:` (any `key: value`) of a Markdown file's YAML frontmatter; {} without one. */
export function frontmatter(md: string | undefined): Record<string, string> {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(md ?? '')
  const out: Record<string, string> = {}
  if (!m) return out
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(line)
    if (kv) out[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, '')
  }
  return out
}

/** Same model when both name the same id (alias or full id; a `[1m]` suffix ignored). */
export const sameModel = (c: Catalog, a: string, b: string) => {
  const id = (x: string) => modelId(c, x.replace(/\[1m\]$/i, '').trim()).toLowerCase()
  return id(a) === id(b)
}

/** One line per role and field (and per env default), current value vs the applied one. */
export function diffApplied(c: Catalog, a: Applied, cur: Current): DiffLine[] {
  const out: DiffLine[] = []
  const push = (role: string, where: string, field: string, current: string | undefined, applied: string, model: boolean) => {
    const now = current ?? ''
    out.push({ role, where, field, current: now || '(absent)', applied, same: now !== '' && (model ? sameModel(c, now, applied) : now === applied) })
  }
  for (const r of a.roles) {
    if (r.unit === 'session') {
      push(r.label, 'settings.json', 'model', cur.settings?.model, r.model, true)
      push(r.label, 'settings.json', 'effortLevel', cur.settings?.effortLevel, r.effort, false)
    } else if (r.agent) {
      const f = cur.agents[r.agent]
      push(r.label, `agents/${r.agent}.md`, 'model', f?.model, r.model, true)
      push(r.label, `agents/${r.agent}.md`, 'effort', f?.effort, r.effort, false)
    } else {
      out.push({ role: r.label, where: 'au lancement', field: 'model · effort', current: '(fixé à chaque lancement)', applied: `${r.model} · ${r.effort}`, same: true })
    }
  }
  for (const [k, v] of Object.entries(a.env)) push('env', 'settings.json env', k, cur.settings?.env?.[k], v, true)
  return out
}

/** Agent file names the diff needs. */
export const agentsOf = (a: Applied) => [...new Set(a.roles.map(r => r.agent).filter((x): x is string => !!x))]

/** « S1 Standard V6 appliqué le … : 3 écarts sur 14 » */
export function diffSummary(a: Applied, d: DiffLine[]): string {
  const n = d.filter(x => !x.same).length
  return `${a.scenario} ${a.name} noté le ${a.applied_at.replace('T', ' ').slice(0, 16)} : ${n ? `${n} écart${n > 1 ? 's' : ''} sur ${d.length}` : `aucun écart (${d.length} valeurs)`}`
}
