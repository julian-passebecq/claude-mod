// band mod: the Jauge's « en cours » rows, pure (no $, no I/O; node --test runs it). Input: what scanner/encours.mjs
// prints for THIS conversation. Nothing runs -> no row (the Jauge stays one line). Same bullets as the cockpit:
//   ◇ cockpit-preview-g2 · ▸ Preview release 1/2 · 2 agents opus · 47 min · fin ~01:58
//      • coder p43-rag-identity · opus · 47 min    • coder p44-migration · opus · 47 min
//   ◦ agent d'arrière-plan · auditor · sonnet · 3 min
// Bullet colour = state (ok running, warn stalled: no write for stall_min, bad failed); type words grey. At most
// jauge.en_cours_rows rows, the last one then says « +N de plus · Cockpit › ».

export type EcAgent = { id: string; label?: string; type?: string; model?: string; status: string; start?: number; last?: number; stalled?: boolean; shape?: string; phase?: string }
export type EcWorkflow = { id: string; name: string; phases: string[]; phase?: string; phaseIdx?: number; status: string; start?: number; last?: number; stalled?: boolean; agents: EcAgent[]; eta?: number; overrun?: boolean }
export type EcData = { now?: number; workflows?: EcWorkflow[]; agents?: EcAgent[] }

export type Seg = { text: string; tone?: 'ok' | 'warn' | 'bad'; dim?: boolean }
export type EcRow = { key: string; indent: number; segs: Seg[] }
export type EcView = { rows: EcRow[]; more: number }

export type EcCfg = {
  rows: number
  /** agent rows under one workflow before « +N » */
  agent_lines: number
  /** cells between two agents on one row */
  gap: number
  indent: number
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

const toneOf = (status: string, stalled?: boolean): Seg['tone'] => (status === 'failed' ? 'bad' : stalled ? 'warn' : 'ok')

/** « opus », « 2 opus + 1 sonnet » for the running agents' model families. */
export const modelsText = (agents: EcAgent[]) => {
  const n = new Map<string, number>()
  for (const a of agents) n.set(a.model || '?', (n.get(a.model || '?') || 0) + 1)
  if (n.size <= 1) return [...n.keys()][0] ?? ''
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([m, k]) => `${k} ${m}`).join(' + ')
}

function workflowRow(w: EcWorkflow, now: number, L: Record<string, string>): EcRow {
  const S = L.sep
  const live = w.agents.filter(a => a.status === 'running')
  const segs: Seg[] = [{ text: `${L.workflow} `, tone: toneOf(w.status, w.stalled) }, { text: w.name }]
  if (w.phase || w.phases.length) {
    const i = (w.phaseIdx ?? -1) >= 0 ? `${(w.phaseIdx ?? 0) + 1}/${w.phases.length}` : w.phases.length ? `?/${w.phases.length}` : ''
    segs.push({ text: S, dim: true }, { text: `${L.phase} ${[w.phase, i].filter(Boolean).join(' ')}` })
  }
  if (live.length) {
    segs.push({ text: S, dim: true }, { text: live.length === 1 ? L.agents_one : fill(L.agents, { n: live.length }), dim: true })
    const m = modelsText(live)
    if (m) segs.push({ text: ` ${m}` })
  }
  if (w.start) segs.push({ text: S, dim: true }, { text: elapsed(now - w.start) })
  if (w.status === 'failed') segs.push({ text: S, dim: true }, { text: L.failed, tone: 'bad' })
  else if (w.stalled && w.last) segs.push({ text: S, dim: true }, { text: fill(L.stalled, { min: Math.floor((now - w.last) / 60000) }), tone: 'warn' })
  else if (w.eta) segs.push({ text: S, dim: true }, { text: w.overrun ? L.eta_over : fill(L.eta, { time: hhmm(w.eta) }), dim: true })
  return { key: `ec-wf-${w.id}`, indent: 0, segs }
}

// One agent, as it sits in a workflow's agent row: • coder p43-rag-identity · opus · 47 min
function agentItem(a: EcAgent, now: number, L: Record<string, string>): Seg[] {
  const stalled = a.status === 'running' && a.stalled
  const out: Seg[] = [{ text: `${L.agent} `, tone: toneOf(a.status, stalled) }]
  if (a.type) out.push({ text: `${a.type} `, dim: true })
  out.push({ text: a.label || a.id })
  if (a.model) out.push({ text: L.sep, dim: true }, { text: a.model })
  if (a.start) out.push({ text: L.sep, dim: true }, { text: elapsed(now - a.start) })
  return out
}

/** A workflow's agents packed into at most `lines` rows of `columns` cells; what does not fit becomes « +N ». */
function agentRows(w: EcWorkflow, now: number, c: EcCfg, columns: number): EcRow[] {
  const L = c.labels
  const show = w.agents.filter(a => a.status === 'running' || a.status === 'failed')
  if (!show.length) return []
  const items = show.map(a => agentItem(a, now, L))
  const width = Math.max(10, columns - c.indent)
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

function loneRow(a: EcAgent, now: number, L: Record<string, string>): EcRow {
  const bg = a.shape !== 'foreground'
  const stalled = a.status === 'running' && a.stalled
  const segs: Seg[] = [{ text: `${bg ? L.background : L.agent} `, tone: toneOf(a.status, stalled) }, { text: bg ? L.bg_word : L.fg_word, dim: true }]
  const what = [a.type, a.label].filter(Boolean).join(' ')
  if (what) segs.push({ text: L.sep, dim: true }, { text: what })
  if (a.model) segs.push({ text: L.sep, dim: true }, { text: a.model })
  if (a.start) segs.push({ text: L.sep, dim: true }, { text: elapsed(now - a.start) })
  if (a.status === 'failed') segs.push({ text: L.sep, dim: true }, { text: L.failed, tone: 'bad' })
  else if (stalled && a.last) segs.push({ text: L.sep, dim: true }, { text: fill(L.stalled, { min: Math.floor((now - a.last) / 60000) }), tone: 'warn' })
  return { key: `ec-ag-${a.id}`, indent: 0, segs }
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
    all.push(workflowRow(w, now, c.labels))
    all.push(...agentRows(w, now, c, columns))
  }
  for (const a of d.agents ?? []) all.push(loneRow(a, now, c.labels))
  if (all.length <= c.rows) return { rows: all, more: 0 }
  const keep = Math.max(0, c.rows - 1)
  return { rows: all.slice(0, keep), more: all.length - keep }
}

/** A row as plain text (tests, the /jauge reply). */
export const rowText = (r: EcRow) => ' '.repeat(r.indent) + r.segs.map(s => s.text).join('')
