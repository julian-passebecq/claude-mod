// veille - the « Fil » screen of the Veille pane: top to bottom, projects (foldable, one summary line) → lead
// conversations → their sub-conversations (indented), each folded to title, state, model·effort, time and a two-line
// preview; unfolded: the full last message (Markdown), the ask and its buttons, PR links, « Ouvrir la conversation ».
// Reads ~/.claude/veille/fil.json only (written by the watcher); nothing sent to a model, nothing added to a prompt.
import { filterFil, flatten, hm, isNew, summaryLine, FILTERS } from '../lib/fil.mjs'
import { archiveConfig } from '../lib/archive.mjs'

const STATE_TONE = { en_cours: 'ok', attend: 'julian', bloquee: 'bad', terminee: 'dim', repos: 'info' }

export function filLabels(cfg) {
  const L = ((cfg && cfg.fil) || {}).labels || {}
  return {
    states: { en_cours: 'en cours', attend: 'attend Julian', bloquee: 'bloquée', terminee: 'terminée', repos: 'au repos', ...(L.states || {}) },
    filters: { tout: 'Tout', attend: 'Attend Julian', bloquee: 'Bloquées', terminee_auj: "Terminées aujourd'hui", projet: 'Projet', ...(L.filters || {}) },
    ...Object.fromEntries(Object.entries(L).filter(([k]) => k !== 'states' && k !== 'filters')),
  }
}

// Labels of the night block (veille.config.json night.labels), shared by the Alertes tab and the wakes of the Fil.
export function nightLabels(cfg) {
  const L = ((cfg && cfg.night) || {}).labels || {}
  return { title: 'Bilan de la nuit', night_button: 'Nuit', day_button: 'Jour', night_on: 'Nuit active depuis {time}', wakes: 'Réveils de la Veille', ...L,
    wake_states: { en_cours: 'en cours', ok: 'conforme', ecart: 'écart', erreur: 'erreur', sans_resultat: 'sans résultat', ...(L.wake_states || {}) } }
}

const WAKE_TONE = { en_cours: 'info', ok: 'ok', ecart: 'bad', erreur: 'bad', sans_resultat: 'warn' }

// One line per wake (newest first) and its result: what the Fil shows of ~/.claude/veille/wakes.json.
export function wakeLines(wakes, cfg, max = 5) {
  const NL = nightLabels(cfg)
  return ((wakes && wakes.wakes) || []).slice(0, max).map((w) => ({
    head: `${hm(w.at)} · ${w.title || w.target_cli || ''} · ${[String((w.want || {}).model || '').replace(/^claude-/, ''), (w.want || {}).effort, (w.want || {}).permission].filter(Boolean).join(' · ')} · ${NL.wake_states[w.status] || w.status}`,
    tone: WAKE_TONE[w.status] || 'info',
    detail: [w.reason, (w.diffs || []).length ? (w.diffs || []).join(' ; ') : '', w.result].filter(Boolean).map((x) => String(x).replace(/\s+/g, ' ').slice(0, 300)),
  }))
}

export function drawWakes(el, cfg, wakes, T, col) {
  const lines = wakeLines(wakes, cfg)
  if (!lines.length) return null
  const colors = cfg.colors || {}
  return col([
    T(nightLabels(cfg).wakes, { bold: true }),
    ...lines.map((l) => col([T(l.head, { tone: l.tone }), ...l.detail.map((d) => T(d, { dim: true }))], { marginLeft: 2 })),
  ], { borderStyle: 'round', ...(colors.dim ? { borderColor: colors.dim } : {}), paddingX: 1, marginBottom: 1 })
}

const fillT = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? String(v[k]) : m))

// The text a terminal render shows (and the tests read): one line per project and per conversation.
export function filText(fil, cfg, ui = {}, read = null, nowMs = Date.now(), width = 75) {
  const L = filLabels(cfg)
  const out = []
  const cut = (s) => (s.length > width ? s.slice(0, width - 1) + '…' : s)
  if (!fil) return [L.missing || 'fil.json absent']
  out.push(cut(`${L.title || 'Fil'} · ${fil.total} conv · ${fillT(L.julian_counter || 'attend Julian : {n}', { n: fil.julian || 0 })} · ${hm(fil.generated)}`))
  const view = filterFil(fil, ui.filter || 'tout', ui.project || '', nowMs)
  for (const p of view.projects) {
    out.push('')
    out.push(cut(`▾ ${p.name} — ${summaryLine(p, { attend: L.states.attend })}`))
    for (const c of flatten(p.convs)) {
      const pad = '  '.repeat(c.depth + 1)
      out.push(cut(`${pad}● ${L.states[c.state] || c.state} · ${c.title} · ${[c.model, c.effort].filter(Boolean).join('·')} · ${hm(c.msg_at || c.last_at)}${isNew(c, read) ? ' · ' + (L.new || 'Nouveau') : ''}`))
      if (c.ask) out.push(cut(`${pad}  ? ${c.ask}`))
      if (c.preview) out.push(cut(`${pad}  ${c.preview}`))
    }
    if (p.hidden) out.push(`  ${fillT(L.more || '+ {n} autres', { n: p.hidden })}`)
  }
  if (!view.projects.length) out.push(L.none || 'Aucune conversation.')
  return out
}

// « À archiver (N) »: folded to its title; unfolded, one line per candidate (title, project, reason) and a button that
// copies every id. h.archive is ~/.claude/veille/archive.json; h.toggleArchive and h.copyIds are the pane's handlers.
export function archiveLines(arch, cfg) {
  const L = archiveConfig(cfg).labels
  if (!arch) return [L.missing || 'archive.json absent']
  const c = arch.candidates || []
  return [fillT(L.title || 'À archiver ({n})', { n: c.length }), ...c.map((x) => `${x.title} · ${x.project} · ${x.reason}`)]
}

function drawArchive(el, cfg, arch, open, h, T, row, col, btn) {
  const L = archiveConfig(cfg).labels
  const c = (arch && arch.candidates) || []
  const title = btn(`${open ? '▾' : '▸'} ${fillT(L.title || 'À archiver ({n})', { n: arch ? c.length : '?' })}`, h.toggleArchive, false, 'fil-archive')
  if (!open) return row([title], { alignItems: 'center', marginBottom: 1 })
  if (!arch) return col([title, T(L.missing || 'archive.json absent', { dim: true })], { marginBottom: 1 })
  return col([
    title,
    ...(c.length ? c.map((x) => T(`${x.title} · ${x.project} · ${x.reason}`, { dim: true })) : [T(L.none || 'Rien à archiver.', { dim: true })]),
    c.length ? row([btn(L.copy_ids || 'Copier la liste des ids', (press) => h.copyIds(c.map((x) => x.sid).join('\n'), c.length, press), true, 'fil-archive-copy')]) : null,
    T(L.note || '', { dim: true }),
  ], { marginLeft: 2, marginBottom: 1 })
}

// The « À archiver » tab of the Veille pane: the list always unfolded, « Copier la liste des ids », « Rafraîchir »
// (runs the watcher's archiver command, which rewrites archive.json), and the note on who archives (the VEILLE
// conversation, never the pane). h: { copyIds, refresh, msg, busy }.
export function drawArchiveTab(el, cfg, arch, h) {
  const colors = cfg.colors || {}
  const L = archiveConfig(cfg).labels
  const T = (text, o = {}) => el.Text({ children: [String(text ?? '')], wrap: 'wrap', ...(o.tone && colors[o.tone] ? { color: colors[o.tone] } : {}), ...(o.dim ? { dimColor: true } : {}), ...(o.bold ? { bold: true } : {}) })
  const row = (parts, o = {}) => el.Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, ...o, children: parts.filter(Boolean) })
  const col = (parts, o = {}) => el.Box({ flexDirection: 'column', ...o, children: parts.filter(Boolean) })
  const btn = (label, onPress, primary, key) => el.Button({ children: [label], variant: primary ? 'primary' : 'secondary', onPress, ...(key ? { key } : {}) })
  const c = (arch && arch.candidates) || []
  return col([
    row([
      T(fillT(L.title || 'À archiver ({n})', { n: arch ? c.length : '?' }), { bold: true }),
      arch && arch.generated ? T(`${hm(arch.generated)}${arch.open ? ` · ${arch.open} ouvertes` : ''}`, { dim: true }) : null,
    ]),
    ...(!arch ? [T(L.missing || 'archive.json absent', { tone: 'warn' })]
      : c.length ? c.map((x) => T(`${x.title} · ${x.project} · ${x.reason}`, { dim: true })) : [T(L.none || 'Rien à archiver.', { dim: true })]),
    row([
      c.length ? btn(L.copy_ids || 'Copier la liste des ids', (press) => h.copyIds(c.map((x) => x.sid).join('\n'), c.length, press), true, 'fil-archive-copy') : null,
      h.refresh ? btn(h.busy === 'archiver' ? '…' : L.refresh || 'Rafraîchir', h.refresh, false, 'archive-refresh') : null,
    ]),
    h.msg ? T(h.msg, { dim: true }) : null,
    T(L.note || '', { dim: true }),
  ])
}

export function drawFil(el, cfg, fil, ui, h) {
  const colors = cfg.colors || {}
  const L = filLabels(cfg)
  const T = (text, o = {}) => el.Text({ children: [String(text ?? '')], wrap: o.wrap || 'wrap', ...(o.tone && colors[o.tone] ? { color: colors[o.tone] } : {}), ...(o.dim ? { dimColor: true } : {}), ...(o.bold ? { bold: true } : {}) })
  const row = (parts, o = {}) => el.Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, ...o, children: parts.filter(Boolean) })
  const col = (parts, o = {}) => el.Box({ flexDirection: 'column', ...o, children: parts.filter(Boolean) })
  const btn = (label, onPress, primary, key) => el.Button({ children: [label], variant: primary ? 'primary' : 'secondary', onPress, ...(key ? { key } : {}) })
  const link = (href, label) => (href && el.Link ? el.Link({ href, children: [label] }) : null)
  const md = (text) => (el.Markdown ? el.Markdown({ children: [text] }) : T(text))

  // the pane passes its one « attend Julian » count (view.mjs julianCount = lib/core/veille.mjs attendJulian)
  const julian = h.julian !== undefined ? h.julian : (fil && fil.julian) || 0
  const head = col([
    row([
      T(L.title || 'Fil des conversations', { bold: true }),
      julian ? T(fillT(L.julian_counter || 'attend Julian : {n}', { n: julian }), { tone: 'julian', bold: true }) : null,
      fil ? T(fillT(L.generated || 'lu à {time} ({age})', { time: hm(fil.generated), age: h.ago(h.now - fil.generated) }), { dim: true }) : null,
    ]),
    row([
      ...FILTERS.map((f) => btn(L.filters[f] || f, () => h.filter(f), (ui.filter || 'tout') === f, `fil-filter-${f}`)),
    ]),
    ui.filter === 'projet' && fil ? row(fil.projects.map((p) => btn(p.name, () => h.project(p.name), ui.project === p.name))) : null,
    row([btn(h.busy === 'fil' ? L.refreshing || 'Lecture…' : L.refresh || 'Rafraîchir', h.refresh), btn(L.mark_all || 'Tout marquer lu', h.markAll)]),
    h.msg ? T(h.msg, { dim: true }) : null,
  ], { marginBottom: 1 })
  const archive = h.toggleArchive ? drawArchive(el, cfg, h.archive, !!ui.archiveOpen, h, T, row, col, btn) : null
  const wakes = drawWakes(el, cfg, h.wakes, T, col)
  if (!fil) return col([head, wakes, archive, T(L.missing || 'fil.json absent', { tone: 'warn' })])

  const view = filterFil(fil, ui.filter || 'tout', ui.project || '', h.now)
  const projOpen = (p) => (ui.openProj && p.name in ui.openProj ? ui.openProj[p.name] : (p.counts.attend || p.counts.en_cours || p.counts.bloquee) > 0)

  const conv = (c) => {
    const open = !!(ui.openConv || {})[c.sid]
    const fresh = isNew(c, h.read)
    const line = row([
      btn(`${open ? '▾' : '▸'} ${c.title}`, () => h.toggleConv(c.sid), false, `fil-conv-${c.sid}`),
      T(`● ${L.states[c.state] || c.state}`, { tone: STATE_TONE[c.state], bold: c.state === 'attend' }),
      T([c.model.replace(/^claude-/, ''), c.effort].filter(Boolean).join(' · '), { dim: true }),
      T(hm(c.msg_at || c.last_at), { dim: true }),
      fresh ? T(L.new || 'Nouveau', { tone: 'warn', bold: true }) : null,
      c.archived ? T('archivée', { dim: true }) : null,
      c.parent_title ? T(fillT(L.under || 'sous {title}', { title: c.parent_title }), { dim: true }) : null,
    ], { alignItems: 'center' })
    const ask = c.ask ? T(`? ${c.ask}`, { tone: 'julian' }) : null
    const preview = c.preview ? T(c.preview, { dim: !!c.dim || !fresh }) : T(L.empty_message || '(pas de message)', { dim: true })
    if (!open) return col([line, ask, preview], { marginLeft: 2 * c.depth, marginBottom: 1 })
    return col([
      line, ask,
      c.recap ? col([T(L.recap || 'Récap (wrap_up)', { bold: true }), T(c.recap)]) : null,
      c.actions.length ? T(`${L.buttons || 'Boutons proposés'} : ${c.actions.join(' | ')}`, { dim: true }) : null,
      T(L.message || 'Dernier message', { bold: true }),
      c.text ? md(c.text) : T(L.empty_message || '(pas de message)', { dim: true }),
      c.prs.length ? row([T(`${L.prs || 'PR/MR'} :`, { dim: true }), ...c.prs.map((p) => link(p.url, `${p.url.replace(/^https?:\/\/[^/]+\//, '')}${p.state ? ' (' + p.state + ')' : ''}`))]) : null,
      // A pane's Link only opens https: (the engine draws a claude:// href as plain text), so the button hands the
      // claude:// link to the OS, whose handler is the desktop app (it routes claude://claude.ai/epitaxy/...).
      row([btn(L.open || 'Ouvrir la conversation', () => h.openConv(c.link), true, `fil-open-${c.sid}`), btn(L.copy_id || "Copier l'id", (press) => h.copy(c.sid, press), false, `fil-copy-${c.sid}`), T(c.sid, { dim: true })], { alignItems: 'center' }),
      T(L.open_note || 'ouverture par le lien claude:// de l’app : non vérifiée', { dim: true }),
    ], { marginLeft: 2 * c.depth, marginBottom: 1, borderStyle: 'round', ...(colors.dim ? { borderColor: colors.dim } : {}), paddingX: 1 })
  }

  const projects = view.projects.map((p) => {
    const open = projOpen(p)
    return col([
      row([btn(`${open ? '▾' : '▸'} ${p.name}`, () => h.toggleProj(p.name, !open), false, `fil-proj-${p.name}`), T(summaryLine(p, { attend: L.states.attend }), { dim: !p.counts.attend, tone: p.counts.attend ? 'julian' : undefined })], { alignItems: 'center' }),
      open ? col([...flatten(p.convs).map(conv), p.hidden ? T(fillT(L.more || '+ {n} autres', { n: p.hidden }), { dim: true }) : null], { marginLeft: 2, marginTop: 1 }) : null,
    ], { marginBottom: 1 })
  })
  return col([head, wakes, archive, ...(projects.length ? projects : [T(L.none || 'Aucune conversation.', { dim: true })])])
}
