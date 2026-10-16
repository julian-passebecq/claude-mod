// tests-reels mod (« Tests réels »): read-only registry of real (non-CI) tests per application. /tests [refresh|close]
// opens the pane. Data: ~/.claude/tests-reels (registry.json written by cli.mjs, runs.jsonl appended by agents after a
// real test, recovered.json written by scanner/recover.mjs). The pane only reads them; the « Lancer la récupération »
// button runs the scanner, which writes only into that folder. No secret value is ever stored or shown: accounts show
// a masked login and where the secret lives. The command returns no text, so nothing reaches the model; nothing here
// blocks, rewrites or delays a tool call or a prompt. The drawing is hooks/view.mjs (pure, also drawn by the registres
// mod's « Tests réels » tab).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { buildView, deepMerge, fill, parseRuns } from '../lib/registry.mjs'
import { drawTestsReels } from './view.mjs'

const PANE = 'tests-reels'
const openAtom = atom({ plugin: 'tests-reels', key: 'open' } as const, null as unknown as string[])
const revealAtom = atom({ plugin: 'tests-reels', key: 'reveal' } as const, [] as string[])
const statusAtom = atom({ plugin: 'tests-reels', key: 'status' } as const, '')

const S: { busy: boolean; error: string; view: any; at: number } = { busy: false, error: '', view: undefined, at: 0 }

const home = async ($: EngineInterface) => {
  let v: string | undefined
  try {
    v = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  } catch {}
  return (v ?? '').replace(/\\/g, '/')
}
const readText = async ($: EngineInterface, path: string): Promise<string | undefined> => {
  try {
    return (await $.fs.read(path, { as: 'text' })) as string
  } catch {
    return undefined
  }
}
const readJson = async ($: EngineInterface, path: string): Promise<any> => {
  const t = await readText($, path)
  try {
    return t ? JSON.parse(t) : undefined
  } catch {
    return undefined
  }
}

async function context($: EngineInterface) {
  const root = $.plugin.root.replace(/\\/g, '/')
  const h = await home($)
  const base = (await readJson($, `${root}/tests-reels.config.json`)) || {}
  const dataDir = String(base.data_dir || '~/.claude/tests-reels').replace(/^~(?=[\\/]|$)/, h).replace(/\\/g, '/')
  const localText = await readText($, `${dataDir}/config.json`)
  const local = await readJson($, `${dataDir}/config.json`)
  const cfg = deepMerge(base, local || {})
  cfg._local_error = localText && !local ? `${dataDir}/config.json illisible (JSON invalide)` : ''
  return { root, dataDir, cfg }
}

async function load($: EngineInterface) {
  const { cfg, dataDir, root } = await context($)
  if (!S.view) {
    const registry = (await readJson($, `${dataDir}/registry.json`)) || { apps: [] }
    const runs = parseRuns((await readText($, `${dataDir}/runs.jsonl`)) || '')
    const recovered = (await readJson($, `${dataDir}/recovered.json`)) || null
    S.view = buildView(registry, runs, recovered, cfg)
  }
  return { cfg, dataDir, root, view: S.view, now: await $.clock.now() }
}

const reload = ($: EngineInterface) => {
  S.view = undefined
  $.ui.invalidate('ui.render')
}

/** Runs the recovery scanner in the background (only on a button press); writes only into the data folder. */
async function recover($: EngineInterface) {
  if (S.busy) return
  S.busy = true
  $.ui.invalidate('ui.render')
  try {
    const { root, cfg } = await context($)
    const r = await $.process.run([cfg.node || 'node', `${root}/scanner/recover.mjs`], { timeoutMs: Math.min((cfg.scan_timeout_s ?? 600) * 1000, 600000) })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `scanner exit ${r.exitCode}`)
    const out = JSON.parse(String(r.stdout || '{}').trim().split('\n').pop() || '{}')
    S.error = ''
    await update($, statusAtom, () => fill(cfg.labels?.recover_done ?? '', out.counts ?? {}))
  } catch (err) {
    S.error = String((err as Error)?.message ?? err).slice(0, 300)
  } finally {
    S.busy = false
  }
  reload($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tests',
      description: 'Tests réels : registre des tests hors CI par appli (environnements, comptes de test masqués, procédures, derniers essais, À ranger), lecture seule',
      argumentHint: '[refresh] | close',
    })
    return next(e)
  })

  on('command.run', { command: 'tests' }, async ($, e) => {
    const args = String(e.args ?? '').trim().toLowerCase()
    if (args === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }
    S.view = undefined
    const { cfg } = await context($)
    await $.ui.open({ id: PANE, title: cfg.labels?.pane_title ?? 'Tests réels' })
    return {} // a pane, no transcript text: nothing for the model to read
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { cfg, view, now } = await load($)
    const openList = ((await read($, openAtom)) as string[] | null) ?? (cfg.open ?? ['todo'])
    const reveal = (await read($, revealAtom)) as string[]
    const status = (await read($, statusAtom)) as string
    return drawTestsReels($.ui.resolve(e), { cfg, view, now, openList, reveal, status, busy: S.busy, error: S.error }, {
      toggle: (id: string) => update($, openAtom, cur => {
        const list = (cur as string[] | null) ?? (cfg.open ?? ['todo'])
        return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
      }),
      reveal: (rk: string) => update($, revealAtom, l => ((l as string[]).includes(rk) ? (l as string[]).filter(x => x !== rk) : [...(l as string[]), rk])),
      reload: () => reload($),
      recover: () => { $.clock.after(0, () => recover($)) },
    }) as any
  })
}
