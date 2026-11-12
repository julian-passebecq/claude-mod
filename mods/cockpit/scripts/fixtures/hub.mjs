// Invented local Cockpit data (shape of herd-worker's /local.json and the hub's /data.json, schema herd.cockpit/1)
// for tests and `node mods/cockpit/scripts/preview.mjs --hub`. Nothing here is read from a machine.
const T0 = Date.parse('2026-01-02T12:00:00Z')

export const LOCAL = {
  machine: 'pc1', viewer: false, version: '0.4.2', now: T0, fetched_at: T0 - 20000, hub_error: '',
  delivered: [{ id: 'pc1-urgent', nn: '01' }, { id: 'pc1-plain', nn: '02' }, { id: 'pc1-marked', nn: '03' }],
  marked_done: ['pc1-marked'],
}

const item = (o) => ({ nn: '01', file: 'x.cmd', why: ['Why it matters.'], run: ['echo hi'], check: { kind: 'manual', text: 'Mark done when you did it' }, note: '', created: '2026-01-02 10:00Z', ...o })

export const DATA = {
  schema: 'herd.cockpit/1', generated_ts: T0 / 1000, generated_utc: '2026-01-02T12:00:00Z',
  labels: { pc1: 'Computer one', pc2: 'Computer two', hub: 'Hub' },
  todo: {
    pc1: [
      item({ id: 'pc1-urgent', nn: '01', title: '[security] Rotate the test key', about: 'pc1' }),
      item({ id: 'pc1-plain', nn: '02', title: 'Judge the screen colours', about: 'pc1', check: { kind: 'check', text: 'closes by itself (check not run yet)' } }),
      item({ id: 'pc1-marked', nn: '03', title: 'Install the viewer', about: 'pc1' }),
    ],
    pc2: [item({ id: 'pc2-item', title: 'Restore test (15 min)', about: 'pc2', org: 'acme', created: '2026-01-02 11:00Z' })],
  },
  fleet: {
    generated_utc: '2026-01-02T11:59:00Z',
    herd: { machines_up: 2, workers_total: 2, jobs_running: 1, jobs_queued: 0, todo_open_total: 4, alerts_total: 2,
      lost_24h: [{ id: 14, machine: 'pc2', kind: 'ps', at: '2026-01-02T09:43:28Z', note: 'lease expired' }], alerts_link: '~/ALERTS.md on the hub' },
    machines: [
      { id: 'pc1', label: 'Computer one', state: 'live', herd_state: 'live', role: 'worker', worker: { ver: '0.4.2', current: true },
        queue: { queued: 0, running: [] }, load: { cpu_pct: 12, ram_used_mb: 3000, ram_total_mb: 6000, disks: [{ mount: 'C:', free_pct: 40 }] }, alerts: [], seen: { age_s: 30 } },
      { id: 'pc2', label: 'Computer two', state: 'live', herd_state: 'busy', role: 'worker', worker: { ver: '0.4.1', current: false },
        queue: { queued: 0, running: [{ id: 9 }] }, load: { cpu_pct: 70 }, alerts: [{ severity: 'high', text: 'disk C: 5% free' }] },
    ],
  },
  digest: { name: 'DIGEST-2026-01-02.md', date: '2026-01-02', text: '# Watch digest\n\n## Summary\n\n- **Plan impact:** none.\n- Tool A 1.2 released.', cut: false },
  // herd.inbox/1: the page's « You » list and its answers (one confidential org: never under All)
  inbox: {
    schema: 'herd.inbox/1', default_org: 'tools', you_max: 5, answer_machine: 'hub', answer_text: 'Answer {id}: {key}',
    orgs: [{ id: 'acme', label: 'Acme', confidential: false }, { id: 'tools', label: 'Fleet and tooling', confidential: false }, { id: 'secret', label: 'Secret org', confidential: true }],
    labels: { you_block: 'You: what blocks work now', show_all: 'show all {n}', recommended: 'recommended', tab_inbox: 'Questions and checks', tab_overview: 'Overview' },
    todo_org: { 'pc2-item': 'acme' },
    items: [
      { uid: 'issue:I1', type: 'question', section: 'question', id: 'I1', title: 'Cap tool work?', org: 'tools', app_label: 'Tools', urgency: 'now', you: true, blocks_work: true, app_rank: 1,
        options: [{ key: 'a', label: 'cap at 3' }, { key: 'b', label: 'no cap' }], rec_key: 'a', recommended: 'a', answerable: true },
      { uid: 'backlog:Q2', type: 'backlog', section: 'yours', id: 'Q2', title: 'Pick the backup disk', org: 'acme', app_label: 'App one', urgency: 'today', you: true, blocks_work: true, app_rank: 2 },
      { uid: 'issue:I3', type: 'question', section: 'question', id: 'I3', title: 'Keep the old view?', org: 'tools', urgency: 'week', you: true, blocks_work: false, recommended: 'b', options: [], answerable: false },
    ],
    confidential: { secret: { apps: [], items: [{ uid: 'issue:I9', type: 'question', section: 'question', id: 'I9', title: 'Secret question', org: 'secret', urgency: 'now', you: true, blocks_work: true }] } },
  },
  answers: { source: 'ANSWERS.md', open: [{ n: 7, q: 'Which box stays awake?', options: 'a) one b) two', rec: 'a' }] },
  quota: { schema: 'herd.quota/1', generated_at: '2026-01-02T11:58:00Z', providers: {
    claude: { label: 'Claude', windows: [{ account: 'subscription', window: '7d', used_pct: 40, resets_at: '2026-01-05T12:00:00Z', reading_at: '2026-01-02T11:57:00Z', state: 'ok' }] },
  } },
  overview: {
    schema: 'herd.overview/1', generated_ts: T0 / 1000 - 600, generated_utc: '2026-01-02T11:50:00Z', stale_after_s: 10800,
    labels: { you: 'You: only you can do these' },
    max_rows: 8,
    sources: { quota: '2026-01-02T11:58:00Z' },
    you: {
      todos: [{ id: 'pc1-urgent', machine: 'pc1', title: 'Rotate the test key', prio: 9 }, { id: 'pc2-item', machine: 'pc2', title: 'Restore test', prio: 3 }],
      questions: [{ id: 'I2', severity: 'normal', title: 'Keep the old view?', recommended: 'b', options: 2 }, { id: 'I1', severity: 'urgent', title: 'Cap tool work?', recommended: 'a', options: 2 }],
      counts: { todos_open: 4, questions_waiting: 2, backlog_blocked_on_you: 1 },
    },
    errors: { rows: [{ kind: 'job', severity: 'high', text: 'job 14 lost on Computer two' }, { kind: 'quota', severity: 'urgent', text: 'Claude quota at 40 % of the week' }], blocked_sessions: '0 blocked' },
    apps: [{ key: 'a1', label: 'App one', rank: 1, sentence: 'App one: next step for you is the key.', importance: 'p0', eta: { state: 'waits', text: 'waits on you' }, owner_next: 'julian', moved: { closed: ['R3 done'], text: '' } }],
    running: { jobs: [{ id: 9, machine: 'pc1', kind: 'claude', started_ts: T0 / 1000 - 60, eta_ts: T0 / 1000 + 60, basis: 'median of 5 jobs' }],
      lanes: [{ id: 'R1', title: 'Write the folder table', owner: 'hub/runner', since: '2026-01-02', apps: ['a1'] }],
      runner: { t: '2026-01-02T11:55:00Z', text: 'picked R1' } },
  },
}

// The same computer with today's data.json keys (herd.cockpit/1 after the UI pass of 12 Nov): the page's fleet_view
// tiles and sentence, its module list and headings, quota.json read with a quota mode, live alerts, related items.
export const DATA2 = (() => {
  const d = structuredClone(DATA)
  d.page_labels = { needs_you: 'Needs you now', needs_you_none: 'Nothing needs you now.', errors_now: 'Problems now', errors_now_none: 'No problem now.' }
  d.modules = [{ id: 'overview', label: 'Overview' }, { id: 'inbox', label: 'Questions and checks' }, { id: 'todo', label: 'To do' }, { id: 'fleet', label: 'Fleet' },
    { id: 'alerts', label: 'Alerts' }, { id: 'quota', label: 'Quota' }, { id: 'dispatch', label: 'Dispatch plan' }, { id: 'intake', label: 'My messages' }, { id: 'nope', label: 'Unknown' }]
  d.fleet_view = {
    generated_ts: T0 / 1000 - 30, state: 'working', busy: 1, on: 2, workers: 2, util_pct: 50, sentence: 'Fleet coding is working: 1 of 2 machines busy, utilisation 50 %',
    tiles: [
      { id: 'pc2', label: 'Computer two', role: 'worker', power: 'on', mode: 'coding', colour: 'green', red: [], yellow: [], busy: true, running: [{ id: 9, kind: 'claude', tag: 'lane' }] },
      { id: 'pc1', label: 'Computer one', role: 'worker', power: 'on', mode: 'normal', colour: 'yellow', red: [], yellow: ['27 agent processes, cap 12', 'disk C: 8.4 % free'], busy: false,
        seen_age_s: 38, cpu_pct: 5, cpu_c: 59.1, gpu_c: 44, cpu_max_1h_c: 95.1, ram_used_gb: 32, ram_total_gb: 64, agents: { total: 27, cap: 12 }, running: [] },
      { id: 'tab', label: 'Tablet', role: 'viewer', power: 'off', colour: 'grey', red: [], yellow: [], busy: false, running: [] },
    ],
  }
  // the overview still lists job 9 on pc1 (a lost lease): the tiles are the one source of running jobs
  d.quota = { generated_at: '2026-01-02T11:29:01Z', providers: [
    { id: 'claude', label: 'Claude', state: 'critical', windows: [{ window: '7d', used_pct: 20, resets_at: '2026-01-08T12:00:00Z', exhaust_at: '2026-01-03T15:02:36Z', exhausts_before_reset: true, state: 'critical' }] },
    { id: 'codex', label: 'Codex', state: 'ok', windows: [{ window: '7d', used_pct: 3, state: 'ok' }] },
  ] }
  d.quota_mode = { mode: 'unlimited', source: 'file', set_by: 'julian', at: '2026-01-02T10:00:00Z', until: '2026-01-08T12:00:00Z', expired: false }
  d.quota_modes = [{ id: 'unlimited', label: 'Unlimited' }, { id: 'normal', label: 'Normal' }]
  d.overview.errors.rows = [
    { kind: 'quota', severity: 'urgent', text: 'Claude quota critical: 19.0% used of the 7d window, empties 2026-01-03T07:31:57Z before its reset' },
    { kind: 'issue', severity: 'urgent', text: 'I13 Claude weekly quota burns at 6 points an hour, empty around 3 Jan 06:00 UTC (owner lead)' },
    { kind: 'issue', severity: 'urgent', text: 'I2 Port 22 is open to the internet (owner julian)' },
    { kind: 'issue', severity: 'high', text: 'I10 Hub disk at 74 % since 2026-01-01 (owner agent)' },
    { kind: 'job', severity: 'high', text: '3 failed jobs in 24 h, last check 2026-01-02 11:00Z', link: '#fleet' },
  ]
  const sec = { uid: 'issue:I90', type: 'question', section: 'question', id: 'I90', title: 'Security hour: 2FA and token rotation', org: 'tools', app_label: 'Security', urgency: 'now', severity: 'urgent',
    state: 'waiting-julian', you: true, blocks_work: true, app_rank: 0, related: ['I2', 'I4'], links: ['fleet-todo:pc2-2fa'], options: [{ key: 'a', label: '30 minutes' }, { key: 'b', label: 'later' }], rec_key: 'a', answerable: true }
  d.inbox.items = [
    { uid: 'issue:I2', type: 'issue', section: 'look', id: 'I2', title: 'Port 22 is open to the internet', org: 'tools', app_label: 'Security', urgency: 'now', you: true, blocks_work: true, app_rank: 0, related: ['I4', 'I90'], category: 'security/ssh' },
    { uid: 'issue:I4', type: 'issue', section: 'look', id: 'I4', title: 'Leaked tokens are not rotated', org: 'tools', app_label: 'Security', urgency: 'now', you: true, blocks_work: true, app_rank: 0, related: ['I2', 'I90'] },
    sec,
    { uid: 'todo:pc2-2fa', type: 'todo', section: 'todo', id: 'pc2-2fa', title: '[security] 2FA and token rotation', org: 'tools', app_label: 'Security', urgency: 'now', you: true, blocks_work: true, deliver_to: 'pc2', related: ['I2', 'I4', 'I90'] },
    { uid: 'backlog:Q1', type: 'backlog', section: 'yours', id: 'Q1', title: 'Pick the backup disk', org: 'acme', app_label: 'App one', urgency: 'today', state: 'blocked-user', priority: 'p0', you: true, blocks_work: true, app_rank: 2 },
    { uid: 'issue:I13', type: 'issue', section: 'problem', id: 'I13', title: 'Claude weekly quota burns', org: 'tools', category: 'quota/claude', you: false },
    ...DATA.inbox.items.filter((x) => x.id === 'I3'),
  ]
  d.alerts_live = { generated_at: '2026-01-02T11:50:00Z', rows: [
    { key: 'issue:I2', level: 'urgent', status: 'open', title: 'I2 Port 22', issue: 'I2', org: 'tools' },
    { key: 'issue:I90', level: 'urgent', status: 'open', title: 'I90 Security hour', issue: 'I90', org: 'tools' },
    { key: 'quota:claude:critical', level: 'urgent', status: 'open', title: 'Quota Claude: critical', source: 'quota', issue: null, org: null },
    { key: 'issue:I10', level: 'high', status: 'open', title: 'I10 Hub disk', issue: 'I10', org: 'tools' },
    { key: 'issue:I12', level: 'high', status: 'acked', title: 'I12 Login expires', issue: 'I12', org: 'tools' },
  ] }
  return d
})()

// DATA2 plus what the hub writes since the 12 Nov review (claude-control herd/cockpit glance.py): data.glance, the page's
// ONE reading of its first blocks (quota row, Problems now, look later, alerts count, live jobs, freshness), and the
// inbox's own folds (item.covers on the row that stands for a group, item.covered_by on the items it covers).
export const DATA3 = (() => {
  const d = structuredClone(DATA2)
  const ts = T0 / 1000
  d.words = { urgency: { now: 'urgent', today: 'today', week: 'this week', later: 'later' } }
  d.inbox.generated_ts = ts - 60
  for (const it of d.inbox.items) {
    it.covered_by = ['I2', 'I4', 'pc2-2fa'].includes(it.id) ? 'issue:I90' : null
    it.covers = it.id === 'I90' ? [{ id: 'I2', uid: 'issue:I2', type: 'issue' }, { id: 'I4', uid: 'issue:I4', type: 'issue' }, { id: 'pc2-2fa', uid: 'todo:pc2-2fa', type: 'todo' }] : null
  }
  d.glance = {
    schema: 'herd.glance/1', generated_ts: ts - 30, time: { hour12: false },
    quota: { provider: 'claude', colour: 'yellow', state: 'high', covers: ['I13'], link: '#quota',
      text: 'Claude quota: 20 % used of the 7-day window, empties 2026-01-03T15:02:36Z at this pace, before its reset 2026-01-08T12:00:00Z; unlimited mode until 2026-01-08T12:00:00Z (read 2026-01-02T11:29:01Z)' },
    problems: [
      { kind: 'issue', severity: 'urgent', text: 'The job queue can run commands on every machine', id: 'I1', org: 'tools', owner: 'lead', link: '#r-issue-I1' },
      { kind: 'issue', severity: 'urgent', text: 'App one build is red since 2026-01-02T09:00:00Z', id: 'I7', org: 'acme', owner: 'agent' },
    ],
    later: [
      { kind: 'quota', severity: 'high', text: 'Claude quota (the row above)', org: null },
      { kind: 'job', severity: 'high', text: '3 failed jobs in 24 h', org: null, from_overview: true },
      { kind: 'issue', severity: 'high', text: 'Hub disk at 74 %', id: 'I10', org: 'tools' },
    ],
    alerts: { shown: 4, urgent: 1, acked: 1, entries: 3, entries_in_needs_you: 2 },
    jobs: [{ id: 31, machine: 'pc1', kind: 'ps', tag: 'modes', started_ts: ts - 600, eta_ts: null }, { id: 32, machine: 'pc2', kind: 'sh', tag: null, started_ts: ts - 60, eta_ts: null }],
    freshness: [
      { id: 'data', label: 'page data', ts: ts - 30, due_ts: ts + 390 },
      { id: 'overview', label: 'overview', ts: ts - 3 * 3600, next_ts: ts - 3600, due_ts: ts - 3300 },
      { id: 'quota', label: 'quota reading', ts: ts - 1800, next_ts: ts + 1800, due_ts: ts + 2100 },
    ],
  }
  return d
})()
