// veille Fil: node --test mods/veille/tests/fil.test.mjs (fixture session files and transcripts, no real data)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  buildFil, endsWithQuestion, filterFil, flatten, incoherenceOf, isNew, julianAlerts, lastMessage, markAllRead, markRead,
  mask, previewOf, projectOf, summaryLine,
} from '../lib/fil.mjs'
import { buildFromDisk, writeFil } from '../watcher/fil.mjs'
import { filText } from '../hooks/fil-view.mjs'
import { BIN_FILES } from '../watcher/veille.mjs'
import { FAKE_TOKEN, MIN, appJson, sessions } from './fixtures/fil.mjs'

// A fixed "now": the latest local noon already past. The fixtures sit within 26 h of it, so « aujourd'hui » (same local day)
// never straddles midnight whatever the clock or the timezone (TZ) the tests run in; every mtime stays in the past.
function lastLocalNoon(real = Date.now()) {
  const d = new Date(real)
  d.setHours(12, 0, 0, 0)
  if (d.getTime() > real) d.setDate(d.getDate() - 1)
  return d.getTime()
}
const NOW = lastLocalNoon(process.env.FIL_TEST_REAL_NOW ? Date.parse(process.env.FIL_TEST_REAL_NOW) : Date.now())
const CFG = JSON.parse(fs.readFileSync(new URL('../veille.config.json', import.meta.url), 'utf8'))

// Lays the fixtures out as the desktop app and Claude Code do, with each transcript's mtime set.
function layout(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veille-fil-'))
  const app = path.join(root, 'app', 'acct', 'org')
  const projects = path.join(root, 'projects')
  fs.mkdirSync(app, { recursive: true })
  for (const s of sessions(NOW)) {
    const o = { ...s, ...(over[s.id] || {}) }
    fs.writeFileSync(path.join(app, `local_${o.id}.json`), JSON.stringify(appJson(o, NOW)))
    const dir = path.join(projects, o.cwd.replace(/[^A-Za-z0-9]/g, '-'))
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, `${o.cli}.jsonl`)
    fs.writeFileSync(f, o.lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    const t = (NOW - o.mtimeAgo * MIN) / 1000
    fs.utimesSync(f, t, t)
  }
  return { root, app: path.join(root, 'app'), projects }
}

const byTitle = (fil) => Object.fromEntries(fil.projects.flatMap((p) => flatten(p.convs)).map((c) => [c.title, c]))

test('grouping: by project, lead → sub-conversations (even in another repo), sorted by last activity', () => {
  const d = layout()
  try {
    const fil = buildFromDisk({ fil: {} }, { app: d.app, projects: d.projects, nowMs: NOW })
    assert.deepEqual(fil.projects.map((p) => p.name), ['beta', 'gamma', 'alpha'])
    const alpha = fil.projects.find((p) => p.name === 'alpha')
    assert.equal(alpha.convs.length, 1, 'one lead')
    assert.equal(alpha.convs[0].title, 'Alpha lead')
    assert.deepEqual(alpha.convs[0].children.map((c) => c.title), ['Alpha lane: needs input', 'Alpha lane: merge #29'], 'children by last activity; kid1 lives in beta but follows its lead')
    assert.equal(alpha.total, 3)
    const beta = fil.projects.find((p) => p.name === 'beta')
    assert.deepEqual(beta.convs.map((c) => c.title), ['Beta live work', 'Beta release', 'Beta blocked'], 'archived from yesterday left out (archived: aujourdhui)')
    assert.equal(fil.total, 7)
    const withOld = buildFromDisk({ fil: { archived: 'oui' } }, { app: d.app, projects: d.projects, nowMs: NOW })
    assert.equal(withOld.total, 8)
    const only = buildFromDisk({ fil: { projects: ['Gamma'] } }, { app: d.app, projects: d.projects, nowMs: NOW })
    assert.deepEqual(only.projects.map((p) => p.name), ['gamma'])
    const capped = buildFromDisk({ fil: { per_project: 1 } }, { app: d.app, projects: d.projects, nowMs: NOW })
    const b = capped.projects.find((p) => p.name === 'beta')
    assert.deepEqual(flatten(b.convs).map((c) => c.title), ['Beta live work', 'Beta release'], 'the cap never hides what waits on Julian')
    assert.equal(b.hidden, 1)
    // the watcher writes fil.json
    const file = path.join(d.root, 'veille', 'fil.json')
    writeFil({ fil: {} }, file, { app: d.app, projects: d.projects, nowMs: NOW })
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).total, 7)
  } finally { fs.rmSync(d.root, { recursive: true, force: true }) }
})

test('states and the « attend Julian » signals: AskUserQuestion, closing question, contradiction, wrap_up ask, blocked, live', () => {
  const d = layout()
  try {
    const fil = buildFromDisk({ fil: {} }, { app: d.app, projects: d.projects, nowMs: NOW })
    const c = byTitle(fil)
    assert.equal(c['Alpha lane: needs input'].state, 'attend')
    assert.equal(c['Alpha lane: needs input'].signal, 'pending_ask')
    assert.match(c['Alpha lane: needs input'].ask, /Needs your input: keep the old schema\?/)
    assert.equal(c['Alpha lane: merge #29'].signal, 'question')
    assert.match(c['Alpha lane: merge #29'].ask, /^Tell me whether the #29 merge stays/)
    assert.equal(c['Beta release'].signal, 'incoherence')
    assert.match(c['Beta release'].ask, /^Incohérence entre consignes : Your message said no merge/)
    assert.equal(c['Gamma plan'].signal, 'wrap')
    assert.equal(c['Gamma plan'].ask, 'Start step 1 now?')
    assert.deepEqual(c['Gamma plan'].actions, ['Start', 'Wait'])
    assert.equal(c['Beta live work'].state, 'en_cours')
    assert.equal(c['Beta blocked'].state, 'bloquee')
    assert.equal(c['Beta blocked'].signal, '', 'an old wrap_up ask (a prompt came after it) is not current')
    assert.equal(c['Alpha lead'].state, 'terminee')
    assert.equal(fil.julian, 4)
    // one alert per conversation and per question; a new question is a new key
    const keys = julianAlerts(fil).map((a) => a.key)
    assert.equal(keys.length, 4)
    assert.ok(keys.every((k) => /^fil-(pending_ask|question|incoherence|wrap):c-/.test(k)))
    assert.deepEqual(julianAlerts(fil).map((a) => a.key), keys, 'stable')
    for (const k of julianAlerts(fil).map((a) => a.kind)) assert.ok(CFG.alerts.julian_kinds.includes(k), `${k} is a Julian kind`)
    const d2 = layout({ kid2: { lines: [{ type: 'user', timestamp: new Date(NOW - 40 * MIN).toISOString(), message: { content: 'x' } }, { type: 'assistant', timestamp: new Date(NOW - 25 * MIN).toISOString(), message: { id: 'z', content: [{ type: 'text', text: 'Should I revert #30 instead?' }] } }] } })
    try {
      const k2 = julianAlerts(buildFromDisk({ fil: {} }, { app: d2.app, projects: d2.projects, nowMs: NOW })).map((a) => a.key)
      assert.equal(k2.filter((k) => !keys.includes(k)).length, 1, 'another question, another alert')
    } finally { fs.rmSync(d2.root, { recursive: true, force: true }) }
  } finally { fs.rmSync(d.root, { recursive: true, force: true }) }
})

test('last message: wrap_up recap preferred for the preview, else the last text; tool noise left out; secrets masked', () => {
  const d = layout()
  try {
    const c = byTitle(buildFromDisk({ fil: {} }, { app: d.app, projects: d.projects, nowMs: NOW }))
    const lead = c['Alpha lead']
    assert.equal(lead.from_wrap, true)
    assert.equal(lead.preview, 'The feature is merged and tests pass. Nothing is left.')
    assert.match(lead.text, /^## Done/, 'full message is the last text, Markdown kept')
    assert.ok(!/npm test|Old answer/.test(lead.text))
    assert.deepEqual(lead.prs.map((p) => p.url), ['https://github.com/acme/alpha/pull/12'])
    assert.equal(lead.prs[0].state, 'merged')
    assert.equal(lead.link, 'claude://claude.ai/epitaxy/local_lead1')
    const blocked = c['Beta blocked']
    assert.equal(blocked.from_wrap, false)
    assert.match(blocked.preview, /^CI is still red/)
    const k2 = c['Alpha lane: merge #29']
    assert.ok(!k2.text.includes(FAKE_TOKEN) && !k2.preview.includes(FAKE_TOKEN), 'token masked')
    assert.match(k2.text, /•••/)
  } finally { fs.rmSync(d.root, { recursive: true, force: true }) }
  const m = lastMessage([
    { type: 'user', message: { content: 'go' } },
    { type: 'assistant', message: { id: 'a', content: [{ type: 'text', text: 'part 1' }] } },
    { type: 'assistant', message: { id: 'a', content: [{ type: 'text', text: 'part 2' }] } },
    { type: 'assistant', message: { id: 'b', model: '<synthetic>', content: [{ type: 'text', text: 'synthetic' }] } },
  ])
  assert.equal(m.text, 'part 1\n\npart 2', 'streamed blocks of one message joined; synthetic turns skipped')
})

test('masking, questions, contradictions, previews, projects', () => {
  assert.equal(mask(`key ${FAKE_TOKEN} end`), 'key ••• end')
  assert.equal(mask('password: hunter2x'), 'password: •••')
  assert.equal(mask('Authorization: Bearer abcdef123456'), 'Authorization: Bearer •••')
  assert.equal(mask('sha 3f2a9c0b1d4e5f60718293a4b5c6d7e8f9a0b1c2 stays'), 'sha 3f2a9c0b1d4e5f60718293a4b5c6d7e8f9a0b1c2 stays')
  assert.equal(mask('x ' + 'Ab9'.repeat(15)), 'x •••')
  assert.equal(endsWithQuestion('Done.\n\nShould I merge it?'), 'Should I merge it?')
  assert.equal(endsWithQuestion('Fini.\n\nDois-je lancer la suite.'), 'Dois-je lancer la suite.')
  assert.equal(endsWithQuestion('PR merged.\n\nVérifié à 21:03'), '')
  assert.equal(endsWithQuestion('Is it ok?\n\nVérifié à 21:03'), 'Is it ok?')
  assert.equal(endsWithQuestion('Start the night run ?'), 'Start the night run ?')
  assert.equal(endsWithQuestion('All merged. Nothing is waiting on you.'), '')
  assert.equal(incoherenceOf('Nothing to report.'), '')
  assert.match(incoherenceOf('Le paquet dit « pas de merge » : consigne contraire aux règles.'), /consigne contraire/)
  assert.match(incoherenceOf('This contradicts the rules file.'), /contradicts/)
  assert.equal(previewOf('# Title\n\n- **one** line\n- two\n- three', 100), 'Title · one line')
  assert.equal(previewOf('x'.repeat(50), 10).length, 10)
  assert.equal(projectOf('C:\\work\\alpha\\.claude\\worktrees\\lane-1'), 'alpha')
  assert.equal(projectOf('/srv/gamma'), 'gamma')
  assert.equal(projectOf('C:/Users/me'), '~')
})

test('new since last read, filters, summary line, text render', () => {
  const d = layout()
  try {
    const fil = buildFil([], {}, NOW)
    assert.equal(fil.total, 0)
    const f = buildFromDisk({ fil: {} }, { app: d.app, projects: d.projects, nowMs: NOW })
    const c = byTitle(f)
    let read = markAllRead(NOW - 15 * MIN)
    assert.equal(isNew(c['Beta release'], read), true, 'message at -10 min after reading at -15 min')
    assert.equal(isNew(c['Alpha lane: merge #29'], read), false)
    read = markRead(read, c['Beta release'].sid, NOW)
    assert.equal(isNew(c['Beta release'], read), false)
    assert.equal(isNew(c['Beta release'], null), false, 'never read: nothing flagged')
    const attend = filterFil(f, 'attend', '', NOW)
    const shown = attend.projects.flatMap((p) => flatten(p.convs))
    assert.deepEqual(shown.filter((x) => !x.dim).map((x) => x.title).sort(), ['Alpha lane: merge #29', 'Alpha lane: needs input', 'Beta release', 'Gamma plan'])
    assert.ok(shown.find((x) => x.title === 'Alpha lead').dim, 'the lead stays, dimmed, to hold its children')
    assert.deepEqual(filterFil(f, 'bloquee', '', NOW).projects.flatMap((p) => flatten(p.convs)).map((x) => x.title), ['Beta blocked'])
    assert.deepEqual(filterFil(f, 'terminee_auj', '', NOW).projects.flatMap((p) => flatten(p.convs)).filter((x) => !x.dim).map((x) => x.title), ['Alpha lead'])
    assert.deepEqual(filterFil(f, 'projet', 'gamma', NOW).projects.map((p) => p.name), ['gamma'])
    const beta = f.projects.find((p) => p.name === 'beta')
    assert.match(summaryLine(beta), /^3 conv · 1 en cours · 1 attend Julian · 1 bloquée\(s\) · dernière activité \d\d:\d\d$/)
    const lines = filText(f, CFG, {}, null, NOW, 75)
    assert.match(lines[0], /attend Julian : 4/)
    assert.ok(lines.every((l) => l.length <= 75))
    assert.ok(lines.some((l) => /^ {4}● attend Julian · Alpha lane: needs input/.test(l)), 'children indented under their lead')
  } finally { fs.rmSync(d.root, { recursive: true, force: true }) }
})

test('the installed copy carries the Fil files', () => {
  for (const f of ['veille/lib/fil.mjs', 'veille/watcher/fil.mjs']) assert.ok(BIN_FILES.includes(f), f)
})

// « À archiver » runs with the Fil tests (CI's node --test list names this file)
import './archive.test.mjs'
