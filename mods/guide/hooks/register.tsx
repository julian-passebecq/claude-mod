// guide mod ("Mode d'emploi des mods"): MODE-EMPLOI.md as a pane with tabs. The first tab, Sommaire, is the whole tree
// with a link to every tab, category and sub-section; each other tab folds its categories. The "Nos mods" cards are
// rebuilt at each draw from the neighbouring mods' plugin.json and hooks module. Read-only: no hook on tools or agents.
// The drawing and the live cards are in draw.tsx (pure), shared with the Référence hub (mods/reference).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { SOMMAIRE, drawGuide, findIn, liveDoc } from './draw'
import type { Where } from './draw'

const PANE = { id: 'mods-guide', title: "Mode d'emploi des mods" }
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
const loadDoc = async ($: EngineInterface) => {
  const root = $.plugin.root.replace(/\\/g, '/')
  return liveDoc(p => text($, p), `${root}/MODE-EMPLOI.md`, `${root}/mods.json`, root.replace(/\/[^/]+$/, ''), PANE.title)
}

const go = async ($: EngineInterface, to: Where) => {
  await update($, tabAtom, () => to.tab)
  await update($, catAtom, () => to.cat)
  await update($, subAtom, () => to.sub)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mods-guide',
      description: "Mode d'emploi des mods : Démarrer, les 6 entrées (Jauge, Cockpit, Veille, À toi, Registres, Référence), la nuit, possible ou pas, à essayer, écrire un mod, nos mods, FAQ",
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
    const to = args ? findIn(doc, args) : { tab: SOMMAIRE, cat: '', sub: '' }
    if (!to) return { text: `mods-guide: pas de section « ${args} ». Onglets : ${doc.tabs.map(t => t.title).join(', ')}` }
    await go($, to)
    await $.ui.open({ id: PANE.id, title: PANE.title })
    const where = to.tab === SOMMAIRE ? 'Sommaire' : doc.tabs.find(t => t.id === to.tab)?.title
    return { text: `mods-guide: ouvert sur ${where}${to.cat ? ` › ${to.cat}` : ''}${to.sub ? ` › ${to.sub}` : ''}` }
  })

  on('ui.render', { component: 'Pane', requestId: 'mods-guide' }, async ($, e) => {
    const { doc, problem } = await loadDoc($)
    return drawGuide($.ui.resolve(e), {
      doc, problem,
      tab: await read($, tabAtom),
      cat: await read($, catAtom),
      sub: await read($, subAtom),
      go: to => go($, to),
    })
  })
}
