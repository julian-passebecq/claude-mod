// cockpit - the dispatcher (UX-PRINCIPLES rule 7): block 1 « This laptop », block 2 « Global », then « Open in Cockpit »
// links to the page's modules. Drawn from lib/hub.mjs's model of the local Cockpit's data. Pure except for the element
// kit `h` and the callbacks in S.act.
// S = { cfg, model, error, busy, msg, columns, act: { hubTab(id), panneau(), refresh(), org(id), run(id), done(id),
//       answer(uid, key), fill(text), open(url), more(key) }, tab: 'home' | 'ongoing', panel (the Panneau's data, Ongoing) }
// With S.act.more (the pane), every section is one line (› unfolds it, its label opens its part of the page) and, with
// hub.compact, each decision or problem row is one clipped line that opens the page at that row (Julian, 13 Nov:
// « claude mod concise, open to cockpit »).
import { hubConfig, hubTabs, fill, moduleUrl, buttonLabel, machineText, repoMachines } from '../lib/hub.mjs'
import { drawThisConv } from './panel_view.mjs'

// At most n lines of w columns as the pane wraps words, the last one ending in « … » when the text goes on.
export function clipLines(s, w, n) {
  const words = String(s || '').split(/\s+/).filter(Boolean)
  const out = []
  let cur = ''
  let i = 0
  for (; i < words.length; i++) {
    const wd = words[i]
    const next = cur ? `${cur} ${wd}` : wd
    if (next.length <= w) { cur = next; continue }
    if (out.length === n - 1) break
    if (cur) out.push(cur)
    cur = wd.length > w ? wd.slice(0, w) : wd
  }
  if (i < words.length) cur = clip(`${cur} ${words[i]}`, w)
  if (cur) out.push(cur)
  return out.join(' ')
}
const clip = (s, n) => { const t = String(s || ''); return n > 3 && t.length > n ? t.slice(0, n - 1) + '…' : t }

// The two buttons above every view of the pane: the dispatcher and « Conversations » (this computer's Panneau).
export function hubBar(h, cfg, current, model, act, o = {}) {
  if (!hubTabs(cfg).length) return null
  return h.row(tabBtns(h, cfg, current, act, o), { key: 'hub-tabs', marginBottom: 1 })
}

// Dispatcher | Ongoing | Conversations: the hub views (lib/hub.mjs hubTabs), then this computer's Panneau.
function tabBtns(h, cfg, current, act, o = {}) {
  const c = hubConfig(cfg)
  return [
    ...hubTabs(cfg).map((t) => h.btn(t.label, () => act.hubTab(t.id), current === t.id, 'hubtab-' + t.id)),
    o.panneau !== false ? h.btn(c.labels.conversations, () => act.panneau(), current === 'panneau', 'hubtab-panneau') : null,
  ]
}

const arr = (x) => (Array.isArray(x) ? x : [])
const foldable = (S) => Boolean(S.act && S.act.more)
// A section folds when the pane can fold (S.act.more): open = its hub.open_sections default, flipped by each click.
const isOpen = (S, c, id) => !foldable(S) || arr(c.open_sections).includes(id) !== Boolean(S.more && S.more['__sec_' + id])
const worst = (tones) => (tones.includes('bad') ? 'bad' : tones.includes('warn') ? 'warn' : tones.find((t) => t && t !== 'dim') || undefined)

// One section as ONE line: › / ⌄ unfolds it here, its label with its count opens its part of the page, in its colour.
export function sectionLine(h, S, c, id, text, o = {}) {
  const open = isOpen(S, c, id)
  const width = o.width || 40
  return h.row([
    h.tbtn(open ? '⌄' : '›', () => S.act.more('__sec_' + id), 'sec-t-' + id, { plain: true, dim: true }),
    h.tbtn(clip(text, Math.max(8, width - 6)), () => ACT && ACT.open(o.href), 'sec-' + id, { plain: true, bold: true, tone: o.tone }),
  ], { key: 'sec-row-' + id, flexWrap: 'nowrap', gap: 1, alignItems: 'center' })
}

// One clipped row that opens `href` (a decision, a problem, a machine), with an optional › that unfolds it in place.
function rowLine(h, text, href, key, o = {}) {
  const width = o.width || 40
  return h.row([
    h.tbtn(clip(text, Math.max(8, width - 2 - (o.unfold ? 4 : 0))), () => ACT && ACT.open(href), key, { plain: true, tone: o.tone, bold: o.bold }),
    o.unfold ? h.tbtn(o.open ? '⌄' : '›', o.unfold, key + '-more', { plain: true, dim: true }) : null,
  ], { key: key + '-row', flexWrap: 'nowrap', gap: 1, alignItems: 'center' })
}

// « Open in Cockpit »: a Button that opens the page at that module in the browser (S.act.open). Not a Link: the desktop
// app draws a non-https Link as plain text, and the page lives on http://127.0.0.1 (loopback only).
let ACT = null
const link = (h, label, href, key) => h.btn(label, () => ACT && ACT.open(href), false, key)

export function drawHub(h, S) {
  const c = hubConfig(S.cfg)
  const m = S.model
  const W = m ? m.words : c.labels
  const width = Math.max(24, (S.columns || 60) - 4)
  ACT = S.act
  // one line on top: the two views, refresh, and the data's age (about one screen at 50 columns: review 5)
  const out = []
  const tab = S.tab === 'ongoing' ? 'ongoing' : 'home'
  const tabs = hubTabs(S.cfg).length ? tabBtns(h, S.cfg, tab, S.act) : []
  const age = h.T(m ? fill(W.pulled, { ago: m.pulled, built: m.built || '?' }) + (m.hubError ? ` · ${m.hubError}` : '') : '', { dim: true, key: 'hub-age', wrap: 'truncate-end' })
  const refresh = h.btn(S.busy ? '…' : W.refresh, () => S.act.refresh(), false, 'hub-refresh')
  // the views on one row; refresh and the data's age on the next (no horizontal scroll at about 300 px)
  if (foldable(S)) {
    out.push(h.row(tabs, { key: 'hub-tabs-row' }))
    out.push(h.row([refresh, age], { key: 'hub-head', alignItems: 'center', flexWrap: 'nowrap' }))
  } else out.push(h.row([...tabs, refresh, age], { key: 'hub-head', alignItems: 'center', flexWrap: 'nowrap' }))
  if (S.msg) out.push(h.T(S.msg, { key: 'hub-msg', tone: 'running', wrap: 'wrap' }))
  if (tab === 'ongoing') return h.col([...out, ...drawOngoing(h, S, c, m, width)].filter(Boolean))
  if (!m) {
    out.push(h.T(S.error || W.no_data, { tone: S.error ? 'warn' : undefined, dim: !S.error, key: 'hub-err', wrap: 'wrap' }))
    out.push(link(h, W.open, moduleUrl(c.base, ''), 'open-page'))
    return h.col(out.filter(Boolean))
  }
  // the three top lines (lane C): this computer, play / shut down (the line is the action), Oracle, then You
  if (m.top) out.push(drawTop(h, m.top, S, width))
  if (S.error) out.push(h.T(S.error, { tone: 'warn', key: 'hub-err', wrap: 'wrap' }))
  if (m.stale) out.push(h.T(m.stale, { tone: 'warn', key: 'hub-stale', wrap: 'wrap' }))
  if (m.orgs.length) {
    // folded to the current workspace on one line; « N more › » unfolds every organization (the page's switch)
    const foldable = Boolean(S.act && S.act.more)
    const open = !foldable || Boolean(S.more && S.more.__ws)
    const cur = m.orgs.find((o) => o.id === m.org)
    const shown = open ? m.orgs : cur ? [cur] : []
    const toggle = foldable ? h.btn(open ? W.ws_less : fill(W.ws_more, { n: m.orgs.length - shown.length }), () => S.act.more('__ws'), false, 'org-more') : null
    out.push(h.row([h.T(W.workspace, { dim: true }), h.btn(W.org_all, () => S.act.org(''), !m.org, 'org-all'),
      ...shown.map((o) => h.btn(o.label, () => S.act.org(o.id), m.org === o.id, 'org-' + o.id)), toggle], { key: 'hub-orgs', alignItems: 'center', marginBottom: 1 }))
  }
  // the critical strip on top of everything (UX rule 20: work is stopped), when the page data has one
  if ((m.critical || []).length) {
    // each row: its severity word and what is stopped (two lines at most), then the action and where it is. A row whose
    // story is a decision carries that decision's recommended answer (the decision is not repeated below)
    const modLabel = (id) => (m.modules.find((x) => x.id === id) || {}).label || ''
    out.push(h.box(m.criticalHead || W.critical, m.critical.map((r, i) => {
      const d = r.decision
      const rec = d && !d.sent ? d.answers.find((a) => a.rec) : null
      const act = rec
        ? [h.btn(clip(buttonLabel(rec), width - 26), () => S.act.answer(d.uid, rec.key), true, `crit-ans-${i}`), link(h, W.more_row, d.url, 'crit-more-' + i)]
        : [link(h, modLabel(r.module) ? fill(W.crit_open, { module: modLabel(r.module) }) : W.more_row, moduleUrl(c.base, r.link), 'crit-more-' + i)]
      const sev = r.severity && r.severity !== 'critical' ? r.severity : W.crit_sev
      return h.col([
        h.T(clipLines(`! ${sev} · ${r.text}`, width, 2), { tone: 'bad', bold: true, key: 'text', wrap: 'wrap' }),
        d && d.sent ? h.T(fill(W.answered, { label: d.sent.label, at: m.time(d.sent.t) }), { tone: 'ok', key: 'sent', wrap: 'wrap' }) : null,
        h.row([...act, h.T([r.where, r.id].filter(Boolean).join(' · '), { dim: true, key: 'where', wrap: 'truncate-end' })], { key: 'act', alignItems: 'center', flexWrap: 'nowrap' }),
      ].filter(Boolean), { key: 'crit-' + i })
    }), { key: 'blk-critical', tone: 'bad' }))
  }
  out.push(foldable(S) ? drawLaptopFolded(h, m, c, S, width) : drawLaptop(h, m, c, S, width))
  out.push(drawGlobal(h, m, c, S, width))
  // « Open in Cockpit »: one line (the page, and « modules › » that unfolds one button per page module)
  const foldOpen = Boolean(S.act && S.act.more)
  const openAll = !foldOpen || Boolean(S.more && S.more.__open)
  if (foldOpen) {
    out.push(h.row([link(h, W.open, moduleUrl(c.base, ''), 'open-page'), h.btn(openAll ? W.ws_less : W.open_modules, () => S.act.more('__open'), false, 'open-more'),
      h.T(m.base, { dim: true, key: 'open-base', wrap: 'truncate-end' })], { key: 'open-head', alignItems: 'center' }))
    if (openAll) out.push(h.row(m.modules.map((x) => link(h, x.label, x.url, 'open-' + x.id)), { key: 'open-links' }))
  } else {
    out.push(h.T(W.open, { bold: true, key: 'open-head' }))
    out.push(h.row(m.modules.map((x) => link(h, x.label, x.url, 'open-' + x.id)), { key: 'open-links', marginBottom: 1 }))
    out.push(h.T(m.base, { dim: true, key: 'open-base' }))
  }
  return h.col(out.filter(Boolean))
}

// The top lines, one each, in the hub's words; the play line sends its click (S.act.top), You opens its item on the page.
export function drawTop(h, t, S, width) {
  const w = Math.max(16, width)
  return h.col([
    h.T(clipLines(t.this, w, 2), { key: 'top-this', bold: true, tone: t.tone === 'ok' ? 'ok' : t.tone === 'warn' ? 'warn' : undefined, wrap: 'wrap' }),
    t.clickText && S.act && S.act.top
      ? h.col([h.tbtn(clipLines(t.play, w, 2), () => S.act.top(), 'top-play', { plain: true }),
        t.clickHint ? h.T(t.clickHint, { key: 'top-hint', dim: true, wrap: 'truncate-end' }) : null].filter(Boolean), { key: 'top-play-col' })
      : h.T(clipLines(t.play, w, 2), { key: 'top-play', wrap: 'wrap' }),
    h.T(clipLines(t.oracle, w, 2), { key: 'top-oracle', dim: false, wrap: 'wrap' }),
    h.tbtn(clipLines(t.you, w, 2), () => S.act && S.act.open(t.youUrl), 'top-you', { plain: true, tone: t.youN ? 'warn' : undefined }),
  ], { key: 'top-lines', marginBottom: 1 })
}

function drawLaptop(h, m, c, S, width) {
  const W = m.words
  const P = m.laptop
  const max = Number(c.max_rows) || 5
  const tmax = Number(c.todo.max) || 3
  const rows = []
  if (!P.known) rows.push(h.T(fill(W.laptop_unknown, { machine: m.machine }), { dim: true, key: 'lp-unknown', wrap: 'wrap' }))
  rows.push(h.T(P.line, { tone: P.tone && P.tone !== 'dim' ? P.tone : undefined, dim: P.tone === 'dim', key: 'lp-state', wrap: 'wrap' }))
  rows.push(h.T([P.temp.text, P.agents, P.seen].filter(Boolean).join(' · '), { tone: P.temp.tone === 'dim' ? undefined : P.temp.tone || undefined, dim: P.temp.tone === 'dim', key: 'lp-temp', wrap: 'wrap' }))
  // the tile's reasons on one wrapped line, red ones first (the full list is the page's Fleet tile); the ones on the
  // critical strip are said there only
  if (P.onStrip) rows.push(h.T(W.crit_here, { tone: 'bad', key: 'lp-crit' }))
  if (P.warn.length) {
    const ws = [...P.warn].sort((a, b) => Number(b.tone === 'bad') - Number(a.tone === 'bad'))
    rows.push(h.T(clipLines(`! ${ws.map((w) => w.text).join(' · ')}`, width, 2), { tone: ws[0].tone || 'warn', key: 'lp-warn', wrap: 'wrap' }))
  }
  rows.push(h.T(`${W.working}: ${P.work.length ? '' : W.working_none}`, { dim: !P.work.length, key: 'lp-work', wrap: 'wrap' }))
  P.work.slice(0, max).forEach((w, i) => rows.push(h.T(`  ${clip(w.text, width * 2)}`, { tone: w.tone, key: 'lp-wk' + i, wrap: 'wrap' })))
  // the steps here that are not a decision row; the others are under Needs you now, said in one line
  const asDec = Number(P.asDecisions) || 0
  if (P.todos.length) rows.push(h.T(fill(W.todo_here, { n: P.todos.length }), { bold: true, key: 'lp-todo-head' }))
  else rows.push(h.T(asDec ? fill(W.todo_all_decisions, { n: asDec }) : W.todo_none, { dim: true, key: 'lp-todo-none', wrap: 'wrap' }))
  // one line per to-do; Run and Mark done only on the first one that can run (the rest is one click away in the page)
  const first = P.todos.slice(0, tmax).find((t) => t.canRun)
  P.todos.slice(0, tmax).forEach((t) => {
    const note = t.marked ? W.marked : t.pending ? W.pending : ''
    const title = h.T(clip(`${t.title}${note ? ` (${note})` : ''}`, width * Math.max(1, Number(c.title_lines) || 1)), { bold: t.urgent && !t.marked, tone: t.marked ? 'ok' : t.urgent ? 'bad' : undefined, wrap: 'wrap', key: 'title' })
    rows.push(t === first
      ? h.col([title, h.row([h.btn(W.run, () => S.act.run(t.id), true, 'run-' + t.id), h.btn(W.done, () => S.act.done(t.id), false, 'done-' + t.id)], { key: 'btns' })], { key: `todo-${t.id}` })
      : h.col([title], { key: `todo-${t.id}` }))
  })
  if (P.todos.length > tmax) rows.push(link(h, fill(W.show_all, { n: P.todos.length }), moduleUrl(c.base, 'todo'), 'lp-todo-all'))
  if (P.todos.length && asDec) rows.push(h.T(fill(W.todo_as_decisions, { n: asDec }), { dim: true, key: 'lp-todo-dec', wrap: 'wrap' }))
  return h.box(fill(W.laptop, { machine: m.label }), rows, { key: 'blk-laptop', tone: P.tone === 'bad' || P.todos.some((t) => t.urgent && !t.marked) ? 'bad' : undefined })
}

function drawGlobal(h, m, c, S, width) {
  const W = m.words
  const G = m.global
  const rows = []
  const tl = Math.max(1, Number(c.title_lines) || 1)
  const gmax = Math.max(1, Number(c.global_max) || 5)
  if (G.fleetLine) rows.push(h.T(clip(G.fleetLine, width), { key: 'gl-fleet', wrap: 'truncate-end' }))
  // the quota row, the page's Quota reading (glance.quota) under its fleet sentence, as on the page
  if (G.quota && foldable(S)) rows.push(rowLine(h, `● ${G.quota.text}`, moduleUrl(c.base, 'quota'), 'gl-quota', { width, tone: G.quota.tone || undefined }))
  else if (G.quota) rows.push(h.T(clipLines(`● ${G.quota.text}${G.quota.covers.length ? ` · ${fill(W.covers, { list: G.quota.covers.join(', ') })}` : ''}`, width, 2), { tone: G.quota.tone || undefined, key: 'gl-quota', wrap: 'wrap' }))
  // one line per machine (R58): « ● MSI · normal · 9 running », a click opens its Fleet tile (#tile-<id>)
  if (G.dots.length) {
    if (foldable(S)) rows.push(sectionLine(h, S, c, 'machines', `${W.machines} (${G.dots.length})`, { width, href: moduleUrl(c.base, 'fleet'), tone: worst(G.dots.map((d) => d.tone)) }))
    if (isOpen(S, c, 'machines')) {
      for (const d of G.dots) {
        rows.push(rowLine(h, `● ${machineText(d, W)}`, moduleUrl(c.base, d.link), 'dot-' + d.id, { width, tone: d.tone && d.tone !== 'dim' ? d.tone : undefined }))
      }
    }
  }
  // about global_max rows in all: Needs you now first, then at least one Problems now row when there is one
  // the page's decisions: all its top rows (the page shows them all), then one Problems now row at least
  const errN = G.showErrors || G.fleetWs ? Math.min(G.errors.length, G.errors.length ? Math.max(1, gmax - G.you.length) : 0) : 0
  // the page's decisions: its top rows in its order, about global_max (five) of them, then « show all N »
  const youN = G.decisions ? Math.min(G.you.length, gmax) : Math.max(0, Math.min(G.you.length, gmax - errN))
  // the page's heading, then its own count sentence (« 14 need you now (at 21:16) ») on the same line; folded: one line
  const youTone = G.you.some((q) => q.tone === 'bad') || (m.critical || []).length ? 'bad' : G.youTotal ? 'warn' : undefined
  if (foldable(S)) rows.push(sectionLine(h, S, c, 'you', `${W.you_block} (${G.youTotal})`, { width, href: moduleUrl(c.base, 'overview'), tone: youTone }))
  else {
    rows.push(G.youCount
      ? h.T(clip(`${W.you_block} · ${G.youCount}`, width), { bold: true, key: 'gl-you-head', wrap: 'truncate-end' })
      : h.T(`${W.you_block} (${G.youTotal})`, { bold: true, key: 'gl-you-head' }))
  }
  const youOpen = isOpen(S, c, 'you')
  if (youOpen && !G.you.length) rows.push(h.T(W.you_none, { dim: true, key: 'gl-you-none' }))
  const compact = foldable(S) && c.compact !== false
  for (const q of youOpen ? G.you.slice(0, youN) : []) {
    // hub.compact: one clipped line that opens the page at that row; its › unfolds today's full row (the answers)
    if (compact && !(S.more && S.more[q.uid])) {
      rows.push(rowLine(h, q.title, q.url || moduleUrl(c.base, 'overview'), 'you-' + q.uid, { width, tone: q.tone || undefined, unfold: () => S.act.more(q.uid), open: false }))
      continue
    }
    // a decision row (review 5, MAJOR 2): the title on title_lines lines, one line of why after its organization, the
    // recommended answer with what it does in a few words, and « more » (the page at that row, every option)
    const parts = [h.T(clipLines(q.title, width, tl), { tone: q.tone || undefined, wrap: 'wrap', key: 'title' })]
    if (q.url) {
      const whyLine = [!m.org ? q.orgLabel : '', q.why || q.meta.filter((x) => x !== q.orgLabel).join(' · ')].filter(Boolean).join(': ')
      if (whyLine) parts.push(h.T(clip(whyLine, width), { dim: true, key: 'why', wrap: 'truncate-end' }))
    } else parts.push(h.T(clip([q.covers, ...q.meta].filter(Boolean).join(' · '), width), { dim: true, key: 'meta', wrap: 'truncate-end' }))
    if (q.sent) parts.push(h.T(fill(W.answered, { label: q.sent.label, at: m.time(q.sent.t) }), { tone: 'ok', key: 'sent', wrap: 'wrap' }))
    else if (q.url) {
      // the page's recommended answer (primary button, one click sends it), then « more »: the page at that row, where
      // every option and what it changes is shown (UX rule 19)
      const rec = q.answers.find((a) => a.rec)
      const btns = []
      if (rec) btns.push(h.btn(clip(buttonLabel(rec), width - 11), () => S.act.answer(q.uid, rec.key), true, `ans-${q.uid}-${rec.key}`))
      btns.push(link(h, W.more_row, q.url, `more-${q.uid}`))
      parts.push(h.row(btns, { key: 'answers', flexWrap: 'nowrap' }))
      // what the recommended answer does, in a few words (its note's first clause)
      if (rec && q.effect) parts.push(h.T(clip(fill(W.effect, { effect: q.effect }), width), { dim: true, key: 'effect', wrap: 'truncate-end' }))
    } else if (q.answers.length) {
      // the recommended answer, then « more » for the other options (unfolded in place)
      const open = Boolean(S.more && S.more[q.uid])
      const rec = q.answers.find((a) => a.rec) || q.answers[0]
      const shown = open ? q.answers : [rec]
      const label = (a) => `${a.key === 'rec' ? '' : `${a.key}) `}${a.label}`
      // folded: the one button is the recommended answer (drawn as the primary button); unfolded: the page's « · recommended »
      const btns = shown.map((a) => h.btn(open ? `${clip(label(a), width - 18)}${a.rec ? ` · ${W.recommended}` : ''}` : clip(label(a), width - 14),
        () => S.act.answer(q.uid, a.key), a.rec, `ans-${q.id}-${a.key}`))
      if (q.answers.length > 1) btns.push(h.btn(open ? W.less_answers : `${W.more_answers} (${q.answers.length - 1})`, () => S.act.more(q.uid), false, `more-${q.id}`))
      parts.push(h.row(btns, { key: 'answers' }))
    } else if (q.question) parts.push(h.T(`${q.rec ? fill(W.rec_text, { rec: q.rec }) + ' ' : ''}${W.no_answer}`, { dim: true, key: 'hint', wrap: 'truncate-end' }))
    if (compact) parts.unshift(h.row([h.tbtn('⌄', () => S.act.more(q.uid), `you-${q.uid}-less`, { plain: true, dim: true })], { key: 'less' }))
    rows.push(h.col(parts.filter(Boolean), { key: 'you-' + q.uid }))
  }
  // show all, the waiting ones and what was decided for you: one row of links
  if (youOpen) rows.push(h.row([
    G.youTotal > youN ? link(h, fill(W.show_all, { n: G.youTotal }), moduleUrl(c.base, 'overview'), 'gl-you-all') : null,
    G.waitingLine ? link(h, G.waitingLine, moduleUrl(c.base, 'inbox'), 'gl-waiting') : null,
    G.decidedLine ? link(h, G.decidedLine, moduleUrl(c.base, 'inbox'), 'gl-decided') : null,
  ], { key: 'gl-you-links' }))
  if ((G.showErrors || G.fleetWs) && foldable(S)) {
    // Problems now as one line (count, colour; a click opens the page's Overview); unfolded, one clipped line per row
    const errTone = worst(G.errors.map((e) => e.tone || 'bad'))
    rows.push(sectionLine(h, S, c, 'errors', `${W.errors} (${G.errorsTotal || G.errors.length})`, { width, href: moduleUrl(c.base, 'overview'), tone: errTone }))
    if (isOpen(S, c, 'errors')) {
      if (!G.errors.length) rows.push(h.T(W.errors_none, { dim: true, key: 'gl-err-none' }))
      G.errors.slice(0, errN).forEach((e, i) => rows.push(c.compact !== false
        ? rowLine(h, `! ${e.text}`, moduleUrl(c.base, 'overview'), 'gl-e' + i, { width, tone: e.tone || undefined })
        : h.col([h.T(clipLines(`! ${e.text}`, width, 2), { tone: e.tone || undefined, key: 'text', wrap: 'wrap' }),
          e.meta.length ? h.T(clip(e.meta.join(' · '), width), { dim: true, key: 'meta', wrap: 'truncate-end' }) : null].filter(Boolean), { key: 'gl-e' + i })))
      if (G.errorsTotal > errN) rows.push(link(h, fill(W.show_all, { n: G.errorsTotal }), moduleUrl(c.base, 'overview'), 'gl-err-all'))
      if (G.later) rows.push(link(h, `${G.later} ${W.look_later}`, moduleUrl(c.base, 'overview'), 'gl-later'))
      if (G.covered) rows.push(h.T(fill(W.covered, { n: G.covered }), { dim: true, key: 'gl-err-covered', wrap: 'wrap' }))
    }
  } else if (G.showErrors || G.fleetWs) {
    rows.push(h.T(clip(`${W.errors}${G.errorsAt ? ` · ${G.errorsAt}` : ''}`, width), { bold: true, key: 'gl-err-head', wrap: 'truncate-end' }))
    if (!G.errors.length) rows.push(h.T(W.errors_none, { dim: true, key: 'gl-err-none' }))
    G.errors.slice(0, errN).forEach((e, i) => rows.push(h.col([
      h.T(clipLines(`! ${e.text}`, width, 2), { tone: e.tone || undefined, key: 'text', wrap: 'wrap' }),
      e.meta.length ? h.T(clip(e.meta.join(' · '), width), { dim: true, key: 'meta', wrap: 'truncate-end' }) : null,
    ].filter(Boolean), { key: 'gl-e' + i })))
    if (G.errorsTotal > errN) rows.push(link(h, fill(W.show_all, { n: G.errorsTotal }), moduleUrl(c.base, 'overview'), 'gl-err-all'))
    if (G.later) rows.push(link(h, `${G.later} ${W.look_later}`, moduleUrl(c.base, 'overview'), 'gl-later'))
    if (G.covered) rows.push(h.T(fill(W.covered, { n: G.covered }), { dim: true, key: 'gl-err-covered', wrap: 'wrap' }))
  }
  if (G.alerts) rows.push(foldable(S) ? rowLine(h, G.alerts.text, moduleUrl(c.base, 'alerts'), 'gl-alerts', { width, tone: G.alerts.tone || undefined, bold: true }) : link(h, G.alerts.text, moduleUrl(c.base, 'alerts'), 'gl-alerts'))
  if (G.urgentElsewhere) rows.push(link(h, fill(W.urgent_elsewhere, { n: G.urgentElsewhere }), moduleUrl(c.base, 'todo'), 'gl-urgent-else'))
  rows.push(h.row([
    h.T(W.actions, { bold: true, key: 'h' }),
    h.btn(W.send_job, () => S.act.fill('/dispatch '), false, 'act-dispatch'),
    h.btn(W.add_todo, () => S.act.fill('/todo '), false, 'act-todo'),
  ], { key: 'gl-actions', alignItems: 'center' }))
  const tone = G.errors.some((e) => e.tone === 'bad') || G.you.some((q) => q.tone === 'bad') ? 'bad' : undefined
  return h.box(`${W.global}${m.org ? ` · ${(m.orgs.find((o) => o.id === m.org) || {}).label || m.org}` : ''}`, rows, { key: 'blk-global', tone })
}

// This laptop, folded (the pane): its state on one line, then one line each for its warnings, what it works on and its
// to-dos (count and colour; a click opens its Fleet tile or the page's To do, › unfolds it here).
function drawLaptopFolded(h, m, c, S, width) {
  const W = m.words
  const P = m.laptop
  const max = Number(c.max_rows) || 5
  const tile = moduleUrl(c.base, 'tile-' + m.machine)
  const rows = []
  if (!P.known) rows.push(h.T(clip(fill(W.laptop_unknown, { machine: m.machine }), width), { dim: true, key: 'lp-unknown', wrap: 'truncate-end' }))
  rows.push(rowLine(h, P.line || '', tile, 'lp-state', { width, tone: P.tone && P.tone !== 'dim' ? P.tone : undefined }))
  if (P.onStrip) rows.push(h.T(clip(W.crit_here, width), { tone: 'bad', key: 'lp-crit', wrap: 'truncate-end' }))
  const ws = [...P.warn].sort((a, b) => Number(b.tone === 'bad') - Number(a.tone === 'bad'))
  rows.push(sectionLine(h, S, c, 'lp-warn', `${W.warnings} (${ws.length})`, { width, href: tile, tone: ws.length ? worst(ws.map((w) => w.tone || 'warn')) : undefined }))
  if (isOpen(S, c, 'lp-warn')) {
    rows.push(h.T(clip([P.temp.text, P.agents, P.seen].filter(Boolean).join(' · '), width), { tone: P.temp.tone === 'dim' ? undefined : P.temp.tone || undefined, dim: P.temp.tone === 'dim', key: 'lp-temp', wrap: 'truncate-end' }))
    ws.forEach((w, i) => rows.push(rowLine(h, `! ${w.text}`, tile, 'lp-w' + i, { width, tone: w.tone || 'warn' })))
  }
  rows.push(sectionLine(h, S, c, 'lp-work', `${W.working} (${P.work.length})`, { width, href: tile, tone: P.work.length ? worst(P.work.map((w) => w.tone)) || 'running' : undefined }))
  if (isOpen(S, c, 'lp-work')) {
    if (!P.work.length) rows.push(h.T(W.working_none, { dim: true, key: 'lp-work-none' }))
    P.work.slice(0, max).forEach((w, i) => rows.push(h.T(clip(w.text, width), { tone: w.tone, key: 'lp-wk' + i, wrap: 'truncate-end' })))
  }
  const asDec = Number(P.asDecisions) || 0
  const urgent = P.todos.some((t) => t.urgent && !t.marked)
  const todoText = `${fill(W.todo_here, { n: P.todos.length })}${asDec ? ` · ${fill(W.todo_dec_short, { n: asDec })}` : ''}`
  rows.push(sectionLine(h, S, c, 'lp-todo', todoText, { width, href: moduleUrl(c.base, 'todo'), tone: urgent ? 'bad' : P.todos.length ? 'warn' : undefined }))
  if (isOpen(S, c, 'lp-todo')) {
    const tmax = Number(c.todo.max) || 3
    const first = P.todos.slice(0, tmax).find((t) => t.canRun)
    if (!P.todos.length) rows.push(h.T(clip(asDec ? fill(W.todo_all_decisions, { n: asDec }) : W.todo_none, width), { dim: true, key: 'lp-todo-none', wrap: 'truncate-end' }))
    P.todos.slice(0, tmax).forEach((t) => {
      const note = t.marked ? W.marked : t.pending ? W.pending : ''
      rows.push(rowLine(h, `${t.title}${note ? ` (${note})` : ''}`, moduleUrl(c.base, 'todo'), 'todo-' + t.id, { width, bold: t.urgent && !t.marked, tone: t.marked ? 'ok' : t.urgent ? 'bad' : undefined }))
      if (t === first) rows.push(h.row([h.btn(W.run, () => S.act.run(t.id), true, 'run-' + t.id), h.btn(W.done, () => S.act.done(t.id), false, 'done-' + t.id)], { key: 'btns-' + t.id }))
    })
    if (P.todos.length > tmax) rows.push(link(h, fill(W.show_all, { n: P.todos.length }), moduleUrl(c.base, 'todo'), 'lp-todo-all'))
    if (P.todos.length && asDec) rows.push(h.T(clip(fill(W.todo_as_decisions, { n: asDec }), width), { dim: true, key: 'lp-todo-dec', wrap: 'truncate-end' }))
  }
  return h.box(fill(W.laptop, { machine: m.label }), rows, { key: 'blk-laptop', tone: P.tone === 'bad' || urgent ? 'bad' : undefined })
}

// Ongoing (R63, R70): what runs in THIS conversation (its parent, Workflows, agents, sub-conversations: the Panneau's
// own lines), whether other conversations work on this computer, then its repo and branch and, for that repo, the
// machines that have a queue job in it. What the hub does not publish is said « not reported », never guessed.
function drawOngoing(h, S, c, m, width) {
  const W = m ? m.words : c.labels
  const out = []
  const P = S.panel
  let conv = { els: [], self: null, elsewhere: 0 }
  if (P) {
    try { conv = drawThisConv(h, { ...P, columns: Math.max(30, width) }) } catch { conv = { els: [], self: null, elsewhere: 0 } }
  }
  const rows = conv.els.length ? conv.els : [h.T(P ? W.this_conv_none : W.no_data, { dim: true, key: 'og-none', wrap: 'wrap' })]
  out.push(h.box(W.this_conv, rows, { key: 'blk-ongoing' }))
  // the « elsewhere » line opens this computer's Panneau (every conversation), not the page
  const other = conv.elsewhere ? fill(W.elsewhere, { n: conv.elsewhere }) : W.elsewhere_none
  out.push(h.row([h.tbtn(clip(other, width), () => S.act.panneau(), 'og-elsewhere', { plain: true, tone: conv.elsewhere ? 'ok' : undefined, dim: !conv.elsewhere })], { key: 'og-elsewhere-row', marginBottom: 1 }))
  const row = conv.self && conv.self.row
  const repo = row && row.project && row.project !== '?' ? row.project : ''
  const repoRows = []
  if (!repo) repoRows.push(h.T(W.repo_none, { dim: true, key: 'og-repo-none', wrap: 'wrap' }))
  else {
    repoRows.push(h.T(clip(fill(W.repo_line, { repo, branch: row.branch || W.not_reported }), width), { bold: true, key: 'og-repo', wrap: 'truncate-end' }))
    if (m) {
      const ms = repoMachines(m, repo)
      repoRows.push(h.T(clip(fill(W.repo_machines, { repo }), width), { dim: true, key: 'og-rm-h', wrap: 'truncate-end' }))
      if (!ms.length) repoRows.push(h.T(W.repo_jobs_none, { dim: true, key: 'og-rm-none' }))
      for (const d of ms) repoRows.push(rowLine(h, `● ${d.label} · ${d.repoJobs} job${d.repoJobs === 1 ? '' : 's'}`, moduleUrl(c.base, d.link), 'og-m-' + d.id, { width, tone: d.tone && d.tone !== 'dim' ? d.tone : undefined }))
      // machines whose tile has no running list: their jobs are not reported
      const silent = m.global.dots.filter((d) => d.running === null || d.running === undefined)
      if (silent.length) repoRows.push(h.T(clip(`${silent.map((d) => d.label).join(', ')}: ${W.not_reported}`, width), { dim: true, key: 'og-rm-silent', wrap: 'truncate-end' }))
    }
    repoRows.push(h.T(clip(W.sessions_not_reported, width * 2), { dim: true, key: 'og-sessions', wrap: 'wrap' }))
  }
  out.push(h.box('', repoRows, { key: 'blk-repo' }))
  return out
}
