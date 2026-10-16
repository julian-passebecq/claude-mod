// Hook tests for a-faire with the Claude Code test kit: claude plugin test mods/a-faire
// Invented items only.
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const ITEMS = JSON.stringify({
  v: 1, at: NOW - 60000, errors: [],
  open: [
    { id: 'gap:smtp', src: 'gaps', cat: 'config', prio: 'feature', auto: true, title: 'Remplir smtp.json de la veille', why: 'smtp.json absent', since: NOW - 3 * 3600000,
      steps: [{ text: '4. Tester l’envoi', copy: 'node veille.mjs test-mail' }], source: { label: 'smtp.json', href: '' } },
    { id: 'veille:x', src: 'veille', cat: 'questions', prio: 'now', title: 'Attend Julian : choisir le nom', why: 'La conversation « Lane A » attend ta réponse', since: NOW - 600000,
      steps: [], source: { label: 'conversation', href: 'claude://claude.ai/epitaxy/local_1' } },
  ],
  snoozed: [{ id: 'm1' }],
})
const CFG = JSON.stringify({
  order: ['config', 'decisions', 'questions'], open: 'nonempty',
  categories: { config: 'Configuration', decisions: 'Décisions', questions: 'Questions des conversations' },
  priorities: { now: 'bloque une conversation', feature: 'bloque une fonction', comfort: 'confort' },
  labels: { title: 'À faire par Julian', done: 'Fait', later: 'Plus tard', copy: 'Copier', source: 'Voir la source', snoozed: 'Reporté(s)' },
})

function base(on, runs: string[][] = []) {
  mock.clock(on, { now: NOW })
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.exists', ($, e) => ({ value: /afaire\.config\.json$|a-faire[\\/]items\.json$/.test(String(e.path)) }))
  on('fs.read', ($, e) => ({ value: /items\.json$/.test(String(e.path)) ? ITEMS : CFG }))
  on('process.run', ($, e) => { runs.push(e.argv ?? e.command ?? []); return { value: { exitCode: 0, stdout: 'afaire: pas encore fait : smtp.json absent', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
}

const has = async (ui, re: RegExp) => (await ui.find({ type: 'Text', text: re })) !== undefined || (await ui.find({ type: 'Button', text: re })) !== undefined
const PANE = { title: 'À faire par Julian', isFocused: true, bodyColumns: 120, placement: 'inline', scroll: { offset: 0, bodyRows: 60 }, view: {} }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/afaire draws the counter, the categories, the items with Copier, Fait, Plus tard (${surface})`, async ($, on) => {
    base(on)
    await $.command.run({ command: 'afaire', args: '' })
    const ui = await $.ui.mount({ plugin: 'a-faire', component: 'Pane', requestId: 'afaire', surface, viewport: { columns: 140, rows: 60 }, props: PANE })
    expect(await has(ui, /À faire par Julian · 2/)).toBe(true)
    expect(await has(ui, /▾ Configuration \(1\)/)).toBe(true)
    expect(await has(ui, /▸ Décisions \(0\)/)).toBe(true)
    expect(await has(ui, /Remplir smtp.json de la veille/)).toBe(true)
    expect(await has(ui, /node veille.mjs test-mail/)).toBe(true)
    expect(await has(ui, /^Copier$/)).toBe(true)
    expect(await has(ui, /^Fait$/)).toBe(true)
    expect(await has(ui, /^Plus tard$/)).toBe(true)
    expect(await has(ui, /Attend Julian : choisir le nom/)).toBe(true)
    expect(await has(ui, /Reporté\(s\) : 1/)).toBe(true)
  })
}
