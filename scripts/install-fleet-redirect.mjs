// Replace an installed copy of the old Fleet mod (~/.claude/mods/fleet, claude-control mods/fleet 0.1) by the thin
// redirect in mods/fleet, so a CLAUDE_CODE_PLUGIN_DIRS entry that still names it loads no second pane and leaves
// /fleet, /dispatch and /todo to Cockpit. Idempotent; the old copy is kept under ~/.claude/mods-backup/fleet-<time>.
//   node scripts/install-fleet-redirect.mjs [--home <dir>] [--check]
// --check only says what is installed (exit 0 = redirect in place, 1 = old copy or none).
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const i = argv.indexOf('--home')
const home = i >= 0 ? argv[i + 1] : homedir()
const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'mods', 'fleet')
const dest = join(home, '.claude', 'mods', 'fleet')
const versionOf = (dir) => {
  try { return JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).version || '?' } catch { return null }
}
const want = versionOf(src)
const have = versionOf(dest)
if (argv.includes('--check')) {
  console.log(`fleet installed=${have ?? 'none'} redirect=${want}`)
  process.exit(have === want ? 0 : 1)
}
if (have === want) {
  console.log(`FLEET_REDIRECT_OK dest=${dest} version=${want} (already)`)
  process.exit(0)
}
if (have !== null) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const bak = join(home, '.claude', 'mods-backup', `fleet-${stamp}`)
  mkdirSync(dirname(bak), { recursive: true })
  renameSync(dest, bak)
  console.log(`old copy ${have} kept at ${bak}`)
}
mkdirSync(dirname(dest), { recursive: true })
cpSync(src, dest, { recursive: true })
if (!existsSync(join(dest, 'hooks', 'register.mjs'))) { console.error('copy failed'); process.exit(2) }
console.log(`FLEET_REDIRECT_OK dest=${dest} version=${versionOf(dest)}`)
