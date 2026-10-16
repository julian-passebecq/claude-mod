// ci mod, Claude <-> Codex dataset: pure rules (no I/O), shared by scanner/relais.mjs and its tests.
// Who opened each PR/MR, who pushed fixes, who merged it, the hand-offs between agents, the PRs it depends on, and
// the CI pass rate per agent. Every attribution comes from a visible mark (branch prefix, commit trailer, author,
// PR body, or a merge command found in a local transcript); anything else is « unknown », never a guess.

export const AGENTS = ['claude', 'codex']

export const DEFAULT_ATTRIBUTION = {
  claude_branches: ['claude/', 'worktree-agent-'],
  codex_branches: ['codex/'],
  claude_trailer: 'co-authored-by:\\s*claude',
  codex_trailer: 'co-authored-by:[^\\n]*codex',
  claude_body: 'generated with \\[claude code\\]',
  codex_body: '(generated|created|opened) (with|by) codex|chatgpt-codex',
  codex_authors: ['codex', 'chatgpt-codex-connector'],
  claude_authors: ['claude'],
}

const rx = (src) => {
  try { return src ? new RegExp(src, 'i') : null } catch { return null }
}
const lower = (s) => String(s ?? '').toLowerCase()

/** The attribution patterns with defaults for anything the config leaves out. */
export const attributionOf = (cfg) => ({ ...DEFAULT_ATTRIBUTION, ...((cfg && cfg.pipelines && cfg.pipelines.attribution) || {}), ...((cfg && cfg.relais && cfg.relais.attribution) || {}) })

/** Agent of a branch name, or null. */
export const branchAgent = (branch, a = DEFAULT_ATTRIBUTION) => {
  const b = lower(branch)
  if ((a.claude_branches || []).some((p) => b.startsWith(lower(p)))) return 'claude'
  if ((a.codex_branches || []).some((p) => b.startsWith(lower(p)))) return 'codex'
  return null
}

/** Agent of an author login or name, or null. */
export const authorAgent = (login, a = DEFAULT_ATTRIBUTION) => {
  const l = lower(login)
  if (!l) return null
  if ((a.codex_authors || []).some((x) => l === lower(x) || l.includes(lower(x)))) return 'codex'
  if ((a.claude_authors || []).some((x) => l === lower(x) || l.startsWith(`${lower(x)}[`))) return 'claude'
  return null
}

/** Agent of a commit: trailer first, then author. */
export const commitAgent = (c, a = DEFAULT_ATTRIBUTION) => {
  const text = `${c.headline ?? ''}\n${c.body ?? ''}`
  if (rx(a.claude_trailer)?.test(text)) return 'claude'
  if (rx(a.codex_trailer)?.test(text)) return 'codex'
  for (const who of c.authors ?? []) {
    const ag = authorAgent(who, a)
    if (ag) return ag
  }
  return 'unknown'
}

/** Agent that opened a PR: branch, then body mark, then author, then the first commit. */
export const openerAgent = (pr, a = DEFAULT_ATTRIBUTION) =>
  branchAgent(pr.branch, a)
  ?? (rx(a.claude_body)?.test(pr.body ?? '') ? 'claude' : null)
  ?? (rx(a.codex_body)?.test(pr.body ?? '') ? 'codex' : null)
  ?? authorAgent(pr.author, a)
  ?? (pr.commits && pr.commits.length ? (commitAgent(pr.commits[0], a) === 'unknown' ? null : commitAgent(pr.commits[0], a)) : null)
  ?? 'unknown'

/** CI verdict of a GitHub statusCheckRollup or a GitLab pipeline status. */
export const ciVerdict = (checks) => {
  if (typeof checks === 'string') {
    const s = lower(checks)
    if (s === 'success') return 'success'
    if (s === 'failed') return 'failed'
    if (['running', 'pending', 'created', 'waiting_for_resource', 'preparing', 'scheduled'].includes(s)) return 'pending'
    return s ? 'other' : 'none'
  }
  if (!Array.isArray(checks) || !checks.length) return 'none'
  const states = checks.map((c) => lower(c.conclusion || c.state || c.status))
  if (states.some((s) => ['failure', 'error', 'timed_out', 'action_required', 'startup_failure', 'failed'].includes(s))) return 'failed'
  if (states.some((s) => ['pending', 'queued', 'in_progress', 'expected', 'waiting', 'requested', ''].includes(s))) return 'pending'
  if (states.every((s) => ['success', 'neutral', 'skipped', 'completed'].includes(s))) return 'success'
  return 'other'
}

/** PR numbers this PR depends on: « depends on #N », « after #N », « stacked on #N », « needs #N », or a base branch
 *  that is another open PR's head. */
export const dependencies = (pr, all = []) => {
  const out = new Set()
  const text = `${pr.title ?? ''}\n${pr.body ?? ''}`
  for (const m of text.matchAll(/(?:depends on|dépend de|after|après|stacked on|needs|requires|blocked by|bloqué par)\s+(?:!|#)(\d+)/gi)) out.add(Number(m[1]))
  if (pr.base && !['main', 'master', 'develop'].includes(pr.base)) {
    const parent = all.find((o) => o.branch === pr.base && o.number !== pr.number)
    if (parent) out.add(parent.number)
  }
  out.delete(pr.number)
  return [...out].sort((x, y) => x - y)
}

/** Agent switches along opener -> commit agents -> merger, ignoring « unknown » steps. */
export const handoffs = (chain) => {
  const known = chain.filter((x) => x && x !== 'unknown')
  const out = []
  for (let i = 1; i < known.length; i++) if (known[i] !== known[i - 1]) out.push(`${known[i - 1]}→${known[i]}`)
  return out
}

/** One PR/MR, normalized -> its row in the dataset. `mergedByAgent` comes from local transcripts (or null). */
export const prRow = (pr, a, all = [], mergedByAgent = null) => {
  const opened = openerAgent(pr, a)
  // an unmarked commit on an agent's branch (claude/*, codex/*) counts for that agent: the branch is the mark
  const onBranch = branchAgent(pr.branch, a)
  const commitAgents = (pr.commits ?? []).map((c) => {
    const ag = commitAgent(c, a)
    return ag === 'unknown' && onBranch ? onBranch : ag
  })
  // fixes: commits after the first one; their agents in order, without repeats
  const fixers = [...new Set(commitAgents.slice(1).filter((x) => x !== 'unknown'))]
  const merged = pr.state === 'merged' ? (mergedByAgent ?? 'unknown') : null
  const chain = [opened, ...commitAgents, ...(merged ? [merged] : [])]
  return {
    number: pr.number,
    title: pr.title ?? '',
    url: pr.url ?? '',
    branch: pr.branch ?? '',
    base: pr.base ?? '',
    state: pr.state,
    created: pr.created ?? null,
    merged_at: pr.merged_at ?? null,
    opened_by: opened,
    fixed_by: fixers,
    merged_by: merged,
    merged_by_login: pr.merged_by_login ?? null,
    commits: commitAgents.length,
    commits_by: countBy(commitAgents),
    handoffs: handoffs(chain),
    depends_on: dependencies(pr, all),
    ci: ciVerdict(pr.checks),
  }
}

export const countBy = (xs) => {
  const out = {}
  for (const x of xs) out[x] = (out[x] ?? 0) + 1
  return out
}

const rate = (ok, n) => (n ? Math.round((ok / n) * 1000) / 10 : null)

/** Totals for a list of PR rows: per agent opened / fixed / merged / commits, hand-offs, CI pass rate of the PRs
 *  each agent opened (success / (success + failed)), plus CI runs per agent from the pipelines cache when given. */
export const totals = (rows, runs = []) => {
  const agents = ['claude', 'codex', 'unknown']
  const by = {}
  for (const ag of agents) {
    const opened = rows.filter((r) => r.opened_by === ag)
    const done = opened.filter((r) => r.ci === 'success' || r.ci === 'failed')
    const ok = done.filter((r) => r.ci === 'success').length
    const agRuns = runs.filter((r) => (r.who ?? 'unknown') === ag && (r.status === 'success' || r.status === 'failed'))
    const runsOk = agRuns.filter((r) => r.status === 'success').length
    by[ag] = {
      opened: opened.length,
      fixed: rows.filter((r) => r.fixed_by.includes(ag)).length,
      merged: rows.filter((r) => r.merged_by === ag).length,
      commits: rows.reduce((s, r) => s + (r.commits_by[ag] ?? 0), 0),
      pr_ci: { success: ok, failed: done.length - ok, rate: rate(ok, done.length) },
      runs: { success: runsOk, failed: agRuns.length - runsOk, rate: rate(runsOk, agRuns.length) },
    }
  }
  const hand = rows.flatMap((r) => r.handoffs)
  return {
    prs: rows.length,
    by_agent: by,
    handoffs: hand.length,
    handoffs_by_kind: countBy(hand),
    prs_with_handoff: rows.filter((r) => r.handoffs.length).length,
    with_dependencies: rows.filter((r) => r.depends_on.length).length,
  }
}

/** « owner/name » or « group/sub/name » from a remote URL, with its host kind; null when not GitHub or GitLab. */
export const parseRemote = (url, gitlabHosts = ['gitlab.com']) => {
  const u = String(url ?? '').trim().replace(/\.git$/, '')
  const m = u.match(/^(?:https?:\/\/(?:[^@/]+@)?|git@|ssh:\/\/git@)([^/:]+)[/:](.+)$/)
  if (!m) return null
  const host = m[1].toLowerCase()
  const path = m[2].replace(/^\/+/, '')
  if (host === 'github.com') return { kind: 'github', host, path }
  if (gitlabHosts.map(lower).includes(host)) return { kind: 'gitlab', host, path }
  return null
}

/** One « gh pr merge » / « glab mr merge » inside a shell segment -> { number, repo } (repo from -R/--repo or a URL),
 *  or null. The number is the first bare positional argument, so « 2>&1 » or « $n » never count. */
export const parseMerge = (segment) => {
  const m = String(segment ?? '').match(/\b(?:gh\s+pr|glab\s+mr)\s+merge\b(.*)$/)
  if (!m) return null
  const toks = m[1].trim().split(/\s+/).filter(Boolean)
  const takesValue = new Set(['-R', '--repo', '-t', '--subject', '-b', '--body', '-F', '--body-file', '-A', '--author-email', '--match-head-commit', '-m', '--message', '--sha'])
  let repo = null
  let number = null
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].replace(/^["']|["']$/g, '')
    if (/^[|>]|^\d*>/.test(t)) break
    if (takesValue.has(t)) {
      if (t === '-R' || t === '--repo') repo = (toks[i + 1] || '').replace(/^["']|["']$/g, '')
      i++
      continue
    }
    if (t.startsWith('-')) continue
    const url = t.match(/^https?:\/\/[^/]+\/(.+?)\/(?:-\/)?(?:pull|merge_requests)\/(\d+)/)
    if (url) { repo = url[1]; number = Number(url[2]); continue }
    if (number == null && /^!?\d+$/.test(t)) { number = Number(t.replace('!', '')); continue }
    if (number == null) break
  }
  return number == null ? null : { number, repo }
}

/** PR numbers merged by an agent, from shell commands found in its transcripts: « gh pr merge 12 », « glab mr merge 7 ».
 *  `cmds`: [{agent, cwd, command}]. A « cd <dir> » / « Set-Location <dir> » / « git -C <dir> » earlier in the same
 *  command line moves the working directory. Returns Map key `${repoName}#${n}` -> agent (the last one seen wins). */
export const mergesFromCommands = (cmds) => {
  const out = new Map()
  for (const c of cmds) {
    let cwd = c.cwd
    for (const seg of String(c.command ?? '').split(/;|&&|\|\||\n/)) {
      const cd = seg.match(/^\s*(?:cd|Set-Location|pushd|sl)\s+(?:-Path\s+)?["']?([^"'\n]+?)["']?\s*$/i)
      if (cd) { cwd = cd[1]; continue }
      const hit = parseMerge(seg)
      if (!hit) continue
      const name = hit.repo ? hit.repo.split('/').filter(Boolean).pop() : repoNameFromCwd(cwd)
      if (!name) continue
      out.set(`${lower(name)}#${hit.number}`, c.agent)
    }
  }
  return out
}

/** The repo folder name of a working directory, worktrees resolved to their repo (…/repo/.claude/worktrees/x -> repo). */
export const repoNameFromCwd = (cwd) => {
  const parts = String(cwd ?? '').replace(/\\/g, '/').split('/').filter(Boolean)
  const wt = parts.findIndex((p, i) => (p === '.claude' || p === '.codex') && parts[i + 1] === 'worktrees')
  if (wt > 0) return parts[wt - 1]
  return parts.length ? parts[parts.length - 1] : null
}

/** A one-screen text summary of the dataset. */
export const summaryText = (data) => {
  const t = data.totals
  const line = (ag) => {
    const b = t.by_agent[ag]
    const pr = b.pr_ci.rate == null ? '–' : `${b.pr_ci.rate} %`
    const runs = b.runs.rate == null ? '–' : `${b.runs.rate} %`
    return `${ag === 'claude' ? 'Claude' : ag === 'codex' ? 'Codex' : 'inconnu'} : ouvre ${b.opened} · corrige ${b.fixed} · merge ${b.merged} · ${b.commits} commits · vert PR ${pr} · vert runs ${runs}`
  }
  const kinds = Object.entries(t.handoffs_by_kind).map(([k, n]) => `${k} ${n}`).join(', ')
  const top = data.repos
    .filter((r) => r.totals.prs_with_handoff > 0)
    .sort((x, y) => y.totals.prs_with_handoff - x.totals.prs_with_handoff)
    .slice(0, 5)
    .map((r) => `${r.name} ${r.totals.prs_with_handoff}`)
  return [
    `Claude ↔ Codex · ${data.repos.length} repo(s) · ${t.prs} PR/MR sur ${data.days} j · lu ${data.generated}`,
    line('claude'),
    line('codex'),
    line('unknown'),
    `relais : ${t.handoffs}${kinds ? ` (${kinds})` : ''} dans ${t.prs_with_handoff} PR · dépendances : ${t.with_dependencies} PR`,
    top.length ? `repos avec relais : ${top.join(', ')}` : 'aucun relais lu',
    ...(data.errors.length ? [`${data.errors.length} repo(s) non lus (gh/glab absent ou sans accès)`] : []),
  ].join('\n')
}
