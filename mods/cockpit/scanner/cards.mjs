// cockpit - the data of the cards and of the decision screens, read with Node (the hooks module runs without Node):
//   node scanner/cards.mjs  < {"now": epochMs, "home": "C:/Users/me", "parts": ["cards"|"nuit"|"relais"|"galerie"],
//                              "repos": ["D:/x/repo", …], "cache": "<file for the Codex rollout offsets>", "cfg": {…}}
// cards: lib/core/usage.mjs (5 h / week, run-out, Claude and Codex), veille.mjs (attend Julian, À toi, fil), runner.mjs,
//   estimate.mjs (pipeline ETA when the ci cache has none); the ci pipelines cache and the problemes register through
//   lib/cards.mjs; the « Claude Control » to-dos (~/.claude/a-faire/claude-control.md).
// nuit: each repo's handoff/ROADMAP.md and packet files (names and first heading only) for « Prêt à lancer ».
// relais: the ci mod's Claude <-> Codex dataset (~/.claude/ci-cache/interactions.json).
// galerie: counts of the control layers under ~/.claude (names only, never values), Codex tokens per model (the usage
//   mod's codex.json) and approval policy / approval requests from ~/.codex/sessions rollouts (offsets cached).
// Read-only, no API, no model call. Prints one JSON object.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readQuotas } from '../lib/core/usage.mjs'
import { readVeille } from '../lib/core/veille.mjs'
import { runnerLoad, runnerLine } from '../lib/core/runner.mjs'
import { estimateOf, etaOf } from '../lib/core/estimate.mjs'
import { ciSummary, pipelinesLive, problemsToday } from '../lib/cards.mjs'
import { parseTodos, controleCard, decideConfig } from '../lib/decide.mjs'

const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) } catch { return null } }
const text = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const jsonl = (p) => {
  const t = text(p)
  if (t === null) return null
  return t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
const ls = (p) => { try { return readdirSync(p, { withFileTypes: true }) } catch { return [] } }
const slash = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
const expand = (p, home) => slash(String(p || '').replace(/^~(?=[\\/]|$)/, home))

/** The home cards. paths: {usage, veille, afaire, ci, problemes, controle} override the folders under home/.claude (tests). */
export function cardsData(req = {}, paths = {}) {
  const now = Number(req.now) || Date.now()
  const home = slash(req.home || homedir())
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
  const todoText = text(paths.controle || expand(decideConfig(req.cfg).controle.file, home))
  return {
    at: now, quotas, veille, runner, runnerText: runnerLine(runner),
    ci: ciSummary(cache), ciBy: { all: ciSummary(cache, 'all'), claude: ciSummary(cache, 'claude'), codex: ciSummary(cache, 'codex') },
    pipelines: cache ? pipelinesLive(cache, now, estimateOf, etaOf) : [],
    problemes: lines ? problemsToday(lines, now) : { available: false },
    controle: controleCard(todoText === null ? null : parseTodos(todoText, now), req.cfg),
  }
}

/** The repo root of a working folder: a worktree under <repo>/.claude/worktrees/<x> counts as <repo>. */
export const repoRoot = (cwd) => slash(cwd).replace(/\/\.claude\/worktrees\/[^/]+.*$/, '')

const firstHeading = (t) => {
  const m = /^#{1,6}\s+(.+)$/m.exec(String(t || ''))
  return m ? m[1].trim().slice(0, 120) : ''
}

/** Each repo's ROADMAP.md and packet files (file name and first heading). */
export function nuitData(req = {}) {
  const c = decideConfig(req.cfg).nuit
  let packetRx = null
  try { packetRx = new RegExp(c.packet_match, 'i') } catch { packetRx = null }
  const seen = new Set()
  const repos = []
  for (const raw of req.repos || []) {
    const path = repoRoot(raw)
    if (!path || seen.has(path.toLowerCase())) continue
    seen.add(path.toLowerCase())
    const roadmap = text(`${path}/handoff/ROADMAP.md`)
    const packets = []
    for (const d of c.packet_dirs || []) {
      for (const e of ls(`${path}/${d}`)) {
        if (!e.isFile() || !/\.md$/i.test(e.name)) continue
        if (d === 'handoff' && !(packetRx && packetRx.test(e.name))) continue
        packets.push({ file: `${d}/${e.name}`, title: firstHeading(text(`${path}/${d}/${e.name}`)) || e.name })
      }
    }
    if (roadmap !== null || packets.length) repos.push({ repo: path.split('/').pop(), path, roadmap, packets })
  }
  return { repos }
}

/** The ci mod's dataset, as is (the pure view slims it). */
export function relaisData(req = {}, paths = {}) {
  const home = slash(req.home || homedir())
  return { interactions: json(paths.relais || `${home}/.claude/ci-cache/interactions.json`) }
}

// Approval policy per Codex session and approval requests, from rollout files of the last `days` days. Each file is
// read from the offset where the last pass stopped; only lines with « approval » in them are parsed.
function codexApprovals(sessionsDir, days, now, cachePath) {
  const cache = (cachePath && json(cachePath)) || { v: 1, files: {} }
  if (cache.v !== 1) { cache.v = 1; cache.files = {} }
  const since = now - days * 86400000
  const keep = {}
  const out = { policies: {}, requests: 0, sessions: 0 }
  for (let i = 0; i < days + 1; i++) {
    const d = new Date(now - i * 86400000)
    const dir = `${sessionsDir}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    for (const e of ls(dir)) {
      if (!e.isFile() || !/^rollout-.*\.jsonl$/.test(e.name)) continue
      const f = `${dir}/${e.name}`
      let st
      try { st = statSync(f) } catch { continue }
      if (st.mtimeMs < since) continue
      const ent = cache.files[f] && cache.files[f].off <= st.size ? cache.files[f] : { off: 0, policy: null, requests: 0 }
      if (st.size > ent.off) {
        let fd
        try {
          fd = openSync(f, 'r')
          const buf = Buffer.alloc(1 << 20)
          let pos = ent.off
          let rest = ''
          while (pos < st.size) {
            const n = readSync(fd, buf, 0, Math.min(buf.length, st.size - pos), pos)
            if (n <= 0) break
            pos += n
            const chunk = rest + buf.toString('utf8', 0, n)
            const cut = chunk.lastIndexOf('\n')
            const body = cut >= 0 ? chunk.slice(0, cut) : ''
            rest = cut >= 0 ? chunk.slice(cut + 1) : chunk
            for (const line of body.split('\n')) {
              if (line.indexOf('approval') < 0) continue
              const m = /"approval_policy":"([a-z-]+)"/.exec(line)
              if (m && !ent.policy) ent.policy = m[1]
              if (/"type":"[a-z_]*approval_request"/.test(line)) ent.requests += 1
            }
          }
          ent.off = pos - Buffer.byteLength(rest)
        } catch { /* unreadable: counted as nothing */ } finally { if (fd !== undefined) closeSync(fd) }
      }
      keep[f] = ent
      out.sessions += 1
      out.requests += ent.requests
      if (ent.policy) out.policies[ent.policy] = (out.policies[ent.policy] || 0) + 1
    }
  }
  if (cachePath) {
    try { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, JSON.stringify({ v: 1, files: keep })) } catch { /* no cache */ }
  }
  return out
}

/** Control layers (names and counts only) and Codex approvals + tokens. */
export function galerieData(req = {}, paths = {}) {
  const now = Number(req.now) || Date.now()
  const home = slash(req.home || homedir())
  const ch = paths.claude || `${home}/.claude`
  const settings = json(`${ch}/settings.json`)
  const env = (settings && settings.env) || {}
  const dirs = String(env.CLAUDE_CODE_PLUGIN_DIRS || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean)
  const hooks = settings && settings.hooks ? Object.values(settings.hooks).reduce((a, list) => a + (Array.isArray(list) ? list.reduce((b, m) => b + ((m && m.hooks) || []).length, 0) : 0), 0) : 0
  let memory = 0
  for (const p of ls(`${ch}/projects`)) if (p.isDirectory()) memory += ls(`${ch}/projects/${p.name}/memory`).filter((e) => e.isFile() && /\.md$/i.test(e.name)).length
  const rules = text(`${ch}/CLAUDE.md`)
  const map = {
    rules: rules === null ? null : { title: firstHeading(rules) },
    settings: settings ? { env: Object.keys(env).length, hooks, mode: (settings.permissions && settings.permissions.defaultMode) || '' } : null,
    agents: existsSync(`${ch}/agents`) ? ls(`${ch}/agents`).filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name.replace(/\.md$/i, '')) : null,
    skills: existsSync(`${ch}/skills`) ? ls(`${ch}/skills`).filter((e) => e.isDirectory()).map((e) => e.name) : null,
    workflows: existsSync(`${ch}/workflows`) ? ls(`${ch}/workflows`).filter((e) => e.isFile()).map((e) => e.name.replace(/\.[a-z]+$/i, '')) : null,
    mods: dirs.length,
    memory,
  }
  const days = decideConfig(req.cfg).galerie.codex_days
  const cx = json(paths.codexJson || `${ch}/usage-mod/codex.json`)
  const sessionsDir = slash(paths.codexSessions || req.codexSessions || `${home}/.codex/sessions`)
  let codex = { available: false }
  if ((cx && cx.available) || existsSync(sessionsDir)) {
    const byModel = {}
    for (let i = 0; i < days; i++) {
      const d = new Date(now - i * 86400000)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      for (const [m, v] of Object.entries((cx && cx.days && cx.days[key]) || {})) {
        const row = (byModel[m] ||= [0, 0, 0, 0, 0])
        for (let k = 0; k < 5; k++) row[k] += v[k] || 0
      }
    }
    codex = { available: true, days, byModel, approvals: existsSync(sessionsDir) ? codexApprovals(sessionsDir, days, now, req.cache || '') : { policies: {}, requests: 0, sessions: 0 } }
  }
  return { map, codex }
}

export function scan(req = {}, paths = {}) {
  const parts = Array.isArray(req.parts) && req.parts.length ? req.parts : ['cards']
  const out = { at: Number(req.now) || Date.now() }
  if (parts.includes('cards')) Object.assign(out, cardsData(req, paths))
  if (parts.includes('nuit')) out.nuit = nuitData(req)
  if (parts.includes('relais')) out.relais = relaisData(req, paths)
  if (parts.includes('galerie')) out.galerie = galerieData(req, paths)
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let t = ''
  try { t = readFileSync(0, 'utf8') } catch { /* no stdin */ }
  let req = {}
  try { req = t.trim() ? JSON.parse(t) : {} } catch { req = {} }
  process.stdout.write(JSON.stringify(scan(req)))
}
