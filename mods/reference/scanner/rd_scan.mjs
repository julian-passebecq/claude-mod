// reference - the Node side of the tabs « À essayer », « R&D » and « Repos », and of « Exporter pour audit ».
// The hooks module cannot read folders or run git itself without node:fs, so it runs this script with a JSON request
// on stdin { cfg, home, modsDir, pluginDirs, now } and reads one JSON answer on stdout.
//   node rd_scan.mjs essais                    items of the research documents + manual checks + tests-reels to do
//   node rd_scan.mjs rd                        index of the research folders (date, subject, 3 lines, sources)
//   node rd_scan.mjs repos [--fresh]           each repo: branch, ahead/behind, last commit, dirty, open PRs (gh, cached)
//   node rd_scan.mjs repo-update <name>        git pull --ff-only on that repo's main checkout (+ its post_update)
//   node rd_scan.mjs audit-export [--dry-run]  the dated zip under audit.out_dir (masked, held files listed)
//   node rd_scan.mjs export-rd [--dry-run]     the research documents, masked, into the eta repo by PR (export-eta's flow)
// Read-only except: ~/.claude/reference-mod/repos-cache.json, the audit zip, and what repo-update / export-rd do on
// Julian's click. No model call. Never reads smtp.json, .credentials.json, tokens or transcripts.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { addCounts, clean, envOf, manifest, isText, denied } from '../lib/rd/audit.mjs'
import { itemsOf, manualTodo, testsTodo } from '../lib/rd/essais.mjs'
import { docInfo } from '../lib/rd/md.mjs'
import { aheadBehind, dirtyCount, lastCommit, prsOf, slugOf, updateBlocker } from '../lib/rd/repos.mjs'
import { zip } from '../lib/rd/zip.mjs'
import { check, mask } from '../lib/eta/mask.mjs'
import { landInEta, maskOpts } from '../lib/eta/etagit.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', 'types', '.claude'])

export function context(req = {}) {
  const home = String(req.home || os.homedir()).replace(/\\/g, '/')
  const cfg = req.cfg || JSON.parse(fs.readFileSync(path.join(HERE, '..', 'reference.config.json'), 'utf8'))
  const modsDir = String(req.modsDir || path.resolve(HERE, '..', '..')).replace(/\\/g, '/')
  const expand = (p) => String(p ?? '').replace(/^~(?=[\\/]|$)/, home).replace(/\\/g, '/')
  const repoPath = (name) => {
    const r = (cfg.repos || []).find((x) => x.name === name) || {}
    const p = (cfg.repo_paths || {})[name] || r.path || ''
    if (p === '@self') return path.resolve(modsDir, '..').replace(/\\/g, '/')
    return p ? expand(p) : ''
  }
  const refPath = (ref) => {
    if (!ref) return ''
    if (typeof ref === 'string') return expand(ref)
    if (ref.path) return expand(ref.path)
    const base = ref.repo ? repoPath(ref.repo) : ''
    return base ? `${base}/${ref.dir || ref.file || ''}`.replace(/\/+$/, '') : ''
  }
  return { cfg, home, modsDir, expand, repoPath, refPath, now: req.now || Date.now(), pluginDirs: req.pluginDirs || [] }
}

const readText = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/^﻿/, '') } catch { return null } }
const readJson = (p) => { try { return JSON.parse(readText(p)) } catch { return null } }
const mtime = (p) => { try { return fs.statSync(p).mtimeMs } catch { return 0 } }
const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: opts.timeoutMs || 30000, cwd: opts.cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } })
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() || (r.error ? String(r.error.message) : '') }
}

function walk(dir, { depth = 3, keep = () => true } = {}, rel = '') {
  const out = []
  let entries = []
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) { if (depth > 1 && !SKIP_DIRS.has(e.name)) out.push(...walk(dir, { depth: depth - 1, keep }, r)) } else if (e.isFile() && keep(r)) out.push(r)
  }
  return out.sort()
}

// ---- À essayer -----------------------------------------------------------------------------------------------------

export function essais(c) {
  const E = c.cfg.essais || {}
  const items = []
  const docs = []
  const missing = []
  for (const src of E.sources || []) {
    const base = c.refPath(src)
    if (!base) { missing.push(src.repo ? `${src.repo} (chemin non réglé)` : String(src.path || src)); continue }
    let files = []
    if (isDir(base)) {
      let re = null
      try { re = src.match ? new RegExp(src.match, 'i') : null } catch { /* bad pattern */ }
      files = walk(base, { depth: 1, keep: (r) => /\.md$/i.test(r) && (!re || re.test(r)) }).map((r) => `${base}/${r}`)
    } else if (fs.existsSync(base)) files = [base]
    else { missing.push(base); continue }
    for (const f of files) {
      const t = readText(f)
      if (t === null) continue
      const name = path.basename(f)
      docs.push({ name, path: f })
      items.push(...itemsOf(name, t, E))
    }
  }
  const manual = E.manual_checks ? manualTodo(readText(c.expand(E.manual_checks)) || '') : []
  const tr = E.tests_reels_dir ? c.expand(E.tests_reels_dir) : ''
  const runs = tr ? (readText(`${tr}/runs.jsonl`) || '').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } }) : []
  const tests = tr ? testsTodo(readJson(`${tr}/registry.json`), runs) : []
  return { at: c.now, items, docs, missing, todo: [...manual, ...tests] }
}

// ---- R&D -----------------------------------------------------------------------------------------------------------

export function rdIndex(c) {
  const R = c.cfg.rd || {}
  const exts = (R.extensions || ['.md', '.html']).map((e) => e.toLowerCase())
  const groups = []
  for (const d of R.dirs || []) {
    const base = c.refPath(d)
    const label = d.label || d.dir || d.path || ''
    if (!base || !isDir(base)) { groups.push({ label, path: base, missing: true, docs: [] }); continue }
    const files = walk(base, { depth: R.depth || 2, keep: (r) => exts.some((e) => r.toLowerCase().endsWith(e)) })
    const docs = files.map((r) => {
      const abs = `${base}/${r}`
      const info = docInfo(path.basename(r), readText(abs) || '', mtime(abs), { lines: R.summary_lines || 3, width: R.summary_width || 160 })
      return { file: r, name: path.basename(r), path: abs, ...info }
    }).sort((a, b) => b.date.localeCompare(a.date) || a.file.localeCompare(b.file))
    groups.push({ label, path: base, missing: false, docs })
  }
  return { at: c.now, groups }
}

// ---- Repos ---------------------------------------------------------------------------------------------------------

function repoState(c, r) {
  const p = c.repoPath(r.name)
  const out = { name: r.name, path: p, main: r.main || 'main', github: r.github || '', exists: !!p && fs.existsSync(path.join(p, '.git')), post_update: r.post_update || [], export: r.export || 'audit' }
  if (!out.exists) return out
  const g = (...a) => sh('git', ['-C', p, ...a])
  out.branch = g('branch', '--show-current').out
  out.sync = aheadBehind(g('rev-list', '--left-right', '--count', 'HEAD...@{u}').out)
  out.last = lastCommit(g('log', '-1', '--format=%h%x09%ct%x09%s').out)
  out.dirty = dirtyCount(g('status', '--porcelain', '--untracked-files=no').out)
  if (!out.github) out.github = slugOf(g('remote', 'get-url', 'origin').out)
  return out
}

export function repos(c, { fresh = false } = {}) {
  const cacheFile = c.expand(`${(c.cfg.paths || {}).reference_dir || '~/.claude/reference-mod'}/repos-cache.json`)
  const cache = readJson(cacheFile) || { prs: {} }
  const ttl = ((c.cfg.repos_prs_ttl_min ?? 10) * 60000)
  const list = (c.cfg.repos || []).map((r) => repoState(c, r))
  let wrote = false
  for (const r of list) {
    if (!r.github) { r.prs = null; continue }
    const hit = cache.prs[r.github]
    if (hit && !fresh && c.now - hit.at < ttl) { r.prs = hit.list; r.prsAt = hit.at; continue }
    const q = sh('gh', ['pr', 'list', '-R', r.github, '--state', 'open', '--json', 'number,title,url', '--limit', '10'], { timeoutMs: 30000 })
    if (q.code === 0) { r.prs = prsOf(q.out); r.prsAt = c.now; cache.prs[r.github] = { at: c.now, list: r.prs }; wrote = true } else { r.prs = hit ? hit.list : null; r.prsError = (q.err || '').split('\n').pop().slice(0, 160) }
  }
  if (wrote) { try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache)) } catch { /* next time */ } }
  return { at: c.now, repos: list }
}

export function repoUpdate(c, name) {
  const r = (c.cfg.repos || []).find((x) => x.name === name)
  if (!r) return { ok: false, error: `repo inconnu : ${name}` }
  const s = repoState(c, r)
  const why = updateBlocker(s)
  if (why) return { ok: false, error: `${name} : pas de mise à jour (${why})` }
  const pull = sh('git', ['-C', s.path, 'pull', '--ff-only'], { timeoutMs: 120000 })
  if (pull.code !== 0) return { ok: false, error: `${name} : git pull --ff-only a échoué (${(pull.err || pull.out).split('\n').pop()})` }
  let post = ''
  if ((r.post_update || []).length) {
    const [cmd, ...args] = r.post_update
    const q = sh(cmd, args, { cwd: s.path, timeoutMs: 300000 })
    if (q.code !== 0) return { ok: false, error: `${name} : à jour, mais ${r.post_update.join(' ')} a échoué (${(q.err || q.out).split('\n').pop()})` }
    post = ` puis ${r.post_update.join(' ')}`
  }
  const last = (pull.out.split('\n').pop() || '').slice(0, 120)
  return { ok: true, msg: `${name} : git pull --ff-only${post} (${last})` }
}

// ---- Exporter pour audit -------------------------------------------------------------------------------------------

function stamp(ms) {
  const d = new Date(ms)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function auditExport(c, { dry = false } = {}) {
  const A = c.cfg.audit || {}
  const max = (A.max_file_kb ?? 512) * 1024
  const exportCfg = readJson(c.expand('~/.claude/export-eta/config.json')) || {}
  const opts = { ...maskOpts({ ...exportCfg, mask_paths: false }), deny: A.deny || [] }
  const entries = []
  const files = []
  const held = []
  const skipped = []
  const counts = {}
  const add = (zipName, abs, { tracked = false } = {}) => {
    if (!tracked && denied(zipName, opts.deny)) { skipped.push({ name: zipName, why: 'liste interdite' }); return }
    if (!isText(zipName)) { skipped.push({ name: zipName, why: 'pas un fichier texte' }); return }
    let size = 0
    try { size = fs.statSync(abs).size } catch { return }
    if (size > max) { skipped.push({ name: zipName, why: `plus de ${A.max_file_kb ?? 512} Ko` }); return }
    const text = readText(abs)
    if (text === null) return
    const r = clean(zipName, text, tracked ? { ...opts, names: false } : opts)
    if (!r.ok) { held.push({ name: zipName, why: r.why }); return }
    addCounts(counts, r.counts)
    entries.push({ name: zipName, data: r.text, mtimeMs: mtime(abs) })
    files.push(zipName)
  }
  const addText = (zipName, text) => {
    const m = mask(text, opts)
    if (check(m.text, opts).length) { held.push({ name: zipName, why: 'secret non masquable' }); return }
    addCounts(counts, m.counts)
    entries.push({ name: zipName, data: m.text })
    files.push(zipName)
  }

  // 1. every mod beside this one: tracked files (git ls-files) when the folder is a git checkout, else a walk
  const repoRoot = path.resolve(c.modsDir, '..')
  const commit = sh('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD']).out
  const tracked = sh('git', ['-C', repoRoot, 'ls-files', '--', 'mods']).out.split(/\r?\n/).filter(Boolean)
  const loaded = new Set(c.pluginDirs.map((d) => path.basename(String(d).replace(/[\\/]+$/, '')).toLowerCase()))
  const mods = []
  for (const name of fs.readdirSync(c.modsDir).sort()) {
    const dir = `${c.modsDir}/${name}`
    const manifestFile = `${dir}/.claude-plugin/plugin.json`
    if (!fs.existsSync(manifestFile)) continue
    const pj = readJson(manifestFile) || {}
    mods.push({ name, version: pj.version || '', commit: sh('git', ['-C', repoRoot, 'log', '-1', '--format=%h', '--', `mods/${name}`]).out, loaded: loaded.has(name.toLowerCase()) })
    const own = tracked.length ? tracked.filter((f) => f.startsWith(`mods/${name}/`)).map((f) => f.slice(`mods/${name}/`.length)) : walk(dir, { depth: 6 })
    for (const rel of own) add(`mods/${name}/${rel}`, `${dir}/${rel}`, { tracked: tracked.length > 0 })
  }
  // 2. local configs: ~/.claude/*.config.json and the config files of each mod's data folder
  const cd = c.expand('~/.claude')
  for (const f of walk(cd, { depth: 1, keep: (r) => /\.config\.json$/i.test(r) })) add(`local/${f}`, `${cd}/${f}`)
  for (const d of A.config_dirs || []) for (const f of walk(`${cd}/${d}`, { depth: 1, keep: (r) => /(^|\.)config\.json$/i.test(r) })) add(`local/${d}/${f}`, `${cd}/${d}/${f}`)
  // 3. CLAUDE_CODE_PLUGIN_DIRS and the settings env keys
  addText('env/CLAUDE_CODE_PLUGIN_DIRS.txt', c.pluginDirs.join('\n') + '\n')
  const settings = readJson(c.expand(A.settings || '~/.claude/settings.json')) || {}
  addText('env/settings-env.json', JSON.stringify(envOf(settings, opts), null, 1))
  // 4. global CLAUDE.md, agents, skills, workflows
  for (const f of A.claude_files || ['CLAUDE.md']) if (fs.existsSync(`${cd}/${f}`)) add(`claude/${f}`, `${cd}/${f}`)
  for (const d of A.claude_dirs || ['agents', 'skills', 'workflows']) for (const f of walk(`${cd}/${d}`, { depth: 4 })) add(`claude/${d}/${f}`, `${cd}/${d}/${f}`)
  // 5. RULES-INVENTORY
  const ri = c.refPath(A.rules_inventory)
  if (ri && fs.existsSync(ri)) add(`rules/${path.basename(ri)}`, ri)
  else skipped.push({ name: 'rules/RULES-INVENTORY.md', why: ri ? 'introuvable' : 'chemin non réglé' })
  // 6. Veille state (never smtp.json)
  const vh = c.expand(A.veille_home || '~/.claude/veille')
  for (const f of A.veille_files || ['state.json', 'config.json', 'heartbeat.json']) if (fs.existsSync(`${vh}/${f}`)) add(`veille/${f}`, `${vh}/${f}`)

  const at = new Date(c.now).toISOString()
  const man = manifest({ at, mods, files, held, skipped, counts, plugin_dirs: c.pluginDirs, commit })
  const out = c.expand(A.out_dir || '~/.claude/audit-exports')
  const file = `${out}/audit-${stamp(c.now)}.zip`
  const result = { ok: true, file, files: files.length, held: held.length, skipped: skipped.length, masked: Object.values(counts).reduce((a, b) => a + b, 0), mods: mods.length }
  if (dry) return { ...result, dry: true, list: files, heldList: held }
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(file, zip([{ name: 'MANIFEST.md', data: man }, ...entries]))
  return result
}

// ---- Exporter vers eta (R&D) ---------------------------------------------------------------------------------------

export function exportRd(c, { dry = false } = {}) {
  const idx = rdIndex(c)
  const exportCfg = readJson(c.expand('~/.claude/export-eta/config.json')) || {}
  const R = c.cfg.rd || {}
  const eta = { ...(exportCfg.eta || {}), ...(R.eta || {}), repo: (R.eta || {}).repo || (exportCfg.eta || {}).repo || '' }
  const dest = String(R.eta?.dest_dir || 'sources/recherches').replace(/\/+$/, '')
  const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'docs'
  const produce = (wt, own) => {
    const mo = maskOpts({ ...exportCfg, mask_paths: true }, own)
    const touched = []
    const held = []
    const index = ['# Recherches', '', `Index réécrit à chaque export par le mod reference (claude-mod), ${new Date(c.now).toISOString().slice(0, 10)}. Secrets masqués.`, '']
    for (const g of idx.groups.filter((x) => !x.missing)) {
      index.push(`## ${g.label}`, '', '| Date | Sujet | Fichier |', '|---|---|---|')
      for (const d of g.docs) {
        const rel = `${dest}/${slug(g.label)}/${d.file}`
        const m = mask(readText(d.path) || '', mo)
        if (check(m.text, mo).length) { held.push(rel); continue }
        if (!dry) { fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true }); fs.writeFileSync(path.join(wt, rel), m.text) }
        touched.push(rel)
        index.push(`| ${d.date} | ${String(d.subject).replace(/\|/g, '\\|')} | [${d.file}](${slug(g.label)}/${d.file}) |`)
      }
      index.push('')
    }
    if (held.length) index.push(`Retenus (secret non masquable) : ${held.join(', ')}`, '')
    if (!touched.length) return { empty: 'aucune recherche à exporter', touched }
    if (!dry) { fs.mkdirSync(path.join(wt, dest), { recursive: true }); fs.writeFileSync(path.join(wt, dest, 'INDEX.md'), index.join('\n')) }
    touched.push(`${dest}/INDEX.md`)
    return { touched, held, body: `Recherches exportées par le mod reference : ${touched.length - 1} fichier(s), ${held.length} retenu(s).` }
  }
  if (dry) { const p = produce('', []); return { ok: true, dry: true, files: p.touched?.length || 0, held: p.held?.length || 0 } }
  if (!eta.repo) return { ok: false, error: 'eta.repo non réglé : mets-le dans ~/.claude/export-eta/config.json' }
  const git = landInEta({
    eta: { ...eta, branch: R.eta?.branch || 'export/recherches-{day}-{hm}', worktree_dir: R.eta?.worktree_dir || '.claude/worktrees/recherches-{day}-{hm}' },
    home: c.expand((c.cfg.paths || {}).reference_dir || '~/.claude/reference-mod'), mask: exportCfg, addPaths: [dest],
    title: `Recherches (${new Date(c.now).toISOString().slice(0, 10)})`, nowMs: c.now, produce,
  })
  return { ok: !git.error, url: git.url, merged: git.merged, error: git.error, files: git.produced?.touched?.length || 0 }
}

// ---- main ----------------------------------------------------------------------------------------------------------

export async function main(argv, stdinText) {
  let req = {}
  try { req = stdinText ? JSON.parse(stdinText) : {} } catch { /* defaults */ }
  const c = context(req)
  const [cmd, arg] = argv
  const flag = (f) => argv.includes(f)
  if (cmd === 'essais') return essais(c)
  if (cmd === 'rd') return rdIndex(c)
  if (cmd === 'repos') return repos(c, { fresh: flag('--fresh') })
  if (cmd === 'repo-update') return repoUpdate(c, arg)
  if (cmd === 'audit-export') return auditExport(c, { dry: flag('--dry-run') })
  if (cmd === 'export-rd') return exportRd(c, { dry: flag('--dry-run') })
  return { ok: false, error: `commande inconnue : ${cmd || '(vide)'}` }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const chunks = []
  const go = () => main(process.argv.slice(2), Buffer.concat(chunks).toString('utf8'))
    .then((r) => { process.stdout.write(JSON.stringify(r)); process.exitCode = r && r.ok === false ? 1 : 0 })
    .catch((e) => { process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 300) })); process.exitCode = 1 })
  if (process.stdin.isTTY) go()
  else { process.stdin.on('data', (d) => chunks.push(d)); process.stdin.on('end', go) }
}
