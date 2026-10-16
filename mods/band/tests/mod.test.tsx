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
function world(on: any, opts: { week?: boolean; tokens?: number; resume?: boolean; stored?: unknown; julian?: number; todo?: number; config?: unknown; extra?: Record<string, unknown>; limits?: { kind: string; percentUsed: number }[] } = {}) {
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
  on('process.run', ($: any, e: any) => (runs.push([...e.argv]), { value: { exitCode: 0, stdout: JSON.stringify(view), stderr: '' } }))
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

// The two-line Jauge (default): line 1 counters + context, line 2 quotas · activity · tok/s · machine, then the hubs and ▾.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`/jauge scans; the two-line Jauge: counters, context, quotas, activity, tok/s, hub buttons and ▾ (${surface})`, async ($, on) => {
    const w = world(on)
    const r = await $.command.run({ command: 'jauge', args: '' } as any)
    expect(w.runs.length).toBe(1)
    expect(w.runs[0][1]).toMatch(/scanner\/scan\.mjs$/)
    expect(r.text).toMatch(/ctx 41 % \(164 k\) · compact à 92 % · reste 51 %/)
    const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface, viewport: { columns: 160, rows: 40 }, props: BAND } as any)
    expect(await band.find({ type: 'Text', text: "● 0 t'attendent" })).toBeDefined()
    expect(await band.find({ type: 'Text', text: '0 à toi' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'contexte 41 % (relais 250 k)' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^sem 37 % │ 1 agents · 2 conv actives │ 3,1 k tok\/s tout · .+ ce projet · 120 cette conv$/ })).toBeDefined()
    for (const label of ['Cockpit', 'Veille', 'À toi', 'Registres', 'Référence', '▾']) expect(await band.find({ type: 'Button', text: label })).toBeDefined()
    expect(await band.find({ type: 'Button', text: /^Jauge/ })).toBeUndefined() // under ▾
    expect(await band.find({ type: 'Text', text: /^Mods :$/ })).toBeUndefined()
    expect(await band.find({ type: 'Button', text: /Cette conversation/ })).toBeUndefined()
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'band', component: 'Pane', requestId: 'jauge', surface, viewport: { columns: 160, rows: 120 }, props: PANE } as any)
    expect(await pane.find({ type: 'Text', text: /seuil d'auto-compact 368 k \(92 %\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /> LANE BAND/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /au repos|auto 368 k→17 k/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /▲/ })).toBeDefined()
    await pane.unmount()
  })
}

test('two-line Jauge: Codex weekly %, Claude 5 h, CPU and GPU from the scanner; red only when something waits', async ($, on) => {
  world(on, { julian: 2, todo: 4, extra: { codex: { week: 30 }, machine: { cpu: 12, gpu: 3 } }, limits: [{ kind: 'five_hour', percentUsed: 24 }, { kind: 'seven_day', percentUsed: 14 }] })
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: at(200) } as any)
  const waiting = await band.find({ type: 'Text', text: "● 2 t'attendent" })
  expect(waiting).toBeDefined()
  expect((waiting as any).props.color).toBe('error')
  expect(await band.find({ type: 'Text', text: '4 à toi' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^5 h 24 % · sem 14 % · Codex 30 % │ .+ │ CPU 12 % · GPU 3 %$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /attend Julian/ })).toBeUndefined() // the count shows once, on line 1
  await band.unmount()
})

for (const columns of [60, 75]) {
  test(`two-line Jauge at ${columns} columns: short labels and fewer fields, buttons fit, nothing wider than the band`, async ($, on) => {
    world(on, { julian: 12, todo: 34, extra: { codex: { week: 30 }, machine: { cpu: 12, gpu: 3 } }, limits: [{ kind: 'five_hour', percentUsed: 24 }, { kind: 'seven_day', percentUsed: 14 }] })
    on('command.list', () => ({ value: ['jauge', 'cockpit', 'veille', 'afaire', 'registres', 'reference'].map(name => ({ name, description: '', source: 'plugin' })) }))
    await $.command.run({ command: 'jauge', args: '' } as any)
    const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns, rows: 40 }, props: at(columns) } as any)
    const texts = (await band.findAll({ type: 'Text' })) as any[]
    const line1 = texts.filter(t => t.props?.bold).map(t => t.text).join('')
    const line2 = texts.find(t => !t.props?.bold && /│/.test(t.text))?.text ?? ''
    expect(line1).toBe("● 12 t'attendent · 34 à toi │ contexte 41 % (relais 250 k)")
    expect(line2.startsWith('5h 24% · sem 14%')).toBe(true)
    expect([...line1].length <= columns).toBe(true)
    expect([...line2].length <= columns).toBe(true)
    expect(await band.find({ type: 'Text', text: /cette conv$/ })).toBeUndefined() // short label
    if (columns === 60) {
      expect(await band.find({ type: 'Button', text: 'Reg.' })).toBeDefined()
      expect(await band.find({ type: 'Button', text: 'Réf.' })).toBeDefined()
    } else {
      expect(await band.find({ type: 'Button', text: 'Registres' })).toBeDefined()
    }
    await band.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`▾ unfolds the Jauge button and « Cette conversation », it opens, the state goes to $.store (${surface})`, async ($, on) => {
    const w = world(on)
    on('command.list', () => ({ value: [{ name: 'jauge', description: '', source: 'plugin', plugin: 'band' }] }))
    await $.command.run({ command: 'jauge', args: '' } as any)
    const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface, viewport: { columns: 160, rows: 40 }, props: BAND } as any)
    await band.press({ key: 'band-toggle' })
    expect(await band.find({ type: 'Button', text: '▴' })).toBeDefined()
    expect(await band.find({ type: 'Button', text: /^Jauge/ })).toBeDefined()
    expect(await band.find({ type: 'Button', text: '▸ Cette conversation' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'opus 5.5 · medium · agents 1/1' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^agents 1 en cours/ })).toBeUndefined() // closed: summary only
    await band.press({ key: 'sec-conv' })
    expect(await band.find({ type: 'Button', text: '▾ Cette conversation' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'agents 1 en cours / 1' })).toBeDefined()
    expect(w.stored.sections).toEqual({ expanded: true, open: ['conv'] })
    await band.unmount()
  })
}

test('sections: the state remembered in $.store comes back at session start', async ($, on) => {
  world(on, { stored: { expanded: true, open: ['conv', 'usage'] } })
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/app', surface: 'terminal', isInteractive: true } as any)
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Button', text: '▾ Cette conversation' })).toBeDefined()
  expect(await band.find({ type: 'Button', text: /Usage/ })).toBeUndefined() // a remembered old section is ignored
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
test('compact style (own settings): one line with the gauge, « À toi » and « attend Julian » counters, the Mods row with Jauge', { options: { config: 'C:/Users/me/band.json' } } as any, async ($, on) => {
  world(on, { todo: 4, julian: 2, config: COMPACT })
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 200, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Text', text: /^ctx 41 % · (compact ~\d+ min · )?120 tok\/s · 1 compactage\(s\) · sem 37 %$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'À toi : 4' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'attend Julian : 2' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^Mods :$/ })).toBeDefined()
  expect(await band.find({ type: 'Button', text: /^Jauge/ })).toBeDefined()
  await band.unmount()
})

// The hub buttons: cockpit is loaded, registres and reference are not; Jauge (under ▾) is band's own.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`launcher hubs: a press opens a loaded hub, a second press closes it, a missing hub is greyed and says how to load it (${surface})`, async ($, on) => {
    const w = world(on)
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
    // /jauge opened the Jauge pane: one hub at a time, so opening Cockpit closes it
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
    // Jauge, under ▾: band's own pane, opened and closed directly (no command run)
    await band.press({ key: 'band-toggle' })
    const before = w.opened.length
    await band.press({ key: 'mod-band' })
    expect(w.opened.slice(before)).toEqual(['jauge'])
    expect(await band.find({ type: 'Button', text: 'Jauge ✕' })).toBeDefined()
    await band.press({ key: 'mod-band' })
    expect(w.closed.at(-1)).toBe('jauge')
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'band', component: 'Pane', requestId: 'jauge', surface, viewport: { columns: 160, rows: 120 }, props: PANE } as any)
    expect(await pane.find({ type: 'Text', text: /mods\/reference à CLAUDE_CODE_PLUGIN_DIRS/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '/cockpit' })).toBeDefined()
    await pane.unmount()
  })
}

test('launcher single: opening Veille closes the open Cockpit and the Jauge pane (/cockpit close, ui.close)', async ($, on) => {
  const w = world(on)
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

test('launcher single: a hub typed (or run by another mod) closes the other open hub too', async ($, on) => {
  const w = world(on)
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

test('launcher single off (own settings): two hubs stay open', { options: { config: 'C:/Users/me/band.json' } } as any, async ($, on) => {
  world(on, { config: { launcher: { single: false } } })
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

test('launcher preset all (own settings file): the older buttons come back, Conso opens', { options: { config: 'C:/Users/me/band.json' } } as any, async ($, on) => {
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

// Hand-off helper: the orange line from 250 K, its two buttons, the pane's RESUME block and history.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`hand-off: under 250 K no line; from 250 K « Passation conseillée », Préparer runs /handoff, Ouvrir shows RESUME (${surface})`, async ($, on) => {
    world(on, { tokens: 260000, resume: true })
    const ran: string[] = []
    on('command.list', () => ({ value: [{ name: 'handoff', description: '', source: 'user' }] }))
    on('command.run', { command: 'handoff' }, ($: any, e: any) => (ran.push(`handoff ${e.args ?? ''}`.trim()), {}))
    await $.command.run({ command: 'jauge', args: '' } as any)
    const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface, viewport: { columns: 160, rows: 40 }, props: BAND } as any)
    expect(await band.find({ type: 'Text', text: /^Passation conseillée : contexte 260 k ≥ 250 k$/ })).toBeDefined()
    expect(await band.find({ type: 'Button', text: 'Préparer RESUME' })).toBeDefined()
    expect(ran).toEqual([])
    await band.press({ key: 'handoff-prepare' })
    expect(ran).toEqual(['handoff'])
    await band.press({ key: 'handoff-open' })
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'band', component: 'Pane', requestId: 'jauge', surface, viewport: { columns: 160, rows: 120 }, props: PANE } as any)
    expect(await pane.find({ type: 'Text', text: 'C:/code/app/handoff/RESUME.md : mis à jour il y a 3 h' })).toBeDefined()
    expect(await pane.find({ type: 'Markdown' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /\/handoff lancé$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /compactage auto 368 k→17 k$/ })).toBeDefined()
    await pane.unmount()
  })
}

test('hand-off: below the threshold nothing shows and nothing runs', async ($, on) => {
  world(on, { tokens: 164000 })
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Text', text: /Passation conseillée/ })).toBeUndefined()
  expect(await band.find({ type: 'Button', text: 'Préparer RESUME' })).toBeUndefined()
  await band.unmount()
})

test('hand-off: no handoff command in the session greys Préparer (a toast, no run); no RESUME says absent', async ($, on) => {
  world(on, { tokens: 300000 })
  const toasts: string[] = []
  on('command.list', () => ({ value: [] }))
  on('ui.toast', ($: any, e: any) => (toasts.push(String(e.text)), { value: undefined }))
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  await band.press({ key: 'handoff-prepare' })
  expect(toasts.at(-1)).toMatch(/\/handoff absente de cette session/)
  await band.press({ key: 'handoff-open' })
  expect(toasts.at(-1)).toBe('RESUME absent : C:/code/app/.claude/worktrees/band/handoff/RESUME.md')
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
