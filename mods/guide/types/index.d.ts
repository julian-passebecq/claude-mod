// Shapes of the guide mod: the parsed MODE-EMPLOI.md, mods.json, a mod card, and its `$.state` values.

export type Section = { id: string; title: string; body: string; subs: Section[] }
export type Tab = { id: string; title: string; intro: string; cats: Section[] }
export type Doc = { title: string; intro: string; tabs: Tab[] }

export type CatalogEntry = {
  /** folder relative to mods/ (an external mod: '../vendor/<name>') */
  dir: string
  /** folder relative to the repo, shown in « Activer » (default mods/<dir>) */
  path?: string
  name?: string
  state: string
  description?: string
  data?: string
  note?: string
  /** where Julian finds it since the 6 hubs: « hub … » for a hub, « dans <hub> … » for an older mod */
  inside?: string
  tests?: string[]
}
export type ModsCatalog = {
  states: Record<string, string>
  mods: CatalogEntry[]
  archived: { name: string; verdict: string; why: string }[]
}
export type Card = {
  dir: string
  /** folder relative to the repo */
  path: string
  name: string
  version: string
  description: string
  state: string
  /** the mod's plugin.json was found beside this one */
  found: boolean
  events: string[]
  commands: string[]
  draws: string[]
  blocks: boolean
  options: string[]
  data: string
  note: string
  /** the hub that shows it (mods.json `inside`), '' when not said */
  inside: string
  tests: string[]
  enable: string
}

declare module 'claude-code' {
  interface PluginState {
    guide: {
      /** tab shown: 'sommaire' or a `##` heading's anchor */
      tab: string
      /** category unfolded in that tab ('' = none) */
      cat: string
      /** sub-section marked after a Sommaire link ('' = none) */
      sub: string
    }
  }
}
