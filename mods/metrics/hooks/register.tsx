// metrics mod ("Les règles marchent ?"): read-only view of whether the rules help, per day and per rules version.
// /regles [V5.8] [refresh] opens the pane. Figures come from scanner/metrics_scan.mjs (Node, incremental): transcripts
// (usage mod's parser), merged PRs/MRs and CI runs (gh / glab list calls), and the rules file's git log for the
// version markers. The drawing is hooks/pane.mjs (pure, also drawn by the registres mod's « Règles » tab). The command shows a pane and returns no text, so nothing reaches the model; nothing here blocks,
// rewrites or delays a tool call or a prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { deepMerge, expandHome } from './view.mjs'
import { drawRegles } from './pane.mjs'

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
      argumentHint: '[V5.8] [refresh] | close',
    })
    return next(e)
  })

  on('command.run', { command: 'regles' }, async ($, e) => {
    if ((e.args ?? '').trim().toLowerCase() === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }
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
    const { cfg, model } = await load($)
    const want = (await read($, versionAtom)) as string
    return drawRegles($.ui.resolve(e), { cfg, model, want, busy: S.busy, error: S.error }, {
      setVersion: (v: string) => update($, versionAtom, () => v),
      rescan: () => { $.clock.after(0, () => rescan($, true)) },
    }) as any
  })
}
