// cockpit - the drawn tree: the rows of nav.treeRows as an SVG (the desktop's `Svg` element), pure.
// Elbow connectors from each node to its parent, a dot coloured by state, the selection on a soft band. An Svg is a
// picture (no click inside it, docs: « drawn isolated »), so the clickable rows stay as Buttons under it.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function clipPx(s, px, charPx = 6.6) {
  const n = Math.max(4, Math.floor(px / charPx))
  s = String(s ?? '')
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

// rows: [{ depth, label, tone, selected, kind, meta }]; colors: tone -> CSS colour; o: { width, row_h, max_rows }
export function treeSvg(rows, colors = {}, o = {}) {
  const width = o.width || 340
  const rh = o.row_h || 22
  const list = rows.slice(0, o.max_rows || 40)
  const more = rows.length - list.length
  const indent = 16
  const x0 = 10
  const height = (list.length + (more > 0 ? 1 : 0)) * rh + 8
  const col = (t) => colors[t] || colors.dim || '#8b949e'
  const parts = []
  const pos = list.map((r, i) => ({ x: x0 + r.depth * indent, y: 4 + i * rh + rh / 2 }))
  list.forEach((r, i) => {
    if (r.selected) parts.push(`<rect x="2" y="${pos[i].y - rh / 2 + 1}" width="${width - 4}" height="${rh - 2}" rx="5" fill="${colors.selected || '#d2a8ff'}" fill-opacity="0.18"/>`)
  })
  list.forEach((r, i) => {
    if (!r.depth) return
    for (let j = i - 1; j >= 0; j--) {
      if (list[j].depth === r.depth - 1) {
        const px = pos[j].x
        parts.push(`<path d="M${px} ${pos[j].y + 4} V${pos[i].y} H${pos[i].x - 5}" fill="none" stroke="${colors.line || '#8b949e88'}" stroke-width="1.2"/>`)
        break
      }
      if (list[j].depth < r.depth - 1) break
    }
  })
  list.forEach((r, i) => {
    const { x, y } = pos[i]
    const c = col(r.tone)
    if (r.kind === 'workflow') parts.push(`<rect x="${x - 4}" y="${y - 4}" width="8" height="8" transform="rotate(45 ${x} ${y})" fill="none" stroke="${c}" stroke-width="1.5"/>`)
    else if (r.kind === 'project') parts.push(`<rect x="${x - 5}" y="${y - 5}" width="10" height="10" rx="2" fill="${c}"/>`)
    else parts.push(`<circle cx="${x}" cy="${y}" r="${r.kind === 'agent' ? 3.5 : 4.5}" fill="${c}"/>`)
    const label = clipPx(r.label, width - x - 14)
    parts.push(`<text x="${x + 10}" y="${y + 4}" font-size="12" font-family="sans-serif" fill="${colors.text || '#c9d1d9'}"${r.selected ? ' font-weight="bold"' : ''}>${esc(label)}</text>`)
  })
  if (more > 0) parts.push(`<text x="${x0}" y="${height - 8}" font-size="11" font-family="sans-serif" fill="${col('dim')}">+ ${more}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
}

/**
 * A thin rounded bar like the ones of Claude's Usage pane: pct (0..100) filled, an optional tick at `mark` (0..100).
 * o: { width (px), height (px, 6), color, track, mark, markColor }. Scales to the slot (preserveAspectRatio none).
 */
export function meterSvg(pct, o = {}) {
  const w = Math.max(40, Math.round(o.width || 320))
  const hgt = o.height || 6
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  const fill = p > 0 ? Math.max(hgt, (w * p) / 100) : 0
  const r = hgt / 2
  const mark = o.mark === null || o.mark === undefined ? '' : `<rect x="${Math.min(w - 2, (w * Math.max(0, Math.min(100, o.mark))) / 100).toFixed(1)}" y="0" width="2" height="${hgt}" fill="${o.markColor || '#d29922'}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none">` +
    `<rect x="0" y="0" width="${w}" height="${hgt}" rx="${r}" fill="${o.track || '#8b949e33'}"/>` +
    (fill ? `<rect x="0" y="0" width="${fill.toFixed(1)}" height="${hgt}" rx="${r}" fill="${o.color || '#2f81f7'}"/>` : '') + mark + '</svg>'
}
