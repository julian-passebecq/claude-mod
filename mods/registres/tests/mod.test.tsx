// registres mod with the Claude Code test kit: claude plugin test mods/registres
// Invented problems, apps, accounts and folders only.
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const HUB = {
  data_dir: '~/.claude/registres', default_tab: 'problemes', tabs: ['problemes', 'tests', 'regles', 'menage'],
  aliases: ['problemes', 'tests', 'regles', 'menage'], alias_delay_ms: 1000,
  labels: { pane_title: 'Registres', tabs: { problemes: 'Problèmes', tests: 'Tests réels', regles: 'Règles', menage: 'Ménage' }, tab_hint: '/registres', notes: ['lecture seule'] },
}
const PCFG = {
  data_dir: '~/.claude/problemes', node: 'node', refresh_min: 30, collect: { backfill_days: 14 },
  categories: [{ id: 'workflow', label: 'Workflow', children: [{ id: 'workflow/gardes', label: 'Gardes worktree' }] }, { id: 'mods', label: 'Mods' }],
  colors: { ouvert: 'error' },
  labels: {
    top: '{open} ouverts · {fixed} corrigés', subtitle: 'collecté il y a {age}', first: 'Premier passage ({days} jours)', collecting: 'collecte en cours…',
    f_status: 'Statut', f_week: 'Période', f_category: 'Catégorie', f_app: 'Application', all: 'Tous', status_names: { ouvert: 'Ouverts' }, week_names: { all: 'Toutes' },
    node: '{label} · {open} ouverts / {total}', problem: '{id} · {title} · ×{count} · {status}', empty: 'rien', more: '… {n}', other: 'Autres',
    symptom: 'Symptôme', cause: 'Cause', fix: 'Correctif', seen: 'Vu', seen_line: 'source {source}', unknown: '?', note_label: 'note', note_submit: 'noter',
  },
}
const P = (id: string, category: string, extra: any = {}) => ({
  id, category, status: 'ouvert', title: `titre ${id}`, symptom: `symptôme ${id}`, count: 2, app: 'shop', apps: ['shop'], first_seen: NOW - 3600000,
  last_seen: NOW - 60000, source: 'auto', evidence: [], timeline: [], notes: [], ...extra,
})
const SNAP = { collected: NOW - 5 * 60000, problems: [P('P-001', 'workflow/gardes'), P('P-002', 'mods', { title: 'Mod veille en erreur', source: 'veille' })] }
const TCFG = {
  data_dir: '~/.claude/tests-reels', open: ['todo', 'app:Demo Studio'], secret_stores: { wincred: 'Windows' },
  labels: {
    subtitle: '{apps} appli(s)', totals: '{environments} env', refresh: '↻ relire', recover: 'Lancer la récupération', todo_title: 'À ranger', todo_none: 'rien à ranger',
    apps_title: 'Applications', envs: 'Environnements', accounts: 'Comptes de test', procedures: 'Procédures', runs: 'Derniers essais', checks: 'Vérifications',
    show: 'voir', hide: 'masquer', secret_at: 'secret : {store} · {target}', secret_none: 'secret non enregistré', none: 'aucun', never_scanned: 'jamais',
  },
}
const REGISTRY = { apps: [{ name: 'Demo Studio', environments: [{ name: 'TEST', kind: 'tenant' }], accounts: [{ login: 'pilot.tester@example.org', env: 'TEST', secret_ref: { store: 'wincred', target: 'demo-target' } }], procedures: [] }] }
const MCFG = { data_dir: '~/.claude/metrics-mod', refresh_min: 30, history_days: 30, labels: { first_scan: 'Premier calcul ({days} jours)' } }
const MECFG = {
  data_dir: '~/.claude/menage-mod', refresh_min: 30, colors: { safe: 'success', check: 'warning', danger: 'error' },
  labels: { subtitle: '{repos} dépôts · il y a {age}', total_sure: 'sûr : {bytes}', total_check: 'à vérifier : {bytes}', filter_all: 'Tout', filter_safe: 'Récupérable', filter_danger: 'Ne pas supprimer', copy: 'Copier', copy_all: 'Tout copier', empty: 'rien', refresh: '↻' },
}
const MENAGE = { generated: NOW - 60000, repos: 2, totals: { sure: 2048 }, sections: [{ id: 'wt', title: 'Worktrees', rows: [{ level: 'safe', title: 'shop/.claude/worktrees/old', reclaim: 2048, command: 'git -C "C:/code/shop" worktree remove "old"' }] }] }

function world(on: any, opts: { list?: any[]; metrics?: any } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const runs: string[][] = []
  const opened: string[] = []
  const registered: string[] = []
  const passed: string[] = []
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p.endsWith('/registres/registres.config.json') && !p.includes('/.claude/registres/')) return { value: JSON.stringify(HUB) }
    if (p.endsWith('/lib/problemes/problemes.config.json')) return { value: JSON.stringify(PCFG) }
    if (p.endsWith('/lib/tests-reels/tests-reels.config.json')) return { value: JSON.stringify(TCFG) }
    if (p.endsWith('/lib/metrics/metrics.config.json')) return { value: JSON.stringify(MCFG) }
    if (p.endsWith('/lib/menage/menage.config.json')) return { value: JSON.stringify(MECFG) }
    if (p.endsWith('/.claude/problemes/problems.json')) return { value: JSON.stringify(SNAP) }
    if (p.endsWith('/.claude/tests-reels/registry.json')) return { value: JSON.stringify(REGISTRY) }
    if (p.endsWith('/.claude/menage-mod/menage.json')) return { value: JSON.stringify(MENAGE) }
    if (opts.metrics && p.endsWith('/.claude/metrics-mod/metrics.json')) return { value: JSON.stringify(opts.metrics) }
    throw new Error('ENOENT ' + p)
  })
  on('process.run', ($: any, e: any) => (runs.push(e.argv ?? e), { value: { exitCode: 0, stdout: '{}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.list', () => ({ value: opts.list ?? [] }))
  on('command.register', ($: any, e: any) => (registered.push(e.name), { value: undefined }))
  on('command.run', ($: any, e: any) => (passed.push(e.command), { value: {} }))
  on('ui.open', ($: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', ($: any, e: any) => (opened.push(`close:${e.id}`), { value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { runs, opened, registered, passed, clock }
}

const PANE = { title: 'Registres', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} } as const
const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'registres', component: 'Pane', requestId: 'registres', surface, viewport: { columns: 130, rows: 200 }, props: PANE })
const ran = (w: any, script: string) => w.runs.filter((a: string[]) => a.some(x => String(x).replace(/\\/g, '/').includes(script)))

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/registres opens one pane with four tabs, Problèmes first, drawn by the owner's view (${surface})`, async ($, on) => {
    const w = world(on)
    const r = await $.command.run({ command: 'registres', args: '' } as any)
    expect((r as any).text ?? '').toBe('')
    expect(w.opened).toEqual(['registres'])
    const pane = await mount($, surface)
    for (const k of ['tab-problemes', 'tab-tests', 'tab-regles', 'tab-menage']) expect(await pane.find({ key: k })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^2 ouverts · 0 corrigés$/ })).toBeDefined()
    await pane.press({ key: 'cat-mods' })
    await pane.press({ key: 'mods-P-002' })
    expect(await pane.find({ type: 'Text', text: /source veille/ })).toBeDefined()
    expect(w.runs.length).toBe(0) // fresh register: no collect
  })

  test(`Tests réels tab: logins masked until revealed, never a secret value (${surface})`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'registres', args: '' } as any)
    const pane = await mount($, surface)
    await pane.press({ key: 'tab-tests' })
    expect(await pane.find({ type: 'Text', text: /secret : Windows · demo-target/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /pilot\.tester@example\.org/ })).toBeUndefined()
    expect(w.runs.length).toBe(0) // the recovery runs only on its button
    await pane.press({ key: 'recover' })
    await w.clock.settle()
    expect(ran(w, 'lib/tests-reels/scanner/recover.mjs').length).toBe(1)
  })
}

test('Règles tab without data runs the metrics scanner copy once; Ménage refresh forces its scanner copy', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'registres', args: 'regles' } as any)
  await w.clock.settle()
  expect(ran(w, 'lib/metrics/scanner/metrics_scan.mjs').length).toBe(1)
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /Premier calcul \(30 jours\)/ })).toBeDefined()
  await $.command.run({ command: 'registres', args: 'menage' } as any)
  await w.clock.settle()
  expect(ran(w, 'lib/menage/scanner/menage_scan.mjs').length).toBe(0) // fresh inventory
  await $.command.run({ command: 'registres', args: 'menage refresh' } as any)
  await w.clock.settle()
  const m = ran(w, 'lib/menage/scanner/menage_scan.mjs')
  expect(m.length).toBe(1)
  expect(m[0]).toContain('--force')
  const p2 = await mount($, 'desktop')
  expect(await p2.find({ type: 'Text', text: /shop\/\.claude\/worktrees\/old/ })).toBeDefined()
  await $.command.run({ command: 'registres', args: 'close' } as any)
  expect(w.opened).toContain('close:registres')
})

test('aliases: registered only when no other mod serves them; a served one passes through to its owner', async ($, on) => {
  const w = world(on, { list: [{ name: 'problemes', description: '', source: 'plugin', plugin: 'problemes' }, { name: 'registres', description: '', source: 'plugin', plugin: 'registres' }] })
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/shop', surface: 'terminal', isInteractive: true } as any)
  expect(w.registered).toEqual(['registres'])
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(w.registered.sort()).toEqual(['menage', 'registres', 'regles', 'tests'])
  await $.command.run({ command: 'problemes', args: '' } as any)
  expect(w.passed).toContain('problemes') // the problemes mod answers its own command
  expect(w.opened).toEqual([])
  await $.command.run({ command: 'tests', args: '' } as any)
  expect(w.opened).toEqual(['registres'])
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /secret : Windows · demo-target/ })).toBeDefined()
})
