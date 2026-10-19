// cockpit Panneau, GRAPHE unfolded: the drawn graph above the clickable list (Julian, 19 Oct: « a real diagram »).
// One box per project (the graph's groups, in their order), the conversations inside as pills laid out in layers: a
// conversation whose parent (spawnedFrom) is drawn in the same box sits one layer under it, near it; arrows parent →
// child, dashed arrows for peer messages; colour = state, coordinators bigger. At most `max` (20) conversations, the
// active ones (travaille, attend, bloquée) first, then the graph's order; « +N » for the rest. Deterministic: the same
// model gives the same picture. Pure: no $, no I/O (node --test mods/cockpit/tests/viz.test.mjs).

const LIVE = new Set(['working', 'waiting', 'blocked'])

export const GRAPH_DEFAULTS = { max: 20, node_w: 108, node_h: 18, coord_h: 24, coord_w: 128, gap_x: 10, gap_y: 14, pad: 6, head_h: 14, box_gap: 6 }

/**
 * model: lib/graphe.mjs grapheModel(...); o: { width (px), ...GRAPH_DEFAULTS overrides }.
 * -> { width, height, boxes: [{ name, x, y, w, h }], nodes: [{ key, title, state, tone, coord, self, x, y, w, h }],
 *      edges: [{ from, to, kind: 'parent' | 'peer' }], more }
 */
export function graphLayout(model, o = {}) {
  const c = { ...GRAPH_DEFAULTS, ...o }
  const width = Math.max(160, Math.round(c.width || 360))
  const all = []
  for (const g of (model && model.groups) || []) for (const l of g.lines || []) all.push({ ...l, group: g.name })
  const max = Math.max(1, Number(c.max) || 20)
  const rank = (l) => (LIVE.has(l.state) ? 0 : 1)
  const picked = all.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).slice(0, max)
  const keep = new Set(picked.map((x) => x.l.key))
  const shown = all.filter((l) => keep.has(l.key))
  const more = all.length - shown.length + ((model && model.hidden) || 0)
  const groups = []
  for (const l of shown) {
    let g = groups.find((x) => x.name === l.group)
    if (!g) groups.push((g = { name: l.group, lines: [] }))
    g.lines.push(l)
  }
  const boxes = []
  const nodes = []
  let y = 0
  const inner = width - 2 * c.pad
  for (const g of groups) {
    const keys = new Set(g.lines.map((l) => l.key))
    // the layer of each conversation: its parent's + 1 when its parent is in this box, else 0
    const layer = new Map()
    const layerOf = (l, seen = new Set()) => {
      if (layer.has(l.key)) return layer.get(l.key)
      if (seen.has(l.key)) return 0
      seen.add(l.key)
      const p = l.parentKey && keys.has(l.parentKey) ? g.lines.find((x) => x.key === l.parentKey) : null
      const v = p ? layerOf(p, seen) + 1 : 0
      layer.set(l.key, v)
      return v
    }
    g.lines.forEach((l) => layerOf(l))
    const depth = Math.max(0, ...layer.values())
    const top = y + c.head_h
    let cy = top + c.pad
    const pos = new Map()
    for (let d = 0; d <= depth; d++) {
      // a layer in the order of its parents' places, then the graph's order
      const list = g.lines.map((l, i) => ({ l, i })).filter((x) => layer.get(x.l.key) === d)
        .sort((a, b) => ((pos.get(a.l.parentKey) ?? -1) - (pos.get(b.l.parentKey) ?? -1)) || a.i - b.i).map((x) => x.l)
      let row = []
      let rowW = 0
      const flush = () => {
        if (!row.length) return
        const h = Math.max(...row.map((n) => n.h))
        let x = c.pad
        for (const n of row) { n.x = x; n.y = cy + (h - n.h) / 2; x += n.w + c.gap_x; pos.set(n.key, nodes.length); nodes.push(n) }
        cy += h + c.gap_y
        row = []
        rowW = 0
      }
      for (const l of list) {
        const coord = l.roleId === 'coord'
        const w = Math.min(inner, coord ? c.coord_w : c.node_w)
        if (row.length && rowW + c.gap_x + w > inner) flush()
        row.push({ key: l.key, title: l.title, state: l.state, tone: l.tone, coord, self: Boolean(l.self), parentKey: l.parentKey || '', peerKeys: l.peerKeys || [], w, h: coord ? c.coord_h : c.node_h })
        rowW += (row.length > 1 ? c.gap_x : 0) + w
      }
      flush()
    }
    const h = cy - c.gap_y + c.pad - y
    boxes.push({ name: g.name, x: 0, y, w: width, h })
    y += h + c.box_gap
  }
  const at = new Set(nodes.map((n) => n.key))
  const edges = []
  for (const n of nodes) {
    if (n.parentKey && at.has(n.parentKey)) edges.push({ from: n.parentKey, to: n.key, kind: 'parent' })
    for (const p of n.peerKeys) if (at.has(p) && p !== n.key) edges.push({ from: n.key, to: p, kind: 'peer' })
  }
  const height = Math.max(20, y - c.box_gap + (more > 0 ? 14 : 0))
  return { width, height, boxes, nodes: nodes.map(({ parentKey, peerKeys, ...n }) => n), edges, more }
}

/** true when two drawn nodes overlap (the tests' check). */
export function overlaps(nodes) {
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i]
    const b = nodes[j]
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true
  }
  return false
}
