// band mod: the « clarity » Jauge (jauge.layout "clarity", the default since 25 Oct), pure (no $, no I/O; node --test
// runs it). Julian, 25 Oct: « not clear, I don't see what's running on the conv, too much info not collapsed, no line
// jumped, not enough indentation, not enough colors, progression bar % token eta ».
//
// Folded (default, state kept in $.store `sections.expanded`): ONE line, what runs in THIS conversation first,
// coloured by state, then the gauges:
//   ▶ ● 1 workflow · 3 agents en cours · ctx ▰▰▰▱▱ 57 % · 5 h ▰▰▰▱▱ 64 % · sem ▰▰▰▰▱ 74 %
// Unfolded (▼): the same line, then sections separated by a blank line, each with a header and indented tree rows:
//   ▼ ● 1 workflow · 3 agents en cours · ctx ▰▰▰▱▱ 57 % · 5 h ▰▰▰▱▱ 64 %
//
//     En cours · cette conversation
//     ├ ◇ demo-release-wave ▰▰▰▰▰▰▱▱▱▱ 60 % · 3/5 · ▸ Verify · 47 min · fin ~14:48
//     │ ├ • coder lane-alpha-identity · opus · 20 min · 1,2 M tok
//     │ └ • tester lane-beta · sonnet · 9 min · rien écrit depuis 18 min
//     └ ◦ auditor scan · sonnet · 3 min
//
//     Jauges
//     ├ ctx  ▰▰▰▰▰▰▱▱▱▱  57 % · 228 k / 400 k · relais 250 k · compact ~16 min
//     ├ 5 h  ▰▰▰▰▰▰▱▱▱▱  64 %
//     ├ sem  ▰▰▰▰▰▰▰▱▱▱  74 % · projeté 108 %
//     └ débit 4,4 k tok/s
//
//     Ailleurs sur ce PC
//     └ 2 conv · 1 wf · 3 ag · 1 CI
// Every label, glyph, section, gauge, bar width and indent comes from band.config.json `jauge.clarity`; thresholds from
// `jauge.levels` (green → orange → red). Zero counts are left out, the « agent d'arrière-plan » words are gone (◦ is
// a background agent, • a foreground one). A row wider than the band cuts names first, then drops model / ETA.

import { ctxLevel, miniBar, quotaLevel, DEF_LEVELS } from './jauge.ts'
import type { ActFacts, Level, Levels } from './jauge.ts'
import { elapsed, fitPieces, levelOf, progressOf } from './encours.ts'
import type { EcAgent, EcData, EcWorkflow, Seg } from './encours.ts'

export type CTone = 'ok' | 'warn' | 'bad' | 'dim' | 'accent'
/** One piece of text; bar = this text is a gauge of that % (the desktop draws a thin Svg of `cells` width instead). */
export type CSeg = { text: string; tone?: CTone; bold?: boolean; bar?: number; cells?: number }
/** summary: the one folded line; blank: a line break between sections; header: a section title; item: a tree row. */
export type CRow = { key: string; kind: 'summary' | 'blank' | 'header' | 'item'; segs: CSeg[]; section?: string }

export type ClarityCfg = {
  /** sections unfolded under the summary, in order: running, gauges, pc, mods (the renderer draws mods' buttons) */
  sections: string[]
  /** what the folded line holds after the running state, in order; dropped from the end when too narrow */
  summary: string[]
  /** gauge rows of the gauges section */
  gauges: string[]
  /** cells of the bars in the summary and in the sections */
  summary_bar_cells: number
  bar_cells: number
  /** spaces before a section's header and rows */
  indent: number
  /** a blank line before each section */
  blank_lines: boolean
  /** agents listed under one workflow before « +N » */
  max_agents: number
  /** rows of the running section before « +N de plus » */
  max_running: number
  glyphs: Record<string, string>
  labels: Record<string, string>
}

export const DEF_CLARITY_GLYPHS: Record<string, string> = {
  open: '▼',
  closed: '▶',
  branch: '├ ',
  last: '└ ',
  pipe: '│ ',
  space: '  ',
  running: '●',
  idle: '○',
  workflow: '◇',
  agent: '•',
  background: '◦',
  phase: '▸',
}

export const DEF_CLARITY_LABELS: Record<string, string> = {
  idle: 'rien en cours',
  main: 'Claude travaille',
  workflow_one: '1 workflow',
  workflows: '{n} workflows',
  agent_one: '1 agent',
  workflows_short: '{n} wf',
  agents_short: '{n} ag',
  agents: '{n} agents',
  running_suffix: 'en cours',
  failed_suffix: '{n} échoué(s)',
  stalled_suffix: '{n} silencieux',
  waiting: '◆ {n} t’attend',
  context: 'ctx',
  five: '5 h',
  week: 'sem',
  tps: 'débit',
  tps_value: '{n} tok/s',
  ctx_detail: '{tokens} / {window}',
  ctx_relay: 'relais {relay}',
  ctx_compact: 'compact ~{min} min',
  projected: 'projeté {n} %',
  sec_running: 'En cours · cette conversation',
  sec_gauges: 'Jauges',
  sec_pc: 'Ailleurs sur ce PC',
  sec_mods: 'Mods',
  main_row: 'fil principal',
  none_running: 'rien en cours ici',
  pc_conv: '{n} conv',
  pc_wf: '{n} wf',
  pc_ag: '{n} ag',
  pc_ci: '{n} CI',
  pc_ci_failed: '{n} CI en échec',
  pc_ci_stale: 'CI ?',
  pc_none: 'rien d’autre',
  progress: '{done}/{total}',
  pct: '{n} %',
  tokens: '{n} tok',
  eta: 'fin ~{time}',
  eta_over: "au-delà de l'estimation",
  stalled: 'rien écrit depuis {min} min',
  failed: 'échoué',
  more_agents: '+{n} agents',
  more: '+{n} de plus · Cockpit',
  sep: ' · ',
}

export const DEF_CLARITY: ClarityCfg = {
  sections: ['running', 'gauges', 'pc', 'mods'],
  summary: ['waiting', 'context', 'five', 'week'],
  gauges: ['context', 'five', 'week', 'tps'],
  summary_bar_cells: 5,
  bar_cells: 10,
  indent: 2,
  blank_lines: true,
  max_agents: 6,
  max_running: 12,
  glyphs: DEF_CLARITY_GLYPHS,
  labels: DEF_CLARITY_LABELS,
}

const posInt = (x: unknown, d: number, min = 0) => (Number.isFinite(Number(x)) && Number(x) >= min ? Math.floor(Number(x)) : d)
const strs = (x: unknown, d: string[]) => (Array.isArray(x) ? x.filter(s => typeof s === 'string') : d)

export const clarityCfg = (raw?: any): ClarityCfg => ({
  sections: strs(raw?.sections, DEF_CLARITY.sections),
  summary: strs(raw?.summary, DEF_CLARITY.summary),
  gauges: strs(raw?.gauges, DEF_CLARITY.gauges),
  summary_bar_cells: posInt(raw?.summary_bar_cells, DEF_CLARITY.summary_bar_cells, 1),
  bar_cells: posInt(raw?.bar_cells, DEF_CLARITY.bar_cells, 1),
  indent: posInt(raw?.indent, DEF_CLARITY.indent),
  blank_lines: raw?.blank_lines !== false,
  max_agents: posInt(raw?.max_agents, DEF_CLARITY.max_agents, 1),
  max_running: posInt(raw?.max_running, DEF_CLARITY.max_running, 1),
  glyphs: { ...DEF_CLARITY_GLYPHS, ...(raw?.glyphs || {}) },
  labels: { ...DEF_CLARITY_LABELS, ...(raw?.labels || {}) },
})

/** The figures the clarity Jauge reads (register.tsx builds it from the engine, the scanner and scanner/encours.mjs). */
export type ClarityIn = {
  now: number
  /** the engine says this conversation's main thread is working */
  working: boolean
  /** what runs in THIS conversation (scanner/encours.mjs) */
  running: EcData | null
  ctxPct?: number
  tokens?: number
  window?: number
  relayAt: number
  relayPct?: number
  etaMin?: number
  five?: number
  fiveProj?: number
  week?: number
  weekProj?: number
  tps?: number
  waiting?: number
  /** the whole PC (lib/core/busy.mjs), for « Ailleurs sur ce PC » */
  pc?: ActFacts
}

export type ClarityView = { rows: CRow[]; tone: Level | 'dim'; running: number }

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
const cellsOf = (s: string) => [...s].length
export const segsText = (xs: CSeg[]) => xs.map(s => s.text).join('')
export const rowCells = (r: CRow) => cellsOf(segsText(r.segs))

/** 1,2 M · 228 k · 512 (the band's French figures). */
export const fmtK = (n: number) => {
  const one = (x: number) => (x < 10 ? x.toFixed(1).replace('.', ',').replace(/,0$/, '') : String(Math.round(x)))
  if (Math.abs(n) < 1000) return String(Math.round(n))
  if (Math.abs(n) < 1e6) return `${one(n / 1000)} k`
  return `${one(n / 1e6)} M`
}

const hhmm = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const worst = (ls: Level[]): Level => (ls.includes('bad') ? 'bad' : ls.includes('warn') ? 'warn' : 'ok')
const EC_LEVELS = { warn_min: 15, bad_min: 30 }

/** What runs in this conversation: counts and the worst state (ok writing, warn silent, bad failed or long silent). */
export const runningOf = (d: EcData | null, working: boolean, now: number, lv: { warn_min: number; bad_min: number } = EC_LEVELS) => {
  const wfs = (d?.workflows ?? []).filter(w => w.status === 'running' || w.status === 'failed')
  const wfAgents = wfs.flatMap(w => w.agents.filter(a => a.status === 'running' || a.status === 'failed'))
  const lone = (d?.agents ?? []).filter(a => a.status === 'running' || a.status === 'failed')
  const all = [...wfs, ...wfAgents, ...lone]
  const levels = all.map(x => levelOf(x, now, lv))
  return {
    workflows: wfs.filter(w => w.status === 'running').length,
    agents: [...wfAgents, ...lone].filter(a => a.status === 'running').length,
    failed: levels.filter((l, i) => l === 'bad' && all[i].status === 'failed').length,
    silent: levels.filter((l, i) => l !== 'ok' && all[i].status === 'running').length,
    tone: all.length ? worst(levels) : working ? ('ok' as Level) : undefined,
    working,
  }
}

/** « ● 1 workflow · 3 agents en cours » (state colour), « ● Claude travaille », or a grey « ○ rien en cours ». */
export const runningSegs = (r: ReturnType<typeof runningOf>, c: ClarityCfg, short = false): CSeg[] => {
  const L = c.labels
  const G = c.glyphs
  const parts: string[] = []
  if (r.workflows) parts.push(short ? fill(L.workflows_short, { n: r.workflows }) : r.workflows === 1 ? L.workflow_one : fill(L.workflows, { n: r.workflows }))
  if (r.agents) parts.push(short ? fill(L.agents_short, { n: r.agents }) : r.agents === 1 ? L.agent_one : fill(L.agents, { n: r.agents }))
  if (!parts.length && !r.failed) {
    if (r.working) return [{ text: `${G.running} `, tone: 'ok', bold: true }, { text: L.main, tone: 'ok', bold: true }]
    return [{ text: `${G.idle} `, tone: 'dim' }, { text: L.idle, tone: 'dim' }]
  }
  const tone = r.tone ?? 'ok'
  const out: CSeg[] = [{ text: `${G.running} `, tone, bold: true }]
  if (parts.length) out.push({ text: `${parts.join(L.sep)} ${L.running_suffix}`, tone, bold: true })
  if (r.failed) out.push({ text: (parts.length ? L.sep : '') + fill(L.failed_suffix, { n: r.failed }), tone: 'bad', bold: true })
  else if (r.silent && !short) out.push({ text: L.sep + fill(L.stalled_suffix, { n: r.silent }), tone: 'warn', bold: true })
  return out
}

type GaugeFig = { id: string; label: string; pct: number; level: Level; detail: string[] }

/** The gauges with a reading, their level from jauge.levels and their detail words (tokens, relay, projection). */
export const gaugesOf = (f: ClarityIn, c: ClarityCfg, lv: Levels = DEF_LEVELS): GaugeFig[] => {
  const L = c.labels
  const out: GaugeFig[] = []
  for (const id of ['context', 'five', 'week']) {
    if (id === 'context') {
      if (f.ctxPct === undefined) continue
      const detail: string[] = []
      if (f.tokens !== undefined && f.window) detail.push(fill(L.ctx_detail, { tokens: fmtK(f.tokens), window: fmtK(f.window) }))
      detail.push(fill(L.ctx_relay, { relay: fmtK(f.relayAt) }))
      if (f.etaMin !== undefined && Number.isFinite(f.etaMin)) detail.push(fill(L.ctx_compact, { min: Math.max(0, Math.round(f.etaMin)) }))
      out.push({ id, label: L.context, pct: f.ctxPct, level: ctxLevel(f.ctxPct, f.relayPct, lv), detail })
    } else {
      const v = id === 'five' ? f.five : f.week
      if (v === undefined || !Number.isFinite(v)) continue
      const proj = id === 'five' ? f.fiveProj : f.weekProj
      const detail = proj !== undefined && Number.isFinite(proj) && Math.round(proj) > Math.round(v) ? [fill(L.projected, { n: Math.round(proj) })] : []
      out.push({ id, label: L[id], pct: v, level: quotaLevel(v, proj, lv), detail })
    }
  }
  return out
}

const gaugeSegs = (g: GaugeFig, c: ClarityCfg, n: number, pad = 0): CSeg[] => {
  const p = Math.max(0, Math.min(100, g.pct))
  return [
    { text: g.label.padEnd(pad) + ' ', tone: 'dim' },
    { text: miniBar(p, n), tone: g.level, bar: p, cells: n },
    { text: ' ' + fill(c.labels.pct, { n: Math.round(g.pct) }).padStart(pad ? 5 : 0), tone: g.level, bold: true },
  ]
}

/** The folded line's segments after the toggle, fitted to `columns` (later summary fields are dropped first). */
export const summarySegs = (f: ClarityIn, c: ClarityCfg, lv: Levels, columns: number, ecLv = EC_LEVELS): { segs: CSeg[]; tone: Level | 'dim'; running: number } => {
  const r = runningOf(f.running, f.working, f.now, ecLv)
  const L = c.labels
  const full = runningSegs(r, c)
  const head = cellsOf(segsText(full)) <= columns ? full : runningSegs(r, c, true)
  const gs = gaugesOf(f, c, lv)
  type P = { segs: CSeg[]; drop?: number }
  const pieces: P[] = [{ segs: head }]
  let rank = c.summary.length + 1
  for (const id of c.summary) {
    rank--
    if (id === 'waiting') {
      const n = Math.max(0, Math.round(Number(f.waiting) || 0))
      if (n) pieces.push({ segs: [{ text: L.sep, tone: 'dim' }, { text: fill(L.waiting, { n }), tone: 'warn', bold: true }], drop: rank + 100 })
      continue
    }
    const g = gs.find(x => x.id === id)
    if (g) pieces.push({ segs: [{ text: L.sep, tone: 'dim' }, ...gaugeSegs(g, c, c.summary_bar_cells)], drop: rank })
  }
  // too wide: whole later fields go first (week, then 5 h, then the context); the running state stays
  const w = () => pieces.reduce((a, p) => a + cellsOf(segsText(p.segs)), 0)
  for (const p of [...pieces].filter(x => x.drop !== undefined).sort((a, b) => a.drop! - b.drop!)) {
    if (w() <= columns) break
    // first try the field without its bar
    const bar = p.segs.findIndex(s => s.bar !== undefined)
    if (bar >= 0 && p.drop! < 100) {
      p.segs = p.segs.filter((_, i) => i !== bar).map((s, i) => (i === bar ? { ...s, text: s.text.trimStart() } : s))
      if (w() <= columns) break
    }
    p.segs = []
  }
  const running = r.workflows + r.agents
  return { segs: pieces.flatMap(p => p.segs), tone: r.tone ?? 'dim', running }
}

// a tree row: the guides (├ └ │) in grey, then the item's pieces fitted to what is left of the width
type Piece = { segs: Seg[]; shrink?: number; min?: number; drop?: number }
const toC = (s: Seg): CSeg => ({ text: s.text, ...(s.tone ? { tone: s.tone } : s.dim ? { tone: 'dim' as const } : {}), ...(s.bar !== undefined ? { bar: s.bar, cells: cellsOf(s.text) } : {}) })

const wfPieces = (w: EcWorkflow, now: number, c: ClarityCfg, lv: typeof EC_LEVELS, room = 999): Piece[] => {
  const L = c.labels
  const S = L.sep
  const tone = levelOf(w, now, lv)
  const pieces: Piece[] = [{ segs: [{ text: `${c.glyphs.workflow} `, tone }] }, { segs: [{ text: w.name }], shrink: 1, min: 8 }]
  const pr = progressOf(w)
  if (pr) {
    const pct = pr.total ? (pr.done * 100) / pr.total : 0
    pieces.push({ segs: [{ text: ' ' }, { text: miniBar(pct, room < 64 ? c.summary_bar_cells : c.bar_cells), tone, bar: pct, cells: room < 64 ? c.summary_bar_cells : c.bar_cells }, { text: ' ' }, { text: fill(L.pct, { n: Math.round(pct) }), tone }] })
    pieces.push({ segs: [{ text: S, dim: true }, { text: fill(L.progress, pr), dim: true }], drop: 3 })
  }
  if (w.phase) pieces.push({ segs: [{ text: S, dim: true }, { text: `${c.glyphs.phase} ${w.phase}` }], shrink: 2, min: 8, drop: 4 })
  if (w.start) pieces.push({ segs: [{ text: S, dim: true }, { text: elapsed(now - w.start) }] })
  const tok = (w as any).tokens
  if (Number.isFinite(tok) && tok > 0) pieces.push({ segs: [{ text: S, dim: true }, { text: fill(L.tokens, { n: fmtK(tok) }), dim: true }], drop: 2 })
  if (w.status === 'failed') pieces.push({ segs: [{ text: S, dim: true }, { text: L.failed, tone: 'bad' }] })
  else if (tone !== 'ok' && w.last) pieces.push({ segs: [{ text: S, dim: true }, { text: fill(L.stalled, { min: Math.floor((now - w.last) / 60000) }), tone }], drop: 5 })
  else if (w.eta) pieces.push({ segs: [{ text: S, dim: true }, { text: w.overrun ? L.eta_over : fill(L.eta, { time: hhmm(w.eta) }), tone: w.overrun ? 'warn' : undefined }], drop: 1 })
  return pieces
}

const agentPieces = (a: EcAgent, now: number, c: ClarityCfg, lv: typeof EC_LEVELS, lone: boolean): Piece[] => {
  const L = c.labels
  const S = L.sep
  const tone = levelOf(a, now, lv)
  const bullet = lone && a.shape !== 'foreground' ? c.glyphs.background : c.glyphs.agent
  const pieces: Piece[] = [{ segs: [{ text: `${bullet} `, tone }] }]
  if (a.type) pieces.push({ segs: [{ text: `${a.type} `, dim: true }], drop: 4 })
  pieces.push({ segs: [{ text: a.label || a.id }], shrink: 1, min: 6 })
  if (a.model) pieces.push({ segs: [{ text: S, dim: true }, { text: a.model }], drop: 2 })
  if (a.start) pieces.push({ segs: [{ text: S, dim: true }, { text: elapsed(now - a.start) }] })
  const tok = (a as any).tokens
  if (Number.isFinite(tok) && tok > 0) pieces.push({ segs: [{ text: S, dim: true }, { text: fill(L.tokens, { n: fmtK(tok) }), dim: true }], drop: 1 })
  const pct = (a as any).pct
  if (Number.isFinite(pct)) pieces.push({ segs: [{ text: ' ' }, { text: miniBar(pct, c.summary_bar_cells), tone, bar: pct }, { text: ' ' + fill(L.pct, { n: Math.round(pct) }), tone }], drop: 3 })
  if (a.status === 'failed') pieces.push({ segs: [{ text: S, dim: true }, { text: L.failed, tone: 'bad' }] })
  else if (tone !== 'ok' && a.last) pieces.push({ segs: [{ text: S, dim: true }, { text: fill(L.stalled, { min: Math.floor((now - a.last) / 60000) }), tone }], drop: 5 })
  return pieces
}

const guide = (t: string): CSeg => ({ text: t, tone: 'dim' })

/** The sections' rows (without the summary), in config order; `mods` is a header the renderer fills with buttons. */
export const sectionRows = (f: ClarityIn, c: ClarityCfg, lv: Levels, columns: number, ecLv = EC_LEVELS): CRow[] => {
  const L = c.labels
  const G = c.glyphs
  const pad = ' '.repeat(c.indent)
  const rows: CRow[] = []
  const item = (sec: string, key: string, prefix: string, pieces: Piece[]) => {
    const room = Math.max(12, columns - cellsOf(pad + prefix))
    const segs = fitPieces(pieces.map(p => ({ ...p, segs: p.segs.map(s => ({ ...s })) })), room).map(toC)
    rows.push({ key, kind: 'item', section: sec, segs: [guide(pad + prefix), ...segs] })
  }
  const head = (sec: string, title: string) => {
    if (c.blank_lines) rows.push({ key: `blank-${sec}`, kind: 'blank', section: sec, segs: [{ text: '' }] })
    rows.push({ key: `head-${sec}`, kind: 'header', section: sec, segs: [{ text: pad + title, tone: 'accent', bold: true }] })
  }
  for (const sec of c.sections) {
    if (sec === 'running') {
      head(sec, L.sec_running)
      const d = f.running
      const wfs = (d?.workflows ?? []).filter(w => w.status === 'running' || w.status === 'failed')
      const lone = (d?.agents ?? []).filter(a => a.status === 'running' || a.status === 'failed')
      type Top = { kind: 'main' } | { kind: 'wf'; w: EcWorkflow } | { kind: 'ag'; a: EcAgent }
      const tops: Top[] = [...(f.working ? [{ kind: 'main' } as Top] : []), ...wfs.map(w => ({ kind: 'wf', w }) as Top), ...lone.map(a => ({ kind: 'ag', a }) as Top)]
      if (!tops.length) {
        rows.push({ key: 'run-none', kind: 'item', section: sec, segs: [guide(pad + G.last), { text: L.none_running, tone: 'dim' }] })
        continue
      }
      let used = 0
      let hidden = 0
      tops.forEach((t, i) => {
        const last = i === tops.length - 1
        const g = last ? G.last : G.branch
        if (used >= c.max_running) {
          hidden += t.kind === 'wf' ? 1 + t.w.agents.filter(a => a.status === 'running' || a.status === 'failed').length : 1
          return
        }
        used++
        if (t.kind === 'main') item(sec, 'run-main', g, [{ segs: [{ text: `${G.running} `, tone: 'ok' }, { text: L.main_row }] }])
        else if (t.kind === 'ag') item(sec, `run-ag-${t.a.id}`, g, agentPieces(t.a, f.now, c, ecLv, true))
        else {
          item(sec, `run-wf-${t.w.id}`, g, wfPieces(t.w, f.now, c, ecLv, columns - cellsOf(pad + g)))
          const kids = t.w.agents.filter(a => a.status === 'running' || a.status === 'failed')
          const shown = kids.slice(0, kids.length > c.max_agents ? c.max_agents - 1 : c.max_agents)
          const rest = kids.length - shown.length
          const under = last ? G.space : G.pipe
          shown.forEach((a, k) => {
            if (used >= c.max_running) return void hidden++
            used++
            item(sec, `run-wa-${t.w.id}-${a.id}`, under + (k === shown.length - 1 && !rest ? G.last : G.branch), agentPieces(a, f.now, c, ecLv, false))
          })
          if (rest) rows.push({ key: `run-wa-${t.w.id}-more`, kind: 'item', section: sec, segs: [guide(pad + under + G.last), { text: fill(L.more_agents, { n: rest }), tone: 'dim' }] })
        }
      })
      if (hidden) rows.push({ key: 'run-more', kind: 'item', section: sec, segs: [guide(pad + G.last), { text: fill(L.more, { n: hidden }), tone: 'dim' }] })
    } else if (sec === 'gauges') {
      const gs = gaugesOf(f, c, lv)
      const tps = c.gauges.includes('tps') && f.tps !== undefined && Number.isFinite(f.tps) ? f.tps : undefined
      const list = c.gauges.filter(id => id !== 'tps').map(id => gs.find(g => g.id === id)).filter((g): g is GaugeFig => !!g)
      if (!list.length && tps === undefined) continue
      head(sec, L.sec_gauges)
      const w = Math.max(...list.map(g => cellsOf(g.label)), 0)
      list.forEach((g, i) => {
        const last = i === list.length - 1 && tps === undefined
        const pieces: Piece[] = [{ segs: gaugeSegs(g, c, c.bar_cells, w) as Seg[] }]
        g.detail.forEach((d, k) => pieces.push({ segs: [{ text: L.sep, dim: true }, { text: d, dim: true }], drop: g.detail.length - k }))
        item(sec, `gauge-${g.id}`, last ? G.last : G.branch, pieces)
      })
      if (tps !== undefined) item(sec, 'gauge-tps', G.last, [{ segs: [{ text: `${L.tps} `, dim: true }, { text: fill(L.tps_value, { n: fmtK(tps) }) }] }])
    } else if (sec === 'pc') {
      const a = f.pc
      if (!a) continue
      head(sec, L.sec_pc)
      const segs: Seg[] = []
      const add = (t: string, tone?: Seg['tone'], dim?: boolean) => segs.push(...(segs.length ? [{ text: L.sep, dim: true }] : []), { text: t, ...(tone ? { tone } : {}), ...(dim ? { dim } : {}) })
      if (a.convs) add(fill(L.pc_conv, { n: a.convs }), 'ok')
      if (a.workflows) add(fill(L.pc_wf, { n: a.workflows }), a.wfTone ?? 'ok')
      if (a.agents) add(fill(L.pc_ag, { n: a.agents }), a.agTone ?? 'ok')
      if (a.ci) {
        if (a.ci.stale) add(L.pc_ci_stale, undefined, true)
        else if (a.ci.failed) add(fill(L.pc_ci_failed, { n: a.ci.failed }), 'bad')
        else if (a.ci.running) add(fill(L.pc_ci, { n: a.ci.running }), 'ok')
      }
      if (!segs.length) segs.push({ text: L.pc_none, dim: true })
      item(sec, 'pc-line', G.last, [{ segs }])
    } else if (sec === 'mods') {
      head(sec, L.sec_mods)
    }
  }
  return rows
}

/**
 * The whole clarity Jauge: the summary row (after the toggle glyph; `reserve` cells are kept for the relay and the
 * buttons the renderer may put on it), then, unfolded, the sections. Pure: same rows in the terminal, the desktop and
 * scripts/preview.mjs.
 */
export type RelayFit = { hint: string; button: string; pad: number }
export const clarityView = (
  f: ClarityIn,
  c: ClarityCfg,
  lv: Levels,
  columns: number,
  expanded: boolean,
  relay?: RelayFit,
  ecLv = EC_LEVELS,
): ClarityView & { relay: 'chip' | 'button' | 'none'; reserve: number } => {
  const toggle = `${expanded ? c.glyphs.open : c.glyphs.closed} `
  const room = columns - cellsOf(toggle)
  // the relay: a red chip and RESUME when the running state still fits beside them, else RESUME alone
  const btn = relay ? cellsOf(relay.button) + relay.pad + 1 : 0
  const chip = relay ? cellsOf(relay.hint) + 1 + btn : 0
  const r = runningOf(f.running, f.working, f.now, ecLv)
  const headW = cellsOf(segsText(runningSegs(r, c, true)))
  const mode: 'chip' | 'button' | 'none' = !relay ? 'none' : room - chip >= headW ? 'chip' : 'button'
  const reserve = mode === 'chip' ? chip : mode === 'button' ? btn : 0
  const s = summarySegs(f, c, lv, Math.max(10, room - reserve), ecLv)
  const rows: CRow[] = [{ key: 'summary', kind: 'summary', segs: [{ text: toggle, tone: s.tone === 'dim' ? 'dim' : s.tone, bold: true }, ...s.segs] }]
  if (expanded) rows.push(...sectionRows(f, c, lv, columns, ecLv))
  return { rows, tone: s.tone, running: s.running, relay: mode, reserve }
}
