// scenarios mod, « Claude vs GPT » tab: pure helpers over versus.json (Anthropic and OpenAI models, accuracy vs cost).
// No `$`, so node tests import it directly. A number is shown only with its source URL and date; anything else reads
// « non confirmé » and is never drawn as a point. Nothing here fetches or computes a score: it only reads the file.

export type Vendor = 'anthropic' | 'openai'
export type VsModel = { id: string; vendor: Vendor; label: string; released?: string; released_url?: string }
export type VsSource = { source_url?: string; source_date?: string; date_kind?: 'published' | 'accessed'; note?: string }
export type VsPrice = VsSource & { model: string; in?: number | null; out?: number | null }
export type VsScore = VsSource & { model: string; bench: string; value?: number | null; effort?: string; reported_by?: string }
export type VsBench = { id: string; label: string; unit?: string; about?: string; url?: string }
export type VsLabels = Partial<Record<'tab_scenarios' | 'tab_versus' | 'unconfirmed' | 'cost' | 'score' | 'price' | 'source' | 'per_point', string>>
export type VsFile = {
  schema?: number
  checked?: string
  blend?: { in?: number; out?: number }
  benchmarks?: VsBench[]
  models?: VsModel[]
  prices?: VsPrice[]
  scores?: VsScore[]
  labels?: VsLabels
}

export const VS_LABELS: Required<VsLabels> = {
  tab_scenarios: 'Scénarios',
  tab_versus: 'Claude vs GPT',
  unconfirmed: 'non confirmé',
  cost: '$/M tok (mélange)',
  score: 'score',
  price: 'prix in/out $/M',
  source: 'source',
  per_point: '$/M par point',
}
export const vsLabels = (f: VsFile | undefined): Required<VsLabels> => ({ ...VS_LABELS, ...(f?.labels ?? {}) })

const DATE = /^\d{4}-\d{2}-\d{2}$/
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
/** A source counts only with an https URL and an ISO date. */
export const sourced = (s: VsSource | undefined): boolean =>
  !!s && typeof s.source_url === 'string' && /^https:\/\//.test(s.source_url) && typeof s.source_date === 'string' && DATE.test(s.source_date)
export const scoreConfirmed = (s: VsScore | undefined): boolean => !!s && num(s.value) && sourced(s)
export const priceConfirmed = (p: VsPrice | undefined): boolean => !!p && num(p.in) && num(p.out) && sourced(p)

/** Problems that make a row unusable (shown in the pane, the row is then treated as unconfirmed). */
export const checkVersus = (f: VsFile | undefined): string[] => {
  if (!f) return ['versus.json: absent ou illisible']
  const out: string[] = []
  const ids = new Set((f.models ?? []).map(m => m.id))
  const benches = new Set((f.benchmarks ?? []).map(b => b.id))
  for (const m of f.models ?? []) if (m.vendor !== 'anthropic' && m.vendor !== 'openai') out.push(`model ${m.id}: vendor "${m.vendor}" is neither anthropic nor openai`)
  for (const p of f.prices ?? []) {
    if (!ids.has(p.model)) out.push(`price: unknown model "${p.model}"`)
    if ((num(p.in) || num(p.out)) && !sourced(p)) out.push(`price ${p.model}: a number without an https source and a YYYY-MM-DD date`)
  }
  for (const s of f.scores ?? []) {
    if (!ids.has(s.model)) out.push(`score: unknown model "${s.model}"`)
    if (!benches.has(s.bench)) out.push(`score ${s.model}: unknown benchmark "${s.bench}"`)
    if (num(s.value) && !sourced(s)) out.push(`score ${s.model} ${s.bench}: a number without an https source and a YYYY-MM-DD date`)
    if (num(s.value) && (s.value < 0 || s.value > 100)) out.push(`score ${s.model} ${s.bench}: ${s.value} is not a percentage`)
  }
  return out
}

/** Blended $ per million tokens with the file's weights (3 input : 1 output when absent). */
export const blended = (p: VsPrice | undefined, blend?: VsFile['blend']): number | null => {
  if (!priceConfirmed(p)) return null
  const wi = num(blend?.in) && blend!.in! >= 0 ? blend!.in! : 3
  const wo = num(blend?.out) && blend!.out! >= 0 ? blend!.out! : 1
  if (wi + wo <= 0) return null
  return Math.round(((p!.in! * wi + p!.out! * wo) / (wi + wo)) * 100) / 100
}

export type VsRow = {
  model: VsModel
  score: VsScore | undefined
  confirmed: boolean
  price: VsPrice | undefined
  cost: number | null
}

/** One row per (model, score source) on that benchmark, plus one « non confirmé » row for a model without any score.
 *  Sorted: confirmed first, by score descending; then unconfirmed by label. */
export const rowsFor = (f: VsFile | undefined, bench: string): VsRow[] => {
  if (!f) return []
  const out: VsRow[] = []
  for (const m of f.models ?? []) {
    const price = (f.prices ?? []).find(p => p.model === m.id)
    const cost = blended(price, f.blend)
    const scores = (f.scores ?? []).filter(s => s.model === m.id && s.bench === bench)
    if (!scores.length) out.push({ model: m, score: undefined, confirmed: false, price, cost })
    for (const s of scores) out.push({ model: m, score: s, confirmed: scoreConfirmed(s), price, cost })
  }
  return out.sort((a, b) =>
    a.confirmed !== b.confirmed ? (a.confirmed ? -1 : 1)
      : a.confirmed ? (b.score!.value! - a.score!.value!) || a.model.label.localeCompare(b.model.label)
      : a.model.label.localeCompare(b.model.label))
}

export const fmtCost = (x: number | null): string => (x == null ? '?' : x < 1 ? x.toFixed(2) : x.toFixed(x < 10 ? 1 : 0))

/** One line for a row, e.g. « Claude Opus 5.5 · 66.4 % (xhigh, Anthropic) · 8.0 $/M · 2026-09-22 ». */
export const rowLine = (L: Required<VsLabels>, r: VsRow): string => {
  const who = r.model.vendor === 'anthropic' ? 'Claude' : 'GPT'
  const score = r.confirmed
    ? `${r.score!.value} %${r.score!.effort || r.score!.reported_by ? ` (${[r.score!.effort, r.score!.reported_by].filter(Boolean).join(', ')})` : ''}`
    : `${L.unconfirmed}${r.score?.reported_by ? ` (${r.score.reported_by})` : ''}`
  const cost = r.cost != null ? `${fmtCost(r.cost)} $/M` : `prix ${L.unconfirmed}`
  const date = r.confirmed ? ` · ${r.score!.source_date}${r.score!.date_kind === 'accessed' ? ' (lu)' : ''}` : ''
  return `${r.model.label.startsWith(who) ? '' : `${who} · `}${r.model.label} · ${score} · ${cost}${date}`
}

/** The text answer of /scenarios vs [bench]. */
export const versusText = (f: VsFile | undefined, bench?: string): string => {
  if (!f) return 'scenarios vs: versus.json absent ou illisible'
  const L = vsLabels(f)
  const b = (f.benchmarks ?? []).find(x => x.id === bench) ?? (f.benchmarks ?? [])[0]
  if (!b) return 'scenarios vs: aucun benchmark dans versus.json'
  const rows = rowsFor(f, b.id)
  const head = `${L.tab_versus} · ${b.label} · vérifié le ${f.checked ?? '?'} · coût = ${L.cost} (${f.blend?.in ?? 3} in : ${f.blend?.out ?? 1} out)`
  return [head, ...rows.map(r => `· ${rowLine(L, r)}`), 'Scores de chaque éditeur sur son propre harnais : comparer à l’intérieur d’un benchmark, jamais entre deux.'].join('\n')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Static scatter (cost on x, log scale; score on y). Only confirmed score + confirmed price rows are drawn. */
export const scatterSvg = (f: VsFile | undefined, bench: string, colors: Record<string, string> = {}): string => {
  const pts = rowsFor(f, bench).filter(r => r.confirmed && r.cost != null && r.cost > 0)
  const C = { anthropic: '#d97757', openai: '#10a37f', line: '#8c959f', text: '#8c959f', ...colors }
  const W = 420, H = 240, L = 40, R = 12, T = 12, B = 34
  if (!pts.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="40"><text x="4" y="24" fill="${C.text}" font-size="12">aucun point confirmé</text></svg>`
  const xs = pts.map(p => Math.log10(p.cost!)), ys = pts.map(p => p.score!.value!)
  const x0 = Math.min(...xs) - 0.1, x1 = Math.max(...xs) + 0.1
  const y0 = Math.max(0, Math.floor(Math.min(...ys) / 10) * 10 - 5), y1 = Math.min(100, Math.ceil(Math.max(...ys) / 10) * 10 + 5)
  const px = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R)
  const py = (v: number) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B)
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif" font-size="10">`,
    `<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="${C.line}"/>`,
    `<line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="${C.line}"/>`,
    `<text x="${L}" y="${H - 6}" fill="${C.text}">coût $/M (log) →</text>`,
    `<text x="2" y="${T + 8}" fill="${C.text}">${y1} %</text>`,
    `<text x="2" y="${H - B}" fill="${C.text}">${y0} %</text>`,
  ]
  pts.forEach((p, i) => {
    const x = px(Math.log10(p.cost!)), y = py(p.score!.value!)
    const c = p.model.vendor === 'anthropic' ? C.anthropic : C.openai
    const indep = /ind[ée]pendant/i.test(p.score!.reported_by ?? '')
    parts.push(indep
      ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="none" stroke="${c}" stroke-width="1.5"/>`
      : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${c}"/>`)
    parts.push(`<text x="${(x + 6).toFixed(1)}" y="${(y + (i % 2 ? 10 : -4)).toFixed(1)}" fill="${c}">${esc(p.model.label.replace(/^Claude |^GPT-/, m => (m === 'GPT-' ? 'GPT-' : '')))} ${p.score!.value}</text>`)
  })
  parts.push('</svg>')
  return parts.join('')
}
