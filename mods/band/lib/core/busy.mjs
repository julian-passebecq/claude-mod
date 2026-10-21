// Canonical copy: lib/core/busy.mjs (repo root). Every mods/<mod>/lib/core/busy.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// « Is anything running? » counted one way for every view (Julian, 21 Oct: « how do I know no work is in process? »):
//   conv qui travaille   a conversation whose MAIN thread has a turn in progress: its last user/assistant entry is not
//                        a final assistant message and it wrote within busy_s (120 s), or the engine's busy flag
//   workflows / agents   Workflow runs and agents (Workflow agents, Agent-tool agents foreground or background) that
//                        wrote within running_s
//   CI                   running or queued pipelines of the ci mod's cache (~/.claude/ci-pipelines-cache.json, GitHub
//                        Actions + GitLab); a cache older than ci_stale_min (15) is « non lu », never a 0
// Pure apart from readCi (one small file read). Zeros are a fact worth showing: the views draw them grey.
import fs from 'node:fs'
import os from 'node:os'

export const BUSY_DEFAULTS = { busy_s: 120, running_s: 120, ci_stale_min: 15, ci_cache: '~/.claude/ci-pipelines-cache.json' }

const FINAL_STOPS = new Set(['end_turn', 'stop_sequence', 'max_tokens', 'refusal'])
const tms = (ts) => {
  const t = typeof ts === 'number' ? ts : Date.parse(ts || '')
  return Number.isFinite(t) && t > 0 ? t : 0
}
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('') : '')

/**
 * One MAIN-thread transcript entry folded into the turn state {last, open} (pure). open: the last user/assistant entry
 * starts or continues a turn (a prompt, a tool result, a tool call, a partial answer); closed: a final assistant
 * message (stop_reason end_turn…), an API error, or « [Request interrupted by user] ». Sidechain entries are ignored.
 */
export function feedTurn(t, d) {
  const s = t || { last: 0, open: false }
  if (!d || typeof d !== 'object' || d.isSidechain) return s
  const at = tms(d.timestamp)
  if (d.type === 'assistant' && d.message) {
    const stop = d.message.stop_reason || ''
    s.open = !(FINAL_STOPS.has(stop) || d.isApiErrorMessage || d.error)
  } else if (d.type === 'user' && d.message) {
    s.open = !/^\[Request interrupted by user/.test(textOf(d.message.content).trim())
  } else return s
  if (at) s.last = Math.max(s.last || 0, at)
  return s
}

/** The main thread is working: a turn is open and it wrote within busyS seconds. */
export const turnBusy = (t, now, busyS = BUSY_DEFAULTS.busy_s) => Boolean(t && t.open && t.last && now - t.last >= -60000 && now - t.last <= busyS * 1000)

/**
 * The PC's counts from session facts and usage events (pure).
 *   sessions: {id: {turn?, title?, last?}}   events: [{t, s, a?, w?}] (one per API response, agents carry a, Workflow agents w)
 * Returns {convs, busy: [ids], workflows, agents, wfAgents, subAgents, lastDone: {s, title, t} | null}.
 */
export function busyCounts({ sessions = {}, events = [], now = Date.now(), busyS = BUSY_DEFAULTS.busy_s, runningS = BUSY_DEFAULTS.running_s } = {}) {
  const busy = []
  let lastDone = null
  for (const [id, m] of Object.entries(sessions)) {
    const t = m && m.turn
    if (turnBusy(t, now, busyS)) busy.push(id)
    else if (t && t.last && t.last <= now && (!lastDone || t.last > lastDone.t)) lastDone = { s: id, title: (m && m.title) || '', t: t.last }
  }
  const wfs = new Set()
  const wfAg = new Set()
  const sub = new Set()
  for (const e of events) {
    if (!e || !e.a || e.t > now || now - e.t > runningS * 1000) continue
    if (e.w) {
      wfs.add(`${e.s}/${e.w}`)
      wfAg.add(`${e.s}/${e.a}`)
    } else sub.add(`${e.s}/${e.a}`)
  }
  return { convs: busy.length, busy: busy.sort(), workflows: wfs.size, agents: wfAg.size + sub.size, wfAgents: wfAg.size, subAgents: sub.size, lastDone }
}

/**
 * CI from the ci mod's cache JSON (pure): {available, running, queued, failed, age_ms, stale}. running counts running
 * and queued pipelines; failed the runs that failed and ended (created + duration_s) within staleMin. stale: the cache
 * is older than staleMin minutes (or has no `generated`), so its counts are not a fact any more.
 */
export function ciActivity(cache, now = Date.now(), staleMin = BUSY_DEFAULTS.ci_stale_min) {
  if (!cache || typeof cache !== 'object' || !Array.isArray(cache.apps)) return { available: false, running: 0, queued: 0, failed: 0, age_ms: null, stale: true }
  const gen = tms(cache.generated)
  const age = gen ? Math.max(0, now - gen) : null
  let running = 0
  let queued = 0
  let failed = 0
  for (const a of cache.apps) {
    for (const r of (a && a.runs) || []) {
      if (!r) continue
      if (r.status === 'running') running++
      else if (r.status === 'queued') queued++
      else if (r.status === 'failed') {
        const c = tms(r.created)
        const end = r.finished ? tms(r.finished) : c && Number.isFinite(r.duration_s) ? c + r.duration_s * 1000 : c
        if (end && now - end <= staleMin * 60000) failed++
      }
    }
  }
  return { available: true, running: running + queued, queued, failed, age_ms: age, stale: age === null || age > staleMin * 60000 }
}

/** Reads the ci cache file (path with ~) -> ciActivity; unavailable when missing or unreadable. */
export function readCi(file = BUSY_DEFAULTS.ci_cache, now = Date.now(), staleMin = BUSY_DEFAULTS.ci_stale_min) {
  try {
    const p = String(file).replace(/^~(?=$|[\\/])/, os.homedir())
    return ciActivity(JSON.parse(fs.readFileSync(p, 'utf8')), now, staleMin)
  } catch {
    return ciActivity(null, now, staleMin)
  }
}

/** Nothing runs: no busy conversation, Workflow, agent or running CI (a stale or missing CI cache does not count). */
export const resting = (c) => !c.convs && !c.workflows && !c.agents && !(c.ci && !c.ci.stale && c.ci.running)
