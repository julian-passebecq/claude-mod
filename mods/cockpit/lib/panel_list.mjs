// cockpit Panneau, section 3 « CONVERSATIONS » (Julian, 22 Oct 01:17: « it doesn't work, I don't see all ongoing
// conversations »: EN COURS said 6 conversations worked, GRAPHE 17 conv, the list 2 rows « · 1 actives »). The list
// was built from usage's classement.json alone (the conversations that spent tokens in the period, « aujourd’hui » =
// since local midnight, from a usage scan up to rescan_min old): 77 minutes after midnight it held 2 conversations.
// Since then it is built from the same sessions as GRAPHE (the app's session files, not archived, plus factory's scan),
// with the activity of EN COURS (enCours().byCli, the same factories) and the tokens of usage when it has them (« — »
// otherwise, never a reason to hide a row).
//   convRows(...)   every candidate conversation, in the shape of synthesis() rows plus { last, group, parentId }
//   convList(...)   what is drawn: working and waiting ones always, the others active within the period (24 h by
//                   default), grouped by project like the app's sidebar, sub-conversations under their parent, working
//                   ones first; header counts equal to EN COURS; a filter never hides a working one (« filtre : … »)
//   oneList(...)   the Panneau's ONE list (22 Oct): conversations nested under their parent whatever the project,
//                   their running Workflows and agents under them, « + N au repos › » for the rest
//   panelConvs(...) the whole wiring (rows → factories → EN COURS → list), shared by hooks/register.mjs and the preview
// Pure: no $, no I/O (node --test mods/cockpit/tests/panel_list.test.mjs).
import { panelConfig, stateGroup, markOf, liveState, liveness } from './panel.mjs'
import { convFactories, enCours } from './panel_conv.mjs'
import { grapheModel } from './graphe.mjs'
import { windowOf } from './usage/lib/classement.mjs'
import { sessionState } from './factory/hooks/screens.mjs'
import { repoOf } from './factory/hooks/logic.mjs'

const tsMs = (v) => (!v ? 0 : typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(v) || 0)
const GRAPH_MARK = { working: 'working', waiting: 'waiting', blocked: 'blocked', done: 'done', idle: 'idle', archived: 'archived' }

/**
 * Every candidate conversation. in: { graphRows (lib/core/sessions.mjs graphRow rows, may be null), scan (factory's
 * scan), runs (factory's Workflow screen runs), syn (synthesis() of the filter's period: tokens, cost, tok/s), conso
 * (classement.json, for the graph's tokens), fcfg }. -> [{ id, sid, label, project, group, mark, state, stateLabel,
 * tokens (null = unknown), cost, tps, parent (its parent's sid), parentId (its parent's cli), parentTitle, ctx, model,
 * effort, over, last (ms of its latest sign of life), inScan }], the graph's order (sidebar groups, then activity).
 */
export function convRows(input, cfg, nowMs) {
  const { graphRows, scan, runs, syn, conso, fcfg } = input || {}
  const c = panelConfig(cfg)
  const L = c.labels
  const g = grapheModel({ rows: Array.isArray(graphRows) ? graphRows : [], scan, workflows: runs || [], conso, fcfg: fcfg || {},
    filter: { period: 'tout', project: '', active: false, archived: false }, maxRows: 1e6 }, '', cfg, nowMs)
  const lines = g.ready ? g.groups.flatMap((x) => x.lines.map((l) => ({ ...l, group: x.name }))) : []
  const scanBy = new Map(((scan && scan.sessions) || []).filter((s) => s.cli).map((s) => [s.cli, s]))
  const usage = new Map((((syn && (syn.every || syn.rows)) || []).filter((r) => r.id !== 'codex')).map((r) => [r.id, r]))
  const byCli = new Map(lines.map((l) => [l.key, l]))
  const thr = Number(c.contexte.handoff_tokens) || 250000
  return lines.map((l) => {
    const s = scanBy.get(l.key)
    const u = usage.get(l.key)
    // the scan's state (its live Workflows and agents too) when it has the conversation, else the graph's: whether a
    // conversation works is said by its transcript (EN COURS), so without one the graph's « recent activity » guess is
    // « au repos »; the app's « waiting on a person » flag wins over a plain idle
    let mark = s ? markOf(liveState(sessionState(s, fcfg || {}).state, runs ? liveness(s, runs, l.key, nowMs, cfg) : null)) : l.state === 'working' ? 'idle' : GRAPH_MARK[l.state] || 'idle'
    if ((l.state === 'waiting' || l.awaiting) && (mark === 'idle' || mark === 'done')) mark = 'waiting'
    const st = { working: 'working', waiting: 'julian', blocked: 'blocked', stalled: 'stalled', done: 'done', idle: 'idle', archived: 'archived' }[mark] || 'idle'
    const grp = stateGroup(st, cfg)
    const p = l.parentKey ? byCli.get(l.parentKey) : null
    const ctx = s ? Number(s.ctx) || 0 : 0
    return {
      id: l.key, sid: l.sid || (s && s.sid) || '', label: l.title, project: l.repo || (s && repoOf(s)) || '?', group: l.group || l.repo || '?',
      mark, state: grp, stateLabel: mark === 'stalled' ? L.stalled : L.states[grp] || grp,
      tokens: u ? u.tokens : null, cost: u ? u.cost : null, tps: u ? u.tps : null,
      parent: p ? p.sid : (s && s.parent) || '', parentId: p ? p.key : '', parentTitle: p ? p.title : '',
      ctx, model: (s && (s.app_model || s.model)) || l.model || '', effort: (s && (s.app_effort || s.effort)) || l.effort || '',
      over: ctx >= thr, last: Math.max(l.last || 0, s ? tsMs(s.last_activity) : 0, s ? tsMs(s.mtime) : 0), inScan: Boolean(s), starred: Boolean(l.starred), coord: l.roleId === 'coord',
      created: Number(l.created) || 0, prs: l.prs || [], branch: l.branch || '',
    }
  })
}

/** The period of the filter (panel.convs.periods), its default (panel.convs.period) when unset or unknown. */
export function periodOf(f, cfg) {
  const q = panelConfig(cfg).convs
  return q.periods.find((p) => p.id === (f && f.period)) || q.periods.find((p) => p.id === q.period) || q.periods[0]
}

const CAT_OF_STATE = { running: 'working', waiting: 'waiting', done: 'idle' }

/**
 * What CONVERSATIONS draws. rows: convRows(); n: enCours() of the same rows and factories (its byCli); f: the filter
 * { period, project, state }; tzMin: classement's time zone (the « aujourd’hui » period). Every conversation that works
 * (EN COURS says so) or waits is listed whatever the filters; the others when active within the period and kept by the
 * filters. -> { groups: [{ name, count, working, roots: [{ row, kids: [...] }] }], rows (drawn, flat), counts: { working,
 * waiting, idle }, note: '' | the filter that a working conversation ignored, filtered: bool }.
 */
export function convList(rows, n, f, cfg, nowMs, tzMin = 0) {
  const by = (n && n.byCli) || {}
  const period = periodOf(f, cfg)
  const from = period.since || period.hours ? windowOf(period, nowMs, tzMin).from : -Infinity
  const want = CAT_OF_STATE[(f && f.state) || ''] || ''
  const cats = new Map()
  for (const r of rows || []) {
    const x = by[r.id]
    const working = Boolean(x && x.running)
    const waiting = !working && (Boolean(x && x.blocked) || ['waiting', 'blocked', 'stalled'].includes(r.mark))
    cats.set(r.id, working ? 'working' : waiting ? 'waiting' : 'idle')
  }
  let ignored = false
  const shown = []
  for (const r of rows || []) {
    const cat = cats.get(r.id)
    // active within the period: its latest sign of life, or tokens spent in it (usage's figures are of that period)
    const fresh = cat !== 'idle' || (r.last || 0) >= from || Number(r.tokens) > 0
    const kept = (!f || !f.project || r.project === f.project) && (!want || want === cat)
    if (cat === 'working') { if (!kept) ignored = true; shown.push(r); continue }
    if (fresh && kept) shown.push(r)
  }
  // a working row is drawn « travaille » even when the scan's state lagged (EN COURS counted it)
  const drawn = shown.map((r) => {
    const cat = cats.get(r.id)
    const mark = cat === 'working' && r.mark !== 'stalled' ? 'working' : r.mark
    return { ...r, cat, mark, state: cat === 'working' ? 'running' : cat === 'waiting' ? 'waiting' : r.state === 'running' ? 'done' : r.state }
  })
  const ids = new Map(drawn.map((r) => [r.id, r]))
  const rank = (r) => (r.cat === 'working' ? 0 : r.cat === 'waiting' ? 1 : 2)
  const order = (a, b) => rank(a) - rank(b) || (b.last || 0) - (a.last || 0)
  // sub-conversations under their parent when it is drawn (wherever its project), a loop in the links goes to the top
  const parentOf = (r) => { const p = r.parentId && r.parentId !== r.id ? ids.get(r.parentId) : null; return p || null }
  const kidsOf = new Map()
  const roots = []
  for (const r of drawn) {
    let p = parentOf(r)
    const seen = new Set([r.id])
    for (let q = p; q; q = parentOf(q)) { if (seen.has(q.id)) { p = null; break } seen.add(q.id) }
    if (p) (kidsOf.get(p.id) || kidsOf.set(p.id, []).get(p.id)).push(r)
    else roots.push(r)
  }
  const flat = []
  const tree = (r) => { flat.push(r); return { row: r, kids: (kidsOf.get(r.id) || []).sort(order).map(tree) } }
  // groups in the sidebar's order (the graph's: starred, then latest activity), the rows' order inside
  const gOrder = []
  for (const r of rows || []) if (!gOrder.includes(r.group)) gOrder.push(r.group)
  const groups = gOrder.map((name) => {
    const list = roots.filter((r) => r.group === name).sort(order)
    if (!list.length) return null
    const start = flat.length
    const nodes = list.map(tree)
    const mine = flat.slice(start)
    return { name, count: mine.length, working: mine.filter((r) => r.cat === 'working').length, roots: nodes }
  }).filter(Boolean)
  const counts = { working: 0, waiting: 0, idle: 0 }
  for (const r of flat) counts[r.cat]++
  const L = panelConfig(cfg).labels
  const dflt = periodOf({}, cfg)
  const parts = [f && f.period && period.id !== dflt.id ? period.label : '', f && f.project ? `${L.project} ${f.project}` : '', f && f.state ? `${L.state} ${L.states[f.state] || f.state}` : ''].filter(Boolean)
  return { groups, rows: flat, counts, note: ignored && parts.length ? parts.join(' · ') : '', filtered: parts.length > 0 }
}

/**
 * The whole CONVERSATIONS wiring, one place for hooks/register.mjs and scripts/fixtures/panneau.mjs. in: { syn
 * (synthesis() of the filter), graphRows, graphe (the GRAPHE section's model), scan, runs, conso, fcfg, self,
 * selfFactory, closed, autoWindow, tpsById, cardOf, filter, tzMin }. The pool = the candidates active within the period,
 * plus every conversation of the scan (its main thread may work) and every busy one: their factories are built, EN
 * COURS counts over them, the list is drawn from them. -> { pool, list, under (convFactories()), n (enCours()) }.
 */
export function panelConvs(input, cfg, nowMs) {
  const { syn, graphRows, graphe, scan, runs, conso, fcfg, self, selfFactory, closed = {}, autoWindow, tpsById = {}, cardOf, filter = {}, tzMin = 0 } = input || {}
  const all = convRows({ graphRows, scan, runs, syn, conso, fcfg }, cfg, nowMs)
  const p = periodOf(filter, cfg)
  const from = p.since || p.hours ? windowOf(p, nowMs, tzMin).from : -Infinity
  const busy = new Set(['working', 'waiting', 'blocked', 'stalled'])
  const pool = all.filter((r) => r.inScan || busy.has(r.mark) || (r.last || 0) >= from || Number(r.tokens) > 0 || r.id === self)
  const under = convFactories({ scan, runs, syn: { rows: pool }, synAll: { rows: pool }, graphe, self, selfFactory, closed, autoWindow, tpsById, cardOf }, fcfg, cfg, nowMs)
  const n = enCours({ syn: { rows: pool }, factory: selfFactory, factories: under.factories, self })
  const list = convList(pool, n, filter, cfg, nowMs, tzMin)
  return { pool, list, under, n }
}

const RANK = { working: 0, waiting: 1, idle: 2 }

/**
 * The Panneau's ONE list (Julian, 22 Oct 01:25: « a lot going on, it's not clear… visibility, indentation, bullets,
 * agents, sub-agents, workflows, progress bars »), like the app's sidebar: every conversation of convList() as a tree,
 * children under their PARENT even when in another project (the child's project said on its row), under a conversation
 * its running Workflows (then their running agents) and its running agents outside a Workflow, then its
 * sub-conversations. The roots that work or wait (themselves or a descendant) first, then the 3 (list.rest_shown) most
 * recent at rest, then « + N au repos › » (o.restOpen: all of them). in: list (convList()), o: { factories (clis →
 * convFactory()), self, selfFactory, cfg, restOpen, nowMs }. -> { lines: [{ kind: conv | workflow | agent | agents_more |
 * rest, depth, key, … }], counts: { rows, working, waiting, rest, nested, workflows, agents, hidden } }.
 */
export function oneList(list, o = {}) {
  const c = panelConfig(o.cfg)
  const q = c.list || {}
  const max = Math.max(1, Number(c.conv.running_max) || 8)
  const facts = o.factories || {}
  const fm = (id) => (id === o.self ? o.selfFactory : facts[id]) || null
  let roots = list && Array.isArray(list.groups) ? list.groups.flatMap((g) => g.roots) : []
  // this conversation is always a row « (ici) », even before the session files list it
  const sm = o.selfFactory
  const has = (ts) => ts.some((t) => t.row.id === o.self || has(t.kids))
  if (o.self && sm && sm.available && !has(roots)) {
    const busy = sm.cards.length > 0 || Boolean(sm.lead && sm.lead.mainBusy)
    const idle = Number.isFinite(sm.lead && sm.lead.idleMs) ? sm.lead.idleMs : 0
    roots = [{ row: { id: o.self, label: sm.lead.title, project: '', cat: busy ? 'working' : 'idle', mark: busy ? 'working' : 'idle', last: (Number(o.nowMs) || 0) - idle, model: sm.lead.model, effort: sm.lead.effort }, kids: [] }, ...roots]
  }
  const best = (t) => Math.min(RANK[t.row.cat] ?? 2, ...t.kids.map(best))
  const latest = (t) => Math.max(Number.isFinite(t.row.last) ? t.row.last : 0, ...t.kids.map(latest))
  const ranked = roots.map((t, i) => ({ t, i, b: best(t), l: latest(t) })).sort((a, b) => a.b - b.b || b.l - a.l || a.i - b.i)
  const active = ranked.filter((x) => x.b < 2).map((x) => x.t)
  const rest = ranked.filter((x) => x.b >= 2).map((x) => x.t)
  const keep = Math.max(0, Number.isFinite(Number(q.rest_shown)) ? Number(q.rest_shown) : 3)
  const shownRest = o.restOpen ? rest : rest.slice(0, keep)
  const lines = []
  const agents = (list2, depth, key, background) => {
    const run = list2.filter((a) => a.status === 'running')
    for (const a of run.slice(0, max)) lines.push({ kind: 'agent', depth, key: `${key}-${a.id}`, agent: a, background })
    if (run.length > max) lines.push({ kind: 'agents_more', depth, key: `${key}-more`, n: run.length - max })
  }
  const walk = (t, depth, parent) => {
    const r = t.row
    const m = fm(r.id)
    lines.push({ kind: 'conv', depth, key: r.id, row: r, m, self: r.id === o.self, hasKids: false,
      // the project as a short grey suffix (Julian, 22 Oct: no project header on its own line): on a root, and on a child
      // whose project is not its parent's
      project: r.project && r.project !== '?' && (!parent || r.project !== parent.project) ? r.project : '' })
    const me = lines[lines.length - 1]
    const before = lines.length
    if (m && m.available) {
      for (const k of m.cards) {
        const all = k.phases.flatMap((p) => p.agents)
        if (k.kind === 'workflow') {
          lines.push({ kind: 'workflow', depth: depth + 1, key: k.key, card: k, conv: r.id, done: all.filter((a) => a.status === 'done').length, total: all.length || Number(k.count) || 0 })
          agents(all, depth + 2, k.key, false)
        } else agents(all, depth + 1, k.key, true)
      }
    }
    for (const kid of t.kids) walk(kid, depth + 1, r)
    me.hasKids = lines.length > before
  }
  for (const t of [...active, ...shownRest]) walk(t, 0, null)
  const hidden = rest.length - shownRest.length
  if (rest.length > keep) lines.push({ kind: 'rest', depth: 0, key: 'rest', n: o.restOpen ? rest.length - keep : hidden, open: Boolean(o.restOpen) })
  const convs = lines.filter((x) => x.kind === 'conv')
  const cat = (x) => x.row.cat || 'idle'
  return {
    lines,
    counts: { rows: convs.length, working: convs.filter((x) => cat(x) === 'working').length, waiting: convs.filter((x) => cat(x) === 'waiting').length,
      rest: convs.filter((x) => cat(x) === 'idle').length, nested: convs.filter((x) => x.depth > 0).length, workflows: lines.filter((x) => x.kind === 'workflow').length,
      agents: lines.filter((x) => x.kind === 'agent').length, hidden },
  }
}

const CI_STATE = { success: 'ok', passed: 'ok', failed: 'bad', failure: 'bad', canceled: 'bad', cancelled: 'bad', running: 'running', pending: 'running', queued: 'running', created: 'running', in_progress: 'running' }

/**
 * The CI state of each branch from the ci mod's pipelines cache (the newest run of a branch wins): { 'repo|branch':
 * 'ok' | 'bad' | 'running' } (also under 'branch' alone for a branch that is not main / master). For the second grey
 * line of a row (panel.detail normal): « PR #120 ✓ ».
 */
export function ciBranches(cache) {
  const out = {}
  const at = {}
  for (const a of (cache && cache.apps) || []) {
    for (const r of a.runs || []) {
      const st = CI_STATE[String((r && r.status) || '').toLowerCase()]
      const b = r && String(r.branch || '')
      if (!st || !b) continue
      const t = tsMs(r.created)
      const keys = [`${r.app || a.app || '?'}|${b}`, ...(/^(main|master)$/.test(b) ? [] : [b])]
      for (const k of keys) if (!(k in at) || t >= at[k]) { at[k] = t; out[k] = st }
    }
  }
  return out
}

/** The CI state of a row (its project and branch), or ''. */
export function ciOfRow(map, row) {
  if (!map || !row || !row.branch) return ''
  return map[`${row.project}|${row.branch}`] || map[row.branch] || ''
}

/** « Aujourd’hui » (panel.detail normal): conversations with tokens, tokens and cost of a synthesis() since midnight. */
export function todayOf(syn) {
  if (!syn || !syn.hasData) return null
  const rows = (syn.every || syn.rows || []).filter((r) => r.id !== 'codex' && Number(r.tokens) > 0)
  return { convs: rows.length, tokens: syn.total ? Number(syn.total.tokens) || 0 : 0, cost: syn.total && Number.isFinite(syn.total.cost) ? syn.total.cost : null }
}
