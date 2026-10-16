#!/usr/bin/env node
// export-eta - exporter (Node, no dependencies, no model call). Renders conversations to Markdown, masks secrets,
// holds back what it cannot mask, writes them into a fresh worktree of the eta repo and lands them through a PR.
//
//   node export.mjs list                      sessions + their state → <home>/sessions.json (the pane reads it)
//   node export.mjs pending [--json]          the finished batch waiting for an export → <home>/pending.json
//   node export.mjs run --mode ongoing|selection|batch [--ids a,b] [--dry-run] [--out <dir>]
//        ongoing: every ongoing conversation now (snapshot); selection: --ids; batch: the pending batch.
//        --out <dir>: write into that folder only (no git). --dry-run: render and mask, write nothing, print the plan.
//   node export.mjs status                    last exports (JSON)
// Options: --home <dir> (default ~/.claude/export-eta, or EXPORT_ETA_HOME), --app <dir>, --projects <dir>, --now <ms>.
// Git flow (no --out): fetch, `git worktree add` under <eta>/.claude/worktrees/export-<date>, branch
// export/conversations-<date-time>, commit, push, gh pr create, merge (squash) per merge policy, delete the remote
// branch, `git worktree remove`. Never pushes to main, never force-pushes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { addCounts, check, mask } from '../lib/mask.mjs'
import { expand, landInEta, maskOpts } from '../lib/etagit.mjs'
import { batchOf, batchText, deepMerge, fill, frontMatter, globalIndex, partPath, pathOf, projectIndex } from '../lib/layout.mjs'
import { day, render, split } from '../lib/render.mjs'
import { listSessions, readTranscript } from './sessions.mjs'
import { writeHealth } from '../lib/core/health.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOD = path.join(HERE, '..')

// ---- args, config, state -------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (['json', 'dry-run', 'force'].includes(k)) o[k] = true
      else o[k] = argv[++i]
    } else o._.push(a)
  }
  return o
}

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) } catch { return d } }
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = p + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, p) }

export function loadConfig(o = {}) {
  const home = path.resolve(expand(o.home || process.env.EXPORT_ETA_HOME || '~/.claude/export-eta'))
  const base = readJson(path.join(MOD, 'export-eta.config.json'), {})
  const cfg = deepMerge(base, readJson(path.join(home, 'config.json'), {}))
  if (o.app) cfg.app_dir = o.app
  if (o.projects) cfg.projects_dir = o.projects
  cfg.home = home
  const patterns = []
  for (const f of cfg.patterns_files || []) {
    const j = readJson(expand(f), null)
    const list = Array.isArray(j) ? j : j && Array.isArray(j.patterns) ? j.patterns : []
    for (const p of list) if (p && (p.regex || p.pattern)) patterns.push(p)
  }
  cfg.file_patterns = patterns
  return cfg
}

const P = (cfg) => ({ state: path.join(cfg.home, 'state.json'), sessions: path.join(cfg.home, 'sessions.json'), pending: path.join(cfg.home, 'pending.json'), lock: path.join(cfg.home, 'export.lock'), log: path.join(cfg.home, 'export.log') })

export function loadState(cfg, nowMs) {
  const st = readJson(P(cfg).state, null) || {}
  if (!st.since) st.since = nowMs // first run: only conversations finished from now on make a batch
  st.exported = st.exported || {}
  st.history = st.history || []
  return st
}

function log(cfg, line) {
  try { fs.mkdirSync(cfg.home, { recursive: true }); fs.appendFileSync(P(cfg).log, `${new Date().toISOString()} ${line}\n`) } catch { /* best effort */ }
}

// ---- render + mask -------------------------------------------------------------------------------------------------

export { maskOpts }

/**
 * Renders and masks the sessions. existing: paths already in the destination (relative, '/'), so a re-export reuses
 * its own file. Returns { files: [{ path, content }], stale: [paths of this session's old parts to delete],
 * exported: [{ cli, title, project, path, parts, masked }], held: [{ cli, title, project, hits }], masked: {kind: n} }.
 */
export function build(sessions, cfg, existing, nowMs, ownEmails = []) {
  const files = []
  const stale = []
  const exported = []
  const held = []
  const masked = {}
  const mo = maskOpts(cfg, ownEmails)
  for (const s of sessions) {
    const lines = s.lines || readTranscript(s.transcript)
    const { md } = render(s, lines, { labels: cfg.labels, now: nowMs })
    const m = mask(md, mo)
    const hits = check(m.text, mo)
    if (hits.length) { held.push({ cli: s.cli, title: s.title, project: s.project, hits: hits.map((h) => h.kind) }); continue }
    const fm = frontMatter(m.text) || {}
    const p = pathOf(s, cfg, day(s.created || s.last_activity), existing)
    const parts = split(m.text, (cfg.max_kb ?? 300) * 1024, cfg.max_parts ?? 5, cfg.labels)
    parts.forEach((c, i) => files.push({ path: partPath(p, i), content: c }))
    const base = p.replace(/\.md$/, '')
    for (const f of existing) if (f.startsWith(base + '.part') && !parts.some((c, i) => partPath(p, i) === f)) stale.push(f)
    addCounts(masked, m.counts)
    exported.push({ cli: s.cli, title: s.title, project: s.project, path: p, parts: parts.length, masked: m.total, last_activity: s.last_activity, last_message: fm.last_message || '' })
  }
  return { files, stale, exported, held, masked }
}

/** Lists the Markdown files under the conversations root of a checkout (relative paths with '/'). */
export function listExisting(root, cfg) {
  const top = (cfg.dest_root || 'sources/conversations').replace(/\/+$/, '')
  const out = []
  const walk = (dir, rel) => {
    let list = []
    try { list = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of list) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}/${e.name}`)
      else if (e.name.endsWith('.md')) out.push(`${rel}/${e.name}`)
    }
  }
  walk(path.join(root, top), top)
  return out
}

/** Writes the files, deletes this export's stale parts, rebuilds every INDEX.md. Returns the paths touched. */
export function writeAll(root, cfg, result) {
  const touched = []
  for (const f of result.files) {
    const abs = path.join(root, f.path)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, f.content)
    touched.push(f.path)
  }
  for (const f of result.stale) { try { fs.unlinkSync(path.join(root, f)); touched.push(f) } catch { /* already gone */ } }
  touched.push(...writeIndexes(root, cfg))
  return touched
}

export function writeIndexes(root, cfg) {
  const top = (cfg.dest_root || 'sources/conversations').replace(/\/+$/, '')
  const all = listExisting(root, cfg).filter((f) => !/\/INDEX\.md$/.test(f) && !/\/README\.md$/.test(f) && !/\.part\d+\.md$/.test(f))
  const byProject = {}
  for (const f of all) {
    const rel = f.slice(top.length + 1)
    const [project, ...rest] = rel.split('/')
    if (!rest.length) continue
    const fm = frontMatter(fs.readFileSync(path.join(root, f), 'utf8'))
    ;(byProject[project] = byProject[project] || []).push({ file: rest.join('/'), fm })
  }
  const touched = []
  const projects = Object.entries(byProject).map(([project, entries]) => ({ project, entries }))
  for (const p of projects) {
    const f = `${top}/${p.project}/INDEX.md`
    fs.writeFileSync(path.join(root, f), projectIndex(p.project, p.entries, cfg.labels))
    touched.push(f)
  }
  fs.mkdirSync(path.join(root, top), { recursive: true })
  fs.writeFileSync(path.join(root, top, 'INDEX.md'), globalIndex(projects, cfg.labels, cfg.index_latest ?? 30))
  touched.push(`${top}/INDEX.md`)
  const readme = path.join(root, top, 'README.md')
  if (!fs.existsSync(readme) && cfg.readme) { fs.writeFileSync(readme, cfg.readme.join('\n') + '\n'); touched.push(`${top}/README.md`) }
  return touched
}

// ---- selection ------------------------------------------------------------------------------------------------------

export function pick(sessions, mode, ids, batch, cfg) {
  const ex = new Set(cfg.exclude || [])
  if (mode === 'ongoing') return sessions.filter((s) => (s.state === 'ongoing' || s.state === 'live') && !ex.has(s.cli))
  if (mode === 'batch') return sessions.filter((s) => batch.ids.includes(s.cli))
  const want = new Set(ids)
  return sessions.filter((s) => want.has(s.cli) || want.has(s.sid) || [...want].some((w) => w.length >= 8 && s.cli.startsWith(w)))
}

// ---- git ------------------------------------------------------------------------------------------------------------

/** The whole git flow through lib/etagit.mjs; returns { pr, url, merged, branch, error }. */
export function gitFlow(cfg, result, nowMs, title) {
  if (!(cfg.eta || {}).repo) throw new Error(`eta.repo non réglé : mets-le dans ${path.join(cfg.home, 'config.json')}`)
  const top = cfg.dest_root || 'sources/conversations'
  return landInEta({
    eta: cfg.eta, home: cfg.home, mask: cfg, addPaths: [top], title, nowMs,
    produce: (wt, own) => {
      const res = result.rebuild(listExisting(wt, cfg), own)
      Object.assign(result, res)
      if (!res.files.length) return { empty: 'rien à exporter (tout est retenu ou vide)', touched: [] }
      const touched = writeAll(wt, cfg, res)
      const n = Object.values(res.masked).reduce((x, y) => x + y, 0)
      return { touched, body: prBody(res, cfg), commit: `Export by the export-eta mod (claude-mod): ${res.exported.length} conversation(s), ${n} value(s) masked, ${res.held.length} held back.` }
    },
  })
}

export function prBody(res, cfg) {
  const L = cfg.labels || {}
  const masked = Object.entries(res.masked).map(([k, v]) => `${k} ${v}`).join(', ') || '0'
  return [
    `${L.pr_intro || 'Conversations exportées par le mod export-eta (claude-mod), rendues en Markdown et masquées.'}`,
    '',
    `| ${L.col_conv || 'Conversation'} | ${L.col_project || 'Projet'} | Fichier | Masqués |`, '|---|---|---|---|',
    ...res.exported.map((e) => `| ${String(e.title || e.cli).replace(/\|/g, '\\|')} | ${e.project} | \`${e.path}\`${e.parts > 1 ? ` (+${e.parts - 1} partie(s))` : ''} | ${e.masked} |`),
    '',
    `${L.masked || 'Valeurs masquées'} : ${masked}.`,
    res.held.length ? `${L.held || 'Retenues (secret non masquable)'} : ${res.held.map((h) => `${h.title || h.cli} (${h.hits.join(', ')})`).join(' ; ')}.` : `${L.held || 'Retenues'} : aucune.`,
    '',
    'Merge policy: no CI on this repo applies to Markdown sources; merged after the confidentiality pass (mask + final check on every written file) came back clean.',
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n')
}

// ---- commands -------------------------------------------------------------------------------------------------------

function takeLock(cfg) {
  try {
    fs.mkdirSync(cfg.home, { recursive: true })
    const p = P(cfg).lock
    if (fs.existsSync(p) && Date.now() - fs.statSync(p).mtimeMs < 30 * 60000) return false
    fs.writeFileSync(p, String(process.pid))
    return true
  } catch { return false }
}

export function pendingOf(cfg, sessions, nowMs) {
  const state = loadState(cfg, nowMs)
  const batch = batchOf(sessions, state, cfg, nowMs)
  const out = { generated: nowMs, ...batch, text: batchText(batch, cfg.labels), auto: !!cfg.auto,
    titles: sessions.filter((s) => batch.ids.includes(s.cli)).map((s) => ({ cli: s.cli, title: s.title, project: s.project })) }
  writeJson(P(cfg).state, state) // keeps `since` from the first run
  writeJson(P(cfg).pending, out)
  return out
}

export async function runExport(cfg, o, nowMs) {
  const mode = o.mode || 'selection'
  const all = listSessions(cfg, nowMs)
  const state = loadState(cfg, nowMs)
  const batch = batchOf(all, state, cfg, nowMs)
  const ids = String(o.ids || '').split(/[,\s]+/).filter(Boolean)
  const chosen = pick(all, mode, ids, batch, cfg)
  if (!chosen.length) return { ok: false, error: mode === 'selection' ? 'aucune conversation choisie (--ids)' : 'aucune conversation à exporter' }
  const title = fill((cfg.labels || {}).pr_title || 'Export conversations ({mode}, {n})', { mode: { ongoing: 'en cours', selection: 'sélection', batch: 'lot terminé' }[mode] || mode, n: chosen.length })
  const result = { rebuild: (existing, own) => build(chosen, cfg, existing, nowMs, own) }
  let git = { pr: null, url: null, merged: false, error: '' }
  if (o['dry-run']) Object.assign(result, result.rebuild([], []))
  else if (o.out) {
    const root = path.resolve(o.out)
    Object.assign(result, result.rebuild(listExisting(root, cfg), []))
    writeAll(root, cfg, result)
  } else {
    if (!takeLock(cfg)) return { ok: false, error: 'un export tourne déjà' }
    try { git = gitFlow(cfg, result, nowMs, title) } catch (e) { git.error = String(e.message || e) } finally { try { fs.unlinkSync(P(cfg).lock) } catch { /* gone */ } }
  }
  const entry = {
    at: nowMs, mode, count: (result.exported || []).length, pr: git.pr, url: git.url, merged: git.merged, error: git.error,
    masked: result.masked || {}, held: (result.held || []).map((h) => ({ cli: h.cli, title: h.title, hits: h.hits })),
    files: (result.exported || []).map((e) => e.path), dry: !!o['dry-run'], out: o.out ? 'dossier local' : '',
  }
  if (!o['dry-run']) {
    const landed = o.out || git.merged
    if (landed) for (const e of result.exported || []) state.exported[e.cli] = { at: nowMs, path: e.path, last_activity: e.last_activity }
    state.history = [entry, ...state.history].slice(0, 50)
    writeJson(P(cfg).state, state)
    log(cfg, `${mode} ${entry.count} pr=${git.url || '-'} merged=${git.merged} held=${entry.held.length} ${git.error || ''}`)
    try { pendingOf(cfg, all, nowMs) } catch { /* the pane refreshes it */ }
  }
  return { ok: !git.error || (git.merged && !!git.url), ...entry }
}

// Errors as the health record ~/.claude/mods-health/export-eta.json (lib/core/health.mjs), which Santé and the
// Problèmes register read: one line, credentials in URLs and token-like words masked.
export function healthText(err) {
  if (!err) return null
  return String(err).replace(/(https?:\/\/)[^/\s@]+@/g, '$1***@').replace(/\b(gh[pousr]_|glpat-|github_pat_)[A-Za-z0-9_-]+/g, '$1***').replace(/\s+/g, ' ').trim().slice(0, 300)
}

export async function main(argv) {
  const o = parseArgs(argv)
  const cfg = loadConfig(o)
  const nowMs = o.now ? Number(o.now) : Date.now()
  const cmd = o._[0] || 'status'
  if (cmd === 'list') {
    const all = listSessions(cfg, nowMs)
    const state = loadState(cfg, nowMs)
    const slim = all.map(({ transcript, ...s }) => ({ ...s, exported_at: (state.exported[s.cli] || {}).at || 0 }))
    writeJson(P(cfg).sessions, { generated: nowMs, sessions: slim })
    const p = pendingOf(cfg, all, nowMs)
    console.log(`export-eta: ${all.length} conversations, ${all.filter((s) => s.state === 'ongoing' || s.state === 'live').length} en cours, lot ${p.count}${p.ready ? ' prêt' : ''}`)
    return 0
  }
  if (cmd === 'pending') {
    const p = pendingOf(cfg, listSessions(cfg, nowMs), nowMs)
    console.log(o.json ? JSON.stringify(p) : `export-eta: ${p.text || `lot : ${p.count} conversation(s), pas prêt`}`)
    return 0
  }
  if (cmd === 'run') {
    const r = await runExport(cfg, o, nowMs)
    if (o.json) console.log(JSON.stringify(r))
    else console.log(`export-eta: ${r.ok ? 'ok' : 'échec'} · ${r.count ?? 0} exportée(s)${r.url ? ' · ' + r.url : ''}${r.merged ? ' (mergée)' : ''}${r.held && r.held.length ? ` · ${r.held.length} retenue(s)` : ''}${r.error ? ' · ' + r.error : ''}`)
    return r.ok ? 0 : 1
  }
  if (cmd === 'status') {
    console.log(JSON.stringify(loadState(cfg, nowMs).history.slice(0, 10)))
    return 0
  }
  console.error(`export-eta: commande inconnue ${cmd}`)
  return 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] || 'status'
  const watched = ['list', 'pending', 'run'].includes(cmd) && !process.argv.includes('--dry-run')
  // the last line printed (stdout or stderr) says why a run failed
  const orig = { log: console.log, error: console.error }
  let last = ''
  console.log = (...a) => { last = a.join(' '); orig.log(...a) }
  console.error = (...a) => { last = a.join(' '); orig.error(...a) }
  main(process.argv.slice(2)).then((c) => {
    if (watched) writeHealth('export-eta', c ? healthText(`${cmd}_failed: ${last || 'exit ' + c}`) : null)
    process.exit(c)
  }, (e) => {
    console.error(`export-eta: ${e && e.message ? e.message : e}`)
    if (watched) writeHealth('export-eta', healthText(`${cmd}_failed: ${e && e.message ? e.message : e}`))
    process.exit(1)
  })
}
