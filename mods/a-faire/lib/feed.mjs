// a-faire - what the veille watcher pushes (Windows notification + e-mail digest), once per item.
// The watcher imports this file when the a-faire mod sits beside veille (or in its bin copy); otherwise it skips.
//   const items = await veilleFeed({ gh, env })   ->  [{ key, what, title, since, link, prio, cat }]
// Remembered in ~/.claude/a-faire/notified.json (id -> first push time), so an item is pushed once, even after a snooze.
import path from 'node:path'
import { loadConfig, readJson, scan, writeAtomic } from './collect.mjs'
import { feedOf } from './items.mjs'

export async function veilleFeed(opts = {}) {
  const cfg = opts.cfg || loadConfig(opts.home)
  const F = cfg.veille_feed || {}
  if (F.enabled === false) return []
  const now = opts.now || Date.now()
  const { open } = await scan(cfg, { ...opts, now })
  const file = path.join(cfg.home, 'notified.json')
  const notified = readJson(file, {}) || {}
  const fresh = feedOf(open, notified, F.prios || ['now', 'feature']).slice(0, F.max_per_tour || 5)
  if (!fresh.length) return []
  const keep = Object.fromEntries(Object.entries(notified).filter(([, t]) => now - t < 90 * 86400000))
  for (const i of fresh) keep[i.id] = now
  if (!opts.dry) writeAtomic(file, keep)
  const L = cfg.labels || {}
  return fresh.map((i) => ({
    key: `afaire:${i.id}`, what: `${L.feed_prefix || 'À faire'} : ${i.title}`, title: (cfg.categories || {})[i.cat] || i.cat,
    since: i.since || now, link: i.source && /^https?:/.test(i.source.href) ? i.source.href : '', prio: i.prio, cat: i.cat,
  }))
}
