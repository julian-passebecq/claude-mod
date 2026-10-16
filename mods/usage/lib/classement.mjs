// Classement ("qui consomme"): which conversation, project, model, agent type or feature burned the most tokens in a
// time window, ranked, with the trend vs the previous window of the same length. Pure, no I/O.
// The scanner (scanner/usage_scan.mjs) builds `classement.json` from the same incremental cache as aggregate.json
// (byte offsets per transcript), so the totals here and in the other tabs come from the same rows.
// Shared: mods/cockpit keeps a byte-for-byte copy (mods/cockpit/scripts/sync-libs.mjs) for its « Qui consomme » card.
import { V, addInto, familyOf, isSubConversation, projectOf, tokensOf, zero, dayKey } from './transcripts.mjs'

const HOUR = 3600000
const r6 = n => Math.round(n * 1e6) / 1e6

/**
 * Compact rows from the scanner's file states: one row per (hour, conversation, kind, model, agent, skill, mcp).
 * A subagent's or Workflow agent's transcript carries its parent's sessionId, so its tokens land on the parent
 * conversation (kind tells them apart for the split column). A sub-conversation is its own conversation.
 * Returns { v, generated, tzMin, days, sessions: { sid: { t: title, p: project } }, rows: [[hour, sid, kind, model, agent, skill, mcp, ...vector]] }.
 */
export function buildClassement(files, { now, tzMin = 0, days = 31, subRule = 'peer' } = {}) {
  const from = now - days * 86400000
  const acc = new Map()
  const sessions = {}
  for (const st of Object.values(files || {})) {
    if (st.kind === 'journal') continue
    const kind = isSubConversation(st, subRule) ? 'subconversation' : st.kind
    const sid = st.session || '?'
    const s = (sessions[sid] = sessions[sid] || { t: '', p: '' })
    if (kind === 'main' || kind === 'subconversation') {
      if (st.title) s.t = st.title
      s.p = projectOf(st.cwd)
    } else if (!s.p) s.p = projectOf(st.cwd)
    for (const [rk, v] of Object.entries(st.rows || {})) {
      const [h, model, , skill, mcp, agent] = rk.split('|')
      const hour = Number(h)
      if (hour < from) continue
      const key = [hour, sid, kind, model, agent || st.agent || '', skill || '', mcp || ''].join('\u0001')
      acc.set(key, addInto(acc.get(key) || zero(), v))
    }
  }
  const rows = []
  for (const [k, v] of acc) {
    const d = k.split('\u0001')
    rows.push([Number(d[0]), ...d.slice(1), ...v.slice(0, 7), r6(v[V.cost])])
  }
  return { v: 1, generated: now, tzMin, days, sessions, rows }
}

const DIM = 7 // index where the usage vector starts in a row
const vecOf = r => r.slice(DIM, DIM + 8)

/** Feature of a row: skill, MCP server, Workflow agent, Agent subagent, sub-conversation or the main thread. */
export function featureOf(kind, skill, mcp, labels = {}) {
  const f = labels.features || {}
  if (skill) return `${f.skill ?? 'skill'} ${skill}`
  if (mcp) return `${f.mcp ?? 'MCP'} ${mcp}`
  return f[kind] ?? kind
}

/** The group key and label of one row. */
export function groupOf(group, r, data, labels = {}) {
  const [, sid, kind, model, agent, skill, mcp] = r
  const s = (data.sessions || {})[sid] || {}
  switch (group) {
    case 'project':
      return { key: s.p || '?', label: s.p || '?' }
    case 'model': {
      const f = familyOf(model)
      return { key: f, label: (labels.families || {})[f] ?? f }
    }
    case 'agent': {
      const k = (labels.kinds || {})[kind] ?? kind
      const name = kind === 'main' ? '' : agent
      return { key: `${kind}|${name}`, label: name ? `${k} · ${name}` : k }
    }
    case 'feature': {
      const l = featureOf(kind, skill, mcp, labels)
      return { key: l, label: l }
    }
    case 'source':
      return { key: 'claude', label: (labels.sources || {}).claude ?? 'Claude' }
    default:
      return { key: sid, label: s.t || String(sid).slice(0, 8), project: s.p || '?', id: sid }
  }
}

const floorHour = ms => Math.floor(ms / HOUR) * HOUR

/**
 * A preset ({ hours } or { since: 'midnight' }) as hour buckets: { from, to, prevFrom, today }. Rows are per clock
 * hour, so « 1 h » is every hour bucket that overlaps the last hour (between 1 and 2 hours of data). « aujourd'hui »
 * is the buckets of the local day, the same ones the other tabs sum. The previous window has as many hours, just before.
 */
export function windowOf(preset, now, tzMin = 0) {
  const to = floorHour(now) + HOUR
  if (preset && preset.since === 'midnight') {
    const mid = Math.floor((now + tzMin * 60000) / 86400000) * 86400000 - tzMin * 60000
    const from = floorHour(mid) === mid ? mid : floorHour(mid) + HOUR
    return { from, to, prevFrom: from - (to - from), today: dayKey(now, tzMin) }
  }
  const from = floorHour(now - (Number(preset && preset.hours) || 1) * HOUR)
  return { from, to, prevFrom: from - (to - from) }
}

/** Units of a vector for the ranking: list-price cost or all tokens. */
export const unitsOfVec = (v, basis) => (basis === 'tokens' ? tokensOf(v) : v[V.cost])

/**
 * The ranking for one window and one grouping:
 * { total, prevTotal, trend, rows: [{ key, label, id?, project?, v, sub, units, share, trend, isNew }], others, n, window, partialPrev }.
 * `sub` is the part of the tokens spent by subagents and Workflow agents (the split column). `trend` is
 * (now - before) / before on the basis; undefined when the previous window starts before the kept data.
 */
export function rank(data, { now, preset, group = 'conversation', top = 20, basis = 'cost', labels = {} } = {}) {
  const tz = data.tzMin || 0
  const w = windowOf(preset, now, tz)
  const kept = (data.generated || now) - (data.days || 31) * 86400000
  const partialPrev = w.prevFrom < kept
  const inWin = h => (w.today ? h >= w.from && dayKey(h, tz) === w.today : h >= w.from && h < w.to)
  const groups = new Map()
  const total = zero()
  const prevTotal = zero()
  for (const r of data.rows || []) {
    const h = r[0]
    const cur = inWin(h)
    const prev = !cur && h >= w.prevFrom && h < w.from
    if (!cur && !prev) continue
    const v = vecOf(r)
    const g = groupOf(group, r, data, labels)
    const e = groups.get(g.key) || { ...g, v: zero(), prev: zero(), sub: 0 }
    if (cur) {
      addInto(e.v, v)
      addInto(total, v)
      if (r[2] === 'subagent' || r[2] === 'workflow') e.sub += tokensOf(v)
    } else {
      addInto(e.prev, v)
      addInto(prevTotal, v)
    }
    groups.set(g.key, e)
  }
  const T = unitsOfVec(total, basis)
  const trendOf = (a, b) => (partialPrev ? undefined : b > 0 ? (a - b) / b : undefined)
  const all = [...groups.values()]
    .filter(e => tokensOf(e.v) > 0)
    .map(e => {
      const u = unitsOfVec(e.v, basis)
      const p = unitsOfVec(e.prev, basis)
      return { ...e, units: u, share: T > 0 ? u / T : 0, trend: trendOf(u, p), isNew: !partialPrev && p === 0 && u > 0 }
    })
    .sort((a, b) => b.units - a.units || tokensOf(b.v) - tokensOf(a.v))
  const rows = all.slice(0, top)
  const rest = all.slice(top)
  let others
  if (rest.length) {
    const v = zero()
    const prev = zero()
    let sub = 0
    for (const e of rest) {
      addInto(v, e.v)
      addInto(prev, e.prev)
      sub += e.sub
    }
    const u = unitsOfVec(v, basis)
    others = { key: '__others', label: labels.others ?? 'autres', count: rest.length, v, prev, sub, units: u, share: T > 0 ? u / T : 0, trend: trendOf(u, unitsOfVec(prev, basis)) }
  }
  return { total, prevTotal, trend: trendOf(T, unitsOfVec(prevTotal, basis)), rows, others, n: all.length, window: w, partialPrev }
}

/**
 * Codex tokens of the days the window touches, from the usage mod's codex.json ({ days: { YYYY-MM-DD: { model: [input,
 * cached, output, reasoning, total] } } }). Whole days only (Codex is kept per day), so it is an upper bound for 1 h / 4 h.
 */
export function codexTokens(codex, win, tzMin = 0) {
  if (!codex || !codex.days) return undefined
  const keys = new Set()
  for (let t = win.from; t < win.to; t += HOUR) keys.add(dayKey(t, tzMin))
  let n = 0
  let any = false
  for (const k of keys) for (const v of Object.values(codex.days[k] || {})) { n += Number(v[4]) || 0; any = true }
  return any ? n : 0
}

/** Text bar of `share` (0..1) relative to the biggest row, `width` characters. */
export function bar(share, maxShare, width = 12) {
  const n = maxShare > 0 ? Math.round((share / maxShare) * width) : 0
  return '█'.repeat(Math.max(0, Math.min(width, n))).padEnd(width, '·')
}

/** "+40 %", "-12 %", "nouveau" or "" (no previous data). */
export function trendText(row, labels = {}) {
  if (row.isNew) return labels.new ?? 'nouveau'
  if (row.trend === undefined || !Number.isFinite(row.trend)) return ''
  const p = Math.round(row.trend * 100)
  return `${p > 0 ? '↑ +' : p < 0 ? '↓ ' : '= '}${p} %`
}

/** Conversation id -> { sid, link } from veille's fil.json (projects[].convs[] with children), for « Ouvrir ». */
export function linksFromFil(fil) {
  const out = {}
  const walk = cs => {
    for (const c of cs || []) {
      if (c && c.cli && c.link) out[c.cli] = { sid: c.sid, link: c.link }
      walk(c && c.children)
    }
  }
  for (const p of (fil && fil.projects) || []) walk(p.convs)
  return out
}

/** Only a desktop-app conversation link is handed to the OS (same rule as veille's Fil). */
export const isAppLink = url => /^claude:\/\/claude\.ai\/epitaxy\/[\w-]+$/.test(String(url || ''))
