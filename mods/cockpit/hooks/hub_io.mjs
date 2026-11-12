// cockpit - engine glue of the hub tabs: reads the local Cockpit (herd-worker, loopback) and sends its POSTs with the
// page's own checks (Origin + per-start token). Shows and sends only: no tool or prompt hook, nothing calls a model.
// /fleet [tab], /dispatch <machine> <text>, /todo <machine> <text> come from the separate Fleet mod this replaces;
// they are registered only when no loaded mod answers them already (that mod, while still loaded, keeps them).
import { hubConfig, hubModel, tokenOf, parseTarget, sendResult, summaryText, badgeText, HUB_TABS } from '../lib/hub.mjs'

export const H = { local: null, data: null, error: '', busy: false, msg: '', token: null, inflight: null, org: '', memo: null, cmds: new Set() }

async function get($, base, path) {
  const r = await $.http.fetch(base + path, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`${path} answered ${r.status}`)
  return r.text
}

async function load($, cfg) {
  const c = hubConfig(cfg)
  H.busy = true
  $.ui.invalidate('ui.render')
  try {
    H.local = JSON.parse(await get($, c.base, '/local.json'))
    try { H.data = JSON.parse(await get($, c.base, '/data.json')); H.error = '' } catch { H.error = c.labels.no_data }
  } catch {
    H.local = null
    H.error = c.labels.offline.replace('{base}', c.base)
  } finally {
    H.busy = false
    H.memo = null
  }
  if (c.status_line !== false) {
    try { $.ui.status(badgeText(H.local ? model(cfg) : null)) } catch { /* no status line here */ }
  }
  $.ui.invalidate('ui.render')
}

export function refreshHub($, cfg) {
  H.inflight = H.inflight || load($, cfg).finally(() => { H.inflight = null })
  return H.inflight
}

// The model for the tabs, kept until a new read, another workspace or new local readings.
export function model(cfg, local = {}) {
  if (!H.local) return null
  const key = [H.local, H.data, H.org, local.usage, local.veille]
  if (H.memo && H.memo.key.every((k, i) => k === key[i])) return H.memo.m
  const m = hubModel(H.local, H.data, cfg, { org: H.org, usage: local.usage, veille: local.veille })
  H.memo = { key, m }
  return m
}

async function token($, base, fresh) {
  if (H.token && !fresh) return H.token
  try {
    const r = await $.http.fetch(base + '/', { headers: { Accept: 'text/html' } })
    H.token = r.ok ? tokenOf(r.text) : null
  } catch { H.token = null }
  return H.token
}

// One POST with the page's checks. A 403 on a stale token (worker restarted) retries once with a fresh one.
async function post($, base, path, body) {
  for (const fresh of [false, true]) {
    const t = await token($, base, fresh)
    if (!t) return null
    let r
    try {
      r = await $.http.fetch(base + path, { method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Origin: base, 'X-Cockpit-Token': t } })
    } catch { return null }
    if (r.status !== 403 || fresh) return r
  }
  return null
}

// Run / Mark done of a to-do delivered to this computer.
export async function act($, cfg, kind, id) {
  const c = hubConfig(cfg)
  H.msg = '…'
  $.ui.invalidate('ui.render')
  const r = await post($, c.base, `/api/${kind}`, { id })
  H.msg = sendResult(kind, r)
  try { $.ui.toast(H.msg) } catch { /* no toast here */ }
  await refreshHub($, cfg)
}

// /dispatch and /todo
export async function send($, cfg, kind, args) {
  const c = hubConfig(cfg)
  if (!H.local) await refreshHub($, cfg)
  const labels = (H.data && H.data.labels) || {}
  const p = parseTarget(args, labels)
  if (p.error) return { text: `/${kind}: ${p.error}` }
  const r = await post($, c.base, `/api/${kind}`, { machine: p.machine, text: p.text })
  void refreshHub($, cfg)
  return { text: sendResult(kind, r) }
}

export function fleetText(cfg) {
  return summaryText(model(cfg), cfg)
}

// /fleet's argument -> a hub tab id ("" -> the To do tab, as the old Fleet mod opened on it)
export function fleetTab(args) {
  const a = String(args || '').trim().toLowerCase()
  if (!a || a === 'todo' || a === 'to-do') return 'todo'
  return HUB_TABS.includes(a) ? a : 'todo'
}

// Register /fleet, /dispatch, /todo when no loaded command has the name (the old Fleet mod keeps them while loaded).
export async function registerHubCommands($) {
  let names = []
  try { names = ((await $.command.list()) || []).map((c) => c.name) } catch { return }
  const defs = [
    { name: 'fleet', immediate: true, description: 'Cockpit hub tabs: this computer\'s to-dos and the fleet from the local Cockpit (/fleet [todo|fleet|overview|questions|quota|alerts|journal|watch|lanes])', argumentHint: '[todo|fleet|overview|questions|quota|alerts|journal|watch|lanes]' },
    { name: 'dispatch', immediate: true, description: 'Send a job to a machine through the local Cockpit: /dispatch <machine> <text>', argumentHint: '<machine> <text>' },
    { name: 'todo', immediate: true, description: 'Add a to-do for Julian on a machine through the local Cockpit: /todo <machine> <text>', argumentHint: '<machine> <text>' },
  ]
  for (const d of defs) {
    if (names.includes(d.name) || H.cmds.has(d.name)) continue
    try { await $.command.register(d); H.cmds.add(d.name) } catch { /* refused: nothing */ }
  }
}
