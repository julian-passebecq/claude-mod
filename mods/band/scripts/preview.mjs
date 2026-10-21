// band mod: prints the Jauge as text (the terminal's rendering) for an idle, a running, a stale-CI and a busy
// conversation past the relay, at given widths, so a verifier can see the activity status (« ✓ au repos » /
// « ▶ 1 conv · 0 wf · 0 ag · 0 CI »), the line and its wrap onto a second row, the relay (red « relais conseillé » chip
// or [RESUME] alone), the mini bars, the traffic light and the « en cours » rows without Claude Code.
//   node mods/band/scripts/preview.mjs                  80 columns
//   node mods/band/scripts/preview.mjs --cols 40,50,60  several widths (also: --cols=52, or bare numbers: 60 90)
//   node mods/band/scripts/preview.mjs --plain          no ANSI colours
// Invented fixtures only. Colours: green ok, yellow warn, red bad, grey label words (as the band draws them).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cells, jaugeCfg, layoutJauge, relayText } from '../hooks/jauge.ts'
import { ecCfg, enCoursView, rowText } from '../hooks/encours.ts'

const here = dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(readFileSync(join(here, '..', 'band.config.json'), 'utf8'))
const args = process.argv.slice(2)
const plain = args.includes('--plain') || !!process.env.NO_COLOR
const widths = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  const v = a === '--cols' ? args[++i] : a.startsWith('--cols=') ? a.slice(7) : /^\d+$/.test(a) ? a : undefined
  if (v !== undefined) widths.push(...String(v).split(',').map(Number).filter(n => n > 0))
}
if (!widths.length) widths.push(80)

const ANSI = { ok: 32, warn: 33, bad: 31, dim: 90 }
const paint = (text, tone) => (plain || !tone || !ANSI[tone] ? text : `\x1b[${ANSI[tone]}m${text}\x1b[0m`)

const NOW = Date.parse('2026-10-21T14:30:00Z')
const MIN = 60000
const window = 400000
const base = { relayAt: cfg.context.handoff_tokens, relayPct: (cfg.context.handoff_tokens * 100) / window }

// idle: nothing runs anywhere (« ✓ au repos »), nothing waits, low context, quiet quotas
const ciFresh = { running: 0, failed: 0, stale: false }
const idle = { facts: { ...base, waiting: 0, ctxPct: 19, five: 0, week: 41, tps: { tps_all: 380 }, act: { convs: 0, workflows: 0, agents: 0, ci: ciFresh } }, running: null }
// busy main thread only: a turn running for 28 s, nothing else; the ci cache is 40 min old (« CI ? » grey)
const staleCi = { facts: { ...base, waiting: 0, ctxPct: 22, five: 4, week: 41, tps: { tps_all: 900 }, act: { convs: 1, workflows: 0, agents: 0, ci: { running: 0, failed: 0, stale: true } } }, running: null }
// running: two conversations wait, context past 50 %, the week projected over 100 % at reset, a Workflow and an agent
const running = {
  facts: { ...base, waiting: 2, ctxPct: 57, five: 64, week: 74, weekProj: 108, tps: { tps_all: 4400 }, act: { convs: 2, workflows: 1, agents: 3, wfTone: 'ok', agTone: 'warn', ci: { running: 1, failed: 0, stale: false } } },
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

// busy (Julian's case, 22 Oct): 7 conversations, a Workflow, 3 agents, the CI cache too old, context 63 % past the relay
const busy = {
  facts: { ...base, waiting: 0, ctxPct: 63, five: 2, week: 77, tps: { tps_all: 2100 }, act: { convs: 7, workflows: 1, agents: 3, ci: { running: 0, failed: 0, stale: true } } },
  running: null,
  relay: true,
}

const jc = jaugeCfg(cfg.jauge)
const relayOf = fx => (fx.relay ? { hint: jc.labels.relay_hint ?? 'relais conseillé', button: jc.labels.relay_button ?? 'RESUME', mark: jc.labels.relay_mark ?? '●' } : undefined)
const ec = ecCfg(cfg.jauge)

/** The Jauge's rows as the terminal draws them: fields, then on row 1 the relay (red chip and [RESUME], or [RESUME]). */
function lines(fx, cols) {
  const relay = relayOf(fx)
  const lay = layoutJauge(jc.line1, fx.facts, jc, cols, relay)
  return lay.rows.map((f, ri) => {
    let out = f.line.map(g => g.map(x => (x.value === undefined ? paint(x.text, x.tone) : paint(x.label ?? '', 'dim') + paint(x.text.slice((x.label ?? '').length), x.tone))).join(paint(f.dot, 'dim'))).join(paint(f.sep, 'dim'))
    let w = cells(f.text)
    if (ri === 0 && relay && lay.relay !== 'none') {
      const mark = relayText(relay, lay.relay)
      const btn = `[ ${relay.button} ]`
      if (mark) (out += ` ${paint(mark, 'bad')}`), (w += cells(mark) + 1)
      out += ` ${paint(btn, 'bad')}`
      w += cells(relay.button) + jc.button_pad + 1
    }
    return { out, w }
  })
}

function rows(data, cols) {
  const v = enCoursView(data, ec, cols, NOW)
  const out = v.rows.map(r => ' '.repeat(r.indent) + r.segs.map(s => paint(s.text, s.tone ?? (s.dim ? 'dim' : undefined))).join('') + paint(`   (${cells(rowText(r))})`, 'dim'))
  if (v.more) out.push(paint(`${ec.labels.more.replace('{n}', String(v.more))} · ${ec.labels.cockpit}`, 'dim'))
  return out
}

for (const cols of widths) {
  for (const [name, fx] of [['idle', idle], ['busy, CI stale', staleCi], ['running', running], ['busy, relais', busy]]) {
    console.log(paint(`── ${name} · ${cols} colonnes ${'─'.repeat(Math.max(0, cols - cells(name) - 16))}`, 'dim'))
    for (const l of lines(fx, cols)) console.log(`${l.out}${paint(`   (${l.w})`, 'dim')}`)
    for (const r of rows(fx.running, cols)) console.log(r)
  }
}
