#!/usr/bin/env node
// a-faire - the scanner the pane runs (Node 22+, standard library, no model tokens).
//   node afaire_scan.mjs scan [--max-age-s N] [--fresh]   collect every source, write items.json and summary.json
//   node afaire_scan.mjs done <id>                        auto items: re-check (closes only when the cause is gone);
//                                                          others: marked done in state.json
//   node afaire_scan.mjs snooze <id> [days]               hide until tomorrow (snooze_days)
//   node afaire_scan.mjs unsnooze <id|all>
//   node afaire_scan.mjs counts                           counts per category, no content (for reports)
// Files in ~/.claude/a-faire (AFAIRE_HOME overrides). The sources themselves are never written.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, paths, readJson, scan, writeAtomic } from '../lib/collect.mjs'
import { markDone, markSnooze, pruneState } from '../lib/items.mjs'
import { writeHealth } from '../lib/core/health.mjs'

export async function main(argv) {
  const cfg = loadConfig()
  const p = paths(cfg)
  const [cmd = 'scan', ...rest] = argv
  const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined }
  const now = Date.now()
  if (cmd === 'scan') {
    const maxAge = Number(flag('--max-age-s') || 0)
    const sum = readJson(p.summary, null)
    if (maxAge && sum && now - (sum.updatedAt || sum.at || 0) < maxAge * 1000 && fs.existsSync(p.items)) { console.log(`afaire: à jour (${sum.total ?? sum.open})`); return 0 }
    const r = await scan(cfg, { now, fresh: rest.includes('--fresh') })
    console.log(`afaire: ${r.open.length} à faire, ${r.snoozed.length} reporté(s)${r.errors.length ? `, non lu : ${r.errors.join(', ')}` : ''}`)
    return 0
  }
  if (cmd === 'counts') {
    const r = await scan(cfg, { now, dry: true })
    console.log(JSON.stringify({ open: r.open.length, by_cat: r.summary.by_cat, by_prio: r.summary.by_prio, snoozed: r.snoozed.length, errors: r.errors }))
    return 0
  }
  if (cmd === 'done' || cmd === 'snooze' || cmd === 'unsnooze') {
    const id = rest[0]
    if (!id) { console.error(`afaire: ${cmd} <id>`); return 1 }
    const r = await scan(cfg, { now, fresh: cmd === 'done', dry: true })
    let out
    if (cmd === 'done') out = markDone(r.state, r.items, id, now)
    else if (cmd === 'snooze') out = markSnooze(r.state, id, now, Number(rest[1]) || cfg.snooze_days || 1)
    else {
      const st = { ...r.state, snooze: { ...(r.state.snooze || {}) } }
      if (id === 'all') st.snooze = {}; else delete st.snooze[id]
      out = { state: st, ok: true, msg: 'réaffiché' }
    }
    writeAtomic(p.state, pruneState(out.state, r.items, now))
    await scan(cfg, { now })
    console.log(`afaire: ${out.msg}`)
    return 0
  }
  console.log('usage: node afaire_scan.mjs scan [--max-age-s N] [--fresh] | done <id> | snooze <id> [days] | unsnooze <id|all> | counts')
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // health record ~/.claude/mods-health/a-faire.json (lib/core/health.mjs) for scans: Santé and Problèmes read it
  const scanRun = (process.argv[2] || 'scan') === 'scan'
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; if (scanRun) writeHealth('a-faire', c ? `scan_failed: exit ${c}` : null) }, (e) => {
    console.error(`afaire: ${String(e && e.message || e)}`)
    process.exitCode = 1
    if (scanRun) writeHealth('a-faire', `scan_failed: ${String(e && e.message || e).slice(0, 300)}`)
  })
}
