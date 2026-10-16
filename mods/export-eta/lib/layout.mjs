// export-eta - pure helpers: config merge, session states, paths in the eta repo, index pages, batch detection.
// No I/O here; exporter/export.mjs does the reading, writing and git.

export function deepMerge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v
  return out
}

export function fill(s, vars = {}) {
  return String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m))
}

/** Project of a session: the repo folder name (worktrees under .claude/worktrees count as their repo). */
export function projectOf(s) {
  const p = String(s.origin || s.cwd || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const repo = p.replace(/\/\.claude\/worktrees\/[^/]+.*$/, '').replace(/\/\.worktrees\/[^/]+.*$/, '')
  return slug(repo.split('/').pop() || 'sans-projet', 60) || 'sans-projet'
}

export function slug(s, n = 60) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '')
}

/**
 * State of a session: live (transcript written in the last live_s), finished (archived, or the app's post-turn
 * summary says one of finished_categories and it is quiet), ongoing (the rest, active in the last ongoing_hours), old.
 */
export function stateOf(s, cfg, nowMs) {
  const live = s.mtime && nowMs - s.mtime < (cfg.live_s ?? 180) * 1000
  if (live) return 'live'
  if (s.archived) return 'finished'
  if ((cfg.finished_categories || ['completed']).includes(s.status_category)) {
    if (nowMs - (s.last_activity || 0) >= (cfg.finished_quiet_min ?? 5) * 60000) return 'finished'
  }
  if (nowMs - (s.last_activity || 0) <= (cfg.ongoing_hours ?? 24) * 3600000) return 'ongoing'
  return 'old'
}

export const STATE_LABEL = { live: 'en cours (active)', ongoing: 'en cours', finished: 'terminée', old: 'ancienne' }

/** File name of a session: <YYYY-MM-DD of start>-<title slug>-<first 8 of the session id>.md. */
export function fileName(s, day) {
  const id = String(s.cli || '').slice(0, 8)
  return `${day || 'sans-date'}-${slug(s.title || 'conversation', 50) || 'conversation'}-${id}.md`
}

/** Path of a session in the eta repo: dest pattern with {project} and {file}. An existing file with the same id wins. */
export function pathOf(s, cfg, day, existing = []) {
  const dir = fill(cfg.dest_dir || 'sources/conversations/{project}', { project: s.project || projectOf(s) }).replace(/\/+$/, '')
  const id = String(s.cli || '').slice(0, 8)
  const hit = existing.find((f) => f.startsWith(dir + '/') && !f.slice(dir.length + 1).includes('/') && new RegExp(`-${id}\\.md$`).test(f))
  return hit || `${dir}/${fileName(s, day)}`
}

/** Part file names: a.md → a.md, a.part2.md, a.part3.md … */
export function partPath(path, i) { return i ? path.replace(/\.md$/, `.part${i + 1}.md`) : path }

/** Parses the front matter a rendered file starts with. */
export function frontMatter(md) {
  const m = String(md || '').match(/^---\n([\s\S]*?)\n---/)
  if (!m) return null
  const out = {}
  for (const line of m[1].split('\n')) {
    const k = line.match(/^(\w+):\s*(.*)$/)
    if (!k) continue
    try { out[k[1]] = JSON.parse(k[2]) } catch { out[k[1]] = k[2] }
  }
  return out
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

/** INDEX.md of one project folder. entries: [{ file, fm }] (file relative to the folder). */
export function projectIndex(project, entries, L = {}) {
  const rows = entries.filter((e) => e.fm).sort((a, b) => String(b.fm.last_activity).localeCompare(String(a.fm.last_activity)))
  return `# ${L.project_index || 'Conversations'} : ${project}\n\n${L.index_note || 'Généré par le mod export-eta ; ne pas éditer à la main (réécrit à chaque export).'}\n\n` +
    `| ${L.col_conv || 'Conversation'} | ${L.col_state || 'État'} | ${L.col_last || 'Dernière activité'} | ${L.col_msg || 'Dernier message'} |\n|---|---|---|---|\n` +
    rows.map((e) => `| [${cell(e.fm.title || e.file)}](${encodeURI(e.file)}) | ${cell(e.fm.state)} | ${cell(e.fm.last_activity)} | ${cell(e.fm.last_message)} |`).join('\n') + '\n'
}

/** Global INDEX.md: one row per project, then the latest conversations across projects. */
export function globalIndex(projects, L = {}, latestN = 30) {
  const all = projects.flatMap((p) => p.entries.filter((e) => e.fm).map((e) => ({ ...e, project: p.project })))
  all.sort((a, b) => String(b.fm.last_activity).localeCompare(String(a.fm.last_activity)))
  const per = projects.filter((p) => p.entries.length).sort((a, b) => a.project.localeCompare(b.project))
  return `# ${L.global_index || 'Conversations exportées'}\n\n${L.index_note || 'Généré par le mod export-eta ; ne pas éditer à la main (réécrit à chaque export).'}\n\n` +
    `| ${L.col_project || 'Projet'} | ${L.col_count || 'Conversations'} | ${L.col_last || 'Dernière activité'} |\n|---|---|---|\n` +
    per.map((p) => {
      const last = p.entries.map((e) => (e.fm && e.fm.last_activity) || '').sort().pop() || ''
      return `| [${cell(p.project)}](${encodeURI(p.project)}/INDEX.md) | ${p.entries.filter((e) => e.fm).length} | ${cell(last)} |`
    }).join('\n') +
    `\n\n## ${L.latest || 'Dernières conversations'}\n\n| ${L.col_conv || 'Conversation'} | ${L.col_project || 'Projet'} | ${L.col_state || 'État'} | ${L.col_last || 'Dernière activité'} | ${L.col_msg || 'Dernier message'} |\n|---|---|---|---|---|\n` +
    all.slice(0, latestN).map((e) => `| [${cell(e.fm.title || e.file)}](${encodeURI(e.project + '/' + e.file)}) | ${cell(e.project)} | ${cell(e.fm.state)} | ${cell(e.fm.last_activity)} | ${cell(e.fm.last_message)} |`).join('\n') + '\n'
}

/**
 * The batch waiting for an export: sessions finished since `since` (state.since, set at the first run so old history
 * is not proposed) and not exported at their current last activity. Ready when ≥ batch_min of them, or when a lead and
 * all its sub-conversations (app spawnedFrom links) are finished with at least one of them pending.
 * Returns { ready, reason, ids, count, leads }.
 */
export function batchOf(sessions, state, cfg, nowMs) {
  const since = state.since || 0
  const exported = state.exported || {}
  const byId = new Map(sessions.map((s) => [s.sid, s]))
  const fin = (s) => stateOf(s, cfg, nowMs) === 'finished'
  const pending = sessions.filter((s) => fin(s) && (s.last_activity || 0) > since && !(cfg.exclude || []).includes(s.cli) &&
    !(exported[s.cli] && (exported[s.cli].last_activity || 0) >= (s.last_activity || 0)))
  const pendingIds = new Set(pending.map((s) => s.cli))
  const kids = {}
  for (const s of sessions) if (s.parent && byId.has(s.parent)) (kids[s.parent] = kids[s.parent] || []).push(s)
  const leads = []
  for (const [sid, ch] of Object.entries(kids)) {
    const lead = byId.get(sid)
    const family = [lead, ...ch]
    if (family.every(fin) && family.some((x) => pendingIds.has(x.cli))) leads.push({ cli: lead.cli, title: lead.title, ids: family.map((x) => x.cli) })
  }
  const min = cfg.batch_min ?? 3
  const ids = [...new Set([...pending.map((s) => s.cli), ...leads.flatMap((l) => l.ids.filter((id) => pendingIds.has(id) || !exported[id]))])]
  const reason = pending.length >= min ? 'count' : leads.length ? 'lead' : ''
  return { ready: !!reason && ids.length > 0, reason, ids, count: ids.length, leads }
}

/** The one line shown in band, Veille and the pane for a ready batch. */
export function batchText(batch, L = {}) {
  if (!batch || !batch.ready) return ''
  return fill(L.batch_notice || '{n} conversations terminées — Exporter vers eta', { n: batch.count })
}

/** Groups sessions by project for the selection list, newest first. */
export function byProject(sessions) {
  const g = {}
  for (const s of sessions) (g[s.project] = g[s.project] || []).push(s)
  return Object.entries(g).map(([project, list]) => ({ project, list: list.sort((a, b) => (b.last_activity || 0) - (a.last_activity || 0)) }))
    .sort((a, b) => (b.list[0].last_activity || 0) - (a.list[0].last_activity || 0))
}
