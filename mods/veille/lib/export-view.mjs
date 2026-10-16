// veille - the « Export eta » tab: export-eta's batch export seen from the Veille pane. Pure (no $, no I/O), tested
// with node --test. Inputs: ~/.claude/export-eta/pending.json and state.json, written by export-eta's exporter
// (exporter/export.mjs); the tab only reads them. Its buttons run that same exporter (EXPORT_RUN, the argv the
// watcher's alert carries too), so there is one code path and nothing is pushed beyond what export-eta itself does.

// The exporter, relative to the folder holding the mods (or the watcher's bin copy).
export const EXPORT_SCRIPT = 'export-eta/exporter/export.mjs'
// What « Exporter vers eta » runs: the batch export, the same argv as the watcher's alert button.
export const EXPORT_RUN = [EXPORT_SCRIPT, 'run', '--mode', 'batch']
// What « Rafraîchir » runs: recompute pending.json (no export, no git).
export const EXPORT_PENDING = [EXPORT_SCRIPT, 'pending']

const fill = (t, v = {}) => String(t ?? '').replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined || v[k] === null ? m : String(v[k])))

export const EXPORT_LABELS = {
  tab: 'Export eta',
  title: 'Export eta · lot terminé',
  ready_reason_lead: 'un lead et toutes ses sous-conversations sont terminés',
  ready_reason_count: 'seuil {min} atteint',
  none: 'Aucun lot prêt ({n} terminée(s) depuis le dernier export, seuil {min}).',
  missing: 'pending.json absent : export-eta n’a pas encore tourné (« Rafraîchir » le calcule).',
  export: 'Exporter vers eta',
  refresh: 'Rafraîchir',
  details: 'Ouvrir Export eta',
  auto: 'auto : la veille l’exporte sans clic',
  history: 'Derniers exports',
  no_history: 'aucun export',
  merged: 'mergée',
  not_merged: 'pas mergée',
  held: 'retenues : {list}',
  note: 'Le bouton lance l’exporteur d’export-eta (masquage, worktree neuf du dépôt eta, PR, merge squash) ; la Veille ne pousse rien d’autre.',
}

function when(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * The tab's view model. pending/state: export-eta's files (null when absent). cfg: veille's merged config
 * (cfg.export.labels overrides EXPORT_LABELS, cfg.export.batch_min the threshold shown when pending.json has none).
 */
export function exportView(pending, state, cfg = {}) {
  const X = (cfg && cfg.export) || {}
  const L = { ...EXPORT_LABELS, ...(X.labels || {}) }
  const min = (pending && pending.min) ?? X.batch_min ?? 3
  const history = ((state && state.history) || []).slice(0, X.history || 3).map((h) => ({
    when: when(h.at), mode: h.mode || '', count: h.count || 0, url: h.url || '', pr: h.pr ? `#${h.pr}` : '', merged: !!h.merged,
    held: (h.held || []).map((x) => x.title || x.cli).filter(Boolean), error: h.error || '', dry: !!h.dry,
    tone: h.error && !h.merged ? 'bad' : h.held && h.held.length ? 'warn' : 'ok',
  }))
  if (!pending) return { L, available: false, ready: false, count: 0, text: '', reason: '', titles: [], none: L.missing, auto: false, history }
  const ready = !!pending.ready && (pending.ids || []).length > 0
  return {
    L, available: true, ready, count: pending.count || 0, auto: !!pending.auto,
    text: ready ? pending.text || `${pending.count} conversations terminées — ${L.export}` : '',
    reason: !ready ? '' : pending.reason === 'lead' ? L.ready_reason_lead : pending.reason === 'count' ? fill(L.ready_reason_count, { min }) : '',
    titles: ready ? (pending.titles || []).map((t) => `${t.project || '?'} · ${t.title || String(t.cli || '').slice(0, 8)}`) : [],
    none: fill(L.none, { n: pending.count || 0, min }),
    history,
  }
}

/** The tab's label: « Export eta (4) » while a batch is ready. */
export function exportTabLabel(vm) {
  return vm && vm.ready ? `${vm.L.tab} (${vm.count})` : (vm && vm.L.tab) || EXPORT_LABELS.tab
}
