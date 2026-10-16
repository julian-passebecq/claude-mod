// export-eta - one conversation → Markdown. Pure (no I/O): input = the session's metadata (from the desktop app's
// session file) and its transcript lines already parsed. Output: header table, then the person's and Claude's messages
// in order; each tool call is one line (tool + short description), tool outputs and file dumps are never copied, an
// agent's or a Workflow's result is one line. Masking is not done here (lib/mask.mjs runs on the whole result).

const TAGS_DROP = /<(system-reminder|local-command-stdout|local-command-stderr|command-message|command-args|bash-stdout|bash-stderr|user-prompt-submit-hook|persisted-output)>[\s\S]*?<\/\1>/g

export function oneLine(s, n = 140) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

export function ts(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v)
  return Number.isFinite(n) ? n : null
}

/** "2026-10-16 14:05" in local time (the PC's), or "". */
export function when(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function day(ms) { return when(ms).slice(0, 10) }

const textOf = (content) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\n')
}

/** What the person typed, without the app's wrappers. A slash command becomes "/name args". */
export function cleanUser(raw) {
  let t = String(raw ?? '')
  const cmd = t.match(/<command-name>([^<]*)<\/command-name>/)
  const args = t.match(/<command-args>([\s\S]*?)<\/command-args>/)
  t = t.replace(TAGS_DROP, '').replace(/<command-name>[^<]*<\/command-name>/g, '').trim()
  if (cmd) t = `${cmd[1].trim()}${args && args[1].trim() ? ' ' + args[1].trim() : ''}${t ? '\n' + t : ''}`
  return t.trim()
}

/** A <task-notification> (background agent or Workflow finished) as one line, else null. */
export function notificationLine(raw) {
  const t = String(raw ?? '')
  if (!/<task-notification>/.test(t)) return null
  const pick = (tag) => (t.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || ''
  const status = oneLine(pick('status'), 30)
  const summary = oneLine(pick('summary') || pick('description'), 90)
  const result = oneLine(pick('result'), 160)
  return `résultat en arrière-plan${status ? ` (${status})` : ''} : ${[summary, result].filter(Boolean).join(' — ') || '—'}`
}

const AGENT_TOOLS = new Set(['Agent', 'Task', 'Workflow'])

/** One line for a tool call: `Tool` + its description or its shortest meaningful argument. Never the content. */
export function toolLine(name, input = {}) {
  const i = input || {}
  let what = i.description || i.title || ''
  if (!what) {
    if (i.file_path || i.path || i.notebook_path) what = String(i.file_path || i.path || i.notebook_path).split(/[\\/]/).slice(-2).join('/')
    else if (i.pattern) what = `« ${oneLine(i.pattern, 50)} »`
    else if (i.url) what = String(i.url).replace(/[?#].*$/, '')
    else if (i.query) what = `« ${oneLine(i.query, 60)} »`
    else if (i.command && name !== 'Bash' && name !== 'PowerShell') what = oneLine(i.command, 60)
    else if (i.skill) what = i.skill
    else if (i.action) what = String(i.action)
  }
  const extra = AGENT_TOOLS.has(name) ? [i.subagent_type, i.model].filter(Boolean).join(' · ') : ''
  return `\`${name}\`${what ? ' ' + oneLine(what, 110) : ''}${extra ? ` (${extra})` : ''}`
}

/** An agent's or Workflow's tool_result → one line (its first meaningful line), else null for other tools. */
export function agentResultLine(content) {
  const t = textOf(content).replace(TAGS_DROP, '').trim()
  if (!t) return null
  const first = t.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find((l) => l && !/^agentId:/i.test(l)) || ''
  return oneLine(first, 180)
}

/**
 * Turns parsed transcript lines into a list of blocks: { role: 'user'|'assistant'|'event', at, items: [{ kind: 'text'|'tool'|'result', s }] }.
 * Sidechain (subagent) lines and meta lines are skipped; consecutive assistant pieces of one turn are merged.
 */
export function blocksOf(lines, opts = {}) {
  const blocks = []
  const toolNames = {}
  let cur = null
  const flush = () => { if (cur && cur.items.length) blocks.push(cur); cur = null }
  for (const d of lines || []) {
    if (!d || d.isSidechain || d.isMeta) continue
    const at = ts(d.timestamp)
    const msg = d.message || {}
    if (d.type === 'assistant') {
      const parts = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }]
      if (!cur || cur.role !== 'assistant') { flush(); cur = { role: 'assistant', at, items: [] } }
      for (const c of parts) {
        if (c.type === 'text' && c.text && c.text.trim()) cur.items.push({ kind: 'text', s: c.text.trim() })
        else if (c.type === 'tool_use') { toolNames[c.id] = c.name; cur.items.push({ kind: 'tool', s: toolLine(c.name, c.input) }) }
      }
      continue
    }
    if (d.type === 'user') {
      const content = msg.content
      if (Array.isArray(content) && content.some((c) => c && c.type === 'tool_result')) {
        for (const c of content) {
          if (c.type !== 'tool_result' || !AGENT_TOOLS.has(toolNames[c.tool_use_id])) continue
          const line = agentResultLine(c.content)
          if (line && cur && cur.role === 'assistant') cur.items.push({ kind: 'result', s: `résultat ${toolNames[c.tool_use_id]} : ${line}` })
        }
        continue // other tool outputs are never copied
      }
      const raw = textOf(content)
      const note = notificationLine(raw)
      if (note) { flush(); blocks.push({ role: 'event', at, items: [{ kind: 'text', s: note }] }); continue }
      const text = cleanUser(raw)
      if (!text || /^\[Request interrupted/.test(text)) continue
      flush()
      blocks.push({ role: 'user', at, items: [{ kind: 'text', s: text }] })
    }
  }
  flush()
  return blocks
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

/** Header table + front matter fields. */
export function header(s, L = {}) {
  const rows = [
    [L.project || 'Projet', s.project],
    [L.repo || 'Dossier (repo)', s.cwd ? `\`${s.cwd}\`` : ''],
    [L.branch || 'Branche', s.branch ? `\`${s.branch}\`` : ''],
    [L.model || 'Modèle · effort', [s.model, s.effort].filter(Boolean).join(' · ')],
    [L.started || 'Début', when(s.created)],
    [L.last || 'Dernière activité', when(s.last_activity)],
    [L.state || 'État', [s.state_label || s.state, s.status_detail].filter(Boolean).join(' — ')],
    [L.parent || 'Conversation parente', s.parent ? `${s.parent_title || ''} (\`${s.parent}\`)`.trim() : ''],
    [L.children || 'Sous-conversations', (s.children || []).map((c) => `${c.title || c.sid} (${c.state || ''})`).join(' ; ')],
    [L.prs || 'PR / MR', (s.prs || []).map((p) => `[${p.repo ? p.repo.split('/').pop() : ''}#${p.number ?? ''}](${p.url})${p.state ? ' ' + p.state : ''}`).join(' · ')],
    [L.session || 'Session', `\`${s.cli}\``],
  ].filter(([, v]) => v)
  return `| | |\n|---|---|\n${rows.map(([k, v]) => `| ${esc(k)} | ${esc(v)} |`).join('\n')}`
}

const yaml = (v) => JSON.stringify(String(v ?? ''))

/**
 * The whole file: front matter (read back by the index), title, header, messages.
 * Returns { md, last, counts: { user, assistant, tools } }.
 */
export function render(s, lines, opts = {}) {
  const L = opts.labels || {}
  const blocks = blocksOf(lines, opts)
  const who = { user: L.user || 'Julian', assistant: L.assistant || 'Claude', event: L.event || 'Événement' }
  const counts = { user: 0, assistant: 0, tools: 0 }
  const body = []
  for (const b of blocks) {
    counts[b.role] = (counts[b.role] || 0) + 1
    counts.tools += b.items.filter((x) => x.kind === 'tool').length
    if (b.role === 'event') { body.push(`> ${when(b.at)} · ${b.items[0].s}`); continue }
    const parts = [`### ${who[b.role]}${b.at ? ' · ' + when(b.at) : ''}`]
    let list = []
    const endList = () => { if (list.length) parts.push(list.join('\n')); list = [] }
    for (const x of b.items) {
      if (x.kind === 'text') { endList(); parts.push(x.s) } else list.push(x.kind === 'tool' ? `- ${x.s}` : `  - ↳ ${x.s}`)
    }
    endList()
    body.push(parts.join('\n\n'))
  }
  const textOfBlock = (b) => b.items.filter((x) => x.kind === 'text').map((x) => x.s).join(' ')
  const lastB = [...blocks].reverse().find((b) => b.role !== 'event' && textOfBlock(b))
  const last = lastB ? `${who[lastB.role]} : ${oneLine(textOfBlock(lastB), 160)}` : ''
  const front = [
    '---',
    `title: ${yaml(s.title)}`,
    `session: ${yaml(s.cli)}`,
    `project: ${yaml(s.project)}`,
    `state: ${yaml(s.state_label || s.state)}`,
    `started: ${yaml(when(s.created))}`,
    `last_activity: ${yaml(when(s.last_activity))}`,
    `exported: ${yaml(when(opts.now))}`,
    `messages: ${counts.user + counts.assistant}`,
    `last_message: ${yaml(last)}`,
    '---',
  ].join('\n')
  const note = L.note || 'Rendu par le mod export-eta : messages dans l’ordre, un appel d’outil par ligne, sorties d’outils et contenus de fichiers omis, secrets masqués.'
  const md = `${front}\n\n# ${s.title || s.cli}\n\n${header(s, L)}\n\n_${note}_\n\n## ${L.messages || 'Messages'}\n\n${body.join('\n\n') || '_' + (L.empty || 'aucun message') + '_'}\n`
  return { md, last, counts }
}

/** Splits a long Markdown file into parts of at most maxBytes (on block boundaries); past maxParts, truncates with a note. */
export function split(md, maxBytes, maxParts = 5, L = {}) {
  const size = (s) => Buffer.byteLength(s, 'utf8')
  if (!maxBytes || size(md) <= maxBytes) return [md]
  const head = md.split('\n## ')[0]
  const chunks = md.slice(head.length).split(/\n(?=### |> \d{4}-)/)
  const parts = []
  let cur = head
  for (const c of chunks) {
    let piece = c
    if (size(piece) > maxBytes / 2) piece = Buffer.from(piece, 'utf8').subarray(0, Math.floor(maxBytes / 2)).toString('utf8').replace(/�+$/, '') + `\n\n_${L.cut_message || '[message coupé : trop long]'}_\n`
    if (size(cur) + size(piece) + 1 > maxBytes && cur.trim()) { parts.push(cur); cur = '' }
    cur += (cur ? '\n' : '') + piece
  }
  if (cur.trim()) parts.push(cur)
  if (parts.length > maxParts) {
    const kept = parts.slice(0, maxParts)
    kept[maxParts - 1] += `\n\n_${(L.truncated || '[tronqué : {n} partie(s) de plus non exportée(s), limite max_parts]').replace('{n}', parts.length - maxParts)}_\n`
    return kept.map((p, i) => (i ? `<!-- partie ${i + 1}/${maxParts} -->\n${p}` : p))
  }
  return parts.map((p, i) => (i ? `<!-- partie ${i + 1}/${parts.length} -->\n${p}` : p))
}
