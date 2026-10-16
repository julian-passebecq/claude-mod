// veille - the « Fil »: every conversation's last message in one place, grouped by project, lead → sub-conversations.
// Pure (no I/O, no import): shared by the watcher (watcher/fil.mjs builds ~/.claude/veille/fil.json) and the pane.
// Zero model tokens: everything comes from files the desktop app and Claude Code already write.
// Tested with node --test mods/veille/tests/fil.test.mjs.

export const FIL_DEFAULTS = {
  hours: 48, // conversations with activity in the last N hours
  projects: [], // [] = every project; else names (case-insensitive) of the projects to show
  per_project: 15, // at most N conversations per project (the most recent), the rest counted as « + N autres »
  preview_chars: 240, // collapsed preview: first two lines of the last message, cut at N characters
  full_chars: 6000, // expanded: the full last message, cut at N characters
  archived: 'aujourdhui', // non | aujourdhui (archived ones active today) | oui
  live_s: 180, // transcript written in the last N seconds: « en cours »
  approval_min: 12, // a tool call with no result for N minutes while the transcript is silent: probable approval card
  tail_kb: 512, // bytes read from the end of a transcript, then up to max_tail_kb when no message was found
  max_tail_kb: 4096,
  link: 'claude://claude.ai/epitaxy/{id}',
}

export const STATES = ['en_cours', 'attend', 'bloquee', 'terminee', 'repos']

export function filConfig(cfg) {
  const f = (cfg && cfg.fil) || {}
  return { ...FIL_DEFAULTS, ...f, labels: { ...((f && f.labels) || {}) } }
}

const tsMs = (v) => {
  if (!v) return 0
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
}

// Small stable hash (FNV-1a), so a new question is a new alert and the same question is not.
export function hash(s) {
  let h = 0x811c9dc5
  for (const ch of String(s || '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}

// ---- secrets: nothing token-like leaves a preview ---------------------------------------------------------------------

const SECRET_RE = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g, /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, /\bAIza[0-9A-Za-z_-]{30,}/g, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
]
const KV_RE = /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|passw(?:or)?d|pwd)\s*[:=]\s*|Bearer\s+)(["']?)([^\s"'`,;]{6,})/gi
const LONG_RE = /[A-Za-z0-9+/_-]{40,}={0,2}/g

export function mask(text) {
  let t = String(text ?? '')
  for (const re of SECRET_RE) t = t.replace(re, '•••')
  t = t.replace(KV_RE, (m, k, q) => `${k}${q}•••`)
  // a long run mixing upper case, lower case and digits looks like a key (hex SHAs and ids, lower case only, stay)
  t = t.replace(LONG_RE, (m) => (/[A-Z]/.test(m) && /[a-z]/.test(m) && /\d/.test(m) ? '•••' : m))
  return t
}

// ---- the last message of a transcript ----------------------------------------------------------------------------------

const str = (v) => (typeof v === 'string' ? v.trim() : '')

function actionsOf(a) {
  let x = a
  if (typeof x === 'string') { try { x = JSON.parse(x) } catch { return [] } }
  return Array.isArray(x) ? x.map((b) => str(b && (b.label || b.message))).filter(Boolean) : []
}

const NO_RESULT_TOOLS = /(^|__)wrap_up$|^(Agent|Task|Workflow|AskUserQuestion|TaskOutput|Monitor)$/

// A new turn starts with a user record that carries text (a prompt, a task notification), not only tool results.
function isTurnStart(d) {
  if (d.type !== 'user' || d.isMeta || d.isSidechain) return false
  const c = d.message && d.message.content
  if (typeof c === 'string') return !!c.trim()
  return Array.isArray(c) && c.some((b) => b && b.type === 'text' && str(b.text)) && !c.some((b) => b && b.type === 'tool_result')
}

// records: parsed transcript lines, oldest first (a tail is enough). Tool calls, results and thinking are left out.
export function lastMessage(records) {
  let text = '', textAt = 0, textId = null, textIdx = -1, parts = []
  let wrap = null, turnIdx = -1, ask = null, lastAt = 0
  const pending = new Map()
  let i = 0
  for (const d of records || []) {
    i++
    if (!d || typeof d !== 'object') continue
    const ts = tsMs(d.timestamp)
    if (d.type === 'user' && !d.isSidechain) {
      const c = d.message && d.message.content
      if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result') { pending.delete(b.tool_use_id); if (ask && ask.id === b.tool_use_id) ask = null }
      if (isTurnStart(d)) { turnIdx = i; ask = null; pending.clear() }
      continue
    }
    if (d.type !== 'assistant' || d.isSidechain) continue
    const m = d.message || {}
    if (m.model === '<synthetic>') continue
    if (ts) lastAt = ts
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (!b) continue
      if (b.type === 'text' && str(b.text)) {
        if (m.id && m.id === textId && textIdx > turnIdx) parts.push(b.text)
        else { parts = [b.text]; textId = m.id || `i${i}` }
        text = parts.join('\n\n'); textAt = ts; textIdx = i
      } else if (b.type === 'tool_use') {
        const inp = b.input || {}
        if (/(^|__)wrap_up$/.test(b.name || '')) wrap = { recap: str(inp.recap), ask: str(inp.ask), actions: actionsOf(inp.actions), blocked: !!inp.blocked, at: ts, idx: i }
        else if (b.name === 'AskUserQuestion') {
          const qs = Array.isArray(inp.questions) ? inp.questions : []
          ask = { id: b.id, q: str(qs[0] && (qs[0].question || qs[0].header)) || str(inp.question), at: ts }
        }
        if (!NO_RESULT_TOOLS.test(b.name || '') && !inp.run_in_background) pending.set(b.id, { name: b.name, at: ts })
      }
    }
  }
  const current = !!wrap && wrap.idx > turnIdx
  const pend = [...pending.values()]
  return {
    text, text_at: textAt, text_current: textIdx > turnIdx, last_at: Math.max(lastAt, textAt),
    wrap: wrap ? { recap: wrap.recap, ask: wrap.ask, actions: wrap.actions, blocked: wrap.blocked, at: wrap.at, current } : null,
    ask_open: ask ? { q: ask.q, at: ask.at } : null,
    pending_tool: pend.length ? pend[pend.length - 1] : null,
  }
}

// ---- « attend Julian »: the four signals (heuristics documented in the README) -------------------------------------------

// A message that ends on a question to Julian: its last paragraph ends with « ? », or opens with a request.
const ASK_OPENERS = /^(?:\*\*)?(tell me|let me know|should i|shall i|do you want|want me to|would you like|can you|could you|please (?:confirm|choose|decide|pick|approve)|which (?:one|option)|dois-je|veux-tu|voulez-vous|souhaites-tu|préfères-tu|tu préfères|dis-moi|confirme|on (?:merge|lance|garde)|je (?:merge|lance) \?)/i

export function endsWithQuestion(text) {
  // a closing « Vérifié à 21:42 » status line (Julian's rule) is not the end of the message
  const t = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/(?:\n\s*)*\**(?:vérifié|verified|checked)\s+(?:à|at)\s+\d{1,2}[:h]\d{2}\.?\**\s*$/i, '').trim()
  if (!t) return ''
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const last = (paras[paras.length - 1] || '').replace(/[*_`>#\s]+$/g, '').trim()
  const plain = last.replace(/^[-*>#\s]+/, '').replace(/\*\*/g, '')
  const sentence = (plain.split(/(?<=[.!?])\s+/).filter(Boolean).pop() || plain).trim()
  if (/\?\s*\)?$/.test(plain)) return sentence.slice(0, 300)
  if (ASK_OPENERS.test(sentence) || ASK_OPENERS.test(plain)) return sentence.slice(0, 300)
  return ''
}

// A session that reports contradicting instructions (brief or packet vs rules vs Julian's own message): high priority.
const INCOHERENCE_RE = /\b(contradicts?|contradiction|contradictoire|conflicts? between|conflicting instructions|said no merge|says no merge|brief says|packet says|incohéren\w*|consignes? contraires?|consignes? (?:se )?contredi\w*)/i

export function incoherenceOf(text) {
  const t = String(text || '').replace(/```[\s\S]*?```/g, ' ')
  const m = INCOHERENCE_RE.exec(t)
  if (!m) return ''
  const start = Math.max(t.lastIndexOf('\n', m.index), t.lastIndexOf('. ', m.index) + 1) + 1
  const end = t.slice(m.index).search(/[.?!](?:\s|$)|\n/)
  return t.slice(start, end < 0 ? undefined : m.index + end + 1).replace(/[*_`#>]/g, '').trim().slice(0, 300)
}

// Which signal says the conversation waits on Julian, if any: {kind, question}. Order: pending AskUserQuestion,
// wrap_up ask or blocked, the app's needs_action / interrupted-awaiting, a closing question, a probable approval card.
export function julianSignal(s, msg, nowMs, f = FIL_DEFAULTS) {
  const m = msg || {}
  const live0 = s.mtime && nowMs - s.mtime < (f.live_s || 180) * 1000
  const wc = m.wrap && m.wrap.current ? m.wrap : null
  const inco = (wc && (incoherenceOf(wc.ask) || incoherenceOf(wc.recap))) || (!live0 && m.text_current && incoherenceOf(m.text))
  if (inco) return { kind: 'incoherence', question: `Incohérence entre consignes : ${inco}` }
  if (m.ask_open) return { kind: 'pending_ask', question: m.ask_open.q || 'Question en attente (AskUserQuestion)' }
  if (m.wrap && m.wrap.current && (m.wrap.ask || m.wrap.blocked)) return { kind: 'wrap', question: m.wrap.ask || m.wrap.recap || 'Bloquée (wrap_up)' }
  if (str(s.needs_action)) return { kind: 'needs', question: str(s.needs_action) }
  if (s.awaiting) return { kind: 'awaiting', question: 'Interrompue, attend une personne' }
  const live = s.mtime && nowMs - s.mtime < (f.live_s || 180) * 1000
  if (!live && m.text_current) {
    const q = endsWithQuestion(m.text)
    if (q) return { kind: 'question', question: q }
  }
  if (!live && m.pending_tool && m.pending_tool.at && nowMs - Math.max(m.pending_tool.at, s.mtime || 0) >= (f.approval_min || 12) * 60000) {
    return { kind: 'approval', question: `Approbation probable : ${m.pending_tool.name} sans résultat (non vérifié)` }
  }
  return null
}

export function stateOf(s, msg, nowMs, f = FIL_DEFAULTS) {
  const sig = julianSignal(s, msg, nowMs, f)
  if (sig && ['pending_ask', 'wrap', 'incoherence'].includes(sig.kind)) return 'attend' // the turn ended on Julian, even seconds ago
  if (s.mtime && nowMs - s.mtime < (f.live_s || 180) * 1000) return 'en_cours'
  if (sig) return 'attend'
  const w = msg && msg.wrap
  if (s.status_category === 'blocked') return 'bloquee'
  if (s.status_category === 'completed') return 'terminee'
  if (w && w.current && w.blocked) return 'bloquee'
  return 'repos'
}

// ---- text helpers ------------------------------------------------------------------------------------------------------

const PR_RE = /https?:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|[\w.-]*gitlab[\w.-]*\/[\w./-]+?\/-\/merge_requests\/\d+)/g

export function prLinks(text, appPrs = []) {
  const out = []
  const add = (url, state) => { const u = String(url || '').replace(/[).,;]+$/, ''); if (u && !out.some((x) => x.url.toLowerCase() === u.toLowerCase())) out.push({ url: u, state: state || '' }) }
  for (const p of appPrs || []) if (p && p.url) add(p.url, String(p.state || '').toLowerCase())
  for (const m of String(text || '').match(PR_RE) || []) add(m)
  return out
}

export function plainLines(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\|+|\|+$/g, '').replace(/\s*\|\s*/g, ' · ').trim())
    .filter((l) => l && !/^[-:·\s]+$/.test(l))
}

export function previewOf(source, chars = 240) {
  const lines = plainLines(source).slice(0, 2)
  const t = lines.join(' · ')
  return t.length > chars ? t.slice(0, chars - 1) + '…' : t
}

export function projectOf(cwd) {
  const p = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!p) return '?'
  const base = p.replace(/\/\.claude\/worktrees\/[^/]+.*$/, '')
  if (/^[A-Za-z]:\/Users\/[^/]+$|^\/(home|Users)\/[^/]+$/.test(base)) return '~'
  return base.split('/').filter(Boolean).pop() || base
}

export function hm(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const sameDay = (a, b) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate() }

// ---- the digest -------------------------------------------------------------------------------------------------------

// rows: one per app session {sid, cli, title, cwd, origin, model, effort, archived, last_activity (ms), mtime (ms),
// parent (sid), status_category, needs_action, awaiting, prs:[{url,state}], msg: lastMessage(...)}.
export function buildFil(rows, cfg, nowMs) {
  const f = filConfig(cfg)
  const keepArchived = (r) => !r.archived || f.archived === 'oui' || (f.archived === 'aujourdhui' && sameDay(r.last_activity, nowMs))
  const all = (rows || []).filter((r) => r && r.sid && nowMs - (r.last_activity || 0) <= f.hours * 3600000 && keepArchived(r))
  const bySid = new Map(all.map((r) => [r.sid, r]))
  const projectFor = (r, seen = new Set()) => {
    if (r.parent && bySid.has(r.parent) && !seen.has(r.parent)) { seen.add(r.sid); return projectFor(bySid.get(r.parent), seen) }
    return projectOf(r.origin || r.cwd)
  }
  const wanted = (f.projects || []).map((x) => String(x).toLowerCase())
  const convs = all.map((r) => {
    const m = r.msg || {}
    const sig = julianSignal(r, m, nowMs, f)
    const state = stateOf(r, m, nowMs, f)
    const useWrap = m.wrap && m.wrap.current && m.wrap.recap
    const source = useWrap ? m.wrap.recap : m.text
    const full = mask(m.text || '')
    return {
      sid: r.sid, cli: r.cli || '', title: mask(r.title || '(sans titre)'), project: projectFor(r), state,
      model: r.model || '', effort: r.effort || '', archived: !!r.archived, parent: r.parent && bySid.has(r.parent) ? r.parent : null,
      parent_title: r.parent && !bySid.has(r.parent) ? mask(r.parent_title || '') : '',
      last_at: Math.max(m.last_at || 0, r.last_activity || 0), msg_at: m.text_at || (m.wrap && m.wrap.at) || 0,
      link: String(f.link || '').replace('{id}', r.sid),
      preview: mask(previewOf(source, f.preview_chars)), from_wrap: !!useWrap,
      recap: m.wrap && m.wrap.current ? mask(m.wrap.recap) : '', ask: mask((sig && sig.question) || ''), signal: sig ? sig.kind : '',
      actions: m.wrap && m.wrap.current ? m.wrap.actions.map(mask) : [],
      text: full.length > f.full_chars ? full.slice(0, f.full_chars - 1) + '…' : full, truncated: full.length > f.full_chars,
      prs: prLinks(m.text, r.prs),
    }
  }).filter((c) => !wanted.length || wanted.includes(c.project.toLowerCase()))

  const projects = new Map()
  for (const c of convs) {
    if (!projects.has(c.project)) projects.set(c.project, [])
    projects.get(c.project).push(c)
  }
  const out = []
  for (const [name, list] of projects) {
    list.sort((a, b) => b.last_at - a.last_at)
    const kept = list.filter((c, i) => i < f.per_project || c.state === 'attend') // what waits on Julian is never cut
    const keptSids = new Set(kept.map((c) => c.sid))
    const counts = Object.fromEntries(STATES.map((s) => [s, list.filter((c) => c.state === s).length]))
    const nodes = new Map(kept.map((c) => [c.sid, { ...c, children: [] }]))
    const roots = []
    for (const c of kept) {
      const n = nodes.get(c.sid)
      if (c.parent && keptSids.has(c.parent)) nodes.get(c.parent).children.push(n)
      else roots.push(n)
    }
    const latest = (n) => Math.max(n.last_at, ...n.children.map(latest))
    const sortTree = (ns) => { ns.sort((a, b) => latest(b) - latest(a)); for (const n of ns) sortTree(n.children) }
    sortTree(roots)
    out.push({ name, last: list[0].last_at, total: list.length, hidden: list.length - kept.length, counts, convs: roots })
  }
  out.sort((a, b) => b.last - a.last)
  const julian = convs.filter((c) => c.state === 'attend').length
  return { v: 1, generated: nowMs, hours: f.hours, total: convs.length, julian, projects: out }
}

// « 5 conv · 2 en cours · 1 attend Julian · dernière activité 20:41 »
export function summaryLine(p, labels = {}) {
  const L = { conv: 'conv', en_cours: 'en cours', attend: 'attend Julian', bloquee: 'bloquée(s)', last: 'dernière activité', ...labels }
  const parts = [`${p.total} ${L.conv}`]
  for (const s of ['en_cours', 'attend', 'bloquee']) if (p.counts[s]) parts.push(`${p.counts[s]} ${L[s]}`)
  parts.push(`${L.last} ${hm(p.last)}`)
  return parts.join(' · ')
}

// ---- what the pane needs: new since last read, filters, the alerts the watcher raises -----------------------------------

// read = {since, by: {sid: ms}} kept in the mod's $.store. A conversation is new when its last message came after both.
export function isNew(c, read) {
  if (!read || !read.since) return false
  const at = c.msg_at || c.last_at || 0
  return at > Math.max(read.since, (read.by || {})[c.sid] || 0)
}

export function markRead(read, sid, nowMs) {
  const by = { ...((read && read.by) || {}) }
  by[sid] = nowMs
  for (const [k, t] of Object.entries(by)) if (nowMs - t > 14 * 86400000) delete by[k]
  return { since: (read && read.since) || nowMs, by }
}

export const markAllRead = (nowMs) => ({ since: nowMs, by: {} })

export const FILTERS = ['tout', 'attend', 'bloquee', 'terminee_auj', 'projet']

function matches(c, filter, nowMs) {
  if (filter === 'attend') return c.state === 'attend'
  if (filter === 'bloquee') return c.state === 'bloquee'
  if (filter === 'terminee_auj') return c.state === 'terminee' && sameDay(c.last_at, nowMs)
  return true
}

// Keeps the tree: a lead stays when it or one of its sub-conversations matches (then `dim` when only a child does).
export function filterFil(fil, filter = 'tout', project = '', nowMs = Date.now()) {
  const prune = (ns) => ns.map((n) => {
    const kids = prune(n.children || [])
    const ok = matches(n, filter, nowMs)
    return ok || kids.length ? { ...n, children: kids, dim: !ok } : null
  }).filter(Boolean)
  const projects = ((fil && fil.projects) || [])
    .filter((p) => filter !== 'projet' || !project || p.name === project)
    .map((p) => ({ ...p, convs: filter === 'tout' || filter === 'projet' ? p.convs : prune(p.convs) }))
    .filter((p) => p.convs.length)
  return { ...(fil || {}), projects }
}

export function flatten(ns, depth = 0, out = []) {
  for (const n of ns || []) { out.push({ ...n, depth }); flatten(n.children, depth + 1, out) }
  return out
}

// The « attend Julian » alerts the watcher raises from the Fil: one per conversation and per question.
export function julianAlerts(fil) {
  const out = []
  for (const p of (fil && fil.projects) || []) {
    for (const c of flatten(p.convs)) {
      if (c.state !== 'attend' || !c.signal) continue
      out.push({ key: `fil-${c.signal}:${c.cli || c.sid}:${hash(c.ask)}`, kind: `fil_${c.signal}`, what: `Attend Julian : ${c.ask}`,
        title: c.title, cli: c.cli, sid: c.sid, session_link: c.link, link: c.link, since: c.msg_at || c.last_at, julian: true })
    }
  }
  return out
}
