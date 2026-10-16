// sante mod ("Santé des mods"): a read-only self-check of every mod. /sante [refresh] opens the pane; /sante close
// closes it. The file facts (manifests, hooks, configs, caches, logs, health records) come from scanner/sante_scan.mjs,
// run in the background only while the pane is asked for; this hook adds the session's slash commands
// ($.command.list) and the engine version ($.session.version) and draws one green / orange / red line on top.
// Nothing here blocks, rewrites or delays a tool call or a prompt, nothing reaches the model (the command returns no
// text) and nothing is deleted: cleanup commands are only shown, with a Copy button.
import type { EngineInterface, Register } from 'claude-code'

import { deepMerge, evaluate, expandHome, fill, fmtAgo, fmtBytes, fmtDur, fmtNum, splitDirs } from './logic.mjs'

const PANE = 'sante'
type Options = { config?: string }
let options: Options = {}

const S: { busy: boolean; error: string; report: any; commands: any[]; engine: string; copied: string } = {
  busy: false, error: '', report: undefined, commands: [], engine: '', copied: '',
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
    return JSON.parse(((await $.fs.read(path, { as: 'text' })) as string).replace(/^﻿/, ''))
  } catch {
    return undefined
  }
}

async function context($: EngineInterface) {
  const root = $.plugin.root.replace(/\\/g, '/')
  const hd = await home($)
  const base = (await readJson($, `${root}/sante.config.json`)) || {}
  const dataDir = expandHome(base.data_dir || '~/.claude/sante-mod', hd)
  let cfg = deepMerge(base, (await readJson($, `${dataDir}/sante.config.json`)) || {})
  if (options.config?.trim()) cfg = deepMerge(cfg, (await readJson($, expandHome(options.config.trim(), hd))) || {})
  return { root, home: hd, dataDir, cfg }
}

/** Commands and engine version of this session: local calls, no model. */
async function sessionFacts($: EngineInterface) {
  try {
    S.commands = (await $.command.list()).map(c => ({ name: c.name, source: c.source, ...(c.plugin ? { plugin: c.plugin } : {}) }))
  } catch {}
  try {
    S.engine = (await $.session.version()).version
  } catch {}
}

/** Runs the scanner and redraws; never awaited by a hook the person waits on. */
async function rescan($: EngineInterface) {
  if (S.busy) return
  S.busy = true
  $.ui.invalidate('ui.render')
  try {
    await sessionFacts($)
    const { root, home: hd, cfg } = await context($)
    const dirs = splitDirs(await $.env.get('CLAUDE_CODE_PLUGIN_DIRS'))
    const siblings = cfg.siblings === false ? [] : [root.replace(/\/[^/]+$/, '')]
    const now = await $.clock.now()
    const r = await $.process.run([cfg.node || 'node', `${root}/scanner/sante_scan.mjs`], {
      stdin: JSON.stringify({ dirs, home: hd, cfg, now, siblings }),
      timeoutMs: Math.min((cfg.scan_timeout_s ?? 60) * 1000, 600000),
    })
    const out = JSON.parse(r.stdout || '{}')
    if (r.exitCode !== 0 || out.error) throw new Error(out.error || (r.stderr || '').trim().split('\n').pop() || `scanner exit ${r.exitCode}`)
    S.report = out
    S.error = ''
  } catch (err) {
    S.error = String((err as Error)?.message ?? err).slice(0, 300)
  } finally {
    S.busy = false
  }
  $.ui.invalidate('ui.render')
}

async function load($: EngineInterface) {
  const { cfg, dataDir, home: homeDir } = await context($)
  if (!S.report) S.report = await readJson($, `${dataDir}/report.json`)
  const now = await $.clock.now()
  const stale = !S.report || now - (S.report.generated || 0) > (cfg.refresh_min ?? 10) * 60000
  return { cfg, now, stale, homeDir }
}

export const register: Register = (on, raw) => {
  options = (raw ?? {}) as Options

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sante',
      description: 'Santé des mods : chargés ou non, versions, commandes, caches, erreurs, CPU des scans, JSON invalides (args: [refresh] | close)',
      argumentHint: '[refresh] | close',
    })
    return next(e)
  })

  on('command.run', { command: 'sante' }, async ($, e) => {
    const words = String(e.args ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words[0] === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }
    await sessionFacts($)
    const { cfg, stale } = await load($)
    if (stale || words.includes('refresh')) $.clock.after(0, () => rescan($))
    await $.ui.open({ id: PANE, title: cfg.labels?.pane_title ?? 'Santé des mods' })
    return {} // a pane, no transcript text: nothing for the model to read
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { cfg, now, homeDir } = await load($)
    const l = cfg.labels ?? {}
    const colors = cfg.colors ?? {}
    const icons = cfg.icons ?? {}
    const color = (lv: string) => (colors[lv] ? { color: colors[lv] } : {})
    const busy = S.busy ? l.busy ?? 'examen en cours…' : ''
    if (!S.report) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{l.first_scan ?? 'Premier examen des mods en cours…'}</Text>
          {S.error ? <Text color="error">{`scan : ${S.error}`}</Text> : null}
          {busy ? <Text dimColor>{busy}</Text> : null}
        </Box>
      )
    }
    const { rows, summary } = evaluate(S.report, { commands: S.commands, engine: S.engine, cfg, now })
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
              <Button
                key={`copy-${r.name}-${i}`}
                plain
                onPress={async (press: any) => {
                  const c = await $.ui.copy({ text: cmd, surface: press?.surface })
                  S.copied = c?.isCopied ? l.copied ?? 'copié' : l.copy_failed ?? 'copie impossible'
                  $.ui.invalidate('ui.render')
                }}
              >
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
          <Text dimColor>{fill(l.scanned ?? 'examiné {ago} · {n} dossiers', { ago: fmtAgo(S.report.generated, now), n: rows.length }) + (busy ? ` · ${busy}` : '') + (S.copied ? ` · ${S.copied}` : '')}</Text>
          <Button key="refresh" plain onPress={() => { $.clock.after(0, () => rescan($)) }}>{l.refresh_button ?? '↻'}</Button>
        </Box>
        {S.error ? <Text color="error">{`scan : ${S.error}`}</Text> : null}
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
  })
}
