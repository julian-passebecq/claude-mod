// scenarios mod with the Claude Code test kit: claude plugin test mods/scenarios
import { expect, mock, test } from 'claude-code/testing'

import { SHIPPED } from './shipped'

const PANE = { title: 'x', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } as const
const USER = 'C:/Users/me/my-scenarios.json'

function world(on: any, extra?: string) {
  const clock = mock.clock(on)
  const copies: string[] = []
  const toasts: string[] = []
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.read', ($: any, e: any) => {
    const p = String(e.path).replace(/\\/g, '/')
    if (p === USER && extra !== undefined) return { value: extra }
    if (p.endsWith('/scenarios.json')) return { value: SHIPPED }
    throw new Error('ENOENT ' + p)
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.copy', ($: any, e: any) => (copies.push(e.text), { value: { isCopied: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return { clock, copies, toasts }
}

const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'scenarios', component: 'Pane', requestId: 'scenarios', surface, viewport: { columns: 120, rows: 80 }, props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane lists S1-S5, switches scenario and snippet, copies it (${surface})`, async ($, on) => {
    const w = world(on)
    const pane = await mount($, surface)
    expect(await pane.find({ type: 'Button', text: /S1 Standard V6/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', text: /S4 Nuit/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Coders: Opus 5\.5 · medium · Workflow agent\(\) · max 4/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /non vérifié/ })).toBeDefined()
    expect(await pane.find({ type: 'Link', href: 'https://code.claude.com/docs/en/workflows' } as any)).toBeDefined()
    await pane.press({ key: 'sc-S3' })
    expect(await pane.find({ type: 'Text', text: /Architect: Opus 5\.5 · xhigh/ })).toBeDefined()
    await pane.press({ key: 'kind-frontmatter' })
    await pane.press({ key: 'copy' })
    expect(w.copies.length).toBe(1)
    expect(w.copies[0]).toMatch(/name: architect\ndescription: Architect\nmodel: opus\neffort: xhigh/)
    expect(await pane.find({ type: 'Text', text: /copied: S3 Agent files/ })).toBeDefined()
    await pane.unmount()
  })
}

test('/scenarios S2 env answers with the snippet; an unknown id says so', async ($, on) => {
  world(on)
  on('session.start', ($: any, e: any) => e)
  await $.session.start({ cwd: 'C:/code/x', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'scenarios', args: 'S2 env' } as any)
  expect(r.text).toMatch(/scenarios: 5 scenario\(s\)/)
  expect(r.text).toMatch(/"CLAUDE_CODE_SUBAGENT_MODEL": "claude-sonnet-5-5"/)
  const bad = await $.command.run({ command: 'scenarios', args: 'S42' } as any)
  expect(bad.text).toMatch(/no scenario "S42" \(known: S1, S2, S3, S4, S5\)/)
})

test('a user file adds S7 and its broken rows show as errors', { options: { file: USER } } as any, async ($, on) => {
  world(on, JSON.stringify({
    scenarios: [
      { id: 'S7', name: 'Solo Sonnet', roles: [{ role: 'lead', model: 'sonnet', effort: 'medium', unit: 'session', max_parallel: 1 }] },
      { id: 'S8', name: 'Broken', roles: [{ role: 'x', model: 'nope', effort: 'medium', unit: 'session', max_parallel: 1 }] },
    ],
  }))
  const pane = await mount($, 'terminal')
  expect(await pane.find({ type: 'Button', text: /S7 Solo Sonnet/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: /S8 Broken/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /S8 role x: unknown model "nope"/ })).toBeDefined()
  await pane.unmount()
})

test('agent.spawn: a call without a model passes untouched and shows one toast', async ($, on) => {
  const w = world(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  const base = { tool_use_id: 't', prompt: 'p', description: 'd', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false }
  const r = await $.agent.spawn(base as any)
  expect(r.model).toBe('claude-opus-5-5')
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toMatch(/an Agent call \(general-purpose\) named no model/)
  await $.agent.spawn({ ...base, model: 'haiku' } as any)
  expect(w.toasts.length).toBe(1)
})

test('agent.spawn: no toast when warn_no_model is off', { options: { warn_no_model: 'off' } } as any, async ($, on) => {
  const w = world(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'd', subagentType: 'x', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: true, fork: false } as any)
  expect(w.toasts.length).toBe(0)
})
