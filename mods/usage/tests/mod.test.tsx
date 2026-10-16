// usage mod with the Claude Code test kit: claude plugin test mods/usage
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const H = 3600000
const CONFIG = {
  plan: 'max-20x', plan_label: 'Max 20x', data_dir: '~/.claude/usage-mod', projects_dir: '~/.claude/projects', node: 'node',
  basis: 'cost', status_line: 'off', status_format: '{week_label} {week_pct} % · {pace}', current_pace: 'recent', rates: { recent_hours: 2 },
  calibration: { min_pct: 2 }, scenarios_file: '../scenarios/scenarios.json',
  projections: [{ id: 'calme', label: 'calme', basis: 'week', factor: 0.5 }, { id: 'normal', label: 'normal', basis: 'week', factor: 1 }, { id: 'intense', label: 'intense', basis: 'max', factor: 1.5 }],
  plein_regime: { scenario: 'S5', min_left_pct: 30, max_hours_left: 48 },
  scenario_estimate: { active_hours_per_day: 14, duty: { session: 0.6, 'workflow-agent': 0.5, subagent: 0.3 }, effort_factor: { medium: 1, high: 1.5, xhigh: 2 }, unit_kind: { session: 'main', 'workflow-agent': 'workflow', subagent: 'subagent' } },
  labels: {
    pane_title: 'Consommation', tabs: { today: "Aujourd'hui", week: 'Semaine', forecast: 'Prévision', scenarios: 'Scénarios de consommation', full: 'Plein régime', codex: 'Codex' },
    kinds: { main: 'fil principal', workflow: 'agent de Workflow' }, week_label: 'Semaine', five_hour_label: 'Fenêtre 5 h',
    days: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'], exhausted: 'épuisé {when}', left_at_reset: 'il restera {pct} % au reset',
    pace_now: 'au rythme actuel', no_reading: 'pas encore de lecture', estimate: 'estimation', fits: 'tient', too_much: 'dépasse',
    suggest_full: 'scénario Plein régime suggéré', no_full: 'Pas de Plein régime',
  },
  heat: ' ░▒▓█',
  codex: {
    enabled: 'auto', sessions_dir: '~/.codex/sessions', stale_limits_h: 24, expected_windows: [300, 10080], window_labels: { '300': 'Fenêtre 5 h', '10080': 'Semaine' },
    labels: { codex: 'Codex', claude: 'Claude', unavailable: 'non disponible', off: 'Codex désactivé', no_dir: 'non disponible : aucun dossier {dir}', no_data: 'non disponible : aucune session {dir}', no_limits: '% : non disponible', stale: 'ancienne lecture', past: 'réinitialisée', source: 'Source : {dir}' },
  },
}
const V = (usd: number) => [1000, 100, 5000, 0, 200, 2, 600, usd]
const hourly: Record<string, number[]> = {}
for (let i = 1; i <= 30; i++) hourly[String(NOW - i * H)] = V(2)
const AGGR = {
  generated: NOW, tzMin: 0, hourly,
  days: { '2026-10-16': { total: V(24), project: { 'app-one': V(20), 'app-two': V(4) }, model: { 'claude-opus-5-5': V(24) }, kind: { main: V(10), workflow: V(14) }, surface: { 'Onglet Code (app)': V(24) }, skill: { handoff: V(1) }, mcp: {}, session: { 'sess-a': V(24) }, effort: { medium: V(24) } } },
  sessions: { 'sess-a': { title: 'App one lane', project: 'app-one', kind: 'main', surface: 'Onglet Code (app)' } },
  rates: { 'main|opus': [0, 0, 0, 0, 0, 0, 3600, 3], 'workflow|opus': [0, 0, 0, 0, 0, 0, 3600, 3] },
}
const SCEN = {
  models: { opus: { label: 'Opus 5.5', id: 'claude-opus-5-5' } },
  scenarios: [
    { id: 'S1', name: 'Standard V6', roles: [{ role: 'lead', model: 'opus', effort: 'medium', unit: 'session', max_parallel: 1 }] },
    { id: 'S5', name: 'Plein régime', summary: 'Opus high everywhere', caps: { ci_pipelines: 4 }, roles: [{ role: 'lead', label: 'Lead', model: 'opus', effort: 'xhigh', unit: 'session', max_parallel: 1 }, { role: 'coder', label: 'Coders', model: 'opus', effort: 'high', unit: 'workflow-agent', max_parallel: 4 }] },
  ],
}

const CX = (n: number) => [n, n / 2, n / 10, n / 40, n + n / 10]
const CODEX = {
  generated: NOW, available: true, dir: '~/.codex/sessions', sessions: 2, model: 'gpt-b',
  days: { '2026-10-16': { 'gpt-b': CX(1000000) }, '2026-10-14': { 'gpt-a': CX(3000000) } },
  limits: { ts: NOW - H, primary: { pct: 62, windowMin: 10080, reset: NOW + 50 * H }, secondary: null, plan: 'pro' },
}

function world(on: any, weekPct?: number, codex: any = CODEX) {
  const clock = mock.clock(on, { now: NOW })
  const runs: string[][] = []
  const copies: string[] = []
  const statuses: (string | undefined)[] = []
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p.endsWith('/usage/usage.config.json')) return { value: JSON.stringify(CONFIG) }
    if (p.endsWith('/usage-mod/aggregate.json')) return { value: JSON.stringify(AGGR) }
    if (p.endsWith('/scenarios/scenarios.json')) return { value: JSON.stringify(SCEN) }
    if (p.endsWith('/usage-mod/codex.json') && codex) return { value: JSON.stringify(codex) }
    throw new Error('ENOENT ' + p)
  })
  on('session.usage', () => ({ value: { startedAt: NOW - H, context: {}, rateLimits: weekPct === undefined ? [] : [{ kind: 'seven_day', percentUsed: weekPct, resetsAt: new Date(NOW + 40 * H).toISOString() }, { kind: 'five_hour', percentUsed: 12, resetsAt: new Date(NOW + 3 * H).toISOString() }] } }))
  on('process.run', ($: any, e: any) => (runs.push(e.argv ?? e), { value: { exitCode: 0, stdout: '{"ok":true}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', ($: any, e: any) => (statuses.push(e.text), { value: undefined }))
  on('ui.copy', ($: any, e: any) => (copies.push(e.text), { value: { isCopied: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  return { runs, copies, statuses, clock }
}

const PANE = { title: 'Consommation', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } as const
const mount =($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'usage', component: 'Pane', requestId: 'usage', surface, viewport: { columns: 130, rows: 120 }, props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane shows today, the forecast, the scenarios and Plein régime (${surface})`, async ($, on) => {
    const w = world(on, 10)
    const pane = await mount($, surface)
    expect(await pane.find({ type: 'Button', text: /Aujourd'hui/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /app-one/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /App one lane \(app-one\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /agent de Workflow/ })).toBeDefined()
    await pane.press({ key: 'tab-forecast' })
    expect(await pane.find({ type: 'Text', text: /Semaine : 10 % utilisés · reset dim 18\/10 à 4h/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /intense : (épuisé|il restera)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Fenêtre 5 h : 12 % utilisés/ })).toBeDefined()
    await pane.press({ key: 'tab-scenarios' })
    expect(await pane.find({ type: 'Text', text: /S5 Plein régime : .*\/h actif/ })).toBeDefined()
    await pane.press({ key: 'tab-full' })
    expect(await pane.find({ type: 'Text', text: /scénario Plein régime suggéré/ })).toBeDefined()
    await pane.press({ key: 'copy' })
    expect(w.copies[0]).toMatch(/^Scenario S5 "Plein régime": Lead Opus 5\.5 xhigh as session/)
    expect(w.runs.length).toBe(0) // drawing never runs anything
    await pane.unmount()
  })
}

test('without a reading the forecast says so and nothing is suggested', async ($, on) => {
  world(on)
  const pane = await mount($, 'terminal')
  await pane.press({ key: 'tab-forecast' })
  expect(await pane.find({ type: 'Text', text: /Semaine : pas encore de lecture/ })).toBeDefined()
  await pane.press({ key: 'tab-full' })
  expect(await pane.find({ type: 'Text', text: /Pas de Plein régime/ })).toBeDefined()
  await pane.unmount()
})

test('/conso semaine answers with today and the week; session.measure saves a sample and passes on', async ($, on) => {
  const w = world(on, 10)
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/x', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'conso', args: 'semaine' } as any)
  expect(r.text).toMatch(/^conso: aujourd'hui .* tokens · .* · Semaine 10 % · /)
  const rl = [{ kind: 'seven_day', percentUsed: 11, resetsAt: new Date(NOW + 40 * H).toISOString() }]
  const out = await $.session.measure({ context: {}, rateLimits: rl, changed: ['rateLimits'] } as any)
  expect(out).toBeDefined()
  await w.clock.advance(10)
  expect(w.runs.some(a => a.includes('sample'))).toBe(true)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the Codex tab shows today, 7 days, models and the weekly % next to Claude (${surface})`, async ($, on) => {
    world(on, 10)
    const pane = await mount($, surface)
    expect(await pane.find({ type: 'Text', text: /^Claude aujourd'hui .* \|  Codex aujourd'hui 1\.1 M tokens · 7 j 4\.4 M · Semaine 62 %/ })).toBeDefined()
    await pane.press({ key: 'tab-codex' })
    expect(await pane.find({ type: 'Text', text: /^Aujourd'hui : 1\.1 M tokens \(entrée 1\.0 M dont cache 500 k/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^7 jours : 4\.4 M tokens/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Semaine : 62 % utilisés · reset/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Fenêtre 5 h : non disponible/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /gpt-a .* 3\.3 M tokens/ })).toBeDefined()
    await pane.unmount()
  })
}

test('without Codex files the tab says « non disponible » instead of guessing', async ($, on) => {
  world(on, 10, { generated: NOW, available: false, dir: '~/.codex/sessions', error: 'no_dir', days: {} })
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /Codex non disponible/ })).toBeDefined()
  await pane.press({ key: 'tab-codex' })
  expect(await pane.find({ type: 'Text', text: /non disponible : aucun dossier ~\/\.codex\/sessions/ })).toBeDefined()
  await pane.unmount()
})
