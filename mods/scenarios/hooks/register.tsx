// scenarios mod ("Scénarios d'agents"): a read-only guide over editable presets of roles -> model, effort, unit, max parallel.
// /scenarios [id] [kind] opens the pane; the pane copies a ready-to-paste snippet. Scenarios come from scenarios.json
// beside this mod plus the user's own file (userConfig `file`). Nothing here blocks or rewrites a tool call: the only
// non-UI hook, on agent.spawn, passes the spawn on unchanged and at most shows a toast.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Catalog, Checked, ScenarioFile } from '../types'
import { KINDS, KIND_LABEL, check, expandHome, limitsFor, merge, parseArgs, roleLine, settingsFor, snippet } from './logic'
import type { Kind } from './logic'

const PANE = { id: 'scenarios', title: "Scénarios d'agents" }
const selected = atom({ plugin: 'scenarios', key: 'selected' } as const, '')
const kind = atom({ plugin: 'scenarios', key: 'kind' } as const, 'prompt')
const copied = atom({ plugin: 'scenarios', key: 'copied' } as const, '')

type Options = { file?: string; warn_no_model?: string }

const readJson = async ($: EngineInterface, path: string): Promise<{ data?: ScenarioFile; problem?: string }> => {
  let text = ''
  try {
    text = (await $.fs.read(path, { as: 'text' })) as string
  } catch {
    return { problem: `cannot read ${path}` }
  }
  try {
    return { data: JSON.parse(text) as ScenarioFile }
  } catch (err) {
    return { problem: `${path}: not valid JSON (${String(err).slice(0, 120)})` }
  }
}

const home = async ($: EngineInterface) => {
  let v: string | undefined
  try {
    v = await $.env.get('USERPROFILE')
  } catch {}
  if (!v) {
    try {
      v = await $.env.get('HOME')
    } catch {}
  }
  return v ?? ''
}

const load = async ($: EngineInterface, options: Options): Promise<Checked> => {
  const root = $.plugin.root.replace(/\\/g, '/')
  const shipped = await readJson($, `${root}/scenarios.json`)
  const problems: string[] = shipped.problem ? [shipped.problem] : []
  let extra: ScenarioFile | undefined
  if (options.file?.trim()) {
    const user = await readJson($, expandHome(options.file.trim(), await home($)))
    if (user.problem) problems.push(user.problem)
    extra = user.data
  }
  const checked = check(merge(shipped.data, extra))
  return { ...checked, errors: [...problems, ...checked.errors] }
}

const kindsOf = (c: Catalog): Kind[] => {
  const listed = c.snippets.filter((k): k is Kind => (KINDS as readonly string[]).includes(k))
  return listed.length ? listed : [...KINDS]
}

export const register: Register = (on, raw) => {
  const options = (raw ?? {}) as Options
  // Spam guard for the warn-only toast: one per minute at most.
  let lastToast = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'scenarios',
      description: "Scénarios d'agents: roles -> model, effort, unit, max parallel, with ready-to-paste snippets (args: [S1..] [prompt|agent|workflow|frontmatter|env])",
      argumentHint: '[scenario id] [prompt|agent|workflow|frontmatter|env]',
    })
    return next(e)
  })

  on('command.run', { command: 'scenarios' }, async ($, e) => {
    const { catalog, errors } = await load($, options)
    const ids = catalog.scenarios.map(s => s.id)
    const args = parseArgs(e.args ?? '', ids)
    if (args.id && !ids.includes(args.id)) {
      return { text: `scenarios: no scenario "${args.id}" (known: ${ids.join(', ') || 'none'})${errors[0] ? ` · ${errors[0]}` : ''}` }
    }
    const current = await read($, selected)
    const scenario = catalog.scenarios.find(s => s.id === (args.id ?? current)) ?? catalog.scenarios[0]
    if (scenario) await update($, selected, () => scenario.id)
    if (args.kind) await update($, kind, () => args.kind as string)
    await $.ui.open({ id: PANE.id, title: PANE.title })
    const head = `scenarios: ${ids.length} scenario(s)${errors.length ? `, ${errors.length} error(s) in the files` : ''}`
    if (scenario && args.kind) return { text: `${head}\n\n${snippet(catalog, scenario, args.kind)}` }
    return { text: `${head} · pane opened${scenario ? ` on ${scenario.id} "${scenario.name}"` : ''}` }
  })

  // Warn-only: a subagent or Workflow agent that names no model inherits one. The spawn goes on untouched.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (options.warn_no_model !== 'off' && !e.model && !e.fork && !e.isTeammate && Date.now() - lastToast > 60000) {
      lastToast = Date.now()
      const what = e.workflow ? 'a Workflow agent()' : `an Agent call (${e.subagentType})`
      $.ui.toast(`scenarios: ${what} named no model; it runs on ${'model' in result && result.model ? result.model : 'the inherited model'}. /scenarios shows what to set.`)
    }
    return result
  }).catch(($, e, next) => next(e)) // fail open: a failing warning never stops a spawn

  on('ui.render', { component: 'Pane', requestId: 'scenarios' }, async ($, e) => {
    const { Box, Text, Button, Code, Link } = $.ui.resolve(e)
    const { catalog, errors, warnings } = await load($, options)
    const want = await read($, selected)
    const s = catalog.scenarios.find(x => x.id === want) ?? catalog.scenarios[0]
    const k = ((await read($, kind)) as Kind) || 'prompt'
    const last = await read($, copied)
    const kinds = kindsOf(catalog)
    const url = (key: string) => catalog.sources[key] ?? ''
    const cite = (key: string, verified = true) => (
      <Box flexDirection="row" gap={1}>
        {verified ? null : <Text color="warning">non vérifié</Text>}
        {url(key) ? <Link href={url(key)} label={url(key)} /> : <Text dimColor>no source</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Read-only guide. Edit scenarios.json or your own file (userConfig "file") to add S5 and more.</Text>
        {errors.length > 0 && (
          <Box flexDirection="column">
            <Text color="error" bold>{`${errors.length} error(s): those scenarios are left out`}</Text>
            {errors.map(x => <Text color="error">{`· ${x}`}</Text>)}
          </Box>
        )}
        {warnings.length > 0 && (
          <Box flexDirection="column">
            {warnings.map(x => <Text color="warning">{`· ${x}`}</Text>)}
          </Box>
        )}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {catalog.scenarios.map(x => (
            <Button key={`sc-${x.id}`} {...(x.id !== s?.id ? { plain: true as const } : {})} onPress={() => update($, selected, () => x.id)}>
              {`${x.id} ${x.name}`}
            </Button>
          ))}
        </Box>
        {!s && <Text>No valid scenario. Fix the errors above.</Text>}
        {s && (
          <Box flexDirection="column" gap={1}>
            <Text bold>{`${s.id} · ${s.name}`}</Text>
            {s.summary ? <Text>{s.summary}</Text> : null}
            <Text dimColor>
              {`Escalation: ${s.escalation === false ? 'no' : 'after one failure, one step up'}` +
                (s.caps && Object.keys(s.caps).length ? ` · caps: ${Object.entries(s.caps).map(([a, b]) => `${a.replace(/_/g, ' ')} ${b}`).join(', ')}` : '')}
            </Text>
            <Box flexDirection="column">
              {s.roles.map(r => (
                <Box flexDirection="column">
                  <Text bold>{roleLine(catalog, r)}</Text>
                  {settingsFor(catalog, r).map(line => (
                    <Box flexDirection="column">
                      <Text>{`  ${line.text}`}</Text>
                      <Box flexDirection="row" gap={1}>
                        <Text dimColor>{'   '}</Text>
                        {cite(line.source, line.verified)}
                      </Box>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
            <Text bold>Documented limits</Text>
            <Box flexDirection="column">
              {limitsFor(catalog, s).map(l => (
                <Box flexDirection="column">
                  <Text>{`· ${l.text}`}</Text>
                  <Box flexDirection="row" gap={1}>
                    <Text dimColor>{'  '}</Text>
                    {cite(l.source, l.verified)}
                  </Box>
                </Box>
              ))}
            </Box>
            <Text bold>Snippet</Text>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {kinds.map(x => (
                <Button key={`kind-${x}`} {...(x !== k ? { plain: true as const } : {})} onPress={() => update($, kind, () => x)}>
                  {KIND_LABEL[x]}
                </Button>
              ))}
            </Box>
            <Code source={snippet(catalog, s, k)} language={k === 'frontmatter' ? 'yaml' : k === 'prompt' ? 'text' : 'javascript'} />
            <Box flexDirection="row" gap={1}>
              <Button
                key="copy"
                hotkey="c"
                onPress={async press => {
                  const r = await $.ui.copy({ text: snippet(catalog, s, k), surface: press.surface })
                  await update($, copied, () => (r.isCopied ? `copied: ${s.id} ${KIND_LABEL[k]}` : 'copy failed: select the text above'))
                }}
              >
                Copy snippet
              </Button>
              {last ? <Text dimColor>{last}</Text> : null}
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
