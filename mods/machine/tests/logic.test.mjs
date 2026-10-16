// machine mod: metrics, the advice rule, formatting, band text, summary.
//   node --test mods/machine/tests/logic.test.mjs     (Node 22.18+ strips the types)
// Samples are made up here: no real machine data is committed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { advise, bandParts, bandText, coreBar, deepMerge, fmtBytes, fmtPct, gpuText, intervalMs, level, metrics, parseArgs, summary } from '../hooks/logic.ts'

const CFG = JSON.parse(readFileSync(new URL('../machine.config.json', import.meta.url), 'utf8'))

const sample = (cpu, ram, extra = {}) => ({
  platform: 'win32',
  at: Date.parse('2026-10-16T12:00:00Z'),
  interval_ms: 5000,
  ncpu: 4,
  cpu: { total: cpu, cores: [cpu, cpu, cpu, cpu] },
  ram: { total: 64e9, used: (64e9 * ram) / 100, pct: ram },
  disks: [{ drive: 'C:', total: 1e12, free: 200e9, pct_used: 80 }, { drive: 'D:', total: 2e12, free: 1.2e12, pct_used: 40 }],
  procs: {
    count: 300,
    top_cpu: [{ pid: 10, name: 'node.exe', cpu: 12.5, ram: 300e6, family: 'node' }],
    top_ram: [{ pid: 11, name: 'claude.exe', cpu: 1, ram: 900e6, family: 'claude' }],
    families: { claude: { count: 3, cpu: 2, ram: 2e9 }, node: { count: 9, cpu: 20, ram: 3e9 } },
    runner: { present: true, children: 1 },
  },
  gpu: null,
  ms: 40,
  ...extra,
})
const runner = (running, pending = null) => ({
  generated: '2026-10-16T12:00:00Z',
  backends: [{ id: 'gitlab-local', label: 'GitLab runner on this PC', tag: 'local-windows', concurrent: null, usable: 'yes', why: '1 runner(s) online', runners: { online: 1, offline: 0, total: 1 }, jobs: { running, pending } }],
})
const GPU = { source: 'nvidia-smi', gpus: [{ name: 'Test GPU', util: 35, mem_used_mb: 2048, mem_total_mb: 8192, temp_c: 60 }] }

test('shipped config: interval 5 s, band off pace 15 s, caps 4 pipelines and 3 npm ci/tsc', () => {
  assert.equal(CFG.interval_s, 5)
  assert.equal(intervalMs(CFG), 5000)
  assert.equal(intervalMs(CFG, true), 15000)
  assert.equal(intervalMs({ ...CFG, interval_s: 0.1 }), CFG.min_interval_s * 1000)
  assert.deepEqual(CFG.advice.caps.map(c => [c.id, c.value]), [['ci_pipelines', 4], ['npm_tsc', 3]])
})

test('tests/shipped.ts is a current copy of machine.config.json', () => {
  const src = readFileSync(new URL('./shipped.ts', import.meta.url), 'utf8')
  const copy = JSON.parse(JSON.parse(/SHIPPED = (".*")\s*$/m.exec(src)[1]))
  assert.deepEqual(copy, CFG)
})

test('metrics: cpu, ram, gpu max, lowest free disk, CI jobs of the configured backends, runner children', () => {
  const m = metrics(sample(50, 60), GPU, runner(2, 1), CFG)
  assert.deepEqual(m, { cpu: 50, ram: 60, gpu: 35, disk_free_gb: 200, runner_children: 1, ci_running: 2, ci_pending: 1 })
  const other = { ...runner(5), backends: [{ ...runner(5).backends[0], id: 'other' }] }
  assert.equal(metrics(sample(50, 60), null, other, CFG).ci_running, undefined)
  assert.deepEqual(metrics(null, null, null, CFG), {})
})

test('advice: calm machine -> base + 1 then capped at 3 by npm ci/tsc', () => {
  const a = advise(metrics(sample(20, 50), null, runner(0, 0), CFG), CFG.advice)
  assert.equal(a.n, 3)
  assert.equal(a.capped, '3 npm ci / tsc en même temps au plus')
  assert.ok(a.reasons.some(r => r.label === 'CPU < 30 %' && r.effect === '+1'))
})

test('advice: CPU > 85 % applies only its first matching rule (-2, not -3)', () => {
  const a = advise(metrics(sample(90, 50), null, runner(0, 0), CFG), CFG.advice)
  assert.equal(a.n, 2)
  assert.deepEqual(a.reasons.map(r => r.label), ['CPU > 85 %'])
})

test('advice: CPU and RAM high together reach the floor', () => {
  assert.equal(advise(metrics(sample(95, 95), null, runner(0, 0), CFG), CFG.advice).n, 1)
})

test('advice: running CI jobs eat into the 4-pipeline cap; pending jobs reduce', () => {
  assert.equal(advise(metrics(sample(50, 50), null, runner(3, 0), CFG), CFG.advice).n, 1)
  assert.equal(advise(metrics(sample(50, 50), null, runner(0, 2), CFG), CFG.advice).n, 3)
  assert.equal(advise(metrics(sample(50, 50), null, runner(2, 2), CFG), CFG.advice).n, 2)
})

test('advice: unknown metrics skip their rules and are listed', () => {
  const a = advise({ cpu: 50 }, CFG.advice)
  assert.equal(a.n, 3)
  assert.ok(a.unknown.includes('ram') && a.unknown.includes('ci_running'))
})

test('advice rules are configurable (user file deep-merged)', () => {
  const mine = deepMerge(CFG, { _note: 'x', advice: { base: 2, caps: [], rules: [{ metric: 'gpu', op: '>=', value: 30, delta: -1, label: 'GPU' }] } })
  assert.equal(mine._note, undefined)
  assert.equal(advise(metrics(sample(50, 50), GPU, null, mine), mine.advice).n, 1)
  assert.equal(mine.labels.cpu, 'CPU')
})

test('formatting in French', () => {
  assert.equal(fmtBytes(1.25e9), '1,3 Go')
  assert.equal(fmtBytes(2e12), '2 To')
  assert.equal(fmtBytes(300e6), '300 Mo')
  assert.equal(fmtPct(41.6), '42 %')
  assert.equal(fmtPct(null), '?')
  assert.equal(level(95, CFG.levels), 'bad')
  assert.equal(level(75, CFG.levels), 'warn')
  assert.equal(level(10, CFG.levels), 'ok')
  assert.equal(coreBar([0, 50, 100]), '▁▄█')
  assert.equal(gpuText(GPU, CFG.labels), 'Test GPU 35 % · VRAM 2/8 Go · 60 °C')
  assert.equal(gpuText({ source: 'none', gpus: [] }, CFG.labels), 'non disponible')
  assert.deepEqual(parseArgs(' CI '), { refresh: false, ci: true })
})

test('band text, in the configured order', () => {
  const parts = bandParts(sample(90, 50), GPU, runner(1, 0), CFG)
  assert.equal(bandText(parts), 'agents conseillés 2 · CPU 90 % · RAM 50 % · GPU 35 % · CI 1 en cours')
  assert.equal(parts[0].tone, 'warn')
  assert.deepEqual(bandParts(null, null, null, CFG), [])
})

test('summary for /machine', () => {
  const t = summary(sample(20, 50), GPU, runner(0, 0), CFG)
  assert.match(t, /^agents en parallèle conseillés maintenant : 3 \(CPU < 30 % \+1, .*3 npm ci \/ tsc en même temps au plus ≤ 3\)/)
  assert.match(t, /RAM 50 % \(32 Go \/ 64 Go\)/)
  assert.match(t, /C: 200 Go libres · D: 1,2 To libres/)
  assert.match(t, /Runner GitLab : 0 job\(s\) en cours · 0 en attente · processus local présent \(1 enfant\(s\)\)/)
})
