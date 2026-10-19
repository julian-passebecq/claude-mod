// cockpit - a 24 h TPS sparkline (lib/viz_spark.mjs) as a tiny Svg in the model's colour: a line over the hours with a
// reply (a gap for an hour without), a dot on the last one. sparkSvg(series, hex, { width, height }) -> <svg>. And
// sparkText(values, cells): the same as ▁▂▃▅▇ characters for a surface without Svg. Pure.

const f1 = (n) => (Math.round(n * 10) / 10).toString()

export function sparkSvg(s, hex, o = {}) {
  const width = Math.max(40, Math.round(o.width || 96))
  const height = Math.max(8, Math.round(o.height || 14))
  const n = s.values.length
  const max = s.max > 0 ? s.max : 1
  const x = (i) => 1 + ((width - 2) * i) / Math.max(1, n - 1)
  const y = (v) => height - 1.5 - ((height - 3) * v) / max
  const segs = []
  let cur = []
  s.values.forEach((v, i) => {
    if (v === null) { if (cur.length) segs.push(cur); cur = []; return }
    cur.push([x(i), y(v)])
  })
  if (cur.length) segs.push(cur)
  const parts = [`<line x1="0" y1="${height - 0.5}" x2="${width}" y2="${height - 0.5}" stroke="#8b949e40"/>`]
  for (const sg of segs) {
    if (sg.length === 1) parts.push(`<circle cx="${f1(sg[0][0])}" cy="${f1(sg[0][1])}" r="1.2" fill="${hex}"/>`)
    else parts.push(`<polyline points="${sg.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ')}" fill="none" stroke="${hex}" stroke-width="1.4" stroke-linejoin="round"/>`)
  }
  const li = s.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop()
  if (li !== undefined) parts.push(`<circle cx="${f1(x(li))}" cy="${f1(y(s.values[li]))}" r="2" fill="${hex}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
}

const BLOCKS = '▁▂▃▄▅▆▇█'
/** The values in `cells` characters (each the max of its hours), « · » for no reply. */
export function sparkText(values, cells = 12) {
  const n = Math.max(1, Math.min(cells, values.length))
  const per = values.length / n
  const known = values.filter((v) => v !== null)
  const max = known.length ? Math.max(...known) : 1
  let out = ''
  for (let i = 0; i < n; i++) {
    const part = values.slice(Math.floor(i * per), Math.floor((i + 1) * per)).filter((v) => v !== null)
    out += part.length ? BLOCKS[Math.min(7, Math.floor((7.99 * Math.max(...part)) / (max || 1)))] : '·'
  }
  return out
}
