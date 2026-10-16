// factory - pure logic (no $, no I/O): config merge, pricing, warnings, and the models the two views draw.
// Input is the JSON printed by scanner/factory_scan.py. Tested with node --test tests/logic.test.mjs.

export const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable']

export function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over
  const out = { ...(base || {}) }
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? deepMerge(base[k], v) : v
  }
  return out
}

export function family(model) {
  const m = String(model || '').toLowerCase()
  return FAMILIES.find((f) => m.includes(f)) || 'other'
}

// Rate for a model id: exact id, else its family, else default.
export function rateFor(model, cfg) {
  const r = cfg.rates || {}
  return r[model] || r[family(model)] || r.default || { in: 0, out: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 }
}

// v = [in, out, cache_read, cache_write_5m, cache_write_1h, calls]
export function costOf(model, v, cfg) {
  const r = rateFor(model, cfg)
  return ((v[0] || 0) * r.in + (v[1] || 0) * r.out + (v[2] || 0) * r.cache_read + (v[3] || 0) * r.cache_write_5m
    + (v[4] || 0) * r.cache_write_1h) / 1e6
}

export function tokensOf(v) {
  return (v[0] || 0) + (v[1] || 0) + (v[2] || 0) + (v[3] || 0) + (v[4] || 0)
}

// Sum a list of {model: vec} maps into {model: {tokens, cost, calls, out}}.
export function billByModel(maps, cfg) {
  const out = {}
  for (const mp of maps) {
    for (const [m, v] of Object.entries(mp || {})) {
      const o = out[m] || (out[m] = { tokens: 0, cost: 0, calls: 0, out: 0 })
      o.tokens += tokensOf(v)
      o.cost += costOf(m, v, cfg)
      o.calls += v[5] || 0
      o.out += v[1] || 0
    }
  }
  return out
}

export function sumCost(bill) {
  return Object.values(bill).reduce((a, b) => a + b.cost, 0)
}

export function localDay(epochMs) {
  const d = new Date(epochMs)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'K'
  return String(n || 0)
}

export function fmtUsd(x) {
  return '$' + (x >= 100 ? x.toFixed(0) : x.toFixed(2))
}

export function hhmm(ts) {
  if (!ts) return '--:--'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export function short(model) {
  const m = String(model || '?')
  return m.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2')
}

export function repoOf(s) {
  const p = String(s.origin || s.cwd || '').replace(/\\/g, '/')
  const i = p.indexOf('/.claude/worktrees/')
  const base = i >= 0 ? p.slice(0, i) : p
  return base.split('/').filter(Boolean).pop() || '?'
}

export function titleOf(s) {
  return s.app_title || s.title || String(s.cli || '').slice(0, 8)
}

export function architectReason(text, cfg) {
  const a = cfg.architect || {}
  for (const r of a.reasons || []) if (new RegExp(r.match, 'i').test(text || '')) return r.label
  return a.fallback || 'other'
}

export function isArchitect(sub, cfg) {
  return ((cfg.architect && cfg.architect.types) || ['architect']).includes(sub.type)
}

export function ctxPct(ctx, cfg) {
  return Math.round((100 * (ctx || 0)) / (cfg.context_window || 400000))
}

export function ctxLevel(ctx, cfg) {
  const p = (100 * (ctx || 0)) / (cfg.context_window || 400000)
  const t = cfg.thresholds || {}
  return p >= (t.ctx_bad_pct ?? 62.5) ? 'bad' : p >= (t.ctx_warn_pct ?? 50) ? 'warn' : 'ok'
}

function loopText(loops) {
  return Object.entries(loops || {}).filter(([, n]) => n > 0).map(([k, n]) => `${k} x${n}`).join(', ')
}

// Warnings for one conversation (row or detail). Each: {level, text}.
export function warnings(s, cfg) {
  const t = cfg.thresholds || {}
  const out = []
  const subs = s.subs || []
  const noModel = subs.filter((x) => !x.workflow && !x.explicit_model)
  if (noModel.length) {
    out.push({ level: 'warn', text: `${noModel.length} subagent(s) without explicit model (inherit ${short(s.model)}): ${noModel.slice(0, 3).map((x) => x.desc || x.type).join(', ')}` })
  }
  const ro = (cfg.readonly_agent_types || [])
  const exempt = (cfg.readonly_exempt_types || [])
  const opusRo = subs.filter((x) => family(x.model) === 'opus' && !exempt.includes(x.type) && (ro.includes(x.type)
    || (x.tools >= (t.readonly_opus_min_calls ?? 5) && x.readonly / Math.max(1, x.tools) >= (t.readonly_opus_share ?? 0.8))))
  if (opusRo.length) out.push({ level: 'warn', text: `Opus doing read-only search in ${opusRo.length} subagent(s): ${opusRo.slice(0, 3).map((x) => x.desc || x.type).join(', ')} (use Haiku)` })
  if (family(s.model) === 'opus' && s.tools >= 20 && s.readonly / Math.max(1, s.tools) >= (t.readonly_opus_share ?? 0.8)) {
    out.push({ level: 'warn', text: `Opus main thread: ${s.readonly}/${s.tools} tool calls are read-only search (delegate to explore-fast on Haiku)` })
  }
  if ((s.ctx || 0) > (t.handoff_tokens ?? 250000) && !s.resume_md) {
    out.push({ level: 'bad', text: `context ${fmtTokens(s.ctx)} > ${fmtTokens(t.handoff_tokens ?? 250000)} and no handoff/RESUME.md` })
  }
  const loops = [loopText(s.loops), ...subs.map((x) => loopText(x.loops))].filter(Boolean)
  if (loops.length) out.push({ level: 'warn', text: `timer/loop tools used: ${loops.join('; ')} (V4.7: no timer wake-ups)` })
  return out
}

export function isGuard(text, cfg) {
  return new RegExp(cfg.guard_match || 'denied|refused', 'i').test(text || '')
}

export function waitingOnJulian(s) {
  return Boolean(s.ask_open || (s.needs_action && String(s.needs_action).trim()))
}

// ---- Global dashboard -------------------------------------------------------------------------------------------

export function dashboard(scan, cfg, nowMs) {
  const today = localDay(nowMs)
  const rows = []
  const byModel = {}
  const byProject = {}
  for (const s of scan.sessions || []) {
    if (s.archived && !s.live) continue
    const dayMaps = [(s.days || {})[today], ...(s.subs || []).map((x) => (x.days || {})[today])]
    const billToday = billByModel(dayMaps, cfg)
    const costToday = sumCost(billToday)
    for (const [m, b] of Object.entries(billToday)) {
      const o = byModel[m] || (byModel[m] = { tokens: 0, cost: 0, calls: 0 })
      o.tokens += b.tokens; o.cost += b.cost; o.calls += b.calls
    }
    const repo = repoOf(s)
    const p = byProject[repo] || (byProject[repo] = { cost: 0, tokens: 0, sessions: 0 })
    p.cost += costToday; p.tokens += Object.values(billToday).reduce((a, b) => a + b.tokens, 0); p.sessions += 1
    const w = warnings(s, cfg)
    const err = s.last_error && s.last_error[2]
    rows.push({
      cli: s.cli, sid: s.sid, title: titleOf(s), repo, branch: s.branch || '', model: s.app_model || s.model,
      effort: s.app_effort || s.effort || '?', ctx: s.ctx, ctxPct: ctxPct(s.ctx, cfg), ctxLevel: ctxLevel(s.ctx, cfg),
      costToday, running: (s.subs || []).filter((x) => x.status === 'running').length, subs: (s.subs || []).length,
      pr: s.pr ? { number: s.pr.number, url: s.pr.url, state: (s.ci || {}).state || '?', ci: (s.ci || {}).ci || '?' } : null,
      problem: w.length ? w[0].text : err || '', problemLevel: w.length ? w[0].level : err ? 'warn' : 'ok',
      waiting: waitingOnJulian(s), live: Boolean(s.live), last: s.last_activity,
    })
  }
  const totalCalls = Object.values(byModel).reduce((a, b) => a + b.calls, 0)
  const fam = {}
  for (const [m, b] of Object.entries(byModel)) {
    const f = family(m)
    const o = fam[f] || (fam[f] = { calls: 0, cost: 0, tokens: 0 })
    o.calls += b.calls; o.cost += b.cost; o.tokens += b.tokens
  }
  const targets = cfg.routing_targets || {}
  const share = ['opus', 'sonnet', 'haiku'].map((f) => {
    const v = fam[f] || { calls: 0, cost: 0 }
    const sh = totalCalls ? v.calls / totalCalls : 0
    const tg = targets[f] || {}
    const ok = (tg.max === undefined || sh <= tg.max) && (tg.min === undefined || sh >= tg.min)
    return { family: f, share: sh, calls: v.calls, cost: v.cost, target: tg.max !== undefined ? `<= ${Math.round(tg.max * 100)}%` : tg.min !== undefined ? `>= ${Math.round(tg.min * 100)}%` : '-', ok }
  })
  rows.sort((a, b) => (b.live - a.live) || (b.last - a.last))
  return {
    today, rows, byModel, byProject, share, totalCost: Object.values(byModel).reduce((a, b) => a + b.cost, 0), totalCalls,
  }
}

// ---- One conversation ---------------------------------------------------------------------------------------------

export function conversation(d, cfg, nowMs) {
  const subs = d.subs || []
  const mainBill = billByModel([d.models], cfg)
  const node = (x) => {
    const bill = billByModel([x.models], cfg)
    const arch = isArchitect(x, cfg)
    return {
      id: x.id, type: x.type, model: x.model, explicit: x.explicit_model || null, effort: x.effort || '?', status: x.status,
      tokens: Object.values(bill).reduce((a, b) => a + b.tokens, 0), cost: sumCost(bill),
      task: x.desc || x.prompt || '', architect: arch ? architectReason(`${x.desc || ''} ${x.prompt || ''}`, cfg) : null,
      phase: x.phase || null, bg: x.bg, ts: x.ts,
    }
  }
  const agents = subs.filter((x) => !x.workflow).map(node)
  const wfIds = [...new Set(subs.filter((x) => x.workflow).map((x) => x.workflow))]
  const calls = d.calls || []
  const workflows = wfIds.map((id) => {
    const call = calls.find((c) => c.tool === 'Workflow' && c.runId === id)
    const nodes = subs.filter((x) => x.workflow === id).map(node)
    return { id, name: call ? call.desc : id, nodes, cost: nodes.reduce((a, b) => a + b.cost, 0),
      tokens: nodes.reduce((a, b) => a + b.tokens, 0), running: nodes.filter((n) => n.status === 'running').length }
  })
  const allBill = billByModel([d.models, ...subs.map((x) => x.models)], cfg)
  // cost per turn: the main thread's usage in the turn plus the subagents started during it
  const turns = (d.turns || []).map((t, i, arr) => {
    const next = arr[i + 1] ? arr[i + 1].ts : '9999'
    const inTurn = subs.filter((x) => x.ts && x.ts >= t.ts && x.ts < next)
    const own = sumCost(billByModel([t.models], cfg))
    const sub = sumCost(billByModel(inTurn.map((x) => x.models), cfg))
    return { ts: t.ts, kind: t.kind || 'human', text: t.text, cost: own + sub, own, sub, agents: inTurn.length }
  })
  const guards = [
    ...(d.errors || []).filter((e) => isGuard(e[2], cfg)).map((e) => ({ ts: e[0], text: e[2], src: 'tool' })),
    ...(d.guards || []).map((g) => ({ ts: g[0], text: `${g[1]}: ${g[2]}`, src: 'cc-control' })),
  ].sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
  return {
    title: titleOf(d), repo: repoOf(d), branch: d.branch || '',
    main: {
      model: d.app_model || d.model, effort: d.app_effort || d.effort || '?', ctx: d.ctx, ctxPct: ctxPct(d.ctx, cfg),
      ctxLevel: ctxLevel(d.ctx, cfg), window: cfg.context_window || 400000, cost: sumCost(allBill), ownCost: sumCost(mainBill),
      live: Boolean(d.live),
    },
    agents, workflows, bill: allBill, total: sumCost(allBill), turns: turns.slice(-(cfg.turn_count || 10)),
    guards: guards.slice(-12), events: compactEvents(d.events || []).slice(-(cfg.event_count || 15)), warnings: warnings(d, cfg),
    pr: d.pr ? { ...d.pr, ...(d.ci || {}) } : null, waiting: waitingOnJulian(d),
  }
}

// Session log: mcp__server__tool -> tool (server); runs of the same event collapse to one row "×n".
export function compactEvents(events) {
  const out = []
  for (const e of events) {
    const text = String(e[2]).replace(/\bmcp__([^_ ]+(?:_[^_ ]+)*)__([\w-]+)/, (m, srv, tool) => `${tool} (${srv.replace(/^ccd_/, '')})`)
    const last = out[out.length - 1]
    if (last && last[1] === e[1] && last[3] === text) { last[4] += 1; last[0] = e[0]; last[2] = `${text} ×${last[4]}`; continue }
    out.push([e[0], e[1], text, text, 1])
  }
  return out.map((e) => [e[0], e[1], e[2]])
}

// Pick a conversation from the last scan by id prefix or title fragment (most recent first).
export function pickSession(sessions, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return null
  return (sessions || []).find((s) => String(s.cli).startsWith(q) || String(s.sid || '').replace(/^local_/, '').startsWith(q))
    || (sessions || []).find((s) => titleOf(s).toLowerCase().includes(q)) || null
}

export function scanArgs(cfg, opts) {
  const a = [opts.script, '--cache', opts.cache, '--hours', String((cfg.thresholds || {}).recent_hours ?? 36),
    '--ci-ttl', String(cfg.ci_ttl_s ?? 600), '--live-s', String((cfg.thresholds || {}).live_s ?? 180)]
  if (opts.detail) a.push('--detail', opts.detail)
  if (cfg.include_cli) a.push('--cli')
  if (opts.extra) a.push(...opts.extra)
  return a
}
