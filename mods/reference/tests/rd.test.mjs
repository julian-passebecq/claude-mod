// Référence: À essayer, R&D, Repos and Exporter pour audit (pure parts and the scanner on invented folders).
//   node --test mods/reference/tests/rd.test.mjs
// Every document, repo and config here is invented and written to a temp folder.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { clean, denied, envOf, manifest, pluginDirs } from '../lib/rd/audit.mjs'
import { STATES, itemsOf, manualTodo, nextState, overlay, sections, setState, testsTodo } from '../lib/rd/essais.mjs'
import { dateIn, docInfo, sourcesOf, tables } from '../lib/rd/md.mjs'
import { aheadBehind, lastCommit, prsOf, slugOf, stateLine, updateBlocker } from '../lib/rd/repos.mjs'
import { names, zip } from '../lib/rd/zip.mjs'
import { auditExport, context, essais, rdIndex, repos } from '../scanner/rd_scan.mjs'

const CFG = JSON.parse(readFileSync(new URL('../reference.config.json', import.meta.url), 'utf8'))

const DOC = `# Fonctions à essayer (3 oct 2026)

Une note d'introduction assez longue pour le résumé, avec un lien https://example.com/docs/a.

## 1. Outils

| Fonction | Ce que c'est | Source | On l'utilise ? | Intérêt | Test proposé |
|---|---|---|---|---|---|
| Outil A | Un outil en aperçu, payant via usage credits | https://example.com/a | non | haut | essayer sur un dépôt de test |
| Outil B | Déjà là | https://example.com/b | oui | fait | — |
| Outil C | Une boucle | https://example.com/c | non par choix | bas | — |
| Outil D | Une moitié | https://example.org/d | partiel | moyen | comparer au mod |
| Outil E | Pas pour nous | https://example.org/e | non | nul | ne pas tester |

## Notes

| Colonne | Autre |
|---|---|
| sans | intérêt |
`

test('tables and doc info: sections, cells, date, subject, three lines, sources', () => {
  const t = tables(DOC)
  assert.equal(t.length, 2)
  assert.equal(t[0].section, '1. Outils')
  assert.equal(t[0].rows.length, 5)
  assert.equal(dateIn('veille-web-2026-10-16.md'), '2026-10-16')
  assert.equal(dateIn('Idées (16 oct 2026)'), '2026-10-16')
  const info = docInfo('features.md', DOC, Date.parse('2026-01-02'))
  assert.equal(info.subject, 'Fonctions à essayer (3 oct 2026)')
  assert.equal(info.date, '2026-10-03')
  assert.equal(info.summary.length, 1)
  assert.match(info.summary[0], /^Une note d'introduction/)
  assert.deepEqual(sourcesOf(DOC), { count: 6, hosts: ['example.com', 'example.org'] })
  const html = docInfo('rapport.html', '<html><head><title>Rapport du jour</title></head><body><p>Premier paragraphe du rapport ici.</p><p>Second paragraphe du rapport là.</p></body></html>')
  assert.equal(html.subject, 'Rapport du jour')
  assert.deepEqual(html.summary, ['Premier paragraphe du rapport ici.', 'Second paragraphe du rapport là.'])
})

test('À essayer: one item per row, default state from the rules, cost and risk inferred, presets and own state win', () => {
  const items = itemsOf('features.md', DOC, CFG.essais)
  assert.deepEqual(items.map((i) => [i.name, i.state]), [['Outil A', 'jamais'], ['Outil B', 'adopté'], ['Outil C', 'écarté'], ['Outil D', 'en test'], ['Outil E', 'écarté']])
  const a = items[0]
  assert.equal(a.test, 'essayer sur un dépôt de test')
  assert.match(a.cost, /usage credits/)
  assert.match(a.risk, /aperçu/)
  assert.equal(items[1].test, '')
  const states = setState({}, a.id, 'en test', 5)
  assert.deepEqual(states, { v: 1, items: { [a.id]: { state: 'en test', at: 5 } } })
  const all = overlay(items, { presets: [{ match: '^Outil D$', state: 'adopté', why: 'preset' }], extra: CFG.essais.extra, states: states.items })
  assert.equal(all.find((i) => i.id === a.id).state, 'en test')
  assert.equal(all.find((i) => i.id === a.id).own, true)
  assert.equal(all.find((i) => i.name === 'Outil D').state, 'adopté')
  const jev = all.find((i) => i.id === 'extra:jev')
  assert.equal(jev.state, 'écarté')
  assert.equal(jev.alternative, '/advisor')
  const secs = sections(all)
  assert.deepEqual(secs.map((s) => s.state), ['en test', 'jamais', 'adopté', 'écarté'])
  assert.deepEqual(secs[0].items.map((i) => i.name), ['Outil A'])
  assert.equal(nextState('jamais'), 'en test')
  assert.equal(nextState('écarté'), 'jamais')
  assert.deepEqual(STATES, ['jamais', 'en test', 'adopté', 'écarté'])
})

test('Ce qu’on doit tester: open manual checks and tests-reels never run', () => {
  const md = '2026-10-01 · demo-app · le curseur à 200 % · ouvrir Réglages\n~~2026-10-02 · demo · fait · rien~~\n2026-10-03 · demo · connexion · DONE by me\n'
  assert.deepEqual(manualTodo(md), [{ src: 'manual', date: '2026-10-01', project: 'demo-app', what: 'le curseur à 200 %', how: 'ouvrir Réglages' }])
  const reg = { apps: [{ name: 'demo-app', procedures: [{ name: 'parcours A', env: 'qa' }, { name: 'parcours B' }], manual_checks: [{ date: '2026-10-04', what: 'son', status: 'à faire' }, { what: 'vu', status: 'fait' }] }] }
  const todo = testsTodo(reg, [{ app: 'Demo-App', procedure: 'parcours B' }])
  assert.deepEqual(todo.map((t) => t.what), ['parcours A', 'son'])
})

test('repos: git outputs, state line, update only on a clean main', () => {
  assert.deepEqual(aheadBehind('2\t5'), { ahead: 2, behind: 5 })
  assert.equal(aheadBehind('fatal: no upstream'), null)
  assert.deepEqual(lastCommit('abc1234\t1700000000\tfix: a thing'), { sha: 'abc1234', at: 1700000000000, subject: 'fix: a thing' })
  assert.equal(slugOf('https://github.com/demo-owner/demo-repo.git'), 'demo-owner/demo-repo')
  assert.equal(slugOf(['git', 'github.com:demo-owner/demo-repo.git'].join('@')), 'demo-owner/demo-repo')
  assert.equal(slugOf('https://gitlab.com/x/y.git'), '')
  assert.deepEqual(prsOf('[{"number":3,"title":"t","url":"https://github.com/o/r/pull/3","x":1}]'), [{ number: 3, title: 't', url: 'https://github.com/o/r/pull/3' }])
  const r = { exists: true, branch: 'main', main: 'main', sync: { ahead: 0, behind: 4 }, dirty: 0 }
  assert.equal(stateLine(r), 'main · 4 en retard · 0 en avance')
  assert.equal(updateBlocker(r), '')
  assert.equal(updateBlocker({ ...r, branch: 'feature' }), 'branche feature et non main')
  assert.equal(updateBlocker({ ...r, dirty: 2 }), '2 fichier(s) modifié(s)')
})

test('audit: deny list, masked env, held secrets, manifest, zip', () => {
  for (const p of ['veille/smtp.json', 'claude/.credentials.json', 'local/x/github-token.txt', 'projects/a/b.jsonl', 'x/.env']) assert.equal(denied(p), true, p)
  assert.equal(denied('claude/agents/coder.md'), false)
  assert.equal(denied('claude/skills/synced/x/SKILL.md', CFG.audit.deny), true)
  assert.deepEqual(envOf({ env: { GITHUB_TOKEN: 'abc', CLAUDE_CODE_PLUGIN_DIRS: 'C:/m/a;C:/m/b', NOTE: 'mail demo.person@example.net' } }), {
    GITHUB_TOKEN: '«masqué:clé-sensible»', CLAUDE_CODE_PLUGIN_DIRS: 'C:/m/a;C:/m/b', NOTE: 'mail «masqué:email»',
  })
  assert.deepEqual(pluginDirs('C:/m/a; "C:/m/b"'), ['C:/m/a', 'C:/m/b'])
  const fake = 'gh' + 'p_' + 'A'.repeat(36)
  const ok = clean('local/a.json', `{"note": "${fake}"}`)
  assert.equal(ok.ok, true)
  assert.match(ok.text, /«masqué:github-token»/)
  const held = clean('local/b.txt', '-----BEGIN RSA PRIVATE ' + 'KEY-----\nabc')
  assert.equal(held.ok, false)
  assert.match(held.why, /secret non masquable/)
  assert.equal(clean('mods/x/lib/secrets.mjs', 'export const a = 1', { names: false }).ok, true)
  const man = manifest({ at: '2026-10-16T12:00:00Z', mods: [{ name: 'demo', version: '0.1.0', commit: 'abc', loaded: true }], files: ['a'], held: [{ name: 'b', why: 'x' }], counts: { email: 2 }, plugin_dirs: ['C:/m/demo'], commit: 'abc' })
  assert.match(man, /\| demo \| 0\.1\.0 \| abc \| oui \|/)
  assert.match(man, /email 2/)
  assert.match(man, /- b : x/)
  assert.deepEqual(names(zip([{ name: 'MANIFEST.md', data: man }, { name: 'a/b.json', data: '{}' }])), ['MANIFEST.md', 'a/b.json'])
})

test('scanner on an invented home: essais, rd index, repos, audit zip without secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ref-rd-'))
  try {
    const home = join(dir, 'home').replace(/\\/g, '/')
    const research = join(dir, 'control', 'docs', 'v6-research')
    mkdirSync(research, { recursive: true })
    writeFileSync(join(research, 'features-a-essayer.md'), DOC)
    writeFileSync(join(research, 'autre.md'), '# Autre sujet\n\nUne autre recherche avec assez de texte.\n')
    const cd = `${home}/.claude`
    for (const d of ['agents', 'veille', 'effort-board', 'a-faire', 'tests-reels', 'projects/p']) mkdirSync(`${cd}/${d}`, { recursive: true })
    writeFileSync(`${cd}/CLAUDE.md`, '# Règles\n')
    writeFileSync(`${cd}/agents/coder.md`, '---\nname: coder\n---\n')
    writeFileSync(`${cd}/settings.json`, JSON.stringify({ env: { API_TOKEN: 'x', MODE: 'demo' } }))
    writeFileSync(`${cd}/ci.config.json`, '{"a":1}')
    writeFileSync(`${cd}/a-faire/config.json`, '{"refresh_min":5}')
    writeFileSync(`${cd}/a-faire/items.json`, '{"raw":true}')
    writeFileSync(`${cd}/veille/state.json`, '{"alerts":{}}')
    writeFileSync(`${cd}/veille/smtp.json`, '{"password":"hunter2"}')
    writeFileSync(`${cd}/projects/p/t.jsonl`, '{}')
    writeFileSync(`${cd}/effort-board/manual-checks.md`, '2026-10-01 · demo · regarder · ouvrir\n')
    const mods = join(dir, 'repo', 'mods')
    mkdirSync(join(mods, 'demo', '.claude-plugin'), { recursive: true })
    writeFileSync(join(mods, 'demo', '.claude-plugin', 'plugin.json'), '{"name":"demo","version":"1.2.3"}')
    writeFileSync(join(mods, 'demo', 'README.md'), '# demo\n')
    const cfg = { ...CFG, repo_paths: { 'claude-control': join(dir, 'control').replace(/\\/g, '/') }, repos: [{ name: 'claude-control', main: 'main' }, { name: 'nowhere', path: join(dir, 'none') }] }
    cfg.audit = { ...CFG.audit, out_dir: `${home}/.claude/audit-exports` }
    const c = context({ cfg, home, modsDir: mods.replace(/\\/g, '/'), pluginDirs: ['C:/x/demo'], now: Date.parse('2026-10-16T12:00:00Z') })
    const e = essais(c)
    assert.deepEqual(e.docs.map((d) => d.name), ['features-a-essayer.md'])
    assert.equal(e.items.length, 5)
    assert.equal(e.todo.length, 1)
    const idx = rdIndex(c)
    assert.equal(idx.groups[0].docs.length, 2)
    assert.equal(idx.groups[0].docs.find((d) => d.name === 'features-a-essayer.md').date, '2026-10-03')
    assert.equal(idx.groups[1].missing, true)
    const rp = repos(c)
    assert.equal(rp.repos[0].exists, false) // a plain folder, no .git
    assert.equal(rp.repos[1].exists, false)
    const r = auditExport(c)
    assert.equal(r.ok, true)
    assert.match(r.file, /audit-exports\/audit-2026-10-16-\d{6}\.zip$/)
    const list = names(readFileSync(r.file))
    assert.equal(list[0], 'MANIFEST.md')
    for (const want of ['mods/demo/README.md', 'local/ci.config.json', 'local/a-faire/config.json', 'env/settings-env.json', 'env/CLAUDE_CODE_PLUGIN_DIRS.txt', 'claude/CLAUDE.md', 'claude/agents/coder.md', 'veille/state.json']) assert.ok(list.includes(want), want)
    for (const never of ['veille/smtp.json', 'local/a-faire/items.json']) assert.ok(!list.includes(never), never)
    assert.ok(!list.some((n) => n.endsWith('.jsonl')))
    assert.ok(!readFileSync(r.file).includes(Buffer.from('hunter2')))
    // the CLI answers JSON on stdout from a request on stdin
    const cli = spawnSync(process.execPath, [new URL('../scanner/rd_scan.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'rd'], { input: JSON.stringify({ cfg, home, modsDir: mods, now: 1 }), encoding: 'utf8' })
    assert.equal(cli.status, 0, cli.stderr)
    assert.equal(JSON.parse(cli.stdout).groups[0].docs.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
