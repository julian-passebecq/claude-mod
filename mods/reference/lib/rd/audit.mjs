// reference - « Exporter pour audit » (/audit-export): what goes into the dated zip and how it is cleaned. Pure: the
// scanner (scanner/rd_scan.mjs audit-export) lists and reads the files, this module decides, masks and writes the
// manifest. Every text file goes through export-eta's masking (lib/eta/mask.mjs, a synced copy) then its check: a file
// with a secret left after masking is held back and only named in the manifest. Never: the deny list (smtp.json,
// .credentials.json, tokens, transcripts, raw data), whatever the configuration adds.
import { addCounts, check, mask } from '../eta/mask.mjs'

/** Always refused, before the configured deny list: credentials, tokens, transcripts, raw data. */
export const ALWAYS_DENY = [
  /(^|\/)smtp\.json$/i, /(^|\/)\.?credentials(\.[a-z]+)?$/i, /(^|\/)[^/]*token[^/]*$/i, /(^|\/)[^/]*secret[^/]*$/i,
  /\.jsonl$/i, /(^|\/)projects\//i, /(^|\/)transcripts?\//i, /\.(pem|key|pfx|p12|kdbx|sqlite|db)$/i, /(^|\/)\.env(\.|$)/i,
  /(^|\/)(history|sessions|session-env|shell-snapshots|file-history|paste-cache|uploads|downloads|cache|backups)\//i,
]

const TEXT = /\.(md|mdx|txt|json|jsonc|ya?ml|toml|mjs|cjs|js|ts|tsx|py|ps1|sh|css|html?|svg|ini|cfg|csv)$|(^|\/)(LICENSE|README)$/i

export function denied(rel, extra = []) {
  const p = String(rel).replace(/\\/g, '/')
  if (ALWAYS_DENY.some((re) => re.test(p))) return true
  for (const s of extra || []) { try { if (new RegExp(s, 'i').test(p)) return true } catch { /* bad pattern: ignored */ } }
  return false
}

export const isText = (rel) => TEXT.test(String(rel).replace(/\\/g, '/'))

const SECRET_KEY = /token|secret|password|passwd|pwd|api[_-]?key|apikey|auth|cookie|credential|private|session/i

/** settings.json env block: every key kept, a value whose key looks secret replaced, the others masked as text. */
export function envOf(settings, opts = {}) {
  const env = (settings && settings.env) || {}
  const out = {}
  for (const [k, v] of Object.entries(env)) out[k] = SECRET_KEY.test(k) ? '«masqué:clé-sensible»' : mask(String(v), opts).text
  return out
}

/** CLAUDE_CODE_PLUGIN_DIRS split on the platform's separator (; on Windows, : elsewhere). */
export function pluginDirs(value, sep = ';') {
  const v = String(value ?? '').trim()
  if (!v) return []
  return v.split(sep).map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean)
}

/**
 * Cleans one candidate { name, text } for the zip: { ok, text, counts } or { ok: false, why }.
 * Masks, then checks the masked text with the same rules: anything left holds the file back. opts.names false skips
 * the file-name deny list (tracked public mod code, where a name like secrets.mjs is not a secret).
 */
export function clean(name, text, opts = {}) {
  if (opts.names !== false && denied(name, opts.deny)) return { ok: false, why: 'liste interdite' }
  const m = mask(text, opts)
  const hits = check(m.text, opts)
  if (hits.length) return { ok: false, why: `secret non masquable (${[...new Set(hits.map((h) => h.kind))].join(', ')})` }
  return { ok: true, text: m.text, counts: m.counts }
}

/** The manifest written first in the zip: when, what, mods with version and commit, masked counts, held files. */
export function manifest({ at, mods = [], files = [], held = [], skipped = [], counts = {}, plugin_dirs = [], commit = '' }) {
  const L = [`# Export pour audit · ${at}`, '', 'Écrit par le mod reference (claude-mod), sans appel de modèle. Secrets masqués (« «masqué:…» »), fichiers retenus listés en bas.', '']
  L.push(`Dépôt des mods : commit ${commit || 'inconnu'}`, '', '## Mods', '', '| Mod | Version | Commit | Chargé |', '|---|---|---|---|')
  for (const m of mods) L.push(`| ${m.name} | ${m.version || '—'} | ${m.commit || '—'} | ${m.loaded ? 'oui' : 'non'} |`)
  L.push('', '## CLAUDE_CODE_PLUGIN_DIRS', '', ...(plugin_dirs.length ? plugin_dirs.map((d) => `- ${d}`) : ['(vide)']))
  L.push('', `## Fichiers (${files.length})`, '', ...files.map((f) => `- ${f}`))
  const masked = Object.entries(counts)
  L.push('', '## Masqués', '', masked.length ? masked.map(([k, v]) => `${k} ${v}`).join(' · ') : 'aucun')
  L.push('', `## Retenus (${held.length})`, '', ...(held.length ? held.map((h) => `- ${h.name} : ${h.why}`) : ['aucun']))
  if (skipped.length) L.push('', `## Ignorés (${skipped.length})`, '', ...skipped.slice(0, 200).map((s) => `- ${s.name} : ${s.why}`))
  return L.join('\n') + '\n'
}

export { addCounts }
