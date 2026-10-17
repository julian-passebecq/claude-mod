// cockpit « Panneau » - the default view: one vertical panel, every section foldable (Julian, 17 Oct: « trop d'écrans »).
//   1. Fichiers                 data-goblin's file tree, embedded (hooks/files.mjs over the copies in lib/filetree)
//   2. Cette conversation       its agents and Workflows (nav.mjs treeRows), each node foldable
//   3. Toutes les conversations one synthesis table (not a factory view): who consumes, state, tok/s, last line, filters
//   4. Barres                   5 h %, semaine %, Codex semaine %, tok/s of all conversations, context %, Workflows actifs
// Pure: no $, no I/O (node --test mods/cockpit/tests/panel.test.mjs). Every label and limit comes from `panel` in
// cockpit.config.json (deep-merged over PANEL_DEFAULTS).
import { rank, codexTokens, windowOf } from './usage/lib/classement.mjs'
import { tokensOf } from './usage/lib/transcripts.mjs'
import { sessionState } from './factory/hooks/screens.mjs'
import { repoOf } from './factory/hooks/logic.mjs'

export const PANEL_SECTIONS = ['fichiers', 'conv', 'convs', 'barres']

export const PANEL_DEFAULTS = {
  enabled: true,
  order: PANEL_SECTIONS,
  // which sections start unfolded (the viewer's own choice is then kept in $.store)
  open: ['fichiers', 'conv', 'convs', 'barres'],
  fichiers: {
    // a file clicked in the tree is named to Claude as context of the next prompt, exactly as data-goblin's filetree
    // does (« The user has this file selected in the file tree ... »); off: the selection stays visual only
    attach_selection: true,
    max_rows: 30,
    more_step: 30,
    show_hidden: false,
    git: true,
  },
  convs: {
    periods: [{ id: '1h', label: '1 h', hours: 1 }, { id: 'today', label: 'aujourd’hui', since: 'midnight' }, { id: '7d', label: '7 j', hours: 168 }],
    period: 'today',
    top: 15,
    basis: 'tokens',
    who: 'claude',
    // the scan's states grouped in three: en cours, t'attend (waiting on Julian or blocked), terminée (the rest)
    states: { working: 'running', julian: 'waiting', blocked: 'waiting', done: 'done', idle: 'done', archived: 'done' },
    last_max: 90,
  },
  barres: { width: 140, workflows_max: 8, agents_max: 12 },
  labels: {
    panneau: 'Panneau',
    plus: 'Plus ▾',
    moins: 'Moins ▴',
    fichiers: 'Fichiers',
    conv: 'Cette conversation',
    convs: 'Toutes les conversations',
    barres: 'Barres',
    files_empty: 'dossier vide',
    files_none: 'pas de dossier de travail',
    files_more: '… {n} ligne(s) de plus',
    files_more_button: 'Plus de lignes',
    files_selected: 'sélection : {path}',
    files_attach_on: 'nommée à Claude au prochain message',
    files_attach_off: 'non envoyée (fichiers.attach_selection = false)',
    files_clear: 'Effacer',
    files_refresh: '↻',
    period: 'Période',
    project: 'Projet',
    state: 'État',
    all_projects: 'tous',
    all_states: 'tous',
    states: { running: 'en cours', waiting: 't’attend', done: 'terminée' },
    who_claude: 'Claude',
    who_codex: 'Codex',
    others: 'autres ({n})',
    codex_row: 'Codex (toutes les sessions, par jour entier)',
    no_data: 'pas encore de classement : le mod usage écrit classement.json (/conso classement)',
    no_rows: 'rien sur cette période',
    tps: 'tok/s',
    tps_hint: 'moyenne sur la dernière heure',
    total: 'Total',
    five: '5 h',
    week: 'Semaine',
    codex_week: 'Codex semaine',
    tps_all: 'tok/s toutes conv',
    ctx: 'Contexte (cette conv)',
    unknown: 'non lu',
    workflows: 'Workflows actifs',
    no_workflows: 'aucun Workflow en cours',
    agents: '{n} agent(s)',
    no_tree: 'aucun agent dans cette conversation',
  },
}

function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a || {}) }
  for (const [k, v] of Object.entries(b)) {
    if (k.startsWith('_')) continue
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v
  }
  return out
}

export function panelConfig(cfg) {
  const p = merge(PANEL_DEFAULTS, (cfg && cfg.panel) || {})
  p.order = (p.order || []).filter((s) => PANEL_SECTIONS.includes(s))
  return p
}

export function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])))
}

// ---- 2. Cette conversation: fold a tree of rows (each with a depth) at the nodes the viewer closed --------------------

/** rows: [{ key, depth, ... }] top to bottom. closed: { [key]: true }. Each kept row gets hasKids and isOpen. */
export function foldTree(rows, closed = {}) {
  const out = []
  let hideBelow = Infinity
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.depth > hideBelow) continue
    hideBelow = Infinity
    const next = rows[i + 1]
    const hasKids = Boolean(next && next.depth > r.depth)
    const isOpen = hasKids && !closed[r.key]
    out.push({ ...r, hasKids, isOpen })
    if (hasKids && !isOpen) hideBelow = r.depth
  }
  return out
}

// ---- 3. Toutes les conversations ---------------------------------------------------------------------------------------

const HOUR = 3600000

/** The group of a scan state: running | waiting | done. */
export function stateGroup(state, cfg) {
  const m = panelConfig(cfg).convs.states
  return m[state] || 'done'
}

function lastLine(s) {
  const st = String(s.status_detail || s.needs_action || '').trim()
  if (st) return st
  if (s.last_tool) return `dernier outil : ${s.last_tool}`
  return ''
}

const clipText = (t, n) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s
}

/**
 * The synthesis table. data: usage's classement.json; scan: factory's scan (state, last line, project of the
 * conversations it knows); codex: usage's codex.json. f: { period, project, state, who }.
 * Returns { rows, others, total, projects, period, periods, tps, hasData }.
 * rows: [{ id, label, project, state, stateLabel, tokens, cost, tps, last }], biggest consumer first (basis).
 */
export function synthesis(data, scan, codex, f, cfg, nowMs) {
  const c = panelConfig(cfg)
  const q = c.convs
  const L = c.labels
  const period = q.periods.find((p) => p.id === f.period) || q.periods.find((p) => p.id === q.period) || q.periods[0]
  const who = f.who || q.who
  const base = { rows: [], others: null, total: { tokens: 0, cost: 0 }, projects: [], period, periods: q.periods, tps: null, hasData: Boolean(data && Array.isArray(data.rows)) }
  if (who === 'codex') {
    const tz = (data && data.tzMin) || 0
    const n = codexTokens(codex, windowOf(period, nowMs, tz), tz)
    if (n === undefined) return { ...base, hasData: false }
    return { ...base, hasData: true, rows: n ? [{ id: 'codex', label: L.codex_row, project: '', state: 'done', stateLabel: '', tokens: n, cost: null, tps: null, last: '' }] : [], total: { tokens: n, cost: null } }
  }
  if (!base.hasData) return base
  const sessions = new Map()
  for (const s of (scan && scan.sessions) || []) {
    if (s.cli) sessions.set(s.cli, s)
  }
  // every conversation of the window (top: all), so filters apply before the cut
  const r = rank(data, { now: nowMs, preset: period, group: 'conversation', top: 100000, basis: q.basis === 'cost' ? 'cost' : 'tokens' })
  // tok/s: tokens of the last hour (its clock-hour buckets) over the seconds they cover
  const hour = rank(data, { now: nowMs, preset: { hours: 1 }, group: 'conversation', top: 100000, basis: 'tokens' })
  const secs = Math.max(60, (nowMs - hour.window.from) / 1000)
  const tpsOf = new Map(hour.rows.map((x) => [x.key, tokensOf(x.v) / secs]))
  const all = r.rows.map((x) => {
    const s = sessions.get(x.id)
    const st = s ? sessionState(s, f.fcfg || {}).state : 'done'
    const g = stateGroup(st, cfg)
    return {
      id: x.id, label: x.label, project: (s && repoOf(s)) || x.project || '?', state: g, stateLabel: L.states[g] || g,
      tokens: tokensOf(x.v), cost: x.v[7], tps: tpsOf.get(x.id) || 0, last: clipText(s ? lastLine(s) : '', q.last_max),
    }
  })
  const projects = [...new Set(all.map((x) => x.project))].sort((a, b) => a.localeCompare(b))
  const kept = all.filter((x) => (!f.project || x.project === f.project) && (!f.state || x.state === f.state))
  const sum = (list) => list.reduce((a, x) => ({ tokens: a.tokens + x.tokens, cost: a.cost + (x.cost || 0) }), { tokens: 0, cost: 0 })
  const top = Math.max(1, Number(q.top) || 15)
  const rows = kept.slice(0, top)
  const rest = kept.slice(top)
  const others = rest.length ? { count: rest.length, label: fill(L.others, { n: rest.length }), ...sum(rest), tps: rest.reduce((a, x) => a + x.tps, 0) } : null
  const tps = [...tpsOf.values()].reduce((a, b) => a + b, 0)
  return { ...base, rows, others, total: sum(kept), projects, tps }
}

/** The next value of a cycling filter button: '' (all) → each value → ''. */
export function cycle(list, cur) {
  const all = ['', ...list]
  const i = all.indexOf(cur || '')
  return all[(i + 1) % all.length]
}

// ---- 4. Barres ----------------------------------------------------------------------------------------------------------

/**
 * usage: $.session.usage() ({ rateLimits }); quotas: core readQuotas ({ claude: {five, week}, codex: {five, week} });
 * tps: tok/s of all conversations (synthesis().tps); ctxPct: this conversation's context %.
 * -> [{ id, label, pct (0..100) | null, text }]
 */
export function barsOf({ usage, quotas, tps, ctxPct }, cfg) {
  const L = panelConfig(cfg).labels
  const limits = (usage && usage.rateLimits) || []
  const lim = (kind) => {
    const r = limits.find((x) => x.kind === kind)
    return r && Number.isFinite(r.percentUsed) ? r.percentUsed : null
  }
  const qpct = (w) => (w && Number.isFinite(w.pct) ? w.pct : null)
  const five = lim('five_hour') ?? qpct(quotas && quotas.claude && quotas.claude.five)
  const week = lim('seven_day') ?? qpct(quotas && quotas.claude && quotas.claude.week)
  const cx = qpct(quotas && quotas.codex && quotas.codex.week)
  const pctText = (v) => (v === null || v === undefined ? L.unknown : `${Math.round(v)} %`)
  return [
    { id: 'five', label: L.five, pct: five, text: pctText(five) },
    { id: 'week', label: L.week, pct: week, text: pctText(week) },
    { id: 'codex_week', label: L.codex_week, pct: cx, text: pctText(cx) },
    { id: 'ctx', label: L.ctx, pct: Number.isFinite(ctxPct) ? ctxPct : null, text: pctText(Number.isFinite(ctxPct) ? ctxPct : null) },
    { id: 'tps', label: L.tps_all, pct: null, text: Number.isFinite(tps) && tps !== null ? `${Math.round(tps)} ${L.tps}` : L.unknown },
  ]
}

/** The running Workflows of factory's Workflow screen (workflowScreen(...).runs), each with its agents. */
export function activeWorkflows(screen, cfg) {
  const b = panelConfig(cfg).barres
  return ((screen && screen.runs) || []).filter((v) => v.live).slice(0, b.workflows_max).map((v) => {
    const agents = (v.agents || []).slice().sort((a, b2) => (b2.status === 'running') - (a.status === 'running'))
    return {
      key: 'wf:' + (v.id || v.name), name: v.name, count: agents.length, running: agents.filter((a) => a.status === 'running').length,
      tokens: agents.reduce((x, a) => x + (a.tokens || 0), 0),
      agents: agents.slice(0, b.agents_max).map((a) => ({ id: a.id, label: a.label || a.type || a.id, type: a.type, model: a.model, status: a.status, tokens: a.tokens || 0 })),
      hidden: Math.max(0, agents.length - b.agents_max),
    }
  })
}

export { HOUR }
