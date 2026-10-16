// menage mod scanner (Node 22+, standard library only). Read-only inventory of what Claude work left on this PC.
//   node menage_scan.mjs scan [--force] [--data-dir DIR] [--now MS]   write <data_dir>/menage.json, print one JSON line
//   node menage_scan.mjs report [--force]                             scan, then print every row and its command
// Runs only read-only git commands (worktree list, status, branch --merged, for-each-ref, merge-base, diff --quiet,
// log, remote get-url) with GIT_OPTIONAL_LOCKS=0 so status does not rewrite the index. Never fetches, never deletes,
// never runs a command it shows. Folder sizes: scanner/sizes.ps1 (pwsh) on Windows, a Node walk elsewhere, cached in
// <data_dir>/sizes.json for sizes.ttl_min. Writes only its data folder.
import { execFile } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  archivable, branchRow, command, deepMerge, expand, fill, fmtAge, fmtBytes, mergeState, norm, parseStatus, parseWorktrees,
  pathKey, pluginDirs, prFor, prIndex, short, slugOf, splitOld, totals, unset, worktreeRow,
} from '../lib/classify.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const readJson = p => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return undefined
  }
}
const saveJson = (path, obj) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, JSON.stringify(obj))
  renameSync(`${path}.tmp`, path)
}
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : dflt
}

export function envVars() {
  const home = norm(homedir())
  return { ...process.env, HOME: home, USERPROFILE: process.env.USERPROFILE || home, TEMP: process.env.TEMP || process.env.TMP || norm(tmpdir()), APPDATA: process.env.APPDATA || `${home}/AppData/Roaming` }
}

export function config(dataDirArg, env = envVars()) {
  const base = readJson(join(root, 'menage.config.json')) || {}
  const dataDir = expand(dataDirArg || base.data_dir || '~/.claude/menage-mod', env)
  const cfg = deepMerge(base, readJson(join(dataDir, 'menage.config.json')) || {})
  return { cfg, dataDir, env }
}

const run = (file, args, { timeout = 30000, env, cwd, input } = {}) =>
  new Promise(res => {
    const child = execFile(file, args, { encoding: 'utf8', timeout, env, cwd, maxBuffer: 64 << 20, windowsHide: true }, (err, stdout) => res({ ok: !err, out: stdout || '' }))
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })

/** Runs async jobs with at most n at once. */
async function pool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) {
      const k = i++
      out[k] = await fn(items[k], k)
    }
  }))
  return out
}

// ---------- disk ----------

const isDir = p => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
const children = p => {
  try {
    return readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => norm(join(p, e.name)))
  } catch {
    return []
  }
}
const entriesAt = (p, depth) => {
  let cur = [norm(p)]
  for (let i = 0; i < depth; i++) cur = cur.flatMap(children)
  return cur
}
const mtime = p => {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}

/** Size of a folder by walking it (links and junctions not followed): bytes, files, newest mtime. */
export function dirSize(dir, max = 400000) {
  const out = { bytes: 0, files: 0, newest: 0, truncated: false }
  const stack = [dir]
  let seen = 0
  while (stack.length) {
    const d = stack.pop()
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (++seen > max) {
        out.truncated = true
        return out
      }
      const p = join(d, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        stack.push(p)
        continue
      }
      try {
        const st = lstatSync(p)
        out.bytes += st.size
        out.files++
        if (st.mtimeMs > out.newest) out.newest = st.mtimeMs
      } catch {}
    }
  }
  return out
}

/** Sizes of many folders: cached ones younger than ttl, the rest by sizes.ps1 (Windows, pwsh) or the Node walk. */
export async function sizeAll(paths, { cfg, dataDir, now, force }) {
  const sc = cfg.sizes || {}
  const cacheFile = join(dataDir, 'sizes.json')
  const cache = force ? {} : readJson(cacheFile) || {}
  const ttl = (sc.ttl_min ?? 720) * 60000
  const max = cfg.repos?.size_max_entries ?? 400000
  const want = [...new Set(paths.map(norm))]
  const todo = want.filter(p => !(cache[pathKey(p)] && now - cache[pathKey(p)].at < ttl))
  const useShell = (sc.method || 'auto') === 'powershell' || ((sc.method || 'auto') === 'auto' && process.platform === 'win32')
  let done = false
  if (useShell && todo.length) {
    const chunks = Array.from({ length: Math.min(sc.concurrency ?? 3, todo.length) }, () => [])
    todo.forEach((p, i) => chunks[i % chunks.length].push(p))
    const results = await pool(chunks, chunks.length, c =>
      run(sc.powershell || 'pwsh', ['-NoProfile', '-NonInteractive', '-File', join(here, 'sizes.ps1'), String(max)], { timeout: (cfg.scan_timeout_s ?? 600) * 1000, input: `${c.join('\n')}\n` }))
    if (results.every(r => r.ok)) {
      for (const r of results) {
        for (const line of r.out.split(/\r?\n/)) {
          const [b, n, m, cut, ...p] = line.split('\t')
          if (!p.length) continue
          cache[pathKey(p.join('\t'))] = { bytes: Number(b), files: Number(n), newest: Number(m), truncated: cut === '1', at: now }
        }
      }
      done = true
    }
  }
  if (!done) for (const p of todo) cache[pathKey(p)] = { ...dirSize(p, max), at: now }
  const keep = {}
  for (const p of want) if (cache[pathKey(p)]) keep[pathKey(p)] = cache[pathKey(p)]
  saveJson(cacheFile, keep)
  return p => keep[pathKey(p)] || { bytes: 0, files: 0, newest: 0, truncated: false }
}

const sizeText = s => `${s.truncated ? '≥ ' : ''}${fmtBytes(s.bytes)}`

// ---------- git (read-only) ----------

function gitRunner(timeoutMs) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
  return async (cwd, args, { ok = false, input } = {}) => {
    const r = await run('git', ['-C', cwd, ...args], { timeout: timeoutMs, env, input })
    return ok ? r.ok : r.ok ? r.out : undefined
  }
}

/** Git repos (folders with a .git directory) under the roots, down to maxDepth. */
export function findRepos(roots, maxDepth = 2, skip = []) {
  const out = []
  const skipSet = new Set(skip.map(s => s.toLowerCase()))
  const visit = (dir, depth) => {
    if (isDir(join(dir, '.git'))) {
      out.push(norm(dir))
      return
    }
    if (depth >= maxDepth) return
    for (const c of children(dir)) if (!skipSet.has(c.split('/').pop().toLowerCase())) visit(c, depth + 1)
  }
  for (const r of roots) if (isDir(r)) visit(norm(r), 0)
  return out
}

async function baseRef(git, repo, rc) {
  const remote = rc.remote || 'origin'
  for (const b of rc.base || ['main', 'master']) if (await git(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${b}`], { ok: true })) return { ref: `${remote}/${b}`, name: b }
  for (const b of rc.base || ['main', 'master']) if (await git(repo, ['rev-parse', '--verify', '-q', `refs/heads/${b}`], { ok: true })) return { ref: b, name: b }
  return undefined
}

/** Patch ids of the last n first-parent commits of base (a squash commit has its branch's whole diff as patch). */
async function basePatchIds(git, repo, base, n) {
  const log = await git(repo, ['log', '--first-parent', '-n', String(n), '-p', '--no-color', '--format=commit %H', base])
  if (!log) return new Set()
  const ids = await git(repo, ['patch-id', '--stable'], { input: log })
  return new Set((ids || '').split(/\r?\n/).map(l => l.split(' ')[0]).filter(Boolean))
}

/**
 * Squash check, two ways: the files the ref changed since its merge base are identical in base (3 git calls), or the
 * ref's whole diff has the patch id of one of base's recent commits (2 more), which still holds after main changed
 * those files again.
 */
async function squashMerged(git, repo, ref, base, patchIds) {
  const mb = ((await git(repo, ['merge-base', base, ref])) || '').trim()
  if (!mb) return false
  const files = ((await git(repo, ['diff', '--name-only', mb, ref])) || '').split(/\r?\n/).filter(Boolean)
  if (!files.length) return false
  if (files.length <= 300 && (await git(repo, ['diff', '--quiet', ref, base, '--', ...files], { ok: true }))) return true
  const ids = await patchIds()
  if (!ids.size) return false
  const diff = await git(repo, ['diff', '--no-color', mb, ref])
  if (!diff) return false
  const id = (((await git(repo, ['patch-id', '--stable'], { input: `commit ${'0'.repeat(40)}\n${diff}` })) || '').split(' ')[0] || '').trim()
  return !!id && ids.has(id)
}

// ---------- repos ----------

async function scanRepo(repo, ctx) {
  const { cfg, git, prs, L, roots, budget } = ctx
  const rc = cfg.repos || {}
  const res = { worktrees: [], orphans: [], branches: [], remote: [], errors: [] }
  const base = await baseRef(git, repo, rc)
  const slug = slugOf((await git(repo, ['remote', 'get-url', rc.remote || 'origin'])) || '')
  const mergeLabels = { ancestor: L.ancestor, empty: L.empty_branch, squash: L.squash, pr: L.pr, gone: L.gone, no: L.unmerged }
  const lines = t => (t || '').split(/\r?\n/).filter(Boolean)
  const mergedLocal = new Set(base ? lines(await git(repo, ['branch', '--merged', base.ref, '--format=%(refname:short)'])) : [])
  const remote = rc.remote || 'origin'
  const mergedRemote = new Set(base && rc.remote_branches !== false ? lines(await git(repo, ['branch', '-r', '--merged', base.ref, '--format=%(refname:short)'])) : [])
  const tracking = {}
  const tips = {}
  for (const line of lines(await git(repo, ['for-each-ref', '--format=%(refname:short)\t%(objectname)\t%(upstream:track)', 'refs/heads']))) {
    const [name, sha, track] = line.split('\t')
    tracking[name] = track || ''
    tips[name] = sha
  }
  const baseTip = base ? ((await git(repo, ['rev-parse', base.ref])) || '').trim() : ''
  const protectedSet = new Set(rc.protected || [])
  const repoBudget = { left: rc.squash_check_max ?? 40 }
  let pids
  const patchIds = () => (pids ??= base ? basePatchIds(git, repo, base.ref, rc.patch_id_commits ?? 400) : Promise.resolve(new Set()))
  /** mergeState for a ref; squash check only within the per-repo and global budgets. */
  const facts = async (ref, branch, merged, squashFirst = false) => {
    if (!base) return { merged: false, how: 'no', label: L.base_missing }
    const f = { ancestor: merged.has(ref), empty: false, squash: false, pr: prFor(prs, slug, branch), gone: branch ? /\[gone\]/.test(tracking[branch] || '') : false }
    if (f.ancestor) f.empty = !!baseTip && tips[branch] === baseTip
    if (!f.ancestor && !(f.pr && f.pr.state === 'MERGED') && (squashFirst || (repoBudget.left > 0 && budget.left > 0))) {
      if (!squashFirst) {
        repoBudget.left--
        budget.left--
      }
      f.squash = await squashMerged(git, repo, ref, base.ref, patchIds)
    }
    return mergeState(f, mergeLabels)
  }

  // worktrees (the first one listed is the main checkout)
  const wts = parseWorktrees((await git(repo, ['worktree', 'list', '--porcelain'])) || '')
  const listed = new Set(wts.map(w => pathKey(w.path)))
  const checkedOut = new Set(wts.map(w => w.branch).filter(Boolean))
  const live = wts.slice(1).filter(w => !w.bare)
  for (const w of live) if (!w.prunable && !isDir(w.path)) w.prunable = true
  await pool(live.filter(w => !w.prunable), rc.worktree_concurrency ?? 4, async w => {
    const st = await git(w.path, ['status', '--porcelain'])
    if (st === undefined) w.unknown = true
    w.status = parseStatus(st || '')
    const headMerged = new Set(mergedLocal)
    if (!w.branch && base && (await git(repo, ['merge-base', '--is-ancestor', w.head, base.ref], { ok: true }))) headMerged.add(w.head)
    w.merge = await facts(w.branch || w.head, w.branch, headMerged, true)
    w.last = Number(((await git(w.path, ['log', '-1', '--format=%ct'])) || '0').trim()) * 1000
  })
  for (const w of live) {
    res.worktrees.push({
      path: w.prunable ? '' : w.path,
      finish(size) {
        w.size = size
        const row = worktreeRow(w, repo, cfg)
        return {
          ...row,
          title: short(w.path, roots),
          meta: [w.branch || (w.detached ? `détaché ${w.head.slice(0, 7)}` : ''), w.last ? `dernier commit il y a ${fmtAge(w.last, ctx.now)}` : '', size && !w.prunable ? sizeText(size) : ''].filter(Boolean).join(' · '),
          size: w.prunable ? 0 : size.bytes,
        }
      },
    })
  }

  // worktree folders git no longer lists
  for (const rel of rc.worktree_dirs || []) {
    for (const d of children(join(repo, rel))) {
      if (listed.has(pathKey(d))) continue
      const fullRepo = isDir(join(d, '.git'))
      res.orphans.push({
        path: d,
        finish: size => ({
          level: fullRepo ? 'danger' : 'check',
          title: short(d, roots),
          meta: [sizeText(size), size.newest ? `modifié il y a ${fmtAge(size.newest, ctx.now)}` : ''].filter(Boolean).join(' · '),
          reasons: [fullRepo ? L.orphan_repo : L.orphan],
          command: fullRepo ? '' : command('folder_delete', { path: d }, cfg.commands),
          reclaim: fullRepo ? 0 : size.bytes,
          size: size.bytes,
        }),
      })
    }
  }

  if (!base) return res
  // local branches already merged (not the base, not protected, not checked out); [gone] ones checked first
  const locals = Object.keys(tracking).filter(n => !protectedSet.has(n) && n !== base.name && !checkedOut.has(n))
  locals.sort((a, b) => Number(/\[gone\]/.test(tracking[b])) - Number(/\[gone\]/.test(tracking[a])))
  for (const name of locals) {
    const m = await facts(name, name, mergedLocal)
    if (!m.merged) continue
    res.branches.push({ ...branchRow({ name, merge: m }, repo, cfg), title: `${short(repo, roots)} · ${name}`, meta: '', reclaim: 0, size: 0 })
  }
  // remote branches already merged
  if (rc.remote_branches !== false) {
    const refs = lines(await git(repo, ['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}`]))
      .map(full => ({ full, name: full.slice(remote.length + 1) }))
      .filter(r => r.name && r.name !== 'HEAD' && !protectedSet.has(r.name) && r.name !== base.name)
    if (refs.length > (rc.remote_max ?? 300)) res.errors.push(fill(L.remote_many, { repo: short(repo, roots), n: refs.length, max: rc.remote_max ?? 300 }))
    for (const r of refs) {
      const m = refs.length > (rc.remote_max ?? 300) ? (mergedRemote.has(r.full) ? mergeState({ ancestor: true }, mergeLabels) : { merged: false }) : await facts(r.full, r.name, mergedRemote)
      if (!m.merged) continue
      res.remote.push({ ...branchRow({ name: r.name, remote: true, remoteName: remote, merge: m }, repo, cfg), title: `${short(repo, roots)} · ${r.full}`, meta: '', reclaim: 0, size: 0 })
    }
  }
  return res
}

// ---------- other sections ----------

function modsRows(ctx) {
  const { cfg, env, L } = ctx
  const mc = cfg.mods_copies || {}
  const dir = expand(mc.dir || '~/.claude/mods', env)
  const settings = readJson(expand(mc.settings || '~/.claude/settings.json', env)) || {}
  const loaded = new Set([...pluginDirs(settings.env?.CLAUDE_CODE_PLUGIN_DIRS, env), ...pluginDirs(process.env.CLAUDE_CODE_PLUGIN_DIRS, env)])
  return children(dir).map(d => ({
    path: d,
    finish(size) {
      const on = loaded.has(pathKey(d))
      return {
        level: on ? 'info' : 'check',
        title: short(d, [dirname(dir)]),
        meta: [sizeText(size), size.newest ? `modifié il y a ${fmtAge(size.newest, ctx.now)}` : ''].filter(Boolean).join(' · '),
        reasons: [on ? L.mod_loaded : L.mod_unloaded],
        command: on ? '' : command('folder_delete', { path: d }, cfg.commands),
        reclaim: on ? 0 : size.bytes,
        size: size.bytes,
      }
    },
  }))
}

function backupRows(ctx) {
  const { cfg, env, L } = ctx
  const bc = cfg.backups || {}
  const dir = expand(bc.dir || '~/.claude/effort-board/_deploy_backups', env)
  const { kept, old } = splitOld(children(dir).map(d => ({ path: d, time: mtime(d) })), bc.keep ?? 5)
  const rows = old.map(b => ({
    path: b.path,
    finish: size => ({
      level: 'safe',
      title: short(b.path, [dirname(dir)]),
      meta: [sizeText(size), `il y a ${fmtAge(b.time, ctx.now)}`].join(' · '),
      reasons: [fill(L.backup_old, { keep: bc.keep ?? 5 })],
      command: command('folder_delete', { path: b.path }, cfg.commands),
      reclaim: size.bytes,
      size: size.bytes,
    }),
  }))
  return { rows, kept: kept.map(k => k.path) }
}

/** First `cwd` found in the first bytes of a project's transcripts. */
function projectCwd(dir) {
  let files = []
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.jsonl'))
  } catch {}
  for (const f of files.slice(0, 5)) {
    let fd
    try {
      fd = openSync(join(dir, f), 'r')
      const buf = Buffer.alloc(65536)
      const n = readSync(fd, buf, 0, buf.length, 0)
      const m = buf.toString('utf8', 0, n).match(/"cwd":"((?:[^"\\]|\\.)*)"/)
      if (m) return norm(JSON.parse(`"${m[1]}"`))
    } catch {
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  return ''
}

function transcriptDirs(ctx) {
  const dir = expand(ctx.cfg.transcripts?.dir || '~/.claude/projects', ctx.env)
  return children(dir).map(d => {
    const cwd = projectCwd(d)
    return { d, cwd, gone: cwd ? !isDir(cwd) : false }
  })
}

function transcriptsSection(all, sizeOf, ctx) {
  const { cfg, L } = ctx
  const top = cfg.transcripts?.top ?? 15
  const xs = all.map(x => ({ ...x, size: sizeOf(x.d) })).sort((a, b) => b.size.bytes - a.size.bytes)
  const gone = xs.filter(x => x.gone)
  const pick = [...xs.slice(0, top), ...gone.filter(x => !xs.slice(0, top).includes(x))]
  const sum = a => a.reduce((s, x) => s + x.size.bytes, 0)
  return {
    summary: fill(L.transcripts_summary, { n: xs.length, bytes: fmtBytes(sum(xs)), gone: gone.length, gone_bytes: fmtBytes(sum(gone)) }),
    rows: pick.map(x => ({
      level: x.gone ? 'check' : 'info',
      title: x.cwd ? short(x.cwd, ctx.roots) : x.d.split('/').pop(),
      meta: [sizeText(x.size), `${x.size.files} fichiers`, x.size.newest ? `actif il y a ${fmtAge(x.size.newest, ctx.now)}` : ''].filter(Boolean).join(' · '),
      reasons: x.gone ? [L.transcripts_gone] : [],
      command: '',
      reclaim: 0,
      size: x.size.bytes,
    })),
  }
}

function tempRows(ctx) {
  const { cfg, env, L } = ctx
  const rows = []
  for (const t of cfg.temp?.dirs || []) {
    if (unset(t.path)) continue
    const base = expand(t.path, env)
    if (!isDir(base)) continue
    for (const d of entriesAt(base, t.depth ?? 1)) {
      rows.push({
        path: d,
        finish(size) {
          const newest = size.newest || mtime(d)
          const old = ctx.now - newest > (t.days ?? 2) * 86400000
          return {
            level: old ? 'safe' : 'info',
            title: short(d, [base]),
            group: t.label || t.path,
            meta: [sizeText(size), `modifié il y a ${fmtAge(newest, ctx.now)}`].join(' · '),
            reasons: [old ? fill(L.temp_old, { age: fmtAge(newest, ctx.now) }) : L.temp_recent],
            command: old ? command('folder_delete', { path: d }, cfg.commands) : '',
            reclaim: old ? size.bytes : 0,
            size: size.bytes,
          }
        },
      })
    }
  }
  return rows
}

/** Desktop app session files: only the fields this mod needs. */
export function readSessions(dir) {
  const out = []
  for (const a of children(dir)) {
    for (const b of children(a)) {
      let files = []
      try {
        files = readdirSync(b).filter(f => /^local_.*\.json$/.test(f))
      } catch {}
      for (const f of files) {
        const j = readJson(join(b, f))
        if (!j) continue
        out.push({
          id: j.sessionId || f.replace(/\.json$/, ''),
          title: j.title || '',
          archived: !!j.isArchived,
          lastActivityAt: j.lastActivityAt || 0,
          prs: (j.prs || []).map(p => ({ number: p.prNumber, repo: p.repo, branch: p.branch, state: p.state })),
        })
      }
    }
  }
  return out
}

function sessionRows(ctx) {
  const { cfg, L } = ctx
  const idle = cfg.sessions?.idle_hours ?? 12
  return ctx.sessions
    .filter(s => archivable(s, ctx.now, idle))
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
    .map(s => ({
      level: 'safe',
      title: s.title || s.id,
      meta: [`inactive depuis ${fmtAge(s.lastActivityAt, ctx.now)}`, s.prs.map(p => `#${p.number} ${String(p.state).toLowerCase()}`).join(', ')].join(' · '),
      reasons: [L.session_archive],
      command: '',
      reclaim: 0,
      size: 0,
    }))
}

function worktreeSummary(rows, L) {
  const safe = rows.filter(r => r.level === 'safe')
  const danger = rows.filter(r => r.level === 'danger')
  return fill(L.worktrees_summary, { n: rows.length, safe: safe.length, bytes: fmtBytes(safe.reduce((a, r) => a + (r.reclaim || 0), 0)), danger: danger.length, dirty: danger.filter(r => /modifié/.test((r.reasons || []).join(' '))).length })
}

// ---------- scan ----------

export async function scan({ cfg, dataDir, env }, now = Date.now(), { force = false } = {}) {
  const L = cfg.labels || {}
  const rc = cfg.repos || {}
  const roots = (rc.roots || []).filter(r => !unset(r)).map(r => expand(r, env))
  const git = gitRunner((rc.git_timeout_s ?? 30) * 1000)
  const sessions = unset(cfg.sessions?.dir) ? [] : readSessions(expand(cfg.sessions?.dir || '%APPDATA%/Claude/claude-code-sessions', env))
  const ctx = { cfg, env, L, git, roots, now, sessions, prs: prIndex(sessions), budget: { left: rc.squash_check_total ?? 600 } }
  const errors = []
  if (!roots.length) errors.push(L.roots_unset || 'repos.roots non réglé')
  const repos = findRepos(roots, rc.max_depth ?? 2, rc.skip_dirs || [])
  const acc = { worktrees: [], orphans: [], branches: [], remote: [] }
  const timing = []
  const per = await pool(repos, rc.concurrency ?? 4, async repo => {
    const t0 = Date.now()
    try {
      return await scanRepo(repo, ctx)
    } catch (e) {
      return { errors: [`${short(repo, roots)} : ${String(e?.message || e).slice(0, 200)}`] }
    } finally {
      timing.push([Date.now() - t0, short(repo, roots)])
    }
  })
  for (const r of per) {
    for (const k of Object.keys(acc)) acc[k].push(...(r[k] || []))
    errors.push(...(r.errors || []))
  }
  if (process.argv.includes('--timing')) {
    const top = timing.sort((a, b) => b[0] - a[0]).slice(0, 12)
    process.stderr.write(`${top.map(([ms, r]) => `${ms} ms ${r}`).join('\n')}\n`)
  }
  const mods = modsRows(ctx)
  const backups = backupRows(ctx)
  const temp = tempRows(ctx)
  const tdirs = transcriptDirs(ctx)
  const pending = [...acc.worktrees, ...acc.orphans, ...mods, ...backups.rows, ...temp]
  const sizeOf = await sizeAll([...pending.map(r => r.path).filter(Boolean), ...backups.kept, ...tdirs.map(t => t.d)], { cfg, dataDir, now, force })
  const done = rows => rows.map(r => r.finish(r.path ? sizeOf(r.path) : { bytes: 0, files: 0, newest: 0 }))
  const order = { safe: 0, check: 1, danger: 2, info: 3 }
  const byLevel = (a, b) => order[a.level] - order[b.level] || b.size - a.size
  const keptBytes = backups.kept.reduce((s, p) => s + sizeOf(p).bytes, 0)
  const transcripts = transcriptsSection(tdirs, sizeOf, ctx)
  const wtRows = done(acc.worktrees).sort(byLevel)
  const sections = [
    { id: 'worktrees', title: L.sec_worktrees, rows: wtRows, summary: worktreeSummary(wtRows, L) },
    { id: 'orphans', title: L.sec_orphans, rows: done(acc.orphans).sort(byLevel) },
    { id: 'branches', title: L.sec_branches, rows: acc.branches },
    { id: 'remote', title: L.sec_remote, rows: acc.remote },
    { id: 'mods', title: L.sec_mods, rows: done(mods).sort(byLevel) },
    { id: 'backups', title: L.sec_backups, rows: done(backups.rows), summary: fill(L.backups_kept, { n: backups.kept.length, bytes: fmtBytes(keptBytes) }) },
    { id: 'temp', title: L.sec_temp, rows: done(temp).sort((a, b) => b.reclaim - a.reclaim || b.size - a.size) },
    { id: 'transcripts', title: L.sec_transcripts, rows: transcripts.rows, summary: transcripts.summary },
    { id: 'sessions', title: L.sec_sessions, rows: sessionRows(ctx) },
  ]
  const model = { generated: now, roots, repos: repos.length, sessions: sessions.length, totals: totals(sections), sections, errors }
  saveJson(join(dataDir, 'menage.json'), model)
  return model
}

async function main() {
  const mode = process.argv[2] || 'scan'
  const ctx = config(arg('--data-dir'))
  const model = await scan(ctx, Number(arg('--now', Date.now())), { force: process.argv.includes('--force') })
  if (mode === 'report') {
    for (const s of model.sections) {
      console.log(`\n## ${s.title} (${s.rows.length})${s.summary ? ` · ${s.summary}` : ''}`)
      for (const r of s.rows) console.log(`[${r.level}] ${r.title} · ${r.meta}${r.reasons?.length ? ` · ${r.reasons.join(' · ')}` : ''}${r.command ? `\n    ${r.command}` : ''}`)
    }
    for (const e of model.errors) console.log(`! ${e}`)
    console.log(`\nsûr ${fmtBytes(model.totals.sure)} · à vérifier ${fmtBytes(model.totals.check)} · ${model.totals.danger} à ne pas supprimer`)
  } else {
    console.log(JSON.stringify({ ok: true, repos: model.repos, sure: model.totals.sure, check: model.totals.check, danger: model.totals.danger, errors: model.errors.length }))
  }
}

if (process.argv[1] && pathKey(fileURLToPath(import.meta.url)) === pathKey(resolve(process.argv[1]))) main()
