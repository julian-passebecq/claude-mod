// Copies the shared libs cockpit draws with from their owner mods into mods/cockpit/lib, byte for byte:
//   node mods/cockpit/scripts/sync-libs.mjs          copy (run after changing one of the sources)
//   node mods/cockpit/scripts/sync-libs.mjs --check  exit 1 and list the files that differ (tests and CI)
// Why a copy: a mod may import only files inside its own folder (`claude plugin validate`: « cannot import … it is
// outside the plugin's folder »), and an installed mod is one folder. The owners stay the source of truth; the drift
// test (tests/nav.test.mjs) fails when a copy is stale, so nobody edits lib/ by hand.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MODS = join(HERE, '..', '..')
export const LIB = join(HERE, '..', 'lib')

// source (relative to mods/) -> copy (relative to mods/cockpit/lib). Relative imports inside them keep working.
export const FILES = [
  'factory/hooks/logic.mjs',
  'factory/hooks/screens.mjs',
  'factory/hooks/draw.mjs',
  'factory/hooks/waiting.mjs',
  'factory/scanner/factory_scan.py',
  'factory/scanner/textrender.mjs',
  'factory/factory.config.json',
  'band/hooks/gauge.ts',
  'veille/lib/modes.mjs',
  'veille/hooks/view.mjs',
  'usage/lib/classement.mjs',
  'usage/lib/transcripts.mjs',
]

export function stale() {
  return FILES.filter((f) => {
    const dst = join(LIB, f)
    return !existsSync(dst) || readFileSync(join(MODS, f), 'utf8') !== readFileSync(dst, 'utf8')
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const s = stale()
    if (s.length) { console.error(`cockpit/lib est en retard sur : ${s.join(', ')} (node mods/cockpit/scripts/sync-libs.mjs)`); process.exit(1) }
    console.log('cockpit/lib à jour')
  } else {
    for (const f of FILES) {
      mkdirSync(dirname(join(LIB, f)), { recursive: true })
      writeFileSync(join(LIB, f), readFileSync(join(MODS, f)))
    }
    console.log(`${FILES.length} fichiers copiés dans mods/cockpit/lib`)
  }
}
