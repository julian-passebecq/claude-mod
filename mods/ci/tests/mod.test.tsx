// ci mod with the Claude Code test kit: CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/ci
// scanner/ci.py is replaced by a fake that keeps routes in memory, so the hooks are tested alone.
import { expect, mock, test } from 'claude-code/testing'

import { parseArgs, promptNote, resolveTarget, summary } from '../hooks/view'
import { etaText, gantt, groups, headline, isRed, logCommand, overviewSvg, parseDiagramWords, segsText, laneSegs, labelsOf } from '../hooks/diagram'

// Invented pipelines: app-one (GitHub, red lint by Claude), app-two (GitLab mirror on the local runner, running, Codex).
const T = (min: number) => new Date(Date.parse('2026-10-16T20:00:00Z') - min * 60000).toISOString()
const NOW_MS = Date.parse('2026-10-16T20:00:00Z')
const DIAGRAM: any = {
  generated: '2026-10-16T20:00:00Z', stale: true, labels: {}, colors: {}, svg_colors: {},
  hosts: [{ id: 'github-hosted', label: 'GitHub Actions', kind: 'github', runner_tag: '', status: 'active' },
    { id: 'gitlab-local', label: 'GitLab runner on this PC', kind: 'gitlab', runner_tag: 'local-windows', status: 'active' }],
  summary: { queue: { backend: 'gitlab-local', label: 'GitLab runner on this PC', tag: 'local-windows', running: 6, pending: 1, runners_online: 1, pipelines_open: 1, concurrent: 18, wait_s: 45, wait_n: 4 } },
  apps: [
    { app: 'app-one', path: '', github: 'acme/app-one', gitlab: [], fetched: true, runs: [
      { forge: 'github', slug: 'acme/app-one', backend: 'github-hosted', id: 11, url: 'u11', branch: 'claude/fix-lint', sha: 'a1', event: 'pull_request', title: '', workflow: 'tests',
        status: 'failed', created: T(30), duration_s: 300, queued_s: 0, mr: null, app: 'app-one', who: 'claude',
        conv: { id: 'sess-aaa-1111', title: 'LINT FIX lane', project: 'C--code-app-one' },
        jobs: [{ id: 111, name: 'lint', stage: 'tests', status: 'failed', duration_s: 120, started: T(30), finished: T(28), url: 'j111' },
          { id: 112, name: 'docs', stage: 'tests', status: 'failed', allow_failure: true, duration_s: 10, started: T(30), finished: T(29) }] },
      { forge: 'github', slug: 'acme/app-one', backend: 'github-hosted', id: 10, url: 'u10', branch: 'main', sha: 'a0', event: 'push', title: '', workflow: 'tests',
        status: 'success', created: T(120), duration_s: 60, queued_s: 0, mr: null, app: 'app-one', who: 'unknown', conv: null, jobs: null },
    ] },
    { app: 'app-two', path: '', github: 'acme/app-two', gitlab: ['gitlab.com/mirrors/app-two'], fetched: true, runs: [
      { forge: 'gitlab', slug: 'mirrors/app-two', backend: 'gitlab-local', id: 501, url: 'w501', branch: 'codex/speed', sha: 'b1', event: 'push', title: '', workflow: '',
        status: 'running', created: T(6), duration_s: null, queued_s: null, mr: null, app: 'app-two', who: 'codex', conv: null,
        jobs: [{ id: 9001, name: 'build', stage: 'build', status: 'success', duration_s: 120, queued_s: 60, created: T(6), started: T(5), finished: T(3) },
          { id: 9002, name: 'test', stage: 'test', status: 'running', duration_s: null, queued_s: 60, created: T(3), started: T(2), finished: null }],
        estimate: { eta: new Date(NOW_MS + 4 * 60000).toISOString(), basis: 'jobs', samples: 5,
          jobs: { test: { n: 5, median_s: 360, start: T(2), end: new Date(NOW_MS + 4 * 60000).toISOString() } } } },
    ] },
    { app: 'app-three', path: '', github: 'acme/app-three', gitlab: [], fetched: false, runs: [] },
  ],
  conversations: [{ id: 'sess-aaa-1111', title: 'LINT FIX lane', project: 'C--code-app-one', runs: 1 }],
}

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
    if (cmd === 'pipelines') out = rest.includes('--refresh') || rest.includes('--check') ? { ...DIAGRAM, stale: false } : DIAGRAM
    else if (cmd === 'show') out = snap(opt('--cwd'), opt('--session'))
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

test('/ci diagramme answers with the headline, opens the Diagramme tab and fetches in the background when stale', async ($, on) => {
  const w = world(on)
  const r = await $.command.run({ command: 'ci', args: 'diagramme codex app' } as any)
  expect(r.text).toMatch(/Diagramme/)
  expect(r.text).toMatch(/Codex · par app/)
  expect(r.text).toMatch(/1 pipeline en cours/)
  await w.clock.advance(1)
  expect(w.runs.some(a => a[3] === 'pipelines' && a.includes('--check'))).toBe(true)
  // no write and no model: only ci.py with read verbs
  expect(w.runs.every(a => a[0] === 'python' && a[1] === '-I')).toBe(true)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`Diagramme pane: headline, filters as buttons, red with its log command, live ETA and Gantt (${surface})`, async ($, on) => {
    world(on)
    await $.command.run({ command: 'ci', args: 'diagramme tout hote' } as any)
    const pane = await mount($, surface)
    expect(await pane.find({ type: 'Text', text: /1 pipeline en cours, 1 rouge dans app-one \(job lint\), runner local à 6\/18/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /vert ou rouge vers \d\d:\d\d \(médiane des jobs, 5 runs au moins\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /log : gh run view 11 -R acme\/app-one --log-failed/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /fin ~\d\d:\d\d \(n=5\)/ })).toBeDefined()
    // Codex filter: app-one's Claude red disappears
    await pane.press({ key: 'who-codex' })
    expect(await pane.find({ type: 'Text', text: /1 pipeline en cours, aucun rouge/ })).toBeDefined()
    // group by conversation (Tout again): the conversation title is a group
    await pane.press({ key: 'who-all' })
    await pane.press({ key: 'group-conv' })
    expect(await pane.find({ type: 'Text', text: /LINT FIX lane/ })).toBeDefined()
    expect(await pane.find({ text: /sans conversation connue/ })).toBeDefined() // a section header (button)
    // routing tab is still one click away
    await pane.press({ key: 'tab-routing' })
    expect(await pane.find({ type: 'Text', text: /This conversation/ })).toBeDefined()
    await pane.unmount()
  })
}

test('diagram helpers: words, headline, red only for real failures, ETA, Gantt, log commands, svg', async () => {
  expect(parseDiagramWords(['refresh', 'codex', 'conv'])).toEqual({ refresh: true, who: 'codex', group: 'conv' })
  expect(parseDiagramWords(['inconnu', 'hôte'])).toEqual({ refresh: false, who: 'unknown', group: 'host' })
  expect(parseArgs('diagramme refresh')).toEqual({ kind: 'diagram', words: ['refresh'] })
  expect(headline(DIAGRAM, 'all')).toBe('1 pipeline en cours, 1 rouge dans app-one (job lint), runner local à 6/18, attente runner ~45s (médiane de 4 jobs)')
  const red = DIAGRAM.apps[0].runs[0]
  expect(isRed(red.jobs[0])).toBe(true)
  expect(isRed(red.jobs[1])).toBe(false) // allow_failure: orange, never red
  const L = labelsOf(DIAGRAM)
  const lane = groups(DIAGRAM, 'all', 'app').find(g => g.key === 'app-one')!.lanes[0]!
  const segs = laneSegs(L, lane, NOW_MS)
  expect(segsText(segs)).toMatch(/^app-one ──▶ GitHub Actions ──▶ \[tests: lint ✘ 2m00, docs ✘ 10s\] ──▶ ✘ rouge 5m00 · il y a 30 min$/)
  expect(segs.filter(s => s.status === 'failed').length).toBe(2) // lint + the run result; docs is not red
  expect(logCommand(red)).toBe('gh run view 11 -R acme/app-one --log-failed')
  const live = DIAGRAM.apps[1].runs[0]
  expect(logCommand(live, live.jobs[1])).toBe('glab ci trace 9002 -R mirrors/app-two')
  expect(etaText(live)).toMatch(/^vert ou rouge vers \d\d:\d\d \(médiane des jobs, 5 runs au moins\)$/)
  expect(etaText({ ...live, estimate: { eta: null, basis: null, samples: 2, jobs: {}, reason: "pas assez d'historique" } }))
    .toBe("pas assez d'historique (2 run(s) connus, 3 au moins)")
  const g = gantt(live, NOW_MS, 20)
  expect(g.rows.map(r => r.name)).toEqual(['build', 'test'])
  const bar = (i: number) => g.rows[i]!.cells.map(c => c.text).join('')
  expect(bar(0)).toHaveLength(20)
  expect(bar(0)).toMatch(/^░+█+·+│?·*$/) // queue then run, before now
  expect(bar(1)).toMatch(/░+▓+┄+/) // running (lib/core/gantt.mjs, as in factory): ▓ until now, dashed estimated tail
  expect(g.legend).toBe('░ file  █ fini  ▓ en cours  ▒ échoué  ┄ estimation  │ maintenant')
  expect(g.rows[1]!.text).toMatch(/^fin ~\d\d:\d\d \(n=5\)$/)
  expect(g.rows[0]!.text).toBe('✔ 2m00 + 1m00 en file')
  const svg = overviewSvg(DIAGRAM, 'all')
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toMatch(/GitLab runner on this PC/)
})
