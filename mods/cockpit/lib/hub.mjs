// The Cockpit mod's dispatcher (UX-PRINCIPLES rule 7, Julian 12 Nov 2026): ONE narrow pane, two blocks, read from the
// SAME data as the local Cockpit page (herd-worker on every laptop, http://127.0.0.1:24365, loopback only):
//   block 1 « This laptop »  what Julian must do here (urgent first), this machine's mode, load, temperature, current work
//   block 2 « Global »       the page's « Needs you now » (related items folded into one row, one-click answers),
//                            « Problems now » (what is not already under Needs you now; the quota as ONE row from
//                            quota.json), the alerts count, the page's fleet sentence, quick actions
//   « Open in Cockpit »      deep links to the page's modules (http://127.0.0.1:24365/#<module>) for anything bigger.
// The mod never re-implements the page's full tabs, and it never recomputes what the page prints: the fleet sentence,
// machine tiles (mode, temperature, order), module list and headings are read from data.json as the page reads them.
//   GET  /local.json   this computer: machine id, delivered to-dos, marked done, last pull from the hub
//   GET  /data.json    the hub's cockpit data (herd.cockpit/1): labels, todo, fleet, fleet_view, overview, inbox,
//                      quota, quota_mode, alerts_live, modules, page_labels, …
//   GET  /             the page; its <meta name="cockpit-token"> is the per-start token every POST carries
//   POST /api/run, /api/done {id}; /api/dispatch {machine, text}; /api/todo {machine, text} (also the answers, as the
//        page sends them: « Answer I90: a » to inbox.answer_machine)
// Times: ONE format on every line (hub.time: local clock, 24 h, « 19:22 » today, « Fri 13 Nov 16:02 » another day);
// hub-written dates inside texts (« empties 2026-11-13T07:31:57Z », « since 2026-11-11 ») are formatted here too.
// Pure: no `$`, no engine call. Words: the page's own (page_labels, inbox.labels) first, then hub.labels.

// the one hub view of the pane (the dispatcher); the old tab ids still open it (configs and /cockpit words of #82/#83)
export const HUB_TABS = ['home']
export const LEGACY_TABS = ['overview', 'todo', 'questions', 'fleet', 'quota', 'alerts', 'journal', 'watch', 'lanes']
// the page's modules (its view ids, its hash links; logic.js KNOWN)
export const MODULES = ['overview', 'inbox', 'todo', 'fleet', 'alerts', 'quota', 'dispatch', 'intake', 'lanes', 'journal', 'watch']
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
  // the « Open in Cockpit » links: the page's own list (data.modules) when it publishes one, else this order and labels
  modules: { order: MODULES, labels: { overview: 'Overview', inbox: 'Questions and checks', todo: 'To do', fleet: 'Fleet', alerts: 'Alerts',
    quota: 'Quota', dispatch: 'Dispatch plan', intake: 'My messages', lanes: 'Lanes', journal: 'Journal', watch: 'Watch' } },
  // at most this many rows in a block (UX rule 3); the rest is « show all N » in the page
  max_rows: 5,
  errors_max: 3,
  // the Global block shows about this many rows (Needs you now first, then Problems now), then « show all N » and
  // « Open in Cockpit » (UX rule 3; 50 columns = about one screen)
  global_max: 5,
  // a row's title wraps to this many lines of the pane's width (the full title is one click away in the page)
  title_lines: 2,
  // the recommended answer's button says what it does in at most this many words (the first clause of its note)
  effect_words: 7,
  todo: { max: 3, urgent_prio: 8, tag_re: '^\\s*\\[([^\\]]{1,24})\\]\\s*' },
  // one clock everywhere: zone "local" (this computer) or "utc"; hour12 false = « 19:22 »
  time: { zone: 'local', hour12: false },
  // quota: provider states that make a « Problems now » row; the quota mode that turns it yellow (Julian's choice)
  quota: { states: ['critical', 'stop', 'high'], calm_modes: ['unlimited'], category_re: '^quota(/|$)' },
  severity_order: ['critical', 'urgent', 'alert', 'high', 'warn', 'normal', 'watch', 'low', 'info', 'ok'],
  severity_tone: { critical: 'bad', urgent: 'bad', alert: 'bad', high: 'warn', warn: 'warn', watch: 'warn', normal: '', low: 'dim', info: 'dim', ok: 'ok' },
  // colour = state (UX rule 4): the page's tile colours, then the older herd states
  colour_tone: { red: 'bad', yellow: 'warn', green: 'ok', grey: 'dim' },
  state_tone: { on: 'ok', live: 'ok', hub: 'ok', busy: 'running', viewer: 'dim', asleep: 'dim', off: 'dim', stale: 'warn', gaming: 'warn', offline: 'bad', down: 'bad' },
  // plain words for the register's states, owners and types (UX rule 16: no internal code as the main label)
  state_words: { 'blocked-user': 'waits on you', 'waiting-julian': 'waits on you', 'decided-by-agent': 'decided by an agent', open: 'open', blocked: 'blocked', resolved: 'resolved' },
  owner_words: { julian: 'waits on you', lead: 'the lead works on it', agent: 'an agent works on it' },
  type_words: { question: 'question', issue: 'problem', todo: 'to-do', backlog: 'plan item', alert: 'alert' },
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
    mode_unknown: 'unknown',
    temp: 'temperature {temp}',
    temp_max: 'max {c} °C in the last hour',
    temp_none: 'temperature: no sensor reading in the hub data',
    agents: '{n} agent processes',
    disk_low: 'disk {mount} {pct} % free',
    battery_low: 'battery {pct} % on battery',
    reboot: 'reboot pending',
    seen: 'seen {ago}',
    working: 'Working on',
    working_none: 'No queue job here.',
    todo_here: 'To do here ({n})',
    todo_none: 'Nothing to do here.',
    run: 'Run',
    done: 'Mark done',
    marked: 'marked done, closes at the next hub tick',
    pending: 'reaches this computer at the next sync (about 10 minutes)',
    global: 'Global',
    fleet_at: '{sentence} (at {at})',
    fleet_line: '{busy} of {workers} workers busy · jobs: {running} running, {queued} queued',
    you_block: 'Needs you now',
    you_none: 'Nothing needs you now.',
    you_count: '{n} need you now (at {at})',
    you_count_1: '{n} needs you now (at {at})',
    // the page's sentences over data.glance.decisions.counts (app.js renderYou)
    you_count_dec: '{n} decisions need you now (at {at})',
    you_count_dec_1: '{n} decision needs you now (at {at})',
    waiting_more: '{n} more wait on you without blocking work',
    // a row's « more »: opens the Cockpit page at that row (#r-<uid>), where every option and its effect is shown
    more_row: 'more',
    // This laptop keeps only the steps that are not already a decision row (one story, one place: the decision)
    todo_as_decisions: '{n} more are decisions below',
    todo_all_decisions: 'All {n} steps here are decisions below',
    // the critical strip: severity word, where (organization), the action link to the page's module
    crit_sev: 'critical',
    crit_open: 'Open {module}',
    crit_here: '! critical: see the strip above',
    decided_for_you: '{n} decided for you',
    // the line under the recommended answer: what it does, in a few words
    effect: '→ {effect}',
    ws_more: '{n} more ›',
    ws_less: 'less',
    open_modules: 'modules ›',
    // the strip above both blocks when the page data has critical problems (UX rule 20: work is stopped)
    critical: 'Critical: work is stopped',
    more_answers: 'more',
    less_answers: 'less',
    look_later: 'to look at when you have time',
    errors_at: 'At {at}.',
    not_fresh: 'not up to date: {parts}',
    not_fresh_part: '{label} refresh due {due} did not run (from {from})',
    job_on: '{what} job on {machine} (job {id})',
    started: 'started {at}',
    source_glance: 'numbers: the page\'s own (data.glance of {at})',
    source_decisions: 'numbers: the page\'s own (data.glance.decisions of {at})',
    source_computed: 'numbers: computed here (this hub data has no glance)',
    covers: 'covers {list}',
    todos_n: '{n} to-do',
    todos_n_pl: '{n} to-dos',
    and: 'and',
    todo_on: 'to-do on {machine}',
    todo_on_here: 'to-do on this laptop (above)',
    priority: 'priority {n}',
    errors: 'Problems now',
    errors_none: 'No problem now.',
    // the page's sub-line words of a Problems now row (app.js problemRow)
    kind_words: { issue: 'problem' },
    sev_words: { urgent: 'urgent', critical: 'urgent', high: 'look when you have time' },
    owner_line: 'owner {owner}',
    covered: '{n} more are under Needs you now',
    alerts_line: 'Alerts: {n} open, {u} urgent',
    alerts_listed: '{n} more are listed above',
    alerts_none: 'No open alert.',
    quota_row: '{label} quota: {used} % used of the {window} window, empties {exhaust} at this pace (resets {reset})',
    quota_row_ok: '{label} quota: {used} % used of the {window} window (resets {reset})',
    quota_read: 'read {at}',
    quota_mode: '{mode} mode until {until}',
    quota_mode_open: '{mode} mode',
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
    send_hint: 'Fills the prompt (/dispatch or /todo <machine> <text>). Machines: {machines}',
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
    time: { ...d.time, ...(u.time || {}) },
    quota: { ...d.quota, ...(u.quota || {}) },
    severity_tone: { ...d.severity_tone, ...(u.severity_tone || {}) },
    colour_tone: { ...d.colour_tone, ...(u.colour_tone || {}) },
    state_tone: { ...d.state_tone, ...(u.state_tone || {}) },
    state_words: { ...d.state_words, ...(u.state_words || {}) },
    owner_words: { ...d.owner_words, ...(u.owner_words || {}) },
    type_words: { ...d.type_words, ...(u.type_words || {}) },
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
  const alias = { questions: 'inbox', checks: 'inbox', answers: 'inbox', 'to-do': 'todo', digest: 'watch', events: 'journal', plan: 'dispatch', messages: 'intake' }
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

// ---- one clock -------------------------------------------------------------------------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const p2 = (n) => String(n).padStart(2, '0')
const timeCfg = (c) => obj(c && c.time ? c.time : HUB_DEFAULTS.time)
// zone: "local" (this computer's clock), "utc", or an IANA name (« Europe/Paris ») read through Intl when the engine has it
const ZONES = new Map()
function zoneFmt(z) {
  if (!ZONES.has(z)) {
    let f = null
    try { f = new Intl.DateTimeFormat('en-GB', { timeZone: z, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' }) } catch { f = null }
    ZONES.set(z, f)
  }
  return ZONES.get(z)
}
function partsOf(t, c) {
  const d = new Date(t)
  const z = str(timeCfg(c).zone || 'local')
  if (z === 'utc' || z === 'UTC') return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() }
  const f = z !== 'local' ? zoneFmt(z) : null
  if (f) {
    const o = {}
    for (const x of f.formatToParts(d)) o[x.type] = x.value
    return { y: Number(o.year), mo: Number(o.month) - 1, d: Number(o.day), wd: DAYS.indexOf(o.weekday), h: Number(o.hour) % 24, mi: Number(o.minute) }
  }
  return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), wd: d.getDay(), h: d.getHours(), mi: d.getMinutes() }
}
const clockOf = (p, c) => {
  if (!timeCfg(c).hour12) return `${p2(p.h)}:${p2(p.mi)}`
  return `${((p.h + 11) % 12) + 1}:${p2(p.mi)} ${p.h < 12 ? 'AM' : 'PM'}`
}
// « 19:22 » the same day as now, « Fri 13 Nov 16:02 » another day; '' without a time
export function at(x, now, c) {
  const t = tsOf(x)
  if (!t) return ''
  const p = partsOf(t, c)
  const n = now ? partsOf(now, c) : null
  return n && n.y === p.y && n.mo === p.mo && n.d === p.d ? clockOf(p, c) : `${DAYS[p.wd]} ${p.d} ${MONS[p.mo]} ${clockOf(p, c)}`
}
// a calendar date the hub wrote without a time (« 2026-11-11 ») -> « Wed 11 Nov » (no zone shift: it is a date)
export function dayOf(y, mo, d) {
  const wd = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()
  return `${DAYS[wd]} ${Number(d)} ${MONS[Number(mo) - 1]}`
}
// Hub-written times inside a text, in the one format: ISO stamps, « 2026-11-12 18:00Z », bare dates, « 13 Nov 06:00 UTC »,
// « 16:55 UTC ». Text without any is returned unchanged.
export function localize(text, now, c) {
  let s = str(text)
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})(?![\w:])/g, (m, y, mo, d, h, mi, ss, z) => {
    const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${ss || '00'}${z.length === 5 ? z.slice(0, 3) + ':' + z.slice(3) : z}`)
    return Number.isFinite(t) ? at(t, now, c) : m
  })
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b(?![T:\d-])/g, (m, y, mo, d) => (Number(mo) >= 1 && Number(mo) <= 12 ? dayOf(y, mo, d) : m))
  s = s.replace(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}):(\d{2}) UTC\b/g, (m, d, mon, h, mi) => {
    const y = new Date(now || Date.now()).getUTCFullYear()
    return at(Date.UTC(y, MONS.indexOf(mon), Number(d), Number(h), Number(mi)), now, c)
  })
  s = s.replace(/\b(\d{2}):(\d{2}) UTC\b/g, (m, h, mi) => {
    const n = new Date(now || Date.now())
    return at(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), Number(h), Number(mi)), now, c)
  })
  return s
}
// kept for older callers: the one clock, no longer UTC
export const hhmmUtc = (t, c) => at(t, t, c)
export const when = (x, c) => at(x, 0, c)

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

// Related items of the list folded into one row (UX rule 13): items linked by `related` ids or `links`
// (« fleet-todo:x » = the to-do x) form one group; its row is the question that can be answered (else the first item),
// and it says what it covers. Order = the list's order of each group's first item.
export function foldRelated(list) {
  const items = arr(list)
  const keyOf = new Map()
  items.forEach((it, i) => {
    keyOf.set(str(it.uid), i)
    if (it.id) keyOf.set(str(it.id), keyOf.has(str(it.id)) ? keyOf.get(str(it.id)) : i)
    if (it.type === 'todo') keyOf.set('fleet-todo:' + str(it.id), i)
  })
  const parent = items.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const join = (a, b) => { const x = find(a), y = find(b); if (x !== y) parent[Math.max(x, y)] = Math.min(x, y) }
  items.forEach((it, i) => {
    for (const r of [...arr(it.related), ...arr(it.links)]) {
      const k = str(r)
      const j = keyOf.has(k) ? keyOf.get(k) : keyOf.has(k.replace(/^[a-z-]+:/, '')) && !/^fleet-todo:/.test(k) ? keyOf.get(k.replace(/^[a-z-]+:/, '')) : undefined
      if (j !== undefined && j !== i) join(i, j)
    }
  })
  const groups = new Map()
  items.forEach((it, i) => {
    const r = find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(it)
  })
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, members]) => {
    const head = members.find((m) => m.type === 'question' && m.answerable) || members.find((m) => m.type === 'question') || members[0]
    return { head, members, others: members.filter((m) => m !== head), blocks_work: members.some((m) => m.blocks_work) }
  })
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

// ---- the page's decisions (data.glance.decisions, herd/cockpit/glance.py decisions()) ----------------------------------

// The page's element id of a row (app.js uidKey + itemRow): « more » opens the page at base/#r-<key>.
export const uidKey = (u) => String(u).replace(/[^A-Za-z0-9-]/g, '-')
export const rowUrl = (base, uid) => moduleUrl(base, 'r-' + uidKey(uid))
export const CLICK_LINE = 'Clicked by Julian in the Cockpit'

// The buttons of one decisions row, as the page draws them (logic.js answerButtons): « decide » rows (no register
// options) carry the hub's yes / no / later with one recommended; register rows their options, « rec » first when the
// advice is not an option. A recommended KEY (shared contract of 12 Nov) marks that option when rec_key is absent.
export function decisionButtons(r) {
  const row = obj(r)
  const opts = arr(row.options).filter((o) => o && o.key !== undefined && o.key !== null)
  const keys = new Set(opts.map((o) => str(o.key)))
  const recKey = row.rec_key ? str(row.rec_key) : keys.has(str(row.recommended)) ? str(row.recommended) : ''
  const notes = obj(row.option_notes || row.notes)
  const synth = row.answer === 'decide'
  const out = opts.map((o) => ({ key: str(o.key), label: str(o.label), rec: str(o.key) === recKey, note: str(notes[str(o.key)] || ''), ...(synth ? { synth: true } : {}) }))
  if (!synth && recKey === 'rec' && str(row.recommended)) out.unshift({ key: 'rec', label: str(row.recommended), rec: true, note: '' })
  return out.sort((a, b) => Number(b.rec) - Number(a.rec))
}
// What an answer does, in a few words: the first clause of its note (« Turns on GitLab two-factor »), at most n words.
export function fewWords(note, n = 5) {
  const t = str(note).trim().split(/[.;:,(]|\s[-–—]\s/)[0].trim()
  const w = t.split(/\s+/).filter(Boolean)
  return w.length > n ? w.slice(0, n).join(' ') + '…' : w.join(' ')
}
export const buttonLabel = (a) => (a.key === 'rec' || a.synth ? a.label : `${a.key}) ${a.label}`)

// The text a click sends (POST /api/todo to the answer machine), the page's own: a register answer « Answer I90: a »,
// a decide choice « Cockpit: decide todo:x: yes », each with the page's click line. null = not sendable from here.
export function decisionText(row, key, template, clickLine) {
  const r = obj(row)
  let t = null
  if (r.answer === 'decide') {
    if (/^(todo|backlog|issue|question):[A-Za-z0-9._-]{1,80}$/.test(str(r.uid)) && ['yes', 'no', 'later'].includes(str(key))) t = `Cockpit: decide ${str(r.uid)}: ${str(key)}`
  } else t = answerText(template, str(r.id), key)
  if (!t) return null
  const l = str(clickLine || CLICK_LINE)
  return t.split(/\r?\n/).some((x) => x.trim() === l) ? t : `${t}\n${l}`
}

// « covers I4, I2 and 3 to-dos » from a decisions row's covers (uids « issue:I4 », « todo:x »), the page's coversText.
export function coversOfUids(uids, lab) {
  const l = { covers: 'covers {list}', and: 'and', todos_n: '{n} to-do', todos_n_pl: '{n} to-dos', ...obj(lab) }
  const c = arr(uids).map(str).filter(Boolean)
  if (!c.length) return ''
  const ids = c.filter((u) => !u.startsWith('todo:')).map((u) => u.replace(/^[a-z-]+:/, ''))
  const n = c.length - ids.length
  return fill(l.covers, { list: [ids.join(', '), n ? fill(n === 1 ? l.todos_n : l.todos_n_pl, { n }) : ''].filter(Boolean).join(` ${l.and} `) })
}

// The critical strip (UX rule 20: work is stopped), read when the page data has one: glance.critical as a list or
// {rows | items}, else glance.problems rows of severity critical. Each row: its text, organization, id and page link.
// The uids a critical row can be as a decision: its own uid, and the to-do the hub files for an alert key
// (« in:provision:login-mbp-glab » -> « todo:alert-in-provision-login-mbp-glab », as « issue:I90 » -> « todo:alert-issue-i90 »).
export function criticalUids(r) {
  const x = obj(r)
  return [str(x.uid), x.key ? 'todo:alert-' + str(x.key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : ''].filter(Boolean)
}
export function criticalRows(G, org, orgLabel, isFleet) {
  const g = obj(G)
  const src = Array.isArray(g.critical) ? g.critical : g.critical ? arr(obj(g.critical).rows || obj(g.critical).items) : arr(g.problems).filter((r) => r && str(r.severity).toLowerCase() === 'critical')
  return src.filter((r) => r && (r.text || r.title)).filter((r) => (!org ? true : r.org ? r.org === org : isFleet)).map((r) => ({
    text: str(r.text || r.title), id: str(r.id || ''), org: str(r.org || ''), orgLabel: r.org ? orgLabel(str(r.org)) : '',
    why: str(r.why || ''), link: str(r.link || '').replace(/^#/, '') || (r.uid ? 'r-' + uidKey(r.uid) : 'overview'),
    uid: str(r.uid || ''), key: str(r.key || ''), severity: str(r.severity || 'critical').toLowerCase(), kind: str(r.kind || ''), machine: str(r.machine || ''),
    // the page module the link opens (« #tile-msi » is a Fleet tile)
    module: /^tile-/.test(str(r.link || '').replace(/^#/, '')) ? 'fleet' : str(r.link || '').replace(/^#/, ''),
  }))
}

// The page's live alerts of a workspace (logic.js alertsFor).
export function alertsFor(data, org) {
  const a = obj(obj(data).alerts_live)
  if (org && obj(a.confidential)[org]) return arr(a.confidential[org]).slice()
  const def = str(obj(obj(data).inbox).default_org || 'fleet')
  return arr(a.rows).filter((r) => r && (!org || r.org === org || (!r.org && org === def)))
}
const isFleetWs = (data, org) => !org || org === str(obj(obj(data).inbox).default_org || 'fleet')

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
  const PG = obj(D.page_labels) // the page's headings
  // an item of a confidential organization shows only in its own workspace, never under « All »
  const secret = new Set([...(Array.isArray(inbox.confidential) ? inbox.confidential.map(str) : Object.keys(obj(inbox.confidential))), ...orgsOf(D).filter((o) => o.confidential).map((o) => o.id)])
  const todoOrg = obj(inbox.todo_org)
  const orgOf = (x) => str(obj(x).org || obj(x).organization || todoOrg[str(obj(x).id)] || '')
  const ofOrg = (x) => {
    const o = orgOf(x)
    if (!org) return !secret.has(o)
    return o ? o === org : inOrg(x, org)
  }
  // the page's ONE reading of its first blocks (herd/cockpit/glance.py, data.glance): when the hub publishes it the pane
  // prints its rows and counts as they are; older hub data: the rules below compute them from the same parts
  const G = obj(D.glance)
  const glance = Array.isArray(G.problems)
  if (typeof obj(G.time).hour12 === 'boolean') c.time = { ...c.time, hour12: G.time.hour12 }
  const T = (x) => at(x, now, c)
  const ovTs = tsOf(ov.generated_ts || ov.generated_utc)
  const late = arr(G.freshness).filter((p) => p && p.id !== 'data' && p.due_ts && now > tsOf(p.due_ts))
  const words = {
    ...c.labels, ...pick(PL, ['show_all', 'recommended', 'answer_sent']),
    ...pick(PG, ['needs_you', 'needs_you_none', 'errors_now', 'errors_now_none', 'alerts_none']),
  }
  // the page's headings are its own keys: needs_you -> you_block, errors_now -> errors
  if (PG.needs_you) words.you_block = str(PG.needs_you)
  if (PG.needs_you_none) words.you_none = str(PG.needs_you_none)
  if (PG.errors_now) words.errors = str(PG.errors_now)
  if (PG.errors_now_none) words.errors_none = str(PG.errors_now_none)
  const m = {
    machine, label: label(machine), version: str(L.version), viewer: Boolean(L.viewer), hubError: str(L.hub_error),
    fetchedAt: Number(L.fetched_at || 0), now, pulled: L.fetched_at ? ago(now - Number(L.fetched_at)) : 'never', hasData: Boolean(data),
    built: D.generated_ts || D.generated_utc ? T(D.generated_ts || D.generated_utc) : '', generated: str(D.generated_utc),
    orgs: orgsOf(D), org, labels, base: c.base, cfg: c,
    words,
    stale: late.length
      ? fill(c.labels.not_fresh, { parts: late.map((p) => fill(c.labels.not_fresh_part, { label: str(p.label || p.id), due: T(p.next_ts || p.due_ts), from: T(p.ts) })).join('; ') })
      : !arr(G.freshness).length && ovTs && ov.stale_after_s && now - ovTs > Number(ov.stale_after_s) * 1000 ? fill(c.labels.stale, { h: Math.round(Number(ov.stale_after_s) / 3600) }) : '',
    modules: modulesOf(D, c, PL),
    source: glance ? 'glance' : 'computed',
    sourceLine: glance ? fill(c.labels.source_glance, { at: T(G.generated_ts) }) : c.labels.source_computed,
  }
  m.time = (x) => T(x)
  m.todo = todoModel(L, D, c, ofOrg, label)
  m.laptop = laptopModel(L, D, c, m.todo, label, ov, now)
  m.global = globalModel(D, c, m.todo, ofOrg, org, label, ov, inbox, opts.answered || {}, now, machine)
  if (glance) Object.assign(m.global, glanceGlobal(D, G, c, org, inbox, opts.answered || {}, now, machine, label, words))
  // Needs you now = the page's decisions (counts and top rows as they are) when the hub publishes them
  const dg = decisionsGlobal(D, G, c, org, inbox, opts.answered || {}, now)
  if (dg) {
    Object.assign(m.global, dg)
    m.source = 'decisions'
    m.sourceLine = fill(c.labels.source_decisions, { at: T(G.generated_ts) })
  }
  const orgLab = (o) => str((m.orgs.find((x) => x.id === o) || {}).label || o)
  m.critical = criticalRows(G, org, orgLab, isFleetWs(D, org))
  if (dg) {
    // one story, one place (review 5, MAJOR 1): a step that is a decision row (or one a decision covers) shows once, as
    // the decision under Needs you now; This laptop keeps the other steps and says how many went there
    const isDecision = (t) => Boolean(dg.storyOf('todo:' + t.id))
    const kept = m.laptop.todos.filter((t) => !isDecision(t))
    m.laptop.asDecisions = m.laptop.todos.length - kept.length
    m.laptop.todos = kept
    m.global.urgentElsewhere = m.todo.urgentElsewhere.filter((t) => !isDecision(t)).length
    // a critical row whose story is a decision carries that decision (its recommended answer is the action), and the
    // decision is not repeated under Needs you now
    const deflt = str(obj(inbox).default_org || 'fleet')
    for (const r of m.critical) {
      // where: the machine when the row is about one, else its organization (the default one when it has none)
      r.where = r.machine ? label(r.machine) : r.orgLabel || orgLab(deflt)
      const d = criticalUids(r).map((u) => dg.storyOf(u)).find(Boolean)
      if (d) { r.decision = d; if (!r.where) r.where = d.orgLabel }
    }
    const onStrip = new Set(m.critical.filter((r) => r.decision).map((r) => r.decision.uid))
    if (onStrip.size) m.global.you = m.global.you.filter((q) => !onStrip.has(q.uid))
  } else for (const r of m.critical) r.where = r.machine ? label(r.machine) : r.orgLabel
  // one story once: this laptop's reasons already on the critical strip are not repeated under This laptop
  const onStripHere = m.critical.filter((r) => r.machine === machine).map((r) => r.text)
  if (onStripHere.length) {
    const kept = m.laptop.warn.filter((w) => !onStripHere.some((t) => t.includes(w.text)))
    m.laptop.onStrip = m.laptop.warn.length - kept.length
    m.laptop.warn = kept
  }
  // one problem, one place (UX rule 13): a critical row on the strip is not repeated under Problems now
  if (m.critical.length && Array.isArray(m.global.errors)) {
    const onStrip = new Set(m.critical.map((r) => localize(r.text, now, c)))
    const kept = m.global.errors.filter((e) => !onStrip.has(e.text))
    m.global.errorsTotal = Math.max(0, (m.global.errorsTotal || 0) - (m.global.errors.length - kept.length))
    m.global.errors = kept
  }
  // the page's count: every item of this computer (delivered or not yet, marked done or not) - the status line
  m.hereOpen = m.todo.all.filter((t) => t.here).length
  return m
}

function pick(o, keys) {
  const out = {}
  for (const k of keys) if (o[k]) out[k] = str(o[k])
  return out
}

// The page's own module list (data.modules, its side bar) when published, else the configured order.
function modulesOf(D, c, PL) {
  const pub = arr(D.modules).filter((x) => x && MODULES.includes(str(x.id)))
  const seen = new Set()
  const list = pub.length
    ? pub.map((x) => ({ id: str(x.id), label: str(x.label || x.id) }))
    : arr(c.modules.order).filter((id) => MODULES.includes(id)).map((id) => ({ id, label: str(PL['tab_' + id] || c.modules.labels[id] || id) }))
  return list.filter((x) => !seen.has(x.id) && seen.add(x.id)).map((x) => ({ ...x, url: moduleUrl(c.base, x.id) }))
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
      // This laptop lists only this machine's items: its own list, never one addressed to another machine
      const here = mid === machine && (!t.deliver_to || str(t.deliver_to) === machine)
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
const tilesOf = (D) => arr(obj(D.fleet_view).tiles).filter((t) => t && t.id)

// The hub's health reading of a machine when a lane publishes it: data.health.machines[id] (herd.health-summary/1),
// or fleet.machines[].health; the mode from data.modes[id] or the machine; null fields stay unknown (said so).
function healthOf(D, x, id) {
  const h = obj(obj(obj(D.health).machines)[id])
  const mh = obj(x && x.health)
  return { ...mh, ...h }
}

// One running job, the same words in the pane and /fleet; ETA from the overview when it has one for that job.
function jobLine(j, etaOf, lab, now, T) {
  const e = obj(etaOf.get(str(j.id)))
  const started = j.started_ts || e.started_ts
  const eta = j.eta_ts || e.eta_ts
  const late = Boolean(now && eta && tsOf(eta) < now)
  return {
    text: `job #${str(j.id)} ${str(j.kind)}${j.tag ? ` (${str(j.tag)})` : ''}${started ? ' · ' + fill(lab.since, { d: T(started) }) : ''}${eta ? ' · ' + fill(late ? lab.eta_past : lab.eta, { at: T(eta) }) : ''}`.replace(/\s+·/g, ' ·').trim(),
    tone: late ? 'warn' : 'running',
  }
}

function laptopModel(L, D, c, todo, label, ov, now) {
  const id = str(L.machine)
  const T = (x) => at(x, now, c)
  const tile = tilesOf(D).find((t) => str(t.id) === id) || null
  const x = machineOf(D, id)
  const lab = c.labels
  const out = { id, label: label(id), known: Boolean(tile || x), lines: [], warn: [], work: [], todos: todo.here, tone: '' }
  const etaOf = new Map(arr(obj(ov.running).jobs).map((j) => [str(j.id), j]))
  if (tile) {
    // the page's tile, as the page prints it: power, mode, CPU, RAM, the hotter sensor, its red and yellow reasons
    const state = tile.busy ? 'busy' : str(tile.power || '?')
    const ram = num(tile.ram_total_gb) ? Math.round((100 * Number(tile.ram_used_gb || 0)) / Number(tile.ram_total_gb)) : null
    out.state = state
    out.tone = c.colour_tone[str(tile.colour)] || c.state_tone[state] || ''
    out.line = fill(lab.state, { state, mode: str(tile.mode || (L.gaming ? 'gaming' : '')) || lab.mode_unknown, cpu: num(tile.cpu_pct) === null ? '—' : `${Math.round(tile.cpu_pct)} %`, ram: ram === null ? '—' : `${ram} %` })
    const cpuC = num(tile.cpu_c)
    const gpuC = num(tile.gpu_c)
    const hot = cpuC === null && gpuC === null ? null : (cpuC ?? -1) >= (gpuC ?? -1) ? { k: 'CPU', v: cpuC } : { k: 'GPU', v: gpuC }
    const max1h = num(tile.cpu_max_1h_c)
    const tTone = hot && hot.v >= c.temp.bad_c ? 'bad' : hot && hot.v >= c.temp.warn_c ? 'warn' : ''
    const maxTxt = max1h !== null && max1h >= c.temp.warn_c && (!hot || max1h > hot.v) ? ` (${fill(lab.temp_max, { c: Math.round(max1h) })})` : ''
    out.temp = { text: hot ? fill(lab.temp, { temp: `${hot.k} ${Math.round(hot.v)} °C` }) + maxTxt : lab.temp_none, tone: hot ? (tTone || (maxTxt ? 'warn' : '')) : 'dim' }
    for (const r of arr(tile.red)) out.warn.push({ text: str(r), tone: 'bad' })
    for (const r of arr(tile.yellow)) out.warn.push({ text: str(r), tone: 'warn' })
    if (tTone && !out.warn.some((w) => /°C|\d\s*C\b|temperature|hot/i.test(w.text))) out.warn.push({ text: out.temp.text, tone: tTone })
    const ag = obj(tile.agents)
    out.agents = num(ag.total) !== null && !out.warn.some((w) => /agent process/i.test(w.text)) ? fill(lab.agents, { n: ag.total }) : ''
    out.seen = num(tile.seen_age_s) !== null ? fill(lab.seen, { ago: ago(Number(tile.seen_age_s) * 1000) }) : ''
    // current work: the tile's own running jobs (one source for the tile, Lanes and this pane), lanes this machine owns
    if (!Array.isArray(obj(D.glance).jobs)) for (const j of arr(tile.running)) out.work.push(jobLine(obj(j), etaOf, lab, now, T))
  } else {
    // older hub data without fleet_view: the fleet machine and the health / modes keys
    const ld = obj(x && x.load)
    const h = healthOf(D, x, id)
    const modeRec = obj(obj(D.modes)[id])
    const gaming = Boolean(L.gaming || (x && x.gaming) || obj(ld.gaming).flag)
    const mode = str(modeRec.mode || (x && x.mode) || h.mode || (gaming ? 'gaming' : ''))
    const state = str((x && (x.herd_state || x.state)) || (L.viewer ? 'viewer' : '?'))
    const cpu = num(h.cpu_pct) ?? num(ld.cpu_pct)
    const ram = ld.ram_total_mb ? Math.round((100 * Number(ld.ram_used_mb || 0)) / Number(ld.ram_total_mb)) : null
    out.state = state
    out.tone = c.state_tone[state] || ''
    out.line = fill(lab.state, { state, mode: mode || lab.mode_unknown, cpu: cpu === null ? '—' : `${Math.round(cpu)} %`, ram: ram === null ? '—' : `${ram} %` })
    const gpu0 = obj(arr(ld.gpu)[0])
    const cpuC = num(h.cpu_c)
    const gpuC = num(h.gpu_c) ?? num(gpu0.temp_c)
    const hot = cpuC === null && gpuC === null ? null : (cpuC ?? -1) >= (gpuC ?? -1) ? { k: 'CPU', v: cpuC } : { k: 'GPU', v: gpuC }
    const tTone = hot && hot.v >= c.temp.bad_c ? 'bad' : hot && hot.v >= c.temp.warn_c ? 'warn' : ''
    out.temp = { text: hot ? fill(lab.temp, { temp: `${hot.k} ${Math.round(hot.v)} °C` }) : lab.temp_none, tone: hot ? tTone : 'dim' }
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
    // no tile: the queue's running jobs of the machine (the same source the tile is built from), else the overview's
    const qrun = arr(obj(x && x.queue).running)
    const src = qrun.length || x ? qrun : arr(obj(ov.running).jobs).filter((j) => str(j.machine) === id)
    if (!Array.isArray(obj(D.glance).jobs)) for (const j of src) out.work.push(jobLine(obj(j), etaOf, lab, now, T))
  }
  // the page's ONE source of running jobs (glance.jobs, the live queue), in its words: « ps job on MSI (job 418) »
  for (const j of arr(obj(D.glance).jobs).filter((x) => x && str(x.machine) === id)) {
    const lateJ = Boolean(now && j.eta_ts && tsOf(j.eta_ts) < now)
    out.work.push({
      text: [fill(lab.job_on, { what: str(j.tag || j.kind || 'a'), machine: label(id), id: str(j.id) }), j.started_ts ? fill(lab.started, { at: T(j.started_ts) }) : '',
        j.eta_ts ? fill(lateJ ? lab.eta_past : lab.eta, { at: T(j.eta_ts) }) : ''].filter(Boolean).join(' · '),
      tone: lateJ ? 'warn' : 'running',
    })
  }
  const lanes = arr(obj(D.lanes).running && obj(obj(D.lanes).running).lanes).length ? arr(obj(obj(D.lanes).running).lanes) : arr(obj(ov.running).lanes)
  for (const l of lanes) {
    const owner = str(obj(l).owner)
    if (owner === id || owner.startsWith(id + '/')) out.work.push({ text: `${localize(str(l.title), now, c)}${l.since ? ' · ' + fill(lab.since, { d: localize(str(l.since), now, c) }) : ''} · ${str(l.id)}`, tone: 'running' })
  }
  if (!out.tone && out.warn.some((w) => w.tone === 'bad')) out.tone = 'bad'
  return out
}

// The quota rows of « Problems now », built from quota.json (data.quota) as the Quota module reads it: one row per
// provider in a quota.states state, one exhaust time, its reading time; Julian's quota mode (data.quota_mode) turns it
// yellow with « unlimited mode until <date> ».
function quotaRows(D, c, now) {
  const q = obj(D.quota)
  const provs = Array.isArray(q.providers) ? q.providers : Object.entries(obj(q.providers)).map(([id, p]) => ({ id, ...obj(p) }))
  const qm = obj(D.quota_mode)
  const mode = qm.expired ? '' : str(qm.mode)
  const modeLabel = str((arr(D.quota_modes).find((x) => x && x.id === mode) || {}).label || mode)
  const calm = Boolean(mode && arr(c.quota.calm_modes).includes(mode))
  const lab = c.labels
  const T = (x) => at(x, now, c)
  const out = []
  for (const p of provs) {
    const wins = arr(p.windows).filter((w) => w && num(w.used_pct) !== null)
    const st = str(p.state || (wins.find((w) => c.quota.states.includes(str(w.state))) || {}).state)
    if (!c.quota.states.includes(st)) continue
    const w = wins.find((x) => x.exhausts_before_reset) || wins.find((x) => c.quota.states.includes(str(x.state))) || wins[0]
    if (!w) continue
    const vars = { label: str(p.label || p.id), used: Math.round(Number(w.used_pct)), window: str(w.window).replace(/^(\d+)d$/, '$1-day').replace(/^(\d+)h$/, '$1-hour'), exhaust: T(w.exhaust_at), reset: T(w.resets_at) || '—' }
    const text = w.exhaust_at && w.exhausts_before_reset !== false ? fill(lab.quota_row, vars) : fill(lab.quota_row_ok, vars)
    const read = w.reading_at || q.generated_at
    const sev = st === 'high' ? 'high' : 'urgent'
    out.push({
      kind: 'quota', provider: str(p.id), severity: calm ? 'high' : sev, tone: calm ? 'warn' : sevTone(c, sev) || 'bad', text,
      meta: [read ? fill(lab.quota_read, { at: T(read) }) : '', mode ? fill(qm.until ? lab.quota_mode : lab.quota_mode_open, { mode: modeLabel.toLowerCase(), until: T(qm.until) }) : ''].filter(Boolean),
      covers: [], link: 'quota',
    })
  }
  return out
}

// « I13 Claude weekly quota … (owner lead) » -> { id: 'I13', title, owner }
function splitIssue(text) {
  const mm = /^(I\d{1,5})\s+([\s\S]*?)(?:\s+\(owner ([\w-]+)\))?$/.exec(str(text))
  return mm ? { id: mm[1], title: mm[2], owner: mm[3] || '' } : { id: '', title: str(text), owner: '' }
}

function globalModel(D, c, todo, ofOrg, org, label, ov, inbox, answered, now, me) {
  const lab = c.labels
  const max = Number(c.max_rows) || 5
  const T = (x) => at(x, now, c)
  const fv = obj(D.fleet_view)
  const tiles = tilesOf(D)
  const fleetWs = isFleetWs(D, org)
  // one-line fleet status: the page's own sentence and time; one dot per machine in the page's tile order
  let fleetLine = ''
  let dots = []
  if (fv.sentence) {
    fleetLine = fill(lab.fleet_at, { sentence: str(fv.sentence), at: T(fv.generated_ts) })
    dots = tiles.map((t) => {
      const st = t.busy ? 'busy' : str(t.power || '?')
      return { id: str(t.id), label: str(t.label || label(t.id)), state: st, tone: c.colour_tone[str(t.colour)] || c.state_tone[st] || '', alerts: arr(t.alerts).length }
    })
  } else {
    const fl = obj(D.fleet)
    const h = obj(fl.herd)
    const machines = arr(fl.machines).filter((x) => x && x.id)
    const workers = machines.filter((x) => x.role === 'worker' || x.worker)
    const busy = workers.filter((x) => arr(obj(x.queue).running).length > 0 || x.herd_state === 'busy')
    fleetLine = machines.length ? fill(lab.fleet_line, { busy: busy.length, workers: workers.length, running: h.jobs_running ?? 0, queued: h.jobs_queued ?? 0 }) : ''
    dots = machines.map((x) => {
      const st = arr(obj(x.queue).running).length ? 'busy' : str(x.herd_state || x.state || '?')
      return { id: str(x.id), label: str(x.label || label(x.id)), state: st, tone: c.state_tone[st] || '', alerts: arr(x.alerts).length }
    })
  }
  // Needs you now: the page's « You » list of the workspace, related items folded into one row
  let you = []
  let total = 0
  let all = 0
  const covered = new Set()
  if (Array.isArray(inbox.items)) {
    const yl = youList(inboxItems(inbox, org), max)
    const groups = foldRelated(yl.all)
    for (const g of groups) for (const it of g.members) { covered.add(str(it.id)); covered.add(str(it.uid)) }
    const blocking = groups.filter((g) => g.blocks_work)
    total = blocking.length
    all = groups.length
    you = blocking.slice(0, Number(inbox.you_max) || max).map((g) => youRow(g, c, answered, now, label, me))
  } else {
    const qs = arr(obj(ov.you).questions).filter(ofOrg).filter((q) => sevRank(c, q.severity) <= 1)
    total = qs.length
    all = qs.length
    you = qs.slice(0, max).map((q) => ({ uid: str(q.id), id: str(q.id), title: localize(str(q.title), now, c), meta: [str(q.id)], covers: '', tone: sevTone(c, q.severity), answers: [], question: true, rec: str(q.recommended), sent: null }))
    for (const q of qs) covered.add(str(q.id))
  }
  // Problems now: the page's list (red machines, then the overview's errors), minus what Needs you now already shows;
  // the quota once, from quota.json, with the register's quota problems folded into it
  const category = new Map(arr(inbox.items).map((it) => [str(it.id), str(it.category)]))
  let quotaRe = null
  try { quotaRe = new RegExp(c.quota.category_re) } catch { quotaRe = null }
  const quota = fleetWs ? quotaRows(D, c, now) : []
  const rows = []
  let coveredN = 0
  if (fleetWs) {
    for (const t of tiles.filter((x) => x.colour === 'red')) rows.push({ kind: 'machine', severity: 'urgent', tone: 'bad', text: `${str(t.label)}: ${arr(t.red).map(str).join(', ')}`, meta: [], link: 'fleet' })
    rows.push(...quota)
    for (const e of arr(obj(ov.errors).rows)) {
      if (!e) continue
      if (e.kind === 'quota' && quota.length) continue
      const s = splitIssue(e.text)
      if (s.id && (covered.has(s.id) || covered.has('issue:' + s.id))) { coveredN++; continue }
      if (s.id && quota.length && quotaRe && quotaRe.test(category.get(s.id) || '')) {
        const prov = (category.get(s.id) || '').split('/')[1]
        const qr = quota.find((x) => x.provider === prov) || quota[0]
        qr.covers.push(s.id)
        continue
      }
      rows.push({
        kind: str(e.kind), severity: str(e.severity), tone: sevTone(c, e.severity) || 'bad', text: localize(s.title, now, c),
        meta: [s.owner ? c.owner_words[s.owner] || s.owner : '', s.id].filter(Boolean), link: e.link ? str(e.link).replace(/^#/, '') : 'overview',
      })
    }
  }
  rows.sort((a, b) => sevRank(c, a.severity) - sevRank(c, b.severity))
  for (const r of quota) if (r.covers.length) r.meta.push(fill(lab.covers, { list: r.covers.join(', ') }))
  const emax = Number(c.errors_max) || 3
  // alerts: the page's count of the workspace, minus the rows already shown above (Needs you now, the quota row)
  const al = alertsFor(D, org)
  let listed = 0
  const rest = al.filter((a) => {
    const dup = (a.issue && (covered.has(str(a.issue)) || quota.some((q) => q.covers.includes(str(a.issue))))) || (a.source === 'quota' && quota.length)
    if (dup) listed++
    return !dup
  })
  const open = rest.filter((a) => a.status === 'open')
  const alerts = obj(D.alerts_live).rows
    ? { text: rest.length ? fill(lab.alerts_line, { n: open.length, u: open.filter((a) => a.level === 'urgent').length }) : str(c.labels.alerts_none), listed: listed ? fill(lab.alerts_listed, { n: listed }) : '', total: al.length, tone: open.some((a) => a.level === 'urgent') ? 'bad' : open.length ? 'warn' : '' }
    : null
  return {
    fleetLine, dots, you, youTotal: total, youAll: all,
    errors: rows.slice(0, emax), errorsMore: Math.max(0, rows.length - emax), errorsTotal: rows.length, covered: coveredN, fleetWs,
    alerts,
    urgentElsewhere: todo.urgentElsewhere.length,
    answerMachine: str(inbox.answer_machine || 'oracle'), answerTemplate: str(inbox.answer_text || 'Answer {id}: {key}'), clickLine: str(inbox.click_line || CLICK_LINE),
    targets: Object.keys(obj(D.labels)),
  }
}

// The Global block from the page's own reading (data.glance) and the inbox's own folds (item.covers / covered_by):
// the same rows, counts and words as the page's Overview, nothing recomputed. Returns the fields it replaces.
const rowIn = (D, org, r) => (!org ? true : r.org ? r.org === org : isFleetWs(D, org))
function glanceGlobal(D, G, c, org, inbox, answered, now, me, label, words) {
  const lab = c.labels
  const T = (x) => at(x, now, c)
  const fleetWs = isFleetWs(D, org)
  const urgW = obj(obj(D.words).urgency)
  // Needs you now: the page's youList (blocking, nothing another row stands for); a row says what it covers
  const items = Array.isArray(inbox.items) ? inboxItems(inbox, org) : []
  const hubFolds = items.some((it) => it && (Array.isArray(it.covers) || it.covered_by))
  const yl = youList(items, Number(inbox.you_max) || 5)
  const blocking = yl.all.slice(0, yl.blocking)
  const groups = hubFolds
    ? blocking.map((it) => ({ head: it, members: [it], others: arr(it.covers).map((x) => ({ id: str(obj(x).id), uid: str(obj(x).uid), type: str(obj(x).type) })) }))
    : foldRelated(blocking)
  const you = groups.slice(0, Number(inbox.you_max) || Number(c.max_rows) || 5).map((g) => {
    const q = youRow(g, c, answered, now, label, me)
    // the page's sub-line, its words and order: application · urgency · covers … · id (a to-do: where it runs)
    const it = g.head
    const where = it.type === 'todo' ? (str(it.deliver_to) === me ? lab.todo_on_here : fill(lab.todo_on, { machine: label(str(it.deliver_to)) })) : ''
    q.meta = [str(it.app_label || ''), str(urgW[q.urgency] || q.urgency), q.covers, where || str(it.id)].filter(Boolean)
    q.covers = ''
    return q
  })
  const youCount = blocking.length ? fill(blocking.length === 1 ? lab.you_count_1 : lab.you_count, { n: blocking.length, at: T(inbox.generated_ts) }) : ''
  // the quota row: the Quota module's reading (glance.quota), one exhaust time, its mode; unlimited = yellow
  const gq = obj(G.quota)
  const quota = fleetWs && gq.text ? { text: localize(str(gq.text), now, c), tone: c.colour_tone[str(gq.colour)] || '', covers: arr(gq.covers).map(str), link: 'quota' } : null
  // Problems now: glance.problems (urgent only, nothing already under Needs you now), the quota row is above
  const sevW = obj(lab.sev_words)
  const kindW = obj(lab.kind_words)
  const errs = arr(G.problems).filter((r) => r && r.kind !== 'quota' && rowIn(D, org, r)).map((r) => ({
    kind: str(r.kind), severity: str(r.severity), tone: sevTone(c, r.severity) || 'bad', text: localize(str(r.text), now, c),
    meta: [kindW[str(r.kind)] || str(r.kind), sevW[str(r.severity)] || str(r.severity), r.owner ? fill(lab.owner_line, { owner: r.owner === 'julian' ? 'you' : str(r.owner) }) : '',
      arr(r.covers).length ? fill(lab.covers, { list: arr(r.covers).map(str).join(', ') }) : '', str(r.id)].filter(Boolean),
    link: str(r.link || '').replace(/^#/, '') || 'overview',
  }))
  const later = arr(G.later).filter((r) => r && r.kind !== 'quota' && rowIn(D, org, r)).length
  // alerts: the Alerts module's count (glance.alerts: machine, quota and job events); a workspace: its own rows
  const ga = obj(G.alerts)
  let alerts = null
  if (!org && num(ga.shown) !== null) {
    const open = Math.max(0, Number(ga.shown) - (num(ga.acked) || 0))
    alerts = { text: open ? fill(lab.alerts_line, { n: open, u: num(ga.urgent) || 0 }) : str(words.alerts_none || lab.alerts_none), listed: '', total: Number(ga.shown), tone: ga.urgent ? 'bad' : open ? 'warn' : '' }
  } else if (obj(D.alerts_live).rows) {
    const rows = alertsFor(D, org).filter((a) => !(a.entry || a.issue || /^issue:/.test(str(a.key))) && a.status === 'open')
    alerts = { text: rows.length ? fill(lab.alerts_line, { n: rows.length, u: rows.filter((a) => a.level === 'urgent').length }) : str(words.alerts_none || lab.alerts_none), listed: '', total: rows.length, tone: rows.some((a) => a.level === 'urgent') ? 'bad' : rows.length ? 'warn' : '' }
  }
  const emax = Number(c.errors_max) || 3
  return {
    you, youTotal: blocking.length, youAll: yl.all.length, youCount, quota, later, showErrors: true,
    errors: errs.slice(0, emax), errorsMore: Math.max(0, errs.length - emax), errorsTotal: errs.length, covered: 0, fleetWs,
    errorsAt: G.generated_ts ? fill(lab.errors_at, { at: T(G.generated_ts) }) : '',
    alerts,
  }
}

// Needs you now from the page's own fold (data.glance.decisions): its counts as they are, its top rows in its order,
// each with the page's buttons (recommended first) and its sub-line (application · organization · urgency · covers ·
// codes · id). A workspace: the decisions rows of that organization. null when the data has no decisions, or the
// workspace is one the decisions leave out (a confidential organization): the inbox path then draws it as before.
function decisionsGlobal(D, G, c, org, inbox, answered, now) {
  const dec = obj(G.decisions)
  if (!obj(dec.counts) || num(obj(dec.counts).now) === null || !Array.isArray(dec.top)) return null
  const lab = c.labels
  const T = (x) => at(x, now, c)
  const urgW = obj(obj(D.words).urgency)
  const orgs = orgsOf(D)
  const orgLabel = (o) => str((orgs.find((x) => x.id === o) || {}).label || o)
  const items = new Map()
  for (const it of [...arr(inbox.items), ...Object.values(obj(inbox.confidential)).flatMap((x) => arr(obj(x).items))]) if (it && it.uid) items.set(str(it.uid), it)
  const topN = Math.max(dec.top.length, 1)
  let top, nNow, nWait
  if (!org) {
    top = dec.top
    nNow = Number(dec.counts.now)
    nWait = num(dec.counts.waiting) ?? 0
  } else {
    const rows = arr(dec.rows).filter((r) => r && rowIn(D, org, r))
    if (!rows.length && !isFleetWs(D, org)) return null
    const blocking = rows.filter((r) => r.blocks)
    top = blocking.slice(0, topN)
    nNow = blocking.length
    nWait = rows.length - blocking.length
  }
  const toRow = (r) => {
    const it = obj(items.get(str(r.uid)))
    const answers = decisionButtons(r)
    const meta = [str(it.app_label || ''), !org && r.org ? orgLabel(str(r.org)) : '', str(urgW[str(r.urgency)] || r.urgency || ''), coversOfUids(r.covers, lab),
      ...arr(r.codes).map(str), str(r.id || '')].filter(Boolean)
    return {
      uid: str(r.uid), id: str(r.id), title: localize(str(r.title), now, c), app: str(it.app_label || ''), org: str(r.org || ''), orgLabel: r.org ? orgLabel(str(r.org)) : '',
      urgency: str(r.urgency), meta, covers: '', coversIds: arr(r.covers).map((u) => str(u).replace(/^[a-z-]+:/, '')),
      tone: r.urgency === 'now' ? 'bad' : 'warn', answers, decide: r.answer === 'decide', row: r,
      question: r.answer !== 'decide', rec: str(r.recommended || ''), why: str(r.why || ''), owner: str(r.owner || ''),
      url: rowUrl(c.base, r.uid), sent: answered[str(r.uid)] || null,
      effect: (() => { const a = answers.find((x) => x.rec); return a ? fewWords(a.note, Number(c.effect_words) || 5) : '' })(),
    }
  }
  const you = top.filter(Boolean).map(toRow)
  // every decision row of this view (not only the top ones) and what it covers: a story that is a decision is shown
  // once, as the decision (This laptop drops those steps; a critical row that is one carries its button)
  const viewRows = arr(dec.rows).filter((r) => r && r.uid && rowIn(D, org, r))
  const storyOf = new Map()
  for (const r of viewRows) for (const u of [str(r.uid), ...arr(r.covers).map(str)]) if (!storyOf.has(u)) storyOf.set(u, r)
  const dfy = Array.isArray(dec.decided_for_you) ? dec.decided_for_you.filter((r) => r && rowIn(D, org, r)).length : num(obj(dec.counts).decided_for_you) || 0
  const youCount = nNow ? fill(nNow === 1 ? lab.you_count_dec_1 : lab.you_count_dec, { n: nNow, at: T(inbox.generated_ts || G.generated_ts) }) : ''
  return {
    you, youTotal: nNow, youAll: nNow + nWait, youCount, waiting: nWait, waitingLine: nWait ? fill(lab.waiting_more, { n: nWait }) : '', decisions: true,
    decidedForYou: dfy, decidedLine: dfy ? fill(lab.decided_for_you, { n: dfy }) : '',
    storyOf: (uid) => { const r = storyOf.get(str(uid)); return r ? toRow(r) : null },
  }
}

// One « Needs you now » row: the plain title first, the meta line in plain words with the id small at the end,
// « covers I2, I4 and 1 to-do » when related items are folded into it.
function youRow(g, c, answered, now, label, me) {
  const it = g.head
  const lab = c.labels
  const isTodo = it.type === 'todo'
  const prio = /^p(\d)$/i.exec(str(it.priority))
  const meta = [
    str(it.app_label || ''),
    isTodo ? (str(it.deliver_to) === me ? lab.todo_on_here : fill(lab.todo_on, { machine: label(str(it.deliver_to)) })) : c.state_words[str(it.state)] || '',
    prio ? fill(lab.priority, { n: Number(prio[1]) + 1 }) : '',
    isTodo ? '' : str(it.id),
  ].filter(Boolean)
  const ids = g.others.filter((x) => x.type !== 'todo').map((x) => str(x.id))
  const nTodo = g.others.filter((x) => x.type === 'todo').length
  const parts = [...ids]
  if (nTodo) parts.push(fill(nTodo === 1 ? lab.todos_n : lab.todos_n_pl, { n: nTodo }))
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${lab.and} ${parts[parts.length - 1]}` : parts.join('')
  const title = str(it.title).replace(new RegExp(c.todo.tag_re), '')
  return {
    uid: str(it.uid || it.id), id: str(it.id), title: localize(title, now, c), app: str(it.app_label || it.app), urgency: str(it.urgency), meta,
    covers: list ? fill(lab.covers, { list }) : '', coversIds: g.others.map((x) => str(x.id)),
    tone: it.urgency === 'now' || it.severity === 'urgent' || it.severity === 'critical' ? 'bad' : 'warn',
    answers: answerButtons(it), question: it.type === 'question', rec: str(it.recommended),
    sent: answered[str(it.uid || it.id)] || null,
  }
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

// The dispatcher as text: /fleet's answer, and the headless proof of both blocks. Same rows, words and counts as the pane.
export function summaryText(m, cfg) {
  const c = hubConfig(cfg)
  if (!m) return fill(c.labels.offline, { base: c.base })
  const W = m.words
  const P = m.laptop
  const G = m.global
  const tmax = Number(c.todo.max) || 3
  const lines = []
  // the critical strip on top (UX rule 20), when the page data has one
  if (arr(m.critical).length) {
    lines.push(`!! ${W.critical}`)
    for (const r of m.critical) {
      lines.push(`   ! ${r.text}${[r.orgLabel, r.id].filter(Boolean).length ? ` (${[r.orgLabel, r.id].filter(Boolean).join(' · ')})` : ''}`)
      const rec = r.decision && r.decision.answers.find((a) => a.rec)
      if (rec) lines.push(`     [${buttonLabel(rec)} · ${W.recommended}] [${W.more_row}] ${r.decision.url}`)
    }
  }
  lines.push(`${fill(W.laptop, { machine: m.label })} (${fill(W.pulled, { ago: m.pulled, built: m.built || '?' })}${m.hubError ? `; ${m.hubError}` : ''})`)
  if (m.stale) lines.push(`! ${m.stale}`)
  if (!P.known) lines.push(fill(W.laptop_unknown, { machine: m.machine }))
  lines.push(`  ${P.line} · ${P.temp.text}${P.agents ? ' · ' + P.agents : ''}`)
  if (P.onStrip) lines.push(`  ${W.crit_here}`)
  for (const w of P.warn) lines.push(`  ! ${w.text}`)
  lines.push(`  ${W.working}: ${P.work.length ? P.work.map((w) => w.text).join('; ') : W.working_none}`)
  if (P.todos.length) lines.push(`  ${fill(W.todo_here, { n: P.todos.length })}`)
  else lines.push(`  ${P.asDecisions ? fill(W.todo_all_decisions, { n: P.asDecisions }) : W.todo_none}`)
  for (const t of P.todos.slice(0, tmax)) lines.push(`    ${t.urgent ? '!' : '*'} ${t.title}${t.marked ? ` (${W.marked})` : t.pending ? ` (${W.pending})` : ''}`)
  if (P.todos.length > tmax) lines.push(`    ${fill(W.show_all, { n: P.todos.length })}: ${moduleUrl(m.base, 'todo')}`)
  if (P.todos.length && P.asDecisions) lines.push(`    ${fill(W.todo_as_decisions, { n: P.asDecisions })}`)
  lines.push(`${W.global}${m.org ? ` (${(m.orgs.find((o) => o.id === m.org) || {}).label || m.org})` : ''}`)
  if (G.fleetLine) lines.push(`  ${G.fleetLine}`)
  if (G.quota) lines.push(`  ${G.quota.tone === 'bad' ? '!' : '*'} ${G.quota.text}${G.quota.covers.length ? ` · ${fill(W.covers, { list: G.quota.covers.join(', ') })}` : ''}`)
  if (G.dots.length) lines.push(`  ${G.dots.map((d) => `${d.label} ${d.state}`).join(' · ')}`)
  lines.push(G.youCount ? `  ${W.you_block} · ${G.youCount}` : `  ${W.you_block} (${G.youTotal})`)
  if (!G.you.length) lines.push(`    ${W.you_none}`)
  for (const q of G.you) {
    const rec = q.answers.find((a) => a.rec)
    if (!q.url) {
      // older hub data (no decisions): the earlier one-line form
      lines.push(`    ${q.title}${rec ? ` · ${W.recommended}: ${buttonLabel(rec)}` : ''}${q.sent ? ' · ' + fill(W.answered, { label: q.sent.label, at: m.time(q.sent.t) }) : ''}`)
      lines.push(`      ${[q.covers, ...q.meta].filter(Boolean).join(' · ')}`)
      continue
    }
    // the page's row: title, sub-line, then its buttons (the recommended answer, « more » = the page at that row)
    lines.push(`    ${q.title}`)
    lines.push(`      ${q.meta.join(' · ')}`)
    lines.push(q.sent ? `      ${fill(W.answered, { label: q.sent.label, at: m.time(q.sent.t) })}` : `      ${rec ? `[${buttonLabel(rec)} · ${W.recommended}] ` : ''}[${W.more_row}] ${q.url}`)
  }
  if (G.youCount ? G.youTotal > G.you.length : G.youAll > G.you.length) lines.push(`    ${fill(W.show_all, { n: G.youCount ? G.youTotal : G.youAll })}: ${moduleUrl(m.base, 'overview')}`)
  if (G.waitingLine) lines.push(`    ${G.waitingLine}: ${moduleUrl(m.base, 'inbox')}`)
  if (G.showErrors || G.fleetWs) {
    lines.push(`  ${W.errors}${G.errorsAt ? ` · ${G.errorsAt}` : ''}`)
    if (!G.errors.length) lines.push(`    ${W.errors_none}`)
    for (const e of G.errors) lines.push(`    ! ${e.text}${e.meta.length ? ` (${e.meta.join(' · ')})` : ''}`)
    if (G.errorsMore) lines.push(`    ${fill(W.show_all, { n: G.errorsTotal })}: ${moduleUrl(m.base, 'overview')}`)
    if (G.covered) lines.push(`    ${fill(W.covered, { n: G.covered })}`)
    if (G.later) lines.push(`    ${G.later} ${W.look_later}: ${moduleUrl(m.base, 'overview')}`)
  }
  if (G.alerts) lines.push(`  ${G.alerts.text}${G.alerts.listed ? ` (${G.alerts.listed})` : ''}: ${moduleUrl(m.base, 'alerts')}`)
  if (G.urgentElsewhere) lines.push(`  ${fill(W.urgent_elsewhere, { n: G.urgentElsewhere })}: ${moduleUrl(m.base, 'todo')}`)
  lines.push(`  ${W.actions}: /dispatch <machine> <text> · /todo <machine> <text> (machines: ${G.targets.join(', ')})`)
  lines.push(`${W.open}: ${m.modules.map((x) => `${x.label} ${x.url}`).join(' · ')}`)
  if (m.sourceLine) lines.push(`(${m.sourceLine})`)
  return lines.join('\n')
}

export function badgeText(m) {
  return m ? `Fleet: ${m.hereOpen} to do` : 'Fleet: offline'
}
