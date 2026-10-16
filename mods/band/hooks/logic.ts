// band mod ("Jauge"): the pure math. Rates over sliding windows, scope grouping (worktree -> repo), context and
// compaction figures, sparklines and the French band text. No I/O here: the scanner (scanner/scan.mjs) and the hooks
// module (register.tsx) both import it, and node --test runs it directly (Node 22.18+ strips the types).

import type { Compaction, CompactRow, CountMode, Ev, Rate, ScopeId, ScopeRow, SessionMeta, TopRow, Usage, View } from '../types'

export type { Compaction, CompactRow, CountMode, Ev, Rate, ScopeId, ScopeRow, SessionMeta, TopRow, Usage, View }


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
  worktree_markers: string[]
  band: { items: string[]; scopes: string[] }
  status_line: { items: string[]; scopes: string[] }
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
export const costOf = (e: Ev, rates: Rates) => {
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
export const rateOf = (events: Ev[], now: number, wS: number, mode: CountMode, rates: Rates): Rate => {
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
  },
  opts: { now: number; session?: string; cwd?: string; files?: number; ms?: number },
): View => {
  const { now, session } = opts
  const repoOf = (s: string) => sessions[s]?.repo ?? (sessions[s]?.cwd ? repoKey(sessions[s].cwd, cfg.worktree_markers) : undefined)
  const repo = opts.cwd ? repoKey(opts.cwd, cfg.worktree_markers) : session ? repoOf(session) : undefined
  const ctx: ScopeCtx = { session, repo, repoOf }
  const ids = SCOPES.filter(id => (session ? true : id === 'project' ? !!repo : id === 'all'))
  const longest = Math.max(...cfg.windows_s)
  const scopes = ids.map(id => {
    const evs = events.filter(e => inScope(id, e, ctx))
    return {
      id,
      rates: cfg.windows_s.map(w => rateOf(evs, now, w, cfg.count, cfg.rates)),
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
      const r = rateOf(evs, now, longest, cfg.count, cfg.rates)
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
      const r = rateOf(g.evs, now, longest, cfg.count, cfg.rates)
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
      ? { ctx: me.ctx, ctxT: me.ctxT, last: me.last, title: me.title, growthTpm: growthTpm(me.samples, now, cfg.context?.growth_window_s ?? 600) }
      : undefined,
    files: opts.files ?? 0,
    ms: opts.ms ?? 0,
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
