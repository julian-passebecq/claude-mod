// Incremental reader of Codex's rollout files (Node, standard library only).
// Reads only *.jsonl under the Codex sessions folder (default ~/.codex/sessions), from the byte offset reached last
// time; files untouched for `days` are skipped. Never opens auth.json, config.toml, .env or the sqlite databases.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { aggregateCodex, feedCodexLine, newCodexState } from './codex.mjs'

const CHUNK = 8 << 20

function walk(dir, out = []) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

function readFrom(path, st, size, tzMin) {
  const fd = openSync(path, 'r')
  try {
    let pos = st.offset
    let rest = Buffer.alloc(0)
    const buf = Buffer.alloc(CHUNK)
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos)
      if (n <= 0) break
      pos += n
      const data = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n)
      let start = 0
      for (let i = data.indexOf(10); i >= 0; i = data.indexOf(10, start)) {
        feedCodexLine(st, data.toString('utf8', start, i), tzMin)
        start = i + 1
      }
      rest = Buffer.from(data.subarray(start))
    }
    st.offset = pos - rest.length
  } finally {
    closeSync(fd)
  }
}

/**
 * Brings `cache` ({ version: 1, files }) up to date with the rollout files under `dir` and returns the aggregate
 * (lib/codex.mjs aggregateCodex) plus { read, bytes }. A missing folder gives { available: false }.
 */
export function scanCodex({ dir, cache, now = Date.now(), days = 8, tzMin = -new Date(now).getTimezoneOffset() }) {
  if (!dir || !existsSync(dir)) return { aggr: aggregateCodex({}, { now, available: false, dir, error: 'no_dir' }), read: 0, bytes: 0 }
  const from = now - days * 86400000
  const keepDay = new Date(from + tzMin * 60000).toISOString().slice(0, 10)
  const present = new Set()
  let read = 0
  let bytes = 0
  for (const p of walk(dir)) {
    let s
    try {
      s = statSync(p)
    } catch {
      continue
    }
    const rel = relative(dir, p).replace(/\\/g, '/')
    if (s.mtimeMs < from) continue
    present.add(rel)
    let st = cache.files[rel]
    if (!st || s.size < st.offset) st = cache.files[rel] = newCodexState()
    if (s.size > st.offset) {
      bytes += s.size - st.offset
      readFrom(p, st, s.size, tzMin)
      read++
    }
    for (const d of Object.keys(st.days)) if (d < keepDay) delete st.days[d]
  }
  for (const rel of Object.keys(cache.files)) if (!present.has(rel)) delete cache.files[rel]
  return { aggr: aggregateCodex(cache.files, { now, dir }), read, bytes }
}
