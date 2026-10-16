// problemes → eta export: node --test mods/problemes/tests/export.test.mjs (fixture register only).
// Secrets are assembled from pieces so this file passes the repo's confidentiality scan.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { MARK, registerFiles, staleOf } from '../lib/export.mjs'
import { drift } from '../scripts/sync-libs.mjs'
import { config, etaSettings, exportRegister } from '../scanner/problemes_scan.mjs'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const AT = '@'
const TOKEN = 'gh' + 'p_' + 'Xy7'.repeat(12)
const CATS = [{ id: 'ci', label: 'CI' }, { id: 'workflow', label: 'Workflow', children: [{ id: 'workflow/arrets', label: 'Arrêts' }] }]
const P = (id, o = {}) => ({ id, title: `Problème ${id}`, category: 'ci', status: 'ouvert', count: 2, first_seen: NOW - 86400000, last_seen: NOW - 3600000, symptom: 's', cause: 'c', fix: '', notes: [], evidence: [], apps: [], source: 'auto', ...o })

test('the lib/eta copies are current copies of export-eta (sync-libs drift check)', () => {
  assert.deepEqual(drift(), [])
})

test('one REGISTRE.md with a summary table, problems grouped by category, secrets masked', () => {
  const problems = [P('P-001', { symptom: `token ${TOKEN}` }), P('P-002', { category: 'workflow/arrets', cause: `écrire à bob${AT}client-corp.com`, notes: [{ at: NOW, text: 'vu en CI' }] }), P('P-003', { status: 'corrigé', fix: 'PR #12' })]
  const r = registerFiles(problems, { categories: CATS, eta: { dest_dir: 'sources/problemes' } }, NOW, [])
  assert.equal(r.files.length, 1)
  assert.equal(r.split, false)
  const md = r.files[0].content
  assert.ok(md.startsWith(MARK))
  assert.equal(r.files[0].path, 'sources/problemes/REGISTRE.md')
  assert.match(md, /\| CI \| 1 \| 2 \|/)
  assert.match(md, /\| Workflow \| 1 \| 1 \|/)
  assert.match(md, /### P-002 · Problème P-002/)
  assert.match(md, /Arrêts \(`workflow\/arrets`\)/)
  assert.match(md, /Note .* : vu en CI/)
  assert.ok(!md.includes(TOKEN) && !md.includes('client-corp.com'))
  assert.equal(r.masked['github-token'], 1)
  assert.equal(r.masked.email, 1)
  assert.ok(md.indexOf('P-001') < md.indexOf('P-003'), 'open ones first')
})

test('past max_kb: REGISTRE.md is an index and each category has its file; an unmaskable one is held back and named', () => {
  const big = 'x'.repeat(900)
  const problems = Array.from({ length: 12 }, (_, i) => P(`P-${100 + i}`, { category: i % 2 ? 'ci' : 'workflow/arrets', symptom: big }))
  problems.push(P('P-200', { category: 'workflow/arrets', symptom: 'clé ' + '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIE (coupée)' }))
  const r = registerFiles(problems, { categories: CATS, eta: { max_kb: 4 } }, NOW, [])
  assert.equal(r.split, true)
  assert.deepEqual(r.files.map((f) => f.path).sort(), ['sources/problemes/REGISTRE.md', 'sources/problemes/ci.md'])
  assert.deepEqual(r.held.map((h) => h.path), ['sources/problemes/workflow.md'])
  assert.match(r.files.find((f) => f.path.endsWith('REGISTRE.md')).content, /\[CI\]\(ci\.md\)/)
  assert.match(r.files.find((f) => f.path.endsWith('REGISTRE.md')).content, /Retenus \(secret non masquable\) : workflow\.md/)
})

test('staleOf removes only files an earlier export wrote', () => {
  const existing = [{ path: 'd/old.md', content: MARK + '\n#' }, { path: 'd/hand.md', content: '# notes by hand' }, { path: 'd/REGISTRE.md', content: MARK }]
  assert.deepEqual(staleOf(existing, [{ path: 'd/REGISTRE.md' }]), ['d/old.md'])
})

test('exportRegister --out: reads the ledger, writes the register, records the export; repo and e-mails come from export-eta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'problemes-export-'))
  const data = path.join(dir, 'data')
  const etaHome = path.join(dir, 'export-eta')
  fs.mkdirSync(data, { recursive: true })
  fs.mkdirSync(etaHome, { recursive: true })
  const own = 'me' + AT + 'mine.dev'
  fs.writeFileSync(path.join(etaHome, 'config.json'), JSON.stringify({ eta: { repo: 'C:/code/eta', branch: 'export/conversations-{day}' }, own_emails: [own] }))
  fs.writeFileSync(path.join(data, 'register.jsonl'), [
    { op: 'add', id: 'P-001', at: NOW, signature: 's1', category: 'ci', title: 'CI rouge', symptom: `écrire à ${own}`, status: 'ouvert', first_seen: NOW },
    { op: 'seen', id: 'P-001', at: NOW, n: 3, first: NOW, last: NOW },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n')
  const cfg = config({ ...process.env, PROBLEMES_DIR: data, EXPORT_ETA_HOME: etaHome })
  const s = etaSettings(cfg)
  assert.equal(s.E.repo, 'C:/code/eta', 'the eta repo is set once, in export-eta config')
  assert.equal(s.E.branch, 'export/problemes-{day}-{hm}', 'its own branch name, not the conversations one')
  const out = path.join(dir, 'eta')
  const e = exportRegister(cfg, { out, now: NOW })
  const md = fs.readFileSync(path.join(out, 'sources', 'problemes', 'REGISTRE.md'), 'utf8')
  assert.match(md, /CI rouge/)
  assert.match(md, /vu 3 fois/)
  assert.deepEqual(e.files, ['sources/problemes/REGISTRE.md'])
  const hist = JSON.parse(fs.readFileSync(path.join(data, 'export.json'), 'utf8'))
  assert.equal(hist.history[0].problems, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})
