// registres mod (« Registres »): one pane with tabs Problèmes | Tests réels | Règles | Ménage.
//   /registres [problemes|tests|regles|menage] [the owner's arguments] | close
// Aliases /problemes, /tests, /regles and /menage are registered here only when no other mod serves them in this session,
// so the old mods keep theirs while they are loaded. A mod cannot draw another mod's pane nor import outside its folder,
// so each tab is drawn by a byte-for-byte copy of its owner's pure view (lib/<owner>/hooks/, made by
// scripts/sync-libs.mjs from lib/core/targets.json, never edited by hand) over the owner's own files in ~/.claude.
// The owner's scanner (copied too) runs only on ↻ or when its file is older than the owner's refresh_min. The command
// shows a pane and returns no text, so nothing reaches the model; no model call; nothing here blocks, rewrites or
// delays a tool call or a prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { aliasesToRegister, deepMerge, expandHome, fill, isStale, parseArgs, tabOrder, TABS } from './logic.mjs'
import { drawProblemes } from '../lib/problemes/hooks/view.mjs'
import { drawTestsReels } from '../lib/tests-reels/hooks/view.mjs'
import { buildView, parseRuns } from '../lib/tests-reels/lib/registry.mjs'
import { drawRegles } from '../lib/metrics/hooks/pane.mjs'
import { drawMenage } from '../lib/menage/hooks/view.mjs'

const PANE = 'registres'
const tabAtom = atom({ plugin: 'registres', key: 'tab' } as const, '')
const pStatusAtom = atom({ plugin: 'registres', key: 'p_status' } as const, 'all')
const pWeekAtom = atom({ plugin: 'registres', key: 'p_week' } as const, 'all')
const pCategoryAtom = atom({ plugin: 'registres', key: 'p_category' } as const, 'all')
const pAppAtom = atom({ plugin: 'registres', key: 'p_app' } as const, 'all')
const pOpenAtom = atom({ plugin: 'registres', key: 'p_open' } as const, [] as string[])
const pNoteAtom = atom({ plugin: 'registres', key: 'p_note' } as const, '')
const tOpenAtom = atom({ plugin: 'registres', key: 't_open' } as const, null as unknown as string[] | null)
const tRevealAtom = atom({ plugin: 'registres', key: 't_reveal' } as const, [] as string[])
const tStatusAtom = atom({ plugin: 'registres', key: 't_status' } as const, '')
const rVersionAtom = atom({ plugin: 'registres', key: 'r_version' } as const, '')
const mFilterAtom = atom({ plugin: 'registres', key: 'm_filter' } as const, 'all')
const mCopiedAtom = atom({ plugin: 'registres', key: 'm_copied' } as const, '')

type Slot = { busy: boolean; error: string; data: any; exporting?: boolean; exportMsg?: string }
const S: { aliases: Set<string>; slot: Record<string, Slot> } = {
  aliases: new Set(),
  slot: Object.fromEntries(TABS.map(t => [t, { busy: false, error: '', data: undefined, exporting: false, exportMsg: '' }])),
}

// Owner folder (inside lib/), config file, and data file per tab.
const OWNER: Record<string, { dir: string; config: string; dataDir: string; userConfig: string }> = {
  problemes: { dir: 'problemes', config: 'problemes.config.json', dataDir: '~/.claude/problemes', userConfig: 'problemes.config.json' },
  tests: { dir: 'tests-reels', config: 'tests-reels.config.json', dataDir: '~/.claude/tests-reels', userConfig: 'config.json' },
  regles: { dir: 'metrics', config: 'metrics.config.json', dataDir: '~/.claude/metrics-mod', userConfig: 'metrics.config.json' },
  menage: { dir: 'menage', config: 'menage.config.json', dataDir: '~/.claude/menage-mod', userConfig: 'menage.config.json' },
}

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
    return t ? JSON.parse(t.replace(/^﻿/, '')) : undefined
  } catch {
    return undefined
  }
}

async function hubConfig($: EngineInterface) {
  const root = $.plugin.root.replace(/\\/g, '/')
  const h = await home($)
  const base = (await readJson($, `${root}/registres.config.json`)) || {}
  const dataDir = expandHome(base.data_dir || '~/.claude/registres', h)
  return { root, h, cfg: deepMerge(base, (await readJson($, `${dataDir}/registres.config.json`)) || {}) }
}

/** The owner's config (its copy here, then the person's override in the owner's data folder), as the owner reads it. */
async function ownerContext($: EngineInterface, tab: string) {
  const { root, h } = await hubConfig($)
  const o = OWNER[tab]
  const libRoot = `${root}/lib/${o.dir}`
  const base = (await readJson($, `${libRoot}/${o.config}`)) || {}
  const dataDir = expandHome(base.data_dir || o.dataDir, h)
  const localText = await readText($, `${dataDir}/${o.userConfig}`)
  const local = await readJson($, `${dataDir}/${o.userConfig}`)
  const cfg = deepMerge(base, local || {})
  if (tab === 'tests') cfg._local_error = localText && !local ? `${dataDir}/config.json illisible (JSON invalide)` : ''
  return { libRoot, dataDir, cfg }
}

/** The tab's data, cached until a scanner run or ↻; `generated` is what staleness is measured on. */
async function loadTab($: EngineInterface, tab: string) {
  const { cfg, dataDir, libRoot } = await ownerContext($, tab)
  const slot = S.slot[tab]
  if (slot.data === undefined) {
    if (tab === 'problemes') slot.data = (await readJson($, `${dataDir}/problems.json`)) ?? null
    else if (tab === 'regles') slot.data = (await readJson($, `${dataDir}/metrics.json`)) ?? null
    else if (tab === 'menage') slot.data = (await readJson($, `${dataDir}/menage.json`)) ?? null
    else {
      const registry = (await readJson($, `${dataDir}/registry.json`)) || { apps: [] }
      const runs = parseRuns((await readText($, `${dataDir}/runs.jsonl`)) || '')
      const recovered = (await readJson($, `${dataDir}/recovered.json`)) || null
      slot.data = buildView(registry, runs, recovered, cfg)
    }
  }
  const generated = tab === 'problemes' ? slot.data?.collected : slot.data?.generated
  const now = await $.clock.now()
  const stale = tab === 'tests' ? false : isStale(generated, now, cfg.refresh_min ?? 30)
  return { cfg, dataDir, libRoot, data: slot.data, now, stale }
}

const lastLine = (s: string) => (s || '').trim().split('\n').pop() || ''

/** Runs the owner's scanner copy in the background and redraws; never awaited by a hook the person waits on. */
async function runScanner($: EngineInterface, tab: string, force = false) {
  const slot = S.slot[tab]
  if (slot.busy) return
  slot.busy = true
  $.ui.invalidate('ui.render')
  try {
    const { cfg, libRoot } = await ownerContext($, tab)
    const node = cfg.node || 'node'
    const argv =
      tab === 'problemes' ? [node, `${libRoot}/scanner/problemes_scan.mjs`, 'collect', ...(force ? ['--force'] : [])]
        : tab === 'regles' ? [node, `${libRoot}/scanner/metrics_scan.mjs`, 'scan', ...(force ? ['--force'] : [])]
          : tab === 'menage' ? [node, `${libRoot}/scanner/menage_scan.mjs`, 'scan', ...(force ? ['--force'] : [])]
            : [node, `${libRoot}/scanner/recover.mjs`]
    const limit = tab === 'problemes' ? cfg.collect_timeout_s ?? 300 : cfg.scan_timeout_s ?? 600
    const r = await $.process.run(argv, { timeoutMs: Math.min(limit * 1000, 600000) })
    if (r.exitCode !== 0) throw new Error(lastLine(r.stderr) || `scanner exit ${r.exitCode}`)
    slot.error = ''
    if (tab === 'tests') {
      const out = JSON.parse(lastLine(String(r.stdout || '{}')) || '{}')
      await update($, tStatusAtom, () => fill(cfg.labels?.recover_done ?? '', out.counts ?? {}))
    }
  } catch (err) {
    slot.error = String((err as Error)?.message ?? err).slice(0, 300)
  } finally {
    slot.busy = false
    slot.data = undefined
  }
  $.ui.invalidate('ui.render')
}

/** « Exporter vers eta » of the Problèmes tab: the owner's scanner export (masked register → eta by PR). */
async function exportEta($: EngineInterface) {
  const slot = S.slot.problemes
  if (slot.exporting) return
  slot.exporting = true
  slot.exportMsg = ''
  $.ui.invalidate('ui.render')
  try {
    const { cfg, libRoot } = await ownerContext($, 'problemes')
    const r = await $.process.run([cfg.node || 'node', `${libRoot}/scanner/problemes_scan.mjs`, 'export'], { timeoutMs: 600000 })
    slot.exportMsg = lastLine((r.exitCode === 0 ? r.stdout : r.stderr || r.stdout) || '').replace(/^problemes: /, '').slice(0, 300) || `exit ${r.exitCode}`
  } catch (err) {
    slot.exportMsg = String((err as Error)?.message ?? err).slice(0, 300)
  } finally {
    slot.exporting = false
  }
  $.ui.invalidate('ui.render')
}

/** Shows a tab: its arguments (as the owner's command takes them), then its scanner if the data is stale. */
async function showTab($: EngineInterface, tab: string, rest = '') {
  await update($, tabAtom, () => tab)
  const words = rest.split(/\s+/).filter(Boolean)
  const refresh = words.some(w => w.toLowerCase() === 'refresh')
  const force = words.includes('--force')
  if (tab === 'tests') {
    S.slot.tests.data = undefined
    return
  }
  if (tab === 'regles') {
    const v = words.find(w => /^v\d/i.test(w))
    if (v) await update($, rVersionAtom, () => v.toUpperCase())
  }
  if (tab === 'problemes') {
    if (words.some(w => w.toLowerCase() === 'export')) $.clock.after(0, () => exportEta($))
    const id = rest.match(/\bP-\d+\b/i)?.[0]?.toUpperCase()
    if (id) {
      const { data } = await loadTab($, 'problemes')
      const p = (data?.problems ?? []).find((x: any) => x.id === id)
      const nodes = p ? [`c:${p.category.split('/')[0]}`, `c:${p.category}`, `p:${id}`] : [`p:${id}`]
      await update($, pOpenAtom, (o: string[]) => [...new Set([...(o ?? []), ...nodes])])
    }
  }
  const { stale } = await loadTab($, tab)
  if (stale || refresh) $.clock.after(0, () => runScanner($, tab, tab === 'problemes' ? refresh && force : refresh))
}

async function runCommand($: EngineInterface, args: string, alias = '') {
  const { cfg } = await hubConfig($)
  const current = (await read($, tabAtom)) as string
  const a = parseArgs(args, { alias, current, cfg })
  if (a.close) {
    await $.ui.close({ id: PANE })
    return {}
  }
  await showTab($, a.tab, a.rest)
  await $.ui.open({ id: PANE, title: cfg.labels?.pane_title ?? 'Registres' })
  return {} // a pane, no transcript text: nothing for the model to read
}

/** Registers the short aliases no other mod serves in this session (checked once the other mods have started). */
async function registerAliases($: EngineInterface) {
  try {
    const { cfg } = await hubConfig($)
    const list = await $.command.list()
    const want = aliasesToRegister(list, (cfg.aliases ?? []).filter((a: string) => ['problemes', 'tests', 'regles', 'menage'].includes(a)))
    const desc: Record<string, string> = {
      problemes: 'Problèmes (dans Registres) : registre des erreurs et blocages, par catégorie et par application',
      tests: 'Tests réels (dans Registres) : tests hors CI par appli, comptes masqués, lecture seule',
      regles: 'Règles (dans Registres) : les règles marchent ? par jour et par version (args: [V5.8] [refresh])',
      menage: 'Ménage (dans Registres) : ce qui traîne, avec la commande sûre pour chaque ligne (lecture seule)',
    }
    for (const name of want) {
      if (S.aliases.has(name)) continue
      await $.command.register({ name, description: desc[name], argumentHint: '[refresh] | close' })
      S.aliases.add(name)
    }
  } catch {}
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'registres',
      description: 'Registres : Problèmes, Tests réels, Règles et Ménage dans un seul panneau à onglets (lecture seule)',
      argumentHint: '[problemes | tests | regles | menage] [args] | close',
    })
    const { cfg } = await hubConfig($)
    $.clock.after(cfg.alias_delay_ms ?? 1500, () => registerAliases($))
    return next(e)
  })

  on('command.run', { command: 'registres' }, async ($, e) => runCommand($, String(e.args ?? '')))
  // Aliases: answered only when this mod registered them; otherwise the owner mod's own hook answers.
  on('command.run', { command: 'problemes' }, async ($, e, next) => (S.aliases.has('problemes') ? runCommand($, String(e.args ?? ''), 'problemes').catch(() => ({})) : next(e)))
  on('command.run', { command: 'tests' }, async ($, e, next) => (S.aliases.has('tests') ? runCommand($, String(e.args ?? ''), 'tests').catch(() => ({})) : next(e)))
  on('command.run', { command: 'regles' }, async ($, e, next) => (S.aliases.has('regles') ? runCommand($, String(e.args ?? ''), 'regles').catch(() => ({})) : next(e)))
  on('command.run', { command: 'menage' }, async ($, e, next) => (S.aliases.has('menage') ? runCommand($, String(e.args ?? ''), 'menage').catch(() => ({})) : next(e)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e) as any
    const { Box, Text, Button } = el
    const { cfg: hub } = await hubConfig($)
    const L = hub.labels ?? {}
    const tabs = tabOrder(hub)
    const want = (await read($, tabAtom)) as string
    const tab = tabs.includes(want) ? want : tabs.includes(hub.default_tab) ? hub.default_tab : tabs[0]
    const { cfg, data, now } = await loadTab($, tab)
    const slot = S.slot[tab]
    const later = (tab: string, force = false) => { $.clock.after(0, () => runScanner($, tab, force)) }

    let body: any
    if (tab === 'problemes') {
      const pL = cfg.labels ?? {}
      const note = async (id: string, text: string) => {
        const v = String(text ?? '').trim()
        if (!v) return
        try {
          const { libRoot } = await ownerContext($, 'problemes')
          const r = await $.process.run([cfg.node || 'node', `${libRoot}/scanner/problemes_scan.mjs`, 'note', id, v], { timeoutMs: 30000 })
          if (r.exitCode !== 0) throw new Error(lastLine(r.stderr) || `exit ${r.exitCode}`)
          S.slot.problemes.data = undefined
          await update($, pNoteAtom, () => fill(pL.note_saved, { id }))
        } catch (err) {
          await update($, pNoteAtom, () => fill(pL.note_failed, { error: String((err as Error)?.message ?? err).slice(0, 200) }))
        }
      }
      body = drawProblemes(el, {
        cfg, snap: data, now,
        f: { status: await read($, pStatusAtom), week: await read($, pWeekAtom), category: await read($, pCategoryAtom), app: await read($, pAppAtom) },
        open: ((await read($, pOpenAtom)) as string[]) ?? [], noteMsg: await read($, pNoteAtom),
        busy: slot.busy, error: slot.error, exporting: slot.exporting, exportMsg: slot.exportMsg,
      }, {
        flip: (id: string) => update($, pOpenAtom, (o: string[]) => (o?.includes(id) ? o.filter(x => x !== id) : [...(o ?? []), id])),
        setFilter: (name: string, v: string) =>
          name === 'status' ? update($, pStatusAtom, () => v)
            : name === 'week' ? update($, pWeekAtom, () => v)
              : name === 'category' ? update($, pCategoryAtom, () => v)
                : update($, pAppAtom, () => v),
        refresh: () => later('problemes'),
        exportEta: () => { $.clock.after(0, () => exportEta($)) },
        note,
      })
    } else if (tab === 'tests') {
      body = drawTestsReels(el, {
        cfg, view: data, now,
        openList: ((await read($, tOpenAtom)) as string[] | null) ?? (cfg.open ?? ['todo']),
        reveal: (await read($, tRevealAtom)) as string[], status: await read($, tStatusAtom),
        busy: slot.busy, error: slot.error,
      }, {
        toggle: (id: string) => update($, tOpenAtom, cur => {
          const list = (cur as string[] | null) ?? (cfg.open ?? ['todo'])
          return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
        }),
        reveal: (rk: string) => update($, tRevealAtom, l => ((l as string[]).includes(rk) ? (l as string[]).filter(x => x !== rk) : [...(l as string[]), rk])),
        reload: () => { S.slot.tests.data = undefined; $.ui.invalidate('ui.render') },
        recover: () => later('tests'),
      })
    } else if (tab === 'regles') {
      body = drawRegles(el, { cfg, model: data, want: await read($, rVersionAtom), busy: slot.busy, error: slot.error }, {
        setVersion: (v: string) => update($, rVersionAtom, () => v),
        rescan: () => later('regles', true),
      })
    } else {
      const mL = cfg.labels ?? {}
      body = drawMenage(el, { cfg, model: data, now, filter: await read($, mFilterAtom), copied: await read($, mCopiedAtom), busy: slot.busy, error: slot.error }, {
        setFilter: (id: string) => update($, mFilterAtom, () => id),
        rescan: () => later('menage', true),
        copy: async (press: any, lines: string[]) => {
          if (!lines.length) return
          const r = await $.ui.copy({ text: lines.join('\n'), surface: press.surface })
          await update($, mCopiedAtom, () => (r.isCopied ? fill(mL.copied, { n: lines.length }) : mL.copy_failed))
        },
      })
    }

    const go = async (t: string) => {
      await update($, tabAtom, () => t)
      const { stale } = await loadTab($, t)
      if (stale) later(t)
    }
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {tabs.map(t => (
            <Button key={`tab-${t}`} {...(t === tab ? {} : { plain: true as const })} onPress={() => go(t)}>{L.tabs?.[t] ?? t}</Button>
          ))}
        </Box>
        {body}
        <Box flexDirection="column">
          {L.tab_hint ? <Text dimColor>{L.tab_hint}</Text> : null}
          {(L.notes ?? []).map((x: string, i: number) => <Text key={`hub-n-${i}`} dimColor wrap="wrap">{`· ${x}`}</Text>)}
        </Box>
      </Box>
    )
  })
}
