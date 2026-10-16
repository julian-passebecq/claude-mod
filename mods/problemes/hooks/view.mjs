// problemes mod - the « Problèmes » pane's drawing, pure: no `$`. `el` is the element table from $.ui.resolve(e),
// `M` the facts the hook read, `act` the callbacks it hands in. register.tsx draws /problemes with it, and the registres
// mod draws its « Problèmes » tab with a byte-for-byte copy (lib/core/targets.json): change it here only.
import { applyFilters, appsOf, fill, fmtAge, fmtDate, linksOf, summaryOf, totals, tree } from '../lib/core.mjs'

/** h-like factory over the element table: mk(el)('Text', { dimColor: true }, 'x'). */
export const mk = (el) => (type, props, ...kids) =>
  el[type]({ ...(props || {}), children: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) })

/**
 * M = { cfg, snap, now, f: { status, week, category, app }, open: string[], noteMsg, busy, error, exporting, exportMsg };
 * act = { flip(nodeId), setFilter(name, value), refresh(), exportEta(), note(id, text) }. Returns the pane's tree.
 */
export function drawProblemes(el, M, act) {
  const h = mk(el)
  const { cfg, snap, now, f, noteMsg } = M
  const L = cfg.labels ?? {}
  const C = cfg.colors ?? {}
  const status = M.busy ? L.collecting : ''
  if (!snap) {
    return h('Box', { flexDirection: 'column', gap: 1 },
      h('Text', {}, fill(L.first, { days: cfg.collect?.backfill_days ?? 14 })),
      M.error ? h('Text', { color: 'error' }, `collecte : ${M.error}`) : null,
      status ? h('Text', { dimColor: true }, status) : null)
  }
  const open = new Set(M.open ?? [])
  const all = snap.problems ?? []
  const t = totals(all, now)
  const shown = applyFilters(all, f, now)
  const nodes = tree(shown, cfg.categories ?? [], L)
  const max = cfg.max_problems_per_node ?? 40
  const chip = (key, label, active, press) => h('Button', { key, ...(active ? {} : { plain: true }), onPress: press }, label)
  const statusColor = (s) => C[s]
  const stats = snap.stats

  const problemRow = (p, depth, scope) => {
    const pid = `p:${p.id}`
    const isOpen = open.has(pid)
    const line = fill(L.problem, { id: p.id, title: p.title, count: p.count, status: p.status })
    const rows = [
      h('Box', { key: `${scope}-${p.id}`, flexDirection: 'row', gap: 1, paddingLeft: depth },
        h('Text', statusColor(p.status) ? { color: statusColor(p.status) } : {}, '●'),
        h('Button', { key: `${scope}-${p.id}`, plain: true, onPress: () => act.flip(pid) }, `${isOpen ? '▾' : '▸'} ${line}`)),
    ]
    if (!isOpen) return rows
    const field = (label, v) => h('Text', { wrap: 'wrap' }, h('Text', { bold: true }, `${label} : `), v || L.unknown)
    const links = [...new Set((p.evidence ?? []).flatMap((ev) => linksOf(ev.text)).concat(linksOf(p.fix), linksOf(p.symptom)))].slice(0, 5)
    rows.push(
      h('Box', { key: `${scope}-${p.id}-d`, flexDirection: 'column', paddingLeft: depth + 2 },
        field(L.symptom, p.symptom),
        field(L.cause, p.cause),
        field(L.fix, p.fix),
        h('Text', { dimColor: true, wrap: 'wrap' }, `${L.seen} : ${fill(L.seen_line, { first: fmtDate(p.first_seen), last: fmtDate(p.last_seen), count: p.count, source: p.source })}${p.apps?.length ? ` · ${p.apps.join(', ')}` : ''}`),
        (p.evidence ?? []).length ? h('Text', { bold: true }, L.evidence) : null,
        (p.evidence ?? []).slice(-5).reverse().map((ev, i) => h('Text', { key: `${scope}-${p.id}-ev${i}`, dimColor: true, wrap: 'wrap' },
          `· ${fmtDate(ev.at)}${ev.session ? ` · session ${String(ev.session).slice(0, 8)}` : ''}${ev.title ? ` · ${ev.title}` : ''}${ev.file && !ev.session ? ` · ${String(ev.file).split('/').pop()}` : ''}${ev.text ? ` · ${ev.text}` : ''}`)),
        links.map((u, i) => h('Link', { key: `${scope}-${p.id}-l${i}`, href: u, label: u })),
        (p.timeline ?? []).length ? h('Text', { bold: true }, L.timeline) : null,
        (p.timeline ?? []).length ? h('Text', { dimColor: true, wrap: 'wrap' }, (p.timeline ?? []).slice(-12).map((x) => `${fmtDate(x.at)} ×${x.n}`).join(' · ')) : null,
        (p.notes ?? []).length ? h('Text', { bold: true }, L.notes) : null,
        (p.notes ?? []).map((n, i) => h('Text', { key: `${scope}-${p.id}-n${i}`, wrap: 'wrap' }, `· ${fmtDate(n.at)} · ${n.text}`)),
        h('Input', { key: `note-${p.id}`, label: `${L.note_label} : `, placeholder: L.note_placeholder, submitLabel: L.note_submit, onSubmit: (v) => void act.note(p.id, v) })),
    )
    return rows
  }

  const nodeRows = (n, depth) => {
    const id = `c:${n.id}`
    const isOpen = open.has(id)
    const rows = [
      h('Box', { key: `n-${n.id}`, flexDirection: 'column', paddingLeft: depth },
        h('Box', { flexDirection: 'row', gap: 1 },
          h('Text', n.open ? { color: C['ouvert'] } : { dimColor: true }, n.open ? '●' : '○'),
          h('Button', { key: `cat-${n.id}`, plain: true, onPress: () => act.flip(id) }, `${isOpen ? '▾' : '▸'} ${fill(L.node, { label: n.label, open: n.open, total: n.total })}`)),
        !isOpen ? h('Text', { dimColor: true, wrap: 'truncate' }, `  ${summaryOf(n, 2, L.empty)}`) : null,
        isOpen && n.cross ? h('Text', { dimColor: true }, `  ${L.cross}`) : null),
    ]
    if (!isOpen) return rows
    for (const ch of n.children ?? []) rows.push(...nodeRows(ch, depth + 2))
    for (const p of (n.problems ?? []).slice(0, max)) rows.push(...problemRow(p, depth + 2, n.id))
    if ((n.problems ?? []).length > max) rows.push(h('Text', { key: `more-${n.id}`, dimColor: true }, `${' '.repeat(depth + 2)}${fill(L.more, { n: n.problems.length - max })}`))
    return rows
  }

  const statuses = Object.entries(L.status_names ?? {})
  const weeks = Object.entries(L.week_names ?? {})
  const tops = (cfg.categories ?? []).filter((c) => !c.dynamic)
  const apps = appsOf(all).slice(0, L.apps_max ?? 12)

  return h('Box', { flexDirection: 'column', gap: 1 },
    h('Box', { flexDirection: 'column' },
      h('Text', { bold: true }, fill(L.top, t)),
      h('Text', { dimColor: true, wrap: 'wrap' }, fill(L.subtitle, { age: fmtAge(snap.collected, now), occ: t.week_seen }) + (status ? ` · ${status}` : '')),
      M.error ? h('Text', { color: 'error' }, `collecte : ${M.error}`) : null,
      stats ? h('Text', { dimColor: true, wrap: 'wrap' }, fill(L.collect_stats, stats)) : null),

    h('Box', { flexDirection: 'column' },
      h('Box', { flexDirection: 'row', gap: 1, flexWrap: 'wrap' },
        h('Text', { dimColor: true }, `${L.f_status} :`),
        chip('f-status-all', L.all, f.status === 'all', () => act.setFilter('status', 'all')),
        statuses.map(([k, label]) => chip(`f-status-${k}`, label, f.status === k, () => act.setFilter('status', k))),
        h('Button', { key: 'refresh', plain: true, onPress: () => act.refresh() }, L.refresh ?? '↻'),
        h('Button', { key: 'export-eta', plain: true, onPress: () => act.exportEta() }, M.exporting ? (L.exporting ?? 'export en cours…') : (L.export_eta ?? 'Exporter vers eta'))),
      h('Box', { flexDirection: 'row', gap: 1, flexWrap: 'wrap' },
        h('Text', { dimColor: true }, `${L.f_week} :`),
        weeks.map(([k, label]) => chip(`f-week-${k}`, label, f.week === k, () => act.setFilter('week', k)))),
      h('Box', { flexDirection: 'row', gap: 1, flexWrap: 'wrap' },
        h('Text', { dimColor: true }, `${L.f_category} :`),
        chip('f-cat-all', L.all, f.category === 'all', () => act.setFilter('category', 'all')),
        tops.map((c) => chip(`f-cat-${c.id}`, c.label, f.category === c.id, () => act.setFilter('category', c.id)))),
      apps.length
        ? h('Box', { flexDirection: 'row', gap: 1, flexWrap: 'wrap' },
          h('Text', { dimColor: true }, `${L.f_app} :`),
          chip('f-app-all', L.all, f.app === 'all', () => act.setFilter('app', 'all')),
          apps.map(([a, n]) => chip(`f-app-${a}`, `${a} (${n})`, f.app === a, () => act.setFilter('app', a))))
        : null),
    noteMsg ? h('Text', { dimColor: true }, noteMsg) : null,
    M.exportMsg ? h('Text', { dimColor: true, wrap: 'wrap' }, `${L.export_eta ?? 'Exporter vers eta'} : ${M.exportMsg}`) : null,

    !all.length ? h('Text', { dimColor: true }, L.empty_ledger) : null,
    h('Box', { flexDirection: 'column' }, nodes.flatMap((n) => nodeRows(n, 0))),

    h('Box', { flexDirection: 'column' },
      (L.notes_doc ?? []).map((x, i) => h('Text', { key: `doc-${i}`, dimColor: true, wrap: 'wrap' }, `· ${x}`))))
}
