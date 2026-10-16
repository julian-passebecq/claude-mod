// machine mod: the pure part. Metrics from a sample, the "agents en parallèle conseillés" rule, French formatting,
// the band text and the /machine summary. No I/O: register.tsx and node --test both import it.
import type { GpuInfo, RunnerInfo, Sample } from '../types'

export type { GpuInfo, RunnerInfo, Sample }

export type Rule = { metric: string; op: '>' | '>=' | '<' | '<='; value: number; delta: number; label: string }
export type Cap = { id: string; value: number; minus?: string; label: string }
export type Config = {
  python: string
  interval_s: number
  min_interval_s: number
  first_delta_ms: number
  top_n: number
  families: Record<string, string[]>
  disks_exclude: string[]
  disk_warn_pct: number
  gpu: { source: string; refresh_s: number; perf_counter: string }
  ci: { enabled: boolean; scanner: string; config: string; backends: string[]; refresh_s: number; runner_process: string[] }
  advice: { base: number; floor: number; ceiling: number; rules: Rule[]; caps: Cap[] }
  band: { interval_s: number; items: string[] }
  colors: Record<string, string>
  levels: { warn: number; bad: number }
  labels: Record<string, string>
}

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Deep merge; arrays and scalars of `over` replace; keys starting with _ in `over` are ignored. */
export const deepMerge = <T,>(base: T, over: unknown): T => {
  if (!isObj(base) || !isObj(over)) return base
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith('_')) continue
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}

export const expandHome = (p: string, home: string) => (p.startsWith('~') && home ? home.replace(/\\/g, '/') + p.slice(1) : p).replace(/\\/g, '/')

/** Seconds between two samples, never below the configured floor. */
export const intervalMs = (c: Config, band = false) => Math.max(c.min_interval_s, band ? c.band.interval_s : c.interval_s) * 1000

// ------------------------------------------------------------------ metrics and advice

export type Metrics = Partial<Record<'cpu' | 'ram' | 'gpu' | 'disk_free_gb' | 'ci_running' | 'ci_pending' | 'runner_children', number>>

export const metrics = (s: Sample | null, gpu: GpuInfo | null, r: RunnerInfo | null, c: Config): Metrics => {
  const m: Metrics = {}
  if (s?.cpu.total != null) m.cpu = s.cpu.total
  if (s?.ram) m.ram = s.ram.pct
  const utils = (gpu?.gpus ?? []).map(g => g.util).filter((u): u is number => typeof u === 'number')
  if (utils.length) m.gpu = Math.max(...utils)
  if (s?.disks.length) m.disk_free_gb = Math.min(...s.disks.map(d => d.free / 1e9))
  if (s?.procs.runner.present) m.runner_children = s.procs.runner.children
  const bs = (r?.backends ?? []).filter(b => !c.ci.backends.length || c.ci.backends.includes(b.id))
  const sum = (k: 'running' | 'pending') => {
    const v = bs.map(b => b.jobs?.[k]).filter((x): x is number => typeof x === 'number')
    return v.length ? v.reduce((a, b) => a + b, 0) : undefined
  }
  const run = sum('running')
  const pend = sum('pending')
  if (run !== undefined) m.ci_running = run
  if (pend !== undefined) m.ci_pending = pend
  return m
}

const test = (v: number, op: Rule['op'], x: number) => (op === '>' ? v > x : op === '>=' ? v >= x : op === '<' ? v < x : v <= x)

export type Reason = { label: string; effect: string }
export type Advice = { n: number; base: number; reasons: Reason[]; capped: string | undefined; unknown: string[] }

/** base + first matching rule per metric, then caps, then [floor, ceiling]. */
export const advise = (m: Metrics, a: Config['advice']): Advice => {
  let n = a.base
  const reasons: Reason[] = []
  const done = new Set<string>()
  const unknown = new Set<string>()
  for (const r of a.rules) {
    const v = m[r.metric as keyof Metrics]
    if (v === undefined) {
      unknown.add(r.metric)
      continue
    }
    if (done.has(r.metric) || !test(v, r.op, r.value)) continue
    done.add(r.metric)
    n += r.delta
    reasons.push({ label: r.label, effect: r.delta > 0 ? `+${r.delta}` : String(r.delta) })
  }
  let capped: string | undefined
  for (const cap of a.caps) {
    const minus = cap.minus ? m[cap.minus as keyof Metrics] : 0
    if (minus === undefined) unknown.add(cap.minus!)
    const limit = cap.value - (minus ?? 0)
    if (n > limit) {
      n = limit
      capped = cap.label
      reasons.push({ label: cap.label, effect: `≤ ${limit}` })
    }
  }
  n = Math.max(a.floor, Math.min(a.ceiling, n))
  return { n, base: a.base, reasons, capped, unknown: [...unknown] }
}

// ------------------------------------------------------------------ formatting (French)

const fr = (x: number, d = 1) => x.toFixed(d).replace('.', ',').replace(/,0+$/, '')

export const fmtPct = (x: number | null | undefined) => (x == null ? '?' : `${Math.round(x)} %`)

export const fmtBytes = (b: number) => {
  if (b >= 1e12) return `${fr(b / 1e12)} To`
  if (b >= 1e9) return `${fr(b / 1e9)} Go`
  if (b >= 1e6) return `${Math.round(b / 1e6)} Mo`
  return `${Math.round(b / 1e3)} ko`
}

export const level = (pct: number | null | undefined, l: Config['levels']) =>
  pct == null ? 'dim' : pct >= l.bad ? 'bad' : pct >= l.warn ? 'warn' : 'ok'

const BLOCKS = '▁▂▃▄▅▆▇█'
/** One character per core, ▁ (idle) to █ (busy). */
export const coreBar = (cores: number[]) =>
  cores.map(p => BLOCKS[Math.max(0, Math.min(7, Math.floor((p / 100) * 8 - 1e-9)))] ?? BLOCKS[0]).join('')

/** A 10-cell bar for a %. */
export const bar = (pct: number | null | undefined, width = 10) => {
  const f = Math.round(Math.max(0, Math.min(100, pct ?? 0)) / (100 / width))
  return '█'.repeat(f) + '░'.repeat(width - f)
}

export const hms = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export const gpuText = (g: GpuInfo | null, L: Record<string, string>) => {
  if (!g || g.source === 'none' || !g.gpus.length) return L.gpu_none ?? 'non disponible'
  return g.gpus
    .map(x => {
      const mem = x.mem_used_mb != null && x.mem_total_mb ? ` · VRAM ${fr(x.mem_used_mb / 1024)}/${fr(x.mem_total_mb / 1024)} Go` : ''
      const temp = x.temp_c != null ? ` · ${Math.round(x.temp_c)} °C` : ''
      return `${x.name} ${fmtPct(x.util)}${mem}${temp}`
    })
    .join(' ; ')
}

export const ciText = (r: RunnerInfo | null, m: Metrics, s: Sample | null, c: Config) => {
  const L = c.labels
  if (!c.ci.enabled) return L.ci_off ?? 'désactivé'
  const parts: string[] = []
  if (r?.error) parts.push(`ci : ${r.error}`)
  if (m.ci_running !== undefined) parts.push(`${m.ci_running} job(s) ${L.running ?? 'en cours'}`)
  if (m.ci_pending !== undefined) parts.push(`${m.ci_pending} ${L.pending ?? 'en attente'}`)
  if (s) parts.push(s.procs.runner.present ? `processus local présent (${s.procs.runner.children} enfant(s))` : 'processus local absent')
  return parts.join(' · ') || '?'
}

// ------------------------------------------------------------------ band and summary

export type Part = { text: string; tone?: string }

export const bandParts = (s: Sample | null, gpu: GpuInfo | null, r: RunnerInfo | null, c: Config): Part[] => {
  if (!s) return []
  const m = metrics(s, gpu, r, c)
  const L = c.labels
  const out: Part[] = []
  for (const it of c.band.items) {
    if (it === 'advice') {
      const a = advise(m, c.advice)
      out.push({ text: `${L.advice_short ?? 'agents conseillés'} ${a.n}`, tone: a.n < a.base ? 'warn' : 'ok' })
    } else if (it === 'cpu' && m.cpu !== undefined) out.push({ text: `${L.cpu} ${fmtPct(m.cpu)}`, tone: level(m.cpu, c.levels) })
    else if (it === 'ram' && m.ram !== undefined) out.push({ text: `${L.ram} ${fmtPct(m.ram)}`, tone: level(m.ram, c.levels) })
    else if (it === 'gpu' && m.gpu !== undefined) out.push({ text: `${L.gpu} ${fmtPct(m.gpu)}`, tone: level(m.gpu, c.levels) })
    else if (it === 'disk' && m.disk_free_gb !== undefined) out.push({ text: `disque ${fr(m.disk_free_gb, 0)} Go ${L.free ?? 'libres'}` })
    else if (it === 'ci' && c.ci.enabled && m.ci_running !== undefined)
      out.push({ text: `CI ${m.ci_running} ${L.running ?? 'en cours'}${m.ci_pending ? ` / ${m.ci_pending} ${L.pending ?? 'en attente'}` : ''}` })
  }
  return out
}

export const bandText = (parts: Part[]) => parts.map(p => p.text).join(' · ')

export const summary = (s: Sample | null, gpu: GpuInfo | null, r: RunnerInfo | null, c: Config) => {
  if (!s) return 'machine : pas encore de mesure'
  const m = metrics(s, gpu, r, c)
  const a = advise(m, c.advice)
  const L = c.labels
  const lines = [
    `${L.advice} : ${a.n}${a.reasons.length ? ` (${a.reasons.map(x => `${x.label} ${x.effect}`).join(', ')})` : ''}`,
    `${L.cpu} ${fmtPct(m.cpu)} sur ${s.ncpu} cœurs · ${L.ram} ${s.ram ? `${fmtPct(s.ram.pct)} (${fmtBytes(s.ram.used)} / ${fmtBytes(s.ram.total)})` : '?'} · ${L.gpu} ${gpuText(gpu, L)}`,
    `${L.disks} : ${s.disks.map(d => `${d.drive} ${fmtBytes(d.free)} ${L.free ?? 'libres'}`).join(' · ') || '?'}`,
    `${L.ci} : ${ciText(r, m, s, c)}`,
  ]
  return lines.join('\n')
}

/** Arguments of /machine: '' | refresh | ci. */
export const parseArgs = (args: string) => {
  const w = args.trim().toLowerCase()
  return { refresh: w === 'refresh' || w === 'actualiser', ci: w === 'ci' || w === 'runner' }
}
