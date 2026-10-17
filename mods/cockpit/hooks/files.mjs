// cockpit « Fichiers » - data-goblin's file tree (vendor/filetree, MIT, Kurt Buhler; see lib/filetree/LICENSE and
// NOTICE) embedded at the top of the Panneau. Two mods' panes in one column become tabs, so the only way to show the
// tree above the rest is to draw it here. The tree logic is filetree's own code, byte copies in lib/filetree/hooks
// (tree.ts: listing order, git status parsing, visible rows; icons.ts: git colours); this file only holds the state
// as plain data; register.mjs does the I/O, read-only: $.fs.list, `git status` / `git rev-parse` (--no-optional-locks,
// as filetree runs them). Pure: no $ here (a mod's validator follows $ only inside one file).
// Behaviour kept from filetree: a click on a folder opens or closes it (listed on demand), a click on a file selects it,
// and the next prompt carries the same context line filetree adds (« The user has this file selected in the file
// tree ... »), only while a file is selected by a click (panel.fichiers.attach_selection, on by default). Not here:
// search, preview, activity flashes, sizes, opening files (use filetree's own pane for those).
import { emptyTree, toNodes, replaceChildren, parseGit, posix, visibleRows, useDrives, inside, relative } from '../lib/filetree/hooks/tree.ts'
import { GIT_COLOR } from '../lib/filetree/hooks/icons.ts'

/** The tree's state, in memory (a reload starts from the cwd again). */
export function newFiles() {
  return { ...emptyTree(''), showHidden: false, limit: 0, busy: false, error: '', at: 0 }
}

/** A listing of $.fs.list (links already resolved by the caller) as filetree's nodes, sorted as filetree sorts them. */
export function nodesOf(dir, entries) {
  return toNodes(dir, entries)
}

/** Puts freshly listed folders ({ dir: nodes }) into the tree, as filetree does. */
export function applyListed(F, listed) {
  F.nodes = replaceChildren(F.nodes, listed)
}

/** `git rev-parse --show-prefix --show-toplevel` (null: no repo). */
export function applyTop(F, stdout) {
  const [p = '', tl = ''] = stdout === null ? [] : String(stdout).split(/\r?\n/)
  F.prefix = p.trim()
  F.top = tl.trim() || '-'
}

/** `git status --porcelain=v1 -b -z` -> the git letters and the branch. */
export function applyGit(F, stdout) {
  const g = parseGit(String(stdout || ''), F.root, F.prefix)
  F.git = g.git
  F.branch = g.branch
}

/** Points the tree at `root` (posix, no trailing slash); the caller lists it. */
export function resetTo(F, root, windows, showHidden) {
  useDrives(Boolean(windows))
  const r = posix(String(root || '')).replace(/\/+$/, '')
  Object.assign(F, { ...emptyTree(r), showHidden: Boolean(showHidden), limit: F.limit || 0, busy: false, error: '' })
  return r
}

/** The folders to list again on a refresh: the root and the open ones. */
export function openDirs(F) {
  return F.root ? [F.root, ...F.expanded.filter((d) => inside(F.root, d))] : []
}

/** A click on a row: a folder opens or closes, a file is selected (a second click clears it). Returns the folder the
 *  caller must list before the folder opens (null otherwise); then the caller calls openDir. */
export function filesPress(F, id) {
  const n = F.nodes.find((x) => x.id === id)
  if (!n) return null
  F.cursor = n.id
  if (n.kind === 'dir') {
    if (F.expanded.includes(n.id)) { F.expanded = F.expanded.filter((d) => d !== n.id); return null }
    return n.id
  }
  F.selected = F.selected === n.id ? '' : n.id
  return null
}

export function openDir(F, id) {
  if (!F.expanded.includes(id)) F.expanded = [...F.expanded, id]
}

export function filesClear(F) {
  F.selected = ''
}

/** The rows the panel draws: [{ id, depth, label, kind, open, git, color, selected }], at most `max`. */
export function filesRows(F, max) {
  if (!F.root) return { rows: [], more: 0 }
  const all = visibleRows(F)
  const rows = all.slice(0, Math.max(1, max)).map((r) => ({
    id: r.node.id, depth: r.depth, kind: r.node.kind, open: r.open,
    label: `${'  '.repeat(r.depth)}${r.node.kind === 'dir' ? (r.open ? '▾' : '▸') : '·'} ${r.node.name}`,
    git: F.git[r.node.id] || '', color: GIT_COLOR[F.git[r.node.id] || ''] || undefined, selected: F.selected === r.node.id,
  }))
  return { rows, more: Math.max(0, all.length - rows.length) }
}

/** The header: folder name and branch. */
export function filesHead(F) {
  const name = F.root.split('/').pop() || F.root
  const b = F.branch && F.branch.head ? ` · ${F.branch.head}${F.branch.ahead ? ` ↑${F.branch.ahead}` : ''}${F.branch.behind ? ` ↓${F.branch.behind}` : ''}` : ''
  return `${name}${b}`
}

export function filesShort(F, path) {
  return F.root && inside(F.root, path) ? relative(F.root, path) || path : path
}

/** The context line filetree adds to a prompt while a file is selected (same words, so Claude reads it the same way). */
export function filesContext(F) {
  return F.selected ? `The user has this file selected in the file tree; "this" or "it" in the prompt likely refers to it: ${F.selected}` : ''
}
