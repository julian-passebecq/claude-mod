// factory v2 - extras from the neighbour mods, read-only, run with Node by the factory pane (only while the tab shows):
//   node extras.mjs quotas  < {"live": rateLimits[], "now": epochMs, "home": "C:/Users/me"}
// It imports the usage mod's own logic (../../usage/hooks/logic.mjs, ../../usage/lib/codex.mjs) and reads the files
// that mod already writes (aggregate.json, samples.jsonl, codex.json): no copy of its forecast. When the usage mod is
// not next to factory, it prints {"available": false, "reason": "module non chargé"} and factory shows that box.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return undefined }
}

function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a || {}) }
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' ? merge(a[k], v) : v
  return out
}

export async function quotas(req, usageRoot = join(here, '..', '..', 'usage')) {
  const logicPath = join(usageRoot, 'hooks', 'logic.mjs')
  if (!existsSync(logicPath)) return { available: false, reason: 'module non chargé' }
  let U, CX
  try {
    U = await import(pathToFileURL(logicPath).href)
    CX = await import(pathToFileURL(join(usageRoot, 'lib', 'codex.mjs')).href).catch(() => null)
  } catch (err) {
    return { available: false, reason: `usage : ${String(err && err.message || err).slice(0, 80)}` }
  }
  const now = Number(req.now) || Date.now()
  const home = String(req.home || '').replace(/\\/g, '/')
  const base = readJson(join(usageRoot, 'usage.config.json')) || {}
  const dataDir = U.expandHome(base.data_dir || '~/.claude/usage-mod', home)
  const cfg = merge(base, readJson(join(dataDir, 'usage.config.json')) || {})
  const aggr = readJson(join(dataDir, 'aggregate.json'))
  let samples = []
  try { samples = readFileSync(join(dataDir, 'samples.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { /* none yet */ }
  const l = cfg.labels || {}
  const out = { available: true, plan: cfg.plan_label || cfg.plan || '' }
  if (aggr) {
    const m = U.model(aggr, cfg, { now, live: req.live || [], samples, scenarios: [] })
    const one = (w) => w && w.reading ? { pct: w.reading.pct, reset: w.reading.reset || null, live: Boolean(w.reading.live),
      forecast: w.current ? `${U.outcome(w.current, m.tz, l)} ${l.pace_now || ''}`.trim() : '' } : null
    out.seven_day = one(m.week)
    out.five_hour = one(m.five)
    out.today_cost = m.today && m.today.total ? m.today.total[7] : null
  } else {
    out.note = 'aggregate.json absent : ouvre /conso une fois pour le créer'
  }
  if (CX && cfg.codex && cfg.codex.enabled !== 'off') {
    const cx = CX.codexView(readJson(join(dataDir, 'codex.json')), cfg, { now, tzMin: (aggr && aggr.tzMin) || 0 })
    out.codex = cx.available ? { available: true, windows: (cx.windows || []).map((w) => ({ label: w.label, pct: w.pct, reset: w.reset, stale: w.stale })),
      today: cx.today ? cx.today.total[CX.CV.total] : 0, missing: cx.missing || [] } : { available: false, reason: cx.reason || 'non disponible' }
  }
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let text = ''
  try { text = readFileSync(0, 'utf8') } catch { /* no stdin */ }
  let req = {}
  try { req = text.trim() ? JSON.parse(text) : {} } catch { req = {} }
  const cmd = process.argv[2] || 'quotas'
  const res = cmd === 'quotas' ? await quotas(req) : { error: `unknown command ${cmd}` }
  process.stdout.write(JSON.stringify(res))
}
