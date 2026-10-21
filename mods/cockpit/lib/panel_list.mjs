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
      over: ctx >= thr, last: Math.max(l.last || 0, s ? tsMs(s.last_activity) : 0, s ? tsMs(s.mtime) : 0), inScan: Boolean(s), starred: Boolean(l.starred),
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
