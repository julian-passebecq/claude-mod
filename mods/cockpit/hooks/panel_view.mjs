// cockpit « Panneau » - draws the default view: ONE scrolling column, no tab bar, top to bottom, each section foldable
// (its header is a button ▾/▸ with a one-line summary while closed). The look copies Claude's own Usage and
// Background-tasks panes (Julian, 17 Oct 18:10): a card is a bold title and rows, a row is « label … grey detail
// bold value » over a thin full-width bar (Svg where the surface has it, ▰▱ otherwise), small stats grids, phases with
// ■□ dots; no box-drawing borders. The left text is cut, never the numbers.
//   ▸ Fichiers                 filetree's tree (hooks/files.mjs), folded by default
//   ▾ Cette conversation       lead card (Usage-like), one card per Workflow / background agents, Terminés N ›, log
//   ▾ Toutes les conversations filters, compact rows (dot, title, tokens, bar, %), Workflows actifs
//   ▾ Barres                   Session 5 h, Semaine, Codex, crédits, tok/s
//   ▾ Graphe des conversations À toi de cliquer, filters, projects → conversations (hooks/graphe_view.mjs)
//   then one grey line: the old views and their /cockpit commands
// Pure except for the kit `h` and the callbacks in P.act.
import { panelConfig, fill, textBar, durText, kTok } from '../lib/panel.mjs'
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
 *       workflows: [...], graphe, colors }
 */
export function drawPanel(h, P) {
  const c = panelConfig(P.cfg)
  const L = c.labels
  const width = Math.max(30, P.columns || 75)
  const u = ui(h, P, c, width)
  const parts = { fichiers: drawFiles, conv: drawConv, convs: drawConvs, barres: drawBarres, graphe: drawGrapheSection }
  const out = c.order.map((id) => parts[id](u, P, L, width)).filter(Boolean)
  if (P.otherViews) out.push(h.T(P.otherViews, { dim: true, key: 'p-other-views' }))
  return out
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
    const s = h.svg(meterSvg(pct, { width: Math.round(cells * (Number(st.bar_px) || 7)), color, track: colors.track, mark: o.mark, markColor: colors.warn }), `${Math.round(pct)} %`, key)
    return s || h.T(textBar(pct, cells, P.cfg, o.mark), { tone: o.tone || 'running', key })
  }
  // a stats grid: cells [{ label, value }], `per` per row, each a grey label over a bold value
  const grid = (cells, key, per = 3) => {
    const rows = []
    for (let i = 0; i < cells.length; i += per) {
      const part = cells.slice(i, i + per)
      while (part.length < per) part.push(null)
      rows.push(h.row(part.map((x, j) => h.col(x ? [h.T(x.label, { dim: true, wrap: 'truncate-end' }), h.T(x.value, { bold: true, tone: x.tone, wrap: 'truncate-end' })] : [h.T(' ')],
        { flexGrow: 1, key: `${key}-${i}-${j}` })), { flexWrap: 'nowrap', key: `${key}-${i}` }))
    }
    return h.col(rows, { key, marginTop: 1 })
  }
  // ■ done, ■ running (blue), □ pending, ✕ failed: a run of Texts so each keeps its colour
  const dots = (list, key) => {
    const glyph = { done: st.dot_done, running: st.dot_running, failed: '✕', stopped: st.dot_pending, waiting: st.dot_pending }
    const tone = { running: 'running', failed: 'bad' }
    const runs = []
    for (const s of list) {
      const last = runs[runs.length - 1]
      if (last && last.s === s) last.n++
      else runs.push({ s, n: 1 })
    }
    return h.row(runs.map((r, i) => h.T(String(glyph[r.s] || st.dot_pending).repeat(r.n), { tone: tone[r.s], dim: r.s === 'stopped' || r.s === 'waiting', key: `${key}-${i}` })), { gap: 0, flexWrap: 'nowrap' })
  }
  const title = (text, key, o = {}) => h.T(text, { bold: true, size: 'heading', wrap: 'truncate-end', key, tone: o.tone })
  const card = (key, kids) => h.col(kids, { key, marginBottom: 1 })
  return { h, c, W, line, bar, grid, dots, title, card }
}

function section(u, P, id, title, summary, body, width) {
  const { h } = u
  const open = Boolean(P.open[id])
  const label = `${open ? '▾' : '▸'} ${title}`
  const room = width - len(label) - 6
  return h.col([
    h.row([h.btn(label, () => P.act.ptoggle(id), false, 'p-sec-' + id), summary && !open && room > 8 ? h.T(clip(summary, room), { dim: true, wrap: 'truncate-end' }) : null],
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
    const out = [leadCard(u, P, L, m)]
    if (!m.cards.length && !m.finished) out.push(h.T(L.no_layer, { dim: true, key: 'pf-nolayer' }))
    for (const k of m.cards) out.push(taskCard(u, P, L, k))
    if (m.finished) {
      const f = m.finished
      out.push(h.row([h.btn(`${fill(L.finished, { n: f.count })} ${f.open ? '⌄' : '›'}`, () => P.act.nodeToggle(f.key, f.open), false, f.key)], { key: f.key + '-row', marginBottom: f.open ? 0 : 1 }))
      if (f.open) for (const k of f.cards) out.push(taskCard(u, P, L, k))
    }
    // the session log
    out.push(h.T(L.log, { bold: true, key: 'pfj' }))
    if (!m.log.length) out.push(h.T(L.log_none, { dim: true, key: 'pfj-none' }))
    m.log.forEach((e, i) => out.push(h.T(clip(`${String(new Date(e.at).getHours()).padStart(2, '0')}:${String(new Date(e.at).getMinutes()).padStart(2, '0')}  ${e.text}`, u.W), { key: 'pfj-' + i, tone: e.tone || undefined, dim: !e.tone, wrap: 'truncate-end' })))
    return out
  }, width)
}

/** Claude's Usage pane, for the lead: title, model · effort · state, the context row and bar, the stats grid. */
function leadCard(u, P, L, m) {
  const { h } = u
  const lead = m.lead
  const s = m.stats
  const x = m.ctx
  const kids = [
    u.title(lead.title, 'pl-title'),
    h.T([lead.model, lead.effort, lead.state].filter(Boolean).join(' · '), { dim: !lead.live, tone: lead.live ? 'running' : undefined, wrap: 'truncate-end', key: 'pl-meta' }),
  ]
  if (x && x.known) {
    const tone = x.over ? 'bad' : x.pct >= 50 ? 'warn' : undefined
    kids.push(h.col([
      u.line(L.ctx_label, x.detail, `${Math.round(x.pct)} %`, { tone, key: 'pl-ctx' }),
      u.bar(x.pct, 'pl-ctx-bar', { mark: x.markPct, tone: x.over ? 'bad' : undefined }),
      x.over ? h.T(x.note, { tone: 'bad', wrap: 'truncate-end', key: 'pl-ctx-note' }) : null,
    ], { key: 'pl-ctx-box', marginTop: 1 }))
  } else kids.push(h.T(L.ctx_none, { dim: true, key: 'pl-ctx-none' }))
  const pct = (v) => (v === null || v === undefined ? '—' : `${v} %`)
  kids.push(u.grid([
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
  return u.card('pl-card', kids)
}

/** Claude's Background-tasks pane, for one Workflow or the background agents. */
function taskCard(u, P, L, k) {
  const { h } = u
  const kids = [
    u.title(k.title, `pk-${k.key}-t`, { tone: k.failed ? 'bad' : undefined }),
    u.line(k.kind === 'workflow' ? L.kind_workflow : L.kind_background, k.eta ? fill(L.layer_eta, { time: k.eta }) : '', durText(k.elapsed), { dimLeft: true, boldValue: false, dimValue: true, key: `pk-${k.key}-d` }),
    h.T([fill(L.layer_count, { n: k.count }), fill(L.layer_tokens, { tokens: kTok(k.tokens) }), k.cost ? fmtUsd(k.cost) : ''].filter(Boolean).join('  '), { wrap: 'truncate-end', key: `pk-${k.key}-n` }),
  ]
  if (k.kind === 'workflow') kids.push(h.T(L.phases, { bold: true, key: `pk-${k.key}-ph` }))
  for (const p of k.phases) {
    const right = `${p.done}/${p.count}`
    const room = Math.max(6, u.W - len(right) - Math.min(p.dots.length, 12) - 6)
    if (k.kind === 'workflow') {
      kids.push(h.row([
        h.btn(`${clip(p.title, room)} ${p.open ? '⌄' : '›'}`, () => P.act.nodeToggle(p.key, p.open), false, p.key),
        h.row([h.T(right, { dim: true }), u.dots(p.dots.slice(0, 12), p.key + '-dots')], { flexWrap: 'nowrap', gap: 1 }),
      ], { key: p.key + '-row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
    }
    if (k.kind !== 'workflow' || p.open) {
      for (const a of p.agents) kids.push(...agentLines(u, L, a, `${p.key}-${a.id}`, k.kind === 'workflow' ? 2 : 0))
      if (p.hidden) kids.push(h.T(`+ ${p.hidden}`, { dim: true, key: p.key + '-more' }))
    }
  }
  return u.card('pk-' + k.key, kids)
}

/** One agent, as a row of Claude's « Model | Time » table plus our label, effort, tokens, tok/s and state. */
function agentLines(u, L, a, key, indent) {
  const { h } = u
  const mark = a.status === 'running' ? '●' : a.status === 'failed' ? '✕' : a.status === 'done' ? '✓' : '○'
  const tone = a.status === 'running' ? 'running' : a.status === 'failed' ? 'bad' : a.status === 'done' ? 'ok' : undefined
  const pad = ' '.repeat(indent)
  const w = u.W - indent
  // the numbers first: what does not fit is left out (effort, then the state), never cut in the middle
  const parts = [a.model, `${kTok(a.tokens)} tok`, a.tps !== null && a.tps !== undefined ? `${tpsText(a.tps)} tok/s` : '', a.effort, a.status !== 'done' ? a.stateLabel : ''].filter(Boolean)
  const room = u.W - indent - 2
  const kept = []
  for (const x of parts) if (len([...kept, x].join(' · ')) <= room) kept.push(x)
  const meta = [kept[0], a.effort && kept.includes(a.effort) ? a.effort : '', ...kept.slice(1).filter((x) => x !== a.effort)].filter(Boolean).join(' · ')
  const time = a.ms ? durText(a.ms) : ''
  return [
    h.row([
      u.line(a.label, '', time, { width: w, boldValue: false, dimValue: true, leftEl: h.row([h.T(mark, { tone }), h.T(clip(a.label, Math.max(4, w - len(time) - 4)), { wrap: 'truncate-end' })], { flexWrap: 'nowrap', gap: 1 }) }),
    ], { key: key + '-a', marginLeft: indent, flexWrap: 'nowrap' }),
    h.T(clip(`${pad}  ${meta}`, u.W).replace(/^ +/, (s) => String.fromCharCode(160).repeat(s.length)), { dim: true, wrap: 'truncate-end', key: key + '-m' }),
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
    out.push(h.row((s ? s.periods : []).map((p) => h.btn(p.label, () => P.act.pfilter('period', p.id), s.period.id === p.id, 'pf-period-' + p.id)), { key: 'pf-periods', alignItems: 'center' }))
    out.push(h.row([
      h.btn(`${L.project} : ${f.project || L.all_projects}`, () => P.act.pcycle('project'), Boolean(f.project), 'pf-project'),
      h.btn(`${L.state} : ${f.state ? L.states[f.state] : L.all_states}`, () => P.act.pcycle('state'), Boolean(f.state), 'pf-state'),
      h.btn(f.who === 'codex' ? L.who_codex : L.who_claude, () => P.act.pfilter('who', f.who === 'codex' ? 'claude' : 'codex'), f.who === 'codex', 'pf-who'),
    ], { key: 'pf-row2', alignItems: 'center', marginBottom: 1 }))
    if (!s || !s.hasData) out.push(h.T(L.no_data, { dim: true, key: 'pc-nodata' }))
    else if (!s.rows.length) out.push(h.T(L.no_rows, { dim: true, key: 'pc-none' }))
    else {
      const wide = width >= (Number(c.style.wide_cols) || 60)
      const cells = wide ? Number(c.style.bar_cells_wide) || 10 : Number(c.style.bar_cells) || 6
      const dot = { running: '●', waiting: '◆', done: '○' }
      const tone = { running: 'running', waiting: 'warn' }
      const tot = s.total.tokens || 1
      s.rows.forEach((r, i) => {
        const pct = Math.round((100 * r.tokens) / tot)
        const right = `${fmtTokens(r.tokens)}${wide && r.cost !== null ? ' · ' + fmtUsd(r.cost) : ''} ${textBar(pct, cells, P.cfg)} ${String(pct).padStart(2)} %`
        out.push(u.line(r.label, '', right, { key: 'pc-' + i, boldValue: false,
          leftEl: h.row([h.T(dot[r.state] || '○', { tone: tone[r.state], dim: !tone[r.state] }), h.T(clip(r.label, Math.max(4, u.W - len(right) - 4)), { bold: r.state !== 'done', dim: r.state === 'done', wrap: 'truncate-end' })], { flexWrap: 'nowrap', gap: 1 }) }))
        if (r.state === 'waiting' && r.last) out.push(h.T(clip(`  ${r.last}`, u.W).replace(/^ +/, (x) => String.fromCharCode(160).repeat(x.length)), { tone: 'warn', wrap: 'truncate-end', key: 'pcm-' + i }))
      })
      if (s.others) out.push(u.line(s.others.label, '', `${fmtTokens(s.others.tokens)} · ${fmtUsd(s.others.cost)}`, { key: 'pc-others', dimLeft: true, boldValue: false, dimValue: true }))
      out.push(u.line(L.total, s.period.label, `${fmtTokens(s.total.tokens)}${s.total.cost !== null ? ' · ' + fmtUsd(s.total.cost) : ''}`, { key: 'pc-total', bold: true }))
    }
    out.push(...workflowsBody(u, P, L))
    return out
  }, width)
}

// Workflows actifs of every conversation: one Background-tasks row each, unfolding to its agents
function workflowsBody(u, P, L) {
  const { h } = u
  const wfs = P.workflows || []
  const out = [h.col([h.T(L.workflows, { bold: true })], { key: 'pw-title', marginTop: 1 })]
  if (!wfs.length) out.push(h.T(L.no_workflows, { dim: true, key: 'pw-none' }))
  for (const w of wfs) {
    const open = Boolean(P.open[w.key])
    const right = `${w.running}/${w.count}`
    out.push(h.row([
      h.btn(`${clip(w.name, Math.max(8, u.W - len(right) - Math.min(w.agents.length, 10) - 14))} ${open ? '⌄' : '›'}`, () => P.act.ptoggle(w.key), false, 'pw-' + w.key),
      h.row([h.T(`${kTok(w.tokens)}`, { dim: true }), h.T(right, { dim: true }), u.dots(w.agents.slice(0, 10).map((a) => (a.status === 'running' ? 'running' : a.status === 'failed' ? 'failed' : a.status === 'done' ? 'done' : 'waiting')), 'pwd-' + w.key)], { flexWrap: 'nowrap', gap: 1 }),
    ], { key: 'pwr-' + w.key, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }))
    if (open) {
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
      ], { key: 'pbc-' + b.id, marginBottom: 1 }))
    }
    return out
  }, width)
}

// ---- 5. Graphe des conversations ------------------------------------------------------------------------------------

function drawGrapheSection(u, P, L, width) {
  const m = P.graphe
  return section(u, P, 'graphe', L.graphe, m && m.ready ? m.summary : '', () => drawGraphe(u.h, m, L, width - 1, P.act), width)
}
