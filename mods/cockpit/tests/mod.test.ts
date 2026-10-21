// Hook tests for cockpit with the Claude Code test kit: claude plugin test mods/cockpit
// Fixture scan only (no real data). The scanner, band's scanner and the files are answered by hooks beneath the mod.
import { expect, mock, test } from 'claude-code/testing'

const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const NOW = Date.parse('2026-10-16T16:00:00Z')
const V = [10, 1000, 100000, 1000, 0, 4]
const S = (o: Record<string, unknown>) => ({ model: 'claude-opus-5-5', app_effort: 'medium', ctx: 120000, live: false, last_activity: (NOW - 300000) / 1000,
  models: { 'claude-opus-5-5': V }, days: { [day(NOW)]: { 'claude-opus-5-5': V } }, loops: {}, tools: 4, readonly: 1, subs: [], recent: [], ...o })
const LEAD = S({ cli: 'lead-cli', sid: 'local_lead', app_title: 'Galaxy finalisation autonome', cwd: 'C:/code/eta', live: true })
const CHILD = S({ cli: 'child-cli', sid: 'local_child', parent: 'local_lead', app_title: 'Mosaic Studio V2 private release', cwd: 'C:/code/eta',
  subs: [{ id: 'w1', type: 'coder', model: 'claude-opus-5-5', effort: 'medium', status: 'running', workflow: 'wf_1', desc: 'build', models: { 'claude-opus-5-5': V }, ts: '2026-10-16T15:00:00Z' }] })
const scanFor = (detail: string) => JSON.stringify({ generated: 0, sessions: [LEAD, CHILD], reviews: null,
  detail: detail === 'child-cli' ? { ...CHILD, calls: [{ tool: 'Workflow', runId: 'wf_1', desc: 'package-wave' }], turns: [], events: [], errors: [], guards: [] }
    : { ...LEAD, calls: [], turns: [], events: [], errors: [], guards: [] } })

// usage's classement.json, invented: [hour, sid, kind, model, agent, skill, mcp, in, out, cr, cw5, cw1h, msgs, active, cost]
const CR = (h: number, sid: string, usd: number) => [Math.floor(NOW / 3600000) * 3600000 - h * 3600000, sid, 'main', 'claude-opus-5-5', '', '', '', 1000, 100, 5000, 0, 200, 1, 0, usd]
const CLS = { v: 1, generated: NOW, tzMin: 0, days: 31, sessions: { s1: { t: 'Lane alpha', p: 'proj-one' }, s2: { t: 'Lane beta', p: 'proj-two' } },
  rows: [CR(0, 's1', 4), CR(0, 's2', 1), CR(50, 's2', 20)] }

// usage's debit.json, invented: TPS rows per hour|model|effort [output, ms, streams, {bucket: streams}] and the last hour's streams
const H0 = Math.floor(NOW / 3600000) * 3600000
const DEBIT = { v: 1, generated: NOW, tzMin: 0, days: 32,
  hourly: { [`${H0}|claude-opus-5-5|medium`]: [1200, 20000, 2, { 29: 2 }], [`${H0 - 50 * 3600000}|claude-sonnet-5-5|low`]: [4000, 50000, 3, { 31: 3 }] },
  recent: [{ ts: NOW - 30000, model: 'claude-opus-5-5', effort: 'medium', out: 600, ms: 10000 }], streams: [] }

// scanner/cards.mjs part « depuis », invented
const DEPUIS = { since: NOW - 8 * 3600000, source: 'last', last: { ts: NOW - 8 * 3600000, title: 'Lane alpha', project: 'eta' },
  merged: [{ forge: 'github', repo: 'eta', project: 'eta', number: 7, title: 'feat: night work', url: 'https://example.invalid/7', at: new Date(NOW - 3600000).toISOString() }],
  red: { available: true, generated: NOW, lanes: [] },
  conversations: [{ cli: 'child-cli', sid: 'local_child', title: 'Mosaic Studio V2 private release', project: 'eta', state: 'completed', at: NOW - 3600000, first: 'PR #7 merged.' }],
  problems: [], atoi: { items: [] }, cost: { usd: 14, tokens: 2e6, byProject: { eta: { usd: 14, tokens: 2e6 } } }, night: null }

// scanner/cards.mjs part « graphe »: lib/core/sessions.mjs graphRow rows, invented
const GR = (o: any) => ({ sid: 'local_' + o.cli, title: '', cwd: 'C:/code/eta', origin: 'C:/code/eta', repo: 'eta', archived: false, starred: false,
  last_activity: NOW - 600000, created: NOW - 7200000, model: 'claude-opus-5-5', effort: 'medium', parent: '', peers: [], awaiting: false, prs: [], branch: '', ...o })
const GRAPHE = { rows: [GR({ cli: 'g-lead', title: 'COORD eta' }), GR({ cli: 'g-wait', title: 'Lane waiting', parent: 'local_g-lead', awaiting: true }),
  GR({ cli: 'g-old', title: 'Old lane', last_activity: NOW - 3 * 86400000 }),
  // the scan's child conversation, running a Workflow: it unfolds under its row by default
  GR({ cli: 'child-cli', sid: 'local_child', title: 'Mosaic Studio V2 private release', last_activity: NOW - 60000 })] }

const TREE = { 'C:/code/eta': [['src', 'dir'], ['README.md', 'file']], 'C:/code/eta/src': [['main.ts', 'file']] }

function world(on: any, o: { clock?: boolean; commands?: { name: string; plugin?: string }[]; self?: string; engine?: string; cockpitCfg?: unknown } = {}) {
  const opened: string[] = []
  const ran: unknown[] = []
  const scans: string[] = []
  const argvs: string[][] = []
  const registered: string[] = []
  if (o.clock !== false) on('clock.now', () => ({ value: NOW }))
  on('command.list', () => ({ value: (o.commands ?? [{ name: 'cockpit', plugin: 'cockpit' }]).map((c) => ({ description: '', source: 'plugin', ...c })) }))
  on('command.register', ($: any, e: any) => { registered.push(e.name); return { value: { command: e.name } } })
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  const P = (e: any) => String(e.path).replace(/\\/g, '/') // the kit hands Windows paths with backslashes
  // the Panneau's file tree: an invented folder
  on('session.cwd', () => ({ value: 'C:/code/eta' }))
  on('fs.list', ($: any, e: any) => {
    const kids = (TREE as any)[P(e)]
    if (!kids) throw new Error('ENOENT')
    return { value: kids.map(([name, kind]: [string, string]) => ({ name, kind, size: 1, mtimeMs: NOW - 60000, isLink: false })) }
  })
  on('fs.exists', ($: any, e: any) => ({ value: P(e).startsWith('C:/code/eta/') || /cockpit\.config\.json$|lib\/factory\/factory\.config\.json$|\/usage\/usage\.config\.json$|\/usage-mod\/(classement|debit)\.json$/.test(P(e)) && !P(e).includes('effort-board') }))
  on('fs.read', ($: any, e: any) => ({ value: P(e).endsWith('cockpit.config.json') ? JSON.stringify(o.cockpitCfg ?? {})
    : P(e).endsWith('/usage/usage.config.json') ? JSON.stringify({ data_dir: '~/.claude/usage-mod', node: 'node' })
    : P(e).endsWith('/usage-mod/classement.json') ? JSON.stringify(CLS)
    : P(e).endsWith('/usage-mod/debit.json') ? JSON.stringify(DEBIT)
    : JSON.stringify({ context_window: 400000, rates: { opus: { in: 4, out: 20, cache_read: 0.4, cache_write_5m: 5, cache_write_1h: 8 } }, thresholds: { handoff_tokens: 250000 } }) }))
  on('process.run', ($: any, e: any) => {
    const argv = e.argv as string[]
    argvs.push(argv)
    if (argv[0] === 'git') return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
    if (String((e.init && e.init.stdin) || '').includes('"parts":["graphe"]')) return { value: { exitCode: 0, stdout: JSON.stringify({ graphe: GRAPHE }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (String((e.init && e.init.stdin) || '').includes('"parts":["depuis"]')) return { value: { exitCode: 0, stdout: JSON.stringify({ depuis: DEPUIS }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const i = argv.indexOf('--detail')
    const detail = i >= 0 ? argv[i + 1] : ''
    scans.push(detail)
    return { value: { exitCode: 0, stdout: scanFor(detail), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.stat', ($: any, e: any) => {
    if (!P(e).endsWith('/usage-mod/debit.json')) throw new Error('ENOENT')
    return { value: { kind: 'file', mtimeMs: NOW - 60000, size: 1 } }
  })
  on('session.id', () => ({ value: o.self ?? 'lead-cli' }))
  on('session.version', () => ({ value: { version: o.engine ?? '2.1.302', base: o.engine ?? '2.1.302' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 103000, window: 1000000, percent: 10.3 }, rateLimits: [{ kind: 'five_hour', percentUsed: 21 }, { kind: 'seven_day', percentUsed: 14 }], cost: { usd: 3.2 } } }))
  on('ui.open', ($: any, e: any) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: [{ id: 'cockpit', title: 'Cockpit', isShown: true, isFocused: false, isPlaced: true }] }))
  on('command.run', ($: any, e: any) => { ran.push(e); return { value: {} } })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { opened, ran, scans, argvs, registered }
}

const PANE = { title: 'Cockpit', isFocused: true, bodyColumns: 75, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
// the left menu takes menu.width columns: the long-title checks below use a wider pane
const WIDE = { ...PANE, bodyColumns: 92 }

async function has(ui: any, re: RegExp) {
  return (await ui.find({ type: 'Text', text: re })) !== undefined || (await ui.find({ type: 'Button', text: re })) !== undefined
}

test('opens by itself at session start, on this conversation',async ($, on) => {
  const w = world(on)
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/eta', surface: 'desktop', isInteractive: true } as any)
  expect(w.opened).toContain('cockpit')
})

test('start = off: nothing opens at session start', { options: { start: 'off' } } as any, async ($, on) => {
  const w = world(on)
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/eta', surface: 'desktop', isInteractive: true } as any)
  expect(w.opened).not.toContain('cockpit')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/cockpit opens on this conversation (selected, its section open, the others folded); a click drills down (${surface})`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'cockpit', args: 'home' } as any)
    const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface, viewport: { columns: 100, rows: 80 }, props: WIDE } as any)
    expect(await has(ui, /^Méga$/)).toBe(true)
    expect(await has(ui, /^eta$/)).toBe(true)
    expect(await ui.find({ key: 'crumb-medium' })).toBeDefined() // the breadcrumb ends on this conversation
    expect(await has(ui, /^▾ Cette conversation$/)).toBe(true)
    expect(await has(ui, /^▸ Ce projet · eta$/)).toBe(true)
    expect(await has(ui, /^▸ Tous les projets$/)).toBe(true)
    expect(await has(ui, /^▸ Claude global$/)).toBe(true)
    expect(await has(ui, /Galaxy finalisation autonome \(cette conversation\)/)).toBe(true)
    expect(await has(ui, /Mosaic Studio V2 private release/)).toBe(true)
    expect(await has(ui, /Ouvrir Fichiers/)).toBe(true)
    expect(await has(ui, /Session \(5 h\)/)).toBe(false) // Claude global folded
    expect(await has(ui, /5 h 21 % · sem 14 %/)).toBe(true) // its one-line summary
    await ui.press({ plugin: 'cockpit', key: 'sec-global' })
    expect(await has(ui, /Session \(5 h\)/)).toBe(true)
    await ui.press({ plugin: 'cockpit', key: 'node-c-child-cli' })
    expect(w.scans.at(-1)).toBe('child-cli')
    expect(await has(ui, /^▾ Conversation · Mosaic Studio/)).toBe(true)
    expect(await has(ui, /coder · build/)).toBe(true)
    await ui.press({ plugin: 'cockpit', key: 'sec-all' })
    await ui.press({ plugin: 'cockpit', key: 'proj-eta' })
    expect(await has(ui, /^▾ Ce projet · eta$/)).toBe(true)
    await ui.press({ plugin: 'cockpit', key: 'files' })
    expect(JSON.stringify(w.ran)).toContain('filetree')
  })

  test(`« Qui consomme »: top conversations of a window, preset toggle, button to the full Classement (${surface})`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'cockpit', args: 'home' } as any)
    const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface, viewport: { columns: 100, rows: 80 }, props: WIDE } as any)
    expect(await has(ui, /^▸ Qui consomme$/)).toBe(true)
    expect(await has(ui, /aujourd’hui \$5\.00 · Lane alpha 80 % · proj-one 80 %/)).toBe(true)
    await ui.press({ plugin: 'cockpit', key: 'sec-conso' })
    expect(await has(ui, /^1\. Lane alpha \(proj-one\)$/)).toBe(true)
    await ui.press({ plugin: 'cockpit', key: 'cp-7d' })
    expect(await has(ui, /^1\. Lane beta \(proj-two\)$/)).toBe(true)
    await ui.press({ plugin: 'cockpit', key: 'conso-full' })
    expect(JSON.stringify(w.ran)).toContain('"command":"conso"')
    expect(JSON.stringify(w.ran)).toContain('classement')
  })
}

test('/factory and /machine: aliases of cockpit only when their own mod is not loaded', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, { clock: false })
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/eta', surface: 'desktop', isInteractive: true } as any)
  await clock.advance(5000)
  expect(w.registered).toContain('factory')
  expect(w.registered).toContain('machine')
  await $.command.run({ command: 'factory', args: 'workflow all' } as any)
  expect(w.opened).toContain('cockpit')
  expect(w.argvs.some((a) => a.some((x) => /workflow_scan\.py$/.test(x)) && a.includes('--all'))).toBe(true)
  expect(JSON.stringify(w.ran)).not.toContain('"command":"factory"')
})

test('/factory with the factory mod loaded: cockpit registers nothing and passes the command on', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, { clock: false, commands: [{ name: 'cockpit', plugin: 'cockpit' }, { name: 'factory', plugin: 'factory' }, { name: 'machine', plugin: 'machine' }] })
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/eta', surface: 'desktop', isInteractive: true } as any)
  await clock.advance(5000)
  expect(w.registered).not.toContain('factory')
  expect(w.registered).not.toContain('machine')
  await $.command.run({ command: 'factory', args: 'mission' } as any)
  expect(JSON.stringify(w.ran)).toContain('"command":"factory"')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`cards: the CI card's button runs /ci diagramme when /reference is not loaded; tabs switch in the same pane (${surface})`, async ($, on) => {
    const w = world(on, { commands: [{ name: 'cockpit' }, { name: 'ci', plugin: 'ci' }] })
    await $.command.run({ command: 'cockpit', args: 'home' } as any)
    const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface, viewport: { columns: 80, rows: 120 }, props: PANE } as any)
    expect(await has(ui, /^Problèmes du jour$/)).toBe(true)
    expect(await has(ui, /^En cours$/)).toBe(true)
    await ui.press({ plugin: 'cockpit', key: 'card-btn-ci' })
    expect(JSON.stringify(w.ran)).toContain('"command":"ci","args":"diagramme"')
    await ui.press({ plugin: 'cockpit', key: 'tab-mission' })
    expect(await has(ui, /^▸ Ce projet/)).toBe(false) // another tab: the scoped sections are gone
    expect(await has(ui, /Quotas|Système/)).toBe(false)
    await ui.press({ plugin: 'cockpit', key: 'tab-home' })
    expect(await has(ui, /^▸ Ce projet · eta$/)).toBe(true)
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`left menu, Nuit / Jour / Codex: buttons run the other hubs' and Veille's commands, Lancer never runs one (${surface})`, async ($, on) => {
    const w = world(on, { commands: [{ name: 'cockpit' }, { name: 'veille', plugin: 'veille' }, { name: 'jauge', plugin: 'band' }] })
    await $.command.run({ command: 'cockpit', args: 'home' } as any)
    const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface, viewport: { columns: 80, rows: 120 }, props: PANE } as any)
    for (const label of ['Jauge', 'Cockpit', 'Veille', 'À toi', 'Registres', 'Référence']) expect(await has(ui, new RegExp(`^${label}$`))).toBe(true)
    await ui.press({ plugin: 'cockpit', key: 'menu-2' })
    expect(JSON.stringify(w.ran)).toContain('"command":"veille"')
    await ui.press({ plugin: 'cockpit', key: 'menu-4' }) // Registres: not loaded here, a toast and nothing run
    expect(JSON.stringify(w.ran)).not.toContain('registres')
    // Claude only by default, Codex on demand
    expect(await has(ui, /^Codex$/)).toBe(true)
    await ui.press({ plugin: 'cockpit', key: 'btn-codex' })
    expect(await has(ui, /^Codex ✓$/)).toBe(true)
    // Jour on the Cockpit tab, Nuit opens the decision screen
    await ui.press({ plugin: 'cockpit', key: 'btn-jour' })
    expect(JSON.stringify(w.ran)).toContain('"command":"veille","args":"jour"')
    await ui.press({ plugin: 'cockpit', key: 'btn-nuit' })
    expect(await has(ui, /^Bilan avant la nuit$/)).toBe(true)
    expect(await has(ui, /^Que fait la nuit \?$/)).toBe(true)
    const before = w.ran.length
    await ui.press({ plugin: 'cockpit', key: 'n-on' })
    expect(JSON.stringify(w.ran.slice(before))).toContain('"command":"veille","args":"nuit"')
    await ui.press({ plugin: 'cockpit', key: 'n-nothing' })
    expect(await has(ui, /^▸ Ce projet · eta$/)).toBe(true) // back on the Cockpit tab
  })
}

test('/cockpit relais and /cockpit galerie open the Claude ↔ Codex and Galerie tabs', async ($, on) => {
  world(on)
  await $.command.run({ command: 'cockpit', args: 'relais' } as any)
  const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface: 'desktop', viewport: { columns: 80, rows: 80 }, props: PANE } as any)
  expect(await has(ui, /\/ci relais refresh/)).toBe(true)
  await ui.press({ plugin: 'cockpit', key: 'tab-galerie' })
  expect(await has(ui, /^Équipe$/)).toBe(true)
  expect(await has(ui, /^Lead · Galaxy finalisation autonome/)).toBe(true)
  await ui.press({ plugin: 'cockpit', key: 'g-v-carte' })
  expect(await has(ui, /^Carte du contrôle$/)).toBe(true)
})

test('Galerie: Lanes, Séquence and Doux / dur views; « Ouvrir l’agent » on a running agent of this conversation runs $.ui.view', async ($, on) => {
  const w = world(on, { self: 'child-cli' })
  const views: unknown[] = []
  on('ui.view', ($: any, e: any) => { views.push(e); return { value: {} } })
  await $.command.run({ command: 'cockpit', args: 'galerie' } as any)
  const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface: 'desktop', viewport: { columns: 92, rows: 120 }, props: WIDE } as any)
  await ui.press({ plugin: 'cockpit', key: 'g-v-lanes' })
  expect(await has(ui, /^Lanes de eta/)).toBe(true)
  expect(await has(ui, /aucun relecteur/)).toBe(true)
  await ui.press({ plugin: 'cockpit', key: 'g-v-sequence' })
  expect(await has(ui, /^Séquence · Mosaic Studio/)).toBe(true)
  await ui.press({ plugin: 'cockpit', key: 'g-v-concept' })
  expect(await has(ui, /^Contrôle doux \/ dur/)).toBe(true)
  await $.command.run({ command: 'cockpit', args: 'conv' } as any)
  await ui.press({ plugin: 'cockpit', key: 'node-a-w1' })
  await ui.press({ plugin: 'cockpit', key: 'agent-open' })
  expect(views).toEqual([{ agentId: 'w1' }])
  expect(w.scans.length > 0).toBe(true)
})

test('« Ouvrir l’agent » stays off on an engine older than 2.1.300', async ($, on) => {
  world(on, { self: 'child-cli', engine: '2.1.293' })
  await $.command.run({ command: 'cockpit', args: 'conv' } as any)
  const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface: 'desktop', viewport: { columns: 92, rows: 120 }, props: WIDE } as any)
  await ui.press({ plugin: 'cockpit', key: 'node-a-w1' })
  expect(await has(ui, /^Agent · coder/)).toBe(true)
  expect(await has(ui, /Ouvrir l’agent/)).toBe(false)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`« Depuis ton dernier message »: button and /cockpit depuis 8h, headline, groups, VEILLE text shown and never sent (${surface})`, async ($, on) => {
    const w = world(on, { commands: [{ name: 'cockpit' }, { name: 'veille', plugin: 'veille' }] })
    await $.command.run({ command: 'cockpit', args: 'home' } as any)
    const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface, viewport: { columns: 92, rows: 160 }, props: WIDE } as any)
    expect(await has(ui, /^Depuis ton dernier message$/)).toBe(true)
    await ui.press({ plugin: 'cockpit', key: 'btn-depuis' })
    expect(await has(ui, /^Depuis \d\d:\d\d \(8 h\) : 1 PR mergée, 1 conversation terminée, 14 \$ dépensés$/)).toBe(true)
    expect(await has(ui, /ton dernier message : .* dans « Lane alpha »/)).toBe(true)
    expect(await has(ui, /eta#7 feat: night work/)).toBe(true)
    expect(await has(ui, /PR #7 merged\./)).toBe(true)
    const before = w.ran.length
    await ui.press({ plugin: 'cockpit', key: 'd-ask' })
    expect(await has(ui, /^VEILLE : résume-moi ce qui s’est passé depuis/)).toBe(true)
    expect(w.ran.length).toBe(before) // shown, never sent
    await ui.press({ plugin: 'cockpit', key: 'd-g-0' }) // fold the project
    expect(await has(ui, /eta#7 feat: night work/)).toBe(false)
    // the preset reaches the scanner
    await $.command.run({ command: 'cockpit', args: 'depuis 8h' } as any)
    expect(w.argvs.some((a) => a.join(' ').includes('cards.mjs'))).toBe(true)
  })
}

// ---- the Panneau (default view): one scrolling column, no tab bar; macro rows, details one click away ----------------

for (const surface of ['terminal', 'desktop'] as const) {
  for (const columns of [60, 75]) {
    test(`Panneau by default: the macro view (Fichiers folded, this conversation, conversations, Quotas, Débit, Graphe one line each); no tab bar (${surface}, ${columns} col.)`, async ($, on) => {
      world(on)
      mock.store(on)
      await $.command.run({ command: 'cockpit', args: '' } as any)
      const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface, viewport: { columns, rows: 200 }, props: { ...PANE, bodyColumns: columns } } as any)
      for (const re of [/^▸ Fichiers$/, /^CETTE CONVERSATION$/, /^CONVERSATIONS$/, /^QUOTAS$/, /^DÉBIT$/, /^GRAPHE$/]) expect(await has(ui, re)).toBe(true)
      for (const re of [/^Panneau$/, /^Plus ▾$/, /^Mission$/, /^Cockpit$/, /^Registres$/, /^Workflows actifs$/]) expect(await has(ui, re)).toBe(false) // no tab bar, no left menu, no duplicate block
      expect(await has(ui, /^Autres vues : \/cockpit cartes · mission/)).toBe(true)
      // Fichiers: folded by default (Julian, 17 Oct); unfolded, the cwd's first level, a folder opens on a click
      expect(await has(ui, /▸ src/)).toBe(false)
      await ui.press({ plugin: 'cockpit', key: 'p-sec-fichiers' })
      expect(await has(ui, /▸ src/)).toBe(true)
      await ui.press({ plugin: 'cockpit', key: 'f-C:/code/eta/src' })
      expect(await has(ui, /· main\.ts/)).toBe(true)
      // this conversation: its node and metrics lines (title, context %); its card only on « détails », no box drawing
      expect(await has(ui, /^Galaxy fin/)).toBe(true) // its title, cut first at 60 columns
      expect(await has(ui, /^10 %$/)).toBe(true)
      expect(await has(ui, /^Cache hit$/)).toBe(false)
      expect(await has(ui, /[╭╮╰╯]/)).toBe(false)
      await ui.press({ plugin: 'cockpit', key: 'pdetails' }) // « détails › » on its metrics line (its › folds its children)
      expect(await has(ui, /^Contexte$/)).toBe(true)
      expect(await has(ui, /^103K \/ 1\.0M · relais 250K$/)).toBe(true)
      expect(await has(ui, /^Cache hit$/)).toBe(true)
      // the conversations: invented classement, one line each; Quotas: the engine's 5 h figure on its line, the bars on a click
      expect(await has(ui, /^Lane beta|^Lane alpha/)).toBe(true)
      expect(await has(ui, /^21 %$/)).toBe(true)
      expect(await has(ui, /^Session 5 h$/)).toBe(false)
      await ui.press({ plugin: 'cockpit', key: 'p-sec-barres' })
      expect(await has(ui, /^Session 5 h$/)).toBe(true)
      expect(await has(ui, /^Codex semaine$/)).toBe(false) // only while Codex is toggled
      // an old view by its command; its tab row brings the Panneau back
      await $.command.run({ command: 'cockpit', args: 'mission' } as any)
      expect(await has(ui, /^Mission$/)).toBe(true)
      await ui.press({ plugin: 'cockpit', key: 'tab-panneau' })
      expect(await has(ui, /^GRAPHE$/)).toBe(true)
      expect(await has(ui, /^Mission$/)).toBe(false)
    })
  }
}

test('Panneau: a Workflow is a tree node under its conversation, unfolds to its agents; folds are kept in $.store', async ($, on) => {
  world(on, { self: 'child-cli' })
  const kept: Record<string, unknown> = {}
  on('store.get', ($: any, e: any) => ({ value: kept[e.key] }))
  on('store.set', ($: any, e: any) => { kept[e.key] = e.value; return { value: undefined } })
  await $.command.run({ command: 'cockpit', args: '' } as any)
  const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface: 'desktop', viewport: { columns: 75, rows: 200 }, props: PANE } as any)
  // macro: « └──── ◇ package-wave  workflow  › » (typed bullet, grey type word), its metrics « 0/1 ● · … », and its
  // running agent always listed under it without unfolding (Julian, 21 Oct); no phases table, no tokens line
  expect(await has(ui, /^package-wave$/)).toBe(true)
  expect(await has(ui, /^workflow$/)).toBe(true)
  expect(await has(ui, /^◇$/)).toBe(true)
  expect(await has(ui, /└────\s*$/)).toBe(true) // 6-column indents at 75 columns (Julian, 20 Oct)
  expect(await has(ui, /^0\/1$/)).toBe(true)
  expect(await has(ui, /^Phases$/)).toBe(false)
  expect(await has(ui, /^coder · build/)).toBe(true)
  expect(await has(ui, / tokens /)).toBe(false)
  await ui.press({ plugin: 'cockpit', key: 'pk-pfw-wf_1-t' })
  // unfolded: its tokens, cost and time, its agents as children, one line each, never « general-purpose »
  expect(await has(ui, / tokens /)).toBe(true)
  expect(await has(ui, /^coder · build/)).toBe(true)
  expect(await has(ui, /general-purpose/)).toBe(false)
  expect(JSON.stringify(kept.panel)).toContain('"pfw-wf_1":false') // opened
  await ui.press({ plugin: 'cockpit', key: 'pk-pfw-wf_1-t' })
  expect(await has(ui, / tokens /)).toBe(false)
  expect(JSON.stringify(kept.panel)).toContain('"pfw-wf_1":true') // closed
})

test('Fichiers: a clicked file goes along with the next prompt as filetree’s context line, cleared by Effacer', async ($, on) => {
  world(on)
  mock.store(on)
  on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
  await $.command.run({ command: 'cockpit', args: '' } as any)
  const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface: 'desktop', viewport: { columns: 75, rows: 160 }, props: PANE } as any)
  const ask = async () => JSON.stringify(await $.prompt.submit({ text: 'what is this?', wait: false } as any))
  expect(await ask()).not.toContain('selected in the file tree')
  await ui.press({ plugin: 'cockpit', key: 'p-sec-fichiers' })
  await ui.press({ plugin: 'cockpit', key: 'f-C:/code/eta/README.md' })
  expect(await has(ui, /^sélection : README\.md$/)).toBe(true)
  const sent = await ask()
  expect(sent).toContain('selected in the file tree')
  expect(sent).toContain('C:/code/eta/README.md')
  await ui.press({ plugin: 'cockpit', key: 'f-clear' })
  expect(await ask()).not.toContain('selected in the file tree')
})

test('Fichiers: attach_selection false keeps the selection visual only', async ($, on) => {
  const w = world(on, { cockpitCfg: { panel: { fichiers: { attach_selection: false } } } })
  mock.store(on)
  on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
  await $.command.run({ command: 'cockpit', args: '' } as any)
  const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface: 'desktop', viewport: { columns: 75, rows: 160 }, props: PANE } as any)
  await ui.press({ plugin: 'cockpit', key: 'p-sec-fichiers' })
  await ui.press({ plugin: 'cockpit', key: 'f-C:/code/eta/README.md' })
  expect(await has(ui, /non envoyée/)).toBe(true)
  expect(JSON.stringify(await $.prompt.submit({ text: 'x', wait: false } as any))).not.toContain('selected in the file tree')
  expect(w.opened).toContain('cockpit')
})

test('Panneau: sections unfold and stay unfolded (kept in $.store), filters behind « filtres » cycle, Claude / Codex', async ($, on) => {
  world(on)
  const kept: Record<string, unknown> = {}
  on('store.get', ($: any, e: any) => ({ value: kept[e.key] }))
  on('store.set', ($: any, e: any) => { kept[e.key] = e.value; return { value: undefined } })
  await $.command.run({ command: 'cockpit', args: '' } as any)
  const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface: 'desktop', viewport: { columns: 75, rows: 160 }, props: PANE } as any)
  expect(await has(ui, /^▸ Fichiers$/)).toBe(true) // folded by default
  await ui.press({ plugin: 'cockpit', key: 'p-sec-fichiers' })
  expect(await has(ui, /^▾ Fichiers$/)).toBe(true)
  expect(JSON.stringify(kept.panel)).toContain('"fichiers":true')
  expect(JSON.stringify(kept.panel)).toContain('"v":3')
  await ui.press({ plugin: 'cockpit', key: 'p-sec-barres' })
  expect(await has(ui, /^Session 5 h$/)).toBe(true)
  expect(JSON.stringify(kept.panel)).toContain('"barres":true')
  // the filters: behind « filtres › », one compact row, each button cycles (aujourd'hui ▾ -> 7 j ▾)
  expect(await has(ui, /^aujourd’hui ▾$/)).toBe(false)
  await ui.press({ plugin: 'cockpit', key: 'pconvs-f' })
  await ui.press({ plugin: 'cockpit', key: 'pf-period' })
  expect(await has(ui, /^7 j ▾$/)).toBe(true)
  expect(await has(ui, /^Lane beta/)).toBe(true)
  await ui.press({ plugin: 'cockpit', key: 'pf-project' })
  expect(await has(ui, /^proj-one ▾$/)).toBe(true)
  await ui.press({ plugin: 'cockpit', key: 'pf-state' })
  expect(await has(ui, /^en cours ▾$/)).toBe(true)
  await ui.press({ plugin: 'cockpit', key: 'pf-who' })
  expect(await has(ui, /^Codex ▾$/)).toBe(true)
  expect(JSON.stringify(kept.panel)).toContain('"who":"codex"')
})

test('Panneau: Débit is one line after Quotas (the models in use), its tables and the last streams on a click; its fold is kept', async ($, on) => {
  world(on)
  const kept: Record<string, unknown> = {}
  on('store.get', ($: any, e: any) => ({ value: kept[e.key] }))
  on('store.set', ($: any, e: any) => { kept[e.key] = e.value; return { value: undefined } })
  await $.command.run({ command: 'cockpit', args: '' } as any)
  const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface: 'desktop', viewport: { columns: 75, rows: 160 }, props: PANE } as any)
  expect(await has(ui, /^DÉBIT$/)).toBe(true)
  expect(await has(ui, /^opus 60 TPS \(30 min\)$/)).toBe(true) // the last 30 min, weighted
  expect(await has(ui, /^Modèle : opus 5\.5$/)).toBe(false)
  await ui.press({ plugin: 'cockpit', key: 'p-sec-debit' })
  expect(await has(ui, /^Modèle : opus 5\.5$/)).toBe(true)
  expect(await has(ui, /^Modèle : sonnet 5\.5$/)).toBe(true)
  expect(await has(ui, /^60\.0 TPS$/)).toBe(true) // the last stream: 600 tok in 10 s
  expect(await has(ui, /message\.id \+ requestId/)).toBe(false) // how time is measured: one click further
  await ui.press({ plugin: 'cockpit', key: 'pd-how' })
  expect(await has(ui, /message\.id \+ requestId/)).toBe(true)
  expect(JSON.stringify(kept.panel)).toContain('"debit":true')
})

test('Panneau: a save from before v3 (sections kept unfolded) opens on the macro view with Fichiers folded', async ($, on) => {
  world(on)
  const kept: Record<string, unknown> = { panel: { v: 2, open: { fichiers: true, conv: true, convs: true, barres: true, debit: true, graphe: true }, closed: {}, filter: {} } }
  on('store.get', ($: any, e: any) => ({ value: kept[e.key] }))
  on('store.set', ($: any, e: any) => { kept[e.key] = e.value; return { value: undefined } })
  await $.command.run({ command: 'cockpit', args: '' } as any)
  const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface: 'desktop', viewport: { columns: 75, rows: 160 }, props: PANE } as any)
  expect(await has(ui, /^▾ Fichiers$/)).toBe(true) // a v2 save of Fichiers was the viewer's own
  expect(await has(ui, /^CETTE CONVERSATION$/)).toBe(true)
  expect(await has(ui, /^Session 5 h$/)).toBe(false)
  expect(await has(ui, /^Modèle : opus 5\.5$/)).toBe(false)
})

test('Panneau: À toi de cliquer at the top; the graph on a click shows the tree, keeps its filters, lists every active conversation', async ($, on) => {
  const w = world(on)
  const kept: Record<string, unknown> = {}
  on('store.get', ($: any, e: any) => ({ value: kept[e.key] }))
  on('store.set', ($: any, e: any) => { kept[e.key] = e.value; return { value: undefined } })
  await $.command.run({ command: 'cockpit', args: '' } as any)
  const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface: 'desktop', viewport: { columns: 75, rows: 400 }, props: { ...PANE, scroll: { offset: 0, bodyRows: 400 } } } as any)
  expect(await has(ui, /^◆ À toi de cliquer :$/)).toBe(true)
  expect(await has(ui, /^Lane waiting$/)).toBe(true)
  expect(await has(ui, /^4 conv · 1 coord · 1 t’attend/)).toBe(true) // this conversation has no session file: drawn from the scan
  expect(await has(ui, /^eta · 4$/)).toBe(false) // the tree only on a click
  await ui.press({ plugin: 'cockpit', key: 'p-sec-graphe' })
  expect(await has(ui, /^eta · 4$/)).toBe(true)
  expect(await has(ui, /^aucune conversation avec ces filtres$/)).toBe(false)
  expect(await has(ui, /^◆$/)).toBe(true)
  expect(await has(ui, /^○$/)).toBe(true)
  expect(await has(ui, /^coord$/)).toBe(true)
  expect(await has(ui, /· coordinateur/)).toBe(false)
  expect(await has(ui, /^travaille$/)).toBe(true) // the legend, one line of marks
  expect(await has(ui, /^Old lane ›$/)).toBe(false)
  await ui.press({ plugin: 'cockpit', key: 'pg-f-period' }) // 24 h -> 7 j
  await ui.press({ plugin: 'cockpit', key: 'pg-f-period' }) // 7 j -> tout
  expect(await has(ui, /^Old lane ›$/)).toBe(true)
  expect(JSON.stringify(kept.panel)).toContain('"period":"tout"')
  await ui.press({ plugin: 'cockpit', key: 'pgw-g-wait' })
  // the link goes to the OS handler asynchronously (openUrl)
  for (let i = 0; i < 20 && !w.argvs.some((a) => a.join(' ').includes('epitaxy')); i++) await new Promise((r) => setTimeout(r, 25))
  expect(w.argvs.some((a) => a.join(' ').includes('claude://claude.ai/epitaxy/local_g-wait'))).toBe(true)
})

test('Panneau: a conversation of the graph unfolds under its row with its Workflow card on a click (kept), « ouvrir ↗ » opens it', async ($, on) => {
  const w = world(on)
  const kept: Record<string, unknown> = {}
  on('store.get', ($: any, e: any) => ({ value: kept[e.key] }))
  on('store.set', ($: any, e: any) => { kept[e.key] = e.value; return { value: undefined } })
  await $.command.run({ command: 'cockpit', args: '' } as any)
  const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface: 'desktop', viewport: { columns: 75, rows: 400 }, props: { ...PANE, scroll: { offset: 0, bodyRows: 400 } } } as any)
  await ui.press({ plugin: 'cockpit', key: 'p-sec-graphe' })
  // folded by default (macro), unfolded by a click on its title
  expect(await has(ui, /^Mosaic Studio V2 private release ›$/)).toBe(true)
  await ui.press({ plugin: 'cockpit', key: 'pgl-child-cli' })
  expect(await has(ui, /^Mosaic Studio V2 private release ⌄$/)).toBe(true)
  expect(await has(ui, /^Opus 5\.5 · medium · /)).toBe(true)
  expect(await has(ui, /^wf_1 ›$/)).toBe(true)
  expect(await has(ui, /^│$/)).toBe(true) // the thin rule down its left
  expect(JSON.stringify(kept.panel)).toContain('"cv:child-cli":false')
  expect(await has(ui, /^COORD eta ›$/)).toBe(true)
  await ui.press({ plugin: 'cockpit', key: 'pgo-child-cli' })
  for (let i = 0; i < 20 && !w.argvs.some((a) => a.join(' ').includes('local_child')); i++) await new Promise((r) => setTimeout(r, 25))
  expect(w.argvs.some((a) => a.join(' ').includes('claude://claude.ai/epitaxy/local_child'))).toBe(true)
})
