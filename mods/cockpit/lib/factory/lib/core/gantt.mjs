// Canonical copy: lib/core/gantt.mjs (repo root). Every mods/<mod>/lib/core/gantt.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// ONE Gantt renderer for Workflow agents (factory) and pipeline jobs (ci), so both look the same. Pure.
// Input rows: {label, status, queuedMs, startMs, endMs, estEndMs}; status queued | running | done | success | failed |
// canceled. Output: per row, text segments of exactly `width` cells with one symbol set:
//   ░ queue   █ done   ▓ running   ▒ failed   ┄ estimate   │ now   · empty
// svg() draws the same bars as an SVG string: a picture only (not clickable in a mod pane).

export const SYMBOLS = { queue: '░', done: '█', running: '▓', failed: '▒', est: '┄', now: '│', empty: '·' }
export const LEGEND = { queue: 'file', done: 'fini', running: 'en cours', failed: 'échoué', est: 'estimation', now: 'maintenant' }
export const COLORS = { queue: '#8b949e', done: '#3fb950', running: '#2f81f7', failed: '#f85149', est: '#8b949e', now: '#d29922', empty: '#8b949e55' }

const fin = (v) => Number.isFinite(v)

/** Kind of the run part of a row. */
export function runKind(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'failed' || s === 'error' || s === 'canceled' || s === 'cancelled') return 'failed'
  if (s === 'running' || s === 'queued' || s === 'pending') return 'running'
  return 'done'
}

const live = (r) => /^(running|queued|pending)$/i.test(String(r.status || ''))

/** Time span shown: earliest queue/start to the latest end, estimated end or now (when something is live). */
export function span(rows, nowMs) {
  const starts = rows.flatMap((r) => [r.queuedMs, r.startMs]).filter(fin)
  const t0 = starts.length ? Math.min(...starts) : nowMs
  const ends = rows.flatMap((r) => [r.endMs, r.estEndMs, r.startMs]).filter(fin)
  const t1 = Math.max(t0 + 1000, ...ends, rows.some(live) ? nowMs : t0 + 1000)
  return { t0, t1 }
}

/** Rows -> {rows: [{label, status, cells, segs: [{text, kind}]}], t0, t1, width, nowCol}. */
export function gantt(rows, nowMs, width = 40) {
  const list = (rows || []).filter((r) => r && (fin(r.queuedMs) || fin(r.startMs)))
  const w = Math.max(2, Math.floor(width))
  const { t0, t1 } = span(list, nowMs)
  const col = (t) => Math.max(0, Math.min(w - 1, Math.floor(((t - t0) / (t1 - t0)) * (w - 1))))
  const anyLive = list.some(live)
  const nowCol = anyLive && nowMs >= t0 && nowMs <= t1 ? col(nowMs) : -1
  const out = list.map((r) => {
    const kinds = new Array(w).fill('empty')
    const paint = (a, b, k) => {
      if (!fin(a) || !fin(b) || b < a) return
      for (let i = col(a); i <= col(b); i++) kinds[i] = k
    }
    const going = live(r)
    if (fin(r.queuedMs)) paint(r.queuedMs, fin(r.startMs) ? r.startMs : going ? nowMs : r.queuedMs, 'queue')
    const runEnd = fin(r.endMs) ? r.endMs : going ? nowMs : r.startMs
    if (fin(r.startMs)) paint(r.startMs, runEnd, runKind(r.status))
    if (going && fin(r.estEndMs) && r.estEndMs > nowMs) {
      const from = Math.max(nowMs, fin(runEnd) ? runEnd : nowMs)
      for (let i = col(from) + 1; i <= col(r.estEndMs); i++) if (kinds[i] === 'empty') kinds[i] = 'est'
    }
    if (nowCol >= 0 && kinds[nowCol] === 'empty') kinds[nowCol] = 'now'
    const segs = []
    for (const k of kinds) {
      const last = segs[segs.length - 1]
      if (last && last.kind === k) last.text += SYMBOLS[k]
      else segs.push({ text: SYMBOLS[k], kind: k })
    }
    return { label: String(r.label ?? ''), status: r.status, cells: kinds, segs }
  })
  return { rows: out, t0, t1, width: w, nowCol }
}

/** The legend line, in symbol order. */
export function legend(labels = {}) {
  const L = { ...LEGEND, ...labels }
  return ['queue', 'done', 'running', 'failed', 'est', 'now'].map((k) => `${SYMBOLS[k]} ${L[k]}`).join('  ')
}

const clock = (ms) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Axis line: `pad` spaces (label column), then start and end clock times at both ends of the bar. */
export function axis(g, pad = 0, fmt = clock) {
  const a = fmt(g.t0)
  const b = fmt(g.t1)
  return ' '.repeat(pad) + a + ' '.repeat(Math.max(1, g.width - a.length - b.length)) + b
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The same Gantt as an SVG string (a picture: labels left, one bar per row). */
export function svg(g, { cell = 6, row = 14, labelW = 120, colors = {} } = {}) {
  const C = { ...COLORS, ...colors }
  const W = labelW + g.width * cell
  const Hh = Math.max(row, g.rows.length * row)
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}">`]
  g.rows.forEach((r, i) => {
    const y = i * row
    parts.push(`<text x="0" y="${y + row - 4}" font-size="${row - 4}" fill="${C.queue}">${esc(r.label)}</text>`)
    let x = labelW
    for (const s of r.segs) {
      const n = [...s.text].length
      if (s.kind === 'now') parts.push(`<rect x="${x}" y="${y}" width="1" height="${row}" fill="${C.now}"/>`)
      else if (s.kind !== 'empty') {
        const dash = s.kind === 'est' ? ' stroke-dasharray="2 2" fill="none" stroke="' + C.est + '"' : ` fill="${C[s.kind]}"`
        parts.push(`<rect x="${x}" y="${y + 2}" width="${n * cell}" height="${row - 4}"${dash}/>`)
      }
      x += n * cell
    }
  })
  parts.push('</svg>')
  return parts.join('')
}
