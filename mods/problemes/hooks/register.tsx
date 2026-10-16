// problemes mod (« Problèmes »): Julian's persistent register of every error and problem with Claude work.
// /problemes [refresh|close|P-NNN] opens the pane. Figures come from scanner/problemes_scan.mjs (Node, zero tokens):
// it reads new transcript bytes and the desktop app's session files, dedupes hits into problems by signature and
// appends to ~/.claude/problemes/register.jsonl; the pane reads the folded snapshot problems.json. The only write
// from the pane is « Ajouter une note », which runs the scanner's `note` command (local ledger only). The command
// shows a pane and returns no text, so nothing reaches the model; nothing here blocks, rewrites or delays anything.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { applyFilters, appsOf, deepMerge, fill, fmtAge, fmtDate, linksOf, summaryOf, totals, tree } from '../lib/core.mjs'

const PANE = 'problemes'
const statusAtom = atom({ plugin: 'problemes', key: 'status' } as const, 'all')
const weekAtom = atom({ plugin: 'problemes', key: 'week' } as const, 'all')
const categoryAtom = atom({ plugin: 'problemes', key: 'category' } as const, 'all')
const appAtom = atom({ plugin: 'problemes', key: 'app' } as const, 'all')
const openAtom = atom({ plugin: 'problemes', key: 'open' } as const, [] as string[])
const noteAtom = atom({ plugin: 'problemes', key: 'noteMsg' } as const, '')

const S: { busy: boolean; error: string; snap: any } = { busy: false, error: '', snap: undefined }

const home = async ($: EngineInterface) => {
  let v: string | undefined
  try {
    v = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  } catch {}
  return (v ?? '').replace(/\\/g, '/')
}
const readJson = async ($: EngineInterface, path: string): Promise<any> => {
  try {
    return JSON.parse((await $.fs.read(path, { as: 'text' })) as string)
  } catch {
    return undefined
  }
}

async function context($: EngineInterface) {
  const root = $.plugin.root.replace(/\\/g, '/')
  const h = await home($)
  const base = (await readJson($, `${root}/problemes.config.json`)) || {}
  const dataDir = String(base.data_dir || '~/.claude/problemes').replace(/^~(?=[\\/]|$)/, h).replace(/\\/g, '/')
  const cfg = deepMerge(base, (await readJson($, `${dataDir}/problemes.config.json`)) || {})
  return { root, dataDir, cfg }
}

const scanner = (root: string, cfg: any, args: string[]) => [cfg.node || 'node', `${root}/scanner/problemes_scan.mjs`, ...args]

/** Runs the collector in the background and redraws; never awaited by a hook the person waits on. */
async function collect($: EngineInterface, force = false) {
  if (S.busy) return
  S.busy = true
  $.ui.invalidate('ui.render')
  try {
    const { root, cfg } = await context($)
    const r = await $.process.run(scanner(root, cfg, ['collect', ...(force ? ['--force'] : [])]), { timeoutMs: Math.min((cfg.collect_timeout_s ?? 300) * 1000, 600000) })
    if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `collect exit ${r.exitCode}`)
    S.error = ''
    S.snap = undefined
  } catch (err) {
    S.error = String((err as Error)?.message ?? err).slice(0, 300)
  } finally {
    S.busy = false
  }
  $.ui.invalidate('ui.render')
}

async function load($: EngineInterface) {
  const { cfg, dataDir, root } = await context($)
  const snap = S.snap ?? (S.snap = await readJson($, `${dataDir}/problems.json`))
  const now = await $.clock.now()
  const stale = !snap || now - (snap.collected || 0) > (cfg.refresh_min ?? 30) * 60000
  return { cfg, snap, stale, now, root }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'problemes',
      description: 'Problèmes : registre des erreurs et blocages du travail de Claude (questions à Julian, gardes, CI, Workflows), par catégorie et par application',
      argumentHint: '[refresh | P-NNN] | close',
    })
    return next(e)
  })

  on('command.run', { command: 'problemes' }, async ($, e) => {
    const args = String(e.args ?? '').trim()
    if (args.toLowerCase() === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }
    const { cfg, stale, snap } = await load($)
    const refresh = /\brefresh\b/i.test(args)
    const id = args.match(/\bP-\d+\b/i)?.[0]?.toUpperCase()
    if (id) {
      const p = (snap?.problems ?? []).find((x: any) => x.id === id)
      const nodes = p ? [`c:${p.category.split('/')[0]}`, `c:${p.category}`, `p:${id}`] : [`p:${id}`]
      await update($, openAtom, (o: string[]) => [...new Set([...(o ?? []), ...nodes])])
    }
    if (stale || refresh) $.clock.after(0, () => collect($, refresh && /--force/.test(args)))
    await $.ui.open({ id: PANE, title: cfg.labels?.pane_title ?? 'Problèmes' })
    return {} // a pane, no transcript text: nothing for the model to read
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Link } = $.ui.resolve(e) as any
    const { cfg, snap, now, root } = await load($)
    const L = cfg.labels ?? {}
    const C = cfg.colors ?? {}
    const status = S.busy ? L.collecting : ''
    if (!snap) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{fill(L.first, { days: cfg.collect?.backfill_days ?? 14 })}</Text>
          {S.error ? <Text color="error">{`collecte : ${S.error}`}</Text> : null}
          {status ? <Text dimColor>{status}</Text> : null}
        </Box>
      )
    }
    const f = {
      status: (await read($, statusAtom)) as string,
      week: (await read($, weekAtom)) as string,
      category: (await read($, categoryAtom)) as string,
      app: (await read($, appAtom)) as string,
    }
    const open = new Set(((await read($, openAtom)) as string[]) ?? [])
    const noteMsg = (await read($, noteAtom)) as string
    const all: any[] = snap.problems ?? []
    const t = totals(all, now)
    const shown = applyFilters(all, f, now)
    const nodes = tree(shown, cfg.categories ?? [], L)
    const max = cfg.max_problems_per_node ?? 40
    const flip = (id: string) => update($, openAtom, (o: string[]) => (o?.includes(id) ? o.filter(x => x !== id) : [...(o ?? []), id]))
    const chip = (key: string, label: string, active: boolean, press: () => unknown) => (
      <Button key={key} {...(active ? {} : { plain: true as const })} onPress={press}>{label}</Button>
    )
    const statusColor = (s: string) => C[s]
    const stats = snap.stats

    const note = async (id: string, text: string) => {
      const v = String(text ?? '').trim()
      if (!v) return
      try {
        const r = await $.process.run(scanner(root, cfg, ['note', id, v]), { timeoutMs: 30000 })
        if (r.exitCode !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || `exit ${r.exitCode}`)
        S.snap = undefined
        await update($, noteAtom, () => fill(L.note_saved, { id }))
      } catch (err) {
        await update($, noteAtom, () => fill(L.note_failed, { error: String((err as Error)?.message ?? err).slice(0, 200) }))
      }
    }

    const problemRow = (p: any, depth: number, scope: string) => {
      const pid = `p:${p.id}`
      const isOpen = open.has(pid)
      const line = fill(L.problem, { id: p.id, title: p.title, count: p.count, status: p.status })
      const rows: any[] = [
        <Box key={`${scope}-${p.id}`} flexDirection="row" gap={1} paddingLeft={depth}>
          <Text {...(statusColor(p.status) ? { color: statusColor(p.status) } : {})}>●</Text>
          <Button key={`${scope}-${p.id}`} plain onPress={() => flip(pid)}>{`${isOpen ? '▾' : '▸'} ${line}`}</Button>
        </Box>,
      ]
      if (!isOpen) return rows
      const field = (label: string, v: string) => (
        <Text wrap="wrap"><Text bold>{`${label} : `}</Text>{v || L.unknown}</Text>
      )
      const links = [...new Set((p.evidence ?? []).flatMap((ev: any) => linksOf(ev.text)).concat(linksOf(p.fix), linksOf(p.symptom)))].slice(0, 5) as string[]
      rows.push(
        <Box key={`${scope}-${p.id}-d`} flexDirection="column" paddingLeft={depth + 2}>
          {field(L.symptom, p.symptom)}
          {field(L.cause, p.cause)}
          {field(L.fix, p.fix)}
          <Text dimColor wrap="wrap">{`${L.seen} : ${fill(L.seen_line, { first: fmtDate(p.first_seen), last: fmtDate(p.last_seen), count: p.count, source: p.source })}${p.apps?.length ? ` · ${p.apps.join(', ')}` : ''}`}</Text>
          {(p.evidence ?? []).length ? <Text bold>{L.evidence}</Text> : null}
          {(p.evidence ?? []).slice(-5).reverse().map((ev: any, i: number) => (
            <Text key={`${scope}-${p.id}-ev${i}`} dimColor wrap="wrap">{`· ${fmtDate(ev.at)}${ev.session ? ` · session ${String(ev.session).slice(0, 8)}` : ''}${ev.title ? ` · ${ev.title}` : ''}${ev.file && !ev.session ? ` · ${String(ev.file).split('/').pop()}` : ''}${ev.text ? ` · ${ev.text}` : ''}`}</Text>
          ))}
          {links.map((u, i) => <Link key={`${scope}-${p.id}-l${i}`} href={u} label={u} />)}
          {(p.timeline ?? []).length ? <Text bold>{L.timeline}</Text> : null}
          {(p.timeline ?? []).length ? <Text dimColor wrap="wrap">{(p.timeline ?? []).slice(-12).map((x: any) => `${fmtDate(x.at)} ×${x.n}`).join(' · ')}</Text> : null}
          {(p.notes ?? []).length ? <Text bold>{L.notes}</Text> : null}
          {(p.notes ?? []).map((n: any, i: number) => <Text key={`${scope}-${p.id}-n${i}`} wrap="wrap">{`· ${fmtDate(n.at)} · ${n.text}`}</Text>)}
          <Input key={`note-${p.id}`} label={`${L.note_label} : `} placeholder={L.note_placeholder} submitLabel={L.note_submit} onSubmit={(v: string) => void note(p.id, v)} />
        </Box>,
      )
      return rows
    }

    const nodeRows = (n: any, depth: number): any[] => {
      const id = `c:${n.id}`
      const isOpen = open.has(id)
      const rows: any[] = [
        <Box key={`n-${n.id}`} flexDirection="column" paddingLeft={depth}>
          <Box flexDirection="row" gap={1}>
            <Text {...(n.open ? { color: C['ouvert'] } : { dimColor: true })}>{n.open ? '●' : '○'}</Text>
            <Button key={`cat-${n.id}`} plain onPress={() => flip(id)}>{`${isOpen ? '▾' : '▸'} ${fill(L.node, { label: n.label, open: n.open, total: n.total })}`}</Button>
          </Box>
          {!isOpen ? <Text dimColor wrap="truncate">{`  ${summaryOf(n, 2, L.empty)}`}</Text> : null}
          {isOpen && n.cross ? <Text dimColor>{`  ${L.cross}`}</Text> : null}
        </Box>,
      ]
      if (!isOpen) return rows
      for (const ch of n.children ?? []) rows.push(...nodeRows(ch, depth + 2))
      for (const p of (n.problems ?? []).slice(0, max)) rows.push(...problemRow(p, depth + 2, n.id))
      if ((n.problems ?? []).length > max) rows.push(<Text key={`more-${n.id}`} dimColor>{`${' '.repeat(depth + 2)}${fill(L.more, { n: n.problems.length - max })}`}</Text>)
      return rows
    }

    const statuses = Object.entries(L.status_names ?? {}) as [string, string][]
    const weeks = Object.entries(L.week_names ?? {}) as [string, string][]
    const tops = (cfg.categories ?? []).filter((c: any) => !c.dynamic)
    const apps = appsOf(all).slice(0, L.apps_max ?? 12)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{fill(L.top, t)}</Text>
          <Text dimColor wrap="wrap">{fill(L.subtitle, { age: fmtAge(snap.collected, now), occ: t.week_seen }) + (status ? ` · ${status}` : '')}</Text>
          {S.error ? <Text color="error">{`collecte : ${S.error}`}</Text> : null}
          {stats ? <Text dimColor wrap="wrap">{fill(L.collect_stats, stats)}</Text> : null}
        </Box>

        <Box flexDirection="column">
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text dimColor>{`${L.f_status} :`}</Text>
            {chip('f-status-all', L.all, f.status === 'all', () => update($, statusAtom, () => 'all'))}
            {statuses.map(([k, label]) => chip(`f-status-${k}`, label, f.status === k, () => update($, statusAtom, () => k)))}
            <Button key="refresh" plain onPress={() => { $.clock.after(0, () => collect($)) }}>{L.refresh ?? '↻'}</Button>
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text dimColor>{`${L.f_week} :`}</Text>
            {weeks.map(([k, label]) => chip(`f-week-${k}`, label, f.week === k, () => update($, weekAtom, () => k)))}
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text dimColor>{`${L.f_category} :`}</Text>
            {chip('f-cat-all', L.all, f.category === 'all', () => update($, categoryAtom, () => 'all'))}
            {tops.map((c: any) => chip(`f-cat-${c.id}`, c.label, f.category === c.id, () => update($, categoryAtom, () => c.id)))}
          </Box>
          {apps.length ? (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Text dimColor>{`${L.f_app} :`}</Text>
              {chip('f-app-all', L.all, f.app === 'all', () => update($, appAtom, () => 'all'))}
              {apps.map(([a, n]) => chip(`f-app-${a}`, `${a} (${n})`, f.app === a, () => update($, appAtom, () => a)))}
            </Box>
          ) : null}
        </Box>
        {noteMsg ? <Text dimColor>{noteMsg}</Text> : null}

        {!all.length ? <Text dimColor>{L.empty_ledger}</Text> : null}
        <Box flexDirection="column">
          {nodes.flatMap(n => nodeRows(n, 0))}
        </Box>

        <Box flexDirection="column">
          {(L.notes_doc ?? []).map((x: string, i: number) => <Text key={`doc-${i}`} dimColor wrap="wrap">{`· ${x}`}</Text>)}
        </Box>
      </Box>
    )
  })
}
