// Hook tests for cockpit with the Claude Code test kit: claude plugin test mods/cockpit
// Fixture scan only (no real data). The scanner, band's scanner and the files are answered by hooks beneath the mod.
import { expect, test } from 'claude-code/testing'

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

function world(on: any) {
  const opened: string[] = []
  const ran: unknown[] = []
  const scans: string[] = []
  on('clock.now', () => ({ value: NOW }))
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.exists', ($: any, e: any) => ({ value: /cockpit\.config\.json$|lib\/factory\/factory\.config\.json$/.test(String(e.path)) && !String(e.path).includes('effort-board') }))
  on('fs.read', ($: any, e: any) => ({ value: String(e.path).endsWith('cockpit.config.json') ? JSON.stringify({})
    : JSON.stringify({ context_window: 400000, rates: { opus: { in: 4, out: 20, cache_read: 0.4, cache_write_5m: 5, cache_write_1h: 8 } }, thresholds: { handoff_tokens: 250000 } }) }))
  on('process.run', ($: any, e: any) => {
    const argv = e.argv as string[]
    const i = argv.indexOf('--detail')
    const detail = i >= 0 ? argv[i + 1] : ''
    scans.push(detail)
    return { value: { exitCode: 0, stdout: scanFor(detail), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.id', () => ({ value: 'lead-cli' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 103000, window: 1000000, percent: 10.3 }, rateLimits: [{ kind: 'five_hour', percentUsed: 21 }, { kind: 'seven_day', percentUsed: 14 }], cost: { usd: 3.2 } } }))
  on('ui.open', ($: any, e: any) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: [{ id: 'cockpit', title: 'Cockpit', isShown: true, isFocused: false, isPlaced: true }] }))
  on('command.run', ($: any, e: any) => { ran.push(e); return { value: {} } })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { opened, ran, scans }
}

const PANE = { title: 'Cockpit', isFocused: true, bodyColumns: 75, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }

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
    await $.command.run({ command: 'cockpit', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'cockpit', component: 'Pane', requestId: 'cockpit', surface, viewport: { columns: 80, rows: 80 }, props: PANE } as any)
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
}
