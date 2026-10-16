#!/usr/bin/env node
// tests-reels CLI: lets an agent or Julian record real (non-CI) tests in the local registry (~/.claude/tests-reels).
// Never accepts a secret value: a value that reads like a password, token, key or cookie is refused (exit 2).
//
//   node mods/tests-reels/cli.mjs add app --name <appli> [--repo <dépôt>] [--notes <texte>]
//   node mods/tests-reels/cli.mjs add env --app <appli> --name <env> --kind tenant|cloud|local|docker
//        [--url <url>]... [--id <clé>=<valeur>]... [--owner <qui>] [--status <état>] [--notes <texte>]
//   node mods/tests-reels/cli.mjs add account --app <appli> --env <env> --login <compte> [--display <nom>]
//        [--purpose <usage>] [--secret-store wincred|password-manager|env|other] [--secret-target <cible>]
//   node mods/tests-reels/cli.mjs add procedure --app <appli> --name <nom> [--env <env>] [--account <compte>]
//        [--kind live|local|docker|ui|manual] [--step <texte>]... [--command <cmd>]... [--expected <texte>] [--evidence <chemin>]...
//   node mods/tests-reels/cli.mjs add check --app <appli> --what <quoi> [--how <comment>] [--date <AAAA-MM-JJ>]
//   node mods/tests-reels/cli.mjs run-log --app <appli> --env <env> --procedure <nom> --result pass|fail|partial
//        [--evidence <chemin>]... [--note <texte>] [--session <id ou titre>] [--by <agent>]
//   node mods/tests-reels/cli.mjs show [--app <appli>]          counts and masked logins, never a secret
//   node mods/tests-reels/cli.mjs recover [--force]             runs scanner/recover.mjs
// Options: --data-dir <dossier> (or TESTS_REELS_HOME) to use another registry folder.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { addAccount, addCheck, addEnv, addProcedure, appSummary, buildView, ensureApp, mask, parseRuns, runRecord } from './lib/registry.mjs'
import { assertNoSecret } from './lib/secrets.mjs'
import { MOD_ROOT, appendLine, loadConfig, paths, readJson, writeJson } from './lib/io.mjs'

const MULTI = new Set(['url', 'id', 'step', 'command', 'evidence'])

/** --key value pairs; repeated MULTI keys become lists; --id k=v becomes an object. */
export function parseArgs(args) {
  const o = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) {
      o._.push(a)
      continue
    }
    const k = a.slice(2)
    const v = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : true
    if (MULTI.has(k)) (o[k] ??= []).push(v)
    else o[k] = v
  }
  return o
}

const camel = o => {
  const out = {}
  for (const [k, v] of Object.entries(o)) out[k.replace(/-/g, '_')] = v
  return out
}

function ids(list) {
  if (!list) return undefined
  const out = {}
  for (const kv of list) {
    const i = String(kv).indexOf('=')
    if (i < 1) throw new Error(`--id attend clé=valeur : ${kv}`)
    out[kv.slice(0, i)] = kv.slice(i + 1)
  }
  return out
}

export function main(args, out = s => process.stdout.write(s + '\n')) {
  const o = camel(parseArgs(args))
  const [cmd, what] = o._
  // refuse any secret-looking value before anything is written; option names like --password are refused too
  for (const k of Object.keys(o)) if (/^(pass(word)?|pwd|secret|token|api_key|apikey|cookie|key)$/i.test(k)) throw Object.assign(new Error(`refusé : --${k}. Le registre ne garde jamais de secret ; range-le dans le Gestionnaire d'identification Windows et passe --secret-store wincred --secret-target <cible>.`), { code: 2 })
  try {
    assertNoSecret({ ...o, _: undefined })
  } catch (err) {
    throw Object.assign(err, { code: 2 })
  }
  const { cfg, dataDir } = loadConfig(o.data_dir)
  const P = paths(dataDir)
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  if (cmd === 'add') {
    const reg = readJson(P.registry, { version: 1, apps: [] })
    let r
    if (what === 'app') r = ensureApp(reg, o.name, { repo: o.repo, notes: o.notes })
    else if (what === 'env') r = addEnv(reg, { ...o, urls: o.url, ids: ids(o.id) }, today)
    else if (what === 'account') r = addAccount(reg, o)
    else if (what === 'procedure') r = addProcedure(reg, { ...o, steps: o.step, commands: o.command, evidence: o.evidence })
    else if (what === 'check') r = addCheck(reg, o, today)
    else throw new Error('add : app | env | account | procedure | check')
    assertNoSecret(reg)
    reg.updated = now.toISOString()
    writeJson(P.registry, reg)
    out(`ajouté (${what}) : ${o.name || o.login || o.display || o.what || o.app} → ${P.registry}`)
    return 0
  }
  if (cmd === 'run-log') {
    const rec = runRecord(o, now.toISOString())
    assertNoSecret(rec)
    appendLine(P.runs, rec)
    out(`essai noté : ${rec.app} · ${rec.procedure} · ${rec.result} → ${P.runs}`)
    return 0
  }
  if (cmd === 'show') {
    let runs = []
    try {
      runs = parseRuns(readFileSync(P.runs, 'utf8'))
    } catch {}
    const v = buildView(readJson(P.registry, { apps: [] }), runs, readJson(P.recovered, null), cfg)
    const L = cfg.labels ?? {}
    const t = v.totals
    out(`${t.apps} appli(s) · ${t.environments} env. · ${t.accounts} compte(s) · ${t.procedures} procédure(s) · ${t.runs} essai(s) · ${t.never} jamais testée(s) en réel · ${t.todo} à ranger`)
    for (const a of v.apps.filter(x => !o.app || x.name.toLowerCase() === String(o.app).toLowerCase())) {
      out(`- ${a.name} : ${appSummary(a, L)}`)
      if (o.app) for (const ac of a.accounts) out(`    compte ${mask(ac.login || ac.display)} · ${ac.secret_ref?.target ? `secret : ${ac.secret_ref.store} · ${ac.secret_ref.target}` : 'secret non enregistré'}`)
    }
    return 0
  }
  if (cmd === 'recover') {
    const r = spawnSync(process.execPath, [join(MOD_ROOT, 'scanner', 'recover.mjs'), ...(o.force ? ['--force'] : []), ...(o.data_dir ? ['--data-dir', o.data_dir] : [])], { stdio: 'inherit' })
    return r.status ?? 1
  }
  out(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'))
  return cmd ? 1 : 0
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`tests-reels : ${err.message}\n`)
    process.exitCode = err.code ?? 1
  }
}
