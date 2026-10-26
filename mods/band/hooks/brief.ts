// band mod: the « Export conv » / « Export + enfants » buttons on the Jauge line (export_brief in band.config.json).
// Pure: which buttons, their labels (order and words from the config), the script's arguments, the toast from its
// answer. register.tsx runs export-eta's exporter/brief.mjs with $.process.run (not $.command.run, which would wait for
// Claude's turn to end) and polls `info` for the child count.

export type BriefButtonCfg = { id: 'conv' | 'tree' | string; label: string; count?: string }

export type BriefCfg = {
  enabled: boolean
  /** export-eta's script, relative to band's folder (both mods sit side by side in claude-mod/mods) or absolute */
  script: string
  buttons: BriefButtonCfg[]
  /** seconds between child-count polls (`info`) */
  refresh_s: number
  timeout_s: number
  /** hide (default) or grey the buttons when the script is not found */
  when_missing: 'hide' | 'grey'
  labels: Record<string, string>
}

export const DEF_BRIEF: BriefCfg = {
  enabled: true,
  script: '../export-eta/exporter/brief.mjs',
  buttons: [
    { id: 'conv', label: 'Export conv' },
    { id: 'tree', label: 'Export + enfants', count: ' +{n}' },
  ],
  refresh_s: 60,
  timeout_s: 300,
  when_missing: 'hide',
  labels: {
    busy: 'export…',
    started: 'Brief en cours…',
    started_tree: 'Brief avec {n} sous-conversation(s) en cours…',
    done: '{line}',
    failed: 'Brief échoué : {error}',
    missing: 'mod export-eta introuvable ({script}) : ajouter mods/export-eta à côté de mods/band',
  },
}

export function briefCfg(raw: unknown): BriefCfg {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BriefCfg>
  const buttons = Array.isArray(r.buttons) ? r.buttons.filter(b => b && typeof b.label === 'string' && typeof b.id === 'string') : DEF_BRIEF.buttons
  return {
    enabled: r.enabled !== false,
    script: typeof r.script === 'string' && r.script ? r.script : DEF_BRIEF.script,
    buttons,
    refresh_s: Math.max(10, Number(r.refresh_s) || DEF_BRIEF.refresh_s),
    timeout_s: Math.max(30, Number(r.timeout_s) || DEF_BRIEF.timeout_s),
    when_missing: r.when_missing === 'grey' ? 'grey' : 'hide',
    labels: { ...DEF_BRIEF.labels, ...(r.labels ?? {}) },
  }
}

export const fillB = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined ? m : String(v[k])))

/** The script's absolute path: `script` as is when absolute, else joined to band's folder (../ resolved). */
export function scriptPath(root: string, script: string): string {
  const s = script.replace(/\\/g, '/')
  if (/^([A-Za-z]:)?\//.test(s)) return s
  const parts = root.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  for (const p of s.split('/')) {
    if (p === '..') parts.pop()
    else if (p && p !== '.') parts.push(p)
  }
  return parts.join('/')
}

export type BriefButton = { id: string; key: string; label: string; enabled: boolean }

/**
 * The buttons to draw, in config order: « tree » only when the conversation has children (its count filled in), none
 * when disabled or (when_missing hide) the script is missing (ready false). busy: the id running, drawn with labels.busy.
 */
export function briefButtons(c: BriefCfg, s: { children: number; ready: boolean; busy?: string }): BriefButton[] {
  if (!c.enabled || (!s.ready && c.when_missing === 'hide')) return []
  return c.buttons
    .filter(b => b.id !== 'tree' || s.children > 0)
    .map(b => ({
      id: b.id,
      key: `brief-${b.id}`,
      label: s.busy === b.id ? c.labels.busy : `${b.label}${b.id === 'tree' && b.count ? fillB(b.count, { n: s.children }) : ''}`,
      enabled: s.ready && !s.busy,
    }))
}

/** argv for the script: run this session, --children for « tree ». */
export const briefArgv = (node: string, script: string, id: string, session: string, cwd = '') => [node, script, 'run', '--session', session, ...(cwd ? ['--cwd', cwd] : []), '--json', ...(id === 'tree' ? ['--children'] : [])]

/** The toast after a run, from the script's JSON line (else its last output line). */
export function briefToast(c: BriefCfg, r: { exitCode: number; stdout: string; stderr: string }): string {
  const last = (r.stdout || '').trim().split('\n').pop() || ''
  try {
    const j = JSON.parse(last) as { ok?: boolean; line?: string; error?: string }
    if (j.ok) return fillB(c.labels.done, { line: j.line ?? '' })
    return fillB(c.labels.failed, { error: j.error ?? j.line ?? '?' })
  } catch {
    return fillB(c.labels.failed, { error: (last || r.stderr || `exit ${r.exitCode}`).slice(0, 200) })
  }
}

/** The child count from `info`'s JSON, 0 when unreadable. */
export function infoOf(stdout: string): { found: boolean; children: number } {
  try {
    const j = JSON.parse((stdout || '').trim().split('\n').pop() || '{}') as { found?: boolean; children?: number }
    return { found: Boolean(j.found), children: Number(j.children) || 0 }
  } catch {
    return { found: false, children: 0 }
  }
}
