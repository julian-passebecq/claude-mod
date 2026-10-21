// Canonical copy: lib/core/activity.mjs (repo root). Every mods/<mod>/lib/core/activity.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// « Is anything running? » (Julian, 21 Oct: « how do I know no work is in process? 0 workflow, 0 agent, 0 sub-agent,
// 0 CI »): the shared definitions, pure, so every mod counts the same way.
//   - mainThreadBusy: a conversation whose main thread has a turn in progress (« fil principal »): the engine's own busy
//     flag when the row has one, else its transcript was written less than busy_min minutes ago and the last assistant
//     message did not end the turn (stop_reason end_turn) nor failed (api_error).
//   - ciNow: the running / queued pipelines of the ci mod's cache (~/.claude/ci-pipelines-cache.json, GitHub Actions and
//     GitLab), each with its repo, branch, running job and elapsed time, and how old the cache is: past ci_stale_min
//     minutes its zero means « not read », not « nothing runs ».
//   - restingSince: how long nothing has run (the newest of the finished items).
// Pure: no I/O, no node: imports, so a mod's hooks (which may import no built-in module) can use it; the caller reads
// the cache file.

export const ACTIVITY_DEFAULTS = { busy_min: 2, ci_stale_min: 15 }

/** epoch s / ms / ISO -> ms, or 0. */
export const toMs = (v) => {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? (v > 1e12 ? v : v * 1000) : 0
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
}

/**
 * Whether a conversation's main thread has a turn in progress. s: a scan row ({ mtime, stop, api_error } as factory's
 * scanner writes them; optional `busy`, the engine's own flag, wins when it is a boolean; optional `last_prompt_ts`:
 * a prompt newer than the last stop means a new turn started).
 */
export function mainThreadBusy(s, now = Date.now(), cfg = {}) {
  if (!s) return false
  if (typeof s.busy === 'boolean') return s.busy
  const lim = Math.max(0.1, Number(cfg.busy_min ?? ACTIVITY_DEFAULTS.busy_min) || ACTIVITY_DEFAULTS.busy_min) * 60000
  const at = toMs(s.mtime) || toMs(s.last_ts)
  if (!at || now - at > lim) return false
  if (s.api_error) return false
  if (s.stop === 'end_turn') {
    const prompt = toMs(s.last_prompt_ts)
    return Boolean(prompt && prompt > (toMs(s.last_ts) || 0) - 1)
  }
  return true
}

const runsOf = (cache) => ((cache && cache.apps) || []).flatMap((a) => (a.runs || []).map((r) => ({ ...r, app: r.app || a.app })))
const isLive = (s) => s === 'running' || s === 'queued'

/**
 * The CI that runs now, from the ci mod's pipelines cache. -> { read: boolean (a cache with a time), generated (ms),
 * ageMs, stale (older than ci_stale_min), list: [{ key, repo, branch, job, status: running | queued, who, backend,
 * startMs, ms, failed (a job of it already red) }] longest first, running, failed }.
 */
export function ciNow(cache, now = Date.now(), cfg = {}) {
  const generated = toMs(cache && cache.generated)
  const staleMs = Math.max(1, Number(cfg.ci_stale_min ?? ACTIVITY_DEFAULTS.ci_stale_min) || ACTIVITY_DEFAULTS.ci_stale_min) * 60000
  const ageMs = generated ? Math.max(0, now - generated) : null
  const list = []
  for (const r of runsOf(cache)) {
    if (!isLive(r.status)) continue
    const jobs = Array.isArray(r.jobs) ? r.jobs : []
    const job = jobs.find((j) => j && j.status === 'running') || jobs.find((j) => j && j.status === 'queued') || null
    const startMs = toMs(r.created) || generated || now
    list.push({
      key: `${r.app}|${r.backend || ''}|${r.id || r.branch || ''}|${r.created || ''}`, repo: String(r.app || '?'), branch: String(r.branch || ''),
      job: job ? String(job.name || job.stage || '') : String(r.workflow || ''), status: r.status, who: r.who || 'unknown', backend: r.backend || '',
      startMs, ms: Math.max(0, now - startMs), failed: jobs.some((j) => j && j.status === 'failed' && !j.allow_failure),
    })
  }
  list.sort((a, b) => b.ms - a.ms)
  return {
    read: Boolean(cache && generated), generated: generated || null, ageMs, stale: !generated || ageMs > staleMs,
    list, running: list.length, failed: list.filter((x) => x.failed).length,
  }
}

/**
 * Everything counted, and whether all of it is zero. in: { convs, workflows, agents, subagents, ci: ciNow() | null,
 * blocked }. -> { ...counts, ci: n, ciStale, idle } (idle: nothing runs and nothing is blocked; a stale CI cache does
 * not make it busy, the caller says « CI : non lu » next to it).
 */
export function activityCounts({ convs = 0, workflows = 0, agents = 0, subagents = 0, ci = null, blocked = 0 } = {}) {
  const n = ci && !ci.stale ? ci.running : 0
  return { convs, workflows, agents, subagents, ci: n, ciStale: Boolean(!ci || ci.stale), ciAgeMs: ci ? ci.ageMs : null, blocked,
    idle: !convs && !workflows && !agents && !subagents && !n && !blocked }
}

/** The newest finished item of a list of { name, at } -> { name, at, ago } | null. */
export function restingSince(items, now = Date.now()) {
  let last = null
  for (const x of items || []) if (x && toMs(x.at) && (!last || toMs(x.at) > last.at)) last = { name: x.name || '', at: toMs(x.at) }
  return last ? { ...last, ago: Math.max(0, now - last.at) } : null
}
