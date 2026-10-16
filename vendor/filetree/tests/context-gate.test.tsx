// Added by claude-mod (not upstream): the prompt.submit hook adds the selected file as context only after the
// user explicitly selects a file in the tree, and stops once the selection is cleared. Behaviour unchanged.
import { expect, mock, test } from 'claude-code/testing'

const ROOT = 'C:/work/demo'
const DIRS: Record<string, [string, 'file' | 'dir'][]> = {
  [ROOT]: [['src', 'dir'], ['README.md', 'file']],
  [`${ROOT}/src`]: [['a.ts', 'file']],
}

function world(on: any) {
  mock.env(on, { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\me' })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on)
  const norm = (p: string) => p.replace(/\\/g, '/')
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'test-session' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', (_$: any, e: any) => {
    const kids = DIRS[norm(e.path)]
    if (!kids) throw new Error(`ENOENT ${e.path}`)
    return { value: kids.map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 1_700_000_000_000, isLink: false })) }
  })
  on('fs.stat', (_$: any, e: any) => {
    const p = norm(e.path)
    const parent = p.slice(0, p.lastIndexOf('/'))
    const name = p.slice(p.lastIndexOf('/') + 1)
    const kind = DIRS[p] ? 'dir' : DIRS[parent]?.find(([n]) => n === name)?.[1]
    if (!kind) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind, size: 1, mtimeMs: 1_700_000_000_000, isLink: false } }
  })
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', (_$: any, e: any) => (e.tool === 'Grep' ? { result: { filenames: [`${ROOT}/src/a.ts`] } } : { result: 'ok' }) as any)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return clock
}

const paneProps = { title: 'Files', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as any

test('no file context until the user selects a file; none again after clear selection', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'desktop', component: 'Pane', requestId: 'filetree', props: paneProps })
  await clock.settle()
  const ask = async () => JSON.stringify(await $.prompt.submit({ text: 'what is this?', wait: false } as any))

  expect(await ask()).not.toContain('selected in the file tree')

  // Claude reading and searching files, and the user moving the cursor, are not a selection.
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/README.md` } as any)
  await $.tool.call({ tool: 'Grep', pattern: 'x' } as any)
  await clock.settle()
  await ui.post({ key: 'down' }, { in: 'rows' })
  await clock.settle()
  expect(await ask()).not.toContain('selected in the file tree')

  // An explicit click on a file selects it: its path goes along as context.
  await ui.post({ press: `${ROOT}/README.md` }, { in: 'rows' })
  await clock.settle()
  const sent = await ask()
  expect(sent).toContain('selected in the file tree')
  expect(sent).toContain(`${ROOT}/README.md`)

  // The header's clear-selection button stops it.
  expect(JSON.stringify(await ui.drawn())).toContain('selected: ')
  await ui.post({ press: true }, { in: 'button-unselect' })
  await clock.settle()
  expect(JSON.stringify(await ui.drawn())).not.toContain('selected: ')
  expect(await ask()).not.toContain('selected in the file tree')
  await ui.unmount()
})
