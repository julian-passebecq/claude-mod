// control mod: three panes over the JSON that scanner/control_scan.py writes (config.json says where).
//   SETUP      everything that shapes a session, hidden rules first
//   USAGE      1/7/30-day and 2-9 Oct model, effort and delegation mix, each metric against its rule target
//   PRACTICES  our way of working from ~/.claude/CLAUDE.md (V5) and the 9 Oct audit, followed or not; docs/PRACTICES.md
//   HISTORY    docs/HISTORY.md: every rule version V1-V4.9 and why it was dropped
// /control opens all four (or `/control usage`), `/control scan` rescans first. Drawing never runs the scanner:
// scans start from the command or a Rescan button, on a timer so they outlive the dispatch.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import type { Metric, PracticesData, SetupData, SetupItem, UsageData, UsageWindow } from '../types'
import {
  PANES,
  ageText,
  big,
  cut,
  expandHome,
  isStale,
  kb,
  metricValue,
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

type Config = { paths: { out_dir: string }; scan: { stale_minutes: number; windows: { id: string; label: string }[] } }

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
  const cfg = await readJson<Config>($, `${root($)}/config.json`)
  const home = (await safe($.env.get('USERPROFILE'), undefined)) ?? (await safe($.env.get('HOME'), undefined)) ?? ''
  const out = expandHome(cfg?.paths.out_dir ?? '~/.claude/effort-board/control', home)
  return { cfg, out, stale: cfg?.scan.stale_minutes ?? 60 }
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
        {busy ? 'scanning…' : `scanned ${ageText(generated, Date.now())}`}
        {problem ? ` · last scan failed: ${problem}` : ''}
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
      description: 'Claude Control panes: SETUP, USAGE, PRACTICES, HISTORY (args: setup | usage | practices | history | scan)',
      argumentHint: '[setup|usage|practices|history] [scan]',
    })
    return next(e)
  })

  on('command.run', { command: 'control' }, async ($, e) => {
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
        (force || old ? ` · scanning (data ${ageText(usage?.generated, Date.now())})` : ` · data ${ageText(usage?.generated, Date.now())}`),
    }
  })

  // ------------------------------------------------------------------ SETUP
  on('ui.render', { component: 'Pane', requestId: PANES.setup.id }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, tick)
    const open = await read($, section)
    const { out } = await loadConfig($)
    const data = await readJson<SetupData>($, `${out}/setup.json`)
    const width = Math.max(40, e.props.bodyColumns)
    if (!data) {
      return (
        <Box flexDirection="column">
          {await header($, e)}
          <Text>No setup.json yet in {out}: press Rescan.</Text>
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
          <Text color={f.kind === 'stale_clause' || f.kind === 'blocker' ? 'error' : 'warning'} wrap="wrap">
            {'  '}! {cut(f.text, width * 2)}
          </Text>
        ))}
        <Text dimColor wrap="truncate-start">  {it.path}</Text>
      </Box>
    )
    const flagged = (s: SetupData['sections'][number]) => s.items.filter(it => it.flags.length).length
    return (
      <Box flexDirection="column">
        {await header($, e, data.generated)}
        <Text bold>{data.rules_version}</Text>
        {(data.blockers ?? []).length === 0 ? (
          <Text bold color="success">● Blockers: none (V5 §6: no hook, mod or script blocks or rewrites a tool call)</Text>
        ) : (
          <Box flexDirection="column">
            <Text bold color="error">
              ○ Blockers ({data.active_blockers ?? 0} active, {(data.blockers ?? []).length} found): V5 §6 expects none
            </Text>
            {(data.blockers ?? []).map(it => row(it))}
          </Box>
        )}
        <Text> </Text>
        <Text bold color="warning">
          Hidden rules ({data.hidden.length}): they change behaviour without being in CLAUDE.md
        </Text>
        {data.hidden.map(it => row(it, true))}
        <Text> </Text>
        <Text bold>Sections (press one to list it)</Text>
        {data.sections.map(s => (
          <Box flexDirection="column">
            <Button
              key={`sec-${s.id}`}
              plain
              onPress={() => void update($, section, cur => (cur === s.id ? '' : s.id))}
            >
              {`${open === s.id ? '▾' : '▸'} ${s.title} (${s.items.length}${flagged(s) ? `, ${flagged(s)} flagged` : ''})`}
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
    const { out } = await loadConfig($)
    const data = await readJson<UsageData>($, `${out}/usage.json`)
    const w: UsageWindow | undefined = data?.windows.find(x => x.id === wid) ?? data?.windows[0]
    if (!data || !w) {
      return (
        <Box flexDirection="column">
          {await header($, e)}
          <Text>No usage.json yet in {out}: press Rescan.</Text>
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
        <Text bold>Against the rules (V4.8 routing, V4.9)</Text>
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
    const { out } = await loadConfig($)
    const data = await readJson<PracticesData>($, `${out}/practices.json`)
    if (!data) {
      return (
        <Box flexDirection="column">
          {await header($, e)}
          <Text>No practices.json yet in {out}: press Rescan.</Text>
        </Box>
      )
    }
    const list = (title: string, items: string[], color: string) => (
      <Box flexDirection="column">
        <Text bold color={color}>
          {title}
        </Text>
        {items.length ? items.map((x, i) => <Text wrap="wrap">{`${i + 1}. ${x}`}</Text>) : <Text dimColor>none</Text>}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {await header($, e, data.generated)}
        <Text dimColor>
          {data.rules_version} · measured on {data.window ?? 'no usage data'}
        </Text>
        {data.practices.map(p => (
          <Box flexDirection="column">
            <Text>
              <Text color={stateColor(p.state)}>{stateMark(p.state)} </Text>
              <Text bold>{p.title}</Text>
              <Text dimColor> · {p.state}</Text>
            </Text>
            <Text dimColor wrap="wrap">
              {'   '}rule: {p.rule_line}
            </Text>
            {p.evidence.map(x => (
              <Text wrap="wrap">
                {'   '}→ {x}
              </Text>
            ))}
          </Box>
        ))}
        <Box flexDirection="row" gap={1}>
          <Button key="to-usage" plain dimColor onPress={() => void $.ui.open({ id: PANES.usage.id, title: PANES.usage.title })}>
            Open USAGE for the numbers
          </Button>
        </Box>
        <Text> </Text>
        {list('5 best habits (measured)', data.best, 'success')}
        {list('5 worst habits (measured)', data.worst, 'error')}
        {list('Audit 9 Oct: what we do right', data.audit_right, 'success')}
        {list('Audit 9 Oct: what we do wrong', data.audit_wrong, 'error')}
        <Text> </Text>
        <Button key="reference" plain onPress={() => void update($, showReference, v => !v)}>
          {`${ref ? '▾' : '▸'} Reference: docs/PRACTICES.md (good and bad practices with evidence, Anthropic guidance)`}
        </Button>
        {ref && (data.reference_md ? <Markdown text={data.reference_md} /> : <Text dimColor>docs/PRACTICES.md not found</Text>)}
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
