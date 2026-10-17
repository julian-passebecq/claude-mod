// cockpit Panneau, section 5 « Graphe des conversations » (Julian, 17 Oct: « the sidebar does not tell me who is
// active, who consumes, who is coordinator, who is blocked or idle, what I must click »).
//   À toi de cliquer   the conversations waiting for Julian (interruptedAwaitingPerson, or the open question factory's
//                      scan already detects), oldest first, with a short reason
//   legend             one line
//   groups             by project like the app's sidebar (folder name of originCwd, else cwd; worktrees folded into
//                      their repo), starred first; children (spawnedFrom) under their parent with ├ └, peer messages as
//                      a dashed « ┄⇢ <short title> » note; each conversation: state dot + word, role, tokens today, context %
// Pure: no $, no I/O. Input: rows = lib/core/sessions.mjs graphRow (scanner part « graphe »), scan = factory's scan
// (live, ask, ctx), conso = usage's classement.json (tokens today, as section 4). Labels and limits: panel.graphe and
// panel.labels.graphe_* in cockpit.config.json (lib/panel.mjs PANEL_DEFAULTS).
import { panelConfig, fill, kTok } from './panel.mjs'
import { rank } from './usage/lib/classement.mjs'
import { tokensOf } from './usage/lib/transcripts.mjs'
import { sessionState } from './factory/hooks/screens.mjs'

const MIN = 60000
const HOUR = 3600000

export const GRAPHE_PERIODS = ['24h', '7j', 'tout']

/** The viewer's filters, defaults filled: { project: '' | name, active: bool, period: 24h|7j|tout, archived: bool }. */
export function grapheFilter(f, cfg) {
  const g = panelConfig(cfg).graphe
  const x = { project: '', active: false, period: g.period, archived: false, ...(f && typeof f === 'object' ? f : {}) }
  if (!GRAPHE_PERIODS.includes(x.period)) x.period = '24h'
  return x
}

const clip = (t, n) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s
}

/** « 12 min », « 3 h », « 2 j » */
export function ageText(ms) {
  if (!(ms > 0) || ms < HOUR) return `${Math.max(1, Math.round((ms || 0) / MIN))} min`
  if (ms < 48 * HOUR) return `${Math.floor(ms / HOUR)} h`
  return `${Math.floor(ms / (24 * HOUR))} j`
}

function coordRx(g) {
  try { return new RegExp(g.coord_match) } catch { return null }
}

/**
 * input: { rows, scan, conso, fcfg, filter, link } (link: 'claude://claude.ai/epitaxy/{id}', from depuis.session_link).
 * self: this conversation's CLI id. Returns { ready, waiting, legend, groups, projects, filter, hidden, summary, empty }.
 */
export function grapheModel(input, self, cfg, nowMs) {
  const rows = (input && Array.isArray(input.rows)) ? input.rows : null
  if (!rows) return { ready: false }
  const c = panelConfig(cfg)
  const g = c.graphe
  const L = c.labels
  const f = grapheFilter(input.filter, cfg)
  const fcfg = input.fcfg || {}
  const scanBy = new Map(((input.scan && input.scan.sessions) || []).filter((s) => s.cli).map((s) => [s.cli, s]))
  const bySid = new Map(rows.filter((r) => r.sid).map((r) => [r.sid, r]))
  const byCli = new Map(rows.map((r) => [r.cli, r]))
  const find = (id) => bySid.get(id) || byCli.get(id)
  // spawned ≥ 1 session (anywhere, before any filter) = coordinator
  const spawned = new Map()
  for (const r of rows) if (r.parent) spawned.set(r.parent, (spawned.get(r.parent) || 0) + 1)
  // tokens today: usage's classement.json, the same figures as section 4
  const tokToday = new Map()
  if (input.conso && Array.isArray(input.conso.rows)) {
    try {
      for (const x of rank(input.conso, { now: nowMs, preset: { since: 'midnight' }, group: 'conversation', top: 100000, basis: 'tokens' }).rows) tokToday.set(x.id, tokensOf(x.v))
    } catch { /* no tokens */ }
  }
  const window = Number(c.contexte.window) || Number(fcfg.context_window) || 400000
  const rx = coordRx(g)
  const linkTpl = input.link || g.session_link

  const info = new Map()
  for (const r of rows) {
    const s = scanBy.get(r.cli)
    const last = r.last_activity || 0
    const idle = nowMs - last
    const st = s ? sessionState(s, fcfg) : { state: '', reason: '' }
    let state
    if (r.archived) state = 'archived'
    else if (idle < g.working_min * MIN || (s && s.live)) state = 'working'
    else if (r.awaiting || st.state === 'julian') state = 'waiting'
    else if (st.state === 'blocked') state = 'blocked'
    else if (r.prs.some((p) => p.state === 'merged') || st.state === 'done') state = 'done'
    else state = 'idle'
    const role = spawned.get(r.sid) || spawned.get(r.cli) || (rx && rx.test(r.title || '')) ? 'coord' : r.parent ? 'lane' : 'agent'
    const reason = state === 'waiting' ? clip(st.state === 'julian' && st.reason ? st.reason : r.awaiting ? L.graphe_reason_awaiting : L.graphe_reason_ask, g.reason_max) : ''
    const since = state === 'waiting' ? (s && Date.parse(s.ask_ts || '')) || last : last
    const word = state === 'idle' ? fill(L.graphe_states.idle, { age: ageText(idle) }) : L.graphe_states[state]
    const tok = tokToday.has(r.cli) ? tokToday.get(r.cli) : null
    const ctx = s && Number(s.ctx) > 0 ? Math.round((100 * Number(s.ctx)) / window) : null
    info.set(r, { state, word, role, reason, since, tok, ctx, link: r.sid ? fill(linkTpl, { id: r.sid }) : '' })
  }

  // À toi de cliquer: whatever the filters (the archived and the too old aside), oldest first
  const waiting = rows.filter((r) => info.get(r).state === 'waiting' && nowMs - info.get(r).since <= g.wait_max_h * HOUR)
    .sort((a, b) => info.get(a).since - info.get(b).since)
    .map((r) => ({ key: r.cli, title: r.title || r.cli, reason: info.get(r).reason, age: ageText(nowMs - info.get(r).since), link: info.get(r).link, self: r.cli === self }))

  const periodMs = f.period === '24h' ? 24 * HOUR : f.period === '7j' ? 168 * HOUR : Infinity
  const projects = [...new Set(rows.filter((r) => !r.archived || f.archived).map((r) => r.repo))].sort((a, b) => a.localeCompare(b))
  const shown = rows.filter((r) => {
    const i = info.get(r)
    if (r.archived && !f.archived) return false
    if (f.project && r.repo !== f.project) return false
    if (f.active && !['working', 'waiting', 'blocked'].includes(i.state)) return false
    return i.state === 'waiting' || nowMs - (r.last_activity || 0) <= periodMs
  })
  const keep = new Set(shown)

  const order = (a, b) => (b.starred - a.starred) || (b.last_activity - a.last_activity)
  const kids = new Map()
  const roots = []
  for (const r of shown) {
    const p = r.parent && find(r.parent)
    if (p && keep.has(p) && p.repo === r.repo && p !== r) (kids.get(p) || kids.set(p, []).get(p)).push(r)
    else roots.push(r)
  }
  const groupsBy = new Map()
  for (const r of roots) (groupsBy.get(r.repo) || groupsBy.set(r.repo, []).get(r.repo)).push(r)
  const lineOf = (r, depth, prefix, cont) => {
    const i = info.get(r)
    const p = r.parent && find(r.parent)
    const peers = [...new Map(r.peers.slice().sort((a, b) => b.at - a.at).map((x) => [x.target, x])).values()]
      .map((x) => find(x.target)).filter(Boolean).slice(0, g.peers_max).map((t) => clip(t.title || t.cli, g.peer_title_max))
    return {
      key: r.cli, depth, prefix, cont, state: i.state, word: i.word, dot: g.dots[i.state] || '·', tone: { working: 'running', waiting: 'warn', blocked: 'bad', done: 'ok' }[i.state],
      title: r.title || r.cli, starred: r.starred, self: r.cli === self, role: L.graphe_roles[i.role], roleId: i.role,
      tokens: i.tok, ctx: i.ctx, peers, from: p && !keep.has(p) ? clip(p.title || p.cli, g.peer_title_max) : (p && p.repo !== r.repo ? clip(p.title || p.cli, g.peer_title_max) : ''),
      link: i.link,
    }
  }
  const walk = (r, depth, lead, last, out, seen) => {
    if (seen.has(r)) return
    seen.add(r)
    const prefix = depth === 0 ? '' : lead + (last ? '└ ' : '├ ')
    const below = depth === 0 ? '' : lead + (last ? '  ' : '│ ')
    const ch = (kids.get(r) || []).slice().sort(order)
    out.push(lineOf(r, depth, prefix, below + (ch.length ? '│ ' : '  ')))
    ch.forEach((k, j) => walk(k, depth + 1, below, j === ch.length - 1, out, seen))
  }
  let budget = Math.max(1, Number(g.max_rows) || 60)
  let hidden = 0
  const groups = [...groupsBy.entries()].map(([name, list]) => {
    list.sort(order)
    const lines = []
    const seen = new Set()
    for (const r of list) walk(r, 0, '', true, lines, seen)
    return { name, starred: list.some((r) => r.starred), last: Math.max(...list.map((r) => r.last_activity || 0)), all: lines }
  }).sort((a, b) => (b.starred - a.starred) || (b.last - a.last)).map((grp) => {
    const lines = grp.all.slice(0, budget)
    hidden += grp.all.length - lines.length
    budget -= lines.length
    return { name: grp.name, count: grp.all.length, starred: grp.starred, lines }
  }).filter((grp) => grp.lines.length)

  const count = (st) => shown.filter((r) => info.get(r).state === st).length
  const summary = [
    waiting.length ? fill(L.graphe_sum_waiting, { n: waiting.length }) : '',
    fill(L.graphe_sum_working, { n: count('working') }),
    count('blocked') ? fill(L.graphe_sum_blocked, { n: count('blocked') }) : '',
  ].filter(Boolean).join(' · ')
  return { ready: true, waiting, legend: L.graphe_legend, groups, projects, filter: f, hidden, summary, empty: !groups.length }
}

export { kTok }
