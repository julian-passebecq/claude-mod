// Canonical copy: lib/core/runner.mjs (repo root). Every mods/<mod>/lib/core/runner.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// Local GitLab runner load (running / pending jobs against `concurrent`) from the ci mod's pipelines cache
// (~/.claude/ci-pipelines-cache.json, summary.queue, written by mods/ci/scanner/pipelines.py). Never calls an API:
// the numbers are as old as that cache, and `age_ms` says how old.
import fs from 'node:fs'
import os from 'node:os'

export const CACHE = '~/.claude/ci-pipelines-cache.json'

const num = (v) => (Number.isFinite(v) ? v : null)

/** The cache JSON -> runner load, or null when the cache has no runner queue. */
export function runnerLoad(cache, now = Date.now()) {
  const q = cache && cache.summary && cache.summary.queue
  if (!q) return null
  const gen = Date.parse(cache.generated || '')
  const running = num(q.running)
  const concurrent = num(q.concurrent)
  return {
    backend: q.backend || '', label: q.label || q.backend || '', tag: q.tag || '',
    running, pending: num(q.pending), concurrent, online: num(q.runners_online), pipelinesOpen: num(q.pipelines_open),
    waitS: num(q.wait_s), waitN: num(q.wait_n),
    load: running !== null && concurrent ? running / concurrent : null,
    generated: Number.isFinite(gen) ? gen : null, age_ms: Number.isFinite(gen) ? Math.max(0, now - gen) : null,
  }
}

/** « runner local à 3/18 · 2 en file » (empty when unknown). */
export function runnerLine(r, labels = {}) {
  if (!r || r.running === null) return ''
  const L = { runner: 'runner local à', pending: 'en file', ...labels }
  return `${L.runner} ${r.running}/${r.concurrent ?? '?'}${r.pending ? ` · ${r.pending} ${L.pending}` : ''}`
}

/** Reads the cache file (path with ~). */
export function readRunner(file = CACHE, now = Date.now()) {
  try {
    const p = String(file).replace(/^~(?=$|[\\/])/, os.homedir())
    return runnerLoad(JSON.parse(fs.readFileSync(p, 'utf8')), now)
  } catch {
    return null
  }
}
