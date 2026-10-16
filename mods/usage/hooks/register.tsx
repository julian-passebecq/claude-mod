// usage mod ("Consommation"): read-only view of what the agents burn and when the plan's windows run out.
// /conso [aujourdhui|semaine|prevision|scenarios|plein|classement] [refresh] opens the pane. Tokens come from the local
// transcripts (scanner/usage_scan.mjs, incremental, run with Node); the official 5-hour and weekly % come from
// $.session.usage().rateLimits and the session.measure event, saved as samples to calibrate tokens per 1 %.
// Nothing here blocks or rewrites anything: session.measure passes on untouched, the scenarios are only suggested.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { tokensOf } from '../lib/transcripts.mjs'
import { CV, codexView } from '../lib/codex.mjs'
import { bar, codexTokens, isAppLink, linksFromFil, rank, trendText } from '../lib/classement.mjs'
import { deepMerge, expandHome, fmtPct, fmtTokens, fmtUsd, heatRow, model, outcome, promptLine, when } from './logic.mjs'

const TABS = ['today', 'week', 'classement', 'forecast', 'scenarios', 'full', 'codex'] as const
const ALIASES: Record<string, string> = { aujourdhui: 'today', today: 'today', semaine: 'week', week: 'week', prevision: 'forecast', forecast: 'forecast', scenarios: 'scenarios', plein: 'full', full: 'full', codex: 'codex', classement: 'classement', qui: 'classement', ranking: 'classement' }
const tab = atom({ plugin: 'usage', key: 'tab' } as const, 'today')
const copied = atom({ plugin: 'usage', key: 'copied' } as const, '')
const cPreset = atom({ plugin: 'usage', key: 'preset' } as const, '')
const cGroup = atom({ plugin: 'usage', key: 'group' } as const, '')

type Options = { status_line?: string; codex?: string }
const S: { busy: boolean; error: string; at: number; last: any; aggr: any; cls: any; quotas: string } = { busy: false, error: '', at: 0, last: undefined, aggr: undefined, cls: undefined, quotas: '' }

// Hands a desktop-app conversation link to the OS (same rule and call as veille's Fil). Windows: url.dll, no shell.
async function openUrl($: EngineInterface, url: string) {
  if (!isAppLink(url)) return false
  let win = false
  try { win = (await $.env.get('OS')) === 'Windows_NT' } catch {}
  try {
    const r = await $.process.run(win ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url] : ['xdg-open', url], { timeoutMs: 10000 })
    return r.exitCode === 0
  } catch {
    return false
  }
}

const home = async ($: EngineInterface) => {
  let v: string | undefined
  try {
    v = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  } catch {}
  return (v ?? '').replace(/\\/g, '/')
}
const readJson = async ($: EngineInterface, path: string): Promise<any> => {
  try {
    return JSON.parse((await $.fs.read(path, { as: 'text' })) as string)
  } catch {
    return undefined
  }
}

async function context($: EngineInterface, options: Options) {
  const root = $.plugin.root.replace(/\\/g, '/')
  const h = await home($)
  const base = (await readJson($, `${root}/usage.config.json`)) || {}
  const dataDir = expandHome(base.data_dir || '~/.claude/usage-mod', h)
  const cfg = deepMerge(base, (await readJson($, `${dataDir}/usage.config.json`)) || {})
  if (options.status_line === 'on' || options.status_line === 'off') cfg.status_line = options.status_line
  if (options.codex === 'on' || options.codex === 'off') cfg.codex = { ...(cfg.codex || {}), enabled: options.codex }
  return { root, dataDir, cfg }
}

async function samples($: EngineInterface, dataDir: string) {
  try {
    const text = (await $.fs.read(`${dataDir}/samples.jsonl`, { as: 'text' })) as string
    return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch {
    return []
  }
}

async function liveLimits($: EngineInterface) {
  try {
    return (await $.session.usage()).rateLimits ?? []
  } catch {
    return []
  }
}

/** Runs the scanner (incremental) and redraws; never awaited by a hook that the person waits on. */
async function rescan($: EngineInterface, options: Options) {
  if (S.busy) return
  S.busy = true
  try {
    const { root, cfg } = await context($, options)
    const r = await $.process.run([cfg.node || 'node', `${root}/scanner/usage_scan.mjs`, 'scan', '--codex-enabled', String(cfg.codex?.enabled ?? 'auto')], { timeoutMs: Math.min((cfg.scan_timeout_s ?? 600) * 1000, 600000) })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `scanner exit ${r.exitCode}`)
    S.error = ''
    S.at = await $.clock.now()
    await loadQuotas($, options)
    S.aggr = undefined
    S.cls = undefined
  } catch (err) {
    S.error = String((err as Error)?.message ?? err).slice(0, 300)
  } finally {
    S.busy = false
  }
  await refreshStatus($, options)
  $.ui.invalidate('ui.render')
}

/** The 5 h / week line of lib/core/usage.mjs (scanner/usage_scan.mjs quotas): the numbers band and cockpit print. */
async function loadQuotas($: EngineInterface, options: Options) {
  try {
    const { root, cfg } = await context($, options)
    const r = await $.process.run([cfg.node || 'node', `${root}/scanner/usage_scan.mjs`, 'quotas'], { timeoutMs: 30000 })
    if (r.exitCode === 0) S.quotas = String(JSON.parse(r.stdout).line || '')
  } catch {}
}

async function compute($: EngineInterface, options: Options, current = '') {
  const { root, dataDir, cfg } = await context($, options)
  const aggr = S.aggr ?? (S.aggr = await readJson($, `${dataDir}/aggregate.json`))
  const sc = await readJson($, `${root}/${cfg.scenarios_file || '../scenarios/scenarios.json'}`)
  const now = await $.clock.now()
  const codexOff = cfg.codex?.enabled === 'off'
  const cx = codexOff ? { available: false, reason: 'off' } : codexView(await readJson($, `${dataDir}/codex.json`), cfg, { now, tzMin: aggr?.tzMin ?? 0 })
  const m = aggr ? model(aggr, cfg, { now, live: await liveLimits($), samples: await samples($, dataDir), scenarios: sc?.scenarios ?? [] }) : undefined
  const cls = current === 'classement' ? S.cls ?? (S.cls = await readJson($, `${dataDir}/classement.json`)) : undefined
  const cxRaw = current === 'classement' && !codexOff ? await readJson($, `${dataDir}/codex.json`) : undefined
  return { cfg, m, sc, cx, cxRaw, cls, now, stale: !aggr || now - S.at > (cfg.refresh_min ?? 10) * 60000 }
}

async function refreshStatus($: EngineInterface, options: Options) {
  const { cfg, m } = await compute($, options)
  if (cfg.status_line !== 'on') return
  $.ui.status(m?.status)
}

export const register: Register = (on, raw) => {
  const options = (raw ?? {}) as Options

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'conso',
      description: 'Consommation : tokens, coût équivalent, prévision des limites 5 h et semaine, scénarios (args: [aujourdhui|semaine|prevision|scenarios|plein] [refresh])',
      argumentHint: '[aujourdhui|semaine|prevision|scenarios|plein] [refresh] | close',
    })
    const { cfg } = await context($, options)
    if (cfg.status_line === 'on') $.clock.after(2000, () => rescan($, options))
    return next(e)
  })

  on('command.run', { command: 'conso' }, async ($, e) => {
    if ((e.args ?? '').trim().toLowerCase() === 'close') {
      await $.ui.close({ id: 'usage' })
      return {}
    }
    const words = String(e.args ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const want = words.map(w => ALIASES[w.normalize('NFD').replace(/[̀-ͯ']/g, '')]).find(Boolean)
    if (want) await update($, tab, () => want)
    const { cfg, m, cx, stale } = await compute($, options)
    if (!S.quotas) await loadQuotas($, options)
    if (stale || words.includes('refresh')) $.clock.after(0, () => rescan($, options))
    await $.ui.open({ id: 'usage', title: cfg.labels?.pane_title ?? 'usage' })
    const l = cfg.labels ?? {}
    if (!m) return { text: `conso: premier scan en cours (${cfg.projects_dir})` }
    const week = m.week ? `${l.week_label} ${fmtPct(m.week.reading.pct)} · ${outcome(m.week.current, m.tz, l)} ${l.pace_now}` : l.no_reading
    const cxl = cfg.codex?.labels ?? {}
    const codex = cx.reason === 'off' ? '' : ` · ${cxl.codex ?? 'Codex'} ${cx.available && cx.hasData ? `${fmtTokens(cx.today.total[CV.total])} tokens${cx.windows[0] ? ` · ${cx.windows[0].label} ${fmtPct(cx.windows[0].pct)}` : ''}` : cxl.unavailable ?? 'non disponible'}`
    return { text: `conso: aujourd'hui ${fmtTokens(tokensOf(m.today.total))} tokens · ${fmtUsd(m.today.total[7])} · ${week}${codex}${S.quotas ? `\nquotas : ${S.quotas}` : ''}` }
  })

  // Observe only: save a sample when a rate-limit window moved, refresh the status line. The event passes on unchanged.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if ((e.changed ?? []).includes('rateLimits') && (e.rateLimits ?? []).length) {
      const sample: Record<string, unknown> = {}
      for (const r of e.rateLimits) {
        if (r.kind === 'seven_day' || r.kind === 'five_hour') sample[r.kind] = { pct: r.percentUsed, reset: r.resetsAt ? Date.parse(r.resetsAt) : undefined }
      }
      $.clock.after(0, async () => {
        const { root, cfg } = await context($, options)
        await $.process.run([cfg.node || 'node', `${root}/scanner/usage_scan.mjs`, 'sample', JSON.stringify(sample)], { timeoutMs: 30000 })
        await refreshStatus($, options)
      })
    }
    return result
  }).catch(($, e, next) => next(e)) // fail open: a failing sample never stops the measurement

  on('ui.render', { component: 'Pane', requestId: 'usage' }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const current = ((await read($, tab)) as string) || 'today'
    const { cfg, m, sc, cx, cxRaw, cls, now } = await compute($, options, current)
    const l = cfg.labels ?? {}
    const cxl = cfg.codex?.labels ?? {}
    const fill = (t: string, v: Record<string, string>) => String(t ?? '').replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`)
    const dir = String(cfg.codex?.sessions_dir ?? '~/.codex/sessions')
    const cxTokens = (v: number[]) => `${fmtTokens(v[CV.total])} tokens (entrée ${fmtTokens(v[CV.input])} dont cache ${fmtTokens(v[CV.cached])} · sortie ${fmtTokens(v[CV.output])} dont raisonnement ${fmtTokens(v[CV.reasoning])})`
    const cxOk = cx.available && cx.hasData
    const last = await read($, copied)
    const unit = m?.basis === 'tokens' ? 'tokens' : '$'
    const amount = (v: number[]) => `${fmtTokens(tokensOf(v))} tokens · ${fmtUsd(v[7])}`
    const rows = (title: string, xs: { key: string; v: number[] }[], n = 10, label = (k: string) => k) => (
      <Box flexDirection="column">
        <Text bold>{title}</Text>
        {xs.length === 0 ? <Text dimColor>  —</Text> : xs.slice(0, n).map(x => <Text>{`  ${label(x.key).slice(0, 48).padEnd(48)} ${amount(x.v)}`}</Text>)}
      </Box>
    )
    const header = (
      <Box flexDirection="column">
        <Text dimColor>{`${cfg.plan_label ?? cfg.plan} · lecture seule · coûts : ${l.estimate}${S.busy ? ' · scan en cours…' : ''}`}</Text>
        {S.error ? <Text color="error">{`scan: ${S.error}`}</Text> : null}
        {S.quotas ? <Text key="quotas">{`${l.quotas_label ?? 'Quotas'} : ${S.quotas}`}</Text> : null}
        {m && cx.reason !== 'off' ? (
          <Text>{`${cxl.claude ?? 'Claude'} aujourd'hui ${fmtTokens(tokensOf(m.today.total))} tokens · 7 j ${fmtTokens(tokensOf(m.weekView.total))}  |  ${cxl.codex ?? 'Codex'} ${cxOk ? `aujourd'hui ${fmtTokens(cx.today.total[CV.total])} tokens · 7 j ${fmtTokens(cx.week.total[CV.total])}${cx.windows.map((w: any) => ` · ${w.label} ${fmtPct(w.pct)}`).join('')}` : cxl.unavailable ?? 'non disponible'}`}</Text>
        ) : null}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {TABS.filter(t => t !== 'codex' || cx.reason !== 'off').map(t => (
            <Button key={`tab-${t}`} {...(t !== current ? { plain: true as const } : {})} onPress={() => update($, tab, () => t)}>
              {l.tabs?.[t] ?? (t === 'classement' ? 'Classement' : t)}
            </Button>
          ))}
          <Button key="refresh" plain onPress={() => { $.clock.after(0, () => rescan($, options)) }}>↻</Button>
        </Box>
      </Box>
    )
    if (!m) return <Box flexDirection="column" gap={1}>{header}<Text>Pas encore de données : le premier scan lit les transcripts des derniers jours.</Text></Box>

    const kindLabel = (k: string) => l.kinds?.[k] ?? k
    const sessionLabel = (sid: string) => {
      const s = S.aggr?.sessions?.[sid]
      return s ? `${s.title || sid.slice(0, 8)} (${s.project})` : sid.slice(0, 8)
    }
    const period = (p: any, week: boolean) => (
      <Box flexDirection="column" gap={1}>
        <Text bold>{`Total : ${amount(p.total)}`}</Text>
        {week ? rows('Par jour', p.perDay.map((d: any) => ({ key: d.day, v: d.v })), 7) : null}
        <Box flexDirection="column">
          <Text bold>Par heure (carte de chaleur, 7 jours)</Text>
          {(() => {
            const max = Math.max(...m.heat.grid.flat(), 0)
            return m.heat.grid.map((row: number[], i: number) => (
              <Text>{`  ${when(m.heat.start + i * 86400000 + 43200000, m.tz, l, true).split(' ')[0]} |${heatRow(row, max, cfg.heat)}|`}</Text>
            ))
          })()}
          <Text dimColor>{'      0h    6h    12h   18h  23h'}</Text>
        </Box>
        {rows('Par projet', p.project)}
        {rows('Par modèle', p.model)}
        {rows('Par type', p.kind, 10, kindLabel)}
        {rows("Par surface de l'app", p.surface)}
        {rows('Par effort', p.effort)}
        {rows('Par skill', p.skill)}
        {rows('Par serveur MCP', p.mcp)}
        {rows(week ? 'Top 10 des sessions de la semaine' : 'Sessions', p.session, 10, sessionLabel)}
      </Box>
    )

    const fc = (title: string, w: any) =>
      !w ? <Text>{`${title} : ${l.no_reading}`}</Text> : (
        <Box flexDirection="column">
          <Text bold>{`${title} : ${fmtPct(w.reading.pct)} utilisés · reset ${when(w.reading.reset, m.tz, l)}${w.reading.live ? '' : ' (dernier échantillon)'}`}</Text>
          <Text>{`  ${l.pace_now} : ${outcome(w.current, m.tz, l) || 'pas assez de mesures'}`}</Text>
          {w.byRate ? Object.entries(w.byRate).map(([k, f]: any) => <Text dimColor>{`  rythme ${k === 'recent' ? '2 dernières h' : k === 'today' ? "aujourd'hui" : 'moyenne 7 j'} (${fmtPct(f?.pctPerHour)}/h) : ${outcome(f, m.tz, l)}`}</Text>) : null}
          {w.projections ? w.projections.map((p: any) => <Text>{`  ${p.label} : ${outcome(p.result, m.tz, l) || '?'}`}</Text>) : null}
        </Box>
      )

    const codexPane = () => {
      if (cx.reason === 'off') return <Text>{cxl.off}</Text>
      if (!cx.available) return <Text>{fill(cx.reason === 'no_dir' ? cxl.no_dir : `${cxl.unavailable} : {dir}`, { dir })}</Text>
      if (!cx.hasData) return <Text>{fill(cxl.no_data, { dir })}</Text>
      const byModel = (title: string, xs: { key: string; v: number[] }[]) => (
        <Box flexDirection="column">
          <Text bold>{title}</Text>
          {xs.length === 0 ? <Text dimColor>  —</Text> : xs.map(x => <Text>{`  ${x.key.slice(0, 32).padEnd(32)} ${fmtTokens(x.v[CV.total])} tokens`}</Text>)}
        </Box>
      )
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold>{`Aujourd'hui : ${cxTokens(cx.today.total)}`}</Text>
            <Text bold>{`7 jours : ${cxTokens(cx.week.total)}`}</Text>
            <Text dimColor>{`${cx.sessions} session(s) lues${cx.model ? ` · dernier modèle ${cx.model}` : ''}${cx.plan ? ` · plan ${cx.plan}` : ''}`}</Text>
          </Box>
          <Box flexDirection="column">
            <Text bold>Limites Codex</Text>
            {cx.windows.length === 0 ? <Text>{`  ${cxl.no_limits}`}</Text> : cx.windows.map((w: any) => (
              <Text>{`  ${w.label} : ${fmtPct(w.pct)} utilisés${w.reset ? ` · reset ${when(w.reset, m.tz, l)}` : ''} · lu ${when(w.at, m.tz, l)}${w.past ? ` (${cxl.past})` : w.stale ? ` (${cxl.stale})` : ''}`}</Text>
            ))}
            {cx.missing.map((x: string) => <Text dimColor>{`  ${x} : ${cxl.unavailable}`}</Text>)}
          </Box>
          {byModel("Par modèle aujourd'hui", cx.today.model)}
          {byModel('Par modèle, 7 jours', cx.week.model)}
          <Box flexDirection="column">
            <Text bold>Par jour</Text>
            {cx.week.perDay.map((d: any) => <Text>{`  ${d.key}  ${fmtTokens(d.v[CV.total])} tokens`}</Text>)}
          </Box>
          <Text dimColor>{fill(cxl.source, { dir })}</Text>
        </Box>
      )
    }
    const classementPane = async () => {
      const c = cfg.classement ?? {}
      const cl = c.labels ?? {}
      const presets: any[] = c.presets ?? []
      const groups: any[] = c.groups ?? []
      const pid = ((await read($, cPreset)) as string) || c.default_preset || 'today'
      const gid = ((await read($, cGroup)) as string) || c.default_group || 'conversation'
      const preset = presets.find(p => p.id === pid) ?? presets[0] ?? { id: 'today', since: 'midnight' }
      if (!cls) return <Text>Pas encore de classement : le prochain scan écrit classement.json (↻).</Text>
      const r = rank(cls, { now, preset, group: gid, top: c.top ?? 20, basis: m.basis, labels: cl })
      const links: Record<string, any> = gid === 'conversation' ? linksFromFil(await readJson($, expandHome(c.links_file ?? '~/.claude/veille/fil.json', await home($)))) : {}
      const maxShare = r.rows[0]?.share ?? 0
      const W = c.bar_width ?? 12
      const head = (x: any) => `${fmtTokens(tokensOf(x.v))} · ${fmtUsd(x.v[7])} · ${fmtPct(x.share * 100)} ${trendText(x, cl)}`.trim()
      const split = gid === 'conversation' || gid === 'project'
      const detail = (x: any) => `entrée ${fmtTokens(x.v[0])} · sortie ${fmtTokens(x.v[1])} · cache lu ${fmtTokens(x.v[2])} · cache écrit ${fmtTokens(x.v[3] + x.v[4])}${split ? ` · ${cl.sub ?? 'sous-agents'} ${fmtPct(tokensOf(x.v) ? (100 * x.sub) / tokensOf(x.v) : 0)}` : ''}`
      const cxT = gid === 'source' ? codexTokens(cxRaw, r.window, cls.tzMin ?? 0) : undefined
      const hours = Math.round((r.window.to - r.window.from) / 3600000)
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {presets.map(p => <Button key={`p-${p.id}`} {...(p.id !== preset.id ? { plain: true as const } : {})} onPress={() => update($, cPreset, () => p.id)}>{p.label ?? p.id}</Button>)}
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {groups.map(g => <Button key={`g-${g.id}`} {...(g.id !== gid ? { plain: true as const } : {})} onPress={() => update($, cGroup, () => g.id)}>{g.label ?? g.id}</Button>)}
          </Box>
          <Text bold>{`Total ${preset.label ?? preset.id} : ${amount(r.total)} · ${r.n} ligne(s)${r.trend !== undefined ? ` · ${trendText({ trend: r.trend }, cl)} vs les ${hours} h d'avant` : ''}`}</Text>
          <Box flexDirection="column">
            {r.rows.map((x: any, i: number) => {
              const lk = x.id ? links[x.id] : undefined
              return (
                <Box key={`r-${i}`} flexDirection="column">
                  <Text>{`${String(i + 1).padStart(2)}. ${bar(x.share, maxShare, W)} ${String(x.label).slice(0, 44)}${x.project ? ` (${x.project})` : ''} · ${head(x)}`}</Text>
                  <Text dimColor>{`    ${detail(x)}`}</Text>
                  {x.id && i < (c.buttons_top ?? 10) ? (
                    <Box flexDirection="row" gap={1}>
                      <Text dimColor>{`    ${x.id}`}</Text>
                      <Button key={`cp-${i}`} plain onPress={async press => {
                        const res = await $.ui.copy({ text: x.id, surface: press.surface })
                        await update($, copied, () => (res.isCopied ? `copié : ${x.id}` : 'copie impossible : sélectionne le texte'))
                      }}>{cl.copy ?? "Copier l'id"}</Button>
                      {lk ? <Button key={`op-${i}`} plain onPress={() => { void openUrl($, lk.link) }}>{cl.open ?? 'Ouvrir'}</Button> : null}
                    </Box>
                  ) : null}
                </Box>
              )
            })}
            {r.others ? <Text dimColor>{`    ${r.others.label} (${r.others.count}) · ${head(r.others)}`}</Text> : null}
          </Box>
          {last ? <Text dimColor>{last}</Text> : null}
          {cxT !== undefined ? <Text>{`Codex · ${fmtTokens(cxT)} tokens · ${cl.codex_note ?? ''}`}</Text> : null}
          {r.partialPrev ? <Text dimColor>{`Tendance vide : la fenêtre d'avant sort de l'historique gardé (${cls.days} j).`}</Text> : null}
          <Text dimColor>{`Sous-agents et agents de Workflow comptés dans leur conversation parente. ${cl.no_tool ?? ''} Coûts : ${l.estimate}.`}</Text>
        </Box>
      )
    }
    const s5 = (sc?.scenarios ?? []).find((s: any) => s.id === (cfg.plein_regime?.scenario ?? 'S5'))
    const views: Record<string, any> = {
      today: period(m.today, false),
      week: period(m.weekView, true),
      forecast: (
        <Box flexDirection="column" gap={1}>
          {fc(l.week_label, m.week)}
          {fc(l.five_hour_label, m.five)}
          <Text dimColor>{`Calibration : ${fmtTokens(m.cal.seven_day.tokensPerPct ?? 0)} tokens par 1 % de la semaine (${m.cal.seven_day.n} échantillon(s), transcripts de ce PC seulement, non vérifié).`}</Text>
          <Text dimColor>{`Rythme mesuré (${unit}/h) : 2 h ${m.rates.recent.toFixed(2)} · jour ${m.rates.today.toFixed(2)} · 7 j ${m.rates.week.toFixed(2)}`}</Text>
        </Box>
      ),
      scenarios: (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>Débit estimé de chaque scénario du mod scenarios (/scenarios), à partir de l'historique mesuré par type d'agent et modèle (non vérifié).</Text>
          {m.fit.rows.map((r: any) => (
            <Text {...(r.id === m.fit.best ? { bold: true } : {})}>{`${r.id} ${r.name} : ${fmtPct(r.pctPerHour)}/h actif · ${fmtPct(r.needPct)} d'ici le reset · ${r.fits === undefined ? '?' : r.fits ? l.fits : l.too_much}${r.id === m.fit.best ? ' ← le plus soutenu qui tient' : ''}`}</Text>
          ))}
          <Text dimColor>{`Reste ${fmtPct(m.fit.left)} · ${m.fit.hoursLeft === undefined ? '?' : Math.round(m.fit.hoursLeft)} h avant le reset, dont ${m.fit.activeHours === undefined ? '?' : Math.round(m.fit.activeHours)} h actives.`}</Text>
        </Box>
      ),
      codex: codexPane(),
      classement: current === 'classement' ? await classementPane() : null,
      full: (
        <Box flexDirection="column" gap={1}>
          <Text bold color={m.full.suggest ? 'success' : undefined}>{m.full.suggest ? l.suggest_full : l.no_full}</Text>
          <Text dimColor>{`Seuils : plus de ${cfg.plein_regime?.min_left_pct} % restant au reset et moins de ${cfg.plein_regime?.max_hours_left} h avant le reset. Maintenant : ${fmtPct(m.full.left)} · ${m.full.hoursLeft === undefined ? '?' : Math.round(m.full.hoursLeft)} h.`}</Text>
          {s5 ? (
            <Box flexDirection="column" gap={1}>
              <Text>{`${s5.id} ${s5.name} : ${s5.summary ?? ''}`}</Text>
              <Code source={promptLine(s5, sc?.models)} language="text" />
              <Box flexDirection="row" gap={1}>
                <Button key="copy" hotkey="c" onPress={async press => {
                  const r = await $.ui.copy({ text: promptLine(s5, sc?.models), surface: press.surface })
                  await update($, copied, () => (r.isCopied ? `copié : ${s5.id}` : 'copie impossible : sélectionne le texte'))
                }}>Copier</Button>
                {last ? <Text dimColor>{last}</Text> : null}
              </Box>
            </Box>
          ) : <Text dimColor>{`Scénario ${cfg.plein_regime?.scenario} introuvable dans ${cfg.scenarios_file}.`}</Text>}
          <Text dimColor>Le mod ne lance rien : il suggère et montre le texte à coller.</Text>
        </Box>
      ),
    }
    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {views[current] ?? views.today}
      </Box>
    )
  })
}
