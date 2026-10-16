// control mod with the Claude Code test kit: CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/control
import { expect, mock, test } from 'claude-code/testing'

import { ageText, big, deepMerge, inSession, isStale, labelOf, parseArgs, stateColor, versionOf } from '../hooks/view'

const OUT = 'C:/Users/me/.claude/effort-board/control'
const FRESH = '2999-01-01T00:00:00Z' // never stale for the mod's Date.now()
const OLD = '2020-01-01T00:00:00Z'

const metric = (id: string, state: string, value: number) => ({
  id, label: `metric ${id}`, unit: '%', value, detail: `${id} detail`, state, target: '<= 10% (amber <= 30%)', rule: `rule of ${id}`,
})
const summary = (turns: number) => ({
  turns, usd: 3647.77, main_turns: 7774, sub_turns: 29576,
  models: [{ model: 'opus', turns, main: 6647, sub: 28471, out: 27500000, cache_in: 5991000000, usd: 3539, usd_main: 900, usd_sub: 2639 }],
  efforts: [{ key: 'opus medium', turns: 32000, usd: 3300 }],
  projects: [{ project: 'C--code-app-one', turns: 16000, usd: 1700 }],
  agent: { total: 262, with_model: 35, no_model: 227, background: 253, worktree: 47, types: [['coder', 75]], models: { opus: 19, sonnet: 16 } },
  workflow: { runs: 62, agent_calls: 64, with_model: 6, models: { sonnet: 4, haiku: 2 } },
  tools: { plan_mode: 0, goal: 0, loop: 0, monitor: 239, cron: 15, compact_auto: 57, handoff: 1 },
  context: { main_300k: 1786 },
  readonly: { opus: 3721, haiku: 120 },
})
const usage = (generated: string) => JSON.stringify({
  generated, files: 2000, rescanned: 3, rules_version: 'Team Rules V9.1 (1 Jan 2030)', version: '9.1',
  windows: [
    { id: '7d', label: 'Last 7 days', from: '2026-10-02T16', to: '2026-10-09T15', days: 7, summary: summary(35000), metrics: [metric('sub_no_model', 'red', 89)] },
    { id: 'ref', label: '2-9 Oct (audit run)', from: '2026-10-02T00', to: '2026-10-09T14', days: 7.6, summary: summary(35118), metrics: [metric('haiku_readonly_share', 'red', 2.8)] },
  ],
})
const item = (name: string, extra = {}) => ({ name, path: `C:/x/${name}`, exists: true, size: 2048, changed: '2026-10-09 17:00', what: `what ${name}`, flags: [], hidden: false, ...extra })
const setup = (generated: string) => JSON.stringify({
  generated, rules_version: 'Team Rules V9.1 (1 Jan 2030)', counts: {},
  live: {
    title: 'Team Rules V9.1 (1 Jan 2030)', version: '9.1', label: 'V9.1', claude_md: 'C:/Users/me/.claude/CLAUDE.md', changed: '2030-01-01 10:00',
    sections: 8, env_names: ['CLAUDE_CODE_SUBAGENT_MODEL', 'MY_TOKEN'], settings_hooks: 0, agents: 7, skills: 1, workflows: 1, mods_loaded: 1, mods_total: 2,
  },
  mods: {
    settings_dirs: 1, env_dirs: 1, differ: false, items: [
      { name: 'band', version: '0.1.0', path: 'C:/code/claude-mod/mods/band', state: 'loaded', sources: ['settings.json env'], description: '' },
      { name: 'ci', version: '0.1.0', path: 'C:/code/claude-mod/mods/ci', state: 'installed', sources: [], description: '' },
    ],
  },
  hidden: [item('env CLAUDE_CODE_SUBAGENT_MODEL = claude-sonnet-5-5', { hidden: true, section: 'settings.json' })],
  blockers: generated === OLD ? [item('settings hook PreToolUse[AskUserQuestion] ask_filter.py', { flags: [{ kind: 'blocker', text: 'visible rules' }] })] : [],
  active_blockers: generated === OLD ? 1 : 0,
  sections: [
    { id: 'repos', title: 'Repos under ~/code', items: [item('app-two', { flags: [{ kind: 'stale_clause', text: 'AGENTS.md: "16. No automatic merge"' }] })] },
    { id: 'agents', title: 'Agents', items: [item('architect')] },
  ],
})
const practices = (v6: object) => JSON.stringify({
  generated: FRESH, window: 'Last 7 days', rules_version: 'Team Rules V9.1 (1 Jan 2030)', version: '9.1', label: 'V9.1', v6,
  sections: [{
    num: '3', title: 'Models and effort', heading: '3. Models and effort', state: 'red', evidence: 2, lines: [{
      text: 'Search, lookup, CI/log triage go to Haiku', state: 'red', metrics: ['haiku_readonly_share'], evidence: [
        { kind: 'cite', text: '2-9 Oct: 87 % of calls named none', state: 'info' },
        { kind: 'metric', text: 'Read-only on Haiku: 2.8% (target >= 30%)', state: 'red' },
      ],
    }],
  }],
  best: ['Workflow runs per day: 9/day'], worst: ['Agent calls without a model: 89%'],
  audit_right: ['Twins stood down'], audit_wrong: ['No merge owner after green CI'],
  reference_md: '# PRACTICES: how we work\n\n## 2. GOOD practices', history_md: '# Claude Control: history of the rule versions',
})

const CONFIG = {
  paths: { out_dir: '~/.claude/effort-board/control', user_config: '~/.claude/effort-board/control.config.json' },
  scan: { stale_minutes: 60, windows: [] },
  labels: {
    mod_states: { loaded: 'chargé', installed: 'installé, non chargé' },
    pane: {
      live: 'Règles actives', version: 'version', in_session: 'actif dans cette session', mods: 'Mods chargés', blockers_none: 'Bloqueurs : aucun', hidden: 'Règles cachées',
      v6_title: 'V6 en attente', v6_none: 'Aucun V6-CHANGES.md', v6_groups: { kept: 'gardé', changed: 'changé', dropped: 'abandonné' },
      worst: '5 pires habitudes', audit_wrong: 'Audit : à corriger', practices_title: 'Pratiques',
    },
  },
}

const PANE = { title: 'x', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const

function world(on: any, generated = FRESH) {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    [`${OUT}/usage.json`]: usage(generated),
    [`${OUT}/setup.json`]: setup(generated),
    [`${OUT}/practices.json`]: practices({ state: 'none', source: 'origin/main:docs/V6-CHANGES.md' }),
    'C:/Users/me/.claude/effort-board/control.config.json': JSON.stringify({ labels: { pane: { mods: 'Mods chargés (override)' } } }),
  }
  const runs: string[][] = []
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p.endsWith('/config.json') && !p.includes('effort-board')) return { value: JSON.stringify(CONFIG) }
    if (p in files) return { value: files[p] }
    throw new Error('ENOENT ' + p)
  })
  on('process.run', ($: any, e: any) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '{"ok": true}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', ($: any, e: any) => e)
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: [{ name: 'jauge', plugin: 'band' }, { name: 'control', plugin: 'control' }] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { clock, files, runs }
}

const mount = ($: any, requestId: string, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'control', component: 'Pane', requestId, surface, viewport: { columns: 120, rows: 60 }, props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the four panes draw the scanner's data (${surface})`, async ($, on) => {
    world(on)
    const setupPane = await mount($, 'control-setup', surface)
    expect(await setupPane.find({ type: 'Text', text: /Règles actives : Team Rules V9\.1 \(1 Jan 2030\) · version 9\.1/ })).toBeDefined()
    expect(await setupPane.find({ type: 'Text', text: /Bloqueurs : aucun/ })).toBeDefined()
    expect(await setupPane.find({ type: 'Text', text: /Mods chargés \(override\) \(1\/2\)/ })).toBeDefined()
    expect(await setupPane.find({ type: 'Text', text: /band 0\.1\.0 · chargé · actif dans cette session/ })).toBeDefined()
    expect(await setupPane.find({ type: 'Text', text: /ci 0\.1\.0 · installé, non chargé/ })).toBeDefined()
    expect(await setupPane.find({ type: 'Text', text: /env CLAUDE_CODE_SUBAGENT_MODEL, MY_TOKEN/ })).toBeDefined()
    expect(await setupPane.find({ type: 'Text', text: /Règles cachées \(1\)/ })).toBeDefined()
    expect(await setupPane.find({ type: 'Text', text: /CLAUDE_CODE_SUBAGENT_MODEL = claude-sonnet/ })).toBeDefined()
    expect(await setupPane.find({ type: 'Button', text: /Repos under ~\/code \(1, 1 flagged\)/ })).toBeDefined()
    // a section lists its items only once pressed
    expect(await setupPane.find({ type: 'Text', text: /No automatic merge/ })).toBeUndefined()
    await setupPane.press({ key: 'sec-repos' })
    expect(await setupPane.find({ type: 'Text', text: /No automatic merge/ })).toBeDefined()

    const usagePane = await mount($, 'control-usage', surface)
    expect(await usagePane.find({ type: 'Text', text: /metric sub_no_model/ })).toBeDefined()
    expect(await usagePane.find({ type: 'Text', text: /Team Rules V9\.1/ })).toBeDefined()
    expect(await usagePane.find({ type: 'Text', text: /Agent 262 calls: 35 with model/ })).toBeDefined()
    await usagePane.press({ key: 'win-ref' })
    expect(await usagePane.find({ type: 'Text', text: /metric haiku_readonly_share/ })).toBeDefined()
    expect(await usagePane.find({ type: 'Text', text: /metric sub_no_model/ })).toBeUndefined()

    const practicesPane = await mount($, 'control-practices', surface)
    expect(await practicesPane.find({ type: 'Text', text: /Pratiques : Team Rules V9\.1/ })).toBeDefined()
    expect(await practicesPane.find({ type: 'Text', text: /Aucun V6-CHANGES\.md/ })).toBeDefined()
    expect(await practicesPane.find({ type: 'Button', text: /§3 Models and effort · 1 lignes/ })).toBeDefined()
    expect(await practicesPane.find({ type: 'Text', text: /87 % of calls named none/ })).toBeUndefined()
    await practicesPane.press({ key: 'rule-3' })
    expect(await practicesPane.find({ type: 'Text', text: /Search, lookup, CI\/log triage go to Haiku/ })).toBeDefined()
    expect(await practicesPane.find({ type: 'Text', text: /\(2-9 Oct: 87 % of calls named none\)/ })).toBeDefined()
    expect(await practicesPane.find({ type: 'Text', text: /Read-only on Haiku: 2\.8%/ })).toBeDefined()
    expect(await practicesPane.find({ type: 'Text', text: /5 pires habitudes/ })).toBeDefined()
    expect(await practicesPane.find({ type: 'Text', text: /No merge owner after green CI/ })).toBeDefined()
    expect(await practicesPane.find({ type: 'Markdown' })).toBeUndefined()
    await practicesPane.press({ key: 'reference' })
    expect(await practicesPane.find({ type: 'Markdown', text: /GOOD practices/ })).toBeDefined()

    const historyPane = await mount($, 'control-history', surface)
    expect(await historyPane.find({ type: 'Markdown', text: /history of the rule versions/ })).toBeDefined()
    await setupPane.unmount()
    await usagePane.unmount()
    await practicesPane.unmount()
    await historyPane.unmount()
  })
}

test('a pending V6-CHANGES.md shows kept / changed / dropped', async ($, on) => {
  const w = world(on)
  w.files[`${OUT}/practices.json`] = practices({
    state: 'pending', source: 'origin/main:docs/V6-CHANGES.md', title: 'V6 changes',
    groups: { kept: { count: 2, items: ['One lane one session', 'Merge on green'] }, changed: { count: 1, items: ['Workflow by default'] }, dropped: { count: 0, items: [] } },
  })
  const pane = await mount($, 'control-practices', 'desktop')
  expect(await pane.find({ type: 'Text', text: /V6 en attente : V6 changes/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /gardé \(2\)/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /abandonné \(0\)/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Merge on green/ })).toBeDefined()
  await pane.unmount()
})

test('/control rescans only when the data is stale or asked; Rescan runs the scanner', async ($, on) => {
  const w = world(on, OLD)
  await $.session.start({ cwd: 'C:/code/claude-mod', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'control', args: 'usage' } as any)
  expect(r.text).toMatch(/opened USAGE · Team Rules V9\.1 \(1 Jan 2030\) · scanning/)
  await w.clock.advance(1)
  expect(w.runs.length).toBe(1)
  expect(w.runs[0]!.join(' ')).toMatch(/python -I .*scanner\/control_scan\.py all --config .*config\.json/)

  w.files[`${OUT}/usage.json`] = usage(FRESH)
  w.files[`${OUT}/setup.json`] = setup(FRESH)
  const again = await $.command.run({ command: 'control', args: '' } as any)
  expect(again.text).toMatch(/opened SETUP, USAGE, PRACTICES, HISTORY · .* · data/)
  await w.clock.advance(1)
  expect(w.runs.length).toBe(1)

  const pane = await mount($, 'control-usage', 'terminal')
  await pane.press({ key: 'rescan' })
  await w.clock.advance(1)
  expect(w.runs.length).toBe(2)
  await pane.unmount()
})

test('a hook shows in a red Blockers section at the top of SETUP', async ($, on) => {
  world(on, OLD)
  const pane = await mount($, 'control-setup', 'terminal')
  expect(await pane.find({ type: 'Text', text: /blockers_some \(1 active, 1 found\)/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /ask_filter\.py/ })).toBeDefined()
  await pane.unmount()
})

test('a pane with no data yet says to rescan', async ($, on) => {
  const w = world(on)
  delete w.files[`${OUT}/usage.json`]
  const pane = await mount($, 'control-usage', 'terminal')
  expect(await pane.find({ type: 'Text', text: /no_data .*usage\.json/ })).toBeDefined()
  await pane.unmount()
})

test('view helpers', async () => {
  expect(parseArgs('')).toEqual({ panes: ['setup', 'usage', 'practices', 'history'], scan: false })
  expect(parseArgs('usage scan')).toEqual({ panes: ['usage'], scan: true })
  expect(isStale(undefined, 0, 60)).toBe(true)
  expect(isStale('2026-10-09T15:00:00Z', Date.parse('2026-10-09T15:30:00Z'), 60)).toBe(false)
  expect(ageText('2026-10-09T13:00:00Z', Date.parse('2026-10-09T15:00:00Z'))).toBe('2 h ago')
  expect(big(27_495_461)).toBe('27.5 M')
  expect(stateColor('amber')).toBe('warning')
  expect(versionOf('Claude Control V5.8 (15 Oct 2026)')).toBe('5.8')
  expect(versionOf('Rules without a number')).toBe('')
  expect(deepMerge({ a: { b: 1, c: [1] } }, { a: { c: [2] } })).toEqual({ a: { b: 1, c: [2] } })
  expect(labelOf({ live: 'Règles actives' })('live')).toBe('Règles actives')
  expect(labelOf(undefined)('live')).toBe('live')
  expect(inSession([{ name: 'jauge', plugin: 'band@claude-mod' }], 'band')).toBe(true)
  expect(inSession([{ name: 'jauge' }], 'band')).toBe(false)
})
