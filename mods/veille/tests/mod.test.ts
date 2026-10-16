// Hook tests for veille with the Claude Code test kit: claude plugin test mods/veille
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const MIN = 60000
const USER = JSON.stringify({ mode: 'légère', installed: true })
const STATE = JSON.stringify({
  mode: 'légère', last_tour: NOW - 3 * MIN, mail: 'not_configured',
  alerts: {
    'needs:c1:x': { key: 'needs:c1:x', kind: 'needs', severity: 'julian', julian: true, what: 'Attend Julian : choisir le nom', title: 'Lane A', since: NOW - 50 * MIN, session_link: 'claude://claude.ai/epitaxy/local_1' },
    'green:pr': { key: 'green:pr', kind: 'green', severity: 'warn', what: 'x#7 verte depuis 1 h 30, pas mergée', title: 'Lane B', since: NOW - 90 * MIN, link: 'https://github.com/o/x/pull/7', pr: 'x#7' },
  },
  recent: [{ at: NOW - 3 * MIN, kind: 'merge_skipped', pr: 'x#7', reason: 'tête stable depuis moins de 30 min' }],
})

// A tiny Fil digest (what the watcher writes to ~/.claude/veille/fil.json): one project, a lead and its sub-conversation.
const conv = (o) => ({ sid: 'local_x', cli: 'c-x', title: 'T', state: 'repos', model: 'claude-opus-5-5', effort: 'medium', archived: false, parent: null,
  parent_title: '', last_at: NOW - 10 * MIN, msg_at: NOW - 10 * MIN, link: 'claude://claude.ai/epitaxy/local_x', preview: '', from_wrap: false,
  recap: '', ask: '', signal: '', actions: [], text: '', truncated: false, prs: [], children: [], ...o })
const FIL = JSON.stringify({ v: 1, generated: NOW - 2 * MIN, total: 2, julian: 1, projects: [{ name: 'alpha', last: NOW - 5 * MIN, total: 2, hidden: 0,
  counts: { en_cours: 0, attend: 1, bloquee: 0, terminee: 1, repos: 0 },
  convs: [conv({ sid: 'local_lead', title: 'Alpha lead', state: 'terminee', preview: 'The feature is merged.', text: '## Done\n\nAll merged.',
    children: [conv({ sid: 'local_kid', title: 'Alpha lane', state: 'attend', signal: 'question', ask: 'Tell me whether the #29 merge stays', last_at: NOW - 5 * MIN, msg_at: NOW - 5 * MIN,
      preview: 'PR #29 is green.', parent: 'local_lead' })] })] }] })

// What the watcher writes to ~/.claude/veille/archive.json: two finished conversations the VEILLE conversation may archive.
const ARCHIVE = JSON.stringify({ v: 1, generated: NOW - 4 * MIN, idle_h: 6, open: 9, count: 2, kept: {}, candidates: [
  { sid: 'local_old1', cli: 'c-old1', title: 'Old lane one', project: 'alpha', last_at: NOW - 9 * 60 * MIN, idle_h: 9, reason: 'PR #21 mergée, terminée, inactive 9 h', pr: null },
  { sid: 'local_old2', cli: 'c-old2', title: 'Old lane two', project: 'beta', last_at: NOW - 30 * 60 * MIN, idle_h: 30, reason: 'pas de PR, terminée, inactive 30 h', pr: null },
] })

// What export-eta's exporter writes to ~/.claude/export-eta: a ready batch and one past export.
const PENDING = JSON.stringify({ generated: NOW - 5 * MIN, ready: true, count: 4, ids: ['c1', 'c2', 'c3', 'c4'], reason: 'count', text: '4 conversations terminées — Exporter vers eta',
  titles: [{ cli: 'c1', title: 'Lane one', project: 'alpha' }, { cli: 'c2', title: 'Lane two', project: 'beta' }] })
const EXPORTS = JSON.stringify({ history: [{ at: NOW - 60 * MIN, mode: 'batch', count: 3, pr: 12, url: 'https://github.com/o/eta/pull/12', merged: true, held: [] }] })

// What the watcher writes for the safe wake (wakes.json) and /veille jour (night-summary.json). Invented values.
const WAKES = JSON.stringify({ v: 1, generated: NOW - MIN, wakes: [{ at: NOW - 20 * MIN, key: 'idle:c1', title: 'Coordinator', want: { model: 'claude-opus-5-5', effort: 'medium', permission: 'acceptEdits' },
  status: 'ok', reason: 'Lane B idle', result: 'Relaunched lane B.', log: 'w.log' }] })
const NIGHT = JSON.stringify({ v: 1, generated: NOW - 60 * MIN, lines: ['Bilan de la nuit : 23:00 → 07:00 (8 h) · 2 mergées · 1 échecs · 1 attentes de Julian · 0 réveils', 'mergées :', '  01:10 x#7'] })

function base(on, heartbeat = { last_fire: NOW - 2 * MIN, last_tour: NOW - 3 * MIN }, user = USER) {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    'veille/config.json': user, 'veille/state.json': STATE, 'veille/wakes.json': WAKES, 'veille/night-summary.json': NIGHT, 'veille/fil.json': FIL, 'veille/archive.json': ARCHIVE, 'veille/heartbeat.json': JSON.stringify(heartbeat), 'veille/acks.jsonl': '',
    'export-eta/pending.json': PENDING, 'export-eta/state.json': EXPORTS,
  }
  const hit = (p: string) => Object.keys(files).find((k) => p.replace(/\\/g, '/').endsWith('.claude/' + k))
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.exists', ($, e) => ({ value: !!hit(String(e.path)) || String(e.path).endsWith('veille.config.json') }))
  on('fs.read', ($, e) => {
    const k = hit(String(e.path))
    if (k) return { value: files[k] }
    return { value: JSON.stringify({ modes: {
      rien: { label: 'Rien', interval_min: 0, may: [] },
      'légère': { label: 'Légère', interval_min: 30, may: ['alert', 'notify', 'mail'], help: 'Un tour toutes les 30 min.' },
      active: { label: 'Active', interval_min: 5, may: ['alert', 'notify', 'mail', 'wake'] },
    }, fire_every_min: 5, labels: { title: 'Veille', mode: 'Mode', severity: { julian: 'attend Julian', warn: 'à faire' }, stopped: 'VEILLE ARRÊTÉE : pas de tour depuis {since}', band: 'Veille' }, colors: { bad: '#dc2626' } }) }
  })
  const runs: string[][] = []
  on('process.run', ($, e) => { runs.push(e.argv ?? []); return { value: { exitCode: 0, stdout: 'veille: mode active', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  return { clock, runs }
}

const has = async (ui, re: RegExp) => (await ui.find({ type: 'Text', text: re })) !== undefined || (await ui.find({ type: 'Button', text: re })) !== undefined
const PANE = { title: 'Veille', isFocused: true, bodyColumns: 120, placement: 'inline', scroll: { offset: 0, bodyRows: 60 }, view: {} }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/veille draws the mode, its buttons, the last tour, the alerts with Ack and the events (${surface})`, async ($, on) => {
    base(on)
    await $.command.run({ command: 'veille', args: '' })
    const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface, viewport: { columns: 140, rows: 60 }, props: PANE })
    expect(await has(ui, /Veille · Mode Légère/)).toBe(true)
    expect(await has(ui, /^Active$/)).toBe(true)
    expect(await has(ui, /Dernier tour : \d\d:\d\d/)).toBe(true)
    expect(await has(ui, /Attend Julian : choisir le nom/)).toBe(true)
    expect(await has(ui, /^Ack$/)).toBe(true)
    expect(await has(ui, /e-mail non configuré/)).toBe(true)
    expect(await has(ui, /pas mergée : x#7/)).toBe(true)
  })
}

test('the pane goes red when the watcher missed two fires', async ($, on) => {
  base(on, { last_fire: NOW - 40 * MIN, last_tour: NOW - 40 * MIN })
  await $.command.run({ command: 'veille', args: '' })
  const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface: 'terminal', viewport: { columns: 140, rows: 60 }, props: PANE })
  expect(await has(ui, /VEILLE ARRÊTÉE/)).toBe(true)
})

test('/veille mode active runs the watcher command', async ($, on) => {
  base(on)
  const r = await $.command.run({ command: 'veille', args: 'mode active' })
  expect(JSON.stringify(r)).toContain('mode active')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/veille fil draws the Fil: red counter, filters, project summary, lead and sub-conversation, ask, open link (${surface})`, async ($, on) => {
    base(on)
    await $.command.run({ command: 'veille', args: 'fil' })
    const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface, viewport: { columns: 140, rows: 80 }, props: PANE })
    expect(await has(ui, /^Fil$/)).toBe(true)
    expect(await has(ui, /attend Julian : 1/)).toBe(true)
    expect(await has(ui, /^Attend Julian$/)).toBe(true)
    expect(await has(ui, /Terminées aujourd'hui/)).toBe(true)
    expect(await has(ui, /2 conv · 1 attend Julian · dernière activité/)).toBe(true)
    expect(await has(ui, /Alpha lead/)).toBe(true)
    expect(await has(ui, /Alpha lane/)).toBe(true)
    expect(await has(ui, /Tell me whether the #29 merge stays/)).toBe(true)
    await ui.press({ key: 'fil-conv-local_kid' })
    expect(await has(ui, /Copier l'id/)).toBe(true)
    expect(await has(ui, /non vérifiée/)).toBe(true)
    await ui.press({ key: 'fil-open-local_kid' })
    expect(await has(ui, /lien envoyé à l’app : claude:\/\/claude\.ai\/epitaxy\/local_x/)).toBe(true)
  })
}


for (const surface of ['terminal', 'desktop'] as const) {
  test(`one pane, four tabs: Alertes, Fil, À archiver (2), Export eta (4) (${surface})`, async ($, on) => {
    base(on)
    await $.command.run({ command: 'veille', args: 'alertes' })
    const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface, viewport: { columns: 140, rows: 80 }, props: PANE })
    expect(await has(ui, /^Alertes$/)).toBe(true)
    expect(await has(ui, /^Fil$/)).toBe(true)
    expect(await has(ui, /^À archiver/)).toBe(true)
    expect(await has(ui, /^Export eta/)).toBe(true)
    expect(await has(ui, /attend Julian : 1/)).toBe(true)
    await ui.press({ key: 'veille-tab-export' })
    expect(await has(ui, /^Export eta \(4\)$/)).toBe(true)
    expect(await has(ui, /4 conversations terminées — Exporter vers eta/)).toBe(true)
    await ui.press({ key: 'veille-tab-archiver' })
    expect(await has(ui, /^À archiver \(2\)$/)).toBe(true)
    expect(await has(ui, /Old lane two · beta/)).toBe(true)
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/veille export: the batch, its conversations, « Exporter vers eta » runs export-eta's exporter, last exports (${surface})`, async ($, on) => {
    const w = base(on)
    await $.command.run({ command: 'veille', args: 'export' })
    const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface, viewport: { columns: 140, rows: 80 }, props: PANE })
    expect(await has(ui, /4 conversations terminées — Exporter vers eta/)).toBe(true)
    expect(await has(ui, /seuil 3 atteint/)).toBe(true)
    expect(await has(ui, /alpha · Lane one/)).toBe(true)
    expect(await has(ui, /Derniers exports/)).toBe(true)
    expect(await has(ui, /batch · 3 conversation/)).toBe(true)
    await ui.press({ key: 'veille-export' })
    const run = w.runs.find((a) => a.some((x) => /export-eta\/exporter\/export\.mjs$/.test(String(x))))
    expect(run && run.slice(-3).join(' ')).toBe('run --mode batch')
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/veille archiver opens the À archiver tab with the reasons and copies the ids (${surface})`, async ($, on) => {
    base(on)
    let copied = ''
    on('ui.copy', ($, e) => { copied = String(e.text); return { value: { isCopied: true } } })
    await $.command.run({ command: 'veille', args: 'archiver' })
    const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface, viewport: { columns: 140, rows: 80 }, props: PANE })
    expect(await has(ui, /À archiver .2./)).toBe(true)
    expect(await has(ui, /Old lane one · alpha · PR #21 mergée, terminée, inactive 9 h/)).toBe(true)
    expect(await has(ui, /archive_session/)).toBe(true)
    await ui.press({ key: 'fil-archive-copy' })
    expect(copied).toBe('local_old1\nlocal_old2')
    expect(await has(ui, /2 id.s. copié/)).toBe(true)
  })
}

test('/veille archiver prints the list from archive.json', async ($, on) => {
  base(on)
  const r = await $.command.run({ command: 'veille', args: 'archiver' })
  const t = JSON.stringify(r)
  expect(t).toContain('À archiver : 2 sur 9')
  expect(t).toContain('Old lane two · beta · pas de PR, terminée, inactive 30 h · local_old2')
})

test('/export-eta is an alias of the Export eta tab only when no mod serves /export-eta', async ($, on) => {
  const w = base(on)
  const registered: string[] = []
  on('command.register', ($, e) => { registered.push(e.name); return { value: { command: e.name } } })
  on('command.list', () => ({ value: [{ name: 'veille', description: '', source: 'plugin', plugin: 'veille' }] }))
  on('session.start', ($, e) => e)
  await $.session.start({ cwd: 'C:/code/app', surface: 'terminal', isInteractive: true } as any)
  await w.clock.advance(5000)
  expect(registered).toContain('export-eta')
  await $.command.run({ command: 'export-eta', args: '' })
  const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface: 'terminal', viewport: { columns: 140, rows: 80 }, props: PANE })
  expect(await has(ui, /4 conversations terminées — Exporter vers eta/)).toBe(true)
})

test('no alias when export-eta already serves /export-eta', async ($, on) => {
  const w = base(on)
  const registered: string[] = []
  on('command.register', ($, e) => { registered.push(e.name); return { value: { command: e.name } } })
  on('command.list', () => ({ value: [{ name: 'export-eta', description: '', source: 'plugin', plugin: 'export-eta' }] }))
  on('session.start', ($, e) => e)
  await $.session.start({ cwd: 'C:/code/app', surface: 'terminal', isInteractive: true } as any)
  await w.clock.advance(5000)
  expect(registered).toContain('veille')
  expect(registered.includes('export-eta')).toBe(false)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the Fil shows the wakes of the Veille with their check and result (${surface})`, async ($, on) => {
    base(on)
    await $.command.run({ command: 'veille', args: 'fil' })
    const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface, viewport: { columns: 140, rows: 80 }, props: PANE })
    expect(await has(ui, /Réveils de la Veille/)).toBe(true)
    expect(await has(ui, /Coordinator · opus-5-5 · medium · acceptEdits · conforme/)).toBe(true)
    expect(await has(ui, /Relaunched lane B/)).toBe(true)
  })

  test(`Alertes: night summary of /veille jour, « Nuit » runs the watcher's nuit (${surface})`, async ($, on) => {
    const w = base(on)
    await $.command.run({ command: 'veille', args: '' })
    const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface, viewport: { columns: 140, rows: 80 }, props: PANE })
    expect(await has(ui, /Bilan de la nuit : 23:00/)).toBe(true)
    expect(await has(ui, /^Nuit$/)).toBe(true)
    const btn = await ui.find({ type: 'Button', text: /^Nuit$/ })
    await ui.press(btn)
    expect(w.runs.some((a) => a[a.length - 1] === 'nuit' && /veille\.mjs$/.test(String(a[a.length - 2])))).toBe(true)
  })
}

test('during the night the pane says since when and offers « Jour »', async ($, on) => {
  base(on, undefined, JSON.stringify({ mode: 'nuit-active', installed: true, night_started: NOW - 120 * MIN }))
  await $.command.run({ command: 'veille', args: '' })
  const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface: 'terminal', viewport: { columns: 140, rows: 80 }, props: PANE })
  expect(await has(ui, /Nuit active depuis \d\d:\d\d/)).toBe(true)
  expect(await has(ui, /^Jour$/)).toBe(true)
})

test('/veille jour runs the watcher and answers with the night summary; /veille nuit runs nuit', async ($, on) => {
  const w = base(on)
  const r = await $.command.run({ command: 'veille', args: 'jour' })
  expect(w.runs.some((a) => a[a.length - 1] === 'jour')).toBe(true)
  expect(JSON.stringify(r)).toContain('Bilan de la nuit')
  await $.command.run({ command: 'veille', args: 'nuit' })
  expect(w.runs.some((a) => a[a.length - 1] === 'nuit')).toBe(true)
})
