// « Appliquer ce scénario », file side, used by the scenarios pane and the Référence hub (synced copy). Writes only
// ~/.claude/scenarios/applied.json and applied.prev.json; reads ~/.claude/settings.json and ~/.claude/agents/*.md.
// Never writes settings.json, an agent file or the environment. A hooks module may not pass `$` across an import, so
// the caller hands in `io`: its own read (text or undefined) and write, built on $.fs in its register file.
import type { Catalog, Scenario } from '../types'
import { agentsOf, appliedRecord, diffApplied, frontmatter } from './apply.ts'
import type { Applied, Current, DiffLine } from './apply.ts'

export type Io = { read: (path: string) => Promise<string | undefined>; write: (path: string, text: string) => Promise<void> }
const json = (t: string | undefined): any => {
  try {
    return t ? JSON.parse(t.replace(/^﻿/, '')) : undefined
  } catch {
    return undefined
  }
}

/** `<claudeDir>/scenarios`, where the record lives. */
export const appliedDir = (claudeDir: string) => `${claudeDir.replace(/\\/g, '/').replace(/\/+$/, '')}/scenarios`

/** What settings.json and the agent files a record names say now (read-only). */
export async function readCurrent(io: Io, claudeDir: string, a: Applied): Promise<Current> {
  const base = claudeDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const s = json(await io.read(`${base}/settings.json`))
  const agents: Current['agents'] = {}
  for (const name of agentsOf(a)) {
    const md = await io.read(`${base}/agents/${name}.md`)
    agents[name] = md === undefined ? undefined : frontmatter(md)
  }
  return { settings: s ? { model: s.model, effortLevel: s.effortLevel, env: s.env } : undefined, agents }
}

/** applied.json with its diff, or undefined when none was written. */
export async function readApplied(io: Io, c: Catalog, claudeDir: string): Promise<{ record: Applied; diff: DiffLine[] } | undefined> {
  const record = json(await io.read(`${appliedDir(claudeDir)}/applied.json`)) as Applied | undefined
  if (!record || !Array.isArray(record.roles)) return undefined
  return { record, diff: diffApplied(c, record, await readCurrent(io, claudeDir, record)) }
}

/** Keeps the previous record as applied.prev.json, writes the new one; returns the line the pane shows. */
export async function applyScenario(io: Io, c: Catalog, s: Scenario, claudeDir: string, at: string): Promise<string> {
  const dir = appliedDir(claudeDir)
  const prev = await io.read(`${dir}/applied.json`)
  if (prev !== undefined) await io.write(`${dir}/applied.prev.json`, prev)
  await io.write(`${dir}/applied.json`, `${JSON.stringify(appliedRecord(c, s, at), null, 1)}\n`)
  return `${s.id} noté dans ~/.claude/scenarios/applied.json${prev !== undefined ? ' (précédent : applied.prev.json)' : ''}`
}
