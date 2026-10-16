// menage mod: pure classification of what lies around (worktrees, branches, folders, sessions), the exact command
// to show for each row and the totals. No I/O: node --test covers it directly. The mod never runs a command.

/** Forward slashes, no trailing slash. */
export const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
/** Key to compare paths (case-insensitive on Windows-style drive paths). */
export const pathKey = p => {
  const n = norm(p)
  return /^[A-Za-z]:\//.test(n) ? n.toLowerCase() : n
}
/** A path quoted for the shell (double quotes, forward slashes). */
export const q = p => `"${norm(p)}"`

/** `{name}` placeholders from `vars`. */
export const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])))

/** Deep merge: objects merge, arrays and scalars from `b` win. */
export function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice()
  if (!b || typeof b !== 'object') return b === undefined ? a : b
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v)
  return out
}

/** `~` and `%VAR%` / `$VAR` expanded, forward slashes. */
export function expand(p, env = {}) {
  let s = String(p || '')
  s = s.replace(/^~(?=[\\/]|$)/, env.HOME || '')
  s = s.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, k) => (env[k] ?? m))
  s = s.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, k) => (env[k] ?? m))
  return norm(s)
}

/** A value still in <angle brackets> counts as unset. */
export const unset = p => !p || /<[^>]+>/.test(String(p))

/** `git worktree list --porcelain` → [{ path, head, branch, detached, bare, locked, prunable }]. */
export function parseWorktrees(text) {
  const out = []
  let cur
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      cur = { path: norm(line.slice(9)), head: '', branch: '', detached: false, bare: false, locked: false, prunable: false }
      out.push(cur)
    } else if (!cur) continue
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5)
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '')
    else if (line === 'detached') cur.detached = true
    else if (line === 'bare') cur.bare = true
    else if (line.startsWith('locked')) cur.locked = true
    else if (line.startsWith('prunable')) cur.prunable = true
  }
  return out
}

/** `git status --porcelain` text → counts. */
export function parseStatus(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean)
  return { changed: lines.filter(l => !l.startsWith('??')).length, untracked: lines.filter(l => l.startsWith('??')).length }
}

/** owner/name from a git remote URL (https or ssh), or ''. */
export function slugOf(url) {
  const m = String(url || '').trim().match(/[:/]([^/:]+(?:\/[^/:]+)*?\/[^/]+?)(?:\.git)?\/?$/)
  if (!m) return ''
  const parts = m[1].split('/')
  return parts.slice(-2).join('/').toLowerCase()
}

/** Branch name → merged PR info, from the Desktop session files' `prs` lists. Key: `<slug>#<branch>` and `#<branch>`. */
export function prIndex(sessions) {
  const idx = {}
  for (const s of sessions || []) {
    for (const p of s.prs || []) {
      if (!p || !p.branch) continue
      const rec = { state: String(p.state || '').toUpperCase(), number: p.number, url: p.url }
      for (const k of [`${String(p.repo || '').toLowerCase()}#${p.branch}`, `#${p.branch}`]) {
        const old = idx[k]
        if (!old || rec.state === 'MERGED' || (old.state !== 'MERGED' && rec.state === 'OPEN')) idx[k] = rec
      }
    }
  }
  return idx
}
export const prFor = (idx, slug, branch) => (branch ? idx[`${slug}#${branch}`] || idx[`#${branch}`] : undefined)

/**
 * How a branch (or detached HEAD) relates to the base branch.
 * facts: { ancestor, empty, squash, pr: {state}, gone }. Returns { merged, how, label }.
 *   ancestor: tip reachable from base (git branch --merged); squash: the files the branch changed are identical in base;
 *   pr: a session file says its PR is MERGED. gone alone (remote branch deleted) is a hint, not proof.
 */
export function mergeState(f, labels = {}) {
  const L = { ancestor: 'mergée', empty: 'aucun commit en plus de main', squash: 'mergée (squash : contenu identique dans main)', pr: 'PR #{n} mergée', gone: 'branche distante supprimée, non prouvée mergée', no: 'non mergée', ...labels }
  if (f.ancestor && f.empty) return { merged: true, how: 'empty', label: L.empty }
  if (f.ancestor) return { merged: true, how: 'ancestor', label: L.ancestor }
  if (f.squash) return { merged: true, how: 'squash', label: L.squash }
  if (f.pr && f.pr.state === 'MERGED') return { merged: true, how: 'pr', label: fill(L.pr, { n: f.pr.number ?? '?' }) }
  if (f.gone) return { merged: false, how: 'gone', label: L.gone }
  return { merged: false, how: 'no', label: L.no }
}

const DEFAULT_CMDS = {
  worktree_remove: 'git -C {repo} worktree remove {path}',
  worktree_prune: 'git -C {repo} worktree prune',
  branch_delete: 'git -C {repo} branch -d {branch}',
  branch_delete_squash: 'git -C {repo} branch -D {branch}',
  remote_delete: 'git -C {repo} push {remote} --delete {branch}',
  folder_delete: 'rm -rf {path}',
}
/** The exact command for a row, from the config's `commands` templates; paths quoted. */
export function command(kind, vars, cmds = {}) {
  const t = { ...DEFAULT_CMDS, ...cmds }[kind]
  if (!t) return ''
  return fill(t, { ...vars, repo: vars.repo ? q(vars.repo) : vars.repo, path: vars.path ? q(vars.path) : vars.path })
}

/**
 * One worktree row: level safe (green, removable as is), check (orange), danger (red, "ne pas supprimer").
 * w: parsed worktree plus { status: {changed, untracked}, merge: mergeState(), isMain }.
 */
export function worktreeRow(w, repo, cfg = {}) {
  const L = cfg.labels || {}
  const reasons = []
  if (w.prunable) return { level: 'safe', reasons: [L.prunable || 'dossier disparu : git le liste encore'], command: command('worktree_prune', { repo }, cfg.commands), reclaim: 0 }
  const dirty = w.status && w.status.changed + w.status.untracked > 0
  if (dirty) reasons.push(fill(L.dirty || 'modifié : {changed} fichiers modifiés, {untracked} non suivis', w.status))
  if (!w.merge?.merged) reasons.push(w.merge?.label || L.unmerged || 'non mergée')
  if (w.locked) reasons.push(L.locked || 'verrouillé (git worktree lock)')
  if (w.unknown) reasons.push(L.unknown || 'état illisible')
  if (reasons.length) return { level: 'danger', reasons, command: '', reclaim: 0 }
  const cmd = command('worktree_remove', { repo, path: w.path }, cfg.commands)
  return { level: 'safe', reasons: [w.merge.label, L.clean || 'propre'], command: cmd, reclaim: w.size?.bytes || 0 }
}

/** A merged branch row (local or remote); squash/pr-merged local branches need -D since -d refuses them. */
export function branchRow(b, repo, cfg = {}) {
  const L = cfg.labels || {}
  if (b.remote) {
    return { level: 'safe', reasons: [b.merge.label, L.remote_note || 'supprime la branche sur le serveur'], command: command('remote_delete', { repo, remote: b.remoteName || 'origin', branch: b.name }, cfg.commands) }
  }
  if (b.merge.how === 'ancestor' || b.merge.how === 'empty') {
    return { level: 'safe', reasons: [b.merge.label], command: command('branch_delete', { repo, branch: b.name }, cfg.commands) }
  }
  return { level: 'check', reasons: [b.merge.label, L.squash_note || '-d refuse une branche mergée par squash : -D, après vérification'], command: command('branch_delete_squash', { repo, branch: b.name }, cfg.commands) }
}

/** Keep the newest `keep` entries (by time), the rest are old. */
export function splitOld(items, keep) {
  const sorted = [...items].sort((a, b) => (b.time || 0) - (a.time || 0))
  return { kept: sorted.slice(0, Math.max(0, keep)), old: sorted.slice(Math.max(0, keep)) }
}

/**
 * A Desktop session that can be archived: not archived, idle at least `idleH` hours, every PR merged or closed and at
 * least one merged. s: { archived, lastActivityAt, prs: [{state}] }.
 */
export function archivable(s, now, idleH = 12) {
  if (s.archived || !s.prs || !s.prs.length) return false
  if (now - (s.lastActivityAt || 0) < idleH * 3600000) return false
  const st = s.prs.map(p => String(p.state || '').toUpperCase())
  return st.every(x => x === 'MERGED' || x === 'CLOSED') && st.includes('MERGED')
}

/** Is a mods folder loaded by CLAUDE_CODE_PLUGIN_DIRS (paths separated by ; or , ; : only between POSIX paths)? */
export function pluginDirs(value, env = {}) {
  const v = String(value || '')
  const parts = v.includes(';') || /^[A-Za-z]:/.test(v) ? v.split(/[;,]/) : v.split(/[:,]/)
  return parts.map(s => s.trim()).filter(Boolean).map(s => pathKey(expand(s, env)))
}

/** Totals: sure = safe rows' bytes; check = check rows' bytes; counts per section and level. */
export function totals(sections) {
  const t = { sure: 0, check: 0, rows: 0, danger: 0, commands: 0 }
  for (const s of sections || []) {
    for (const r of s.rows || []) {
      t.rows++
      if (r.level === 'safe') t.sure += r.reclaim || 0
      else if (r.level === 'check') t.check += r.reclaim || 0
      else if (r.level === 'danger') t.danger++
      if (r.command) t.commands++
    }
  }
  return t
}

/** Bytes as "1,2 Go" (French units). */
export function fmtBytes(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const u = ['o', 'Ko', 'Mo', 'Go', 'To']
  let i = 0
  let v = n
  while (Math.abs(v) >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${(i === 0 ? String(Math.round(v)) : v.toFixed(v >= 100 ? 0 : 1)).replace('.', ',')} ${u[i]}`
}

/** Age from ms timestamps: "3 h", "2 j", "5 min". */
export function fmtAge(then, now) {
  if (!then) return '—'
  const m = Math.max(0, (now - then) / 60000)
  if (m < 60) return `${Math.round(m)} min`
  if (m < 48 * 60) return `${Math.round(m / 60)} h`
  return `${Math.round(m / 1440)} j`
}

/** Path shown relative to one of `roots` when inside it. */
export function short(p, roots = []) {
  const n = norm(p)
  for (const r of roots) {
    const rn = norm(r)
    if (rn && pathKey(n).startsWith(pathKey(rn) + '/')) return n.slice(rn.length + 1)
  }
  return n
}

/** Rows filtered by the pane's filter: all | safe (récupérable) | danger (ne pas supprimer). */
export function filterRows(rows, filter) {
  if (filter === 'safe') return rows.filter(r => r.level === 'safe' || r.level === 'check')
  if (filter === 'danger') return rows.filter(r => r.level === 'danger')
  return rows
}

/** Every command of the rows at the given levels (safe by default), in order. */
export const commandsOf = (sections, levels = ['safe']) =>
  (sections || []).flatMap(s => (s.rows || []).filter(r => r.command && levels.includes(r.level)).map(r => r.command))
