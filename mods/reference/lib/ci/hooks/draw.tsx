// ci mod: the pane's drawing (Routage and Diagramme), pure. No `$`: the elements come in as `ui` ($.ui.resolve(e)),
// the data and every press through `m`, so the ci pane and the Référence hub (mods/reference, a synced copy of this
// file) draw the same tree. Same output as the drawing that lived in register.tsx before, except the Gantt, now drawn
// by lib/core/gantt.mjs with factory's symbols and legend.
import type { Diagram, GroupBy, Run, Snapshot, WhoFilter } from '../types'
import { GROUPS, MARK, WHO_FILTERS, ago, appsWithoutRuns, clock, colorOf, etaText, gantt, groupLabel, groups, headline, historySegs, hostLabel, isRed, labelsOf, laneSegs, latestRuns, liveRuns, logCommand, overviewSvg, stats, statsText, summaryLines, whoLabel } from './diagram'
import type { Seg } from './diagram'
import { checkLine, mark, routeLine, rowColor, statusText, usableText } from './view'

export const MAX_LANES = 40
export const GANTT_WIDTH = 24
/** Sections folded until the viewer opens them (the overview stays short at side-panel width). */
export const FOLDED_AT_START = ['summary']

export type CiTab = 'routing' | 'diagram'
export type CiModel = {
  surface: string
  tab: CiTab
  snapshot: Snapshot | undefined
  diagram: Diagram | undefined
  error: string
  checking: boolean
  fetching: boolean
  who: WhoFilter
  group: GroupBy
  folded: string[]
  now: number
  onTab: (t: CiTab) => void | Promise<void>
  onCheck: (force: boolean) => void
  onFetch: (force: boolean) => void
  onWho: (w: WhoFilter) => void | Promise<void>
  onGroup: (g: GroupBy) => void | Promise<void>
  onToggle: (key: string) => void | Promise<void>
  onClear: (key: string) => void | Promise<void>
}

export function drawCi(ui: any, m: CiModel): any {
  const { Box, Text, Button } = ui
  const current = m.tab
  const dRaw = m.diagram
  const DL = labelsOf(dRaw)
  const tabs = (
    <Box flexDirection="row" gap={1}>
      {(['routing', 'diagram'] as const).map(t => (
        <Button key={`tab-${t}`} plain bold={current === t} dimColor={current !== t} onPress={() => m.onTab(t)}>
          {`${current === t ? '▸ ' : ''}${t === 'routing' ? DL.tab_routing : DL.tab_diagram}`}
        </Button>
      ))}
    </Box>
  )
  const problem = m.error

  if (current === 'diagram') {
    const now = m.now
    const w = m.who
    const g = m.group
    const head = (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>
          {m.fetching ? 'lecture gh/glab…' : `lu ${dRaw?.generated ?? 'jamais'}`}
          {problem ? ` · ci.py: ${problem}` : ''}
        </Text>
        <Button key="diag-refresh" hotkey="r" plain dimColor onPress={() => m.onFetch(true)}>
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
    const Svg = m.surface === 'terminal' ? undefined : ui.Svg
    const folded = new Set(m.folded)
    const toggle = (k: string) => () => m.onToggle(k)
    const seg = (s: Seg, i: number) => (
      <Text key={i} color={s.color ?? (s.status ? colorOf(d, s.status) : undefined)} dimColor={s.dim} bold={s.bold}>{s.text}</Text>
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
            {'   '}{clock(new Date(gt.start).toISOString())} → {clock(new Date(gt.end).toISOString())} · {gt.legend}
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
            <Button key={`who-${f}`} plain bold={w === f} dimColor={w !== f} onPress={() => m.onWho(f)}>
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
                  <Text color={colorOf(d, 'running')}>{etaText(r, now)}</Text>
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
                <Button key={`group-${x}`} plain bold={g === x} dimColor={g !== x} onPress={() => m.onGroup(x)}>
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

  const s = m.snapshot
  const head = (
    <Box flexDirection="row" gap={1}>
      <Text dimColor>
        {m.checking ? 'checking…' : `checked ${s?.generated ?? 'never'}`}
        {problem ? ` · ci.py failed: ${problem}` : ''}
      </Text>
      <Button key="refresh" hotkey="r" plain dimColor onPress={() => m.onCheck(true)}>
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
          <Button key={`clear-${r.key}`} plain dimColor onPress={() => m.onClear(r.key)}>
            Clear
          </Button>
        </Box>
      ))}
      <Text dimColor>Set a route: /ci route {'<repo-path|session-id|here|session> <backend-id>'} · config {s.config}</Text>
    </Box>
  )
}
