// metrics mod - the « Les règles marchent ? » pane's drawing, pure: no `$`. `el` is the element table from
// $.ui.resolve(e), `M` the facts the hook read, `act` the callbacks it hands in. register.tsx draws /regles with it, and
// the registres mod draws its « Règles » tab with a byte-for-byte copy (lib/core/targets.json): change it here only.
import { duration, fill, fmtMetric, fmtNum, latest, markerLegend, markerLine, metricRows, pickVersion, spark, when } from './view.mjs'

/** h-like factory over the element table: mk(el)('Text', { dimColor: true }, 'x'). */
export const mk = (el) => (type, props, ...kids) =>
  el[type]({ ...(props || {}), children: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) })

/** M = { cfg, model, want, busy, error }; act = { setVersion(v), rescan() }. Returns the pane's tree. */
export function drawRegles(el, M, act) {
  const h = mk(el)
  const { cfg, model, want } = M
  const l = cfg.labels ?? {}
  const status = M.busy ? 'calcul en cours…' : ''
  if (!model) {
    return h('Box', { flexDirection: 'column', gap: 1 },
      h('Text', {}, fill(l.first_scan, { days: cfg.history_days ?? 30 })),
      M.error ? h('Text', { color: 'error' }, `scan : ${M.error}`) : null,
      status ? h('Text', { dimColor: true }, status) : null)
  }
  const tz = model.tzMin ?? 0
  const vs = (model.versions ?? []).slice(-(cfg.max_versions ?? 12))
  const i = pickVersion(vs, want)
  const cur = vs[i]
  const prev = i > 0 ? vs[i - 1] : undefined
  const metrics = (cfg.metrics ?? []).filter((m) => m.show !== false)
  const W = Math.max(...metrics.map((m) => (m.label || m.id).length), 10) + 2
  const n = (model.days ?? []).length
  const meta = model.meta ?? {}
  const verdictColor = (v) => (v === 'better' ? 'success' : v === 'worse' ? 'error' : undefined)
  const rows = cur ? metricRows(cfg, prev, cur) : []
  const shortH = l.short_hours ?? 12
  const summary = (cfg.summary_metrics ?? []).map((id) => metrics.find((m) => m.id === id)).filter(Boolean)
  const cell = (s, w = 11) => s.padStart(w)

  return h('Box', { flexDirection: 'column', gap: 1 },
    h('Box', { flexDirection: 'column' },
      h('Text', { dimColor: true }, fill(l.subtitle, { repos: meta.repos ?? 0, github: meta.github ?? 0, gitlab: meta.gitlab ?? 0, days: n, forge_at: when(meta.forge_at, tz) }) + (status ? ` · ${status}` : '')),
      M.error ? h('Text', { color: 'error' }, `scan : ${M.error}`) : null,
      (meta.errors ?? []).slice(0, 4).map((x) => h('Text', { color: 'warning' }, x))),

    h('Box', { flexDirection: 'column' },
      h('Text', { bold: true }, l.versions),
      h('Box', { flexDirection: 'row', gap: 1, flexWrap: 'wrap' },
        vs.map((v, k) => h('Button', { key: `v-${v.version}`, ...(k !== i ? { plain: true } : {}), onPress: () => act.setVersion(v.version) }, v.version)),
        h('Button', { key: 'refresh', plain: true, onPress: () => act.rescan() }, '↻')),
      cur ? h('Text', { dimColor: true }, `${cur.version} · ${when(cur.start, tz)} · ${cur.sha} ${cur.subject}`) : h('Text', { dimColor: true }, 'aucune version trouvée (rules.repo dans la config)')),

    h('Box', { flexDirection: 'column' },
      h('Text', { bold: true }, `${l.curves} (${model.days?.[0] ?? ''} → ${model.days?.[n - 1] ?? ''})`),
      metrics.map((m) => h('Text', {}, `${(m.label || m.id).padEnd(W)}${spark(model.series?.[m.id], cfg.spark, cfg.spark_gap)}  ${fmtMetric(m, latest(model.series?.[m.id]))}${m.target === undefined ? '' : ` · ${l.col_target} ${fmtMetric(m, m.target)}`}`)),
      h('Text', { color: 'claude' }, `${''.padEnd(W)}${markerLine(n, model.markers, cfg.marker)}`),
      h('Text', { dimColor: true }, `${''.padEnd(W)}${cfg.marker ?? '│'} ${markerLegend(model.markers, model.days)}`)),

    cur
      ? h('Box', { flexDirection: 'column' },
        h('Text', { bold: true }, `${fill(l.before_after, { version: cur.version })} : ${prev ? `${prev.version} (${duration(prev.hours)})` : '—'} → ${cur.version} (${duration(cur.hours)})`),
        (prev && prev.hours < shortH) || cur.hours < shortH ? h('Text', { color: 'warning' }, fill(l.short, { h: shortH })) : null,
        h('Text', { dimColor: true }, `${(l.col_metric ?? '').padEnd(W)}${cell(prev ? prev.version : 'avant')}${cell(cur.version)}     ${l.col_target ?? ''}`),
        rows.map((r) => h('Text', verdictColor(r.verdict) ? { color: verdictColor(r.verdict) } : {}, `${r.label.padEnd(W)}${cell(r.before)}${cell(r.after)}  ${r.arrow.padEnd(2)} ${r.target}`)))
      : null,

    h('Box', { flexDirection: 'column' },
      h('Text', { bold: true }, l.all_versions),
      h('Text', { dimColor: true }, `${'Version'.padEnd(8)}${cell(l.col_days ?? 'jours', 7)}${summary.map((m) => cell(String(m.short || m.id), 12)).join('')}`),
      vs.map((v) => h('Text', v === cur ? { bold: true } : {}, `${v.version.padEnd(8)}${cell(fmtNum(v.hours / 24, 1), 7)}${summary.map((m) => cell(fmtMetric(m, v.values?.[m.id]), 12)).join('')}`))),

    h('Box', { flexDirection: 'column' },
      (l.notes ?? []).map((x) => h('Text', { dimColor: true }, `· ${fill(x, { gap: cfg.stall?.min_gap_min ?? 60 })}`))))
}
