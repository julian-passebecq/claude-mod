// reference mod: drawing of the tabs « À essayer », « R&D » and « Repos », pure. No `$`: elements come in as `ui`
// ($.ui.resolve(e)), data from scanner/rd_scan.mjs, every action as a callback that runs only on Julian's click.
import { STATES, sections } from '../lib/rd/essais.mjs'
import { stateLine, updateBlocker } from '../lib/rd/repos.mjs'

type L = Record<string, string>
const lab = (l: L, k: string, d: string) => l[k] ?? d

export function ago(ms: number, now: number): string {
  if (!ms) return '—'
  const m = Math.max(0, Math.round((now - ms) / 60000))
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} j`
}

const busyLine = (ui: any, l: L, busy: string, msg: string) => {
  const { Text } = ui
  return [
    busy ? <Text key="rd-busy" dimColor>{`${lab(l, 'busy', 'en cours…')} (${busy})`}</Text> : null,
    msg ? <Text key="rd-msg" dimColor>{msg}</Text> : null,
  ]
}

// ---- À essayer -----------------------------------------------------------------------------------------------------

export type EssaisModel = {
  data: any
  error: string
  busy: string
  msg: string
  open: string[]
  labels: L
  max: number
  onState: (id: string, state: string) => void
  onFold: (state: string) => void
  onRefresh: () => void
}

export function drawEssais(ui: any, m: EssaisModel): any {
  const { Box, Text, Button } = ui
  const l = m.labels
  if (!m.data) {
    return (
      <Box flexDirection="column">
        <Text>{m.error ? `scan : ${m.error}` : lab(l, 'busy', 'en cours…')}</Text>
      </Box>
    )
  }
  const items = m.data.items || []
  const counts = STATES.map(s => `${items.filter((i: any) => i.state === s).length} ${lab(l, `state_${s}`, s)}`).join(' · ')
  const item = (i: any) => (
    <Box key={`ess-${i.id}`} flexDirection="column" marginLeft={2} marginBottom={1}>
      <Box flexDirection="row" gap={1}>
        <Button key={`ess-state-${i.id}`} plain onPress={() => m.onState(i.id, i.state)}>{`● ${lab(l, `state_${i.state}`, i.state)} ▸`}</Button>
        <Text bold wrap="wrap">{i.name}</Text>
      </Box>
      <Text dimColor wrap="truncate-end">{`${i.doc}${i.section ? ` › ${i.section}` : ''}${i.own ? ' · ton choix' : i.why ? ` · ${i.why}` : ''}`}</Text>
      {i.what ? <Text wrap="wrap">{i.what}</Text> : null}
      {i.test ? <Text wrap="wrap">{`${lab(l, 'test', 'test')} : ${i.test}`}</Text> : null}
      {[i.cost && `${lab(l, 'cost', 'coût')} : ${i.cost}`, i.risk && `${lab(l, 'risk', 'risque')} : ${i.risk}`, i.interest && `${lab(l, 'interest', 'intérêt')} : ${i.interest}`].filter(Boolean).length
        ? <Text dimColor wrap="wrap">{[i.cost && `${lab(l, 'cost', 'coût')} : ${i.cost}`, i.risk && `${lab(l, 'risk', 'risque')} : ${i.risk}`, i.interest && `${lab(l, 'interest', 'intérêt')} : ${i.interest}`].filter(Boolean).join(' · ')}</Text>
        : null}
      {i.alternative ? <Text wrap="wrap">{`${lab(l, 'alternative', 'plutôt')} : ${i.alternative}`}</Text> : null}
    </Box>
  )
  const secs = sections(items).map(s => {
    const unfolded = m.open.includes(s.state)
    const shown = s.items.slice(0, m.max)
    return (
      <Box key={`ess-sec-${s.state}`} flexDirection="column">
        <Button key={`ess-fold-${s.state}`} plain onPress={() => m.onFold(s.state)}>{`${unfolded ? '▾' : '▸'} ${lab(l, `sec_${s.state}`, s.state)} (${s.items.length})`}</Button>
        {unfolded ? shown.map(item) : null}
        {unfolded && s.items.length > shown.length ? <Text dimColor>{`  +${s.items.length - shown.length}`}</Text> : null}
      </Box>
    )
  })
  const todo = m.data.todo || []
  const todoOpen = m.open.includes('todo')
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text bold>{`${items.length} ${lab(l, 'ideas', 'idées')}`}</Text>
        <Text dimColor>{counts}</Text>
        <Button key="ess-refresh" plain onPress={m.onRefresh}>{lab(l, 'refresh_btn', '↻')}</Button>
      </Box>
      {(m.data.missing || []).length ? <Text color="warning">{`${lab(l, 'missing_dir', 'introuvable')} : ${m.data.missing.join(', ')}`}</Text> : null}
      {busyLine(ui, l, m.busy, m.msg)}
      {secs}
      <Box flexDirection="column">
        <Button key="ess-fold-todo" plain onPress={() => m.onFold('todo')}>{`${todoOpen ? '▾' : '▸'} ${lab(l, 'todo', "Ce qu'on doit tester")} (${todo.length})`}</Button>
        {todoOpen
          ? todo.map((t: any, k: number) => (
              <Box key={`ess-todo-${k}`} flexDirection="column" marginLeft={2}>
                <Text wrap="wrap">{`${t.date ? `${t.date} · ` : ''}${t.project ? `${t.project} : ` : ''}${t.what}`}</Text>
                {t.how ? <Text dimColor wrap="wrap">{`${t.src === 'manual' ? 'manual-checks' : 'tests réels'} · ${t.how}`}</Text> : null}
              </Box>
            ))
          : null}
      </Box>
    </Box>
  )
}

// ---- R&D -----------------------------------------------------------------------------------------------------------

export type RdModel = {
  data: any
  ideas: Record<string, Record<string, number>>
  error: string
  busy: string
  msg: string
  labels: L
  onOpen: (path: string) => void
  onExportEta: () => void
  onAudit: () => void
  onRefresh: () => void
}

export function drawRd(ui: any, m: RdModel): any {
  const { Box, Text, Button } = ui
  const l = m.labels
  const head = (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      <Button key="rd-export" onPress={m.onExportEta}>{lab(l, 'export_eta', 'Exporter vers eta')}</Button>
      <Button key="audit-export" plain onPress={m.onAudit}>{lab(l, 'audit_export', 'Exporter pour audit')}</Button>
      <Button key="rd-refresh" plain onPress={m.onRefresh}>{lab(l, 'refresh_btn', '↻')}</Button>
    </Box>
  )
  if (!m.data) {
    return (
      <Box flexDirection="column">
        {head}
        <Text>{m.error ? `scan : ${m.error}` : lab(l, 'busy', 'en cours…')}</Text>
      </Box>
    )
  }
  let n = 0
  const groups = (m.data.groups || []).map((g: any, gi: number) => (
    <Box key={`rd-g-${gi}`} flexDirection="column" marginTop={1}>
      <Text bold>{`${g.label} (${g.docs.length})`}</Text>
      {g.missing ? <Text dimColor>{`${lab(l, 'missing_dir', 'dossier introuvable')} : ${g.path || lab(l, 'no_path', 'chemin non réglé')}`}</Text> : null}
      {g.docs.map((d: any) => {
        const k = n++
        const ideas = m.ideas[d.name]
        const ideasText = ideas ? Object.entries(ideas).map(([s, c]) => `${c} ${lab(l, `state_${s}`, s)}`).join(' · ') : ''
        return (
          <Box key={`rd-d-${k}`} flexDirection="column" marginLeft={2} marginBottom={1}>
            <Box flexDirection="row" gap={1}>
              <Text bold wrap="wrap">{`${d.date} · ${d.subject}`}</Text>
              <Button key={`rd-open-${k}`} plain onPress={() => m.onOpen(d.path)}>{lab(l, 'open', 'Ouvrir')}</Button>
            </Box>
            {(d.summary || []).map((s: string, si: number) => <Text key={`rd-s-${k}-${si}`} dimColor wrap="wrap">{s}</Text>)}
            <Text dimColor wrap="truncate-end">{[d.file, d.sources?.count ? `${d.sources.count} sources (${d.sources.hosts.join(', ')})` : 'sans lien', ideasText && `${lab(l, 'ideas', 'idées')} : ${ideasText}`].filter(Boolean).join(' · ')}</Text>
          </Box>
        )
      })}
    </Box>
  ))
  return (
    <Box flexDirection="column">
      {head}
      {busyLine(ui, l, m.busy, m.msg)}
      {groups}
    </Box>
  )
}

// ---- Repos ---------------------------------------------------------------------------------------------------------

export type ReposModel = {
  data: any
  error: string
  busy: string
  msg: string
  labels: L
  now: number
  onUpdate: (name: string) => void
  onExport: (repo: any) => void
  onFolder: (path: string) => void
  onRefresh: () => void
}

export function drawRepos(ui: any, m: ReposModel): any {
  const { Box, Text, Button, Link } = ui
  const l = m.labels
  const head = (
    <Box flexDirection="row" gap={1}>
      <Text bold>{lab(l, 'tab_repos', 'Repos')}</Text>
      <Button key="repos-refresh" plain onPress={m.onRefresh}>{lab(l, 'refresh_btn', '↻')}</Button>
    </Box>
  )
  if (!m.data) {
    return (
      <Box flexDirection="column">
        {head}
        <Text>{m.error ? `scan : ${m.error}` : lab(l, 'busy', 'en cours…')}</Text>
      </Box>
    )
  }
  const card = (r: any) => {
    const blocker = updateBlocker(r)
    const gh = r.github ? `https://github.com/${r.github}` : ''
    return (
      <Box key={`repo-${r.name}`} flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
        <Text bold>{r.name}</Text>
        <Text dimColor wrap="truncate-end">{r.path || lab(l, 'no_path', 'chemin non réglé')}</Text>
        <Text>{r.path ? stateLine(r) : lab(l, 'no_path', 'chemin non réglé')}</Text>
        {r.last ? <Text wrap="truncate-end">{`${r.last.sha} ${r.last.subject} · ${ago(r.last.at, m.now)}`}</Text> : null}
        {r.prs === null || r.prs === undefined
          ? (r.prsError ? <Text dimColor>{`PR : ${r.prsError}`}</Text> : null)
          : r.prs.length
            ? (
                <Box flexDirection="column">
                  <Text>{`${lab(l, 'prs', 'PR ouvertes')} (${r.prs.length})`}</Text>
                  {r.prs.map((p: any) => (
                    <Box key={`repo-pr-${r.name}-${p.number}`} flexDirection="row" gap={1} marginLeft={2}>
                      {Link && p.url ? <Link href={p.url}>{`#${p.number}`}</Link> : <Text>{`#${p.number}`}</Text>}
                      <Text wrap="truncate-end">{p.title}</Text>
                    </Box>
                  ))}
                </Box>
              )
            : <Text dimColor>{lab(l, 'no_prs', 'aucune PR ouverte')}</Text>}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {r.exists ? <Button key={`repo-update-${r.name}`} {...(blocker ? { plain: true as const } : {})} onPress={() => m.onUpdate(r.name)}>{lab(l, 'update', 'Mettre à jour')}</Button> : null}
          <Button key={`repo-export-${r.name}`} plain onPress={() => m.onExport(r)}>{lab(l, 'export', 'Exporter')}</Button>
          {gh && Link ? <Link href={gh}>{lab(l, 'github', 'Ouvrir sur GitHub')}</Link> : null}
          {r.exists ? <Button key={`repo-open-${r.name}`} plain onPress={() => m.onFolder(r.path)}>{lab(l, 'folder', 'Dossier')}</Button> : null}
        </Box>
        {r.exists && blocker ? <Text dimColor>{`${lab(l, 'update', 'Mettre à jour')} : ${blocker}`}</Text> : null}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {head}
      {busyLine(ui, l, m.busy, m.msg)}
      {(m.data.repos || []).map(card)}
    </Box>
  )
}
