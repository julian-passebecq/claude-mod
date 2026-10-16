// Rewrites the test kit's copies of the data files after an edit (the kit has no file system beneath it):
// scenarios.json -> tests/shipped.ts, versus.json -> tests/versus_shipped.ts.
// node mods/scenarios/scripts/regen-shipped.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const copies = [
  ['../scenarios.json', '../tests/shipped.ts', 'SHIPPED'],
  ['../versus.json', '../tests/versus_shipped.ts', 'VERSUS'],
]
for (const [src, dst, name] of copies) {
  const json = new URL(src, import.meta.url)
  const ts = new URL(dst, import.meta.url)
  const head = existsSync(ts)
    ? readFileSync(ts, 'utf8').split('\n').filter(l => l.startsWith('//')).join('\n')
    : `// Copy of ${src.slice(3)} for the test kit, which has no file system beneath it.\n// tests/versus.test.mjs fails when this copy drifts from ${src.slice(3)}.`
  writeFileSync(ts, `${head}\nexport const ${name} = ${JSON.stringify(JSON.stringify(JSON.parse(readFileSync(json, 'utf8'))))}\n`)
}
