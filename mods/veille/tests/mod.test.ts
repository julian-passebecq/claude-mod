// Hook tests for veille with the Claude Code test kit: claude plugin test mods/veille
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const MIN = 60000
const USER = JSON.stringify({ mode: 'légère', installed: true })
const STATE = JSON.stringify({
  mode: 'légère', last_tour: NOW - 3 * MIN, mail: 'not_configured',
  alerts: {
    'needs:c1:x': { key: 'needs:c1:x', kind: 'needs', severity: 'julian', julian: true, what: 'Attend Julian : choisir le nom', title: 'Lane A', since: NOW - 50 * MIN, session_link: 'claude://claude.ai/epitaxy/local_1' },
    'green:pr': { key: 'green:pr', kind: 'green', severity: 'warn', what: 'x#7 verte depuis 1 h 30, pas mergée', title: 'Lane B', since: NOW - 90 * MIN, link: 'https://github.com/o/x/pull/7', pr: 'x#7' },
  },
  recent: [{ at: NOW - 3 * MIN, kind: 'merge_skipped', pr: 'x#7', reason: 'tête stable depuis moins de 30 min' }],
})

function base(on, heartbeat = { last_fire: NOW - 2 * MIN, last_tour: NOW - 3 * MIN }) {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    'veille/config.json': USER, 'veille/state.json': STATE, 'veille/heartbeat.json': JSON.stringify(heartbeat), 'veille/acks.jsonl': '',
  }
  const hit = (p: string) => Object.keys(files).find((k) => p.replace(/\\/g, '/').endsWith('.claude/' + k))
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.exists', ($, e) => ({ value: !!hit(String(e.path)) || String(e.path).endsWith('veille.config.json') }))
  on('fs.read', ($, e) => {
    const k = hit(String(e.path))
    if (k) return { value: files[k] }
    return { value: JSON.stringify({ modes: {
      rien: { label: 'Rien', interval_min: 0, may: [] },
      'légère': { label: 'Légère', interval_min: 30, may: ['alert', 'notify', 'mail'], help: 'Un tour toutes les 30 min.' },
      active: { label: 'Active', interval_min: 5, may: ['alert', 'notify', 'mail', 'wake'] },
    }, fire_every_min: 5, labels: { title: 'Veille', mode: 'Mode', severity: { julian: 'attend Julian', warn: 'à faire' }, stopped: 'VEILLE ARRÊTÉE : pas de tour depuis {since}', band: 'Veille' }, colors: { bad: '#dc2626' } }) }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'veille: mode active', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
}

const has = async (ui, re: RegExp) => (await ui.find({ type: 'Text', text: re })) !== undefined || (await ui.find({ type: 'Button', text: re })) !== undefined
const PANE = { title: 'Veille', isFocused: true, bodyColumns: 120, placement: 'inline', scroll: { offset: 0, bodyRows: 60 }, view: {} }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/veille draws the mode, its buttons, the last tour, the alerts with Ack and the events (${surface})`, async ($, on) => {
    base(on)
    await $.command.run({ command: 'veille', args: '' })
    const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface, viewport: { columns: 140, rows: 60 }, props: PANE })
    expect(await has(ui, /Veille · Mode Légère/)).toBe(true)
    expect(await has(ui, /^Active$/)).toBe(true)
    expect(await has(ui, /Dernier tour : \d\d:\d\d/)).toBe(true)
    expect(await has(ui, /Attend Julian : choisir le nom/)).toBe(true)
    expect(await has(ui, /^Ack$/)).toBe(true)
    expect(await has(ui, /e-mail non configuré/)).toBe(true)
    expect(await has(ui, /pas mergée : x#7/)).toBe(true)
  })
}

test('the pane goes red when the watcher missed two fires', async ($, on) => {
  base(on, { last_fire: NOW - 40 * MIN, last_tour: NOW - 40 * MIN })
  await $.command.run({ command: 'veille', args: '' })
  const ui = await $.ui.mount({ plugin: 'veille', component: 'Pane', requestId: 'veille', surface: 'terminal', viewport: { columns: 140, rows: 60 }, props: PANE })
  expect(await has(ui, /VEILLE ARRÊTÉE/)).toBe(true)
})

test('/veille mode active runs the watcher command', async ($, on) => {
  base(on)
  const r = await $.command.run({ command: 'veille', args: 'mode active' })
  expect(JSON.stringify(r)).toContain('mode active')
})
