// export-eta - reads the conversations of this PC: the desktop app's session files (title, model, effort, state,
// spawnedFrom parent, PRs) joined to the CLI transcripts under ~/.claude/projects. Same sources as factory's scanner,
// read with Node only (no Python, no network). Read-only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { projectOf, stateOf, STATE_LABEL } from '../lib/layout.mjs'
import { appDir as coreAppDir } from '../lib/core/sessions.mjs'

// The app's session folder: one finder for every mod (lib/core/sessions.mjs, Claude-Data first since 19 Oct).
export const appDir = (cfg = {}) => coreAppDir(cfg)

export function projectsDir(cfg = {}) {
  return cfg.projects_dir || path.join(os.homedir(), '.claude', 'projects')
}

const folderFor = (cwd) => String(cwd || '').replace(/[^A-Za-z0-9]/g, '-')

function* walk(dir, depth) {
  let list = []
  try { list = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of list) {
    const p = path.join(dir, e.name)
    if (e.isDirectory() && depth > 0) yield* walk(p, depth - 1)
    else if (e.isFile() && /^local_.*\.json$/.test(e.name)) yield p
  }
}

export function transcriptOf(cli, cwd, cfg = {}) {
  const root = projectsDir(cfg)
  const p = path.join(root, folderFor(cwd), `${cli}.jsonl`)
  if (fs.existsSync(p)) return p
  try {
    for (const d of fs.readdirSync(root)) {
      const q = path.join(root, d, `${cli}.jsonl`)
      if (fs.existsSync(q)) return q
    }
  } catch { /* no projects folder */ }
  return null
}

/** Every desktop session with a transcript: slim rows (no messages). */
export function listSessions(cfg = {}, nowMs = Date.now()) {
  const out = []
  for (const f of walk(appDir(cfg), 2)) {
    let j
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { continue }
    if (!j.cliSessionId) continue
    const transcript = transcriptOf(j.cliSessionId, j.cwd, cfg)
    if (!transcript) continue
    let mtime = 0
    try { mtime = fs.statSync(transcript).mtimeMs } catch { /* gone */ }
    const pts = j.postTurnSummary || {}
    const s = {
      cli: j.cliSessionId, sid: j.sessionId, title: j.title || '', cwd: j.cwd || '', origin: j.originCwd || j.cwd || '',
      branch: j.branch || '', model: j.model || '', effort: j.effort || '', created: Number(j.createdAt) || 0,
      last_activity: Number(j.lastActivityAt) || mtime, mtime, archived: !!j.isArchived,
      status_category: pts.status_category || '', status_detail: pts.status_detail || '',
      parent: (j.spawnedFrom || {}).sessionId || '', parent_title: (j.spawnedFrom || {}).title || '',
      prs: (Array.isArray(j.prs) ? j.prs : []).filter((p) => p && p.url).map((p) => ({ url: p.url, number: p.prNumber, repo: p.repo || '', state: String(p.state || '').toLowerCase() })),
      transcript,
    }
    s.project = projectOf(s)
    s.state = stateOf(s, cfg, nowMs)
    s.state_label = STATE_LABEL[s.state] || s.state
    out.push(s)
  }
  // children (spawnedFrom) for the header
  const bySid = new Map(out.map((s) => [s.sid, s]))
  for (const s of out) {
    if (s.parent && bySid.has(s.parent)) {
      const p = bySid.get(s.parent)
      ;(p.children = p.children || []).push({ sid: s.sid, cli: s.cli, title: s.title, state: s.state_label })
      if (!s.parent_title) s.parent_title = p.title
    }
  }
  return out.sort((a, b) => (b.last_activity || 0) - (a.last_activity || 0))
}

/** The transcript's lines, parsed; bad lines skipped. */
export function readTranscript(file) {
  const out = []
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return out }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* partial line */ }
  }
  return out
}
