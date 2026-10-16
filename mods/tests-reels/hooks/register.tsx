// tests-reels mod (« Tests réels »): read-only registry of real (non-CI) tests per application. /tests [refresh|close]
// opens the pane. Data: ~/.claude/tests-reels (registry.json written by cli.mjs, runs.jsonl appended by agents after a
// real test, recovered.json written by scanner/recover.mjs). The pane only reads them; the « Lancer la récupération »
// button runs the scanner, which writes only into that folder. No secret value is ever stored or shown: accounts show
// a masked login and where the secret lives. The command returns no text, so nothing reaches the model; nothing here
// blocks, rewrites or delays a tool call or a prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { appSummary, buildView, deepMerge, fill, fmtAge, mask, parseRuns, resultOf, shortId, todoLine } from '../lib/registry.mjs'

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
    const { Box, Text, Button } = $.ui.resolve(e)
    const { cfg, view, now } = await load($)
    const L = cfg.labels ?? {}
    const C = cfg.colors ?? {}
    const max = cfg.max_rows ?? 12
    const openList = ((await read($, openAtom)) as string[] | null) ?? (cfg.open ?? ['todo'])
    const reveal = (await read($, revealAtom)) as string[]
    const status = (await read($, statusAtom)) as string
    const isOpen = (id: string) => openList.includes(id)
    const toggle = (id: string) => update($, openAtom, cur => {
      const list = (cur as string[] | null) ?? (cfg.open ?? ['todo'])
      return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
    })
    const k = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')
    const col = (r: string) => (C[r] ? { color: C[r] } : {})
    const resLabel = (r: string) => L[`result_${r}`] ?? r
    const more = (n: number) => (n > max ? <Text dimColor>{fill(L.more, { n: n - max })}</Text> : null)
    const t = view.totals
    const head = (
      <Box flexDirection="column">
        <Text dimColor>{fill(L.subtitle, { apps: t.apps, reg: view.registryAt ? fmtAge(view.registryAt, now) : L.never_scanned, rec: view.recoveredAt ? fmtAge(view.recoveredAt, now) : L.never_scanned })}</Text>
        <Text>{fill(L.totals, t)}</Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="refresh" plain onPress={() => reload($)}>{L.refresh ?? '↻'}</Button>
          <Button key="recover" plain onPress={() => { $.clock.after(0, () => recover($)) }}>{L.recover}</Button>
        </Box>
        {S.busy ? <Text dimColor>{L.recovering}</Text> : null}
        {S.error ? <Text color="error">{`récupération : ${S.error}`}</Text> : null}
        {cfg._local_error ? <Text color="error">{cfg._local_error}</Text> : null}
        {status ? <Text dimColor>{status}</Text> : null}
      </Box>
    )
    if (!view.apps.length && !view.todo.length) {
      return (
        <Box flexDirection="column" gap={1}>
          {head}
          <Text>{L.empty}</Text>
        </Box>
      )
    }

    const fold = (id: string, title: string, summary: string, body: () => any, warn = false) => (
      <Box key={`b-${k(id)}`} flexDirection="column">
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key={`t-${k(id)}`} plain onPress={() => toggle(id)}>{`${isOpen(id) ? '▾' : '▸'} ${title}`}</Button>
          <Text {...(warn ? col('warn') : { dimColor: true })} wrap="truncate">{summary}</Text>
        </Box>
        {isOpen(id) ? <Box flexDirection="column" paddingLeft={2}>{body()}</Box> : null}
      </Box>
    )
    const part = (title: string, rows: any[], line: (x: any, i: number) => any) => (
      <Box flexDirection="column">
        <Text bold>{`${title} (${rows.length})`}</Text>
        {!rows.length ? <Text dimColor>{`  ${L.none}`}</Text> : null}
        {rows.slice(0, max).map(line)}
        {more(rows.length)}
      </Box>
    )

    const todoBlock = fold(
      'todo',
      L.todo_title,
      view.todo.length ? fill(L.todo_summary, { n: view.todo.length, secrets: t.secrets_seen }) : L.todo_none,
      () => (
        <Box flexDirection="column">
          {view.todo.slice(0, max).map((x: any, i: number) => <Text key={`td-${i}`} {...col('todo')}>{`● ${todoLine(x, L)}`}</Text>)}
          {more(view.todo.length)}
          {view.todo.length ? <Text dimColor wrap="wrap">{cfg.store_instruction}</Text> : null}
        </Box>
      ),
      view.todo.length > 0,
    )

    const appBlock = (a: any) => {
      const id = `app:${a.name}`
      return fold(id, a.name, appSummary(a, L), () => {
        const rec = a.recovered
        return (
          <Box flexDirection="column" gap={1}>
            {a.notes ? <Text dimColor>{a.notes}</Text> : null}
            {a.neverReal ? <Text {...col('warn')}>{`⚠ ${L.never_real}`}</Text> : null}
            {part(L.envs, a.environments, (e: any, i: number) => (
              <Box key={`e-${i}`} flexDirection="column" paddingLeft={1}>
                <Text>{`● ${e.name}${e.kind ? ` · ${L[`kind_${e.kind}`] ?? e.kind}` : ''}${e.status ? ` · ${e.status}` : ''}${e.owner ? ` · ${e.owner}` : ''}${e.created ? ` · ${e.created}` : ''}`}</Text>
                {(e.urls ?? []).map((u: string, j: number) => <Text key={`eu-${i}-${j}`} dimColor>{`  ${u}`}</Text>)}
                {Object.keys(e.ids ?? {}).length ? <Text dimColor>{`  ${Object.entries(e.ids).map(([kk, v]) => `${kk} ${shortId(v)}`).join(' · ')}`}</Text> : null}
              </Box>
            ))}
            {part(L.accounts, a.accounts, (ac: any, i: number) => {
              const rk = `${a.name}|${ac.login || ac.display}`
              const shown = reveal.includes(rk)
              return (
                <Box key={`a-${i}`} flexDirection="column" paddingLeft={1}>
                  <Box flexDirection="row" gap={1}>
                    <Text>{`● ${shown ? ac.login || ac.display : mask(ac.login || ac.display)}${ac.env ? ` · ${ac.env}` : ''}${ac.purpose ? ` · ${ac.purpose}` : ''}`}</Text>
                    <Button key={`rv-${k(rk)}`} plain onPress={() => update($, revealAtom, l => ((l as string[]).includes(rk) ? (l as string[]).filter(x => x !== rk) : [...(l as string[]), rk]))}>{shown ? L.hide : L.show}</Button>
                  </Box>
                  {ac.secret_ref?.target
                    ? <Text dimColor>{`  ${fill(L.secret_at, { store: cfg.secret_stores?.[ac.secret_ref.store] ?? ac.secret_ref.store, target: ac.secret_ref.target })}`}</Text>
                    : <Text {...col('todo')}>{`  ${L.secret_none}`}</Text>}
                </Box>
              )
            })}
            {part(L.procedures, a.procedures, (p: any, i: number) => (
              <Box key={`p-${i}`} flexDirection="column" paddingLeft={1}>
                <Text {...col(p.status)}>{`● ${p.name}${p.env ? ` · ${p.env}` : ''}${p.kind ? ` · ${p.kind}` : ''} · ${resLabel(p.status)}${p.last?.date ? ` ${String(p.last.date).slice(0, 10)}` : ''}${p.undeclared ? ` · ${L.undeclared}` : ''}`}</Text>
                {p.steps?.length ? <Text dimColor wrap="wrap">{`  ${fill(L.steps, { n: p.steps.length })} : ${p.steps.join(' → ')}`}</Text> : null}
                {(p.commands ?? []).map((c: string, j: number) => <Text key={`pc-${i}-${j}`} dimColor wrap="wrap">{`  $ ${c}`}</Text>)}
                {p.expected ? <Text dimColor wrap="wrap">{`  ${fill(L.expected, { text: p.expected })}`}</Text> : null}
                {p.evidence?.length ? <Text dimColor wrap="wrap">{`  ${fill(L.evidence, { list: p.evidence.join(', ') })}`}</Text> : null}
              </Box>
            ))}
            {part(L.runs, a.runs, (r: any, i: number) => (
              <Box key={`r-${i}`} flexDirection="column" paddingLeft={1}>
                <Text {...col(resultOf(r))}>{`● ${String(r.date).slice(0, 16).replace('T', ' ')} · ${r.procedure}${r.env ? ` · ${r.env}` : ''} · ${resLabel(resultOf(r))}${r.by ? ` · ${r.by}` : ''}`}</Text>
                {r.note ? <Text dimColor wrap="wrap">{`  ${r.note}`}</Text> : null}
                {r.evidence?.length ? <Text dimColor wrap="wrap">{`  ${fill(L.evidence, { list: r.evidence.join(', ') })}`}</Text> : null}
              </Box>
            ))}
            {part(L.checks, a.checks, (c: any, i: number) => (
              <Box key={`c-${i}`} flexDirection="column" paddingLeft={1}>
                <Text>{`● ${c.date ?? ''} · ${c.what}${c.status ? ` · ${c.status}` : ''}`}</Text>
                {c.how ? <Text dimColor wrap="wrap">{`  ${c.how}`}</Text> : null}
              </Box>
            ))}
            {rec
              ? fold(`${id}:rec`, L.recovered, fill(L.sum_recovered, { s: (rec.sessions ?? []).length, c: (rec.commands ?? []).length }), () => (
                  <Box flexDirection="column" gap={1}>
                    {part(L.rec_sessions, rec.sessions ?? [], (s: any, i: number) => <Text key={`rs-${i}`} dimColor>{`● ${String(s.date).slice(0, 10)} · ${s.title} · ${(s.cats ?? []).join(', ')} · ${s.hits}`}</Text>)}
                    {part(L.rec_commands, a.recCommands ?? [], (c: any, i: number) => <Text key={`rc-${i}`} {...(c.errors ? col('fail') : { dimColor: true })} wrap="wrap">{`● ${String(c.date).slice(0, 10)} · ${c.count}×${c.errors ? ` · ${fill(L.errors, { n: c.errors })}` : ''} · ${c.cmd}`}</Text>)}
                    {part(L.rec_ids, rec.ids ?? [], (x: any, i: number) => <Text key={`ri-${i}`} dimColor>{`● ${x.kind} ${shortId(x.value)} · ${x.count}×`}</Text>)}
                    {part(L.rec_urls, rec.urls ?? [], (x: any, i: number) => <Text key={`ru-${i}`} dimColor wrap="wrap">{`● ${x.url} · ${x.count}×`}</Text>)}
                    {part(L.rec_accounts, rec.accounts ?? [], (x: any, i: number) => <Text key={`ra-${i}`} dimColor>{`● ${mask(x.login)} · ${x.count}×`}</Text>)}
                    {part(L.rec_workspaces, rec.workspaces ?? [], (x: any, i: number) => <Text key={`rw-${i}`} dimColor>{`● ${x.name} · ${x.count}×`}</Text>)}
                    {part(L.rec_mentions, rec.mentions ?? [], (x: any, i: number) => <Text key={`rm-${i}`} dimColor wrap="wrap">{`● ${String(x.date).slice(0, 10)} · ${x.title ?? ''} : ${x.text}`}</Text>)}
                  </Box>
                ))
              : null}
          </Box>
        )
      }, a.neverReal)
    }

    return (
      <Box flexDirection="column" gap={1}>
        {head}
        {todoBlock}
        <Box flexDirection="column">
          <Text bold>{`${L.apps_title} (${view.apps.length})`}</Text>
          {view.apps.slice(0, cfg.max_apps ?? 60).map(appBlock)}
          {view.apps.length > (cfg.max_apps ?? 60) ? <Text dimColor>{fill(L.more, { n: view.apps.length - (cfg.max_apps ?? 60) })}</Text> : null}
        </Box>
        <Box flexDirection="column">
          {(L.notes ?? []).map((x: string, i: number) => <Text key={`n-${i}`} dimColor wrap="wrap">{`· ${x}`}</Text>)}
        </Box>
      </Box>
    )
  })
}
