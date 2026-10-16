// metrics mod with the Claude Code test kit: claude plugin test mods/metrics
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const H = 3600000
const CONFIG = {
  data_dir: '~/.claude/metrics-mod', node: 'node', history_days: 4, refresh_min: 30, flat_pct: 10,
  stall: { min_gap_min: 60 },
  metrics: [
    { id: 'prs', label: 'PR/MR mergées par jour', short: 'PR/j', format: 'number', digits: 1, better: 'up' },
    { id: 'tok_per_pr', label: 'M8 Tokens par PR mergée', short: 'tok/PR', format: 'tokens', better: 'down' },
    { id: 'm1_named', label: "M1 Appels d'agent avec modèle", short: 'M1', format: 'pct', better: 'up', target: 100 },
  ],
  summary_metrics: ['prs', 'm1_named'],
  spark: '▁▂▃▄▅▆▇█', spark_gap: '·', marker: '│',
  labels: {
    pane_title: 'Les règles marchent ?', subtitle: 'lecture seule · {repos} repos', curves: 'Courbes par jour', versions: 'Versions des règles',
    before_after: 'Avant / après {version}', all_versions: 'Toutes les versions', col_metric: 'Mesure', col_target: 'cible', col_days: 'jours',
    short: 'période courte (< {h} h)', short_hours: 12, first_scan: 'Premier calcul en cours ({days} jours)', notes: ['Creux : trous ≥ {gap} min'],
  },
}
const MODEL = {
  generated: NOW - 60000, tzMin: 0, from: NOW - 4 * 24 * H, days: ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'],
  series: { prs: [10, 20, 30, 5], tok_per_pr: [4e6, 3e6, 2e6, null], m1_named: [40, 90, 100, 100] },
  versions: [
    { version: 'V5.7', start: NOW - 4 * 24 * H, sha: 'aaa1111', subject: 'V5.7: workflows', from: NOW - 4 * 24 * H, to: NOW - 36 * H, hours: 60, values: { prs: 12, tok_per_pr: 4e6, m1_named: 60 } },
    { version: 'V5.8', start: NOW - 36 * H, sha: 'bbb2222', subject: 'V5.8: briefs', from: NOW - 36 * H, to: NOW, hours: 36, values: { prs: 24, tok_per_pr: 2e6, m1_named: 100 } },
  ],
  markers: [{ version: 'V5.8', day: 2, start: NOW - 36 * H }],
  prs: 65, meta: { repos: 3, github: 2, gitlab: 1, forge_at: NOW - 60000, errors: [] },
}

function world(on: any, model: any = MODEL) {
  const clock = mock.clock(on, { now: NOW })
  const runs: string[][] = []
  const opened: string[] = []
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p.endsWith('/metrics/metrics.config.json')) return { value: JSON.stringify(CONFIG) }
    if (model && p.endsWith('/metrics-mod/metrics.json')) return { value: JSON.stringify(model) }
    throw new Error('ENOENT ' + p)
  })
  on('process.run', ($: any, e: any) => (runs.push(e.argv ?? e), { value: { exitCode: 0, stdout: '{"ok":true}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { runs, opened, clock }
}

const PANE = { title: 'Les règles marchent ?', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } as const
const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'metrics', component: 'Pane', requestId: 'regles', surface, viewport: { columns: 130, rows: 120 }, props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane shows sparklines, version markers and the before/after table (${surface})`, async ($, on) => {
    const w = world(on)
    const pane = await mount($, surface)
    expect(await pane.find({ type: 'Text', text: /lecture seule · 3 repos/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /PR\/MR mergées par jour\s+▃▆█▂/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^\s+│\s*$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /15\/10 V5\.8/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Avant \/ après V5\.8 : V5\.7 \(2,5 j\) → V5\.8 \(36 h\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /M1 Appels d'agent avec modèle\s+60 %\s+100 %\s+↑\s+100 %/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /M8 Tokens par PR mergée\s+4,0 M\s+2,0 M\s+↓/ })).toBeDefined()
    await pane.press({ key: 'v-V5.7' })
    expect(await pane.find({ type: 'Text', text: /Avant \/ après V5\.7 : — / })).toBeDefined()
    expect(w.runs.length).toBe(0) // drawing never runs anything
    await pane.unmount()
  })
}

test('/regles opens the pane, returns no text for the model, and rescans only when stale', async ($, on) => {
  const w = world(on, { ...MODEL, generated: NOW - 2 * H })
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/x', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'regles', args: 'V5.7' } as any)
  expect(r.text).toBeUndefined()
  expect(w.opened).toEqual(['regles'])
  await w.clock.advance(10)
  expect(w.runs.some(a => a.join(' ').includes('metrics_scan.mjs scan'))).toBe(true)
})

test('before the first scan the pane says it is computing', async ($, on) => {
  world(on, null)
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /Premier calcul en cours \(4 jours\)/ })).toBeDefined()
  await pane.unmount()
})
