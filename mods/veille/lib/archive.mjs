// veille - « À archiver »: which finished conversations the VEILLE conversation may archive in one batch.
// Pure (no I/O): the watcher (watcher/archive.mjs) feeds it every open session of the desktop app and writes
// ~/.claude/veille/archive.json; the pane and `/veille archiver` read that file. Nothing here archives anything (a script
// cannot: archiving is the VEILLE conversation's archive_session call). Tested with node --test mods/veille/tests/fil.test.mjs.
import { julianSignal, filConfig, mask, projectOf } from './fil.mjs'

export const ARCHIVE_DEFAULTS = {
  idle_h: 6, // a candidate has had no activity (session file, transcript, sub-agent files) for at least N hours
  // role conversations are never candidates: an upper-case name then a number (« VEILLE 1 », « MODS 1 », « SUPERVISOR 2 »)
  role_pattern: "^[A-ZÀ-Ý][A-ZÀ-Ý0-9 &_'.-]*?\\s\\d+(?:\\s|$|[(:·-])",  keep_status: ['blocked'], // the app's postTurnSummary.status_category values that keep a conversation (blocked = waits)
  keep_newest_per_project: true, // the newest open conversation of each project stays, so every project stays in the sidebar
  max_list: 200,
  labels: {
    title: 'À archiver ({n})', copy_ids: 'Copier la liste des ids', copied: '{n} id(s) copié(s)',
    note: 'La conversation VEILLE les archive en un lot (archive_session) ; le script n’archive jamais.',
    none: 'Rien à archiver.', missing: 'archive.json absent : la tâche ClaudeVeille l’écrit au prochain passage.',
  },
}

export function archiveConfig(cfg) {
  const a = (cfg && cfg.archive) || {}
  return { ...ARCHIVE_DEFAULTS, ...a, labels: { ...ARCHIVE_DEFAULTS.labels, ...((a && a.labels) || {}) } }
}

const H = 3600000
const hours = (ms) => Math.max(0, Math.floor(ms / H))
export const ageText = (ms) => (ms >= 48 * H ? `${Math.floor(ms / (24 * H))} j` : `${hours(ms)} h`)

function roleRe(p) {
  try { return p ? new RegExp(p) : null } catch { return null }
}

const prNum = (p) => p.prNumber || (String(p.url || '').match(/(?:pull|merge_requests)\/(\d+)/) || [])[1] || '?'
const OPEN = /^(open|opened|draft)$/i

// rows: one per desktop-app session {sid, cli, title, cwd, origin, archived, pinned, exempt, last_activity (ms),
// activity (ms: the latest of the session file, its transcript and its sub-agent files), status_category, needs_action,
// awaiting, prs:[{url,state,prNumber}], msg: lastMessage(...) or null, mtime (transcript ms)}.
// Returns {candidates, kept: {reason: n}, open}. Every rule that keeps a conversation wins over every rule that lists it.
export function archiveCandidates(rows, cfg, nowMs) {
  const A = archiveConfig(cfg)
  const f = filConfig(cfg)
  const role = roleRe(A.role_pattern)
  const open = (rows || []).filter((r) => r && r.sid && !r.archived)
  const at = (r) => Math.max(r.activity || 0, r.last_activity || 0, r.mtime || 0)
  // the newest open conversation per project (the sidebar groups by the folder the conversation was started in)
  const newest = new Map()
  for (const r of open) {
    const p = projectOf(r.origin || r.cwd)
    if (!newest.has(p) || at(r) > at(newest.get(p))) newest.set(p, r)
  }
  const kept = { pinned: 0, role: 0, newest: 0, active: 0, julian: 0, status: 0, open_pr: 0, running: 0 }
  const out = []
  for (const r of open) {
    const project = projectOf(r.origin || r.cwd)
    const idle = nowMs - at(r)
    const prs = (r.prs || []).filter((p) => p && p.url)
    const m = r.msg || {}
    let why = ''
    if (r.pinned || r.exempt) why = 'pinned'
    else if (role && role.test(String(r.title || '').trim())) why = 'role'
    else if (A.keep_newest_per_project && newest.get(project) === r) why = 'newest'
    else if (idle < A.idle_h * H) why = 'active'
    else if (julianSignal(r, m, nowMs, f) || r.awaiting || String(r.needs_action || '').trim()) why = 'julian'
    else if ((A.keep_status || []).includes(r.status_category)) why = 'status'
    else if (prs.some((p) => OPEN.test(String(p.state || '')))) why = 'open_pr'
    else if (m.pending_tool) why = 'running' // a tool call with no result: the turn did not end
    if (why) { kept[why]++; continue }
    const last = prs[prs.length - 1]
    const pr = last ? `PR #${prNum(last)} ${/^merged$/i.test(last.state) ? 'mergée' : /^closed$/i.test(last.state) ? 'fermée' : String(last.state || '').toLowerCase()}` : 'pas de PR'
    const done = r.status_category === 'completed' ? 'terminée' : r.status_category ? r.status_category : 'tour fini'
    out.push({
      sid: r.sid, cli: r.cli || '', title: mask(r.title || '(sans titre)'), project, last_at: at(r), idle_h: hours(idle),
      reason: `${pr}, ${done}, inactive ${ageText(idle)}`, pr: last ? { url: last.url, state: String(last.state || '').toLowerCase() } : null,
    })
  }
  out.sort((a, b) => a.last_at - b.last_at) // the oldest first
  return { candidates: out.slice(0, A.max_list), kept, open: open.length }
}

export function buildArchive(rows, cfg, nowMs) {
  const A = archiveConfig(cfg)
  const r = archiveCandidates(rows, cfg, nowMs)
  return { v: 1, generated: nowMs, idle_h: A.idle_h, open: r.open, count: r.candidates.length, kept: r.kept, candidates: r.candidates }
}

// The ids, one per line (what « Copier la liste des ids » copies and what the VEILLE conversation passes to archive_session).
export const archiveIds = (arch) => ((arch && arch.candidates) || []).map((c) => c.sid).join('\n')

// `/veille archiver` and the terminal render: a header, then one line per candidate.
export function archiveText(arch, nowMs = Date.now()) {
  if (!arch) return ['archive.json absent : la veille ne l’a pas encore écrit (node veille.mjs archiver)']
  const c = arch.candidates || []
  const head = `À archiver : ${c.length} sur ${arch.open} conversation(s) ouvertes (inactives ≥ ${arch.idle_h} h), calculé il y a ${ageText(Math.max(0, nowMs - (arch.generated || nowMs)))}`
  const lines = [head]
  for (const x of c) lines.push(`- ${x.title} · ${x.project} · ${x.reason} · ${x.sid}`)
  if (!c.length) lines.push('Rien à archiver.')
  else lines.push('Archivage : la conversation VEILLE appelle archive_session pour chaque id, en un lot ; le script n’archive jamais.')
  return lines
}
