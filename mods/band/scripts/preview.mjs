// band mod: prints the Jauge as text (the terminal's rendering) for an idle and a running conversation, at a given
// width, so a verifier can see the line, the mini bars, the traffic light and the « en cours » rows without Claude Code.
//   node mods/band/scripts/preview.mjs            80 columns
//   node mods/band/scripts/preview.mjs 60 90      several widths
//   node mods/band/scripts/preview.mjs --plain    no ANSI colours
// Invented fixtures only. Colours: green ok, yellow warn, red bad, grey label words (as the band draws them).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cells, fitLine, jaugeCfg } from '../hooks/jauge.ts'
import { ecCfg, enCoursView, rowText } from '../hooks/encours.ts'

const here = dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(readFileSync(join(here, '..', 'band.config.json'), 'utf8'))
const args = process.argv.slice(2)
const plain = args.includes('--plain') || !!process.env.NO_COLOR
const widths = args.filter(a => /^\d+$/.test(a)).map(Number)
if (!widths.length) widths.push(80)

const ANSI = { ok: 32, warn: 33, bad: 31, dim: 90 }
const paint = (text, tone) => (plain || !tone || !ANSI[tone] ? text : `\x1b[${ANSI[tone]}m${text}\x1b[0m`)

const NOW = Date.parse('2026-10-21T14:30:00Z')
const MIN = 60000
const window = 400000
const base = { relayAt: cfg.context.handoff_tokens, relayPct: (cfg.context.handoff_tokens * 100) / window }

// idle: nothing waits, low context, quiet quotas
const idle = { facts: { ...base, waiting: 0, ctxPct: 19, five: 0, week: 41, tps: { tps_all: 380 } }, running: null }
// running: two conversations wait, context past 50 %, the week projected over 100 % at reset, a Workflow and an agent
const running = {
  facts: { ...base, waiting: 2, ctxPct: 57, five: 64, week: 74, weekProj: 108, tps: { tps_all: 4400 } },
  running: {
    workflows: [
      {
        id: 'wf_demo', name: 'demo-release-wave', phases: ['Plan', 'Build', 'Preview', 'Verify', 'Merge'], phase: 'Verify', phaseIdx: 3, status: 'running',
        start: NOW - 47 * MIN, last: NOW - MIN, eta: NOW + 18 * MIN,
        agents: [
          { id: 'a1', type: 'coder', label: 'lane-alpha-identity', model: 'opus', status: 'running', start: NOW - 20 * MIN, last: NOW - MIN },
          { id: 'a2', type: 'tester', label: 'lane-beta', model: 'sonnet', status: 'running', start: NOW - 9 * MIN, last: NOW - 18 * MIN },
        ],
      },
    ],
    agents: [{ id: 'b1', type: 'auditor', label: 'scan', model: 'sonnet', shape: 'background', status: 'running', start: NOW - 3 * MIN, last: NOW }],
  },
}

const jc = jaugeCfg(cfg.jauge)
const ec = ecCfg(cfg.jauge)

function line(facts, cols) {
  const f = fitLine(jc.line1, facts, jc, cols)
  const out = f.line.map(g => g.map(x => (x.value === undefined ? paint(x.text, x.tone) : paint(x.label ?? '', 'dim') + paint(x.text.slice((x.label ?? '').length), x.tone))).join(paint(f.dot, 'dim'))).join(paint(f.sep, 'dim'))
  return { out, w: cells(f.text) }
}

function rows(data, cols) {
  const v = enCoursView(data, ec, cols, NOW)
  const out = v.rows.map(r => ' '.repeat(r.indent) + r.segs.map(s => paint(s.text, s.tone ?? (s.dim ? 'dim' : undefined))).join('') + paint(`   (${cells(rowText(r))})`, 'dim'))
  if (v.more) out.push(paint(`${ec.labels.more.replace('{n}', String(v.more))} · ${ec.labels.cockpit}`, 'dim'))
  return out
}

for (const cols of widths) {
  for (const [name, fx] of [['idle', idle], ['running', running]]) {
    console.log(paint(`── ${name} · ${cols} colonnes ${'─'.repeat(Math.max(0, cols - cells(name) - 16))}`, 'dim'))
    const l = line(fx.facts, cols)
    console.log(`${l.out}${paint(`   (${l.w})`, 'dim')}`)
    for (const r of rows(fx.running, cols)) console.log(r)
  }
}
