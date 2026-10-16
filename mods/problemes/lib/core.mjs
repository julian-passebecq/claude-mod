// problemes mod (« Problèmes »): pure logic, no `$`, no file system. Used by the pane (hooks/register.tsx), the
// collector (scanner/problemes_scan.mjs) and the node tests.
//
// The ledger is append-only JSON lines (register.jsonl). Each line is one event about one problem:
//   { op: 'add',    id, at, signature, category, scope, app, title, symptom, cause, fix, status, evidence, source }
//   { op: 'seen',   id, at, n, evidence }          one or more occurrences found by one collection
//   { op: 'update', id, at, fields }               status, fix, cause… changed (CLI or reopen)
//   { op: 'note',   id, at, text }                 « Ajouter une note » from the pane
// fold() turns the lines into one entry per problem (first seen, last seen, count, timeline, notes).

export const STATUSES = ['ouvert', 'corrigé', 'contourné', 'accepté']

export function deepMerge(a, b) {
  if (Array.isArray(b) || b === null || typeof b !== 'object') return b === undefined ? a : b
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v)
  return out
}

export const fill = (s, vars = {}) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])))

export const slash = p => String(p ?? '').replace(/\\/g, '/')

/** ~, %VAR% and $VAR in a configured path. */
export function expand(p, env = {}) {
  return slash(String(p ?? '')
    .replace(/^~(?=$|[\\/])/, env.HOME ?? env.USERPROFILE ?? '~')
    .replace(/%(\w+)%/g, (m, k) => env[k] ?? m)
    .replace(/\$(\w+)/g, (m, k) => env[k] ?? m))
}

/** A placeholder such as <PROJECTS_ROOT> counts as not set. */
export const isSet = v => typeof v === 'string' ? v.trim() !== '' && !/^<[^>]*>$/.test(v.trim()) : v !== undefined && v !== null

// ---- text -------------------------------------------------------------------------------------------------------------

export function oneLine(s, n = 160) {
  const t = String(s ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** Text with paths, ids and numbers taken out: two occurrences of the same problem give the same string. */
export function normText(s, n = 120) {
  return oneLine(s, 4000)
    .toLowerCase()
    .replace(/[A-Za-z]:[\\/][^\s"'`)\]]*/g, '<chemin>')
    .replace(/(?:^|\s)\/(?:[\w.@-]+\/)+[\w.@-]*/g, ' <chemin>')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b(?:wf|agent|local)_?[0-9a-f-]{5,}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{7,40}\b/gi, '<id>')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n)
}

/** Repo or app name for a working folder: worktrees count as their repo; under a root, the first folder below it. */
export function appOf(cwd, roots = [], worktreeDirs = ['.claude/worktrees', '.worktrees']) {
  let p = slash(cwd).replace(/\/+$/, '')
  if (!p) return ''
  for (const w of worktreeDirs) {
    const i = p.toLowerCase().indexOf(`/${w.toLowerCase()}/`)
    if (i > 0) p = p.slice(0, i)
  }
  for (const r of roots.filter(isSet).map(x => slash(x).replace(/\/+$/, ''))) {
    if (p.toLowerCase().startsWith(r.toLowerCase() + '/')) return p.slice(r.length + 1).split('/')[0]
  }
  return p.split('/').pop() || ''
}

// ---- transcript records → hits ------------------------------------------------------------------------------------------

const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => (b && typeof b === 'object' ? b.text ?? (typeof b.content === 'string' ? b.content : '') : String(b ?? ''))).join(' ') : ''

/**
 * Hits found in one transcript record. `ctx` = { session, file, sub, cwd, tools: Map(tool_use_id → {name, command}) }
 * (the collector keeps `tools` between the records of one file). `det` = config.detect.
 * Kinds: ask, trailing_question, blocked, denied, tool_error, workflow_error, ci_failure, api_error.
 */
export function hitsOfRecord(d, ctx, det = {}) {
  const out = []
  if (!d || typeof d !== 'object') return out
  if (d.cwd) ctx.cwd = d.cwd
  const at = Date.parse(d.timestamp ?? '') || 0
  const base = { at, session: ctx.session, file: ctx.file, sub: !!ctx.sub, cwd: ctx.cwd ?? '' }
  const t = d.type
  if (t === 'system' && d.subtype === 'api_error') {
    const e = d.error
    out.push({ ...base, kind: 'api_error', tool: '', text: oneLine(typeof e === 'string' ? e : JSON.stringify(e ?? d.content ?? 'API error'), 300) })
  } else if (t === 'assistant') {
    const m = d.message ?? {}
    const blocks = Array.isArray(m.content) ? m.content : []
    for (const b of blocks) {
      if (!b || b.type !== 'tool_use') continue
      const inp = b.input ?? {}
      ctx.tools?.set(b.id, { name: b.name, command: String(inp.command ?? '').slice(0, 300) })
      if (ctx.tools && ctx.tools.size > 400) ctx.tools.delete(ctx.tools.keys().next().value)
      if (b.name === 'AskUserQuestion') {
        const qs = Array.isArray(inp.questions) ? inp.questions.map(q => q?.question ?? '').filter(Boolean) : []
        out.push({ ...base, kind: 'ask', tool: 'AskUserQuestion', text: oneLine(qs.join(' | ') || inp.question || 'AskUserQuestion', 300) })
      }
    }
    if (m.stop_reason === 'end_turn' && !ctx.sub && !d.isSidechain) {
      const texts = blocks.filter(b => b?.type === 'text').map(b => String(b.text ?? ''))
      const last = (texts[texts.length - 1] ?? '').trim()
      if (last) {
        const blocked = last.match(new RegExp(det.blocked_regex ?? '\\bBLOCKED:\\s*(.+)', 'm'))
        if (blocked) out.push({ ...base, kind: 'blocked', tool: '', text: oneLine(blocked[1] ?? blocked[0], 300) })
        else {
          const lines = last.split(/\n/).map(x => x.trim()).filter(Boolean)
          const tail = lines[lines.length - 1] ?? ''
          if (/\?\s*\**\s*$/.test(tail) && tail.length <= (det.question_max_chars ?? 400)) {
            out.push({ ...base, kind: 'trailing_question', tool: '', text: oneLine(tail, 300) })
          }
        }
      }
    }
  } else if (t === 'user') {
    const c = d.message?.content
    if (!Array.isArray(c)) return out
    for (const b of c) {
      if (!b || b.type !== 'tool_result') continue
      const call = ctx.tools?.get(b.tool_use_id)
      if (call) ctx.tools.delete(b.tool_use_id)
      const body = typeof b.content === 'string' ? b.content : textOf(b.content)
      const tool = call?.name ?? ''
      if (b.is_error) {
        const denied = new RegExp(det.denied_regex ?? "doesn't want to proceed|tool use was rejected|permission to use .* (?:has been|was) denied|user denied", 'i')
        out.push({ ...base, kind: denied.test(body) ? 'denied' : 'tool_error', tool, text: oneLine(body, 400) })
        continue
      }
      const tur = d.toolUseResult && typeof d.toolUseResult === 'object' ? d.toolUseResult : {}
      if ((tool === 'Workflow' || /agents_error/.test(body)) && (/agents_error/.test(body) || tur.status === 'failed')) {
        out.push({ ...base, kind: 'workflow_error', tool: tool || 'Workflow', text: oneLine(body, 400) })
        continue
      }
      if (tool === 'Bash' || tool === 'PowerShell') {
        const cmd = new RegExp(det.ci_command_regex ?? '\\b(gh|glab)\\b[^\\n]*\\b(pr checks|ci (status|view|list)|run (view|watch|list)|pipeline)', 'i')
        const fail = new RegExp(det.ci_failure_regex ?? '\\b(fail(?:ed|ure)?|skipped|canceled|cancelled)\\b', 'i')
        if (call && cmd.test(call.command) && fail.test(body)) {
          out.push({ ...base, kind: 'ci_failure', tool, text: oneLine(`${call.command.split('\n')[0]} → ${body}`, 400) })
        }
      }
    }
  }
  return out
}

/** Hits found in one desktop-app session file (`postTurnSummary.needs_action`, `sessionPermissionUpdates`). */
export function hitsOfSession(j, file = '') {
  const out = []
  if (!j || typeof j !== 'object') return out
  const base = { session: j.cliSessionId ?? j.sessionId ?? '', file, sub: false, cwd: j.cwd ?? j.originCwd ?? '', title: j.title ?? '' }
  const na = String(j.postTurnSummary?.needs_action ?? '').trim()
  if (na) out.push({ ...base, at: j.lastActivityAt ?? 0, kind: 'needs_action', tool: '', text: oneLine(na, 300), key: `na:${base.session}:${normText(na, 80)}` })
  for (const u of Array.isArray(j.sessionPermissionUpdates) ? j.sessionPermissionUpdates : []) {
    if (u?.type === 'addDirectories') {
      for (const dir of u.directories ?? []) {
        out.push({ ...base, at: j.lastActivityAt ?? 0, kind: 'permission_dir', tool: '', text: `dossier ajouté : ${slash(dir)}`, key: `dir:${base.session}:${slash(dir).toLowerCase()}` })
      }
    } else if (u?.type) {
      out.push({ ...base, at: j.lastActivityAt ?? 0, kind: 'permission_rule', tool: '', text: oneLine(`${u.type} ${JSON.stringify(u.rules ?? u.mode ?? '')}`, 200), key: `perm:${base.session}:${normText(JSON.stringify(u), 80)}` })
    }
  }
  return out
}

// ---- classification -----------------------------------------------------------------------------------------------------

const rx = (s, cache) => {
  if (!s) return null
  if (!cache.has(s)) {
    try { cache.set(s, new RegExp(s, 'i')) } catch { cache.set(s, /$^/) }
  }
  return cache.get(s)
}
const RX = new Map()

/** The first rule that matches a hit, or null. A rule: { id, kinds?, match?, tools?, sub?, category, title, … }. */
export function classify(hit, rules = []) {
  for (const r of rules) {
    if (r.kinds && !r.kinds.includes(hit.kind)) continue
    if (r.tools && !r.tools.includes(hit.tool)) continue
    if (r.sub !== undefined && r.sub !== !!hit.sub) continue
    const m = r.match ? rx(r.match, RX)?.exec(hit.text ?? '') : null
    if (r.match && !m) continue
    return r
  }
  return null
}

/** What makes two hits the same problem: the rule, plus its `key` capture, the app (per_app) or the text (by: text). */
export function signatureOf(hit, rule) {
  const parts = [rule.id]
  if (rule.key) {
    const m = rx(rule.key, RX)?.exec(hit.text ?? '')
    if (m) parts.push(normText(m[1] ?? m[0], 60))
  }
  if (rule.per_app) parts.push(`@${hit.app || '?'}`)
  if (rule.by === 'text') parts.push(normText(hit.text, 80))
  return parts.join(':')
}

export function keyOf(hit, rule) {
  if (!rule.key) return ''
  const m = rx(rule.key, RX)?.exec(hit.text ?? '')
  return m ? oneLine(m[1] ?? m[0], 60) : ''
}

/** Fields of a new problem made from its first hit. */
export function problemFields(hit, rule) {
  const vars = { app: hit.app || '?', text: oneLine(hit.text, 120), key: keyOf(hit, rule), tool: hit.tool || '' }
  const category = rule.category === 'apps' ? `apps/${hit.app || 'inconnue'}` : rule.category
  return {
    category,
    scope: rule.scope ?? (hit.app ? `app:${hit.app}` : 'global'),
    app: hit.app || '',
    title: oneLine(fill(rule.title ?? '{text}', vars), 140),
    symptom: oneLine(fill(rule.symptom ?? '{text}', vars), 400),
    cause: fill(rule.cause ?? '', vars),
    fix: fill(rule.fix ?? '', vars),
    status: rule.status ?? 'ouvert',
  }
}

export function evidenceOf(hit) {
  return { at: hit.at || 0, session: hit.session || '', file: hit.file || '', title: hit.title || '', text: oneLine(hit.text, 200) }
}

// ---- ledger ----------------------------------------------------------------------------------------------------------

export function parseLines(text) {
  const out = []
  for (const l of String(text ?? '').split('\n')) {
    if (!l.trim()) continue
    try {
      const j = JSON.parse(l)
      if (j && typeof j === 'object' && j.op && j.id) out.push(j)
    } catch { /* a torn last line: skipped */ }
  }
  return out
}

/** One entry per problem, in id order. `timelineMax` caps the occurrences kept per problem (newest kept). */
export function fold(lines, timelineMax = 60) {
  const map = new Map()
  for (const l of lines) {
    if (l.op === 'add') {
      if (map.has(l.id)) continue
      map.set(l.id, {
        id: l.id, signature: l.signature ?? '', category: l.category ?? 'autres', scope: l.scope ?? 'global', app: l.app ?? '',
        title: l.title ?? l.id, symptom: l.symptom ?? '', cause: l.cause ?? '', fix: l.fix ?? '', status: STATUSES.includes(l.status) ? l.status : 'ouvert',
        source: l.source ?? 'auto', ref: l.ref ?? '', first_seen: l.first_seen ?? l.at ?? 0, last_seen: l.last_seen ?? l.first_seen ?? l.at ?? 0,
        count: l.count ?? 0, evidence: [...(l.evidence ?? [])], timeline: [], notes: [], changed: l.at ?? 0, apps: l.app ? [l.app] : [],
      })
      continue
    }
    const p = map.get(l.id)
    if (!p) continue
    if (l.op === 'seen') {
      const n = Math.max(1, Number(l.n) || 1)
      p.count += n
      const at = l.last ?? l.at ?? 0
      if (!p.first_seen || (l.first && l.first < p.first_seen)) p.first_seen = l.first ?? at
      if (at > p.last_seen) p.last_seen = at
      p.timeline.push({ at, n, evidence: l.evidence ?? [] })
      if (p.timeline.length > timelineMax) p.timeline.shift()
      for (const a of l.apps ?? []) if (a && !p.apps.includes(a)) p.apps.push(a)
      for (const ev of l.evidence ?? []) {
        p.evidence.push(ev)
        if (p.evidence.length > 12) p.evidence.shift()
      }
    } else if (l.op === 'update') {
      for (const [k, v] of Object.entries(l.fields ?? {})) {
        if (k === 'status' && !STATUSES.includes(v)) continue
        if (['status', 'fix', 'cause', 'title', 'symptom', 'category', 'scope', 'app'].includes(k)) p[k] = v
        if (k === 'evidence' && Array.isArray(v)) p.evidence.push(...v)
      }
      p.changed = l.at ?? p.changed
      if (l.fields?.status) p.status_at = l.at ?? 0
    } else if (l.op === 'note') {
      p.notes.push({ at: l.at ?? 0, text: String(l.text ?? '').slice(0, 2000) })
    }
  }
  return [...map.values()].sort((a, b) => idNum(a.id) - idNum(b.id))
}

const idNum = id => Number(String(id).replace(/\D/g, '')) || 0

export function nextId(problems, used = 0) {
  const max = Math.max(used, 0, ...problems.map(p => idNum(p.id)))
  return `P-${String(max + 1).padStart(3, '0')}`
}

/**
 * Ledger lines for a batch of hits (already tagged with `app`): one `add` per new signature, one `seen` per problem
 * with the number of hits, first and last time and up to `maxEvidence` examples. A problem marked corrigé that shows
 * up again after its status changed is reopened (an `update` line), unless `reopen` is false.
 */
export function planLines(hits, problems, rules, now, { maxEvidence = 3, reopen = true } = {}) {
  const bySig = new Map(problems.map(p => [p.signature, p]))
  const groups = new Map()
  let ignored = 0
  const unmatched = new Map()
  for (const h of hits) {
    const r = classify(h, rules)
    if (!r || r.ignore) {
      ignored++
      if (!r) {
        const k = `${h.kind}: ${normText(h.text, 70)}`
        unmatched.set(k, (unmatched.get(k) ?? 0) + 1)
      }
      continue
    }
    const sig = signatureOf(h, r)
    if (!groups.has(sig)) groups.set(sig, { rule: r, hits: [] })
    groups.get(sig).hits.push(h)
  }
  const lines = []
  let used = 0
  const added = []
  for (const [sig, g] of groups) {
    g.hits.sort((a, b) => (a.at || 0) - (b.at || 0))
    const first = g.hits[0]
    const last = g.hits[g.hits.length - 1]
    let p = bySig.get(sig)
    if (!p) {
      const id = nextId(problems, used)
      used = idNum(id)
      lines.push({ op: 'add', id, at: now, signature: sig, source: 'auto', rule: g.rule.id, first_seen: first.at || now, ...problemFields(first, g.rule), evidence: [] })
      p = { id, status: g.rule.status ?? 'ouvert' }
      added.push(id)
    } else if (reopen && p.status === 'corrigé' && (last.at || now) > (p.status_at || p.changed || 0)) {
      lines.push({ op: 'update', id: p.id, at: now, fields: { status: 'ouvert' }, why: 'réapparu après correction' })
    }
    const ev = []
    const seen = new Set()
    for (const h of [...g.hits].reverse()) {
      const k = `${h.session}|${normText(h.text, 60)}`
      if (seen.has(k)) continue
      seen.add(k)
      ev.push(evidenceOf(h))
      if (ev.length >= maxEvidence) break
    }
    const apps = [...new Set(g.hits.map(h => h.app).filter(Boolean))]
    lines.push({ op: 'seen', id: p.id, at: now, n: g.hits.length, first: first.at || now, last: last.at || now, apps, evidence: ev })
  }
  return { lines, added, ignored, unmatched: [...unmatched.entries()].sort((a, b) => b[1] - a[1]) }
}

// ---- seeds (imports from existing registers) ---------------------------------------------------------------------------

/** Markdown tables with the heading above each: [{ heading, headers, rows: [[cells]] }]; bullets: [{ heading, text }]. */
export function mdBlocks(text) {
  const tables = []
  const bullets = []
  let heading = ''
  let cur = null
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim())
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const l = raw.trim()
    const h = l.match(/^#{1,6}\s+(.*)$/)
    if (h) { heading = h[1].trim(); cur = null; continue }
    if (l.startsWith('|')) {
      const c = cells(l)
      if (c.every(x => /^:?-{2,}:?$/.test(x))) continue
      if (!cur) { cur = { heading, headers: c, rows: [] }; tables.push(cur) } else cur.rows.push(c)
      continue
    }
    cur = null
    const b = l.match(/^[-*]\s+(.*)$/)
    if (b) bullets.push({ heading, text: b[1].trim() })
  }
  return { tables, bullets }
}

const COLS = {
  ref: /^(#|id|n°|no|réf|ref)$/i,
  title: /^(what|quoi|problème|probleme|question|title|titre|blocage|defect|défaut|claim|item)\b/i,
  symptom: /^(symptom|symptôme|symptome|effect|effet|détail|detail|evidence|preuves?)\b/i,
  cause: /^(cause|root cause|pourquoi|why|raison)\b/i,
  fix: /^(fix|correctif|solution|remède|remede|action)\b/i,
  todo: /^(still|reste|todo|à faire|next)\b/i,
  status: /^(status|statut|état|etat)\b/i,
  when: /^(when|date|quand|first seen|depuis|time|heure)\b/i,
  count: /^(count|nombre|fois|n|occurrences|×)$/i,
  app: /^(project|projet|app|application|repo|dépôt)\b/i,
  source: /^(source|sources|session|conversation|lien|link)\b/i,
  category: /^(category|catégorie|categorie|type)$/i,
  duration: /^(duration|durée)\b/i,
  avoidable: /^(y\/n|évitable|evitable|avoidable)\b/i,
}

export function statusOf(s) {
  const t = String(s ?? '').toLowerCase()
  if (!t) return 'ouvert'
  if (/not fixed|non corrigé|open|ouvert|todo|à faire/.test(t)) return 'ouvert'
  if (/workaround|contourn/.test(t)) return 'contourné'
  if (/kept off|by choice|accept|wontfix|confirmed/.test(t)) return 'accepté'
  if (/fixed|corrig|merged|done|resolved|résolu|applied|reverted/.test(t)) return 'corrigé'
  return 'ouvert'
}

export function dateOf(s, fallback = 0, year = new Date(fallback || Date.now()).getFullYear()) {
  const t = String(s ?? '')
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0)).getTime()
  const months = { jan: 0, janv: 0, feb: 1, févr: 1, fev: 1, mar: 2, mars: 2, apr: 3, avr: 3, may: 4, mai: 4, jun: 5, juin: 5, jul: 6, juil: 6, aug: 7, août: 7, aout: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11, déc: 11 }
  const dm = t.match(/\b(\d{1,2})\s+([A-Za-zéû]{3,5})\.?(?:\s+(\d{1,2})[:h](\d{2}))?/)
  if (dm && months[dm[2].toLowerCase()] !== undefined) return new Date(year, months[dm[2].toLowerCase()], +dm[1], +(dm[3] ?? 0), +(dm[4] ?? 0)).getTime()
  return fallback
}

/**
 * Problems (add lines without id) from a markdown register: every table row with a title, and bullets of sections that
 * allow them. Category: a Category column, else the section's `category`, else the first `seed` rule that matches, else
 * the section's `fallback`, else the source's `category`.
 */
export function seedFromMarkdown(text, src, rules = [], fallbackAt = 0) {
  const { tables, bullets } = mdBlocks(text)
  const out = []
  const section = h => (src.sections ?? []).find(s => rx(s.match, RX)?.test(h)) ?? {}
  for (const tb of tables) {
    const sec = section(tb.heading)
    if (sec.skip) continue
    const idx = {}
    tb.headers.forEach((hname, i) => { for (const [k, re] of Object.entries(COLS)) if (idx[k] === undefined && re.test(hname.replace(/\*/g, ''))) idx[k] = i })
    if (idx.title === undefined && idx.symptom === undefined && sec.title_from && idx[sec.title_from] !== undefined) {
      idx.title = idx[sec.title_from]
      delete idx[sec.title_from]
    }
    if (idx.title === undefined && idx.symptom === undefined) continue
    for (const row of tb.rows) {
      const get = k => (idx[k] === undefined ? '' : (row[idx[k]] ?? '').replace(/\\\|/g, '|').trim())
      const title = get('title') || get('symptom')
      if (!title) continue
      const ref = get('ref')
      const extra = [get('symptom') !== title ? get('symptom') : '', get('duration') ? `durée : ${get('duration')}` : '', get('source') ? `où : ${get('source')}` : '',
        get('avoidable') ? `évitable : ${get('avoidable')}` : ''].filter(Boolean).join(' · ')
      const whole = [title, extra, get('cause'), get('fix')].join(' ')
      const legit = idx.avoidable !== undefined && /^(n|non|no)$/i.test(get('avoidable'))
      const fix = [get('fix') || (idx.status !== undefined ? get('status') : ''), get('todo') ? `reste : ${get('todo')}` : ''].filter(Boolean).join(' · ')
      const r = classify({ kind: 'seed', text: whole, tool: '', sub: false }, rules)
      out.push({
        ref: `${src.id}:${normText(tb.heading, 24)}:${ref || normText(title, 50)}`,
        title: oneLine(ref ? `${ref} · ${title}` : title, 140),
        symptom: oneLine(extra || title, 600),
        cause: oneLine(get('cause'), 600),
        fix: oneLine(fix, 600),
        status: idx.status !== undefined ? statusOf(get('status')) : legit ? 'accepté' : get('todo') ? 'ouvert' : (sec.status ?? src.status ?? 'ouvert'),
        category: get('category') || sec.category || (r && r.category !== 'apps' ? r.category : '') || sec.fallback || src.category || 'autres',
        app: get('app'),
        first_seen: dateOf(get('when'), fallbackAt),
        count: Math.max(1, Number(get('count').replace(/\D/g, '')) || 1),
        evidence: [{ at: fallbackAt, session: '', file: src.label ?? src.id, title: '', text: oneLine(get('source') || tb.heading, 200) }],
      })
    }
  }
  for (const b of bullets) {
    const sec = section(b.heading)
    if (sec.skip || !sec.bullets) continue
    const r = classify({ kind: 'seed', text: b.text, tool: '', sub: false }, rules)
    out.push({
      ref: `${src.id}:${normText(b.heading, 24)}:${normText(b.text, 50)}`, title: oneLine(b.text, 140), symptom: oneLine(b.text, 600), cause: '', fix: '',
      status: statusOf(/\b(fixed|corrigé|caught)\b/i.test(b.text) ? 'fixed' : sec.status ?? 'ouvert'),
      category: sec.category || (r && r.category !== 'apps' ? r.category : '') || sec.fallback || src.category || 'autres', app: '',
      first_seen: fallbackAt, count: 1, evidence: [{ at: fallbackAt, session: '', file: src.label ?? src.id, title: '', text: oneLine(b.heading, 200) }],
    })
  }
  return out
}

/** Problems from an incidents JSON ({ incidents: [{ id, title, dates, evidence, root_cause, fix, fix_status, sources }] }). */
export function seedFromIncidents(j, src, rules = [], fallbackAt = 0) {
  return (j?.incidents ?? []).map(i => {
    const whole = [i.title, i.evidence, i.root_cause].join(' ')
    const r = classify({ kind: 'seed', text: whole, tool: '', sub: false }, rules)
    return {
      ref: `${src.id}:${i.id}`, title: oneLine(`${i.id} · ${i.title}`, 140), symptom: oneLine(i.evidence, 600), cause: oneLine(i.root_cause, 600),
      fix: oneLine(i.fix, 600), status: statusOf(i.fix_status), category: (r && r.category !== 'apps' ? r.category : '') || src.category || 'workflow/arrets',
      app: '', first_seen: dateOf(i.dates, fallbackAt), count: 1,
      evidence: [{ at: fallbackAt, session: '', file: src.label ?? src.id, title: i.severity ?? '', text: oneLine((i.sources ?? []).join(', '), 200) }],
    }
  })
}

/** Rule changes that did not work or stayed open, from a findings JSON ({ findings: [{ id, date, claim, verdict, status, note }] }). */
export function seedFromFindings(j, src, fallbackAt = 0) {
  const keep = src.keep ?? { verdict: ['did not'], status: ['open', 'ignored'] }
  return (j?.findings ?? []).filter(f => (keep.verdict ?? []).includes(f.verdict) || (keep.status ?? []).includes(f.status)).map(f => ({
    ref: `${src.id}:${f.id}`, title: oneLine(`${f.id} · ${f.claim}`, 140), symptom: oneLine((f.metrics ?? []).join(' · ') || f.claim, 600),
    cause: '', fix: oneLine(f.note, 600), status: f.status === 'reverted' ? 'corrigé' : 'ouvert', category: src.category || 'regles/trous', app: '',
    first_seen: dateOf(f.date, fallbackAt), count: 1, evidence: [{ at: fallbackAt, session: '', file: src.label ?? src.id, title: `verdict : ${f.verdict} · ${f.status}`, text: '' }],
  }))
}

/** Ledger lines for seed problems not imported yet (matched by `seed:<ref>` signature). */
export function seedLines(seeds, problems, now) {
  const have = new Set(problems.map(p => p.signature))
  const lines = []
  let used = 0
  for (const s of seeds) {
    const sig = `seed:${s.ref}`
    if (have.has(sig)) continue
    have.add(sig)
    const id = nextId(problems, used)
    used = idNum(id)
    const { ref, count, first_seen, evidence, ...f } = s
    lines.push({ op: 'add', id, at: now, signature: sig, source: 'seed', ref, scope: f.app ? `app:${f.app}` : 'global', ...f, first_seen: first_seen || now, evidence: [] })
    lines.push({ op: 'seen', id, at: now, n: count || 1, first: first_seen || now, last: first_seen || now, apps: f.app ? [f.app] : [], evidence })
  }
  return lines
}

// ---- view -----------------------------------------------------------------------------------------------------------------

/** Monday 00:00 local time of the week holding `now`. */
export function weekStart(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

export function totals(problems, now) {
  const w = weekStart(now)
  return {
    open: problems.filter(p => p.status === 'ouvert').length,
    fixed: problems.filter(p => p.status === 'corrigé').length,
    other: problems.filter(p => p.status !== 'ouvert' && p.status !== 'corrigé').length,
    week: problems.filter(p => (p.first_seen || 0) >= w).length,
    week_seen: problems.reduce((a, p) => a + p.timeline.filter(t => t.at >= w).reduce((x, t) => x + t.n, 0), 0),
  }
}

/** Filters: status (all | a status), category (all | top or leaf id), app (all | name), week (all | this | 30d). */
export function applyFilters(problems, f = {}, now = 0) {
  const w = f.week === 'this' ? weekStart(now) : f.week === '30d' ? now - 30 * 86400000 : 0
  return problems.filter(p =>
    (!f.status || f.status === 'all' || p.status === f.status) &&
    (!f.category || f.category === 'all' || p.category === f.category || p.category.startsWith(f.category + '/')) &&
    (!f.app || f.app === 'all' || p.app === f.app || (p.apps ?? []).includes(f.app)) &&
    (!w || (p.last_seen || 0) >= w))
}

export function appsOf(problems) {
  const n = new Map()
  for (const p of problems) for (const a of new Set([p.app, ...(p.apps ?? [])].filter(Boolean))) n.set(a, (n.get(a) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

const rank = p => [p.status === 'ouvert' ? 0 : 1, -(p.last_seen || 0)]
const byRank = (a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] }

/**
 * The category tree with the problems under each node. `categories` is the configured tree; a node with
 * `dynamic: 'app'` gets one child per app (cross view: a problem also stays in its own category). Problems whose
 * category is not in the tree go under their top-level node, or under « autres ».
 */
export function tree(problems, categories = [], labels = {}) {
  const nodes = []
  const leafIds = new Set()
  const walk = (c, depth) => { leafIds.add(c.id); for (const ch of c.children ?? []) walk(ch, depth + 1) }
  for (const c of categories) walk(c, 0)
  const own = id => problems.filter(p => p.category === id)
  const build = (c) => {
    if (c.dynamic === 'app') {
      const apps = appsOf(problems)
      const children = apps.map(([a]) => {
        const list = problems.filter(p => p.app === a || (p.apps ?? []).includes(a) || p.category === `${c.id}/${a}`).sort(byRank)
        return { id: `${c.id}/${a}`, label: a, problems: list, children: [], total: list.length, open: list.filter(p => p.status === 'ouvert').length }
      })
      const all = new Set(children.flatMap(ch => ch.problems))
      return { id: c.id, label: c.label, cross: true, problems: [], children, total: all.size, open: [...all].filter(p => p.status === 'ouvert').length }
    }
    const children = (c.children ?? []).map(build)
    const top = c.id.includes('/') ? [] : problems.filter(p => p.category !== c.id && p.category.startsWith(c.id + '/') && !leafIds.has(p.category))
    const list = [...own(c.id), ...top].sort(byRank)
    const all = [...list, ...children.flatMap(ch => collect(ch))]
    return { id: c.id, label: c.label, problems: list, children, total: all.length, open: all.filter(p => p.status === 'ouvert').length }
  }
  const collect = n => [...n.problems, ...n.children.flatMap(collect)]
  for (const c of categories) nodes.push(build(c))
  const tops = new Set(categories.map(c => c.id))
  const rest = problems.filter(p => !leafIds.has(p.category) && !tops.has(p.category.split('/')[0])).sort(byRank)
  if (rest.length) nodes.push({ id: 'autres', label: labels.other ?? 'Autres', problems: rest, children: [], total: rest.length, open: rest.filter(p => p.status === 'ouvert').length })
  return nodes
}

/** One-line summary of a closed node: counts and the most recent open titles. */
export function summaryOf(node, n = 2, empty = 'rien') {
  const all = []
  const walk = x => { all.push(...x.problems); x.children.forEach(walk) }
  walk(node)
  if (!all.length) return empty
  const uniq = [...new Set(all)].sort(byRank)
  return uniq.slice(0, n).map(p => `${p.id} ${p.title}`).join(' · ') + (uniq.length > n ? ` · +${uniq.length - n}` : '')
}

export function fmtAge(at, now) {
  if (!at) return '—'
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 90) return `${s} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  if (s < 129600) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} j`
}

export function fmtDate(at) {
  if (!at) return '—'
  const d = new Date(at)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Links worth a button: PR / MR URLs and #numbers in a text. */
export function linksOf(text) {
  return [...new Set(String(text ?? '').match(/https?:\/\/[^\s)\]"'>]+/g) ?? [])]
}
