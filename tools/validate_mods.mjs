// Runs `claude plugin validate` on every mod under mods/ (one with a .claude-plugin/plugin.json) and fails if any fails.
// Used by CI so a mod whose code and manifest drift apart (e.g. an undeclared state key) cannot merge silently.
// Usage: node tools/validate_mods.mjs [claude binary, default "claude"]
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const bin = process.argv[2] || 'claude'
const mods = readdirSync('mods', { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join('mods', d.name, '.claude-plugin', 'plugin.json')))
  .map((d) => d.name)
  .sort()

const failed = []
for (const m of mods) {
  const r = spawnSync(bin, ['plugin', 'validate', join('mods', m)], { encoding: 'utf8', shell: process.platform === 'win32' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const ok = r.status === 0 && !/Validation failed/.test(out)
  console.log(`${ok ? 'ok  ' : 'FAIL'} mods/${m}`)
  if (!ok) {
    failed.push(m)
    console.log(out.split('\n').filter((l) => /✘|error/i.test(l) || /is not declared/.test(l)).join('\n') || out)
  }
}
if (!mods.length) {
  console.log('no mods found')
  process.exit(1)
}
if (failed.length) {
  console.log(`\n${failed.length} of ${mods.length} mods fail validation: ${failed.join(', ')}`)
  process.exit(1)
}
console.log(`\nall ${mods.length} mods validate`)
