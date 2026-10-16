// MODE-EMPLOI.md as a tree: `##` = a tab, `###` = a category, `####` = a sub-section.
// Pure: the pane, the build script (scripts/build.mjs) and node --test all use it.
import type { Doc, Section, Tab } from '../types'

/** GitHub's heading anchor: lower case, punctuation dropped (letters of any script kept), spaces to dashes. */
export function slug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

const TOC = /<!-- toc:start -->[\s\S]*?<!-- toc:end -->/

/** Splits the guide into tabs, categories and sub-sections. The table of contents block is left out of every body. */
export function parse(md: string): Doc {
  const text = md.replace(/\r\n/g, '\n').replace(TOC, '')
  const doc: Doc = { title: '', intro: '', tabs: [] }
  let tab: Tab | undefined
  let cat: Section | undefined
  let sub: Section | undefined
  const body: string[] = []
  let fence = false
  const flush = () => {
    const t = body.join('\n').trim()
    body.length = 0
    if (sub) sub.body = t
    else if (cat) cat.body = t
    else if (tab) tab.intro = t
    else doc.intro = t
  }
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence
    const m = fence ? null : /^(#{1,4})\s+(.*?)\s*$/.exec(line)
    if (!m) {
      body.push(line)
      continue
    }
    const level = m[1]!.length
    const title = m[2]!
    flush()
    if (level === 1) doc.title = title
    else if (level === 2) {
      tab = { id: slug(title), title, intro: '', cats: [] }
      doc.tabs.push(tab)
      cat = undefined
      sub = undefined
    } else if (level === 3 && tab) {
      cat = { id: slug(title), title, body: '', subs: [] }
      tab.cats.push(cat)
      sub = undefined
    } else if (level === 4 && cat) {
      sub = { id: slug(title), title, body: '', subs: [] }
      cat.subs.push(sub)
    } else body.push(line)
  }
  flush()
  return doc
}

/** Every anchor of the tree, in order; the build script refuses a duplicate. */
export function anchors(doc: Doc): string[] {
  const out: string[] = []
  for (const t of doc.tabs) {
    out.push(t.id)
    for (const c of t.cats) {
      out.push(c.id)
      for (const s of c.subs) out.push(s.id)
    }
  }
  return out
}

/** The table of contents as nested Markdown links to the same anchors. */
export function tocMarkdown(doc: Doc): string {
  const lines: string[] = []
  for (const t of doc.tabs) {
    lines.push(`- [${t.title}](#${t.id})`)
    for (const c of t.cats) {
      lines.push(`  - [${c.title}](#${c.id})`)
      for (const s of c.subs) lines.push(`    - [${s.title}](#${s.id})`)
    }
  }
  return lines.join('\n')
}

/** Puts a fresh table of contents between the markers (the markers must be there). */
export function withToc(md: string): string {
  const toc = tocMarkdown(parse(md))
  return md.replace(TOC, `<!-- toc:start -->\n${toc}\n<!-- toc:end -->`)
}

/** Replaces what lies between `<!-- name:start -->` and `<!-- name:end -->`. */
export function between(md: string, name: string, content: string): string {
  const re = new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->`)
  return md.replace(re, `<!-- ${name}:start -->\n${content}\n<!-- ${name}:end -->`)
}

/** Where a press on a Sommaire link leads: the tab, the category to unfold and the sub-section to mark. */
export function locate(doc: Doc, anchor: string): { tab: string; cat: string; sub: string } | undefined {
  for (const t of doc.tabs) {
    if (t.id === anchor) return { tab: t.id, cat: '', sub: '' }
    for (const c of t.cats) {
      if (c.id === anchor) return { tab: t.id, cat: c.id, sub: '' }
      for (const s of c.subs) if (s.id === anchor) return { tab: t.id, cat: c.id, sub: s.id }
    }
  }
  return undefined
}
