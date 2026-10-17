// export-eta - « Exporter tout » (/export-tout): one dated snapshot of everything an AI analyst needs to understand the
// state of Julian's Claude setup, written for the eta repo under sources/claude-control/snapshots/<YYYY-MM-DD-HHMM>/.
// Read-only on this PC: it reads files other mods already wrote (veille, a-faire, problemes, usage, ci, tests-reels,
// mods-health, effort-board) plus the rules, renders Markdown (and a few compact JSON files), masks every file with
// lib/mask.mjs and holds back what it cannot mask. No model call, no network. Never reads credentials: only the files
// named below, and `forbidden()` refuses smtp.json, .credentials.json, auth.json, *.pem, *.key and friends anywhere.
// Each section is independent: a missing or broken source gives a short « indisponible » file, never a failed export.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { check, mask } from './mask.mjs'
import { estimateOf, etaOf } from './core/estimate.mjs'
import { splitDirs } from './core/mods.mjs'
import { readQuotas } from './core/usage.mjs'
import { readRunner } from './core/runner.mjs'
import { readVeille } from './core/veille.mjs'

const HOUR = 3600000
const DAY = 24 * HOUR

// ---- small helpers --------------------------------------------------------------------------------------------------

export const FORBIDDEN = /(?:^|[\\/])(?:smtp\.json|\.credentials\.json|credentials\.json|auth\.json|\.netrc|\.npmrc|\.pypirc|id_rsa[^\\/]*|id_ed25519[^\\/]*|[^\\/]*\.(?:pem|key|pfx|p12|kdbx))$/i

/** True for a file this exporter must never read, whatever the config says. */
export const forbidden = (p) => FORBIDDEN.test(String(p || ''))

const home = (p, h = os.homedir()) => String(p || '').replace(/^~(?=$|[\\/])/, h).replace(/%([A-Z_]+)%/gi, (m, k) => process.env[k] ?? m)

export function readJsonSafe(p, d = null) {
  if (!p || forbidden(p)) return d
  try { return JSON.parse(fs.readFileSync(home(p), 'utf8').replace(/^﻿/, '')) } catch { return d }
}

export function readTextSafe(p, d = '') {
  if (!p || forbidden(p)) return d
  try { return fs.readFileSync(home(p), 'utf8').replace(/^﻿/, '') } catch { return d }
}

const p2 = (x) => String(x).padStart(2, '0')

/** Local date-time stamp: { day: 2026-10-17, hm: 1450, folder: 2026-10-17-1450, iso }. */
export function snapStamp(ms) {
  const d = new Date(ms)
  const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  const hm = `${p2(d.getHours())}${p2(d.getMinutes())}`
  return { day, hm, folder: `${day}-${hm}`, iso: d.toISOString() }
}

export function when(ms) {
  if (!ms) return '—'
  const d = new Date(Number(ms))
  if (Number.isNaN(d.getTime())) return String(ms)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

export function ago(ms, nowMs) {
  if (!ms) return '—'
  const s = Math.max(0, Math.round((nowMs - Number(ms)) / 1000))
  if (s < 90) return `${s} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  if (s < 2 * 86400) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} j`
}

const toMs = (v) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || 0)
const cell = (v) => String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
const cut = (s, n = 160) => { const t = String(s ?? '').replace(/\r?\n/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

/** Markdown table; rows are arrays of cells. */
export function table(head, rows) {
  if (!rows.length) return '_aucune ligne_\n'
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n') + '\n'
}

export const fmtTok = (n) => {
  const v = Number(n) || 0
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} G`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} k`
  return String(Math.round(v))
}

const unavailable = (what, why) => `_${what} indisponible : ${why}._\n`

// ---- sections -------------------------------------------------------------------------------------------------------
// Each returns [{ path, content, what, how, look }] (path relative to the snapshot folder).

/** Sessions of the desktop app with their state (live, ongoing, finished, old), PRs and parent. */
export function sessionsSection(sessions, nowMs, T = {}) {
  const hours = T.sessions_hours ?? 48
  const recent = sessions.filter((s) => s.state === 'live' || s.state === 'ongoing' || nowMs - (s.last_activity || 0) <= hours * HOUR)
  const order = { live: 0, ongoing: 1, finished: 2, old: 3 }
  recent.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || (b.last_activity || 0) - (a.last_activity || 0))
  const count = (st) => recent.filter((s) => s.state === st).length
  const prs = (s) => (s.prs || []).map((p) => `${p.repo ? p.repo.split('/').pop() : ''}#${p.number || '?'} ${p.state || ''}`.trim()).join(', ')
  const md = [
    '# Conversations : état au moment de l’export', '',
    `${recent.length} conversation(s) actives ou touchées dans les ${hours} dernières heures : ${count('live')} active(s) maintenant (transcript écrit il y a moins de 3 min), ${count('ongoing')} en cours, ${count('finished')} terminée(s), ${count('old')} ancienne(s).`, '',
    table(['État', 'Projet', 'Conversation', 'Modèle · effort', 'Dernière activité', 'Branche', 'PR', 'Lancée par', 'Résumé de fin de tour'],
      recent.map((s) => [s.state_label || s.state, s.project, `${cut(s.title || '(sans titre)', 80)} \`${String(s.cli).slice(0, 8)}\``, `${s.model || '?'} · ${s.effort || '?'}`, `${when(s.last_activity)} (il y a ${ago(s.last_activity, nowMs)})`, cut(s.branch, 50), prs(s), cut(s.parent_title, 40), cut(`${s.status_category || ''} ${s.status_detail || ''}`, 160)])),
  ].join('\n')
  const json = recent.map((s) => ({ id: s.cli, title: s.title, project: s.project, state: s.state, model: s.model, effort: s.effort, created: s.created, last_activity: s.last_activity, branch: s.branch, parent_title: s.parent_title || '', children: (s.children || []).length, status_category: s.status_category, status_detail: s.status_detail, prs: s.prs || [] }))
  return [
    { path: 'status/sessions.md', content: md, what: 'Toutes les conversations Claude Code actives, en cours ou touchées récemment, avec leur état, modèle, branche, PR et le résumé de fin de tour de l’app.', how: 'Une ligne par conversation, les actives d’abord. Lancée par = conversation parente (spawnedFrom).', look: 'Conversations en cours sans activité depuis longtemps (bloquées), PR ouvertes non mergées, résumés « blocked » ou « needs input », modèles/effort contraires aux règles.' },
    { path: 'status/sessions.json', content: JSON.stringify({ generated: nowMs, sessions: json }, null, 1), what: 'Les mêmes conversations en JSON (champs bruts, dates en ms epoch).', how: 'Pour filtrer ou compter par programme.', look: '—' },
  ]
}

/** Workflow runs (subagents/workflows/wf_*) touched in the last hours: agents, phases, which still run. */
export function scanWorkflows(projectsDir, nowMs, T = {}) {
  const hours = T.workflows_hours ?? 24
  const out = []
  let projects = []
  try { projects = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()) } catch { return out }
  for (const p of projects) {
    const pdir = path.join(projectsDir, p.name)
    let sessions = []
    try { sessions = fs.readdirSync(pdir, { withFileTypes: true }).filter((d) => d.isDirectory()) } catch { continue }
    for (const s of sessions) {
      const wdir = path.join(pdir, s.name, 'subagents', 'workflows')
      let wfs = []
      try { wfs = fs.readdirSync(wdir, { withFileTypes: true }).filter((d) => d.isDirectory()) } catch { continue }
      for (const w of wfs) {
        const dir = path.join(wdir, w.name)
        const journal = path.join(dir, 'journal.jsonl')
        let mtime = 0
        try { mtime = fs.statSync(journal).mtimeMs } catch { continue }
        const files = (() => { try { return fs.readdirSync(dir) } catch { return [] } })()
        let last = mtime
        let first = mtime
        const agentTimes = {}
        for (const f of files) {
          if (!f.startsWith('agent-')) continue
          try {
            const st = fs.statSync(path.join(dir, f))
            const id = f.replace(/^agent-/, '').replace(/\.jsonl$/, '').replace(/\.meta\.json$/, '')
            const t = agentTimes[id] = agentTimes[id] || { first: st.birthtimeMs || st.mtimeMs, last: st.mtimeMs }
            t.first = Math.min(t.first, st.birthtimeMs || st.mtimeMs)
            t.last = Math.max(t.last, st.mtimeMs)
            last = Math.max(last, st.mtimeMs)
            first = Math.min(first, st.birthtimeMs || st.mtimeMs)
          } catch { /* gone */ }
        }
        if (nowMs - last > hours * HOUR) continue
        const agents = {}
        const order = []
        for (const l of readTextSafe(journal).split('\n')) {
          if (!l.trim()) continue
          let j
          try { j = JSON.parse(l) } catch { continue }
          if (j.type === 'started' && j.agentId) {
            if (!agents[j.agentId]) order.push(j.agentId)
            agents[j.agentId] = { id: j.agentId, label: j.label || '', phase: j.phase || '', end: null }
          } else if ((j.type === 'result' || j.type === 'failed') && j.agentId) {
            const a = agents[j.agentId] = agents[j.agentId] || { id: j.agentId, label: '', phase: '', end: null }
            if (!order.includes(j.agentId)) order.push(j.agentId)
            a.end = j.type === 'result' ? 'done' : 'failed'
          }
        }
        const list = order.map((id) => ({ ...agents[id], ...(agentTimes[id] || {}) }))
        const running = list.filter((a) => !a.end)
        const active = running.length > 0 && nowMs - last <= (T.active_min ?? 30) * 60000
        out.push({ id: w.name, session: s.name, project_dir: p.name, first, last, active, agents: list, running: running.length, done: list.filter((a) => a.end === 'done').length, failed: list.filter((a) => a.end === 'failed').length })
      }
    }
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || b.last - a.last)
}

export function workflowsSection(wfs, sessions, nowMs, T = {}) {
  const byCli = new Map(sessions.map((s) => [s.cli, s]))
  const name = (w) => { const s = byCli.get(w.session); return s ? `${cut(s.title || '(sans titre)', 60)} (${s.project})` : `\`${w.session.slice(0, 8)}\`` }
  const active = wfs.filter((w) => w.active)
  const lines = ['# Workflows (agents en parallèle)', '',
    `${wfs.length} workflow(s) touché(s) dans les ${T.workflows_hours ?? 24} dernières heures, dont ${active.length} actif(s) (un agent sans résultat et une écriture il y a moins de ${T.active_min ?? 30} min).`, '',
    table(['Actif', 'Conversation', 'Workflow', 'Agents fini/échoué/en cours', 'Début', 'Dernière écriture'],
      wfs.map((w) => [w.active ? 'oui' : 'non', name(w), w.id, `${w.done}/${w.failed}/${w.running}`, when(w.first), `${when(w.last)} (il y a ${ago(w.last, nowMs)})`])), '']
  for (const w of wfs.slice(0, T.workflows_detail ?? 20)) {
    lines.push(`## ${w.id} · ${name(w)}${w.active ? ' · actif' : ''}`, '')
    lines.push(table(['Agent', 'Phase', 'État', 'Début', 'Dernière écriture', 'Durée'], w.agents.map((a) => [cut(a.label || a.id, 60), a.phase, a.end === 'done' ? 'fini' : a.end === 'failed' ? 'échoué' : 'en cours', when(a.first), when(a.last), a.first && a.last ? ago(a.first, a.last) : '—'])))
  }
  return [{ path: 'status/workflows.md', content: lines.join('\n'), what: 'Les Workflows (scripts d’agents en parallèle) touchés récemment, avec chaque agent, sa phase et son état.', how: 'Tableau des workflows, puis un tableau d’agents par workflow. « en cours » sans écriture récente = agent probablement mort.', look: 'Agents échoués, agents « en cours » sans écriture depuis longtemps, workflows très longs, conversations qui ont lancé beaucoup d’agents.' }]
}

/** CI from the ci mod's cache: today/week, per host, the local runner queue, running pipelines with an ETA, recent failures. */
export function ciSection(claudeHome, nowMs, T = {}) {
  const c = readJsonSafe(path.join(claudeHome, 'ci-pipelines-cache.json'))
  if (!c) return [{ path: 'status/ci.md', content: '# CI\n\n' + unavailable('Cache CI (~/.claude/ci-pipelines-cache.json)', 'absent ou illisible'), what: 'CI', how: '—', look: '—' }]
  const S = c.summary || {}
  const runs = (c.apps || []).flatMap((a) => (a.runs || []).map((r) => ({ ...r, app: r.app || a.app })))
  const ok = (r) => r.status === 'success'
  const key = (r) => `${r.app}|${r.workflow || ''}`
  const durs = {}
  for (const r of runs) if (ok(r) && r.duration_s) (durs[key(r)] = durs[key(r)] || []).push(r.duration_s * 1000)
  const running = runs.filter((r) => r.status === 'running' || r.status === 'queued')
  const fails = runs.filter((r) => r.status === 'failed' && nowMs - toMs(r.created) <= (T.ci_fail_hours ?? 24) * HOUR).sort((a, b) => toMs(b.created) - toMs(a.created))
  const runner = (() => { try { return readRunner(path.join(claudeHome, 'ci-pipelines-cache.json'), nowMs) } catch { return null } })()
  const line = (x) => (x ? `${x.runs} runs, ${x.success} verts, ${x.failed} rouges, ${x.running} en cours, réussite ${x.pass_rate} %, ${x.minutes} min` : '—')
  const md = ['# CI (pipelines GitHub Actions et GitLab)', '',
    `Cache du mod ci généré le ${when(toMs(c.generated))} (il y a ${ago(toMs(c.generated), nowMs)}) : les chiffres ont cet âge.`, '',
    `- Aujourd’hui : ${line(S.today)}`, `- 7 jours : ${line(S.week)}`,
    S.queue ? `- Runner local (${S.queue.label || S.queue.backend}, tag ${S.queue.tag || '?'}) : ${S.queue.running ?? '?'} job(s) en cours, ${S.queue.pending ?? '?'} en attente, ${S.queue.runners_online ?? '?'} runner(s) en ligne, concurrent ${S.queue.concurrent ?? '?'}, attente moyenne ${S.queue.wait_s ?? '?'} s` : null,
    runner && runner.load !== null ? `- Charge du runner local : ${Math.round(runner.load * 100)} %` : null, '',
    '## Par hôte', '', table(['Hôte', 'Runs', 'Verts', 'Rouges', 'En cours', 'Réussite %', 'Minutes'], (S.by_host || []).map((h) => [h.key, h.runs, h.success, h.failed, h.running, h.pass_rate, h.minutes])),
    '## Par app (7 jours, les plus rouges d’abord)', '', table(['App', 'Runs', 'Verts', 'Rouges', 'Réussite %', 'Minutes'], [...(S.by_app || [])].sort((a, b) => b.failed - a.failed).slice(0, T.ci_apps ?? 30).map((h) => [h.key, h.runs, h.success, h.failed, h.pass_rate, h.minutes])),
    '## Pipelines en cours (ETA = médiane des durées vertes de la même app et du même workflow, si au moins 3)', '',
    table(['App', 'Workflow', 'Branche', 'État', 'Créé', 'ETA', 'Lien'], running.map((r) => {
      const est = estimateOf(durs[key(r)] || [])
      const eta = etaOf(est, toMs(r.created), nowMs)
      return [r.app, r.workflow, cut(r.branch, 50), r.status, when(toMs(r.created)), eta ? `${when(eta.mid)} (${when(eta.lo)}–${when(eta.hi)})${eta.overrun ? ', déjà au-delà du p75' : ''}` : 'pas assez d’historique', r.url]
    })),
    `## Échecs des ${T.ci_fail_hours ?? 24} dernières heures`, '',
    table(['App', 'Workflow', 'Branche', 'Titre', 'Créé', 'Jobs rouges', 'Lancé par', 'Lien'], fails.slice(0, T.ci_fails ?? 60).map((r) => [r.app, r.workflow, cut(r.branch, 50), cut(r.title, 70), when(toMs(r.created)), (r.jobs || []).filter((j) => j.status === 'failed').map((j) => j.name).join(', '), r.who || '', r.url])),
  ].filter((x) => x !== null).join('\n')
  return [{ path: 'status/ci.md', content: md, what: 'État de la CI : volumes du jour et de la semaine, runner GitLab local, pipelines en cours avec ETA, échecs récents.', how: 'Les chiffres viennent du cache du mod ci (pas d’appel réseau à l’export) ; l’âge du cache est en tête.', look: 'Apps à faible taux de réussite, échecs répétés sur la même branche, file du runner local saturée, pipelines en cours depuis bien plus longtemps que leur ETA.' }]
}

/** Who consumes the most (classement.json of the usage mod), out tok/s, quotas (5 h and week) for Claude and Codex. */
export function usageSection(claudeHome, nowMs, T = {}) {
  const dir = path.join(claudeHome, 'usage-mod')
  const cl = readJsonSafe(path.join(dir, 'classement.json'))
  let q = null
  try { q = readQuotas(dir, nowMs) } catch { q = null }
  const md = ['# Consommation (tokens) et quotas', '']
  const win = (w, label) => (w ? `- ${label} : ${w.pct ?? '?'} % utilisés (relevé ${when(w.at)}), remise à zéro ${when(w.reset)}${w.runOutAt ? `, 100 % atteint vers ${when(w.runOutAt)} au rythme mesuré` : ''}` : `- ${label} : pas de relevé`)
  if (q) {
    md.push('## Quotas', '', win(q.claude && q.claude.five, 'Claude 5 h'), win(q.claude && q.claude.week, 'Claude semaine'),
      win(q.codex && q.codex.five, 'Codex 5 h'), win(q.codex && q.codex.week, 'Codex semaine'), '')
  }
  if (!cl || !Array.isArray(cl.rows)) {
    md.push(unavailable('Classement (~/.claude/usage-mod/classement.json)', 'absent ou illisible'))
  } else {
    md.push(`Classement du mod usage généré le ${when(cl.generated)} (il y a ${ago(cl.generated, nowMs)}). Tokens = entrée + sortie + lecture et écriture de cache. tok/s = tokens de sortie par seconde active. Les agents et sous-agents comptent pour leur conversation parente.`, '')
    const titles = cl.sessions || {}
    for (const [label, span] of [['24 heures', DAY], ['7 jours', 7 * DAY]]) {
      const by = {}
      const byProject = {}
      const byModel = {}
      const ref = Math.max(cl.generated || 0, 0) || nowMs
      for (const r of cl.rows) {
        if (ref - r[0] > span) continue
        const v = r.slice(7)
        const tok = (v[0] || 0) + (v[1] || 0) + (v[2] || 0) + (v[3] || 0) + (v[4] || 0)
        const add = (m, k) => { const x = (m[k] = m[k] || { tok: 0, out: 0, active: 0, cost: 0, msgs: 0, sub: 0 }); x.tok += tok; x.out += v[1] || 0; x.active += v[6] || 0; x.cost += v[7] || 0; x.msgs += v[5] || 0; if (r[2] !== 'main') x.sub += tok }
        add(by, r[1]); add(byProject, (titles[r[1]] || {}).p || '?'); add(byModel, r[3] || '?')
      }
      const top = (m) => Object.entries(m).sort((a, b) => b[1].tok - a[1].tok)
      const tps = (x) => (x.active ? Math.round(x.out / x.active) : '—')
      md.push(`## Top conversations sur ${label}`, '', table(['#', 'Conversation', 'Projet', 'Tokens', 'dont agents', 'Sortie', 'tok/s', 'Messages', 'Coût liste $'],
        top(by).slice(0, T.top_n ?? 15).map(([sid, x], i) => [i + 1, `${cut((titles[sid] || {}).t || '(sans titre)', 60)} \`${sid.slice(0, 8)}\``, (titles[sid] || {}).p || '?', fmtTok(x.tok), fmtTok(x.sub), fmtTok(x.out), tps(x), x.msgs, x.cost.toFixed(2)])))
      md.push(`### Par projet (${label})`, '', table(['Projet', 'Tokens', 'Sortie', 'tok/s', 'Coût liste $'], top(byProject).slice(0, T.top_n ?? 15).map(([k, x]) => [k, fmtTok(x.tok), fmtTok(x.out), tps(x), x.cost.toFixed(2)])))
      md.push(`### Par modèle (${label})`, '', table(['Modèle', 'Tokens', 'Sortie', 'tok/s', 'Coût liste $'], top(byModel).map(([k, x]) => [k, fmtTok(x.tok), fmtTok(x.out), tps(x), x.cost.toFixed(2)])))
    }
  }
  return [{ path: 'status/usage.md', content: md.join('\n'), what: 'Qui consomme le plus de tokens (24 h et 7 jours) par conversation, projet et modèle, débit tok/s, et quotas Claude/Codex.', how: 'Tableaux classés du plus gros au plus petit ; l’âge du classement est en tête (le mod usage le recalcule).', look: 'Une conversation qui écrase les autres, des agents qui coûtent plus que leur parent, Opus là où les règles demandent Sonnet/Haiku, quota proche de 100 % avant la remise à zéro.' }]
}

/** The Problèmes register (problemes mod): totals and every open problem, plus the ones fixed this week. */
export function problemesSection(claudeHome, nowMs, T = {}) {
  const pj = readJsonSafe(path.join(claudeHome, 'problemes', 'problems.json'))
  if (!pj) return [{ path: 'problemes.md', content: '# Problèmes\n\n' + unavailable('Registre (~/.claude/problemes/problems.json)', 'absent ou illisible'), what: 'Registre des problèmes', how: '—', look: '—' }]
  const all = pj.problems || []
  const isOpen = (p) => /ouvert|open|nouveau|new|récurrent/i.test(p.status || '')
  const open = all.filter(isOpen).sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0))
  const fixed = all.filter((p) => /corrig|fixed|résolu/i.test(p.status || '') && nowMs - (p.changed || p.last_seen || 0) <= 7 * DAY)
  const t = pj.totals || {}
  const md = ['# Registre des problèmes', '',
    `Généré par le mod problemes le ${when(pj.generated)} (il y a ${ago(pj.generated, nowMs)}). Totaux : ${t.open ?? open.length} ouverts, ${t.fixed ?? '?'} corrigés, ${t.other ?? '?'} autres ; ${t.week ?? '?'} vus cette semaine (${t.week_seen ?? '?'} occurrences).`, '',
    `## Ouverts (${open.length}, derniers vus d’abord)`, '',
    table(['Id', 'Catégorie', 'Titre', 'Vu', 'Dernière fois', 'Symptôme', 'Cause', 'Correction'], open.slice(0, T.problems_max ?? 400).map((p) => [p.id, p.category, cut(p.title, 90), p.count, when(p.last_seen), cut(p.symptom, 120), cut(p.cause, 120), cut(p.fix, 100)])),
    `## Corrigés ces 7 derniers jours (${fixed.length})`, '',
    table(['Id', 'Catégorie', 'Titre', 'Correction'], fixed.map((p) => [p.id, p.category, cut(p.title, 90), cut(p.fix, 140)])),
  ].join('\n')
  const json = { generated: pj.generated, totals: t, open: open.map((p) => ({ id: p.id, category: p.category, scope: p.scope, app: p.app, title: p.title, symptom: p.symptom, cause: p.cause, fix: p.fix, status: p.status, count: p.count, first_seen: p.first_seen, last_seen: p.last_seen, ref: p.ref })) }
  return [
    { path: 'problemes.md', content: md, what: 'Le registre des problèmes (mod problemes) : tous les ouverts avec symptôme, cause et correction connue, et les corrigés de la semaine.', how: 'Tableau trié par dernière occurrence ; « Vu » = nombre d’occurrences.', look: 'Problèmes ouverts qui reviennent souvent (Vu élevé) sans correction, catégories qui dominent, causes communes à plusieurs lignes.' },
    { path: 'problemes.json', content: JSON.stringify(json, null, 1), what: 'Les problèmes ouverts en JSON (champs complets).', how: 'Pour regrouper par catégorie ou app.', look: '—' },
  ]
}

/** The watcher (veille): heartbeat, open alerts, the Fil (conversations waiting), the night summary (PRs merged since). */
export function veilleSection(claudeHome, nowMs) {
  const vh = path.join(claudeHome, 'veille')
  let v = null
  try { v = readVeille({ veilleHome: vh, afaireHome: path.join(claudeHome, 'a-faire') }) } catch { v = null }
  const hb = readJsonSafe(path.join(vh, 'heartbeat.json')) || {}
  const state = readJsonSafe(path.join(vh, 'state.json')) || {}
  const arch = readJsonSafe(path.join(vh, 'archive.json'))
  const fil = readJsonSafe(path.join(vh, 'fil.json'))
  const night = readJsonSafe(path.join(claudeHome, 'effort-board', 'cockpit_depuis_prs.json'))
  const md = ['# Veille (le surveillant)', '',
    `- Mode ${state.mode || '?'}, ${state.tours ?? '?'} tours, dernier tour ${when(state.last_tour)} (il y a ${ago(state.last_tour, nowMs)})${state.last_error ? `, dernière erreur : ${cut(state.last_error, 200)}` : ''}`,
    `- Battement : dernier ${when(hb.last_fire)} (il y a ${ago(hb.last_fire, nowMs)}), ${hb.fires ?? '?'} réveils, dernier tour ${hb.last_tour_ok === false ? 'en échec' : 'ok'}${hb.last_error ? ` (${cut(hb.last_error, 160)})` : ''}`,
    v ? `- Attend Julian : ${v.julian} ; alertes ouvertes : ${v.open} ; à faire pour Julian : ${v.aToi}` : null,
    arch ? `- Archivage : ${arch.open ?? '?'} conversations ouvertes, ${arch.count ?? 0} candidates à l’archivage` : null, '',
    '## Alertes ouvertes (Julian d’abord, puis gravité)', '',
    table(['Gravité', 'Pour Julian', 'Type', 'Quoi', 'Détail', 'Depuis', 'Lien'], ((v && v.alerts) || []).map((a) => [a.severity, a.julian ? 'oui' : '', a.kind, cut(a.what, 120), cut(a.detail, 120), when(a.since || a.first_seen), a.link || a.session_link || ''])),
    '## Fil : conversations qui attendent une réponse', '',
    table(['Projet', 'Conversation', 'Modèle', 'Dernier message', 'Aperçu'], ((v && v.filWaiting) || []).map((w) => [w.project || '', `${cut(w.title || '', 70)} \`${String(w.cli || '').slice(0, 8)}\``, w.model || '', when(w.msg_at || w.last_at), cut(w.preview || '', 160)])),
    fil ? `Fil sur ${fil.hours ?? '?'} h : ${fil.total ?? '?'} conversations, ${fil.julian ?? 0} pour Julian, projets : ${(fil.projects || []).map((p) => `${p.name} ${p.total}`).join(', ')}.\n` : null,
    `## Résumé de nuit : PR mergées depuis ${night ? when(night.since) : '—'}`, '',
    night ? table(['Forge', 'Dépôt', 'PR', 'Titre', 'Mergée'], (night.merged || []).map((m) => [m.forge, m.repo, m.number, cut(m.title, 90), when(toMs(m.at))])) : unavailable('Résumé de nuit (effort-board/cockpit_depuis_prs.json)', 'absent'),
  ].filter((x) => x !== null).join('\n')
  return [{ path: 'veille.md', content: md, what: 'La veille : battement du surveillant, alertes ouvertes, conversations qui attendent (Fil) et résumé de nuit (PR mergées depuis).', how: 'Lire d’abord les lignes « Attend Julian » et les alertes pour Julian.', look: 'Surveillant arrêté (battement ancien), alertes vertes non mergées qui vieillissent, conversations qui attendent une réponse depuis longtemps.' }]
}

/** À faire (a-faire mod): counts and every open item with why and steps. */
export function afaireSection(claudeHome, nowMs) {
  const items = readJsonSafe(path.join(claudeHome, 'a-faire', 'items.json'))
  const sum = readJsonSafe(path.join(claudeHome, 'a-faire', 'summary.json')) || {}
  if (!items) return [{ path: 'a-faire.md', content: '# À faire\n\n' + unavailable('À faire (~/.claude/a-faire/items.json)', 'absent ou illisible'), what: 'À faire', how: '—', look: '—' }]
  const rank = { now: 0, feature: 1, comfort: 2 }
  const open = [...(items.open || [])].sort((a, b) => (rank[a.prio] ?? 9) - (rank[b.prio] ?? 9) || (a.since || 0) - (b.since || 0))
  const md = ['# À faire (ce qui attend Julian ou une action)', '',
    `Mis à jour le ${when(items.at)}. ${sum.open ?? open.length} ouverts (${Object.entries(sum.by_prio || {}).map(([k, x]) => `${k} ${x}`).join(', ')}) ; par catégorie : ${Object.entries(sum.by_cat || {}).map(([k, x]) => `${k} ${x}`).join(', ')}. ${(items.snoozed || []).length} en sommeil, ${(items.errors || []).length} erreur(s) de collecte.`, '',
    table(['Priorité', 'Catégorie', 'Titre', 'Pourquoi', 'Étapes', 'Depuis'], open.map((i) => [i.prio, i.cat, cut(i.title, 100), cut(i.why, 160), cut((i.steps || []).map((s, k) => `${k + 1}. ${typeof s === 'string' ? s : s.text || ''}`).join(' '), 220), when(i.since)])),
    (items.errors || []).length ? '## Erreurs de collecte\n\n' + (items.errors || []).map((e) => `- ${cut(typeof e === 'string' ? e : JSON.stringify(e), 200)}`).join('\n') : '',
  ].join('\n')
  return [{ path: 'a-faire.md', content: md, what: 'La liste À faire : ce qui attend Julian (logins, décisions, vérifications manuelles) ou une action d’agent.', how: 'Priorité now > feature > comfort, puis les plus anciens.', look: 'Éléments « now » anciens, décisions que les règles permettraient à un agent de prendre seul, doublons.' }]
}

/** Health of the mods (~/.claude/mods-health/*.json): last run, error, errors in 24 h. */
export function healthSection(claudeHome, nowMs) {
  const dir = path.join(claudeHome, 'mods-health')
  let files = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')) } catch { /* none */ }
  const rows = files.map((f) => readJsonSafe(path.join(dir, f))).filter(Boolean).sort((a, b) => Number(!!b.error) - Number(!!a.error))
  const md = ['# Santé des mods (scripts de fond)', '', 'Une ligne par mod qui écrit un relevé de santé à chaque passage de son script.', '',
    table(['Mod', 'Dernier passage', 'Durée ms', 'Erreur', 'Dernier ok', 'Passages 24 h', 'Erreurs 24 h', 'CPU 24 h s'], rows.map((h) => [h.mod, `${when(toMs(h.lastRun))} (il y a ${ago(toMs(h.lastRun), nowMs)})`, h.durationMs, cut(h.error || '', 160), when(toMs(h.lastOk)), (h.window || {}).runs, (h.window || {}).errors, Math.round(((h.window || {}).cpuMs || 0) / 1000)]))].join('\n')
  return [{ path: 'outputs/health.md', content: md, what: 'Résultats des scripts de fond de chaque mod : dernier passage, erreur, nombre d’erreurs sur 24 h.', how: 'Les mods en erreur sont en haut.', look: 'Mods en erreur, scripts qui ne tournent plus (dernier passage ancien), CPU élevé.' }]
}

/** Latest audits, manual checks, the tail of questions.md, tests-reels counts (no accounts, URLs or ids). */
export function outputsSection(claudeHome, nowMs, T = {}) {
  const out = []
  const eb = path.join(claudeHome, 'effort-board')
  const adir = path.join(eb, 'audits')
  let audits = []
  try { audits = fs.readdirSync(adir).filter((f) => f.endsWith('.md') && !forbidden(f)).map((f) => ({ f, m: fs.statSync(path.join(adir, f)).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, T.audits_latest ?? 5) } catch { /* none */ }
  for (const a of audits) out.push({ path: `outputs/audits/${a.f}`, content: readTextSafe(path.join(adir, a.f)), what: `Audit ${a.f} (copie telle quelle, masquée).`, how: 'Rapport d’audit écrit par une session Claude.', look: 'Constats encore ouverts, chiffres à comparer au snapshot.' })
  const mc = readTextSafe(path.join(eb, 'manual-checks.md'))
  if (mc) out.push({ path: 'outputs/manual-checks.md', content: mc, what: 'Vérifications manuelles laissées à Julian (matériel, son, écrans, logins).', how: 'Une ligne par vérification : date · projet · quoi · comment.', look: 'Vérifications anciennes jamais faites, celles qu’un agent pourrait faire.' })
  const qs = readTextSafe(path.join(eb, 'questions.md'))
  if (qs) {
    const lines = qs.split('\n')
    const n = T.questions_tail_lines ?? 300
    out.push({ path: 'outputs/questions-recent.md', content: `# Décisions des agents (fin de questions.md, ${Math.min(n, lines.length)} dernières lignes sur ${lines.length})\n\n${lines.slice(-n).join('\n')}`, what: 'Les dernières décisions non évidentes prises par les agents (date · projet · question · choix · pourquoi).', how: 'Les plus récentes en bas.', look: 'Décisions qui contredisent les règles ou une demande de Julian, questions qui reviennent.' })
  }
  const tr = readJsonSafe(path.join(claudeHome, 'tests-reels', 'recovered.json'))
  if (tr) {
    const apps = Object.entries(tr.apps || {}).map(([k, a]) => [k, Object.entries(a.categories || {}).map(([c, n]) => `${c} ${n}`).join(', '), (a.sessions || []).length]).sort((a, b) => b[2] - a[2])
    out.push({ path: 'outputs/tests-reels.md', content: ['# Tests réels (comptes et ressources réelles repérés dans les conversations)', '', `Généré le ${when(tr.generated)}. Compteurs : ${Object.entries(tr.counts || {}).map(([k, v]) => `${k} ${v}`).join(', ')}. Sources lues : ${Object.entries(tr.sources || {}).map(([k, v]) => `${k} ${v}`).join(', ')}. Erreurs : ${(tr.errors || []).length}.`, '', 'Seuls les compteurs par app et catégorie sont exportés : jamais les comptes, URL, identifiants ou secrets eux-mêmes.', '', table(['App', 'Catégories', 'Conversations'], apps.slice(0, T.tests_apps ?? 80))].join('\n'), what: 'Registre des tests réels (mod tests-reels) en compteurs : quelles apps touchent quels services réels.', how: 'Une ligne par app, les plus citées d’abord.', look: 'Apps qui touchent beaucoup de services réels sans test local, erreurs de collecte.' })
  }
  return out
}

/** Rules: global CLAUDE.md, RULES-INVENTORY, settings env (secret-looking values masked), plugin dirs, mods with versions. */
export function rulesSection(claudeHome, T = {}) {
  const out = []
  const md = readTextSafe(path.join(claudeHome, 'CLAUDE.md'))
  if (md) out.push({ path: 'rules/CLAUDE.md', content: md, what: 'Les règles globales de Julian (~/.claude/CLAUDE.md), telles que les sessions les lisent.', how: 'Texte intégral.', look: 'Règles contredites par ce qu’on voit dans status/, problemes.md et questions-recent.md.' })
  for (const extra of T.rules_files || []) {
    const f = home(typeof extra === 'string' ? extra : extra.path)
    const txt = readTextSafe(f)
    if (txt) out.push({ path: `rules/${path.basename(f)}`, content: txt, what: (extra && extra.what) || `Fichier de règles ${path.basename(f)}.`, how: 'Texte intégral.', look: 'Écarts avec CLAUDE.md.' })
  }
  const settings = readJsonSafe(path.join(claudeHome, 'settings.json')) || {}
  const env = settings.env || {}
  const SECRETISH = /token|key|secret|pass|auth|cred|cookie|session/i
  const dirsVal = env.CLAUDE_CODE_PLUGIN_DIRS || process.env.CLAUDE_CODE_PLUGIN_DIRS || ''
  const dirs = splitDirs(dirsVal)
  const mods = dirs.map((d) => {
    const pj = readJsonSafe(path.join(d, '.claude-plugin', 'plugin.json')) || readJsonSafe(path.join(d, 'plugin.json')) || {}
    return [pj.name || path.basename(d), pj.version || '?', d, cut(pj.description || '', 140)]
  })
  const sm = ['# Réglages et mods chargés', '',
    '## Variables d’environnement de ~/.claude/settings.json', '', 'Les valeurs dont le nom évoque un secret sont remplacées par «masqué».', '',
    table(['Clé', 'Valeur'], Object.entries(env).map(([k, v]) => [k, SECRETISH.test(k) && k !== 'CLAUDE_CODE_PLUGIN_DIRS' ? '«masqué»' : cut(v, k === 'CLAUDE_CODE_PLUGIN_DIRS' ? 4000 : 400)])),
    '## Autres réglages (clés de premier niveau)', '', Object.keys(settings).filter((k) => k !== 'env').map((k) => `\`${k}\``).join(', ') || '—', '',
    `## CLAUDE_CODE_PLUGIN_DIRS (${dirs.length} dossiers)`, '', table(['Mod', 'Version', 'Dossier', 'Description'], mods)].join('\n')
  out.push({ path: 'rules/settings-and-mods.md', content: sm, what: 'Réglages globaux (variables d’environnement, secrets masqués) et liste des mods chargés avec leur version.', how: 'Un tableau pour l’environnement, un pour les mods (dossier = CLAUDE_CODE_PLUGIN_DIRS).', look: 'Mods en double ou absents, versions anciennes, variables qui contredisent les règles (modèle des sous-agents, fenêtre d’auto-compact).' })
  return out
}

/** The conversations exported in this run (they live in sources/conversations/, linked from here). */
export function conversationsSection(res, snapDepth = 3) {
  const up = '../'.repeat(snapDepth + 1)
  const md = ['# Conversations exportées avec ce snapshot', '',
    'Les conversations sont rendues en Markdown masqué au même endroit que les exports ordinaires (`sources/conversations/<projet>/`), un fichier par conversation réécrit à chaque export : ce snapshot ne les recopie pas, il les liste.', '',
    table(['Conversation', 'Projet', 'Fichier', 'Parties', 'Valeurs masquées'], (res.exported || []).map((e) => [cut(e.title || e.cli, 80), e.project, `[${e.path}](${up}${e.path})`, e.parts, e.masked])),
    (res.held || []).length ? `## Retenues (secret non masquable, non exportées)\n\n${table(['Conversation', 'Projet', 'Motifs'], res.held.map((h) => [cut(h.title || h.cli, 80), h.project, (h.hits || []).join(', ')]))}` : 'Aucune conversation retenue.',
  ].join('\n')
  return [{ path: 'conversations.md', content: md, what: 'Les conversations exportées avec ce snapshot (en cours, et terminées depuis le dernier export), avec le lien vers leur fichier.', how: 'Ouvrir le fichier lié : messages dans l’ordre, un appel d’outil par ligne, sorties d’outils omises.', look: 'Ce que chaque conversation en cours essaie de faire et où elle bloque ; comparer avec status/sessions.md.' }]
}

// ---- assembly -------------------------------------------------------------------------------------------------------

/** Masks every file; returns { files: [{path, content, ...meta, masked}], held: [{path, hits}], masked: {kind: n} }. */
export function maskAll(files, mo) {
  const out = []
  const held = []
  const masked = {}
  for (const f of files) {
    const m = mask(String(f.content ?? ''), mo)
    const hits = check(m.text, mo)
    if (hits.length) { held.push({ path: f.path, hits: [...new Set(hits.map((h) => h.kind))] }); continue }
    for (const [k, v] of Object.entries(m.counts || {})) masked[k] = (masked[k] || 0) + v
    out.push({ ...f, content: m.text.endsWith('\n') ? m.text : m.text + '\n', masked: m.total })
  }
  return { files: out, held, masked }
}

/** INDEX.md for an AI analyst: what the snapshot is, reading order, every file with what to look for, held files. */
export function indexMd(meta, files, held, masked) {
  const L = meta.labels || {}
  const order = ['status/sessions.md', 'status/workflows.md', 'veille.md', 'problemes.md', 'a-faire.md', 'status/ci.md', 'status/usage.md', 'outputs/health.md', 'conversations.md', 'rules/CLAUDE.md']
  const sorted = [...files].sort((a, b) => ((order.indexOf(a.path) + 1 || 99) - (order.indexOf(b.path) + 1 || 99)) || a.path.localeCompare(b.path))
  return [
    `# ${L.tout_index_title || 'Snapshot Claude Control'} ${meta.folder}`, '',
    `Exporté le ${meta.when} depuis le PC de Julian par la commande \`/export-tout\` du mod export-eta (dépôt claude-mod), sans appel de modèle. Tout ce qui suit est lu dans des fichiers que les mods écrivent déjà ; rien n’est recalculé à la main.`, '',
    '## Pour l’IA qui analyse', '',
    'Tu reçois l’état complet du système d’agents Claude Code de Julian à un instant donné : ce qui tourne, ce qui a échoué, ce qui attend Julian, combien ça consomme, et les règles que les agents sont censés suivre. Ton travail : trouver ce qui ne va pas et proposer des corrections concrètes (règle à changer, mod à corriger, conversation à relancer ou arrêter).', '',
    'Ordre de lecture conseillé :', '',
    '1. `status/sessions.md` et `status/workflows.md` : ce qui tourne maintenant.',
    '2. `veille.md` et `a-faire.md` : ce qui attend Julian.',
    '3. `problemes.md` : les problèmes connus, ouverts, avec leurs occurrences.',
    '4. `status/ci.md`, `status/usage.md`, `outputs/health.md` : CI, tokens, scripts de fond.',
    '5. `conversations.md` : le détail des conversations en cours ou finies depuis le dernier export.',
    '6. `rules/` : les règles, pour juger les écarts.', '',
    'Questions utiles : quelles conversations sont bloquées et pourquoi ? quels problèmes reviennent le plus ? les règles (`rules/CLAUDE.md`) sont-elles suivies (modèles, merges, questions à Julian) ? qui consomme le plus et est-ce justifié ? quels mods ou scripts sont en erreur ?', '',
    'Confidentialité : chaque fichier est passé au masque (jetons, clés, mots de passe, cookies, chaînes de connexion, JWT, clés privées, e-mails sauf ceux de Julian) ; une valeur masquée apparaît comme `«masqué:<type>»`. Un fichier où il restait un secret non masquable n’est pas exporté et figure plus bas dans « Retenus ».', '',
    '## Fichiers', '',
    table(['Fichier', 'Ce que c’est', 'Comment le lire', 'Quoi chercher'], sorted.map((f) => [`[${f.path}](${f.path})`, f.what || '', f.how || '', f.look || ''])),
    `Valeurs masquées dans ce snapshot : ${Object.entries(masked).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucune'}.`, '',
    '## Retenus (secret non masquable)', '',
    held.length ? table(['Fichier', 'Motifs'], held.map((h) => [h.path, (h.hits || []).join(', ')])) : 'Aucun.\n',
    meta.errors && meta.errors.length ? `## Sections en erreur\n\n${meta.errors.map((e) => `- ${cut(e, 240)}`).join('\n')}\n` : '',
  ].join('\n')
}

/**
 * Collects every section. deps: { sessions, projectsDir, claudeHome, conversations (build result) }.
 * Returns { files: [{ path, content, what, how, look }], errors: [] }: one broken section never stops the others.
 */
export function collect(T, deps, nowMs) {
  const files = []
  const errors = []
  const run = (name, fn) => { try { files.push(...fn()) } catch (e) { errors.push(`${name}: ${e && e.message ? e.message : e}`) } }
  const ch = deps.claudeHome
  run('sessions', () => sessionsSection(deps.sessions || [], nowMs, T))
  run('workflows', () => workflowsSection(scanWorkflows(deps.projectsDir, nowMs, T), deps.sessions || [], nowMs, T))
  run('ci', () => ciSection(ch, nowMs, T))
  run('usage', () => usageSection(ch, nowMs, T))
  run('problemes', () => problemesSection(ch, nowMs, T))
  run('veille', () => veilleSection(ch, nowMs))
  run('a-faire', () => afaireSection(ch, nowMs))
  run('health', () => healthSection(ch, nowMs))
  run('outputs', () => outputsSection(ch, nowMs, T))
  run('rules', () => rulesSection(ch, T))
  if (deps.conversations) run('conversations', () => conversationsSection(deps.conversations, String(deps.snapshotDir || '').split('/').filter(Boolean).length))
  return { files: files.filter((f) => !forbidden(f.path)), errors }
}
