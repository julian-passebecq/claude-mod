// Text render of every factory screen from this PC's transcripts, at a side-panel width (no Claude Code needed):
//   node mods/factory/scanner/preview.mjs [--cols 75] [--tab mission|focus|arbre|workflow|...] [--wf-all] [conversation title or id]
// --tab workflow reads scanner/workflow_scan.py for the picked conversation, or every conversation with --wf-all.
// The render is scanner/textrender.mjs (borders, wrap, rows), close enough to check that nothing is wider than the pane.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { deepMerge, pickSession, scanArgs } from '../hooks/logic.mjs'
import { waitingArgs } from '../hooks/waiting.mjs'
import { screensConfig, tabsOf } from '../hooks/screens.mjs'
import { drawFactoryPane, allTabs } from '../hooks/workflow_draw.mjs'
import { workflowArgs } from '../hooks/workflow.mjs'
import { el, renderText, widest } from './textrender.mjs'
import { quotas as quotasExtra } from './extras.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v }
const wfAll = argv.includes('--wf-all')
if (wfAll) argv.splice(argv.indexOf('--wf-all'), 1)
const cols = Number(opt('--cols', '75'))
const only = opt('--tab', '')
const query = argv.join(' ')
const board = process.env.FACTORY_BOARD || join(homedir(), '.claude', 'effort-board')
const over = join(board, 'factory.config.json')
const cfg = deepMerge(deepMerge(JSON.parse(readFileSync(join(here, '..', 'factory.config.json'), 'utf8')), { workflow: JSON.parse(readFileSync(join(here, '..', 'workflow.config.json'), 'utf8')) }),
  existsSync(over) ? JSON.parse(readFileSync(over, 'utf8')) : {})
const scan = (detail) => JSON.parse(execFileSync(cfg.python || 'python', scanArgs(cfg, { script: join(here, 'factory_scan.py'), cache: join(board, 'factory_cache.json'), detail,
  extra: [...waitingArgs(cfg), '--recent', String(screensConfig(cfg).recent_events)] }), { encoding: 'utf8', maxBuffer: 1 << 28 }))
let s = scan()
const pick = pickSession(s.sessions, query) || s.sessions.find((x) => (x.subs || []).length) || s.sessions[0]
if (pick) s = scan(pick.cli)
const now = Date.now()
const machineScript = join(here, '..', '..', 'machine', 'scanner', 'machine.py')
let machine = { missing: !existsSync(machineScript), metricsMissing: !existsSync(join(here, '..', '..', 'metrics', '.claude-plugin', 'plugin.json')) }
if (!machine.missing) {
  try {
    machine.sample = JSON.parse(execFileSync(cfg.python || 'python', ['-I', machineScript, 'sample'], { input: JSON.stringify({ gpu: true }), encoding: 'utf8' }))
    machine.runner = JSON.parse(execFileSync(cfg.python || 'python', ['-I', machineScript, 'runner'], { encoding: 'utf8' }))
  } catch (err) { machine.error = String(err.message).slice(0, 120) }
}
const q = await quotasExtra({ now, home: homedir().replace(/\\/g, '/') })
const noop = () => {}
const wf = !only || only === 'workflow' ? JSON.parse(execFileSync(cfg.python || 'python', workflowArgs(cfg, { script: join(here, 'workflow_scan.py'),
  cache: join(board, 'factory_workflow_cache.json'), scope: wfAll ? 'all' : 'conversation', session: pick ? pick.cli : '' }), { encoding: 'utf8', maxBuffer: 1 << 28 })) : null
for (const t of allTabs(cfg)) {
  if (only && t.id !== only) continue
  const tree = drawFactoryPane(el, { cfg, tab: t.id, scan: s, at: now, busy: false, error: '', columns: cols, filter: 'all', jfilter: 'all', jproject: '',
    picking: false, live: [], quotas: q, machine, target: null, wf, wfAt: now, wfScope: wfAll ? 'all' : 'conversation', wfOpen: {},
    act: { tab: noop, go: noop, refresh: noop, filter: noop, jfilter: noop, jproject: noop, pick: noop, wfScope: noop, wfToggle: noop } })
  const text = renderText(tree, cols)
  console.log(`\n=========== ${t.label} (${cols} colonnes, plus large ligne ${widest(text)}) ===========`)
  console.log(text)
}
