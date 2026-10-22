// The Panneau from this PC's live data, read-only (node mods/cockpit/scripts/preview.mjs --real [--cols 75] [--self <cli>]
// [--show]): factory's and the Workflow scanner (their caches copied to a temp folder, never written in place), the
// session files (scanner/cards.mjs part « graphe »), usage's classement.json / debit.json / codex.json and the ci mod's
// cache, built as hooks/register.mjs panelView does. By default it prints only counts (rows listed, working, waiting, at
// rest, nested children, Workflows, agents): titles of real conversations never land in a log. --show prints the text
// too, on this terminal only; never commit that output.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { deepMerge, scanArgs } from '../lib/factory/hooks/logic.mjs'
import { waitingArgs } from '../lib/factory/hooks/waiting.mjs'
import { screensConfig } from '../lib/factory/hooks/screens.mjs'
import { workflowArgs, workflowScreen } from '../lib/factory/hooks/workflow.mjs'
import { el, renderText, widest } from '../lib/factory/scanner/textrender.mjs'
import { usageCard, findSession } from '../hooks/nav.mjs'
import { drawCockpit } from '../hooks/view.mjs'
import { listModel } from '../hooks/panel_view.mjs'
import { panelConfig, synthesis, barsOf, contexteOf, effectiveWindow } from '../lib/panel.mjs'
import { convFactory } from '../lib/panel_conv.mjs'
import { panelConvs } from '../lib/panel_list.mjs'
import { ciNow } from '../lib/core/activity.mjs'
import { grapheModel } from '../lib/graphe.mjs'
import { debitModel } from '../lib/debit.mjs'
import { depuisConfig } from '../lib/depuis.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const mod = join(here, '..')
const norm = (p) => String(p || '').replace(/\\/g, '/')
const read = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) : null } catch { return null } }
const noop = () => {}

/** The Panneau's view from live data. o: { cols, self, show }. Returns { counts, text }. */
export function realPanneau(o = {}) {
  const home = norm(homedir())
  const board = norm(process.env.FACTORY_BOARD || home + '/.claude/effort-board')
  const cfg = deepMerge(read(join(mod, 'cockpit.config.json')) || {}, read(board + '/cockpit.config.json') || {})
  const wf = read(join(mod, 'lib', 'factory', 'workflow.config.json'))
  const fcfg = deepMerge(deepMerge(read(join(mod, 'lib', 'factory', 'factory.config.json')) || {}, wf ? { workflow: wf } : {}), read(board + '/factory.config.json') || {})
  const tmp = mkdtempSync(join(tmpdir(), 'cockpit-real-'))
  try {
    // the scanners write their caches: copies in a temp folder, the originals untouched
    const cache = (name) => { const dst = join(tmp, name); if (existsSync(board + '/' + name)) copyFileSync(board + '/' + name, dst); return dst }
    const py = (args) => JSON.parse(execFileSync(fcfg.python || 'python', args, { encoding: 'utf8', maxBuffer: 1 << 28 }))
    const scanOnce = (detail) => py(scanArgs(fcfg, { script: join(mod, 'lib', 'factory', 'scanner', 'factory_scan.py'), cache: cache('cockpit_cache.json'), detail,
      extra: [...waitingArgs(fcfg), '--recent', String(screensConfig(fcfg).recent_events)] }))
    let scan = scanOnce('')
    const ms = (v) => (typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(v) || 0)
    const self = o.self || process.env.CLAUDE_CODE_SESSION_ID || ([...(scan.sessions || [])].sort((a, b) => ms(b.last_activity) - ms(a.last_activity))[0] || {}).cli || ''
    if (self) scan = scanOnce(self)
    let wfAll = null
    try { wfAll = py(workflowArgs(fcfg, { script: join(mod, 'lib', 'factory', 'scanner', 'workflow_scan.py'), cache: cache('cockpit_workflow_all.json'), scope: 'all', session: self })) } catch { wfAll = null }
    const now = Date.now()
    let grapheRaw = null
    try {
      const req = { home, now, parts: ['graphe'], cfg: { nuit: cfg.nuit || {}, galerie: cfg.galerie || {}, controle: cfg.controle || {}, depuis: cfg.depuis || {} } }
      grapheRaw = JSON.parse(execFileSync(cfg.node || 'node', [join(mod, 'scanner', 'cards.mjs')], { input: JSON.stringify(req), encoding: 'utf8', maxBuffer: 1 << 28 })).graphe || null
    } catch { grapheRaw = null }
    const ucfg = read(join(mod, '..', 'usage', 'usage.config.json')) || {}
    const dir = norm(String((cfg.qui_consomme && cfg.qui_consomme.data_dir) || ucfg.data_dir || '~/.claude/usage-mod').replace(/^~/, home))
    const conso = read(dir + '/classement.json')
    const codex = read(dir + '/codex.json')
    const debit = read(dir + '/debit.json')
    const ciCache = read(home + '/.claude/ci-pipelines-cache.json')

    // as hooks/register.mjs panelView builds it (the engine's usage is not reachable here: the scan's context only)
    const pc = panelConfig(cfg)
    const f = { period: '', project: '', state: '', who: '' }
    let runs = []
    try { runs = (wfAll && workflowScreen(wfAll, fcfg, now).runs) || [] } catch { runs = [] }
    const ctxWindow = effectiveWindow(cfg, Number(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) || 0, undefined, fcfg.context_window)
    const fcfgW = { ...fcfg, context_window: ctxWindow }
    const syn = synthesis(conso, scan, codex, { ...f, fcfg, runs }, cfg, now)
    const me = self ? findSession(scan, self) : null
    const card = usageCard(null, me, fcfg, now)
    const contexte = contexteOf({ usage: null, ctxTokens: me ? me.ctx : NaN, fwin: fcfg.context_window, auto: ctxWindow }, cfg)
    const selfRow = (syn.rows || []).find((r) => r.id === self)
    const factory = self ? convFactory(scan, self, fcfg, cfg, now, {}, { runs, card, contexte, tps: (syn.tpsById || {})[self], rowCost: selfRow ? selfRow.cost : null }) : null
    let graphe = null
    try { graphe = grapheModel({ rows: grapheRaw && grapheRaw.rows, scan, workflows: runs, conso, fcfg: fcfgW, filter: {}, link: depuisConfig(cfg).session_link }, self, cfg, now) } catch { graphe = null }
    const x = panelConvs({ syn, graphRows: grapheRaw && grapheRaw.rows, graphe, scan, runs, conso, fcfg: fcfgW, self, selfFactory: factory, closed: {}, autoWindow: ctxWindow,
      tpsById: syn.tpsById || {}, cardOf: (s) => usageCard(null, s, fcfg, now), filter: f, tzMin: (conso && conso.tzMin) || 0 }, cfg, now)
    const open = Object.fromEntries(pc.open.map((k) => [k, true]))
    const panel = {
      unfold: x.under.unfold, tree: x.under.tree || new Set(), kids: x.under.kids || new Set(), convFactories: x.under.factories, synAll: { ...syn, rows: x.pool }, convList: x.list,
      link: depuisConfig(cfg).session_link, ctxWindow, open, closed: {}, self, ci: ciNow(ciCache, now, pc.encours), files: { head: '', rows: [], more: 0, selected: '', attach: true, busy: false },
      factory, syn, filter: f, bars: barsOf({ usage: null, quotas: null, tps: syn.tps, codex: false, card }, cfg), graphe,
      debit: (() => { try { return debitModel({ debit, codex: null, showCodex: false, now }, cfg) } catch { return null } })(),
      act: new Proxy({}, { get: () => noop }),
    }
    const counts = listModel({ ...panel, cfg, now }).counts
    const view = { cfg, fcfg, scan, nav: { level: 'mega' }, self, busy: false, error: '', at: now, columns: o.cols || 75, filter: 'all', usage: null, veille: null, open: {},
      act: { tab: noop, menu: noop }, tab: 'panneau', panel }
    const text = o.show ? renderText(drawCockpit(el, view), o.cols || 75).replace(/ /g, ' ') : ''
    return { counts, text }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function printReal(o) {
  const { counts, text } = realPanneau(o)
  const c = counts
  console.log(`Panneau (données réelles, lecture seule) : ${c.rows} lignes listées · ${c.working} travaillent · ${c.waiting} t’attendent · ${c.rest} au repos (${c.hidden} repliées) · ${c.nested} enfants imbriqués · ${c.workflows} workflows · ${c.agents} agents`)
  if (o.show) {
    console.log(`=========== Panneau réel (${o.cols} colonnes, plus large ligne ${widest(text)}) — ne pas committer ===========`)
    console.log(text)
  }
}
