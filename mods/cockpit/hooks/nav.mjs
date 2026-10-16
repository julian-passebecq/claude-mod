// cockpit - navigation and tree, pure (no $, no I/O; node --test mods/cockpit/tests/nav.test.mjs).
// Four zoom levels: méga (all projects of this PC) > macro (one project: its conversations as a tree through the app's
// spawnedFrom link) > medium (one conversation: its Workflows and agents) > micro (one agent). The input is the JSON of
// factory's scanner (lib/factory/scanner/factory_scan.py): sessions with sid, parent (spawnedFrom), subs; detail of one
// conversation. Every label and limit comes from cockpit.config.json.
import { titleOf, repoOf, short, ctxPct, billByModel, sumCost, tokensOf, family, fmtTokens, fmtUsd, hhmm } from '../lib/factory/hooks/logic.mjs'
import { sessionState, mission, effortBars } from '../lib/factory/hooks/screens.mjs'

export const LEVELS = ['mega', 'macro', 'medium', 'micro']
export const SECTIONS = ['breadcrumb', 'tree', 'diagram', 'detail', 'jauge', 'usage', 'veille', 'fichiers']

export const DEFAULTS = {
  sections: { order: SECTIONS, enabled: SECTIONS, open: ['jauge', 'usage'] },
  default_level: 'macro',
  auto_open: true,
  refresh_s: 20,
  strips_refresh_s: 60,
  diagram: { enabled: true, width: 340, row_h: 22, max_rows: 40 },
  tree: { max_convs: 30, max_agents: 20, show_done_agents: true },
  colors: { running: '#58a6ff', ok: '#3fb950', warn: '#d29922', bad: '#f85149', dim: '#8b949e', line: '#8b949e88', text: '#c9d1d9', selected: '#d2a8ff', usage: '#2f81f7' },
  labels: {
    title: 'Cockpit',
    levels: { mega: 'Méga', macro: 'Projet', medium: 'Conversation', micro: 'Agent' },
    level_hint: { mega: 'tous les projets du PC', macro: 'un projet : lead et sous-conversations', medium: 'une conversation : Workflows et agents', micro: 'un agent' },
    tree: 'Arbre',
    detail: 'Détail',
    diagram_alt: 'Arbre dessiné',
    jauge: 'Jauge',
    usage: 'Usage',
    veille: 'Veille',
    fichiers: 'Fichiers',
    fichiers_hint: 'L’arbre des fichiers est le mod filetree, dans son propre onglet du même panneau.',
    fichiers_button: 'Ouvrir Fichiers (/filetree)',
    this_conv: 'cette conversation',
    workflow: 'workflow',
    agents: 'agents',
    no_convs: 'aucune conversation récente',
    no_agents: 'aucun sous-agent',
    scanning: 'Lecture des transcripts…',
    refresh: 'Rafraîchir',
    updated: 'mis à jour {time}',
    module_missing: 'module {mod} non chargé (mets mods/{mod} à côté de cockpit)',
    not_readable: 'non lisible depuis un mod',
    agent_title: 'Agent',
    agent_log: 'Journal de l’agent',
    agent_none: 'Agent introuvable dans le dernier passage.',
    session: 'Session (5 h)',
    week_all: 'Semaine · tous modèles',
    week_fable: 'Semaine · Fable',
    credits: 'Crédits de session cloud',
    reset_in: 'reset dans {in}',
    reset_at: 'reset {at}',
    this_session: 'Cette session',
    cost: 'Coût',
    cache_hit: 'Cache hit',
    contributing: 'Ce qui pèse (cette session)',
    main_thread: 'fil principal',
    veille_off: 'veille : aucune lecture (mod veille absent ou jamais lancé)',
    veille_none: 'aucune alerte',
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

export function cockpitConfig(cfg) {
  return merge(DEFAULTS, cfg || {})
}

export function fill(tpl, vars) {
  return String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
}

// The sections shown, in order: `order` filtered by `enabled`; unknown ids dropped.
export function sectionsOf(cfg) {
  const c = cockpitConfig(cfg)
  return c.sections.order.filter((s) => SECTIONS.includes(s) && c.sections.enabled.includes(s))
}

// ---- navigation state ---------------------------------------------------------------------------------------------
// nav = { level, repo, conv, agent }: each level keeps what is above it, so the breadcrumb can zoom back out.

function visible(scan) {
  return ((scan && scan.sessions) || []).filter((s) => !(s.archived && !s.live))
}

export function findSession(scan, cli) {
  return ((scan && scan.sessions) || []).find((s) => s.cli === cli || (s.sid && s.sid === cli)) || null
}

// At session start: the conversation's own project at the configured level, this conversation selected.
export function initialNav(scan, self, cfg) {
  const c = cockpitConfig(cfg)
  const level = LEVELS.includes(c.default_level) ? c.default_level : 'macro'
  const me = findSession(scan, self)
  if (level === 'mega' || !me) return { level: me || level === 'mega' ? level : 'mega', repo: me ? repoOf(me) : null, conv: me ? me.cli : null, agent: null }
  return { level: level === 'micro' ? 'medium' : level, repo: repoOf(me), conv: me.cli, agent: null }
}

// Zoom out (or in, when the level's subject is already known) to `level`.
export function zoomTo(nav, level) {
  const i = LEVELS.indexOf(level)
  if (i < 0) return nav
  if (i >= 1 && !nav.repo) return nav
  if (i >= 2 && !nav.conv) return nav
  if (i >= 3 && !nav.agent) return nav
  return { ...nav, level }
}

// A click on a tree node: a project zooms to macro, a conversation to medium, an agent to micro.
export function select(nav, node) {
  if (!node) return nav
  if (node.kind === 'project') return { level: 'macro', repo: node.id, conv: nav.repo === node.id ? nav.conv : null, agent: null }
  if (node.kind === 'conv') return { level: 'medium', repo: node.repo || nav.repo, conv: node.id, agent: null }
  if (node.kind === 'agent') return { level: 'micro', repo: nav.repo, conv: node.conv || nav.conv, agent: node.id }
  if (node.kind === 'workflow') return { level: 'medium', repo: nav.repo, conv: node.conv || nav.conv, agent: null }
  return nav
}

// Méga › datapass-claude-eta › Galaxy finalisation autonome › coder
export function crumbs(nav, scan, cfg) {
  const L = cockpitConfig(cfg).labels
  const out = [{ level: 'mega', label: L.levels.mega }]
  const depth = LEVELS.indexOf(nav.level)
  if (depth >= 1 && nav.repo) out.push({ level: 'macro', label: nav.repo })
  if (depth >= 2 && nav.conv) {
    const s = findSession(scan, nav.conv)
    out.push({ level: 'medium', label: s ? titleOf(s) : String(nav.conv).slice(0, 8) })
  }
  if (depth >= 3 && nav.agent) {
    const a = agentOf(scan, nav.agent)
    out.push({ level: 'micro', label: a ? `${a.type}${a.desc ? ' · ' + a.desc : ''}` : String(nav.agent).slice(0, 8) })
  }
  return out.map((c, i) => ({ ...c, current: i === out.length - 1 }))
}

export function crumbText(list) {
  return list.map((c) => c.label).join(' › ')
}

// ---- the tree --------------------------------------------------------------------------------------------------------

export const STATE_TONE = { working: 'running', julian: 'warn', blocked: 'bad', done: 'ok', idle: 'dim', archived: 'dim', running: 'running', failed: 'bad', stopped: 'dim' }

const tsMs = (v) => (!v ? 0 : typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(v) || 0)

// The projects of the méga level with their counters (mission's project cards).
export function projectsOf(scan, cfg, nowMs) {
  const m = mission(scan || { sessions: [] }, cfg, nowMs)
  return m.projects.map((p) => {
    const st = p.states || {}
    return { repo: p.repo, sessions: p.sessions, live: p.live, workers: p.workers, cost: p.cost, maxCtxPct: p.maxCtxPct,
      working: st.working || 0, julian: st.julian || 0, blocked: st.blocked || 0, done: st.done || 0, idle: st.idle || 0,
      tone: st.blocked ? 'bad' : st.julian ? 'warn' : p.live ? 'running' : 'dim' }
  })
}

// A project's conversations plus every conversation they spawned (spawnedFrom), even in another repo: a lead in
// datapass-claude-eta that launched a lane in datapass-mosaicstudio shows that lane under it.
export function projectSessions(scan, repo) {
  const all = visible(scan)
  const out = all.filter((s) => repoOf(s) === repo)
  const sids = new Set(out.map((s) => s.sid).filter(Boolean))
  for (let grew = true; grew;) {
    grew = false
    for (const s of all) {
      if (s.parent && sids.has(s.parent) && !out.includes(s)) { out.push(s); if (s.sid) sids.add(s.sid); grew = true }
    }
  }
  return out
}

// One project's conversations as a forest: a root is a conversation whose spawnedFrom parent is not in the project.
export function convForest(scan, repo, cfg) {
  const c = cockpitConfig(cfg)
  const ss = projectSessions(scan, repo)
  const bySid = new Map(ss.filter((s) => s.sid).map((s) => [s.sid, s]))
  const node = (s) => {
    const st = sessionState(s, cfg)
    return { kind: 'conv', id: s.cli, sid: s.sid, repo, ownRepo: repoOf(s), title: titleOf(s), state: st.state, reason: st.reason, live: Boolean(s.live),
      model: s.app_model || s.model, effort: s.app_effort || s.effort || '?', ctxPct: ctxPct(s.ctx, cfg),
      agents: (s.subs || []).length, running: (s.subs || []).filter((x) => x.status === 'running').length,
      last: tsMs(s.last_activity) || tsMs(s.mtime), children: [] }
  }
  const nodes = new Map(ss.map((s) => [s.cli, node(s)]))
  const roots = []
  for (const s of ss) {
    const p = s.parent && bySid.get(s.parent)
    if (p && p !== s) nodes.get(p.cli).children.push(nodes.get(s.cli))
    else roots.push(nodes.get(s.cli))
  }
  const order = (a, b) => (b.live - a.live) || (b.children.length - a.children.length) || (b.last - a.last)
  const sortRec = (list) => { list.sort(order); for (const n of list) sortRec(n.children) }
  sortRec(roots)
  return roots.slice(0, c.tree.max_convs)
}

// The detail's subagents (when the scan's detail is that conversation), else the slim rows of the session list.
function subsOf(scan, cli) {
  if (scan && scan.detail && scan.detail.cli === cli) return scan.detail.subs || []
  const s = findSession(scan, cli)
  return (s && s.subs) || []
}

export function agentOf(scan, id) {
  if (!id) return null
  const d = scan && scan.detail
  const fromDetail = d && (d.subs || []).find((x) => x.id === id)
  if (fromDetail) return { ...fromDetail, conv: d.cli }
  for (const s of (scan && scan.sessions) || []) {
    const x = (s.subs || []).find((y) => y.id === id)
    if (x) return { ...x, conv: s.cli }
  }
  return null
}

function workflowName(scan, cli, id) {
  const d = scan && scan.detail
  const call = d && d.cli === cli && (d.calls || []).find((c) => c.tool === 'Workflow' && c.runId === id)
  return call ? call.desc : id
}

// One conversation's agents: plain Agent subagents, then each Workflow with its agents (running first, then recent).
export function agentNodes(scan, cli, cfg) {
  const c = cockpitConfig(cfg)
  const subs = subsOf(scan, cli).filter((x) => c.tree.show_done_agents || x.status === 'running')
  const sort = (list) => [...list].sort((a, b) => ((b.status === 'running') - (a.status === 'running')) || String(b.ts || b.last_ts || '').localeCompare(String(a.ts || a.last_ts || '')))
  const agent = (x) => {
    const bill = billByModel([x.models], cfg)
    return { kind: 'agent', id: x.id, conv: cli, title: `${x.type}${x.desc ? ' · ' + x.desc : ''}`, type: x.type, state: x.status, model: x.model,
      effort: x.effort || '?', tokens: Object.values(bill).reduce((a, b) => a + b.tokens, 0), cost: sumCost(bill), children: [] }
  }
  const plain = sort(subs.filter((x) => !x.workflow)).slice(0, c.tree.max_agents).map(agent)
  const wfIds = [...new Set(subs.filter((x) => x.workflow).map((x) => x.workflow))]
  const wfs = wfIds.map((id) => {
    const kids = sort(subs.filter((x) => x.workflow === id))
    return { kind: 'workflow', id, conv: cli, title: `${c.labels.workflow} ${workflowName(scan, cli, id)}`, state: kids.some((k) => k.status === 'running') ? 'running' : 'done',
      count: kids.length, children: kids.slice(0, c.tree.max_agents).map(agent), hidden: Math.max(0, kids.length - c.tree.max_agents) }
  })
  return { plain, workflows: wfs, hidden: Math.max(0, subs.filter((x) => !x.workflow).length - c.tree.max_agents) }
}

// The rows the pane draws (and the diagram), top to bottom, each with its depth and whether it is the selection.
export function treeRows(nav, scan, cfg, nowMs, self) {
  const rows = []
  const add = (r) => rows.push(r)
  if (nav.level === 'mega' || !nav.repo) {
    for (const p of projectsOf(scan, cfg, nowMs)) {
      add({ key: 'p-' + p.repo, kind: 'project', id: p.repo, depth: 0, label: p.repo, tone: p.tone, selected: p.repo === nav.repo,
        meta: projectMeta(p), counters: p })
    }
    return rows
  }
  const p = projectsOf(scan, cfg, nowMs).find((x) => x.repo === nav.repo)
  add({ key: 'p-' + nav.repo, kind: 'project', id: nav.repo, depth: 0, label: nav.repo, tone: p ? p.tone : 'dim', selected: nav.level === 'macro', meta: p ? projectMeta(p) : '' })
  const walk = (list, depth) => {
    for (const n of list) {
      const sel = nav.conv === n.id
      add({ key: 'c-' + n.id, kind: 'conv', id: n.id, repo: n.repo, depth, label: n.title, tone: STATE_TONE[n.state] || 'dim', state: n.state,
        selected: sel && nav.level === 'medium', onPath: sel, self: n.id === self,
        meta: `${n.ownRepo !== n.repo ? n.ownRepo + ' · ' : ''}${short(n.model)} · ${n.effort} · ctx ${n.ctxPct}%${n.agents ? ` · agents ${n.running}/${n.agents}` : ''}` })
      if (sel && LEVELS.indexOf(nav.level) >= 2) {
        const a = agentNodes(scan, n.id, cfg)
        for (const x of a.plain) add(agentRow(x, depth + 1, nav))
        for (const w of a.workflows) {
          add({ key: 'w-' + w.id, kind: 'workflow', id: w.id, conv: n.id, depth: depth + 1, label: w.title, tone: STATE_TONE[w.state], state: w.state, meta: `${w.count} agents`, selected: false })
          for (const x of w.children) add(agentRow(x, depth + 2, nav))
        }
      }
      walk(n.children, depth + 1)
    }
  }
  walk(convForest(scan, nav.repo, cfg), 1)
  return rows
}

function agentRow(x, depth, nav) {
  return { key: 'a-' + x.id, kind: 'agent', id: x.id, conv: x.conv, depth, label: x.title, tone: STATE_TONE[x.state] || 'dim', state: x.state,
    selected: nav.level === 'micro' && nav.agent === x.id, meta: `${short(x.model)} · ${effortBars(x.effort)} ${x.effort} · ${fmtTokens(x.tokens)} tok · ${fmtUsd(x.cost)}` }
}

function projectMeta(p) {
  const bits = [`${p.sessions} conv.`]
  if (p.working) bits.push(`${p.working} en cours`)
  if (p.julian) bits.push(`${p.julian} attend Julian`)
  if (p.blocked) bits.push(`${p.blocked} bloquée(s)`)
  if (p.workers) bits.push(`agents ${p.workers}`)
  bits.push(fmtUsd(p.cost))
  return bits.join(' · ')
}

// The text of one row as the terminal and the text render show it: indent, a tree elbow, a state dot.
export function rowText(r) {
  const pad = r.depth ? '  '.repeat(r.depth - 1) + '└ ' : ''
  return `${pad}${r.kind === 'workflow' ? '◇' : r.kind === 'project' ? '■' : '●'} ${r.label}`
}

// ---- scan subsets for the factory screens ----------------------------------------------------------------------------

// The same scan restricted to one project (and the lanes it spawned), so factory's Focus and Pipeline draw that
// project only; the PR/MR reviews too, by repo name.
export function scanForRepo(scan, repo) {
  if (!scan || !repo) return scan
  const sessions = projectSessions(scan, repo)
  const repos = new Set(sessions.map(repoOf))
  const reviews = scan.reviews && Array.isArray(scan.reviews.items)
    ? { ...scan.reviews, items: scan.reviews.items.filter((it) => repos.has(String(it.repo || '').split('/').pop())) } : scan.reviews
  return { ...scan, sessions, reviews }
}

// ---- micro: one agent ----------------------------------------------------------------------------------------------

export function agentCard(scan, id, cfg) {
  const x = agentOf(scan, id)
  if (!x) return null
  const bill = billByModel([x.models], cfg)
  const tokens = Object.values(bill).reduce((a, b) => a + b.tokens, 0)
  return {
    id: x.id, conv: x.conv, type: x.type, desc: x.desc || '', status: x.status, model: x.model, explicit: x.explicit_model || null,
    effort: x.effort || '?', tokens, cost: sumCost(bill), workflow: x.workflow || null, phase: x.phase || null,
    ctx: x.ctx || 0, tools: x.tools || 0, readonly: x.readonly || 0, lastTool: x.last_tool || '', task: x.prompt || x.desc || '',
    started: tsMs(x.ts), last: tsMs(x.last_ts), events: (x.events || []).map((e) => ({ at: tsMs(e[0]), kind: e[1], text: e[2] })),
    hasLog: Array.isArray(x.events),
  }
}

// ---- usage card ------------------------------------------------------------------------------------------------------

export function inText(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${Math.floor(h / 24)} j`
}

export function atText(ms) {
  const d = new Date(ms)
  const days = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
  return `${days[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// usage: $.session.usage() ({ rateLimits, cost }); me: this conversation's row in the scan (models, subs).
export function usageCard(usage, me, cfg, nowMs) {
  const L = cockpitConfig(cfg).labels
  const limits = (usage && usage.rateLimits) || []
  const win = (kind, label, match) => {
    const r = limits.find((x) => (match ? match.test(x.kind) : x.kind === kind))
    if (!r || !Number.isFinite(r.percentUsed)) return { label, available: false, text: L.not_readable }
    const reset = Date.parse(r.resetsAt || '')
    const when = Number.isFinite(reset) ? (reset - nowMs < 24 * 3600000 ? fill(L.reset_in, { in: inText(reset - nowMs) }) : fill(L.reset_at, { at: atText(reset) })) : ''
    return { label, available: true, pct: r.percentUsed, when }
  }
  const windows = [win('five_hour', L.session), win('seven_day', L.week_all), win(null, L.week_fable, /fable/i)]
  const spend = limits.find((x) => x.kind === 'spend_limit')
  const credits = spend && Number.isFinite(spend.percentUsed) ? { available: true, pct: spend.percentUsed, text: `${Math.round(spend.percentUsed)} %` } : { available: false, text: L.not_readable }
  // this session: cost from the engine, model share, cache hit and contributors from the transcripts (factory's prices)
  const maps = me ? [me.models, ...(me.subs || []).map((x) => x.models)] : []
  const bill = billByModel(maps, cfg)
  const fam = {}
  let total = 0
  for (const [m, b] of Object.entries(bill)) { const f = family(m); fam[f] = (fam[f] || 0) + b.cost; total += b.cost }
  const share = ['opus', 'sonnet', 'haiku', 'fable'].filter((f) => fam[f]).map((f) => ({ family: f, pct: total ? Math.round((100 * fam[f]) / total) : 0 }))
  let read = 0
  let all = 0
  for (const mp of maps) for (const v of Object.values(mp || {})) { read += v[2] || 0; all += (v[0] || 0) + (v[2] || 0) + (v[3] || 0) + (v[4] || 0) }
  const byType = {}
  if (me) byType[L.main_thread] = sumCost(billByModel([me.models], cfg))
  for (const x of (me && me.subs) || []) byType[x.type] = (byType[x.type] || 0) + sumCost(billByModel([x.models], cfg))
  const contributors = Object.entries(byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([type, cost]) => ({ type, cost, pct: total ? Math.round((100 * cost) / total) : 0 }))
  const cost = usage && usage.cost && Number.isFinite(usage.cost.usd) ? usage.cost.usd : me ? total : null
  return { windows, credits, session: { cost, costSource: usage && usage.cost ? 'engine' : 'transcripts', share, cacheHit: all ? Math.round((100 * read) / all) : null, contributors } }
}

export function usageLine(card) {
  const s = card.session
  const parts = []
  if (s.cost !== null && s.cost !== undefined) parts.push(`${fmtUsd(s.cost)}`)
  for (const x of s.share) parts.push(`${x.family[0].toUpperCase()}${x.family.slice(1)} ${x.pct} %`)
  if (s.cacheHit !== null) parts.push(`cache ${s.cacheHit} %`)
  return parts.join(' · ')
}

export { hhmm, fmtTokens, fmtUsd, short, effortBars, titleOf, repoOf, tokensOf }
