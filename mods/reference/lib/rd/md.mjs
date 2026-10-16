// reference - R&D: Markdown/HTML readers shared by « À essayer » and « R&D ». Pure: text in, data out, no I/O.
// Tested with node --test mods/reference/tests/rd.test.mjs (invented documents only).

const MONTHS = { janv: 1, jan: 1, fev: 2, 'fév': 2, feb: 2, mars: 3, mar: 3, avr: 4, apr: 4, mai: 5, may: 5, juin: 6, jun: 6, juil: 7, jul: 7, aout: 8, 'août': 8, aug: 8, sept: 9, sep: 9, oct: 10, nov: 11, dec: 12, 'déc': 12 }
const pad = (n) => String(n).padStart(2, '0')

/** Plain text of a Markdown cell or line: no links' URLs, no emphasis, no backticks. */
export function plain(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$|[.,;:])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** FNV-1a, base 36: a stable id from a document and an item name. */
export function hash(s) {
  let h = 0x811c9dc5
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}

const splitRow = (line) => {
  const t = line.trim().replace(/^\|/, '').replace(/\|\s*$/, '')
  const cells = []
  let cur = ''
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cur += '|'; i++ } else if (t[i] === '|') { cells.push(cur.trim()); cur = '' } else cur += t[i]
  }
  cells.push(cur.trim())
  return cells
}

/** Every Markdown table: { section (nearest heading), headers, rows: [[cell...]] }. */
export function tables(text) {
  const out = []
  const lines = String(text ?? '').split(/\r?\n/)
  let section = ''
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,4}\s+(.*)$/.exec(lines[i])
    if (h) { section = plain(h[1]); continue }
    if (!lines[i].trim().startsWith('|') || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) continue
    const headers = splitRow(lines[i]).map(plain)
    const rows = []
    let j = i + 2
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(splitRow(lines[j]))
    out.push({ section, headers, rows })
    i = j - 1
  }
  return out
}

/** A date written in a file name (2026-10-16) or in a title (« 16 oct 2026 »), as YYYY-MM-DD; '' when none. */
export function dateIn(s) {
  const t = String(s ?? '')
  const iso = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(t)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const fr = /\b(\d{1,2})\s+([a-zéû]{3,5})\.?\s+(20\d\d)\b/i.exec(t)
  if (fr) {
    const m = MONTHS[fr[2].toLowerCase()]
    if (m) return `${fr[3]}-${pad(m)}-${pad(fr[1])}`
  }
  return ''
}

const URL_RE = /https?:\/\/[^\s)>\]|"'`]+/g

/** Links of a text: count and the most cited hosts. */
export function sourcesOf(text, top = 3) {
  const urls = [...new Set((String(text ?? '').match(URL_RE) || []).map((u) => u.replace(/[.,;:]+$/, '')))]
  const hosts = {}
  for (const u of urls) {
    try { const h = new URL(u).hostname.replace(/^www\./, ''); hosts[h] = (hosts[h] || 0) + 1 } catch { /* not a URL */ }
  }
  return { count: urls.length, hosts: Object.entries(hosts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([h]) => h) }
}

/**
 * What the R&D index shows for one document: { date, subject, summary: [≤ lines lines], sources }.
 * subject: the first heading (or <title>); summary: the first prose lines (no heading, table, code or list marker
 * noise), each cut to `width` characters; date: from the name, then the subject, then the file's mtime.
 */
export function docInfo(name, text, mtimeMs = 0, { lines = 3, width = 160 } = {}) {
  const t = String(text ?? '')
  const html = /\.html?$/i.test(name)
  let subject = ''
  let body = t
  if (html) {
    subject = plain((/<title>([\s\S]*?)<\/title>/i.exec(t) || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(t) || [])[1] || '')
    body = t.replace(/<head[\s\S]*?<\/head>|<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|h\d|li|div|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, '’')
  } else {
    const h = /^#{1,3}\s+(.+)$/m.exec(t)
    subject = h ? plain(h[1]) : ''
  }
  const summary = []
  let fence = false
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('```')) { fence = !fence; continue }
    if (fence || !line || /^#{1,6}\s/.test(line) || line.startsWith('|') || /^[-=*_]{3,}$/.test(line)) continue
    const p = plain(line.replace(/^[-*+]\s+|^\d+[.)]\s+|^>\s*/, ''))
    if (p.length < 12 || (subject && p === subject)) continue
    summary.push(p.length > width ? p.slice(0, width - 1).trimEnd() + '…' : p)
    if (summary.length >= lines) break
  }
  const fromMtime = mtimeMs ? new Date(mtimeMs).toISOString().slice(0, 10) : ''
  return { date: dateIn(name) || dateIn(subject) || fromMtime, subject: subject || name.replace(/\.[a-z]+$/i, ''), summary, sources: sourcesOf(t) }
}
