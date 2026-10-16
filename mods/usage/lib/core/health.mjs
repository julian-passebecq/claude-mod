// Canonical copy: lib/core/health.mjs (repo root); */scanner/health.mjs and mods/*/lib/core copies are made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// Health record for « Santé des mods » (convention in mods/sante/README.md): ~/.claude/mods-health/<mod>.json with
// lastRun, durationMs (this process), cpuMs, error, lastOk and a rolling 24 h window. Best effort: never throws.
// MODS_HEALTH_DIR moves the folder (tests); MODS_HEALTH=0 turns it off.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function writeHealth(mod, error = null, env = process.env, now = Date.now()) {
  try {
    if (env.MODS_HEALTH === '0') return undefined
    const dir = env.MODS_HEALTH_DIR || join(homedir(), '.claude', 'mods-health')
    const file = join(dir, `${mod}.json`)
    let p = {}
    try {
      p = JSON.parse(readFileSync(file, 'utf8')) || {}
    } catch {}
    const cpu = process.cpuUsage()
    const cpuMs = Math.round((cpu.user + cpu.system) / 1000)
    const durationMs = Math.round(process.uptime() * 1000)
    const iso = new Date(now).toISOString()
    const start = Date.parse(p.window?.start ?? '')
    const w = start && now - start < 86400000 ? p.window : { start: iso, runs: 0, cpuMs: 0, durationMs: 0, errors: 0 }
    const rec = {
      mod, lastRun: iso, durationMs, cpuMs, error: error ? String(error).slice(0, 500) : null, lastOk: error ? p.lastOk ?? null : iso,
      window: { start: w.start, runs: w.runs + 1, cpuMs: w.cpuMs + cpuMs, durationMs: w.durationMs + durationMs, errors: (w.errors || 0) + (error ? 1 : 0) },
    }
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(rec))
    renameSync(`${file}.${process.pid}.tmp`, file)
    return rec
  } catch {
    return undefined
  }
}
