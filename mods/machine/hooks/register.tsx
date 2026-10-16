// machine mod ("Machine"): live view of this PC, read-only.
//   /machine            opens the pane: CPU (total, per core), RAM, disks, GPU, top processes (claude, node, python,
//                       git highlighted), GitLab runner load (through the ci mod's scanner) and
//                       « agents en parallèle conseillés maintenant : N » from the rule in machine.config.json
//   /machine refresh    the same, sampled now; /machine ci checks the runner now (ci.py --refresh)
// Sampling (scanner/machine.py) runs only while the pane is open, every interval_s (default 5 s), or every
// band.interval_s when the optional band entry is on (userConfig band, off by default). Nothing here blocks,
// rewrites or delays a tool call, and nothing is added to any prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GpuInfo, RunnerInfo, Sample } from '../types'
import {
  advise,
  bandParts,
  bar,
  ciText,
  coreBar,
  deepMerge,
  expandHome,
  fmtBytes,
  fmtPct,
  gpuText,
  hms,
  intervalMs,
  level,
  metrics,
  parseArgs,
  summary,
} from './logic'
import type { Config, Part } from './logic'

const PANE = { id: 'machine' }
const sampleAtom = atom({ plugin: 'machine', key: 'sample' } as const, null)
const gpuAtom = atom({ plugin: 'machine', key: 'gpu' } as const, null)
const runnerAtom = atom({ plugin: 'machine', key: 'runner' } as const, null)
const errorAtom = atom({ plugin: 'machine', key: 'error' } as const, '')

const DOCS = {
  mods: 'https://code.claude.com/docs/en/plugins/mods/overview',
}

type Options = { config?: string; band?: string }

let options: Options = {}
let cfg: Config | undefined
let cfgProblem = ''
let timer: { cancel: () => void } | undefined
let timerMs = 0
let paneOpen = false
let sampling = false
let runnerBusy = false
let prevRaw: Sample['raw'] | undefined
let lastGpuAt = 0
let lastRunnerAt = 0

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

const loadConfig = async ($: EngineInterface): Promise<Config> => {
  if (cfg) return cfg
  const root = $.plugin.root.replace(/\\/g, '/')
  let base = {} as Config
  try {
    base = JSON.parse((await $.fs.read(`${root}/machine.config.json`, { as: 'text' })) as string)
  } catch (err) {
    cfgProblem = `machine.config.json: ${String(err).slice(0, 120)}`
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

const scanner = ($: EngineInterface) => `${$.plugin.root.replace(/\\/g, '/')}/scanner/machine.py`

/** One sample; the previous raw counters go back in so the % cover the time since the last sample. */
const sampleNow = async ($: EngineInterface) => {
  if (sampling) return
  sampling = true
  try {
    const c = await loadConfig($)
    const now = await $.clock.now()
    const fresh = prevRaw && now - prevRaw.t * 1000 < 3 * Math.max(timerMs, intervalMs(c))
    const wantGpu = c.gpu.source !== 'off' && now - lastGpuAt >= c.gpu.refresh_s * 1000
    const req = {
      prev: fresh ? prevRaw : null,
      first_delta_ms: c.first_delta_ms,
      top_n: c.top_n,
      families: c.families,
      runner_process: c.ci.runner_process,
      disks_exclude: c.disks_exclude,
      gpu: wantGpu,
      gpu_source: c.gpu.source,
      gpu_perf_counter: c.gpu.perf_counter,
    }
    const r = await $.process.run([c.python, '-I', scanner($), 'sample'], { stdin: JSON.stringify(req), timeoutMs: 30000 })
    let s: Sample | undefined
    try {
      s = JSON.parse(r.stdout)
    } catch {}
    if (!s || r.exitCode !== 0) {
      await update($, errorAtom, () => `machine.py : ${(r.stderr || r.stdout || `exit ${r.exitCode}`).trim().split('\n').pop()?.slice(0, 200)}`)
      return
    }
    prevRaw = s.raw
    const { raw: _raw, ...clean } = s
    if (wantGpu) lastGpuAt = now
    await update($, sampleAtom, () => clean as Sample)
    if (s.gpu) await update($, gpuAtom, () => s!.gpu as GpuInfo)
    await update($, errorAtom, () => '')
  } catch (err) {
    await update($, errorAtom, () => `machine.py : ${String(err).slice(0, 200)}`)
  } finally {
    sampling = false
  }
}

/** GitLab runner load through the ci mod's scanner (its config, its cache); in the background, never overlapping. */
const runnerSoon = ($: EngineInterface, force = false) => {
  if (runnerBusy) return
  runnerBusy = true
  $.clock.after(0, async () => {
    try {
      const c = await loadConfig($)
      const now = await $.clock.now()
      if (!c.ci.enabled || (!force && now - lastRunnerAt < c.ci.refresh_s * 1000)) return
      lastRunnerAt = now
      const h = await home($)
      const args = [c.python, '-I', scanner($), 'runner']
      if (c.ci.scanner) args.push('--ci', expandHome(c.ci.scanner, h))
      if (c.ci.config) args.push('--ci-config', expandHome(c.ci.config, h))
      for (const b of c.ci.backends) args.push('--backend', b)
      if (force) args.push('--refresh')
      const r = await $.process.run(args, { timeoutMs: 120000 })
      let info: RunnerInfo | undefined
      try {
        info = JSON.parse(r.stdout)
      } catch {}
      await update($, runnerAtom, () => info ?? { generated: null, backends: [], error: `exit ${r.exitCode}` })
    } catch (err) {
      await update($, runnerAtom, () => ({ generated: null, backends: [], error: String(err).slice(0, 160) }))
    } finally {
      runnerBusy = false
    }
  })
}

const tick = async ($: EngineInterface) => {
  await sampleNow($)
  runnerSoon($)
}

/** Pane open: every interval_s. Pane closed and band on: every band.interval_s. Otherwise no timer at all. */
const schedule = async ($: EngineInterface) => {
  const c = await loadConfig($)
  const want = paneOpen ? intervalMs(c) : options.band === 'on' ? intervalMs(c, true) : 0
  if (want === timerMs && (timer || !want)) return
  timer?.cancel()
  timer = undefined
  timerMs = want
  if (want) timer = $.clock.every(want, () => void tick($))
}

export const register: Register = (on, raw) => {
  options = (raw ?? {}) as Options
  cfg = undefined
  timer?.cancel()
  timer = undefined
  timerMs = 0

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'machine',
      description: 'Machine: CPU, RAM, disques, GPU, top processus, charge du runner GitLab et agents en parallèle conseillés (args: [refresh|ci])',
      argumentHint: '[refresh|ci]',
    })
    if (options.band === 'on') {
      await schedule($)
      void tick($)
    }
    return started
  })

  on('command.run', { command: 'machine' }, async ($, e) => {
    const p = parseArgs(e.args ?? '')
    const c = await loadConfig($)
    await $.ui.open({ id: PANE.id, title: c.labels.pane_title ?? 'Machine' })
    paneOpen = true
    await schedule($)
    if (p.refresh) prevRaw = undefined
    await sampleNow($)
    runnerSoon($, p.ci)
    const s = await read($, sampleAtom)
    const err = await read($, errorAtom)
    return { text: `${summary(s, await read($, gpuAtom), await read($, runnerAtom), c)}${err ? `\nerreur : ${err}` : ''}${cfgProblem ? `\n${cfgProblem}` : ''}` }
  })

  // The pane closed: stop sampling (or fall back to the band's slower pace).
  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE.id) {
      paneOpen = false
      await schedule($)
    }
    return r
  }).catch(($, e, next) => next(e))

  // Optional compact entry in the band, below what the mods after this one draw there (theirs kept).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (options.band !== 'on' || e.props.hasSurvey) return next(e)
    const c = await loadConfig($)
    const parts = bandParts(await read($, sampleAtom), await read($, gpuAtom), await read($, runnerAtom), c)
    const theirs = await next(e)
    if (!parts.length) return theirs
    const { Box, Text } = $.ui.resolve(e)
    const color = (p: Part) => (p.tone && c.colors[p.tone] ? { color: c.colors[p.tone] } : { dimColor: true })
    return (
      <Box flexDirection="column">
        {theirs}
        <Box flexDirection="row" flexWrap="wrap">
          {parts.map((p, i) => (
            <Text key={`m${i}`} {...color(p)}>
              {`${i ? ' · ' : ''}${p.text}`}
            </Text>
          ))}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: 'machine' }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const c = await loadConfig($)
    if (!paneOpen) {
      // the module reloaded while the pane stayed open: resume sampling
      paneOpen = true
      void schedule($)
    }
    const s = await read($, sampleAtom)
    const gpu = await read($, gpuAtom)
    const runner = await read($, runnerAtom)
    const err = await read($, errorAtom)
    const L = c.labels
    const tone = (t?: string) => (t && c.colors[t] ? { color: c.colors[t] } : {})
    const pad = (x: string, n: number) => (x.length >= n ? x.slice(0, n - 1) + ' ' : x + ' '.repeat(n - x.length))
    const lpad = (x: string, n: number) => (x.length >= n ? x : ' '.repeat(n - x.length) + x)
    const nv = <Text color={c.colors.warn}>non vérifié</Text>

    const head = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="refresh" hotkey="r" onPress={() => void sampleNow($)}>
          {L.refresh ?? 'Actualiser'}
        </Button>
        <Button key="ci" hotkey="c" onPress={() => runnerSoon($, true)}>
          {L.refresh_ci ?? 'Vérifier le runner'}
        </Button>
        <Text dimColor>
          {s
            ? `mesuré à ${hms(s.at)} · toutes les ${Math.round(timerMs / 1000) || c.interval_s} s tant que ce panneau est ouvert · mesure ${s.ms} ms · ${s.procs.count} processus`
            : L.measuring ?? 'mesure en cours'}
        </Text>
      </Box>
    )
    if (!s) {
      return (
        <Box flexDirection="column" gap={1}>
          {head}
          {err ? <Text color={c.colors.bad}>{`erreur : ${err}`}</Text> : null}
          {cfgProblem ? <Text color={c.colors.bad}>{cfgProblem}</Text> : null}
        </Box>
      )
    }

    const m = metrics(s, gpu, runner, c)
    const a = advise(m, c.advice)
    const advice = (
      <Box flexDirection="column">
        <Text bold {...tone(a.n < a.base ? 'warn' : 'ok')}>{`${L.advice} : ${a.n}`}</Text>
        <Text dimColor wrap="wrap">
          {`base ${a.base}` +
            (a.reasons.length ? ` · ${a.reasons.map(r => `${r.label} (${r.effect})`).join(' · ')}` : ' · aucune règle déclenchée') +
            ` · bornes ${c.advice.floor}–${c.advice.ceiling}` +
            (a.unknown.length ? ` · non mesuré : ${a.unknown.join(', ')}` : '')}
        </Text>
      </Box>
    )

    const cpu = (
      <Box flexDirection="column">
        <Text>
          <Text bold>{pad(L.cpu, 8)}</Text>
          <Text {...tone(level(m.cpu, c.levels))}>{`${bar(m.cpu)} ${lpad(fmtPct(m.cpu), 5)}`}</Text>
          <Text dimColor>{` · ${s.ncpu} cœurs logiques · sur ${(s.interval_ms / 1000).toFixed(1).replace('.', ',')} s`}</Text>
        </Text>
        {s.cpu.cores.length ? (
          <Text>
            <Text dimColor>{pad(L.cores, 8)}</Text>
            <Text {...tone(level(Math.max(...s.cpu.cores), c.levels))}>{coreBar(s.cpu.cores)}</Text>
            <Text dimColor>{`  ${s.cpu.cores.map(x => Math.round(x)).join(' ')}`}</Text>
          </Text>
        ) : null}
        <Text>
          <Text bold>{pad(L.ram, 8)}</Text>
          <Text {...tone(level(m.ram, c.levels))}>{`${bar(m.ram)} ${lpad(fmtPct(m.ram), 5)}`}</Text>
          <Text dimColor>{s.ram ? ` · ${fmtBytes(s.ram.used)} / ${fmtBytes(s.ram.total)}` : ''}</Text>
        </Text>
        <Text>
          <Text bold>{pad(L.gpu, 8)}</Text>
          {m.gpu !== undefined ? <Text {...tone(level(m.gpu, c.levels))}>{`${bar(m.gpu)} ${lpad(fmtPct(m.gpu), 5)} · `}</Text> : null}
          <Text dimColor>{gpu ? `${gpuText(gpu, L)} (${gpu.source})` : L.measuring ?? 'mesure en cours'}</Text>
        </Text>
        <Text>
          <Text bold>{pad(L.disks, 8)}</Text>
          {s.disks.map((d, i) => (
            <Text key={`d${i}`} {...(d.pct_used >= c.disk_warn_pct ? tone('warn') : {})}>
              {`${i ? ' · ' : ''}${d.drive} ${fmtBytes(d.free)} ${L.free ?? 'libres'} / ${fmtBytes(d.total)}`}
            </Text>
          ))}
        </Text>
      </Box>
    )

    const procRow = (p: Sample['procs']['top_cpu'][number], key: string) => (
      <Text key={key} {...(p.family ? tone(p.family) : { dimColor: true })}>
        {pad(p.name, 30) + lpad(p.cpu == null ? '-' : `${p.cpu.toFixed(1).replace('.', ',')} %`, 9) + lpad(fmtBytes(p.ram), 10) + lpad(String(p.pid), 8)}
      </Text>
    )
    const header = <Text dimColor>{pad('processus', 30) + lpad('CPU', 9) + lpad('mémoire', 10) + lpad('pid', 8)}</Text>
    const procs = (
      <Box flexDirection="column">
        <Text bold>{L.top_cpu}</Text>
        {header}
        {s.procs.top_cpu.length ? s.procs.top_cpu.map((p, i) => procRow(p, `c${i}`)) : <Text dimColor>{L.measuring}</Text>}
        <Text bold>{L.top_ram}</Text>
        {header}
        {s.procs.top_ram.map((p, i) => procRow(p, `r${i}`))}
        <Text>
          <Text bold>{`${L.families} : `}</Text>
          {Object.keys(c.families).map((f, i) => {
            const x = s.procs.families[f]
            return (
              <Text key={`f${f}`} {...tone(f)}>
                {`${i ? ' · ' : ''}${f} ×${x?.count ?? 0}${x ? ` ${fmtPct(x.cpu)} ${fmtBytes(x.ram)}` : ''}`}
              </Text>
            )
          })}
        </Text>
        <Text dimColor wrap="wrap">
          {'CPU = part de toute la machine (100 % = tous les cœurs) ; mémoire = working set.' +
            (s.procs.unreadable
              ? ` ${s.procs.unreadable} processus système illisibles sans droits admin` +
                (m.cpu !== undefined && s.procs.cpu_attributed !== undefined
                  ? ` : ${fmtPct(Math.max(0, m.cpu - s.procs.cpu_attributed))} du CPU leur revient (non attribué).`
                  : '.')
              : '')}
        </Text>
      </Box>
    )

    const ci = (
      <Box flexDirection="column">
        <Text>
          <Text bold>{`${L.ci} : `}</Text>
          <Text>{ciText(runner, m, s, c)}</Text>
        </Text>
        {(runner?.backends ?? []).map(b => (
          <Text key={`b${b.id}`} dimColor wrap="wrap">
            {`  ${b.label} (${b.id}${b.tag ? `, tag ${b.tag}` : ''}) · ${b.usable === 'yes' ? 'utilisable' : b.usable === 'no' ? 'non utilisable' : 'inconnu'} · ${b.why}` +
              (b.runners ? ` · runners ${b.runners.online}/${b.runners.total} en ligne` : '') +
              (b.jobs ? ` · jobs ${b.jobs.running ?? '?'} ${L.running}, ${b.jobs.pending ?? 'non suivi'} ${L.pending}` : '') +
              (b.concurrent ? ` · concurrent ${b.concurrent}` : '')}
          </Text>
        ))}
        <Box flexDirection="row" gap={1}>
          <Text dimColor>
            {`via le scanner du mod ci (cache ${runner?.generated ?? 'jamais'}) ; jobs en attente seulement pour les pending_projects de sa config ; enfants du processus runner = jobs locaux :`}
          </Text>
          {nv}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {head}
        {err ? <Text color={c.colors.bad}>{`erreur : ${err}`}</Text> : null}
        {cfgProblem ? <Text color={c.colors.bad}>{cfgProblem}</Text> : null}
        {advice}
        {cpu}
        {procs}
        {ci}
        <Box flexDirection="column">
          <Text dimColor wrap="wrap">
            Sources : compteurs du système (Windows : ntdll/kernel32, Linux : /proc), nvidia-smi ou compteur de performance Windows pour le GPU, scanner du mod ci pour le runner. Lecture seule ; règles et seuils dans machine.config.json.
          </Text>
          <Box flexDirection="row" gap={1}>
            <Link href={DOCS.mods} label={DOCS.mods} />
          </Box>
        </Box>
      </Box>
    )
  })
}
