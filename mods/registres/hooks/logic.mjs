// registres mod - pure helpers (no `$`): command arguments, which aliases to register, staleness, config merge.
// Tested by tests/logic.test.mjs; register.tsx does the I/O.

export const TABS = ['problemes', 'tests', 'regles', 'menage']

export function deepMerge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v
  return out
}

export const fill = (s, vars = {}) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])))

export const expandHome = (p, home) => String(p ?? '').replace(/^~(?=[\\/]|$)/, home).replace(/\\/g, '/')

/** Tab ids in the configured order (unknown ids dropped, missing ones appended). */
export function tabOrder(cfg = {}) {
  const want = (Array.isArray(cfg.tabs) ? cfg.tabs : []).filter((t) => TABS.includes(t))
  return [...new Set([...want, ...TABS])].filter((t) => !(cfg.hidden_tabs ?? []).includes(t))
}

/**
 * `/registres [tab] [rest]` (or an alias, which names its tab): { close, tab, rest }. A first word that is not a tab
 * (or a tab synonym from cfg.synonyms) keeps the current tab and is passed on as `rest`.
 */
export function parseArgs(args, { alias = '', current = '', cfg = {} } = {}) {
  const words = String(args ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 1 && words[0].toLowerCase() === 'close') return { close: true, tab: current, rest: '' }
  const syn = { problemes: 'problemes', 'problèmes': 'problemes', tests: 'tests', 'tests-reels': 'tests', regles: 'regles', 'règles': 'regles', metrics: 'regles', menage: 'menage', 'ménage': 'menage', ...(cfg.synonyms ?? {}) }
  let tab = alias ? syn[alias] ?? alias : ''
  if (!alias && words.length && syn[words[0].toLowerCase()]) tab = syn[words.shift().toLowerCase()]
  if (!TABS.includes(tab)) tab = TABS.includes(current) ? current : TABS.includes(cfg.default_tab) ? cfg.default_tab : TABS[0]
  return { close: false, tab, rest: words.join(' ') }
}

/** Our own plugin name, or a marketplace install of it (registres@market). */
export const isSelf = (plugin, self = 'registres') => !!plugin && (plugin === self || String(plugin).startsWith(`${self}@`))

/**
 * Alias names to register: those in `aliases` that no other plugin, skill or built-in already serves in this session
 * (the old mods keep theirs while they are loaded).
 */
export function aliasesToRegister(list = [], aliases = [], self = 'registres') {
  const taken = new Set(list.filter((c) => !isSelf(c.plugin, self)).map((c) => c.name))
  return aliases.filter((a) => a && !taken.has(a))
}

/** True when a scanner's output is missing or older than refresh_min minutes. */
export const isStale = (generated, now, refreshMin = 30) => !generated || now - generated > refreshMin * 60000
