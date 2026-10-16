// factory - SVG drawings for the desktop pane (pure: model in, markup out). Codex agent-tree look: dark panel,
// monospace, dashed boxes, arrows from the main thread to each agent, bars for effort, context and cost.
// Colours come from cfg.svg (factory.config.json); nothing here is hard-coded but the geometry.
import { fmtTokens, fmtUsd, hhmm, short, family } from './logic.mjs'

const W = 760
const CH = 6.6 // width of one 11px monospace character
const MAX = 120000 // the Svg source cap is 131,072 characters

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function wrap(s, n, max) {
  const out = []
  let cur = ''
  for (const w of String(s ?? '').split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w } else cur = (cur + ' ' + w).trim()
  }
  if (cur) out.push(cur)
  if (out.length > max) { out.length = max; out[max - 1] = clip(out[max - 1] + ' …', n) }
  return out.map((x) => clip(x, n))
}

export function clip(s, n) {
  s = String(s ?? '')
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…'
}

function pal(cfg) {
  const d = {
    bg: '#0d1117', panel: '#11161d', border: '#30363d', text: '#e6edf3', dim: '#8b949e', faint: '#21262d',
    opus: '#f0883e', sonnet: '#58a6ff', haiku: '#7ee787', fable: '#d2a8ff', other: '#8b949e', architect: '#bc8cff',
    running: '#58a6ff', done: '#7ee787', failed: '#ff7b72', stopped: '#8b949e', ok: '#7ee787', warn: '#e3b341', bad: '#ff7b72',
  }
  return { ...d, ...((cfg && cfg.svg && cfg.svg.colors) || {}) }
}

const EFFORT = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }

class Canvas {
  constructor(cfg) { this.c = pal(cfg); this.out = [] }
  text(x, y, s, o = {}) {
    const a = [`x="${x}"`, `y="${y}"`, `fill="${o.color || this.c.text}"`]
    if (o.size) a.push(`font-size="${o.size}"`)
    if (o.bold) a.push('font-weight="700"')
    if (o.anchor) a.push(`text-anchor="${o.anchor}"`)
    const t = o.tip ? `<title>${esc(o.tip)}</title>` : ''
    this.out.push(`<text ${a.join(' ')}>${t}${esc(s)}</text>`)
  }
  // several coloured runs on one line: one <text>, the browser advances the tspans
  runs(x, y, parts, o = {}) {
    const sp = parts.filter((p) => p && p.t).map((p) => {
      const a = [`fill="${p.c || this.c.text}"`]
      if (p.b) a.push('font-weight="700"')
      return `<tspan ${a.join(' ')}>${p.tip ? `<title>${esc(p.tip)}</title>` : ''}${esc(p.t)}</tspan>`
    })
    this.out.push(`<text x="${x}" y="${y}" xml:space="preserve"${o.size ? ` font-size="${o.size}"` : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${sp.join('')}</text>`)
  }
  box(x, y, w, h, color, o = {}) {
    const dash = o.solid ? '' : ' stroke-dasharray="4 3"'
    this.out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${o.fill || this.c.panel}" stroke="${color}" stroke-width="${o.sw || 1.2}"${dash}/>`)
    if (o.label) {
      const lw = o.label.length * CH + 12
      this.out.push(`<rect x="${x + 10}" y="${y - 7}" width="${lw}" height="13" fill="${this.c.bg}"/>`)
      this.text(x + 16, y + 3, o.label, { color, bold: true })
    }
  }
  bar(x, y, w, frac, color, o = {}) {
    const f = Math.max(0, Math.min(1, frac || 0))
    this.out.push(`<rect x="${x}" y="${y}" width="${w}" height="${o.h || 7}" rx="1" fill="${this.c.faint}"/>`)
    if (f > 0) this.out.push(`<rect x="${x}" y="${y}" width="${Math.max(2, w * f)}" height="${o.h || 7}" rx="1" fill="${color}"/>`)
    if (o.mark !== undefined) {
      const mx = x + w * o.mark
      this.out.push(`<line x1="${mx}" y1="${y - 3}" x2="${mx}" y2="${y + (o.h || 7) + 3}" stroke="${this.c.text}" stroke-width="1.5"/>`)
    }
  }
  pips(x, y, n, total, color) {
    for (let i = 0; i < total; i++) {
      this.out.push(`<rect x="${x + i * 7}" y="${y}" width="5" height="9" fill="${i < n ? color : this.c.faint}"/>`)
    }
  }
  arrow(x1, y1, x2, y2, color) {
    this.out.push(`<path d="M${x1},${y1} L${x2 - 6},${y2}" fill="none" stroke="${color}" stroke-width="1.2" stroke-dasharray="3 3"/>`)
    this.out.push(`<path d="M${x2 - 6},${y2 - 4} L${x2},${y2} L${x2 - 6},${y2 + 4} Z" fill="${color}"/>`)
    this.out.push(`<circle cx="${x1}" cy="${y1}" r="2.5" fill="${color}"/>`)
  }
  line(x1, y1, x2, y2, color) {
    this.out.push(`<path d="M${x1},${y1} L${x2},${y2}" fill="none" stroke="${color}" stroke-width="1.2" stroke-dasharray="3 3"/>`)
  }
  dot(x, y, r, color) { this.out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`) }
  done(h) {
    const body = this.out.join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" font-family="ui-monospace,SFMono-Regular,Consolas,Menlo,monospace" font-size="11">`
      + `<rect width="${W}" height="${h}" rx="8" fill="${this.c.bg}"/>${body}</svg>`
  }
}

const STATUS_ICON = { running: '◐ running', done: '✓ done', failed: '✗ failed', stopped: '◌ stopped' }

function famColor(c, model) { return c[family(model)] || c.other }

// ---- one conversation: agent tree ----------------------------------------------------------------------------

export function treeSvg(m, cfg, at) {
  const k = new Canvas(cfg)
  const c = k.c
  const L = 16, LW = 228, MX = 268, MW = 226, RX = 520, RW = 224
  let y = 26
  // header and legend
  k.runs(L, y, [{ t: 'FACTORY', b: true }, { t: ' · ', c: c.dim }, { t: clip(m.title, 52), b: true, tip: m.title },
    { t: '  ' + hhmm(at), c: c.dim }])
  y += 18
  k.runs(L, y, [{ t: clip(`${m.repo} · ${m.branch}`, 70), c: c.dim }])
  y += 18
  const fams = [...new Set([m.main.model, ...m.agents.map((a) => a.model), ...m.workflows.flatMap((w) => w.nodes.map((n) => n.model))].map(family))]
  let lx = L
  for (const f of fams) { k.out.push(`<rect x="${lx}" y="${y - 8}" width="8" height="8" fill="${c[f] || c.other}"/>`); k.text(lx + 12, y, f, { color: c.dim }); lx += 20 + f.length * CH + 10 }
  k.out.push(`<rect x="${lx}" y="${y - 8}" width="8" height="8" fill="${c.architect}"/>`); k.text(lx + 12, y, 'architect', { color: c.dim })
  y += 22

  // left: main box
  const top = y
  const mc = famColor(c, m.main.model)
  k.box(L, top, LW, 118, mc, { label: `${short(m.main.model)} · main` })
  let ly = top + 22
  k.runs(L + 12, ly, [{ t: 'effort ', c: c.dim }]); k.pips(L + 12 + 7 * CH, ly - 8, EFFORT[m.main.effort] || 0, 4, mc); k.text(L + 12 + 7 * CH + 32, ly, m.main.effort, { color: mc })
  ly += 18
  k.text(L + 12, ly, `context ${fmtTokens(m.main.ctx)} / ${fmtTokens(m.main.window)}`, { color: c[m.main.ctxLevel] })
  k.bar(L + 12, ly + 5, LW - 24, m.main.ctx / m.main.window, c[m.main.ctxLevel], { mark: ((cfg.thresholds || {}).handoff_tokens || 250000) / m.main.window })
  ly += 26
  k.runs(L + 12, ly, [{ t: 'cost so far ', c: c.dim }, { t: fmtUsd(m.main.cost), b: true }, { t: ' est.', c: c.dim }])
  ly += 16
  k.runs(L + 12, ly, [{ t: m.pr ? `PR #${m.pr.number} ${m.pr.state || ''}` : 'no PR yet', c: c.dim }, m.pr ? { t: ` CI ${m.pr.ci || '?'}`, c: m.pr.ci === 'failed' ? c.bad : m.pr.ci === 'success' ? c.ok : c.dim } : null])
  ly += 16
  k.text(L + 12, ly, m.main.live ? '◐ running' : '○ idle', { color: m.main.live ? c.running : c.dim })
  if (m.waiting) k.text(L + LW - 12, ly, 'waiting on Julian', { color: c.warn, anchor: 'end', bold: true })

  // middle: agents and workflows
  const MAXN = (cfg.svg && cfg.svg.max_boxes) || 10
  const nodes = [...m.agents.map((a) => ({ kind: 'agent', a })), ...m.workflows.map((w) => ({ kind: 'wf', w }))]
  const shown = nodes.slice(-MAXN)
  let my = top
  const BH = 76
  const BUS = L + LW + 20
  for (const n of shown) {
    if (n.kind === 'agent') {
      const a = n.a
      const col = a.architect ? c.architect : famColor(c, a.model)
      k.box(MX, my, MW, BH - 8, col, { label: clip(a.type, 22) })
      k.runs(MX + 12, my + 20, [{ t: clip(short(a.model), 14), c: famColor(c, a.model) }, a.explicit ? null : { t: '  no model!', c: c.warn }])
      k.text(MX + 12, my + 35, 'effort', { color: c.dim }); k.pips(MX + 12 + 7 * CH, my + 27, EFFORT[a.effort] || 0, 4, col)
      k.text(MX + MW - 12, my + 35, `${fmtTokens(a.tokens)} · ${fmtUsd(a.cost)}`, { color: c.dim, anchor: 'end' })
      k.text(MX + 12, my + 50, clip(a.architect ? `◆ ${a.architect} · ${a.task}` : a.task, 31), { color: a.architect ? c.architect : c.text, tip: a.task })
      k.text(MX + 12, my + 63, STATUS_ICON[a.status] || a.status, { color: c[a.status] || c.dim })
    } else {
      const w = n.w
      k.box(MX, my, MW, BH - 8, c.dim, { label: clip(`workflow ${w.name}`, 26) })
      k.text(MX + 12, my + 20, `${w.nodes.length} agents · ${w.running} running`, { color: c.text })
      k.text(MX + MW - 12, my + 35, `${fmtTokens(w.tokens)} · ${fmtUsd(w.cost)}`, { color: c.dim, anchor: 'end' })
      w.nodes.slice(0, 28).forEach((x, i) => k.dot(MX + 16 + (i % 14) * 14, my + 46 + Math.floor(i / 14) * 12, 4, x.status === 'running' ? c.running : x.status === 'failed' ? c.bad : famColor(c, x.model)))
    }
    k.arrow(BUS, my + 22, MX, my + 22, n.kind === 'agent' && n.a.architect ? c.architect : c.dim)
    my += BH
  }
  if (shown.length) { k.line(L + LW, top + 30, BUS, top + 30, c.dim); k.line(BUS, top + 30, BUS, my - BH + 22, c.dim) }
  if (!shown.length) { k.box(MX, my, MW, 40, c.border); k.text(MX + 12, my + 24, 'no subagents yet', { color: c.dim }); my += 48 }
  if (nodes.length > shown.length) { k.text(MX + 12, my + 4, `+ ${nodes.length - shown.length} earlier agents`, { color: c.dim }); my += 14 }

  // right: bill, approvals, warnings
  let ry = top
  const bill = Object.entries(m.bill).sort((a, b) => b[1].cost - a[1].cost)
  const bh = 34 + bill.length * 26 + 22 + 34
  k.box(RX, ry, RW, bh, c.architect, { label: 'bill · estimate' })
  let by = ry + 20
  const maxCost = Math.max(0.0001, ...bill.map(([, b]) => b.cost))
  for (const [model, b] of bill) {
    k.runs(RX + 12, by, [{ t: clip(short(model), 12), c: famColor(c, model) }])
    k.text(RX + RW - 12, by, fmtUsd(b.cost), { anchor: 'end', bold: true })
    k.bar(RX + 12, by + 5, RW - 24, b.cost / maxCost, famColor(c, model))
    by += 26
  }
  k.runs(RX + 12, by, [{ t: 'total ', c: c.dim }, { t: fmtUsd(m.total), b: true }])
  by += 14
  k.text(RX + 12, by + 2, 'per turn', { color: c.dim })
  const turns = m.turns
  const tmax = Math.max(0.0001, ...turns.map((t) => t.cost))
  const tw = Math.max(4, Math.floor((RW - 24) / Math.max(1, turns.length)) - 3)
  turns.forEach((t, i) => {
    const hh = Math.max(1, 24 * t.cost / tmax)
    k.out.push(`<rect x="${RX + 12 + i * (tw + 3)}" y="${by + 32 - hh}" width="${tw}" height="${hh}" fill="${t.agents ? c.architect : c.sonnet}"><title>${esc(`${hhmm(t.ts)} ${fmtUsd(t.cost)} ${t.kind}: ${t.text}`)}</title></rect>`)
  })
  ry += bh + 16

  const guards = m.guards.slice(-5)
  const gh = 26 + Math.max(1, guards.length) * 15
  k.box(RX, ry, RW, gh, c.ok, { label: 'approvals · guards' })
  if (!guards.length) k.text(RX + 12, ry + 22, '✓ nothing refused', { color: c.ok })
  guards.forEach((g, i) => k.runs(RX + 12, ry + 22 + i * 15, [{ t: hhmm(g.ts).slice(0, 5) + ' ', c: c.dim }, { t: clip(g.text, 25), c: c.warn, tip: g.text }]))
  ry += gh + 16

  // left column under the main box: warnings, wrapped
  let wy = top + 118 + 18
  const warns = m.warnings.slice(0, 6)
  const wl = warns.map((w) => ({ w, lines: wrap(w.text, 32, 3) }))
  const wh = 24 + Math.max(1, wl.reduce((n, x) => n + x.lines.length, 0)) * 13 + wl.length * 5
  k.box(L, wy, LW, wh, warns.length ? c.warn : c.ok, { label: `warnings · ${m.warnings.length}` })
  if (!warns.length) k.text(L + 12, wy + 22, '✓ none', { color: c.ok })
  let wyy = wy + 22
  for (const x of wl) {
    x.lines.forEach((ln, i) => k.text(L + 12, wyy + i * 13, (i ? '  ' : '• ') + ln, { color: c[x.w.level], tip: x.w.text }))
    wyy += x.lines.length * 13 + 5
  }
  wy += wh + 16

  // architect strip
  y = Math.max(wy, my, ry) + 8
  const arch = [...m.agents, ...m.workflows.flatMap((w) => w.nodes)].filter((a) => a.architect)
  const moments = ((cfg.architect && cfg.architect.reasons) || []).map((r) => r.label)
  k.box(L, y, W - 2 * L, 46, c.architect, { label: 'architect · on call' })
  let ax = L + 12
  for (const mo of moments) {
    const hit = arch.some((a) => a.architect === mo)
    k.text(ax, y + 22, `${hit ? '◆' : '◇'} ${mo}`, { color: hit ? c.architect : c.dim, bold: hit }); ax += (mo.length + 5) * CH
  }
  k.text(W - L - 12, y + 22, `calls ${arch.length}  read ${fmtTokens(arch.reduce((s, a) => s + a.tokens, 0))}`, { color: c.text, anchor: 'end' })
  const last = arch[arch.length - 1]
  k.text(L + 12, y + 37, last ? clip(`last: » ${last.task}`, 104) : 'no architect call in this conversation', { color: c.dim })
  y += 62

  // session log
  const ev = m.events
  const lh = 24 + ev.length * 15
  k.box(L, y, W - 2 * L, lh, c.border, { label: 'session log' })
  const KIND = { prompt: c.text, human: c.text, agent: c.architect, notif: c.haiku, tool: c.sonnet, pr: c.opus, compact: c.warn, peer: c.fable }
  ev.forEach((e, i) => k.runs(L + 12, y + 22 + i * 15, [{ t: hhmm(e[0]) + '  ', c: c.dim }, { t: clip(e[1], 7).padEnd(8), c: KIND[e[1]] || c.dim, b: true }, { t: clip(e[2], 88), tip: e[2] }]))
  y += lh + 18

  // status line
  const run = m.agents.filter((a) => a.status === 'running').length + m.workflows.reduce((s, w) => s + w.running, 0)
  const total = m.agents.length + m.workflows.reduce((s, w) => s + w.nodes.length, 0)
  k.runs(L, y, [{ t: 'main ', c: c.dim }, { t: `[${short(m.main.model)} · ${m.main.effort}]`, c: mc }, { t: '   agents ', c: c.dim }, { t: `[${run}/${total}]`, c: c.running },
    { t: '   architect ', c: c.dim }, { t: `[${arch.length} calls]`, c: c.architect }, { t: '   ctx ', c: c.dim }, { t: `[${m.main.ctxPct}%]`, c: c[m.main.ctxLevel] }])
  const svg = k.done(y + 16)
  return svg.length <= MAX ? svg : treeSvg({ ...m, events: m.events.slice(-5), agents: m.agents.slice(-4), workflows: m.workflows.slice(-1) }, cfg, at)
}

// ---- dashboard -------------------------------------------------------------------------------------------------

export function dashSvg(g, cfg, at, label, opts = {}) {
  const k = new Canvas(cfg)
  const c = k.c
  const L = 16
  let y = 26
  k.runs(L, y, [{ t: 'FACTORY', b: true }, { t: ' · all conversations', c: c.dim }, { t: '   ' + g.today + ' ' + hhmm(at), c: c.dim }])
  y += 16
  // KPI tiles
  const live = g.rows.filter((r) => r.live).length
  const waiting = g.rows.filter((r) => r.waiting).length
  const tiles = [['conversations', String(g.rows.length), c.text], ['live now', String(live), c.running], ['today', fmtUsd(g.totalCost), c.opus],
    ['calls today', String(g.totalCalls), c.text], ['wait on Julian', String(waiting), waiting ? c.warn : c.ok]]
  const tw = (W - 2 * L - 4 * 10) / 5
  tiles.forEach(([lab, val, col], i) => {
    const x = L + i * (tw + 10)
    k.box(x, y + 8, tw, 46, c.border, { solid: true })
    k.text(x + 10, y + 26, lab, { color: c.dim })
    k.text(x + 10, y + 46, val, { color: col, size: 17, bold: true })
  })
  y += 76
  // routing share: one stacked bar + target marks
  k.box(L, y, W - 2 * L, 70, c.border, { label: `model share today (${label}) vs V4.8 targets` })
  const bx = L + 12, bw = W - 2 * L - 24
  let cx = bx
  for (const s of g.share) {
    const w = bw * s.share
    if (w > 0) k.out.push(`<rect x="${cx}" y="${y + 16}" width="${w}" height="14" fill="${c[s.family]}"><title>${esc(`${s.family} ${Math.round(s.share * 100)}%`)}</title></rect>`)
    cx += w
  }
  g.share.forEach((s, i) => {
    const x = L + 12 + i * ((W - 2 * L) / 3)
    k.runs(x, y + 48, [{ t: '■ ', c: c[s.family] }, { t: `${s.family} ${Math.round(s.share * 100)}%`, b: true }, { t: ` target ${s.target} `, c: c.dim }, { t: s.ok ? '✓' : '✗', c: s.ok ? c.ok : c.bad, b: true }])
    k.text(x + 12, y + 62, `${s.calls} calls · ${fmtUsd(s.cost)}`, { color: c.dim })
  })
  y += 86
  // per model and per project bars, side by side
  const half = (W - 2 * L - 16) / 2
  const models = Object.entries(g.byModel).sort((a, b) => b[1].cost - a[1].cost)
  const projects = Object.entries(g.byProject).filter(([, b]) => b.cost > 0).sort((a, b) => b[1].cost - a[1].cost).slice(0, 8)
  const h2 = 26 + Math.max(models.length, projects.length) * 24
  k.box(L, y, half, h2, c.border, { label: 'today per model' })
  const mm = Math.max(0.0001, ...models.map(([, b]) => b.cost))
  models.forEach(([m, b], i) => {
    const yy = y + 20 + i * 24
    k.text(L + 12, yy, clip(short(m), 12), { color: famColor(c, m) }); k.text(L + half - 12, yy, `${fmtUsd(b.cost)} · ${fmtTokens(b.tokens)}`, { anchor: 'end' })
    k.bar(L + 12, yy + 5, half - 24, b.cost / mm, famColor(c, m), { h: 5 })
  })
  const PX = L + half + 16
  k.box(PX, y, half, h2, c.border, { label: 'today per project' })
  const pm = Math.max(0.0001, ...projects.map(([, b]) => b.cost))
  projects.forEach(([p, b], i) => {
    const yy = y + 20 + i * 24
    k.text(PX + 12, yy, clip(p, 26), { tip: p }); k.text(PX + half - 12, yy, fmtUsd(b.cost), { anchor: 'end', bold: true })
    k.bar(PX + 12, yy + 5, half - 24, b.cost / pm, c.sonnet, { h: 5 })
  })
  y += h2 + 18
  if (opts.rows !== false) {
  // conversation rows, two lines each
    const rows = g.rows
    const rh = 38
    k.box(L, y, W - 2 * L, 24 + rows.length * rh, c.border, { label: `conversations · ${rows.length}` })
    rows.forEach((r, i) => {
      const yy = y + 22 + i * rh
      if (i % 2) k.out.push(`<rect x="${L + 2}" y="${yy - 13}" width="${W - 2 * L - 4}" height="${rh}" fill="${c.faint}" opacity="0.45"/>`)
      k.dot(L + 14, yy - 4, 4, r.live ? c.running : c.border)
      k.runs(L + 26, yy, [{ t: clip(r.title, 40).padEnd(41), b: r.live, tip: r.title }, { t: clip(`${r.repo} · ${r.branch.replace(/^claude\//, '')}`, 36), c: c.dim, tip: `${r.repo} · ${r.branch}` }])
      k.text(W - L - 12, yy, `${short(r.model)} · ${r.effort}`, { color: famColor(c, r.model), anchor: 'end' })
      const y2 = yy + 15
      k.text(L + 26, y2, 'ctx', { color: c.dim }); k.bar(L + 26 + 4 * CH, y2 - 7, 60, r.ctxPct / 100, c[r.ctxLevel]); k.text(L + 26 + 4 * CH + 66, y2, `${r.ctxPct}%`, { color: c[r.ctxLevel] })
      k.runs(L + 160, y2, [{ t: fmtUsd(r.costToday).padStart(7), b: true }, { t: '  ' }, { t: `◐${r.running}/${r.subs}`.padEnd(8), c: r.running ? c.running : c.dim }])
      const pr = r.pr ? `#${r.pr.number} ${r.pr.state}` : '-'
      k.runs(L + 270, y2, [{ t: clip(pr, 12).padEnd(13), c: c.dim }, r.pr ? { t: clip(r.pr.ci, 8).padEnd(9), c: r.pr.ci === 'failed' ? c.bad : r.pr.ci === 'success' ? c.ok : c.dim } : { t: ''.padEnd(9) },
        { t: r.waiting ? 'JULIAN ' : '', c: c.warn, b: true }, { t: clip(r.problem || '', r.waiting ? 34 : 41), c: c[r.problemLevel] || c.dim, tip: r.problem }])
    })
    y += 24 + rows.length * rh + 18
  }
  k.text(L, y, '$ = estimate from tokens × config rates. Click a conversation below to open its agent tree.', { color: c.dim })
  return k.done(y + 14)
}

export function treeAlt(m) {
  return `Agent tree of ${m.title}: main ${short(m.main.model)} ${m.main.effort}, context ${m.main.ctxPct}%, ${m.agents.length} subagents, ${m.workflows.length} workflows, cost ${fmtUsd(m.total)} estimate, ${m.warnings.length} warnings.`
}

export function dashAlt(g) {
  return `${g.rows.length} conversations, ${fmtUsd(g.totalCost)} today (estimate); ` + g.share.map((s) => `${s.family} ${Math.round(s.share * 100)}%`).join(', ')
}
