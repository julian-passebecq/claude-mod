// band mod with the Claude Code test kit: claude plugin test mods/band
// The scanner is mocked ($.process.run answers a view built from fixture events); no transcript is read.
import { expect, mock, test } from 'claude-code/testing'

import { buildView } from '../hooks/logic'
import { SHIPPED } from './shipped'

const CFG = JSON.parse(SHIPPED)
const NOW = Date.parse('2026-10-16T12:00:00Z')
const ev = (sAgo: number, s: string, tokens: number, extra: Record<string, string> = {}) => ({
  t: NOW - sAgo * 1000,
  s,
  m: 'claude-opus-5-5',
  u: { inp: tokens, cw: 0, cr: 0, out: 0 },
  ...extra,
})

// opts.julian / opts.todo: the counters the scanner computed with lib/core/veille.mjs (view.waiting); opts.config: the
// person's own settings file (userConfig 'config') at C:/Users/me/band.json.
function world(on: any, opts: { week?: boolean; tokens?: number; resume?: boolean; stored?: unknown; julian?: number; todo?: number; config?: unknown; extra?: Record<string, unknown>; limits?: { kind: string; percentUsed: number }[]; encours?: unknown } = {}) {
  const tokens = opts.tokens ?? 164000
  const clock = mock.clock(on, { now: NOW } as any)
  const runs: string[][] = []
  const statuses: (string | undefined)[] = []
  const sessions = {
    me: { s: 'me', cwd: 'C:/code/app/.claude/worktrees/band', title: 'LANE BAND', last: NOW, ctx: 164000, compactions: [{ t: NOW - 300000, trigger: 'auto', pre: 368000, post: 17000 }], samples: [] },
    other: { s: 'other', cwd: 'C:/code/web', title: 'WEB', last: NOW, compactions: [], samples: [] },
  }
  const built = buildView([ev(10, 'me', 7200), ev(20, 'me', 120000, { a: 'x' }), ev(30, 'other', 60000)], sessions as any, CFG, {
    now: NOW,
    session: 'me',
    cwd: 'C:/code/app/.claude/worktrees/band',
  })
  const view = { ...built, ...(opts.extra ?? {}), waiting: { aToi: opts.todo ?? 0, julian: opts.julian ?? 0, available: true, aToiAvailable: opts.todo !== undefined } }
  const opened: string[] = []
  const closed: string[] = []
  const stored: Record<string, unknown> = { ...(opts.stored ? { sections: opts.stored } : {}) }
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : e.name === 'CLAUDE_EFFORT' ? 'medium' : undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('store.get', ($: any, e: any) => ({ value: stored[e.key] }))
  on('store.set', ($: any, e: any) => ((stored[e.key] = e.value), { value: undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p.endsWith('/band.config.json')) return { value: SHIPPED }
    if (opts.config && p === 'C:/Users/me/band.json') return { value: JSON.stringify(opts.config) }
    if (opts.resume && p === 'C:/code/app/handoff/RESUME.md') return { value: '# RESUME fixture\n\n- tâche ouverte' }
    throw new Error('ENOENT')
  })
  on('fs.stat', ($: any, e: any) => {
    if (opts.resume && String(e.path).replace(/\\/g, '/') === 'C:/code/app/handoff/RESUME.md') {
      return { value: { kind: 'file', size: 40, mtimeMs: NOW - 3 * 3600000, isLink: false } }
    }
    throw new Error('ENOENT')
  })
  // scanner/encours.mjs (the « en cours » rows) answers opts.encours, else nothing runs; runs lists scan.mjs only
  on('process.run', ($: any, e: any) =>
    /encours.mjs$/.test(String(e.argv[1]))
      ? { value: { exitCode: 0, stdout: JSON.stringify(opts.encours ?? { workflows: [], agents: [] }), stderr: '' } }
      : (runs.push([...e.argv]), { value: { exitCode: 0, stdout: JSON.stringify(view), stderr: '' } }),
  )
  on('session.id', () => ({ value: 'me' }))
  on('session.cwd', () => ({ value: 'C:/code/app/.claude/worktrees/band' }))
  on('session.usage', ($: any, e: any) => ({
    value: {
      startedAt: NOW - 3600000,
      context: { tokens, window: 400000, percent: Math.round((tokens * 100) / 400000), ...(e?.breakdown ? { breakdown: { autoCompactThreshold: 368000, isAutoCompactEnabled: true } } : {}) },
      rateLimits: opts.limits ?? (opts.week === false ? [] : [{ kind: 'seven_day', percentUsed: 37 }]),
    },
  }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($: any, e: any) => (opened.push(String(e.id)), { value: { isPlaced: true } }))
  on('ui.close', ($: any, e: any) => (closed.push(String(e.id)), { value: undefined }))
  on('ui.status', ($: any, e: any) => (statuses.push(e.text), { value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { runs, statuses, stored, opened, closed, clock }
}

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 150, scroll: { offset: 0, bodyRows: 10 } }
const PANE = { title: 'Jauge', isFocused: true, bodyColumns: 150, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } as const

const COMPACT = { gauge: { style: 'compact' } }
const at = (columns: number) => ({ ...BAND, bodyColumns: columns })
// the Jauge's rows of figures (Box jauge-r0, jauge-r1) and the Texts drawn inside one
const jaugeRows = async (band: any) => ((await band.findAll({ type: 'Box' })) as any[]).filter(b => /^jauge-r\d$/.test(String(b.key)))
const textsIn = (n: any, out: any[] = []): any[] => {
  for (const ch of n?.children ?? []) if (ch && typeof ch === 'object') (ch.type === 'Text' && out.push(ch), textsIn(ch, out))
  return out
}

const HUBS = { launcher: { preset: 'hubs' } }
const OWN = { options: { config: 'C:/Users/me/band.json' } } as any
const FIVE_CMDS = [
  { name: 'jauge', description: '', source: 'plugin', plugin: 'band' },
  { name: 'usage', description: '', source: 'builtin' },
  { name: 'reference', description: '', source: 'plugin', plugin: 'reference' },
  { name: 'cockpit', description: '', source: 'plugin', plugin: 'cockpit' },
  { name: 'export-tout', description: '', source: 'plugin', plugin: 'export-eta' },
]

// The Jauge (default, Julian 17 Oct): ONE line (attendent · contexte · 5 h · sem · tok/s) and five buttons.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`/jauge scans; the Jauge: one line of figures and the five buttons, nothing else above the prompt (${surface})`, async ($, on) => {
    const w = world(on)
    on('command.list', () => ({ value: FIVE_CMDS }))
    const r = await $.command.run({ command: 'jauge', args: '' } as any)
    expect(w.runs.length).toBe(1)
    expect(w.runs[0][1]).toMatch(/scanner\/scan\.mjs$/)
    expect(r.text).toMatch(/ctx 41 % \(164 k\) · compact à 92 % · reste 51 %/)
    const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface, viewport: { columns: 160, rows: 40 }, props: BAND } as any)
    expect(await band.find({ type: 'Text', text: /◆|attendent/ })).toBeUndefined() // hidden when nothing waits
    expect(await band.find({ type: 'Text', text: 'ctx ' })).toBeDefined()
    const ctxPct = await band.find({ type: 'Text', text: ' 41 %' })
    expect((ctxPct as any).props.color).toBe('success') // 41 % of a 400 k window, relay at 62.5 %: green
    expect(await band.find({ type: 'Text', text: ' 37 %' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: '3.1k tok/s' })).toBeDefined()
    if (surface === 'terminal') {
      expect(await band.find({ type: 'Text', text: '▰▰▱▱▱' })).toBeDefined()
      expect(await band.find({ type: 'Svg' })).toBeUndefined()
    } else {
      expect(((await band.findAll({ type: 'Svg' })) as any[]).length).toBe(2) // ctx and sem as thin bars
      expect(await band.find({ type: 'Text', text: /▰|▱/ })).toBeUndefined()
    }
    expect(await band.find({ type: 'Text', text: /à toi|agents|conv actives|CPU/ })).toBeUndefined()
    const labels = ((await band.findAll({ type: 'Button' })) as any[]).map(b => b.text)
    expect(labels).toEqual(['Usage', 'Règles', 'Réf', 'Cockpit', 'Exporter'])
    expect(await band.find({ type: 'Text', text: /engine/ })).toBeUndefined() // other mods' rows are left out
    expect(await band.find({ type: 'Text', text: /Passation|relais/ })).toBeUndefined()
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'band', component: 'Pane', requestId: 'jauge', surface, viewport: { columns: 160, rows: 120 }, props: PANE } as any)
    expect(await pane.find({ type: 'Text', text: /seuil d'auto-compact 368 k \(92 %\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /> LANE BAND/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /au repos|auto 368 k→17 k/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /▲/ })).toBeDefined()
    await pane.unmount()
  })
}

test('Jauge: 5 h and week from the engine; red only when something waits', async ($, on) => {
  world(on, { julian: 2, todo: 4, extra: { codex: { week: 30 }, machine: { cpu: 12, gpu: 3 } }, limits: [{ kind: 'five_hour', percentUsed: 24 }, { kind: 'seven_day', percentUsed: 14 }] })
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: at(200) } as any)
  const waiting = await band.find({ type: 'Text', text: '◆ 2' })
  expect(waiting).toBeDefined()
  expect((waiting as any).props.color).toBe('warning') // a short amber counter
  expect(await band.find({ type: 'Text', text: '5 h ' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: ' 24 %' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: ' 14 %' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Codex|CPU|GPU/ })).toBeUndefined()
  await band.unmount()
})

for (const columns of [50, 75]) {
  test(`Jauge at ${columns} columns: the figures fit (wrapped onto a second row when needed), the buttons go on a row below`, async ($, on) => {
    world(on, { julian: 12, limits: [{ kind: 'five_hour', percentUsed: 24 }, { kind: 'seven_day', percentUsed: 14 }] })
    on('command.list', () => ({ value: FIVE_CMDS }))
    await $.command.run({ command: 'jauge', args: '' } as any)
    const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns, rows: 40 }, props: at(columns) } as any)
    const rows = await jaugeRows(band)
    const row = (r: number) => (rows[r] ? textsIn(rows[r]).filter(t => t.props?.bold && t.props?.color !== 'error').map(t => (t.children ?? []).join('')).join('') : '')
    expect(row(0).length > 0).toBe(true)
    expect(/^◆ 12( │ ctx ▰▰▱▱▱ 41 ?%)?/.test(row(0))).toBe(true)
    expect(/ctx ▰▰▱▱▱ 41 ?%/.test(row(0) + row(1))).toBe(true)
    for (const r of [0, 1]) expect([...row(r)].length <= columns).toBe(true)
    expect(((await band.findAll({ type: 'Button' })) as any[]).length).toBe(5)
    await band.unmount()
  })
}

test('five buttons: Usage runs the built-in /usage (no ✕), Règles and Réf open the reference mod, Cockpit toggles', async ($, on) => {
  world(on)
  const ran: string[] = []
  on('command.list', () => ({ value: FIVE_CMDS }))
  for (const command of ['usage', 'reference', 'cockpit']) on('command.run', { command }, ($: any, e: any) => (ran.push(`${command} ${e.args ?? ''}`.trim()), {}))
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: at(200) } as any)
  await band.press({ key: 'mod-usage' })
  await band.press({ key: 'mod-usage' })
  expect(ran).toEqual(['usage', 'usage'])
  expect(await band.find({ type: 'Button', text: 'Usage ✕' })).toBeUndefined()
  await band.press({ key: 'mod-reference-config' })
  expect(ran.at(-1)).toBe('reference config')
  expect(await band.find({ type: 'Button', text: 'Règles ✕' })).toBeDefined()
  await band.press({ key: 'mod-reference-guide' })
  expect(ran.at(-1)).toBe('reference guide')
  expect(await band.find({ type: 'Button', text: 'Réf ✕' })).toBeDefined()
  await band.press({ key: 'mod-cockpit' })
  expect(ran.at(-1)).toBe('cockpit')
  expect(await band.find({ type: 'Button', text: 'Cockpit ✕' })).toBeDefined()
  await band.unmount()
})

test('five buttons: without a /usage in the session, Usage runs the usage mod\'s /conso', async ($, on) => {
  world(on)
  const ran: string[] = []
  on('command.list', () => ({ value: [{ name: 'conso', description: '', source: 'plugin', plugin: 'usage' }] }))
  on('command.run', { command: 'conso' }, ($: any, e: any) => (ran.push(`conso ${e.args ?? ''}`.trim()), {}))
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: at(200) } as any)
  await band.press({ key: 'mod-usage' })
  expect(ran).toEqual(['conso'])
  await band.unmount()
})

test('Exporter runs /export-tout, then « dernier export HH:MM » shows after it and is kept in $.store', async ($, on) => {
  const w = world(on)
  const ran: string[] = []
  on('command.list', () => ({ value: FIVE_CMDS }))
  on('command.run', { command: 'export-tout' }, ($: any, e: any) => (ran.push(`export-tout ${e.args ?? ''}`.trim()), {}))
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: at(200) } as any)
  expect(await band.find({ type: 'Text', text: /dernier export/ })).toBeUndefined()
  await band.press({ key: 'mod-export' })
  expect(ran).toEqual(['export-tout'])
  expect(await band.find({ type: 'Text', text: /^dernier export \d\d:\d\d$/ })).toBeDefined()
  expect(await band.find({ type: 'Button', text: 'Exporter ✕' })).toBeUndefined()
  expect(w.stored.stamps).toEqual({ export: NOW })
  await band.unmount()
})

test('Exporter: a /export-tout typed by the person stamps it too; the stamp comes back at session start', async ($, on) => {
  world(on, { extra: {} })
  on('command.list', () => ({ value: FIVE_CMDS }))
  on('command.run', { command: 'export-tout' }, () => ({}))
  await $.command.run({ command: 'export-tout', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: at(200) } as any)
  expect(await band.find({ type: 'Text', text: /^dernier export \d\d:\d\d$/ })).toBeDefined()
  await band.unmount()
})

test('others_above_prompt show (own settings): what other mods draw stays under the Jauge', OWN, async ($, on) => {
  world(on, { config: { jauge: { others_above_prompt: 'show' } } })
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await band.unmount()
})

test('no seven_day reading: the band leaves the week out; status line off by default', async ($, on) => {
  const w = world(on, { week: false })
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Text', text: /sem/ })).toBeUndefined()
  expect(w.statuses.length).toBe(0)
  await band.unmount()
})

test('status_line on: a short entry in the status line', { options: { status_line: 'on' } } as any, async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'jauge', args: '' } as any)
  expect(w.statuses.at(-1)).toMatch(/^ctx 41 % \(164 k\) · cette conv 120 tok\/s · tout 3,1 k tok\/s$/)
})

test('band off: the engine draws its own', { options: { band: 'off' } } as any, async ($, on) => {
  world(on)
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await band.unmount()
})

// The older compact style stays available (gauge.style "compact" in the person's own settings file).
test('compact style (own settings): one line with the gauge, « À toi » and « attend Julian » counters, the Mods row with Jauge', OWN, async ($, on) => {
  world(on, { todo: 4, julian: 2, config: { ...COMPACT, ...HUBS } })
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Text', text: /^ctx 41 % · (compact ~\d+ min · )?120 tok\/s · 1 compactage\(s\) · sem 37 %$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'À toi : 4' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'attend Julian : 2' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^Mods :$/ })).toBeDefined()
  expect(await band.find({ type: 'Button', text: /^Jauge/ })).toBeDefined()
  await band.unmount()
})

test('compact style: the sections state remembered in $.store comes back at session start', OWN, async ($, on) => {
  world(on, { stored: { expanded: true, open: ['conv', 'usage'] }, config: COMPACT })
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/app', surface: 'terminal', isInteractive: true } as any)
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Button', text: '▾ Cette conversation' })).toBeDefined()
  await band.unmount()
})

// The older hub row (launcher.preset "hubs" in the person's own settings): cockpit is loaded, registres and reference are not.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`launcher hubs (own settings): a press opens a loaded hub, a second press closes it, a missing hub is greyed and says how to load it (${surface})`, OWN, async ($, on) => {
    world(on, { config: HUBS })
    const ran: string[] = []
    const toasts: string[] = []
    on('command.list', () => ({
      value: [
        { name: 'jauge', description: '', source: 'plugin', plugin: 'band' },
        { name: 'cockpit', description: '', source: 'plugin', plugin: 'cockpit' },
        { name: 'veille', description: '', source: 'plugin', plugin: 'veille' },
        { name: 'afaire', description: '', source: 'plugin', plugin: 'a-faire' },
        { name: 'registres', description: '', source: 'plugin', plugin: 'someone-else' },
      ],
    }))
    on('command.run', { command: 'cockpit' }, ($: any, e: any) => (ran.push(`cockpit ${e.args ?? ''}`.trim()), {}))
    on('ui.toast', ($: any, e: any) => (toasts.push(String(e.text)), { value: undefined }))
    await $.command.run({ command: 'jauge', args: '' } as any)
    const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface, viewport: { columns: 200, rows: 40 }, props: at(200) } as any)
    for (const label of ['Cockpit', 'Veille', 'À toi', 'Registres', 'Référence']) expect(await band.find({ type: 'Button', text: label })).toBeDefined()
    expect(await band.find({ type: 'Button', text: 'Usine' })).toBeUndefined()
    await band.press({ key: 'mod-cockpit' })
    expect(ran).toEqual(['cockpit'])
    expect(await band.find({ type: 'Button', text: 'Cockpit ✕' })).toBeDefined()
    await band.press({ key: 'mod-cockpit' })
    expect(ran).toEqual(['cockpit', 'cockpit close'])
    await band.press({ key: 'mod-registres' })
    expect(ran.length).toBe(2)
    expect(toasts.at(-1)).toBe('non chargé : ajouter mods/registres à CLAUDE_CODE_PLUGIN_DIRS')
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'band', component: 'Pane', requestId: 'jauge', surface, viewport: { columns: 160, rows: 120 }, props: PANE } as any)
    expect(await pane.find({ type: 'Text', text: /mods\/reference à CLAUDE_CODE_PLUGIN_DIRS/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '/cockpit' })).toBeDefined()
    await pane.unmount()
  })
}

test('launcher single (hubs): opening Veille closes the open Cockpit and the Jauge pane (/cockpit close, ui.close)', OWN, async ($, on) => {
  const w = world(on, { config: HUBS })
  const ran: string[] = []
  on('command.list', () => ({ value: ['jauge', 'cockpit', 'veille'].map(name => ({ name, description: '', source: 'plugin' })) }))
  on('command.run', { command: 'cockpit' }, ($: any, e: any) => (ran.push(`cockpit ${e.args ?? ''}`.trim()), {}))
  on('command.run', { command: 'veille' }, ($: any, e: any) => (ran.push(`veille ${e.args ?? ''}`.trim()), {}))
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: at(200) } as any)
  await band.press({ key: 'mod-cockpit' })
  expect(w.closed).toContain('jauge') // the Jauge pane /jauge opened is closed when Cockpit opens
  await band.press({ key: 'mod-veille' })
  expect(ran).toEqual(['cockpit', 'cockpit close', 'veille'])
  expect(await band.find({ type: 'Button', text: 'Veille ✕' })).toBeDefined()
  expect(await band.find({ type: 'Button', text: 'Cockpit' })).toBeDefined()
  await band.unmount()
})

test('launcher single: a hub typed (or run by another mod) closes the other open hub too', OWN, async ($, on) => {
  const w = world(on, { config: HUBS })
  const ran: string[] = []
  on('command.list', () => ({ value: ['cockpit', 'veille'].map(name => ({ name, description: '', source: 'plugin' })) }))
  on('command.run', { command: 'cockpit' }, ($: any, e: any) => (ran.push(`cockpit ${e.args ?? ''}`.trim()), {}))
  on('command.run', { command: 'veille' }, ($: any, e: any) => (ran.push(`veille ${e.args ?? ''}`.trim()), {}))
  await $.command.run({ command: 'cockpit', args: '' } as any)
  await $.command.run({ command: 'veille', args: '' } as any)
  // inside a command.run hook the engine refuses $.command.run: band closes on the next timer tick
  expect(ran).toEqual(['cockpit', 'veille'])
  await (w.clock as any).advance(1)
  expect(ran).toEqual(['cockpit', 'veille', 'cockpit close'])
})

test('launcher single: Cockpit typed closes the open Règles (/reference close)', async ($, on) => {
  const w = world(on)
  const ran: string[] = []
  on('command.list', () => ({ value: FIVE_CMDS }))
  on('command.run', { command: 'cockpit' }, ($: any, e: any) => (ran.push(`cockpit ${e.args ?? ''}`.trim()), {}))
  on('command.run', { command: 'reference' }, ($: any, e: any) => (ran.push(`reference ${e.args ?? ''}`.trim()), {}))
  await $.command.run({ command: 'reference', args: 'config' } as any)
  await $.command.run({ command: 'cockpit', args: '' } as any)
  await (w.clock as any).advance(1)
  expect(ran).toEqual(['reference config', 'cockpit', 'reference close'])
})

test('launcher single off (own settings): two hubs stay open', OWN, async ($, on) => {
  world(on, { config: { launcher: { preset: 'hubs', single: false } } })
  const ran: string[] = []
  on('command.list', () => ({ value: ['cockpit', 'veille'].map(name => ({ name, description: '', source: 'plugin' })) }))
  on('command.run', { command: 'cockpit' }, ($: any, e: any) => (ran.push(`cockpit ${e.args ?? ''}`.trim()), {}))
  on('command.run', { command: 'veille' }, ($: any, e: any) => (ran.push(`veille ${e.args ?? ''}`.trim()), {}))
  await $.command.run({ command: 'cockpit', args: '' } as any)
  await $.command.run({ command: 'veille', args: '' } as any)
  expect(ran).toEqual(['cockpit', 'veille'])
})

test('/jauge close closes the Jauge pane', async ($, on) => {
  const w = world(on)
  const r = await $.command.run({ command: 'jauge', args: 'close' } as any)
  expect(w.closed).toContain('jauge')
  expect(r.text).toBe('jauge: fermée')
})

test('launcher preset all (own settings file): the older buttons come back, Conso opens', OWN, async ($, on) => {
  world(on, { config: { launcher: { preset: 'all' } } })
  const ran: string[] = []
  on('command.list', () => ({ value: [{ name: 'conso', description: '', source: 'plugin', plugin: 'usage' }] }))
  on('command.run', { command: 'conso' }, ($: any, e: any) => (ran.push(`conso ${e.args ?? ''}`.trim()), {}))
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 400, rows: 40 }, props: at(400) } as any)
  expect(await band.find({ type: 'Button', text: 'Usine' })).toBeDefined()
  expect(await band.find({ type: 'Button', text: 'Tests réels' })).toBeDefined()
  expect(await band.find({ type: 'Button', text: /^Registres/ })).toBeUndefined()
  await band.press({ key: 'mod-usage' })
  expect(ran).toEqual(['conso'])
  expect(await band.find({ type: 'Button', text: 'Conso ✕' })).toBeDefined()
  await band.unmount()
})

test('launcher: the person typing /cockpit close keeps the button in step', async ($, on) => {
  world(on)
  on('command.list', () => ({ value: [{ name: 'cockpit', description: '', source: 'plugin', plugin: 'cockpit' }] }))
  on('command.run', { command: 'cockpit' }, () => ({}))
  await $.command.run({ command: 'jauge', args: '' } as any)
  await $.command.run({ command: 'cockpit', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Button', text: 'Cockpit ✕' })).toBeDefined()
  await band.unmount()
  await $.command.run({ command: 'cockpit', args: 'close' } as any)
  const again = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await again.find({ type: 'Button', text: 'Cockpit ✕' })).toBeUndefined()
  await again.unmount()
})

// Hand-off: past 250 K a red « relais conseillé » chip and one RESUME button join the line; the pane keeps the RESUME block.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`hand-off: from 250 K « relais conseillé » and RESUME in the line, RESUME runs /handoff; the pane shows RESUME (${surface})`, async ($, on) => {
    world(on, { tokens: 260000, resume: true })
    const ran: string[] = []
    on('command.list', () => ({ value: [{ name: 'handoff', description: '', source: 'user' }] }))
    on('command.run', { command: 'handoff' }, ($: any, e: any) => (ran.push(`handoff ${e.args ?? ''}`.trim()), {}))
    await $.command.run({ command: 'jauge', args: '' } as any)
    const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface, viewport: { columns: 160, rows: 40 }, props: BAND } as any)
    const chip = await band.find({ type: 'Text', text: 'relais conseillé' })
    expect((chip as any).props.color).toBe('error') // one red chip, never cut
    expect((chip as any).props.wrap).toBeUndefined()
    expect(await band.find({ type: 'Button', text: 'RESUME' })).toBeDefined()
    expect(await band.find({ type: 'Button', text: /Ouvrir RESUME|Préparer RESUME/ })).toBeUndefined()
    expect(ran).toEqual([])
    await band.press({ key: 'handoff-prepare' })
    expect(ran).toEqual(['handoff'])
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'band', component: 'Pane', requestId: 'jauge', surface, viewport: { columns: 160, rows: 120 }, props: PANE } as any)
    await pane.press({ key: 'p-handoff-open' })
    expect(await pane.find({ type: 'Text', text: 'C:/code/app/handoff/RESUME.md : mis à jour il y a 3 h' })).toBeDefined()
    expect(await pane.find({ type: 'Markdown' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /\/handoff lancé$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /compactage auto 368 k→17 k$/ })).toBeDefined()
    await pane.unmount()
  })
}

// Narrow band (Julian, 22 Oct, ~520 px chat column): the figures wrap onto a second row as whole fields, never
// « 7 c… »; the relay keeps RESUME (a red mark, then the button alone) and drops the words.
for (const surface of ['terminal', 'desktop'] as const) {
  for (const cols of [40, 50, 60]) {
    test(`narrow Jauge at ${cols} columns: two rows of whole fields, RESUME kept, no words (${surface})`, async ($, on) => {
      world(on, { tokens: 260000 })
      on('command.list', () => ({ value: [...FIVE_CMDS, { name: 'handoff', description: '', source: 'user' }] }))
      await $.command.run({ command: 'jauge', args: '' } as any)
      const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface, viewport: { columns: cols + 5, rows: 40 }, props: at(cols) } as any)
      const rows = await jaugeRows(band)
      expect(rows.length).toBe(2)
      const inRows = rows.flatMap(r => textsIn(r))
      expect(inRows.length > 4).toBe(true)
      for (const t of inRows) expect(t.props.wrap).toBeUndefined()
      // every figure is one Box that never shrinks, its Texts never truncated
      const fields = (await band.findAll({ type: 'Box' })).filter((b: any) => /^j\d-/.test(String(b.key)))
      expect(fields.length > 2).toBe(true)
      for (const f of fields as any[]) expect(f.props.flexShrink).toBe(0)
      expect(await band.find({ type: 'Text', text: /…|\.\./ })).toBeUndefined()
      // the words only as one red chip when they fit beside RESUME, else a red mark or nothing
      const chip = (await band.find({ type: 'Text', text: 'relais conseillé' })) as any
      if (chip) expect([chip.props.color, chip.props.wrap]).toEqual(['error', undefined])
      if (!chip) expect(await band.find({ type: 'Text', text: /relais/ })).toBeUndefined()
      expect(await band.find({ type: 'Button', text: 'RESUME' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: 'ctx ' })).toBeDefined()
      await band.unmount()
    })
  }
}

test('hand-off: below the threshold nothing shows and nothing runs', async ($, on) => {
  world(on, { tokens: 164000 })
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Text', text: /relais/ })).toBeUndefined()
  expect(await band.find({ type: 'Button', text: 'RESUME' })).toBeUndefined()
  await band.unmount()
})

test('hand-off: no handoff command in the session greys RESUME (a toast, no run)', async ($, on) => {
  world(on, { tokens: 300000 })
  const toasts: string[] = []
  on('command.list', () => ({ value: [] }))
  on('ui.toast', ($: any, e: any) => (toasts.push(String(e.text)), { value: undefined }))
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  await band.press({ key: 'handoff-prepare' })
  expect(toasts.at(-1)).toMatch(/\/handoff absente de cette session/)
  await band.unmount()
})

test('hand-off: a /handoff typed by the person is listed in the pane', async ($, on) => {
  world(on, { tokens: 260000 })
  on('command.list', () => ({ value: [{ name: 'handoff', description: '', source: 'user' }] }))
  on('command.run', { command: 'handoff' }, () => ({}))
  await $.command.run({ command: 'jauge', args: '' } as any)
  await $.command.run({ command: 'handoff', args: '' } as any)
  const pane = await $.ui.mount({ plugin: 'band', component: 'Pane', requestId: 'jauge', surface: 'terminal', viewport: { columns: 160, rows: 120 }, props: PANE } as any)
  expect(await pane.find({ type: 'Text', text: /\/handoff lancé$/ })).toBeDefined()
  await pane.unmount()
})

// « en cours » rows (Julian, 21 Oct): only while something runs in this conversation, under the line, above the buttons.
const MIN = 60000
const runningAgent = (id: string, label: string, extra: Record<string, unknown> = {}) => ({ id, label, type: 'coder', model: 'opus', status: 'running', start: NOW - 47 * MIN, last: NOW - MIN, ...extra })
const WAVE = {
  id: 'wf_1', name: 'cockpit-preview-g2', phases: ['Preview release', 'Verify'], phase: 'Preview release', phaseIdx: 0, status: 'running',
  start: NOW - 47 * MIN, last: NOW - MIN, agents: [runningAgent('a1', 'p43-rag-identity'), runningAgent('a2', 'p44-migration')],
}
const BG = { id: 'b1', type: 'auditor', model: 'sonnet', shape: 'background', status: 'running', start: NOW - 3 * MIN, last: NOW }
const mountBand = async ($: any) => {
  await $.command.run({ command: 'jauge', args: '' } as any)
  return $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: at(200) } as any)
}

test('en cours: nothing runs -> no row, the Jauge stays one line', async ($, on) => {
  world(on)
  on('command.list', () => ({ value: FIVE_CMDS }))
  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: /^[◇◦•] $/ })).toBeUndefined()
  expect(((await band.findAll({ type: 'Button' })) as any[]).length).toBe(5)
  await band.unmount()
})

test('en cours: one Workflow with 2 agents (green bullets, grey type words) and a background agent', async ($, on) => {
  world(on, { encours: { workflows: [WAVE], agents: [BG] } })
  on('command.list', () => ({ value: FIVE_CMDS }))
  const band = await mountBand($)
  const bullet = (await band.find({ type: 'Text', text: '◇ ' })) as any
  expect(bullet.props.color).toBe('success')
  expect(await band.find({ type: 'Text', text: 'cockpit-preview-g2' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '▸ Preview release' })).toBeDefined()
  expect(((await band.find({ type: 'Text', text: '▱▱▱▱▱' })) as any).props.color).toBe('success') // phases done 0/2
  expect(((await band.find({ type: 'Text', text: '0/2' })) as any).props.color).toBe('success')
  expect(((await band.find({ type: 'Text', text: '2 agents' })) as any).props.dimColor).toBe(true)
  expect(await band.find({ type: 'Text', text: 'p43-rag-identity' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'p44-migration' })).toBeDefined()
  expect(((await band.findAll({ type: 'Text', text: '• ' })) as any[]).length).toBe(2)
  expect(((await band.find({ type: 'Text', text: '◦ ' })) as any).props.color).toBe('success')
  expect(((await band.find({ type: 'Text', text: "agent d'arrière-plan" })) as any).props.dimColor).toBe(true)
  expect(((await band.findAll({ type: 'Button' })) as any[]).length).toBe(5)
  await band.unmount()
})

test('en cours: past jauge.en_cours_rows, « +N de plus » and a Cockpit › button that opens the cockpit', OWN, async ($, on) => {
  const ran: string[] = []
  world(on, { encours: { workflows: [WAVE], agents: [BG, { ...BG, id: 'b2' }, { ...BG, id: 'b3' }] }, config: { jauge: { en_cours_rows: 3 } } })
  on('command.list', () => ({ value: FIVE_CMDS }))
  on('command.run', { command: 'cockpit' }, ($: any, e: any) => (ran.push('cockpit'), {}))
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: at(200) } as any)
  expect(await band.find({ type: 'Text', text: '+3 de plus ·' })).toBeDefined()
  expect(((await band.findAll({ type: 'Text', text: '◦ ' })) as any[]).length).toBe(0)
  await band.press({ key: 'ec-cockpit' })
  expect(ran.at(-1)).toBe('cockpit')
  await band.unmount()
})

test('en cours: a Workflow silent for 15-30 min is amber (bar too), a failed agent red', async ($, on) => {
  world(on, { encours: { workflows: [{ ...WAVE, stalled: true, last: NOW - 22 * MIN, agents: [runningAgent('a1', 'x'), runningAgent('a2', 'y', { status: 'failed' })] }] } })
  on('command.list', () => ({ value: FIVE_CMDS }))
  const band = await mountBand($)
  expect(((await band.find({ type: 'Text', text: '◇ ' })) as any).props.color).toBe('warning')
  expect(((await band.find({ type: 'Text', text: '▱▱▱▱▱' })) as any).props.color).toBe('warning')
  expect(await band.find({ type: 'Text', text: 'rien écrit depuis 22 min' })).toBeDefined()
  const dots = (await band.findAll({ type: 'Text', text: '• ' })) as any[]
  expect(dots.map(d => d.props.color)).toEqual(['success', 'error'])
  await band.unmount()
})

test('en cours: silent for more than 30 min is red; the desktop draws the row\'s bar as a thin Svg', async ($, on) => {
  world(on, { encours: { workflows: [{ ...WAVE, phase: 'Verify', phaseIdx: 1, stalled: true, last: NOW - 42 * MIN }] } })
  on('command.list', () => ({ value: FIVE_CMDS }))
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'desktop', viewport: { columns: 200, rows: 40 }, props: at(200) } as any)
  expect(((await band.find({ type: 'Text', text: '◇ ' })) as any).props.color).toBe('error')
  expect(await band.find({ type: 'Text', text: 'rien écrit depuis 42 min' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /▰|▱/ })).toBeUndefined()
  const svgs = (await band.findAll({ type: 'Svg' })) as any[]
  expect(svgs.some(x => /#f85149/.test(String(x.props.source)))).toBe(true) // the row's bar in red
  await band.unmount()
})

for (const columns of [60, 90]) {
  test(`en cours at ${columns} columns: every row fits, the name is cut before the rest`, async ($, on) => {
    const long = { ...WAVE, name: 'datapass-factory-release-wave-g7-long-name', eta: NOW + 20 * MIN }
    world(on, { encours: { workflows: [long], agents: [{ ...BG, label: 'confidentiality scan of every mod folder' }] } })
    on('command.list', () => ({ value: FIVE_CMDS }))
    await $.command.run({ command: 'jauge', args: '' } as any)
    const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns, rows: 40 }, props: at(columns) } as any)
    const name = (await band.find({ type: 'Text', text: /^datapass-/ })) as any
    expect(/…$/.test(name.text)).toBe(true)
    expect(await band.find({ type: 'Text', text: '47 min' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: '0/2' })).toBeDefined()
    await band.unmount()
  })
}

// Activity status at the start of the line (lib/core/busy.mjs counts from the scanner, view.activity). Invented figures.
const ACT = (o: Record<string, unknown> = {}) => ({ activity: { convs: 0, busy: [], workflows: 0, agents: 0, lastDone: null, ci: { available: true, running: 0, queued: 0, failed: 0, age_ms: 60000, stale: false }, ...o } })
const mountWith = async ($: any, props: Record<string, unknown> = {}) => {
  await $.command.run({ command: 'jauge', args: '' } as any)
  return $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: { ...at(200), ...props } } as any)
}

test('activity: nothing runs -> one green « ✓ au repos » first on the line', async ($, on) => {
  world(on, { extra: ACT() })
  on('command.list', () => ({ value: FIVE_CMDS }))
  const band = await mountWith($)
  expect(((await band.find({ type: 'Text', text: '✓ au repos' })) as any).props.color).toBe('success')
  expect(await band.find({ type: 'Text', text: /conv$/ })).toBeUndefined()
  await band.unmount()
})

test('activity: this conversation working -> « ▶ 1 conv » green, zeros grey', async ($, on) => {
  world(on, { extra: ACT() })
  on('command.list', () => ({ value: FIVE_CMDS }))
  const band = await mountWith($, { isWorking: true })
  expect(((await band.find({ type: 'Text', text: '▶ 1 conv' })) as any).props.color).toBe('success')
  expect(((await band.find({ type: 'Text', text: '0 wf' })) as any).props.dimColor).toBe(true)
  expect(((await band.find({ type: 'Text', text: '0 ag' })) as any).props.dimColor).toBe(true)
  expect(((await band.find({ type: 'Text', text: '0 CI' })) as any).props.dimColor).toBe(true)
  expect(await band.find({ type: 'Text', text: '✓ au repos' })).toBeUndefined()
  await band.unmount()
})

test('activity: a stale ci cache shows a grey « CI ? », never « 0 CI »', async ($, on) => {
  world(on, { extra: ACT({ convs: 1, busy: ['other'], ci: { available: true, running: 0, queued: 0, failed: 0, age_ms: 40 * 60000, stale: true } }) })
  on('command.list', () => ({ value: FIVE_CMDS }))
  const band = await mountWith($)
  expect(((await band.find({ type: 'Text', text: 'CI ?' })) as any).props.dimColor).toBe(true)
  expect(await band.find({ type: 'Text', text: '0 CI' })).toBeUndefined()
  await band.unmount()
})

// Julian's case (22 Oct, narrow chat column): 7 conv · 1 wf · 3 ag · CI ?, context past the relay. Each width keeps
// whole fields and the conv count on row 1, RESUME on row 1, and never draws « 7 c… ».
for (const cols of [40, 50, 60, 80]) {
  test(`busy Jauge at ${cols} columns: row 1 « ▶ 7 conv · 1 wf · 3 ag », whole fields, RESUME`, async ($, on) => {
    world(on, { tokens: 260000, extra: ACT({ convs: 7, busy: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], workflows: 1, agents: 3, ci: { available: true, running: 0, queued: 0, failed: 0, age_ms: 40 * 60000, stale: true } }) })
    on('command.list', () => ({ value: [...FIVE_CMDS, { name: 'handoff', description: '', source: 'user' }] }))
    const band = await mountWith($, at(cols))
    const rows = await jaugeRows(band)
    expect(rows.length).toBe(2)
    const shown = (r: any) => textsIn(r).map(t => (t.children ?? []).join(''))
    const r0 = shown(rows[0])
    expect(r0[0]).toBe('▶ 7 conv')
    expect(r0.join('')).toMatch(/^▶ 7 conv · 1 wf · 3 ag/)
    for (const t of [...r0, ...shown(rows[1])]) expect(/…|\.\./.test(t)).toBe(false)
    expect(shown(rows[1]).join('')).toMatch(/^ctx /)
    expect(await band.find({ type: 'Button', text: 'RESUME' })).toBeDefined()
    await band.unmount()
  })
}
