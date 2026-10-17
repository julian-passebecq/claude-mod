// export-eta - « Exporter tout » (/export-tout, /export-eta tout): one click, no model call. Builds the dated snapshot
// (lib/snapshot.mjs) plus the conversations (ongoing, and finished since the last export), masks everything, and lands
// it in the eta repo through the same git flow as the other exports (lib/etagit.mjs: fresh worktree, branch, final
// confidentiality check, commit, push, PR, squash merge, branch deleted, worktree removed).
//   node export.mjs tout [--dry-run] [--out <dir>] [--json]
// Prints one line: « Exporté : N fichiers, PR #x mergée ».
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { landInEta, maskOpts } from '../lib/etagit.mjs'
import { fill } from '../lib/layout.mjs'
import { collect, indexMd, maskAll, snapStamp, when } from '../lib/snapshot.mjs'
import { listSessions, projectsDir } from './sessions.mjs'

export const TOUT_DEFAULTS = {
  snapshot_dir: 'sources/claude-control/snapshots/{folder}',
  branch: 'export/tout-{day}-{hm}',
  worktree_dir: '.claude/worktrees/export-tout-{day}-{hm}',
  claude_home: '~/.claude',
  conversations: ['ongoing', 'batch'],
  max_conversations: 60,
}

export function toutConfig(cfg) {
  return { ...TOUT_DEFAULTS, ...(cfg.tout || {}) }
}

/** Which conversations go with the snapshot: ongoing/live, plus the finished ones not exported since they last moved. */
export function toutSessions(all, state, cfg, T, nowMs) {
  const ex = new Set(cfg.exclude || [])
  const want = new Set(T.conversations || [])
  const pickIds = new Set()
  if (want.has('ongoing')) for (const s of all) if ((s.state === 'live' || s.state === 'ongoing') && !ex.has(s.cli)) pickIds.add(s.cli)
  if (want.has('batch') || want.has('finished')) {
    const exported = state.exported || {}
    for (const s of all) {
      if (s.state !== 'finished' || ex.has(s.cli)) continue
      if ((s.last_activity || 0) <= (state.since || 0)) continue
      if (exported[s.cli] && (exported[s.cli].last_activity || 0) >= (s.last_activity || 0)) continue
      pickIds.add(s.cli)
    }
  }
  return all.filter((s) => pickIds.has(s.cli)).sort((a, b) => (b.last_activity || 0) - (a.last_activity || 0)).slice(0, T.max_conversations ?? 60)
}

/**
 * Writes the snapshot into `root` (an eta worktree or a plain folder). buildConv(existing, own) renders the conversations
 * (export.mjs build). Returns { touched, snapshot, files, held, masked, conv, errors }.
 */
export function writeTout(root, cfg, T, deps, nowMs, own, h) {
  const st = snapStamp(nowMs)
  const snapDir = fill(T.snapshot_dir, st).replace(/\/+$/, '')
  const conv = deps.buildConv ? deps.buildConv(h.listExisting(root, cfg), own) : { files: [], stale: [], exported: [], held: [], masked: {} }
  const touched = conv.files.length || conv.stale.length ? h.writeAll(root, cfg, conv) : []
  const col = collect(T, { ...deps, conversations: conv, snapshotDir: snapDir }, nowMs)
  const mo = maskOpts(cfg, own)
  const m = maskAll(col.files, mo)
  const index = maskAll([{ path: 'INDEX.md', content: indexMd({ folder: st.folder, when: when(nowMs), labels: cfg.labels, errors: col.errors }, m.files, m.held, m.masked) }], mo)
  const files = [...m.files, ...index.files]
  for (const f of files) {
    const abs = path.join(root, snapDir, f.path)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, f.content)
    touched.push(`${snapDir}/${f.path}`)
  }
  return { touched, snapshot: snapDir, files: files.length, held: [...m.held, ...index.held], masked: m.masked, conv, errors: col.errors }
}

export function toutPrBody(r, cfg) {
  const conv = r.conv || { exported: [], held: [] }
  return [
    `Snapshot « Exporter tout » du mod export-eta (claude-mod) : \`${r.snapshot}/INDEX.md\` explique chaque fichier pour une IA qui analyse.`, '',
    `- ${r.files} fichier(s) de snapshot (statut des conversations, workflows et agents, CI, consommation, problèmes, veille, à faire, santé des mods, audits, règles).`,
    `- ${conv.exported.length} conversation(s) rendues dans \`${cfg.dest_root || 'sources/conversations'}/\` (en cours, et terminées depuis le dernier export).`,
    `- Valeurs masquées : ${Object.entries(r.masked || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '0'}.`,
    `- Retenus (secret non masquable) : ${[...(r.held || []).map((h) => h.path), ...conv.held.map((h) => h.title || h.cli)].join(' ; ') || 'aucun'}.`,
    r.errors && r.errors.length ? `- Sections en erreur : ${r.errors.join(' ; ')}` : null, '',
    'Merge policy: Markdown sources only; merged after the confidentiality pass (mask + final check on every written file) came back clean.', '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].filter((x) => x !== null).join('\n')
}

/** The command. h: { build, listExisting, writeAll, loadState, saveState, takeLock, dropLock, log, pending } from export.mjs. */
export async function runTout(cfg, o, nowMs, h) {
  const T = toutConfig(cfg)
  const claudeHome = path.resolve(String(T.claude_home).replace(/^~(?=$|[\\/])/, os.homedir()))
  const all = listSessions(cfg, nowMs)
  const state = h.loadState(cfg, nowMs)
  const chosen = toutSessions(all, state, cfg, T, nowMs)
  const deps = { sessions: all, projectsDir: projectsDir(cfg), claudeHome, buildConv: (existing, own) => h.build(chosen, cfg, existing, nowMs, own) }
  const title = fill((cfg.labels || {}).tout_pr_title || 'Export tout : snapshot {folder} ({n} conversations)', { folder: snapStamp(nowMs).folder, n: chosen.length })
  let r = null
  let git = { pr: null, url: null, merged: false, error: '' }
  if (o['dry-run'] || o.out) {
    const root = o.out ? path.resolve(o.out) : fs.mkdtempSync(path.join(os.tmpdir(), 'export-tout-'))
    r = writeTout(root, cfg, T, deps, nowMs, [], h)
    if (o['dry-run'] && !o.out) fs.rmSync(root, { recursive: true, force: true })
  } else {
    if (!h.takeLock(cfg)) return { ok: false, error: 'un export tourne déjà', count: 0, files: 0 }
    try {
      // the pane runs this through process.run (10 min ceiling): never wait longer than checks_timeout_min for checks
      const eta = { ...(cfg.eta || {}), branch: T.branch, worktree_dir: T.worktree_dir, checks_timeout_min: Math.min((cfg.eta || {}).checks_timeout_min || 30, T.checks_timeout_min ?? 8) }
      if (!eta.repo) throw new Error(`eta.repo non réglé : mets-le dans ${path.join(cfg.home, 'config.json')}`)
      const snapRoot = String(T.snapshot_dir).split('{')[0].replace(/\/+$/, '') || 'sources'
      git = landInEta({
        eta, home: cfg.home, mask: cfg, addPaths: [snapRoot, cfg.dest_root || 'sources/conversations'], title, nowMs,
        produce: (wt, own) => {
          r = writeTout(wt, cfg, T, deps, nowMs, own, h)
          return { touched: r.touched, body: toutPrBody(r, cfg), commit: `Export tout by the export-eta mod (claude-mod): ${r.files} snapshot file(s), ${r.conv.exported.length} conversation(s).` }
        },
      })
    } catch (e) { git.error = String(e.message || e) } finally { h.dropLock(cfg) }
  }
  const n = r ? r.touched.length : 0
  const entry = {
    at: nowMs, mode: 'tout', count: r ? r.conv.exported.length : 0, files_count: n, snapshot: r ? r.snapshot : '', pr: git.pr, url: git.url, merged: git.merged, error: git.error,
    masked: r ? r.masked : {}, held: r ? [...r.held.map((x) => ({ title: x.path, hits: x.hits })), ...r.conv.held.map((x) => ({ cli: x.cli, title: x.title, hits: x.hits }))] : [],
    files: r ? r.conv.exported.map((e) => e.path) : [], dry: !!o['dry-run'], out: o.out ? 'dossier local' : '',
  }
  if (!o['dry-run']) {
    if (r && (o.out || git.merged)) for (const e of r.conv.exported) state.exported[e.cli] = { at: nowMs, path: e.path, last_activity: e.last_activity }
    state.history = [entry, ...state.history].slice(0, 50)
    h.saveState(cfg, state)
    h.log(cfg, `tout ${n} fichiers pr=${git.url || '-'} merged=${git.merged} ${git.error || ''}`)
    try { h.pending(cfg, all, nowMs) } catch { /* the pane refreshes it */ }
  }
  const ok = o['dry-run'] || o.out ? !!r : !git.error || (git.merged && !!git.url)
  const line = toutLine(entry, cfg)
  return { ok, line, ...entry }
}

/** « Exporté : N fichiers, PR #x mergée » (labels configurable). */
export function toutLine(e, cfg = {}) {
  const L = cfg.labels || {}
  if (e.dry) return fill(L.tout_dry || 'Essai : {n} fichiers prêts (rien d’écrit dans eta)', { n: e.files_count })
  if (e.out) return fill(L.tout_out || 'Exporté : {n} fichiers dans le dossier local', { n: e.files_count })
  if (e.error && !e.merged) return fill(L.tout_failed || 'Export tout échoué : {error}', { error: e.error })
  return fill(e.merged ? L.tout_done || 'Exporté : {n} fichiers, PR #{pr} mergée' : L.tout_open || 'Exporté : {n} fichiers, PR #{pr} ouverte (pas mergée)', { n: e.files_count, pr: e.pr ?? '?' })
}
