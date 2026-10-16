// veille - the pane « Veille » and a one-line band entry. Read-only view of ~/.claude/veille (written by the watcher,
// the scheduled task ClaudeVeille); the buttons run the watcher's own commands (mode, ack, tour, coordinator), so there
// is one code path. Nothing here blocks, rewrites or adds text to a prompt, and nothing calls a model.
//   /veille [mode <x> | ack <clé|all> | coordinateur | tour | close]
import { deepMerge, modeName } from '../lib/modes.mjs'
import { viewModel, bandLine, eventText, ago } from './view.mjs'

let options = {}
const D = { cfg: null, state: null, heartbeat: null, acks: [], open: false, busy: '', msg: '', at: 0 }

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
        description: 'Veille : mode du veilleur (rien, légère, active, nuit-active, nuit-test-légère), alertes, dernier tour, actions',
        argumentHint: 'mode <rien|légère|active|nuit-active|nuit-test-légère> | ack <clé|all> | coordinateur | tour | close',
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
    const vm = viewModel(D.cfg || {}, D.state, D.heartbeat, D.acks, D.at || Date.now())
    return draw(el, D.cfg || {}, vm, {
      now: D.at || Date.now(), busy: D.busy, msg: D.msg,
      mode: (m) => void act($, 'mode', ['mode', m]),
      ack: (k) => void act($, 'ack', ['ack', k]),
      tour: () => void act($, 'tour', ['tour'], 300000),
      refresh: () => { void load($).then(() => $.ui.invalidate('ui.render')) },
    })
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
