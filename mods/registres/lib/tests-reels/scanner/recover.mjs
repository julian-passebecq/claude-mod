#!/usr/bin/env node
// Recovery scan of the tests-reels mod: finds evidence of real (non-CI) tests in local transcripts, manual-checks.md,
// repos' handoff/ and reports/ files and extra folders, and writes ONLY data_dir/recovered.json (+ its cache).
// Secret values are never copied: only their kind, the session and the date are kept. Prints counts only.
//   node mods/tests-reels/scanner/recover.mjs [--force] [--data-dir <dir>]
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'
import { createInterface } from 'node:readline'

import { counts, addError, addHit, appFor, appFromCwd, appFromFolder, compile, extract, finalize, mergeAgg, newApp, parseManualLine } from '../lib/recover.mjs'
import { findSecrets } from '../lib/secrets.mjs'
import { expand, unset } from '../lib/registry.mjs'
import { loadConfig, paths, readJson, writeJson } from '../lib/io.mjs'

const argv = process.argv.slice(2)
const opt = n => (argv.includes(n) && argv[argv.indexOf(n) + 1]) || undefined
const FORCE = argv.includes('--force')
const { cfg, dataDir, E } = loadConfig(opt('--data-dir'))
const RC = cfg.recovery ?? {}
const P = compile(RC)
const LIM = { per_list: RC.per_list ?? 40, mentions: RC.mentions ?? 30 }
const MAX_RESULT = RC.max_result_chars ?? 20000
const P_ = paths(dataDir)
const LOGIC = 5 // bump when extraction changes: the per-file cache is then rebuilt
let cache = FORCE ? { files: {} } : readJson(P_.cache, { files: {} })
if (cache.logic !== LOGIC) cache = { files: {} }
cache.logic = LOGIC
cache.files ??= {}
const seen = new Set()
const titles = {}
const errors = []
const src = { transcripts: 0, transcripts_read: 0, docs: 0, manual: 0 }

const S = p => String(p).replace(/\\/g, '/')
const list = d => {
  try {
    return readdirSync(d, { withFileTypes: true })
  } catch {
    return []
  }
}
const statOf = p => {
  try {
    return statSync(p)
  } catch {
    return null
  }
}

function walk(dir, pred, depth = 8, out = []) {
  if (depth < 0) return out
  for (const d of list(dir)) {
    const p = join(dir, d.name)
    if (d.isDirectory()) {
      if (d.name === 'node_modules' || d.name === '.git') continue
      walk(p, pred, depth - 1, out)
    } else if (pred(p)) out.push(p)
  }
  return out
}

/** Cached per-file aggregate when size and mtime match; otherwise `read` builds it. */
async function perFile(p, read) {
  const st = statOf(p)
  if (!st) return null
  const key = S(p)
  seen.add(key)
  const c = cache.files[key]
  if (c && c.size === st.size && c.mtime === st.mtimeMs) {
    Object.assign(titles, c.titles ?? {})
    return c.agg
  }
  const local = { agg: {}, titles: {} }
  try {
    await read(local)
  } catch (err) {
    errors.push(`${basename(p)} : ${String(err?.message ?? err).slice(0, 120)}`)
  }
  for (const a of Object.values(local.agg)) for (const c2 of Object.values(a.commands ?? {})) delete c2.tool_ids
  cache.files[key] = { size: st.size, mtime: st.mtimeMs, agg: local.agg, titles: local.titles }
  Object.assign(titles, local.titles)
  return local.agg
}

const repoCache = new Map()
/** Repo name for a cwd: the nearest parent folder holding .git (a worktree counts as its repo), else the cwd's name. */
function repoOf(cwd) {
  if (!cwd) return ''
  if (repoCache.has(cwd)) return repoCache.get(cwd)
  let d = S(cwd).replace(/\/\.claude\/worktrees\/[^/]+.*$/, '')
  let name = ''
  for (let i = 0; i < 8 && d && isAbsolute(d) && !name; i++) {
    if (existsSync(join(d, '.git'))) name = basename(d)
    const up = S(dirname(d))
    if (up === d) break
    d = up
  }
  name ||= appFromCwd(cwd)
  repoCache.set(cwd, name)
  return name
}

const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => (typeof b === 'string' ? b : b?.text ?? '')).join('\n') : '')

/** One transcript (.jsonl): main session or subagent file. */
async function transcript(p, fallbackApp) {
  const parts = S(p).split('/')
  const i = parts.lastIndexOf('subagents')
  const fileSid = i > 0 ? parts[i - 1] : basename(p, '.jsonl')
  return perFile(p, async local => {
    src.transcripts_read++
    const rl = createInterface({ input: createReadStream(p, { encoding: 'utf8' }), crlfDelay: Infinity })
    let cwd = ''
    for await (const line of rl) {
      if (!line) continue
      if (line.includes('"custom-title"') || line.includes('"ai-title"')) {
        try {
          const d = JSON.parse(line)
          const t = d.customTitle || d.aiTitle
          if (t && (d.type === 'custom-title' || !local.titles[d.sessionId || fileSid])) local.titles[d.sessionId || fileSid] = String(t).slice(0, 120)
        } catch {}
        continue
      }
      const cat = P.any.test(line)
      const err = line.includes('"is_error":true')
      const sec = !cat && findSecrets(line.replace(/\\"/g, '"'))
      if (!cat && !err && !(sec && sec.length)) continue
      let d
      try {
        d = JSON.parse(line)
      } catch {
        continue
      }
      cwd = d.cwd || cwd
      const app0 = repoOf(cwd) || fallbackApp
      const ctx = { app: app0, session: d.sessionId || fileSid, title: undefined, date: d.timestamp || '' }
      if (!cat) {
        if (sec.length) addHit(local.agg, { cats: [], secrets: sec }, ctx, LIM)
      }
      const content = d.message?.content
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
      for (const b of blocks) {
        if (b?.type === 'tool_result') {
          if (b.is_error && b.tool_use_id) addError(local.agg, app0, b.tool_use_id)
          if (!cat) continue
          const t = textOf(b.content).slice(0, MAX_RESULT)
          const h = extract(t, 'result', P)
          if (h) addHit(local.agg, h, { ...ctx, app: appFor(t, app0, P) }, LIM)
        } else if (cat && b?.type === 'tool_use') {
          const inp = b.input ?? {}
          const cmd = typeof inp.command === 'string' ? inp.command : ''
          const t = cmd || JSON.stringify(inp).slice(0, MAX_RESULT)
          const h = extract(t, cmd ? 'command' : 'result', P)
          if (h) addHit(local.agg, h, { ...ctx, app: appFor(t, app0, P), toolId: b.id }, LIM)
        } else if (cat && b?.type === 'text') {
          const t = String(b.text || '').slice(0, MAX_RESULT)
          const h = extract(t, 'text', P)
          if (h) addHit(local.agg, h, { ...ctx, app: appFor(t, app0, P) }, LIM)
        }
      }
    }
  })
}

/** One document (handoff, report, audit file): each line is a passage; fenced or `$ ` lines are commands. */
async function doc(p, app, title) {
  const st = statOf(p)
  if (!st || st.size > (RC.max_doc_mb ?? 5) * 1048576) return null
  src.docs++
  return perFile(p, async local => {
    const text = readFileSync(p, 'utf8')
    const date = new Date(st.mtimeMs).toISOString()
    let fence = false
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*```/.test(line)) {
        fence = !fence
        continue
      }
      if (!line.trim()) continue
      const role = fence || /^\s*[$>]\s/.test(line) ? 'command' : 'text'
      const h = extract(line, role, P)
      if (h) addHit(local.agg, h, { app: appFor(line, app, P), session: `doc:${title}`, title, date }, LIM)
    }
    local.titles[`doc:${title}`] = title
  })
}

/** Simple globs: segments with * (e.g. handoff/*.md, reports/*\/*). */
function glob(root, pattern) {
  let cur = [root]
  const segs = pattern.split('/')
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1
    const rx = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i')
    const next = []
    for (const d of cur) for (const e of list(d)) if (rx.test(e.name) && (last ? e.isFile() : e.isDirectory())) next.push(join(d, e.name))
    cur = next
  })
  return cur
}

const total = {}
const sources = RC.sources ?? {}
const roots = k => (sources[k] ?? []).filter(x => !unset(x)).map(x => expand(x, E))
const DOC_EXT = new Set((RC.doc_ext ?? ['.md']).map(x => x.toLowerCase()))

// 1. transcripts
for (const r of roots('transcripts')) {
  for (const f of walk(r, p => p.endsWith('.jsonl'), 6)) {
    src.transcripts++
    const proj = S(relative(r, f)).split('/')[0] || ''
    mergeAgg(total, await transcript(f, appFromFolder(proj)), LIM)
  }
}
// 2. manual checks
for (const f of roots('manual_checks')) {
  let text = ''
  try {
    text = readFileSync(f, 'utf8')
  } catch {
    continue
  }
  for (const line of text.split(/\r?\n/)) {
    const m = parseManualLine(line)
    if (!m) continue
    src.manual++
    const app = appFor(line, m.app, P)
    ;(total[app] ?? (total[app] = newApp())).manual.push({ date: m.date, what: m.what, how: m.how, status: m.status, project: m.project })
  }
}
// 3. repos' handoff / reports
for (const r of roots('repo_roots')) {
  for (const repo of list(r)) {
    if (!repo.isDirectory() || repo.name.startsWith('.')) continue
    const rp = join(r, repo.name)
    for (const g of sources.repo_globs ?? []) {
      for (const f of glob(rp, g)) if (DOC_EXT.has(extname(f).toLowerCase())) mergeAgg(total, await doc(f, repo.name, `${repo.name}/${S(relative(rp, f))}`), LIM)
    }
  }
}
// 4. extra folders (e.g. an audit bundle): transcripts and documents, app guessed from the path
const known = Object.keys(total).filter(a => a.length > 2)
for (const r of roots('extra_roots')) {
  const label = basename(r)
  for (const f of walk(r, p => p.endsWith('.jsonl') || DOC_EXT.has(extname(p).toLowerCase()), 8)) {
    const segs = S(relative(r, f)).split('/')
    const app = segs.slice(0, -1).reverse().find(s => known.includes(s)) || label
    if (f.endsWith('.jsonl')) {
      src.transcripts++
      mergeAgg(total, await transcript(f, app), LIM)
    } else mergeAgg(total, await doc(f, app, `${label}/${segs.join('/')}`), LIM)
  }
}

for (const k of Object.keys(cache.files)) if (!seen.has(k)) delete cache.files[k]
const c = counts(total)
const apps = finalize(total, titles, LIM)
writeJson(P_.recovered, { generated: Date.now(), counts: c, sources: src, errors: errors.slice(0, 20), apps })
writeJson(P_.cache, cache)
process.stdout.write(JSON.stringify({ ok: true, counts: c, sources: src, errors: errors.length }) + '\n')
