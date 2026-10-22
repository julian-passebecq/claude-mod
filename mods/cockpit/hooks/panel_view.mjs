// cockpit « Panneau » - draws the default view: ONE scrolling column, no tab bar. Since 22 Oct (Julian, 01:17-01:25:
// « there is a lot going on, it's not clear; you can do way better in UI/UX: visibility, indentation, bullets, agents,
// sub-agents, workflows, progress bars ») it reads top to bottom:
//   [green banner]  ● 6 conversations travaillent · 2 workflows · 5 agents · 1 CI          voir ›
//   [amber banner]  ◆ 1 t'attend : Galaxy portfolio · choisir la version        (only while someone waits)
//   CONVERSATIONS                                                                        filtres ›
//   ● Galaxy portfolio release  coord                                         ▰▰▰▱▱ 39 %
//   │  ● FOIL producer · cut  foil-factory                                    ▰▰▱▱▱ 28 %
//   │  │  ◇ wind-release · workflow                                           ▰▰▰▱▱ 3/5
//   │  │  │  ● coder · wind-assets                                         opus · 22 min
//   │  ○ Rayfin · version                                                au repos 12 min
//   ● MODS 1 (ici)                                              fil principal ▰▰▰▰▱ 76 %
//   ○ + 8 au repos ›
//   ─ Quotas · 5 h 2 % · sem 77 % ›   ─ Débit · opus 77 TPS ›   ─ Graphe · 17 conv ›   ─ Fichiers ›
// ONE list (lib/panel_list.mjs oneList), like the app's sidebar: children under their PARENT even in another project
// (the child's project grey on its row), the current conversation « (ici) », parent rows bold, coordinators a « coord »
// chip; a grey « │ » rule and panel.list.indent columns per level; under a conversation its running Workflows (◇, a
// progress bar done/total, amber « à l'arrêt » when stalled) and under each its running agents (● role · label,
// model · elapsed), the background agents ◦; at rest: ONE grey line « au repos N min »; the context bar at the right of
// every working / waiting row (blue, amber at style.ctx_warn_pct, red past the hand-off). The details (cost, tokens,
// cache, Sankey, journal, ouvrir ↗) only by a click on the row's title. Quotas, Débit, Graphe (its diagram and the day's
// Gantt) and Fichiers (with the other views) are one folded line each at the bottom.
// Pure except for the kit `h` and the callbacks in P.act.
import { panelConfig, fill, textBar, durText, kTok, convKey, minText } from '../lib/panel.mjs'
import { enCours, runningNow } from '../lib/panel_conv.mjs'
import { convList, oneList } from '../lib/panel_list.mjs'
import { activityCounts } from '../lib/core/activity.mjs'
import { fmtTokens, fmtUsd } from './nav.mjs'
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
 * P = { cfg, columns, now, open: {id: bool}, closed: {nodeKey: bool}, act, files: { head, rows, more, selected, attach,
 *       busy, error }, factory (this conversation's convFactory), syn (synthesis()), synAll, filter: {period, project,
 *       state, who}, bars, graphe, debit, ci, colors, ctxWindow, convList (lib/panel_list.mjs convList), convFactories:
 *       { [cli]: convFactory(...) | null }, otherViews }
 */
export function drawPanel(h, P) {
  const c = panelConfig(P.cfg)
  const L = c.labels
  const width = Math.max(30, P.columns || 75)
  const u = ui(h, P, c, width)
  const folds = { barres: drawBarres, debit: drawDebit, graphe: drawGrapheSection, fichiers: drawFiles }
  // the banners first (Julian, 21-22 Oct: « how do I know no work is in process? make it more visible »)
  const out = [drawEnCours(u, P, L)]
  const wait = drawClick(u, P, L)
  if (wait) out.push(wait)
  out.push(u.blank('p-gap-list'), drawConvs(u, P, L, width), u.blank('p-gap-folds'))
  // then one folded line each, in panel.order (an older order with « conv » or « fichiers » first still puts them here)
  for (const id of c.order) if (folds[id]) out.push(folds[id](u, P, L, width))
  return out
}


/** A tinted row (panel.banners): its background a theme key or a colour, one column of padding on each side. */
function banner(u, kind, lines, key) {
  const b = u.c.banners || {}
  const bg = b[kind + '_bg']
  return u.h.col(lines, { key, ...(bg ? { backgroundColor: bg } : {}), paddingX: 1 })
}

// ---- the amber banner: who waits for you (À toi de cliquer) -----------------------------------------------------------

/**
 * « ◆ 1 t’attend : title · reason · age » on an amber tint while a conversation waits for you (the app's
 * interruptedAwaitingPerson, or the open question factory's scan detects), oldest first; several: « ◆ 2 t’attendent »
 * then one line each. A click on a title opens it in the app. Nothing at all when nobody waits.
 */
function drawClick(u, P, L) {
  const { h } = u
  const m = P.graphe
  const list = (m && m.ready && m.waiting) || []
  if (!list.length) return null
  const open = (P.act && P.act.openConv) || (() => {})
  const fg = (u.c.banners || {}).warn_fg || ''
  const ink = (o = {}) => (fg ? { ...o, color: fg, tone: undefined } : { tone: 'warn', ...o })
  const W = u.W - 2
  const lines = []
  const one = list.length === 1
  const head = `◆ ${fill(one ? L.banner_wait_one : L.banner_wait_many, { n: list.length })}`
  if (!one) lines.push(h.T(head, { ...ink({ bold: true }), key: 'pk-click-h' }))
  for (const w of list) {
    const lead = one ? head : ' '
    const tail = '· ' + fill(L.graphe_wait_line, { reason: w.reason, age: w.age })
    // the title first (it is what you click), the reason takes what is left
    const room = Math.max(6, W - len(lead) - 4 - Math.min(len(tail), 10))
    const title = clip(w.title + (w.self ? ' ' + L.graphe_here : ''), room)
    lines.push(h.row([
      h.T(lead, ink({ bold: true })),
      h.tbtn(title, () => open(w.link), 'pgw-' + w.key, { plain: true, bold: true, ...(fg ? { color: fg } : { tone: 'warn' }) }),
      h.T(clip(tail, Math.max(4, W - len(lead) - len(title) - 4)), { ...ink(), wrap: 'truncate-end' }),
    ], { key: 'pk-click-' + w.key, flexWrap: 'nowrap', alignItems: 'center' }))
  }
  return banner(u, 'warn', lines, 'p-click')
}

// ---- the green banner: what runs now, every count shown ---------------------------------------------------------------

/**
 * « ● 6 conversations travaillent · 2 workflows · 5 agents · 1 CI   voir › » on a green tint: the conversations whose
 * main thread has a turn in progress or whose Workflow / agent runs (a click filters the list on « en cours »), the
 * running Workflows, the running agents (of a Workflow or not), the CI pipelines (the ci mod's cache, P.ci), the blocked
 * conversations in red; a zero in grey ○, never hidden (Julian, 21 Oct: « 0 workflow, 0 agent, 0 CI »); amber when
 * stalled, red when failed. « voir › » (or a count) unfolds « En ce moment ». Nothing runs: « ✓ Rien ne tourne · dernier
 * fini il y a 12 min (name) ». A CI cache older than encours.ci_stale_min: « CI : non lu depuis N min » in grey. Short
 * of room the words get short; a number is never cut.
 */
function drawEnCours(u, P, L) {
  const { h } = u
  const n = enCours({ syn: P.synAll || P.syn, factory: P.factory, factories: P.convFactories, self: P.self })
  const ci = P.ci || null
  const now = runningNow({ factory: P.factory, factories: P.convFactories, self: P.self, ci }, P.cfg)
  const k = activityCounts({ convs: n.convs, workflows: n.workflows, agents: n.agents, subagents: n.subagents, ci, blocked: n.blocked })
  const W = u.W - 2
  const ciGrey = k.ciStale ? (Number.isFinite(k.ciAgeMs) ? fill(L.encours_ci_stale, { age: minText(k.ciAgeMs) }) : L.encours_ci_unread) : ''
  const listed = now.list.length + now.ci.length
  if (k.idle && !listed) {
    const last = now.last && Number.isFinite(now.last.ago) ? fill(L.encours_idle_last, { age: minText(now.last.ago), name: now.last.name }) : ''
    const vs = [[L.encours_idle_short, last], [L.encours_idle_short]].map((v) => v.filter(Boolean).join(' · '))
    const text = vs.find((t) => len(t) <= W) || clip(vs[vs.length - 1], W)
    const lines = [h.T(text, { tone: 'ok', bold: true, wrap: 'truncate-end', key: 'p-encours-idle' })]
    if (ciGrey) lines.push(h.T(clip(ciGrey, W), { dim: true, wrap: 'truncate-end', key: 'p-encours-ci' }))
    return banner(u, 'ok', lines, 'p-encours')
  }
  const act = P.act || {}
  const open = Boolean(P.open && P.open.encours)
  const toggle = listed && act.ptoggle ? () => act.ptoggle('encours') : null
  const on = L.encours_bullet_on
  const off = L.encours_bullet_off
  // one count: its words (a plain button when it opens something), green / amber / red, grey at zero
  const count = (key, num, text, o = {}) => {
    const tone = !num ? undefined : o.bad ? 'bad' : o.warn ? 'warn' : 'ok'
    const press = num && !o.plain ? o.onPress || toggle : null
    return press && h.tbtn ? { el: h.tbtn(text, press, key, { plain: true, bold: true, tone }), w: len(text) + 2 } : item(h, text, { tone, bold: Boolean(num), dim: !num }, key)
  }
  const pl = (num, one, many) => fill(num > 1 ? many || one : one, { n: num })
  const ags = n.agents + n.subagents
  const conv = (short) => count('pec-conv', n.convs, short ? fill(L.encours_conv_short, { n: n.convs }) : !n.convs ? fill(L.encours_conv_zero, { n: 0 }) : pl(n.convs, L.encours_conv_one, L.encours_conv_many),
    { onPress: act.pfilter ? () => act.pfilter('state', 'running') : null })
  const wf = (short) => count('pec-wf', n.workflows, short ? fill(L.encours_wf_short, { n: n.workflows }) : pl(n.workflows, L.encours_wf_n, L.encours_wf_n_many), { warn: n.stalledWf > 0, bad: n.failed > 0 })
  const ag = (short) => count('pec-ag', ags, short ? fill(L.tree_agents_short, { n: ags }) : pl(ags, L.encours_agent_n, L.encours_agent_n_many), { warn: n.stalledWf > 0 || n.stalledSub > 0 })
  const ciItem = (short) => (k.ciStale ? item(h, short ? L.encours_ci_stale_short : ciGrey, { dim: true }, 'pec-ci')
    : count('pec-ci', k.ci, fill(L.encours_ci_n, { n: k.ci }), { bad: Boolean(ci && ci.failed) }))
  const blockedText = pl(n.blocked, L.encours_blocked_conv, L.encours_blocked_conv_many)
  const blocked = n.blocked ? count('pec-blocked', n.blocked, blockedText, { bad: true, onPress: act.pfilter ? () => act.pfilter('state', 'waiting') : null }) : null
  const mark = item(h, n.convs || ags || n.workflows || k.ci ? on : off, { tone: n.convs || ags || n.workflows || k.ci ? 'ok' : undefined, dim: !(n.convs || ags || n.workflows || k.ci) })
  const more = listed && toggle ? { el: h.tbtn(`${L.encours_more} ${open ? '⌄' : '›'}`, toggle, 'pec-more', { plain: true, dim: true }), w: len(L.encours_more) + 4 } : null
  const room = W - (more ? more.w + 1 : 0)
  const vs = [[conv(false), wf(false), ag(false), ciItem(false), blocked], [conv(false), wf(true), ag(false), ciItem(false), blocked],
    [conv(false), wf(true), ag(true), ciItem(false), blocked], [conv(true), wf(false), ag(false), ciItem(false), blocked], [conv(true), wf(true), ag(true), ciItem(false), blocked], [conv(true), wf(true), ag(true), ciItem(true), blocked]]
    .map((v) => [mark, ...withDots(u, v)])
  const line = h.row([
    h.row([fitLine(u, room, vs, 'pec-l1')], { flexShrink: 1, key: 'l' }),
    more ? h.row([more.el], { flexShrink: 0, key: 'r' }) : null,
  ], { key: 'p-encours-row', justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'center' })
  const out = [banner(u, 'ok', [line], 'p-encours-b')]
  if (open && listed) out.push(h.col(nowLines(u.sub(2), P, L, now), { key: 'p-now', marginLeft: 2 }))
  return h.col(out, { key: 'p-encours' })
}

/**
 * « En ce moment »: one entry per running agent (two lines: bullet, label, model · time at the right; under it, grey,
 * its path « Conv › workflow › phase »), the longest first; a conversation working with no agent: « fil principal ».
 */
function nowLines(u, P, L, now) {
  const { h } = u
  const list = now.list
  const pipes = now.ci || []
  const out = [h.T(fill('{head} ({n})', { head: L.now_head, n: list.length + pipes.length + (now.ciMore || 0) }), { bold: true, key: 'pn-h' })]
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
  // the running pipelines: « ◆ repo · branch   job · 12 min » (red when a job of it already failed)
  for (const p of pipes) {
    const title = fill(p.branch ? L.now_ci : L.now_ci_nobranch, { repo: p.repo, branch: p.branch })
    const right = withDots(u, [p.job ? item(h, p.job, { dim: true }) : null, item(h, p.status === 'queued' ? L.now_ci_queued : minText(p.ms), { dim: true })])
    out.push(macroRow(u, { key: 'pn-ci-' + p.key, lead: [markItem(u, { glyph: (u.c.bullets || {}).ci || '◆', tone: p.failed ? 'bad' : 'ok' })], title, bold: true,
      variants: [right, right.slice(-1)], minTitle: 12 }))
  }
  if (now.ciMore) out.push(h.T(`+${now.ciMore} CI`, { dim: true, key: 'pn-ci-more' }))
  return out
}

// ---- the macro rows ---------------------------------------------------------------------------------------------------

// ---- the rows ---------------------------------------------------------------------------------------------------------

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
  // o.whole: the first variant is extra (a word): kept only while the title stays whole, else skipped
  const vs = o.whole && o.variants.length > 1 ? o.variants.slice(1) : o.variants
  const v = (o.whole ? o.variants.find((x) => room(x, o.after || []) >= len(o.title)) : null) || vs.find((x) => room(x) >= Math.min(min, len(o.title))) || vs[vs.length - 1]
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
  return macroRow(u, { key: o.key, lead: [markItem(u, o.mark)], title: o.title, titleKey: o.titleKey, onPress: o.onPress, bold: o.bold, dim: o.dim, whole: o.whole,
    after: [...(o.type ? [item(u.h, o.type, { dim: true })] : []), ...(o.after || [])], variants: o.variants || [o.right || []], minTitle: o.minTitle ?? (o.variants ? 12 : 3), width })
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

// ---- the ONE list (Julian, 22 Oct 01:25) --------------------------------------------------------------------------------

/** The grey rule columns of a level: « │  » per level (panel.list.indent columns, its rule character first). */
function ruleOf(u, depth) {
  const q = u.c.list || {}
  const n = Math.max(2, Math.min(8, Number(q.indent) || 3))
  return ((q.rule || '│') + ' '.repeat(n - 1)).repeat(Math.max(0, depth))
}

/** A short age for a row at rest: « 12 min », « 2 h », « 3 j ». */
function restAge(ms) {
  const m = Math.max(0, Math.round((Number(ms) || 0) / 60000))
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} j`
}

/**
 * A row's bar at the right: Svg on the desktop (blue, colors.usage), ▰▱ text elsewhere in panel.list.bar_color; amber /
 * red by its tone. -> { el, w }.
 */
function barItem(u, pct, key, tone, mark) {
  const cells = Math.max(3, Number((u.c.list || {}).bar_cells) || 5)
  return { el: u.bar(Math.max(0, Math.min(100, pct)), key, { cells, tone, mark, textColor: (u.c.list || {}).bar_color }), w: cells }
}

/** The context of a row: its % of the effective window, amber at style.ctx_warn_pct, red past the hand-off. */
function ctxOf(u, P, x) {
  const m = x.m
  if (x.self && m && m.available && m.ctx && m.ctx.known) return { pct: m.ctx.pct, over: m.ctx.over, markPct: m.ctx.markPct }
  return ctxOfRow(u, P, x.row.ctx)
}

/**
 * The Panneau's list: the header « CONVERSATIONS  filtres › » (the filters and the total behind it, a grey « filtre :
 * … (réinitialiser) » line when a filter would hide a working conversation), then oneList()'s lines, one each. On the
 * Codex toggle: Codex's rows from usage, one line each.
 */
function drawConvs(u, P, L, width) {
  const { h } = u
  const s = P.syn
  const f = P.filter || {}
  const codex = f.who === 'codex'
  const list = codex ? null : listOf(P)
  const fopen = Boolean(P.open.convs_filters) || Boolean(f.project || f.state || codex)
  const fbtn = { el: h.tbtn(`${L.convs_filters} ${fopen ? '⌄' : '›'}`, () => P.act.ptoggle('convs_filters'), 'pconvs-f', { plain: true, dim: true }), w: len(L.convs_filters) + 4 }
  const out = [headLine(u, L.convs_head, '', 'p-sec-convs', fbtn)]
  if (fopen) {
    out.push(h.col([filterRow(u, P, L),
      s && s.hasData ? u.line(L.total, s.period.label, `${fmtTokens(s.total.tokens)}${s.total.cost !== null ? ' · ' + fmtUsd(s.total.cost) : ''}`, { key: 'pc-total', dimLeft: true, boldValue: false }) : null,
    ], { key: 'pf-block', marginLeft: 2 }))
  }
  if (list && list.note) {
    const btn = `(${L.convs_filter_reset})`
    out.push(h.row([h.T(clip(fill(L.convs_filter_note, { list: list.note }), Math.max(8, u.W - len(btn) - 2)), { dim: true, wrap: 'truncate-end' }),
      h.tbtn(btn, () => (P.act.preset || (() => {}))(), 'pconvs-reset', { plain: true, dim: true })], { key: 'pc-note', flexWrap: 'nowrap', gap: 1, alignItems: 'center' }))
  }
  if (codex) {
    if (!s || !s.hasData) out.push(h.T(L.no_data, { dim: true, key: 'pc-nodata' }))
    else if (!s.rows.length) out.push(h.T(L.no_rows, { dim: true, key: 'pc-none' }))
    else s.rows.forEach((r) => out.push(u.line(r.label, '', fmtTokens(r.tokens), { key: 'pc-' + r.id, boldValue: false })))
    return h.col(out, { key: 'p-convs' })
  }
  const model = listModel(P)
  if (!model.lines.length) { out.push(h.T(P.treeEmpty || L.no_rows, { dim: true, key: 'pc-none' })); return h.col(out, { key: 'p-convs' }) }
  const wide = width >= (Number(u.c.style.wide_cols) || 60)
  for (const x of model.lines) out.push(...lineEls(u, P, L, x, wide))
  return h.col(out, { key: 'p-convs' })
}

/** oneList() of the Panneau's data (exported for scripts/preview.mjs --real and the tests). */
export function listModel(P) {
  return oneList(listOf(P), { factories: P.convFactories, self: P.self, selfFactory: P.factory, cfg: P.cfg, restOpen: Boolean(P.open && P.open.convs_rest), nowMs: P.now })
}

/** One line of the list as elements: the row behind its rule columns, then (unfolded) its details under it. */
function lineEls(u, P, L, x, wide) {
  const { h, c } = u
  const prefix = ruleOf(u, x.depth)
  const w = u.W - len(prefix)
  const inner = u.sub(len(prefix))
  if (x.kind === 'rest') {
    const label = `${x.open ? L.list_rest_less : fill(L.list_rest, { n: x.n })} ${x.open ? '⌄' : '›'}`
    return [h.row([item(h, (c.marks.idle || {}).glyph || '○', { dim: true }).el, h.tbtn(label, () => P.act.ptoggle('convs_rest'), 'pconvs-rest', { plain: true, dim: true })],
      { key: 'pc-rest', flexWrap: 'nowrap', gap: 1, alignItems: 'center' })]
  }
  if (x.kind === 'agents_more') return [pre(u, prefix, h.T(clip(fill(L.agents_more, { n: x.n, agents: x.n === 1 ? L.agent_one : L.agent_many }), w), { dim: true, wrap: 'truncate-end' }), 'pcm-' + x.key)]
  if (x.kind === 'agent') {
    const a = x.agent
    const fam = String(a.model || '?').split(' ')[0].toLowerCase()
    const t = a.ms ? item(h, minText(a.ms), { dim: true }) : null
    const right = withDots(u, [item(h, fam, { dim: true }), t])
    return [pre(u, prefix, nodeHead(inner, { key: 'pla-' + x.key, mark: bullet(u, x.background ? 'background' : 'agent', 'running'), title: a.label, minTitle: 12,
      variants: [right, t ? [t] : []] }, w), 'pa-' + x.key)]
  }
  if (x.kind === 'workflow') {
    const k = x.card
    const toggle = () => P.act.nodeToggle(k.key, Boolean(k.open))
    const mark = bullet(u, 'workflow', k.failed ? 'failed' : k.stalled ? 'stalled' : k.live ? 'running' : 'done')
    const pct = x.total ? (100 * x.done) / x.total : 0
    const tone = k.failed ? 'bad' : k.stalled ? 'warn' : undefined
    const bar = barItem(u, pct, `plb-${k.key}`, tone)
    const n = item(h, `${x.done}/${x.total}`, { dim: !k.stalled, tone: k.stalled ? 'warn' : undefined })
    const right = k.stalled ? [bar, item(h, fill(L.wf_stalled, { age: minText(k.stalledMs) }), { tone: 'warn', bold: true })] : [bar, n]
    const out = [pre(u, prefix, nodeHead(inner, { key: 'plw-' + k.key, mark, title: k.title, titleKey: `pk-${k.key}-t`, onPress: toggle, bold: Boolean(k.live), dim: !k.live,
      type: L.list_wf, variants: [right, right.slice(-1)], minTitle: 10 }, w), 'pw-' + k.key)]
    if (k.open) {
      const dp = ruleOf(u, x.depth + 1)
      taskBody(u.sub(len(dp)), P, L, k, true, true).forEach((l, i) => out.push(pre(u, dp, l, `pwd-${k.key}-${i}`)))
    }
    return out
  }
  // a conversation
  const r = x.row
  const m = x.m
  const cat = r.cat || 'idle'
  const markId = cat === 'working' ? (r.mark === 'stalled' ? 'stalled' : 'working') : cat === 'waiting' ? (r.mark === 'blocked' ? 'blocked' : 'waiting') : r.mark === 'done' ? 'done' : 'idle'
  const mk = c.marks[markId] || c.marks.idle
  const idle = cat === 'idle'
  const key = x.self ? 'pself' : convKey(r.id)
  const dk = m && m.available ? m.detailsKey : x.self ? 'pdetails' : key + ':pdetails'
  const open = m && m.available ? Boolean(m.detailsOpen) : Boolean(P.closed && P.closed[dk] === false)
  const after = [
    r.coord ? chipItem(u, L.list_coord) : null,
    x.project ? item(h, x.project, { dim: true }) : null,
    x.self ? item(h, L.graphe_here, { dim: true }) : null,
  ].filter(Boolean)
  let right
  if (idle) {
    const ms = m && m.available && m.lead && Number.isFinite(m.lead.idleMs) ? m.lead.idleMs : Number.isFinite(P.now) && Number.isFinite(r.last) && r.last > 0 ? Math.max(0, P.now - r.last) : null
    right = ms === null ? [] : [item(h, fill(L.list_idle, { age: restAge(ms) }), { dim: true })]
    right = [right, []]
  } else {
    const cx = ctxOf(u, P, x)
    const tone = cx ? (cx.over ? 'bad' : cx.pct >= (Number(c.style.ctx_warn_pct) || 62.5) ? 'warn' : undefined) : undefined
    const pct = cx ? item(h, `${Math.round(cx.pct)} %`, { bold: Boolean(tone), tone, dim: !tone }) : null
    const bar = cx ? barItem(u, cx.pct, 'plc-' + r.id, tone) : null
    const warn = cx && cx.over ? item(h, L.handoff_mark || '⚠', { tone: 'bad', bold: true }) : null
    const live = m && m.available && m.live ? m.live : {}
    const main = m && m.available && m.lead && m.lead.mainBusy && !live.agents && !live.workflows ? item(h, L.list_main, { dim: true }) : null
    // a row that waits says it in amber (its ◆ too), before its context
    const asks = cat === 'waiting' ? item(h, markId === 'blocked' ? L.list_blocked : L.list_waiting, { tone: markId === 'blocked' ? 'bad' : 'warn' }) : null
    const ctxs = [warn, bar, pct].filter(Boolean)
    right = [[main || asks, ...ctxs].filter(Boolean), ctxs, [warn, pct].filter(Boolean)]
  }
  const head = nodeHead(inner, { key: 'plc-h-' + r.id, mark: { glyph: mk.glyph, tone: mk.tone }, title: r.label, titleKey: 'pcv-' + r.id,
    onPress: () => P.act.nodeToggle(dk, open), bold: !idle && (x.hasKids || x.depth === 0), dim: idle, after, variants: right, minTitle: 12, whole: !idle }, w)
  const out = [pre(u, prefix, head, 'pc-' + r.id)]
  if (open) {
    const dp = ruleOf(u, x.depth + 1)
    const link = r.sid && P.link ? fill(P.link, { id: r.sid }) : ''
    const lines = detailLines(u.sub(len(dp)), P, L, m, x.self ? {} : { cli: r.id, link, openLabel: wide ? L.open_conv : L.open_conv_short })
    lines.filter(Boolean).forEach((l, i) => out.push(pre(u, dp, l, `pcd-${r.id}-${i}`)))
  }
  return out
}

/** A small chip (« coord »): its own background (panel.list.chip_bg) where the surface draws one, plain grey text otherwise. */
function chipItem(u, text) {
  const q = u.c.list || {}
  const t = u.h.T(text, { dim: !q.chip_fg, ...(q.chip_fg ? { color: q.chip_fg } : {}) })
  return { el: q.chip_bg ? u.h.row([t], { backgroundColor: q.chip_bg, paddingX: 0, gap: 0, flexWrap: 'nowrap' }) : t, w: len(text) }
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
    // a list row's bar (o.textColor) is blue like its Svg unless amber / red; the others keep Claude's orange
    return s || h.T(textBar(pct, cells, P.cfg, o.mark), !o.tone && o.textColor ? { color: o.textColor, key } : { tone: o.tone || 'running', key })
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
 * The list CONVERSATIONS draws (lib/panel_list.mjs convList): P.convList when the Panneau built it, else one made from
 * P.syn's rows (a caller with usage rows only), every row fresh, the activity from EN COURS.
 */
function listOf(P) {
  if (P.convList) return P.convList
  const rows = ((P.syn && P.syn.rows) || []).filter((r) => r.id !== 'codex')
  const bySid = new Map(rows.filter((r) => r.sid).map((r) => [r.sid, r]))
  const pool = rows.map((r) => {
    const p = r.parent ? bySid.get(r.parent) : null
    return { ...r, group: r.project || '?', parentId: p && p.id !== r.id ? p.id : '', last: Infinity }
  })
  const n = enCours({ syn: { rows: pool }, factory: P.factory, factories: P.convFactories, self: P.self })
  return convList(pool, n, P.filter || {}, P.cfg, 0)
}


// ---- the folded lines at the bottom: Quotas, Débit, Graphe, Fichiers ----------------------------------------------------

const oneLineRoom = (u, title) => u.W - (len(title) + 3) - 6

/**
 * A folded line « ─ Title · summary  › »: a grey rule, its bold title (a plain button that unfolds it), the first of
 * `variants` (lists of items, fullest first) that fits, ›; unfolded (⌄), its detail under it.
 */
function oneLine(u, P, id, title, variants, body) {
  const { h } = u
  const open = Boolean(P.open[id])
  const toggle = () => P.act.ptoggle(id)
  const arrow = arrowItem(u, open, toggle, 'p-sec-' + id + '-x')
  const sum = (xs) => xs.reduce((a, x) => a + x.w + 1, 0)
  const room = oneLineRoom(u, title)
  const v = variants.find((x) => sum(x) <= room) || variants[variants.length - 1] || []
  const lead = v.length ? [dot(u), ...v] : []
  return h.col([
    h.row([
      h.row([h.T('─', { dim: true }), h.tbtn(title, toggle, 'p-sec-' + id, { plain: true, bold: true }), ...lead.map((x) => x.el)], { flexWrap: 'nowrap', gap: 1, alignItems: 'center', flexShrink: 1, key: 'l' }),
      h.row([arrow.el], { flexShrink: 0, key: 'r' }),
    ], { key: 'p-sec-' + id + '-row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }),
    open ? h.col(body(), { marginLeft: 2, key: 'p-' + id + '-micro' }) : null,
  ], { key: 'p-' + id })
}

/** Fichiers: its folded line (the cwd and the selection), unfolded data-goblin's tree, then the other views' commands. */
function drawFiles(u, P, L, width) {
  const { h } = u
  const f = P.files || { rows: [] }
  const summary = f.head ? `${f.head}${f.selected ? ' · ' + fill(L.files_selected, { path: f.selected }) : ''}` : ''
  const variants = summary ? [[item(h, clip(summary, Math.max(6, oneLineRoom(u, L.fichiers) - 1)), { dim: true })], []] : [[]]
  return oneLine(u, P, 'fichiers', L.fichiers, variants, () => {
    const out = [h.row([h.T(f.head || L.files_none, { bold: true, wrap: 'truncate-end' }), h.btn(f.busy ? '…' : L.files_refresh, () => P.act.filesRefresh(), false, 'f-refresh')],
      { key: 'f-head', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' })]
    if (f.head && !(f.rows || []).length) out.push(h.T(L.files_empty, { dim: true, key: 'f-empty' }))
    for (const r of f.rows || []) {
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
    // the old views (Cockpit cards, Mission, …): their /cockpit commands, one grey line
    if (P.otherViews) out.push(u.blank('f-other-gap'), h.T(clip(P.otherViews, u.W - 2), { dim: true, wrap: 'truncate-end', key: 'p-other-views' }))
    return out
  })
}

/** Quotas: « 5 h 21 % · sem 85 % · 852 tok/s » (amber at 80 %, red at 90 %); unfolded, Claude's Usage rows and curves. */
function drawBarres(u, P, L) {
  const { h } = u
  const bars = P.bars || []
  const toneOf = (p) => (p !== null && p !== undefined && p >= 90 ? 'bad' : p !== null && p !== undefined && p >= 80 ? 'warn' : undefined)
  const one = (b, label) => {
    if (!b) return null
    const tone = toneOf(b.pct)
    return item(h, `${label} ${b.text}`, { bold: Boolean(tone), tone, dim: !tone })
  }
  const five = one(bars.find((b) => b.id === 'five'), L.quotas_five)
  const week = one(bars.find((b) => b.id === 'week'), L.quotas_week)
  const tps = bars.find((b) => b.id === 'tps')
  const t = tps && tps.pct === null && tps.text !== L.unknown ? item(h, tps.text.replace(/^(\d+)(\d{3}) /, (_, a, b) => `${a}.${b[0]}k `), { dim: true }) : null
  const variants = [withDots(u, [five, week, t]), withDots(u, [five, week]), withDots(u, [five])]
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

// ---- Graphe: one folded line; unfolded the diagram only (the list above is the one list) and the day's Gantt ------

function drawGrapheSection(u, P, L, width) {
  const { h } = u
  const m = P.graphe
  const sum = m && m.ready ? m.macro || m.summary : L.graphe_slot
  const variants = [[item(h, clip(sum, Math.max(6, oneLineRoom(u, L.graphe_head) - 3)), { dim: true })]]
  return oneLine(u, P, 'graphe', L.graphe_head, variants, () => [...grapheSvg(u, P, m, width - 3), ...drawDayGantt(u.sub(2), P)])
}

// the graph as a diagram (lib/viz_graph.mjs): boxes per project, arrows parent → child, dashed peers; Svg where the
// surface draws it, its one-sentence alt in grey elsewhere
function grapheSvg(u, P, m, width) {
  const v = vizConfig(P.cfg)
  if (!m || !m.ready || m.empty) return []
  let g = null
  try { g = graphLayout(m, { width: v.px(width), max: v.graph_max }) } catch { g = null }
  if (!g || !g.nodes.length) return []
  const alt = graphAlt(g, v.labels.graph)
  const s = u.h.svg(graphSvg(g), alt, 'pg-svg')
  return s ? [s, u.blank('pg-svg-gap')] : [u.h.T(alt, { dim: true, key: 'pg-alt' }), u.blank('pg-svg-gap')]
}
