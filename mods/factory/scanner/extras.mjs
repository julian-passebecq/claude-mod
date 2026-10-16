// factory - extras run with Node by the factory pane (only while their tab shows), read-only:
//   node extras.mjs quotas  < {"live": rateLimits[], "now": epochMs, "home": "C:/Users/me"}
//   node extras.mjs runner  < {"now": epochMs, "home": "C:/Users/me"}
// ONE source each, shared with band and cockpit: lib/core/usage.mjs (5 h / week % and run-out date, Claude and Codex,
// from the files the usage mod writes in ~/.claude/usage-mod) and lib/core/runner.mjs (runner load from the ci mod's
// pipelines cache). The hooks module runs without Node, so it asks this script; no API call, no model call.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readQuotas } from '../lib/core/usage.mjs'
import { readRunner } from '../lib/core/runner.mjs'

const DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
const at = (ms) => {
  const d = new Date(ms)
  return `${DAYS[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** One window of lib/core/usage.mjs as the Quotas screen reads it: {pct, reset, forecast}. */
export function windowOf(w) {
  if (!w) return null
  const forecast = w.runOutAt ? `épuisé ${at(w.runOutAt)} au rythme actuel` : w.resetsFirst ? 'tient jusqu’au reset au rythme actuel' : ''
  return { pct: w.pct, reset: w.reset || null, forecast }
}

/** Quotas of Claude and Codex from the usage mod's data folder (home/.claude/usage-mod, or `dir`). */
export function quotas(req = {}, dir) {
  const now = Number(req.now) || Date.now()
  const home = String(req.home || '').replace(/\\/g, '/')
  const q = readQuotas(dir || (home ? `${home}/.claude/usage-mod` : undefined), now)
  const out = { available: true, source: 'lib/core/usage.mjs', five_hour: windowOf(q.claude.five), seven_day: windowOf(q.claude.week) }
  if (!out.five_hour && !out.seven_day) out.note = 'samples.jsonl absent : ouvre /conso une fois pour l’écrire'
  const cw = [['5 h', q.codex.five], ['Semaine', q.codex.week]].filter(([, w]) => w).map(([label, w]) => ({ label, pct: w.pct, reset: w.reset }))
  out.codex = cw.length ? { available: true, windows: cw, missing: [] } : { available: false, reason: q.codexAvailable ? 'pas de % écrit par Codex' : 'codex.json absent' }
  return out
}

/** Runner load from the ci mod's cache (lib/core/runner.mjs) in the shape of the Système screen (backends). */
export function runner(req = {}, file) {
  const now = Number(req.now) || Date.now()
  const home = String(req.home || '').replace(/\\/g, '/')
  const r = readRunner(file || (home ? `${home}/.claude/ci-pipelines-cache.json` : undefined), now)
  if (!r) return { generated: null, backends: [], error: 'runner : pas de cache du mod ci (~/.claude/ci-pipelines-cache.json)' }
  return {
    generated: r.generated, age_ms: r.age_ms, source: 'lib/core/runner.mjs',
    backends: [{ label: r.label || 'runner', usable: r.online === null ? 'yes' : r.online > 0, jobs: { running: r.running, pending: r.pending }, runners: { online: r.online, total: null }, concurrent: r.concurrent }],
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let text = ''
  try { text = readFileSync(0, 'utf8') } catch { /* no stdin */ }
  let req = {}
  try { req = text.trim() ? JSON.parse(text) : {} } catch { req = {} }
  const cmd = process.argv[2] || 'quotas'
  const res = cmd === 'quotas' ? quotas(req) : cmd === 'runner' ? runner(req) : { error: `unknown command ${cmd}` }
  process.stdout.write(JSON.stringify(res))
}
