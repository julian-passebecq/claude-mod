// node --test mods/cockpit/tests/viz.test.mjs - the Panneau's diagrams: Sankey, quota curves, TPS sparklines, the drawn
// graph (invented fixtures only).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sankeyModel, sankeyLayout } from '../lib/viz_sankey.mjs'
import { quotaProjection, quotaCurves, projectionText, atText } from '../lib/viz_quota.mjs'
import { tpsHourly } from '../lib/viz_spark.mjs'
import { graphLayout, overlaps } from '../lib/viz_graph.mjs'
import { modelFamily, modelColor, modelTone, vizConfig } from '../lib/viz_palette.mjs'
import { claudeSeries } from '../lib/core/usage.mjs'
import { sankeySvg, sankeyLegend, CHAR_PX } from '../hooks/viz_sankey.mjs'
import { quotaSvg } from '../hooks/viz_quota.mjs'
import { sparkSvg, sparkText } from '../hooks/viz_spark.mjs'
import { graphSvg } from '../hooks/viz_graph.mjs'
import { drawCockpit } from '../hooks/view.mjs'
import { el, renderText } from '../lib/factory/scanner/textrender.mjs'
import { panneauView, NOW } from '../scripts/fixtures/panneau.mjs'

const MIN = 60000
const H = 3600000
const v = (n) => [n, n / 10, n * 2, 0, 0, 1]
const tok = (vec) => vec.reduce((a, x, i) => a + (i < 5 ? x : 0), 0)

const SCAN = {
  sessions: [{
    cli: 'me', models: { 'claude-opus-5-5': v(1000), 'claude-haiku-5-5': v(100) },
    subs: [
      { id: 's1', workflow: 'wf_a', models: { 'claude-opus-5-5': v(500), 'claude-sonnet-5-5': v(300) } },
      { id: 's2', workflow: 'wf_a', models: { 'claude-haiku-5-5': v(50) } },
      { id: 's3', workflow: 'wf_b', models: { 'claude-sonnet-5-5': v(200) } },
      { id: 's4', models: { 'claude-fable-5-1': v(80) } },
    ],
  }],
}

test('palette: one colour per model family, theme keys for the text fallback', () => {
  assert.equal(modelFamily('claude-opus-5-5'), 'opus')
  assert.equal(modelFamily('Sonnet 5.5'), 'sonnet')
  assert.equal(modelFamily('gpt-5-codex'), 'codex')
  assert.equal(modelTone('claude-haiku-5-5'), 'success')
  assert.notEqual(modelColor('opus'), modelColor('sonnet'))
  assert.equal(vizConfig({}).px(10), 70)
  assert.equal(vizConfig({ panel: { viz: { labels: { sankey: 'X' } } } }).labels.sankey, 'X')
})

test('Sankey: conversation → fil principal / Workflows / agents → models, the flows sum to every total', () => {
  const m = sankeyModel(SCAN, 'me', [{ id: 'wf_a', name: 'package-wave' }])
  assert.equal(m.available, true)
  assert.deepEqual(m.sources.map((s) => s.label), ['fil principal', 'package-wave', 'wf_b', 'agents en fond'])
  const all = tok(v(1000)) + tok(v(100)) + tok(v(500)) + tok(v(300)) + tok(v(50)) + tok(v(200)) + tok(v(80))
  assert.equal(m.total, all)
  const sum = (xs) => xs.reduce((a, l) => a + l.tokens, 0)
  assert.equal(sum(m.links), m.total)
  for (const s of m.sources) assert.equal(sum(m.links.filter((l) => l.source === s.id)), s.tokens)
  for (const x of m.models) assert.equal(sum(m.links.filter((l) => l.family === x.family)), x.tokens)
  assert.deepEqual(m.models.map((x) => x.family), ['opus', 'sonnet', 'haiku', 'fable'])
  // the layout: every band has the same height on both ends of each half, the columns fill the height
  const g = sankeyLayout(m, { width: 300, height: 90 })
  for (const b of g.bands) assert.ok(b.c.y1 >= b.c.y0 && b.b.y1 >= b.b.y0)
  const hs = g.sources.reduce((a, s) => a + s.h, 0)
  assert.ok(Math.abs(hs - (90 - 4 - 4 * 3)) < 1e-6)
  const svg = sankeySvg(m, { width: 300 })
  assert.match(svg, /^<svg /)
  assert.match(svg, /opus \d+ %/)
  // past max_sources the smallest Workflows become one « autres » node, the totals unchanged
  const few = sankeyModel(SCAN, 'me', [], { max_sources: 3 })
  assert.equal(few.sources.length, 3)
  assert.equal(few.total, m.total)
  assert.equal(sankeyModel(SCAN, 'nobody').available, false)
})

test('quota projection: the current rate to the reset, red with the hour of 100 %', () => {
  const now = Date.parse('2026-10-16T14:00:00Z')
  const reset = now + 2 * H
  // 5 h window: 20 % an hour ago, 50 % now → 30 %/h → 100 % in 1 h 40 min, before the reset
  const rs = [{ ts: now - 3 * H, pct: 5, reset }, { ts: now - H, pct: 20, reset }, { ts: now - 30 * MIN, pct: 35, reset }]
  const p = quotaProjection(rs, { now, pct: 50, span_h: 5, rate_min: 60 })
  assert.equal(Math.round(p.ratePerH), 30)
  assert.equal(p.over, true)
  assert.equal(p.hitAt, now + (50 / 30) * H)
  assert.equal(p.end, reset)
  assert.equal(p.start, reset - 5 * H)
  assert.equal(projectionText(p), `à ce rythme : 100 % vers ${atText(p.hitAt, now)}`)
  assert.match(quotaSvg(p, { width: 280 }), /stroke-dasharray="4 3"/)
  // a slow pace: under 100 % at the reset, not red
  const slow = quotaProjection([{ ts: now - H, pct: 40, reset }], { now, pct: 45, span_h: 5 })
  assert.equal(slow.over, false)
  assert.equal(Math.round(slow.projPct), 55)
  assert.equal(projectionText(slow), 'à ce rythme : 55 % au reset')
  // the engine's figures (rateLimits) give the reset; the samples' series the curve
  const c = quotaCurves({ series: { five: rs, week: [] }, usage: { rateLimits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: new Date(reset).toISOString() }] }, now })
  assert.equal(c.five.over, true)
  assert.equal(c.week, null)
  assert.equal(atText(now + 30 * H, now).split(' ').length, 2) // a day when it is far
})

test('claudeSeries: the readings of the current window only, thinned', () => {
  const now = Date.parse('2026-10-16T14:00:00Z')
  const old = { ts: now - 6 * H, five_hour: { pct: 90, reset: now - 60 * MIN } }
  const cur = Array.from({ length: 100 }, (_, i) => ({ ts: now - 4 * H + i * MIN, five_hour: { pct: i / 2, reset: now + H } }))
  const s = claudeSeries([old, ...cur], now, 20)
  assert.equal(s.five.length, 20)
  assert.equal(s.five[19].pct, 49.5)
  assert.ok(s.five.every((r) => r.reset === now + H))
  assert.deepEqual(s.week, [])
})

test('TPS sparkline: one weighted point per hour over 24 h, null without a reply', () => {
  const now = Date.parse('2026-10-16T16:30:00Z')
  const h0 = Math.floor(now / H) * H
  const debit = { hourly: {
    [`${h0}|claude-opus-5-5|medium`]: [600, 10000, 2, {}], [`${h0}|claude-opus-5-5|high`]: [400, 10000, 1, {}],
    [`${h0 - 3 * H}|claude-opus-5-5|medium`]: [3000, 100000, 5, {}], [`${h0 - 30 * H}|claude-opus-5-5|medium`]: [1, 1, 1, {}],
    [`${h0 - H}|claude-sonnet-5-5|low`]: [800, 10000, 1, {}],
  } }
  const s = tpsHourly(debit, now, {})
  assert.deepEqual(Object.keys(s).sort(), ['opus 5.5', 'sonnet 5.5'])
  assert.equal(s['opus 5.5'].values.length, 24)
  assert.equal(s['opus 5.5'].values[23], 50) // (600 + 400) / 20 s
  assert.equal(s['opus 5.5'].values[20], 30)
  assert.equal(s['opus 5.5'].values[0], null)
  assert.equal(s['opus 5.5'].last, 50)
  assert.match(sparkSvg(s['opus 5.5'], '#e8823a'), /polyline|circle/)
  assert.equal(sparkText(s['opus 5.5'].values, 12).length, 12)
})

// a graph model as lib/graphe.mjs builds it (invented): two projects, a coordinator with lanes, a peer message
const L = (key, o = {}) => ({ key, depth: 0, state: 'idle', tone: 'dim', title: 'Lane ' + key, roleId: 'lane', parentKey: '', peerKeys: [], ...o })
const GRAPH = { ready: true, hidden: 0, groups: [
  { name: 'proj-one', lines: [L('coord', { roleId: 'coord', state: 'working', tone: 'ok' }), ...Array.from({ length: 7 }, (_, i) => L('k' + i, { parentKey: 'coord', state: i % 2 ? 'working' : 'idle', tone: i % 2 ? 'ok' : 'dim' })), L('kk', { parentKey: 'k1', peerKeys: ['pm'] })] },
  { name: 'proj-two', lines: [L('pm', { roleId: 'coord', state: 'waiting', tone: 'warn' }), L('b', { parentKey: 'pm', state: 'blocked', tone: 'bad' })] },
  { name: 'proj-three', lines: Array.from({ length: 15 }, (_, i) => L('x' + i)) },
] }

test('graph layout: boxes per project, layered, no overlapping nodes, active first, +N past 20', () => {
  const g = graphLayout(GRAPH, { width: 420 })
  assert.equal(g.nodes.length, 20)
  assert.equal(g.more, 26 - 20)
  assert.equal(overlaps(g.nodes), false)
  // every active conversation is drawn
  for (const k of ['coord', 'k1', 'k3', 'k5', 'pm', 'b']) assert.ok(g.nodes.some((n) => n.key === k), k)
  // inside its project's box, children under their parent, coordinators bigger
  const at = (k) => g.nodes.find((n) => n.key === k)
  const box = (name) => g.boxes.find((b) => b.name === name)
  for (const n of g.nodes) assert.ok(n.x >= 0 && n.x + n.w <= g.width && n.y >= 0 && n.y + n.h <= g.height)
  assert.ok(at('k0').y > at('coord').y && at('kk').y > at('k1').y)
  assert.ok(at('b').y >= box('proj-two').y && at('b').y + at('b').h <= box('proj-two').y + box('proj-two').h)
  assert.ok(at('coord').h > at('k0').h)
  assert.ok(g.edges.some((e) => e.kind === 'parent' && e.from === 'coord' && e.to === 'k0'))
  assert.ok(g.edges.some((e) => e.kind === 'peer' && e.from === 'kk' && e.to === 'pm'))
  // boxes do not overlap either, and the same model gives the same picture
  assert.equal(overlaps(g.boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))), false)
  assert.equal(graphSvg(g), graphSvg(graphLayout(GRAPH, { width: 420 })))
  assert.match(graphSvg(g), /stroke-dasharray="3 3"/)
  assert.match(graphSvg(g), /\+6</)
  // narrow: still no overlap
  assert.equal(overlaps(graphLayout(GRAPH, { width: 200 }).nodes), false)
})

test('the Panneau places the diagrams where the surface draws Svg and keeps the text elsewhere', () => {
  const view = panneauView(75, { open: { conv: true, convs: true, barres: true, debit: true, graphe: true }, closed: { pdetails: false } })
  const series = { five: [{ ts: NOW - 2 * H, pct: 0 }, { ts: NOW - 30 * MIN, pct: 1 }], week: [] }
  const panel = { ...view.panel,
    sankey: sankeyModel({ sessions: [{ cli: 'lead', models: { 'claude-opus-5-5': v(1000) }, subs: [{ workflow: 'wf_1', models: { 'claude-sonnet-5-5': v(300) } }] }] }, 'lead', [{ id: 'wf_1', name: 'package-wave' }]),
    quotaCurves: quotaCurves({ series, usage: { rateLimits: [{ kind: 'five_hour', percentUsed: 21, resetsAt: new Date(NOW + 130 * MIN).toISOString() }] }, now: NOW }),
    debitSpark: { 'opus 5.5': { values: [...Array(23).fill(null), 50], max: 50, last: 50 } } }
  const svgEl = { ...el, Svg: (props) => ({ type: 'Svg', props }) }
  const json = JSON.stringify(drawCockpit(svgEl, { ...view, panel }))
  for (const k of ['pl-sankey', 'pqc-five', 'pg-svg']) assert.match(json, new RegExp(`"key":"${k}"`), k)
  assert.match(json, /"alt":"TPS sur 24 h, opus 5.5"/)
  assert.doesNotMatch(json, /"key":"pl-contrib"/) // the Sankey replaces the bars on the desktop
  // the terminal: no Svg, the bars, the projection sentence and the ▁▇ sparkline instead
  const text = renderText(drawCockpit(el, { ...view, panel }), 75)
  assert.match(text, /Ce qui contribue/)
  assert.match(text, /à ce rythme : 100 % vers \d\d:\d\d/)
  assert.match(text, /Modèle : opus 5\.5 +·+█/)
})

// Julian, 21 Oct (45-column pane): « f… 11.3M opus 88 % » drawn on top of each other. A label is drawn only where it
// fits whole before the next column; under 60 columns the picture has no text and a legend sits under it.
test('Sankey labels never overlap: clipped to their column, none at all in a narrow pane, a legend under it there', () => {
  const big = { sessions: [{ cli: 'me', models: { 'claude-opus-5-5': v(4000000) }, subs: [
    { id: 's1', workflow: 'wf_long', models: { 'claude-opus-5-5': v(3000000), 'claude-sonnet-5-5': v(200000) } },
    { id: 's2', models: { 'claude-haiku-5-5': v(90000) } }] }] }
  const m = sankeyModel(big, 'me', [{ id: 'wf_long', name: 'a-very-long-workflow-name-for-a-narrow-pane' }])
  for (const width of [160, 220, 308, 420, 525]) {
    const svg = sankeySvg(m, { width, height: 84 })
    const right = Math.min(110, Math.max(70, Math.round(width * 0.26)))
    const g = sankeyLayout(m, { width, height: 84, right_w: right })
    const mx = g.models[0].x
    for (const [, x, text] of svg.matchAll(/<text class="ink" x="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
      const end = Number(x) + [...text.replace(/&[a-z]+;/g, '&')].length * CHAR_PX
      if (Number(x) < mx) assert.ok(end <= mx, `${width}px: « ${text} » runs into the models' column (${end} > ${mx})`)
      else assert.ok(end <= g.width, `${width}px: « ${text} » runs out of the picture`)
    }
  }
  assert.doesNotMatch(sankeySvg(m, { width: 308, labels: false }), /<text/)
  assert.deepEqual(sankeyLegend(m).map((x) => [x.kind, x.label]).slice(0, 2), [['source', 'fil principal'], ['source', 'a-very-long-workflow-name-for-a-narrow-pane']])
  // the Panneau: at 45 columns the Sankey has no text inside and its legend under it, at 75 the labels are inside
  const svgEl = { ...el, Svg: (props) => ({ type: 'Svg', props }) }
  const draw = (cols) => {
    const view = panneauView(cols, { closed: { pdetails: false } })
    return drawCockpit(svgEl, { ...view, panel: { ...view.panel, sankey: m } })
  }
  const find = (n, key) => { if (!n || typeof n !== 'object') return null; if (n.props && n.props.key === key) return n; for (const c of (n.props && n.props.children) || []) { const f = find(c, key); if (f) return f } return null }
  const narrow = draw(45)
  assert.doesNotMatch(find(narrow, 'pl-sankey').props.source, /<text/)
  for (const i of [0, 1, 2, 3]) assert.ok(find(narrow, 'pl-sk-' + i), 'legend line ' + i)
  const legend = JSON.stringify(find(narrow, 'pl-sk-0'))
  assert.match(legend, /fil principal/)
  assert.match(legend, /"■"/)
  const wide = draw(75)
  assert.match(find(wide, 'pl-sankey').props.source, /<text/)
  assert.equal(find(wide, 'pl-sk-0'), null)
})
