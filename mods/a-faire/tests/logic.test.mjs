// a-faire: parsers, setup gaps that close by themselves, done / snooze, counter, veille feed.
//   node --test mods/a-faire/tests/logic.test.mjs
// Every fixture is invented and written to a temp folder here: no real backlog, PR or alert is committed.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { collect, loadConfig, scan } from '../lib/collect.mjs'
import { veilleFeed } from '../lib/feed.mjs'
import {
  applyState, codeSpans, counterText, countToFile, feedOf, gapItems, groups, hash, markDone, markSnooze, parseClaudeControl,
  parseDecisions, parseManualChecks, parseQuestions, prItems, summary, veilleItems,
} from '../lib/items.mjs'
import { modsNotLoaded } from '../lib/mods-check.mjs'
import { dueText, initialOpen, viewModel } from '../hooks/view.mjs'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const LOGIN = /\b(login|sign[- ]?in|2FA|tenant|password)\b/i

const MANUAL = `# Manual checks
2026-10-10 · demo-app 1.0 · the slider at 200 % DPI · open Settings, drag the slider, \`demo.exe --dpi 200\`
~~2026-10-11 · demo-app · done already · nothing~~ FAIT
2026-10-12 · demo-cloud · tenant sign-in for the demo workspace · log in with your 2FA
2026-10-13 · claude-mod · create an app password and ~/.claude/veille/smtp.json · then test-mail
not a dated line
`

const QUESTIONS = `2026-10-01 · demo-app · Which colour for the logo? · blue for now · waits for Julian
2026-10-02 · demo-app · Rename the repo? · kept · agent decided
- 2026-10-03 · demo-lib · ship V2 tonight? · nothing taken · product decisions listed for Julian
`

const DECISIONS = `# Decisions pending (invented)

## 0. Backup

⚠ **Your action:** copy \`C:/demo/passphrase.txt\` into your password manager.

## 1. CI

| # | Decision | Facts | R |
|---|---|---|---|
| 1.1 | Use the **demo runner** | It is idle. | Approve \`demo-runner enable\`. |
| ~~1.2~~ | ~~Old item~~ | done | — |

## Already decided

| 9.1 | Not open | x | y |
`

test('manual-checks: one item per dated open line; struck lines skipped; logins sorted; gap lines dropped', () => {
  const gap = gapItems({ now: NOW, veilleInstalled: true, veilleHome: '/h/.claude/veille', smtpProblem: 'smtp.json absent' })
  const items = parseManualChecks(MANUAL, { file: 'manual-checks.md', loginRe: LOGIN, gaps: gap })
  assert.equal(items.length, 2)
  assert.equal(items[0].cat, 'manual')
  assert.match(items[0].title, /^demo-app 1.0 : the slider/)
  assert.ok(items[0].steps.some((s) => s.copy === 'demo.exe --dpi 200'))
  assert.equal(items[0].since, Date.parse('2026-10-10T09:00:00'))
  assert.equal(items[1].cat, 'logins')
  assert.equal(parseManualChecks(MANUAL, { gaps: [] }).length, 3, 'without the gap, the smtp line is a manual item')
})

test('questions: only lines that say they wait for Julian', () => {
  const re = loadConfig(mkdtempSync(join(tmpdir(), 'af-q-'))).sources.questions.match
  const items = parseQuestions(QUESTIONS, { match: re })
  assert.deepEqual(items.map((i) => i.title), ['demo-app : Which colour for the logo?', 'demo-lib : ship V2 tonight?'])
  assert.equal(items[0].cat, 'decisions')
  assert.match(items[0].why, /blue for now/)
})

test('decisions: open rows and « Your action », struck rows and the decided section skipped', () => {
  const items = parseDecisions(DECISIONS, { file: 'DECISIONS.md' })
  assert.deepEqual(items.map((i) => i.title), ['copy C:/demo/passphrase.txt into your password manager.', '1.1 Use the demo runner'])
  assert.equal(items[0].prio, 'feature')
  assert.deepEqual(items[0].steps, [{ text: 'C:/demo/passphrase.txt', copy: 'C:/demo/passphrase.txt' }])
  assert.ok(items[1].steps.some((s) => s.copy === 'demo-runner enable'))
  assert.match(items[1].source.label, /DECISIONS.md › 1. CI/)
})

test('PRs: a label or one sentence naming Julian with approve/decide; loose mentions ignored', () => {
  const prs = [
    { title: 'V9 draft', number: 7, url: 'https://github.com/o/r/pull/7', repository: { nameWithOwner: 'o/r' }, body: 'Rules from zero. Not to be merged before Julian approves.', labels: [] },
    { title: 'Fix (Julian, 16 Oct)', number: 8, url: 'https://github.com/o/r/pull/8', repository: { nameWithOwner: 'o/r' }, body: 'The agent decided to keep it.', labels: [] },
    { title: 'Pick a name', number: 9, url: 'https://github.com/o/s/pull/9', repository: { nameWithOwner: 'o/s' }, body: '', labels: [{ name: 'needs-julian' }] },
  ]
  const items = prItems(prs, { labels: ['needs-julian'] })
  assert.deepEqual(items.map((i) => i.title), ['r#7 : V9 draft', 's#9 : Pick a name'])
  assert.match(items[0].why, /before Julian approves/)
  assert.equal(items[0].steps[0].copy, 'gh pr view https://github.com/o/r/pull/7 --web')
})

test('veille: unacked « attend Julian » alerts; logins by their words', () => {
  const state = { alerts: {
    a: { key: 'a', julian: true, what: 'Attend Julian : choisir le nom', title: 'Lane A', since: NOW - 3600000, session_link: 'claude://x/1' },
    b: { key: 'b', julian: true, what: 'Attend Julian : Cloudflare sign-in', title: 'Lane B' },
    c: { key: 'c', julian: true, what: 'acked', title: 'Lane C' },
    d: { key: 'd', julian: false, what: 'PR verte' },
  } }
  const items = veilleItems(state, ['c'], { loginRe: LOGIN })
  assert.deepEqual(items.map((i) => [i.cat, i.prio]), [['questions', 'now'], ['logins', 'now']])
  assert.equal(items[0].source.href, 'claude://x/1')
})

test('setup gaps: mods not loaded, task missing or dead, secrets counted', () => {
  const m = modsNotLoaded([{ name: 'band', path: 'D:/x/mods/band' }, { name: 'a-faire', path: 'D:/x/mods/a-faire' }], 'D:/x/mods/band;D:/y/factory')
  assert.deepEqual(m.notLoaded.map((x) => x.name), ['a-faire'])
  assert.equal(m.value, 'D:/x/mods/band;D:/y/factory;D:/x/mods/a-faire')
  const f = { now: NOW, veilleInstalled: true, veilleHome: '/h', smtpProblem: '', mods: { ...m, settings: 's.json' },
    task: { checked: true, present: true, lastFire: NOW - 60 * 60000, everyMin: 5, name: 'ClaudeVeille' }, secrets: { count: countToFile({ items: [{ status: 'À ranger' }, { status: 'rangé' }, { state: 'à ranger' }] }) } }
  const items = gapItems(f)
  assert.deepEqual(items.map((i) => i.id), ['gap:mods', 'gap:task', 'gap:secrets'])
  assert.match(items[1].title, /ne tourne plus/)
  assert.match(items[2].title, /^2 secret/, '« rangé » is not « à ranger »')
  assert.equal(gapItems({ ...f, task: { ...f.task, lastFire: NOW - 60000 } }).some((i) => i.id === 'gap:task'), false)
})

test('done: a manual item closes; an auto item is re-checked and stays until its cause is gone; snooze hides a day', () => {
  const items = [{ id: 'm1', auto: false, title: 'x', prio: 'comfort', cat: 'manual' }, { id: 'gap:smtp', auto: true, title: 'smtp', why: 'smtp.json absent', prio: 'feature', cat: 'config' }]
  let r = markDone({}, items, 'gap:smtp', NOW)
  assert.equal(r.ok, false)
  assert.match(r.msg, /pas encore fait : smtp.json absent/)
  r = markDone(r.state, items, 'm1', NOW)
  assert.equal(r.ok, true)
  const s = markSnooze(r.state, 'gap:smtp', NOW, 1)
  let v = applyState(items, s.state, NOW + 1000)
  assert.equal(v.open.length, 0)
  assert.equal(v.snoozed.length, 1)
  v = applyState(items, s.state, NOW + 86400000 + 1)
  assert.deepEqual(v.open.map((i) => i.id), ['gap:smtp'])
})

test('counter: « À toi : N » only when something is open', () => {
  const open = [{ cat: 'config', prio: 'now' }, { cat: 'manual', prio: 'comfort' }]
  const sum = summary(open, [], NOW)
  assert.equal(counterText(sum), 'À toi : 2')
  assert.equal(sum.high, 1)
  assert.equal(sum.by_cat.config, 1)
  assert.equal(counterText(summary([], [], NOW)), '')
  assert.equal(counterText(null), '')
})

test('feed: wanted priorities, not veille\'s own alerts, once', () => {
  const open = [{ id: 'a', src: 'gaps', prio: 'feature', title: 'a' }, { id: 'b', src: 'veille', prio: 'now', title: 'b' }, { id: 'c', src: 'manual', prio: 'comfort', title: 'c' }]
  assert.deepEqual(feedOf(open, {}).map((i) => i.id), ['a'])
  assert.deepEqual(feedOf(open, { a: NOW }).map((i) => i.id), [])
})

test('view: categories in order, unfolded when they hold items, one-line summaries', () => {
  const cfg = loadConfig(mkdtempSync(join(tmpdir(), 'af-v-')))
  const data = { at: NOW, open: [{ id: 'x', cat: 'decisions', prio: 'feature', title: 'Pick a name', why: 'w', steps: [], since: NOW - 7200000 }], snoozed: [{}], errors: [] }
  const open = initialOpen(cfg, data)
  assert.deepEqual(open, ['decisions'])
  const vm = viewModel(cfg, data, open, NOW)
  assert.deepEqual(vm.cats.map((c) => c.label), ['Configuration', 'Claude Control', 'Décisions', 'Connexions / 2FA', 'Secrets à ranger', 'Tests manuels', 'Questions des conversations'])
  assert.equal(vm.cats[2].summary, 'Pick a name')
  assert.equal(vm.cats[2].items[0].sinceText, 'depuis 2 h')
  assert.equal(vm.cats[0].summary, 'rien')
  assert.equal(vm.snoozed, 1)
  assert.equal(vm.title, 'À toi · 1')
})

test('scan end to end on fixture files: smtp gap auto-closes when smtp.json appears; summary has counts only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'af-e2e-'))
  try {
    const home = join(dir, 'a-faire'), veille = join(dir, 'veille'), mods = join(dir, 'mods')
    mkdirSync(veille, { recursive: true })
    for (const m of ['band', 'demo']) { mkdirSync(join(mods, m, '.claude-plugin'), { recursive: true }); writeFileSync(join(mods, m, '.claude-plugin', 'plugin.json'), '{}') }
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: join(mods, 'band') } }))
    writeFileSync(join(dir, 'manual.md'), MANUAL)
    writeFileSync(join(dir, 'questions.md'), QUESTIONS)
    writeFileSync(join(dir, 'decisions.md'), DECISIONS)
    writeFileSync(join(veille, 'state.json'), JSON.stringify({ alerts: { k: { key: 'k', julian: true, what: 'Attend Julian : oui ou non', title: 'Lane', since: NOW - 60000 } } }))
    writeFileSync(join(dir, 'registry.json'), JSON.stringify([{ status: 'à ranger' }]))
    const cfg = loadConfig(home)
    cfg.sources.manual_checks.file = join(dir, 'manual.md')
    cfg.sources.questions.file = join(dir, 'questions.md')
    cfg.sources.decisions.files = [join(dir, 'decisions.md')]
    cfg.sources.veille.home = veille
    cfg.sources.mods.roots = [mods]
    cfg.sources.mods.settings = join(dir, 'settings.json')
    cfg.sources.secrets.registry = join(dir, 'registry.json')
    const opts = { now: NOW, prs: [{ title: 'Draft', number: 1, url: 'https://github.com/o/r/pull/1', repository: { nameWithOwner: 'o/r' }, body: 'Wait until Julian decides.' }], taskQuery: async () => ({ present: true }) }

    let r = await scan(cfg, opts)
    const by = r.summary.by_cat
    assert.deepEqual(by, { config: 2, claude_control: 0, decisions: 5, logins: 1, secrets: 1, manual: 1, questions: 1 })
    assert.ok(r.open.some((i) => i.id === 'gap:smtp'))
    assert.equal(counterText(r.summary), 'À toi : 11')
    assert.equal(JSON.stringify(r.summary).includes('Draft'), false, 'summary carries counts only')

    // « Fait » on the smtp item while smtp.json is missing: refused; once the file is filled, the item is gone.
    assert.equal(markDone(r.state, r.items, 'gap:smtp', NOW).ok, false)
    writeFileSync(join(veille, 'smtp.json'), JSON.stringify({ host: 'smtp.example.org', port: 587, user: 'u', password: 'p', from: 'a', to: 'b' }))
    r = await scan(cfg, opts)
    assert.equal(r.open.some((i) => i.id === 'gap:smtp'), false)
    assert.equal(r.open.filter((i) => i.cat === 'manual').length, 1, 'the manual smtp line stays hidden: the gap is closed')

    // the feed pushes each new high item once
    const feed1 = await veilleFeed({ ...opts, cfg })
    assert.ok(feed1.length >= 3)
    assert.ok(feed1.every((a) => a.key.startsWith('afaire:') && /^À faire : /.test(a.what) && ['now', 'feature'].includes(a.prio)))
    assert.equal(feed1.some((a) => /oui ou non/.test(a.what)), false, 'veille already pushes its own alerts')
    assert.deepEqual(await veilleFeed({ ...opts, cfg }), [], 'pushed once')
    const { items } = await collect(cfg, opts)
    assert.ok(items.every((i) => i.id && i.cat && i.prio && i.title))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('helpers', () => {
  assert.deepEqual(codeSpans('run `a b` then `c`'), ['a b', 'c'])
  assert.equal(hash('x'), hash('x'))
  assert.notEqual(hash('x'), hash('y'))
})

test('Claude Control: « - [ ] échéance · priorité · quoi · pourquoi · comment », sorted by deadline, done lines skipped', () => {
  const md = [
    '# À faire (inventé)',
    '- [ ] — · haute · Valider la démo · une PR attend · lire la PR',
    '- [ ] 2026-11-05 · haute · Utiliser les crédits de démo · ils expirent · `demo --use`',
    '- [x] 2026-10-01 · haute · Déjà fait · rien · rien',
    '- [ ] 2026-10-20 · basse · Nettoyer le disque de démo · plein · mod Ménage',
    '- [ ] ~~2026-10-02 · basse · barré · x · y~~',
  ].join('\n')
  const items = parseClaudeControl(md, { file: 'claude-control.md' })
  assert.deepEqual(items.map((i) => [i.title, i.prio, i.dueDay]), [
    ['Valider la démo', 'feature', ''], ['Utiliser les crédits de démo', 'feature', '2026-11-05'], ['Nettoyer le disque de démo', 'comfort', '2026-10-20'],
  ])
  assert.deepEqual(items[1].steps.map((s) => s.copy).filter(Boolean), ['demo --use'])
  const [g] = groups(items, ['claude_control'])
  assert.deepEqual(g.items.map((i) => i.title), ['Nettoyer le disque de démo', 'Utiliser les crédits de démo', 'Valider la démo'])
  const now = Date.parse('2026-10-17T12:00:00')
  assert.equal(dueText(items[1], now), 'échéance 2026-11-05 (J-19)')
  assert.equal(dueText({ ...items[2], due: Date.parse('2026-10-16T09:00:00'), dueDay: '2026-10-16' }, now), 'échéance 2026-10-16 (dépassée)')
  const vm = viewModel({ order: ['claude_control'], categories: { claude_control: 'Claude Control' }, labels: {} }, { open: items }, ['claude_control'], now)
  assert.equal(vm.cats[0].label, 'Claude Control')
  assert.equal(vm.cats[0].items[0].sinceText, 'échéance 2026-10-20 (J-3)')
})
