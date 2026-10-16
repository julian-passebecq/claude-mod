// Canonical copy: lib/core/util.mjs (repo root). Every mods/<mod>/lib/core/util.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand. Small helpers shared by the mods (no $, no I/O at import).
// Same behaviour as the copies they replace: problemes/lib/core.mjs (deepMerge, fill, expand, oneLine),
// sante/hooks/logic.mjs (expandHome), a-faire/lib/collect.mjs (readJson, writeAtomic).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Forward slashes. */
export const slash = (p) => String(p ?? '').replace(/\\/g, '/')

/** `~` to the home folder (default: this user's), `%VAR%` and `$VAR` from env, forward slashes. */
export function expand(p, env = process.env, home = os.homedir()) {
  return slash(String(p ?? '')
    .replace(/^~(?=$|[\\/])/, env.HOME ?? env.USERPROFILE ?? home ?? '~')
    .replace(/%(\w+)%/g, (m, k) => env[k] ?? m)
    .replace(/\$(\w+)/g, (m, k) => env[k] ?? m))
}

/** Only `~` to `home`, forward slashes (sante's expandHome). */
export const expandHome = (p, home) => String(p || '').replace(/^~(?=[\\/]|$)/, home || '~').replace(/\\/g, '/')

/** Deep merge of config objects: arrays and scalars of `b` replace, undefined keeps `a`. */
export function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice()
  if (b === null || typeof b !== 'object') return b === undefined ? a : b
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v)
  return out
}

/** `{name}` placeholders from `vars`; an unknown name stays as written. */
export const fill = (s, vars = {}) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])))

/** One line of at most `n` characters, system reminders taken out. */
export function oneLine(s, n = 160) {
  const t = String(s ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** JSON file (BOM tolerated), or `fallback` when missing or unreadable. */
export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
  } catch {
    return fallback
  }
}

/** Text file, or null. */
export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** JSON lines, bad lines skipped. */
export function readJsonl(file) {
  const t = readText(file)
  if (!t) return []
  const out = []
  for (const line of t.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch { /* partial line */ }
  }
  return out
}

/** Write through a temp file and a rename (retried while Windows holds the target). Strings as is, else JSON. */
export function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 1))
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (e) {
      if (i >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) {
        try { fs.unlinkSync(tmp) } catch { /* gone */ }
        throw e
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1))
    }
  }
}

/** Epoch ms from ms, seconds or an ISO string; null when unreadable. */
export function toMs(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? (v > 1e12 ? v : v * 1000) : null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}
