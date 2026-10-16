// node --test mods/cockpit/tests/decide.test.mjs - the decision screens (Nuit, Claude ↔ Codex, Galerie), the Claude
// Control card, the left menu and the scanner parts, over invented data only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseTodos, controleCard, nextWake, readyItems, launchCommand, nuitModel, relaisView, roleOf, teamView, controlMap, codexPanel, codexPrice,
} from '../lib/decide.mjs'
import { menuOf, tabValid, nightRepos } from '../hooks/nav.mjs'
import { drawCockpit } from '../hooks/view.mjs'
import { scan, repoRoot } from '../scanner/cards.mjs'
import { renderText, widest } from '../lib/factory/scanner/textrender.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CCFG = JSON.parse(readFileSync(join(HERE, '..', 'cockpit.config.json'), 'utf8'))
const FCFG = JSON.parse(readFileSync(join(HERE, '..', 'lib', 'factory', 'factory.config.json'), 'utf8'))
const NOW = new Date(2026, 9, 16, 22, 0).getTime() // local 22:00
const H = 3600000
const mk = (type) => (props) => ({ type, props })
const el = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') }

const TODO = `# À faire — invented
- [ ] 2026-11-05 · haute · Use the cloud credits · they expire
- [ ] — · haute · Review the rules PR · waits
- [ ] 2026-10-17 · moyenne · Renew the demo key · tomorrow
- [x] 2026-10-01 · basse · Done already · x
`

test('parseTodos / controleCard: open items, soonest deadline first, undated last; tone by days left', () => {
  const t = parseTodos(TODO, NOW)
  assert.deepEqual(t.map((x) => [x.date, x.days_left]), [['2026-10-17', 1], ['2026-11-05', 20], [null, null]])
  const c = controleCard(t, CCFG)
  assert.equal(c.line, '3 à faire · prochaine échéance 17/10 (demain)')
  assert.equal(c.tone, 'bad')
  assert.equal(c.items[0].text, '17/10 · Renew the demo key (moyenne)')
  assert.equal(controleCard(parseTodos('- [ ] 2026-10-30 · haute · x · y', NOW), CCFG).tone, null)
  assert.equal(controleCard(null, CCFG).tone, 'dim')
})

const ROADMAP = `# Roadmap
## Idées de Julian (2026-10-01)
- [ ] an idea, not a lane
## V1
- [ ] Package A: export flow
- [x] Package B: done
- Package C — prêt à lancer
## Done
- [ ] stale line in a done section
`

test('readyItems / launchCommand: ROADMAP lines and packets; ideas and done sections skipped; Lancer only shows', () => {
  const r = readyItems([{ repo: 'app-a', path: 'C:/code/app-a', roadmap: ROADMAP, packets: [{ file: 'handoff/packets/p1.md', title: 'Packet one' }] }], CCFG)
  assert.deepEqual(r.map((x) => [x.kind, x.text]), [['roadmap', 'Package A: export flow'], ['roadmap', 'Package C — prêt à lancer'], ['packet', 'Packet one']])
  const cmd = launchCommand(r[0], CCFG)
  assert.equal(cmd, 'cd "C:/code/app-a" ; claude --model opus --effort medium "Lis handoff/ROADMAP.md et lance : Package A: export flow"')
})

test('nuitModel: running with end time, unused night hours until wake, week burn at the current pace', () => {
  assert.equal(new Date(nextWake('07:30', NOW)).getHours(), 7)
  assert.equal(nextWake('07:30', NOW) - NOW, 9.5 * H)
  const quotas = { claude: { five: { pct: 30 }, week: { pct: 65, ratePerH: 2, runOutAt: NOW + 20 * H } } }
  const m = nuitModel({ running: [{ kind: 'workflow', text: 'Workflow wave', eta: { mid: NOW + 2 * H } }, { kind: 'pipeline', text: 'Pipeline x', eta: null }], quotas,
    ready: [{ repo: 'app-a', path: 'C:/code/app-a', source: 'handoff/ROADMAP.md', kind: 'roadmap', text: 'Package A' }] }, CCFG, NOW)
  assert.equal(m.running[0].left, 'reste 2 h 00')
  assert.match(m.running[1].left, /pas assez d’historique/)
  assert.equal(m.night.line, 'jusqu’à 07:30 : 9,5 h de nuit · 2,0 h occupées par ce qui tourne · 7,5 h inutilisées')
  assert.match(m.night.unknown, /1 élément\(s\) sans heure de fin/)
  assert.equal(m.quota.line, '5 h 30 % · semaine 65 % (reste 35 %)')
  assert.match(m.quota.burn, /~19 % de la semaine au rythme actuel \(2,0 %\/h\)/)
  assert.equal(m.quota.tone, 'warn')
  assert.equal(m.ready[0].label, 'app-a · ROADMAP · Package A')
  assert.match(nuitModel({}, CCFG, NOW).quota.line, /non lus/)
  assert.match(nuitModel({ quotas: { claude: { week: { pct: 10 } } } }, CCFG, NOW).quota.burn, /inconnu/)
})

const REL = {
  generated: '2026-10-16T20:00:00Z', days: 7,
  totals: { prs: 3, by_agent: { claude: { opened: 2, fixed: 1, merged: 1, pr_ci: { success: 3, failed: 1, rate: 75 }, runs: { success: 4, failed: 1, rate: 80 } }, codex: { opened: 1, fixed: 0, merged: 0, pr_ci: { success: 0, failed: 2, rate: 0 }, runs: { success: 0, failed: 0, rate: null } } },
    handoffs: 1, handoffs_by_kind: { 'codex→claude': 1 }, prs_with_handoff: 1, with_dependencies: 1 },
  repos: [
    { name: 'app-a', totals: { prs: 2, prs_with_handoff: 1, by_agent: { claude: { opened: 1, pr_ci: { rate: 100 } }, codex: { opened: 1, pr_ci: { rate: 0 } } } },
      prs: [{ number: 7, state: 'open', opened_by: 'codex', fixed_by: ['claude'], handoffs: ['codex→claude'], depends_on: [5], ci: 'failed', created: '2026-10-16T10:00:00Z', url: 'https://example.invalid/7' },
        { number: 5, state: 'merged', opened_by: 'claude', fixed_by: [], handoffs: [], depends_on: [], ci: 'success', created: '2026-10-15T10:00:00Z' }] },
    { name: 'app-b', totals: { prs: 1, prs_with_handoff: 0, by_agent: { claude: { opened: 1, pr_ci: { rate: 50 } } } }, prs: [] },
  ],
  errors: [],
}

test('relaisView: who does what, hand-offs, dependencies, green rate per agent, per repo, open PRs', () => {
  const r = relaisView(REL, CCFG)
  assert.equal(r.agents[0].text, 'Claude : 2 ouvertes · 1 corrigées · 1 mergées · CI des PR 75 % vert (3/4) · pipelines 80 % vert (4/5)')
  assert.match(r.agents[1].text, /^Codex : 1 ouvertes .* CI des PR 0 % vert \(0\/2\) · pipelines —$/)
  assert.equal(r.handoffs, '1 relais (codex→claude 1) dans 1 PR · 1 PR avec dépendance')
  assert.equal(r.repos[0].text, 'app-a : Claude 1 PR (100 % vert) · Codex 1 PR (0 % vert) · 1 relais')
  assert.deepEqual(r.prs.map((p) => p.text), ['#7 app-a · Codex +Claude · CI failed · relais codex→claude · dépend de #5'])
  assert.equal(relaisView(null, CCFG).available, false)
})

test('teamView: lead, then advisor / worker / explorer / researcher lanes, return to lead', () => {
  assert.equal(roleOf('explore-fast', CCFG), 'explorer')
  assert.equal(roleOf('architect', CCFG), 'advisor')
  assert.equal(roleOf('something', CCFG), 'other')
  const s = { cli: 'c1', app_model: 'claude-opus-5-5', app_effort: 'medium', advisor: 2, advisor_ts: NOW - H, subs: [
    { id: 'a', type: 'coder', desc: 'build', status: 'done', ts: NOW - 2 * H, last_ts: NOW - H, model: 'claude-opus-5-5' },
    { id: 'b', type: 'explore-fast', desc: 'find', status: 'running', ts: NOW - 600000, model: 'claude-haiku-5-5' },
    { id: 'c', type: 'odd', status: 'failed' },
  ] }
  const t = teamView(s, 'Lead conv', CCFG, NOW)
  assert.equal(t.lead, 'Lead · Lead conv · claude-opus-5-5 · medium')
  const by = Object.fromEntries(t.lanes.map((l) => [l.id, l]))
  assert.match(by.advisor.note, /\/advisor consulté 2 fois · dernier 21:00/)
  assert.equal(by.worker.agents[0].state, '↩ rendu au lead 21:00')
  assert.equal(by.explorer.agents[0].state, 'en cours depuis 10 min')
  assert.equal(by.other.agents[0].state, '✕ échec')
  assert.equal(by.researcher.agents.length, 0)
  assert.equal(teamView(null, '', CCFG, NOW).available, false)
})

test('controlMap / codexPanel: layers in one map; Codex approvals, tokens and API-equivalent cost', () => {
  const rows = controlMap({ rules: { title: 'Rules V9' }, settings: { env: 3, hooks: 0, mode: 'plan' }, agents: ['coder', 'tester'], skills: [], workflows: ['wave'], mods: 4, memory: 2 }, CCFG)
  assert.deepEqual(rows.map((r) => r.text), ['Rules V9', 'env 3 · hooks 0 · plan', '2 · coder, tester', '0', '1 · wave', '4', '2 fichier(s)'])
  assert.equal(controlMap(null, CCFG)[0].text, 'non lu')
  assert.deepEqual(codexPrice('gpt-5.6-sol', CCFG), { in: 4, out: 20 })
  assert.equal(codexPrice('gpt-unknown', CCFG), null)
  const c = codexPanel({ available: true, days: 7, byModel: { 'gpt-5-6-sol': [2e6, 1e6, 1e5, 0, 2.1e6], 'gpt-x': [1e6, 0, 0, 0, 1e6] }, approvals: { policies: { never: 3, 'on-request': 1 }, requests: 2, sessions: 4 } }, CCFG)
  assert.equal(c.rows[0].text, 'gpt-5-6-sol : 2,1 M tokens · 6,00 $')
  assert.equal(c.rows[1].text, 'gpt-x : 1,0 M tokens · tarif inconnu')
  assert.equal(c.policy, 'politique d’approbation : never 3, on-request 1')
  assert.equal(c.requests, '2 demande(s) d’approbation · 4 session(s) sur 7 j')
  assert.equal(c.tone, 'warn')
  assert.equal(codexPanel(null, CCFG).available, false)
})

// ---- the pane ------------------------------------------------------------------------------------------------------

const noop = () => {}
const ACT = new Proxy({}, { get: () => noop })
const VIEW = (o) => ({ cfg: CCFG, fcfg: FCFG, scan: { sessions: [] }, nav: { level: 'mega' }, self: null, busy: false, error: '', at: NOW, now: NOW, columns: 75, filter: 'all',
  usage: null, veille: null, open: {}, act: ACT, cards: [], who: 'claude', ...o })

test('menu: the 6 entries in a column at the left; one row on top under min_columns; off', () => {
  assert.equal(menuOf(CCFG, 75).position, 'left')
  assert.equal(menuOf(CCFG, 40).position, 'top')
  assert.equal(menuOf({ ...CCFG, menu: { ...CCFG.menu, position: 'off' } }, 75).position, 'off')
  assert.deepEqual(menuOf(CCFG, 75).items.map((m) => m.label), ['Jauge', 'Cockpit', 'Veille', 'À toi', 'Registres', 'Référence'])
  for (const cols of [60, 75]) {
    const text = renderText(drawCockpit(el, VIEW({ tab: 'home', columns: cols })), cols)
    const lines = text.split('\n')
    assert.deepEqual(lines.slice(0, 6).map((l) => l.slice(0, 12).trim()), ['[Jauge]', '[Cockpit]', '[Veille]', '[À toi]', '[Registres]', '[Référence]'], text)
    assert.ok(widest(text) <= cols, `${widest(text)} > ${cols}`)
  }
  const top = renderText(drawCockpit(el, VIEW({ tab: 'home', columns: 40 })), 40)
  assert.match(top.split('\n')[0], /^\[Jauge\] \[Cockpit\] \[Veille\]/)
  assert.ok(tabValid(CCFG, 'nuit') && tabValid(CCFG, 'relais') && !tabValid(CCFG, 'quotas'))
})

test('pane: « Bilan avant la nuit » at 60 and 75 columns: running, night, quota, ready + Lancer, then the choice', () => {
  const data = { running: [{ kind: 'workflow', text: 'Workflow wave', eta: { mid: NOW + 2 * H } }], quotas: { claude: { five: { pct: 30 }, week: { pct: 60, ratePerH: 2 } } },
    ready: readyItems([{ repo: 'app-a', path: 'C:/code/app-a', roadmap: ROADMAP, packets: [] }], CCFG) }
  for (const cols of [60, 75]) {
    const text = renderText(drawCockpit(el, VIEW({ tab: 'nuit', columns: cols, nuitData: data, launch: 0 })), cols)
    const order = ['Bilan avant la nuit', 'Ce qui tourne', 'Workflow wave', 'reste 2 h 00', 'inutilisées', 'semaine 60 %', 'Prêt à lancer', '[Lancer]', 'claude --model opus', 'Que fait la nuit', '[Nuit active (/veille nuit)]', '[Rien]', '[Jour (/veille jour)]'].map((k) => text.indexOf(k))
    assert.ok(order.every((i) => i >= 0), text)
    assert.deepEqual([...order].sort((a, b) => a - b), order, text)
    assert.ok(widest(text) <= cols, `${widest(text)} > ${cols}`)
  }
})

test('pane: Claude ↔ Codex and Galerie tabs draw their views', () => {
  const r = renderText(drawCockpit(el, VIEW({ tab: 'relais', relaisData: REL })), 75)
  assert.match(r, /Qui fait quoi[\s\S]*Claude : 2 ouvertes[\s\S]*Passages de relais[\s\S]*#7 app-a/)
  assert.match(renderText(drawCockpit(el, VIEW({ tab: 'relais', relaisData: null })), 75), /\/ci relais refresh/)
  const team = { cli: 'c1', model: 'claude-opus-5-5', subs: [{ id: 'a', type: 'coder', status: 'done', last_ts: NOW }] }
  const g = renderText(drawCockpit(el, VIEW({ tab: 'galerie', galView: 'equipe', teamSession: team, teamTitle: 'Lead' })), 75)
  assert.match(g, /\[Équipe\] \[Carte\] \[Codex\][\s\S]*Lead · Lead[\s\S]*Workers \(1\)[\s\S]*↩ rendu au lead 22:00/)
  const m = renderText(drawCockpit(el, VIEW({ tab: 'galerie', galView: 'carte', galerieData: { map: { agents: ['coder'], mods: 3 } } })), 75)
  assert.match(m, /Carte du contrôle[\s\S]*Agents[\s\S]*1 · coder[\s\S]*Mods[\s\S]*3/)
  const cx = renderText(drawCockpit(el, VIEW({ tab: 'galerie', galView: 'codex', galerieData: { codex: { available: true, days: 7, byModel: {}, approvals: { policies: { never: 1 }, requests: 0, sessions: 1 } } } })), 75)
  assert.match(cx, /approbations et coût[\s\S]*never 1[\s\S]*0 demande/)
})

// ---- scanner parts over a temp home ---------------------------------------------------------------------------------

test('scanner: nuit reads ROADMAP and packets per repo (worktrees folded), galerie counts layers and Codex approvals', () => {
  assert.equal(repoRoot('C:/code/app-a/.claude/worktrees/x/sub'), 'C:/code/app-a')
  const home = mkdtempSync(join(tmpdir(), 'cockpit-decide-'))
  const repo = join(home, 'code', 'app-a').replace(/\\/g, '/')
  mkdirSync(join(repo, 'handoff', 'packets'), { recursive: true })
  writeFileSync(join(repo, 'handoff', 'ROADMAP.md'), ROADMAP)
  writeFileSync(join(repo, 'handoff', 'packets', 'p1.md'), '# Packet one\nbody')
  writeFileSync(join(repo, 'handoff', 'GO-lane-b.md'), '# Lane B go\n')
  writeFileSync(join(repo, 'handoff', 'NOTES.md'), '# not a packet\n')
  const n = scan({ now: NOW, home, parts: ['nuit'], repos: [repo + '/.claude/worktrees/w1', repo] })
  assert.equal(n.nuit.repos.length, 1)
  assert.deepEqual(n.nuit.repos[0].packets.map((p) => [p.file, p.title]).sort(), [['handoff/GO-lane-b.md', 'Lane B go'], ['handoff/packets/p1.md', 'Packet one']])
  // galerie
  const ch = join(home, '.claude')
  mkdirSync(join(ch, 'agents'), { recursive: true })
  mkdirSync(join(ch, 'skills', 'handoff'), { recursive: true })
  mkdirSync(join(ch, 'usage-mod'), { recursive: true })
  writeFileSync(join(ch, 'agents', 'coder.md'), 'x')
  writeFileSync(join(ch, 'CLAUDE.md'), '# Rules V9\n')
  writeFileSync(join(ch, 'settings.json'), JSON.stringify({ env: { A: '1', CLAUDE_CODE_PLUGIN_DIRS: 'C:/m/a;C:/m/b' }, permissions: { defaultMode: 'plan' } }))
  const d = new Date(NOW)
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  writeFileSync(join(ch, 'usage-mod', 'codex.json'), JSON.stringify({ available: true, days: { [key]: { 'gpt-5-6-sol': [10, 5, 2, 0, 12] } } }))
  const day = join(home, '.codex', 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
  mkdirSync(day, { recursive: true })
  const roll = join(day, 'rollout-x.jsonl')
  writeFileSync(roll, [{ type: 'turn_context', payload: { approval_policy: 'on-request' } }, { type: 'event_msg', payload: { type: 'exec_approval_request' } }].map((x) => JSON.stringify(x)).join('\n') + '\n')
  const cache = join(home, 'cache.json')
  const g = scan({ now: NOW, home, parts: ['galerie'], cache }).galerie
  assert.deepEqual([g.map.rules.title, g.map.settings.env, g.map.settings.mode, g.map.agents, g.map.skills, g.map.mods], ['Rules V9', 2, 'plan', ['coder'], ['handoff'], 2])
  assert.deepEqual(g.codex.byModel['gpt-5-6-sol'], [10, 5, 2, 0, 12])
  assert.deepEqual(g.codex.approvals, { policies: { 'on-request': 1 }, requests: 1, sessions: 1 })
  // a second pass reads only what was appended
  writeFileSync(roll, readFileSync(roll, 'utf8') + JSON.stringify({ type: 'event_msg', payload: { type: 'apply_patch_approval_request' } }) + '\n')
  assert.equal(scan({ now: NOW, home, parts: ['galerie'], cache }).galerie.codex.approvals.requests, 2)
  // cards part: the Claude Control card from the to-do file
  mkdirSync(join(ch, 'a-faire'), { recursive: true })
  writeFileSync(join(ch, 'a-faire', 'claude-control.md'), TODO)
  assert.equal(scan({ now: NOW, home, parts: ['cards'] }).controle.count, 3)
})

test('nightRepos: folders of recent, non-archived conversations plus day_night.repos', () => {
  const s = { sessions: [{ cwd: 'C:\\code\\a', last_activity: NOW / 1000 }, { cwd: 'C:/code/b', archived: true, last_activity: NOW / 1000 }, { cwd: 'C:/code/c', last_activity: (NOW - 30 * 24 * H) / 1000 }] }
  assert.deepEqual(nightRepos(s, { ...CCFG, day_night: { repos: ['C:/code/z'], recent_days: 7 } }, NOW), ['C:/code/a', 'C:/code/z'])
})
