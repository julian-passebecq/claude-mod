// factory « Workflow » screen - view models only (no $, no I/O; node --test mods/factory/tests/workflow.test.mjs).
// Input: the JSON of scanner/workflow_scan.py ({runs, live, history}). Output: per workflow its phases as a vertical
// timeline, its agents, highlights (failed, stuck, no explicit model, parallel limits), estimates from this PC's past
// runs (median, range, sample size) with an ETA clock time, a complexity badge, a Gantt and one plain French sentence.
// Every label, threshold and limit comes from workflow.config.json / factory.config.json → `workflow`.
import { billByModel, sumCost, tokensOf, family, short, costOf } from './logic.mjs'
// One estimate rule and one Gantt for Workflows (here) and pipelines (ci mod): byte copies of lib/core (scripts/sync-libs.mjs).
import { quantiles, remaining } from '../lib/core/estimate.mjs'
import { gantt as coreGantt, axis as coreAxis, legend as coreLegend } from '../lib/core/gantt.mjs'

export const WORKFLOW_DEFAULTS = {
  tab_after: 'arbre',
  scope: 'conversation',
  hours: 36,
  stale_h: 6,
  history_days: 30,
  stuck_min: 15,
  min_samples: 3,
  max_runs: 12,
  refresh_s: 20,
  limits: { ci: 4, npm: 3 },
  ci_match: 'gh (pr|run) (checks|watch)|glab (ci|pipeline) (status|view|list)|--watch|ci status --live',
  npm_match: '\\bnpm (ci|install|i)\\b|\\btsc\\b|npm run (build|typecheck|check)|\\bpnpm (install|i)\\b',
  complexity: { m: 1, l: 5, xl: 20 },
  gantt: { min_bar: 16, label_w: 14 },
  speed: { cap_max: 16, cpu_reserve: 2, session_guideline: 10, seq_gap_s: 90, buckets: 24 },
  open_finished: false,
  labels: {
    tab: 'Workflow',
    title: 'Workflows',
    scope_conv: 'Cette conversation',
    scope_all: 'Toutes les conversations',
    none: 'Aucun workflow dans cette conversation (dernières {hours} h).',
    none_all: 'Aucun workflow sur ce PC (dernières {hours} h).',
    scanning: 'Lecture des workflows…',
    status: { running: 'en cours', completed: 'terminé', failed: 'échoué', killed: 'arrêté', interrupted: 'interrompu' },
    agent_status: { running: 'en cours', done: 'fini', failed: 'échoué', skipped: 'sauté', waiting: 'en attente' },
    phase_status: { done: 'fini', running: 'en cours', waiting: 'à venir', failed: 'échoué' },
    sentence_running: 'Phase {phase} sur {phases} ({title}), {running} agent(s) en cours, {eta}, ~{tokens} tokens, ~{cost}',
    sentence_done: 'Terminé à {end} en {dur}, {agents} agent(s), {tokens} tokens, ~{cost}',
    sentence_failed: '{status} à {end} après {dur}, {failed} agent(s) en échec, {tokens} tokens, ~{cost}',
    eta: 'fini vers {time}',
    eta_range: '(entre {lo} et {hi})',
    no_history: 'pas assez d’historique',
    samples: 'n = {n}',
    phases: 'Phases',
    gantt: 'Gantt',
    agents: 'Agents',
    estimates: 'Estimations',
    highlights: 'À regarder',
    limits: 'Parallélisme sur ce PC',
    limits_row: '{agents} agents de workflow en cours · CI {ci} / {ci_max} · npm ci / tsc {npm} / {npm_max}',
    limits_note: 'Compté sur les workflows en cours de tout le PC, d’après la dernière commande de chaque agent (heuristique).',
    stuck: '{label} : aucun événement depuis {min} min',
    failed: '{label} a échoué',
    no_model: '{n} agent(s) sans modèle explicite (hérité) : {labels}',
    over_ci: 'CI : {n} pipelines attendus en même temps, la règle dit ≤ {max}',
    over_npm: 'npm ci / tsc : {n} en même temps, la règle dit ≤ {max}',
    run_failed: 'Le workflow a échoué : {error}',
    run_killed: 'Le workflow a été arrêté avant la fin',
    run_interrupted: 'Plus aucun événement depuis {age} et pas de bilan : interrompu ?',
    nothing: 'rien à signaler',
    elapsed: 'depuis {dur}',
    complexity: 'complexité',
    now: 'maintenant',
    est_tail: 'fin estimée',
    est_row: '{what} : reste {dur} {range}, ~{tokens} tokens, ~{cost} · {n}',
    est_total: 'Total',
    est_phase: 'Phase {title}',
    est_level: { label: 'même étiquette', role: 'même rôle, modèle et phase', phase: 'même modèle et phase', type: 'même modèle et type', family: 'même modèle', workflow: 'mêmes runs de ce workflow', generic: 'toutes les phases passées' },
    overrun: 'dépasse l’habituel',
    model_inherited: 'modèle hérité',
    speed: 'Vitesse',
    speed_scope: 'Vitesse ({scope})',
    speed_sentence: 'Utilisé {avg}/{cap} agents en moyenne (pic {max}), {seq}, {limits}',
    speed_seq_none: 'rien n’aurait pu tourner en parallèle de plus',
    speed_seq: '{n} agent(s) auraient pu tourner en parallèle',
    speed_limits_none: 'aucune limite atteinte',
    speed_limits: 'limites atteintes : {list}',
    speed_rate: '{n} erreur(s) 429 / surcharge',
    speed_ci: 'CI {n} > {max}',
    speed_npm: 'npm ci / tsc {n} > {max}',
    speed_idle: 'lead sans agent en cours pendant {dur} entre deux agents',
    speed_cap: 'plafond workflow {cap} (min({cap_max}, {cpus} CPU − {reserve})) · repère conversation {guide} agents',
    speed_could: 'aurait pu tourner en parallèle',
    speed_could_row: '{label} a démarré {gap} après la fin de {prev}, même phase, sans dépendance visible',
    open: '▾', closed: '▸',
    glossary: 'Phase : une étape du workflow, les phases passent l’une après l’autre · Agent : un Claude qui fait une tâche, en parallèle des autres de sa phase · Worktree : une copie isolée du dépôt pour un agent · Tokens : texte lu et écrit par les modèles · $ : estimation au tarif public',
  },
}

function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a || {}) }
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v
  return out
}

export function workflowConfig(cfg) {
  return merge(WORKFLOW_DEFAULTS, (cfg && cfg.workflow) || {})
}

export function fill(tpl, vars) {
  return String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
}

// ---- scrubbing (the scanner scrubs already; this is the second lock before anything is drawn) --------------------

const SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '<clé privée>'],
  [/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/g, '<jeton>'],
  [/\bglpat-[A-Za-z0-9_-]{12,}/g, '<jeton>'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '<clé>'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '<jeton>'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '<clé>'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '<jeton>'],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 <masqué>'],
  [/\b(password|passwd|pwd|token|secret|api[_-]?key|apikey|authorization|client[_-]?secret)(["']?\s*[:=]\s*)["']?[^\s"',;]+/gi, '$1$2<masqué>'],
  [/(:\/\/[^/\s:@]+:)[^@\s/]+@/g, '$1<masqué>@'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}\b/g, '<e-mail>'],
  [/\b[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, '~'],
  [/\/(?:home|Users)\/[^/\s"']+/g, '~'],
  [/\b[A-Fa-f0-9]{40,}\b/g, '<hex>'],
  [/[A-Za-z0-9+/_-]{48,}={0,2}/g, '<masqué>'],
]

export function scrub(s, n = 100) {
  let t = String(s ?? '')
  for (const [rx, rep] of SECRETS) t = t.replace(rx, rep)
  t = t.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, Math.max(1, n - 1)) + '…'
}

// ---- formatting (French) ---------------------------------------------------------------------------------------------

export function frTokens(n) {
  n = Number(n) || 0
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} M`
  if (n >= 1e3) return `${Math.round(n / 1e3)} K`
  return String(Math.round(n))
}

export function frUsd(x) {
  x = Number(x) || 0
  return x >= 10 ? `${Math.round(x)} $` : `${x.toFixed(2).replace('.', ',')} $`
}

export function frDur(ms) {
  const m = Math.max(0, Math.round((Number(ms) || 0) / 60000))
  if (m < 1) return '< 1 min'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${String(m % 60).padStart(2, '0')}`
}

export function clock(ms) {
  if (!ms) return '--:--'
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---- estimator -------------------------------------------------------------------------------------------------------

// quantiles: lib/core/estimate.mjs (same linear interpolation), re-exported for the tests and the cockpit copy.
export { quantiles }

const roleOf = (label) => (String(label || '').includes(':') ? String(label).split(':')[0].trim().toLowerCase() : '')

// history rows: {run, name, label, phase, model, tokens, duration_ms, type}. Matching levels, most specific first; the
// first level with at least min_samples past agents wins, else null (« pas assez d'historique »).
export function estimator(history, cfg) {
  const w = workflowConfig(cfg)
  const rows = (history || []).filter((h) => Number(h.duration_ms) > 0)
    .map((h) => ({ ...h, usd: Array.isArray(h.vec) ? costOf(h.model || 'default', [...h.vec, 0], cfg) : 0 }))
  const levels = [
    ['label', (a, h) => h.name && a.workflow && h.name === a.workflow && h.label === a.label],
    ['role', (a, h) => roleOf(a.label) && roleOf(h.label) === roleOf(a.label) && family(h.model) === family(a.model) && h.phase === a.phase],
    ['phase', (a, h) => family(h.model) === family(a.model) && h.phase === a.phase],
    ['type', (a, h) => a.type && family(h.model) === family(a.model) && h.type === a.type],
    ['family', (a, h) => family(h.model) === family(a.model)],
  ]
  const agent = (a) => {
    for (const [level, match] of levels) {
      const hits = rows.filter((h) => match(a, h))
      if (hits.length >= w.min_samples) {
        return { level, n: hits.length, dur: quantiles(hits.map((h) => h.duration_ms)), tok: quantiles(hits.map((h) => Number(h.tokens) || 0)), usd: quantiles(hits.map((h) => h.usd)) }
      }
    }
    return null
  }
  // one phase of a past run: its agents (count), wall time (longest agent) and tokens (sum)
  const runs = new Map()
  for (const h of rows) {
    const k = h.run + '\u0000' + h.phase
    const r = runs.get(k) || { name: h.name, phase: h.phase, agents: 0, dur: 0, tok: 0, usd: 0 }
    r.usd += h.usd
    r.agents += 1
    r.dur = Math.max(r.dur, h.duration_ms)
    r.tok += Number(h.tokens) || 0
    runs.set(k, r)
  }
  const phasesPast = [...runs.values()]
  const phase = (name, title) => {
    let hits = phasesPast.filter((p) => p.name === name && p.phase === title)
    let level = 'workflow'
    if (hits.length < w.min_samples) { hits = phasesPast; level = 'generic' }
    if (hits.length < w.min_samples) return null
    return { level, n: hits.length, agents: quantiles(hits.map((p) => p.agents)), dur: quantiles(hits.map((p) => p.dur)), tok: quantiles(hits.map((p) => p.tok)), usd: quantiles(hits.map((p) => p.usd)) }
  }
  const perAgentTok = quantiles(rows.map((h) => Number(h.tokens) || 0))
  return { agent, phase, perAgentTok, size: rows.length }
}

// Remaining work of one running agent from its estimate: {lo, mid, hi} ms, tokens and $, overrun when past p75.
export function remainingOf(est, elapsedMs, tokensNow, costNow = 0) {
  if (!est) return null
  const t = est.tok
  const u = est.usd || { p25: 0, median: 0, p75: 0 }
  const r = remaining({ enough: true, ...est.dur }, elapsedMs) // lib/core/estimate.mjs: {lo, mid, hi}, overrun past p75
  const ms = { lo: r.lo, mid: r.mid, hi: r.hi }
  const tok = { lo: Math.max(0, t.p25 - tokensNow), mid: Math.max(0, t.median - tokensNow), hi: Math.max(0, t.p75 - tokensNow) }
  const usd = { lo: Math.max(0, u.p25 - costNow), mid: Math.max(0, u.median - costNow), hi: Math.max(0, u.p75 - costNow) }
  return { ms, tok, usd, overrun: r.overrun, n: est.n, level: est.level }
}

// ---- one run -----------------------------------------------------------------------------------------------------------

function phaseList(run) {
  const out = []
  const seen = new Set()
  for (const p of run.phases || []) if (p && p.title && !seen.has(p.title)) { seen.add(p.title); out.push({ title: p.title, detail: p.detail || '' }) }
  for (const a of run.agents || []) if (a.phase && !seen.has(a.phase)) { seen.add(a.phase); out.push({ title: a.phase, detail: '' }) }
  if (!out.length) out.push({ title: '', detail: '' })
  return out
}

export function runView(run, est, cfg, nowMs) {
  const w = workflowConfig(cfg)
  const L = w.labels
  const live = run.status === 'running'
  const stuckMs = w.stuck_min * 60000
  const ciRx = new RegExp(w.ci_match, 'i')
  const npmRx = new RegExp(w.npm_match, 'i')
  const allModels = {}
  const agents = (run.agents || []).map((a) => {
    const bill = billByModel([a.models || {}], cfg)
    for (const [m, v] of Object.entries(a.models || {})) {
      const cur = allModels[m] || (allModels[m] = [0, 0, 0, 0, 0, 0])
      for (let i = 0; i < 6; i++) cur[i] += v[i] || 0
    }
    const tokens = Object.values(bill).reduce((x, b) => x + b.tokens, 0) || Number(a.tokens_record) || 0
    const end = a.status === 'running' ? null : a.end || a.last || null
    const start = a.start || null
    const stuck = a.status === 'running' && live && Boolean(a.last || start) && nowMs - (a.last || start) > stuckMs
    const view = {
      id: a.id, label: scrub(a.label, 60), phase: a.phase || '', type: a.type || '', model: a.model || run.default_model || '',
      explicit: Boolean(a.explicit_model), explicitModel: a.explicit_model || '', effort: a.effort || '', status: a.status, stuck,
      start, end, durMs: start ? (end || nowMs) - start : 0, tokens, cost: sumCost(bill),
      lastLine: scrub(a.status === 'running' ? a.last_tool || a.last_text : a.last_text || a.last_tool, 100),
      ci: a.status === 'running' && ciRx.test(a.last_cmd || ''), npm: a.status === 'running' && npmRx.test(a.last_cmd || ''),
      worktree: scrub(a.worktree, 80), branch: scrub(a.branch, 60), pr: a.pr || null, idle: a.last ? nowMs - a.last : null,
      rateLimits: Number(a.rate_limits) || 0, lastCmd: a.last_cmd || '',
      workflow: run.name,
    }
    view.est = view.status === 'running' && est ? remainingOf(est.agent(view), start ? nowMs - start : 0, tokens, view.cost) : null
    return view
  })
  const phases = phaseList(run).map((p, i) => {
    const ag = agents.filter((a) => (a.phase || '') === p.title || (!a.phase && i === 0 && !p.title))
    const running = ag.filter((a) => a.status === 'running').length
    const failed = ag.filter((a) => a.status === 'failed').length
    const status = running ? 'running' : !ag.length ? (live ? 'waiting' : 'waiting') : failed && !ag.some((a) => a.status === 'done') ? 'failed' : 'done'
    return { index: i + 1, title: p.title, detail: p.detail, status, agents: ag, running, failed }
  })
  // a phase with no agent yet, after the last started one, waits; one before it was skipped by the script (done)
  const lastStarted = Math.max(-1, ...phases.map((p, i) => (p.agents.length ? i : -1)))
  for (const [i, p] of phases.entries()) if (!p.agents.length && i < lastStarted) p.status = 'done'
  if (!live) for (const p of phases) if (p.status === 'waiting') p.status = run.status === 'completed' ? 'done' : 'waiting'
  const current = phases.find((p) => p.status === 'running') || phases.find((p) => p.status === 'waiting') || phases[phases.length - 1]
  const tokens = agents.reduce((x, a) => x + a.tokens, 0) || Number(run.tokens_record) || 0
  const cost = sumCost(billByModel([allModels], cfg))
  const start = run.start || Math.min(...agents.map((a) => a.start).filter(Boolean)) || null
  const end = live ? null : run.end || Math.max(0, ...agents.map((a) => a.end || 0)) || run.last_activity || null
  // estimates: running agents (parallel inside a phase) + phases still waiting (one after the other)
  let estimate = null
  if (live && est) {
    const runningAgents = agents.filter((a) => a.status === 'running')
    const known = runningAgents.filter((a) => a.est)
    const max = (k) => Math.max(0, ...known.map((a) => a.est.ms[k]))
    const sumTok = (k) => known.reduce((x, a) => x + a.est.tok[k], 0)
    const sumUsd = (k) => known.reduce((x, a) => x + a.est.usd[k], 0)
    const ns = known.map((a) => a.est.n)
    const phaseEst = []
    let ms = { lo: max('lo'), mid: max('mid'), hi: max('hi') }
    let tok = { lo: sumTok('lo'), mid: sumTok('mid'), hi: sumTok('hi') }
    let usd = { lo: sumUsd('lo'), mid: sumUsd('mid'), hi: sumUsd('hi') }
    for (const p of phases) {
      if (p.status === 'running') {
        const ka = p.agents.filter((a) => a.est)
        phaseEst.push({ title: p.title, index: p.index, ms: { lo: Math.max(0, ...ka.map((a) => a.est.ms.lo)), mid: Math.max(0, ...ka.map((a) => a.est.ms.mid)), hi: Math.max(0, ...ka.map((a) => a.est.ms.hi)) },
          tok: { lo: ka.reduce((x, a) => x + a.est.tok.lo, 0), mid: ka.reduce((x, a) => x + a.est.tok.mid, 0), hi: ka.reduce((x, a) => x + a.est.tok.hi, 0) },
          usd: { lo: ka.reduce((x, a) => x + a.est.usd.lo, 0), mid: ka.reduce((x, a) => x + a.est.usd.mid, 0), hi: ka.reduce((x, a) => x + a.est.usd.hi, 0) },
          n: ka.length ? Math.min(...ka.map((a) => a.est.n)) : 0, enough: ka.length === p.running, level: ka.length ? ka[0].est.level : '' })
      }
      if (p.status !== 'waiting') continue
      const pe = est.phase(run.name, p.title)
      if (!pe) { phaseEst.push({ title: p.title, index: p.index, enough: false, n: 0 }); ns.push(0); continue }
      ns.push(pe.n)
      phaseEst.push({ title: p.title, index: p.index, ms: { lo: pe.dur.p25, mid: pe.dur.median, hi: pe.dur.p75 }, tok: { lo: pe.tok.p25, mid: pe.tok.median, hi: pe.tok.p75 }, usd: { lo: pe.usd.p25, mid: pe.usd.median, hi: pe.usd.p75 }, n: pe.n, enough: true, level: pe.level, agents: Math.round(pe.agents.median) })
      ms = { lo: ms.lo + pe.dur.p25, mid: ms.mid + pe.dur.median, hi: ms.hi + pe.dur.p75 }
      tok = { lo: tok.lo + pe.tok.p25, mid: tok.mid + pe.tok.median, hi: tok.hi + pe.tok.p75 }
      usd = { lo: usd.lo + pe.usd.p25, mid: usd.mid + pe.usd.median, hi: usd.hi + pe.usd.p75 }
    }
    const enough = known.length === runningAgents.length && phaseEst.every((p) => p.enough) && (runningAgents.length > 0 || phaseEst.length > 0)
    estimate = {
      enough, n: ns.length ? Math.min(...ns) : 0, ms, tok, phases: phaseEst,
      eta: { lo: nowMs + ms.lo, mid: nowMs + ms.mid, hi: nowMs + ms.hi },
      finalTokens: { lo: tokens + tok.lo, mid: tokens + tok.mid, hi: tokens + tok.hi },
      finalCost: { lo: cost + usd.lo, mid: cost + usd.mid, hi: cost + usd.hi },
      remainingCost: usd,
      overrun: known.filter((a) => a.est.overrun).map((a) => a.label),
    }
  }
  // complexity: agents × phases × typical tokens per past agent (millions)
  const perAgent = est && est.perAgentTok.n ? est.perAgentTok.median : tokens / Math.max(1, agents.length)
  const nAgents = Math.max(agents.length, Number(run.agent_count) || 0) + (estimate ? estimate.phases.reduce((x, p) => x + (p.agents || 0), 0) : 0)
  const score = nAgents * phases.length * (perAgent / 1e6)
  const C = w.complexity
  const badge = score >= C.xl ? 'XL' : score >= C.l ? 'L' : score >= C.m ? 'M' : 'S'
  // highlights: red only for real problems
  const hl = []
  if (run.status === 'failed') hl.push({ level: 'bad', text: fill(L.run_failed, { error: scrub(run.error || '?', 120) }) })
  if (run.status === 'killed') hl.push({ level: 'warn', text: L.run_killed })
  if (run.status === 'interrupted') hl.push({ level: 'warn', text: fill(L.run_interrupted, { age: frDur(nowMs - (run.last_activity || nowMs)) }) })
  for (const a of agents.filter((x) => x.status === 'failed')) hl.push({ level: 'bad', text: fill(L.failed, { label: a.label }) })
  for (const a of agents.filter((x) => x.stuck)) hl.push({ level: 'bad', text: fill(L.stuck, { label: a.label, min: Math.round((nowMs - (a.idle !== null ? nowMs - a.idle : a.start)) / 60000) }) })
  const noModel = agents.filter((a) => !a.explicit && a.status !== 'skipped')
  if (noModel.length) hl.push({ level: 'warn', text: fill(L.no_model, { n: noModel.length, labels: noModel.slice(0, 4).map((a) => a.label).join(', ') + (noModel.length > 4 ? '…' : '') }) })
  // the sentence on top
  const running = agents.filter((a) => a.status === 'running').length
  let sentence
  if (live) {
    const eta = !estimate || !estimate.enough ? `fin : ${L.no_history}`
      : estimate.overrun.length && estimate.ms.mid < 60000 ? `${L.overrun} (${estimate.overrun.length} agent(s))` : fill(L.eta, { time: clock(estimate.eta.mid) })
    sentence = fill(L.sentence_running, {
      phase: current ? current.index : '?', phases: phases.length, title: current && current.title ? current.title : '-', running, eta,
      tokens: frTokens(estimate && estimate.enough ? estimate.finalTokens.mid : tokens), cost: frUsd(estimate && estimate.enough ? estimate.finalCost.mid : cost),
    })
  } else if (run.status === 'completed') {
    sentence = fill(L.sentence_done, { end: clock(end), dur: frDur((end || 0) - (start || end || 0)), agents: agents.length, tokens: frTokens(tokens), cost: frUsd(cost) })
  } else {
    sentence = fill(L.sentence_failed, { status: (L.status || {})[run.status] || run.status, end: clock(end), dur: frDur((end || 0) - (start || end || 0)),
      failed: agents.filter((a) => a.status === 'failed').length, tokens: frTokens(tokens), cost: frUsd(cost) })
  }
  return {
    id: run.run_id, cli: run.cli, project: run.project, name: scrub(run.name, 60), description: scrub(run.description, 200), status: run.status, live,
    start, end, elapsed: start ? (end || nowMs) - start : 0, tokens, cost, agents, phases, current, estimate, badge, score, highlights: hl, sentence,
    running, models: [...new Set(agents.map((a) => short(a.model)).filter((m) => m && m !== '?'))],
  }
}

// ---- Vitesse: parallel width over time, average vs cap, lead idle gaps, sequential agents that could overlap -------

const SPARK = '▁▂▃▄▅▆▇█'

export function capOf(cfg, cpus) {
  const S = workflowConfig(cfg).speed
  const n = Number(cpus) || 0
  return n ? Math.max(1, Math.min(S.cap_max, n - S.cpu_reserve)) : S.cap_max
}

// views: one run (per workflow) or several (per conversation / all). Pure arithmetic on agent start / end.
export function speed(views, cfg, cpus, nowMs, limits) {
  const w = workflowConfig(cfg)
  const S = w.speed
  const L = w.labels
  const cap = capOf(cfg, cpus)
  const spans = []
  for (const v of views) for (const a of v.agents) if (a.start) spans.push({ s: a.start, e: Math.max(a.start, a.end || (a.status === 'running' ? nowMs : a.start)), a, run: v.id })
  const rate = views.reduce((x, v) => x + v.agents.reduce((y, a) => y + (a.rateLimits || 0), 0), 0)
  const limitList = []
  if (rate) limitList.push(fill(L.speed_rate, { n: rate }))
  if (limits && limits.ci > limits.ciMax) limitList.push(fill(L.speed_ci, { n: limits.ci, max: limits.ciMax }))
  if (limits && limits.npm > limits.npmMax) limitList.push(fill(L.speed_npm, { n: limits.npm, max: limits.npmMax }))
  const limitsText = limitList.length ? fill(L.speed_limits, { list: limitList.join(', ') }) : L.speed_limits_none
  if (!spans.length) return { empty: true, cap, avg: 0, max: 0, spark: '', idleMs: 0, could: [], rate, limitsText, limitsHit: limitList.length > 0,
    sentence: fill(L.speed_sentence, { avg: 0, cap, max: 0, seq: L.speed_seq_none, limits: limitsText }) }
  // per run: busy time, idle gaps (no agent running between the first start and the last end), peak
  let busy = 0
  let wall = 0
  let idleMs = 0
  let max = 0
  const byRun = new Map()
  for (const sp of spans) { const l = byRun.get(sp.run) || []; l.push(sp); byRun.set(sp.run, l) }
  for (const list of byRun.values()) {
    const t0 = Math.min(...list.map((x) => x.s))
    const t1 = Math.max(...list.map((x) => x.e))
    wall += t1 - t0
    busy += list.reduce((x, sp) => x + (sp.e - sp.s), 0)
    const pts = list.flatMap((sp) => [[sp.s, 1], [sp.e, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    let cur = 0
    let last = t0
    for (const [t, d] of pts) {
      if (cur === 0 && t > last) idleMs += t - last
      cur += d
      max = Math.max(max, cur)
      last = t
    }
  }
  const avg = wall > 0 ? busy / wall : 0
  // the mini chart: agents running at once, sampled on `buckets` points across the whole span
  const T0 = Math.min(...spans.map((x) => x.s))
  const T1 = Math.max(...spans.map((x) => x.e), T0 + 1)
  const B = Math.max(4, S.buckets)
  const series = []
  for (let i = 0; i < B; i++) {
    const t = T0 + ((i + 0.5) / B) * (T1 - T0)
    series.push(spans.filter((sp) => sp.s <= t && sp.e > t).length)
  }
  const top = Math.max(1, ...series)
  const spark = series.map((n) => (n ? SPARK[Math.min(7, Math.round((n / top) * 7))] : ' ')).join('')
  // agents that started right after another of the same phase ended, without overlap: could have run in parallel
  const could = []
  const gapMs = S.seq_gap_s * 1000
  for (const list of byRun.values()) {
    const byPhase = new Map()
    for (const sp of list) { const l = byPhase.get(sp.a.phase) || []; l.push(sp); byPhase.set(sp.a.phase, l) }
    for (const ph of byPhase.values()) {
      ph.sort((x, y) => x.s - y.s)
      for (let i = 1; i < ph.length; i++) {
        const prev = ph.slice(0, i).reduce((p, x) => (x.e > p.e ? x : p))
        const overlap = ph.slice(0, i).some((x) => x.e > ph[i].s)
        if (!overlap && ph[i].s - prev.e <= gapMs && prev.a.status !== 'failed') {
          could.push({ label: ph[i].a.label, prev: prev.a.label, gap: ph[i].s - prev.e, text: fill(L.speed_could_row, { label: ph[i].a.label, prev: prev.a.label, gap: frDur(ph[i].s - prev.e) }) })
        }
      }
    }
  }
  const avgTxt = avg >= 10 ? String(Math.round(avg)) : avg.toFixed(1).replace('.', ',').replace(/,0$/, '')
  return {
    empty: false, cap, cpus: Number(cpus) || 0, guideline: S.session_guideline, avg, max, series, spark, idleMs, could, rate, limitsText, limitsHit: limitList.length > 0,
    capText: fill(L.speed_cap, { cap, cap_max: S.cap_max, cpus: Number(cpus) || '?', reserve: S.cpu_reserve, guide: S.session_guideline }),
    idleText: idleMs >= 60000 ? fill(L.speed_idle, { dur: frDur(idleMs) }) : '',
    sentence: fill(L.speed_sentence, { avg: avgTxt, cap, max, seq: could.length ? fill(L.speed_seq, { n: could.length }) : L.speed_seq_none, limits: limitsText }),
  }
}

// ---- PC-wide parallelism vs the rules' limits -------------------------------------------------------------------------

export function limitsView(views, cfg) {
  const w = workflowConfig(cfg)
  const L = w.labels
  const running = views.filter((v) => v.live).flatMap((v) => v.agents.filter((a) => a.status === 'running'))
  const ci = running.filter((a) => a.ci).length
  const npm = running.filter((a) => a.npm).length
  const hl = []
  if (ci > w.limits.ci) hl.push({ level: 'bad', text: fill(L.over_ci, { n: ci, max: w.limits.ci }) })
  if (npm > w.limits.npm) hl.push({ level: 'bad', text: fill(L.over_npm, { n: npm, max: w.limits.npm }) })
  return {
    agents: running.length, ci, npm, ciMax: w.limits.ci, npmMax: w.limits.npm, highlights: hl,
    text: fill(L.limits_row, { agents: running.length, ci, ci_max: w.limits.ci, npm, npm_max: w.limits.npm }),
    level: hl.length ? 'bad' : ci === w.limits.ci || npm === w.limits.npm ? 'warn' : 'ok',
  }
}

// The whole screen. scope 'conversation' shows runs of this conversation (the scanner's --session), 'all' every one.
export function workflowScreen(scan, cfg, nowMs) {
  const w = workflowConfig(cfg)
  const est = estimator((scan && scan.history) || [], cfg)
  const runs = ((scan && scan.runs) || []).slice(0, w.max_runs).map((r) => runView(r, est, cfg, nowMs))
  const others = ((scan && scan.live) || []).map((r) => runView(r, est, cfg, nowMs))
  const limits = limitsView([...runs, ...others], cfg)
  const cpus = (scan && scan.cpus) || 0
  for (const v of runs) v.speed = speed([v], cfg, cpus, nowMs, v.live ? limits : null)
  return { runs, limits, historySize: est.size, speed: speed(runs, cfg, cpus, nowMs, limits), cpus }
}

// ---- Gantt -----------------------------------------------------------------------------------------------------------

// Horizontal when `width` columns leave at least gantt.min_bar for the bars, else vertical (time goes down).
// Horizontal: rows grouped by phase, each {label, cells: [{text, kind}]}; kind = done|running|failed|skipped|tail|now|empty.
export function gantt(view, nowMs, width, cfg) {
  const w = workflowConfig(cfg)
  const G = w.gantt
  const items = view.agents.filter((a) => a.start)
  if (!items.length) return { mode: 'empty', rows: [] }
  const t0 = Math.min(...items.map((a) => a.start))
  const tailEnd = (a) => (a.status === 'running' && a.est ? nowMs + a.est.ms.mid : null)
  const t1 = Math.max(view.live ? nowMs : 0, ...items.map((a) => a.end || (a.status === 'running' ? nowMs : a.start)), ...items.map((a) => tailEnd(a) || 0), t0 + 60000)
  const labelW = Math.min(G.label_w, Math.max(6, Math.floor(width / 4)))
  const barW = width - labelW - 1
  if (barW < G.min_bar) {
    // vertical: one line per start / end / estimated end, in time order, with the now line in between
    const ev = []
    for (const a of items) {
      ev.push({ ts: a.start, text: `▶ ${a.label}`, kind: 'running', phase: a.phase })
      if (a.end && a.status !== 'running') ev.push({ ts: a.end, text: `${a.status === 'failed' ? '✗' : '■'} ${a.label} (${frDur(a.end - a.start)})`, kind: a.status, phase: a.phase })
      const te = tailEnd(a)
      if (te) ev.push({ ts: te, text: `┄ ${a.label} ${w.labels.est_tail}`, kind: 'tail', phase: a.phase })
    }
    if (view.live) ev.push({ ts: nowMs, text: `── ${w.labels.now} ──`, kind: 'now' })
    ev.sort((a, b) => a.ts - b.ts || (a.kind === 'now' ? 1 : -1))
    return { mode: 'vertical', rows: ev.map((e) => ({ ...e, time: clock(e.ts) })) }
  }
  // horizontal: ONE renderer with the ci mod's Diagramme (lib/core/gantt.mjs), one span for every phase
  const flat = []
  for (const p of view.phases) for (const a of p.agents) if (a.start) flat.push({ p, a })
  const g = coreGantt(flat.map(({ a }) => ({
    label: a.label, status: coreStatus(a.status), startMs: a.start, endMs: a.status === 'running' ? null : a.end || a.start,
    estEndMs: tailEnd(a),
  })), nowMs, barW)
  const groups = []
  flat.forEach(({ p, a }, i) => {
    let grp = groups.find((x) => x.index === p.index)
    if (!grp) groups.push((grp = { title: p.title, index: p.index, rows: [] }))
    const r = g.rows[i]
    grp.rows.push({ label: a.label, status: a.status, cells: r.segs.map((sg) => ({ kind: KIND[sg.kind] || sg.kind, text: sg.text })) })
  })
  return { mode: 'horizontal', labelW, barW, nowCol: g.nowCol, from: clock(g.t0), to: clock(g.t1), t0: g.t0, t1: g.t1, groups }
}

// agent status -> lib/core/gantt status; core segment kind -> this screen's kind (colours of workflow_draw.mjs)
const coreStatus = (s) => (s === 'running' ? 'running' : s === 'failed' || s === 'killed' || s === 'interrupted' ? 'failed' : 'success')
const KIND = { est: 'tail', queue: 'skipped' }

/** The legend under the bars: lib/core/gantt.mjs legend, the same words as ci's Diagramme. */
export const ganttLegend = (labels) => coreLegend(labels)

export function axis(g) {
  if (g.mode !== 'horizontal') return ''
  return coreAxis({ t0: g.t0, t1: g.t1, width: g.barW }, g.labelW + 1, clock)
}

// ---- command arguments -----------------------------------------------------------------------------------------------

const WORDS = new Set(['workflow', 'workflows', 'wf'])

// "/factory workflow" -> {workflow: true, scope: null}; "/factory workflow all" -> scope 'all'; else {workflow: false}.
export function parseWorkflowArgs(args) {
  const words = String(args || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length || !WORDS.has(words[0])) return { workflow: false, scope: null }
  const s = words[1]
  return { workflow: true, scope: s === 'all' || s === 'tout' || s === 'toutes' ? 'all' : s === 'conv' || s === 'conversation' ? 'conversation' : null }
}

export function workflowArgs(cfg, opts) {
  const w = workflowConfig(cfg)
  const a = [opts.script, '--cache', opts.cache, '--hours', String(w.hours), '--stale-h', String(w.stale_h), '--history-days', String(w.history_days)]
  if (opts.scope === 'all') a.push('--all')
  else if (opts.session) a.push('--session', opts.session)
  return ['-I', ...a]
}

export { tokensOf }
