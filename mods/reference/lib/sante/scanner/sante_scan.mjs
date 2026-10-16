// sante mod scanner (Node 22.18+, standard library only): the file facts of every mod, as JSON on stdout.
//   node sante_scan.mjs < request.json        request: { dirs: [...], home, cfg, now }  (what the mod sends)
//   node sante_scan.mjs [--dirs "a;b"]        from a shell: dirs default to CLAUDE_CODE_PLUGIN_DIRS
// For each mod folder: plugin.json and hooks.json (valid JSON, module present, slash commands it registers), every
// JSON file at its root and the user config files named in sante.config.json (valid or not), its cache files and
// folders (size on disk, newest change), its logs (error lines), error fields inside its outputs, and its health
// record (~/.claude/mods-health/<mod>.json, the shared convention). Read-only on everything except its own
// report (<data_dir>/report.json) and its own health record. Never deletes anything.
// The folder lists come from lib/core/mods.mjs (splitDirs, listMods), the health record from lib/core/health.mjs; the
// record also carries `findings`: the red and orange lines of the pane, for the Problèmes register.
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { deepMerge, evaluate, expandHome, getPath, registeredCommands } from '../hooks/logic.mjs'
import { writeHealth as coreWriteHealth } from '../lib/core/health.mjs'
import { listMods, splitDirs } from '../lib/core/mods.mjs'
import { writeAtomic } from '../lib/core/util.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const slash = p => String(p).replace(/\\/g, '/')
const MAX_JSON = 8 * 1024 * 1024

/** A JSON file: { path, ok, error?, bytes, mtime, value? } (value kept only when asked). */
export function readJson(path, keep = false) {
  const out = { path: slash(path), ok: false, bytes: 0, mtime: 0 }
  try {
    const st = statSync(path)
    out.bytes = st.size
    out.mtime = st.mtimeMs
    if (st.size > MAX_JSON) return { ...out, ok: true, skipped: true }
    const text = readFileSync(path, 'utf8').replace(/^﻿/, '')
    const value = JSON.parse(text)
    return { ...out, ok: true, ...(keep ? { value } : {}) }
  } catch (err) {
    return { ...out, error: String(err?.code === 'ENOENT' ? 'absent' : err?.message ?? err).slice(0, 200) }
  }
}

/** Size on disk of a file or folder (sum of file sizes), file count and newest change; stops after maxFiles. */
export function diskUsage(path, maxFiles = 20000) {
  const out = { path: slash(path), exists: false, bytes: 0, files: 0, newest: 0, truncated: false }
  let st
  try {
    st = statSync(path)
  } catch {
    return out
  }
  out.exists = true
  if (!st.isDirectory()) return { ...out, kind: 'file', bytes: st.size, files: 1, newest: st.mtimeMs }
  out.kind = 'dir'
  const stack = [path]
  while (stack.length) {
    const d = stack.pop()
    let entries = []
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile()) {
        if (out.files >= maxFiles) {
          out.truncated = true
          return out
        }
        try {
          const s = statSync(p)
          out.bytes += s.size
          out.files += 1
          if (s.mtimeMs > out.newest) out.newest = s.mtimeMs
        } catch {}
      }
    }
  }
  return out
}

/** Error lines in the last `tailBytes` of a log: count and the last one. */
export function logErrors(path, pattern = 'error|exception|traceback|fatal', tailBytes = 65536) {
  const out = { path: slash(path), exists: false, errors: 0, last: '' }
  try {
    const st = statSync(path)
    out.exists = true
    out.mtime = st.mtimeMs
    const n = Math.min(st.size, tailBytes)
    const buf = Buffer.alloc(n)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buf, 0, n, st.size - n)
    } finally {
      closeSync(fd)
    }
    const re = new RegExp(pattern, 'i')
    const hits = buf.toString('utf8').split(/\r?\n/).filter(l => re.test(l))
    out.errors = hits.length
    out.last = (hits[hits.length - 1] || '').trim().slice(0, 200)
  } catch {}
  return out
}

/** Every source file under hooks/ (one level) as text, to find the slash commands the mod registers. */
function hookSources(dir) {
  const hooks = join(dir, 'hooks')
  try {
    return readdirSync(hooks)
      .filter(f => /\.(m?[jt]sx?)$/.test(f))
      .map(f => readFileSync(join(hooks, f), 'utf8'))
      .join('\n')
  } catch {
    return ''
  }
}

/** The facts of one mod folder. */
export function inspectMod(dir, source, cfg, home, healthDir, nameHint) {
  const d = slash(dir)
  const exists = existsSync(d) && statSync(d).isDirectory()
  const m = { key: d.toLowerCase(), dir: d, source, exists, name: nameHint || basename(d), expected: [], configs: [], caches: [], logs: [], fields: [] }
  if (!exists) return m
  const man = readJson(join(d, '.claude-plugin', 'plugin.json'), true)
  m.manifest = { ok: man.ok, error: man.error }
  if (man.ok && man.value) {
    m.name = String(man.value.name || m.name)
    m.manifest.version = man.value.version
    // Not a documented plugin.json field: read only if a mod declares it (« non vérifié »).
    const min = man.value.claudeCode?.minVersion ?? man.value.engines?.['claude-code']
    if (min) m.manifest.min_version = String(min).replace(/^[>=^~\s]+/, '')
  }
  const hj = readJson(join(d, 'hooks', 'hooks.json'), true)
  if (hj.ok) {
    const mods = Array.isArray(hj.value?.modules) ? hj.value.modules : []
    const missing = mods.filter(p => !existsSync(join(d, 'hooks', p)))
    m.hooks = missing.length ? { ok: false, error: `module absent : ${missing.join(', ')}` } : { ok: true, modules: mods }
  } else m.hooks = hj.error === 'absent' ? { ok: true, modules: [] } : { ok: false, error: `hooks.json : ${hj.error}` }
  m.expected = registeredCommands(hookSources(d))

  const per = (cfg.mods || {})[m.name] || {}
  const skip = new RegExp(cfg.skip_json || 'cache', 'i')
  let rootJson = []
  try {
    rootJson = readdirSync(d).filter(f => f.endsWith('.json') && !skip.test(f))
  } catch {}
  const configPaths = [
    join(d, '.claude-plugin', 'plugin.json'),
    join(d, 'hooks', 'hooks.json'),
    ...rootJson.map(f => join(d, f)),
    ...(per.configs || []).map(p => expandHome(p, home)),
  ]
  const seen = new Set()
  for (const p of configPaths) {
    const k = slash(p).toLowerCase()
    if (seen.has(k) || !existsSync(p)) continue
    seen.add(k)
    const r = readJson(p)
    m.configs.push({ path: r.path, ok: r.ok, error: r.error, bytes: r.bytes, mtime: r.mtime })
  }
  for (const p of per.caches || []) {
    const u = diskUsage(expandHome(p, home), cfg.size_max_files ?? 20000)
    if (u.exists) m.caches.push(u)
  }
  for (const p of per.logs || []) {
    const l = logErrors(expandHome(p, home), cfg.log_pattern, cfg.log_tail_bytes)
    if (l.exists) m.logs.push(l)
  }
  for (const f of per.error_fields || []) {
    const r = readJson(expandHome(f.file, home), true)
    if (!r.ok || !r.value) continue
    const v = getPath(r.value, f.field)
    const list = Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []
    m.fields.push({ path: r.path, field: f.field, count: list.length, last: String(list[list.length - 1] ?? '').slice(0, 200) })
  }
  m.health = readHealth(healthDir, m.name)
  return m
}

/** ~/.claude/mods-health/<mod>.json, parsed; { invalid } when it is not JSON; undefined when absent. */
export function readHealth(healthDir, name) {
  const r = readJson(join(healthDir, `${name}.json`), true)
  if (r.ok && r.value && typeof r.value === 'object') return r.value
  if (!r.ok && r.error !== 'absent') return { invalid: r.error }
  return undefined
}

/** Subfolders of `root` that hold a .claude-plugin/plugin.json: the mods core listMods() reads, plus those whose
 * plugin.json does not parse (listMods skips them; here they must show red). */
function modFolders(root) {
  const out = listMods(root).map(m => m.dir)
  const seen = new Set(out.map(d => d.toLowerCase()))
  try {
    for (const e of readdirSync(root, { withFileTypes: true })) {
      const d = slash(join(root, e.name))
      if (e.isDirectory() && !seen.has(d.toLowerCase()) && existsSync(join(d, '.claude-plugin', 'plugin.json'))) out.push(d)
    }
  } catch {}
  return out.sort((a, b) => basename(a).localeCompare(basename(b)))
}

/** Plugins installed from a marketplace (installed_plugins.json, format « non vérifié »): { name, dir }[]. */
export function installedPlugins(file) {
  const r = readJson(file, true)
  if (!r.ok || !r.value) return []
  const map = r.value.plugins && typeof r.value.plugins === 'object' ? r.value.plugins : r.value
  const out = []
  for (const [id, v] of Object.entries(map)) {
    if (!id.includes('@')) continue
    for (const e of Array.isArray(v) ? v : [v]) if (e && typeof e === 'object' && e.installPath) out.push({ name: id.split('@')[0], dir: slash(e.installPath) })
  }
  return out
}

/** The whole report: env mods first, then installed-not-loaded folders, marketplace plugins and orphan records. */
export function scan(req) {
  const cfg = req.cfg || {}
  const home = slash(req.home || homedir())
  const healthDir = expandHome(cfg.health_dir || '~/.claude/mods-health', home)
  const mods = []
  const names = new Set()
  const keys = new Set()
  const push = m => {
    if (keys.has(m.key)) return
    if (m.source !== 'env' && names.has(m.name)) return // a copy of a mod already loaded from elsewhere
    keys.add(m.key)
    names.add(m.name)
    mods.push(m)
  }
  for (const d of req.dirs || []) push(inspectMod(d, 'env', cfg, home, healthDir))
  const roots = [...(cfg.extra_dirs || []).map(p => expandHome(p, home)), ...(cfg.siblings !== false && req.siblings ? req.siblings : [])]
  for (const root of roots) for (const d of modFolders(root)) push(inspectMod(d, 'dir', cfg, home, healthDir))
  if (cfg.installed_plugins_file) {
    for (const p of installedPlugins(expandHome(cfg.installed_plugins_file, home))) if (!names.has(p.name)) push(inspectMod(p.dir, 'marketplace', cfg, home, healthDir, p.name))
  }
  try {
    for (const f of readdirSync(healthDir)) {
      const name = f.replace(/\.json$/, '')
      if (!f.endsWith('.json') || names.has(name)) continue
      push({ key: `health:${name}`, name, dir: '', source: 'health', exists: false, expected: [], configs: [], caches: [], logs: [], fields: [], health: readHealth(healthDir, name) })
    }
  } catch {}
  return { generated: req.now || Date.now(), home: '~', healthDir: slash(healthDir).replace(home, '~'), mods }
}

/**
 * The red and orange lines of the pane (evaluate() of hooks/logic.mjs, with the session's commands and engine version
 * when the hook sent them): [{ level: 'error' | 'warn', mod, text }].
 */
export function findingsOf(report, { commands = [], engine, cfg = {}, now = Date.now() } = {}) {
  const { rows } = evaluate(report, { commands, engine, cfg, now })
  const out = []
  for (const r of rows) for (const x of r.reasons) if (x.level === 'error' || x.level === 'warn') out.push({ level: x.level, mod: r.name, text: x.text })
  return out
}

/**
 * Writes this scanner's health record through lib/core/health.mjs (the shared convention), then adds `findings` to it
 * (best effort, never throws). `env` carries MODS_HEALTH_DIR / MODS_HEALTH like process.env.
 */
export function writeHealth(error, findings = [], env = process.env, now = Date.now()) {
  const rec = coreWriteHealth('sante', error, env, now)
  if (!rec) return undefined
  try {
    const dir = env.MODS_HEALTH_DIR || join(homedir(), '.claude', 'mods-health')
    const full = { ...rec, findings: findings.slice(0, 200) }
    writeAtomic(join(dir, 'sante.json'), JSON.stringify(full))
    return full
  } catch {
    return rec
  }
}

function cliRequest(argv) {
  const i = argv.indexOf('--dirs')
  const base = JSON.parse(readFileSync(join(here, '..', 'sante.config.json'), 'utf8'))
  const home = slash(homedir())
  const dataDir = expandHome(base.data_dir || '~/.claude/sante-mod', home)
  let user = {}
  try {
    user = JSON.parse(readFileSync(join(dataDir, 'sante.config.json'), 'utf8'))
  } catch {}
  return { dirs: splitDirs(i >= 0 ? argv[i + 1] : process.env.CLAUDE_CODE_PLUGIN_DIRS), home, cfg: deepMerge(base, user), now: Date.now(), siblings: [slash(join(here, '..', '..'))] }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let req = {}
  let error = null
  let report
  try {
    const stdin = process.stdin.isTTY ? '' : readFileSync(0, 'utf8')
    req = stdin.trim() ? JSON.parse(stdin) : cliRequest(process.argv.slice(2))
    report = scan(req)
    const dataDir = expandHome(req.cfg?.data_dir || '~/.claude/sante-mod', slash(req.home || homedir()))
    try {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'report.json.tmp'), JSON.stringify(report))
      renameSync(join(dataDir, 'report.json.tmp'), join(dataDir, 'report.json'))
    } catch {}
    process.stdout.write(JSON.stringify(report))
  } catch (err) {
    error = String(err?.message ?? err).slice(0, 300)
    process.stdout.write(JSON.stringify({ error }))
    process.exitCode = 1
  }
  if (req.cfg?.write_own_health !== false && process.env.MODS_HEALTH !== '0') {
    const healthDir = process.env.MODS_HEALTH_DIR || expandHome(req.cfg?.health_dir || '~/.claude/mods-health', slash(req.home || homedir()))
    let findings = []
    try {
      if (report) findings = findingsOf(report, { commands: req.commands || [], engine: req.engine, cfg: req.cfg || {}, now: req.now || Date.now() })
    } catch {}
    writeHealth(error, findings, { ...process.env, MODS_HEALTH_DIR: healthDir })
  }
}
