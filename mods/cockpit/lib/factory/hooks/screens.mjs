// factory v2 - the screens of the side panel, as pure view models (no $, no I/O; node --test tests/logic.test.mjs).
// Input: the scanner JSON (sessions with their recent events, detail of one conversation, reviews), the usage and
// machine extras when those mods are present. Output: what draw.mjs stacks top to bottom. Every label, threshold and
// the list of screens come from factory.config.json (`screens`), so nothing here is hard-coded but the arithmetic.
import {
  dashboard, conversation, titleOf, repoOf, short, family, ctxPct, ctxLevel, waitingOnJulian, localDay, fmtTokens,
  billByModel, sumCost,
} from './logic.mjs'
import { waitingRows, age } from './waiting.mjs'

export const SCREEN_DEFAULTS = {
  order: ['mission', 'focus', 'arbre', 'pipeline', 'quotas', 'systeme', 'journal'],
  enabled: ['mission', 'focus', 'arbre', 'pipeline', 'quotas', 'systeme', 'journal'],
  start: 'mission',
  recent_events: 12,
  quiet_min: 30,
  quiet_max_h: 12,
  timeline_max: 25,
  journal_max: 60,
  tree_children: true,
  tree_max_agents: 12,
  pipeline_hours: 24,
  plan_readonly_share: 0.9,
  quotas_refresh_s: 300,
  system_refresh_s: 10,
  gpu_every: 6,
  stages: ['plan', 'build', 'review', 'test', 'merge'],
  agent_stage: { Plan: 'plan', architect: 'plan', Explore: 'plan', 'explore-fast': 'plan', coder: 'build', 'general-purpose': 'build',
    'code-review': 'review', auditor: 'review', verify: 'review', tester: 'test', debug: 'test' },
  handoff_match: 'handoff|RESUME\\.md|passe le relais|hand(ed)? off',
  layout: { narrow: 70, wide: 110, bar_min: 8, bar_max: 40 },
  labels: {
    tabs: { mission: 'Mission', focus: 'Focus', arbre: 'Arbre', pipeline: 'Pipeline', quotas: 'Quotas', systeme: 'Système', journal: 'Journal' },
    counters: { working: 'en cours', idle: 'au repos', blocked: 'bloquées', julian: 'attend Julian', done: 'terminées aujourd’hui', cost: 'coût du jour' },
    states: { working: 'en cours', idle: 'au repos', blocked: 'bloquée', julian: 'attend Julian', done: 'terminée', archived: 'archivée' },
    agent_states: { running: 'en cours', done: 'terminé', failed: 'échoué', stopped: 'arrêté' },
    stages: { plan: 'plan', build: 'build', review: 'revue', test: 'test / CI', merge: 'merge' },
    timeline: { stuck: 'Bloquée', quiet: 'Calme', context: 'Contexte', compact: 'Compactage', merged: 'PR mergée', pr: 'PR liée',
      blocked: 'Bloquée', handoff: 'Relais', done: 'Terminée', julian: 'Attend Julian', failed: 'Agent échoué' },
    journal_kinds: { all: 'tout', prompt: 'prompts', tool: 'outils', agent: 'agents', compact: 'compactages', pr: 'PR', notif: 'notifications', error: 'erreurs' },
    mission_title: 'Mission',
    projects: 'Projets',
    lead: 'lead',
    subconv: 'sous-conv.',
    workers: 'agents',
    share_title: 'Part des modèles aujourd’hui vs cibles V6 ({metric})',
    target: 'cible',
    list_title: 'Conversations',
    filters: { all: 'Toutes', live: 'En cours', problems: 'Problèmes', julian: 'Attend Julian' },
    focus_title: 'Ce qui me concerne',
    pulse: 'Pouls de la flotte',
    agents_running: 'agents en cours',
    timeline_title: 'Fil en direct',
    progress: 'Progrès aujourd’hui',
    progress_row: '{done}/{total} terminées · {merged} PR mergées',
    tree_title: 'Arbre de la conversation',
    pick: 'Choisir une conversation',
    this_conv: 'Cette conversation',
    main: 'lead',
    subconvs: 'Sous-conversations',
    workflow: 'workflow',
    no_agents: 'aucun sous-agent',
    architect_title: 'architecte · sur appel',
    architect_triggers: ['before plan', 'error repeats', 'before done'],
    architect_trigger_labels: { 'before plan': 'avant un plan', 'error repeats': 'erreur répétée', 'before done': 'avant « fini »' },
    architect_none: 'aucun appel à l’architecte dans cette conversation',
    architect_calls: 'appels {calls} · lus {tokens}',
    bill_title: 'Facture (estimation)',
    bill_every: 'à chaque tour',
    bill_on_call: 'sur appel (architecte)',
    guards_title: 'Approbations et garde-fous',
    guards_none: 'rien de refusé',
    log_title: 'Journal de session',
    warnings_title: 'Alertes',
    warnings_none: 'aucune',
    status_line: 'lead [{model} · {effort}]  agents [{running}/{total}]  architecte [{arch}]  ctx [{ctx}%]',
    arch_idle: 'au repos',
    arch_busy: 'consulté',
    pipeline_title: 'Travail en vol',
    pipeline_note: 'Étape déduite des sessions, PR et CI (heuristique, non vérifié).',
    quotas_title: 'Quotas',
    five_hour: 'Claude 5 h',
    seven_day: 'Claude semaine',
    reset: 'reset {when}',
    exhausted: 'épuisé {when}',
    left_at_reset: 'il restera {pct} % au reset',
    codex: 'Codex',
    cost_model: 'Coût du jour par modèle',
    cost_project: 'Coût du jour par projet',
    system_title: 'Système',
    cpu: 'CPU', ram: 'RAM', gpu: 'GPU', disk: 'Disque', runner: 'Runner GitLab',
    journal_title: 'Journal',
    module_missing: 'module {mod} non chargé',
    module_missing_hint: 'Installe le mod « {mod} » à côté de factory (même dossier mods/) pour voir cette section.',
    unavailable: 'non disponible',
    scanning: 'Lecture des transcripts…',
    not_found: 'Conversation introuvable dans le dernier passage.',
    refresh: 'Rafraîchir',
    refreshing: 'Lecture…',
    updated: 'mis à jour {time}',
    nothing: 'rien',
    open: 'Ouvrir',
  },
}

// ---- config ---------------------------------------------------------------------------------------------------------

function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a || {}) }
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v
  return out
}

export function screensConfig(cfg) {
  return merge(SCREEN_DEFAULTS, (cfg && cfg.screens) || {})
}

export function fill(tpl, vars) {
  return String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
}

// The tabs shown, in order: `order` filtered by `enabled`; unknown ids dropped.
export function tabsOf(cfg) {
  const c = screensConfig(cfg)
  const known = new Set(SCREEN_DEFAULTS.order)
  return c.order.filter((t) => known.has(t) && c.enabled.includes(t)).map((id) => ({ id, label: (c.labels.tabs || {})[id] || id }))
}

const TAB_ALIASES = { systeme: 'systeme', system: 'systeme', 'système': 'systeme', arbre: 'arbre', tree: 'arbre', journal: 'journal', log: 'journal',
  mission: 'mission', focus: 'focus', pipeline: 'pipeline', quotas: 'quotas', quota: 'quotas' }

// "/factory quotas" -> {tab: 'quotas', rest: ''}; "/factory My lane" -> {tab: null, rest: 'My lane'}.
export function parseArgs(args, cfg) {
  const words = String(args || '').trim().split(/\s+/).filter(Boolean)
  const t = words.length ? TAB_ALIASES[words[0].toLowerCase()] : null
  const ok = t && tabsOf(cfg).some((x) => x.id === t)
  return { tab: ok ? t : null, rest: (ok ? words.slice(1) : words).join(' ') }
}

// ---- layout: everything stacks; only the counters grid, bar widths and label pads follow the pane width ------------

export function layout(columns, cfg) {
  const L = screensConfig(cfg).layout
  const cols = Number(columns) > 0 ? Number(columns) : 80
  const narrow = cols < L.narrow
  const wide = cols >= L.wide
  return {
    cols, narrow, wide,
    counterCols: wide ? 6 : narrow ? 2 : 3,
    cardCols: wide ? 2 : 1,
    bar: Math.max(L.bar_min, Math.min(L.bar_max, Math.floor(cols * (narrow ? 0.35 : 0.3)))),
    pad: narrow ? 12 : 18,
    textMax: Math.max(20, cols - 6),
  }
}

export function chunk(list, n) {
  const out = []
  for (let i = 0; i < list.length; i += Math.max(1, n)) out.push(list.slice(i, i + Math.max(1, n)))
  return out
}

export function bar(pct, width) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  const full = Math.round((p / 100) * width)
  return '█'.repeat(full) + '░'.repeat(Math.max(0, width - full))
}

const EFFORT = { low: 1, medium: 2, med: 2, high: 3, xhigh: 4, max: 4 }

export function effortBars(effort) {
  const n = EFFORT[String(effort || '').toLowerCase()]
  return n ? '▮'.repeat(n) + '▯'.repeat(4 - n) : '····'
}

export function modelEffort(model, effort) {
  return `${short(model)} · ${effortBars(effort)} ${effort || '?'}`
}

export function clip(s, n) {
  s = String(s ?? '')
  return s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + '…'
}

function tsMs(v) {
  if (!v) return null
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

// ---- one conversation's state ----------------------------------------------------------------------------------------

// working | julian | blocked | done | idle | archived, with a short reason for blocked / julian.
export function sessionState(s, cfg) {
  if (s.archived && !s.live) return { state: 'archived', reason: '' }
  if (s.live) return { state: 'working', reason: '' }
  if (waitingOnJulian(s) || s.awaiting) return { state: 'julian', reason: String(s.needs_action || s.ask_q || '').trim() }
  const ci = s.ci || {}
  if (s.status_category === 'blocked') return { state: 'blocked', reason: String(s.status_detail || s.needs_action || 'bloquée').trim() }
  if (/open/.test(String(ci.state || '')) && ['failed', 'canceled', 'skipped'].includes(String(ci.ci || ''))) {
    return { state: 'blocked', reason: `PR #${(s.pr || {}).number} CI ${ci.ci}` }
  }
  if (s.status_category === 'completed' || /merged/.test(String(ci.state || ''))) return { state: 'done', reason: '' }
  return { state: 'idle', reason: '' }
}

function isToday(s, nowMs) {
  const t = tsMs(s.last_activity) || tsMs(s.mtime)
  return Boolean(t) && localDay(t) === localDay(nowMs)
}

function visible(scan) {
  return ((scan && scan.sessions) || []).filter((s) => !(s.archived && !s.live))
}

// ---- Mission -----------------------------------------------------------------------------------------------------

export function mission(scan, cfg, nowMs) {
  const c = screensConfig(cfg)
  const dash = dashboard(scan || { sessions: [] }, cfg, nowMs)
  const sessions = visible(scan)
  const states = new Map(sessions.map((s) => [s.cli, sessionState(s, cfg)]))
  const count = (st) => sessions.filter((s) => states.get(s.cli).state === st).length
  const blocked = sessions.filter((s) => states.get(s.cli).state === 'blocked')
  const counters = {
    working: count('working'),
    idle: count('idle'),
    blocked: blocked.length,
    blockedReasons: blocked.slice(0, 3).map((s) => `${clip(titleOf(s), 28)} : ${states.get(s.cli).reason}`),
    julian: count('julian'),
    done: sessions.filter((s) => states.get(s.cli).state === 'done' && isToday(s, nowMs)).length,
    cost: dash.totalCost,
  }
  const costByCli = new Map(dash.rows.map((r) => [r.cli, r.costToday]))
  const groups = new Map()
  for (const s of sessions) {
    const repo = repoOf(s)
    const g = groups.get(repo) || { repo, sessions: [] }
    g.sessions.push(s)
    groups.set(repo, g)
  }
  const projects = [...groups.values()].map((g) => {
    const sids = new Set(g.sessions.map((s) => s.sid).filter(Boolean))
    const parents = new Set(g.sessions.map((s) => s.parent).filter((p) => p && sids.has(p)))
    const byRecent = [...g.sessions].sort((a, b) => (b.live - a.live) || ((tsMs(b.last_activity) || 0) - (tsMs(a.last_activity) || 0)))
    const lead = byRecent.find((s) => parents.has(s.sid)) || byRecent.find((s) => !s.parent) || byRecent[0]
    const subconvs = g.sessions.filter((s) => s.parent && s !== lead)
    const workers = g.sessions.reduce((a, s) => a + (s.subs || []).filter((x) => x.status === 'running').length, 0)
    const st = {}
    for (const s of g.sessions) { const k = states.get(s.cli).state; st[k] = (st[k] || 0) + 1 }
    return {
      repo: g.repo, lead: { cli: lead.cli, title: titleOf(lead), model: lead.app_model || lead.model, effort: lead.app_effort || lead.effort || '?',
        ctxPct: ctxPct(lead.ctx, cfg), ctxLevel: ctxLevel(lead.ctx, cfg), state: states.get(lead.cli).state },
      subconvs: subconvs.map((s) => ({ cli: s.cli, title: titleOf(s), state: states.get(s.cli).state, model: s.app_model || s.model, effort: s.app_effort || s.effort || '?' })),
      sessions: g.sessions.length, workers, states: st, live: g.sessions.some((s) => s.live),
      maxCtxPct: Math.max(0, ...g.sessions.map((s) => ctxPct(s.ctx, cfg))),
      cost: g.sessions.reduce((a, s) => a + (costByCli.get(s.cli) || 0), 0),
    }
  }).sort((a, b) => (b.live - a.live) || (b.cost - a.cost))
  const metric = (cfg.routing_targets || {}).metric || 'calls'
  return { counters, projects, share: dash.share, shareTitle: fill(c.labels.share_title, { metric }), rows: dash.rows, dash, states }
}

// ---- Focus: timeline, pulse, progress ---------------------------------------------------------------------------------

export function timeline(scan, cfg, nowMs) {
  const c = screensConfig(cfg)
  const T = c.labels.timeline
  const hand = new RegExp(c.handoff_match, 'i')
  const handoffTokens = ((cfg.thresholds || {}).handoff_tokens) ?? 250000
  const out = []
  const add = (s, ts, kind, level, text) => {
    if (!ts) return
    out.push({ ts, kind, label: T[kind] || kind, level, text, title: titleOf(s), repo: repoOf(s), cli: s.cli })
  }
  for (const s of visible(scan)) {
    const last = tsMs(s.last_activity) || tsMs(s.mtime)
    const st = sessionState(s, cfg)
    for (const e of s.recent || []) {
      const t = tsMs(e[0])
      if (e[1] === 'compact') add(s, t, 'compact', 'warn', e[2])
      else if (e[1] === 'pr') add(s, t, 'pr', 'ok', e[2])
      else if (e[1] === 'notif' && /fail|killed|error|échou/i.test(e[2])) add(s, t, 'failed', 'bad', e[2])
      else if (hand.test(String(e[2] || ''))) add(s, t, 'handoff', 'ok', e[2])
    }
    if ((s.ctx || 0) > handoffTokens && !s.archived) {
      add(s, last, 'context', s.resume_md ? 'warn' : 'bad', `${fmtTokens(s.ctx)} > ${fmtTokens(handoffTokens)} : passer le relais${s.resume_md ? '' : ' (pas de handoff/RESUME.md)'}`)
    }
    if (st.state === 'blocked') add(s, last, 'blocked', 'bad', st.reason)
    if (st.state === 'julian') add(s, last, 'julian', 'warn', st.reason || 'question en attente')
    if (st.state === 'done' && /merged/.test(String((s.ci || {}).state || ''))) add(s, last, 'merged', 'ok', `PR #${(s.pr || {}).number}`)
    else if (st.state === 'done') add(s, last, 'done', 'ok', s.status_detail || '')
    if (st.state === 'idle' && last && nowMs - last >= c.quiet_min * 60000 && nowMs - last <= c.quiet_max_h * 3600000) {
      add(s, last, 'quiet', 'dim', `aucun tour depuis ${age(nowMs - last)}`)
    }
    if (st.state === 'working' && (s.subs || []).some((x) => x.status === 'running') === false && s.last_error && tsMs(s.last_error[0]) && nowMs - tsMs(s.last_error[0]) < 10 * 60000) {
      add(s, tsMs(s.last_error[0]), 'stuck', 'warn', s.last_error[2])
    }
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, c.timeline_max)
}

export function focus(scan, cfg, nowMs) {
  const m = mission(scan, cfg, nowMs)
  const w = waitingRows(scan || { sessions: [] }, cfg, nowMs)
  const running = visible(scan).reduce((a, s) => a + (s.subs || []).filter((x) => x.status === 'running').length, 0)
  const progress = m.projects.map((p) => {
    const ss = visible(scan).filter((s) => repoOf(s) === p.repo && isToday(s, nowMs))
    const done = ss.filter((s) => m.states.get(s.cli).state === 'done').length
    const merged = ss.reduce((a, s) => a + (s.merged_prs || 0), 0)
    return { repo: p.repo, done, total: ss.length, merged, pct: ss.length ? Math.round((100 * done) / ss.length) : 0 }
  }).filter((p) => p.total > 0)
  return { waiting: w, pulse: { ...m.counters, running }, timeline: timeline(scan, cfg, nowMs), progress }
}

// ---- Arbre: one conversation, Codex agent-tree style, top to bottom ---------------------------------------------------

// Running nodes first, then the most recent; past max, one summary line (count per type) instead of the rest.
export function trimNodes(nodes, max) {
  const sorted = [...nodes].sort((a, b) => ((b.status === 'running') - (a.status === 'running')) || String(b.ts || '').localeCompare(String(a.ts || '')))
  const shown = sorted.slice(0, Math.max(1, max))
  const rest = sorted.slice(shown.length)
  const by = {}
  for (const n of rest) by[n.type] = (by[n.type] || 0) + 1
  return { shown, hidden: rest.length, hiddenText: Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(', ') }
}

export function tree(scan, cfg, nowMs) {
  const c = screensConfig(cfg)
  const d = scan && scan.detail
  if (!d) return null
  const conv = conversation(d, cfg, nowMs)
  const sessions = (scan && scan.sessions) || []
  const children = c.tree_children && d.sid ? sessions.filter((s) => s.parent === d.sid).map((s) => {
    const st = sessionState(s, cfg)
    const bill = billByModel([s.models, ...(s.subs || []).map((x) => x.models)], cfg)
    return { cli: s.cli, title: titleOf(s), state: st.state, reason: st.reason, model: s.app_model || s.model, effort: s.app_effort || s.effort || '?',
      ctxPct: ctxPct(s.ctx, cfg), ctxLevel: ctxLevel(s.ctx, cfg), cost: sumCost(bill), tokens: Object.values(bill).reduce((a, b) => a + b.tokens, 0),
      agents: (s.subs || []).length, running: (s.subs || []).filter((x) => x.status === 'running').length,
      pr: s.pr ? { number: s.pr.number, state: (s.ci || {}).state || '?', ci: (s.ci || {}).ci || '?' } : null }
  }) : []
  const all = [...conv.agents, ...conv.workflows.flatMap((w) => w.nodes)]
  const arch = all.filter((n) => n.architect)
  const triggers = c.labels.architect_triggers.map((t) => ({ id: t, label: (c.labels.architect_trigger_labels || {})[t] || t, count: arch.filter((n) => n.architect === t).length }))
  const archCost = arch.reduce((a, n) => a + n.cost, 0)
  const running = all.filter((n) => n.status === 'running').length
  const archBusy = arch.some((n) => n.status === 'running')
  const status = fill(c.labels.status_line, { model: short(conv.main.model), effort: conv.main.effort, running, total: all.length,
    arch: archBusy ? c.labels.arch_busy : arch.length ? `${arch.length} appel(s)` : c.labels.arch_idle, ctx: conv.main.ctxPct })
  return {
    ...conv, children,
    agentsView: trimNodes(conv.agents, c.tree_max_agents),
    workflowsView: conv.workflows.map((w) => ({ ...w, view: trimNodes(w.nodes, c.tree_max_agents) })),
    architect: { calls: arch.length, tokens: arch.reduce((a, n) => a + n.tokens, 0), cost: archCost, triggers, busy: archBusy,
      last: arch.length ? arch[arch.length - 1] : null },
    billSplit: { every: conv.total - archCost, onCall: archCost },
    running, totalAgents: all.length, status,
  }
}

// ---- Pipeline ------------------------------------------------------------------------------------------------------

export function stageOf(s, cfg) {
  const c = screensConfig(cfg)
  const ci = s.ci || {}
  const st = String(ci.state || '')
  if (s.pr && /merged|closed/.test(st)) return null
  if (s.pr && /open/.test(st)) return ci.ci === 'success' ? 'merge' : 'test'
  if ((s.app_prs || []).length) return 'test'
  const order = c.stages
  const running = (s.subs || []).filter((x) => x.status === 'running').map((x) => c.agent_stage[x.type]).filter(Boolean)
  if (running.length) return running.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0]
  if (!s.tools || (s.readonly || 0) / Math.max(1, s.tools) >= c.plan_readonly_share) return 'plan'
  return 'build'
}

export function pipeline(scan, cfg, nowMs) {
  const c = screensConfig(cfg)
  const from = nowMs - c.pipeline_hours * 3600000
  const rows = new Map()
  for (const s of visible(scan)) {
    const last = tsMs(s.last_activity) || tsMs(s.mtime) || 0
    if (last < from && !s.live) continue
    const st = sessionState(s, cfg)
    if (st.state === 'done') continue
    const stage = stageOf(s, cfg)
    if (!stage) continue
    const repo = repoOf(s)
    const r = rows.get(repo) || { repo, stages: Object.fromEntries(c.stages.map((k) => [k, []])) }
    const ci = s.ci || {}
    r.stages[stage].push({ cli: s.cli, title: titleOf(s), state: st.state, live: Boolean(s.live),
      level: st.state === 'blocked' || ci.ci === 'failed' ? 'bad' : st.state === 'julian' ? 'warn' : s.live ? 'running' : 'dim',
      pr: s.pr ? `#${s.pr.number}${ci.ci ? ' ' + ci.ci : ''}` : '' })
    rows.set(repo, r)
  }
  const list = [...rows.values()].sort((a, b) => c.stages.reduce((n, k) => n + b.stages[k].length, 0) - c.stages.reduce((n, k) => n + a.stages[k].length, 0))
  const totals = Object.fromEntries(c.stages.map((k) => [k, list.reduce((n, r) => n + r.stages[k].length, 0)]))
  return { stages: c.stages.map((k) => ({ id: k, label: c.labels.stages[k] || k })), rows: list, totals }
}

// ---- Quotas --------------------------------------------------------------------------------------------------------

// live: $.session.usage().rateLimits; extras: scanner/extras.mjs quotas output (usage mod), or {available:false}.
export function quotas(scan, cfg, nowMs, live, extras) {
  const c = screensConfig(cfg)
  const L = c.labels
  const dash = dashboard(scan || { sessions: [] }, cfg, nowMs)
  const win = (kind, label) => {
    const fromUsage = extras && extras.available && extras[kind]
    const l = (live || []).find((r) => r.kind === kind)
    const pct = fromUsage && Number.isFinite(fromUsage.pct) ? fromUsage.pct : l && Number.isFinite(l.percentUsed) ? l.percentUsed : null
    if (pct === null) return { kind, label, available: false }
    const reset = (fromUsage && fromUsage.reset) || (l && Date.parse(l.resetsAt || '')) || null
    return { kind, label, available: true, pct, reset: Number.isFinite(reset) ? reset : null, forecast: fromUsage ? fromUsage.forecast || '' : '', live: Boolean(l) }
  }
  const byModel = Object.entries(dash.byModel).map(([m, b]) => ({ model: m, family: family(m), cost: b.cost, tokens: b.tokens, calls: b.calls })).sort((a, b) => b.cost - a.cost)
  const byProject = Object.entries(dash.byProject).filter(([, b]) => b.cost > 0).map(([p, b]) => ({ repo: p, cost: b.cost, tokens: b.tokens, sessions: b.sessions })).sort((a, b) => b.cost - a.cost)
  return {
    windows: [win('five_hour', L.five_hour), win('seven_day', L.seven_day)],
    usage: extras && extras.available ? 'ok' : 'missing', usageReason: extras && extras.reason,
    codex: extras && extras.codex ? extras.codex : null,
    byModel, byProject, total: dash.totalCost,
  }
}

// ---- Système -------------------------------------------------------------------------------------------------------

export function system(sample, runner) {
  if (!sample) return { available: false }
  const gb = (b) => (b ? (b / 1e9).toFixed(1) : '?')
  const gpus = ((sample.gpu && sample.gpu.gpus) || []).map((g) => ({ name: g.name, pct: g.util, mem: g.mem_total_mb ? `${Math.round(g.mem_used_mb)} / ${Math.round(g.mem_total_mb)} Mo` : '', temp: g.temp_c }))
  return {
    available: true, at: sample.at, ncpu: sample.ncpu,
    cpu: sample.cpu && Number.isFinite(sample.cpu.total) ? sample.cpu.total : null,
    ram: sample.ram ? { pct: sample.ram.pct, text: `${gb(sample.ram.used)} / ${gb(sample.ram.total)} Go` } : null,
    disks: (sample.disks || []).map((d) => ({ drive: d.drive, pct: d.pct_used, text: `${gb(d.free)} Go libres` })),
    gpus, gpuRead: Boolean(sample.gpu),
    families: Object.entries((sample.procs && sample.procs.families) || {}).map(([k, v]) => ({ name: k, count: v.count, cpu: v.cpu })).sort((a, b) => b.cpu - a.cpu).slice(0, 6),
    runnerProc: sample.procs && sample.procs.runner ? sample.procs.runner : null,
    runners: runner && !runner.error ? (runner.backends || []).map((b) => ({ label: b.label, usable: b.usable, why: b.why,
      jobs: b.jobs, runners: b.runners, concurrent: b.concurrent })) : [],
    runnerError: runner && runner.error ? runner.error : '',
  }
}

// ---- Journal ------------------------------------------------------------------------------------------------------

export const JOURNAL_KINDS = ['all', 'prompt', 'tool', 'agent', 'compact', 'pr', 'notif', 'error']

export function journal(scan, cfg, filter = 'all', project = '') {
  const c = screensConfig(cfg)
  const out = []
  for (const s of visible(scan)) {
    const repo = repoOf(s)
    if (project && repo !== project) continue
    for (const e of s.recent || []) {
      const kind = e[1] === 'peer' || e[1] === 'task-notification' ? 'notif' : e[1]
      out.push({ ts: tsMs(e[0]) || 0, kind, text: e[2], title: titleOf(s), repo, cli: s.cli })
    }
    if (s.last_error) out.push({ ts: tsMs(s.last_error[0]) || 0, kind: 'error', text: s.last_error[2], title: titleOf(s), repo, cli: s.cli })
  }
  const counts = Object.fromEntries(JOURNAL_KINDS.map((k) => [k, k === 'all' ? out.length : out.filter((x) => x.kind === k).length]))
  const rows = out.filter((x) => filter === 'all' || x.kind === filter).sort((a, b) => b.ts - a.ts).slice(0, c.journal_max)
  const projects = [...new Set(visible(scan).map(repoOf))].sort()
  return { rows, counts, projects }
}

