// cockpit « Panneau » - draws the default view: ONE scrolling column, no tab bar, top to bottom, each section foldable
// (its header is a button ▾/▸ with a one-line summary while closed). Pure except for the kit `h` and the callbacks in P.act.
//   ▾ Fichiers                        filetree's tree (hooks/files.mjs): folders open on a click, a file click selects it
//   ▾ Cette conversation              factory view (lib/panel_conv.mjs): lead box, layers, agent cards, retour au lead, log
//   ▾ Contexte de cette conversation  % bar with the hand-off threshold, tokens
//   ▾ Toutes les conversations        filters, top 15 + autres, Workflows actifs, bars (5 h, semaine, Codex, tok/s)
//   ▾ Graphe des conversations        À toi de cliquer, legend, filters, projects → conversations tree (hooks/graphe_view.mjs)
//   then one grey line: the old views and their /cockpit commands
import { panelConfig, fill } from '../lib/panel.mjs'
import { factoryLines, convFactorySummary } from '../lib/panel_conv.mjs'
import { fmtTokens, fmtUsd, short } from './nav.mjs'
import { drawGraphe } from './graphe_view.mjs'

const clip = (t, n) => {
  const s = String(t ?? '')
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s
}

/**
 * P = { cfg, columns, open: {id: bool}, closed: {nodeKey: bool}, act, files: { head, rows, more, selected, attach, busy, error },
 *       tree: [rows of foldTree], treeEmpty, syn (synthesis()), filter: {period, project, state, who}, bars: [...], workflows: [...],
 *       barEl(pct, key) -> element }
 */
export function drawPanel(h, P) {
  const c = panelConfig(P.cfg)
  const L = c.labels
  const width = Math.max(30, P.columns || 75)
  const parts = { fichiers: drawFiles, conv: drawConvFactory, contexte: drawContexte, convs: drawConvs, graphe: drawGrapheSection }
  const out = c.order.map((id) => parts[id](h, P, L, width)).filter(Boolean)
  if (P.otherViews) out.push(h.T(P.otherViews, { dim: true, key: 'p-other-views' }))
  return out
}

/** The render hook of section 5 (« Graphe des conversations »). */
export { drawGraphe }

function section(h, P, id, title, summary, body, width) {
  const open = Boolean(P.open[id])
  const label = `${open ? '▾' : '▸'} ${title}`
  const room = width - label.length - 6
  return h.col([
    h.row([h.btn(label, () => P.act.ptoggle(id), false, 'p-sec-' + id), summary && !open && room > 8 ? h.T(clip(summary, room), { dim: true, wrap: 'truncate-end' }) : null],
      { alignItems: 'center', flexWrap: 'nowrap' }),
    open ? h.col(body(), { marginLeft: 1 }) : null,
  ], { key: 'p-' + id, marginBottom: 1 })
}

// ---- 1. Fichiers --------------------------------------------------------------------------------------------------------

function drawFiles(h, P, L, width) {
  const f = P.files
  const summary = f.head ? `${f.head}${f.selected ? ' · ' + fill(L.files_selected, { path: f.selected }) : ''}` : L.files_none
  return section(h, P, 'fichiers', L.fichiers, summary, () => {
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

// ---- 2. Cette conversation: the factory view -------------------------------------------------------------------------

function drawConvFactory(h, P, L, width) {
  const m = P.factory
  const summary = P.convSummary || convFactorySummary(m)
  return section(h, P, 'conv', L.conv, summary, () => {
    if (!m || !m.available) return [h.T(P.treeEmpty || L.no_tree, { dim: true, key: 'pt-empty' })]
    return factoryLines(m, width - 1, P.cfg).map((r) => (r.fold
      ? h.row([h.T(r.text, { dim: true }), h.btn(r.label, () => P.act.nodeToggle(r.fold), false, r.fold)], { key: r.key, alignItems: 'center', flexWrap: 'nowrap' })
      : h.T(r.text, { key: r.key, tone: r.tone, bold: r.bold, dim: r.dim, wrap: 'truncate-end' })))
  }, width)
}

// ---- 3. Contexte de cette conversation ----------------------------------------------------------------------------------

function drawContexte(h, P, L, width) {
  const x = P.contexte
  const summary = x && x.known ? `${x.text}${x.over ? ' · ' + x.note : ''}` : L.ctx_none
  return section(h, P, 'contexte', L.contexte, summary, () => {
    if (!x || !x.known) return [h.T(L.ctx_none, { dim: true, key: 'pk-none' })]
    const tone = x.over ? 'bad' : x.pct >= 50 ? 'warn' : 'running'
    return [
      h.T(x.bar.length > width - 2 ? [...x.bar].slice(0, width - 2).join('') : x.bar, { tone, key: 'pk-bar', wrap: 'truncate-end' }),
      h.T(x.text, { bold: true, key: 'pk-text', wrap: 'truncate-end' }),
      h.T(x.note, { tone: x.over ? 'bad' : undefined, dim: !x.over, key: 'pk-note', wrap: 'truncate-end' }),
    ]
  }, width)
}

// ---- 4. Toutes les conversations ----------------------------------------------------------------------------------------

function drawConvs(h, P, L, width) {
  const s = P.syn
  const f = P.filter
  const summary = s && s.hasData ? `${s.period.label} · ${fmtTokens(s.total.tokens)} tok${s.total.cost !== null ? ' · ' + fmtUsd(s.total.cost) : ''}${s.rows[0] ? ' · ' + clip(s.rows[0].label, 24) : ''}` : ''
  return section(h, P, 'convs', L.convs, summary, () => {
    const out = []
    out.push(h.row((s ? s.periods : []).map((p) => h.btn(p.label, () => P.act.pfilter('period', p.id), s.period.id === p.id, 'pf-period-' + p.id)), { key: 'pf-periods', alignItems: 'center' }))
    out.push(h.row([
      h.btn(`${L.project} : ${f.project || L.all_projects}`, () => P.act.pcycle('project'), Boolean(f.project), 'pf-project'),
      h.btn(`${L.state} : ${f.state ? L.states[f.state] : L.all_states}`, () => P.act.pcycle('state'), Boolean(f.state), 'pf-state'),
      h.btn(f.who === 'codex' ? L.who_codex : L.who_claude, () => P.act.pfilter('who', f.who === 'codex' ? 'claude' : 'codex'), f.who === 'codex', 'pf-who'),
    ], { key: 'pf-row2', alignItems: 'center' }))
    if (!s || !s.hasData) { out.push(h.T(L.no_data, { dim: true, key: 'pc-nodata' })); return [...out, ...barsBody(h, P, L, width)] }
    if (!s.rows.length) { out.push(h.T(L.no_rows, { dim: true, key: 'pc-none' })); return [...out, ...barsBody(h, P, L, width)] }
    const tone = { running: 'running', waiting: 'warn', done: 'dim' }
    s.rows.forEach((r, i) => {
      const right = `${fmtTokens(r.tokens)}${r.cost !== null ? ' · ' + fmtUsd(r.cost) : ''}`
      out.push(h.col([
        h.lr(`${i + 1}. ${clip(r.label, Math.max(12, width - right.length - 8))}`, right, { key: 'pcl-' + i, bold: true }),
        h.T([r.project, r.stateLabel, Math.round(r.tps) > 0 ? `${Math.round(r.tps)} ${L.tps}` : '', r.last].filter(Boolean).join(' · '), { dim: r.state === 'done', tone: r.state !== 'done' ? tone[r.state] : undefined, wrap: 'truncate-end', key: 'pcm-' + i }),
      ], { key: 'pc-' + i }))
    })
    if (s.others) out.push(h.lr(s.others.label, `${fmtTokens(s.others.tokens)} · ${fmtUsd(s.others.cost)}`, { key: 'pc-others', dimLeft: true, dimRight: true }))
    out.push(h.lr(L.total, `${fmtTokens(s.total.tokens)}${s.total.cost !== null ? ' · ' + fmtUsd(s.total.cost) : ''}`, { key: 'pc-total', dimLeft: true }))
    return [...out, ...barsBody(h, P, L, width)]
  }, width)
}

// ---- 4 (end). Workflows actifs and the bars ----------------------------------------------------------------------------------------------------------

function barsBody(h, P, L, width) {
  const bars = P.bars || []
  const wfs = P.workflows || []
  const out = []
  out.push(h.T(L.workflows, { bold: true, key: 'pw-title' }))
  if (!wfs.length) out.push(h.T(L.no_workflows, { dim: true, key: 'pw-none' }))
  for (const w of wfs) {
    const open = Boolean(P.open[w.key])
    out.push(h.row([
      h.btn(`${open ? '▾' : '▸'} ${clip(w.name, Math.max(12, width - 24))}`, () => P.act.ptoggle(w.key), false, 'pw-' + w.key),
      h.T(`${w.running}/${fill(L.agents, { n: w.count })} · ${fmtTokens(w.tokens)}`, { dim: true, wrap: 'truncate-end' }),
    ], { key: 'pwr-' + w.key, alignItems: 'center', flexWrap: 'nowrap' }))
    if (open) {
      w.agents.forEach((a, i) => out.push(h.T(`${a.status === 'running' ? '●' : '○'} ${clip(a.label, Math.max(12, width - 30))} · ${short(a.model)} · ${a.status} · ${fmtTokens(a.tokens)}`,
        { tone: a.status === 'running' ? 'running' : a.status === 'failed' ? 'bad' : undefined, dim: a.status !== 'running' && a.status !== 'failed', wrap: 'truncate-end', key: `pwa-${w.key}-${i}` })))
      if (w.hidden) out.push(h.T(`+ ${w.hidden}`, { dim: true, key: `pwh-${w.key}` }))
    }
  }
  out.push(h.T(L.barres, { bold: true, key: 'pb-title' }))
  for (const b of bars) {
    out.push(h.lr(b.label, b.text, { key: 'pb-' + b.id, bold: b.pct !== null && b.pct >= 80, tone: b.pct !== null && b.pct >= 90 ? 'bad' : b.pct !== null && b.pct >= 80 ? 'warn' : undefined }))
    if (b.pct !== null && b.pct !== undefined) out.push(h.row([P.barEl(b.pct, 'pbb-' + b.id)], { key: 'pbr-' + b.id }))
  }
  return out
}

// ---- 5. Graphe des conversations ------------------------------------------------------------------------------------

function drawGrapheSection(h, P, L, width) {
  const m = P.graphe
  return section(h, P, 'graphe', L.graphe, m && m.ready ? m.summary : '', () => drawGraphe(h, m, L, width - 1, P.act), width)
}
