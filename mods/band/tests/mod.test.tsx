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

function world(on: any, opts: { week?: boolean; tokens?: number; resume?: boolean } = {}) {
  const tokens = opts.tokens ?? 164000
  mock.clock(on, { now: NOW } as any)
  const runs: string[][] = []
  const statuses: (string | undefined)[] = []
  const sessions = {
    me: { s: 'me', cwd: 'C:/code/app/.claude/worktrees/band', title: 'LANE BAND', last: NOW, ctx: 164000, compactions: [{ t: NOW - 300000, trigger: 'auto', pre: 368000, post: 17000 }], samples: [] },
    other: { s: 'other', cwd: 'C:/code/web', title: 'WEB', last: NOW, compactions: [], samples: [] },
  }
  const view = buildView([ev(10, 'me', 7200), ev(20, 'me', 120000, { a: 'x' }), ev(30, 'other', 60000)], sessions as any, CFG, {
    now: NOW,
    session: 'me',
    cwd: 'C:/code/app/.claude/worktrees/band',
  })
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p.endsWith('/band.config.json')) return { value: SHIPPED }
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
      rateLimits: opts.week === false ? [] : [{ kind: 'seven_day', percentUsed: 37 }],
    },
  }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', ($: any, e: any) => (statuses.push(e.text), { value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { runs, statuses }
}

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 150, scroll: { offset: 0, bodyRows: 10 } }
const PANE = { title: 'Jauge', isFocused: true, bodyColumns: 150, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/jauge scans, the band reads ctx, compaction, rates and week (${surface})`, async ($, on) => {
    const w = world(on)
    const r = await $.command.run({ command: 'jauge', args: '' } as any)
    expect(w.runs.length).toBe(1)
    expect(w.runs[0][1]).toMatch(/scanner\/scan\.mjs$/)
    expect(r.text).toMatch(/ctx 41 % \(164 k\) · compact à 92 % · reste 51 %/)
    const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface, viewport: { columns: 160, rows: 40 }, props: BAND } as any)
    expect(await band.find({ type: 'Text', text: /ctx 41 %/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /cette conv 120 tok\/s/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^ctx 41 % \(164 k\)$/ })).toBeDefined() // the gauge's title
    expect(await band.find({ type: 'Text', text: /projet 2,1 k tok\/s/ })).toBeUndefined() // gauge.scopes: conv and all only
    expect(await band.find({ type: 'Text', text: /tout 3,1 k tok\/s/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /semaine 37 %/ })).toBeDefined()
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'band', component: 'Pane', requestId: 'jauge', surface, viewport: { columns: 160, rows: 120 }, props: PANE } as any)
    expect(await pane.find({ type: 'Text', text: /seuil d'auto-compact 368 k \(92 %\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /> LANE BAND/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /au repos|auto 368 k→17 k/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /▲/ })).toBeDefined()
    await pane.unmount()
  })
}

test('no seven_day reading: the band leaves the week out; status line off by default', async ($, on) => {
  const w = world(on, { week: false })
  await $.command.run({ command: 'jauge', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Text', text: /semaine/ })).toBeUndefined()
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

// The Mods button bar: usage and factory are loaded (their commands are listed), ci is not.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`launcher: a press opens a loaded mod, a second press closes it, a missing mod is greyed (${surface})`, async ($, on) => {
    world(on)
    const ran: string[] = []
    const toasts: string[] = []
    on('command.list', () => ({
      value: [
        { name: 'conso', description: '', source: 'plugin', plugin: 'usage' },
        { name: 'factory', description: '', source: 'plugin', plugin: 'factory' },
        { name: 'ci', description: '', source: 'plugin', plugin: 'someone-else' },
      ],
    }))
    on('command.run', { command: 'conso' }, ($: any, e: any) => (ran.push(`conso ${e.args ?? ''}`.trim()), {}))
    on('ui.toast', ($: any, e: any) => (toasts.push(String(e.text)), { value: undefined }))
    await $.command.run({ command: 'jauge', args: '' } as any)
    const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface, viewport: { columns: 160, rows: 40 }, props: BAND } as any)
    expect(await band.find({ type: 'Text', text: /^Mods :$/ })).toBeDefined()
    await band.press({ key: 'mod-usage' })
    expect(ran).toEqual(['conso'])
    expect(await band.find({ type: 'Button', text: 'Conso ✕' })).toBeDefined()
    await band.press({ key: 'mod-usage' })
    expect(ran).toEqual(['conso', 'conso close'])
    expect(await band.find({ type: 'Button', text: 'Conso ✕' })).toBeUndefined()
    await band.press({ key: 'mod-ci' })
    expect(ran.length).toBe(2)
    expect(toasts.at(-1)).toBe('non chargé : ajouter mods/ci à CLAUDE_CODE_PLUGIN_DIRS')
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'band', component: 'Pane', requestId: 'jauge', surface, viewport: { columns: 160, rows: 120 }, props: PANE } as any)
    expect(await pane.find({ type: 'Text', text: /mods\/scenarios à CLAUDE_CODE_PLUGIN_DIRS/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '/factory' })).toBeDefined()
    await pane.unmount()
  })
}

test('launcher: the person typing /conso close keeps the button in step', async ($, on) => {
  world(on)
  on('command.list', () => ({ value: [{ name: 'conso', description: '', source: 'plugin', plugin: 'usage' }] }))
  on('command.run', { command: 'conso' }, () => ({}))
  await $.command.run({ command: 'jauge', args: '' } as any)
  await $.command.run({ command: 'conso', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Button', text: 'Conso ✕' })).toBeDefined()
  await band.unmount()
  await $.command.run({ command: 'conso', args: 'close' } as any)
  const again = await $.ui.mount({ plugin: 'band', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await again.find({ type: 'Button', text: 'Conso ✕' })).toBeUndefined()
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
    expect(await band.find({ type: 'Text', text: 'RESUME mis à jour il y a 3 h' })).toBeDefined()
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
  expect(await band.find({ type: 'Text', text: 'RESUME absent' })).toBeDefined()
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
