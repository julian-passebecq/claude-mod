// Pure helpers of the ci mod's « Diagramme » view: filters, lanes, text segments and the static SVG overview.
// No `$`, so tests call them directly. Labels and colors come from the config (pipelines.labels / colors /
// svg_colors); the French defaults below apply only to keys the config leaves out.
import type { App, Diagram, DiagramLabels, GroupBy, Job, Run, RunStatus, Stats, Who, WhoFilter } from '../types'
import { MIN_SAMPLES, estimateOf, etaOf } from '../lib/core/estimate.mjs'
import { COLORS, SYMBOLS, axis as ganttAxis, gantt as coreGantt, legend as ganttLegend } from '../lib/core/gantt.mjs'

export const DEFAULT_LABELS: Required<Omit<DiagramLabels, 'status'>> & { status: Record<RunStatus, string> } = {
  tab_routing: 'Routage',
  tab_diagram: 'Diagramme',
  all: 'Tout',
  claude: 'Claude Code',
  codex: 'Codex',
  unknown: 'inconnu',
  by_host: 'par hôte',
  by_app: 'par app',
  by_conv: 'par conversation',
  no_conv: 'sans conversation connue',
  today: "aujourd'hui",
  week: '7 jours',
  pass_rate: 'réussite',
  minutes: 'min',
  queue: 'file du runner local',
  last_runs: 'derniers runs',
  no_runs: 'aucun run lu',
  not_fetched: "non lu (gh/glab absent, pas d'accès ou pas de CI)",
  status: { success: 'vert', failed: 'rouge', running: 'en cours', queued: 'en attente', cancelled: 'annulé', skipped: 'sauté' },
}
export const DEFAULT_COLORS: Record<RunStatus, string> = {
  success: 'success', failed: 'error', running: 'warning', queued: 'warning', cancelled: 'subtle', skipped: 'subtle',
}
export const DEFAULT_SVG: Record<string, string> = {
  success: '#2da44e', failed: '#cf222e', running: '#bf8700', queued: '#bf8700', cancelled: '#8c959f', skipped: '#8c959f',
  line: '#8c959f', text: '#8c959f', box: '#2f81f7',
}
export const MARK: Record<RunStatus, string> = { success: '✔', failed: '✘', running: '●', queued: '◌', cancelled: '⊘', skipped: '–' }

export const labelsOf = (d: Pick<Diagram, 'labels'> | undefined) => ({
  ...DEFAULT_LABELS,
  ...(d?.labels ?? {}),
  status: { ...DEFAULT_LABELS.status, ...(d?.labels?.status ?? {}) },
})
export type L = ReturnType<typeof labelsOf>
export const colorOf = (d: Pick<Diagram, 'colors'> | undefined, s: RunStatus): string => d?.colors?.[s] ?? DEFAULT_COLORS[s]

/** Filter buttons, Claude Code first (the default), then the Codex button, then everything and the unattributed. */
export const WHO_FILTERS: WhoFilter[] = ['claude', 'codex', 'all', 'unknown']
/** Claude only unless the config (pipelines.default_who) says otherwise. */
export const DEFAULT_WHO: WhoFilter = 'claude'
/** The filter in use: the viewer's choice, else the config default, else Claude only. */
export const effectiveWho = (chosen: WhoFilter | '' | undefined, d: Pick<Diagram, 'default_who'> | undefined): WhoFilter =>
  chosen && (WHO_FILTERS as string[]).includes(chosen) ? chosen
    : d?.default_who && (WHO_FILTERS as string[]).includes(d.default_who) ? d.default_who
    : DEFAULT_WHO
export const GROUPS: GroupBy[] = ['host', 'app', 'conv']
export const whoLabel = (L: L, w: WhoFilter): string => (w === 'all' ? L.all : L[w])
export const groupLabel = (L: L, g: GroupBy): string => (g === 'host' ? L.by_host : g === 'app' ? L.by_app : L.by_conv)

/** `/ci diagramme [refresh] [claude|codex|inconnu|tout] [hote|app|conv]` → which filter words were typed. */
export const parseDiagramWords = (words: string[]): { refresh: boolean; who?: WhoFilter; group?: GroupBy } => {
  const out: { refresh: boolean; who?: WhoFilter; group?: GroupBy } = { refresh: false }
  for (const raw of words) {
    const w = raw.toLowerCase()
    if (w === 'refresh' || w === 'check') out.refresh = true
    else if (w === 'tout' || w === 'all') out.who = 'all'
    else if (w === 'claude') out.who = 'claude'
    else if (w === 'codex') out.who = 'codex'
    else if (w === 'inconnu' || w === 'unknown') out.who = 'unknown'
    else if (w === 'hote' || w === 'hôte' || w === 'host') out.group = 'host'
    else if (w === 'app' || w === 'apps' || w === 'repo') out.group = 'app'
    else if (w === 'conv' || w === 'conversation' || w === 'session') out.group = 'conv'
  }
  return out
}

export const fmtDur = (s: number | null | undefined): string => {
  if (s == null) return '?'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export const ago = (iso: string | null | undefined, now: number): string => {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return '?'
  const m = Math.max(0, Math.round((now - t) / 60000))
  if (m < 60) return `il y a ${m} min`
  if (m < 48 * 60) return `il y a ${Math.round(m / 60)} h`
  return `il y a ${Math.round(m / 1440)} j`
}

export const hostLabel = (d: Diagram, id: string): string =>
  d.hosts.find(h => h.id === id)?.label ?? (id === 'gitlab' ? 'GitLab (runner inconnu)' : id)

export const runsOf = (d: Diagram, who: WhoFilter): Run[] =>
  d.apps.flatMap(a => a.runs).filter(r => who === 'all' || r.who === who)

/** One lane = one app on one CI host: its runs newest first. */
export type Lane = { key: string; app: string; backend: string; host: string; runs: Run[] }
export type Group = { key: string; title: string; lanes: Lane[]; runs: Run[] }

const lanesOf = (d: Diagram, runs: Run[]): Lane[] => {
  const m = new Map<string, Lane>()
  for (const r of runs) {
    const key = `${r.app}|${r.backend}`
    let l = m.get(key)
    if (!l) m.set(key, (l = { key, app: r.app, backend: r.backend, host: hostLabel(d, r.backend), runs: [] }))
    l.runs.push(r)
  }
  const ls = [...m.values()]
  for (const l of ls) l.runs.sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
  return ls.sort((a, b) => (b.runs[0]?.created ?? '').localeCompare(a.runs[0]?.created ?? ''))
}

/** Lanes grouped by CI host, by app or by the conversation that opened the PR/MR. */
export const groups = (d: Diagram, who: WhoFilter, by: GroupBy): Group[] => {
  const L = labelsOf(d)
  const runs = runsOf(d, who)
  const m = new Map<string, { title: string; runs: Run[] }>()
  for (const r of runs) {
    const [key, title] = by === 'host'
      ? [r.backend, hostLabel(d, r.backend)]
      : by === 'app'
        ? [r.app, r.app]
        : r.conv
          ? [r.conv.id, `${r.conv.title || r.conv.id}${r.conv.title ? ` · ${r.conv.id.slice(0, 8)}` : ''}${r.conv.project ? ` · ${r.conv.project}` : ''}`]
          : ['', L.no_conv]
    let g = m.get(key)
    if (!g) m.set(key, (g = { title, runs: [] }))
    g.runs.push(r)
  }
  const out = [...m.entries()].map(([key, g]) => ({ key, title: g.title, runs: g.runs, lanes: lanesOf(d, g.runs) }))
  // the "no conversation" group last, the others by most recent run
  return out.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : 0) || (b.lanes[0]?.runs[0]?.created ?? '').localeCompare(a.lanes[0]?.runs[0]?.created ?? ''))
}

export const stats = (runs: Run[]): Stats => {
  const done = runs.filter(r => r.status === 'success' || r.status === 'failed')
  const ok = done.filter(r => r.status === 'success').length
  return {
    runs: runs.length, success: ok, failed: done.length - ok,
    running: runs.filter(r => r.status === 'running' || r.status === 'queued').length,
    pass_rate: done.length ? Math.round((100 * ok) / done.length) : null,
    minutes: Math.round(runs.reduce((s, r) => s + (r.duration_s ?? 0), 0) / 6) / 10,
  }
}
export const statsText = (L: L, s: Stats): string =>
  `${s.runs} runs · ${s.pass_rate == null ? '?' : `${s.pass_rate} %`} ${L.pass_rate} · ${s.failed} ${L.status.failed}` +
  `${s.running ? ` · ${s.running} ${L.status.running}` : ''} · ${s.minutes} ${L.minutes}`

/** A piece of text with an optional run status (the pane colors it). */
export type Seg = { text: string; status?: RunStatus; dim?: boolean; bold?: boolean; color?: string }

/** app ──▶ host ──▶ [stage: job ✔ 1m02, …] ▶ [stage …] ──▶ ✔ vert 1m20 · il y a 2 h, for the lane's newest run. */
export const laneSegs = (L: L, lane: Lane, now: number): Seg[] => {
  const r = lane.runs[0]!
  const segs: Seg[] = [{ text: lane.app, bold: true }, { text: ' ──▶ ', dim: true }, { text: lane.host }]
  if (r.host_inferred) segs.push({ text: '*', dim: true })
  segs.push({ text: ' ──▶ ', dim: true })
  const withJobs = lane.runs.find(x => x.jobs && x.jobs.length)
  const jobs = r.jobs ?? null
  if (jobs && jobs.length) {
    const stages: string[] = []
    for (const j of jobs) if (!stages.includes(j.stage)) stages.push(j.stage)
    stages.forEach((st, i) => {
      if (i) segs.push({ text: ' ▶ ', dim: true })
      segs.push({ text: `[${st}: `, dim: true })
      jobs.filter(j => j.stage === st).forEach((j, k) => {
        if (k) segs.push({ text: ', ', dim: true })
        segs.push({ text: `${j.name} ` })
        segs.push({ text: MARK[j.status], status: j.allow_failure && j.status === 'failed' ? 'running' : j.status })
        segs.push({ text: ` ${fmtDur(j.duration_s)}`, dim: true })
      })
      segs.push({ text: ']', dim: true })
    })
  } else {
    segs.push({ text: withJobs ? '[jobs non lus pour ce run]' : '[jobs non lus]', dim: true })
  }
  segs.push({ text: ' ──▶ ', dim: true })
  segs.push({ text: `${MARK[r.status]} ${L.status[r.status]}`, status: r.status, bold: true })
  segs.push({ text: ` ${fmtDur(r.duration_s)} · ${ago(r.created, now)}`, dim: true })
  return segs
}

/** « derniers runs : ✔✔✘● · claude 6 · codex 2 · inconnu 1 · branche / conversation » for a lane. */
export const historySegs = (L: L, lane: Lane, n = 10): Seg[] => {
  const segs: Seg[] = [{ text: `   ${L.last_runs} : `, dim: true }]
  for (const r of lane.runs.slice(0, n)) segs.push({ text: MARK[r.status], status: r.status })
  const by = (w: Who) => lane.runs.filter(r => r.who === w).length
  const who = (['claude', 'codex', 'unknown'] as Who[]).filter(w => by(w)).map(w => `${L[w]} ${by(w)}`).join(' · ')
  const r = lane.runs[0]!
  const where = r.mr != null ? `MR !${r.mr}` : r.branch || '?'
  segs.push({ text: ` · ${who} · ${where}${r.conv ? ` · ${r.conv.title || r.conv.id}` : ''}`, dim: true })
  return segs
}

export const segsText = (segs: Seg[]): string => segs.map(s => s.text).join('')

/** The global summary as lines (also the text /ci diagramme answers with). */
export const summaryLines = (d: Diagram, who: WhoFilter, now: number): string[] => {
  const L = labelsOf(d)
  const runs = runsOf(d, who)
  const today0 = new Date(now)
  today0.setHours(0, 0, 0, 0)
  const week0 = now - 7 * 86400000
  const when = (r: Run) => (r.created ? Date.parse(r.created) : NaN)
  const today = runs.filter(r => when(r) >= today0.getTime())
  const week = runs.filter(r => when(r) >= week0)
  const lines = [
    `${L.today} : ${statsText(L, stats(today))}`,
    `${L.week} : ${statsText(L, stats(week))}`,
  ]
  const per = (key: (r: Run) => string, name: (k: string) => string) => {
    const m = new Map<string, Run[]>()
    for (const r of week) m.set(key(r), [...(m.get(key(r)) ?? []), r])
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, rs]) => {
      const s = stats(rs)
      return `${name(k)} ${s.runs} (${s.pass_rate == null ? '?' : `${s.pass_rate} %`}, ${s.minutes} ${L.minutes})`
    })
  }
  lines.push(`hôtes : ${per(r => r.backend, k => hostLabel(d, k)).join(' · ') || '—'}`)
  if (who === 'all') lines.push(`auteurs : ${per(r => r.who, k => L[k as Who] ?? k).join(' · ') || '—'}`)
  const apps = per(r => r.app, k => k)
  lines.push(`apps : ${apps.slice(0, 8).join(' · ') || '—'}${apps.length > 8 ? ` · +${apps.length - 8}` : ''}`)
  const q = d.summary?.queue
  if (q) {
    const n = (x: number | null) => (x == null ? '?' : String(x))
    lines.push(`${L.queue} (${q.label}, tag ${q.tag}) : ${n(q.running)} jobs en cours, ${n(q.pending)} en attente, ` +
      `${n(q.runners_online)} runner(s) en ligne, ${q.pipelines_open} pipeline(s) ouverts lus`)
  }
  return lines
}

export const diagramText = (d: Diagram, who: WhoFilter, group: GroupBy, now: number): string => {
  const L = labelsOf(d)
  const head = `CI · ${L.tab_diagram} · lu ${d.generated ?? 'jamais'}${d.stale ? ' (rafraîchissement)' : ''} · ${whoLabel(L, who)} · ${groupLabel(L, group)}`
  if (!d.generated) return `${head}\naucune donnée : /ci diagramme refresh`
  return [head, headline(d, who), ...summaryLines(d, who, now)].join('\n')
}

export const appsWithoutRuns = (d: Diagram): App[] => d.apps.filter(a => !a.runs.length)

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Static overview: authors → CI hosts → results, boxes with counts. A picture only: filters stay real buttons. */
export const overviewSvg = (d: Diagram, who: WhoFilter, width = 560): string => {
  const C = { ...DEFAULT_SVG, ...(d.svg_colors ?? {}) }
  const L = labelsOf(d)
  const runs = runsOf(d, who)
  const hosts = [...new Set(runs.map(r => r.backend))].sort()
  const authors = (['claude', 'codex', 'unknown'] as Who[]).filter(w => runs.some(r => r.who === w))
  const rows = Math.max(hosts.length, authors.length, 1)
  const rowH = 34
  const h = rows * rowH + 30
  const colW = Math.floor((width - 40) / 3)
  const x = [10, 20 + colW, 30 + 2 * colW]
  const y = (i: number, n: number) => 24 + i * rowH + ((rows - n) * rowH) / 2
  const parts: string[] = []
  const box = (bx: number, by: number, text: string, sub: string) =>
    parts.push(`<rect x="${bx}" y="${by}" width="${colW}" height="${rowH - 8}" rx="5" fill="none" stroke="${C.box}" stroke-width="1.2"/>` +
      `<text x="${bx + 8}" y="${by + 17}" font-size="11" fill="${C.text}" font-family="sans-serif">${esc(text)} <tspan font-weight="bold">${esc(sub)}</tspan></text>`)
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.line}" stroke-width="1" opacity="0.6"/>`)
  parts.push(`<text x="${x[0]}" y="14" font-size="10" fill="${C.text}" font-family="sans-serif">auteur</text>`)
  parts.push(`<text x="${x[1]}" y="14" font-size="10" fill="${C.text}" font-family="sans-serif">hôte CI</text>`)
  parts.push(`<text x="${x[2]}" y="14" font-size="10" fill="${C.text}" font-family="sans-serif">résultat</text>`)
  authors.forEach((w, i) => {
    hosts.forEach((hId, k) => {
      if (runs.some(r => r.who === w && r.backend === hId)) line(x[0] + colW, y(i, authors.length) + 13, x[1], y(k, hosts.length) + 13)
    })
    box(x[0], y(i, authors.length), L[w], String(runs.filter(r => r.who === w).length))
  })
  hosts.forEach((hId, k) => {
    const rs = runs.filter(r => r.backend === hId)
    const s = stats(rs)
    line(x[1] + colW, y(k, hosts.length) + 13, x[2], y(k, hosts.length) + 13)
    box(x[1], y(k, hosts.length), hostLabel(d, hId).slice(0, 28), String(rs.length))
    // result bar: share of each status
    const by = y(k, hosts.length)
    let bx = x[2]
    const order: RunStatus[] = ['success', 'failed', 'running', 'queued', 'cancelled', 'skipped']
    for (const st of order) {
      const n = rs.filter(r => r.status === st).length
      if (!n) continue
      const w = Math.max(2, Math.round(((colW - 70) * n) / rs.length))
      parts.push(`<rect x="${bx}" y="${by + 5}" width="${w}" height="${rowH - 18}" fill="${C[st]}"/>`)
      bx += w
    }
    parts.push(`<text x="${x[2] + colW - 64}" y="${by + 17}" font-size="11" fill="${C.text}" font-family="sans-serif">${s.pass_rate == null ? '?' : s.pass_rate + ' %'} · ${s.minutes} ${esc(L.minutes)}</text>`)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`
}

// ---- user-friendly layer: headline sentence, ETA, Gantt, log commands ---------------------------------------------

/** A job or run that is red for real: failed and not allowed to fail. */
export const isRed = (x: { status: RunStatus; allow_failure?: boolean }): boolean => x.status === 'failed' && !x.allow_failure

export const clock = (iso: string | null | undefined): string => {
  const t = iso ? new Date(iso) : null
  if (!t || Number.isNaN(t.getTime())) return '?'
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}

/** ms of a past successful duration list in seconds. */
const msOf = (xs: number[] | undefined) => (xs ?? []).filter(x => Number.isFinite(x)).map(x => x * 1000)

/**
 * End time (ISO) of the run, recomputed with lib/core/estimate.mjs when the scanner sent the samples (pipeline basis:
 * the median of the lane's last successful pipelines from the run's creation, never before now), else the scanner's.
 */
export const etaOfRun = (r: Run, now: number): string | null => {
  const e = r.estimate
  if (!e) return null
  if (e.basis === 'pipeline' && e.durations_s && r.created) {
    const end = etaOf(estimateOf(msOf(e.durations_s)), Date.parse(r.created), now)
    if (end) return new Date(end.mid).toISOString()
  }
  return e.eta
}

/** « vert ou rouge vers 22:40 (médiane de 5 pipelines) », or why there is no estimate. */
export const etaText = (r: Run, now: number = Date.now()): string => {
  const e = r.estimate
  if (!e) return ''
  const eta = etaOfRun(r, now)
  if (!eta) return `${e.reason ?? "pas assez d'historique"} (${e.samples} run(s) connus, ${MIN_SAMPLES} au moins)`
  const basis = e.basis === 'jobs' ? `médiane des jobs, ${e.samples} runs au moins` : `médiane de ${e.samples} pipelines`
  return `vert ou rouge vers ${clock(eta)} (${basis})`
}

/** The command that prints the log of a red job (shown, never run by the mod). */
export const logCommand = (r: Run, j?: Job): string =>
  r.forge === 'github'
    ? `gh run view ${r.id} -R ${r.slug} --log-failed`
    : `glab ci trace ${j?.id ?? '<job>'} -R ${r.slug}`

/** Newest run of each lane, filtered by who. */
export const latestRuns = (d: Diagram, who: WhoFilter): Run[] => {
  const m = new Map<string, Run>()
  for (const r of runsOf(d, who)) {
    const k = `${r.app}|${r.backend}`
    const cur = m.get(k)
    if (!cur || (r.created ?? '') > (cur.created ?? '')) m.set(k, r)
  }
  return [...m.values()]
}

/** Every running or queued pipeline (not only the newest of each lane), newest first. */
export const liveRuns = (d: Diagram, who: WhoFilter): Run[] =>
  runsOf(d, who).filter(r => r.status === 'running' || r.status === 'queued')
    .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))

/** One plain French sentence: « 2 pipelines en cours, 1 rouge dans datapass-react (job lint), runner local à 6/18 ». */
export const headline = (d: Diagram, who: WhoFilter): string => {
  const last = latestRuns(d, who)
  const running = liveRuns(d, who).length
  const reds = last.filter(isRed).sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
  const parts: string[] = []
  parts.push(running ? `${running} pipeline${running > 1 ? 's' : ''} en cours` : 'aucun pipeline en cours')
  if (reds.length) {
    const r = reds[0]!
    const jobs = (r.jobs ?? []).filter(isRed).map(j => j.name)
    const where = `${r.app}${jobs.length ? ` (job${jobs.length > 1 ? 's' : ''} ${jobs.slice(0, 2).join(', ')}${jobs.length > 2 ? '…' : ''})` : ''}`
    const more = reds.length > 1 ? ` et ${reds.length - 1} autre${reds.length > 2 ? 's' : ''}` : ''
    parts.push(`${reds.length} rouge${reds.length > 1 ? 's' : ''} dans ${where}${more}`)
  } else parts.push('aucun rouge')
  const q = d.summary?.queue
  if (q && q.running != null) parts.push(`runner local à ${q.running}/${q.concurrent ?? '?'}`)
  if (q && q.wait_s != null) parts.push(`attente runner ~${fmtDur(Math.round(q.wait_s))} (médiane de ${q.wait_n} jobs)`)
  return parts.join(', ')
}

/**
 * One Gantt row: the job, then a bar of `width` cells drawn by lib/core/gantt.mjs, the renderer factory's Workflow
 * screen uses too (░ file, █ fini, ▓ en cours, ▒ échoué, ┄ estimation, │ maintenant), then its time. A running job's
 * estimated end comes from lib/core/estimate.mjs over the samples the scanner sent (else the scanner's own end).
 */
export type GanttRow = { stage: string; name: string; cells: Seg[]; text: string; red: boolean }
export const GANTT = SYMBOLS
export const GANTT_LEGEND: string = ganttLegend()

const ganttStatus = (j: Job): string => (j.status === 'cancelled' || j.status === 'skipped' ? 'canceled' : j.status === 'success' ? 'done' : j.status)

/** Estimated end (ms) of a job: core estimate over its samples from its real start, else the scanner's end. */
export const jobEnd = (r: Run, j: Job, now: number): number | null => {
  const e = r.estimate?.jobs?.[j.name]
  if (!e) return null
  const started = j.started ? Date.parse(j.started) : NaN
  if (j.status === 'running' && Number.isFinite(started) && e.samples_s) {
    const end = etaOf(estimateOf(msOf(e.samples_s)), started, now)
    if (end) return end.mid
  }
  return e.end ? Date.parse(e.end) : null
}

export const gantt = (r: Run, now: number, width = 28): { rows: GanttRow[]; start: number; end: number; axis: string; legend: string } => {
  const t = (s: string | null | undefined) => (s ? Date.parse(s) : NaN)
  const fin = (x: number) => (Number.isFinite(x) ? x : undefined)
  const jobs = (r.jobs ?? []).filter(j => Number.isFinite(t(j.created)) || Number.isFinite(t(j.started)))
  const g = coreGantt(jobs.map(j => ({
    label: j.name,
    status: ganttStatus(j),
    queuedMs: fin(t(j.created)),
    startMs: fin(t(j.started)),
    endMs: fin(t(j.finished)),
    estEndMs: jobEnd(r, j, now) ?? undefined,
  })), now, width)
  const rows: GanttRow[] = jobs.map((j, i) => {
    const going = j.status === 'running' || j.status === 'queued'
    const e = r.estimate?.jobs?.[j.name]
    const end = jobEnd(r, j, now)
    const cells: Seg[] = (g.rows[i]?.segs ?? []).map((sg: { text: string; kind: string }) => ({
      text: sg.text, color: (COLORS as Record<string, string>)[sg.kind], dim: sg.kind === 'empty' || sg.kind === 'queue' || sg.kind === 'est',
    }))
    const tail = going
      ? (end ? `fin ~${clock(new Date(end).toISOString())} (n=${e?.n})` : e ? `pas assez d'historique (n=${e.n})` : MARK[j.status])
      : `${MARK[j.status]} ${fmtDur(j.duration_s)}${j.queued_s ? ` + ${fmtDur(j.queued_s)} en file` : ''}`
    return { stage: j.stage, name: j.name, cells, text: tail, red: isRed(j) }
  })
  return { rows, start: g.t0, end: g.t1, axis: ganttAxis(g, 0), legend: GANTT_LEGEND }
}

export const parseDiagram = (text: string): Diagram | undefined => {
  if (!text) return undefined
  try {
    const d = JSON.parse(text) as Diagram
    return Array.isArray(d.apps) ? d : undefined
  } catch {
    return undefined
  }
}
