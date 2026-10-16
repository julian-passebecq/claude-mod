// reference - « Mes repos »: each configured repo's state from git and gh outputs. Pure: the scanner runs the
// commands (read-only: no fetch, no pull) and hands their text here. Tested with node --test.

/** `git rev-list --left-right --count HEAD...@{u}` → { ahead, behind } (null when no upstream). */
export function aheadBehind(out) {
  const m = /^(\d+)\s+(\d+)/.exec(String(out ?? '').trim())
  return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : null
}

/** `git log -1 --format=%h%x09%ct%x09%s` → { sha, at (ms), subject }. */
export function lastCommit(out) {
  const [sha, ct, ...s] = String(out ?? '').trim().split('\t')
  if (!sha) return null
  return { sha, at: Number(ct) * 1000 || 0, subject: s.join('\t') }
}

/** `git status --porcelain` → number of changed files. */
export const dirtyCount = (out) => String(out ?? '').split(/\r?\n/).filter((l) => l.trim()).length

/** owner/name from a GitHub remote URL (https or ssh); '' when not GitHub. */
export function slugOf(url) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(url ?? '').trim())
  return m ? `${m[1]}/${m[2]}` : ''
}

/** `gh pr list --json number,title,url` → [{ number, title, url }] (max n). */
export function prsOf(out, n = 10) {
  try {
    const list = JSON.parse(String(out ?? '[]'))
    return (Array.isArray(list) ? list : []).slice(0, n).map((p) => ({ number: p.number, title: String(p.title || ''), url: String(p.url || '') }))
  } catch { return [] }
}

/** The one-line state of a repo the card shows. */
export function stateLine(r) {
  if (!r.exists) return 'dossier introuvable'
  const parts = [r.branch || '(détaché)']
  if (r.sync) parts.push(r.sync.behind || r.sync.ahead ? `${r.sync.behind} en retard · ${r.sync.ahead} en avance` : 'à jour avec l’amont')
  else parts.push('pas d’amont')
  if (r.dirty) parts.push(`${r.dirty} fichier(s) modifié(s)`)
  return parts.join(' · ')
}

/** Whether « Mettre à jour » may run: the main checkout on its main branch, clean. Returns '' or the reason not to. */
export function updateBlocker(r, mainBranch = 'main') {
  if (!r.exists) return 'dossier introuvable'
  if (r.branch !== (r.main || mainBranch)) return `branche ${r.branch || '(détachée)'} et non ${r.main || mainBranch}`
  if (r.dirty) return `${r.dirty} fichier(s) modifié(s)`
  return ''
}
