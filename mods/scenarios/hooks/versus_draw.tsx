// scenarios mod, « Claude vs GPT » tab: the drawing, pure (elements from $.ui.resolve(e), presses through `m`).
// The scatter is a static picture (svg, not clickable); the benchmark buttons stay buttons.
import type { VsFile } from './versus'
import { checkVersus, rowLine, rowsFor, scatterSvg, vsLabels } from './versus'

export type VersusModel = {
  surface: string
  file: VsFile | undefined
  bench: string
  onBench: (id: string) => void | Promise<void>
}

export function drawVersus(ui: any, m: VersusModel): any {
  const { Box, Text, Button, Link } = ui
  const f = m.file
  const L = vsLabels(f)
  const problems = checkVersus(f)
  const benches = f?.benchmarks ?? []
  const b = benches.find(x => x.id === m.bench) ?? benches[0]
  if (!f || !b) {
    return (
      <Box flexDirection="column">
        <Text color="error">{problems[0] ?? 'aucun benchmark dans versus.json'}</Text>
      </Box>
    )
  }
  const rows = rowsFor(f, b.id)
  const Svg = m.surface === 'terminal' ? undefined : ui.Svg
  const confirmed = rows.filter(r => r.confirmed).length
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor wrap="wrap">
        {`Scores et prix lus sur des pages datées (vérifié le ${f.checked ?? '?'}). Coût = ${L.cost} avec ${f.blend?.in ?? 3} in : ${f.blend?.out ?? 1} out. Chaque éditeur mesure sur son propre harnais : comparer à l'intérieur d'un benchmark seulement. « ${L.unconfirmed} » = pas de source lue, jamais un chiffre inventé.`}
      </Text>
      {problems.length ? (
        <Box flexDirection="column">
          {problems.map((p, i) => <Text key={`vp-${i}`} color="warning" wrap="wrap">{`· ${p}`}</Text>)}
        </Box>
      ) : null}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {benches.map(x => (
          <Button key={`vs-${x.id}`} {...(x.id !== b.id ? { plain: true as const } : {})} onPress={() => m.onBench(x.id)}>
            {x.label}
          </Button>
        ))}
      </Box>
      <Text bold>{`${b.label} · ${confirmed} score(s) confirmé(s) sur ${rows.length} ligne(s)`}</Text>
      {b.about ? <Text dimColor wrap="wrap">{b.about}</Text> : null}
      {Svg ? <Svg key={`vs-svg-${b.id}`} source={scatterSvg(f, b.id)} alt={`${b.label} : score selon le coût (Claude en orange, GPT en vert, cercle vide = mesure indépendante)`} /> : null}
      <Box flexDirection="column">
        {rows.map((r, i) => (
          <Box key={`vr-${i}`} flexDirection="column">
            <Text wrap="wrap" {...(r.confirmed ? {} : { dimColor: true })}>
              {`· ${rowLine(L, r)}`}
            </Text>
            <Box flexDirection="row" gap={1}>
              <Text dimColor>{'   '}</Text>
              {r.confirmed && r.score?.source_url ? <Link href={r.score.source_url} label={r.score.source_url} /> : <Text color="warning">{L.unconfirmed}</Text>}
              {r.score?.note ? <Text dimColor wrap="wrap">{r.score.note}</Text> : null}
            </Box>
          </Box>
        ))}
      </Box>
      <Text bold>{L.price}</Text>
      <Box flexDirection="column">
        {(f.models ?? []).map(md => {
          const p = (f.prices ?? []).find(x => x.model === md.id)
          const ok = p && typeof p.in === 'number' && typeof p.out === 'number' && p.source_url
          return (
            <Box key={`vpr-${md.id}`} flexDirection="column">
              <Text wrap="wrap" {...(ok ? {} : { dimColor: true })}>
                {`· ${md.label} · ${ok ? `${p!.in} / ${p!.out}` : L.unconfirmed}${p?.note ? ` · ${p.note}` : ''}${ok ? ` · ${p!.source_date}${p!.date_kind === 'accessed' ? ' (lu)' : ''}` : ''}`}
              </Text>
              {ok ? (
                <Box flexDirection="row" gap={1}>
                  <Text dimColor>{'   '}</Text>
                  <Link href={p!.source_url!} label={p!.source_url!} />
                </Box>
              ) : null}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
