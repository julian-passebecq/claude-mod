// cockpit - navigation and tree, pure (no $, no I/O; node --test mods/cockpit/tests/nav.test.mjs).
// Four zoom levels: méga (all projects of this PC) > macro (one project: its conversations as a tree through the app's
// spawnedFrom link) > medium (one conversation: its Workflows and agents) > micro (one agent). The input is the JSON of
// factory's scanner (lib/factory/scanner/factory_scan.py): sessions with sid, parent (spawnedFrom), subs; detail of one
// conversation. Every label and limit comes from cockpit.config.json.
import { titleOf, repoOf, short, ctxPct, billByModel, sumCost, tokensOf, family, fmtTokens, fmtUsd, hhmm } from '../lib/factory/hooks/logic.mjs'
import { sessionState, mission, effortBars, screensConfig } from '../lib/factory/hooks/screens.mjs'
import { rank } from '../lib/usage/lib/classement.mjs'

export const LEVELS = ['mega', 'macro', 'medium', 'micro']
// Tabs of the one pane: « Cockpit » (cards + the scoped sections), then factory's screens (synced copies in
// lib/factory) and Machine. factory's Quotas and Système are not here: the Quota card and Machine replace them.
// relais = Claude ↔ Codex, galerie = the Reference Gallery views (Équipe, Carte, Codex), nuit = « Bilan avant la nuit »
// (opened by the Nuit button of the Cockpit tab; listed in tabs.order only if you add it), depuis = « Depuis ton dernier
// message » (its button on the Cockpit tab, /cockpit depuis [8h|24h|nuit|HH:MM]; off with depuis.enabled false).
export const TABS = ['panneau', 'home', 'mission', 'focus', 'arbre', 'pipeline', 'workflow', 'journal', 'machine', 'relais', 'galerie', 'nuit', 'depuis']
const DEFAULT_TABS = ['home', 'mission', 'focus', 'arbre', 'pipeline', 'workflow', 'journal', 'machine', 'relais', 'galerie']
// Top to bottom by scope: this conversation, its project, every project, Claude as a whole. Each is foldable.
export const SECTIONS = ['breadcrumb', 'conv', 'project', 'all', 'conso', 'global', 'fichiers']
export const FOLDABLE = ['conv', 'project', 'all', 'conso', 'global']

export const DEFAULTS = {
  sections: { order: SECTIONS, enabled: SECTIONS, open: ['conv'] },
  tabs: { order: DEFAULT_TABS, enabled: TABS, labels: { home: 'Cockpit', mission: 'Mission', focus: 'Focus', arbre: 'Arbre', pipeline: 'Pipeline', workflow: 'Workflow', journal: 'Journal', machine: 'Machine', relais: 'Claude ↔ Codex', galerie: 'Galerie', nuit: 'Nuit', depuis: 'Depuis' } },
  // The vertical menu at the left of the pane: the 6 entries of the band's bar. A press runs the entry's command (a mod
  // cannot open another mod's pane); self: true = this pane (goes to the Cockpit tab). Under min_columns the menu is
  // one row on top instead. position: left | top | off.
  menu: {
    position: 'left', min_columns: 50, width: 12,
    items: [
      { label: 'Jauge', command: 'jauge' }, { label: 'Cockpit', self: true }, { label: 'Veille', command: 'veille' },
      { label: 'À toi', command: 'afaire' }, { label: 'Registres', command: 'registres' }, { label: 'Référence', command: 'reference' },
    ],
  },
  // The Nuit / Jour row of the Cockpit tab: Nuit opens « Bilan avant la nuit », Jour runs /veille jour. repos: extra
  // repo folders whose handoff/ROADMAP.md and packets are read for « Prêt à lancer » (the recent conversations' folders
  // are always read). The screen's own settings (wake time, regexes, launch command) are under `nuit` (lib/decide.mjs).
  day_night: { enabled: true, repos: [], recent_days: 7 },
  machine_refresh_s: 10,
  gpu_every: 6,
  aliases: { enabled: true, delay_s: 4, names: ['factory', 'machine'] },
  default_level: 'medium',
  auto_open: true,
  refresh_s: 20,
  strips_refresh_s: 60,
  diagram: { enabled: false, width: 340, row_h: 22, max_rows: 40 },
  tree: { max_convs: 30, max_agents: 20, show_done_agents: true },
  qui_consomme: {
    presets: [{ id: '1h', label: '1 h', hours: 1 }, { id: 'today', label: 'aujourd’hui', since: 'midnight' }, { id: '7d', label: '7 j', hours: 168 }],
    default: 'today', top: 3, basis: 'cost', rescan_min: 10, data_dir: '', command: 'conso', args: 'classement',
  },
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
    // « Ouvrir l'agent »: $.ui.view({ agentId }) (engine 2.1.300+), only for a running agent of this conversation
    open_agent: 'Ouvrir l’agent',
    back_conv: '← Conversation',
    view_old: 'Ouvrir un agent demande Claude Code 2.1.300 ou plus récent (claude update)',
    view_denied: 'Agent non ouvert : {reason}',
    session: 'Session (5 h)',
    week_all: 'Semaine · tous modèles',
    week_fable: 'Semaine · Fable',
    credits: 'Crédits cloud',
    reset_in: 'reset dans {in}',
    reset_at: 'reset {at}',
    this_session: 'cette session',
    cache_hit: 'cache',
    sec_conv: 'Cette conversation',
    sec_conv_other: 'Conversation',
    sec_project: 'Ce projet',
    sec_all: 'Tous les projets',
    sec_global: 'Claude global',
    sec_conso: 'Qui consomme',
    conso_full: 'Classement complet',
    conso_none: 'pas encore de classement : ouvre /conso classement (le mod usage écrit classement.json)',
    conso_project: 'projet en tête',
    conso_missing: 'usage non chargé : ajoute mods/usage à CLAUDE_CODE_PLUGIN_DIRS',
    step: 'étape',
    no_pr: 'pas de PR',
    machine: 'Machine',
    machine_button: 'Onglet Machine',
    card_open: 'Voir',
    night_button: 'Nuit',
    day_button: 'Jour',
    codex_on: 'Codex ✓',
    codex_off: 'Codex',
    menu_missing: '{command} non chargé : ajoute son mod à CLAUDE_CODE_PLUGIN_DIRS',
    states: { working: 'en cours', julian: 'attend Julian', blocked: 'bloquée', done: 'terminée', idle: 'au repos', archived: 'archivée' },
    today: 'aujourd’hui',
    show_done: '+ {n} terminé(s)',
    hide_done: 'masquer les terminés',
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
// opts.convOnly: only the lead tree holding nav.conv (lead → sub-conversations → Workflows → agents), no project row,
// depth from 0: the « Cette conversation » section.
export function treeRows(nav, scan, cfg, nowMs, self, opts = {}) {
  const rows = []
  const add = (r) => rows.push(r)
  if (opts.convOnly) {
    if (!nav.repo || !nav.conv) return rows
    const forest = convForest(scan, nav.repo, cfg)
    const has = (n) => n.id === nav.conv || n.children.some(has)
    const root = forest.find(has)
    if (!root) return rows
    const sub = treeRows({ ...nav, level: nav.level === 'micro' ? 'micro' : 'medium' }, { ...scan }, cfg, nowMs, self, { only: root.id })
    return sub.filter((r) => r.kind !== 'project').map((r) => ({ ...r, depth: r.depth - 1 }))
  }
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
  walk(convForest(scan, nav.repo, cfg).filter((n) => !opts.only || n.id === opts.only), 1)
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

// The Galerie's Lanes: the project's conversations with what lanesView needs (worktree from cwd, PR, state, agents).
export function laneRows(scan, repo, cfg) {
  if (!scan || !repo) return []
  const states = ((screensConfig(cfg || {}).labels || {}).states) || {}
  return projectSessions(scan, repo).map((s) => {
    const st = sessionState(s, cfg || {}).state
    return { cli: s.cli, title: titleOf(s), cwd: s.cwd || '', branch: s.branch || '', live: Boolean(s.live), state: states[st] || st,
      last: tsMs(s.last_activity) || tsMs(s.mtime), subs: s.subs || [],
      pr: s.pr && s.pr.number ? { number: s.pr.number, state: (s.ci || {}).state || '?', ci: (s.ci || {}).ci || '?' } : null }
  })
}

// « Ouvrir l'agent »: only where the engine has $.ui.view (canView), for a running agent of this very conversation
// (the engine answers « ended » or « elsewhere » for the others).
export function canOpenAgent(card, self, canView) {
  return Boolean(canView && card && self && card.conv === self && card.status === 'running')
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

function creditsOf(spend, L, nowMs) {
  if (!spend || !Number.isFinite(spend.percentUsed)) return { available: false, text: L.not_readable }
  const num = (...ks) => { for (const k of ks) if (Number.isFinite(spend[k])) return spend[k]; return undefined }
  const used = num('usedUsd', 'amountUsed')
  const limit = num('limitUsd', 'amountLimit')
  const exp = Date.parse(spend.expiresAt || '')
  const reset = Date.parse(spend.resetsAt || '')
  const when = Number.isFinite(reset) ? (reset - nowMs < 24 * 3600000 ? fill(L.reset_in, { in: inText(reset - nowMs) }) : fill(L.reset_at, { at: atText(reset) })) : ''
  const amounts = Number.isFinite(used) && Number.isFinite(limit)
  return {
    available: true, pct: spend.percentUsed, used, limit, expiresAt: Number.isFinite(exp) ? exp : undefined, when,
    text: amounts ? `${Math.round(used)} $ / ${Math.round(limit)} $` : `${Math.round(spend.percentUsed)} %`,
  }
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
  // the engine's SessionRateLimit has kind / percentUsed / resetsAt only; amounts and an expiry are read when a later
  // engine adds them (usedUsd | amountUsed, limitUsd | amountLimit, expiresAt), never guessed
  const credits = creditsOf(spend, L, nowMs)
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

// ---- the four scoped sections: one-line summaries --------------------------------------------------------------------

// One conversation's status: model · effort, ctx, state, its agents (running / all), the running Workflow, the
// current step (last tool), its PR and CI.
export function convHead(scan, cli, cfg, nowMs) {
  const s = findSession(scan, cli)
  if (!s) return null
  const L = cockpitConfig(cfg).labels
  const st = sessionState(s, cfg)
  const a = agentNodes(scan, cli, cfg)
  const all = [...a.plain, ...a.workflows.flatMap((w) => w.children)]
  const wf = a.workflows.find((w) => w.state === 'running')
  const ci = s.ci || {}
  const d = scan && scan.detail && scan.detail.cli === cli ? scan.detail : s
  return {
    title: titleOf(s), model: short(s.app_model || s.model), effort: s.app_effort || s.effort || '?', ctxPct: ctxPct(s.ctx, cfg),
    state: st.state, stateLabel: (L.states || {})[st.state] || st.state, tone: STATE_TONE[st.state] || 'dim', reason: st.reason,
    agents: { running: all.filter((x) => x.state === 'running').length, total: all.length },
    workflow: wf ? wf.title : '', step: d.last_tool || '',
    pr: s.pr ? { number: s.pr.number, url: s.pr.url || '', state: ci.state || '?', ci: ci.ci || '?' } : null,
  }
}

export function convSummary(h, cfg) {
  if (!h) return ''
  const bits = [`${h.model} · ${h.effort}`, `ctx ${h.ctxPct} %`, h.stateLabel]
  if (h.agents.total) bits.push(`agents ${h.agents.running}/${h.agents.total}`)
  if (h.pr) bits.push(`PR #${h.pr.number}`)
  return bits.join(' · ')
}

// The project's line: « 4 conv · 1 en cours · $7.00 aujourd'hui »
export function projectSummary(p, cfg) {
  if (!p) return ''
  const L = cockpitConfig(cfg).labels
  const bits = [`${p.sessions} conv`]
  if (p.working) bits.push(`${p.working} ${L.states.working}`)
  if (p.julian) bits.push(`${p.julian} ${L.states.julian}`)
  if (p.blocked) bits.push(`${p.blocked} ${L.states.blocked}`)
  bits.push(`${fmtUsd(p.cost)} ${L.today}`)
  return bits.join(' · ')
}

// Every project: « 2 en cours · 3 au repos · 1 attend Julian · $424 »
export function allCounters(projects) {
  const sum = (k) => projects.reduce((a, p) => a + (p[k] || 0), 0)
  return { working: sum('working'), idle: sum('idle'), julian: sum('julian'), blocked: sum('blocked'), done: sum('done'), cost: sum('cost'), projects: projects.length }
}

export function allSummary(projects, cfg) {
  const L = cockpitConfig(cfg).labels
  const c = allCounters(projects)
  const bits = [`${c.working} ${L.states.working}`, `${c.idle} ${L.states.idle}`]
  if (c.julian) bits.push(`${c.julian} ${L.states.julian}`)
  if (c.blocked) bits.push(`${c.blocked} ${L.states.blocked}`)
  bits.push(fmtUsd(c.cost))
  return bits.join(' · ')
}

// A project's second line in « Tous les projets »: counters only, no prose.
export function projectLine(p, cfg) {
  const L = cockpitConfig(cfg).labels
  const bits = [`${p.sessions} conv`]
  if (p.working) bits.push(`${p.working} ${L.states.working}`)
  if (p.julian) bits.push(`${p.julian} ${L.states.julian}`)
  if (p.blocked) bits.push(`${p.blocked} ${L.states.blocked}`)
  if (p.workers) bits.push(`agents ${p.workers}`)
  if (p.maxCtxPct) bits.push(`ctx max ${p.maxCtxPct} %`)
  return bits.join(' · ')
}

// Claude global: « 5 h 24 % · sem 14 % · 2 alertes »
// « Qui consomme »: the top conversations and the top project of one preset, from the usage mod's classement.json
// (lib/usage/lib/classement.mjs rank, the same figures as /conso classement). null without data.
export function consoCard(data, cfg, nowMs, presetId) {
  if (!data || !Array.isArray(data.rows)) return null
  const q = cockpitConfig(cfg).qui_consomme
  const preset = q.presets.find((p) => p.id === presetId) || q.presets.find((p) => p.id === q.default) || q.presets[0]
  const basis = q.basis === 'tokens' ? 'tokens' : 'cost'
  const convs = rank(data, { now: nowMs, preset, group: 'conversation', top: q.top, basis })
  const proj = rank(data, { now: nowMs, preset, group: 'project', top: 1, basis })
  const p = proj.rows[0]
  return {
    preset, presets: q.presets, total: { tokens: tokensOf(convs.total), cost: convs.total[7] },
    rows: convs.rows.map((x) => ({ id: x.id, label: x.label, project: x.project, tokens: tokensOf(x.v), cost: x.v[7], pct: Math.round(100 * x.share) })),
    project: p ? { label: p.label, tokens: tokensOf(p.v), cost: p.v[7], pct: Math.round(100 * p.share) } : null,
    generated: data.generated || 0,
  }
}

export function consoSummary(card) {
  if (!card) return ''
  const bits = [`${card.preset.label} ${fmtUsd(card.total.cost)}`]
  if (card.rows[0]) bits.push(`${short(card.rows[0].label, 28)} ${card.rows[0].pct} %`)
  if (card.project) bits.push(`${card.project.label} ${card.project.pct} %`)
  return bits.join(' · ')
}

export function globalSummary(card, veille) {
  const bits = []
  if (card) for (const [w, k] of [[card.windows[0], '5 h'], [card.windows[1], 'sem']]) if (w && w.available) bits.push(`${k} ${Math.round(w.pct)} %`)
  if (veille) {
    const n = veille.alerts.filter((a) => !a.acked).length
    bits.push(n ? `${n} alerte(s)` : 'aucune alerte')
  }
  return bits.join(' · ')
}

// The tabs shown, in order: `order` filtered by `enabled`; unknown ids dropped; « home » always first.
export function tabsOf(cfg) {
  const c = cockpitConfig(cfg).tabs
  const ids = c.order.filter((t) => TABS.includes(t) && (t === 'home' || c.enabled.includes(t)))
  return (ids.includes('home') ? ids : ['home', ...ids]).map((id) => ({ id, label: (c.labels || {})[id] || id }))
}

// A tab id the pane can show: one of the tab bar, or the Nuit screen (opened by its button) while enabled.
export function tabValid(cfg, id) {
  const c = cockpitConfig(cfg).tabs
  const dep = (cfg && cfg.depuis) || {}
  if (id === 'panneau') return !(cfg && cfg.panel && cfg.panel.enabled === false)
  return tabsOf(cfg).some((t) => t.id === id) || (id === 'nuit' && c.enabled.includes('nuit')) || (id === 'depuis' && dep.enabled !== false)
}

// The menu's layout at a width: {position: left|top|off, items, width}.
export function menuOf(cfg, columns) {
  const m = cockpitConfig(cfg).menu || {}
  const items = (m.items || []).filter((x) => x && x.label && (x.self || x.command))
  if (m.position === 'off' || !items.length) return { position: 'off', items: [], width: 0 }
  const left = m.position === 'left' && (!columns || columns >= (Number(m.min_columns) || 0))
  return { position: left ? 'left' : 'top', items, width: left ? Math.max(8, Number(m.width) || 12) : 0 }
}

// The folders whose handoff/ROADMAP.md and packets « Bilan avant la nuit » reads: the recent conversations' folders
// (not archived, active in the last recent_days) and day_night.repos.
export function nightRepos(scan, cfg, nowMs) {
  const c = cockpitConfig(cfg).day_night || {}
  const since = nowMs - (Number(c.recent_days) || 7) * 86400000
  const out = []
  for (const s of (scan && scan.sessions) || []) {
    if (s.archived) continue
    if (tsMs(s.last_activity) < since) continue
    const p = String(s.origin || s.cwd || '').replace(/\\/g, '/')
    if (p) out.push(p)
  }
  for (const p of c.repos || []) if (p) out.push(String(p))
  return [...new Set(out)]
}

const TAB_WORDS = {
  panneau: 'panneau', panel: 'panneau', un: 'panneau',
  home: 'home', accueil: 'home', cartes: 'home', cockpit: 'home',
  mission: 'mission', focus: 'focus', arbre: 'arbre', tree: 'arbre', pipeline: 'pipeline', journal: 'journal',
  workflow: 'workflow', workflows: 'workflow', wf: 'workflow',
  machine: 'machine', systeme: 'machine', 'système': 'machine', system: 'machine',
  depuis: 'depuis', since: 'depuis', matin: 'depuis', reveil: 'depuis', 'réveil': 'depuis', resume: 'depuis', 'résumé': 'depuis',
  nuit: 'nuit', night: 'nuit', bilan: 'nuit', relais: 'relais', codex: 'relais', galerie: 'galerie', gallery: 'galerie', vues: 'galerie',
}
const LEVEL_WORDS = { mega: 'mega', 'méga': 'mega', macro: 'macro', projet: 'macro', project: 'macro', medium: 'medium', conversation: 'medium', conv: 'medium', micro: 'micro', agent: 'micro' }
const SCOPE_WORDS = { all: 'all', tout: 'all', toutes: 'all', conv: 'conversation', conversation: 'conversation' }

/**
 * "/cockpit [level|tab] [rest]" -> {level, tab, scope, rest, close}. A level opens the « Cockpit » tab at that zoom;
 * a tab word opens that tab (« workflow all » = every Workflow of the PC); the rest names a project or a conversation.
 */
export function parseArgs(args) {
  const words = String(args || '').trim().split(/\s+/).filter(Boolean)
  const w0 = (words[0] || '').toLowerCase()
  if (w0 === 'close' || w0 === 'fermer') return { close: true, level: null, tab: null, scope: null, rest: '' }
  const level = LEVEL_WORDS[w0] || null
  const tab = level ? 'home' : TAB_WORDS[w0] || null
  let rest = words.slice(level || tab ? 1 : 0)
  let scope = null
  if (tab === 'workflow' && rest[0] && SCOPE_WORDS[rest[0].toLowerCase()]) { scope = SCOPE_WORDS[rest[0].toLowerCase()]; rest = rest.slice(1) }
  return { close: false, level, tab, scope, rest: rest.join(' ') }
}

/**
 * The old commands, kept as aliases while their mod is not loaded: /factory [tab] [...] and /machine [...] as cockpit
 * args. factory's quotas tab -> home (the Quota card), systeme -> machine.
 */
export function aliasArgs(name, args) {
  const q = String(args || '').trim()
  if (name === 'machine') return /^close$/i.test(q) ? 'close' : 'machine'
  const [w, ...more] = q.split(/\s+/).filter(Boolean)
  const lw = (w || '').toLowerCase()
  if (!lw) return 'mission'
  if (lw === 'quotas') return 'home'
  return [lw === 'systeme' || lw === 'système' ? 'machine' : lw, ...more].join(' ')
}

// Which section a click opens: a project its « Ce projet », a conversation, workflow or agent « Cette conversation ».
export function sectionFor(node) {
  return !node ? null : node.kind === 'project' ? 'project' : 'conv'
}

export { hhmm, fmtTokens, fmtUsd, short, effortBars, titleOf, repoOf, tokensOf }
