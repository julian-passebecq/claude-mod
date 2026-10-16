// veille - modes and watcher health: pure, no import, shared by the watcher (lib/core.mjs) and the mod's hooks.
export const ACTIONS = ['alert', 'notify', 'notify_julian', 'mail', 'push_claude', 'merge', 'wake']
export const MODES = ['rien', 'légère', 'active', 'nuit-active', 'nuit-test-légère']

export function deepMerge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v
  return out
}

// Accept « legere », « nuit-test-legere », any case: the stored name is always the config key.
export function modeName(cfg, x) {
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  return Object.keys((cfg && cfg.modes) || {}).find((k) => fold(k) === fold(x)) || null
}

export function modeOf(cfg) {
  const name = modeName(cfg, cfg && cfg.mode) || 'rien'
  const m = (cfg.modes || {})[name] || { interval_min: 0, may: [] }
  return { name, ...m, may: (m.may || []).filter((a) => ACTIONS.includes(a)) }
}

// What a mode may do, with the switches that gate two of them (wake.enabled, push.claude).
export function may(cfg, action, mode = modeOf(cfg)) {
  if (!mode.may.includes(action)) return false
  if (action === 'wake') return !!(cfg.wake && cfg.wake.enabled)
  if (action === 'push_claude') return !!(cfg.push && cfg.push.claude)
  return true
}

// "23:00-07:30" -> is `date` (local time) inside? A range may wrap past midnight.
export function inQuietHours(spec, date) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(spec || '').trim())
  if (!m) return false
  const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4]
  const t = date.getHours() * 60 + date.getMinutes()
  return a <= b ? t >= a && t < b : t >= a || t < b
}

// Is a tour due at this fire? (rien: never; else when interval_min has passed since the last tour.)
export function tourDue(mode, lastTourMs, nowMs) {
  if (!mode.interval_min) return false
  return !lastTourMs || nowMs - lastTourMs >= mode.interval_min * 60000 - 30000
}

// The task fires every fire_every_min. A gap of more than two fires means the watcher was not running.
export function gapOf(lastFireMs, nowMs, fireEveryMin) {
  if (!lastFireMs) return null
  const limit = 2 * fireEveryMin * 60000 + 60000
  return nowMs - lastFireMs > limit ? { from: lastFireMs, to: nowMs } : null
}

// For the pane and the band: is the watcher stale (two fires missed)?
// cfg.installed is written by `veille install` (user config.json); heartbeat.json by every fire of the task.
export function watcherState(heartbeat, cfg, nowMs) {
  if (!cfg || !cfg.installed) return { state: 'not_installed', last: heartbeat && heartbeat.last_fire, last_tour: (heartbeat && heartbeat.last_tour) || 0 }
  const last = (heartbeat && heartbeat.last_fire) || 0
  const limit = 2 * (cfg.fire_every_min || 5) * 60000 + 60000
  return { state: nowMs - last > limit ? 'stopped' : 'ok', last, last_tour: (heartbeat && heartbeat.last_tour) || 0 }
}

export function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
}
