// cockpit - one side pane that zooms: Méga (all projects) › Projet (lead and sub-conversations) › Conversation
// (Workflows and agents) › Agent. A breadcrumb, a clickable tree (drawn as an SVG on the desktop), the detail of the
// selection under it (factory's own screens), and small strips: Jauge, Usage, Veille, Fichiers.
//   /cockpit [mega|macro|medium|micro] [projet ou conversation] | close
// Opens by itself at session start (like filetree; userConfig `start`), on this conversation's project at the level of
// cockpit.config.json. Read-only: it runs factory's scanner (copied in lib/), band's scanner when the Jauge strip is open
// and band sits beside it, reads veille's files; it never blocks, rewrites or adds to a prompt. Refresh only while the
// pane is the one shown.
import { deepMerge, scanArgs, pickSession, repoOf } from '../lib/factory/hooks/logic.mjs'
import { waitingArgs } from '../lib/factory/hooks/waiting.mjs'
import { screensConfig } from '../lib/factory/hooks/screens.mjs'
import { gaugeModel } from '../lib/band/hooks/gauge.ts'
import { viewModel } from '../lib/veille/hooks/view.mjs'
import { deepMerge as vmerge } from '../lib/veille/lib/modes.mjs'
import { cockpitConfig, initialNav, select, zoomTo, usageCard, findSession } from './nav.mjs'
import { drawCockpit } from './view.mjs'

const PANE = 'cockpit'
let options = {}
let CFG = null // cockpit.config.json (+ user file)
let FCFG = null // factory.config.json (lib copy, + ~/.claude/effort-board/factory.config.json)
const D = {
  scan: null, nav: null, self: null, busy: false, error: '', at: 0, open: false, filter: 'all', strips: null,
  usage: null, usageRaw: null, gauge: null, compactAt: null, compactAtAt: 0, band: null, bandCfg: null, bandMissing: false, veille: null, columns: 0,
}

const norm = (p) => String(p || '').replace(/\\/g, '/')
const root = ($) => norm($.plugin.root).replace(/\/+$/, '')
const sibling = ($, mod) => root($).replace(/\/[^/]+$/, '') + '/' + mod

async function homeDir($) {
  return norm((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '')
}

async function board($) {
  const o = await $.env.get('FACTORY_BOARD')
  return o ? norm(o) : (await homeDir($)) + '/.claude/effort-board'
}

async function readJson($, path) {
  try {
    if (!(await $.fs.exists(path))) return null
    return JSON.parse(String(await $.fs.read(path)).replace(/^﻿/, ''))
  } catch {
    return null
  }
}

function expand(p, home) {
  return p && p.startsWith('~') ? home + p.slice(1) : p
}

async function loadConfig($) {
  const home = await homeDir($)
  const base = (await readJson($, root($) + '/cockpit.config.json')) || {}
  const userPath = (options.config || '').trim() ? expand(options.config.trim(), home) : (await board($)) + '/cockpit.config.json'
  CFG = deepMerge(base, (await readJson($, userPath)) || {})
  const fbase = (await readJson($, root($) + '/lib/factory/factory.config.json')) || {}
  FCFG = deepMerge(fbase, (await readJson($, (await board($)) + '/factory.config.json')) || {})
  if (!D.strips) D.strips = Object.fromEntries(cockpitConfig(CFG).sections.open.map((k) => [k, true]))
  return CFG
}

// ---- data ------------------------------------------------------------------------------------------------------------

async function rescan($) {
  if (D.busy) return
  D.busy = true
  $.ui.invalidate('ui.render')
  try {
    if (!CFG) await loadConfig($)
    const detail = (D.nav && D.nav.conv) || D.self
    const argv = [FCFG.python || 'python', ...scanArgs(FCFG, {
      script: root($) + '/lib/factory/scanner/factory_scan.py', cache: (await board($)) + '/cockpit_cache.json', detail,
      extra: [...waitingArgs(FCFG), '--recent', String(screensConfig(FCFG).recent_events)],
    })]
    const r = await $.process.run(argv, { timeoutMs: 180000 })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `scanner exit ${r.exitCode}`)
    D.scan = JSON.parse(r.stdout)
    D.error = ''
    D.at = await $.clock.now()
    if (!D.nav) D.nav = initialNav(D.scan, D.self, CFG)
  } catch (err) {
    D.error = String(err && err.message ? err.message : err).slice(0, 300)
  } finally {
    D.busy = false
  }
  $.ui.invalidate('ui.render')
}

// The usage card and the gauge: the engine's figures ($.session.usage, cheap), band's scanner for the rates and the
// context growth only while the Jauge strip is open and band sits beside cockpit.
async function refreshStrips($) {
  const now = await $.clock.now()
  try { D.usageRaw = await $.session.usage() } catch { D.usageRaw = null }
  if (now - D.compactAtAt > 300000) {
    D.compactAtAt = now
    try {
      const u = await $.session.usage({ breakdown: 'summary' })
      const b = u && u.context && u.context.breakdown
      D.compactAt = b && b.isAutoCompactEnabled !== false ? b.autoCompactThreshold || null : null
    } catch { D.compactAt = null }
  }
  const me = D.scan ? findSession(D.scan, D.self) : null
  D.usage = usageCard(D.usageRaw, me, FCFG || {}, now)
  if (D.strips && D.strips.jauge) await bandScan($, now)
  const ctx = (D.usageRaw && D.usageRaw.context) || {}
  const bc = D.bandCfg || {}
  const tokens = ctx.tokens ?? (me ? me.ctx : undefined)
  const window = ctx.window || ((bc.context || {}).window_fallback) || FCFG.context_window || 200000
  const compactAt = D.compactAt || Math.round((window * (((bc.context || {}).autocompact_pct_fallback) || 92)) / 100)
  const growth = D.band && D.band.conv ? D.band.conv.growthTpm : undefined
  const rates = []
  for (const id of ((bc.gauge || {}).scopes) || ['conv']) {
    const row = D.band && (D.band.scopes || []).find((r) => r.id === id)
    const rate = row && (row.rates.find((x) => x.w === bc.band_window_s) || row.rates[0])
    if (rate) rates.push(`${((bc.labels || {})[id]) || id} ${Math.round(rate.tps)} tok/s`)
  }
  const week = ((D.usageRaw && D.usageRaw.rateLimits) || []).find((l) => l.kind === 'seven_day')
  D.gauge = tokens === undefined ? null : gaugeModel({
    tokens, window, compactAt, handoffAt: ((bc.context || {}).handoff_tokens) || ((FCFG.thresholds || {}).handoff_tokens) || 250000,
    etaMin: growth && growth > 0 && tokens < compactAt ? (compactAt - tokens) / growth : undefined, rates,
    ...(week && Number.isFinite(week.percentUsed) ? { week: week.percentUsed } : {}),
  }, (bc.gauge || {}).labels || {})
  if (D.strips && D.strips.veille) await loadVeille($)
  $.ui.invalidate('ui.render')
}

async function bandScan($, now) {
  const dir = sibling($, 'band')
  try { D.bandMissing = !(await $.fs.exists(dir + '/scanner/scan.mjs')) } catch { D.bandMissing = true }
  if (D.bandMissing) return
  const home = await homeDir($)
  D.bandCfg = (await readJson($, dir + '/band.config.json')) || {}
  const bc = D.bandCfg
  let cwd = ''
  try { cwd = await $.session.cwd() } catch { /* none */ }
  const req = { projects_root: expand(bc.projects_root || '~/.claude/projects', home), cache_file: home + '/.claude/cockpit/band-cache.json',
    session: D.self || '', cwd, now, cfg: bc }
  try {
    const r = await $.process.run([bc.node || 'node', dir + '/scanner/scan.mjs'], { stdin: JSON.stringify(req), timeoutMs: 120000 })
    const v = JSON.parse(r.stdout)
    D.band = v && !v.error ? v : D.band
  } catch { /* keep the last reading */ }
}

async function loadVeille($) {
  const dir = sibling($, 'veille')
  const base = await readJson($, dir + '/veille.config.json')
  if (!base) { D.veille = null; return }
  const o = await $.env.get('VEILLE_HOME')
  const h = o ? norm(o) : (await homeDir($)) + '/.claude/veille'
  const cfg = vmerge(base, (await readJson($, h + '/config.json')) || {})
  const state = await readJson($, h + '/state.json')
  const heartbeat = await readJson($, h + '/heartbeat.json')
  let acks = []
  try {
    const t = (await $.fs.exists(h + '/acks.jsonl')) ? String(await $.fs.read(h + '/acks.jsonl')) : ''
    acks = t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).key } catch { return null } }).filter(Boolean)
  } catch { acks = [] }
  D.veille = state || heartbeat ? viewModel(cfg, state, heartbeat, acks, await $.clock.now()) : null
}

// Shown = open, placed, and the tab on screen (another pane, e.g. filetree, may be the one shown).
async function shown($) {
  if (!D.open) return false
  try {
    const p = ((await $.ui.panes()) || []).find((x) => x.id === PANE)
    return Boolean(p && p.isPlaced && p.isShown !== false)
  } catch {
    return D.open
  }
}

// ---- actions ---------------------------------------------------------------------------------------------------------

function actions($) {
  const redraw = () => $.ui.invalidate('ui.render')
  return {
    crumb: (level) => { D.nav = zoomTo(D.nav, level); redraw() },
    select: (node) => {
      const before = D.nav && D.nav.conv
      D.nav = select(D.nav || { level: 'mega' }, node)
      redraw()
      if (D.nav.conv && D.nav.conv !== before && !(D.scan && D.scan.detail && D.scan.detail.cli === D.nav.conv)) void rescan($)
    },
    refresh: () => { void rescan($).then(() => refreshStrips($)) },
    filter: (k) => { D.filter = k; redraw() },
    toggle: (id) => { D.strips = { ...(D.strips || {}), [id]: !(D.strips || {})[id] }; redraw(); void refreshStrips($) },
    files: () => { void $.command.run({ command: 'filetree' }).catch(() => $.ui.toast('filetree non chargé : ajoute vendor/filetree à CLAUDE_CODE_PLUGIN_DIRS')) },
  }
}

async function openPane($, focus) {
  D.open = true
  const title = (cockpitConfig(CFG).labels || {}).title || 'Cockpit'
  const r = await $.ui.open(focus ? { id: PANE, title, focus: true } : { id: PANE, title })
  return r
}

// "/cockpit macro datapass" -> { level: 'macro', rest: 'datapass' }
export function parseArgs(args) {
  const words = String(args || '').trim().split(/\s+/).filter(Boolean)
  const alias = { mega: 'mega', 'méga': 'mega', macro: 'macro', projet: 'macro', medium: 'medium', conversation: 'medium', conv: 'medium', micro: 'micro', agent: 'micro' }
  const lv = words.length ? alias[words[0].toLowerCase()] : null
  return { level: lv || null, rest: (lv ? words.slice(1) : words).join(' ') }
}

export function register(on, opts) {
  options = opts || {}
  on('session.start', async ($, e, next) => {
    try { D.self = await $.session.id() } catch { D.self = null }
    await loadConfig($).catch(() => { CFG = {}; FCFG = {} })
    const c = cockpitConfig(CFG)
    try {
      await $.command.register({ name: 'cockpit', immediate: true, description: 'Cockpit : Méga › Projet › Conversation › Agent, arbre cliquable et détail (/cockpit [niveau] [projet ou conversation])',
        argumentHint: '[mega|macro|medium|micro] [projet ou conversation] | close' })
    } catch { /* a name clash must not break the rest */ }
    $.clock.every(Math.max(5, c.refresh_s) * 1000, () => { void shown($).then((s) => (s ? rescan($) : undefined)) })
    $.clock.every(Math.max(15, c.strips_refresh_s) * 1000, () => { void shown($).then((s) => (s ? refreshStrips($) : undefined)) })
    if (c.auto_open && options.start !== 'off') {
      void (async () => {
        await openPane($, false).catch(() => undefined)
        await rescan($)
        await refreshStrips($).catch(() => undefined)
      })()
    }
    return next(e)
  })

  on('command.run', { command: 'cockpit' }, async ($, e) => {
    await loadConfig($)
    try { D.self = (await $.session.id()) || D.self } catch { /* keep */ }
    const q = String(e.args || '').trim()
    if (q.toLowerCase() === 'close') { D.open = false; await $.ui.close({ id: PANE }); return {} }
    await openPane($, true)
    const { level, rest } = parseArgs(q)
    if (!D.scan) await rescan($)
    if (!D.nav && D.scan) D.nav = initialNav(D.scan, D.self, CFG)
    if (rest && D.scan) {
      const s = pickSession(D.scan.sessions, rest)
      const repo = !s && (D.scan.sessions || []).map(repoOf).find((r) => r.toLowerCase().includes(rest.toLowerCase()))
      if (s) D.nav = select(D.nav, { kind: 'conv', id: s.cli, repo: repoOf(s) })
      else if (repo) D.nav = select(D.nav, { kind: 'project', id: repo })
    }
    if (level && D.nav) D.nav = zoomTo(D.nav, level) // a level whose subject is unknown (micro without an agent) stays put
    await rescan($)
    await refreshStrips($).catch(() => undefined)
    return {}
  })

  on('ui.close', { id: PANE }, async ($, e, next) => { D.open = false; return next(e) }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    D.open = true
    D.columns = Number(e.props && e.props.bodyColumns) || 0
    return drawCockpit(el, {
      cfg: CFG || {}, fcfg: FCFG || {}, scan: D.scan, nav: D.nav || { level: 'mega', repo: null, conv: null, agent: null }, self: D.self,
      busy: D.busy, error: D.error, at: D.at, columns: D.columns, filter: D.filter, usage: D.usage, gauge: D.gauge, bandCfg: D.bandCfg,
      bandMissing: D.bandMissing, veille: D.veille, open: D.strips || {}, act: actions($),
    })
  })
}
