// sante mod: the pane's drawing, pure. No `$`: the elements come in as `ui` ($.ui.resolve(e)) and every action as a
// callback in `m`, so the sante pane and the Référence hub (mods/reference, a synced copy of this file) draw the same
// tree from the same report. Same output as the drawing that lived in register.tsx before.
import { evaluate, fill, fmtAgo, fmtBytes, fmtDur, fmtNum } from './logic.mjs'

export type SanteModel = {
  report: any
  error: string
  busy: boolean
  copied: string
  commands: any[]
  engine: string
  cfg: any
  now: number
  homeDir: string
  onRefresh: () => void
  onCopy: (cmd: string, press: any) => void | Promise<void>
}

export function drawSante(ui: any, m: SanteModel): any {
  const { Box, Text, Button } = ui
  const { cfg, now, homeDir } = m
  const l = cfg.labels ?? {}
  const colors = cfg.colors ?? {}
  const icons = cfg.icons ?? {}
  const color = (lv: string) => (colors[lv] ? { color: colors[lv] } : {})
  const busy = m.busy ? l.busy ?? 'examen en cours…' : ''
  if (!m.report) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>{l.first_scan ?? 'Premier examen des mods en cours…'}</Text>
        {m.error ? <Text color="error">{`scan : ${m.error}`}</Text> : null}
        {busy ? <Text dimColor>{busy}</Text> : null}
      </Box>
    )
  }
  const { rows, summary } = evaluate(m.report, { commands: m.commands, engine: m.engine, cfg, now })
  const active = rows.filter((r: any) => r.level !== 'off')
  const off = rows.filter((r: any) => r.level === 'off')
  const SRC: Record<string, string> = { env: 'CLAUDE_CODE_PLUGIN_DIRS', dir: 'dossier', marketplace: 'marketplace', health: 'fiche santé seule' }
  const src = (s: string) => l[`source_${s}`] ?? SRC[s] ?? s

  const modBlock = (r: any) => {
    const head = [
      `${icons[r.level] ?? '●'} ${r.name}${r.version ? ` ${r.version}` : ''}`,
      r.loaded ? l.loaded ?? 'chargé' : l.not_loaded ?? 'non chargé',
      src(r.source),
      r.commands.length ? r.commands.map((c: string) => `/${c}`).join(' ') : l.no_commands ?? 'aucune commande',
      fill(l.min_version ?? 'minimum {min}', { min: r.minVersion ?? '?' }),
    ].join(' · ')
    const badJson = r.configs.filter((c: any) => !c.ok).length
    const facts = [
      r.lastRefresh ? `${l.refresh ?? 'dernier rafraîchissement'} ${fmtAgo(r.lastRefresh, now)}` : l.no_refresh ?? 'aucun cache connu',
      r.caches.length ? `${l.cache ?? 'cache'} ${fmtBytes(r.cacheBytes)}${r.caches.some((c: any) => c.truncated) ? '+' : ''} (${r.caches.length})` : '',
      r.configs.length ? `${l.configs ?? 'config'} ${badJson ? `${badJson}/${r.configs.length} invalides` : fill(l.configs_ok ?? '{n} JSON valides', { n: r.configs.length })}` : '',
    ].filter(Boolean).join(' · ')
    const hr = r.health
    const healthLine = hr
      ? fill(l.health ?? 'dernier scan {ago} · {dur} · CPU {cpu}', { ago: fmtAgo(hr.lastRun, now), dur: fmtDur(hr.durationMs), cpu: fmtDur(hr.cpuMs) })
      : l.no_health ?? 'pas de fiche santé'
    const cost = r.cost
      ? fill(l.cost ?? '24 h : {runs} runs ({rate}/h) · CPU {cpu} ≈ {core} % d\'un cœur', {
          runs: fmtNum(hr.window.runs), rate: fmtNum(r.cost.runsPerHour, 1), cpu: fmtDur(r.cost.cpuMs), core: fmtNum(r.cost.corePct, 2),
        })
      : ''
    return (
      <Box key={`mod-${r.name}`} flexDirection="column">
        <Text {...color(r.level)} bold>{head}</Text>
        {r.reasons.map((x: any) => <Text {...color(x.level)}>{`   ↳ ${x.text}`}</Text>)}
        <Text dimColor>{`   ${facts}`}</Text>
        <Text dimColor>{`   ${healthLine}${cost ? ` · ${cost}` : ''}`}</Text>
        {r.cleanup.map((cmd: string, i: number) => (
          <Box key={`clean-${r.name}-${i}`} flexDirection="row" gap={1} flexWrap="wrap">
            <Text>{`   ${l.run_yourself ?? 'à lancer toi-même :'} ${cmd}`}</Text>
            <Button key={`copy-${r.name}-${i}`} plain onPress={(press: any) => m.onCopy(cmd, press)}>
              {l.copy ?? 'Copier'}
            </Button>
          </Box>
        ))}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text {...color(summary.level)} bold>{`${icons[summary.level] ?? '●'} ${summary.text}`}</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text dimColor>{fill(l.scanned ?? 'examiné {ago} · {n} dossiers', { ago: fmtAgo(m.report.generated, now), n: rows.length }) + (busy ? ` · ${busy}` : '') + (m.copied ? ` · ${m.copied}` : '')}</Text>
        <Button key="refresh" plain onPress={() => m.onRefresh()}>{l.refresh_button ?? '↻'}</Button>
      </Box>
      {m.error ? <Text color="error">{`scan : ${m.error}`}</Text> : null}
      <Box flexDirection="column" gap={1}>
        <Text bold>{l.section_active ?? 'Mods actifs'}</Text>
        {active.map(modBlock)}
      </Box>
      {off.length ? (
        <Box flexDirection="column">
          <Text bold>{l.section_off ?? 'Installés, non chargés'}</Text>
          {off.map((r: any) => (
            <Text {...color('off')}>{`${icons.off ?? '○'} ${r.name}${r.version ? ` ${r.version}` : ''} · ${src(r.source)}${r.dir ? ` · ${(homeDir && r.dir.startsWith(homeDir) ? `~${r.dir.slice(homeDir.length)}` : r.dir)}` : ''}`}</Text>
          ))}
        </Box>
      ) : null}
      <Box flexDirection="column">
        {(l.notes ?? []).map((x: string) => <Text dimColor>{`· ${x}`}</Text>)}
      </Box>
    </Box>
  )
}
