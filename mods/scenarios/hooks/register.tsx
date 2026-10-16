// scenarios mod ("Scénarios d'agents"): a read-only guide over editable presets of roles -> model, effort, unit, max parallel.
// /scenarios [id] [kind] opens the pane; the pane copies a ready-to-paste snippet; « Appliquer ce scénario » notes the
// chosen per-role model/effort in ~/.claude/scenarios/applied.json and shows the diff (never edits settings or agents). Scenarios come from scenarios.json
// beside this mod plus the user's own file (userConfig `file`). Nothing here blocks or rewrites a tool call: the only
// non-UI hook, on agent.spawn, passes the spawn on unchanged and at most shows a toast.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Checked, ScenarioFile } from '../types'
import { applyScenario, readApplied } from './apply_io'
import { drawScenarios } from './draw'
import { check, expandHome, merge, parseArgs, snippet } from './logic'
import type { Kind } from './logic'

const PANE = { id: 'scenarios', title: "Scénarios d'agents" }
const selected = atom({ plugin: 'scenarios', key: 'selected' } as const, '')
/** File access handed to apply_io.ts ($ never crosses an import). */
const io = ($: EngineInterface) => ({
  read: async (path: string): Promise<string | undefined> => {
    try {
      return (await $.fs.read(path, { as: 'text' })) as string
    } catch {
      return undefined
    }
  },
  write: (path: string, text: string) => $.fs.write(path, text),
})
const kind = atom({ plugin: 'scenarios', key: 'kind' } as const, 'prompt')
const copied = atom({ plugin: 'scenarios', key: 'copied' } as const, '')
const applyMsg = atom({ plugin: 'scenarios', key: 'applyMsg' } as const, '')

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

export const register: Register = (on, raw) => {
  const options = (raw ?? {}) as Options
  // Spam guard for the warn-only toast: one per minute at most.
  let lastToast = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'scenarios',
      description: "Scénarios d'agents: roles -> model, effort, unit, max parallel, with ready-to-paste snippets (args: [S1..] [prompt|agent|workflow|frontmatter|env])",
      argumentHint: '[scenario id] [prompt|agent|workflow|frontmatter|env] | close',
    })
    return next(e)
  })

  on('command.run', { command: 'scenarios' }, async ($, e) => {
    if ((e.args ?? '').trim().toLowerCase() === 'close') {
      await $.ui.close({ id: PANE.id })
      return {}
    }
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
    const { catalog, errors, warnings } = await load($, options)
    const claudeDir = `${(await home($)).replace(/\\/g, '/')}/.claude`
    return drawScenarios($.ui.resolve(e), {
      catalog, errors, warnings,
      selected: await read($, selected),
      kind: ((await read($, kind)) as Kind) || 'prompt',
      copied: await read($, copied),
      applied: await readApplied(io($), catalog, claudeDir),
      applyMsg: await read($, applyMsg),
      onSelect: id => update($, selected, () => id),
      onKind: k => update($, kind, () => k),
      onCopy: async (text, label, press) => {
        const r = await $.ui.copy({ text, surface: press.surface })
        await update($, copied, () => (r.isCopied ? `copied: ${label}` : 'copy failed: select the text above'))
      },
      onApply: async id => {
        const s = catalog.scenarios.find(x => x.id === id)
        if (!s) return
        let msg: string
        try {
          msg = await applyScenario(io($), catalog, s, claudeDir, new Date(await $.clock.now()).toISOString())
        } catch (err) {
          msg = `écriture impossible : ${String(err).slice(0, 160)}`
        }
        await update($, applyMsg, () => msg)
      },
    })
  })
}
