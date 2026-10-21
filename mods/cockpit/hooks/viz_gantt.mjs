// cockpit Panneau - draws the Gantts of lib/viz_gantt.mjs. An Svg is a picture (no click inside it): the clickable rows
// stay where they are (the conversation and Workflow rows above it); a surface without Svg (the terminal, the text
// preview) gets the same bars as ▕███░░▏ rows.
//   drawDayGantt(u, P)    « Aujourd’hui ⌄ » under the CONVERSATIONS rows, folded with its title (P.closed.pgantt)
//   drawWfGantt(u, P, k)  a Workflow unfolded: its agents by phase, above the « Modèle | Temps » tables
// u: panel_view's primitives ({ h, c, W }); P: the Panneau's view model (now, syn, factory, convFactories, closed, act,
// colors, cfg, self, filter).
import { dayGantt, wfGantt, textCells, tickLine, ganttConfig, hourLabel } from '../lib/viz_gantt.mjs'
import { palette } from '../lib/viz_palette.mjs'
import { clipPx } from './svg.mjs'

const NB = String.fromCharCode(160)
const nb = (n) => NB.repeat(Math.max(0, n))
const len = (s) => [...String(s ?? '')].length
const clip = (t, n) => {
  const a = [...String(t ?? '')]
  return a.length > n ? a.slice(0, Math.max(1, n - 1)).join('') + '…' : a.join('')
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const f1 = (n) => (Math.round(n * 10) / 10).toString()
const FONT = 'font-family="sans-serif"'

// ---- SVG -----------------------------------------------------------------------------------------------------------

/**
 * Bars on a time axis, as one SVG. rows: [{ label, bars: [{ x0, x1, eta, state, family }] } | { phase: title }];
 * m: { now, eta, ticks }; o: { width (px), labelW (px), legend: [{ kind, family?, text }] }.
 */
export function ganttSvg(rows, m, pal, o = {}) {
  const width = Math.max(120, Math.round(o.width || 360))
  const lw = Math.round(o.labelW ?? Math.min(110, width * 0.26))
  const x0 = lw + 4
  const x1 = width - 4
  const X = (f) => x0 + (x1 - x0) * Math.max(0, Math.min(1, f))
  const rh = 11
  const ph = 10
  const bh = 7
  const ink = pal.ink
  const st = pal.states
  const parts = [`<defs><pattern id="gh" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"><rect width="4" height="4" fill="${st.warn}" fill-opacity="0.35"/><rect width="2" height="4" fill="${st.warn}"/></pattern></defs>`]
  let y = 2
  const body = []
  for (const r of rows) {
    if (r.phase !== undefined) {
      if (y > 2) body.push(`<line x1="0" x2="${width}" y1="${f1(y + 1)}" y2="${f1(y + 1)}" stroke="${ink.line}" stroke-width="0.8" stroke-dasharray="2 2"/>`)
      body.push(`<text x="0" y="${f1(y + ph - 1)}" font-size="8.5" font-weight="bold" ${FONT} fill="${ink.text}">${esc(clipPx(r.phase, width - 4, 5))}</text>`)
      y += ph
      continue
    }
    const cy = y + rh / 2
    body.push(`<text x="0" y="${f1(cy + 3)}" font-size="9.5" ${FONT} fill="${ink.text}">${esc(clipPx(r.label, lw, 5.4))}</text>`)
    body.push(`<rect x="${f1(x0)}" y="${f1(cy - bh / 2)}" width="${f1(x1 - x0)}" height="${bh}" rx="2" fill="${ink.track}"/>`)
    for (const b of r.bars || []) {
      if (b.x0 === null || b.x0 === undefined) continue
      const a = X(b.x0)
      const w = Math.max(2, X(b.x1) - a)
      const col = pal.models[b.family] || pal.models.other
      if (Number.isFinite(b.eta) && b.eta > b.x1) body.push(`<line x1="${f1(a + w)}" x2="${f1(X(b.eta))}" y1="${f1(cy)}" y2="${f1(cy)}" stroke="${col}" stroke-width="2" stroke-dasharray="3 2"/>`)
      const top = f1(cy - bh / 2)
      if (b.state === 'stalled') body.push(`<rect x="${f1(a)}" y="${top}" width="${f1(w)}" height="${bh}" rx="2" fill="url(#gh)" stroke="${st.warn}" stroke-width="0.8"/>`)
      else if (b.state === 'failed') body.push(`<rect x="${f1(a)}" y="${top}" width="${f1(w)}" height="${bh}" rx="2" fill="${st.bad}"/>`)
      else if (b.state === 'running') {
        const tail = Math.min(10, w * 0.35)
        body.push(`<rect x="${f1(a)}" y="${top}" width="${f1(w)}" height="${bh}" rx="2" fill="${col}" fill-opacity="0.45"/>`)
        body.push(`<rect x="${f1(a)}" y="${top}" width="${f1(Math.max(1, w - tail))}" height="${bh}" rx="2" fill="${col}"/>`)
      } else body.push(`<rect x="${f1(a)}" y="${top}" width="${f1(w)}" height="${bh}" rx="2" fill="${col}"${b.state === 'pending' ? ' fill-opacity="0.3"' : ''}/>`)
    }
    y += rh
  }
  const bottom = y
  // hour ticks: a faint line through the rows, the label under the axis
  const ticks = (m.ticks || []).map((t) => `<line x1="${f1(X(t.x))}" x2="${f1(X(t.x))}" y1="2" y2="${f1(bottom + 2)}" stroke="${ink.grid}" stroke-width="0.8"/>` +
    `<text x="${f1(Math.min(X(t.x), width - 16))}" y="${f1(bottom + 11)}" font-size="8.5" ${FONT} fill="${ink.text}" text-anchor="${X(t.x) < x0 + 6 ? 'start' : 'middle'}">${esc(t.label)}</text>`)
  const marks = []
  if (Number.isFinite(m.eta) && m.eta !== null) marks.push(`<line x1="${f1(X(m.eta))}" x2="${f1(X(m.eta))}" y1="2" y2="${f1(bottom)}" stroke="${ink.text}" stroke-width="1" stroke-dasharray="2 2"/>`)
  if (Number.isFinite(m.now) && m.now !== null) marks.push(`<line x1="${f1(X(m.now))}" x2="${f1(X(m.now))}" y1="0" y2="${f1(bottom + 2)}" stroke="${ink.now}" stroke-width="1.5"/>`)
  let height = bottom + 14
  const legend = []
  if (o.legend && o.legend.length) {
    let lx = 0
    const ly = height + 6
    for (const it of o.legend) {
      const col = it.family ? pal.models[it.family] || pal.models.other : it.kind === 'stalled' ? 'url(#gh)' : it.kind === 'now' ? ink.now : ink.text
      if (it.kind === 'eta') legend.push(`<line x1="${lx}" x2="${lx + 10}" y1="${ly - 3}" y2="${ly - 3}" stroke="${ink.text}" stroke-width="1.5" stroke-dasharray="3 2"/>`)
      else if (it.kind === 'now') legend.push(`<line x1="${lx + 4}" x2="${lx + 4}" y1="${ly - 8}" y2="${ly + 1}" stroke="${col}" stroke-width="1.5"/>`)
      else legend.push(`<rect x="${lx}" y="${ly - 7}" width="10" height="6" rx="1.5" fill="${col}"/>`)
      const tw = len(it.text) * 4.8
      if (lx + 13 + tw > width) break
      legend.push(`<text x="${lx + 13}" y="${ly}" font-size="8.5" ${FONT} fill="${ink.text}">${esc(it.text)}</text>`)
      lx += 13 + tw + 8
    }
    height = ly + 3
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.ceil(height)}" viewBox="0 0 ${width} ${Math.ceil(height)}">${parts.join('')}${ticks.join('')}${body.join('')}${marks.join('')}${legend.join('')}</svg>`
}

// ---- text fallback ---------------------------------------------------------------------------------------------------

const TONES = { run: 'running', head: 'running', stalled: 'warn', failed: 'bad', now: 'warn' }

/** One ▕███░░▏ row: the label padded to lw, the bars in `cells` characters. */
function textRow(h, label, bars, now, lw, cells, key) {
  const runs = textCells(bars, cells, now)
  return h.row([
    h.T(clip(label, lw) + nb(lw - len(clip(label, lw))), { dim: true, key: 'l' }),
    h.T(NB + '▕', { dim: true, key: 'a' }),
    ...runs.map((r, i) => h.T(r.text.replace(/ /g, NB), { tone: TONES[r.kind], dim: r.kind === 'eta' || r.kind === 'empty', key: 'c' + i })),
    h.T('▏', { dim: true, key: 'z' }),
  ], { key, gap: 0, flexWrap: 'nowrap' })
}

function textBody(h, rows, m, width, key) {
  const lw = Math.max(6, Math.min(16, Math.floor(width * 0.28)))
  const cells = Math.max(8, width - lw - 3)
  const out = []
  rows.forEach((r, i) => {
    if (r.phase !== undefined) out.push(h.T(clip(r.phase, width), { dim: true, bold: true, wrap: 'truncate-end', key: `${key}-p${i}` }))
    else out.push(textRow(h, r.label, r.bars, m.now, lw, cells, `${key}-r${i}`))
  })
  out.push(h.T(nb(lw + 2) + tickLine(m.ticks, cells).replace(/ /g, NB), { dim: true, wrap: 'truncate-end', key: `${key}-ticks` }))
  return out
}

const pxOf = (u) => Math.round(u.W * (Number(u.c.style.bar_px) || 7))
const legendOf = (L, families, m, stalled) => [
  ...families.map((f) => ({ kind: 'model', family: f, text: f })),
  ...(stalled ? [{ kind: 'stalled', text: L.stalled }] : []),
  ...(m.eta !== null || m.hasEta ? [{ kind: 'eta', text: L.eta }] : []),
  ...(m.now !== null && m.now !== undefined ? [{ kind: 'now', text: L.now }] : []),
]

// ---- « Aujourd’hui » ---------------------------------------------------------------------------------------------------

/** The day Gantt under the CONVERSATIONS rows: [] when nothing ran today (or on Codex's list). */
export function drawDayGantt(u, P) {
  const { h } = u
  const g = ganttConfig(P.cfg)
  const L = g.labels
  const s = P.syn
  if (!Number.isFinite(P.now) || !s || !s.rows || (P.filter && P.filter.who === 'codex')) return []
  const convs = ((P.convList && P.convList.rows) || s.rows).filter((r) => r.id !== 'codex').map((r) => {
    const fm = r.id === P.self ? P.factory : (P.convFactories || {})[r.id]
    const cards = fm && fm.available ? [...(fm.cards || []), ...((fm.finished && fm.finished.cards) || [])] : []
    return { key: r.id, label: r.label, active: r.state === 'running' || r.state === 'waiting', cards }
  })
  const m = dayGantt(convs, P.now, { maxTracks: g.max_tracks, maxTicks: u.W >= 60 ? 6 : 4 })
  if (m.empty) return []
  const key = 'pgantt'
  const open = !(P.closed && P.closed[key])
  const summary = fill(L.summary, { from: hourLabel(m.t0), to: hourLabel(m.t1), n: m.tracks.length })
  const title = `${L.day} ${open ? '⌄' : '›'}`
  const head = h.row([
    h.tbtn(title, () => P.act.nodeToggle(key, open), 'pgantt-t', { plain: true }),
    u.W - len(title) - 4 > 8 ? h.T(clip(summary, u.W - len(title) - 4), { dim: true, wrap: 'truncate-end' }) : null,
  ], { key: 'pgantt-h', alignItems: 'center', flexWrap: 'nowrap' })
  if (!open) return [h.col([head], { key: 'p-gantt' })]
  const rows = m.tracks.map((t) => ({ label: t.label, bars: t.bars }))
  const pal = palette(P.colors)
  const families = [...new Set(m.tracks.flatMap((t) => t.bars.map((b) => b.family)))].filter((f) => f !== 'other')
  const stalled = m.tracks.some((t) => t.bars.some((b) => b.state === 'stalled'))
  const hasEta = m.tracks.some((t) => t.bars.some((b) => b.eta !== null))
  const alt = m.tracks.map((t) => `${t.label}: ${t.bars.length}`).join(' · ')
  const svg = h.svg(ganttSvg(rows, { ...m, eta: null }, pal, { width: pxOf(u), legend: legendOf(L, families, { ...m, eta: null, hasEta }, stalled) }), alt, 'pgantt-svg')
  const body = svg ? [svg] : textBody(h, rows, m, u.W, 'pgantt')
  if (m.more) body.push(h.T(fill(L.more, { n: m.more }), { dim: true, key: 'pgantt-more' }))
  return [h.col([head, ...body], { key: 'p-gantt' })]
}

// ---- a Workflow unfolded ---------------------------------------------------------------------------------------------

/** The Gantt of one Workflow card above its Phases: [] when no agent started. */
export function drawWfGantt(u, P, k) {
  const { h } = u
  if (!Number.isFinite(P.now) || !k) return []
  const L = ganttConfig(P.cfg).labels
  const m = wfGantt(k, P.now, { maxTicks: u.W >= 60 ? 4 : 3 })
  if (m.empty) return []
  const many = m.phases.length > 1
  const rows = []
  for (const p of m.phases) {
    if (many) rows.push({ phase: p.title })
    for (const r of p.rows) rows.push({ label: String(r.model).split(' ')[0].toLowerCase(), bars: [r] })
  }
  const families = [...new Set(m.phases.flatMap((p) => p.rows.map((r) => r.family)))].filter((f) => f !== 'other')
  const stalled = m.phases.some((p) => p.rows.some((r) => r.state === 'stalled'))
  const alt = m.phases.map((p) => `${p.title}: ${p.rows.length}`).join(' · ')
  const svg = h.svg(ganttSvg(rows, m, palette(P.colors), { width: pxOf(u), labelW: 46, legend: legendOf(L, families, m, stalled) }), alt, `pk-${k.key}-gantt`)
  return svg ? [svg] : textBody(h, rows, m, u.W, `pk-${k.key}-gantt`)
}

function fill(t, v) {
  return String(t || '').replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? '' : String(v[k])))
}
