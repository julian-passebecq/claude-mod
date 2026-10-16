// File access shared by cli.mjs and scanner/recover.mjs (Node, standard library). The pane uses $.fs instead.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { deepMerge, expand } from './registry.mjs'

export const MOD_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const env = () => ({ ...process.env, HOME: homedir().replace(/\\/g, '/'), USERPROFILE: homedir().replace(/\\/g, '/') })

export function readJson(p, fallback = undefined) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

/** Config: the mod's file, deep-merged with data_dir/config.json; TESTS_REELS_HOME or --data-dir move data_dir. */
export function loadConfig(dataDirArg) {
  const base = readJson(join(MOD_ROOT, 'tests-reels.config.json'), {})
  const E = env()
  const dataDir = expand(dataDirArg || process.env.TESTS_REELS_HOME || base.data_dir || '~/.claude/tests-reels', E)
  const local = join(dataDir, 'config.json')
  const over = readJson(local, null)
  if (over === null && existsSync(local)) throw new Error(`${local} illisible (JSON invalide) : corrige-le`)
  const cfg = deepMerge(base, over ?? {})
  return { cfg, dataDir, E }
}

export const paths = dataDir => ({
  registry: join(dataDir, 'registry.json'),
  runs: join(dataDir, 'runs.jsonl'),
  recovered: join(dataDir, 'recovered.json'),
  cache: join(dataDir, 'recover-cache.json'),
})

/** Atomic write: temp file then rename. */
export function writeJson(p, obj) {
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8')
  renameSync(tmp, p)
}

export function appendLine(p, obj) {
  mkdirSync(dirname(p), { recursive: true })
  appendFileSync(p, JSON.stringify(obj) + '\n', 'utf8')
}

export const exists = existsSync
