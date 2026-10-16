// ci mod: which CI backends exist, whether they are usable, and which repo or conversation uses which.
//   /ci                         backends + status + the route for this conversation, opens the CI routing pane
//   /ci refresh                 the same after a fresh status check
//   /ci route <target> <id>     writes the routing file (target: a repo path, a session id, `here` or `session`)
//   /ci clear <target>
//   /ci diagramme [refresh] [claude|codex|inconnu|tout] [hote|app|conv]
//                               the « Diagramme » tab: repo → CI host → stages/jobs → result, last runs, who made them
// Everything runs through scanner/ci.py (standard library). The mod shows and informs: it never denies,
// blocks or rewrites a tool call. Its only writes are the routing file (/ci route, /ci clear, a Clear button)
// and its caches. The Diagramme reads gh/glab (GET only), git log and local transcripts; no polling.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GroupBy, Run, Snapshot, WhoFilter } from '../types'
import { GROUPS, MARK, WHO_FILTERS, ago, appsWithoutRuns, clock, colorOf, diagramText, etaText, gantt, groupLabel, groups, headline, historySegs, hostLabel, isRed, labelsOf, laneSegs, latestRuns, liveRuns, logCommand, overviewSvg, parseDiagram, parseDiagramWords, stats, statsText, summaryLines, whoLabel } from './diagram'
import type { Seg } from './diagram'
import { PANE, checkLine, mark, parseArgs, parseSnapshot, promptNote, resolveTarget, routeLine, rowColor, statusText, summary, usableText } from './view'

const snapshot = atom({ plugin: 'ci', key: 'snapshot' } as const, '')
const checking = atom({ plugin: 'ci', key: 'checking' } as const, false)
const error = atom({ plugin: 'ci', key: 'error' } as const, '')
const tab = atom({ plugin: 'ci', key: 'tab' } as const, 'routing' as 'routing' | 'diagram')
const diagram = atom({ plugin: 'ci', key: 'diagram' } as const, '')
const fetching = atom({ plugin: 'ci', key: 'fetching' } as const, false)
const who = atom({ plugin: 'ci', key: 'who' } as const, 'all' as WhoFilter)
const group = atom({ plugin: 'ci', key: 'group' } as const, 'host' as GroupBy)
const foldedA = atom({ plugin: 'ci', key: 'folded' } as const, [] as string[])
const MAX_LANES = 40
const GANTT_WIDTH = 24
/** Sections folded until the viewer opens them (the overview stays short at side-panel width). */
const FOLDED_AT_START = ['summary']

const root = ($: EngineInterface) => $.plugin.root.replace(/\\/g, '/')
const safe = async <T,>(work: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work
  } catch {
    return fallback
  }
}

/** Runs `python -I ci.py <args>` and parses its JSON; `{ error }` on any failure, never a throw. */
const ci = async ($: EngineInterface, args: string[], timeoutMs = 20000): Promise<{ ok: true; json: any; text: string } | { ok: false; error: string }> => {
  try {
    const r = await $.process.run(['python', '-I', `${root($)}/scanner/ci.py`, ...args], { timeoutMs })
    let json: any
    try {
      json = JSON.parse(r.stdout)
    } catch {
      json = undefined
    }
    if (r.exitCode !== 0 || !json) return { ok: false, error: json?.error ?? (r.stderr.trim().split('\n').pop() || `exit ${r.exitCode}`) }
    return { ok: true, json, text: r.stdout }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

const where = async ($: EngineInterface) => ({
  cwd: (await safe($.session.cwd(), '')).replace(/\\/g, '/'),
  id: await safe($.session.id(), ''),
})

/** `show` for this conversation; `check` runs the network status check when the cache is stale, `force` always. */
const refresh = async ($: EngineInterface, mode: 'cache' | 'check' | 'force' = 'cache'): Promise<Snapshot | undefined> => {
  const { cwd, id } = await where($)
  const args = ['show', '--cwd', cwd, ...(id ? ['--session', id] : [])]
  if (mode === 'check') args.push('--check')
  if (mode === 'force') args.push('--refresh')
  if (mode !== 'cache') await update($, checking, () => true)
  const r = await ci($, args, mode === 'cache' ? 20000 : 120000)
  if (mode !== 'cache') await update($, checking, () => false)
  if (!r.ok) {
    await update($, error, () => r.error)
    return undefined
  }
  await update($, error, () => '')
  await update($, snapshot, () => r.text)
  const s = r.json as Snapshot
  if (s.options?.status_line !== false) $.ui.status(s.current ? `CI: ${s.current.backend}` : undefined)
  return s
}

// One background check at a time per module copy; it runs on a timer so it outlives the command.
let busy = false
const checkSoon = ($: EngineInterface, force = false) => {
  if (busy) return
  busy = true
  $.clock.after(0, async () => {
    try {
      await refresh($, force ? 'force' : 'check')
    } finally {
      busy = false
    }
  })
}

/** `ci.py pipelines` from its cache; `check` fetches from gh/glab when the cache is stale, `force` always. */
const loadDiagram = async ($: EngineInterface, mode: 'cache' | 'check' | 'force' = 'cache') => {
  const args = ['pipelines', ...(mode === 'check' ? ['--check'] : mode === 'force' ? ['--refresh'] : [])]
  if (mode !== 'cache') await update($, fetching, () => true)
  const r = await ci($, args, mode === 'cache' ? 20000 : 300000)
  if (mode !== 'cache') await update($, fetching, () => false)
  if (!r.ok) {
    await update($, error, () => r.error)
    return undefined
  }
  await update($, error, () => '')
  await update($, diagram, () => r.text)
  return parseDiagram(r.text)
}

let fetchBusy = false
const fetchSoon = ($: EngineInterface, force = false) => {
  if (fetchBusy) return
  fetchBusy = true
  $.clock.after(0, async () => {
    try {
      await loadDiagram($, force ? 'force' : 'check')
    } finally {
      fetchBusy = false
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ci',
      description: 'CI routing: backends, their status, and which repo or conversation uses which (route / clear)',
      argumentHint: '[refresh] | diagramme [refresh] [claude|codex|inconnu|tout] [hote|app|conv] | close | route <repo|session|here> <backend-id> | clear <repo|session|here>',
    })
    const ran = await next(e)
    // the route for the status line and the prompt note; cache only, no network at start
    $.clock.after(0, () => void refresh($, 'cache'))
    return ran
  })

  on('command.run', { command: 'ci' }, async ($, e) => {
    if ((e.args ?? '').trim().toLowerCase() === 'close') {
      await $.ui.close({ id: PANE.id })
      return {}
    }
    const p = parseArgs(e.args ?? '')
    if (p.kind === 'usage') return { text: p.text }
    if (p.kind === 'diagram') {
      const w = parseDiagramWords(p.words)
      if (w.who) await update($, who, () => w.who!)
      if (w.group) await update($, group, () => w.group!)
      await update($, tab, () => 'diagram' as const)
      await $.ui.open({ id: PANE.id, title: PANE.title })
      const d = await loadDiagram($, 'cache')
      if (!d) return { text: `ci: ${await read($, error)}` }
      if (w.refresh || d.stale) fetchSoon($, w.refresh)
      return { text: diagramText(w.refresh ? { ...d, stale: true } : d, await read($, who), await read($, group), Date.now()) }
    }
    const { cwd, id } = await where($)
    if (p.kind === 'route' || p.kind === 'clear') {
      const target = resolveTarget(p.target, cwd, id)
      const args = p.kind === 'route'
        ? ['route', target, p.backend, '--by', id ? `session ${id}` : 'session', '--cwd', cwd]
        : ['clear', target, '--cwd', cwd]
      const r = await ci($, args)
      if (!r.ok) return { text: `ci: ${r.error}` }
      await refresh($, 'cache')
      return {
        text: p.kind === 'route'
          ? `ci: ${r.json.kind} ${r.json.key} → ${r.json.backend}${r.json.warning ? ` (${r.json.warning})` : ''}`
          : `ci: cleared ${r.json.removed} route(s) for ${r.json.key}`,
      }
    }
    await update($, tab, () => 'routing' as const)
    await $.ui.open({ id: PANE.id, title: PANE.title })
    const s = await refresh($, 'cache')
    if (!s) return { text: `ci: ${await read($, error)}` }
    if (p.refresh || s.stale) checkSoon($, p.refresh)
    return { text: summary(p.refresh ? { ...s, stale: true } : s) }
  })

  // The route as information for the model, only when the config sets prompt_note: true (default off: it would add
  // text to every request). Nothing is blocked or rewritten.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const s = parseSnapshot(await read($, snapshot))
    const note = s && s.options?.prompt_note === true ? promptNote(s) : undefined
    if (!note) return result
    return { ...result, sections: [...result.sections, { id: 'ci:route', text: note, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE.id }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const current = await read($, tab)
    const dRaw = parseDiagram(await read($, diagram))
    const DL = labelsOf(dRaw)
    const tabs = (
      <Box flexDirection="row" gap={1}>
        {(['routing', 'diagram'] as const).map(t => (
          <Button
            key={`tab-${t}`}
            plain
            bold={current === t}
            dimColor={current !== t}
            onPress={async () => {
              await update($, tab, () => t)
              if (t === 'diagram') {
                const d = await loadDiagram($, 'cache')
                if (!d || d.stale) fetchSoon($)
              } else await refresh($, 'cache')
            }}
          >
            {`${current === t ? '▸ ' : ''}${t === 'routing' ? DL.tab_routing : DL.tab_diagram}`}
          </Button>
        ))}
      </Box>
    )
    const problem = await read($, error)

    if (current === 'diagram') {
      const now = Date.now()
      const isFetching = await read($, fetching)
      const w = await read($, who)
      const g = await read($, group)
      const head = (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>
            {isFetching ? 'lecture gh/glab…' : `lu ${dRaw?.generated ?? 'jamais'}`}
            {problem ? ` · ci.py: ${problem}` : ''}
          </Text>
          <Button key="diag-refresh" hotkey="r" plain dimColor onPress={() => fetchSoon($, true)}>
            Rafraîchir
          </Button>
        </Box>
      )
      if (!dRaw || !dRaw.generated) {
        return (
          <Box flexDirection="column">
            {tabs}
            {head}
            <Text>Pas encore de données : Rafraîchir, ou /ci diagramme refresh (lit gh et glab, ~1-3 min).</Text>
          </Box>
        )
      }
      const d = dRaw
      const Svg = e.surface === 'terminal' ? undefined : (els as any).Svg
      const folded = new Set(await read($, foldedA))
      const toggle = (k: string) => async () => {
        await update($, foldedA, (cur: string[]) => (cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]))
      }
      const seg = (s: Seg, i: number) => (
        <Text key={i} color={s.status ? colorOf(d, s.status) : undefined} dimColor={s.dim} bold={s.bold}>{s.text}</Text>
      )
      // A section: a header button (▾ open / ▸ folded with its one-line summary), then its body when open.
      // Sections start open except the ones listed in FOLDED_AT_START (folded keys are toggled from that default).
      const isOpen = (k: string) => (FOLDED_AT_START.includes(k) ? folded.has(k) : !folded.has(k))
      const section = (k: string, title: string, oneLine: string, body: () => any) => (
        <Box key={`sec-${k}`} flexDirection="column">
          <Button key={`fold-${k}`} plain onPress={toggle(k)}>
            {`${isOpen(k) ? '▾ ' : '▸ '}${title}${isOpen(k) ? '' : ` · ${oneLine}`}`}
          </Button>
          {isOpen(k) ? body() : null}
        </Box>
      )
      const ganttBlock = (r: Run, key: string) => {
        const gt = gantt(r, now, GANTT_WIDTH)
        const stagesSeen: string[] = []
        return (
          <Box key={`gantt-${key}`} flexDirection="column">
            <Text dimColor>
              {'   '}{clock(new Date(gt.start).toISOString())} → {clock(new Date(gt.end).toISOString())} · ░ file · █ exécution · ┄ estimé · │ maintenant
            </Text>
            {gt.rows.map((row, i) => {
              const head = !stagesSeen.includes(row.stage)
              if (head) stagesSeen.push(row.stage)
              return (
                <Box key={`gr-${key}-${i}`} flexDirection="column">
                  {head ? <Text dimColor>{'   '}{row.stage}</Text> : null}
                  <Text wrap="truncate">
                    <Text color={row.red ? colorOf(d, 'failed') : undefined}>{'   '}{row.name.slice(0, 16).padEnd(16)} </Text>
                    {row.cells.map(seg)}
                    <Text dimColor> {row.text}</Text>
                  </Text>
                </Box>
              )
            })}
            {gt.rows.length === 0 ? <Text dimColor>{'   '}jobs non lus pour ce run</Text> : null}
          </Box>
        )
      }
      const latest = latestRuns(d, w)
      const live = liveRuns(d, w)
      const reds = latest.filter(isRed).sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
      const gs = groups(d, w, g)
      let shown = 0
      const empty = appsWithoutRuns(d)
      const sum = summaryLines(d, w, now)
      return (
        <Box flexDirection="column">
          {tabs}
          {head}
          <Text bold wrap="wrap">{headline(d, w)}</Text>
          <Box flexDirection="row" gap={1}>
            {WHO_FILTERS.map(f => (
              <Button key={`who-${f}`} plain bold={w === f} dimColor={w !== f} onPress={async () => { await update($, who, () => f) }}>
                {`${w === f ? '▸ ' : ''}${whoLabel(DL, f)}`}
              </Button>
            ))}
          </Box>
          {section('summary', 'Résumé', sum[1] ?? '', () => (
            <Box flexDirection="column">
              {sum.map((l, i) => <Text key={`sum-${i}`} wrap="wrap">{'  '}{l}</Text>)}
              {Svg ? <Svg key="ci-overview" source={overviewSvg(d, w)} alt={`auteurs → hôtes CI → résultats (${whoLabel(DL, w)})`} /> : null}
            </Box>
          ))}
          {section('live', `En cours (${live.length})`, live.length ? live.map(r => r.app).slice(0, 3).join(', ') : 'rien', () => (
            <Box flexDirection="column">
              {live.length === 0 ? <Text dimColor>{'  '}aucun pipeline en cours</Text> : null}
              {live.map(r => (
                <Box key={`live-${r.app}-${r.id}`} flexDirection="column">
                  <Text wrap="wrap">
                    <Text bold>{'  '}{r.app}</Text>
                    <Text dimColor> · {hostLabel(d, r.backend)} · {r.mr != null ? `MR !${r.mr}` : r.branch} · </Text>
                    <Text color={colorOf(d, 'running')}>{etaText(r)}</Text>
                  </Text>
                  {ganttBlock(r, `live-${r.app}-${r.id}`)}
                </Box>
              ))}
            </Box>
          ))}
          {section('reds', `Rouges (${reds.length})`, reds.length ? reds.map(r => r.app).slice(0, 3).join(', ') : 'aucun', () => (
            <Box flexDirection="column">
              {reds.length === 0 ? <Text dimColor>{'  '}aucun rouge sur le dernier run de chaque ligne</Text> : null}
              {reds.map(r => {
                const bad = (r.jobs ?? []).filter(isRed)
                return (
                  <Box key={`red-${r.app}-${r.id}`} flexDirection="column">
                    <Text wrap="wrap">
                      <Text color={colorOf(d, 'failed')} bold>{'  '}{MARK.failed} {r.app}</Text>
                      <Text dimColor> · {hostLabel(d, r.backend)} · {r.mr != null ? `MR !${r.mr}` : r.branch} · {ago(r.created, now)}</Text>
                    </Text>
                    {bad.length === 0 ? <Text dimColor wrap="wrap">{'    '}log : {logCommand(r)} · {r.url}</Text> : null}
                    {bad.map(j => (
                      <Text key={`rj-${r.id}-${j.name}`} dimColor wrap="wrap">
                        {'    '}job {j.name} ({j.stage}) · log : {logCommand(r, j)}{j.url ? ` · ${j.url}` : ''}
                      </Text>
                    ))}
                  </Box>
                )
              })}
            </Box>
          ))}
          {section('lanes', `Pipelines ${groupLabel(DL, g)}`, `${gs.length} groupe(s)`, () => (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                {GROUPS.map(x => (
                  <Button key={`group-${x}`} plain bold={g === x} dimColor={g !== x} onPress={async () => { await update($, group, () => x) }}>
                    {`${g === x ? '▸ ' : ''}${groupLabel(DL, x)}`}
                  </Button>
                ))}
              </Box>
              {gs.length === 0 ? <Text dimColor>{DL.no_runs}</Text> : null}
              {gs.map(gr => (
                <Box key={`g-${gr.key}`} flexDirection="column">
                  {section(`g:${g}:${gr.key}`, gr.title, statsText(DL, stats(gr.runs)), () => (
                    <Box flexDirection="column">
                      <Text dimColor>{'  '}{statsText(DL, stats(gr.runs))}</Text>
                      {gr.lanes.map(l => {
                        if (shown >= MAX_LANES) return null
                        shown += 1
                        const gk = `gantt:${l.key}`
                        return (
                          <Box key={`l-${gr.key}-${l.key}`} flexDirection="column">
                            <Text wrap="wrap">{'  '}{laneSegs(DL, l, now).map(seg)}</Text>
                            <Box flexDirection="row" gap={1}>
                              <Text wrap="wrap">{historySegs(DL, l).map(seg)}</Text>
                              <Button key={`btn-${gk}-${gr.key}`} plain dimColor onPress={toggle(gk)}>
                                {folded.has(gk) ? 'Gantt ▾' : 'Gantt ▸'}
                              </Button>
                            </Box>
                            {folded.has(gk) ? ganttBlock(l.runs[0]!, `${gr.key}-${l.key}`) : null}
                          </Box>
                        )
                      })}
                    </Box>
                  ))}
                </Box>
              ))}
              {shown >= MAX_LANES ? <Text dimColor>… {MAX_LANES} lignes affichées au plus ; filtre ou groupe pour voir le reste.</Text> : null}
            </Box>
          ))}
          <Text> </Text>
          <Text dimColor wrap="wrap">
            * hôte déduit des jobs des runs récents du même projet · {empty.filter(a => a.fetched).length} app(s) sans run lu
            {empty.some(a => !a.fetched) ? ` · ${empty.filter(a => !a.fetched).length} ${DL.not_fetched}` : ''}
            {' '}· Claude = trailer « Co-Authored-By: Claude », branche claude/* ou worktree-agent-*, ou PR ouverte par une conversation ; Codex = branche codex/*, trailer ou auteur Codex ; le reste « {DL.unknown} ». Estimations : médiane des 3 derniers runs réussis au moins du même job.
          </Text>
        </Box>
      )
    }

    const s = parseSnapshot(await read($, snapshot))
    const isChecking = await read($, checking)
    const head = (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>
          {isChecking ? 'checking…' : `checked ${s?.generated ?? 'never'}`}
          {problem ? ` · ci.py failed: ${problem}` : ''}
        </Text>
        <Button key="refresh" hotkey="r" plain dimColor onPress={() => checkSoon($, true)}>
          Refresh
        </Button>
      </Box>
    )
    if (!s) {
      return (
        <Box flexDirection="column">
          {tabs}
          {head}
          <Text>No data yet: run /ci or press Refresh.</Text>
        </Box>
      )
    }
    const L = s.labels
    const cur = s.current
    return (
      <Box flexDirection="column">
        {tabs}
        {head}
        <Text bold>
          {L.here ?? 'This conversation'}: {cur ? `${cur.backend} (${cur.match} route)` : (L.no_route ?? 'no route')}
        </Text>
        <Text> </Text>
        <Text bold>{L.backends ?? 'Backends'}</Text>
        {s.backends.map(b => (
          <Box flexDirection="column">
            <Text>
              <Text color={rowColor(L, b)}>{mark(b)} </Text>
              <Text bold>{b.label}</Text>
              <Text dimColor>
                {' '}· {b.id} · {b.kind} · {b.host}
                {b.runner_tag ? ` · tag ${b.runner_tag}` : ''} · {statusText(L, b.status)}
              </Text>
              {b.status === 'active' ? <Text color={rowColor(L, b)}> · {usableText(L, b.check?.usable)}</Text> : null}
            </Text>
            <Text dimColor wrap="wrap">{'   '}{checkLine(b)}</Text>
            {b.notes ? <Text dimColor wrap="wrap">{'   '}{b.notes}</Text> : null}
          </Box>
        ))}
        <Text> </Text>
        <Text bold>
          {L.routes ?? 'Routes'} ({s.routes.length}) · {s.routing_file}
        </Text>
        {s.routes.length === 0 ? <Text dimColor>none: /ci route here {'<backend-id>'}</Text> : null}
        {s.routes.map(r => (
          <Box flexDirection="row" gap={1}>
            <Text wrap="wrap" bold={cur?.key === r.key}>
              {cur?.key === r.key ? '▸ ' : '  '}
              {routeLine(s, r)}
            </Text>
            <Button
              key={`clear-${r.key}`}
              plain
              dimColor
              onPress={async () => {
                await ci($, ['clear', r.key])
                await refresh($, 'cache')
              }}
            >
              Clear
            </Button>
          </Box>
        ))}
        <Text dimColor>Set a route: /ci route {'<repo-path|session-id|here|session> <backend-id>'} · config {s.config}</Text>
      </Box>
    )
  })
}
