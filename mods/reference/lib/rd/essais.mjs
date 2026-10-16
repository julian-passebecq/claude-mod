// reference - « À essayer »: the features and ideas of the research documents, one item per table row, with its state
// (jamais | en test | adopté | écarté), the test proposed, cost and risk; and « Ce qu'on doit tester » from the manual
// checks and the tests-reels registry. Pure: the scanner reads the files, the pane overlays Julian's own states
// (~/.claude/reference-mod/essais.json). Tested with node --test mods/reference/tests/rd.test.mjs.
import { hash, plain, tables } from './md.mjs'

export const STATES = ['jamais', 'en test', 'adopté', 'écarté']

const norm = (s) => plain(s).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
const rx = (s, f = 'i') => { try { return s ? new RegExp(s, f) : null } catch { return null } }

/** Index of the first header matching one of the names (lower case, apostrophes folded), -1 when none. */
export function column(headers, names) {
  const hs = headers.map(norm)
  for (const n of names || []) {
    const i = hs.indexOf(norm(n))
    if (i >= 0) return i
  }
  return -1
}

/** The default state of a row, from the « On l'utilise ? » cell (and the interest / test cells): config rules, in order. */
export function defaultState(row, rules = []) {
  for (const r of rules) {
    const re = rx(r.match)
    const cell = String(row[r.field || 'used'] ?? '')
    if (re && cell && re.test(cell)) return { state: STATES.includes(r.state) ? r.state : 'jamais', why: r.why || '' }
  }
  return { state: 'jamais', why: '' }
}

/** Words of the row that say what it costs / risks, when the table has no such column. */
export function inferred(text, re) {
  const r = rx(re, 'gi')
  if (!r) return ''
  return [...new Set((String(text).match(r) || []).map((s) => s.trim().toLowerCase()))].slice(0, 4).join(', ')
}

/**
 * Items of one document. cfg: { columns: {name, what, test, interest, cost, risk, used, source}: header names,
 * state_rules: [{ field, match, state, why }], infer: { cost, risk } (regex), skip_sections (regex) }.
 * A table counts when it has a name column and one of test / interest / used.
 */
export function itemsOf(doc, text, cfg = {}) {
  const C = cfg.columns || {}
  const skip = rx(cfg.skip_sections)
  const out = []
  for (const t of tables(text)) {
    if (skip && skip.test(t.section)) continue
    const at = Object.fromEntries(['name', 'what', 'test', 'interest', 'cost', 'risk', 'used', 'source'].map((k) => [k, column(t.headers, C[k])]))
    if (at.name < 0 || (at.test < 0 && at.interest < 0 && at.used < 0)) continue
    for (const cells of t.rows) {
      const get = (k) => (at[k] >= 0 ? plain(cells[at[k]] ?? '') : '')
      const name = get('name')
      if (!name || /^-+$/.test(name)) continue
      const row = { name, what: get('what'), test: get('test'), interest: get('interest'), cost: get('cost'), risk: get('risk'), used: get('used'), source: get('source') }
      const all = cells.map(plain).join(' · ')
      if (!row.cost && cfg.infer?.cost) row.cost = inferred(all, cfg.infer.cost)
      if (!row.risk && cfg.infer?.risk) row.risk = inferred(all, cfg.infer.risk)
      const d = defaultState(row, cfg.state_rules)
      out.push({ id: `${doc}:${hash(norm(name))}`, doc, section: t.section, ...row, state: d.state, why: d.why, test: row.test === '—' ? '' : row.test })
    }
  }
  return out
}

/** Config presets (by name) then Julian's own states win over the default; extra items (config) are added. */
export function overlay(items, { presets = [], extra = [], states = {} } = {}) {
  const all = [...items]
  for (const x of extra || []) if (x && x.name && !all.some((i) => i.id === (x.id || `extra:${hash(norm(x.name))}`))) {
    all.push({ what: '', test: '', interest: '', cost: '', risk: '', used: '', source: '', section: '', doc: x.doc || '', state: 'jamais', why: '', ...x, id: x.id || `extra:${hash(norm(x.name))}` })
  }
  return all.map((i) => {
    let it = { ...i, own: false }
    for (const p of presets || []) {
      const re = rx(p.match)
      if (re && re.test(i.name)) it = { ...it, ...(STATES.includes(p.state) ? { state: p.state } : {}), ...(p.why ? { why: p.why } : {}), ...(p.alternative ? { alternative: p.alternative } : {}) }
    }
    const s = states && states[i.id]
    if (s && STATES.includes(s.state)) it = { ...it, state: s.state, own: true, at: s.at || 0 }
    return it
  })
}

const RANK = [[/haut|high/i, 0], [/moyen|medium/i, 1], [/bas|low/i, 2], [/nul|none/i, 3]]
export const interestRank = (s) => { for (const [re, n] of RANK) if (re.test(String(s || ''))) return n; return 1.5 }

/** Sections of the tab: en test (« Ce qu'on fait »), jamais (« À essayer », by interest), adopté, écarté. */
export function sections(items, order = ['en test', 'jamais', 'adopté', 'écarté']) {
  return order.map((state) => ({
    state,
    items: items.filter((i) => i.state === state).sort((a, b) => interestRank(a.interest) - interestRank(b.interest) || a.name.localeCompare(b.name)),
  }))
}

/** The next state when Julian clicks the state button. */
export const nextState = (s) => STATES[(STATES.indexOf(s) + 1) % STATES.length]

/** ~/.claude/reference-mod/essais.json with one state changed. */
export function setState(file, id, state, now) {
  const items = { ...((file && file.items) || {}) }
  if (STATES.includes(state)) items[id] = { state, at: now }
  else delete items[id]
  return { v: 1, items }
}

/** Open lines of manual-checks.md (« date · projet · quoi · comment », struck lines are done). */
export function manualTodo(text, max = 50) {
  const out = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*]\s+/, '').trim()
    if (!/^\d{4}-\d{2}-\d{2}\s*·/.test(line) || line.startsWith('~~') || /\bDONE\b|\bFAIT\b/.test(line)) continue
    const [date, project, what, ...how] = line.split(/\s+·\s+/)
    out.push({ src: 'manual', date, project: plain(project), what: plain(what), how: plain(how.join(' · ')) })
    if (out.length >= max) break
  }
  return out
}

/** Tests-reels: procedures never run (registry and runs.jsonl) and the registry's open manual checks. */
export function testsTodo(registry, runs = [], max = 50) {
  const apps = Array.isArray(registry?.apps) ? registry.apps : registry?.apps && typeof registry.apps === 'object' ? Object.entries(registry.apps).map(([name, a]) => ({ name, ...a })) : []
  const k = (s) => String(s ?? '').trim().toLowerCase()
  const ran = new Set((runs || []).map((r) => `${k(r.app)}|${k(r.procedure)}`))
  const out = []
  for (const a of apps) {
    for (const p of a.procedures || []) {
      if ((p.runs || []).length || ran.has(`${k(a.name)}|${k(p.name)}`)) continue
      out.push({ src: 'tests-reels', date: '', project: plain(a.name), what: plain(p.name), how: p.env ? `environnement ${plain(p.env)} · jamais lancé` : 'jamais lancé' })
    }
    for (const c of a.manual_checks || []) {
      if (/fait|done|ok/i.test(String(c.status || ''))) continue
      out.push({ src: 'tests-reels', date: c.date || '', project: plain(a.name), what: plain(c.what), how: plain(c.how || '') })
    }
  }
  return out.slice(0, max)
}
