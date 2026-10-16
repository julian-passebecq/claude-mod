// node --test mods/usage/tests/quotas.test.mjs   The 5 h / week line from lib/core/usage.mjs, the same reader as band
// and cockpit. Invented samples in a temp folder only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { quotaLine, quotaPart } from '../hooks/logic.mjs'
import { claudeWindows, codexWindows } from '../lib/core/usage.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = Date.parse('2026-10-16T16:00:00Z')
const H = 3600000

test('quotaLine: Claude and Codex side by side, rounded %, earliest run-out', () => {
  const claude = claudeWindows([{ ts: NOW - 2 * H, five_hour: { pct: 20, reset: NOW + 2 * H }, seven_day: { pct: 13.6, reset: NOW + 90 * H } },
    { ts: NOW - H, five_hour: { pct: 60, reset: NOW + 2 * H }, seven_day: { pct: 14.2, reset: NOW + 90 * H } }], NOW)
  const codex = codexWindows({ limits: { ts: NOW, secondary: { pct: 18, windowMin: 10080, reset: NOW + 50 * H } } }, NOW)
  assert.match(quotaLine({ claude, codex }), /^Claude 5 h 60 % · semaine 14 % · épuisé \w{3} \d\d:\d\d \| Codex 5 h \? · semaine 18 %$/)
  assert.equal(quotaPart({ five: null, week: null }), '')
  assert.equal(quotaLine({ claude: { five: null, week: null }, codex: { five: null, week: null } }), 'Claude non lu | Codex non lu')
})

test('usage_scan.mjs quotas: reads the data folder through lib/core/usage.mjs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'usage-q-'))
  writeFileSync(join(dir, 'samples.jsonl'), JSON.stringify({ ts: NOW - H, five_hour: { pct: 33, reset: NOW + H }, seven_day: { pct: 12, reset: NOW + 80 * H } }) + '\n')
  const out = JSON.parse(execFileSync(process.execPath, [join(HERE, '..', 'scanner', 'usage_scan.mjs'), 'quotas', '--data-dir', dir, '--now', String(NOW)], { encoding: 'utf8', env: { ...process.env, MODS_HEALTH: '0' } }))
  assert.equal(out.claude.five.pct, 33)
  assert.equal(out.line, 'Claude 5 h 33 % · semaine 12 % | Codex non lu')
})
