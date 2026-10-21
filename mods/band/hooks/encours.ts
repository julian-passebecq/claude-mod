// band mod: the Jauge's « en cours » rows, pure (no $, no I/O; node --test runs it). Input: what scanner/encours.mjs
// prints for THIS conversation. Nothing runs -> no row (the Jauge stays one line). Same bullets as the cockpit:
//   ◇ cockpit-preview-g2 ▰▰▰▱▱ 3/5 · ▸ Preview release · 2 agents opus · 47 min · fin ~01:58
//      • coder p43-rag-identity · opus · 47 min    • coder p44-migration · opus · 47 min
//   ◦ agent d'arrière-plan · auditor · sonnet · 3 min
// Bullet and mini bar colour = state (ok writing, warn no write for warn_min, bad no write for bad_min or failed); type
// words grey. The bar is phases done/total, else agents done/total (the desktop draws a thin Svg of it). A row wider
// than the band cuts names first (…), then the phase name, then drops fin ~HH:MM, then the agents and models. At most
// jauge.en_cours_rows rows, the last one then says « +N de plus · Cockpit › ».

export type EcAgent = { id: string; label?: string; type?: string; model?: string; status: string; start?: number; last?: number; stalled?: boolean; shape?: string; phase?: string }
export type EcWorkflow = { id: string; name: string; phases: string[]; phase?: string; phaseIdx?: number; status: string; start?: number; last?: number; stalled?: boolean; agents: EcAgent[]; eta?: number; overrun?: boolean }
export type EcData = { now?: number; workflows?: EcWorkflow[]; agents?: EcAgent[] }

/** bar: the segment is a mini bar of that % (text ▰▱ on the terminal, an Svg on the desktop). */
export type Seg = { text: string; tone?: 'ok' | 'warn' | 'bad'; dim?: boolean; bar?: number }
export type EcRow = { key: string; indent: number; segs: Seg[] }
export type EcView = { rows: EcRow[]; more: number }

export type EcCfg = {
  rows: number
  /** agent rows under one workflow before « +N » */
  agent_lines: number
  /** cells between two agents on one row */
  gap: number
  indent: number
  /** minutes without a write before orange, then red */
  warn_min: number
  bad_min: number
  bar_cells: number
  labels: Record<string, string>
}

export const DEF_EC_LABELS: Record<string, string> = {
  workflow: '◇',
  phase: '▸',
  agent: '•',
  background: '◦',
  bg_word: "agent d'arrière-plan",
  fg_word: 'agent',
  agents: '{n} agents',
  agents_one: '1 agent',
  eta: 'fin ~{time}',
  eta_over: "au-delà de l'estimation",
  stalled: 'rien écrit depuis {min} min',
  progress: '{done}/{total}',
  failed: 'échoué',
  more_agents: '+{n}',
  more: '+{n} de plus',
  cockpit: 'Cockpit ›',
  sep: ' · ',
}

export const ecCfg = (j: any): EcCfg => {
  const e = (j && j.en_cours) || {}
  const n = Number(j && j.en_cours_rows)
  return {
    rows: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5,
    agent_lines: Number.isFinite(Number(e.agent_lines)) ? Math.max(1, Number(e.agent_lines)) : 2,
    gap: Number.isFinite(Number(e.gap)) ? Math.max(1, Number(e.gap)) : 4,
    indent: Number.isFinite(Number(e.indent)) ? Math.max(0, Number(e.indent)) : 3,
    warn_min: Number(e.warn_min) > 0 ? Number(e.warn_min) : 15,
    bad_min: Number(e.bad_min) > 0 ? Number(e.bad_min) : 30,
    bar_cells: Number(j && j.bar_cells) > 0 ? Math.floor(Number(j.bar_cells)) : 5,
    labels: { ...DEF_EC_LABELS, ...(e.labels || {}) },
  }
}

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
const cells = (s: string) => [...s].length
const segsW = (xs: Seg[]) => xs.reduce((a, s) => a + cells(s.text), 0)

/** « 47 min », « < 1 min », « 1 h 05 ». */
export const elapsed = (ms: number) => {
  const m = Math.floor(Math.max(0, ms) / 60000)
  if (m < 1) return '< 1 min'
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

const hhmm = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** ok while it writes, warn after warn_min without a write (or the reader's stalled flag), bad after bad_min or failed. */
export const levelOf = (x: { status: string; last?: number; stalled?: boolean }, now: number, c: Pick<EcCfg, 'warn_min' | 'bad_min'>): NonNullable<Seg['tone']> => {
  if (x.status === 'failed') return 'bad'
  if (x.status !== 'running') return 'ok'
  const quiet = x.last ? (now - x.last) / 60000 : 0
  if (quiet >= c.bad_min) return 'bad'
  if (quiet >= c.warn_min || x.stalled) return 'warn'
  return 'ok'
}

const miniBar = (pct: number, n: number) => {
  const k = Math.max(0, Math.min(n, Math.round((n * Math.max(0, Math.min(100, pct))) / 100)))
  return '▰'.repeat(k) + '▱'.repeat(n - k)
}

/** Phases done/total (the current phase is not done yet), else agents done/total; undefined when neither is known. */
export const progressOf = (w: EcWorkflow): { done: number; total: number } | undefined => {
  if (w.phases.length && (w.phaseIdx ?? -1) >= 0) return { done: w.status === 'completed' ? w.phases.length : w.phaseIdx!, total: w.phases.length }
  if (w.agents.length) return { done: w.agents.filter(a => a.status === 'done').length, total: w.agents.length }
  return undefined
}

/** A row in pieces: shrink (names, by order) are cut with … first, then drop (by order) pieces are left out. */
type Piece = { segs: Seg[]; shrink?: number; min?: number; drop?: number }

const shorten = (t: string, by: number) => {
  const cs = [...t]
  return by <= 0 ? t : cs.slice(0, Math.max(0, cs.length - by - 1)).join('') + '…'
}

/** Fits the pieces in `columns` cells: cut the shrinkable texts (names first), then leave out the droppable pieces. */
export function fitPieces(pieces: Piece[], columns: number): Seg[] {
  const w = () => pieces.reduce((a, p) => a + segsW(p.segs), 0)
  const shrunk = pieces.filter(x => x.shrink !== undefined).sort((a, b) => a.shrink! - b.shrink!)
  const orig = new Map(shrunk.map(p => [p, p.segs[p.segs.length - 1].text]))
  for (const p of shrunk) {
    const over = w() - columns
    if (over <= 0) break
    const k = p.segs.length - 1
    const t = p.segs[k].text
    const room = cells(t) - Math.max(2, p.min ?? 6)
    if (room <= 0) continue
    p.segs[k] = { ...p.segs[k], text: shorten(t, Math.min(over, room)) }
  }
  const gone: { p: Piece; segs: Seg[] }[] = []
  for (const p of pieces.filter(x => x.drop !== undefined).sort((a, b) => a.drop! - b.drop!)) {
    if (w() <= columns) break
    gone.push({ p, segs: p.segs })
    p.segs = []
  }
  // a bigger drop may leave room for a smaller one dropped before it (names stay cut): put it back
  for (const g of gone.slice(0, -1).reverse()) if (w() + segsW(g.segs) <= columns) g.p.segs = g.segs
  // then give the cut names back as much as still fits, in the same order
  if (gone.length) {
    for (const p of shrunk) {
      const slack = columns - w()
      if (slack <= 0) break
      const k = p.segs.length - 1
      const full = orig.get(p)!
      const now = cells(p.segs[k].text)
      if (now >= cells(full)) continue
      const len = Math.min(cells(full), now + slack)
      p.segs[k] = { ...p.segs[k], text: len >= cells(full) ? full : shorten(full, cells(full) - len) }
    }
  }
  return pieces.flatMap(p => p.segs)
}

/** « opus », « 2 opus + 1 sonnet » for the running agents' model families. */
export const modelsText = (agents: EcAgent[]) => {
  const n = new Map<string, number>()
  for (const a of agents) n.set(a.model || '?', (n.get(a.model || '?') || 0) + 1)
  if (n.size <= 1) return [...n.keys()][0] ?? ''
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([m, k]) => `${k} ${m}`).join(' + ')
}

function workflowRow(w: EcWorkflow, now: number, c: EcCfg, columns: number): EcRow {
  const L = c.labels
  const S = L.sep
  const tone = levelOf(w, now, c)
  const live = w.agents.filter(a => a.status === 'running')
  const pieces: Piece[] = [{ segs: [{ text: `${L.workflow} `, tone }] }, { segs: [{ text: w.name }], shrink: 1, min: 8 }]
  const pr = progressOf(w)
  if (pr) {
    const pct = pr.total ? (pr.done * 100) / pr.total : 0
    pieces.push({ segs: [{ text: ' ' }, { text: miniBar(pct, c.bar_cells), tone, bar: pct }, { text: ' ' }, { text: fill(L.progress, pr), tone }] })
  }
  if (w.phase) pieces.push({ segs: [{ text: S, dim: true }, { text: `${L.phase} ${w.phase}` }], shrink: 2, min: 8 })
  if (live.length) {
    const m = modelsText(live)
    pieces.push({ segs: [{ text: S, dim: true }, { text: live.length === 1 ? L.agents_one : fill(L.agents, { n: live.length }), dim: true }, ...(m ? [{ text: ` ${m}` }] : [])], drop: 2 })
  }
  if (w.start) pieces.push({ segs: [{ text: S, dim: true }, { text: elapsed(now - w.start) }] })
  if (w.status === 'failed') pieces.push({ segs: [{ text: S, dim: true }, { text: L.failed, tone: 'bad' }] })
  else if (tone !== 'ok' && w.last) pieces.push({ segs: [{ text: S, dim: true }, { text: fill(L.stalled, { min: Math.floor((now - w.last) / 60000) }), tone }] })
  else if (w.eta) pieces.push({ segs: [{ text: S, dim: true }, { text: w.overrun ? L.eta_over : fill(L.eta, { time: hhmm(w.eta) }), dim: true }], drop: 1 })
  return { key: `ec-wf-${w.id}`, indent: 0, segs: fitPieces(pieces, columns) }
}

// One agent, as it sits in a workflow's agent row: • coder p43-rag-identity · opus · 47 min
function agentItem(a: EcAgent, now: number, c: EcCfg, width: number): Seg[] {
  const L = c.labels
  const pieces: Piece[] = [{ segs: [{ text: `${L.agent} `, tone: levelOf(a, now, c) }] }]
  if (a.type) pieces.push({ segs: [{ text: `${a.type} `, dim: true }], drop: 2 })
  pieces.push({ segs: [{ text: a.label || a.id }], shrink: 1, min: 6 })
  if (a.model) pieces.push({ segs: [{ text: L.sep, dim: true }, { text: a.model }], drop: 1 })
  if (a.start) pieces.push({ segs: [{ text: L.sep, dim: true }, { text: elapsed(now - a.start) }] })
  return fitPieces(pieces, width)
}

/** A workflow's agents packed into at most `lines` rows of `columns` cells; what does not fit becomes « +N ». */
function agentRows(w: EcWorkflow, now: number, c: EcCfg, columns: number): EcRow[] {
  const L = c.labels
  const show = w.agents.filter(a => a.status === 'running' || a.status === 'failed')
  if (!show.length) return []
  const width = Math.max(10, columns - c.indent)
  const items = show.map(a => agentItem(a, now, c, width))
  const rows: Seg[][] = [[]]
  let i = 0
  for (; i < items.length; i++) {
    const row = rows[rows.length - 1]
    const need = (row.length ? c.gap : 0) + segsW(items[i])
    const lastLine = rows.length === c.agent_lines
    const restAfter = items.length - i - 1
    const reserve = lastLine && restAfter > 0 ? c.gap + cells(fill(L.more_agents, { n: restAfter })) : 0
    if (!row.length || segsW(row) + need + reserve <= width) {
      if (row.length) row.push({ text: ' '.repeat(c.gap) })
      row.push(...items[i])
      continue
    }
    if (lastLine) break
    rows.push([...items[i]])
  }
  if (i < items.length) rows[rows.length - 1].push({ text: ' '.repeat(c.gap) }, { text: fill(L.more_agents, { n: items.length - i }), dim: true })
  return rows.map((segs, k) => ({ key: `ec-wa-${w.id}-${k}`, indent: c.indent, segs }))
}

function loneRow(a: EcAgent, now: number, c: EcCfg, columns: number): EcRow {
  const L = c.labels
  const bg = a.shape !== 'foreground'
  const tone = levelOf(a, now, c)
  const pieces: Piece[] = [{ segs: [{ text: `${bg ? L.background : L.agent} `, tone }] }, { segs: [{ text: bg ? L.bg_word : L.fg_word, dim: true }], shrink: 3, min: 5 }]
  const what = [a.type, a.label].filter(Boolean).join(' ')
  if (what) pieces.push({ segs: [{ text: L.sep, dim: true }, { text: what }], shrink: 1, min: 8 })
  if (a.model) pieces.push({ segs: [{ text: L.sep, dim: true }, { text: a.model }], drop: 1 })
  if (a.start) pieces.push({ segs: [{ text: L.sep, dim: true }, { text: elapsed(now - a.start) }] })
  if (a.status === 'failed') pieces.push({ segs: [{ text: L.sep, dim: true }, { text: L.failed, tone: 'bad' }] })
  else if (tone !== 'ok' && a.last) pieces.push({ segs: [{ text: L.sep, dim: true }, { text: fill(L.stalled, { min: Math.floor((now - a.last) / 60000) }), tone }] })
  return { key: `ec-ag-${a.id}`, indent: 0, segs: fitPieces(pieces, columns) }
}

/**
 * The rows for this conversation, capped at c.rows (0 = off): when more are needed, rows-1 of them then {more: N
 * hidden rows} (the caller draws « +N de plus · Cockpit › »). Empty when nothing runs.
 */
export function enCoursView(d: EcData | null | undefined, c: EcCfg, columns: number, nowMs?: number): EcView {
  const now = nowMs ?? d?.now ?? Date.now()
  if (!d || c.rows <= 0) return { rows: [], more: 0 }
  const all: EcRow[] = []
  for (const w of d.workflows ?? []) {
    all.push(workflowRow(w, now, c, columns))
    all.push(...agentRows(w, now, c, columns))
  }
  for (const a of d.agents ?? []) all.push(loneRow(a, now, c, columns))
  if (all.length <= c.rows) return { rows: all, more: 0 }
  const keep = Math.max(0, c.rows - 1)
  return { rows: all.slice(0, keep), more: all.length - keep }
}

/** A row as plain text (tests, the /jauge reply). */
export const rowText = (r: EcRow) => ' '.repeat(r.indent) + r.segs.map(s => s.text).join('')
