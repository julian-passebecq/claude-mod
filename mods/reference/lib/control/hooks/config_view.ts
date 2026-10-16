// Pure helpers of the CONFIG pane (/config-claude): search, paging, toggles. No `$`, so tests call them directly.
import type { ConfigData, ConfigItem } from '../types'

export type Hit = { item: ConfigItem; where: string; snippet: string }

/** Open/close one id in a list of open ids. */
export const toggle = (list: readonly string[], id: string): string[] =>
  list.includes(id) ? list.filter(x => x !== id) : [...list, id]

/** Every item with its 'category › sub-category' path. */
export const allItems = (data: ConfigData): { item: ConfigItem; where: string }[] =>
  data.categories.flatMap(c => c.subs.flatMap(s => s.items.map(item => ({ item, where: `${c.title} › ${s.title}` }))))

const around = (text: string, at: number, len: number, span = 70): string => {
  const a = Math.max(0, at - span)
  const b = Math.min(text.length, at + len + span)
  return `${a > 0 ? '…' : ''}${text.slice(a, b).replace(/\s+/g, ' ')}${b < text.length ? '…' : ''}`
}

/** Items whose name, path, summary, fields or full text contain every word of the query (case-insensitive). The
 * snippet comes from the first place the first word appears. */
export const searchConfig = (
  data: ConfigData,
  contents: Record<string, string>,
  query: string,
  limit = 50,
): { hits: Hit[]; total: number } => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return { hits: [], total: 0 }
  const hits: Hit[] = []
  let total = 0
  for (const { item, where } of allItems(data)) {
    const head = [item.name, item.path, item.summary, where, ...item.meta.map(([k, v]) => `${k} ${v}`)].join('\n')
    const body = contents[item.id] ?? ''
    const hay = `${head}\n${body}`.toLowerCase()
    if (!words.every(w => hay.includes(w))) continue
    total++
    if (hits.length >= limit) continue
    const inHead = head.toLowerCase().indexOf(words[0]!)
    const inBody = body.toLowerCase().indexOf(words[0]!)
    const snippet = inBody >= 0 && inHead < 0 ? around(body, inBody, words[0]!.length) : inHead >= 0 ? around(head, inHead, words[0]!.length) : ''
    hits.push({ item, where, snippet })
  }
  return { hits, total }
}

/** One page of a long text: the pane draws at most `size` characters at once (a drawing holds 100,000). */
export const pageOf = (text: string, page: number, size: number): { text: string; page: number; pages: number } => {
  const pages = Math.max(1, Math.ceil(text.length / size))
  const p = Math.min(Math.max(0, page), pages - 1)
  return { text: text.slice(p * size, (p + 1) * size), page: p, pages }
}

/** 2048 -> '2.0 KB', 3_500_000 -> '3.3 MB'. */
export const sizeText = (n: number | null | undefined): string =>
  n == null ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`

/** The language the raw viewer highlights an item with. */
export const languageOf = (item: ConfigItem): string | undefined =>
  item.kind === 'json' ? 'json' : item.kind === 'md' ? 'markdown' : undefined
