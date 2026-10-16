// band mod scanner: incremental tail of ~/.claude/projects/**/*.jsonl, then the view the mod draws, as JSON on stdout.
//   node scan.mjs < request.json      request: { projects_root, cache_file, session?, cwd?, now?, cfg }
//   node scan.mjs --root <dir> [--cache <file>] [--session <id>] [--cwd <dir>] [--config <band.config.json>]
// Read-only on the transcripts; writes only its cache file (offsets per file, the events of the kept window, session
// facts). Each run reads only the bytes appended since the last run. Needs Node 22.18+ (it imports the .ts modules).
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildView, deepMerge, expandHome, repoKey } from '../hooks/logic.ts'
import { classifyPath, emptyMeta, ownUsage, parseLines, prune } from '../hooks/parse.ts'
import { writeHealth } from './health.mjs'
import { readVeille } from '../lib/core/veille.mjs'

const CHUNK = 8 * 1024 * 1024

/**
 * The shared parser and price table of lib/core (transcripts.mjs usageOf and costOf, prices.json), from this mod's
 * own synced copy (mods/band/lib/core, scripts/sync-libs.mjs): no import outside the mod folder. Else band's fallback
 * parser and the `rates` of band.config.json. `shared_lib: "off"` forces the fallback.
 */
export async function sharedLib(cfg) {
  if (cfg.shared_lib === 'off') return undefined
  try {
    const lib = await import(new URL('../lib/core/transcripts.mjs', import.meta.url).href)
    const prices = JSON.parse(readFileSync(new URL('../lib/core/prices.json', import.meta.url), 'utf8'))
    if (typeof lib.usageOf !== 'function' || typeof lib.costOf !== 'function') return undefined
    return {
      name: 'lib/core',
      extract: lib.usageOf,
      price: e => lib.costOf([e.u.inp, e.u.out, e.u.cr, e.u.cw - (e.u.cw1h ?? 0), e.u.cw1h ?? 0], e.m, prices),
    }
  } catch {
    return undefined
  }
}

/**
 * « À toi : N » and « attend Julian : N » from lib/core/veille.mjs, the one count every view uses. sections.veille_home
 * / todo_home move the folders (VEILLE_HOME / AFAIRE_HOME win); "" turns that counter off (0).
 */
export function waitingOf(cfg, env = process.env) {
  const s = cfg?.sections ?? {}
  const vOff = s.veille_home === '' || s.veille_home === false
  const aOff = s.todo_home === '' || s.todo_home === false
  const r = readVeille({ veilleHome: env.VEILLE_HOME || s.veille_home || undefined, afaireHome: env.AFAIRE_HOME || s.todo_home || undefined, env })
  return {
    aToi: aOff ? 0 : r.aToi,
    julian: vOff ? 0 : r.julian,
    available: !vOff && r.available,
    aToiAvailable: !aOff && r.aToiAvailable,
  }
}

const readStdin = () => {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

export function loadRequest(argv) {
  const arg = k => {
    const i = argv.indexOf(k)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const here = dirname(fileURLToPath(import.meta.url))
  const shipped = JSON.parse(readFileSync(join(here, '..', 'band.config.json'), 'utf8'))
  let req = {}
  if (!arg('--root')) {
    const text = readStdin()
    if (text.trim()) req = JSON.parse(text)
  }
  const extra = arg('--config') ? JSON.parse(readFileSync(arg('--config'), 'utf8')) : undefined
  const cfg = deepMerge(deepMerge(shipped, extra), req.cfg)
  const home = homedir()
  return {
    projects_root: expandHome(arg('--root') ?? req.projects_root ?? cfg.projects_root, home),
    cache_file: expandHome(arg('--cache') ?? req.cache_file ?? cfg.cache_file, home),
    session: arg('--session') ?? req.session,
    cwd: arg('--cwd') ?? req.cwd,
    now: Number(arg('--now') ?? req.now ?? Date.now()),
    cfg,
  }
}

const listFiles = root => {
  const out = []
  const push = (abs, rel) => {
    try {
      const st = statSync(abs)
      out.push({ abs, rel, size: st.size, mtime: st.mtimeMs })
    } catch {}
  }
  const dirs = (p, f) => {
    try {
      return readdirSync(p, { withFileTypes: true }).filter(f)
    } catch {
      return []
    }
  }
  for (const proj of dirs(root, d => d.isDirectory())) {
    const pdir = join(root, proj.name)
    for (const e of dirs(pdir, () => true)) {
      if (e.isFile() && e.name.endsWith('.jsonl')) push(join(pdir, e.name), `${proj.name}/${e.name}`)
      else if (e.isDirectory()) {
        const sub = join(pdir, e.name, 'subagents')
        for (const f of dirs(sub, () => true)) {
          if (f.isFile() && f.name.endsWith('.jsonl')) push(join(sub, f.name), `${proj.name}/${e.name}/subagents/${f.name}`)
          else if (f.isDirectory() && f.name === 'workflows') {
            for (const wf of dirs(join(sub, 'workflows'), d => d.isDirectory())) {
              for (const a of dirs(join(sub, 'workflows', wf.name), d => d.isFile() && d.name.endsWith('.jsonl'))) {
                push(join(sub, 'workflows', wf.name, a.name), `${proj.name}/${e.name}/subagents/workflows/${wf.name}/${a.name}`)
              }
            }
          }
        }
      }
    }
  }
  return out
}

/** Repo root of a working directory: worktree markers first, then the nearest .git (a worktree's .git file leads to its repo). */
export const repoRoot = (cwd, markers) => {
  const key = repoKey(cwd, markers)
  let p = key
  for (let i = 0; i < 30 && p; i++) {
    const g = join(p, '.git')
    if (existsSync(g)) {
      try {
        if (statSync(g).isFile()) {
          const m = /gitdir:\s*(.+)/.exec(readFileSync(g, 'utf8'))
          const gd = m?.[1].trim().replace(/\\/g, '/')
          const cut = gd?.indexOf('/.git/worktrees/') ?? -1
          if (gd && cut > 0) return repoKey(gd.slice(0, cut), markers)
        }
      } catch {}
      return repoKey(p, markers)
    }
    const up = dirname(p)
    if (up === p) break
    p = up
  }
  return key
}

export function scan(req, lib) {
  const t0 = Date.now()
  const { cfg, now } = req
  const extract = lib?.extract ?? ownUsage
  const keepS = Math.max(...cfg.windows_s, cfg.spark_min * 60, cfg.context.growth_window_s)
  const keepFrom = now - keepS * 1000
  const compactFrom = now - cfg.compact_history_hours * 3600000
  let cache = { v: 1, files: {}, events: [], sessions: {}, repos: {} }
  try {
    const c = JSON.parse(readFileSync(req.cache_file, 'utf8'))
    if (c?.v === 1) cache = { ...cache, ...c }
  } catch {}
  const files = listFiles(req.projects_root)
  let read = 0
  for (const f of files) {
    if (f.mtime < compactFrom) continue
    const kind = classifyPath(f.rel)
    if (!kind) continue
    let st = cache.files[f.rel]
    if (!st || f.size < st.off) {
      const cap = cfg.first_read_mb * 1024 * 1024
      st = { off: f.size > cap ? f.size - cap : 0, skipPartial: f.size > cap, st: {} }
    }
    if (f.size > st.off) {
      const meta = (cache.sessions[kind.s] ??= emptyMeta(kind.s))
      const fd = openSync(f.abs, 'r')
      try {
        let off = st.off
        let carry = ''
        while (off < f.size) {
          const buf = Buffer.alloc(Math.min(CHUNK, f.size - off))
          const n = readSync(fd, buf, 0, buf.length, off)
          if (n <= 0) break
          off += n
          let text = carry + buf.subarray(0, n).toString('utf8')
          if (st.skipPartial) {
            text = text.slice(text.indexOf('\n') + 1)
            st.skipPartial = false
          }
          const cut = text.lastIndexOf('\n')
          if (cut < 0) {
            carry = text
            continue
          }
          parseLines(text.slice(0, cut + 1), kind, st.st, meta, cache.events, keepFrom, extract)
          carry = text.slice(cut + 1)
        }
        st.off = off - Buffer.byteLength(carry, 'utf8')
      } finally {
        closeSync(fd)
      }
      read++
    }
    st.size = f.size
    st.mtime = f.mtime
    cache.files[f.rel] = st
  }
  for (const rel of Object.keys(cache.files)) if ((cache.files[rel].mtime ?? 0) < compactFrom) delete cache.files[rel]
  cache.events = prune(cache.events, cache.sessions, keepFrom, compactFrom)
  for (const m of Object.values(cache.sessions)) {
    if (!m.cwd) continue
    m.repo = cache.repos[m.cwd] ??= repoRoot(m.cwd, cfg.worktree_markers)
  }
  const cwdRepo = req.cwd ? (cache.repos[req.cwd] ??= repoRoot(req.cwd, cfg.worktree_markers)) : undefined
  try {
    mkdirSync(dirname(req.cache_file), { recursive: true })
    writeFileSync(req.cache_file + '.tmp', JSON.stringify(cache))
    renameSync(req.cache_file + '.tmp', req.cache_file)
  } catch {}
  return buildView(cache.events, cache.sessions, cfg, {
    now,
    session: req.session,
    cwd: cwdRepo,
    files: read,
    ms: Date.now() - t0,
    ...(lib ? { price: lib.price, lib: lib.name } : {}),
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const req = loadRequest(process.argv.slice(2))
    const view = scan(req, await sharedLib(req.cfg))
    let waiting
    try {
      waiting = waitingOf(req.cfg)
    } catch {}
    process.stdout.write(JSON.stringify(waiting ? { ...view, waiting } : view))
    writeHealth('band')
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: String(err?.stack ?? err).slice(0, 800) }))
    process.exitCode = 1
    writeHealth('band', String(err?.message ?? err))
  }
}
