// band mod: the compact band's pure parts (no $, no I/O; node --test mods/band/tests/logic.test.mjs).
// Line 1, always shown: a slim gauge, « ctx 8 % · compact ~16 min · 434 tok/s · 1 compactage(s) · 5 h 24 % · sem 14 % »,
// then « À toi : N » and « attend Julian : N » once each (counted by lib/core/veille.mjs in the scanner), a ▸ toggle.
// ▸ unfolds « Cette conversation » (a one-line summary while closed); the Mods row (the 6 hubs) stays. The 5 h / week
// details live in Cockpit (Quota card) and the alerts in Veille: no Usage or Veille section here any more.
// Which sections exist and their order come from band.config.json `sections`; the open/closed state is remembered
// through $.store (sections.remember "store") or for the session only ("session").

export const SECTION_IDS = ['conv', 'mods'] as const
export type SectionId = (typeof SECTION_IDS)[number]

export type SectionsCfg = {
  order: string[]
  enabled: string[]
  /** sections open when nothing is remembered */
  open: string[]
  /** the sections list unfolded under line 1 when nothing is remembered */
  expanded: boolean
  /** store: kept across sessions ($.store); session: this session only */
  remember: 'store' | 'session'
  /** an agent counts as running when it wrote within this many seconds */
  running_s: number
  labels: Record<string, string>
}

export type BandUi = { expanded: boolean; open: string[] }

export const DEF_SECTION_LABELS: Record<string, string> = {
  conv: 'Cette conversation',
  ctx: 'ctx',
  compact: 'compact',
  five: '5 h',
  week: 'sem',
  agents: 'agents',
  workflow: 'wf',
  pr: 'PR',
  no_pr: 'pas de PR',
  model_unknown: 'modèle ?',
  compactions: 'compactage(s)',
  julian_counter: 'attend Julian : {n}',
  expand: 'déplier',
  collapse: 'replier',
  relay_left: 'relais dans',
  todo: 'À toi : {n}',
}

export const DEF_SECTIONS: SectionsCfg = {
  order: ['conv', 'mods'],
  enabled: ['conv', 'mods'],
  open: [],
  expanded: false,
  remember: 'store',
  running_s: 120,
  labels: DEF_SECTION_LABELS,
}

export const sectionsCfg = (raw?: Partial<SectionsCfg>): SectionsCfg => ({
  ...DEF_SECTIONS,
  ...(raw ?? {}),
  labels: { ...DEF_SECTION_LABELS, ...((raw && raw.labels) || {}) },
})

/** The sections drawn, in order: `order` filtered by `enabled`, unknown ids dropped. */
export const sectionList = (c: SectionsCfg): SectionId[] =>
  c.order.filter((s): s is SectionId => (SECTION_IDS as readonly string[]).includes(s) && c.enabled.includes(s))

/** The state at session start: what $.store remembered (when remember is "store"), else the config's defaults. */
export const initialUi = (c: SectionsCfg, stored?: unknown): BandUi => {
  const s = stored as Partial<BandUi> | undefined
  if (c.remember === 'store' && s && typeof s === 'object') {
    return { expanded: Boolean(s.expanded), open: Array.isArray(s.open) ? s.open.filter(x => typeof x === 'string') : [] }
  }
  return { expanded: c.expanded, open: [...c.open] }
}

export const toggleSection = (ui: BandUi, id: string): BandUi =>
  id === 'band' ? { ...ui, expanded: !ui.expanded } : { ...ui, open: ui.open.includes(id) ? ui.open.filter(x => x !== id) : [...ui.open, id] }

export const isOpen = (ui: BandUi, id: string) => ui.open.includes(id)

// ---------- texts ----------

/** claude-opus-5-5 -> opus 5.5; claude-sonnet-5-5[1m] -> sonnet 5.5 */
export const modelShort = (m?: string) => {
  if (!m) return ''
  const x = /(fable|opus|sonnet|haiku)[-_ ]?(\d+)(?:[-.](\d+))?/i.exec(m)
  return x ? `${x[1].toLowerCase()} ${x[2]}${x[3] ? '.' + x[3] : ''}` : m.replace(/^claude-/, '')
}

const pct = (n: number) => `${Math.round(n)} %`

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

const limitOf = (limits: Limit[] | undefined, kind: string) => (limits ?? []).find(l => l.kind === kind && Number.isFinite(l.percentUsed))

/** Line 1 after the gauge: ctx 8 % · compact ~16 min · 434 tok/s · 1 compactage(s) · 5 h 24 % · sem 14 %.
 * Missing figures are left out; compactions only when this conversation had one (compact_history_hours). */
export const headLine = (
  x: { ctxPct?: number; etaMin?: number; tps?: number; compactions?: number; limits?: Limit[] },
  labels: Record<string, string> = DEF_SECTION_LABELS,
) => {
  const L = { ...DEF_SECTION_LABELS, ...labels }
  const parts: string[] = []
  parts.push(x.ctxPct === undefined ? `${L.ctx} ?` : `${L.ctx} ${pct(x.ctxPct)}`)
  if (x.etaMin !== undefined && Number.isFinite(x.etaMin)) parts.push(`${L.compact} ~${Math.max(1, Math.round(x.etaMin))} min`)
  if (x.tps !== undefined && Number.isFinite(x.tps)) parts.push(`${Math.round(x.tps)} tok/s`)
  if (x.compactions && x.compactions > 0) parts.push(`${Math.round(x.compactions)} ${L.compactions}`)
  const five = limitOf(x.limits, 'five_hour')
  if (five) parts.push(`${L.five} ${pct(five.percentUsed)}`)
  const week = limitOf(x.limits, 'seven_day')
  if (week) parts.push(`${L.week} ${pct(week.percentUsed)}`)
  return parts.join(' · ')
}

export type ConvFacts = {
  model?: string
  effort?: string
  agents?: { running: number; total: number; workflow?: string }
  pr?: { number?: number; url?: string }
  tokens?: number
  handoffAt?: number
  title?: string
}

const kTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(Math.round(n)))

/** « opus 5.5 · medium · agents 1/3 · wf package-wave · PR #12 » */
export const convSummary = (f: ConvFacts, labels: Record<string, string> = DEF_SECTION_LABELS) => {
  const L = { ...DEF_SECTION_LABELS, ...labels }
  const parts = [[modelShort(f.model) || L.model_unknown, f.effort].filter(Boolean).join(' · ')]
  if (f.agents && f.agents.total) parts.push(`${L.agents} ${f.agents.running}/${f.agents.total}`)
  if (f.agents?.workflow) parts.push(`${L.workflow} ${f.agents.workflow}`)
  if (f.pr?.number !== undefined) parts.push(`${L.pr} #${f.pr.number}`)
  return parts.join(' · ')
}

/** The open body of « Cette conversation »: a few short lines. */
export const convLines = (f: ConvFacts, labels: Record<string, string> = DEF_SECTION_LABELS) => {
  const L = { ...DEF_SECTION_LABELS, ...labels }
  const out: string[] = []
  out.push(`${modelShort(f.model) || L.model_unknown}${f.effort ? ` · effort ${f.effort}` : ''}${f.title ? ` · ${f.title}` : ''}`)
  if (f.agents) out.push(`${L.agents} ${f.agents.running} en cours / ${f.agents.total}${f.agents.workflow ? ` · workflow ${f.agents.workflow}` : ''}`)
  out.push(f.pr?.number !== undefined ? `${L.pr} #${f.pr.number}${f.pr.url ? ` ${f.pr.url}` : ''}` : L.no_pr)
  if (f.tokens !== undefined && f.handoffAt) {
    const left = f.handoffAt - f.tokens
    out.push(left > 0 ? `${L.relay_left} ${kTok(left)} (${kTok(f.handoffAt)})` : `relais dépassé (${kTok(f.tokens)} ≥ ${kTok(f.handoffAt)})`)
  }
  return out
}

/** What the scanner counted with lib/core/veille.mjs (readVeille): the ONE count every view shows. */
export type Waiting = { aToi?: number; julian?: number; available?: boolean; aToiAvailable?: boolean }

/** Line 1's counters, in order « À toi : N » then « attend Julian : N », each only when N > 0. */
export const counters = (w: Waiting | null | undefined, labels: Record<string, string> = DEF_SECTION_LABELS) => {
  const L = { ...DEF_SECTION_LABELS, ...labels }
  const out: { key: string; text: string }[] = []
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.round(x) : 0)
  const fill = (s: string, k: number) => (s.includes('{n}') ? s.replace('{n}', String(k)) : `${s} : ${k}`)
  if (n(w?.aToi)) out.push({ key: 'band-todo', text: fill(L.todo, n(w?.aToi)) })
  if (n(w?.julian)) out.push({ key: 'band-julian', text: fill(L.julian_counter, n(w?.julian)) })
  return out
}
