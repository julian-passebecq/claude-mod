#!/usr/bin/env node
// veille - the watcher. Node 22+, standard library only, no model tokens of its own.
//   node veille.mjs fire              what the scheduled task runs every fire_every_min: heartbeat, tour when due
//   node veille.mjs tour              one tour now (whatever the interval)
//   node veille.mjs status            mode, task, last fire and tour, alerts, paths, e-mail
//   node veille.mjs mode <x>          rien | légère | active | nuit-active | nuit-test-légère
//   node veille.mjs ack <key|all>     acknowledge an alert (no more notifications or e-mails for it)
//   node veille.mjs coordinator <session-id> [cwd]   the conversation woken for actions the script cannot do
//   node veille.mjs install [--launcher wscript|conhost] | uninstall
//   node veille.mjs test-mail
//   node veille.mjs fil               rebuild the Fil digest (fil.json) now, from files only
//   node veille.mjs archiver          rebuild archive.json (finished conversations to archive) and print the list
//   node veille.mjs nuit | jour       night: mode nuit-active from now; day: mode légère + night summary (night-summary.json)
//   node veille.mjs wake-test         the safe wake on a throwaway target, then the check of model, effort, permission mode
//   node veille.mjs wakes             refresh and print wakes.json (results of the fresh sessions the veille started)
// State in ~/.claude/veille/. Only `fire`/`tour` write state.json and heartbeat.json (and fil.json, archive.json); `mode`, `coordinator`,
// `install` write config.json; `ack` writes acks.jsonl. Tokens stay with gh and glab: never read, printed or stored.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  deepMerge, modeName, modeOf, may, tourDue, gapOf, alertsOf, reconcile, plan, markSent, budgetLeft, pruneSpent,
  mergeCandidates, ownerOf, ghEligible, glEligible, wakeDecision, brief, prText, scrub, fill, watcherState, MODES, due,
} from '../lib/core.mjs'
import { compose, digest, sendMail, smtpProblem } from '../lib/mail.mjs'
import { age } from '../lib/core/waiting.mjs'
import { attendJulian } from '../lib/core/veille.mjs'
import { writeHealth } from '../lib/core/health.mjs'
import { julianAlerts } from '../lib/fil.mjs'
import { writeFil, appDir } from './fil.mjs'
import { wakeSettings, wakeArgv, wakeEnv, parseWakeLog, transcriptSettings, verifyWake, nightSummary, deadlineAlerts, vendorDue, vendorAlerts, normVersion } from '../lib/night.mjs'
import { writeArchive } from './archive.mjs'
import { archiveText } from '../lib/archive.mjs'
import { exportBatch } from './export-batch.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOD = path.resolve(HERE, '..')
const MODS = path.resolve(MOD, '..')
const USER_HOME = os.homedir()
const children = new Set()

const expand = (p) => String(p || '').replace(/^~(?=$|[\\/])/, USER_HOME)
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) } catch { return d } }

export function loadConfig() {
  const base = readJson(path.join(MOD, 'veille.config.json'), {})
  const factory = readJson(path.join(MODS, 'factory', 'factory.config.json'), {})
  const home = expand(process.env.VEILLE_HOME || base.home || '~/.claude/veille')
  const user = readJson(path.join(home, 'config.json'), {})
  const cfg = deepMerge(deepMerge(base, { waiting: factory.waiting || {} }), user)
  cfg.home = home
  return cfg
}

const P = (cfg) => {
  const h = cfg.home
  return {
    home: h, config: path.join(h, 'config.json'), state: path.join(h, 'state.json'), heartbeat: path.join(h, 'heartbeat.json'),
    events: path.join(h, 'events.jsonl'), acks: path.join(h, 'acks.jsonl'), lock: path.join(h, 'lock'), cache: path.join(h, 'scan_cache.json'),
    smtp: path.join(h, 'smtp.json'), fil: path.join(h, 'fil.json'), archive: path.join(h, 'archive.json'), wakesIndex: path.join(h, 'wakes.json'), night: path.join(h, 'night-summary.json'), paths: path.join(h, 'paths.json'), bin: path.join(h, 'bin'), wakes: path.join(h, 'wakes'),
  }
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 1))
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return } catch (e) {
      if (i >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { fs.unlinkSync(tmp) } catch { /* gone */ } throw e }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1)) // the pane may be reading it: retry
    }
  }
}

// Errors of this run (watcher, scan, fil, export, mail, toast...), written once at exit as the health record
// ~/.claude/mods-health/veille.json (lib/core/health.mjs), which Santé and the Problèmes register read.
export const ERRORS = []
export const isError = (kind) => /_failed$/.test(String(kind || ''))
export function healthError(errors) {
  const list = [...new Set((errors || []).filter(Boolean))]
  return list.length ? list.join(' | ').slice(0, 500) : null
}

function logEvent(cfg, ev, secrets = []) {
  const p = P(cfg)
  const line = scrub(JSON.stringify({ at: Date.now(), ...ev }), secrets)
  if (isError(ev.kind)) ERRORS.push(`${ev.kind}: ${String(JSON.parse(line).error || ev.reason || '').slice(0, 160)}`)
  try {
    fs.mkdirSync(p.home, { recursive: true })
    try { if (fs.statSync(p.events).size > 5 * 1024 * 1024) fs.renameSync(p.events, p.events + '.1') } catch { /* no file yet */ }
    fs.appendFileSync(p.events, line + '\n')
  } catch { /* the pane shows state.json anyway */ }
  return JSON.parse(line)
}

function toolPaths(cfg) {
  const saved = readJson(P(cfg).paths, {}) || {}
  return { node: saved.node || process.execPath, python: saved.python || 'python', gh: saved.gh || 'gh', glab: saved.glab || 'glab',
    claude: saved.claude || 'claude', powershell: saved.powershell || 'powershell.exe' }
}

// The task may start without the user's PATH: put the folders of gh and glab first for the scanner and our own calls.
function toolEnv(tp) {
  const dirs = [tp.gh, tp.glab, tp.python, tp.claude].filter((x) => path.isAbsolute(x)).map((x) => path.dirname(x))
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH'
  return { ...process.env, [key]: [...new Set(dirs), process.env[key] || ''].join(path.delimiter) }
}

function run(argv, { timeoutMs = 60000, env, cwd, input } = {}) {
  return new Promise((resolve) => {
    let out = '', err = ''
    let child
    try {
      child = spawn(argv[0], argv.slice(1), { env, cwd: cwd || USER_HOME, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) { resolve({ code: 1, out: '', err: String(e.message || e) }); return }
    children.add(child)
    const t = setTimeout(() => { try { child.kill() } catch { /* gone */ } }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { err += String(e.message || e) })
    child.on('close', (code) => { clearTimeout(t); children.delete(child); resolve({ code: code ?? 1, out, err }) })
    if (input) child.stdin.end(input); else child.stdin.end()
  })
}

const jsonOf = (r) => { try { return r.code === 0 ? JSON.parse(r.out || 'null') : null } catch { return null } }

// ---- lock: one tour at a time; stale when its pid is gone --------------------------------------------------------------

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

function takeLock(cfg) {
  const f = P(cfg).lock
  fs.mkdirSync(path.dirname(f), { recursive: true })
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(f, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' }); return true } catch {
      const l = readJson(f, {})
      if (l && l.pid && alive(l.pid) && Date.now() - (l.at || 0) < 2 * (cfg.tour_deadline_s || 480) * 1000) return false
      try { fs.unlinkSync(f) } catch { /* raced */ }
    }
  }
  return false
}

const dropLock = (cfg) => { try { const l = readJson(P(cfg).lock, {}); if (l && l.pid === process.pid) fs.unlinkSync(P(cfg).lock) } catch { /* gone */ } }

// ---- notifications ---------------------------------------------------------------------------------------------------

async function toast(cfg, title, body) {
  const tp = toolPaths(cfg)
  const script = path.join(HERE, 'toast.ps1')
  if (process.platform !== 'win32') return false
  const r = await run([tp.powershell, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script],
    { timeoutMs: 20000, env: { ...process.env, VEILLE_TITLE: String(title).slice(0, 120), VEILLE_BODY: String(body).slice(0, 400) } })
  if (r.code !== 0) ERRORS.push(`toast_failed: ${String(r.err || r.out || 'exit ' + r.code).trim().split(/\r?\n/).pop().slice(0, 160)}`)
  return r.code === 0
}

function detached(cfg, argv, cwd, tag, env = toolEnv(toolPaths(cfg))) {
  const p = P(cfg)
  fs.mkdirSync(p.wakes, { recursive: true })
  const logFile = path.join(p.wakes, `${new Date().toISOString().replace(/[:.]/g, '-')}-${tag}.log`)
  const fd = fs.openSync(logFile, 'a')
  const child = spawn(argv[0], argv.slice(1), { cwd, detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env })
  child.on('error', () => undefined)
  child.unref()
  fs.closeSync(fd)
  return logFile
}

function manualCheck(cfg) {
  if (!(cfg.mail || {}).manual_check) return
  const f = path.join(USER_HOME, '.claude', 'effort-board', 'manual-checks.md')
  if (!fs.existsSync(path.dirname(f))) return
  const txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
  if (txt.includes('veille/smtp.json')) return
  const d = new Date()
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  fs.appendFileSync(f, `${txt && !txt.endsWith('\n') ? '\n' : ''}${day} · claude-mod · create a Gmail app password and ~/.claude/veille/smtp.json for the veille e-mails · copy mods/veille/smtp.example.json to ~/.claude/veille/smtp.json, fill host smtp.gmail.com, port 587, user, the 16-letter app password (myaccount.google.com/apppasswords), from, to; then node ~/.claude/veille/bin/veille/watcher/veille.mjs test-mail\n`)
}

// ---- merge (nuit-active only): fresh, strict re-check, then gh / glab -------------------------------------------------

async function tryMerges(cfg, scan, state, env, now, events, extra) {
  const tp = toolPaths(cfg)
  const seen = { ...(state.merge_seen || {}) }
  const next = {}
  let merged = 0
  for (const r of mergeCandidates(scan, cfg)) {
    if (merged >= ((cfg.merge || {}).max_per_tour || 3)) break
    const owner = ownerOf(scan, r.url)
    const ctx = { repo: r.repo, merge: cfg.merge, now, ownerLive: !!(owner && owner.live) }
    let verdict
    if (r.provider === 'github') {
      const pr = jsonOf(await run([tp.gh, 'pr', 'view', String(r.number), '-R', r.repo, '--json', 'state,isDraft,mergeable,headRefOid,baseRefName,statusCheckRollup,labels,title'], { env, timeoutMs: 30000 }))
      const sha = pr && pr.headRefOid
      const behind = sha ? jsonOf(await run([tp.gh, 'api', `repos/${r.repo}/compare/${encodeURIComponent(pr.baseRefName)}...${sha}`, '--jq', '{behind_by: .behind_by}'], { env, timeoutMs: 30000 })) : null
      next[r.url] = seen[r.url] && seen[r.url].sha === sha ? seen[r.url] : { sha, since: now }
      verdict = ghEligible(pr, behind, { ...ctx, seen: seen[r.url] })
      if (verdict.ok) {
        const m = await run([tp.gh, 'pr', 'merge', String(r.number), '-R', r.repo, '--squash', '--delete-branch', '--match-head-commit', sha], { env, timeoutMs: 120000 })
        events.push(logEvent(cfg, { kind: m.code === 0 ? 'merged' : 'merge_failed', url: r.url, pr: prText(r), sha, reason: 'tous les checks success, à jour avec la base, tête stable, conversation inactive', error: m.code === 0 ? undefined : (m.err || m.out).trim().slice(-300) }))
        if (m.code === 0) merged++
      }
    } else {
      const proj = encodeURIComponent(r.repo)
      const mr = jsonOf(await run([tp.glab, 'api', `projects/${proj}/merge_requests/${r.number}?include_diverged_commits_count=true`], { env, timeoutMs: 30000 }))
      const pid = mr && mr.head_pipeline && mr.head_pipeline.id
      const jobs = pid ? jsonOf(await run([tp.glab, 'api', `projects/${proj}/pipelines/${pid}/jobs?per_page=100`], { env, timeoutMs: 30000 })) : null
      const sha = mr && mr.sha
      next[r.url] = seen[r.url] && seen[r.url].sha === sha ? seen[r.url] : { sha, since: now }
      verdict = glEligible(mr, jobs, { ...ctx, seen: seen[r.url] })
      if (verdict.manual) extra.push({ key: `manual:${r.url}:${sha}`, kind: 'manual', what: `${prText(r)} : pipeline en attente d’un job manuel, jamais mergée par la veille`, title: owner ? owner.app_title || owner.title : '', link: r.url, since: now })
      if (verdict.ok) {
        const m = await run([tp.glab, 'api', '-X', 'PUT', `projects/${proj}/merge_requests/${r.number}/merge`, '-f', 'squash=true', '-f', 'should_remove_source_branch=true', '-f', `sha=${sha}`], { env, timeoutMs: 120000 })
        events.push(logEvent(cfg, { kind: m.code === 0 ? 'merged' : 'merge_failed', url: r.url, pr: prText(r), sha, reason: 'pipeline success, chaque job success, à jour avec la cible, tête stable, conversation inactive', error: m.code === 0 ? undefined : (m.err || m.out).trim().slice(-300) }))
        if (m.code === 0) merged++
      }
    }
    if (!verdict.ok) events.push(logEvent(cfg, { kind: 'merge_skipped', url: r.url, pr: prText(r), reason: verdict.why.join(' ; ') }))
  }
  return next
}

// ---- one tour ----------------------------------------------------------------------------------------------------------

async function tour(cfg, why) {
  const p = P(cfg)
  if (!takeLock(cfg)) { console.log('veille: a tour is already running'); return 0 }
  const now = Date.now()
  const mode = modeOf(cfg)
  const state = readJson(p.state, {}) || {}
  const hb = readJson(p.heartbeat, {}) || {}
  const tp = toolPaths(cfg)
  const env = toolEnv(tp)
  const events = []
  const smtp = readJson(p.smtp, null)
  const secrets = smtp && smtp.password ? [smtp.password] : []
  try {
    events.push(logEvent(cfg, { kind: 'tour', mode: mode.name, why }))
    const scanner = path.join(MODS, 'factory', 'scanner', 'factory_scan.py')
    const w = cfg.waiting || {}
    const r = await run([tp.python, '-I', scanner, '--cache', p.cache, '--hours', String(cfg.scan_hours || 36), '--waiting',
      '--pr-ttl', '60', '--pr-max-age-days', String(w.pr_max_age_days || 14), '--pr-max-checks', String(w.pr_max_checks || 25),
      ...(w.gitlab_host ? ['--gl-host', String(w.gitlab_host)] : [])], { env, timeoutMs: 240000 })
    if (r.code !== 0) throw new Error(`scanner: ${(r.err || '').trim().split('\n').pop() || 'exit ' + r.code}`)
    const scan = JSON.parse(r.out)

    // The Fil (every conversation's last message) and its « attend Julian » rows: one per conversation and question.
    let filRows = []
    try { filRows = julianAlerts(writeFil(cfg, p.fil)) } catch (e) { events.push(logEvent(cfg, { kind: 'fil_failed', error: String(e && e.message || e).slice(0, 200) })) }
    const filClis = new Set(filRows.map((a) => a.cli).filter(Boolean))
    const extra = []
    for (const g of (hb.gaps || []).filter((g) => now - g.to < 24 * 3600000)) {
      extra.push({ key: `missed:${g.from}`, kind: 'missed', what: `veille arrêtée de ${hm(g.from)} à ${hm(g.to)} (${age(g.to - g.from)} sans tour)`, title: 'veille', since: g.from })
    }
    let mergeSeen = state.merge_seen || {}
    if (may(cfg, 'merge', mode)) mergeSeen = await tryMerges(cfg, scan, state, env, now, events, extra)
    // export-eta: a batch of finished conversations -> one alert with an « Exporter vers eta » button (or auto export).
    try {
      const x = await exportBatch(run, MODS, env, now, tp.node || process.execPath)
      if (x.alert) extra.push(x.alert)
      if (x.event) events.push(logEvent(cfg, x.event))
    } catch (e) { events.push(logEvent(cfg, { kind: 'export_failed', error: String(e.message || e) })) }

    // Deadlines (J-7, J-1) of the « À toi · Claude Control » list, and the weekly vendored-mod version check.
    extra.push(...deadlinesOf(cfg, now))
    let vendor = state.vendor || null
    const V = cfg.vendor_check || {}
    if (V.enabled !== false && vendorDue(vendor, now, V.every_days || 7)) vendor = await vendorCheck(cfg, tp, env, now, events)
    if (V.enabled !== false) extra.push(...vendorAlerts(vendor))

    // Rows woken twice without effect turn into a needs-Julian alert.
    const W = cfg.wake || {}
    const base = alertsOf(scan, cfg, now, extra)
    for (const a of base) {
      const hist = ((state.wakes || {})[a.key] || []).filter((x) => now - x < (W.max_per_row_window_h || 12) * 3600000)
      if (hist.length >= (W.max_per_row || 2)) extra.push({ key: `exhausted:${a.key}`, kind: 'exhausted', what: `réveillé ${hist.length} fois sans effet : ${a.what}`, title: a.title, cli: a.cli, sid: a.sid, link: a.link, session_link: a.session_link, since: Math.min(...hist) })
    }
    // factory's own Julian rows for a conversation the Fil already covers would notify twice: the Fil row wins
    const alerts = alertsOf(scan, cfg, now, [...extra, ...filRows]).filter((a) => !(FACTORY_JULIAN.includes(a.kind) && filClis.has(a.cli)))
    const acks = readAcks(cfg)
    const rec = reconcile(state, alerts, acks, now, (cfg.alerts || {}).keep_resolved)
    const list = Object.values(rec.alerts)
    for (const a of rec.fresh) events.push(logEvent(cfg, { kind: 'alert', key: a.key, severity: a.severity, what: a.what, title: a.title, link: a.link || a.session_link }))
    for (const g of rec.gone) events.push(logEvent(cfg, { kind: 'resolved', key: g.key, what: g.what }))

    const todo = plan(list, rec.fresh.map((a) => rec.alerts[a.key]), cfg, state, now)
    // a-faire (sibling mod, when present): new high-priority actions only Julian can do, each pushed once.
    const feed = await aFaireFeed(tp, env, now)
    if (feed.length) events.push(logEvent(cfg, { kind: 'afaire', keys: feed.map((a) => a.key), reason: `${feed.length} nouvelle(s) action(s) pour Julian (/afaire)` }))
    if (may(cfg, 'notify', mode)) todo.notify = [...todo.notify, ...feed]
    if (may(cfg, 'mail', mode)) todo.mail = [...todo.mail, ...feed]
    let sent = state.sent || {}
    // (1) Windows notifications: at most 3 per tour, then one « N autres ».
    const shown = todo.notify.slice(0, 3)
    for (const a of shown) if (await toast(cfg, `Veille · ${(cfg.labels.severity || {})[a.severity] || a.severity}`, `${a.what}${a.title ? ' · ' + a.title : ''}`)) events.push(logEvent(cfg, { kind: 'notified', key: a.key }))
    if (todo.notify.length > 3) await toast(cfg, 'Veille', `${todo.notify.length - 3} autres alertes dans /veille`)
    // (2) e-mail digest for what needs Julian.
    let mailState = 'off'
    if (todo.mail.length) {
      const problem = smtpProblem(smtp)
      if (problem) { mailState = 'not_configured'; manualCheck(cfg); events.push(logEvent(cfg, { kind: 'mail_skipped', reason: `e-mail non configuré (${problem})`, keys: todo.mail.map((a) => a.key) })) }
      else {
        try {
          const msg = compose({ from: smtp.from, to: smtp.to, subject: fill(cfg.mail.subject, { n: todo.mail.length }), text: digest(todo.mail, now, age) })
          await sendMail(smtp, msg)
          sent = markSent(sent, 'mail', todo.mail.map((a) => a.key), now)
          mailState = 'sent'
          events.push(logEvent(cfg, { kind: 'mailed', keys: todo.mail.map((a) => a.key), to_count: [].concat(smtp.to).length }, secrets))
        } catch (e) { mailState = 'error'; events.push(logEvent(cfg, { kind: 'mail_failed', error: scrub(e.message, secrets) }, secrets)) }
      }
    }
    // Gap e-mail: once per gap, whatever the mode (the pane is seen only when a session is open).
    for (const g of (hb.gaps || [])) {
      if ((state.gap_mailed || []).includes(g.from) || smtpProblem(smtp) || mode.name === 'rien') continue
      try {
        const subject = fill(cfg.mail.gap_subject, { from: hm(g.from), to: hm(g.to) })
        await sendMail(smtp, compose({ from: smtp.from, to: smtp.to, subject, text: `${subject}\nAucun tour pendant ${age(g.to - g.from)}. La tâche ClaudeVeille tourne de nouveau.` }))
        state.gap_mailed = [...(state.gap_mailed || []), g.from].slice(-20)
      } catch (e) { events.push(logEvent(cfg, { kind: 'mail_failed', error: scrub(e.message, secrets) }, secrets)) }
    }
    // (3) optional Claude push and (4) wakes: within the mode's token budget per hour.
    let spent = pruneSpent(state.spent, now)
    const perHour = mode.claude_tokens_per_hour || 0
    if (todo.push.length) {
      const est = (cfg.push || {}).est_tokens || 30000
      if (budgetLeft(spent, perHour, now) >= est) {
        const text = todo.push.map((a) => `${a.title || ''} : ${a.what}`).join(' | ').slice(0, 300)
        const pm = (cfg.push || {}).model || 'claude-haiku-5-5'
        const log = detached(cfg, [tp.claude, '-p', '--model', pm, `Appelle l'outil PushNotification avec exactement ce texte, puis arrête-toi : Veille — ${text}`], USER_HOME, 'push', { ...env, CLAUDE_CODE_SUBAGENT_MODEL: pm })
        spent = [...spent, { at: now, tokens: est }]
        sent = markSent(sent, 'push', todo.push.map((a) => a.key), now)
        events.push(logEvent(cfg, { kind: 'push', keys: todo.push.map((a) => a.key), log: path.basename(log), reason: 'attend Julian (non vérifié : le push n’atteint le téléphone que si Remote Control est connecté)' }))
      } else events.push(logEvent(cfg, { kind: 'push_skipped', reason: 'budget de tokens atteint' }))
    }
    const wakes = { ...(state.wakes || {}) }
    for (const a of list) {
      const d = wakeDecision(a, scan, cfg, { ...state, spent, wakes }, now)
      if (!d.ok) { if (may(cfg, 'wake', mode) && (cfg.wake.kinds || []).includes(a.kind) && !a.acked && rec.fresh.some((f) => f.key === a.key)) events.push(logEvent(cfg, { kind: 'wake_skipped', key: a.key, reason: d.why })); continue }
      const s = wakeSettings(findSession(cfg, d.target))
      if (!s.ok) { events.push(logEvent(cfg, { kind: 'wake_skipped', key: a.key, reason: s.why })); continue }
      const text = brief(a, cfg, now, `node "${path.join(p.bin, 'veille', 'watcher', 'veille.mjs')}" ack`, { archive: archiveCount(cfg), file: p.archive, fresh: true })
      const log = startWake(cfg, tp, s, text, { key: a.key, title: d.target.title, reason: a.what }, now)
      wakes[a.key] = [...(wakes[a.key] || []), now].slice(-10)
      spent = [...spent, { at: now, tokens: d.tokens }]
      events.push(logEvent(cfg, { kind: 'woken', key: a.key, target: d.target.title, cli: d.target.cli, tokens_est: d.tokens, log: path.basename(log), reason: `${a.what} (session neuve ${s.model} · ${s.effort} · ${s.permission})` }))
    }
    for (const k of Object.keys(wakes)) if (!rec.alerts[k] && !wakes[k].some((t) => now - t < 24 * 3600000)) delete wakes[k]

    const recent = [...events.filter((e) => e.kind !== 'tour'), ...(state.recent || [])].slice(0, (cfg.pane || {}).events || 25)
    writeAtomic(p.state, {
      v: 1, mode: mode.name, last_tour: now, tours: (state.tours || 0) + 1, last_error: '', alerts: rec.alerts, resolved: rec.resolved,
      sent, spent, wakes, vendor, merge_seen: mergeSeen, gap_mailed: state.gap_mailed || [], mail: mailState === 'off' ? state.mail || (smtpProblem(smtp) ? 'not_configured' : 'configured') : mailState,
      reviews_errors: (scan.reviews && scan.reviews.errors) || [], sessions: (scan.sessions || []).length, reviews: ((scan.reviews || {}).items || []).length, recent,
    })
    writeAtomic(p.heartbeat, { ...readJson(p.heartbeat, {}), last_tour: now, last_tour_ok: true, last_error: '' })
    console.log(`veille: tour ${mode.name}: ${list.length} alert(s), ${rec.fresh.length} new, ${(scan.sessions || []).length} conversations, ${((scan.reviews || {}).items || []).length} PR/MR`)
    return 0
  } catch (e) {
    const msg = scrub(String(e && e.message ? e.message : e), secrets).slice(0, 300)
    logEvent(cfg, { kind: 'tour_failed', error: msg })
    writeAtomic(p.heartbeat, { ...readJson(p.heartbeat, {}), last_tour: now, last_tour_ok: false, last_error: msg })
    try { writeAtomic(p.state, { ...state, last_error: msg, recent: [{ at: now, kind: 'tour_failed', error: msg }, ...(state.recent || [])].slice(0, 25) }) } catch { /* keep the old one */ }
    console.error(`veille: tour failed: ${msg}`)
    return 1
  } finally {
    dropLock(cfg)
    // after a failed tour too: Santé's and the veille's health records reach Problèmes even when the scanner fails
    await problemes(cfg, tp).catch(() => undefined)
  }
}

const FACTORY_JULIAN = ['ask', 'needs', 'awaiting']

// Between two tours (every fire, even in légère): rebuild the Fil and announce at once what newly waits on Julian
// (Windows notification, and the e-mail when smtp.json exists). Only the Fil's alerts are touched here; the tour
// reconciles everything else. Once per conversation and per question: the key carries a hash of the question.
async function julianPass(cfg) {
  const p = P(cfg)
  if (!takeLock(cfg)) return 0
  const now = Date.now()
  const state = readJson(p.state, {}) || {}
  const smtp = readJson(p.smtp, null)
  const secrets = smtp && smtp.password ? [smtp.password] : []
  const events = []
  try {
    const sev = (cfg.alerts || {}).severity || {}
    const rows = julianAlerts(writeFil(cfg, p.fil)).map((a) => ({ ...a, severity: sev[a.kind] || 'julian', julian: true }))
    const all = state.alerts || {}
    const isFil = (a) => String((a && a.kind) || '').startsWith('fil_')
    const others = Object.fromEntries(Object.entries(all).filter(([, a]) => !isFil(a)))
    const rec = reconcile({ alerts: Object.fromEntries(Object.entries(all).filter(([, a]) => isFil(a))) }, rows, readAcks(cfg), now, 0)
    // a conversation factory's rows already announced (same conversation, still open) is not announced again
    const known = new Set(Object.values(others).filter((a) => a.julian && FACTORY_JULIAN.includes(a.kind)).map((a) => a.cli))
    const fresh = rec.fresh.map((a) => rec.alerts[a.key]).filter((a) => !a.acked && !known.has(a.cli))
    for (const a of rec.fresh) events.push(logEvent(cfg, { kind: 'alert', key: a.key, severity: a.severity, what: a.what, title: a.title, link: a.link }))
    let sent = state.sent || {}
    let mailState = state.mail
    if (fresh.length && (may(cfg, 'notify') || may(cfg, 'notify_julian'))) {
      for (const a of fresh.slice(0, 3)) if (await toast(cfg, 'Veille · attend Julian', `${a.title ? a.title + ' : ' : ''}${a.what.replace(/^Attend Julian : /, '')}`)) events.push(logEvent(cfg, { kind: 'notified', key: a.key }))
      if (fresh.length > 3) await toast(cfg, 'Veille', `${fresh.length - 3} autres conversations t'attendent (/veille fil)`)
    }
    const toMail = may(cfg, 'mail') ? fresh.filter((a) => due(sent, 'mail', a.key, now, (cfg.mail || {}).repeat_h || 6)) : []
    if (toMail.length) {
      const problem = smtpProblem(smtp)
      if (problem) { mailState = 'not_configured'; events.push(logEvent(cfg, { kind: 'mail_skipped', reason: `e-mail non configuré (${problem})`, keys: toMail.map((a) => a.key) })) }
      else {
        try {
          const inco = toMail.some((a) => a.kind === 'fil_incoherence')
          const subject = inco ? fill((cfg.mail || {}).incoherence_subject || '[Veille] incohérence entre consignes', { n: toMail.length }) : fill(cfg.mail.subject, { n: toMail.length })
          await sendMail(smtp, compose({ from: smtp.from, to: smtp.to, subject, text: digest(toMail, now, age) }))
          sent = markSent(sent, 'mail', toMail.map((a) => a.key), now)
          mailState = 'sent'
          events.push(logEvent(cfg, { kind: 'mailed', keys: toMail.map((a) => a.key) }, secrets))
        } catch (e) { mailState = 'error'; events.push(logEvent(cfg, { kind: 'mail_failed', error: scrub(e.message, secrets) }, secrets)) }
      }
    }
    if (rec.fresh.length || rec.gone.length || events.length) {
      writeAtomic(p.state, { ...state, alerts: { ...others, ...rec.alerts }, sent, mail: mailState, recent: [...events, ...(state.recent || [])].slice(0, (cfg.pane || {}).events || 25) })
    }
    console.log(`veille: fil: ${rows.length} conversation(s) attendent Julian, ${fresh.length} nouvelle(s)`)
    return 0
  } catch (e) {
    const msg = scrub(String(e && e.message || e), secrets).slice(0, 300)
    ERRORS.push(`fil_failed: ${msg.slice(0, 160)}`)
    console.error(`veille: fil failed: ${msg}`)
    return 1
  } finally {
    dropLock(cfg)
  }
}

// The a-faire mod's feed (mods/a-faire/lib/feed.mjs beside veille, or in the bin copy). Missing or failing: nothing.
async function aFaireFeed(tp, env, now) {
  const file = path.join(MODS, 'a-faire', 'lib', 'feed.mjs')
  if (!fs.existsSync(file)) return []
  try {
    const { veilleFeed } = await import(pathToFileURL(file).href)
    return (await veilleFeed({ gh: tp.gh, env, now })).map((a) => ({ ...a, severity: 'julian', julian: true }))
  } catch { return [] }
}

// The problemes mod's collector (zero tokens): new transcript bytes and session files into its ledger. Best effort:
// absent from the installed copy or failing, the tour is still a success (its own health record says why).
async function problemes(cfg, tp) {
  const P = cfg.problemes || {}
  const script = path.join(MODS, 'problemes', 'scanner', 'problemes_scan.mjs')
  if (P.enabled === false || !fs.existsSync(script)) return
  const r = await run([tp.node, script, 'collect'], { timeoutMs: (P.timeout_s || 180) * 1000 })
  if (r.code !== 0) logEvent(cfg, { kind: 'problemes_failed', error: (r.err || r.out || '').trim().split(/\r?\n/).pop() })
}

const hm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

function readAcks(cfg) {
  try {
    return fs.readFileSync(P(cfg).acks, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).key } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// ---- safe wake: a fresh `claude -p` with the target's own model, effort and permission mode -------------------------

// The target's session file (%APPDATA%/Claude/claude-code-sessions/<account>/<org>/local_*.json, wake.sessions_dir moves it).
export function findSession(cfg, target, dir = null) {
  const root = dir || expand((cfg.wake || {}).sessions_dir) || appDir()
  const want = [target && target.cli, target && target.sid].filter(Boolean)
  if (!want.length) return null
  const subdirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)) } catch { return [] } }
  for (const a of subdirs(root)) for (const b of subdirs(a)) {
    let names = []
    try { names = fs.readdirSync(b).filter((n) => /^local_.*\.json$/.test(n)) } catch { continue }
    for (const n of names) {
      if (want.includes(n.replace(/\.json$/, ''))) return readJson(path.join(b, n), null)
      const j = want.length && readJson(path.join(b, n), null)
      if (j && (want.includes(j.cliSessionId) || want.includes(j.sessionId))) return j
    }
  }
  return null
}

// Starts the wake detached, logs its stream-json output to wakes/<time>-wake.log and lists it in wakes.json (the Fil
// shows it; refreshWakes fills in the result and the check at the next fires).
function startWake(cfg, tp, s, text, info, now) {
  const p = P(cfg)
  const log = detached(cfg, wakeArgv(tp.claude, s, text, `Veille · ${info.title || s.title || 'réveil'}`), s.cwd, 'wake', wakeEnv(toolEnv(tp), s))
  const idx = readJson(p.wakesIndex, {}) || {}
  const list = [{ at: now, key: info.key, title: info.title || s.title, target_cli: s.cli, cwd: s.cwd, reason: String(info.reason || '').slice(0, 200),
    want: { model: s.model, effort: s.effort, permission: s.permission }, log: path.basename(log), status: 'en_cours' }, ...(idx.wakes || [])]
  writeAtomic(p.wakesIndex, { v: 1, generated: now, wakes: list.slice(0, (cfg.wake || {}).keep || 20) })
  return log
}

// ~/.claude/projects/<slug>/<session_id>.jsonl of a finished wake (CLAUDE_CONFIG_DIR moves ~/.claude).
export function findTranscript(sessionId, home = process.env.CLAUDE_CONFIG_DIR || path.join(USER_HOME, '.claude')) {
  if (!/^[\w-]{8,}$/.test(String(sessionId || ''))) return null
  const dir = path.join(home, 'projects')
  let subs = []
  try { subs = fs.readdirSync(dir) } catch { return null }
  for (const d of subs) { const f = path.join(dir, d, `${sessionId}.jsonl`); if (fs.existsSync(f)) return f }
  return null
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }

// Every fire: each running wake of wakes.json gets its result (the session's last text) and the check of the model,
// effort and permission mode it really ran with. A gap or an error is a wake_failed event (health -> Problèmes).
export function refreshWakes(cfg, now) {
  const p = P(cfg)
  const idx = readJson(p.wakesIndex, null)
  if (!idx || !Array.isArray(idx.wakes)) return null
  let changed = false
  for (const w of idx.wakes) {
    if (w.status !== 'en_cours') continue
    const log = parseWakeLog(readText(path.join(p.wakes, w.log)))
    if (!log.done) {
      if (now - w.at > ((cfg.wake || {}).timeout_min || 60) * 60000) { w.status = 'sans_resultat'; changed = true; logEvent(cfg, { kind: 'wake_failed', key: w.key, error: `pas de résultat après ${(cfg.wake || {}).timeout_min || 60} min (${w.log})` }) }
      continue
    }
    const tf = findTranscript(log.session_id)
    const v = verifyWake(w.want, log, tf ? transcriptSettings(readText(tf)) : null)
    Object.assign(w, { session_id: log.session_id, result: scrub(log.result).slice(0, (cfg.wake || {}).result_chars || 1200), cost: log.cost,
      status: log.is_error ? 'erreur' : v.ok ? 'ok' : 'ecart', diffs: v.diffs, done_at: now })
    changed = true
    if (w.status !== 'ok') logEvent(cfg, { kind: 'wake_failed', key: w.key, error: log.is_error ? `erreur : ${w.result.slice(0, 120)}` : `écart : ${v.diffs.join(' ; ')}` })
  }
  if (changed) writeAtomic(p.wakesIndex, { ...idx, generated: now })
  return idx
}

// `veille wake-test`: a throwaway target (temporary session file and folder), the same wake as a tour, run to the end,
// then the check. Exit 0 only when the fresh session ran with the asked model, effort and permission mode.
async function wakeTest(cfg, args) {
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
  const tp = toolPaths(cfg)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veille-wake-'))
  const work = path.join(tmp, 'work')
  const sessDir = path.join(tmp, 'sessions', 'acct', 'org')
  fs.mkdirSync(work, { recursive: true })
  fs.mkdirSync(sessDir, { recursive: true })
  const fake = { sessionId: 'local_veille-wake-test', cliSessionId: 'veille-wake-test', cwd: work, title: 'veille wake test',
    model: opt('--model', 'claude-haiku-5-5'), effort: opt('--effort', 'low'), permissionMode: opt('--permission-mode', 'plan') }
  fs.writeFileSync(path.join(sessDir, 'local_veille-wake-test.json'), JSON.stringify(fake))
  try {
    const s = wakeSettings(findSession(cfg, { cli: 'veille-wake-test' }, path.join(tmp, 'sessions')))
    if (!s.ok) { console.error(`veille: wake-test: ${s.why}`); return 1 }
    const argv = wakeArgv(tp.claude, s, 'Test de réveil de la Veille : réponds exactement « ok » et rien d’autre.', 'Veille · wake test')
    if (argv.includes('--resume')) { console.error('veille: wake-test: --resume in argv'); return 1 }
    const r = await run(argv, { cwd: s.cwd, env: wakeEnv(toolEnv(tp), s), timeoutMs: 240000 })
    const log = parseWakeLog(r.out)
    const tf = findTranscript(log.session_id)
    const v = verifyWake({ model: s.model, effort: s.effort, permission: s.permission }, log, tf ? transcriptSettings(readText(tf)) : null)
    const out = { ok: r.code === 0 && log.done && !log.is_error && v.ok, exit: r.code, want: { model: s.model, effort: s.effort, permission: s.permission },
      seen: { init_model: log.model, init_permission: log.permission, transcript: tf ? transcriptSettings(readText(tf)) : null }, diffs: v.diffs, result: log.result.slice(0, 200),
      resume: false, cost_usd: log.cost }
    logEvent(cfg, { kind: out.ok ? 'wake_test' : 'wake_failed', reason: out.ok ? 'session neuve conforme (modèle, effort, permission)' : undefined, error: out.ok ? undefined : `wake-test : ${v.diffs.join(' ; ') || (r.err || '').trim().slice(-160)}` })
    console.log(JSON.stringify(out, null, 1))
    return out.ok ? 0 : 1
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* temp folder, the OS cleans it */ }
  }
}

// ---- deadlines and vendored mods ---------------------------------------------------------------------------------------

function deadlinesOf(cfg, now) {
  const D = cfg.deadlines || {}
  if (D.enabled === false || !D.file) return []
  try { return deadlineAlerts(readText(expand(D.file)), now, { days: D.days, title: D.title }) } catch { return [] }
}

// Weekly: each vendor_check.items entry, vendored version (its plugin.json in the repo checkout) vs the upstream latest
// release (gh api, read only). Stored in state.vendor; vendorAlerts turns a gap into an info alert at every tour.
export async function vendorCheck(cfg, tp, env, now, events) {
  const V = cfg.vendor_check || {}
  const roots = [path.resolve(MODS, '..'), (readJson(P(cfg).paths, {}) || {}).repo].filter(Boolean)
  const items = []
  for (const it of V.items || []) {
    const file = roots.map((r) => path.join(r, it.plugin_json || '')).find((f) => it.plugin_json && fs.existsSync(f))
    const vendored = file ? String((readJson(file, {}) || {}).version || '') : ''
    const r = await run([tp.gh, 'api', `repos/${it.repo}/releases/latest`, '--jq', '.tag_name'], { env, timeoutMs: 30000 })
    const latest = r.code === 0 ? r.out.trim() : ''
    const error = !vendored ? 'version vendored introuvable (plugin.json)' : r.code !== 0 ? `gh : ${(r.err || '').trim().split(/\r?\n/).pop().slice(0, 120)}` : ''
    items.push({ name: it.name, repo: it.repo, vendored, latest, error })
    events.push(logEvent(cfg, { kind: 'vendor_check', reason: error ? `${it.name} : ${error}` : `${it.name} : vendored ${vendored}, amont ${latest}${normVersion(latest) === normVersion(vendored) ? ' (à jour)' : ''}` }))
  }
  return { checked_at: now, items }
}

// ---- night: /veille nuit and /veille jour ------------------------------------------------------------------------------

function readEvents(p) {
  const out = []
  for (const f of [p.events + '.1', p.events]) for (const l of readText(f).split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)) } catch { /* torn line */ } }
  return out
}

function nightStart(cfg) {
  const N = cfg.night || {}
  const now = Date.now()
  if (cfg.night_started) { console.log(`veille: nuit déjà commencée à ${hm(cfg.night_started)} (mode ${modeOf(cfg).name})`); return 0 }
  const m = modeName(cfg, N.mode || 'nuit-active') || 'nuit-active'
  writeUserConfig(cfg, { mode: m, night_started: now, night_prev_mode: modeOf(cfg).name })
  logEvent(cfg, { kind: 'night_start', mode: m, reason: `nuit commencée, mode ${m}` })
  console.log(`veille: nuit commencée à ${hm(now)} : mode ${m}`)
  return 0
}

function nightEnd(cfg) {
  const N = cfg.night || {}
  const p = P(cfg)
  const now = Date.now()
  const since = cfg.night_started || now - (N.fallback_h || 12) * 3600000
  const sum = nightSummary(readEvents(p), since, now, N.labels || {})
  writeAtomic(p.night, { v: 1, generated: now, started: !!cfg.night_started, ...sum })
  const m = modeName(cfg, N.day_mode || 'légère') || 'légère'
  writeUserConfig(cfg, { mode: m, night_started: null, night_prev_mode: null })
  logEvent(cfg, { kind: 'night_end', mode: m, reason: `jour, mode ${m} : ${sum.merged.length} mergées, ${sum.failed.length} échecs, ${sum.waits.length} attentes` })
  for (const l of sum.lines) console.log(l)
  console.log(`veille: jour : mode ${m}`)
  return 0
}

// ---- the scheduled entry ---------------------------------------------------------------------------------------------

// archive.json at every fire, whatever the mode: read-only, files only, never archives (the VEILLE conversation does).
function archivePass(cfg) {
  try { return writeArchive(cfg, P(cfg).archive) } catch (e) { logEvent(cfg, { kind: 'archive_failed', error: String(e && e.message || e).slice(0, 200) }); return null }
}

const archiveCount = (cfg) => ((readJson(P(cfg).archive, {}) || {}).candidates || []).length

async function fire(cfg) {
  const p = P(cfg)
  const now = Date.now()
  archivePass(cfg)
  try { refreshWakes(cfg, now) } catch (e) { logEvent(cfg, { kind: 'wake_failed', error: String(e && e.message || e).slice(0, 200) }) }
  const hb = readJson(p.heartbeat, {}) || {}
  const gap = gapOf(hb.last_fire, now, cfg.fire_every_min || 5)
  const gaps = [...(hb.gaps || []).filter((g) => now - g.to < 24 * 3600000), ...(gap ? [gap] : [])]
  writeAtomic(p.heartbeat, { ...hb, last_fire: now, fires: (hb.fires || 0) + 1, gaps, pid: process.pid })
  if (gap) logEvent(cfg, { kind: 'missed', from: gap.from, to: gap.to, reason: 'la tâche n’a pas tourné pendant plus de deux intervalles' })
  const mode = modeOf(cfg)
  if (tourDue(mode, hb.last_tour, now) || (gap && mode.interval_min)) return tour(cfg, gap ? 'gap' : 'due')
  if (mode.interval_min) return julianPass(cfg)
  return 0
}

// ---- install / uninstall / status ------------------------------------------------------------------------------------

function where(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8', windowsHide: true })
  const hits = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  return hits.find((h) => !/WindowsApps/i.test(h)) || hits[0] || ''
}

function copyTree(files, dest) {
  for (const rel of files) {
    const from = path.join(MODS, rel)
    if (OPTIONAL_BIN.includes(rel) && !fs.existsSync(from)) continue
    const to = path.join(dest, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
}

export const BIN_FILES = [
  'veille/watcher/veille.mjs', 'veille/watcher/fil.mjs', 'veille/lib/fil.mjs', 'veille/watcher/archive.mjs', 'veille/lib/archive.mjs', 'veille/watcher/toast.ps1', 'veille/lib/core.mjs', 'veille/lib/night.mjs', 'veille/lib/modes.mjs', 'veille/lib/mail.mjs', 'veille/veille.config.json',
  'veille/.claude-plugin/plugin.json', 'veille/COORDINATEUR.md', 'veille/lib/core/waiting.mjs', 'veille/lib/core/veille.mjs', 'veille/lib/core/health.mjs', 'veille/lib/export-view.mjs',
  'factory/scanner/factory_scan.py', 'factory/factory.config.json',
  'problemes/scanner/problemes_scan.mjs', 'problemes/scanner/health.mjs', 'problemes/lib/core.mjs', 'problemes/problemes.config.json',
  'veille/watcher/export-batch.mjs',
  'export-eta/exporter/export.mjs', 'export-eta/exporter/sessions.mjs', 'export-eta/lib/mask.mjs', 'export-eta/lib/layout.mjs', 'export-eta/lib/core/health.mjs',
  'export-eta/lib/render.mjs', 'export-eta/lib/etagit.mjs', 'export-eta/export-eta.config.json',
  'problemes/lib/export.mjs', 'problemes/lib/eta/mask.mjs', 'problemes/lib/eta/etagit.mjs',
]
// The a-faire mod's feed, copied when that mod sits beside veille (pushes « À faire par Julian » items once each).
export const OPTIONAL_BIN = ['a-faire/lib/feed.mjs', 'a-faire/lib/collect.mjs', 'a-faire/lib/items.mjs', 'a-faire/lib/mods-check.mjs', 'a-faire/lib/core/mods.mjs', 'a-faire/afaire.config.json']
BIN_FILES.push(...OPTIONAL_BIN)

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function taskXml({ user, command, args, everyMin, start }) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Claude Veille (claude-mod): tours conversations, PR/MR and CI every ${everyMin} min; zero model tokens.</Description></RegistrationInfo>
  <Triggers>
    <TimeTrigger><Repetition><Interval>PT${everyMin}M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>${start}</StartBoundary><Enabled>true</Enabled></TimeTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>${xmlEsc(user)}</UserId></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>${xmlEsc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xmlEsc(command)}</Command><Arguments>${xmlEsc(args)}</Arguments></Exec></Actions>
</Task>
`
}

function writeUserConfig(cfg, patch) {
  const p = P(cfg)
  writeAtomic(p.config, { ...(readJson(p.config, {}) || {}), ...patch })
}

function install(cfg, launcher) {
  if (process.platform !== 'win32') { console.error('veille install: Windows Task Scheduler only'); return 1 }
  const p = P(cfg)
  copyTree(BIN_FILES, p.bin)
  const tp = { node: process.execPath, python: where('python'), gh: where('gh'), glab: where('glab'), claude: where('claude'), powershell: where('powershell') || 'powershell.exe' }
  writeAtomic(p.paths, { ...tp, repo: path.resolve(MODS, '..') })
  const script = path.join(p.bin, 'veille', 'watcher', 'veille.mjs')
  let command, args
  if ((launcher || cfg.launcher) === 'conhost') {
    command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'conhost.exe')
    args = `--headless "${tp.node}" "${script}" fire`
  } else {
    const vbs = path.join(p.home, 'run.vbs')
    fs.writeFileSync(vbs, `' veille launcher: starts node hidden, waits for it (the task's time limit then applies)\r\nSet sh = CreateObject("WScript.Shell")\r\nsh.Run """${tp.node}"" ""${script}"" fire", 0, True\r\n`)
    command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe')
    args = `//B //Nologo "${vbs}"`
  }
  const user = `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME || os.userInfo().username}`
  const d = new Date(Date.now() + 60000)
  const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`
  const xml = path.join(p.home, 'task.xml')
  fs.writeFileSync(xml, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(taskXml({ user, command, args, everyMin: cfg.fire_every_min || 5, start }), 'utf16le')]))
  const r = spawnSync('schtasks.exe', ['/Create', '/TN', cfg.task_name || 'ClaudeVeille', '/XML', xml, '/F'], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) { console.error(`veille install: schtasks failed: ${(r.stderr || r.stdout || '').trim()}`); return 1 }
  const user0 = readJson(p.config, {}) || {}
  writeUserConfig(cfg, { installed: true, installed_at: Date.now(), launcher: launcher || cfg.launcher, mode: user0.mode || cfg.mode || 'légère' })
  logEvent(cfg, { kind: 'installed', task: cfg.task_name, launcher: launcher || cfg.launcher })
  console.log(`veille: task ${cfg.task_name} installed (every ${cfg.fire_every_min} min, ${launcher || cfg.launcher}), files in ${p.bin}`)
  for (const [k, v] of Object.entries(tp)) if (!v) console.log(`veille: warning: ${k} not found on PATH`)
  return 0
}

function uninstall(cfg) {
  const r = spawnSync('schtasks.exe', ['/Delete', '/TN', cfg.task_name || 'ClaudeVeille', '/F'], { encoding: 'utf8', windowsHide: true })
  writeUserConfig(cfg, { installed: false })
  logEvent(cfg, { kind: 'uninstalled' })
  console.log(r.status === 0 ? `veille: task ${cfg.task_name} removed` : `veille: ${(r.stderr || r.stdout || '').trim()}`)
  return 0
}

function status(cfg) {
  const p = P(cfg)
  const hb = readJson(p.heartbeat, {}) || {}
  const st = readJson(p.state, {}) || {}
  const mode = modeOf(cfg)
  const ws = watcherState(hb, cfg, Date.now())
  const q = process.platform === 'win32' ? spawnSync('schtasks.exe', ['/Query', '/TN', cfg.task_name || 'ClaudeVeille', '/FO', 'LIST'], { encoding: 'utf8', windowsHide: true }) : { status: 1 }
  const taskLine = q.status === 0 ? (q.stdout.split(/\r?\n/).find((l) => /^(Status|État|Statut)\s*:/i.test(l)) || 'present').replace(/\s+/g, ' ') : 'absent'
  const tp = toolPaths(cfg)
  const missing = Object.entries(tp).filter(([, v]) => path.isAbsolute(v) && !fs.existsSync(v)).map(([k]) => k)
  const alerts = Object.values(st.alerts || {})
  const out = {
    mode: mode.name, may: mode.may, interval_min: mode.interval_min, task: taskLine, watcher: ws.state,
    last_fire: hb.last_fire ? new Date(hb.last_fire).toISOString() : null, last_tour: hb.last_tour ? new Date(hb.last_tour).toISOString() : null,
    last_error: hb.last_error || '', alerts: alerts.length, julian: attendJulian(st, readAcks(cfg)),
    mail: smtpProblem(readJson(p.smtp, null)) ? 'e-mail non configuré' : 'e-mail configuré', wake: cfg.wake.enabled ? 'on' : 'off',
    coordinator: cfg.coordinator_session || null, missing_paths: missing,
  }
  console.log(JSON.stringify(out, null, 1))
  return 0
}

async function testMail(cfg) {
  const smtp = readJson(P(cfg).smtp, null)
  const problem = smtpProblem(smtp)
  if (problem) { console.error(`veille: e-mail non configuré (${problem})`); return 1 }
  try {
    await sendMail(smtp, compose({ from: smtp.from, to: smtp.to, subject: '[Veille] test', text: 'Test de la veille : l’e-mail fonctionne.' }))
    console.log('veille: test e-mail sent')
    return 0
  } catch (e) { console.error(`veille: ${scrub(e.message, [smtp.password])}`); return 1 }
}

// ---- main --------------------------------------------------------------------------------------------------------------

export async function main(argv) {
  const cfg = loadConfig()
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'fire': return fire(cfg)
    case 'tour': archivePass(cfg); return tour(cfg, 'manual')
    case 'status': return status(cfg)
    case 'mode': {
      const m = modeName(cfg, rest.join(' '))
      if (!m) { console.error(`veille: unknown mode « ${rest.join(' ')} » (${MODES.join(', ')})`); return 1 }
      writeUserConfig(cfg, { mode: m })
      logEvent(cfg, { kind: 'mode', mode: m })
      console.log(`veille: mode ${m}: ${(cfg.modes[m] || {}).help || ''}`)
      return 0
    }
    case 'ack': {
      const key = rest.join(' ').trim()
      if (!key) { console.error('veille: ack <key|all>'); return 1 }
      const p = P(cfg)
      const keep = readAcksRaw(p).filter((x) => Date.now() - (x.at || 0) < 14 * 86400000)
      keep.push({ key: key === 'all' ? '*' : key, at: Date.now() })
      writeAtomic(p.acks, keep.map((x) => JSON.stringify(x)).join('\n') + '\n')
      logEvent(cfg, { kind: 'ack', key })
      console.log(`veille: ack ${key}`)
      return 0
    }
    case 'coordinator': {
      if (!rest[0]) { console.error('veille: coordinator <session-id> [cwd]'); return 1 }
      writeUserConfig(cfg, { coordinator_session: rest[0], coordinator_cwd: rest.slice(1).join(' ') || null })
      logEvent(cfg, { kind: 'coordinator', session: rest[0] })
      console.log(`veille: coordinator ${rest[0]}`)
      return 0
    }
    case 'install': return install(cfg, rest.includes('--launcher') ? rest[rest.indexOf('--launcher') + 1] : null)
    case 'uninstall': return uninstall(cfg)
    case 'test-mail': return testMail(cfg)
    case 'fil': {
      const f = writeFil(cfg, P(cfg).fil)
      console.log(`veille: fil: ${f.total} conversation(s), ${f.projects.length} projet(s), ${f.julian} attend(ent) Julian, ${f.duration_ms} ms`)
      return 0
    }
    case 'julian': return julianPass(cfg)
    case 'nuit': case 'night': return nightStart(cfg)
    case 'jour': case 'day': return nightEnd(cfg)
    case 'wake-test': return wakeTest(cfg, rest)
    case 'wakes': { const w = refreshWakes(cfg, Date.now()); console.log(JSON.stringify((w && w.wakes) || [], null, 1)); return 0 }
    case 'archiver': case 'archive': {
      const a = writeArchive(cfg, P(cfg).archive)
      for (const l of archiveText(a, Date.now())) console.log(l)
      return 0
    }
    default:
      console.log('usage: node veille.mjs fire|tour|status|fil|archiver|julian|nuit|jour|wakes|wake-test [--model m --effort e --permission-mode p]|mode <x>|ack <key|all>|coordinator <id> [cwd]|install [--launcher wscript|conhost]|uninstall|test-mail')
      return cmd ? 1 : 0
  }
}

function readAcksRaw(p) {
  try { return fs.readFileSync(p.acks, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg0 = (() => { try { return loadConfig() } catch { return { tour_deadline_s: 480 } } })()
  // Own deadline (the task's 10-minute limit stops the launcher, not node): kill our children and leave.
  const deadline = setTimeout(() => {
    for (const c of children) { try { c.kill() } catch { /* gone */ } }
    try { logEvent(cfg0, { kind: 'tour_failed', error: 'délai du tour dépassé' }); dropLock(cfg0) } catch { /* nothing more to do */ }
    writeHealth('veille', healthError(ERRORS) || 'tour_failed: délai du tour dépassé')
    process.exit(2)
  }, (cfg0.tour_deadline_s || 480) * 1000)
  deadline.unref()
  // health only for the runs that look at the world (not mode/ack/status...): the scheduled fire, tours, fil, archive
  const watched = ['fire', 'tour', 'julian', 'fil', 'archiver', 'archive', 'test-mail', 'wake-test', 'wakes'].includes(process.argv[2])
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
    if (watched) writeHealth('veille', healthError(ERRORS) || (code ? `${process.argv[2]}_failed: exit ${code}` : null))
  }, (e) => {
    const msg = scrub(String(e && e.message || e)).slice(0, 300)
    console.error(`veille: ${scrub(String(e && e.stack || e))}`)
    process.exitCode = 1
    writeHealth('veille', healthError([...ERRORS, `crash: ${msg}`]))
  })
}
