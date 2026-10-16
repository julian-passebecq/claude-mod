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

/** A thin rounded bar with tick marks, as an SVG document (Svg `source`). width in CSS px. */
export function gaugeSvg(m: Gauge, colors: GaugeColors = {}, width = 320): string {
  const C = { ...DEF_COLORS, ...colors }
  const h = m.marks.length ? 26 : 10
  const y = 2
  const bh = 6
  const fill = m.pct === undefined ? 0 : Math.max(bh, (width * m.pct) / 100)
  const ticks = m.marks.map((k) => {
    const x = Math.round((width * k.pct) / 100)
    const anchor = x > width - 60 ? 'end' : x < 60 ? 'start' : 'middle'
    const dash = k.kind === 'handoff' ? ' stroke-dasharray="2 2"' : ''
    return `<line x1="${x}" y1="0" x2="${x}" y2="${y + bh + 2}" stroke="${C.mark}" stroke-width="1.5"${dash}/>` +
      `<text x="${x}" y="${h - 2}" font-size="9" font-family="sans-serif" fill="${C.text}" text-anchor="${anchor}">${esc(k.label)}</text>`
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
