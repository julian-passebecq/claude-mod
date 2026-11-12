// Hub tabs of the Cockpit: the SAME data the local Cockpit page shows (herd-worker on every laptop serves it on
// http://127.0.0.1:24365, loopback only), so this pane, the page and the VS Code extension never disagree.
//   GET  /local.json   this computer: machine id, delivered to-dos, marked done, last pull from the hub
//   GET  /data.json    the hub's cockpit data (schema herd.cockpit/1): labels, todo per machine, fleet, digest,
//                      answers, overview (you, errors, apps, running); later lanes may add quota, journal, lanes,
//                      watch and organizations: each tab uses that key when present and derives a view otherwise
//   GET  /             the page; its <meta name="cockpit-token"> is the per-start token every POST carries
//   POST /api/run, /api/done {id}; /api/dispatch, /api/todo {machine, text}  (a 404 = "not available yet")
// Pure: no `$`, no engine call. Everything shown is a label from hub.labels (cockpit.config.json, user file over it).
// Ported from claude-control mods/fleet/lib/fleet.mjs (the separate Fleet mod this replaces).

export const HUB_TABS = ['overview', 'todo', 'questions', 'fleet', 'quota', 'alerts', 'journal', 'watch', 'lanes']
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
export const MAX_TEXT = 2000

export const HUB_DEFAULTS = {
  enabled: true,
  base: 'http://127.0.0.1:24365',
  // the view the pane opens on: a hub tab id, or "panneau" (the conversations list)
  start: 'overview',
  refresh_s: 60,
  status_line: true,
  tabs: {
    order: HUB_TABS,
    labels: { overview: 'Overview', todo: 'To do', questions: 'Questions and checks', fleet: 'Fleet', quota: 'Quota', alerts: 'Alerts',
      journal: 'Journal', watch: 'Watch', lanes: 'Lanes', panneau: 'Conversations' },
  },
  max_rows: 8,
  todo: { urgent_prio: 8, tag_re: '^\\s*\\[([^\\]]{1,24})\\]\\s*', why_lines: 2 },
  severity_order: ['critical', 'urgent', 'high', 'normal', 'watch', 'low', 'info', 'ok'],
  urgency_order: ['now', 'soon', 'later', 'someday'],
  severity_tone: { critical: 'bad', urgent: 'bad', high: 'warn', watch: 'warn', normal: '', low: 'dim', info: 'dim', ok: 'ok' },
  state_tone: { live: 'ok', hub: 'ok', busy: 'running', viewer: 'dim', stale: 'warn', gaming: 'warn', offline: 'bad', down: 'bad' },
  quota: { watch: 50, high: 75, critical: 90 },
  watch_lines: 40,
  journal_lines: 80,
  journal_max: 30,
  labels: {
    offline: 'The local Cockpit is not reachable on {base} (herd-worker not running here?)',
    no_data: 'Hub data not pulled yet',
    pulled: '{machine} · pulled {ago}',
    stale: 'Hub overview older than {h} h: the hub cron did not run',
    refresh: '↻',
    org_all: 'All',
    workspace: 'Workspace',
    you: 'You: only you can do these',
    you_counts: '{todos} to-dos · {questions} questions · {blocked} backlog items wait on you',
    errors: 'Errors and blocks',
    errors_none: 'No error, failed job, offline machine or quota warning.',
    apps: 'By application',
    running: 'Running now and ETA',
    running_none: 'Nothing running.',
    more: '+ {n} more',
    todo_urgent: 'Urgent',
    todo_ongoing: 'Ongoing',
    todo_here: 'On this computer',
    todo_elsewhere: 'Elsewhere',
    todo_none: 'Nothing to do.',
    run: 'Run',
    done: 'Mark done',
    marked: 'marked done, closes at the next hub tick',
    pending: 'The script reaches this computer at the next sync (about 10 minutes).',
    questions: 'Questions waiting on you',
    inbox_questions: 'Inbox questions for you',
    answers: 'Answer sheet ({source})',
    checks: 'Checks that close by themselves',
    questions_none: 'No open question.',
    recommended: 'recommended: {rec}',
    herd: '{up} machines up · {running} jobs running · {queued} queued · {open} to-dos open · {alerts} alerts',
    lost: 'Lost jobs (24 h)',
    send_hint: 'Send: /dispatch <machine> <text> (a job) · /todo <machine> <text> (an item for Julian)',
    quota_hub: 'Fleet quota (hub)',
    quota_local: 'This computer (Claude Code)',
    quota_none: 'The hub data carries no quota block yet.',
    quota_exhaust: 'empties {at}, before its reset',
    quota_resets: 'resets {at}',
    alerts_hub: 'Hub',
    alerts_machines: 'Machines',
    alerts_local: 'Watcher on this computer',
    alerts_none: 'No alert.',
    journal_none: 'Nothing in the journal yet.',
    watch_none: 'No technology watch digest yet.',
    watch_cut: '(cut: the full digest is on the hub)',
    lanes_none: 'No lane running.',
    lanes_jobs: 'Jobs',
    lanes_lanes: 'Lanes',
    lanes_runner: 'Backlog runner',
    eta: 'ETA {at}',
    since: 'since {d}',
  },
}

export function hubConfig(cfg) {
  const u = (cfg && cfg.hub) || {}
  const d = HUB_DEFAULTS
  return {
    ...d, ...u,
    tabs: { ...d.tabs, ...(u.tabs || {}), labels: { ...d.tabs.labels, ...((u.tabs || {}).labels || {}) } },
    todo: { ...d.todo, ...(u.todo || {}) },
    severity_tone: { ...d.severity_tone, ...(u.severity_tone || {}) },
    state_tone: { ...d.state_tone, ...(u.state_tone || {}) },
    quota: { ...d.quota, ...(u.quota || {}) },
    labels: { ...d.labels, ...(u.labels || {}) },
  }
}

export function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
}

// The hub tabs in order (unknown ids dropped), each {id, label}.
export function hubTabs(cfg) {
  const c = hubConfig(cfg)
  if (c.enabled === false) return []
  const order = (Array.isArray(c.tabs.order) ? c.tabs.order : HUB_TABS).filter((t) => HUB_TABS.includes(t))
  return order.map((id) => ({ id, label: c.tabs.labels[id] || id }))
}

// D.tab of a hub tab: "hub-<id>"
export const tabKey = (id) => 'hub-' + id
export const hubIdOf = (tab) => (typeof tab === 'string' && tab.startsWith('hub-') && HUB_TABS.includes(tab.slice(4)) ? tab.slice(4) : null)

export function ago(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'never'
  const s = Math.round(ms / 1000)
  if (s < 90) return `${s} s ago`
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

const arr = (x) => (Array.isArray(x) ? x : [])
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {})
const str = (x) => (x === undefined || x === null ? '' : String(x))
const tsOf = (x) => {
  if (typeof x === 'number') return x > 1e12 ? x : x * 1000
  const t = Date.parse(str(x))
  return Number.isFinite(t) ? t : 0
}
// "2026-11-12T16:24:03Z" -> "12 Nov 16:24 UTC" (the hub writes UTC; the reader's clock is not assumed)
export function when(x) {
  const t = tsOf(x)
  if (!t) return str(x)
  const d = new Date(t)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  return `${d.getUTCDate()} ${mon} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

function sevRank(c, s) {
  const i = c.severity_order.indexOf(str(s).toLowerCase())
  return i < 0 ? c.severity_order.length : i
}
const sevTone = (c, s) => c.severity_tone[str(s).toLowerCase()] || ''

// ---- organizations (another lane adds them; tolerate absence) -------------------------------------------------------

// data.organizations ([{id, label}] or {id: label}), else the inbox's orgs (data.inbox.orgs, herd.inbox/1); else []
export function orgsOf(data) {
  const o = data && (data.organizations || (data.inbox && data.inbox.orgs))
  if (Array.isArray(o)) return o.filter((x) => x && (x.id || typeof x === 'string')).map((x) => (typeof x === 'string' ? { id: x, label: x } : { id: str(x.id), label: str(x.label || x.name || x.id), confidential: Boolean(x.confidential) }))
  if (o && typeof o === 'object') return Object.entries(o).map(([id, v]) => ({ id, label: str((v && (v.label || v.name)) || v || id) }))
  return []
}

// An item belongs to org when it names it (org, organization, orgs[]); an item naming none is shared by all.
export function inOrg(item, org) {
  if (!org) return true
  const it = obj(item)
  const named = [it.org, it.organization, ...arr(it.orgs)].filter(Boolean).map(str)
  return !named.length || named.includes(org)
}

// ---- the model -------------------------------------------------------------------------------------------------------

/**
 * local (/local.json) + data (/data.json) -> what every hub tab draws. opts: {now, org, usage, veille} where usage and
 * veille are the cockpit's own local readings (the Quota and Alerts tabs show them under the hub's).
 */
export function hubModel(local, data, cfg, opts = {}) {
  const c = hubConfig(cfg)
  const L = obj(local)
  const D = obj(data)
  const now = Number(opts.now) || Number(L.now) || 0
  const org = str(opts.org)
  const machine = str(L.machine)
  const labels = obj(D.labels)
  const label = (id) => str(labels[id] || id)
  const ov = obj(D.overview)
  const fl = obj(D.fleet)
  // an item of a confidential organization shows only in its own workspace, never under « All »
  const inbox = obj(D.inbox)
  const secret = new Set([...arr(inbox.confidential).map(str), ...orgsOf(D).filter((o) => o.confidential).map((o) => o.id)])
  const todoOrg = obj(inbox.todo_org)
  const orgOf = (x) => str(obj(x).org || obj(x).organization || todoOrg[str(obj(x).id)] || '')
  const ofOrg = (x) => {
    const o = orgOf(x)
    if (!org) return !secret.has(o)
    return o ? o === org : inOrg(x, org)
  }
  const m = {
    machine, label: label(machine), version: str(L.version), viewer: Boolean(L.viewer), hubError: str(L.hub_error),
    fetchedAt: Number(L.fetched_at || 0), now, pulled: L.fetched_at ? ago(now - Number(L.fetched_at)) : 'never', hasData: Boolean(data),
    generated: str(D.generated_utc), orgs: orgsOf(D), org, labels,
  }
  // stale overview: the hub's own threshold and label
  const ovTs = tsOf(ov.generated_ts || ov.generated_utc)
  m.stale = ovTs && ov.stale_after_s && now - ovTs > Number(ov.stale_after_s) * 1000
    ? fill(c.labels.stale, { h: Math.round(Number(ov.stale_after_s) / 3600) }) : ''
  m.todo = todoModel(L, D, c, ofOrg, label)
  m.overview = overviewModel(ov, c, ofOrg, m.todo)
  m.questions = questionsModel(D, ov, c, ofOrg, m.todo, inbox)
  m.fleet = fleetModel(fl, D, c, label, machine)
  m.quota = quotaModel(D, ov, c, opts.usage)
  m.alerts = alertsModel(D, ov, fl, c, ofOrg, opts.veille, label)
  m.lanes = lanesModel(D, ov, c, ofOrg, label)
  m.journal = journalModel(D, ov, fl, c, ofOrg, label)
  m.watch = watchModel(D, c)
  m.counts = {
    overview: m.overview.errors.length, todo: m.todo.here.length + m.todo.elsewhere.length + m.todo.urgent.length + m.todo.ongoing.length,
    questions: m.questions.questions.length + m.questions.answers.length + m.questions.inbox.length, fleet: m.fleet.machines.length, quota: m.quota.hub.length,
    alerts: m.alerts.hub.length + m.alerts.machines.length + m.alerts.local.length, journal: m.journal.rows.length + (m.journal.lines.length ? 1 : 0),
    watch: m.watch.lines.length ? 1 : 0, lanes: m.lanes.lanes.length + m.lanes.jobs.length,
  }
  // the page's count: every item of this computer (delivered or not yet, marked done or not) - the tab title « (N) »
  m.hereOpen = m.todo.all.filter((t) => t.here).length
  return m
}

function todoModel(L, D, c, ofOrg, label) {
  const machine = str(L.machine)
  const done = new Set(arr(L.marked_done).map(str))
  const delivered = new Set(arr(L.delivered).map((t) => str(t && t.id)))
  const prio = new Map(arr(obj(obj(D.overview).you).todos).map((t) => [str(t.id), Number(t.prio)]))
  let tagRe = null
  try { tagRe = new RegExp(c.todo.tag_re) } catch { tagRe = null }
  const all = []
  for (const [mid, rows] of Object.entries(obj(D.todo))) {
    for (const t of arr(rows)) {
      if (!t || !ID_RE.test(str(t.id)) || !ofOrg(t)) continue
      let title = str(t.title || t.id)
      const tags = []
      const mm = tagRe && tagRe.exec(title)
      if (mm) { tags.push(mm[1].trim()); title = title.slice(mm[0].length) }
      for (const x of arr(t.tags)) if (x && !tags.includes(str(x))) tags.push(str(x))
      const p = prio.has(str(t.id)) ? prio.get(str(t.id)) : Number.isFinite(Number(t.prio)) ? Number(t.prio) : null
      const check = obj(t.check)
      const here = mid === machine
      const marked = here && done.has(str(t.id))
      all.push({
        id: str(t.id), nn: str(t.nn), machine: mid, machineLabel: label(mid), title, tags, prio: p, here, marked,
        urgent: p !== null && p >= Number(c.todo.urgent_prio),
        ongoing: marked || (check.kind === 'check' && /last check/.test(str(check.text))),
        why: arr(t.why).map(str), check: str(check.text), note: str(t.note), created: str(t.created),
        canRun: here && delivered.has(str(t.id)) && !marked, pending: here && !delivered.has(str(t.id)), org: str(t.org || t.organization || obj(obj(D.inbox).todo_org)[str(t.id)] || ''),
      })
    }
  }
  const order = (a, b) => (b.prio ?? -1) - (a.prio ?? -1) || Number(b.here) - Number(a.here) || a.machine.localeCompare(b.machine) || a.nn.localeCompare(b.nn)
  all.sort(order)
  const urgent = all.filter((t) => t.urgent && !t.marked)
  const ongoing = all.filter((t) => !urgent.includes(t) && t.ongoing)
  const rest = all.filter((t) => !urgent.includes(t) && !ongoing.includes(t))
  const perMachine = {}
  for (const t of all) perMachine[t.machine] = (perMachine[t.machine] || 0) + 1
  return { all, urgent, ongoing, here: rest.filter((t) => t.here), elsewhere: rest.filter((t) => !t.here), perMachine }
}

function overviewModel(ov, c, ofOrg, todo) {
  const you = obj(ov.you)
  const counts = obj(you.counts)
  const max = Number(c.max_rows) || 8
  const errors = arr(obj(ov.errors).rows).filter(ofOrg)
    .map((r) => ({ kind: str(r.kind), severity: str(r.severity), tone: sevTone(c, r.severity), text: str(r.text) }))
    .sort((a, b) => sevRank(c, a.severity) - sevRank(c, b.severity))
  const apps = arr(ov.apps).filter(ofOrg).map((a) => ({
    key: str(a.key), label: str(a.label || a.key), rank: Number(a.rank) || 0, sentence: str(a.sentence), importance: str(a.importance),
    eta: str(obj(a.eta).text), etaState: str(obj(a.eta).state), owner: str(a.owner_next), moved: str(obj(a.moved).text),
  })).sort((a, b) => (a.rank || 99) - (b.rank || 99))
  const run = obj(ov.running)
  return {
    has: Boolean(ov.schema || ov.you), labels: obj(ov.labels), generated: str(ov.generated_utc), max,
    you: {
      todos: arr(you.todos).filter(ofOrg).map((t) => ({ id: str(t.id), title: str(t.title), machine: str(t.machine), prio: Number(t.prio) })),
      questions: arr(you.questions).filter(ofOrg).map((q) => ({ id: str(q.id), severity: str(q.severity), tone: sevTone(c, q.severity), title: str(q.title), rec: str(q.recommended) }))
        .sort((a, b) => sevRank(c, a.severity) - sevRank(c, b.severity)),
      counts: fill(c.labels.you_counts, { todos: counts.todos_open ?? todo.all.length, questions: counts.questions_waiting ?? 0, blocked: counts.backlog_blocked_on_you ?? 0 }),
    },
    errors, blocked: str(obj(ov.errors).blocked_sessions), apps,
    running: {
      jobs: arr(run.jobs).map((j) => ({ id: str(j.id), machine: str(j.machine), kind: str(j.kind), eta: j.eta_ts ? when(j.eta_ts) : '', basis: str(j.basis) })),
      lanes: arr(run.lanes).filter(ofOrg).length,
      runner: str(obj(run.runner).text),
    },
  }
}

function questionsModel(D, ov, c, ofOrg, todo, inbox) {
  const ans = obj(D.answers)
  const urg = c.urgency_order
  return {
    // the inbox's open questions that wait on you (herd.inbox/1 items), most urgent first
    inbox: arr(inbox.items).filter((i) => i && i.you && i.category === 'question' && ofOrg(i))
      .map((i) => ({ id: str(i.id), title: str(i.title), urgency: str(i.urgency), priority: str(i.priority), app: str(i.app_label || i.app), org: str(i.org), blocks: Boolean(i.blocks_work),
        tone: i.blocks_work ? 'warn' : '' }))
      .sort((a, b) => (urg.indexOf(a.urgency) + 1 || 99) - (urg.indexOf(b.urgency) + 1 || 99) || a.priority.localeCompare(b.priority)),
    questions: arr(obj(ov.you).questions).filter(ofOrg).map((q) => ({
      id: str(q.id), severity: str(q.severity), tone: sevTone(c, q.severity), title: str(q.title), rec: str(q.recommended), options: Number(q.options) || 0,
    })).sort((a, b) => sevRank(c, a.severity) - sevRank(c, b.severity)),
    answers: arr(ans.open).filter(ofOrg).map((a) => ({ n: str(a.n), q: str(a.q), options: str(a.options), rec: str(a.rec) })),
    source: str(ans.source),
    checks: todo.all.filter((t) => /closes by itself/.test(t.check)).map((t) => ({ id: t.id, machine: t.machineLabel, title: t.title, check: t.check })),
  }
}

function fleetModel(fl, D, c, label, me) {
  const machines = arr(fl.machines).map((m) => {
    const w = m.worker || null
    const q = obj(m.queue)
    const ld = obj(m.load)
    const state = str(m.herd_state || m.state || '?')
    return {
      id: str(m.id), label: str(m.label || label(m.id)), state, tone: c.state_tone[state] || '', role: str(m.role), here: str(m.id) === me,
      worker: w ? `${w.ver || '?'}${w.current === false ? ' old' : ''}${w.paused ? ' paused' : ''}` : '',
      queued: Number(q.queued || 0), running: arr(q.running).length,
      cpu: typeof ld.cpu_pct === 'number' ? Math.round(ld.cpu_pct) : null,
      ram: ld.ram_total_mb ? Math.round((100 * Number(ld.ram_used_mb || 0)) / Number(ld.ram_total_mb)) : null,
      disks: arr(ld.disks).filter((d) => typeof d.free_pct === 'number').map((d) => `${str(d.mount)} ${Math.round(d.free_pct)}% free`),
      alerts: arr(m.alerts).length, open: arr(obj(D.todo)[m.id]).length, seen: m.seen && m.seen.age_s !== undefined ? ago(Number(m.seen.age_s) * 1000) : '',
    }
  })
  const h = fl.herd || null
  return {
    machines,
    herd: h ? fill(c.labels.herd, { up: h.machines_up ?? 0, running: h.jobs_running ?? 0, queued: h.jobs_queued ?? 0, open: h.todo_open_total ?? 0, alerts: h.alerts_total ?? 0 }) : '',
    lost: arr(h && h.lost_24h).map((j) => `#${str(j.id)} ${label(j.machine)} ${str(j.kind)} · ${when(j.at)} · ${str(j.note)}`),
    generated: str(fl.generated_utc),
  }
}

// data.quota in the hub's herd.quota/1 shape (providers.<p>.windows[]); when absent, the overview's quota rows.
function quotaModel(D, ov, c, usage) {
  const q = obj(D.quota)
  const hub = []
  const providers = Array.isArray(q.providers) ? q.providers.map((p) => [str(p && p.id), p]) : Object.entries(obj(q.providers))
  for (const [pid, p] of providers) {
    for (const w of arr(p && p.windows)) {
      const pct = Number(w.used_pct)
      const st = str(w.state || (pct >= c.quota.critical ? 'critical' : pct >= c.quota.high ? 'high' : pct >= c.quota.watch ? 'watch' : 'ok'))
      hub.push({
        provider: str(p.label || pid), account: str(w.account), window: str(w.window), pct: Number.isFinite(pct) ? pct : null, state: st,
        tone: sevTone(c, st), stale: Boolean(w.stale),
        line: [w.exhausts_before_reset && w.exhaust_at ? fill(c.labels.quota_exhaust, { at: when(w.exhaust_at) }) : '',
          w.resets_at ? fill(c.labels.quota_resets, { at: when(w.resets_at) }) : '', w.reading_at ? `read ${when(w.reading_at)}` : ''].filter(Boolean).join(' · '),
      })
    }
  }
  const warnings = arr(obj(ov.errors).rows).filter((r) => r && r.kind === 'quota').map((r) => ({ tone: sevTone(c, r.severity), text: str(r.text) }))
  const local = usage && Array.isArray(usage.windows)
    ? usage.windows.map((w) => ({ label: str(w.label), pct: w.available ? Number(w.pct) : null, text: w.available ? `${Math.round(Number(w.pct))} %${w.when ? ' · ' + w.when : ''}` : str(w.text) }))
    : []
  return { hub, generated: str(q.generated_at), warnings, local, source: str(obj(ov.sources).quota) }
}

function alertText(a) {
  if (typeof a === 'string') return a
  const o = obj(a)
  return str(o.text || o.title || o.message || o.key || JSON.stringify(o)).slice(0, 300)
}

function alertsModel(D, ov, fl, c, ofOrg, veille, label) {
  const hub = arr(D.alerts).length
    ? arr(D.alerts).filter(ofOrg).map((a) => ({ severity: str(a.severity), tone: sevTone(c, a.severity), text: alertText(a), since: str(a.since || a.at || '') }))
    : arr(obj(ov.errors).rows).filter(ofOrg).map((r) => ({ severity: str(r.severity), tone: sevTone(c, r.severity), text: str(r.text), since: '' }))
  hub.sort((a, b) => sevRank(c, a.severity) - sevRank(c, b.severity))
  const machines = []
  for (const m of arr(fl.machines)) for (const a of arr(m.alerts)) machines.push({ machine: str(m.label || label(m.id)), severity: str(obj(a).severity), tone: sevTone(c, obj(a).severity), text: alertText(a) })
  const local = veille && Array.isArray(veille.alerts)
    ? veille.alerts.filter((a) => !a.acked).map((a) => ({ tone: a.julian ? 'warn' : a.severity === 'bad' ? 'bad' : '', text: [a.what || a.key, a.title].filter(Boolean).map(str).join(' · ') }))
    : []
  return { hub, machines, local, link: str(obj(fl.herd).alerts_link) }
}

function lanesModel(D, ov, c, ofOrg, label) {
  // data.lanes: a list, or {running: {jobs, lanes, runner}, presence, runner} (herd.cockpit lanes block); else the overview's
  const lb = obj(D.lanes)
  const run = lb.running ? obj(lb.running) : obj(ov.running)
  const lanes = (arr(D.lanes).length ? arr(D.lanes) : arr(run.lanes)).filter(ofOrg).map((l) => ({
    id: str(l.id), title: str(l.title || l.name), owner: str(l.owner), since: str(l.since), apps: arr(l.apps).map(str), state: str(l.state),
  }))
  const jobs = arr(run.jobs).map((j) => ({ id: str(j.id), machine: label(j.machine), kind: str(j.kind), eta: j.eta_ts ? when(j.eta_ts) : '', basis: str(j.basis) }))
  const rd = obj(lb.runner)
  const runner = str(obj(run.runner).text) || [rd.decision, rd.reason, rd.item && (typeof rd.item === 'string' ? rd.item : str(obj(rd.item).id || obj(rd.item).title))].filter(Boolean).map(str).join(' · ')
  const pres = obj(lb.presence)
  return { lanes, jobs, runner, runnerAt: str(obj(run.runner).t || rd.time),
    presence: pres.last_active ? `last active ${when(pres.last_active)}${pres.away_hours !== undefined && pres.away_hours !== null ? ` · away ${pres.away_hours} h` : ''}` : '' }
}

// data.journal ([{t|at, text, kind}]) when present; otherwise the dated events the data already carries.
function journalModel(D, ov, fl, c, ofOrg, label) {
  let rows = []
  const jd = obj(D.journal)
  if (jd.text) return { rows: [], name: str(jd.name), date: str(jd.date), cut: Boolean(jd.cut), lines: mdLines(jd.text, Number(c.journal_lines) || 80) }
  if (arr(D.journal).length) rows = arr(D.journal).filter(ofOrg).map((e) => ({ t: tsOf(e.t || e.at || e.ts), kind: str(e.kind), text: str(e.text || e.title) }))
  else {
    const run = obj(ov.running)
    if (obj(run.runner).text) rows.push({ t: tsOf(run.runner.t), kind: 'runner', text: str(run.runner.text) })
    for (const j of arr(run.jobs)) rows.push({ t: tsOf(j.started_ts), kind: 'job', text: `job #${str(j.id)} ${str(j.kind)} started on ${label(j.machine)}` })
    for (const j of arr(obj(fl.herd).lost_24h)) rows.push({ t: tsOf(j.at), kind: 'lost', text: `job #${str(j.id)} ${str(j.kind)} on ${label(j.machine)}: ${str(j.note)}` })
    for (const a of arr(ov.apps)) for (const x of arr(obj(a.moved).closed)) rows.push({ t: tsOf(ov.generated_ts), kind: 'closed', text: `${str(a.label)}: ${typeof x === 'string' ? x : str(obj(x).text || obj(x).id)}` })
    for (const t of Object.values(obj(D.todo)).flat()) if (t && t.created && ofOrg(t)) rows.push({ t: tsOf(String(t.created).replace(' ', 'T').replace(/Z?$/, 'Z')), kind: 'to-do', text: `added for ${label(t.about)}: ${str(t.title)}` })
    if (D.digest && D.digest.name) rows.push({ t: tsOf(D.digest.date), kind: 'watch', text: str(D.digest.name) })
  }
  rows = rows.filter((r) => r.text).sort((a, b) => b.t - a.t).slice(0, Number(c.journal_max) || 30)
  return { rows: rows.map((r) => ({ ...r, at: r.t ? when(r.t) : '' })), lines: [] }
}

// Markdown text -> lines without runs of blank lines
function mdLines(text, max) {
  const lines = str(text).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== ''))
  return lines.slice(0, max)
}

function watchModel(D, c) {
  const w = obj(D.watch && D.watch.text ? D.watch : D.digest)
  const lines = str(w.text).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== ''))
  return { name: str(w.name), date: str(w.date), lines: lines.slice(0, Number(c.watch_lines) || 40), cut: Boolean(w.cut) || lines.length > (Number(c.watch_lines) || 40) }
}

// ---- sending ---------------------------------------------------------------------------------------------------------

// The token the page carries for POSTs (same per-start token the browser page uses).
export function tokenOf(html) {
  const m = /<meta\s+name="cockpit-token"\s+content="([^"{}]{8,200})"/.exec(String(html || ''))
  return m ? m[1] : null
}

// "/dispatch <machine> <text>" and "/todo <machine> <text>": args -> {machine, text} or {error}.
export function parseTarget(args, known) {
  const s = String(args || '').trim()
  const m = /^(\S+)\s+([\s\S]+)$/.exec(s)
  if (!m) return { error: 'usage: <machine> <text>' }
  const ids = Object.keys(known || {})
  const want = m[1].toLowerCase()
  const id = ids.find((k) => k === want) || ids.find((k) => String(known[k]).toLowerCase().replace(/\s+/g, '') === want.replace(/\s+/g, ''))
  if (ids.length && !id) return { error: `unknown machine "${m[1]}"; known: ${ids.join(', ')}` }
  const machine = id || want
  if (!ID_RE.test(machine)) return { error: `bad machine id "${m[1]}"` }
  const text = m[2].trim()
  if (text.length > MAX_TEXT) return { error: `text too long (${text.length} > ${MAX_TEXT})` }
  return { machine, text }
}

// What a POST answered -> one line for the person.
export function sendResult(kind, r) {
  if (!r) return `${kind}: the local Cockpit did not answer (is herd-worker running?)`
  if (r.status === 404) return `${kind}: not available yet (the local Cockpit has no /api/${kind} endpoint; worker update pending)`
  let body = {}
  try { body = JSON.parse(r.text || '{}') } catch { body = {} }
  if (!r.ok) return `${kind}: refused (${r.status}${body.error ? `: ${body.error}` : ''})`
  if (kind === 'dispatch') return `dispatch: sent as job ${body.job ?? '?'}`
  if (kind === 'todo') return `todo: added ${body.id ?? ''}`.trim()
  return `${kind}: ok`
}

// /fleet's text answer and the status line.
export function summaryText(m, cfg) {
  const c = hubConfig(cfg)
  if (!m) return fill(c.labels.offline, { base: c.base })
  const lines = [`Fleet on ${m.label}: ${m.hereOpen} to-do${m.hereOpen === 1 ? '' : 's'} here; pulled from the hub ${m.pulled}${m.hubError ? ` (${m.hubError})` : ''}.`]
  if (m.fleet.herd) lines.push(m.fleet.herd)
  for (const x of m.fleet.machines) {
    lines.push(`- ${x.label}: ${x.state}${x.worker ? `, worker ${x.worker}` : ''}${x.running || x.queued ? `, jobs ${x.running} running ${x.queued} queued` : ''}${x.cpu !== null ? `, cpu ${x.cpu}%` : ''}${x.open ? `, ${x.open} to-do` : ''}${x.alerts ? `, ${x.alerts} alert` : ''}`)
  }
  for (const t of m.todo.all.filter((t) => t.here)) lines.push(`* ${t.nn} ${t.title}${t.marked ? ' (marked done)' : t.pending ? ' (not delivered yet)' : ''}`)
  return lines.join('\n')
}

export function badgeText(m) {
  return m ? `Fleet: ${m.hereOpen} to do` : 'Fleet: offline'
}
