// The Cockpit mod's dispatcher (UX-PRINCIPLES rule 7, Julian 12 Nov 2026): ONE narrow pane, two blocks, read from the
// SAME data as the local Cockpit page (herd-worker on every laptop, http://127.0.0.1:24365, loopback only):
//   block 1 « This laptop »  what Julian must do here (urgent first), this machine's mode, load, temperature, current work
//   block 2 « Global »       what blocks work in the whole fleet and every organization (the page's « You » list, with
//                            one-click answers), errors now, one-line fleet status, quick actions (send a job or prompt,
//                            add a to-do)
//   « Open in Cockpit »      deep links to the page's modules (http://127.0.0.1:24365/#<module>) for anything bigger.
// The mod never re-implements the page's full tabs.
//   GET  /local.json   this computer: machine id, delivered to-dos, marked done, last pull from the hub
//   GET  /data.json    the hub's cockpit data (herd.cockpit/1): labels, todo, fleet, overview, inbox (herd.inbox/1), …;
//                      health and modes are read when a later hub lane publishes them (absent today: said so)
//   GET  /             the page; its <meta name="cockpit-token"> is the per-start token every POST carries
//   POST /api/run, /api/done {id}; /api/dispatch {machine, text}; /api/todo {machine, text} (also the answers, as the
//        page sends them: « Answer I90: a » to inbox.answer_machine)
// Pure: no `$`, no engine call. Words: the page's own (inbox.labels) first, then hub.labels (cockpit.config.json).

// the one hub view of the pane (the dispatcher); the old tab ids still open it (configs and /cockpit words of #82/#83)
export const HUB_TABS = ['home']
export const LEGACY_TABS = ['overview', 'todo', 'questions', 'fleet', 'quota', 'alerts', 'journal', 'watch', 'lanes']
// the page's modules (its view ids, its hash links)
export const MODULES = ['overview', 'todo', 'inbox', 'fleet', 'quota', 'alerts', 'journal', 'watch', 'lanes']
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
export const MAX_TEXT = 2000
const URG = ['now', 'today', 'week', 'later']

export const HUB_DEFAULTS = {
  enabled: true,
  base: 'http://127.0.0.1:24365',
  // the view the pane opens on: "home" (the dispatcher) or "panneau" (this computer's conversations)
  start: 'home',
  refresh_s: 60,
  status_line: true,
  // the « Open in Cockpit » links, in order; labels are the page's (inbox.labels.tab_<id>) unless set here
  modules: { order: MODULES, labels: { overview: 'Overview', todo: 'To do', inbox: 'Questions and checks', fleet: 'Fleet', quota: 'Quota',
    alerts: 'Alerts', journal: 'Journal', watch: 'Watch', lanes: 'Lanes' } },
  // at most this many rows in a block (UX rule 3); the rest is « show all N » in the page
  max_rows: 5,
  errors_max: 3,
  // overview error rows shown in Global (the rest is in the page's Overview)
  error_severities: ['critical', 'urgent'],
  todo: { urgent_prio: 8, tag_re: '^\\s*\\[([^\\]]{1,24})\\]\\s*' },
  severity_order: ['critical', 'urgent', 'high', 'normal', 'watch', 'low', 'info', 'ok'],
  severity_tone: { critical: 'bad', urgent: 'bad', high: 'warn', watch: 'warn', normal: '', low: 'dim', info: 'dim', ok: 'ok' },
  // colour = state (UX rule 4): red problem now, yellow look later, green fine, grey off or not applicable
  state_tone: { live: 'ok', hub: 'ok', busy: 'running', viewer: 'dim', asleep: 'dim', off: 'dim', stale: 'warn', gaming: 'warn', offline: 'bad', down: 'bad' },
  temp: { warn_c: 85, bad_c: 95 },
  disk_warn_pct: 10,
  battery_warn_pct: 20,
  labels: {
    offline: 'The local Cockpit is not reachable on {base} (herd-worker not running here?)',
    no_data: 'Hub data not pulled yet',
    pulled: 'pulled {ago} · built {built}',
    stale: 'Hub overview older than {h} h: the hub cron did not run',
    refresh: '↻',
    dispatcher: 'Dispatcher',
    conversations: 'Conversations',
    org_all: 'All',
    workspace: 'Workspace',
    laptop: 'This laptop · {machine}',
    laptop_unknown: 'This laptop is not in the hub fleet yet ({machine}).',
    state: '{state} · mode {mode} · CPU {cpu} · RAM {ram}',
    mode: 'mode {mode}',
    job: '{what} job (job {id})',
    alerts_n: '{n} alerts',
    later: '{n} more to look at when you have time',
    not_fresh: 'Not up to date: {parts}',
    not_fresh_part: '{label} refresh due {due} did not run (from {from})',
    temp: 'temperature {temp}',
    temp_none: 'temperature: no sensor reading in the hub data',
    agents: '{n} agent processes',
    disk_low: 'disk {mount} {pct} % free',
    battery_low: 'battery {pct} % on battery',
    reboot: 'reboot pending',
    seen: 'seen {ago}',
    working: 'Working on',
    working_none: 'Nothing running here.',
    todo_here: 'To do here ({n})',
    todo_none: 'Nothing to do here.',
    run: 'Run',
    done: 'Mark done',
    marked: 'marked done, closes at the next hub tick',
    pending: 'reaches this computer at the next sync (about 10 minutes)',
    global: 'Global',
    fleet_line: '{busy} of {workers} workers busy · jobs: {running} running, {queued} queued · {alerts} alerts',
    you_block: 'You: what blocks work now',
    you_none: 'Nothing waits on you.',
    errors: 'Problems now',
    urgent_elsewhere: '{n} urgent to-dos on other machines',
    show_all: 'show all {n}',
    recommended: 'recommended',
    answer_sent: 'Sent to Oracle: it is recorded as your decision within about 2 minutes.',
    answered: 'Sent "{label}" at {at}; Oracle records it within about 2 minutes.',
    no_answer: 'Tell any agent your answer.',
    rec_text: 'Recommended: {rec}.',
    actions: 'Send',
    send_job: 'Job or prompt to a machine…',
    add_todo: 'To-do for Julian…',
    send_hint: 'Fills the prompt: /dispatch <machine> <text> or /todo <machine> <text>. Machines: {machines}',
    open: 'Open in Cockpit',
    eta: 'ETA {at}',
    eta_past: 'past its ETA {at}',
    since: 'since {d}',
  },
}

export function hubConfig(cfg) {
  const u = (cfg && cfg.hub) || {}
  const d = HUB_DEFAULTS
  const um = u.modules || {}
  const c = {
    ...d, ...u,
    modules: { ...d.modules, ...um, labels: { ...d.modules.labels, ...(um.labels || {}) } },
    todo: { ...d.todo, ...(u.todo || {}) },
    severity_tone: { ...d.severity_tone, ...(u.severity_tone || {}) },
    state_tone: { ...d.state_tone, ...(u.state_tone || {}) },
    temp: { ...d.temp, ...(u.temp || {}) },
    labels: { ...d.labels, ...(u.labels || {}) },
  }
  // an old start (one of the nine tabs of #82/#83) opens the dispatcher
  if (LEGACY_TABS.includes(c.start)) c.start = 'home'
  return c
}

export function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
}

// The hub views of the pane: the dispatcher alone (none when hub.enabled is false).
export function hubTabs(cfg) {
  const c = hubConfig(cfg)
  return c.enabled === false ? [] : [{ id: 'home', label: c.labels.dispatcher }]
}

// D.tab of a hub view: "hub-home"; "hub-<old tab>" still means the dispatcher
export const tabKey = (id) => 'hub-' + (LEGACY_TABS.includes(id) ? 'home' : id)
export const hubIdOf = (tab) => {
  if (typeof tab !== 'string' || !tab.startsWith('hub-')) return null
  const id = tab.slice(4)
  return HUB_TABS.includes(id) || LEGACY_TABS.includes(id) ? 'home' : null
}

// A module word (« fleet », « questions », « todo »…) -> the page's view id, or '' when it names none.
export function moduleOf(word) {
  const w = String(word || '').trim().toLowerCase()
  const alias = { questions: 'inbox', checks: 'inbox', answers: 'inbox', 'to-do': 'todo', digest: 'watch', events: 'journal' }
  const id = alias[w] || w
  return MODULES.includes(id) ? id : ''
}

export const moduleUrl = (base, id) => `${String(base || HUB_DEFAULTS.base).replace(/\/+$/, '')}/${id ? '#' + id : ''}`

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
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const tsOf = (x) => {
  if (typeof x === 'number') return x > 1e12 ? x : x * 1000
  const t = Date.parse(str(x))
  return Number.isFinite(t) ? t : 0
}
// ONE time format with the Cockpit page (its logic.js fmtTime, UX rules 8 and 12): local time of this computer,
// 24-hour unless the hub's config says cockpit.time.hour12; today '19:22', another day 'Fri 13 Nov 16:02'.
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const p2 = (n) => String(n).padStart(2, '0')
const clock = (d, o) => (o && o.hour12 ? `${d.getHours() % 12 || 12}:${p2(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}` : `${p2(d.getHours())}:${p2(d.getMinutes())}`)
export function fmtTime(x, o = {}) {
  const t = tsOf(x)
  if (!t) return ''
  const d = new Date(t)
  const now = new Date(Number(o.now) || Date.now())
  return d.toDateString() === now.toDateString() ? clock(d, o) : `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} ${clock(d, o)}`
}
// Hub-written text: every UTC stamp in it (2026-11-13T07:31:57Z, 2026-11-12 18:00Z) becomes the same local format.
export function fmtText(s, o = {}) {
  return str(s).replace(/\b(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?Z\b/g, (m0) => fmtTime(m0.replace(' ', 'T'), o))
}
// older names, same format now (they printed UTC before the 12 Nov review)
export const when = (x, o) => fmtTime(x, o) || str(x)
export const hhmmUtc = (t, o) => fmtTime(t, o)

function sevRank(c, s) {
  const i = c.severity_order.indexOf(str(s).toLowerCase())
  return i < 0 ? c.severity_order.length : i
}
const sevTone = (c, s) => c.severity_tone[str(s).toLowerCase()] || ''
const urg = (u) => { const i = URG.indexOf(u); return i < 0 ? 9 : i }

// ---- organizations ----------------------------------------------------------------------------------------------------

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

// The page's logic.js, same rules: All = every non-confidential item; an org = its items (confidential ones from their key).
export function inboxItems(inbox, org) {
  const ib = obj(inbox)
  if (!org) return arr(ib.items).slice()
  const conf = obj(ib.confidential)[org]
  if (conf) return arr(conf.items).slice()
  return arr(ib.items).filter((it) => it && it.org === org)
}

// The page's « You » block: only what blocks work, most urgent first, then the application's importance.
export function youList(items, max) {
  const mine = items.filter((it) => it && it.you && it.section !== 'answered' && !it.covered_by)
  const blocking = mine.filter((it) => it.blocks_work).sort((a, b) => urg(a.urgency) - urg(b.urgency) || (a.app_rank || 0) - (b.app_rank || 0) || (b.blocks || 0) - (a.blocks || 0))
  const rest = mine.filter((it) => !it.blocks_work).sort((a, b) => urg(a.urgency) - urg(b.urgency) || (a.app_rank || 0) - (b.app_rank || 0))
  return { top: blocking.slice(0, max), blocking: blocking.length, all: blocking.concat(rest) }
}

// The page's answer text (atlas issues_triage.py reads it back) and its buttons, recommended first.
export function answerText(template, id, key) {
  if (!/^I\d+$/.test(String(id)) || !/^([a-z]|\d{1,2}|rec)$/.test(String(key))) return null
  return String(template || 'Answer {id}: {key}').replace('{id}', id).replace('{key}', key)
}
export function answerButtons(q) {
  if (!q || !q.answerable) return []
  const opts = arr(q.options).map((o) => ({ key: str(o.key), label: str(o.label), rec: o.key === q.rec_key }))
  if (q.rec_key === 'rec') opts.unshift({ key: 'rec', label: str(q.recommended), rec: true })
  return opts.sort((a, b) => Number(b.rec) - Number(a.rec))
}

// ---- the model -------------------------------------------------------------------------------------------------------

/**
 * local (/local.json) + data (/data.json) -> the dispatcher's two blocks. opts: {now, org, answered} where answered is
 * {uid: {label, t}} (answers sent from this pane, kept in $.store).
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
  const inbox = obj(D.inbox)
  const PL = obj(inbox.labels) // the page's words
  // an item of a confidential organization shows only in its own workspace, never under « All »
  const secret = new Set([...(Array.isArray(inbox.confidential) ? inbox.confidential.map(str) : Object.keys(obj(inbox.confidential))), ...orgsOf(D).filter((o) => o.confidential).map((o) => o.id)])
  const todoOrg = obj(inbox.todo_org)
  const orgOf = (x) => str(obj(x).org || obj(x).organization || todoOrg[str(obj(x).id)] || '')
  const ofOrg = (x) => {
    const o = orgOf(x)
    if (!org) return !secret.has(o)
    return o ? o === org : inOrg(x, org)
  }
  const ovTs = tsOf(ov.generated_ts || ov.generated_utc)
  const G = obj(D.glance) // the hub's ONE reading of the first blocks (glance.py), the same rows and counts as the page
  const topt = { ...obj(G.time), now }
  // not up to date: a part past its due refresh (glance.freshness, the page's rule), else the old 3 h overview rule
  const late = arr(G.freshness).filter((p) => p && p.id !== 'data' && p.due_ts && now > Number(p.due_ts) * 1000)
  const stale = late.length
    ? fill(c.labels.not_fresh, { parts: late.map((p) => fill(c.labels.not_fresh_part, { label: str(p.label), due: fmtTime(p.next_ts || p.due_ts, topt), from: fmtTime(p.ts, topt) })).join('; ') })
    : !arr(G.freshness).length && ovTs && ov.stale_after_s && now - ovTs > Number(ov.stale_after_s) * 1000 ? fill(c.labels.stale, { h: Math.round(Number(ov.stale_after_s) / 3600) }) : ''
  const m = {
    machine, label: label(machine), version: str(L.version), viewer: Boolean(L.viewer), hubError: str(L.hub_error),
    fetchedAt: Number(L.fetched_at || 0), now, pulled: L.fetched_at ? ago(now - Number(L.fetched_at)) : 'never', hasData: Boolean(data),
    built: D.generated_ts || D.generated_utc ? fmtTime(D.generated_ts || D.generated_utc, topt) : '', generated: str(D.generated_utc),
    orgs: orgsOf(D), org, labels, base: c.base, topt,
    words: { ...c.labels, ...pick(PL, ['you_block', 'show_all', 'recommended', 'answer_sent']) },
    stale,
    modules: arr(c.modules.order).filter((id) => MODULES.includes(id)).map((id) => ({ id, label: str(PL['tab_' + id] || c.modules.labels[id] || id), url: moduleUrl(c.base, id) })),
  }
  m.todo = todoModel(L, D, c, ofOrg, label)
  m.laptop = laptopModel(L, D, c, m.todo, label, ov, now, topt)
  m.global = globalModel(D, c, m.todo, ofOrg, org, label, ov, inbox, opts.answered || {}, topt)
  // the page's count: every item of this computer (delivered or not yet, marked done or not) - the status line
  m.hereOpen = m.todo.all.filter((t) => t.here).length
  return m
}

function pick(o, keys) {
  const out = {}
  for (const k of keys) if (o[k]) out[k] = str(o[k])
  return out
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
      const p = prio.has(str(t.id)) ? prio.get(str(t.id)) : Number.isFinite(Number(t.prio)) && t.prio !== null && t.prio !== undefined ? Number(t.prio) : null
      const here = mid === machine
      const marked = here && done.has(str(t.id))
      all.push({
        id: str(t.id), nn: str(t.nn), machine: mid, machineLabel: label(mid), title, tags, prio: p, here, marked,
        urgent: p !== null && p >= Number(c.todo.urgent_prio),
        canRun: here && delivered.has(str(t.id)) && !marked, pending: here && !delivered.has(str(t.id)),
      })
    }
  }
  // urgent -> ongoing (marked done, closing) last; never by creation date
  all.sort((a, b) => Number(b.urgent) - Number(a.urgent) || Number(a.marked) - Number(b.marked) || (b.prio ?? -1) - (a.prio ?? -1) || a.machine.localeCompare(b.machine) || a.nn.localeCompare(b.nn))
  return { all, here: all.filter((t) => t.here), urgentElsewhere: all.filter((t) => !t.here && t.urgent) }
}

function machineOf(D, id) {
  return arr(obj(D.fleet).machines).find((x) => x && str(x.id) === id) || null
}

// The hub's health reading of a machine when a lane publishes it: data.health.machines[id] (herd.health-summary/1),
// or fleet.machines[].health; the mode from data.modes[id] or the machine; null fields stay unknown (said so).
function healthOf(D, x, id) {
  const h = obj(obj(obj(D.health).machines)[id])
  const mh = obj(x && x.health)
  return { ...mh, ...h }
}

function laptopModel(L, D, c, todo, label, ov, now, topt) {
  const id = str(L.machine)
  const x = machineOf(D, id)
  const lab = c.labels
  const out = { id, label: label(id), known: Boolean(x), lines: [], warn: [], work: [], todos: todo.here, tone: '' }
  const ld = obj(x && x.load)
  const h = healthOf(D, x, id)
  // the page's Fleet tile of this machine (panels.fleet_view): its mode, colour and running jobs are the page's
  const tile = arr(obj(D.fleet_view).tiles).find((t) => t && str(t.id) === id) || null
  const modeRec = obj(obj(D.modes)[id])
  const gaming = Boolean(L.gaming || (x && x.gaming) || obj(ld.gaming).flag)
  const mode = str(modeRec.mode || (tile && tile.mode) || (x && x.mode) || h.mode || (gaming ? 'gaming' : ''))
  const state = str((x && (x.herd_state || x.state)) || (L.viewer ? 'viewer' : '?'))
  const cpu = num(h.cpu_pct) ?? num(ld.cpu_pct) ?? num(tile && tile.cpu_pct)
  const ram = ld.ram_total_mb ? Math.round((100 * Number(ld.ram_used_mb || 0)) / Number(ld.ram_total_mb))
    : tile && tile.ram_total_gb ? Math.round((100 * Number(tile.ram_used_gb || 0)) / Number(tile.ram_total_gb)) : null
  out.state = state
  out.tone = c.state_tone[state] || ''
  // no mode published: the line leaves it out instead of printing an internal 'not published'
  out.line = [state, mode ? fill(lab.mode, { mode }) : '', `CPU ${cpu === null ? '—' : `${Math.round(cpu)} %`}`, `RAM ${ram === null ? '—' : `${ram} %`}`].filter(Boolean).join(' · ')
  // temperature: the health reading (CPU, GPU) when published, else the tile's, else the GPU sensor of the load sample
  const gpu0 = obj(arr(ld.gpu)[0])
  const cpuC = num(h.cpu_c) ?? num(tile && tile.cpu_c)
  const gpuC = num(h.gpu_c) ?? num(tile && tile.gpu_c) ?? num(gpu0.temp_c)
  const parts = [cpuC !== null ? `CPU ${Math.round(cpuC)} °C` : '', gpuC !== null ? `GPU ${Math.round(gpuC)} °C` : ''].filter(Boolean)
  const hot = Math.max(cpuC ?? 0, gpuC ?? 0)
  const tTone = hot >= c.temp.bad_c ? 'bad' : hot >= c.temp.warn_c ? 'warn' : ''
  out.temp = { text: parts.length ? fill(lab.temp, { temp: parts.join(' · ') }) : lab.temp_none, tone: parts.length ? tTone : 'dim' }
  // health status of the hub (hot streak, throttle, agent cap…): its own reasons and severity
  const reasons = arr(h.reasons).map(str).filter(Boolean)
  const hs = str(h.severity || (h.status && h.status !== 'ok' ? 'high' : ''))
  for (const r of reasons) out.warn.push({ text: r, tone: sevTone(c, hs) || 'warn' })
  if (tTone) out.warn.push({ text: out.temp.text, tone: tTone })
  const agents = obj(ld.agents)
  const nAg = num(h.agents) ?? (Number.isFinite(Number(agents.claude)) ? Number(agents.claude || 0) + Number(agents.codex || 0) : null)
  out.agents = nAg !== null ? fill(lab.agents, { n: Math.round(nAg) }) : ''
  for (const d of arr(ld.disks)) if (typeof d.free_pct === 'number' && d.free_pct < Number(c.disk_warn_pct)) out.warn.push({ text: fill(lab.disk_low, { mount: str(d.mount), pct: Math.round(d.free_pct) }), tone: d.free_pct < Number(c.disk_warn_pct) / 2 ? 'bad' : 'warn' })
  if (typeof ld.battery_pct === 'number' && ld.on_ac === false && ld.battery_pct < Number(c.battery_warn_pct)) out.warn.push({ text: fill(lab.battery_low, { pct: Math.round(ld.battery_pct) }), tone: 'warn' })
  if (ld.reboot_pending) out.warn.push({ text: lab.reboot, tone: 'warn' })
  out.seen = x && x.seen && x.seen.age_s !== undefined ? fill(lab.seen, { ago: ago(Number(x.seen.age_s) * 1000) }) : ''
  // current work: ONE source with the page (glance.jobs, the live queue); older hubs: the overview's jobs + the queue
  const G = obj(D.glance)
  const run = obj(ov.running)
  const jobs = Array.isArray(G.jobs) ? G.jobs : arr(run.jobs)
  const seenJobs = new Set()
  for (const j of jobs) {
    if (str(j.machine) !== id) continue
    seenJobs.add(str(j.id))
    const late = now && j.eta_ts && tsOf(j.eta_ts) < now
    out.work.push({ text: `${fill(lab.job, { what: str(j.tag || j.kind || 'a'), id: str(j.id) })}${j.started_ts ? ' · ' + fill(lab.since, { d: fmtTime(j.started_ts, topt) }) : ''}${j.eta_ts ? ' · ' + fill(late ? lab.eta_past : lab.eta, { at: fmtTime(j.eta_ts, topt) }) : ''}`, tone: late ? 'warn' : 'running' })
  }
  if (!Array.isArray(G.jobs)) for (const j of arr(obj(x && x.queue).running)) if (!seenJobs.has(str(obj(j).id))) out.work.push({ text: fill(lab.job, { what: str(obj(j).tag || obj(j).kind || 'a'), id: str(obj(j).id) }), tone: 'running' })
  const lanes = arr(obj(D.lanes).running && obj(obj(D.lanes).running).lanes).length ? arr(obj(obj(D.lanes).running).lanes) : arr(run.lanes)
  for (const l of lanes) {
    const owner = str(obj(l).owner)
    if (owner === id || owner.startsWith(id + '/')) out.work.push({ text: `${str(l.title)} (${str(l.id)})`, tone: 'running' })
  }
  if (!out.tone && out.warn.some((w) => w.tone === 'bad')) out.tone = 'bad'
  return out
}

const COLOUR_TONE = { red: 'bad', yellow: 'warn', green: 'ok', grey: 'dim' }

// The page's rule for a first-block row of a workspace: a row naming no organization is shared (All and the default org).
function rowInOrg(r, org, defOrg) {
  if (!org) return true
  return r.org ? r.org === org : org === defOrg
}

function globalModel(D, c, todo, ofOrg, org, label, ov, inbox, answered, topt) {
  const lab = c.labels
  const max = Number(c.max_rows) || 5
  const fl = obj(D.fleet)
  const h = obj(fl.herd)
  const G = obj(D.glance)
  const fv = obj(D.fleet_view)
  const defOrg = str(inbox.default_org || 'fleet')
  const fleetWs = !org || org === defOrg
  // one-line fleet status: the page's own sentence (panels.fleet_view) and the Alerts module's count; older hubs: computed
  const machines = arr(fl.machines).filter((x) => x && x.id)
  let fleetLine = ''
  if (fv.sentence) {
    const al = obj(G.alerts)
    fleetLine = `${str(fv.sentence)}${fv.generated_ts ? ` (${fmtTime(fv.generated_ts, topt)})` : ''}${al.shown !== undefined ? ' · ' + fill(lab.alerts_n, { n: al.shown }) : ''}`
  } else if (machines.length) {
    const workers = machines.filter((x) => x.role === 'worker' || x.worker)
    const busy = workers.filter((x) => arr(obj(x.queue).running).length > 0 || x.herd_state === 'busy')
    fleetLine = fill(lab.fleet_line, { busy: busy.length, workers: workers.length, running: h.jobs_running ?? 0, queued: h.jobs_queued ?? 0, alerts: h.alerts_total ?? 0 })
  }
  const tiles = arr(fv.tiles)
  const dots = tiles.length
    ? tiles.map((t) => ({ id: str(t.id), label: str(t.label || label(t.id)), state: str(t.power === 'on' ? (t.busy ? 'busy' : 'on') : t.power), tone: COLOUR_TONE[str(t.colour)] || '', alerts: arr(t.alerts).length }))
    : machines.map((x) => {
      const st = arr(obj(x.queue).running).length ? 'busy' : str(x.herd_state || x.state || '?')
      return { id: str(x.id), label: str(x.label || label(x.id)), state: st, tone: c.state_tone[st] || '', alerts: arr(x.alerts).length }
    })
  // the quota row: the same quota.json reading as the page's Quota module (glance.quota); unlimited mode = yellow
  const q = fleetWs && G.quota ? { text: fmtText(G.quota.text, topt), tone: COLOUR_TONE[str(G.quota.colour)] || '', covers: arr(G.quota.covers).map(str) } : null
  // what blocks work: the page's « You » list of the workspace (inbox), related items collapsed; else the overview's
  let you = []
  let total = 0
  let all = 0
  if (Array.isArray(inbox.items)) {
    const yl = youList(inboxItems(inbox, org), Number(inbox.you_max) || max)
    total = yl.blocking
    all = yl.all.length
    you = yl.top.map((it) => ({
      uid: str(it.uid || it.id), id: str(it.id), title: str(it.title), app: str(it.app_label || it.app), urgency: str(it.urgency),
      tone: it.urgency === 'now' ? 'bad' : 'warn', covers: coversText(it),
      answers: answerButtons(it), question: it.type === 'question', rec: str(it.recommended),
      sent: answered[str(it.uid || it.id)] || null,
    }))
  } else {
    const qs = arr(obj(ov.you).questions).filter(ofOrg).filter((x) => sevRank(c, x.severity) <= 1)
    total = qs.length
    you = qs.slice(0, max).map((x) => ({ uid: str(x.id), id: str(x.id), title: str(x.title), app: '', urgency: str(x.severity), tone: sevTone(c, x.severity), covers: '', answers: [], question: true, rec: str(x.recommended), sent: null }))
  }
  // problems now: the page's rows (glance.problems: urgent only, nothing already under « You »); the quota row is above
  let errs
  let later = 0
  if (Array.isArray(G.problems)) {
    errs = G.problems.filter((r) => r && r.kind !== 'quota' && rowInOrg(r, org, defOrg))
      .map((r) => ({ text: `${fmtText(r.text, topt)}${r.id ? ` (${str(r.id)})` : ''}`, tone: 'bad', kind: str(r.kind) }))
    later = arr(G.later).filter((r) => r && r.kind !== 'quota' && rowInOrg(r, org, defOrg)).length
  } else {
    errs = arr(obj(ov.errors).rows).filter(ofOrg).filter((r) => c.error_severities.includes(str(r.severity).toLowerCase()))
      .sort((a, b) => sevRank(c, a.severity) - sevRank(c, b.severity))
      .map((r) => ({ text: fmtText(r.text, topt), tone: sevTone(c, r.severity) || 'bad', kind: str(r.kind) }))
  }
  const emax = Number(c.errors_max) || 3
  return {
    fleetLine, dots, quota: q, you, youTotal: total, youAll: all,
    errors: errs.slice(0, emax), errorsMore: Math.max(0, errs.length - emax), later,
    urgentElsewhere: todo.urgentElsewhere.length,
    answerMachine: str(inbox.answer_machine || 'oracle'), answerTemplate: str(inbox.answer_text || 'Answer {id}: {key}'),
    targets: Object.keys(obj(D.labels)),
  }
}

// 'covers I2, I4 and 1 to-do' (the page's coversText): the row stands for its related items.
export function coversText(it) {
  const cv = arr(obj(it).covers)
  if (!cv.length) return ''
  const ids = cv.filter((x) => x.type !== 'todo').map((x) => str(x.id))
  const todos = cv.filter((x) => x.type === 'todo').length
  return `covers ${[ids.join(', '), todos ? `${todos} to-do${todos > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')}`
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

// The dispatcher as text: /fleet's answer, and the headless proof of both blocks.
export function summaryText(m, cfg) {
  const c = hubConfig(cfg)
  if (!m) return fill(c.labels.offline, { base: c.base })
  const W = m.words
  const P = m.laptop
  const G = m.global
  const lines = [`${fill(W.laptop, { machine: m.label })} (${fill(W.pulled, { ago: m.pulled, built: m.built || '?' })}${m.hubError ? `; ${m.hubError}` : ''})`]
  if (m.stale) lines.push(`! ${m.stale}`)
  if (!P.known) lines.push(fill(W.laptop_unknown, { machine: m.machine }))
  lines.push(`  ${P.line} · ${P.temp.text}${P.agents ? ' · ' + P.agents : ''}`)
  for (const w of P.warn) lines.push(`  ! ${w.text}`)
  lines.push(`  ${W.working}: ${P.work.length ? P.work.map((w) => w.text).join('; ') : W.working_none}`)
  lines.push(`  ${fill(W.todo_here, { n: P.todos.length })}`)
  if (!P.todos.length) lines.push(`    ${W.todo_none}`)
  for (const t of P.todos.slice(0, Number(c.max_rows) || 5)) lines.push(`    ${t.urgent ? '!' : '*'} ${t.nn} ${t.title}${t.marked ? ` (${W.marked})` : t.pending ? ` (${W.pending})` : ''}`)
  if (P.todos.length > (Number(c.max_rows) || 5)) lines.push(`    ${fill(W.show_all, { n: P.todos.length })}: ${moduleUrl(m.base, 'todo')}`)
  lines.push(`${W.global}${m.org ? ` (${(m.orgs.find((o) => o.id === m.org) || {}).label || m.org})` : ''}`)
  if (G.fleetLine) lines.push(`  ${G.fleetLine}`)
  if (G.dots.length) lines.push(`  ${G.dots.map((d) => `${d.label} ${d.state}`).join(' · ')}`)
  if (G.quota) lines.push(`  ${G.quota.tone === 'bad' ? '!' : '*'} ${G.quota.text}${G.quota.covers.length ? ` · covers ${G.quota.covers.join(', ')}` : ''}`)
  lines.push(`  ${W.you_block} (${G.youTotal})`)
  if (!G.you.length) lines.push(`    ${W.you_none}`)
  for (const q of G.you) {
    const rec = q.answers.find((a) => a.rec)
    lines.push(`    ${q.title}${q.app ? ` [${q.app}]` : ''}${q.covers ? ` · ${q.covers}` : ''}${rec ? ` · ${W.recommended}: ${rec.key === 'rec' ? rec.label : `${rec.key}) ${rec.label}`}` : ''}${q.sent ? ' · ' + fill(W.answered, { label: q.sent.label, at: fmtTime(q.sent.t, m.topt) }) : ''} (${q.id})`)
  }
  if (G.youTotal > G.you.length) lines.push(`    ${fill(W.show_all, { n: G.youTotal })}: ${moduleUrl(m.base, 'overview')}`)
  if (G.errors.length) {
    lines.push(`  ${W.errors}`)
    for (const e of G.errors) lines.push(`    ! ${e.text}`)
    if (G.errorsMore) lines.push(`    ${fill(W.show_all, { n: G.errors.length + G.errorsMore })}: ${moduleUrl(m.base, 'overview')}`)
  }
  if (G.later) lines.push(`  ${fill(W.later, { n: G.later })}: ${moduleUrl(m.base, 'overview')}`)
  if (G.urgentElsewhere) lines.push(`  ${fill(W.urgent_elsewhere, { n: G.urgentElsewhere })}: ${moduleUrl(m.base, 'todo')}`)
  lines.push(`  ${W.actions}: /dispatch <machine> <text> · /todo <machine> <text> (machines: ${G.targets.join(', ')})`)
  lines.push(`${W.open}: ${m.modules.map((x) => `${x.label} ${x.url}`).join(' · ')}`)
  return lines.join('\n')
}

export function badgeText(m) {
  return m ? `Fleet: ${m.hereOpen} to do` : 'Fleet: offline'
}
