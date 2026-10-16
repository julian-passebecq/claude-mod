// sante mod ("Santé des mods"): pure logic, no $ and no I/O, so node --test covers it directly.
// The scanner (scanner/sante_scan.mjs) gathers the file facts; the hook adds the session's commands and the engine
// version; evaluate() turns both into one row per mod with a level (ok / warn / error / off) and its reasons.

/** Deep merge of config objects (arrays and scalars of `b` replace). */
export function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice()
  if (!b || typeof b !== 'object') return b === undefined ? a : b
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v)
  return out
}

/** `~` to the home folder, forward slashes. */
export const expandHome = (p, home) => String(p || '').replace(/^~(?=[\\/]|$)/, home || '~').replace(/\\/g, '/')

/** `{name}` placeholders from `vars`. */
export const fill = (s, vars = {}) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])))

/**
 * CLAUDE_CODE_PLUGIN_DIRS as a list: `;` separates on Windows, `:` elsewhere (reference: plugins/mods/reference).
 * A value with no `;` that starts with a drive letter is one Windows path, not two.
 */
export function splitDirs(value) {
  const s = String(value || '').trim()
  if (!s) return []
  const parts = s.includes(';') ? s.split(';') : /^[A-Za-z]:[\\/]/.test(s) ? [s] : s.split(':')
  return parts.map(p => p.trim().replace(/^"|"$/g, '').replace(/\\/g, '/').replace(/\/+$/, '')).filter(Boolean)
}

/** Compares two versions by their first three numbers (2.1.287); undefined when one has none. */
export function cmpVersion(a, b) {
  const pa = String(a || '').match(/(\d+)\.(\d+)\.(\d+)/)
  const pb = String(b || '').match(/(\d+)\.(\d+)\.(\d+)/)
  if (!pa || !pb) return undefined
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/** Slash commands a hooks module registers: `$.command.register({ name: 'x' ...`. */
export function registeredCommands(source) {
  const out = []
  const re = /command\.register\(\s*\{[^}]*?\bname\s*:\s*['"`]([\w-]{1,64})['"`]/g
  const code = String(source || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
  for (const m of code.matchAll(re)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** Value at a dotted path (`meta.errors`). */
export function getPath(obj, path) {
  let v = obj
  for (const k of String(path || '').split('.').filter(Boolean)) {
    if (!v || typeof v !== 'object') return undefined
    v = v[k]
  }
  return v
}

/** Number with French separators: 1 234,5. */
export function fmtNum(v, digits = 0) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const s = Math.abs(v).toFixed(digits).replace('.', ',')
  const [i, d] = s.split(',')
  const out = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d ? `,${d}` : '')
  return v < 0 ? `-${out}` : out
}

/** Bytes as 12 o / 3,4 Ko / 1,2 Mo / 2,0 Go. */
export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} o`
  if (n < 1024 ** 2) return `${fmtNum(n / 1024, 1)} Ko`
  if (n < 1024 ** 3) return `${fmtNum(n / 1024 ** 2, 1)} Mo`
  return `${fmtNum(n / 1024 ** 3, 1)} Go`
}

/** A duration in ms as 850 ms / 2,3 s / 4 min / 3 h / 2 j. */
export function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60000) return `${fmtNum(ms / 1000, 1)} s`
  if (ms < 3600000) return `${Math.round(ms / 60000)} min`
  if (ms < 48 * 3600000) return `${Math.round(ms / 3600000)} h`
  return `${Math.round(ms / 86400000)} j`
}

/** « il y a 4 min » from a time (ms or ISO) and now. */
export function fmtAgo(t, now) {
  const ms = typeof t === 'string' ? Date.parse(t) : t
  if (!Number.isFinite(ms) || !ms) return 'jamais'
  return `il y a ${fmtDur(Math.max(0, now - ms))}`
}

/** A time (ms or ISO) as ms, or undefined. */
export const toMs = t => {
  const ms = typeof t === 'string' ? Date.parse(t) : t
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

/**
 * The shared health record (convention in mods/sante/README.md), as the next run writes it: last run, its duration,
 * CPU and error, the last success, and a rolling 24 h window (runs, CPU, duration) for the approximate CPU cost.
 * Reference implementation; band, usage, metrics, ci and machine carry their own few-line copy.
 */
export function nextHealth(prev, { mod, now, durationMs, cpuMs, error }, windowMs = 86400000) {
  const p = prev && typeof prev === 'object' ? prev : {}
  const start = toMs(p.window?.start)
  const w = start && now - start < windowMs ? p.window : { start: new Date(now).toISOString(), runs: 0, cpuMs: 0, durationMs: 0, errors: 0 }
  const iso = new Date(now).toISOString()
  return {
    mod,
    lastRun: iso,
    durationMs: Math.round(durationMs),
    cpuMs: Math.round(cpuMs),
    error: error ? String(error).slice(0, 500) : null,
    lastOk: error ? p.lastOk ?? null : iso,
    window: { start: w.start, runs: w.runs + 1, cpuMs: Math.round(w.cpuMs + cpuMs), durationMs: Math.round(w.durationMs + durationMs), errors: (w.errors || 0) + (error ? 1 : 0) },
  }
}

/** CPU cost of a health record's window: ms of CPU, its share of one core over the window, runs per hour. */
export function cpuCost(rec, now) {
  const start = toMs(rec?.window?.start)
  if (!start || !rec.window.runs) return undefined
  const span = Math.max(60000, now - start)
  return { cpuMs: rec.window.cpuMs || 0, corePct: ((rec.window.cpuMs || 0) / span) * 100, runsPerHour: (rec.window.runs / span) * 3600000, avgMs: (rec.window.durationMs || 0) / rec.window.runs, spanMs: span }
}

const RANK = { off: 0, ok: 1, warn: 2, error: 3 }
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a)

/** Commands of this session that belong to the plugin `name` (or to nobody while one of its own names matches). */
export function commandsOf(name, commands, expected = []) {
  return (commands || [])
    .filter(c => c.source === undefined || c.source === 'plugin')
    .filter(c => (c.plugin ? c.plugin === name || c.plugin.startsWith(`${name}@`) : expected.includes(c.name)))
    .map(c => c.name)
}

/**
 * One row per mod: the scanner's facts + this session's commands + the engine version → level and reasons.
 * report.mods[]: { key, name, dir, source: 'env' | 'dir' | 'marketplace' | 'health', exists, manifest, hooks, expected,
 *   configs[], caches[], logs[], fields[], health }
 */
export function evaluate(report, { commands = [], engine, cfg = {}, now = Date.now() } = {}) {
  const t = cfg.thresholds || {}
  const L = cfg.labels || {}
  const lab = (k, d, v) => fill(L[k] ?? d, v)
  const mods = (report && report.mods) || []
  const names = mods.map(m => m.name)
  const rows = mods.map(m => {
    const per = (cfg.mods || {})[m.name] || {}
    const reasons = []
    let level = 'ok'
    const add = (lv, text) => {
      level = worst(level, lv)
      reasons.push({ level: lv, text })
    }
    const expected = m.expected || []
    const cmds = commandsOf(m.name, commands, expected)
    const loaded = cmds.length > 0
    const inEnv = m.source === 'env'
    const minVersion = per.min_version || m.manifest?.min_version || cfg.default_min_version
    const cmp = engine ? cmpVersion(engine, minVersion) : undefined

    if (inEnv && !m.exists) add('error', lab('r_missing', 'dossier introuvable : {dir}', { dir: m.dir }))
    if (m.exists && m.manifest && !m.manifest.ok) add('error', lab('r_manifest', 'plugin.json illisible : {error}', { error: m.manifest.error }))
    if (m.exists && m.hooks && !m.hooks.ok) add('error', lab('r_hooks', 'hooks : {error}', { error: m.hooks.error }))
    for (const c of m.configs || []) if (!c.ok) add('error', lab('r_json', 'JSON invalide : {path} ({error})', { path: c.path, error: c.error }))
    if (cmp !== undefined && cmp < 0 && (inEnv || loaded)) add('error', lab('r_version', 'Claude Code {engine} < minimum {min}', { engine, min: minVersion }))
    if (inEnv && m.exists && expected.length && !loaded) add('warn', lab('r_not_loaded', 'dans CLAUDE_CODE_PLUGIN_DIRS mais aucune commande enregistrée (/{cmds}) : session ouverte avant ? hook session.start en erreur ?', { cmds: expected.join(', /') }))
    const missing = loaded ? expected.filter(c => !cmds.includes(c)) : []
    if (missing.length) add('warn', lab('r_cmd_missing', 'commande non enregistrée : /{cmds}', { cmds: missing.join(', /') }))
    if (names.filter(n => n === m.name).length > 1 && m.source !== 'health') add('warn', lab('r_dup', 'même nom chargé deux fois'))

    const h = m.health
    if (h && h.invalid) add('error', lab('r_health_json', 'fiche santé illisible : {error}', { error: h.invalid }))
    else if (h && h.error) {
      const age = now - (toMs(h.lastRun) || 0)
      if (age <= (t.health_error_hours ?? 24) * 3600000) add('error', lab('r_health_error', 'dernier scan en erreur ({ago}) : {error}', { ago: fmtAgo(h.lastRun, now), error: h.error }))
    }
    const staleMin = per.stale_min ?? null
    const newest = Math.max(0, ...(m.caches || []).map(c => c.newest || 0), toMs(h?.lastOk) || 0)
    if (staleMin && (inEnv || loaded) && newest && now - newest > staleMin * 60000) add('warn', lab('r_stale', 'pas rafraîchi depuis {ago} (attendu < {min} min)', { ago: fmtDur(now - newest), min: staleMin }))
    const warnBytes = (per.cache_warn_mb ?? t.cache_warn_mb ?? 500) * 1024 * 1024
    const big = (m.caches || []).filter(c => c.bytes > warnBytes)
    for (const c of big) add('warn', lab('r_big', 'cache lourd : {path} {size}', { path: c.path, size: fmtBytes(c.bytes) }))
    for (const l of m.logs || []) if (l.errors) add(per.log_level || 'warn', lab('r_log', '{n} erreur(s) dans {path} : {last}', { n: l.errors, path: l.path, last: l.last }))
    for (const f of m.fields || []) if (f.count) add('warn', lab('r_field', '{n} erreur(s) dans {path} → {field} : {last}', { n: f.count, path: f.path, field: f.field, last: f.last }))

    if (!inEnv && !loaded && level === 'ok') level = 'off'
    const cost = h && !h.invalid ? cpuCost(h, now) : undefined
    return {
      name: m.name,
      dir: m.dir,
      source: m.source,
      version: m.manifest?.version,
      loaded,
      inEnv,
      commands: cmds,
      expected,
      minVersion,
      level,
      reasons,
      lastRefresh: newest || undefined,
      health: h && !h.invalid ? h : undefined,
      cost,
      cacheBytes: (m.caches || []).reduce((s, c) => s + (c.bytes || 0), 0),
      caches: m.caches || [],
      configs: m.configs || [],
      cleanup: big.map(c => fill(cfg.cleanup_command || 'Remove-Item -LiteralPath "{path}" -Recurse', { path: c.path })),
    }
  })
  return { rows, summary: summarize(rows, { engine, report, cfg }) }
}

/** The single top line: worst level among the mods that should run, with counts and the first reasons. */
export function summarize(rows, { engine, report, cfg = {} } = {}) {
  const L = cfg.labels || {}
  const active = rows.filter(r => r.level !== 'off')
  const count = lv => active.filter(r => r.level === lv).length
  let level = active.reduce((a, r) => worst(a, r.level), 'ok')
  if (report && report.error) level = 'error'
  const bad = active.filter(r => r.level === 'error' || r.level === 'warn').sort((a, b) => RANK[b.level] - RANK[a.level])
  const first = bad.slice(0, cfg.summary_reasons ?? 2).map(r => `${r.name} : ${r.reasons.find(x => x.level === r.level)?.text ?? ''}`)
  const word = { ok: L.level_ok ?? 'vert', warn: L.level_warn ?? 'orange', error: L.level_error ?? 'rouge' }[level]
  const text = fill(L.summary ?? '{word} · {active} mods actifs : {ok} OK, {warn} orange, {error} rouge · {off} non chargés · Claude Code {engine}', {
    word, active: active.length, ok: count('ok'), warn: count('warn'), error: count('error'), off: rows.length - active.length, engine: engine || '?',
  })
  return { level, text: [text, ...first, ...(report && report.error ? [`scan : ${report.error}`] : [])].join(' · ') }
}
