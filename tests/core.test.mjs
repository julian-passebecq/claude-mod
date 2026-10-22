// lib/core on invented fixtures only (no real ~/.claude data): node --test tests/core.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SYMBOLS, axis, gantt, legend, svg } from '../lib/core/gantt.mjs'
import { MIN_SAMPLES, estimateOf, etaOf, quantiles, remaining } from '../lib/core/estimate.mjs'
import { aToi, attendJulian, filWaiting, openAlerts, parseAcks, readVeille } from '../lib/core/veille.mjs'
import { readRunner, runnerLine, runnerLoad } from '../lib/core/runner.mjs'
import { listMods, loadedState, missingDirs, splitDirs } from '../lib/core/mods.mjs'
import { claudeWindows, codexWindows, parseSamples, runOut } from '../lib/core/usage.mjs'
import { deepMerge, expand, fill, oneLine, readJson, toMs, writeAtomic } from '../lib/core/util.mjs'
import { appDir, linkChildren, parseSession, repoOfCwd } from '../lib/core/sessions.mjs'
import { age, waitingRows } from '../lib/core/waiting.mjs'

const T = Date.parse('2026-10-16T10:00:00Z')
const MIN = 60000
const tmp = () => mkdtempSync(join(tmpdir(), 'core-test-'))

// ---- gantt ---------------------------------------------------------------------------------------------------------

test('gantt: every row is exactly `width` cells, one symbol set', () => {
  const rows = [
    { label: 'build', status: 'success', queuedMs: T, startMs: T + 2 * MIN, endMs: T + 10 * MIN },
    { label: 'test', status: 'running', queuedMs: T + 10 * MIN, startMs: T + 11 * MIN, estEndMs: T + 30 * MIN },
    { label: 'lint', status: 'failed', startMs: T + 3 * MIN, endMs: T + 6 * MIN },
  ]
  const g = gantt(rows, T + 20 * MIN, 40)
  assert.equal(g.rows.length, 3)
  for (const r of g.rows) {
    assert.equal([...r.segs.map((s) => s.text).join('')].length, 40)
    for (const ch of r.segs.map((s) => s.text).join('')) assert.ok(Object.values(SYMBOLS).includes(ch), ch)
  }
  const text = (i) => g.rows[i].segs.map((s) => s.text).join('')
  assert.ok(text(0).includes('░') && text(0).includes('█'), 'queue then done')
  assert.ok(text(1).includes('▓') && text(1).includes('┄'), 'running then estimate')
  assert.ok(text(2).includes('▒'), 'failed')
  assert.ok(g.nowCol > 0 && text(2)[g.nowCol] === '│', 'now line where the row is empty')
  assert.equal(legend(), '░ file  █ fini  ▓ en cours  ▒ échoué  ┄ estimation  │ maintenant')
  assert.equal(axis(g, 5, (ms) => (ms === g.t0 ? 'A' : 'B')), '     A' + ' '.repeat(38) + 'B')
  assert.ok(svg(g).startsWith('<svg') && svg(g).endsWith('</svg>'))
})

test('gantt: nothing to draw gives no rows; tiny widths are clamped', () => {
  assert.deepEqual(gantt([{ label: 'x' }], T, 30).rows, [])
  const g = gantt([{ label: 'a', status: 'success', startMs: T, endMs: T + MIN }], T, 1)
  assert.equal(g.width, 2)
  assert.equal(g.rows[0].segs.map((s) => s.text).join(''), '██')
})

// ---- estimate ------------------------------------------------------------------------------------------------------

test('estimate: fewer than 3 successful runs gives no estimate, 3 or more gives median and range', () => {
  assert.equal(MIN_SAMPLES, 3)
  const few = estimateOf([{ ms: 1000 }, { ms: 2000 }, { ms: 9000, ok: false }])
  assert.equal(few.enough, false)
  assert.equal(few.n, 2)
  assert.equal(remaining(few, 500), null)
  const e = estimateOf([1000, 2000, 3000, 4000, 5000])
  assert.deepEqual([e.enough, e.basis, e.n, e.median, e.p25, e.p75], [true, 'primary', 5, 3000, 2000, 4000])
  assert.deepEqual(remaining(e, 2500), { lo: 0, mid: 500, hi: 1500, overrun: false, n: 5 })
  assert.equal(remaining(e, 4500).overrun, true)
  const fb = estimateOf([100], { fallback: [10, 20, 30] })
  assert.deepEqual([fb.basis, fb.median], ['fallback', 20])
  assert.deepEqual(etaOf(e, T, T + 1000), { lo: T + 1000 + 1000, mid: T + 1000 + 2000, hi: T + 1000 + 3000, overrun: false, n: 5 })
  assert.deepEqual(quantiles([]), { n: 0, median: 0, p25: 0, p75: 0 })
})

// ---- veille --------------------------------------------------------------------------------------------------------

const STATE = {
  alerts: {
    a: { key: 'a', julian: true, severity: 'warn', since: 3 },
    b: { key: 'b', julian: true, severity: 'bad', since: 1 },
    c: { key: 'c', severity: 'bad', since: 2 },
    d: { key: 'd', julian: true, acked: true },
    e: { key: 'e', julian: true },
  },
}

test('veille: attendJulian counts open julian alerts once (acks and acked removed)', () => {
  const acks = parseAcks('{"key":"e"}\nnot json\n{"key":""}\n')
  assert.deepEqual(acks, ['e'])
  assert.equal(attendJulian(STATE, acks), 2)
  assert.deepEqual(openAlerts(STATE, acks).map((a) => a.key), ['b', 'a', 'c'])
  assert.equal(attendJulian(STATE, ['*']), 0)
  assert.equal(attendJulian(null), 0)
  assert.equal(aToi({ open: 4 }), 4)
  assert.equal(aToi({ open: 0 }), 0)
  assert.equal(aToi(null), 0)
})

test('veille: filWaiting walks the tree; readVeille reads invented folders', () => {
  const fil = { projects: [{ name: 'demo', convs: [{ sid: '1', state: 'en_cours', last_at: 1, children: [{ sid: '2', state: 'attend', last_at: 5, children: [] }] }] }] }
  assert.deepEqual(filWaiting(fil).map((c) => [c.sid, c.project]), [['2', 'demo']])
  const d = tmp()
  try {
    mkdirSync(join(d, 'v'))
    mkdirSync(join(d, 'f'))
    writeFileSync(join(d, 'v', 'state.json'), JSON.stringify(STATE))
    writeFileSync(join(d, 'v', 'acks.jsonl'), '{"key":"a"}\n')
    writeFileSync(join(d, 'f', 'summary.json'), '\uFEFF{"open":7}')
    const v = readVeille({ veilleHome: join(d, 'v'), afaireHome: join(d, 'f'), env: {} })
    assert.deepEqual([v.available, v.open, v.julian, v.aToi], [true, 3, 2, 7])
    const none = readVeille({ veilleHome: join(d, 'nope'), afaireHome: join(d, 'nope'), env: {} })
    assert.deepEqual([none.available, none.julian, none.aToi], [false, 0, 0])
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

// ---- runner --------------------------------------------------------------------------------------------------------

test('runner: load from a fake ci cache, never an API', () => {
  const cache = { generated: '2026-10-16T09:58:00Z', summary: { queue: { backend: 'local', label: 'Runner', tag: 't', running: 3, pending: 2, concurrent: 12, runners_online: 1, pipelines_open: 4, wait_s: 30, wait_n: 9 } } }
  const r = runnerLoad(cache, T)
  assert.deepEqual([r.running, r.pending, r.concurrent, r.load, r.age_ms], [3, 2, 12, 0.25, 2 * MIN])
  assert.equal(runnerLine(r), 'runner local à 3/12 · 2 en file')
  assert.equal(runnerLoad({ summary: {} }), null)
  assert.equal(runnerLine(null), '')
  const d = tmp()
  try {
    writeFileSync(join(d, 'c.json'), JSON.stringify(cache))
    assert.equal(readRunner(join(d, 'c.json'), T).running, 3)
    assert.equal(readRunner(join(d, 'missing.json'), T), null)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

// ---- mods ----------------------------------------------------------------------------------------------------------

test('mods: CLAUDE_CODE_PLUGIN_DIRS splits on ; (Windows) and : (elsewhere)', () => {
  assert.deepEqual(splitDirs('C:\\m\\a;"D:/m/b/";'), ['C:/m/a', 'D:/m/b'])
  assert.deepEqual(splitDirs('/m/a:/m/b'), ['/m/a', '/m/b'])
  assert.deepEqual(splitDirs('C:\\only\\one'), ['C:/only/one'])
  assert.deepEqual(splitDirs(''), [])
  const d = tmp()
  try {
    for (const m of ['one', 'two']) {
      mkdirSync(join(d, m, '.claude-plugin'), { recursive: true })
      writeFileSync(join(d, m, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: m, version: '1.0.0' }))
    }
    mkdirSync(join(d, 'not-a-mod'))
    const found = listMods(d)
    assert.deepEqual(found.map((m) => m.folder), ['one', 'two'])
    const dirs = `${found[0].dir.toUpperCase()};${join(d, 'gone')}`
    assert.deepEqual(loadedState(found, dirs).map((m) => m.loaded), [true, false])
    assert.equal(missingDirs(dirs, found).length, 1)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

// ---- usage ---------------------------------------------------------------------------------------------------------

test('usage: run-out date from the readings of the current window', () => {
  const reset = T + 24 * 60 * MIN
  const samples = parseSamples([
    JSON.stringify({ ts: T - 120 * MIN, seven_day: { pct: 10, reset: T - MIN } }),
    JSON.stringify({ ts: T - 60 * MIN, seven_day: { pct: 20, reset }, five_hour: { pct: 50, reset: T + 60 * MIN } }),
    'broken',
    JSON.stringify({ ts: T, seven_day: { pct: 30, reset }, five_hour: { pct: 60, reset: T + 60 * MIN } }),
  ].join('\n'))
  const w = claudeWindows(samples, T)
  assert.equal(w.week.pct, 30)
  assert.equal(w.week.ratePerH, 10)
  assert.equal(w.week.runOutAt, T + 7 * 60 * MIN)
  assert.equal(w.five.resetsFirst, true, '10 %/h from 60 % needs 4 h, the window resets in 1 h')
  assert.equal(w.five.runOutAt, null)
  assert.equal(runOut([], T), null)
  assert.equal(runOut([{ ts: T - MIN, pct: 40, reset: T - 1 }], T).past, true)
  const cx = codexWindows({ limits: { ts: T, primary: { pct: 12, windowMin: 300, reset: T + MIN }, secondary: { pct: 40, windowMin: 10080, reset: T - 1 } } }, T)
  assert.deepEqual([cx.five.pct, cx.week.pct, cx.week.past], [12, 0, true])
})

// ---- util, sessions, waiting ---------------------------------------------------------------------------------------

test('util: deepMerge, fill, expand, oneLine, toMs, readJson and writeAtomic', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: [1] }, d: 1 }, { a: { c: [2] }, d: undefined }), { a: { b: 1, c: [2] }, d: 1 })
  assert.equal(fill('{a} {b}', { a: 1 }), '1 {b}')
  assert.equal(expand('~/x\\y', { HOME: '/h', V: 'z' }), '/h/x/y')
  assert.equal(expand('%V%/$V', { V: 'z' }), 'z/z')
  assert.equal(oneLine('a\n <system-reminder>x</system-reminder> b', 5), 'a b')
  assert.equal(oneLine('abcdefgh', 5), 'abcd…')
  assert.equal(toMs(1700000000), 1700000000000)
  assert.equal(toMs('bad'), null)
  const d = tmp()
  try {
    writeAtomic(join(d, 'sub', 'f.json'), { x: 1 })
    assert.deepEqual(readJson(join(d, 'sub', 'f.json')), { x: 1 })
    assert.equal(readJson(join(d, 'none.json'), 'fb'), 'fb')
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('sessions: slim rows and spawnedFrom links from invented session files', () => {
  assert.equal(parseSession({ title: 'no cli' }), null)
  const rows = linkChildren([
    parseSession({ cliSessionId: 'c1', sessionId: 's1', title: 'Lead', cwd: 'D:\\p\\demo', lastActivityAt: 5 }),
    parseSession({ cliSessionId: 'c2', sessionId: 's2', title: 'Lane', cwd: 'D:/p/demo/.claude/worktrees/x', spawnedFrom: { sessionId: 's1' }, prs: [{ url: 'u', prNumber: 3, state: 'OPEN' }] }),
  ])
  assert.deepEqual([rows[1].repo, rows[1].parent, rows[1].parent_title, rows[1].prs[0].state], ['demo', 's1', 'Lead', 'open'])
  assert.deepEqual(rows[0].children.map((c) => c.sid), ['s2'])
  assert.equal(repoOfCwd('/a/b/.worktrees/z'), 'b')
})

test('waiting: the core copy needs no sibling file', () => {
  assert.equal(age(90 * MIN), '1 h 30')
  const scan = { sessions: [{ cli: 'abcdefghij', cwd: 'D:/p/demo', ask_open: true, ask_q: 'Q?', last_activity: T - MIN, ask_ts: T - 10 * MIN }] }
  const { rows } = waitingRows(scan, {}, T)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].session.title, 'abcdefgh')
  assert.equal(rows[0].session.repo, 'demo')
})

test('sessions: appDir finds Claude-Data first (marker, else newest), then %APPDATA%, then the Store package', () => {
  const t = mkdtempSync(join(tmpdir(), 'appdir-'))
  try {
    const env = { APPDATA: join(t, 'Roaming'), LOCALAPPDATA: join(t, 'Local') }
    const old = join(env.APPDATA, 'Claude', 'claude-code-sessions')
    const store = join(env.LOCALAPPDATA, 'Packages', 'Claude_test1', 'LocalCache', 'Roaming', 'Claude', 'claude-code-sessions')
    assert.equal(appDir({}, env), old) // nothing at all: the old path
    mkdirSync(store, { recursive: true })
    assert.equal(appDir({}, env), store)
    mkdirSync(old, { recursive: true })
    assert.equal(appDir({}, env), old)
    const a = join(env.LOCALAPPDATA, 'Claude-Data', 'claude_aaa', 'claude-code-sessions')
    const b = join(env.LOCALAPPDATA, 'Claude-Data', 'claude_bbb', 'claude-code-sessions')
    mkdirSync(join(env.LOCALAPPDATA, 'Claude-Data', 'claude_empty'), { recursive: true }) // a profile without sessions is skipped
    mkdirSync(a, { recursive: true })
    assert.equal(appDir({}, env), a)
    mkdirSync(b, { recursive: true })
    utimesSync(a, new Date(2026, 0, 1), new Date(2026, 0, 1))
    utimesSync(b, new Date(2026, 0, 2), new Date(2026, 0, 2))
    assert.equal(appDir({}, env), b) // several, no marker: the newest
    writeFileSync(join(env.APPDATA, 'Claude', '.user-data-left.claude_aaa'), '')
    assert.equal(appDir({}, env), a) // the marker names the profile
    assert.equal(appDir({ app_dir: join(t, 'set') }, env), join(t, 'set'))
  } finally { rmSync(t, { recursive: true, force: true }) }
})
