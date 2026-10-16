// guide mod: the pane's drawing and the live « Nos mods » cards, pure. No `$`: the elements come in as `ui`
// ($.ui.resolve(e)), files through a `read` callback built on $.fs in the register file, every press as `go`. The
// guide pane and the Référence hub (mods/reference, a synced copy of this file) draw the same tree. Same output as the
// drawing that lived in register.tsx before.
import type { Doc, ModsCatalog } from '../types'
import { card, modsMarkdown, modulePath } from './cards'
import { between, locate, parse, slug } from './toc'

export const SOMMAIRE = 'sommaire'
export type Where = { tab: string; cat: string; sub: string }
export type Read = (path: string) => Promise<string | undefined>

/** The guide at `guidePath` with live cards for "Nos mods": catalog at `catalogPath`, mods under `modsDir`. */
export async function liveDoc(read: Read, guidePath: string, catalogPath: string, modsDir: string, title: string): Promise<{ doc: Doc; problem: string }> {
  const md = await read(guidePath)
  if (!md) return { doc: { title, intro: '', tabs: [] }, problem: `cannot read ${guidePath}` }
  let live = md
  const raw = await read(catalogPath)
  if (raw) {
    try {
      const catalog = JSON.parse(raw) as ModsCatalog
      const cards = []
      for (const entry of catalog.mods) {
        const dir = `${modsDir}/${entry.dir}`
        const manifest = await read(`${dir}/.claude-plugin/plugin.json`)
        const rel = modulePath(await read(`${dir}/hooks/hooks.json`))
        cards.push(card(entry, catalog, manifest, rel ? await read(`${dir}/${rel}`) : undefined))
      }
      live = between(md, 'mods', modsMarkdown(cards, catalog))
    } catch {}
  }
  return { doc: parse(live), problem: '' }
}

/** `/mods-guide [onglet ou section]`: an anchor, or the start of a title. */
export function findIn(doc: Doc, args: string): Where | undefined {
  const want = slug(args)
  if (!want) return undefined
  const exact = locate(doc, want)
  if (exact) return exact
  for (const t of doc.tabs) {
    if (t.id.startsWith(want)) return { tab: t.id, cat: '', sub: '' }
    for (const c of t.cats) {
      if (c.id.startsWith(want)) return { tab: t.id, cat: c.id, sub: '' }
      for (const s of c.subs) if (s.id.startsWith(want)) return { tab: t.id, cat: c.id, sub: s.id }
    }
  }
  return undefined
}

export type GuideModel = { doc: Doc; problem: string; tab: string; cat: string; sub: string; go: (to: Where) => void | Promise<void> }

export function drawGuide(ui: any, m: GuideModel): any {
  const { Box, Text, Button, Markdown } = ui
  const { doc, problem, cat, sub, go } = m
  const current = doc.tabs.find(t => t.id === m.tab)
  const on_ = (yes: boolean) => (yes ? {} : { plain: true as const })

  const tabs = (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      <Button key="tab-sommaire" {...on_(!current)} onPress={() => go({ tab: SOMMAIRE, cat: '', sub: '' })}>
        Sommaire
      </Button>
      {doc.tabs.map(t => (
        <Button key={`tab-${t.id}`} {...on_(t.id === current?.id)} onPress={() => go({ tab: t.id, cat: '', sub: '' })}>
          {t.title}
        </Button>
      ))}
    </Box>
  )

  if (problem) return <Text color="error">{problem}</Text>

  if (!current) {
    return (
      <Box flexDirection="column" gap={1}>
        {tabs}
        <Text bold>{`Sommaire général · ${doc.title}`}</Text>
        {doc.intro ? <Markdown text={doc.intro.replace(/^Doc officielle.*$/m, '').trim()} /> : null}
        <Box flexDirection="column">
          {doc.tabs.map(t => (
            <Box flexDirection="column">
              <Button key={`go-${t.id}`} plain bold onPress={() => go({ tab: t.id, cat: '', sub: '' })}>
                {t.title}
              </Button>
              {t.cats.map(c => (
                <Box flexDirection="column" paddingLeft={2}>
                  <Button key={`go-${c.id}`} plain onPress={() => go({ tab: t.id, cat: c.id, sub: '' })}>
                    {c.title}
                  </Button>
                  {c.subs.map(s => (
                    <Box paddingLeft={2}>
                      <Button key={`go-${s.id}`} plain dimColor onPress={() => go({ tab: t.id, cat: c.id, sub: s.id })}>
                        {s.title}
                      </Button>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {tabs}
      <Text bold>{current.title}</Text>
      {current.intro ? <Markdown text={current.intro} /> : null}
      {current.cats.map(c => {
        const open = c.id === cat
        return (
          <Box flexDirection="column">
            <Button key={`cat-${c.id}`} plain bold onPress={() => go({ tab: current.id, cat: open ? '' : c.id, sub: '' })}>
              {`${open ? '▾' : '▸'} ${c.title}${open ? '' : ` (${c.subs.length})`}`}
            </Button>
            {open && (
              <Box flexDirection="column" paddingLeft={2} gap={1}>
                {c.body ? <Markdown text={c.body} /> : null}
                {c.subs.map(s => (
                  <Box flexDirection="column">
                    <Text bold {...(s.id === sub ? { color: 'success' as const } : {})}>{`${s.id === sub ? '→ ' : ''}${s.title}`}</Text>
                    {s.body ? <Markdown text={s.body} /> : null}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )
      })}
      <Button key="back" plain dimColor onPress={() => go({ tab: SOMMAIRE, cat: '', sub: '' })}>
        ← Sommaire
      </Button>
    </Box>
  )
}
