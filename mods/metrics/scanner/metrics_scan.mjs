// metrics mod scanner (Node 22.18+, standard library only).
//   node metrics_scan.mjs scan [--force] [--offline]   update the caches, write <data_dir>/metrics.json, print one JSON line
//   node metrics_scan.mjs report                       scan, then print the per-version table as text
// Options: --data-dir DIR, --projects DIR, --now MS (tests). Reads ~/.claude/projects/**/*.jsonl (only what was
// appended since the last run), runs `git remote` / `git log` in your repos and, unless --offline, `gh` and `glab`
// (read-only list calls) for merged PRs/MRs and CI runs. Writes only its data folder. Never prints a token.
import { execFile, execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { deepMerge, expandHome, fmtNum, metricRows } from '../hooks/view.mjs'
import {
  DAY, build, ciRuns, detectors, feed, githubPrs, gitlabMrs, hourly, kindOfPath, mergePrs, newFile, parseRemote, pruneFile, versions,
} from '../lib/collect.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const readJson = p => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return undefined
  }
}
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : dflt
}
const unset = p => !p || /<[^>]+>/.test(p)
const saveJson = (path, obj) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, JSON.stringify(obj))
  renameSync(`${path}.tmp`, path)
}

export function config(dataDirArg) {
  const home = homedir().replace(/\\/g, '/')
  const base = readJson(join(root, 'metrics.config.json')) || {}
  const dataDir = expandHome(dataDirArg || base.data_dir || '~/.claude/metrics-mod', home)
  const cfg = deepMerge(base, readJson(join(dataDir, 'metrics.config.json')) || {})
  const prices = deepMerge(readJson(join(root, '..', 'usage', 'lib', 'prices.json')) || {}, { models: cfg.prices || {} })
  return { cfg, prices, dataDir, home, projects: expandHome(arg('--projects') || cfg.projects_dir || '~/.claude/projects', home) }
}

// ---------- transcripts (incremental) ----------

function walk(dir, out = []) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && e.name.endsWith('.jsonl') && e.name !== 'journal.jsonl') out.push(p)
  }
  return out
}

function readFrom(path, st, size, opts) {
  const CHUNK = 8 << 20
  const fd = openSync(path, 'r')
  try {
    let pos = st.offset
    let rest = Buffer.alloc(0)
    const buf = Buffer.alloc(CHUNK)
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos)
      if (n <= 0) break
      pos += n
      const data = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n)
      let start = 0
      for (let i = data.indexOf(10); i >= 0; i = data.indexOf(10, start)) {
        feed(st, data.toString('utf8', start, i), opts)
        start = i + 1
      }
      rest = Buffer.from(data.subarray(start))
    }
    st.offset = pos - rest.length
  } finally {
    closeSync(fd)
  }
}

export function scanTranscripts({ projects, cache, det, prices, now, historyDays }) {
  const from = now - (historyDays + 1) * DAY
  const seen = new Set()
  for (const st of Object.values(cache.files)) for (const k of Object.keys(st.keys)) seen.add(k)
  const claim = k => (seen.has(k) ? false : (seen.add(k), true))
  const present = new Set()
  let read = 0
  let bytes = 0
  const stats = (existsSync(projects) ? walk(projects) : []).map(p => {
    try {
      return [p, statSync(p)]
    } catch {
      return [p, null]
    }
  }).filter(x => x[1]).sort((a, b) => a[1].birthtimeMs - b[1].birthtimeMs || a[1].mtimeMs - b[1].mtimeMs)
  for (const [p, s] of stats) {
    const rel = relative(projects, p).replace(/\\/g, '/')
    if (s.mtimeMs < from) {
      delete cache.files[rel]
      continue
    }
    present.add(rel)
    let st = cache.files[rel]
    if (!st || s.size < st.offset) st = cache.files[rel] = newFile(kindOfPath(rel))
    if (s.size > st.offset) {
      bytes += s.size - st.offset
      readFrom(p, st, s.size, { det, prices, claim })
      read++
    }
    pruneFile(st, from)
  }
  for (const rel of Object.keys(cache.files)) if (!present.has(rel)) delete cache.files[rel]
  return { files: Object.keys(cache.files).length, read, bytes }
}

// ---------- repos ----------

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim()
  } catch {
    return ''
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', '.worktrees', 'dist', 'build', '.venv', 'venv'])

/** Git repos under the roots (depth-limited) plus the repo roots seen as transcript cwds; one entry per remote. */
export function discoverRepos(cfg, cwds = []) {
  const r = cfg.repos || {}
  const home = homedir()
  const folders = new Set()
  const visit = (dir, depth) => {
    if (existsSync(join(dir, '.git'))) folders.add(dir)
    if (depth >= (r.max_depth ?? 2)) return
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) visit(join(dir, e.name), depth + 1)
  }
  for (const rt of r.roots || []) if (!unset(rt)) visit(expandHome(rt, home.replace(/\\/g, '/')), 0)
  if (r.from_transcripts !== false) {
    for (const c of cwds) {
      const base = String(c).replace(/\\/g, '/').replace(/\/\.claude\/worktrees\/.*$/, '').replace(/\/\.worktrees\/.*$/, '')
      if (base && existsSync(join(base, '.git'))) folders.add(base)
    }
  }
  const repos = {}
  const folderRepo = {}
  const exclude = new Set((r.exclude || []).map(s => s.toLowerCase()))
  for (const dir of folders) {
    const rem = parseRemote(git(['remote', 'get-url', r.remote || 'origin'], dir))
    if (!rem || exclude.has(rem.slug.toLowerCase()) || exclude.has(rem.name)) continue
    const key = `${rem.forge}:${rem.slug.toLowerCase()}`
    repos[key] = repos[key] || { ...rem, slug: rem.slug.toLowerCase(), folders: 0 }
    repos[key].folders++
    folderRepo[basename(dir).toLowerCase()] = key
  }
  for (const s of r.include || []) {
    const rem = parseRemote(s.includes('://') || s.startsWith('git@') ? s : `https://github.com/${s}`)
    if (rem) repos[`${rem.forge}:${rem.slug.toLowerCase()}`] = { ...rem, slug: rem.slug.toLowerCase(), folders: 0 }
  }
  return { repos, folderRepo }
}

// ---------- forges ----------

function run(cmd, args, timeoutMs) {
  return new Promise(res => {
    execFile(cmd, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 << 20, windowsHide: true }, (err, stdout, stderr) => {
      if (err) res({ ok: false, err: String(stderr || err.message || err).trim().split('\n').pop().slice(0, 200) })
      else res({ ok: true, out: stdout })
    })
  })
}
const parse = s => {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
async function pool(tasks, n) {
  const out = []
  let i = 0
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => {
    while (i < tasks.length) {
      const k = i++
      out[k] = await tasks[k]()
    }
  }))
  return out
}

export async function fetchForges({ cfg, repos, forge, now, force }) {
  const r = cfg.repos || {}
  const t = (r.timeout_s ?? 60) * 1000
  const histFrom = now - (cfg.history_days ?? 30) * DAY
  const fresh = forge.fetchedAt && now - forge.fetchedAt < (cfg.refresh_min ?? 30) * 60000
  if (fresh && !force) return { skipped: true }
  const since = Math.max(histFrom, (forge.fetchedAt || 0) - 2 * DAY)
  const day = new Date(since).toISOString().slice(0, 10)
  const errors = []
  const gh = Object.values(repos).filter(x => x.forge === 'github')
  const gl = Object.values(repos).filter(x => x.forge === 'gitlab')
  const tracked = new Set(gh.map(x => x.slug))
  const owners = [...new Set([...gh.map(x => x.slug.split('/')[0]), ...(r.github_owners || [])])]
  let prs = forge.prs || []
  if (owners.length) {
    const limit = r.search_limit ?? 1000
    const author = r.pr_author ? ['--author', r.pr_author] : []
    const res = await run('gh', ['search', 'prs', ...owners.flatMap(o => ['--owner', o]), ...author, '--merged', '--merged-at', `>=${day}`, '--json', 'repository,number,closedAt,createdAt', '--limit', String(limit)], t)
    const list = res.ok ? parse(res.out) : undefined
    if (!Array.isArray(list)) errors.push(`gh search prs: ${res.err || 'réponse illisible'}`)
    else {
      if (list.length >= limit) errors.push(`gh search prs : limite de ${limit} résultats atteinte, total sous-estimé`)
      prs = mergePrs(prs, githubPrs(list).filter(p => tracked.has(p.repo)))
    }
  }
  for (const g of r.gitlab_groups || []) {
    if (unset(g)) continue
    const res = await run('glab', ['api', `groups/${encodeURIComponent(g)}/projects?per_page=100&include_subgroups=true&archived=false`], t)
    const list = res.ok ? parse(res.out) : undefined
    if (!Array.isArray(list)) errors.push(`glab group ${g}: ${res.err || 'réponse illisible'}`)
    else for (const p of list) {
      const slug = String(p.path_with_namespace || '').toLowerCase()
      if (slug && !repos[`gitlab:${slug}`]) gl.push((repos[`gitlab:${slug}`] = { forge: 'gitlab', host: 'gitlab.com', slug, name: slug.split('/').pop(), folders: 0, group: g }))
    }
  }
  forge.groupRepos = Object.values(repos).filter(x => x.group)
  const mrTasks = gl.map(x => async () => {
    const out = []
    const author = r.mr_author ? ['--author', r.mr_author] : []
    for (let page = 1; page <= (r.max_pages ?? 5); page++) {
      const res = await run('glab', ['mr', 'list', '-R', x.slug, '-M', '-F', 'json', '-P', '100', '-p', String(page), '-o', 'merged_at', '-S', 'desc', ...author], t)
      const list = res.ok ? parse(res.out) : undefined
      if (!Array.isArray(list)) return errors.push(`glab mr ${x.slug}: ${res.err || 'réponse illisible'}`), out
      const got = gitlabMrs(list, x.slug)
      out.push(...got.filter(p => p.merged >= since))
      if (list.length < 100 || got.some(p => p.merged < since)) break
    }
    return out
  })
  for (const list of await pool(mrTasks, r.concurrency ?? 6)) prs = mergePrs(prs, list)
  prs = prs.filter(p => p.merged >= histFrom)
  // CI history: repos with a merged PR/MR in the window, every GitLab repo, and GitLab mirrors named like an active repo
  const active = new Set(prs.map(p => p.repo.split('/').pop()))
  const ciRepos = [...gh.filter(x => active.has(x.name)), ...gl.filter(x => x.folders > 0 || active.has(x.name))]
  const iso = new Date(since).toISOString()
  const ciTasks = ciRepos.map(x => async () => {
    const res = x.forge === 'github'
      ? await run('gh', ['run', 'list', '-R', x.slug, '--json', 'startedAt,updatedAt,status', '--limit', '300', '--created', `>=${day}`], t)
      : await run('glab', ['ci', 'list', '-R', x.slug, '-F', 'json', '-P', '100', '-a', iso], t)
    if (!res.ok) return errors.push(`${x.forge === 'github' ? 'gh run' : 'glab ci'} ${x.slug}: ${res.err}`), []
    return ciRuns(parse(res.out), `${x.forge}:${x.slug}`, now)
  })
  const runKey = x => `${x.repo}|${x.start}`
  const runs = new Map((forge.runs || []).filter(x => x.start >= histFrom).map(x => [runKey(x), x]))
  for (const list of await pool(ciTasks, r.concurrency ?? 6)) for (const x of list) runs.set(runKey(x), x)
  forge.prs = prs
  forge.runs = [...runs.values()].sort((a, b) => a.start - b.start)
  forge.fetchedAt = now
  forge.errors = errors
  forge.counts = { github: gh.length, gitlab: gl.length, ci_repos: ciRepos.length }
  return { skipped: false, errors: errors.length }
}

// ---------- rules versions ----------

export function rulesVersions(cfg, home) {
  const r = cfg.rules || {}
  if (unset(r.repo)) return { list: [], error: 'rules.repo non réglé' }
  const repo = expandHome(r.repo, home)
  const log = git(['log', '--format=%H|%aI|%s', '--', r.file || 'config/claude/CLAUDE.md'], repo)
  if (!log) return { list: [], error: `git log vide (${r.file})` }
  return { list: versions(log, { regex: r.version_regex, grain: r.grain }) }
}

// ---------- main ----------

export async function scan(ctx, now, { force = false, offline = false } = {}) {
  const { cfg, prices, dataDir, projects, home } = ctx
  const t0 = Date.now()
  const historyDays = cfg.history_days ?? 30
  const det = detectors(cfg.detect)
  const cachePath = join(dataDir, 'scan-cache.json')
  let cache = readJson(cachePath)
  const key = JSON.stringify([prices.models, cfg.detect, historyDays])
  if (!cache || cache.version !== 1 || cache.key !== key) cache = { version: 1, key, files: {} }
  const tr = scanTranscripts({ projects, cache, det, prices, now, historyDays })
  saveJson(cachePath, cache)

  const forgePath = join(dataDir, 'forge-cache.json')
  const forge = readJson(forgePath) || { version: 1 }
  const cwds = [...new Set(Object.values(cache.files).map(f => f.cwd).filter(Boolean))]
  const { repos, folderRepo } = discoverRepos(cfg, cwds)
  for (const x of forge.groupRepos || []) repos[`gitlab:${x.slug}`] = repos[`gitlab:${x.slug}`] || x // group projects from the last fetch
  let fr = { skipped: true, offline }
  if (!offline) fr = await fetchForges({ cfg, repos, forge, now, force })
  saveJson(forgePath, forge)

  const rv = rulesVersions(cfg, home)
  const tzMin = -new Date(now).getTimezoneOffset()
  const repoOf = name => folderRepo[String(name || '').toLowerCase()]
  const model = build({
    hours: hourly(cache.files, repoOf), prs: forge.prs || [], runs: forge.runs || [], vers: rv.list, now, tzMin, historyDays,
    minGapMin: cfg.stall?.min_gap_min ?? 60,
  })
  model.meta = {
    repos: Object.keys(repos).length, github: Object.values(repos).filter(x => x.forge === 'github').length,
    gitlab: Object.values(repos).filter(x => x.forge === 'gitlab').length, forge_at: forge.fetchedAt || 0,
    errors: [...(forge.errors || []), ...(rv.error ? [rv.error] : [])], transcripts: tr.files, offline,
  }
  saveJson(join(dataDir, 'metrics.json'), model)
  return { model, info: { ok: true, files: tr.files, read: tr.read, mb: Math.round(tr.bytes / 1e6), forge: fr.skipped ? 'cache' : 'fetched', errors: model.meta.errors.length, ms: Date.now() - t0 } }
}

function report(model, cfg) {
  const vs = model.versions
  const cur = vs[vs.length - 1]
  if (!cur) return console.log('aucune version des règles trouvée')
  const prev = vs[vs.length - 2]
  console.log(`${model.prs} PR/MR mergées sur ${model.days.length} jours · ${model.meta.repos} repos · versions: ${vs.map(v => v.version).join(' ')}`)
  for (const r of metricRows(cfg, prev, cur)) console.log(`  ${r.label.padEnd(34)} ${String(r.before).padStart(10)} → ${String(r.after).padStart(10)}  ${r.arrow}`)
  console.log(`  (${prev ? prev.version : '—'} → ${cur.version}; ${fmtNum(cur.hours / 24, 1)} j depuis ${new Date(cur.start).toISOString().slice(0, 16)})`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ctx = config(arg('--data-dir'))
  const now = Number(arg('--now')) || Date.now()
  const cmd = process.argv[2] || 'scan'
  try {
    mkdirSync(ctx.dataDir, { recursive: true })
    const { model, info } = await scan(ctx, now, { force: process.argv.includes('--force'), offline: process.argv.includes('--offline') })
    if (cmd === 'scan') console.log(JSON.stringify(info))
    else if (cmd === 'report') {
      console.log(JSON.stringify(info))
      report(model, ctx.cfg)
    } else throw new Error(`unknown command ${cmd}`)
  } catch (err) {
    console.error(String((err && err.stack) || err))
    process.exit(1)
  }
}
