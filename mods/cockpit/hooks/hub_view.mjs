// cockpit - the dispatcher (UX-PRINCIPLES rule 7): block 1 « This laptop », block 2 « Global », then « Open in Cockpit »
// links to the page's modules. Drawn from lib/hub.mjs's model of the local Cockpit's data. Pure except for the element
// kit `h` and the callbacks in S.act.
// S = { cfg, model, error, busy, msg, columns, act: { hubTab(id), panneau(), refresh(), org(id), run(id), done(id),
//       answer(uid, key), fill(text), open(url) } }
import { hubConfig, hubTabs, fill, moduleUrl, fmtTime } from '../lib/hub.mjs'

const URG_WORD = { now: 'urgent', today: 'today', week: 'this week', later: 'later' }
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
  const rows = []
  if (!P.known) rows.push(h.T(fill(W.laptop_unknown, { machine: m.machine }), { dim: true, key: 'lp-unknown', wrap: 'wrap' }))
  rows.push(h.T(P.line, { tone: P.tone || undefined, key: 'lp-state', wrap: 'wrap' }))
  rows.push(h.T([P.temp.text, P.agents, P.seen].filter(Boolean).join(' · '), { tone: P.temp.tone === 'dim' ? undefined : P.temp.tone || undefined, dim: P.temp.tone === 'dim', key: 'lp-temp', wrap: 'wrap' }))
  P.warn.forEach((w, i) => rows.push(h.T(`! ${w.text}`, { tone: w.tone || 'warn', key: 'lp-w' + i, wrap: 'wrap' })))
  rows.push(h.T(`${W.working}: ${P.work.length ? '' : W.working_none}`, { dim: !P.work.length, key: 'lp-work', wrap: 'wrap' }))
  P.work.slice(0, max).forEach((w, i) => rows.push(h.T(`  ${clip(w.text, width * 2)}`, { tone: w.tone, key: 'lp-wk' + i, wrap: 'wrap' })))
  rows.push(h.T(fill(W.todo_here, { n: P.todos.length }), { bold: true, key: 'lp-todo-head' }))
  if (!P.todos.length) rows.push(h.T(W.todo_none, { dim: true, key: 'lp-todo-none' }))
  P.todos.slice(0, max).forEach((t) => rows.push(h.col([
    h.row([
      h.T(`${t.nn ? t.nn + ' ' : ''}${t.title}`, { bold: t.urgent, tone: t.urgent ? 'bad' : t.marked ? 'ok' : undefined, wrap: 'wrap' }),
      t.canRun ? h.btn(W.run, () => S.act.run(t.id), t.urgent, 'run-' + t.id) : null,
      t.canRun ? h.btn(W.done, () => S.act.done(t.id), false, 'done-' + t.id) : null,
    ], { alignItems: 'center' }),
    t.tags.length || t.marked || t.pending ? h.T([t.tags.map((x) => `[${x}]`).join(' '), t.marked ? W.marked : t.pending ? W.pending : ''].filter(Boolean).join(' · '), { dim: true, key: 'sub', wrap: 'wrap' }) : null,
  ], { key: `todo-${t.id}` })))
  if (P.todos.length > max) rows.push(link(h, fill(W.show_all, { n: P.todos.length }), moduleUrl(c.base, 'todo'), 'lp-todo-all'))
  return h.box(fill(W.laptop, { machine: m.label }), rows, { key: 'blk-laptop', tone: P.tone === 'bad' || P.todos.some((t) => t.urgent && !t.marked) ? 'bad' : undefined })
}

function drawGlobal(h, m, c, S, width) {
  const W = m.words
  const G = m.global
  const rows = []
  if (G.fleetLine) rows.push(h.T(G.fleetLine, { key: 'gl-fleet', wrap: 'wrap' }))
  // the quota row: the page's Quota reading, one exhaust time, the mode (unlimited = yellow)
  if (G.quota) rows.push(link(h, `● ${G.quota.text}${G.quota.covers.length ? ` · covers ${G.quota.covers.join(', ')}` : ''}`, moduleUrl(c.base, 'quota'), 'gl-quota'))
  if (G.dots.length) {
    rows.push(h.row(G.dots.map((d) => h.T(`● ${d.label}${d.alerts ? ` (${d.alerts})` : ''}`, { tone: d.tone || undefined, dim: d.tone === 'dim', key: 'dot-' + d.id, wrap: 'truncate-end' })),
      { key: 'gl-dots', marginBottom: 1 }))
  }
  rows.push(h.T(`${W.you_block} (${G.youTotal})`, { bold: true, key: 'gl-you-head' }))
  if (!G.you.length) rows.push(h.T(W.you_none, { dim: true, key: 'gl-you-none' }))
  for (const q of G.you) {
    const parts = [
      h.T(q.title, { tone: q.tone || undefined, wrap: 'wrap', key: 'title' }),
      h.T([q.app, URG_WORD[q.urgency] || q.urgency, q.covers, q.id].filter(Boolean).join(' · '), { dim: true, key: 'meta', wrap: 'truncate-end' }),
    ]
    if (q.sent) parts.push(h.T(fill(W.answered, { label: q.sent.label, at: fmtTime(q.sent.t, m.topt) }), { tone: 'ok', key: 'sent', wrap: 'wrap' }))
    else if (q.answers.length) {
      parts.push(h.row(q.answers.map((a) => h.btn(`${a.key === 'rec' ? clip(a.label, width - 16) : `${a.key}) ${clip(a.label, width - 18)}`}${a.rec ? ` · ${W.recommended}` : ''}`,
        () => S.act.answer(q.uid, a.key), a.rec, `ans-${q.id}-${a.key}`)), { key: 'answers' }))
    } else if (q.question) parts.push(h.T(`${q.rec ? fill(W.rec_text, { rec: q.rec }) + ' ' : ''}${W.no_answer}`, { dim: true, key: 'hint', wrap: 'wrap' }))
    rows.push(h.col(parts.filter(Boolean), { key: 'you-' + q.uid, marginBottom: 1 }))
  }
  if (G.youTotal > G.you.length) rows.push(link(h, fill(W.show_all, { n: G.youTotal }), moduleUrl(c.base, 'overview'), 'gl-you-all'))
  if (G.errors.length) {
    rows.push(h.T(W.errors, { bold: true, key: 'gl-err-head' }))
    G.errors.forEach((e, i) => rows.push(h.T(`! ${e.text}`, { tone: e.tone, key: 'gl-e' + i, wrap: 'wrap' })))
    if (G.errorsMore) rows.push(link(h, fill(W.show_all, { n: G.errors.length + G.errorsMore }), moduleUrl(c.base, 'overview'), 'gl-err-all'))
  }
  if (G.later) rows.push(link(h, fill(W.later, { n: G.later }), moduleUrl(c.base, 'overview'), 'gl-later'))
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
