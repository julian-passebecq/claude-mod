// Copies export-eta's masking and git flow into mods/problemes/lib/eta, byte for byte:
//   node mods/problemes/scripts/sync-libs.mjs          copy (run after changing one of the sources)
//   node mods/problemes/scripts/sync-libs.mjs --check  exit 1 and list the files that differ (tests and CI)
// Why a copy: a mod may import only files inside its own folder (`claude plugin validate`), and an installed mod is
// one folder. export-eta stays the source of truth; tests/logic.test.mjs fails when a copy is stale.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MODS = join(HERE, '..', '..')
export const LIB = join(HERE, '..', 'lib', 'eta')

// source (relative to mods/) -> copy (relative to mods/problemes/lib/eta)
export const FILES = [
  ['export-eta/lib/mask.mjs', 'mask.mjs'],
  ['export-eta/lib/etagit.mjs', 'etagit.mjs'],
]

/** Files whose copy differs from the source (or is missing). */
export function drift() {
  return FILES.filter(([src, dst]) => {
    const a = join(MODS, src)
    const b = join(LIB, dst)
    return !existsSync(b) || readFileSync(a, 'utf8') !== readFileSync(b, 'utf8')
  }).map(([src]) => src)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const d = drift()
    if (d.length) { console.error(`mods/problemes/lib/eta en retard : ${d.join(', ')} (node mods/problemes/scripts/sync-libs.mjs)`); process.exit(1) }
    console.log('problemes/lib/eta à jour')
  } else {
    mkdirSync(LIB, { recursive: true })
    for (const [src, dst] of FILES) writeFileSync(join(LIB, dst), readFileSync(join(MODS, src)))
    console.log(`${FILES.length} fichiers copiés dans mods/problemes/lib/eta`)
  }
}
