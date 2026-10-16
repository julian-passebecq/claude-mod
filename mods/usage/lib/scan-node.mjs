// Incremental transcript scanner (Node, standard library only). Shared: other mods import `scanProjects`.
// Reads only what was appended since the last run (byte offset per file), keeps per-hour rows for `retentionDays`,
// and never reads a file whose last change is older than that. Credentials are never opened: only *.jsonl under
// the projects folder are read.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { feedLine, kindOfPath, newFileState, prune } from './transcripts.mjs'

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
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

export function loadCache(path) {
  try {
    const c = JSON.parse(readFileSync(path, 'utf8'))
    if (c && c.version === 1 && c.files) return c
  } catch {}
  return { version: 1, files: {} }
}

export function saveCache(path, cache) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(cache))
  renameSync(tmp, path)
}

/** Reads the bytes of `path` from `st.offset` to `size`, feeding whole lines; a partial last line waits for next time. */
function readFrom(path, st, size, opts) {
  const fd = openSync(path, 'r')
  try {
    let pos = st.offset
    let rest = Buffer.alloc(0)
    const buf = Buffer.alloc(CHUNK)
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos)
      if (n <= 0) break
      pos += n
      let data = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n)
      let start = 0
      for (let i = data.indexOf(10); i >= 0; i = data.indexOf(10, start)) {
        feedLine(st, data.toString('utf8', start, i), opts)
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
 * Brings `cache` up to date with the transcripts under `root`. Returns { files, read, skipped, bytes }.
 * `prices` is lib/prices.json (merged with overrides); `retentionDays` bounds both what is read and what is kept.
 */
export function scanProjects({ root, cache, prices, now = Date.now(), retentionDays = 14, idleGapS = 300 }) {
  const from = now - retentionDays * 86400000
  const seen = new Set()
  for (const st of Object.values(cache.files)) for (const k of Object.keys(st.keys || {})) seen.add(k)
  const claim = k => (seen.has(k) ? false : (seen.add(k), true))
  const present = new Set()
  let read = 0
  let skipped = 0
  let bytes = 0
  // oldest first, so a request copied into a later file (a fork or a resume) counts where it first appeared
  const paths = existsSync(root) ? walk(root) : []
  const stats = paths.map(p => {
    try {
      return [p, statSync(p)]
    } catch {
      return [p, null]
    }
  }).filter(x => x[1]).sort((a, b) => a[1].birthtimeMs - b[1].birthtimeMs || a[1].mtimeMs - b[1].mtimeMs)
  for (const [p, s] of stats) {
    const rel = relative(root, p).replace(/\\/g, '/')
    present.add(rel)
    let st = cache.files[rel]
    if (s.mtimeMs < from) {
      if (st) delete cache.files[rel]
      skipped++
      continue
    }
    if (!st || s.size < st.offset) st = cache.files[rel] = newFileState(kindOfPath(rel))
    if (s.size > st.offset) {
      bytes += s.size - st.offset
      readFrom(p, st, s.size, { prices, claim, idleGapS })
      read++
    }
    prune(st, from)
  }
  for (const rel of Object.keys(cache.files)) if (!present.has(rel)) delete cache.files[rel]
  return { files: cache.files, read, skipped, bytes }
}
