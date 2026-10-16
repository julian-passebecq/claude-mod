// guide mod with the Claude Code test kit: claude plugin test mods/guide
// The test kit has no file system beneath the mod: a small guide and two mods stand in for the real files.
import { expect, test } from 'claude-code/testing'

const MD = [
  "# Mode d'emploi des mods",
  '',
  'Intro.',
  '',
  '<!-- toc:start -->',
  '<!-- toc:end -->',
  '',
  '## Bases',
  '',
  'Le début.',
  '',
  '### Ce qu’est un mod',
  '',
  '#### Un mod en une phrase',
  '',
  'Un plugin fait de hooks.',
  '',
  '#### Ce que fait un hook',
  '',
  'Observer, réécrire, répondre.',
  '',
  '## Tester',
  '',
  '### Valider',
  '',
  '#### claude plugin validate',
  '',
  'Lit le manifeste.',
  '',
  '## Nos mods',
  '',
  '<!-- mods:start -->',
  '(snapshot)',
  '<!-- mods:end -->',
].join('\n')

const CATALOG = JSON.stringify({
  states: { stable: 'stable', planned: 'prévu' },
  mods: [
    { dir: 'demo', state: 'stable', data: 'rien', tests: ['claude plugin test mods/demo'] },
    { dir: 'band', name: 'band V6', state: 'planned', description: 'Bandeau prévu.' },
  ],
  archived: [{ name: 'cc-control (gardes)', verdict: 'rejeté', why: 'bloquait' }],
})
const DEMO_SRC = "on('session.start', async ($, e, next) => { await $.command.register({ name: 'demo', description: 'd' }); return next(e) })\non('ui.render', { component: 'Pane', requestId: 'demo' }, () => null)"

const PANE = { title: 'x', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } as const

function world(on: any) {
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p.endsWith('/guide/MODE-EMPLOI.md')) return { value: MD }
    if (p.endsWith('/guide/mods.json')) return { value: CATALOG }
    if (p.endsWith('/demo/.claude-plugin/plugin.json')) return { value: JSON.stringify({ name: 'demo', version: '1.2.3', description: 'Un mod de démo lu en direct.' }) }
    if (p.endsWith('/demo/hooks/hooks.json')) return { value: '{ "modules": ["./register.tsx"] }' }
    if (p.endsWith('/demo/hooks/register.tsx')) return { value: DEMO_SRC }
    throw new Error('ENOENT ' + p)
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
}

const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'guide', component: 'Pane', requestId: 'mods-guide', surface, viewport: { columns: 120, rows: 80 }, props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`Sommaire links every tab, category and sub-section; tabs fold their categories (${surface})`, async ($, on) => {
    world(on)
    const pane = await mount($, surface)
    // Sommaire: the whole tree
    expect(await pane.find({ type: 'Text', text: /Sommaire général/ })).toBeDefined()
    for (const key of ['go-bases', 'go-ce-quest-un-mod', 'go-un-mod-en-une-phrase', 'go-tester', 'go-claude-plugin-validate', 'go-nos-mods', 'go-fiches', 'go-fiche-demo', 'go-fiche-band-v6', 'go-archivés--rejetés']) {
      expect(await pane.find({ key } as any)).toBeDefined()
    }
    // a sub-section link opens its tab, unfolds its category and marks it
    await pane.press({ key: 'go-ce-que-fait-un-hook' })
    expect(await pane.find({ type: 'Text', text: /^→ Ce que fait un hook$/ })).toBeDefined()
    expect(await pane.find({ type: 'Markdown', text: /Observer, réécrire, répondre/ })).toBeDefined()
    // fold, then a tab button
    await pane.press({ key: 'cat-ce-quest-un-mod' })
    expect(await pane.find({ type: 'Markdown', text: /Observer, réécrire/ })).toBeUndefined()
    await pane.press({ key: 'tab-tester' })
    expect(await pane.find({ type: 'Button', text: /▸ Valider \(1\)/ })).toBeDefined()
    await pane.press({ key: 'cat-valider' })
    expect(await pane.find({ type: 'Markdown', text: /Lit le manifeste/ })).toBeDefined()
    // Nos mods: cards rebuilt from the mod's own files, not the snapshot
    await pane.press({ key: 'tab-nos-mods' })
    await pane.press({ key: 'cat-fiches' })
    expect(await pane.find({ type: 'Markdown', text: /Un mod de démo lu en direct/ })).toBeDefined()
    expect(await pane.find({ type: 'Markdown', text: /commandes `\/demo`/ })).toBeDefined()
    expect(await pane.find({ type: 'Markdown', text: /\(snapshot\)/ })).toBeUndefined()
    await pane.press({ key: 'back' })
    expect(await pane.find({ type: 'Text', text: /Sommaire général/ })).toBeDefined()
    await pane.unmount()
  })
}

test('/mods-guide opens on a tab or section by name; an unknown one lists the tabs', async ($, on) => {
  world(on)
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/x', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'mods-guide', args: 'claude plugin' } as any)
  expect(r.text).toMatch(/ouvert sur Tester › valider › claude-plugin-validate/)
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /^→ claude plugin validate$/ })).toBeDefined()
  await pane.unmount()
  const bad = await $.command.run({ command: 'mods-guide', args: 'zzz' } as any)
  expect(bad.text).toMatch(/pas de section « zzz »\. Onglets : Bases, Tester, Nos mods/)
  const home = await $.command.run({ command: 'mods-guide', args: '' } as any)
  expect(home.text).toMatch(/ouvert sur Sommaire/)
})
