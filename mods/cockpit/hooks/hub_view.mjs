// cockpit - the dispatcher (UX-PRINCIPLES rule 7): block 1 « This laptop », block 2 « Global », then « Open in Cockpit »
// links to the page's modules. Drawn from lib/hub.mjs's model of the local Cockpit's data. Pure except for the element
// kit `h` and the callbacks in S.act.
// S = { cfg, model, error, busy, msg, columns, act: { hubTab(id), panneau(), refresh(), org(id), run(id), done(id),
//       answer(uid, key), fill(text), open(url) } }
import { hubConfig, hubTabs, fill, moduleUrl } from '../lib/hub.mjs'

const clip = (s, n) => { const t = String(s || ''); return n > 3 && t.length > n ? t.slice(0, n - 1) + '…' : t }

// The two buttons above every view of the pane: the dispatcher and « Conversations » (this computer's Panneau).
export function hubBar(h, cfg, current, model, act, o = {}) {
  const c = hubConfig(cfg)
  if (!hubTabs(cfg).length) return null
  return h.row([
    h.btn(c.labels.dispatcher, () => act.hubTab('home'), current === 'home', 'hubtab-home'),
    o.panneau !== false ? h.btn(c.labels.conversations, () => act.panneau(), current === 'panneau', 'hubtab-panneau') : null,
  ], { key: 'hub-tabs', marginBottom: 1 })
}

// « Open in Cockpit »: a Button that opens the page at that module in the browser (S.act.open). Not a Link: the desktop
// app draws a non-https Link as plain text, and the page lives on http://127.0.0.1 (loopback only).
let ACT = null
const link = (h, label, href, key) => h.btn(label, () => ACT && ACT.open(href), false, key)

export function drawHub(h, S) {
  const c = hubConfig(S.cfg)
  const m = S.model
  const W = m ? m.words : c.labels
  const width = Math.max(24, (S.columns || 60) - 4)
  ACT = S.act
  const out = [hubBar(h, S.cfg, 'home', m, S.act)]
  out.push(h.row([
    h.btn(S.busy ? '…' : W.refresh, () => S.act.refresh(), false, 'hub-refresh'),
    h.T(m ? fill(W.pulled, { ago: m.pulled, built: m.built || '?' }) + (m.hubError ? ` · ${m.hubError}` : '') : '', { dim: true, key: 'hub-age', wrap: 'truncate-end' }),
  ], { key: 'hub-head', alignItems: 'center', flexWrap: 'nowrap', marginBottom: 1 }))
  if (S.msg) out.push(h.T(S.msg, { key: 'hub-msg', tone: 'running', wrap: 'wrap' }))
  if (!m) {
    out.push(h.T(S.error || W.no_data, { tone: S.error ? 'warn' : undefined, dim: !S.error, key: 'hub-err', wrap: 'wrap' }))
    out.push(link(h, W.open, moduleUrl(c.base, ''), 'open-page'))
    return h.col(out.filter(Boolean))
  }
  if (S.error) out.push(h.T(S.error, { tone: 'warn', key: 'hub-err', wrap: 'wrap' }))
  if (m.stale) out.push(h.T(m.stale, { tone: 'warn', key: 'hub-stale', wrap: 'wrap' }))
  if (m.orgs.length) {
    out.push(h.row([h.T(W.workspace, { dim: true }), h.btn(W.org_all, () => S.act.org(''), !m.org, 'org-all'),
      ...m.orgs.map((o) => h.btn(o.label, () => S.act.org(o.id), m.org === o.id, 'org-' + o.id))], { key: 'hub-orgs', alignItems: 'center', marginBottom: 1 }))
  }
  out.push(drawLaptop(h, m, c, S, width))
  out.push(drawGlobal(h, m, c, S, width))
  out.push(h.T(W.open, { bold: true, key: 'open-head' }))
  out.push(h.row(m.modules.map((x) => link(h, x.label, x.url, 'open-' + x.id)), { key: 'open-links', marginBottom: 1 }))
  out.push(h.T(m.base, { dim: true, key: 'open-base' }))
  return h.col(out.filter(Boolean))
}

function drawLaptop(h, m, c, S, width) {
  const W = m.words
  const P = m.laptop
  const max = Number(c.max_rows) || 5
  const tmax = Number(c.todo.max) || 3
  const rows = []
  if (!P.known) rows.push(h.T(fill(W.laptop_unknown, { machine: m.machine }), { dim: true, key: 'lp-unknown', wrap: 'wrap' }))
  rows.push(h.T(P.line, { tone: P.tone && P.tone !== 'dim' ? P.tone : undefined, dim: P.tone === 'dim', key: 'lp-state', wrap: 'wrap' }))
  rows.push(h.T([P.temp.text, P.agents, P.seen].filter(Boolean).join(' · '), { tone: P.temp.tone === 'dim' ? undefined : P.temp.tone || undefined, dim: P.temp.tone === 'dim', key: 'lp-temp', wrap: 'wrap' }))
  P.warn.forEach((w, i) => rows.push(h.T(`! ${w.text}`, { tone: w.tone || 'warn', key: 'lp-w' + i, wrap: 'wrap' })))
  rows.push(h.T(`${W.working}: ${P.work.length ? '' : W.working_none}`, { dim: !P.work.length, key: 'lp-work', wrap: 'wrap' }))
  P.work.slice(0, max).forEach((w, i) => rows.push(h.T(`  ${clip(w.text, width * 2)}`, { tone: w.tone, key: 'lp-wk' + i, wrap: 'wrap' })))
  rows.push(h.T(fill(W.todo_here, { n: P.todos.length }), { bold: true, key: 'lp-todo-head' }))
  if (!P.todos.length) rows.push(h.T(W.todo_none, { dim: true, key: 'lp-todo-none' }))
  // one line per to-do; Run and Mark done only on the first one that can run (the rest is one click away in the page)
  const first = P.todos.slice(0, tmax).find((t) => t.canRun)
  P.todos.slice(0, tmax).forEach((t) => {
    const note = t.marked ? W.marked : t.pending ? W.pending : ''
    const title = h.T(`${t.title}${note ? ` (${note})` : ''}`, { bold: t.urgent && !t.marked, tone: t.marked ? 'ok' : t.urgent ? 'bad' : undefined, wrap: 'wrap', key: 'title' })
    rows.push(t === first
      ? h.col([title, h.row([h.btn(W.run, () => S.act.run(t.id), true, 'run-' + t.id), h.btn(W.done, () => S.act.done(t.id), false, 'done-' + t.id)], { key: 'btns' })], { key: `todo-${t.id}` })
      : h.col([title], { key: `todo-${t.id}` }))
  })
  if (P.todos.length > tmax) rows.push(link(h, fill(W.show_all, { n: P.todos.length }), moduleUrl(c.base, 'todo'), 'lp-todo-all'))
  return h.box(fill(W.laptop, { machine: m.label }), rows, { key: 'blk-laptop', tone: P.tone === 'bad' || P.todos.some((t) => t.urgent && !t.marked) ? 'bad' : undefined })
}

function drawGlobal(h, m, c, S, width) {
  const W = m.words
  const G = m.global
  const rows = []
  if (G.fleetLine) rows.push(h.T(G.fleetLine, { key: 'gl-fleet', wrap: 'wrap' }))
  if (G.dots.length) {
    rows.push(h.row(G.dots.map((d) => h.T(`● ${d.label}${d.state === 'busy' ? ' busy' : d.state && d.state !== 'on' ? ` ${d.state}` : ''}`, { tone: d.tone && d.tone !== 'dim' ? d.tone : undefined, dim: d.tone === 'dim', key: 'dot-' + d.id, wrap: 'truncate-end' })),
      { key: 'gl-dots', marginBottom: 1 }))
  }
  rows.push(h.T(`${W.you_block} (${G.youTotal})`, { bold: true, key: 'gl-you-head' }))
  if (!G.you.length) rows.push(h.T(W.you_none, { dim: true, key: 'gl-you-none' }))
  for (const q of G.you) {
    const parts = [
      h.T(q.title, { tone: q.tone || undefined, wrap: 'wrap', key: 'title' }),
      h.T([...q.meta, q.covers].filter(Boolean).join(' · '), { dim: true, key: 'meta', wrap: 'wrap' }),
    ]
    if (q.sent) parts.push(h.T(fill(W.answered, { label: q.sent.label, at: m.time(q.sent.t) }), { tone: 'ok', key: 'sent', wrap: 'wrap' }))
    else if (q.answers.length) {
      parts.push(h.row(q.answers.map((a) => h.btn(`${a.key === 'rec' ? clip(a.label, width - 16) : `${a.key}) ${clip(a.label, width - 18)}`}${a.rec ? ` · ${W.recommended}` : ''}`,
        () => S.act.answer(q.uid, a.key), a.rec, `ans-${q.id}-${a.key}`)), { key: 'answers' }))
    } else if (q.question) parts.push(h.T(`${q.rec ? fill(W.rec_text, { rec: q.rec }) + ' ' : ''}${W.no_answer}`, { dim: true, key: 'hint', wrap: 'wrap' }))
    rows.push(h.col(parts.filter(Boolean), { key: 'you-' + q.uid, marginBottom: 1 }))
  }
  if (G.youAll > G.you.length) rows.push(link(h, fill(W.show_all, { n: G.youAll }), moduleUrl(c.base, 'overview'), 'gl-you-all'))
  if (G.fleetWs) {
    rows.push(h.T(W.errors, { bold: true, key: 'gl-err-head' }))
    if (!G.errors.length) rows.push(h.T(W.errors_none, { dim: true, key: 'gl-err-none' }))
    G.errors.forEach((e, i) => rows.push(h.col([
      h.T(`! ${e.text}`, { tone: e.tone || undefined, key: 'text', wrap: 'wrap' }),
      e.meta.length ? h.T(e.meta.join(' · '), { dim: true, key: 'meta', wrap: 'wrap' }) : null,
    ].filter(Boolean), { key: 'gl-e' + i })))
    if (G.errorsMore) rows.push(link(h, fill(W.show_all, { n: G.errorsTotal }), moduleUrl(c.base, 'overview'), 'gl-err-all'))
    if (G.covered) rows.push(h.T(fill(W.covered, { n: G.covered }), { dim: true, key: 'gl-err-covered', wrap: 'wrap' }))
  }
  if (G.alerts) rows.push(h.row([link(h, G.alerts.text, moduleUrl(c.base, 'alerts'), 'gl-alerts'), G.alerts.listed ? h.T(G.alerts.listed, { dim: true, key: 'gl-alerts-listed', wrap: 'wrap' }) : null].filter(Boolean), { key: 'gl-alerts-row', alignItems: 'center' }))
  if (G.urgentElsewhere) rows.push(link(h, fill(W.urgent_elsewhere, { n: G.urgentElsewhere }), moduleUrl(c.base, 'todo'), 'gl-urgent-else'))
  rows.push(h.T(W.actions, { bold: true, key: 'gl-act-head' }))
  rows.push(h.row([
    h.btn(W.send_job, () => S.act.fill('/dispatch '), false, 'act-dispatch'),
    h.btn(W.add_todo, () => S.act.fill('/todo '), false, 'act-todo'),
  ], { key: 'gl-actions' }))
  rows.push(h.T(fill(W.send_hint, { machines: G.targets.join(', ') }), { dim: true, key: 'gl-act-hint', wrap: 'wrap' }))
  const tone = G.errors.some((e) => e.tone === 'bad') || G.you.some((q) => q.tone === 'bad') ? 'bad' : undefined
  return h.box(`${W.global}${m.org ? ` · ${(m.orgs.find((o) => o.id === m.org) || {}).label || m.org}` : ''}`, rows, { key: 'blk-global', tone })
}
