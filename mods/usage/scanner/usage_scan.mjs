// usage mod scanner (Node, standard library only).
//   node usage_scan.mjs scan                    update the cache, write <data_dir>/aggregate.json, print one JSON line
//   node usage_scan.mjs sample '<json>'         append one rate-limit reading to <data_dir>/samples.jsonl
//   node usage_scan.mjs report [--json]         scan, then print today's / this week's totals and the forecast
//   node usage_scan.mjs codex                   only the Codex part: write <data_dir>/codex.json, print one JSON line
// Options: --data-dir DIR, --projects DIR, --codex DIR, --codex-enabled auto|on|off (defaults from usage.config.json, ~ expanded), --now MS (tests).
// Reads only ~/.claude/projects/**/*.jsonl, Codex's rollout-*.jsonl (codex.sessions_dir) and its own folder;
// never a credentials file.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { aggregate, tokensOf } from '../lib/transcripts.mjs'
import { loadCache, saveCache, scanProjects } from '../lib/scan-node.mjs'
import { scanCodex } from '../lib/codex-scan.mjs'
import { CV, codexEnabled, codexView } from '../lib/codex.mjs'
import { deepMerge, expandHome, fmtPct, fmtTokens, fmtUsd, model, outcome } from '../hooks/logic.mjs'

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

export function config(dataDirArg) {
  const home = homedir().replace(/\\/g, '/')
  const base = readJson(join(root, 'usage.config.json')) || {}
  const dataDir = expandHome(dataDirArg || base.data_dir || '~/.claude/usage-mod', home)
  const cfg = deepMerge(base, readJson(join(dataDir, 'usage.config.json')) || {})
  const prices = deepMerge(readJson(join(root, 'lib', 'prices.json')) || {}, { models: cfg.prices || {} })
  return { cfg, prices, dataDir, projects: expandHome(arg('--projects') || cfg.projects_dir, home), home }
}

export function readSamples(dataDir) {
  const p = join(dataDir, 'samples.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => {
    try {
      return JSON.parse(l)
    } catch {
      return null
    }
  }).filter(Boolean)
}

function scan({ cfg, prices, dataDir, projects, home }, now) {
  const cachePath = join(dataDir, 'cache.json')
  let cache = loadCache(cachePath)
  const priceKey = JSON.stringify(prices.models)
  if (cache.prices !== priceKey) cache = { version: 1, files: {}, prices: priceKey }
  const t0 = Date.now()
  const r = scanProjects({ root: projects, cache, prices, now, retentionDays: cfg.retention_days ?? 14, idleGapS: cfg.idle_gap_s ?? 300 })
  saveCache(cachePath, cache)
  const tzMin = -new Date(now).getTimezoneOffset()
  const aggr = aggregate(cache.files, { now, tzMin, days: cfg.view_days ?? 8, surfaces: cfg.surfaces || {}, subRule: cfg.subconversation_origin })
  writeFileSync(join(dataDir, 'aggregate.json'), JSON.stringify(aggr))
  let codex
  try {
    codex = codexScan({ cfg, dataDir, home }, now)
  } catch (err) {
    codex = { ok: false, error: String((err && err.message) || err).slice(0, 200) }
  }
  return { aggr, info: { ok: true, files: Object.keys(cache.files).length, read: r.read, skipped: r.skipped, bytes: r.bytes, ms: Date.now() - t0, codex } }
}

/** Codex part: reads the rollout files when codex.enabled allows it and writes <data_dir>/codex.json. */
export function codexScan({ cfg, dataDir, home }, now) {
  const c = cfg.codex || {}
  const dir = expandHome(arg('--codex') || c.sessions_dir || '~/.codex/sessions', home)
  const out = join(dataDir, 'codex.json')
  const enabled = arg('--codex-enabled') || (c.enabled ?? 'auto')
  if (!codexEnabled(enabled, existsSync(dir))) {
    const off = enabled === 'off' || enabled === false
    writeFileSync(out, JSON.stringify({ generated: now, available: false, dir, error: off ? 'off' : 'no_dir', days: {} }))
    return { ok: true, available: false }
  }
  const cachePath = join(dataDir, 'codex-cache.json')
  const cache = loadCache(cachePath)
  const t0 = Date.now()
  const r = scanCodex({ dir, cache, now, days: c.days ?? cfg.view_days ?? 8 })
  saveCache(cachePath, cache)
  writeFileSync(out, JSON.stringify(r.aggr))
  return { ok: true, available: r.aggr.available, files: Object.keys(cache.files).length, read: r.read, bytes: r.bytes, ms: Date.now() - t0 }
}

/** Appends a reading unless it repeats the last one (same % in both windows) within the minimum interval. */
export function addSample(dataDir, sample, minIntervalS = 300) {
  mkdirSync(dataDir, { recursive: true })
  const last = readSamples(dataDir).pop()
  const same = k => (last && last[k] && sample[k] ? last[k].pct === sample[k].pct && last[k].reset === sample[k].reset : !last?.[k] && !sample[k])
  if (last && same('seven_day') && same('five_hour') && sample.ts - last.ts < minIntervalS * 1000) return false
  appendFileSync(join(dataDir, 'samples.jsonl'), JSON.stringify(sample) + '\n')
  return true
}

function report(ctx, now) {
  const { aggr, info } = scan(ctx, now)
  const sc = readJson(join(root, ctx.cfg.scenarios_file || '../scenarios/scenarios.json'))
  const m = model(aggr, ctx.cfg, { now, samples: readSamples(ctx.dataDir), scenarios: (sc && sc.scenarios) || [] })
  if (process.argv.includes('--json')) return console.log(JSON.stringify(m))
  const l = ctx.cfg.labels
  const line = (name, v) => `${name}: ${fmtTokens(tokensOf(v.total))} tokens · ${fmtUsd(v.total[7])} (${l.estimate})`
  const top = (xs, n = 3) => xs.slice(0, n).map(x => `${x.key} ${fmtTokens(tokensOf(x.v))} / ${fmtUsd(x.v[7])}`).join(' | ')
  console.log(`scan: ${info.files} files kept, ${info.read} read (${(info.bytes / 1e6).toFixed(0)} MB) in ${info.ms} ms`)
  console.log(line("aujourd'hui", m.today))
  console.log(line('7 derniers jours', m.weekView))
  console.log(`  projets: ${top(m.weekView.project)}`)
  console.log(`  modèles: ${top(m.weekView.model)}`)
  console.log(`  types: ${top(m.weekView.kind, 4)}`)
  console.log(`  rythme (${m.basis}/h): 2 h ${m.rates.recent.toFixed(2)} · jour ${m.rates.today.toFixed(2)} · 7 j ${m.rates.week.toFixed(2)}`)
  const cx = codexView(readJson(join(ctx.dataDir, 'codex.json')), ctx.cfg, { now, tzMin: -new Date(now).getTimezoneOffset() })
  if (!cx.available || !cx.hasData) console.log(`codex: ${(ctx.cfg.codex?.labels || {}).unavailable || 'non disponible'}`)
  else {
    console.log(`codex: aujourd'hui ${fmtTokens(cx.today.total[CV.total])} tokens · 7 jours ${fmtTokens(cx.week.total[CV.total])} tokens · ${cx.week.model.slice(0, 3).map(x => `${x.key} ${fmtTokens(x.v[CV.total])}`).join(' | ')}`)
    for (const w of cx.windows) console.log(`  codex ${w.label}: ${fmtPct(w.pct)}${w.reset ? ` (reset ${new Date(w.reset).toISOString()})` : ''}${w.stale ? ' (ancienne lecture)' : ''}`)
  }
  if (!m.week) console.log(`prévision: ${l.no_reading}`)
  else {
    console.log(`semaine: ${fmtPct(m.week.reading.pct)} (reset ${new Date(m.week.reading.reset).toISOString()}), ${fmtTokens(m.cal.seven_day.tokensPerPct || 0)} tokens par 1 %`)
    console.log(`  au rythme actuel: ${outcome(m.week.current, m.tz, l)}`)
    for (const p of m.week.projections) console.log(`  ${p.label}: ${outcome(p.result, m.tz, l)}`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ctx = config(arg('--data-dir'))
  const now = Number(arg('--now')) || Date.now()
  const cmd = process.argv[2] || 'scan'
  try {
    mkdirSync(ctx.dataDir, { recursive: true })
    if (cmd === 'scan') console.log(JSON.stringify(scan(ctx, now).info))
    else if (cmd === 'sample') {
      const s = JSON.parse(process.argv[3] || '{}')
      const added = addSample(ctx.dataDir, { ts: now, ...s }, (ctx.cfg.calibration || {}).sample_min_interval_s ?? 300)
      console.log(JSON.stringify({ ok: true, added }))
    } else if (cmd === 'report') report(ctx, now)
    else if (cmd === 'codex') console.log(JSON.stringify(codexScan(ctx, now)))
    else throw new Error(`unknown command ${cmd}`)
  } catch (err) {
    console.error(String((err && err.stack) || err))
    process.exit(1)
  }
}
