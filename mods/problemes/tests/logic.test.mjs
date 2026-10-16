// problemes mod: detection, classification, ledger fold, seeds, view helpers, and a full collection over made-up
// transcripts and session files written to a temp folder.
//   node --test mods/problemes/tests/logic.test.mjs
// Invented names, ids and paths only; the temp folder is removed at the end.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import {
  applyFilters, appOf, classify, dateOf, fold, hitsOfRecord, hitsOfSession, mdBlocks, nextId, normText, parseLines, planLines,
  seedFromFindings, seedFromIncidents, seedFromMarkdown, seedLines, signatureOf, slash, statusOf, summaryOf, totals, tree, weekStart,
} from '../lib/core.mjs'

const tmp = slash(mkdtempSync(join(tmpdir(), 'problemes-test-')))
after(() => rmSync(tmp, { recursive: true, force: true }))
const shipped = JSON.parse(readFileSync(new URL('../problemes.config.json', import.meta.url), 'utf8'))
const RULES = shipped.rules.list
const NOW = new Date(2026, 9, 16, 12, 0).getTime()
const iso = ms => new Date(ms).toISOString()

const ask = (ts, q, extra = {}) => ({ type: 'assistant', timestamp: iso(ts), cwd: 'C:/code/shop/.claude/worktrees/wf_abc123-1', message: { model: 'm', content: [{ type: 'tool_use', id: `tu-${ts}`, name: 'AskUserQuestion', input: { questions: [{ question: q }] } }] }, ...extra })
const err = (ts, text, id = `x-${ts}`) => ({ type: 'user', timestamp: iso(ts), message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: text }] } })
const final = (ts, text) => ({ type: 'assistant', timestamp: iso(ts), message: { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text }] } })

test('normText removes paths, ids and numbers', () => {
  assert.equal(normText('This agent is isolated in the worktree C:\\code\\shop\\.claude\\worktrees\\wf_ab12cd-3 (42 files)'), 'this agent is isolated in the worktree <chemin> (N files)')
  assert.equal(normText('Session 3F2A9C1E-1111-4222-8333-444455556666 failed'), 'session <id> failed')
})

test('appOf: worktrees count as their repo, roots give the first folder below', () => {
  assert.equal(appOf('C:/code/shop/.claude/worktrees/x'), 'shop')
  assert.equal(appOf('C:\\code\\shop\\packages\\api', ['C:/code']), 'shop')
  assert.equal(appOf('C:/code/shop/packages/api', ['<PROJECTS_ROOT>']), 'api')
  assert.equal(appOf(''), '')
})

test('hitsOfRecord: ask, trailing question, BLOCKED, denied, tool errors, workflow and CI failures, API errors', () => {
  const ctx = { session: 's1', file: 'f', sub: false, tools: new Map() }
  assert.equal(hitsOfRecord(ask(NOW, 'Merge now?'), ctx)[0].kind, 'ask')
  assert.equal(ctx.cwd, 'C:/code/shop/.claude/worktrees/wf_abc123-1')
  assert.deepEqual(hitsOfRecord(final(NOW, 'Done.\n\nShall I also archive the old sessions?'), ctx).map(h => h.kind), ['trailing_question'])
  assert.deepEqual(hitsOfRecord(final(NOW, 'Nothing merged.\nBLOCKED: CI red twice on the same fix'), ctx).map(h => [h.kind, h.text]), [['blocked', 'CI red twice on the same fix']])
  assert.equal(hitsOfRecord(final(NOW, 'All merged.'), ctx).length, 0)
  assert.equal(hitsOfRecord(final(NOW, 'Want more?'), { ...ctx, sub: true }).length, 0, 'sub-agent finals are not questions to Julian')
  assert.equal(hitsOfRecord(err(NOW, "The user doesn't want to proceed with this tool use."), ctx)[0].kind, 'denied')
  assert.equal(hitsOfRecord(err(NOW, 'Exit code 2'), ctx)[0].kind, 'tool_error')
  // A gh checks call and its failing (non-error) output.
  hitsOfRecord({ type: 'assistant', message: { model: 'm', content: [{ type: 'tool_use', id: 'g1', name: 'Bash', input: { command: 'gh pr checks 12 --watch' } }] } }, ctx)
  const ci = hitsOfRecord({ type: 'user', timestamp: iso(NOW), message: { content: [{ type: 'tool_result', tool_use_id: 'g1', content: 'tests\tfail\t2m' }] } }, ctx)
  assert.equal(ci[0].kind, 'ci_failure')
  assert.match(ci[0].text, /^gh pr checks 12 --watch → tests fail/)
  hitsOfRecord({ type: 'assistant', message: { model: 'm', content: [{ type: 'tool_use', id: 'w1', name: 'Workflow', input: {} }] } }, ctx)
  assert.equal(hitsOfRecord({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'w1', content: '{"agents_error": 2}' }] } }, ctx)[0].kind, 'workflow_error')
  assert.equal(hitsOfRecord({ type: 'system', subtype: 'api_error', timestamp: iso(NOW), error: { status: 401, type: 'authentication_error' } }, ctx)[0].kind, 'api_error')
})

test('hitsOfSession: needs_action and directories granted', () => {
  const hits = hitsOfSession({ cliSessionId: 'c1', cwd: 'C:/code/shop', title: 'Lane A', lastActivityAt: NOW, postTurnSummary: { needs_action: 'confirm the merge of !12' }, sessionPermissionUpdates: [{ type: 'addDirectories', directories: ['C:\\code\\other'] }] })
  assert.deepEqual(hits.map(h => h.kind), ['needs_action', 'permission_dir'])
  assert.equal(hits[1].text, 'dossier ajouté : C:/code/other')
  assert.ok(hits[0].key.startsWith('na:c1:'))
  assert.deepEqual(hitsOfSession({ postTurnSummary: { needs_action: '' } }), [])
})

test('shipped rules classify the common hits; routine edit errors are ignored', () => {
  const c = (kind, text, sub = false) => classify({ kind, text, tool: '', sub }, RULES)?.id
  assert.equal(c('ask', 'q'), 'ask-main')
  assert.equal(c('ask', 'q', true), 'ask-sub')
  assert.equal(c('tool_error', 'This agent is isolated in the worktree C:/x; write there'), 'worktree-guard')
  assert.equal(c('tool_error', "Remove-Item on system path '/c' is blocked. This path is protected from removal."), 'rm-protected')
  assert.equal(c('denied', "The user doesn't want to proceed with this tool use."), 'denied')
  assert.equal(c('tool_error', 'PreToolUse:Write hook error: nope'), 'hook-error')
  assert.equal(c('tool_error', '<tool_use_error>File has been modified since read'), 'routine-edit')
  assert.equal(c('ci_failure', 'glab ci status → failed'), 'ci-gitlab')
  assert.equal(c('ci_failure', 'gh pr checks → no checks reported'), 'ci-skipped')
  assert.equal(c('tool_error', 'Exit code 1'), undefined)
  assert.equal(c('seed', 'App guards fired repeatedly'), 'seed-guard')
  for (const r of RULES) {
    if (r.ignore) continue
    assert.ok(r.category, `${r.id} has a category`)
    const ids = new Set(); const walk = n => { ids.add(n.id); (n.children ?? []).forEach(walk) }; shipped.categories.forEach(walk)
    assert.ok(r.category === 'apps' || ids.has(r.category), `${r.id} → ${r.category} is in the tree`)
  }
})

test('signatures: per app, key capture, text', () => {
  const r = RULES.find(x => x.id === 'hook-error')
  const a = signatureOf({ text: 'PreToolUse:Write hook error: x', app: 'shop' }, r)
  assert.equal(a, 'hook-error:pretooluse:write')
  assert.equal(signatureOf({ text: 'q', app: 'shop' }, RULES[0]), 'ask-main:@shop')
  assert.equal(signatureOf({ text: 'Same Thing 12', app: '' }, { id: 'x', by: 'text' }), 'x:same thing N')
})

test('planLines adds once per signature, then bumps count and last seen; a fixed problem that comes back is reopened', () => {
  const h = (at, text, app = 'shop') => ({ kind: 'tool_error', text, at, app, session: `s-${at}`, tool: '', sub: false })
  const first = planLines([h(NOW - 5000, 'This agent is isolated in the worktree A'), h(NOW - 4000, 'This agent is isolated in the worktree B'), h(NOW, 'Exit code 1')], [], RULES, NOW)
  assert.deepEqual(first.lines.map(l => l.op), ['add', 'seen'])
  assert.equal(first.lines[0].id, 'P-001')
  assert.equal(first.lines[1].n, 2)
  assert.equal(first.ignored, 1)
  assert.match(first.unmatched[0][0], /^tool_error: exit code N/)
  let problems = fold(first.lines)
  assert.equal(problems[0].count, 2)
  assert.equal(problems[0].category, 'workflow/gardes')
  assert.match(problems[0].title, /\(shop\)/)
  const fixedAt = NOW + 1000
  problems = fold([...first.lines, { op: 'update', id: 'P-001', at: fixedAt, fields: { status: 'corrigé' } }])
  assert.equal(problems[0].status, 'corrigé')
  const again = planLines([h(NOW + 9000, 'This agent is isolated in the worktree C')], problems, RULES, NOW + 10000)
  assert.deepEqual(again.lines.map(l => l.op), ['update', 'seen'])
  const end = fold([...first.lines, { op: 'update', id: 'P-001', at: fixedAt, fields: { status: 'corrigé' } }, ...again.lines])
  assert.equal(end.length, 1)
  assert.deepEqual([end[0].status, end[0].count, end[0].last_seen, end[0].timeline.length], ['ouvert', 3, NOW + 9000, 2])
  const other = planLines([h(NOW, 'This agent is isolated in the worktree D', 'blog')], end, RULES, NOW)
  assert.equal(other.lines[0].id, 'P-002', 'per_app: another app is another problem')
})

test('fold: notes, updates, torn lines, unknown status refused', () => {
  const text = [
    JSON.stringify({ op: 'add', id: 'P-001', at: 1, signature: 's', category: 'mods', title: 'T', status: 'ouvert' }),
    JSON.stringify({ op: 'note', id: 'P-001', at: 2, text: 'compris' }),
    JSON.stringify({ op: 'update', id: 'P-001', at: 3, fields: { status: 'pas un statut', fix: 'PR #4' } }),
    JSON.stringify({ op: 'note', id: 'P-999', at: 4, text: 'orphan' }),
    '{"op":"seen","id":"P-0',
  ].join('\n')
  const [p] = fold(parseLines(text))
  assert.deepEqual([p.status, p.fix, p.notes[0].text], ['ouvert', 'PR #4', 'compris'])
  assert.equal(nextId([p]), 'P-002')
})

test('markdown seeds: tables by column names, bullets only where allowed, statuses', () => {
  const md = [
    '# Register', '## A. Stalls', '| # | When | What | Duration | Cause | Source |', '|---|---|---|---|---|---|',
    '| A1 | 2 Oct 04:38 | CI idle, nothing woke the lead | 6 h | monitors died | notes.md |',
    '## B. Defects', '| # | Defect | Effect | Status |', '|---|---|---|---|',
    '| B1 | Alarm ignored skipped pipelines | missed | not fixed |', '| B2 | Guard fired on previews | clicks | fixed in PR #9 |',
    '## C. Errors by Claude', '- Asked Julian for a token that already existed (fixed).', '## D. Open questions', '- Why?',
  ].join('\n')
  const { tables, bullets } = mdBlocks(md)
  assert.equal(tables.length, 2)
  assert.equal(bullets.length, 2)
  const src = { id: 'reg', label: 'register.md', category: 'workflow/claude', sections: [{ match: '^A\\.', category: 'workflow/arrets' }, { match: '^C\\.', bullets: true }, { match: '^D\\.', skip: true }] }
  const seeds = seedFromMarkdown(md, src, RULES, NOW)
  assert.deepEqual(seeds.map(s => s.ref), ['reg:a. stalls:A1', 'reg:b. defects:B1', 'reg:b. defects:B2', 'reg:c. errors by claude:asked julian for a token that already existed (fix'])
  assert.equal(seeds[0].category, 'workflow/arrets')
  assert.equal(seeds[0].cause, 'monitors died')
  assert.match(seeds[0].symptom, /durée : 6 h/)
  assert.equal(new Date(seeds[0].first_seen).getDate(), 2)
  assert.deepEqual([seeds[1].status, seeds[1].category], ['ouvert', 'ci/skipped'])
  assert.deepEqual([seeds[2].status, seeds[2].category], ['corrigé', 'app/gardes'])
  assert.deepEqual([seeds[3].status, seeds[3].category], ['corrigé', 'blocages/question'])
  const lines = seedLines(seeds, [], NOW)
  assert.equal(lines.filter(l => l.op === 'add').length, 4)
  assert.equal(seedLines(seeds, fold(lines), NOW).length, 0, 'imported once')
})

test('audit-style tables: columns by their first word, Y/N, a cause table with title_from', () => {
  const md = [
    '## Blocks (2)', "| # | Time | Session (project) | What stopped / Julian's answer | Cause | Y/N |", '|---|---|---|---|---|---|',
    '| 1 | 00:20 | Lane A (shop) | "Check the login in a browser" | legit: his logins | N |',
    '| 2 | 17:18 | Lane B | "Tu veux que je les lance ?" | rule gap: offer | Y |',
    '## Totals', '| Cause | Count |', '|---|---|', '| offers | 7 |',
    '## Top causes', '| # | Cause (blocks) | Fix landed today | Still needed |', '|---|---|---|---|', '| 1 | Offers (9) | PR #7 | one more line |',
  ].join('\n')
  const src = { id: 'mb', sections: [{ match: '^Blocks', fallback: 'blocages/question' }, { match: '^Top', category: 'regles/trous', title_from: 'cause' }] }
  const s = seedFromMarkdown(md, src, RULES, NOW)
  assert.deepEqual(s.map(x => [x.ref, x.status, x.category]), [
    ['mb:blocks (N):1', 'accepté', 'blocages/question'], ['mb:blocks (N):2', 'ouvert', 'blocages/fin-de-tour'], ['mb:top causes:1', 'ouvert', 'regles/trous'],
  ])
  assert.match(s[0].symptom, /où : Lane A \(shop\) · évitable : N/)
  assert.equal(s[2].title, '1 · Offers (9)')
  assert.equal(s[2].fix, 'PR #7 · reste : one more line')
})

test('incident and finding seeds', () => {
  const inc = seedFromIncidents({ incidents: [{ id: 'INC-01', title: 'Chip explosion', dates: '29 Sept - 1 Oct', evidence: 'many chips', root_cause: 'no cap', fix: 'cap', fix_status: 'fixed', sources: ['a.md'] }] }, { id: 'inc' }, RULES, NOW)
  assert.deepEqual([inc[0].ref, inc[0].status, inc[0].category], ['inc:INC-01', 'corrigé', 'blocages/carte'])
  const fi = seedFromFindings({ findings: [{ id: 'F-1', claim: 'ok', verdict: 'worked', status: 'applied' }, { id: 'F-2', claim: 'no effect', verdict: 'did not', status: 'applied', date: '2026-09-25' }, { id: 'F-3', claim: 'x', verdict: 'unclear', status: 'reverted' }] }, { id: 'fi' }, NOW)
  assert.deepEqual(fi.map(f => f.ref), ['fi:F-2'])
  assert.equal(new Date(fi[0].first_seen).getMonth(), 8)
  assert.equal(statusOf('kept off by choice'), 'accepté')
  assert.equal(dateOf('nothing', 7), 7)
})

test('view: totals this week, filters, tree with an app cross view, summaries', () => {
  const ws = weekStart(NOW)
  assert.equal(new Date(ws).getDay(), 1)
  const mk = (id, category, status, first, app = '') => ({ id, category, status, first_seen: first, last_seen: first, app, apps: app ? [app] : [], title: `t${id}`, timeline: [{ at: first, n: 2 }], count: 2 })
  const ps = [mk('P-001', 'workflow/gardes', 'ouvert', NOW - 3600000, 'shop'), mk('P-002', 'ci/skipped', 'corrigé', NOW - 20 * 86400000, 'blog'), mk('P-003', 'apps/shop', 'ouvert', NOW - 60000, 'shop'), mk('P-004', 'weird/x', 'accepté', NOW - 60000)]
  assert.deepEqual(totals(ps, NOW), { open: 2, fixed: 1, other: 1, week: 3, week_seen: 6 })
  assert.deepEqual(applyFilters(ps, { status: 'ouvert' }, NOW).map(p => p.id), ['P-001', 'P-003'])
  assert.deepEqual(applyFilters(ps, { category: 'ci' }, NOW).map(p => p.id), ['P-002'])
  assert.deepEqual(applyFilters(ps, { app: 'shop', week: 'this' }, NOW).map(p => p.id), ['P-001', 'P-003'])
  const nodes = tree(ps, shipped.categories, { other: 'Autres' })
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  assert.deepEqual([byId.workflow.total, byId.workflow.open], [1, 1])
  assert.equal(byId.workflow.children.find(c => c.id === 'workflow/gardes').problems[0].id, 'P-001')
  assert.deepEqual(byId.apps.children.map(c => [c.label, c.total]), [['shop', 2], ['blog', 1]])
  assert.equal(byId.apps.cross, true)
  assert.equal(byId.autres.problems[0].id, 'P-004')
  assert.match(summaryOf(byId.workflow), /^P-001 tP-001$/)
  assert.equal(summaryOf(byId.mods, 2, 'rien'), 'rien')
})

test('collector: reads new bytes only, dedupes, keeps session keys, imports seeds once, writes notes', async () => {
  const home = `${tmp}/home`
  const proj = `${home}/.claude/projects/C--code-shop`
  mkdirSync(`${proj}/sess-1/subagents`, { recursive: true })
  const sessions = `${tmp}/app-sessions/a/b`
  mkdirSync(sessions, { recursive: true })
  const now = Date.now()
  const rec = [ask(now - 60000, 'Merge now?'), err(now - 50000, 'This agent is isolated in the worktree C:/code/shop/.claude/worktrees/wf_1. Write there.'), err(now - 40000, '<tool_use_error>File has been modified since read'), final(now - 30000, 'BLOCKED: tests red twice')]
  writeFileSync(`${proj}/sess-1.jsonl`, rec.map(r => JSON.stringify({ ...r, cwd: 'C:/code/shop' })).join('\n') + '\n')
  writeFileSync(`${proj}/sess-1/subagents/agent-a1.jsonl`, JSON.stringify({ ...ask(now - 20000, 'Which branch?'), cwd: 'C:/code/shop/.claude/worktrees/x' }) + '\n')
  writeFileSync(`${sessions}/local_1.json`, JSON.stringify({ cliSessionId: 'sess-1', cwd: 'C:/code/shop', title: 'Lane', lastActivityAt: now, postTurnSummary: { needs_action: 'approve the deploy' } }))
  const dir = `${home}/.claude/problemes`
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${home}/reg.md`, '## A. x\n| # | What | Status |\n|---|---|---|\n| A1 | Runner offline at night | not fixed |\n')
  writeFileSync(`${dir}/problemes.config.json`, JSON.stringify({ collect: { sessions: [`${tmp}/app-sessions`], roots: ['C:/code'] }, seed: { sources: [{ id: 'reg', path: `${home}/reg.md` }, { id: 'later', path: `${home}/missing.md`, optional: true }] } }))
  process.env.PROBLEMES_HOME_DIR = home
  process.env.MODS_HEALTH = '0'
  const S = await import('../scanner/problemes_scan.mjs')
  const cfg = S.config()
  assert.equal(cfg.data_dir, dir)
  const s1 = S.collect(cfg, { now })
  assert.deepEqual([s1.files, s1.sessions, s1.hits, s1.ignored], [2, 1, 6, 1])
  let snap = JSON.parse(readFileSync(`${dir}/problems.json`, 'utf8'))
  const titles = snap.problems.map(p => p.title).sort()
  assert.deepEqual(titles, [
    'Fin BLOCKED (shop)', 'Fin de tour qui attend une action de Julian (shop)', 'Garde worktree : écriture hors du worktree de l\'agent (shop)',
    'Questions AskUserQuestion à Julian (shop)', 'Un sous-agent pose une question AskUserQuestion',
  ])
  assert.equal(snap.totals.open, 5)
  // Second run: nothing new; then one more line appended is read alone.
  const s2 = S.collect(cfg, { now: now + 1000 })
  assert.deepEqual([s2.files, s2.hits], [0, 0])
  writeFileSync(`${proj}/sess-1.jsonl`, rec.map(r => JSON.stringify({ ...r, cwd: 'C:/code/shop' })).join('\n') + '\n' + JSON.stringify({ ...ask(now, 'Again?'), cwd: 'C:/code/shop' }) + '\n')
  const s3 = S.collect(cfg, { now: now + 2000 })
  assert.deepEqual([s3.files, s3.hits, s3.new], [1, 1, 0])
  snap = JSON.parse(readFileSync(`${dir}/problems.json`, 'utf8'))
  const askP = snap.problems.find(p => p.title.startsWith('Questions AskUserQuestion'))
  assert.equal(askP.count, 2)
  // Seeds, once; the optional missing source is skipped without error.
  const r1 = S.importSeeds(cfg, now + 3000)
  assert.deepEqual(r1.map(x => [x.id, x.imported]), [['reg', 1], ['later', 0], ['veille-web', 0]])
  assert.equal(r1[2].error, 'absente (optionnelle)', 'no claude-control repo under the invented roots')
  assert.equal(r1[1].error, 'absente (optionnelle)')
  assert.equal(S.importSeeds(cfg, now + 4000)[0].imported, 0)
  // Notes and status changes go to the ledger only.
  S.addNote(cfg, askP.id, 'décidé : plus de question pour les merges')
  assert.throws(() => S.addNote(cfg, 'P-999', 'x'), /absent/)
  S.setField(cfg, askP.id, 'status', 'corrigé')
  assert.throws(() => S.setField(cfg, askP.id, 'status', 'fini'), /statut inconnu/)
  S.snapshot(cfg)
  snap = JSON.parse(readFileSync(`${dir}/problems.json`, 'utf8'))
  const p = snap.problems.find(x => x.id === askP.id)
  assert.deepEqual([p.status, p.notes[0].text], ['corrigé', 'décidé : plus de question pour les merges'])
  const ledger = readFileSync(`${dir}/register.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l).op)
  assert.ok(ledger.includes('note') && ledger.includes('update'))
})

test('veille-web pitfalls: the shipped builtin source reads every « Pièges » section, classes and « non confirmé » tags', async () => {
  const S = await import('../scanner/problemes_scan.mjs')
  const dir = `${tmp}/research`
  mkdirSync(dir, { recursive: true })
  const doc = d => [`# Veille web, ${d}`, '## 1. Top 10', '- Une idée forte à essayer', '## 3. Pièges rapportés',
    '- Projects : chaque fil recharge tout (forum, non confirmé).', '- Cascade de sous-agents : limite hebdo en minutes (non confirmé).',
    '- Workflow qui rapporte "succès" alors qu\'un agent a sauté son étape (corrigé 9.9.9).', '- Limites hebdo : quotas exacts non publiés.',
    '- Régression 9.9.8 : un écran casse.', '## 4. À faire', '- Tester X'].join('\n')
  writeFileSync(`${dir}/veille-web-2026-01-05.md`, doc('5 janv'))
  writeFileSync(`${dir}/veille-web-2026-01-12.md`, doc('12 janv'))
  writeFileSync(`${dir}/autre.md`, doc('x'))
  const { git, ...b } = shipped.seed.builtin['veille-web']
  assert.equal(git.repo, '{root}/claude-control', 'no private path in the shipped config')
  const cfg = { env: {}, collect: { roots: [] }, seed: { builtin: { 'veille-web': { ...b, dir, files: git.files } } } }
  assert.deepEqual(S.seedSources(cfg).map(s => s.id), ['veille-web'])
  assert.deepEqual(S.seedSources({ seed: { builtin: { 'veille-web': { ...b, enabled: false } } } }), [])
  const xs = S.expandSource(S.seedSources(cfg)[0], cfg)
  assert.deepEqual(xs.map(x => [x.id, x.ref_id, x.date]), [
    ['veille-web:veille-web-2026-01-05.md', 'veille-web', '2026-01-05T12:00:00'], ['veille-web:veille-web-2026-01-12.md', 'veille-web', '2026-01-12T12:00:00']])
  const seeds = xs.flatMap(x => seedFromMarkdown(readFileSync(x.path, 'utf8'), x, RULES, Date.parse(x.date)))
  assert.equal(seeds.length, 10, 'only the « Pièges » bullets')
  const lines = seedLines(seeds, [], NOW)
  const adds = lines.filter(l => l.op === 'add')
  assert.equal(adds.length, 5, 'the same pitfall in two weekly files is imported once')
  assert.deepEqual(adds.map(a => [a.category, a.status, a.title.startsWith('non confirmé · ')]), [
    ['quota/projects', 'ouvert', true], ['quota/sous-agents', 'ouvert', true], ['workflow/succes-a-tort', 'ouvert', false],
    ['quota/limites', 'ouvert', true], ['app/versions', 'ouvert', false]])
  assert.match(adds[0].cause, /non confirmé par la source \(claude-control main:docs\/v6-research\/veille-web · veille-web-2026-01-05\.md\)/)
  const cats = shipped.categories.flatMap(c => [c.id, ...(c.children ?? []).map(x => x.id)])
  for (const a of adds) assert.ok(cats.includes(a.category), `${a.category} is a shipped category`)
})
