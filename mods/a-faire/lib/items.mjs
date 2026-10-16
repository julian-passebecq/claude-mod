// a-faire - pure parts (no I/O): parsers of each source, setup-gap items, done/snooze state, order and counts.
// Tested with node --test mods/a-faire/tests/logic.test.mjs. The scanner (scanner/afaire_scan.mjs) reads the files
// and runs gh / schtasks; this module only turns text and facts into items.
//
// An item: { id, src, cat, prio, title, why, steps: [{ text, copy? }], since, source: { label, href }, auto, check }
//   cat   config | decisions | logins | secrets | manual | questions
//   prio  now (bloque une conversation maintenant) | feature (bloque une fonction) | comfort (confort)
//   auto  true when the scanner can tell by itself that it is done (the item then disappears with its cause)

export const CATS = ['config', 'decisions', 'logins', 'secrets', 'manual', 'questions']
export const PRIOS = ['now', 'feature', 'comfort']

export function deepMerge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) }
  for (const [k, v] of Object.entries(b)) if (!k.startsWith('_')) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v
  return out
}

export function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
}

// FNV-1a, 32 bits, base 36: a stable id from a source and its key text.
export function hash(s) {
  let h = 0x811c9dc5
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}

const rx = (s, flags = 'i') => { try { return s ? new RegExp(s, flags) : null } catch { return null } }
const clean = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim()
export const oneLine = (s, max = 110) => { const t = clean(s); return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t }
const dayMs = (d) => { const t = Date.parse(`${d}T09:00:00`); return Number.isFinite(t) ? t : null }

// Backtick spans of a text: what a step can copy (paths, commands).
export function codeSpans(text) {
  return [...String(text || '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()).filter(Boolean)
}

function stepsOf(text) {
  const spans = codeSpans(text)
  const steps = [{ text: clean(text).replace(/`/g, '') }]
  for (const s of spans) steps.push({ text: s, copy: s })
  return steps
}

// ---- manual-checks.md: « date · project · what · how », one line each; struck lines (~~) are done --------------------

export function parseManualChecks(text, { file = '', href = '', loginRe = null, gaps = [] } = {}) {
  const items = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*]\s+/, '').trim()
    if (!/^\d{4}-\d{2}-\d{2}\s*·/.test(line)) continue
    if (line.startsWith('~~')) continue
    if (gaps.some((g) => g.match && g.match.test(line))) continue // a setup gap says it better (and checks it)
    const [date, project, what, ...rest] = line.split(/\s+·\s+/)
    const how = rest.join(' · ')
    const cat = loginRe && loginRe.test(line) ? 'logins' : 'manual'
    items.push({
      id: `manual:${hash(line)}`, src: 'manual', cat, prio: cat === 'logins' ? 'feature' : 'comfort',
      title: oneLine(`${project || ''} : ${what || ''}`),
      why: project ? `Vérification que seul toi peux faire (${oneLine(project, 60)})` : 'Vérification que seul toi peux faire',
      steps: how ? stepsOf(how) : [], since: dayMs(date), source: { label: file || 'manual-checks.md', href }, auto: false,
    })
  }
  return items
}

// ---- questions.md: « date · project · question · choice · why »; only lines that say they wait for Julian ----------

export function parseQuestions(text, { file = '', href = '', match = null } = {}) {
  const re = match instanceof RegExp ? match : rx(match)
  if (!re) return []
  const items = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*]\s+/, '').replace(/^\|\s*/, '').trim()
    if (!line || line.startsWith('~~') || line.startsWith('#') || !re.test(line)) continue
    const parts = line.split(/\s+[·|]\s+/).map((s) => s.replace(/\|\s*$/, '').trim())
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(parts[0])
    const [date, project, question, choice] = isDate ? parts : ['', '', line, '']
    items.push({
      id: `question:${hash(line)}`, src: 'questions', cat: 'decisions', prio: 'comfort',
      title: oneLine(`${project ? project + ' : ' : ''}${question || ''}`),
      why: choice ? `Choix provisoire d'un agent : ${oneLine(choice, 160)}` : 'Une conversation a noté cette question pour toi',
      steps: [], since: isDate ? dayMs(date) : null, source: { label: file || 'questions.md', href }, auto: false,
    })
  }
  return items
}

// ---- DECISIONS-PENDING.md: open table rows « | n | decision | facts | R | » and « ⚠ Your action » lines ----------------

export function parseDecisions(text, { file = '', href = '', stop = /already decided|resolved since|déjà décid|réglées? depuis/i, sinceMs = null } = {}) {
  const items = []
  let section = ''
  for (const raw of String(text || '').split(/\r?\n/)) {
    const h = /^#{2,3}\s+(.*)$/.exec(raw)
    if (h) { section = clean(h[1]); if (stop && stop.test(section)) break; continue }
    if (raw.startsWith('|')) {
      const cells = raw.split('|').slice(1, -1).map((c) => c.trim())
      if (cells.length < 2 || !/^\d+(\.\d+)*$/.test(cells[0])) continue
      if (cells.slice(0, 2).some((c) => c.startsWith('~~'))) continue
      const [num, decision, facts = '', rec = ''] = cells
      items.push({
        id: `decision:${hash(file + '|' + num + '|' + decision)}`, src: 'decisions', cat: 'decisions', prio: 'comfort',
        title: oneLine(`${num} ${decision}`), why: oneLine(facts, 220) || oneLine(section, 120),
        steps: rec ? [{ text: `Recommandé : ${clean(rec).replace(/`/g, '')}` }, ...codeSpans(rec).map((s) => ({ text: s, copy: s }))] : [],
        since: sinceMs, source: { label: `${file || 'DECISIONS-PENDING.md'} › ${oneLine(section, 50)}`, href }, auto: false,
      })
      continue
    }
    const act = /^\s*⚠?\s*\*\*(?:Your action|Ton action|Action pour toi|À toi)\s*:?\*\*\s*:?\s*(.*)$/i.exec(raw)
    if (act && !/^\s*~~/.test(act[1])) {
      items.push({
        id: `decision:${hash(file + '|action|' + act[1])}`, src: 'decisions', cat: 'decisions', prio: 'feature',
        title: oneLine(act[1].replace(/`/g, '')), why: oneLine(section, 160), steps: codeSpans(act[1]).map((s) => ({ text: s, copy: s })),
        since: sinceMs, source: { label: `${file || 'DECISIONS-PENDING.md'} › ${oneLine(section, 50)}`, href }, auto: false,
      })
    }
  }
  return items
}

// ---- open PRs that wait for Julian: a label, or one sentence of title/body naming Julian and approve/decide ----------

export function julianSentence(text, nameRe, verbRe) {
  for (const s of String(text || '').split(/(?<=[.!?])\s+|\n+/)) if (nameRe.test(s) && verbRe.test(s)) return clean(s)
  return ''
}

export function prItems(prs, { labels = [], name = '\\bJulian\\b', verbs = 'approv|decid|décid|valid|tranch' } = {}) {
  const nameRe = rx(name), verbRe = rx(verbs)
  const want = new Set(labels.map((l) => l.toLowerCase()))
  const items = []
  for (const p of prs || []) {
    const labs = (p.labels || []).map((l) => String(l.name || l).toLowerCase())
    const label = labs.find((l) => want.has(l))
    const sentence = nameRe && verbRe ? julianSentence(`${p.title || ''}.\n${p.body || ''}`, nameRe, verbRe) : ''
    if (!label && !sentence) continue
    const repo = (p.repository && (p.repository.nameWithOwner || p.repository.name)) || ''
    const n = p.number || String(p.url || '').split('/').pop()
    items.push({
      id: `pr:${hash(p.url || repo + n)}`, src: 'prs', cat: 'decisions', prio: 'feature',
      title: oneLine(`${repo.split('/').pop()}#${n} : ${p.title || ''}`),
      why: sentence ? `La PR dit : « ${oneLine(sentence.replace(/`/g, ''), 200)} »` : `Étiquette « ${label} »`,
      steps: p.url ? [{ text: 'Lire la PR puis approuver, demander des changements ou la fermer', copy: `gh pr view ${p.url} --web` }] : [],
      since: p.createdAt ? Date.parse(p.createdAt) || null : null, source: { label: `${repo}#${n}`, href: p.url || '' }, auto: false,
    })
  }
  return items
}

// ---- veille: open « attend Julian » alerts (questions from conversations, logins seen in their last messages) -------

export function veilleItems(state, acks, { loginRe = null } = {}) {
  const ack = new Set(acks || [])
  const items = []
  for (const a of Object.values((state && state.alerts) || {})) {
    if (!a || !a.julian || a.acked || ack.has(a.key) || ack.has('*')) continue
    const login = loginRe && loginRe.test(`${a.what || ''} ${a.title || ''}`)
    items.push({
      id: `veille:${hash(a.key)}`, src: 'veille', cat: login ? 'logins' : 'questions', prio: 'now',
      title: oneLine(a.what || a.key), why: `La conversation « ${oneLine(a.title || 'sans titre', 60)} » attend ta réponse`,
      steps: [{ text: 'Ouvrir la conversation et répondre' }, ...(a.key ? [{ text: 'puis, si besoin, dans Claude', copy: `/veille ack ${a.key}` }] : [])],
      since: a.since || a.first_seen || null, source: { label: 'conversation', href: a.session_link || a.link || '' }, auto: false, veille_key: a.key,
    })
  }
  return items
}

// ---- setup gaps: facts measured by the scanner -> items that close by themselves ------------------------------------
// facts: { veilleHome, veilleInstalled, smtpProblem, smtpExample, watcherScript, mods: { notLoaded: [], value },
//          task: { checked, present, lastFire, everyMin, name }, secrets: { count, registry }, now }

export function smtpProblem(smtp) {
  if (!smtp || typeof smtp !== 'object') return 'smtp.json absent'
  for (const k of ['host', 'user', 'password', 'from', 'to']) if (!smtp[k] || /^<.*>$/.test(String(smtp[k]))) return `smtp.json : ${k} manquant`
  return ''
}

export function gapItems(f, L = {}) {
  const items = []
  const now = f.now || Date.now()
  if (f.veilleInstalled && f.smtpProblem) {
    const target = `${f.veilleHome}/smtp.json`
    items.push({
      id: 'gap:smtp', src: 'gaps', cat: 'config', prio: 'feature', check: 'smtp', auto: true,
      title: 'Créer un mot de passe d’application Gmail et remplir smtp.json de la veille',
      why: `La veille ne peut pas t’écrire (${f.smtpProblem}) : ce qui attend Julian reste dans le panneau et se perd`,
      steps: [
        { text: '1. Créer un mot de passe d’application (16 lettres) sur', copy: 'https://myaccount.google.com/apppasswords' },
        ...(f.smtpExample ? [{ text: '2. Copier le modèle (PowerShell)', copy: `Copy-Item "${f.smtpExample}" "${target}"` }] : [{ text: `2. Créer ${target}` }]),
        { text: '3. Remplir host smtp.gmail.com, port 587, user, password (le mot de passe d’application), from, to dans', copy: target },
        { text: '4. Tester l’envoi', copy: `node "${f.watcherScript || `${f.veilleHome}/bin/veille/watcher/veille.mjs`}" test-mail` },
      ],
      since: f.smtpSince || null, source: { label: target, href: '' }, match: /veille[\\/]smtp\.json|app password|mot de passe d.application/i,
    })
  }
  if (f.mods && f.mods.notLoaded && f.mods.notLoaded.length) {
    const names = f.mods.notLoaded.map((m) => m.name)
    items.push({
      id: 'gap:mods', src: 'gaps', cat: 'config', prio: 'comfort', check: 'mods', auto: true,
      title: `${names.length} mod(s) installé(s) mais pas chargé(s) : ${oneLine(names.join(', '), 80)}`,
      why: 'Leurs panneaux et commandes n’existent pas dans tes conversations',
      steps: [
        { text: 'Remplacer CLAUDE_CODE_PLUGIN_DIRS (bloc env de ~/.claude/settings.json) par', copy: f.mods.value },
        { text: 'puis redémarrer les conversations (les mods se chargent au démarrage)' },
      ],
      since: null, source: { label: f.mods.settings || 'settings.json', href: '' },
    })
  }
  if (f.task && f.task.checked && f.veilleInstalled) {
    const every = f.task.everyMin || 5
    const dead = f.task.present && f.task.lastFire && now - f.task.lastFire > 3 * every * 60000
    if (!f.task.present || dead) {
      items.push({
        id: 'gap:task', src: 'gaps', cat: 'config', prio: 'feature', check: 'task', auto: true,
        title: f.task.present ? `La tâche ${f.task.name} ne tourne plus` : `La tâche ${f.task.name} manque`,
        why: 'Sans elle, rien ne surveille les conversations quand Claude est fermé (pas d’alerte, pas d’e-mail)',
        steps: [
          ...(f.watcherSource ? [{ text: 'Réinstaller la tâche (PowerShell)', copy: `node "${f.watcherSource}" install` }] : []),
          { text: 'Vérifier', copy: `schtasks /Query /TN ${f.task.name} /V /FO LIST` },
        ],
        since: f.task.lastFire || null, source: { label: `${f.veilleHome}/heartbeat.json`, href: '' },
      })
    }
  }
  if (f.secrets && f.secrets.count > 0) {
    items.push({
      id: 'gap:secrets', src: 'gaps', cat: 'secrets', prio: 'feature', check: 'secrets', auto: true,
      title: `${f.secrets.count} secret(s) de tests réels « à ranger »`,
      why: 'Des tests réels attendent que tu ranges leurs secrets (coffre, gestionnaire de mots de passe)',
      steps: [{ text: 'Ouvrir le registre dans Claude', copy: '/tests-reels' }],
      since: f.secrets.since || null, source: { label: f.secrets.registry || 'registry.json', href: '' },
    })
  }
  return items
}

// Entries « à ranger » in the tests-reels registry, whatever its shape (array, {items}, {secrets}, {entries}).
export function countToFile(reg, matchRe = /ranger/i) {
  const list = Array.isArray(reg) ? reg : reg && typeof reg === 'object' ? reg.items || reg.secrets || reg.entries || Object.values(reg) : []
  let n = 0
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e !== 'object') continue
    if ([e.status, e.state, e.category, e.bucket, e.where].some((v) => v && matchRe.test(String(v)))) n++
  }
  return n
}

// « mods installés mais pas chargés » is measured by lib/mods-check.mjs (lib/core/mods.mjs, node only); gapItems
// above only turns its result (facts.mods) into an item.

// ---- state: done and snoozed ---------------------------------------------------------------------------------------

export function applyState(items, state, now) {
  const done = (state && state.done) || {}
  const snooze = (state && state.snooze) || {}
  const open = [], snoozed = [], closed = []
  for (const it of items) {
    if (!it.auto && done[it.id]) closed.push(it)
    else if (snooze[it.id] && snooze[it.id] > now) snoozed.push({ ...it, until: snooze[it.id] })
    else open.push(it)
  }
  return { open, snoozed, closed }
}

// Done: an auto item is re-checked (the scanner measured `items` just now): still there -> not done, say why.
export function markDone(state, items, id, now) {
  const it = items.find((x) => x.id === id)
  const st = { done: { ...((state && state.done) || {}) }, snooze: { ...((state && state.snooze) || {}) }, notified: (state && state.notified) || {} }
  if (it && it.auto) return { state: st, ok: false, msg: `pas encore fait : ${it.why}` }
  st.done[id] = now
  delete st.snooze[id]
  return { state: st, ok: true, msg: it ? `fait : ${it.title}` : 'fait (ou déjà réglé)' }
}

export function markSnooze(state, id, now, days = 1) {
  const st = { done: { ...((state && state.done) || {}) }, snooze: { ...((state && state.snooze) || {}) }, notified: (state && state.notified) || {} }
  st.snooze[id] = now + days * 86400000
  return { state: st, ok: true, msg: `reporté de ${days} j` }
}

// Forget done/snooze entries whose item is gone for 30 days (snoozes as soon as they expire).
export function pruneState(state, items, now) {
  const ids = new Set(items.map((i) => i.id))
  const keep = (o, ttl) => Object.fromEntries(Object.entries(o || {}).filter(([k, t]) => ids.has(k) ? true : now - t < ttl))
  return { ...state, done: keep(state && state.done, 30 * 86400000), snooze: Object.fromEntries(Object.entries((state && state.snooze) || {}).filter(([, t]) => t > now)) }
}

// ---- order, groups, counts -----------------------------------------------------------------------------------------

export function sortItems(items) {
  const r = (p) => { const i = PRIOS.indexOf(p); return i < 0 ? 9 : i }
  return [...items].sort((a, b) => r(a.prio) - r(b.prio) || (a.since || Infinity) - (b.since || Infinity) || a.title.localeCompare(b.title))
}

export function groups(items, order = CATS) {
  return order.map((cat) => ({ cat, items: sortItems(items.filter((i) => i.cat === cat)) }))
}

// ~/.claude/a-faire/summary.json, counts only (no title, no text). The stable shape every reader relies on (README):
//   total      open items (« À toi : N »)
//   high       open items that block a conversation (priority now)
//   updatedAt  when the scanner wrote it (ms)
// Kept for older readers: open (= total, what lib/core/veille.mjs aToi() and the band read), at (= updatedAt).
// Extra detail: v, by_cat, by_prio, snoozed, errors (number of unread sources).
export function summary(open, snoozed, now, errors = []) {
  const by_cat = Object.fromEntries(CATS.map((c) => [c, open.filter((i) => i.cat === c).length]))
  const by_prio = Object.fromEntries(PRIOS.map((p) => [p, open.filter((i) => i.prio === p).length]))
  return { v: 2, total: open.length, high: by_prio.now, updatedAt: now, open: open.length, at: now, by_cat, by_prio, snoozed: snoozed.length, errors: errors.length }
}

// The band's red counter: « À toi : N », nothing when N is 0 or unknown.
export function counterText(sum, label = 'À toi') {
  const n = sum && Number(sum.total ?? sum.open)
  return n > 0 ? `${label} : ${n}` : ''
}

// Items the veille watcher should push (toast + e-mail) once: wanted priorities, not from veille itself, not seen.
export function feedOf(open, notified, prios = ['now', 'feature']) {
  return sortItems(open.filter((i) => i.src !== 'veille' && prios.includes(i.prio) && !(notified || {})[i.id]))
}
