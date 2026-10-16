// reference mod (« Référence »): one side pane with tabs Config | Guide | Scénarios | Santé | CI | À essayer | R&D | Repos.
//   /reference [config|guide|scenarios|sante|ci [diagramme]|essais|rd [audit]|repos|close]   /audit-export
// À essayer, R&D and Repos read what scanner/rd_scan.mjs (Node) finds in the research folders, the manual checks, the
// tests-reels registry and the repos (git, gh); their buttons act only on Julian's click: an item's state (written to
// ~/.claude/reference-mod/essais.json), Exporter vers eta (research docs by PR, export-eta's flow), Exporter pour audit
// (a masked zip under ~/.claude/audit-exports), Mettre à jour (git pull --ff-only on a clean main checkout).
// Each tab draws with a synced copy of its owner's pure view code (lib/<mod>/hooks/*, made by scripts/sync-libs.mjs
// from mods/control, guide, scenarios, sante, ci) and reads the owner's caches: control's config-claude.json (secrets
// masked by its scanner), MODE-EMPLOI.md (copy), scenarios.json (copy), sante's report.json, ci's caches through ci.py.
// The old commands (/config-claude, /control, /mods-guide, /scenarios, /sante, /ci) are registered here only when no
// loaded mod already has them, so Julian's habits keep working once the owners are unloaded.
// Read-only: no tool call or prompt is touched and no model is called. Writes: « Appliquer ce scénario »
// (~/.claude/scenarios/applied.json and applied.prev.json only), and what the owners' own scanners write when a
// Rescan / Rafraîchir / ↻ button runs them (their caches and health records) or ci's Clear button (its routing file).
import type { EngineInterface, Register } from 'claude-code'

import { drawCi } from '../lib/ci/hooks/draw'
import type { CiTab } from '../lib/ci/hooks/draw'
import { parseDiagram, parseDiagramWords } from '../lib/ci/hooks/diagram'
import { parseSnapshot } from '../lib/ci/hooks/view'
import { drawConfig, shardsNeeded } from '../lib/control/hooks/config_draw'
import { toggle } from '../lib/control/hooks/config_view'
import { SOMMAIRE, drawGuide, findIn, liveDoc } from '../lib/guide/hooks/draw'
import type { Where } from '../lib/guide/hooks/draw'
import { drawSante } from '../lib/sante/hooks/draw'
import { splitDirs } from '../lib/sante/hooks/logic.mjs'
import { applyScenario, readApplied } from '../lib/scenarios/hooks/apply_io'
import { drawScenarios } from '../lib/scenarios/hooks/draw'
import { KINDS, check, merge, parseArgs as scenarioArgs } from '../lib/scenarios/hooks/logic'
import type { Kind } from '../lib/scenarios/hooks/logic'
import { STATES, nextState, overlay, setState } from '../lib/rd/essais.mjs'
import { ALIASES, ACTION_COMMANDS, aliasArgs, deepMerge, expandHome, missingAliases, parseArgs, tabsOf } from './nav'
import { drawEssais, drawRd, drawRepos } from './rd_draw'
import type { Parsed, Tab } from './nav'

const PANE = 'reference'
type Options = { config?: string }
let options: Options = {}
let projectDir = ''

// What the pane shows, per tab. Module state: a reload starts on the default tab again.
const R = {
  tab: '' as Tab | '',
  guide: { tab: SOMMAIRE, cat: '', sub: '' } as Where,
  scen: { selected: '', kind: 'prompt' as Kind, copied: '', applyMsg: '' },
  cfg: { open: [] as string[], current: '', query: '', raw: false, page: 0, busy: false, problem: '' },
  sante: { report: undefined as any, error: '', busy: false, copied: '', commands: [] as any[], engine: '' },
  ci: { tab: 'routing' as CiTab, snapshot: '', diagram: '', error: '', checking: false, fetching: false, who: 'all' as any, group: 'host' as any, folded: [] as string[] },
  essais: { data: undefined as any, at: 0, error: '', open: ['en test', 'jamais'] as string[] },
  rd: { data: undefined as any, at: 0, error: '' },
  repos: { data: undefined as any, at: 0, error: '' },
  busy: '',
  msg: '',
}
const redraw = ($: EngineInterface) => $.ui.invalidate('ui.render')

// ---- files -------------------------------------------------------------------------------------------------------

const text = async ($: EngineInterface, path: string): Promise<string | undefined> => {
  try {
    return (await $.fs.read(path, { as: 'text' })) as string
  } catch {
    return undefined
  }
}
const readJson = async ($: EngineInterface, path: string): Promise<any> => {
  const t = await text($, path)
  try {
    return t ? JSON.parse(t.replace(/^﻿/, '')) : undefined
  } catch {
    return undefined
  }
}
const exists = async ($: EngineInterface, path: string) => {
  try {
    return await $.fs.exists(path)
  } catch {
    return false
  }
}
const io = ($: EngineInterface) => ({ read: (p: string) => text($, p), write: (p: string, t: string) => $.fs.write(p, t) })
const root = ($: EngineInterface) => $.plugin.root.replace(/\\/g, '/').replace(/\/+$/, '')
const modsDir = ($: EngineInterface) => root($).replace(/\/[^/]+$/, '')
const home = async ($: EngineInterface) => {
  let v: string | undefined
  try {
    v = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  } catch {}
  return (v ?? '').replace(/\\/g, '/')
}

async function context($: EngineInterface) {
  const hd = await home($)
  const base = (await readJson($, `${root($)}/reference.config.json`)) || {}
  let cfg = deepMerge(base, (await readJson($, `${hd}/.claude/reference-mod/reference.config.json`)) || {})
  if (options.config?.trim()) cfg = deepMerge(cfg, (await readJson($, expandHome(options.config.trim(), hd))) || {})
  const p = cfg.paths || {}
  const path = (k: string, d: string) => expandHome(p[k] || d, hd)
  return {
    cfg, home: hd, L: (cfg.labels || {}) as Record<string, string>,
    claudeDir: path('claude_dir', '~/.claude'),
    controlOut: path('control_out_dir', '~/.claude/effort-board/control'),
    santeDir: path('sante_data_dir', '~/.claude/sante-mod'),
    ciCache: path('ci_pipelines_cache', '~/.claude/ci-pipelines-cache.json'),
    scenariosFile: p.scenarios_file ? path('scenarios_file', '') : '',
    refDir: path('reference_dir', '~/.claude/reference-mod'),
  }
}
type Ctx = Awaited<ReturnType<typeof context>>

// ---- Config (control's scanner output) -----------------------------------------------------------------------------

let shardCache: { generated: string; shards: Map<number, Record<string, string>> } = { generated: '', shards: new Map() }
async function shard($: EngineInterface, out: string, data: any, n: number): Promise<Record<string, string>> {
  if (shardCache.generated !== data.generated) shardCache = { generated: data.generated, shards: new Map() }
  const hit = shardCache.shards.get(n)
  if (hit) return hit
  const got = ((await readJson($, `${out}/${data.shards[n]}`)) ?? {}) as Record<string, string>
  shardCache.shards.set(n, got)
  return got
}

async function configScan($: EngineInterface) {
  if (R.cfg.busy) return
  const scanner = `${modsDir($)}/control/scanner/control_scan.py`
  if (!(await exists($, scanner))) {
    R.cfg.problem = 'mod control absent : /config-claude scan dans une session où il est chargé'
    return redraw($)
  }
  R.cfg.busy = true
  redraw($)
  try {
    const { cfg } = await context($)
    const r = await $.process.run([cfg.python || 'python', '-I', scanner, 'config', '--config', `${modsDir($)}/control/config.json`, ...(projectDir ? ['--project', projectDir] : [])], { timeoutMs: 600000 })
    R.cfg.problem = r.exitCode === 0 ? '' : ((r.stderr || '').trim().split('\n').pop() || `exit ${r.exitCode}`).slice(0, 200)
  } catch (err) {
    R.cfg.problem = String(err).slice(0, 200)
  }
  R.cfg.busy = false
  redraw($)
}

async function drawConfigTab($: EngineInterface, ui: any, c: Ctx) {
  const ccfg = (await readJson($, `${root($)}/lib/control/config.json`)) || {}
  const user = ccfg.paths?.user_config ? await readJson($, expandHome(ccfg.paths.user_config, c.home)) : undefined
  const cc = deepMerge(ccfg, user || {}).config_claude || {}
  const out = user?.paths?.out_dir ? expandHome(user.paths.out_dir, c.home) : c.controlOut
  const data = await readJson($, `${out}/config-claude.json`)
  const contents: Record<string, string> = {}
  if (data) for (const n of shardsNeeded(data, R.cfg.current, R.cfg.query)) Object.assign(contents, await shard($, out, data, n))
  return drawConfig(ui, {
    data, out, labels: cc.labels, viewerChars: cc.viewer_chars, contents, ...R.cfg, now: Date.now(),
    onRescan: () => { $.clock.after(0, () => configScan($)) },
    onFlip: id => { R.cfg.open = toggle(R.cfg.open, id); redraw($) },
    onPick: id => { R.cfg.current = R.cfg.current === id ? '' : id; R.cfg.page = 0; redraw($) },
    onRaw: () => { R.cfg.raw = !R.cfg.raw; redraw($) },
    onPage: d => { R.cfg.page = Math.max(0, R.cfg.page + d); redraw($) },
    onQuery: v => { R.cfg.query = v; redraw($) },
  })
}

// ---- Guide (MODE-EMPLOI.md copy, live cards from the mods beside this one) -----------------------------------------

const guideDoc = ($: EngineInterface) =>
  liveDoc(p => text($, p), `${root($)}/lib/guide/MODE-EMPLOI.md`, `${root($)}/lib/guide/mods.json`, modsDir($), "Mode d'emploi des mods")

// ---- Scénarios (scenarios.json copy + the user's file) -------------------------------------------------------------

async function scenarios($: EngineInterface, c: Ctx) {
  const shipped = await readJson($, `${root($)}/lib/scenarios/scenarios.json`)
  const problems: string[] = shipped ? [] : ['cannot read lib/scenarios/scenarios.json']
  let extra
  if (c.scenariosFile) {
    extra = await readJson($, c.scenariosFile)
    if (!extra) problems.push(`${c.scenariosFile}: missing or not valid JSON`)
  }
  const checked = check(merge(shipped, extra))
  return { ...checked, errors: [...problems, ...checked.errors] }
}

// ---- Santé (sante's report and scanner, copied in lib/sante) -------------------------------------------------------

async function santeCfg($: EngineInterface, c: Ctx) {
  const base = (await readJson($, `${root($)}/lib/sante/sante.config.json`)) || {}
  return deepMerge(base, (await readJson($, `${c.santeDir}/sante.config.json`)) || {})
}

async function santeFacts($: EngineInterface) {
  try {
    R.sante.commands = (await $.command.list()).map(x => ({ name: x.name, source: x.source, ...(x.plugin ? { plugin: x.plugin } : {}) }))
  } catch {}
  try {
    R.sante.engine = (await $.session.version()).version
  } catch {}
}

async function santeScan($: EngineInterface) {
  if (R.sante.busy) return
  R.sante.busy = true
  redraw($)
  try {
    await santeFacts($)
    const c = await context($)
    const cfg = await santeCfg($, c)
    const dirs = String((await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')) ?? '')
    const r = await $.process.run([c.cfg.node || cfg.node || 'node', `${root($)}/lib/sante/scanner/sante_scan.mjs`], {
      stdin: JSON.stringify({
        dirs: dirs.trim() ? (dirs.includes(';') ? dirs.split(';') : /^[A-Za-z]:[\\/]/.test(dirs.trim()) ? [dirs] : dirs.split(':')).map(x => x.trim().replace(/^"|"$/g, '')).filter(Boolean) : [],
        home: c.home, cfg, now: await $.clock.now(), siblings: cfg.siblings === false ? [] : [modsDir($)],
        commands: R.sante.commands, engine: R.sante.engine,
      }),
      timeoutMs: Math.min((cfg.scan_timeout_s ?? 60) * 1000, 600000),
    })
    const out = JSON.parse(r.stdout || '{}')
    if (r.exitCode !== 0 || out.error) throw new Error(out.error || (r.stderr || '').trim().split('\n').pop() || `scanner exit ${r.exitCode}`)
    R.sante.report = out
    R.sante.error = ''
  } catch (err) {
    R.sante.error = String((err as Error)?.message ?? err).slice(0, 300)
  } finally {
    R.sante.busy = false
  }
  redraw($)
}

async function santeLoad($: EngineInterface, c: Ctx) {
  if (!R.sante.report) R.sante.report = await readJson($, `${c.santeDir}/report.json`)
  const now = await $.clock.now()
  const stale = !R.sante.report || now - (R.sante.report.generated || 0) > (c.cfg.sante_refresh_min ?? 10) * 60000
  return { now, stale }
}

// ---- CI (ci.py beside this mod, else the pipelines cache) -----------------------------------------------------------

async function ciRun($: EngineInterface, args: string[], timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const script = `${modsDir($)}/ci/scanner/ci.py`
  if (!(await exists($, script))) return { ok: false, error: 'mod ci absent' }
  try {
    const { cfg } = await context($)
    const r = await $.process.run([cfg.python || 'python', '-I', script, ...args], { timeoutMs })
    let json: any
    try {
      json = JSON.parse(r.stdout)
    } catch {}
    if (r.exitCode !== 0 || !json) return { ok: false, error: json?.error ?? ((r.stderr || '').trim().split('\n').pop() || `exit ${r.exitCode}`) }
    return { ok: true, text: r.stdout }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

async function ciRouting($: EngineInterface, mode: 'cache' | 'check' | 'force') {
  let id = ''
  try {
    id = await $.session.id()
  } catch {}
  if (mode !== 'cache') { R.ci.checking = true; redraw($) }
  const r = await ciRun($, ['show', '--cwd', projectDir, ...(id ? ['--session', id] : []), ...(mode === 'check' ? ['--check'] : mode === 'force' ? ['--refresh'] : [])], mode === 'cache' ? 20000 : 120000)
  R.ci.checking = false
  if (r.ok) { R.ci.snapshot = r.text; R.ci.error = '' } else R.ci.error = r.error
  redraw($)
}

async function ciDiagram($: EngineInterface, mode: 'cache' | 'check' | 'force') {
  if (mode !== 'cache') { R.ci.fetching = true; redraw($) }
  const r = await ciRun($, ['pipelines', ...(mode === 'check' ? ['--check'] : mode === 'force' ? ['--refresh'] : [])], mode === 'cache' ? 20000 : 300000)
  R.ci.fetching = false
  if (r.ok) { R.ci.diagram = r.text; R.ci.error = '' } else {
    const c = await context($)
    const cache = await readJson($, c.ciCache)
    if (cache && Array.isArray(cache.apps)) {
      const { history: _h, ...rest } = cache
      R.ci.diagram = JSON.stringify(rest)
    }
    R.ci.error = mode === 'cache' && r.error === 'mod ci absent' ? '' : r.error
  }
  redraw($)
}

// ---- À essayer, R&D, Repos (scanner/rd_scan.mjs) ------------------------------------------------------------------

async function pluginDirs($: EngineInterface): Promise<string[]> {
  let dirs = ''
  try {
    dirs = String((await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')) ?? '').trim()
  } catch {}
  if (!dirs) return []
  const list = dirs.includes(';') ? dirs.split(';') : /^[A-Za-z]:[\\/]/.test(dirs) ? [dirs] : dirs.split(':')
  return list.map(x => x.trim().replace(/^"|"$/g, '')).filter(Boolean)
}

/** Runs the scanner with the merged config on stdin; its JSON answer, or { ok: false, error }. */
async function rdRun($: EngineInterface, args: string[], timeoutMs = 60000): Promise<any> {
  try {
    const c = await context($)
    const r = await $.process.run([c.cfg.node || 'node', `${root($)}/scanner/rd_scan.mjs`, ...args], {
      stdin: JSON.stringify({ cfg: c.cfg, home: c.home, modsDir: modsDir($), pluginDirs: await pluginDirs($), now: await $.clock.now() }),
      timeoutMs,
    })
    let out: any
    try {
      out = JSON.parse(r.stdout || '')
    } catch {}
    if (!out) return { ok: false, error: ((r.stderr || '').trim().split('\n').pop() || `exit ${r.exitCode}`).slice(0, 300) }
    return out
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err).slice(0, 300) }
  }
}

const STALE_MS = 5 * 60000
async function load($: EngineInterface, which: 'essais' | 'rd' | 'repos', force = false, extra: string[] = []) {
  const slot = R[which]
  const now = await $.clock.now()
  if (!force && slot.data && now - slot.at < STALE_MS) return
  const out = await rdRun($, [which, ...extra], which === 'repos' ? 180000 : 60000)
  if (out && out.ok === false) slot.error = out.error
  else {
    slot.data = out
    slot.error = ''
    slot.at = now
  }
  redraw($)
}

/** One click at a time: busy label, the scanner's one-line answer in R.msg, then a redraw. */
async function act($: EngineInterface, label: string, run: () => Promise<string>) {
  if (R.busy) return
  R.busy = label
  R.msg = ''
  redraw($)
  try {
    R.msg = await run()
  } catch (err) {
    R.msg = String((err as Error)?.message ?? err).slice(0, 300)
  } finally {
    R.busy = ''
    redraw($)
  }
}

const auditText = (r: any) =>
  r && r.ok !== false
    ? `export pour audit : ${r.file} (${r.files} fichiers, ${r.masked} masqués, ${r.held} retenus, ${r.mods} mods)`
    : `export pour audit impossible : ${r?.error ?? '?'}`
const auditExport = ($: EngineInterface) => rdRun($, ['audit-export'], 300000).then(auditText)
const etaExport = ($: EngineInterface) =>
  rdRun($, ['export-rd'], 600000).then(r =>
    r && r.ok !== false
      ? `recherches vers eta : ${r.files} fichier(s) · ${r.url ?? 'pas de PR'}${r.merged ? ' · mergée' : ''}`
      : `export vers eta : ${r?.error ?? '?'}${r?.url ? ` · ${r.url}` : ''}`,
  )

async function openPath($: EngineInterface, p: string) {
  const c = await context($)
  let argv: string[] = Array.isArray(c.cfg.open_command) && c.cfg.open_command.length ? c.cfg.open_command : []
  if (!argv.length) {
    let os = ''
    try {
      os = String((await $.env.get('OS')) ?? '')
    } catch {}
    argv = /windows/i.test(os) ? ['explorer.exe'] : ['xdg-open']
  }
  const target = /explorer/i.test(argv[0] ?? '') ? p.split('/').join('\\') : p
  try {
    await $.process.run([...argv, target], { timeoutMs: 15000 })
    R.msg = `ouvert : ${p}`
  } catch (err) {
    R.msg = `ouverture impossible : ${String(err).slice(0, 160)}`
  }
  redraw($)
}

async function essaisStates($: EngineInterface, c: Ctx) {
  const f = expandHome(c.cfg.essais?.state_file || `${c.refDir}/essais.json`, c.home)
  return { file: f, data: ((await readJson($, f)) || { v: 1, items: {} }) as any }
}

async function essaisItems($: EngineInterface, c: Ctx) {
  const st = await essaisStates($, c)
  const E = c.cfg.essais || {}
  return overlay(R.essais.data?.items || [], { presets: E.presets, extra: E.extra, states: st.data.items })
}

// ---- open ----------------------------------------------------------------------------------------------------------

/** Opens the pane on a tab with that tab's own arguments (the old commands' words). Returns the transcript line. */
async function openOn($: EngineInterface, p: Parsed, origin: string): Promise<{ text?: string }> {
  if (p.close) {
    await $.ui.close({ id: PANE })
    return {}
  }
  const c = await context($)
  const tabs = tabsOf(c.cfg.tabs)
  const tab: Tab = p.tab && tabs.includes(p.tab) ? p.tab : (R.tab || (tabsOf([c.cfg.start_tab])[0] ?? tabs[0]!))
  R.tab = tab
  const words = p.rest.map(w => w.toLowerCase())
  let line = ''
  if (tab === 'config') {
    const data = await readJson($, `${c.controlOut}/config-claude.json`)
    if (words.includes('scan') || !data) $.clock.after(0, () => configScan($))
  } else if (tab === 'guide') {
    if (p.rest.length) {
      const { doc } = await guideDoc($)
      const to = findIn(doc, p.rest.join(' '))
      if (to) R.guide = to
      else line = `pas de section « ${p.rest.join(' ')} ». Onglets : ${doc.tabs.map(t => t.title).join(', ')}`
    }
  } else if (tab === 'scenarios') {
    const { catalog } = await scenarios($, c)
    const a = scenarioArgs(p.rest.join(' '), catalog.scenarios.map(s => s.id))
    if (a.id && catalog.scenarios.some(s => s.id === a.id)) R.scen.selected = a.id
    else if (a.id) line = `no scenario "${a.id}" (known: ${catalog.scenarios.map(s => s.id).join(', ')})`
    if (a.kind && (KINDS as readonly string[]).includes(a.kind)) R.scen.kind = a.kind
  } else if (tab === 'sante') {
    await santeFacts($)
    const { stale } = await santeLoad($, c)
    if (stale || words.includes('refresh')) $.clock.after(0, () => santeScan($))
  } else if (tab === 'ci') {
    const diag = ['diagramme', 'diagram', 'diag', 'pipelines'].includes(words[0] ?? '')
    if (diag) {
      R.ci.tab = 'diagram'
      const w = parseDiagramWords(p.rest.slice(1))
      if (w.who) R.ci.who = w.who
      if (w.group) R.ci.group = w.group
      await ciDiagram($, 'cache')
      const d = parseDiagram(R.ci.diagram)
      if (w.refresh || !d || d.stale) $.clock.after(0, () => ciDiagram($, w.refresh ? 'force' : 'check'))
    } else if (words[0] === 'route' || words[0] === 'clear' || words[0] === 'set' || words[0] === 'unset') {
      line = 'route / clear : /ci dans une session où le mod ci est chargé (Référence ne fait que lire)'
    } else {
      R.ci.tab = 'routing'
      await ciRouting($, 'cache')
      if (words.includes('refresh') || words.includes('check')) $.clock.after(0, () => ciRouting($, 'force'))
    }
  } else if (tab === 'essais') {
    $.clock.after(0, () => load($, 'essais', words.includes('refresh')))
  } else if (tab === 'rd') {
    $.clock.after(0, () => load($, 'rd', words.includes('refresh')))
    $.clock.after(0, () => load($, 'essais'))
    if (words.includes('audit')) $.clock.after(0, () => act($, 'audit', () => auditExport($)))
  } else if (tab === 'repos') {
    $.clock.after(0, () => load($, 'repos', words.includes('refresh'), words.includes('refresh') ? ['--fresh'] : []))
  }
  await $.ui.open({ id: PANE, title: c.L.pane_title ?? 'Référence' })
  return { text: `${origin}: Référence › ${c.L[`tab_${tab}`] ?? tab}${line ? ` · ${line}` : ''}` }
}

export const register: Register = (on, raw) => {
  options = (raw ?? {}) as Options

  on('session.start', async ($, e, next) => {
    projectDir = String((e as { cwd?: string }).cwd ?? '').replace(/\\/g, '/')
    await $.command.register({
      name: 'reference',
      description: 'Référence : Config, Guide, Scénarios, Santé, CI dans un seul panneau (args: config | guide [section] | scenarios [S1..] | sante [refresh] | ci [diagramme] | close)',
      argumentHint: '[config|guide|scenarios|sante|ci [diagramme]] | close',
    })
    const ran = await next(e)
    // The old commands: only those no loaded mod registered (control, guide, scenarios, sante, ci keep their own).
    let present: { name: string }[] = []
    try {
      present = await $.command.list()
    } catch {}
    for (const name of missingAliases(present)) {
      await $.command.register({ name, description: `Référence › ${ALIASES[name]} (le mod d'origine n'est pas chargé)`, argumentHint: '[args] | close' })
    }
    for (const name of ACTION_COMMANDS) {
      if (present.some(x => x.name === name)) continue
      await $.command.register({ name, description: 'Exporter pour audit : zip daté des mods, configs locales, PLUGIN_DIRS, env, CLAUDE.md, agents/skills/workflows, RULES-INVENTORY et Veille, secrets masqués, sous ~/.claude/audit-exports' })
    }
    return ran
  })

  on('command.run', { command: 'reference' }, async ($, e) => openOn($, parseArgs(e.args ?? ''), 'reference'))
  for (const name of Object.keys(ALIASES)) {
    on('command.run', { command: name }, async ($, e, next) => {
      // Answer only when this mod registered the alias (no owner loaded); else the owner's own hook answers.
      let mine = false
      try {
        mine = (await $.command.list()).some(x => x.name === name && (x.plugin === 'reference' || (x.plugin ?? '').startsWith('reference@')))
      } catch {}
      if (!mine) return next(e)
      return openOn($, aliasArgs(name, e.args ?? ''), name)
    }).catch(($, e, next) => next(e)) // fail open: the owner's command (if any) still answers
  }

  on('command.run', { command: 'audit-export' }, async ($, e, next) => {
    let mine = false
    try {
      mine = (await $.command.list()).some(x => x.name === 'audit-export' && (x.plugin === 'reference' || (x.plugin ?? '').startsWith('reference@')))
    } catch {}
    if (!mine) return next(e)
    const line = await auditExport($)
    R.msg = line
    return { text: `audit-export: ${line}` }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const c = await context($)
    const tabs = tabsOf(c.cfg.tabs)
    const tab: Tab = R.tab && tabs.includes(R.tab) ? R.tab : (tabsOf([c.cfg.start_tab])[0] ?? tabs[0]!)
    const bar = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {tabs.map(t => (
          <Button key={`ref-tab-${t}`} {...(t === tab ? {} : { plain: true as const })} onPress={async () => {
            R.tab = t
            if (t === 'sante') {
              await santeFacts($)
              const { stale } = await santeLoad($, c)
              if (stale) $.clock.after(0, () => santeScan($))
            }
            if (t === 'ci') $.clock.after(0, () => (R.ci.tab === 'diagram' ? ciDiagram($, 'cache') : ciRouting($, 'cache')))
            if (t === 'essais' || t === 'repos') $.clock.after(0, () => load($, t))
            if (t === 'rd') {
              $.clock.after(0, () => load($, 'rd'))
              $.clock.after(0, () => load($, 'essais'))
            }
            redraw($)
          }}>
            {c.L[`tab_${t}`] ?? t}
          </Button>
        ))}
      </Box>
    )
    let body: any
    if (tab === 'config') body = await drawConfigTab($, ui, c)
    else if (tab === 'guide') {
      const { doc, problem } = await guideDoc($)
      body = drawGuide(ui, { doc, problem, ...R.guide, go: to => { R.guide = to; redraw($) } })
    } else if (tab === 'scenarios') {
      const { catalog, errors, warnings } = await scenarios($, c)
      body = drawScenarios(ui, {
        catalog, errors, warnings, ...R.scen,
        applied: await readApplied(io($), catalog, c.claudeDir),
        onSelect: id => { R.scen.selected = id; redraw($) },
        onKind: k => { R.scen.kind = k; redraw($) },
        onCopy: async (t, label, press) => {
          const r = await $.ui.copy({ text: t, surface: press?.surface })
          R.scen.copied = r.isCopied ? `copied: ${label}` : 'copy failed: select the text above'
          redraw($)
        },
        onApply: async id => {
          const s = catalog.scenarios.find(x => x.id === id)
          if (!s) return
          try {
            R.scen.applyMsg = await applyScenario(io($), catalog, s, c.claudeDir, new Date(await $.clock.now()).toISOString())
          } catch (err) {
            R.scen.applyMsg = `écriture impossible : ${String(err).slice(0, 160)}`
          }
          redraw($)
        },
      })
    } else if (tab === 'sante') {
      const { now } = await santeLoad($, c)
      body = drawSante(ui, {
        ...R.sante, cfg: await santeCfg($, c), now, homeDir: c.home,
        onRefresh: () => { $.clock.after(0, () => santeScan($)) },
        onCopy: async (cmd, press) => {
          const r = await $.ui.copy({ text: cmd, surface: press?.surface })
          R.sante.copied = r?.isCopied ? 'copié' : 'copie impossible'
          redraw($)
        },
      })
    } else if (tab === 'essais') {
      const data = R.essais.data ? { ...R.essais.data, items: await essaisItems($, c) } : undefined
      body = drawEssais(ui, {
        data, error: R.essais.error, busy: R.busy, msg: R.msg, open: R.essais.open, labels: c.L, max: c.cfg.essais?.max_per_section ?? 40,
        onState: async (id, cur) => {
          const st = await essaisStates($, c)
          const next = nextState(cur)
          try {
            await $.fs.write(st.file, JSON.stringify(setState(st.data, id, next, await $.clock.now()), null, 1))
            R.msg = `état : ${next}`
          } catch (err) {
            R.msg = `écriture impossible : ${String(err).slice(0, 160)}`
          }
          redraw($)
        },
        onFold: s => {
          R.essais.open = R.essais.open.includes(s) ? R.essais.open.filter(x => x !== s) : [...R.essais.open, s]
          redraw($)
        },
        onRefresh: () => { $.clock.after(0, () => load($, 'essais', true)) },
      })
    } else if (tab === 'rd') {
      const ideas: Record<string, Record<string, number>> = {}
      for (const i of R.essais.data ? await essaisItems($, c) : []) {
        if (!i.doc || !(STATES as readonly string[]).includes(i.state)) continue
        const d = (ideas[i.doc] ??= {})
        d[i.state] = (d[i.state] ?? 0) + 1
      }
      body = drawRd(ui, {
        data: R.rd.data, ideas, error: R.rd.error, busy: R.busy, msg: R.msg, labels: c.L,
        onOpen: p => { $.clock.after(0, () => openPath($, p)) },
        onExportEta: () => { $.clock.after(0, () => act($, 'eta', () => etaExport($))) },
        onAudit: () => { $.clock.after(0, () => act($, 'audit', () => auditExport($))) },
        onRefresh: () => {
          $.clock.after(0, () => load($, 'rd', true))
          $.clock.after(0, () => load($, 'essais', true))
        },
      })
    } else if (tab === 'repos') {
      body = drawRepos(ui, {
        data: R.repos.data, error: R.repos.error, busy: R.busy, msg: R.msg, labels: c.L, now: await $.clock.now(),
        onUpdate: name => {
          $.clock.after(0, () =>
            act($, `mise à jour ${name}`, async () => {
              const r = await rdRun($, ['repo-update', name], 420000)
              await load($, 'repos', true)
              return r.ok === false ? r.error : r.msg
            }),
          )
        },
        onExport: repo => { $.clock.after(0, () => act($, repo.export === 'eta' ? 'eta' : 'audit', () => (repo.export === 'eta' ? etaExport($) : auditExport($)))) },
        onFolder: p => { $.clock.after(0, () => openPath($, p)) },
        onRefresh: () => { $.clock.after(0, () => load($, 'repos', true, ['--fresh'])) },
      })
    } else {
      body = drawCi(ui, {
        surface: e.surface, tab: R.ci.tab, snapshot: parseSnapshot(R.ci.snapshot), diagram: parseDiagram(R.ci.diagram),
        error: R.ci.error, checking: R.ci.checking, fetching: R.ci.fetching, who: R.ci.who, group: R.ci.group, folded: R.ci.folded, now: Date.now(),
        onTab: t => { R.ci.tab = t; $.clock.after(0, () => (t === 'diagram' ? ciDiagram($, 'cache') : ciRouting($, 'cache'))); redraw($) },
        onCheck: force => { $.clock.after(0, () => ciRouting($, force ? 'force' : 'check')) },
        onFetch: force => { $.clock.after(0, () => ciDiagram($, force ? 'force' : 'check')) },
        onWho: w => { R.ci.who = w; redraw($) },
        onGroup: g => { R.ci.group = g; redraw($) },
        onToggle: k => { R.ci.folded = R.ci.folded.includes(k) ? R.ci.folded.filter(x => x !== k) : [...R.ci.folded, k]; redraw($) },
        onClear: async key => {
          await ciRun($, ['clear', key], 20000)
          await ciRouting($, 'cache')
        },
      })
    }
    return (
      <Box flexDirection="column" gap={1}>
        {bar}
        {body}
        <Text> </Text>
      </Box>
    )
  })
}
