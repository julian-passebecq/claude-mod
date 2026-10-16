// reference mod (« Référence »): one side pane with tabs Config | Guide | Scénarios | Santé | CI.
//   /reference [config|guide|scenarios|sante|ci [diagramme]|close]
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
import { ALIASES, aliasArgs, deepMerge, expandHome, missingAliases, parseArgs, tabsOf } from './nav'
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
