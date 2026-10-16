// Text preview of both factory views from real transcripts (no Claude Code needed):
//   node mods/factory/scanner/preview.mjs [conversation title or id] [--svg OUTDIR]  (OUTDIR gets tree.svg and dash.svg)
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { treeSvg, dashSvg } from '../hooks/svg.mjs'
import { deepMerge, dashboard, conversation, pickSession, scanArgs, fmtTokens, fmtUsd, hhmm, short } from '../hooks/logic.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const board = process.env.FACTORY_BOARD || join(homedir(), '.claude', 'effort-board')
const over = join(board, 'factory.config.json')
const cfg = deepMerge(JSON.parse(readFileSync(join(here, '..', 'factory.config.json'), 'utf8')), existsSync(over) ? JSON.parse(readFileSync(over, 'utf8')) : {})
const scan = (detail) => JSON.parse(execFileSync(cfg.python || 'python', scanArgs(cfg, { script: join(here, 'factory_scan.py'), cache: join(board, 'factory_cache.json'), detail }), { encoding: 'utf8', maxBuffer: 1 << 28 }))
let s = scan()
const now = Date.now()
const g = dashboard(s, cfg, now)
console.log(`== ${g.rows.length} conversations, today ${g.today}: ${fmtUsd(g.totalCost)} (${cfg.cost_label}), ${g.totalCalls} calls`)
console.log('share: ' + g.share.map((x) => `${x.family} ${Math.round(x.share * 100)}% (target ${x.target}${x.ok ? '' : ' MISSED'})`).join(' | '))
for (const [m, b] of Object.entries(g.byModel)) console.log(`  ${short(m).padEnd(12)} ${fmtUsd(b.cost).padStart(9)} ${fmtTokens(b.tokens)} tok ${b.calls} calls`)
for (const [p, b] of Object.entries(g.byProject).filter(([, b]) => b.cost > 0)) console.log(`  ${p.padEnd(28)} ${fmtUsd(b.cost).padStart(9)} ${b.sessions} conv`)
for (const r of g.rows) {
  console.log(`${r.live ? '●' : '○'} ${r.title.slice(0, 34).padEnd(34)} ${(r.repo + ' · ' + r.branch.replace(/^claude\//, '')).slice(0, 44).padEnd(44)} ${short(r.model)} ${r.effort} ctx ${r.ctxPct}% ${fmtUsd(r.costToday)} subs ${r.running}/${r.subs} ${r.pr ? `#${r.pr.number} ${r.pr.state} ${r.pr.ci}` : '-'} julian:${r.waiting ? 'yes' : 'no'} ${r.problem.slice(0, 70)}`)
}
const svgAt = process.argv.indexOf('--svg')
const svgDir = svgAt > 0 ? process.argv[svgAt + 1] : null
if (svgDir) writeFileSync(join(svgDir, 'dash.svg'), dashSvg(g, cfg, now, 'calls'))
const pick = pickSession(s.sessions, svgAt === 2 ? '' : process.argv[2] || '') || s.sessions.find((x) => (x.subs || []).length) || s.sessions[0]
s = scan(pick.cli)
const c = conversation(s.detail, cfg, now)
if (svgDir) writeFileSync(join(svgDir, 'tree.svg'), treeSvg(c, cfg, now))
console.log(`\n== ${c.title} (${c.repo} · ${c.branch})`)
console.log(`main: ${short(c.main.model)} · ${c.main.effort} · ctx ${fmtTokens(c.main.ctx)}/${fmtTokens(c.main.window)} (${c.main.ctxPct}%) · cost ${fmtUsd(c.main.cost)} · PR ${c.pr ? `#${c.pr.number} ${c.pr.state} ${c.pr.ci}` : '-'}`)
for (const n of c.agents) console.log(`  ├ ${n.type} ${n.status} ${short(n.model)}·${n.effort}${n.explicit ? '' : ' NO-MODEL'} ${fmtTokens(n.tokens)} ${fmtUsd(n.cost)}${n.architect ? ' [architect: ' + n.architect + ']' : ''} ${n.task.slice(0, 60)}`)
for (const w of c.workflows) { console.log(`  └ workflow ${w.name}: ${w.nodes.length} agents ${fmtUsd(w.cost)}`); for (const n of w.nodes) console.log(`      ${n.type} ${n.status} ${short(n.model)} ${fmtUsd(n.cost)} ${n.task.slice(0, 50)}`) }
console.log('warnings:'); for (const w of c.warnings) console.log(`  ${w.level}: ${w.text}`)
console.log('bill: ' + Object.entries(c.bill).map(([m, b]) => `${short(m)} ${fmtUsd(b.cost)}`).join(', ') + ` = ${fmtUsd(c.total)}`)
for (const t of c.turns) console.log(`  ${hhmm(t.ts)} ${fmtUsd(t.cost).padStart(8)} ${t.kind} ${t.text.slice(0, 60)}`)
console.log('guards:'); for (const x of c.guards) console.log(`  ${hhmm(x.ts)} ${x.src} ${x.text.slice(0, 90)}`)
console.log('log:'); for (const e of c.events) console.log(`  ${hhmm(e[0])} ${e[1].padEnd(7)} ${e[2].slice(0, 90)}`)
