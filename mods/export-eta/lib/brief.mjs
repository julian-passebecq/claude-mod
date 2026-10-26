// export-eta - the « brief » for another AI (band button « Export conv » / « Export + enfants », /export-eta brief).
// Pure (no I/O): exporter/brief.mjs reads the session files, transcripts, git, gh / glab and the running Workflows, then
// calls these. One Markdown file: what the conversation is, where it stands and what is next, a live ETA, git, PRs/MRs,
// then the conversation itself (every person message in full, every Claude text, one line per tool call with ok/error).
// Children (spawnedFrom) follow, one section each, same structure. Masking runs on the whole result (lib/mask.mjs).
import { cleanUser, notificationLine, oneLine, ts, when } from './render.mjs'
import { etaOf, estimateOf } from './core/estimate.mjs'

export const BRIEF_LABELS = {
  title: 'Brief — {title}',
  intro: 'Brief exporté le {when} par le mod export-eta (bouton du bandeau) pour une autre IA : où en est cette conversation Claude Code{children}. Sorties d’outils et contenus de fichiers omis, secrets masqués.',
  intro_children: ' et ses {n} sous-conversation(s)',
  contents: 'Sommaire',
  conv: 'Conversation',
  child_of: 'sous-conversation de {parent}',
  what: 'Ce qu’est cette conversation',
  where: 'Où on en est / suite',
  eta: 'ETA en direct',
  git: 'Git',
  forge: 'GitHub / GitLab',
  messages: 'Conversation',
  k_title: 'Titre', k_project: 'Projet', k_cwd: 'Dossier', k_branch: 'Branche', k_model: 'Modèle · effort', k_started: 'Début',
  k_last: 'Dernière activité', k_state: 'État', k_parent: 'Conversation parente', k_children: 'Sous-conversations', k_session: 'Session',
  state_working: 'travaille', state_idle: 'au repos', state_waiting: 'attend une réponse (question posée)', state_waiting_person: 'attend Julian',
  state_archived: 'archivée',
  recap: 'Dernier récapitulatif de fin de tour', ask: 'Question en attente', app_status: 'Statut (app)', needs: 'Action demandée',
  plan: 'Liste de tâches (dernière connue)', no_plan: 'aucune liste de tâches trouvée', no_recap: 'aucun récapitulatif trouvé',
  last_reply: 'Dernière réponse de Claude',
  prs_open: 'PR / MR ouvertes', no_prs_open: 'aucune PR / MR ouverte', workflows: 'Workflows en cours', agents: 'Agents en cours',
  nothing_running: 'aucun Workflow ni agent en cours', eta_end: 'fin ~{time}', eta_range: '{lo}–{hi}', eta_none: 'pas assez d’historique ({n} run(s))',
  eta_overrun: 'dépasse l’estimation', started_at: 'lancé {time}', agents_counts: 'agents : {done} fini(s), {running} en cours{failed}', failed: ', {n} en échec',
  phase: 'phase {phase}', stalled: 'sans écriture depuis {min} min',
  branch: 'Branche', ahead_behind: 'Par rapport à {base} : {ahead} commit(s) d’avance, {behind} de retard (sans fetch)', uncommitted: 'Fichiers non commités',
  clean: 'arbre propre', commits: 'Derniers commits', no_git: 'pas un dépôt git (ou dossier absent) : {cwd}', more_files: '… et {n} de plus',
  forge_none: 'aucune PR / MR trouvée pour cette conversation', forge_skipped: 'gh / glab indisponible : états non lus',
  col_pr: 'PR / MR', col_title: 'Titre', col_state: 'État', col_checks: 'Checks / pipeline',
  checks: '{ok} ok · {bad} en échec · {run} en cours', checks_none: 'aucun check',
  user: 'Julian', assistant: 'Claude', event: 'Événement', compact: 'contexte compacté (résumé automatique omis)',
  ok: 'ok', error: 'erreur', pending: 'sans résultat', answer: 'réponse', question: 'Question',
  cut: '[coupé : {n} message(s) plus ancien(s) omis (≈ {chars} caractères), limite brief.max_chars_per_conv = {max}]',
  cut_message: '[message coupé : {n} caractères de plus]',
  empty: 'aucun message',
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const fill = (s, v = {}) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined || v[k] === null ? m : String(v[k])))
const hm = (ms) => when(ms).slice(11)
const textOf = (content) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\n')
}
const AGENT_TOOLS = new Set(['Agent', 'Task', 'Workflow'])
const short = (name) => String(name || '').replace(/^mcp__([^_]+(?:_[^_]+)*?)__/, (m, srv) => `${srv.replace(/^ccd_/, '')}:`)

/** One tool call as « `Tool` short arg »: description first, else the most telling argument. Never file contents. */
export function briefToolLine(name, input = {}) {
  const i = input || {}
  let what = i.description || i.title || ''
  if (!what) {
    if (i.file_path || i.path || i.notebook_path) what = String(i.file_path || i.path || i.notebook_path).split(/[\\/]/).slice(-2).join('/')
    else if (i.command) what = String(i.command).replace(/^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/, '')
    else if (i.pattern) what = `« ${oneLine(i.pattern, 50)} »`
    else if (i.url) what = String(i.url).replace(/[?#].*$/, '')
    else if (i.query) what = `« ${oneLine(i.query, 60)} »`
    else if (i.skill) what = i.skill
    else if (i.prompt) what = i.prompt
    else if (i.message) what = i.message
    else if (i.action) what = String(i.action)
    else if (i.to) what = `→ ${i.to}`
  }
  const extra = AGENT_TOOLS.has(name) ? [i.subagent_type, i.model].filter(Boolean).join(' · ') : ''
  return `\`${short(name)}\`${what ? ' ' + oneLine(what, 110) : ''}${extra ? ` (${extra})` : ''}`
}

/** The first meaningful line of a tool result (for errors, agent results and answers). */
export function firstLine(content, n = 180) {
  const t = textOf(content).replace(/<(system-reminder|persisted-output)>[\s\S]*?<\/\1>/g, '').trim()
  const l = t.split('\n').map((x) => x.replace(/^[#>*\-\s]+/, '').trim()).find((x) => x && !/^agentId:/i.test(x)) || ''
  return oneLine(l, n)
}

/** AskUserQuestion's answer, from its tool result text (« "Q"="A" » pairs) or the rejection. */
export function answerOf(content) {
  const t = textOf(content)
  const pairs = [...t.matchAll(/"([^"]{1,300})"="([^"]{0,600})"/g)].map((m) => m[2])
  if (pairs.length) return pairs.join(' ; ')
  return firstLine(content, 220)
}

/**
 * Parsed transcript lines → blocks [{role: user|assistant|event, at, items: [{kind: text|tool|ask, ...}]}], tool calls
 * carrying their status (ok / error + first error line). Sidechain and meta lines skipped; each tool_use id and each
 * line uuid counted once (the transcript may repeat lines).
 */
export function briefBlocks(lines) {
  const blocks = []
  const tools = new Map()
  const seen = new Set()
  let cur = null
  const flush = () => { if (cur && cur.items.length) blocks.push(cur); cur = null }
  for (const d of lines || []) {
    if (!d || d.isSidechain || d.isMeta) continue
    if (d.uuid) { if (seen.has(d.uuid)) continue; seen.add(d.uuid) }
    const at = ts(d.timestamp)
    const msg = d.message || {}
    if (d.type === 'assistant') {
      const parts = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }]
      if (!cur || cur.role !== 'assistant') { flush(); cur = { role: 'assistant', at, items: [] } }
      for (const c of parts) {
        if (!c) continue
        if (c.type === 'text' && c.text && c.text.trim()) cur.items.push({ kind: 'text', s: c.text.trim() })
        else if (c.type === 'tool_use') {
          if (tools.has(c.id)) continue
          const it = c.name === 'AskUserQuestion'
            ? { kind: 'ask', name: c.name, questions: (c.input?.questions || []).map((q) => ({ q: q.question || '', options: (q.options || []).map((o) => o.label || '').filter(Boolean) })), status: 'pending' }
            : { kind: 'tool', name: c.name, s: briefToolLine(c.name, c.input), status: 'pending' }
          tools.set(c.id, it)
          cur.items.push(it)
        }
      }
      continue
    }
    if (d.type !== 'user') continue
    const content = msg.content
    if (Array.isArray(content) && content.some((c) => c && c.type === 'tool_result')) {
      for (const c of content) {
        if (!c || c.type !== 'tool_result') continue
        const it = tools.get(c.tool_use_id)
        if (!it) continue
        it.status = c.is_error ? 'error' : 'ok'
        if (it.kind === 'ask') it.answer = answerOf(c.content)
        else if (c.is_error) it.err = firstLine(c.content, 160)
        else if (AGENT_TOOLS.has(it.name)) it.result = firstLine(c.content, 180)
      }
      continue
    }
    if (d.isCompactSummary) { flush(); blocks.push({ role: 'event', at, items: [{ kind: 'compact' }] }); continue }
    const raw = textOf(content)
    const note = notificationLine(raw)
    if (note) { flush(); blocks.push({ role: 'event', at, items: [{ kind: 'text', s: note }] }); continue }
    const text = cleanUser(raw)
    if (!text || /^\[Request interrupted/.test(text)) continue
    flush()
    blocks.push({ role: 'user', at, items: [{ kind: 'text', s: text }] })
  }
  flush()
  return blocks
}

/** The latest task list: the last update_plan with items (or TodoWrite todos), then advance / done / start applied. */
export function planOf(lines) {
  let items = null
  const seen = new Set()
  for (const d of lines || []) {
    if (!d || d.isSidechain || d.type !== 'assistant') continue
    for (const c of Array.isArray(d.message?.content) ? d.message.content : []) {
      if (!c || c.type !== 'tool_use' || seen.has(c.id)) continue
      seen.add(c.id)
      const i = c.input || {}
      if (/update_plan$/.test(c.name)) {
        if (Array.isArray(i.items)) items = i.items.map((x) => ({ content: String(x.content || ''), status: String(x.status || 'pending') }))
        else if (items) {
          if (i.advance) {
            const k = items.findIndex((x) => x.status === 'in_progress')
            if (k >= 0) items[k].status = 'completed'
            const n = items.findIndex((x, j) => j > k && x.status === 'pending')
            if (n >= 0) items[n].status = 'in_progress'
          }
          for (const n of Array.isArray(i.done) ? i.done : []) if (items[n - 1]) items[n - 1].status = 'completed'
          if (Number.isInteger(i.start) && items[i.start - 1]) {
            for (const x of items) if (x.status === 'in_progress') x.status = 'pending'
            items[i.start - 1].status = 'in_progress'
          }
        }
      } else if (c.name === 'TodoWrite' && Array.isArray(i.todos)) {
        items = i.todos.map((x) => ({ content: String(x.content || x.activeForm || ''), status: String(x.status || 'pending') }))
      } else if (/wrap_up$/.test(c.name) && items) {
        for (const x of items) if (x.status === 'in_progress') x.status = 'completed'
      }
    }
  }
  return items
}

/** The last end-of-turn box (wrap_up): {recap, ask, at}, or null. */
export function wrapOf(lines) {
  let w = null
  for (const d of lines || []) {
    if (!d || d.isSidechain || d.type !== 'assistant') continue
    for (const c of Array.isArray(d.message?.content) ? d.message.content : []) {
      if (c && c.type === 'tool_use' && /wrap_up$/.test(c.name) && c.input) w = { recap: String(c.input.recap || ''), ask: String(c.input.ask || ''), at: ts(d.timestamp) }
    }
  }
  return w
}

/** true when the last AskUserQuestion has no answer yet (the conversation waits on the person). */
export function waitingOnQuestion(blocks) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (b.role === 'user') return false
    if (b.role !== 'assistant') continue
    for (let j = b.items.length - 1; j >= 0; j--) if (b.items[j].kind === 'ask') return b.items[j].status === 'pending'
  }
  return false
}

const PR_RX = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g
const MR_RX = /https?:\/\/([\w.-]*gitlab[\w.-]*)\/([\w./-]+?)\/-\/merge_requests\/(\d+)/g

/** PR / MR links in a text: [{host, repo, number, url}]. */
export function linksIn(text) {
  const out = []
  const t = String(text ?? '')
  for (const m of t.matchAll(PR_RX)) out.push({ host: 'github', repo: m[1], number: Number(m[2]), url: `https://github.com/${m[1]}/pull/${m[2]}` })
  for (const m of t.matchAll(MR_RX)) out.push({ host: 'gitlab', server: m[1], repo: m[2], number: Number(m[3]), url: `https://${m[1]}/${m[2]}/-/merge_requests/${m[3]}` })
  return out
}

/**
 * PRs / MRs this conversation opened: links printed by a `gh pr create` / `glab mr create` call, or reported by its
 * agents and Workflows (their results and task notifications). Deduplicated, in order of appearance.
 */
export function prsOpened(lines) {
  const calls = new Map()
  const out = []
  const add = (xs) => { for (const x of xs) if (!out.some((o) => o.url === x.url)) out.push(x) }
  for (const d of lines || []) {
    if (!d || d.isSidechain) continue
    const content = Array.isArray(d.message?.content) ? d.message.content : []
    if (d.type === 'assistant') {
      for (const c of content) {
        if (c && c.type === 'tool_use') {
          const cmd = String(c.input?.command || '')
          if (/\b(gh\s+pr\s+create|glab\s+mr\s+create)\b/.test(cmd) || AGENT_TOOLS.has(c.name)) calls.set(c.id, true)
        }
      }
    } else if (d.type === 'user') {
      if (typeof d.message?.content === 'string' && /<task-notification>/.test(d.message.content)) add(linksIn(d.message.content))
      for (const c of content) {
        if (c && c.type === 'tool_result' && calls.has(c.tool_use_id)) add(linksIn(textOf(c.content)))
        else if (c && c.type === 'text' && /<task-notification>/.test(c.text || '')) add(linksIn(c.text))
      }
    }
  }
  return out
}

/** State word: waiting (a question pending, or the app says it waits on the person), working (written lately), idle. */
export function stateWord(s, blocks, nowMs, liveS = 120) {
  if (waitingOnQuestion(blocks)) return 'waiting'
  if (s.awaiting) return 'waiting_person'
  if (s.mtime && nowMs - s.mtime < liveS * 1000) return 'working'
  if (s.archived) return 'archived'
  return 'idle'
}

const MARK = { completed: '[x]', in_progress: '[>]', pending: '[ ]' }

/** ETA of a running Workflow from its past runs (estimate.mjs); null without enough history. */
export function workflowEta(w, nowMs) {
  const est = estimateOf(w.hist || [])
  return { est, eta: est.enough ? etaOf(est, w.start || nowMs, nowMs) : null }
}

/** The checks summary of a PR / MR (gh statusCheckRollup or a GitLab pipeline). */
export function checksText(p, L) {
  if (p.pipeline) return `pipeline ${p.pipeline.status || '?'}${p.pipeline.eta ? ` · ${fill(L.eta_end, { time: hm(p.pipeline.eta.mid) })}` : ''}`
  const c = p.checks
  if (!c || !c.total) return L.checks_none
  const base = fill(L.checks, c)
  return c.eta ? `${base} · ${fill(L.eta_end, { time: hm(c.eta.mid) })}${c.eta.overrun ? ` (${L.eta_overrun})` : ''}` : base
}

/** The head of one conversation (everything but the messages): sections 1-5, as Markdown lines. */
export function headOf(c, L, nowMs) {
  const s = c.session
  const out = []
  const stateLabel = L[`state_${c.state}`] || c.state
  const rows = [
    [L.k_title, s.title],
    [L.k_project, s.project || s.repo],
    [L.k_cwd, s.cwd ? `\`${s.cwd}\`` : ''],
    [L.k_branch, s.branch ? `\`${s.branch}\`` : ''],
    [L.k_model, [s.model, s.effort].filter(Boolean).join(' · ')],
    [L.k_started, when(s.created)],
    [L.k_last, when(s.last_activity || s.mtime)],
    [L.k_state, stateLabel],
    [L.k_parent, s.parent ? `${s.parent_title || ''} (\`${s.parent}\`)`.trim() : ''],
    [L.k_children, (c.children || []).map((k) => `${k.session.title || k.session.sid} (${L[`state_${k.state}`] || k.state})`).join(' ; ')],
    [L.k_session, `\`${s.cli}\`${s.sid ? ` · \`${s.sid}\`` : ''}`],
  ].filter(([, v]) => v)
  out.push(`## ${L.what}`, '', '| | |', '|---|---|', ...rows.map(([k, v]) => `| ${esc(k)} | ${esc(v)} |`), '')

  out.push(`## ${L.where}`, '')
  const w = c.wrap
  if (w && w.recap) out.push(`**${L.recap}**${w.at ? ` (${when(w.at)})` : ''} : ${w.recap}`, '')
  else if (s.wrap_desc) out.push(`**${L.recap}** : ${s.wrap_desc}`, '')
  else out.push(`_${L.no_recap}_`, '')
  if (w && w.ask) out.push(`**${L.ask}** : ${w.ask}`, '')
  if (s.status_detail) out.push(`**${L.app_status}** : ${[s.status_category, s.status_detail].filter(Boolean).join(' — ')}`, '')
  if (s.needs_action) out.push(`**${L.needs}** : ${s.needs_action}`, '')
  if (c.plan && c.plan.length) out.push(`**${L.plan}** :`, '', ...c.plan.map((x) => `- ${MARK[x.status] || '[ ]'} ${x.content}`), '')
  else out.push(`_${L.no_plan}_`, '')
  if (c.lastReply) out.push(`**${L.last_reply}** : ${oneLine(c.lastReply, 600)}`, '')

  out.push(`## ${L.eta}`, '')
  const open = (c.prs || []).filter((p) => p.state === 'open' || p.state === 'opened')
  out.push(`**${L.prs_open}** : ${open.length ? '' : L.no_prs_open}`)
  for (const p of open) out.push(`- ${p.repo.split('/').pop()}#${p.number} ${p.title || ''} — ${checksText(p, L)}`)
  out.push('')
  const r = c.running || { workflows: [], agents: [] }
  if (!r.workflows.length && !r.agents.length) out.push(`_${L.nothing_running}_`, '')
  if (r.workflows.length) {
    out.push(`**${L.workflows}** :`)
    for (const wf of r.workflows) {
      const n = (st) => wf.agents.filter((a) => a.status === st).length
      const { est, eta } = workflowEta(wf, nowMs)
      const phase = wf.phase ? fill(L.phase, { phase: wf.phases && wf.phases.length && wf.phaseIdx >= 0 ? `${wf.phaseIdx + 1}/${wf.phases.length} ${wf.phase}` : wf.phase }) : ''
      const etaT = eta ? `${fill(L.eta_end, { time: hm(eta.mid) })} (${fill(L.eta_range, { lo: hm(eta.lo), hi: hm(eta.hi) })}, n=${eta.n})${eta.overrun ? ` · ${L.eta_overrun}` : ''}` : fill(L.eta_none, { n: est.n })
      const bits = [phase, fill(L.agents_counts, { done: n('done'), running: n('running'), failed: n('failed') ? fill(L.failed, { n: n('failed') }) : '' }), wf.start ? fill(L.started_at, { time: hm(wf.start) }) : '', etaT,
        wf.stalled ? fill(L.stalled, { min: Math.round((nowMs - (wf.last || nowMs)) / 60000) }) : ''].filter(Boolean)
      out.push(`- ${wf.name}${wf.status !== 'running' ? ` (${wf.status})` : ''} — ${bits.join(' · ')}`)
      for (const a of wf.agents.filter((x) => x.status === 'running' || x.status === 'failed')) out.push(`  - ${a.label || a.id}${a.model ? ` (${a.model})` : ''} : ${a.status}`)
    }
    out.push('')
  }
  if (r.agents.length) {
    out.push(`**${L.agents}** :`)
    for (const a of r.agents) out.push(`- ${a.label || a.type || a.id}${a.model ? ` (${a.model})` : ''} : ${a.status}${a.start ? ` · ${fill(L.started_at, { time: hm(a.start) })}` : ''}${a.stalled ? ` · ${fill(L.stalled, { min: Math.round((nowMs - (a.last || nowMs)) / 60000) })}` : ''}`)
    out.push('')
  }

  out.push(`## ${L.git}`, '')
  const g = c.git
  if (!g || !g.ok) out.push(`_${fill(L.no_git, { cwd: s.cwd || '?' })}_`, '')
  else {
    out.push(`- ${L.branch} : \`${g.branch}\``)
    if (g.base) out.push(`- ${fill(L.ahead_behind, g)}`)
    out.push(`- ${L.uncommitted} : ${g.files.length ? '' : L.clean}`)
    for (const f of g.files) out.push(`  - \`${f}\``)
    if (g.moreFiles) out.push(`  - ${fill(L.more_files, { n: g.moreFiles })}`)
    if (g.commits.length) out.push(`- ${L.commits} :`, ...g.commits.map((x) => `  - ${x}`))
    out.push('')
  }

  out.push(`## ${L.forge}`, '')
  if (!(c.prs || []).length) out.push(`_${c.forgeSkipped ? L.forge_skipped : L.forge_none}_`, '')
  else {
    out.push(`| ${L.col_pr} | ${L.col_title} | ${L.col_state} | ${L.col_checks} |`, '|---|---|---|---|')
    for (const p of c.prs) out.push(`| [${esc(p.repo.split('/').pop())}#${p.number}](${p.url}) | ${esc(p.title || '')} | ${esc(p.state || '?')}${p.draft ? ' (draft)' : ''} | ${esc(checksText(p, L))} |`)
    if (c.forgeSkipped) out.push('', `_${L.forge_skipped}_`)
    out.push('')
  }
  return out.join('\n')
}

/** Messages of one conversation as Markdown chunks, one per block (oldest first). */
export function messageChunks(blocks, L, maxOne = 20000) {
  const who = { user: L.user, assistant: L.assistant }
  const cap = (t) => (t.length > maxOne ? `${t.slice(0, maxOne)}\n\n_${fill(L.cut_message, { n: t.length - maxOne })}_` : t)
  const chunks = []
  for (const b of blocks) {
    if (b.role === 'event') {
      chunks.push(`> ${when(b.at)} · ${b.items[0].kind === 'compact' ? L.compact : b.items[0].s}`)
      continue
    }
    const parts = [`**${who[b.role]}**${b.at ? ` · ${when(b.at)}` : ''}`]
    let list = []
    const endList = () => { if (list.length) parts.push(list.join('\n')); list = [] }
    for (const x of b.items) {
      if (x.kind === 'text') { endList(); parts.push(cap(x.s)) }
      else if (x.kind === 'ask') {
        endList()
        const qs = x.questions.map((q) => `> **${L.question}** : ${q.q}${q.options.length ? ` _(${q.options.join(' / ')})_` : ''}`).join('\n')
        parts.push(`${qs}\n> → ${x.status === 'pending' ? L.pending : `${L.answer} : ${x.answer || '—'}`}`)
      } else {
        const st = x.status === 'ok' ? L.ok : x.status === 'error' ? `${L.error}${x.err ? ` : ${x.err}` : ''}` : L.pending
        list.push(`- ${x.s} → ${st}${x.result ? `\n  - ↳ ${x.result}` : ''}`)
      }
    }
    endList()
    chunks.push(parts.join('\n\n'))
  }
  return chunks
}

/**
 * One conversation: title line, head, messages; capped at maxChars by dropping the OLDEST messages (the head and the
 * most recent messages stay) with a note saying what was cut. Returns { md, cut }.
 */
export function renderConv(c, L, opts = {}) {
  const maxChars = opts.maxChars ?? 60000
  const title = `# ${c.num ? c.num + ' ' : ''}${c.session.title || c.session.cli}${c.parentNum ? ` _(${fill(L.child_of, { parent: c.parentNum })})_` : ''}`
  const head = headOf(c, L, opts.now || Date.now())
  const chunks = messageChunks(c.blocks || [], L, Math.max(2000, Math.floor(maxChars / 3)))
  const pre = `${title}\n\n${head}\n## ${L.messages}\n\n`
  let budget = maxChars - pre.length
  const kept = []
  for (let i = chunks.length - 1; i >= 0; i--) {
    const sz = chunks[i].length + 2
    if (budget - sz < 0 && kept.length) break
    budget -= sz
    kept.unshift(chunks[i])
  }
  const dropped = chunks.length - kept.length
  const chars = chunks.slice(0, dropped).reduce((a, x) => a + x.length, 0)
  const note = dropped ? `_${fill(L.cut, { n: dropped, chars: chars.toLocaleString('fr-FR'), max: maxChars })}_\n\n` : ''
  const body = kept.length ? kept.join('\n\n') : `_${L.empty}_`
  return { md: `${pre}${note}${body}\n`, cut: dropped ? { messages: dropped, chars } : null }
}

/** Flattens a conversation tree (children nested) into render order, numbering 1, 1.1, 1.2, 1.1.1. */
export function flatten(root) {
  const out = []
  const walk = (c, num, parentNum) => {
    c.num = num
    c.parentNum = parentNum
    out.push(c)
    ;(c.children || []).forEach((k, i) => walk(k, `${num}.${i + 1}`, num))
  }
  walk(root, '1', '')
  return out
}

/** The whole brief: title, intro, contents, then each conversation. Returns { md, cuts: [{num, ...}] }. */
export function renderBrief(root, opts = {}) {
  const L = { ...BRIEF_LABELS, ...(opts.labels || {}) }
  const all = flatten(root)
  const kids = all.length - 1
  const now = opts.now || Date.now()
  const head = [
    `# ${fill(L.title, { title: root.session.title || root.session.cli })}`, '',
    fill(L.intro, { when: when(now), children: kids ? fill(L.intro_children, { n: kids }) : '' }), '',
  ]
  if (kids) {
    head.push(`## ${L.contents}`, '')
    for (const c of all) head.push(`${'  '.repeat(c.num.split('.').length - 1)}- ${c.num} ${c.session.title || c.session.cli} — ${L[`state_${c.state}`] || c.state}`)
    head.push('')
  }
  const cuts = []
  const parts = all.map((c) => {
    const r = renderConv(c, L, { maxChars: opts.maxChars, now })
    if (r.cut) cuts.push({ num: c.num, title: c.session.title, ...r.cut })
    return r.md
  })
  return { md: `${head.join('\n')}\n${parts.join('\n---\n\n')}`, cuts, count: all.length }
}
