// Recovery logic of the tests-reels mod: what a line of a transcript or a document says about a real (non-CI) test.
// Pure functions, no I/O (scanner/recover.mjs reads the files). Secret values are never kept: only their kind is
// counted, and every text kept goes through redact() first.
import { findSecrets, redact, stripUrl } from './secrets.mjs'

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const rx = (s, f = 'i') => new RegExp(s, f)

/** Compiled patterns from the `recovery` section of the config. */
export function compile(rc = {}) {
  const cats = Object.entries(rc.categories ?? {}).map(([id, c]) => ({ id, label: c.label ?? id, rx: rx(c.pattern) }))
  const any = cats.length ? rx(cats.map(c => `(?:${c.rx.source})`).join('|')) : /$^/
  return {
    cats,
    any,
    real: rx(rc.real_markers ?? 'tenant|live|réel|real'),
    command: rx(rc.command_pattern ?? '$^'),
    idRx: new RegExp(`\\b(${rc.id_context ?? 'tenant|workspace'})[ _-]?(?:id)?["'\\s:=]{0,8}(${GUID})`, 'gi'),
    urlRx: new RegExp(`https?://[^\\s"'<>\\\\)\\]]*(?:${(rc.url_hosts ?? ['\\.workers\\.dev']).join('|')})[^\\s"'<>\\\\)\\]]*`, 'gi'),
    accountRx: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g,
    accountCtx: rx(rc.account_context ?? 'test|account|compte|login'),
    ignoreAccounts: (rc.ignore_accounts ?? []).map(s => rx(s)),
    workspaceRx: /\bworkspace\s+(?:named\s+|nommé\s+|appelé\s+)?["«“']([^"»”'\n]{3,60})["»”']/gi,
    aliases: (rc.app_aliases ?? []).map(a => ({ app: a.app, rx: rx(a.pattern) })),
    mentionMax: rc.mention_chars ?? 180,
  }
}

/** Categories (fabric, cloudflare, …) named in `text`. */
export function categoriesOf(text, P) {
  if (!P.any.test(text)) return []
  return P.cats.filter(c => c.rx.test(text)).map(c => c.id)
}

/** Repo / app name from a session cwd: worktrees count as their repo. */
export function appFromCwd(cwd) {
  const s = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!s) return ''
  const wt = s.match(/^(.*?)\/\.claude\/worktrees\/[^/]+/)
  const base = (wt ? wt[1] : s).split('/').filter(Boolean)
  return base[base.length - 1] || ''
}

/** App from a ~/.claude/projects folder name (C--code-demo-app--claude-worktrees-x → demo-app): drive and first folder dropped. */
export function appFromFolder(name) {
  const s = String(name || '').replace(/--claude-worktrees-.*$/, '')
  const m = s.match(/^[A-Za-z]--[^-]+-(.+)$/)
  return m ? m[1] : s
}

/** App for a hit: a configured alias whose pattern the text matches wins, else the given default. */
export function appFor(text, fallback, P) {
  for (const a of P.aliases) if (a.rx.test(text)) return a.app
  return fallback
}

/**
 * Everything one piece of text says. `role` is text | command | result. Returns null when nothing relevant.
 * Values kept: ids (GUIDs next to a context word), URLs (query and fragment removed), test-account logins,
 * workspace names, a redacted snippet. Secrets: kinds only.
 */
export function extract(text, role, P) {
  const s = String(text || '')
  if (!s) return null
  const secrets = findSecrets(s)
  const cats = categoriesOf(s, P)
  if (!cats.length) return secrets.length ? { cats: [], secrets } : null
  const out = { cats, secrets, ids: [], urls: [], accounts: [], workspaces: [], command: null, mention: null }
  P.idRx.lastIndex = 0
  for (const m of s.matchAll(P.idRx)) out.ids.push({ kind: m[1].toLowerCase().replace(/\s+/g, '_'), value: m[2].toLowerCase() })
  P.urlRx.lastIndex = 0
  for (const m of s.matchAll(P.urlRx)) out.urls.push(stripUrl(m[0]))
  P.accountRx.lastIndex = 0
  for (const m of s.matchAll(P.accountRx)) {
    const login = m[0]
    if (P.ignoreAccounts.some(r => r.test(login))) continue
    const around = s.slice(Math.max(0, m.index - 60), m.index + login.length + 60)
    if (P.accountCtx.test(around)) out.accounts.push(login)
  }
  P.workspaceRx.lastIndex = 0
  for (const m of s.matchAll(P.workspaceRx)) if (!findSecrets(m[1]).length) out.workspaces.push(m[1].trim())
  if (role === 'command' && P.command.test(s)) {
    const c = redact(s.split(/\r?\n/).filter(Boolean).slice(0, 3).join(' ; '))
    if (!findSecrets(c).length) out.command = c.length > 300 ? c.slice(0, 299) + '…' : c
  }
  if (role === 'text' && P.real.test(s)) {
    const i = s.search(P.real)
    const from = Math.max(0, i - Math.floor(P.mentionMax / 2))
    const snip = redact(s.slice(from, from + P.mentionMax).replace(/\s+/g, ' ').trim())
    if (!findSecrets(snip).length) out.mention = (from > 0 ? '…' : '') + snip
  }
  return out
}

/** Empty per-app aggregate. */
export const newApp = () => ({ categories: {}, sessions: {}, commands: {}, ids: {}, urls: {}, accounts: {}, workspaces: {}, secrets: {}, mentions: [], manual: [] })

const bump = (map, key, date, extra = {}) => {
  const cur = map[key] ?? (map[key] = { count: 0, first: date, last: date, ...extra })
  cur.count++
  if (date && (!cur.first || date < cur.first)) cur.first = date
  if (date && (!cur.last || date > cur.last)) { cur.last = date; Object.assign(cur, extra) }
  return cur
}

/** Adds one extract() result to `agg` (apps map). ctx: { app, session, title, date, toolId }. */
export function addHit(agg, hit, ctx, limits = {}) {
  if (!hit) return
  const a = agg[ctx.app] ?? (agg[ctx.app] = newApp())
  const d = ctx.date || ''
  for (const k of hit.secrets) bump(a.secrets, `${ctx.session}|${k}`, d, { kind: k, session: ctx.session, title: ctx.title })
  if (!hit.cats.length) return
  for (const c of hit.cats) a.categories[c] = (a.categories[c] ?? 0) + 1
  const s = bump(a.sessions, ctx.session, d, { title: ctx.title })
  s.cats = [...new Set([...(s.cats ?? []), ...hit.cats])]
  for (const i of hit.ids) bump(a.ids, `${i.kind}|${i.value}`, d, { kind: i.kind, value: i.value })
  for (const u of hit.urls) bump(a.urls, u, d, { url: u })
  for (const l of hit.accounts) bump(a.accounts, l.toLowerCase(), d, { login: l, title: ctx.title })
  for (const w of hit.workspaces) bump(a.workspaces, w, d, { name: w })
  if (hit.command) {
    const c = bump(a.commands, hit.command, d, { cmd: hit.command, cats: hit.cats, session: ctx.session, title: ctx.title })
    c.errors ??= 0
    if (ctx.toolId) c.tool_ids = [...(c.tool_ids ?? []), ctx.toolId].slice(-50)
  }
  if (hit.mention && a.mentions.length < (limits.mentions ?? 30)) a.mentions.push({ text: hit.mention, date: d, title: ctx.title, session: ctx.session })
}

/** A tool result with is_error true counts against the command that ran it. */
export function addError(agg, app, toolId) {
  const a = agg[app]
  if (!a) return
  for (const c of Object.values(a.commands)) if (c.tool_ids?.includes(toolId)) c.errors = (c.errors ?? 0) + 1
}

/** Merges a per-file aggregate into the total (the scan caches one aggregate per file). */
export function mergeAgg(into, from, limits = {}) {
  for (const [app, a] of Object.entries(from ?? {})) {
    const t = into[app] ?? (into[app] = newApp())
    for (const [c, n] of Object.entries(a.categories ?? {})) t.categories[c] = (t.categories[c] ?? 0) + n
    for (const k of ['sessions', 'commands', 'ids', 'urls', 'accounts', 'workspaces', 'secrets']) {
      for (const [key, v] of Object.entries(a[k] ?? {})) {
        const cur = t[k][key]
        if (!cur) t[k][key] = { ...v }
        else {
          const later = String(v.last || '') > String(cur.last || '')
          t[k][key] = { ...(later ? { ...cur, ...v } : { ...v, ...cur }), count: cur.count + v.count, first: [cur.first, v.first].filter(Boolean).sort()[0], last: [cur.last, v.last].filter(Boolean).sort().pop() }
          if (k === 'commands') t[k][key].errors = (cur.errors ?? 0) + (v.errors ?? 0)
          if (k === 'sessions') t[k][key].cats = [...new Set([...(cur.cats ?? []), ...(v.cats ?? [])])]
        }
      }
    }
    t.mentions.push(...(a.mentions ?? []))
    t.mentions = t.mentions.sort((x, y) => String(x.date).localeCompare(String(y.date))).slice(-(limits.mentions ?? 30))
    t.manual.push(...(a.manual ?? []))
  }
  return into
}

/** One line of effort-board/manual-checks.md: `date · project · what · how`. */
export function parseManualLine(line) {
  const raw = String(line || '').trim()
  if (!/^(~~)?\d{4}-\d{2}-\d{2}\s·/.test(raw)) return null
  const struck = raw.startsWith('~~')
  const [main, after = ''] = raw.replace(/^~~/, '').split('~~')
  const parts = main.split(' · ').map(x => x.trim())
  const [date, project = '', what = '', ...how] = parts
  const tail = (after || '').trim()
  const done = /\bDONE\b|\bfait\b/i.test(raw)
  const status = struck ? (tail || 'barré') : done ? 'fait' : 'à faire'
  return { date, app: project.split(/\s+/)[0], project, what: redact(what), how: redact(how.join(' · ')), status }
}

/** Final shape written to recovered.json: maps turned into sorted, capped lists; titles resolved. */
export function finalize(agg, titles = {}, limits = {}) {
  const cap = limits.per_list ?? 40
  const list = (m, by = 'last') => Object.values(m).sort((a, b) => String(b[by] || '').localeCompare(String(a[by] || ''))).slice(0, cap)
  const out = {}
  for (const [app, a] of Object.entries(agg)) {
    if (!app) continue
    const t = id => titles[id] || null
    out[app] = {
      categories: a.categories,
      sessions: Object.entries(a.sessions)
        .map(([id, s]) => ({ id, title: s.title || t(id) || String(id).slice(0, 8), date: s.last, first: s.first, hits: s.count, cats: s.cats }))
        .sort((x, y) => String(y.date).localeCompare(String(x.date)))
        .slice(0, cap),
      commands: list(a.commands).map(c => ({ cmd: c.cmd, cats: c.cats, count: c.count, errors: c.errors ?? 0, first: c.first, date: c.last, session: c.session, title: c.title || t(c.session) })),
      ids: list(a.ids).map(i => ({ kind: i.kind, value: i.value, count: i.count, date: i.last })),
      urls: list(a.urls).map(u => ({ url: u.url, count: u.count, date: u.last })),
      accounts: list(a.accounts).map(x => ({ login: x.login, count: x.count, date: x.last, title: x.title })),
      workspaces: list(a.workspaces).map(w => ({ name: w.name, count: w.count, date: w.last })),
      secrets: list(a.secrets).map(s => ({ kind: s.kind, session: s.session, title: s.title || t(s.session) || String(s.session).slice(0, 8), date: s.last, count: s.count })),
      mentions: a.mentions.slice(-(limits.mentions ?? 30)).map(m => ({ ...m, title: m.title || t(m.session) })),
      manual: a.manual,
    }
  }
  return out
}

/** Counts only (what the scan prints). Works on the aggregate (maps, before caps) and on finalize()'s lists. */
export function counts(apps) {
  const v = Object.values(apps)
  const len = x => (Array.isArray(x) ? x.length : Object.keys(x ?? {}).length)
  const sum = k => v.reduce((n, a) => n + len(a[k]), 0)
  return {
    apps: v.length,
    sessions: sum('sessions'),
    commands: sum('commands'),
    ids: sum('ids'),
    urls: sum('urls'),
    accounts: sum('accounts'),
    workspaces: sum('workspaces'),
    mentions: sum('mentions'),
    manual: sum('manual'),
    secrets_seen: v.reduce((n, a) => n + Object.values(a.secrets ?? {}).reduce((m, s) => m + (s.count ?? 1), 0), 0),
  }
}
