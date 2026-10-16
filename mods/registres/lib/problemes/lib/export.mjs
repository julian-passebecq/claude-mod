// problemes - the register as Markdown for the eta repo (« /problemes export »). Pure: no I/O. The masking and the git
// flow are export-eta's, byte-copied into lib/eta/ (scripts/sync-libs.mjs, drift-tested).
import { check, mask, addCounts } from './eta/mask.mjs'
import { fmtDate, fill } from './core.mjs'

export const MARK = '<!-- export problemes (mod problemes, claude-mod) : réécrit à chaque export, ne pas éditer -->'

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const top = (c) => String(c || 'autres').split('/')[0]
export const slugOf = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'autres'

function labelOf(id, categories) {
  for (const c of categories || []) {
    if (c.id === id) return c.label
    for (const ch of c.children || []) if (ch.id === id) return ch.label
  }
  return id
}

/** One problem as a Markdown section. */
export function problemMd(p, categories, L = {}) {
  const lines = [`### ${p.id} · ${p.title || p.id}`, '']
  const meta = [`${L.status || 'Statut'} : ${p.status}`, `${L.category || 'Catégorie'} : ${labelOf(p.category, categories)} (\`${p.category}\`)`,
    `${L.count || 'vu'} ${p.count || 0} ${L.times || 'fois'}`, `${fmtDate(p.first_seen)} → ${fmtDate(p.last_seen)}`]
  if ((p.apps || []).length) meta.push(p.apps.join(', '))
  if (p.source) meta.push(`${L.source || 'source'} ${p.source}`)
  lines.push(`- ${meta.join(' · ')}`)
  for (const [k, v] of [[L.symptom || 'Symptôme', p.symptom], [L.cause || 'Cause', p.cause], [L.fix || 'Correctif', p.fix]]) lines.push(`- **${k}** : ${v ? cell(v) : '—'}`)
  for (const n of (p.notes || []).slice(-10)) lines.push(`- ${L.note || 'Note'} ${fmtDate(n.at)} : ${cell(n.text)}`)
  for (const ev of (p.evidence || []).slice(-3).reverse()) {
    const where = [ev.session ? `session \`${String(ev.session).slice(0, 8)}\`` : '', ev.title || '', ev.file && !ev.session ? String(ev.file).split('/').pop() : ''].filter(Boolean).join(' · ')
    lines.push(`- ${L.evidence || 'Preuve'} ${fmtDate(ev.at)}${where ? ' · ' + cell(where) : ''}${ev.text ? ' : ' + cell(String(ev.text).slice(0, 300)) : ''}`)
  }
  return lines.join('\n')
}

function counts(problems) {
  const by = {}
  for (const p of problems) by[p.status] = (by[p.status] || 0) + 1
  return by
}

function summary(problems, categories, nowMs, L, linkOf) {
  const groups = {}
  for (const p of problems) (groups[top(p.category)] = groups[top(p.category)] || []).push(p)
  const st = counts(problems)
  const head = [MARK, '', `# ${L.register_title || 'Registre des problèmes'}`, '',
    `${fill(L.register_intro || '{n} problèmes, exporté le {date} par le mod problemes (claude-mod), secrets masqués.', { n: problems.length, date: fmtDate(nowMs) })}`, '',
    `${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(' · ')}`, '',
    `| ${L.col_category || 'Catégorie'} | ${L.col_open || 'Ouverts'} | ${L.col_total || 'Total'} | ${L.col_last || 'Dernier vu'} |`, '|---|---|---|---|']
  const order = Object.keys(groups).sort((a, b) => groups[b].filter((p) => p.status === 'ouvert').length - groups[a].filter((p) => p.status === 'ouvert').length || a.localeCompare(b))
  for (const g of order) {
    const list = groups[g]
    const last = Math.max(0, ...list.map((p) => p.last_seen || 0))
    const name = labelOf(g, categories)
    head.push(`| ${linkOf ? `[${cell(name)}](${linkOf(g)})` : cell(name)} | ${list.filter((p) => p.status === 'ouvert').length} | ${list.length} | ${fmtDate(last)} |`)
  }
  return { head: head.join('\n'), groups, order }
}

/**
 * The files to write: { files: [{ path, content }], held: [{ path, hits }], masked: {kind: n}, split: bool }.
 * One REGISTRE.md, or (past max_kb) REGISTRE.md as an index plus one file per top category.
 */
export function registerFiles(problems, cfg, nowMs, ownEmails = [], maskOptsOf) {
  const E = cfg.eta || {}
  const L = cfg.labels || {}
  const dir = (E.dest_dir || 'sources/problemes').replace(/\/+$/, '')
  const cats = cfg.categories || []
  const mo = maskOptsOf ? maskOptsOf(ownEmails) : { own_emails: ownEmails }
  const sorted = [...problems].sort((a, b) => (a.status === 'ouvert' ? 0 : 1) - (b.status === 'ouvert' ? 0 : 1) || (b.last_seen || 0) - (a.last_seen || 0))
  const one = summary(sorted, cats, nowMs, L)
  const body = one.order.map((g) => `## ${labelOf(g, cats)}\n\n${one.groups[g].map((p) => problemMd(p, cats, L)).join('\n\n')}`).join('\n\n')
  const single = `${one.head}\n\n${body}\n`
  const max = (E.max_kb ?? 300) * 1024
  let raw
  if (Buffer.byteLength(single, 'utf8') <= max) raw = [{ path: `${dir}/REGISTRE.md`, content: single }]
  else {
    const idx = summary(sorted, cats, nowMs, L, (g) => `${slugOf(g)}.md`)
    raw = [{ path: `${dir}/REGISTRE.md`, content: `${idx.head}\n` }]
    for (const g of idx.order) {
      raw.push({ path: `${dir}/${slugOf(g)}.md`, content: `${MARK}\n\n# ${labelOf(g, cats)}\n\n[${L.back || 'Registre'}](REGISTRE.md)\n\n${idx.groups[g].map((p) => problemMd(p, cats, L)).join('\n\n')}\n` })
    }
  }
  const files = []
  const held = []
  const masked = {}
  for (const f of raw) {
    const m = mask(f.content, mo)
    const hits = check(m.text, mo)
    if (hits.length) { held.push({ path: f.path, hits: hits.map((h) => h.kind) }); continue }
    addCounts(masked, m.counts)
    files.push({ path: f.path, content: m.text })
  }
  // A held-back category file must not leave a dead link: the index says it is held back.
  if (held.length && files[0] && files[0].path.endsWith('/REGISTRE.md')) {
    files[0].content += `\n${L.held_note || 'Retenus (secret non masquable) :'} ${held.map((h) => h.path.split('/').pop()).join(', ')}\n`
  }
  return { files, held, masked, split: raw.length > 1 }
}

/** Files of an earlier export in the folder that this export no longer writes (marked by MARK). */
export function staleOf(existing, files) {
  const keep = new Set(files.map((f) => f.path))
  return existing.filter((e) => e.content.startsWith(MARK) && !keep.has(e.path)).map((e) => e.path)
}
