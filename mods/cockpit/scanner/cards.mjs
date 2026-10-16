// cockpit - the data of the summary cards, read with Node from lib/core (the hooks module runs without Node):
//   node scanner/cards.mjs  < {"now": epochMs, "home": "C:/Users/me"}
// lib/core/usage.mjs (5 h / week, run-out, Claude and Codex), veille.mjs (attend Julian, À toi, fil), runner.mjs
// (runner load), estimate.mjs (pipeline ETA when the ci cache has none); the ci mod's pipelines cache and the problemes
// register (read-only) through lib/cards.mjs. Read-only, no API, no model call. Prints one JSON object.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { readQuotas } from '../lib/core/usage.mjs'
import { readVeille } from '../lib/core/veille.mjs'
import { runnerLoad, runnerLine } from '../lib/core/runner.mjs'
import { estimateOf, etaOf } from '../lib/core/estimate.mjs'
import { ciSummary, pipelinesLive, problemsToday } from '../lib/cards.mjs'

const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) } catch { return null } }
const jsonl = (p) => {
  let t = ''
  try { t = readFileSync(p, 'utf8') } catch { return null }
  return t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

/** Every card's data. paths: {usage, veille, afaire, ci, problemes} override the folders under home/.claude (tests). */
export function cardsData(req = {}, paths = {}) {
  const now = Number(req.now) || Date.now()
  const home = String(req.home || homedir()).replace(/\\/g, '/').replace(/\/+$/, '')
  const cl = (rest) => `${home}/.claude/${rest}`
  const quotas = readQuotas(paths.usage || cl('usage-mod'), now)
  const v = readVeille({ veilleHome: paths.veille || cl('veille'), afaireHome: paths.afaire || cl('a-faire'), env: {} })
  const top = v.filWaiting[0]
  const veille = v.available || v.aToiAvailable
    ? { available: v.available, julian: v.julian, open: v.open, aToi: v.aToi, aToiAvailable: v.aToiAvailable, filWaiting: v.filWaiting.length, filTop: top ? top.title || '' : '' }
    : null
  const cache = json(paths.ci || cl('ci-pipelines-cache.json'))
  const runner = runnerLoad(cache, now)
  const lines = jsonl(paths.problemes || cl('problemes/register.jsonl'))
  return {
    at: now, quotas, veille, runner, runnerText: runnerLine(runner),
    ci: ciSummary(cache), pipelines: cache ? pipelinesLive(cache, now, estimateOf, etaOf) : [],
    problemes: lines ? problemsToday(lines, now) : { available: false },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let text = ''
  try { text = readFileSync(0, 'utf8') } catch { /* no stdin */ }
  let req = {}
  try { req = text.trim() ? JSON.parse(text) : {} } catch { req = {} }
  process.stdout.write(JSON.stringify(cardsData(req)))
}
