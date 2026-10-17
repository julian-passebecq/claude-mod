// cockpit - the one zoomable side pane (méga › projet › conversation › agent), read-only, with tabs:
//   Cockpit  summary cards (Qui consomme, T'attend, À toi, CI, Quota, Problèmes du jour, En cours), each a button to
//            its detail, then the scoped sections (Cette conversation › Ce projet › Tous les projets › Qui consomme ›
//            Claude global), every section foldable with a one-line summary while closed
//   Mission · Focus · Arbre · Pipeline · Workflow · Journal   factory's screens (synced copies in lib/factory)
//   Machine  this PC's load (machine.py copy) and the runner load (lib/core/runner.mjs)
//   Claude ↔ Codex · Galerie (Équipe, Carte, Codex) · Nuit (« Bilan avant la nuit », behind the Nuit button)
//   Depuis   « Depuis ton dernier message » (its button on the Cockpit tab; /cockpit depuis [8h|24h|nuit|HH:MM])
//   A vertical menu at the left runs the band's 6 entries (Jauge, Cockpit, Veille, À toi, Registres, Référence).
//   /cockpit [conv|projet|mega|agent|mission|focus|arbre|pipeline|workflow [all]|journal|machine|relais|galerie|nuit|depuis [8h|24h|nuit|HH:MM]] [projet ou conversation] | close
// /factory and /machine keep working: while their own mod is loaded it answers; when it is not, cockpit registers the
// name as an alias (checked against $.command.list(), as band does to grey a button). Card buttons run the detail's
// command ($.command.run; a mod cannot open another mod's pane). Opens by itself at session start (userConfig `start`).
// Read-only: scanners (factory's, workflow's, machine's copies, scanner/cards.mjs over lib/core); nothing blocks,
// rewrites or adds to a prompt, nothing calls a model. Refresh only while the pane is the one shown.
import { deepMerge, scanArgs, pickSession, repoOf, engineAtLeast } from '../lib/factory/hooks/logic.mjs'
import { waitingArgs, waitingRows } from '../lib/factory/hooks/waiting.mjs'
import { screensConfig } from '../lib/factory/hooks/screens.mjs'
import { workflowConfig, workflowArgs, workflowScreen, loneAgents } from '../lib/factory/hooks/workflow.mjs'
import { viewModel } from '../lib/veille/hooks/view.mjs'
import { deepMerge as vmerge } from '../lib/veille/lib/modes.mjs'
import { cardsOf, pickTarget, workflowsLive, runnerBackends, cardsConfig } from '../lib/cards.mjs'
import { cockpitConfig, initialNav, select, zoomTo, usageCard, findSession, sectionFor, consoCard, parseArgs, aliasArgs, tabValid, nightRepos, titleOf, laneRows } from './nav.mjs'
import { drawCockpit } from './view.mjs'
import { readyItems, decideConfig } from '../lib/decide.mjs'
import { depuisConfig } from '../lib/depuis.mjs'

const PANE = 'cockpit'
let options = {}
let CFG = null // cockpit.config.json (+ user file)
let FCFG = null // factory.config.json + workflow.config.json (lib copies, + ~/.claude/effort-board/factory.config.json)
const ALIASES = new Set() // old command names this session serves (their own mod is not loaded)
const D = {
  scan: null, nav: null, self: null, busy: false, error: '', at: 0, open: false, filter: 'all', strips: null,
  usage: null, usageRaw: null, veille: null, columns: 0, conso: null, consoData: null, consoPreset: '', consoScan: false,
  tab: 'home', jfilter: 'all', jproject: '', cardsRaw: null, cardsError: '', cardsAt: 0,
  wf: null, wfAt: 0, wfBusy: false, wfError: '', wfScope: null, wfOpen: {}, wfAll: null,
  machine: { sample: null, runner: null, prev: null, tick: 0, missing: false, metricsMissing: false, error: '' },
  who: null, nuitRaw: null, nuitBusy: false, relaisRaw: null, relaisBusy: false, galerieRaw: null, galerieBusy: false,
  galView: 'equipe', launch: null, nuitMsg: '', identity: undefined, engine: '',
  depuisRaw: null, depuisBusy: false, depuisAt: 0, depuisPreset: '', depuisOpen: {}, depuisAsk: false, depuisMsg: '', depuisError: '',
}

const decideLabels = () => decideConfig(CFG || {}).nuit.labels

const norm = (p) => String(p || '').replace(/\\/g, '/')
const root = ($) => norm($.plugin.root).replace(/\/+$/, '')
const sibling = ($, mod) => root($).replace(/\/[^/]+$/, '') + '/' + mod

async function homeDir($) {
  return norm((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '')
}

async function board($) {
  const o = await $.env.get('FACTORY_BOARD')
  return o ? norm(o) : (await homeDir($)) + '/.claude/effort-board'
}

async function readJson($, path) {
  try {
    if (!(await $.fs.exists(path))) return null
    return JSON.parse(String(await $.fs.read(path)).replace(/^﻿/, ''))
  } catch {
    return null
  }
}

function expand(p, home) {
  return p && p.startsWith('~') ? home + p.slice(1) : p
}

async function loadConfig($) {
  const home = await homeDir($)
  const base = (await readJson($, root($) + '/cockpit.config.json')) || {}
  const userPath = (options.config || '').trim() ? expand(options.config.trim(), home) : (await board($)) + '/cockpit.config.json'
  CFG = deepMerge(base, (await readJson($, userPath)) || {})
  const fbase = (await readJson($, root($) + '/lib/factory/factory.config.json')) || {}
  const wf = await readJson($, root($) + '/lib/factory/workflow.config.json')
  FCFG = deepMerge(deepMerge(fbase, wf ? { workflow: wf } : {}), (await readJson($, (await board($)) + '/factory.config.json')) || {})
  if (!D.strips) D.strips = Object.fromEntries(cockpitConfig(CFG).sections.open.map((k) => [k, true]))
  return CFG
}

// ---- data ------------------------------------------------------------------------------------------------------------

async function rescan($) {
  if (D.busy) return
  D.busy = true
  $.ui.invalidate('ui.render')
  try {
    if (!CFG) await loadConfig($)
    const detail = (D.nav && D.nav.conv) || D.self
    const argv = [FCFG.python || 'python', ...scanArgs(FCFG, {
      script: root($) + '/lib/factory/scanner/factory_scan.py', cache: (await board($)) + '/cockpit_cache.json', detail,
      extra: [...waitingArgs(FCFG), '--recent', String(screensConfig(FCFG).recent_events)],
    })]
    const r = await $.process.run(argv, { timeoutMs: 180000 })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `scanner exit ${r.exitCode}`)
    D.scan = JSON.parse(r.stdout)
    D.error = ''
    D.at = await $.clock.now()
    if (!D.nav) D.nav = initialNav(D.scan, D.self, CFG)
  } catch (err) {
    D.error = String(err && err.message ? err.message : err).slice(0, 300)
  } finally {
    D.busy = false
  }
  $.ui.invalidate('ui.render')
}

// factory's Workflow scanner (copy). scope: the tab's choice; the « En cours » card always reads every Workflow.
async function scanWorkflows($, scope) {
  const cfg = FCFG || {}
  const argv = [cfg.python || 'python', ...workflowArgs(cfg, {
    script: root($) + '/lib/factory/scanner/workflow_scan.py', cache: `${await board($)}/cockpit_workflow_${scope === 'all' ? 'all' : 'conv'}.json`, scope, session: D.self || '',
  })]
  const r = await $.process.run(argv, { timeoutMs: 180000 })
  if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `workflow_scan exit ${r.exitCode}`)
  return JSON.parse(r.stdout)
}

async function rescanWorkflow($) {
  if (D.wfBusy) return
  D.wfBusy = true
  $.ui.invalidate('ui.render')
  try {
    if (!CFG) await loadConfig($)
    const scope = D.wfScope || workflowConfig(FCFG).scope
    D.wf = await scanWorkflows($, scope)
    if (scope === 'all') D.wfAll = D.wf
    D.wfError = ''
    D.wfAt = await $.clock.now()
  } catch (err) {
    D.wfError = String(err && err.message ? err.message : err).slice(0, 300)
  } finally {
    D.wfBusy = false
  }
  $.ui.invalidate('ui.render')
}

// The settings the Node scanner needs (the decision screens' and the to-do card's).
const scanCfg = () => ({ nuit: (CFG && CFG.nuit) || {}, galerie: (CFG && CFG.galerie) || {}, controle: (CFG && CFG.controle) || {}, depuis: (CFG && CFG.depuis) || {} })

async function runScanner($, req) {
  const r = await $.process.run([(CFG && CFG.node) || 'node', root($) + '/scanner/cards.mjs'], { stdin: JSON.stringify({ home: await homeDir($), cfg: scanCfg(), ...req }), timeoutMs: 120000 })
  if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `cards exit ${r.exitCode}`)
  return JSON.parse(r.stdout)
}

// One decision screen's data (nuit, relais, galerie) from the same scanner.
async function loadPart($, part) {
  const busy = part + 'Busy'
  if (D[busy]) return
  D[busy] = true
  $.ui.invalidate('ui.render')
  try {
    const now = await $.clock.now()
    const req = { now, parts: [part] }
    if (part === 'nuit') req.repos = nightRepos(D.scan, CFG || {}, now)
    if (part === 'galerie') req.cache = (await board($)) + '/cockpit_codex_approvals.json'
    if (part === 'depuis') { req.preset = D.depuisPreset; req.cache = (await board($)) + '/cockpit_depuis_prs.json' }
    const out = await runScanner($, req)
    D[part + 'Raw'] = out[part] || null
    if (part === 'depuis') { D.depuisAt = now; D.depuisError = '' }
  } catch (err) {
    D[part + 'Raw'] = null
    if (part === 'depuis') D.depuisError = String(err && err.message ? err.message : err).slice(0, 200)
    D.cardsError = String(err && err.message ? err.message : err).slice(0, 200)
  } finally {
    D[busy] = false
  }
  $.ui.invalidate('ui.render')
}

const whoOf = () => D.who || cardsConfig(CFG || {}).who || 'claude'

// Everything that runs now, for « Bilan avant la nuit »: Workflows, lone agents and pipelines (Claude and Codex).
function runningNow(now) {
  const wf = workflowsLive(D.wfAll ? workflowScreen(D.wfAll, FCFG || {}, now) : null).map((w) => ({ kind: 'workflow', text: `Workflow ${w.name}`, eta: w.eta }))
  const pipes = ((D.cardsRaw && D.cardsRaw.pipelines) || []).map((p) => ({ kind: 'pipeline', text: `Pipeline ${p.app}${p.branch ? ` (${p.branch})` : ''}${p.who === 'codex' ? ' · Codex' : p.who === 'claude' ? ' · Claude' : ''}`, eta: p.eta }))
  let lone = []
  try { lone = D.scan ? loneAgents(D.scan, FCFG || {}, now, { scope: 'all' }) : [] } catch { lone = [] }
  return [...wf, ...lone.map((a) => ({ kind: 'agent', text: `Agent ${a.type}${a.desc ? ' · ' + a.desc : ''} (${a.conv})`, eta: a.eta })), ...pipes]
}

// The cards' data: scanner/cards.mjs (Node, lib/core) and every Workflow of the PC for « En cours ».
async function loadCards($) {
  const now = await $.clock.now()
  try {
    D.cardsRaw = await runScanner($, { now, parts: ['cards'] })
    D.cardsError = ''
  } catch (err) {
    D.cardsError = String(err && err.message ? err.message : err).slice(0, 200)
  }
  try { D.wfAll = await scanWorkflows($, 'all') } catch { /* the card says « rien ne tourne » */ }
  D.cardsAt = now
  D.machine.runner = runnerBackends(D.cardsRaw && D.cardsRaw.runner)
  $.ui.invalidate('ui.render')
}

// The pure card list from what is in memory (drawn at every render).
function cards(now) {
  const raw = D.cardsRaw || {}
  const wfScreen = D.wfAll ? workflowScreen(D.wfAll, FCFG || {}, now) : null
  let waiting = 0
  try { waiting = D.scan ? waitingRows(D.scan, FCFG || {}, D.at || now).rows.length : 0 } catch { waiting = 0 }
  let lone = []
  try { lone = D.scan ? loneAgents(D.scan, FCFG || {}, D.at || now, { scope: 'all' }) : [] } catch { lone = [] }
  return cardsOf({
    conso: D.conso, veille: raw.veille || null, waiting, quotas: raw.quotas || null, runnerText: raw.runnerText || '',
    ci: raw.ci || null, ciBy: raw.ciBy || null, problemes: raw.problemes || null, workflows: workflowsLive(wfScreen), pipelines: raw.pipelines || [],
    lone, controle: raw.controle || null, who: whoOf(),
  }, CFG || {}, now)
}

// PC load through the machine mod's sampler (copy in lib/machine); the runner load comes with the cards (lib/core).
async function sampleMachine($) {
  const c = cockpitConfig(CFG || {})
  const M = D.machine
  const py = (FCFG && FCFG.python) || 'python'
  try {
    const gpu = M.tick % Math.max(1, c.gpu_every) === 0
    M.tick += 1
    const r = await $.process.run([py, '-I', root($) + '/lib/machine/scanner/machine.py', 'sample'], { stdin: JSON.stringify({ prev: M.prev, gpu, top_n: 5 }), timeoutMs: 20000 })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `machine exit ${r.exitCode}`)
    const s = JSON.parse(r.stdout)
    M.prev = s.raw
    if (!gpu && M.sample && M.sample.gpu) s.gpu = M.sample.gpu
    M.sample = s
    M.error = ''
  } catch (err) {
    M.error = String(err && err.message ? err.message : err).slice(0, 200)
  }
  if (!M.runner) await loadCards($).catch(() => undefined)
  $.ui.invalidate('ui.render')
}

// « Claude global »: the usage card from the engine's figures ($.session.usage, cheap) and veille's files. The context
// gauge lives in band, above the prompt (where Julian looks), not here.
async function refreshStrips($) {
  const now = await $.clock.now()
  try { D.usageRaw = await $.session.usage() } catch { D.usageRaw = null }
  const me = D.scan ? findSession(D.scan, D.self) : null
  D.usage = usageCard(D.usageRaw, me, FCFG || {}, now)
  await loadConso($, now).catch(() => undefined)
  await loadVeille($)
  if (D.tab === 'home') await loadCards($).catch(() => undefined)
  $.ui.invalidate('ui.render')
}

// « Qui consomme »: reads the usage mod's classement.json. When it is older than rescan_min and the section is open,
// runs usage's own incremental scanner once in the background (read-only; byte offsets, so only new lines are read).
async function loadConso($, now) {
  const q = cockpitConfig(CFG).qui_consomme
  const ucfg = (await readJson($, sibling($, 'usage') + '/usage.config.json')) || {}
  const dir = norm(expand(q.data_dir || ucfg.data_dir || '~/.claude/usage-mod', await homeDir($)))
  D.consoData = await readJson($, dir + '/classement.json')
  D.conso = consoCard(D.consoData, CFG, now, D.consoPreset || q.default)
  const old = !D.consoData || now - (D.consoData.generated || 0) > q.rescan_min * 60000
  if (old && (D.strips || {}).conso && !D.consoScan && ucfg.data_dir !== undefined) {
    D.consoScan = true
    $.clock.after(0, async () => {
      try { await $.process.run([ucfg.node || 'node', sibling($, 'usage') + '/scanner/usage_scan.mjs', 'scan'], { timeoutMs: 600000 }) } catch { /* the card says so */ }
      D.consoScan = false
      D.consoData = await readJson($, dir + '/classement.json')
      D.conso = consoCard(D.consoData, CFG, await $.clock.now(), D.consoPreset || q.default)
      $.ui.invalidate('ui.render')
    })
  }
}

async function loadVeille($) {
  const dir = sibling($, 'veille')
  const base = await readJson($, dir + '/veille.config.json')
  if (!base) { D.veille = null; return }
  const o = await $.env.get('VEILLE_HOME')
  const h = o ? norm(o) : (await homeDir($)) + '/.claude/veille'
  const cfg = vmerge(base, (await readJson($, h + '/config.json')) || {})
  const state = await readJson($, h + '/state.json')
  const heartbeat = await readJson($, h + '/heartbeat.json')
  let acks = []
  try {
    const t = (await $.fs.exists(h + '/acks.jsonl')) ? String(await $.fs.read(h + '/acks.jsonl')) : ''
    acks = t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).key } catch { return null } }).filter(Boolean)
  } catch { acks = [] }
  D.veille = state || heartbeat ? viewModel(cfg, state, heartbeat, acks, await $.clock.now()) : null
}

// How the session is signed in, for the Galerie's Carte: $.session.identity() (engine 2.1.299+) answers only a mod
// that managed settings install, { deny } to the others; older engines have no such method. Asked once.
async function loadIdentity($) {
  if (D.identity !== undefined) return
  D.identity = null
  if (!engineAtLeast(D.engine, '2.1.299')) return
  try {
    const r = await $.session.identity()
    D.identity = r && !r.deny && typeof r.kind === 'string' ? { kind: r.kind } : null
  } catch { D.identity = null }
}

// « Ouvrir l'agent »: the engine's transcript view of one running agent of this conversation ($.ui.view, 2.1.300+;
// a button press is person-initiated, which the engine requires). Older engines: the button is not drawn.
const VIEW_MIN = '2.1.300'

async function viewAgent($, target) {
  const L = cockpitConfig(CFG || {}).labels
  if (!engineAtLeast(D.engine, VIEW_MIN)) { $.ui.toast(L.view_old); return }
  try {
    const r = await $.ui.view(target)
    if (r && r.deny) $.ui.toast(L.view_denied.replace('{reason}', r.deny))
  } catch (err) {
    $.ui.toast(L.view_denied.replace('{reason}', String(err && err.message ? err.message : err).slice(0, 120)))
  }
}

// What the tab on screen needs, now.
async function refreshTab($) {
  if (D.tab === 'workflow') return rescanWorkflow($)
  if (D.tab === 'machine') return sampleMachine($)
  if (D.tab === 'relais') return loadPart($, 'relais')
  if (D.tab === 'nuit') { await rescan($); await loadCards($).catch(() => undefined); return loadPart($, 'nuit') }
  if (D.tab === 'galerie') { await rescan($); await loadIdentity($); return loadPart($, 'galerie') }
  if (D.tab === 'depuis') {
    await rescan($) // the waiting rows (lib/core/waiting.mjs) come from factory's scan
    try { D.wfAll = await scanWorkflows($, 'all') } catch { /* no Workflow lines */ }
    return loadPart($, 'depuis')
  }
  await rescan($)
  if (D.tab === 'home') await refreshStrips($).catch(() => undefined)
}

// Shown = open, placed, and the tab on screen (another pane, e.g. filetree, may be the one shown).
async function shown($) {
  if (!D.open) return false
  try {
    const p = ((await $.ui.panes()) || []).find((x) => x.id === PANE)
    return Boolean(p && p.isPlaced && p.isShown !== false)
  } catch {
    return D.open
  }
}

// ---- actions ---------------------------------------------------------------------------------------------------------

// A card's button: the first target loaded in this session ($.command.list(), local), or one of cockpit's own tabs.
async function runTarget($, candidates) {
  let names = []
  try { names = ((await $.command.list()) || []).map((c) => c.name) } catch { names = [] }
  const t = pickTarget(candidates, names)
  if (t && t.tab) { setTab($, t.tab); return }
  if (!t) {
    const first = (candidates || []).find((c) => c.command)
    $.ui.toast(cardsConfig(CFG).labels.not_loaded.replace('{command}', first ? '/' + first.command : '?'))
    return
  }
  void $.command.run(t.args ? { command: t.command, args: t.args } : { command: t.command }).catch(() => $.ui.toast(`/${t.command} : échec`))
}

function setTab($, tab) {
  D.tab = tabValid(CFG, tab) ? tab : 'home'
  if (D.tab === 'nuit') { D.launch = null; D.nuitMsg = '' }
  if (D.tab === 'depuis') D.depuisMsg = ''
  $.ui.invalidate('ui.render')
  void refreshTab($)
}

function actions($) {
  const redraw = () => $.ui.invalidate('ui.render')
  return {
    tab: (id) => setTab($, id),
    crumb: (level) => { D.nav = zoomTo(D.nav, level); redraw() },
    select: (node) => {
      const before = D.nav && D.nav.conv
      D.nav = select(D.nav || { level: 'mega' }, node)
      const sec = sectionFor(node)
      if (sec) D.strips = { ...(D.strips || {}), [sec]: true }
      redraw()
      if (D.nav.conv && D.nav.conv !== before && !(D.scan && D.scan.detail && D.scan.detail.cli === D.nav.conv)) void rescan($)
    },
    refresh: () => { void refreshTab($) },
    filter: (k) => { D.filter = k; redraw() },
    jfilter: (k) => { D.jfilter = k; redraw() },
    jproject: (p) => { D.jproject = p; redraw() },
    pick: () => { D.tab = 'home'; D.strips = { ...(D.strips || {}), all: true }; redraw() },
    go: (cli) => {
      const s = D.scan && findSession(D.scan, cli)
      D.nav = select(D.nav || { level: 'mega' }, { kind: 'conv', id: cli, repo: s ? repoOf(s) : undefined })
      D.tab = 'arbre'
      redraw()
      void rescan($)
    },
    wfScope: (k) => { D.wfScope = k; redraw(); void rescanWorkflow($) },
    wfToggle: (key, open) => { D.wfOpen = { ...D.wfOpen, [key]: open }; redraw() },
    toggle: (id) => {
      D.strips = { ...(D.strips || {}), [id]: !(D.strips || {})[id] }
      redraw()
      if ((id === 'global' || id === 'conso') && D.strips[id]) void refreshStrips($)
    },
    card: (card) => { void runTarget($, card.button) },
    files: () => { void $.command.run({ command: 'filetree' }).catch(() => $.ui.toast('filetree non chargé : ajoute vendor/filetree à CLAUDE_CODE_PLUGIN_DIRS')) },
    consoPreset: (id) => {
      D.consoPreset = id
      void $.clock.now().then((now) => { D.conso = consoCard(D.consoData, CFG, now, id); redraw() })
    },
    consoFull: () => {
      const q = cockpitConfig(CFG).qui_consomme
      void $.command.run({ command: q.command, args: q.args }).catch(() => $.ui.toast(cockpitConfig(CFG).labels.conso_missing))
    },
    machine: () => setTab($, 'machine'),
    // the left menu: another hub's command, or this pane's Cockpit tab
    menu: (m) => {
      if (m.self) { setTab($, 'home'); return }
      void runTarget($, [{ command: m.command, ...(m.args ? { args: m.args } : {}) }])
    },
    who: (w) => { D.who = w; redraw() },
    day: () => { void runTarget($, [{ command: 'veille', args: 'jour' }]) },
    nightOn: () => { void runTarget($, [{ command: 'veille', args: 'nuit' }]) },
    nothing: () => { D.launch = null; D.nuitMsg = ''; setTab($, 'home'); $.ui.toast(decideLabels().nothing_done) },
    launch: (i) => { D.launch = D.launch === i ? null : i; redraw() },
    galView: (v) => { D.galView = v; redraw() },
    openAgent: (id) => { void viewAgent($, { agentId: id }) },
    // « Depuis ton dernier message »
    depuisPreset: (id) => { D.depuisPreset = id; D.depuisMsg = ''; redraw(); void loadPart($, 'depuis') },
    depuisToggle: (name, open) => { D.depuisOpen = { ...D.depuisOpen, [name]: open }; redraw() },
    depuisAsk: () => { D.depuisAsk = !D.depuisAsk; redraw() },
    openConv: (link) => { void openUrl($, link).then((ok) => { if (!ok) $.ui.toast(link) }) },
    copy: (text, press, what) => {
      const L = depuisConfig(CFG || {}).labels
      const done = what === 'id' ? L.copied.replace('{id}', text) : L.ask_copy + ' ✓'
      void $.ui.copy({ text, surface: press && press.surface }).then((r) => { D.depuisMsg = r && r.isCopied === false ? text : done; redraw() }).catch(() => { D.depuisMsg = text; redraw() })
    },
    backToConv: () => { void viewAgent($, {}) },
  }
}

// « Depuis ton dernier message »: the scanner's part plus what the pane already holds (waiting rows, Workflow runs).
function depuisView() {
  let waiting = []
  try { waiting = D.scan ? waitingRows(D.scan, FCFG || {}, D.at || D.depuisAt).rows : [] } catch { waiting = [] }
  return { raw: D.depuisRaw, busy: D.depuisBusy, at: D.depuisAt, error: D.depuisError, preset: D.depuisPreset, open: D.depuisOpen, ask: D.depuisAsk, msg: D.depuisMsg,
    extra: { waiting, workflows: (D.wfAll && D.wfAll.runs) || [] } }
}

// Hands a claude:// link to the OS (its handler is the desktop app), as Veille's Fil does. Windows: url.dll, no shell.
async function openUrl($, url) {
  if (!/^claude:\/\/claude\.ai\/epitaxy\/[\w-]+$/.test(String(url || ''))) return false
  let win = false
  try { win = (await $.env.get('OS')) === 'Windows_NT' } catch { win = false }
  const argv = win ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url] : ['xdg-open', url]
  try { const r = await $.process.run(argv, { timeoutMs: 10000 }); return r.exitCode === 0 } catch { return false }
}

async function openPane($, focus) {
  D.open = true
  const title = (cockpitConfig(CFG).labels || {}).title || 'Cockpit'
  return $.ui.open(focus ? { id: PANE, title, focus: true } : { id: PANE, title })
}

// /cockpit <args> (also the /factory and /machine aliases, mapped by aliasArgs).
async function runCockpit($, args) {
  await loadConfig($)
  try { D.self = (await $.session.id()) || D.self } catch { /* keep */ }
  try { D.engine = ((await $.session.version()) || {}).version || D.engine } catch { /* keep */ }
  const p = parseArgs(args)
  if (p.close) { D.open = false; await $.ui.close({ id: PANE }); return {} }
  await openPane($, true)
  if (!D.scan) await rescan($)
  if (!D.nav && D.scan) D.nav = initialNav(D.scan, D.self, CFG)
  if (p.tab === 'depuis') D.depuisPreset = p.rest
  if (p.rest && D.scan && p.tab !== 'depuis') {
    const s = pickSession(D.scan.sessions, p.rest)
    const repo = !s && (D.scan.sessions || []).map(repoOf).find((r) => r.toLowerCase().includes(p.rest.toLowerCase()))
    if (s) D.nav = select(D.nav, { kind: 'conv', id: s.cli, repo: repoOf(s) })
    else if (repo) D.nav = select(D.nav, { kind: 'project', id: repo })
  }
  if (p.level && D.nav) D.nav = zoomTo(D.nav, p.level) // a level whose subject is unknown (micro without an agent) stays put
  if ((p.level || (p.rest && p.tab !== 'depuis')) && D.nav && (!p.tab || p.tab === 'home')) {
    const sec = { mega: 'all', macro: 'project', medium: 'conv', micro: 'conv' }[D.nav.level]
    if (sec) D.strips = { ...(D.strips || {}), [sec]: true }
  }
  if (p.scope) D.wfScope = p.scope
  D.tab = p.tab && tabValid(CFG, p.tab) ? p.tab : p.level || p.rest ? (D.tab === 'arbre' ? 'arbre' : 'home') : D.tab
  if (D.tab === 'home') { await rescan($); await refreshStrips($).catch(() => undefined) } else await refreshTab($)
  return {}
}

// The old names (/factory, /machine) as aliases, only when no loaded command has them already: the same check band
// makes to grey a button ($.command.list(), local). Registering a name again would replace the other mod's command.
async function registerAliases($) {
  const a = cockpitConfig(CFG || {}).aliases
  if (!a.enabled) return
  let names = []
  try { names = ((await $.command.list()) || []).map((c) => c.name) } catch { return }
  for (const name of a.names) {
    if (names.includes(name) || ALIASES.has(name)) continue
    try {
      await $.command.register({ name, immediate: true, description: `Alias de /cockpit : ${name === 'machine' ? 'onglet Machine (charge du PC et du runner)' : 'écrans de Factory (Mission, Focus, Arbre, Pipeline, Workflow, Journal)'}, maintenant dans Cockpit`,
        argumentHint: name === 'machine' ? '| close' : '[mission|focus|arbre|pipeline|workflow [all]|journal|systeme] [titre ou id] | close' })
      ALIASES.add(name)
    } catch { /* refused: nothing */ }
  }
}

async function aliasHook($, e, next, name) {
  if (!ALIASES.has(name)) return next(e)
  return runCockpit($, aliasArgs(name, e.args))
}

export { parseArgs }

export function register(on, opts) {
  options = opts || {}
  on('session.start', async ($, e, next) => {
    try { D.self = await $.session.id() } catch { D.self = null }
    try { D.engine = ((await $.session.version()) || {}).version || '' } catch { D.engine = '' }
    await loadConfig($).catch(() => { CFG = {}; FCFG = {} })
    const c = cockpitConfig(CFG)
    try {
      await $.command.register({ name: 'cockpit', immediate: true, description: 'Cockpit : Depuis ton dernier message (le résumé de la nuit), cartes (conso, t’attend, à toi, Claude Control, CI, quota, problèmes, en cours), Méga › Projet › Conversation › Agent, écrans Factory, Machine, Claude ↔ Codex, Galerie, Bilan avant la nuit',
        argumentHint: '[conv|projet|mega|agent|mission|focus|arbre|pipeline|workflow [all]|journal|machine|relais|galerie|nuit|depuis [8h|24h|nuit|HH:MM]] [projet ou conversation] | close' })
    } catch { /* a name clash must not break the rest */ }
    $.clock.after(Math.max(0, c.aliases.delay_s) * 1000, () => { void registerAliases($).catch(() => undefined) })
    $.clock.every(Math.max(5, c.refresh_s) * 1000, () => { void shown($).then((s) => (s && D.tab !== 'workflow' && D.tab !== 'machine' ? rescan($) : undefined)) })
    $.clock.every(Math.max(15, c.strips_refresh_s) * 1000, () => { void shown($).then((s) => (s ? (D.tab === 'workflow' ? rescanWorkflow($) : refreshStrips($)) : undefined)) })
    $.clock.every(Math.max(3, c.machine_refresh_s) * 1000, () => { void shown($).then((s) => (s && D.tab === 'machine' ? sampleMachine($) : undefined)) })
    if (c.auto_open && options.start !== 'off') {
      void (async () => {
        await openPane($, false).catch(() => undefined)
        await rescan($)
        await refreshStrips($).catch(() => undefined)
      })()
    }
    return next(e)
  })

  on('command.run', { command: 'cockpit' }, async ($, e) => runCockpit($, e.args))
  on('command.run', { command: 'factory' }, async ($, e, next) => aliasHook($, e, next, 'factory')).catch(($, e, next) => next(e))
  on('command.run', { command: 'machine' }, async ($, e, next) => aliasHook($, e, next, 'machine')).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => { D.open = false; return next(e) }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    D.open = true
    D.columns = Number(e.props && e.props.bodyColumns) || 0
    const now = D.cardsAt || D.at || 0
    const teamCli = (D.nav && D.nav.conv) || D.self
    const teamRow = D.tab === 'galerie' && D.scan ? findSession(D.scan, teamCli) : null
    const teamDetail = teamRow && D.scan.detail && D.scan.detail.cli === teamCli ? D.scan.detail : null
    const laneRepo = teamRow ? repoOf(teamRow) : null
    return drawCockpit(el, {
      who: whoOf(), now: now || D.at, galView: D.galView, launch: D.launch, nuitMsg: D.nuitMsg,
      nuitData: D.tab === 'nuit' ? { running: runningNow(now || D.at), quotas: (D.cardsRaw && D.cardsRaw.quotas) || null, ready: readyItems((D.nuitRaw && D.nuitRaw.repos) || [], CFG || {}) } : null,
      nuitBusy: D.nuitBusy, relaisData: D.relaisRaw && D.relaisRaw.interactions, relaisBusy: D.relaisBusy, galerieData: D.galerieRaw, galerieBusy: D.galerieBusy,
      teamSession: teamRow ? { ...teamRow, ...(teamDetail || {}) } : null, teamTitle: teamRow ? titleOf(teamRow) : '',
      laneRepo, laneRows: laneRepo && D.galView === 'lanes' ? laneRows(D.scan, laneRepo, FCFG || {}) : [], identity: D.identity || null,
      canView: engineAtLeast(D.engine, VIEW_MIN), viewAgent: (e.props && e.props.view && e.props.view.agentId) || null,
      cfg: CFG || {}, fcfg: FCFG || {}, scan: D.scan, nav: D.nav || { level: 'mega', repo: null, conv: null, agent: null }, self: D.self,
      busy: D.busy, error: D.error, at: D.at, columns: D.columns, filter: D.filter, usage: D.usage, veille: D.veille, open: D.strips || {}, act: actions($),
      conso: D.conso, consoPreset: D.consoPreset, tab: D.tab, jfilter: D.jfilter, jproject: D.jproject,
      cards: D.tab === 'home' ? cards(now || D.at) : [],
      depuis: D.tab === 'depuis' ? depuisView() : null, cardsError: D.cardsError, cardsAt: D.cardsAt,
      wf: D.wf, wfAt: D.wfAt, wfBusy: D.wfBusy, wfError: D.wfError, wfScope: D.wfScope, wfOpen: D.wfOpen, machine: D.machine,
    })
  })
}
