// Section 5 of the Panneau, « Graphe des conversations »: the session-file whitelist, the scanner part, the model
// (states, roles, tree, filters, À toi de cliquer) and the drawing at 60 and 75 columns. Invented fixtures only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { graphRow } from '../lib/core/sessions.mjs'
import { scan } from '../scanner/cards.mjs'
import { grapheModel, grapheFilter, ageText } from '../lib/graphe.mjs'
import { GRAPH_ROWS, SCAN, CLASSEMENT, NOW, panneauText } from '../scripts/fixtures/panneau.mjs'
import { widest } from '../lib/factory/scanner/textrender.mjs'

const FILE = {
  sessionId: 'local_s1', cliSessionId: 'c1', title: 'Some lane', cwd: 'C:/code/repo/.claude/worktrees/w', originCwd: 'C:/code/repo',
  isArchived: false, isStarred: true, lastActivityAt: 1000, createdAt: 500, model: 'claude-opus-5-5', effort: 'medium',
  spawnedFrom: { sessionId: 'local_p', title: 'parent' }, peerReceipts: [{ targetSessionId: 'local_t', sentAt: 900, body: 'SECRET-BODY' }],
  interruptedAwaitingPerson: true, prs: [{ prNumber: 3, state: 'MERGED', url: 'https://example.test/pr/3' }], branch: 'claude/x',
  promptAppendSnapshot: 'SECRET-PROMPT', remoteMcpServersConfig: { token: 'SECRET-TOKEN' }, sessionSettings: { x: 'SECRET-SETTING' },
  postTurnSummary: { status_detail: 'SECRET-SUMMARY' },
}

test('graphRow keeps only the whitelisted fields of a session file', () => {
  const r = graphRow(FILE)
  assert.deepEqual(Object.keys(r).sort(), ['archived', 'awaiting', 'branch', 'cli', 'created', 'cwd', 'effort', 'last_activity', 'model', 'origin', 'parent', 'peers', 'prs', 'repo', 'sid', 'starred', 'title'])
  assert.doesNotMatch(JSON.stringify(r), /SECRET|example\.test/)
  assert.equal(r.repo, 'repo')
  assert.deepEqual(r.peers, [{ target: 'local_t', at: 900 }])
  assert.deepEqual(r.prs, [{ number: 3, state: 'merged' }])
  assert.equal(graphRow({ title: 'no cli' }), null)
})

test('scanner part « graphe » reads local_*.json two folders deep', () => {
  const dir = mkdtempSync(join(tmpdir(), 'graphe-'))
  try {
    mkdirSync(join(dir, 'a', 'b'), { recursive: true })
    writeFileSync(join(dir, 'a', 'b', 'local_s1.json'), JSON.stringify(FILE))
    writeFileSync(join(dir, 'a', 'b', 'other.json'), JSON.stringify({ ...FILE, cliSessionId: 'nope' }))
    const out = scan({ now: 2000, parts: ['graphe'] }, { appDir: dir })
    assert.equal(out.graphe.rows.length, 1)
    assert.equal(out.graphe.rows[0].cli, 'c1')
    assert.doesNotMatch(JSON.stringify(out), /SECRET/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

const model = (filter = {}, rows = GRAPH_ROWS) => grapheModel({ rows, scan: SCAN, conso: CLASSEMENT, fcfg: {}, filter }, 'lead', {}, NOW)
const line = (m, cli) => m.groups.flatMap((g) => g.lines).find((l) => l.key === cli)

test('model: states, roles, tokens today, context %', () => {
  const m = model()
  assert.equal(m.ready, true)
  const lead = line(m, 'lead')
  assert.equal(lead.state, 'working')
  assert.equal(lead.roleId, 'coord') // spawned k1 and k2
  assert.equal(lead.tokens, 3600000)
  assert.equal(lead.ctx, 30)
  assert.equal(lead.self, true)
  assert.equal(line(m, 'k1').state, 'done') // a PR merged, idle
  assert.equal(line(m, 'k1').roleId, 'lane')
  assert.equal(line(m, 'k3').word, 'inactive depuis 9 h')
  assert.equal(line(m, 'pm').roleId, 'coord')
  assert.equal(line(m, 'b').state, 'waiting')
  const archi = grapheModel({ rows: [{ ...GRAPH_ROWS[6], title: 'ARCHI one' }], filter: { period: 'tout' } }, '', {}, NOW)
  assert.equal(archi.groups[0].lines[0].roleId, 'coord') // by its title
  const plain = grapheModel({ rows: [{ ...GRAPH_ROWS[6], title: 'Improve the map' }], filter: { period: 'tout' } }, '', {}, NOW)
  assert.equal(plain.groups[0].lines[0].roleId, 'agent')
  assert.deepEqual(grapheModel(null, '', {}, NOW), { ready: false })
})

test('model: À toi de cliquer, oldest first, with a reason and the app link', () => {
  const rows = [...GRAPH_ROWS, { ...GRAPH_ROWS[5], cli: 'b2', sid: 'local_b2', title: 'Older wait', last_activity: NOW - 5 * 3600000 }]
  const m = model({}, rows)
  assert.deepEqual(m.waiting.map((w) => w.key), ['b2', 'b'])
  assert.equal(m.waiting[1].reason, 'Choisir la version') // factory's scan
  assert.equal(m.waiting[0].reason, 'tour interrompu, attend une personne')
  assert.equal(m.waiting[0].link, 'claude://claude.ai/epitaxy/local_b2')
  assert.match(m.summary, /2 t’attend/)
})

test('model: groups like the sidebar, starred first, children under their parent, peers', () => {
  const m = model()
  assert.deepEqual(m.groups.map((g) => g.name), ['proj-one', 'proj-two']) // proj-three is older than 24 h
  const one = m.groups[0].lines
  assert.deepEqual(one.map((l) => l.key), ['lead', 'k2', 'k3', 'k1'])
  assert.deepEqual(one.map((l) => l.prefix), ['', '├ ', '│ └ ', '└ '])
  assert.deepEqual(line(m, 'k2').peers, ['PM BETA'])
  assert.equal(line(m, 'b').prefix, '└ ') // under PM BETA, its worktree folded into proj-two
})

test('filters: archived hidden, 24 h / 7 j / tout, actives seulement, projet', () => {
  assert.equal(line(model(), 'old'), undefined)
  assert.ok(line(model({ archived: true }), 'old'))
  assert.equal(line(model(), 'c'), undefined)
  assert.ok(line(model({ period: '7j' }), 'c'))
  assert.deepEqual(model({ active: true }).groups.flatMap((g) => g.lines).map((l) => l.key).sort(), ['b', 'k2', 'lead'])
  assert.deepEqual(model({ project: 'proj-two' }).groups.map((g) => g.name), ['proj-two'])
  assert.deepEqual(grapheFilter({ period: 'bad' }, {}), { project: '', active: false, period: '24h', archived: false })
  assert.equal(ageText(30 * 60000), '30 min')
  assert.equal(ageText(50 * 3600000), '2 j')
})

for (const columns of [60, 75]) {
  test(`graph drawn at ${columns} columns: every part, nothing wider than the pane`, () => {
    const text = panneauText(columns)
    const g = text.slice(text.indexOf('▾ Graphe des conversations'), text.indexOf('Autres vues'))
    for (const k of ['À toi de cliquer (1)', '◆ [Lane beta]', 'Choisir la version · depuis 2 h', '● travaille ◆ attend ✕ bloquée ✓ finie ○ inactive', '[Actives]', '[24 h ▾]', '[Archivées]',
      '★ proj-one · 4', '(ici)] coord 3.6M · ctx 30 % ▰▱▱▱', '● [Package two] coord', '○ [Package two · verify]', '⇢ PM BETA',
      'proj-two · 2', '◆ [Lane beta] 1.0M']) assert.ok(g.includes(k), k + '\n' + g)
    // one line per conversation: no state word line, the waiting one not repeated in full under À toi de cliquer
    assert.doesNotMatch(g, /travaille · coordinateur|t’attend · lane|finie · lane/)
    assert.equal(g.split('\n').filter((l) => l.includes('Choisir la version')).length, 1)
    // the legend on one line at 60 columns and more, no wrapped « message envoyé »
    assert.equal(g.split('\n').filter((l) => /travaille|inactive$/.test(l)).length, 1, g)
    assert.doesNotMatch(g, /message envoyé/)
    // children are indented under their parent, without box-drawing connectors
    assert.doesNotMatch(g, /[│├└┄]/)
    const ind = (k) => { const l = g.split('\n').find((x) => x.includes(k)); return l.length - l.trimStart().length }
    assert.ok(ind('[Package two]') > ind('[Lane alpha') && ind('[Package two · verify]') > ind('[Package two]'), g)
    assert.doesNotMatch(g, /Archived lane|Lane gamma/)
    assert.ok(widest(text.split('\n').slice(1).join('\n')) <= columns, text)
    assert.ok(panneauText(columns, { graphe: { period: 'tout', archived: true } }).includes('Archived lane'))
    // a group of one conversation: no header, one line with the project name in grey
    const all = panneauText(columns, { graphe: { period: 'tout' } })
    const gamma = all.split('\n').filter((l) => l.includes('[Lane gamma]'))
    assert.equal(gamma.length, 1, all)
    assert.match(gamma[0], /\[Lane gamma\] proj-three/)
    assert.doesNotMatch(all, /proj-three · 1/)
  })
}

test('graph at 45 columns: the legend folds behind « Légende › », nothing wraps', () => {
  const text = panneauText(45)
  const g = text.slice(text.indexOf('▾ Graphe des conversations'), text.indexOf('Autres vues'))
  assert.match(g, /\[Légende ›\]/)
  assert.match(panneauText(45, { open: { graphe: true, 'pg-legend': true } }), /○ inactive/)
  assert.ok(widest(text.split('\n').slice(1).join('\n')) <= 45, text)
})

test('state: a coordinator running a Workflow is « travaille », « finie » only after done_min idle with nothing running', () => {
  // MODS 1 (Julian, 18 Oct): the app's lastActivityAt is 20 min old and a PR merged, but its transcript moved 30 s ago
  const mods = { ...GRAPH_ROWS[6], cli: 'mods', sid: 'local_mods', title: 'MODS 1', repo: 'proj-three', last_activity: NOW - 20 * 60000, prs: [{ number: 9, state: 'merged' }] }
  const at = (scan, workflows = []) => line(grapheModel({ rows: [mods], scan: { sessions: scan }, workflows, filter: { period: 'tout' } }, '', {}, NOW), 'mods')
  assert.equal(at([{ cli: 'mods', live: false, mtime: (NOW - 30000) / 1000 }]).state, 'working')
  assert.equal(at([{ cli: 'mods', live: false, mtime: (NOW - 30000) / 1000 }]).word, 'travaille')
  // its transcript is quiet too, but a Workflow of it runs, or a background agent
  assert.equal(at([], [{ cli: 'mods', live: true }]).state, 'working')
  assert.equal(at([{ cli: 'mods', subs: [{ id: 'x', status: 'running' }] }]).state, 'working')
  // nothing runs, 20 min idle, a PR merged: finie; a finished Workflow does not count
  assert.equal(at([], [{ cli: 'mods', live: false }]).state, 'done')
  // only 5 min idle: not yet finie
  assert.equal(line(grapheModel({ rows: [{ ...mods, last_activity: NOW - 5 * 60000 }], filter: { period: 'tout' } }, '', {}, NOW), 'mods').state, 'idle')
  // the colours: travaille green, attend amber, bloquée red, finie and inactive grey (theme tones)
  const m = model()
  assert.deepEqual(m.legend.map((x) => [x.glyph, x.tone]), [['●', 'ok'], ['◆', 'warn'], ['✕', 'bad'], ['✓', 'dim'], ['○', 'dim']])
  assert.equal(line(m, 'lead').tone, 'ok')
  assert.equal(line(m, 'b').tone, 'warn')
})
