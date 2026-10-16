// node --test mods/cockpit/tests/nav.test.mjs   (Node 22.18+: lib/band/hooks/gauge.ts is imported with its types stripped)
// Hand-made fixture sessions only, never real data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localDay } from '../lib/factory/hooks/logic.mjs'
import { el, renderText, widest } from '../lib/factory/scanner/textrender.mjs'
import {
  cockpitConfig, sectionsOf, initialNav, zoomTo, select, crumbs, crumbText, convForest, treeRows, agentNodes, agentCard, scanForRepo,
  projectsOf, usageCard, rowText, inText,
} from '../hooks/nav.mjs'
import { treeSvg } from '../hooks/svg.mjs'
import { drawCockpit } from '../hooks/view.mjs'
import { parseArgs } from '../hooks/register.mjs'
import { stale } from '../scripts/sync-libs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FCFG = JSON.parse(readFileSync(join(HERE, '..', 'lib', 'factory', 'factory.config.json'), 'utf8'))
const CCFG = JSON.parse(readFileSync(join(HERE, '..', 'cockpit.config.json'), 'utf8'))
const NOW = Date.parse('2026-10-16T16:00:00Z')
const today = localDay(NOW)
const vec = (calls, cr = 1000) => [100, 200, cr, 0, 0, calls]
const min = 60000

function S(o) {
  return { models: { 'claude-opus-5-5': vec(3) }, days: { [today]: { 'claude-opus-5-5': vec(2) } }, subs: [], loops: {}, tools: 10, readonly: 2, ctx: 100000,
    model: 'claude-opus-5-5', app_effort: 'medium', last_activity: (NOW - 5 * min) / 1000, recent: [], ...o }
}
const sub = (id, o) => ({ id, type: 'coder', status: 'done', model: 'claude-opus-5-5', effort: 'medium', desc: '', models: { 'claude-opus-5-5': vec(1, 5000) }, ts: '2026-10-16T15:00:00Z', ...o })

// Project eta: lead « Galaxy finalisation autonome » with one sub-conversation (spawnedFrom), which has a Workflow.
// Project app: one idle conversation. The lead is this conversation.
const LEAD = S({ cli: 'lead-cli', sid: 'local_lead', app_title: 'Galaxy finalisation autonome', cwd: 'C:/code/eta', live: true,
  subs: [sub('a1', { type: 'explore-fast', model: 'claude-haiku-5-5', status: 'done' })] })
const CHILD = S({ cli: 'child-cli', sid: 'local_child', parent: 'local_lead', app_title: 'Mosaic Studio V2 private release', cwd: 'C:/code/eta/.claude/worktrees/x',
  subs: [sub('w1', { workflow: 'wf_1', status: 'running', desc: 'build' }), sub('w2', { workflow: 'wf_1', type: 'tester', model: 'claude-sonnet-5-5' }), sub('p1', { type: 'auditor' })] })
const GRAND = S({ cli: 'grand-cli', sid: 'local_grand', parent: 'local_child', app_title: 'Sub-sub lane', cwd: 'C:/code/eta' })
const OTHER = S({ cli: 'other-cli', sid: 'local_other', app_title: 'App polish', cwd: 'C:/code/app', last_activity: (NOW - 90 * min) / 1000 })
// a lane the lead spawned in another repo: shown under the lead in eta's tree, and as a root in its own project
const CROSS = S({ cli: 'cross-cli', sid: 'local_cross', parent: 'local_lead', app_title: 'Studio lane', cwd: 'C:/code/studio/.claude/worktrees/y', origin: 'C:/code/studio', last_activity: (NOW - 60 * min) / 1000 })
const SCAN = {
  sessions: [LEAD, CHILD, GRAND, OTHER, CROSS],
  detail: { ...CHILD, subs: CHILD.subs.map((x) => ({ ...x, events: [['2026-10-16T15:01:00Z', 'tool', 'Read src/a.ts'], ['2026-10-16T15:02:00Z', 'tool', 'Edit src/a.ts']] })),
    calls: [{ tool: 'Workflow', runId: 'wf_1', desc: 'package-wave' }], turns: [], events: [], errors: [] },
  reviews: null,
}

test('config: defaults merged with the shipped file; sections in order, filtered by enabled', () => {
  const c = cockpitConfig(CCFG)
  assert.equal(c.default_level, 'macro')
  assert.equal(c.labels.levels.mega, 'Méga')
  assert.equal(c.labels.tree, 'Arbre') // a default the file does not repeat
  assert.deepEqual(sectionsOf(CCFG), ['breadcrumb', 'tree', 'diagram', 'detail', 'jauge', 'usage', 'veille', 'fichiers'])
  assert.deepEqual(sectionsOf({ sections: { order: ['detail', 'nope', 'tree'], enabled: ['tree', 'detail'] } }), ['detail', 'tree'])
})

test('navigation: opens on this conversation\'s project at macro; select zooms in, the breadcrumb zooms out', () => {
  let nav = initialNav(SCAN, 'lead-cli', CCFG)
  assert.deepEqual(nav, { level: 'macro', repo: 'eta', conv: 'lead-cli', agent: null })
  assert.equal(initialNav(SCAN, 'unknown', CCFG).level, 'mega')
  assert.equal(initialNav(SCAN, 'lead-cli', { default_level: 'mega' }).level, 'mega')
  nav = select(nav, { kind: 'conv', id: 'child-cli', repo: 'eta' })
  assert.deepEqual(nav, { level: 'medium', repo: 'eta', conv: 'child-cli', agent: null })
  nav = select(nav, { kind: 'agent', id: 'w1', conv: 'child-cli' })
  assert.equal(nav.level, 'micro')
  assert.equal(crumbText(crumbs(nav, SCAN, CCFG)), 'Méga › eta › Mosaic Studio V2 private release › coder · build')
  assert.deepEqual(crumbs(nav, SCAN, CCFG).map((c) => c.current), [false, false, false, true])
  nav = zoomTo(nav, 'macro')
  assert.equal(nav.level, 'macro')
  assert.equal(nav.conv, 'child-cli') // kept, so zooming back in returns to it
  assert.equal(zoomTo({ level: 'mega', repo: null, conv: null, agent: null }, 'medium').level, 'mega') // no subject: stays
  nav = select(nav, { kind: 'project', id: 'app' })
  assert.deepEqual(nav, { level: 'macro', repo: 'app', conv: null, agent: null })
  assert.deepEqual(parseArgs('macro datapass'), { level: 'macro', rest: 'datapass' })
  assert.deepEqual(parseArgs('Galaxy'), { level: null, rest: 'Galaxy' })
})

test('tree: méga lists projects with counters; macro nests sub-conversations by spawnedFrom; medium opens Workflows and agents', () => {
  const p = projectsOf(SCAN, FCFG, NOW)
  assert.deepEqual(p.map((x) => x.repo).sort(), ['app', 'eta', 'studio'])
  assert.equal(p.find((x) => x.repo === 'eta').sessions, 3)
  const mega = treeRows({ level: 'mega', repo: 'eta' }, SCAN, FCFG, NOW)
  assert.deepEqual(mega.map((r) => [r.kind, r.label, r.selected]).sort(), [['project', 'app', false], ['project', 'eta', true], ['project', 'studio', false]])
  const forest = convForest(SCAN, 'eta', FCFG)
  assert.equal(forest.length, 1)
  assert.equal(forest[0].title, 'Galaxy finalisation autonome')
  assert.equal(forest[0].children[0].title, 'Mosaic Studio V2 private release')
  assert.equal(forest[0].children[0].children[0].title, 'Sub-sub lane')
  const macro = treeRows({ level: 'macro', repo: 'eta', conv: 'lead-cli' }, SCAN, FCFG, NOW, 'lead-cli')
  assert.deepEqual(macro.map(rowText), ['■ eta', '└ ● Galaxy finalisation autonome', '  └ ● Mosaic Studio V2 private release', '    └ ● Sub-sub lane', '  └ ● Studio lane'])
  assert.match(macro[4].meta, /^studio · /) // the lane's own repo, named
  assert.deepEqual(convForest(SCAN, 'studio', FCFG).map((n) => n.title), ['Studio lane']) // a root in its own project
  assert.equal(macro[1].self, true)
  assert.equal(macro[0].selected, true)
  const medium = treeRows({ level: 'medium', repo: 'eta', conv: 'child-cli' }, SCAN, FCFG, NOW)
  assert.deepEqual(medium.map((r) => `${r.depth} ${r.kind} ${r.label}`), [
    '0 project eta', '1 conv Galaxy finalisation autonome', '2 conv Mosaic Studio V2 private release', '3 agent auditor',
    '3 workflow workflow package-wave', '4 agent coder · build', '4 agent tester', '3 conv Sub-sub lane', '2 conv Studio lane',
  ])
  assert.equal(medium[2].selected, true)
  const a = agentNodes(SCAN, 'child-cli', FCFG)
  assert.equal(a.workflows[0].state, 'running')
  assert.equal(a.workflows[0].children[0].id, 'w1') // running first
})

test('micro: the agent card with model, effort, tokens and its own log', () => {
  const c = agentCard(SCAN, 'w1', FCFG)
  assert.equal(c.type, 'coder')
  assert.equal(c.status, 'running')
  assert.equal(c.workflow, 'wf_1')
  assert.equal(c.tokens, 5300)
  assert.deepEqual(c.events.map((e) => e.text), ['Read src/a.ts', 'Edit src/a.ts'])
  assert.equal(agentCard(SCAN, 'nope', FCFG), null)
})

test('scanForRepo keeps one project; usage card: windows, Fable and credits « non lisible », model share, cache hit, contributors', () => {
  assert.deepEqual(scanForRepo(SCAN, 'app').sessions.map((s) => s.cli), ['other-cli'])
  const reviews = { errors: [], items: [{ repo: 'o/eta', number: 1 }, { repo: 'o/studio', number: 2 }, { repo: 'o/app', number: 3 }] }
  const eta = scanForRepo({ ...SCAN, reviews }, 'eta')
  assert.deepEqual(eta.sessions.map((s) => s.cli).sort(), ['child-cli', 'cross-cli', 'grand-cli', 'lead-cli'])
  assert.deepEqual(eta.reviews.items.map((i) => i.number), [1, 2])
  const u = usageCard({ rateLimits: [{ kind: 'five_hour', percentUsed: 21, resetsAt: new Date(NOW + 163 * min).toISOString() }, { kind: 'seven_day', percentUsed: 14, resetsAt: '2026-10-22T12:00:00Z' }], cost: { usd: 12.5 } }, CHILD, FCFG, NOW)
  assert.equal(u.windows[0].pct, 21)
  assert.equal(u.windows[0].when, 'reset dans 2 h 43')
  assert.match(u.windows[1].when, /^reset \w{3} \d\d:\d\d$/)
  assert.equal(u.windows[2].available, false)
  assert.equal(u.windows[2].text, 'non lisible depuis un mod')
  assert.equal(u.credits.text, 'non lisible depuis un mod')
  assert.equal(u.session.cost, 12.5)
  assert.ok(u.session.share.find((x) => x.family === 'opus').pct > 50)
  assert.ok(u.session.cacheHit > 50)
  assert.equal(u.session.contributors.length, 3)
  assert.equal(inText(45 * min), '45 min')
})

test('diagram: one node per row, elbows to the parent, the selection highlighted, labels escaped', () => {
  const rows = treeRows({ level: 'medium', repo: 'eta', conv: 'child-cli' }, SCAN, FCFG, NOW)
  const svg = treeSvg(rows.map((r, i) => (i === 1 ? { ...r, label: 'a <b> & c' } : r)), cockpitConfig(CCFG).colors, { width: 300 })
  assert.match(svg, /^<svg xmlns/)
  assert.equal((svg.match(/<text /g) || []).length, rows.length)
  assert.equal((svg.match(/<path /g) || []).length, rows.length - 1)
  assert.match(svg, /fill-opacity="0.18"/)
  assert.match(svg, /a &lt;b&gt; &amp; c/)
})

test('pane: sections composed top to bottom at 75 columns, factory screens below the tree at each level', () => {
  const noop = () => {}
  const V = (nav) => ({ cfg: CCFG, fcfg: FCFG, scan: SCAN, nav, self: 'lead-cli', busy: false, error: '', at: NOW, columns: 75, filter: 'all',
    usage: usageCard({ rateLimits: [{ kind: 'five_hour', percentUsed: 21 }] }, LEAD, FCFG, NOW), gauge: null, veille: null, open: { jauge: true, usage: true },
    act: { crumb: noop, select: noop, refresh: noop, filter: noop, toggle: noop, files: noop } })
  for (const [nav, expect] of [
    [{ level: 'mega', repo: 'eta' }, /Détail · Méga[\s\S]*Projets/],
    [{ level: 'macro', repo: 'eta', conv: 'lead-cli' }, /Détail · Projet[\s\S]*Ce qui me concerne[\s\S]*Travail en vol/],
    [{ level: 'medium', repo: 'eta', conv: 'child-cli' }, /Détail · Conversation[\s\S]*Mosaic Studio V2 private release[\s\S]*workflow package-wave/],
    [{ level: 'micro', repo: 'eta', conv: 'child-cli', agent: 'w1' }, /Détail · Agent[\s\S]*Agent · coder[\s\S]*Journal de l’agent[\s\S]*Edit src\/a\.ts/],
  ]) {
    const text = renderText(drawCockpit(el, V(nav)), 75)
    assert.match(text, expect)
    assert.ok(widest(text) <= 75, `${nav.level}: ${widest(text)} columns`)
    const order = ['Méga', 'Arbre ·', 'Détail ·', 'Jauge', 'Usage', 'Veille', 'Ouvrir Fichiers'].map((k) => text.indexOf(k))
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${nav.level}: sections out of order`)
  }
  // the terminal has no Svg: no diagram; a surface with Svg draws it
  const withSvg = { ...el, Svg: (props) => ({ type: 'Svg', props }) }
  const tree = drawCockpit(withSvg, V({ level: 'macro', repo: 'eta', conv: 'lead-cli' }))
  assert.match(JSON.stringify(tree), /"type":"Svg"/)
  assert.doesNotMatch(JSON.stringify(drawCockpit(el, V({ level: 'macro', repo: 'eta' }))), /"type":"Svg"/)
})

test('lib/ is a byte copy of factory, band and veille (node mods/cockpit/scripts/sync-libs.mjs after changing them)', () => {
  assert.deepEqual(stale(), [])
})
