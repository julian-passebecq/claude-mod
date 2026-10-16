// Référence hub: tabs (Config, Guide, Scénarios, Santé, CI, À essayer, R&D, Repos), /reference arguments and the old commands it answers when their mod is not loaded. Pure.
export const TABS = ['config', 'guide', 'scenarios', 'sante', 'ci', 'essais', 'rd', 'repos'] as const
export type Tab = (typeof TABS)[number]

/** The old slash commands, each with the tab it opens. Registered by reference only when absent from the session. */
export const ALIASES: Record<string, Tab> = {
  'config-claude': 'config',
  control: 'config',
  'mods-guide': 'guide',
  scenarios: 'scenarios',
  sante: 'sante',
  ci: 'ci',
}

const WORDS: Record<string, Tab> = {
  config: 'config', 'config-claude': 'config', control: 'config', reglages: 'config', réglages: 'config',
  guide: 'guide', 'mods-guide': 'guide', 'mode-emploi': 'guide',
  scenarios: 'scenarios', scénarios: 'scenarios', scenario: 'scenarios', scénario: 'scenarios',
  sante: 'sante', santé: 'sante', health: 'sante',
  ci: 'ci',
  essais: 'essais', 'à-essayer': 'essais', 'a-essayer': 'essais', essayer: 'essais', features: 'essais',
  rd: 'rd', 'r&d': 'rd', recherches: 'rd', recherche: 'rd', research: 'rd',
  repos: 'repos', 'mes-repos': 'repos', depots: 'repos', dépôts: 'repos',
}

/** Commands of this mod that run an action (not an old mod's alias): registered only when the session has none. */
export const ACTION_COMMANDS = ['audit-export'] as const

export type Parsed = { close: boolean; tab?: Tab; rest: string[] }

/** `/reference [config|guide|scenarios|sante|ci [diagramme]|close]`: the tab word, then what follows for that tab. */
export function parseArgs(args: string): Parsed {
  const words = String(args ?? '').trim().split(/\s+/).filter(Boolean)
  if (words[0]?.toLowerCase() === 'close') return { close: true, rest: [] }
  const tab = words[0] ? WORDS[words[0].toLowerCase()] : undefined
  return { close: false, ...(tab ? { tab } : {}), rest: tab ? words.slice(1) : words }
}

/** An old command run against the hub: which tab, and its own arguments untouched. */
export function aliasArgs(command: string, args: string): Parsed {
  const words = String(args ?? '').trim().split(/\s+/).filter(Boolean)
  if (words[0]?.toLowerCase() === 'close') return { close: true, rest: [] }
  return { close: false, tab: ALIASES[command], rest: words }
}

/** Aliases to register: those whose name no command of this session already uses. */
export function missingAliases(present: readonly { name: string }[], wanted: readonly string[] = Object.keys(ALIASES)): string[] {
  const have = new Set(present.map(c => c.name))
  return wanted.filter(n => ALIASES[n] && !have.has(n))
}

/** Tabs in the configured order (unknown ids dropped, a missing list = all of them). */
export function tabsOf(list: unknown): Tab[] {
  const out = Array.isArray(list) ? list.filter((t): t is Tab => (TABS as readonly string[]).includes(String(t))) : []
  return out.length ? [...new Set(out)] : [...TABS]
}

/** `~` to the home folder, forward slashes. */
export const expandHome = (p: string, home: string) => String(p ?? '').replace(/^~(?=[\\/]|$)/, home).replace(/\\/g, '/')

/** Objects merge key by key; arrays and scalars of `b` replace. */
export function deepMerge(a: any, b: any): any {
  if (Array.isArray(b)) return b.slice()
  if (b === null || typeof b !== 'object') return b === undefined ? a : b
  const out: any = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v)
  return out
}
