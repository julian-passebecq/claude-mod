// factory v2 - draws the side panel with native elements only (Box, Text, Button, Link): tabs on top, each screen a
// stack of sections, top to bottom, that fills the pane's width. No fixed-size canvas, so nothing needs zoom.
// Pure except for the element factory `el` (from $.ui.resolve, or the text renderer of scanner/preview.mjs) and the
// action callbacks in `V.act`. The view models come from screens.mjs. Screen ideas (big counters, Focus "what needs
// me", live timeline) from rig-console in github.com/korallis/agent-stack (Apache-2.0); no code copied.
import { fmtTokens, fmtUsd, hhmm, short, family, rateFor, compactEvents } from './logic.mjs'
import { waitingConfig, fill as wfill, age } from './waiting.mjs'
import {
  screensConfig, tabsOf, layout, chunk, bar, effortBars, clip, fill, mission, focus, tree, pipeline, quotas, system, journal,
  JOURNAL_KINDS,
} from './screens.mjs'

// ---- small helpers --------------------------------------------------------------------------------------------------

function mk(el, cfg) {
  const color = (k) => (cfg && cfg.colors && cfg.colors[k]) || undefined
  const T = (text, o = {}) => {
    const p = { children: [String(text ?? '')] }
    if (o.color) p.color = color(o.color) || o.color
    if (o.bold) p.bold = true
    if (o.dim) p.dimColor = true
    p.wrap = o.wrap || 'wrap'
    return el.Text(p)
  }
  const row = (parts, o = {}) => el.Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, ...o, children: parts.filter(Boolean) })
  const col = (parts, o = {}) => el.Box({ flexDirection: 'column', ...o, children: parts.filter(Boolean) })
  const section = (title, parts, o = {}) => el.Box({
    flexDirection: 'column', borderStyle: 'round', borderColor: color(o.color || 'dim'), paddingX: 1, marginBottom: 1,
    ...(o.key ? { key: o.key } : {}),
    ...(o.marginLeft ? { marginLeft: o.marginLeft } : {}),
    ...(o.grow ? { flexGrow: 1 } : {}),
    children: [title ? T(title, { bold: true, color: o.color }) : null, ...parts].filter(Boolean),
  })
  const btn = (label, onPress, primary, key) => el.Button({ children: [label], variant: primary ? 'primary' : 'secondary', onPress, ...(key ? { key } : {}) })
  const link = (href, label) => (href ? (el.Link ? el.Link({ href, children: [label] }) : T(label, { dim: true })) : null)
  const famColor = (model) => family(model)
  return { T, row, col, section, btn, link, color, famColor }
}

const hm = (ts) => hhmm(ts).slice(0, 5)

function whenText(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const days = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
  return `${days[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`
}

// ---- the pane -----------------------------------------------------------------------------------------------------

// V = { cfg, tab, scan, at, busy, error, columns, filter, jfilter, jproject, picking, live, quotas, machine, act }
export function drawPane(el, V) {
  const cfg = V.cfg || {}
  const sc = screensConfig(cfg)
  const L = sc.labels
  const lay = layout(V.columns, cfg)
  const h = mk(el, cfg)
  const tabs = tabsOf(cfg)
  const tab = tabs.some((t) => t.id === V.tab) ? V.tab : (tabs[0] || { id: 'mission' }).id
  const top = [
    h.row(tabs.map((t) => h.btn(t.label, () => V.act.tab(t.id), t.id === tab)), { marginBottom: 1 }),
    h.row([
      h.btn(V.busy ? L.refreshing : L.refresh, () => V.act.refresh()),
      h.T(fill(L.updated, { time: V.at ? hm(V.at) : '--:--' }), { dim: true }),
    ], { marginBottom: 1, alignItems: 'center' }),
  ]
  if (V.error) top.push(h.T(`scanner : ${V.error}`, { color: 'bad' }))
  if (!V.scan) return h.col([...top, h.T(L.scanning, { dim: true })])
  return h.col([...top, ...drawScreen(el, V, tab)])
}

const SCREENS = {
  mission: drawMission, focus: drawFocus, arbre: drawTree, pipeline: drawPipeline, quotas: drawQuotas, systeme: drawSystem, journal: drawJournal,
}

// One screen's body (the sections under the tabs), for a mod that composes factory screens in its own pane (cockpit).
// V as for drawPane; V.embedded hides the Arbre's « Cette conversation / Choisir » row (the host picks the conversation).
export function drawScreen(el, V, tab) {
  const cfg = V.cfg || {}
  const draw = SCREENS[tab]
  if (!draw || !V.scan) return []
  return draw(mk(el, cfg), V, cfg, screensConfig(cfg).labels, layout(V.columns, cfg))
}

// ---- Mission ---------------------------------------------------------------------------------------------------------

function counterGrid(h, items, n) {
  return chunk(items, n).map((line, i) => h.row(line.map((it) => h.section(null, [
    h.T(it.value, { bold: true, color: it.color }),
    h.T(it.label, { dim: true }),
    ...(it.sub || []).map((s) => h.T(s, { color: it.color })),
  ], { color: it.color, key: 'c-' + it.label, grow: true })), { key: 'cg' + i, flexWrap: 'nowrap', gap: 1 }))
}

function drawMission(h, V, cfg, L, lay) {
  const m = mission(V.scan, cfg, V.at)
  const c = m.counters
  const C = L.counters
  const out = []
  out.push(...counterGrid(h, [
    { value: c.working, label: C.working, color: 'running' },
    { value: c.idle, label: C.idle, color: 'dim' },
    { value: c.blocked, label: C.blocked, color: c.blocked ? 'bad' : 'dim', sub: c.blockedReasons.map((r) => clip(r, lay.textMax)) },
    { value: c.julian, label: C.julian, color: c.julian ? 'warn' : 'dim' },
    { value: c.done, label: C.done, color: 'ok' },
    { value: fmtUsd(c.cost), label: `${C.cost} (${cfg.cost_label || 'estimation'})`, color: 'opus' },
  ], lay.counterCols))
  // projects
  const cards = m.projects.map((p) => h.section(p.repo, [
    h.row([
      h.T(`${L.lead} `, { dim: true }),
      h.btn(clip(p.lead.title, lay.narrow ? 30 : 48), () => V.act.go(p.lead.cli)),
      h.T(`${short(p.lead.model)} · ${effortBars(p.lead.effort)} ${p.lead.effort}`, { color: h.famColor(p.lead.model) }),
      h.T(`ctx ${p.lead.ctxPct}%`, { color: p.lead.ctxLevel }),
      h.T((L.states || {})[p.lead.state] || p.lead.state, { color: stateColor(p.lead.state) }),
    ], { alignItems: 'center' }),
    p.subconvs.length ? h.T(`${L.subconv} : ${p.subconvs.map((s) => `${clip(s.title, 26)} (${(L.states || {})[s.state] || s.state}, ${short(s.model)} ${s.effort})`).join(' · ')}`) : null,
    h.T(`${p.sessions} conv. · ${L.workers} ${p.workers} · ctx max ${p.maxCtxPct}% · ${fmtUsd(p.cost)} ${L.counters.cost}`, { dim: true }),
    h.T(Object.entries(p.states).map(([k, n]) => `${(L.states || {})[k] || k} ${n}`).join(' · '), { dim: true }),
  ], { key: 'p-' + p.repo, color: p.live ? 'running' : 'dim', grow: lay.cardCols > 1 }))
  out.push(h.T(L.projects, { bold: true }))
  if (lay.cardCols > 1) out.push(...chunk(cards, lay.cardCols).map((r, i) => h.row(r, { key: 'pc' + i, flexWrap: 'nowrap' })))
  else out.push(...cards)
  if (!cards.length) out.push(h.T(L.nothing, { dim: true }))
  // model share vs targets
  out.push(h.section(m.shareTitle, m.share.map((s) => h.col([
    h.row([h.T(`${s.family} ${Math.round(s.share * 100)} %`, { bold: true, color: s.family }), h.T(`${L.target} ${s.target}`, { dim: true }),
      h.T(s.ok ? '✓' : '✗', { color: s.ok ? 'ok' : 'bad', bold: true }), h.T(`${s.calls} appels · ${fmtUsd(s.cost)}`, { dim: true })]),
    h.T(bar(s.share * 100, lay.bar), { color: s.ok ? s.family : 'bad' }),
  ], { key: 'sh-' + s.family }))))
  // conversations with the old All / Live / Problems / Waiting filters
  out.push(h.T(L.list_title, { bold: true }))
  const F = [['all', L.filters.all], ['live', L.filters.live], ['problems', L.filters.problems], ['julian', L.filters.julian]]
  out.push(h.row(F.map(([k, label]) => h.btn(`${label} (${filterRows(m.rows, k).length})`, () => V.act.filter(k), (V.filter || 'all') === k)), { marginBottom: 1 }))
  for (const r of filterRows(m.rows, V.filter || 'all')) {
    out.push(h.section(null, [
      h.row([h.btn(`${r.live ? '● ' : ''}${clip(r.title, lay.textMax - 4)}`, () => V.act.go(r.cli))]),
      h.row([
        h.T(`${r.repo}${r.branch ? ' · ' + r.branch.replace(/^claude\//, '') : ''}`, { dim: true }),
        h.T(`${short(r.model)} · ${effortBars(r.effort)} ${r.effort}`, { color: h.famColor(r.model) }),
        h.T(`ctx ${r.ctxPct}%`, { color: r.ctxLevel }),
        h.T(`${fmtUsd(r.costToday)} aujourd’hui`),
        h.T(`agents ${r.running}/${r.subs}`, { color: r.running ? 'running' : 'dim' }),
        r.pr ? h.T(`PR #${r.pr.number} ${r.pr.state} · CI ${r.pr.ci}`, { color: r.pr.ci === 'failed' ? 'bad' : r.pr.ci === 'success' ? 'ok' : 'dim' }) : null,
        r.waiting ? h.T(L.counters.julian, { color: 'warn', bold: true }) : null,
      ]),
      r.problem ? h.T(r.problem, { color: r.problemLevel }) : null,
    ], { key: 'conv-' + r.cli, color: r.waiting ? 'warn' : r.live ? 'running' : 'dim' }))
  }
  return out
}

export function filterRows(rows, f) {
  if (f === 'live') return rows.filter((r) => r.live)
  if (f === 'problems') return rows.filter((r) => r.problem && r.problemLevel !== 'ok')
  if (f === 'julian') return rows.filter((r) => r.waiting)
  return rows
}

function stateColor(st) {
  return { working: 'running', julian: 'warn', blocked: 'bad', done: 'ok', idle: 'dim', archived: 'dim', running: 'running', failed: 'failed', stopped: 'stopped' }[st] || 'dim'
}

// ---- Focus -----------------------------------------------------------------------------------------------------------

function waitingSection(h, V, cfg, lay) {
  const w = waitingConfig(cfg)
  if (!w.enabled) return null
  const WL = w.labels
  const f = focus(V.scan, cfg, V.at)
  const g = f.waiting
  const shown = g.rows.slice(0, w.max_rows)
  const kids = []
  if (!g.rows.length) kids.push(h.T(WL.none, { dim: true }))
  for (const r of shown) {
    kids.push(h.col([
      h.row([h.T((WL.kinds || {})[r.kind] || r.kind, { color: r.level, bold: true }), h.T(`${WL.since} ${hm(r.since)} (${age(V.at - r.since)})`, { dim: true })]),
      h.T(r.what),
      h.row([
        r.session ? h.btn(`${WL.open_session} ${clip(r.session.title, 36)}`, () => V.act.go(r.session.cli)) : null,
        h.link(r.link, r.kind === 'green' || r.kind === 'idle' ? r.pr || 'PR' : 'session'),
      ], { alignItems: 'center' }),
    ], { key: 'wait-' + r.key, marginBottom: 1 }))
  }
  if (g.rows.length > shown.length) kids.push(h.T(wfill(WL.more, { n: g.rows.length - shown.length }), { dim: true }))
  if (g.errors.length) kids.push(h.T(wfill(WL.reviews_error, { errors: g.errors.join(' · ') }), { color: 'warn' }))
  if (g.children.length) {
    kids.push(h.T(WL.children, { bold: true }))
    for (const c of g.children) {
      kids.push(h.col([
        c.cli ? h.btn(clip(c.title, lay.textMax - 4), () => V.act.go(c.cli)) : h.T(c.title, { bold: true }),
        ...c.children.map((k) => h.T(`  └ ${clip(k.title, lay.textMax - 20)} (${k.label})`, { color: k.state === 'julian' || k.state === 'blocked' ? 'warn' : k.state === 'working' ? 'running' : 'dim' })),
      ], { key: 'lead-' + c.sid }))
    }
  }
  return h.section(`${WL.title} (${g.rows.length})`, kids, { color: g.rows.length ? 'warn' : 'dim', key: 'waiting' })
}

function drawFocus(h, V, cfg, L, lay) {
  const f = focus(V.scan, cfg, V.at)
  const p = f.pulse
  const out = [h.T(L.focus_title, { bold: true })]
  out.push(waitingSection(h, V, cfg, lay))
  out.push(h.section(L.pulse, [
    h.row([
      h.T(`${p.working} ${L.counters.working}`, { color: 'running', bold: true }),
      h.T(`${p.idle} ${L.counters.idle}`, { dim: true }),
      h.T(`${p.blocked} ${L.counters.blocked}`, { color: p.blocked ? 'bad' : 'dim', bold: Boolean(p.blocked) }),
      h.T(`${p.julian} ${L.counters.julian}`, { color: p.julian ? 'warn' : 'dim', bold: Boolean(p.julian) }),
      h.T(`${p.running} ${L.agents_running}`, { color: 'running' }),
      h.T(`${fmtUsd(p.cost)} ${L.counters.cost}`),
    ]),
    ...p.blockedReasons.map((r) => h.T(`▲ ${r}`, { color: 'bad' })),
  ], { key: 'pulse' }))
  out.push(h.section(L.timeline_title, f.timeline.length ? f.timeline.map((t, i) => h.col([
    h.row([h.T(hm(t.ts), { dim: true }), h.T(t.label, { color: t.level, bold: true }), h.T(clip(t.title, 40), { dim: true })]),
    t.text ? h.T(`   ${t.text}`) : null,
  ], { key: 'tl' + i })) : [h.T(L.nothing, { dim: true })], { key: 'timeline' }))
  out.push(h.section(L.progress, f.progress.length ? f.progress.map((pr) => h.col([
    h.row([h.T(pr.repo, { bold: true }), h.T(fill(L.progress_row, pr), { dim: true })]),
    h.T(bar(pr.pct, lay.bar), { color: pr.pct >= 100 ? 'ok' : 'running' }),
  ], { key: 'pg-' + pr.repo })) : [h.T(L.nothing, { dim: true })], { key: 'progress' }))
  return out
}

// ---- Arbre -----------------------------------------------------------------------------------------------------------

// Running and architect nodes get a box; finished ones a compact 2-3 line entry, model and effort always visible.
// open: (id) => opens that agent's transcript ($.ui.view), given only for this conversation on an engine that has it.
function nodeBox(h, n, cfg, L, lay, indent, inWorkflow, open) {
  const st = (L.agent_states || {})[n.status] || n.status
  if (n.status !== 'running' && !n.architect) {
    return h.col([
      h.row([h.T('├', { dim: true }), h.T(n.type, { bold: true }), h.T(st, { color: stateColor(n.status) }),
        h.T(`${short(n.model)} · ${effortBars(n.effort)} ${n.effort}`, { color: h.famColor(n.model), bold: true }),
        n.explicit || inWorkflow ? null : h.T('modèle hérité', { color: 'warn' }), h.T(`${fmtTokens(n.tokens)} tok · ${fmtUsd(n.cost)}`, { dim: true })]),
      n.task ? h.T(`│  ${clip(n.task, lay.textMax - 6)}`, { dim: true }) : null,
    ], { key: 'n-' + n.id, marginLeft: indent || 0 })
  }
  return h.section(null, [
    h.row([h.T(n.type, { bold: true }), h.T(`· ${st}`, { color: stateColor(n.status) }), n.bg ? h.T('arrière-plan', { dim: true }) : null,
      n.architect ? h.T(`architecte : ${(L.architect_trigger_labels || {})[n.architect] || n.architect}`, { color: 'architect', bold: true }) : null]),
    h.row([h.T(short(n.model), { color: h.famColor(n.model), bold: true }), h.T(`effort ${effortBars(n.effort)} ${n.effort}`, { color: h.famColor(n.model) }),
      n.explicit || inWorkflow ? null : h.T('modèle non précisé (hérité)', { color: 'warn' })]),
    h.row([h.T(`${fmtTokens(n.tokens)} tok`), h.T(fmtUsd(n.cost)), n.phase ? h.T(`phase ${n.phase}`, { dim: true }) : null]),
    n.task ? h.T(clip(n.task, lay.textMax * 2), { dim: true }) : null,
    open && n.status === 'running' ? h.row([h.btn(L.open_agent || 'Ouvrir l’agent', () => open(n.id), true, 'open-agent-' + n.id)], { key: 'open-' + n.id }) : null,
  ], { key: 'n-' + n.id, color: n.architect ? 'architect' : stateColor(n.status), ...(indent ? { marginLeft: indent } : {}) })
}

function drawTree(h, V, cfg, L, lay) {
  const out = []
  if (!V.embedded) out.push(h.row([
    h.btn(L.this_conv, () => V.act.go(null), !V.target),
    h.btn(L.pick, () => V.act.pick(), Boolean(V.picking)),
  ], { marginBottom: 1 }))
  if (V.picking) {
    const rows = mission(V.scan, cfg, V.at).rows
    out.push(h.section(L.pick, rows.map((r) => h.row([
      h.btn(`${r.live ? '● ' : ''}${clip(r.title, lay.textMax - 20)}`, () => V.act.go(r.cli)),
      h.T(`${r.repo} · ${short(r.model)} ${r.effort}`, { dim: true }),
    ], { key: 'pick-' + r.cli, alignItems: 'center' })), { key: 'picker' }))
  }
  const t = tree(V.scan, cfg, V.at)
  if (!t) return [...out, h.T(V.busy ? L.scanning : L.not_found, { dim: true })]
  const m = t.main
  const rate = rateFor(m.model, cfg)
  out.push(h.T(`${t.title}`, { bold: true }))
  out.push(h.T(`${t.repo}${t.branch ? ' · ' + t.branch : ''}`, { dim: true }))
  out.push(h.section(`${short(m.model)} · ${L.main}`, [
    h.T(`effort ${effortBars(m.effort)} ${m.effort}`, { color: h.famColor(m.model), bold: true }),
    h.T(`$${rate.in} / $${rate.out} par 1M (entrée / sortie)`, { dim: true }),
    h.T(`contexte ${fmtTokens(m.ctx)} / ${fmtTokens(m.window)} (${m.ctxPct} %)`, { color: m.ctxLevel }),
    h.T(bar(m.ctxPct, lay.bar), { color: m.ctxLevel }),
    h.T(`coût ${fmtUsd(m.cost)} (${cfg.cost_label || 'estimation'}) · lead seul ${fmtUsd(m.ownCost)}`),
    t.pr ? h.T(`PR #${t.pr.number} ${t.pr.state || ''} · CI ${t.pr.ci || '?'}`, { color: t.pr.ci === 'failed' ? 'bad' : t.pr.ci === 'success' ? 'ok' : 'dim' }) : h.T('pas encore de PR', { dim: true }),
    h.T(m.live ? `◐ ${L.agent_states.running}` : (L.states.idle), { color: m.live ? 'running' : 'dim' }),
    t.waiting ? h.T(L.counters.julian, { color: 'warn', bold: true }) : null,
  ], { color: family(m.model), key: 'main' }))
  // sub-conversations
  if (t.children.length) {
    out.push(h.T(`│ ${L.subconvs} (${t.children.length})`, { bold: true }))
    for (const c of t.children) {
      out.push(h.section(null, [
        h.row([h.btn(clip(c.title, lay.textMax - 8), () => V.act.go(c.cli))]),
        h.row([h.T(short(c.model), { color: h.famColor(c.model), bold: true }), h.T(`effort ${effortBars(c.effort)} ${c.effort}`, { color: h.famColor(c.model) }),
          h.T((L.states || {})[c.state] || c.state, { color: stateColor(c.state) }), h.T(`ctx ${c.ctxPct}%`, { color: c.ctxLevel })]),
        h.row([h.T(`agents ${c.running}/${c.agents}`), h.T(`${fmtTokens(c.tokens)} tok`), h.T(fmtUsd(c.cost)),
          c.pr ? h.T(`PR #${c.pr.number} ${c.pr.state} · CI ${c.pr.ci}`, { color: c.pr.ci === 'failed' ? 'bad' : 'dim' }) : null]),
        c.reason ? h.T(c.reason, { color: stateColor(c.state) }) : null,
      ], { key: 'child-' + c.cli, color: stateColor(c.state), marginLeft: 2 }))
    }
  }
  // agents and workflows
  out.push(h.T(`│ agents (${t.running} en cours / ${t.totalAgents})`, { bold: true }))
  const open = V.canView && V.self && V.scan && V.scan.detail && V.scan.detail.cli === V.self && V.act.openAgent ? (id) => V.act.openAgent(id) : null
  if (V.canView && V.viewAgent && V.act.backToConv) out.push(h.row([h.btn(L.back_conv || '← Conversation', () => V.act.backToConv(), false, 'back-conv-btn')], { key: 'back-conv' }))
  const more = (v, indent) => (v.hidden ? h.T(`${' '.repeat(indent)}+ ${v.hidden} plus anciens : ${v.hiddenText}`, { dim: true }) : null)
  for (const n of t.agentsView.shown) out.push(nodeBox(h, n, cfg, L, lay, 2, false, open))
  out.push(more(t.agentsView, 2))
  for (const w of t.workflowsView) {
    out.push(h.T(`└ ${L.workflow} ${w.name} · ${w.nodes.length} agents, ${w.running} en cours, ${fmtTokens(w.tokens)} tok, ${fmtUsd(w.cost)}`, { bold: true }))
    for (const n of w.view.shown) out.push(nodeBox(h, n, cfg, L, lay, 4, true, open))
    out.push(more(w.view, 4))
  }
  if (!t.totalAgents) out.push(h.T(`  ${L.no_agents}`, { dim: true }))
  // architect on call
  const a = t.architect
  out.push(h.section(L.architect_title, [
    h.row(a.triggers.map((x) => h.T(`${x.count ? '◆' : '◇'} ${x.label}${x.count ? ' ×' + x.count : ''}`, { color: x.count ? 'architect' : 'dim', bold: Boolean(x.count) }))),
    h.T(fill(L.architect_calls, { calls: a.calls, tokens: fmtTokens(a.tokens) })),
    a.last ? h.T(`dernier : ${clip(a.last.task, lay.textMax)}`, { dim: true }) : h.T(L.architect_none, { dim: true }),
  ], { color: 'architect', key: 'arch' }))
  // bill
  out.push(h.section(`${L.bill_title} : ${fmtUsd(t.total)}`, [
    h.row([h.T(L.bill_every), h.T(fmtUsd(t.billSplit.every), { bold: true })]),
    h.T(bar(t.total ? (100 * t.billSplit.every) / t.total : 0, lay.bar), { color: family(m.model) }),
    h.row([h.T(L.bill_on_call), h.T(fmtUsd(t.billSplit.onCall), { bold: true, color: 'architect' })]),
    h.T(bar(t.total ? (100 * t.billSplit.onCall) / t.total : 0, lay.bar), { color: 'architect' }),
    ...Object.entries(t.bill).sort((x, y) => y[1].cost - x[1].cost).map(([model, b]) => h.row([h.T(short(model), { color: family(model) }),
      h.T(fmtUsd(b.cost)), h.T(`${fmtTokens(b.tokens)} tok, ${b.calls} appels`, { dim: true })], { key: 'b-' + model })),
  ], { key: 'bill' }))
  // approvals and guards
  out.push(h.section(`${L.guards_title} (${t.guards.length})`, t.guards.length
    ? t.guards.map((g, i) => h.T(`${hm(g.ts)} ${g.src} ${g.text}`, { color: 'warn' }))
    : [h.T(`✓ ${L.guards_none}`, { color: 'ok' })], { key: 'guards', color: t.guards.length ? 'warn' : 'ok' }))
  // warnings
  out.push(h.section(`${L.warnings_title} (${t.warnings.length})`, t.warnings.length
    ? t.warnings.map((w) => h.T(`• ${w.text}`, { color: w.level }))
    : [h.T(`✓ ${L.warnings_none}`, { color: 'ok' })], { key: 'warnings', color: t.warnings.length ? 'warn' : 'ok' }))
  // session log
  out.push(h.section(L.log_title, t.events.map((e, i) => h.row([h.T(hhmm(e[0]), { dim: true }), h.T(e[1], { color: e[1] === 'prompt' ? undefined : 'running', bold: e[1] === 'prompt' }), h.T(e[2])], { key: 'ev' + i, flexWrap: 'nowrap' })), { key: 'log' }))
  out.push(h.T(t.status, { color: family(m.model), bold: true }))
  return out
}

// ---- Pipeline --------------------------------------------------------------------------------------------------------

function drawPipeline(h, V, cfg, L, lay) {
  const p = pipeline(V.scan, cfg, V.at)
  const out = [h.T(L.pipeline_title, { bold: true })]
  out.push(...counterGrid(h, p.stages.map((s) => ({ value: p.totals[s.id], label: s.label, color: p.totals[s.id] ? 'running' : 'dim' })), Math.min(lay.counterCols === 6 ? 5 : lay.counterCols, 5)))
  for (const r of p.rows) {
    out.push(h.section(r.repo, p.stages.filter((s) => r.stages[s.id].length).map((s) => h.col([
      h.T(`${s.label} (${r.stages[s.id].length})`, { bold: true }),
      ...r.stages[s.id].map((it) => h.row([
        h.btn(clip(it.title, lay.textMax - 22), () => V.act.go(it.cli)),
        h.T(`${(L.states || {})[it.state] || it.state}${it.pr ? ' · PR ' + it.pr : ''}`, { color: it.level }),
      ], { key: 'pi-' + it.cli, alignItems: 'center' })),
    ], { key: r.repo + s.id })), { key: 'pipe-' + r.repo, color: 'dim' }))
  }
  if (!p.rows.length) out.push(h.T(L.nothing, { dim: true }))
  out.push(h.T(L.pipeline_note, { dim: true }))
  return out
}

// ---- Quotas ----------------------------------------------------------------------------------------------------------

function missing(h, L, mod) {
  return h.section(fill(L.module_missing, { mod }), [h.T(fill(L.module_missing_hint, { mod }), { dim: true })], { color: 'warn', key: 'missing-' + mod })
}

function drawQuotas(h, V, cfg, L, lay) {
  const q = quotas(V.scan, cfg, V.at, V.live, V.quotas)
  const out = [h.T(L.quotas_title, { bold: true })]
  out.push(h.section('Claude', q.windows.map((w) => w.available ? h.col([
    h.row([h.T(w.label, { bold: true }), h.T(`${Math.round(w.pct)} %`, { bold: true, color: w.pct >= 80 ? 'bad' : w.pct >= 50 ? 'warn' : 'ok' }),
      w.reset ? h.T(fill(L.reset, { when: whenText(w.reset) }), { dim: true }) : null]),
    h.T(bar(w.pct, lay.bar), { color: w.pct >= 80 ? 'bad' : w.pct >= 50 ? 'warn' : 'ok' }),
    w.forecast ? h.T(w.forecast, { color: /épuisé/.test(w.forecast) ? 'warn' : 'dim' }) : null,
  ], { key: 'w-' + w.kind, marginBottom: 1 }) : h.T(`${w.label} : ${L.unavailable}`, { dim: true })), { key: 'claude' }))
  if (q.usage !== 'ok') out.push(missing(h, L, 'usage'))
  if (q.codex) {
    out.push(h.section(L.codex, q.codex.available ? [
      ...q.codex.windows.map((w, i) => h.col([
        h.row([h.T(w.label, { bold: true }), h.T(`${Math.round(w.pct)} %`, { bold: true, color: w.pct >= 80 ? 'bad' : 'ok' }), w.reset ? h.T(fill(L.reset, { when: whenText(w.reset) }), { dim: true }) : null, w.stale ? h.T('ancienne lecture', { dim: true }) : null]),
        h.T(bar(w.pct, lay.bar), { color: w.pct >= 80 ? 'bad' : 'ok' }),
      ], { key: 'cx' + i })),
      ...(q.codex.missing || []).map((x) => h.T(`${x} : ${L.unavailable}`, { dim: true })),
      Number.isFinite(q.codex.today) ? h.T(`aujourd’hui ${fmtTokens(q.codex.today)} tokens`, { dim: true }) : null,
    ] : [h.T(`${L.unavailable} (${q.codex.reason})`, { dim: true })], { key: 'codex' }))
  }
  const maxM = Math.max(0.01, ...q.byModel.map((x) => x.cost))
  out.push(h.section(`${L.cost_model} : ${fmtUsd(q.total)}`, q.byModel.length ? q.byModel.map((x) => h.col([
    h.row([h.T(short(x.model), { color: x.family, bold: true }), h.T(fmtUsd(x.cost)), h.T(`${fmtTokens(x.tokens)} tok · ${x.calls} appels`, { dim: true })]),
    h.T(bar((100 * x.cost) / maxM, lay.bar), { color: x.family }),
  ], { key: 'cm-' + x.model })) : [h.T(L.nothing, { dim: true })], { key: 'cost-model' }))
  const maxP = Math.max(0.01, ...q.byProject.map((x) => x.cost))
  out.push(h.section(L.cost_project, q.byProject.length ? q.byProject.map((x) => h.col([
    h.row([h.T(x.repo, { bold: true }), h.T(fmtUsd(x.cost)), h.T(`${x.sessions} conv. · ${fmtTokens(x.tokens)} tok`, { dim: true })]),
    h.T(bar((100 * x.cost) / maxP, lay.bar), { color: 'running' }),
  ], { key: 'cp-' + x.repo })) : [h.T(L.nothing, { dim: true })], { key: 'cost-project' }))
  out.push(h.T(`$ = ${cfg.cost_label || 'estimation'} (tokens × tarifs de factory.config.json)${V.quotas && V.quotas.note ? ' · ' + V.quotas.note : ''}`, { dim: true }))
  return out
}

// ---- Système ---------------------------------------------------------------------------------------------------------

function drawSystem(h, V, cfg, L, lay) {
  const out = [h.T(L.system_title, { bold: true })]
  const mc = V.machine || {}
  if (mc.missing) return [...out, missing(h, L, 'machine')]
  const s = system(mc.sample, mc.runner)
  if (!s.available) return [...out, h.T(mc.error ? `machine : ${mc.error}` : L.scanning, { dim: !mc.error, color: mc.error ? 'bad' : undefined })]
  const lvl = (p) => (p >= 90 ? 'bad' : p >= 70 ? 'warn' : 'ok')
  const gauge = (label, pct, text, key) => h.col([
    h.row([h.T(label, { bold: true }), h.T(pct === null || pct === undefined ? L.unavailable : `${Math.round(pct)} %`, { bold: true, color: pct === null ? 'dim' : lvl(pct) }), text ? h.T(text, { dim: true }) : null]),
    pct === null || pct === undefined ? null : h.T(bar(pct, lay.bar), { color: lvl(pct) }),
  ], { key, marginBottom: 1 })
  out.push(h.section(null, [
    gauge(`${L.cpu} (${s.ncpu} cœurs)`, s.cpu, '', 'cpu'),
    gauge(L.ram, s.ram ? s.ram.pct : null, s.ram ? s.ram.text : '', 'ram'),
    ...(s.gpus.length ? s.gpus.map((g, i) => gauge(`${L.gpu} ${g.name}`, g.pct, [g.mem, g.temp ? `${g.temp} °C` : ''].filter(Boolean).join(' · '), 'gpu' + i))
      : [h.T(`${L.gpu} : ${s.gpuRead ? L.unavailable : 'lecture espacée (gpu_every)'}`, { dim: true })]),
    ...s.disks.map((d) => gauge(`${L.disk} ${d.drive}`, d.pct, d.text, 'd-' + d.drive)),
  ], { key: 'machine' }))
  if (s.families.length) out.push(h.section('Processus par famille', s.families.map((f) => h.T(`${f.name} · ${f.count} · ${f.cpu} % CPU`, { key: 'f-' + f.name })), { key: 'fam' }))
  out.push(h.section(L.runner, [
    s.runnerProc ? h.T(`processus ${s.runnerProc.present ? 'présent' : 'absent'} · ${s.runnerProc.children} jobs enfants`, { color: s.runnerProc.present ? 'ok' : 'warn' }) : null,
    ...s.runners.map((r, i) => {
      const j = r.jobs && typeof r.jobs === 'object' ? r.jobs : {}
      const n = r.runners && typeof r.runners === 'object' ? r.runners : {}
      const q = (v) => (v === null || v === undefined ? '?' : v)
      return h.T(`${r.label} : ${r.usable === 'yes' || r.usable === true ? 'utilisable' : 'non utilisable'} · jobs ${q(j.running)} en cours, ${q(j.pending)} en attente · runners ${q(n.online)}/${q(n.total)} en ligne${r.concurrent ? ' · max ' + r.concurrent : ''}`,
        { color: r.usable === 'yes' || r.usable === true ? 'ok' : 'dim' })
    }),
    s.runnerError ? h.T(s.runnerError, { dim: true }) : null,
    !s.runnerProc && !s.runners.length && !s.runnerError ? h.T(L.unavailable, { dim: true }) : null,
  ], { key: 'runner' }))
  if (mc.metricsMissing) out.push(missing(h, L, 'metrics'))
  return out
}

// ---- Journal ---------------------------------------------------------------------------------------------------------

function drawJournal(h, V, cfg, L, lay) {
  const j = journal(V.scan, cfg, V.jfilter || 'all', V.jproject || '')
  const out = [h.T(L.journal_title, { bold: true })]
  out.push(h.row(JOURNAL_KINDS.map((k) => h.btn(`${(L.journal_kinds || {})[k] || k} (${j.counts[k] || 0})`, () => V.act.jfilter(k), (V.jfilter || 'all') === k)), { marginBottom: 1 }))
  out.push(h.row([h.btn('tous les projets', () => V.act.jproject(''), !V.jproject), ...j.projects.map((p) => h.btn(p, () => V.act.jproject(p), V.jproject === p))], { marginBottom: 1 }))
  out.push(h.section(null, j.rows.length ? j.rows.map((r, i) => h.col([
    h.row([h.T(hm(r.ts), { dim: true }), h.T(r.kind, { color: r.kind === 'error' ? 'bad' : r.kind === 'compact' ? 'warn' : 'running', bold: true }), h.T(`${r.repo} · ${clip(r.title, 36)}`, { dim: true })]),
    h.T(`   ${compactEvents([[r.ts, r.kind, r.text]])[0][2]}`),
  ], { key: 'j' + i })) : [h.T(L.nothing, { dim: true })], { key: 'journal' }))
  return out
}
