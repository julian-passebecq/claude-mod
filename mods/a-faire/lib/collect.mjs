// a-faire - collection (Node, standard library): reads every source, measures the setup gaps, returns items.
// Used by scanner/afaire_scan.mjs (the pane's refresh) and by the veille watcher (lib/feed.mjs). Read-only except
// ~/.claude/a-faire (state.json, items.json, summary.json, prs-cache.json). Every source can be turned off; a missing
// source is skipped silently (its name goes to `errors` only when it exists and cannot be read).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyState, countToFile, deepMerge, gapItems, modsNotLoaded, parseDecisions, parseManualChecks, parseQuestions,
  prItems, pruneState, smtpProblem, summary, veilleItems,
} from './items.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const MOD = path.resolve(HERE, '..')
const HOME = os.homedir()

export const expand = (p) => String(p || '').replace(/^~(?=$|[\\/])/, HOME).replace(/\\/g, '/')
export const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) } catch { return d } }
const readText = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }
const mtime = (p) => { try { return fs.statSync(p).mtimeMs } catch { return null } }
const fileHref = (p) => (p ? 'file:///' + expand(p).replace(/^\/+/, '') : '')

export function loadConfig(home) {
  const base = readJson(path.join(MOD, 'afaire.config.json'), {}) || {}
  const h = expand(process.env.AFAIRE_HOME || home || base.home || '~/.claude/a-faire')
  const user = readJson(path.join(h, 'config.json'), {}) || {}
  const cfg = deepMerge(base, user)
  cfg.home = h
  return cfg
}

export const paths = (cfg) => ({
  home: cfg.home, state: path.join(cfg.home, 'state.json'), items: path.join(cfg.home, 'items.json'),
  summary: path.join(cfg.home, 'summary.json'), prs: path.join(cfg.home, 'prs-cache.json'),
})

export function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 1))
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return } catch (e) {
      if (i >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { fs.unlinkSync(tmp) } catch { /* gone */ } throw e }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1))
    }
  }
}

export function run(argv, { timeoutMs = 30000, env } = {}) {
  return new Promise((resolve) => {
    let out = '', err = ''
    let child
    try { child = spawn(argv[0], argv.slice(1), { env: env || process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { resolve({ code: 1, out: '', err: String(e.message || e) }); return }
    const t = setTimeout(() => { try { child.kill() } catch { /* gone */ } }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { err += String(e.message || e) })
    child.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 1, out, err }) })
  })
}

const rx = (s) => { try { return s ? new RegExp(s, 'i') : null } catch { return null } }

// ---- measured facts ------------------------------------------------------------------------------------------------

function modFolders(roots) {
  const out = []
  for (const r of roots) {
    let names = []
    try { names = fs.readdirSync(r, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { continue }
    for (const n of names) if (fs.existsSync(path.join(r, n, '.claude-plugin', 'plugin.json'))) out.push({ name: n, path: `${expand(r)}/${n}` })
  }
  return out
}

async function taskFacts(S, opts) {
  const t = S.task || {}
  const vh = expand(S.veille.home)
  const hb = readJson(path.join(vh, 'heartbeat.json'), null)
  const vcfg = readJson(path.join(vh, 'config.json'), {}) || {}
  const facts = { checked: false, present: false, lastFire: hb && hb.last_fire, everyMin: t.fire_every_min || 5, name: t.name || 'ClaudeVeille' }
  if (t.enabled === false) return facts
  if (opts.taskQuery) { Object.assign(facts, await opts.taskQuery(facts.name), { checked: true }); return facts }
  if (process.platform !== 'win32') return facts
  const r = await run(['schtasks.exe', '/Query', '/TN', facts.name, '/FO', 'LIST'], { timeoutMs: 15000 })
  facts.checked = true
  facts.present = r.code === 0
  if (!facts.present && vcfg.installed === false) facts.checked = false // uninstalled on purpose
  return facts
}

async function prsOf(S, cfg, opts, errors) {
  const P = S.prs || {}
  if (P.enabled === false) return []
  const cacheFile = paths(cfg).prs
  const cache = readJson(cacheFile, null)
  const now = opts.now
  if (cache && Array.isArray(cache.prs) && now - (cache.at || 0) < (P.ttl_min || 30) * 60000 && !opts.fresh) return cache.prs
  if (opts.prs) return opts.prs
  const gh = opts.gh || 'gh'
  const r = await run([gh, 'search', 'prs', '--author', '@me', '--state', 'open', '--json', 'title,url,number,repository,labels,body,createdAt', '--limit', String(P.limit || 100)], { timeoutMs: 45000, env: opts.env })
  if (r.code !== 0) { if (!/not found|ENOENT|not recognized/i.test(r.err)) errors.push('prs'); return cache && Array.isArray(cache.prs) ? cache.prs : [] }
  let prs = []
  try { prs = JSON.parse(r.out || '[]') } catch { errors.push('prs'); return [] }
  // Keep only what the parser needs, body cut short: the cache stays small.
  const slim = prs.map((p) => ({ title: p.title, url: p.url, number: p.number, repository: { nameWithOwner: (p.repository || {}).nameWithOwner }, labels: (p.labels || []).map((l) => ({ name: l.name })), body: String(p.body || '').slice(0, 6000), createdAt: p.createdAt }))
  try { writeAtomic(cacheFile, { at: now, prs: slim }) } catch { /* next time */ }
  return slim
}

// ---- every source -> items -----------------------------------------------------------------------------------------

export async function collect(cfg, opts = {}) {
  const now = opts.now || Date.now()
  const S = cfg.sources || {}
  const errors = []
  const loginRe = rx(cfg.login_match)
  const items = []
  const src = (name) => (S[name] || {}).enabled !== false

  // setup gaps first: manual-check lines they cover are dropped
  const vh = expand((S.veille || {}).home || '~/.claude/veille')
  const facts = { now, veilleHome: vh, veilleInstalled: fs.existsSync(vh) }
  if (src('smtp')) {
    const smtpFile = path.join(vh, 'smtp.json')
    facts.smtpProblem = smtpProblem(readJson(smtpFile, null))
    const ex = path.join(MOD, '..', 'veille', 'smtp.example.json')
    facts.smtpExample = fs.existsSync(ex) ? path.resolve(ex).replace(/\\/g, '/') : ''
    facts.watcherScript = `${vh}/bin/veille/watcher/veille.mjs`
    facts.smtpSince = mtime(path.join(vh, 'config.json'))
  } else facts.smtpProblem = ''
  const wsrc = path.join(MOD, '..', 'veille', 'watcher', 'veille.mjs')
  facts.watcherSource = fs.existsSync(wsrc) ? path.resolve(wsrc).replace(/\\/g, '/') : ''
  if (src('mods')) {
    const M = S.mods || {}
    const roots = (M.roots && M.roots.length ? M.roots : [path.resolve(MOD, '..')]).map(expand)
    const settingsFile = expand(M.settings || '~/.claude/settings.json')
    const settings = readJson(settingsFile, {}) || {}
    const value = (settings.env || {}).CLAUDE_CODE_PLUGIN_DIRS ?? process.env.CLAUDE_CODE_PLUGIN_DIRS ?? ''
    const ignore = new Set((M.ignore || []).map((s) => s.toLowerCase()))
    const found = modFolders(roots).filter((m) => !ignore.has(m.name.toLowerCase()))
    facts.mods = { ...modsNotLoaded(found, value, process.platform === 'win32' ? ';' : ':'), settings: settingsFile }
  }
  if (src('task') && src('veille')) facts.task = await taskFacts({ ...S, veille: S.veille || {} }, opts)
  if (src('secrets')) {
    const reg = expand((S.secrets || {}).registry || '~/.claude/tests-reels/registry.json')
    const data = readJson(reg, undefined)
    if (data !== undefined && data !== null) facts.secrets = { count: countToFile(data, rx((S.secrets || {}).match || 'ranger') || /ranger/i), registry: reg, since: mtime(reg) }
  }
  const gaps = gapItems(facts)
  items.push(...gaps)

  if (src('manual_checks')) {
    const f = expand((S.manual_checks || {}).file || '~/.claude/effort-board/manual-checks.md')
    const t = readText(f)
    if (t !== null) items.push(...parseManualChecks(t, { file: path.basename(f), href: fileHref(f), loginRe, gaps }))
  }
  if (src('questions')) {
    const Q = S.questions || {}
    const f = expand(Q.file || '~/.claude/effort-board/questions.md')
    const t = readText(f)
    if (t !== null) items.push(...parseQuestions(t, { file: path.basename(f), href: fileHref(f), match: Q.match }))
  }
  if (src('decisions')) {
    for (const raw of (S.decisions || {}).files || []) {
      const f = expand(raw)
      const t = readText(f)
      if (t === null) continue
      items.push(...parseDecisions(t, { file: path.basename(f), href: fileHref(f), stop: rx((S.decisions || {}).stop), sinceMs: mtime(f) }))
    }
  }
  if (src('prs')) {
    const P = S.prs || {}
    items.push(...prItems(await prsOf(S, cfg, { ...opts, now }, errors), { labels: P.labels || [], name: P.name, verbs: P.verbs }))
  }
  if (src('veille')) {
    const state = readJson(path.join(vh, 'state.json'), null)
    const acks = (readText(path.join(vh, 'acks.jsonl')) || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).key } catch { return null } }).filter(Boolean)
    items.push(...veilleItems(state, acks, { loginRe }))
  }
  // one item per id (the same line twice in a file)
  const seen = new Set()
  const uniq = items.filter((i) => (seen.has(i.id) ? false : seen.add(i.id))).map(({ match, ...i }) => i)
  return { items: uniq, errors, now }
}

// Scan, apply done/snooze, write items.json and summary.json (counts only).
export async function scan(cfg, opts = {}) {
  const p = paths(cfg)
  const { items, errors, now } = await collect(cfg, opts)
  const state = pruneState(readJson(p.state, {}) || {}, items, now)
  const { open, snoozed } = applyState(items, state, now)
  const sum = summary(open, snoozed, now, errors)
  if (!opts.dry) {
    writeAtomic(p.items, { v: 1, at: now, open, snoozed, errors })
    writeAtomic(p.summary, sum)
  }
  return { items, open, snoozed, errors, summary: sum, state }
}
