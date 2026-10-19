// cockpit - draws a lib/viz_quota.mjs projection as a small Svg line chart: x = the window (start → reset), y = 0..100 %,
// the readings as a solid line, a dashed projection from the last reading to the reset (red past 100 %, then clamped at
// the top edge), a faint 100 % line and a tick at now. quotaSvg(p, { width, height }) -> the <svg> string. Pure.
import { STATE_COLORS, INK, svgStyle } from '../lib/viz_palette.mjs'

const f1 = (n) => (Math.round(n * 10) / 10).toString()

export function quotaSvg(p, o = {}) {
  const width = Math.max(120, Math.round(o.width || 320))
  const height = Math.max(24, Math.round(o.height || 40))
  const pad = 2
  const start = p.start
  const end = p.end || Math.max(p.now, p.last.ts) + 1
  const x = (t) => pad + ((width - 2 * pad) * (Math.min(end, Math.max(start, t)) - start)) / Math.max(1, end - start)
  const y = (v) => height - pad - ((height - 2 * pad) * Math.max(0, Math.min(100, v))) / 100
  const tone = p.over ? 'bad' : p.last.pct >= 80 ? 'warn' : 'ok'
  const col = STATE_COLORS[tone] || STATE_COLORS.ok
  const parts = [svgStyle(o.ink)]
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="3" fill="${INK.track}" fill-opacity="0.35"/>`)
  parts.push(`<line x1="${pad}" y1="${f1(y(100))}" x2="${width - pad}" y2="${f1(y(100))}" stroke="${INK.grid}" stroke-dasharray="2 3"/>`)
  parts.push(`<line x1="${pad}" y1="${f1(y(50))}" x2="${width - pad}" y2="${f1(y(50))}" stroke="${INK.grid}" stroke-width="0.6"/>`)
  const pts = p.points.map((q) => `${f1(x(q.ts))},${f1(y(q.pct))}`)
  if (pts.length === 1) pts.unshift(`${f1(x(start))},${f1(y(0))}`)
  parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round"/>`)
  if (p.end && p.ratePerH !== null) {
    const proj = p.over ? STATE_COLORS.bad : STATE_COLORS.dim
    const to = p.over ? [x(p.hitAt), y(100)] : [x(p.end), y(p.projPct)]
    let d = `M${f1(x(p.last.ts))} ${f1(y(p.last.pct))}L${f1(to[0])} ${f1(to[1])}`
    if (p.over) d += `L${f1(x(p.end))} ${f1(y(100))}`
    parts.push(`<path d="${d}" fill="none" stroke="${proj}" stroke-opacity="${p.over ? 1 : 0.6}" stroke-width="1.4" stroke-dasharray="4 3"/>`)
    if (p.over) parts.push(`<circle cx="${f1(to[0])}" cy="${f1(to[1])}" r="2.6" fill="${STATE_COLORS.bad}"/>`)
  }
  parts.push(`<line x1="${f1(x(p.now))}" y1="${pad}" x2="${f1(x(p.now))}" y2="${height - pad}" stroke="${INK.line}" stroke-width="1"/>`)
  parts.push(`<circle cx="${f1(x(p.last.ts))}" cy="${f1(y(p.last.pct))}" r="2.4" fill="${col}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
}
