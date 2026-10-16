// Guide tree, table of contents and mod cards: node --test mods/guide/tests/guide.test.mjs (Node 22.18+ strips the types)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { canBlock, card, commandsIn, drawsIn, eventsIn, modsMarkdown, modulePath } from '../hooks/cards.ts'
import { anchors, between, locate, parse, slug, tocMarkdown, withToc } from '../hooks/toc.ts'

const here = new URL('..', import.meta.url)
const md = readFileSync(new URL('MODE-EMPLOI.md', here), 'utf8').replace(/\r\n/g, '\n')
const catalog = JSON.parse(readFileSync(new URL('mods.json', here), 'utf8'))
const doc = parse(md)

const TABS = ['Démarrer', 'Jauge', 'Cockpit', 'Veille', 'À toi', 'Registres', 'Référence', 'La nuit', 'Possible ou pas avec les mods', 'À essayer', 'Écrire un mod', 'Nos mods', 'FAQ et pièges']

test('MODE-EMPLOI.md has the agreed tabs, each with categories and sub-sections', () => {
  assert.equal(doc.title, "Mode d'emploi des mods")
  assert.deepEqual(doc.tabs.map(t => t.title), TABS)
  for (const t of doc.tabs) {
    assert.ok(t.cats.length > 0, `${t.title} has categories`)
    for (const c of t.cats) if (t.id !== 'nos-mods' || c.id === 'fiches') assert.ok(c.subs.length > 0, `${t.title} › ${c.title} has sub-sections`)
  }
})

test('every anchor is unique and the table of contents is up to date', () => {
  const ids = anchors(doc)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(withToc(md), md, 'run node mods/guide/scripts/build.mjs')
  const toc = /<!-- toc:start -->\n([\s\S]*?)\n<!-- toc:end -->/.exec(md)[1]
  for (const id of ids) assert.ok(toc.includes(`](#${id})`), `toc links #${id}`)
})

test('the guide talks about mods only and cites the official docs', () => {
  // Codex is a button and a tab of the Cockpit (Claude ↔ Codex); plans and other chat products stay out
  const prose = md.replace(/<!-- mods:start -->[\s\S]*?<!-- mods:end -->/, '')
  assert.doesNotMatch(prose, /\b(abonnement|subscription|ChatGPT)\b/i)
  assert.ok((md.match(/https:\/\/code\.claude\.com\/docs\/en\/plugins\//g) ?? []).length >= 30)
  assert.match(md, /non vérifié/)
  assert.match(md, /non vérifié dans l'app/)
})

test('the user guide: the day, the night, the limits, the ideas, old commands, data and updates', () => {
  const ids = anchors(doc)
  for (const id of ['ma-journée', 'bilan-avant-la-nuit', 'ce-qui-ne-tourne-pas', 'ce-quun-mod-ne-peut-pas-faire', 'les-cinq-premiers', 'anciennes-commandes', 'tes-données', 'mettre-à-jour'])
    assert.ok(ids.includes(id), id)
  const old = doc.tabs[0].cats.find(c => c.id === 'anciennes-commandes').subs.map(s => s.body).join('\n')
  for (const cmd of ['/factory', '/machine', '/conso', '/problemes', '/tests', '/regles', '/menage', '/config-claude', '/control', '/mods-guide', '/scenarios', '/sante', '/ci', '/export-eta', '/a-toi'])
    assert.ok(old.includes('`' + cmd), cmd)
  const ideas = doc.tabs.find(t => t.id === 'à-essayer').cats[0].subs.map(s => s.title).join(' | ')
  for (const x of ['Projects', 'claude agents', '/advisor', '/skill-doctor', 'Auto-continue']) assert.ok(ideas.includes(x), x)
})

test('slug follows GitHub anchors; parse ignores headings in code fences', () => {
  assert.equal(slug('Le trio $, e, next'), 'le-trio--e-next')
  assert.equal(slug('Où vivent les mods'), 'où-vivent-les-mods')
  assert.equal(slug('Avec CLAUDE_CODE_PLUGIN_DIRS'), 'avec-claude_code_plugin_dirs')
  const d = parse('# T\n\nintro\n\n## A\n\nai\n\n### B\n\nbody\n\n```sh\n## not a tab\n```\n\n#### C\n\nc body\n')
  assert.equal(d.tabs.length, 1)
  assert.equal(d.tabs[0].intro, 'ai')
  assert.match(d.tabs[0].cats[0].body, /## not a tab/)
  assert.equal(d.tabs[0].cats[0].subs[0].body, 'c body')
  assert.equal(tocMarkdown(d), '- [A](#a)\n  - [B](#b)\n    - [C](#c)')
})

test('locate: a Sommaire link leads to its tab, unfolds its category, marks its sub-section', () => {
  assert.deepEqual(locate(doc, 'cockpit'), { tab: 'cockpit', cat: '', sub: '' })
  assert.deepEqual(locate(doc, 'galerie'), { tab: 'cockpit', cat: 'galerie', sub: '' })
  assert.deepEqual(locate(doc, 'commandes-slash'), { tab: 'écrire-un-mod', cat: 'interface', sub: 'commandes-slash' })
  assert.equal(locate(doc, 'nowhere'), undefined)
})

test('cards come from the mod source: events, commands, panes, blocking', () => {
  const src = `
    on('session.start', async ($, e, next) => { await $.command.register({ name: 'demo', description: 'x' }); return next(e) })
    on("ui.render", { component: 'Pane', requestId: 'demo' }, () => null)
    on('tool.call', ($, e, next) => next(e))
    $.ui.toast('hi')`
  assert.deepEqual(eventsIn(src), ['session.start', 'ui.render', 'tool.call'])
  assert.deepEqual(commandsIn(src), ['/demo'])
  assert.deepEqual(drawsIn(src), ['panneau', 'toasts'])
  assert.equal(canBlock(src), false)
  assert.equal(canBlock(`on('tool.call', () => ({ deny: 'no' }))`), true)
  assert.equal(modulePath('{ "modules": ["./register.tsx"] }'), 'hooks/register.tsx')
  assert.equal(modulePath('nope'), undefined)
})

test('a card reads plugin.json and userConfig; a missing mod falls back to mods.json', () => {
  const entry = catalog.mods.find(m => m.dir === 'scenarios')
  const manifest = readFileSync(new URL('../scenarios/.claude-plugin/plugin.json', here), 'utf8')
  const source = readFileSync(new URL('../scenarios/hooks/register.tsx', here), 'utf8')
  const c = card(entry, catalog, manifest, source)
  assert.equal(c.name, 'scenarios')
  assert.equal(c.state, 'en construction')
  assert.deepEqual(c.commands, ['/scenarios'])
  assert.ok(c.events.includes('agent.spawn'))
  assert.equal(c.blocks, false)
  assert.ok(c.options.some(o => /warn_no_model .*\(on \| off\), défaut "on"/.test(o)))
  const ghost = card({ dir: 'ghost', state: 'planned', description: 'Bandeau prévu' }, catalog)
  assert.equal(ghost.found, false)
  assert.equal(ghost.state, 'prévu')
  assert.match(ghost.description, /Bandeau/)
  const read = p => readFileSync(new URL(`../band/${p}`, here), 'utf8')
  const band = card(catalog.mods.find(m => m.dir === 'band'), catalog, read('.claude-plugin/plugin.json'), read('hooks/register.tsx'))
  assert.equal(band.found, true)
  assert.deepEqual(band.commands, ['/jauge'])
  assert.equal(band.blocks, false)
})

test('no mod of this repo can block, and the Nos mods block lists every mod and the archived ones', () => {
  const cards = catalog.mods.map(entry => {
    const read = p => { try { return readFileSync(new URL(`../${entry.dir}/${p}`, here), 'utf8') } catch { return undefined } }
    const rel = modulePath(read('hooks/hooks.json'))
    return card(entry, catalog, read('.claude-plugin/plugin.json'), rel ? read(rel) : undefined)
  })
  for (const c of cards.filter(x => x.found)) assert.equal(c.blocks, false, `${c.name} never blocks`)
  for (const dir of ['factory', 'control', 'ci', 'scenarios', 'guide', 'band', '../vendor/filetree']) assert.ok(cards.some(c => c.dir === dir && c.found), `${dir} card`)
  const block = modsMarkdown(cards, catalog)
  for (const name of ['cc-control', 'cost-tracker', 'activity-pane', 'launchpad', 'night', 'context-meter']) assert.match(block, new RegExp(name))
  const swapped = between('a\n<!-- mods:start -->\nold\n<!-- mods:end -->\nb', 'mods', 'new')
  assert.equal(swapped, 'a\n<!-- mods:start -->\nnew\n<!-- mods:end -->\nb')
})
