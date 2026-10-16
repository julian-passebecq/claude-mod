// "Nos mods": one card per mod, built from what the mod itself ships (plugin.json, hooks/hooks.json, its hooks
// module's source) plus the few facts only mods.json knows (state, data read, tests). Pure: no `$`.
import type { Card, CatalogEntry, ModsCatalog } from '../types'

type Manifest = {
  name?: string
  version?: string
  description?: string
  userConfig?: Record<string, { title?: string; default?: unknown; options?: unknown[] }>
}

const uniq = (xs: string[]) => [...new Set(xs)]

/** Events the module hooks: `on('event'` / `on("event"`. */
export const eventsIn = (src: string) => uniq([...src.matchAll(/\bon\(\s*['"]([\w.*-]+)['"]/g)].map(m => m[1]!))

/** Slash commands the module registers: `$.command.register({ name: 'x'`. */
export const commandsIn = (src: string) =>
  uniq([...src.matchAll(/\$\.command\.register\(\s*\{[^}]*?\bname:\s*['"]([\w-]+)['"]/gs)].map(m => `/${m[1]}`))

/** Whether the source can refuse anything: a `deny` answer or a `drop` of a prompt. */
export const canBlock = (src: string) => /\{\s*deny\s*:|\bdeny:\s*['"`]|\{\s*drop\s*:/.test(src)

/** Whether it draws: a Pane, a band above the prompt, a status line, toasts. */
export function drawsIn(src: string): string[] {
  const out: string[] = []
  if (/component:\s*['"]Pane['"]/.test(src)) out.push('panneau')
  if (/component:\s*['"]AbovePrompt['"]/.test(src)) out.push('bandeau')
  if (/\$\.ui\.status\(/.test(src)) out.push('ligne de statut')
  if (/\$\.ui\.toast\(/.test(src)) out.push('toasts')
  if (/['"]prompt\.compose['"]/.test(src)) out.push('note dans le prompt système')
  return out
}

/** The hooks module path a hooks.json names, relative to the mod folder. */
export function modulePath(hooksJson: string | undefined): string | undefined {
  try {
    const first = (JSON.parse(hooksJson ?? '') as { modules?: string[] }).modules?.[0]
    return first ? `hooks/${first.replace(/^\.\//, '')}` : undefined
  } catch {
    return undefined
  }
}

/** One card. `manifest` and `source` are undefined for a mod that is not in this folder (planned, or not installed here). */
export function card(entry: CatalogEntry, catalog: ModsCatalog, manifest?: string, source?: string): Card {
  let m: Manifest = {}
  try {
    m = manifest ? (JSON.parse(manifest) as Manifest) : {}
  } catch {}
  const src = source ?? ''
  const options = Object.entries(m.userConfig ?? {}).map(([key, f]) => {
    const choices = Array.isArray(f.options) ? ` (${f.options.join(' | ')})` : ''
    return `${key}${f.title ? ` « ${f.title} »` : ''}${choices}, défaut ${JSON.stringify(f.default ?? '')}`
  })
  const found = Boolean(manifest)
  const path = entry.path ?? `mods/${entry.dir}`
  return {
    dir: entry.dir,
    path,
    name: m.name ?? entry.name ?? entry.dir,
    version: m.version ?? '',
    description: m.description ?? entry.description ?? '',
    state: catalog.states[entry.state] ?? entry.state,
    found,
    events: eventsIn(src),
    commands: commandsIn(src),
    draws: drawsIn(src),
    blocks: canBlock(src),
    options,
    data: entry.data ?? '',
    note: entry.note ?? '',
    inside: entry.inside ?? '',
    tests: entry.tests ?? [],
    enable: found ? `ajoute <dépôt>/${path} à CLAUDE_CODE_PLUGIN_DIRS, ou lance claude --plugin-dir ${path}` : 'pas encore dans le dépôt',
  }
}

/** The same card as Markdown, for MODE-EMPLOI.md. */
export function cardMarkdown(c: Card): string {
  const rows = [
    `#### ${c.name}`,
    '',
    `${c.description || '(pas de description)'}`,
    '',
    ...(c.inside ? [`- **Où** : ${c.inside}`] : []),
    `- **État** : ${c.state}${c.version ? ` · version ${c.version}` : ''}${c.note ? ` · ${c.note}` : ''}`,
    `- **Fonctionnement** : ${c.found ? `événements ${c.events.map(e => `\`${e}\``).join(', ') || 'aucun'}` : 'pas encore écrit'} · lit : ${c.data || '—'} · ${c.found ? (c.blocks ? '⚠ peut refuser un appel' : 'aucun blocage') : 'sans blocage prévu'}`,
    `- **Fonctionnalités** : commandes ${c.commands.map(x => `\`${x}\``).join(', ') || 'aucune'} · affiche : ${c.draws.join(', ') || 'rien'} · options userConfig : ${c.options.length ? c.options.join(' ; ') : 'aucune'}`,
    `- **Activer** : ${c.found ? `\`<dépôt>/${c.path}\` dans \`CLAUDE_CODE_PLUGIN_DIRS\`, ou \`claude --plugin-dir ${c.path}\`` : c.enable}`,
    `- **Tests** : ${c.tests.length ? c.tests.map(t => `\`${t}\``).join(' · ') : 'aucun pour l’instant'}`,
  ]
  return rows.join('\n')
}

/** The whole "Nos mods" block: one card per mod, then the archived / rejected table. */
export function modsMarkdown(cards: Card[], catalog: ModsCatalog): string {
  const parts = ['### Fiches', ...cards.map(cardMarkdown)]
  parts.push(
    [
      '### Archivés / rejetés',
      '',
      '| Mod | Verdict | Pourquoi |',
      '|---|---|---|',
      ...catalog.archived.map(a => `| ${a.name} | ${a.verdict} | ${a.why} |`),
    ].join('\n'),
  )
  return parts.join('\n\n')
}
