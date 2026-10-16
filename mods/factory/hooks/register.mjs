// factory v0.1 - two views over the Claude Code transcripts:
//   /factory [title or id]  one conversation: agent tree, bill, approvals/guards, session log, warnings
//   one pane: /factory opens the dashboard of all conversations; click one for its tree, ◀ to come back
// The data comes from scanner/factory_scan.py (incremental tail reads, cache in the effort-board); this file runs it on
// a timer while a pane is open and draws. Decisions and numbers live in logic.mjs (pure, node --test).
import {
  deepMerge, dashboard, conversation, pickSession, scanArgs, fmtTokens, fmtUsd, hhmm, short, family,
} from './logic.mjs'
import { treeSvg, dashSvg, treeAlt, dashAlt } from './svg.mjs'

let CFG = null
const D = { zoom: 1, scan: null, target: null, self: null, busy: false, error: '', at: 0, open: false, view: 'all', filter: 'all' }

async function homeDir($) {
  return ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/')
}

// FACTORY_BOARD overrides the effort-board folder (tests, dry runs); default ~/.claude/effort-board.
async function board($) {
  const o = await $.env.get('FACTORY_BOARD')
  return o ? o.replace(/\\/g, '/') : (await homeDir($)) + '/.claude/effort-board'
}

async function readJson($, path) {
  try {
    if (!(await $.fs.exists(path))) return null
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

// factory.config.json beside the mod, deep-merged with ~/.claude/effort-board/factory.config.json when present.
async function loadConfig($) {
  const base = (await readJson($, $.plugin.root.replace(/\\/g, '/') + '/factory.config.json')) || {}
  const over = await readJson($, (await board($)) + '/factory.config.json')
  CFG = deepMerge(base, over || {})
  return CFG
}

async function rescan($) {
  if (D.busy) return
  D.busy = true
  try {
    const cfg = CFG || (await loadConfig($))
    const root = $.plugin.root.replace(/\\/g, '/')
    const argv = [cfg.python || 'python', ...scanArgs(cfg, {
      script: root + '/scanner/factory_scan.py', cache: (await board($)) + '/factory_cache.json', detail: D.target || D.self,
    })]
    const r = await $.process.run(argv, { timeoutMs: 180000 })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `scanner exit ${r.exitCode}`)
    D.scan = JSON.parse(r.stdout)
    D.error = ''
    D.at = await $.clock.now()
  } catch (err) {
    D.error = String(err && err.message ? err.message : err).slice(0, 300)
  } finally {
    D.busy = false
  }
  $.ui.invalidate('ui.render')
}

// ---- drawing helpers ---------------------------------------------------------------------------------------------

function colorOf(key) {
  return (CFG && CFG.colors && CFG.colors[key]) || undefined
}

function legend(key) {
  return (CFG && CFG.legends && CFG.legends[key]) || key
}

function T(el, text, o = {}) {
  const p = { children: [String(text)] }
  if (o.color) p.color = o.color
  if (o.bold) p.bold = true
  if (o.dim) p.dimColor = true
  if (o.wrap !== false) p.wrap = o.wrap || 'truncate'
  return el.Text(p)
}

function row(el, parts, o = {}) {
  return el.Box({ flexDirection: 'row', gap: 1, ...o, children: parts.filter(Boolean) })
}

function heading(el, text) {
  return el.Box({ marginTop: 1, children: [T(el, text, { bold: true })] })
}

function modelText(el, model, effort) {
  return T(el, `${short(model)}${effort ? ' · ' + effort : ''}`, { color: colorOf(family(model)) })
}

function statusText(el, st) {
  return T(el, legend(st), { color: colorOf(st) })
}

function agentBox(el, n, wide) {
  const lines = [
    row(el, [T(el, n.type, { bold: true }), statusText(el, n.status), n.bg ? T(el, 'bg', { dim: true }) : null]),
    row(el, [modelText(el, n.model, n.effort), n.explicit ? null : T(el, 'no explicit model', { color: colorOf('warn') })]),
    row(el, [T(el, `${fmtTokens(n.tokens)} tok`), T(el, fmtUsd(n.cost))]),
    T(el, n.task || '-', { dim: true }),
  ]
  if (n.architect) lines.splice(1, 0, T(el, `architect: ${n.architect}`, { color: colorOf('architect'), bold: true }))
  if (n.phase) lines.push(T(el, `phase ${n.phase}`, { dim: true }))
  return el.Box({
    flexDirection: 'column', borderStyle: 'round', borderColor: colorOf(n.architect ? 'architect' : n.status), paddingX: 1,
    width: wide ? 38 : undefined, marginRight: 1, children: lines,
  })
}

function nothing(el, text) {
  return T(el, text, { dim: true })
}

// ---- views -------------------------------------------------------------------------------------------------------

function drawConversation($, el, wide) {
  const head = []
  if (D.error) head.push(T(el, `scanner: ${D.error}`, { color: colorOf('bad'), wrap: 'wrap' }))
  const d = D.scan && D.scan.detail
  if (!d) return el.Box({ flexDirection: 'column', children: [...head, nothing(el, D.busy || !D.scan ? 'Scanning transcripts…' : 'Conversation not found in the last scan.')] })
  const c = conversation(d, CFG, D.at)
  const m = c.main
  const kids = []
  kids.push(row(el, [T(el, c.title, { bold: true }), T(el, `${c.repo}${c.branch ? ' · ' + c.branch : ''}`, { dim: true }),
    T(el, `updated ${hhmm(D.at)}${D.busy ? ' …' : ''}`, { dim: true })]))
  // main thread box
  kids.push(el.Box({
    flexDirection: 'column', borderStyle: 'round', borderColor: colorOf(m.ctxLevel), paddingX: 1, children: [
      row(el, [T(el, legend('main'), { bold: true }), m.live ? statusText(el, 'running') : null]),
      row(el, [modelText(el, m.model, m.effort), T(el, `context ${fmtTokens(m.ctx)}/${fmtTokens(m.window)} (${m.ctxPct}%)`, { color: colorOf(m.ctxLevel) })]),
      row(el, [T(el, `cost so far ${fmtUsd(m.cost)} (${CFG.cost_label || 'estimate'})`), T(el, `main ${fmtUsd(m.ownCost)}`, { dim: true }),
        c.pr ? T(el, `PR #${c.pr.number} ${c.pr.state || ''} CI ${c.pr.ci || '?'}`, { color: colorOf(c.pr.ci === 'failed' ? 'bad' : 'dim') }) : null]),
      c.waiting ? T(el, 'waiting on Julian', { color: colorOf('warn'), bold: true }) : null,
    ].filter(Boolean),
  }))
  // tree
  kids.push(heading(el, `${legend('tree')} · ${c.agents.length} subagent(s), ${c.workflows.length} workflow(s)`))
  if (c.agents.length) kids.push(el.Box({ flexDirection: wide ? 'row' : 'column', flexWrap: 'wrap', paddingLeft: 2, children: c.agents.map((n) => agentBox(el, n, wide)) }))
  for (const w of c.workflows) {
    kids.push(row(el, [T(el, `└ workflow ${w.name}`, { bold: true }), T(el, `${w.nodes.length} agents, ${w.running} running, ${fmtTokens(w.tokens)} tok, ${fmtUsd(w.cost)}`, { dim: true })], { paddingLeft: 2 }))
    kids.push(el.Box({ flexDirection: wide ? 'row' : 'column', flexWrap: 'wrap', paddingLeft: 4, children: w.nodes.map((n) => agentBox(el, n, wide)) }))
  }
  if (!c.agents.length && !c.workflows.length) kids.push(nothing(el, '  no subagents yet'))
  // warnings
  kids.push(heading(el, `${legend('warnings')} (${c.warnings.length})`))
  kids.push(...(c.warnings.length ? c.warnings.map((w) => T(el, `• ${w.text}`, { color: colorOf(w.level), wrap: 'wrap' })) : [nothing(el, 'none')]))
  // bill
  kids.push(heading(el, `${legend('bill')}: ${fmtUsd(c.total)}`))
  for (const [model, b] of Object.entries(c.bill).sort((a, b) => b[1].cost - a[1].cost)) {
    kids.push(row(el, [T(el, short(model).padEnd(12), { color: colorOf(family(model)) }), T(el, fmtUsd(b.cost).padStart(8)),
      T(el, `${fmtTokens(b.tokens)} tok, ${b.calls} calls`, { dim: true })]))
  }
  kids.push(T(el, 'per turn (main + subagents started in it):', { dim: true }))
  for (const t of c.turns) {
    kids.push(row(el, [T(el, hhmm(t.ts), { dim: true }), T(el, fmtUsd(t.cost).padStart(8)), T(el, t.kind.padEnd(6), { dim: true }),
      T(el, `${t.agents ? `[${t.agents} ag] ` : ''}${t.text}`)]))
  }
  // guards
  kids.push(heading(el, `${legend('guards')} (${c.guards.length})`))
  kids.push(...(c.guards.length ? c.guards.map((g) => row(el, [T(el, hhmm(g.ts), { dim: true }), T(el, g.src, { dim: true }), T(el, g.text, { color: colorOf('warn') })])) : [nothing(el, 'none seen')]))
  // log
  kids.push(heading(el, `${legend('log')} (last ${c.events.length})`))
  for (const e of c.events) kids.push(row(el, [T(el, hhmm(e[0]), { dim: true }), T(el, e[1].padEnd(7), { dim: true }), T(el, e[2])]))
  kids.push(row(el, [
    el.Button({ children: ['Refresh'], onPress: () => { void rescan($) } }),
    el.Button({ children: ['◀ All conversations'], onPress: () => { void go($, 'all') } }),
  ], { marginTop: 1 }))
  return el.Box({ flexDirection: 'column', children: [...head, ...kids] })
}

function drawDashboard($, el, wide) {
  const kids = []
  if (D.error) kids.push(T(el, `scanner: ${D.error}`, { color: colorOf('bad'), wrap: 'wrap' }))
  if (!D.scan) return el.Box({ flexDirection: 'column', children: [...kids, nothing(el, 'Scanning transcripts…')] })
  const g = dashboard(D.scan, CFG, D.at)
  kids.push(row(el, [T(el, `${g.rows.length} conversations · today ${g.today}`, { bold: true }),
    T(el, `${fmtUsd(g.totalCost)} today (${CFG.cost_label || 'estimate'}), ${g.totalCalls} calls`), T(el, `updated ${hhmm(D.at)}${D.busy ? ' …' : ''}`, { dim: true })]))
  // routing shares
  kids.push(heading(el, 'Model share today vs V4.8 routing targets (calls)'))
  kids.push(row(el, g.share.map((s) => T(el, `${s.family} ${Math.round(s.share * 100)}% (target ${s.target}) ${fmtUsd(s.cost)}`,
    { color: colorOf(s.ok ? family(s.family) : 'bad'), bold: !s.ok }))))
  kids.push(heading(el, 'Totals today per model'))
  for (const [m, b] of Object.entries(g.byModel).sort((a, b) => b[1].cost - a[1].cost)) {
    kids.push(row(el, [T(el, short(m).padEnd(12), { color: colorOf(family(m)) }), T(el, fmtUsd(b.cost).padStart(8)), T(el, `${fmtTokens(b.tokens)} tok, ${b.calls} calls`, { dim: true })]))
  }
  kids.push(heading(el, 'Totals today per project'))
  for (const [p, b] of Object.entries(g.byProject).filter(([, b]) => b.cost > 0).sort((a, b) => b[1].cost - a[1].cost)) {
    kids.push(row(el, [T(el, p.padEnd(26)), T(el, fmtUsd(b.cost).padStart(8)), T(el, `${b.sessions} conv, ${fmtTokens(b.tokens)} tok`, { dim: true })]))
  }
  kids.push(heading(el, 'Conversations'))
  kids.push(row(el, ['', 'title', 'repo · branch', 'model · effort', 'ctx', 'today', 'subs', 'PR/MR · CI', 'Julian?', 'last problem']
    .map((h) => T(el, h, { dim: true }))))
  for (const r of g.rows) {
    kids.push(el.Box({
      key: r.cli, flexDirection: wide ? 'row' : 'column', gap: 1, children: [
        el.Button({ children: [r.live ? '●' : '○'], onPress: () => { void go($, 'conv', r.cli) } }),
        T(el, r.title.slice(0, 34).padEnd(34), { bold: r.live }),
        T(el, `${r.repo}${r.branch ? ' · ' + r.branch.replace(/^claude\//, '') : ''}`.slice(0, 40), { dim: true }),
        modelText(el, r.model, r.effort),
        T(el, `${r.ctxPct}%`, { color: colorOf(r.ctxLevel) }),
        T(el, fmtUsd(r.costToday)),
        T(el, `${r.running}/${r.subs}`, { color: r.running ? colorOf('running') : undefined }),
        T(el, r.pr ? `#${r.pr.number} ${r.pr.state} ${r.pr.ci}` : '-', { color: r.pr && r.pr.ci === 'failed' ? colorOf('bad') : undefined }),
        T(el, r.waiting ? legend('waiting_yes') : legend('waiting_no'), { color: r.waiting ? colorOf('warn') : colorOf('dim'), bold: r.waiting }),
        T(el, r.problem || '-', { color: colorOf(r.problemLevel) }),
      ],
    }))
  }
  kids.push(T(el, 'Press ● / ○ to open that conversation’s agent tree.', { dim: true }))
  return el.Box({ flexDirection: 'column', children: kids })
}

// Dashboard filters (buttons above the list) and the clickable conversation list, drawn with native elements.
const FILTERS = [['all', 'All'], ['live', 'Live'], ['problems', 'Problems'], ['julian', 'Waiting on Julian']]

export function filterRows(rows, f) {
  if (f === 'live') return rows.filter((r) => r.live)
  if (f === 'problems') return rows.filter((r) => r.problem && r.problemLevel !== 'ok')
  if (f === 'julian') return rows.filter((r) => r.waiting)
  return rows
}

function convList($, el, g) {
  const rows = filterRows(g.rows, D.filter)
  const kids = [el.Box({ flexDirection: 'row', gap: 1, marginTop: 1, marginBottom: 1, children: FILTERS.map(([k, label]) => el.Button({
    children: [`${label} (${filterRows(g.rows, k).length})`], variant: D.filter === k ? 'primary' : 'secondary',
    onPress: () => { D.filter = k; $.ui.invalidate('ui.render') },
  })) })]
  for (const r of rows) {
    kids.push(el.Box({
      key: 'conv-' + r.cli, flexDirection: 'column', borderStyle: 'round', borderColor: colorOf(r.waiting ? 'warn' : r.live ? 'running' : 'dim'),
      paddingX: 1, marginBottom: 1, children: [
        row(el, [
          el.Button({ children: [`${r.live ? '● ' : ''}${r.title}`], onPress: () => { void go($, 'conv', r.cli) } }),
          T(el, `${r.repo}${r.branch ? ' · ' + r.branch.replace(/^claude\//, '') : ''}`, { dim: true }),
          modelText(el, r.model, r.effort),
        ], { alignItems: 'center' }),
        row(el, [
          T(el, `ctx ${r.ctxPct}%`, { color: colorOf(r.ctxLevel) }),
          T(el, `${fmtUsd(r.costToday)} today`),
          T(el, `agents ${r.running}/${r.subs}`, { color: r.running ? colorOf('running') : colorOf('dim') }),
          r.pr ? T(el, `PR #${r.pr.number} ${r.pr.state} · CI ${r.pr.ci}`, { color: colorOf(r.pr.ci === 'failed' ? 'bad' : r.pr.ci === 'success' ? 'ok' : 'dim') }) : T(el, 'no PR', { dim: true }),
          r.waiting ? T(el, 'waiting on Julian', { color: colorOf('warn'), bold: true }) : null,
        ]),
        r.problem ? T(el, r.problem, { color: colorOf(r.problemLevel) }) : null,
      ].filter(Boolean),
    }))
  }
  if (!rows.length) kids.push(nothing(el, 'nothing in this filter'))
  return kids
}

// Size the Svg explicitly (without it the desktop letterboxes it into a small image): the pane body width
// (bodyColumns x svg.px_per_column) times the zoom, height kept to scale.
function sized(el, source, alt, props) {
  const w0 = Number((source.match(/viewBox="0 0 (\d+)/) || [])[1]) || 760
  const h0 = Number((source.match(/viewBox="0 0 \d+ (\d+)/) || [])[1]) || 600
  const cols = props && Number(props.bodyColumns)
  const pxCol = (CFG.svg && CFG.svg.px_per_column) || 8
  const fit = cols > 0 ? cols * pxCol : w0
  const w = Math.max(320, Math.round(fit * D.zoom))
  return el.Svg({ source, alt, isInteractive: true, width: w, height: Math.round(h0 * w / w0) })
}

function zoomButtons($, el) {
  return [
    el.Button({ children: ['−'], onPress: () => { D.zoom = Math.max(0.5, D.zoom - 0.25); $.ui.invalidate('ui.render') } }),
    el.Button({ children: [`${Math.round(D.zoom * 100)}%`], onPress: () => { D.zoom = 1; $.ui.invalidate('ui.render') } }),
    el.Button({ children: ['+'], onPress: () => { D.zoom = Math.min(3, D.zoom + 0.25); $.ui.invalidate('ui.render') } }),
  ]
}

// Desktop: one pane. View 'all' = dashboard drawing + clickable conversation list; 'conv' = that conversation's tree.
function drawSvg($, el, props) {
  const conv = D.view === 'conv'
  const kids = [el.Box({ flexDirection: 'row', gap: 1, marginBottom: 1, children: [
    conv ? el.Button({ children: ['◀ All conversations'], variant: 'primary', onPress: () => { void go($, 'all') } })
      : el.Button({ children: ['This conversation'], onPress: () => { void go($, 'conv', null) } }),
    el.Button({ children: [D.busy ? 'Refreshing…' : 'Refresh'], onPress: () => { void rescan($) } }),
    ...zoomButtons($, el),
  ] })]
  if (D.error) kids.push(T(el, `scanner: ${D.error}`, { color: colorOf('bad'), wrap: 'wrap' }))
  if (conv) {
    const d = D.scan.detail
    if (d) {
      const m = conversation(d, CFG, D.at)
      kids.push(sized(el, treeSvg(m, CFG, D.at), treeAlt(m), props))
    } else {
      kids.push(nothing(el, D.busy ? 'Scanning transcripts…' : 'Conversation not found in the last scan.'))
    }
  } else {
    const g = dashboard(D.scan, CFG, D.at)
    kids.push(sized(el, dashSvg(g, CFG, D.at, (CFG.routing_targets || {}).metric || 'calls', { rows: false }), dashAlt(g), props))
    kids.push(...convList($, el, g))
  }
  return el.Box({ flexDirection: 'column', children: kids })
}

// Navigate inside the one pane: 'all' (dashboard) or 'conv' (a conversation's tree; target null = this one).
async function go($, view, target) {
  D.view = view
  if (target !== undefined) D.target = target === D.self ? null : target
  $.ui.invalidate('ui.render')
  await rescan($)
}

async function openPane($) {
  D.open = true
  await $.ui.open({ id: 'factory', title: 'Factory', focus: true, closeOnEscape: true })
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try { D.self = await $.session.id() } catch { D.self = null }
    await loadConfig($).catch(() => { CFG = {} })
    $.clock.every(Math.max(5, (CFG && CFG.refresh_s) || 20) * 1000, () => { if (D.open) void rescan($) })
    try {
      await $.command.register({ name: 'factory', description: 'Factory: dashboard of all conversations; click one for its agent tree (/factory <title or id> opens one directly)', immediate: true })
    } catch { /* a name clash must not break the rest */ }
    return next(e)
  })

  on('command.run', { command: 'factory' }, async ($, e) => {
    await loadConfig($)
    try { D.self = (await $.session.id()) || D.self } catch { /* keep the last one */ }
    const q = String(e.args || '').trim()
    if (q.toLowerCase() === 'close') { D.open = false; await $.ui.close({ id: 'factory' }); return {} }
    await openPane($)
    if (!q) { await go($, 'all'); return {} }
    if (!D.scan) await rescan($)
    const s = pickSession(D.scan && D.scan.sessions, q)
    await go($, 'conv', s ? s.cli : q)
    return {}
  })

  on('ui.close', { id: 'factory' }, async ($, e, next) => { D.open = false; return next(e) }).catch(() => undefined)

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== 'factory') return next(e)
    const el = $.ui.resolve(e)
    const wide = e.surface !== 'terminal'
    if (!CFG) CFG = {}
    if (wide && el.Svg && D.scan) return drawSvg($, el, e.props)
    return D.view === 'conv' ? drawConversation($, el, wide) : drawDashboard($, el, wide)
  })
}
