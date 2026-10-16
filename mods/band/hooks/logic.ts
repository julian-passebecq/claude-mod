// band mod ("Jauge"): the pure math. Rates over sliding windows, scope grouping (worktree -> repo), context and
// compaction figures, sparklines and the French band text. No I/O here: the scanner (scanner/scan.mjs) and the hooks
// module (register.tsx) both import it, and node --test runs it directly (Node 22.18+ strips the types).

import type { Compaction, CompactRow, CountMode, Ev, Rate, ScopeId, ScopeRow, SessionMeta, TopRow, Usage, View } from '../types'

export type { Compaction, CompactRow, CountMode, Ev, Rate, ScopeId, ScopeRow, SessionMeta, TopRow, Usage, View }

/** This conversation's agents in the kept window: total seen, running (wrote within runningS), the running Workflow. */
export const agentsOf = (events: Ev[], session: string | undefined, now: number, runningS: number) => {
  if (!session) return undefined
  const last = new Map<string, { t: number; w?: string }>()
  for (const e of events) {
    if (e.s !== session || !e.a) continue
    const p = last.get(e.a)
    if (!p || e.t > p.t) last.set(e.a, { t: e.t, ...(e.w ? { w: e.w } : {}) })
  }
  const running = [...last.values()].filter(x => now - x.t <= runningS * 1000)
  const wf = running.filter(x => x.w).sort((a, b) => b.t - a.t)[0]?.w
  return { running: running.length, total: last.size, ...(wf ? { workflow: wf } : {}) }
}


export type Rates = Record<string, { in: number; out: number; cache_read: number; cache_write_5m: number }>

export type Config = {
  projects_root: string
  cache_file: string
  node: string
  refresh_s: number
  windows_s: number[]
  band_window_s: number
  spark_min: number
  bucket_s: number
  top_n: number
  count: CountMode
  compact_history_hours: number
  first_read_mb: number
  shared_lib: string
  worktree_markers: string[]
  band: { items: string[]; scopes: string[] }
  status_line: { items: string[]; scopes: string[] }
  launcher?: Launcher
  handoff?: HandoffCfg
  context: {
    window_fallback: number
    autocompact_pct_fallback: number
    warn_tokens: number
    handoff_tokens: number
    handoff_near_tokens: number
    growth_window_s: number
  }
  idle_compact: { min_tokens: number; idle_min: number; show_after_idle_min: number }
  colors: Record<string, string>
  labels: Record<string, string>
  rates: Rates
}

export const SCOPES = ['conv', 'conv_all', 'agents', 'workflows', 'project', 'all'] as const

// ---------- numbers ----------

export const tokensOf = (u: Usage, mode: CountMode) => u.inp + u.cw + u.out + (mode === 'all' ? u.cr : 0)

const rateFor = (rates: Rates, model: string) => {
  if (rates[model]) return rates[model]
  const m = model.toLowerCase()
  for (const fam of ['fable', 'opus', 'sonnet', 'haiku']) if (m.includes(fam) && rates[fam]) return rates[fam]
  return rates.default ?? { in: 0, out: 0, cache_read: 0, cache_write_5m: 0 }
}

/** List-price dollars of one response (cache writes priced at the 5-minute rate). */
/** A price table, or a function pricing one response (the shared mods/usage price table). */
export type Price = Rates | ((e: Ev) => number)

export const costOf = (e: Ev, rates: Price) => {
  if (typeof rates === 'function') return rates(e)
  const r = rateFor(rates, e.m)
  return (e.u.inp * r.in + e.u.cw * r.cache_write_5m + e.u.cr * r.cache_read + e.u.out * r.out) / 1e6
}

/** French number: 120, 2,1 k, 41 k, 1,2 M. */
export const fmtTok = (n: number) => {
  const a = Math.abs(n)
  const one = (x: number) => (x < 10 ? x.toFixed(1).replace('.', ',').replace(/,0$/, '') : String(Math.round(x)))
  if (a < 1000) return String(Math.round(n))
  if (a < 1e6) return `${one(n / 1000)} k`
  return `${one(n / 1e6)} M`
}
export const fmtUsd = (n: number) => `${n < 10 ? n.toFixed(2) : Math.round(n).toString()} $`.replace('.', ',')
export const fmtPct = (n: number) => `${Math.round(n)} %`
export const hhmm = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---------- scopes ----------

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`)

/** Repo key of a working directory: a worktree folder (".claude/worktrees/x", ...) counts as its repo. */
export const repoKey = (cwd: string | undefined, markers: string[]) => {
  if (!cwd) return '?'
  let p = norm(cwd)
  for (const m of markers) {
    const i = p.toLowerCase().indexOf(m.toLowerCase())
    if (i > 0) p = p.slice(0, i)
  }
  return p
}
export const repoName = (key: string) => key.split('/').filter(Boolean).pop() ?? key

export type ScopeCtx = { session?: string; repo?: string; repoOf: (s: string) => string | undefined }

export const inScope = (scope: ScopeId, e: Ev, c: ScopeCtx) => {
  switch (scope) {
    case 'conv':
      return e.s === c.session && !e.a
    case 'conv_all':
      return e.s === c.session
    case 'agents':
      return e.s === c.session && !!e.a
    case 'workflows':
      return e.s === c.session && !!e.w
    case 'project':
      return !!c.repo && c.repoOf(e.s) === c.repo
    case 'all':
      return true
  }
}


/** Sliding-window rate: the events with t in (now - w, now], over w seconds. */
export const rateOf = (events: Ev[], now: number, wS: number, mode: CountMode, rates: Price): Rate => {
  const from = now - wS * 1000
  let tokens = 0
  let usd = 0
  let calls = 0
  for (const e of events) {
    if (e.t <= from || e.t > now) continue
    tokens += tokensOf(e.u, mode)
    usd += costOf(e, rates)
    calls++
  }
  const tps = tokens / wS
  return { w: wS, tokens, tps, tpm: tps * 60, tph: tps * 3600, usdPerH: (usd / wS) * 3600, calls }
}

/** Tokens per bucket over the last `minutes`, oldest first. */
export const spark = (events: Ev[], now: number, minutes: number, bucketS: number, mode: CountMode) => {
  const n = Math.max(1, Math.round((minutes * 60) / bucketS))
  const out = new Array<number>(n).fill(0)
  const start = now - n * bucketS * 1000
  for (const e of events) {
    if (e.t <= start || e.t > now) continue
    const i = Math.min(n - 1, Math.floor((e.t - start) / (bucketS * 1000)))
    out[i] += tokensOf(e.u, mode)
  }
  return out
}
export const bucketOf = (t: number, now: number, minutes: number, bucketS: number) => {
  const n = Math.max(1, Math.round((minutes * 60) / bucketS))
  const start = now - n * bucketS * 1000
  if (t <= start || t > now) return -1
  return Math.min(n - 1, Math.floor((t - start) / (bucketS * 1000)))
}
const BARS = '▁▂▃▄▅▆▇█'
export const sparkline = (values: number[]) => {
  const max = Math.max(0, ...values)
  return values.map(v => (v <= 0 ? ' ' : BARS[Math.min(7, Math.floor((v / max) * 7.999))])).join('')
}
export const markerLine = (n: number, marks: number[], ch = '▲') => {
  const a = new Array<string>(n).fill(' ')
  for (const i of marks) if (i >= 0 && i < n) a[i] = ch
  return a.join('')
}

// ---------- the view the scanner hands to the mod ----------


const titleOf = (m: SessionMeta | undefined, s: string) => m?.title || s.slice(0, 8)

/** Context growth of the main thread, tokens per minute, over the last `wS` seconds; none across a compaction. */
export const growthTpm = (samples: [number, number][], now: number, wS: number) => {
  const from = now - wS * 1000
  const xs = samples.filter(([t]) => t > from && t <= now)
  if (xs.length < 2) return undefined
  let k = xs.length - 1
  while (k > 0 && xs[k - 1][1] <= xs[k][1]) k--
  const a = xs[k]
  const b = xs[xs.length - 1]
  if (b[0] <= a[0] || b[1] <= a[1]) return undefined
  return ((b[1] - a[1]) / (b[0] - a[0])) * 60000
}

export const buildView = (
  events: Ev[],
  sessions: Record<string, SessionMeta>,
  cfg: Pick<Config, 'windows_s' | 'spark_min' | 'bucket_s' | 'count' | 'rates' | 'top_n' | 'compact_history_hours' | 'worktree_markers'> & {
    context?: { growth_window_s: number }
    sections?: { running_s?: number }
  },
  opts: { now: number; session?: string; cwd?: string; files?: number; ms?: number; price?: (e: Ev) => number; lib?: string },
): View => {
  const { now, session } = opts
  const price: Price = opts.price ?? cfg.rates
  const repoOf = (s: string) => sessions[s]?.repo ?? (sessions[s]?.cwd ? repoKey(sessions[s].cwd, cfg.worktree_markers) : undefined)
  const repo = opts.cwd ? repoKey(opts.cwd, cfg.worktree_markers) : session ? repoOf(session) : undefined
  const ctx: ScopeCtx = { session, repo, repoOf }
  const ids = SCOPES.filter(id => (session ? true : id === 'project' ? !!repo : id === 'all'))
  const longest = Math.max(...cfg.windows_s)
  const scopes = ids.map(id => {
    const evs = events.filter(e => inScope(id, e, ctx))
    return {
      id,
      rates: cfg.windows_s.map(w => rateOf(evs, now, w, cfg.count, price)),
      spark: spark(evs, now, cfg.spark_min, cfg.bucket_s, cfg.count),
    }
  })

  // hottest sessions over the longest window
  const bySession = new Map<string, Ev[]>()
  for (const e of events) {
    if (e.t <= now - longest * 1000 || e.t > now) continue
    const l = bySession.get(e.s) ?? []
    l.push(e)
    bySession.set(e.s, l)
  }
  const since = now - cfg.compact_history_hours * 3600000
  const compOf = (s: string) => (sessions[s]?.compactions ?? []).filter(c => c.t > since && !c.a)
  const top: TopRow[] = [...bySession.entries()]
    .map(([s, evs]) => {
      const r = rateOf(evs, now, longest, cfg.count, price)
      const m = sessions[s]
      const cs = compOf(s)
      return {
        s,
        title: titleOf(m, s),
        repo: repoName(repoOf(s) ?? '?'),
        tps: r.tps,
        usdPerH: r.usdPerH,
        ctx: m?.ctx,
        compactions: cs.length,
        lastCompact: cs.at(-1)?.t,
        last: m?.last ?? 0,
        isThis: s === session,
      }
    })
    .sort((a, b) => b.tps - a.tps)
    .slice(0, cfg.top_n)

  const byRepo = new Map<string, { evs: Ev[]; sessions: Set<string> }>()
  for (const [s, evs] of bySession) {
    const k = repoOf(s) ?? '?'
    const g = byRepo.get(k) ?? { evs: [], sessions: new Set() }
    g.evs.push(...evs)
    g.sessions.add(s)
    byRepo.set(k, g)
  }
  const projects = [...byRepo.entries()]
    .map(([k, g]) => {
      const r = rateOf(g.evs, now, longest, cfg.count, price)
      return { repo: repoName(k), tps: r.tps, usdPerH: r.usdPerH, sessions: g.sessions.size }
    })
    .sort((a, b) => b.tps - a.tps)

  const compactions: CompactRow[] = Object.values(sessions)
    .map(m => ({ s: m.s, title: titleOf(m, m.s), repo: repoName(repoOf(m.s) ?? '?'), isThis: m.s === session, items: compOf(m.s) }))
    .filter(r => r.items.length > 0)
    .sort((a, b) => Number(b.isThis) - Number(a.isThis) || (b.items.at(-1)?.t ?? 0) - (a.items.at(-1)?.t ?? 0))

  const marksFor = (pick: (s: string) => boolean) =>
    Object.values(sessions)
      .filter(m => pick(m.s))
      .flatMap(m => m.compactions.map(c => bucketOf(c.t, now, cfg.spark_min, cfg.bucket_s)))
      .filter(i => i >= 0)
  const me = session ? sessions[session] : undefined
  return {
    now,
    windows: cfg.windows_s,
    spark_min: cfg.spark_min,
    bucket_s: cfg.bucket_s,
    count: cfg.count,
    repo: repo ? repoName(repo) : undefined,
    scopes,
    top,
    projects,
    compactions,
    marks: {
      conv: marksFor(s => s === session),
      project: marksFor(s => !!repo && repoOf(s) === repo),
      all: marksFor(() => true),
    },
    conv: me
      ? {
          ctx: me.ctx,
          ctxT: me.ctxT,
          last: me.last,
          title: me.title,
          growthTpm: growthTpm(me.samples, now, cfg.context?.growth_window_s ?? 600),
          agents: agentsOf(events, session, now, cfg.sections?.running_s ?? 120),
          ...(me.pr ? { pr: me.pr } : {}),
        }
      : undefined,
    files: opts.files ?? 0,
    ms: opts.ms ?? 0,
    lib: opts.lib ?? 'band',
  }
}

// ---------- this conversation's context ----------

export type Ctx = {
  tokens?: number
  window: number
  usedPct?: number
  threshold: number
  thresholdPct: number
  thresholdSource: 'engine' | 'config'
  toCompact?: number
  toCompactPct?: number
  etaMin?: number
  relay: 'ok' | 'near' | 'over'
  level: 'ok' | 'warn' | 'bad'
  idleEtaMin?: number
  idleMin?: number
}

export const contextInfo = (
  a: { tokens?: number; window?: number; percent?: number; autoCompactThreshold?: number; growthTpm?: number; last?: number; now: number },
  c: Config['context'],
  idle: Config['idle_compact'],
): Ctx => {
  const window = a.window || c.window_fallback
  const fromEngine = typeof a.autoCompactThreshold === 'number' && a.autoCompactThreshold > 0
  const threshold = fromEngine ? (a.autoCompactThreshold as number) : Math.round((window * c.autocompact_pct_fallback) / 100)
  const t = a.tokens
  const usedPct = a.percent ?? (t !== undefined ? (t * 100) / window : undefined)
  const toCompact = t !== undefined ? Math.max(0, threshold - t) : undefined
  const etaMin = toCompact !== undefined && a.growthTpm && a.growthTpm > 0 ? toCompact / a.growthTpm : undefined
  const relay = t === undefined ? 'ok' : t >= c.handoff_tokens ? 'over' : t >= c.handoff_near_tokens ? 'near' : 'ok'
  const level = t === undefined ? 'ok' : t >= c.handoff_tokens ? 'bad' : t >= c.warn_tokens ? 'warn' : 'ok'
  const idleMin = a.last ? Math.max(0, (a.now - a.last) / 60000) : undefined
  const idleEtaMin = t !== undefined && t >= idle.min_tokens && idleMin !== undefined ? Math.max(0, idle.idle_min - idleMin) : undefined
  return {
    tokens: t,
    window,
    usedPct,
    threshold,
    thresholdPct: (threshold * 100) / window,
    thresholdSource: fromEngine ? 'engine' : 'config',
    toCompact,
    toCompactPct: toCompact !== undefined ? (toCompact * 100) / window : undefined,
    etaMin,
    relay,
    level,
    idleEtaMin,
    idleMin,
  }
}

// ---------- band text ----------

export type BandPart = { text: string; tone?: 'ok' | 'warn' | 'bad' | 'dim' }

const L = (labels: Record<string, string>, k: string) => labels[k] ?? k

export const bandParts = (
  view: View | undefined,
  ctx: Ctx | undefined,
  week: number | undefined,
  spec: { items: string[]; scopes: string[] },
  cfg: Pick<Config, 'labels' | 'band_window_s' | 'idle_compact'>,
): BandPart[] => {
  const lb = cfg.labels
  const out: BandPart[] = []
  for (const item of spec.items) {
    if (item === 'ctx' && ctx?.usedPct !== undefined) {
      out.push({ text: `${L(lb, 'ctx')} ${fmtPct(ctx.usedPct)} (${fmtTok(ctx.tokens ?? 0)})`, tone: ctx.level })
    } else if (item === 'compact' && ctx?.toCompactPct !== undefined) {
      const eta = ctx.etaMin !== undefined ? ` · ${L(lb, 'compact_in')} ~${Math.max(1, Math.round(ctx.etaMin))} min` : ''
      out.push({ text: `${L(lb, 'compact_at')} ${fmtPct(ctx.thresholdPct)} · ${L(lb, 'left')} ${fmtPct(ctx.toCompactPct)}${eta}`, tone: ctx.toCompactPct < 5 ? 'bad' : ctx.toCompactPct < 15 ? 'warn' : undefined })
    } else if (item === 'relay' && ctx && ctx.relay !== 'ok') {
      out.push({ text: L(lb, ctx.relay === 'over' ? 'relay_over' : 'relay_near'), tone: ctx.relay === 'over' ? 'bad' : 'warn' })
    } else if (item === 'idle' && ctx?.idleEtaMin !== undefined && (ctx.idleMin ?? 0) >= cfg.idle_compact.show_after_idle_min) {
      out.push({ text: `${L(lb, 'idle_compact_in')} ~${Math.round(ctx.idleEtaMin)} min`, tone: 'warn' })
    } else if (item === 'rates' && view) {
      for (const id of spec.scopes) {
        const row = view.scopes.find(r => r.id === id)
        if (!row) continue
        const r = row.rates.find(x => x.w === cfg.band_window_s) ?? row.rates[0]
        out.push({ text: `${L(lb, id)} ${fmtTok(r.tps)} tok/s` })
      }
    } else if (item === 'week' && week !== undefined) {
      out.push({ text: `${L(lb, 'week')} ${fmtPct(week)}`, tone: week >= 90 ? 'bad' : week >= 75 ? 'warn' : undefined })
    }
  }
  return out
}
export const bandText = (parts: BandPart[]) => parts.map(p => p.text).join(' · ')

// ---------- config ----------

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
export const deepMerge = <T>(base: T, over: unknown): T => {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : (over as T))
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith('_')) continue
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}
export const expandHome = (p: string, home: string) => (p.startsWith('~') ? home.replace(/[\\/]+$/, '') + p.slice(1) : p)

export const compactLabel = (c: Compaction, labels: Record<string, string>, idleMin: number) => {
  if (c.trigger === 'manual') return L(labels, 'trigger_manual')
  if (c.trigger === 'auto' && (c.gapMin ?? 0) >= idleMin * 0.8) return L(labels, 'trigger_idle')
  if (c.trigger === 'auto') return L(labels, 'trigger_auto')
  return c.trigger === '?' ? L(labels, 'trigger_unknown') : c.trigger
}

// ---------- launcher (the Mods button bar) ----------

export type LauncherItem = { label: string; mod: string; command: string }
export type Launcher = { enabled?: boolean; close_args?: string; items?: LauncherItem[] }
/** One slash command as $.command.list() gives it (name, and the plugin that registered it when known). */
export type CommandSeen = { name: string; plugin?: string }
export type LauncherButton = LauncherItem & { loaded: boolean; open: boolean; hint?: string }
export type LauncherAction = { run: { command: string; args?: string }; open: boolean } | { toast: string }

/** A mod counts as loaded when its command is in this session and, where the engine names the plugin, it is that mod. */
export const isLoaded = (item: LauncherItem, commands: readonly CommandSeen[]) =>
  commands.some(c => c.name === item.command && (!c.plugin || c.plugin === item.mod || c.plugin.startsWith(`${item.mod}@`)))

/** The buttons to draw, in config order; empty when the launcher is off or lists nothing. */
export const launcherButtons = (
  l: Launcher | undefined,
  commands: readonly CommandSeen[],
  open: readonly string[],
  labels: Record<string, string>,
): LauncherButton[] => {
  if (!l || l.enabled === false) return []
  return (l.items ?? [])
    .filter(i => i && i.label && i.mod && i.command)
    .map(i => {
      const loaded = isLoaded(i, commands)
      return {
        ...i,
        loaded,
        open: loaded && open.includes(i.mod),
        ...(loaded ? {} : { hint: (labels.launcher_missing ?? 'not loaded: add mods/{mod} to CLAUDE_CODE_PLUGIN_DIRS').replace('{mod}', i.mod) }),
      }
    })
}

/** What a press does: a mod not loaded explains itself; else open (/<command>) or, when open, close (/<command> <close_args>). */
export const launcherPress = (b: LauncherButton, closeArgs = 'close'): LauncherAction => {
  if (!b.loaded) return { toast: b.hint ?? b.mod }
  return b.open ? { run: { command: b.command, args: closeArgs }, open: false } : { run: { command: b.command }, open: true }
}

/** The open list after a press on `mod`. */
export const toggleOpen = (open: readonly string[], mod: string, isOpen: boolean) =>
  isOpen ? (open.includes(mod) ? [...open] : [...open, mod]) : open.filter(m => m !== mod)

// ---------- hand-off helper (« Passation conseillée ») ----------

export type HandoffCfg = {
  enabled?: boolean
  /** the orange line under the band; false: only the pane's Passation block */
  band?: boolean
  /** context tokens of this conversation from which the line shows (the RESUME rule: 250 K) */
  threshold_tokens: number
  /** also show it when the forecast puts auto-compact within this many minutes */
  eta_min: number
  /** the slash command « Préparer RESUME » runs, without the slash, and its arguments */
  command: string
  args?: string
  /** RESUME files looked for, relative to the session's folder, then to its repo root; the first found wins */
  files: string[]
  history_n: number
  preview_chars: number
}

export type HandoffAdvice = { show: boolean; reasons: ('tokens' | 'eta')[] }

/** The line shows when the context reached threshold_tokens or the auto-compact forecast is within eta_min. */
export const handoffAdvice = (ctx: Ctx | undefined, h: HandoffCfg | undefined): HandoffAdvice => {
  if (!ctx || !h || h.enabled === false) return { show: false, reasons: [] }
  const reasons: HandoffAdvice['reasons'] = []
  if (ctx.tokens !== undefined && ctx.tokens >= h.threshold_tokens) reasons.push('tokens')
  if (ctx.etaMin !== undefined && h.eta_min > 0 && ctx.etaMin <= h.eta_min) reasons.push('eta')
  return { show: reasons.length > 0, reasons }
}

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m)

export const handoffReason = (a: HandoffAdvice, ctx: Ctx | undefined, h: HandoffCfg, labels: Record<string, string>) =>
  a.reasons
    .map(r =>
      r === 'tokens'
        ? fill(L(labels, 'handoff_reason_tokens'), { tokens: fmtTok(ctx?.tokens ?? 0), threshold: fmtTok(h.threshold_tokens) })
        : fill(L(labels, 'handoff_reason_eta'), { min: String(Math.max(1, Math.round(ctx?.etaMin ?? 0))) }),
    )
    .join(' · ')

/** "mis à jour il y a 3 h", or the absent label when there is no file. */
export const ageText = (mtime: number | undefined, now: number, labels: Record<string, string>) => {
  if (mtime === undefined) return L(labels, 'handoff_absent')
  const min = Math.max(0, (now - mtime) / 60000)
  const ago = min < 1 ? "à l'instant" : min < 60 ? `il y a ${Math.round(min)} min` : min < 48 * 60 ? `il y a ${Math.round(min / 60)} h` : `il y a ${Math.round(min / 1440)} j`
  return `${L(labels, 'handoff_updated')} ${ago}`
}

/** Where to look for RESUME: each file under the session's folder, then under its repo root (worktree markers cut). */
export const resumeCandidates = (cwd: string | undefined, files: string[], markers: string[]) => {
  if (!cwd) return []
  const here = norm(cwd)
  const repo = repoKey(cwd, markers)
  const dirs = repo && repo !== '?' && repo !== here ? [here, repo] : [here]
  return dirs.flatMap(d => files.map(f => `${d}/${f.replace(/\\/g, '/').replace(/^\/+/, '')}`))
}

export type HandoffButton = { key: 'handoff-prepare' | 'handoff-open'; label: string; enabled: boolean; hint?: string }

/** The two buttons. « Préparer » is greyed when the command is not in this session; « Ouvrir » always answers. */
export const handoffButtons = (h: HandoffCfg, commands: readonly CommandSeen[], resume: { path?: string; mtime?: number } | undefined, labels: Record<string, string>): HandoffButton[] => {
  const has = commands.some(c => c.name === h.command)
  return [
    {
      key: 'handoff-prepare',
      label: L(labels, 'handoff_prepare'),
      enabled: has,
      ...(has ? {} : { hint: fill(L(labels, 'handoff_missing'), { command: h.command }) }),
    },
    {
      key: 'handoff-open',
      label: L(labels, 'handoff_open'),
      enabled: true,
      ...(resume?.path && resume.mtime !== undefined ? {} : { hint: L(labels, 'handoff_absent') }),
    },
  ]
}

export type HandoffEvent = { t: number; kind: 'compact' | 'handoff' | 'resume'; text: string }

/** The last `n` hand-offs (/handoff runs, RESUME writes during this conversation) and compactions, newest first. */
export const recentHandoffs = (
  compactions: Compaction[],
  ran: number[],
  resume: { mtime?: number } | undefined,
  since: number | undefined,
  n: number,
  labels: Record<string, string>,
  idleMin: number,
): HandoffEvent[] => {
  const out: HandoffEvent[] = [
    ...compactions.filter(c => !c.a).map(c => ({
      t: c.t,
      kind: 'compact' as const,
      text: `${L(labels, 'handoff_compact')} ${compactLabel(c, labels, idleMin)}${c.pre ? ` ${fmtTok(c.pre)}→${fmtTok(c.post ?? 0)}` : ''}`,
    })),
    ...ran.map(t => ({ t, kind: 'handoff' as const, text: L(labels, 'handoff_ran') })),
  ]
  if (resume?.mtime !== undefined && (since === undefined || resume.mtime >= since)) out.push({ t: resume.mtime, kind: 'resume', text: L(labels, 'handoff_written') })
  return out.sort((a, b) => b.t - a.t).slice(0, Math.max(0, n))
}
