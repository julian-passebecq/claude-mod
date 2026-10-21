// band mod ("Jauge"): Julian's always-visible live gauge, read-only.
// Above the prompt: this conversation's context against auto-compact and the RESUME hand-off threshold, the burn rate
// at the scopes the settings list, and the week's rate-limit use. /jauge opens the pane: per-scope table, hottest
// sessions, projects, 30-minute sparklines with compaction markers, and each conversation's compactions.
// Line 1 also carries « À toi : N » and « attend Julian : N » once each, counted by lib/core/veille.mjs in the scanner.
// Under the band, a Mods button bar (launcher in band.config.json, preset hubs: Jauge, Cockpit, Veille, À toi,
// Registres, Référence): a press runs the other mod's slash command, which opens that mod's own pane ($.ui.open draws
// only the caller's panes, so a mod cannot open another's directly); a second press runs /<command> close. Jauge is
// band's own pane, opened directly. A mod whose command is not in the session is greyed out and says how to load it.
// Sources: $.session.usage() / session.measure for this conversation (the status line's figures), and
// scanner/scan.mjs, an incremental tail of ~/.claude/projects/**/*.jsonl run every refresh_s. Nothing here blocks or
// rewrites a tool call or a prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EngineFigures } from '../types'
import {
  SCOPES,
  bandParts,
  bandText,
  compactLabel,
  contextInfo,
  deepMerge,
  expandHome,
  fmtPct,
  fmtTok,
  fmtUsd,
  ageText,
  handoffAdvice,
  handoffButtons,
  handoffReason,
  hhmm,
  allLauncherItems,
  launcherButtons,
  launcherItems,
  othersOpen,
  launcherPress,
  launcherKey,
  launcherTyped,
  markerLine,
  recentHandoffs,
  resumeCandidates,
  sparkline,
  stampKeys,
  stampText,
  toggleOpen,
} from './logic'
import type { BandPart, Config, Ctx, HandoffButton, LauncherButton, View } from './logic'
import { barSvg, gaugeModel, gaugeSvg, gaugeText } from './gauge'
import { cells, fitButtons, fitLine, jaugeCfg } from './jauge'
import type { Field, JaugeCfg, JaugeFacts } from './jauge'
import type { Gauge } from './gauge'
import {
  sectionsCfg,
  sectionList,
  initialUi,
  toggleSection,
  isOpen,
  headLine,
  convSummary,
  convLines,
  counters,
} from './sections'
import type { BandUi, SectionsCfg } from './sections'
import { ecCfg, enCoursView } from './encours'
import type { EcData, Seg } from './encours'

// The gauge's input from this conversation's context and the band's rates (style "gauge", the default).
const gaugeOf = (c: Config, ctx: Ctx | undefined, v: View | null, week: number | undefined): Gauge => {
  const lb = c.labels
  const rates: string[] = []
  for (const id of ((c as any).gauge?.scopes as string[] | undefined) ?? c.band.scopes) {
    const row = v?.scopes.find(r => r.id === id)
    if (!row) continue
    const r = row.rates.find(x => x.w === c.band_window_s) ?? row.rates[0]
    if (r) rates.push(`${lb[id] ?? id} ${fmtTok(r.tps)} tok/s`)
  }
  const idle = ctx?.idleEtaMin !== undefined && (ctx.idleMin ?? 0) >= c.idle_compact.show_after_idle_min ? ctx.idleEtaMin : undefined
  return gaugeModel(
    {
      tokens: ctx?.tokens,
      window: ctx?.window ?? c.context.window_fallback,
      compactAt: ctx?.threshold,
      handoffAt: c.context.handoff_tokens,
      etaMin: ctx?.etaMin ?? idle,
      level: ctx?.level,
      rates,
      ...(week !== undefined ? { week } : {}),
    },
    (c as any).gauge?.labels ?? {},
  )
}

// The two-line Jauge's figures: counters from the scanner (lib/core/veille.mjs), context from the engine, Claude's
// 5 h / week from the engine's rate limits (else the usage mod's samples), Codex's from its codex.json, PC activity,
// tok/s of the scopes in jauge.tps_scopes, CPU / GPU from the scanner.
const jaugeFacts = (c: Config, jc: JaugeCfg, ctx: Ctx | undefined, v: View | null, en: EngineFigures | null): JaugeFacts => {
  const lim = (k: string) => en?.limits?.find(l => l.kind === k && Number.isFinite(l.percentUsed))?.percentUsed
  const tps: Record<string, number | undefined> = {}
  for (const [id, scope] of Object.entries(jc.tps_scopes)) {
    const row = v?.scopes.find(r => r.id === scope)
    const r = row ? (row.rates.find(x => x.w === c.band_window_s) ?? row.rates[0]) : undefined
    tps[id] = r?.tps
  }
  const pct = ctx?.tokens !== undefined && ctx.window ? (ctx.tokens * 100) / ctx.window : undefined
  return {
    waiting: v?.waiting?.julian,
    todo: v?.waiting?.aToi,
    ctxPct: pct,
    relayAt: c.context.handoff_tokens,
    ...(ctx?.window ? { relayPct: (c.context.handoff_tokens * 100) / ctx.window } : {}),
    five: lim('five_hour') ?? v?.claude?.five,
    week: lim('seven_day') ?? en?.week ?? v?.claude?.week,
    fiveProj: v?.claude?.fiveProj,
    weekProj: v?.claude?.weekProj,
    codexWeek: v?.codex?.week,
    codexFive: v?.codex?.five,
    agents: v?.pc?.agents,
    convs: v?.pc?.convs,
    tps,
    cpu: v?.machine?.cpu,
    gpu: v?.machine?.gpu,
  }
}

const PANE = { id: 'jauge' }
const viewAtom = atom({ plugin: 'band', key: 'view' } as const, null)
const engineAtom = atom({ plugin: 'band', key: 'engine' } as const, null)
const errorAtom = atom({ plugin: 'band', key: 'error' } as const, '')
const launcherAtom = atom({ plugin: 'band', key: 'launcher' } as const, { commands: [], open: [] })
const handoffAtom = atom({ plugin: 'band', key: 'handoff' } as const, { ran: [], show: false })
const uiAtom = atom({ plugin: 'band', key: 'ui' } as const, { expanded: false, open: [] })
const STORE_KEY = 'sections'
const stampsAtom = atom({ plugin: 'band', key: 'stamps' } as const, {})
const STAMPS_KEY = 'stamps'
const encoursAtom = atom({ plugin: 'band', key: 'encours' } as const, null)

const loadStamps = async ($: EngineInterface) => {
  let stored: unknown
  try {
    stored = await $.store.get(STAMPS_KEY)
  } catch {}
  if (stored && typeof stored === 'object') {
    const ok: Record<string, number> = {}
    for (const [k, t] of Object.entries(stored as Record<string, unknown>)) if (typeof t === 'number' && Number.isFinite(t)) ok[k] = t
    await update($, stampsAtom, s => ({ ...ok, ...s }))
  }
}

// A stamped button (Exporter) ran, pressed or typed: remember when, for « dernier export HH:MM ».
const noteStamp = async ($: EngineInterface, keys: string[]) => {
  if (!keys.length) return
  const now = await $.clock.now()
  const next = await update($, stampsAtom, s => {
    const o = { ...s }
    for (const k of keys) o[k] = now
    return o
  })
  try {
    await $.store.set(STAMPS_KEY, next)
  } catch {}
}

const secCfg = (c: Config): SectionsCfg => sectionsCfg((c as any).sections)

// The folding at session start: $.store's (remember "store"), else the config's defaults. A reload keeps $.state's.
const loadUi = async ($: EngineInterface, c: Config) => {
  const sc = secCfg(c)
  let stored: unknown
  if (sc.remember === 'store') {
    try {
      stored = await $.store.get(STORE_KEY)
    } catch {}
  }
  const ui = initialUi(sc, stored)
  await update($, uiAtom, () => ui)
}

const toggleUi = async ($: EngineInterface, id: string) => {
  const c = await loadConfig($)
  const next = await update($, uiAtom, u => toggleSection(u as BandUi, id))
  if (secCfg(c).remember === 'store') {
    try {
      await $.store.set(STORE_KEY, next)
    } catch {}
  }
}

type Options = { config?: string; band?: string; status_line?: string }

const DOCS = {
  statusline: 'https://code.claude.com/docs/en/statusline',
  mods: 'https://code.claude.com/docs/en/plugins/mods/overview',
}

const home = async ($: EngineInterface) => {
  let v: string | undefined
  try {
    v = await $.env.get('USERPROFILE')
  } catch {}
  if (!v) {
    try {
      v = await $.env.get('HOME')
    } catch {}
  }
  return v ?? ''
}

let options: Options = {}
let cfg: Config | undefined
let cfgProblem = ''
let scanning = false
let thresholdAt = 0
let threshold: number | undefined
let timer: { cancel: () => void } | undefined
let ecTimer: { cancel: () => void } | undefined
let ecBusy = false
let ecLast = { at: 0, sig: '', live: false, dir: '' }

const loadConfig = async ($: EngineInterface): Promise<Config> => {
  if (cfg) return cfg
  const root = $.plugin.root.replace(/\\/g, '/')
  let base = {} as Config
  try {
    base = JSON.parse((await $.fs.read(`${root}/band.config.json`, { as: 'text' })) as string)
  } catch (err) {
    cfgProblem = `band.config.json: ${String(err).slice(0, 120)}`
  }
  if (options.config?.trim()) {
    const p = expandHome(options.config.trim(), await home($))
    try {
      base = deepMerge(base, JSON.parse((await $.fs.read(p, { as: 'text' })) as string))
    } catch (err) {
      cfgProblem = `${p}: ${String(err).slice(0, 120)}`
    }
  }
  cfg = base
  return base
}

let sessionFacts: { model?: string; effort?: string; at: number } = { at: 0 }

const figures = async ($: EngineInterface, context?: { tokens?: number; window: number; percent?: number }, limits?: { kind: string; percentUsed: number; resetsAt?: string }[]) => {
  const now = await $.clock.now()
  let cost: number | undefined
  if (!context || !limits) {
    try {
      const u = await $.session.usage()
      context = u.context
      limits = u.rateLimits
      cost = (u as any).cost?.usd
    } catch {}
  } else {
    const prev = await read($, engineAtom)
    cost = prev?.cost
  }
  // model and effort: cheap, local, once a minute
  if (now - sessionFacts.at > 60000) {
    sessionFacts = { at: now }
    try {
      sessionFacts.model = await $.session.model()
    } catch {}
    try {
      sessionFacts.effort = (await $.env.get('CLAUDE_EFFORT')) || undefined
    } catch {}
  }
  // The auto-compact threshold is only in the breakdown; "summary" counts locally and sends nothing. Every 5 min.
  if (now - thresholdAt > 300000) {
    thresholdAt = now
    try {
      const u = await $.session.usage({ breakdown: 'summary' })
      threshold = u.context.breakdown?.isAutoCompactEnabled === false ? undefined : u.context.breakdown?.autoCompactThreshold
    } catch {}
  }
  const week = limits?.find(l => l.kind === 'seven_day')?.percentUsed
  const f: EngineFigures = {
    ...(context?.tokens !== undefined ? { tokens: context.tokens } : {}),
    ...(context?.window ? { window: context.window } : {}),
    ...(context?.percent !== undefined ? { percent: context.percent } : {}),
    ...(threshold !== undefined ? { autoCompactThreshold: threshold } : {}),
    ...(week !== undefined ? { week } : {}),
    ...(limits ? { limits: limits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}) })) } : {}),
    ...(cost !== undefined && Number.isFinite(cost) ? { cost } : {}),
    ...(sessionFacts.model ? { model: sessionFacts.model } : {}),
    ...(sessionFacts.effort ? { effort: sessionFacts.effort } : {}),
    at: now,
  }
  await update($, engineAtom, () => f)
}

const ctxOf = (c: Config, e: EngineFigures | null, v: View | null, now: number): Ctx | undefined => {
  if (!e && !v?.conv) return undefined
  return contextInfo(
    {
      tokens: e?.tokens ?? v?.conv?.ctx,
      window: e?.window,
      percent: e?.percent,
      autoCompactThreshold: e?.autoCompactThreshold,
      growthTpm: v?.conv?.growthTpm,
      last: v?.conv?.last,
      now,
    },
    c.context,
    c.idle_compact,
  )
}

const statusLine = async ($: EngineInterface) => {
  const c = await loadConfig($)
  if (options.status_line !== 'on') return
  const v = await read($, viewAtom)
  const e = await read($, engineAtom)
  const ctx = ctxOf(c, e, v, await $.clock.now())
  $.ui.status(bandText(bandParts(v ?? undefined, ctx, e?.week, c.status_line, c)) || undefined)
}

// The slash commands of this session, to grey out the mods that are not loaded. Local: no model call.
const seeCommands = async ($: EngineInterface) => {
  try {
    const list = await $.command.list()
    const commands = list.map(c => ({ name: c.name, ...(c.plugin ? { plugin: c.plugin } : {}) }))
    await update($, launcherAtom, l => ({ ...l, commands }))
  } catch {}
}

const buttonsOf = async ($: EngineInterface, c: Config) => {
  const l = await read($, launcherAtom)
  return launcherButtons(c.launcher, l.commands, l.open, c.labels)
}

// The unfolded buttons (more_items: Jauge), same rules as the hubs.
const moreButtonsOf = async ($: EngineInterface, c: Config) => {
  const l = await read($, launcherAtom)
  const more = c.launcher?.more_items
  return Array.isArray(more) && more.length ? launcherButtons({ ...c.launcher, preset: 'more', items: more }, l.commands, l.open, c.labels) : []
}

// launcher.single: one hub open at a time. Opening `key` closes every other hub known open (not those of the same
// command, which the opening run replaces anyway): /<command> <close_args>, or band's own Jauge pane directly.
// fromHook: called inside a command.run hook, where the engine refuses $.command.run (it would wait on the turn the
// hook holds), so the closing runs go to a timer ($.clock.after 0).
const closeOthers = async ($: EngineInterface, c: Config, key: string, command: string, fromHook = false) => {
  if (!c.launcher?.single) return
  const l = await read($, launcherAtom)
  const others = othersOpen(allLauncherItems(c.launcher), l.open, key).filter(o => o.command !== command)
  if (!others.length) return
  const shut = others.map(launcherKey)
  await update($, launcherAtom, x => ({ ...x, open: x.open.filter(k => !shut.includes(k)) }))
  const closeArgs = c.launcher?.close_args || 'close'
  const runs: { command: string; args: string }[] = []
  for (const o of others) {
    if (o.mod === 'band' && o.command === 'jauge') {
      await $.ui.close({ id: PANE.id })
      continue
    }
    if (!runs.some(r => r.command === o.command)) runs.push({ command: o.command, args: closeArgs })
  }
  const go = () => {
    for (const r of runs) $.command.run(r).catch((err: unknown) => $.ui.toast(`/${r.command} ${r.args} : ${String(err).slice(0, 160)}`))
  }
  if (!runs.length) return
  if (fromHook) $.clock.after(0, go)
  else go()
}

// A press: open the mod (/<command>) or close it (/<command> close). $.command.run queues the command until the
// session is idle, so it is not awaited here; while Claude works a toast says it is queued.
const press = async ($: EngineInterface, b: LauncherButton, isWorking: boolean) => {
  const c = await loadConfig($)
  const a = launcherPress(b, c.launcher?.close_args || 'close')
  if ('toast' in a) {
    $.ui.toast(a.toast)
    return
  }
  if (a.open) await closeOthers($, c, launcherKey(b), b.command)
  await update($, launcherAtom, l => ({ ...l, open: toggleOpen(l.open, launcherKey(b), a.open) }))
  // Jauge is band's own pane: $.command.run skips the caller's own hooks, so open or close it here.
  if (b.mod === 'band' && b.command === 'jauge') {
    if (a.open) {
      await $.ui.open({ id: PANE.id, title: c.labels.pane_title ?? 'Jauge' })
      void refresh($)
    } else await $.ui.close({ id: PANE.id })
    return
  }
  if (isWorking) $.ui.toast(`${b.label} : ${c.labels.launcher_queued ?? 'queued'}`)
  // $.command.run skips band's own command.run observer, so a stamped press is noted here.
  if (b.stamp) await noteStamp($, [launcherKey(b)])
  $.command.run(a.run).catch(async (err: unknown) => {
    await update($, launcherAtom, l => ({ ...l, open: toggleOpen(l.open, launcherKey(b), !a.open) }))
    $.ui.toast(`/${b.command} : ${String(err).slice(0, 160)}`)
  })
}

// ---------- hand-off helper ----------
// Read-only: it stats RESUME and reads it on a press; « Préparer RESUME » runs the handoff command only on a press.

const seeResume = async ($: EngineInterface, c: Config) => {
  const hc = c.handoff
  if (!hc || hc.enabled === false) return
  let cwd = ''
  try {
    cwd = await $.session.cwd()
  } catch {}
  const places = resumeCandidates(cwd, hc.files ?? [], c.worktree_markers)
  let resume: { path: string; mtime?: number } | undefined = places[0] ? { path: places[0] } : undefined
  for (const p of places) {
    try {
      const st = await $.fs.stat(p)
      if (st.kind === 'file') {
        resume = { path: p, mtime: st.mtimeMs }
        break
      }
    } catch {}
  }
  let startedAt: number | undefined
  try {
    startedAt = (await $.session.usage()).startedAt
  } catch {}
  await update($, handoffAtom, s => ({ ...s, resume, ...(startedAt !== undefined ? { startedAt } : {}) }))
}

const noteRan = async ($: EngineInterface) => {
  const now = await $.clock.now()
  await update($, handoffAtom, s => ({ ...s, ran: [...s.ran, now].slice(-10) }))
}

const showResume = async ($: EngineInterface, c: Config) => {
  await seeResume($, c)
  const s = await read($, handoffAtom)
  let text: string | undefined
  if (s.resume?.mtime !== undefined) {
    try {
      const all = (await $.fs.read(s.resume.path, { as: 'text' })) as string
      const cap = c.handoff?.preview_chars ?? 12000
      text = all.length > cap ? `${all.slice(0, cap)}\n\n…` : all
    } catch {}
  } else $.ui.toast(`RESUME ${c.labels.handoff_absent ?? 'absent'} : ${s.resume?.path ?? '?'}`)
  await update($, handoffAtom, x => ({ ...x, show: true, ...(text !== undefined ? { text } : {}) }))
  await $.ui.open({ id: PANE.id, title: c.labels.pane_title ?? 'Jauge' })
}

const pressHandoff = async ($: EngineInterface, b: HandoffButton, isWorking: boolean) => {
  const c = await loadConfig($)
  const hc = c.handoff
  if (!hc) return
  if (!b.enabled) {
    $.ui.toast(b.hint ?? b.label)
    return
  }
  if (b.key === 'handoff-open') {
    await showResume($, c)
    return
  }
  if (isWorking) $.ui.toast(`${b.label} : ${c.labels.handoff_queued ?? 'queued'}`)
  // $.command.run skips the calling plugin's own hooks, so band's command.run observer will not see this run: note it here.
  await noteRan($)
  $.command
    .run({ command: hc.command, ...(hc.args ? { args: hc.args } : {}) })
    .catch((err: unknown) => $.ui.toast(`/${hc.command} : ${String(err).slice(0, 160)}`))
}

// « en cours » rows (jauge.en_cours): scanner/encours.mjs reads only the files of THIS conversation that changed. While
// nothing runs it is not even started: the conversation's folders are stat-ed every refresh_s and the scanner runs
// only when one of them changed (a new agent or Workflow) or idle_poll_s went by.
const refreshEnCours = async ($: EngineInterface, force = false) => {
  if (ecBusy) return
  const c = await loadConfig($)
  const j = ((c as any).jauge ?? {}) as any
  const ec = j.en_cours ?? {}
  if (ecCfg(j).rows <= 0 || ec.enabled === false) return
  ecBusy = true
  try {
    const now = await $.clock.now()
    let sig = ''
    if (ecLast.dir) {
      for (const p of [ecLast.dir, `${ecLast.dir}/subagents`, `${ecLast.dir}/subagents/workflows`]) {
        try {
          sig += `${(await $.fs.stat(p)).mtimeMs};`
        } catch {
          sig += '-;'
        }
      }
    }
    const idle = Math.max(5, Number(ec.idle_poll_s) || 60) * 1000
    if (!force && !ecLast.live && ecLast.at && sig === ecLast.sig && now - ecLast.at < idle) return
    const h = await home($)
    let session = ''
    try {
      session = await $.session.id()
    } catch {}
    const req = { projects_root: expandHome(c.projects_root, h), cache_file: expandHome(ec.cache_file || '~/.claude/band/encours-cache.json', h), session, now, cfg: c }
    const root = $.plugin.root.replace(/\\/g, '/')
    const r = await $.process.run([c.node, `${root}/scanner/encours.mjs`], { stdin: JSON.stringify(req), timeoutMs: 60000 })
    let d: any
    try {
      d = JSON.parse(r.stdout)
    } catch {}
    const data: EcData = { now, workflows: Array.isArray(d?.workflows) ? d.workflows : [], agents: Array.isArray(d?.agents) ? d.agents : [] }
    const dir = typeof d?.dir === 'string' ? d.dir.replace(/\\/g, '/') : ''
    ecLast = { at: now, sig: dir === ecLast.dir ? sig : '', live: Boolean(data.workflows!.length || data.agents!.length), dir }
    await update($, encoursAtom, () => data as any)
  } catch {
  } finally {
    ecBusy = false
  }
}

const fileHref = (p: string) => `file:///${encodeURI(p.replace(/\\/g, '/').replace(/^\/+/, ''))}`

const refresh = async ($: EngineInterface) => {
  if (scanning) return
  scanning = true
  try {
    const c = await loadConfig($)
    const h = await home($)
    const root = $.plugin.root.replace(/\\/g, '/')
    let session = ''
    let cwd = ''
    try {
      session = await $.session.id()
      cwd = await $.session.cwd()
    } catch {}
    const req = {
      projects_root: expandHome(c.projects_root, h),
      cache_file: expandHome(c.cache_file, h),
      session,
      cwd,
      now: await $.clock.now(),
      cfg: c,
    }
    const r = await $.process.run([c.node, `${root}/scanner/scan.mjs`], { stdin: JSON.stringify(req), timeoutMs: 180000 })
    let parsed: any
    try {
      parsed = JSON.parse(r.stdout)
    } catch {
      parsed = { error: (r.stderr || r.stdout || `exit ${r.exitCode}`).slice(0, 300) }
    }
    if (parsed?.error) await update($, errorAtom, () => String(parsed.error).split('\n')[0])
    else {
      await update($, viewAtom, () => parsed as View)
      await update($, errorAtom, () => '')
    }
    await figures($)
    await statusLine($)
    await seeCommands($)
    await seeResume($, c)
    await refreshEnCours($)
  } catch (err) {
    await update($, errorAtom, () => `scanner: ${String(err).slice(0, 200)}`)
  } finally {
    scanning = false
  }
}

export const register: Register = (on, raw) => {
  options = (raw ?? {}) as Options
  cfg = undefined
  timer?.cancel()
  timer = undefined
  ecTimer?.cancel()
  ecTimer = undefined
  ecLast = { at: 0, sig: '', live: false, dir: '' }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'jauge',
      description: 'Jauge: contexte de cette conversation, débit en tok/s par périmètre, sessions les plus actives, compactages (args: [refresh])',
      argumentHint: '[refresh]',
    })
    const c = await loadConfig($)
    await loadUi($, c)
    await loadStamps($)
    timer?.cancel()
    timer = $.clock.every(Math.max(5, c.refresh_s) * 1000, () => void refresh($))
    ecTimer?.cancel()
    ecTimer = $.clock.every(Math.max(5, Number((c as any).jauge?.en_cours?.refresh_s) || 5) * 1000, () => void refreshEnCours($))
    void seeCommands($)
    void refresh($)
    void refreshEnCours($, true)
    return started
  })

  // Observe only: a launcher mod's command typed by the person keeps the button's open state in step. Passes through.
  on('command.run', async ($, e, next) => {
    const r = await next(e)
    try {
      const c = await loadConfig($)
      if (c.handoff && c.handoff.enabled !== false && e.command === c.handoff.command) await noteRan($)
      await noteStamp($, stampKeys(allLauncherItems(c.launcher), e.command))
      const t = launcherTyped(allLauncherItems(c.launcher), e.command, e.args ?? '', c.launcher?.close_args || 'close')
      if (t) {
        for (const k of t.open) await closeOthers($, c, k, e.command, true)
        await update($, launcherAtom, l => ({ ...l, open: [...l.open.filter(k => !t.close.includes(k)), ...t.open.filter(k => !l.open.includes(k))] }))
      }
    } catch {}
    return r
  }).catch(($, e, next) => next(e))

  // The Jauge pane closed by its own ✕: the Jauge button follows. Passes through.
  on('ui.close', { id: PANE.id }, async ($, e, next) => {
    await update($, launcherAtom, l => ({ ...l, open: l.open.filter(k => k !== 'band') }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await figures($, e.context, e.rateLimits as { kind: string; percentUsed: number }[])
    await statusLine($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'jauge' }, async ($, e) => {
    const c = await loadConfig($)
    if ((e.args ?? '').trim() === (c.launcher?.close_args || 'close')) {
      await $.ui.close({ id: PANE.id })
      return { text: 'jauge: fermée' }
    }
    await refresh($)
    await $.ui.open({ id: PANE.id, title: c.labels.pane_title ?? 'Jauge' })
    const v = await read($, viewAtom)
    const en = await read($, engineAtom)
    const err = await read($, errorAtom)
    const ctx = ctxOf(c, en, v, await $.clock.now())
    const text = bandText(bandParts(v ?? undefined, ctx, en?.week, { items: c.band.items, scopes: [...SCOPES] }, c))
    let relay = ''
    if (c.handoff && c.handoff.enabled !== false) {
      const hs = await read($, handoffAtom)
      const advice = handoffAdvice(ctx, c.handoff)
      relay = ` · passation : ${advice.show ? `${c.labels.handoff_advice ?? 'conseillée'} (${handoffReason(advice, ctx, c.handoff, c.labels)})` : 'pas encore'} · RESUME ${ageText(hs.resume?.mtime, await $.clock.now(), c.labels)}`
    }
    return { text: `jauge: ${text || 'pas encore de mesure'}${relay}${err ? ` · erreur: ${err}` : ''}${cfgProblem ? ` · ${cfgProblem}` : ''}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (options.band === 'off' || e.props.hasSurvey) return next(e)
    const c = await loadConfig($)
    const v = await read($, viewAtom)
    const en = await read($, engineAtom)
    const ctx = ctxOf(c, en, v, v?.now ?? Date.now())
    const parts = bandParts(v ?? undefined, ctx, en?.week, c.band, c)
    const buttons = await buttonsOf($, c)
    const advice = c.handoff?.band === false ? { show: false, reasons: [] } : handoffAdvice(ctx, c.handoff)
    // What the mods after this one draw (veille's line, machine's entry) stays, below the gauge and the Mods bar.
    const theirs = await next(e)
    if (!parts.length && !buttons.length && !advice.show) return theirs
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = e.surface === 'terminal' ? undefined : (els as any).Svg
    const color = (p: BandPart) => (p.tone ? c.colors[p.tone] : undefined)
    const isWorking = e.props.isWorking
    const style = (c as any).gauge?.style ?? 'two_lines'
    if (style === 'two_lines') {
      // The Jauge (Julian, 17 Oct): ONE line of figures, the five buttons (on that line when both fit), a relay hint
      // and its RESUME button only past the hand-off threshold. No ▾, no second line, nothing else unless configured.
      const jc = jaugeCfg((c as any).jauge)
      const jx = ((c as any).jauge ?? {}) as { buttons_inline?: boolean; others_above_prompt?: string }
      const cols = Math.max(20, Number((e.props as any).bodyColumns) || jc.columns_fallback)
      const facts = jaugeFacts(c, jc, ctx, v ?? null, en)
      const relayHint = advice.show && c.handoff ? (jc.labels.relay_hint ?? 'relais conseillé') : ''
      const relayBtn = jc.labels.relay_button ?? 'RESUME'
      const stamps = (await read($, stampsAtom)) as Record<string, number>
      const stampOf = (b: LauncherButton) => stampText(b, stamps[launcherKey(b)])
      const stampW = buttons.reduce((s, b) => s + (stampOf(b) ? cells(stampOf(b)) + 1 : 0), 0)
      const relayW = relayHint ? cells(relayHint) + cells(relayBtn) + jc.button_pad + 2 : 0
      const fitted = fitButtons(buttons.map(b => ({ label: b.label, ...(b.short ? { short: b.short } : {}), open: b.open })), jc, cols, 0)
      const l1full = fitLine(jc.line1, facts, jc, cols)
      const inline = jx.buttons_inline !== false && cells(l1full.text) + cells(jc.sep) + relayW + fitted.width + stampW <= cols
      const l1 = inline ? l1full : fitLine(jc.line1, facts, jc, Math.max(10, cols - relayW))
      const l2 = jc.line2.length ? fitLine(jc.line2, facts, jc, cols) : undefined
      // Traffic light on the mini bar and the % (ok green, warn orange, bad red); label words grey (Julian, 21 Oct).
      const toneOf = (t?: Field['tone']) => (t === 'ok' || t === 'warn' || t === 'bad' ? { color: c.colors[t] ?? t } : t === 'dim' ? { dimColor: true } : {})
      const svgColors = { ok: '#3fb950', warn: '#d29922', bad: '#f85149', track: '#8b949e55', ...((c as any).gauge?.colors ?? {}) } as Record<string, string>
      const miniSvg = (pct: number, tone: string | undefined, key: string, alt: string) => (
        <Svg key={key} source={barSvg(pct, svgColors[tone ?? 'ok'] ?? svgColors.ok, 36, svgColors.track)} alt={alt} width={36} height={6} />
      )
      const figuresEls: any[] = []
      l1.line.forEach((g, gi) => {
        if (gi) figuresEls.push(<Text key={`j1-sep${gi}`} bold dimColor wrap="truncate-end">{l1.sep}</Text>)
        g.forEach((f, fi) => {
          if (fi) figuresEls.push(<Text key={`j1-dot${gi}-${fi}`} bold dimColor wrap="truncate-end">{l1.dot}</Text>)
          if (f.value === undefined) {
            figuresEls.push(<Text key={`j1-${f.id}`} bold {...toneOf(f.tone)} wrap="truncate-end">{f.text}</Text>)
            return
          }
          if (f.label) figuresEls.push(<Text key={`j1-${f.id}-l`} bold dimColor wrap="truncate-end">{f.label}</Text>)
          if (f.bar !== undefined && f.pct !== undefined) {
            figuresEls.push(Svg ? miniSvg(f.pct, f.tone, `j1-${f.id}-b`, `${f.label ?? ''}${f.value}`.replace(/\s+/g, ' ').trim()) : <Text key={`j1-${f.id}-b`} bold {...toneOf(f.tone)} wrap="truncate-end">{f.bar}</Text>)
          }
          figuresEls.push(<Text key={`j1-${f.id}-v`} bold {...toneOf(f.tone)} wrap="truncate-end">{f.value}</Text>)
        })
      })
      let relayEls: any[] = []
      if (relayHint && c.handoff) {
        const lc = await read($, launcherAtom)
        const hs = await read($, handoffAtom)
        const prep = handoffButtons(c.handoff, lc.commands, hs.resume, c.labels)[0]
        relayEls = [
          <Text key="band-relay-hint" color={c.colors.warn} wrap="truncate-end">{` ${relayHint}`}</Text>,
          <Button key={prep.key} {...(prep.enabled ? {} : { dimColor: true })} onPress={() => pressHandoff($, prep, isWorking)}>
            {relayBtn}
          </Button>,
        ]
      }
      const buttonEls = buttons.flatMap((b, i) => {
        const st = stampOf(b)
        const btn = (
          <Button
            key={`mod-${launcherKey(b)}`}
            {...(b.loaded ? {} : { dimColor: true })}
            {...(b.open ? { variant: 'primary' as const } : {})}
            onPress={() => press($, b, isWorking)}
          >
            {fitted.labels[i]}
          </Button>
        )
        return st ? [btn, <Text key={`stamp-${launcherKey(b)}`} dimColor wrap="truncate-end">{st}</Text>] : [btn]
      })
      const keepOthers = jx.others_above_prompt === 'show'
      const ecv = enCoursView((await read($, encoursAtom)) as EcData | null, ecCfg(jx), cols, v?.now)
      const segColor = (s: Seg) => (s.tone ? { color: c.colors[s.tone] ?? s.tone } : s.dim ? { dimColor: true } : {})
      const segEl = (s: Seg, key: string) =>
        Svg && s.bar !== undefined ? miniSvg(s.bar, s.tone, key, `${Math.round(s.bar)} %`) : (
          <Text key={key} {...segColor(s)} wrap="truncate-end">
            {s.text}
          </Text>
        )
      const cockpitBtn = buttons.find(b => b.command === 'cockpit')
      const ecEls = ecv.rows.length
        ? [
            ...ecv.rows.map(r => (
              <Box key={r.key} flexDirection="row" flexWrap="nowrap" {...(r.indent ? { marginLeft: r.indent } : {})}>
                {r.segs.map((s, i) => segEl(s, `${r.key}-${i}`))}
              </Box>
            )),
            ...(ecv.more
              ? [
                  <Box key="ec-more" flexDirection="row" flexWrap="nowrap" gap={1}>
                    <Text dimColor wrap="truncate-end">{`${(ecCfg(jx).labels.more ?? '+{n}').replace('{n}', String(ecv.more))}${cockpitBtn ? ' ·' : ''}`}</Text>
                    {cockpitBtn ? (
                      <Button key="ec-cockpit" {...(cockpitBtn.loaded ? {} : { dimColor: true })} onPress={() => press($, cockpitBtn, isWorking)}>
                        {ecCfg(jx).labels.cockpit}
                      </Button>
                    ) : null}
                  </Box>,
                ]
              : []),
          ]
        : []
      if (inline) {
        return (
          <Box flexDirection="column">
            <Box key="jauge-l1" flexDirection="row" flexWrap="nowrap" gap={1}>
              <Box key="jauge-figures" flexDirection="row" flexWrap="nowrap">
                {figuresEls}
              </Box>
              {relayEls}
              {buttonEls}
            </Box>
            {l2?.text ? <Text key="jauge-l2-t" dimColor wrap="truncate-end">{l2.text}</Text> : null}
            {ecEls}
            {keepOthers ? (theirs ?? null) : null}
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          <Box key="jauge-l1" flexDirection="row" flexWrap="nowrap" gap={1}>
            <Box key="jauge-figures" flexDirection="row" flexWrap="nowrap">
              {figuresEls}
            </Box>
            {relayEls}
          </Box>
          {l2?.text ? <Text key="jauge-l2-t" dimColor wrap="truncate-end">{l2.text}</Text> : null}
          {ecEls}
          <Box key="jauge-buttons" flexDirection="row" flexWrap="nowrap" gap={1}>
            {buttonEls}
          </Box>
          {keepOthers ? (theirs ?? null) : null}
        </Box>
      )
    }
    if (style === 'compact') {
      const sc = secCfg(c)
      const L = sc.labels
      const ui = (await read($, uiAtom)) as BandUi
      const g = gaugeOf(c, ctx, v ?? null, undefined)
      const gw = (c as any).gauge?.width ?? 120
      const scope = (((c as any).gauge?.scopes as string[] | undefined) ?? ['conv'])[0]
      const srow = v?.scopes.find(r => r.id === scope)
      const rate = srow ? (srow.rates.find(x => x.w === c.band_window_s) ?? srow.rates[0]) : undefined
      const compactions = v?.compactions.find(r => r.isThis)?.items.length
      const head = headLine({ ctxPct: g.pct, etaMin: ctx?.etaMin, tps: rate?.tps, compactions, limits: en?.limits }, L)
      const tone = c.colors[g.level]
      const marks = g.marks.map(m => m.label).join(' · ')
      const line1 = (
        <Box key="band-line" flexDirection="row" gap={1} alignItems="center" flexWrap="nowrap">
          {Svg && g.hasReading ? (
            <Svg key="band-gauge" source={gaugeSvg(g, (c as any).gauge?.colors ?? {}, gw, (c as any).gauge?.mark_labels ?? 'nearest')} alt={`${g.title} · ${marks}`} />
          ) : (
            <Text key="band-gauge-t" color={tone}>{gaugeText(g, (c as any).gauge?.text_width ?? 12)}</Text>
          )}
          <Text key="band-head" color={tone} wrap="truncate-end">{head}</Text>
          {counters(v?.waiting, L).map(k => (
            <Text key={k.key} bold color={c.colors.bad ?? '#f85149'}>{k.text}</Text>
          ))}
          <Button key="band-toggle" onPress={() => toggleUi($, 'band')}>
            {ui.expanded ? '▾' : '▸'}
          </Button>
        </Box>
      )
      const facts = {
        model: en?.model,
        effort: en?.effort,
        agents: v?.conv?.agents,
        pr: v?.conv?.pr,
        tokens: ctx?.tokens,
        handoffAt: c.context.handoff_tokens,
      }
      const header = (id: string, title: string, summary: string) => (
        <Box key={`sec-h-${id}`} flexDirection="row" gap={1} alignItems="center" flexWrap="nowrap">
          <Button key={`sec-${id}`} onPress={() => toggleUi($, id)}>
            {`${isOpen(ui, id) ? '▾' : '▸'} ${title}`}
          </Button>
          {isOpen(ui, id) ? null : <Text dimColor wrap="truncate-end">{summary}</Text>}
        </Box>
      )
      const sections = sectionList(sc).map(id => {
        if (id === 'mods') return null
        if (!ui.expanded) return null
        if (id === 'conv') {
          return (
            <Box key="sec-conv" flexDirection="column">
              {header('conv', L.conv, convSummary(facts, L))}
              {isOpen(ui, 'conv') ? (
                <Box flexDirection="column" marginLeft={2}>
                  {convLines(facts, L).map((t, i) => (
                    <Text key={`cl${i}`} dimColor={i > 0}>{t}</Text>
                  ))}
                </Box>
              ) : null}
            </Box>
          )
        }
        return null
      })
      let relayC = null
      if (advice.show && c.handoff) {
        const hs = await read($, handoffAtom)
        const lc = await read($, launcherAtom)
        const hb = handoffButtons(c.handoff, lc.commands, hs.resume, c.labels)
        relayC = (
          <Box key="band-relay" flexDirection="row" flexWrap="wrap" gap={1}>
            <Text color={c.colors.warn}>{`${c.labels.handoff_advice ?? 'Passation conseillée'} : ${handoffReason(advice, ctx, c.handoff, c.labels)}`}</Text>
            {hb.map(b => (
              <Button key={b.key} {...(b.enabled ? {} : { dimColor: true })} onPress={() => pressHandoff($, b, isWorking)}>
                {b.label}
              </Button>
            ))}
            <Text dimColor>{`RESUME ${ageText(hs.resume?.mtime, v?.now ?? Date.now(), c.labels)}`}</Text>
          </Box>
        )
      }
      const allButtons = [...buttons, ...(await moreButtonsOf($, c))]
      const modsRow =
        sectionList(sc).includes('mods') && allButtons.length ? (
          <Box key="band-mods" flexDirection="row" flexWrap="wrap" gap={1}>
            <Text dimColor>{`${c.labels.launcher ?? 'Mods'} :`}</Text>
            {allButtons.map(b => (
              <Button
                key={`mod-${launcherKey(b)}`}
                {...(b.loaded ? {} : { dimColor: true })}
                {...(b.open ? { variant: 'primary' as const } : {})}
                onPress={() => press($, b, isWorking)}
              >
                {b.open ? `${b.label} ✕` : b.loaded ? b.label : `${b.label} · ${b.hint ?? ''}`}
              </Button>
            ))}
          </Box>
        ) : null
      const order = sectionList(sc)
      const body = order.map((id, i) => (id === 'mods' ? modsRow : sections[i]))
      return (
        <Box flexDirection="column">
          {line1}
          {relayC}
          {body}
          {theirs ?? null}
        </Box>
      )
    }
    const gaugeStyle = style === 'gauge'
    const g = gaugeStyle ? gaugeOf(c, ctx, v ?? null, en?.week) : undefined
    const gaugeEl = g ? (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <Text color={c.colors[g.level]}>{g.title}</Text>
          {Svg ? null : <Text color={c.colors[g.level]}>{gaugeText(g, (c as any).gauge?.text_width ?? 30)}</Text>}
        </Box>
        {Svg && g.hasReading ? <Svg source={gaugeSvg(g, (c as any).gauge?.colors ?? {}, (c as any).gauge?.width ?? 320)} alt={`${g.title}${g.marks.map(m => ' · ' + m.label).join('')}`} /> : null}
        {g.line ? <Text dimColor>{g.line}</Text> : null}
      </Box>
    ) : null
    let relay = null
    if (advice.show && c.handoff) {
      const hs = await read($, handoffAtom)
      const lc = await read($, launcherAtom)
      const hb = handoffButtons(c.handoff, lc.commands, hs.resume, c.labels)
      relay = (
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Text color={c.colors.warn}>{`${c.labels.handoff_advice ?? 'Passation conseillée'} : ${handoffReason(advice, ctx, c.handoff, c.labels)}`}</Text>
          {hb.map(b => (
            <Button key={b.key} {...(b.enabled ? {} : { dimColor: true })} onPress={() => pressHandoff($, b, isWorking)}>
              {b.label}
            </Button>
          ))}
          <Text dimColor>{`RESUME ${ageText(hs.resume?.mtime, v?.now ?? Date.now(), c.labels)}`}</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {gaugeEl}
        {!gaugeStyle && parts.length ? (
          <Box flexDirection="row" flexWrap="wrap">
            {parts.map((p, i) => (
              <Text key={`b${i}`} {...(color(p) ? { color: color(p) } : { dimColor: true })}>
                {`${i ? ' · ' : ''}${p.text}`}
              </Text>
            ))}
          </Box>
        ) : null}
        {relay}
        {buttons.length ? (
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Text dimColor>{`${c.labels.launcher ?? 'Mods'} :`}</Text>
            {buttons.map(b => (
              <Button
                key={`mod-${launcherKey(b)}`}
                {...(b.loaded ? {} : { dimColor: true })}
                {...(b.open ? { variant: 'primary' as const } : {})}
                onPress={() => press($, b, isWorking)}
              >
                {b.open ? `${b.label} ✕` : b.loaded ? b.label : `${b.label} · ${b.hint ?? ''}`}
              </Button>
            ))}
          </Box>
        ) : null}
        {theirs ?? null}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: 'jauge' }, async ($, e) => {
    const { Box, Text, Button, Link, Markdown } = $.ui.resolve(e)
    const c = await loadConfig($)
    const v = await read($, viewAtom)
    const en = await read($, engineAtom)
    const err = await read($, errorAtom)
    const now = v?.now ?? Date.now()
    const ctx = ctxOf(c, en, v, now)
    const lb = c.labels
    const tone = (t?: string) => (t && c.colors[t] ? { color: c.colors[t] } : {})
    const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))
    const lpad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)
    const nv = <Text color={c.colors.warn}>non vérifié</Text>

    const head = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="refresh" hotkey="r" onPress={() => refresh($)}>
          Actualiser
        </Button>
        <Text dimColor>
          {v
            ? `mesuré à ${hhmm(v.now)} · ${v.files} fichier(s) lus en ${v.ms} ms · usage et prix: ${v.lib} · compte: ${v.count === 'all' ? 'tout (lectures cache comprises)' : 'entrée + écriture cache + sortie'}`
            : 'pas encore de mesure'}
        </Text>
      </Box>
    )

    const conv = ctx ? (
      <Box flexDirection="column">
        <Text bold>Cette conversation</Text>
        <Text {...tone(ctx.level)}>
          {`contexte ${fmtTok(ctx.tokens ?? 0)} / ${fmtTok(ctx.window)} (${fmtPct(ctx.usedPct ?? 0)})`}
        </Text>
        <Box flexDirection="row" gap={1}>
          <Text>{`seuil d'auto-compact ${fmtTok(ctx.threshold)} (${fmtPct(ctx.thresholdPct)}) · reste ${fmtTok(ctx.toCompact ?? 0)} (${fmtPct(ctx.toCompactPct ?? 0)})`}</Text>
          {ctx.thresholdSource === 'config' ? nv : null}
        </Box>
        <Text>
          {ctx.etaMin !== undefined
            ? `${lb.compact_in} ~${Math.max(1, Math.round(ctx.etaMin))} min au débit actuel (+${fmtTok(v?.conv?.growthTpm ?? 0)} tok/min de contexte)`
            : 'compactage : pas d’estimation (contexte stable sur la fenêtre)'}
        </Text>
        <Text {...tone(ctx.relay === 'over' ? 'bad' : ctx.relay === 'near' ? 'warn' : undefined)}>
          {`relais (RESUME) à ${fmtTok(c.context.handoff_tokens)} : ${ctx.relay === 'over' ? lb.relay_over : ctx.relay === 'near' ? lb.relay_near : `reste ${fmtTok(Math.max(0, c.context.handoff_tokens - (ctx.tokens ?? 0)))}`}`}
        </Text>
        <Box flexDirection="row" gap={1}>
          <Text>
            {ctx.idleEtaMin !== undefined
              ? `${lb.idle_compact_in} ~${Math.round(ctx.idleEtaMin)} min (inactif depuis ${Math.round(ctx.idleMin ?? 0)} min, > ${fmtTok(c.idle_compact.min_tokens)})`
              : `compaction au repos : non (sous ${fmtTok(c.idle_compact.min_tokens)} ou actif)`}
          </Text>
          {nv}
        </Box>
        {en?.week !== undefined ? <Text>{`${lb.week} ${fmtPct(en.week)} (limite 7 jours)`}</Text> : null}
      </Box>
    ) : null

    let relay = null
    const hc = c.handoff
    if (hc && hc.enabled !== false) {
      const hs = await read($, handoffAtom)
      const lc = await read($, launcherAtom)
      const advice = handoffAdvice(ctx, hc)
      const hb = handoffButtons(hc, lc.commands, hs.resume, lb)
      const mine = v?.compactions.find(r => r.isThis)?.items ?? []
      const hist = recentHandoffs(mine, hs.ran, hs.resume, hs.startedAt, hc.history_n, lb, c.idle_compact.idle_min)
      relay = (
        <Box flexDirection="column">
          <Text bold>{lb.handoff_title ?? 'Passation (RESUME)'}</Text>
          {advice.show ? (
            <Text color={c.colors.warn}>{`${lb.handoff_advice ?? 'Passation conseillée'} : ${handoffReason(advice, ctx, hc, lb)}`}</Text>
          ) : (
            <Text dimColor>{`pas encore : conseillée à ${fmtTok(hc.threshold_tokens)} de contexte ou si l'auto-compact est prévu dans ${hc.eta_min} min`}</Text>
          )}
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {hb.map(b => (
              <Button key={`p-${b.key}`} {...(b.enabled ? {} : { dimColor: true })} onPress={() => pressHandoff($, b, false)}>
                {b.label}
              </Button>
            ))}
            {hs.show ? (
              <Button key="p-handoff-hide" onPress={() => update($, handoffAtom, s => ({ ...s, show: false }))}>
                Masquer RESUME
              </Button>
            ) : null}
          </Box>
          <Text dimColor>{`/${hc.command}${hc.args ? ` ${hc.args}` : ''} · ${hb[0].hint ?? 'se lance seulement sur clic'}`}</Text>
          {hs.resume ? (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              <Text>{`${hs.resume.path} : ${ageText(hs.resume.mtime, now, lb)}`}</Text>
              {hs.resume.mtime !== undefined ? <Link href={fileHref(hs.resume.path)} label="ouvrir le fichier" /> : null}
              {hs.resume.mtime !== undefined ? nv : null}
            </Box>
          ) : (
            <Text dimColor>RESUME : dossier de la session inconnu</Text>
          )}
          <Text dimColor>{lb.handoff_history ?? 'Derniers relais et compactages'}</Text>
          {hist.length === 0 ? <Text dimColor>{lb.handoff_none ?? 'aucun'}</Text> : null}
          {hist.map((x, i) => (
            <Text key={`hh-${i}`} {...(x.kind === 'compact' ? {} : { color: c.colors.this })}>{`${hhmm(x.t)}  ${x.text}`}</Text>
          ))}
          {hs.show && hs.text !== undefined ? <Markdown key="resume-md" text={hs.text} /> : null}
        </Box>
      )
    }

    const w = v?.windows ?? c.windows_s
    const wl = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`)
    const table = v ? (
      <Box flexDirection="column">
        <Text bold>Débit par périmètre</Text>
        <Text dimColor>{pad('périmètre', 16) + w.map(x => lpad(`tok/s ${wl(x)}`, 16) + lpad('tok/min', 10) + lpad('tok/h', 9) + lpad('$/h', 9)).join('')}</Text>
        {v.scopes.map(row => (
          <Text key={`sc-${row.id}`}>
            {pad(lb[row.id] ?? row.id, 16) +
              row.rates.map(r => lpad(fmtTok(r.tps), 16) + lpad(fmtTok(r.tpm), 10) + lpad(fmtTok(r.tph), 9) + lpad(fmtUsd(r.usdPerH), 9)).join('')}
          </Text>
        ))}
        {v.repo ? <Text dimColor>{`projet = ${v.repo} (worktrees compris)`}</Text> : null}
      </Box>
    ) : null

    const top = v?.top.length ? (
      <Box flexDirection="column">
        <Text bold>{`Sessions les plus actives (${wl(Math.max(...w))})`}</Text>
        <Text dimColor>{pad('session', 34) + pad('projet', 18) + lpad('tok/s', 8) + lpad('$/h', 9) + lpad('ctx', 8) + lpad('compactages', 13)}</Text>
        {v.top.map(t => (
          <Text key={`top-${t.s}`} {...(t.isThis ? { color: c.colors.this } : {})}>
            {pad((t.isThis ? '> ' : '') + t.title, 34) +
              pad(t.repo, 18) +
              lpad(fmtTok(t.tps), 8) +
              lpad(fmtUsd(t.usdPerH), 9) +
              lpad(t.ctx ? fmtTok(t.ctx) : '-', 8) +
              lpad(t.compactions ? `${t.compactions} (${hhmm(t.lastCompact ?? 0)})` : '0', 13)}
          </Text>
        ))}
        {v.projects.length ? (
          <Text dimColor>{'projets : ' + v.projects.slice(0, 5).map(p => `${p.repo} ${fmtTok(p.tps)} tok/s (${p.sessions})`).join(' · ')}</Text>
        ) : null}
      </Box>
    ) : null

    const sparks = v ? (
      <Box flexDirection="column">
        <Text bold>{`Dernières ${v.spark_min} min (une colonne = ${wl(v.bucket_s)}, ▲ = compactage)`}</Text>
        {(['conv', 'project', 'all'] as const)
          .map(id => ({ id, row: v.scopes.find(r => r.id === id) }))
          .filter(x => x.row)
          .map(({ id, row }) => (
            <Box key={`sp-${id}`} flexDirection="column">
              <Text>{`${pad(lb[id] ?? id, 12)}${sparkline(row!.spark)}  max ${fmtTok(Math.max(0, ...row!.spark) / v.bucket_s)} tok/s`}</Text>
              {v.marks[id].length ? <Text color={c.colors.warn}>{pad('', 12) + markerLine(row!.spark.length, v.marks[id])}</Text> : null}
            </Box>
          ))}
      </Box>
    ) : null

    const comps = v ? (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>{`Compactages (${c.compact_history_hours} h)`}</Text>
          <Text dimColor>entrées system/compact_boundary des transcripts ; « au repos » déduit de l’inactivité avant la compaction :</Text>
          {nv}
        </Box>
        {v.compactions.length === 0 ? <Text dimColor>aucun</Text> : null}
        {v.compactions.slice(0, 10).map(r => (
          <Text key={`cp-${r.s}`} {...(r.isThis ? { color: c.colors.this } : {})}>
            {`${pad((r.isThis ? '> ' : '') + r.title, 34)} ${pad(r.repo, 16)} ${r.items.length} : ` +
              r.items
                .slice(-6)
                .map(x => `${hhmm(x.t)} ${compactLabel(x, lb, c.idle_compact.idle_min)}${x.pre ? ` ${fmtTok(x.pre)}→${fmtTok(x.post ?? 0)}` : ''}`)
                .join(' · ')}
          </Text>
        ))}
      </Box>
    ) : null

    const buttons = [...(await buttonsOf($, c)), ...(await moreButtonsOf($, c))]
    const mods = buttons.length ? (
      <Box flexDirection="column">
        <Text bold>{c.labels.launcher ?? 'Mods'}</Text>
        {buttons.map(b => (
          <Box key={`ml-${launcherKey(b)}`} flexDirection="row" gap={1}>
            <Button key={`mp-${launcherKey(b)}`} {...(b.loaded ? {} : { dimColor: true })} onPress={() => press($, b, false)}>
              {b.open ? `${b.label} ✕` : b.label}
            </Button>
            <Text dimColor>{b.loaded ? `/${b.command}${b.open ? ' · ouvert' : ''}` : (b.hint ?? '')}</Text>
          </Box>
        ))}
      </Box>
    ) : null

    return (
      <Box flexDirection="column" gap={1}>
        {head}
        {mods}
        {err ? <Text color={c.colors.bad}>{`erreur : ${err}`}</Text> : null}
        {cfgProblem ? <Text color={c.colors.bad}>{cfgProblem}</Text> : null}
        {conv}
        {relay}
        {table}
        {top}
        {sparks}
        {comps}
        <Box flexDirection="column">
          <Text dimColor>Sources : contexte et limites = $.session.usage() (les chiffres de la status line) ; débits = transcripts ~/.claude/projects (une ligne par réponse, dédoublonnée par id) ; $ = prix catalogue estimés.</Text>
          <Box flexDirection="row" gap={1}>
            <Link href={DOCS.statusline} label={DOCS.statusline} />
            <Link href={DOCS.mods} label={DOCS.mods} />
          </Box>
        </Box>
      </Box>
    )
  })
}
