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
