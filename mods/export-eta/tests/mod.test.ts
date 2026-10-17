// Hook tests for export-eta with the Claude Code test kit: claude plugin test mods/export-eta
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const MIN = 60000
const CONFIG = JSON.stringify({
  node: 'node', batch_min: 3, eta: { repo: 'C:/code/eta' }, pane: { refresh_s: 300, max_rows: 40, history: 10 },
  labels: {
    pane_title: 'Export eta', tab_ongoing: 'En cours', tab_selection: 'Sélection', tab_batch: 'Lot terminé', tab_history: 'Exports',
    export_now: 'Exporter maintenant', export_selection: 'Exporter la sélection ({n})', export_batch: 'Exporter vers eta',
    batch_notice: '{n} conversations terminées — Exporter vers eta', batch_none: 'Aucun lot prêt ({n}, seuil {min}).', busy: 'export en cours…',
  },
  colors: { warn: '#d97706' },
})
const PENDING = JSON.stringify({ generated: NOW - MIN, ready: true, reason: 'count', count: 4, ids: ['a', 'b', 'c', 'd'], text: '4 conversations terminées — Exporter vers eta', titles: [{ cli: 'a', title: 'Lane A', project: 'app' }] })
const SESSIONS = JSON.stringify({ generated: NOW, sessions: [
  { cli: 'a', title: 'Lane A', project: 'app', state: 'finished', last_activity: NOW - 30 * MIN },
  { cli: 'o', title: 'Lead live', project: 'app', state: 'ongoing', last_activity: NOW - 2 * MIN },
] })
const STATE = JSON.stringify({ since: NOW - 86400000, exported: {}, history: [{ at: NOW - 10 * MIN, mode: 'batch', count: 3, pr: 41, url: 'https://github.com/o/eta/pull/41', merged: true, masked: { email: 2, 'github-token': 1 }, held: [{ title: 'Leaky lane' }] }] })

function base(on, pending = PENDING, o: { stdout?: string, toasts?: string[], opened?: string[] } = {}) {
  mock.clock(on, { now: NOW })
  on('session.start', ($: any, e: any) => e)
  const files: Record<string, string> = { 'export-eta/config.json': CONFIG, 'export-eta/pending.json': pending, 'export-eta/sessions.json': SESSIONS, 'export-eta/state.json': STATE }
  const hit = (p: string) => Object.keys(files).find((k) => p.replace(/\\/g, '/').endsWith('.claude/' + k))
  const runs: string[][] = []
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.exists', ($, e) => ({ value: !!hit(String(e.path)) || String(e.path).endsWith('export-eta.config.json') }))
  on('fs.read', ($, e) => {
    const k = hit(String(e.path))
    if (k) return { value: files[k] }
    if (String(e.path).endsWith('export-eta.config.json')) return { value: '{}' }
    throw new Error('ENOENT')
  })
  on('process.run', ($, e) => (runs.push(e.argv ?? e), { value: { exitCode: 0, stdout: o.stdout || 'export-eta: ok · 4 exportée(s)', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($, e) => { (o.opened || []).push(e.id); return { value: { isPlaced: true } } })
  on('ui.toast', ($, e) => { (o.toasts || []).push(e.text); return { value: undefined } })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  return { runs }
}

const has = async (ui, re: RegExp) => (await ui.find({ type: 'Text', text: re })) !== undefined || (await ui.find({ type: 'Button', text: re })) !== undefined
const PANE = { title: 'Export eta', isFocused: true, bodyColumns: 120, placement: 'inline', scroll: { offset: 0, bodyRows: 60 }, view: {} }
const pane = ($, surface: 'terminal' | 'desktop') => $.ui.mount({ plugin: 'export-eta', component: 'Pane', requestId: 'export-eta', surface, viewport: { columns: 140, rows: 60 }, props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/export opens the pane on the ready batch with its button and the tabs (${surface})`, async ($, on) => {
    base(on)
    await $.session.start({ cwd: 'C:/code/app', surface: 'terminal', isInteractive: true } as any)
    await $.command.run({ command: 'export-eta', args: '' })
    const ui = await pane($, surface)
    expect(await has(ui, /4 conversations terminées — Exporter vers eta/)).toBe(true)
    expect(await has(ui, /^Exporter vers eta$/)).toBe(true)
    expect(await has(ui, /^Sélection$/)).toBe(true)
    expect(await has(ui, /app · Lane A/)).toBe(true)
  })

  test(`the band line shows the batch notice with « Exporter vers eta » (${surface})`, async ($, on) => {
    base(on)
    await $.session.start({ cwd: 'C:/code/app', surface: 'terminal', isInteractive: true } as any)
    const ui = await $.ui.mount({ plugin: 'export-eta', component: 'AbovePrompt', surface, viewport: { columns: 140, rows: 10 }, props: {} })
    expect(await has(ui, /4 conversations terminées — Exporter vers eta/)).toBe(true)
    expect(await has(ui, /^Exporter vers eta$/)).toBe(true)
  })
}

test('no batch ready: no band line', async ($, on) => {
  base(on, JSON.stringify({ generated: NOW, ready: false, count: 1, ids: ['a'] }))
  await $.session.start({ cwd: 'C:/code/app', surface: 'terminal', isInteractive: true } as any)
  const ui = await $.ui.mount({ plugin: 'export-eta', component: 'AbovePrompt', surface: 'terminal', viewport: { columns: 140, rows: 10 }, props: {} })
  expect(await has(ui, /Exporter vers eta/)).toBe(false)
})

test('the batch button runs the exporter in batch mode; the history tab shows the PR, masked counts and held files', async ($, on) => {
  const w = base(on)
  await $.session.start({ cwd: 'C:/code/app', surface: 'terminal', isInteractive: true } as any)
  await $.command.run({ command: 'export-eta', args: '' })
  const ui = await pane($, 'terminal')
  await ui.press({ plugin: 'export-eta', key: 'batch-export' })
  await new Promise((r) => setTimeout(r, 30))
  expect(w.runs.some((a) => a.join(' ').includes('export.mjs run --mode batch'))).toBe(true)
  expect(await has(ui, /masqués : email 2, github-token 1/)).toBe(true)
  expect(await has(ui, /retenues : Leaky lane/)).toBe(true)
})

test('/export-tout runs the exporter once in tout mode, no pane, and toasts its one-line result', async ($, on) => {
  const toasts: string[] = []
  const opened: string[] = []
  const w = base(on, PENDING, { stdout: 'export-eta: Exporté : 31 fichiers, PR #52 mergée', toasts, opened })
  await $.session.start({ cwd: 'C:/code/app', surface: 'terminal', isInteractive: true } as any)
  await $.command.run({ command: 'export-tout', args: '' })
  await new Promise((r) => setTimeout(r, 50))
  expect(w.runs.filter((a) => a.join(' ').includes('export.mjs tout')).length).toBe(1)
  expect(opened.length).toBe(0)
  expect(toasts.includes('Exporté : 31 fichiers, PR #52 mergée')).toBe(true)
})

test('/export-eta tout is the same one-click export', async ($, on) => {
  const w = base(on)
  await $.session.start({ cwd: 'C:/code/app', surface: 'terminal', isInteractive: true } as any)
  await $.command.run({ command: 'export-eta', args: 'tout' })
  await new Promise((r) => setTimeout(r, 50))
  expect(w.runs.some((a) => a.join(' ').includes('export.mjs tout'))).toBe(true)
})
