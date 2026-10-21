// band mod: what runs in THIS conversation (Workflows, their agents, Agent-tool agents), for the Jauge's « en cours »
// rows. Thin wrapper over lib/core/running.mjs (this mod's synced copy) with a small cache file; ETA from past runs of
// the same Workflow on this PC (lib/core/estimate.mjs, at least jauge.en_cours.min_samples of them, else none).
//   node encours.mjs < request.json     request: { projects_root, cache_file, session, now?, cfg }
// Read-only on the transcripts; writes only its cache file. Prints {dir, workflows, agents, now} as JSON.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { newRunningState, readRunning } from '../lib/core/running.mjs'
import { estimateOf, etaOf } from '../lib/core/estimate.mjs'
import { familyOf } from '../lib/core/transcripts.mjs'

/** The rows' data for one request; `state` is the cache (newRunningState()). Pure apart from reading transcripts. */
export function enCours(req, state) {
  const ec = req.cfg?.jauge?.en_cours ?? {}
  const now = Number(req.now) || Date.now()
  const r = readRunning({ root: req.projects_root, session: req.session, now, state, cfg: ec })
  const fam = (m) => (m ? familyOf(m) : '')
  return {
    now,
    dir: r.dir,
    workflows: r.workflows.map(({ hist, ...w }) => {
      const est = estimateOf(hist || [], { min: ec.min_samples ?? 3 })
      const eta = w.status === 'running' ? etaOf(est, w.start, now) : null
      return { ...w, agents: w.agents.map((a) => ({ ...a, model: fam(a.model) })), ...(eta ? { eta: Math.round(eta.mid), overrun: eta.overrun } : {}) }
    }),
    agents: r.agents.map((a) => ({ ...a, model: fam(a.model) })),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const req = JSON.parse(readFileSync(0, 'utf8') || '{}')
    let state = newRunningState()
    try {
      const c = JSON.parse(readFileSync(req.cache_file, 'utf8'))
      if (c?.v === 1) state = c
    } catch { /* first run */ }
    const out = enCours(req, state)
    try {
      mkdirSync(dirname(req.cache_file), { recursive: true })
      writeFileSync(req.cache_file + '.tmp', JSON.stringify(state))
      renameSync(req.cache_file + '.tmp', req.cache_file)
    } catch { /* cache is optional */ }
    process.stdout.write(JSON.stringify(out))
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: String(err?.message ?? err).slice(0, 300), workflows: [], agents: [] }))
    process.exitCode = 1
  }
}
