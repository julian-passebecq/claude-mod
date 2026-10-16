// metrics mod ("Les règles marchent ?"): pure logic, no I/O. The scanner (scanner/metrics_scan.mjs) reads files and
// runs git / gh / glab; this module turns transcript lines, git log lines, PR/MR and CI lists into hourly counters,
// rules-version windows and per-day / per-version metric values. Token figures reuse the usage mod's parser.
import { costOf, dayKey, familyOf, kindOfPath, projectOf, tokensOf, usageOf } from '../../usage/lib/transcripts.mjs'

export const HOUR = 3600000
export const DAY = 86400000

/** Counter names kept per hour (all transcripts) and what each counts. */
export const COUNTERS = {
  tok: 'tokens (input + output + cache read + cache writes)',
  cost: 'list-price cost equivalent, USD',
  turns: 'assistant turns (API responses)',
  opus: 'Opus turns', sonnet: 'Sonnet turns', haiku: 'Haiku turns', other: 'other-model turns',
  main: 'main-thread turns', main_big: 'main-thread turns at or above the context threshold (M2)',
  agent: 'Agent tool calls', agent_model: 'Agent tool calls that name a model (M1)',
  wf: 'agent() calls in Workflow scripts', wf_model: 'agent() calls that name a model (M1, approximate)',
  stop: 'manual stops (request interrupted)', perm: 'permission refusals (M10)', guard: 'app guard hits',
  blocked: 'BLOCKED / red-twice final messages', wake: 'wake-up tool calls (M6)', compact: 'compactions',
}
const NAMES = Object.keys(COUNTERS)
export const zeroC = () => Object.fromEntries(NAMES.map(n => [n, 0]))
export const addC = (a, b, sign = 1) => {
  for (const n of NAMES) a[n] = (a[n] || 0) + sign * (b[n] || 0)
  return a
}

/** Compiles the detection settings of the config once (regexes, tool names). */
export function detectors(d = {}) {
  const rx = (s, f = 'i') => {
    try {
      return new RegExp(s, f)
    } catch {
      return null
    }
  }
  return {
    stop: (d.stop || []).map(s => rx(s)).filter(Boolean),
    perm: (d.perm || []).map(s => rx(s)).filter(Boolean),
    guard: (d.guard || []).map(g => ({ label: g.label || g.pattern, re: rx(g.pattern) })).filter(g => g.re),
    blocked: (d.blocked || []).map(s => rx(s)).filter(Boolean),
    wake: new Set(d.wake_tools || []),
    agentTools: new Set(d.agent_tools || ['Agent', 'Task']),
    workflowTools: new Set(d.workflow_tools || ['Workflow']),
    bigContext: d.context_threshold ?? 250000,
  }
}

const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => (typeof b === 'string' ? b : b && b.text) || '').join(' ') : '')
const any = (res, s) => res.some(r => r.test(s))

/** agent() calls in a Workflow script and how many name a model (looks for `model:` before the next call; approximate). */
export function workflowAgents(script) {
  const s = String(script || '')
  const idx = []
  const re = /\bagent\s*\(/g
  for (let m = re.exec(s); m; m = re.exec(s)) idx.push(m.index)
  let named = 0
  idx.forEach((at, i) => {
    const chunk = s.slice(at, idx[i + 1] ?? at + 1500)
    if (/\bmodel\s*:/.test(chunk)) named++
  })
  return { calls: idx.length, named }
}

/** Fresh per-file state of the incremental scan. */
export const newFile = (kind = 'main') => ({ kind, offset: 0, cwd: '', session: '', hours: {}, keys: {}, recent: {} })

const RECENT = 200
const bumpH = (st, ts, f) => {
  const h = Math.floor(ts / HOUR) * HOUR
  f((st.hours[h] = st.hours[h] || zeroC()))
}

/**
 * Feeds one transcript line. `claim(key)` says whether a request is new across files; `det` is `detectors(cfg)`;
 * `prices` the usage price table. A request repeated in one file (one line per content block) replaces its tokens
 * and counts as one turn.
 */
export function feed(st, line, { det, prices, claim = () => true }) {
  if (!line || line.length < 20) return
  const wanted = line.includes('"usage"') || line.includes('"is_error":true') || line.includes('nterrupted') ||
    line.includes('compact_boundary') || line.includes('"tool_use"')
  if (!wanted) return
  let o
  try {
    o = JSON.parse(line)
  } catch {
    return
  }
  const ts = Date.parse(o.timestamp)
  if (!Number.isFinite(ts)) return
  if (o.cwd && !st.cwd) st.cwd = String(o.cwd)
  if (o.sessionId && !st.session) st.session = String(o.sessionId)
  if (o.type === 'system' && o.subtype === 'compact_boundary') return bumpH(st, ts, c => c.compact++)
  const content = o.message && o.message.content
  if (o.type === 'user') {
    const t = textOf(content)
    if (t && any(det.stop, t)) bumpH(st, ts, c => c.stop++)
    if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || b.type !== 'tool_result' || !b.is_error) continue
        const r = textOf(b.content)
        if (any(det.perm, r)) bumpH(st, ts, c => c.perm++)
        else if (det.guard.some(g => g.re.test(r))) bumpH(st, ts, c => c.guard++)
      }
    }
    return
  }
  if (o.type !== 'assistant') return
  if (Array.isArray(content)) {
    for (const b of content) {
      if (!b) continue
      if (b.type === 'tool_use') {
        if (det.agentTools.has(b.name)) bumpH(st, ts, c => { c.agent++; if (b.input && b.input.model) c.agent_model++ })
        else if (det.workflowTools.has(b.name)) {
          const w = workflowAgents(b.input && b.input.script)
          bumpH(st, ts, c => { c.wf += w.calls; c.wf_model += w.named })
        } else if (det.wake.has(b.name)) bumpH(st, ts, c => c.wake++)
      } else if (b.type === 'text' && b.text && any(det.blocked, b.text)) bumpH(st, ts, c => c.blocked++)
    }
  }
  const r = usageOf(o)
  if (!r) return
  const tok = tokensOf(r.v)
  const cost = costOf(r.v, r.model, prices)
  const prev = st.recent[r.key]
  if (prev) {
    // a later line of the same request: replace its tokens, keep it one turn
    bumpH(st, prev.ts, c => { c.tok += tok - prev.tok; c.cost += cost - prev.cost })
    st.recent[r.key] = { ts: prev.ts, tok, cost }
    return
  }
  if (st.keys[r.key] !== undefined || !claim(r.key)) return
  st.keys[r.key] = Math.floor(ts / HOUR) * HOUR
  st.recent[r.key] = { ts, tok, cost }
  const ks = Object.keys(st.recent)
  if (ks.length > RECENT) for (const k of ks.slice(0, ks.length - RECENT)) delete st.recent[k]
  const fam = familyOf(r.model)
  const inCtx = r.v[0] + r.v[2] + r.v[3] + r.v[4]
  bumpH(st, ts, c => {
    c.tok += tok
    c.cost += cost
    c.turns++
    c[['opus', 'sonnet', 'haiku'].includes(fam) ? fam : 'other']++
    if (st.kind === 'main') {
      c.main++
      if (inCtx >= det.bigContext) c.main_big++
    }
  })
}

/** Drops hours and keys older than `fromMs`. */
export function pruneFile(st, fromMs) {
  for (const h of Object.keys(st.hours)) if (Number(h) < fromMs) delete st.hours[h]
  for (const [k, h] of Object.entries(st.keys)) if (h < fromMs) delete st.keys[k]
}

export { kindOfPath, projectOf }

/**
 * Hourly totals over all files: `all` (every transcript) and `tracked` (tokens and cost of sessions whose project
 * folder belongs to a tracked repo; `repoOf(projectName)` returns the repo key or undefined).
 */
export function hourly(files, repoOf = () => undefined) {
  const out = {}
  for (const st of Object.values(files)) {
    const repo = repoOf(projectOf(st.cwd))
    for (const [h, c] of Object.entries(st.hours)) {
      const slot = (out[h] = out[h] || { all: zeroC(), tok: 0, cost: 0 })
      addC(slot.all, c)
      if (repo) {
        slot.tok += c.tok
        slot.cost += c.cost
      }
    }
  }
  return out
}

// ---------- repos ----------

/** Forge and repo key from a remote URL: { forge: 'github'|'gitlab', slug: 'owner/name', host, name } or null. */
export function parseRemote(url) {
  const s = String(url || '').trim().replace(/\.git$/, '')
  const m = s.match(/^(?:https?:\/\/(?:[^@/]*@)?|ssh:\/\/git@|git@)([^/:]+)[/:](.+)$/)
  if (!m) return null
  const host = m[1].toLowerCase()
  const forge = host.includes('github') ? 'github' : host.includes('gitlab') ? 'gitlab' : null
  if (!forge) return null
  const slug = m[2].replace(/^\/+|\/+$/g, '')
  return { forge, host, slug, name: slug.split('/').pop().toLowerCase() }
}

// ---------- rules versions ----------

/**
 * Rules versions from `git log --format=%H|%aI|%s -- <rules file>` lines. Each version starts at its first commit
 * whose subject carries it (`V5.8`, `V6`). grain `major` groups V5.x into V5. Sorted by start.
 */
export function versions(logText, { regex = '\\bV(\\d+(?:\\.\\d+)?)\\b', grain = 'minor' } = {}) {
  const re = new RegExp(regex)
  const first = {}
  for (const line of String(logText || '').split('\n')) {
    const [sha, iso, ...rest] = line.split('|')
    const subject = rest.join('|')
    const m = subject && subject.match(re)
    const at = Date.parse(iso)
    if (!m || !Number.isFinite(at)) continue
    const v = grain === 'major' ? m[1].split('.')[0] : m[1]
    if (!first[v] || at < first[v].start) first[v] = { version: `V${v}`, start: at, sha: (sha || '').slice(0, 7), subject: subject.slice(0, 160) }
  }
  return Object.values(first).sort((a, b) => a.start - b.start)
}

// ---------- forges ----------

/** Merged PRs from `gh search prs --json repository,number,closedAt,createdAt` (closedAt of a merged PR is its merge). */
export const githubPrs = list => (list || []).map(p => ({
  forge: 'github', repo: String(p.repository && (p.repository.nameWithOwner || p.repository.name) || '').toLowerCase(),
  number: p.number, merged: Date.parse(p.mergedAt || p.closedAt), created: Date.parse(p.createdAt),
})).filter(p => p.repo && Number.isFinite(p.merged))

/** Merged MRs from `glab mr list -M -F json`. */
export const gitlabMrs = (list, slug) => (list || []).filter(m => m.state === 'merged' || m.merged_at).map(m => ({
  forge: 'gitlab', repo: String(slug || (m.references && m.references.full) || m.project_id).toLowerCase().replace(/!\d+$/, ''),
  number: m.iid, merged: Date.parse(m.merged_at || m.updated_at), created: Date.parse(m.created_at),
})).filter(p => Number.isFinite(p.merged))

/** CI runs as intervals: gh run list (startedAt/updatedAt) or glab ci list (created_at/updated_at). Running ones end now. */
export function ciRuns(list, repo, now) {
  return (list || []).map(r => {
    const start = Date.parse(r.startedAt || r.started_at || r.created_at || r.createdAt)
    const running = ['in_progress', 'queued', 'running', 'pending', 'waiting', 'requested', 'preparing'].includes(String(r.status).toLowerCase())
    const end = running ? now : Date.parse(r.updatedAt || r.updated_at || r.finished_at)
    return { repo, start, end: Number.isFinite(end) && end >= start ? end : start }
  }).filter(r => Number.isFinite(r.start))
}

/** Keys PRs on forge + repo + number so repeated fetches merge. */
export function mergePrs(old, add) {
  const map = new Map()
  for (const p of [...(old || []), ...(add || [])]) map.set(`${p.forge}|${p.repo}|${p.number}`, p)
  return [...map.values()].sort((a, b) => a.merged - b.merged)
}

/**
 * « Creux » per local day: inside the day's CI span (first run start to last run end, all tracked repos), the gaps of
 * at least `minGapMin` minutes with no run going, in hours. An approximation of « travail démarrable mais aucune CI »
 * (non vérifié: the transcripts do not say what work was startable).
 */
export function stalls(runs, { tzMin = 0, minGapMin = 60 } = {}) {
  const byDay = {}
  for (const r of runs || []) (byDay[dayKey(r.start, tzMin)] = byDay[dayKey(r.start, tzMin)] || []).push(r)
  const out = {}
  for (const [day, rs] of Object.entries(byDay)) {
    rs.sort((a, b) => a.start - b.start)
    let end = rs[0].end
    let gap = 0
    for (const r of rs.slice(1)) {
      const g = r.start - end
      if (g >= minGapMin * 60000) gap += g
      end = Math.max(end, r.end)
    }
    out[day] = gap / HOUR
  }
  return out
}

// ---------- rollups ----------

/** Sums hourly slots in [from, to). */
export function sumHours(hours, from, to) {
  const c = zeroC()
  let tok = 0
  let cost = 0
  for (const [h, s] of Object.entries(hours || {})) {
    const t = Number(h)
    if (t < from || t >= to) continue
    addC(c, s.all)
    tok += s.tok
    cost += s.cost
  }
  return { c, tok, cost }
}

const ratio = (a, b) => (b > 0 ? (100 * a) / b : null)
const per = (a, b) => (b > 0 ? a / b : null)

/**
 * Every metric's value over the window [from, to): rates are per day, shares in %, null when nothing was measured.
 * `stallByDay` comes from `stalls`; days count when their local midnight falls inside the window.
 */
export function values({ hours, prs, stallByDay, from, to, tzMin = 0, span }) {
  const days = span ?? Math.max((to - from) / DAY, 1 / 24)
  const { c, tok, cost } = sumHours(hours, from, to)
  const merged = (prs || []).filter(p => p.merged >= from && p.merged < to).length
  let stallH = 0
  let stallDays = 0
  for (const [d, h] of Object.entries(stallByDay || {})) {
    const t = Date.parse(`${d}T12:00:00Z`) - tzMin * 60000
    if (t >= from && t < to) {
      stallH += h
      stallDays++
    }
  }
  const named = c.agent + c.wf
  return {
    prs: merged / days,
    tok_per_pr: per(tok, merged),
    usd_per_pr: per(cost, merged),
    opus_share: ratio(c.opus, c.turns),
    sonnet_share: ratio(c.sonnet, c.turns),
    haiku_share: ratio(c.haiku, c.turns),
    m1_named: ratio(c.agent_model + c.wf_model, named),
    m2_big: ratio(c.main_big, c.main),
    stops: c.turns ? c.stop / days : null,
    perm: c.turns ? c.perm / days : null,
    guard: c.turns ? c.guard / days : null,
    stall_h: stallDays ? stallH / stallDays : null,
    blocked: c.turns ? c.blocked / days : null,
    wake: c.turns ? c.wake / days : null,
    compact: c.turns ? c.compact / days : null,
    _n: { turns: c.turns, prs: merged, agent: named, days },
  }
}

/** Local midnight (as UTC ms) of the day holding `ms`. */
export const dayStart = (ms, tzMin = 0) => Math.floor((ms + tzMin * 60000) / DAY) * DAY - tzMin * 60000

/**
 * The model the pane draws: `days` (keys), per-metric daily series, version markers (day index) and per-version
 * windows with their values. Versions that started before the window keep only the part inside it.
 */
export function build({ hours, prs, runs, vers, now, tzMin = 0, historyDays = 30, minGapMin = 60 }) {
  const end = dayStart(now, tzMin) + DAY
  const start = end - historyDays * DAY
  const stallByDay = stalls((runs || []).filter(r => r.start >= start), { tzMin, minGapMin })
  const days = []
  const series = {}
  for (let t = start; t < end; t += DAY) {
    days.push(dayKey(t + 1, tzMin))
    const v = values({ hours, prs, stallByDay, from: t, to: t + DAY, tzMin, span: 1 })
    for (const [k, x] of Object.entries(v)) if (k !== '_n') (series[k] = series[k] || []).push(x)
  }
  const inWin = (vers || []).filter(v => v.start < end)
  const windows = inWin.map((v, i) => {
    const from = Math.max(v.start, start)
    const to = Math.min(i + 1 < inWin.length ? inWin[i + 1].start : now, now)
    return { ...v, from, to, hours: Math.max(0, (to - from) / HOUR), values: to > from ? values({ hours, prs, stallByDay, from, to, tzMin }) : null }
  }).filter(w => w.to > start)
  const markers = windows.filter(w => w.start >= start).map(w => ({ version: w.version, day: Math.floor((dayStart(w.start, tzMin) - start) / DAY), start: w.start }))
  return { generated: now, tzMin, from: start, days, series, versions: windows, markers, prs: (prs || []).filter(p => p.merged >= start).length }
}
