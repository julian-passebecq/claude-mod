// band mod: the two-line Jauge (gauge.style "two_lines", the default), pure (no $, no I/O; node --test runs it).
//   line 1, bold:  ● 2 t'attendent · 4 à toi │ contexte 41 % (relais 250 k)
//   line 2, grey:  5 h 24 % · sem 14 % · Codex 30 % │ 3 agents · 5 conv actives │ 434 tok/s tout · 120 ce projet · 50 cette conv │ CPU 12 % · GPU 3 %
//   buttons:       Cockpit · Veille · À toi · Registres · Référence · ▾
// Red only when at least one thing waits on Julian. Nothing wraps: each line is fitted to the band's width (bodyColumns)
// first with the full labels, then the short ones, then by leaving out the fields of drop_order one by one. Which
// fields, their order, labels, short labels and the drop order all come from band.config.json `jauge`.

export type Field = { id: string; text: string; tone?: 'bad' | 'warn' | 'dim' }
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
}

export const DEF_JAUGE_LABELS: Record<string, string> = {
  waiting: "● {n} t'attendent",
  waiting_none: '● 0 t\'attendent',
  todo: '{n} à toi',
  context: 'contexte {pct} % (relais {relay})',
  context_none: 'contexte ? (relais {relay})',
  five: '5 h {n} %',
  week: 'sem {n} %',
  codex_week: 'Codex {n} %',
  codex_five: 'Codex 5 h {n} %',
  agents: '{n} agents',
  convs: '{n} conv actives',
  tps_all: '{n} tok/s tout',
  tps_project: '{n} ce projet',
  tps_conv: '{n} cette conv',
  cpu: 'CPU {n} %',
  gpu: 'GPU {n} %',
  more: '▾',
  less: '▴',
}

export const DEF_JAUGE_SHORT: Record<string, string> = {
  waiting: '● {n} attendent',
  waiting_none: '● 0 attendent',
  todo: '{n} à toi',
  context: 'ctx {pct} % (relais {relay})',
  context_none: 'ctx ? (relais {relay})',
  five: '5h {n}%',
  week: 'sem {n}%',
  codex_week: 'Cx {n}%',
  codex_five: 'Cx 5h {n}%',
  agents: '{n} ag',
  convs: '{n} conv',
  tps_all: '{n} t/s',
  tps_project: '{n} proj',
  tps_conv: '{n} ici',
  cpu: 'CPU {n}%',
  gpu: 'GPU {n}%',
}

export const DEF_JAUGE: JaugeCfg = {
  line1: ['waiting', 'todo', '|', 'context'],
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
}

export const jaugeCfg = (raw?: Partial<JaugeCfg>): JaugeCfg => ({
  ...DEF_JAUGE,
  ...(raw ?? {}),
  tps_scopes: { ...DEF_JAUGE.tps_scopes, ...((raw && raw.tps_scopes) || {}) },
  labels: { ...DEF_JAUGE_LABELS, ...((raw && raw.labels) || {}) },
  labels_short: { ...DEF_JAUGE_SHORT, ...((raw && raw.labels_short) || {}) },
})

/** Terminal cells of a string: one per code point (the band's texts have no wide glyphs). */
export const cells = (s: string) => [...s].length

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))

const kTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1e4 ? `${Math.round(n / 1e3)} k` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace('.', ',')} k` : String(Math.round(n)))

const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)

/** The figures both lines read. Missing ones leave their field out (except the two counters and the context). */
export type JaugeFacts = {
  waiting?: number
  todo?: number
  ctxPct?: number
  relayAt: number
  five?: number
  week?: number
  codexWeek?: number
  codexFive?: number
  agents?: number
  convs?: number
  tps: Record<string, number | undefined>
  cpu?: number
  gpu?: number
}

/** Every field's text with the labels given (full or short); undefined when its figure is missing. */
export const fieldText = (id: string, f: JaugeFacts, L: Record<string, string>): Field | undefined => {
  const pct = (x?: number) => (x === undefined ? undefined : Math.round(x))
  switch (id) {
    case 'waiting': {
      const n = Math.max(0, Math.round(num(f.waiting) ?? 0))
      return { id, text: n ? fill(L.waiting, { n }) : fill(L.waiting_none ?? L.waiting, { n }), ...(n ? { tone: 'bad' as const } : { tone: 'dim' as const }) }
    }
    case 'todo': {
      const n = Math.max(0, Math.round(num(f.todo) ?? 0))
      return { id, text: fill(L.todo, { n }) }
    }
    case 'context':
      return { id, text: f.ctxPct === undefined ? fill(L.context_none, { relay: kTok(f.relayAt) }) : fill(L.context, { pct: Math.round(f.ctxPct), relay: kTok(f.relayAt) }) }
    case 'five':
    case 'week':
    case 'cpu':
    case 'gpu': {
      const v = pct(num(id === 'five' ? f.five : id === 'week' ? f.week : id === 'cpu' ? f.cpu : f.gpu))
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
        return v === undefined ? undefined : { id, text: fill(L[id] ?? `{n} ${id}`, { n: kTok(v) }) }
      }
      return undefined
    }
  }
}

/** The line's groups from its ids ('|' starts a new group); empty groups are dropped. */
export const buildLine = (ids: string[], f: JaugeFacts, L: Record<string, string>, drop: ReadonlySet<string> = new Set()): Line => {
  const out: Line = [[]]
  for (const id of ids) {
    if (id === '|') {
      out.push([])
      continue
    }
    if (drop.has(id)) continue
    const x = fieldText(id, f, L)
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
  const full = buildLine(ids, f, c.labels)
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
    const l = buildLine(ids, f, S, drop)
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
