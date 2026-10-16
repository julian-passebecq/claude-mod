// a-faire - the pane « À faire par Julian » (/afaire): every action only Julian can do, by category, with the exact
// steps (Copier), since when, the source, and Fait / Plus tard. Read-only view of ~/.claude/a-faire/items.json; the
// scanner (scanner/afaire_scan.mjs, run with node) reads the sources and writes it, and the buttons run its own
// done / snooze commands, so there is one code path. Nothing here blocks, rewrites or adds text to a prompt, and
// nothing calls a model. The band mod reads summary.json for its red « À toi : N ».
//   /afaire [refresh | close]
import { deepMerge } from '../lib/items.mjs'
import { initialOpen, viewModel } from './view.mjs'

const D = { cfg: null, data: null, openCats: null, busy: '', msg: '', at: 0, scanning: false }

const root = ($) => $.plugin.root.replace(/\\/g, '/')

async function homeDir($) {
  return ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/')
}

async function ahome($) {
  const o = await $.env.get('AFAIRE_HOME')
  if (o) return o.replace(/\\/g, '/')
  const h = (D.cfg && D.cfg.home) || '~/.claude/a-faire'
  return h.replace(/^~(?=$|[\\/])/, await homeDir($)).replace(/\\/g, '/')
}

async function readJson($, p) {
  try {
    if (!(await $.fs.exists(p))) return null
    return JSON.parse(String(await $.fs.read(p)).replace(/^﻿/, ''))
  } catch { return null }
}

async function load($) {
  const base = (await readJson($, root($) + '/afaire.config.json')) || {}
  D.cfg = base
  const user = (await readJson($, (await ahome($)) + '/config.json')) || {}
  D.cfg = deepMerge(base, user)
  D.data = await readJson($, (await ahome($)) + '/items.json')
  if (!D.openCats && D.data) D.openCats = initialOpen(D.cfg, D.data)
  try { D.at = await $.clock.now() } catch { D.at = Date.now() }
}

async function runScanner($, args, timeoutMs = 90000) {
  const node = (D.cfg && D.cfg.node) || 'node'
  try {
    const r = await $.process.run([node, root($) + '/scanner/afaire_scan.mjs', ...args], { timeoutMs })
    D.msg = ((r.exitCode === 0 ? r.stdout : r.stderr || r.stdout) || '').trim().split('\n').pop().replace(/^afaire: /, '').slice(0, 200)
    return r.exitCode === 0
  } catch (err) {
    D.msg = String(err && err.message ? err.message : err).slice(0, 200)
    return false
  }
}

async function act($, label, args) {
  if (D.busy) return
  D.busy = label
  $.ui.invalidate('ui.render')
  try { await runScanner($, args) } finally { D.busy = ''; await load($); $.ui.invalidate('ui.render') }
}

// Background refresh (session start, clock): keeps summary.json fresh for the band, skipped when recent.
async function refresh($, force) {
  if (D.scanning) return
  D.scanning = true
  try {
    if (!D.cfg) await load($)
    const every = Math.max(1, (D.cfg && D.cfg.refresh_min) || 5) * 60
    await runScanner($, force ? ['scan', '--fresh'] : ['scan', '--max-age-s', String(every - 30)])
    await load($)
    $.ui.invalidate('ui.render')
  } catch { /* the next tick tries again */ } finally { D.scanning = false }
}

function draw(el, cfg, vm, h) {
  const colors = cfg.colors || {}
  const L = cfg.labels || {}
  const T = (text, o = {}) => el.Text({ children: [String(text ?? '')], wrap: o.wrap || 'wrap', ...(o.tone && colors[o.tone] ? { color: colors[o.tone] } : {}), ...(o.dim ? { dimColor: true } : {}), ...(o.bold ? { bold: true } : {}) })
  const row = (parts, o = {}) => el.Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, ...o, children: parts.filter(Boolean) })
  const col = (parts, o = {}) => el.Box({ flexDirection: 'column', ...o, children: parts.filter(Boolean) })
  const btn = (label, onPress, primary) => el.Button({ children: [label], variant: primary ? 'primary' : 'secondary', onPress })
  const link = (href, label) => (href ? (el.Link ? el.Link({ href, children: [label] }) : T(`${label} : ${href}`, { dim: true })) : null)

  const head = col([
    row([T(vm.title, { bold: true, tone: vm.high ? 'now' : vm.total ? 'feature' : 'ok' }), btn(h.busy === 'refresh' ? L.scanning || 'Lecture…' : L.refresh || 'Rafraîchir', h.refresh)]),
    T(vm.head, { dim: !vm.total }),
    !vm.at ? T(L.never || 'jamais lu', { dim: true }) : null,
    h.msg ? T(h.msg, { dim: true }) : null,
  ], { marginBottom: 1 })

  const item = (i) => col([
    row([T('●', { tone: i.prio }), T(i.title, { bold: true })], { flexWrap: 'nowrap' }),
    T(`${i.prioLabel} · ${i.why}`, { dim: true }),
    ...(i.steps || []).map((s) => row([T(s.text), s.copy ? T(s.copy, { tone: 'feature' }) : null, s.copy ? btn(L.copy || 'Copier', (press) => h.copy(press, s.copy)) : null])),
    row([
      i.sinceText ? T(i.sinceText, { dim: true }) : null,
      btn(L.done || 'Fait', () => h.done(i.id), true),
      btn(L.later || 'Plus tard', () => h.later(i.id)),
      i.source && i.source.href ? link(i.source.href, L.source || 'Voir la source') : T(i.source ? i.source.label : '', { dim: true }),
    ]),
  ], { marginLeft: 2, marginBottom: 1 })

  const cats = vm.cats.map((c) => col([
    row([
      btn(`${c.unfolded ? '▾' : '▸'} ${c.label} (${c.n})`, () => h.toggle(c.cat)),
      c.unfolded ? null : T(c.summary, { dim: !c.n, tone: c.n ? c.tone : undefined, wrap: 'truncate-end' }),
    ], { flexWrap: 'nowrap' }),
    ...(c.unfolded ? (c.items.length ? c.items.map(item) : [T(L.empty_cat || 'rien', { dim: true })]) : []),
  ]))

  const foot = col([
    vm.snoozed ? row([T(`${L.snoozed || 'Reporté(s)'} : ${vm.snoozed}`, { dim: true }), btn(L.unsnooze || 'Tout réafficher', h.unsnooze)]) : null,
    vm.errors.length ? T(`${L.unread || 'Sources non lues'} : ${vm.errors.join(', ')}`, { tone: 'feature' }) : null,
  ], { marginTop: 1 })
  return col([head, ...cats, foot], { flexGrow: 1 })
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      await $.command.register({ name: 'afaire', immediate: true, description: 'À faire par Julian : tout ce qui attend une action de toi (configuration, décisions, connexions, secrets, tests manuels, questions)', argumentHint: '[refresh | close]' })
    } catch { /* a name clash must not break the rest */ }
    await load($).catch(() => undefined)
    void refresh($, false)
    const every = Math.max(1, (D.cfg && D.cfg.refresh_min) || 5) * 60000
    $.clock.every(every, () => void refresh($, false))
    return r
  })

  on('command.run', { command: 'afaire' }, async ($, e) => {
    await load($)
    const v = String(e.args || '').trim().toLowerCase()
    if (v === 'close') { await $.ui.close({ id: 'afaire' }); return {} }
    await $.ui.open({ id: 'afaire', title: (D.cfg.labels || {}).title || 'À faire par Julian', focus: true, closeOnEscape: true })
    if (v === 'refresh' || !D.data) void act($, 'refresh', ['scan', '--fresh'])
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== 'afaire') return next(e)
    const el = $.ui.resolve(e)
    if (!D.cfg) await load($).catch(() => { D.cfg = {} })
    const cfg = D.cfg || {}
    const now = D.at || Date.now()
    const vm = viewModel(cfg, D.data, D.openCats || initialOpen(cfg, D.data), now)
    return draw(el, cfg, vm, {
      busy: D.busy, msg: D.msg,
      refresh: () => void act($, 'refresh', ['scan', '--fresh']),
      done: (id) => void act($, 'done', ['done', id]),
      later: (id) => void act($, 'later', ['snooze', id]),
      unsnooze: () => void act($, 'unsnooze', ['unsnooze', 'all']),
      toggle: (cat) => {
        const cur = D.openCats || initialOpen(cfg, D.data)
        D.openCats = cur.includes(cat) ? cur.filter((c) => c !== cat) : [...cur, cat]
        $.ui.invalidate('ui.render')
      },
      copy: async (press, text) => {
        const L = cfg.labels || {}
        try {
          const r = await $.ui.copy({ text, surface: press && press.surface })
          D.msg = r && r.isCopied ? `${L.copied || 'copié'} : ${text.slice(0, 80)}` : L.copy_failed || 'copie refusée'
        } catch { D.msg = L.copy_failed || 'copie refusée' }
        $.ui.invalidate('ui.render')
      },
    })
  })
}
