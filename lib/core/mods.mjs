// Canonical copy: lib/core/mods.mjs (repo root). Every mods/<mod>/lib/core/mods.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// Which mods exist and which are loaded: CLAUDE_CODE_PLUGIN_DIRS split into folders, the mod folders found beside
// a mod (or under any root), and the join of both. Read-only.
import fs from 'node:fs'
import path from 'node:path'

const norm = (p) => String(p || '').trim().replace(/^"|"$/g, '').replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * CLAUDE_CODE_PLUGIN_DIRS as a list: `;` separates on Windows, `:` elsewhere. A value with no `;` that starts with
 * a drive letter is one Windows path, not two.
 */
export function splitDirs(value) {
  const s = String(value || '').trim()
  if (!s) return []
  const parts = s.includes(';') ? s.split(';') : /^[A-Za-z]:[\\/]/.test(s) ? [s] : s.split(':')
  return parts.map(norm).filter(Boolean)
}

/** Mod folders (with .claude-plugin/plugin.json) directly under `root`: [{name, dir, version, description}]. */
export function listMods(root) {
  const out = []
  let list = []
  try { list = fs.readdirSync(root, { withFileTypes: true }) } catch { return out }
  for (const e of list) {
    if (!e.isDirectory()) continue
    const dir = path.join(root, e.name)
    let m
    try { m = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')) } catch { continue }
    out.push({ name: m.name || e.name, folder: e.name, dir: norm(dir), version: m.version || '', description: m.description || '' })
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder))
}

/** The mods beside `modDir` (its parent folder). */
export const siblingMods = (modDir) => listMods(path.dirname(path.resolve(modDir)))

/** Marks each found mod loaded or not against the plugin dirs value (case-insensitive paths). */
export function loadedState(found, dirsValue) {
  const loaded = new Set(splitDirs(dirsValue).map((d) => d.toLowerCase()))
  return found.map((m) => ({ ...m, loaded: loaded.has(norm(m.dir).toLowerCase()) }))
}

/** Folders of plugin dirs that hold no mod any more. */
export function missingDirs(dirsValue, found) {
  const have = new Set(found.map((m) => norm(m.dir).toLowerCase()))
  return splitDirs(dirsValue).filter((d) => !have.has(d.toLowerCase()))
}
