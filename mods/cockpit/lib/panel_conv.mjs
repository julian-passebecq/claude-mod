// cockpit Panneau, section 2 « Cette conversation » as a FACTORY view (the style of the Reference Gallery's Usine):
//   ╭─ Lead ──────────────────────────╮     the lead: its title, model · effort (▮▮▯▯), state
//   ╰┬────────────────────────────────╯
//    ├─ [▾ Workflow package-wave …]          one layer per Workflow, one for the background agents; each folds
//    │   ╭─ ● coder · build ─────────╮       one card per agent: label, model, effort, state, tokens, tok/s
//    ▼
//   ╭─ retour au lead · review + merge ╮
//   then the session log: the last log_max events (agent started / finished, PR opened / merged), timestamped.
// Pure: no $, no I/O (node --test mods/cockpit/tests/panel.test.mjs). Input: factory's scan (lib/factory/scanner).
import { panelConfig, fill, kTok } from './panel.mjs'
import { titleOf, short, tokensOf, hhmm } from './factory/hooks/logic.mjs'
import { sessionState, effortBars } from './factory/hooks/screens.mjs'

const msOf = (v) => (!v ? 0 : typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(v) || 0)
const len = (s) => [...String(s)].length
const clip = (t, n) => {
  const a = [...String(t ?? '').replace(/\s+/g, ' ').trim()]
  return a.length > n ? a.slice(0, Math.max(1, n - 1)).join('') + '…' : a.join('')
}
const pad = (t, n) => t + ' '.repeat(Math.max(0, n - len(t)))

function findSession(scan, cli) {
  return ((scan && scan.sessions) || []).find((s) => s.cli === cli || s.id === cli) || null
}

// The detail of this conversation when the scan has it (subs with their events, calls, events), else its slim row.
function detailOf(scan, cli) {
  const d = scan && scan.detail
  return d && d.cli === cli ? d : findSession(scan, cli)
}

const LEAD_STATES = { working: 'en cours', julian: 't’attend', blocked: 'bloquée', done: 'terminée', idle: 'au repos', archived: 'archivée' }

function agentCard(x, nowMs, L) {
  const tokens = Object.values(x.models || {}).reduce((a, v) => a + tokensOf(v || []), 0)
  const from = msOf(x.ts)
  const to = x.status === 'running' ? nowMs : msOf(x.last_ts) || nowMs
  const secs = from ? Math.max(1, (to - from) / 1000) : 0
  const status = ['running', 'done', 'failed'].includes(x.status) ? x.status : 'stopped'
  return {
    id: x.id, label: `${x.type || 'agent'}${x.desc ? ' · ' + x.desc : ''}`, model: short(x.model || x.explicit_model), effort: x.effort || '?',
    bars: effortBars(x.effort), status, stateLabel: L.agent_states[status] || status, tokens, tps: secs ? tokens / secs : null,
    ts: from, end: status === 'running' ? 0 : msOf(x.last_ts),
  }
}

/**
 * The factory view's model. scan: factory's scan (detail = this conversation when possible); self: its cli; fcfg:
 * factory's config (session state); closed: { layerKey: true } folded by the viewer. -> { available, lead, layers, log }.
 * lead: { title, model, effort, bars, state }. layers: [{ key, kind: workflow|background, title, count, running, tokens,
 * open, agents: [card], hidden }]. log: [{ at, text, tone }] oldest first, the last log_max.
 */
export function convFactory(scan, self, fcfg, cfg, nowMs, closed = {}) {
  const c = panelConfig(cfg)
  const L = c.labels
  const me = findSession(scan, self)
  if (!me) return { available: false, lead: null, layers: [], log: [] }
  const d = detailOf(scan, self) || me
  const st = sessionState(me, fcfg || {}).state
  const lead = {
    title: titleOf(me), model: short(me.app_model || me.model), effort: me.app_effort || me.effort || '?',
    bars: effortBars(me.app_effort || me.effort), state: LEAD_STATES[st] || st, live: st === 'working',
  }
  const subs = d.subs || me.subs || []
  const order = (a, b) => ((b.status === 'running') - (a.status === 'running')) || (b.ts - a.ts)
  const names = new Map(((d.calls || []).filter((x) => x.tool === 'Workflow' && x.runId)).map((x) => [x.runId, x.desc || x.runId]))
  const layer = (key, kind, title, list) => {
    const cards = list.map((x) => agentCard(x, nowMs, L)).sort(order)
    const max = Math.max(1, Number(c.conv.agents_max) || 12)
    return {
      key, kind, title, count: cards.length, running: cards.filter((x) => x.status === 'running').length,
      tokens: cards.reduce((a, x) => a + x.tokens, 0), open: !closed[key], agents: cards.slice(0, max), hidden: Math.max(0, cards.length - max),
    }
  }
  const layers = []
  const wfIds = [...new Set(subs.filter((x) => x.workflow).map((x) => x.workflow))]
  for (const id of wfIds) layers.push(layer('pfw-' + id, 'workflow', fill(L.workflow, { name: names.get(id) || id }), subs.filter((x) => x.workflow === id)))
  const plain = subs.filter((x) => !x.workflow)
  if (plain.length) layers.push(layer('pfw-bg', 'background', L.background, plain))
  layers.sort((a, b) => (b.running > 0) - (a.running > 0))
  // the session log: agents started / finished (their own times), PR opened (the scan's « pr » event), PR merged
  // (a gh pr merge / glab mr merge the conversation ran)
  const log = []
  for (const x of subs) {
    const name = clip(`${x.type || 'agent'}${x.desc ? ' · ' + x.desc : ''}`, 40)
    if (msOf(x.ts)) log.push({ at: msOf(x.ts), text: fill(L.ev_start, { agent: name }), tone: 'running' })
    if ((x.status === 'done' || x.status === 'failed') && msOf(x.last_ts)) log.push({ at: msOf(x.last_ts), text: fill(x.status === 'done' ? L.ev_done : L.ev_failed, { agent: name }), tone: x.status === 'done' ? 'ok' : 'bad' })
  }
  const evs = (d.events && d.events.length ? d.events : me.recent) || []
  for (const e of evs) {
    if (!Array.isArray(e)) continue
    const at = msOf(e[0])
    const text = String(e[2] || '')
    if (e[1] === 'pr') { const n = /#(\d+)/.exec(text); if (n) log.push({ at, text: fill(L.ev_pr_open, { n: n[1] }), tone: null }) }
    else if (e[1] === 'tool') { const n = /\b(?:gh\s+pr\s+merge|glab\s+mr\s+merge)\s+#?(\d+)/.exec(text); if (n) log.push({ at, text: fill(L.ev_pr_merged, { n: n[1] }), tone: 'ok' }) }
  }
  log.sort((a, b) => a.at - b.at)
  return { available: true, lead, layers, log: log.slice(-Math.max(1, Number(c.conv.log_max) || 6)) }
}

// ---- text: the boxes and connectors, every line at most `width` columns ------------------------------------------------

function box(title, lines, w, bottom = '') {
  const inner = w - 2
  const t = title ? `─ ${clip(title, inner - 3)} ` : ''
  const top = '╭' + t + '─'.repeat(Math.max(0, inner - len(t))) + '╮'
  const body = lines.map((x) => '│ ' + pad(clip(x, inner - 2), inner - 2) + ' │')
  const end = bottom ? '╰' + bottom + '─'.repeat(Math.max(0, inner - len(bottom))) + '╯' : '╰' + '─'.repeat(inner) + '╯'
  return [top, ...body, end]
}

const tpsText = (n) => (n === null || n === undefined ? '' : ` · ${n >= 100 ? Math.round(n) : n.toFixed(1)} tok/s`)

/**
 * The factory view as lines: [{ key, text, tone?, bold?, dim?, fold? }]. fold: a layer header the viewer folds (drawn as
 * a button after its connector `text`). width: the columns the section may use.
 */
export function factoryLines(m, width, cfg) {
  const c = panelConfig(cfg)
  const L = c.labels
  const W = Math.max(28, Math.min(Number(width) || 60, 400))
  const out = []
  if (!m || !m.available) return out
  const B = Math.min(W, Math.max(28, Number(c.conv.box_max) || 60))
  const lead = m.lead
  box(L.lead, [lead.title, `${lead.model} · ${lead.bars} ${lead.effort} · ${lead.state}`], B, '┬').forEach((t, i) =>
    out.push({ key: 'pfl-' + i, text: t, bold: i === 1, tone: lead.live ? 'running' : undefined }))
  out.push({ key: 'pfs-0', text: ' │', dim: true })
  if (!m.layers.length) out.push({ key: 'pf-nolayer', text: ` │ ${clip(L.no_layer, W - 4)}`, dim: true })
  else out.push({ key: 'pf-layer', text: ` ├─ ${clip(L.layer, W - 5)}`, bold: true })
  const CB = Math.max(24, Math.min(B - 4, W - 5))
  m.layers.forEach((ly, li) => {
    const last = li === m.layers.length - 1
    const meta = fill(L.layer_meta, { running: ly.running, count: ly.count, tokens: kTok(ly.tokens) })
    out.push({ key: 'pfh-' + ly.key, text: ' ├─', fold: ly.key, label: clip(`${ly.open ? '▾' : '▸'} ${ly.kind === 'workflow' ? '◇' : '●'} ${ly.title} · ${meta}`, W - 8), tone: ly.running ? 'running' : undefined })
    if (!ly.open) return
    for (const a of ly.agents) {
      const mark = a.status === 'running' ? '●' : a.status === 'failed' ? '✗' : a.status === 'done' ? '✓' : '○'
      const tone = a.status === 'running' ? 'running' : a.status === 'failed' ? 'bad' : undefined
      box(`${mark} ${a.label}`, [`${a.model} · ${a.bars} ${a.effort}`, `${a.stateLabel} · ${kTok(a.tokens)} tok${tpsText(a.tps)}`], CB).forEach((t, i) =>
        out.push({ key: `pfa-${ly.key}-${a.id}-${i}`, text: ` │   ${t}`, tone, dim: a.status === 'done' || a.status === 'stopped' }))
    }
    if (ly.hidden) out.push({ key: `pfx-${ly.key}`, text: ` │   + ${ly.hidden}`, dim: true })
    if (!last) out.push({ key: `pfs-${ly.key}`, text: ' │', dim: true })
  })
  out.push({ key: 'pfs-end', text: ' ▼', dim: true })
  box('', [L.lead_back], Math.min(B, len(L.lead_back) + 4 <= W ? len(L.lead_back) + 4 : W)).forEach((t, i) => out.push({ key: 'pfb-' + i, text: t, bold: i === 1 }))
  // the session log
  out.push({ key: 'pfj', text: L.log, bold: true })
  if (!m.log.length) out.push({ key: 'pfj-none', text: L.log_none, dim: true })
  m.log.forEach((e, i) => out.push({ key: 'pfj-' + i, text: clip(`${hhmm(e.at).slice(0, 5)}  ${e.text}`, W), tone: e.tone || undefined, dim: !e.tone }))
  return out
}

export function convFactorySummary(m) {
  if (!m || !m.available) return ''
  const agents = m.layers.reduce((a, l) => a + l.count, 0)
  const running = m.layers.reduce((a, l) => a + l.running, 0)
  return [`${m.lead.model} · ${m.lead.effort}`, m.lead.state, agents ? `agents ${running}/${agents}` : ''].filter(Boolean).join(' · ')
}
