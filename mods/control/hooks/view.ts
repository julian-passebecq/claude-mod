// Pure helpers of the control mod: formatting and freshness. No `$`, so tests call them directly.

export const PANES = {
  setup: { id: 'control-setup', title: 'SETUP' },
  usage: { id: 'control-usage', title: 'USAGE' },
  practices: { id: 'control-practices', title: 'PRACTICES' },
  history: { id: 'control-history', title: 'HISTORY' },
} as const
export type PaneKey = keyof typeof PANES

/** `/control`, `/control usage`, `/control scan`: which panes to open (all four by default) and whether to rescan first. */
export const parseArgs = (args: string): { panes: PaneKey[]; scan: boolean } => {
  const words = args.toLowerCase().split(/\s+/).filter(Boolean)
  const panes = words.filter((w): w is PaneKey => w in PANES)
  return { panes: panes.length ? panes : (Object.keys(PANES) as PaneKey[]), scan: words.includes('scan') }
}

/** Minutes since an ISO time ('2026-10-09T15:50:11Z'); Infinity when absent or unreadable. */
export const ageMinutes = (iso: string | undefined, now: number): number => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? Infinity : Math.max(0, (now - t) / 60000)
}

export const isStale = (iso: string | undefined, now: number, staleMinutes: number) =>
  ageMinutes(iso, now) > staleMinutes

export const ageText = (iso: string | undefined, now: number): string => {
  const m = ageMinutes(iso, now)
  if (!Number.isFinite(m)) return 'never'
  if (m < 1) return 'just now'
  if (m < 90) return `${Math.round(m)} min ago`
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} days ago`
}

/** 27_495_461 -> '27.5 M', 4_263 -> '4,263'. */
export const big = (n: number): string => {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} B`
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)} M`
  return Math.round(n).toLocaleString('en-US')
}

export const usd = (n: number): string => `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)}`

export const pct = (part: number, whole: number): string => (whole ? `${((100 * part) / whole).toFixed(1)} %` : 'n/a')

export const kb = (n: number | null): string =>
  n == null ? '' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`

/** The dot and theme color of a red/amber/green state. */
export const stateColor = (state: string): string =>
  state === 'green' ? 'success' : state === 'amber' ? 'warning' : state === 'red' ? 'error' : 'subtle'

export const stateMark = (state: string): string =>
  state === 'green' ? '●' : state === 'amber' ? '◐' : state === 'red' ? '○' : '·'

export const metricValue = (value: number | null, unit: string): string =>
  value == null ? 'n/a' : unit === '%' ? `${value} %` : unit === '/day' ? `${value}/day` : `${value}`

/** '~/x' -> '<home>/x' with the home folder from the environment. */
export const expandHome = (p: string, home: string): string =>
  p.startsWith('~') ? `${home.replace(/\\/g, '/')}${p.slice(1)}` : p.replace(/\\/g, '/')

export const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Objects merge key by key, anything else is replaced: config.json, then the user's override file. */
export const deepMerge = (base: unknown, over: unknown): unknown => {
  if (!base || !over || typeof base !== 'object' || typeof over !== 'object' || Array.isArray(base) || Array.isArray(over))
    return over === undefined ? base : over
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (!k.startsWith('_')) out[k] = k in out ? deepMerge(out[k], v) : v
  }
  return out
}

/** A pane label from config labels.pane, or the key itself when the config lacks it. */
export const labelOf = (labels: Record<string, unknown> | undefined) => (key: string): string => {
  const v = labels?.[key]
  return typeof v === 'string' ? v : key
}

/** 'Claude Control V5.8 (15 Oct 2026)' -> its version '5.8' ('' when the line has none). */
export const versionOf = (title: string, rx: RegExp | string = /\bV(\d+(?:\.\d+)*)\b/): string =>
  new RegExp(rx).exec(title)?.[1] ?? ''

export type ModState = 'loaded' | 'installed' | 'shadowed' | 'dev' | 'missing'
export const modMark = (state: string): string =>
  state === 'loaded' ? '●' : state === 'missing' ? '○' : state === 'dev' ? '◇' : '◌'
export const modColor = (state: string): string =>
  state === 'loaded' ? 'success' : state === 'missing' ? 'error' : 'subtle'

/** One slash command as $.command.list() gives it; the band's Mods button bar reads the same list. */
export type CommandSeen = { name: string; plugin?: string }
/** A mod is live in this session when a command it registered is in the list ('band' or 'band@marketplace'). */
export const inSession = (commands: readonly CommandSeen[], mod: string) =>
  commands.some(c => c.plugin === mod || (c.plugin ?? '').startsWith(`${mod}@`))
