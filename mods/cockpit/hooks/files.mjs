// cockpit « Fichiers » - data-goblin's file tree (vendor/filetree, MIT, Kurt Buhler; see lib/filetree/LICENSE and
// NOTICE) embedded at the top of the Panneau. Two mods' panes in one column become tabs, so the only way to show the
// tree above the rest is to draw it here. The tree logic is filetree's own code, byte copies in lib/filetree/hooks
// (tree.ts: listing order, git status parsing, visible rows; icons.ts: git colours); this file only holds the state
// and the I/O, read-only: $.fs.list, `git status` / `git rev-parse` (--no-optional-locks, as filetree runs them).
// Behaviour kept from filetree: a click on a folder opens or closes it (listed on demand), a click on a file selects it,
// and the next prompt carries the same context line filetree adds (« The user has this file selected in the file
// tree ... »), only while a file is selected by a click (panel.fichiers.attach_selection, on by default). Not here:
// search, preview, activity flashes, sizes, opening files (use filetree's own pane for those).
import { emptyTree, toNodes, replaceChildren, parseGit, posix, join, visibleRows, useDrives, inside, relative } from '../lib/filetree/hooks/tree.ts'
import { GIT_COLOR } from '../lib/filetree/hooks/icons.ts'

/** The tree's state, in memory (a reload starts from the cwd again). */
export function newFiles() {
  return { ...emptyTree(''), showHidden: false, limit: 0, busy: false, error: '', at: 0 }
}

async function listDir($, dir) {
  try {
    const entries = await $.fs.list(dir)
    const resolved = await Promise.all(entries.map(async (e) => {
      if (!e.isLink) return { name: e.name, kind: e.kind, mtimeMs: e.mtimeMs, size: e.size, isLink: false }
      try {
        const t = await $.fs.stat(join(dir, e.name))
        return t.kind === 'dir' ? { name: e.name, kind: 'dir', mtimeMs: t.mtimeMs, size: 0, isLink: false } : { name: e.name, kind: 'file', mtimeMs: t.mtimeMs, size: t.size, isLink: true }
      } catch {
        return { name: e.name, kind: 'other', mtimeMs: 0, size: 0, isLink: true }
      }
    }))
    return toNodes(dir, resolved)
  } catch {
    return null
  }
}

async function git($, cwd, args, timeoutMs = 20000) {
  return $.process.run(['git', '--no-optional-locks', '-C', cwd, ...args], { timeoutMs, env: { GIT_OPTIONAL_LOCKS: '0' } })
}

async function loadDirs($, F, dirs) {
  const listed = new Map()
  for (const [dir, kids] of await Promise.all(dirs.map(async (d) => [d, await listDir($, d)]))) if (kids) listed.set(dir, kids)
  F.nodes = replaceChildren(F.nodes, listed)
}

async function readGit($, F, enabled) {
  if (!enabled || !F.root) return
  try {
    if (!F.top) {
      const r = await git($, F.root, ['rev-parse', '--show-prefix', '--show-toplevel'], 5000)
      const [p = '', tl = ''] = r.exitCode === 0 ? r.stdout.split('\n') : []
      F.prefix = p.trim()
      F.top = tl.trim() || '-'
    }
    if (F.top === '-') return
    const st = await git($, F.root, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=normal', '--', '.'])
    if (st.exitCode !== 0) return
    const g = parseGit(st.stdout, F.root, F.prefix)
    F.git = g.git
    F.branch = g.branch
  } catch { /* no git: the tree shows without letters */ }
}

/** Points the tree at `root` (the session's cwd) and lists its first level. */
export async function filesReset($, F, root, opts = {}) {
  let windows = false
  try { windows = (await $.env.get('OS')) === 'Windows_NT' } catch { windows = false }
  useDrives(windows)
  const r = posix(String(root || '')).replace(/\/+$/, '')
  Object.assign(F, { ...emptyTree(r), showHidden: Boolean(opts.showHidden), limit: F.limit || 0, busy: true, error: '' })
  if (!r) { F.busy = false; return }
  await loadDirs($, F, [r])
  await readGit($, F, opts.git !== false)
  F.busy = false
}

/** Lists the open folders again and refreshes the git letters (the panel's refresh). */
export async function filesRefresh($, F, opts = {}) {
  if (!F.root || F.busy) return
  F.busy = true
  try {
    await loadDirs($, F, [F.root, ...F.expanded.filter((d) => inside(F.root, d))])
    await readGit($, F, opts.git !== false)
  } finally { F.busy = false }
}

/** A click on a row: a folder opens or closes, a file is selected (a second click on it clears the selection). */
export async function filesPress($, F, id) {
  const n = F.nodes.find((x) => x.id === id)
  if (!n) return
  F.cursor = n.id
  if (n.kind === 'dir') {
    const open = new Set(F.expanded)
    if (open.has(n.id)) open.delete(n.id)
    else { await loadDirs($, F, [n.id]); open.add(n.id) }
    F.expanded = [...open]
    return
  }
  F.selected = F.selected === n.id ? '' : n.id
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
