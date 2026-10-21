// cockpit « Panneau » - draws the default view: ONE scrolling column, no tab bar. Since 19 Oct it opens on a MACRO view
// (Julian: « all the good info but hard to read; a macro view where I see everything quickly, a micro view when I
// click »): one line per conversation and one line per Workflow under it (├ / └), one line each for the quotas, the
// tokens per second and the graph. Every detail of the earlier cards is still there, one click away (› / ⌄, kept in
// $.store): the lead's Usage-like card, the stats grid, « Ce qui contribue », the session log, the phases and their
// « Modèle | Temps » tables, the bars, the Débit tables, the graph.
//   À toi de cliquer           one amber line at the very top while a conversation waits for Julian, nothing otherwise
//   ▸ Fichiers                 filetree's tree (hooks/files.mjs), folded by default
//   CETTE CONVERSATION         a one-root tree (since 19 Oct, Julian's « project structure » poster):
//                                └──── ● title                                 ›
//                                      │ ctx ▰▰▰▱ 30 % · $9.50 · 1 wf · 1 agent en cours
//                                      │
//                                      └──── ● name · workflow                 ›
//                                                1/4 ■●□□ · phase · 1 agent en cours · 20 min · fin ~16:55
//   CONVERSATIONS · N actives  the same tree: conversation → sub-conversations → Workflows → agents (filtres ›)
//   QUOTAS                     5 h ▰▰▱ 21 % · reset …  sem ▰▰▰▰ 85 %  852 tok/s  ›   (› the Usage-like bars)
//   DÉBIT                      opus 59 · sonnet 88 TPS (30 min)  tableau ›   (› one table per model, the last streams)
//   GRAPHE                     6 conv · 1 coord · rien ne t'attend  ›   (› filters, projects → conversations)
//   then one grey line, cut: the old views and their /cockpit commands
// Colours: one state colour per line (its mark: ● travaille green, ◆ t'attend amber, ✕ bloquée red, ⚠ à l'arrêt amber,
// ✓ / ○ grey); a number is bold and coloured only when it is alarming (context at style.ctx_warn_pct amber, past the
// hand-off red with ⚠, a quota at 80 % amber, 90 % red); the rest is grey or plain. At 45, 60 or 75 columns a node line
// cuts its title, its metrics line drops the ETA, then the model, then the bar; a number is never cut.
// Pure except for the kit `h` and the callbacks in P.act.
import { panelConfig, fill, textBar, durText, kTok, convKey, markOf, minText, modelShort } from '../lib/panel.mjs'
import { modelName, enCours, famList, kidsOpen, runningNow } from '../lib/panel_conv.mjs'
import { fmtTokens, fmtUsd } from './nav.mjs'
import { drawGraphe } from './graphe_view.mjs'
import { meterSvg } from './svg.mjs'
import { drawDayGantt, drawWfGantt } from './viz_gantt.mjs'
import { tpsText as debitTps, secText, clockText, fitColumns, tokText } from '../lib/debit.mjs'
import { vizConfig, modelColor, modelTone } from '../lib/viz_palette.mjs'
import { sankeySvg, sankeyAlt, sankeyLegend } from './viz_sankey.mjs'
import { quotaSvg } from './viz_quota.mjs'
import { sparkSvg, sparkText } from './viz_spark.mjs'
import { graphSvg, graphAlt } from './viz_graph.mjs'
import { graphLayout } from '../lib/viz_graph.mjs'

const len = (s) => [...String(s ?? '')].length
const clip = (t, n) => {
  const a = [...String(t ?? '')]
  return a.length > n ? a.slice(0, Math.max(1, n - 1)).join('') + '…' : a.join('')
}

/**
 * P = { cfg, columns, open: {id: bool}, closed: {nodeKey: bool}, act, files: { head, rows, more, selected, attach, busy, error },
 *       factory (lib/panel_conv.mjs convFactory), syn (synthesis()), filter: {period, project, state, who}, bars: [...],
 *       graphe, debit, colors, ctxWindow, unfold: Set of the clis unfolded by the viewer, tree: Set of the clis whose
 *       running Workflows are drawn under their row, convFactories: { [cli]: convFactory(...) | null } }
 */
export function drawPanel(h, P) {
  const c = panelConfig(P.cfg)
  const L = c.labels
  const width = Math.max(30, P.columns || 75)
  const u = ui(h, P, c, width)
  const parts = { fichiers: drawFiles, conv: drawConv, convs: drawConvs, barres: drawBarres, debit: drawDebit, graphe: drawGrapheSection }
  const out = []
  const click = drawClick(u, P, L)
  if (click) out.push(click)
  out.push(drawEnCours(u, P, L))
  // the one-line sections sit together; a block of rows (Fichiers, the conversations) is followed by an empty line
  const oneLine = new Set(['barres', 'debit', 'graphe'])
  let prev = ''
  for (const id of c.order) {
    const part = parts[id](u, P, L, width)
    if (!part) continue
    if (prev && !(oneLine.has(prev) && oneLine.has(id) && !P.open[prev])) out.push(u.blank('p-gap-' + id))
    out.push(part)
    prev = id
  }
  if (P.otherViews) out.push(u.blank('p-gap-other'), h.T(clip(P.otherViews, width), { dim: true, wrap: 'truncate-end', key: 'p-other-views' }))
  return out
}

/** A thin grey rule across the pane (between unfolded conversations of the graph). */
function sep(h, width, key, indent = 0) {
  return h.col([h.T('─'.repeat(Math.max(4, width - 1 - indent)), { dim: true, wrap: 'truncate-end' })], { key, marginBottom: 1, ...(indent ? { marginLeft: indent } : {}) })
}

/** The render hook of the graph. */
export { drawGraphe }

// ---- À toi de cliquer: one amber line per waiting conversation, at the very top -----------------------------------

function drawClick(u, P, L) {
  const { h } = u
  const m = P.graphe
  const list = (m && m.ready && m.waiting) || []
  if (!list.length) return null
  const open = (P.act && P.act.openConv) || (() => {})
  const lines = []
  const one = list.length === 1
  if (!one) lines.push(h.T(`◆ ${L.click_line} (${list.length})`, { tone: 'warn', bold: true, key: 'pk-click-h' }))
  for (const w of list) {
    const head = one ? `◆ ${L.click_line} :` : ' ◆'
    const tail = fill(L.graphe_wait_line, { reason: w.reason, age: w.age })
    // the title first (it is what Julian clicks), the reason takes what is left
    const room = Math.max(6, u.W - len(head) - 4 - Math.min(len(tail), 10))
    const title = clip(w.title + (w.self ? ' ' + L.graphe_here : ''), room)
    lines.push(h.row([
      h.T(head, { tone: 'warn', bold: one }),
      h.btn(title, () => open(w.link), true, 'pgw-' + w.key),
      h.T(clip(tail, Math.max(4, u.W - len(head) - len(title) - 4)), { tone: 'warn', wrap: 'truncate-end' }),
    ], { key: 'pk-click-' + w.key, flexWrap: 'nowrap', alignItems: 'center' }))
  }
  return h.col(lines, { key: 'p-click' })
}

// ---- EN COURS: one line, what runs now (Julian, 20 Oct: « I don't see how many workflows, agents, sub-agents ») -------

/**
 * « EN COURS  3 conv · 4 workflows · 9 agents (7 opus, 2 sonnet) · 2 bloqués »: the conversations that work (green, a
 * click filters CONVERSATIONS on « en cours »), the live Workflows, the running agents and their models, the blocked
 * conversations (red, a click filters on « t'attend »). Short of room the models go, then the words get short.
 * « voir › » at the right unfolds « En ce moment » (Julian, 21 Oct: « I don't see what is running right now, which
 * agent, which workflow »): every running agent, flat, longest first, its path « Conv › workflow › phase », model and
 * time. Nothing runs: « rien ne tourne · dernier fini il y a 12 min (name) ».
 */
function drawEnCours(u, P, L) {
  const { h } = u
  const n = enCours({ syn: P.synAll || P.syn, factory: P.factory, factories: P.convFactories, self: P.self })
  const now = runningNow({ factory: P.factory, factories: P.convFactories, self: P.self }, P.cfg)
  const head = item(h, L.encours_head, { bold: true })
  if (!n.convs && !n.workflows && !n.agents && !n.blocked && !now.list.length) {
    const last = now.last && Number.isFinite(now.last.ago) ? ' · ' + fill(L.encours_last, { age: minText(now.last.ago), name: now.last.name }) : ''
    return h.row([head.el, h.T(clip(L.encours_none + last, Math.max(8, u.W - head.w - 2)), { dim: true, wrap: 'truncate-end' })], { key: 'p-encours', gap: 2, flexWrap: 'nowrap', marginBottom: 1 })
  }
  const open = Boolean(P.open && P.open.encours)
  const more = now.list.length ? { el: h.tbtn(`${L.encours_more} ${open ? '⌄' : '›'}`, () => P.act.ptoggle('encours'), 'pec-more', { plain: true, dim: true }), w: len(L.encours_more) + 4 } : null
  const act = P.act || {}
  const clickable = (text, o, key, onPress) => (onPress && h.tbtn
    ? { el: h.tbtn(text, onPress, key, { plain: true, ...o }), w: len(text) + 2 }
    : item(h, text, o, key))
  const conv = clickable(fill(L.encours_conv, { n: n.convs }), { tone: n.convs ? 'ok' : undefined, bold: n.convs > 0, dim: !n.convs }, 'pec-conv',
    act.pfilter ? () => act.pfilter('state', 'running') : null)
  const wf = (short) => item(h, fill(short ? L.encours_wf_short : n.workflows === 1 ? L.encours_wf_one || L.encours_wf : L.encours_wf, { n: n.workflows }), { tone: n.workflows ? 'ok' : undefined, bold: n.workflows > 0, dim: !n.workflows })
  // « 1 agent en cours » as on every row; « 1 ag. » only when the width forces it (Julian, 20 Oct)
  const agO = { tone: n.agents ? 'ok' : undefined, bold: n.agents > 0, dim: !n.agents }
  const ag = item(h, fill(L.tree_agents, { n: n.agents, agents: n.agents === 1 ? L.agent_one : L.agent_many }), agO)
  const agS = item(h, fill(L.tree_agents_short, { n: n.agents }), agO)
  const fams = n.fams.length ? item(h, fill(L.encours_fam, { list: n.fams.map(([f, k]) => `${k} ${f}`).join(', ') }), { dim: true }) : null
  const agFull = fams ? { el: h.row([ag.el, fams.el], { gap: 1, flexWrap: 'nowrap', key: 'pec-ag' }), w: ag.w + fams.w + 1 } : ag
  const blocked = n.blocked ? clickable(fill(n.blocked === 1 ? L.encours_blocked_one : L.encours_blocked, { n: n.blocked }), { tone: 'bad', bold: true }, 'pec-blocked',
    act.pfilter ? () => act.pfilter('state', 'waiting') : null) : null
  const room = u.W - head.w - 2 - (more ? more.w + 1 : 0)
  const vs = [[conv, wf(false), agFull, blocked], [conv, wf(false), ag, blocked], [conv, wf(true), ag, blocked], [conv, wf(true), agS, blocked]].map((v) => withDots(u, v))
  const line = h.row([
    h.row([head.el, fitLine(u, room, vs, 'pec-l')], { gap: 2, flexWrap: 'nowrap', alignItems: 'center', flexShrink: 1, key: 'l' }),
    more ? h.row([more.el], { flexShrink: 0, key: 'r' }) : null,
  ], { key: 'p-encours-row', justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'center' })
  if (!open || !now.list.length) return h.col([line], { key: 'p-encours', marginBottom: 1 })
  return h.col([line, h.col(nowLines(u.sub(2), P, L, now.list), { key: 'p-now', marginLeft: 2 })], { key: 'p-encours', marginBottom: 1 })
}

/**
 * « En ce moment »: one entry per running agent (two lines: bullet, label, model · time at the right; under it, grey,
 * its path « Conv › workflow › phase »), the longest first; a conversation working with no agent: « fil principal ».
 */
function nowLines(u, P, L, list) {
  const { h } = u
  const out = [h.T(fill('{head} ({n})', { head: L.now_head, n: list.length }), { bold: true, key: 'pn-h' })]
  for (const x of list) {
    const kind = x.kind === 'main' ? 'conv' : x.kind
    const right = withDots(u, [item(h, x.model, { dim: true }), x.ms ? item(h, minText(x.ms), { dim: true, tone: x.stalled ? 'warn' : undefined }) : null])
    out.push(macroRow(u, { key: 'pn-' + x.key, lead: [markItem(u, bullet(u, kind, x.stalled ? 'stalled' : 'running'))], title: x.label, bold: true,
      variants: [right, right.slice(-1)], minTitle: 12 }))
    // short of room the conversation's title is cut first, so the Workflow and the phase stay readable
    const sep = L.now_path_sep
    const rest = x.path.slice(1).join(sep)
    const room = u.W - 2 - (rest ? len(rest) + len(sep) : 0)
    const path = rest && room >= 8 ? clip(x.path[0], room) + sep + rest : x.path.join(sep)
    out.push(h.T(NBSP + NBSP + clip(path, u.W - 2), { dim: true, wrap: 'truncate-end', key: 'pnp-' + x.key }))
  }
  return out
}

// ---- the macro rows ---------------------------------------------------------------------------------------------------

/**
 * One macro line: `lead` items (tree glyph, state mark), the title (a plain button when onPress), then the first of
 * `variants` (lists of items, fullest first) that leaves the title minTitle cells, else the barest. An item is
 * { el, w } (w = its cells). The title is what gives way; the numbers are in the items and never cut.
 */
function macroRow(u, o) {
  const { h } = u
  const width = o.width || u.W
  const sum = (xs) => xs.reduce((a, x) => a + x.w + 1, 0)
  const btn = o.onPress ? 2 : 0
  const room = (v, a = []) => width - sum(o.lead || []) - sum(v) - btn - sum(a)
  const min = o.minTitle ?? 12
  const v = o.variants.find((x) => room(x) >= Math.min(min, len(o.title))) || o.variants[o.variants.length - 1]
  // the grey type word after the title stays only while the title stays whole: a title is never cut for it
  const after = o.after && o.after.length && room(v, o.after) >= len(o.title) ? o.after : []
  const r = Math.max(3, room(v, after))
  const text = clip(o.title, r)
  const title = o.onPress
    ? h.tbtn(text, o.onPress, o.titleKey, { plain: true, bold: o.bold, dim: o.dim })
    : h.T(text, { bold: o.bold, dim: o.dim, wrap: 'truncate-end' })
  return h.row([
    h.row([...(o.lead || []).map((x) => x.el), title, ...after.map((x) => x.el)], { flexWrap: 'nowrap', gap: 1, alignItems: 'center', flexShrink: 1, key: 'l' }),
    v.length ? h.row(v.map((x) => x.el), { flexWrap: 'nowrap', gap: 1, alignItems: 'center', flexShrink: 0, key: 'r' }) : null,
  ], { key: o.key, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', ...(o.indent ? { marginLeft: o.indent } : {}) })
}

const item = (h, text, o = {}, key) => ({ el: h.T(String(text), { ...o, ...(key ? { key } : {}) }), w: len(text) })
const markItem = (u, mk) => item(u.h, mk.glyph, { tone: mk.tone === 'dim' ? undefined : mk.tone, dim: mk.tone === 'dim' })
const arrowItem = (u, open, onPress, key) => ({ el: u.h.tbtn(open ? '⌄' : '›', onPress, key, { plain: true }), w: 3 })
const cellsOf = (c, width) => (width >= (Number(c.style.wide_cols) || 60) ? Number(c.style.macro_cells) || 10 : Number(c.style.macro_cells_narrow) || 6)

/** One dot per agent on a Workflow line: grey ■ done, ● running, grey □ pending, red ✕ failed; past macro_dots, +N. */
function macroDots(u, list, key) {
  const { h, c } = u
  const st = c.style
  const cap = Math.max(1, Number(st.macro_dots) || 12)
  const shown = list.slice(0, cap)
  const glyph = { done: st.dot_done || '■', running: st.dot_live || '●', failed: '✕' }
  const runs = []
  for (const s of shown) {
    const g = glyph[s] || st.dot_pending || '□'
    const last = runs[runs.length - 1]
    if (last && last.s === s) last.n++
    else runs.push({ s, g, n: 1 })
  }
  const kids = runs.map((r, i) => h.T(r.g.repeat(r.n), { dim: r.s !== 'running' && r.s !== 'failed', tone: r.s === 'failed' ? 'bad' : undefined, key: `${key}-${i}` }))
  const more = list.length > shown.length ? ` +${list.length - shown.length}` : ''
  if (more) kids.push(h.T(more, { dim: true, key: `${key}-more` }))
  return { el: h.row(kids, { gap: 0, flexWrap: 'nowrap', key }), w: shown.length + len(more) }
}

// ---- the tree (Julian, 19 Oct: « like a project-structure tree ») ------------------------------------------------------
// CETTE CONVERSATION and CONVERSATIONS are drawn as a tree: conversation → the sub-conversations it spawned
// (spawnedFrom) → its Workflows / background agents → their agents. Every node is two lines: the node line (connector,
// state mark, title cut, ⚠ / › / ⌄ at the right) and its metrics line, grey, indented under the title (after the
// connector column); an empty « │ » line separates siblings (not the agents of one Workflow: they stay dense, one line
// each). Connectors ├──── └──── │ are grey text columns, panel.tree.indent columns per level (Julian, 20 Oct: « ajoute
// de l'indentation »; "auto": 6, 4 under style.wide_cols columns). The metrics line starts under the title's first letter.
// An unfolded node draws its detail (micro) inside the tree, under its metrics line, the tree rule running on its left.


/** The connector strings: panel.tree.indent columns per level ("auto": 6, 4 under style.wide_cols columns). */
export function treeGlyphs(c, columns) {
  const set = c && c.tree ? c.tree.indent : 'auto'
  const narrow = (columns || 75) < (Number(c && c.style && c.style.wide_cols) || 60)
  const n = Number.isFinite(Number(set)) && set !== '' && set !== null ? Math.max(2, Math.min(12, Math.round(Number(set)))) : narrow ? 4 : 6
  const rule = '─'.repeat(n - 2)
  return { mid: `├${rule} `, end: `└${rule} `, bar: '│' + ' '.repeat(n - 1), none: ' '.repeat(n) }
}
const glyphsOf = (u, P) => treeGlyphs(u.c, P.columns)

/** `el` behind a grey prefix column (« │   ├── », « │   │ »): the prefix keeps its width, the element takes the rest. */
function pre(u, prefix, el, key) {
  const { h } = u
  if (!prefix) return h.col([el], { key })
  return h.row([
    // no-break spaces: a surface may drop a Text's leading spaces, the columns must stay
    h.col([h.T(prefix.replace(/ /g, NBSP), { dim: true })], { width: len(prefix), flexShrink: 0, key: 'p' }),
    h.col([el], { flexGrow: 1, flexShrink: 1, key: 'b' }),
  ], { key, flexWrap: 'nowrap', gap: 0 })
}

/**
 * Draws `nodes` (siblings) under `base` (the ancestors' « │   » / «    » columns). A node: { key, head(width) -> el,
 * metrics(width) -> el | null, micro(u) -> elements | null (its detail, drawn under its metrics line), children,
 * dense (its children are agents: no spacer between them) }. -> one-line elements, top to bottom.
 */
function drawTree(u, P, nodes, base, dense = false) {
  const g = glyphsOf(u, P)
  const out = []
  nodes.forEach((n, i) => {
    const last = i === nodes.length - 1
    // one-line agents and phases sit in a row: no spacer above one that follows another, or opens a dense list
    const tight = n.tight && (i === 0 ? dense : nodes[i - 1].tight)
    if ((!dense || i === 0) && !tight) out.push(u.h.T((base + '│').replace(/ /g, NBSP), { dim: true, key: n.key + '-sp' }))
    const conn = base + (last ? g.end : g.mid)
    const cont = base + (last ? g.none : g.bar)
    const kids = n.children || []
    out.push(pre(u, conn, n.head(u.W - len(conn)), n.key + '-n'))
    // the metrics and the detail sit under the title: the connector column, then « │ » when children follow
    const mp = cont + (kids.length ? '│ ' : '  ')
    const mw = u.W - len(mp)
    const met = n.metrics ? n.metrics(mw) : null
    if (met) out.push(pre(u, mp, met, n.key + '-m'))
    const micro = n.micro ? n.micro(u.sub(len(mp))) : null
    if (micro) micro.filter(Boolean).forEach((l, j) => out.push(pre(u, mp, l, `${n.key}-u${j}`)))
    if (kids.length) out.push(...drawTree(u, P, kids, cont, Boolean(n.dense)))
  })
  return out
}

/**
 * One fitted grey line of items: the first of `variants` (lists of { el, w }, fullest first) that fits `width`, else
 * the barest; then `tail` (a text, cut) when at least 8 cells are left. Numbers are items: they are dropped whole,
 * never cut.
 */
function fitLine(u, width, variants, key, tail = '') {
  const { h } = u
  const sum = (xs) => xs.reduce((a, x) => a + x.w + 1, 0) - (xs.length ? 1 : 0)
  let v = variants.find((x) => sum(x) <= width) || variants[variants.length - 1] || []
  // the line wraps nowhere: past the barest variant, whole items go from the end (a « · » never ends the line)
  while (v.length > 1 && sum(v) > width) { v = v.slice(0, -1); while (v.length > 1 && v[v.length - 1].dot) v = v.slice(0, -1) }
  const room = width - sum(v) - (v.length ? 3 : 0)
  const t = tail && room >= 8 ? [h.T((v.length ? '· ' : '') + clip(tail, room), { dim: true, wrap: 'truncate-end', key: key + '-tail' })] : []
  return h.row([...v.map((x) => x.el), ...t], { key, flexWrap: 'nowrap', gap: 1, alignItems: 'center' })
}

/**
 * A node line: its typed bullet in its state colour, the title (a plain button when onPress), the grey type word
 * (o.type, dropped before the title is cut short), then the right items (⚠, › / ⌄), never cut. o.variants: lists of
 * right items, fullest first, the first that leaves the title 12 cells (else the barest).
 */
function nodeHead(u, o, width) {
  return macroRow(u, { key: o.key, lead: [markItem(u, o.mark)], title: o.title, titleKey: o.titleKey, onPress: o.onPress, bold: o.bold, dim: o.dim,
    after: o.type ? [item(u.h, o.type, { dim: true })] : [], variants: o.variants || [o.right || []], minTitle: o.minTitle ?? (o.variants ? 12 : 3), width })
}

/**
 * A typed bullet (Julian, 21 Oct): ● conversation, ↳ sous-conversation, ◇ workflow, ▸ phase, • agent (of a
 * Workflow), ◦ agent d'arrière-plan (Agent tool outside a Workflow); its colour is the state: running green, waiting or
 * stalled amber, failed red, done grey (panel.bullets).
 */
const TONE_OF = { running: 'ok', working: 'ok', waiting: 'warn', stalled: 'warn', blocked: 'bad', failed: 'bad' }
function bullet(u, kind, state) {
  const b = (u.c.bullets || {})[kind] || '•'
  const tone = TONE_OF[state] || (state === 'ok' || state === 'warn' || state === 'bad' ? state : 'dim')
  return { glyph: b, tone }
}

const dot = (u) => ({ ...item(u.h, '·', { dim: true }), dot: true })
const withDots = (u, xs) => xs.filter(Boolean).flatMap((x, i) => (i ? [dot(u), x] : [x]))

/** The context of a metrics line: « ctx ▰▰▰▱ 77 % » (amber, bold at style.ctx_warn_pct; red past the hand-off). */
function ctxParts(u, P, x, key) {
  const { h, c } = u
  if (!x || !Number.isFinite(x.pct)) return null
  const tone = x.over ? 'bad' : x.pct >= (Number(c.style.ctx_warn_pct) || 62.5) ? 'warn' : undefined
  const pct = item(h, `${Math.round(x.pct)} %`, { bold: Boolean(tone), tone, dim: !tone })
  const word = item(h, 'ctx', { dim: true })
  const cells = cellsOf(c, P.columns || 75)
  const bar = { el: u.bar(Math.min(100, x.pct), key, { cells, tone, mark: x.markPct }), w: cells }
  // one item each, so the line drops the bar whole, not half of it
  return { full: { el: h.row([word.el, bar.el, pct.el], { gap: 1, flexWrap: 'nowrap', key: key + '-c' }), w: word.w + bar.w + pct.w + 2 },
    noBar: { el: h.row([word.el, pct.el], { gap: 1, flexWrap: 'nowrap', key: key + '-c' }), w: word.w + pct.w + 1 }, bare: pct }
}

/**
 * A conversation as a tree node (Julian, 20 Oct: « more compact, hard to see what is really running »). o: { key, mark,
 * title, titleKey, open (its children drawn), onToggle, running (bold), idle (grey), model, effort, ctx: { pct, over,
 * markPct } | null, value (tokens or cost), state (its word, said only when it does not run), counts: { wf, agents,
 * subs }, from (« ↖ lancée par … »), details: { open, onToggle, key, lines(inner) } | null, children }.
 * Folded with nothing running: ONE line, « ○ title   42 % · 507K ». Else the node line (⚠ past the hand-off, › / ⌄)
 * and its metrics line « ctx ▰▰▱ 42 % · 76M · opus·med · 2 wf · 5 agents en cours · 1 sous-conv   détails › »; short
 * of room the state goes, then the model, the sub-conversations, the long words, the bar; never a number.
 * « détails › » unfolds the card (context, stats, Ce qui contribue / Sankey, journal) under the metrics line.
 */
function convNode(u, P, L, o) {
  const { h } = u
  const warn = o.ctx && o.ctx.over ? [item(h, L.handoff_mark || '⚠', { tone: 'bad', bold: true })] : []
  const counts = o.counts || {}
  const head = { key: o.key + '-h', mark: o.mark, title: o.title, titleKey: o.titleKey, onPress: o.onToggle, bold: Boolean(o.running), dim: Boolean(o.idle), type: o.type }
  if (!o.running && !o.open) {
    // one line: the title, then « 1 sous-conv · 42 % · 507K » at the right
    const nums = [counts.subs ? fill(L.tree_subs, { n: counts.subs }) : '', o.ctx && Number.isFinite(o.ctx.pct) ? `${Math.round(o.ctx.pct)} %` : '', o.value || ''].filter(Boolean).join(' · ')
    return { key: o.key, children: [], head: (w) => nodeHead(u, { ...head, right: [...warn, ...(nums ? [item(h, nums, { dim: true })] : [])] }, w) }
  }
  const arrow = arrowItem(u, o.open, o.onToggle, o.titleKey + '-x')
  const d = o.details
  return {
    key: o.key, children: o.open ? o.children || [] : [],
    micro: d && d.open ? d.lines : null,
    head: (w) => nodeHead(u, { ...head, right: [...warn, arrow] }, w),
    metrics: (w) => {
      const cx = ctxParts(u, P, o.ctx, o.key + '-bar')
      const val = o.value ? item(h, o.value, { dim: true }) : null
      const model = modelShort(o.model, o.effort, P.cfg)
      const m = model ? item(h, model, { dim: true }) : null
      const st = o.state && !o.running ? item(h, o.state, { dim: true }) : null
      const wf = counts.wf ? item(h, fill(L.tree_wf, { n: counts.wf })) : null
      const ag = counts.agents ? item(h, fill(L.tree_agents, { n: counts.agents, agents: counts.agents === 1 ? L.agent_one : L.agent_many })) : null
      const agS = counts.agents ? item(h, fill(L.tree_agents_short, { n: counts.agents })) : null
      const sub = counts.subs ? item(h, fill(L.tree_subs, { n: counts.subs }), { dim: true }) : null
      const vs = cx
        // « 1 agent en cours » keeps its words until the bar went: « 1 ag. » only when the width forces it
        ? [[cx.full, val, m, wf, ag, sub, st], [cx.full, val, m, wf, ag, sub], [cx.full, val, wf, ag, sub], [cx.full, val, wf, ag], [cx.noBar, val, wf, ag],
          [cx.bare, val, wf, ag], [cx.bare, val, wf, agS], [cx.bare, wf, agS], [cx.bare, val]]
        : [[val, m, wf, ag, sub, st], [val, m, wf, ag, sub], [val, wf, ag, sub], [val, wf, ag], [val, wf, agS], [wf, agS], [val]]
      if (!d) return fitLine(u, w, vs.map((v) => withDots(u, v)), o.key + '-ml', o.from)
      const label = `${L.details} ${d.open ? '⌄' : '›'}`
      const btn = h.tbtn(label, d.onToggle, d.key, { plain: true, dim: true })
      return h.row([
        h.col([fitLine(u, w - len(label) - 3, vs.map((v) => withDots(u, v)), o.key + '-ml', o.from)], { flexShrink: 1, key: 'l' }),
        h.col([btn], { flexShrink: 0, key: 'r' }),
      ], { key: o.key + '-mr', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' })
    },
  }
}

/**
 * « Terminés N › » as a tree node under a conversation (Julian, 21 Oct): unfolded, one line per finished Workflow or
 * agent, newest first (at most conv.finished_max): its bullet, its name, ✓ / ✕, its duration and how long ago. A
 * finished Workflow's title unfolds its agents.
 */
function finishedNode(u, P, L, f) {
  const { h } = u
  const toggle = () => P.act.nodeToggle(f.key, f.open)
  const items = f.items || []
  const kids = items.map((x) => {
    const k = x.card
    const open = Boolean(k && k.open)
    const right = withDots(u, [
      item(h, x.failed ? '✕' : '✓', { tone: x.failed ? 'bad' : undefined, dim: !x.failed, bold: x.failed }),
      x.ms ? item(h, minText(x.ms), { dim: true }) : null,
      Number.isFinite(x.ago) ? item(h, fill(L.finished_ago, { age: minText(x.ago) }), { dim: true }) : null,
    ])
    const onPress = k ? () => P.act.nodeToggle(k.key, open) : undefined
    const agents = open ? k.phases.flatMap((p) => p.agents) : []
    return {
      key: 'pkf-' + x.key, tight: true, dense: true,
      head: (w) => nodeHead(u, { key: 'pkfh-' + x.key, mark: bullet(u, x.kind === 'workflow' ? 'workflow' : 'background', x.failed ? 'failed' : 'done'), title: x.title,
        titleKey: k ? `pk-${k.key}-t` : undefined, onPress, dim: true, variants: [right, right.slice(0, 3), right.slice(0, 1)] }, w),
      children: agents.map((a) => agentNode(u, L, a, `${x.key}-${a.id}`, 'agent')),
    }
  })
  if (f.more) kids.push(moreNode(u, `pkf-more-${f.key}`, `+${f.more}`))
  return {
    key: 'pkt-' + f.key, dense: true,
    head: (w) => nodeHead(u, { key: 'pkth-' + f.key, mark: { glyph: '✓', tone: 'dim' }, title: fill(L.finished, { n: f.count }), titleKey: f.key, onPress: toggle, dim: true,
      right: [arrowItem(u, f.open, toggle, f.key + '-x')] }, w),
    children: f.open ? kids : [],
  }
}

/** A grey « +N … » line closing a list of nodes. */
const moreNode = (u, key, text) => ({ key, tight: true, head: (w) => u.h.T(clip(text, w), { dim: true, wrap: 'truncate-end', key: key + '-t' }) })

/**
 * Agents as one-line nodes, the first conv.running_max of them, then « +N agents en cours » (Julian, 21 Oct: the running
 * agents always visible under their Workflow / phase, without unfolding). kind: agent (•) or background (◦).
 */
function agentNodes(u, P, L, list, key, kind, onlyRunning = true) {
  const max = Math.max(1, Number(u.c.conv.running_max) || 8)
  const shown = onlyRunning ? list.filter((a) => a.status === 'running') : list
  const out = shown.slice(0, max).map((a) => agentNode(u, L, a, `${key}-${a.id}`, kind))
  const more = shown.length - Math.min(shown.length, max)
  if (more) out.push(moreNode(u, `pkm-more-${key}`, onlyRunning ? fill(L.agents_more, { n: more, agents: more === 1 ? L.agent_one : L.agent_many }) : `+${more}`))
  return out
}

/**
 * A phase of a Workflow (« ▸ Wave B 1/3 », Julian 21 Oct): drawn for its running phase(s) under a folded Workflow, every
 * phase under an unfolded one; its running agents always under it, the others when it is unfolded (›) or its Workflow is.
 */
function phaseNode(u, P, L, k, p, all) {
  const { h } = u
  const others = p.agents.length + (p.hidden || 0) - p.running
  const toggle = () => P.act.nodeToggle(p.key, p.expanded)
  const showAll = all || p.expanded
  const failed = p.agents.some((a) => a.status === 'failed')
  const state = p.running ? (k.stalled ? 'stalled' : 'running') : failed ? 'failed' : 'done'
  const canFold = others > 0 && !all
  const right = [item(h, `${p.done}/${p.count}`, { dim: true }), ...(canFold ? [arrowItem(u, p.expanded, toggle, p.key + '-x')] : [])]
  return {
    key: `pkp-${p.key}`, dense: true, tight: true,
    head: (w) => nodeHead(u, { key: `pkph-${p.key}`, mark: bullet(u, 'phase', state), title: p.title, type: L.type_phase, bold: p.running > 0, dim: !p.running,
      titleKey: canFold ? p.key : undefined, onPress: canFold ? toggle : undefined, right }, w),
    children: agentNodes(u, P, L, p.agents, p.key, 'agent', !showAll),
  }
}

/**
 * A Workflow as a tree node: « ◇ name workflow › » (its bullet in its state colour), its metrics line « 2/4 ■■●□ ·
 * Wave B · 1 agent en cours · 40 min · fin ~16:55 » (or « à l'arrêt 1 h 09 » amber), then ALWAYS its running phase(s)
 * and their running agents, one line each (Julian, 21 Oct); unfolded (⌄): every phase and agent, its tokens, cost, Gantt.
 */
function wfNode(u, P, L, k) {
  const { h } = u
  const agents = k.phases.flatMap((p) => p.agents)
  const done = agents.filter((a) => a.status === 'done').length
  const mark = bullet(u, 'workflow', k.failed ? 'failed' : k.stalled ? 'stalled' : k.live ? 'running' : 'done')
  const toggle = () => P.act.nodeToggle(k.key, k.open)
  const named = k.phases.filter((p) => p.title !== L.phase_default && p.title !== k.title)
  const phased = k.kind === 'workflow' && named.length > 0
  const kids = phased
    ? k.phases.filter((p) => k.open || p.running > 0).map((p) => phaseNode(u, P, L, k, p, k.open))
    : agentNodes(u, P, L, agents, k.key, k.kind === 'workflow' ? 'agent' : 'background', !k.open)
  return {
    key: `pkm-${k.key}`, dense: true,
    head: (w) => nodeHead(u, { key: `pkh-${k.key}`, mark, title: k.title, type: k.kind === 'workflow' ? L.type_workflow : '', titleKey: `pk-${k.key}-t`, onPress: toggle,
      bold: Boolean(k.live), dim: !k.live, right: [arrowItem(u, k.open, toggle, `pk-${k.key}-x`)] }, w),
    metrics: (w) => {
      const phase = k.kind === 'workflow' ? k.phases.filter((p) => p.running > 0 && p.title !== L.phase_default && p.title !== k.title).map((p) => p.title).join('+') : ''
      const fam = {}
      for (const a of agents) if (a.status === 'running') { const f = String(a.model || '?').split(' ')[0].toLowerCase(); fam[f] = (fam[f] || 0) + 1 }
      // « 2 agents en cours (opus) », « 3 agents en cours (2 opus, 1 sonnet) »; short of room the models go first (« fin
      // ~HH:MM » stays at 75 columns), then the phase, then « 3 ag. » (Julian, 20 Oct)
      const fl = famList(fam)
      const nRun = fl.reduce((a, x) => a + x[1], 0)
      const models = nRun ? fill(L.wf_running, { n: nRun, agents: nRun === 1 ? L.agent_one : L.agent_many, models: fl.length === 1 ? fl[0][0] : fl.map(([f, n]) => `${n} ${f}`).join(', ') }) : ''
      const modelsPlain = nRun ? fill(L.tree_agents, { n: nRun, agents: nRun === 1 ? L.agent_one : L.agent_many }) : ''
      const modelsShort = nRun ? fill(L.tree_agents_short, { n: nRun }) : ''
      const time = k.stalled ? item(h, fill(L.wf_stalled, { age: minText(k.stalledMs) }), { tone: 'warn', bold: true }) : item(h, minText(k.elapsed), { dim: true })
      const eta = k.eta ? item(h, fill(L.wf_eta, { time: k.eta }), { dim: true }) : null
      const count = item(h, `${done}/${agents.length || k.count}`, { dim: true })
      const dots = macroDots(u, k.dots || [], `pkd-${k.key}`)
      const ph = phase ? item(h, phase, { dim: true }) : null
      const mo = models ? item(h, models) : null
      const moP = modelsPlain ? item(h, modelsPlain) : null
      const moS = modelsShort ? item(h, modelsShort) : null
      const head = { el: h.row([count.el, dots.el], { gap: 1, flexWrap: 'nowrap', key: `pkc-${k.key}` }), w: count.w + dots.w + 1 }
      const vs = [[head, ph, mo, time, eta], [head, ph, moP, time, eta], [head, moP, time, eta], [head, moP, time], [head, moS, time, eta], [head, moS, time],
        [head, time], [count, time]]
      return fitLine(u, w, vs.map((v) => withDots(u, v)), `pkl-${k.key}`)
    },
    micro: k.open ? (inner) => taskBody(inner, P, L, k, true, true) : null,
    children: kids,
  }
}

/**
 * An agent: one line, « • coder · p44-migration  opus · 1 h 10 · 180K » (Julian, 21 Oct): its bullet (• in a Workflow,
 * ◦ outside one) in its state colour, its label, then model · time · tokens at the right; short of room the model goes,
 * then the tokens (the time stays); a number is never cut.
 */
function agentNode(u, L, a, key, kind = 'agent') {
  const { h } = u
  const fam = String(a.model || '?').split(' ')[0].toLowerCase()
  const m = item(h, fam, { dim: true })
  const t = a.ms ? item(h, minText(a.ms), { dim: true }) : null
  const k = item(h, kTok(a.tokens), { dim: true })
  const right = (xs) => withDots(u, xs)
  const state = a.status === 'running' ? 'running' : a.status === 'failed' ? 'failed' : 'done'
  return {
    key: 'pka-' + key, tight: true,
    head: (w) => nodeHead(u, { key: 'pkah-' + key, mark: bullet(u, kind, state), title: a.label, bold: a.status === 'running', minTitle: 14,
      variants: [right([m, t, k]), right([t, k]), right([t || k])] }, w),
  }
}

/**
 * A conversation's « détails » inside the tree: « ouvrir ↗ » (another conversation), its card (context, stats, model
 * share, Sankey or « Ce qui contribue ») without the model · effort · state line (the metrics line says it) nor the
 * hand-off note (the red ⚠ on the row says it), then « journal (N) › », folded by default.
 */
function detailLines(u, P, L, m, o) {
  const { h } = u
  const lines = []
  if (o.link) lines.push(h.row([h.btn(o.openLabel || L.open_conv, () => P.act.openConv(o.link), false, 'pco-' + o.cli)], { key: 'pco-row-' + o.cli }))
  if (!m || !m.available) { lines.push(h.T(L.conv_no_factory, { dim: true, wrap: 'truncate-end', key: 'nf' })); return lines }
  lines.push(...leadCard(u, P, L, m, true, { noMeta: true, noNote: true }))
  const open = Boolean(m.journalOpen)
  lines.push(h.row([h.tbtn(`${fill(L.journal, { n: m.log.length })} ${open ? '⌄' : '›'}`, () => P.act.nodeToggle(m.journalKey, open), m.journalKey, { plain: true })], { key: m.journalKey + '-row' }))
  if (open) {
    if (!m.log.length) lines.push(h.T(L.log_none, { dim: true, key: 'pfj-none' }))
    m.log.forEach((e, i) => lines.push(h.T(clip(`${String(new Date(e.at).getHours()).padStart(2, '0')}:${String(new Date(e.at).getMinutes()).padStart(2, '0')}  ${e.text}`, u.W), { key: 'pfj-' + i, tone: e.tone || undefined, dim: !e.tone, wrap: 'truncate-end' })))
  }
  return lines
}

/**
 * A conversation's children in the tree: its sub-conversations, its running Workflows (with their running agents), its
 * running agents outside a Workflow (◦, one line each), « Terminés N › ».
 */
function childrenOf(u, P, L, m, subs = [], withCards = true) {
  if (!withCards || !m || !m.available) return subs
  const out = [...subs]
  for (const k of m.cards) {
    if (k.kind === 'workflow') out.push(wfNode(u, P, L, k))
    else out.push(...agentNodes(u, P, L, k.phases.flatMap((p) => p.agents), k.key, 'background'))
  }
  if (m.finished) out.push(finishedNode(u, P, L, m.finished))
  return out
}

/** The counts of a conversation's metrics line: its live Workflows, its running agents, its sub-conversations. */
const countsOf = (m, subs) => ({ wf: m && m.available && m.live ? m.live.workflows : 0, agents: m && m.available && m.live ? m.live.agents : 0, subs: subs || 0 })

/** The sub-conversations of a conversation in Claude's list (spawnedFrom = its sid). */
const subsOf = (P, cli) => {
  const rows = (P.syn && P.syn.rows) || []
  const me = rows.find((r) => r.id === cli)
  return me && me.sid ? rows.filter((r) => r.parent === me.sid && r.id !== cli).length : 0
}

// ---- the primitives of Claude's panes, from the kit ----------------------------------------------------------------

function ui(h, P, c, width) {
  const st = c.style
  const colors = P.colors || {}
  const W = width - 1 // a section's body sits one column in
  // « label … detail value »: the label is cut first, then the detail dropped; the value is never cut. whole: the label
  // must stay whole (« 4 agents »): the detail goes first, then the label becomes o.short. The label takes what the right
  // part leaves (it shrinks, the numbers do not: Julian, 18 Oct « Workflow 4 age… »)
  const line = (left, detail, value, o = {}) => {
    const v = String(value ?? '')
    let d = String(detail ?? '')
    let l = String(left ?? '')
    const w = o.width || W
    const roomOf = () => w - len(v) - (d ? len(d) + 1 : 0) - 1
    if (d && (o.whole ? roomOf() < len(l) : w - len(v) - len(d) - 2 < Math.min(8, len(l)))) d = ''
    if (o.whole && o.short && roomOf() < len(l)) l = o.short
    const room = Math.max(4, roomOf())
    return h.row([
      h.col([o.leftEl || h.T(clip(l, room), { bold: o.bold, dim: o.dimLeft, tone: o.toneLeft, wrap: 'truncate-end' })], { flexShrink: 1, key: 'l' }),
      h.row([d ? h.T(d, { dim: true }) : null, v ? h.T(v, { bold: o.boldValue !== false, tone: o.tone, dim: o.dimValue }) : null], { flexWrap: 'nowrap', gap: 1, flexShrink: 0, key: 'r' }),
    ], { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', ...(o.key ? { key: o.key } : {}) })
  }
  // a thin full-width bar: Svg on a surface that has it, ▰▱ text otherwise; mark (0..100) = a threshold tick
  const bar = (pct, key, o = {}) => {
    const cells = o.cells || W
    const color = colors[o.tone || 'usage'] || colors.usage || '#2f81f7'
    const s = h.svg(meterSvg(pct, { width: Math.max(40, Math.round(cells * (Number(st.bar_px) || 7))), color, track: colors.track, mark: o.mark, markColor: colors.warn }), `${Math.round(pct)} %`, key)
    return s || h.T(textBar(pct, cells, P.cfg, o.mark), { tone: o.tone || 'running', key })
  }
  // a stats grid: cells [{ label, value }], `per` per row: a row of grey labels over a row of bold values, one line
  // each (so a left rule can run along every line). Every column has the same fixed width, for the labels and the values
  // alike, so « Agents » sits over its value (Julian, 18 Oct: headers shifted from their values)
  const blank = (key) => h.T(' ', { key })
  const grid = (cells, key, per = 3) => {
    const rows = [blank(key + '-top')]
    const cw = Math.max(4, Math.floor(W / per))
    for (let i = 0; i < cells.length; i += per) {
      const part = cells.slice(i, i + per)
      while (part.length < per) part.push(null)
      const one = (f, k) => h.row(part.map((x, j) => h.col([x ? f(x) : h.T(' ')], { width: cw, flexGrow: 1, flexShrink: 0, key: `${key}-${i}-${k}-${j}` })), { flexWrap: 'nowrap', gap: 0, key: `${key}-${i}-${k}` })
      rows.push(one((x) => h.T(clip(x.label, cw - 1), { dim: true, wrap: 'truncate-end' }), 'l'), one((x) => h.T(clip(x.value, cw - 1), { bold: true, tone: x.tone, wrap: 'truncate-end' }), 'v'))
    }
    return rows
  }
  // a thin grey rule down the left of `lines` (one-line elements): « │ » then the line, one step in (Julian, 18 Oct:
  // indentation instead of boxes; the engine draws a Box border on all four sides only, so the rule is text)
  const rule = (lines, key) => lines.filter(Boolean).map((l, i) => h.row([
    h.col([h.T('│', { dim: true })], { width: 1, flexShrink: 0, key: 'r' }),
    h.col([l], { flexGrow: 1, flexShrink: 1, key: 'b' }),
  ], { key: `${key}-${i}`, flexWrap: 'nowrap', gap: 1 }))
  // one dot per agent as Claude's pane draws them: grey ■ done, amber ■ running, □ pending, ✕ failed (style.dot_tones);
  // a run of Texts so each keeps its colour; past `max` dots, « +N »
  const dots = (list, key, max) => {
    const glyph = { done: st.dot_done, running: st.dot_running, failed: '✕', stopped: st.dot_pending, waiting: st.dot_pending }
    const tones = st.dot_tones || {}
    const cap = Math.max(1, max || Number(st.dots_max) || 60)
    const shown = list.slice(0, cap)
    const runs = []
    for (const s of shown) {
      const last = runs[runs.length - 1]
      if (last && last.s === s) last.n++
      else runs.push({ s, n: 1 })
    }
    const kids = runs.map((r, i) => {
      const t = tones[r.s] || (r.s === 'stopped' || r.s === 'waiting' ? 'dim' : undefined)
      return h.T(String(glyph[r.s] || st.dot_pending).repeat(r.n), { tone: t === 'dim' ? undefined : t, dim: t === 'dim', key: `${key}-${i}` })
    })
    if (list.length > shown.length) kids.push(h.T(` +${list.length - shown.length}`, { dim: true, key: `${key}-more` }))
    return h.row(kids, { gap: 0, flexWrap: 'nowrap', key })
  }
  const title = (text, key, o = {}) => h.T(text, { bold: true, size: 'heading', wrap: 'truncate-end', key, tone: o.tone })
  // the same primitives `cols` columns narrower (what sits right of a left rule)
  const sub = (cols) => ui(h, P, c, width - cols)
  return { h, c, W, line, bar, grid, dots, title, blank, rule, sub }
}

function section(u, P, id, title, summary, body, width) {
  const { h } = u
  const open = Boolean(P.open[id])
  const label = `${open ? '▾' : '▸'} ${title}`
  const room = width - len(label) - 6
  // the title in bold, a plain button (Julian, 19 Oct: small one-line headers, no big chips)
  const head = h.tbtn ? h.tbtn(label, () => P.act.ptoggle(id), 'p-sec-' + id, { bold: true, plain: true }) : h.btn(label, () => P.act.ptoggle(id), false, 'p-sec-' + id)
  return h.col([
    h.row([head, summary && !open && room > 8 ? h.T(clip(summary, room), { dim: true, wrap: 'truncate-end' }) : null],
      { alignItems: 'center', flexWrap: 'nowrap' }),
    open ? h.col(body(), { marginLeft: 1 }) : null,
  ], { key: 'p-' + id })
}

// ---- 1. Fichiers --------------------------------------------------------------------------------------------------------

function drawFiles(u, P, L, width) {
  const { h } = u
  const f = P.files
  const summary = f.head ? `${f.head}${f.selected ? ' · ' + fill(L.files_selected, { path: f.selected }) : ''}` : L.files_none
  return section(u, P, 'fichiers', L.fichiers, summary, () => {
    const out = [h.row([h.T(f.head || L.files_none, { bold: true, wrap: 'truncate-end' }), h.btn(f.busy ? '…' : L.files_refresh, () => P.act.filesRefresh(), false, 'f-refresh')],
      { key: 'f-head', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' })]
    if (f.head && !f.rows.length) out.push(h.T(L.files_empty, { dim: true, key: 'f-empty' }))
    for (const r of f.rows) {
      out.push(h.row([
        h.btn(clip(r.label, width - 8), () => P.act.filePress(r.id), r.selected, 'f-' + r.id),
        r.git ? h.T(r.git, { color: r.color, bold: true }) : null,
      ], { key: 'fr-' + r.id, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
    }
    if (f.more) out.push(h.row([h.T(fill(L.files_more, { n: f.more }), { dim: true }), h.btn(L.files_more_button, () => P.act.filesMore(), false, 'f-more')], { key: 'f-more-row', alignItems: 'center' }))
    if (f.selected) {
      out.push(h.row([h.T(clip(fill(L.files_selected, { path: f.selected }), width - 12), { wrap: 'truncate-end' }), h.btn(L.files_clear, () => P.act.filesClear(), false, 'f-clear')],
        { key: 'f-sel', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
      out.push(h.T(f.attach ? L.files_attach_on : L.files_attach_off, { dim: true, key: 'f-attach' }))
    }
    return out
  }, width)
}

// ---- 2. Cette conversation --------------------------------------------------------------------------------------------

const tpsText = (n) => (n === null || n === undefined ? '' : n >= 100 ? String(Math.round(n)) : n.toFixed(1))

/** A small bold header line with a grey summary on the same line, and an optional button at the right. */
function headLine(u, text, summary, key, right) {
  const { h } = u
  const room = u.W - len(text) - 1 - (right ? right.w + 1 : 0)
  return h.row([
    h.row([h.T(text, { bold: true, key }), summary && room > 4 ? h.T(clip(summary, room), { dim: true, wrap: 'truncate-end' }) : null], { flexWrap: 'nowrap', gap: 1, flexShrink: 1, key: 'l' }),
    right ? h.row([right.el], { flexShrink: 0, key: 'r' }) : null,
  ], { key: key + '-row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' })
}

const ctxOfRow = (u, P, tokens) => {
  if (!(Number(tokens) > 0)) return null
  const win = Number(P.ctxWindow) || Number(u.c.contexte.window) || 400000
  const thr = Number(u.c.contexte.handoff_tokens) || 250000
  return { pct: (100 * tokens) / win, over: tokens >= thr, markPct: Math.min(100, (100 * thr) / win) }
}

/** This conversation as a one-root tree: its node and metrics lines, its running Workflows under it; « détails › » its card. */
function drawConv(u, P, L) {
  const { h, c } = u
  const m = P.factory
  const out = [headLine(u, L.conv_head, '', 'p-sec-conv')]
  if (!m || !m.available) return h.col([...out, h.T(P.treeEmpty || L.no_tree, { dim: true, key: 'pt-empty' })], { key: 'p-conv' })
  // › / ⌄ folds its children (unfolded while a Workflow / agent runs); « détails › » its card (folded by default)
  const open = kidsOpen(P.closed, 'pself', m)
  const toggle = () => P.act.nodeToggle('pself', open)
  const x = m.ctx && m.ctx.known ? m.ctx : null
  const s = m.stats
  const mark = markOf(m.lead.stateId)
  const node = convNode(u, P, L, {
    key: 'pself-row', mark: bullet(u, 'conv', (c.marks[mark] || c.marks.idle).tone), type: L.type_conv, title: m.lead.title, titleKey: 'pself', onToggle: toggle, open,
    running: mark === 'working' || mark === 'stalled' || m.cards.length > 0, idle: mark === 'done' || mark === 'idle' || mark === 'archived',
    model: m.lead.model, effort: m.lead.effort, ctx: x ? { pct: x.pct, over: x.over, markPct: x.markPct } : null, state: m.lead.state,
    value: s.cost === null || s.cost === undefined ? (s.tokens ? fmtTokens(s.tokens) : '') : fmtUsd(s.cost),
    counts: countsOf(m, subsOf(P, P.self)),
    details: { open: m.detailsOpen, key: m.detailsKey, onToggle: () => P.act.nodeToggle(m.detailsKey, m.detailsOpen), lines: (inner) => detailLines(inner, P, L, m, {}) },
    children: childrenOf(u, P, L, m),
  })
  out.push(...drawTree(u, P, [node], ''))
  return h.col(out, { key: 'p-conv' })
}

/**
 * A conversation's factory as one-line elements, top to bottom: the lead's card, then its Workflow / background cards
 * one step in behind a grey rule (their agents one step further), « Terminés N › », and (log) the session log. o:
 * { noTitle: its row already gives the title, noLive: its running cards are drawn as macro lines already }.
 */
export function factoryLines(u, P, L, m, log, o = {}) {
  const { h } = u
  const noTitle = o.noTitle === undefined ? !log : o.noTitle
  // no Workflow nor agent and a small usage: two lines until « détails » (Julian, 18 Oct: 12 lines of empty stats)
  if (m.compactable && m.compact) return compactCard(u, P, L, m, noTitle)
  const out = [...leadCard(u, P, L, m, noTitle)]
  const inner = u.sub(2)
  const cards = []
  const live = o.noLive ? [] : m.cards
  if (!m.cards.length && !m.finished) out.push(h.T(L.no_layer, { dim: true, wrap: 'truncate-end', key: 'pf-nolayer' }))
  live.forEach((k, i) => { if (i) cards.push(u.blank(`pk-${k.key}-gap`)); cards.push(...taskCard(inner, P, L, k)) })
  if (m.finished) {
    const f = m.finished
    if (cards.length) cards.push(u.blank(f.key + '-gap'))
    cards.push(h.row([h.btn(`${fill(L.finished, { n: f.count })} ${f.open ? '⌄' : '›'}`, () => P.act.nodeToggle(f.key, f.open), false, f.key)], { key: f.key + '-row' }))
    if (f.open) for (const k of f.cards) cards.push(u.blank(`pk-${k.key}-gap`), ...taskCard(inner, P, L, k))
  }
  if (cards.length) out.push(u.blank('pl-end'), ...u.rule(cards, 'pk-rule'))
  if (!log) return out
  // the session log
  out.push(u.blank('pfj-gap'), h.T(L.log, { bold: true, key: 'pfj' }))
  if (!m.log.length) out.push(h.T(L.log_none, { dim: true, key: 'pfj-none' }))
  m.log.forEach((e, i) => out.push(h.T(clip(`${String(new Date(e.at).getHours()).padStart(2, '0')}:${String(new Date(e.at).getMinutes()).padStart(2, '0')}  ${e.text}`, u.W), { key: 'pfj-' + i, tone: e.tone || undefined, dim: !e.tone, wrap: 'truncate-end' })))
  return out
}

/**
 * Another conversation's factory under its row in the graph: one step in behind a grey rule, then an empty line and a
 * thin rule before the next conversation. indent: the row's own indent (graph children).
 */
export function convUnder(u, P, L, cli, key, indent = 0) {
  const { h } = u
  const m = (P.convFactories || {})[cli]
  const step = indent + 2
  const inner = u.sub(step + 2)
  const lines = m && m.available ? factoryLines(inner, P, L, m, false) : [h.T(L.conv_no_factory, { dim: true, wrap: 'truncate-end', key: 'nf' })]
  return [
    h.col(inner.rule(lines, key + '-l'), { key, marginLeft: step }),
    h.col([u.blank('b')], { key: key + '-gap' }),
    sep(h, u.W + 1, key + '-sep', step),
  ]
}

/** « détails › / ⌄ »: unfolds a compact conversation's full card, folds it back. */
function detailsBtn(u, P, L, m) {
  return u.h.btn(`${L.details} ${m.compact ? '›' : '⌄'}`, () => P.act.nodeToggle(m.detailsKey, !m.compact), false, m.detailsKey)
}

/** model · effort · state, in its tone (amber « bloquée ? », green « travaille »), with « détails » at the right. */
function metaRow(u, P, L, m) {
  const { h } = u
  const lead = m.lead
  const text = [lead.model, lead.effort, lead.state].filter((v) => v && v !== '?').join(' · ')
  const meta = h.T(text, { dim: !lead.tone, tone: lead.tone, wrap: 'truncate-end', key: 'pl-meta' })
  if (!m.compactable) return meta
  return h.row([h.col([meta], { flexShrink: 1, key: 'l' }), h.col([detailsBtn(u, P, L, m)], { flexShrink: 0, key: 'r' })],
    { key: 'pl-meta-row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' })
}

/** A conversation with nothing running and little spent, in two lines: model · effort · state, then the context inline. */
function compactCard(u, P, L, m, noTitle) {
  const { h } = u
  const x = m.ctx
  const cells = Math.max(4, Math.min(12, Math.floor(u.W / 6)))
  const out = [noTitle ? null : u.title(m.lead.title, 'pl-title'), metaRow(u, P, L, m)]
  if (x && x.known) {
    const t = fill(L.ctx_inline, { pct: Math.round(x.pct), tokens: kTok(x.tokens), window: kTok(x.window) })
    out.push(h.row([h.col([h.T(t, { dim: !x.over, tone: x.over ? 'bad' : undefined, wrap: 'truncate-end' })], { flexShrink: 1, key: 'l' }),
      h.col([u.bar(x.pct, 'pl-ctx-bar', { cells, mark: x.markPct, tone: x.over ? 'bad' : undefined })], { flexShrink: 0, key: 'r' })],
    { key: 'pl-ctx-inline', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
    if (x.over) out.push(h.T(x.note, { tone: 'bad', wrap: 'truncate-end', key: 'pl-ctx-note' }))
  } else out.push(h.T(L.ctx_none, { dim: true, key: 'pl-ctx-none' }))
  return out.filter(Boolean)
}

/** Claude's Usage pane, for the lead: title, model · effort · state, the context row and bar, the stats grid. */
function leadCard(u, P, L, m, noTitle, o = {}) {
  const { h } = u
  const lead = m.lead
  const s = m.stats
  const x = m.ctx
  // in the tree (o.noMeta, o.noNote) the metrics line says model · effort · state and the row's red ⚠ the hand-off
  const kids = [
    noTitle ? null : u.title(lead.title, 'pl-title'),
    o.noMeta ? null : metaRow(u, P, L, m),
  ]
  if (x && x.known) {
    const tone = x.over ? 'bad' : x.pct >= 50 ? 'warn' : undefined
    kids.push(o.noMeta ? null : u.blank('pl-ctx-gap'),
      u.line(L.ctx_label, x.detail, `${Math.round(x.pct)} %`, { tone, key: 'pl-ctx' }),
      u.bar(x.pct, 'pl-ctx-bar', { mark: x.markPct, tone: x.over ? 'bad' : undefined }),
      x.over && !o.noNote ? h.T(x.note, { tone: 'bad', wrap: 'truncate-end', key: 'pl-ctx-note' }) : null)
  } else kids.push(h.T(L.ctx_none, { dim: true, key: 'pl-ctx-none' }))
  const pct = (v) => (v === null || v === undefined ? '—' : `${v} %`)
  kids.push(...u.grid([
    { label: L.stat_cost, value: s.cost === null ? '—' : fmtUsd(s.cost) },
    { label: L.stat_tokens, value: fmtTokens(s.tokens) },
    { label: L.stat_cache, value: pct(s.cacheHit) },
    { label: L.stat_subs, value: pct(s.subPct) },
    { label: L.stat_agents, value: `${s.running}/${s.agents}`, tone: s.running ? 'running' : undefined },
    { label: L.stat_tps, value: s.tps === null ? '—' : tpsText(s.tps) },
  ], 'pl-grid'))
  if (m.share.length) kids.push(h.T(`${L.models} : ${m.share.map((x) => `${x.family.charAt(0).toUpperCase() + x.family.slice(1)} ${x.pct} %`).join(' · ')}`, { dim: true, wrap: 'truncate-end', key: 'pl-share' }))
  // this conversation's tokens as a Sankey (fil principal / Workflows / agents → models) where the surface draws Svg;
  // « Ce qui contribue » stays the text fallback (lib/viz_sankey.mjs, hooks/viz_sankey.mjs)
  // under style.wide_cols columns the picture has no text in it and a legend under it: labels never overlap (Julian, 21 Oct)
  const narrow = (P.columns || 75) < (Number(u.c.style.wide_cols) || 60)
  const sk = m === P.factory && P.sankey && P.sankey.available
    ? h.svg(sankeySvg(P.sankey, { width: vizConfig(P.cfg).px(u.W), height: Math.min(120, 30 + 18 * Math.max(P.sankey.sources.length, P.sankey.models.length)), labels: !narrow }), sankeyAlt(P.sankey, { title: vizConfig(P.cfg).labels.sankey }), 'pl-sankey') : null
  if (sk) {
    kids.push(h.T(vizConfig(P.cfg).labels.sankey, { bold: true, key: 'pl-sankey-h' }), sk)
    if (narrow) {
      sankeyLegend(P.sankey).forEach((x, i) => kids.push(u.line(x.label, '', x.value, {
        leftEl: h.row([h.T('■', { color: x.hex }), h.T(clip(x.label, Math.max(4, u.W - len(x.value) - 4)), { wrap: 'truncate-end', dim: x.kind === 'source' })], { flexWrap: 'nowrap', gap: 1 }),
        boldValue: false, dimValue: x.kind === 'source', key: 'pl-sk-' + i,
      })))
    }
  }
  else if (m.contributors.length) {
    // the same thin bar as Barres (Svg on the desktop, ▰▱ elsewhere), the label left, the bar and % right
    kids.push(h.T(L.contributing, { bold: true, key: 'pl-contrib' }))
    const cells = Math.max(4, Math.min(12, Math.floor(u.W / 6)))
    m.contributors.forEach((x, i) => {
      const pctText = `${String(x.pct).padStart(2)} %`
      kids.push(h.row([
        h.col([h.T(clip(x.type, Math.max(4, u.W - cells - len(pctText) - 3)), { wrap: 'truncate-end' })], { flexShrink: 1, key: 'l' }),
        h.row([u.bar(x.pct, 'pl-ctb-' + i, { cells }), h.T(pctText)], { flexWrap: 'nowrap', gap: 1, flexShrink: 0, alignItems: 'center', key: 'r' }),
      ], { key: 'pl-ct-' + i, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
    })
  }
  return kids.filter(Boolean)
}

/**
 * Claude's Background-tasks pane, for one Workflow or the background agents (a finished card in « Terminés », or a
 * conversation unfolded in the graph). Folded = its mini card: « name › », a grey « Workflow  N agents  6h 56m », one
 * dot per agent. Unfolded: taskBody.
 */
function taskCard(u, P, L, k) {
  const { h } = u
  const open = k.open !== false
  // « Workflow  4 agents »: the count is never cut; short of room the ETA goes, then the word « Workflow »
  const count = fill(L.layer_count, { n: k.count })
  const left = `${k.kind === 'workflow' ? L.kind_workflow : L.kind_background}  ${count}`
  const kids = [
    h.row([h.btn(`${clip(k.title, Math.max(6, u.W - 4))} ${open ? '⌄' : '›'}`, () => P.act.nodeToggle(k.key, open), false, `pk-${k.key}-t`)],
      { key: `pk-${k.key}-tr`, alignItems: 'center', flexWrap: 'nowrap' }),
    u.line(left, k.eta ? fill(L.layer_eta, { time: k.eta }) : '', durText(k.elapsed, true), { whole: true, short: count, dimLeft: true, toneLeft: k.failed ? 'bad' : undefined, boldValue: false, dimValue: true, key: `pk-${k.key}-d` }),
    k.stalled ? h.T(clip(k.stalledText, u.W), { tone: 'warn', wrap: 'truncate-end', key: `pk-${k.key}-stall` }) : null,
    u.dots(k.dots || k.phases.flatMap((p) => p.dots), `pk-${k.key}-dots`, u.W - 4),
  ].filter(Boolean)
  if (!open) return kids
  return [...kids, ...taskBody(u, P, L, k)]
}

/**
 * The detail of a card: tokens and cost (under a macro line also « à l'arrêt ? », the agents, the exact time and the
 * ETA), then the Phases, each unfolding to its « Modèle | Temps » table.
 */
function taskBody(u, P, L, k, macro = false, noPhases = false) {
  const { h } = u
  const kids = []
  // a running card whose agents wrote nothing for conv.stall_min minutes: « à l'arrêt ? », amber
  if (macro && k.stalled) kids.push(h.T(clip(k.stalledText, u.W), { tone: 'warn', wrap: 'truncate-end', key: `pk-${k.key}-stall` }))
  const head = macro
    ? [fill(L.layer_count, { n: k.count }), fill(L.layer_tokens, { tokens: kTok(k.tokens) }), k.cost ? fmtUsd(k.cost) : '', durText(k.elapsed, true), k.eta ? fill(L.layer_eta, { time: k.eta }) : '']
    : [fill(L.layer_tokens, { tokens: kTok(k.tokens) }), k.cost ? fmtUsd(k.cost) : '']
  kids.push(h.T(clip(head.filter(Boolean).join('  '), u.W), { dim: true, wrap: 'truncate-end', key: `pk-${k.key}-n` }))
  if (macro && k.kind === 'workflow') kids.push(...drawWfGantt(u, P, k))
  // in the tree its agents are its children already: no Phases tables under it
  if (noPhases) return kids
  if (k.kind === 'workflow') kids.push(h.T(L.phases, { bold: true, key: `pk-${k.key}-ph` }))
  for (const p of k.phases) {
    const right = `${p.done}/${p.count}`
    // the phase's name takes what its count and dots leave (they never shrink)
    const room = Math.max(6, u.W - len(right) - Math.min(p.dots.length, 12) - 6)
    if (k.kind === 'workflow') {
      kids.push(h.row([
        h.col([h.btn(`${clip(p.title, room)} ${p.open ? '⌄' : '›'}`, () => P.act.nodeToggle(p.key, p.open), false, p.key)], { flexShrink: 1, key: 'l' }),
        h.row([h.T(right, { dim: true }), u.dots(p.dots, p.key + '-dots', 12)], { flexWrap: 'nowrap', gap: 1, flexShrink: 0, key: 'r' }),
      ], { key: p.key + '-row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
    }
    if ((k.kind !== 'workflow' || p.open) && p.agents.length) {
      // the agents one step in behind a grey rule, under their phase (or their card for the background agents)
      const a2 = u.sub(2)
      const rows = [tableHead(a2, L, p.key, 0)]
      for (const a of p.agents) rows.push(...agentLines(a2, L, a, `${p.key}-${a.id}`, 0))
      if (p.hidden) rows.push(h.T(`+ ${p.hidden}`, { dim: true, key: p.key + '-more' }))
      kids.push(...u.rule(rows, p.key + '-rule'))
    }
  }
  return kids
}

/** The grey header of Claude's table: « Modèle ........ Temps ». */
function tableHead(u, L, key, indent) {
  return u.h.row([u.line(L.col_model, '', L.col_time, { width: u.W - indent, dimLeft: true, boldValue: false, dimValue: true })], { key: key + '-head', marginLeft: indent, flexWrap: 'nowrap' })
}

/**
 * One agent, as a row of Claude's « Modèle | Temps » table (« ✓ Opus 5.5 ........ 1h 07m 29s », amber ● while it runs)
 * and a grey line under it with our extras: label · effort · tokens · tok/s · state. The numbers are never cut: an
 * extra that does not fit is left out whole (the state, then the effort), and only the label is shortened.
 */
function agentLines(u, L, a, key, indent) {
  const { h } = u
  const mark = a.status === 'running' ? '●' : a.status === 'failed' ? '✕' : a.status === 'done' ? '✓' : '○'
  const tone = a.status === 'running' ? 'ok' : a.status === 'failed' ? 'bad' : a.status === 'done' ? 'ok' : undefined
  const w = u.W - indent
  const time = a.ms ? durText(a.ms) : ''
  const nums = [`${kTok(a.tokens)} tok`, a.tps !== null && a.tps !== undefined ? `${tpsText(a.tps)} tok/s` : ''].filter(Boolean)
  const room = w - 2
  // the state only when the mark does not say it (✓ done, amber ● running): failed, stopped, waiting
  let extras = [a.effort, ...nums, a.status !== 'done' && a.status !== 'running' ? a.stateLabel : ''].filter(Boolean)
  const fits = (xs, lab) => len([lab, ...xs].filter(Boolean).join(' · ')) <= room
  if (!fits(extras, '')) extras = extras.filter((x) => x !== a.stateLabel)
  if (!fits(extras, '')) extras = extras.filter((x) => x !== a.effort)
  const labRoom = room - len(extras.join(' · ')) - (extras.length ? 3 : 0)
  const label = labRoom >= 4 ? clip(a.label, labRoom) : ''
  const meta = [label, ...extras].filter(Boolean).join(' · ')
  const model = a.model || '?'
  return [
    h.row([
      u.line(model, '', time, { width: w, boldValue: false, leftEl: h.row([h.T(mark, { tone }), h.T(clip(model, Math.max(4, w - len(time) - 4)), { wrap: 'truncate-end' })], { flexWrap: 'nowrap', gap: 1 }) }),
    ], { key: key + '-a', marginLeft: indent, flexWrap: 'nowrap' }),
    h.T(`${String.fromCharCode(160).repeat(indent + 2)}${meta}`, { dim: true, wrap: 'truncate-end', key: key + '-m' }),
  ]
}

// ---- 3. Conversations ----------------------------------------------------------------------------------------------------

/** The filter row: each button cycles its filter (the period through panel.convs.periods), on one line. */
function filterRow(u, P, L) {
  const { h } = u
  const s = P.syn
  const f = P.filter
  const periods = s ? s.periods : []
  const pi = periods.findIndex((p) => s && p.id === s.period.id)
  const nextPeriod = periods.length ? periods[(pi + 1) % periods.length].id : ''
  // the four labels on one line: past the pane's width, the short ones (« auj. », « Proj. »), then the project cut
  const who = f.who === 'codex' ? L.who_codex : L.who_claude
  const st = f.state ? L.states[f.state] : L.state
  const fits = (xs) => xs.reduce((a, x) => a + len(x) + 4, 0) + xs.length - 1 <= u.W
  let per = s && s.period ? s.period.label : ''
  let proj = clip(f.project || L.project, 16)
  if (!fits([per, proj, st, who].filter(Boolean))) per = s && s.period ? s.period.short || per : ''
  if (!fits([per, proj, st, who].filter(Boolean))) proj = f.project ? clip(f.project, 8) : L.project_short || proj
  return h.row([
    per ? h.btn(`${per} ▾`, () => P.act.pfilter('period', nextPeriod), false, 'pf-period') : null,
    h.btn(`${proj} ▾`, () => P.act.pcycle('project'), Boolean(f.project), 'pf-project'),
    h.btn(`${st} ▾`, () => P.act.pcycle('state'), Boolean(f.state), 'pf-state'),
    h.btn(`${who} ▾`, () => P.act.pfilter('who', f.who === 'codex' ? 'claude' : 'codex'), f.who === 'codex', 'pf-who'),
  ], { key: 'pf-row', alignItems: 'center' })
}

/**
 * The conversations as a tree (biggest consumer first): each one a node line (state mark, title, ⚠, › / ⌄) and a
 * metrics line (context bar and %, tokens, model · effort, state); the sub-conversations it spawned and its running
 * Workflows hang under it; › unfolds its card inside the tree with « ouvrir ↗ ». A sub-conversation whose parent is not
 * listed sits at the top with « ↖ lancée par … ». The filters and the total are behind « filtres › » (always shown while
 * a filter is set).
 */
function drawConvs(u, P, L, width) {
  const { h, c } = u
  const s = P.syn
  const f = P.filter
  const active = s && s.rows ? s.rows.filter((r) => r.state === 'running' || r.state === 'waiting').length : 0
  const fopen = Boolean(P.open.convs_filters) || Boolean(f.project || f.state || f.who === 'codex')
  const fbtn = { el: h.tbtn(`${L.convs_filters} ${fopen ? '⌄' : '›'}`, () => P.act.ptoggle('convs_filters'), 'pconvs-f', { plain: true }), w: len(L.convs_filters) + 4 }
  const out = [headLine(u, L.convs_head, s && s.hasData ? '· ' + fill(L.convs_active, { n: active }) : '', 'p-sec-convs', fbtn)]
  if (fopen) {
    out.push(h.col([filterRow(u, P, L),
      s && s.hasData ? u.line(L.total, s.period.label, `${fmtTokens(s.total.tokens)}${s.total.cost !== null ? ' · ' + fmtUsd(s.total.cost) : ''}`, { key: 'pc-total', dimLeft: true, boldValue: false }) : null,
    ], { key: 'pf-block', marginLeft: 2 }))
  }
  if (!s || !s.hasData) { out.push(h.T(L.no_data, { dim: true, key: 'pc-nodata' })); return h.col(out, { key: 'p-convs' }) }
  if (!s.rows.length) { out.push(h.T(L.no_rows, { dim: true, key: 'pc-none' })); return h.col(out, { key: 'p-convs' }) }
  const codex = f.who === 'codex'
  const wide = width >= (Number(c.style.wide_cols) || 60)
  if (codex) {
    s.rows.forEach((r) => out.push(u.line(r.label, '', fmtTokens(r.tokens), { key: 'pc-' + r.id, boldValue: false })))
  } else {
    // the sub-conversations under their parent (spawnedFrom), in the rows' order; a child whose parent is not listed
    // sits at the top with « ↖ lancée par <parent> »
    const bySid = new Map(s.rows.filter((r) => r.sid).map((r) => [r.sid, r]))
    const parentOf = (r) => (r.parent && r.parent !== r.sid ? bySid.get(r.parent) || null : null)
    const kids = new Map()
    const roots = []
    for (const r of s.rows) {
      // a loop in the links (should not happen): the row goes to the top
      let p = parentOf(r)
      const seen = new Set([r.id])
      for (let q = p; q; q = parentOf(q)) { if (seen.has(q.id)) { p = null; break } seen.add(q.id) }
      if (p) { if (!kids.has(p.id)) kids.set(p.id, []); kids.get(p.id).push(r) } else roots.push(r)
    }
    const nodeOf = (r, nested = false) => {
      const self = r.id === P.self
      const fm = self ? P.factory : (P.convFactories || {})[r.id]
      // › / ⌄: its children only (sub-conversations, running Workflows / agents, Terminés N ›); unfolded by default while
      // a Workflow, an agent or a sub-conversation of it runs (convFactories' kids); « détails › »: its card
      const open = Boolean(P.kids ? P.kids.has(r.id) : P.tree && P.tree.has(r.id))
      const key = self ? 'pself' : convKey(r.id)
      const link = r.sid && P.link ? fill(P.link, { id: r.sid }) : ''
      const subs = (kids.get(r.id) || []).map((x) => nodeOf(x, true))
      const isSub = nested || Boolean(r.parent && r.parent !== r.sid)
      const live = Boolean(fm && fm.available && fm.cards.length > 0)
      const dk = key + ':pdetails'
      const det = fm && fm.available ? { open: fm.detailsOpen, key: fm.detailsKey } : { open: Boolean(P.closed && P.closed[dk] === false), key: dk }
      return convNode(u, P, L, {
        key: 'pc-' + r.id, mark: bullet(u, isSub ? 'sub' : 'conv', (c.marks[r.mark] || c.marks.idle).tone), type: isSub ? L.type_sub : L.type_conv, title: r.label, titleKey: 'pcv-' + r.id, open,
        running: r.mark === 'working' || r.mark === 'stalled' || live, idle: r.mark === 'done' || r.mark === 'idle' || r.mark === 'archived',
        onToggle: () => P.act.nodeToggle(key, open), model: r.model, effort: r.effort, ctx: ctxOfRow(u, P, r.ctx), value: fmtTokens(r.tokens),
        state: r.mark !== 'idle' && r.mark !== 'stalled' && (L.graphe_states || {})[r.mark] ? L.graphe_states[r.mark] : r.stateLabel, from: r.parent && !parentOf(r) && r.parentTitle ? fill(L.graphe_from, { title: r.parentTitle }) : '',
        counts: countsOf(fm, subs.length),
        // this conversation's card is under « Cette conversation »: no « détails » on its row here
        details: self ? null : { ...det, onToggle: () => P.act.nodeToggle(det.key, det.open),
          lines: (inner) => detailLines(inner, P, L, fm, { cli: r.id, link, openLabel: wide ? L.open_conv : L.open_conv_short }) },
        // this conversation's Workflows are under « Cette conversation »
        children: childrenOf(u, P, L, fm, subs, !self),
      })
    }
    out.push(...drawTree(u, P, roots.map((r) => nodeOf(r)), ''))
  }
  if (s.others) out.push(u.line(s.others.label, '', `${fmtTokens(s.others.tokens)} · ${fmtUsd(s.others.cost)}`, { key: 'pc-others', dimLeft: true, boldValue: false, dimValue: true }))
  out.push(...drawDayGantt(u, P)) // « Aujourd’hui »: the Gantt of today's Workflows, one track per active conversation
  return h.col(out, { key: 'p-convs' })
}

// ---- 4. Quotas: one line, › Claude's Usage rows ------------------------------------------------------------------------

const oneLineRoom = (u, title) => u.W - (len(title) + 3) - 4

/** A one-line section: its bold title (a plain button that unfolds it), the fitted items, ›; unfolded, its detail. */
function oneLine(u, P, id, title, variants, body) {
  const { h } = u
  const open = Boolean(P.open[id])
  const toggle = () => P.act.ptoggle(id)
  const arrow = arrowItem(u, open, toggle, 'p-sec-' + id + '-x')
  const sum = (xs) => xs.reduce((a, x) => a + x.w + 1, 0)
  // what the items may take: the pane less the title's button ([title] and a gap) and the arrow
  const room = oneLineRoom(u, title)
  const v = variants.find((x) => sum(x) <= room) || variants[variants.length - 1] || []
  return h.col([
    h.row([
      h.row([h.tbtn(title, toggle, 'p-sec-' + id, { plain: true, bold: true }), ...v.map((x) => x.el)], { flexWrap: 'nowrap', gap: 1, alignItems: 'center', flexShrink: 1, key: 'l' }),
      h.row([arrow.el], { flexShrink: 0, key: 'r' }),
    ], { key: 'p-sec-' + id + '-row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }),
    open ? h.col(body(), { marginLeft: 2, key: 'p-' + id + '-micro' }) : null,
  ], { key: 'p-' + id })
}

function drawBarres(u, P, L, width) {
  const { h, c } = u
  const bars = P.bars || []
  const cells = cellsOf(c, width)
  const toneOf = (p) => (p !== null && p !== undefined && p >= 90 ? 'bad' : p !== null && p !== undefined && p >= 80 ? 'warn' : undefined)
  const narrow = Number(c.style.macro_cells_narrow) || 6
  const one = (b, label) => {
    if (!b) return { full: [], short: [], bare: [] }
    const tone = toneOf(b.pct)
    const lab = item(h, label, { dim: true })
    const pct = item(h, b.text, { bold: Boolean(tone), tone, dim: !tone })
    const known = b.pct !== null && b.pct !== undefined
    const bar = (n) => (known ? [{ el: u.bar(b.pct, 'pqb-' + b.id, { cells: n, tone }), w: n }] : [])
    return { full: [lab, ...bar(cells), pct], short: [lab, ...bar(Math.min(cells, narrow)), pct], bare: [lab, pct] }
  }
  const five = bars.find((b) => b.id === 'five')
  const week = bars.find((b) => b.id === 'week')
  const tps = bars.find((b) => b.id === 'tps')
  const f = one(five, L.quotas_five)
  const w = one(week, L.quotas_week)
  const reset = five && five.detail ? [item(h, '· ' + String(five.detail).replace(/^reset dans /, 'reset '), { dim: true })] : []
  const t = tps && tps.pct === null && tps.text !== L.unknown ? [item(h, tps.text.replace(/^(\d+)(\d{3}) /, (_, a, b) => `${a}.${b[0]}k `), { dim: true })] : []
  // the reset goes first, then the bars get short, then they go; the numbers stay
  const variants = [
    [...f.full, ...reset, ...w.full, ...t], [...f.full, ...w.full, ...t], [...f.short, ...w.short, ...t], [...f.bare, ...w.bare, ...t], [...f.bare, ...w.bare],
  ]
  return oneLine(u, P, 'barres', L.quotas_head, variants, () => {
    const out = []
    for (const b of bars) {
      const tone = toneOf(b.pct)
      if (b.pct === null || b.pct === undefined) { out.push(u.sub(2).line(b.label, b.id === 'tps' ? '' : b.detail, b.text, { key: 'pb-' + b.id })); continue }
      out.push(h.col([
        u.sub(2).line(b.label, b.detail, b.text, { tone, key: 'pb-' + b.id }),
        u.sub(2).bar(b.pct, 'pbb-' + b.id, { tone }),
        b.under ? h.T(b.under, { dim: true, wrap: 'truncate-end', key: 'pbu-' + b.id }) : null,
        ...quotaCurve(u, P, b.id),
      ], { key: 'pbc-' + b.id }))
    }
    return out
  })
}

// the 5 h / week curve with its dashed projection (Svg), and its sentence (every surface): lib/viz_quota.mjs
function quotaCurve(u, P, id) {
  const { h } = u
  const p = P.quotaCurves && P.quotaCurves[id]
  if (!p) return []
  const svg = h.svg(quotaSvg(p, { width: vizConfig(P.cfg).px(u.W - 2), height: 40 }), p.text || `${Math.round(p.last.pct)} %`, 'pqc-' + id)
  return [svg, p.text ? h.T(p.text, { tone: p.over ? 'bad' : undefined, dim: !p.over, bold: p.over, wrap: 'truncate-end', key: 'pqt-' + id }) : null]
}

// ---- 4b. Débit: one line, › tokens per second per model ------------------------------------------------------------

/**
 * Folded: the weighted TPS of each model in use over the shortest window that has replies (« opus 59 · sonnet 88 TPS
 * (30 min) »). Unfolded: one card per model in use (« Modèle : opus 5.5 », a grey header row, a row per window, the
 * numbers right-aligned in fixed columns; under the pane's width Plage then Temps go, then the headers get short; the
 * numbers are never cut), the models with no reply in 7 days behind « anciens › », the last streams, and the footnote
 * behind « comment c'est mesuré › ».
 */
const NBSP = String.fromCharCode(160)

function drawDebit(u, P, L) {
  const { h } = u
  const m = P.debit
  const mac = (m && m.macro) || { list: [], window: '' }
  const text = (n) => fill(L.debit_macro, { list: mac.list.slice(0, n).map((x) => `${x.label} ${Number.isFinite(x.tps) ? Math.round(x.tps) : '?'}`).join(' · '), window: mac.window })
  const variants = !m || !m.ready ? [[item(h, L.debit_no_file.split(' : ')[0], { dim: true })]]
    : !mac.list.length ? [[item(h, L.debit_none, { dim: true })]]
      : [...mac.list.map((_, i) => [item(h, text(mac.list.length - i), { dim: true })])]
  return oneLine(u, P, 'debit', L.debit_head, variants, () => debitBody(u.sub(2), P, L, m))
}

function debitBody(u, P, L, m) {
  const { h } = u
  if (!m || !m.ready) return [h.T(L.debit_no_file, { dim: true, wrap: 'truncate-end', key: 'pd-nofile' })]
  const out = []
  const C = L.debit_cols || {}
  const ids = ['n', 'tokens', 'time', 'tps', 'median', 'range']
  const cell = (r, id) => {
    if (!r.n) return id === 'n' ? '0' : '—'
    if (id === 'n') return String(r.n)
    if (id === 'tokens') return tokText(r.out)
    if (id === 'time') return durText(r.ms, true)
    if (id === 'tps') return debitTps(r.weighted)
    if (id === 'median') return debitTps(r.median)
    return `${debitTps(r.lo)}–${debitTps(r.hi)}`
  }
  const old = m.old || []
  if (!m.cards.length) out.push(h.T(L.debit_none, { dim: true, wrap: 'truncate-end', key: 'pd-none' }))
  // one set of column widths for every card, so the cards line up
  const all = [...m.cards, ...old]
  const values = (id) => all.flatMap((k) => k.rows.map((r) => cell(r, id)))
  const labelW = Math.max(len(C.window || ''), ...m.windows.map((w) => len(w.label || w.id)))
  const colsOf = (head) => ids.map((id) => ({ id, head: head[id] || '', w: Math.max(len(head[id] || ''), ...values(id).map(len)) }))
  let cols = fitColumns(colsOf(C), u.W, labelW)
  let head = C
  if (labelW + cols.reduce((a, x) => a + x.w + 1, 0) > u.W) {
    head = { ...C, ...(L.debit_cols_short || {}) }
    cols = fitColumns(colsOf(head), u.W, labelW)
  }
  const line = (left, cells, key, o = {}) => h.row([
    h.col([h.T(left, { dim: o.dim, wrap: 'truncate-end' })], { flexGrow: 1, key: 'l' }),
    ...cols.map((x, i) => h.col([h.T(String(cells[i] ?? '').padStart(x.w, NBSP), { dim: o.dim || (x.id !== 'tps' && !o.bold), bold: x.id === 'tps' && !o.dim })], { width: x.w, flexShrink: 0, alignItems: 'flex-end', key: x.id })),
  ], { key, flexWrap: 'nowrap', gap: 1 })
  const card = (k, ci, pre) => {
    if (ci) out.push(u.blank(`${pre}-${ci}-gap`))
    const title = fill(L.debit_model, { model: k.label })
    const sp = P.debitSpark && P.debitSpark[k.label]
    const cells = Math.max(6, Math.min(24, u.W - len(title) - 3))
    const spark = sp && cells >= 6 ? (h.svg(sparkSvg(sp, modelColor(k.label), { width: vizConfig(P.cfg).px(cells), height: 14 }), `${vizConfig(P.cfg).labels.spark} ${k.label}`, `${pre}-${ci}-sp`)
      || h.T(sparkText(sp.values, Math.min(12, cells)), { color: modelTone(k.label), key: `${pre}-${ci}-spt` })) : null
    out.push(spark ? h.row([h.T(title, { bold: true, wrap: 'truncate-end' }), spark], { key: `${pre}-${ci}-t`, flexWrap: 'nowrap', gap: 2, alignItems: 'center' })
      : h.T(title, { bold: true, key: `${pre}-${ci}-t` }))
    out.push(line(head.window || '', cols.map((x) => x.head), `${pre}-${ci}-h`, { dim: true }))
    k.rows.forEach((r, ri) => out.push(line(r.label, cols.map((x) => cell(r, x.id)), `${pre}-${ci}-${ri}`)))
  }
  m.cards.forEach((k, ci) => card(k, ci, 'pd'))
  if (m.hidden > 0) out.push(h.T(fill(L.debit_hidden, { n: m.hidden }), { dim: true, key: 'pd-hidden' }))
  if (old.length) {
    const oo = Boolean(P.open['pd-old'])
    out.push(u.blank('pd-old-gap'), h.row([h.tbtn(`${fill(L.debit_old, { n: old.length })} ${oo ? '⌄' : '›'}`, () => P.act.ptoggle('pd-old'), 'pd-old', { plain: true })], { key: 'pd-old-row' }))
    if (oo) old.forEach((k, ci) => card(k, ci, 'pdo'))
  }
  if (m.codex === 'unread') out.push(h.T(L.debit_codex_unread, { dim: true, key: 'pd-cx' }))
  // the last streams: « HH:MM:SS  opus 5.5 medium : 59.1 TPS (171 tok en 2.89 s) », TPS green at or above the
  // model's median, grey under it; when the line is too long the tail goes first, then the model is shortened
  if (m.streams.length) {
    out.push(u.blank('pd-s-gap'), h.T(fill(L.debit_recent, { n: m.streams.length }), { bold: true, key: 'pd-s' }))
    m.streams.forEach((s, i) => {
      const tps = `${debitTps(s.tps)} TPS`
      let tail = fill(L.debit_stream_tail, { tokens: s.out < 10000 ? String(s.out) : tokText(s.out), secs: secText(s.ms) })
      const pre = (model) => fill(L.debit_stream, { time: clockText(s.ts), model, effort: s.effort ? ' ' + s.effort : '' })
      if (len(pre(s.label)) + len(tps) + len(tail) + 2 > u.W) tail = ''
      const over = len(pre(s.label)) + len(tps) + (tail ? len(tail) + 1 : 0) + 1 - u.W
      const left = over > 0 ? pre(clip(s.label, Math.max(3, len(s.label) - over))) : pre(s.label)
      out.push(h.row([
        h.T(left, { dim: true, wrap: 'truncate-end' }),
        h.T(tps, { tone: s.fast ? 'ok' : undefined, dim: !s.fast, bold: s.fast }),
        tail ? h.T(tail, { dim: true }) : null,
      ], { key: 'pd-s-' + i, flexWrap: 'nowrap', gap: 1 }))
    })
  }
  const no = Boolean(P.open['pd-note'])
  out.push(u.blank('pd-n-gap'), h.row([h.tbtn(`${L.debit_how} ${no ? '⌄' : '›'}`, () => P.act.ptoggle('pd-note'), 'pd-how', { plain: true })], { key: 'pd-how-row' }))
  if (no) {
    out.push(h.T(L.debit_note, { dim: true, key: 'pd-note' }))
    if (m.codex === 'read') out.push(h.T(L.debit_codex_note, { dim: true, key: 'pd-cx-note' }))
  }
  return out
}

// ---- 5. Graphe: one line, › who waits, works, coordinates, by project ----------------------------------------------

function drawGrapheSection(u, P, L, width) {
  const { h } = u
  const m = P.graphe
  // the same effective window as every context bar (lib/panel.mjs effectiveWindow)
  const handoffPct = Math.round((100 * (Number(u.c.contexte.handoff_tokens) || 250000)) / (Number(P.ctxWindow) || Number(u.c.contexte.window) || 400000))
  const wide = width >= (Number(u.c.style.wide_cols) || 60)
  const sum = m && m.ready ? m.macro || m.summary : L.graphe_slot
  const variants = [[item(h, clip(sum, Math.max(6, oneLineRoom(u, L.graphe_head) - 1)), { dim: true })]]
  return oneLine(u, P, 'graphe', L.graphe_head, variants, () => [...grapheSvg(u, P, m, width - 3), ...drawGraphe(h, m, L, width - 3, P.act,
    { bar: u.bar, open: P.open, ctxCells: Number(u.c.style.ctx_cells) || 4, handoffPct, unfold: P.unfold, openLabel: wide ? L.open_conv : L.open_conv_short, noClick: true,
      under: (cli, pad) => convUnder(u.sub(2), P, L, cli, 'pgu-' + cli, pad) })])
}

// the graph as a diagram (lib/viz_graph.mjs): boxes per project, arrows parent → child, dashed peers; Svg only
function grapheSvg(u, P, m, width) {
  const v = vizConfig(P.cfg)
  if (!m || !m.ready || m.empty) return []
  let g = null
  try { g = graphLayout(m, { width: v.px(width), max: v.graph_max }) } catch { g = null }
  if (!g || !g.nodes.length) return []
  const s = u.h.svg(graphSvg(g), graphAlt(g, v.labels.graph), 'pg-svg')
  return s ? [s, u.blank('pg-svg-gap')] : []
}
