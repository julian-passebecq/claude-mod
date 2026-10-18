// cockpit « Panneau » - draws the default view: ONE scrolling column, no tab bar, top to bottom, each section foldable
// (its header is a button ▾/▸ with a one-line summary while closed). The look copies Claude's own Usage and
// Background-tasks panes (Julian, 17 Oct 18:10): a card is a bold title and rows, a row is « label … grey detail
// bold value » over a thin full-width bar (Svg where the surface has it, ▰▱ otherwise), small stats grids, phases with
// ■□ dots; no box-drawing borders. The left text is cut, never the numbers.
//   ▸ Fichiers                 filetree's tree (hooks/files.mjs), folded by default
//   ▾ Cette conversation       lead card (Usage-like), one card per Workflow / background agents (folded: Claude's mini
//                              card with one dot per agent; unfolded: phases, each a « Modèle | Temps » table), Terminés N ›, log
//   ▾ Toutes les conversations one filter row (« aujourd'hui ▾ » « Projet ▾ » « État ▾ » « Claude ▾ »), one line per
//                              conversation (state mark, title, tokens, thin bar, %), Workflows actifs (name, dots, › only)
//   ▾ Barres                   Session 5 h, Semaine, Codex, Crédits cloud (« 249 $ sur 250 $ », expire le …), tok/s
//   ▾ Graphe des conversations À toi de cliquer, filters, projects → conversations (hooks/graphe_view.mjs)
//   then one grey line, cut: the old views and their /cockpit commands
// State marks and colours (panel.marks, Julian 18 Oct): ● travaille green, ◆ t'attend amber, ✕ bloquée red, ✓ finie
// and ○ inactive grey, the same in « Toutes les conversations », the graph and its legend.
// Pure except for the kit `h` and the callbacks in P.act.
import { panelConfig, fill, textBar, durText, kTok, convKey } from '../lib/panel.mjs'
import { convFactorySummary, modelName } from '../lib/panel_conv.mjs'
import { fmtTokens, fmtUsd } from './nav.mjs'
import { drawGraphe } from './graphe_view.mjs'
import { meterSvg } from './svg.mjs'

const len = (s) => [...String(s ?? '')].length
const clip = (t, n) => {
  const a = [...String(t ?? '')]
  return a.length > n ? a.slice(0, Math.max(1, n - 1)).join('') + '…' : a.join('')
}

/**
 * P = { cfg, columns, open: {id: bool}, closed: {nodeKey: bool}, act, files: { head, rows, more, selected, attach, busy, error },
 *       factory (lib/panel_conv.mjs convFactory), syn (synthesis()), filter: {period, project, state, who}, bars: [...],
 *       workflows: [...], graphe, colors, unfold: Set of the clis whose factory is drawn under their row,
 *       convFactories: { [cli]: convFactory(...) of that conversation | null } }
 * Between two sections: an empty line and a thin grey rule (Julian, 18 Oct: « breathing room »).
 */
export function drawPanel(h, P) {
  const c = panelConfig(P.cfg)
  const L = c.labels
  const width = Math.max(30, P.columns || 75)
  const u = ui(h, P, c, width)
  const parts = { fichiers: drawFiles, conv: drawConv, convs: drawConvs, barres: drawBarres, graphe: drawGrapheSection }
  const out = []
  for (const id of c.order) {
    const part = parts[id](u, P, L, width)
    if (!part) continue
    if (out.length) out.push(sep(h, width, 'p-sep-' + id))
    out.push(part)
  }
  if (P.otherViews) out.push(h.T(clip(P.otherViews, width), { dim: true, wrap: 'truncate-end', key: 'p-other-views' }))
  return out
}

/** A thin grey rule across the pane, under an empty line (the section above keeps its marginBottom). */
function sep(h, width, key, indent = 0) {
  return h.col([h.T('─'.repeat(Math.max(4, width - 1 - indent)), { dim: true, wrap: 'truncate-end' })], { key, marginBottom: 1, ...(indent ? { marginLeft: indent } : {}) })
}

/** The render hook of section 5 (« Graphe des conversations »). */
export { drawGraphe }

// ---- the primitives of Claude's panes, from the kit ----------------------------------------------------------------

function ui(h, P, c, width) {
  const st = c.style
  const colors = P.colors || {}
  const W = width - 1 // a section's body sits one column in
  // « label … detail value »: the label is cut first, then the detail dropped; the value is never cut
  const line = (left, detail, value, o = {}) => {
    const v = String(value ?? '')
    let d = String(detail ?? '')
    const w = o.width || W
    if (d && w - len(v) - len(d) - 2 < Math.min(8, len(left))) d = ''
    const room = Math.max(4, w - len(v) - (d ? len(d) + 1 : 0) - 1)
    return h.row([
      o.leftEl || h.T(clip(left, room), { bold: o.bold, dim: o.dimLeft, tone: o.toneLeft, wrap: 'truncate-end' }),
      h.row([d ? h.T(d, { dim: true }) : null, v ? h.T(v, { bold: o.boldValue !== false, tone: o.tone, dim: o.dimValue }) : null], { flexWrap: 'nowrap', gap: 1 }),
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
  // each (so a left rule can run along every line)
  const blank = (key) => h.T(' ', { key })
  const grid = (cells, key, per = 3) => {
    const rows = [blank(key + '-top')]
    for (let i = 0; i < cells.length; i += per) {
      const part = cells.slice(i, i + per)
      while (part.length < per) part.push(null)
      const one = (f, k) => h.row(part.map((x, j) => h.col([x ? f(x) : h.T(' ')], { flexGrow: 1, key: `${key}-${i}-${k}-${j}` })), { flexWrap: 'nowrap', key: `${key}-${i}-${k}` })
      rows.push(one((x) => h.T(x.label, { dim: true, wrap: 'truncate-end' }), 'l'), one((x) => h.T(x.value, { bold: true, tone: x.tone, wrap: 'truncate-end' }), 'v'))
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
  // the title in bold, heading size where the surface has sizes (Julian, 18 Oct: « titres plus visibles »)
  const head = h.tbtn ? h.tbtn(label, () => P.act.ptoggle(id), 'p-sec-' + id, { bold: true, size: 'heading' }) : h.btn(label, () => P.act.ptoggle(id), false, 'p-sec-' + id)
  return h.col([
    h.row([head, summary && !open && room > 8 ? h.T(clip(summary, room), { dim: true, wrap: 'truncate-end' }) : null],
      { alignItems: 'center', flexWrap: 'nowrap' }),
    open ? h.col(body(), { marginLeft: 1 }) : null,
  ], { key: 'p-' + id, marginBottom: 1 })
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

function drawConv(u, P, L, width) {
  const { h } = u
  const m = P.factory
  const summary = P.convSummary || convFactorySummary(m)
  return section(u, P, 'conv', L.conv, summary, () => {
    if (!m || !m.available) return [h.T(P.treeEmpty || L.no_tree, { dim: true, key: 'pt-empty' })]
    return factoryLines(u, P, L, m, true)
  }, width)
}

/**
 * A conversation's factory as one-line elements, top to bottom: the lead's card, then its Workflow / background cards
 * one step in behind a grey rule (their agents one step further), « Terminés N › », and (log) the session log. The
 * same for « Cette conversation » and for a conversation unfolded under its row.
 */
export function factoryLines(u, P, L, m, log) {
  const { h } = u
  // under its row the conversation's title is the row itself: the card starts at model · effort · state
  const out = [...leadCard(u, P, L, m, !log), u.blank('pl-end')]
  const inner = u.sub(2)
  const cards = []
  if (!m.cards.length && !m.finished) out.push(h.T(L.no_layer, { dim: true, wrap: 'truncate-end', key: 'pf-nolayer' }))
  m.cards.forEach((k, i) => { if (i) cards.push(u.blank(`pk-${k.key}-gap`)); cards.push(...taskCard(inner, P, L, k)) })
  if (m.finished) {
    const f = m.finished
    if (cards.length) cards.push(u.blank(f.key + '-gap'))
    cards.push(h.row([h.btn(`${fill(L.finished, { n: f.count })} ${f.open ? '⌄' : '›'}`, () => P.act.nodeToggle(f.key, f.open), false, f.key)], { key: f.key + '-row' }))
    if (f.open) for (const k of f.cards) cards.push(u.blank(`pk-${k.key}-gap`), ...taskCard(inner, P, L, k))
  }
  out.push(...u.rule(cards, 'pk-rule'))
  if (!log) return out
  // the session log
  out.push(u.blank('pfj-gap'), h.T(L.log, { bold: true, key: 'pfj' }))
  if (!m.log.length) out.push(h.T(L.log_none, { dim: true, key: 'pfj-none' }))
  m.log.forEach((e, i) => out.push(h.T(clip(`${String(new Date(e.at).getHours()).padStart(2, '0')}:${String(new Date(e.at).getMinutes()).padStart(2, '0')}  ${e.text}`, u.W), { key: 'pfj-' + i, tone: e.tone || undefined, dim: !e.tone, wrap: 'truncate-end' })))
  return out
}

/**
 * Another conversation's factory, under its row (« Toutes les conversations », graph): one step in behind a grey rule,
 * then an empty line and a thin rule before the next conversation. indent: the row's own indent (graph children).
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

/** Claude's Usage pane, for the lead: title, model · effort · state, the context row and bar, the stats grid. */
function leadCard(u, P, L, m, noTitle) {
  const { h } = u
  const lead = m.lead
  const s = m.stats
  const x = m.ctx
  const kids = [
    noTitle ? null : u.title(lead.title, 'pl-title'),
    h.T([lead.model, lead.effort, lead.state].filter(Boolean).join(' · '), { dim: !lead.live, tone: lead.live ? 'ok' : undefined, wrap: 'truncate-end', key: 'pl-meta' }),
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
    kids.push(h.T(L.contributing, { bold: true, key: 'pl-contrib' }))
    const cells = Math.max(4, Math.min(12, Math.floor(u.W / 6)))
    m.contributors.forEach((x, i) => kids.push(u.line(x.type, '', `${textBar(x.pct, cells, P.cfg)} ${x.pct} %`, { key: 'pl-ct-' + i, boldValue: false })))
  }
  return kids.filter(Boolean)
}

/**
 * Claude's Background-tasks pane, for one Workflow or the background agents. Folded = its mini card: « name › », a grey
 * « Workflow  N agents  6h 56m », one dot per agent. Unfolded: tokens and cost, then the Phases, each unfolding to the
 * « Modèle | Temps » table of its agents.
 */
function taskCard(u, P, L, k) {
  const { h } = u
  const open = k.open !== false
  const left = `${k.kind === 'workflow' ? L.kind_workflow : L.kind_background}  ${fill(L.layer_count, { n: k.count })}`
  const kids = [
    h.row([h.btn(`${clip(k.title, Math.max(6, u.W - 4))} ${open ? '⌄' : '›'}`, () => P.act.nodeToggle(k.key, open), false, `pk-${k.key}-t`)],
      { key: `pk-${k.key}-tr`, alignItems: 'center', flexWrap: 'nowrap' }),
    u.line(left, k.eta ? fill(L.layer_eta, { time: k.eta }) : '', durText(k.elapsed, true), { dimLeft: true, toneLeft: k.failed ? 'bad' : undefined, boldValue: false, dimValue: true, key: `pk-${k.key}-d` }),
    u.dots(k.dots || k.phases.flatMap((p) => p.dots), `pk-${k.key}-dots`, u.W - 4),
  ]
  if (!open) return kids
  kids.push(h.T([fill(L.layer_tokens, { tokens: kTok(k.tokens) }), k.cost ? fmtUsd(k.cost) : ''].filter(Boolean).join('  '), { dim: true, wrap: 'truncate-end', key: `pk-${k.key}-n` }))
  if (k.kind === 'workflow') kids.push(h.T(L.phases, { bold: true, key: `pk-${k.key}-ph` }))
  for (const p of k.phases) {
    const right = `${p.done}/${p.count}`
    const room = Math.max(6, u.W - len(right) - Math.min(p.dots.length, 12) - 6)
    if (k.kind === 'workflow') {
      kids.push(h.row([
        h.btn(`${clip(p.title, room)} ${p.open ? '⌄' : '›'}`, () => P.act.nodeToggle(p.key, p.open), false, p.key),
        h.row([h.T(right, { dim: true }), u.dots(p.dots, p.key + '-dots', 12)], { flexWrap: 'nowrap', gap: 1 }),
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

// ---- 3. Toutes les conversations ---------------------------------------------------------------------------------------

function drawConvs(u, P, L, width) {
  const { h } = u
  const s = P.syn
  const f = P.filter
  const c = u.c
  const summary = s && s.hasData ? `${s.period.label} · ${fmtTokens(s.total.tokens)} tok${s.total.cost !== null ? ' · ' + fmtUsd(s.total.cost) : ''}${s.rows[0] ? ' · ' + clip(s.rows[0].label, 24) : ''}` : ''
  return section(u, P, 'convs', L.convs, summary, () => {
    const out = []
    // one compact row: each button cycles its filter (the period through panel.convs.periods)
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
    out.push(h.row([
      per ? h.btn(`${per} ▾`, () => P.act.pfilter('period', nextPeriod), false, 'pf-period') : null,
      h.btn(`${proj} ▾`, () => P.act.pcycle('project'), Boolean(f.project), 'pf-project'),
      h.btn(`${st} ▾`, () => P.act.pcycle('state'), Boolean(f.state), 'pf-state'),
      h.btn(`${who} ▾`, () => P.act.pfilter('who', f.who === 'codex' ? 'claude' : 'codex'), f.who === 'codex', 'pf-who'),
    ], { key: 'pf-row', alignItems: 'center', marginBottom: 1 }))
    if (!s || !s.hasData) out.push(h.T(L.no_data, { dim: true, key: 'pc-nodata' }))
    else if (!s.rows.length) out.push(h.T(L.no_rows, { dim: true, key: 'pc-none' }))
    else {
      const wide = width >= (Number(c.style.wide_cols) || 60)
      const cells = wide ? Number(c.style.bar_cells_wide) || 10 : Number(c.style.bar_cells) || 6
      const tot = s.total.tokens || 1
      // one line per conversation: mark, title (a button: unfolds its factory under the row, › / ⌄), tokens, the thin
      // bar of Barres (Svg on the desktop), %, « ouvrir ↗ » (opens it in the app). Codex rows: no factory, no button.
      const foldable = f.who !== 'codex'
      const openLabel = width >= (Number(c.style.wide_cols) || 60) ? L.open_conv : L.open_conv_short
      s.rows.forEach((r, i) => {
        const pct = Math.round((100 * r.tokens) / tot)
        const mk = c.marks[r.mark] || c.marks.idle
        const tok = fmtTokens(r.tokens)
        const pctText = `${String(pct).padStart(2)} %`
        // « ouvrir ↗ »: not on this conversation's own row, and left out when the title would have no room
        let link = foldable && r.sid && P.link && r.id !== P.self ? fill(P.link, { id: r.sid }) : ''
        const open = foldable && P.unfold ? P.unfold.has(r.id) : false
        const base = u.W - len(tok) - cells - len(pctText) - 6 - (foldable ? 4 : 0)
        if (link && base - len(openLabel) - 3 < 8) link = ''
        const room = Math.max(4, base - (link ? len(openLabel) + 3 : 0))
        const title = foldable
          ? h.btn(`${clip(r.label, room)} ${open ? '⌄' : '›'}`, () => P.act.nodeToggle(convKey(r.id), open), false, 'pcv-' + r.id)
          : h.T(clip(r.label, room), { bold: r.state !== 'done', dim: r.state === 'done', wrap: 'truncate-end' })
        out.push(h.row([
          h.row([h.T(mk.glyph, { tone: mk.tone === 'dim' ? undefined : mk.tone, dim: mk.tone === 'dim' }), title], { flexWrap: 'nowrap', gap: 1, alignItems: 'center' }),
          h.row([h.T(tok, { dim: true }), u.bar(pct, 'pcb-' + i, { cells }), h.T(pctText, { bold: true }), link ? h.btn(openLabel, () => P.act.openConv(link), false, 'pco-' + r.id) : null], { flexWrap: 'nowrap', gap: 1, alignItems: 'center' }),
        ], { key: 'pc-' + i, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
        if (open) out.push(...convUnder(u, P, L, r.id, 'pcu-' + r.id))
      })
      if (s.others) out.push(u.line(s.others.label, '', `${fmtTokens(s.others.tokens)} · ${fmtUsd(s.others.cost)}`, { key: 'pc-others', dimLeft: true, boldValue: false, dimValue: true }))
      out.push(u.line(L.total, s.period.label, `${fmtTokens(s.total.tokens)}${s.total.cost !== null ? ' · ' + fmtUsd(s.total.cost) : ''}`, { key: 'pc-total', bold: true }))
    }
    out.push(...workflowsBody(u, P, L))
    return out
  }, width)
}

// Workflows actifs of every conversation: the name as plain text, the agent dots right-aligned, the fold arrow alone a
// button; unfolded, its agents
function workflowsBody(u, P, L) {
  const { h } = u
  const wfs = P.workflows || []
  const out = [h.col([h.T(L.workflows, { bold: true })], { key: 'pw-title', marginTop: 1 })]
  if (!wfs.length) out.push(h.T(L.no_workflows, { dim: true, key: 'pw-none' }))
  for (const w of wfs) {
    const open = Boolean(P.open[w.key])
    const nums = `${kTok(w.tokens)} ${w.running}/${w.count}`
    const nd = Math.min(w.agents.length, 10)
    out.push(h.row([
      h.row([h.btn(open ? '⌄' : '›', () => P.act.ptoggle(w.key), false, 'pw-' + w.key), h.T(clip(w.name, Math.max(6, u.W - len(nums) - nd - 10)), { wrap: 'truncate-end' })], { flexWrap: 'nowrap', gap: 1, alignItems: 'center' }),
      h.row([h.T(nums, { dim: true }), u.dots(w.agents.map((a) => (a.status === 'running' ? 'running' : a.status === 'failed' ? 'failed' : a.status === 'done' ? 'done' : 'waiting')), 'pwd-' + w.key, 10)], { flexWrap: 'nowrap', gap: 1 }),
    ], { key: 'pwr-' + w.key, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
    if (open) {
      if (w.agents.length) out.push(tableHead(u, L, 'pwa-' + w.key, 2))
      w.agents.forEach((a) => out.push(...agentLines(u, L, { ...a, model: modelName(a.model), stateLabel: (L.agent_states || {})[a.status] || a.status, ms: 0, tps: null }, `pwa-${w.key}-${a.id}`, 2)))
      if (w.hidden) out.push(h.T(`+ ${w.hidden}`, { dim: true, key: `pwh-${w.key}` }))
    }
  }
  return out
}

// ---- 4. Barres: Claude's Usage rows ----------------------------------------------------------------------------------

function drawBarres(u, P, L, width) {
  const { h } = u
  const bars = P.bars || []
  const summary = bars.filter((b) => b.pct !== null && b.pct !== undefined).map((b) => `${b.label} ${b.text}`).join(' · ')
  return section(u, P, 'barres', L.barres, summary, () => {
    const out = []
    for (const b of bars) {
      const tone = b.pct !== null && b.pct >= 90 ? 'bad' : b.pct !== null && b.pct >= 80 ? 'warn' : undefined
      if (b.pct === null || b.pct === undefined) { out.push(u.line(b.label, b.id === 'tps' ? '' : b.detail, b.text, { key: 'pb-' + b.id })); continue }
      out.push(h.col([
        u.line(b.label, b.detail, b.text, { tone, key: 'pb-' + b.id }),
        u.bar(b.pct, 'pbb-' + b.id, { tone }),
        b.under ? h.T(b.under, { dim: true, wrap: 'truncate-end', key: 'pbu-' + b.id }) : null,
      ], { key: 'pbc-' + b.id, marginBottom: 1 }))
    }
    return out
  }, width)
}

// ---- 5. Graphe des conversations ------------------------------------------------------------------------------------

function drawGrapheSection(u, P, L, width) {
  const m = P.graphe
  const handoffPct = Math.round((100 * (Number(u.c.contexte.handoff_tokens) || 250000)) / (Number(u.c.contexte.window) || 400000))
  const wide = width >= (Number(u.c.style.wide_cols) || 60)
  return section(u, P, 'graphe', L.graphe, m && m.ready ? m.summary : '', () => drawGraphe(u.h, m, L, width - 1, P.act,
    { bar: u.bar, open: P.open, ctxCells: Number(u.c.style.ctx_cells) || 4, handoffPct, unfold: P.unfold, openLabel: wide ? L.open_conv : L.open_conv_short,
      under: (cli, pad) => convUnder(u, P, L, cli, 'pgu-' + cli, pad) }), width)
}
