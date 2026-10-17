// cockpit - the data of « Depuis ton dernier message », read with Node (scanner/cards.mjs part `depuis`). Read-only, no
// model call:
//   last message   Julian's most recent real message in ANY conversation (~/.claude/projects/*/<id>.jsonl, read from the
//                  end, newest file first; lib/depuis.mjs isJulianLine says what counts)
//   conversations  the app's session files (lib/core/sessions.mjs): finished (completed, review_ready) or blocked since,
//                  with the first line of their last assistant message
//   cost           tokens and list-price $ of every transcript line since (main, subagents, Workflow agents), deduped on
//                  message.id + requestId (lib/core/transcripts.mjs), per project
//   merged         gh search prs / glab api merge_requests (read-only), cached prs_ttl_s in effort-board
//   red            the ci mod's pipelines cache: lanes still red
//   problems       the problemes register (new entries), À toi (a-faire items.json), the Veille night summary
import { execFileSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { usageOf, keyOf, costOf, tokensOf, projectOf, lineTs } from '../lib/core/transcripts.mjs'
import { readSessions } from '../lib/core/sessions.mjs'
import { depuisConfig, isJulianLine, parseWhen, resolveSince, stillRed } from '../lib/depuis.mjs'

const slash = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) } catch { return null } }
const text = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const ls = (p) => { try { return readdirSync(p, { withFileTypes: true }) } catch { return [] } }
const tms = (v) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : (Number.isFinite(Date.parse(v)) ? Date.parse(v) : null))

/** Every transcript under projects: {path, mtime, size, main (a conversation's own file), cli}. */
export function transcriptFiles(projectsDir, minMtime = 0) {
  const out = []
  const walk = (d, depth, top) => {
    for (const e of ls(d)) {
      const p = `${d}/${e.name}`
      if (e.isDirectory()) { if (depth < 5) walk(p, depth + 1, false); continue }
      if (!e.isFile() || !e.name.endsWith('.jsonl') || e.name === 'journal.jsonl') continue
      let st
      try { st = statSync(p) } catch { continue }
      if (st.mtimeMs < minMtime) continue
      out.push({ path: p, mtime: st.mtimeMs, size: st.size, main: top, cli: top ? e.name.replace(/\.jsonl$/, '') : '' })
    }
  }
  for (const e of ls(projectsDir)) if (e.isDirectory()) walk(`${projectsDir}/${e.name}`, 1, true)
  return out
}

/**
 * The lines of a file, newest first, read backwards in chunks. visit(line) returns true to stop. Bytes are joined
 * before decoding, so a UTF-8 character cut by a chunk edge is never split.
 */
export function eachLineBackward(path, visit, chunk = 1 << 20) {
  let fd
  try {
    fd = openSync(path, 'r')
    let pos = statSync(path).size
    let tail = Buffer.alloc(0)
    while (pos > 0) {
      const n = Math.min(chunk, pos)
      pos -= n
      const buf = Buffer.alloc(n)
      readSync(fd, buf, 0, n, pos)
      let data = Buffer.concat([buf, tail])
      let end = data.length
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i] !== 10) continue
        const line = data.toString('utf8', i + 1, end).trim()
        end = i
        if (line && visit(line)) return
      }
      tail = data.subarray(0, end)
      data = null
    }
    const first = tail.toString('utf8').trim()
    if (first) visit(first)
  } catch { /* unreadable: nothing */ } finally { if (fd !== undefined) closeSync(fd) }
}

/** Julian's last real message older than `cutoff`: {ts, cli, cwd, project} or null. */
export function lastJulianMessage(files, cutoff, minTs) {
  let best = null
  const mains = files.filter((f) => f.main && f.mtime >= minTs).sort((a, b) => b.mtime - a.mtime)
  for (const f of mains) {
    if (best && f.mtime < best.ts) break // nothing in an older file can be newer
    eachLineBackward(f.path, (line) => {
      if (!line.includes('"type":"user"')) return false
      const ts = lineTs(line)
      if (!ts || ts > cutoff) return false
      if (ts < minTs || (best && ts <= best.ts)) return true
      let o
      try { o = JSON.parse(line) } catch { return false }
      if (!isJulianLine(o)) return false
      best = { ts, cli: f.cli, cwd: o.cwd || '', project: projectOf(o.cwd) }
      return true
    })
  }
  return best
}

/** First non-empty line of a conversation's last assistant text. */
export function lastAssistantLine(path) {
  let out = ''
  eachLineBackward(path, (line) => {
    if (!line.includes('"type":"assistant"') || !line.includes('"text"')) return false
    let o
    try { o = JSON.parse(line) } catch { return false }
    if (o.type !== 'assistant' || o.isSidechain) return false
    const c = o.message && o.message.content
    const t = Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : typeof c === 'string' ? c : ''
    const first = String(t).split(/\r?\n/).map((l) => l.replace(/^[#>*\s-]+/, '').trim()).find(Boolean)
    if (!first) return false
    out = first.slice(0, 240)
    return true
  }, 1 << 18)
  return out
}

/** Tokens and list-price $ since `since`, total and per project. Newest line of a response wins (it is the complete one). */
export function costSince(files, since, prices) {
  const seen = new Set()
  const total = { usd: 0, tokens: 0 }
  const byProject = {}
  for (const f of files) {
    if (f.mtime < since) continue
    eachLineBackward(f.path, (line) => {
      const ts = lineTs(line)
      if (ts && ts < since) return true
      if (!line.includes('"usage"')) return false
      let o
      try { o = JSON.parse(line) } catch { return false }
      const r = usageOf(o)
      if (!r || r.ts < since || seen.has(r.key)) return false
      seen.add(r.key)
      const usd = costOf(r.v, r.model, prices)
      const tok = tokensOf(r.v)
      total.usd += usd
      total.tokens += tok
      const p = projectOf(r.cwd)
      const row = (byProject[p] ||= { usd: 0, tokens: 0 })
      row.usd += usd
      row.tokens += tok
      return false
    }, 4 << 20)
  }
  return { ...total, byProject }
}

// ---- PRs / MRs merged (gh, glab: read-only, cached) ----------------------------------------------------------------

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 << 20 })
}

/** forge slug (owner/name, group/path) -> project folder name, from the ci mod's apps. */
export function slugMap(ciCache) {
  const m = {}
  for (const a of (ciCache && ciCache.apps) || []) {
    const folder = slash(a.path).split('/').pop()
    if (!folder) continue
    if (a.github) m[String(a.github).toLowerCase()] = folder
    for (const g of a.gitlab || []) m[String(g).replace(/^[^/]*gitlab[^/]*\//, '').toLowerCase()] = folder
  }
  return m
}

export function fetchMerged(since, c, map, cachePath, now) {
  const cache = cachePath ? json(cachePath) : null
  if (cache && cache.v === 1 && now - (cache.at || 0) < c.prs_ttl_s * 1000 && (cache.since || Infinity) <= since) {
    return { merged: (cache.merged || []).filter((p) => (tms(p.at) || 0) >= since), errors: cache.errors || [], cached: true }
  }
  const merged = []
  const errors = []
  const iso = new Date(since).toISOString().replace(/\.\d{3}Z$/, 'Z')
  if (c.gh) {
    try {
      const rows = JSON.parse(run('gh', ['search', 'prs', '--author', '@me', '--merged-at', `>=${iso}`, '--json', 'number,title,url,repository,closedAt', '--limit', String(c.prs_limit)]) || '[]')
      for (const r of rows) {
        const slug = (r.repository && r.repository.nameWithOwner) || ''
        merged.push({ forge: 'github', repo: (r.repository && r.repository.name) || slug.split('/').pop(), project: map[slug.toLowerCase()] || slug.split('/').pop(), number: r.number, title: r.title || '', url: r.url || '', at: r.closedAt })
      }
    } catch (err) { errors.push(`gh : ${String((err && (err.code === 'ENOENT' ? 'absent' : err.stderr || err.message)) || err).trim().split('\n')[0].slice(0, 100)}`) }
  }
  if (c.glab) {
    try {
      const rows = JSON.parse(run('glab', ['api', `merge_requests?scope=created_by_me&state=merged&updated_after=${iso}&per_page=${Math.min(100, c.prs_limit)}`]) || '[]')
      for (const r of Array.isArray(rows) ? rows : []) {
        if ((tms(r.merged_at) || 0) < since) continue
        const full = String((r.references && r.references.full) || '')
        const slug = full.replace(/!\d+$/, '')
        merged.push({ forge: 'gitlab', repo: slug.split('/').pop(), project: map[slug.toLowerCase()] || slug.split('/').pop(), number: r.iid, title: r.title || '', url: r.web_url || '', at: r.merged_at })
      }
    } catch (err) { errors.push(`glab : ${String((err && (err.code === 'ENOENT' ? 'absent' : err.stderr || err.message)) || err).trim().split('\n')[0].slice(0, 100)}`) }
  }
  if (cachePath && (c.gh || c.glab)) {
    try { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, JSON.stringify({ v: 1, at: now, since, merged, errors })) } catch { /* no cache */ }
  }
  return { merged, errors, cached: false }
}

// ---- Problèmes, À toi, Veille ----------------------------------------------------------------------------------------

/** Entries added to the problemes register since, with their latest status. */
export function problemsSince(text, since) {
  const map = new Map()
  for (const l of String(text || '').split('\n')) {
    if (!l.trim()) continue
    let o
    try { o = JSON.parse(l) } catch { continue }
    if (!o || !o.id) continue
    if (o.op === 'add' && !map.has(o.id)) map.set(o.id, { id: o.id, title: o.title || o.id, status: o.status || 'ouvert', at: tms(o.first_seen) || tms(o.at) || 0, project: o.app || '' })
    else if (o.op === 'update' && map.has(o.id) && o.fields && o.fields.status) map.get(o.id).status = o.fields.status
  }
  return [...map.values()].filter((p) => p.at >= since)
}

// ---- the part ----------------------------------------------------------------------------------------------------------

/**
 * req: {now, home, preset, cfg, cache}. paths (tests): {projects, appDir, ci, problemes, afaire, veille, prices, prsCache}.
 */
export function depuisData(req = {}, paths = {}) {
  const now = Number(req.now) || Date.now()
  const home = slash(req.home || homedir())
  const cl = (rest) => `${home}/.claude/${rest}`
  const c = depuisConfig(req.cfg)
  const projectsDir = slash(paths.projects || cl('projects'))
  const minTs = now - c.lookback_days * 86400000
  const files = transcriptFiles(projectsDir, minTs)
  const last = lastJulianMessage(files, now - c.skip_recent_min * 60000, minTs)
  let sessions = []
  try { sessions = readSessions(paths.appDir ? { app_dir: paths.appDir } : {}) } catch { sessions = [] }
  const byCli = new Map(sessions.map((s) => [s.cli, s]))
  if (last) last.title = (byCli.get(last.cli) || {}).title || ''
  const preset = parseWhen(req.preset || '', req.cfg)
  const w = resolveSince(preset, now, last, req.cfg)
  const since = w.since

  const fileOf = new Map(files.filter((f) => f.main).map((f) => [f.cli, f]))
  const conversations = []
  for (const s of sessions) {
    if ((s.last_activity || 0) < since || !['completed', 'review_ready', 'blocked'].includes(s.status_category)) continue
    const f = fileOf.get(s.cli)
    conversations.push({ cli: s.cli, sid: s.sid, title: s.title, project: s.repo, state: s.status_category, at: s.last_activity,
      first: f ? lastAssistantLine(f.path) : (s.status_detail || '') })
  }

  const ciCache = json(paths.ci || cl('ci-pipelines-cache.json'))
  const prices = json(paths.prices || new URL('../lib/core/prices.json', import.meta.url)) || {}
  const prs = (c.gh || c.glab || paths.prsCache) ? fetchMerged(since, c, slugMap(ciCache), paths.prsCache || req.cache || '', now) : { merged: [], errors: [] }
  const items = json(`${slash(paths.afaire || cl('a-faire'))}/items.json`)
  const night = json(`${slash(paths.veille || cl('veille'))}/night-summary.json`)
  return {
    since, source: w.source, label: w.label, last,
    merged: prs.merged, prsErrors: prs.errors, prsCached: Boolean(prs.cached),
    red: stillRed(ciCache, since, c.red_branches),
    conversations,
    problems: problemsSince(text(paths.problemes || cl('problemes/register.jsonl')), since),
    atoi: { items: ((items && items.open) || []).map((i) => ({ id: i.id, title: i.title || '', since: Number(i.since) || 0, due: Number(i.due) || null, dueDay: i.dueDay || '', project: i.project || '' })) },
    cost: costSince(files, since, prices),
    night: night && ((night.until || night.generated || 0) >= since) ? { lines: night.lines || [] } : null,
  }
}
