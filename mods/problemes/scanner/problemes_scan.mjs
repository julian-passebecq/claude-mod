#!/usr/bin/env node
// problemes - collector and ledger CLI. Node 22+, standard library only, no model tokens.
//   node problemes_scan.mjs collect [--force]          read new transcript bytes and session files, append to the ledger
//   node problemes_scan.mjs import                     import the seed sources of the config (once per row)
//   node problemes_scan.mjs note <P-NNN> <text…>       append a note (what the pane's « Ajouter une note » runs)
//   node problemes_scan.mjs set <P-NNN> <field> <value…> [--fix <text>]   status | fix | cause | category | title
//   node problemes_scan.mjs add <category> <title…>    a problem by hand (status ouvert)
//   node problemes_scan.mjs fold                       rewrite the snapshot problems.json from the ledger
//   node problemes_scan.mjs status                     counts, paths, last collection
// Everything lives in data_dir (default ~/.claude/problemes): register.jsonl (append-only ledger), problems.json
// (snapshot the pane reads), cursor.json (byte offsets), problemes.config.json (your overrides and seed sources).
// Nothing outside data_dir is written, except the health record ~/.claude/mods-health/problemes.json.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  appOf, deepMerge, expand, fold, hitsOfRecord, hitsOfSession, isSet, nextId, parseLines, planLines, seedFromFindings,
  seedFromIncidents, seedFromMarkdown, seedLines, slash, STATUSES, totals,
} from '../lib/core.mjs'
import { writeHealth } from './health.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOD = path.resolve(HERE, '..')

const ENV = () => ({ ...process.env, HOME: slash(process.env.PROBLEMES_HOME_DIR || os.homedir()), USERPROFILE: slash(process.env.PROBLEMES_HOME_DIR || os.homedir()) })
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) } catch { return d } }

export function config(env = ENV()) {
  const base = readJson(path.join(MOD, 'problemes.config.json'), {})
  const dir = expand(env.PROBLEMES_DIR || base.data_dir || '~/.claude/problemes', env)
  const cfg = deepMerge(base, readJson(path.join(dir, 'problemes.config.json'), {}) || {})
  cfg.data_dir = dir
  cfg.env = env
  return cfg
}

export const paths = cfg => ({
  dir: cfg.data_dir, ledger: path.join(cfg.data_dir, 'register.jsonl'), snapshot: path.join(cfg.data_dir, 'problems.json'),
  cursor: path.join(cfg.data_dir, 'cursor.json'), lock: path.join(cfg.data_dir, 'lock'),
})

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data))
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return } catch (e) {
      if (i >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { fs.unlinkSync(tmp) } catch { /* gone */ } throw e }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1)) // the pane may be reading it
    }
  }
}

export function readLedger(cfg) {
  try { return parseLines(fs.readFileSync(paths(cfg).ledger, 'utf8')) } catch { return [] }
}

/** Appends ledger lines (one appendFileSync: a single write per batch). */
export function append(cfg, lines) {
  if (!lines.length) return
  fs.mkdirSync(paths(cfg).dir, { recursive: true })
  fs.appendFileSync(paths(cfg).ledger, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

/** The snapshot the pane reads: folded problems + the last collection's figures. */
export function snapshot(cfg, stats = undefined, now = Date.now()) {
  const problems = fold(readLedger(cfg), cfg.timeline_max ?? 60)
  const prev = readJson(paths(cfg).snapshot, {}) || {}
  const snap = { v: 1, generated: now, collected: stats ? now : prev.collected ?? 0, stats: stats ?? prev.stats ?? null, totals: totals(problems, now), problems }
  writeAtomic(paths(cfg).snapshot, snap)
  return snap
}

// ---- lock: one writer at a time (pane, veille and a manual run can overlap) ---------------------------------------------

function alive(pid) { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
function takeLock(cfg, ttlMs) {
  const f = paths(cfg).lock
  fs.mkdirSync(path.dirname(f), { recursive: true })
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(f, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' }); return true } catch {
      const l = readJson(f, {})
      if (l && l.pid && alive(l.pid) && Date.now() - (l.at || 0) < ttlMs) return false
      try { fs.unlinkSync(f) } catch { /* raced */ }
    }
  }
  return false
}
const dropLock = cfg => { try { const l = readJson(paths(cfg).lock, {}); if (l && l.pid === process.pid) fs.unlinkSync(paths(cfg).lock) } catch { /* gone */ } }

// ---- reading transcripts incrementally ------------------------------------------------------------------------------------

function listTranscripts(dir, withSub, since) {
  const out = []
  let projects = []
  try { projects = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()) } catch { return out }
  const push = (file, sub) => { try { const st = fs.statSync(file); if (st.mtimeMs >= since) out.push({ file, sub, size: st.size, mtime: st.mtimeMs }) } catch { /* gone */ } }
  for (const p of projects) {
    const pdir = path.join(dir, p.name)
    let entries = []
    try { entries = fs.readdirSync(pdir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) push(path.join(pdir, e.name), false)
      else if (withSub && e.isDirectory()) {
        const sdir = path.join(pdir, e.name, 'subagents')
        const walk = (d, depth) => {
          let xs = []
          try { xs = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
          for (const x of xs) {
            if (x.isFile() && x.name.endsWith('.jsonl')) push(path.join(d, x.name), true)
            else if (x.isDirectory() && depth < 3) walk(path.join(d, x.name), depth + 1)
          }
        }
        walk(sdir, 0)
      }
    }
  }
  return out
}

// Quick filters before JSON.parse: only lines that may hold a hit, or a tool_use whose result we must see.
const NEED = ['"is_error":true', 'AskUserQuestion', 'api_error', '"stop_reason":"end_turn"', 'agents_error']
const sessionOf = file => {
  const parts = slash(file).split('/')
  const i = parts.lastIndexOf('subagents')
  return (i > 0 ? parts[i - 1] : parts[parts.length - 1]).replace(/\.jsonl$/, '')
}

function readNew(t, entry, cfg, since) {
  const hits = []
  const ctx = { session: sessionOf(t.file), file: slash(t.file), sub: t.sub, cwd: entry?.cwd ?? '', tools: new Map() }
  let off = entry && entry.off <= t.size ? entry.off : 0
  if (off === t.size) return { hits, entry: { ...entry, off, mtime: t.mtime } }
  const chunk = Math.max(1, cfg.collect?.chunk_mb ?? 8) * 1024 * 1024
  const fd = fs.openSync(t.file, 'r')
  try {
    let rest = Buffer.alloc(0)
    let pos = off
    while (pos < t.size) {
      const buf = Buffer.alloc(Math.min(chunk, t.size - pos))
      const n = fs.readSync(fd, buf, 0, buf.length, pos)
      if (n <= 0) break
      pos += n
      const data = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n)
      const end = data.lastIndexOf(10)
      if (end < 0) { rest = data; continue }
      for (const line of data.subarray(0, end).toString('utf8').split('\n')) {
        const tu = line.includes('"tool_use"') && (line.includes('"name":"Bash"') || line.includes('"name":"PowerShell"') || line.includes('"name":"Workflow"')) && /\b(gh|glab)\b|Workflow/.test(line)
        const tr = ctx.tools.size && line.includes('"tool_result"') && [...ctx.tools.keys()].some(k => line.includes(k))
        if (!tu && !tr && !NEED.some(k => line.includes(k))) {
          if (!ctx.cwd && line.includes('"cwd"')) { try { ctx.cwd = JSON.parse(line).cwd || '' } catch { /* torn */ } }
          continue
        }
        let d
        try { d = JSON.parse(line) } catch { continue }
        for (const h of hitsOfRecord(d, ctx, cfg.detect)) if (!h.at || h.at >= since) hits.push(h)
      }
      off += end + 1
      rest = data.subarray(end + 1)
    }
  } finally { fs.closeSync(fd) }
  return { hits, entry: { off, mtime: t.mtime, cwd: ctx.cwd } }
}

function sessionFiles(cfg, since) {
  const out = []
  for (const root of (cfg.collect?.sessions ?? []).map(p => expand(p, cfg.env)).filter(isSet)) {
    let a = []
    try { a = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()) } catch { continue }
    for (const x of a) {
      let b = []
      try { b = fs.readdirSync(path.join(root, x.name), { withFileTypes: true }).filter(d => d.isDirectory()) } catch { continue }
      for (const y of b) {
        let fsx = []
        try { fsx = fs.readdirSync(path.join(root, x.name, y.name)) } catch { continue }
        for (const f of fsx.filter(n => n.startsWith('local_') && n.endsWith('.json'))) {
          const file = path.join(root, x.name, y.name, f)
          try { if (fs.statSync(file).mtimeMs >= since) out.push(file) } catch { /* gone */ }
        }
      }
    }
  }
  return out
}

export function collect(cfg, { force = false, now = Date.now() } = {}) {
  const P = paths(cfg)
  const C = cfg.collect ?? {}
  const cursor = force ? {} : readJson(P.cursor, {}) || {}
  const files = cursor.files ?? {}
  const backfill = now - (C.backfill_days ?? 14) * 86400000
  const lastRun = cursor.last_run ?? 0
  const roots = (C.roots ?? []).map(r => expand(r, cfg.env)).filter(isSet)
  const hits = []
  let read = 0
  for (const t of listTranscripts(expand(C.transcripts ?? '~/.claude/projects', cfg.env), C.subagents !== false, Math.min(backfill, lastRun || backfill))) {
    const key = slash(t.file)
    const prev = files[key]
    if (prev && prev.off === t.size) continue
    try {
      const r = readNew(t, prev, cfg, backfill)
      files[key] = r.entry
      hits.push(...r.hits)
      read++
    } catch { /* unreadable file: skipped, retried next time */ }
  }
  const seenKeys = new Set(cursor.session_keys ?? [])
  let sessions = 0
  for (const f of sessionFiles(cfg, Math.max(backfill, (lastRun || backfill) - 3600000))) {
    const j = readJson(f, null)
    if (!j) continue
    sessions++
    for (const h of hitsOfSession(j, slash(f))) {
      if (seenKeys.has(h.key)) continue
      seenKeys.add(h.key)
      if (!h.at || h.at >= backfill) hits.push(h)
    }
  }
  for (const h of hits) h.app = appOf(h.cwd, roots, C.worktree_dirs)
  const problems = fold(readLedger(cfg), cfg.timeline_max ?? 60)
  const plan = planLines(hits, problems, cfg.rules?.list ?? [], now, { maxEvidence: C.max_evidence ?? 3, reopen: C.reopen_fixed !== false })
  append(cfg, plan.lines)
  // Drop cursors of files gone for good; keep the last 5000 session keys.
  for (const k of Object.keys(files)) if (!fs.existsSync(k)) delete files[k]
  writeAtomic(P.cursor, { v: 1, last_run: now, files, session_keys: [...seenKeys].slice(-5000) })
  const stats = { at: now, files: read, sessions, hits: hits.length, new: plan.added.length, ignored: plan.ignored, unmatched: plan.unmatched.slice(0, 15) }
  snapshot(cfg, stats, now)
  return stats
}

// ---- seeds ------------------------------------------------------------------------------------------------------------

function readSource(src, cfg) {
  if (src.git) {
    const repo = expand(src.git.repo, cfg.env)
    return execFileSync('git', ['-C', repo, 'show', `${src.git.ref || 'HEAD'}:${src.git.path}`], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  }
  return fs.readFileSync(expand(src.path, cfg.env), 'utf8').replace(/^﻿/, '')
}

export function importSeeds(cfg, now = Date.now()) {
  const rules = cfg.rules?.list ?? []
  const report = []
  for (const src of cfg.seed?.sources ?? []) {
    if (!src || !src.id) continue
    let text
    try { text = readSource(src, cfg) } catch (e) {
      report.push({ id: src.id, imported: 0, error: src.optional ? 'absente (optionnelle)' : String(e.message || e).split('\n')[0] })
      continue
    }
    let mtime = now
    try { if (src.path) mtime = fs.statSync(expand(src.path, cfg.env)).mtimeMs } catch { /* git or gone */ }
    const at = src.date ? Date.parse(src.date) || mtime : mtime
    let seeds = []
    if (src.kind === 'incidents') seeds = seedFromIncidents(JSON.parse(text), src, rules, at)
    else if (src.kind === 'findings') seeds = seedFromFindings(JSON.parse(text), src, at)
    else seeds = seedFromMarkdown(text, src, rules, at)
    const problems = fold(readLedger(cfg))
    const lines = seedLines(seeds, problems, now)
    append(cfg, lines)
    report.push({ id: src.id, found: seeds.length, imported: lines.filter(l => l.op === 'add').length })
  }
  snapshot(cfg, undefined, now)
  return report
}

// ---- manual edits ---------------------------------------------------------------------------------------------------

export function addNote(cfg, id, text, now = Date.now()) {
  const t = String(text ?? '').trim()
  if (!/^P-\d+$/.test(id || '')) throw new Error(`identifiant invalide : ${id}`)
  if (!t) throw new Error('note vide')
  if (!fold(readLedger(cfg)).some(p => p.id === id)) throw new Error(`${id} absent du registre`)
  append(cfg, [{ op: 'note', id, at: now, text: t.slice(0, 2000) }])
  snapshot(cfg, undefined, now)
}

export function setField(cfg, id, field, value, now = Date.now()) {
  const allowed = ['status', 'fix', 'cause', 'category', 'title', 'symptom', 'app']
  if (!allowed.includes(field)) throw new Error(`champ inconnu : ${field} (${allowed.join(', ')})`)
  if (field === 'status' && !STATUSES.includes(value)) throw new Error(`statut inconnu : ${value} (${STATUSES.join(', ')})`)
  if (!fold(readLedger(cfg)).some(p => p.id === id)) throw new Error(`${id} absent du registre`)
  append(cfg, [{ op: 'update', id, at: now, fields: { [field]: value } }])
}

export function addManual(cfg, category, title, now = Date.now()) {
  const problems = fold(readLedger(cfg))
  const id = nextId(problems)
  append(cfg, [
    { op: 'add', id, at: now, signature: `manual:${id}`, source: 'manuel', category, scope: 'global', app: '', title, symptom: title, cause: '', fix: '', status: 'ouvert', first_seen: now, evidence: [] },
    { op: 'seen', id, at: now, n: 1, first: now, last: now, apps: [], evidence: [] },
  ])
  snapshot(cfg, undefined, now)
  return id
}

// ---- main -------------------------------------------------------------------------------------------------------------

export async function main(argv) {
  const cfg = config()
  const [cmd, ...rest] = argv
  const write = ['collect', 'import', 'note', 'set', 'add', 'fold'].includes(cmd)
  if (write && !takeLock(cfg, (cfg.collect_timeout_s ?? 300) * 2000)) {
    // Another writer: notes wait a little, a collection just leaves (the next one picks up the bytes).
    if (cmd === 'collect') { console.log('problemes: a collection is already running'); return 0 }
    let ok = false
    for (let i = 0; i < 40 && !ok; i++) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); ok = takeLock(cfg, (cfg.collect_timeout_s ?? 300) * 2000) }
    if (!ok) { console.error('problemes: ledger busy, retry'); return 1 }
  }
  try {
    switch (cmd) {
      case 'collect': {
        const s = collect(cfg, { force: rest.includes('--force') })
        writeHealth('problemes')
        console.log(JSON.stringify(s))
        return 0
      }
      case 'import': {
        console.log(JSON.stringify(importSeeds(cfg)))
        return 0
      }
      case 'note': {
        addNote(cfg, rest[0], rest.slice(1).join(' '))
        console.log(`problemes: note added to ${rest[0]}`)
        return 0
      }
      case 'set': {
        const fx = rest.indexOf('--fix')
        const args = fx >= 0 ? rest.slice(0, fx) : rest
        setField(cfg, args[0], args[1], args.slice(2).join(' '))
        if (fx >= 0) setField(cfg, args[0], 'fix', rest.slice(fx + 1).join(' '))
        snapshot(cfg)
        console.log(`problemes: ${args[0]} ${args[1]} updated`)
        return 0
      }
      case 'add': {
        if (rest.length < 2) { console.error('problemes: add <category> <title…>'); return 1 }
        console.log(addManual(cfg, rest[0], rest.slice(1).join(' ')))
        return 0
      }
      case 'fold': {
        const s = snapshot(cfg)
        console.log(JSON.stringify(s.totals))
        return 0
      }
      case 'status': {
        const snap = readJson(paths(cfg).snapshot, null)
        console.log(JSON.stringify({ dir: cfg.data_dir, problems: snap?.problems?.length ?? 0, totals: snap?.totals ?? null, collected: snap?.collected ? new Date(snap.collected).toISOString() : null, stats: snap?.stats ?? null }, null, 1))
        return 0
      }
      default:
        console.log('usage: node problemes_scan.mjs collect [--force] | import | note <P-NNN> <text> | set <P-NNN> <field> <value> [--fix <text>] | add <category> <title> | fold | status')
        return cmd ? 1 : 0
    }
  } catch (e) {
    if (cmd === 'collect') writeHealth('problemes', e?.message ?? String(e))
    console.error(`problemes: ${e?.message ?? e}`)
    return 1
  } finally {
    if (write) dropLock(cfg)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code })
}
