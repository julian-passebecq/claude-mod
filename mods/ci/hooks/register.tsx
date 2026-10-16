// ci mod: which CI backends exist, whether they are usable, and which repo or conversation uses which.
//   /ci                         backends + status + the route for this conversation, opens the CI routing pane
//   /ci refresh                 the same after a fresh status check
//   /ci route <target> <id>     writes the routing file (target: a repo path, a session id, `here` or `session`)
//   /ci clear <target>
//   /ci diagramme [refresh] [claude|codex|inconnu|tout] [hote|app|conv]
//                               the « Diagramme » tab: repo → CI host → stages/jobs → result, last runs, who made them
// Everything runs through scanner/ci.py (standard library). The mod shows and informs: it never denies,
// blocks or rewrites a tool call. Its only writes are the routing file (/ci route, /ci clear, a Clear button)
// and its caches. The Diagramme reads gh/glab (GET only), git log and local transcripts; no polling.
// The drawing is in draw.tsx (pure), shared with the Référence hub (mods/reference).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GroupBy, Snapshot, WhoFilter } from '../types'
import { diagramText, parseDiagram, parseDiagramWords } from './diagram'
import { drawCi } from './draw'
import { PANE, parseArgs, parseSnapshot, promptNote, resolveTarget, summary } from './view'

const snapshot = atom({ plugin: 'ci', key: 'snapshot' } as const, '')
const checking = atom({ plugin: 'ci', key: 'checking' } as const, false)
const error = atom({ plugin: 'ci', key: 'error' } as const, '')
const tab = atom({ plugin: 'ci', key: 'tab' } as const, 'routing' as 'routing' | 'diagram')
const diagram = atom({ plugin: 'ci', key: 'diagram' } as const, '')
const fetching = atom({ plugin: 'ci', key: 'fetching' } as const, false)
const who = atom({ plugin: 'ci', key: 'who' } as const, 'all' as WhoFilter)
const group = atom({ plugin: 'ci', key: 'group' } as const, 'host' as GroupBy)
const foldedA = atom({ plugin: 'ci', key: 'folded' } as const, [] as string[])

const root = ($: EngineInterface) => $.plugin.root.replace(/\\/g, '/')
const safe = async <T,>(work: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work
  } catch {
    return fallback
  }
}

/** Runs `python -I ci.py <args>` and parses its JSON; `{ error }` on any failure, never a throw. */
const ci = async ($: EngineInterface, args: string[], timeoutMs = 20000): Promise<{ ok: true; json: any; text: string } | { ok: false; error: string }> => {
  try {
    const r = await $.process.run(['python', '-I', `${root($)}/scanner/ci.py`, ...args], { timeoutMs })
    let json: any
    try {
      json = JSON.parse(r.stdout)
    } catch {
      json = undefined
    }
    if (r.exitCode !== 0 || !json) return { ok: false, error: json?.error ?? (r.stderr.trim().split('\n').pop() || `exit ${r.exitCode}`) }
    return { ok: true, json, text: r.stdout }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

const where = async ($: EngineInterface) => ({
  cwd: (await safe($.session.cwd(), '')).replace(/\\/g, '/'),
  id: await safe($.session.id(), ''),
})

/** `show` for this conversation; `check` runs the network status check when the cache is stale, `force` always. */
const refresh = async ($: EngineInterface, mode: 'cache' | 'check' | 'force' = 'cache'): Promise<Snapshot | undefined> => {
  const { cwd, id } = await where($)
  const args = ['show', '--cwd', cwd, ...(id ? ['--session', id] : [])]
  if (mode === 'check') args.push('--check')
  if (mode === 'force') args.push('--refresh')
  if (mode !== 'cache') await update($, checking, () => true)
  const r = await ci($, args, mode === 'cache' ? 20000 : 120000)
  if (mode !== 'cache') await update($, checking, () => false)
  if (!r.ok) {
    await update($, error, () => r.error)
    return undefined
  }
  await update($, error, () => '')
  await update($, snapshot, () => r.text)
  const s = r.json as Snapshot
  if (s.options?.status_line !== false) $.ui.status(s.current ? `CI: ${s.current.backend}` : undefined)
  return s
}

// One background check at a time per module copy; it runs on a timer so it outlives the command.
let busy = false
const checkSoon = ($: EngineInterface, force = false) => {
  if (busy) return
  busy = true
  $.clock.after(0, async () => {
    try {
      await refresh($, force ? 'force' : 'check')
    } finally {
      busy = false
    }
  })
}

/** `ci.py pipelines` from its cache; `check` fetches from gh/glab when the cache is stale, `force` always. */
const loadDiagram = async ($: EngineInterface, mode: 'cache' | 'check' | 'force' = 'cache') => {
  const args = ['pipelines', ...(mode === 'check' ? ['--check'] : mode === 'force' ? ['--refresh'] : [])]
  if (mode !== 'cache') await update($, fetching, () => true)
  const r = await ci($, args, mode === 'cache' ? 20000 : 300000)
  if (mode !== 'cache') await update($, fetching, () => false)
  if (!r.ok) {
    await update($, error, () => r.error)
    return undefined
  }
  await update($, error, () => '')
  await update($, diagram, () => r.text)
  return parseDiagram(r.text)
}

let fetchBusy = false
const fetchSoon = ($: EngineInterface, force = false) => {
  if (fetchBusy) return
  fetchBusy = true
  $.clock.after(0, async () => {
    try {
      await loadDiagram($, force ? 'force' : 'check')
    } finally {
      fetchBusy = false
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ci',
      description: 'CI routing: backends, their status, and which repo or conversation uses which (route / clear)',
      argumentHint: '[refresh] | diagramme [refresh] [claude|codex|inconnu|tout] [hote|app|conv] | close | route <repo|session|here> <backend-id> | clear <repo|session|here>',
    })
    const ran = await next(e)
    // the route for the status line and the prompt note; cache only, no network at start
    $.clock.after(0, () => void refresh($, 'cache'))
    return ran
  })

  on('command.run', { command: 'ci' }, async ($, e) => {
    if ((e.args ?? '').trim().toLowerCase() === 'close') {
      await $.ui.close({ id: PANE.id })
      return {}
    }
    const p = parseArgs(e.args ?? '')
    if (p.kind === 'usage') return { text: p.text }
    if (p.kind === 'diagram') {
      const w = parseDiagramWords(p.words)
      if (w.who) await update($, who, () => w.who!)
      if (w.group) await update($, group, () => w.group!)
      await update($, tab, () => 'diagram' as const)
      await $.ui.open({ id: PANE.id, title: PANE.title })
      const d = await loadDiagram($, 'cache')
      if (!d) return { text: `ci: ${await read($, error)}` }
      if (w.refresh || d.stale) fetchSoon($, w.refresh)
      return { text: diagramText(w.refresh ? { ...d, stale: true } : d, await read($, who), await read($, group), Date.now()) }
    }
    const { cwd, id } = await where($)
    if (p.kind === 'route' || p.kind === 'clear') {
      const target = resolveTarget(p.target, cwd, id)
      const args = p.kind === 'route'
        ? ['route', target, p.backend, '--by', id ? `session ${id}` : 'session', '--cwd', cwd]
        : ['clear', target, '--cwd', cwd]
      const r = await ci($, args)
      if (!r.ok) return { text: `ci: ${r.error}` }
      await refresh($, 'cache')
      return {
        text: p.kind === 'route'
          ? `ci: ${r.json.kind} ${r.json.key} → ${r.json.backend}${r.json.warning ? ` (${r.json.warning})` : ''}`
          : `ci: cleared ${r.json.removed} route(s) for ${r.json.key}`,
      }
    }
    await update($, tab, () => 'routing' as const)
    await $.ui.open({ id: PANE.id, title: PANE.title })
    const s = await refresh($, 'cache')
    if (!s) return { text: `ci: ${await read($, error)}` }
    if (p.refresh || s.stale) checkSoon($, p.refresh)
    return { text: summary(p.refresh ? { ...s, stale: true } : s) }
  })

  // The route as information for the model, only when the config sets prompt_note: true (default off: it would add
  // text to every request). Nothing is blocked or rewritten.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const s = parseSnapshot(await read($, snapshot))
    const note = s && s.options?.prompt_note === true ? promptNote(s) : undefined
    if (!note) return result
    return { ...result, sections: [...result.sections, { id: 'ci:route', text: note, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE.id }, async ($, e) => {
    return drawCi($.ui.resolve(e), {
      surface: e.surface,
      tab: await read($, tab),
      snapshot: parseSnapshot(await read($, snapshot)),
      diagram: parseDiagram(await read($, diagram)),
      error: await read($, error),
      checking: await read($, checking),
      fetching: await read($, fetching),
      who: await read($, who),
      group: await read($, group),
      folded: await read($, foldedA),
      now: Date.now(),
      onTab: async t => {
        await update($, tab, () => t)
        if (t === 'diagram') {
          const d = await loadDiagram($, 'cache')
          if (!d || d.stale) fetchSoon($)
        } else await refresh($, 'cache')
      },
      onCheck: force => checkSoon($, force),
      onFetch: force => fetchSoon($, force),
      onWho: async f => { await update($, who, () => f) },
      onGroup: async x => { await update($, group, () => x) },
      onToggle: async k => { await update($, foldedA, (cur: string[]) => (cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k])) },
      onClear: async key => {
        await ci($, ['clear', key])
        await refresh($, 'cache')
      },
    })
  })
}
