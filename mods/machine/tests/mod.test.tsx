// machine mod with the Claude Code test kit: claude plugin test mods/machine
// The scanner is mocked ($.process.run answers made-up samples); nothing is read from this machine.
import { expect, mock, test } from 'claude-code/testing'

import { SHIPPED } from './shipped'

const NOW = Date.parse('2026-10-16T12:00:00Z')

const SAMPLE = {
  platform: 'win32',
  at: NOW,
  interval_ms: 5000,
  ncpu: 4,
  cpu: { total: 90, cores: [95, 90, 88, 87] },
  ram: { total: 64e9, used: 32e9, pct: 50 },
  disks: [{ drive: 'C:', total: 1e12, free: 200e9, pct_used: 80 }],
  procs: {
    count: 300,
    unreadable: 120,
    cpu_attributed: 30,
    top_cpu: [
      { pid: 10, name: 'node.exe', cpu: 12.5, ram: 300e6, family: 'node' },
      { pid: 12, name: 'chrome.exe', cpu: 3, ram: 500e6, family: '' },
    ],
    top_ram: [{ pid: 11, name: 'claude.exe', cpu: 1, ram: 900e6, family: 'claude' }],
    families: { claude: { count: 3, cpu: 2, ram: 2e9 }, node: { count: 9, cpu: 20, ram: 3e9 } },
    runner: { present: true, children: 1 },
  },
  gpu: { source: 'nvidia-smi', gpus: [{ name: 'Test GPU', util: 35, mem_used_mb: 2048, mem_total_mb: 8192, temp_c: 60 }] },
  raw: { t: NOW / 1000, cores: [[1, 2]], procs: {} },
  ms: 40,
}
const RUNNER = {
  generated: '2026-10-16T12:00:00Z',
  backends: [{ id: 'gitlab-local', label: 'Local runner', tag: 'local-windows', concurrent: null, usable: 'yes', why: '1 runner(s) online', runners: { online: 1, offline: 0, total: 1 }, jobs: { running: 1, pending: null } }],
}

function world(on: any) {
  const clock = mock.clock(on, { now: NOW } as any)
  const runs: { argv: string[]; stdin?: string }[] = []
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', ($: any, e: any) => {
    if (String(e.path).replace(/\\/g, '/').endsWith('/machine.config.json')) return { value: SHIPPED }
    throw new Error('ENOENT')
  })
  on('process.run', ($: any, e: any) => {
    runs.push({ argv: [...e.argv], stdin: e.init?.stdin })
    const out = e.argv[3] === 'runner' ? RUNNER : SAMPLE
    return { value: { exitCode: 0, stdout: JSON.stringify(out), stderr: '' } }
  })
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: 'C:/code/app' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { runs, clock }
}

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 150, scroll: { offset: 0, bodyRows: 10 } }
const PANE = { title: 'Machine', isFocused: true, bodyColumns: 150, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/machine samples once and the pane shows advice, CPU, processes and runner (${surface})`, async ($, on) => {
    const w = world(on)
    const r = await $.command.run({ command: 'machine', args: '' } as any)
    const samples = w.runs.filter(x => x.argv[3] === 'sample')
    expect(samples.length).toBe(1)
    expect(samples[0].argv[2]).toMatch(/scanner\/machine\.py$/)
    expect(r.text).toMatch(/^agents en parallèle conseillés maintenant : 2 \(CPU > 85 % -2\)/)
    expect(r.text).toMatch(/GPU Test GPU 35 %/)
    const pane = await $.ui.mount({ plugin: 'machine', component: 'Pane', requestId: 'machine', surface, viewport: { columns: 160, rows: 120 }, props: PANE } as any)
    expect(await pane.find({ type: 'Text', text: /agents en parallèle conseillés maintenant : 2/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /node\.exe/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /claude\.exe/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /C: 200 Go libres/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /non vérifié/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /120 processus système illisibles sans droits admin : 60 % du CPU leur revient/ })).toBeDefined()
    await pane.unmount()
  })
}

test('the second sample passes the previous counters back and skips the GPU until gpu.refresh_s', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'machine', args: '' } as any)
  await $.command.run({ command: 'machine', args: '' } as any)
  const s = w.runs.filter(x => x.argv[3] === 'sample').map(x => JSON.parse(x.stdin ?? '{}'))
  expect(s.length).toBe(2)
  expect(s[0].prev).toBe(null)
  expect(s[0].gpu).toBe(true)
  expect(s[1].prev).toEqual(SAMPLE.raw)
  expect(s[1].gpu).toBe(false)
})

test('band entry off by default: the engine draws its own', async ($, on) => {
  world(on)
  await $.command.run({ command: 'machine', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'machine', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Text', text: /agents conseillés/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await band.unmount()
})

test('band on: a compact line under what others draw', { options: { band: 'on' } } as any, async ($, on) => {
  world(on)
  await $.command.run({ command: 'machine', args: '' } as any)
  const band = await $.ui.mount({ plugin: 'machine', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 160, rows: 40 }, props: BAND } as any)
  expect(await band.find({ type: 'Text', text: /agents conseillés 2/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /CPU 90 %/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await band.unmount()
})

test('/machine ci asks the ci mod scanner for the configured backend, refreshed, and never shows a token', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'machine', args: 'ci' } as any)
  await w.clock.settle()
  const r = w.runs.find(x => x.argv[3] === 'runner')
  expect(r?.argv.slice(4)).toEqual(['--backend', 'gitlab-local', '--refresh'])
  const pane = await $.ui.mount({ plugin: 'machine', component: 'Pane', requestId: 'machine', surface: 'terminal', viewport: { columns: 160, rows: 120 }, props: PANE } as any)
  expect(await pane.find({ type: 'Text', text: /1 job\(s\) en cours/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /runners 1\/1 en ligne/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /token/ })).toBeUndefined()
  await pane.unmount()
})

test('sampling runs every interval_s while the pane is open, the GPU every gpu.refresh_s, the runner every ci.refresh_s', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'machine', args: '' } as any)
  await w.clock.settle()
  await w.clock.advance(5000)
  await w.clock.advance(5000)
  await w.clock.advance(5000)
  const s = w.runs.filter(x => x.argv[3] === 'sample').map(x => JSON.parse(x.stdin ?? '{}'))
  expect(s.length).toBe(4)
  expect(s.map(x => x.gpu)).toEqual([true, false, false, true])
  expect(w.runs.filter(x => x.argv[3] === 'runner').length).toBe(1)
})

test('band off and pane never opened: no sampling at all', async ($, on) => {
  const w = world(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:/code/app' } as any)
  await w.clock.advance(60000)
  expect(w.runs.length).toBe(0)
})

test('band on: sampling starts with the session, at band.interval_s', { options: { band: 'on' } } as any, async ($, on) => {
  const w = world(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:/code/app' } as any)
  await w.clock.settle()
  await w.clock.advance(15000)
  expect(w.runs.filter(x => x.argv[3] === 'sample').length).toBe(2)
})
