// Pure helpers of the ci mod: argument parsing and text. No `$`, so tests call them directly.
import type { Backend, Labels, Route, Snapshot, Tri } from '../types'

export const PANE = { id: 'ci-routing', title: 'CI routing' } as const

export type Parsed =
  | { kind: 'show'; refresh: boolean }
  | { kind: 'route'; target: string; backend: string }
  | { kind: 'clear'; target: string }
  | { kind: 'usage'; text: string }

export const USAGE = 'usage: /ci [refresh] · /ci route <repo-path|session-id|here|session> <backend-id> · /ci clear <repo-path|session-id|here|session>'

/** `/ci`, `/ci refresh`, `/ci route <target> <backend>`, `/ci clear <target>`. Quotes keep a path with spaces whole. */
export const parseArgs = (args: string): Parsed => {
  const words = (args.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(w => w.replace(/^["']|["']$/g, ''))
  const [verb = '', ...rest] = words
  const v = verb.toLowerCase()
  if (v === '' || v === 'show' || v === 'status') return { kind: 'show', refresh: false }
  if (v === 'refresh' || v === 'check') return { kind: 'show', refresh: true }
  if (v === 'route' || v === 'set') {
    if (rest.length !== 2) return { kind: 'usage', text: USAGE }
    return { kind: 'route', target: rest[0]!, backend: rest[1]! }
  }
  if (v === 'clear' || v === 'unset') {
    if (rest.length !== 1) return { kind: 'usage', text: USAGE }
    return { kind: 'clear', target: rest[0]! }
  }
  return { kind: 'usage', text: USAGE }
}

/** `here`/`repo` -> the session's directory, `session`/`this` -> the session id, anything else as typed. */
export const resolveTarget = (target: string, cwd: string, sessionId: string): string => {
  const t = target.toLowerCase()
  if (t === 'here' || t === 'repo' || t === '.') return cwd
  if (t === 'session' || t === 'this') return sessionId
  return target
}

export const usableText = (labels: Labels, u: Tri | undefined): string => labels.usable?.[u ?? 'unknown'] ?? u ?? 'unknown'
export const statusText = (labels: Labels, s: string): string => labels.status?.[s] ?? s

/** Theme color of a backend row: its usability when active, its status otherwise. */
export const rowColor = (labels: Labels, b: Backend): string => {
  const key = b.status !== 'active' ? b.status : (b.check?.usable ?? 'unknown')
  const fallback: Record<string, string> = { yes: 'success', no: 'error', unknown: 'subtle' }
  return labels.colors?.[key] ?? fallback[key] ?? 'subtle'
}

export const mark = (b: Backend): string =>
  b.status !== 'active' ? '·' : b.check?.usable === 'yes' ? '●' : b.check?.usable === 'no' ? '○' : '?'

const n = (x: number | null | undefined) => (x == null ? '?' : String(x))

/** One line of facts about a backend's check: token, runners, jobs, why. */
export const checkLine = (b: Backend): string => {
  const c = b.check
  if (b.status !== 'active') return b.status
  if (!c) return 'not checked yet'
  const parts = [`token ${c.token.present}${c.token.source ? ` (${c.token.source})` : ''}`]
  if (c.runners) parts.push(`runners ${c.runners.online} online / ${c.runners.total}`)
  if (c.jobs) parts.push(`jobs ${n(c.jobs.running)} running, ${n(c.jobs.pending)} pending`)
  for (const a of c.actions) parts.push(`${a.repo}: actions ${a.actions} (${a.why})`)
  parts.push(c.why)
  return parts.join(' · ')
}

export const routeLine = (s: Snapshot, r: Route): string => {
  const b = s.backends.find(x => x.id === r.backend)
  return `${r.kind} ${r.key} → ${b?.label ?? r.backend} (${r.backend}) · set by ${r.set_by} · ${r.set_at}`
}

/** The text /ci answers with. */
export const summary = (s: Snapshot): string => {
  const L = s.labels
  const lines = [`${L.title ?? 'CI routing'} · checked ${s.generated ?? 'never'}${s.stale ? ' (refreshing)' : ''}`]
  for (const b of s.backends) lines.push(`${mark(b)} ${b.id} · ${b.label} · ${statusText(L, b.status)} · ${b.status === 'active' ? usableText(L, b.check?.usable) : ''}${b.status === 'active' ? ' · ' : ''}${checkLine(b)}`.replace(/ · $/, ''))
  const cur = s.current
  lines.push(
    cur
      ? `${L.here ?? 'This conversation'}: ${cur.backend} (${cur.match} route ${cur.key}, set by ${cur.set_by} ${cur.set_at})`
      : `${L.here ?? 'This conversation'}: ${L.no_route ?? 'no route'}`,
  )
  lines.push(`${s.routes.length} route(s) in ${s.routing_file}`)
  return lines.join('\n')
}

/** The system-prompt note: the route as information, never an instruction to block anything. */
export const promptNote = (s: Snapshot): string | undefined => {
  const cur = s.current
  if (!cur) return undefined
  const b = s.backends.find(x => x.id === cur.backend)
  const where = b ? `${b.label} (${b.kind}, ${b.host}${b.runner_tag ? `, runner tag ${b.runner_tag}` : ''})` : cur.backend
  return `CI route (ci mod): this ${cur.match === 'session' ? 'conversation' : 'repo'} uses CI backend "${cur.backend}": ${where}. ` +
    `Set by ${cur.set_by} at ${cur.set_at}. Use it for this work's pipelines unless told otherwise; /ci shows all backends and their status.`
}

export const parseSnapshot = (text: string): Snapshot | undefined => {
  if (!text) return undefined
  try {
    const s = JSON.parse(text) as Snapshot
    return Array.isArray(s.backends) ? s : undefined
  } catch {
    return undefined
  }
}
