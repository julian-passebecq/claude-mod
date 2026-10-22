// cockpit Panneau, section 5 « Graphe des conversations » (Julian, 17 Oct: « the sidebar does not tell me who is
// active, who consumes, who is coordinator, who is blocked or idle, what I must click »).
//   À toi de cliquer   the conversations waiting for Julian (interruptedAwaitingPerson, or the open question factory's
//                      scan already detects), oldest first, with a short reason
//   legend             one short line of the state marks (panel.marks)
//   groups             by project like the app's sidebar (folder name of originCwd, else cwd; worktrees folded into
//                      their repo), starred first; children (spawnedFrom) under their parent, peer messages as a
//                      « ⇢ <short title> » note; each conversation ONE line (state dot, title, tokens today, context %),
//                      a second grey line only for a « lancée par / ⇢ message » relation
// State (Julian, 18 Oct: a coordinator running Workflows showed « finie »): the latest activity of the app's
// lastActivityAt and the transcript's mtime under working_min, a live scan or a running Workflow / background agent =
// travaille; « finie » needs done_min idle minutes and nothing running.
// Pure: no $, no I/O. Input: rows = lib/core/sessions.mjs graphRow (scanner part « graphe »), scan = factory's scan
// (live, mtime, subs, ask, ctx), workflows = factory's Workflow screen runs ({ cli, live }), conso = usage's classement.json (tokens today, as section 4). Labels and limits: panel.graphe and
// panel.labels.graphe_* in cockpit.config.json (lib/panel.mjs PANEL_DEFAULTS).
import { panelConfig, fill, kTok } from './panel.mjs'
import { rank } from './usage/lib/classement.mjs'
import { tokensOf } from './usage/lib/transcripts.mjs'
import { sessionState } from './factory/hooks/screens.mjs'
import { repoOf } from './factory/hooks/logic.mjs'

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

// a scan time: seconds or ms or ISO
const tsMs = (v) => {
  if (!v) return 0
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
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
 * input: { rows, scan, workflows, conso, fcfg, filter, link } (link: 'claude://claude.ai/epitaxy/{id}', from depuis.session_link).
 * self: this conversation's CLI id. Returns { ready, waiting, legend, groups, projects, filter, hidden, summary, empty }.
 */
export function grapheModel(input, self, cfg, nowMs) {
  const files = (input && Array.isArray(input.rows)) ? input.rows : null
  if (!files) return { ready: false }
  const c = panelConfig(cfg)
  const g = c.graphe
  const L = c.labels
  const f = grapheFilter(input.filter, cfg)
  const fcfg = input.fcfg || {}
  const scanBy = new Map(((input.scan && input.scan.sessions) || []).filter((s) => s.cli).map((s) => [s.cli, s]))
  // Julian, 19 Oct: « aucune conversation avec ces filtres » while 3 conversations worked. A conversation of factory's scan
  // (its transcript read) with no session file the scanner could read is drawn from the scan, not left out
  const inFiles = new Set(files.map((r) => r.cli))
  const rows = [...files]
  for (const s of scanBy.values()) {
    if (inFiles.has(s.cli) || s.archived) continue
    rows.push({ sid: String(s.sid || ''), cli: s.cli, title: String(s.app_title || s.title || s.cli), cwd: String(s.cwd || ''), origin: String(s.cwd || ''),
      repo: repoOf(s) || '?', archived: false, starred: false, last_activity: Math.max(tsMs(s.last_activity), tsMs(s.mtime)), created: 0,
      model: String(s.app_model || s.model || ''), effort: String(s.app_effort || s.effort || ''), parent: String(s.parent || ''), peers: [],
      awaiting: Boolean(s.awaiting), prs: [], branch: '' })
  }
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
  // conversations with a running Workflow (factory's Workflow screen) or a running background agent (the scan's subs)
  const busy = new Set(((input && input.workflows) || []).filter((w) => w && w.live && w.cli).map((w) => w.cli))
  for (const s of scanBy.values()) if ((s.subs || []).some((a) => a && a.status === 'running')) busy.add(s.cli)

  const info = new Map()
  for (const r of rows) {
    const s = scanBy.get(r.cli)
    // the latest sign of life: the app's lastActivityAt, the scan's last activity and its transcript's mtime
    const last = Math.max(r.last_activity || 0, s ? tsMs(s.last_activity) : 0, s ? tsMs(s.mtime) : 0)
    const idle = nowMs - last
    const st = s ? sessionState(s, fcfg) : { state: '', reason: '' }
    const running = busy.has(r.cli)
    let state
    if (r.archived) state = 'archived'
    else if (idle < g.working_min * MIN || (s && s.live) || running) state = 'working'
    else if (r.awaiting || st.state === 'julian') state = 'waiting'
    else if (st.state === 'blocked') state = 'blocked'
    else if (idle >= (Number(g.done_min) || 10) * MIN && (r.prs.some((p) => p.state === 'merged') || st.state === 'done')) state = 'done'
    else state = 'idle'
    const role = spawned.get(r.sid) || spawned.get(r.cli) || (rx && rx.test(r.title || '')) ? 'coord' : r.parent ? 'lane' : 'agent'
    const reason = state === 'waiting' ? clip(st.state === 'julian' && st.reason ? st.reason : r.awaiting ? L.graphe_reason_awaiting : L.graphe_reason_ask, g.reason_max) : ''
    const since = state === 'waiting' ? (s && Date.parse(s.ask_ts || '')) || last : last
    const word = state === 'idle' ? fill(L.graphe_states.idle, { age: ageText(idle) }) : L.graphe_states[state]
    const tok = tokToday.has(r.cli) ? tokToday.get(r.cli) : null
    const ctx = s && Number(s.ctx) > 0 ? Math.round((100 * Number(s.ctx)) / window) : null
    info.set(r, { state, word, role, reason, since, tok, ctx, last, link: r.sid ? fill(linkTpl, { id: r.sid }) : '' })
  }

  // À toi de cliquer: whatever the filters (the archived and the too old aside), oldest first
  const waiting = rows.filter((r) => info.get(r).state === 'waiting' && nowMs - info.get(r).since <= g.wait_max_h * HOUR)
    .sort((a, b) => info.get(a).since - info.get(b).since)
    .map((r) => ({ key: r.cli, title: r.title || r.cli, reason: info.get(r).reason, age: ageText(nowMs - info.get(r).since), link: info.get(r).link, self: r.cli === self }))

  const periodMs = f.period === '24h' ? 24 * HOUR : f.period === '7j' ? 168 * HOUR : Infinity
  const projects = [...new Set(rows.filter((r) => !r.archived || f.archived).map((r) => r.repo))].sort((a, b) => a.localeCompare(b))
  // a project filter kept in $.store from a project that has no conversation any more hides everything: ignored
  if (f.project && !projects.includes(f.project)) f.project = ''
  // the period is tested on the latest sign of life (the app's lastActivityAt, the scan's activity, the transcript's
  // mtime), as the state is: the app's timestamp alone hid conversations working for hours (Julian, 19 Oct); a
  // conversation that works, waits or is blocked is always shown
  const shown = rows.filter((r) => {
    const i = info.get(r)
    if (r.archived && !f.archived) return false
    if (f.project && r.repo !== f.project) return false
    const live = ['working', 'waiting', 'blocked'].includes(i.state)
    if (f.active && !live) return false
    return live || nowMs - (i.last || 0) <= periodMs
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
      key: r.cli, depth, prefix, cont, state: i.state, word: i.word, dot: (c.marks[i.state] || {}).glyph || '·', tone: (c.marks[i.state] || {}).tone,
      title: r.title || r.cli, starred: r.starred, self: r.cli === self, role: L.graphe_roles[i.role], roleId: i.role,
      tokens: i.tok, ctx: i.ctx, peers, from: p && !keep.has(p) ? clip(p.title || p.cli, g.peer_title_max) : (p && p.repo !== r.repo ? clip(p.title || p.cli, g.peer_title_max) : ''),
      link: i.link, sid: r.sid || '', repo: r.repo, last: i.last || 0, awaiting: Boolean(r.awaiting), model: r.model || '', effort: r.effort || '',
      // the second grey line of a working / waiting row (panel.detail normal): its start, its PRs and branch (CI)
      created: r.created || 0, prs: Array.isArray(r.prs) ? r.prs : [], branch: r.branch || '',
      // for the drawn graph (lib/viz_graph.mjs): the parent's and the peers' keys
      parentKey: p ? p.cli : '', peerKeys: [...new Set(r.peers.map((x) => find(x.target)).filter(Boolean).map((t) => t.cli))],
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
  // input.maxRows: the CONVERSATIONS list (lib/panel_list.mjs) reads every line, uncut
  let budget = Math.max(1, Number(input.maxRows) || Number(g.max_rows) || 60)
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
  const coords = shown.filter((r) => info.get(r).role === 'coord').length
  const macro = [fill(L.graphe_sum_conv, { n: shown.length }), coords ? fill(L.graphe_sum_coord, { n: coords }) : '',
    waiting.length ? fill(L.graphe_sum_waiting, { n: waiting.length }) : L.graphe_click_none].filter(Boolean).join(' · ')
  const legend = ['working', 'waiting', 'blocked', 'done', 'idle'].map((k) => ({ glyph: (c.marks[k] || {}).glyph || '·', tone: (c.marks[k] || {}).tone, label: (L.graphe_legend || {})[k] || k }))
  return { ready: true, waiting, legend, groups, projects, filter: f, hidden, summary, macro, empty: !groups.length }
}

export { kTok }
