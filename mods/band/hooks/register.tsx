// band mod ("Jauge"): Julian's always-visible live gauge, read-only.
// Above the prompt: this conversation's context against auto-compact and the RESUME hand-off threshold, the burn rate
// at the scopes the settings list, and the week's rate-limit use. /jauge opens the pane: per-scope table, hottest
// sessions, projects, 30-minute sparklines with compaction markers, and each conversation's compactions.
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
  hhmm,
  markerLine,
  sparkline,
} from './logic'
import type { BandPart, Config, Ctx, View } from './logic'

const PANE = { id: 'jauge' }
const viewAtom = atom({ plugin: 'band', key: 'view' } as const, null)
const engineAtom = atom({ plugin: 'band', key: 'engine' } as const, null)
const errorAtom = atom({ plugin: 'band', key: 'error' } as const, '')

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

const figures = async ($: EngineInterface, context?: { tokens?: number; window: number; percent?: number }, limits?: { kind: string; percentUsed: number }[]) => {
  const now = await $.clock.now()
  if (!context || !limits) {
    try {
      const u = await $.session.usage()
      context = u.context
      limits = u.rateLimits
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
    timer?.cancel()
    timer = $.clock.every(Math.max(5, c.refresh_s) * 1000, () => void refresh($))
    void refresh($)
    return started
  })

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
    return { text: `jauge: ${text || 'pas encore de mesure'}${err ? ` · erreur: ${err}` : ''}${cfgProblem ? ` · ${cfgProblem}` : ''}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (options.band === 'off' || e.props.hasSurvey) return next(e)
    const c = await loadConfig($)
    const v = await read($, viewAtom)
    const en = await read($, engineAtom)
    const parts = bandParts(v ?? undefined, ctxOf(c, en, v, v?.now ?? Date.now()), en?.week, c.band, c)
    if (!parts.length) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const color = (p: BandPart) => (p.tone ? c.colors[p.tone] : undefined)
    return (
      <Box flexDirection="row" flexWrap="wrap">
        {parts.map((p, i) => (
          <Text key={`b${i}`} {...(color(p) ? { color: color(p) } : { dimColor: true })}>
            {`${i ? ' · ' : ''}${p.text}`}
          </Text>
        ))}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: 'jauge' }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
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
            ? `mesuré à ${hhmm(v.now)} · ${v.files} fichier(s) lus en ${v.ms} ms · compte: ${v.count === 'all' ? 'tout (lectures cache comprises)' : 'entrée + écriture cache + sortie'}`
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

    return (
      <Box flexDirection="column" gap={1}>
        {head}
        {err ? <Text color={c.colors.bad}>{`erreur : ${err}`}</Text> : null}
        {cfgProblem ? <Text color={c.colors.bad}>{cfgProblem}</Text> : null}
        {conv}
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
