// band mod ("Jauge"): Julian's always-visible live gauge, read-only.
// Above the prompt: this conversation's context against auto-compact and the RESUME hand-off threshold, the burn rate
// at the scopes the settings list, and the week's rate-limit use. /jauge opens the pane: per-scope table, hottest
// sessions, projects, 30-minute sparklines with compaction markers, and each conversation's compactions.
// Under the band, a Mods button bar (launcher in band.config.json): a press runs the other mod's slash command, which
// opens that mod's own pane ($.ui.open draws only the caller's panes, so a mod cannot open another's directly); a
// second press runs /<command> close. A mod whose command is not in the session is greyed out.
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
  launcherButtons,
  launcherPress,
  markerLine,
  recentHandoffs,
  resumeCandidates,
  sparkline,
  toggleOpen,
} from './logic'
import type { BandPart, Config, Ctx, HandoffButton, LauncherButton, View } from './logic'
import { gaugeModel, gaugeSvg, gaugeText, barSvg } from './gauge'
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
  usageRows,
  usageSummary,
  textBar,
  veilleSummary,
  veilleLine,
  alertText,
} from './sections'
import type { BandUi, SectionsCfg } from './sections'

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

const PANE = { id: 'jauge' }
const viewAtom = atom({ plugin: 'band', key: 'view' } as const, null)
const engineAtom = atom({ plugin: 'band', key: 'engine' } as const, null)
const errorAtom = atom({ plugin: 'band', key: 'error' } as const, '')
const launcherAtom = atom({ plugin: 'band', key: 'launcher' } as const, { commands: [], open: [] })
const handoffAtom = atom({ plugin: 'band', key: 'handoff' } as const, { ran: [], show: false })
const uiAtom = atom({ plugin: 'band', key: 'ui' } as const, { expanded: false, open: [] })
const veilleAtom = atom({ plugin: 'band', key: 'veille' } as const, null)
const STORE_KEY = 'sections'

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

const readText = async ($: EngineInterface, p: string) => {
  try {
    return (await $.fs.read(p, { as: 'text' })) as string
  } catch {
    return undefined
  }
}

// Veille's own files, read-only (the veille mod's watcher writes them): open alerts minus the acknowledged ones.
const seeVeille = async ($: EngineInterface, c: Config) => {
  const sc = secCfg(c)
  if (!sectionList(sc).includes('veille')) return
  let dir = ''
  try {
    dir = (await $.env.get('VEILLE_HOME')) ?? ''
  } catch {}
  dir = (dir || expandHome((sc as any).veille_home ?? '~/.claude/veille', await home($))).replace(/\\/g, '/')
  const st = await readText($, `${dir}/state.json`)
  let state: any = null
  try {
    state = st ? JSON.parse(st.replace(/^﻿/, '')) : null
  } catch {}
  const acks = (await readText($, `${dir}/acks.jsonl`) ?? '')
    .split('\n')
    .filter(Boolean)
    .map(l => {
      try {
        return String(JSON.parse(l).key)
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  await update($, veilleAtom, () => veilleSummary(state, acks))
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

// A press: open the mod (/<command>) or close it (/<command> close). $.command.run queues the command until the
// session is idle, so it is not awaited here; while Claude works a toast says it is queued.
const press = async ($: EngineInterface, b: LauncherButton, isWorking: boolean) => {
  const c = await loadConfig($)
  const a = launcherPress(b, c.launcher?.close_args || 'close')
  if ('toast' in a) {
    $.ui.toast(a.toast)
    return
  }
  await update($, launcherAtom, l => ({ ...l, open: toggleOpen(l.open, b.mod, a.open) }))
  if (isWorking) $.ui.toast(`${b.label} : ${c.labels.launcher_queued ?? 'queued'}`)
  $.command.run(a.run).catch(async (err: unknown) => {
    await update($, launcherAtom, l => ({ ...l, open: toggleOpen(l.open, b.mod, !a.open) }))
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
    await seeVeille($, c)
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

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'jauge',
      description: 'Jauge: contexte de cette conversation, débit en tok/s par périmètre, sessions les plus actives, compactages (args: [refresh])',
      argumentHint: '[refresh]',
    })
    const c = await loadConfig($)
    await loadUi($, c)
    timer?.cancel()
    timer = $.clock.every(Math.max(5, c.refresh_s) * 1000, () => void refresh($))
    void seeCommands($)
    void refresh($)
    return started
  })

  // Observe only: a launcher mod's command typed by the person keeps the button's open state in step. Passes through.
  on('command.run', async ($, e, next) => {
    const r = await next(e)
    try {
      const c = await loadConfig($)
      if (c.handoff && c.handoff.enabled !== false && e.command === c.handoff.command) await noteRan($)
      const item = c.launcher?.items?.find(i => i.command === e.command)
      if (item) {
        const closing = (e.args ?? '').trim() === (c.launcher?.close_args || 'close')
        await update($, launcherAtom, l => ({ ...l, open: toggleOpen(l.open, item.mod, !closing) }))
      }
    } catch {}
    return r
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await figures($, e.context, e.rateLimits as { kind: string; percentUsed: number }[])
    await statusLine($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'jauge' }, async ($, e) => {
    await refresh($)
    const c = await loadConfig($)
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
    const style = (c as any).gauge?.style ?? 'compact'
    if (style === 'compact') {
      const sc = secCfg(c)
      const L = sc.labels
      const ui = (await read($, uiAtom)) as BandUi
      const ve = await read($, veilleAtom)
      const g = gaugeOf(c, ctx, v ?? null, undefined)
      const gw = (c as any).gauge?.width ?? 120
      const scope = (((c as any).gauge?.scopes as string[] | undefined) ?? ['conv'])[0]
      const srow = v?.scopes.find(r => r.id === scope)
      const rate = srow ? (srow.rates.find(x => x.w === c.band_window_s) ?? srow.rates[0]) : undefined
      const head = headLine({ ctxPct: g.pct, etaMin: ctx?.etaMin, tps: rate?.tps, limits: en?.limits }, L)
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
      const bw = sc.usage_bar_width
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
        if (id === 'usage') {
          const rows = usageRows(en?.limits, v?.now ?? Date.now(), L)
          return (
            <Box key="sec-usage" flexDirection="column">
              {header('usage', L.usage, usageSummary(en?.limits, en?.cost, L))}
              {isOpen(ui, 'usage') ? (
                <Box flexDirection="column" marginLeft={2}>
                  {rows.length === 0 ? <Text dimColor>{L.not_readable}</Text> : null}
                  {rows.map(r => (
                    <Box key={`ur-${r.id}`} flexDirection="row" gap={1} alignItems="center" flexWrap="nowrap">
                      <Text>{r.label.padEnd(4)}</Text>
                      {Svg ? <Svg source={barSvg(r.pct, (c as any).gauge?.colors?.usage ?? '#2f81f7', bw)} alt={`${r.label} ${Math.round(r.pct)} %`} /> : <Text>{textBar(r.pct)}</Text>}
                      <Text>{`${String(Math.round(r.pct)).padStart(3)} %`}</Text>
                      {r.when ? <Text dimColor>{r.when}</Text> : null}
                    </Box>
                  ))}
                </Box>
              ) : null}
            </Box>
          )
        }
        const vs = ve ?? { available: false, open: 0, julian: 0, alerts: [] }
        return (
          <Box key="sec-veille" flexDirection="column">
            {header('veille', L.veille, veilleLine(vs, L))}
            {isOpen(ui, 'veille') ? (
              <Box flexDirection="column" marginLeft={2}>
                {vs.alerts.length === 0 ? <Text dimColor>{vs.available ? L.veille_none : L.veille_off}</Text> : null}
                {vs.alerts.slice(0, 5).map((a, i) => (
                  <Text key={`va${i}`} {...(a.julian ? { color: c.colors.warn } : a.severity === 'bad' ? { color: c.colors.bad } : {})} wrap="truncate-end">{`• ${alertText(a)}`}</Text>
                ))}
              </Box>
            ) : null}
          </Box>
        )
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
      const modsRow =
        sectionList(sc).includes('mods') && buttons.length ? (
          <Box key="band-mods" flexDirection="row" flexWrap="wrap" gap={1}>
            <Text dimColor>{`${c.labels.launcher ?? 'Mods'} :`}</Text>
            {buttons.map(b => (
              <Button
                key={`mod-${b.mod}`}
                {...(b.loaded ? {} : { dimColor: true })}
                {...(b.open ? { variant: 'primary' as const } : {})}
                onPress={() => press($, b, isWorking)}
              >
                {b.open ? `${b.label} ✕` : b.label}
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
                key={`mod-${b.mod}`}
                {...(b.loaded ? {} : { dimColor: true })}
                {...(b.open ? { variant: 'primary' as const } : {})}
                onPress={() => press($, b, isWorking)}
              >
                {b.open ? `${b.label} ✕` : b.label}
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

    const buttons = await buttonsOf($, c)
    const mods = buttons.length ? (
      <Box flexDirection="column">
        <Text bold>{c.labels.launcher ?? 'Mods'}</Text>
        {buttons.map(b => (
          <Box key={`ml-${b.mod}`} flexDirection="row" gap={1}>
            <Button key={`mp-${b.mod}`} {...(b.loaded ? {} : { dimColor: true })} onPress={() => press($, b, false)}>
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
