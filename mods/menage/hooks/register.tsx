// menage mod ("Ménage"): read-only inventory of what Claude work left lying on this PC, with the exact safe command
// for each row. /menage [refresh|close] opens the pane. Figures come from scanner/menage_scan.mjs (Node, read-only git
// commands, folder sizes, Desktop session files), run in the background. The mod never runs a command it shows and
// never deletes anything; the drawing is hooks/view.mjs (pure, also drawn by the registres mod's « Ménage » tab); the command shows a pane and returns no text, so nothing reaches the model; nothing here
// blocks, rewrites or delays a tool call or a prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { deepMerge, fill } from '../lib/classify.mjs'
import { drawMenage } from './view.mjs'

const PANE = 'menage'
const filterAtom = atom({ plugin: 'menage', key: 'filter' } as const, 'all')
const copiedAtom = atom({ plugin: 'menage', key: 'copied' } as const, '')

const S: { busy: boolean; error: string; model: any } = { busy: false, error: '', model: undefined }

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
  const base = (await readJson($, `${root}/menage.config.json`)) || {}
  const dataDir = String(base.data_dir || '~/.claude/menage-mod').replace(/^~(?=[\\/]|$)/, h).replace(/\\/g, '/')
  const cfg = deepMerge(base, (await readJson($, `${dataDir}/menage.config.json`)) || {})
  return { root, dataDir, cfg }
}

/** Runs the scanner in the background and redraws; never awaited by a hook the person waits on. */
async function rescan($: EngineInterface, force = false) {
  if (S.busy) return
  S.busy = true
  $.ui.invalidate('ui.render')
  try {
    const { root, cfg } = await context($)
    const argv = [cfg.node || 'node', `${root}/scanner/menage_scan.mjs`, 'scan', ...(force ? ['--force'] : [])]
    const r = await $.process.run(argv, { timeoutMs: Math.min((cfg.scan_timeout_s ?? 600) * 1000, 600000) })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `scanner exit ${r.exitCode}`)
    S.error = ''
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
  const model = S.model ?? (S.model = await readJson($, `${dataDir}/menage.json`))
  const now = await $.clock.now()
  const stale = !model || now - (model.generated || 0) > (cfg.refresh_min ?? 30) * 60000
  return { cfg, model, stale, now }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'menage',
      description: 'Ménage : worktrees, branches mergées, dossiers et sessions qui traînent, avec la commande sûre pour chacun (lecture seule, rien n’est supprimé)',
      argumentHint: '[refresh] | close',
    })
    return next(e)
  })

  on('command.run', { command: 'menage' }, async ($, e) => {
    const args = String(e.args ?? '').trim().toLowerCase()
    if (args === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }
    const { cfg, stale } = await load($)
    const refresh = args.split(/\s+/).includes('refresh')
    if (stale || refresh) $.clock.after(0, () => rescan($, refresh))
    await $.ui.open({ id: PANE, title: cfg.labels?.pane_title ?? 'Ménage' })
    return {} // a pane, no transcript text: nothing for the model to read
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { cfg, model, now } = await load($)
    const L = cfg.labels ?? {}
    const filter = (await read($, filterAtom)) as string
    const copied = (await read($, copiedAtom)) as string
    const copy = async (press: any, lines: string[]) => {
      if (!lines.length) return
      const r = await $.ui.copy({ text: lines.join('\n'), surface: press.surface })
      await update($, copiedAtom, () => (r.isCopied ? fill(L.copied, { n: lines.length }) : L.copy_failed))
    }
    return drawMenage($.ui.resolve(e), { cfg, model, now, filter, copied, busy: S.busy, error: S.error }, {
      setFilter: (id: string) => update($, filterAtom, () => id),
      rescan: () => { $.clock.after(0, () => rescan($, true)) },
      copy,
    }) as any
  })
}
