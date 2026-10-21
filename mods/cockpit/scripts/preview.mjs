// Text render of the cockpit at the four zoom levels from this PC's transcripts, at a side-panel width (no Claude Code
// needed): node mods/cockpit/scripts/preview.mjs [--cols 75] [--project <repo>] [--conv <title or id>] [--agent <id>]
// --panneau: the default view (the Panneau) from invented fixtures (scripts/fixtures/panneau.mjs), nothing read on this PC:
//   node mods/cockpit/scripts/preview.mjs --panneau --cols 60   (and --cols 45, 75)
//   --indent <n|auto>: panel.tree.indent, the tree's columns per level (auto: 6, 4 under 60 columns)
//   --busy: the fixture with 2 running Workflows, 1 background agent, 1 working sub-conversation and 1 CI pipeline
//   --main: only this conversation's main thread works (a turn in progress, no Workflow, no agent, no CI)
//   --idle: nothing runs anywhere: EN COURS is the green « ✓ Rien ne tourne » line
//   --ci idle|busy|stale: the ci mod's pipelines cache (stale: « CI : non lu depuis 40 min »)
//   --open encours,pdetails: unfold « En ce moment » (a section id) or a node (a fold key), comma-separated
// Without --conv: the project's most recent lead. The engine's figures ($.session.usage) are not reachable here, so the
// Usage strip shows the transcripts' part only and the Jauge uses the scan's context of the chosen conversation.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { deepMerge, pickSession, scanArgs, repoOf } from '../lib/factory/hooks/logic.mjs'
import { waitingArgs } from '../lib/factory/hooks/waiting.mjs'
import { screensConfig } from '../lib/factory/hooks/screens.mjs'
import { el, renderText, widest } from '../lib/factory/scanner/textrender.mjs'
import { initialNav, select, zoomTo, usageCard, crumbText, crumbs, convForest, agentNodes, findSession } from '../hooks/nav.mjs'
import { drawCockpit } from '../hooks/view.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v }
const cols = Number(opt('--cols', '75'))
const project = opt('--project', '')
const convQ = opt('--conv', '')
const agentQ = opt('--agent', '')
const indent = opt('--indent', undefined)
const unfold = String(opt('--open', '') || '').split(',').filter(Boolean)
if (argv.includes('--panneau')) {
  const { panneauText } = await import('./fixtures/panneau.mjs')
  const o = indent === undefined ? {} : { indent: indent === 'auto' ? 'auto' : Number(indent) }
  if (argv.includes('--busy')) o.busy = true
  if (argv.includes('--main')) o.scene = 'main'
  if (argv.includes('--idle')) o.scene = 'idle'
  const ci = opt('--ci', '')
  if (ci) o.ci = ci
  const sections = ['fichiers', 'conv', 'convs', 'barres', 'debit', 'graphe', 'encours', 'convs_filters']
  if (unfold.length) {
    o.open = { conv: true, convs: true, ...Object.fromEntries(unfold.filter((k) => sections.includes(k)).map((k) => [k, true])) }
    o.closed = Object.fromEntries(unfold.filter((k) => !sections.includes(k)).map((k) => [k, false]))
  }
  const text = panneauText(cols, o)
  console.log(`=========== Panneau (${cols} colonnes, plus large ligne ${widest(text)}) ===========`)
  console.log(text)
  process.exit(0)
}
const board = process.env.FACTORY_BOARD || join(homedir(), '.claude', 'effort-board')
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) : {})
const fcfg = deepMerge(read(join(here, '..', 'lib', 'factory', 'factory.config.json')), read(join(board, 'factory.config.json')))
const ccfg = deepMerge(read(join(here, '..', 'cockpit.config.json')), read(join(board, 'cockpit.config.json')))
const scan = (detail) => JSON.parse(execFileSync(fcfg.python || 'python', scanArgs(fcfg, { script: join(here, '..', 'lib', 'factory', 'scanner', 'factory_scan.py'),
  cache: join(board, 'cockpit_cache.json'), detail, extra: [...waitingArgs(fcfg), '--recent', String(screensConfig(fcfg).recent_events)] }), { encoding: 'utf8', maxBuffer: 1 << 28 }))

let s = scan()
const inRepo = (x) => !project || repoOf(x) === project
const conv = (convQ && pickSession(s.sessions.filter(inRepo), convQ)) || convForest(s, project || repoOf(s.sessions[0]), fcfg)[0]
const cli = conv ? conv.cli || conv.id : null
if (cli) s = scan(cli)
const me = findSession(s, cli)
const now = Date.now()
const noop = () => {}
const usage = usageCard(null, me, fcfg, now)
let nav = initialNav(s, cli, { ...ccfg, default_level: 'macro' })
// --defaults: the pane as it opens (this conversation selected, only its section unfolded)
if (argv.includes('--defaults')) {
  const n = initialNav(s, cli, ccfg)
  const open = Object.fromEntries((ccfg.sections.open || []).map((k) => [k, true]))
  const V = { cfg: ccfg, fcfg, scan: s, nav: n, self: cli, busy: false, error: '', at: now, columns: cols, filter: 'all', usage, veille: null, open,
    act: { crumb: noop0, select: noop0, refresh: noop0, filter: noop0, toggle: noop0, files: noop0, machine: noop0 } }
  console.log(renderText(drawCockpit(el, V), cols))
  process.exit(0)
}
function noop0() {}
// micro: an agent of this conversation, else of the first lane it spawned that has agents (its detail is scanned then)
const agentsOf = (sc, id) => { const a = agentNodes(sc, id, fcfg); return [...a.plain, ...a.workflows.flatMap((w) => w.children)] }
let microScan = s
let microConv = cli
let agents = cli ? agentsOf(s, cli) : []
if (!agents.length && me) {
  for (const k of s.sessions.filter((x) => x.parent && x.parent === me.sid && (x.subs || []).length)) {
    microScan = scan(k.cli); microConv = k.cli; agents = agentsOf(microScan, k.cli)
    if (agents.length) break
  }
}
const agent = (agentQ && agents.find((x) => x.id.startsWith(agentQ))) || agents.find((x) => x.state === 'running') || agents[0]
const levels = [
  ['mega', zoomTo(nav, 'mega'), s],
  ['macro', nav, s],
  ['medium', select(nav, { kind: 'conv', id: cli, repo: nav.repo }), s],
  ['micro', agent ? select(select(nav, { kind: 'conv', id: microConv, repo: nav.repo }), { kind: 'agent', id: agent.id, conv: microConv }) : null, microScan],
]
for (const [name, n, sc] of levels) {
  if (!n) { console.log(`\n=========== ${name} : aucun agent dans cette conversation ni ses sous-conversations ===========`); continue }
  const V = { cfg: ccfg, fcfg, scan: sc, nav: n, self: cli, busy: false, error: '', at: now, columns: cols, filter: 'all', usage, veille: null,
    open: { conv: true, project: true, all: true, global: true }, act: { crumb: noop, select: noop, refresh: noop, filter: noop, toggle: noop, files: noop, machine: noop } }
  const text = renderText(drawCockpit(el, V), cols)
  console.log(`\n=========== ${name} · ${crumbText(crumbs(n, sc, ccfg))} (${cols} colonnes, plus large ligne ${widest(text)}) ===========`)
  console.log(text)
}
