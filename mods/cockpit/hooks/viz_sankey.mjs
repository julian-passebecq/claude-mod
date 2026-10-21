// cockpit - draws lib/viz_sankey.mjs as an Svg (a picture: no click inside, the rows around it stay the buttons).
// Ribbons coloured by model (lib/viz_palette.mjs), the sources' names and tokens in the middle, « opus 74 % » at the
// right. sankeySvg(model, { width, height, labels }) -> the <svg> string. Pure. A label is drawn only where it fits
// whole between its bar and the next column (Julian, 21 Oct: « f… 11.3M opus 88 % » drawn on top of each other at 45
// columns); labels: false draws no text at all: the pane then writes a legend under the picture (sankeyLegend).
import { sankeyLayout } from '../lib/viz_sankey.mjs'
import { svgStyle, esc, clipPx, INK } from '../lib/viz_palette.mjs'
import { kTok } from '../lib/panel.mjs'

const f1 = (n) => (Math.round(n * 10) / 10).toString()
// px per character of the 10.5-11 px labels, on the wide side so a label never runs into the next column
export const CHAR_PX = 6.6
const textPx = (t) => [...String(t)].length * CHAR_PX

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
  const labels = o.labels !== false
  const room = g.models.length ? g.models[0].x - g.sources[0].x - nw - 8 : 100
  // a label is pushed down under the one above it, left out past the bottom, and left out when it does not fit whole
  // between its bar and the models' column (the name is cut first, the tokens never)
  let lastS = -99
  let lastM = -99
  for (const s of g.sources) {
    parts.push(`<rect x="${s.x}" y="${f1(s.y)}" width="${nw}" height="${f1(Math.max(1, s.h))}" rx="1.5" fill="${INK.line}"/>`)
    const tok = kTok(s.tokens)
    const label = `${clipPx(s.label, room - textPx(tok + ' '), CHAR_PX)} ${tok}`
    const ty = Math.max(s.y + s.h / 2 + 4, lastS + 12)
    if (labels && s.h >= 3 && ty <= g.height && textPx(label) <= room) { parts.push(`<text class="ink" x="${s.x + nw + 3}" y="${f1(ty)}" font-size="10.5">${esc(label)}</text>`); lastS = ty }
  }
  const roomM = g.width - (g.models.length ? g.models[0].x + nw + 4 : g.width)
  for (const x of g.models) {
    parts.push(`<rect x="${x.x}" y="${f1(x.y)}" width="${nw}" height="${f1(Math.max(1, x.h))}" rx="1.5" fill="${x.hex}"/>`)
    const ty = Math.max(x.y + x.h / 2 + 4, lastM + 12)
    const text = textPx(`${x.label} ${x.pct} %`) <= roomM ? `${x.label} ${x.pct} %` : `${x.pct} %`
    if (labels && ty <= g.height && textPx(text) <= roomM) { parts.push(`<text class="ink" x="${x.x + nw + 4}" y="${f1(ty)}" font-size="11">${esc(text)}</text>`); lastM = ty }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}">${parts.join('')}</svg>`
}

/**
 * The legend written under the picture when the pane is narrow (labels: false): one line per source « name  9.1M »
 * and per model « opus  88 % » with its colour. -> [{ kind: source | model, label, value, hex }].
 */
export function sankeyLegend(m) {
  return [
    ...m.sources.map((s) => ({ kind: 'source', label: s.label, value: kTok(s.tokens), hex: INK.line })),
    ...m.models.map((x) => ({ kind: 'model', label: x.label, value: `${x.pct} %`, hex: x.hex, tone: x.tone })),
  ]
}

/** What the picture says, for a reader that cannot see it. */
export function sankeyAlt(m, L = {}) {
  const src = m.sources.map((s) => `${s.label} ${kTok(s.tokens)}`).join(', ')
  const mod = m.models.map((x) => `${x.label} ${x.pct} %`).join(', ')
  return `${L.title || 'Tokens'} ${kTok(m.total)} : ${src} ; ${mod}`
}
