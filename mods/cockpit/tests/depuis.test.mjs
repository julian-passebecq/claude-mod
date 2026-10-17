// « Depuis ton dernier message »: the pure model (lib/depuis.mjs) and the scanner part (scanner/depuis.mjs) over
// invented files in a temp folder. node --test mods/cockpit/tests/depuis.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isJulianLine, parseWhen, resolveSince, lastAt, stillRed, depuisModel, durOf } from '../lib/depuis.mjs'
import { depuisData, eachLineBackward, lastJulianMessage, transcriptFiles } from '../scanner/depuis.mjs'
import { scan } from '../scanner/cards.mjs'
import { parseArgs, tabValid } from '../hooks/nav.mjs'

const NOW = new Date(2026, 9, 17, 7, 30).getTime() // 17 Oct 07:30 local
const H = 3600000
const iso = (ms) => new Date(ms).toISOString()

test('isJulianLine: only what Julian typed', () => {
  const u = (o) => ({ type: 'user', message: { role: 'user', content: 'lance la suite' }, ...o })
  assert.equal(isJulianLine(u({ origin: { kind: 'human' } })), true)
  assert.equal(isJulianLine(u({ turnOrigin: 'human' })), true)
  assert.equal(isJulianLine(u({})), true) // older lines: no origin hint at all
  assert.equal(isJulianLine(u({ origin: { kind: 'peer', from: 'local_x' } })), false) // another session
  assert.equal(isJulianLine(u({ origin: { kind: 'task-notification' } })), false)
  assert.equal(isJulianLine(u({ promptSource: 'sdk', turnOrigin: 'sdk' })), false)
  assert.equal(isJulianLine(u({ origin: { kind: 'human' }, isMeta: true })), false)
  assert.equal(isJulianLine(u({ isCompactSummary: true, turnOrigin: 'human' })), false)
  assert.equal(isJulianLine({ type: 'user', origin: { kind: 'human' }, message: { content: [{ type: 'tool_result', content: 'x' }] } }), false)
  for (const c of ['<system-reminder>x</system-reminder>', '<ci-monitor-event>red</ci-monitor-event>', '<task-notification>done</task-notification>', '<command-name>/cockpit</command-name>', '<local-command-stdout>x']) {
    assert.equal(isJulianLine({ type: 'user', message: { content: c } }), false, c)
  }
  assert.equal(isJulianLine({ type: 'user', origin: { kind: 'human' }, message: { content: '<pasted_content>log</pasted_content>' } }), true)
})

test('parseWhen and resolveSince: presets, Nh, HH:MM, fallback', () => {
  assert.equal(parseWhen('', {}).id, 'last')
  assert.equal(parseWhen('8h', {}).hours, 8)
  assert.equal(parseWhen('36h', {}).hours, 36)
  assert.equal(parseWhen('nuit', {}).at, '22:00')
  assert.equal(parseWhen('23h12', {}).at, '23:12')
  assert.equal(parseWhen('{}', { depuis: { default: '24h' } }).id, '24h')
  assert.equal(lastAt('22:00', NOW), new Date(2026, 9, 16, 22, 0).getTime())
  assert.equal(lastAt('07:00', NOW), new Date(2026, 9, 17, 7, 0).getTime())
  const last = { ts: NOW - 8 * H, title: 'x' }
  assert.equal(resolveSince(parseWhen('', {}), NOW, last, {}).since, NOW - 8 * H)
  assert.equal(resolveSince(parseWhen('', {}), NOW, null, {}).source, 'fallback')
  assert.equal(resolveSince(parseWhen('24h', {}), NOW, last, {}).since, NOW - 24 * H)
  assert.equal(durOf(8 * H), '8 h')
})

test('stillRed: newest run red, streak start, old branches left out, main kept', () => {
  const run = (branch, status, h, jobs = []) => ({ branch, status, created: iso(NOW - h * H), backend: 'gitlab-local', who: 'claude', jobs })
  const cache = { generated: iso(NOW - 1 * H), apps: [{ app: 'app-a', path: 'D:/x/app-a', runs: [
    run('main', 'failed', 2, [{ name: 'lint', status: 'failed' }]), run('main', 'failed', 5), run('main', 'success', 30),
    run('claude/fix', 'failed', 3), run('claude/fix', 'success', 1), // green again: not listed
    run('claude/old', 'failed', 200), // red but untouched in the window: not news
    run('claude/new', 'failed', 4),
  ] }] }
  const r = stillRed(cache, NOW - 10 * H)
  assert.deepEqual(r.lanes.map((l) => l.branch).sort(), ['claude/new', 'main'])
  const main = r.lanes.find((l) => l.branch === 'main')
  assert.equal(main.since, NOW - 5 * H)
  assert.equal(main.fresh, true)
  assert.deepEqual(main.jobs, ['lint'])
  assert.equal(stillRed(null, 0).available, false)
})

test('depuisModel: headline, projects most important first, general group, ask text', () => {
  const since = NOW - 8 * H
  const data = {
    since, source: 'last', last: { ts: since, title: 'Lane alpha', project: 'app-a' },
    merged: [{ forge: 'github', repo: 'app-b', project: 'app-b', number: 7, title: 'feat: b', url: 'https://example.invalid/b/7', at: iso(NOW - 2 * H) },
      { forge: 'gitlab', repo: 'app-b', project: 'app-b', number: 3, title: 'fix: b', url: 'https://example.invalid/b/3', at: iso(NOW - 3 * H) },
      { forge: 'github', repo: 'app-c', project: 'app-c', number: 1, title: 'too old', url: '', at: iso(NOW - 30 * H) }],
    red: { available: true, generated: NOW, lanes: [{ app: 'app-a', project: 'app-a', branch: 'main', since: NOW - 4 * H, fresh: true, jobs: ['lint'] }] },
    conversations: [{ cli: 'c1', sid: 'local_c1', title: 'Lane beta', project: 'app-b', state: 'completed', at: NOW - H, first: 'PR #7 merged, tests green.' },
      { cli: 'c2', sid: 'local_c2', title: 'Lane gamma', project: 'app-a', state: 'blocked', at: NOW - H, first: 'BLOCKED: needs a token' }],
    problems: [{ id: 'P-1', title: 'Mod x en erreur', status: 'ouvert', at: NOW - H, project: '' }],
    atoi: { items: [{ id: 'a1', title: 'Renouveler le domaine', since: NOW - 30 * H, due: NOW + 24 * H, dueDay: '2026-10-18' }, { id: 'a2', title: 'Vieux', since: NOW - 90 * H }] },
    cost: { usd: 14.2, tokens: 3e6, byProject: { 'app-a': { usd: 10, tokens: 2e6 }, 'app-b': { usd: 4.2, tokens: 1e6 } } },
    night: { lines: ['Bilan de la nuit : 22:00 → 07:00 (9 h) · 2 mergées'] },
  }
  const waiting = [{ kind: 'ask', since: NOW - H, what: 'Question en attente : quel nom ?', session: { cli: 'c3', sid: 'local_c3', title: 'Lane delta', repo: 'app-c', link: 'claude://claude.ai/epitaxy/local_c3' } },
    { kind: 'green', since: NOW - H, what: 'PR verte', session: { cli: 'c4', title: 'x', repo: 'app-c' } }]
  const workflows = [{ project: 'app-a', name: 'package-wave', status: 'failed', end: NOW - 2 * H }, { project: 'app-b', name: 'night', status: 'completed', end: NOW - 2 * H }, { project: 'app-b', name: 'live', status: 'running' }]
  const m = depuisModel(data, { waiting, workflows }, {}, NOW)
  assert.match(m.headline, /^Depuis 23:30 \(8 h\) : 2 PR mergées, 1 CI rouge, 1 conversation t’attend, 1 bloquée, 1 workflow en échec, 1 problème nouveau, 14 \$ dépensés$/)
  assert.equal(m.sub, 'ton dernier message : 23:30 dans « Lane alpha »')
  assert.deepEqual(m.groups.map((g) => g.name), ['app-a', 'app-c', 'app-b'])
  const a = m.groups[0]
  assert.deepEqual(a.kinds.map((k) => k.kind), ['red', 'blocked', 'wf_failed'])
  assert.equal(a.tone, 'bad')
  assert.match(a.cost, /^10 \$ · 2,0 M tokens$/)
  const b = m.groups.find((g) => g.name === 'app-b')
  assert.deepEqual(b.kinds.map((k) => k.kind), ['merged', 'finished', 'wf_done'])
  const fin = b.kinds.find((k) => k.kind === 'finished').items[0]
  assert.equal(fin.detail, 'PR #7 merged, tests green.')
  assert.equal(fin.link, 'claude://claude.ai/epitaxy/local_c1')
  assert.match(b.kinds[0].items[0].text, /^app-b#7 feat: b · 05:30$/)
  assert.match(b.kinds[0].items[1].text, /^app-b!3/)
  assert.deepEqual(m.general.kinds.map((k) => k.kind), ['problem', 'atoi'])
  assert.match(m.general.kinds[1].items[0].text, /^échéance 2026-10-18 : Renouveler le domaine$/)
  assert.equal(m.general.kinds[1].items.length, 1) // the old item is neither new nor due
  assert.equal(m.night.lines.length, 1)
  assert.match(m.ask, /^VEILLE : résume-moi ce qui s’est passé depuis 23:30 \(8 h\)/)
  assert.equal(m.errors, '')
  // nothing at all
  const e = depuisModel({ since, source: 'hours', label: '8 h' }, {}, {}, NOW)
  assert.equal(e.headline, 'Depuis 23:30 (8 h) : rien de nouveau')
  assert.equal(e.sub, 'fenêtre : 8 h')
  // a stale ci cache says so
  assert.match(depuisModel({ since, red: { available: true, generated: since - H, lanes: [] } }, {}, {}, NOW).errors, /cache du mod ci lu à/)
})

// ---- scanner over invented files ----------------------------------------------------------------------------------

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-depuis-'))
  const P = (...a) => join(root, ...a)
  const proj = P('projects', 'C--code-app-a')
  mkdirSync(join(proj, 'c1', 'subagents'), { recursive: true })
  const L = (o) => JSON.stringify(o)
  const usage = (ts, id, cwd, out = 1000) => L({ type: 'assistant', timestamp: iso(ts), cwd, sessionId: 'c1', requestId: 'r' + id, message: { id: 'm' + id, model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Fait.\nDétail' }], usage: { input_tokens: 1000, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
  const cwd = 'C:/code/app-a/.claude/worktrees/lane'
  writeFileSync(join(proj, 'c1.jsonl'), [
    L({ type: 'user', timestamp: iso(NOW - 20 * H), cwd, origin: { kind: 'human' }, message: { content: 'vieux message' } }),
    usage(NOW - 19 * H, 1, cwd),
    L({ type: 'user', timestamp: iso(NOW - 9 * H), cwd, origin: { kind: 'human' }, message: { content: 'bonne nuit, lance la suite' } }),
    usage(NOW - 8 * H, 2, cwd),
    usage(NOW - 8 * H + 1000, 2, cwd, 5000), // a later line of the same response: replaces the first
    L({ type: 'user', timestamp: iso(NOW - 7 * H), cwd, origin: { kind: 'peer', from: 'local_x' }, message: { content: 'message d’une autre session' } }),
    L({ type: 'user', timestamp: iso(NOW - 6 * H), cwd, message: { content: '<task-notification>done</task-notification>' } }),
    L({ type: 'assistant', timestamp: iso(NOW - 5 * H), cwd, message: { content: [{ type: 'text', text: '## PR #7 mergée, CI verte.\nSuite demain.' }] } }),
    L({ type: 'user', timestamp: iso(NOW - 2 * 60000), cwd, origin: { kind: 'human' }, message: { content: 'bonjour' } }), // too recent
    '',
  ].join('\n'))
  writeFileSync(join(proj, 'c1', 'subagents', 'agent-a1.jsonl'), usage(NOW - 4 * H, 3, cwd) + '\n')
  const t = (NOW - 60000) / 1000
  utimesSync(join(proj, 'c1.jsonl'), t, t)
  utimesSync(join(proj, 'c1', 'subagents', 'agent-a1.jsonl'), t, t)
  mkdirSync(P('app', 'x'), { recursive: true })
  writeFileSync(P('app', 'x', 'local_1.json'), L({ cliSessionId: 'c1', sessionId: 'local_c1', title: 'Lane alpha', cwd, lastActivityAt: NOW - 5 * H, postTurnSummary: { status_category: 'completed' } }))
  writeFileSync(P('app', 'x', 'local_2.json'), L({ cliSessionId: 'c2', sessionId: 'local_c2', title: 'Old lane', cwd, lastActivityAt: NOW - 50 * H, postTurnSummary: { status_category: 'completed' } }))
  writeFileSync(P('ci.json'), L({ generated: iso(NOW - H), apps: [{ app: 'app-a', path: 'C:/code/app-a', github: 'me/app-a', runs: [{ branch: 'main', status: 'failed', created: iso(NOW - 3 * H), jobs: [] }] }] }))
  writeFileSync(P('register.jsonl'), [L({ op: 'add', id: 'P-1', at: NOW - 2 * H, first_seen: NOW - 2 * H, title: 'Nouveau', app: 'app-a', status: 'ouvert' }), L({ op: 'add', id: 'P-0', at: NOW - 90 * H, title: 'Ancien', status: 'ouvert' })].join('\n'))
  mkdirSync(P('afaire'))
  writeFileSync(P('afaire', 'items.json'), L({ v: 1, open: [{ id: 'a1', title: 'Nouvel item', since: NOW - H }] }))
  mkdirSync(P('veille'))
  writeFileSync(P('veille', 'night-summary.json'), L({ since: NOW - 9 * H, until: NOW - H, generated: NOW - H, lines: ['Bilan de la nuit : 2 mergées'] }))
  writeFileSync(P('prs.json'), L({ v: 1, at: NOW - 60000, since: NOW - 48 * H, merged: [{ forge: 'github', repo: 'app-a', project: 'app-a', number: 7, title: 'feat', url: 'u', at: iso(NOW - 4 * H) }, { forge: 'github', repo: 'app-a', project: 'app-a', number: 6, title: 'old', url: 'u', at: iso(NOW - 30 * H) }], errors: [] }))
  const paths = { projects: P('projects'), appDir: P('app'), ci: P('ci.json'), problemes: P('register.jsonl'), afaire: P('afaire'), veille: P('veille'), prsCache: P('prs.json') }
  return { root, paths }
}

test('eachLineBackward reads newest first across small chunks', () => {
  const { root, paths } = fixture()
  try {
    const f = transcriptFiles(paths.projects, 0).find((x) => x.main)
    const lines = []
    eachLineBackward(f.path, (l) => { lines.push(l); return false }, 64)
    assert.equal(lines.length, 9)
    assert.match(lines[0], /bonjour/)
    assert.match(lines[8], /vieux message/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('depuisData: last real message, conversations, cost, PRs (cache), red, problems, À toi, night', () => {
  const { root, paths } = fixture()
  try {
    const files = transcriptFiles(paths.projects, 0)
    assert.equal(lastJulianMessage(files, NOW - 10 * 60000, NOW - 14 * 24 * H).ts, NOW - 9 * H)
    const cfg = { depuis: { gh: false, glab: false } }
    const d = depuisData({ now: NOW, cfg }, paths)
    assert.equal(d.source, 'last')
    assert.equal(d.since, NOW - 9 * H)
    assert.equal(d.last.title, 'Lane alpha')
    assert.equal(d.last.project, 'app-a')
    assert.deepEqual(d.conversations.map((c) => [c.cli, c.first]), [['c1', 'PR #7 mergée, CI verte.']])
    assert.deepEqual(d.merged.map((p) => p.number), [7])
    assert.equal(d.red.lanes.length, 1)
    assert.deepEqual(d.problems.map((p) => p.id), ['P-1'])
    assert.equal(d.atoi.items.length, 1)
    assert.deepEqual(d.night.lines, ['Bilan de la nuit : 2 mergées'])
    // two responses since (one main, deduped to its last line; one subagent): 1000+5000 and 1000+1000 tokens
    assert.equal(d.cost.tokens, 8000)
    assert.ok(d.cost.usd > 0)
    assert.deepEqual(Object.keys(d.cost.byProject), ['app-a'])
    // presets
    assert.equal(depuisData({ now: NOW, cfg, preset: '24h' }, paths).since, NOW - 24 * H)
    assert.equal(depuisData({ now: NOW, cfg, preset: '22:00' }, paths).since, new Date(2026, 9, 16, 22, 0).getTime())
    // through the cards scanner, as the pane calls it
    const out = scan({ now: NOW, parts: ['depuis'], cfg }, paths)
    const m = depuisModel(out.depuis, {}, cfg, NOW)
    assert.match(m.headline, /^Depuis 22:30 \(9 h\) : 1 PR mergée, 1 CI rouge, 1 problème nouveau, 1 conversation terminée, 0,\d\d \$ dépensés$/)
    assert.equal(m.groups[0].name, 'app-a')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('/cockpit depuis [preset] parses as the depuis tab; the tab can be turned off', () => {
  assert.deepEqual(parseArgs('depuis 8h'), { close: false, level: null, tab: 'depuis', scope: null, rest: '8h' })
  assert.equal(parseArgs('matin').tab, 'depuis')
  assert.equal(tabValid({}, 'depuis'), true)
  assert.equal(tabValid({ depuis: { enabled: false } }, 'depuis'), false)
})
