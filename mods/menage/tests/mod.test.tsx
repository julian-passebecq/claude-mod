// menage mod with the Claude Code test kit: claude plugin test mods/menage
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const CONFIG = {
  data_dir: '~/.claude/menage-mod', node: 'node', refresh_min: 30, max_rows: 2,
  colors: { safe: 'success', check: 'warning', danger: 'error', dim: 'inactive' },
  labels: {
    pane_title: 'Ménage', subtitle: 'lecture seule · {repos} dépôts · scanné il y a {age}', first_scan: 'Premier inventaire en cours',
    total_sure: 'Récupérable sans risque : {bytes}', total_check: 'à vérifier : {bytes}', total_danger: '{n} éléments à ne pas supprimer',
    filter_all: 'Tout', filter_safe: 'Récupérable', filter_danger: 'Ne pas supprimer', refresh: '↻', copy_all: 'Copier les commandes sûres',
    copy: 'Copier', copied: 'copié : {n} commande(s)', copy_failed: 'copie impossible', danger_tag: 'ne pas supprimer', check_tag: 'à vérifier',
    more: '… et {n} de plus', empty: 'rien', notes: ['note {base}'],
  },
}
const MODEL = {
  generated: NOW - 5 * 60000, repos: 2, totals: { sure: 3 * 1024 ** 3, check: 512 * 1024 ** 2, danger: 1 },
  errors: [],
  sections: [
    {
      id: 'worktrees', title: 'Worktrees',
      rows: [
        { level: 'danger', title: 'app/.claude/worktrees/busy', meta: 'feat/busy · 1,0 Go', reasons: ['modifié : 2 fichiers modifiés, 0 non suivis'], command: '', reclaim: 0, size: 1 },
        { level: 'safe', title: 'app/.claude/worktrees/done', meta: 'feat/done · 3,0 Go', reasons: ['mergée', 'propre'], command: 'git -C "C:/code/app" worktree remove "C:/code/app/.claude/worktrees/done"', reclaim: 3 * 1024 ** 3, size: 1 },
        { level: 'safe', title: 'app/.claude/worktrees/third', meta: '', reasons: ['mergée'], command: 'git -C "C:/code/app" worktree remove "C:/code/app/.claude/worktrees/third"', reclaim: 0, size: 0 },
      ],
    },
    { id: 'branches', title: 'Branches locales mergées', rows: [{ level: 'check', title: 'app · feat/sq', meta: '', reasons: ['squash'], command: 'git -C "C:/code/app" branch -D feat/sq', reclaim: 0 }] },
    { id: 'transcripts', title: 'Transcripts par projet', summary: '2 projets', rows: [{ level: 'info', title: 'app', meta: '10 Mo', reasons: [], command: '' }] },
  ],
}

function world(on: any, model: any = MODEL) {
  const clock = mock.clock(on, { now: NOW })
  const runs: string[][] = []
  const opened: string[] = []
  const copies: string[] = []
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p.endsWith('/menage/menage.config.json')) return { value: JSON.stringify(CONFIG) }
    if (model && p.endsWith('/menage-mod/menage.json')) return { value: JSON.stringify(model) }
    throw new Error('ENOENT ' + p)
  })
  on('process.run', ($: any, e: any) => (runs.push(e.argv ?? e), { value: { exitCode: 0, stdout: '{"ok":true}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', ($: any, e: any) => (opened.push(`close:${e.id}`), { value: undefined }))
  on('ui.copy', ($: any, e: any) => (copies.push(e.text), { value: { isCopied: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { runs, opened, copies, clock }
}

const PANE = { title: 'Ménage', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } as const
const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'menage', component: 'Pane', requestId: 'menage', surface, viewport: { columns: 130, rows: 120 }, props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane shows totals, red "ne pas supprimer" rows and the commands, never running them (${surface})`, async ($, on) => {
    const w = world(on)
    const pane = await mount($, surface)
    expect(await pane.find({ type: 'Text', text: /lecture seule · 2 dépôts · scanné il y a 5 min/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Récupérable sans risque : 3,0 Go/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /1 éléments à ne pas supprimer/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /ne pas supprimer · modifié : 2 fichiers/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /worktree remove "C:\/code\/app\/\.claude\/worktrees\/done"$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /… et 1 de plus/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /à vérifier · squash/ })).toBeDefined()
    await pane.press({ key: 'copy-all' })
    expect(w.copies[0].split('\n').length).toBe(2)
    expect(w.copies[0]).not.toMatch(/branch -D/)
    await pane.press({ key: 'f-danger' })
    expect(await pane.find({ type: 'Text', text: /app\/\.claude\/worktrees\/done/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /app\/\.claude\/worktrees\/busy/ })).toBeDefined()
    expect(w.runs.length).toBe(0) // drawing and copying never run anything
    await pane.unmount()
  })
}

test('/menage opens the pane, returns no text for the model, and rescans only when stale', async ($, on) => {
  const w = world(on, { ...MODEL, generated: NOW - 2 * 3600000 })
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/x', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'menage', args: '' } as any)
  expect(r.text).toBeUndefined()
  expect(w.opened).toEqual(['menage'])
  await w.clock.advance(10)
  expect(w.runs.some(a => a.join(' ').includes('menage_scan.mjs scan'))).toBe(true)
  const c = await $.command.run({ command: 'menage', args: 'close' } as any)
  expect(c.text).toBeUndefined()
  expect(w.opened).toEqual(['menage', 'close:menage'])
})

test('a fresh inventory is not rescanned', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'menage', args: '' } as any)
  await w.clock.advance(10)
  expect(w.runs.length).toBe(0)
})

test('before the first scan the pane says it is computing', async ($, on) => {
  world(on, null)
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /Premier inventaire en cours/ })).toBeDefined()
  await pane.unmount()
})
