// control mod: four panes over the JSON that scanner/control_scan.py writes (config.json says where).
//   SETUP      the live rules (title line and version of ~/.claude/CLAUDE.md), blockers, hidden rules, mods loaded or
//              not, and everything else that shapes a session (settings env names and hooks, agents, skills, workflows)
//   USAGE      1/7/30-day model, effort and delegation mix, each metric against the live rule line it measures
//   PRACTICES  one section per heading of the live CLAUDE.md, each line with the evidence it cites and its measured
//              state; a "V6 en attente" panel when the rules repo has V6-CHANGES.md on its main branch
//   HISTORY    docs/HISTORY.md
// Nothing here names a rules version: the scanner reads it at each scan. Read-only: no tool call is touched and no
// text is added to prompts. /control opens all four (or `/control usage`), `/control scan` rescans first. Drawing never
// runs the scanner: scans start from the command or a Rescan button, on a timer so they outlive the dispatch.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import type { Evidence, Metric, PracticesData, SetupData, SetupItem, UsageData, UsageWindow } from '../types'
import type { CommandSeen } from './view'
import {
  PANES,
  ageText,
  big,
  cut,
  deepMerge,
  inSession,
  expandHome,
  isStale,
  kb,
  labelOf,
  metricValue,
  modColor,
  modMark,
  parseArgs,
  pct,
  stateColor,
  stateMark,
  usd,
} from './view'

const tick = atom({ plugin: 'control', key: 'tick' } as const, 0)
const scanning = atom({ plugin: 'control', key: 'scanning' } as const, false)
const error = atom({ plugin: 'control', key: 'error' } as const, '')
const windowId = atom({ plugin: 'control', key: 'window' } as const, '7d')
const section = atom({ plugin: 'control', key: 'section' } as const, '')
const showReference = atom({ plugin: 'control', key: 'showReference' } as const, false)
const ruleOpen = atom({ plugin: 'control', key: 'rule' } as const, '')

type Config = {
  paths: { out_dir: string; user_config?: string }
  scan: { stale_minutes: number; windows: { id: string; label: string }[] }
  labels?: { pane?: Record<string, unknown>; mod_states?: Record<string, string> }
}

const safe = async <T,>(work: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work
  } catch {
    return fallback
  }
}

const readJson = async <T,>($: EngineInterface, path: string): Promise<T | undefined> => {
  const text = await safe<string>($.fs.read(path, { as: 'text' }) as Promise<string>, '')
  if (!text) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

const root = ($: EngineInterface) => $.plugin.root.replace(/\\/g, '/')

const loadConfig = async ($: EngineInterface) => {
  const home = (await safe($.env.get('USERPROFILE'), undefined)) ?? (await safe($.env.get('HOME'), undefined)) ?? ''
  const base = await readJson<Config>($, `${root($)}/config.json`)
  const user = base?.paths.user_config ? await readJson<Config>($, expandHome(base.paths.user_config, home)) : undefined
  const cfg = (user ? deepMerge(base, user) : base) as Config | undefined
  const out = expandHome(cfg?.paths.out_dir ?? '~/.claude/effort-board/control', home)
  const pane = (cfg?.labels?.pane ?? {}) as Record<string, unknown>
  return { cfg, out, stale: cfg?.scan.stale_minutes ?? 60, L: labelOf(pane), pane, modStates: cfg?.labels?.mod_states ?? {} }
}

// One scan at a time per module copy; the atoms carry what the panes show.
let running = false
const scan = async ($: EngineInterface) => {
  if (running) return
  running = true
  await update($, scanning, () => true)
  let problem = ''
  try {
    const r = await $.process.run(
      ['python', '-I', `${root($)}/scanner/control_scan.py`, 'all', '--config', `${root($)}/config.json`],
      { timeoutMs: 600000 },
    )
    if (r.exitCode !== 0) problem = cut((r.stderr.trim().split('\n').pop() ?? '') || `exit ${r.exitCode}`, 200)
  } catch (err) {
    problem = cut(String(err), 200)
  }
  running = false
  await update($, error, () => problem)
  await update($, scanning, () => false)
  await update($, tick, n => n + 1)
  if (problem) $.ui.toast(`control: scan failed: ${problem}`)
}
const scanSoon = ($: EngineInterface) => {
  $.clock.after(0, () => void scan($))
}

// The line every pane starts with: scan age, last error, Rescan.
const header = async ($: EngineInterface, e: ResolveInput, generated?: string) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  const busy = await read($, scanning)
  const problem = await read($, error)
  return (
    <Box flexDirection="row" gap={1}>
      <Text dimColor>
        {busy ? 'scan en cours…' : `scan ${ageText(generated, Date.now())}`}
        {problem ? ` · dernier scan en échec : ${problem}` : ''}
      </Text>
      <Button key="rescan" hotkey="r" plain dimColor onPress={() => scanSoon($)}>
        Rescan
      </Button>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'control',
      description: 'Claude Control: SETUP (règles actives, mods chargés), USAGE, PRACTICES, HISTORY (args: setup | usage | practices | history | scan)',
      argumentHint: '[setup|usage|practices|history] [scan] | close',
    })
    return next(e)
  })

  on('command.run', { command: 'control' }, async ($, e) => {
    if ((e.args ?? '').trim().toLowerCase() === 'close') {
      for (const key of Object.keys(PANES) as (keyof typeof PANES)[]) await $.ui.close({ id: PANES[key].id })
      return {}
    }
    const { panes, scan: force } = parseArgs(e.args ?? '')
    for (const key of panes) await $.ui.open({ id: PANES[key].id, title: PANES[key].title })
    const { out, stale } = await loadConfig($)
    const usage = await readJson<UsageData>($, `${out}/usage.json`)
    const setup = await readJson<SetupData>($, `${out}/setup.json`)
    const old = isStale(usage?.generated, Date.now(), stale) || isStale(setup?.generated, Date.now(), stale)
    if (force || old) scanSoon($)
    return {
      text:
        `control: opened ${panes.map(k => PANES[k].title).join(', ')}` +
        (setup?.live?.title ? ` · ${setup.live.title}` : '') +
        (force || old ? ` · scanning (data ${ageText(usage?.generated, Date.now())})` : ` · data ${ageText(usage?.generated, Date.now())}`),
    }
  })

  // ------------------------------------------------------------------ SETUP
  on('ui.render', { component: 'Pane', requestId: PANES.setup.id }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, tick)
    const open = await read($, section)
    const { out, L, modStates } = await loadConfig($)
    const data = await readJson<SetupData>($, `${out}/setup.json`)
    const width = Math.max(40, e.props.bodyColumns)
    if (!data) {
      return (
        <Box flexDirection="column">
          {await header($, e)}
          <Text>
            {L('no_data')} {out}/setup.json : {L('press_rescan')}.
          </Text>
        </Box>
      )
    }
    const row = (it: SetupItem, showSection = false) => (
      <Box flexDirection="column" marginBottom={0}>
        <Text>
          <Text bold color={it.hidden ? 'warning' : undefined}>
            {it.hidden ? '⚑ ' : ''}
            {it.name}
          </Text>
          <Text dimColor>
            {showSection && it.section ? ` · ${it.section}` : ''}
            {it.size != null ? ` · ${kb(it.size)}` : ''}
            {it.changed ? ` · ${it.changed}` : ''}
          </Text>
        </Text>
        <Text wrap="wrap">  {cut(it.what, width * 2)}</Text>
        {it.flags.map(f => (
          <Text color={f.kind === 'stale_clause' || f.kind === 'blocker' || f.kind === 'missing' ? 'error' : 'warning'} wrap="wrap">
            {'  '}! {cut(f.text, width * 2)}
          </Text>
        ))}
        <Text dimColor wrap="truncate-start">  {it.path}</Text>
      </Box>
    )
    const flagged = (s: SetupData['sections'][number]) => s.items.filter(it => it.flags.length).length
    const live = data.live
    const mods = data.mods?.items ?? []
    // Same source as the band's Mods button bar: the slash commands registered in this session (local, no model call).
    const cmds = await safe<CommandSeen[]>(
      (async () => (await $.command.list()).map(c => ({ name: c.name, ...(c.plugin ? { plugin: c.plugin } : {}) })))(),
      [],
    )
    return (
      <Box flexDirection="column">
        {await header($, e, data.generated)}
        <Text>
          <Text bold>{L('live')} : </Text>
          <Text bold color="success">
            {live?.title || data.rules_version || L('no_title')}
          </Text>
          {live?.version ? <Text dimColor>{` · ${L('version')} ${live.version}`}</Text> : null}
          {live?.changed ? <Text dimColor>{` · ${L('changed')} ${live.changed}`}</Text> : null}
        </Text>
        {live ? (
          <Text dimColor wrap="wrap">
            {`${L('sources')} : ${live.claude_md} (${live.sections} sections) · env ${live.env_names.join(', ') || '—'} · hooks ${live.settings_hooks} · agents ${live.agents} · skills ${live.skills} · workflows ${live.workflows} · mods ${live.mods_loaded}/${live.mods_total}`}
          </Text>
        ) : null}
        {(data.blockers ?? []).length === 0 ? (
          <Text bold color="success">● {L('blockers_none')}</Text>
        ) : (
          <Box flexDirection="column">
            <Text bold color="error">
              ○ {L('blockers_some')} ({data.active_blockers ?? 0} {L('active')}, {(data.blockers ?? []).length} {L('found')}) : {L('blockers_expect')}
            </Text>
            {(data.blockers ?? []).map(it => row(it))}
          </Box>
        )}
        <Text> </Text>
        <Text bold>
          {L('mods')} ({mods.filter(m => m.state === 'loaded').length}/{mods.length})
        </Text>
        {mods.length === 0 ? <Text dimColor>{L('mods_none')}</Text> : null}
        {mods.map(m => (
          <Text wrap="wrap">
            <Text color={modColor(m.state)}>{modMark(m.state)} </Text>
            <Text bold>{m.name}</Text>
            <Text dimColor>{m.version ? ` ${m.version}` : ''}</Text>
            <Text color={modColor(m.state)}>{` · ${modStates[m.state] ?? m.state}`}</Text>
            {m.state === 'loaded' && inSession(cmds, m.name) ? <Text color="success">{` · ${L('in_session')}`}</Text> : null}
            <Text dimColor>{m.sources.length ? ` (${m.sources.join(', ')})` : ''}{` · ${m.path}`}</Text>
          </Text>
        ))}
        {data.mods?.differ ? <Text color="warning" wrap="wrap">! {L('mods_differ')}</Text> : null}
        <Text> </Text>
        <Text bold color="warning">
          {L('hidden')} ({data.hidden.length}) : {L('hidden_why')}
        </Text>
        {data.hidden.map(it => row(it, true))}
        <Text> </Text>
        <Text bold>{L('sections')}</Text>
        {data.sections.map(s => (
          <Box flexDirection="column">
            <Button
              key={`sec-${s.id}`}
              plain
              onPress={() => void update($, section, cur => (cur === s.id ? '' : s.id))}
            >
              {`${open === s.id ? '▾' : '▸'} ${s.title} (${s.items.length}${flagged(s) ? `, ${flagged(s)} ${L('flagged')}` : ''})`}
            </Button>
            {open === s.id && s.items.map(it => row(it))}
          </Box>
        ))}
      </Box>
    )
  })

  // ------------------------------------------------------------------ USAGE
  on('ui.render', { component: 'Pane', requestId: PANES.usage.id }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, tick)
    const wid = await read($, windowId)
    const { out, L } = await loadConfig($)
    const data = await readJson<UsageData>($, `${out}/usage.json`)
    const w: UsageWindow | undefined = data?.windows.find(x => x.id === wid) ?? data?.windows[0]
    if (!data || !w) {
      return (
        <Box flexDirection="column">
          {await header($, e)}
          <Text>
            {L('no_data')} {out}/usage.json : {L('press_rescan')}.
          </Text>
        </Box>
      )
    }
    const s = w.summary
    const metric = (m: Metric) => (
      <Box flexDirection="column">
        <Text>
          <Text color={stateColor(m.state)}>{stateMark(m.state)} </Text>
          <Text bold>{m.label}: </Text>
          <Text color={stateColor(m.state)}>{metricValue(m.value, m.unit)}</Text>
          <Text dimColor> target {m.target}</Text>
        </Text>
        <Text dimColor wrap="wrap">
          {'   '}
          {m.detail} · {m.rule}
        </Text>
      </Box>
    )
    return (
      <Box flexDirection="column">
        {await header($, e, data.generated)}
        <Box flexDirection="row" gap={1}>
          {data.windows.map((x, i) => (
            <Button
              key={`win-${x.id}`}
              hotkey={String(i + 1)}
              variant={x.id === w.id ? 'primary' : undefined}
              onPress={() => void update($, windowId, () => x.id)}
            >
              {x.label}
            </Button>
          ))}
        </Box>
        <Text dimColor>
          {w.from}h → {w.to}h UTC · {w.days} days · {big(s.turns)} turns · {usd(s.usd)} estimated · main {big(s.main_turns)} / subagents {big(s.sub_turns)}
        </Text>
        <Text> </Text>
        <Text bold>Per model</Text>
        {s.models.map(r => (
          <Text>
            {r.model.padEnd(7)} {big(r.turns).padStart(7)} turns ({pct(r.turns, s.turns)}) · main {big(r.main)} / sub {big(r.sub)} · out {big(r.out)} · cache+in {big(r.cache_in)} · {usd(r.usd)} (main {usd(r.usd_main)}, sub {usd(r.usd_sub)})
          </Text>
        ))}
        <Text bold>Per effort (model effort: turns · $)</Text>
        <Text wrap="wrap">{s.efforts.slice(0, 10).map(r => `${r.key} ${big(r.turns)} · ${usd(r.usd)}`).join('   ')}</Text>
        <Text bold>Delegation</Text>
        <Text wrap="wrap">
          Agent {s.agent.total} calls: {s.agent.with_model} with model ({Object.entries(s.agent.models).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), {s.agent.no_model} without · {s.agent.background} background · {s.agent.worktree} worktree · types {s.agent.types.slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ')}
        </Text>
        <Text wrap="wrap">
          Workflow {s.workflow.runs} runs, {s.workflow.agent_calls} agent() calls, {s.workflow.with_model} with a model ({Object.entries(s.workflow.models).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})
        </Text>
        <Text wrap="wrap">
          Read-only calls: {Object.entries(s.readonly).map(([k, v]) => `${k} ${big(v)}`).join(', ')} · plan mode {s.tools.plan_mode} · /goal {s.tools.goal} · /loop {s.tools.loop} · Monitor {s.tools.monitor} · CronCreate {s.tools.cron} · auto-compactions {s.tools.compact_auto} vs hand-offs {s.tools.handoff} · turns ≥300K {big(s.context.main_300k ?? 0)}
        </Text>
        <Text> </Text>
        <Text bold>
          {L('against_rules')}
          {data.rules_version ? ` (${data.rules_version})` : ''}
        </Text>
        {w.metrics.map(metric)}
        <Text> </Text>
        <Text bold>Top repos by $</Text>
        <Text wrap="wrap">{s.projects.slice(0, 8).map(p => `${p.project.replace(/^[A-Za-z]--/, '')} ${usd(p.usd)}`).join(' · ')}</Text>
        <Text dimColor>Prices are estimates from config.json (cache read 0.1×, write 1.25× input).</Text>
      </Box>
    )
  })

  // ------------------------------------------------------------------ PRACTICES
  on('ui.render', { component: 'Pane', requestId: PANES.practices.id }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    await read($, tick)
    const ref = await read($, showReference)
    const opened = await read($, ruleOpen)
    const { out, L, pane } = await loadConfig($)
    const data = await readJson<PracticesData>($, `${out}/practices.json`)
    if (!data) {
      return (
        <Box flexDirection="column">
          {await header($, e)}
          <Text>
            {L('no_data')} {out}/practices.json : {L('press_rescan')}.
          </Text>
        </Box>
      )
    }
    const list = (title: string, items: string[], color: string) => (
      <Box flexDirection="column">
        <Text bold color={color}>
          {title}
        </Text>
        {items.length ? items.map((x, i) => <Text wrap="wrap">{`${i + 1}. ${x}`}</Text>) : <Text dimColor>—</Text>}
      </Box>
    )
    const ev = (x: Evidence) => (
      <Text wrap="wrap" color={x.state === 'info' ? undefined : stateColor(x.state)} dimColor={x.kind === 'cite'}>
        {'     '}→ {x.kind === 'cite' ? `(${x.text})` : x.text}
      </Text>
    )
    const groupNames = (pane.v6_groups ?? {}) as Record<string, string>
    const v6 = data.v6
    return (
      <Box flexDirection="column">
        {await header($, e, data.generated)}
        <Text>
          <Text bold>{L('practices_title')} : </Text>
          <Text bold color="success">
            {data.rules_version || L('no_title')}
          </Text>
          <Text dimColor>{` · ${L('measured_on')} ${data.window ?? L('no_usage')}`}</Text>
        </Text>
        {v6?.state === 'pending' ? (
          <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
            <Text bold color="warning">
              {L('v6_title')} : {v6.title ?? ''}
            </Text>
            <Text dimColor>{v6.source}</Text>
            {Object.entries(v6.groups ?? {}).map(([g, x]) => (
              <Box flexDirection="column">
                <Text bold>{`${groupNames[g] ?? g} (${x.count})`}</Text>
                {x.items.map(t => (
                  <Text wrap="wrap">{`  · ${t}`}</Text>
                ))}
              </Box>
            ))}
          </Box>
        ) : (
          <Text dimColor>{v6?.state === 'no_repo' ? L('v6_no_repo') : `${L('v6_none')}${v6?.source ? ` (${v6.source})` : ''}`}</Text>
        )}
        <Text> </Text>
        {(data.sections ?? []).map(s => {
          const key = s.num || s.heading
          return (
            <Box flexDirection="column">
              <Button key={`rule-${key}`} plain onPress={() => void update($, ruleOpen, cur => (cur === key ? '' : key))}>
                {`${opened === key ? '▾' : '▸'} ${stateMark(s.state)} §${s.num ? `${s.num} ` : ' '}${s.title} · ${s.lines.length} lignes · ${s.evidence} ${L('evidence')} · ${s.state === 'not measured' ? L('not_measured') : s.state}`}
              </Button>
              {opened === key &&
                s.lines.map(ln => (
                  <Box flexDirection="column">
                    <Text wrap="wrap">
                      <Text color={stateColor(ln.state)}>{`   ${stateMark(ln.state)} `}</Text>
                      {ln.text}
                    </Text>
                    {ln.evidence.map(ev)}
                  </Box>
                ))}
            </Box>
          )
        })}
        <Box flexDirection="row" gap={1}>
          <Button key="to-usage" plain dimColor onPress={() => void $.ui.open({ id: PANES.usage.id, title: PANES.usage.title })}>
            {L('open_usage')}
          </Button>
        </Box>
        <Text> </Text>
        {list(L('best'), data.best, 'success')}
        {list(L('worst'), data.worst, 'error')}
        {list(L('audit_right'), data.audit_right, 'success')}
        {list(L('audit_wrong'), data.audit_wrong, 'error')}
        <Text> </Text>
        <Button key="reference" plain onPress={() => void update($, showReference, v => !v)}>
          {`${ref ? '▾' : '▸'} ${L('reference')}`}
        </Button>
        {ref && (data.reference_md ? <Markdown text={data.reference_md} /> : <Text dimColor>{L('reference_missing')}</Text>)}
      </Box>
    )
  })

  // ------------------------------------------------------------------ HISTORY
  on('ui.render', { component: 'Pane', requestId: PANES.history.id }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    await read($, tick)
    const { out } = await loadConfig($)
    const data = await readJson<PracticesData>($, `${out}/practices.json`)
    return (
      <Box flexDirection="column">
        {await header($, e, data?.generated)}
        {data?.history_md ? (
          <Markdown text={data.history_md} />
        ) : (
          <Text>No history yet: press Rescan (reads docs/HISTORY.md).</Text>
        )}
      </Box>
    )
  })
}
