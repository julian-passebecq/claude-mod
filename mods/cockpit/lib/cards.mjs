// cockpit - summary cards, pure (no $, no I/O, no imports; node --test mods/cockpit/tests/cards.test.mjs).
// One card per topic, one line each, with the command its button runs (the first candidate loaded in the session):
//   Qui consomme · T'attend · À toi · Claude Control · CI · Quota · Problèmes du jour · En cours
// Claude only by default (cards.who 'claude'): CI, Quota and En cours count Claude's pipelines and quota; the « Codex »
// button on the home tab (or cards.who 'all') adds Codex's.
// Helpers kept here because lib/core lacks them (cockpit-hub, 16 Oct): ciSummary (the ci mod's Diagramme sentence from
// its pipelines cache, Claude / Codex split), pipelinesLive (running pipelines + ETA), problemsToday (the problemes
// register.jsonl, read-only). The figures themselves come from lib/core through scanner/cards.mjs (usage, veille,
// runner, estimate), so band, cockpit and usage print the same numbers.

const DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
const fin = (v) => Number.isFinite(v)
const pad = (n) => String(n).padStart(2, '0')

export const hm = (ms) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const dayHm = (ms) => `${DAYS[new Date(ms).getDay()]} ${hm(ms)}`

const tms = (v) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : (Number.isFinite(Date.parse(v)) ? Date.parse(v) : null))

export const durText = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h ${pad(m % 60)}` : `${Math.floor(h / 24)} j`
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`

export const CARD_DEFAULTS = {
  order: ['conso', 'attend', 'atoi', 'controle', 'ci', 'quota', 'problemes', 'encours'],
  enabled: ['conso', 'attend', 'atoi', 'controle', 'ci', 'quota', 'problemes', 'encours'],
  max_encours: 4,
  who: 'claude',
  // Button targets: the first command loaded in this session wins (the hub's new name first, the old mod as fallback).
  buttons: {
    conso: [{ command: 'conso', args: 'classement' }],
    attend: [{ command: 'veille', args: 'fil' }],
    atoi: [{ command: 'afaire' }],
    controle: [{ command: 'afaire' }],
    ci: [{ command: 'reference', args: 'ci diagramme' }, { command: 'ci', args: 'diagramme' }],
    quota: [{ command: 'conso' }],
    problemes: [{ command: 'registres', args: 'problemes' }, { command: 'problemes' }],
    encours: [{ tab: 'workflow' }],
  },
  labels: {
    conso: 'Qui consomme', attend: 'T’attend', atoi: 'À toi', controle: 'Claude Control', ci: 'CI', quota: 'Quota', problemes: 'Problèmes du jour', encours: 'En cours',
    open: 'Voir', none: 'rien', codex_on: 'Codex ✓', codex_off: 'Codex', unknown: 'non lu', not_loaded: '{command} non chargé : ajoute son mod à CLAUDE_CODE_PLUGIN_DIRS',
  },
}

// ---- CI: the ci mod's pipelines cache -----------------------------------------------------------------------------

const isRed = (x) => x && x.status === 'failed' && !x.allow_failure
const runsOf = (cache) => ((cache && cache.apps) || []).flatMap((a) => (a.runs || []).map((r) => ({ ...r, app: r.app || a.app })))
const live = (r) => r.status === 'running' || r.status === 'queued'

/**
 * The ci Diagramme's sentence data from ~/.claude/ci-pipelines-cache.json: running pipelines split by author
 * (claude / codex / unknown), red lanes (newest run of each lane failed) with their red jobs, the runner queue.
 */
export function ciSummary(cache, who = 'all') {
  if (!cache || !Array.isArray(cache.apps)) return { available: false }
  const runs = runsOf(cache).filter((r) => who === 'all' || r.who === who)
  const running = { claude: 0, codex: 0, unknown: 0, total: 0 }
  for (const r of runs.filter(live)) { running[r.who === 'claude' || r.who === 'codex' ? r.who : 'unknown'] += 1; running.total += 1 }
  const lastOf = new Map()
  for (const r of runs) {
    const k = `${r.app}|${r.backend}`
    const cur = lastOf.get(k)
    if (!cur || String(r.created || '') > String(cur.created || '')) lastOf.set(k, r)
  }
  const reds = [...lastOf.values()].filter(isRed).sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')))
    .map((r) => ({ app: r.app, who: r.who || 'unknown', jobs: (r.jobs || []).filter(isRed).map((j) => j.name) }))
  return { available: true, who, generated: tms(cache.generated), running, reds, queue: (cache.summary && cache.summary.queue) || null }
}

/** « 2 pipelines en cours (Claude 1 · Codex 1), 1 rouge dans app (job lint), runner local à 3/18 ». */
export function ciSentence(ci, runnerText = '') {
  if (!ci || !ci.available) return ''
  const r = ci.running
  const split = r.total && (!ci.who || ci.who === 'all') ? ` (${[['Claude', r.claude], ['Codex', r.codex], ['inconnu', r.unknown]].filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ')})` : ''
  const by = ci.who === 'claude' ? ' Claude' : ci.who === 'codex' ? ' Codex' : ''
  const parts = [r.total ? `${plural(r.total, 'pipeline', 'pipelines')}${by} en cours${split}` : `aucun pipeline${by} en cours`]
  if (ci.reds.length) {
    const x = ci.reds[0]
    const jobs = x.jobs.length ? ` (job${x.jobs.length > 1 ? 's' : ''} ${x.jobs.slice(0, 2).join(', ')}${x.jobs.length > 2 ? '…' : ''})` : ''
    const more = ci.reds.length > 1 ? ` et ${plural(ci.reds.length - 1, 'autre', 'autres')}` : ''
    parts.push(`${plural(ci.reds.length, 'rouge', 'rouges')} dans ${x.app}${jobs}${more}`)
  } else parts.push('aucun rouge')
  if (runnerText) parts.push(runnerText)
  return parts.join(', ')
}

/**
 * Running pipelines with an ETA: the ci scanner's own estimate when it has one (median of past jobs or pipelines),
 * else `estimateOf` (lib/core/estimate.mjs, passed in) over the lane's past successful durations; else none.
 * Returns [{app, who, branch, startMs, eta: {mid, lo, hi, overrun} | null, basis}], newest first.
 */
export function pipelinesLive(cache, nowMs, estimateOf, etaOf) {
  const runs = runsOf(cache)
  return runs.filter(live).sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))).map((r) => {
    const start = tms(r.created) || nowMs
    const given = r.estimate && tms(r.estimate.eta)
    let eta = given ? { mid: given, lo: given, hi: given, overrun: given <= nowMs } : null
    let basis = given ? 'ci' : null
    if (!eta && estimateOf && etaOf) {
      const past = runs.filter((x) => x.app === r.app && x.backend === r.backend && x.status === 'success' && fin(x.duration_s)).map((x) => x.duration_s * 1000)
      const e = etaOf(estimateOf(past), start, nowMs)
      if (e) { eta = e; basis = 'core' }
    }
    return { app: r.app, who: r.who || 'unknown', branch: r.branch || '', title: r.title || '', startMs: start, eta, basis }
  })
}

// ---- Problèmes: register.jsonl (append-only ledger of the problemes mod) ------------------------------------------

/** Problems seen today (local midnight on): count, open ones, and the top by occurrences today. */
export function problemsToday(lines, nowMs) {
  const d = new Date(nowMs)
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const map = new Map()
  for (const l of lines || []) {
    if (!l || !l.id) continue
    if (l.op === 'add') {
      if (!map.has(l.id)) map.set(l.id, { id: l.id, title: l.title || l.id, status: l.status || 'ouvert', today: 0 })
      const at = tms(l.last_seen ?? l.at)
      if (at && at >= midnight) map.get(l.id).today += Math.max(1, Number(l.count) || 1)
      continue
    }
    const p = map.get(l.id)
    if (!p) continue
    if (l.op === 'seen') {
      const at = tms(l.last ?? l.at)
      if (at && at >= midnight) p.today += Math.max(1, Number(l.n) || 1)
    } else if (l.op === 'update' && l.fields && l.fields.status) p.status = l.fields.status
  }
  const today = [...map.values()].filter((p) => p.today > 0).sort((a, b) => b.today - a.today)
  return { available: true, total: map.size, today: today.length, open: today.filter((p) => p.status === 'ouvert').length, top: today[0] || null }
}

// ---- the cards ------------------------------------------------------------------------------------------------------

function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a || {}) }
  for (const [k, v] of Object.entries(b)) {
    if (k.startsWith('_')) continue
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v
  }
  return out
}

export const cardsConfig = (cfg) => merge(CARD_DEFAULTS, (cfg && cfg.cards) || {})

const pctText = (w) => (w ? `${Math.round(w.pct)} %` : '?')

/** « 5 h 24 % · semaine 41 % · épuisé ven 14:00 » for one provider (lib/core/usage.mjs windows). */
export function quotaText(p) {
  if (!p || (!p.five && !p.week)) return ''
  const bits = [`5 h ${pctText(p.five)}`, `semaine ${pctText(p.week)}`]
  const out = [p.five, p.week].filter((w) => w && w.runOutAt).sort((a, b) => a.runOutAt - b.runOutAt)[0]
  if (out) bits.push(`épuisé ${dayHm(out.runOutAt)}`)
  return bits.join(' · ')
}

/** The running Workflows of factory's workflowScreen (runs with live true): « name : sentence ». */
export function workflowsLive(screen) {
  return ((screen && screen.runs) || []).filter((v) => v.live).map((v) => ({
    kind: 'workflow', name: v.name, sentence: v.sentence || '',
    eta: v.estimate && v.estimate.enough && v.estimate.eta ? v.estimate.eta : null,
  }))
}

/** One plain sentence per running thing, with its ETA (or « pas assez d'historique »). */
export function encoursItems(workflows, pipelines, nowMs, max = 4, lone = []) {
  const items = []
  for (const w of workflows || []) {
    items.push({ kind: 'workflow', text: `Workflow ${w.name}${w.eta ? ` : fin vers ${hm(w.eta.mid)}` : ' : fin inconnue (pas assez d’historique)'}`, detail: w.sentence })
  }
  for (const a of lone || []) {
    const eta = !a.eta ? 'fin inconnue (pas assez d’historique)' : a.eta.overrun ? 'au-delà de l’habituel' : `fin vers ${hm(a.eta.mid)}`
    items.push({ kind: 'agent', text: `Agent ${a.type}${a.desc ? ` · ${clip(a.desc, 40)}` : ''}${a.bg ? ' (arrière-plan)' : ''}, depuis ${durText(nowMs - a.start)} : ${eta}` })
  }
  for (const p of pipelines || []) {
    const who = p.who === 'codex' ? 'Codex' : p.who === 'claude' ? 'Claude' : ''
    const head = `Pipeline ${p.app}${p.branch ? ` (${p.branch})` : ''}${who ? ` · ${who}` : ''}, depuis ${durText(nowMs - p.startMs)}`
    const eta = !p.eta ? 'fin inconnue (pas assez d’historique)' : p.eta.overrun ? 'au-delà de l’estimation' : `vert ou rouge vers ${hm(p.eta.mid)}`
    items.push({ kind: 'pipeline', text: `${head} : ${eta}` })
  }
  return { items: items.slice(0, max), more: Math.max(0, items.length - max) }
}

/**
 * The cards, in order. data = {conso (cockpit's consoCard), veille (core readVeille slim), waiting (rows count),
 * quotas (core readQuotas), runnerText, ci (ciSummary), problemes (problemsToday), workflows, pipelines}.
 */
export function cardsOf(data, cfg, nowMs) {
  const c = cardsConfig(cfg)
  const L = c.labels
  const d = data || {}
  const who = d.who || c.who || 'claude'
  const make = {
    conso: () => {
      const k = d.conso
      const line = k ? [`${k.preset.label} ${usd(k.total.cost)}`, k.rows[0] ? `${clip(k.rows[0].label, 28)} ${k.rows[0].pct} %` : '', k.project ? `projet ${k.project.label} ${k.project.pct} %` : ''].filter(Boolean).join(' · ') : 'pas encore de classement (le mod usage écrit classement.json)'
      return { line, tone: k ? null : 'dim' }
    },
    attend: () => {
      const v = d.veille
      const n = v ? v.julian : null
      const w = Number(d.waiting) || 0
      if (!v && !w) return { line: 'veille : aucune lecture', tone: 'dim' }
      const bits = []
      if (v) bits.push(`attend Julian : ${n}`)
      bits.push(`Ça t’attend : ${w}`)
      if (v && v.filTop) bits.push(clip(v.filTop, 40))
      return { line: bits.join(' · '), tone: n || w ? 'warn' : 'ok', count: (n || 0) + w }
    },
    atoi: () => {
      const v = d.veille
      if (!v || !v.aToiAvailable) return { line: 'À toi : non lu (le mod a-faire écrit summary.json)', tone: 'dim' }
      return { line: `À toi : ${v.aToi}`, tone: v.aToi ? 'warn' : 'ok', count: v.aToi }
    },
    controle: () => d.controle || { line: 'aucun fichier ~/.claude/a-faire/claude-control.md', tone: 'dim', items: [] },
    ci: () => {
      const ci = (d.ciBy && d.ciBy[who]) || d.ci
      if (!ci || !ci.available) return { line: d.runnerText ? `pas de cache ci · ${d.runnerText}` : 'pas de cache du mod ci', tone: 'dim' }
      return { line: ciSentence(ci, d.runnerText || ''), tone: ci.reds.length ? 'bad' : ci.running.total ? 'running' : 'ok' }
    },
    quota: () => {
      const q = d.quotas
      const cl = q ? quotaText(q.claude) : ''
      const cx = q ? quotaText(q.codex) : ''
      if (!cl && (who !== 'all' || !cx)) return { line: 'quotas non lus (le mod usage écrit samples.jsonl)', tone: 'dim' }
      const ws = who === 'all' ? [q.claude.five, q.claude.week, q.codex.five, q.codex.week] : [q.claude.five, q.claude.week]
      const hot = ws.some((w) => w && (w.pct >= 80 || w.runOutAt))
      return { line: (who === 'all' ? [`Claude ${cl || L.unknown}`, `Codex ${cx || L.unknown}`] : [`Claude ${cl || L.unknown}`]).join(' | '), tone: hot ? 'warn' : null }
    },
    problemes: () => {
      const p = d.problemes
      if (!p || !p.available) return { line: 'registre des problèmes non lu', tone: 'dim' }
      if (!p.today) return { line: 'aucun problème vu aujourd’hui', tone: 'ok' }
      return { line: `${p.today} vu(s) aujourd’hui · ${p.open} ouvert(s)${p.top ? ` · en tête : ${clip(p.top.title, 40)} (×${p.top.today})` : ''}`, tone: p.open ? 'warn' : null, count: p.today }
    },
    encours: () => {
      const pipes = (d.pipelines || []).filter((p) => who === 'all' || p.who === who)
      const e = encoursItems(d.workflows, pipes, nowMs, c.max_encours, d.lone || [])
      if (!e.items.length) return { line: 'rien ne tourne', tone: 'dim', items: [] }
      return { line: `${e.items.length + e.more} en cours`, tone: 'running', items: e.items, more: e.more }
    },
  }
  return c.order.filter((id) => make[id] && c.enabled.includes(id)).map((id) => ({ id, title: L[id] || id, button: c.buttons[id] || [], ...make[id]() }))
}

/** The first button target loaded in this session (names from $.command.list()), else null. A tab target is internal. */
export function pickTarget(candidates, names) {
  const have = new Set(names || [])
  for (const t of candidates || []) {
    if (t.tab) return t
    if (t.command && have.has(t.command)) return t
  }
  return null
}

/** lib/core/runner.mjs load in the shape factory's Système screen draws (backends), for the Machine tab. */
export function runnerBackends(r) {
  if (!r) return { generated: null, backends: [], error: 'runner : pas de cache du mod ci (~/.claude/ci-pipelines-cache.json)' }
  return { generated: r.generated, backends: [{ label: r.label || 'runner', usable: r.online === null || r.online === undefined ? 'yes' : r.online > 0,
    jobs: { running: r.running, pending: r.pending }, runners: { online: r.online, total: null }, concurrent: r.concurrent }] }
}

function usd(x) {
  return !fin(x) ? '$?' : x >= 100 ? `$${Math.round(x)}` : `$${x.toFixed(2)}`
}

function clip(s, n) {
  s = String(s ?? '')
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}
