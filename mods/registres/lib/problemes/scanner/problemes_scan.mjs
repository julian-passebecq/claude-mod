#!/usr/bin/env node
// problemes - collector and ledger CLI. Node 22+, standard library only, no model tokens.
//   node problemes_scan.mjs collect [--force]          read new transcript bytes and session files, append to the ledger
//   node problemes_scan.mjs import                     import the seed sources of the config (once per row)
//   node problemes_scan.mjs note <P-NNN> <text…>       append a note (what the pane's « Ajouter une note » runs)
//   node problemes_scan.mjs set <P-NNN> <field> <value…> [--fix <text>]   status | fix | cause | category | title
//   node problemes_scan.mjs add <category> <title…>    a problem by hand (status ouvert)
//   node problemes_scan.mjs fold                       rewrite the snapshot problems.json from the ledger
//   node problemes_scan.mjs status                     counts, paths, last collection
//   node problemes_scan.mjs export [--out <dir>] [--dry-run] [--json]   the register, masked, into the eta repo by PR
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
  hitsOfHealth, hitsOfSante,
} from '../lib/core.mjs'
import { writeHealth } from './health.mjs'
import { appDir } from '../lib/core/sessions.mjs'
import { registerFiles, staleOf } from '../lib/export.mjs'
import { landInEta, maskOpts } from '../lib/eta/etagit.mjs'

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
  const auto = (p) => /^(auto|%APPDATA%[\/]Claude[\/]claude-code-sessions[\/]?)$/i.test(String(p || '').trim())
  const roots = [...new Set((cfg.collect?.sessions ?? []).map(p => auto(p) ? appDir({}, cfg.env || process.env) : expand(p, cfg.env)).filter(isSet))]
  for (const root of roots) {
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
  // Santé and veille errors: the shared health records and santé's report, each error once (keys like session files).
  let health = 0
  for (const h of healthHits(cfg)) {
    health++
    if (seenKeys.has(h.key)) continue
    seenKeys.add(h.key)
    hits.push(h)
  }
  for (const h of hits) h.app = appOf(h.cwd, roots, C.worktree_dirs)
  const problems = fold(readLedger(cfg), cfg.timeline_max ?? 60)
  const plan = planLines(hits, problems, cfg.rules?.list ?? [], now, { maxEvidence: C.max_evidence ?? 3, reopen: C.reopen_fixed !== false })
  append(cfg, plan.lines)
  // Drop cursors of files gone for good; keep the last 5000 session keys.
  for (const k of Object.keys(files)) if (!fs.existsSync(k)) delete files[k]
  writeAtomic(P.cursor, { v: 1, last_run: now, files, session_keys: [...seenKeys].slice(-5000) })
  const stats = { at: now, files: read, sessions, health, hits: hits.length, new: plan.added.length, ignored: plan.ignored, unmatched: plan.unmatched.slice(0, 15) }
  snapshot(cfg, stats, now)
  return stats
}

/** Hits from ~/.claude/mods-health/*.json (MODS_HEALTH_DIR or collect.health_dir) and santé's report (collect.sante_report). */
export function healthHits(cfg) {
  const C = cfg.collect ?? {}
  const out = []
  const dir = cfg.env?.MODS_HEALTH_DIR || expand(C.health_dir ?? '~/.claude/mods-health', cfg.env)
  if (isSet(dir) && C.health !== false) {
    let names = []
    try { names = fs.readdirSync(dir).filter(n => n.endsWith('.json')) } catch { /* no records yet */ }
    for (const n of names) {
      const file = path.join(dir, n)
      let rec, invalid = ''
      try { rec = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) } catch (e) { invalid = e?.code === 'ENOENT' ? '' : String(e?.message ?? e).slice(0, 120) }
      out.push(...hitsOfHealth(rec, n.replace(/\.json$/, ''), slash(file), invalid))
    }
  }
  const rep = isSet(C.sante_report) ? expand(C.sante_report, cfg.env) : ''
  if (rep && C.health !== false) {
    const j = readJson(rep, null)
    if (j) out.push(...hitsOfSante(j, slash(rep)))
  }
  return out
}

// ---- seeds ------------------------------------------------------------------------------------------------------------

function readSource(src, cfg) {
  if (src.git) {
    const repo = repoOf(src.git.repo, cfg)
    return execFileSync('git', ['-C', repo, 'show', `${src.git.ref || 'HEAD'}:${src.git.path}`], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  }
  return fs.readFileSync(expand(src.path, cfg.env), 'utf8').replace(/^﻿/, '')
}

/** A repo path with {root}: the first of collect.roots where it is a git repo (so no private path sits in the shipped config). */
function repoOf(repo, cfg) {
  const r = String(repo ?? '')
  if (!isSet(r)) throw new Error('dépôt non réglé')
  if (!r.includes('{root}')) return expand(r, cfg.env)
  for (const root of (cfg.collect?.roots ?? []).map(x => expand(x, cfg.env)).filter(isSet)) {
    const c = slash(r.replaceAll('{root}', root.replace(/[\\/]+$/, '')))
    try { execFileSync('git', ['-C', c, 'rev-parse', '--git-dir'], { windowsHide: true, stdio: 'ignore' }); return c } catch { /* not here */ }
  }
  throw new Error(`aucun dépôt ${r} sous collect.roots`)
}

/**
 * A source with `dir` + `files` (regex on the file name), or git: { repo, ref, dir, files }, stands for every matching file:
 * one concrete source per file, id `<id>:<file name>`, ref_id `<id>` (the same line in two files is imported once),
 * date from the file name (YYYY-MM-DD) when it has one. Other sources pass through.
 */
export function expandSource(src, cfg) {
  const g = src.git
  if (!(g ? g.dir && g.files : src.dir && src.files)) return [src]
  const re = new RegExp(g ? g.files : src.files, 'i')
  let names
  let repo
  if (g) {
    repo = repoOf(g.repo, cfg)
    const out = execFileSync('git', ['-C', repo, 'ls-tree', '--name-only', g.ref || 'HEAD', `${g.dir.replace(/\/+$/, '')}/`], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    names = out.split(/\r?\n/).filter(Boolean).map(p => p.split('/').pop())
  } else names = fs.readdirSync(expand(src.dir, cfg.env))
  return names.filter(n => re.test(n)).sort().map(n => {
    const d = n.match(/(\d{4}-\d{2}-\d{2})/)
    const one = { ...src, id: `${src.id}:${n}`, ref_id: src.ref_id ?? src.id, label: `${src.label ?? src.id} · ${n}`, date: src.date ?? (d ? `${d[1]}T12:00:00` : undefined) }
    if (g) one.git = { repo, ref: g.ref, path: `${g.dir.replace(/\/+$/, '')}/${n}` }
    else { one.path = `${slash(expand(src.dir, cfg.env)).replace(/\/+$/, '')}/${n}`; delete one.dir }
    delete one.files
    return one
  })
}

/** The configured sources, then the shipped seed.builtin ones (an object by id; enabled: false or a same-id source turns one off). */
export function seedSources(cfg) {
  const own = (cfg.seed?.sources ?? []).filter(s => s && s.id)
  const ids = new Set(own.map(s => s.id))
  const builtin = Object.entries(cfg.seed?.builtin ?? {}).filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object' && v.enabled !== false && !ids.has(k))
  return [...own, ...builtin.map(([k, v]) => ({ id: k, ...v }))]
}

export function importSeeds(cfg, now = Date.now()) {
  const rules = cfg.rules?.list ?? []
  const report = []
  const all = []
  for (const s of seedSources(cfg)) {
    try {
      const xs = expandSource(s, cfg)
      if (!xs.length) all.push({ none: s })
      all.push(...xs)
    } catch (e) {
      all.push({ failed: s, error: e })
    }
  }
  for (const src of all) {
    if (src.none) { report.push({ id: src.none.id, found: 0, imported: 0, error: 'aucun fichier' }); continue }
    if (src.failed) {
      report.push({ id: src.failed.id, imported: 0, error: src.failed.optional ? 'absente (optionnelle)' : String(src.error.message || src.error).split('\n')[0] })
      continue
    }
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

// ---- export to eta ------------------------------------------------------------------------------------------------------

/**
 * Settings of the eta export: this mod's `eta` block, completed by export-eta's own user config (same eta repo, same
 * own e-mails and extra secret patterns) so the path is set once, in ~/.claude/export-eta/config.json.
 */
export function etaSettings(cfg) {
  const env = cfg.env || ENV()
  const shared = readJson(expand(env.EXPORT_ETA_HOME || '~/.claude/export-eta', env) + '/config.json', {}) || {}
  // export-eta's branch and worktree names are for conversations: this mod keeps its own; an empty value here is unset.
  const { branch, worktree_dir, ...sharedEta } = shared.eta || {}
  const mine = Object.fromEntries(Object.entries(cfg.eta || {}).filter(([k, v]) => !k.startsWith('_') && isSet(v)))
  const E = deepMerge(deepMerge({ base: 'main', merge: 'checks-or-scan', branch: 'export/problemes-{day}-{hm}', worktree_dir: '.claude/worktrees/problemes-{day}-{hm}' }, sharedEta), mine)
  if (!isSet(E.repo)) E.repo = ''
  const maskCfg = {
    own_emails: [...(shared.own_emails || []), ...(cfg.eta?.own_emails || [])], allow_email_domains: [...(shared.allow_email_domains || ['example.com', 'example.org', 'anthropic.com', 'users.noreply.github.com']), ...(cfg.eta?.allow_email_domains || [])],
    extra_patterns: [...(shared.extra_patterns || []), ...(cfg.eta?.extra_patterns || [])], hold_patterns: [...(shared.hold_patterns || []), ...(cfg.eta?.hold_patterns || [])],
    file_patterns: [...(shared.patterns_files || []), ...(cfg.eta?.patterns_files || [])].flatMap(f => { const j = readJson(expand(f, env), null); return Array.isArray(j) ? j : j?.patterns || [] }),
  }
  return { E, maskCfg }
}

function existingIn(root, dir) {
  const abs = path.join(root, dir)
  let names = []
  try { names = fs.readdirSync(abs).filter(n => n.endsWith('.md')) } catch { return [] }
  return names.map(n => ({ path: `${dir}/${n}`, content: fs.readFileSync(path.join(abs, n), 'utf8') }))
}

function writeRegister(root, dir, res) {
  const touched = []
  for (const f of res.files) {
    fs.mkdirSync(path.dirname(path.join(root, f.path)), { recursive: true })
    fs.writeFileSync(path.join(root, f.path), f.content)
    touched.push(f.path)
  }
  for (const p of staleOf(existingIn(root, dir), res.files)) { try { fs.unlinkSync(path.join(root, p)); touched.push(p) } catch { /* gone */ } }
  return touched
}

/** /problemes export: the register (masked) into the eta repo through a PR, or into --out <dir>. Returns the history entry. */
export function exportRegister(cfg, { out = '', dryRun = false, now = Date.now() } = {}) {
  const problems = fold(readLedger(cfg), cfg.timeline_max ?? 60)
  const { E, maskCfg } = etaSettings(cfg)
  const dir = (E.dest_dir || 'sources/problemes').replace(/\/+$/, '')
  const build = own => registerFiles(problems, { ...cfg, eta: E }, now, own, extra => maskOpts(maskCfg, extra))
  let res = null
  let git = { pr: null, url: null, merged: false, error: '' }
  if (dryRun) res = build([])
  else if (out) { res = build([]); writeRegister(path.resolve(out), dir, res) }
  else {
    if (!E.repo) throw new Error(`eta.repo non réglé : mets-le dans ~/.claude/export-eta/config.json (ou eta.repo dans ${path.join(cfg.data_dir, 'problemes.config.json')})`)
    git = landInEta({
      eta: E, home: cfg.data_dir, mask: maskCfg, addPaths: [dir], nowMs: now,
      title: `Export registre des problèmes (${problems.length})`,
      produce: (wt, own) => {
        res = build(own)
        if (!res.files.length) return { empty: 'rien à exporter (registre vide ou retenu)', touched: [] }
        const touched = writeRegister(wt, dir, res)
        const masked = Object.entries(res.masked).map(([k, v]) => `${k} ${v}`).join(', ') || '0'
        return {
          touched, commit: `Export by the problemes mod (claude-mod): ${problems.length} problem(s), ${res.files.length} file(s), masked ${masked}, ${res.held.length} held back.`,
          body: [
            `Registre des problèmes exporté par le mod problemes (claude-mod) : ${problems.length} problème(s), ${res.files.length} fichier(s)${res.split ? ' (un par catégorie)' : ''}.`, '',
            ...res.files.map(f => `- \`${f.path}\``), '',
            `Valeurs masquées : ${masked}.`,
            res.held.length ? `Retenus (secret non masquable) : ${res.held.map(h => `${h.path} (${h.hits.join(', ')})`).join(' ; ')}.` : 'Retenus : aucun.', '',
            'Merge policy: no CI on this repo applies to Markdown sources; merged after the confidentiality pass (mask + final check on every written file) came back clean.', '',
            '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
          ].join('\n'),
        }
      },
    })
  }
  const entry = {
    at: now, problems: problems.length, files: (res?.files || []).map(f => f.path), held: (res?.held || []).map(h => ({ path: h.path, hits: h.hits })),
    masked: res?.masked || {}, pr: git.pr, url: git.url, merged: git.merged, error: git.error, dry: dryRun, out: out ? 'dossier local' : '',
  }
  if (!dryRun) {
    const p = path.join(cfg.data_dir, 'export.json')
    const prev = readJson(p, { history: [] }) || { history: [] }
    writeAtomic(p, { history: [entry, ...(prev.history || [])].slice(0, 30) })
  }
  return entry
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
      case 'export': {
        const oi = rest.indexOf('--out')
        const e = exportRegister(cfg, { out: oi >= 0 ? rest[oi + 1] : '', dryRun: rest.includes('--dry-run') })
        if (rest.includes('--json')) console.log(JSON.stringify(e))
        else console.log(`problemes: export ${e.error && !e.merged ? 'échec' : 'ok'} · ${e.files.length} fichier(s)${e.url ? ' · ' + e.url : ''}${e.merged ? ' (mergée)' : ''}${e.held.length ? ` · ${e.held.length} retenu(s)` : ''} · masqués ${Object.values(e.masked).reduce((a, b) => a + b, 0)}${e.error ? ' · ' + e.error : ''}`)
        return e.error && !e.merged ? 1 : 0
      }
      case 'status': {
        const snap = readJson(paths(cfg).snapshot, null)
        console.log(JSON.stringify({ dir: cfg.data_dir, problems: snap?.problems?.length ?? 0, totals: snap?.totals ?? null, collected: snap?.collected ? new Date(snap.collected).toISOString() : null, stats: snap?.stats ?? null }, null, 1))
        return 0
      }
      default:
        console.log('usage: node problemes_scan.mjs collect [--force] | import | note <P-NNN> <text> | set <P-NNN> <field> <value> [--fix <text>] | add <category> <title> | fold | status | export [--out <dir>] [--dry-run] [--json]')
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
