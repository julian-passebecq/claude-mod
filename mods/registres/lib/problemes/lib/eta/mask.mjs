// export-eta - confidentiality pass on rendered Markdown before anything is written to the eta repo. Pure: no I/O.
// mask(text, opts) replaces every secret it recognises by «masqué:<kind>» and counts them; check(text, opts) re-runs
// every rule plus the « hold » rules on the result: any hit there is a secret we could not mask, and the caller holds
// the file back instead of exporting it. The rules extend claude-mod's tools/confidentiality_scan.py (tokens, keys,
// private keys, e-mail addresses) with passwords, cookies, connection strings, JWTs and bearer headers; more come from
// the config (`extra_patterns`) and from pattern files (`patterns_files`, e.g. the tests-reels mod's secret list).

const M = (kind) => `«masqué:${kind}»`

// [kind, regex, replace(match, ...groups) → string]. Order matters: whole blocks first, then labelled values, then tokens.
export const RULES = [
  ['private-key', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g, () => M('private-key')],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, () => M('jwt')],
  ['url-credentials', /\b([a-z][a-z0-9+.-]{1,20}:\/\/)([^\s:/@"'<>]{1,64}):([^\s@/"'<>]{1,200})@/gi, (m, s, u) => `${s}${u}:${M('password')}@`],
  ['connection-string', /\b((?:password|pwd|accountkey|sharedaccesskey|access ?key)\s*=\s*)("[^"]*"|'[^']*'|[^;"'\s]+)/gi, (m, k) => `${k}${M('connection-string')}`],
  ['authorization', /\b(authorization\s*[:=]\s*["']?(?:bearer|basic|token|bot)\s+)([A-Za-z0-9._~+/=-]{8,})/gi, (m, k) => `${k}${M('authorization')}`],
  ['bearer', /\b(bearer\s+)([A-Za-z0-9._~+/-]{20,}=*)/gi, (m, k) => `${k}${M('bearer')}`],
  ['cookie', /\b((?:set-)?cookie\s*:\s*)([^\r\n]+)/gi, (m, k) => `${k}${M('cookie')}`],
  ['cookie', /\b((?:session|sess|auth|csrf|xsrf)[_-]?(?:id|token|cookie)?\s*=\s*)([A-Za-z0-9%._~+/-]{16,}=*)/gi, (m, k) => `${k}${M('cookie')}`],
  ['password', /\b((?:password|passwd|pwd|passphrase|mot de passe|mdp)\b["']?\s*[:=]\s*)("[^"\r\n]{1,200}"|'[^'\r\n]{1,200}'|[^\s"',;]{3,200})/gi, (m, k, v) => (/^«masqué/.test(v) || isPlaceholder(v.replace(/^["']|["']$/g, '')) ? m : `${k}${M('password')}`)],
  ['secret', /\b((?:[A-Za-z0-9]+[_-])*(?:secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|credentials?|sharedaccesskey|accountkey|cookie)\b["']?\s*[:=]\s*)("[^"\r\n]{8,300}"|'[^'\r\n]{8,300}'|[^\s"',;]{8,300})/gi,
    (m, k, v) => (/^«masqué/.test(v) || !looksSecret(v.replace(/^["']|["']$/g, '')) ? m : `${k}${M('secret')}`)],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})/g, () => M('github-token')],
  ['gitlab-token', /\bgl(?:pat|dt|rt|ptt|cbt|oas|ft|imt|agent|soat)-[A-Za-z0-9_-]{16,}/g, () => M('gitlab-token')],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{16,}/g, () => M('anthropic-key')],
  ['openai-key', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g, () => M('openai-key')],
  ['stripe-key', /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, () => M('stripe-key')],
  ['aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, () => M('aws-key')],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35}\b/g, () => M('google-key')],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, () => M('slack-token')],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/g, () => M('npm-token')],
  ['azure-sas', /\b(sig=)([A-Za-z0-9%+/=]{20,})/g, (m, k) => `${k}${M('azure-sas')}`],
]

// What a mask cannot fix: half a private key (no END line), a key header alone, a PGP block. Found → the file is held.
export const HOLD = [
  ['private-key (incomplet)', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY/],
  ['bloc PGP', /-----BEGIN PGP (?:PRIVATE|SECRET)/],
  ['clé PuTTY', /PuTTY-User-Key-File/],
]

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g

/** A placeholder, not a value: <PASSWORD>, $VAR, %VAR%, {{x}}, booleans, ***. */
export function isPlaceholder(v) {
  return !v || /^<.*>$/.test(v) || /^\$\{?[A-Za-z_]+\}?$/.test(v) || /^%[A-Za-z_]+%$/.test(v) || /^\{\{.*\}\}$/.test(v) ||
    /^(?:true|false|null|none|undefined|redacted|masked|xxx+|\*+|\.\.\.|…|oui|non|yes|no)$/i.test(v)
}

/** A value after `token=` or `secret:` that looks like a credential, not prose (« token: 300K », « secret: yes »). */
export function looksSecret(v) {
  if (isPlaceholder(v)) return false // placeholders, $VAR, %VAR%, booleans
  if (v.length >= 20 && /[A-Za-z]/.test(v) && /\d/.test(v)) return true
  if (v.length >= 12 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v)) return true
  return v.length >= 32 && !/\s/.test(v)
}

/** Builds the rule list: built-ins + config `extra_patterns` [{name, regex, flags?}] + pattern files already parsed. */
export function rulesOf(opts = {}) {
  const extra = [...(opts.extra_patterns || []), ...(opts.file_patterns || [])].flatMap((p) => {
    try {
      const flags = String(p.flags || 'g').includes('g') ? String(p.flags || 'g') : `${p.flags}g`
      return [[String(p.name || 'motif'), new RegExp(p.regex || p.pattern, flags), () => M(String(p.name || 'motif'))]]
    } catch { return [] }
  })
  return [...RULES, ...extra]
}

// A match whose captured value is already a mask (« password: «masqué:password» ») is left alone.
const alreadyMasked = (a) => a.slice(1).some((g) => typeof g === 'string' && g.startsWith('«masqué'))

const ownSet = (opts) => new Set((opts.own_emails || []).map((e) => String(e).toLowerCase()).filter(Boolean))

/** Masks the text. Returns { text, counts: { kind: n }, total }. */
export function mask(text, opts = {}) {
  let out = String(text ?? '')
  const counts = {}
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1 }
  for (const [kind, rx, rep] of rulesOf(opts)) {
    rx.lastIndex = 0
    out = out.replace(rx, (...a) => {
      if (alreadyMasked(a)) return a[0]
      const r = rep(...a)
      if (r !== a[0]) bump(kind)
      return r
    })
  }
  const own = ownSet(opts)
  const allowDomains = (opts.allow_email_domains || []).map((d) => String(d).toLowerCase())
  out = out.replace(EMAIL, (m) => {
    const low = m.toLowerCase()
    if (own.has(low) || allowDomains.some((d) => low.endsWith('@' + d))) return m
    bump('email')
    return M('email')
  })
  if (opts.mask_paths) {
    out = out.replace(/\b[A-Za-z]:[\\/]+Users[\\/]+[A-Za-z0-9._-]+/gi, () => (bump('home-path'), 'C:/Users/<user>'))
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return { text: out, counts, total }
}

/** Hits left after masking (each { kind, sample }). Non-empty → hold the file back. */
export function check(text, opts = {}) {
  const hits = []
  const t = String(text ?? '')
  for (const [kind, rx, rep] of rulesOf(opts)) {
    rx.lastIndex = 0
    for (const m of t.matchAll(new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g'))) {
      if (!alreadyMasked([...m]) && rep(...m, m.index, t) !== m[0]) { hits.push({ kind, sample: m[0].slice(0, 6) + '…' }); break }
    }
  }
  for (const [kind, rx] of [...HOLD, ...(opts.hold_patterns || []).flatMap((p) => { try { return [[p.name || 'motif', new RegExp(p.regex || p.pattern, p.flags || '')]] } catch { return [] } })]) {
    const m = t.match(rx)
    if (m) hits.push({ kind, sample: m[0].slice(0, 6) + '…' })
  }
  const own = ownSet(opts)
  const allowDomains = (opts.allow_email_domains || []).map((d) => String(d).toLowerCase())
  for (const m of t.matchAll(EMAIL)) {
    const low = m[0].toLowerCase()
    if (!own.has(low) && !allowDomains.some((d) => low.endsWith('@' + d))) { hits.push({ kind: 'email', sample: m[0].slice(0, 3) + '…' }); break }
  }
  return hits
}

/** Adds b's counts into a. */
export function addCounts(a, b) {
  for (const [k, v] of Object.entries(b || {})) a[k] = (a[k] || 0) + v
  return a
}
