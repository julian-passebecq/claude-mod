// CONVERSATIONS built from the sessions of GRAPHE with the activity of EN COURS (Julian, 22 Oct 01:17: « it doesn't work,
// I don't see all ongoing conversations »: EN COURS 6 working, GRAPHE 17 conv, the list 2 rows « · 1 actives »).
// Invented fixtures only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convRows, convList, panelConvs, oneList } from '../lib/panel_list.mjs'
import { synthesis } from '../lib/panel.mjs'
import { convFactory } from '../lib/panel_conv.mjs'
import { el, renderText } from '../lib/factory/scanner/textrender.mjs'
import { drawCockpit } from '../hooks/view.mjs'
import { panneauView } from '../scripts/fixtures/panneau.mjs'

const NOW = Date.parse('2026-10-22T01:17:00Z')
const MIN = 60000
// a conversation of the scan whose main thread has a turn in progress (written 20 s ago, a tool call pending)
const busy = (cli, o = {}) => ({ cli, sid: 'local_' + cli, app_title: cli, cwd: 'C:/code/proj-one', live: true, mtime: (NOW - 20000) / 1000, stop: 'tool_use', model: 'claude-opus-5-5', recent: [], ...o })
const quiet = (cli, minAgo, o = {}) => ({ cli, sid: 'local_' + cli, app_title: cli, cwd: 'C:/code/proj-one', live: false, mtime: (NOW - minAgo * MIN) / 1000, stop: 'end_turn', model: 'claude-opus-5-5', recent: [], ...o })
// the app's session files (lib/core/sessions.mjs graphRow)
const G = (cli, o = {}) => ({ sid: 'local_' + cli, cli, title: cli, cwd: 'C:/code/proj-one', origin: 'C:/code/proj-one', repo: 'proj-one', archived: false, starred: false,
  last_activity: NOW - 30000, created: NOW - 3600000, model: 'claude-opus-5-5', effort: 'medium', parent: '', peers: [], awaiting: false, prs: [], branch: '', ...o })
// usage's classement.json, written yesterday evening: nothing in the window (a stale file)
const STALE = { v: 1, generated: NOW - 9 * 3600000, tzMin: 120, days: 31, sessions: {}, rows: [] }

function build({ scan, graphRows, data = STALE, filter = { period: '', project: '', state: '' }, self = 'coord' }) {
  const syn = synthesis(data, scan, null, filter, {}, NOW)
  const selfFactory = convFactory(scan, self, {}, {}, NOW, {}, { runs: [] })
  return { ...panelConvs({ syn, graphRows, scan, runs: [], conso: data, fcfg: {}, self, selfFactory, filter, tzMin: data.tzMin }, {}, NOW), syn, selfFactory, self, filter }
}
const draw = (b, columns = 75) => {
  const view = panneauView(columns)
  const panel = { ...view.panel, ...(b.open ? { open: b.open } : {}), syn: b.syn, synAll: { ...b.syn, rows: b.pool }, convList: b.list, convFactories: b.under.factories, kids: b.under.kids, tree: b.under.tree,
    factory: b.selfFactory, self: b.self, filter: { ...b.filter, who: 'claude' }, graphe: null, ci: null }
  return renderText(drawCockpit(el, { ...view, at: NOW, self: b.self, panel }), columns).replace(/\u00a0/g, ' ')
}

// a coordinator and its 3 lanes, all working (the « Foundry stack » of the screenshot)
const COORD = {
  scan: { sessions: [busy('coord', { app_title: 'Foundry stack' }), busy('lane1', { parent: 'local_coord' }), busy('lane2', { parent: 'local_coord' }), busy('lane3', { parent: 'local_coord' })] },
  graphRows: [G('coord', { title: 'Foundry stack' }), G('lane1', { parent: 'local_coord' }), G('lane2', { parent: 'local_coord' }), G('lane3', { parent: 'local_coord' })],
}

test('a coordinator with 3 children all working: 4 rows, the 3 lanes nested under it, header « 4 travaillent »', () => {
  const b = build(COORD)
  assert.equal(b.list.rows.length, 4)
  assert.equal(b.list.groups.length, 1)
  const root = b.list.groups[0].roots
  assert.equal(root.length, 1)
  assert.equal(root[0].row.id, 'coord')
  assert.deepEqual(root[0].kids.map((k) => k.row.id).sort(), ['lane1', 'lane2', 'lane3'])
  assert.deepEqual(b.list.counts, { working: 4, waiting: 0, idle: 0 })
  const t = draw(b)
  assert.match(t, /^ ● \[4 conversations travaillent\]/)
  // one list: the coordinator a root with its « coord » chip, each lane one level in behind the grey rule
  assert.match(t, /\nCONVERSATIONS \[filtres ›\]\n● \[Foundry stack\] coord \(ici\)/, t)
  assert.equal(t.split('\n').filter((x) => /^│  ● \[lane\d\]/.test(x)).length, 3, t)
})

test('a working conversation with no usage tokens is listed, its tokens « — »; a stale classement.json hides nothing', () => {
  const scan = { sessions: [...COORD.scan.sessions, busy('solo', { cwd: 'C:/code/proj-two' }), quiet('rest', 50)] }
  const graphRows = [...COORD.graphRows, G('solo', { repo: 'proj-two', cwd: 'C:/code/proj-two', origin: 'C:/code/proj-two' }), G('rest', { last_activity: NOW - 50 * MIN }),
    G('yesterday', { last_activity: NOW - 20 * 3600000 }), G('old', { last_activity: NOW - 30 * 3600000 }), G('gone', { archived: true })]
  const b = build({ scan, graphRows })
  const ids = b.list.rows.map((r) => r.id)
  for (const id of ['coord', 'lane1', 'lane2', 'lane3', 'solo', 'rest', 'yesterday']) assert.ok(ids.includes(id), id + ' ' + ids)
  assert.ok(!ids.includes('old') && !ids.includes('gone'), ids.join(' ')) // older than 24 h at rest, archived
  assert.equal(b.list.rows.find((r) => r.id === 'solo').tokens, null)
  // grouped by project like the sidebar, working ones first in each group
  assert.deepEqual(b.list.groups.map((g) => g.name).sort(), ['proj-one', 'proj-two'])
  const one = b.list.groups.find((g) => g.name === 'proj-one').roots.map((t) => t.row.id)
  assert.equal(one[0], 'coord')
  const t = draw(b)
  // listed, working, no usage figure needed; no project group headers any more (one list)
  assert.match(t, /\n● \[solo\]/, t)
  assert.doesNotMatch(t, /\nproj-one · \d|\nproj-two · \d/)
})

test('the header counts equal EN COURS: « N travaillent » is the EN COURS figure', () => {
  const scan = { sessions: [...COORD.scan.sessions, quiet('rest', 50), quiet('asks', 30, { awaiting: true })] }
  const graphRows = [...COORD.graphRows, G('rest', { last_activity: NOW - 50 * MIN }), G('asks', { awaiting: true, last_activity: NOW - 30 * MIN })]
  const b = build({ scan, graphRows })
  assert.equal(b.list.counts.working, b.n.convs)
  const t = draw(b)
  const enc = /^ ● \[(\d+) conversations? travaille/.exec(t)
  assert.ok(enc, t)
  assert.equal(enc[1], '4')
  // the list draws as many working rows as the banner counts
  const m = oneList(b.list, { factories: b.under.factories, self: b.self, selfFactory: b.selfFactory, nowMs: NOW })
  assert.deepEqual([m.counts.working, m.counts.waiting, m.counts.rest], [4, 1, 1])
})

test('a saved filter never hides a working conversation: « filtre : … (réinitialiser) »', () => {
  const scan = { sessions: [...COORD.scan.sessions, quiet('rest', 50, { cwd: 'C:/code/proj-two' })] }
  const graphRows = [...COORD.graphRows, G('rest', { repo: 'proj-two', last_activity: NOW - 50 * MIN })]
  const b = build({ scan, graphRows, filter: { period: '', project: 'proj-two', state: 'done' } })
  assert.equal(b.list.rows.length, 5) // the 4 working ones and the filtered one
  assert.match(b.list.note, /proj-two/)
  assert.match(draw(b), /filtre : Projet proj-two · État terminée \[?\(réinitialiser\)\]?/)
  // a filter that hides no working conversation says nothing more
  assert.equal(build({ scan, graphRows, filter: { period: '', project: 'proj-one', state: '' } }).list.note, '')
})

test('convRows: every conversation of GRAPHE, the scan ones too; convList without the graph rows still lists the scan', () => {
  const rows = convRows({ graphRows: null, scan: COORD.scan, runs: [], syn: null }, {}, NOW)
  assert.deepEqual(rows.map((r) => r.id).sort(), ['coord', 'lane1', 'lane2', 'lane3'])
  const l = convList(rows, { byCli: { coord: { running: true } } }, {}, {}, NOW)
  assert.equal(l.counts.working, 1)
  assert.equal(l.rows.length, 4)
})

test('the current conversation is a row « (ici) » of the list even when the scan has no factory for it', () => {
  const b = build(COORD)
  const t = draw({ ...b, selfFactory: null })
  assert.doesNotMatch(t, /CETTE CONVERSATION/)
  assert.match(t, /\n● \[Foundry stack\] coord \(ici\)/, t)
  assert.equal(t.split('\n').filter((l) => l.includes('[Foundry stack]')).length, 1, t)
})

// ---- the ONE list (Julian, 22 Oct 01:17-01:25: « a lot going on, it's not clear… visibility, indentation, bullets ») ----

// a coordinator in proj-one with a lane in foil-3d running a Workflow (2 agents), a lane at rest, and 6 more at rest
const CROSS = () => {
  const run = (id, desc, model, min) => ({ id, type: 'coder', desc, model, effort: 'medium', status: 'running', workflow: 'wf_x', ts: new Date(NOW - min * MIN).toISOString(), last_ts: new Date(NOW).toISOString(), models: {} })
  const scan = { sessions: [
    busy('coord', { app_title: 'Galaxy portfolio release', ctx: 156000 }),
    busy('wind', { app_title: 'FOIL Wind Studio · finish', parent: 'local_coord', cwd: 'C:/code/foil-3d', ctx: 148000, subs: [run('w1', 'wind-assets', 'claude-opus-5-5', 22), run('w2', 'e2e', 'claude-sonnet-5-5', 4)] }),
    quiet('ray', 12, { app_title: 'Rayfin · version', parent: 'local_coord' }),
    ...Array.from({ length: 6 }, (_, i) => quiet('rest' + i, 20 + i * 30, { app_title: 'Rest ' + i })),
  ] }
  const graphRows = [G('coord', { title: 'Galaxy portfolio release' }), G('wind', { title: 'FOIL Wind Studio · finish', parent: 'local_coord', repo: 'foil-3d', cwd: 'C:/code/foil-3d', origin: 'C:/code/foil-3d' }),
    G('ray', { title: 'Rayfin · version', parent: 'local_coord', last_activity: NOW - 12 * MIN }),
    ...Array.from({ length: 6 }, (_, i) => G('rest' + i, { title: 'Rest ' + i, last_activity: NOW - (20 + i * 30) * MIN }))]
  return { scan, graphRows, self: 'rest5' }
}
const listOf = (b, o = {}) => oneList(b.list, { factories: b.under.factories, self: b.self, selfFactory: b.selfFactory, nowMs: NOW, ...o })

test('one list: a child nested under its parent in another project, its project grey on its row; Workflow and agents under it', () => {
  const b = build(CROSS())
  const m = listOf(b)
  const kinds = m.lines.map((x) => `${x.depth}:${x.kind}:${x.key}`)
  assert.deepEqual(kinds.slice(0, 3), ['0:conv:coord', '1:conv:wind', '2:workflow:cv:wind:pfw-wf_x'], kinds.join(' '))
  assert.deepEqual(m.lines.filter((x) => x.kind === 'agent').map((x) => [x.depth, x.agent.label]), [[3, 'coder · e2e'], [3, 'coder · wind-assets']])
  assert.equal(m.lines.find((x) => x.key === 'wind').project, 'foil-3d')
  assert.equal(m.lines.find((x) => x.key === 'ray').project, '') // same project as its parent
  assert.deepEqual([m.counts.nested, m.counts.workflows, m.counts.agents], [2, 1, 2])
  for (const cols of [45, 60, 75]) {
    const t = draw(b, cols)
    assert.match(t, /\n● \[Galaxy portfolio release\]/, t)
    assert.match(t, /\n│  ● \[FOIL Wind Studio · finish\] (?:foil-3d )?[▰▱]+ 37 %\n│  │  ◇ \[wf_x\] · workflow [▰▱]+ 0\/2\n│  │  │  ● coder · e2e sonnet · 4 min\n│  │  │  ● coder · wind-assets opus · 22 min\n│  ○ \[Rayfin · version\] au repos 12 min\n/, t)
    if (cols >= 75) assert.match(t, /\[FOIL Wind Studio · finish\] foil-3d /, t)
    for (const l of t.split('\n')) assert.ok([...l].length <= cols, `${cols}: ${l}`)
  }
})

test('one list: after the working and waiting ones, the 3 most recent at rest, then « + N au repos › » unfolds the rest', () => {
  const b = build(CROSS())
  const m = listOf(b)
  assert.deepEqual(m.lines.filter((x) => x.depth === 0 && x.kind === 'conv').map((x) => x.key), ['coord', 'rest0', 'rest1', 'rest2'])
  assert.deepEqual(m.lines[m.lines.length - 1], { kind: 'rest', depth: 0, key: 'rest', n: 3, open: false })
  assert.equal(m.counts.hidden, 3)
  const t = draw(b)
  assert.match(t, /\n○ \[Rest 0\] au repos 20 min\n○ \[Rest 1\] au repos 50 min\n○ \[Rest 2\] au repos 1 h\n○ \[\+ 3 au repos ›\]\n/, t)
  assert.doesNotMatch(t, /Rest 3|Rest 5/)
  // unfolded: every one, the current conversation « (ici) » among them; the line folds them back
  const all = listOf(b, { restOpen: true })
  assert.equal(all.lines.filter((x) => x.depth === 0 && x.kind === 'conv').length, 7)
  assert.equal(all.counts.hidden, 0)
  const open = draw({ ...b, open: { convs: true, convs_rest: true } })
  assert.match(open, /\n○ \[Rest 5\] \(ici\) au repos 3 h\n○ \[moins ⌄\]\n/, open)
  // panel.list.rest_shown sets how many stay
  assert.equal(listOf(b, { cfg: { panel: { list: { rest_shown: 1 } } } }).counts.hidden, 5)
})
