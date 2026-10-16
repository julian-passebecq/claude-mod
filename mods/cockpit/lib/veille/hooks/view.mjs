// veille - view model of the pane and the band line: pure (no $, no I/O), tested with node --test.
// Input: the merged config, ~/.claude/veille/state.json, heartbeat.json and the ack keys. The watcher writes those;
// the mod only reads them and runs `node watcher/veille.mjs mode|ack|tour|coordinator`.
import { modeOf, watcherState, fill } from '../lib/modes.mjs'

export function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${Math.floor(h / 24)} j`
}

export function hm(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const RANK = { julian: 0, bad: 1, warn: 2, info: 3 }

export function viewModel(cfg, state, heartbeat, acks, nowMs) {
  const L = cfg.labels || {}
  const mode = modeOf(cfg)
  const w = watcherState(heartbeat, cfg, nowMs)
  const ackSet = new Set(acks || [])
  const alerts = Object.values((state && state.alerts) || {})
    .map((a) => ({ ...a, acked: a.acked || ackSet.has(a.key) || ackSet.has('*') }))
    .sort((a, b) => (a.acked - b.acked) || ((RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9)) || ((a.since || 0) - (b.since || 0)))
  const julian = alerts.filter((a) => a.julian && !a.acked).length
  let watcher
  if (mode.name === 'rien') watcher = { tone: 'dim', text: `${L.last_tour || 'Dernier tour'} : ${w.last_tour ? hm(w.last_tour) : L.never || 'jamais'} (veille éteinte)` }
  else if (w.state === 'not_installed') watcher = { tone: 'bad', text: L.not_installed || 'tâche non installée' }
  else if (w.state === 'stopped') watcher = { tone: 'bad', text: fill(L.stopped, { since: w.last ? `${hm(w.last)} (${ago(nowMs - w.last)})` : L.never || 'jamais' }) }
  else watcher = { tone: 'ok', text: `${L.last_tour || 'Dernier tour'} : ${w.last_tour ? `${hm(w.last_tour)} (il y a ${ago(nowMs - w.last_tour)})` : L.never || 'jamais'} · tâche vue à ${hm(w.last)}` }
  const may = mode.may.map((a) => (L.may_names || {})[a] || a)
  if (mode.may.includes('wake') && !(cfg.wake || {}).enabled) may.push(`(${L.wake_off || 'réveils désactivés'})`)
  return {
    mode, modes: Object.entries(cfg.modes || {}).map(([id, m]) => ({ id, label: m.label || id, current: id === mode.name })),
    may, watcher, alerts, julian,
    mail: state && state.mail === 'not_configured' ? L.mail_off || 'e-mail non configuré' : state && state.mail === 'error' ? 'e-mail en erreur (voir les événements)' : state && state.mail ? L.mail_on || 'e-mail configuré' : '',
    coordinator: cfg.coordinator_session || '',
    error: (state && state.last_error) || (heartbeat && heartbeat.last_error) || '',
    recent: ((state && state.recent) || []).slice(0, (cfg.pane || {}).events || 25),
    reviewsErrors: (state && state.reviews_errors) || [],
  }
}

// One line above the prompt: mode, last tour, how many wait on Julian. Tone bad when the watcher stopped.
export function bandLine(vm, cfg) {
  const L = cfg.labels || {}
  // the red « attend Julian : N » counter comes first, so it is never cut off the end of the line
  const parts = vm.julian ? [{ text: String(L.julian_counter || 'attend Julian : {n}').replace('{n}', vm.julian), tone: 'julian' }] : []
  parts.push({ text: `${L.band || 'Veille'} : ${vm.mode.label || vm.mode.name}`, tone: vm.mode.name === 'rien' ? 'dim' : undefined })
  if (vm.mode.name !== 'rien') {
    if (vm.watcher.tone === 'bad') parts.push({ text: vm.watcher.text, tone: 'bad' })
    else if (vm.watcher.tone === 'ok') parts.push({ text: vm.watcher.text.split(' · ')[0].replace(/^[^:]+: /, 'tour '), tone: 'dim' })
  }
  return parts
}

// What an event of state.recent says, in one line.
export function eventText(e) {
  const t = hm(e.at)
  const what = {
    merged: `mergée : ${e.pr || e.url} (${e.reason || ''})`, merge_failed: `merge échoué : ${e.pr || e.url} : ${e.error || ''}`,
    merge_skipped: `pas mergée : ${e.pr || e.url} : ${e.reason || ''}`, alert: `alerte : ${e.what || e.key}${e.title ? ' · ' + e.title : ''}`,
    resolved: `réglée : ${e.what || e.key}`, notified: `notifiée : ${e.key}`, mailed: `e-mail envoyé (${(e.keys || []).length} ligne(s))`,
    mail_skipped: `e-mail non envoyé : ${e.reason || ''}`, mail_failed: `e-mail en erreur : ${e.error || ''}`,
    woken: `réveil de ${e.target || e.cli} : ${e.reason || ''}`, wake_skipped: `pas de réveil (${e.reason || ''}) : ${e.key}`,
    push: `push Claude demandé : ${e.reason || ''}`, push_skipped: `push non envoyé : ${e.reason || ''}`,
    tour_failed: `tour échoué : ${e.error || ''}`, exported: `export eta : ${e.reason || ''}`, export_failed: `export eta échoué : ${e.error || ''}`, missed: `veille arrêtée de ${hm(e.from)} à ${hm(e.to)}`,
  }[e.kind] || `${e.kind}${e.reason ? ' : ' + e.reason : ''}`
  return `${t} ${what}`
}
