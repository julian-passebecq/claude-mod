// guide mod ("Mode d'emploi des mods"): MODE-EMPLOI.md as a pane with tabs. The first tab, Sommaire, is the whole tree
// with a link to every tab, category and sub-section; each other tab folds its categories. The "Nos mods" cards are
// rebuilt at each draw from the neighbouring mods' plugin.json and hooks module. Read-only: no hook on tools or agents.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Doc, ModsCatalog } from '../types'
import { card, modsMarkdown, modulePath } from './cards'
import { between, locate, parse, slug } from './toc'

const PANE = { id: 'mods-guide', title: "Mode d'emploi des mods" }
const SOMMAIRE = 'sommaire'
const tabAtom = atom({ plugin: 'guide', key: 'tab' } as const, SOMMAIRE)
const catAtom = atom({ plugin: 'guide', key: 'cat' } as const, '')
const subAtom = atom({ plugin: 'guide', key: 'sub' } as const, '')

const text = async ($: EngineInterface, path: string): Promise<string | undefined> => {
  try {
    return (await $.fs.read(path, { as: 'text' })) as string
  } catch {
    return undefined
  }
}

/** The guide with live cards for "Nos mods". */
const loadDoc = async ($: EngineInterface): Promise<{ doc: Doc; problem: string }> => {
  const root = $.plugin.root.replace(/\\/g, '/')
  const md = await text($, `${root}/MODE-EMPLOI.md`)
  if (!md) return { doc: { title: PANE.title, intro: '', tabs: [] }, problem: `cannot read ${root}/MODE-EMPLOI.md` }
  let live = md
  const raw = await text($, `${root}/mods.json`)
  if (raw) {
    try {
      const catalog = JSON.parse(raw) as ModsCatalog
      const mods = root.replace(/\/[^/]+$/, '')
      const cards = []
      for (const entry of catalog.mods) {
        const dir = `${mods}/${entry.dir}`
        const manifest = await text($, `${dir}/.claude-plugin/plugin.json`)
        const rel = modulePath(await text($, `${dir}/hooks/hooks.json`))
        cards.push(card(entry, catalog, manifest, rel ? await text($, `${dir}/${rel}`) : undefined))
      }
      live = between(md, 'mods', modsMarkdown(cards, catalog))
    } catch {}
  }
  return { doc: parse(live), problem: '' }
}

/** `/mods-guide [onglet ou section]`: an anchor, or the start of a title. */
const find = (doc: Doc, args: string) => {
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

const go = async ($: EngineInterface, to: { tab: string; cat: string; sub: string }) => {
  await update($, tabAtom, () => to.tab)
  await update($, catAtom, () => to.cat)
  await update($, subAtom, () => to.sub)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mods-guide',
      description: "Mode d'emploi des mods : onglets Bases, Événements, Interface, Configuration, Installer, Tester, Écrire un mod, Référence, Nos mods, FAQ",
      argumentHint: '[onglet ou section] | close',
    })
    return next(e)
  })

  on('command.run', { command: 'mods-guide' }, async ($, e) => {
    if ((e.args ?? '').trim().toLowerCase() === 'close') {
      await $.ui.close({ id: PANE.id })
      return {}
    }
    const { doc, problem } = await loadDoc($)
    if (problem) return { text: `mods-guide: ${problem}` }
    const args = (e.args ?? '').trim()
    const to = args ? find(doc, args) : { tab: SOMMAIRE, cat: '', sub: '' }
    if (!to) return { text: `mods-guide: pas de section « ${args} ». Onglets : ${doc.tabs.map(t => t.title).join(', ')}` }
    await go($, to)
    await $.ui.open({ id: PANE.id, title: PANE.title })
    const where = to.tab === SOMMAIRE ? 'Sommaire' : doc.tabs.find(t => t.id === to.tab)?.title
    return { text: `mods-guide: ouvert sur ${where}${to.cat ? ` › ${to.cat}` : ''}${to.sub ? ` › ${to.sub}` : ''}` }
  })

  on('ui.render', { component: 'Pane', requestId: 'mods-guide' }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const { doc, problem } = await loadDoc($)
    const tab = await read($, tabAtom)
    const cat = await read($, catAtom)
    const sub = await read($, subAtom)
    const current = doc.tabs.find(t => t.id === tab)
    const on_ = (yes: boolean) => (yes ? {} : { plain: true as const })

    const tabs = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="tab-sommaire" {...on_(!current)} onPress={() => go($, { tab: SOMMAIRE, cat: '', sub: '' })}>
          Sommaire
        </Button>
        {doc.tabs.map(t => (
          <Button key={`tab-${t.id}`} {...on_(t.id === current?.id)} onPress={() => go($, { tab: t.id, cat: '', sub: '' })}>
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
                <Button key={`go-${t.id}`} plain bold onPress={() => go($, { tab: t.id, cat: '', sub: '' })}>
                  {t.title}
                </Button>
                {t.cats.map(c => (
                  <Box flexDirection="column" paddingLeft={2}>
                    <Button key={`go-${c.id}`} plain onPress={() => go($, { tab: t.id, cat: c.id, sub: '' })}>
                      {c.title}
                    </Button>
                    {c.subs.map(s => (
                      <Box paddingLeft={2}>
                        <Button key={`go-${s.id}`} plain dimColor onPress={() => go($, { tab: t.id, cat: c.id, sub: s.id })}>
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
              <Button key={`cat-${c.id}`} plain bold onPress={() => go($, { tab: current.id, cat: open ? '' : c.id, sub: '' })}>
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
        <Button key="back" plain dimColor onPress={() => go($, { tab: SOMMAIRE, cat: '', sub: '' })}>
          ← Sommaire
        </Button>
      </Box>
    )
  })
}
