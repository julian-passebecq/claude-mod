// cockpit « Panneau » - draws the default view: one vertical panel, top to bottom, each section foldable (its header
// is a button ▾/▸ with a one-line summary while closed). Pure except for the element kit `h` and the callbacks in P.act.
//   ▾ Fichiers                  filetree's tree (hooks/files.mjs): folders open on a click, a file click selects it
//   ▾ Cette conversation        agents and Workflows with model, state, tokens; each node with children folds
//   ▾ Toutes les conversations  filters (période, projet, état, Claude/Codex), top 15 by consumption + autres
//   ▾ Barres                    5 h, semaine, Codex semaine, contexte, tok/s; Workflows actifs with their agents
import { panelConfig, fill } from '../lib/panel.mjs'
import { fmtTokens, fmtUsd, short } from './nav.mjs'

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
  const parts = { fichiers: drawFiles, conv: drawConvTree, convs: drawConvs, barres: drawBars }
  return c.order.map((id) => parts[id](h, P, L, width)).filter(Boolean)
}

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

// ---- 2. Cette conversation --------------------------------------------------------------------------------------------

function drawConvTree(h, P, L, width) {
  const rows = P.tree || []
  const running = rows.filter((r) => r.state === 'running' && r.kind !== 'conv').length
  const agents = rows.filter((r) => r.kind === 'agent').length
  const summary = P.convSummary || (agents ? `agents ${running}/${agents}` : '')
  return section(h, P, 'conv', L.conv, summary, () => {
    if (!rows.length) return [h.T(P.treeEmpty || L.no_tree, { dim: true, key: 'pt-empty' })]
    return rows.map((r) => {
      const indent = 2 * (r.depth || 0)
      const mark = r.kind === 'workflow' ? '◇' : '●'
      const chev = r.hasKids ? (r.isOpen ? '▾' : '▸') : ' '
      return h.col([
        h.row([
          r.hasKids ? h.btn(chev, () => P.act.nodeToggle(r.key), false, 'pn-' + r.key) : h.T(' ', {}),
          h.T(mark, { tone: r.tone }),
          h.T(clip(r.label, Math.max(16, width - indent - 10)), { bold: r.kind !== 'agent', wrap: 'truncate-end' }),
        ], { alignItems: 'center', flexWrap: 'nowrap' }),
        r.meta ? h.T(r.meta, { dim: true, wrap: 'truncate-end', key: 'pm-' + r.key }) : null,
      ], { key: 'pt-' + r.key, ...(indent ? { marginLeft: indent } : {}) })
    })
  }, width)
}

// ---- 3. Toutes les conversations ----------------------------------------------------------------------------------------

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
    if (!s || !s.hasData) { out.push(h.T(L.no_data, { dim: true, key: 'pc-nodata' })); return out }
    if (!s.rows.length) { out.push(h.T(L.no_rows, { dim: true, key: 'pc-none' })); return out }
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
    return out
  }, width)
}

// ---- 4. Barres ----------------------------------------------------------------------------------------------------------

function drawBars(h, P, L, width) {
  const bars = P.bars || []
  const wfs = P.workflows || []
  const summary = [...bars.filter((b) => b.id !== 'codex_week' || b.pct !== null).map((b) => `${b.label} ${b.text}`), wfs.length ? `${wfs.length} Workflow(s)` : ''].filter(Boolean).join(' · ')
  return section(h, P, 'barres', L.barres, summary, () => {
    const out = []
    for (const b of bars) {
      out.push(h.lr(b.label, b.text, { key: 'pb-' + b.id, bold: b.pct !== null && b.pct >= 80, tone: b.pct !== null && b.pct >= 90 ? 'bad' : b.pct !== null && b.pct >= 80 ? 'warn' : undefined }))
      if (b.pct !== null && b.pct !== undefined) out.push(h.row([P.barEl(b.pct, 'pbb-' + b.id)], { key: 'pbr-' + b.id }))
    }
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
    return out
  }, width)
}
