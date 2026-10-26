// export-eta - the pane « Export eta » (/export, /export-eta) and one line above the prompt when a batch of finished
// conversations is ready. Read-only view of <home> (~/.claude/export-eta), written by exporter/export.mjs; every button
// runs that script (one code path, the same one the Veille watcher runs). No model call, no text for the model, nothing
// blocked or rewritten.
//   /export [en-cours | lot | tout | close]
//   /export-tout (= /export-eta tout): « Exporter tout », one click, no pane: the dated snapshot + conversations land in
//   eta through one merged PR; a toast says « Exporté : N fichiers, PR #x mergée ».
import { bandLine, batchView, historyRows, ongoing, selection } from './view.mjs'
import { deepMerge, fill } from '../lib/layout.mjs'

const PANE = 'export-eta'
const D = { cfg: null, sessions: null, pending: null, state: null, tab: 'batch', selected: new Set(), open: new Set(), busy: '', msg: '', dismissed: '', at: 0, home: '' }

const root = ($) => $.plugin.root.replace(/\\/g, '/')

async function homeDir($) {
  const o = await $.env.get('EXPORT_ETA_HOME')
  if (o) return o.replace(/\\/g, '/')
  return ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/') + '/.claude/export-eta'
}

async function readJson($, p) {
  try {
    if (!(await $.fs.exists(p))) return null
    return JSON.parse(String(await $.fs.read(p)).replace(/^﻿/, ''))
  } catch { return null }
}

async function load($) {
  D.home = await homeDir($)
  const base = (await readJson($, root($) + '/export-eta.config.json')) || {}
  D.cfg = deepMerge(base, (await readJson($, D.home + '/config.json')) || {})
  D.sessions = await readJson($, D.home + '/sessions.json')
  D.pending = await readJson($, D.home + '/pending.json')
  D.state = await readJson($, D.home + '/state.json')
  try { D.at = await $.clock.now() } catch { D.at = Date.now() }
}

async function exporter($, args, timeoutMs = 60000) {
  const node = (D.cfg && D.cfg.node) || 'node'
  try {
    const r = await $.process.run([node, root($) + '/exporter/export.mjs', ...args], { timeoutMs })
    D.msg = ((r.exitCode === 0 ? r.stdout : r.stderr || r.stdout) || '').trim().split('\n').pop().replace(/^export-eta: /, '').slice(0, 300)
    return r.exitCode === 0
  } catch (err) {
    D.msg = String(err && err.message ? err.message : err).slice(0, 300)
    return false
  }
}

async function act($, label, args, timeoutMs) {
  if (D.busy) return
  D.busy = label
  $.ui.invalidate('ui.render')
  try { await exporter($, args, timeoutMs) } finally { D.busy = ''; await load($).catch(() => undefined); $.ui.invalidate('ui.render') }
}

const EXPORT_MS = 600000
const runMode = ($, mode, ids) => act($, mode, ['run', '--mode', mode, ...(ids && ids.length ? ['--ids', ids.join(',')] : [])], EXPORT_MS)
const refresh = ($) => act($, 'list', ['list'], 120000)

const TOUT_MS = 600000 // the host's ceiling for process.run
async function exportTout($) {
  const L = (D.cfg && D.cfg.labels) || {}
  if (D.busy) { try { $.ui.toast(L.busy || 'export en cours…') } catch { /* no toast */ } return }
  try { $.ui.toast(L.tout_started || 'Export tout : snapshot et conversations vers eta…') } catch { /* no toast */ }
  await act($, 'tout', ['tout'], TOUT_MS)
  try { $.ui.toast(D.msg || L.tout_failed || 'Export tout : fini') } catch { /* no toast */ }
}

function draw(el, vm, h) {
  const cfg = D.cfg || {}
  const L = cfg.labels || {}
  const C = cfg.colors || {}
  const T = (text, o = {}) => el.Text({ children: [String(text ?? '')], wrap: 'wrap', ...(o.tone && C[o.tone] ? { color: C[o.tone] } : {}), ...(o.dim ? { dimColor: true } : {}), ...(o.bold ? { bold: true } : {}) })
  const row = (parts) => el.Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, children: parts.filter(Boolean) })
  const col = (parts, o = {}) => el.Box({ flexDirection: 'column', ...o, children: parts.filter(Boolean) })
  const box = (title, parts, tone) => el.Box({ flexDirection: 'column', borderStyle: 'round', borderColor: C[tone || 'dim'], paddingX: 1, marginBottom: 1, children: [title ? T(title, { bold: true, tone }) : null, ...parts].filter(Boolean) })
  const btn = (label, onPress, primary, key) => el.Button({ children: [label], ...(key ? { key } : {}), ...(primary ? { variant: 'primary' } : { plain: true }), onPress })
  const link = (href, label) => (href ? (el.Link ? el.Link({ href, children: [label] }) : T(`${label} ${href}`, { dim: true })) : null)

  const tabs = [['batch', L.tab_batch || 'Lot terminé'], ['ongoing', L.tab_ongoing || 'En cours'], ['selection', L.tab_selection || 'Sélection'], ['history', L.tab_history || 'Exports']]
  const head = col([
    row(tabs.map(([id, label]) => btn(label, () => h.tab(id), id === D.tab))),
    vm.configured ? null : T(fill(L.not_configured, { file: `${D.home}/config.json` }), { tone: 'warn' }),
    D.busy ? T(`${L.busy || 'export en cours…'} (${D.busy})`, { tone: 'accent' }) : null,
    D.msg ? T(D.msg, { dim: true }) : null,
  ], { marginBottom: 1 })

  let body
  if (D.tab === 'batch') {
    const b = vm.batch
    body = box(L.tab_batch || 'Lot terminé', b.ready ? [
      T(b.text, { bold: true, tone: 'warn' }), b.reason ? T(b.reason, { dim: true }) : null,
      ...b.titles.slice(0, 20).map((t) => T(`· ${t}`, { dim: true })),
      row([btn(L.export_batch || 'Exporter vers eta', h.batch, true, 'batch-export'), b.auto ? T('auto : la veille l’exporte sans clic', { dim: true }) : null]),
    ] : [T(b.none, { dim: true }), row([btn(L.export_now || 'Exporter maintenant', h.ongoing, false), btn('↻', h.refresh)])], b.ready ? 'warn' : 'dim')
  } else if (D.tab === 'ongoing') {
    body = box(`${L.tab_ongoing || 'En cours'} (${vm.ongoing.length})`, [
      ...vm.ongoing.slice(0, 40).map((s) => T(`· ${s.project} · ${s.title || s.cli.slice(0, 8)}${s.state === 'live' ? ' (active)' : ''}`)),
      vm.ongoing.length ? null : T('aucune', { dim: true }),
      row([btn(L.export_now || 'Exporter maintenant', h.ongoing, true), btn('↻', h.refresh)]),
    ])
  } else if (D.tab === 'selection') {
    const n = D.selected.size
    body = box(L.tab_selection || 'Sélection', [
      row([btn(fill(L.export_selection || 'Exporter la sélection ({n})', { n }), h.selection, n > 0), n ? btn('Vider', h.clear) : null, btn('↻', h.refresh)]),
      ...vm.groups.map((g) => col([
        btn(`${g.open ? '▾' : '▸'} ${g.project} (${g.count}${g.picked ? `, ${g.picked} choisie(s)` : ''})`, () => h.fold(g.project)),
        ...(g.open ? g.rows.map((r) => btn(`${r.checked ? '☑' : '☐'} ${r.title} · ${r.when}${r.exported ? ' · exportée' : ''}`, () => h.toggle(r.cli))) : []),
        g.open && g.more ? T(`… et ${g.more} de plus`, { dim: true }) : null,
      ])),
      vm.groups.length ? null : T(D.sessions ? 'aucune conversation terminée' : L.first_scan || 'Lecture…', { dim: true }),
    ])
  } else {
    body = box(L.tab_history || 'Exports', vm.history.length ? vm.history.map((x) => col([
      row([T(`● ${x.when}`, { tone: x.tone, bold: true }), T(`${x.mode} · ${x.count} conversation(s)${x.files ? ` · ${x.files} fichiers` : ''}${x.dry ? ' · essai' : ''}`), link(x.url, x.pr || 'PR'), x.url ? T(x.merged ? 'mergée' : 'pas mergée', { tone: x.merged ? 'ok' : 'warn' }) : null]),
      T(`masqués : ${x.masked}`, { dim: true }),
      x.held.length ? T(`retenues : ${x.held.join(' ; ')}`, { tone: 'warn' }) : null,
      x.error ? T(x.error, { tone: 'bad' }) : null,
    ], { marginBottom: 1 })) : [T('aucun export', { dim: true })])
  }
  return col([head, body])
}

function viewModel() {
  const cfg = D.cfg || {}
  const sessions = (D.sessions && D.sessions.sessions) || []
  return {
    configured: !!((cfg.eta || {}).repo),
    batch: batchView(D.pending, cfg),
    ongoing: ongoing(sessions),
    groups: selection(sessions, D.selected, D.open, (cfg.pane || {}).max_rows || 40),
    history: historyRows(D.state, (cfg.pane || {}).history || 10),
  }
}

// /export-eta brief [enfants]: the brief for another AI of THIS conversation (exporter/brief.mjs), file + clipboard,
// no pane, no PR. The band's buttons run the same script directly (no wait for the turn to end).
async function exportBrief($, children) {
  const node = (D.cfg && D.cfg.node) || 'node'
  let session = ''
  try { session = await $.session.id() } catch { /* no session */ }
  try { $.ui.toast(children ? 'Brief (avec enfants) en cours…' : 'Brief en cours…') } catch { /* no toast */ }
  try {
    const r = await $.process.run([node, root($) + '/exporter/brief.mjs', 'run', '--session', session, ...(children ? ['--children'] : [])], { timeoutMs: 300000 })
    $.ui.toast(((r.stdout || r.stderr || '').trim().split('\n').pop() || `exit ${r.exitCode}`).slice(0, 300))
  } catch (err) {
    $.ui.toast(`Brief échoué : ${String(err && err.message ? err.message : err).slice(0, 200)}`)
  }
}

async function onCommand($, e) {
  await load($)
  const v = String(e.args || '').trim().toLowerCase()
  if (v === 'close') { await $.ui.close({ id: PANE }); return {} }
  if (v === 'brief' || v === 'brief enfants' || v === 'brief children') { void exportBrief($, v !== 'brief'); return {} }
  if (v === 'tout' || v === 'all') { void exportTout($); return {} }
  await $.ui.open({ id: PANE, title: (D.cfg.labels || {}).pane_title || 'Export eta', focus: true, closeOnEscape: true })
  if (v === 'en-cours' || v === 'ongoing') { D.tab = 'history'; void runMode($, 'ongoing') }
  else if (v === 'lot' || v === 'batch') { D.tab = 'history'; void runMode($, 'batch') }
  else void refresh($)
  $.ui.invalidate('ui.render')
  return {}
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await load($).catch(() => undefined)
    for (const name of ['export-eta', 'export']) {
      try {
        await $.command.register({
          name, immediate: true,
          description: 'Export eta : exporte les conversations (en cours, sélection, lot terminé) en Markdown masqué vers le dépôt eta, par PR',
          argumentHint: 'en-cours | lot | tout | brief [enfants] | close',
        })
      } catch { /* /export may clash with a built-in: /export-eta stays */ }
    }
    try {
      await $.command.register({
        name: 'export-tout', immediate: true,
        description: 'Exporter tout : snapshot daté (conversations, statut, workflows, CI, conso, problèmes, veille, à faire, règles) vers le dépôt eta, une PR mergée, sans tokens',
      })
    } catch { /* already registered */ }
    // The batch notice: pending.json is refreshed by the Veille watcher; if nobody did for a while, refresh it here.
    const every = Math.max(60, ((D.cfg && D.cfg.pane) || {}).refresh_s || 300) * 1000
    $.clock.every(every, async () => {
      await load($).catch(() => undefined)
      if (!D.busy && (!D.pending || D.at - (D.pending.generated || 0) > every * 2)) await act($, 'pending', ['pending'], 120000)
      $.ui.invalidate('ui.render')
    })
    return r
  })

  on('command.run', { command: 'export-eta' }, onCommand).catch(() => ({}))
  on('command.run', { command: 'export' }, onCommand).catch(() => ({}))
  on('command.run', { command: 'export-tout' }, async ($) => { await load($).catch(() => undefined); void exportTout($); return {} }).catch(() => ({}))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const el = $.ui.resolve(e)
    if (!D.cfg) await load($).catch(() => { D.cfg = {} })
    return draw(el, viewModel(), {
      tab: (id) => { D.tab = id; $.ui.invalidate('ui.render') },
      batch: () => { D.tab = 'history'; void runMode($, 'batch') },
      ongoing: () => { D.tab = 'history'; void runMode($, 'ongoing') },
      selection: () => { const ids = [...D.selected]; D.selected.clear(); D.tab = 'history'; void runMode($, 'selection', ids) },
      clear: () => { D.selected.clear(); $.ui.invalidate('ui.render') },
      toggle: (cli) => { D.selected.has(cli) ? D.selected.delete(cli) : D.selected.add(cli); $.ui.invalidate('ui.render') },
      fold: (p) => { D.open.has(p) ? D.open.delete(p) : D.open.add(p); $.ui.invalidate('ui.render') },
      refresh: () => void refresh($),
    })
  })

  // Above the prompt: « 4 conversations terminées — Exporter vers eta » with its button, only while a batch is ready.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    if ((e.props && e.props.hasSurvey) || !D.cfg) return theirs
    const line = bandLine(D.pending, D.cfg, D.dismissed)
    if (!line && !D.busy) return theirs
    const el = $.ui.resolve(e)
    const C = D.cfg.colors || {}
    const L = D.cfg.labels || {}
    const mine = D.busy
      ? el.Text({ children: [`${L.pane_title || 'Export eta'} : ${L.busy || 'export en cours…'}`], dimColor: true })
      : el.Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, children: [
        el.Text({ children: [line.text], ...(C.warn ? { color: C.warn } : {}) }),
        el.Button({ key: 'band-export', children: [L.export_batch || 'Exporter vers eta'], variant: 'primary', onPress: () => void runMode($, 'batch') }),
        el.Button({ key: 'band-dismiss', children: ['✕'], plain: true, onPress: () => { D.dismissed = line.key; $.ui.invalidate('ui.render') } }),
      ] })
    return theirs ? el.Box({ flexDirection: 'column', children: [theirs, mine] }) : mine
  }).catch(($, e, next) => next(e))
}
