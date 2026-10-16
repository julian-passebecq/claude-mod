// Regenerates MODE-EMPLOI.md's "Nos mods" cards (from each mod's plugin.json and hooks module) and its table of contents.
//   node mods/guide/scripts/build.mjs           rewrite the file
//   node mods/guide/scripts/build.mjs --check   exit 1 if the file is not up to date
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { card, modsMarkdown, modulePath } from '../hooks/cards.ts'
import { anchors, between, parse, withToc } from '../hooks/toc.ts'

const guide = join(dirname(fileURLToPath(import.meta.url)), '..')
const mods = join(guide, '..')
const read = p => (existsSync(p) ? readFileSync(p, 'utf8') : undefined)

export function build(md) {
  const catalog = JSON.parse(readFileSync(join(guide, 'mods.json'), 'utf8'))
  const cards = catalog.mods.map(entry => {
    const dir = join(mods, entry.dir)
    const manifest = read(join(dir, '.claude-plugin', 'plugin.json'))
    const rel = modulePath(read(join(dir, 'hooks', 'hooks.json')))
    return card(entry, catalog, manifest, rel ? read(join(dir, rel)) : undefined)
  })
  const out = withToc(between(md.replace(/\r\n/g, '\n'), 'mods', modsMarkdown(cards, catalog)))
  const ids = anchors(parse(out))
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dup.length) throw new Error(`duplicate headings (anchors): ${[...new Set(dup)].join(', ')}`)
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = join(guide, 'MODE-EMPLOI.md')
  const now = readFileSync(file, 'utf8')
  const next = build(now)
  if (process.argv.includes('--check')) {
    if (next !== now.replace(/\r\n/g, '\n')) {
      console.error('MODE-EMPLOI.md is not up to date: run node mods/guide/scripts/build.mjs')
      process.exit(1)
    }
  } else writeFileSync(file, next)
}
