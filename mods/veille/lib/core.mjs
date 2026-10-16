// veille - pure logic (no I/O): modes, quiet hours, alerts, dedup and rate limits, budgets, missed tours, merge
// eligibility and the wake brief. Tested with node --test mods/veille/tests/logic.test.mjs.
// The conversation rows come from the factory mod's « Ça t'attend » logic, imported as a library (not copied).
import { waitingRows, age, normUrl, prLabel } from '../../factory/hooks/waiting.mjs'
import { titleOf } from '../../factory/hooks/logic.mjs'

export { ACTIONS, MODES, deepMerge, modeName, modeOf, may, inQuietHours, tourDue, gapOf, watcherState, fill } from './modes.mjs'
import { deepMerge, modeOf, may, inQuietHours, fill } from './modes.mjs'

function tsMs(v) {
  if (!v) return null
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

// Alerts of one tour: factory's rows + veille's own. Each: {key, kind, severity, julian, what, title, link, since, ...}.
export function alertsOf(scan, cfg, nowMs, extra = []) {
  const A = cfg.alerts || {}
  const sev = A.severity || {}
  const julianKinds = A.julian_kinds || []
  const { rows, errors } = waitingRows(scan, { waiting: cfg.waiting || {} }, nowMs)
  const out = rows.map((r) => ({
    key: r.key, kind: r.kind, severity: sev[r.kind] || r.level || 'warn', what: r.what, detail: r.detail || '',
    title: r.session ? r.session.title : (r.pr || ''), cli: r.session ? r.session.cli : null, sid: r.session ? r.session.sid : null,
    link: r.link || null, session_link: r.session ? r.session.link : null, pr: r.pr || null, since: r.since,
  }))
  // A Workflow agent stopped (not done, not failed) while its conversation is idle: the « resume a Workflow » case.
  for (const s of (scan && scan.sessions) || []) {
    if (s.archived || s.live) continue
    const last = tsMs(s.last_activity) || 0
    if (nowMs - last < (A.workflow_idle_min || 20) * 60000 || nowMs - last > (A.workflow_max_age_h || 24) * 3600000) continue
    if (s.status_category === 'completed') continue
    const wf = (s.subs || []).filter((x) => x.workflow)
    if (!wf.length) continue
    const latest = wf.reduce((a, b) => (String(b.last_ts || '') > String(a.last_ts || '') ? b : a))
    if (latest.status !== 'stopped') continue
    out.push({ key: `workflow:${s.cli}:${latest.workflow}`, kind: 'workflow', severity: sev.workflow || 'bad',
      what: `Workflow ${latest.workflow} arrêté, conversation inactive depuis ${age(nowMs - last)}`, title: titleOf(s),
      cli: s.cli, sid: s.sid || null, link: null, session_link: s.sid ? fill((cfg.links || {}).session, { id: s.sid }) : null,
      since: last })
  }
  for (const e of errors || []) out.push({ key: `scan:${e}`, kind: 'scan', severity: sev.scan || 'info', what: e, title: '', since: nowMs })
  for (const x of extra) out.push({ severity: sev[x.kind] || 'warn', ...x })
  for (const a of out) a.julian = julianKinds.includes(a.kind)
  return out
}


// Merge this tour's alerts into the stored ones: first_seen kept, acks kept, vanished ones moved to `resolved`.
export function reconcile(prev, current, acks, nowMs, keepResolved = 30) {
  const old = (prev && prev.alerts) || {}
  const acked = new Set(acks || [])
  const alerts = {}
  for (const a of current) {
    const o = old[a.key]
    alerts[a.key] = { ...a, first_seen: o ? o.first_seen : nowMs, last_seen: nowMs, acked: !!(o && o.acked) || acked.has(a.key) || acked.has('*') }
  }
  const gone = Object.values(old).filter((o) => !alerts[o.key]).map((o) => ({ key: o.key, kind: o.kind, what: o.what, title: o.title, at: nowMs }))
  const fresh = current.filter((a) => !old[a.key])
  const resolved = [...gone, ...((prev && prev.resolved) || [])].slice(0, keepResolved)
  return { alerts, fresh, gone, resolved }
}

// Rate limit: may we send `channel` for `key` now? sent = {channel: {key: lastMs}}.
export function due(sent, channel, key, nowMs, repeatH) {
  const last = ((sent || {})[channel] || {})[key]
  return !last || nowMs - last >= repeatH * 3600000
}

export function markSent(sent, channel, keys, nowMs, keepH = 72) {
  const out = { ...(sent || {}) }
  const ch = {}
  for (const [k, t] of Object.entries(out[channel] || {})) if (nowMs - t < keepH * 3600000) ch[k] = t
  for (const k of keys) ch[k] = nowMs
  out[channel] = ch
  return out
}

// Token budget over the last hour: spent = [{at, tokens}].
export function budgetLeft(spent, perHour, nowMs) {
  const used = (spent || []).filter((x) => nowMs - x.at < 3600000).reduce((s, x) => s + (x.tokens || 0), 0)
  return Math.max(0, (perHour || 0) - used)
}

export function pruneSpent(spent, nowMs) {
  return (spent || []).filter((x) => nowMs - x.at < 3600000)
}

// What one tour should send/do for its alerts, given mode, quiet hours and what was already sent.
export function plan(alerts, fresh, cfg, state, nowMs, date = new Date(nowMs)) {
  const mode = modeOf(cfg)
  const quiet = inQuietHours(cfg.quiet_hours, date)
  const freshKeys = new Set(fresh.map((a) => a.key))
  const live = alerts.filter((a) => !a.acked)
  const notify = []
  for (const a of live) {
    if (!freshKeys.has(a.key)) continue
    if (a.julian && (may(cfg, 'notify', mode) || may(cfg, 'notify_julian', mode))) notify.push(a)
    else if (!a.julian && may(cfg, 'notify', mode) && !quiet) notify.push(a)
  }
  const mailRepeat = (cfg.mail && cfg.mail.repeat_h) || 6
  const mail = may(cfg, 'mail', mode) ? live.filter((a) => a.julian && due(state.sent, 'mail', a.key, nowMs, mailRepeat)) : []
  const pushRepeat = (cfg.push && cfg.push.repeat_h) || 6
  const push = may(cfg, 'push_claude', mode) ? live.filter((a) => a.julian && due(state.sent, 'push', a.key, nowMs, pushRepeat)) : []
  return { mode: mode.name, quiet, notify, mail, push }
}

// ---- merge eligibility (strict; incident A4: skipped / cancelled / 0-job pipelines never merge) ---------------------

export function repoAllowed(repo, patterns) {
  const r = String(repo || '').toLowerCase()
  return (patterns || []).some((p) => {
    const q = String(p).toLowerCase()
    return q.endsWith('/*') ? r.startsWith(q.slice(0, -1)) && r.length > q.length - 1 : r === q
  })
}

function hasMarker(text, labels, markers) {
  const t = String(text || '').toLowerCase()
  const ls = (labels || []).map((l) => String(l || '').toLowerCase())
  return (markers || []).some((m) => { const k = m.toLowerCase(); return ls.includes(k) || t.includes(`[${k}]`) || t.startsWith(`${k}:`) || t.startsWith(`${k} `) })
}

// GitHub: `gh pr view --json state,isDraft,mergeable,headRefOid,baseRefName,statusCheckRollup,labels,title` + compare.
// Every check must be SUCCESS (check runs: status COMPLETED and conclusion SUCCESS; status contexts: state SUCCESS).
export function ghEligible(pr, compare, ctx) {
  const why = []
  if (!pr || typeof pr !== 'object') return { ok: false, why: ['PR illisible'] }
  if (String(pr.state).toUpperCase() !== 'OPEN') why.push(`état ${pr.state}`)
  if (pr.isDraft) why.push('brouillon')
  if (pr.mergeable !== 'MERGEABLE') why.push(`mergeable=${pr.mergeable || '?'}`)
  const checks = pr.statusCheckRollup || []
  if (!checks.length) why.push('aucun check (rien n’a tourné)')
  for (const c of checks) {
    const isRun = c.__typename === 'CheckRun' || 'conclusion' in c || 'status' in c && !('state' in c)
    const v = String(isRun ? c.conclusion || '' : c.state || '').toUpperCase()
    if (isRun && String(c.status || 'COMPLETED').toUpperCase() !== 'COMPLETED') why.push(`${c.name || c.context || 'check'} en cours`)
    else if (v !== 'SUCCESS') why.push(`${c.name || c.context || 'check'} ${v ? v.toLowerCase() : 'sans résultat'}`)
  }
  if (!compare || typeof compare.behind_by !== 'number') why.push('retard sur la base inconnu')
  else if (compare.behind_by > 0) why.push(`en retard de ${compare.behind_by} commit(s) sur ${pr.baseRefName || 'la base'}`)
  common(pr.headRefOid, pr.title, (pr.labels || []).map((l) => l.name), ctx, why)
  return { ok: !why.length, why, sha: pr.headRefOid }
}

// GitLab: MR (include_diverged_commits_count=true) + the head pipeline's jobs. Every job must be success.
export function glEligible(mr, jobs, ctx) {
  const why = []
  if (!mr || typeof mr !== 'object') return { ok: false, why: ['MR illisible'] }
  if (mr.state !== 'opened') why.push(`état ${mr.state}`)
  if (mr.draft || mr.work_in_progress) why.push('brouillon')
  if (mr.has_conflicts) why.push('conflit')
  if (typeof mr.diverged_commits_count !== 'number') why.push('retard sur la base inconnu')
  else if (mr.diverged_commits_count > 0) why.push(`en retard de ${mr.diverged_commits_count} commit(s) sur ${mr.target_branch || 'la base'}`)
  const p = mr.head_pipeline
  if (!p) why.push('aucun pipeline')
  else {
    if (p.status !== 'success') why.push(`pipeline ${p.status}`)
    if (p.sha && mr.sha && p.sha !== mr.sha) why.push('pipeline d’un autre commit')
    if (!Array.isArray(jobs) || !jobs.length) why.push('pipeline sans job (rien n’a tourné)')
    else for (const j of jobs) if (j.status !== 'success') why.push(`job ${j.name} ${j.status}`)
  }
  common(mr.sha, mr.title, mr.labels, ctx, why)
  return { ok: !why.length, why, sha: mr.sha, manual: Array.isArray(jobs) && jobs.some((j) => j.status === 'manual') }
}

// Shared conditions: allow-list on the base repo, markers, head stable for stable_min, owner conversation not live.
function common(sha, title, labels, ctx, why) {
  const c = ctx || {}
  const m = c.merge || {}
  if (!repoAllowed(c.repo, m.repos)) why.push(`dépôt ${c.repo} hors liste merge.repos`)
  if (hasMarker(title, labels, m.markers)) why.push('marqué « ne pas merger »')
  const seen = c.seen
  if (!seen || seen.sha !== sha) why.push('tête jamais vue à un tour précédent')
  else if (c.now - seen.since < (m.stable_min || 30) * 60000) why.push(`tête stable depuis moins de ${m.stable_min || 30} min`)
  if (c.ownerLive) why.push('la conversation propriétaire travaille (elle merge elle-même)')
}

// Candidates for the script's merge: factory review rows that are green, not conflicting, in the allow-list.
export function mergeCandidates(scan, cfg) {
  const items = (scan && scan.reviews && scan.reviews.items) || []
  return items.filter((r) => r.ci === 'success' && !r.conflict && repoAllowed(r.repo, (cfg.merge || {}).repos))
}

// Is the conversation that owns this PR/MR live (worked in the last few minutes)?
export function ownerOf(scan, url) {
  const u = normUrl(url)
  return ((scan && scan.sessions) || []).find((s) => [s.pr && s.pr.url, ...(s.app_prs || []).map((p) => p.url)].some((x) => x && normUrl(x) === u)) || null
}

// ---- wake -------------------------------------------------------------------------------------------------------------

export function wakeTarget(alert, scan, cfg) {
  const coord = cfg.coordinator_session || null
  const own = alert.cli ? ((scan && scan.sessions) || []).find((s) => s.cli === alert.cli) : null
  if ((cfg.wake || {}).target === 'owner' && own) return { cli: own.cli, cwd: own.cwd, title: titleOf(own), ctx: own.ctx, live: own.live, last: tsMs(own.last_activity) }
  if (!coord) return null
  const c = ((scan && scan.sessions) || []).find((s) => s.cli === coord || s.sid === coord)
  return c ? { cli: c.cli, cwd: c.cwd, title: titleOf(c), ctx: c.ctx, live: c.live, last: tsMs(c.last_activity) } : { cli: coord, cwd: cfg.coordinator_cwd || null, title: 'coordinateur', ctx: null, live: false, last: null }
}

// Should this alert wake someone now? Returns {ok, why, target, tokens}.
export function wakeDecision(alert, scan, cfg, state, nowMs) {
  const W = cfg.wake || {}
  if (!may(cfg, 'wake')) return { ok: false, why: 'mode ou wake.enabled' }
  if (alert.acked) return { ok: false, why: 'ack' }
  if (!(W.kinds || []).includes(alert.kind)) return { ok: false, why: `type ${alert.kind} non réveillé` }
  const t = wakeTarget(alert, scan, cfg)
  if (!t || !t.cli) return { ok: false, why: 'aucun coordinateur enregistré (/veille coordinateur)' }
  if (!t.cwd) return { ok: false, why: 'dossier de la conversation inconnu' }
  if (t.live || (t.last && nowMs - t.last < (W.min_idle_min || 5) * 60000)) return { ok: false, why: 'conversation active : pas de réveil' }
  const hist = ((state.wakes || {})[alert.key] || []).filter((x) => nowMs - x < (W.max_per_row_window_h || 12) * 3600000)
  if (hist.length >= (W.max_per_row || 2)) return { ok: false, why: 'exhausted', target: t }
  if (hist.length && nowMs - Math.max(...hist) < (W.row_repeat_h || 2) * 3600000) return { ok: false, why: 'déjà réveillé récemment' }
  const tokens = t.ctx || W.est_tokens_default || 300000
  const left = budgetLeft(state.spent, modeOf(cfg).claude_tokens_per_hour, nowMs)
  if (tokens > left) return { ok: false, why: `budget atteint (${left} tokens restants cette heure)` }
  return { ok: true, target: t, tokens }
}

// ≤ 10 lines: what, who, since, what the mode allows, the hard limits, how to ack.
export function brief(alert, cfg, nowMs, ackCmd) {
  const mode = modeOf(cfg)
  const can = mode.may.filter((a) => a !== 'alert').map((a) => ((cfg.labels || {}).may_names || {})[a] || a).join(', ')
  const lines = [
    `[Veille ${mode.name}] ${new Date(nowMs).toISOString().slice(0, 16).replace('T', ' ')} UTC : action demandée.`,
    `Alerte : ${alert.what}`,
    alert.title ? `Conversation : ${alert.title}${alert.cli ? ` (${alert.cli})` : ''}` : null,
    alert.link ? `Lien : ${alert.link}` : null,
    `Depuis : ${age(nowMs - (alert.since || nowMs))}`,
    `Le mode permet : ${can || 'rien'}. Règles déjà accordées seulement (merge si tout est success et à jour).`,
    'Interdit : tuer ou supprimer une session, force-push, changer modèle/effort/permissions d’une autre session.',
    'Si Julian doit décider : PushNotification puis arrête-toi.',
    `Quand c’est réglé : ${ackCmd} ${alert.key}`,
  ].filter(Boolean)
  return lines.slice(0, 10).join('\n')
}

export function prText(r) {
  return `${prLabel(r)} ${r.title || ''}`.trim()
}

// ---- secrets: nothing that looks like a secret leaves through events, output or errors ---------------------------------

const SECRET_RE = [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bglpat-[A-Za-z0-9_-]{16,}/g, /\bsk-ant-[A-Za-z0-9_-]{16,}/g, /\b(?:AUTH\s+(?:LOGIN|PLAIN)\s+)[A-Za-z0-9+/=]+/gi]

export function scrub(text, secrets = []) {
  let t = String(text ?? '')
  for (const s of secrets.filter((x) => x && String(x).length >= 4)) {
    for (const v of [String(s), Buffer.from(String(s)).toString('base64')]) t = t.split(v).join('***')
  }
  for (const re of SECRET_RE) t = t.replace(re, '***')
  return t
}
