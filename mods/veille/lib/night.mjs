// veille - pure logic (no I/O) for the night and the wake: the safe wake (a fresh `claude -p` with the target
// conversation's own model, effort and permission mode, never `--resume`), the check of what the woken session really
// ran with, the night summary (/veille jour), deadline alerts (J-7, J-1) and the vendored-mod version check.
// Tested with node --test mods/veille/tests/night.test.mjs.

// ---- safe wake ----------------------------------------------------------------------------------------------------------

const MODEL_RE = /^[a-z0-9][a-z0-9.\-[\]]{1,80}$/i
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const PERMS = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'auto', 'dontAsk']

// The desktop app's session file (%APPDATA%/Claude/claude-code-sessions/**/local_*.json) of the target -> what the
// fresh session must run with. Anything missing or odd: no wake (a default could raise the effort or the permissions).
export function wakeSettings(sess) {
  if (!sess || typeof sess !== 'object') return { ok: false, why: 'fichier de session de la cible introuvable' }
  const model = String(sess.model || '')
  const effort = String(sess.effort || '')
  const permission = String(sess.permissionMode || '')
  const cwd = String(sess.cwd || sess.originCwd || '')
  const why = []
  if (!MODEL_RE.test(model)) why.push('modèle inconnu')
  if (!EFFORTS.includes(effort)) why.push('effort inconnu')
  if (!PERMS.includes(permission)) why.push('mode de permission inconnu')
  if (!cwd) why.push('dossier inconnu')
  if (why.length) return { ok: false, why: why.join(', ') }
  return { ok: true, model, effort, permission, cwd, title: sess.title || '', cli: sess.cliSessionId || '', sid: sess.sessionId || '' }
}

// The argv of the wake: a NEW session, never `--resume` (16 Oct 22:45: `claude -p --resume` turned effort low into
// medium and acceptEdits into bypass). stream-json so the log carries what the session really ran with.
export function wakeArgv(claude, s, text, name) {
  const argv = [claude, '-p', '--model', s.model, '--effort', s.effort, '--permission-mode', s.permission,
    '--output-format', 'stream-json', '--verbose']
  if (name) argv.push('-n', String(name).slice(0, 80))
  argv.push(String(text))
  return argv
}

// The child's environment: CLAUDE_CODE_SUBAGENT_MODEL set to the target model, so no settings key moves the run to
// another model (16 Oct: `--model haiku` with that variable set to Sonnet ran on Sonnet).
export function wakeEnv(env, s) {
  return { ...env, CLAUDE_CODE_SUBAGENT_MODEL: s.model }
}

// The wake log (stream-json lines): session id, model and permission mode of the init line, the result text.
export function parseWakeLog(text) {
  const out = { session_id: '', model: '', permission: '', result: '', is_error: null, used: [], cost: null, done: false }
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    let j
    try { j = JSON.parse(line) } catch { continue }
    if (j.type === 'system' && j.subtype === 'init') { out.session_id = j.session_id || ''; out.model = j.model || ''; out.permission = j.permissionMode || '' }
    if (j.type === 'result') {
      out.done = true
      out.result = String(j.result || '')
      out.is_error = !!j.is_error
      out.used = Object.keys(j.modelUsage || {})
      out.cost = typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null
      if (!out.session_id) out.session_id = j.session_id || ''
    }
  }
  return out
}

// The woken session's transcript (~/.claude/projects/<slug>/<session_id>.jsonl): effort, permission mode and model as
// the CLI recorded them. The proof the wake kept the target's settings.
export function transcriptSettings(text) {
  const seen = { model: new Set(), effort: new Set(), permission: new Set() }
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    let j
    try { j = JSON.parse(line) } catch { continue }
    if (j.isSidechain) continue // sub-agents run on their own model
    if (j.type === 'user' && j.permissionMode) seen.permission.add(j.permissionMode)
    if (j.type === 'assistant') {
      if (j.message && j.message.model && j.message.model !== '<synthetic>') seen.model.add(j.message.model)
      if (j.effort) seen.effort.add(j.effort)
    }
  }
  return { model: [...seen.model], effort: [...seen.effort], permission: [...seen.permission] }
}

// Did the wake run with what was asked? want: {model, effort, permission}; log: parseWakeLog; tr: transcriptSettings.
export function verifyWake(want, log, tr) {
  const diffs = []
  const models = [...new Set([log.model, ...((tr && tr.model) || [])].filter(Boolean))]
  if (models.some((m) => m !== want.model)) diffs.push(`modèle ${models.join('/')} au lieu de ${want.model}`)
  const perms = [...new Set([log.permission, ...((tr && tr.permission) || [])].filter(Boolean))]
  if (!perms.length) diffs.push('mode de permission non lu')
  else if (perms.some((p) => p !== want.permission)) diffs.push(`permission ${perms.join('/')} au lieu de ${want.permission}`)
  const efforts = (tr && tr.effort) || []
  if (!efforts.length) diffs.push('effort non lu (transcript absent)')
  else if (efforts.some((e) => e !== want.effort)) diffs.push(`effort ${efforts.join('/')} au lieu de ${want.effort}`)
  return { ok: !diffs.length, diffs }
}

// ---- night: /veille nuit and /veille jour -------------------------------------------------------------------------

const hm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

// What happened since the night started, from events.jsonl: merges, failures, what waited on Julian, wakes.
export function nightSummary(events, since, nowMs, labels = {}) {
  const ev = (events || []).filter((e) => e && e.at >= since && e.at <= nowMs)
  const merged = ev.filter((e) => e.kind === 'merged').map((e) => ({ at: e.at, text: e.pr || e.url || '' }))
  const failed = ev.filter((e) => /_failed$/.test(String(e.kind || ''))).map((e) => ({ at: e.at, text: `${e.kind} : ${String(e.error || e.reason || e.pr || '').slice(0, 160)}` }))
  const seen = new Set()
  const waits = []
  for (const e of ev) {
    if (e.kind !== 'alert' || e.severity !== 'julian' || seen.has(e.key)) continue
    seen.add(e.key)
    waits.push({ at: e.at, text: `${e.what || e.key}${e.title ? ' · ' + e.title : ''}` })
  }
  const woken = ev.filter((e) => e.kind === 'woken').map((e) => ({ at: e.at, text: `${e.target || e.cli || ''} : ${e.reason || ''}` }))
  const L = { title: 'Bilan de la nuit', merged: 'mergées', failed: 'échecs', waits: 'attentes de Julian', woken: 'réveils', none: 'rien', ...labels }
  const h = Math.round((nowMs - since) / 360000) / 10
  const lines = [`${L.title} : ${hm(since)} → ${hm(nowMs)} (${h} h) · ${merged.length} ${L.merged} · ${failed.length} ${L.failed} · ${waits.length} ${L.waits} · ${woken.length} ${L.woken}`]
  for (const [name, list] of [[L.merged, merged], [L.failed, failed], [L.waits, waits], [L.woken, woken]]) {
    if (!list.length) continue
    lines.push(`${name} :`)
    for (const x of list.slice(0, 10)) lines.push(`  ${hm(x.at)} ${x.text}`)
    if (list.length > 10) lines.push(`  + ${list.length - 10}`)
  }
  return { since, until: nowMs, merged, failed, waits, woken, lines }
}

// ---- deadlines (J-7, J-1) from ~/.claude/a-faire/claude-control.md ------------------------------------------------

const LINE_RE = /^\s*-\s*\[ \]\s*(\d{4})-(\d{2})-(\d{2})\s*·\s*([^·]*?)\s*·\s*([^·]+?)\s*(?:·|$)/

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

// Open items `- [ ] YYYY-MM-DD · prio · quoi · …` due within `days[0]` days: one alert per stage, so J-1 is new (and
// notifies) after J-7 was seen. Overdue items stay at the last stage. Items with « — » as date are skipped.
export function deadlineAlerts(text, nowMs, opts = {}) {
  const stages = [...(opts.days || [7, 1])].map(Number).filter((n) => n >= 0).sort((a, b) => b - a)
  if (!stages.length) return []
  const now = new Date(nowMs)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = LINE_RE.exec(line)
    if (!m) continue
    const day = Date.UTC(+m[1], +m[2] - 1, +m[3])
    if (!Number.isFinite(day)) continue
    const left = Math.round((day - today) / 86400000)
    if (left > stages[0]) continue
    const stage = stages.filter((s) => left <= s).pop()
    const date = `${m[1]}-${m[2]}-${m[3]}`
    const when = left < 0 ? `en retard de ${-left} j` : left === 0 ? 'aujourd’hui' : left === 1 ? 'demain' : `dans ${left} j`
    out.push({ key: `deadline:${date}:${slug(m[5])}:j${stage}`, kind: stage <= 1 ? 'deadline_j1' : 'deadline_j7',
      what: `Échéance ${when} (${date}, J-${stage}) : ${m[5]}${m[4] ? ' · ' + m[4] : ''}`, title: opts.title || 'À toi', since: nowMs, days_left: left })
  }
  return out
}

// ---- vendored mods: upstream release vs vendored version ----------------------------------------------------------

export const normVersion = (v) => String(v || '').trim().replace(/^v/i, '')

export function vendorDue(vendorState, nowMs, everyDays = 7) {
  const at = vendorState && vendorState.checked_at
  return !at || nowMs - at >= everyDays * 86400000
}

// Info alerts from the stored check (repeated every tour while the vendored copy is behind).
export function vendorAlerts(vendorState) {
  const out = []
  for (const it of (vendorState && vendorState.items) || []) {
    if (!it.latest || !it.vendored || normVersion(it.latest) === normVersion(it.vendored)) continue
    out.push({ key: `vendor:${it.name}:${normVersion(it.latest)}`, kind: 'vendor', what: `${it.name} ${it.latest} publié en amont, copie vendored ${it.vendored}`,
      title: it.repo || it.name, link: it.repo ? `https://github.com/${it.repo}/releases/tag/${it.latest}` : null, since: vendorState.checked_at })
  }
  return out
}
