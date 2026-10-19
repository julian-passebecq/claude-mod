// cockpit - draws lib/viz_graph.mjs as an Svg: a soft box per project with its name, a pill per conversation (fill and
// border in its state's colour, coordinators bigger and bold, « ici » underlined), arrows parent → child and dashed
// arrows for peer messages, « +N » under it. A picture: the clickable list stays under it. graphSvg(layout) -> <svg>.
import { stateHex, INK, svgStyle, esc, clipPx } from '../lib/viz_palette.mjs'

const f1 = (n) => (Math.round(n * 10) / 10).toString()

export function graphSvg(g, o = {}) {
  const by = new Map(g.nodes.map((n) => [n.key, n]))
  const parts = [svgStyle(o.ink),
    `<defs><marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#8b949e"/></marker></defs>`]
  for (const b of g.boxes) {
    parts.push(`<rect x="${f1(b.x + 0.5)}" y="${f1(b.y + 0.5)}" width="${f1(b.w - 1)}" height="${f1(b.h - 1)}" rx="6" fill="${INK.track}" fill-opacity="0.25" stroke="${INK.line}"/>`)
    parts.push(`<text class="mut" x="${b.x + 6}" y="${b.y + 11}" font-size="9.5">${esc(clipPx(b.name, b.w - 12, 5.4))}</text>`)
  }
  for (const e of g.edges) {
    const a = by.get(e.from)
    const b = by.get(e.to)
    if (!a || !b) continue
    let d
    if (e.kind === 'parent') {
      const x0 = a.x + a.w / 2
      const y0 = a.y + a.h
      const x1 = b.x + b.w / 2
      const y1 = b.y - 1
      const my = (y0 + y1) / 2
      d = y1 > y0 ? `M${f1(x0)} ${f1(y0)}C${f1(x0)} ${f1(my)} ${f1(x1)} ${f1(my)} ${f1(x1)} ${f1(y1)}` : `M${f1(x0)} ${f1(a.y + a.h / 2)}L${f1(x1)} ${f1(b.y + b.h / 2)}`
    } else {
      // a peer: from the side of one to the side of the other, bowed so it does not run through the pills
      const left = a.x <= b.x
      const x0 = left ? a.x + a.w : a.x
      const x1 = left ? b.x : b.x + b.w
      const y0 = a.y + a.h / 2
      const y1 = b.y + b.h / 2
      const bow = Math.abs(y1 - y0) < 4 ? -10 : 0
      d = `M${f1(x0)} ${f1(y0)}Q${f1((x0 + x1) / 2)} ${f1((y0 + y1) / 2 + bow)} ${f1(x1)} ${f1(y1)}`
    }
    parts.push(`<path d="${d}" fill="none" stroke="#8b949e" stroke-width="1.1"${e.kind === 'peer' ? ' stroke-dasharray="3 3"' : ''} marker-end="url(#ar)"/>`)
  }
  for (const n of g.nodes) {
    const col = stateHex(n.tone)
    parts.push(`<rect x="${f1(n.x)}" y="${f1(n.y)}" width="${f1(n.w)}" height="${f1(n.h)}" rx="${n.h / 2}" fill="${col}" fill-opacity="0.18" stroke="${col}" stroke-width="${n.coord ? 2 : 1.2}"/>`)
    parts.push(`<circle cx="${f1(n.x + 8)}" cy="${f1(n.y + n.h / 2)}" r="${n.coord ? 3.5 : 2.8}" fill="${col}"/>`)
    const label = clipPx(n.title, n.w - 22, n.coord ? 6.2 : 5.6)
    parts.push(`<text class="ink" x="${f1(n.x + 15)}" y="${f1(n.y + n.h / 2 + 3.5)}" font-size="${n.coord ? 11 : 10}"${n.coord ? ' font-weight="bold"' : ''}${n.self ? ' text-decoration="underline"' : ''}>${esc(label)}</text>`)
  }
  if (g.more > 0) parts.push(`<text class="mut" x="4" y="${g.height - 3}" font-size="10">+${g.more}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}">${parts.join('')}</svg>`
}

/** What the picture says, for a reader that cannot see it. */
export function graphAlt(g, title = 'Graphe') {
  const per = g.boxes.map((b) => `${b.name} ${g.nodes.filter((n) => n.y >= b.y && n.y < b.y + b.h).length}`).join(', ')
  return `${title} : ${g.nodes.length} conversations (${per}), ${g.edges.length} liens${g.more ? `, +${g.more}` : ''}`
}
