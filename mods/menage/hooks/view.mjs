// menage mod - the pane's drawing, pure: no `$`. `el` is the element table from $.ui.resolve(e) (Box, Text, Button),
// `M` the facts the hook read, `act` the callbacks it hands in. register.tsx draws the « Ménage » pane with it, and the
// registres mod draws its « Ménage » tab with a byte-for-byte copy (lib/core/targets.json): change it here only.
import { commandsOf, fill, filterRows, fmtAge, fmtBytes } from '../lib/classify.mjs'

/** h-like factory over the element table: mk(el)('Text', { dimColor: true }, 'x'). */
export const mk = (el) => (type, props, ...kids) =>
  el[type]({ ...(props || {}), children: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) })

/**
 * M = { cfg, model, now, filter, copied, busy, error }; act = { setFilter(id), rescan(), copy(press, lines) }.
 * Returns the pane's tree.
 */
export function drawMenage(el, M, act) {
  const h = mk(el)
  const { cfg, model, now, filter, copied } = M
  const L = cfg.labels ?? {}
  const C = cfg.colors ?? {}
  const status = M.busy ? 'inventaire en cours…' : ''
  if (!model) {
    return h('Box', { flexDirection: 'column', gap: 1 },
      h('Text', {}, L.first_scan),
      M.error ? h('Text', { color: 'error' }, `scan : ${M.error}`) : null,
      status ? h('Text', { dimColor: true }, status) : null)
  }
  const t = model.totals ?? {}
  const max = cfg.max_rows ?? 40
  const color = (level) => (level === 'safe' ? C.safe : level === 'check' ? C.check : level === 'danger' ? C.danger : undefined)
  const filters = [['all', L.filter_all], ['safe', L.filter_safe], ['danger', L.filter_danger]]
  const tag = (r) => (r.level === 'danger' ? `${L.danger_tag} · ` : r.level === 'check' ? `${L.check_tag} · ` : '')

  return h('Box', { flexDirection: 'column', gap: 1 },
    h('Box', { flexDirection: 'column' },
      h('Text', { dimColor: true }, fill(L.subtitle, { repos: model.repos ?? 0, age: fmtAge(model.generated, now) }) + (status ? ` · ${status}` : '')),
      M.error ? h('Text', { color: 'error' }, `scan : ${M.error}`) : null,
      (model.errors ?? []).slice(0, 5).map((x) => h('Text', { color: 'warning' }, x))),

    h('Box', { flexDirection: 'column' },
      h('Text', { bold: true, color: C.safe }, fill(L.total_sure, { bytes: fmtBytes(t.sure ?? 0) })),
      h('Text', { color: C.check }, fill(L.total_check, { bytes: fmtBytes(t.check ?? 0) })),
      t.danger ? h('Text', { color: C.danger }, fill(L.total_danger, { n: t.danger })) : null),

    h('Box', { flexDirection: 'row', gap: 1, flexWrap: 'wrap' },
      filters.map(([id, label]) => h('Button', { key: `f-${id}`, ...(id !== filter ? { plain: true } : {}), onPress: () => act.setFilter(id) }, label)),
      h('Button', { key: 'refresh', plain: true, onPress: () => act.rescan() }, L.refresh ?? '↻'),
      h('Button', { key: 'copy-all', plain: true, onPress: (press) => act.copy(press, commandsOf(model.sections ?? [])) }, L.copy_all)),
    copied ? h('Text', { dimColor: true }, copied) : null,

    (model.sections ?? []).map((s) => {
      const rows = filterRows(s.rows ?? [], filter)
      if (!rows.length && filter !== 'all') return null
      const sure = (s.rows ?? []).filter((r) => r.level === 'safe').reduce((a, r) => a + (r.reclaim || 0), 0)
      const safeCmds = commandsOf([s])
      return h('Box', { key: `s-${s.id}`, flexDirection: 'column' },
        h('Box', { flexDirection: 'row', gap: 1, flexWrap: 'wrap' },
          h('Text', { bold: true }, `${s.title} (${(s.rows ?? []).length})${sure ? ` · ${fmtBytes(sure)}` : ''}`),
          safeCmds.length ? h('Button', { key: `copy-${s.id}`, plain: true, onPress: (press) => act.copy(press, safeCmds) }, `${L.copy} (${safeCmds.length})`) : null),
        s.summary ? h('Text', { dimColor: true }, s.summary) : null,
        !rows.length ? h('Text', { dimColor: true }, L.empty) : null,
        rows.slice(0, max).map((r, i) => h('Box', { key: `r-${s.id}-${i}`, flexDirection: 'column', paddingLeft: 1 },
          h('Text', { ...(color(r.level) ? { color: color(r.level) } : {}), ...(r.level === 'danger' ? { bold: true } : {}) }, `● ${r.title}${r.meta ? ` · ${r.meta}` : ''}`),
          r.reasons?.length || r.level === 'danger' || r.level === 'check'
            ? h('Text', r.level === 'danger' ? { color: C.danger } : { dimColor: true }, `  ${tag(r)}${(r.reasons ?? []).join(' · ')}`)
            : null,
          r.command
            ? h('Box', { flexDirection: 'row', gap: 1 },
              h('Button', { key: `c-${s.id}-${i}`, plain: true, onPress: (press) => act.copy(press, [r.command]) }, L.copy),
              h('Text', { dimColor: true, wrap: 'wrap' }, r.command))
            : null)),
        rows.length > max ? h('Text', { dimColor: true }, fill(L.more, { n: rows.length - max })) : null)
    }),

    h('Box', { flexDirection: 'column' },
      (L.notes ?? []).map((x) => h('Text', { dimColor: true }, `· ${fill(x, { base: 'origin/main' })}`))))
}
