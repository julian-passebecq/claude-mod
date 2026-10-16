// Canonical copy: lib/core/sessions.mjs (repo root). Every mods/<mod>/lib/core/sessions.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// The desktop app's session files (claude-code-sessions/**/local_*.json): title, cwd, model, effort, state,
// spawnedFrom parent, PRs. Same fields as export-eta/exporter/sessions.mjs and cockpit's nav (sid, parent). Read-only;
// parseSession is pure, the readers touch only the app's folder.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The app's session folder: %APPDATA%/Claude/claude-code-sessions, or the Microsoft Store package's LocalCache. */
export function appDir(cfg = {}, env = process.env) {
  if (cfg.app_dir) return cfg.app_dir
  const roaming = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const plain = path.join(roaming, 'Claude', 'claude-code-sessions')
  if (fs.existsSync(plain)) return plain
  const pk = path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Packages')
  try {
    for (const d of fs.readdirSync(pk).filter((x) => x.startsWith('Claude_')).sort()) {
      const p = path.join(pk, d, 'LocalCache', 'Roaming', 'Claude', 'claude-code-sessions')
      if (fs.existsSync(p)) return p
    }
  } catch { /* no packages folder */ }
  return plain
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
