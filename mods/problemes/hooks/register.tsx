// problemes mod (« Problèmes »): Julian's persistent register of every error and problem with Claude work.
// /problemes [refresh|close|P-NNN] opens the pane. Figures come from scanner/problemes_scan.mjs (Node, zero tokens):
// it reads new transcript bytes and the desktop app's session files, dedupes hits into problems by signature and
// appends to ~/.claude/problemes/register.jsonl; the pane reads the folded snapshot problems.json. The only write
// from the pane is « Ajouter une note », which runs the scanner's `note` command (local ledger only). The command
// shows a pane and returns no text (its drawing is hooks/view.mjs, pure, also drawn by the registres mod's tab), so nothing reaches the model; nothing here blocks, rewrites or delays anything.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { deepMerge, fill } from '../lib/core.mjs'
import { drawProblemes } from './view.mjs'

const PANE = 'problemes'
const statusAtom = atom({ plugin: 'problemes', key: 'status' } as const, 'all')
const weekAtom = atom({ plugin: 'problemes', key: 'week' } as const, 'all')
const categoryAtom = atom({ plugin: 'problemes', key: 'category' } as const, 'all')
const appAtom = atom({ plugin: 'problemes', key: 'app' } as const, 'all')
const openAtom = atom({ plugin: 'problemes', key: 'open' } as const, [] as string[])
const noteAtom = atom({ plugin: 'problemes', key: 'noteMsg' } as const, '')

const S: { busy: boolean; error: string; snap: any; exporting: boolean; exportMsg: string } = { busy: false, error: '', snap: undefined, exporting: false, exportMsg: '' }

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
  const base = (await readJson($, `${root}/problemes.config.json`)) || {}
  const dataDir = String(base.data_dir || '~/.claude/problemes').replace(/^~(?=[\\/]|$)/, h).replace(/\\/g, '/')
  const cfg = deepMerge(base, (await readJson($, `${dataDir}/problemes.config.json`)) || {})
  return { root, dataDir, cfg }
}

const scanner = (root: string, cfg: any, args: string[]) => [cfg.node || 'node', `${root}/scanner/problemes_scan.mjs`, ...args]

/** Runs the collector in the background and redraws; never awaited by a hook the person waits on. */
async function collect($: EngineInterface, force = false) {
  if (S.busy) return
  S.busy = true
  $.ui.invalidate('ui.render')
  try {
    const { root, cfg } = await context($)
    const r = await $.process.run(scanner(root, cfg, ['collect', ...(force ? ['--force'] : [])]), { timeoutMs: Math.min((cfg.collect_timeout_s ?? 300) * 1000, 600000) })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `collect exit ${r.exitCode}`)
    S.error = ''
    S.snap = undefined
  } catch (err) {
    S.error = String((err as Error)?.message ?? err).slice(0, 300)
  } finally {
    S.busy = false
  }
  $.ui.invalidate('ui.render')
}

/** « Exporter vers eta » / `/problemes export`: the scanner's `export` (masked register → eta repo by PR), in the background. */
async function exportEta($: EngineInterface) {
  if (S.exporting) return
  S.exporting = true
  S.exportMsg = ''
  $.ui.invalidate('ui.render')
  try {
    const { root, cfg } = await context($)
    const r = await $.process.run(scanner(root, cfg, ['export']), { timeoutMs: 600000 })
    S.exportMsg = ((r.exitCode === 0 ? r.stdout : r.stderr || r.stdout) || '').trim().split('\n').pop()?.replace(/^problemes: /, '').slice(0, 300) || `exit ${r.exitCode}`
  } catch (err) {
    S.exportMsg = String((err as Error)?.message ?? err).slice(0, 300)
  } finally {
    S.exporting = false
  }
  $.ui.invalidate('ui.render')
}

async function load($: EngineInterface) {
  const { cfg, dataDir, root } = await context($)
  const snap = S.snap ?? (S.snap = await readJson($, `${dataDir}/problems.json`))
  const now = await $.clock.now()
  const stale = !snap || now - (snap.collected || 0) > (cfg.refresh_min ?? 30) * 60000
  return { cfg, snap, stale, now, root }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'problemes',
      description: 'Problèmes : registre des erreurs et blocages du travail de Claude (questions à Julian, gardes, CI, Workflows), par catégorie et par application',
      argumentHint: '[refresh | P-NNN | export] | close',
    })
    return next(e)
  })

  on('command.run', { command: 'problemes' }, async ($, e) => {
    const args = String(e.args ?? '').trim()
    if (args.toLowerCase() === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }
    const { cfg, stale, snap } = await load($)
    if (args.toLowerCase() === 'export') $.clock.after(0, () => exportEta($))
    const refresh = /\brefresh\b/i.test(args)
    const id = args.match(/\bP-\d+\b/i)?.[0]?.toUpperCase()
    if (id) {
      const p = (snap?.problems ?? []).find((x: any) => x.id === id)
      const nodes = p ? [`c:${p.category.split('/')[0]}`, `c:${p.category}`, `p:${id}`] : [`p:${id}`]
      await update($, openAtom, (o: string[]) => [...new Set([...(o ?? []), ...nodes])])
    }
    if (stale || refresh) $.clock.after(0, () => collect($, refresh && /--force/.test(args)))
    await $.ui.open({ id: PANE, title: cfg.labels?.pane_title ?? 'Problèmes' })
    return {} // a pane, no transcript text: nothing for the model to read
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { cfg, snap, now, root } = await load($)
    const L = cfg.labels ?? {}
    const f = {
      status: (await read($, statusAtom)) as string,
      week: (await read($, weekAtom)) as string,
      category: (await read($, categoryAtom)) as string,
      app: (await read($, appAtom)) as string,
    }
    const open = ((await read($, openAtom)) as string[]) ?? []
    const noteMsg = (await read($, noteAtom)) as string

    const note = async (id: string, text: string) => {
      const v = String(text ?? '').trim()
      if (!v) return
      try {
        const r = await $.process.run(scanner(root, cfg, ['note', id, v]), { timeoutMs: 30000 })
        if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `exit ${r.exitCode}`)
        S.snap = undefined
        await update($, noteAtom, () => fill(L.note_saved, { id }))
      } catch (err) {
        await update($, noteAtom, () => fill(L.note_failed, { error: String((err as Error)?.message ?? err).slice(0, 200) }))
      }
    }

    return drawProblemes($.ui.resolve(e), { cfg, snap, now, f, open, noteMsg, busy: S.busy, error: S.error, exporting: S.exporting, exportMsg: S.exportMsg }, {
      flip: (id: string) => update($, openAtom, (o: string[]) => (o?.includes(id) ? o.filter(x => x !== id) : [...(o ?? []), id])),
      setFilter: (name: string, v: string) =>
        name === 'status' ? update($, statusAtom, () => v)
          : name === 'week' ? update($, weekAtom, () => v)
            : name === 'category' ? update($, categoryAtom, () => v)
              : update($, appAtom, () => v),
      refresh: () => { $.clock.after(0, () => collect($)) },
      exportEta: () => { $.clock.after(0, () => exportEta($)) },
      note,
    }) as any
  })
}
