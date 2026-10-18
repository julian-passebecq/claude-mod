// A tiny text renderer for the element trees draw.mjs builds (Box, Text, Button, Link), used by the preview and the
// layout tests: it shows a screen at a given pane width in columns, so we can check that nothing is wider than the pane.
// Not the engine's renderer: borders, padding, marginLeft/Bottom, row flow (wrap) and flexGrow columns only.

export const el = {
  Box: (props) => ({ type: 'Box', props }),
  Text: (props) => ({ type: 'Text', props }),
  Button: (props) => ({ type: 'Button', props }),
  Link: (props) => ({ type: 'Link', props }),
}

const len = (s) => [...s].length

function textOf(n) {
  // a Button may hold Text children (a bold title): their text is its text
  return (n.props.children || []).map((c) => (typeof c === 'string' ? c : c && c.type === 'Text' ? textOf(c) : '')).join('')
}

export function wrapText(s, w) {
  const out = []
  for (const para of String(s).split('\n')) {
    let cur = ''
    for (const word of para.split(' ')) {
      let wd = word
      while (len(wd) > w) { // a word longer than the line: hard split
        if (cur) { out.push(cur); cur = '' }
        out.push([...wd].slice(0, w).join(''))
        wd = [...wd].slice(w).join('')
      }
      if (!cur) cur = wd
      else if (len(cur) + 1 + len(wd) <= w) cur += ' ' + wd
      else { out.push(cur); cur = wd }
    }
    out.push(cur)
  }
  return out
}

const pad = (s, w) => s + ' '.repeat(Math.max(0, w - len(s)))

export function render(n, width) {
  if (!n) return []
  if (typeof n === 'string') return wrapText(n, width)
  const p = n.props || {}
  if (n.type === 'Text') return wrapText(textOf(n), width)
  if (n.type === 'Button') return wrapText(`[${textOf(n)}]`, width)
  if (n.type === 'Link') return wrapText(`<${textOf(n)}>`, width)
  const kids = (p.children || []).filter(Boolean)
  const ml = p.marginLeft || 0
  const border = p.borderStyle ? 1 : 0
  const px = p.paddingX || 0
  const inner = Math.max(4, width - ml - 2 * border - 2 * px)
  let lines = []
  if (p.flexDirection === 'row') {
    const gap = p.gap ?? 1
    if (kids.some((k) => k.props && k.props.flexGrow)) {
      // a child with a fixed `width` keeps it; the others share what is left
      const fixed = kids.reduce((a, k) => a + ((k.props && k.props.width) || 0), 0)
      const free = kids.filter((k) => !(k.props && k.props.width)).length || 1
      const w = Math.max(4, Math.floor((inner - fixed - gap * (kids.length - 1)) / free))
      const ws = kids.map((k) => (k.props && k.props.width) || w)
      const cols = kids.map((k, i) => render(k, ws[i]))
      const h = Math.max(...cols.map((c) => c.length))
      for (let i = 0; i < h; i++) lines.push(cols.map((c, j) => pad(c[i] || '', ws[j])).join(' '.repeat(gap)).trimEnd())
    } else {
      let cur = ''
      for (const k of kids) {
        const r = render(k, inner)
        if (r.length !== 1) { if (cur) lines.push(cur); cur = ''; lines.push(...r); continue }
        const piece = r[0]
        if (!cur) cur = piece
        else if (len(cur) + gap + len(piece) <= inner) cur += ' '.repeat(gap) + piece
        else { lines.push(cur); cur = piece }
      }
      if (cur) lines.push(cur)
    }
  } else {
    for (const k of kids) lines.push(...render(k, inner))
  }
  if (px) lines = lines.map((l) => ' '.repeat(px) + pad(l, inner) + ' '.repeat(px))
  if (border) {
    const w = inner + 2 * px
    lines = ['╭' + '─'.repeat(w) + '╮', ...lines.map((l) => '│' + pad(l, w) + '│'), '╰' + '─'.repeat(w) + '╯']
  }
  if (ml) lines = lines.map((l) => ' '.repeat(ml) + l)
  if (p.marginBottom) lines.push(...Array(p.marginBottom).fill(''))
  return lines
}

export function renderText(tree, width) {
  return render(tree, width).map((l) => l.trimEnd()).join('\n')
}

export function widest(text) {
  return Math.max(0, ...String(text).split('\n').map(len))
}
