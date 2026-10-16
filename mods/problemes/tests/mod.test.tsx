// problemes mod with the Claude Code test kit: claude plugin test mods/problemes
// Invented problems, apps and sessions only.
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const CONFIG = {
  data_dir: '~/.claude/problemes', node: 'node', refresh_min: 30, max_problems_per_node: 1, collect: { backfill_days: 14 },
  categories: [
    { id: 'blocages', label: 'Blocages manuels', children: [{ id: 'blocages/question', label: 'Questions à Julian' }] },
    { id: 'workflow', label: 'Workflow', children: [{ id: 'workflow/gardes', label: 'Gardes worktree' }] },
    { id: 'apps', label: 'Par application', dynamic: 'app' },
    { id: 'mods', label: 'Mods' },
  ],
  colors: { ouvert: 'error', 'corrigé': 'success', 'contourné': 'warning', 'accepté': 'inactive' },
  labels: {
    pane_title: 'Problèmes', top: '{open} ouverts · {fixed} corrigés · cette semaine +{week}', subtitle: 'registre local · collecté il y a {age}',
    first: 'Premier passage ({days} jours)', empty_ledger: 'Registre vide', collecting: 'collecte en cours…', refresh: '↻',
    f_status: 'Statut', f_week: 'Période', f_category: 'Catégorie', f_app: 'Application', all: 'Tous',
    status_names: { ouvert: 'Ouverts', 'corrigé': 'Corrigés' }, week_names: { all: 'Toutes', this: 'Cette semaine' }, apps_max: 5,
    node: '{label} · {open} ouverts / {total}', cross: 'vue croisée', problem: '{id} · {title} · ×{count} · {status}',
    symptom: 'Symptôme', cause: 'Cause', fix: 'Correctif', seen: 'Vu', seen_line: '{count} fois', evidence: 'Preuves', timeline: 'Chronologie',
    notes: 'Notes', note_label: 'Ajouter une note', note_placeholder: '…', note_submit: 'noter', note_saved: 'note ajoutée à {id}',
    note_failed: 'note non écrite : {error}', unknown: 'non renseigné', more: '… et {n} de plus', other: 'Autres', empty: 'rien',
    collect_stats: '{files} fichiers lus', notes_doc: ['doc'],
  },
}
const P = (id: string, category: string, status: string, extra: any = {}) => ({
  id, category, status, title: `titre ${id}`, symptom: `symptôme ${id}`, cause: '', fix: 'PR https://example.com/pr/4', count: 3, app: 'shop', apps: ['shop'],
  first_seen: NOW - 3600000, last_seen: NOW - 60000, source: 'auto', evidence: [{ at: NOW - 60000, session: 'abcdef1234', text: 'isolated in the worktree' }],
  timeline: [{ at: NOW - 60000, n: 3 }], notes: [{ at: NOW - 30000, text: 'compris : chemins du checkout principal' }], ...extra,
})
const SNAP = {
  v: 1, generated: NOW - 5 * 60000, collected: NOW - 5 * 60000, stats: { files: 4 },
  problems: [
    P('P-001', 'workflow/gardes', 'ouvert'),
    P('P-002', 'blocages/question', 'corrigé', { app: 'blog', apps: ['blog'], first_seen: NOW - 30 * 86400000 }),
    P('P-003', 'blocages/question', 'ouvert', { app: 'blog', apps: ['blog'] }),
  ],
}

function world(on: any, snap: any = SNAP) {
  const clock = mock.clock(on, { now: NOW })
  const runs: string[][] = []
  const opened: string[] = []
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p.endsWith('/problemes/problemes.config.json') && !p.includes('/.claude/problemes/')) return { value: JSON.stringify(CONFIG) }
    if (snap && p.endsWith('/.claude/problemes/problems.json')) return { value: JSON.stringify(snap) }
    throw new Error('ENOENT ' + p)
  })
  on('process.run', ($: any, e: any) => (runs.push(e.argv ?? e), { value: { exitCode: 0, stdout: '{}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', ($: any, e: any) => (opened.push(`close:${e.id}`), { value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { runs, opened, clock }
}

const PANE = { title: 'Problèmes', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} } as const
const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'problemes', component: 'Pane', requestId: 'problemes', surface, viewport: { columns: 130, rows: 200 }, props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`top line, collapsed categories with one-line summaries, then a problem's details and a note (${surface})`, async ($, on) => {
    const w = world(on)
    const pane = await mount($, surface)
    expect(await pane.find({ type: 'Text', text: /^2 ouverts · 1 corrigés · cette semaine \+2$/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', text: /▸ Workflow · 1 ouverts \/ 1/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /P-001 titre P-001/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^\s+rien$/ })).toBeDefined() // Mods: empty summary
    expect(await pane.find({ type: 'Button', text: /▸ Par application · 2 ouverts \/ 3/ })).toBeDefined()
    await pane.press({ key: 'cat-workflow' })
    await pane.press({ key: 'cat-workflow/gardes' })
    expect(await pane.find({ type: 'Button', text: /▸ P-001 · titre P-001 · ×3 · ouvert/ })).toBeDefined()
    await pane.press({ key: 'workflow/gardes-P-001' })
    expect(await pane.find({ type: 'Text', text: /symptôme P-001/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /session abcdef12 · isolated in the worktree/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /compris : chemins du checkout principal/ })).toBeDefined()
    expect(w.runs.length).toBe(0) // drawing and opening never run anything
    await pane.input({ key: 'note-P-001', text: 'cause trouvée' })
    expect(w.runs.some(a => a.join(' ').endsWith('problemes_scan.mjs note P-001 cause trouvée'))).toBe(true)
    expect(await pane.find({ type: 'Text', text: /note ajoutée à P-001/ })).toBeDefined()
    await pane.unmount()
  })
}

test('filters: status, category and app hide the other problems', async ($, on) => {
  world(on)
  const pane = await mount($, 'terminal')
  await pane.press({ key: 'f-status-corrigé' })
  expect(await pane.find({ type: 'Button', text: /▸ Workflow · 0 ouverts \/ 0/ })).toBeDefined()
  await pane.press({ key: 'f-status-all' })
  await pane.press({ key: 'f-app-shop' })
  expect(await pane.find({ type: 'Button', text: /▸ Blocages manuels · 0 ouverts \/ 0/ })).toBeDefined()
  await pane.press({ key: 'f-app-all' })
  await pane.press({ key: 'f-cat-blocages' })
  await pane.press({ key: 'cat-blocages' })
  await pane.press({ key: 'cat-blocages/question' })
  expect(await pane.find({ type: 'Button', text: /P-003 · titre P-003/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /… et 1 de plus/ })).toBeDefined() // max 1 per node in this config
  await pane.unmount()
})

test('/problemes opens the pane, returns no text, collects only when stale, and P-NNN opens that problem', async ($, on) => {
  const w = world(on, { ...SNAP, collected: NOW - 2 * 3600000 })
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/x', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'problemes', args: 'P-003' } as any)
  expect(r.text).toBeUndefined()
  expect(w.opened).toEqual(['problemes'])
  await w.clock.advance(10)
  expect(w.runs.some(a => a.join(' ').includes('problemes_scan.mjs collect'))).toBe(true)
  const pane = await mount($, 'desktop')
  expect(await pane.find({ type: 'Text', text: /symptôme P-003/ })).toBeDefined()
  await pane.unmount()
  const c = await $.command.run({ command: 'problemes', args: 'close' } as any)
  expect(c.text).toBeUndefined()
  expect(w.opened).toEqual(['problemes', 'close:problemes'])
})

test('without a register the command collects once and the pane says it is the first pass', async ($, on) => {
  const w = world(on, null)
  await $.command.run({ command: 'problemes', args: '' } as any)
  await w.clock.advance(10)
  expect(w.runs.length).toBe(1)
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /Premier passage \(14 jours\)/ })).toBeDefined()
  await pane.unmount()
})

test('« Exporter vers eta » and /problemes export run the scanner export (masked register → eta by PR)', async ($, on) => {
  const w = world(on)
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Button', text: /^Exporter vers eta$/ })).toBeDefined()
  await pane.press({ key: 'export-eta' })
  await w.clock.advance(10)
  expect(w.runs.some(a => a.join(' ').endsWith('problemes_scan.mjs export'))).toBe(true)
  await pane.unmount()
  const n = w.runs.length
  await $.command.run({ command: 'problemes', args: 'export' } as any)
  await w.clock.advance(10)
  expect(w.runs.slice(n).some(a => a.join(' ').endsWith('problemes_scan.mjs export'))).toBe(true)
})
