// export-eta - the brief for another AI: ONE Markdown file about a conversation (and, with --children, every
// sub-conversation the desktop app linked to it by spawnedFrom), masked, written under brief.dir and copied to the
// clipboard. No model call, no eta-repo PR: local + clipboard only. Run by the band's « Export conv » / « Export +
// enfants » buttons and by /export-eta brief [enfants].
//   node brief.mjs info --session <cli id> [--json]         → {found, sid, title, children} (children: every descendant)
//   node brief.mjs run  --session <cli id> [--cwd <dir>] [--children] [--no-clip] [--out <file>] [--json]
// --cwd: used only when the desktop app has no file for this session (a terminal session): transcript + git alone.
// --sid <local_…> works instead of --session. Prints one line (or JSON with --json).
import { execFile, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BRIEF_LABELS, briefBlocks, planOf, prsOpened, renderBrief, stateWord, wrapOf } from '../lib/brief.mjs'
import { appDir, parseSession, sessionFiles } from '../lib/core/sessions.mjs'
import { estimateOf, etaOf } from '../lib/core/estimate.mjs'
import { newRunningState, readRunning } from '../lib/core/running.mjs'
import { deepMerge, fill, projectOf, slug } from '../lib/layout.mjs'
import { check, mask } from '../lib/mask.mjs'
import { maskOpts } from '../lib/etagit.mjs'
import { projectsDir, readTranscript, transcriptOf } from './sessions.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const BRIEF_DEFAULTS = {
  dir: '~/.claude/export-eta/briefs',
  file: '{day}-{slug}.md',
  file_children: '{day}-{slug}-avec-enfants.md',
  max_chars_per_conv: 60000,
  max_depth: 5,
  live_s: 120,
  clipboard: 'auto',
  git_commits: 10,
  git_bases: ['origin/main', 'origin/master'],
  git_files: 30,
  prs_max: 15,
  forge: true,
  timeout_s: 20,
  labels: {},
}

const expandHome = (p) => String(p || '').replace(/^~(?=[\\/]|$)/, os.homedir())

export function loadConfig(home = process.env.EXPORT_ETA_HOME || path.join(os.homedir(), '.claude', 'export-eta')) {
  const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) } catch { return {} } }
  const cfg = deepMerge(read(path.join(HERE, '..', 'export-eta.config.json')), read(path.join(home, 'config.json')))
  return { cfg, B: { ...BRIEF_DEFAULTS, ...(cfg.brief || {}), labels: { ...BRIEF_LABELS, ...((cfg.brief || {}).labels || {}) } }, home }
}

// ---- the app's session files, cached by mtime (580 MB on a busy PC: a full read takes ~15 s, a stat pass ~0.2 s) ----

/** Every session row (parseSession + awaiting, wrap-up line, needs_action), re-reading only changed files. */
export function sessionRows(cacheFile, cfg = {}) {
  let cache = { v: 2, files: {} }
  try { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (c && c.v === 2) cache = c } catch { /* first run */ }
  const next = { v: 2, files: {} }
  let changed = false
  for (const f of sessionFiles(appDir(cfg), 2)) {
    let st
    try { st = fs.statSync(f) } catch { continue }
    const old = cache.files[f]
    if (old && old.mtime === st.mtimeMs && old.size === st.size) { next.files[f] = old; continue }
    changed = true
    let j
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { continue }
    const row = parseSession(j)
    if (!row) { next.files[f] = { mtime: st.mtimeMs, size: st.size, row: null }; continue }
    const pts = j.postTurnSummary || {}
    row.awaiting = Boolean(j.interruptedAwaitingPerson)
    row.wrap_desc = String((j.turnWrapUp && j.turnWrapUp.description) || '')
    row.needs_action = String(pts.needs_action || '')
    next.files[f] = { mtime: st.mtimeMs, size: st.size, row }
  }
  if (changed || Object.keys(next.files).length !== Object.keys(cache.files).length) {
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(next)) } catch { /* cache is optional */ }
  }
  return Object.values(next.files).map((x) => x.row).filter(Boolean)
}

/** The row of a session (by CLI id or app sid) and its descendants as a tree {row, children: [...]}, depth-limited. */
export function treeOf(rows, { cli, sid }, maxDepth = 5) {
  const me = rows.find((r) => (cli && r.cli === cli) || (sid && r.sid === sid))
  if (!me) return null
  const byParent = new Map()
  for (const r of rows) if (r.parent) (byParent.get(r.parent) || byParent.set(r.parent, []).get(r.parent)).push(r)
  const seen = new Set()
  const walk = (r, d) => {
    seen.add(r.sid)
    const kids = d >= maxDepth ? [] : (byParent.get(r.sid) || []).filter((k) => !seen.has(k.sid)).sort((a, b) => (a.created || 0) - (b.created || 0))
    return { row: r, children: kids.map((k) => walk(k, d + 1)) }
  }
  return walk(me, 0)
}

export const countTree = (t) => (t ? t.children.reduce((n, k) => n + 1 + countTree(k), 0) : 0)

// ---- git, gh, glab: each call bounded, any failure → section says so ----

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }

/** One command, async (every conversation's git / gh calls run side by side): {code, out, err}, never throws. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: opts.timeoutMs || 20000, cwd: opts.cwd, env: ENV, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || '').trim(), err: String(stderr || '').trim() || (err ? String(err.message) : '') })
    })
  })
}

/** A .git (folder or worktree file) in cwd or a parent: checked before spawning git, which is slow on Windows. */
export function inRepo(cwd) {
  let d = path.resolve(cwd)
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(d, '.git'))) return true
    const up = path.dirname(d)
    if (up === d) return false
    d = up
  }
  return false
}

/** Branch, ahead/behind the default branch (no fetch), uncommitted files, last commits. {ok: false} when not a repo. */
export async function gitOf(cwd, B) {
  if (!cwd || !fs.existsSync(cwd) || !inRepo(cwd)) return { ok: false }
  // git calls cost ~1 s each on Windows: status, ahead/behind the bases and log run at once
  const g = (...a) => run('git', ['-C', cwd, ...a], { timeoutMs: B.timeout_s * 1000 })
  const bases = B.git_bases || ['origin/main', 'origin/master']
  const [st, lg, ...counts] = await Promise.all([
    g('status', '--porcelain=v1', '--branch'),
    g('log', `-${B.git_commits}`, '--format=%h %ad %s', '--date=format:%Y-%m-%d %H:%M'),
    ...bases.map((b) => g('rev-list', '--left-right', '--count', `${b}...HEAD`)),
  ])
  if (st.code) return { ok: false }
  const lines = st.out.split('\n').filter(Boolean)
  const head = (lines[0] || '').startsWith('## ') ? lines.shift().slice(3) : ''
  const branch = head.replace(/\.\.\..*$/, '').replace(/^No commits yet on /, '') || '?'
  let base = ''
  let ahead = 0
  let behind = 0
  for (const [i, b] of bases.entries()) {
    const c = counts[i]
    if (c.code) continue
    const n = c.out.split(/\s+/)
    base = b
    behind = Number(n[0]) || 0
    ahead = Number(n[1]) || 0
    break
  }
  const all = lines
  const files = all.slice(0, B.git_files)
  const commits = lg.out.split('\n').filter(Boolean)
  return { ok: true, branch, base, ahead, behind, files, moreFiles: Math.max(0, all.length - files.length), commits }
}

const hasMemo = {}
const has = (bin) => (hasMemo[bin] ??= run(bin, ['--version'], { timeoutMs: 8000 }).then((r) => r.code === 0))

/** GitHub PR: title, state, checks (counts + ETA of the slowest running check from its workflow's past successes). */
async function githubPr(p, B, memo) {
  const r = await run('gh', ['pr', 'view', String(p.number), '-R', p.repo, '--json', 'title,state,isDraft,url,statusCheckRollup'], { timeoutMs: B.timeout_s * 1000 })
  if (r.code) return { ...p, state: p.state || '?' }
  let j
  try { j = JSON.parse(r.out) } catch { return p }
  const checks = j.statusCheckRollup || []
  const res = (c) => String(c.conclusion || c.state || '').toUpperCase()
  const ok = checks.filter((c) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(res(c))).length
  const bad = checks.filter((c) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(res(c))).length
  const running = checks.filter((c) => String(c.status || '').toUpperCase() !== 'COMPLETED' && !res(c) || ['PENDING', 'EXPECTED'].includes(res(c)))
  const out = { ...p, title: j.title, state: String(j.state || '').toLowerCase(), draft: !!j.isDraft, checks: { total: checks.length, ok, bad, run: running.length } }
  // ETA: the running check whose workflow's past successful runs end last
  const now = Date.now()
  for (const c of running) {
    const wf = c.workflowName
    if (!wf || !c.startedAt) continue
    const key = `${p.repo}|${wf}`
    if (!memo[key]) memo[key] = run('gh', ['run', 'list', '-R', p.repo, '--workflow', wf, '--status', 'success', '--limit', '10', '--json', 'createdAt,updatedAt'], { timeoutMs: B.timeout_s * 1000 })
.then((h) => {
      let runs = []
      try { runs = JSON.parse(h.out).map((x) => Date.parse(x.updatedAt) - Date.parse(x.createdAt)).filter((x) => x > 0) } catch { /* no history */ }
      return estimateOf(runs)
    })
    const eta = etaOf(await memo[key], Date.parse(c.startedAt), now)
    if (eta && (!out.checks.eta || eta.mid > out.checks.eta.mid)) out.checks.eta = eta
  }
  return out
}

/** GitLab MR: title, state, head pipeline; ETA from the project's last successful pipelines (updated - created). */
async function gitlabMr(p, B) {
  const host = p.server && p.server !== 'gitlab.com' ? ['--hostname', p.server] : []
  const enc = encodeURIComponent(p.repo)
  const r = await run('glab', ['api', ...host, `projects/${enc}/merge_requests/${p.number}`], { timeoutMs: B.timeout_s * 1000 })
  if (r.code) return { ...p, state: p.state || '?' }
  let j
  try { j = JSON.parse(r.out) } catch { return p }
  const out = { ...p, title: j.title, state: String(j.state || '').toLowerCase(), draft: !!j.draft }
  const hp = j.head_pipeline || j.pipeline
  if (hp) {
    out.pipeline = { status: hp.status, id: hp.id }
    if (['running', 'pending', 'created'].includes(hp.status) && (hp.started_at || hp.created_at)) {
      const h = await run('glab', ['api', ...host, `projects/${enc}/pipelines?status=success&per_page=10`], { timeoutMs: B.timeout_s * 1000 })
      let runs = []
      try { runs = JSON.parse(h.out).map((x) => Date.parse(x.updated_at) - Date.parse(x.created_at)).filter((x) => x > 0) } catch { /* none */ }
      out.pipeline.eta = etaOf(estimateOf(runs), Date.parse(hp.started_at || hp.created_at), Date.now())
    }
  }
  return out
}

/** PRs / MRs of a conversation: the app's linked PRs + the ones its transcript opened, read with gh / glab. */
export async function forgeOf(row, lines, B, memo = {}) {
  const fromApp = (row.prs || []).map((p) => {
    const m = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(p.url || '')
    return m ? { host: 'github', repo: m[1], number: Number(m[2]), url: p.url, state: p.state } : null
  }).filter(Boolean)
  const all = []
  for (const p of [...fromApp, ...prsOpened(lines)]) if (!all.some((x) => x.url === p.url)) all.push(p)
  const list = all.slice(0, B.prs_max)
  if (B.forge === false) return { prs: list, skipped: list.length > 0 }
  let skipped = false
  const prs = await Promise.all(list.map(async (p) => {
    if (p.host === 'github' && (await has('gh'))) return githubPr(p, B, memo)
    if (p.host === 'gitlab' && (await has('glab'))) return gitlabMr(p, B)
    skipped = true
    return p
  }))
  return { prs, skipped }
}

// ---- one conversation, then the tree ----

function lastReplyOf(blocks) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role !== 'assistant') continue
    const t = blocks[i].items.filter((x) => x.kind === 'text').pop()
    if (t) return t.s
  }
  return ''
}

/** Everything the renderer needs for one session row. */
export async function convOf(row, B, cfg, nowMs, memo, rows = []) {
  const s = { ...row, project: projectOf(row) }
  const parent = row.parent && rows.find((r) => r.sid === row.parent)
  if (parent) s.parent_title = parent.title
  const transcript = transcriptOf(row.cli, row.cwd, cfg)
  let lines = []
  if (transcript) {
    lines = readTranscript(transcript)
    try { s.mtime = fs.statSync(transcript).mtimeMs } catch { /* gone */ }
    s.last_activity = Math.max(s.last_activity || 0, s.mtime || 0)
  }
  const blocks = briefBlocks(lines)
  let running = { workflows: [], agents: [] }
  try { running = readRunning({ root: projectsDir(cfg), session: row.cli, now: nowMs, state: newRunningState() }) } catch { /* none */ }
  const [forge, git] = await Promise.all([forgeOf(row, lines, B, memo), gitOf(row.cwd, B)])
  return {
    session: s, blocks, state: stateWord(s, blocks, nowMs, B.live_s), plan: planOf(lines), wrap: wrapOf(lines), lastReply: lastReplyOf(blocks),
    running, git, prs: forge.prs, forgeSkipped: forge.skipped, children: [],
  }
}

async function build(tree, B, cfg, nowMs, memo, rows) {
  const [c, children] = await Promise.all([convOf(tree.row, B, cfg, nowMs, memo, rows), Promise.all(tree.children.map((k) => build(k, B, cfg, nowMs, memo, rows)))])
  c.children = children
  return c
}

/** Copies a file's text to the clipboard. 'auto': PowerShell Set-Clipboard on Windows, pbcopy, wl-copy or xclip. */
export function copyFile(file, how = 'auto') {
  if (how === false || how === 'off') return { ok: false, why: 'off' }
  const lit = file.replace(/'/g, "''")
  const tries = Array.isArray(how) ? [how.map((a) => String(a).replace('{file}', file))]
    : process.platform === 'win32' ? [['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 -LiteralPath '${lit}')`]]
      : process.platform === 'darwin' ? [['pbcopy']] : [['wl-copy'], ['xclip', '-selection', 'clipboard']]
  const text = fs.readFileSync(file, 'utf8')
  for (const [cmd, ...args] of tries) {
    const usesFile = args.some((a) => a.includes(file))
    const r = spawnSync(cmd, args, { input: usesFile ? undefined : text, encoding: 'utf8', windowsHide: true, timeout: 30000 })
    if (r.status === 0) return { ok: true }
  }
  return { ok: false, why: 'clipboard' }
}

const day = (ms) => { const d = new Date(ms); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }

/** The whole run: returns {ok, file, copied, count, masked, held, cuts, error}. */
export async function makeBrief(opts = {}) {
  const nowMs = opts.now || Date.now()
  const { cfg, B } = opts.config || loadConfig()
  const rows = opts.rows || sessionRows(path.join(expandHome(B.dir), '.sessions-cache.json'), cfg)
  let tree = treeOf(rows, { cli: opts.session, sid: opts.sid }, opts.children ? B.max_depth : 0)
  // a CLI session the desktop app does not know (terminal): its transcript alone, with the cwd the caller gave
  if (!tree && opts.session && opts.cwd) tree = { row: { cli: opts.session, sid: '', title: opts.session.slice(0, 8), cwd: opts.cwd, origin: opts.cwd, prs: [] }, children: [] }
  if (!tree) return { ok: false, error: `conversation introuvable dans les fichiers de l’app : ${opts.session || opts.sid}` }
  const root = await build(tree, B, cfg, nowMs, {}, rows)
  const r = renderBrief(root, { labels: B.labels, maxChars: B.max_chars_per_conv, now: nowMs })
  const own = [cfg.own_emails || []].flat()
  if (root.git && root.git.ok) { const e = (await run('git', ['-C', tree.row.cwd, 'config', 'user.email'])).out; if (e) own.push(e) }
  const mo = maskOpts(cfg, own)
  const m = mask(r.md, mo)
  const held = check(m.text, mo)
  const file = opts.out || path.join(expandHome(B.dir), fill(opts.children ? B.file_children : B.file, { day: day(nowMs), slug: slug(tree.row.title || tree.row.cli, 60) || tree.row.cli.slice(0, 8) }))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, m.text)
  // a secret the mask could not fix stays in the local file but never reaches the clipboard
  const copied = held.length || opts.clip === false ? { ok: false, why: held.length ? 'held' : 'off' } : copyFile(file, B.clipboard)
  return { ok: true, file: file.replace(/\\/g, '/'), copied: copied.ok, why: copied.why, count: r.count, masked: m.total, held: held.map((h) => h.kind), cuts: r.cuts, chars: m.text.length }
}

export function oneLineResult(res) {
  if (!res.ok) return `Brief échoué : ${res.error}`
  const bits = [res.file, res.copied ? 'copié' : res.why === 'held' ? `PAS copié (secret non masquable : ${res.held.join(', ')})` : res.why === 'off' ? 'non copié' : 'copie impossible',
    `${res.count} conversation(s)`, `${Math.round(res.chars / 1000)} k car.`, res.masked ? `${res.masked} masqué(s)` : '', res.cuts.length ? `${res.cuts.length} coupée(s)` : ''].filter(Boolean)
  return `Brief : ${bits.join(' · ')}`
}

function argsOf(argv) {
  const o = { mode: argv[0] || 'run' }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--session') o.session = argv[++i]
    else if (a === '--sid') o.sid = argv[++i]
    else if (a === '--children') o.children = true
    else if (a === '--no-clip') o.clip = false
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--cwd') o.cwd = argv[++i]
    else if (a === '--json') o.json = true
  }
  return o
}

export async function main(argv = process.argv.slice(2)) {
  const o = argsOf(argv)
  if (!o.session && !o.sid) { console.log(o.json ? JSON.stringify({ ok: false, error: 'missing --session' }) : 'Brief échoué : --session manquant'); return 2 }
  if (o.mode === 'info') {
    const { cfg, B } = loadConfig()
    const rows = sessionRows(path.join(expandHome(B.dir), '.sessions-cache.json'), cfg)
    const t = treeOf(rows, o, B.max_depth)
    const info = t ? { found: true, sid: t.row.sid, title: t.row.title, children: countTree(t), direct: t.children.length } : { found: false, children: 0 }
    console.log(JSON.stringify(info))
    return 0
  }
  let res
  try { res = await makeBrief(o) } catch (err) { res = { ok: false, error: String(err && err.message ? err.message : err).slice(0, 300) } }
  console.log(o.json ? JSON.stringify({ ...res, line: oneLineResult(res) }) : oneLineResult(res))
  return res.ok ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((code) => { process.exitCode = code })
