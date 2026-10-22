// Canonical copy: lib/core/sessions.mjs (repo root). Every mods/<mod>/lib/core/sessions.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// The desktop app's session files (claude-code-sessions/**/local_*.json): title, cwd, model, effort, state,
// spawnedFrom parent, PRs. Same fields as export-eta/exporter/sessions.mjs and cockpit's nav (sid, parent). Read-only;
// parseSession is pure, the readers touch only the app's folder.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The app's session folder. Order: cfg.app_dir; %LOCALAPPDATA%/Claude-Data/<profile>/claude-code-sessions (the app
 *  moved its data there on 19 Oct; with several profiles, the one named by the ".user-data-left.<profile>" marker in
 *  %APPDATA%/Claude, else the most recently modified); the old %APPDATA%/Claude/claude-code-sessions; the Microsoft
 *  Store package's LocalCache. Every reader of the session files goes through this. */
export function appDir(cfg = {}, env = process.env) {
  if (cfg && cfg.app_dir) return cfg.app_dir
  const roaming = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const data = dataDir(local, roaming)
  if (data) return data
  const plain = path.join(roaming, 'Claude', 'claude-code-sessions')
  if (fs.existsSync(plain)) return plain
  const pk = path.join(local, 'Packages')
  try {
    for (const d of fs.readdirSync(pk).filter((x) => x.startsWith('Claude_')).sort()) {
      const p = path.join(pk, d, 'LocalCache', 'Roaming', 'Claude', 'claude-code-sessions')
      if (fs.existsSync(p)) return p
    }
  } catch { /* no packages folder */ }
  return plain
}

/** %LOCALAPPDATA%/Claude-Data/<profile>/claude-code-sessions, or null. Several profiles: the marker's, else the newest. */
export function dataDir(local, roaming) {
  const base = path.join(local, 'Claude-Data')
  let found = []
  try {
    found = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, dir: path.join(base, e.name, 'claude-code-sessions') }))
      .filter((x) => fs.existsSync(x.dir))
  } catch { return null }
  if (!found.length) return null
  if (found.length === 1) return found[0].dir
  let marked = []
  try {
    marked = fs.readdirSync(path.join(roaming, 'Claude')).filter((n) => n.startsWith('.user-data-left.')).map((n) => n.slice('.user-data-left.'.length))
  } catch { /* no marker */ }
  const hit = found.find((x) => marked.includes(x.name))
  if (hit) return hit.dir
  const mtime = (p) => { try { return fs.statSync(p).mtimeMs } catch { return 0 } }
  return found.sort((a, b) => mtime(b.dir) - mtime(a.dir) || a.name.localeCompare(b.name))[0].dir
}

/** local_*.json files under `dir`, `depth` folders deep. */
export function sessionFiles(dir, depth = 2) {
  const out = []
  const walk = (d, left) => {
    let list = []
    try { list = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of list) {
      const p = path.join(d, e.name)
      if (e.isDirectory() && left > 0) walk(p, left - 1)
      else if (e.isFile() && /^local_.*\.json$/.test(e.name)) out.push(p)
    }
  }
  walk(dir, depth)
  return out
}

/** Repo name of a cwd, worktrees folded into their repo (D:/x/repo/.claude/worktrees/a -> repo). */
export function repoOfCwd(cwd) {
  const p = String(cwd || '').replace(/\\/g, '/')
  const i = p.search(/\/\.claude\/worktrees\/|\/\.worktrees\//)
  return (i >= 0 ? p.slice(0, i) : p).split('/').filter(Boolean).pop() || '?'
}

/** One session file's JSON -> slim row (no messages), or null when it has no CLI session id. */
export function parseSession(j) {
  if (!j || typeof j !== 'object' || !j.cliSessionId) return null
  const pts = j.postTurnSummary || {}
  const from = j.spawnedFrom || {}
  return {
    cli: j.cliSessionId, sid: j.sessionId || '', title: j.title || '', cwd: j.cwd || '', origin: j.originCwd || j.cwd || '',
    repo: repoOfCwd(j.originCwd || j.cwd), branch: j.branch || '', model: j.model || '', effort: j.effort || '',
    created: Number(j.createdAt) || 0, last_activity: Number(j.lastActivityAt) || 0, archived: !!j.isArchived,
    status_category: pts.status_category || '', status_detail: pts.status_detail || '',
    parent: from.sessionId || '', parent_title: from.title || '',
    prs: (Array.isArray(j.prs) ? j.prs : []).filter((p) => p && p.url)
      .map((p) => ({ url: p.url, number: p.prNumber, repo: p.repo || '', state: String(p.state || '').toLowerCase() })),
  }
}

/** Links children to parents (spawnedFrom): fills parent_title and each parent's children [{sid, cli, title}]. */
export function linkChildren(rows) {
  const bySid = new Map(rows.filter((s) => s.sid).map((s) => [s.sid, s]))
  for (const s of rows) {
    const p = s.parent && bySid.get(s.parent)
    if (!p) continue
    ;(p.children = p.children || []).push({ sid: s.sid, cli: s.cli, title: s.title })
    if (!s.parent_title) s.parent_title = p.title
  }
  return rows
}

/** Every session of this PC, newest activity first. */
export function readSessions(cfg = {}, env = process.env) {
  const rows = []
  for (const f of sessionFiles(appDir(cfg, env), cfg.depth ?? 2)) {
    let j
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { continue }
    const s = parseSession(j)
    if (s) rows.push(s)
  }
  return linkChildren(rows).sort((a, b) => (b.last_activity || 0) - (a.last_activity || 0))
}

// ---- the cockpit's « Graphe des conversations » -------------------------------------------------------------------------
// ONLY these fields of a session file are kept (Julian, 17 Oct): ids, title, folders, archived / starred, times, model,
// effort, spawnedFrom.sessionId, peerReceipts[].targetSessionId + sentAt, interruptedAwaitingPerson, prs, branch. Never
// promptAppendSnapshot, remoteMcpServersConfig, sessionSettings or any other key.
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** One session file's JSON -> the graph's row (the whitelisted fields above), or null without a CLI session id. */
export function graphRow(j) {
  if (!j || typeof j !== 'object' || !j.cliSessionId) return null
  const cwd = String(j.cwd || '')
  const origin = String(j.originCwd || cwd)
  const peers = (Array.isArray(j.peerReceipts) ? j.peerReceipts : [])
    .filter((p) => p && p.targetSessionId)
    .map((p) => ({ target: String(p.targetSessionId), at: num(typeof p.sentAt === 'string' ? Date.parse(p.sentAt) : p.sentAt) }))
  return {
    sid: String(j.sessionId || ''), cli: String(j.cliSessionId), title: String(j.title || ''), cwd, origin,
    repo: repoOfCwd(origin), archived: Boolean(j.isArchived), starred: Boolean(j.isStarred),
    last_activity: num(j.lastActivityAt), created: num(j.createdAt), model: String(j.model || ''), effort: String(j.effort || ''),
    parent: String((j.spawnedFrom && j.spawnedFrom.sessionId) || ''), peers, awaiting: Boolean(j.interruptedAwaitingPerson),
    prs: (Array.isArray(j.prs) ? j.prs : []).filter((p) => p && typeof p === 'object')
      .map((p) => ({ number: p.prNumber, state: String(p.state || '').toLowerCase() })),
    branch: String(j.branch || ''),
  }
}

/** Every session of this PC as graph rows, newest activity first. */
export function readGraphRows(cfg = {}, env = process.env) {
  const rows = []
  for (const f of sessionFiles(appDir(cfg, env), cfg.depth ?? 2)) {
    let j
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { continue }
    const r = graphRow(j)
    if (r) rows.push(r)
  }
  return rows.sort((a, b) => b.last_activity - a.last_activity)
}
