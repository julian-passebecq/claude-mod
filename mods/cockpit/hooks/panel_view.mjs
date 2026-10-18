// cockpit « Panneau » - draws the default view: ONE scrolling column, no tab bar. Since 19 Oct it opens on a MACRO view
// (Julian: « all the good info but hard to read; a macro view where I see everything quickly, a micro view when I
// click »): one line per conversation and one line per Workflow under it (├ / └), one line each for the quotas, the
// tokens per second and the graph. Every detail of the earlier cards is still there, one click away (› / ⌄, kept in
// $.store): the lead's Usage-like card, the stats grid, « Ce qui contribue », the session log, the phases and their
// « Modèle | Temps » tables, the bars, the Débit tables, the graph.
//   À toi de cliquer           one amber line at the very top while a conversation waits for Julian, nothing otherwise
//   ▸ Fichiers                 filetree's tree (hooks/files.mjs), folded by default
//   CETTE CONVERSATION         ● title  opus·med  ctx ▰▰▰▱ 30 %  $9.50  ›   then its running Workflows:
//                                ├ ● name  1/4 ■●□□  phase · 1 opus  20 min · fin ~16:55  ›
//   CONVERSATIONS · N actives  one line per conversation (filters behind « filtres › »), its Workflows under it
//   QUOTAS                     5 h ▰▰▱ 21 % · reset …  sem ▰▰▰▰ 85 %  852 tok/s  ›   (› the Usage-like bars)
//   DÉBIT                      opus 59 · sonnet 88 TPS (30 min)  tableau ›   (› one table per model, the last streams)
//   GRAPHE                     6 conv · 1 coord · rien ne t'attend  ›   (› filters, projects → conversations)
//   then one grey line, cut: the old views and their /cockpit commands
// Colours: one state colour per line (its mark: ● travaille green, ◆ t'attend amber, ✕ bloquée red, ⚠ à l'arrêt amber,
// ✓ / ○ grey); a number is bold and coloured only when it is alarming (context at style.ctx_warn_pct amber, past the
// hand-off red with ⚠, a quota at 80 % amber, 90 % red); the rest is grey or plain. At 45, 60 or 75 columns a row cuts
// its title first, then drops the ETA, then the model, then the bars; a number is never cut.
// Pure except for the kit `h` and the callbacks in P.act.
import { panelConfig, fill, textBar, durText, kTok, convKey, markOf, minText, modelShort } from '../lib/panel.mjs'
import { modelName } from '../lib/panel_conv.mjs'
import { fmtTokens, fmtUsd } from './nav.mjs'
import { drawGraphe } from './graphe_view.mjs'
import { meterSvg } from './svg.mjs'
import { tpsText as debitTps, secText, clockText, fitColumns, tokText } from '../lib/debit.mjs'

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
  return h.col(lines, { key: 'p-click', marginBottom: 1 })
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
  const room = (v) => width - sum(o.lead || []) - sum(v) - btn
  const min = o.minTitle ?? 12
  const v = o.variants.find((x) => room(x) >= Math.min(min, len(o.title))) || o.variants[o.variants.length - 1]
  const r = Math.max(3, room(v))
  const text = clip(o.title, r)
  const title = o.onPress
    ? h.tbtn(text, o.onPress, o.titleKey, { plain: true, bold: o.bold })
    : h.T(text, { bold: o.bold, dim: o.dim, wrap: 'truncate-end' })
  return h.row([
    h.row([...(o.lead || []).map((x) => x.el), title], { flexWrap: 'nowrap', gap: 1, alignItems: 'center', flexShrink: 1, key: 'l' }),
    v.length ? h.row(v.map((x) => x.el), { flexWrap: 'nowrap', gap: 1, alignItems: 'center', flexShrink: 0, key: 'r' }) : null,
  ], { key: o.key, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', ...(o.indent ? { marginLeft: o.indent } : {}) })
}

const item = (h, text, o = {}, key) => ({ el: h.T(String(text), { ...o, ...(key ? { key } : {}) }), w: len(text) })
const markItem = (u, mk) => item(u.h, mk.glyph, { tone: mk.tone === 'dim' ? undefined : mk.tone, dim: mk.tone === 'dim' })
const arrowItem = (u, open, onPress, key) => ({ el: u.h.tbtn(open ? '⌄' : '›', onPress, key, { plain: true }), w: 3 })
const cellsOf = (c, width) => (width >= (Number(c.style.wide_cols) || 60) ? Number(c.style.macro_cells) || 10 : Number(c.style.macro_cells_narrow) || 6)

/** The context of a row: « ctx ▰▰▰▱ 77 % ⚠ », amber and bold at style.ctx_warn_pct, red with ⚠ past the hand-off. */
function ctxItems(u, x, key, cells) {
  const { h, c } = u
  if (!x || !Number.isFinite(x.pct)) return { full: [], bare: [] }
  const tone = x.over ? 'bad' : x.pct >= (Number(c.style.ctx_warn_pct) || 62.5) ? 'warn' : undefined
  const pct = item(h, `${Math.round(x.pct)} %`, { bold: Boolean(tone), tone, dim: !tone })
  const warn = x.over ? [item(h, c.labels.handoff_mark || '⚠', { tone: 'bad', bold: true })] : []
  const word = item(h, 'ctx', { dim: true })
  const bar = { el: u.bar(Math.min(100, x.pct), key, { cells, tone, mark: x.markPct }), w: cells }
  return { full: [word, bar, pct, ...warn], noBar: [word, pct, ...warn], bare: [pct, ...warn] }
}

/**
 * A conversation's macro line. o: { key, mark (panel.marks entry), title, titleKey, onToggle, open, model, effort,
 * ctx: { pct, over, markPct } | null, value (cost or tokens), indent }.
 */
function convMacro(u, P, L, o) {
  const { h, c } = u
  const cells = cellsOf(c, P.columns || 75)
  const cx = ctxItems(u, o.ctx, o.key + '-bar', cells)
  const model = modelShort(o.model, o.effort, P.cfg)
  const m = model ? [item(h, model, { dim: true })] : []
  const val = o.value ? [item(h, o.value, { dim: true })] : []
  const arrow = arrowItem(u, o.open, o.onToggle, o.titleKey + '-x')
  const vs = cx.full.length
    ? [[...m, ...cx.full, ...val, arrow], [...cx.full, ...val, arrow], [...cx.noBar, ...val, arrow], [...cx.bare, ...val, arrow]]
    : [[...m, ...val, arrow], [...val, arrow]]
  return macroRow(u, { key: o.key, lead: [markItem(u, o.mark)], title: o.title, titleKey: o.titleKey, onPress: o.onToggle, variants: vs, indent: o.indent, minTitle: 14 })
}

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

/**
 * A Workflow (or the background agents) as one line under its conversation: tree glyph, state mark, name, done/count
 * and one dot per agent, the running phase(s), how many agents run on which model, the time (or « à l'arrêt 1 h 09 »
 * amber), the ETA. Its › unfolds the card's detail (tokens, cost, phases, « Modèle | Temps » tables).
 */
function wfMacro(u, P, L, k, last, indent) {
  const { h } = u
  const agents = k.phases.flatMap((p) => p.agents)
  const done = agents.filter((a) => a.status === 'done').length
  const mark = k.failed ? { glyph: '✕', tone: 'bad' } : k.stalled ? { glyph: '⚠', tone: 'warn' } : k.live ? { glyph: '●', tone: 'ok' } : { glyph: '✓', tone: 'dim' }
  const phase = k.kind === 'workflow' ? k.phases.filter((p) => p.running > 0 && p.title !== L.phase_default && p.title !== k.title).map((p) => p.title).join('+') : ''
  const fam = {}
  for (const a of agents) if (a.status === 'running') { const f = String(a.model || '?').split(' ')[0].toLowerCase(); fam[f] = (fam[f] || 0) + 1 }
  const models = Object.entries(fam).map(([f, n]) => fill(L.wf_running, { n, model: f })).join('+')
  const time = k.stalled ? item(h, fill(L.wf_stalled, { age: minText(k.stalledMs) }), { tone: 'warn', bold: true }) : item(h, minText(k.elapsed), { dim: true })
  const eta = k.eta ? [item(h, '· ' + fill(L.wf_eta, { time: k.eta }), { dim: true })] : []
  const count = item(h, `${done}/${agents.length || k.count}`, { dim: true })
  const dots = macroDots(u, k.dots || [], `pkd-${k.key}`)
  const detail = (xs) => (xs.filter(Boolean).length ? [item(h, xs.filter(Boolean).join(' · '), { dim: true })] : [])
  const arrow = arrowItem(u, k.open, () => P.act.nodeToggle(k.key, k.open), `pk-${k.key}-x`)
  const head = [count, dots]
  const vs = [
    [...head, ...detail([phase, models]), time, ...eta, arrow],
    [...head, ...detail([phase, models]), time, arrow],
    [...head, ...detail([phase]), time, arrow],
    [...head, time, arrow],
    [count, time, arrow],
  ]
  return macroRow(u, { key: `pkm-${k.key}`, lead: [item(h, last ? '└' : '├', { dim: true }), markItem(u, mark)], title: k.title, titleKey: `pk-${k.key}-t`,
    onPress: () => P.act.nodeToggle(k.key, k.open), variants: vs, indent, minTitle: 10, width: u.W - (indent || 0) })
}

/** A conversation's running Workflows as ├ / └ lines, each unfolding its detail one step further in. */
function wfLines(u, P, L, cards, indent, key) {
  const out = []
  cards.forEach((k, i) => {
    out.push(wfMacro(u, P, L, k, i === cards.length - 1, indent))
    if (k.open) {
      const inner = u.sub(indent + 4)
      out.push(u.h.col(inner.rule(taskBody(inner, P, L, k, true), `${key}-${k.key}-r`), { key: `${key}-${k.key}-micro`, marginLeft: indent + 2 }))
    }
  })
  return out
}

/** A conversation's micro view under its row: « ouvrir ↗ » (another conversation), its card, Terminés, the log. */
function convMicro(u, P, L, m, o) {
  const { h } = u
  const step = (o.indent || 0) + 2
  const inner = u.sub(step + 2)
  const lines = []
  if (o.link) lines.push(h.row([h.btn(o.openLabel || L.open_conv, () => P.act.openConv(o.link), false, 'pco-' + o.cli)], { key: 'pco-row-' + o.cli }))
  if (m && m.available) lines.push(...factoryLines(inner, P, L, m, o.log, { noTitle: true, noLive: o.noLive }))
  else lines.push(h.T(L.conv_no_factory, { dim: true, wrap: 'truncate-end', key: 'nf' }))
  return h.col([...inner.rule(lines, o.key + '-l'), u.blank(o.key + '-gap')], { key: o.key, marginLeft: step })
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

/** This conversation: its macro line, its running Workflows under it; › unfolds its card, Terminés and its log. */
function drawConv(u, P, L) {
  const { h, c } = u
  const m = P.factory
  const out = [headLine(u, L.conv_head, '', 'p-sec-conv')]
  if (!m || !m.available) return h.col([...out, h.T(P.treeEmpty || L.no_tree, { dim: true, key: 'pt-empty' })], { key: 'p-conv' })
  const open = P.closed && P.closed.pself === false
  const toggle = () => P.act.nodeToggle('pself', open)
  const x = m.ctx && m.ctx.known ? m.ctx : null
  const s = m.stats
  out.push(convMacro(u, P, L, {
    key: 'pself-row', mark: c.marks[markOf(m.lead.stateId)] || c.marks.idle, title: m.lead.title, titleKey: 'pself', onToggle: toggle, open,
    model: m.lead.model, effort: m.lead.effort, ctx: x ? { pct: x.pct, over: x.over, markPct: x.markPct } : null,
    value: s.cost === null || s.cost === undefined ? (s.tokens ? fmtTokens(s.tokens) : '') : fmtUsd(s.cost),
  }))
  // its running Workflows right under its line, then (unfolded) its card
  out.push(...wfLines(u, P, L, m.cards, 2, 'pself-wf'))
  if (open) out.push(convMicro(u, P, L, m, { key: 'pself-micro', log: true, noLive: true }))
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
function leadCard(u, P, L, m, noTitle) {
  const { h } = u
  const lead = m.lead
  const s = m.stats
  const x = m.ctx
  const kids = [
    noTitle ? null : u.title(lead.title, 'pl-title'),
    metaRow(u, P, L, m),
  ]
  if (x && x.known) {
    const tone = x.over ? 'bad' : x.pct >= 50 ? 'warn' : undefined
    kids.push(u.blank('pl-ctx-gap'),
      u.line(L.ctx_label, x.detail, `${Math.round(x.pct)} %`, { tone, key: 'pl-ctx' }),
      u.bar(x.pct, 'pl-ctx-bar', { mark: x.markPct, tone: x.over ? 'bad' : undefined }),
      x.over ? h.T(x.note, { tone: 'bad', wrap: 'truncate-end', key: 'pl-ctx-note' }) : null)
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
  if (m.contributors.length) {
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
function taskBody(u, P, L, k, macro = false) {
  const { h } = u
  const kids = []
  // a running card whose agents wrote nothing for conv.stall_min minutes: « à l'arrêt ? », amber
  if (macro && k.stalled) kids.push(h.T(clip(k.stalledText, u.W), { tone: 'warn', wrap: 'truncate-end', key: `pk-${k.key}-stall` }))
  const head = macro
    ? [fill(L.layer_count, { n: k.count }), fill(L.layer_tokens, { tokens: kTok(k.tokens) }), k.cost ? fmtUsd(k.cost) : '', durText(k.elapsed, true), k.eta ? fill(L.layer_eta, { time: k.eta }) : '']
    : [fill(L.layer_tokens, { tokens: kTok(k.tokens) }), k.cost ? fmtUsd(k.cost) : '']
  kids.push(h.T(clip(head.filter(Boolean).join('  '), u.W), { dim: true, wrap: 'truncate-end', key: `pk-${k.key}-n` }))
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
 * One line per conversation (biggest consumer first): state mark, title, model · effort, context bar and %, tokens, ›.
 * Its running Workflows follow as ├ / └ lines; › unfolds its card under it with « ouvrir ↗ ». The filters and the total
 * are behind « filtres › » (always shown while a filter is set).
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
  s.rows.forEach((r) => {
    if (codex) { out.push(u.line(r.label, '', fmtTokens(r.tokens), { key: 'pc-' + r.id, boldValue: false })); return }
    const self = r.id === P.self
    const fm = (P.convFactories || {})[r.id]
    const open = self ? P.closed && P.closed.pself === false : Boolean(P.unfold && P.unfold.has(r.id))
    const key = self ? 'pself' : convKey(r.id)
    out.push(convMacro(u, P, L, {
      key: 'pc-' + r.id, mark: c.marks[r.mark] || c.marks.idle, title: r.label, titleKey: 'pcv-' + r.id, open,
      onToggle: () => P.act.nodeToggle(key, open), model: r.model, effort: r.effort, ctx: ctxOfRow(u, P, r.ctx), value: fmtTokens(r.tokens),
    }))
    if (self) return // its card and Workflows are under « Cette conversation »
    const live = fm && fm.available && P.tree && P.tree.has(r.id) ? fm.cards : []
    out.push(...wfLines(u, P, L, live, 2, 'pc-wf-' + r.id))
    if (open) {
      const link = r.sid && P.link ? fill(P.link, { id: r.sid }) : ''
      out.push(convMicro(u, P, L, fm, { key: 'pcu-' + r.id, cli: r.id, link, openLabel: wide ? L.open_conv : L.open_conv_short, noLive: live.length > 0 }))
    }
  })
  if (s.others) out.push(u.line(s.others.label, '', `${fmtTokens(s.others.tokens)} · ${fmtUsd(s.others.cost)}`, { key: 'pc-others', dimLeft: true, boldValue: false, dimValue: true }))
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
      ], { key: 'pbc-' + b.id }))
    }
    return out
  })
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
    out.push(h.T(fill(L.debit_model, { model: k.label }), { bold: true, key: `${pre}-${ci}-t` }))
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
  return oneLine(u, P, 'graphe', L.graphe_head, variants, () => drawGraphe(h, m, L, width - 3, P.act,
    { bar: u.bar, open: P.open, ctxCells: Number(u.c.style.ctx_cells) || 4, handoffPct, unfold: P.unfold, openLabel: wide ? L.open_conv : L.open_conv_short, noClick: true,
      under: (cli, pad) => convUnder(u.sub(2), P, L, cli, 'pgu-' + cli, pad) }))
}
