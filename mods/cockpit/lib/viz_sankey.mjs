// cockpit Panneau, micro « Cette conversation »: the Sankey of its tokens (Julian, 19 Oct: « sankey »):
// conversation → fil principal / each Workflow / the background agents → models; width = tokens, colour = model.
// On the desktop it replaces the « Ce qui contribue » bars, which stay as the text fallback. Pure: no $, no I/O
// (node --test mods/cockpit/tests/viz.test.mjs). Input: factory's scan (its detail for this conversation when it has
// it) and factory's Workflow screen runs (their names). The tokens are the scan's (input + output + cache), the same
// figures as the stats grid.
import { modelFamily, MODEL_COLORS, MODEL_TONES, familyLabel } from './viz_palette.mjs'

const tokensOf = (v) => (Array.isArray(v) ? (v[0] || 0) + (v[1] || 0) + (v[2] || 0) + (v[3] || 0) + (v[4] || 0) : 0)
const FAMS = ['opus', 'sonnet', 'haiku', 'fable', 'codex', 'other']

export const SANKEY_LABELS = { conv: 'conversation', main: 'fil principal', background: 'agents en fond', others: 'autres Workflows ({n})' }

function byFamily(maps) {
  const out = {}
  for (const mp of maps) for (const [m, v] of Object.entries(mp || {})) {
    const t = tokensOf(v)
    if (t > 0) { const f = modelFamily(m); out[f] = (out[f] || 0) + t }
  }
  return out
}

/**
 * scan: factory's scan; cli: the conversation; runs: [{ id, name }]; o: { labels, max_sources (5) }.
 * -> { available, total, sources: [{ id, kind, label, tokens, byModel: { fam: n } }], models: [{ family, label, tokens,
 *      pct, hex, tone }], links: [{ source, family, tokens }] } — links sum to every source's tokens, to every model's
 *      tokens and to total.
 */
export function sankeyModel(scan, cli, runs = [], o = {}) {
  const L = { ...SANKEY_LABELS, ...(o.labels || {}) }
  const sessions = (scan && scan.sessions) || []
  const me = sessions.find((s) => s.cli === cli || s.id === cli)
  if (!me) return { available: false, total: 0, sources: [], models: [], links: [] }
  const d = scan.detail && scan.detail.cli === cli ? scan.detail : me
  const subs = d.subs || me.subs || []
  const names = new Map((runs || []).filter((r) => r && r.id).map((r) => [r.id, r.name || r.id]))
  for (const c of d.calls || []) if (c && c.tool === 'Workflow' && c.runId && !names.has(c.runId)) names.set(c.runId, c.desc || c.runId)
  let sources = [{ id: 'main', kind: 'main', label: L.main, byModel: byFamily([me.models]) }]
  const wf = new Map()
  for (const x of subs) if (x.workflow) (wf.get(x.workflow) || wf.set(x.workflow, []).get(x.workflow)).push(x.models)
  for (const [id, maps] of wf) sources.push({ id: 'wf:' + id, kind: 'workflow', label: names.get(id) || id, byModel: byFamily(maps) })
  const bg = subs.filter((x) => !x.workflow).map((x) => x.models)
  if (bg.length) sources.push({ id: 'bg', kind: 'background', label: L.background, byModel: byFamily(bg) })
  sources = sources.map((s) => ({ ...s, tokens: Object.values(s.byModel).reduce((a, n) => a + n, 0) })).filter((s) => s.tokens > 0)
  // the biggest first, the main thread always first; past max_sources the smallest Workflows are one « autres » node
  const max = Math.max(2, Number(o.max_sources) || 5)
  const main = sources.filter((s) => s.kind === 'main')
  const rest = sources.filter((s) => s.kind !== 'main').sort((a, b) => b.tokens - a.tokens)
  if (main.length + rest.length > max) {
    const keep = rest.slice(0, max - main.length - 1)
    const fold = rest.slice(max - main.length - 1)
    const byModel = {}
    for (const s of fold) for (const [f, n] of Object.entries(s.byModel)) byModel[f] = (byModel[f] || 0) + n
    keep.push({ id: 'others', kind: 'workflow', label: L.others.replace('{n}', String(fold.length)), byModel, tokens: fold.reduce((a, s) => a + s.tokens, 0) })
    sources = [...main, ...keep]
  } else sources = [...main, ...rest]
  const total = sources.reduce((a, s) => a + s.tokens, 0)
  const fam = {}
  for (const s of sources) for (const [f, n] of Object.entries(s.byModel)) fam[f] = (fam[f] || 0) + n
  const models = FAMS.filter((f) => fam[f] > 0).map((f) => ({
    family: f, label: familyLabel(f), tokens: fam[f], pct: total ? Math.round((100 * fam[f]) / total) : 0, hex: MODEL_COLORS[f], tone: MODEL_TONES[f],
  }))
  const links = []
  for (const s of sources) for (const f of FAMS) if (s.byModel[f] > 0) links.push({ source: s.id, family: f, tokens: s.byModel[f] })
  return { available: total > 0, total, sources, models, links }
}

/**
 * Where everything sits, in px: three columns (the conversation, the sources, the models), each node a bar whose
 * height is its share of `inner` height, `gap` px between the nodes of a column. Every link has a band on its source
 * and on its model, of the same height. -> { width, height, conv: {x, y, h}, sources: [{ ...s, x, y, h }],
 * models: [{ ...m, x, y, h }], bands: [{ source, family, tokens, hex, a: {x, y0, y1}, b: {x, y0, y1}, c: {x, y0, y1} }] }
 * (a = on the conversation, b = on the source, c = on the model).
 */
export function sankeyLayout(m, o = {}) {
  const width = Math.max(160, Math.round(o.width || 320))
  const height = Math.max(40, Math.round(o.height || 96))
  const gap = o.gap ?? 4
  const nw = o.node_w || 6
  const top = 2
  const col = (n) => Math.max(1, height - top * 2 - gap * Math.max(0, n - 1))
  const k = (n) => (m.total > 0 ? col(n) / m.total : 0)
  const xs = [0, Math.round(width * (o.mid || 0.42)), width - (o.right_w || 92) - nw]
  const conv = { x: xs[0], y: top, h: m.total * k(1) }
  let y = top
  const ks = k(m.sources.length)
  const sources = m.sources.map((s) => { const r = { ...s, x: xs[1], y, h: s.tokens * ks }; y += r.h + gap; return r })
  y = top
  const km = k(m.models.length)
  const models = m.models.map((x) => { const r = { ...x, x: xs[2], y, h: x.tokens * km }; y += r.h + gap; return r })
  const at = { conv: conv.y, src: Object.fromEntries(sources.map((s) => [s.id, s.y])), mod: Object.fromEntries(models.map((x) => [x.family, x.y])) }
  const hex = Object.fromEntries(m.models.map((x) => [x.family, x.hex]))
  const bands = m.links.map((l) => {
    const ha = l.tokens * k(1)
    const hb = l.tokens * ks
    const hc = l.tokens * km
    const a = { x: xs[0] + nw, y0: at.conv, y1: at.conv + ha }
    at.conv += ha
    const b = { x: xs[1], y0: at.src[l.source], y1: at.src[l.source] + hb }
    at.src[l.source] += hb
    const c = { x: xs[2], y0: at.mod[l.family], y1: at.mod[l.family] + hc }
    at.mod[l.family] += hc
    return { ...l, hex: hex[l.family], a, b, c }
  })
  return { width, height, node_w: nw, conv, sources, models, bands }
}
