// Mermaid diagrams other than flowcharts (sequence, class, ER, state, xychart)
// drawn as terminal text by the vendored beautiful-mermaid renderer, then
// styled like the flowcharts: boxes become filled cards with a light outline,
// labels outside boxes become pills, chart series keep their colours.

import { renderMermaidASCII } from '../vendor/beautiful-mermaid-ascii.js'

import { charWidth, type Cell } from './flow'

// The renderer gives every character one cell. A marker after each wide
// character reserves its second cell, and is taken out of the result.
const MARK = ''

// Colours that stand for the renderer's roles in its HTML output.
const ROLE_BY_HEX: Record<string, Cell['kind']> = { '#000001': 'label', '#000002': 'border', '#000003': 'line', '#000004': 'arrow' }
const THEME = { fg: '#000001', border: '#000002', line: '#000003', arrow: '#000004' }

const ROUND: Record<string, string> = { '┌': '╭', '┐': '╮', '└': '╰', '┘': '╯' }
const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" }

type Raw = { ch: string; kind: Cell['kind']; hex?: string }

// The diagram as rows of styled cells at most `maxWidth` wide; null when it
// is not a diagram the renderer reads, or does not fit.
export function drawDiagram(src: string, maxWidth: number): Cell[][] | null {
  const padded = [...src.replace(/[︎️‍]/g, '')].map(ch => (charWidth(ch) === 2 ? ch + MARK : ch)).join('')
  let html: string
  try {
    html = renderMermaidASCII(padded, { colorMode: 'html', theme: THEME })
  } catch {
    return null
  }
  const rows = html.split('\n').map(parseLine)
  while (rows.length && rows[rows.length - 1]?.every(c => c.ch === ' ')) rows.pop()
  if (!rows.some(r => r.some(c => c.ch.trim()))) return null
  fillBoxes(rows)
  const grid = rows.map(r => r.map((c): Cell => (c.ch === MARK ? { ...c, ch: '' } : c)))
  const widths = grid.map(r => r.reduce((w, c) => w + (c.ch === '' ? 0 : charWidth(c.ch)), 0))
  if (widths.some(w => w > maxWidth)) return null
  // Trailing spaces would carry a background across the terminal.
  for (const r of grid) while (r.length && r[r.length - 1]?.kind === 'space') r.pop()
  return grid
}

function parseLine(line: string): Raw[] {
  const out: Raw[] = []
  for (const m of line.matchAll(/<span style="color:(#[0-9a-fA-F]{6})">(.*?)<\/span>|([^<]+)/g)) {
    const hex = m[1]?.toLowerCase()
    const text = (m[2] ?? m[3] ?? '').replace(/&(lt|gt|amp|quot|#39);/g, e => ENTITIES[e] ?? e)
    const kind: Cell['kind'] = hex ? ROLE_BY_HEX[hex] ?? 'line' : 'space'
    for (const ch of text) {
      if (ch === ' ' && kind === 'space') out.push({ ch, kind: 'space' })
      else out.push({ ch: kind === 'border' ? ROUND[ch] ?? ch : ch, kind, hex: hex && !ROLE_BY_HEX[hex] ? hex : undefined })
    }
  }
  return out
}

// Every box (a border corner ╭ with its ╮ to the right and ╰ below) gets its
// inside filled: the text there is a card's title, the blanks its fill.
function fillBoxes(rows: Raw[][]): void {
  const at = (x: number, y: number) => rows[y]?.[x]
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? []
    for (let x = 0; x < row.length; x++) {
      if (at(x, y)?.ch !== '╭' || at(x, y)?.kind !== 'border') continue
      let x2 = x + 1
      while (x2 < row.length && at(x2, y)?.kind === 'border' && at(x2, y)?.ch !== '╮') x2++
      let y2 = y + 1
      while (y2 < rows.length && at(x, y2)?.kind === 'border' && at(x, y2)?.ch !== '╰') y2++
      if (at(x2, y)?.ch !== '╮' || at(x, y2)?.ch !== '╰') continue
      for (let yy = y + 1; yy < y2; yy++) {
        for (let xx = x + 1; xx < x2; xx++) {
          const c = at(xx, yy)
          // Dividers inside a box (class members, ER attributes) stay lines.
          if (c && (c.kind === 'space' || c.kind === 'label')) c.kind = c.kind === 'label' ? 'node' : 'fill'
        }
      }
    }
  }
}
