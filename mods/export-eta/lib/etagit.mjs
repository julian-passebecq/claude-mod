// export-eta - lands files in the eta repo through a PR: fresh `git worktree add` from origin/<base>, the caller writes
// its files, a final confidentiality check on every written file, commit, push, `gh pr create`, squash merge per the
// merge policy, remote branch deleted, worktree removed. Never a push to <base>, never a force-push.
// Shared with the problemes mod (byte copy in mods/problemes/lib/eta/, scripts/sync-libs.mjs there, drift-tested).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { check } from './mask.mjs'

export const expand = (p) => String(p || '').replace(/^~(?=[\\/]|$)/, os.homedir()).replace(/%([A-Z_]+)%/gi, (m, k) => process.env[k] ?? m)

export const fillVars = (s, vars = {}) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m))

/** Masking options from a config: own e-mails kept readable, extra rules and pattern files. */
export function maskOpts(cfg, ownExtra = []) {
  return {
    own_emails: [...(cfg.own_emails || []), ...ownExtra].filter(Boolean), allow_email_domains: cfg.allow_email_domains || [],
    extra_patterns: cfg.extra_patterns || [], file_patterns: cfg.file_patterns || [], hold_patterns: cfg.hold_patterns || [],
    mask_paths: !!cfg.mask_paths,
  }
}

export function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: opts.timeoutMs || 300000, cwd: opts.cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } })
  const out = { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() || (r.error ? String(r.error.message) : '') }
  if (opts.must && out.code !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${(out.err || out.out).split('\n').pop()}`)
  return out
}

export function stamp(ms) {
  const d = new Date(ms)
  const p = (x) => String(x).padStart(2, '0')
  return { day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, hm: `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` }
}

/**
 * The whole git flow. opts: { eta: { repo, base, branch, worktree_dir, merge, checks_timeout_min }, home (where the PR
 * body file goes), mask: config for maskOpts, addPaths: what `git add` stages, title, nowMs,
 * produce(worktree, ownEmails) → { touched: [relative paths written], body: PR body, empty?: reason } }.
 * Returns { branch, pr, url, merged, error, produced }.
 */
export function landInEta(opts) {
  const E = opts.eta || {}
  const repo = expand(E.repo || '')
  if (!repo || !fs.existsSync(path.join(repo, '.git'))) throw new Error(`eta.repo non réglé ou introuvable (${repo || 'vide'})`)
  const base = E.base || 'main'
  const st = stamp(opts.nowMs || Date.now())
  const branch = fillVars(E.branch || 'export/conversations-{day}-{hm}', st)
  const wt = path.join(repo, fillVars(E.worktree_dir || '.claude/worktrees/export-{day}-{hm}', st))
  sh('git', ['-C', repo, 'fetch', '-q', 'origin', base], { must: true })
  sh('git', ['-C', repo, 'worktree', 'add', '-q', '-b', branch, wt, `origin/${base}`], { must: true })
  const out = { branch, pr: null, url: null, merged: false, error: '', produced: null, pushed: false }
  try {
    const own = sh('git', ['-C', wt, 'config', 'user.email']).out
    const produced = opts.produce(wt, own ? [own] : [])
    out.produced = produced
    if (produced.empty) { out.error = produced.empty; return out }
    // Final pass on what will be committed: the same rules, on the files as written.
    const mo = maskOpts(opts.mask || {}, own ? [own] : [])
    for (const f of produced.touched) {
      const abs = path.join(wt, f)
      if (!fs.existsSync(abs)) continue
      const hits = check(fs.readFileSync(abs, 'utf8'), mo)
      if (hits.length) throw new Error(`passe de confidentialité finale : ${f} (${hits.map((h) => h.kind).join(', ')}) ; rien n'est poussé`)
    }
    sh('git', ['-C', wt, 'add', '-A', '--', ...(opts.addPaths || ['.'])], { must: true })
    if (!sh('git', ['-C', wt, 'diff', '--cached', '--name-only']).out) { out.error = 'aucun changement (déjà exporté à l’identique)'; return out }
    sh('git', ['-C', wt, 'commit', '-q', '-m', `${opts.title}\n\n${produced.commit || ''}`.trim()], { must: true })
    sh('git', ['-C', wt, 'push', '-q', '-u', 'origin', branch], { must: true })
    out.pushed = true
    fs.mkdirSync(opts.home, { recursive: true })
    const bodyFile = path.join(opts.home, 'pr-body.md')
    fs.writeFileSync(bodyFile, produced.body || opts.title)
    const pr = sh('gh', ['pr', 'create', '--base', base, '--head', branch, '--title', opts.title, '--body-file', bodyFile], { cwd: wt, must: true })
    out.url = (pr.out.match(/https:\/\/\S+\/pull\/\d+/) || [])[0] || null
    out.pr = out.url ? Number(out.url.split('/').pop()) : null
    const policy = E.merge || 'checks-or-scan'
    if (out.pr && policy !== 'never') {
      const checks = sh('gh', ['pr', 'checks', String(out.pr)], { cwd: wt })
      const none = /no checks reported/i.test(checks.err + checks.out) || (!checks.out && checks.code !== 0 && !/fail/i.test(checks.err))
      let ok = none && policy !== 'checks'
      if (!none) {
        const w = sh('gh', ['pr', 'checks', String(out.pr), '--watch', '--fail-fast'], { cwd: wt, timeoutMs: (E.checks_timeout_min || 30) * 60000 })
        ok = w.code === 0
        if (!ok) out.error = 'checks pas verts : PR laissée ouverte'
      } else if (!ok) out.error = 'aucun check et merge: checks : PR laissée ouverte'
      if (ok) {
        const m = sh('gh', ['pr', 'merge', String(out.pr), '--squash'], { cwd: wt })
        out.merged = m.code === 0 || /already merged/i.test(m.err)
        if (!out.merged) out.error = `merge : ${(m.err || m.out).split('\n').pop()}`
        else sh('git', ['-C', wt, 'push', '-q', 'origin', '--delete', branch])
      }
    }
    return out
  } finally {
    sh('git', ['-C', repo, 'worktree', 'remove', wt])
    // Merged, or never pushed (nothing to export, a failed check): the local branch has no use. An open PR keeps it.
    if (out.merged || !out.pushed) sh('git', ['-C', repo, 'branch', '-D', branch])
  }
}
