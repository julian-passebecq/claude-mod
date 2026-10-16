// Canonical copy: lib/core/codex.mjs (repo root); usage/lib/codex.mjs and mods/*/lib/core copies are made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// Codex usage, read from Codex's own local session logs (pure part: no I/O).
// Codex CLI / app writes one rollout file per session: <sessions_dir>/YYYY/MM/DD/rollout-*.jsonl. Two line types matter:
//   {"type":"turn_context","payload":{"model":"gpt-…", …}}                    the model of the turns that follow
//   {"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{…}},"rate_limits":{…}}}
// total_token_usage is cumulative per session, so the tokens of one event are the difference with the previous one;
// each difference goes to the day (local time) of the event and to the current model. rate_limits is the plan's
// snapshot (used_percent, window_minutes, resets_at in epoch seconds) at that moment. The installed codex-hud plugin
// reads the same files (src/local-logs.ts). Nothing else is read: never auth.json, config.toml or the sqlite logs.

/** Token vector of a Codex event: [input (cache included), cached input, output (reasoning included), reasoning, total]. */
export const CV = { input: 0, cached: 1, output: 2, reasoning: 3, total: 4 }
const zero = () => [0, 0, 0, 0, 0]
const vec = u => [u.input_tokens || 0, u.cached_input_tokens || 0, u.output_tokens || 0, u.reasoning_output_tokens || 0, u.total_tokens || (u.input_tokens || 0) + (u.output_tokens || 0)]
const add = (a, b) => {
  for (let i = 0; i < a.length; i++) a[i] += b[i] || 0
  return a
}

export function newCodexState() {
  return { offset: 0, model: '', effort: '', cum: null, days: {}, rl: null, last: 0, trig: 0, tps: {}, streams: [], resp: [] }
}

const dayKey = (ms, tzMin) => new Date(ms + tzMin * 60000).toISOString().slice(0, 10)

// Output speed of Codex responses, same rule as the Claude transcripts (lib/core/transcripts.mjs): a response starts at
// the last line that sent it (task_started, a tool output, or the end of the previous response) and ends at its
// token_usage_record, whose usage is that response's own tokens. Per day, model and effort: [output, ms, n, {bucket: n}].
const TPS_MIN_OUT = 50
const TPS_MAX_MS = 30 * 60000
const TPS_STEP = Math.log(1.15)
const TRIGGERS = ['"task_started"', '_call_output"', '"user_message"']
const tsOf = line => {
  const i = line.indexOf('"timestamp":"')
  if (i < 0) return 0
  const t = Date.parse(line.slice(i + 13, line.indexOf('"', i + 13)))
  return Number.isFinite(t) ? t : 0
}

function timeResponse(st, ts, p, tzMin) {
  const u = p.usage || {}
  const id = String(p.response_id || '')
  st.resp = st.resp || []
  if (id && st.resp.includes(id)) return
  if (id) {
    st.resp.push(id)
    if (st.resp.length > 50) st.resp.shift()
  }
  const start = st.trig || 0
  st.trig = ts
  const out = Number(u.output_tokens) || 0
  const ms = ts - start
  if (!(start > 0) || ms <= 0 || ms > TPS_MAX_MS || out < TPS_MIN_OUT) return
  const key = `${dayKey(start, tzMin)}|${st.model || '?'}|${st.effort || ''}`
  const row = ((st.tps = st.tps || {})[key] ||= [0, 0, 0, {}])
  row[0] += out
  row[1] += ms
  row[2] += 1
  const b = Math.max(0, Math.floor(Math.log(Math.max(out / (ms / 1000), 1)) / TPS_STEP))
  row[3][b] = (row[3][b] || 0) + 1
  st.streams = st.streams || []
  st.streams.push({ ts, model: st.model || '?', effort: st.effort || '', out, ms })
  if (st.streams.length > 10) st.streams.shift()
}

/** Feeds one line of a rollout file into the per-file state. Lines without a marker are skipped without parsing. */
export function feedCodexLine(st, line, tzMin = 0) {
  if (!line) return
  const usageLine = line.indexOf('"token_usage_record"') >= 0
  if (!usageLine && line.indexOf('"token_count"') < 0 && line.indexOf('"turn_context"') < 0) {
    // a line that sends a request: only its time is needed (tool outputs can be large, never parsed)
    const head = line.slice(0, 300)
    if (TRIGGERS.some(t => head.indexOf(t) >= 0)) st.trig = tsOf(line) || st.trig
    return
  }
  let o
  try {
    o = JSON.parse(line)
  } catch {
    return
  }
  const p = o && o.payload
  if (!p) return
  if (o.type === 'turn_context') {
    if (typeof p.model === 'string' && p.model) st.model = p.model
    if (typeof p.effort === 'string') st.effort = p.effort
    return
  }
  if (o.type === 'token_usage_record') {
    const ts = Date.parse(o.timestamp)
    if (Number.isFinite(ts)) timeResponse(st, ts, p, tzMin)
    return
  }
  if (o.type !== 'event_msg' || p.type !== 'token_count') return
  const ts = Date.parse(o.timestamp)
  if (!Number.isFinite(ts)) return
  st.last = Math.max(st.last, ts)
  const total = p.info && p.info.total_token_usage
  if (total) {
    const now = vec(total)
    // A counter that went down started over (new thread state): the whole value is new.
    const delta = st.cum && now[CV.total] >= st.cum[CV.total] ? now.map((x, i) => x - st.cum[i]) : now
    st.cum = now
    if (delta[CV.total] > 0) {
      const d = (st.days[dayKey(ts, tzMin)] ||= {})
      add((d[st.model || '?'] ||= zero()), delta)
    }
  }
  if (p.rate_limits && (!st.rl || ts >= st.rl.ts)) st.rl = { ts, ...limitsOf(p.rate_limits) }
}

/** Keeps only the documented-looking fields of a rate_limits snapshot (no credit balance, no ids). */
export function limitsOf(rl) {
  const w = x => (x && Number.isFinite(x.used_percent) ? { pct: x.used_percent, windowMin: x.window_minutes ?? null, reset: x.resets_at ? x.resets_at * 1000 : null } : null)
  return { primary: w(rl.primary), secondary: w(rl.secondary), plan: rl.plan_type ?? null, reached: rl.rate_limit_reached_type ?? null }
}

/** Merges the per-file states into what the pane needs: tokens per day and model, and the newest limits snapshot. */
export function aggregateCodex(files, { now, available = true, dir = '', error = '' } = {}) {
  const days = {}
  let rl = null
  let model = ''
  let lastTs = 0
  let sessions = 0
  const tps = {}
  let streams = []
  for (const st of Object.values(files)) {
    if (Object.keys(st.days).length) sessions++
    for (const [k, t] of Object.entries(st.tps || {})) {
      const row = (tps[k] ||= [0, 0, 0, {}])
      row[0] += t[0]
      row[1] += t[1]
      row[2] += t[2]
      for (const [b, n] of Object.entries(t[3])) row[3][b] = (row[3][b] || 0) + n
    }
    streams = streams.concat(st.streams || [])
    for (const [d, byModel] of Object.entries(st.days)) {
      const t = (days[d] ||= {})
      for (const [m, v] of Object.entries(byModel)) add((t[m] ||= zero()), v)
    }
    if (st.rl && (!rl || st.rl.ts > rl.ts)) rl = st.rl
    if (st.model && st.last >= lastTs) {
      lastTs = st.last
      model = st.model
    }
  }
  streams = streams.sort((a, b) => b.ts - a.ts).slice(0, 30)
  return { generated: now, available, dir, error, sessions, days, limits: rl, model, tps, streams }
}

/** Day keys of the last `n` days ending today (local time). */
export function lastDays(now, tzMin, n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(now - i * 86400000, tzMin))
  return out
}

/** Totals and per-model rows for today and the last 7 days, plus the limit windows with their labels. */
export function codexView(cx, cfg = {}, { now, tzMin = 0 } = {}) {
  const c = cfg.codex || {}
  if (!cx || !cx.available) return { available: false, reason: cx?.error || 'no_dir' }
  const period = n => {
    const total = zero()
    const by = {}
    const perDay = []
    for (const d of lastDays(now, tzMin, n)) {
      const day = zero()
      for (const [m, v] of Object.entries(cx.days[d] || {})) {
        add(total, v)
        add((by[m] ||= zero()), v)
        add(day, v)
      }
      perDay.push({ key: d, v: day })
    }
    return { total, perDay, model: Object.entries(by).map(([key, v]) => ({ key, v })).sort((a, b) => b.v[CV.total] - a.v[CV.total]) }
  }
  const labels = c.window_labels || {}
  const staleMs = (c.stale_limits_h ?? 24) * 3600000
  const windows = []
  if (cx.limits) {
    for (const w of [cx.limits.primary, cx.limits.secondary]) {
      if (!w) continue
      windows.push({ ...w, label: labels[String(w.windowMin)] || (w.windowMin ? `${w.windowMin} min` : '?'), at: cx.limits.ts, stale: now - cx.limits.ts > staleMs, past: !!(w.reset && w.reset < now) })
    }
  }
  const want = c.expected_windows || []
  const missing = want.filter(m => !windows.some(w => String(w.windowMin) === String(m))).map(m => labels[String(m)] || `${m} min`)
  const hasData = Object.keys(cx.days).length > 0 || !!cx.limits
  return { available: true, hasData, sessions: cx.sessions, model: cx.model, plan: cx.limits?.plan ?? null, today: period(1), week: period(7), windows, missing, at: cx.limits?.ts ?? null }
}

/** Whether the Codex tab is on: "on", "off", or "auto" (on when the sessions folder exists). */
export function codexEnabled(setting, dirExists) {
  if (setting === 'off' || setting === false) return false
  if (setting === 'on' || setting === true) return true
  return !!dirExists
}
