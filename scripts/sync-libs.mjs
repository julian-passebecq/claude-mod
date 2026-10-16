// Copies the shared libraries into the mods, byte for byte. NEVER EDIT A COPY BY HAND: change the source (lib/core/
// at the repo root, or the owner mod for the older mod -> mod copies), then run this script and commit both.
//   node scripts/sync-libs.mjs          copy every file listed in lib/core/targets.json, remove stale lib/core copies
//   node scripts/sync-libs.mjs --check  exit 1 and list the copies that are missing, differ or should not exist (CI)
// Why copies: a mod may import only files inside its own folder (`claude plugin validate`: « cannot import … it is
// outside the plugin's folder ») and an installed mod is one folder. The comparison ignores CRLF vs LF only, so a
// Windows checkout with autocrlf and the Linux CI agree.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** [source, copy] pairs relative to the repo root, from lib/core/targets.json. */
export function pairs(root = ROOT) {
  const t = JSON.parse(readFileSync(join(root, 'lib', 'core', 'targets.json'), 'utf8'))
  const out = []
  for (const [mod, files] of Object.entries(t.core || {})) {
    if (mod.startsWith('_')) continue
    for (const f of files) out.push([`lib/core/${f}`, `mods/${mod}/lib/core/${f}`])
  }
  for (const p of t.files || []) out.push([p[0], p[1]])
  return out
}

/** Files under mods/<mod>/lib/core that no pair produces (left over after a target was removed). */
export function extras(root = ROOT) {
  const want = new Set(pairs(root).map(([, b]) => b))
  const out = []
  let mods = []
  try { mods = readdirSync(join(root, 'mods'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { return out }
  for (const m of mods) {
    const dir = join(root, 'mods', m, 'lib', 'core')
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (!want.has(`mods/${m}/lib/core/${f}`)) out.push(`mods/${m}/lib/core/${f}`)
  }
  return out
}

const same = (a, b) => a.toString('utf8').replace(/\r\n/g, '\n') === b.toString('utf8').replace(/\r\n/g, '\n')

/** Copies that are missing or differ from their source, plus extras. Empty when everything is current. */
export function stale(root = ROOT) {
  const out = []
  for (const [src, dst] of pairs(root)) {
    const b = join(root, dst)
    if (!existsSync(join(root, src))) out.push(`${dst} (source ${src} missing)`)
    else if (!existsSync(b)) out.push(`${dst} (missing)`)
    else if (!same(readFileSync(join(root, src)), readFileSync(b))) out.push(`${dst} (differs from ${src})`)
  }
  for (const e of extras(root)) out.push(`${e} (not in lib/core/targets.json)`)
  return out
}

/** Writes every copy and removes extras. Returns the number of files written. */
export function sync(root = ROOT) {
  let n = 0
  for (const [src, dst] of pairs(root)) {
    const b = join(root, dst)
    const data = readFileSync(join(root, src))
    if (existsSync(b) && same(data, readFileSync(b))) continue
    mkdirSync(dirname(b), { recursive: true })
    writeFileSync(b, data)
    n++
  }
  for (const e of extras(root)) rmSync(join(root, e), { force: true })
  return n
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const s = stale()
    if (s.length) {
      console.error(`Copies en retard (node scripts/sync-libs.mjs) :\n  ${s.join('\n  ')}`)
      process.exit(1)
    }
    console.log(`${pairs().length} copies à jour`)
  } else {
    console.log(`${sync()} fichier(s) copié(s), ${pairs().length} copies suivies`)
  }
}
