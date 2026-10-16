// a-faire - « mods installés mais pas chargés »: the mod folders found under the roots against CLAUDE_CODE_PLUGIN_DIRS,
// through lib/core/mods.mjs (the canonical reader, the same as Santé, Ménage and the Guide). Node only (the scanner):
// core/mods.mjs reads the disk, so the hooks module never imports this file.
import { listMods, loadedState, splitDirs } from './core/mods.mjs'

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')

/** The mods found under each root: [{ name (folder), path }]. */
export function modFolders(roots) {
  return (roots || []).flatMap((r) => listMods(r).map((m) => ({ name: m.folder, path: norm(m.dir) })))
}

/**
 * found: [{ name, path }]; dirsValue: CLAUDE_CODE_PLUGIN_DIRS. A mod counts as loaded when its folder is listed, or a
 * listed folder has its name (a copy elsewhere). Returns the mods not loaded and the value that loads them all.
 */
export function modsNotLoaded(found, dirsValue, sep = ';') {
  const list = splitDirs(dirsValue)
  const loadedNames = new Set(list.map((p) => norm(p).toLowerCase().split('/').pop()))
  const state = loadedState((found || []).map((m) => ({ ...m, dir: m.path })), dirsValue)
  const notLoaded = state.filter((m) => !m.loaded && !loadedNames.has(String(m.name).toLowerCase())).map(({ dir, loaded, ...m }) => m)
  const value = [...list, ...notLoaded.map((m) => norm(m.path))].join(sep)
  return { notLoaded, value }
}
