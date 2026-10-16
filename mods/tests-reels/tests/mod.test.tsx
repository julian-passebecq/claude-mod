// tests-reels mod with the Claude Code test kit: claude plugin test mods/tests-reels
// Invented data only.
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const CONFIG = {
  data_dir: '~/.claude/tests-reels', node: 'node', max_rows: 5, open: ['todo'],
  required_ids: { tenant: ['tenant'], cloud: ['url'] },
  secret_stores: { wincred: "Gestionnaire d'identification Windows" },
  store_instruction: 'ranger avec cmdkey',
  colors: { pass: 'success', fail: 'error', never: 'inactive', todo: 'warning', warn: 'warning' },
  labels: {
    pane_title: 'Tests réels', subtitle: 'lecture seule · {apps} appli(s) · registre {reg} · récupération {rec}', never_scanned: 'jamais',
    empty: 'Registre vide', totals: '{environments} env · {never} jamais', refresh: '↻ relire', recover: 'Lancer la récupération',
    recovering: 'récupération en cours…', recover_done: 'récupération : {apps} appli(s), {secrets_seen} secret(s) vu(s)',
    todo_title: 'À ranger', todo_summary: '{n} ligne(s) · {secrets} secret(s) vu(s)', todo_none: 'rien à ranger',
    apps_title: 'Applications', never_real: 'jamais testé en réel', envs: 'Environnements', accounts: 'Comptes de test',
    procedures: 'Procédures', runs: 'Derniers essais', checks: 'Vérifications manuelles', recovered: "Trouvé dans l'historique",
    show: 'voir', hide: 'masquer', secret_at: 'secret : {store} · {target}', secret_none: 'secret non enregistré',
    result_pass: '✓ réussi', result_fail: '✗ échoué', result_never: '○ jamais', none: 'aucun', more: '… et {n} de plus', notes: ['note'],
  },
}
const REGISTRY = {
  updated: '2026-10-16T11:00:00Z',
  apps: [
    {
      name: 'Demo Studio',
      environments: [{ name: 'TEST tenant', kind: 'tenant', ids: { tenant: '00000000-0000-4000-8000-000000000001' } }],
      accounts: [{ login: 'pilot.tester@example.org', env: 'TEST tenant', secret_ref: { store: 'wincred', target: 'demo-tenant-pilot' } }],
      procedures: [{ name: 'Lecture live', env: 'TEST tenant', kind: 'live' }],
    },
    { name: 'Demo Worker', environments: [{ name: 'QA', kind: 'cloud' }], accounts: [{ login: 'owner@example.org' }], procedures: [] },
  ],
}
const RUNS = JSON.stringify({ date: '2026-10-15T09:00:00Z', app: 'Demo Studio', env: 'TEST tenant', procedure: 'Lecture live', result: 'fail' }) + '\n'

function world(on: any, registry: any = REGISTRY) {
  const clock = mock.clock(on, { now: NOW })
  const runs: string[][] = []
  const opened: string[] = []
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p.endsWith('/tests-reels/tests-reels.config.json')) return { value: JSON.stringify(CONFIG) }
    if (registry && p.endsWith('/.claude/tests-reels/registry.json')) return { value: JSON.stringify(registry) }
    if (registry && p.endsWith('/.claude/tests-reels/runs.jsonl')) return { value: RUNS }
    throw new Error('ENOENT ' + p)
  })
  on('process.run', ($: any, e: any) => (runs.push(e.argv ?? e), { value: { exitCode: 0, stdout: '{"ok":true,"counts":{"apps":2,"secrets_seen":3}}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', ($: any, e: any) => (opened.push(`close:${e.id}`), { value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { runs, opened, clock }
}

const PANE = { title: 'Tests réels', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } as const
const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'tests-reels', component: 'Pane', requestId: 'tests-reels', surface, viewport: { columns: 130, rows: 120 }, props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`apps fold to one summary line, accounts are masked until « voir », À ranger lists what is missing (${surface})`, async ($, on) => {
    const w = world(on)
    const pane = await mount($, surface)
    expect(await pane.find({ type: 'Text', text: /lecture seule · 2 appli\(s\) · registre 1 h/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /2 ligne\(s\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Demo Worker · owner@example\.org : secret non enregistré/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /id manquant : QA : url/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /jamais testé en réel/ })).toBeDefined()
    // folded: nothing of the app body yet
    expect(await pane.find({ type: 'Text', text: /pi•••@ex•••/ })).toBeUndefined()
    await pane.press({ key: 't-app_Demo_Studio' })
    expect(await pane.find({ type: 'Text', text: /pi•••@ex•••/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /pilot\.tester@example\.org/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /secret : Gestionnaire d'identification Windows · demo-tenant-pilot/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Lecture live · TEST tenant · live · ✗ échoué 2026-10-15/ })).toBeDefined()
    await pane.press({ key: 'rv-Demo_Studio_pilot_tester_example_org' })
    expect(await pane.find({ type: 'Text', text: /● pilot\.tester@example\.org/ })).toBeDefined()
    expect(w.runs.length).toBe(0) // drawing and folding never run anything
    await pane.unmount()
  })
}

test('the recovery button runs the scanner and shows counts only', async ($, on) => {
  const w = world(on)
  const pane = await mount($, 'terminal')
  await pane.press({ key: 'recover' })
  await w.clock.advance(10)
  expect(w.runs.some(a => a.join(' ').includes('scanner/recover.mjs'))).toBe(true)
  expect(await pane.find({ type: 'Text', text: /récupération : 2 appli\(s\), 3 secret\(s\) vu\(s\)/ })).toBeDefined()
  await pane.unmount()
})

test('/tests opens the pane, returns no text for the model, close closes it, nothing runs', async ($, on) => {
  const w = world(on)
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/x', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'tests', args: '' } as any)
  expect(r.text).toBeUndefined()
  const c = await $.command.run({ command: 'tests', args: 'close' } as any)
  expect(c.text).toBeUndefined()
  expect(w.opened).toEqual(['tests-reels', 'close:tests-reels'])
  await w.clock.advance(10)
  expect(w.runs.length).toBe(0)
})

test('an empty registry says how to start', async ($, on) => {
  world(on, null)
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /Registre vide/ })).toBeDefined()
  await pane.unmount()
})
