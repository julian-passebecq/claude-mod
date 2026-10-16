// Registry logic of the tests-reels mod (« Tests réels »). Pure functions, no I/O: the pane, the CLI and the tests
// share them. Local data only (~/.claude/tests-reels): registry.json (curated), runs.jsonl (runs appended by agents),
// recovered.json (what the recovery scan found). Nothing here stores or returns a secret value.

export function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice()
  if (!b || typeof b !== 'object') return b === undefined ? a : b
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v)
  return out
}

/** `{name}` placeholders filled from `vars`; unknown ones kept. */
export function fill(s, vars = {}) {
  return String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])))
}

/** `~`, `%VAR%` and `$VAR` expanded; forward slashes. */
export function expand(p, env = {}) {
  let s = String(p || '')
  s = s.replace(/^~(?=[\\/]|$)/, env.HOME || env.USERPROFILE || '')
  s = s.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, k) => (env[k] ?? m))
  s = s.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, k) => (env[k] ?? m))
  return s.replace(/\\/g, '/')
}

export const unset = v => v == null || v === '' || /^<.*>$/.test(String(v))

export function fmtAge(then, now) {
  if (!then) return '—'
  const t = typeof then === 'number' ? then : Date.parse(then)
  if (!Number.isFinite(t)) return '—'
  const m = Math.max(0, (now - t) / 60000)
  if (m < 60) return `${Math.round(m)} min`
  if (m < 48 * 60) return `${Math.round(m / 60)} h`
  return `${Math.round(m / 1440)} j`
}

/** A login shown masked: `te•••@co•••` (e-mail) or `te•••`. */
export function mask(login, keep = 2) {
  const s = String(login || '')
  if (!s) return ''
  const part = x => (x.length <= keep ? '•'.repeat(Math.max(1, x.length)) : x.slice(0, keep) + '•••')
  const at = s.indexOf('@')
  return at > 0 ? `${part(s.slice(0, at))}@${part(s.slice(at + 1))}` : part(s)
}

/** An id shown short: first 8 characters then … */
export const shortId = (v, n = 8) => (String(v || '').length > n + 1 ? String(v).slice(0, n) + '…' : String(v || ''))

export const norm = s => String(s || '').trim().toLowerCase().replace(/[\s_-]+/g, '-')

/** Lines of runs.jsonl parsed; bad lines skipped. */
export function parseRuns(text) {
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r && r.app) out.push(r)
    } catch {}
  }
  return out
}

const RESULTS = ['pass', 'fail', 'partial', 'ran']
export const resultOf = r => (RESULTS.includes(r?.result) ? r.result : 'ran')
const dateOf = r => String(r?.date || r?.last || '')
const byDateDesc = (a, b) => dateOf(b).localeCompare(dateOf(a))

/** One app in the view: curated entry merged with its runs and what recovery found. */
function appView(name, cur, runs, rec, cfg) {
  const envs = (cur?.environments ?? []).map(e => ({ ...e, ids: e.ids ?? {}, urls: e.urls ?? [] }))
  const accounts = (cur?.accounts ?? []).map(a => ({ ...a }))
  const appRuns = runs.filter(r => norm(r.app) === norm(name)).sort(byDateDesc)
  const procs = (cur?.procedures ?? []).map(p => {
    const own = [...(p.runs ?? []), ...appRuns.filter(r => norm(r.procedure) === norm(p.name))].sort(byDateDesc)
    const last = own[0]
    return { ...p, runs: own, last, status: last ? resultOf(last) : 'never' }
  })
  const known = new Set(procs.map(p => norm(p.name)))
  const orphanRuns = appRuns.filter(r => !known.has(norm(r.procedure)))
  for (const r of orphanRuns) {
    let p = procs.find(x => x.undeclared && norm(x.name) === norm(r.procedure || '—'))
    if (!p) procs.push((p = { name: r.procedure || '—', env: r.env, undeclared: true, runs: [], status: 'never' }))
    p.runs.push(r)
    p.last = p.runs[0]
    p.status = resultOf(p.last)
  }
  const recovered = rec ?? null
  const recCommands = (recovered?.commands ?? []).slice().sort(byDateDesc)
  const lastRuns = [...appRuns].slice(0, cfg.max_runs ?? 8)
  const lastReal = appRuns[0] || null
  const todo = []
  for (const a of accounts) {
    if (!a.secret_ref || unset(a.secret_ref.target)) todo.push({ kind: 'secret_unknown', app: name, what: a.display || a.login || a.id || '?', env: a.env })
  }
  for (const e of envs) {
    const need = cfg.required_ids?.[e.kind] ?? []
    const missing = need.filter(k => unset(e.ids?.[k]) && !(k === 'url' && e.urls?.length))
    if (missing.length) todo.push({ kind: 'id_missing', app: name, what: `${e.name} : ${missing.join(', ')}`, env: e.name })
  }
  for (const s of recovered?.secrets ?? []) todo.push({ kind: 'secret_seen', app: name, what: s.kind, title: s.title, date: s.date, count: s.count ?? 1 })
  const neverReal = !lastReal && procs.every(p => p.status === 'never') && !recCommands.length
  return {
    name,
    repo: cur?.repo,
    notes: cur?.notes,
    curated: !!cur,
    environments: envs,
    accounts,
    procedures: procs,
    checks: [...(cur?.manual_checks ?? []), ...(recovered?.manual ?? [])].sort(byDateDesc),
    runs: lastRuns,
    lastRun: lastReal,
    recovered,
    recCommands,
    neverReal,
    todo,
  }
}

/** Summary line of an app, shown when its block is folded. */
export function appSummary(a, L = {}) {
  const parts = []
  parts.push(fill(L.sum_envs ?? '{n} env.', { n: a.environments.length }))
  parts.push(fill(L.sum_accounts ?? '{n} compte(s)', { n: a.accounts.length }))
  parts.push(fill(L.sum_procs ?? '{n} procédure(s)', { n: a.procedures.length }))
  if (a.lastRun) parts.push(fill(L.sum_last ?? 'dernier essai {date} {result}', { date: dateOf(a.lastRun).slice(0, 10), result: L[`result_${resultOf(a.lastRun)}`] ?? resultOf(a.lastRun) }))
  else if (a.neverReal) parts.push(L.never_real ?? 'jamais testé en réel')
  const r = a.recovered
  if (r) parts.push(fill(L.sum_recovered ?? 'historique : {s} session(s), {c} commande(s)', { s: (r.sessions ?? []).length, c: (r.commands ?? []).length }))
  if (a.todo.length) parts.push(fill(L.sum_todo ?? '{n} à ranger', { n: a.todo.length }))
  return parts.join(' · ')
}

/**
 * The whole view: apps sorted (curated first, then by evidence), totals and the « À ranger » list.
 * registry: { apps: [...] } · runs: parsed runs.jsonl · recovered: recovered.json ({ apps: { name: {...} } }).
 */
export function buildView(registry, runs, recovered, cfg = {}) {
  const cur = new Map()
  for (const a of registry?.apps ?? []) if (a?.name) cur.set(norm(a.name), a)
  const rec = new Map()
  for (const [name, r] of Object.entries(recovered?.apps ?? {})) rec.set(norm(name), { name, ...r })
  const names = new Map()
  for (const a of registry?.apps ?? []) if (a?.name) names.set(norm(a.name), a.name)
  for (const r of runs ?? []) if (r?.app && !names.has(norm(r.app))) names.set(norm(r.app), r.app)
  const minHits = cfg.recovery?.min_hits_to_list ?? 1
  for (const [k, r] of rec) {
    const hits = (r.sessions ?? []).length + (r.commands ?? []).length + (r.manual ?? []).length + (r.ids ?? []).length
    if (!names.has(k) && hits >= minHits) names.set(k, r.name)
  }
  const apps = [...names].map(([k, name]) => appView(name, cur.get(k), runs ?? [], rec.get(k), cfg))
  const weight = a => (a.curated ? 1e9 : 0) + (a.lastRun ? 1e6 : 0) + (a.recovered ? (a.recovered.sessions?.length ?? 0) * 10 + (a.recovered.commands?.length ?? 0) : 0)
  apps.sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name))
  const todo = apps.flatMap(a => a.todo)
  // secrets seen in sessions of an app that is not listed (no test evidence) still go to « À ranger »
  for (const [k, r] of rec) {
    if (names.has(k)) continue
    for (const s of r.secrets ?? []) todo.push({ kind: 'secret_seen', app: r.name, what: s.kind, title: s.title, date: s.date, count: s.count ?? 1 })
  }
  const rank = { secret_unknown: 0, id_missing: 1, secret_seen: 2 }
  todo.sort((a, b) => rank[a.kind] - rank[b.kind] || String(b.date || '').localeCompare(String(a.date || '')))
  const totals = {
    apps: apps.length,
    environments: apps.reduce((n, a) => n + a.environments.length, 0),
    accounts: apps.reduce((n, a) => n + a.accounts.length, 0),
    procedures: apps.reduce((n, a) => n + a.procedures.length, 0),
    runs: (runs ?? []).length,
    never: apps.filter(a => a.neverReal).length,
    todo: todo.length,
    secrets_seen: todo.filter(t => t.kind === 'secret_seen').reduce((n, t) => n + (t.count ?? 1), 0),
  }
  return { apps, todo, totals, recoveredAt: recovered?.generated ?? null, registryAt: registry?.updated ?? null, recoveryCounts: recovered?.counts ?? null }
}

/** One « À ranger » line in French. */
export function todoLine(t, L = {}) {
  if (t.kind === 'secret_seen') return fill(L.todo_secret_seen ?? '{app} · {what} vu dans la session « {title} » le {date} ({count}×) : à ranger dans le Gestionnaire d\'identification', { ...t, date: String(t.date || '').slice(0, 10) })
  if (t.kind === 'secret_unknown') return fill(L.todo_secret_unknown ?? '{app} · {what} : secret non enregistré, à ranger dans le Gestionnaire d\'identification Windows', t)
  return fill(L.todo_id_missing ?? '{app} · id manquant : {what}', t)
}

// ---- writes (used by cli.mjs): pure transforms of the registry object -------------------------------------------

const ENV_KINDS = ['tenant', 'cloud', 'local', 'docker']
const PROC_KINDS = ['live', 'local', 'docker', 'ui', 'manual']

export function ensureApp(reg, name, extra = {}) {
  if (!name) throw new Error('--app manquant')
  reg.apps ??= []
  let a = reg.apps.find(x => norm(x.name) === norm(name))
  if (!a) reg.apps.push((a = { name, environments: [], accounts: [], procedures: [], manual_checks: [] }))
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) a[k] = v
  a.environments ??= []
  a.accounts ??= []
  a.procedures ??= []
  a.manual_checks ??= []
  return a
}

const upsert = (list, item, key = 'name') => {
  const i = list.findIndex(x => norm(x[key]) === norm(item[key]))
  if (i >= 0) list[i] = { ...list[i], ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)) }
  else list.push(item)
  return list[i >= 0 ? i : list.length - 1]
}

export function addEnv(reg, o, today) {
  if (!o.name) throw new Error('--name manquant')
  if (o.kind && !ENV_KINDS.includes(o.kind)) throw new Error(`--kind : ${ENV_KINDS.join(' | ')}`)
  const a = ensureApp(reg, o.app)
  return upsert(a.environments, { name: o.name, kind: o.kind, urls: o.urls, ids: o.ids, owner: o.owner, status: o.status ?? 'actif', notes: o.notes, created: o.created ?? today })
}

export function addAccount(reg, o) {
  if (!o.login && !o.display) throw new Error('--login ou --display manquant')
  const a = ensureApp(reg, o.app)
  const secret_ref = o.secret_store || o.secret_target ? { store: o.secret_store || 'wincred', target: o.secret_target || '' } : undefined
  return upsert(a.accounts, { login: o.login, display: o.display, env: o.env, purpose: o.purpose, dedicated: o.dedicated ?? true, secret_ref }, o.login ? 'login' : 'display')
}

export function addProcedure(reg, o) {
  if (!o.name) throw new Error('--name manquant')
  if (o.kind && !PROC_KINDS.includes(o.kind)) throw new Error(`--kind : ${PROC_KINDS.join(' | ')}`)
  const a = ensureApp(reg, o.app)
  return upsert(a.procedures, { name: o.name, env: o.env, account: o.account, kind: o.kind, steps: o.steps, commands: o.commands, expected: o.expected, evidence: o.evidence })
}

export function addCheck(reg, o, today) {
  if (!o.what) throw new Error('--what manquant')
  const a = ensureApp(reg, o.app)
  const c = { date: o.date ?? today, what: o.what, how: o.how, status: o.status ?? 'à faire' }
  a.manual_checks.push(c)
  return c
}

export function runRecord(o, nowIso) {
  if (!o.app) throw new Error('--app manquant')
  if (!o.procedure) throw new Error('--procedure manquant')
  if (!['pass', 'fail', 'partial'].includes(o.result)) throw new Error('--result : pass | fail | partial')
  return { date: o.date ?? nowIso, app: o.app, env: o.env, procedure: o.procedure, result: o.result, evidence: o.evidence ?? [], note: o.note, session: o.session, by: o.by }
}
