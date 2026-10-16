// sante mod with the Claude Code test kit: claude plugin test mods/sante
// Made-up folders and numbers only.
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const CONFIG = {
  data_dir: '~/.claude/sante-mod', health_dir: '~/.claude/mods-health', node: 'node', refresh_min: 10, default_min_version: '2.1.287',
  thresholds: { cache_warn_mb: 1, health_error_hours: 24 },
  cleanup_command: 'Remove-Item -LiteralPath "{path}" -Recurse',
  mods: { alpha: { stale_min: 30 } },
  colors: { ok: 'success', warn: 'warning', error: 'error', off: 'inactive' },
  icons: { ok: '●', warn: '●', error: '●', off: '○' },
  labels: { pane_title: 'Santé des mods', copy: 'Copier', copied: 'copié', notes: ['Lecture seule.'] },
}
const health = { mod: 'alpha', lastRun: '2026-10-16T11:58:00.000Z', durationMs: 420, cpuMs: 180, error: null, lastOk: '2026-10-16T11:58:00.000Z', window: { start: '2026-10-16T10:00:00.000Z', runs: 24, cpuMs: 4320, durationMs: 10080, errors: 0 } }
const mod = (name: string, over: any = {}) => ({
  key: name, name, dir: `C:/Users/me/mods/${name}`, source: 'env', exists: true, manifest: { ok: true, version: '0.1.0' }, hooks: { ok: true },
  expected: [name], configs: [{ path: `C:/Users/me/mods/${name}/${name}.config.json`, ok: true }], caches: [], logs: [], fields: [], ...over,
})
const REPORT = {
  generated: NOW - 60000,
  mods: [
    mod('alpha', { health, caches: [{ path: 'C:/Users/me/.claude/alpha-cache', bytes: 3 * 1024 * 1024, files: 4, newest: NOW - 120000 }] }),
    mod('beta', { configs: [{ path: 'C:/Users/me/.claude/beta.json', ok: false, error: 'Unexpected token' }] }),
    mod('gamma', { source: 'dir', dir: 'C:/Users/me/.claude/mods/gamma' }),
  ],
}

function world(on: any, report: any = REPORT) {
  const clock = mock.clock(on, { now: NOW })
  const runs: any[] = []
  const opened: string[] = []
  const copies: string[] = []
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : e.name === 'CLAUDE_CODE_PLUGIN_DIRS' ? 'C:/Users/me/mods/alpha;C:/Users/me/mods/beta' : undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p.endsWith('/sante/sante.config.json')) return { value: JSON.stringify(CONFIG) }
    if (report && p.endsWith('/sante-mod/report.json')) return { value: JSON.stringify(report) }
    throw new Error('ENOENT ' + p)
  })
  on('process.run', ($: any, e: any) => (runs.push(e), { value: { exitCode: 0, stdout: JSON.stringify({ ...REPORT, generated: NOW }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.list', () => ({ value: [{ name: 'alpha', description: '', source: 'plugin', plugin: 'alpha' }, { name: 'help', description: '', source: 'builtin' }] }))
  on('session.version', () => ({ value: { version: '2.1.293', base: '2.1.293' } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', ($: any, e: any) => (opened.push(`close:${e.id}`), { value: undefined }))
  on('ui.copy', ($: any, e: any) => (copies.push(e.text), { value: { isCopied: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { runs, opened, copies, clock }
}

const PANE = { title: 'Santé des mods', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } as const
const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'sante', component: 'Pane', requestId: 'sante', surface, viewport: { columns: 130, rows: 120 }, props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/sante draws the summary line first, each mod with its reasons, and copies a cleanup command (${surface})`, async ($, on) => {
    const w = world(on)
    on('session.start', ($: any, e: any) => e)
    await $.session.start({ cwd: 'C:/code/x', surface, isInteractive: true })
    const r = await $.command.run({ command: 'sante', args: '' } as any)
    expect(r.text).toBeUndefined()
    const pane = await mount($, surface)
    expect(await pane.find({ type: 'Text', text: /^● rouge · 2 mods actifs : 0 OK, 1 orange, 1 rouge · 1 non chargés · Claude Code 2\.1\.293 · beta : JSON invalide/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^● alpha 0\.1\.0 · chargé · CLAUDE_CODE_PLUGIN_DIRS · \/alpha · minimum 2\.1\.287$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /↳ cache lourd : C:\/Users\/me\/\.claude\/alpha-cache 3,0 Mo/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /dernier scan il y a 2 min · 420 ms · CPU 180 ms · 24 h : 24 runs \(12,0\/h\) · CPU 4,3 s ≈ 0,06 % d'un cœur/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /↳ dans CLAUDE_CODE_PLUGIN_DIRS mais aucune commande enregistrée \(\/beta\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /○ gamma 0\.1\.0 · dossier · ~\/\.claude\/mods\/gamma/ })).toBeDefined()
    await pane.press({ key: 'copy-alpha-0' })
    expect(w.copies).toEqual(['Remove-Item -LiteralPath "C:/Users/me/.claude/alpha-cache" -Recurse'])
    expect(w.runs.length).toBe(0) // a fresh report: no scan, and nothing is ever deleted
    await pane.unmount()
  })
}

test('a stale report rescans in the background with the env dirs; close closes', async ($, on) => {
  const w = world(on, { ...REPORT, generated: NOW - 3600000 })
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/x', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'sante', args: '' } as any)
  expect(w.opened).toEqual(['sante'])
  await w.clock.advance(10)
  expect(w.runs.length).toBe(1)
  const run0 = w.runs[0]
  const req = JSON.parse(run0.stdin ?? run0.init?.stdin ?? JSON.stringify(run0).slice(0, 0))
  expect(req.dirs).toEqual(['C:/Users/me/mods/alpha', 'C:/Users/me/mods/beta'])
  expect(String((run0.argv ?? run0).join(' '))).toMatch(/sante_scan\.mjs$/)
  const c = await $.command.run({ command: 'sante', args: 'close' } as any)
  expect(c.text).toBeUndefined()
  expect(w.opened).toEqual(['sante', 'close:sante'])
})

test('before the first scan the pane says so', async ($, on) => {
  world(on, null)
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /Premier examen des mods en cours/ })).toBeDefined()
  await pane.unmount()
})
