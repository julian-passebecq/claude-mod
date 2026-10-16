// veille - builds the Fil digest (~/.claude/veille/fil.json) from files only: the desktop app's session files (title,
// model, effort, spawnedFrom, postTurnSummary, PRs) and the tail of each conversation's transcript (last assistant text,
// last wrap_up, pending AskUserQuestion). Node standard library, no network, no model call, nothing added to a prompt.
//   node veille.mjs fil      rebuild it now (the pane's « Rafraîchir » runs this)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildFil, filConfig, lastMessage } from '../lib/fil.mjs'

// The desktop app's session files: %APPDATA%\Claude\claude-code-sessions, or the Microsoft Store build's LocalCache.
export function appDir(env = process.env) {
  const a = path.join(env.APPDATA || '', 'Claude', 'claude-code-sessions')
  if (env.APPDATA && fs.existsSync(a)) return a
  const pk = path.join(env.LOCALAPPDATA || '', 'Packages')
  try {
    for (const d of fs.readdirSync(pk).filter((x) => x.startsWith('Claude_')).sort()) {
      const p = path.join(pk, d, 'LocalCache', 'Roaming', 'Claude', 'claude-code-sessions')
      if (fs.existsSync(p)) return p
    }
  } catch { /* no Packages folder */ }
  return a
}

const subdirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)) } catch { return [] } }

// Session files touched in the window (mtime), parsed. Two folder levels: <account>/<org>/local_<id>.json.
export function readSessions(app, hours, nowMs) {
  const out = []
  for (const a of subdirs(app)) for (const b of subdirs(a)) {
    let names = []
    try { names = fs.readdirSync(b).filter((n) => /^local_.*\.json$/.test(n)) } catch { continue }
    for (const n of names) {
      const p = path.join(b, n)
      try {
        if (nowMs - fs.statSync(p).mtimeMs > hours * 3600000 * 2) continue
        const j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''))
        if (j && j.sessionId && j.cliSessionId) out.push(j)
      } catch { /* being written: next time */ }
    }
  }
  return out
}

const folderFor = (cwd) => String(cwd || '').replace(/[^A-Za-z0-9]/g, '-')

export function transcriptPath(projects, cli, cwd) {
  const p = path.join(projects, folderFor(cwd), `${cli}.jsonl`)
  if (fs.existsSync(p)) return p
  for (const d of subdirs(projects)) { const q = path.join(d, `${cli}.jsonl`); if (fs.existsSync(q)) return q }
  return null
}

function parseLines(buf, fromStart) {
  const lines = buf.toString('utf8').split('\n')
  if (!fromStart) lines.shift() // a partial first line
  const out = []
  for (const l of lines) { if (!l.trim()) continue; try { out.push(JSON.parse(l)) } catch { /* partial last line */ } }
  return out
}

// The last message from the tail of a transcript; reads further back once when the tail held no assistant text.
export function tailMessage(file, kb = 512, maxKb = 4096) {
  let size = 0
  try { size = fs.statSync(file).size } catch { return null }
  for (const k of [kb, maxKb]) {
    const n = Math.min(size, k * 1024)
    const buf = Buffer.alloc(n)
    const fd = fs.openSync(file, 'r')
    try { fs.readSync(fd, buf, 0, n, size - n) } finally { fs.closeSync(fd) }
    const m = lastMessage(parseLines(buf, n === size))
    if (m.text || m.wrap || n === size) return m
  }
  return null
}

export function filRows({ app, projects, hours, nowMs, tailKb, maxTailKb }) {
  const rows = []
  for (const j of readSessions(app, hours, nowMs)) {
    const last = j.lastActivityAt || 0
    if (nowMs - last > hours * 3600000) continue
    const tp = transcriptPath(projects, j.cliSessionId, j.cwd)
    let mtime = 0
    try { mtime = tp ? fs.statSync(tp).mtimeMs : 0 } catch { mtime = 0 }
    const pts = j.postTurnSummary || {}
    rows.push({
      sid: j.sessionId, cli: j.cliSessionId, title: j.title || '', cwd: j.cwd || '', origin: j.originCwd || j.cwd || '',
      model: j.model || '', effort: j.effort || '', archived: !!j.isArchived, last_activity: last, mtime,
      parent: (j.spawnedFrom || {}).sessionId || null, parent_title: (j.spawnedFrom || {}).title || '',
      status_category: pts.status_category || '', needs_action: pts.needs_action || '', awaiting: !!j.interruptedAwaitingPerson,
      prs: (j.prs || []).filter((p) => p && p.url).map((p) => ({ url: p.url, state: p.state })),
      msg: tp ? tailMessage(tp, tailKb, maxTailKb) || {} : {},
    })
  }
  return rows
}

export function buildFromDisk(cfg, { app = appDir(), projects = path.join(os.homedir(), '.claude', 'projects'), nowMs = Date.now() } = {}) {
  const f = filConfig(cfg)
  const rows = filRows({ app, projects, hours: f.hours, nowMs, tailKb: f.tail_kb, maxTailKb: f.max_tail_kb })
  return buildFil(rows, cfg, nowMs)
}

// Writes fil.json next to state.json (atomic rename) and returns the digest.
export function writeFil(cfg, file, opts = {}) {
  const t0 = Date.now()
  const fil = buildFromDisk(cfg, opts)
  fil.duration_ms = Date.now() - t0
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(fil))
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); break } catch (e) {
      if (i >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { fs.unlinkSync(tmp) } catch { /* gone */ } throw e }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1))
    }
  }
  return fil
}
