// control mod: the CONFIG pane's drawing (/config-claude), pure. No `$`: the elements come in as `ui`
// ($.ui.resolve(e)), the index, the item texts already read and every press through `m`, so the CONFIG pane and the
// Référence hub (mods/reference, a synced copy of this file) draw the same tree. Same output as the drawing that lived
// in register.tsx before. The texts come from the scanner (scanner/config_scan.py), secrets already masked there.
import type { ConfigData, ConfigItem } from '../types'
import { languageOf, pageOf, searchConfig, sizeText } from './config_view'
import { ageText, labelOf } from './view'

export type ConfigModel = {
  data: ConfigData | undefined
  /** where the index is expected (shown when it is missing) */
  out: string
  labels?: Record<string, unknown>
  viewerChars?: number
  /** item id -> full text, for the open item (and every item while a search runs) */
  contents: Record<string, string>
  open: string[]
  current: string
  query: string
  raw: boolean
  page: number
  busy: boolean
  problem: string
  now: number
  onRescan: () => void
  onFlip: (id: string) => void
  onPick: (id: string) => void
  onRaw: () => void
  onPage: (delta: number) => void
  onQuery: (v: string) => void
}

/** The shard numbers the drawing needs: the open item's, or all of them while a search runs. */
export const shardsNeeded = (data: ConfigData | undefined, current: string, query: string): number[] => {
  if (!data) return []
  if (query.trim().length >= 2) return data.shards.map((_, i) => i)
  for (const c of data.categories) for (const s of c.subs) for (const it of s.items) if (it.id === current && it.shard != null) return [it.shard]
  return []
}

export function drawConfig(ui: any, m: ConfigModel): any {
  const { Box, Text, Button, Input, Markdown, Code } = ui
  const C = labelOf(m.labels)
  const data = m.data
  const header = (
    <Box flexDirection="row" gap={1}>
      <Text dimColor>
        {m.busy ? 'scan en cours…' : `scan ${ageText(data?.generated, m.now)}`}
        {m.problem ? ` · dernier scan en échec : ${m.problem}` : ''}
      </Text>
      <Button key="rescan" hotkey="r" plain dimColor onPress={() => m.onRescan()}>
        Rescan
      </Button>
    </Box>
  )
  if (!data) {
    return (
      <Box flexDirection="column">
        {header}
        <Text wrap="wrap">Pas encore de données dans {m.out}/config-claude.json : appuie sur Rescan.</Text>
      </Box>
    )
  }
  const { open, current, query, raw, page } = m
  const size = Math.max(2000, m.viewerChars ?? 60000)

  const detail = (it: ConfigItem) => {
    const text = it.shard != null ? m.contents[it.id] ?? '' : ''
    const pg = pageOf(text, page, size)
    const markdown = it.kind === 'md' && !raw
    return (
      <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
        {it.path ? <Text dimColor wrap="wrap">{`${C('path')} : ${it.path}`}</Text> : null}
        {it.changed || it.size != null ? (
          <Text dimColor>{[it.changed ? `${C('modified')} ${it.changed}` : '', it.size != null ? `${C('size')} ${sizeText(it.size)}` : ''].filter(Boolean).join(' · ')}</Text>
        ) : null}
        {it.meta.map(([k, v]) => (
          <Text wrap="wrap">
            <Text bold>{k} : </Text>
            {v}
          </Text>
        ))}
        {it.summary && !it.meta.some(([, v]) => v === it.summary) ? <Text wrap="wrap" dimColor>{it.summary}</Text> : null}
        {it.flags.map(f => (
          <Text color="warning" wrap="wrap">! {f.text}</Text>
        ))}
        {it.kind === 'none' || !text ? (
          it.kind === 'none' ? null : <Text dimColor>{C('no_content')}</Text>
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              {it.kind === 'md' ? (
                <Button key={`raw-${it.id}`} plain dimColor onPress={() => m.onRaw()}>
                  {raw ? C('rendered') : C('raw')}
                </Button>
              ) : null}
              {pg.pages > 1 ? <Text dimColor>{`${pg.page + 1}/${pg.pages}`}</Text> : null}
              {pg.page > 0 ? (
                <Button key={`prev-${it.id}`} plain dimColor onPress={() => m.onPage(-1)}>
                  {C('previous')}
                </Button>
              ) : null}
              {pg.page < pg.pages - 1 ? (
                <Button key={`next-${it.id}`} plain dimColor onPress={() => m.onPage(1)}>
                  {C('more')}
                </Button>
              ) : null}
            </Box>
            {markdown ? <Markdown text={pg.text} /> : <Code source={pg.text} language={languageOf(it)} />}
          </Box>
        )}
      </Box>
    )
  }
  const itemRow = (it: ConfigItem, label?: string) => (
    <Box flexDirection="column">
      <Button key={`it-${it.id}`} plain onPress={() => m.onPick(it.id)}>
        {`${current === it.id ? '▾' : '▸'} ${label ?? it.name}${it.badge ? ` · ${it.badge}` : ''}${it.flags.length ? ' !' : ''}`}
      </Button>
      {current === it.id ? detail(it) : null}
    </Box>
  )
  const byId = new Map<string, ConfigItem>()
  for (const c of data.categories) for (const s of c.subs) for (const it of s.items) byId.set(it.id, it)

  const body: unknown[] = []
  if (query.trim().length >= 2) {
    const { hits, total } = searchConfig(data, m.contents, query)
    body.push(<Text bold>{`${total} ${C('results')}${total > hits.length ? ` (${hits.length} affichés)` : ''}`}</Text>)
    for (const hit of hits) {
      body.push(itemRow(hit.item, `${hit.item.name} · ${hit.where}`))
      if (hit.snippet && current !== hit.item.id) body.push(<Text dimColor wrap="wrap">{`    ${hit.snippet}`}</Text>)
    }
  } else {
    const ch = open.includes('changes')
    body.push(
      <Button key="changes" plain onPress={() => m.onFlip('changes')}>
        {`${ch ? '▾' : '▸'} ${C('changes')} (${data.changes_days} ${C('days')}) (${data.changes.length})`}
      </Button>,
    )
    if (ch)
      for (const x of data.changes) {
        const it = byId.get(x.id)
        if (it) body.push(itemRow(it, `${x.changed} · ${x.name} · ${x.where}`))
      }
    for (const c of data.categories) {
      const co = open.includes(`cat:${c.id}`)
      body.push(
        <Button key={`cat-${c.id}`} plain onPress={() => m.onFlip(`cat:${c.id}`)}>
          {`${co ? '▾' : '▸'} ${c.title} (${c.count})${c.badge ? ` · ${c.badge}` : ''}`}
        </Button>,
      )
      if (!co) continue
      for (const s of c.subs) {
        const so = open.includes(`sub:${s.id}`)
        body.push(
          <Box paddingLeft={2}>
            <Button key={`sub-${s.id}`} plain onPress={() => m.onFlip(`sub:${s.id}`)}>
              {`${so ? '▾' : '▸'} ${s.title} (${s.items.length})`}
            </Button>
          </Box>,
        )
        if (!so) continue
        for (const it of s.items) body.push(<Box paddingLeft={4}>{itemRow(it)}</Box>)
      }
    }
  }
  return (
    <Box flexDirection="column">
      {header}
      <Text bold wrap="wrap">
        {C('title')}
        <Text dimColor>{data.project ? ` · ${C('project')} ${data.project}` : ''}</Text>
      </Text>
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Input
            key="q"
            label="/ "
            placeholder={C('search')}
            submitLabel={C('search')}
            value={query}
            onInput={(v: string) => m.onQuery(v)}
            onSubmit={(v: string) => m.onQuery(v)}
          />
        </Box>
        {query ? <Button key="clear" plain dimColor onPress={() => m.onQuery('')}>×</Button> : null}
      </Box>
      {body as never}
    </Box>
  )
}
