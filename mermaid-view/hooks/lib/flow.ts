// Mermaid flowcharts drawn as terminal text: filled cards, rounded lines and
// arrows laid out on a grid of cells, no picture. Read: `flowchart`/`graph`
// TD/TB/LR, nodes A[..] A(..) A([..]) A{..} A[(..)], `<br>` for a second line,
// `:::colour` classes, edges --> -.-> ==> with |labels|, and subgraph … end.
// Anything else returns null and stays a code block.

export const COLOURS = ['blue', 'green', 'orange', 'red', 'purple', 'yellow', 'teal', 'gray'] as const
export type Colour = (typeof COLOURS)[number]

export type FlowNode = { id: string; lines: string[]; shape: 'box' | 'round' | 'diamond' | 'db'; colour?: Colour; group?: number }
export type FlowEdge = { from: string; to: string; label: string; style: 'solid' | 'dotted' | 'thick' }
export type FlowGroup = { title: string }
export type Flow = { dir: 'TD' | 'LR'; nodes: FlowNode[]; edges: FlowEdge[]; groups: FlowGroup[] }

// One cell of the drawing: its character and what it belongs to. A wide
// character takes two cells; the second holds ''. `head` marks a card's
// first text line, `group` the subgraph whose background the cell is on.
export type Cell = {
  ch: string
  kind: 'space' | 'line' | 'arrow' | 'node' | 'border' | 'fill' | 'label' | 'title'
  node?: FlowNode
  // A colour of its own (a chart series), kept as drawn.
  hex?: string
  head?: boolean
  group?: number
}

const HEADER = /^\s*(flowchart|graph)\s+(TD|TB|LR|BT|RL)\b/i
const NODE = /^([A-Za-z_][\w-]*)\s*(\[\[|\[\(|\(\[|\(\(|\[|\(|\{\{|\{|>)?\s*(.*?)\s*(?::::\s*([\w-]+))?$/
const CLOSE: Record<string, string> = { '[[': ']]', '[(': ')]', '([': '])', '((': '))', '[': ']', '(': ')', '{{': '}}', '{': '}', '>': ']' }
const ARROW = /\s*(-->|---|-\.->|-\.-|==>|===|--\s*([^-|>][^>]*?)\s*-->|==\s*([^=][^>]*?)\s*==>|-\.\s*([^.]+?)\s*\.->)\s*(?:\|([^|]*)\|)?\s*/

export function parseFlow(src: string): Flow | null {
  const lines = src.split('\n').map(l => l.replace(/%%.*$/, '').trim()).filter(Boolean)
  const head = HEADER.exec(lines[0] ?? '')
  if (!head) return null
  const d = (head[2] ?? '').toUpperCase()
  if (d !== 'TD' && d !== 'TB' && d !== 'LR') return null
  const flow: Flow = { dir: d === 'LR' ? 'LR' : 'TD', nodes: [], edges: [], groups: [] }
  const byId = new Map<string, FlowNode>()
  const classes = new Map<string, Colour>()
  let group: number | undefined

  const node = (raw: string): string | null => {
    const m = NODE.exec(raw.trim())
    if (!m) return null
    const id = m[1] ?? ''
    const open = m[2]
    const colour = colourOf(m[4], classes)
    let text: string | null = null
    let shape: FlowNode['shape'] = 'box'
    if (open) {
      const close = CLOSE[open] ?? ']'
      const body = (m[3] ?? '').trim()
      if (!body.endsWith(close)) return null
      text = body.slice(0, -close.length).trim().replace(/^"(.*)"$/, '$1')
      shape = open === '{' || open === '{{' ? 'diamond' : open === '[(' ? 'db' : open.includes('(') ? 'round' : 'box'
    } else if ((m[3] ?? '').trim()) {
      return null
    }
    const known = byId.get(id)
    // Presentation selectors and joiners change a glyph's width from terminal
    // to terminal; without them each character's width is known.
    const lines = (text ?? id).replace(/[\uFE0E\uFE0F\u200D]/g, '').split(/<br\s*\/?>|\\n/i).map(l => l.trim()).filter(Boolean)
    if (!known) {
      const n: FlowNode = { id, lines: lines.length ? lines : [id], shape, colour, group }
      byId.set(id, n)
      flow.nodes.push(n)
    } else {
      if (text !== null) {
        known.lines = lines
        known.shape = shape
      }
      if (colour) known.colour = colour
      if (known.group === undefined) known.group = group
    }
    return id
  }

  for (const line of lines.slice(1)) {
    const sub = /^subgraph\s+(?:([\w-]+)\s*\[(.*)\]|"?(.*?)"?)\s*$/.exec(line)
    if (sub) {
      flow.groups.push({ title: (sub[2] ?? sub[3] ?? sub[1] ?? '').trim() })
      group = flow.groups.length - 1
      continue
    }
    if (/^end\b/.test(line)) {
      group = undefined
      continue
    }
    const def = /^classDef\s+([\w-]+)\s+(.*)$/.exec(line)
    if (def) {
      const c = colourOfStyle(def[2] ?? '')
      if (c) classes.set(def[1] ?? '', c)
      continue
    }
    const cls = /^class\s+([\w,\s-]+?)\s+([\w-]+)$/.exec(line)
    if (cls) {
      const c = colourOf(cls[2], classes)
      for (const id of (cls[1] ?? '').split(',').map(x => x.trim())) {
        const n = byId.get(id)
        if (n && c) n.colour = c
      }
      continue
    }
    if (/^(style|linkStyle|click|direction)\b/.test(line)) continue

    // A chain: node (arrow node)*. Arrows inside a node's brackets are text.
    const parts: string[] = []
    const arrows: RegExpExecArray[] = []
    let rest = line.replace(/;$/, '')
    for (;;) {
      const at = findArrow(rest)
      if (!at) break
      parts.push(rest.slice(0, at.index))
      arrows.push(at)
      rest = rest.slice(at.index + at[0].length)
    }
    parts.push(rest)
    // `A & B --> C` fans out: each side may list several nodes.
    const sides = parts.map(p => p.split(/\s+&\s+/).map(x => (x.trim() ? node(x) : null)))
    if (sides.some(ids => ids.some(id => id === null))) return null
    arrows.forEach((a, i) => {
      const op = a[1] ?? ''
      const label = (a[5] ?? a[2] ?? a[3] ?? a[4] ?? '').trim()
      const style = op.startsWith('=') ? 'thick' : op.includes('.') ? 'dotted' : 'solid'
      for (const from of sides[i] ?? []) for (const to of sides[i + 1] ?? []) flow.edges.push({ from: from as string, to: to as string, label, style })
    })
  }
  return flow.nodes.length ? flow : null
}

function colourOf(name: string | undefined, classes: Map<string, Colour>): Colour | undefined {
  if (!name) return undefined
  if ((COLOURS as readonly string[]).includes(name)) return name as Colour
  return classes.get(name)
}

// A classDef's fill named by its nearest palette colour (fill:#hex), or by a
// palette name written as the fill.
function colourOfStyle(style: string): Colour | undefined {
  const fill = /fill\s*:\s*([#\w]+)/.exec(style)?.[1]
  if (!fill) return undefined
  if ((COLOURS as readonly string[]).includes(fill)) return fill as Colour
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fill)?.[1]
  if (!hex) return undefined
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
  const hues: [Colour, number, number, number][] = [
    ['blue', 70, 120, 200], ['green', 70, 160, 90], ['orange', 220, 140, 50], ['red', 200, 70, 70],
    ['purple', 150, 90, 200], ['yellow', 210, 190, 70], ['teal', 60, 160, 160], ['gray', 128, 128, 128],
  ]
  let best: Colour = 'gray'
  let dist = Infinity
  for (const [name, hr, hg, hb] of hues) {
    const dd = ((r ?? 0) - hr) ** 2 + ((g ?? 0) - hg) ** 2 + ((b ?? 0) - hb) ** 2
    if (dd < dist) [best, dist] = [name, dd]
  }
  return best
}

// The first arrow in `s` that is not inside a node's brackets.
function findArrow(s: string): RegExpExecArray | null {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? ''
    if ('[({'.includes(c)) depth++
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1)
    else if (depth === 0 && (c === '-' || c === '=')) {
      const m = ARROW.exec(s.slice(i))
      if (m && m.index === 0) {
        m.index = i
        return m
      }
    }
  }
  return null
}

export function charWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff)
    ? 2
    : 1
}

export const textWidth = (s: string) => [...s].reduce((w, ch) => w + charWidth(ch), 0)

// Layers by the longest path from a source; an edge that closes a cycle is
// drawn but does not move its target down.
function layersOf(flow: Flow): Map<string, number> {
  const out = new Map<string, string[]>()
  for (const e of flow.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to])
  const layer = new Map<string, number>()
  const onPath = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (onPath.has(id) || (layer.get(id) ?? -1) >= depth) return
    layer.set(id, depth)
    onPath.add(id)
    for (const to of out.get(id) ?? []) visit(to, depth + 1)
    onPath.delete(id)
  }
  const hasIn = new Set(flow.edges.map(e => e.to))
  for (const n of flow.nodes) if (!hasIn.has(n.id)) visit(n.id, 0)
  for (const n of flow.nodes) if (!layer.has(n.id)) visit(n.id, 0)
  return layer
}

type Placed = { x: number; y: number; w: number; h: number }

// Line directions of a cell, combined when edges cross or meet; corners are
// rounded.
const U = 1, DN = 2, L = 4, R = 8
const LINE: Record<number, string> = {
  [U]: '│', [DN]: '│', [U | DN]: '│', [L]: '─', [R]: '─', [L | R]: '─',
  [DN | R]: '╭', [DN | L]: '╮', [U | R]: '╰', [U | L]: '╯',
  [U | DN | R]: '├', [U | DN | L]: '┤', [DN | L | R]: '┬', [U | L | R]: '┴', [U | DN | L | R]: '┼',
}

const ICON: Partial<Record<FlowNode['shape'], string>> = { diamond: '◆ ', db: '◉ ' }
const iconOf = (n: FlowNode) => (/^\p{Extended_Pictographic}/u.test(n.lines[0] ?? '') ? '' : ICON[n.shape] ?? '')

const nodeW = (n: FlowNode, max: number) => Math.min(max, Math.max(...n.lines.map((l, i) => textWidth((i === 0 ? iconOf(n) : '') + l))) + 4)
const nodeH = (n: FlowNode) => n.lines.length + 2

// Lays the flow out and draws it into a grid of cells, at most `maxWidth`
// wide; null when it does not fit. Edge labels that find no free room are
// returned as `notes` ("A → B: label") to print under the drawing.
export function drawFlow(flow: Flow, maxWidth: number): { grid: Cell[][]; notes: string[] } | null {
  const layer = layersOf(flow)
  const depth = Math.max(0, ...layer.values()) + 1
  const rows: FlowNode[][] = Array.from({ length: depth }, () => [])
  for (const n of flow.nodes) rows[layer.get(n.id) ?? 0]?.push(n)
  // Members of a subgraph side by side, so its background is one block.
  for (const r of rows) r.sort((a, b) => (a.group ?? -1) - (b.group ?? -1))
  // An edge to an earlier layer, or one that skips layers, would cross the
  // cards between: it goes round the outside instead.
  const isAround = (e: FlowEdge) => {
    const span = (layer.get(e.to) ?? 0) - (layer.get(e.from) ?? 0)
    return span <= 0 || span > 1
  }
  const backs = flow.edges.filter(isAround)
  const titled = flow.groups.length > 0
  const placed = new Map<FlowNode, Placed>()
  let width = 0
  let height = 0
  // The width of the cards alone (TD), left of the lanes that go round.
  let body = 0
  if (flow.dir === 'TD') {
    const gapX = 4
    const gapY = titled ? 4 : 3
    const rowW = rows.map(r => r.reduce((w, n) => w + nodeW(n, maxWidth - 2), 0) + gapX * Math.max(0, r.length - 1))
    const rowH = rows.map(r => Math.max(3, ...r.map(nodeH)))
    body = Math.max(...rowW) + (titled ? 2 : 0)
    let y = titled ? 2 : 0
    rows.forEach((r, i) => {
      let x = Math.floor((body - (rowW[i] ?? 0)) / 2)
      for (const n of r) {
        const h = nodeH(n)
        placed.set(n, { x, y: y + Math.floor(((rowH[i] ?? h) - h) / 2), w: nodeW(n, maxWidth - 2), h })
        x += nodeW(n, maxWidth - 2) + gapX
      }
      y += (rowH[i] ?? 3) + gapY
    })
    const aroundLabel = Math.max(0, ...backs.map(e => textWidth(e.label)))
    width = body + (backs.length ? 2 + backs.length * 2 + (aroundLabel ? aroundLabel + 4 : 0) : 0)
    height = y - gapY + (titled ? 1 : 0)
  } else {
    const colW = rows.map(r => Math.max(...r.map(n => nodeW(n, maxWidth - 2))))
    // Room between two columns for the labels of the edges that cross it.
    const gapOf = (i: number) =>
      Math.max(6, ...flow.edges.filter(e => !isAround(e) && layer.get(e.from) === i).map(e => textWidth(e.label) + 6))
    const colH = rows.map(r => r.reduce((h, n) => h + nodeH(n), 0) + Math.max(0, r.length - 1) * (titled ? 3 : 1))
    const tall = Math.max(...colH)
    const top = titled ? 2 : 1
    let x = titled ? 1 : 0
    rows.forEach((r, i) => {
      let y = Math.floor((tall - (colH[i] ?? 0)) / 2) + top
      for (const n of r) {
        const w = nodeW(n, maxWidth - 2)
        placed.set(n, { x: x + Math.floor(((colW[i] ?? w) - w) / 2), y, w, h: nodeH(n) })
        y += nodeH(n) + (titled ? 3 : 1)
      }
      x += (colW[i] ?? 0) + gapOf(i)
    })
    width = x - gapOf(rows.length - 1) + (titled ? 1 : 0)
    height = tall + top + (titled ? 1 : 0) + (backs.length ? 1 + backs.length * 2 : 0)
  }
  // A left-to-right chart too wide for the terminal is laid out top-down.
  if (width > maxWidth) return flow.dir === 'LR' ? drawFlow({ ...flow, dir: 'TD' }, maxWidth) : null

  const masks: number[][] = Array.from({ length: height }, () => Array(width).fill(0))
  const styles: (FlowEdge['style'] | undefined)[][] = Array.from({ length: height }, () => Array(width).fill(undefined))
  const arrows = new Map<string, string>()
  const mark = (x: number, y: number, m: number, style: FlowEdge['style']) => {
    const row = masks[y]
    if (!row || x < 0 || x >= width) return
    row[x] = (row[x] ?? 0) | m
    const st = styles[y]
    if (st && style !== 'solid') st[x] = style
  }
  // A path of corner points, each pair horizontal or vertical.
  const path = (pts: [number, number][], style: FlowEdge['style']) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i] ?? [0, 0]
      const [bx, by] = pts[i + 1] ?? [0, 0]
      if (ay === by) {
        const [lo, hi] = ax < bx ? [ax, bx] : [bx, ax]
        for (let x = lo; x <= hi; x++) mark(x, ay, (x > lo ? L : 0) | (x < hi ? R : 0), style)
      } else {
        const [lo, hi] = ay < by ? [ay, by] : [by, ay]
        for (let y = lo; y <= hi; y++) mark(ax, y, (y > lo ? U : 0) | (y < hi ? DN : 0), style)
      }
    }
  }
  const labels: { x: number; y: number; text: string; note: string }[] = []
  const byId = new Map(flow.nodes.map(n => [n.id, n]))
  const nameOf = (id: string) => byId.get(id)?.lines.join(' ') ?? id

  let lane = 0
  for (const e of flow.edges) {
    const an = byId.get(e.from)
    const bn = byId.get(e.to)
    const a = an && placed.get(an)
    const b = bn && placed.get(bn)
    if (!a || !b) continue
    const note = `${nameOf(e.from)} → ${nameOf(e.to)}: ${e.label}`
    if (flow.dir === 'TD') {
      if (!isAround(e)) {
        const x1 = a.x + Math.floor(a.w / 2)
        // Straight down when the source's middle is over the target.
        const x2 = x1 > b.x && x1 < b.x + b.w - 1 ? x1 : b.x + Math.floor(b.w / 2)
        const y1 = a.y + a.h
        const y2 = b.y - 1
        const turn = Math.min(y1 + 1, y2)
        path([[x1, y1], [x1, turn], [x2, turn], [x2, y2]], e.style)
        arrows.set(`${x2},${y2}`, '▼')
        if (e.label) labels.push({ x: x2 + 2, y: y2, text: e.label, note })
      } else {
        const xr = body + 1 + (backs.length - lane) * 2
        lane++
        const ya = a.y + Math.floor(a.h / 2)
        const yb = b.y + Math.floor(b.h / 2)
        path([[a.x + a.w, ya], [xr, ya], [xr, yb], [b.x + b.w, yb]], e.style)
        arrows.set(`${b.x + b.w},${yb}`, '◀')
        if (e.label) labels.push({ x: body + 3 + backs.length * 2, y: Math.floor((ya + yb) / 2), text: e.label, note })
      }
    } else if (!isAround(e)) {
      const y1 = a.y + Math.floor(a.h / 2)
      const y2 = y1 > b.y && y1 < b.y + b.h - 1 ? y1 : b.y + Math.floor(b.h / 2)
      const x1 = a.x + a.w
      const x2 = b.x - 1
      path([[x1, y1], [x1 + 1, y1], [x1 + 1, y2], [x2, y2]], e.style)
      arrows.set(`${x2},${y2}`, '▶')
      if (e.label) labels.push({ x: x1 + 3, y: y2 - 1, text: e.label, note })
    } else {
      const yb = height - 1 - lane * 2
      lane++
      const xa = a.x + Math.floor(a.w / 2)
      const xb = b.x + Math.floor(b.w / 2)
      path([[xa, a.y + a.h], [xa, yb], [xb, yb], [xb, b.y + b.h]], e.style)
      arrows.set(`${xb},${b.y + b.h}`, '▲')
      if (e.label) labels.push({ x: Math.min(xa, xb) + 2, y: yb - 1, text: e.label, note })
    }
  }

  const grid: Cell[][] = masks.map((row, y) =>
    row.map((m, x): Cell => {
      const arrow = arrows.get(`${x},${y}`)
      if (arrow) return { ch: arrow, kind: 'arrow' }
      if (!m) return { ch: ' ', kind: 'space' }
      let ch = LINE[m] ?? '┼'
      const st = styles[y]?.[x]
      if (st === 'dotted') ch = ch === '│' ? '┆' : ch === '─' ? '┄' : ch
      if (st === 'thick') ch = ch === '│' ? '┃' : ch === '─' ? '━' : ch
      return { ch, kind: 'line' }
    }),
  )

  // Subgraphs: a tinted block round their members, titled at its top.
  flow.groups.forEach((g, gi) => {
    const members = [...placed].filter(([n]) => n.group === gi).map(([, p]) => p)
    if (!members.length) return
    const x0 = Math.max(0, Math.min(...members.map(p => p.x)) - 2)
    const x1 = Math.min(width - 1, Math.max(...members.map(p => p.x + p.w)) + 1)
    const y0 = Math.max(0, Math.min(...members.map(p => p.y)) - 2)
    const y1 = Math.min(height - 1, Math.max(...members.map(p => p.y + p.h)))
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = grid[y]?.[x]
      if (c && c.group === undefined) c.group = gi
    }
    // The title goes on the first free stretch of the block's top row, so no
    // line is written over.
    const r0 = grid[y0] ?? []
    const tw = textWidth(g.title)
    let x = x0 + 1
    while (x + tw <= width && !r0.slice(x - 1, x + tw + 1).every(c => c.kind === 'space')) x++
    if (x + tw > width) return
    for (const ch of g.title) {
      const r = grid[y0]
      if (r) {
        r[x] = { ch, kind: 'title', group: gi }
        if (charWidth(ch) === 2) r[x + 1] = { ch: '', kind: 'title', group: gi }
      }
      x += charWidth(ch)
    }
  })

  // A card: filled, with a rounded light outline; the first line is the
  // title, the others a quieter description.
  for (const [n, p] of placed) {
    const fill = (y: number, s: string[], kinds: Cell['kind'][]) => {
      const r = grid[y]
      if (r) for (let i = 0; i < p.w; i++) r[p.x + i] = { ch: s[i] ?? ' ', kind: kinds[i] ?? 'node', node: n }
    }
    const inner = p.w - 2
    const sides: Cell['kind'][] = ['border', ...Array<Cell['kind']>(inner).fill('node'), 'border']
    fill(p.y, ['╭', ...Array<string>(inner).fill('─'), '╮'], Array(p.w).fill('border'))
    for (let i = 1; i < p.h - 1; i++) fill(p.y + i, ['│', ...Array<string>(inner).fill(' '), '│'], sides)
    fill(p.y + p.h - 1, ['╰', ...Array<string>(inner).fill('─'), '╯'], Array(p.w).fill('border'))
    n.lines.forEach((line, i) => {
      let text = (i === 0 ? iconOf(n) : '') + line
      while (textWidth(text) > p.w - 2 && text.length > 1) text = text.slice(0, -1)
      let x = p.x + Math.floor((p.w - textWidth(text)) / 2)
      const r = grid[p.y + 1 + i]
      for (const ch of text) {
        if (r) {
          r[x] = { ch, kind: 'node', node: n, head: i === 0 }
          if (charWidth(ch) === 2) r[x + 1] = { ch: '', kind: 'node', node: n, head: i === 0 }
        }
        x += charWidth(ch)
      }
    })
  }

  // A label goes, as a small pill, where its cells are all free; else it is
  // a note below the drawing.
  const notes: string[] = []
  for (const l of labels) {
    const w = textWidth(l.text) + 2
    const row = grid[l.y]
    const fits = (x: number) => !!row && x >= 0 && x + w <= width && row.slice(Math.max(0, x - 1), x + w + 1).every(c => c.kind === 'space')
    // Right of the arrow, else left of it.
    const at = fits(l.x) ? l.x : fits(l.x - w - 3) ? l.x - w - 3 : -1
    if (at < 0 || !row) {
      notes.push(l.note)
      continue
    }
    let x = at
    for (const ch of ` ${l.text} `) {
      const g = row[x]?.group
      row[x] = { ch, kind: 'label', group: g }
      if (charWidth(ch) === 2) row[x + 1] = { ch: '', kind: 'label', group: g }
      x += charWidth(ch)
    }
  }
  return { grid, notes }
}
