// Canonical copy: lib/core/running.mjs (repo root). Every mods/<mod>/lib/core/running.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// What runs NOW in ONE conversation: its Workflows (phase, agents) and its Agent-tool agents outside Workflows
// (background or foreground), read from the conversation's folder under ~/.claude/projects. Same file rules as
// factory's scanner/workflow_scan.py (journal.jsonl events, agent-<id>.meta.json, `export const meta` of the script,
// the run record workflows/<runId>.json written only when the run ends), in JS so a node mod can use it.
// Cheap: a file is re-read only when its size or mtime changed, transcripts from the byte offset where the last read
// stopped; `state` is the caller's cache object (JSON-serialisable, kept between runs). Read-only.
import fs from 'node:fs'
import path from 'node:path'

const TAIL_FIRST = 2 * 1024 * 1024
const HEAD = 16 * 1024

export const RUNNING_DEFAULTS = { stale_h: 6, stall_min: 30, failed_keep_min: 10, hist_every_s: 600, hist_days: 30, hist_max: 40 }

const st = (p) => {
  try {
    const s = fs.statSync(p)
    return { size: s.size, mtime: s.mtimeMs, dir: s.isDirectory() }
  } catch {
    return null
  }
}
const list = (d) => {
  try {
    return fs.readdirSync(d)
  } catch {
    return []
  }
}
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}
const isoMs = (ts) => {
  const t = typeof ts === 'number' ? ts : Date.parse(ts || '')
  return Number.isFinite(t) && t > 0 ? t : 0
}

/** The conversation's folder <root>/<project>/<session>, or '' (remembered in state.dir). */
export function sessionDir(root, session, state = {}) {
  if (!root || !session) return ''
  if (state.dir && state.dirOf === session && st(state.dir)?.dir) return state.dir
  for (const p of list(root)) {
    const d = path.join(root, p, session)
    if (st(d)?.dir) {
      state.dir = d
      state.dirOf = session
      return d
    }
  }
  return ''
}

/** A journal.jsonl event folded into {agents: {id: {label, phase, end}}, order}. Pure (same rules as workflow_scan.py). */
export function feedJournal(a, d) {
  if (!d || typeof d !== 'object' || d.type === 'launched') return a
  const id = d.agentId
  if (!id) return a
  let ag = a.agents[id]
  if (!ag) {
    ag = a.agents[id] = { label: '', phase: '', end: '' }
    a.order.push(id)
  }
  if (d.type === 'started') {
    ag.label = d.label || ag.label
    ag.phase = d.phase || ag.phase
  } else if (d.type === 'result') ag.end = 'done'
  else if (d.type === 'failed') ag.end = 'failed'
  return a
}

/** One transcript line folded into {first, last, model, stop, error}. Pure. */
export function feedAgent(a, d) {
  if (!d || typeof d !== 'object') return a
  const t = isoMs(d.timestamp)
  if (t) {
    if (!a.first) a.first = t
    a.last = Math.max(a.last || 0, t)
  }
  if (d.type === 'assistant' && d.message) {
    if (d.message.model && d.message.model !== '<synthetic>') a.model = d.message.model
    a.stop = d.message.stop_reason || ''
    a.error = Boolean(d.isApiErrorMessage || d.error)
  } else if (d.type === 'user') {
    a.stop = ''
    a.error = false
  }
  return a
}

const strOf = (body, key) => {
  const m = new RegExp(key + '\\s*:\\s*([\'"`])((?:\\\\.|(?!\\1).)*)\\1', 's').exec(body)
  return m ? m[2] : ''
}

/** name and phase titles from a Workflow script's `export const meta = {...}` (string literals only, nothing runs). */
export function scriptMeta(src) {
  const s = String(src || '')
  const m = /export\s+const\s+meta\s*=\s*\{([\s\S]*?)\n\}/.exec(s)
  const body = m ? m[1] : s.slice(0, 4000)
  const phases = []
  const pm = /phases\s*:\s*\[([\s\S]*?)\]/.exec(body)
  if (pm) for (const it of pm[1].match(/\{[\s\S]*?\}/g) || []) {
    const t = strOf(it, 'title')
    if (t) phases.push(t)
  }
  return { name: strOf(body, 'name'), phases }
}

// Reads the lines appended to `file` since state.files[file] and folds them with `feed`. Returns the aggregate.
function tail(state, file, init, feed) {
  const s = st(file)
  let e = state.files[file]
  if (!s) return e ? e.agg : init()
  if (e && e.size === s.size && e.mtime === s.mtime) return e.agg
  if (!e || s.size < e.off) {
    e = { off: 0, agg: init() }
    if (s.size > TAIL_FIRST) {
      // big transcript seen for the first time: its first lines (start time) and its last 2 MB
      const head = readRange(file, 0, Math.min(HEAD, s.size))
      const nl = head.indexOf('\n')
      if (nl > 0) try { feed(e.agg, JSON.parse(head.slice(0, nl))) } catch { /* partial */ }
      e.off = s.size - TAIL_FIRST
      e.skip = true
    }
  }
  if (s.size > e.off) {
    let text = readRange(file, e.off, s.size - e.off)
    let start = 0
    if (e.skip) {
      start = text.indexOf('\n') + 1
      e.skip = false
    }
    const cut = text.lastIndexOf('\n')
    if (cut >= start) {
      for (const line of text.slice(start, cut).split('\n')) {
        if (!line.trim()) continue
        try { feed(e.agg, JSON.parse(line)) } catch { /* not JSON */ }
      }
      e.off += Buffer.byteLength(text.slice(0, cut + 1), 'utf8')
    }
  }
  e.size = s.size
  e.mtime = s.mtime
  state.files[file] = e
  return e.agg
}

function readRange(file, off, len) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(len)
    const n = fs.readSync(fd, buf, 0, len, off)
    return buf.subarray(0, n).toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

// A small JSON file (meta, record), re-parsed only when its mtime changed; `slim` keeps what is needed.
function cachedJson(state, file, slim = (x) => x) {
  const s = st(file)
  if (!s) return null
  const e = state.json[file]
  if (e && e.mtime === s.mtime) return e.data
  const data = slim(readJson(file))
  state.json[file] = { mtime: s.mtime, data }
  return data
}

const slimRecord = (w) => (w && typeof w === 'object' ? { status: w.status || '', name: w.workflowName || '', start: isoMs(w.startTime), ms: Number(w.durationMs) || 0 } : null)
const slimMeta = (m) => (m && typeof m === 'object' ? { type: m.agentType || '', label: m.description || '', phase: m.workflowPhase || '', model: m.model || '', shape: m.requestShape || '', finished: m.finished === true } : null)

/** An agent's state from its transcript: done (ended its turn), failed (API error), else running. */
const agentStatus = (ag, meta) => (meta?.finished ? 'done' : ag.error ? 'failed' : ag.stop === 'end_turn' ? 'done' : 'running')

/**
 * Durations (ms) of the past completed runs of Workflow `name` on this PC: scripts/<name>-<runId>.js names the runs,
 * workflows/<runId>.json holds the duration. Re-listed every hist_every_s per name.
 */
export function historyOf(root, name, state, now, cfg = RUNNING_DEFAULTS) {
  const h = (state.hist[name] ||= { at: 0, ms: [] })
  if (now - h.at < cfg.hist_every_s * 1000) return h.ms
  h.at = now
  const out = []
  const from = now - cfg.hist_days * 86400000
  const prefix = `${name}-`
  for (const p of list(root)) {
    for (const s of list(path.join(root, p))) {
      const wdir = path.join(root, p, s, 'workflows')
      for (const f of list(path.join(wdir, 'scripts'))) {
        if (!f.startsWith(prefix) || !f.endsWith('.js')) continue
        const rid = f.slice(prefix.length, -3)
        if (!/^wf_[\w-]+$/.test(rid)) continue
        const rec = cachedJson(state, path.join(wdir, `${rid}.json`), slimRecord)
        if (rec && rec.status === 'completed' && rec.ms > 0 && (rec.start || now) >= from) out.push(rec.ms)
      }
    }
  }
  h.ms = out.slice(-cfg.hist_max)
  return h.ms
}

/** A fresh cache object for readRunning. */
export const newRunningState = () => ({ v: 1, files: {}, json: {}, hist: {}, dir: '', dirOf: '' })

/**
 * What runs in conversation `session`: {dir, workflows: [...], agents: [...]} (finished ones left out, except failed
 * ones for failed_keep_min). workflows: {id, name, phases, phase, phaseIdx, status, start, last, stalled, agents:
 * [{id, label, type, model, status, start, last}], hist: [ms]}; agents: {id, label, type, model, shape, status, start,
 * last, stalled}. `state` is updated in place (newRunningState()).
 */
export function readRunning({ root, session, now = Date.now(), state, cfg = {} }) {
  const c = { ...RUNNING_DEFAULTS, ...cfg }
  if (!state || state.v !== 1) state = Object.assign(state || {}, newRunningState())
  const dir = sessionDir(root, session, state)
  const out = { dir, workflows: [], agents: [] }
  if (!dir) return out
  const staleMs = c.stale_h * 3600000
  const stallMs = c.stall_min * 60000
  const keepMs = c.failed_keep_min * 60000
  const touched = new Set()
  const keep = (f) => (touched.add(f), f)
  // Workflows of this conversation
  const wroot = path.join(dir, 'subagents', 'workflows')
  for (const rid of list(wroot)) {
    if (!rid.startsWith('wf_')) continue
    const d = path.join(wroot, rid)
    const recPath = path.join(dir, 'workflows', `${rid}.json`)
    const rs = st(recPath)
    const files = list(d)
    let moved = st(path.join(d, 'journal.jsonl'))?.mtime || 0
    for (const f of files) if (f.endsWith('.jsonl')) moved = Math.max(moved, st(path.join(d, f))?.mtime || 0)
    if (rs) {
      // finished: shown only when it failed within failed_keep_min
      const rec = cachedJson(state, keep(recPath), slimRecord)
      if (!rec || !['failed', 'error'].includes(rec.status) || now - rs.mtime > keepMs) continue
    } else if (now - moved > staleMs) continue
    const j = tail(state, keep(path.join(d, 'journal.jsonl')), () => ({ agents: {}, order: [] }), feedJournal)
    const script = list(path.join(dir, 'workflows', 'scripts')).find((f) => f.endsWith(`-${rid}.js`))
    const sp = script ? path.join(dir, 'workflows', 'scripts', script) : ''
    let meta = { name: '', phases: [] }
    if (sp) {
      const s = st(keep(sp))
      const e = state.json[sp]
      if (e && s && e.mtime === s.mtime) meta = e.data
      else if (s) {
        try { meta = scriptMeta(fs.readFileSync(sp, 'utf8')) } catch { /* unreadable */ }
        state.json[sp] = { mtime: s.mtime, data: meta }
      }
    }
    const ids = [...j.order]
    for (const f of files) {
      const m = /^agent-(.+)\.jsonl$/.exec(f)
      if (m && !ids.includes(m[1])) ids.push(m[1])
    }
    const status = rs ? 'failed' : 'running'
    const agents = []
    for (const id of ids) {
      const tp = path.join(d, `agent-${id}.jsonl`)
      const ag = tail(state, keep(tp), () => ({}), feedAgent)
      const am = cachedJson(state, keep(path.join(d, `agent-${id}.meta.json`)), slimMeta) || {}
      const jr = j.agents[id] || {}
      const s = jr.end === 'failed' ? 'failed' : jr.end === 'done' ? 'done' : status === 'running' ? 'running' : 'skipped'
      agents.push({
        id, label: jr.label || am.label || id, type: am.type || '', phase: jr.phase || am.phase || '',
        model: am.model || ag.model || '', status: s, start: ag.first || 0, last: Math.round(Math.max(ag.last || 0, st(tp)?.mtime || 0)),
      })
    }
    const live = agents.filter((a) => a.status === 'running')
    const cur = (live.length ? live : agents).map((a) => a.phase).filter(Boolean).pop() || ''
    const idx = meta.phases.indexOf(cur)
    const starts = agents.map((a) => a.start).filter(Boolean)
    const start = (sp && st(sp)?.mtime) || (starts.length ? Math.min(...starts) : moved)
    out.workflows.push({
      id: rid, name: meta.name || rid, phases: meta.phases, phase: cur, phaseIdx: idx, status, start: Math.round(start), last: Math.round(moved),
      stalled: status === 'running' && now - moved > stallMs, agents,
      hist: status === 'running' && meta.name ? historyOf(root, meta.name, state, now, c) : [],
    })
  }
  // Agent-tool agents outside Workflows
  const sdir = path.join(dir, 'subagents')
  for (const f of list(sdir)) {
    const m = /^agent-(.+)\.jsonl$/.exec(f)
    if (!m) continue
    const tp = path.join(sdir, f)
    const s = st(tp)
    if (!s || now - s.mtime > staleMs) continue
    const ag = tail(state, keep(tp), () => ({}), feedAgent)
    const am = cachedJson(state, keep(path.join(sdir, `agent-${m[1]}.meta.json`)), slimMeta) || {}
    const status = agentStatus(ag, am)
    if (status === 'done' || (status === 'failed' && now - s.mtime > keepMs)) continue
    const last = Math.max(ag.last || 0, s.mtime)
    out.agents.push({
      id: m[1], label: am.label || '', type: am.type || '', model: am.model || ag.model || '', shape: am.shape || '',
      status, start: ag.first || Math.round(s.mtime), last: Math.round(last), stalled: status === 'running' && now - last > stallMs,
    })
  }
  // forget files of this conversation no longer looked at (history records stay)
  for (const f of Object.keys(state.files)) if (!touched.has(f)) delete state.files[f]
  return out
}
