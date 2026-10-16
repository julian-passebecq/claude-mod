// ci Diagramme on the shared lib/core: Gantt (gantt.mjs), estimates (estimate.mjs) and the runner line (runner.mjs).
//   node --test mods/ci/tests/core.test.mjs     (Node 22.18+ strips the types of diagram.ts)
// Invented runs and numbers only.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { etaOfRun, gantt, headline, jobEnd } from '../hooks/diagram.ts'
import { estimateOf, etaOf } from '../lib/core/estimate.mjs'
import { legend } from '../lib/core/gantt.mjs'
import { runnerLine, runnerLoad } from '../lib/core/runner.mjs'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const iso = (minAgo) => new Date(NOW - minAgo * 60000).toISOString()
const run = (over = {}) => ({
  forge: 'gitlab', slug: 'g/app', backend: 'gitlab-local', id: 7, url: '', branch: 'claude/x', sha: 'abc', event: 'push', title: '', workflow: '',
  status: 'running', created: iso(10), duration_s: null, queued_s: null, mr: null, app: 'app', who: 'claude', conv: null, ...over,
})

test('a running job ends at its start plus the core median of its samples (same as the scanner)', () => {
  const r = run({
    jobs: [{ id: 1, name: 'test', stage: 's', status: 'running', created: iso(6), started: iso(5), finished: null, duration_s: null, queued_s: 60 }],
    estimate: { eta: null, basis: 'jobs', samples: 4, jobs: { test: { n: 4, median_s: 330, start: iso(5), end: iso(-0.5), samples_s: [300, 240, 360, 9999] } } },
  })
  const want = etaOf(estimateOf([300000, 240000, 360000, 9999000]), NOW - 5 * 60000, NOW).mid
  assert.equal(want, NOW - 5 * 60000 + 330000)
  assert.equal(jobEnd(r, r.jobs[0], NOW), want)
})

test('pipeline basis: the run ETA is the core median from its creation; too few samples keep the scanner answer', () => {
  const r = run({ created: iso(5), jobs: [], estimate: { eta: 'x', basis: 'pipeline', samples: 3, jobs: {}, durations_s: [600, 300, 420] } })
  assert.equal(etaOfRun(r, NOW), new Date(NOW - 5 * 60000 + 420000).toISOString())
  const late = run({ created: iso(30), jobs: [], estimate: { eta: 'x', basis: 'pipeline', samples: 3, jobs: {}, durations_s: [600, 300, 420] } })
  assert.equal(etaOfRun(late, NOW), new Date(NOW).toISOString()) // overrun: never in the past
  const none = run({ jobs: [], estimate: { eta: null, basis: null, samples: 1, jobs: {}, durations_s: [600], reason: "pas assez d'historique" } })
  assert.equal(etaOfRun(none, NOW), null)
})

test('the Gantt is lib/core/gantt.mjs: same symbols and legend as factory', () => {
  const r = run({
    jobs: [
      { id: 1, name: 'build', stage: 'b', status: 'success', created: iso(9), started: iso(8), finished: iso(6), duration_s: 120, queued_s: 60 },
      { id: 2, name: 'test', stage: 't', status: 'running', created: iso(6), started: iso(5), finished: null, duration_s: null, queued_s: 60 },
      { id: 3, name: 'lint', stage: 't', status: 'failed', created: iso(6), started: iso(6), finished: iso(4), duration_s: 120, queued_s: 0 },
    ],
    estimate: { eta: null, basis: 'jobs', samples: 3, jobs: { test: { n: 3, median_s: 600, start: null, end: null, samples_s: [600, 600, 600] } } },
  })
  const g = gantt(r, NOW, 30)
  assert.equal(g.legend, legend())
  const bars = g.rows.map(x => x.cells.map(c => c.text).join(''))
  assert.match(bars[0], /^░+█+·*│?·*$/)
  assert.match(bars[1], /▓+┄+/)
  assert.match(bars[2], /▒+/)
  assert.ok(bars.every(b => [...b].length === 30))
})

test('the headline runner part reads like lib/core/runner.mjs from the same cache', () => {
  const queue = { backend: 'gitlab-local', label: 'GitLab runner on this PC', tag: 'local-windows', running: 6, pending: 0, runners_online: 1, pipelines_open: 1, concurrent: 18, wait_s: null, wait_n: 0 }
  const d = { generated: iso(1), hosts: [], apps: [], conversations: [], summary: { queue } }
  const core = runnerLine(runnerLoad({ generated: d.generated, summary: { queue } }, NOW))
  assert.equal(core, 'runner local à 6/18')
  assert.ok(headline(d, 'all').includes(core), headline(d, 'all'))
})
