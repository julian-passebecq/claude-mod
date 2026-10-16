// factory - "Ça t'attend" strip: pure logic (no $, no I/O), tested with node --test tests/logic.test.mjs.
// Input: the scanner JSON (sessions + reviews from --waiting). Output: the rows the strip draws and the notifications to raise.
// Ported from the old coordinator mod (green PR left open, question pending), plus the 3 Oct incidents A2-A4:
// a lane idle while its PR is red, conflicting or its pipeline skipped. Read-only: nothing here sends or blocks anything.
// Canonical copy: lib/core/waiting.mjs (repo root). factory/hooks/waiting.mjs and every mods/*/lib/core/waiting.mjs are
// byte copies made by scripts/sync-libs.mjs: never edit a copy by hand. No imports, so every copy works on its own.

// Same as factory's logic.mjs repoOf / titleOf (kept here so this file has no sibling to carry).
function repoOf(s) {
  const p = String(s.origin || s.cwd || '').replace(/\\/g, '/')
  const i = p.indexOf('/.claude/worktrees/')
  const base = i >= 0 ? p.slice(0, i) : p
  return base.split('/').filter(Boolean).pop() || '?'
}

function titleOf(s) {
  return s.app_title || s.title || String(s.cli || '').slice(0, 8)
}

export const WAITING_DEFAULTS = {
  enabled: true,
  green_min: 30,
  idle_min: 20,
  ask_min: 5,
  julian_max_age_h: 72,
  idle_pr_states: ['failed', 'canceled', 'skipped', 'conflict'],
  max_rows: 12,
  show_children: true,
  show_archived_children: false,
  session_link: 'claude://claude.ai/epitaxy/{id}',
  notify: true,
  notify_kinds: ['green', 'ask', 'needs', 'awaiting', 'idle'],
  notify_existing_on_first_run: false,
  notify_max_per_scan: 3,
  notify_keep_days: 14,
  background_s: 120,
  pr_ttl_s: 300,
  pr_max_age_days: 14,
  pr_max_checks: 25,
  gitlab_host: '',
  labels: {
    title: "Ça t'attend",
    none: 'Rien ne t’attend.',
    children: 'Sous-conversations',
    since: 'depuis',
    more: '+ {n} autres',
    open_session: 'Ouvrir',
    kinds: { green: 'PR verte', ask: 'Question', needs: 'Attend Julian', awaiting: 'Attend Julian', idle: 'Lane à l’arrêt' },
    green: '{pr} verte depuis {age}, pas mergée',
    ask: 'Question en attente : {question}',
    needs: 'Attend Julian : {text}',
    awaiting: 'Interrompue, attend une personne',
    idle: 'Aucun tour depuis {age} alors que {pr} est {state}',
    states: { failed: 'rouge', canceled: 'annulée', skipped: 'sans pipeline (skipped)', conflict: 'en conflit', none: 'sans CI', manual: 'en attente d’un job manuel' },
    child: { working: 'travaille', julian: 'attend Julian', blocked: 'bloquée', done: 'terminée', review: 'à relire', idle: 'inactive', archived: 'archivée' },
    notify_title: "Ça t'attend",
    notify_more: '{n} autres lignes dans /factory',
    reviews_error: 'PR/MR non lues : {errors}',
  },
}

export function waitingConfig(cfg) {
  const w = (cfg && cfg.waiting) || {}
  return { ...WAITING_DEFAULTS, ...w, labels: deepLabels(WAITING_DEFAULTS.labels, w.labels || {}) }
}

function deepLabels(a, b) {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(a[k] || {}), ...v } : v
  return out
}

export function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
}

export function age(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)} j`
}

export function normUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '').toLowerCase()
}

export function prLabel(r) {
  const repo = String(r.repo || '').split('/').filter(Boolean).pop() || '?'
  return `${repo}${r.provider === 'gitlab' || /gitlab/.test(r.url || '') ? '!' : '#'}${r.number}`
}

// Small stable hash so a changed needs_action text is a new row (and a new notification), the same text is not.
export function hash(s) {
  let h = 5381
  for (const c of String(s || '')) h = ((h * 33) ^ c.codePointAt(0)) >>> 0
  return h.toString(36)
}

function tsMs(v) {
  if (!v) return null
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

function sessionRef(s, w) {
  return { cli: s.cli, sid: s.sid || null, title: titleOf(s), repo: repoOf(s), link: s.sid ? fill(w.session_link, { id: s.sid }) : null }
}

// PR state for the idle rule: the review list first (it carries conflicts), else the per-session CI lookup.
function prState(rev, ci) {
  if (rev) return rev.conflict ? 'conflict' : rev.ci
  if (ci && /open/.test(String(ci.state || ''))) return String(ci.ci || '').toLowerCase()
  return null
}

export function waitingRows(scan, cfg, nowMs) {
  const w = waitingConfig(cfg)
  const L = w.labels
  const sessions = (scan && scan.sessions) || []
  const reviews = (scan && scan.reviews && scan.reviews.items) || []
  const byUrl = new Map(reviews.map((r) => [normUrl(r.url), r]))
  const owner = new Map()
  for (const s of sessions) {
    for (const u of [s.pr && s.pr.url, ...(s.app_prs || []).map((p) => p.url)]) if (u && !owner.has(normUrl(u))) owner.set(normUrl(u), s)
  }
  const rows = []
  // (1) green PR/MR left open
  for (const r of reviews) {
    if (r.ci !== 'success' || r.conflict) continue
    const since = tsMs(r.green_since) || tsMs(r.updated)
    if (!since || nowMs - since < w.green_min * 60000) continue
    const s = owner.get(normUrl(r.url))
    rows.push({ key: `green:${normUrl(r.url)}`, kind: 'green', level: 'warn', since, link: r.url,
      what: fill(L.green, { pr: prLabel(r), age: age(nowMs - since), title: r.title }), detail: r.title || '', pr: prLabel(r),
      session: s ? sessionRef(s, w) : null })
  }
  for (const s of sessions) {
    if (s.archived) continue
    const last = tsMs(s.last_activity) || tsMs(s.mtime) || 0
    const ref = sessionRef(s, w)
    // (2) waiting on Julian: pending AskUserQuestion, a wrap-up that needs an action, an interrupted turn awaiting a person
    if (nowMs - last <= w.julian_max_age_h * 3600000) {
      const askAt = tsMs(s.ask_ts)
      if (s.ask_open && (!askAt || nowMs - askAt >= w.ask_min * 60000)) {
        rows.push({ key: `ask:${s.cli}:${s.ask_ts || ''}`, kind: 'ask', level: 'warn', since: askAt || last, link: ref.link,
          what: fill(L.ask, { question: s.ask_q || 'AskUserQuestion' }), session: ref })
      }
      const needs = String(s.needs_action || '').trim()
      if (needs) {
        rows.push({ key: `needs:${s.cli}:${hash(needs)}`, kind: 'needs', level: s.status_category === 'blocked' ? 'bad' : 'warn', since: last,
          link: ref.link, what: fill(L.needs, { text: needs }), session: ref })
      }
      if (s.awaiting) {
        rows.push({ key: `awaiting:${s.cli}`, kind: 'awaiting', level: 'warn', since: last, link: ref.link, what: L.awaiting, session: ref })
      }
    }
    // (3) lane idle while its PR is red, conflicting or its pipeline skipped
    if (!s.live && nowMs - last >= w.idle_min * 60000) {
      const urls = [...new Set([s.pr && s.pr.url, ...(s.app_prs || []).map((p) => p.url)].filter(Boolean).map(normUrl))]
      for (const u of urls) {
        const rev = byUrl.get(u)
        const st = prState(rev, s.pr && normUrl(s.pr.url) === u ? s.ci : null)
        if (!st || !w.idle_pr_states.includes(st)) continue
        const label = rev ? prLabel(rev) : prLabel({ ...(s.pr || {}), repo: (s.pr || {}).repo })
        rows.push({ key: `idle:${s.cli}:${u}:${st}`, kind: 'idle', level: 'bad', since: last, link: rev ? rev.url : s.pr.url, pr: label,
          what: fill(L.idle, { age: age(nowMs - last), pr: label, state: (L.states || {})[st] || st }), session: ref })
      }
    }
  }
  rows.sort((a, b) => a.since - b.since)
  return { rows, children: w.show_children ? childGroups(sessions, w, nowMs) : [], errors: (scan && scan.reviews && scan.reviews.errors) || [] }
}

// (4) sub-conversations linked to a lead (app session file field spawnedFrom), with their state.
export function childState(s, w, nowMs) {
  if (s.archived) return 'archived'
  if (s.live) return 'working'
  if (s.ask_open || String(s.needs_action || '').trim() || s.awaiting) return 'julian'
  if (s.status_category === 'blocked') return 'blocked'
  if (s.status_category === 'completed') return 'done'
  if (s.status_category === 'review_ready') return 'review'
  return 'idle'
}

export function childGroups(sessions, w, nowMs) {
  const bySid = new Map(sessions.filter((s) => s.sid).map((s) => [s.sid, s]))
  const groups = new Map()
  for (const s of sessions) {
    if (!s.parent || (s.archived && !w.show_archived_children)) continue
    const g = groups.get(s.parent) || { sid: s.parent, title: bySid.has(s.parent) ? titleOf(bySid.get(s.parent)) : (s.parent_title || s.parent),
      link: fill(w.session_link, { id: s.parent }), cli: bySid.has(s.parent) ? bySid.get(s.parent).cli : null, children: [], last: 0 }
    const st = childState(s, w, nowMs)
    const last = tsMs(s.last_activity) || 0
    g.children.push({ title: titleOf(s), cli: s.cli, state: st, label: (w.labels.child || {})[st] || st, since: last,
      link: s.sid ? fill(w.session_link, { id: s.sid }) : null })
    g.last = Math.max(g.last, last)
    groups.set(s.parent, g)
  }
  return [...groups.values()].sort((a, b) => b.last - a.last)
}

// Which rows to announce: those never announced before (one notification per row, ever), of the configured kinds.
// `seen` is {key: epochMs} kept in $.store; returns {announce, seen} with old keys pruned. On the very first run
// (seen === null) every current row is marked seen without a notification unless notify_existing_on_first_run.
export function toAnnounce(rows, seen, cfg, nowMs) {
  const w = waitingConfig(cfg)
  const first = seen === null || seen === undefined
  const next = {}
  const keep = w.notify_keep_days * 86400000
  for (const [k, t] of Object.entries(seen || {})) if (nowMs - t < keep) next[k] = t
  const fresh = rows.filter((r) => !(r.key in next))
  for (const r of rows) if (!(r.key in next)) next[r.key] = nowMs
  if (!w.notify || (first && !w.notify_existing_on_first_run)) return { announce: [], more: 0, seen: next }
  const due = fresh.filter((r) => w.notify_kinds.includes(r.kind))
  return { announce: due.slice(0, w.notify_max_per_scan), more: Math.max(0, due.length - w.notify_max_per_scan), seen: next }
}

export function notifyText(row) {
  return row.session ? `${row.what} · ${row.session.title}` : row.what
}

// Scanner flags for the review list (gh / glab), from the config.
export function waitingArgs(cfg) {
  const w = waitingConfig(cfg)
  if (!w.enabled) return []
  const a = ['--waiting', '--pr-ttl', String(w.pr_ttl_s), '--pr-max-age-days', String(w.pr_max_age_days), '--pr-max-checks', String(w.pr_max_checks)]
  if (w.gitlab_host) a.push('--gl-host', String(w.gitlab_host))
  return a
}

// Background scans: one session at a time holds the lease (kept in $.store, shared by every session on the PC).
export function holdsLease(lease, self, nowMs, intervalMs) {
  return !lease || !lease.sid || lease.sid === self || nowMs - (lease.at || 0) > 3 * intervalMs
}
