// veille - the pane « Veille » and a one-line band entry. Read-only view of ~/.claude/veille (written by the watcher,
// the scheduled task ClaudeVeille); the buttons run the watcher's own commands (mode, ack, tour, coordinator), so there
// is one code path. Nothing here blocks, rewrites or adds text to a prompt, and nothing calls a model.
//   /veille [fil | mode <x> | ack <clé|all> | coordinateur | tour | close]
// Two tabs: Alertes, and Fil (every conversation's last message, from ~/.claude/veille/fil.json, see fil-view.mjs).
import { deepMerge, modeName } from '../lib/modes.mjs'
import { markAllRead, markRead } from '../lib/fil.mjs'
import { viewModel, bandLine, eventText, ago } from './view.mjs'
import { drawFil, filLabels } from './fil-view.mjs'

let options = {}
const D = { cfg: null, state: null, heartbeat: null, acks: [], open: false, busy: '', msg: '', at: 0,
  tab: 'alertes', fil: null, filLoaded: false, read: null, filUi: { filter: 'tout', project: '', openProj: {}, openConv: {} } }

// Fil: the digest file (read on demand only), the « read » marks and the folds, kept in the mod's $.store.
async function loadFil($) {
  D.fil = await readJson($, (await vhome($)) + '/fil.json')
  D.filLoaded = true
  try { D.read = (await $.store.get('fil.read')) || null } catch { D.read = null }
  try { const u = await $.store.get('fil.ui'); if (u && typeof u === 'object') D.filUi = { ...D.filUi, ...u, openConv: {} } } catch { /* defaults */ }
  if (!D.read || !D.read.since) { D.read = markAllRead(Date.now()); try { await $.store.set('fil.read', D.read) } catch { /* memory only */ } }
}

// Hands a claude:// link to the OS (its handler is the desktop app). Windows: url.dll's FileProtocolHandler, no shell.
async function openUrl($, url) {
  if (!/^claude:\/\/claude\.ai\/epitaxy\/[\w-]+$/.test(String(url || ''))) return false
  let win = false
  try { win = (await $.env.get('OS')) === 'Windows_NT' } catch { win = false }
  const argv = win ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url] : ['xdg-open', url]
  try { const r = await $.process.run(argv, { timeoutMs: 10000 }); return r.exitCode === 0 } catch { return false }
}

async function saveFilUi($) {
  try { await $.store.set('fil.ui', { filter: D.filUi.filter, project: D.filUi.project, openProj: D.filUi.openProj }) } catch { /* memory only */ }
}

const root = ($) => $.plugin.root.replace(/\\/g, '/')

async function homeDir($) {
  return ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/')
}

async function vhome($) {
  const o = await $.env.get('VEILLE_HOME')
  return o ? o.replace(/\\/g, '/') : (await homeDir($)) + '/.claude/veille'
}

async function readText($, p) {
  try { return (await $.fs.exists(p)) ? await $.fs.read(p) : null } catch { return null }
}

async function readJson($, p) {
  const t = await readText($, p)
  if (!t) return null
  try { return JSON.parse(t.replace(/^﻿/, '')) } catch { return null }
}

async function load($) {
  const h = await vhome($)
  const base = (await readJson($, root($) + '/veille.config.json')) || {}
  const user = (await readJson($, h + '/config.json')) || {}
  D.cfg = deepMerge(base, user)
  D.state = await readJson($, h + '/state.json')
  D.heartbeat = await readJson($, h + '/heartbeat.json')
  const acks = (await readText($, h + '/acks.jsonl')) || ''
  D.acks = acks.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).key } catch { return null } }).filter(Boolean)
  try { D.at = await $.clock.now() } catch { D.at = Date.now() }
}

async function runWatcher($, args, timeoutMs = 30000) {
  const node = (D.cfg && D.cfg.node) || 'node'
  try {
    const r = await $.process.run([node, root($) + '/watcher/veille.mjs', ...args], { timeoutMs })
    D.msg = ((r.exitCode === 0 ? r.stdout : r.stderr || r.stdout) || '').trim().split('\n').pop().replace(/^veille: /, '').slice(0, 200)
    return r.exitCode === 0
  } catch (err) {
    D.msg = String(err && err.message ? err.message : err).slice(0, 200)
    return false
  }
}

async function act($, label, args, timeoutMs) {
  if (D.busy) return
  D.busy = label
  $.ui.invalidate('ui.render')
  try { await runWatcher($, args, timeoutMs) } finally { D.busy = ''; await load($); $.ui.invalidate('ui.render') }
}

function draw(el, cfg, vm, h) {
  const colors = cfg.colors || {}
  const L = cfg.labels || {}
  const T = (text, o = {}) => el.Text({ children: [String(text ?? '')], wrap: 'wrap', ...(o.tone && colors[o.tone] ? { color: colors[o.tone] } : {}), ...(o.dim ? { dimColor: true } : {}), ...(o.bold ? { bold: true } : {}) })
  const row = (parts, o = {}) => el.Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, ...o, children: parts.filter(Boolean) })
  const col = (parts, o = {}) => el.Box({ flexDirection: 'column', ...o, children: parts.filter(Boolean) })
  const box = (title, parts, tone) => el.Box({ flexDirection: 'column', borderStyle: 'round', borderColor: colors[tone || 'dim'], paddingX: 1, marginBottom: 1,
    children: [title ? T(title, { bold: true, tone }) : null, ...parts].filter(Boolean) })
  const btn = (label, onPress, primary) => el.Button({ children: [label], variant: primary ? 'primary' : 'secondary', onPress })
  const link = (href, label) => (href ? (el.Link ? el.Link({ href, children: [label] }) : T(label, { dim: true })) : null)

  const head = box(`${L.title || 'Veille'} · ${L.mode || 'Mode'} ${vm.mode.label || vm.mode.name}`, [
    T(vm.mode.help || ''),
    T(`${L.may || 'Peut'} : ${vm.may.join(', ') || 'rien'}`, { dim: true }),
    row(vm.modes.map((m) => btn(m.label, () => h.mode(m.id), m.current))),
    T(vm.watcher.text, { tone: vm.watcher.tone, bold: vm.watcher.tone === 'bad' }),
    T(`${L.coordinator || 'Coordinateur'} : ${vm.coordinator || L.no_coordinator || 'aucun'}${vm.mail ? ' · ' + vm.mail : ''}`, { dim: true, tone: /non configuré|erreur/.test(vm.mail) ? 'warn' : undefined }),
    vm.error ? T(`erreur : ${vm.error}`, { tone: 'bad' }) : null,
    vm.reviewsErrors.length ? T(`PR/MR non lues : ${vm.reviewsErrors.join(' ; ')}`, { tone: 'warn' }) : null,
    row([btn(h.busy === 'tour' ? 'Tour en cours…' : 'Tour maintenant', h.tour), btn('Rafraîchir', h.refresh), vm.alerts.some((a) => !a.acked) ? btn('Ack tout', () => h.ack('all')) : null]),
    h.msg ? T(h.msg, { dim: true }) : null,
  ], vm.watcher.tone === 'bad' ? 'bad' : 'dim')

  const items = vm.alerts.length ? vm.alerts.map((a) => col([
    row([
      T(`● ${(L.severity || {})[a.severity] || a.severity}`, { tone: a.acked ? 'dim' : a.severity, bold: !a.acked }),
      T(a.what, a.acked ? { dim: true } : {}),
    ]),
    row([
      a.title ? T(a.title, { dim: true }) : null,
      T(`depuis ${ago(h.now - (a.since || a.first_seen || h.now))}`, { dim: true }),
      link(a.session_link, 'conversation'), link(a.link && a.link !== a.session_link ? a.link : null, a.pr || 'lien'),
      a.acked ? T(L.acked || 'vu', { dim: true }) : btn(L.ack || 'Ack', () => h.ack(a.key)),
    ]),
  ], { marginBottom: 1 })) : [T(L.none || 'Rien à signaler.', { dim: true })]
  const alerts = box(`${L.alerts || 'Alertes'} (${vm.alerts.filter((a) => !a.acked).length})`, items, vm.julian ? 'julian' : 'dim')
  const events = box(L.actions || 'Actions et événements', vm.recent.length ? vm.recent.map((e) => T(eventText(e), { dim: !/merged|woken|mailed|failed|missed/.test(e.kind), tone: /failed|missed/.test(e.kind) ? 'bad' : /merged/.test(e.kind) ? 'ok' : undefined })) : [T('—', { dim: true })])
  return col([head, alerts, events])
}

export function register(on, raw) {
  options = raw || {}

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await load($).catch(() => undefined)
    try {
      await $.command.register({
        name: 'veille', immediate: true,
        description: 'Veille : fil des conversations (dernier message de chacune, /veille fil), mode du veilleur (rien, légère, active, nuit-active, nuit-test-légère), alertes, dernier tour, actions',
        argumentHint: 'fil | mode <rien|légère|active|nuit-active|nuit-test-légère> | ack <clé|all> | coordinateur | tour | close',
      })
    } catch { /* a name clash must not break the rest */ }
    const every = Math.max(15, ((D.cfg && D.cfg.pane) || {}).refresh_s || 60) * 1000
    $.clock.every(every, async () => { await load($).catch(() => undefined); $.ui.invalidate('ui.render') })
    return r
  })

  on('command.run', { command: 'veille' }, async ($, e) => {
    await load($)
    const q = String(e.args || '').trim()
    const [verb, ...rest] = q.split(/\s+/)
    const v = (verb || '').toLowerCase()
    if (v === 'close') { D.open = false; await $.ui.close({ id: 'veille' }); return {} }
    if (v === 'fil') {
      D.tab = 'fil'
      D.open = true
      await loadFil($)
      await $.ui.open({ id: 'veille', title: 'Veille', focus: true, closeOnEscape: true })
      $.ui.invalidate('ui.render')
      return {}
    }
    if (v === 'mode') {
      const m = modeName(D.cfg, rest.join(' '))
      if (!m) return { text: `veille: mode inconnu « ${rest.join(' ')} » (${Object.keys(D.cfg.modes || {}).join(', ')})` }
      await act($, 'mode', ['mode', m])
      return { text: `veille: ${D.msg}` }
    }
    if (v === 'ack') { await act($, 'ack', ['ack', rest.join(' ') || 'all']); return { text: `veille: ${D.msg}` } }
    if (v === 'coordinateur' || v === 'coordinator') {
      let sid = ''
      try { sid = (await $.session.id()) || '' } catch { sid = '' }
      if (!sid) return { text: 'veille: identifiant de session inconnu' }
      await act($, 'coordinator', ['coordinator', sid])
      return { text: `veille: coordinateur = cette conversation (${sid})` }
    }
    D.open = true
    if (!v) D.tab = 'alertes'
    await $.ui.open({ id: 'veille', title: 'Veille', focus: true, closeOnEscape: true })
    if (v === 'tour') void act($, 'tour', ['tour'], 300000)
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.close', { id: 'veille' }, async ($, e, next) => { D.open = false; return next(e) }).catch(() => undefined)

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== 'veille') return next(e)
    const el = $.ui.resolve(e)
    if (!D.cfg) await load($).catch(() => { D.cfg = {} })
    const cfg = D.cfg || {}
    const vm = viewModel(cfg, D.state, D.heartbeat, D.acks, D.at || Date.now())
    const FL = filLabels(cfg)
    const colors = cfg.colors || {}
    const tabs = el.Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, marginBottom: 1, alignItems: 'center', children: [
      el.Button({ children: [FL.tab_alerts || 'Alertes'], variant: D.tab === 'alertes' ? 'primary' : 'secondary', onPress: () => { D.tab = 'alertes'; $.ui.invalidate('ui.render') } }),
      el.Button({ children: [FL.tab_fil || 'Fil'], variant: D.tab === 'fil' ? 'primary' : 'secondary', onPress: () => { D.tab = 'fil'; void (D.filLoaded ? Promise.resolve() : loadFil($)).then(() => $.ui.invalidate('ui.render')) } }),
      vm.julian ? el.Text({ children: [String(FL.julian_counter || 'attend Julian : {n}').replace('{n}', vm.julian)], bold: true, ...(colors.julian ? { color: colors.julian } : {}) }) : null,
    ].filter(Boolean) })
    if (D.tab === 'fil') {
      if (!D.filLoaded) await loadFil($).catch(() => undefined)
      const now = Date.now()
      const body = drawFil(el, cfg, D.fil, D.filUi, {
        now, ago, busy: D.busy, msg: D.msg, read: D.read,
        filter: (f) => { D.filUi.filter = f; void saveFilUi($); $.ui.invalidate('ui.render') },
        project: (p) => { D.filUi.project = D.filUi.project === p ? '' : p; void saveFilUi($); $.ui.invalidate('ui.render') },
        toggleProj: (name, open) => { D.filUi.openProj = { ...D.filUi.openProj, [name]: open }; void saveFilUi($); $.ui.invalidate('ui.render') },
        toggleConv: (sid) => {
          const open = !D.filUi.openConv[sid]
          D.filUi.openConv = { ...D.filUi.openConv, [sid]: open }
          if (open) { D.read = markRead(D.read, sid, Date.now()); void $.store.set('fil.read', D.read).catch(() => undefined) }
          $.ui.invalidate('ui.render')
        },
        markAll: () => { D.read = markAllRead(Date.now()); void $.store.set('fil.read', D.read).catch(() => undefined); $.ui.invalidate('ui.render') },
        refresh: () => { void (async () => { await act($, 'fil', ['fil'], 120000); await loadFil($); $.ui.invalidate('ui.render') })() },
        openConv: (url) => { void openUrl($, url).then((ok) => { D.msg = ok ? `${FL.opened || 'lien envoyé à l’app'} : ${url}` : `${FL.open_failed || 'ouverture impossible, copie l’id'} : ${url}`; $.ui.invalidate('ui.render') }) },
        copy: (sid, press) => { void $.ui.copy({ text: sid, surface: press && press.surface }).then((r) => { D.msg = r && r.isCopied === false ? sid : `${FL.copied || 'id copié'} : ${sid}`; $.ui.invalidate('ui.render') }).catch(() => { D.msg = sid; $.ui.invalidate('ui.render') }) },
      })
      return el.Box({ flexDirection: 'column', children: [tabs, body] })
    }
    const alertsView = draw(el, cfg, vm, {
      now: D.at || Date.now(), busy: D.busy, msg: D.msg,
      mode: (m) => void act($, 'mode', ['mode', m]),
      ack: (k) => void act($, 'ack', ['ack', k]),
      tour: () => void act($, 'tour', ['tour'], 300000),
      refresh: () => { void load($).then(() => $.ui.invalidate('ui.render')) },
    })
    return el.Box({ flexDirection: 'column', children: [tabs, alertsView] })
  })

  // One line above the prompt (mode, last tour, needs Julian), below what the mods after this one draw (theirs kept).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (options.band === 'off' || (e.props && e.props.hasSurvey)) return next(e)
    const theirs = await next(e)
    if (!D.cfg) return theirs
    const cfg = D.cfg
    const parts = bandLine(viewModel(cfg, D.state, D.heartbeat, D.acks, D.at || Date.now()), cfg)
    const el = $.ui.resolve(e)
    const colors = cfg.colors || {}
    const line = el.Box({ flexDirection: 'row', flexWrap: 'wrap', children: parts.map((p, i) => el.Text({
      key: `v${i}`, children: [`${i ? ' · ' : ''}${p.text}`], ...(p.tone && p.tone !== 'dim' && colors[p.tone] ? { color: colors[p.tone] } : { dimColor: true }),
    })) })
    return theirs ? el.Box({ flexDirection: 'column', children: [theirs, line] }) : line
  }).catch(($, e, next) => next(e))
}
