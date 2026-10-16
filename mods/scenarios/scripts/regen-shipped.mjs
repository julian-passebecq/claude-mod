// Rewrites mods/scenarios/tests/shipped.ts (the test kit's copy of scenarios.json) after an edit of scenarios.json,
// node mods/scenarios/scripts/regen-shipped.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const json = new URL('../scenarios.json', import.meta.url)
const ts = new URL('../tests/shipped.ts', import.meta.url)
const head = readFileSync(ts, 'utf8').split('\n').filter(l => l.startsWith('//')).join('\n')
writeFileSync(ts, `${head}\nexport const SHIPPED = ${JSON.stringify(JSON.stringify(JSON.parse(readFileSync(json, 'utf8'))))}\n`)
