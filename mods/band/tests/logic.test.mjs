// band mod: rate math, scope grouping, context and compaction figures, incremental scanner.
//   node --test mods/band/tests/logic.test.mjs     (Node 22.18+ strips the types)
// Fixture transcripts are generated here into a temp folder: no transcript file is committed, no real data.
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  bandParts,
  bandText,
  buildView,
  compactLabel,
  contextInfo,
  costOf,
  deepMerge,
  fmtTok,
  ageText,
  growthTpm,
  handoffAdvice,
  handoffButtons,
  handoffReason,
  isLoaded,
  launcherButtons,
  launcherPress,
  launcherKey,
  launcherTyped,
  rateOf,
  recentHandoffs,
  repoKey,
  resumeCandidates,
  sparkline,
  toggleOpen,
} from '../hooks/logic.ts'
import { classifyPath, emptyMeta, parseLines } from '../hooks/parse.ts'
import { scan, sharedLib } from '../scanner/scan.mjs'

const CFG = JSON.parse(readFileSync(new URL('../band.config.json', import.meta.url), 'utf8'))
const NOW = Date.parse('2026-10-16T12:00:00Z')
const iso = sAgo => new Date(NOW - sAgo * 1000).toISOString()
const U = (inp, cw, cr, out) => ({ input_tokens: inp, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out })
const asst = (sAgo, id, usage, extra = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: iso(sAgo), isSidechain: false, cwd: extra.cwd, message: { id, model: extra.model ?? 'claude-opus-5-5', usage } })
const ev = (sAgo, s, tokens, extra = {}) => ({ t: NOW - sAgo * 1000, s, m: 'claude-opus-5-5', u: { inp: tokens, cw: 0, cr: 0, out: 0 }, ...extra })

test('tests/shipped.ts is a current copy of band.config.json', () => {
  const src = readFileSync(new URL('./shipped.ts', import.meta.url), 'utf8')
  const copy = JSON.parse(JSON.parse(/SHIPPED = (".*")\s*$/m.exec(src)[1]))
  assert.deepEqual(copy, CFG)
})

test('rate math: sliding window, per s / min / h, list-price $/h', () => {
  const evs = [ev(10, 'a', 600), ev(30, 'a', 600), ev(59, 'a', 600), ev(61, 'a', 6000), ev(-5, 'a', 999)]
  const r = rateOf(evs, NOW, 60, 'fresh', CFG.rates)
  assert.equal(r.tokens, 1800)
  assert.equal(r.calls, 3)
  assert.equal(r.tps, 30)
  assert.equal(r.tpm, 1800)
  assert.equal(r.tph, 108000)
  // 1800 input tokens of claude-opus-5-5 at 4 $/M in 60 s -> 0.0072 $ per minute -> 0.432 $/h
  assert.ok(Math.abs(r.usdPerH - 0.432) < 1e-9)
  const ten = rateOf(evs, NOW, 600, 'fresh', CFG.rates)
  assert.equal(ten.tokens, 7800)
  assert.equal(ten.tps, 13)
})

test('count mode: fresh leaves cache reads out, all counts them; cost prices each part', () => {
  const e = { t: NOW, s: 'a', m: 'claude-sonnet-5-5', u: { inp: 100, cw: 1000, cr: 100000, out: 500 } }
  assert.equal(rateOf([e], NOW, 1, 'fresh', CFG.rates).tokens, 1600)
  assert.equal(rateOf([e], NOW, 1, 'all', CFG.rates).tokens, 101600)
  // 100*2 + 1000*2.5 + 100000*0.2 + 500*10 = 27700 per M
  assert.ok(Math.abs(costOf(e, CFG.rates) - 0.0277) < 1e-12)
  // unknown full id falls back to its family, then to default
  assert.equal(costOf({ ...e, m: 'claude-haiku-9' }, CFG.rates), (100 * 1 + 1000 * 1.25 + 100000 * 0.1 + 500 * 5) / 1e6)
})

test('scope grouping: a worktree counts as its repo; conv, agents, workflows, project, all', () => {
  const M = CFG.worktree_markers
  assert.equal(repoKey('C:\\code\\app\\.claude\\worktrees\\band', M), 'C:/code/app')
  assert.equal(repoKey('c:/code/app/.worktrees/x/sub', M), 'C:/code/app')
  assert.equal(repoKey('C:/code/app/', M), 'C:/code/app')
  const sessions = {
    me: { ...emptyMeta('me'), cwd: 'C:/code/app/.claude/worktrees/band', last: NOW },
    twin: { ...emptyMeta('twin'), cwd: 'C:/code/app', last: NOW },
    other: { ...emptyMeta('other'), cwd: 'C:/code/web', last: NOW },
  }
  const evs = [
    ev(5, 'me', 600),
    ev(6, 'me', 1200, { a: 'sub1' }),
    ev(7, 'me', 1800, { a: 'wf-a', w: 'wf_1' }),
    ev(8, 'twin', 3000),
    ev(9, 'other', 6000),
  ]
  const v = buildView(evs, sessions, CFG, { now: NOW, session: 'me', cwd: 'C:/code/app/.claude/worktrees/band' })
  const tps = id => v.scopes.find(s => s.id === id).rates[0].tps
  assert.equal(tps('conv'), 10)
  assert.equal(tps('conv_all'), 60)
  assert.equal(tps('agents'), 50)
  assert.equal(tps('workflows'), 30)
  assert.equal(tps('project'), 110)
  assert.equal(tps('all'), 210)
  assert.equal(v.repo, 'app')
  assert.deepEqual(v.projects.map(p => [p.repo, p.sessions]), [['app', 2], ['web', 1]])
  assert.equal(v.top[0].s, 'other')
  assert.equal(v.top.find(t => t.s === 'me').isThis, true)
})

test('context: % of window, threshold from the engine or the fallback, ETA, relay and idle markers', () => {
  const c = contextInfo({ tokens: 180000, window: 400000, percent: 45, autoCompactThreshold: 368000, growthTpm: 4000, last: NOW - 60000, now: NOW }, CFG.context, CFG.idle_compact)
  assert.equal(c.usedPct, 45)
  assert.equal(c.threshold, 368000)
  assert.equal(c.thresholdPct, 92)
  assert.equal(c.thresholdSource, 'engine')
  assert.equal(c.toCompact, 188000)
  assert.equal(c.toCompactPct, 47)
  assert.equal(c.etaMin, 47)
  assert.equal(c.relay, 'ok')
  assert.equal(c.level, 'ok')
  assert.equal(c.idleEtaMin, undefined)
  const near = contextInfo({ tokens: 230000, window: 400000, now: NOW, last: NOW - 20 * 60000 }, CFG.context, CFG.idle_compact)
  assert.equal(near.thresholdSource, 'config')
  assert.equal(near.threshold, 368000)
  assert.equal(near.usedPct, 57.5)
  assert.equal(near.relay, 'near')
  assert.equal(near.level, 'warn')
  assert.equal(Math.round(near.idleEtaMin), 34)
  const over = contextInfo({ tokens: 260000, window: 400000, now: NOW }, CFG.context, CFG.idle_compact)
  assert.equal(over.relay, 'over')
  assert.equal(over.level, 'bad')
})

test('context growth: slope since the last drop, none when flat', () => {
  const s = [[NOW - 500000, 300000], [NOW - 400000, 20000], [NOW - 300000, 50000], [NOW - 60000, 90000]]
  assert.equal(growthTpm(s, NOW, 600), ((90000 - 20000) / 340000) * 60000)
  assert.equal(growthTpm([[NOW - 10, 5], [NOW, 5]], NOW, 600), undefined)
})

test('band text in French, scopes and items from the settings, week only when known', () => {
  const sessions = { me: { ...emptyMeta('me'), cwd: 'C:/code/app', last: NOW } }
  const v = buildView([ev(10, 'me', 7200), ev(20, 'me', 120000, { a: 'x' })], sessions, CFG, { now: NOW, session: 'me', cwd: 'C:/code/app' })
  const ctx = contextInfo({ tokens: 164000, window: 400000, percent: 41, autoCompactThreshold: 368000, now: NOW }, CFG.context, CFG.idle_compact)
  const txt = bandText(bandParts(v, ctx, 37, CFG.band, CFG))
  assert.equal(txt, 'ctx 41 % (164 k) · compact à 92 % · reste 51 % · cette conv 120 tok/s · projet 2,1 k tok/s · tout 2,1 k tok/s · semaine 37 %')
  assert.doesNotMatch(bandText(bandParts(v, ctx, undefined, CFG.band, CFG)), /semaine/)
  const only = bandText(bandParts(v, ctx, undefined, { items: ['rates'], scopes: ['conv_all'] }, CFG))
  assert.equal(only, 'conv + agents 2,1 k tok/s')
  assert.equal(fmtTok(999), '999')
  assert.equal(fmtTok(41000), '41 k')
  assert.equal(fmtTok(1200000), '1,2 M')
})

test('paths: main, subagent and Workflow agent transcripts', () => {
  assert.deepEqual(classifyPath('proj/abc.jsonl'), { s: 'abc' })
  assert.deepEqual(classifyPath('proj/abc/subagents/agent-a1.jsonl'), { s: 'abc', a: 'a1' })
  assert.deepEqual(classifyPath('proj/abc/subagents/workflows/wf_1/agent-a2.jsonl'), { s: 'abc', w: 'wf_1', a: 'a2' })
  assert.equal(classifyPath('proj/abc/tool-results/x.txt'), undefined)
})

test('parser: a response split over entries counts once; compactions with and without timestamp', () => {
  const meta = emptyMeta('s')
  const events = []
  const st = {}
  const lines = [
    JSON.stringify({ type: 'custom-title', customTitle: 'LANE A', sessionId: 's' }),
    asst(3000, 'm1', U(10, 100, 1000, 5), { cwd: 'C:/code/app' }),
    asst(3000, 'm1', U(10, 100, 1000, 50)),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 368000, postTokens: 17000 } }),
    JSON.stringify({ type: 'user', isCompactSummary: true, timestamp: iso(2990) }),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: iso(100), compactMetadata: { trigger: 'manual', preTokens: 90000, postTokens: 9000 } }),
  ]
  parseLines(lines.join('\n') + '\n', { s: 's' }, st, meta, events, NOW - 3600000)
  assert.equal(events.length, 1)
  assert.equal(events[0].u.out, 50)
  assert.equal(meta.title, 'LANE A')
  assert.equal(meta.cwd, 'C:/code/app')
  assert.equal(meta.compactions.length, 2)
  assert.equal(meta.compactions[0].t, NOW - 2990000)
  assert.equal(meta.compactions[1].trigger, 'manual')
  assert.equal(meta.ctx, 9000)
  assert.equal(compactLabel(meta.compactions[1], CFG.labels, 54), '/compact')
  assert.equal(compactLabel({ t: 0, trigger: 'auto', gapMin: 55 }, CFG.labels, 54), 'au repos (déduit)')
  assert.equal(compactLabel({ t: 0, trigger: 'auto', gapMin: 1 }, CFG.labels, 54), 'auto')
})

test('scanner: incremental tail, worktree grouping, compaction markers, shared parser', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'band-test-'))
  try {
    const root = join(dir, 'projects')
    const repo = join(dir, 'code', 'app')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const wt = join(repo, '.claude', 'worktrees', 'band')
    mkdirSync(wt, { recursive: true })
    const p1 = join(root, 'C--code-app')
    mkdirSync(join(p1, 'me', 'subagents', 'workflows', 'wf_1'), { recursive: true })
    const main = join(p1, 'me.jsonl')
    writeFileSync(main, [asst(50, 'r1', U(100, 500, 9000, 600), { cwd: wt }), asst(40, 'r2', U(100, 500, 9500, 600), { cwd: wt })].join('\n') + '\n')
    writeFileSync(join(p1, 'me', 'subagents', 'agent-s1.jsonl'), asst(30, 'r3', U(0, 0, 0, 1200), { cwd: wt }) + '\n')
    writeFileSync(join(p1, 'me', 'subagents', 'workflows', 'wf_1', 'agent-w1.jsonl'), asst(20, 'r4', U(0, 0, 0, 600), { cwd: wt }) + '\n')
    const p2 = join(root, 'C--code-app-2')
    mkdirSync(p2, { recursive: true })
    writeFileSync(join(p2, 'twin.jsonl'), asst(15, 'r5', U(0, 0, 0, 3000), { cwd: repo }) + '\n')
    const cache = join(dir, 'cache', 'scan-cache.json')
    const req = { projects_root: root, cache_file: cache, session: 'me', cwd: wt, now: NOW, cfg: deepMerge(CFG, {}) }

    const v1 = scan(req)
    const r = id => v1.scopes.find(s => s.id === id).rates[0].tokens
    assert.equal(r('conv'), 2400)
    assert.equal(r('agents'), 1800)
    assert.equal(r('workflows'), 600)
    assert.equal(r('project'), 7200)
    assert.equal(v1.repo, 'app')
    assert.equal(v1.files, 4)

    // second run: nothing new, nothing read; then an appended partial line waits for its newline
    const v2 = scan({ ...req, now: NOW + 1000 })
    assert.equal(v2.files, 0)
    const half = JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: iso(5), compactMetadata: { trigger: 'auto', preTokens: 300000, postTokens: 20000 } })
    appendFileSync(main, half.slice(0, 40))
    assert.equal(scan(req).compactions.length, 0)
    appendFileSync(main, half.slice(40) + '\n')
    const v3 = scan(req)
    assert.equal(v3.compactions.length, 1)
    assert.equal(v3.compactions[0].isThis, true)
    assert.equal(v3.compactions[0].items[0].pre, 300000)
    assert.equal(v3.marks.conv.length, 1)
    assert.equal(v3.marks.conv[0], 29)
    assert.equal(v3.scopes.find(s => s.id === 'conv').rates[0].tokens, 2400)
    assert.equal(v3.conv.ctx, 20000)
    assert.match(sparkline(v3.scopes.find(s => s.id === 'all').spark), /[▁-█]$/)
    assert.equal(v3.lib, 'band')

    // the shared parser and price table of mods/usage give the same tokens; a fresh cache reads every file again
    const lib = await sharedLib(CFG)
    assert.equal(lib?.name, 'mods/usage/lib')
    const v4 = scan({ ...req, cache_file: join(dir, 'cache2.json') }, lib)
    assert.equal(v4.lib, 'mods/usage/lib')
    for (const id of ['conv', 'agents', 'workflows', 'project']) {
      assert.equal(v4.scopes.find(s => s.id === id).rates[0].tokens, v3.scopes.find(s => s.id === id).rates[0].tokens, id)
    }
    assert.ok(v4.scopes.find(s => s.id === 'all').rates[0].usdPerH > 0)
    assert.equal(await sharedLib({ ...CFG, shared_lib: 'off' }), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('launcher: default bar, loaded vs not loaded, open/close toggle', () => {
  const L = CFG.launcher
  assert.deepEqual(L.items.map(i => i.label + '=' + i.mod), ['Usine=factory', 'Conso=usage', 'Scénarios=scenarios', 'CI=ci', 'Control=control', 'Guide=guide', 'Santé=sante', 'Veille=veille', 'Fil=veille', 'Ménage=menage', 'Cockpit=cockpit'])
  const cmds = [{ name: 'conso', plugin: 'usage' }, { name: 'factory' }, { name: 'ci', plugin: 'other' }, { name: 'control', plugin: 'control@local' }]
  assert.equal(isLoaded(L.items[3], cmds), false, 'a ci command from another plugin does not count')
  assert.equal(isLoaded(L.items[4], cmds), true)
  let open = []
  let bs = launcherButtons(L, cmds, open, CFG.labels)
  assert.deepEqual(bs.map(b => b.loaded), [true, true, false, false, true, false, false, false, false, false, false])
  assert.equal(bs[5].hint, 'non chargé : ajouter mods/guide à CLAUDE_CODE_PLUGIN_DIRS')
  assert.deepEqual(launcherPress(bs[5]), { toast: bs[5].hint })
  const a = launcherPress(bs[1], L.close_args)
  assert.deepEqual(a, { run: { command: 'conso' }, open: true })
  open = toggleOpen(open, 'usage', a.open)
  bs = launcherButtons(L, cmds, open, CFG.labels)
  assert.equal(bs[1].open, true)
  const b = launcherPress(bs[1], L.close_args)
  assert.deepEqual(b, { run: { command: 'conso', args: 'close' }, open: false })
  assert.deepEqual(toggleOpen(open, 'usage', b.open), [])
  assert.deepEqual(launcherButtons({ ...L, enabled: false }, cmds, [], CFG.labels), [])
  // Fil: a second button on the veille mod, with args and its own open state
  const vcmds = [{ name: 'veille', plugin: 'veille' }]
  const fil = launcherButtons(L, vcmds, [], CFG.labels).find(b => b.label === 'Fil')
  assert.deepEqual(launcherPress(fil, L.close_args), { run: { command: 'veille', args: 'fil' }, open: true })
  assert.equal(launcherKey(fil), 'veille-fil')
  const both = launcherButtons(L, vcmds, ['veille-fil'], CFG.labels).filter(b => b.mod === 'veille')
  assert.deepEqual(both.map(b => b.label + '=' + b.open), ['Veille=false', 'Fil=true'])
  assert.deepEqual(launcherTyped(L.items, 'veille', 'fil', 'close'), { open: ['veille-fil'], close: ['veille'] })
  assert.deepEqual(launcherTyped(L.items, 'veille', '', 'close'), { open: ['veille'], close: ['veille-fil'] })
  assert.deepEqual(launcherTyped(L.items, 'veille', 'close', 'close'), { open: [], close: ['veille', 'veille-fil'] })
  assert.equal(launcherTyped(L.items, 'nope', '', 'close'), null)
  assert.equal(launcherButtons(L, [], ['usage'], CFG.labels)[1].open, false, 'a mod not loaded is never shown open')
})

// ---------- hand-off helper ----------

const H = CFG.handoff
const ctxAt = (tokens, growth) =>
  contextInfo({ tokens, window: 400000, autoCompactThreshold: 368000, growthTpm: growth, now: NOW }, CFG.context, CFG.idle_compact)

test('hand-off advice: shown from threshold_tokens (250 K by default) or when auto-compact is forecast within eta_min', () => {
  assert.equal(H.threshold_tokens, 250000)
  assert.deepEqual(handoffAdvice(ctxAt(249999), H), { show: false, reasons: [] })
  assert.deepEqual(handoffAdvice(ctxAt(250000), H), { show: true, reasons: ['tokens'] })
  // 200 K, 168 K to the 368 K threshold at 10 K/min -> ~17 min <= 20
  assert.deepEqual(handoffAdvice(ctxAt(200000, 10000), H), { show: true, reasons: ['eta'] })
  assert.deepEqual(handoffAdvice(ctxAt(200000, 1000), H), { show: false, reasons: [] })
  assert.deepEqual(handoffAdvice(ctxAt(300000, 10000), H).reasons, ['tokens', 'eta'])
  assert.equal(handoffAdvice(ctxAt(300000), { ...H, enabled: false }).show, false)
  assert.equal(handoffAdvice(ctxAt(200000, 10000), { ...H, eta_min: 0 }).show, false)
  assert.equal(handoffAdvice(undefined, H).show, false)
  assert.equal(handoffAdvice(ctxAt(120000), { ...H, threshold_tokens: 100000 }).show, true)
  assert.equal(handoffReason(handoffAdvice(ctxAt(300000, 10000), H), ctxAt(300000, 10000), H, CFG.labels), 'contexte 300 k ≥ 250 k · auto-compact dans ~7 min')
})

test('hand-off buttons: Préparer greyed without the handoff command; Ouvrir always pressable, says absent', () => {
  const none = handoffButtons(H, [], undefined, CFG.labels)
  assert.deepEqual(
    none.map(b => [b.key, b.label, b.enabled]),
    [
      ['handoff-prepare', 'Préparer RESUME', false],
      ['handoff-open', 'Ouvrir RESUME', true],
    ],
  )
  assert.match(none[0].hint, /\/handoff absente/)
  assert.equal(none[1].hint, 'absent')
  const ok = handoffButtons(H, [{ name: 'handoff' }], { path: 'C:/r/handoff/RESUME.md', mtime: NOW }, CFG.labels)
  assert.equal(ok[0].enabled, true)
  assert.equal(ok[0].hint, undefined)
  assert.equal(ok[1].hint, undefined)
  assert.equal(handoffButtons({ ...H, command: 'relais' }, [{ name: 'handoff' }], undefined, CFG.labels)[0].enabled, false)
})

test('RESUME age and where it is looked for', () => {
  assert.equal(ageText(undefined, NOW, CFG.labels), 'absent')
  assert.equal(ageText(NOW - 3 * 3600000, NOW, CFG.labels), 'mis à jour il y a 3 h')
  assert.equal(ageText(NOW - 12 * 60000, NOW, CFG.labels), 'mis à jour il y a 12 min')
  assert.equal(ageText(NOW - 10000, NOW, CFG.labels), "mis à jour à l'instant")
  assert.equal(ageText(NOW - 3 * 86400000, NOW, CFG.labels), 'mis à jour il y a 3 j')
  assert.deepEqual(resumeCandidates(String.raw`c:\code\app\.claude\worktrees\x`, H.files, CFG.worktree_markers), [
    'C:/code/app/.claude/worktrees/x/handoff/RESUME.md',
    'C:/code/app/handoff/RESUME.md',
  ])
  assert.deepEqual(resumeCandidates('C:/code/app', H.files, CFG.worktree_markers), ['C:/code/app/handoff/RESUME.md'])
  assert.deepEqual(resumeCandidates(undefined, H.files, CFG.worktree_markers), [])
})

test('last hand-offs and compactions of this conversation: newest first, n kept, agent compactions and old RESUME left out', () => {
  const comps = [
    { t: NOW - 7200000, trigger: 'manual' },
    { t: NOW - 3600000, trigger: 'auto', pre: 368000, post: 17000, gapMin: 1 },
    { t: NOW - 60000, trigger: 'auto', a: 'agent-1' },
  ]
  const rows = recentHandoffs(comps, [NOW - 1800000], { mtime: NOW - 600000 }, NOW - 9000000, 3, CFG.labels, 54)
  assert.deepEqual(
    rows.map(r => [r.kind, r.text]),
    [
      ['resume', 'RESUME écrit'],
      ['handoff', '/handoff lancé'],
      ['compact', 'compactage auto 368 k→17 k'],
    ],
  )
  assert.equal(recentHandoffs(comps, [], { mtime: NOW - 600000 }, NOW - 300000, 3, CFG.labels, 54).length, 2)
  assert.equal(recentHandoffs([], [], undefined, undefined, 3, CFG.labels, 54).length, 0)
})

test('gauge: bar with the hand-off and auto-compact marks, colour by level, one short line; text bar for the terminal', async () => {
  const { gaugeModel, gaugeSvg, gaugeText, barSvg } = await import('../hooks/gauge.ts')
  const g = gaugeModel({ tokens: 103000, window: 1000000, compactAt: 920000, handoffAt: 250000, etaMin: 16.2, rates: ['cette conv 53 tok/s'], week: 13 })
  assert.equal(g.title, 'ctx 10 % (103 k)')
  assert.equal(g.level, 'ok')
  assert.deepEqual(g.marks.map((m) => [m.kind, Math.round(m.pct), m.label]), [['handoff', 25, 'relais 250 k'], ['compact', 92, 'compact 92 %']])
  assert.equal(g.line, 'compactage dans ~16 min · cette conv 53 tok/s · semaine 13 %')
  const svg = gaugeSvg(g, {}, 300)
  assert.match(svg, /^<svg [^>]*width="300"/)
  assert.match(svg, /rx="3" fill="#3fb950"/) // green fill
  assert.equal((svg.match(/<line /g) || []).length, 2)
  assert.equal(gaugeModel({ tokens: 260000, window: 1000000, handoffAt: 250000 }).level, 'bad')
  assert.equal(gaugeModel({ tokens: 760000, window: 1000000, compactAt: 920000 }).level, 'warn')
  const t = gaugeText(g, 20)
  assert.equal([...t].length, 20)
  assert.equal(t[0], '█')
  assert.equal(t[5], '┃') // 25 % of 20
  assert.equal(gaugeModel({ window: 200000 }).hasReading, false)
  assert.match(barSvg(21, '#2f81f7', 200), /width="42.0"/)
})

test('gauge labels never overlap: relais 250 k and compact 37 % close together keep one label, the nearest ahead', async () => {
  const { gaugeModel, gaugeSvg, placeMarks, nearestMark } = await import('../hooks/gauge.ts')
  // screenshot case: 1 M window, hand-off at 25 %, auto-compact at 37 %, context at 8 %
  const g = gaugeModel({ tokens: 79000, window: 1000000, compactAt: 370000, handoffAt: 250000 })
  assert.equal(nearestMark(g).kind, 'handoff')
  const all = placeMarks(g, 320, 'all')
  assert.deepEqual(all.filter(m => m.show).map(m => m.kind), ['handoff'])
  const boxes = all.filter(m => m.show).map(m => { const w = m.label.length * 5.2; return m.anchor === 'start' ? [m.x, m.x + w] : m.anchor === 'end' ? [m.x - w, m.x] : [m.x - w / 2, m.x + w / 2] })
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(boxes[i][1] <= boxes[j][0] || boxes[j][1] <= boxes[i][0])
  // far apart, both fit; past the hand-off, the compact mark is the nearest
  assert.equal(placeMarks(gaugeModel({ tokens: 79000, window: 1000000, compactAt: 920000, handoffAt: 250000 }), 320, 'all').filter(m => m.show).length, 2)
  assert.equal(nearestMark(gaugeModel({ tokens: 300000, window: 1000000, compactAt: 370000, handoffAt: 250000 })).kind, 'compact')
  // labels stay inside the bar: a mark at 98 % is anchored at its end
  assert.equal(placeMarks(gaugeModel({ tokens: 1, window: 100, compactAt: 98 }), 200).find(m => m.kind === 'compact').anchor, 'end')
  // nearest: one <text>; none: ticks only and a slimmer bar
  assert.equal((gaugeSvg(g, {}, 120, 'nearest').match(/<text /g) || []).length, 1)
  assert.equal((gaugeSvg(g, {}, 120, 'none').match(/<text /g) || []).length, 0)
  assert.match(gaugeSvg(g, {}, 120, 'none'), /height="10"/)
})

test('band sections: defaults folded, order and enabled from config, toggle, remembered state, one-line summaries', async () => {
  const S = await import('../hooks/sections.ts')
  const shipped = JSON.parse(readFileSync(new URL('../band.config.json', import.meta.url), 'utf8'))
  const c = S.sectionsCfg(shipped.sections)
  assert.deepEqual(S.sectionList(c), ['conv', 'usage', 'veille', 'mods'])
  assert.deepEqual(S.initialUi(c), { expanded: false, open: [] }) // collapsed by default
  assert.deepEqual(S.sectionList(S.sectionsCfg({ order: ['veille', 'nope', 'conv'], enabled: ['conv', 'veille'] })), ['veille', 'conv'])
  assert.deepEqual(S.initialUi(c, { expanded: true, open: ['usage'] }), { expanded: true, open: ['usage'] })
  assert.deepEqual(S.initialUi(S.sectionsCfg({ remember: 'session' }), { expanded: true, open: ['usage'] }), { expanded: false, open: [] })
  let ui = S.toggleSection(S.initialUi(c), 'band')
  ui = S.toggleSection(ui, 'conv')
  assert.deepEqual(ui, { expanded: true, open: ['conv'] })
  assert.deepEqual(S.toggleSection(ui, 'conv').open, [])
  const L = c.labels
  const limits = [{ kind: 'five_hour', percentUsed: 24.2 }, { kind: 'seven_day', percentUsed: 14 }]
  assert.equal(S.headLine({ ctxPct: 8.1, etaMin: 15.6, tps: 434.2, limits }, L), 'ctx 8 % · compact ~16 min · 434 tok/s · 5 h 24 % · sem 14 %')
  assert.equal(S.headLine({}, L), 'ctx ?')
  const facts = { model: 'claude-opus-5-5', effort: 'medium', agents: { running: 1, total: 3, workflow: 'wf_9' }, pr: { number: 12 } }
  assert.equal(S.convSummary(facts, L), 'opus 5.5 · medium · agents 1/3 · wf wf_9 · PR #12')
  assert.equal(S.convSummary({}, L), 'modèle ?')
  assert.equal(S.usageSummary(limits, 0.234, L), '5 h 24 % · sem 14 % · $0.23')
  assert.equal(S.usageSummary([], undefined, L), 'non lisible')
  const now = Date.parse('2026-10-16T16:00:00Z')
  const rows = S.usageRows([{ kind: 'five_hour', percentUsed: 24, resetsAt: new Date(now + 136 * 60000).toISOString() }], now, L)
  assert.deepEqual(rows.map(r => [r.label, r.when]), [['5 h', 'reset dans 2 h 16']])
  const v = S.veilleSummary({ alerts: { a: { key: 'a', what: 'CI rouge', severity: 'warn' }, b: { key: 'b', what: 'PR à merger', julian: true }, c: { key: 'c', what: 'vu' } } }, ['c'])
  assert.equal(v.open, 2)
  assert.equal(S.veilleLine(v, L), '2 alerte(s) · 1 attend Julian · PR à merger')
  assert.equal(S.veilleLine(S.veilleSummary(null, []), L), 'veille absente')
  assert.equal(S.julianCounter(v, L), 'attend Julian : 1')
  assert.equal(S.julianCounter(S.veilleSummary({ alerts: {} }, []), L), '')
  for (const line of [S.headLine({ ctxPct: 8, etaMin: 16, tps: 434, limits }, L), S.convSummary(facts, L), S.usageSummary(limits, 0.23, L), S.veilleLine(v, L)]) {
    assert.ok(!line.includes('\n') && line.length <= 75, `one short line: ${line}`)
  }
  assert.equal(S.modelShort('claude-sonnet-5-5[1m]'), 'sonnet 5.5')
})

test('scanner view: this conversation\'s agents (running within running_s), its Workflow and its PR link', () => {
  const now = Date.parse('2026-10-16T12:00:00Z')
  const ev = (sAgo, s, extra = {}) => ({ t: now - sAgo * 1000, s, m: 'claude-opus-5-5', u: { inp: 100, cw: 0, cr: 0, out: 0 }, ...extra })
  const sessions = { me: { s: 'me', cwd: 'C:/code/app', last: now, compactions: [], samples: [], pr: { number: 7, url: 'https://example.invalid/pr/7' } } }
  const cfg = { windows_s: [60, 600], spark_min: 30, bucket_s: 60, count: 'fresh', rates: {}, top_n: 5, compact_history_hours: 24, worktree_markers: [], sections: { running_s: 120 } }
  const v = buildView([ev(10, 'me', { a: 'x', w: 'wf_1' }), ev(30, 'me', { a: 'y' }), ev(900, 'me', { a: 'z' }), ev(5, 'other', { a: 'q' })], sessions, cfg, { now, session: 'me' })
  assert.deepEqual(v.conv.agents, { running: 2, total: 3, workflow: 'wf_1' })
  assert.equal(v.conv.pr.number, 7)
})
