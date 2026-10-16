// The context gauge, pure and self-contained (no imports): a thin rounded bar of this conversation's context with a
// mark at the hand-off threshold (RESUME, 250 K) and one at auto-compact, green -> orange -> red, and one short line
// under it (« compactage dans ~16 min · 53 tok/s · semaine 13 % »). Drawn by band above the prompt and by cockpit's
// Jauge strip (cockpit copies this file into its lib/, scripts/sync-libs.mjs). The desktop draws `svg`; the terminal,
// which has no Svg, draws `text`.

export type GaugeIn = {
  tokens?: number
  window: number
  /** auto-compact threshold in tokens */
  compactAt?: number
  /** hand-off threshold in tokens (RESUME rule) */
  handoffAt?: number
  /** minutes to auto-compact at the current growth */
  etaMin?: number
  level?: 'ok' | 'warn' | 'bad'
  /** short rate texts already formatted, e.g. ['53 tok/s'] */
  rates?: string[]
  week?: number
}

export type GaugeLabels = { ctx?: string; compact_in?: string; week?: string; handoff_mark?: string; compact_mark?: string; no_reading?: string }
export type GaugeColors = { ok?: string; warn?: string; bad?: string; track?: string; mark?: string; text?: string }

export type GaugeMark = { pct: number; label: string; kind: 'handoff' | 'compact' }
export type Gauge = { pct?: number; level: 'ok' | 'warn' | 'bad'; title: string; marks: GaugeMark[]; line: string; hasReading: boolean }

const DEF_LABELS: Required<GaugeLabels> = { ctx: 'ctx', compact_in: 'compactage dans', week: 'semaine', handoff_mark: 'relais', compact_mark: 'compact', no_reading: 'pas encore de mesure' }
const DEF_COLORS: Required<GaugeColors> = { ok: '#3fb950', warn: '#d29922', bad: '#f85149', track: '#8b949e55', mark: '#8b949e', text: '#8b949e' }

export const kTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(Math.round(n)))
const clamp = (x: number) => Math.max(0, Math.min(100, x))

export function gaugeModel(g: GaugeIn, labels: GaugeLabels = {}): Gauge {
  const L = { ...DEF_LABELS, ...labels }
  const w = g.window > 0 ? g.window : 0
  const pct = g.tokens !== undefined && w ? clamp((g.tokens * 100) / w) : undefined
  const marks: GaugeMark[] = []
  if (g.handoffAt && w) marks.push({ pct: clamp((g.handoffAt * 100) / w), label: `${L.handoff_mark} ${kTok(g.handoffAt)}`, kind: 'handoff' })
  if (g.compactAt && w) marks.push({ pct: clamp((g.compactAt * 100) / w), label: `${L.compact_mark} ${Math.round((g.compactAt * 100) / w)} %`, kind: 'compact' })
  const level = g.level ?? (g.tokens === undefined ? 'ok' : g.handoffAt && g.tokens >= g.handoffAt ? 'bad' : g.compactAt && g.tokens >= g.compactAt * 0.8 ? 'warn' : 'ok')
  const title = pct === undefined ? `${L.ctx} : ${L.no_reading}` : `${L.ctx} ${Math.round(pct)} % (${kTok(g.tokens ?? 0)})`
  const parts: string[] = []
  if (g.etaMin !== undefined && Number.isFinite(g.etaMin)) parts.push(`${L.compact_in} ~${Math.max(1, Math.round(g.etaMin))} min`)
  for (const r of g.rates ?? []) if (r) parts.push(r)
  if (g.week !== undefined) parts.push(`${L.week} ${Math.round(g.week)} %`)
  return { pct, level, title, marks, line: parts.join(' · '), hasReading: pct !== undefined }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type PlacedMark = GaugeMark & { x: number; anchor: 'start' | 'middle' | 'end'; show: boolean }

/** The mark the context reaches next (the first threshold above the fill), else the last one passed. */
export function nearestMark(m: Gauge): GaugeMark | undefined {
  const sorted = [...m.marks].sort((a, b) => a.pct - b.pct)
  return sorted.find((k) => k.pct > (m.pct ?? 0)) ?? sorted[sorted.length - 1]
}

/**
 * Where each mark's label goes on a bar `width` px wide, and which labels show: never two that overlap. The nearest
 * threshold ahead wins, then the others by distance to the fill; a label whose box (length x charPx, anchored start,
 * middle or end so it stays inside the bar) comes within `gap` px of an accepted one is hidden.
 * mode 'nearest' shows only the nearest one, 'none' none (ticks only).
 */
export function placeMarks(m: Gauge, width: number, mode: 'all' | 'nearest' | 'none' = 'all', charPx = 5.2, gap = 6): PlacedMark[] {
  const near = nearestMark(m)
  const isNear = (k: GaugeMark) => Boolean(near && k.kind === near.kind && k.pct === near.pct)
  const at = m.pct ?? 0
  const placed: PlacedMark[] = m.marks.map((k) => {
    const x = Math.round((width * k.pct) / 100)
    const w = k.label.length * charPx
    const anchor: PlacedMark['anchor'] = x + w / 2 > width ? 'end' : x - w / 2 < 0 ? 'start' : 'middle'
    return { ...k, x, anchor, show: false }
  })
  if (mode === 'none') return placed
  const span = (p: PlacedMark): [number, number] => {
    const w = p.label.length * charPx
    return p.anchor === 'start' ? [p.x, p.x + w] : p.anchor === 'end' ? [p.x - w, p.x] : [p.x - w / 2, p.x + w / 2]
  }
  const order = [...placed].sort((a, b) => Number(isNear(b)) - Number(isNear(a)) || Math.abs(a.pct - at) - Math.abs(b.pct - at))
  const taken: [number, number][] = []
  for (const p of order) {
    if (mode === 'nearest' && !isNear(p)) continue
    const [a, b] = span(p)
    if (taken.some(([c, d]) => a < d + gap && c < b + gap)) continue
    taken.push([a, b])
    p.show = true
  }
  return placed
}

/**
 * A thin rounded bar with tick marks, as an SVG document (Svg `source`). width in CSS px. labels: 'all' (default;
 * overlapping ones dropped by placeMarks), 'nearest' (the next threshold only) or 'none' (ticks only, a slimmer bar).
 */
export function gaugeSvg(m: Gauge, colors: GaugeColors = {}, width = 320, labels: 'all' | 'nearest' | 'none' = 'all'): string {
  const C = { ...DEF_COLORS, ...colors }
  const marks = placeMarks(m, width, labels)
  const h = marks.some((k) => k.show) ? 22 : 10
  const y = 2
  const bh = 6
  const fill = m.pct === undefined ? 0 : Math.max(bh, (width * m.pct) / 100)
  const ticks = marks.map((k) => {
    const dash = k.kind === 'handoff' ? ' stroke-dasharray="2 2"' : ''
    return `<line x1="${k.x}" y1="0" x2="${k.x}" y2="${y + bh + 2}" stroke="${C.mark}" stroke-width="1.5"${dash}/>` +
      (k.show ? `<text x="${k.x}" y="${h - 2}" font-size="9" font-family="sans-serif" fill="${C.text}" text-anchor="${k.anchor}">${esc(k.label)}</text>` : '')
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">` +
    `<rect x="0" y="${y}" width="${width}" height="${bh}" rx="3" fill="${C.track}"/>` +
    (fill ? `<rect x="0" y="${y}" width="${fill.toFixed(1)}" height="${bh}" rx="3" fill="${C[m.level]}"/>` : '') +
    ticks + '</svg>'
}

/** The same bar in text for the terminal: █ filled, ░ empty, ┃ at each mark. */
export function gaugeText(m: Gauge, width = 30): string {
  const w = Math.max(8, width)
  const full = m.pct === undefined ? 0 : Math.round((w * m.pct) / 100)
  const cells = Array.from({ length: w }, (_, i) => (i < full ? '█' : '░'))
  for (const k of m.marks) cells[Math.min(w - 1, Math.round((w * k.pct) / 100))] = '┃'
  return cells.join('')
}

/** A thin rounded bar for a percentage (usage cards): same look as the gauge, no marks. */
export function barSvg(pct: number, color: string, width = 320, track = DEF_COLORS.track): string {
  const p = clamp(pct)
  const fill = p > 0 ? Math.max(4, (width * p) / 100) : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6" viewBox="0 0 ${width} 6">` +
    `<rect x="0" y="0" width="${width}" height="6" rx="3" fill="${track}"/>` +
    (fill ? `<rect x="0" y="0" width="${fill.toFixed(1)}" height="6" rx="3" fill="${color}"/>` : '') + '</svg>'
}
