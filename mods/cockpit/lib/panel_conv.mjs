// cockpit Panneau, section 2 « Cette conversation », in the style of Claude's own panes (Julian, 17 Oct 18:10):
//   a Usage-like card for the lead: title, model · effort · state, the context bar with the hand-off mark (250 k),
//     a stats grid (cost, tokens, cache hit, % sub-agents, agents, tok/s), the model share and « Ce qui contribue »;
//   then one Background-tasks-like card per Workflow, folded by default as Claude's mini card (« name › », grey
//     « Workflow  N agents  6h 56m », one dot per agent: grey ■ done, amber ■ running, □ pending), unfolded to its
//     Phases, each phase unfolding to Claude's « Modèle | Temps » table (« ✓ Opus 5.5 … 1h 07m 29s ») with our extras
//     on a grey line under each row (label, effort, tokens, tok/s, state); one card for the background agents;
//     finished cards folded into « Terminés N › »;
//   then the session log: the last log_max events (agent started / finished, PR opened / merged), timestamped.
// Pure: no $, no I/O (node --test mods/cockpit/tests/panel.test.mjs). Input: factory's scan (lib/factory/scanner),
// optionally factory's Workflow screen runs (phases, ETA, cost), nav's usageCard and the context (lib/panel.mjs).
import { panelConfig, fill, kTok } from './panel.mjs'
import { titleOf, short, tokensOf, hhmm, billByModel, sumCost, family } from './factory/hooks/logic.mjs'
import { sessionState } from './factory/hooks/screens.mjs'

const msOf = (v) => (!v ? 0 : typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(v) || 0)
const clip = (t, n) => {
  const a = [...String(t ?? '').replace(/\s+/g, ' ').trim()]
  return a.length > n ? a.slice(0, Math.max(1, n - 1)).join('') + '…' : a.join('')
}
/** « opus 5.5 » -> « Opus 5.5 », as Claude's panes write a model. */
export const modelName = (m) => { const s = short(m || '?'); return s.charAt(0).toUpperCase() + s.slice(1) }

function findSession(scan, cli) {
  return ((scan && scan.sessions) || []).find((s) => s.cli === cli || s.id === cli) || null
}

// The detail of this conversation when the scan has it (subs with their events, calls, events), else its slim row.
function detailOf(scan, cli) {
  const d = scan && scan.detail
  return d && d.cli === cli ? d : findSession(scan, cli)
}

const LEAD_STATES = { working: 'en cours', julian: 't’attend', blocked: 'bloquée', done: 'terminée', idle: 'au repos', archived: 'archivée' }
const GENERIC = /^(general-purpose|agent)$/i

/** An agent's label: its own label or task, never « general-purpose » when something better is known. */
function labelOf(x) {
  const own = String(x.label || x.desc || '').trim()
  const type = String(x.type || '').trim()
  if (own && type && !GENERIC.test(type) && !own.toLowerCase().startsWith(type.toLowerCase())) return `${type} · ${own}`
  return own || type || 'agent'
}

const statusOf = (s) => (['running', 'done', 'failed'].includes(s) ? s : s === 'completed' ? 'done' : 'stopped')

function agentRow(x, nowMs, L, fcfg) {
  const fromRun = x.durMs !== undefined
  const tokens = fromRun ? x.tokens || 0 : Object.values(x.models || {}).reduce((a, v) => a + tokensOf(v || []), 0)
  const status = statusOf(x.status)
  const from = fromRun ? x.start || 0 : msOf(x.ts)
  const to = status === 'running' ? nowMs : (fromRun ? x.end : msOf(x.last_ts)) || nowMs
  const ms = fromRun ? x.durMs : from ? Math.max(0, to - from) : 0
  const secs = ms / 1000
  return {
    id: x.id, label: labelOf(x), model: modelName(x.model || x.explicit_model), effort: x.effort || '', status,
    stateLabel: L.agent_states[status] || status, tokens, tps: secs >= 1 ? tokens / secs : null, ms,
    cost: fromRun ? x.cost || 0 : sumCost(billByModel([x.models || {}], fcfg || {})), phase: x.phase || '', ts: from,
  }
}

const order = (a, b) => ((b.status === 'running') - (a.status === 'running')) || (b.ts - a.ts)

/** The phases of a card: from factory's Workflow screen when it has this run, else one phase holding every agent. */
function phasesOf(key, run, agents, L, closed, max) {
  const one = (title, list, i, status) => {
    const pk = `${key}-ph${i}`
    const running = list.filter((a) => a.status === 'running').length
    const done = list.filter((a) => a.status === 'done').length
    const def = status ? status === 'running' : running > 0
    const sorted = list.slice().sort(order)
    return {
      key: pk, title, count: list.length, done, running, open: closed[pk] === undefined ? def : !closed[pk],
      dots: sorted.slice().sort((a, b) => rank(a.status) - rank(b.status)).map((a) => a.status),
      agents: sorted.slice(0, max), hidden: Math.max(0, sorted.length - max),
    }
  }
  if (run && Array.isArray(run.phases) && run.phases.length) {
    return run.phases.map((p, i) => one(p.title || L.phase_default, agents.filter((a) => (p.agents || []).some((x) => x.id === a.id)), i, p.status))
  }
  return [one(L.phase_default, agents, 0, null)]
}
/** One dot per agent, as Claude's Background-tasks mini card draws them: done, failed, running, then pending. */
const dotsOf = (agents) => agents.map((a) => a.status).sort((a, b) => rank(a) - rank(b))
/** A Workflow card starts folded (Claude's mini card) unless style.workflow_open; the viewer's choice wins. */
const cardOpen = (key, closed, c) => (closed[key] === undefined ? Boolean(c.style.workflow_open) : !closed[key])
const rank = (s) => (s === 'done' ? 0 : s === 'failed' ? 1 : s === 'running' ? 2 : 3)

/**
 * The model of « Cette conversation ». scan: factory's scan (detail = this conversation when possible); self: its
 * cli; fcfg: factory's config; closed: { key: bool } folded/unfolded by the viewer; extra: { runs: factory's
 * workflowScreen(...).runs, card: nav.usageCard(...), contexte: contexteOf(...), tps: this conversation's tok/s }.
 * -> { available, lead, ctx, stats, share, contributors, cards, finished, log }.
 */
export function convFactory(scan, self, fcfg, cfg, nowMs, closed = {}, extra = {}) {
  const c = panelConfig(cfg)
  const L = c.labels
  const me = findSession(scan, self)
  if (!me) return { available: false, lead: null, cards: [], log: [] }
  const d = detailOf(scan, self) || me
  const st = sessionState(me, fcfg || {}).state
  const lead = {
    title: titleOf(me), model: modelName(me.app_model || me.model), effort: me.app_effort || me.effort || '?',
    state: LEAD_STATES[st] || st, live: st === 'working',
  }
  const subs = d.subs || me.subs || []
  // stats: tokens and cost of the lead with its sub-agents, cache hit, the sub-agents' share of the cost
  const maps = [me.models || {}, ...subs.map((x) => x.models || {})]
  const tokens = maps.reduce((a, mp) => a + Object.values(mp).reduce((b, v) => b + tokensOf(v || []), 0), 0)
  const bill = billByModel(maps, fcfg || {})
  const total = sumCost(bill)
  const mainCost = sumCost(billByModel([me.models || {}], fcfg || {}))
  const card = extra.card || null
  let read = 0
  let all = 0
  for (const mp of maps) for (const v of Object.values(mp)) { read += v[2] || 0; all += (v[0] || 0) + (v[2] || 0) + (v[3] || 0) + (v[4] || 0) }
  const fam = {}
  for (const [m, b] of Object.entries(bill)) fam[family(m)] = (fam[family(m)] || 0) + b.cost
  const share = card && card.session && card.session.share && card.session.share.length ? card.session.share
    : ['opus', 'sonnet', 'haiku', 'fable'].filter((f) => fam[f]).map((f) => ({ family: f, pct: total ? Math.round((100 * fam[f]) / total) : 0 }))
  const cost = card && card.session && Number.isFinite(card.session.cost) ? card.session.cost : total || null
  const stats = {
    cost, tokens, cacheHit: card && card.session && card.session.cacheHit !== undefined && card.session.cacheHit !== null ? card.session.cacheHit : all ? Math.round((100 * read) / all) : null,
    subPct: total ? Math.round((100 * (total - mainCost)) / total) : null,
    agents: subs.length, running: subs.filter((x) => x.status === 'running').length,
    tps: Number.isFinite(extra.tps) ? extra.tps : null,
  }
  const contributors = ((card && card.session && card.session.contributors) || []).slice(0, Math.max(1, Number(c.conv.contributors) || 3))

  // cards: one per Workflow (its run from factory's Workflow screen when known), one for the background agents
  const max = Math.max(1, Number(c.conv.agents_max) || 12)
  const names = new Map(((d.calls || []).filter((x) => x.tool === 'Workflow' && x.runId)).map((x) => [x.runId, x.desc || x.runId]))
  const runs = new Map(((extra.runs || [])).map((r) => [r.id, r]))
  const cards = []
  const wfIds = [...new Set(subs.filter((x) => x.workflow).map((x) => x.workflow))]
  for (const r of extra.runs || []) if (r.cli === self && r.id && !wfIds.includes(r.id)) wfIds.push(r.id)
  for (const id of wfIds) {
    const run = runs.get(id) || null
    const src = run && run.agents && run.agents.length ? run.agents : subs.filter((x) => x.workflow === id)
    const agents = src.map((x) => agentRow(x, nowMs, L, fcfg))
    const key = 'pfw-' + id
    const starts = agents.map((a) => a.ts).filter(Boolean)
    const running = agents.filter((a) => a.status === 'running').length
    const live = run ? Boolean(run.live) : running > 0
    const ends = agents.map((a) => a.ts + a.ms).filter(Boolean)
    const elapsed = run && run.elapsed ? run.elapsed : starts.length ? (live ? nowMs : Math.max(...ends)) - Math.min(...starts) : 0
    const est = run && run.estimate && run.estimate.enough && live ? run.estimate : null
    cards.push({
      key, kind: 'workflow', title: fill(L.workflow, { name: (run && run.name) || names.get(id) || id }), live, elapsed,
      count: agents.length, running, tokens: agents.reduce((a, x) => a + x.tokens, 0),
      cost: run && Number.isFinite(run.cost) ? run.cost : agents.reduce((a, x) => a + x.cost, 0),
      eta: est ? hhmm(est.eta.mid).slice(0, 5) : '', failed: run ? run.status === 'failed' : agents.some((a) => a.status === 'failed'),
      phases: phasesOf(key, run, agents, L, closed, max), dots: dotsOf(agents), open: cardOpen(key, closed, c),
    })
  }
  const plain = subs.filter((x) => !x.workflow).map((x) => agentRow(x, nowMs, L, fcfg))
  if (plain.length) {
    const running = plain.filter((a) => a.status === 'running').length
    const starts = plain.map((a) => a.ts).filter(Boolean)
    cards.push({
      key: 'pfw-bg', kind: 'background', title: L.background, live: running > 0,
      elapsed: starts.length ? (running ? nowMs : Math.max(...plain.map((a) => a.ts + a.ms))) - Math.min(...starts) : 0,
      count: plain.length, running, tokens: plain.reduce((a, x) => a + x.tokens, 0), cost: plain.reduce((a, x) => a + x.cost, 0), eta: '',
      failed: plain.some((a) => a.status === 'failed'), phases: phasesOf('pfw-bg', null, plain, L, closed, max),
      dots: dotsOf(plain), open: cardOpen('pfw-bg', closed, c),
    })
  }
  const liveCards = cards.filter((x) => x.live)
  const doneCards = cards.filter((x) => !x.live)
  const fk = 'pfw-finished'
  const finished = doneCards.length ? { key: fk, count: doneCards.length, open: closed[fk] === undefined ? Boolean(c.style.finished_open) : !closed[fk], cards: doneCards } : null

  // the session log: agents started / finished (their own times), PR opened (the scan's « pr » event), PR merged
  // (a gh pr merge / glab mr merge the conversation ran)
  const log = []
  for (const x of subs) {
    const name = clip(labelOf(x), 40)
    if (msOf(x.ts)) log.push({ at: msOf(x.ts), text: fill(L.ev_start, { agent: name }), tone: 'running' })
    if ((x.status === 'done' || x.status === 'failed') && msOf(x.last_ts)) log.push({ at: msOf(x.last_ts), text: fill(x.status === 'done' ? L.ev_done : L.ev_failed, { agent: name }), tone: x.status === 'done' ? 'ok' : 'bad' })
  }
  const evs = (d.events && d.events.length ? d.events : me.recent) || []
  for (const e of evs) {
    if (!Array.isArray(e)) continue
    const at = msOf(e[0])
    const text = String(e[2] || '')
    if (e[1] === 'pr') { const n = /#(\d+)/.exec(text); if (n) log.push({ at, text: fill(L.ev_pr_open, { n: n[1] }), tone: null }) }
    else if (e[1] === 'tool') { const n = /\b(?:gh\s+pr\s+merge|glab\s+mr\s+merge)\s+#?(\d+)/.exec(text); if (n) log.push({ at, text: fill(L.ev_pr_merged, { n: n[1] }), tone: 'ok' }) }
  }
  log.sort((a, b) => a.at - b.at)
  return {
    available: true, lead, ctx: extra.contexte || null, stats, share, contributors,
    cards: liveCards, finished, log: log.slice(-Math.max(1, Number(c.conv.log_max) || 6)),
  }
}

/** The one-line summary of a folded « Cette conversation ». */
export function convFactorySummary(m) {
  if (!m || !m.available) return ''
  const all = [...m.cards, ...((m.finished && m.finished.cards) || [])]
  const agents = all.reduce((a, l) => a + l.count, 0)
  const running = all.reduce((a, l) => a + l.running, 0)
  return [`${m.lead.model} · ${m.lead.effort}`, m.ctx && m.ctx.known ? `ctx ${Math.round(m.ctx.pct)} %` : '', m.lead.state, agents ? `agents ${running}/${agents}` : ''].filter(Boolean).join(' · ')
}

export { kTok }
