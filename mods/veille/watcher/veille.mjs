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
// State in ~/.claude/veille/. Only `fire`/`tour` write state.json and heartbeat.json; `mode`, `coordinator`,
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
import { age } from '../../factory/hooks/waiting.mjs'
import { julianAlerts } from '../lib/fil.mjs'
import { writeFil } from './fil.mjs'
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
    smtp: path.join(h, 'smtp.json'), fil: path.join(h, 'fil.json'), paths: path.join(h, 'paths.json'), bin: path.join(h, 'bin'), wakes: path.join(h, 'wakes'),
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

function logEvent(cfg, ev, secrets = []) {
  const p = P(cfg)
  const line = scrub(JSON.stringify({ at: Date.now(), ...ev }), secrets)
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
  return r.code === 0
}

function detached(cfg, argv, cwd, tag) {
  const p = P(cfg)
  fs.mkdirSync(p.wakes, { recursive: true })
  const logFile = path.join(p.wakes, `${new Date().toISOString().replace(/[:.]/g, '-')}-${tag}.log`)
  const fd = fs.openSync(logFile, 'a')
  const child = spawn(argv[0], argv.slice(1), { cwd, detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env: toolEnv(toolPaths(cfg)) })
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
        const log = detached(cfg, [tp.claude, '-p', '--model', (cfg.push || {}).model || 'haiku', `Appelle l'outil PushNotification avec exactement ce texte, puis arrête-toi : Veille — ${text}`], USER_HOME, 'push')
        spent = [...spent, { at: now, tokens: est }]
        sent = markSent(sent, 'push', todo.push.map((a) => a.key), now)
        events.push(logEvent(cfg, { kind: 'push', keys: todo.push.map((a) => a.key), log: path.basename(log), reason: 'attend Julian (non vérifié : le push n’atteint le téléphone que si Remote Control est connecté)' }))
      } else events.push(logEvent(cfg, { kind: 'push_skipped', reason: 'budget de tokens atteint' }))
    }
    const wakes = { ...(state.wakes || {}) }
    for (const a of list) {
      const d = wakeDecision(a, scan, cfg, { ...state, spent, wakes }, now)
      if (!d.ok) { if (may(cfg, 'wake', mode) && (cfg.wake.kinds || []).includes(a.kind) && !a.acked && rec.fresh.some((f) => f.key === a.key)) events.push(logEvent(cfg, { kind: 'wake_skipped', key: a.key, reason: d.why })); continue }
      const text = brief(a, cfg, now, `node "${path.join(p.bin, 'veille', 'watcher', 'veille.mjs')}" ack`)
      const log = detached(cfg, [tp.claude, '-p', '--resume', d.target.cli, text], d.target.cwd, 'wake')
      wakes[a.key] = [...(wakes[a.key] || []), now].slice(-10)
      spent = [...spent, { at: now, tokens: d.tokens }]
      events.push(logEvent(cfg, { kind: 'woken', key: a.key, target: d.target.title, cli: d.target.cli, tokens_est: d.tokens, log: path.basename(log), reason: a.what }))
    }
    for (const k of Object.keys(wakes)) if (!rec.alerts[k] && !wakes[k].some((t) => now - t < 24 * 3600000)) delete wakes[k]

    const recent = [...events.filter((e) => e.kind !== 'tour'), ...(state.recent || [])].slice(0, (cfg.pane || {}).events || 25)
    writeAtomic(p.state, {
      v: 1, mode: mode.name, last_tour: now, tours: (state.tours || 0) + 1, last_error: '', alerts: rec.alerts, resolved: rec.resolved,
      sent, spent, wakes, merge_seen: mergeSeen, gap_mailed: state.gap_mailed || [], mail: mailState === 'off' ? state.mail || (smtpProblem(smtp) ? 'not_configured' : 'configured') : mailState,
      reviews_errors: (scan.reviews && scan.reviews.errors) || [], sessions: (scan.sessions || []).length, reviews: ((scan.reviews || {}).items || []).length, recent,
    })
    writeAtomic(p.heartbeat, { ...readJson(p.heartbeat, {}), last_tour: now, last_tour_ok: true, last_error: '' })
    await problemes(cfg, tp)
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
    console.error(`veille: fil failed: ${scrub(String(e && e.message || e), secrets).slice(0, 300)}`)
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

// ---- the scheduled entry ---------------------------------------------------------------------------------------------

async function fire(cfg) {
  const p = P(cfg)
  const now = Date.now()
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
  'veille/watcher/veille.mjs', 'veille/watcher/fil.mjs', 'veille/lib/fil.mjs', 'veille/watcher/toast.ps1', 'veille/lib/core.mjs', 'veille/lib/modes.mjs', 'veille/lib/mail.mjs', 'veille/veille.config.json',
  'veille/.claude-plugin/plugin.json', 'veille/COORDINATEUR.md', 'factory/hooks/waiting.mjs', 'factory/hooks/logic.mjs',
  'factory/scanner/factory_scan.py', 'factory/factory.config.json',
  'problemes/scanner/problemes_scan.mjs', 'problemes/scanner/health.mjs', 'problemes/lib/core.mjs', 'problemes/problemes.config.json',
  'veille/watcher/export-batch.mjs',
  'export-eta/exporter/export.mjs', 'export-eta/exporter/sessions.mjs', 'export-eta/lib/mask.mjs', 'export-eta/lib/layout.mjs',
  'export-eta/lib/render.mjs', 'export-eta/export-eta.config.json',
]
// The a-faire mod's feed, copied when that mod sits beside veille (pushes « À faire par Julian » items once each).
export const OPTIONAL_BIN = ['a-faire/lib/feed.mjs', 'a-faire/lib/collect.mjs', 'a-faire/lib/items.mjs', 'a-faire/afaire.config.json']
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
  writeAtomic(p.paths, tp)
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
    last_error: hb.last_error || '', alerts: alerts.length, julian: alerts.filter((a) => a.julian && !a.acked).length,
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
    case 'tour': return tour(cfg, 'manual')
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
    default:
      console.log('usage: node veille.mjs fire|tour|status|fil|julian|mode <x>|ack <key|all>|coordinator <id> [cwd]|install [--launcher wscript|conhost]|uninstall|test-mail')
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
    process.exit(2)
  }, (cfg0.tour_deadline_s || 480) * 1000)
  deadline.unref()
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e) => { console.error(`veille: ${scrub(String(e && e.stack || e))}`); process.exitCode = 1 })
}
