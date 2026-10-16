// band mod: the compact band's pure parts (no $, no I/O; node --test mods/band/tests/logic.test.mjs).
// Line 1, always shown: a slim gauge, « ctx 8 % · compact ~16 min · 434 tok/s · 5 h 24 % · sem 14 % », a ▸ toggle.
// ▸ unfolds the sections (Cette conversation, Usage, Veille), each a one-line summary while closed; the Mods row stays.
// Which sections exist and their order come from band.config.json `sections`; the open/closed state is remembered
// through $.store (sections.remember "store") or for the session only ("session").

export const SECTION_IDS = ['conv', 'usage', 'veille', 'mods'] as const
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
  usage_bar_width: number
  inline_gauge_width: number
  labels: Record<string, string>
}

export type BandUi = { expanded: boolean; open: string[] }

export const DEF_SECTION_LABELS: Record<string, string> = {
  conv: 'Cette conversation',
  usage: 'Usage',
  veille: 'Veille',
  ctx: 'ctx',
  compact: 'compact',
  five: '5 h',
  week: 'sem',
  agents: 'agents',
  workflow: 'wf',
  pr: 'PR',
  no_pr: 'pas de PR',
  model_unknown: 'modèle ?',
  reset_in: 'reset dans',
  reset_at: 'reset',
  alerts: 'alerte(s)',
  julian: 'attend Julian',
  julian_counter: 'attend Julian : {n}',
  veille_none: 'aucune alerte',
  veille_off: 'veille absente',
  not_readable: 'non lisible',
  expand: 'déplier',
  collapse: 'replier',
  cost: 'cette session',
  relay_left: 'relais dans',
  todo: 'À toi',
}

export const DEF_SECTIONS: SectionsCfg = {
  order: ['conv', 'usage', 'veille', 'mods'],
  enabled: ['conv', 'usage', 'veille', 'mods'],
  open: [],
  expanded: false,
  remember: 'store',
  running_s: 120,
  usage_bar_width: 120,
  inline_gauge_width: 120,
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

/** Line 1 after the gauge: ctx 8 % · compact ~16 min · 434 tok/s · 5 h 24 % · sem 14 %. Missing figures are left out. */
export const headLine = (
  x: { ctxPct?: number; etaMin?: number; tps?: number; limits?: Limit[] },
  labels: Record<string, string> = DEF_SECTION_LABELS,
) => {
  const L = { ...DEF_SECTION_LABELS, ...labels }
  const parts: string[] = []
  parts.push(x.ctxPct === undefined ? `${L.ctx} ?` : `${L.ctx} ${pct(x.ctxPct)}`)
  if (x.etaMin !== undefined && Number.isFinite(x.etaMin)) parts.push(`${L.compact} ~${Math.max(1, Math.round(x.etaMin))} min`)
  if (x.tps !== undefined && Number.isFinite(x.tps)) parts.push(`${Math.round(x.tps)} tok/s`)
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

const inText = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${Math.floor(h / 24)} j`
}

const atText = (ms: number) => {
  const d = new Date(ms)
  return `${['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'][d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export type UsageRow = { id: string; label: string; pct: number; when: string }

/** The Usage section's bars: session (5 h) and week, with when they reset. */
export const usageRows = (limits: Limit[] | undefined, now: number, labels: Record<string, string> = DEF_SECTION_LABELS): UsageRow[] => {
  const L = { ...DEF_SECTION_LABELS, ...labels }
  const out: UsageRow[] = []
  for (const [kind, label] of [['five_hour', L.five], ['seven_day', L.week]] as const) {
    const l = limitOf(limits, kind)
    if (!l) continue
    const r = Date.parse(l.resetsAt ?? '')
    const when = Number.isFinite(r) ? (r - now < 24 * 3600000 ? `${L.reset_in} ${inText(r - now)}` : `${L.reset_at} ${atText(r)}`) : ''
    out.push({ id: kind, label, pct: l.percentUsed, when })
  }
  return out
}

const usd = (n: number) => `$${n < 100 ? n.toFixed(2) : Math.round(n)}`

/** « 5 h 24 % · sem 14 % · $0.23 » */
export const usageSummary = (limits: Limit[] | undefined, costUsd: number | undefined, labels: Record<string, string> = DEF_SECTION_LABELS) => {
  const L = { ...DEF_SECTION_LABELS, ...labels }
  const parts = usageRows(limits, 0, L).map(r => `${r.label} ${pct(r.pct)}`)
  if (costUsd !== undefined && Number.isFinite(costUsd)) parts.push(usd(costUsd))
  return parts.join(' · ') || L.not_readable
}

/** A text bar for the terminal (no Svg): █ filled, ░ empty. */
export const textBar = (p: number, width = 12) => {
  const full = Math.round((Math.max(0, Math.min(100, p)) / 100) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

export type VeilleAlert = { key: string; what?: string; title?: string; severity?: string; julian?: boolean; acked?: boolean; since?: number }
export type VeilleSum = { available: boolean; open: number; julian: number; top?: VeilleAlert; alerts: VeilleAlert[] }

const RANK: Record<string, number> = { julian: 0, bad: 1, warn: 2, info: 3 }

/** Veille's open alerts from its state.json and acks (same order as veille's own view: Julian first, then severity). */
export const veilleSummary = (state: any, acks: string[]): VeilleSum => {
  if (!state || typeof state !== 'object') return { available: false, open: 0, julian: 0, alerts: [] }
  const ack = new Set(acks)
  const alerts = (Object.values(state.alerts ?? {}) as VeilleAlert[])
    .filter(a => a && !(a.acked || ack.has(a.key) || ack.has('*')))
    .sort((a, b) => Number(Boolean(b.julian)) - Number(Boolean(a.julian)) || (RANK[a.severity ?? ''] ?? 9) - (RANK[b.severity ?? ''] ?? 9) || (a.since ?? 0) - (b.since ?? 0))
  return { available: true, open: alerts.length, julian: alerts.filter(a => a.julian).length, top: alerts[0], alerts }
}

/** The red counter at the head of the band line: « attend Julian : N », empty when nothing waits on Julian. */
export const julianCounter = (v: VeilleSum | null | undefined, labels: Record<string, string> = DEF_SECTION_LABELS) =>
  v && v.available && v.julian ? ({ ...DEF_SECTION_LABELS, ...labels }.julian_counter ?? 'attend Julian : {n}').replace('{n}', String(v.julian)) : ''

export const alertText = (a: VeilleAlert) => `${a.what || a.key}${a.title ? ` · ${a.title}` : ''}`

/** « 2 alerte(s) · 1 attend Julian · <top> » */
export const veilleLine = (v: VeilleSum, labels: Record<string, string> = DEF_SECTION_LABELS, max = 60) => {
  const L = { ...DEF_SECTION_LABELS, ...labels }
  if (!v.available) return L.veille_off
  if (!v.open) return L.veille_none
  const top = v.top ? alertText(v.top) : ''
  const s = `${v.open} ${L.alerts}${v.julian ? ` · ${v.julian} ${L.julian}` : ''}${top ? ` · ${top}` : ''}`
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** a-faire's summary.json (counts only, written by the a-faire mod's scanner) -> the red « À toi : N » of line 1, or ''. */
export const todoBadge = (sum: any, labels: Record<string, string> = DEF_SECTION_LABELS) => {
  const L = { ...DEF_SECTION_LABELS, ...labels }
  const n = sum && typeof sum === 'object' ? Number(sum.open) : 0
  return Number.isFinite(n) && n > 0 ? `${L.todo} : ${Math.round(n)}` : ''
}
