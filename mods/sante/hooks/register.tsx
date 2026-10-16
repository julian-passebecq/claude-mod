// sante mod ("Santé des mods"): a read-only self-check of every mod. /sante [refresh] opens the pane; /sante close
// closes it. The file facts (manifests, hooks, configs, caches, logs, health records) come from scanner/sante_scan.mjs,
// run in the background only while the pane is asked for; this hook adds the session's slash commands
// ($.command.list) and the engine version ($.session.version) and draws one green / orange / red line on top.
// Nothing here blocks, rewrites or delays a tool call or a prompt, nothing reaches the model (the command returns no
// text) and nothing is deleted: cleanup commands are only shown, with a Copy button.
import type { EngineInterface, Register } from 'claude-code'

import { drawSante } from './draw'
import { deepMerge, expandHome, splitDirs } from './logic.mjs'

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
      stdin: JSON.stringify({ dirs, home: hd, cfg, now, siblings, commands: S.commands, engine: S.engine }),
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
    const { cfg, now, homeDir } = await load($)
    return drawSante($.ui.resolve(e), {
      report: S.report, error: S.error, busy: S.busy, copied: S.copied, commands: S.commands, engine: S.engine, cfg, now, homeDir,
      onRefresh: () => { $.clock.after(0, () => rescan($)) },
      onCopy: async (cmd, press) => {
        const c = await $.ui.copy({ text: cmd, surface: press?.surface })
        S.copied = c?.isCopied ? cfg.labels?.copied ?? 'copié' : cfg.labels?.copy_failed ?? 'copie impossible'
        $.ui.invalidate('ui.render')
      },
    })
  })
}
