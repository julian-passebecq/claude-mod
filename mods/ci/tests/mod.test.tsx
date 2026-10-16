// ci mod with the Claude Code test kit: CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/ci
// scanner/ci.py is replaced by a fake that keeps routes in memory, so the hooks are tested alone.
import { expect, mock, test } from 'claude-code/testing'

import { parseArgs, promptNote, resolveTarget, summary } from '../hooks/view'

const CWD = 'C:/code/app-one'
const backends = [
  { id: 'github-hosted', label: 'GitHub Actions', kind: 'github', host: 'github.com', runner_tag: 'ubuntu-latest', status: 'active', notes: 'public only',
    check: { id: 'github-hosted', token: { present: 'yes', source: 'gh' }, runners: null, jobs: null, actions: [], usable: 'yes', why: 'token present' } },
  { id: 'gitlab-local', label: 'GitLab runner on this PC', kind: 'gitlab', host: 'gitlab.com', runner_tag: 'local-windows', status: 'active', notes: '',
    check: { id: 'gitlab-local', token: { present: 'yes', source: 'env:GITLAB_TOKEN' }, runners: { online: 1, offline: 0, total: 1 }, jobs: { running: 2, pending: null }, actions: [], usable: 'yes', why: '1 runner(s) online' } },
  { id: 'gitlab-oracle-vm', label: 'GitLab runner on the Oracle VM', kind: 'gitlab', host: 'gitlab.com', runner_tag: '<ORACLE_VM_TAG>', status: 'coming-soon', notes: '', check: null },
]
const labels = { title: 'CI routing', here: 'This conversation', no_route: 'no route', usable: { yes: 'usable', no: 'not usable', unknown: 'unknown' } }

function world(on: any, generated: string | null = '2026-10-16T08:00:00Z') {
  const clock = mock.clock(on)
  const routes: Record<string, any> = {}
  const runs: string[][] = []
  const snap = (cwd: string, session: string) => {
    const cur = routes[session] ?? routes[cwd]
    return {
      generated, stale: generated == null, config: '~/.claude/ci.config.json', routing_file: '~/.claude/ci-routing.json',
      labels, options: { status_line: true, prompt_note: true }, backends,
      routes: Object.entries(routes).map(([key, r]) => ({ key, ...r })),
      current: cur ? { key: routes[session] ? session : cwd, match: routes[session] ? 'session' : 'repo', ...cur } : null,
    }
  }
  on('process.run', ($: any, e: any) => {
    const argv = [...e.argv] as string[]
    runs.push(argv)
    const [cmd, ...rest] = argv.slice(3)
    const opt = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1]! : '' }
    let out: any
    let code = 0
    if (cmd === 'show') out = snap(opt('--cwd'), opt('--session'))
    else if (cmd === 'route') {
      const [target, backend] = rest
      if (!backends.some(b => b.id === backend)) { code = 2; out = { error: `unknown backend '${backend}'` } }
      else {
        const kind = target!.includes('/') ? 'repo' : 'session'
        routes[target!] = { kind, backend, set_by: opt('--by'), set_at: '2026-10-16T09:00:00Z' }
        out = { key: target, ...routes[target!], warning: '' }
      }
    } else if (cmd === 'clear') {
      const n = routes[rest[0]!] ? 1 : 0
      delete routes[rest[0]!]
      out = { key: rest[0], kind: 'session', removed: n }
    }
    return { value: { exitCode: code, stdout: JSON.stringify(out), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 'sess-42' }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { clock, routes, runs }
}

const PANE_PROPS = { title: 'CI routing', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const
const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'ci', component: 'Pane', requestId: 'ci-routing', surface, viewport: { columns: 120, rows: 60 }, props: PANE_PROPS })

test('/ci route writes through ci.py with who set it; /ci shows the route; /ci clear removes it', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const set = await $.command.run({ command: 'ci', args: 'route here gitlab-local' } as any)
  expect(set.text).toMatch(/C:\/code\/app-one → gitlab-local/)
  expect(w.routes[CWD]!.set_by).toBe('session sess-42')
  const routeRun = w.runs.find(r => r[3] === 'route')!
  expect(routeRun.slice(0, 2)).toEqual(['python', '-I'])
  expect(routeRun[2]).toMatch(/scanner\/ci\.py$/)

  const shown = await $.command.run({ command: 'ci', args: '' } as any)
  expect(shown.text).toMatch(/This conversation: gitlab-local \(repo route/)
  expect(shown.text).toMatch(/● gitlab-local/)
  expect(shown.text).toMatch(/runners 1 online \/ 1 · jobs 2 running, \? pending/)
  expect(shown.text).toMatch(/· gitlab-oracle-vm .* coming-soon/)

  const bad = await $.command.run({ command: 'ci', args: 'route here nope' } as any)
  expect(bad.text).toMatch(/unknown backend 'nope'/)

  const cleared = await $.command.run({ command: 'ci', args: `clear ${CWD}` } as any)
  expect(cleared.text).toMatch(/cleared 1 route/)
  expect(w.routes[CWD]).toBeUndefined()
})

test('/ci close closes the pane and runs nothing (the Jauge Mods bar uses it)', async ($, on) => {
  const w = world(on)
  const closed: string[] = []
  on('ui.close', ($: any, e: any) => (closed.push(e.id), { value: undefined }))
  const r = await $.command.run({ command: 'ci', args: 'close' } as any)
  expect(r.text).toBeUndefined()
  expect(closed).toEqual(['ci-routing'])
  expect(w.runs.length).toBe(0)
})

test('/ci with no status yet starts one background check', async ($, on) => {
  const w = world(on, null)
  const r = await $.command.run({ command: 'ci', args: '' } as any)
  expect(r.text).toMatch(/checked never \(refreshing\)/)
  await w.clock.advance(1)
  expect(w.runs.some(a => a[3] === 'show' && a.includes('--check'))).toBe(true)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane lists backends, statuses and routes; Clear removes one (${surface})`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'ci', args: 'route session gitlab-local' } as any)
    await $.command.run({ command: 'ci', args: '' } as any)
    const pane = await mount($, surface)
    expect(await pane.find({ type: 'Text', text: /This conversation: gitlab-local \(session route\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /GitLab runner on this PC/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /token yes \(env:GITLAB_TOKEN\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Routes \(1\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /session sess-42 → GitLab runner on this PC/ })).toBeDefined()
    await pane.press({ key: 'clear-sess-42' })
    expect(w.routes['sess-42']).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /Routes \(0\)/ })).toBeDefined()
    await pane.unmount()
  })
}

test('view helpers', async () => {
  expect(parseArgs('')).toEqual({ kind: 'show', refresh: false })
  expect(parseArgs('refresh')).toEqual({ kind: 'show', refresh: true })
  expect(parseArgs('route "C:/my repo" gitlab-local')).toEqual({ kind: 'route', target: 'C:/my repo', backend: 'gitlab-local' })
  expect(parseArgs('clear sess-1')).toEqual({ kind: 'clear', target: 'sess-1' })
  expect(parseArgs('route x').kind).toBe('usage')
  expect(resolveTarget('here', CWD, 's1')).toBe(CWD)
  expect(resolveTarget('session', CWD, 's1')).toBe('s1')
  const s: any = { generated: null, stale: true, config: '', routing_file: '~/r.json', labels: {}, options: { status_line: true, prompt_note: true }, backends, routes: [], current: null }
  expect(summary(s)).toMatch(/no route/)
  expect(promptNote(s)).toBeUndefined()
  const note = promptNote({ ...s, current: { key: 'sess-1', kind: 'session', match: 'session', backend: 'gitlab-local', set_by: 'lead', set_at: 't' } })!
  expect(note).toMatch(/CI backend "gitlab-local": GitLab runner on this PC \(gitlab, gitlab.com, runner tag local-windows\)/)
})
