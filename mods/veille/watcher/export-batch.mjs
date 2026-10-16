// veille × export-eta: each tour asks the export-eta mod, when it sits next to veille, for the batch of conversations
// finished since the last export (its own rule: ≥ batch_min, or a lead and all its sub-conversations finished). A ready
// batch becomes one alert « 4 conversations terminées — Exporter vers eta » with a button in the Veille pane (it runs
// the exporter); with export-eta's `auto: true` the watcher runs the export itself. No model call. Never fatal.
import fs from 'node:fs'
import path from 'node:path'
import { EXPORT_RUN } from '../lib/export-view.mjs'

export const EXPORT_SCRIPT = ['export-eta', 'exporter', 'export.mjs']
// What the pane's button runs, the script path relative to the mods folder (one definition: lib/export-view.mjs).
export { EXPORT_RUN }

/** The alert for a ready batch (pure; tested). */
export function exportAlert(pending, nowMs) {
  if (!pending || !pending.ready || !(pending.ids || []).length) return null
  return {
    key: `export:${pending.ids.slice().sort().join(',')}`, kind: 'export',
    what: pending.text || `${pending.count} conversations terminées — Exporter vers eta`, title: 'export-eta', since: nowMs,
    run: EXPORT_RUN, run_label: 'Exporter vers eta',
  }
}

/**
 * run: the watcher's run(argv, opts) → { code, out, err }. mods: the folder holding the mods (or the bin copy).
 * Returns { alert, event } (both may be null).
 */
export async function exportBatch(run, mods, env, nowMs, node = process.execPath) {
  const script = path.join(mods, ...EXPORT_SCRIPT)
  if (!fs.existsSync(script)) return { alert: null, event: null }
  const r = await run([node, script, 'pending', '--json'], { env, timeoutMs: 120000 })
  if (r.code !== 0) return { alert: null, event: { kind: 'export_failed', error: (r.err || '').trim().split('\n').pop() || `exit ${r.code}` } }
  let pending = null
  try { pending = JSON.parse(String(r.out).trim().split('\n').pop()) } catch { return { alert: null, event: null } }
  const alert = exportAlert(pending, nowMs)
  if (!alert || !pending.auto) return { alert, event: null }
  const x = await run([node, script, 'run', '--mode', 'batch'], { env, timeoutMs: 300000 })
  const line = String(x.code === 0 ? x.out : x.err || x.out).trim().split('\n').pop().replace(/^export-eta: /, '')
  return x.code === 0 ? { alert: null, event: { kind: 'exported', reason: line } } : { alert, event: { kind: 'export_failed', error: line } }
}
