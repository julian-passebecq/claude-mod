// ci mod: which CI backends exist, whether they are usable, and which repo or conversation uses which.
//   /ci                         backends + status + the route for this conversation, opens the CI routing pane
//   /ci refresh                 the same after a fresh status check
//   /ci route <target> <id>     writes the routing file (target: a repo path, a session id, `here` or `session`)
//   /ci clear <target>
// Everything runs through scanner/ci.py (standard library). The mod shows and informs: it never denies,
// blocks or rewrites a tool call. Its only write is the routing file, on /ci route, /ci clear or a Clear button.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'
import { PANE, checkLine, mark, parseArgs, parseSnapshot, promptNote, resolveTarget, routeLine, rowColor, statusText, summary, usableText } from './view'

const snapshot = atom({ plugin: 'ci', key: 'snapshot' } as const, '')
const checking = atom({ plugin: 'ci', key: 'checking' } as const, false)
const error = atom({ plugin: 'ci', key: 'error' } as const, '')

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ci',
      description: 'CI routing: backends, their status, and which repo or conversation uses which (route / clear)',
      argumentHint: '[refresh] | close | route <repo|session|here> <backend-id> | clear <repo|session|here>',
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = parseSnapshot(await read($, snapshot))
    const isChecking = await read($, checking)
    const problem = await read($, error)
    const head = (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>
          {isChecking ? 'checking…' : `checked ${s?.generated ?? 'never'}`}
          {problem ? ` · ci.py failed: ${problem}` : ''}
        </Text>
        <Button key="refresh" hotkey="r" plain dimColor onPress={() => checkSoon($, true)}>
          Refresh
        </Button>
      </Box>
    )
    if (!s) {
      return (
        <Box flexDirection="column">
          {head}
          <Text>No data yet: run /ci or press Refresh.</Text>
        </Box>
      )
    }
    const L = s.labels
    const cur = s.current
    return (
      <Box flexDirection="column">
        {head}
        <Text bold>
          {L.here ?? 'This conversation'}: {cur ? `${cur.backend} (${cur.match} route)` : (L.no_route ?? 'no route')}
        </Text>
        <Text> </Text>
        <Text bold>{L.backends ?? 'Backends'}</Text>
        {s.backends.map(b => (
          <Box flexDirection="column">
            <Text>
              <Text color={rowColor(L, b)}>{mark(b)} </Text>
              <Text bold>{b.label}</Text>
              <Text dimColor>
                {' '}· {b.id} · {b.kind} · {b.host}
                {b.runner_tag ? ` · tag ${b.runner_tag}` : ''} · {statusText(L, b.status)}
              </Text>
              {b.status === 'active' ? <Text color={rowColor(L, b)}> · {usableText(L, b.check?.usable)}</Text> : null}
            </Text>
            <Text dimColor wrap="wrap">{'   '}{checkLine(b)}</Text>
            {b.notes ? <Text dimColor wrap="wrap">{'   '}{b.notes}</Text> : null}
          </Box>
        ))}
        <Text> </Text>
        <Text bold>
          {L.routes ?? 'Routes'} ({s.routes.length}) · {s.routing_file}
        </Text>
        {s.routes.length === 0 ? <Text dimColor>none: /ci route here {'<backend-id>'}</Text> : null}
        {s.routes.map(r => (
          <Box flexDirection="row" gap={1}>
            <Text wrap="wrap" bold={cur?.key === r.key}>
              {cur?.key === r.key ? '▸ ' : '  '}
              {routeLine(s, r)}
            </Text>
            <Button
              key={`clear-${r.key}`}
              plain
              dimColor
              onPress={async () => {
                await ci($, ['clear', r.key])
                await refresh($, 'cache')
              }}
            >
              Clear
            </Button>
          </Box>
        ))}
        <Text dimColor>Set a route: /ci route {'<repo-path|session-id|here|session> <backend-id>'} · config {s.config}</Text>
      </Box>
    )
  })
}
