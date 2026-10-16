// veille - builds ~/.claude/veille/archive.json (« À archiver ») from files only: every open session of the desktop app
// (whatever its age), its transcript's mtime and tail, and the mtime of its sub-agent and workflow files (background work).
// Node standard library, no network, no model call. Read-only except archive.json; it never archives a conversation.
//   node veille.mjs archiver     rebuild it now and print the list
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { archiveConfig, buildArchive } from '../lib/archive.mjs'
import { filConfig } from '../lib/fil.mjs'
import { appDir, tailMessage, transcriptPath } from './fil.mjs'

const subdirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)) } catch { return [] } }
const mtimeOf = (p) => { try { return fs.statSync(p).mtimeMs } catch { return 0 } }

// Every open session file. Two folder levels: <account>/<org>/local_<id>.json. `skip` ({file: mtime}) holds the archived
// ones seen before: unchanged since, they are not read again (parsing ~650 files took 3.7 s; the stat alone is cheap).
export function readAllSessions(app, skip = {}) {
  const out = []
  const archived = {}
  for (const a of subdirs(app)) for (const b of subdirs(a)) {
    let names = []
    try { names = fs.readdirSync(b).filter((n) => /^local_.*\.json$/.test(n)) } catch { continue }
    for (const n of names) {
      const p = path.join(b, n)
      const mt = mtimeOf(p)
      if (skip[p] && skip[p] === mt) { archived[p] = mt; continue }
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''))
        if (j && j.isArchived) archived[p] = mt
        else if (j && j.sessionId) out.push(j)
      } catch { /* being written: next time */ }
    }
  }
  out.archived = archived
  return out
}

// The latest write under <transcript dir>/<cli>/ (subagents/, workflows/, two levels): background work still writing.
export function backgroundAt(transcript) {
  if (!transcript) return 0
  const dir = transcript.replace(/\.jsonl$/, '')
  let best = 0
  const walk = (d, depth) => {
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (depth < 2 && e.name !== 'tool-results') walk(p, depth + 1) } else best = Math.max(best, mtimeOf(p))
    }
  }
  walk(dir, 0)
  return best
}

export function archiveRows({ app, projects, nowMs, idleH, tailKb, maxTailKb, skip = {} }) {
  const rows = []
  const sessions = readAllSessions(app, skip)
  rows.archived = sessions.archived
  for (const j of sessions) {
    const tp = j.cliSessionId ? transcriptPath(projects, j.cliSessionId, j.cwd) : null
    const mtime = tp ? mtimeOf(tp) : 0
    const bg = backgroundAt(tp)
    const activity = Math.max(j.lastActivityAt || 0, j.latestUserFrameAt || 0, mtime, bg)
    const pts = j.postTurnSummary || {}
    // the tail is read only for what may be listed (idle long enough): the others are kept anyway
    const msg = tp && nowMs - activity >= idleH * 3600000 ? tailMessage(tp, tailKb, maxTailKb) || {} : null
    rows.push({
      sid: j.sessionId, cli: j.cliSessionId || '', title: j.title || '', cwd: j.cwd || '', origin: j.originCwd || j.cwd || '',
      archived: !!j.isArchived, pinned: !!(j.isStarred || j.isPinned || j.pinned), exempt: !!j.autoArchiveExempt,
      last_activity: j.lastActivityAt || 0, activity, mtime,
      status_category: pts.status_category || '', needs_action: pts.needs_action || '', awaiting: !!j.interruptedAwaitingPerson,
      prs: (j.prs || []).filter((p) => p && p.url).map((p) => ({ url: p.url, state: p.state, prNumber: p.prNumber })), msg,
    })
  }
  return rows
}

export function archiveFromDisk(cfg, { app = appDir(), projects = path.join(os.homedir(), '.claude', 'projects'), nowMs = Date.now(), skip = {} } = {}) {
  const f = filConfig(cfg)
  const rows = archiveRows({ app, projects, nowMs, idleH: archiveConfig(cfg).idle_h, tailKb: f.tail_kb, maxTailKb: f.max_tail_kb, skip })
  const arch = buildArchive(rows, cfg, nowMs)
  Object.defineProperty(arch, 'skip', { value: rows.archived, enumerable: false })
  return arch
}

// Writes archive.json (atomic rename, retried while the pane reads it) and returns it.
// The archived files already seen go to archive_cache.json beside it.
export function writeArchive(cfg, file, opts = {}) {
  const t0 = Date.now()
  const cacheFile = file.replace(/\.json$/, '_cache.json')
  let skip = {}
  try { skip = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) || {} } catch { skip = {} }
  const arch = archiveFromDisk(cfg, { skip, ...opts })
  arch.duration_ms = Date.now() - t0
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try { fs.writeFileSync(cacheFile, JSON.stringify(arch.skip || {})) } catch { /* next time */ }
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(arch, null, 1))
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); break } catch (e) {
      if (i >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { fs.unlinkSync(tmp) } catch { /* gone */ } throw e }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1))
    }
  }
  return arch
}
