// menage mod ("Ménage"): read-only inventory of what Claude work left lying on this PC, with the exact safe command
// for each row. /menage [refresh|close] opens the pane. Figures come from scanner/menage_scan.mjs (Node, read-only git
// commands, folder sizes, Desktop session files), run in the background. The mod never runs a command it shows and
// never deletes anything; the command shows a pane and returns no text, so nothing reaches the model; nothing here
// blocks, rewrites or delays a tool call or a prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { commandsOf, deepMerge, fill, filterRows, fmtAge, fmtBytes } from '../lib/classify.mjs'

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
    const { Box, Text, Button } = $.ui.resolve(e)
    const { cfg, model, now } = await load($)
    const L = cfg.labels ?? {}
    const C = cfg.colors ?? {}
    const status = S.busy ? 'inventaire en cours…' : ''
    if (!model) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{L.first_scan}</Text>
          {S.error ? <Text color="error">{`scan : ${S.error}`}</Text> : null}
          {status ? <Text dimColor>{status}</Text> : null}
        </Box>
      )
    }
    const filter = (await read($, filterAtom)) as string
    const copied = (await read($, copiedAtom)) as string
    const t = model.totals ?? {}
    const max = cfg.max_rows ?? 40
    const color = (level: string) => (level === 'safe' ? C.safe : level === 'check' ? C.check : level === 'danger' ? C.danger : undefined)
    const copy = async (press: any, lines: string[]) => {
      if (!lines.length) return
      const r = await $.ui.copy({ text: lines.join('\n'), surface: press.surface })
      await update($, copiedAtom, () => (r.isCopied ? fill(L.copied, { n: lines.length }) : L.copy_failed))
    }
    const filters: [string, string][] = [['all', L.filter_all], ['safe', L.filter_safe], ['danger', L.filter_danger]]
    const tag = (r: any) => (r.level === 'danger' ? `${L.danger_tag} · ` : r.level === 'check' ? `${L.check_tag} · ` : '')

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text dimColor>{fill(L.subtitle, { repos: model.repos ?? 0, age: fmtAge(model.generated, now) }) + (status ? ` · ${status}` : '')}</Text>
          {S.error ? <Text color="error">{`scan : ${S.error}`}</Text> : null}
          {(model.errors ?? []).slice(0, 5).map((x: string) => <Text color="warning">{x}</Text>)}
        </Box>

        <Box flexDirection="column">
          <Text bold color={C.safe}>{fill(L.total_sure, { bytes: fmtBytes(t.sure ?? 0) })}</Text>
          <Text color={C.check}>{fill(L.total_check, { bytes: fmtBytes(t.check ?? 0) })}</Text>
          {t.danger ? <Text color={C.danger}>{fill(L.total_danger, { n: t.danger })}</Text> : null}
        </Box>

        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {filters.map(([id, label]) => (
            <Button key={`f-${id}`} {...(id !== filter ? { plain: true as const } : {})} onPress={() => update($, filterAtom, () => id)}>
              {label}
            </Button>
          ))}
          <Button key="refresh" plain onPress={() => { $.clock.after(0, () => rescan($, true)) }}>{L.refresh ?? '↻'}</Button>
          <Button key="copy-all" plain onPress={press => copy(press, commandsOf(model.sections ?? []))}>{L.copy_all}</Button>
        </Box>
        {copied ? <Text dimColor>{copied}</Text> : null}

        {(model.sections ?? []).map((s: any) => {
          const rows = filterRows(s.rows ?? [], filter)
          if (!rows.length && filter !== 'all') return null
          const sure = (s.rows ?? []).filter((r: any) => r.level === 'safe').reduce((a: number, r: any) => a + (r.reclaim || 0), 0)
          const safeCmds = commandsOf([s])
          return (
            <Box key={`s-${s.id}`} flexDirection="column">
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                <Text bold>{`${s.title} (${(s.rows ?? []).length})${sure ? ` · ${fmtBytes(sure)}` : ''}`}</Text>
                {safeCmds.length ? <Button key={`copy-${s.id}`} plain onPress={press => copy(press, safeCmds)}>{`${L.copy} (${safeCmds.length})`}</Button> : null}
              </Box>
              {s.summary ? <Text dimColor>{s.summary}</Text> : null}
              {!rows.length ? <Text dimColor>{L.empty}</Text> : null}
              {rows.slice(0, max).map((r: any, i: number) => (
                <Box key={`r-${s.id}-${i}`} flexDirection="column" paddingLeft={1}>
                  <Text {...(color(r.level) ? { color: color(r.level) } : {})} {...(r.level === 'danger' ? { bold: true } : {})}>{`● ${r.title}${r.meta ? ` · ${r.meta}` : ''}`}</Text>
                  {r.reasons?.length || r.level === 'danger' || r.level === 'check' ? (
                    <Text {...(r.level === 'danger' ? { color: C.danger } : { dimColor: true })}>{`  ${tag(r)}${(r.reasons ?? []).join(' · ')}`}</Text>
                  ) : null}
                  {r.command ? (
                    <Box flexDirection="row" gap={1}>
                      <Button key={`c-${s.id}-${i}`} plain onPress={press => copy(press, [r.command])}>{L.copy}</Button>
                      <Text dimColor wrap="wrap">{r.command}</Text>
                    </Box>
                  ) : null}
                </Box>
              ))}
              {rows.length > max ? <Text dimColor>{fill(L.more, { n: rows.length - max })}</Text> : null}
            </Box>
          )
        })}

        <Box flexDirection="column">
          {(L.notes ?? []).map((x: string) => <Text dimColor>{`· ${fill(x, { base: 'origin/main' })}`}</Text>)}
        </Box>
      </Box>
    )
  })
}
