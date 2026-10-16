// Canonical copy: lib/core/veille.mjs (repo root). Every mods/<mod>/lib/core/veille.mjs is a byte copy made by
// scripts/sync-libs.mjs: never edit a copy by hand.
// The veille's state as files (~/.claude/veille: state.json alerts, acks.jsonl, fil.json) and a-faire's counts
// (~/.claude/a-faire/summary.json). ONE count of what waits on Julian (attendJulian) and of his to-dos (aToi), so
// every view shows the same number. Pure functions plus one reader; VEILLE_HOME / AFAIRE_HOME move the folders.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const RANK = { julian: 0, bad: 1, warn: 2, info: 3 }

const home = (p, h = os.homedir()) => String(p).replace(/^~(?=$|[\\/])/, h)

/** acks.jsonl text -> acked keys. */
export function parseAcks(text) {
  const out = []
  for (const l of String(text || '').split('\n')) {
    if (!l.trim()) continue
    try {
      const k = JSON.parse(l).key
      if (k !== undefined && k !== null && k !== '') out.push(String(k))
    } catch { /* partial line */ }
  }
  return out
}

/** Open (not acknowledged) alerts of state.json, Julian first, then severity, then oldest. */
export function openAlerts(state, acks = []) {
  if (!state || typeof state !== 'object') return []
  const ack = new Set(acks)
  return Object.values(state.alerts || {})
    .filter((a) => a && !(a.acked || ack.has(a.key) || ack.has('*')))
    .sort((a, b) => Number(!!b.julian) - Number(!!a.julian) || (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || (a.since ?? 0) - (b.since ?? 0))
}

/** « attend Julian : N »: open alerts marked julian. The one count every view uses. */
export function attendJulian(state, acks = []) {
  return openAlerts(state, acks).filter((a) => a.julian).length
}

/** « À toi : N »: a-faire's open items (summary.json written by its scanner), 0 when unknown. */
export function aToi(summary) {
  const n = summary && typeof summary === 'object' ? Number(summary.open) : 0
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/** Fil digest (fil.json) -> conversations waiting on Julian per the fil, newest first. */
export function filWaiting(fil) {
  const out = []
  const walk = (ns, project) => {
    for (const n of ns || []) {
      if (n.state === 'attend') out.push({ ...n, project, children: undefined })
      walk(n.children, project)
    }
  }
  for (const p of (fil && fil.projects) || []) walk(p.convs, p.name)
  return out.sort((a, b) => (b.last_at || 0) - (a.last_at || 0))
}

/** Everything above from disk. Missing files: available false, counts 0. */
export function readVeille({ veilleHome, afaireHome, env = process.env } = {}) {
  const vh = home(veilleHome || env.VEILLE_HOME || '~/.claude/veille')
  const ah = home(afaireHome || env.AFAIRE_HOME || '~/.claude/a-faire')
  const json = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) } catch { return null } }
  const text = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
  const state = json(path.join(vh, 'state.json'))
  const acks = parseAcks(text(path.join(vh, 'acks.jsonl')))
  const fil = json(path.join(vh, 'fil.json'))
  const summary = json(path.join(ah, 'summary.json'))
  const alerts = openAlerts(state, acks)
  return {
    available: !!state, alerts, open: alerts.length, julian: attendJulian(state, acks),
    fil, filWaiting: filWaiting(fil), aToi: aToi(summary), aToiAvailable: !!summary,
  }
}
