// reference mod with the Claude Code test kit: claude plugin test mods/reference
// The test kit has no file system beneath the mod: invented files stand in for the configs, caches and guide.
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const HOME = 'C:/Users/me'
const CONFIG = {
  tabs: ['config', 'guide', 'scenarios', 'sante', 'ci'], start_tab: 'config', python: 'python', node: 'node',
  paths: { claude_dir: '~/.claude', control_out_dir: '~/.claude/effort-board/control', sante_data_dir: '~/.claude/sante-mod', ci_pipelines_cache: '~/.claude/ci-pipelines-cache.json', scenarios_file: '' },
  sante_refresh_min: 10,
  labels: { pane_title: 'Référence', tab_config: 'Config', tab_guide: 'Guide', tab_scenarios: 'Scénarios', tab_sante: 'Santé', tab_ci: 'CI' },
}
const CONTROL = { paths: { out_dir: '~/.claude/effort-board/control' }, config_claude: { viewer_chars: 60000, labels: { title: 'Config Claude', search: 'chercher' } } }
const CONFIG_DATA = {
  generated: '2026-10-16T11:59:00Z', project: 'C:/code/x', changes_days: 7, changes: [], shards: ['config-claude.content.0.json'],
  categories: [{ id: 'rules', title: 'Règles', count: 1, subs: [{ id: 'global', title: 'Global', items: [
    { id: 'i1', name: 'CLAUDE.md', path: '~/.claude/CLAUDE.md', kind: 'md', meta: [], flags: [], shard: 0, summary: '' },
  ] }] }],
}
const SHARD = { i1: '# Règles\nAPI_KEY=••••' }
const MD = ['# Mode d\'emploi', '', '<!-- toc:start -->', '<!-- toc:end -->', '', '## Bases', '', '### Ce qu’est un mod', '', '#### Un hook', '', 'Observer.', ''].join('\n')
const SCEN = {
  schema: 1, sources: { 'sub-agents': 'https://code.claude.com/docs/en/sub-agents', 'model-config': 'https://code.claude.com/docs/en/model-config', workflows: 'https://code.claude.com/docs/en/workflows' },
  models: { opus: { label: 'Opus 5.5', id: 'claude-opus-5-5' }, sonnet: { label: 'Sonnet 5.5', id: 'claude-sonnet-5-5' } },
  efforts: ['low', 'medium', 'high'], snippets: ['prompt', 'agent'],
  units: { session: { label: 'Session', how: 'h', source: 'model-config' }, subagent: { label: 'Agent subagent', how: 'h', source: 'sub-agents' } },
  limits: [],
  scenarios: [{ id: 'S1', name: 'Démo', roles: [
    { role: 'lead', label: 'Lead', model: 'opus', effort: 'medium', unit: 'session', max_parallel: 1 },
    { role: 'review', label: 'Review', model: 'opus', effort: 'high', unit: 'subagent', max_parallel: 2, agent: 'architect' },
  ] }],
}
const SANTE_CFG = { data_dir: '~/.claude/sante-mod', labels: { pane_title: 'Santé des mods' }, colors: {}, icons: {} }
const REPORT = { generated: NOW - 60000, mods: [{ key: 'alpha', name: 'alpha', dir: 'C:/m/alpha', source: 'env', exists: true, manifest: { ok: true, version: '0.1.0' }, hooks: { ok: true }, expected: ['alpha'], configs: [], caches: [], logs: [], fields: [] }] }
const SNAPSHOT = { generated: '2026-10-16T11:58:00Z', labels: {}, backends: [{ id: 'gitlab-local', label: 'GitLab runner on this PC', kind: 'gitlab', host: 'gitlab.com', status: 'active', check: null }], routes: [], current: null, routing_file: '~/.claude/ci-routing.json', config: '~/.claude/ci.config.json' }

function world(on: any, { present = [] as any[], files = {} as Record<string, string> } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const opened: string[] = []
  const registered: string[] = []
  const writes: Record<string, string> = {}
  const runs: string[][] = []
  const all: Record<string, string> = {
    '/reference/reference.config.json': JSON.stringify(CONFIG),
    '/reference/lib/control/config.json': JSON.stringify(CONTROL),
    '/reference/lib/guide/MODE-EMPLOI.md': MD,
    '/reference/lib/guide/mods.json': JSON.stringify({ states: {}, mods: [], archived: [] }),
    '/reference/lib/scenarios/scenarios.json': JSON.stringify(SCEN),
    '/reference/lib/sante/sante.config.json': JSON.stringify(SANTE_CFG),
    '/.claude/sante-mod/report.json': JSON.stringify(REPORT),
    '/.claude/settings.json': JSON.stringify({ model: 'opus', effortLevel: 'medium' }),
    '/.claude/agents/architect.md': '---\nname: architect\nmodel: sonnet\neffort: high\n---\n',
    ...files,
  }
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? HOME : undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (writes[p] !== undefined) return { value: writes[p] }
    for (const [k, v] of Object.entries(all)) if (p.endsWith(k)) return { value: v }
    throw new Error('ENOENT ' + p)
  })
  on('fs.write', ($: any, e: any) => ((writes[String(e.path).replace(/\\/g, '/')] = e.text), { value: undefined }))
  on('fs.exists', ($: any, e: any) => ({ value: String(e.path).replace(/\\/g, '/').endsWith('/ci/scanner/ci.py') }))
  on('process.run', ($: any, e: any) => {
    const argv = (e.argv ?? e) as string[]
    runs.push(argv)
    const out = argv.includes('show') ? SNAPSHOT : { generated: null, apps: [], hosts: [], conversations: [] }
    return { value: { exitCode: 0, stdout: JSON.stringify(out), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.list', () => ({ value: present }))
  on('command.register', ($: any, e: any) => (registered.push(e.name), { value: undefined }))
  on('session.version', () => ({ value: { version: '2.1.293', base: '2.1.293' } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.open', ($: any, e: any) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', ($: any, e: any) => (opened.push(`close:${e.id}`), { value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { clock, opened, registered, writes, runs }
}

const PANE = { title: 'Référence', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} } as const
const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'reference', component: 'Pane', requestId: 'reference', surface, viewport: { columns: 130, rows: 200 }, props: PANE })
const start = async ($: any, on: any) => {
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/x', surface: 'terminal', isInteractive: true })
}

test('aliases: only the old commands no loaded mod has are registered', async ($, on) => {
  const w = world(on, { present: [{ name: 'ci', source: 'plugin', plugin: 'ci' }, { name: 'sante', source: 'plugin', plugin: 'sante' }] })
  await start($, on)
  expect(w.registered).toEqual(['reference', 'config-claude', 'control', 'mods-guide', 'scenarios'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`one pane, five tabs drawn by the owners' view code (${surface})`, async ($, on) => {
    const w = world(on, { files: { '/effort-board/control/config-claude.json': JSON.stringify(CONFIG_DATA), '/effort-board/control/config-claude.content.0.json': JSON.stringify(SHARD) } })
    await start($, on)
    const r = await $.command.run({ command: 'reference', args: '' } as any)
    expect(r.text).toBe('reference: Référence › Config')
    expect(w.opened).toEqual(['reference'])
    const pane = await mount($, surface)
    for (const t of ['config', 'guide', 'scenarios', 'sante', 'ci']) expect(await pane.find({ key: `ref-tab-${t}` } as any)).toBeDefined()
    // Config: control's CONFIG drawing over its scanner output (masked text stays masked)
    expect(await pane.find({ type: 'Button', text: /▸ Règles \(1\)/ })).toBeDefined()
    await pane.press({ key: 'cat-rules' })
    await pane.press({ key: 'sub-global' })
    await pane.press({ key: 'it-i1' })
    expect(await pane.find({ text: /API_KEY=••••/ } as any)).toBeDefined()
    // Guide
    await pane.press({ key: 'ref-tab-guide' })
    expect(await pane.find({ type: 'Text', text: /Sommaire général/ })).toBeDefined()
    await pane.press({ key: 'go-un-hook' })
    expect(await pane.find({ type: 'Text', text: /^→ Un hook$/ })).toBeDefined()
    // Scénarios + Appliquer: applied.json written, settings and agents never
    await pane.press({ key: 'ref-tab-scenarios' })
    expect(await pane.find({ type: 'Text', text: /Review: Opus 5\.5 · high · Agent subagent · max 2/ })).toBeDefined()
    await pane.press({ key: 'apply' })
    expect(Object.keys(w.writes)).toEqual([`${HOME}/.claude/scenarios/applied.json`])
    expect(JSON.parse(w.writes[`${HOME}/.claude/scenarios/applied.json`]!).scenario).toBe('S1')
    expect(await pane.find({ type: 'Text', text: /S1 Démo noté le 2026-10-16 12:00 : 2 écarts sur 5/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /≠ Review · agents\/architect\.md · model : sonnet → opus/ })).toBeDefined()
    // Santé: sante's drawing over its report
    await pane.press({ key: 'ref-tab-sante' })
    expect(await pane.find({ type: 'Text', text: /mods actifs/ })).toBeDefined()
    // CI: routing from ci.py beside this mod (cache only)
    await pane.press({ key: 'ref-tab-ci' })
    await w.clock.advance(10)
    expect(await pane.find({ type: 'Text', text: /GitLab runner on this PC/ })).toBeDefined()
    expect(w.runs.some(a => a.join(' ').includes('ci.py show'))).toBe(true)
    await pane.unmount()
  })
}

test('/scenarios as an alias opens the Scénarios tab on its id; /reference close closes', async ($, on) => {
  const w = world(on, { present: [{ name: 'scenarios', source: 'plugin', plugin: 'reference' }] })
  await start($, on)
  const r = await $.command.run({ command: 'scenarios', args: 'S1' } as any)
  expect(r.text).toBe('scenarios: Référence › Scénarios')
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /S1 · Démo/ })).toBeDefined()
  await pane.unmount()
  await $.command.run({ command: 'reference', args: 'close' } as any)
  expect(w.opened).toEqual(['reference', 'close:reference'])
})

test('/reference guide <section> opens the guide there; an unknown section says so', async ($, on) => {
  world(on)
  await start($, on)
  const bad = await $.command.run({ command: 'reference', args: 'guide zzz' } as any)
  expect(bad.text).toMatch(/pas de section « zzz »\. Onglets : Bases/)
  await $.command.run({ command: 'reference', args: 'guide un hook' } as any)
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /^→ Un hook$/ })).toBeDefined()
  await pane.unmount()
})
