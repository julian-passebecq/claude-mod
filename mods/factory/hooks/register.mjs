// factory v2 - the side panel of all agents, read-only:
//   /factory [mission|focus|arbre|workflow|pipeline|quotas|systeme|journal] [title or id]   /factory workflow [all]
// Tabs on top, each screen stacked top to bottom and as wide as the pane (draw.mjs, native elements, no canvas).
// Data: scanner/factory_scan.py (incremental tail reads of the transcripts, cache in the effort-board); quotas and runner
// load from lib/core (usage.mjs, runner.mjs) through scanner/extras.mjs, plus $.session.usage(); Système's PC sample from
// the machine mod's sampler. These screens now also live inside Cockpit (/cockpit). Each
// source runs only while the pane is open and its tab is showing. Nothing here blocks, rewrites or adds to a prompt.
import { deepMerge, pickSession, scanArgs, engineAtLeast } from './logic.mjs'
import { waitingConfig, waitingRows, waitingArgs, toAnnounce, notifyText, holdsLease, fill } from './waiting.mjs'
import { screensConfig, tabsOf, parseArgs } from './screens.mjs'
import { drawFactoryPane, allTabs } from './workflow_draw.mjs'
import { workflowConfig, parseWorkflowArgs, workflowArgs } from './workflow.mjs'

let CFG = null
const D = {
  scan: null, target: null, self: null, busy: false, error: '', at: 0, open: false, tab: null, filter: 'all', jfilter: 'all', jproject: '',
  picking: false, live: [], quotas: null, quotasAt: 0, machine: { sample: null, runner: null, prev: null, tick: 0, missing: false, metricsMissing: false, error: '', runnerAt: 0 },
  columns: 0, engine: '',
  wf: null, wfAt: 0, wfBusy: false, wfError: '', wfScope: null, wfOpen: {},
}

async function homeDir($) {
  return ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/')
}

// FACTORY_BOARD overrides the effort-board folder (tests, dry runs); default ~/.claude/effort-board.
async function board($) {
  const o = await $.env.get('FACTORY_BOARD')
  return o ? o.replace(/\\/g, '/') : (await homeDir($)) + '/.claude/effort-board'
}

async function readJson($, path) {
  try {
    if (!(await $.fs.exists(path))) return null
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

// factory.config.json beside the mod, deep-merged with ~/.claude/effort-board/factory.config.json when present.
async function loadConfig($) {
  const base = (await readJson($, $.plugin.root.replace(/\\/g, '/') + '/factory.config.json')) || {}
  const wf = await readJson($, $.plugin.root.replace(/\\/g, '/') + '/workflow.config.json')
  const over = await readJson($, (await board($)) + '/factory.config.json')
  CFG = deepMerge(deepMerge(base, wf ? { workflow: wf } : {}), over || {})
  if (!D.tab) D.tab = screensConfig(CFG).start
  return CFG
}

const root = ($) => $.plugin.root.replace(/\\/g, '/')
const sibling = ($, mod) => root($).replace(/\/[^/]+\/?$/, '') + '/' + mod

async function rescan($) {
  if (D.busy) return
  D.busy = true
  try {
    const cfg = CFG || (await loadConfig($))
    const argv = [cfg.python || 'python', ...scanArgs(cfg, {
      script: root($) + '/scanner/factory_scan.py', cache: (await board($)) + '/factory_cache.json', detail: D.target || D.self,
      extra: [...waitingArgs(cfg), '--recent', String(screensConfig(cfg).recent_events)],
    })]
    const r = await $.process.run(argv, { timeoutMs: 180000 })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `scanner exit ${r.exitCode}`)
    D.scan = JSON.parse(r.stdout)
    D.error = ''
    D.at = await $.clock.now()
  } catch (err) {
    D.error = String(err && err.message ? err.message : err).slice(0, 300)
  } finally {
    D.busy = false
  }
  $.ui.invalidate('ui.render')
  if (D.scan && !D.error) await announce($).catch(() => undefined)
}

// The Workflow screen's own scanner (scanner/workflow_scan.py): runs only while that tab is showing.
async function rescanWorkflow($) {
  if (D.wfBusy) return
  D.wfBusy = true
  $.ui.invalidate('ui.render')
  try {
    const cfg = CFG || (await loadConfig($))
    const scope = D.wfScope || workflowConfig(cfg).scope
    const argv = [cfg.python || 'python', ...workflowArgs(cfg, {
      script: root($) + '/scanner/workflow_scan.py', cache: (await board($)) + '/factory_workflow_cache.json', scope, session: D.self || '',
    })]
    const r = await $.process.run(argv, { timeoutMs: 180000 })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `workflow_scan exit ${r.exitCode}`)
    D.wf = JSON.parse(r.stdout)
    D.wfError = ''
    D.wfAt = await $.clock.now()
  } catch (err) {
    D.wfError = String(err && err.message ? err.message : err).slice(0, 300)
  } finally {
    D.wfBusy = false
  }
  $.ui.invalidate('ui.render')
}

const refreshTab = ($) => (D.tab === 'workflow' ? rescanWorkflow($) : rescan($))

// ---- extras: only for the tab on screen ----------------------------------------------------------------------------

async function loadQuotas($, force) {
  const sc = screensConfig(CFG || {})
  const now = await $.clock.now()
  if (!force && D.quotas && now - D.quotasAt < sc.quotas_refresh_s * 1000) return
  try { D.live = ((await $.session.usage()) || {}).rateLimits || [] } catch { D.live = [] }
  try {
    const r = await $.process.run([CFG.node || 'node', root($) + '/scanner/extras.mjs', 'quotas'], {
      stdin: JSON.stringify({ live: D.live, now, home: await homeDir($) }), timeoutMs: 60000,
    })
    D.quotas = r.exitCode === 0 ? JSON.parse(r.stdout) : { available: false, reason: (r.stderr || '').trim().split('\n').pop() || 'extras' }
  } catch (err) {
    D.quotas = { available: false, reason: String(err && err.message ? err.message : err).slice(0, 120) }
  }
  D.quotasAt = now
  $.ui.invalidate('ui.render')
}

async function sampleMachine($) {
  const sc = screensConfig(CFG || {})
  const M = D.machine
  const script = sibling($, 'machine') + '/scanner/machine.py'
  try { M.missing = !(await $.fs.exists(script)) } catch { M.missing = true }
  try { M.metricsMissing = !(await $.fs.exists(sibling($, 'metrics') + '/.claude-plugin/plugin.json')) } catch { M.metricsMissing = true }
  if (M.missing) { $.ui.invalidate('ui.render'); return }
  const py = (CFG && CFG.python) || 'python'
  try {
    const gpu = M.tick % Math.max(1, sc.gpu_every) === 0
    M.tick += 1
    const r = await $.process.run([py, '-I', script, 'sample'], { stdin: JSON.stringify({ prev: M.prev, gpu, top_n: 5 }), timeoutMs: 20000 })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `machine exit ${r.exitCode}`)
    const s = JSON.parse(r.stdout)
    M.prev = s.raw
    if (!gpu && M.sample && M.sample.gpu) s.gpu = M.sample.gpu // keep the last GPU reading between spaced reads
    M.sample = s
    M.error = ''
    const now = await $.clock.now()
    if (now - M.runnerAt > sc.system_refresh_s * 6000) {
      M.runnerAt = now
      // runner load: lib/core/runner.mjs through scanner/extras.mjs (the ci mod's cache), the same figures as band and cockpit
      const rr = await $.process.run([(CFG && CFG.node) || 'node', root($) + '/scanner/extras.mjs', 'runner'], { stdin: JSON.stringify({ now, home: await homeDir($) }), timeoutMs: 30000 })
      M.runner = rr.exitCode === 0 ? JSON.parse(rr.stdout) : { error: 'runner : lecture impossible' }
    }
  } catch (err) {
    M.error = String(err && err.message ? err.message : err).slice(0, 200)
  }
  $.ui.invalidate('ui.render')
}

async function onTabShown($) {
  if (D.tab === 'quotas') await loadQuotas($, false)
  if (D.tab === 'systeme') await sampleMachine($)
}

// ---- "Ça t'attend": notifications, one per row ever (keys kept in $.store, shared by every session) ---------------

async function announce($) {
  const w = waitingConfig(CFG)
  if (!w.enabled) return
  const { rows } = waitingRows(D.scan, CFG, D.at)
  let seen = null
  try { seen = (await $.store.get('waiting_seen')) ?? null } catch { seen = null }
  const r = toAnnounce(rows, seen, CFG, D.at)
  try { await $.store.set('waiting_seen', r.seen) } catch { return } // without a record, do not risk repeating
  for (const row of r.announce) await notify($, notifyText(row), w)
  if (r.more) await notify($, fill(w.labels.notify_more, { n: r.more }), w)
}

// $.ui.notify (a native notification through the person's channel) is in the build's types, not on the doc pages:
// when it is missing or not sent, a toast says the same thing.
async function notify($, text, w) {
  try {
    const res = await $.ui.notify(text, { title: w.labels.notify_title })
    if (res && res.isSent) return
  } catch { /* fall back to a toast */ }
  $.ui.toast(`${w.labels.notify_title}: ${text}`, { timeoutMs: 8000 })
}

// With the pane closed, one session on the PC (the lease holder) still scans every background_s for notifications.
async function background($) {
  const w = waitingConfig(CFG || {})
  if (!w.enabled || !w.notify || D.open || D.busy) return
  const now = await $.clock.now()
  const self = D.self || 'unknown'
  let lease = null
  try { lease = await $.store.get('waiting_lease') } catch { return }
  if (!holdsLease(lease, self, now, w.background_s * 1000)) return
  try { await $.store.set('waiting_lease', { sid: self, at: now }) } catch { return }
  await rescan($)
}

// ---- navigation ------------------------------------------------------------------------------------------------------

async function go($, tab, target) {
  if (tab) D.tab = tab
  if (target !== undefined) { D.target = target === D.self ? null : target; D.picking = false }
  $.ui.invalidate('ui.render')
  await refreshTab($)
  await onTabShown($)
}

async function openPane($) {
  D.open = true
  await $.ui.open({ id: 'factory', title: 'Factory', focus: true, closeOnEscape: true })
}

function actions($) {
  const redraw = () => $.ui.invalidate('ui.render')
  return {
    tab: (id) => { D.tab = id; redraw(); if (id === 'workflow') void rescanWorkflow($); else { if (!D.scan) void rescan($); void onTabShown($) } },
    go: (cli) => { void go($, 'arbre', cli) },
    refresh: () => { void refreshTab($); if (D.tab === 'quotas') void loadQuotas($, true); if (D.tab === 'systeme') void sampleMachine($) },
    filter: (k) => { D.filter = k; redraw() },
    jfilter: (k) => { D.jfilter = k; redraw() },
    jproject: (p) => { D.jproject = p; redraw() },
    pick: () => { D.picking = !D.picking; redraw() },
    wfScope: (k) => { D.wfScope = k; redraw(); void rescanWorkflow($) },
    wfToggle: (key, open) => { D.wfOpen = { ...D.wfOpen, [key]: open }; redraw() },
    openAgent: (id) => { void viewAgent($, { agentId: id }) },
    backToConv: () => { void viewAgent($, {}) },
  }
}

// « Ouvrir l'agent »: the engine's transcript view of one agent of this conversation ($.ui.view, 2.1.300+; a press is
// person-initiated, which the engine requires). Older engines have no $.ui.view: the button is not drawn, a toast here.
const VIEW_MIN = '2.1.300'

async function viewAgent($, target) {
  if (!engineAtLeast(D.engine, VIEW_MIN)) { $.ui.toast(`Ouvrir un agent demande Claude Code ${VIEW_MIN} ou plus récent (claude update)`); return }
  try {
    const r = await $.ui.view(target)
    if (r && r.deny) $.ui.toast(`Agent non ouvert : ${r.deny}`)
  } catch (err) {
    $.ui.toast(`Agent non ouvert : ${String(err && err.message ? err.message : err).slice(0, 120)}`)
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try { D.self = await $.session.id() } catch { D.self = null }
    try { D.engine = ((await $.session.version()) || {}).version || '' } catch { D.engine = '' }
    await loadConfig($).catch(() => { CFG = {} })
    const sc = screensConfig(CFG || {})
    $.clock.every(Math.max(5, (CFG && CFG.refresh_s) || 20) * 1000, () => { if (D.open && D.tab !== 'workflow') void rescan($) })
    $.clock.every(Math.max(5, workflowConfig(CFG || {}).refresh_s) * 1000, () => { if (D.open && D.tab === 'workflow') void rescanWorkflow($) })
    $.clock.every(Math.max(3, sc.system_refresh_s) * 1000, () => { if (D.open && D.tab === 'systeme') void sampleMachine($) })
    $.clock.every(Math.max(30, sc.quotas_refresh_s) * 1000, () => { if (D.open && D.tab === 'quotas') void loadQuotas($, true) })
    $.clock.every(Math.max(30, waitingConfig(CFG || {}).background_s) * 1000, () => { void background($).catch(() => undefined) })
    try {
      await $.command.register({
        name: 'factory', immediate: true,
        description: 'Factory : Mission, Focus, Arbre, Workflow, Pipeline, Quotas, Système, Journal de tous les agents (/factory [onglet] [titre ou id], /factory workflow [all])',
        argumentHint: '[mission|focus|arbre|workflow|pipeline|quotas|systeme|journal] [titre ou id] | workflow all | close',
      })
    } catch { /* a name clash must not break the rest */ }
    return next(e)
  })

  on('command.run', { command: 'factory' }, async ($, e) => {
    await loadConfig($)
    try { D.self = (await $.session.id()) || D.self } catch { /* keep the last one */ }
    try { D.engine = ((await $.session.version()) || {}).version || D.engine } catch { /* keep */ }
    const q = String(e.args || '').trim()
    if (q.toLowerCase() === 'close') { D.open = false; await $.ui.close({ id: 'factory' }); return {} }
    await openPane($)
    const wa = parseWorkflowArgs(q)
    if (wa.workflow) { if (wa.scope) D.wfScope = wa.scope; await go($, 'workflow'); return {} }
    const { tab, rest } = parseArgs(q, CFG)
    if (!rest) { await go($, tab || D.tab || screensConfig(CFG).start); return {} }
    if (!D.scan) await rescan($)
    const s = pickSession(D.scan && D.scan.sessions, rest)
    await go($, tab || 'arbre', s ? s.cli : rest)
    return {}
  })

  on('ui.close', { id: 'factory' }, async ($, e, next) => { D.open = false; return next(e) }).catch(() => undefined)

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== 'factory') return next(e)
    const el = $.ui.resolve(e)
    if (!CFG) CFG = {}
    const cols = Number(e.props && e.props.bodyColumns) || 0
    D.columns = cols
    if (!allTabs(CFG).some((t) => t.id === D.tab)) D.tab = (tabsOf(CFG)[0] || { id: 'mission' }).id
    const canView = engineAtLeast(D.engine, VIEW_MIN)
    const viewAgent = (e.props && e.props.view && e.props.view.agentId) || null
    return drawFactoryPane(el, { ...D, cfg: CFG, columns: cols, canView, viewAgent, act: actions($) })
  })
}
