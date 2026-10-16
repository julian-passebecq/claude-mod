#!/usr/bin/env node
// ci mod, Claude <-> Codex dataset per repo/PR, read-only, written to ~/.claude/ci-cache/interactions.json for the
// Cockpit (and /ci relais) to read. No model call, no write anywhere else.
//   node scanner/relais.mjs [--config <ci.config.json>] [--days 30] [--out <file>] [--summary] [--cached]
// Sources, all read-only:
//   gh pr list --state all --json …               GitHub PRs with their commits and checks
//   glab api projects/<p>/merge_requests (GET)     GitLab MRs, then …/commits and …/pipelines of each
//   git remote / git log                           which clones exist and their remotes
//   ~/.claude/projects/**/*.jsonl, ~/.codex/sessions/**/*.jsonl   « gh pr merge N » / « glab mr merge N » commands
//                                                  (only files touched within --days), to tell who merged
//   ~/.claude/ci-pipelines-cache.json              CI runs already attributed by the Diagramme (pass rate per agent)
// The rules live in relais_core.mjs (pure, tested on invented data).
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, createReadStream } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { attributionOf, mergesFromCommands, parseRemote, prRow, summaryText, totals } from './relais_core.mjs'

const HOME = homedir()
export const expand = (p) => String(p ?? '').replace(/^~(?=$|[\\/])/, HOME)
const placeholder = (v) => typeof v === 'string' && /^<.*>$/.test(v.trim())

/** execFile as a promise: { code, stdout, stderr }, never throws. */
export const runCmd = (cmd, args, { cwd, timeoutMs = 60000 } = {}) => new Promise((res) => {
  execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
    res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? String(err ?? '') })
  })
})

export const loadConfig = (path) => {
  const candidates = path ? [path] : [join(dirname(fileURLToPath(import.meta.url)), '..', 'ci.config.json'), join(HOME, '.claude', 'ci.config.json')]
  for (const p of candidates) {
    try { return JSON.parse(readFileSync(expand(p), 'utf8')) } catch {}
  }
  return {}
}

/** Git clones under the roots (max_depth deep) plus the listed paths. */
export const findClones = (cfg) => {
  const p = cfg.pipelines || {}
  const roots = (p.roots || []).filter((r) => r && !placeholder(r)).map(expand)
  const depth = Number(p.max_depth ?? 2)
  const out = new Set()
  const walk = (dir, d) => {
    if (existsSync(join(dir, '.git'))) { out.add(dir.replace(/\\/g, '/')); return }
    if (d >= depth) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(join(dir, e.name), d + 1)
  }
  for (const r of roots) walk(r, 0)
  for (const r of p.repos || []) if (typeof r === 'string' && !placeholder(r)) out.add(expand(r).replace(/\\/g, '/'))
  return [...out]
}

/** Remotes of a clone that are GitHub or GitLab, origin first. */
export const remotesOf = async (path, run, gitlabHosts) => {
  const r = await run('git', ['-C', path, 'remote', '-v'], { timeoutMs: 10000 })
  if (r.code !== 0) return []
  const seen = new Map()
  for (const line of r.stdout.split('\n')) {
    const [name, url] = line.trim().split(/\s+/)
    const rem = parseRemote(url, gitlabHosts)
    if (rem && !seen.has(`${rem.kind}:${rem.path}`)) seen.set(`${rem.kind}:${rem.path}`, { ...rem, remote: name })
  }
  return [...seen.values()].sort((a, b) => (a.remote === 'origin' ? -1 : b.remote === 'origin' ? 1 : 0))
}

const GH_FIELDS = 'number,title,author,headRefName,baseRefName,state,createdAt,mergedAt,mergedBy,url,body,commits,statusCheckRollup'

/** GitHub PRs normalized for prRow. */
export const githubPrs = async (repo, run, { limit, since }) => {
  // GitHub's GraphQL node limit refuses big pages with commits and their authors: smaller pages until it fits
  let r
  for (const n of [...new Set([limit, Math.min(limit, 25), Math.min(limit, 10)])]) {
    r = await run('gh', ['pr', 'list', '-R', repo, '--state', 'all', '--limit', String(n), '--json', GH_FIELDS], { timeoutMs: 120000 })
    if (r.code === 0 || !/node limit|traverses to the|exceeds|too many/i.test(r.stderr)) break
  }
  if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `gh exit ${r.code}`)
  const list = JSON.parse(r.stdout || '[]')
  return list
    .filter((p) => !since || !p.createdAt || Date.parse(p.createdAt) >= since)
    .map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      branch: p.headRefName,
      base: p.baseRefName,
      state: String(p.state).toLowerCase(),
      created: p.createdAt,
      merged_at: p.mergedAt || null,
      author: p.author?.login,
      merged_by_login: p.mergedBy?.login ?? null,
      body: p.body,
      commits: (p.commits || []).map((c) => ({ headline: c.messageHeadline, body: c.messageBody, authors: (c.authors || []).flatMap((a) => [a.login, a.name, a.email].filter(Boolean)) })),
      checks: p.statusCheckRollup || [],
    }))
}

/** GitLab MRs normalized for prRow (GET only). */
export const gitlabMrs = async (project, host, run, { limit, since }) => {
  const enc = encodeURIComponent(project)
  const hostArgs = host && host !== 'gitlab.com' ? ['--hostname', host] : []
  const after = since ? `&created_after=${new Date(since).toISOString()}` : ''
  const r = await run('glab', ['api', ...hostArgs, `projects/${enc}/merge_requests?state=all&per_page=${Math.min(100, limit)}${after}`], { timeoutMs: 120000 })
  if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `glab exit ${r.code}`)
  const list = JSON.parse(r.stdout || '[]')
  const out = []
  for (const m of list.slice(0, limit)) {
    const cm = await run('glab', ['api', ...hostArgs, `projects/${enc}/merge_requests/${m.iid}/commits?per_page=100`], { timeoutMs: 60000 })
    const pl = await run('glab', ['api', ...hostArgs, `projects/${enc}/merge_requests/${m.iid}/pipelines?per_page=1`], { timeoutMs: 60000 })
    let commits = []
    let pipe = ''
    try { commits = JSON.parse(cm.stdout || '[]') } catch {}
    try { pipe = (JSON.parse(pl.stdout || '[]')[0] || {}).status || '' } catch {}
    out.push({
      number: m.iid,
      title: m.title,
      url: m.web_url,
      branch: m.source_branch,
      base: m.target_branch,
      state: m.state === 'merged' ? 'merged' : m.state === 'opened' ? 'open' : String(m.state),
      created: m.created_at,
      merged_at: m.merged_at || null,
      author: m.author?.username,
      merged_by_login: m.merged_by?.username ?? m.merge_user?.username ?? null,
      body: m.description,
      // the API lists newest first; prRow wants the first commit first
      commits: (Array.isArray(commits) ? commits : []).reverse().map((c) => ({ headline: c.title, body: c.message, authors: [c.author_name, c.author_email].filter(Boolean) })),
      checks: pipe,
    })
  }
  return out
}

/** Every *.jsonl under dir touched since `since`. */
export const recentJsonl = (dir, since, depth = 4) => {
  const out = []
  const walk = (d, n) => {
    let entries = []
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory() && n < depth) walk(p, n + 1)
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try { if (statSync(p).mtimeMs >= since) out.push(p) } catch {}
      }
    }
  }
  walk(dir, 0)
  return out
}

/** Shell commands with « pr merge » / « mr merge » from Claude and Codex transcripts: [{agent, cwd, command}]. */
export const mergeCommands = async (files) => {
  const out = []
  for (const { agent, path } of files) {
    let cwd = ''
    const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of rl) {
      if (!cwd && line.includes('"cwd"')) {
        const m = line.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        if (m) cwd = JSON.parse(`"${m[1]}"`)
      }
      if (!/(pr|mr)\s+merge/.test(line)) continue
      let row
      try { row = JSON.parse(line) } catch { continue }
      const lineCwd = row.cwd || row.payload?.cwd || cwd
      const cmds = []
      const visit = (x) => {
        if (!x || typeof x !== 'object') return
        if (typeof x.command === 'string') cmds.push(x.command)
        else if (Array.isArray(x.command)) cmds.push(x.command.join(' '))
        if (typeof x.arguments === 'string' && /(pr|mr)\s+merge/.test(x.arguments)) {
          try { visit(JSON.parse(x.arguments)) } catch {}
        }
        for (const v of Object.values(x)) if (v && typeof v === 'object') visit(v)
      }
      visit(row)
      for (const c of cmds) if (/(pr|mr)\s+merge/.test(c)) out.push({ agent, cwd: lineCwd, command: c })
    }
  }
  return out
}

/** Runs from the Diagramme's cache, keyed by app name: [{who, status}]. */
export const pipelineRuns = (cfg) => {
  const file = expand((cfg.pipelines || {}).pipelines_cache || '~/.claude/ci-pipelines-cache.json')
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'))
    const out = new Map()
    for (const a of d.apps || []) out.set(String(a.name ?? a.app ?? '').toLowerCase(), (a.runs || []).map((r) => ({ who: r.who, status: r.status })))
    return out
  } catch {
    return new Map()
  }
}

/** The whole dataset. `deps` lets tests swap the world: run, clones, transcripts, runs. */
export const collect = async (cfg, deps = {}) => {
  const now = deps.now ?? Date.now()
  const rel = cfg.relais || {}
  const days = Number(deps.days ?? rel.days ?? 30)
  const since = now - days * 86400000
  const limit = Number(rel.max_prs ?? 60)
  const gitlabHosts = (cfg.pipelines || {}).gitlab_hosts || ['gitlab.com']
  const run = deps.run ?? runCmd
  const a = attributionOf(cfg)
  const clones = deps.clones ?? findClones(cfg)
  const transcripts = deps.transcripts ?? [
    ...recentJsonl(expand(rel.claude_projects || (cfg.pipelines || {}).projects_dir || '~/.claude/projects'), since).map((path) => ({ agent: 'claude', path })),
    ...recentJsonl(expand(rel.codex_sessions || '~/.codex/sessions'), since, 5).map((path) => ({ agent: 'codex', path })),
  ]
  const merges = mergesFromCommands(deps.commands ?? await mergeCommands(transcripts))
  const runsByApp = deps.runs ?? pipelineRuns(cfg)
  const repos = []
  const errors = []
  const seen = new Set()
  for (const path of clones) {
    const name = path.split('/').filter(Boolean).pop()
    const rems = await remotesOf(path, run, gitlabHosts)
    const rem = rems[0]
    if (!rem || seen.has(`${rem.kind}:${rem.path}`)) continue
    seen.add(`${rem.kind}:${rem.path}`)
    let prs
    try {
      prs = rem.kind === 'github'
        ? await githubPrs(rem.path, run, { limit, since })
        : await gitlabMrs(rem.path, rem.host, run, { limit, since })
    } catch (err) {
      errors.push({ repo: name, remote: `${rem.kind}:${rem.path}`, error: String(err.message ?? err).slice(0, 200) })
      continue
    }
    const rows = prs.map((p) => prRow(p, a, prs, merges.get(`${name.toLowerCase()}#${p.number}`) ?? merges.get(`${rem.path.split('/').pop().toLowerCase()}#${p.number}`) ?? null))
    const runs = runsByApp.get(name.toLowerCase()) ?? []
    repos.push({ name, path, host: rem.kind, remote: rem.path, prs: rows, totals: totals(rows, runs) })
  }
  const allRows = repos.flatMap((r) => r.prs)
  const allRuns = repos.flatMap((r) => runsByApp.get(r.name.toLowerCase()) ?? [])
  return {
    schema: 1,
    generated: new Date(now).toISOString(),
    days,
    repos,
    totals: totals(allRows, allRuns),
    errors,
    sources: ['gh pr list', 'glab api (GET)', 'git remote', 'transcripts: gh pr merge / glab mr merge', 'ci-pipelines-cache.json'],
  }
}

export const outPath = (cfg, arg) => expand(arg || (cfg.relais || {}).out || '~/.claude/ci-cache/interactions.json')

const main = async () => {
  const argv = process.argv.slice(2)
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
  const cfg = loadConfig(val('--config'))
  const out = outPath(cfg, val('--out'))
  let data
  if (argv.includes('--cached')) {
    try { data = JSON.parse(readFileSync(out, 'utf8')) } catch {
      console.log(JSON.stringify({ error: `pas encore de données : /ci relais refresh (écrit ${out})` }))
      process.exit(1)
    }
  } else {
    data = await collect(cfg, { days: val('--days') })
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(data, null, 1))
  }
  if (argv.includes('--summary')) console.log(JSON.stringify({ out, text: summaryText(data) }))
  else console.log(JSON.stringify({ out, repos: data.repos.length, prs: data.totals.prs, errors: data.errors.length }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
