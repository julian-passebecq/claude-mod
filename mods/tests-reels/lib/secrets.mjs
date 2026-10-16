// Secret detection for the tests-reels mod. Pure functions, no I/O.
// Rule: a secret VALUE is never stored, printed or returned. findSecrets returns only kinds; redact replaces values.

const MASK = '«masqué»'

/** Strong forms: a match is a secret whatever the context. */
const STRONG = [
  ['jeton GitHub', /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ['jeton GitLab', /\bglpat-[A-Za-z0-9_-]{16,}/g],
  ['clé Anthropic', /\bsk-ant-[A-Za-z0-9_-]{16,}/g],
  ['clé OpenAI', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/g],
  ['clé AWS', /\bAKIA[0-9A-Z]{16}\b/g],
  ['clé privée', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ['jeton JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g],
  ['jeton Bearer', /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{20,})/g],
]

/** key = value forms: the key names a secret; the value must look like one (see looksSecret). */
const KEYED = /(["']?)(mot[ _-]?de[ _-]?passe|passwd|password|pwd|client[_-]?secret|secret|api[_-]?key|apikey|access[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|cookie|cf-access-client-secret|sharedaccesskey|accountkey)\1(\s*[:=]\s*)(["'«“]?)([^\s"'»”,;&<>]{6,200})/gi

const PLACEHOLDER = /^(?:<.*>|\*+|x{3,}|•+|\$\{?.*|%[A-Z_]+%|.*REDACTED.*|.*masqu.*|.*example.*|your[-_].*|changeme|null|none|undefined|true|false|process\.env.*|env:.*|\(.*|\[.*|\{.*)$/i

/**
 * A value that reads like a secret: long enough, several character classes, not a word list, number, path, call,
 * identifier, GUID or markdown fragment. Heuristic: tuned so prose such as "password: Playwright`" is not counted.
 */
export function looksSecret(v) {
  const s = String(v || '')
  if (s.length < 8 || PLACEHOLDER.test(s)) return false
  if (/[`*…|\\[\]{}()]/.test(s)) return false // markdown, calls, tables, Windows paths
  if (/^[a-z]+(?:[-_.][a-z]+)*$/i.test(s)) return false // words: get-token, cfg.token, Playwright
  if (/^[\d/.:,+-]+$/.test(s)) return false // numbers, dates, ratios
  if (/^[\/.~]|[\/].*[\/]/.test(s)) return false // a path
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return false // a GUID is an id, not a secret
  if (/[.,:;!?]$/.test(s) && !/\d/.test(s.slice(0, -1))) return false // end of a sentence
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(s)).length
  return classes >= 3 || (classes >= 2 && /\d/.test(s) && /[A-Za-z]/.test(s) && s.length >= 12)
}

const KEY_KIND = k => {
  const x = k.toLowerCase().replace(/[ _-]/g, '')
  if (/motdepasse|passwd|password|pwd/.test(x)) return 'mot de passe'
  if (/cookie/.test(x)) return 'cookie'
  if (/secret/.test(x)) return 'secret client'
  if (/key/.test(x)) return 'clé'
  return 'jeton'
}

/** Documentation samples and test fakes: EXAMPLE / FAKE / DUMMY in the value, or one character repeated 8 times. */
export const isFake = v => /example|fake|dummy|sample|redacted|xxxx/i.test(v) || /(.)\1{7}/.test(v)

/** Kinds of secrets present in `text` (one entry per occurrence). Values are never returned. */
export function findSecrets(text) {
  const s = String(text || '')
  const out = []
  for (const [kind, rx] of STRONG) {
    rx.lastIndex = 0
    for (const m of s.matchAll(rx)) if (!isFake(m[0])) out.push(kind)
  }
  KEYED.lastIndex = 0
  for (const m of s.matchAll(KEYED)) if (looksSecret(m[5])) out.push(KEY_KIND(m[2]))
  return out
}

/** `text` with every secret value replaced by «masqué» (keys and context kept). */
export function redact(text) {
  let s = String(text || '')
  for (const [, rx] of STRONG) s = s.replace(rx, (m, a) => (/^Bearer/i.test(m) ? `${a}${MASK}` : MASK))
  s = s.replace(KEYED, (m, q, k, sep, oq, v) => (looksSecret(v) ? `${q}${k}${q}${sep}${oq}${MASK}` : m))
  return s
}

/** URL with its query string and fragment removed (they often carry codes or tokens). */
export function stripUrl(u) {
  return String(u || '').replace(/[?#].*$/, '').replace(/[)\].,;:'"»]+$/, '')
}

const SECRET_KEYS = /^(pass(word|wd)?|pwd|mot[_ -]?de[_ -]?passe|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|cookie|key|private[_-]?key)$/i

/**
 * Throws when `obj` would store a secret: a field named like a secret with a value, or any string value that reads
 * like one. References (secret.store + secret.target) are allowed.
 */
export function assertNoSecret(obj, path = '') {
  if (obj == null) return
  if (typeof obj === 'string') {
    if (findSecrets(obj).length) throw new Error(`refusé : « ${path || 'valeur'} » ressemble à un secret. Ne stocke que l'endroit où il est rangé (--secret-store, --secret-target).`)
    return
  }
  if (Array.isArray(obj)) return obj.forEach((v, i) => assertNoSecret(v, `${path}[${i}]`))
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (SECRET_KEYS.test(k) && v != null && v !== '') throw new Error(`refusé : le champ « ${k} » contiendrait un secret. Range-le dans le Gestionnaire d'identification Windows et enregistre seulement sa cible.`)
      assertNoSecret(v, path ? `${path}.${k}` : k)
    }
  }
}
