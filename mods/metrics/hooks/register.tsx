// metrics mod ("Les règles marchent ?"): read-only view of whether the rules help, per day and per rules version.
// /regles [V5.8] [refresh] opens the pane. Figures come from scanner/metrics_scan.mjs (Node, incremental): transcripts
// (usage mod's parser), merged PRs/MRs and CI runs (gh / glab list calls), and the rules file's git log for the
// version markers. The command shows a pane and returns no text, so nothing reaches the model; nothing here blocks,
// rewrites or delays a tool call or a prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { deepMerge, duration, expandHome, fill, fmtMetric, fmtNum, latest, markerLegend, markerLine, metricRows, pickVersion, spark, when } from './view.mjs'

const PANE = 'regles'
const versionAtom = atom({ plugin: 'metrics', key: 'version' } as const, '')

const S: { busy: boolean; error: string; at: number; model: any } = { busy: false, error: '', at: 0, model: undefined }

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

async function context($: EngineInterface) {
  const root = $.plugin.root.replace(/\\/g, '/')
  const h = await home($)
  const base = (await readJson($, `${root}/metrics.config.json`)) || {}
  const dataDir = expandHome(base.data_dir || '~/.claude/metrics-mod', h)
  const cfg = deepMerge(base, (await readJson($, `${dataDir}/metrics.config.json`)) || {})
  return { root, dataDir, cfg }
}

/** Runs the scanner in the background and redraws; never awaited by a hook the person waits on. */
async function rescan($: EngineInterface, force = false) {
  if (S.busy) return
  S.busy = true
  $.ui.invalidate('ui.render')
  try {
    const { root, cfg } = await context($)
    const argv = [cfg.node || 'node', `${root}/scanner/metrics_scan.mjs`, 'scan', ...(force ? ['--force'] : [])]
    const r = await $.process.run(argv, { timeoutMs: Math.min((cfg.scan_timeout_s ?? 600) * 1000, 600000) })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `scanner exit ${r.exitCode}`)
    S.error = ''
    S.at = await $.clock.now()
    S.model = undefined
  } catch (err) {
    S.error = String((err as Error)?.message ?? err).slice(0, 300)
  } finally {
    S.busy = false
  }
  $.ui.invalidate('ui.render')
}

async function load($: EngineInterface) {
  const { cfg, dataDir } = await context($)
  const model = S.model ?? (S.model = await readJson($, `${dataDir}/metrics.json`))
  const now = await $.clock.now()
  const stale = !model || now - (model.generated || 0) > (cfg.refresh_min ?? 30) * 60000
  return { cfg, model, stale }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'regles',
      description: 'Les règles marchent ? PR mergées, tokens par PR, modèles, arrêts, gardes, creux CI, par jour et par version des règles (args: [V5.8] [refresh])',
      argumentHint: '[V5.8] [refresh]',
    })
    return next(e)
  })

  on('command.run', { command: 'regles' }, async ($, e) => {
    const words = String(e.args ?? '').split(/\s+/).filter(Boolean)
    const v = words.find(w => /^v\d/i.test(w))
    if (v) await update($, versionAtom, () => v.toUpperCase())
    const { cfg, stale } = await load($)
    const refresh = words.some(w => w.toLowerCase() === 'refresh')
    if (stale || refresh) $.clock.after(0, () => rescan($, refresh))
    await $.ui.open({ id: PANE, title: cfg.labels?.pane_title ?? 'regles' })
    return {} // a pane, no transcript text: nothing for the model to read
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { cfg, model } = await load($)
    const l = cfg.labels ?? {}
    const status = S.busy ? 'calcul en cours…' : ''
    if (!model) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{fill(l.first_scan, { days: cfg.history_days ?? 30 })}</Text>
          {S.error ? <Text color="error">{`scan : ${S.error}`}</Text> : null}
          {status ? <Text dimColor>{status}</Text> : null}
        </Box>
      )
    }
    const tz = model.tzMin ?? 0
    const vs: any[] = (model.versions ?? []).slice(-(cfg.max_versions ?? 12))
    const want = (await read($, versionAtom)) as string
    const i = pickVersion(vs, want)
    const cur = vs[i]
    const prev = i > 0 ? vs[i - 1] : undefined
    const metrics: any[] = (cfg.metrics ?? []).filter((m: any) => m.show !== false)
    const W = Math.max(...metrics.map(m => (m.label || m.id).length), 10) + 2
    const n = (model.days ?? []).length
    const meta = model.meta ?? {}
    const verdictColor = (v: string) => (v === 'better' ? 'success' : v === 'worse' ? 'error' : undefined)
    const rows = cur ? metricRows(cfg, prev, cur) : []
    const shortH = l.short_hours ?? 12
    const summary: any[] = (cfg.summary_metrics ?? []).map((id: string) => metrics.find(m => m.id === id)).filter(Boolean)
    const cell = (s: string, w = 11) => s.padStart(w)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor>{fill(l.subtitle, { repos: meta.repos ?? 0, github: meta.github ?? 0, gitlab: meta.gitlab ?? 0, days: n, forge_at: when(meta.forge_at, tz) }) + (status ? ` · ${status}` : '')}</Text>
          {S.error ? <Text color="error">{`scan : ${S.error}`}</Text> : null}
          {(meta.errors ?? []).slice(0, 4).map((x: string) => <Text color="warning">{x}</Text>)}
        </Box>

        <Box flexDirection="column">
          <Text bold>{l.versions}</Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {vs.map((v, k) => (
              <Button key={`v-${v.version}`} {...(k !== i ? { plain: true as const } : {})} onPress={() => update($, versionAtom, () => v.version)}>
                {v.version}
              </Button>
            ))}
            <Button key="refresh" plain onPress={() => { $.clock.after(0, () => rescan($, true)) }}>↻</Button>
          </Box>
          {cur ? <Text dimColor>{`${cur.version} · ${when(cur.start, tz)} · ${cur.sha} ${cur.subject}`}</Text> : <Text dimColor>aucune version trouvée (rules.repo dans la config)</Text>}
        </Box>

        <Box flexDirection="column">
          <Text bold>{`${l.curves} (${model.days?.[0] ?? ''} → ${model.days?.[n - 1] ?? ''})`}</Text>
          {metrics.map(m => (
            <Text>{`${(m.label || m.id).padEnd(W)}${spark(model.series?.[m.id], cfg.spark, cfg.spark_gap)}  ${fmtMetric(m, latest(model.series?.[m.id]))}${m.target === undefined ? '' : ` · ${l.col_target} ${fmtMetric(m, m.target)}`}`}</Text>
          ))}
          <Text color="claude">{`${''.padEnd(W)}${markerLine(n, model.markers, cfg.marker)}`}</Text>
          <Text dimColor>{`${''.padEnd(W)}${cfg.marker ?? '│'} ${markerLegend(model.markers, model.days)}`}</Text>
        </Box>

        {cur ? (
          <Box flexDirection="column">
            <Text bold>{`${fill(l.before_after, { version: cur.version })} : ${prev ? `${prev.version} (${duration(prev.hours)})` : '—'} → ${cur.version} (${duration(cur.hours)})`}</Text>
            {(prev && prev.hours < shortH) || cur.hours < shortH ? <Text color="warning">{fill(l.short, { h: shortH })}</Text> : null}
            <Text dimColor>{`${(l.col_metric ?? '').padEnd(W)}${cell(prev ? prev.version : 'avant')}${cell(cur.version)}     ${l.col_target ?? ''}`}</Text>
            {rows.map((r: any) => (
              <Text {...(verdictColor(r.verdict) ? { color: verdictColor(r.verdict) } : {})}>{`${r.label.padEnd(W)}${cell(r.before)}${cell(r.after)}  ${r.arrow.padEnd(2)} ${r.target}`}</Text>
            ))}
          </Box>
        ) : null}

        <Box flexDirection="column">
          <Text bold>{l.all_versions}</Text>
          <Text dimColor>{`${'Version'.padEnd(8)}${cell(l.col_days ?? 'jours', 7)}${summary.map(m => cell(String(m.short || m.id), 12)).join('')}`}</Text>
          {vs.map(v => (
            <Text {...(v === cur ? { bold: true } : {})}>{`${v.version.padEnd(8)}${cell(fmtNum(v.hours / 24, 1), 7)}${summary.map(m => cell(fmtMetric(m, v.values?.[m.id]), 12)).join('')}`}</Text>
          ))}
        </Box>

        <Box flexDirection="column">
          {(l.notes ?? []).map((x: string) => <Text dimColor>{`· ${fill(x, { gap: cfg.stall?.min_gap_min ?? 60 })}`}</Text>)}
        </Box>
      </Box>
    )
  })
}
