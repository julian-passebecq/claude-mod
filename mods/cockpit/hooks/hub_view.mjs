// cockpit - the hub tabs (Overview, To do, Questions and checks, Fleet, Quota, Alerts, Journal, Watch, Lanes) drawn from
// lib/hub.mjs's model of the local Cockpit's /data.json. Pure except for the element kit `h` and the callbacks in S.act.
// S = { cfg, tab (hub id), model, error, busy, msg, columns, act: { hubTab(id), panneau(), refresh(), org(id), run(id), done(id) } }
import { hubConfig, hubTabs, fill } from '../lib/hub.mjs'

const clip = (s, n) => { const t = String(s || ''); return n > 3 && t.length > n ? t.slice(0, n - 1) + '…' : t }

// The tab bar shared by every view of the pane: the hub tabs, then « Conversations » (the Panneau).
export function hubBar(h, cfg, current, model, act, o = {}) {
  const c = hubConfig(cfg)
  const tabs = hubTabs(cfg)
  if (!tabs.length) return null
  const n = (id) => (model && model.counts && model.counts[id] ? ` ${model.counts[id]}` : '')
  return h.row([
    ...tabs.map((t) => h.btn(`${t.label}${t.id === 'todo' && model ? ` (${model.hereOpen})` : (t.id === 'alerts' || t.id === 'questions') && n(t.id) ? ` (${n(t.id).trim()})` : ''}`,
      () => act.hubTab(t.id), t.id === current, 'hubtab-' + t.id)),
    o.panneau !== false ? h.btn(c.tabs.labels.panneau || 'Conversations', () => act.panneau(), current === 'panneau', 'hubtab-panneau') : null,
  ], { key: 'hub-tabs', marginBottom: 1 })
}

export function drawHub(h, S) {
  const c = hubConfig(S.cfg)
  const L = c.labels
  const m = S.model
  const width = Math.max(30, (S.columns || 75) - 4)
  const out = [hubBar(h, S.cfg, S.tab, m, S.act)]
  out.push(h.row([
    h.btn(S.busy ? '…' : L.refresh, () => S.act.refresh(), false, 'hub-refresh'),
    h.T(m ? fill(L.pulled, { machine: m.label, ago: m.pulled }) + (m.hubError ? ` · ${m.hubError}` : '') : '', { dim: true, key: 'hub-age', wrap: 'truncate-end' }),
  ], { key: 'hub-head', alignItems: 'center', flexWrap: 'nowrap', marginBottom: 1 }))
  if (m && m.orgs.length) {
    out.push(h.row([h.T(L.workspace, { dim: true }), h.btn(L.org_all, () => S.act.org(''), !m.org, 'org-all'),
      ...m.orgs.map((o) => h.btn(o.label, () => S.act.org(o.id), m.org === o.id, 'org-' + o.id))], { key: 'hub-orgs', alignItems: 'center', marginBottom: 1 }))
  }
  if (S.msg) out.push(h.T(S.msg, { key: 'hub-msg', tone: 'running' }))
  if (!m) {
    out.push(h.T(S.error || L.no_data, { tone: S.error ? 'warn' : undefined, dim: !S.error, key: 'hub-err' }))
    return h.col(out.filter(Boolean))
  }
  if (S.error) out.push(h.T(S.error, { tone: 'warn', key: 'hub-err' }))
  if (m.stale) out.push(h.T(m.stale, { tone: 'warn', key: 'hub-stale' }))
  const draw = { overview: drawOverview, todo: drawTodo, questions: drawQuestions, fleet: drawFleet, quota: drawQuota, alerts: drawAlerts,
    journal: drawJournal, watch: drawWatch, lanes: drawLanes }[S.tab] || drawOverview
  out.push(...draw(h, m, c, S, width))
  return h.col(out.filter(Boolean))
}

const head = (h, text, key, o = {}) => h.T(text, { bold: true, key, ...o })
const more = (h, L, n, key) => (n > 0 ? h.T(fill(L.more, { n }), { dim: true, key }) : null)
const none = (h, text, key) => h.T(text, { dim: true, key })

function drawOverview(h, m, c, S, width) {
  const L = c.labels
  const o = m.overview
  const OL = { ...L, ...o.labels }
  const max = o.max
  const out = []
  // You
  const you = [h.T(o.you.counts, { dim: true, key: 'ov-you-counts' })]
  o.you.todos.slice(0, max).forEach((t, i) => you.push(h.T(`• ${clip(t.title, width)}  ${m.labels[t.machine] || t.machine}${Number.isFinite(t.prio) ? ' · p' + t.prio : ''}`,
    { key: 'ov-t' + i, tone: t.prio >= Number(c.todo.urgent_prio) ? 'warn' : undefined, wrap: 'truncate-end' })))
  you.push(more(h, L, o.you.todos.length - max, 'ov-t-more'))
  o.you.questions.slice(0, max).forEach((q, i) => you.push(h.T(`? ${q.id} ${clip(q.title, width)}${q.rec ? ' · ' + fill(L.recommended, { rec: q.rec }) : ''}`,
    { key: 'ov-q' + i, tone: q.tone || undefined, wrap: 'truncate-end' })))
  you.push(more(h, L, o.you.questions.length - max, 'ov-q-more'))
  out.push(h.box(OL.you || L.you, you, { key: 'ov-you' }))
  // Errors
  const err = o.errors.length ? o.errors.slice(0, max).map((r, i) => h.T(`${r.severity ? r.severity + ' · ' : ''}${r.kind ? r.kind + ': ' : ''}${r.text}`,
    { key: 'ov-e' + i, tone: r.tone || undefined, wrap: 'wrap' })) : [none(h, OL.errors_none || L.errors_none, 'ov-e-none')]
  err.push(more(h, L, o.errors.length - max, 'ov-e-more'))
  if (o.blocked) err.push(h.T(o.blocked, { dim: true, key: 'ov-blocked' }))
  out.push(h.box(OL.errors || L.errors, err, { key: 'ov-errors', tone: o.errors.some((r) => r.tone === 'bad') ? 'bad' : undefined }))
  // By application
  const apps = o.apps.slice(0, max).map((a, i) => h.col([
    h.row([h.T(`${a.rank || i + 1}. ${clip(a.label, width - 20)}`, { bold: true, wrap: 'truncate-end' }), h.T(a.eta, { tone: a.etaState === 'waits' ? 'warn' : undefined })],
      { justifyContent: 'space-between', flexWrap: 'nowrap' }),
    a.sentence ? h.T(a.sentence, { dim: true, wrap: 'wrap' }) : null,
  ], { key: 'ov-a' + i, marginBottom: 1 }))
  apps.push(more(h, L, o.apps.length - max, 'ov-a-more'))
  out.push(h.box(OL.apps || L.apps, apps.length ? apps : [none(h, '—', 'ov-a-none')], { key: 'ov-apps' }))
  // Running
  const run = o.running.jobs.map((j, i) => h.T(`job #${j.id} ${j.kind} on ${m.labels[j.machine] || j.machine}${j.eta ? ' · ' + fill(L.eta, { at: j.eta }) : ''}`, { key: 'ov-j' + i, tone: 'running' }))
  if (o.running.lanes) run.push(h.T(`${o.running.lanes} ${L.lanes_lanes.toLowerCase()}`, { key: 'ov-lanes', dim: true }))
  if (o.running.runner) run.push(h.T(clip(o.running.runner, width * 2), { key: 'ov-runner', dim: true, wrap: 'wrap' }))
  out.push(h.box(OL.running || L.running, run.length ? run : [none(h, OL.running_none || L.running_none, 'ov-r-none')], { key: 'ov-running' }))
  return out
}

function todoRow(h, t, c, S, width) {
  const L = c.labels
  const tags = [...t.tags, t.machineLabel, t.prio !== null ? 'p' + t.prio : ''].filter(Boolean)
  return h.col([
    h.row([
      h.T(`${t.nn ? t.nn + ' ' : ''}${clip(t.title, width - 4)}`, { bold: true, tone: t.urgent ? 'warn' : undefined, wrap: 'wrap' }),
      t.canRun ? h.btn(L.run, () => S.act.run(t.id), true, 'run-' + t.id) : null,
      t.canRun ? h.btn(L.done, () => S.act.done(t.id), false, 'done-' + t.id) : null,
    ], { alignItems: 'center' }),
    h.T(tags.map((x) => `[${x}]`).join(' '), { dim: true, key: 'tags', wrap: 'truncate-end' }),
    t.marked ? h.T(L.marked, { tone: 'ok', key: 'marked' }) : null,
    t.pending ? h.T(L.pending, { dim: true, key: 'pending' }) : null,
    ...t.why.slice(0, Number(c.todo.why_lines) || 2).map((w, i) => h.T(clip(w, width * 3), { dim: true, key: 'w' + i, wrap: 'wrap' })),
    t.note ? h.T('note: ' + t.note, { dim: true, key: 'note' }) : null,
  ], { key: `todo-${t.machine}-${t.id}`, marginBottom: 1 })
}

function drawTodo(h, m, c, S, width) {
  const L = c.labels
  const T = m.todo
  const out = []
  const group = (title, list, key, tone) => { if (list.length) out.push(h.box(`${title} (${list.length})`, list.map((t) => todoRow(h, t, c, S, width)), { key, tone })) }
  group(L.todo_urgent, T.urgent, 'todo-urgent', 'warn')
  group(L.todo_ongoing, T.ongoing, 'todo-ongoing', 'running')
  group(`${L.todo_here} · ${m.label}`, T.here, 'todo-here')
  group(L.todo_elsewhere, T.elsewhere, 'todo-elsewhere')
  if (!out.length) out.push(none(h, L.todo_none, 'todo-none'))
  return out
}

function drawQuestions(h, m, c, S, width) {
  const L = c.labels
  const Q = m.questions
  const out = []
  out.push(h.box(`${L.questions} (${Q.questions.length})`, Q.questions.length ? Q.questions.map((q, i) => h.col([
    h.T(`${q.id} · ${q.title}`, { bold: true, tone: q.tone || undefined, wrap: 'wrap' }),
    h.T([q.severity, q.options ? `${q.options} options` : '', q.rec ? fill(L.recommended, { rec: q.rec }) : ''].filter(Boolean).join(' · '), { dim: true }),
  ], { key: 'q-' + i, marginBottom: 1 })) : [none(h, L.questions_none, 'q-none')], { key: 'q-box' }))
  if (Q.inbox.length) {
    out.push(h.box(`${L.inbox_questions} (${Q.inbox.length})`, Q.inbox.slice(0, Number(c.max_rows) * 3).map((q, i) => h.col([
      h.T(`${q.id} · ${q.title}`, { bold: true, tone: q.tone || undefined, wrap: 'wrap' }),
      h.T([q.urgency, q.priority, q.app, m.org ? '' : q.org].filter(Boolean).join(' · '), { dim: true, wrap: 'truncate-end' }),
    ], { key: 'iq-' + i, marginBottom: 1 })).concat([more(h, L, Q.inbox.length - Number(c.max_rows) * 3, 'iq-more')].filter(Boolean)), { key: 'iq-box' }))
  }
  if (Q.answers.length) {
    out.push(h.box(fill(L.answers, { source: Q.source }), Q.answers.map((a, i) => h.col([
      h.T(`Q${a.n} · ${a.q}`, { bold: true, wrap: 'wrap' }),
      a.options ? h.T(a.options, { dim: true, wrap: 'wrap' }) : null,
      a.rec ? h.T(fill(L.recommended, { rec: a.rec }), { tone: 'ok', wrap: 'wrap' }) : null,
    ], { key: 'a-' + i, marginBottom: 1 })), { key: 'a-box' }))
  }
  if (Q.checks.length) {
    out.push(h.box(`${L.checks} (${Q.checks.length})`, Q.checks.map((k, i) => h.T(`• ${clip(k.title, width)} · ${k.machine} · ${k.check}`, { key: 'k-' + i, wrap: 'wrap', dim: true })), { key: 'k-box' }))
  }
  return out
}

function drawFleet(h, m, c, S, width) {
  const L = c.labels
  const F = m.fleet
  const out = []
  if (F.herd) out.push(h.T(F.herd, { key: 'herd', bold: true }))
  for (const x of F.machines) {
    out.push(h.col([
      h.row([h.T(`${x.here ? '▸' : '•'} ${x.label}`, { bold: true }), h.T(x.state, { tone: x.tone || undefined }), x.role && x.role !== x.state ? h.T(x.role, { dim: true }) : null], { alignItems: 'center' }),
      h.T([x.worker && `worker ${x.worker}`, (x.running || x.queued) && `jobs ${x.running}/${x.queued}`, x.cpu !== null && `cpu ${x.cpu}%`, x.ram !== null && `ram ${x.ram}%`,
        x.open && `${x.open} to-do`, x.alerts && `${x.alerts} alert`, x.seen && `seen ${x.seen}`].filter(Boolean).join(' · '), { dim: true, wrap: 'wrap' }),
      x.disks.length ? h.T(x.disks.join(' · '), { dim: true, wrap: 'truncate-end' }) : null,
    ], { key: 'm-' + x.id, marginBottom: 1 }))
  }
  if (F.lost.length) out.push(h.box(L.lost, F.lost.map((t, i) => h.T(t, { key: 'lost' + i, dim: true, wrap: 'wrap' })), { key: 'lost' }))
  out.push(h.T(L.send_hint, { dim: true, key: 'hint', wrap: 'wrap' }))
  return out
}

function pctBar(pct, w = 20) {
  const n = Math.round((Math.max(0, Math.min(100, Number(pct) || 0)) / 100) * w)
  return '█'.repeat(n) + '░'.repeat(w - n)
}

function drawQuota(h, m, c, S, width) {
  const L = c.labels
  const Q = m.quota
  const out = []
  const hub = Q.hub.length ? Q.hub.map((w, i) => h.col([
    h.row([h.T(`${w.provider} · ${w.window}${w.account ? ' · ' + clip(w.account, 20) : ''}`, { bold: true, wrap: 'truncate-end' }),
      h.T(w.pct === null ? '—' : `${Math.round(w.pct)} %`, { tone: w.tone || undefined, bold: true })], { justifyContent: 'space-between', flexWrap: 'nowrap' }),
    w.pct !== null ? h.T(pctBar(w.pct, Math.min(30, width - 10)), { tone: w.tone || 'running' }) : null,
    w.line ? h.T(w.line + (w.stale ? ' · stale' : ''), { dim: true, wrap: 'wrap' }) : null,
  ], { key: 'qh-' + i, marginBottom: 1 })) : [none(h, L.quota_none, 'qh-none')]
  Q.warnings.forEach((w, i) => hub.push(h.T(w.text, { tone: w.tone || undefined, key: 'qw-' + i, wrap: 'wrap' })))
  out.push(h.box(L.quota_hub + (Q.generated ? ` · ${Q.generated}` : ''), hub, { key: 'q-hub' }))
  if (Q.local.length) out.push(h.box(L.quota_local, Q.local.map((w, i) => h.lr(w.label, w.text, { key: 'ql-' + i, dimRight: w.pct === null })), { key: 'q-local' }))
  return out
}

function drawAlerts(h, m, c, S, width) {
  const L = c.labels
  const A = m.alerts
  const out = []
  const rows = (list, key) => list.map((a, i) => h.T(`${a.machine ? a.machine + ' · ' : ''}${a.severity ? a.severity + ' · ' : ''}${a.text}`, { key: key + i, tone: a.tone || undefined, wrap: 'wrap' }))
  out.push(h.box(`${L.alerts_hub} (${A.hub.length})`, A.hub.length ? rows(A.hub, 'ah') : [none(h, L.alerts_none, 'ah-none')], { key: 'a-hub' }))
  if (A.machines.length) out.push(h.box(`${L.alerts_machines} (${A.machines.length})`, rows(A.machines, 'am'), { key: 'a-m' }))
  if (A.local.length) out.push(h.box(`${L.alerts_local} (${A.local.length})`, rows(A.local, 'al'), { key: 'a-l' }))
  if (A.link) out.push(h.T(A.link, { dim: true, key: 'a-link' }))
  return out
}

function drawJournal(h, m, c, S, width) {
  const J = m.journal
  if (J.lines.length) {
    const out = J.lines.map((l, i) => (l.startsWith('#') ? h.T(l.replace(/^#+\s*/, ''), { bold: true, key: 'jl-' + i, wrap: 'wrap' }) : h.T(l.replace(/\*\*/g, ''), { key: 'jl-' + i, wrap: 'wrap' })))
    if (J.cut) out.push(h.T(c.labels.watch_cut, { dim: true, key: 'j-cut' }))
    return out
  }
  if (!J.rows.length) return [none(h, c.labels.journal_none, 'j-none')]
  return J.rows.map((r, i) => h.col([
    h.T(`${r.at}${r.kind ? ' · ' + r.kind : ''}`, { dim: true }),
    h.T(r.text, { wrap: 'wrap' }),
  ], { key: 'j-' + i, marginBottom: 1 }))
}

function drawWatch(h, m, c, S, width) {
  const W = m.watch
  if (!W.lines.length) return [none(h, c.labels.watch_none, 'w-none')]
  const out = W.lines.map((l, i) => (l.startsWith('#') ? h.T(l.replace(/^#+\s*/, ''), { bold: true, key: 'w-' + i, wrap: 'wrap' })
    : h.T(l.replace(/\*\*/g, ''), { key: 'w-' + i, wrap: 'wrap', dim: !l.trim() })))
  if (W.cut) out.push(h.T(c.labels.watch_cut, { dim: true, key: 'w-cut' }))
  return out
}

function drawLanes(h, m, c, S, width) {
  const L = c.labels
  const X = m.lanes
  const out = []
  out.push(h.box(`${L.lanes_lanes} (${X.lanes.length})`, X.lanes.length ? X.lanes.map((l, i) => h.col([
    h.T(`${l.id} · ${l.title}`, { bold: true, wrap: 'wrap' }),
    h.T([l.owner, l.since ? fill(L.since, { d: l.since }) : '', l.state, l.apps.join(', ')].filter(Boolean).join(' · '), { dim: true, wrap: 'wrap' }),
  ], { key: 'l-' + i, marginBottom: 1 })) : [none(h, L.lanes_none, 'l-none')], { key: 'l-box' }))
  if (X.jobs.length) out.push(h.box(L.lanes_jobs, X.jobs.map((j, i) => h.T(`#${j.id} ${j.kind} · ${j.machine}${j.eta ? ' · ' + fill(L.eta, { at: j.eta }) : ''}${j.basis ? ' · ' + j.basis : ''}`, { key: 'lj-' + i, tone: 'running', wrap: 'wrap' })), { key: 'l-jobs' }))
  if (X.runner) out.push(h.box(L.lanes_runner, [h.T(X.runner, { wrap: 'wrap' }), X.runnerAt ? h.T(X.runnerAt, { dim: true }) : null], { key: 'l-runner' }))
  if (X.presence) out.push(h.T(X.presence, { dim: true, key: 'l-presence' }))
  return out
}
