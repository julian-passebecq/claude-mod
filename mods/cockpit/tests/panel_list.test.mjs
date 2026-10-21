// CONVERSATIONS built from the sessions of GRAPHE with the activity of EN COURS (Julian, 22 Oct 01:17: « it doesn't work,
// I don't see all ongoing conversations »: EN COURS 6 working, GRAPHE 17 conv, the list 2 rows « · 1 actives »).
// Invented fixtures only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convRows, convList, panelConvs } from '../lib/panel_list.mjs'
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
  const panel = { ...view.panel, syn: b.syn, synAll: { ...b.syn, rows: b.pool }, convList: b.list, convFactories: b.under.factories, kids: b.under.kids, tree: b.under.tree,
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
  assert.match(t, /CONVERSATIONS · 4 travaillent · 0 t’attendent · 0 au repos/)
  assert.equal((t.match(/↳ \[lane\d\]/g) || []).length, 3, t)
  // nested: each lane's connector sits one level in, under the coordinator
  for (const l of t.split('\n').filter((x) => /↳ \[lane\d\]/.test(x))) assert.match(l, /^ {6}[├└]──── ↳/, t)
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
  assert.match(t, /└──── ● \[solo\] conv \[›\]\n {8}— · /, t)
  assert.match(t, /\nproj-one · 6\n/)
  assert.match(t, /\nproj-two · 1\n/)
})

test('the header counts equal EN COURS: « N travaillent » is the EN COURS figure', () => {
  const scan = { sessions: [...COORD.scan.sessions, quiet('rest', 50), quiet('asks', 30, { awaiting: true })] }
  const graphRows = [...COORD.graphRows, G('rest', { last_activity: NOW - 50 * MIN }), G('asks', { awaiting: true, last_activity: NOW - 30 * MIN })]
  const b = build({ scan, graphRows })
  assert.equal(b.list.counts.working, b.n.convs)
  const t = draw(b)
  const enc = /^EN COURS\n● \[(\d+) conversations? travaille/.exec(t)
  const head = /CONVERSATIONS · (\d+) travaill\S* · (\d+) t’attend\S* · (\d+) au repos/.exec(t)
  assert.ok(enc && head, t)
  assert.equal(enc[1], head[1])
  assert.deepEqual([head[1], head[2], head[3]], ['4', '1', '1'])
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

test('CETTE CONVERSATION shows the current session even when the scan has no factory for it: its activity line', () => {
  const b = build(COORD)
  const t = draw({ ...b, selfFactory: null })
  const sec = t.slice(t.indexOf('CETTE CONVERSATION'), t.indexOf('CONVERSATIONS ·'))
  assert.match(sec, /● \[Foundry stack\] conv[^\n]*\n[^\n]*travaille/, sec)
  assert.doesNotMatch(sec, /aucun agent dans cette conversation/)
})
