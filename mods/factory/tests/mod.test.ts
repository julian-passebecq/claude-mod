// Hook tests for factory with the Claude Code test kit: claude plugin test mods/factory
// The notification tests stub `ui.notify`, an event of CLI 2.1.299+ (the Desktop app's build); 2.1.293's kit refuses it.
import { expect, mock, test } from 'claude-code/testing'

const CONFIG = JSON.stringify({
  cost_label: 'estimate', context_window: 400000,
  rates: { opus: { in: 4, out: 20, cache_read: 0.4, cache_write_5m: 5, cache_write_1h: 8 }, haiku: { in: 1, out: 5, cache_read: 0.1, cache_write_5m: 1.25, cache_write_1h: 2 } },
  thresholds: { handoff_tokens: 250000, ctx_warn_pct: 50, ctx_bad_pct: 62.5 },
  routing_targets: { opus: { max: 0.5 }, haiku: { min: 0.15 } },
  architect: { types: ['architect'], reasons: [{ label: 'before plan', match: 'plan' }] },
  colors: { opus: '#d97706', running: '#2563eb', done: '#16a34a', bad: '#dc2626', warn: '#d97706' },
  legends: { main: 'main thread', tree: 'Agent tree' }, refresh_s: 20,
})

const dayOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const V = [10, 1000, 100000, 1000, 0, 4]
const make = (day: string) => ({
  cli: 'sess-1', sid: 'local_s1', app_title: 'App One lane', cwd: 'C:\\code\\app-one', origin: 'C:\\code\\app-one',
  branch: 'claude/x', model: 'claude-opus-5-5', app_effort: 'medium', ctx: 300000, resume_md: false, live: true, last_activity: 1,
  models: { 'claude-opus-5-5': V }, days: { [day]: { 'claude-opus-5-5': V } }, loops: {}, tools: 4, readonly: 0,
  pr: { number: 155, url: 'https://gitlab.com/x/-/merge_requests/155' }, ci: { state: 'opened', ci: 'running' }, ask_open: false, needs_action: '',
  turns: [{ ts: '2026-10-09T10:00:00Z', kind: 'human', text: 'start wave', models: { 'claude-opus-5-5': V } }],
  events: [['2026-10-09T10:00:00Z', 'prompt', 'start wave'], ['2026-10-09T10:01:00Z', 'agent', 'Agent architect: plan review']],
  errors: [['2026-10-09T10:02:00Z', 'tool', 'Permission denied: preview outside project']], guards: [], calls: [],
  subs: [{ id: 'a1', type: 'architect', model: 'claude-opus-5-5', explicit_model: 'opus', effort: 'high', status: 'running', desc: 'Review the plan',
    prompt: 'Review the v3 plan', ts: '2026-10-09T10:01:00Z', models: { 'claude-opus-5-5': V }, days: { [day]: { 'claude-opus-5-5': V } }, tools: 2, readonly: 2, loops: {} }],
})

const NOW = Date.parse('2026-10-09T12:00:00Z')
function base(on, scanOverride?: string) {
  mock.clock(on, { now: NOW })
  const session = make(dayOf(NOW))
  const SCAN = scanOverride ?? JSON.stringify({ generated: 0, sessions: [session], detail: session })
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.exists', ($, e) => ({ value: String(e.path).endsWith('/factory/factory.config.json') || String(e.path).endsWith('factory.config.json') && !String(e.path).includes('effort-board') }))
  on('fs.read', () => ({ value: CONFIG }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: SCAN, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
}

// The terminal draws Text rows; the desktop draws one Svg whose source carries the same strings.
async function has(ui, surface: string, re: RegExp) {
  if (surface === 'terminal') return (await ui.find({ type: 'Text', text: re })) !== undefined
  const svg = await ui.find({ type: 'Svg' })
  const src = String(svg?.props?.source ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  return re.test(src) || (await ui.find({ type: 'Text', text: re })) !== undefined || (await ui.find({ type: 'Button', text: re })) !== undefined
}

const PANE = (title: string) => ({ title, isFocused: true, bodyColumns: 160, placement: 'inline', scroll: { offset: 0, bodyRows: 60 }, view: {} })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/factory draws the agent tree, bill, guards, log and warnings (${surface})`, async ($, on) => {
    base(on)
    await $.command.run({ command: 'factory', args: 'App One' })
    const ui = await $.ui.mount({ plugin: 'factory', component: 'Pane', requestId: 'factory', surface, viewport: { columns: 180, rows: 60 }, props: PANE('Factory: agent tree') })
    expect(await has(ui, surface, /context 300K ?\/ ?400K/)).toBe(true)
    expect(await has(ui, surface, /before plan/)).toBe(true)
    expect(await has(ui, surface, /handoff\/RESUME\.md/)).toBe(true)
    expect(await has(ui, surface, /Permission denied/)).toBe(true)
    expect(await has(ui, surface, /PR #155 opened CI running/)).toBe(true)
    expect(await has(ui, surface, /start wave/)).toBe(true)
  })

  test(`/factory with no argument draws the dashboard with clickable conversations (${surface})`, async ($, on) => {
    base(on)
    await $.command.run({ command: 'factory', args: '' })
    const ui = await $.ui.mount({ plugin: 'factory', component: 'Pane', requestId: 'factory', surface, viewport: { columns: 180, rows: 60 }, props: PANE('Factory: all conversations') })
    expect(await has(ui, surface, /App One lane/)).toBe(true)
    expect(await has(ui, surface, /#155 opened.{0,8}running/)).toBe(true)
    expect(await has(ui, surface, /opus 100%.{0,3}target <= 50%/)).toBe(true)
    expect(await has(ui, surface, /app-one/)).toBe(true)
  })

  test(`"Ça t'attend" strip on top, one notification per new row (${surface})`, async ($, on) => {
    const session = { ...make(dayOf(NOW)), live: false, last_activity: (NOW - 3600000) / 1000, needs_action: '', parent: 'local_lead', parent_title: 'Lead lane',
      app_prs: [{ url: 'https://github.com/o/app-one/pull/7', number: 7 }] }
    const reviews = { errors: [], items: [
      { provider: 'github', repo: 'o/app-one', number: 7, url: 'https://github.com/o/app-one/pull/7', ci: 'success', conflict: false, green_since: (NOW - 50 * 60000) / 1000, title: 'feat' },
      { provider: 'gitlab', repo: 'g/app-one', number: 155, url: 'https://gitlab.com/x/-/merge_requests/155', ci: 'skipped', conflict: false },
    ] }
    const SCAN2 = JSON.stringify({ generated: 0, sessions: [session], detail: session, reviews })
    base(on, SCAN2)
    const store: Record<string, unknown> = { waiting_seen: {} }
    on('store.get', ($, e) => ({ value: store[e.key] }))
    on('store.set', ($, e) => { store[e.key] = e.value; return { value: undefined } })
    const sent: string[] = []
    on('ui.notify', ($, e) => { sent.push(e.text); return { value: { isSent: true, channel: 'test' } } })
    await $.command.run({ command: 'factory', args: '' })
    const ui = await $.ui.mount({ plugin: 'factory', component: 'Pane', requestId: 'factory', surface, viewport: { columns: 180, rows: 60 }, props: PANE('Factory') })
    expect(await has(ui, surface, /Ça t'attend \(2\)/)).toBe(true)
    expect(await has(ui, surface, /app-one#7 verte depuis 50 min/)).toBe(true)
    expect(await has(ui, surface, /Aucun tour depuis 1 h 00 alors que app-one!155 est sans pipeline/)).toBe(true)
    expect(await has(ui, surface, /Child|App One lane \(attend|App One lane \(inactive/)).toBe(true)
    expect(sent.length).toBe(2)
    expect(sent[0]).toContain('App One lane')
    await $.command.run({ command: 'factory', args: '' })
    expect(sent.length).toBe(2) // the same rows never notify twice
  })

  test(`a notification that is not sent falls back to a toast (${surface})`, async ($, on) => {
    const session = { ...make(dayOf(NOW)), live: false, last_activity: (NOW - 3600000) / 1000, needs_action: 'Log in to the provider' }
    base(on, JSON.stringify({ generated: 0, sessions: [session], detail: session, reviews: { errors: [], items: [] } }))
    on('store.get', () => ({ value: {} }))
    on('store.set', () => ({ value: undefined }))
    on('ui.notify', () => ({ value: { isSent: false, reason: 'no-channel' } }))
    const toasts: string[] = []
    on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
    await $.command.run({ command: 'factory', args: '' })
    expect(toasts.some((t) => t.includes('Attend Julian : Log in to the provider'))).toBe(true)
  })
}
