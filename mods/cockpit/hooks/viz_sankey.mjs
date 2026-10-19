// cockpit - draws lib/viz_sankey.mjs as an Svg (a picture: no click inside, the rows around it stay the buttons).
// Ribbons coloured by model (lib/viz_palette.mjs), the sources' names and tokens in the middle, « opus 74 % » at the
// right. sankeySvg(model, { width, height }) -> the <svg> string. Pure.
import { sankeyLayout } from '../lib/viz_sankey.mjs'
import { svgStyle, esc, clipPx, INK } from '../lib/viz_palette.mjs'
import { kTok } from '../lib/panel.mjs'

const f1 = (n) => (Math.round(n * 10) / 10).toString()

// one ribbon from (x0, y0..y1) to (x1, z0..z1), a cubic on each edge
function ribbon(x0, y0, y1, x1, z0, z1) {
  const mx = (x0 + x1) / 2
  return `M${f1(x0)} ${f1(y0)}C${f1(mx)} ${f1(y0)} ${f1(mx)} ${f1(z0)} ${f1(x1)} ${f1(z0)}L${f1(x1)} ${f1(z1)}C${f1(mx)} ${f1(z1)} ${f1(mx)} ${f1(y1)} ${f1(x0)} ${f1(y1)}Z`
}

export function sankeySvg(m, o = {}) {
  const right = Math.min(110, Math.max(70, Math.round((o.width || 320) * 0.26)))
  const g = sankeyLayout(m, { width: o.width, height: o.height, right_w: right })
  const nw = g.node_w
  const parts = [svgStyle(o.ink)]
  for (const b of g.bands) {
    parts.push(`<path d="${ribbon(b.a.x, b.a.y0, b.a.y1, b.b.x, b.b.y0, b.b.y1)}" fill="${b.hex}" fill-opacity="0.38"/>`)
    parts.push(`<path d="${ribbon(b.b.x + nw, b.b.y0, b.b.y1, b.c.x, b.c.y0, b.c.y1)}" fill="${b.hex}" fill-opacity="0.5"/>`)
  }
  parts.push(`<rect x="${g.conv.x}" y="${f1(g.conv.y)}" width="${nw}" height="${f1(Math.max(1, g.conv.h))}" rx="1.5" fill="${INK.line}"/>`)
  const room = g.models.length ? g.models[0].x - g.sources[0].x - nw - 8 : 100
  // a label is pushed down under the one above it, and left out past the bottom
  let lastS = -99
  let lastM = -99
  for (const s of g.sources) {
    parts.push(`<rect x="${s.x}" y="${f1(s.y)}" width="${nw}" height="${f1(Math.max(1, s.h))}" rx="1.5" fill="${INK.line}"/>`)
    const label = `${clipPx(s.label, room - 34)} ${kTok(s.tokens)}`
    const ty = Math.max(s.y + s.h / 2 + 4, lastS + 12)
    if (s.h >= 3 && ty <= g.height) { parts.push(`<text class="ink" x="${s.x + nw + 3}" y="${f1(ty)}" font-size="10.5">${esc(label)}</text>`); lastS = ty }
  }
  for (const x of g.models) {
    parts.push(`<rect x="${x.x}" y="${f1(x.y)}" width="${nw}" height="${f1(Math.max(1, x.h))}" rx="1.5" fill="${x.hex}"/>`)
    const ty = Math.max(x.y + x.h / 2 + 4, lastM + 12)
    if (ty <= g.height) { parts.push(`<text class="ink" x="${x.x + nw + 4}" y="${f1(ty)}" font-size="11">${esc(`${x.label} ${x.pct} %`)}</text>`); lastM = ty }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}">${parts.join('')}</svg>`
}

/** What the picture says, for a reader that cannot see it. */
export function sankeyAlt(m, L = {}) {
  const src = m.sources.map((s) => `${s.label} ${kTok(s.tokens)}`).join(', ')
  const mod = m.models.map((x) => `${x.label} ${x.pct} %`).join(', ')
  return `${L.title || 'Tokens'} ${kTok(m.total)} : ${src} ; ${mod}`
}
