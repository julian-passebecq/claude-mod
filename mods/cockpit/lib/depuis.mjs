// cockpit - « Depuis ton dernier message », pure (no $, no I/O, no imports; node --test mods/cockpit/tests/depuis.test.mjs).
// Julian (17 Oct): « I wake up and want the summary of the night: problems, blockages, progress ». One plain French
// headline, then one foldable group per project (most important first): PRs/MRs merged, CI still red, conversations
// finished or blocked, conversations waiting on Julian, Workflows finished or failed, new Problèmes, À toi items added or
// due soon, tokens and $ spent since; the Veille night summary when a night ran; and the text to paste into the VEILLE
// conversation (shown, never sent).
// The data comes from scanner/depuis.mjs (transcripts, app sessions, gh/glab cached, ci cache, problemes, a-faire,
// veille); the waiting rows (lib/core/waiting.mjs) and the Workflow runs come from what the pane already scanned.
// Every label, preset and threshold is in DEPUIS_DEFAULTS and can be overridden under `depuis` in cockpit.config.json.

const pad = (n) => String(n).padStart(2, '0')
const DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
export const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const fin = (v) => Number.isFinite(v)
const clip = (s, n) => { s = String(s ?? ''); return s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + '…' }
const fill = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`
const tms = (v) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : (fin(Date.parse(v)) ? Date.parse(v) : null))

export const DEPUIS_DEFAULTS = {
  enabled: true,
  // presets of the « depuis » row; `last` = Julian's last real message, `hours` = a sliding window, `at` = the most
  // recent HH:MM (local) before now. /cockpit depuis [8h|24h|nuit|HH:MM] picks one (any « Nh » or « HH:MM » works).
  default: 'last',
  presets: [
    { id: 'last', label: 'Ton dernier message', last: true },
    { id: '8h', label: '8 h', hours: 8 },
    { id: '24h', label: '24 h', hours: 24 },
    { id: 'nuit', label: 'Nuit', at: '22:00' },
  ],
  // a message younger than this is skipped (you just wrote « bonjour »: the night is before it)
  skip_recent_min: 10,
  lookback_days: 14, // no real message found in that many days: the 24 h preset
  fallback_hours: 24,
  due_soon_days: 3, // À toi items due within this many days
  // « CI rouge »: lanes whose newest run is red and ran inside the window, plus these branches whatever their age
  red_branches: ['main', 'master'],
  open_groups: 2, // the first N projects start unfolded
  max_lines: 8, // lines per kind and project before « + N »
  prs_ttl_s: 300, // gh / glab answers kept that long (~/.claude/effort-board/cockpit_depuis_prs.json)
  prs_limit: 100,
  gh: true,
  glab: true,
  session_link: 'claude://claude.ai/epitaxy/{id}',
  // the weight of each kind when ordering the projects (most important first)
  weights: { waiting: 100, red: 60, blocked: 50, wf_failed: 40, problem: 20, atoi: 15, merged: 5, finished: 3, wf_done: 2 },
  labels: {
    button: 'Depuis ton dernier message',
    title: 'Depuis ton dernier message',
    headline: 'Depuis {since} ({dur})',
    nothing: 'rien de nouveau',
    merged: '{n} PR mergée|{n} PR mergées',
    red: '{n} CI rouge|{n} CI rouges',
    waiting: '{n} conversation t’attend|{n} conversations t’attendent',
    blocked: '{n} bloquée|{n} bloquées',
    finished: '{n} conversation terminée|{n} conversations terminées',
    wf_failed: '{n} workflow en échec|{n} workflows en échec',
    problems: '{n} problème nouveau|{n} problèmes nouveaux',
    spent: '{usd} dépensés',
    last: 'ton dernier message : {when} dans « {title} »',
    last_none: 'aucun message de toi trouvé sur {days} j : fenêtre de {hours} h',
    since_preset: 'fenêtre : {label}',
    general: 'Général',
    kinds: {
      waiting: 'T’attend', red: 'CI rouge', blocked: 'Bloquée', wf_failed: 'Workflow en échec', problem: 'Problème', atoi: 'À toi',
      merged: 'Mergée', finished: 'Terminée', wf_done: 'Workflow terminé', cost: 'Dépensé',
    },
    red_line: '{app}{branch} rouge depuis {at}{jobs}',
    red_new: ' (nouveau)',
    merged_line: '{ref} {title} · {at}',
    finished_line: '{title} · {at}',
    waiting_line: '{what} · {title}',
    wf_line: '{name} · {at}{why}',
    problem_line: '{id} {title}',
    atoi_added: 'ajouté {at} : {title}',
    atoi_due: 'échéance {day} : {title}',
    cost_line: '{usd} · {tokens} tokens',
    more: '+ {n}',
    open: 'Ouvrir',
    copy_id: 'Copier l’id',
    copied: 'id copié : {id}',
    prs_error: 'PR non lues : {errors}',
    ci_none: 'CI : pas de cache du mod ci',
    ci_stale: 'CI : cache du mod ci lu à {at} (avant la fenêtre ; /ci le rafraîchit)',
    night: 'Nuit de la Veille',
    ask: 'Demander un résumé à VEILLE',
    ask_hint: 'À coller dans la conversation VEILLE (rien n’est envoyé).',
    ask_copy: 'Copier le texte',
    ask_text: 'VEILLE : résume-moi ce qui s’est passé depuis {since} ({dur}) : problèmes, blocages, avancées, par projet, et ce qui m’attend en premier. Repères du Cockpit : {headline}.',
    loading: 'lecture des transcripts, PR et caches…',
    refresh: '↻',
  },
}

function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a || {}) }
  for (const [k, v] of Object.entries(b)) {
    if (k.startsWith('_')) continue
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v
  }
  return out
}

export const depuisConfig = (cfg) => merge(DEPUIS_DEFAULTS, (cfg && cfg.depuis) || {})

// ---- Julian's real messages ----------------------------------------------------------------------------------------

const NOT_JULIAN = /^\s*<(system-reminder|ci-monitor-event|task-notification|local-command|command-name|command-message|command-args|user-prompt-submit-hook|bash-|tool_use_error)/

/**
 * Whether a parsed transcript line is a message Julian typed: a user line with plain-string content, not a tool result
 * (those are arrays), not meta / compact summary, not sent by another session (origin peer), a task notification, a
 * plugin's slash command, a ci-monitor event or a system reminder. Lines older than the `origin` field count when their
 * turnOrigin says human, or when they carry no origin hint at all.
 */
export function isJulianLine(o) {
  if (!o || o.type !== 'user' || o.isSidechain) return false
  const m = o.message
  const c = m && m.content
  if (typeof c !== 'string' || !c.trim()) return false
  if (o.isMeta || o.isCompactSummary || o.isVisibleInTranscriptOnly) return false
  if (NOT_JULIAN.test(c)) return false
  const kind = o.origin && o.origin.kind
  if (kind) return kind === 'human'
  if (o.turnOrigin) return o.turnOrigin === 'human'
  return !o.promptSource
}

// ---- the window ----------------------------------------------------------------------------------------------------

/** The most recent local HH:MM strictly before now (« 22:00 » at 07:00 = yesterday 22:00). */
export function lastAt(hhmm, nowMs) {
  const m = /^(\d{1,2})[:h](\d{2})$/.exec(String(hhmm || '').trim())
  if (!m) return null
  const d = new Date(nowMs)
  let t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(m[1]), Number(m[2])).getTime()
  if (t >= nowMs) t -= 86400000
  return t
}

/** A word of /cockpit depuis -> a preset: a preset id or label, « 8h », « 90min », « 23:12 », « 23h12 »; '' = default. */
export function parseWhen(arg, cfg) {
  const c = depuisConfig(cfg)
  const w = String(arg || '').trim().toLowerCase()
  const find = (id) => c.presets.find((p) => p && (String(p.id).toLowerCase() === id || String(p.label || '').toLowerCase() === id))
  if (!w) return find(String(c.default).toLowerCase()) || c.presets[0] || { id: 'last', last: true }
  const p = find(w) || (/^(dernier|last|message)$/.test(w) ? c.presets.find((x) => x.last) : null) || (/^(night|cette-nuit)$/.test(w) ? find('nuit') : null)
  if (p) return p
  let m = /^(\d{1,3})\s*h$/.exec(w)
  if (m) return { id: `${m[1]}h`, label: `${m[1]} h`, hours: Number(m[1]) }
  m = /^(\d{1,4})\s*min$/.exec(w)
  if (m) return { id: `${m[1]}min`, label: `${m[1]} min`, hours: Number(m[1]) / 60 }
  if (/^\d{1,2}[:h]\d{2}$/.test(w)) return { id: w.replace('h', ':'), label: w.replace('h', ':'), at: w.replace('h', ':') }
  return find(String(c.default).toLowerCase()) || c.presets[0]
}

/**
 * {since, source, label} for a preset. last = {ts, title, project} of Julian's last real message (or null).
 * source: last | hours | at | fallback.
 */
export function resolveSince(preset, nowMs, last, cfg) {
  const c = depuisConfig(cfg)
  const p = preset || parseWhen('', cfg)
  if (p.last) {
    if (last && fin(last.ts)) return { since: last.ts, source: 'last', label: p.label || 'last', last }
    return { since: nowMs - c.fallback_hours * 3600000, source: 'fallback', label: `${c.fallback_hours} h`, last: null }
  }
  if (fin(Number(p.hours)) && Number(p.hours) > 0) return { since: nowMs - Number(p.hours) * 3600000, source: 'hours', label: p.label || `${p.hours} h`, last }
  const at = p.at ? lastAt(p.at, nowMs) : null
  if (at) return { since: at, source: 'at', label: p.label || p.at, last }
  return { since: nowMs - c.fallback_hours * 3600000, source: 'fallback', label: `${c.fallback_hours} h`, last }
}

/** « 23:12 » the same day or the day before within 24 h, else « jeu 23:12 ». */
export function whenText(ms, nowMs) {
  return nowMs - ms < 20 * 3600000 ? hm(ms) : `${DAYS[new Date(ms).getDay()]} ${hm(ms)}`
}

export function durOf(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = m / 60
  return h < 10 ? `${Math.floor(h)} h${m % 60 ? ' ' + pad(m % 60) : ''}` : h < 72 ? `${Math.round(h)} h` : `${Math.round(h / 24)} j`
}

export function usd(x) {
  return !fin(x) ? '? $' : x >= 10 ? `${Math.round(x)} $` : `${x.toFixed(2).replace('.', ',')} $`
}

export function tokensText(n) {
  if (!fin(n)) return '?'
  return n >= 1e9 ? `${(n / 1e9).toFixed(1).replace('.', ',')} G` : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(Math.round(n))
}

// ---- CI still red --------------------------------------------------------------------------------------------------

const isRed = (x) => x && x.status === 'failed' && !x.allow_failure

/**
 * Lanes of the ci mod's pipelines cache whose newest run is still red: {app, project, branch, who, since (first red run
 * of the current red streak), jobs, fresh (the streak started inside the window)}. project = the app folder's name.
 */
export function stillRed(cache, sinceMs, branches = DEPUIS_DEFAULTS.red_branches) {
  if (!cache || !Array.isArray(cache.apps)) return { available: false, lanes: [] }
  const main = new Set((branches || []).map((b) => String(b).toLowerCase()))
  const lanes = []
  for (const a of cache.apps) {
    const project = String(a.path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || a.app || '?'
    const by = new Map()
    for (const r of a.runs || []) {
      const k = r.branch || '' // one lane per branch: a GitHub and a GitLab pipeline of the same branch are one line
      ;(by.get(k) || by.set(k, []).get(k)).push(r)
    }
    for (const runs of by.values()) {
      const done = runs.filter((r) => r.status !== 'running' && r.status !== 'queued' && r.status !== 'cancelled' && r.status !== 'skipped')
        .sort((x, y) => String(y.created || '').localeCompare(String(x.created || '')))
      if (!done.length || !isRed(done[0])) continue
      let first = done[0]
      for (const r of done) { if (isRed(r)) first = r; else break }
      const at = tms(first.created)
      const ranInWindow = (tms(done[0].created) || 0) >= sinceMs
      // an old branch nobody touched since is not news: only red streaks that started or ran again in the window,
      // and the default branches (red_branches) whatever their age
      if (!ranInWindow && !main.has(String(done[0].branch || '').toLowerCase())) continue
      lanes.push({ app: a.app || project, project, branch: done[0].branch || '', who: done[0].who || 'unknown', url: done[0].url || '',
        since: at, fresh: Boolean(at && at >= sinceMs), jobs: (done[0].jobs || []).filter(isRed).map((j) => j.name) })
    }
  }
  lanes.sort((x, y) => (y.since || 0) - (x.since || 0))
  return { available: true, generated: tms(cache.generated), lanes }
}

// ---- the model -----------------------------------------------------------------------------------------------------

const keyOf = (name) => String(name || '').toLowerCase()

/**
 * The screen. data = scanner/depuis.mjs output; extra = {waiting: waitingRows(...).rows, workflows: raw Workflow runs
 * ({project, name, status, start, end, last_activity})}. Returns {headline, sub, groups, general, night, ask, errors}.
 */
export function depuisModel(data, extra, cfg, nowMs) {
  const c = depuisConfig(cfg)
  const L = c.labels
  const d = data || {}
  const x = extra || {}
  const since = fin(d.since) ? d.since : nowMs - c.fallback_hours * 3600000
  const groups = new Map()
  const general = { name: L.general, items: [] }
  const group = (name) => {
    if (!name || name === '?') return general
    const k = keyOf(name)
    if (!groups.has(k)) groups.set(k, { name, items: [] })
    return groups.get(k)
  }
  const add = (name, kind, item) => group(name).items.push({ kind, ...item })
  const pl = (tpl, n) => { const [one, many] = String(tpl).split('|'); return fill(n > 1 ? many || one : one, { n }) }

  // PRs / MRs merged
  const merged = (d.merged || []).filter((p) => (tms(p.at) || 0) >= since)
  for (const p of merged) add(p.project, 'merged', { at: tms(p.at), url: p.url, text: fill(L.merged_line, { ref: `${p.repo || p.project}${p.forge === 'gitlab' ? '!' : '#'}${p.number}`, title: clip(p.title, 90), at: whenText(tms(p.at), nowMs) }) })
  // CI still red
  const reds = (d.red && d.red.lanes) || []
  for (const r of reds) add(r.project, 'red', { at: r.since, url: r.url, tone: 'bad', text: fill(L.red_line, { app: r.app, branch: r.branch ? ` (${clip(r.branch, 40)})` : '', at: r.since ? whenText(r.since, nowMs) : '?', jobs: r.jobs.length ? ` · ${r.jobs.slice(0, 3).join(', ')}` : '' }) + (r.fresh ? L.red_new : '') })
  // conversations finished or blocked
  const link = (sid) => (sid ? fill(c.session_link, { id: sid }) : null)
  let finished = 0
  let blocked = 0
  for (const s of d.conversations || []) {
    if ((s.at || 0) < since) continue
    const kind = s.state === 'blocked' ? 'blocked' : 'finished'
    if (kind === 'blocked') blocked += 1; else finished += 1
    add(s.project, kind, { at: s.at, sid: s.sid, cli: s.cli, link: link(s.sid), tone: kind === 'blocked' ? 'bad' : undefined,
      text: fill(L.finished_line, { title: clip(s.title || s.cli, 70), at: whenText(s.at, nowMs) }), detail: s.first ? clip(s.first, 160) : '' })
  }
  // waiting on Julian (lib/core/waiting.mjs rows: questions, wrap-ups that need an action, interrupted turns)
  const seen = new Set()
  for (const w of x.waiting || []) {
    if (!['ask', 'needs', 'awaiting'].includes(w.kind) || !w.session) continue
    const k = w.session.cli || w.session.sid
    if (seen.has(k)) continue
    seen.add(k)
    add(w.session.repo, 'waiting', { at: w.since, sid: w.session.sid, cli: w.session.cli, link: w.session.link, tone: 'warn', text: fill(L.waiting_line, { what: clip(w.what, 90), title: clip(w.session.title, 50) }) })
  }
  // Workflows finished or failed
  let wfFailed = 0
  for (const r of x.workflows || []) {
    if (!r || r.status === 'running') continue
    const end = tms(r.end) || tms(r.last_activity) || 0
    if (end < since) continue
    const failed = r.status !== 'completed'
    if (failed) wfFailed += 1
    add(r.project, failed ? 'wf_failed' : 'wf_done', { at: end, tone: failed ? 'bad' : undefined, text: fill(L.wf_line, { name: clip(r.name || r.run_id, 50), at: whenText(end, nowMs), why: failed ? ` · ${r.status}` : '' }) })
  }
  // new Problèmes
  const probs = (d.problems || []).filter((p) => (p.at || 0) >= since)
  for (const p of probs) add(p.project, 'problem', { at: p.at, tone: p.status === 'ouvert' ? 'warn' : undefined, text: fill(L.problem_line, { id: p.id, title: clip(p.title, 90) }) })
  // À toi: added since, or due soon
  const dueBy = nowMs + c.due_soon_days * 86400000
  const atoiSeen = new Set()
  for (const it of (d.atoi && d.atoi.items) || []) {
    if (atoiSeen.has(it.id)) continue
    const added = (it.since || 0) >= since
    const due = fin(it.due) && it.due <= dueBy
    if (!added && !due) continue
    atoiSeen.add(it.id)
    add(it.project, 'atoi', { at: it.since, tone: due ? 'warn' : undefined, text: due ? fill(L.atoi_due, { day: it.dueDay || new Date(it.due).toISOString().slice(0, 10), title: clip(it.title, 90) }) : fill(L.atoi_added, { at: whenText(it.since, nowMs), title: clip(it.title, 90) }) })
  }
  // tokens and $
  const cost = d.cost || null
  for (const [name, v] of Object.entries((cost && cost.byProject) || {})) {
    if (!v || !(v.usd > 0)) continue
    group(name).cost = v
  }

  const W = c.weights
  const out = [...groups.values()].map((g) => {
    const counts = {}
    for (const it of g.items) counts[it.kind] = (counts[it.kind] || 0) + 1
    const score = Object.entries(counts).reduce((a, [k, n]) => a + (W[k] || 1) * n, 0) + (g.cost ? Math.min(9, g.cost.usd / 10) : 0)
    return { ...g, counts, score }
  }).filter((g) => g.items.length || g.cost).sort((a, b) => b.score - a.score || (b.cost ? b.cost.usd : 0) - (a.cost ? a.cost.usd : 0) || a.name.localeCompare(b.name))
  const order = Object.keys(W).sort((a, b) => W[b] - W[a])
  const shape = (g) => {
    const kinds = order.filter((k) => g.counts[k]).map((k) => {
      const items = g.items.filter((it) => it.kind === k).sort((a, b) => (b.at || 0) - (a.at || 0))
      return { kind: k, title: L.kinds[k] || k, items: items.slice(0, c.max_lines), more: Math.max(0, items.length - c.max_lines) }
    })
    const bits = order.filter((k) => g.counts[k]).map((k) => `${L.kinds[k] || k} ${g.counts[k]}`)
    if (g.cost) bits.push(usd(g.cost.usd))
    const tone = g.counts.waiting || g.counts.red || g.counts.blocked || g.counts.wf_failed ? (g.counts.red || g.counts.blocked || g.counts.wf_failed ? 'bad' : 'warn') : null
    return { name: g.name, score: g.score || 0, kinds, summary: bits.join(' · '), tone, cost: g.cost ? fill(L.cost_line, { usd: usd(g.cost.usd), tokens: tokensText(g.cost.tokens) }) : '' }
  }
  const shaped = out.map(shape)
  const gen = general.items.length ? shape({ ...general, counts: general.items.reduce((a, it) => ({ ...a, [it.kind]: (a[it.kind] || 0) + 1 }), {}) }) : null

  // headline
  const nWaiting = seen.size
  const nRed = reds.length
  const parts = []
  if (merged.length) parts.push(pl(L.merged, merged.length))
  if (nRed) parts.push(pl(L.red, nRed))
  if (nWaiting) parts.push(pl(L.waiting, nWaiting))
  if (blocked) parts.push(pl(L.blocked, blocked))
  if (wfFailed) parts.push(pl(L.wf_failed, wfFailed))
  if (probs.length) parts.push(pl(L.problems, probs.length))
  if (finished && parts.length < 4) parts.push(pl(L.finished, finished))
  if (cost && fin(cost.usd)) parts.push(fill(L.spent, { usd: usd(cost.usd) }))
  const sinceText = whenText(since, nowMs)
  const dur = durOf(nowMs - since)
  const head = fill(L.headline, { since: sinceText, dur })
  const headline = `${head} : ${parts.length ? parts.join(', ') : L.nothing}`
  const sub = d.source === 'last' && d.last ? fill(L.last, { when: whenText(d.last.ts, nowMs), title: clip(d.last.title || d.last.project || '?', 50) })
    : d.source === 'fallback' ? fill(L.last_none, { days: c.lookback_days, hours: c.fallback_hours })
      : fill(L.since_preset, { label: d.label || '' })
  const errs = []
  if ((d.prsErrors || []).length) errs.push(fill(L.prs_error, { errors: d.prsErrors.join(' · ') }))
  if (d.red && d.red.available === false) errs.push(L.ci_none)
  else if (d.red && d.red.generated && d.red.generated < since) errs.push(fill(L.ci_stale, { at: whenText(d.red.generated, nowMs) }))
  const errors = errs.join(' · ')
  const night = d.night && Array.isArray(d.night.lines) && d.night.lines.length ? { title: L.night, lines: d.night.lines.slice(0, 20) } : null
  return {
    since, sinceText, dur, headline, sub, errors, groups: shaped, general: gen, night,
    counts: { merged: merged.length, red: nRed, waiting: nWaiting, blocked, finished, wfFailed, problems: probs.length, usd: cost ? cost.usd : null },
    ask: fill(L.ask_text, { since: sinceText, dur, headline: parts.length ? parts.join(', ') : L.nothing }),
    open: c.open_groups, labels: L,
  }
}
