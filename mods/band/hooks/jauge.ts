// band mod: the two-line Jauge (gauge.style "two_lines", the default), pure (no $, no I/O; node --test runs it).
//   line 1:  ▶ 1 conv · 0 wf · 0 ag · 0 CI │ ◆ 2 │ ctx ▰▰▱▱▱ 41 % │ 5 h ▱▱▱▱▱ 0 % · sem ▰▰▰▰▱ 74 % │ 4.4k tok/s  (◆ N hidden at 0)
//            the activity status (actFields) reads « ✓ au repos » in green when nothing runs
//   line 2, grey:  5 h 24 % · sem 14 % · Codex 30 % │ 3 agents · 5 conv actives │ 434 tok/s tout · 120 ce projet · 50 cette conv │ CPU 12 % · GPU 3 %
//   buttons:       Cockpit · Veille · À toi · Registres · Référence · ▾
// Context, 5 h and week carry a ▰▱ mini bar and a traffic light (jauge.levels); the waiting count is amber. Nothing wraps: each line is fitted to the band's width (bodyColumns)
// first with the full labels, then the short ones, then by leaving out the fields of drop_order one by one. Which
// fields, their order, labels, short labels and the drop order all come from band.config.json `jauge`.

/**
 * One figure. text is what the terminal shows (and what fitting counts). A figure with a level (context, 5 h, week)
 * is also split: label (grey words), bar (▰▱ cells; the desktop draws a thin Svg of pct instead) and value, the bar
 * and the value in the level's colour (ok green, warn orange, bad red).
 */
export type Field = { id: string; text: string; tone?: 'ok' | 'bad' | 'warn' | 'dim'; label?: string; bar?: string; pct?: number; value?: string }

/** Traffic-light thresholds (band.config.json jauge.levels). */
export type Levels = {
  /** context: orange from warn_pct, red from the hand-off threshold (context.handoff_tokens of the effective window) */
  ctx: { warn_pct: number }
  /** 5 h and week: orange from warn_pct or a projection at reset from proj_warn_pct; red from bad_pct or a projection over proj_bad_pct */
  quota: { warn_pct: number; bad_pct: number; proj_warn_pct: number; proj_bad_pct: number }
}

export const DEF_LEVELS: Levels = {
  ctx: { warn_pct: 50 },
  quota: { warn_pct: 60, bad_pct: 85, proj_warn_pct: 90, proj_bad_pct: 100 },
}

export type Level = 'ok' | 'warn' | 'bad'

/** Context level: red at or past the relay (as a % of the window), orange from warn_pct, else green. */
export const ctxLevel = (pct: number, relayPct: number | undefined, lv: Levels = DEF_LEVELS): Level =>
  relayPct !== undefined && pct >= relayPct ? 'bad' : pct >= lv.ctx.warn_pct ? 'warn' : 'ok'

/** 5 h / week level from the % used and, when known, the % projected at the window's reset. */
export const quotaLevel = (pct: number, proj: number | undefined, lv: Levels = DEF_LEVELS): Level => {
  const q = lv.quota
  if (pct >= q.bad_pct || (proj !== undefined && proj > q.proj_bad_pct)) return 'bad'
  if (pct >= q.warn_pct || (proj !== undefined && proj >= q.proj_warn_pct)) return 'warn'
  return 'ok'
}

/** A mini bar of `n` cells: ▰ filled, ▱ empty. */
export const miniBar = (pct: number, n = 5, on = '▰', off = '▱') => {
  const k = Math.max(0, Math.min(n, Math.round((n * Math.max(0, Math.min(100, pct))) / 100)))
  return on.repeat(k) + off.repeat(n - k)
}
/** A line is groups of fields: fields of a group are joined by `dot`, groups by `sep`. */
export type Line = Field[][]

export type JaugeCfg = {
  line1: string[]
  line2: string[]
  /** fields left out first when a line is too wide, in order */
  drop_order: string[]
  sep: string
  dot: string
  sep_short: string
  dot_short: string
  /** a conversation counts as active when it wrote within this many seconds */
  active_s: number
  /** which band scope each tok/s field reads */
  tps_scopes: Record<string, string>
  /** width used when the engine gives no bodyColumns */
  columns_fallback: number
  /** cells a button takes beyond its label (brackets, padding), to fit the button row */
  button_pad: number
  labels: Record<string, string>
  labels_short: Record<string, string>
  levels: Levels
  /** cells of a mini bar ({bar} in a label) */
  bar_cells: number
}

export const DEF_JAUGE_LABELS: Record<string, string> = {
  waiting: '◆ {n}',
  waiting_none: '',
  todo: '{n} à toi',
  context: 'ctx {bar} {pct} %',
  context_none: 'ctx ?',
  five: '5 h {bar} {n} %',
  week: 'sem {bar} {n} %',
  codex_week: 'Codex {n} %',
  codex_five: 'Codex 5 h {n} %',
  agents: '{n} agents',
  convs: '{n} conv actives',
  tps_all: '{n} tok/s',
  tps_project: '{n} ce projet',
  tps_conv: '{n} cette conv',
  cpu: 'CPU {n} %',
  gpu: 'GPU {n} %',
  more: '▾',
  less: '▴',
  act_conv: '▶ {n} conv',
  act_wf: '{n} wf',
  act_ag: '{n} ag',
  act_ci: '{n} CI',
  act_ci_stale: 'CI ?',
  act_idle: '✓ au repos',
}

export const DEF_JAUGE_SHORT: Record<string, string> = {
  waiting: '◆ {n}',
  waiting_none: '',
  todo: '{n} à toi',
  context: 'ctx {bar} {pct}%',
  context_none: 'ctx ?',
  five: '5h {bar} {n}%',
  week: 'sem {bar} {n}%',
  codex_week: 'Cx {n}%',
  codex_five: 'Cx 5h {n}%',
  agents: '{n} ag',
  convs: '{n} conv',
  tps_all: '{n} t/s',
  tps_project: '{n} proj',
  tps_conv: '{n} ici',
  cpu: 'CPU {n}%',
  gpu: 'GPU {n}%',
  act_conv: '▶ {n} conv',
  act_wf: '{n} wf',
  act_ag: '{n} ag',
  act_ci: '{n} CI',
  act_ci_stale: 'CI ?',
  act_idle: '✓ au repos',
}

export const DEF_JAUGE: JaugeCfg = {
  line1: ['activity', '|', 'waiting', 'todo', '|', 'context'],
  line2: ['five', 'week', 'codex_week', '|', 'agents', 'convs', '|', 'tps_all', 'tps_project', 'tps_conv', '|', 'cpu', 'gpu'],
  drop_order: ['gpu', 'tps_project', 'convs', 'cpu', 'codex_week', 'five', 'tps_all', 'agents', 'todo'],
  sep: ' │ ',
  dot: ' · ',
  sep_short: ' │ ',
  dot_short: ' · ',
  active_s: 300,
  tps_scopes: { tps_all: 'all', tps_project: 'project', tps_conv: 'conv' },
  columns_fallback: 120,
  button_pad: 4,
  labels: DEF_JAUGE_LABELS,
  labels_short: DEF_JAUGE_SHORT,
  levels: DEF_LEVELS,
  bar_cells: 5,
}

export const jaugeCfg = (raw?: Partial<JaugeCfg>): JaugeCfg => ({
  ...DEF_JAUGE,
  ...(raw ?? {}),
  tps_scopes: { ...DEF_JAUGE.tps_scopes, ...((raw && raw.tps_scopes) || {}) },
  labels: { ...DEF_JAUGE_LABELS, ...((raw && raw.labels) || {}) },
  labels_short: { ...DEF_JAUGE_SHORT, ...((raw && raw.labels_short) || {}) },
  levels: {
    ctx: { ...DEF_LEVELS.ctx, ...((raw as any)?.levels?.ctx || {}) },
    quota: { ...DEF_LEVELS.quota, ...((raw as any)?.levels?.quota || {}) },
  },
  bar_cells: Number((raw as any)?.bar_cells) > 0 ? Math.floor(Number((raw as any).bar_cells)) : 5,
})

/** Terminal cells of a string: one per code point (the band's texts have no wide glyphs). */
export const cells = (s: string) => [...s].length

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))

const kTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1e4 ? `${Math.round(n / 1e3)} k` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace('.', ',')} k` : String(Math.round(n)))

/** tok/s, short: 434, 4.4k, 12k, 1.2M. */
export const kShort = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)))

const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)

/** The figures both lines read. Missing ones leave their field out (except the two counters and the context). */
export type JaugeFacts = {
  waiting?: number
  todo?: number
  ctxPct?: number
  relayAt: number
  /** the relay (context.handoff_tokens) as a % of the effective window: the context turns red there */
  relayPct?: number
  five?: number
  week?: number
  /** % projected at the 5 h / week reset at the current pace (lib/core/usage.mjs runOut), when known */
  fiveProj?: number
  weekProj?: number
  codexWeek?: number
  codexFive?: number
  agents?: number
  convs?: number
  tps: Record<string, number | undefined>
  cpu?: number
  gpu?: number
  /** what runs (lib/core/busy.mjs counts, see actFields); undefined leaves the « activity » field out */
  act?: ActFacts
}

/**
 * The activity status at the start of the line: busy main threads, Workflows, agents, CI. tone of wf / ag: ok, warn
 * (one stalled), bad (one failed). ci undefined = off; stale = the ci cache is too old (or missing) to say 0.
 */
export type ActFacts = {
  convs: number
  workflows: number
  agents: number
  wfTone?: Level
  agTone?: Level
  ci?: { running: number; failed: number; stale: boolean }
}

/**
 * « ▶ 1 conv · 0 wf · 0 ag · 0 CI » (zeros grey, non-zero green, amber stalled, red failed), or when nothing runs one
 * green « ✓ au repos » (plus a grey « CI ? » when the CI cannot be read). Fields act_conv, act_wf, act_ag, act_ci.
 */
export const actFields = (a: ActFacts | undefined, L: Record<string, string>): Field[] => {
  if (!a) return []
  const n = (x: number) => Math.max(0, Math.round(Number(x) || 0))
  const ci = a.ci
  const ciRun = ci && !ci.stale ? n(ci.running) : 0
  const ciField: Field | undefined = !ci
    ? undefined
    : ci.stale
      ? { id: 'act_ci', text: L.act_ci_stale ?? 'CI ?', tone: 'dim' }
      : { id: 'act_ci', text: fill(L.act_ci, { n: ciRun }), tone: ci.failed ? 'bad' : ciRun ? 'ok' : 'dim' }
  if (!n(a.convs) && !n(a.workflows) && !n(a.agents) && !ciRun) {
    return [{ id: 'act_idle', text: L.act_idle ?? '✓ au repos', tone: 'ok' }, ...(ciField && (ci!.stale || ci!.failed) ? [ciField] : [])]
  }
  const one = (id: string, v: number, tone?: Level): Field => ({ id, text: fill(L[id], { n: n(v) }), tone: n(v) ? (tone ?? 'ok') : 'dim' })
  return [one('act_conv', a.convs), one('act_wf', a.workflows, a.wfTone), one('act_ag', a.agents, a.agTone), ...(ciField ? [ciField] : [])]
}

/** Every field's text with the labels given (full or short); undefined when its figure is missing. */
export const fieldText = (id: string, f: JaugeFacts, L: Record<string, string>, c: Pick<JaugeCfg, 'levels' | 'bar_cells'> = DEF_JAUGE): Field | undefined => {
  const pct = (x?: number) => (x === undefined ? undefined : Math.round(x))
  // label words grey, then the bar and the value in the level's colour; a bar only when the template has {bar}
  const levelled = (tpl: string, vars: Record<string, string | number>, p: number, tone: Level): Field => {
    const bar = miniBar(p, c.bar_cells)
    const at = tpl.indexOf('{bar}')
    const cut = at >= 0 ? at : tpl.search(/\{(pct|n)\}/)
    const label = cut > 0 ? fill(tpl.slice(0, cut), vars) : ''
    const rest = cut >= 0 ? tpl.slice(cut) : tpl
    const value = fill(rest.replace('{bar}', ''), vars)
    return { id, text: label + fill(rest, { ...vars, bar }), tone, label, value, ...(at >= 0 ? { bar, pct: Math.max(0, Math.min(100, p)) } : {}) }
  }
  switch (id) {
    case 'waiting': {
      // hidden at 0 (waiting_none empty), else a short amber « ◆ N »
      const n = Math.max(0, Math.round(num(f.waiting) ?? 0))
      const text = n ? fill(L.waiting, { n }) : fill(L.waiting_none ?? '', { n })
      return text ? { id, text, tone: n ? ('warn' as const) : ('dim' as const) } : undefined
    }
    case 'todo': {
      const n = Math.max(0, Math.round(num(f.todo) ?? 0))
      return { id, text: fill(L.todo, { n }) }
    }
    case 'context': {
      if (f.ctxPct === undefined) return { id, text: fill(L.context_none, { relay: kTok(f.relayAt) }), tone: 'dim' }
      return levelled(L.context, { pct: Math.round(f.ctxPct), relay: kTok(f.relayAt) }, f.ctxPct, ctxLevel(f.ctxPct, f.relayPct, c.levels))
    }
    case 'five':
    case 'week': {
      const raw = num(id === 'five' ? f.five : f.week)
      if (raw === undefined) return undefined
      const proj = num(id === 'five' ? f.fiveProj : f.weekProj)
      return levelled(L[id], { n: Math.round(raw) }, raw, quotaLevel(raw, proj, c.levels))
    }
    case 'cpu':
    case 'gpu': {
      const v = pct(num(id === 'cpu' ? f.cpu : f.gpu))
      return v === undefined ? undefined : { id, text: fill(L[id], { n: v }) }
    }
    case 'codex_week':
    case 'codex_five': {
      const v = pct(num(id === 'codex_week' ? f.codexWeek : f.codexFive))
      return v === undefined ? undefined : { id, text: fill(L[id], { n: v }) }
    }
    case 'agents':
    case 'convs': {
      const v = num(id === 'agents' ? f.agents : f.convs)
      return v === undefined ? undefined : { id, text: fill(L[id], { n: Math.round(v) }) }
    }
    default: {
      if (id.startsWith('tps_')) {
        const v = num(f.tps[id])
        return v === undefined ? undefined : { id, text: fill(L[id] ?? `{n} ${id}`, { n: kShort(v) }) }
      }
      return undefined
    }
  }
}

/** The line's groups from its ids ('|' starts a new group); empty groups are dropped. */
export const buildLine = (ids: string[], f: JaugeFacts, L: Record<string, string>, drop: ReadonlySet<string> = new Set(), c: Pick<JaugeCfg, 'levels' | 'bar_cells'> = DEF_JAUGE): Line => {
  const out: Line = [[]]
  for (const id of ids) {
    if (id === '|') {
      out.push([])
      continue
    }
    if (drop.has(id)) continue
    if (id === 'activity') {
      out[out.length - 1].push(...actFields(f.act, L))
      continue
    }
    const x = fieldText(id, f, L, c)
    if (x) out[out.length - 1].push(x)
  }
  return out.filter(g => g.length)
}

export const lineText = (l: Line, sep: string, dot: string) => l.map(g => g.map(x => x.text).join(dot)).join(sep)

export type Fitted = { line: Line; text: string; short: boolean; dropped: string[]; sep: string; dot: string }

/**
 * The widest version of a line that fits `columns` cells: full labels, else short labels, else short labels with the
 * fields of drop_order left out one by one. When nothing fits, the narrowest try (the Text truncates its end).
 */
export const fitLine = (ids: string[], f: JaugeFacts, c: JaugeCfg, columns: number): Fitted => {
  const full = buildLine(ids, f, c.labels, new Set(), c)
  const ft = lineText(full, c.sep, c.dot)
  if (cells(ft) <= columns) return { line: full, text: ft, short: false, dropped: [], sep: c.sep, dot: c.dot }
  const S = { ...c.labels, ...c.labels_short }
  const drop = new Set<string>()
  let best: Fitted | undefined
  for (const id of ['', ...c.drop_order]) {
    if (id) {
      if (!ids.includes(id)) continue
      drop.add(id)
    }
    const l = buildLine(ids, f, S, drop, c)
    const t = lineText(l, c.sep_short, c.dot_short)
    best = { line: l, text: t, short: true, dropped: [...drop], sep: c.sep_short, dot: c.dot_short }
    if (cells(t) <= columns) return best
  }
  return best!
}

/** Button row: full labels when they fit, else each item's `short`, else as is (the row may still be too wide). */
export const fitButtons = (labels: { label: string; short?: string; open?: boolean }[], c: JaugeCfg, columns: number, extra = 1) => {
  const width = (xs: string[]) => xs.reduce((s, x) => s + cells(x) + c.button_pad, 0) + xs.length + extra + c.button_pad
  const mark = (s: string, open?: boolean) => (open ? `${s} ✕` : s)
  const full = labels.map(b => mark(b.label, b.open))
  if (width(full) <= columns) return { labels: full, short: false, width: width(full) }
  const short = labels.map(b => mark(b.short || b.label, b.open))
  return { labels: short, short: true, width: width(short) }
}
