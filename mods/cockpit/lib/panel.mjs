// cockpit « Panneau » - the default view: ONE scrolling column, no tabs (Julian, 17 Oct: « trop d'écrans », then no tab
// bar at all); the old views are reached by their /cockpit commands only, listed in one grey line at the bottom.
// Drawn in the style of Claude's own Usage and Background-tasks panes (Julian, 17 Oct 18:10): cards with a bold title,
// rows « label … grey detail  bold % » over a thin bar, small stats grids, phases with ■□ dots; no box-drawing borders.
//   1. Fichiers                       data-goblin's file tree, embedded, FOLDED by default (hooks/files.mjs)
//   2. Cette conversation             a Usage-like card for the lead (model · effort, context bar with the 250 k mark,
//                                     cost, tokens, cache hit, % sub-agents, models, what contributes), then one
//                                     Background-tasks-like card per Workflow / background agents, finished ones
//                                     folded into « Terminés N › », the session log (lib/panel_conv.mjs)
//   3. Toutes les conversations       compact rows (dot, title, tokens, bar, %) + filters, Workflows actifs
//   4. Barres                         Session 5 h, Semaine, Codex, crédits as Usage rows over bars; tok/s
//   4b. Débit                         tokens per second, one card per model (30 min, 1 j, 7 j, 30 j), last streams (lib/debit.mjs)
//   5. Graphe des conversations       who waits, works, coordinates, by project like the sidebar (lib/graphe.mjs, hooks/graphe_view.mjs)
// Pure: no $, no I/O (node --test mods/cockpit/tests/panel.test.mjs). Every label and limit comes from `panel` in
// cockpit.config.json (deep-merged over PANEL_DEFAULTS).
import { rank, codexTokens, windowOf } from './usage/lib/classement.mjs'
import { tokensOf } from './usage/lib/transcripts.mjs'
import { sessionState } from './factory/hooks/screens.mjs'
import { repoOf } from './factory/hooks/logic.mjs'

export const PANEL_SECTIONS = ['fichiers', 'conv', 'convs', 'barres', 'debit', 'graphe']

export const PANEL_DEFAULTS = {
  enabled: true,
  order: PANEL_SECTIONS,
  // which sections start unfolded (the viewer's own choice is then kept in $.store); Fichiers starts folded (Julian, 17 Oct)
  open: ['conv', 'convs', 'barres', 'debit', 'graphe'],
  // the state marks of « Toutes les conversations », the graph and its legend, one set (Julian, 18 Oct: « travaille » and
  // « t'attend » both looked orange): glyph + tone, a tone being a theme colour of the engine (cockpit term_colors:
  // ok = success green, warn = warning amber, bad = error red, dim = inactive grey)
  marks: {
    working: { glyph: '●', tone: 'ok' }, waiting: { glyph: '◆', tone: 'warn' }, blocked: { glyph: '✕', tone: 'bad' },
    done: { glyph: '✓', tone: 'dim' }, idle: { glyph: '○', tone: 'dim' }, archived: { glyph: '·', tone: 'dim' },
    // a running Workflow / agent that wrote nothing for conv.stall_min minutes (Julian, 18 Oct: « au repos » next to a
    // phase running for 1h10m): « bloquée ? », amber
    stalled: { glyph: '✕', tone: 'warn' },
  },
  // the look: bar_px = px per column of a bar drawn as Svg (desktop); bar_cells = cells of the short bars of a compact row
  // (narrow under wide_cols columns, wide above); finished_open = « Terminés N › » starts unfolded; workflow_open = a
  // Workflow card starts unfolded (false: Claude's mini card, name › / Workflow  N agents  time / one dot per agent);
  // dot_tones = the tone of each agent dot (Claude's pane: grey done, amber running); dots_max = dots on one row
  style: {
    bar_px: 7, bar_cells: 6, bar_cells_wide: 10, wide_cols: 60, ctx_cells: 4, finished_open: false, workflow_open: false,
    dot_done: '■', dot_running: '■', dot_pending: '□', dot_tones: { done: 'dim', running: 'warn', failed: 'bad' }, dots_max: 60,
    bar_full: '▰', bar_empty: '▱', bar_mark: '|',
  },
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
    // short: the label when the filter row would not fit on one line (a 45-column pane)
    periods: [{ id: '1h', label: '1 h', hours: 1 }, { id: 'today', label: 'aujourd’hui', short: 'auj.', since: 'midnight' }, { id: '7d', label: '7 j', hours: 168 }],
    period: 'today',
    top: 15,
    basis: 'tokens',
    who: 'claude',
    // the scan's states grouped in three: en cours, t'attend (waiting on Julian or blocked), terminée (the rest)
    states: { working: 'running', julian: 'waiting', blocked: 'waiting', stalled: 'waiting', done: 'done', idle: 'done', archived: 'done' },
    last_max: 90,
    // each conversation row of « Toutes les conversations » and of the graph unfolds UNDER itself to its own factory
    // (lead card, Workflow cards, background agents, Terminés N ›), drawn as « Cette conversation » (Julian, 18 Oct).
    // The active ones (travaille, attend, a running Workflow or agent) start unfolded, at most unfold_max of them (the
    // engine unmounts a tree past 100,000 serialized characters or 20,000 nodes); the viewer's own folds always win.
    unfold_max: 6,
  },
  // « Cette conversation »: agents_max per card, log_max = events of the session log, contributors = rows of « Ce qui
  // contribue »; stall_min = a running Workflow / agent with no journal or transcript write for that long is « à l'arrêt ? »
  // and its conversation « bloquée ? » (written recently: the conversation « travaille »); compact_tokens = a conversation
  // with no Workflow nor agent and fewer tokens draws two lines (model · effort · state, context inline) until « détails »
  conv: { agents_max: 12, log_max: 6, contributors: 3, stall_min: 30, compact_tokens: 100000 },
  // the lead's context bar: the hand-off threshold (tokens; ~/.claude/CLAUDE.md §4: 250 K); window: null = the effective
  // window (CLAUDE_CODE_AUTO_COMPACT_WINDOW when set, else the engine's, else factory's context_window), the same for every
  // conversation; bar_width = cells of the text bar (a surface without Svg)
  contexte: { handoff_tokens: 250000, window: null, bar_width: 40 },
  barres: { width: 140, workflows_max: 8, agents_max: 12 },
  // 5. Graphe des conversations (lib/graphe.mjs): period = default time filter (24h | 7j | tout); working_min = minutes
  // since the last activity (app's lastActivityAt or the transcript's mtime, the latest) under which a conversation
  // « travaille » (so does one with a running Workflow or background agent); done_min = « finie » only after that many
  // idle minutes and with nothing running; coord_match = a title that makes a coordinator (as
  // does having spawned ≥ 1 session); wait_max_h = « À toi de cliquer » ignores older waits; max_rows = lines over all
  // groups; session_link opens a conversation in the app (the same link as « Depuis »)
  graphe: {
    period: '24h', working_min: 2, done_min: 10, coord_match: '(^|[^A-Za-z])(PM|COORD[A-Z]*|VEILLE|ARCHI|MODS)([^A-Za-z]|$)', wait_max_h: 168,
    max_rows: 60, reason_max: 60, peers_max: 2, peer_title_max: 24, refresh_s: 60,
    session_link: 'claude://claude.ai/epitaxy/{id}',
  },
  labels: {
    panneau: 'Panneau',
    fichiers: 'Fichiers',
    conv: 'Cette conversation',
    contexte: 'Contexte de cette conversation',
    convs: 'Toutes les conversations',
    graphe: 'Graphe des conversations',
    graphe_slot: 'lecture des sessions…',
    graphe_click: 'À toi de cliquer',
    graphe_click_none: 'rien ne t’attend',
    graphe_wait_line: '{reason} · depuis {age}',
    graphe_reason_awaiting: 'tour interrompu, attend une personne',
    graphe_reason_ask: 'question ouverte',
    // the legend: one short line of the state marks (panel.marks), folded behind « Légende › » when the pane is narrower
    graphe_legend: { working: 'travaille', waiting: 'attend', blocked: 'bloquée', done: 'finie', idle: 'inactive' },
    graphe_legend_fold: 'Légende',
    graphe_states: { working: 'travaille', waiting: 't’attend', blocked: 'bloquée', done: 'finie', idle: 'inactive depuis {age}', archived: 'archivée' },
    graphe_roles: { coord: 'coordinateur', lane: 'lane', agent: 'agent' },
    // the grey mark after the title on the one-line row (only a coordinator has one)
    graphe_role_marks: { coord: 'coord' },
    graphe_tokens: '{tokens} tok auj.',
    graphe_ctx: 'ctx {pct} %',
    graphe_here: '(ici)',
    graphe_from: '↖ lancée par {title}',
    graphe_peer: '⇢ {title}',
    graphe_project: 'Projet',
    graphe_all_projects: 'tous',
    graphe_active: 'Actives',
    graphe_periods: { '24h': '24 h', '7j': '7 j', tout: 'tout' },
    graphe_archived: 'Archivées',
    graphe_group: '{name} · {n}',
    graphe_none: 'aucune conversation avec ces filtres',
    graphe_hidden: '… {n} de plus (filtre par projet)',
    graphe_sum_waiting: '{n} t’attend(ent)',
    graphe_sum_working: '{n} travaille(nt)',
    graphe_sum_blocked: '{n} bloquée(s)',
    barres: 'Barres',
    // Débit (lib/debit.mjs): one card per model, a row per window, then the last streams
    debit: 'Débit',
    debit_model: 'Modèle : {model}',
    debit_cols: { window: 'Fenêtre', n: 'Réponses', tokens: 'Tokens', time: 'Temps', tps: 'TPS pondéré', median: 'Médiane', range: 'Plage' },
    // the headers when even without Plage and Temps the table is wider than the pane
    debit_cols_short: { window: '', n: 'Rép.', tokens: 'Tok.', time: 'Temps', tps: 'TPS', median: 'Méd.', range: 'Plage' },
    debit_recent: '{n} derniers flux',
    debit_stream: '{time}  {model}{effort} :',
    debit_stream_tail: '({tokens} tok en {secs})',
    debit_none: 'aucune réponse mesurée sur 30 jours',
    debit_no_file: 'pas encore lu : le mod usage écrit debit.json à son prochain scan',
    debit_codex_unread: 'Codex : non lu',
    debit_hidden: '… {n} modèle(s) de plus',
    debit_note: 'Temps d’une réponse = de la dernière ligne du transcript qui l’envoie (prompt ou résultat d’outil) à son dernier bloc : attente du 1er token comprise. Tokens = tokens de sortie, réflexion comprise ; une réponse comptée une fois (message.id + requestId) ; moins de 50 tokens ou plus de 30 min exclues. TPS pondéré = somme des tokens ÷ somme des temps. 30 min : réponses exactes ; 1 j, 7 j, 30 j : heures d’horloge entières, médiane et plage à ±7 %. Vert : au-dessus de la médiane 1 j du modèle.',
    debit_codex_note: 'Codex : du task_started ou de la dernière sortie d’outil au token_usage_record de la réponse ; 1 j, 7 j, 30 j par jour local entier (jours gardés par le mod usage).',
    other_views: 'Autres vues : /cockpit {list}',
    lead: 'Lead',
    background: 'Agents en arrière-plan',
    workflow: '{name}',
    kind_workflow: 'Workflow',
    kind_background: 'Agents',
    layer_count: '{n} agents',
    layer_tokens: '{tokens} tokens',
    layer_eta: 'fin vers {time}',
    phases: 'Phases',
    phase_default: 'Agents',
    finished: 'Terminés {n}',
    ctx_label: 'Contexte',
    ctx_detail: '{tokens} / {window} · relais {threshold}',
    stat_cost: 'Coût',
    stat_tokens: 'Tokens',
    stat_cache: 'Cache hit',
    stat_subs: 'Sous-agents',
    stat_agents: 'Agents',
    stat_tps: 'tok/s',
    models: 'Modèles',
    contributing: 'Ce qui contribue',
    agent_states: { running: 'en cours', done: 'terminé', failed: 'échec', stopped: 'arrêté' },
    no_layer: 'aucun Workflow ni agent dans cette conversation',
    lead_working: 'travaille',
    lead_stalled: 'bloquée ?',
    card_stalled: 'à l’arrêt ? rien d’écrit depuis {age}',
    stalled: 'bloquée ?',
    details: 'détails',
    ctx_inline: 'ctx {pct} % · {tokens} / {window}',
    handoff_mark: '⚠',
    log: 'Journal de la session',
    log_none: 'rien encore',
    ev_start: '▶ {agent} démarré',
    ev_done: '✓ {agent} terminé',
    ev_failed: '✗ {agent} en échec',
    ev_pr_open: 'PR #{n} ouverte',
    ev_pr_merged: 'PR #{n} mergée',
    ctx_tokens: '{tokens} / {window} tokens',
    ctx_left: 'seuil de relais {threshold} · reste {left}',
    ctx_over: 'seuil de relais {threshold} dépassé : passe le relais (handoff)',
    ctx_none: 'contexte non lu',
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
    five: 'Session 5 h',
    week: 'Semaine',
    credits: 'Crédits cloud',
    credits_amount: '{used} $ sur {limit} $',
    credits_expire: 'expire le {at}',
    credits_no_amount: 'montant non lu',
    col_model: 'Modèle',
    col_time: 'Temps',
    months: ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'],
    codex_week: 'Codex semaine',
    tps_all: 'tok/s toutes conv',
    unknown: 'non lu',
    workflows: 'Workflows actifs',
    no_workflows: 'aucun Workflow en cours',
    agents: '{n} agent(s)',
    no_tree: 'aucun agent dans cette conversation',
    // a conversation row: its title (or arrow) unfolds its factory; this button opens it in the app (short: narrow pane)
    open_conv: 'ouvrir ↗',
    open_conv_short: '↗',
    conv_no_factory: 'fabrique non lue (hors de la fenêtre du scan)',
    project_short: 'Proj.',
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
  // an order written before Barres was its own section (with « contexte », now in the lead's card) gets « barres »
  // back after « convs »
  let order = (p.order || []).filter((s) => PANEL_SECTIONS.includes(s))
  if ((p.order || []).includes('contexte') && !order.includes('barres')) {
    const i = order.indexOf('convs')
    order = i < 0 ? [...order, 'barres'] : [...order.slice(0, i + 1), 'barres', ...order.slice(i + 1)]
  }
  // an order written before Débit gets it back right after « barres » (Julian, 18 Oct)
  if (!order.includes('debit')) {
    const i = order.indexOf('barres')
    order = i < 0 ? order : [...order.slice(0, i + 1), 'debit', ...order.slice(i + 1)]
  }
  p.order = order
  return p
}

/** The old views, reached by their /cockpit command only: one grey line at the bottom of the Panneau. */
export function otherViews(tabs, extra, cfg) {
  const L = panelConfig(cfg).labels
  const word = { home: 'cartes' }
  const ids = [...new Set([...(tabs || []).map((t) => t.id), ...(extra || [])])].filter((id) => id !== 'panneau')
  return ids.length ? fill(L.other_views, { list: ids.map((id) => word[id] || id).join(' · ') }) : ''
}

export const kTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n || 0)))

/**
 * A thin text bar for a surface without Svg: `cells` cells, ▰ used, ▱ free, `mark` (0..100) drawn as the style's mark
 * (the hand-off threshold of the context bar). Characters from panel.style.
 */
export function textBar(pct, cells, cfg, mark = null) {
  const st = panelConfig(cfg).style
  const w = Math.max(3, Math.round(cells) || 10)
  const full = Math.round((Math.max(0, Math.min(100, Number(pct) || 0)) / 100) * w)
  const m = mark === null || mark === undefined ? -1 : Math.min(w - 1, Math.round((mark / 100) * w))
  return [...Array(w)].map((_, i) => (i === m ? st.bar_mark : i < full ? st.bar_full : st.bar_empty)).join('')
}

/** A duration the way Claude's Background-tasks pane writes it: « 6h 54m 13s », « 4m 02s », « 12s ». */
export function durText(ms, short = false) {
  const t = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const p2 = (n) => String(n).padStart(2, '0')
  // short: the mini card's « 6h 56m » (seconds only under an hour)
  if (short && h) return `${h}h ${p2(m)}m`
  return h ? `${h}h ${p2(m)}m ${p2(s)}s` : m ? `${m}m ${p2(s)}s` : `${s}s`
}

/** A date as Claude's Usage pane writes an expiry: « 5 nov 08:59 ». */
export function dayText(ms, cfg) {
  const d = new Date(ms)
  const M = panelConfig(cfg).labels.months || []
  return `${d.getDate()} ${M[d.getMonth()] || d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * The lead's context: usage: $.session.usage() (its context, when the engine gives it); ctxTokens: the scan's context
 * of this conversation; fwin: factory's context_window; auto: CLAUDE_CODE_AUTO_COMPACT_WINDOW (effectiveWindow()).
 * -> { known, pct, tokens, window, threshold, markPct, over, bar, text, detail, note }. bar: the text bar with the
 * hand-off threshold marked; the Svg one is drawn from pct and markPct.
 */
export function contexteOf({ usage, ctxTokens, fwin, auto }, cfg) {
  const c = panelConfig(cfg)
  const L = c.labels
  const q = c.contexte
  const u = (usage && usage.context) || {}
  const window = effectiveWindow(cfg, auto, u.window, fwin)
  const threshold = Number(q.handoff_tokens) || 250000
  const tok = [u.tokens, u.usedTokens, u.used, ctxTokens].find((x) => Number.isFinite(x) && x > 0)
  // tokens over the effective window first: the engine's percent is against its own window
  const pct = Number.isFinite(tok) ? (100 * tok) / window : Number.isFinite(u.percent) && !Number(auto) && !Number(q.window) ? u.percent : null
  const markPct = Math.min(100, (100 * threshold) / window)
  if (pct === null) return { known: false, pct: null, tokens: null, window, threshold, markPct, over: false, bar: '', text: L.ctx_none, detail: '', note: '' }
  const tokens = Number.isFinite(tok) ? tok : Math.round((pct / 100) * window)
  const over = tokens >= threshold
  return {
    known: true, pct, tokens, window, threshold, markPct, over,
    bar: textBar(pct, Math.max(10, Number(q.bar_width) || 40), cfg, markPct),
    text: `${Math.round(pct)} % · ${fill(L.ctx_tokens, { tokens: kTok(tokens), window: kTok(window) })}`,
    detail: fill(L.ctx_detail, { tokens: kTok(tokens), window: kTok(window), threshold: kTok(threshold) }),
    note: over ? fill(L.ctx_over, { threshold: kTok(threshold) }) : fill(L.ctx_left, { threshold: kTok(threshold), left: kTok(threshold - tokens) }),
  }
}

/**
 * The context window every conversation is measured against (Julian, 18 Oct: this one read « / 1.0M », the others
 * « / 400K »): panel.contexte.window, else CLAUDE_CODE_AUTO_COMPACT_WINDOW (auto) when set, else the engine's, else
 * factory's context_window, else 400 K.
 */
export function effectiveWindow(cfg, auto, engine, fwin) {
  return Number(panelConfig(cfg).contexte.window) || Number(auto) || Number(engine) || Number(fwin) || 400000
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

// ---- a running Workflow / agent that stopped writing ------------------------------------------------------------------

const msOf = (v) => (!v ? 0 : typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(v) || 0)

/**
 * The last write of a set of agents (factory's Workflow screen agents: start, end, idle = ms since their transcript's
 * last line; or the scan's subs: ts, last_ts). 0 when nothing is known.
 */
export function lastProgress(agents, nowMs) {
  let t = 0
  for (const a of agents || []) {
    if (!a) continue
    const idle = Number.isFinite(a.idle) ? nowMs - a.idle : 0
    t = Math.max(t, idle, msOf(a.last_ts), msOf(a.end), msOf(a.start), msOf(a.ts))
  }
  return t
}

/**
 * Is a conversation's running work moving? session: its scan row (subs); runs: factory's Workflow screen runs.
 * -> null (nothing running) | { state: 'working' | 'stalled', lastAt, stalledMs }. Each live Workflow run and the running
 * agents outside one are groups; the conversation works when one group wrote within conv.stall_min minutes, else it is
 * « bloquée ? ». A group whose progress is unknown counts as working.
 */
export function liveness(session, runs, cli, nowMs, cfg) {
  const lim = Math.max(1, Number(panelConfig(cfg).conv.stall_min) || 30) * 60000
  const subs = ((session && session.subs) || []).filter(Boolean)
  const live = (runs || []).filter((r) => r && r.live && r.cli === cli)
  const groups = []
  for (const r of live) {
    const ids = new Set((r.agents || []).map((a) => a.id))
    groups.push(lastProgress([...(r.agents || []), ...subs.filter((a) => ids.has(a.id) || a.workflow === r.id)], nowMs))
  }
  const liveIds = new Set(live.map((r) => r.id))
  const byWf = new Map()
  for (const a of subs) {
    if (a.status !== 'running' || liveIds.has(a.workflow)) continue
    const k = a.workflow || ''
    byWf.set(k, [...(byWf.get(k) || []), a])
  }
  for (const list of byWf.values()) groups.push(lastProgress(list, nowMs))
  if (!groups.length) return null
  const fresh = groups.some((t) => !t || nowMs - t <= lim)
  const lastAt = Math.max(...groups)
  return { state: fresh ? 'working' : 'stalled', lastAt, stalledMs: lastAt ? nowMs - lastAt : 0 }
}

/**
 * The scan state corrected by liveness(): an idle or done conversation whose Workflow / agents run « travaille » when
 * they wrote recently, else is « bloquée ? » (stalled). A wait on Julian, a block or an archive stay as they are.
 */
export function liveState(st, live) {
  if (!live || !['idle', 'done', 'working'].includes(st)) return st
  if (st === 'working') return st
  return live.state === 'stalled' ? 'stalled' : 'working'
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

/** A scan state (factory's sessionState) as one of panel.marks: working | waiting | blocked | done | idle | archived. */
export function markOf(state) {
  return { working: 'working', julian: 'waiting', blocked: 'blocked', stalled: 'stalled', done: 'done', idle: 'idle', archived: 'archived' }[state] || 'idle'
}

const clipText = (t, n) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s
}

/**
 * The synthesis table. data: usage's classement.json; scan: factory's scan (state, last line, project of the
 * conversations it knows); codex: usage's codex.json. f: { period, project, state, who, runs }. runs: factory's
 * Workflow screen runs: an idle conversation whose Workflow runs « travaille », or « bloquée ? » when it stopped writing
 * (liveness()). A row past the hand-off threshold (the scan's ctx) gets over: true.
 * Returns { rows, others, total, projects, period, periods, tps, hasData }.
 * rows: [{ id, label, project, state, mark (panel.marks key), stateLabel, tokens, cost, tps, last }], biggest consumer first (basis).
 */
export function synthesis(data, scan, codex, f, cfg, nowMs) {
  const c = panelConfig(cfg)
  const q = c.convs
  const L = c.labels
  const period = q.periods.find((p) => p.id === f.period) || q.periods.find((p) => p.id === q.period) || q.periods[0]
  const who = f.who || q.who
  const base = { rows: [], others: null, total: { tokens: 0, cost: 0 }, projects: [], period, periods: q.periods, tps: null, tpsById: {}, hasData: Boolean(data && Array.isArray(data.rows)) }
  if (who === 'codex') {
    const tz = (data && data.tzMin) || 0
    const n = codexTokens(codex, windowOf(period, nowMs, tz), tz)
    if (n === undefined) return { ...base, hasData: false }
    return { ...base, hasData: true, rows: n ? [{ id: 'codex', label: L.codex_row, project: '', state: 'done', mark: 'done', stateLabel: '', tokens: n, cost: null, tps: null, last: '' }] : [], total: { tokens: n, cost: null } }
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
    const st = s ? liveState(sessionState(s, f.fcfg || {}).state, f.runs ? liveness(s, f.runs, x.id, nowMs, cfg) : null) : 'done'
    const g = stateGroup(st, cfg)
    return {
      id: x.id, sid: (s && s.sid) || '', label: x.label, project: (s && repoOf(s)) || x.project || '?', state: g,
      stateLabel: st === 'stalled' ? L.stalled : L.states[g] || g, mark: s ? markOf(st) : 'idle',
      over: Boolean(s && Number(s.ctx) >= (Number(c.contexte.handoff_tokens) || 250000)),
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
  return { ...base, rows, others, total: sum(kept), projects, tps, tpsById: Object.fromEntries(tpsOf) }
}

// ---- a conversation's factory under its row (« Toutes les conversations », graph) ---------------------------------------

/** The fold key of a conversation row, shared by both lists: folding it in one folds it in the other. */
export const convKey = (cli) => 'cv:' + cli

/**
 * The conversations that count as active: the graph's travaille / attend lines (its À toi de cliquer included), and
 * from the scan a live transcript, a running sub-agent, a wait on Julian, a live Workflow run. -> Set of cli.
 */
export function activeClis({ scan, runs, graphe }, fcfg, nowMs) {
  const out = new Set()
  if (graphe && graphe.ready) {
    for (const g of graphe.groups || []) for (const l of g.lines || []) if (l.state === 'working' || l.state === 'waiting') out.add(l.key)
    for (const w of graphe.waiting || []) out.add(w.key)
  }
  for (const s of (scan && scan.sessions) || []) {
    if (!s.cli || s.archived) continue
    const st = sessionState(s, fcfg || {}).state
    if (s.live || st === 'working' || st === 'julian' || (s.subs || []).some((a) => a && a.status === 'running')) out.add(s.cli)
  }
  for (const r of runs || []) if (r && r.live && r.cli) out.add(r.cli)
  return out
}

/**
 * Which conversation rows draw their factory unfolded. order: the clis in the order they are drawn (Toutes les
 * conversations, then the graph); active: activeClis(); closed: the viewer's folds ({ 'cv:<cli>': true } folded,
 * false unfolded); self: this conversation (already drawn in « Cette conversation », folded unless asked).
 * The viewer's choice always wins; by default the active ones unfold, the first unfold_max of them. -> Set of cli.
 */
export function unfoldPlan(order, active, closed, self, cfg) {
  const max = Math.max(0, Number(panelConfig(cfg).convs.unfold_max) || 0)
  const out = new Set()
  let n = 0
  for (const cli of [...new Set(order || [])]) {
    const k = convKey(cli)
    if (closed && closed[k] !== undefined) { if (!closed[k]) out.add(cli); continue }
    if (cli === self || !(active && active.has(cli)) || n >= max) continue
    out.add(cli)
    n++
  }
  return out
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
 * tps: tok/s of all conversations (synthesis().tps); codex: the table's « Codex » toggle is on (adds Codex semaine);
 * card: nav.usageCard(...) when known (its reset texts and the credits, shown only when the engine reads them).
 * Credits read like Claude's Usage pane, « Crédits cloud … 249 $ sur 250 $ » and a grey « expire le 5 nov 08:59 »
 * under the bar, when the engine gives the amounts; the engine's SessionRateLimit has only kind / percentUsed /
 * resetsAt today, so the row shows the % with a grey « montant non lu » (and the reset under it when known).
 * -> [{ id, label, pct (0..100) | null, text, detail, under }]
 */
export function barsOf({ usage, quotas, tps, codex, card }, cfg) {
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
  const when = (i) => (card && card.windows && card.windows[i] && card.windows[i].when) || ''
  const k = card && card.credits && card.credits.available ? card.credits : null
  const cr = k ? k.pct : null
  const money = (v) => (Math.round(v * 100) % 100 ? v.toFixed(2) : String(Math.round(v)))
  const amounts = k && Number.isFinite(k.used) && Number.isFinite(k.limit)
  const credits = k ? {
    id: 'credits', label: L.credits, pct: cr,
    text: amounts ? fill(L.credits_amount, { used: money(k.used), limit: money(k.limit) }) : pctText(cr),
    detail: amounts ? '' : L.credits_no_amount,
    under: Number.isFinite(k.expiresAt) ? fill(L.credits_expire, { at: dayText(k.expiresAt, cfg) }) : k.when || '',
  } : null
  return [
    { id: 'five', label: L.five, pct: five, text: pctText(five), detail: when(0) },
    { id: 'week', label: L.week, pct: week, text: pctText(week), detail: when(1) },
    codex ? { id: 'codex_week', label: L.codex_week, pct: cx, text: pctText(cx), detail: '' } : null,
    credits,
    { id: 'tps', label: L.tps_all, pct: null, text: Number.isFinite(tps) && tps !== null ? `${Math.round(tps)} ${L.tps}` : L.unknown, detail: L.tps_hint },
  ].filter(Boolean)
}

/** The running Workflows of factory's Workflow screen (workflowScreen(...).runs), each with its agents. */
export function activeWorkflows(screen, cfg) {
  const b = panelConfig(cfg).barres
  return ((screen && screen.runs) || []).filter((v) => v.live).slice(0, b.workflows_max).map((v) => {
    const agents = (v.agents || []).slice().sort((a, b2) => (b2.status === 'running') - (a.status === 'running'))
    return {
      key: 'wf:' + (v.id || v.name), name: v.name, count: agents.length, running: agents.filter((a) => a.status === 'running').length,
      tokens: agents.reduce((x, a) => x + (a.tokens || 0), 0),
      agents: agents.slice(0, b.agents_max).map((a) => ({ id: a.id, label: a.label || a.type || a.id, type: a.type, model: a.model, effort: a.effort || '', status: a.status, tokens: a.tokens || 0 })),
      hidden: Math.max(0, agents.length - b.agents_max),
    }
  })
}

export { HOUR }
