// scenarios mod: the pane's drawing, pure. No `$`: the elements come in as `ui` ($.ui.resolve(e)) and every action as a
// callback in `m`, so the scenarios pane and the Référence hub (mods/reference, a synced copy of this file) draw the
// same tree. Same output as the drawing that lived in register.tsx, plus « Appliquer ce scénario » and its diff.
import type { Catalog } from '../types'
import type { Applied, DiffLine } from './apply'
import { diffSummary } from './apply'
import { KINDS, KIND_LABEL, limitsFor, roleLine, settingsFor, snippet } from './logic'
import type { Kind } from './logic'

export type ScenariosModel = {
  catalog: Catalog
  errors: string[]
  warnings: string[]
  selected: string
  kind: Kind
  copied: string
  /** applied.json and its diff vs the agent files and settings, when one was written */
  applied?: { record: Applied; diff: DiffLine[] } | undefined
  /** outcome of the last « Appliquer » press */
  applyMsg?: string
  onSelect: (id: string) => void | Promise<void>
  onKind: (k: Kind) => void | Promise<void>
  onCopy: (text: string, label: string, press: any) => void | Promise<void>
  onApply?: (id: string) => void | Promise<void>
}

export const kindsOf = (c: Catalog): Kind[] => {
  const listed = c.snippets.filter((k): k is Kind => (KINDS as readonly string[]).includes(k))
  return listed.length ? listed : [...KINDS]
}

export function drawScenarios(ui: any, m: ScenariosModel): any {
  const { Box, Text, Button, Code, Link } = ui
  const { catalog, errors, warnings } = m
  const s = catalog.scenarios.find(x => x.id === m.selected) ?? catalog.scenarios[0]
  const k = m.kind || 'prompt'
  const kinds = kindsOf(catalog)
  const url = (key: string) => catalog.sources[key] ?? ''
  const cite = (key: string, verified = true) => (
    <Box flexDirection="row" gap={1}>
      {verified ? null : <Text color="warning">non vérifié</Text>}
      {url(key) ? <Link href={url(key)} label={url(key)} /> : <Text dimColor>no source</Text>}
    </Box>
  )
  const ap = m.applied

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
          <Button key={`sc-${x.id}`} {...(x.id !== s?.id ? { plain: true as const } : {})} onPress={() => m.onSelect(x.id)}>
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
              <Button key={`kind-${x}`} {...(x !== k ? { plain: true as const } : {})} onPress={() => m.onKind(x)}>
                {KIND_LABEL[x]}
              </Button>
            ))}
          </Box>
          <Code source={snippet(catalog, s, k)} language={k === 'frontmatter' ? 'yaml' : k === 'prompt' ? 'text' : 'javascript'} />
          <Box flexDirection="row" gap={1}>
            <Button key="copy" hotkey="c" onPress={(press: any) => m.onCopy(snippet(catalog, s, k), `${s.id} ${KIND_LABEL[k]}`, press)}>
              Copy snippet
            </Button>
            {m.copied ? <Text dimColor>{m.copied}</Text> : null}
          </Box>
          {m.onApply ? (
            <Box flexDirection="column">
              <Text bold>Appliquer ce scénario</Text>
              <Text dimColor wrap="wrap">
                Écrit les modèles et efforts de chaque rôle dans ~/.claude/scenarios/applied.json (le précédent reste dans applied.prev.json) et montre l'écart avec tes agents et settings. Ne modifie jamais settings.json, les agents ni l'environnement.
              </Text>
              <Box flexDirection="row" gap={1}>
                <Button key="apply" onPress={() => m.onApply!(s.id)}>{`Appliquer ${s.id}`}</Button>
                {m.applyMsg ? <Text dimColor>{m.applyMsg}</Text> : null}
              </Box>
            </Box>
          ) : null}
        </Box>
      )}
      {ap ? (
        <Box flexDirection="column">
          <Text bold>{diffSummary(ap.record, ap.diff)}</Text>
          {ap.diff.map((d, i) => (
            <Text key={`diff-${i}`} wrap="wrap" {...(d.same ? { dimColor: true } : { color: 'warning' as const })}>
              {`${d.same ? '  =' : '  ≠'} ${d.role} · ${d.where} · ${d.field} : ${d.current}${d.same ? '' : ` → ${d.applied}`}`}
            </Text>
          ))}
          <Text dimColor wrap="wrap">{ap.record.note}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
